import { getDocumentProxy } from "unpdf";

/**
 * Extraction de la couche texte, page par page.
 *
 * Deux regles gouvernent ce fichier, et elles ne sont pas negociables.
 *
 * 1. Le numero de page vient de la structure du PDF. On demande explicitement
 *    la page N au document via getPage(N), on ne decoupe jamais un texte
 *    global. C'est la fondation de EX-03 : une erreur ici serait irrattrapable
 *    puisque la citation renverrait vers la mauvaise page.
 *
 * 2. Le texte est conserve tel qu'extrait. Aucune suppression de sauts de
 *    ligne ni d'espaces multiples : l'Extractor a besoin de la mise en forme
 *    pour reperer les articles, et la citation litterale doit coller au PDF.
 *    L'assemblage ci-dessous reproduit exactement celui d'unpdf en mode
 *    mergePages false, qui n'applique aucune normalisation.
 */

/** En dessous, on considere qu'il n'y a pas de couche texte exploitable. */
export const SEUIL_CARACTERES_LISIBLE = 50;

export const MOTIF_SANS_COUCHE_TEXTE = "aucune couche texte";

/** Le fichier depose n'est pas un PDF exploitable. Reessayer est inutile. */
export class PdfInvalide extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfInvalide";
  }
}

export type PageExtraite = {
  numero: number;
  texte: string;
  nbCaracteres: number;
  lisible: boolean;
  motifIllisible: string | null;
  dureeMs: number;
};

/** Element de contenu rendu par pdf.js. Les elements balises n'ont pas de str. */
type ElementTexte = { str?: string | null; hasEOL?: boolean };

/** Erreurs pdf.js qui signifient "ce fichier ne sera jamais lisible". */
const ERREURS_DEFINITIVES = new Set([
  "InvalidPDFException",
  "MissingPDFException",
  "PasswordException",
  "UnknownErrorException",
]);

export type DocumentOuvert = {
  nbPages: number;
  lirePage: (numero: number) => Promise<PageExtraite>;
};

/**
 * Ouvre le PDF et expose son nombre de pages structurel.
 * Toute erreur de structure est traduite en PdfInvalide, avec son motif.
 */
export async function ouvrirDocument(donnees: Uint8Array): Promise<DocumentOuvert> {
  let pdf;
  try {
    pdf = await getDocumentProxy(donnees);
  } catch (erreur) {
    throw traduire(erreur);
  }

  const nbPages = pdf.numPages;
  if (!Number.isInteger(nbPages) || nbPages < 1) {
    throw new PdfInvalide("le document ne declare aucune page");
  }

  return {
    nbPages,
    async lirePage(numero: number): Promise<PageExtraite> {
      const debut = performance.now();
      let texte: string;
      try {
        // Le numero est passe au document : c'est lui qui designe la page.
        const page = await pdf.getPage(numero);
        const contenu = await page.getTextContent();
        const elements = contenu.items as ElementTexte[];
        texte = elements
          .filter((element) => element.str != null)
          .map((element) => element.str + (element.hasEOL ? "\n" : ""))
          .join("");
      } catch (erreur) {
        throw traduire(erreur);
      }

      // On compte ce que l'on stocke. Le seuil de lisibilite, lui, se juge sur
      // le texte une fois les blancs retires : une page de seuls espaces
      // n'est pas une page lue.
      const nbCaracteres = texte.length;
      const lisible = texte.trim().length >= SEUIL_CARACTERES_LISIBLE;

      return {
        numero,
        texte,
        nbCaracteres,
        lisible,
        motifIllisible: lisible ? null : MOTIF_SANS_COUCHE_TEXTE,
        dureeMs: Math.round(performance.now() - debut),
      };
    },
  };
}

function traduire(erreur: unknown): PdfInvalide | Error {
  if (!(erreur instanceof Error)) {
    return new PdfInvalide(String(erreur));
  }
  if (ERREURS_DEFINITIVES.has(erreur.name)) {
    return new PdfInvalide(`fichier illisible : ${erreur.message}`);
  }
  // Erreur inconnue : on ne la deguise pas en PDF invalide, elle remontera
  // telle quelle et donnera lieu a une reprise puis a une escalade.
  return erreur;
}
