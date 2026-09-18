/**
 * Completude d'un dossier de consultation.
 *
 * Le systeme ne deduit JAMAIS un document d'un autre. Il ne compte pas les
 * pages des autres avis pour conclure qu'il en manque ici : ce serait supposer
 * une norme qui n'existe nulle part.
 *
 * Il se fonde sur ce que le document dit de lui-meme. La premiere page annonce
 * sa propre composition : "Le present dossier de consultation comprend le
 * reglement de la consultation, le cahier des prescriptions speciales, le
 * bordereau des prix et le planning previsionnel d'execution."
 *
 * Le code releve les composantes annoncees, cherche l'en-tete de chacune dans
 * les pages, et NOMME celles qui manquent. Dire "le bordereau des prix et le
 * planning previsionnel sont absents" vaut mieux que "il manque trois pages".
 */

/**
 * La phrase par laquelle un dossier annonce sa composition.
 * Cherchee sur le texte BRUT : la simplification retire la ponctuation, or
 * c'est elle qui delimite la phrase et separe les composantes.
 */
const ANNONCE = /dossier\s+de\s+consultation[^.]{0,30}?comprend\s+([^.]{10,400})\./i;

function simplifier(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Retire l'article defini initial : "le bordereau des prix" -> "bordereau des prix". */
function sansDeterminant(composante: string): string {
  return composante.replace(/^(le|la|les|l|un|une|des|du|de la|de l)\s+/, "").trim();
}

/**
 * Marge toleree entre le libelle annonce et la ligne de titre qui le porte.
 * "BORDEREAU DES PRIX — DETAIL ESTIMATIF" depasse de 17 caracteres le libelle
 * "bordereau des prix" : c'est bien un titre. En revanche la phrase du cahier
 * des prescriptions "...dans le bordereau des prix annexe au present cahier"
 * ne commence pas par le libelle, et une mention n'est pas une presence.
 */
const MARGE_TITRE = 20;

/**
 * La composante figure-t-elle comme TITRE dans cette page ?
 *
 * Une simple mention ne suffit pas. Le cahier des prescriptions renvoie au
 * bordereau des prix sans le contenir : compter cette phrase declarerait
 * present un document absent, ce qui est exactement l'erreur a eviter.
 */
export function figureCommeTitre(textePage: string, libelle: string): boolean {
  for (const ligne of textePage.split("\n")) {
    const simple = simplifier(ligne);
    if (simple.length === 0) continue;
    if (simple.startsWith(libelle) && simple.length <= libelle.length + MARGE_TITRE) {
      return true;
    }
  }
  return false;
}

export type Composante = {
  /** Libelle tel qu'annonce, nettoye. */
  libelle: string;
  trouvee: boolean;
  /** Page ou l'en-tete a ete trouve, quand il l'a ete. */
  page: number | null;
};

export type Completude = {
  /** Vrai si le document annonce sa composition et que tout y est. */
  complet: boolean;
  /** Faux quand le document n'annonce rien : on ne conclut alors pas. */
  annonceSaComposition: boolean;
  composantes: Composante[];
  manquantes: string[];
};

export type PageLue = {
  numero: number;
  texte: string;
};

/**
 * Composantes annoncees par le document, dans l'ordre de l'annonce.
 * Rend une liste vide si aucune annonce n'est trouvee.
 */
export function composantesAnnoncees(pages: PageLue[]): string[] {
  for (const page of [...pages].sort((a, b) => a.numero - b.numero)) {
    const trouve = page.texte.match(ANNONCE);
    if (!trouve) continue;

    return trouve[1]!
      .split(/\s*,\s*|\s+et\s+/)
      .map((composante) => sansDeterminant(simplifier(composante)))
      .filter((composante) => composante.length >= 6);
  }
  return [];
}

/**
 * Analyse de completude. Une composante est tenue pour presente si son libelle
 * apparait dans une page AUTRE que celle qui porte l'annonce : sans quoi
 * l'annonce se validerait elle-meme.
 */
export function analyserCompletude(pages: PageLue[]): Completude {
  const annoncees = composantesAnnoncees(pages);

  if (annoncees.length === 0) {
    return { complet: true, annonceSaComposition: false, composantes: [], manquantes: [] };
  }

  const pageDeLAnnonce = [...pages]
    .sort((a, b) => a.numero - b.numero)
    .find((page) => ANNONCE.test(page.texte))?.numero;

  const composantes: Composante[] = annoncees.map((libelle) => {
    for (const page of [...pages].sort((a, b) => a.numero - b.numero)) {
      if (page.numero === pageDeLAnnonce) continue;
      if (figureCommeTitre(page.texte, libelle)) {
        return { libelle, trouvee: true, page: page.numero };
      }
    }
    return { libelle, trouvee: false, page: null };
  });

  const manquantes = composantes.filter((c) => !c.trouvee).map((c) => c.libelle);

  return {
    complet: manquantes.length === 0,
    annonceSaComposition: true,
    composantes,
    manquantes,
  };
}

/** Phrase affichable, qui nomme ce qui manque plutot que de compter des pages. */
export function decrireManques(manquantes: string[]): string {
  if (manquantes.length === 0) return "";
  const liste =
    manquantes.length === 1
      ? manquantes[0]!
      : `${manquantes.slice(0, -1).join(", ")} et ${manquantes[manquantes.length - 1]!}`;
  return manquantes.length === 1
    ? `une composante annoncee du dossier est absente : ${liste}`
    : `${manquantes.length} composantes annoncees du dossier sont absentes : ${liste}`;
}
