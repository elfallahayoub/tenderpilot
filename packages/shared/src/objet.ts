/**
 * Objet du marche, lu en premiere page.
 *
 * Sert de texte de requete pour la recherche semantique des references et des
 * extraits de style. C'est une donnee du document, pas une interpretation :
 * aucun appel au modele ne se justifie pour la lire.
 */

const OBJET = /^\s*objet\s*:?\s*(.{5,300}?)\s*$/im;

export function objetDeLAvis(textesDePages: string[]): string | null {
  for (const texte of textesDePages) {
    const trouve = texte.match(OBJET);
    if (!trouve) continue;
    const objet = trouve[1]!.trim().replace(/\.$/, "").trim();
    if (objet.length >= 5) return objet;
  }
  return null;
}
