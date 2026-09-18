import { Queue } from "bullmq";
import IORedis from "ioredis";

/**
 * Producteur BullMQ. Connexion dediee, distincte du client de la route de
 * sante : BullMQ exige maxRetriesPerRequest a null et sa propre file hors
 * ligne, la ou la sonde de sante exige au contraire un echec immediat.
 */
export const FILE_INGESTION = "ingestion";
/** Declenchee a la demande depuis l interface, jamais enchainee. */
export const FILE_REDACTION = "redaction";

/** Deux tentatives, puis escalade. Aucune boucle sans condition d'arret. */
export const TENTATIVES_MAX = 2;

const connexion = new IORedis(process.env.REDIS_URL ?? "redis://redis:6379", {
  maxRetriesPerRequest: null,
});

connexion.on("error", (erreur) => {
  console.error("[file] erreur Redis :", erreur.message);
});

export type TravailIngestion = {
  documentId: string;
  hash: string;
};

export const fileIngestion = new Queue<TravailIngestion>(FILE_INGESTION, {
  connection: connexion,
  defaultJobOptions: {
    attempts: TENTATIVES_MAX,
    backoff: { type: "fixed", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});

export const fileRedaction = new Queue<{ documentId: string }>(FILE_REDACTION, {
  connection: connexion,
  defaultJobOptions: {
    attempts: TENTATIVES_MAX,
    backoff: { type: "fixed", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});

export async function fermerFile(): Promise<void> {
  await fileIngestion.close();
  await fileRedaction.close();
  await connexion.quit();
}
