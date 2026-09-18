/**
 * Annee de reference servant a compter l'anciennete des references clients.
 *
 * "4 references executees au cours des cinq dernieres annees" n'a de sens que
 * rapporte a une date. La bonne date est celle de la seance publique
 * d'ouverture des plis, annoncee en premiere page de l'avis. On la lit par
 * expression reguliere, en TypeScript : c'est une donnee du document, pas une
 * interpretation, et aucun appel au modele n'est justifie pour cela.
 *
 * Quand l'avis ne l'annonce pas, on se rabat sur l'annee courante, et le
 * journal dit laquelle a servi.
 */

export type OrigineAnneeReference = "seance_publique" | "annee_courante";

export type AnneeReference = {
  annee: number;
  origine: OrigineAnneeReference;
  /** Ce qui a ete lu dans le document, quand il y a eu lecture. */
  extrait: string | null;
};

/** Bornes de vraisemblance : au-dela, ce n'est pas une date d'appel d'offres. */
const ANNEE_MIN = 2000;
const ANNEE_MAX = 2100;

const DATE = /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})/;

/** "seance publique" suivi d'une date, a moins de 120 caracteres. */
const SEANCE = /s[ée]ance\s+publique[\s\S]{0,120}?(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})/i;

/** Variante ou la date precede la mention. */
const SEANCE_INVERSE =
  /(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{4})[\s\S]{0,80}?s[ée]ance\s+publique/i;

function anneeValide(brut: string | undefined): number | null {
  if (brut === undefined) return null;
  const annee = Number(brut);
  return Number.isInteger(annee) && annee >= ANNEE_MIN && annee <= ANNEE_MAX ? annee : null;
}

/**
 * Cherche la date de la seance publique dans les pages fournies, dans l'ordre.
 * Rend null si aucune date exploitable n'y figure.
 */
export function lireAnneeSeancePublique(
  textesDePages: string[],
): { annee: number; extrait: string } | null {
  for (const motif of [SEANCE, SEANCE_INVERSE]) {
    for (const texte of textesDePages) {
      const trouve = texte.match(motif);
      const annee = anneeValide(trouve?.[3]);
      if (trouve && annee !== null) {
        return { annee, extrait: trouve[0].replace(/\s+/g, " ").trim().slice(0, 120) };
      }
    }
  }

  // Repli sur la premiere date du document : en pratique celle de la premiere
  // page, ou figure toujours le calendrier de la consultation.
  for (const texte of textesDePages) {
    const trouve = texte.match(DATE);
    const annee = anneeValide(trouve?.[3]);
    if (trouve && annee !== null) {
      return { annee, extrait: trouve[0].trim() };
    }
  }

  return null;
}

/**
 * Annee de reference a utiliser, avec la trace de sa provenance.
 * `anneeCourante` est passee en parametre pour que la fonction reste pure et
 * testable : elle ne lit jamais l'horloge elle-meme.
 */
export function determinerAnneeReference(
  textesDePages: string[],
  anneeCourante: number,
): AnneeReference {
  const lue = lireAnneeSeancePublique(textesDePages);
  if (lue !== null) {
    return { annee: lue.annee, origine: "seance_publique", extrait: lue.extrait };
  }
  return { annee: anneeCourante, origine: "annee_courante", extrait: null };
}
