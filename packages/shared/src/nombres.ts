/**
 * Normalisation des nombres, en chiffres comme en toutes lettres.
 *
 * Regle 8 du CLAUDE.md : le modele ne produit aucun nombre. Il recopie la
 * valeur telle qu'elle apparait dans le document, et c'est cette fonction pure
 * qui la convertit. Tout chiffre qui finit dans un verdict est passe par ici,
 * et cette fonction est testee unitairement.
 *
 * Elle rend null plutot que de deviner : une valeur non convertible fait
 * tomber le fait a null, elle ne produit jamais d'approximation.
 */

const UNITES: Record<string, number> = {
  zero: 0,
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
};

const DIZAINES: Record<string, number> = {
  vingt: 20,
  trente: 30,
  quarante: 40,
  cinquante: 50,
  soixante: 60,
};

/** Mots d'unite tolerés autour de la valeur, sans effet sur le resultat. */
const MOTS_IGNORES = new Set([
  "points",
  "point",
  "mad",
  "dh",
  "dirhams",
  "dirham",
  "personnes",
  "personne",
  "ans",
  "an",
  "annees",
  "annee",
  "references",
  "reference",
  "minimum",
  "minimale",
  "minimal",
  "et",
  // Qualificatifs d'unite rencontres dans les avis reels : "cinq dernieres
  // annees", "quatre-vingt-cinq points techniques". Ils n'ajoutent aucune
  // quantite. Tout autre mot inconnu fait toujours echouer la lecture : on
  // refuse "un nombre suffisant" plutot que d'en tirer 1.
  "dernieres",
  "derniere",
  "derniers",
  "dernier",
  "consecutives",
  "consecutifs",
  "revolues",
  "revolus",
  "pleines",
  "civiles",
  "calendaires",
  "techniques",
  "technique",
  "exercices",
  "exercice",
  "clos",
]);

/** Retire accents et ponctuation decorative, met en minuscules. */
function simplifier(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Tente la lecture d'un nombre ecrit en chiffres.
 * Gere les separateurs de milliers (espace, espace insecable, apostrophe) et
 * la virgule decimale francaise comme le point.
 */
function lireChiffres(texte: string): number | null {
  // Un nombre, eventuellement avec separateurs de milliers, puis decimales.
  const trouve = texte.match(/-?\d[\d\s  '.,]*/);
  if (!trouve) return null;

  let brut = trouve[0].replace(/[\s  ']/g, "");

  // Le dernier separateur suivi de une ou deux decimales est le separateur
  // decimal. Tous les autres sont des separateurs de milliers.
  const decimal = brut.match(/[.,](\d{1,2})$/);
  if (decimal) {
    const partieEntiere = brut.slice(0, brut.length - decimal[0].length).replace(/[.,]/g, "");
    brut = `${partieEntiere}.${decimal[1]}`;
  } else {
    brut = brut.replace(/[.,]/g, "");
  }

  if (!/^-?\d+(\.\d+)?$/.test(brut)) return null;
  const valeur = Number(brut);
  return Number.isFinite(valeur) ? valeur : null;
}

/**
 * Lecture d'un nombre ecrit en toutes lettres.
 * Les formes composees du francais sont traitees : quatre-vingts, soixante-dix,
 * quatre-vingt-cinq, soixante-quinze, cent vingt.
 */
function lireLettres(texte: string): number | null {
  // "quatre-vingt" et "quatre vingts" valent 80 avant toute autre lecture,
  // sans quoi "quatre" serait compte pour 4.
  const prepare = texte
    .replace(/quatre[\s-]vingts?/g, " @80 ")
    .replace(/[-']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const jetons = prepare.split(" ").filter((jeton) => jeton.length > 0);
  if (jetons.length === 0) return null;

  let total = 0;
  let courant = 0;
  let vuUnChiffre = false;

  for (const jeton of jetons) {
    if (MOTS_IGNORES.has(jeton)) continue;

    if (jeton === "@80") {
      courant += 80;
      vuUnChiffre = true;
    } else if (jeton in UNITES) {
      courant += UNITES[jeton]!;
      vuUnChiffre = true;
    } else if (jeton in DIZAINES) {
      courant += DIZAINES[jeton]!;
      vuUnChiffre = true;
    } else if (jeton === "cent" || jeton === "cents") {
      courant = (courant === 0 ? 1 : courant) * 100;
      vuUnChiffre = true;
    } else if (jeton === "mille" || jeton === "milles") {
      total += (courant === 0 ? 1 : courant) * 1000;
      courant = 0;
      vuUnChiffre = true;
    } else if (jeton === "million" || jeton === "millions") {
      total += (courant === 0 ? 1 : courant) * 1_000_000;
      courant = 0;
      vuUnChiffre = true;
    } else if (jeton === "milliard" || jeton === "milliards") {
      total += (courant === 0 ? 1 : courant) * 1_000_000_000;
      courant = 0;
      vuUnChiffre = true;
    } else {
      // Mot inconnu : on refuse plutot que de deviner.
      return null;
    }
  }

  return vuUnChiffre ? total + courant : null;
}

/**
 * Convertit une valeur brute recopiee du document en nombre.
 * Rend null si la valeur n'est pas convertible avec certitude.
 */
export function normaliserNombre(brut: string | null | undefined): number | null {
  if (brut == null) return null;

  const texte = simplifier(brut);
  if (texte.length === 0) return null;

  // Les chiffres priment : "12 778 000.00 MAD" n'est pas un nombre en lettres.
  if (/\d/.test(texte)) {
    return lireChiffres(texte);
  }

  return lireLettres(texte);
}

/** Variante entiere, pour les effectifs, les comptes et les durees. */
export function normaliserEntier(brut: string | null | undefined): number | null {
  const valeur = normaliserNombre(brut);
  if (valeur === null) return null;
  return Number.isInteger(valeur) ? valeur : Math.round(valeur);
}
