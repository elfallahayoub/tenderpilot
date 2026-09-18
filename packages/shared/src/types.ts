/**
 * Contrats de données partagés par l'api, le worker et l'interface.
 *
 * Ce fichier est monte dans les trois services a /app/src/shared : il n'existe
 * qu'une seule definition de chaque forme, et toute divergence est impossible.
 * Il ne doit dependre d'aucun paquet, pour rester importable par le navigateur.
 */

// --- Documents et pages -----------------------------------------------------

export type StatutDocument = "recu" | "en_cours" | "traite" | "echec";

export type StatutExtraction = "en_attente" | "en_cours" | "termine" | "echec";

export type Document = {
  id: string;
  nom_fichier: string;
  chemin: string;
  nb_pages: number | null;
  statut: StatutDocument;
  statut_extraction: StatutExtraction;
  hash_sha256: string;
  motif_echec: string | null;
  motif_extraction: string | null;
  cree_le: string;
  pages_enregistrees: number;
  pages_lisibles: number;
  nb_exigences: number;
  nb_eliminatoires: number;
};

export type Page = {
  id: string;
  numero: number;
  texte: string;
  nb_caracteres: number;
  source: "texte" | "ocr";
  lisible: boolean;
  motif_illisible: string | null;
};

// --- Exigences --------------------------------------------------------------

export type TypeExigence = "obligatoire" | "optionnelle" | "eliminatoire";

export type CategorieExigence =
  | "administratif"
  | "financier"
  | "technique"
  | "equipe"
  | "delai";

/**
 * Forme machine d'une exigence. Chaque variante a une fonction d'evaluation
 * pure en TypeScript, testee unitairement : c'est le coeur de la fiabilite.
 *
 * Tous les nombres presents ici ont ete produits par normaliserNombre, jamais
 * par le modele (regle 8 du CLAUDE.md).
 */
export type Fait =
  | { kind: "chiffre_affaires_min"; valeur: number }
  | { kind: "effectif_min"; valeur: number }
  | { kind: "certification_requise"; nom: string }
  | { kind: "references_min"; nombre: number; secteur: string; anneesMax: number }
  | { kind: "profil_equipe"; poste: string; nombre: number; experienceMin: number }
  | { kind: "attestation_requise"; nom: string }
  | { kind: "note_technique_min"; valeur: number; sur: number };

export type KindFait = Fait["kind"];

export type Requirement = {
  id: string;
  texte: string;
  citation: string;
  page: number;
  article: string | null;
  type: TypeExigence;
  categorie: CategorieExigence;
  fait: Fait | null;
  /** Calculee par le code a partir de signaux objectifs, jamais par le modele. */
  confiance: number;
  /** Detail du calcul, pour que le score soit explicable a l ecran. */
  confiance_detail: string | null;
};

// --- Journal d'agent --------------------------------------------------------

export type StatutEvenement = "succes" | "echec" | "reprise" | "escalade";

export type AgentEvent = {
  id: string;
  runId: string;
  horodatage: string;
  agent: string;
  etape: string;
  modele: string | null;
  tokens: number | null;
  dureeMs: number;
  statut: StatutEvenement;
  detail: string;
};

/**
 * Libelle d'etape reserve au rejet d'une exigence dont la citation est
 * introuvable dans la page annoncee. C'est l'indicateur d'hallucination :
 * la page Qualite de la tranche 9 le compte en filtrant sur cette valeur
 * exacte, elle ne doit donc jamais etre reformulee.
 */
export const ETAPE_CITATION_INTROUVABLE = "exigence rejetee : citation introuvable";

/** Ordre d'affichage : ce qui peut eliminer une offre passe en premier. */
export const ORDRE_TYPE: Record<TypeExigence, number> = {
  eliminatoire: 0,
  obligatoire: 1,
  optionnelle: 2,
};

export const LIBELLE_CATEGORIE: Record<CategorieExigence, string> = {
  administratif: "Administratif",
  financier: "Financier",
  technique: "Technique",
  equipe: "Equipe",
  delai: "Delais",
};
