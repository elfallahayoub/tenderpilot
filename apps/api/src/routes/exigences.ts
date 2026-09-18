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
      nb_pages: number | null;
    }>(`SELECT statut_extraction, motif_extraction, nb_pages FROM documents WHERE id = $1`, [id]);

    if (document.rowCount === 0) {
      return reponse.code(404).send({ erreur: "document introuvable" });
    }

    const exigences = await pool.query(
      `SELECT id, numero_page AS page, texte, citation, article, type, categorie,
              fait, confiance, confiance_detail
         FROM requirements
        WHERE document_id = $1
        ORDER BY CASE type
                   WHEN 'eliminatoire' THEN 0
                   WHEN 'obligatoire'  THEN 1
                   ELSE 2
                 END,
                 categorie ASC,
                 numero_page ASC`,
      [id],
    );

    // Les pages non lues sont nommees, jamais passees sous silence : une
    // matrice incomplete doit se presenter comme telle.
    const pages = await pool.query<{
      numero: number;
      lisible: boolean;
      motif_illisible: string | null;
    }>(`SELECT numero, lisible, motif_illisible FROM pages WHERE document_id = $1 ORDER BY numero`, [
      id,
    ]);

    const nonLues = pages.rows.filter((page) => !page.lisible);

    return {
      statutExtraction: document.rows[0]!.statut_extraction,
      motifExtraction: document.rows[0]!.motif_extraction,
      exigences: exigences.rows,
      couverture: {
        pagesTotal: pages.rowCount,
        pagesLues: pages.rows.filter((page) => page.lisible).length,
        pagesNonLues: nonLues.map((page) => ({
          numero: page.numero,
          motif: page.motif_illisible ?? "page illisible",
        })),
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
