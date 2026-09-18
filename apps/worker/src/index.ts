import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { traiterIngestion, type TravailIngestion } from "./ingestion.js";
import { fermerCache } from "./cache.js";
import { fermerPostgres } from "./db.js";

/**
 * Worker BullMQ. Il consomme la file d'ingestion : un depot, un PDF lu page
 * par page, une ligne par page en base, une ligne par etape dans agent_events.
 * L'OCR des scans viendra s'y brancher en tranche 6.
 */

export const FILE_INGESTION = "ingestion";

// maxRetriesPerRequest doit valoir null : BullMQ refuse toute autre valeur
// sur une connexion bloquante.
const connection = new IORedis(process.env.REDIS_URL ?? "redis://redis:6379", {
  maxRetriesPerRequest: null,
});

connection.on("error", (erreur) => {
  console.error("[worker] erreur Redis :", erreur.message);
});

async function traiter(job: Job<TravailIngestion>): Promise<unknown> {
  console.log(`[worker] travail ${job.id} de type "${job.name}" recu`);
  return traiterIngestion(job);
}

const worker = new Worker<TravailIngestion>(FILE_INGESTION, traiter, {
  connection,
  concurrency: 2,
});

worker.on("ready", () => {
  console.log(`[worker] pret, a l'ecoute de la file "${FILE_INGESTION}"`);
});

worker.on("completed", (job, resultat) => {
  console.log(`[worker] travail ${job.id} termine :`, resultat);
});

worker.on("failed", (job, erreur) => {
  // Aucune erreur n'est avalee en silence : le statut du document et le
  // journal d'agent portent deja le motif, la console le repete.
  console.error(`[worker] travail ${job?.id ?? "inconnu"} en echec :`, erreur.message);
});

worker.on("error", (erreur) => {
  console.error("[worker] erreur :", erreur.message);
});

/** Arret propre : on laisse les travaux en cours se terminer. */
async function arreter(signal: string): Promise<void> {
  console.log(`[worker] signal ${signal} recu, arret en cours`);
  try {
    await worker.close();
    await Promise.allSettled([connection.quit(), fermerCache(), fermerPostgres()]);
  } finally {
    process.exit(0);
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void arreter(signal));
}

console.log("[worker] demarrage");
