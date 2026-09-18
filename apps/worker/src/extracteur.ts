import { UnrecoverableError, type Job } from "bullmq";
import { pool } from "./shared/db.js";
import { journaliser, journaliserSansBloquer } from "./shared/journal.js";
import { appelerModele } from "./shared/llm.js";
import { verifierCitation } from "./shared/citation.js";
import { construireFait } from "./shared/faits.js";
import { SCHEMA_JSON_EXTRACTION, schemaSortieExtraction } from "./shared/schemas.js";
import type { ExigenceBrute } from "./shared/schemas.js";
import { ETAPE_CITATION_INTROUVABLE } from "./shared/types.js";
import type { StatutEvenement } from "./shared/types.js";
import { sectionCourante } from "./sections.js";

const AGENT = "extractor";

/** Plafond de sortie par page. Une page en contient rarement plus de dix. */
const JETONS_MAX_PAR_PAGE = 4000;

/** Confiance maximale accordee a une exigence dont le fait n'a pu etre construit. */
const CONFIANCE_SANS_FAIT = 0.5;

export type TravailExtraction = {
  documentId: string;
};

type LignePage = {
  id: string;
  numero: number;
  texte: string;
  lisible: boolean;
  motif_illisible: string | null;
};

const SYSTEME = `Tu es analyste de marches publics marocains.
On te donne LE TEXTE D'UNE SEULE PAGE d'un dossier de consultation.
Tu releves les exigences imposees au candidat qui figurent sur CETTE page.

REGLES ABSOLUES.

1. Tu ne produis AUCUN nombre. Chaque valeur chiffree est recopiee telle qu'elle
   apparait dans le texte, dans un champ se terminant par "Brut", sans aucune
   conversion. "soixante" reste "soixante". "12 778 000.00" reste
   "12 778 000.00". "quatre-vingt-cinq" reste "quatre-vingt-cinq".
2. La citation est recopiee mot pour mot depuis la page. Tu ne reformules pas,
   tu ne completes pas, tu ne corriges pas une coquille. Si tu ne peux pas
   citer, tu ne releves pas l'exigence.
3. Tu ne deduis rien d'une autre page. Mais si une phrase de cette page enonce
   un seuil eliminatoire alors que la grille a laquelle elle se rapporte n'est
   pas visible ici, tu la releves quand meme : la phrase se suffit a elle-meme.
4. Une phrase qui decrit le marche (objet, lieu, estimation, planning) n'est pas
   une exigence. Une exigence impose quelque chose au candidat.
5. Tu n'inventes jamais. Une page sans exigence rend une liste vide.

VALEURS BRUTES.
Un champ "Brut" contient UNIQUEMENT la valeur, en chiffres ou en toutes lettres,
sans les mots qui l'entourent.
Ecris "cinq", pas "cinq dernieres annees".
Ecris "quatre-vingt-cinq", pas "quatre-vingt-cinq points techniques".
Ecris "12 778 000.00", pas "12 778 000.00 MAD".

EXIGENCES ISSUES D'UN TABLEAU.
Les tableaux sont rendus ligne par ligne, colonnes separees par des espaces.
Chaque ligne d'un tableau d'exigences donne une exigence DISTINCTE, et sa
citation est la ligne exactement telle qu'elle apparait, par exemple
"Chef de projet 1 8 ans". Ne fusionne jamais plusieurs lignes et ne les
reecris jamais en phrase : ta citation serait introuvable et rejetee.

type :
- "eliminatoire" si le texte dit que le non-respect entraine le rejet ou
  l'elimination, ou qualifie la condition d'eliminatoire.
- "optionnelle" si le texte dit que c'est valorise, apprecie, facultatif, ou
  qu'il s'agit d'une variante.
- "obligatoire" dans tous les autres cas.

categorie :
- administratif : attestations, declarations, certificats, pieces du dossier.
- financier : chiffre d'affaires, cautionnement, prix, penalites, reglement.
- technique : references, moyens, methodologie, certifications d'entreprise.
- equipe : profils, effectif, CV, experience des intervenants.
- delai : dates limites, durees d'execution, echeances.

fait : renseigne-le uniquement si l'exigence correspond a l'un des kind ci-dessous.
Ne remplis que les champs utiles au kind choisi, les autres restent null.

- chiffre_affaires_min : un chiffre d'affaires ou un revenu annuel exige du
  candidat. JAMAIS un cautionnement, une estimation du marche, une penalite,
  une retenue de garantie ni un montant de prestation.
- effectif_min : nombre minimal de salaries de l'entreprise.
- certification_requise : certification de l'entreprise (ISO, Qualiopi).
- attestation_requise : piece administrative a produire.
- references_min : nombre de references similaires exigees, avec leur secteur
  et l'anciennete maximale acceptee.
- profil_equipe : un poste de l'equipe projet, son nombre et son experience
  minimale. Si le texte dit "un chef de projet", nombreBrut vaut "un".
- note_technique_min : seuil de points exige, et total de points sur lequel il
  porte.

Si aucun kind ne convient, fait vaut null. Ne force jamais un kind approchant :
un fait faux est plus grave qu'un fait absent.

confiance : entre 0 et 1, ta certitude sur la lecture de cette exigence.`;

