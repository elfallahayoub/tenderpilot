/**
 * Verification des citations.
 *
 * Une exigence sans citation verifiable est une hallucination. On ne se
 * contente donc pas de faire confiance au modele : on cherche sa citation dans
 * le texte de la page reellement stocke, et on renvoie la sous-chaine
 * d'origine. La citation enregistree est ainsi, par construction, presente mot
 * pour mot dans la page annoncee.
 *
 * La comparaison tolere trois differences qui ne changent pas le sens et que
 * tout modele introduit : les retours a la ligne dus au rendu du PDF, les
 * variantes d'apostrophes et de guillemets, et la casse. Elle ne tolere rien
 * d'autre.
 */

/** En dessous, une citation est trop generique pour prouver quoi que ce soit. */
export const LONGUEUR_CITATION_MIN = 15;

/** Substitutions un pour un : la correspondance des index reste exacte. */
function remplacerCaractere(caractere: string): string {
  if (caractere === "’" || caractere === "‘" || caractere === "´" || caractere === "`") {
    return "'";
  }
  if (caractere === "“" || caractere === "”" || caractere === "«" || caractere === "»") {
    return '"';
  }
  if (caractere === "–" || caractere === "—") {
    return "-";
  }
  return caractere.toLowerCase();
}

type TexteNormalise = {
  /** Texte comparable : blancs reduits, apostrophes unifiees, minuscules. */
  valeur: string;
  /** Pour chaque caractere de `valeur`, son index dans le texte d'origine. */
  index: number[];
};

function normaliser(texte: string): TexteNormalise {
  const sortie: string[] = [];
  const index: number[] = [];
  let dansUnBlanc = false;

  for (let position = 0; position < texte.length; position += 1) {
    const caractere = texte[position]!;
    if (/\s/.test(caractere)) {
      // Une suite de blancs quelconques devient un espace unique.
      if (!dansUnBlanc && sortie.length > 0) {
        sortie.push(" ");
        index.push(position);
        dansUnBlanc = true;
      }
      continue;
    }
    dansUnBlanc = false;
    sortie.push(remplacerCaractere(caractere));
    index.push(position);
  }

  // Un espace final ne sert a rien et fausserait les bornes.
  while (sortie.length > 0 && sortie[sortie.length - 1] === " ") {
    sortie.pop();
    index.pop();
  }

  return { valeur: sortie.join(""), index };
}

export type ResultatCitation =
  | { trouvee: true; citation: string }
  | { trouvee: false; motif: string };

/**
 * Cherche `citation` dans `textePage` et renvoie la sous-chaine d'origine.
 *
 * @returns la citation telle qu'elle figure dans la page, ou le motif du rejet.
 */
export function verifierCitation(textePage: string, citation: string): ResultatCitation {
  const citationNette = citation.trim();
  if (citationNette.length < LONGUEUR_CITATION_MIN) {
    return {
      trouvee: false,
      motif: `citation trop courte (${citationNette.length} caracteres, ${LONGUEUR_CITATION_MIN} exiges)`,
    };
  }

  const page = normaliser(textePage);
  const aiguille = normaliser(citationNette);

  if (aiguille.valeur.length === 0) {
    return { trouvee: false, motif: "citation vide apres normalisation" };
  }

  const debut = page.valeur.indexOf(aiguille.valeur);
  if (debut === -1) {
    return { trouvee: false, motif: "la citation ne figure pas dans le texte de la page" };
  }

  const fin = debut + aiguille.valeur.length - 1;
  const departOrigine = page.index[debut]!;
  const finOrigine = page.index[fin]!;

  // On renvoie le texte de la page, jamais celui du modele.
  return { trouvee: true, citation: textePage.slice(departOrigine, finOrigine + 1) };
}
