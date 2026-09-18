import { UnrecoverableError, type Job } from "bullmq";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./shared/db.js";
import { journaliser, journaliserSansBloquer } from "./shared/journal.js";
import { PREFIXE_ETAPE_OCR } from "./shared/types.js";
import type { StatutEvenement } from "./shared/types.js";
import { fileExtraction } from "./files.js";
import { ouvrirDocument, PdfInvalide } from "./extraction.js";
import { ecrireCache, ecrireCacheOcr, lireCache, lireCacheOcr } from "./cache.js";
import {
  ocriserPage,
  SEUIL_CARACTERES_OCR,
  SEUIL_CONFIANCE_OCR,
  RESOLUTION_DPI,
} from "./ocr.js";

const AGENT = "ingestor";

const DOSSIER_TELEVERSEMENTS = process.env.DOSSIER_TELEVERSEMENTS ?? "/app/televersements";

export type TravailIngestion = {
  documentId: string;
  hash: string;
};

export type PageEnregistree = {
  numero: number;
  texte: string;
  nbCaracteres: number;
  source: "texte" | "ocr";
  lisible: boolean;
  motifIllisible: string | null;
  /** Confiance moyenne de Tesseract, de 0 a 100. Null pour une couche texte. */
  qualiteOcr: number | null;
  dureeOcrMs: number | null;
};

export type ResultatIngestion = {
  pages: number;
  lisibles: number;
  depuisLeCache: boolean;
};

/**
 * Traitement d'un depot. Aucun appel au modele a cette tranche : le journal
 * porte donc modele null, ce qui se lit a l'ecran comme "code pur".
 *
 * Le run du journal est l'identifiant du document : le journal d'un document
 * est l'histoire de son traitement, reprises comprises.
 */
