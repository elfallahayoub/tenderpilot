import { UnrecoverableError, type Job } from "bullmq";
import { z } from "zod";
import { pool } from "./shared/db.js";
import { journaliser, journaliserSansBloquer } from "./shared/journal.js";
import { appelerModele } from "./shared/llm.js";
import { lireProfil, ProfilAbsent } from "./shared/profil.js";
import { construireFait } from "./shared/faits.js";
import { schemaFaitBrut } from "./shared/schemas.js";
import { determinerAnneeReference } from "./shared/dates.js";
import { analyserCompletude, decrireManques } from "./shared/completude.js";
import { decrireLacune, detecterLacunes } from "./shared/lacunes.js";
import { SEUIL_CONFIANCE_OCR } from "./ocr.js";
import {
  calculerVerdict,
  estBloquant,
  evaluerFait,
  type Profil,
  type ResultatRegle,
} from "./shared/regles.js";
import type { Fait, StatutEvenement, TypeExigence } from "./shared/types.js";

const AGENT = "qualifier";

/** Plafonds de sortie. Les deux appels rendent quelques dizaines de jetons. */
const JETONS_NORMALISATION = 800;
const JETONS_ARBITRAGE = 300;

export type TravailQualification = {
  documentId: string;
};

type LigneExigence = {
  id: string;
  numero_page: number;
  texte: string;
  citation: string;
  article: string | null;
  type: TypeExigence;
  fait: Fait | null;
};

type OrigineEvaluation =
  | "deterministe"
  | "normalisation_gpt41"
  | "arbitrage_gpt55"
  | "non_evaluable";

// --- Contrats des deux appels au modele -------------------------------------

/**
 * Seconde passe de normalisation. Le modele ne rend toujours aucun nombre :
 * il recopie les valeurs brutes, et construireFait les convertit.
 */
const schemaNormalisation = z.object({
  fait: schemaFaitBrut.nullable(),
});

const SCHEMA_JSON_NORMALISATION = {
  type: "object",
  additionalProperties: false,
  required: ["fait"],
  properties: {
    fait: {
      type: ["object", "null"],
      additionalProperties: false,
      required: [
        "kind",
        "valeurBrute",
        "surBrute",
        "nomBrut",
        "nombreBrut",
        "secteurBrut",
        "anneesMaxBrut",
        "posteBrut",
        "experienceMinBrut",
      ],
      properties: {
        kind: {
          type: "string",
          enum: [
            "chiffre_affaires_min",
            "effectif_min",
            "certification_requise",
            "references_min",
            "profil_equipe",
            "attestation_requise",
            "note_technique_min",
          ],
        },
        valeurBrute: { type: ["string", "null"] },
        surBrute: { type: ["string", "null"] },
        nomBrut: { type: ["string", "null"] },
        nombreBrut: { type: ["string", "null"] },
        secteurBrut: { type: ["string", "null"] },
        anneesMaxBrut: { type: ["string", "null"] },
        posteBrut: { type: ["string", "null"] },
        experienceMinBrut: { type: ["string", "null"] },
      },
    },
  },
};

/**
 * Arbitrage d'equivalence. Le modele ne rend pas un verdict : il rend un
 * indice dans une liste fermee. Le moteur de regles en tire la conclusion.
 */
const schemaArbitrage = z.object({
  indice: z.number().int(),
  justification: z.string(),
});

const SCHEMA_JSON_ARBITRAGE = {
  type: "object",
  additionalProperties: false,
  required: ["indice", "justification"],
  properties: {
    indice: {
      type: "integer",
      description: "Indice de l'element equivalent dans la liste, ou -1 si aucun ne convient.",
    },
    justification: { type: "string", description: "Une phrase, au plus." },
  },
};

const SYSTEME_NORMALISATION = `Tu transformes une exigence d'appel d'offres en fait machine.

Tu ne produis AUCUN nombre. Chaque valeur chiffree est recopiee telle qu'elle
apparait dans la citation, sans conversion : "soixante" reste "soixante",
"12 778 000.00" reste "12 778 000.00". Un champ "Brut" contient uniquement la
valeur, sans les mots qui l'entourent.

Si l'exigence ne correspond a aucun kind, ou si la valeur n'est pas dans la
citation, rends fait a null. Ne devine jamais : un fait faux est plus grave
qu'un fait absent.`;