/**
 * Extraction des exigences d'un document, page par page.
 *
 * Le document entier n'entre jamais dans un prompt : un appel par page lisible,
 * plus une ligne de contexte calculee par le code. Les pages illisibles ne
 * produisent aucune exigence et sont comptees nommement.
 */
export async function traiterExtraction(job: Job<TravailExtraction>): Promise<{
  exigences: number;
  rejetees: number;
  pagesLues: number;
  pagesIgnorees: number;
  tokens: number;
}> {
  const { documentId } = job.data;
  const runId = documentId;
  const debutTotal = performance.now();

  const maxTentatives = job.opts.attempts ?? 1;
  const tentative = job.attemptsMade + 1;

  try {
    await majStatut(documentId, "en_cours", null);

    const pages = await lirePages(documentId);
    if (pages.length === 0) {
      throw new UnrecoverableError("aucune page enregistree pour ce document");
    }

    await tracer(runId, "plan d'extraction", 0, "succes", null, null,
      `${pages.length} pages, dont ${pages.filter((page) => page.lisible).length} lisibles, un appel par page lisible`);

    // Une reprise ne doit pas empiler les exigences.
    await pool.query(`DELETE FROM requirements WHERE document_id = $1`, [documentId]);

    let total = 0;
    let rejetees = 0;
    let pagesLues = 0;
    let pagesIgnorees = 0;
    let tokens = 0;
    const numerosIgnores: number[] = [];

    for (const page of pages) {
      if (!page.lisible) {
        pagesIgnorees += 1;
        numerosIgnores.push(page.numero);
        await tracer(runId, `page ${page.numero} ignoree`, 0, "succes", null, null,
          `${page.motif_illisible ?? "page illisible"}. Aucune exigence n'en sera deduite.`);
        continue;
      }

      pagesLues += 1;
      const section = sectionCourante(pages, page.numero);

      const resultat = await appelerModele({
        usage: "extraction",
        systeme: SYSTEME,
        utilisateur: construirePrompt(page, pages.length, section),
        schema: schemaSortieExtraction,
        schemaJson: SCHEMA_JSON_EXTRACTION,
        nomSchema: "extraction_exigences",
        maxTokens: JETONS_MAX_PAR_PAGE,
        runId,
        agent: AGENT,
        etape: `extraction page ${page.numero}`,
      });

      if (resultat.statut === "indetermine") {
        tokens += resultat.tokens;
        // L'appel a deja journalise son escalade. Aucune exigence n'est
        // deduite de cette page, et on le dit plutot que de faire silence.
        await tracer(runId, `page ${page.numero} non analysee`, 0, "escalade", resultat.modele, null,
          `${resultat.motif}. Cette page ne produit aucune exigence, revue humaine necessaire.`);
        continue;
      }

      tokens += resultat.tokens;

      for (const brute of resultat.valeur.exigences) {
        const enregistree = await enregistrer(runId, documentId, page, brute, resultat.modele);
        if (enregistree) total += 1;
        else rejetees += 1;
      }

      await tracer(runId, `page ${page.numero} analysee`, resultat.dureeMs, "succes", resultat.modele,
        resultat.tokens, `${resultat.valeur.exigences.length} exigences proposees${section ? `, section ${section}` : ""}`);
    }

    await majStatut(documentId, "termine", null);

    await tracer(runId, "extraction terminee", Math.round(performance.now() - debutTotal), "succes", null, tokens,
      `${total} exigences retenues, ${rejetees} rejetees, ${pagesLues} pages analysees, ${pagesIgnorees} ignorees${
        numerosIgnores.length > 0 ? ` (pages ${numerosIgnores.join(", ")})` : ""
      }`);

    return { exigences: total, rejetees, pagesLues, pagesIgnorees, tokens };
  } catch (erreur) {
    const message = (erreur instanceof Error ? erreur.message : String(erreur)).replace(/\.$/, "");
    const duree = Math.round(performance.now() - debutTotal);

    if (erreur instanceof UnrecoverableError) {
      await majStatut(documentId, "echec", message);
      await tracerSansBloquer(runId, "extraction impossible", duree, "echec", message);
      throw erreur;
    }

    if (tentative < maxTentatives) {
      await tracerSansBloquer(runId, "erreur passagere", duree, "reprise",
        `${message}. Nouvelle tentative ${tentative + 1} sur ${maxTentatives}.`);
      throw erreur;
    }

    await majStatut(documentId, "echec", message);
    await tracerSansBloquer(runId, "echec definitif", duree, "escalade",
      `${message}. ${maxTentatives} tentatives epuisees, intervention humaine requise.`);
    throw erreur;
  }
}

