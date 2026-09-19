import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { traiterIngestion, type TravailIngestion } from "./ingestion.js";
import { traiterExtraction, type TravailExtraction } from "./extracteur.js";
import { traiterQualification, type TravailQualification } from "./qualifier.js";
import { traiterRedaction, type TravailRedaction } from "./writer.js";
import {
  FILE_EXTRACTION,
  FILE_INGESTION,
  FILE_QUALIFICATION,
  FILE_REDACTION,
  fermerFiles,
} from "./files.js";
import { fermerCache } from "./cache.js";
import { fermerPostgres } from "./shared/db.js";
import { appliquerMigrations } from "./shared/migrations.js";
import { fermerLlm } from "./shared/llm.js";

/**
 * Le worker heberge deux agents.
 *
 * "ingestor" lit le PDF page par page, sans jamais appeler de modele.
 * "extractor" analyse chaque page lisible et produit les exigences, sur
 * gpt-4.1 uniquement, le routage etant decide dans shared/llm.ts.
 * "qualifier" evalue chaque exigence contre le profil lu en base et produit le
 * verdict. Le verdict sort du moteur de regles, jamais d un modele.
 *
 * L'ingestion met l'extraction en file : la chaine complete part d'un depot.
 */

// maxRetriesPerRequest doit valoir null : BullMQ refuse toute autre valeur
// sur une connexion bloquante.
const connection = new IORedis(process.env.REDIS_URL ?? "redis://redis:6379", {
  maxRetriesPerRequest: null,
});

connection.on("error", (erreur) => {
  console.error("[worker] erreur Redis :", erreur.message);
});

const ingesteur = new Worker<TravailIngestion>(
  FILE_INGESTION,
  async (job: Job<TravailIngestion>) => {
    console.log(`[ingestor] travail ${job.id} recu`);
    return traiterIngestion(job);
  },
  { connection, concurrency: 2 },
);

const extracteur = new Worker<TravailExtraction>(
  FILE_EXTRACTION,
  async (job: Job<TravailExtraction>) => {
    console.log(`[extractor] travail ${job.id} recu`);
    return traiterExtraction(job);
  },
  // Un seul a la fois : l'usage des modeles est partage entre participants.
  { connection, concurrency: 1 },
);

const qualifieur = new Worker<TravailQualification>(
  FILE_QUALIFICATION,
  async (job) => {
    console.log(`[qualifier] travail ${job.id} recu`);
    return traiterQualification(job);
  },
  { connection, concurrency: 1 },
);

const redacteur = new Worker<TravailRedaction>(
  FILE_REDACTION,
  async (job) => {
    console.log(`[writer] travail ${job.id} recu`);
    return traiterRedaction(job);
  },
  { connection, concurrency: 1 },
);

for (const [nom, worker] of [
  ["ingestor", ingesteur],
  ["extractor", extracteur],
  ["qualifier", qualifieur],
  ["writer", redacteur],
] as const) {
  worker.on("ready", () => console.log(`[${nom}] pret`));
  worker.on("completed", (job, resultat) =>
    console.log(`[${nom}] travail ${job.id} termine :`, resultat),
  );
  worker.on("failed", (job, erreur) =>
    // Aucune erreur n'est avalee : le statut du document et le journal
    // d'agent portent deja le motif, la console le repete.
    console.error(`[${nom}] travail ${job?.id ?? "inconnu"} en echec :`, erreur.message),
  );
  worker.on("error", (erreur) => console.error(`[${nom}] erreur :`, erreur.message));
}

/** Arret propre : on laisse les travaux en cours se terminer. */
async function arreter(signal: string): Promise<void> {
  console.log(`[worker] signal ${signal} recu, arret en cours`);
  try {
    await Promise.allSettled([
      ingesteur.close(),
      extracteur.close(),
      qualifieur.close(),
      redacteur.close(),
    ]);
    await Promise.allSettled([
      connection.quit(),
      fermerFiles(),
      fermerCache(),
      fermerLlm(),
      fermerPostgres(),
    ]);
  } finally {
    process.exit(0);
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void arreter(signal));
}

// Le verrou consultatif evite que l'api et le worker appliquent la meme
// migration en meme temps : le second attend, puis ne trouve rien a faire.
const migrations = await appliquerMigrations();
console.log(
  migrations.appliquees.length === 0
    ? `[worker] schema a jour, ${migrations.dejaAppliquees} migrations deja appliquees`
    : `[worker] migrations appliquees : ${migrations.appliquees.join(", ")}`,
);

console.log("[worker] demarrage");
