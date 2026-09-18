import { UnrecoverableError, type Job } from "bullmq";
import { z } from "zod";
import { pool } from "./shared/db.js";
import { journaliser, journaliserSansBloquer } from "./shared/journal.js";
import { appelerModele, calculerEmbedding, versVecteurSql } from "./shared/llm.js";
import { chiffresNonSources } from "./shared/chiffres.js";
import { objetDeLAvis } from "./shared/objet.js";
import { normaliserTexte } from "./shared/regles.js";
import type { CategorieExigence, StatutEvenement } from "./shared/types.js";

const AGENT = "writer";

/** Une section fait une page au plus : le plafond est genereux sans etre ouvert. */
const JETONS_PAR_SECTION = 1400;

/** Une regeneration, pas deux. Ensuite la section est rendue a l'humain. */
const REGENERATIONS_MAX = 1;

/** Candidats proposes au Writer pour la section des references. */
const CANDIDATS_MAX = 5;

export type TravailRedaction = {
  documentId: string;
};

type Section = {
  ordre: number;
  titre: string;
  brief: string;
  categories: CategorieExigence[];
  avecReferences: boolean;
  avecEquipe: boolean;
};

/**
 * Le plan du memoire. Sept sections, alignees sur les cinq des memoires deja
 * rendus par l'entreprise et sur la grille de notation de l'article 6, qui
 * note la valeur technique, l'equipe proposee et les references.
 */
const SECTIONS: Section[] = [
  {
    ordre: 1,
    titre: "Compréhension du besoin",
    brief:
      "Reformule le besoin du maitre d'ouvrage et les enjeux que l'objet du marche implique. Nomme les risques que tu deduis des exigences fournies.",
    categories: ["technique", "delai"],
    avecReferences: false,
    avecEquipe: false,
  },
  {
    ordre: 2,
    titre: "Méthodologie proposée",
    brief:
      "Decris la demarche d'execution par phases, les jalons et les livrables, en repondant aux exigences techniques et de delai fournies.",
    categories: ["technique", "delai"],
    avecReferences: false,
    avecEquipe: false,
  },
  {
    ordre: 3,
    titre: "Organisation et gouvernance",
    brief:
      "Decris les instances de pilotage, les rythmes de reunion et l'interlocuteur unique du maitre d'ouvrage.",
    categories: ["equipe"],
    avecReferences: false,
    avecEquipe: false,
  },
  {
    ordre: 4,
    titre: "Plan d'assurance qualité",
    brief:
      "Decris les livrables, les criteres d'acceptation, la gestion des anomalies et les indicateurs de suivi.",
    categories: ["technique"],
    avecReferences: false,
    avecEquipe: false,
  },
  {
    ordre: 5,
    titre: "Équipe proposée",
    brief:
      "Presente l'equipe mobilisee en te fondant UNIQUEMENT sur les membres fournis, designes par leurs initiales. Montre en quoi elle repond aux exigences de profil.",
    categories: ["equipe"],
    avecReferences: false,
    avecEquipe: true,
  },
  {
    ordre: 6,
    titre: "Références similaires",
    brief:
      "Presente les references fournies et leur pertinence au regard de l'objet du marche. Cite chaque reference par son identifiant.",
    categories: ["technique"],
    avecReferences: true,
    avecEquipe: false,
  },
  {
    ordre: 7,
    titre: "Transfert de compétences",
    brief:
      "Decris la documentation remise, les sessions de formation et l'accompagnement apres mise en service.",
    categories: ["technique"],
    avecReferences: false,
    avecEquipe: false,
  },
];

const schemaSection = z.object({
  paragraphes: z.array(z.string().min(20)).min(1),
  referencesCitees: z.array(z.string()),
});

const SCHEMA_JSON_SECTION = {
  type: "object",
  additionalProperties: false,
  required: ["paragraphes", "referencesCitees"],
  properties: {
    paragraphes: {
      type: "array",
      items: { type: "string" },
      description: "Deux a quatre paragraphes de prose continue, sans titre ni puce.",
    },
    referencesCitees: {
      type: "array",
      items: { type: "string" },
      description:
        "Identifiants des references citees dans le texte, par exemple REF-02. Liste vide si aucune.",
    },
  },
};

