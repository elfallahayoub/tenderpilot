import { pool } from "./db.js";
import type { StatutEvenement } from "./types.js";

/**
 * Journal d'agent. Une ligne par etape, persistee, donc rejouable apres coup.
 *
 * C'est la matiere du panneau lateral de la tranche 5, la preuve du routage des
 * modeles, et la source des chiffres de la page Qualite de la tranche 9 :
 * `modele` et `tokens` y sont les valeurs reelles renvoyees par le service,
 * jamais une estimation. `modele` vaut null quand l'etape est du code pur.
 */
export type Evenement = {
  runId: string;
  agent: string;
  etape: string;
  modele: string | null;
  tokens: number | null;
  dureeMs: number;
  statut: StatutEvenement;
  detail: string;
};

export async function journaliser(evenement: Evenement): Promise<void> {
  await pool.query(
    `INSERT INTO agent_events (run_id, agent, etape, modele, tokens, duree_ms, statut, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      evenement.runId,
      evenement.agent,
      evenement.etape,
      evenement.modele,
      evenement.tokens,
      evenement.dureeMs,
      evenement.statut,
      evenement.detail,
    ],
  );
}

/**
 * Journalisation qui ne doit jamais masquer l'erreur qu'elle decrit.
 * Si Postgres est lui-meme en panne, l'ecriture echouerait a son tour : on
 * l'affiche alors bruyamment et on laisse l'erreur d'origine remonter.
 */
export async function journaliserSansBloquer(evenement: Evenement): Promise<void> {
  try {
    await journaliser(evenement);
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    console.error(
      `[journal] PERDU pour ${evenement.runId} (${evenement.etape}) : ${message}`,
    );
  }
}
