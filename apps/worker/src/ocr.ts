import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const executer = promisify(execFile);

/**
 * OCR des pages sans couche texte.
 *
 * La page est rendue en image par poppler, puis lue par Tesseract en francais.
 * Tesseract rend aussi une confiance par mot : on en tire une confiance
 * moyenne de page, qui sert a plafonner la confiance des exigences issues de
 * cette page et a declencher une reserve sur le verdict.
 *
 * Rien n'est devine ici. Quand la reconnaissance echoue, le texte rendu est
 * pauvre ou vide, et c'est l'appelant qui en tire les consequences.
 */

/**
 * Resolution de rendu. Les scans fournis sont a 120 ppi : monter au-dela de
 * 300 n'ajoute aucune information, cela ne fait qu'agrandir le bruit. Mesure
 * faite sur AO-2026-004, ou 300, 400 et 600 dpi donnent la meme illisibilite
 * sur les memes lignes.
 */
export const RESOLUTION_DPI = 300;

export const LANGUE_OCR = "fra";

/**
 * En dessous de cette confiance moyenne, la reconnaissance d'une page est trop
 * incertaine pour que le contenu soit tenu pour lu sans reserve.
 *
 * La valeur vient d'une mesure sur les deux scans fournis, pas d'une intuition.
 * Les pages proprement reconnues de AO-2026-009 se situent nettement au-dessus,
 * les pages degradees de AO-2026-004 nettement en dessous. Le seuil est place
 * entre les deux, et il est teste.
 */
export const SEUIL_CONFIANCE_OCR = 75;

/** En dessous, la page n'a rien rendu d'exploitable, quelle que soit la confiance. */
export const SEUIL_CARACTERES_OCR = 50;

export type ResultatOcr = {
  texte: string;
  /** Confiance moyenne de Tesseract sur les mots reconnus, de 0 a 100. */
  confianceMoyenne: number;
  nbMots: number;
  dureeMs: number;
};

/**
 * OCRise une page d'un PDF. Le numero est celui de la structure du document,
 * jamais un indice de tableau : poppler recoit directement ce numero.
 */
export async function ocriserPage(cheminPdf: string, numero: number): Promise<ResultatOcr> {
  const debut = performance.now();
  const dossier = await mkdtemp(join(tmpdir(), "tenderpilot-ocr-"));

  try {
    const image = join(dossier, "page");
    await executer("pdftoppm", [
      "-r",
      String(RESOLUTION_DPI),
      "-f",
      String(numero),
      "-l",
      String(numero),
      "-png",
      "-singlefile",
      cheminPdf,
      image,
    ]);

    const sortie = join(dossier, "sortie");
    // "txt tsv" produit les deux fichiers en une seule reconnaissance :
    // le texte, et le detail par mot d'ou l'on tire la confiance.
    await executer("tesseract", [
      `${image}.png`,
      sortie,
      "-l",
      LANGUE_OCR,
      "--psm",
      "3",
      "txt",
      "tsv",
    ]);

    const texte = await readFile(`${sortie}.txt`, "utf8");
    const tsv = await readFile(`${sortie}.tsv`, "utf8");
    const { confianceMoyenne, nbMots } = analyserTsv(tsv);

    return {
      texte,
      confianceMoyenne,
      nbMots,
      dureeMs: Math.round(performance.now() - debut),
    };
  } finally {
    await rm(dossier, { recursive: true, force: true });
  }
}

/**
 * Confiance moyenne sur les mots reellement reconnus.
 * Les lignes sans texte et les confiances negatives sont des marqueurs de
 * structure, pas des mots : elles ne comptent pas dans la moyenne.
 */
export function analyserTsv(tsv: string): { confianceMoyenne: number; nbMots: number } {
  const lignes = tsv.split("\n").slice(1);
  let somme = 0;
  let nbMots = 0;

  for (const ligne of lignes) {
    const colonnes = ligne.split("\t");
    if (colonnes.length < 12) continue;
    const confiance = Number(colonnes[10]);
    const texte = (colonnes[11] ?? "").trim();
    if (!Number.isFinite(confiance) || confiance < 0 || texte.length === 0) continue;
    somme += confiance;
    nbMots += 1;
  }

  return {
    confianceMoyenne: nbMots === 0 ? 0 : Math.round((somme / nbMots) * 10) / 10,
    nbMots,
  };
}
