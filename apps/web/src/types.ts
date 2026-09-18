/**
 * L'interface n'a plus de definitions propres : elle reutilise les contrats
 * partages, montes depuis packages/shared. Elle n'importe que `types`, jamais
 * le pool Postgres ni le module de modele, qui n'ont rien a faire dans un
 * navigateur.
 */
export type {
  CategorieExigence,
  Document,
  Fait,
  OrigineEvaluation,
  Page,
  Requirement,
  StatutDocument,
  StatutEvaluation,
  StatutExtraction,
  TypeExigence,
  Verdict,
} from "./shared/types";

export {
  LIBELLE_CATEGORIE,
  LIBELLE_ORIGINE,
  LIBELLE_STATUT_EVALUATION,
  ORDRE_TYPE,
} from "./shared/types";

import type { Document, StatutDocument, StatutExtraction } from "./shared/types";

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

export type PageNonLue = {
  numero: number;
  motif: string;
};

export type PageOcr = {
  numero: number;
  qualite: number | null;
};

export type Couverture = {
  pagesTotal: number;
  pagesLues: number;
  pagesNonLues: PageNonLue[];
  /** Pages lues par reconnaissance optique, avec leur qualite sur 100. */
  pagesOcr: PageOcr[];
};

/** Un document est encore en mouvement tant que la chaine n'est pas achevee. */
export function enCours(document: Document): boolean {
  if (document.statut === "recu" || document.statut === "en_cours") return true;
  if (document.statut === "echec") return false;
  if (document.statut_extraction === "en_attente" || document.statut_extraction === "en_cours") {
    return true;
  }
  if (document.statut_extraction === "echec") return false;
  return (
    document.statut_qualification === "en_attente" || document.statut_qualification === "en_cours"
  );
}

/**
 * "lu" etait trompeur : un scan integralement illisible affichait "lu" alors
 * que rien ne l'avait ete. Le statut dit desormais ce qui s'est passe, et la
 * couverture reelle est donnee a part.
 */
export const LIBELLE_STATUT: Record<StatutDocument, string> = {
  recu: "en file",
  en_cours: "lecture en cours",
  traite: "traite",
  echec: "echec",
};

/** Ce que l'on peut honnetement dire de la lecture d'un document. */
export function libelleCouverture(document: Document): string {
  const total = document.nb_pages ?? document.pages_enregistrees;
  if (total === 0) return "aucune page enregistree";
  if (document.pages_lisibles === 0) return `aucune des ${total} pages n'a pu etre lue`;
  if (document.pages_lisibles < total) {
    return `${document.pages_lisibles} / ${total} pages lues`;
  }
  return `${total} pages lues`;
}

export const LIBELLE_EXTRACTION: Record<StatutExtraction, string> = {
  en_attente: "analyse en attente",
  en_cours: "analyse en cours",
  termine: "analyse",
  echec: "analyse en echec",
};

export const LIBELLE_TYPE: Record<string, string> = {
  eliminatoire: "eliminatoire",
  obligatoire: "obligatoire",
  optionnelle: "optionnelle",
};
