import type { Document, Page, Sante } from "./types";

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
