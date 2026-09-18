import { pool } from "./db.js";

/**
 * Ecriture du journal d'agent. Une ligne par etape, persistee, donc rejouable
 * apres coup. C'est la matiere du panneau lateral de la tranche 5 et la preuve
 * du routage des modeles : modele vaut null quand l'etape est du code pur.
 */
export type StatutEvenement = "succes" | "echec" | "reprise" | "escalade";

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
