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

/**
 * Cache OCR, par PAGE et non par document.
 *
 * Le cache d'ingestion ci-dessus ne s'ecrit qu'une fois le document entier
 * traite. Une reprise apres incident, survenue au milieu des quatre pages d'un
 * scan, recommencerait donc toute la reconnaissance. A vingt a quarante
 * secondes la page, cela se voit. La granularite est ici la page.
 */
const DUREE_CACHE_OCR_SECONDES = 30 * 24 * 60 * 60;

export type OcrEnCache = {
  texte: string;
  confianceMoyenne: number;
  nbMots: number;
};

function cleOcr(hash: string, numero: number): string {
  return `ocr:${hash}:${numero}`;
}

export async function lireCacheOcr(hash: string, numero: number): Promise<OcrEnCache | null> {
  try {
    const brut = await connexion.get(cleOcr(hash, numero));
    return brut === null ? null : (JSON.parse(brut) as OcrEnCache);
  } catch {
    // Un cache indisponible ne doit pas empecher de reconnaitre la page.
    return null;
  }
}

export async function ecrireCacheOcr(
  hash: string,
  numero: number,
  resultat: OcrEnCache,
): Promise<void> {
  try {
    await connexion.set(
      cleOcr(hash, numero),
      JSON.stringify(resultat),
      "EX",
      DUREE_CACHE_OCR_SECONDES,
    );
  } catch {
    // Sans consequence : la page sera simplement reocrisee la prochaine fois.
  }
}

export async function fermerCache(): Promise<void> {
  await connexion.quit();
}
