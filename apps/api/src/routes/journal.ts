import type { FastifyInstance } from "fastify";
import { pool } from "../shared/db.js";
import {
  ETAPE_CITATION_INTROUVABLE,
  LIBELLE_CODE_SEUL,
  PREFIXE_ETAPE_OCR,
  type EvenementJournal,
  type LigneModele,
  type Recapitulatif,
} from "../shared/types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Journal d'agent d'un traitement.
 *
 * Tout le raisonnement du systeme est deja ecrit dans agent_events. Cette
 * route ne fait que le rendre lisible : elle n'ajoute aucune interpretation.
 *
 * Le run est l'identifiant du document, donc le journal de n'importe quel
 * document deja traite se relit tel quel, meme des semaines plus tard. L'ordre
 * vient de la colonne `sequence`, qui garantit un rejeu a l'identique :
 * l'horodatage seul ne le garantirait pas.
 */
export async function routesJournal(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { depuis?: string } }>(
    "/documents/:id/journal",
    async (requete, reponse) => {
      const { id } = requete.params;
      if (!UUID.test(id)) {
        return reponse.code(400).send({ erreur: "identifiant invalide" });
      }

      const existe = await pool.query(`SELECT 1 FROM documents WHERE id = $1`, [id]);
      if (existe.rowCount === 0) {
        return reponse.code(404).send({ erreur: "document introuvable" });
      }

      // Sondage incremental : seuls les evenements plus recents que la
      // derniere sequence connue redescendent.
      const depuis = Number(requete.query.depuis ?? 0);
      const apres = Number.isFinite(depuis) && depuis > 0 ? Math.floor(depuis) : 0;

      const evenements = await pool.query<EvenementJournal>(
        `SELECT a.sequence::int                             AS "sequence",
                a.horodatage,
                a.agent,
                a.etape,
                a.modele,
                a.tokens,
                a.duree_ms                                  AS "dureeMs",
                a.statut,
                a.detail,
                COALESCE(
                  round(
                    extract(epoch from (a.horodatage - premier.debut)) * 1000
                  )::int,
                  0
                )                                           AS "decalageMs"
           FROM agent_events a
           CROSS JOIN LATERAL (
             SELECT min(horodatage) AS debut FROM agent_events WHERE run_id = $1
           ) premier
          WHERE a.run_id = $1 AND a.sequence > $2
          ORDER BY a.sequence ASC`,
        [id, apres],
      );

      return {
        evenements: evenements.rows,
        recapitulatif: await recapituler(id),
        // Aucun evenement nouveau : on garde la borne connue du client.
        derniereSequence:
          evenements.rows.length > 0
            ? evenements.rows[evenements.rows.length - 1]!.sequence
            : apres,
      };
    },
  );
}

/**
 * Recapitulatif calcule sur la totalite du run, jamais sur le seul increment :
 * les chiffres en tete du panneau doivent rester justes a chaque rafraichissement.
 */
async function recapituler(documentId: string): Promise<Recapitulatif> {
  const totaux = await pool.query<{
    evenements: number;
    dureeTotaleMs: number;
    tempsModelesMs: number;
    appelsFactures: number;
    appelsServisParLeCache: number;
    etapesCodeSeul: number;
    tempsOcrMs: number;
    citationsRejetees: number;
    reprises: number;
    escalades: number;
  }>(
    `SELECT count(*)::int AS "evenements",
            COALESCE(round(extract(epoch from (max(horodatage) - min(horodatage))) * 1000), 0)::int
              AS "dureeTotaleMs",
            -- Somme des seules durees d appel au modele. Les etapes de
            -- synthese portent la duree de ce qu elles resument : les
            -- additionner toutes depasserait la duree reelle du traitement.
            COALESCE(sum(duree_ms) FILTER (WHERE modele IS NOT NULL), 0)::int AS "tempsModelesMs",
            -- Un appel reel consomme des jetons ; un appel servi par le cache
            -- est journalise avec zero jeton. La distinction se lit a l'ecran.
            count(*) FILTER (WHERE modele IS NOT NULL AND COALESCE(tokens, 0) > 0)::int
              AS "appelsFactures",
            count(*) FILTER (WHERE modele IS NOT NULL AND COALESCE(tokens, 0) = 0)::int
              AS "appelsServisParLeCache",
            count(*) FILTER (WHERE modele IS NULL)::int AS "etapesCodeSeul",
            COALESCE(sum(duree_ms) FILTER (WHERE etape LIKE $2), 0)::int AS "tempsOcrMs",
            count(*) FILTER (WHERE etape = $3)::int AS "citationsRejetees",
            count(*) FILTER (WHERE statut = 'reprise')::int AS "reprises",
            count(*) FILTER (WHERE statut = 'escalade')::int AS "escalades"
       FROM agent_events
      WHERE run_id = $1`,
    [documentId, `${PREFIXE_ETAPE_OCR}%`, ETAPE_CITATION_INTROUVABLE],
  );

  // Appels et jetons par modele : c'est cette ligne qui chiffre le routage.
  const parModele = await pool.query<LigneModele>(
    `SELECT COALESCE(modele, $2)     AS "modele",
            count(*)::int            AS "appels",
            COALESCE(sum(tokens), 0)::int AS "jetons"
       FROM agent_events
      WHERE run_id = $1
      GROUP BY 1
      ORDER BY (COALESCE(modele, $2) = $2), 1`,
    [documentId, LIBELLE_CODE_SEUL],
  );

  return { ...totaux.rows[0]!, parModele: parModele.rows };
}
