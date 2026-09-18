/**
 * Inventaire des variables d'environnement attendues.
 *
 * Regle absolue du projet : on ne lit, n'ecrit ni n'affiche jamais une valeur
 * secrete. Ce module ne manipule que des NOMS de variables. La route de sante
 * expose la liste de celles qui manquent, jamais leur contenu.
 */

export const VARIABLES_REQUISES = [
  // Modele de raisonnement : orchestration, arbitrages.
  "LLM_URL",
  "LLM_API_KEY",
  "LLM_MODEL",
  // Modele a fort volume : extraction, classification, redaction.
  "AZURE_OPENAI_ENDPOINT",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_OPENAI_DEPLOYMENT_NAME",
  // Embeddings.
  "EMBEDDING_MODEL",
  "EMBEDDING_DIMENSIONS",
  // Infrastructure.
  "DATABASE_URL",
  "REDIS_URL",
] as const;

export type VariableRequise = (typeof VARIABLES_REQUISES)[number];

/** Noms des variables absentes ou vides. Aucune valeur n'est retournee. */
export function variablesManquantes(): VariableRequise[] {
  return VARIABLES_REQUISES.filter((nom) => {
    const valeur = process.env[nom];
    return valeur === undefined || valeur.trim() === "";
  });
}

/**
 * Retire toute identification d'une chaine avant de la journaliser ou de
 * l'envoyer au navigateur. Un message d'erreur de driver peut contenir une
 * URL de connexion complete, mot de passe compris.
 */
export function assainir(message: string): string {
  return message.replace(/\/\/[^/@\s]*@/g, "//***@").slice(0, 300);
}
