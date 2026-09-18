import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Stockage des PDF deposes, sur un volume partage avec le worker.
 * Le fichier est nomme d'apres son empreinte : deux depots identiques
 * ecrivent le meme chemin, il n'y a donc jamais de doublon sur le disque.
 */
export const DOSSIER_TELEVERSEMENTS = process.env.DOSSIER_TELEVERSEMENTS ?? "/app/televersements";

/** Plafond de taille accepte au depot. Au-dela, l'api repond 413. */
export const TAILLE_MAX_OCTETS = 20 * 1024 * 1024;

export function empreinte(contenu: Buffer): string {
  return createHash("sha256").update(contenu).digest("hex");
}

/** Nom de fichier sur le volume. Deduit de l'empreinte, jamais du nom depose. */
export function cheminDepuisEmpreinte(hash: string): string {
  return `${hash}.pdf`;
}

/** Ecrit le PDF sur le volume partage et retourne son chemin relatif. */
export async function ecrireDocument(hash: string, contenu: Buffer): Promise<string> {
  await mkdir(DOSSIER_TELEVERSEMENTS, { recursive: true });
  const chemin = cheminDepuisEmpreinte(hash);
  await writeFile(join(DOSSIER_TELEVERSEMENTS, chemin), contenu);
  return chemin;
}