/**
 * Le prompt ne contient que la page et une ligne de contexte calculee par le
 * code. Le profil d'entreprise et les references n'y figurent jamais.
 */
function construirePrompt(page: LignePage, nbPages: number, section: string | null): string {
  const contexte = section === null ? "inconnue" : section;
  return [
    `Section en vigueur a cette page : ${contexte}`,
    `Page ${page.numero} sur ${nbPages}.`,
    "",
    "--- DEBUT DU TEXTE DE LA PAGE ---",
    page.texte,
    "--- FIN DU TEXTE DE LA PAGE ---",
  ].join("\n");
}

/**
 * Enregistre une exigence apres verification de sa citation.
 *
 * @returns true si l'exigence est retenue, false si elle est rejetee.
 */
async function enregistrer(
  runId: string,
  documentId: string,
  page: LignePage,
  brute: ExigenceBrute,
  modele: string,
): Promise<boolean> {
  // Verification par code : la citation doit exister dans la page annoncee.
  // C'est le seul garde-fou contre l'hallucination, et il ne fait pas confiance.
  const verification = verifierCitation(page.texte, brute.citation);
  if (!verification.trouvee) {
    await tracer(runId, ETAPE_CITATION_INTROUVABLE, 0, "echec", modele, null,
      `page ${page.numero} : ${verification.motif}. Exigence rejetee : "${brute.texte.slice(0, 120)}"`);
    return false;
  }

  const resultatFait = construireFait(brute.fait);
  let confiance = Math.min(Math.max(brute.confiance, 0), 1);

  if (!resultatFait.ok && brute.fait !== null) {
    // Le modele a cru voir un fait chiffre, le code n'a pas pu le construire.
    // L'exigence reste affichee, mais sans forme machine et avec une confiance
    // plafonnee : la tranche 4 ne pourra pas la trancher, et l'interface le dira.
    confiance = Math.min(confiance, CONFIANCE_SANS_FAIT);
    await tracer(runId, `fait non normalisable page ${page.numero}`, 0, "reprise", null, null,
      `${resultatFait.motif}. Exigence conservee sans forme machine, confiance plafonnee a ${CONFIANCE_SANS_FAIT}.`);
  }

  await pool.query(
    `INSERT INTO requirements
       (document_id, page_id, numero_page, texte, citation, article, type, categorie, fait, confiance)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      documentId,
      page.id,
      page.numero,
      brute.texte,
      // On stocke la citation issue de la PAGE, jamais celle du modele.
      verification.citation,
      // Une chaine vide n'est pas un article : l'interface doit pouvoir dire
      // "article non identifie" plutot qu'afficher un blanc.
      brute.article?.trim() ? brute.article.trim() : null,
      brute.type,
      brute.categorie,
      resultatFait.ok ? JSON.stringify(resultatFait.fait) : null,
      confiance,
    ],
  );

  return true;
}

async function lirePages(documentId: string): Promise<LignePage[]> {
  const resultat = await pool.query<LignePage>(
    `SELECT id, numero, texte, lisible, motif_illisible
       FROM pages WHERE document_id = $1 ORDER BY numero ASC`,
    [documentId],
  );
  return resultat.rows;
}

async function majStatut(
  documentId: string,
  statut: "en_cours" | "termine" | "echec",
  motif: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE documents SET statut_extraction = $2, motif_extraction = $3 WHERE id = $1`,
    [documentId, statut, motif === null ? null : motif.slice(0, 500)],
  );
}

async function tracer(
  runId: string,
  etape: string,
  dureeMs: number,
  statut: StatutEvenement,
  modele: string | null,
  tokens: number | null,
  detail: string,
): Promise<void> {
  await journaliser({ runId, agent: AGENT, etape, modele, tokens, dureeMs, statut, detail });
}

async function tracerSansBloquer(
  runId: string,
  etape: string,
  dureeMs: number,
  statut: StatutEvenement,
  detail: string,
): Promise<void> {
  await journaliserSansBloquer({
    runId,
    agent: AGENT,
    etape,
    modele: null,
    tokens: null,
    dureeMs,
    statut,
    detail,
  });
}
