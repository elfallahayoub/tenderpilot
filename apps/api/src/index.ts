import Fastify from "fastify";
import cors from "@fastify/cors";
import { routeSante } from "./routes/health.js";
import { fermerPostgres } from "./db.js";
import { fermerRedis } from "./redis.js";

const PORT = Number(process.env.API_PORT ?? 3000);

const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === "production" ? "info" : "debug",
    transport: undefined,
  },
});

// L'interface est servie par Vite sur un autre port : elle appelle l'API
// en direct, donc CORS est necessaire en developpement.
await app.register(cors, { origin: true });
await app.register(routeSante);

app.get("/", async () => ({
  service: "tenderpilot-api",
  message: "API operationnelle. Etat detaille sur /health.",
}));

/** Arret propre : Docker envoie SIGTERM, les connexions doivent se fermer. */
async function arreter(signal: string): Promise<void> {
  app.log.info(`signal ${signal} recu, arret en cours`);
  try {
    await app.close();
    await Promise.allSettled([fermerPostgres(), fermerRedis()]);
  } finally {
    process.exit(0);
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => void arreter(signal));
}

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`API prete sur le port ${PORT}`);
} catch (erreur) {
  app.log.error(erreur);
  process.exit(1);
}
