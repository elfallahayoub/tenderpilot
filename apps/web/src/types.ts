export type EtatDependance = {
  ok: boolean;
  latenceMs: number;
  detail: string | null;
};

export type Sante = {
  statut: "ok" | "degrade";
  service: string;
  horodatage: string;
  postgres: EtatDependance;
  redis: EtatDependance;
  variablesManquantes: string[];
};

export type StatutDocument = "recu" | "en_cours" | "traite" | "echec";

export type Document = {
  id: string;
  nom_fichier: string;
  chemin: string;
  nb_pages: number | null;
  statut: StatutDocument;
  hash_sha256: string;
  motif_echec: string | null;
  cree_le: string;
  pages_enregistrees: number;
  pages_lisibles: number;
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

/** Un document est encore en mouvement tant qu'il n'est ni traite ni en echec. */
export function enCours(document: Document): boolean {
  return document.statut === "recu" || document.statut === "en_cours";
}

export const LIBELLE_STATUT: Record<StatutDocument, string> = {
  recu: "en file",
  en_cours: "traitement",
  traite: "traite",
  echec: "echec",
};
