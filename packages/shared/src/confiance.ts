/**
 * Calcul de la confiance d'une exigence.
 *
 * Le modele ne donne plus de confiance : il repondait 1 partout, et un champ
 * constant n'informe personne. La confiance est desormais calculee ici, a
 * partir de signaux objectifs constates par le code au moment ou l'exigence est
 * enregistree. Elle est donc reproductible, explicable ligne a ligne, et
 * testable unitairement.
 *
 * Bareme, documente a l'identique dans le README :
 *
 *   socle                                                    0.40
 *   citation recopiee a l'identique                         +0.30
 *   citation retrouvee apres normalisation                  +0.15
 *   fait machine construit                                  +0.15
 *   aucun fait propose (exigence non chiffrable)            +0.05
 *   fait propose mais non normalisable                      +0.00
 *   article identifie et coherent avec la section calculee  +0.10
 *   article identifie, coherence indeterminable             +0.05
 *   article absent, ou incoherent avec la section           +0.00
 *   page obtenue sans reprise du modele                     +0.05
 *   page ayant demande une reprise ou plus                  +0.00
 *
 * Le maximum vaut exactement 1. Le minimum vaut 0.40 : en dessous, la citation
 * serait introuvable et l'exigence aurait ete rejetee, pas notee.
 */

export const SOCLE = 0.4;

export type EtatCitation = "exacte" | "normalisee";

export type EtatFait = "construit" | "non_applicable" | "non_normalisable";

export type CoherenceArticle = "coherent" | "indeterminable" | "absent" | "incoherent";

export type SignauxConfiance = {
  citation: EtatCitation;
  fait: EtatFait;
  article: CoherenceArticle;
  /** Reprises qu'il a fallu au modele pour rendre une sortie valide sur cette page. */
  reprises: number;
};

export type DetailConfiance = {
  valeur: number;
  /** Une ligne par signal, pour que le score soit lisible et non magique. */
  justification: string[];
};

const POINTS_CITATION: Record<EtatCitation, number> = {
  exacte: 0.3,
  normalisee: 0.15,
};

const POINTS_FAIT: Record<EtatFait, number> = {
  construit: 0.15,
  non_applicable: 0.05,
  non_normalisable: 0,
};

const POINTS_ARTICLE: Record<CoherenceArticle, number> = {
  coherent: 0.1,
  indeterminable: 0.05,
  absent: 0,
  incoherent: 0,
};

const LIBELLE_CITATION: Record<EtatCitation, string> = {
  exacte: "citation recopiee a l'identique",
  normalisee: "citation retrouvee apres normalisation des blancs ou de la casse",
};

const LIBELLE_FAIT: Record<EtatFait, string> = {
  construit: "fait machine construit",
  non_applicable: "aucun fait propose, exigence non chiffrable",
  non_normalisable: "fait propose mais non normalisable",
};

const LIBELLE_ARTICLE: Record<CoherenceArticle, string> = {
  coherent: "article coherent avec la section calculee",
  indeterminable: "article identifie, coherence indeterminable",
  absent: "aucun article identifie",
  incoherent: "article en contradiction avec la section calculee",
};

/** Arrondi au centieme : une confiance affichee en pourcentage entier. */
function arrondir(valeur: number): number {
  return Math.round(valeur * 100) / 100;
}

export function calculerConfiance(signaux: SignauxConfiance): DetailConfiance {
  const justification: string[] = [`socle ${SOCLE.toFixed(2)}`];
  let valeur = SOCLE;

  const citation = POINTS_CITATION[signaux.citation];
  valeur += citation;
  justification.push(`${signe(citation)} ${LIBELLE_CITATION[signaux.citation]}`);

  const fait = POINTS_FAIT[signaux.fait];
  valeur += fait;
  justification.push(`${signe(fait)} ${LIBELLE_FAIT[signaux.fait]}`);

  const article = POINTS_ARTICLE[signaux.article];
  valeur += article;
  justification.push(`${signe(article)} ${LIBELLE_ARTICLE[signaux.article]}`);

  const sansReprise = signaux.reprises === 0;
  const pointsReprise = sansReprise ? 0.05 : 0;
  valeur += pointsReprise;
  justification.push(
    `${signe(pointsReprise)} ${
      sansReprise
        ? "page obtenue sans reprise du modele"
        : `page obtenue apres ${signaux.reprises} reprise${signaux.reprises > 1 ? "s" : ""}`
    }`,
  );

  return { valeur: arrondir(Math.min(Math.max(valeur, 0), 1)), justification };
}

function signe(points: number): string {
  return `+${points.toFixed(2)}`;
}

/**
 * Coherence entre l'article annonce par le modele et la section calculee par
 * le code a partir des en-tetes de page.
 *
 * Un article qui dit "CPS" alors que la section en vigueur est le reglement
 * signale une lecture douteuse. Quand ni l'un ni l'autre ne nomme sa source,
 * on ne conclut pas : la coherence est indeterminable, pas mauvaise.
 */
export function coherenceArticle(
  article: string | null,
  section: string | null,
): CoherenceArticle {
  if (article === null || article.trim() === "") return "absent";
  if (section === null || section.trim() === "") return "indeterminable";

  const a = sansAccents(article);
  const s = sansAccents(section);

  const articleCps = a.includes("cps") || a.includes("prescriptions");
  const articleReglement = a.includes("reglement") || a.includes("consultation");
  const sectionCps = s.includes("prescriptions");
  const sectionReglement = s.includes("reglement") || s.includes("consultation");

  if (articleCps && sectionCps) return "coherent";
  if (articleReglement && sectionReglement) return "coherent";
  if (articleCps && sectionReglement) return "incoherent";
  if (articleReglement && sectionCps) return "incoherent";

  return "indeterminable";
}

function sansAccents(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
