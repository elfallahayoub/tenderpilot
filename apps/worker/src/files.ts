import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { TravailExtraction } from "./extracteur.js";
import type { TravailQualification } from "./qualifier.js";

/**
 * Les deux files du traitement. L'ingestion met l'extraction en file des
 * qu'elle a termine : deposer un avis declenche donc toute la chaine, ce qui
 * est exactement ce que le jury verra a l'ecran.
 */
export const FILE_INGESTION = "ingestion";
export const FILE_EXTRACTION = "extraction";
export const FILE_QUALIFICATION = "qualification";

/** Deux tentatives, puis escalade. Aucune boucle sans condition d'arret. */
export const TENTATIVES_MAX = 2;

const connexion = new IORedis(process.env.REDIS_URL ?? "redis://redis:6379", {
  maxRetriesPerRequest: null,
});

connexion.on("error", (erreur) => {
  console.error("[files] erreur Redis :", erreur.message);
});

export const fileExtraction = new Queue<TravailExtraction>(FILE_EXTRACTION, {
  connection: connexion,
  defaultJobOptions: {
    attempts: TENTATIVES_MAX,
    backoff: { type: "fixed", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});

export const fileQualification = new Queue<TravailQualification>(FILE_QUALIFICATION, {
  connection: connexion,
  defaultJobOptions: {
    attempts: TENTATIVES_MAX,
    backoff: { type: "fixed", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});

export async function fermerFiles(): Promise<void> {
  await fileExtraction.close();
  await fileQualification.close();
  await connexion.quit();
}
