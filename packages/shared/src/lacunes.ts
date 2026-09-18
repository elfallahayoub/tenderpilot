/**
 * Detection des conditions qu'un document annonce mais qu'on n'a pas su lire.
 *
 * Le cas reel qui justifie ce fichier : sur AO-2026-004, page 2, l'article 3
 * enumere ses conditions de participation, et l'OCR restitue 3.1, 3.2 et 3.5
 * mais rend 3.3 et 3.4 illisibles. Or 3.4 est la condition de certification,
 * celle qui fait basculer trois autres avis en no-go.
 *
 * Le systeme ne peut pas lire cette ligne. Il ne doit surtout pas l'inventer.
 * Mais il ne doit pas non plus se taire : il doit dire, a l'ecran et en trois
 * secondes, qu'une condition de participation n'a pas pu etre lue et ou.
 *
 * La detection est purement structurelle : une enumeration dont il manque un
 * numero interieur a un trou. Aucune interpretation du contenu.
 */

/** En-tete d'article : "Article 3 —", "ARTICLE 4 :", "Article 12". */
const ENTETE_ARTICLE = /^[ \t]*article\s+([0-9]+)\s*[—–\-:.]?\s*([^\n]*)$/gim;

/** Intitules qui designent des conditions de participation. */
const INTITULES_PARTICIPATION = [
  "conditions requises des concurrents",
  "conditions de participation",
  "conditions requises",
  "capacites techniques",
];

function simplifier(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type Lacune = {
  /** Numero de l'article concerne, par exemple "3". */
  article: string;
  intitule: string;
  /** Numeros absents de l'enumeration, par exemple ["3.3", "3.4"]. */
  numerosManquants: string[];
  /** Vrai quand l'article porte des conditions de participation. */
  estConditionDeParticipation: boolean;
};

/**
 * Numeros de sous-conditions presents dans un bloc, pour un article donne.
 * Accepte "3.4", "3,4" et "3. 4", que l'OCR produit indifferemment.
 */
export function numerosPresents(bloc: string, article: string): number[] {
  const motif = new RegExp(`(?:^|[\\s(])${article}\\s*[.,]\\s*(\\d{1,2})(?![\\d])`, "gm");
  const trouves = new Set<number>();
  let trouve: RegExpExecArray | null;
  while ((trouve = motif.exec(bloc)) !== null) {
    trouves.add(Number(trouve[1]));
  }
  return [...trouves].sort((a, b) => a - b);
}

/**
 * Trous interieurs d'une enumeration. On ne signale jamais un manque avant le
 * premier numero vu ni apres le dernier : une enumeration peut legitimement
 * commencer a 6 ou s'arreter a 8, et supposer le contraire serait deviner.
 */
export function trousInterieurs(numeros: number[]): number[] {
  if (numeros.length < 2) return [];
  const manquants: number[] = [];
  for (let valeur = numeros[0]! + 1; valeur < numeros[numeros.length - 1]!; valeur += 1) {
    if (!numeros.includes(valeur)) manquants.push(valeur);
  }
  return manquants;
}

/** Decoupe la page en blocs d'articles, en-tete compris. */
function blocs(textePage: string): { article: string; intitule: string; contenu: string }[] {
  const entetes: { article: string; intitule: string; debut: number }[] = [];
  ENTETE_ARTICLE.lastIndex = 0;
  let trouve: RegExpExecArray | null;
  while ((trouve = ENTETE_ARTICLE.exec(textePage)) !== null) {
    entetes.push({
      article: trouve[1]!,
      intitule: (trouve[2] ?? "").trim(),
      debut: trouve.index,
    });
  }

  return entetes.map((entete, index) => ({
    article: entete.article,
    intitule: entete.intitule,
    contenu: textePage.slice(
      entete.debut,
      index + 1 < entetes.length ? entetes[index + 1]!.debut : textePage.length,
    ),
  }));
}

export function estArticleDeParticipation(intitule: string): boolean {
  const simple = simplifier(intitule);
  return INTITULES_PARTICIPATION.some((reference) => simple.includes(reference));
}

/**
 * Lacunes d'une page : articles dont l'enumeration presente un trou.
 * Rend une liste vide quand tout se suit, ce qui est le cas de toute page
 * dotee d'une couche texte.
 */
export function detecterLacunes(textePage: string): Lacune[] {
  const lacunes: Lacune[] = [];

  for (const bloc of blocs(textePage)) {
    const presents = numerosPresents(bloc.contenu, bloc.article);
    const manquants = trousInterieurs(presents);
    if (manquants.length === 0) continue;

    lacunes.push({
      article: bloc.article,
      intitule: bloc.intitule,
      numerosManquants: manquants.map((numero) => `${bloc.article}.${numero}`),
      estConditionDeParticipation: estArticleDeParticipation(bloc.intitule),
    });
  }

  return lacunes;
}

/**
 * Phrase affichable pour le jury, en trois secondes.
 * Exemple : "une condition de participation n'a pas pu etre lue, page 2 :
 * article 3, conditions 3.3 et 3.4".
 */
export function decrireLacune(lacune: Lacune, page: number): string {
  const numeros = lacune.numerosManquants;
  const liste =
    numeros.length === 1
      ? numeros[0]!
      : `${numeros.slice(0, -1).join(", ")} et ${numeros[numeros.length - 1]!}`;

  const nature = lacune.estConditionDeParticipation
    ? numeros.length === 1
      ? "une condition de participation n'a pas pu etre lue"
      : "des conditions de participation n'ont pas pu etre lues"
    : numeros.length === 1
      ? "une clause n'a pas pu etre lue"
      : "des clauses n'ont pas pu etre lues";

  return `${nature}, page ${page} : article ${lacune.article}, ${
    numeros.length === 1 ? "condition" : "conditions"
  } ${liste}`;
}