const SYSTEME = `Tu rediges une section de memoire technique pour une reponse a
appel d'offres public marocain, au nom de l'entreprise candidate.

REGLES ABSOLUES.

1. TU N'ECRIS AUCUN NOMBRE qui ne figure pas dans la matiere qu'on te donne.
   Cette regle vaut pour les chiffres COMME pour les nombres ecrits en toutes
   lettres : "deux mille vingt-deux", "quatre phases" et "trois comites" sont
   des nombres au meme titre que 2022, 4 et 3.
   - Une valeur fournie se recopie EN CHIFFRES, telle qu'elle est donnee.
   - Tu n'introduis aucun denombrement de ton cru. Ecris "des phases
     successives" et non "quatre phases", "les comites de pilotage" et non
     "trois comites".
   Un seul nombre non fourni fait rejeter toute la section.
2. Tu ne cites AUCUNE reference client qui ne figure pas dans la liste fournie,
   et tu la designes par son identifiant exact, par exemple REF-02. Inventer une
   reference fait rejeter toute la section.
3. Tu n'inventes aucun nom de personne, aucun client, aucune certification,
   aucune date. Tout ce que tu affirmes doit venir de la matiere fournie.
4. Tu ecris en francais, en prose continue, a la premiere personne du pluriel.
   Deux a quatre paragraphes. Pas de titre, pas de puce, pas de tableau.
5. L'extrait de style qu'on te montre indique le ton et le niveau de detail
   attendus. Tu ne le recopies pas.`;

// --- Traitement -------------------------------------------------------------

