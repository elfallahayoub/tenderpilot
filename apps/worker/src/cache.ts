import IORedis from "ioredis";
import type { PageEnregistree } from "./ingestion.js";

/**
 * Cache d'extraction, indexe par empreinte de document.
 *
 * L'unicite de l'empreinte en base empeche deja de retraiter deux fois le
 * meme depot. Ce cache sert donc quand la base a ete remise a zero alors que
 * Redis a survecu, et surtout a la tranche 6 : reconduire un OCR coute cher,
 * relire son resultat ne coute rien.
 *
 * Connexion distincte de celle de BullMQ, qui reserve la sienne aux commandes
 * bloquantes de la file.
 */
const connexion = new IORedis(process.env.REDIS_URL ?? "redis://redis:6379", {
  maxRetriesPerRequest: 2,
});

connexion.on("error", (erreur) => {
  console.error("[cache] erreur Redis :", erreur.message);
});

export const DUREE_CACHE_SECONDES = 24 * 60 * 60;

function cle(hash: string): string {
  // v2 : les entrees anterieures a l OCR ne contiennent pas les pages
  // reconnues. Changer la cle les met hors circuit plutot que de servir
  // une ingestion incomplete.
  return `ingestion:doc:v2:${hash}`;
}

export async function lireCache(hash: string): Promise<PageEnregistree[] | null> {
  const brut = await connexion.get(cle(hash));
  if (!brut) return null;
  try {
    return JSON.parse(brut) as PageEnregistree[];
  } catch {
    // Entree corrompue : on la supprime et on reextrait plutot que de
    // propager des donnees douteuses.
    await connexion.del(cle(hash));
    return null;
  }
}

export async function ecrireCache(hash: string, pages: PageEnregistree[]): Promise<void> {
  await connexion.set(cle(hash), JSON.stringify(pages), "EX", DUREE_CACHE_SECONDES);
}

export async function fermerCache(): Promise<void> {
  await connexion.quit();
}
