import { readFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";
import { pool, fermerPostgres } from "./shared/db.js";
import { calculerEmbedding, fermerLlm, versVecteurSql } from "./shared/llm.js";
import { retirerLesNombres } from "./shared/chiffres.js";

/**
 * Chargement du profil d'entreprise en base, depuis le jeu de donnees fourni.
 *
 * Idempotent : relancer le script remplace les lignes existantes sans creer de
 * doublon. C'est la seule porte d'entree de ces donnees dans le systeme, et
 * elles n'en ressortent que par le moteur de regles, jamais par un prompt.
 *
 *   npm run seed
 */

const CHEMIN = process.env.CHEMIN_PROFIL ?? "/app/data/sujet-01-tenderpilot/profil-entreprise.json";

type ProfilJson = {
  raison_sociale: string;
  effectif: number;
  chiffre_affaires_ht_mad: Record<string, number>;
  certifications: string[];
  attestations_disponibles: string[];
  secteurs_couverts: string[];
  references: {
    id: string;
    client: string;
    secteur: string;
    objet: string;
    montant_ht_mad: number;
    annee_debut: number;
    duree_mois: number;
    attestation_bonne_execution: boolean;
  }[];
  equipe: {
    id: string;
    initiales: string;
    poste: string;
    annees_experience: number;
    diplome?: string;
    certifications?: string;
    langues?: string;
  }[];
};

async function charger(): Promise<void> {
  const brut = await readFile(CHEMIN, "utf8");
  const profil = JSON.parse(brut) as ProfilJson;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO profil_entreprise
         (id, raison_sociale, effectif, chiffre_affaires, certifications, attestations, secteurs)
       VALUES (1, $1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET raison_sociale = EXCLUDED.raison_sociale,
             effectif       = EXCLUDED.effectif,
             chiffre_affaires = EXCLUDED.chiffre_affaires,
             certifications = EXCLUDED.certifications,
             attestations   = EXCLUDED.attestations,
             secteurs       = EXCLUDED.secteurs,
             charge_le      = now()`,
      [
        profil.raison_sociale,
        profil.effectif,
        JSON.stringify(profil.chiffre_affaires_ht_mad),
        profil.certifications,
        profil.attestations_disponibles,
        profil.secteurs_couverts,
      ],
    );

    for (const reference of profil.references) {
      await client.query(
        `INSERT INTO references_client
           (id, client, secteur, objet, montant_ht_mad, annee_debut, duree_mois,
            attestation_bonne_execution)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE
           SET client = EXCLUDED.client,
               secteur = EXCLUDED.secteur,
               objet = EXCLUDED.objet,
               montant_ht_mad = EXCLUDED.montant_ht_mad,
               annee_debut = EXCLUDED.annee_debut,
               duree_mois = EXCLUDED.duree_mois,
               attestation_bonne_execution = EXCLUDED.attestation_bonne_execution`,
        [
          reference.id,
          reference.client,
          reference.secteur,
          reference.objet,
          reference.montant_ht_mad,
          reference.annee_debut,
          reference.duree_mois,
          reference.attestation_bonne_execution,
        ],
      );
    }

    for (const membre of profil.equipe) {
      await client.query(
        `INSERT INTO equipe (id, initiales, poste, annees_experience, diplome, certifications, langues)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE
           SET initiales = EXCLUDED.initiales,
               poste = EXCLUDED.poste,
               annees_experience = EXCLUDED.annees_experience,
               diplome = EXCLUDED.diplome,
               certifications = EXCLUDED.certifications,
               langues = EXCLUDED.langues`,
        [
          membre.id,
          membre.initiales,
          membre.poste,
          membre.annees_experience,
          membre.diplome ?? null,
          membre.certifications ?? null,
          membre.langues ?? null,
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

  console.log(
    `[seed] ${profil.raison_sociale} : effectif ${profil.effectif}, ` +
      `${profil.certifications.length} certifications, ${profil.attestations_disponibles.length} attestations, ` +
      `${profil.references.length} references, ${profil.equipe.length} CV`,
  );
}

const DOSSIER_OFFRES =
  process.env.DOSSIER_OFFRES ?? "/app/data/sujet-01-tenderpilot/offres-passees";

/** Titres de section des memoires deja rendus, dans leur ordre d'apparition. */
const TITRES_SECTION = [
  "Compréhension du besoin",
  "Méthodologie proposée",
  "Organisation et gouvernance",
  "Plan d'assurance qualité",
  "Transfert de compétences",
];

/**
 * Decoupe un memoire deja rendu en sections, sur ses titres connus.
 * Les chiffres sont retires : ces extraits servent de gabarit de style, et le
 * montant d'un ancien marche n'a rien a faire dans un nouveau memoire.
 */
function decouperEnSections(texte: string): { section: string; texte: string }[] {
  const positions = TITRES_SECTION.map((titre) => ({ titre, index: texte.indexOf(titre) })).filter(
    (p) => p.index >= 0,
  );
  positions.sort((a, b) => a.index - b.index);

  return positions.map((position, rang) => {
    const fin = rang + 1 < positions.length ? positions[rang + 1]!.index : texte.length;
    return {
      section: position.titre,
      texte: retirerLesNombres(texte.slice(position.index, fin).trim()),
    };
  });
}

/**
 * Embeddings, calcules UNE SEULE FOIS puis stockes.
 * Une reference ou un extrait qui possede deja son vecteur n'est pas recalcule :
 * relancer le seed ne refacture rien.
 */
async function vectoriser(): Promise<void> {
  // --- extraits de style des memoires deja rendus --------------------------
  for (const source of ["memoire-technique-1", "memoire-technique-2"]) {
    const donnees = new Uint8Array(await readFile(`${DOSSIER_OFFRES}/${source}.pdf`));
    const pdf = await getDocumentProxy(donnees);
    const { text } = await extractText(pdf, { mergePages: false });

    for (const extrait of decouperEnSections(text.join("\n"))) {
      await pool.query(
        `INSERT INTO extraits_offres_passees (source, section, texte)
         VALUES ($1, $2, $3)
         ON CONFLICT (source, section) DO UPDATE SET texte = EXCLUDED.texte`,
        [source, extrait.section, extrait.texte],
      );
    }
  }

  const extraits = await pool.query<{ id: string; section: string; texte: string }>(
    `SELECT id, section, texte FROM extraits_offres_passees WHERE embedding IS NULL`,
  );
  for (const extrait of extraits.rows) {
    const vecteur = await calculerEmbedding(`${extrait.section}. ${extrait.texte}`);
    await pool.query(`UPDATE extraits_offres_passees SET embedding = $2 WHERE id = $1`, [
      extrait.id,
      versVecteurSql(vecteur),
    ]);
  }

  // --- references clients ---------------------------------------------------
  const references = await pool.query<{ id: string; client: string; secteur: string; objet: string }>(
    `SELECT id, client, secteur, objet FROM references_client WHERE embedding IS NULL ORDER BY id`,
  );
  for (const reference of references.rows) {
    const vecteur = await calculerEmbedding(
      `${reference.objet}. Secteur ${reference.secteur}. Client ${reference.client}.`,
    );
    await pool.query(`UPDATE references_client SET embedding = $2 WHERE id = $1`, [
      reference.id,
      versVecteurSql(vecteur),
    ]);
  }

  console.log(
    `[seed] embeddings : ${extraits.rowCount} extraits de style et ${references.rowCount} references vectorises` +
      (extraits.rowCount === 0 && references.rowCount === 0 ? " (tout etait deja en base)" : ""),
  );
}

try {
  await charger();
  await vectoriser();
} catch (erreur) {
  // Aucune erreur n'est avalee : un seed rate doit se voir immediatement,
  // sinon le moteur de regles travaillerait sur un profil incomplet.
  console.error("[seed] echec :", erreur instanceof Error ? erreur.message : String(erreur));
  await Promise.allSettled([fermerPostgres(), fermerLlm()]);
  process.exit(1);
}

await Promise.allSettled([fermerPostgres(), fermerLlm()]);
