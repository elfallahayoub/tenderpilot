import type { FastifyInstance } from "fastify";
import { pool } from "../shared/db.js";
import { fileIngestion } from "../queue.js";
import { ecrireDocument, empreinte } from "../stockage.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Violation d'unicite Postgres : deux depots simultanes du meme fichier. */
const CODE_DOUBLON = "23505";

type LigneDocument = {
  id: string;
  nom_fichier: string;
  chemin: string;
  nb_pages: number | null;
  statut: "recu" | "en_cours" | "traite" | "echec";
  statut_extraction: "en_attente" | "en_cours" | "termine" | "echec";
  hash_sha256: string;
  motif_echec: string | null;
  motif_extraction: string | null;
  cree_le: string;
  pages_enregistrees: number;
  pages_lisibles: number;
  nb_exigences: number;
  nb_eliminatoires: number;
};

/**
 * Selection commune a la liste et au detail. Les deux compteurs viennent
 * d'une agregation laterale : "pages lues sur total" doit rester juste meme
 * pendant que le worker ecrit les pages une a une.
 */
const SELECTION = `
  SELECT d.id, d.nom_fichier, d.chemin, d.nb_pages, d.statut, d.statut_extraction,
         d.hash_sha256, d.motif_echec, d.motif_extraction, d.cree_le,
         COALESCE(c.total, 0)    AS pages_enregistrees,
         COALESCE(c.lisibles, 0) AS pages_lisibles,
         COALESCE(e.total, 0)         AS nb_exigences,
         COALESCE(e.eliminatoires, 0) AS nb_eliminatoires
    FROM documents d
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE p.lisible)::int AS lisibles
        FROM pages p
       WHERE p.document_id = d.id
    ) c ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE r.type = 'eliminatoire')::int AS eliminatoires
        FROM requirements r
       WHERE r.document_id = d.id
    ) e ON true
`;

export async function routesDocuments(app: FastifyInstance): Promise<void> {
  /**
   * Depot d'un PDF. La reponse part des que le travail est en file :
   * l'extraction ne doit jamais bloquer l'api.
   *
   * Le contenu n'est pas juge ici. Un fichier qui n'est pas un PDF est
   * accepte, puis echoue dans le worker avec un motif visible dans la liste.
   */
  app.post("/documents", async (requete, reponse) => {
    const fichier = await requete.file();
    if (!fichier) {
      return reponse.code(400).send({ erreur: "aucun fichier recu dans la requete" });
    }

    const contenu = await fichier.toBuffer();
    if (contenu.length === 0) {
      return reponse.code(400).send({ erreur: "fichier vide" });
    }

    const hash = empreinte(contenu);

    // Deja connu : on renvoie le document existant sans relancer le traitement.
    const existant = await pool.query<LigneDocument>(
      `${SELECTION} WHERE d.hash_sha256 = $1`,
      [hash],
    );
    const dejaConnu = existant.rows[0];
    if (dejaConnu) {
      return reponse.code(200).send({ document: dejaConnu, dejaConnu: true });
    }

    const chemin = await ecrireDocument(hash, contenu);

    let id: string;
    try {
      const insere = await pool.query<{ id: string }>(
        `INSERT INTO documents (nom_fichier, chemin, hash_sha256, statut)
         VALUES ($1, $2, $3, 'recu')
         RETURNING id`,
        [fichier.filename, chemin, hash],
      );
      id = insere.rows[0]!.id;
    } catch (erreur) {
      // Course entre deux depots identiques : le perdant relit le gagnant.
      const code = (erreur as { code?: string }).code;
      if (code !== CODE_DOUBLON) throw erreur;
      const rattrape = await pool.query<LigneDocument>(
        `${SELECTION} WHERE d.hash_sha256 = $1`,
        [hash],
      );
      return reponse.code(200).send({ document: rattrape.rows[0], dejaConnu: true });
    }

    await fileIngestion.add("ingerer", { documentId: id, hash }, { jobId: id });

    const cree = await pool.query<LigneDocument>(`${SELECTION} WHERE d.id = $1`, [id]);
    return reponse.code(201).send({ document: cree.rows[0], dejaConnu: false });
  });

  app.get("/documents", async () => {
    const resultat = await pool.query<LigneDocument>(`${SELECTION} ORDER BY d.cree_le DESC`);
    return { documents: resultat.rows };
  });

  app.get<{ Params: { id: string } }>("/documents/:id", async (requete, reponse) => {
    const { id } = requete.params;
    if (!UUID.test(id)) {
      return reponse.code(400).send({ erreur: "identifiant invalide" });
    }
    const resultat = await pool.query<LigneDocument>(`${SELECTION} WHERE d.id = $1`, [id]);
    const document = resultat.rows[0];
    if (!document) {
      return reponse.code(404).send({ erreur: "document introuvable" });
    }
    return { document };
  });

  app.get<{ Params: { id: string } }>("/documents/:id/pages", async (requete, reponse) => {
    const { id } = requete.params;
    if (!UUID.test(id)) {
      return reponse.code(400).send({ erreur: "identifiant invalide" });
    }
    const existe = await pool.query(`SELECT 1 FROM documents WHERE id = $1`, [id]);
    if (existe.rowCount === 0) {
      return reponse.code(404).send({ erreur: "document introuvable" });
    }
    const pages = await pool.query(
      `SELECT id, numero, texte, nb_caracteres, source, lisible, motif_illisible
         FROM pages
        WHERE document_id = $1
        ORDER BY numero ASC`,
      [id],
    );
    return { pages: pages.rows };
  });
}
