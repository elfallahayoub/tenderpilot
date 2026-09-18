import type { FastifyInstance } from "fastify";
import { assainir, variablesManquantes } from "../env.js";
import { pingPostgres } from "../shared/db.js";
import { pingRedis } from "../redis.js";

/** Au-dela, une dependance est declaree muette. Une sonde ne doit jamais pendre. */
const DELAI_SONDE_MS = 2500;

type EtatDependance = {
  ok: boolean;
  latenceMs: number;
  detail: string | null;
};

type Sante = {
  statut: "ok" | "degrade";
  service: string;
  horodatage: string;
  postgres: EtatDependance;
  redis: EtatDependance;
  /** Noms seuls. Jamais de valeur : le depot est public. */
  variablesManquantes: string[];
};

/** Rejette si la promesse ne repond pas dans le delai imparti. */
function avecDelai<T>(promesse: Promise<T>, delaiMs: number): Promise<T> {
  return new Promise<T>((resoudre, rejeter) => {
    const minuteur = setTimeout(() => {
      rejeter(new Error(`aucune reponse en ${delaiMs} ms`));
    }, delaiMs);
    promesse.then(
      (valeur) => {
        clearTimeout(minuteur);
        resoudre(valeur);
      },
      (erreur: unknown) => {
        clearTimeout(minuteur);
        rejeter(erreur instanceof Error ? erreur : new Error(String(erreur)));
      },
    );
  });
}

/**
 * Execute un ping, mesure sa latence, et borne son temps d'attente.
 * Un driver qui empile ses commandes au lieu d'echouer ne doit pas pouvoir
 * transformer la route de sante en attente silencieuse.
 */
async function sonder(ping: () => Promise<void>): Promise<EtatDependance> {
  const debut = performance.now();
  try {
    await avecDelai(ping(), DELAI_SONDE_MS);
    return { ok: true, latenceMs: Math.round(performance.now() - debut), detail: null };
  } catch (erreur) {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    return {
      ok: false,
      latenceMs: Math.round(performance.now() - debut),
      detail: assainir(message),
    };
  }
}

export async function routeSante(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_requete, reponse) => {
    const [postgres, redis] = await Promise.all([sonder(pingPostgres), sonder(pingRedis)]);
    const manquantes = variablesManquantes();

    // Une dependance muette ou une variable absente degrade le service.
    // On repond 503 : le jury doit voir la panne, pas un faux vert.
    const enBonneSante = postgres.ok && redis.ok && manquantes.length === 0;

    const corps: Sante = {
      statut: enBonneSante ? "ok" : "degrade",
      service: "tenderpilot-api",
      horodatage: new Date().toISOString(),
      postgres,
      redis,
      variablesManquantes: [...manquantes],
    };

    return reponse.code(enBonneSante ? 200 : 503).send(corps);
  });
}
