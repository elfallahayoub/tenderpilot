/**
 * Section courante d'une page, calculee par le code.
 *
 * Le piege est reel : la page 3 de AO-2026-001 commence par la phrase isolee
 * "Une note technique inferieure a soixante points ... est eliminatoire.",
 * sans en-tete ni grille autour. Sans contexte, le modele ne peut pas rattacher
 * cette phrase au reglement.
 *
 * On ne lui donne pas le document pour autant : on lui passe UNE LIGNE,
 * calculee ici en reperant les titres de section sur les pages precedentes.
 */

/** Un titre plus court que cela n'est pas une section. */
const LONGUEUR_TITRE_MIN = 10;

/** Proportion de majuscules a partir de laquelle une ligne est un titre. */
const PART_MAJUSCULES_MIN = 0.8;

function premiereLigneUtile(texte: string): string | null {
  for (const ligne of texte.split("\n")) {
    const nette = ligne.trim();
    if (nette.length > 0) return nette;
  }
  return null;
}

/**
 * Une ligne est un titre de section si elle ouvre la page et qu'elle est
 * ecrite en capitales. C'est la convention de ces dossiers de consultation.
 */
export function estTitreDeSection(ligne: string): boolean {
  if (ligne.length < LONGUEUR_TITRE_MIN) return false;

  const lettres = [...ligne].filter((caractere) => /\p{L}/u.test(caractere));
  if (lettres.length < LONGUEUR_TITRE_MIN) return false;

  const majuscules = lettres.filter((caractere) => caractere === caractere.toLocaleUpperCase("fr"));
  return majuscules.length / lettres.length >= PART_MAJUSCULES_MIN;
}

export type PageSource = {
  numero: number;
  texte: string;
};

/**
 * Titre de section en vigueur a la page demandee : le dernier titre rencontre
 * a cette page ou avant. Rend null si aucune page precedente n'en porte.
 */
export function sectionCourante(pages: PageSource[], numero: number): string | null {
  let courante: string | null = null;

  for (const page of [...pages].sort((a, b) => a.numero - b.numero)) {
    if (page.numero > numero) break;
    const ligne = premiereLigneUtile(page.texte);
    if (ligne !== null && estTitreDeSection(ligne)) {
      courante = ligne;
    }
  }

  return courante;
}