const SYSTEME_ARBITRAGE = `Tu compares un intitule exige a une liste d'intitules detenus.

Tu reponds uniquement par l'indice de l'element de la liste qui designe la MEME
chose que l'intitule exige, ou -1 si aucun ne convient.

Deux intitules designent la meme chose s'ils nomment la meme piece, la meme
certification ou le meme poste, meme ecrits differemment : un sigle et sa forme
developpee, par exemple. Deux normes differentes, deux pieces differentes ou
deux metiers differents ne sont jamais equivalents.

Tu ne juges pas si l'exigence est satisfaite : ce n'est pas ta question.`;

// --- Traitement -------------------------------------------------------------

export async function traiterQualification(job: Job<TravailQualification>): Promise<{
  evaluees: number;
  bloquants: number;
  indetermines: number;
  verdict: string;
  tokens: number;
}> {
  const { documentId } = job.data;
  const runId = documentId;
  const debutTotal = performance.now();

  const maxTentatives = job.opts.attempts ?? 1;
  const tentative = job.attemptsMade + 1;

  try {
    await majStatut(documentId, "en_cours", null);

    // Appel d'outil : le profil se lit en base, il n'entre jamais dans un prompt.
    let profil: Profil;
    try {
      profil = await lireProfil();
    } catch (erreur) {
      if (erreur instanceof ProfilAbsent) throw new UnrecoverableError(erreur.message);
      throw erreur;
    }

    await tracer(runId, "lecture du profil", 0, "succes", null, null,
      `${profil.raisonSociale} : effectif ${profil.effectif}, ${profil.references.length} references, ${profil.equipe.length} CV`);

    const annee = await determinerAnnee(documentId, runId);

    // Un verdict sur un document qu'on n'a pas su lire ne vaut rien. Rendre
    // "go" faute de bloquant reviendrait a conclure de l'absence de preuve a
    // la preuve de l'absence, sur un document entierement illisible.
    const couverture = await pool.query<{ lues: number; total: number }>(
      `SELECT count(*) FILTER (WHERE lisible)::int AS lues, count(*)::int AS total
         FROM pages WHERE document_id = $1`,
      [documentId],
    );
    const lues = couverture.rows[0]?.lues ?? 0;
    const totalPages = couverture.rows[0]?.total ?? 0;

    if (lues === 0) {
      const motif =
        totalPages === 0
          ? "aucune page enregistree : le document n'a pas pu etre lu"
          : `aucune des ${totalPages} pages n'a pu etre lue : verdict impossible sans OCR`;
      await enregistrerSansVerdict(documentId, motif, annee);
      await tracer(runId, "verdict impossible", Math.round(performance.now() - debutTotal),
        "escalade", null, null,
        `${motif}. Aucun verdict n'est rendu plutot qu'un go faute de bloquant : ` +
          "l'absence de preuve n'est pas la preuve de l'absence.");
      return { evaluees: 0, bloquants: 0, indetermines: 0, verdict: "indetermine", tokens: 0 };
    }

    const exigences = await lireExigences(documentId);
    if (exigences.length === 0) {
      await enregistrerSansVerdict(
        documentId,
        `aucune exigence extraite de ${lues} pages lues : verdict impossible`,
        annee,
      );
      await tracer(runId, "verdict impossible", Math.round(performance.now() - debutTotal),
        "escalade", null, null,
        "les pages ont ete lues mais aucune exigence n'en a ete tiree, revue humaine necessaire");
      return { evaluees: 0, bloquants: 0, indetermines: 0, verdict: "indetermine", tokens: 0 };
    }

    await pool.query(`DELETE FROM evaluations WHERE document_id = $1`, [documentId]);

    let tokens = 0;
    const lignes: { statut: ResultatRegle["statut"]; type: TypeExigence }[] = [];

    for (const exigence of exigences) {
      let fait = exigence.fait;
      let origine: OrigineEvaluation = "deterministe";
      let modele: string | null = null;

      // Seconde passe, bornee aux eliminatoires : le cout ne se justifie que
      // la ou un fait manquant peut changer le verdict.
      if (fait === null && exigence.type === "eliminatoire") {
        const seconde = await normaliser(runId, exigence);
        tokens += seconde.tokens;
        if (seconde.fait !== null) {
          fait = seconde.fait;
          origine = "normalisation_gpt41";
          modele = seconde.modele;
          await pool.query(`UPDATE requirements SET fait = $2 WHERE id = $1`, [
            exigence.id,
            JSON.stringify(fait),
          ]);
        }
      }

      if (fait === null) {
        await enregistrerEvaluation(documentId, exigence, {
          statut: "indetermine",
          preuve: "aucune forme machine : cette exigence demande une lecture humaine",
        }, "non_evaluable", null);
        lignes.push({ statut: "indetermine", type: exigence.type });
        continue;
      }

      let resultat = evaluerFait(fait, profil, annee.annee);

      // L'arbitrage n'a lieu que si la regle le demande : deux intitules
      // differents designent souvent la meme piece.
      if (resultat.arbitrage) {
        const arbitrage = await arbitrer(runId, exigence, resultat.arbitrage);
        tokens += arbitrage.tokens;
        if (arbitrage.indice !== null) {
          resultat = evaluerFait(fait, profil, annee.annee, { indice: arbitrage.indice });
          if (resultat.statut === "satisfait") {
            origine = "arbitrage_gpt55";
            modele = arbitrage.modele;
          }
        }
      }

      const bloquant = estBloquant({ statut: resultat.statut, type: exigence.type });
      await enregistrerEvaluation(documentId, exigence, resultat, origine, modele, bloquant);
      lignes.push({ statut: resultat.statut, type: exigence.type });
    }

    const bilan = calculerVerdict(
      lignes.map((ligne) => ({ statut: ligne.statut, type: ligne.type })),
    );

    const reserves = await analyserReserves(documentId, runId);
    await enregistrerVerdict(documentId, bilan.verdict, annee, reserves);

    await tracer(runId, "verdict", Math.round(performance.now() - debutTotal), "succes", null, tokens,
      `${bilan.verdict === "go" && reserves.motifs.length > 0 ? "GO SOUS RESERVE" : bilan.verdict.toUpperCase()}` +
        ` : ${bilan.bloquants} bloquants, ${bilan.indetermines} indetermines, ` +
        `${lignes.length} exigences evaluees, annee de reference ${annee.annee} (${annee.origine})` +
        (reserves.motifs.length > 0 ? `. Reserve : ${reserves.motifs.join(" ; ")}` : ""));

    return {
      evaluees: lignes.length,
      bloquants: bilan.bloquants,
      indetermines: bilan.indetermines,
      verdict: bilan.verdict,
      tokens,
    };
  } catch (erreur) {
    const message = (erreur instanceof Error ? erreur.message : String(erreur)).replace(/\.$/, "");
    const duree = Math.round(performance.now() - debutTotal);

    if (erreur instanceof UnrecoverableError) {
      await majStatut(documentId, "echec", message);
      await tracerSansBloquer(runId, "qualification impossible", duree, "echec", message);
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

// --- Reserves sur le verdict ------------------------------------------------

type Reserves = {
  motifs: string[];
  complet: boolean;
  composantesManquantes: string[];
};

/**
 * Tout ce qui empeche de tenir le verdict pour franc.
 *
 * Trois causes, cumulables et toujours nommees : une composante annoncee du
 * dossier est absente, une page n'a pas pu etre lue meme apres OCR, ou une
 * enumeration de conditions presente un trou parce que l'OCR n'a pas su la
 * restituer.
 *
 * La derniere est la plus importante pour le jury : sur AO-2026-004, la
 * condition de certification de l'article 3.4 est illisible, et c'est
 * precisement le genre de condition qui fait basculer un avis en no-go. Le
 * systeme ne l'invente pas, et il ne se tait pas non plus.
 */
async function analyserReserves(documentId: string, runId: string): Promise<Reserves> {
  const pages = await pool.query<{
    numero: number;
    texte: string;
    lisible: boolean;
    source: string;
    qualite_ocr: number | null;
    motif_illisible: string | null;
  }>(
    `SELECT numero, texte, lisible, source, qualite_ocr, motif_illisible
       FROM pages WHERE document_id = $1 ORDER BY numero`,
    [documentId],
  );

  const motifs: string[] = [];

  // 1. Composantes annoncees par le document et introuvables.
  const completude = analyserCompletude(
    pages.rows.map((page) => ({ numero: page.numero, texte: page.texte })),
  );
  const contientDuOcr = pages.rows.some((page) => page.source === "ocr");

  if (!completude.complet) {
    const phrase = decrireManques(completude.manquantes);
    motifs.push(phrase);
    await tracer(runId, "completude du dossier", 0, "succes", null, null,
      `${phrase}. Etabli a partir de la composition annoncee par le document lui-meme, ` +
        "jamais par comparaison avec un autre avis.");
  } else if (!completude.annonceSaComposition && contientDuOcr) {
    // Le document n'annonce pas sa composition de facon lisible. On ne peut
    // ni conclure qu'il est complet, ni pretendre savoir ce qui manque. Le
    // dire est la seule reponse honnete.
    const phrase =
      "la phrase annoncant la composition du dossier n'a pas pu etre lue : la completude n'a pas pu etre verifiee";
    motifs.push(phrase);
    await tracer(runId, "completude indeterminable", 0, "escalade", null, null,
      `${phrase}. Aucune conclusion n'est tiree d'une comparaison avec d'autres avis.`);
  }

  // 2. Conditions dont l'enumeration a un trou : l'OCR n'a pas su les lire.
  for (const page of pages.rows) {
    if (page.source !== "ocr" || !page.lisible) continue;
    for (const lacune of detecterLacunes(page.texte)) {
      const phrase = decrireLacune(lacune, page.numero);
      motifs.push(phrase);
      await tracer(runId, "condition illisible", 0, "escalade", null, null,
        `${phrase}. Aucune exigence n'en est deduite, et le verdict ne peut pas etre tenu pour franc.`);
    }
  }

  // 3. Pages restees illisibles apres OCR.
  const illisibles = pages.rows.filter((page) => !page.lisible);
  if (illisibles.length > 0) {
    motifs.push(
      `${illisibles.length} page${illisibles.length > 1 ? "s" : ""} non lue${
        illisibles.length > 1 ? "s" : ""
      } meme apres OCR : ${illisibles.map((page) => page.numero).join(", ")}`,
    );
  }

  // 4. Pages lues par OCR mais dont la reconnaissance est douteuse.
  const douteuses = pages.rows.filter(
    (page) =>
      page.source === "ocr" &&
      page.lisible &&
      page.qualite_ocr !== null &&
      page.qualite_ocr < SEUIL_CONFIANCE_OCR,
  );
  if (douteuses.length > 0) {
    motifs.push(
      `reconnaissance incertaine sur ${douteuses.length} page${douteuses.length > 1 ? "s" : ""} : ` +
        douteuses
          .map((page) => `page ${page.numero} a ${page.qualite_ocr} sur 100`)
          .join(", ") +
        `, seuil ${SEUIL_CONFIANCE_OCR}`,
    );
  }

  return {
    motifs,
    complet: completude.complet,
    composantesManquantes: completude.manquantes,
  };
}

// --- Annee de reference -----------------------------------------------------

async function determinerAnnee(
  documentId: string,
  runId: string,
): Promise<ReturnType<typeof determinerAnneeReference>> {
  const pages = await pool.query<{ texte: string }>(
    `SELECT texte FROM pages WHERE document_id = $1 AND lisible ORDER BY numero`,
    [documentId],
  );

  const annee = determinerAnneeReference(
    pages.rows.map((page) => page.texte),
    new Date().getFullYear(),
  );

  await tracer(runId, "annee de reference", 0, "succes", null, null,
    annee.origine === "seance_publique"
      ? `${annee.annee}, lue dans l'avis : "${annee.extrait}"`
      : `${annee.annee}, annee courante : l'avis n'annonce aucune date de seance publique`);

  return annee;
}

// --- Les deux appels au modele ----------------------------------------------

async function normaliser(
  runId: string,
  exigence: LigneExigence,
): Promise<{ fait: Fait | null; tokens: number; modele: string }> {
  const resultat = await appelerModele({
    usage: "classification",
    systeme: SYSTEME_NORMALISATION,
    utilisateur: [
      `Exigence : ${exigence.texte}`,
      `Citation : ${exigence.citation}`,
      `Article : ${exigence.article ?? "non identifie"}`,
    ].join("\n"),
    schema: schemaNormalisation,
    schemaJson: SCHEMA_JSON_NORMALISATION,
    nomSchema: "normalisation_fait",
    maxTokens: JETONS_NORMALISATION,
    runId,
    agent: AGENT,
    etape: `seconde normalisation, exigence page ${exigence.numero_page}`,
  });

  if (resultat.statut === "indetermine") {
    return { fait: null, tokens: resultat.tokens, modele: resultat.modele };
  }

  const construit = construireFait(resultat.valeur.fait);
  if (!construit.ok) {
    await tracer(runId, `seconde normalisation sans resultat page ${exigence.numero_page}`, 0,
      "succes", resultat.modele, null,
      `${construit.motif}. L'exigence restera indeterminee plutot que devinee.`);
    return { fait: null, tokens: resultat.tokens, modele: resultat.modele };
  }

  return { fait: construit.fait, tokens: resultat.tokens, modele: resultat.modele };
}

async function arbitrer(
  runId: string,
  exigence: LigneExigence,
  demande: { exige: string; candidats: string[] },
): Promise<{ indice: number | null; tokens: number; modele: string }> {
  const liste = demande.candidats.map((candidat, index) => `${index}. ${candidat}`).join("\n");

  const resultat = await appelerModele({
    usage: "arbitrage",
    systeme: SYSTEME_ARBITRAGE,
    utilisateur: [`Intitule exige : ${demande.exige}`, "", "Intitules detenus :", liste].join("\n"),
    schema: schemaArbitrage,
    schemaJson: SCHEMA_JSON_ARBITRAGE,
    nomSchema: "arbitrage_equivalence",
    maxTokens: JETONS_ARBITRAGE,
    runId,
    agent: AGENT,
    etape: `arbitrage d'equivalence, exigence page ${exigence.numero_page}`,
  });

  if (resultat.statut === "indetermine") {
    return { indice: null, tokens: resultat.tokens, modele: resultat.modele };
  }

  const { indice, justification } = resultat.valeur;
  // Un indice hors des bornes est traite comme une absence, jamais comme un
  // succes : le modele ne peut pas designer ce qui n'existe pas.
  const valide = Number.isInteger(indice) && indice >= -1 && indice < demande.candidats.length;

  await tracer(runId, `arbitrage rendu page ${exigence.numero_page}`, 0, "succes", resultat.modele,
    resultat.tokens,
    valide
      ? indice === -1
        ? `"${demande.exige}" n'a aucun equivalent au profil. ${justification}`
        : `"${demande.exige}" equivaut a "${demande.candidats[indice]}". ${justification}`
      : `indice ${indice} hors bornes, traite comme une absence`);

  return { indice: valide ? indice : -1, tokens: resultat.tokens, modele: resultat.modele };
}

// --- Persistance ------------------------------------------------------------

async function lireExigences(documentId: string): Promise<LigneExigence[]> {
  const resultat = await pool.query<LigneExigence>(
    `SELECT id, numero_page, texte, citation, article, type, fait
       FROM requirements WHERE document_id = $1 ORDER BY numero_page, id`,
    [documentId],
  );
  return resultat.rows;
}

async function enregistrerEvaluation(
  documentId: string,
  exigence: LigneExigence,
  resultat: { statut: ResultatRegle["statut"]; preuve: string },
  origine: OrigineEvaluation,
  modele: string | null,
  bloquant = false,
): Promise<void> {
  await pool.query(
    `INSERT INTO evaluations (document_id, requirement_id, statut, preuve, bloquant, origine, modele)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (requirement_id) DO UPDATE
       SET statut = EXCLUDED.statut, preuve = EXCLUDED.preuve, bloquant = EXCLUDED.bloquant,
           origine = EXCLUDED.origine, modele = EXCLUDED.modele`,
    [documentId, exigence.id, resultat.statut, resultat.preuve, bloquant, origine, modele],
  );
}

async function enregistrerVerdict(
  documentId: string,
  verdict: string,
  annee: ReturnType<typeof determinerAnneeReference>,
  reserves: Reserves,
): Promise<void> {
  await pool.query(
    `UPDATE documents
        SET verdict = $2, statut_qualification = 'termine', motif_qualification = NULL,
            annee_reference = $3, origine_annee_reference = $4,
            complet = $5, composantes_manquantes = $6, reserve = $7
      WHERE id = $1`,
    [
      documentId,
      verdict,
      annee.annee,
      annee.origine,
      reserves.complet,
      reserves.composantesManquantes,
      reserves.motifs.length === 0 ? null : reserves.motifs.join(" ; "),
    ],
  );
}

/**
 * Cloture sans verdict. Le traitement a bien abouti, mais le systeme declare
 * qu'il ne peut pas conclure, et dit pourquoi.
 */
async function enregistrerSansVerdict(
  documentId: string,
  motif: string,
  annee: ReturnType<typeof determinerAnneeReference>,
): Promise<void> {
  await pool.query(
    `UPDATE documents
        SET verdict = NULL, statut_qualification = 'termine', motif_qualification = $2,
            annee_reference = $3, origine_annee_reference = $4
      WHERE id = $1`,
    [documentId, motif.slice(0, 500), annee.annee, annee.origine],
  );
}

async function majStatut(
  documentId: string,
  statut: "en_cours" | "termine" | "echec",
  motif: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE documents SET statut_qualification = $2, motif_qualification = $3 WHERE id = $1`,
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
