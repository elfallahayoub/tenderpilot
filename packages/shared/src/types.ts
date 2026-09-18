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

export type Verdict = "go" | "no_go";

export type Document = {
  id: string;
  nom_fichier: string;
  chemin: string;
  nb_pages: number | null;
  statut: StatutDocument;
  statut_extraction: StatutExtraction;
  statut_qualification: StatutExtraction;
  /** Produit par le moteur de regles, jamais par un modele. */
  verdict: Verdict | null;
  annee_reference: number | null;
  origine_annee_reference: string | null;
  hash_sha256: string;
  motif_echec: string | null;
  motif_extraction: string | null;
  motif_qualification: string | null;
  /** Etabli a partir de la composition annoncee par le document lui-meme. */
  complet: boolean | null;
  composantes_manquantes: string[] | null;
  /** Non nul quand le verdict ne peut pas etre tenu pour franc. */
  reserve: string | null;
  cree_le: string;
  pages_enregistrees: number;
  pages_lisibles: number;
  nb_exigences: number;
  nb_eliminatoires: number;
  nb_bloquants: number;
  nb_indetermines: number;
};

export type Page = {
  id: string;
  numero: number;
  texte: string;
  nb_caracteres: number;
  source: "texte" | "ocr";
  lisible: boolean;
  motif_illisible: string | null;
  /** Confiance moyenne de Tesseract sur 100. Null pour une couche texte. */
  qualite_ocr: number | null;
  duree_ocr_ms: number | null;
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

  // --- Evaluation, renseignee une fois la qualification passee -------------

  statut_evaluation: StatutEvaluation | null;
  /** Preuve chiffree produite par le moteur de regles. */
  preuve: string | null;
  bloquant: boolean | null;
  /** Part revenant au code et part revenant a un modele. */
  origine: OrigineEvaluation | null;
  modele: string | null;
};

export type StatutEvaluation = "satisfait" | "non_satisfait" | "indetermine";

export type OrigineEvaluation =
  | "deterministe"
  | "normalisation_gpt41"
  | "arbitrage_gpt55"
  | "non_evaluable";

export const LIBELLE_ORIGINE: Record<OrigineEvaluation, string> = {
  deterministe: "moteur de regles, code seul",
  normalisation_gpt41: "fait normalise par gpt-4.1, verdict par le code",
  arbitrage_gpt55: "equivalence arbitree par gpt-5.5, verdict par le code",
  non_evaluable: "non evaluable automatiquement",
};

export const LIBELLE_STATUT_EVALUATION: Record<StatutEvaluation, string> = {
  satisfait: "satisfait",
  non_satisfait: "non satisfait",
  indetermine: "indetermine",
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
 * Prefixe des etapes d'OCR. Le recapitulatif agrege le temps de
 * reconnaissance en filtrant dessus : la chaine est donc definie ici et
 * utilisee des deux cotes, jamais recopiee.
 */
export const PREFIXE_ETAPE_OCR = "OCR page ";

/** Libelle affiche a la place du modele quand l'etape est du code pur. */
export const LIBELLE_CODE_SEUL = "code seul";

/** Un evenement tel que l'interface le recoit, decalage calcule. */
export type EvenementJournal = {
  sequence: number;
  horodatage: string;
  agent: string;
  etape: string;
  modele: string | null;
  tokens: number | null;
  dureeMs: number;
  statut: StatutEvenement;
  detail: string;
  /** Millisecondes ecoulees depuis le premier evenement du traitement. */
  decalageMs: number;
};

export type LigneModele = {
  /** "gpt-4.1", "gpt-5.5", ou LIBELLE_CODE_SEUL. */
  modele: string;
  appels: number;
  jetons: number;
};

/**
 * Recapitulatif d'un traitement, calcule depuis agent_events.
 *
 * Les trois durees affichees ne se recouvrent pas et se lisent ensemble :
 * `dureeTotaleMs` va du premier au dernier evenement, attente en file
 * comprise ; `tempsModelesMs` est le temps passe dans les modeles ;
 * `tempsOcrMs` celui passe en reconnaissance optique.
 *
 * On ne somme PAS toutes les durees d'etape : les etapes de synthese, comme
 * "extraction terminee", portent la duree de tout ce qu'elles resument, et le
 * total depasserait la duree reelle.
 */
export type Recapitulatif = {
  evenements: number;
  dureeTotaleMs: number;
  tempsModelesMs: number;
  parModele: LigneModele[];
  /** Appels ayant reellement consomme des jetons. */
  appelsFactures: number;
  /** Appels resolus par le cache Redis, donc gratuits. */
  appelsServisParLeCache: number;
  etapesCodeSeul: number;
  tempsOcrMs: number;
  /** Indicateur d'hallucination : exigences rejetees faute de citation. */
  citationsRejetees: number;
  reprises: number;
  escalades: number;
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
