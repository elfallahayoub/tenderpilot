import { createHash } from "node:crypto";
import IORedis from "ioredis";
import type { z } from "zod";
import { journaliser } from "./journal.js";

/**
 * Module unique de tout appel au modele.
 *
 * Aucun autre fichier du projet n'appelle un service de modele. C'est ce qui
 * rend le routage demontrable : il est ici, en une table, et nulle part
 * ailleurs.
 *
 * Quatre garanties sont tenues a cet endroit et a cet endroit seulement :
 * le routage par usage, la validation zod avec deux reprises au maximum puis
 * escalade, la journalisation du modele, des jetons reels et de la duree, et
 * le cache Redis sur l'empreinte du prompt.
 */

export type Modele = "gpt-4.1" | "gpt-5.5";

/**
 * Usage declare par l'appelant. Un agent declare ce qu'il fait, jamais quel
 * modele il veut : le choix est une decision d'architecture, pas une decision
 * locale.
 */
export type Usage =
  | "extraction"
  | "classification"
  | "resume"
  | "redaction"
  // Reserves a l'Orchestrator et au Qualifier en cas ambigu.
  | "orchestration"
  | "arbitrage";

/**
 * La table de routage. gpt-5.5 raisonne et arbitre, gpt-4.1 lit et redige.
 * Appeler gpt-5.5 pour de l'extraction coute des points au CLAUDE.md, et
 * l'inverse coute de la fiabilite sur les arbitrages.
 */
export const ROUTAGE: Record<Usage, Modele> = {
  extraction: "gpt-4.1",
  classification: "gpt-4.1",
  resume: "gpt-4.1",
  redaction: "gpt-4.1",
  orchestration: "gpt-5.5",
  arbitrage: "gpt-5.5",
};

/** Une reponse invalide est reprise deux fois au maximum, puis escaladee. */
export const REPRISES_MAX = 2;

/** Plafond absolu, quel que soit ce que demande l'appelant. */
const PLAFOND_JETONS = Number(process.env.AZURE_OPENAI_MAX_TOKENS ?? 16384);

const DUREE_CACHE_SECONDES = 7 * 24 * 60 * 60;

const redis = new IORedis(process.env.REDIS_URL ?? "redis://redis:6379", {
  maxRetriesPerRequest: 2,
});

redis.on("error", (erreur) => {
  console.error("[llm] cache indisponible :", erreur.message);
});

export type OptionsAppel<T> = {
  usage: Usage;
  systeme: string;
  utilisateur: string;
  /** Validation du contenu, apres que le service a garanti la forme. */
  schema: z.ZodType<T>;
  /** Le meme contrat en JSON Schema, applique en mode strict par le service. */
  schemaJson: unknown;
  nomSchema: string;
  maxTokens: number;
  /** Contexte de journalisation. */
  runId: string;
  agent: string;
  etape: string;
};

export type ResultatAppel<T> =
  | { statut: "ok"; valeur: T; modele: Modele; tokens: number; dureeMs: number; depuisLeCache: boolean }
  | { statut: "indetermine"; motif: string; modele: Modele; tokens: number };

type ReponseService = {
  contenu: string;
  tokens: number;
};

/**
 * Appelle le modele associe a l'usage declare, valide la sortie, et journalise.
 * Ne rend jamais une valeur devinee : en cas d'echec repete, le statut vaut
 * `indetermine` et l'etape est escaladee.
 */
