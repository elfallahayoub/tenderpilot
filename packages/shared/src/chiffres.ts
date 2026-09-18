import { estMotNombre, normaliserNombre } from "./nombres.js";

/**
 * Verification des nombres produits par le Writer.
 *
 * Generalisation de la regle 8 du CLAUDE.md a toute la chaine : tout nombre
 * ecrit en chiffres, ou qu'il apparaisse dans le systeme, doit se trouver dans
 * la matiere fournie. Le Writer redige les denombrements en toutes lettres
 * ("quatre phases") et ne recourt aux chiffres que pour recopier une valeur
 * qu'on lui a donnee.
 *
 * Cette fonction releve tous les nombres d'un texte produit et rend ceux qui
 * sont absents de la matiere. Une section qui en contient est rejetee, jamais
 * corrigee en silence : un memoire fluide portant un montant invente vaut
 * moins qu'un memoire qui declare ses trous.
 */

/**
 * Un nombre, eventuellement avec separateurs de milliers et decimales.
 * "12 778 000.00", "6 424 000,00", "2026", "20".
 *
 * Deux precautions, chacune corrige une erreur constatee :
 *
 * - Un separateur de milliers doit etre suivi d'exactement trois chiffres.
 *   Sans cela "education, 2022, 5648000" etait lu comme le nombre unique
 *   20225648000, et la verification devenait inexploitable.
 * - Un nombre colle a un mot ou a un tiret appartient a un identifiant, pas a
 *   une quantite : "REF-02" et "AO-2026-001" sont ignores des deux cotes de la
 *   comparaison, donc symetriquement.
 */
const NOMBRE =
  /(?<![\w-])\d{1,3}(?:[   ']\d{3})+(?:[.,]\d+)?(?![\w-])|(?<![\w-])\d+(?:[.,]\d+)?(?![\w-])/g;

/**
 * Forme canonique d'un nombre, pour que "6 424 000.00" et "6424000" soient
 * reconnus comme la meme valeur, quelle que soit la convention d'ecriture.
 */
export function canoniser(brut: string): string | null {
  let texte = brut.replace(/[   ']/g, "");

  // Le dernier separateur suivi d'une ou deux decimales est le separateur
  // decimal ; les autres separent les milliers.
  const decimal = texte.match(/[.,](\d{1,2})$/);
  if (decimal) {
    const entier = texte.slice(0, texte.length - decimal[0].length).replace(/[.,]/g, "");
    texte = `${entier}.${decimal[1]}`;
  } else {
    texte = texte.replace(/[.,]/g, "");
  }

  if (!/^\d+(\.\d+)?$/.test(texte)) return null;

  const valeur = Number(texte);
  if (!Number.isFinite(valeur)) return null;

  // Number() normalise "6424000.00" en 6424000 : deux ecritures de la meme
  // valeur donnent donc la meme clef.
  return String(valeur);
}

/**
 * Nombres ecrits en toutes lettres.
 *
 * Sans cette detection, la verification avait une faille beante : le modele
 * ecrivait "deux mille vingt-deux" et "Deux de ces references sont appuyees
 * par des attestations", donc des affirmations chiffrees, fausses ou non, que
 * le controle des chiffres ne voyait pas. Constate sur une vraie generation.
 */
function nombresEnLettres(texte: string): string[] {
  const jetons = texte.split(/[^\p{L}-]+/u).filter((jeton) => jeton.length > 0);
  const trouves: string[] = [];
  let suite: string[] = [];

  const vider = (): void => {
    // Une suite d'un seul mot doit etre un mot-nombre a part entiere :
    // "un" isole est un article, pas une quantite.
    if (suite.length >= 1) {
      const utile = suite.filter((mot) => estMotNombre(mot, true) && !/^et$/i.test(mot));
      if (utile.length > 0 && (suite.length > 1 || estMotNombre(suite[0]!, false))) {
        const valeur = normaliserNombre(suite.join(" "));
        if (valeur !== null) trouves.push(String(valeur));
      }
    }
    suite = [];
  };

  for (const jeton of jetons) {
    // Les traits d'union font partie des nombres composes : "quatre-vingt-cinq".
    const morceaux = jeton.split("-").filter((morceau) => morceau.length > 0);
    if (morceaux.every((morceau) => estMotNombre(morceau, true)) && morceaux.length > 0) {
      suite.push(jeton);
    } else {
      vider();
    }
  }
  vider();

  return trouves;
}

/** Tous les nombres d'un texte, en chiffres ET en toutes lettres, sans doublon. */
export function nombresDuTexte(texte: string): string[] {
  const trouves = new Set<string>();
  for (const brut of texte.match(NOMBRE) ?? []) {
    const canonique = canoniser(brut);
    if (canonique !== null) trouves.add(canonique);
  }
  for (const valeur of nombresEnLettres(texte)) trouves.add(valeur);
  return [...trouves];
}

export type ChiffreNonSource = {
  /** Le nombre tel qu'il est apparu dans le texte produit. */
  valeur: string;
};

/**
 * Nombres du texte produit introuvables dans la matiere fournie.
 *
 * @param texte   la section redigee par le modele
 * @param materiau tout ce qui lui a ete donne : exigences, preuves, references
 * @returns la liste des nombres non sources, vide si la section est acceptable
 */
export function chiffresNonSources(texte: string, materiau: string): string[] {
  const autorises = new Set(nombresDuTexte(materiau));
  return nombresDuTexte(texte).filter((nombre) => !autorises.has(nombre));
}

/**
 * Retire les nombres d'un texte, en les remplacant par un tiret.
 *
 * Sert aux extraits de style tires des memoires deja rendus : le Writer doit
 * en reprendre le ton, jamais les montants d'un ancien marche. En les retirant
 * on rend la recopie impossible plutot que de la detecter apres coup.
 */
export function retirerLesNombres(texte: string): string {
  const sansChiffres = texte.replace(NOMBRE, "—");

  // Les nombres en toutes lettres aussi : sinon un extrait disant "quatre
  // phases" pousserait le modele a ecrire un nombre absent de la matiere, donc
  // a faire rejeter sa section.
  return sansChiffres.replace(/[\p{L}]+(?:-[\p{L}]+)*/gu, (mot) =>
    estMotEntierNombre(mot) ? "—" : mot,
  );
}

/** "quatre", "quatre-vingt-cinq" : oui. "un", "quatrieme", "phases" : non. */
function estMotEntierNombre(mot: string): boolean {
  const morceaux = mot.split("-").filter((morceau) => morceau.length > 0);
  if (morceaux.length === 0) return false;
  if (morceaux.length === 1) return estMotNombre(morceaux[0]!, false);
  return morceaux.every((morceau) => estMotNombre(morceau, true));
}