export async function traiterRedaction(job: Job<TravailRedaction>): Promise<{
  sections: number;
  aCompleter: number;
  rejets: number;
  tokens: number;
}> {
  const { documentId } = job.data;
  const runId = documentId;
  const debutTotal = performance.now();

  const maxTentatives = job.opts.attempts ?? 1;
  const tentative = job.attemptsMade + 1;

  try {
    await majStatut(documentId, "en_cours", null);

    const objet = await lireObjet(documentId, runId);
    const exigences = await lireExigences(documentId);
    const equipe = await lireEquipe();
    const candidats = await lireCandidats(documentId, objet, runId);

    await tracer(runId, "plan de redaction", 0, "succes", null, null,
      `${SECTIONS.length} sections, ${exigences.length} exigences disponibles, ` +
        `${candidats.length} references candidates, un appel par section`);

    // Une reprise ne doit pas empiler les sections.
    await pool.query(`DELETE FROM sections_memoire WHERE document_id = $1`, [documentId]);

    let aCompleter = 0;
    let rejets = 0;
    let tokens = 0;

    for (const section of SECTIONS) {
      const resultat = await redigerSection(runId, documentId, section, {
        objet,
        exigences,
        equipe,
        candidats,
      });
      tokens += resultat.tokens;
      rejets += resultat.rejets;
      if (resultat.statut === "a_completer") aCompleter += 1;
    }

    await majStatut(documentId, "termine", null);
    await tracer(runId, "memoire redige", Math.round(performance.now() - debutTotal), "succes", null, null,
      `${SECTIONS.length - aCompleter} sections redigees sur ${SECTIONS.length}, ` +
        `${aCompleter} a completer par l'humain, ${rejets} rejets de garde-fou`);

    return { sections: SECTIONS.length, aCompleter, rejets, tokens };
  } catch (erreur) {
    const message = (erreur instanceof Error ? erreur.message : String(erreur)).replace(/\.$/, "");
    const duree = Math.round(performance.now() - debutTotal);

    if (erreur instanceof UnrecoverableError) {
      await majStatut(documentId, "echec", message);
      await tracerSansBloquer(runId, "redaction impossible", duree, "echec", message);
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

// --- Redaction d'une section ------------------------------------------------

type Matiere = {
  objet: string;
  exigences: LigneExigence[];
  equipe: LigneEquipe[];
  candidats: LigneReference[];
};

async function redigerSection(
  runId: string,
  documentId: string,
  section: Section,
  matiere: Matiere,
): Promise<{ statut: "redigee" | "a_completer"; tokens: number; rejets: number }> {
  const exigences = matiere.exigences.filter((exigence) =>
    section.categories.includes(exigence.categorie),
  );
  const candidats = section.avecReferences ? matiere.candidats : [];
  const equipe = section.avecEquipe ? matiere.equipe : [];

  // La matiere autorisee pour les chiffres. L'extrait de style en est exclu :
  // il a deja ete prive de ses nombres au seed, et le montant d'un ancien
  // marche n'a rien a faire dans ce memoire.
  const materiau = construireMateriau(matiere.objet, exigences, equipe, candidats);
  const style = await lireExtraitDeStyle(section.titre, runId);

  let tokens = 0;
  let rejets = 0;
  let dernierMotif = "aucune tentative";

  for (let essai = 0; essai <= REGENERATIONS_MAX; essai += 1) {
    const resultat = await appelerModele({
      usage: "redaction",
      systeme: SYSTEME,
      utilisateur: construirePrompt(section, matiere.objet, exigences, equipe, candidats, style, essai > 0 ? dernierMotif : null),
      schema: schemaSection,
      schemaJson: SCHEMA_JSON_SECTION,
      nomSchema: "section_memoire",
      maxTokens: JETONS_PAR_SECTION,
      runId,
      agent: AGENT,
      etape: `redaction ${section.titre}`,
    });

    tokens += resultat.tokens;

    if (resultat.statut === "indetermine") {
      dernierMotif = `le modele n'a pas rendu de sortie valide : ${resultat.motif}`;
      rejets += 1;
      continue;
    }

    const texte = resultat.valeur.paragraphes.join("\n\n");
    const controle = verifierSection(texte, resultat.valeur.referencesCitees, candidats, materiau);

    if (controle.ok) {
      await enregistrerSection(documentId, section, texte, "redigee", null,
        controle.references, resultat.modele, resultat.tokens, essai + 1);
      await tracer(runId, `section verifiee : ${section.titre}`, 0, "succes", null, null,
        `garde-fous passes${essai > 0 ? " apres une regeneration" : ""} : ` +
          `${controle.references.length} references citees, toutes existantes et fournies ; ` +
          "aucun chiffre hors matiere");
      return { statut: "redigee", tokens, rejets };
    }

    rejets += 1;
    dernierMotif = controle.motif;

    const derniere = essai === REGENERATIONS_MAX;
    await tracer(runId, `section rejetee : ${section.titre}`, 0, derniere ? "escalade" : "reprise",
      null, null,
      `${controle.motif}. ${derniere ? "Section rendue a l'humain." : "Regeneration."}`);
  }

  await enregistrerSection(documentId, section, "", "a_completer", dernierMotif, [], null, null,
    REGENERATIONS_MAX + 1);
  return { statut: "a_completer", tokens, rejets };
}

// --- Les trois garde-fous ---------------------------------------------------

/** Tout identifiant de reference apparaissant dans la prose. */
const REFERENCE_DANS_LE_TEXTE = /REF-\d+/gi;

type Controle =
  | { ok: true; references: string[] }
  | { ok: false; motif: string };

/**
 * Trois verifications, toutes par code, aucune par le modele.
 *
 * 1. Chaque reference citee existe ET figurait parmi les candidates fournies :
 *    le Writer ne peut donc pas inventer un identifiant plausible.
 * 2. Aucun identifiant present dans la prose n'echappe a cette verification.
 * 3. Aucun nombre ecrit en chiffres n'est absent de la matiere fournie.
 */
export function verifierSection(
  texte: string,
  declarees: string[],
  candidats: { id: string }[],
  materiau: string,
): Controle {
  const autorisees = new Set(candidats.map((candidat) => candidat.id.toUpperCase()));

  const dansLeTexte = new Set(
    (texte.match(REFERENCE_DANS_LE_TEXTE) ?? []).map((brut) => brut.toUpperCase()),
  );
  const citees = new Set([...declarees.map((id) => id.trim().toUpperCase()), ...dansLeTexte]);

  const inconnues = [...citees].filter((id) => !autorisees.has(id));
  if (inconnues.length > 0) {
    return {
      ok: false,
      motif:
        `reference${inconnues.length > 1 ? "s" : ""} citee${inconnues.length > 1 ? "s" : ""} ` +
        `hors de la liste fournie : ${inconnues.join(", ")}`,
    };
  }

  const nonSources = chiffresNonSources(texte, materiau);
  if (nonSources.length > 0) {
    return {
      ok: false,
      motif: `chiffre${nonSources.length > 1 ? "s" : ""} absent${
        nonSources.length > 1 ? "s" : ""
      } de la matiere fournie : ${nonSources.join(", ")}`,
    };
  }

  return { ok: true, references: [...citees].sort() };
}

// --- Matiere et prompt ------------------------------------------------------

type LigneExigence = {
  texte: string;
  categorie: CategorieExigence;
  preuve: string | null;
};

type LigneEquipe = {
  initiales: string;
  poste: string;
  annees_experience: number;
};

type LigneReference = {
  id: string;
  client: string;
  secteur: string;
  objet: string;
  montant_ht_mad: string;
  annee_debut: number;
  duree_mois: number;
  attestation_bonne_execution: boolean;
};

function decrireExigence(exigence: LigneExigence): string {
  return `- ${exigence.texte}${exigence.preuve ? ` (constat : ${exigence.preuve})` : ""}`;
}

function decrireReference(reference: LigneReference): string {
  return (
    `- ${reference.id} : ${reference.client}, secteur ${reference.secteur}, ` +
    `${reference.objet}, ${reference.montant_ht_mad} MAD HT, ` +
    `demarre en ${reference.annee_debut}, duree ${reference.duree_mois} mois, ` +
    // Sans cette donnee, le modele inventait un decompte : il ecrivait
    // "Deux de ces references sont appuyees par des attestations".
    (reference.attestation_bonne_execution
      ? "appuyee par une attestation de bonne execution"
      : "sans attestation de bonne execution")
  );
}

function decrireMembre(membre: LigneEquipe): string {
  return `- ${membre.initiales}, ${membre.poste}, ${membre.annees_experience} ans d'experience`;
}

/** Exactement ce qui autorise un chiffre. Rien d'autre. */
function construireMateriau(
  objet: string,
  exigences: LigneExigence[],
  equipe: LigneEquipe[],
  candidats: LigneReference[],
): string {
  return [
    objet,
    ...exigences.map(decrireExigence),
    ...equipe.map(decrireMembre),
    ...candidats.map(decrireReference),
  ].join("\n");
}

function construirePrompt(
  section: Section,
  objet: string,
  exigences: LigneExigence[],
  equipe: LigneEquipe[],
  candidats: LigneReference[],
  style: string | null,
  correction: string | null,
): string {
  const morceaux: string[] = [
    `Section a rediger : ${section.titre}`,
    section.brief,
    "",
    `Objet du marche : ${objet}`,
  ];

  if (exigences.length > 0) {
    morceaux.push("", "Exigences de l'avis qui concernent cette section :", ...exigences.map(decrireExigence));
  }
  if (equipe.length > 0) {
    morceaux.push("", "Membres de l'equipe disponibles, a designer par leurs initiales :", ...equipe.map(decrireMembre));
  }
  if (candidats.length > 0) {
    morceaux.push(
      "",
      "References de l'entreprise que tu peux citer, et AUCUNE AUTRE :",
      ...candidats.map(decrireReference),
    );
  } else {
    morceaux.push("", "Tu ne cites aucune reference client dans cette section.");
  }
  if (style !== null) {
    morceaux.push(
      "",
      "Extrait d'un memoire deja rendu par l'entreprise, pour le ton seulement.",
      "Ses nombres ont ete retires : n'en invente aucun pour les remplacer.",
      style,
    );
  }
  if (correction !== null) {
    morceaux.push(
      "",
      `La version precedente a ete REJETEE : ${correction}.`,
      "Corrige ce point precis. N'ecris aucun nombre absent de la matiere, ni en chiffres ni en lettres.",
    );
  }

  return morceaux.join("\n");
}

// --- Lectures en base -------------------------------------------------------

async function lireObjet(documentId: string, runId: string): Promise<string> {
  const pages = await pool.query<{ texte: string }>(
    `SELECT texte FROM pages WHERE document_id = $1 AND lisible ORDER BY numero`,
    [documentId],
  );
  const objet = objetDeLAvis(pages.rows.map((page) => page.texte));

  if (objet === null) {
    throw new UnrecoverableError("objet du marche introuvable : aucun memoire ne peut etre redige");
  }
  await tracer(runId, "objet du marche", 0, "succes", null, null, objet);
  return objet;
}

async function lireExigences(documentId: string): Promise<LigneExigence[]> {
  const resultat = await pool.query<LigneExigence>(
    `SELECT r.texte, r.categorie, v.preuve
       FROM requirements r
       LEFT JOIN evaluations v ON v.requirement_id = r.id
      WHERE r.document_id = $1
      ORDER BY r.numero_page, r.id`,
    [documentId],
  );
  return resultat.rows;
}

async function lireEquipe(): Promise<LigneEquipe[]> {
  const resultat = await pool.query<LigneEquipe>(
    `SELECT initiales, poste, annees_experience FROM equipe ORDER BY poste, annees_experience DESC`,
  );
  return resultat.rows;
}

/**
 * References candidates.
 *
 * La similarite ORDONNE, elle ne filtre pas. Le secteur et l'anciennete sont
 * des contraintes chiffrees : elles sont appliquees en SQL, avant le tri. Une
 * reference hors secteur ne peut donc pas remonter parce qu'elle "ressemble".
 */
async function lireCandidats(
  documentId: string,
  objet: string,
  runId: string,
): Promise<LigneReference[]> {
  const contrainte = await pool.query<{ secteur: string; annees_max: number }>(
    `SELECT r.fait->>'secteur' AS secteur, (r.fait->>'anneesMax')::int AS annees_max
       FROM requirements r
      WHERE r.document_id = $1 AND r.fait->>'kind' = 'references_min'
      LIMIT 1`,
    [documentId],
  );
  const filtre = contrainte.rows[0] ?? null;

  const document = await pool.query<{ annee_reference: number | null }>(
    `SELECT annee_reference FROM documents WHERE id = $1`,
    [documentId],
  );
  const annee = document.rows[0]?.annee_reference ?? new Date().getFullYear();

  // Le secteur exige est resolu vers la valeur exacte de la colonne, avec la
  // meme normalisation que le moteur de regles. La comparaison SQL reste
  // ensuite une egalite stricte : le filtre ne depend d'aucune approximation.
  let secteurExact: string | null = null;
  if (filtre?.secteur) {
    const secteurs = await pool.query<{ secteur: string }>(
      `SELECT DISTINCT secteur FROM references_client`,
    );
    const cible = normaliserTexte(filtre.secteur);
    secteurExact =
      secteurs.rows.find((ligne) => normaliserTexte(ligne.secteur) === cible)?.secteur ?? null;
  }

  const vecteur = await calculerEmbedding(objet, {
    runId,
    agent: AGENT,
    etape: "vectorisation de l'objet du marche",
  });

  const resultat = await pool.query<LigneReference>(
    `SELECT id, client, secteur, objet, montant_ht_mad, annee_debut, duree_mois,
            attestation_bonne_execution
       FROM references_client
      WHERE embedding IS NOT NULL
        AND ($2::text IS NULL OR secteur = $2)
        AND ($3::int  IS NULL OR annee_debut >= $3)
      ORDER BY embedding <=> $1::vector
      LIMIT ${CANDIDATS_MAX}`,
    [
      versVecteurSql(vecteur),
      secteurExact,
      filtre === null ? null : annee - filtre.annees_max,
    ],
  );

  await tracer(runId, "recherche des references", 0, "succes", null, null,
    filtre === null
      ? `${resultat.rowCount} references, classees par proximite semantique avec l'objet`
      : `${resultat.rowCount} references, filtrees en SQL sur le secteur "${filtre.secteur}" et ` +
        `l'annee ${annee - filtre.annees_max} au plus tot, puis classees par proximite semantique`);

  return resultat.rows;
}

/**
 * Extrait de style le plus proche de la section a rediger, par recherche
 * semantique sur les memoires deja rendus. Ces extraits ont ete prives de
 * leurs nombres au seed : ils donnent le ton, jamais des valeurs.
 */
async function lireExtraitDeStyle(titre: string, runId: string): Promise<string | null> {
  const vecteur = await calculerEmbedding(titre, {
    runId,
    agent: AGENT,
    etape: `recherche de style : ${titre}`,
  });

  const resultat = await pool.query<{ texte: string }>(
    `SELECT texte FROM extraits_offres_passees
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT 1`,
    [versVecteurSql(vecteur)],
  );
  return resultat.rows[0]?.texte ?? null;
}

// --- Persistance ------------------------------------------------------------

async function enregistrerSection(
  documentId: string,
  section: Section,
  contenu: string,
  statut: "redigee" | "a_completer",
  motif: string | null,
  references: string[],
  modele: string | null,
  tokens: number | null,
  tentatives: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO sections_memoire
       (document_id, ordre, titre, contenu, statut, motif, references_citees, modele, tokens, tentatives)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (document_id, ordre) DO UPDATE
       SET titre = EXCLUDED.titre, contenu = EXCLUDED.contenu, statut = EXCLUDED.statut,
           motif = EXCLUDED.motif, references_citees = EXCLUDED.references_citees,
           modele = EXCLUDED.modele, tokens = EXCLUDED.tokens, tentatives = EXCLUDED.tentatives`,
    [documentId, section.ordre, section.titre, contenu, statut, motif, references, modele, tokens, tentatives],
  );
}

async function majStatut(
  documentId: string,
  statut: "en_cours" | "termine" | "echec",
  motif: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE documents SET statut_memoire = $2, motif_memoire = $3 WHERE id = $1`,
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
