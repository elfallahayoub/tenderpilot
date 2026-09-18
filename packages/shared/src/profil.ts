import { pool } from "./db.js";
import type { MembreEquipe, Profil, ReferenceClient } from "./regles.js";

/**
 * Lecture du profil d'entreprise depuis la base.
 *
 * C'est l'appel d'outil du Qualifier. Le profil, les 24 references et les 14 CV
 * ne sont JAMAIS recopies dans un prompt : ils entrent dans le moteur de
 * regles, qui compare en TypeScript. Le jury verifie ce point.
 */

type LigneProfil = {
  raison_sociale: string;
  effectif: number;
  chiffre_affaires: Record<string, number>;
  certifications: string[];
  attestations: string[];
};

export class ProfilAbsent extends Error {
  constructor() {
    super("aucun profil d'entreprise en base : lancer npm run seed");
    this.name = "ProfilAbsent";
  }
}

export async function lireProfil(): Promise<Profil> {
  const profil = await pool.query<LigneProfil>(
    `SELECT raison_sociale, effectif, chiffre_affaires, certifications, attestations
       FROM profil_entreprise WHERE id = 1`,
  );
  const ligne = profil.rows[0];
  if (!ligne) throw new ProfilAbsent();

  const references = await pool.query<{
    id: string;
    client: string;
    secteur: string;
    objet: string;
    montant_ht_mad: string;
    annee_debut: number;
    duree_mois: number;
    attestation_bonne_execution: boolean;
  }>(
    `SELECT id, client, secteur, objet, montant_ht_mad, annee_debut, duree_mois,
            attestation_bonne_execution
       FROM references_client ORDER BY id`,
  );

  const equipe = await pool.query<{
    id: string;
    initiales: string;
    poste: string;
    annees_experience: number;
  }>(`SELECT id, initiales, poste, annees_experience FROM equipe ORDER BY id`);

  return {
    raisonSociale: ligne.raison_sociale,
    effectif: ligne.effectif,
    chiffreAffaires: ligne.chiffre_affaires,
    certifications: ligne.certifications,
    attestations: ligne.attestations,
    references: references.rows.map(
      (ligneReference): ReferenceClient => ({
        id: ligneReference.id,
        client: ligneReference.client,
        secteur: ligneReference.secteur,
        objet: ligneReference.objet,
        // bigint revient en chaine depuis pg.
        montantHtMad: Number(ligneReference.montant_ht_mad),
        anneeDebut: ligneReference.annee_debut,
        dureeMois: ligneReference.duree_mois,
        attestationBonneExecution: ligneReference.attestation_bonne_execution,
      }),
    ),
    equipe: equipe.rows.map(
      (ligneMembre): MembreEquipe => ({
        id: ligneMembre.id,
        initiales: ligneMembre.initiales,
        poste: ligneMembre.poste,
        anneesExperience: ligneMembre.annees_experience,
      }),
    ),
  };
}