export async function appelerModele<T>(options: OptionsAppel<T>): Promise<ResultatAppel<T>> {
  const modele = ROUTAGE[options.usage];
  const maxTokens = Math.min(Math.max(1, options.maxTokens), PLAFOND_JETONS);

  const cle = empreinteAppel(modele, options, maxTokens);

  // --- Cache -------------------------------------------------------------
  const enCache = await lireCache(cle);
  if (enCache !== null) {
    const analyse = analyser(options.schema, enCache);
    if (analyse.ok) {
      await journaliser({
        runId: options.runId,
        agent: options.agent,
        etape: options.etape,
        modele,
        tokens: 0,
        dureeMs: 0,
        statut: "succes",
        detail: "reponse servie par le cache, aucun jeton facture",
      });
      return {
        statut: "ok",
        valeur: analyse.valeur,
        modele,
        tokens: 0,
        dureeMs: 0,
        depuisLeCache: true,
      };
    }
    // Entree devenue incompatible avec le schema : on la jette.
    await redis.del(cle).catch(() => undefined);
  }

  // --- Appels, avec reprises bornees --------------------------------------
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: options.systeme },
    { role: "user", content: options.utilisateur },
  ];

  let jetonsCumules = 0;
  let dernierMotif = "aucun appel effectue";

  for (let tentative = 0; tentative <= REPRISES_MAX; tentative += 1) {
    const debut = performance.now();
    let reponse: ReponseService;

    try {
      reponse = await interroger(modele, messages, maxTokens, options);
    } catch (erreur) {
      dernierMotif = erreur instanceof Error ? erreur.message : String(erreur);
      const dureeMs = Math.round(performance.now() - debut);
      const derniere = tentative === REPRISES_MAX;
      await journaliser({
        runId: options.runId,
        agent: options.agent,
        etape: options.etape,
        modele,
        tokens: null,
        dureeMs,
        statut: derniere ? "escalade" : "reprise",
        detail: derniere
          ? `service injoignable : ${dernierMotif}. ${REPRISES_MAX} reprises epuisees.`
          : `service injoignable : ${dernierMotif}. Reprise ${tentative + 1} sur ${REPRISES_MAX}.`,
      });
      continue;
    }

    const dureeMs = Math.round(performance.now() - debut);
    jetonsCumules += reponse.tokens;

    const analyse = analyser(options.schema, reponse.contenu);
    if (analyse.ok) {
      await ecrireCache(cle, reponse.contenu);
      await journaliser({
        runId: options.runId,
        agent: options.agent,
        etape: options.etape,
        modele,
        tokens: reponse.tokens,
        dureeMs,
        statut: "succes",
        detail:
          tentative === 0
            ? "sortie valide au premier appel"
            : `sortie valide apres ${tentative} reprise${tentative > 1 ? "s" : ""}`,
      });
      return {
        statut: "ok",
        valeur: analyse.valeur,
        modele,
        tokens: reponse.tokens,
        dureeMs,
        depuisLeCache: false,
      };
    }

    dernierMotif = analyse.motif;
    const derniere = tentative === REPRISES_MAX;

    await journaliser({
      runId: options.runId,
      agent: options.agent,
      etape: options.etape,
      modele,
      tokens: reponse.tokens,
      dureeMs,
      statut: derniere ? "escalade" : "reprise",
      detail: derniere
        ? `sortie invalide : ${dernierMotif}. ${REPRISES_MAX} reprises epuisees, statut indetermine.`
        : `sortie invalide : ${dernierMotif}. Reprise ${tentative + 1} sur ${REPRISES_MAX}.`,
    });

    if (!derniere) {
      // On renvoie l'erreur au modele plutot que de relancer le meme prompt.
      messages.push({ role: "assistant", content: reponse.contenu.slice(0, 2000) });
      messages.push({
        role: "user",
        content: `Ta reponse precedente est invalide : ${dernierMotif}. Corrige-la et renvoie uniquement le JSON attendu.`,
      });
    }
  }

  return { statut: "indetermine", motif: dernierMotif, modele, tokens: jetonsCumules };
}

// --- Dialectes des deux services -------------------------------------------

/**
 * Les deux modeles ne parlent pas le meme protocole : gpt-4.1 passe par l'URL
 * de deploiement Azure avec un en-tete api-key et `max_tokens`, gpt-5.5 par la
 * surface v1 avec un jeton porteur, le modele dans le corps et
 * `max_completion_tokens`. Cette difference est contenue ici.
 */
