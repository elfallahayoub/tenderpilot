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

export type Couverture = {
  pagesTotal: number;
  pagesLues: number;
  pagesNonLues: PageNonLue[];
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

export const LIBELLE_STATUT: Record<StatutDocument, string> = {
  recu: "en file",
  en_cours: "lecture",
  traite: "lu",
  echec: "echec",
};

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
