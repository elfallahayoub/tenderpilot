import type {
  Couverture,
  Document,
  EvenementJournal,
  Page,
  Recapitulatif,
  Requirement,
  Sante,
  StatutExtraction,
  Verdict,
} from "./types";

const URL_API = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/**
 * Appels HTTP de l'interface.
 *
 * Aucune erreur n'est avalee : chaque fonction rejette avec un message
 * affichable, de facon a ne jamais presenter un resultat partiel comme complet.
 */
async function lireJson<T>(chemin: string): Promise<T> {
  const reponse = await fetch(`${URL_API}${chemin}`);
  const corps = (await reponse.json().catch(() => null)) as unknown;
  if (!reponse.ok) {
    const message =
      corps && typeof corps === "object" && "erreur" in corps
        ? String((corps as { erreur: unknown }).erreur)
        : `reponse ${reponse.status}`;
    throw new Error(message);
  }
  return corps as T;
}

/** La sante repond 503 quand elle est degradee : le corps reste exploitable. */
export async function lireSante(): Promise<Sante> {
  const reponse = await fetch(`${URL_API}/health`);
  return (await reponse.json()) as Sante;
}

export async function listerDocuments(): Promise<Document[]> {
  const { documents } = await lireJson<{ documents: Document[] }>("/documents");
  return documents;
}

export async function listerPages(documentId: string): Promise<Page[]> {
  const { pages } = await lireJson<{ pages: Page[] }>(`/documents/${documentId}/pages`);
  return pages;
}

export type ReponseDepot = {
  document: Document;
  dejaConnu: boolean;
};

export async function deposerDocument(fichier: File): Promise<ReponseDepot> {
  const formulaire = new FormData();
  formulaire.append("fichier", fichier);

  const reponse = await fetch(`${URL_API}/documents`, { method: "POST", body: formulaire });
  const corps = (await reponse.json().catch(() => null)) as unknown;

  if (!reponse.ok) {
    if (reponse.status === 413) {
      throw new Error("fichier trop volumineux, 20 Mo au maximum");
    }
    const message =
      corps && typeof corps === "object" && "erreur" in corps
        ? String((corps as { erreur: unknown }).erreur)
        : `le depot a echoue (${reponse.status})`;
    throw new Error(message);
  }

  return corps as ReponseDepot;
}

export type ReponseExigences = {
  statutExtraction: StatutExtraction;
  motifExtraction: string | null;
  statutQualification: StatutExtraction;
  motifQualification: string | null;
  /** Produit par le moteur de regles, jamais par un modele. */
  verdict: Verdict | null;
  /** Non nulle quand le verdict ne peut pas etre tenu pour franc. */
  reserve: string | null;
  complet: boolean | null;
  composantesManquantes: string[] | null;
  anneeReference: number | null;
  origineAnneeReference: string | null;
  exigences: Requirement[];
  couverture: Couverture;
};

export async function listerExigences(documentId: string): Promise<ReponseExigences> {
  return lireJson<ReponseExigences>(`/documents/${documentId}/exigences`);
}

export type SectionMemoire = {
  ordre: number;
  titre: string;
  contenu: string;
  statut: "redigee" | "a_completer";
  motif: string | null;
  /** La correction humaine, nulle tant que la section n'a pas ete reecrite. */
  contenu_humain: string | null;
  statut_revue: StatutRevue;
  revue_le: string | null;
  references_citees: string[];
  modele: string | null;
  tokens: number | null;
  tentatives: number;
};

export type StatutRevue = "a_revoir" | "validee" | "corrigee";

export type ReponseMemoire = {
  statutMemoire: "absent" | "en_cours" | "termine" | "echec";
  motifMemoire: string | null;
  sections: SectionMemoire[];
};

export async function lireMemoire(documentId: string): Promise<ReponseMemoire> {
  return lireJson<ReponseMemoire>(`/documents/${documentId}/memoire`);
}

/** Declenche la redaction. Sept appels au modele, donc jamais automatique. */
export async function genererMemoire(documentId: string): Promise<void> {
  const reponse = await fetch(`${URL_API}/documents/${documentId}/memoire`, { method: "POST" });
  if (!reponse.ok) {
    const corps = (await reponse.json().catch(() => null)) as { erreur?: unknown } | null;
    throw new Error(corps?.erreur ? String(corps.erreur) : `la generation a echoue (${reponse.status})`);
  }
}

/** Validation ou correction humaine d'une section. Persistee immediatement. */
export async function reviserSection(
  documentId: string,
  ordre: number,
  corps: { action: "valider" } | { action: "corriger"; contenu: string },
): Promise<void> {
  const reponse = await fetch(`${URL_API}/documents/${documentId}/sections/${ordre}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });
  if (!reponse.ok) {
    const erreur = (await reponse.json().catch(() => null)) as { erreur?: unknown } | null;
    throw new Error(erreur?.erreur ? String(erreur.erreur) : `echec (${reponse.status})`);
  }
}

/** Seul chemin qui ecrase du travail humain. Il est donc explicite. */
export async function regenererSection(documentId: string, ordre: number): Promise<void> {
  const reponse = await fetch(`${URL_API}/documents/${documentId}/sections/${ordre}/regenerer`, {
    method: "POST",
  });
  if (!reponse.ok) throw new Error(`echec (${reponse.status})`);
}

export function urlDocx(documentId: string): string {
  return `${URL_API}/documents/${documentId}/memoire.docx`;
}

export type ReponseJournal = {
  evenements: EvenementJournal[];
  recapitulatif: Recapitulatif;
  derniereSequence: number;
};

/**
 * Journal d'un traitement. `depuis` permet le sondage incremental : seules
 * les etapes plus recentes que la derniere sequence connue redescendent.
 */
export async function lireJournal(documentId: string, depuis = 0): Promise<ReponseJournal> {
  return lireJson<ReponseJournal>(`/documents/${documentId}/journal?depuis=${depuis}`);
}

/**
 * URL du PDF d'origine, ancree sur une page. Le lecteur integre des
 * navigateurs honore #page=N : un clic sur une exigence ouvre donc le document
 * a la page citee, ce qui est exactement le critere de EX-03.
 */
export function urlPdf(documentId: string, page?: number): string {
  const base = `${URL_API}/documents/${documentId}/fichier`;
  return page === undefined ? base : `${base}#page=${page}`;
}
