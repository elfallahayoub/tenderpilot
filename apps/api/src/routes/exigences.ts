import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { pool } from "../shared/db.js";
import { DOSSIER_TELEVERSEMENTS } from "../stockage.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nom de fichier sur le volume : l'empreinte, jamais une entree utilisateur. */
const EMPREINTE = /^[0-9a-f]{64}\.pdf$/;

export async function routesExigences(app: FastifyInstance): Promise<void> {
  /**
   * Matrice de conformite d'un avis.
   *
   * Les eliminatoires sortent en tete, puis les obligatoires : ce qui peut
   * faire perdre le marche se lit avant le reste. L'ordre est decide par la
   * requete, pas par l'interface, pour qu'il soit le meme partout.
   */
  app.get<{ Params: { id: string } }>("/documents/:id/exigences", async (requete, reponse) => {
    const { id } = requete.params;
    if (!UUID.test(id)) {
      return reponse.code(400).send({ erreur: "identifiant invalide" });
    }

    const document = await pool.query<{
      statut_extraction: string;
      motif_extraction: string | null;
      statut_qualification: string;
      motif_qualification: string | null;
      verdict: string | null;
      complet: boolean | null;
      composantes_manquantes: string[] | null;
      reserve: string | null;
      annee_reference: number | null;
      origine_annee_reference: string | null;
      nb_pages: number | null;
    }>(
      `SELECT statut_extraction, motif_extraction, statut_qualification, motif_qualification,
              verdict, complet, composantes_manquantes, reserve,
              annee_reference, origine_annee_reference, nb_pages
         FROM documents WHERE id = $1`,
      [id],
    );

    if (document.rowCount === 0) {
      return reponse.code(404).send({ erreur: "document introuvable" });
    }

    // Les bloquants remontent en tete, avant meme les autres eliminatoires :
    // c'est ce qui fait perdre le marche, cela se lit en premier.
    const exigences = await pool.query(
      `SELECT r.id, r.numero_page AS page, r.texte, r.citation, r.article, r.type, r.categorie,
              r.fait, r.confiance, r.confiance_detail,
              v.statut AS statut_evaluation, v.preuve, v.bloquant, v.origine, v.modele
         FROM requirements r
         LEFT JOIN evaluations v ON v.requirement_id = r.id
        WHERE r.document_id = $1
        ORDER BY COALESCE(v.bloquant, false) DESC,
                 CASE r.type
                   WHEN 'eliminatoire' THEN 0
                   WHEN 'obligatoire'  THEN 1
                   ELSE 2
                 END,
                 r.categorie ASC,
                 r.numero_page ASC`,
      [id],
    );

    // Les pages non lues sont nommees, jamais passees sous silence : une
    // matrice incomplete doit se presenter comme telle.
    const pages = await pool.query<{
      numero: number;
      lisible: boolean;
      motif_illisible: string | null;
      source: string;
      qualite_ocr: number | null;
    }>(
      `SELECT numero, lisible, motif_illisible, source, qualite_ocr
         FROM pages WHERE document_id = $1 ORDER BY numero`,
      [
      id,
      ],
    );

    const nonLues = pages.rows.filter((page) => !page.lisible);

    const ligne = document.rows[0]!;

    return {
      statutExtraction: ligne.statut_extraction,
      motifExtraction: ligne.motif_extraction,
      statutQualification: ligne.statut_qualification,
      motifQualification: ligne.motif_qualification,
      verdict: ligne.verdict,
      complet: ligne.complet,
      composantesManquantes: ligne.composantes_manquantes,
      reserve: ligne.reserve,
      anneeReference: ligne.annee_reference,
      origineAnneeReference: ligne.origine_annee_reference,
      exigences: exigences.rows,
      couverture: {
        pagesTotal: pages.rowCount,
        pagesLues: pages.rows.filter((page) => page.lisible).length,
        pagesNonLues: nonLues.map((page) => ({
          numero: page.numero,
          motif: page.motif_illisible ?? "page illisible",
        })),
        pagesOcr: pages.rows
          .filter((page) => page.source === "ocr" && page.lisible)
          .map((page) => ({ numero: page.numero, qualite: page.qualite_ocr })),
      },
    };
  });

  /**
   * Sert le PDF d'origine, pour que l'interface puisse l'ouvrir a la page
   * citee. C'est ce qui rend EX-03 verifiable en un clic.
   */
  app.get<{ Params: { id: string } }>("/documents/:id/fichier", async (requete, reponse) => {
    const { id } = requete.params;
    if (!UUID.test(id)) {
      return reponse.code(400).send({ erreur: "identifiant invalide" });
    }

    const resultat = await pool.query<{ chemin: string; nom_fichier: string }>(
      `SELECT chemin, nom_fichier FROM documents WHERE id = $1`,
      [id],
    );
    const document = resultat.rows[0];
    if (!document) {
      return reponse.code(404).send({ erreur: "document introuvable" });
    }

    // Le chemin vient de la base et vaut toujours <empreinte>.pdf. On le
    // verifie quand meme : aucune chaine issue d'un depot ne doit pouvoir
    // designer un fichier hors du volume.
    if (!EMPREINTE.test(document.chemin)) {
      return reponse.code(500).send({ erreur: "chemin de document invalide" });
    }

    const chemin = join(DOSSIER_TELEVERSEMENTS, document.chemin);
    try {
      await stat(chemin);
    } catch {
      return reponse.code(404).send({ erreur: "fichier absent du volume de stockage" });
    }

    return reponse
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `inline; filename="${document.nom_fichier.replace(/"/g, "")}"`)
      .send(createReadStream(chemin));
  });
}