async function interroger(
  modele: Modele,
  messages: { role: string; content: string }[],
  maxTokens: number,
  options: OptionsAppel<unknown>,
): Promise<ReponseService> {
  const responseFormat = {
    type: "json_schema",
    json_schema: { name: options.nomSchema, strict: true, schema: options.schemaJson },
  };

  let url: string;
  let entetes: Record<string, string>;
  let corps: Record<string, unknown>;

  if (modele === "gpt-4.1") {
    const base = exiger("AZURE_OPENAI_ENDPOINT");
    const deploiement = exiger("AZURE_OPENAI_DEPLOYMENT_NAME");
    const version = exiger("AZURE_OPENAI_API_VERSION");
    url = `${base}openai/deployments/${deploiement}/chat/completions?api-version=${version}`;
    entetes = { "Content-Type": "application/json", "api-key": exiger("AZURE_OPENAI_API_KEY") };
    corps = { messages, max_tokens: maxTokens, temperature: 0, response_format: responseFormat };
  } else {
    const base = exiger("LLM_URL");
    url = `${base}/chat/completions`;
    entetes = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${exiger("LLM_API_KEY")}`,
    };
    corps = {
      model: exiger("LLM_MODEL"),
      messages,
      max_completion_tokens: maxTokens,
      response_format: responseFormat,
    };
  }

  const reponse = await fetch(url, {
    method: "POST",
    headers: entetes,
    body: JSON.stringify(corps),
  });

  if (!reponse.ok) {
    const detail = (await reponse.text()).slice(0, 200);
    throw new Error(`HTTP ${reponse.status} : ${detail}`);
  }

  const json = (await reponse.json()) as {
    choices?: { message?: { content?: string | null } }[];
    usage?: { total_tokens?: number };
  };

  const contenu = json.choices?.[0]?.message?.content;
  if (typeof contenu !== "string" || contenu.length === 0) {
    throw new Error("le service a repondu sans contenu");
  }

  return { contenu, tokens: json.usage?.total_tokens ?? 0 };
}

/** Lecture d'une variable obligatoire. Sa valeur n'est jamais journalisee. */
function exiger(nom: string): string {
  const valeur = process.env[nom];
  if (!valeur || valeur.trim() === "") {
    throw new Error(`variable d'environnement absente : ${nom}`);
  }
  return valeur;
}

// --- Validation et cache ----------------------------------------------------

type Analyse<T> = { ok: true; valeur: T } | { ok: false; motif: string };

function analyser<T>(schema: z.ZodType<T>, contenu: string): Analyse<T> {
  let json: unknown;
  try {
    json = JSON.parse(contenu);
  } catch (erreur) {
    return { ok: false, motif: `JSON illisible (${(erreur as Error).message})` };
  }

  const resultat = schema.safeParse(json);
  if (!resultat.success) {
    const premiere = resultat.error.issues[0];
    const chemin = premiere?.path.join(".") ?? "racine";
    return { ok: false, motif: `${chemin} : ${premiere?.message ?? "schema non respecte"}` };
  }
  return { ok: true, valeur: resultat.data };
}

/**
 * Cle de cache : empreinte du modele, des deux prompts, du schema et du
 * plafond de jetons. Deux appels identiques ne sont donc factures qu'une fois.
 */
function empreinteAppel(modele: Modele, options: OptionsAppel<unknown>, maxTokens: number): string {
  const empreinte = createHash("sha256")
    .update(modele)
    .update(" ")
    .update(options.systeme)
    .update(" ")
    .update(options.utilisateur)
    .update(" ")
    .update(options.nomSchema)
    .update(" ")
    .update(String(maxTokens))
    .digest("hex");
  return `llm:${empreinte}`;
}

async function lireCache(cle: string): Promise<string | null> {
  try {
    return await redis.get(cle);
  } catch {
    // Un cache indisponible ne doit pas empecher d'appeler le modele.
    return null;
  }
}

async function ecrireCache(cle: string, contenu: string): Promise<void> {
  try {
    await redis.set(cle, contenu, "EX", DUREE_CACHE_SECONDES);
  } catch {
    // Sans consequence : le prochain appel sera simplement refacture.
  }
}

export async function fermerLlm(): Promise<void> {
  await redis.quit();
}