export async function traiterIngestion(job: Job<TravailIngestion>): Promise<ResultatIngestion> {
  const { documentId, hash } = job.data;
  const runId = documentId;
  const debutTotal = performance.now();

  const maxTentatives = job.opts.attempts ?? 1;
  const tentative = job.attemptsMade + 1;

  try {
    await changerStatut(documentId, "en_cours");
    await tracer(runId, "reception du document", 0, "succes", `tentative ${tentative} sur ${maxTentatives}`);

    const debutCache = performance.now();
    const enCache = await lireCache(hash);
    await tracer(
      runId,
      "consultation du cache",
      Math.round(performance.now() - debutCache),
      "succes",
      enCache
        ? `${enCache.length} pages relues depuis Redis, extraction evitee`
        : "aucune entree, extraction necessaire",
    );

    let pages: PageEnregistree[];

    if (enCache) {
      pages = enCache;
    } else {
      const chemin = join(DOSSIER_TELEVERSEMENTS, `${hash}.pdf`);

      const debutLecture = performance.now();
      const donnees = new Uint8Array(await readFile(chemin));
      await tracer(
        runId,
        "lecture du fichier depose",
        Math.round(performance.now() - debutLecture),
        "succes",
        `${donnees.byteLength} octets`,
      );

      const debutOuverture = performance.now();
      const document = await ouvrirDocument(donnees);
      await tracer(
        runId,
        "ouverture du PDF",
        Math.round(performance.now() - debutOuverture),
        "succes",
        `${document.nbPages} pages declarees par la structure du document`,
      );

      pages = [];
      for (let numero = 1; numero <= document.nbPages; numero += 1) {
        const page = await document.lirePage(numero);
        pages.push({
          numero: page.numero,
          texte: page.texte,
          nbCaracteres: page.nbCaracteres,
          source: "texte",
          lisible: page.lisible,
          motifIllisible: page.motifIllisible,
          qualiteOcr: null,
          dureeOcrMs: null,
        });
        await tracer(
          runId,
          `lecture page ${numero}`,
          page.dureeMs,
          "succes",
          page.lisible
            ? `${page.nbCaracteres} caracteres extraits de la couche texte`
            : `page illisible : ${page.motifIllisible}. Aucune exigence ne sera deduite de cette page.`,
        );
      }

      // --- OCR des pages sans couche texte --------------------------------
      // On ne tente l'OCR que la ou il n'y a rien a lire : c'est lent, et une
      // page deja lue n'a rien a y gagner.
      const aOcriser = pages.filter((page) => !page.lisible);
      if (aOcriser.length > 0) {
        await tracer(runId, "plan OCR", 0, "succes",
          `${aOcriser.length} pages sans couche texte, rendu a ${RESOLUTION_DPI} dpi puis Tesseract en francais`);
      }

      for (const page of aOcriser) {
        // Le cache est par page : une reprise apres incident ne refait pas les
        // reconnaissances deja abouties.
        const enCacheOcr = await lireCacheOcr(hash, page.numero);
        const resultat =
          enCacheOcr === null
            ? await ocriserPage(chemin, page.numero)
            : { ...enCacheOcr, dureeMs: 0 };
        if (enCacheOcr === null) {
          await ecrireCacheOcr(hash, page.numero, {
            texte: resultat.texte,
            confianceMoyenne: resultat.confianceMoyenne,
            nbMots: resultat.nbMots,
          });
        }

        const texte = resultat.texte;
        const utile = texte.trim().length;
        const lisible = utile >= SEUIL_CARACTERES_OCR;

        page.texte = texte;
        page.nbCaracteres = texte.length;
        page.source = "ocr";
        page.lisible = lisible;
        page.qualiteOcr = resultat.confianceMoyenne;
        page.dureeOcrMs = resultat.dureeMs;
        page.motifIllisible = lisible
          ? null
          : utile === 0
            ? "aucune couche texte, et l'OCR n'a rien reconnu"
            : `aucune couche texte, et l'OCR n'a rendu que ${utile} caracteres exploitables`;

        // La duree d'OCR est journalisee par page : elle entrera dans la page
        // Qualite a cote des jetons, comme second poste de cout.
        await tracer(runId, `${PREFIXE_ETAPE_OCR}${page.numero}`, resultat.dureeMs, "succes",
          lisible
            ? `${page.nbCaracteres} caracteres, ${resultat.nbMots} mots, confiance moyenne ${resultat.confianceMoyenne} sur 100` +
              (enCacheOcr !== null ? ", relue depuis le cache OCR" : "") +
              (resultat.confianceMoyenne < SEUIL_CONFIANCE_OCR
                ? `, sous le seuil de ${SEUIL_CONFIANCE_OCR} : lecture incertaine`
                : "")
            : `echec : ${page.motifIllisible}. Aucune exigence n'en sera deduite.`);
      }

      await ecrireCache(hash, pages);
    }

    const debutEcriture = performance.now();
    await enregistrerPages(documentId, pages);
    await tracer(
      runId,
      "enregistrement des pages",
      Math.round(performance.now() - debutEcriture),
      "succes",
      `${pages.length} pages ecrites en base`,
    );

    const lisibles = pages.filter((page) => page.lisible).length;
    await terminer(documentId, pages.length);

    await tracer(
      runId,
      "ingestion terminee",
      Math.round(performance.now() - debutTotal),
      "succes",
      `${lisibles} pages lues sur ${pages.length}`,
    );

    // La chaine s'enchaine seule : deposer un avis declenche l'extraction.
    // jobId fixe sur le document : un redepot ne cree pas deux extractions.
    // BullMQ interdit le deux-points dans un identifiant de travail.
    await fileExtraction.add("extraire", { documentId }, { jobId: `extraction-${documentId}` });
    await tracer(runId, "extraction mise en file", 0, "succes", "relais vers l'agent extractor");

    return { pages: pages.length, lisibles, depuisLeCache: enCache !== null };
  } catch (erreur) {
    // Le point final des messages pdf.js ferait doublon avec la phrase suivante.
    const message = (erreur instanceof Error ? erreur.message : String(erreur)).replace(/\.$/, "");
    const duree = Math.round(performance.now() - debutTotal);

    // Un PDF structurellement invalide ne deviendra jamais valide : le
    // reessayer produirait exactement la meme erreur, on echoue tout de suite.
    if (erreur instanceof PdfInvalide) {
      await echouer(documentId, message);
      await tracerSansBloquer(
        runId,
        "extraction impossible",
        duree,
        "echec",
        `${message}. Aucune reprise, l'echec est definitif.`,
      );
      throw new UnrecoverableError(message);
    }

    // Panne passagere, il reste une tentative.
    if (tentative < maxTentatives) {
      await tracerSansBloquer(
        runId,
        "erreur passagere",
        duree,
        "reprise",
        `${message}. Nouvelle tentative ${tentative + 1} sur ${maxTentatives}.`,
      );
      throw erreur;
    }

    // Tentatives epuisees : escalade a l'humain, rien n'est devine.
    await echouer(documentId, message);
    await tracerSansBloquer(
      runId,
      "echec definitif",
      duree,
      "escalade",
      `${message}. ${maxTentatives} tentatives epuisees, intervention humaine requise.`,
    );
    throw erreur;
  }
}

