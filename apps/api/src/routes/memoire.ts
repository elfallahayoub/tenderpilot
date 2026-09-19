import type { FastifyInstance } from "fastify";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { pool } from "../shared/db.js";
import { fileRedaction } from "../queue.js";
import { journaliser } from "../shared/journal.js";
import { AGENT_HUMAIN } from "../shared/types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LigneSection = {
  ordre: number;
  titre: string;
  contenu: string;
  statut: "redigee" | "a_completer";
  motif: string | null;
  contenu_humain: string | null;
  statut_revue: "a_revoir" | "validee" | "corrigee";
  revue_le: string | null;
  references_citees: string[];
  modele: string | null;
  tokens: number | null;
  tentatives: number;
};

/**
 * Memoire technique.
 *
 * La generation se declenche a la demande, jamais automatiquement : sept
 * appels par avis n'ont de sens ni sur un no-go, ni sur dix avis d'affilee.
 *
 * L'export DOCX RECOPIE ce qui est en base. Il ne rappelle aucun modele, ne
 * recalcule aucune valeur et ne masque aucune section : une section que les
 * garde-fous ont rejetee deux fois apparait marquee dans le document.
 */
export async function routesMemoire(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>("/documents/:id/memoire", async (requete, reponse) => {
    const { id } = requete.params;
    if (!UUID.test(id)) {
      return reponse.code(400).send({ erreur: "identifiant invalide" });
    }

    const document = await pool.query<{ statut_extraction: string; statut_memoire: string }>(
      `SELECT statut_extraction, statut_memoire FROM documents WHERE id = $1`,
      [id],
    );
    const ligne = document.rows[0];
    if (!ligne) {
      return reponse.code(404).send({ erreur: "document introuvable" });
    }
    if (ligne.statut_extraction !== "termine") {
      return reponse
        .code(409)
        .send({ erreur: "l'analyse de l'avis doit etre terminee avant de rediger le memoire" });
    }
    if (ligne.statut_memoire === "en_cours") {
      return reponse.code(202).send({ statut: "en_cours", message: "redaction deja en cours" });
    }

    await pool.query(
      `UPDATE documents SET statut_memoire = 'en_cours', motif_memoire = NULL WHERE id = $1`,
      [id],
    );
    // Pas de jobId fixe ici, contrairement aux files enchainees : BullMQ
    // refuserait le second travail tant que le premier reste en memoire, et le
    // bouton "Regenerer" ne ferait rien. La protection contre le double clic
    // est le statut en base, verifie juste au-dessus.
    await fileRedaction.add("rediger", { documentId: id });

    return reponse.code(202).send({ statut: "en_cours", message: "redaction mise en file" });
  });

  app.get<{ Params: { id: string } }>("/documents/:id/memoire", async (requete, reponse) => {
    const { id } = requete.params;
    if (!UUID.test(id)) {
      return reponse.code(400).send({ erreur: "identifiant invalide" });
    }

    const document = await pool.query<{ statut_memoire: string; motif_memoire: string | null }>(
      `SELECT statut_memoire, motif_memoire FROM documents WHERE id = $1`,
      [id],
    );
    if (document.rowCount === 0) {
      return reponse.code(404).send({ erreur: "document introuvable" });
    }

    const sections = await pool.query<LigneSection>(
      `SELECT ordre, titre,
              -- Le contenu effectif est celui de l humain quand il existe.
              COALESCE(contenu_humain, contenu) AS contenu,
              contenu_humain, statut_revue, revue_le,
              statut, motif, references_citees, modele, tokens, tentatives
         FROM sections_memoire WHERE document_id = $1 ORDER BY ordre`,
      [id],
    );

    return {
      statutMemoire: document.rows[0]!.statut_memoire,
      motifMemoire: document.rows[0]!.motif_memoire,
      sections: sections.rows,
    };
  });

  /**
   * Revue humaine d'une section : validation telle quelle, ou correction.
   *
   * Les deux actions protegent la section : une regeneration globale ne la
   * reecrira plus. Seul le bouton de regeneration de CETTE section, ci-dessous,
   * peut ecraser du travail humain, et il faut le demander.
   */
  app.put<{
    Params: { id: string; ordre: string };
    Body: { action: "valider" | "corriger"; contenu?: string };
  }>("/documents/:id/sections/:ordre", async (requete, reponse) => {
    const { id, ordre } = requete.params;
    const numero = Number(ordre);
    if (!UUID.test(id) || !Number.isInteger(numero)) {
      return reponse.code(400).send({ erreur: "identifiant ou numero de section invalide" });
    }

    const { action, contenu } = requete.body ?? { action: "valider" };
    if (action !== "valider" && action !== "corriger") {
      return reponse.code(400).send({ erreur: "action inconnue" });
    }
    if (action === "corriger" && (typeof contenu !== "string" || contenu.trim().length === 0)) {
      return reponse.code(400).send({ erreur: "une correction ne peut pas etre vide" });
    }

    const misAJour = await pool.query<{ titre: string }>(
      action === "valider"
        ? `UPDATE sections_memoire
              SET statut_revue = 'validee', revue_le = now()
            WHERE document_id = $1 AND ordre = $2
            RETURNING titre`
        : `UPDATE sections_memoire
              SET contenu_humain = $3, statut_revue = 'corrigee', revue_le = now()
            WHERE document_id = $1 AND ordre = $2
            RETURNING titre`,
      action === "valider" ? [id, numero] : [id, numero, contenu!.trim()],
    );

    const section = misAJour.rows[0];
    if (!section) {
      return reponse.code(404).send({ erreur: "section introuvable" });
    }

    // L'intervention humaine entre dans le journal au meme titre que les
    // etapes automatiques : la boucle humain-machine doit se voir.
    await journaliserIntervention(
      id,
      action === "valider" ? `validation : ${section.titre}` : `correction : ${section.titre}`,
      action === "valider"
        ? "section relue et validee telle quelle. Elle ne sera plus reecrite par une regeneration."
        : `section reecrite par l'humain, ${contenu!.trim().length} caracteres. ` +
          "Elle sera reinjectee dans le contexte des sections suivantes et des traitements suivants.",
    );

    return { statut: action === "valider" ? "validee" : "corrigee" };
  });

  /**
   * Regeneration d'UNE section, y compris si elle porte du travail humain.
   * C'est le seul chemin qui ecrase une correction, et il est explicite.
   */
  app.post<{ Params: { id: string; ordre: string } }>(
    "/documents/:id/sections/:ordre/regenerer",
    async (requete, reponse) => {
      const { id, ordre } = requete.params;
      const numero = Number(ordre);
      if (!UUID.test(id) || !Number.isInteger(numero)) {
        return reponse.code(400).send({ erreur: "identifiant ou numero de section invalide" });
      }

      const section = await pool.query<{ titre: string; statut_revue: string }>(
        `SELECT titre, statut_revue FROM sections_memoire WHERE document_id = $1 AND ordre = $2`,
        [id, numero],
      );
      if (section.rowCount === 0) {
        return reponse.code(404).send({ erreur: "section introuvable" });
      }

      // On repasse la section en "a_revoir" et on efface la correction : le
      // Writer ne saute que ce qui porte du travail humain.
      await pool.query(
        `UPDATE sections_memoire
            SET statut_revue = 'a_revoir', contenu_humain = NULL, revue_le = NULL
          WHERE document_id = $1 AND ordre = $2`,
        [id, numero],
      );
      await pool.query(
        `UPDATE documents SET statut_memoire = 'en_cours', motif_memoire = NULL WHERE id = $1`,
        [id],
      );
      await fileRedaction.add("rediger", { documentId: id });

      await journaliserIntervention(
        id,
        `regeneration demandee : ${section.rows[0]!.titre}`,
        section.rows[0]!.statut_revue === "corrigee"
          ? "l'humain demande explicitement d'ecraser sa propre correction"
          : "l'humain demande une nouvelle redaction de cette section",
      );

      return reponse.code(202).send({ statut: "en_cours" });
    },
  );

  /** Export DOCX. Le Reporter recopie, il ne recalcule jamais. */
  app.get<{ Params: { id: string } }>("/documents/:id/memoire.docx", async (requete, reponse) => {
    const { id } = requete.params;
    if (!UUID.test(id)) {
      return reponse.code(400).send({ erreur: "identifiant invalide" });
    }

    const document = await pool.query<{
      nom_fichier: string;
      verdict: string | null;
      reserve: string | null;
    }>(`SELECT nom_fichier, verdict, reserve FROM documents WHERE id = $1`, [id]);
    const avis = document.rows[0];
    if (!avis) {
      return reponse.code(404).send({ erreur: "document introuvable" });
    }

    const sections = await pool.query<LigneSection>(
      `SELECT ordre, titre,
              COALESCE(contenu_humain, contenu) AS contenu,
              contenu_humain, statut_revue, revue_le,
              statut, motif, references_citees
         FROM sections_memoire WHERE document_id = $1 ORDER BY ordre`,
      [id],
    );
    if (sections.rowCount === 0) {
      return reponse
        .code(409)
        .send({ erreur: "aucune section redigee : generer le memoire avant de l'exporter" });
    }

    const octets = await construireDocx(avis, sections.rows);
    const nom = `memoire-${avis.nom_fichier.replace(/\.pdf$/i, "")}.docx`;

    return reponse
      .header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      )
      .header("Content-Disposition", `attachment; filename="${nom}"`)
      .send(octets);
  });
}

