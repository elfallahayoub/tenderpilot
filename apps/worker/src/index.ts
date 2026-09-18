import { Worker, type Job } from "bullmq";
import IORedis from "ioredis";

/**
 * Worker BullMQ. A cette tranche il ne traite encore aucun travail reel :
 * il ouvre la file, prouve que Redis repond, et journalise qu'il est pret.
 * L'ingestion PDF et l'OCR viendront s'y brancher aux tranches suivantes.
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

async function traiter(job: Job): Promise<{ ok: true }> {
  console.log(`[worker] travail ${job.id} de type "${job.name}" recu`);
  return { ok: true };
}

const worker = new Worker(FILE_INGESTION, traiter, {
  connection,
  concurrency: 2,
});

worker.on("ready", () => {
  console.log(`[worker] pret, a l'ecoute de la file "${FILE_INGESTION}"`);
});

worker.on("failed", (job, erreur) => {
  // Aucune erreur n'est avalee en silence : une tranche ulterieure
  // l'ecrira dans agent_events avec le statut "echec".
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
    await connection.quit();
  } finally {
    process.exit(0);
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void arreter(signal));
}

console.log("[worker] demarrage");