async function tracer(
  runId: string,
  etape: string,
  dureeMs: number,
  statut: StatutEvenement,
  detail: string,
): Promise<void> {
  await journaliser({ runId, agent: AGENT, etape, modele: null, tokens: null, dureeMs, statut, detail });
}

/**
 * Journalisation du chemin d'erreur. Si Postgres est lui-meme en panne,
 * l'ecriture du journal echouerait a son tour et masquerait la cause reelle.
 * On l'affiche alors bruyamment, et l'erreur d'origine continue de remonter :
 * rien n'est avale.
 */
async function tracerSansBloquer(
  runId: string,
  etape: string,
  dureeMs: number,
  statut: StatutEvenement,
  detail: string,
): Promise<void> {
  await journaliserSansBloquer({ runId, agent: AGENT, etape, modele: null, tokens: null, dureeMs, statut, detail });
}

/** Ecriture idempotente : une reprise reecrit les memes pages sans doublon. */
async function enregistrerPages(documentId: string, pages: PageEnregistree[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const page of pages) {
      await client.query(
        `INSERT INTO pages (document_id, numero, texte, nb_caracteres, source, lisible,
                            motif_illisible, qualite_ocr, duree_ocr_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (document_id, numero) DO UPDATE
           SET texte = EXCLUDED.texte,
               nb_caracteres = EXCLUDED.nb_caracteres,
               source = EXCLUDED.source,
               lisible = EXCLUDED.lisible,
               motif_illisible = EXCLUDED.motif_illisible,
               qualite_ocr = EXCLUDED.qualite_ocr,
               duree_ocr_ms = EXCLUDED.duree_ocr_ms`,
        [
          documentId,
          page.numero,
          page.texte,
          page.nbCaracteres,
          page.source,
          page.lisible,
          page.motifIllisible,
          page.qualiteOcr,
          page.dureeOcrMs,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (erreur) {
    await client.query("ROLLBACK");
    throw erreur;
  } finally {
    client.release();
  }
}

async function changerStatut(documentId: string, statut: "en_cours"): Promise<void> {
  await pool.query(`UPDATE documents SET statut = $2, motif_echec = NULL WHERE id = $1`, [
    documentId,
    statut,
  ]);
}

async function terminer(documentId: string, nbPages: number): Promise<void> {
  await pool.query(
    `UPDATE documents SET statut = 'traite', nb_pages = $2, motif_echec = NULL WHERE id = $1`,
    [documentId, nbPages],
  );
}

async function echouer(documentId: string, motif: string): Promise<void> {
  try {
    await pool.query(`UPDATE documents SET statut = 'echec', motif_echec = $2 WHERE id = $1`, [
      documentId,
      motif.slice(0, 500),
    ]);
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    console.error(`[ingestor] statut echec non enregistre pour ${documentId} : ${message}`);
  }
}
