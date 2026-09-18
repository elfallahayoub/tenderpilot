import pg from "pg";

/**
 * Pool Postgres du worker.
 *
 * Copie assumee du pool de l'api, contenue au strict minimum : la mise en
 * commun dans packages/shared est prevue en tranche 3, avec llm.ts et les
 * schemas zod. Toute divergence entre ces deux fichiers serait un bug.
 */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
});

pool.on("error", (erreur) => {
  console.error("[postgres] erreur de pool :", erreur.message);
});

export async function fermerPostgres(): Promise<void> {
  await pool.end();
}
