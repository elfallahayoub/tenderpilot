import IORedis from "ioredis";

/**
 * Client Redis unique pour tout le processus.
 *
 * enableOfflineQueue a false : sans cela, une commande envoyee pendant que
 * Redis est tombe reste empilee indefiniment au lieu d'echouer. La route de
 * sante attendait alors sans fin et ne signalait jamais la panne. On veut
 * l'inverse : une erreur immediate, visible, plutot qu'une attente muette.
 */
export const redis = new IORedis(process.env.REDIS_URL ?? "redis://redis:6379", {
  maxRetriesPerRequest: null,
  enableOfflineQueue: false,
  lazyConnect: false,
});

redis.on("error", (erreur) => {
  console.error("[redis] erreur de connexion :", erreur.message);
});

/** Ping minimal, utilise par la route de sante. */
export async function pingRedis(): Promise<void> {
  const reponse = await redis.ping();
  if (reponse !== "PONG") {
    throw new Error(`reponse inattendue au PING : ${reponse}`);
  }
}

export async function fermerRedis(): Promise<void> {
  await redis.quit();
}
