import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { routeSante } from "./routes/health.js";
import { routesDocuments } from "./routes/documents.js";
import { routesExigences } from "./routes/exigences.js";
import { fermerPostgres } from "./shared/db.js";
import { fermerRedis } from "./redis.js";
import { fermerFile } from "./queue.js";
import { TAILLE_MAX_OCTETS } from "./stockage.js";

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
// Un seul fichier par depot, plafonne. Au-dela, @fastify/multipart repond 413.
await app.register(multipart, {
  limits: { fileSize: TAILLE_MAX_OCTETS, files: 1 },
});
await app.register(routeSante);
await app.register(routesDocuments);
await app.register(routesExigences);

app.get("/", async () => ({
  service: "tenderpilot-api",
  message: "API operationnelle. Etat detaille sur /health.",
}));

/** Arret propre : Docker envoie SIGTERM, les connexions doivent se fermer. */
async function arreter(signal: string): Promise<void> {
  app.log.info(`signal ${signal} recu, arret en cours`);
  try {
    await app.close();
    await Promise.allSettled([fermerPostgres(), fermerRedis(), fermerFile()]);
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
