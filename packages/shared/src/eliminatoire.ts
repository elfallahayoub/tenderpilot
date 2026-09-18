/**
 * Caractere eliminatoire d'une exigence, etabli par le code.
 *
 * Pourquoi ce fichier existe. A la premiere execution sur les dix avis, le
 * systeme a rendu dix go alors que quatre no-go etaient attendus. Le moteur de
 * regles avait pourtant correctement detecte treize exigences non satisfaites,
 * dont trois certifications absentes du profil. Aucune n'etait bloquante,
 * parce que le modele les avait typees "obligatoire".
 *
 * Or les pages 2 de AO-2026-001 et de AO-2026-002 portent la MEME phrase :
 * "Le non-respect d'une condition qualifiee d'eliminatoire entraine le rejet
 * de l'offre sans examen au fond." Le modele avait type les conditions de
 * l'une eliminatoires et celles de l'autre obligatoires. Une variance de
 * lecture sur le champ qui decide du verdict est inacceptable.
 *
 * Le caractere eliminatoire est donc lu dans le texte du document, par des
 * regles pures et testees : un article dont l'enonce annonce que le
 * non-respect entraine le rejet rend eliminatoires les conditions qu'il porte.
 *
 * Cette regle ne fait que RENFORCER le type produit par le modele. Elle ne
 * declasse jamais une exigence deja eliminatoire : sur un go / no-go, se
 * tromper dans le sens du doute est la seule erreur acceptable.
 */

/**
 * Formulations par lesquelles un texte de marche public annonce qu'un
 * manquement fait rejeter l'offre.
 */
const MARQUEURS_ELIMINATION = [
  "entraine le rejet",
  "entrainent le rejet",
  "rejet de l offre",
  "est eliminatoire",
  "sont eliminatoires",
  "qualifiee d eliminatoire",
  "qualifiees d eliminatoires",
  "sans examen au fond",
  "ecarte sans etre ouvert",
  "ecartes sans etre ouverts",
  "elimination du concurrent",
  "offre eliminee",
  "non recevable",
];

function simplifier(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
}

/** Vrai si le fragment annonce un rejet en cas de manquement. */
export function annonceUneElimination(fragment: string): boolean {
  const texte = simplifier(fragment);
  return MARQUEURS_ELIMINATION.some((marqueur) => texte.includes(marqueur));
}

/** En-tete d'article : "Article 3 —", "Article 12 -", "ARTICLE 4 :". */
const ENTETE_ARTICLE = /^\s*article\s+([0-9]+)\b/gim;

/**
 * Numeros d'articles de cette page dont l'enonce annonce une elimination.
 *
 * Le decoupage se fait sur les en-tetes d'articles : un marqueur trouve dans
 * le bloc de l'article 3 rend l'article 3 eliminatoire, et lui seul.
 */
export function articlesEliminatoiresDeLaPage(textePage: string): Set<string> {
  const eliminatoires = new Set<string>();

  const entetes: { numero: string; debut: number }[] = [];
  ENTETE_ARTICLE.lastIndex = 0;
  let trouve: RegExpExecArray | null;
  while ((trouve = ENTETE_ARTICLE.exec(textePage)) !== null) {
    entetes.push({ numero: trouve[1]!, debut: trouve.index });
  }

  for (let index = 0; index < entetes.length; index += 1) {
    const debut = entetes[index]!.debut;
    const fin = index + 1 < entetes.length ? entetes[index + 1]!.debut : textePage.length;
    if (annonceUneElimination(textePage.slice(debut, fin))) {
      eliminatoires.add(entetes[index]!.numero);
    }
  }

  return eliminatoires;
}

/**
 * Numero d'article principal d'une reference textuelle.
 * "Article 3.4" et "Reglement art. 3.1" rendent "3", "CPS art. 7.10" rend "7".
 * Rend null quand aucun numero n'est identifiable.
 */
export function numeroArticle(article: string | null): string | null {
  if (article === null) return null;
  const trouve = article.match(/(\d+)/);
  return trouve ? trouve[1]! : null;
}

/**
 * Le texte de la page rend-il cette exigence eliminatoire ?
 *
 * Le rattachement est fait page par page, ce qui evite de confondre l'article
 * 7 du reglement et l'article 7 du cahier des prescriptions speciales : ils ne
 * figurent pas sur la meme page.
 */
export function estEliminatoireSelonLeTexte(
  article: string | null,
  textePage: string,
): boolean {
  const numero = numeroArticle(article);
  if (numero === null) return false;
  return articlesEliminatoiresDeLaPage(textePage).has(numero);
}