/**
 * Une intervention humaine dans le journal d'agent.
 *
 * L'agent vaut "humain" et le modele est nul : ce n'est ni un appel au modele
 * ni une etape de code, c'est une decision de la personne qui relit. Le
 * panneau la distingue visuellement des deux autres.
 */
async function journaliserIntervention(
  documentId: string,
  etape: string,
  detail: string,
): Promise<void> {
  await journaliser({
    runId: documentId,
    agent: AGENT_HUMAIN,
    etape,
    modele: null,
    tokens: null,
    dureeMs: 0,
    statut: "succes",
    detail,
  });
}

/**
 * Page de garde puis sections.
 *
 * La page de garde porte l'avis concerne, la date de generation et la mention
 * de brouillon. Un memoire exporte qui circulerait sans cette mention serait un
 * piege pour celui qui le recoit.
 */
async function construireDocx(
  avis: { nom_fichier: string; verdict: string | null; reserve: string | null },
  sections: LigneSection[],
): Promise<Buffer> {
  const aujourdhui = new Date().toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const aCompleter = sections.filter((section) => section.statut === "a_completer");

  const contenu: Paragraph[] = [
    new Paragraph({ text: "MÉMOIRE TECHNIQUE", heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [new TextRun({ text: "ATLAS DIGITAL SERVICES SARL", bold: true, size: 26 })],
    }),
    new Paragraph({ text: "" }),
    new Paragraph({ text: `Avis concerné : ${avis.nom_fichier}` }),
    new Paragraph({ text: `Document généré le ${aujourdhui}` }),
    new Paragraph({
      text: `Verdict de qualification : ${
        avis.verdict === "no_go" ? "NO-GO" : avis.verdict === "go" ? "GO" : "non rendu"
      }${avis.reserve ? " (sous réserve)" : ""}`,
    }),
    new Paragraph({ text: "" }),

    new Paragraph({
      children: [
        new TextRun({
          text: "BROUILLON À RELIRE AVANT TOUT USAGE.",
          bold: true,
          allCaps: true,
        }),
      ],
    }),
    new Paragraph({
      text:
        "Ce document a été rédigé automatiquement à partir des exigences extraites de " +
        "l'avis et des références réelles de l'entreprise. Il n'a pas été relu par un " +
        "humain. Aucune de ses phrases ne doit être soumise en l'état.",
    }),
  ];

  if (aCompleter.length > 0) {
    contenu.push(
      new Paragraph({ text: "" }),
      new Paragraph({
        children: [
          new TextRun({
            text: `${aCompleter.length} section${aCompleter.length > 1 ? "s" : ""} n'a${
              aCompleter.length > 1 ? "" : ""
            } pas pu être sourcée et reste à compléter : ${aCompleter
              .map((section) => section.titre)
              .join(", ")}.`,
            bold: true,
          }),
        ],
      }),
    );
  }

  for (const section of sections) {
    contenu.push(
      new Paragraph({ text: "" }),
      new Paragraph({ text: section.titre, heading: HeadingLevel.HEADING_1 }),
    );

    if (section.statut === "a_completer") {
      // Marquee, jamais omise : un trou annonce vaut mieux qu'un trou masque.
      contenu.push(
        new Paragraph({
          children: [
            new TextRun({
              text: "[À COMPLÉTER PAR L'HUMAIN]",
              bold: true,
            }),
          ],
        }),
        new Paragraph({
          text: `Cette section n'a pas pu être rédigée avec les garanties requises. Motif : ${
            section.motif ?? "non précisé"
          }.`,
        }),
      );
      continue;
    }

    for (const paragraphe of section.contenu.split("\n\n")) {
      if (paragraphe.trim().length > 0) contenu.push(new Paragraph({ text: paragraphe.trim() }));
    }

    if (section.references_citees.length > 0) {
      contenu.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `Références citées : ${section.references_citees.join(", ")}.`,
              italics: true,
            }),
          ],
        }),
      );
    }
  }

  return Packer.toBuffer(new Document({ sections: [{ children: contenu }] }));
}
