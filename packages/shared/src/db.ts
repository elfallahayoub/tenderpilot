import pg from "pg";

/**
 * Pool Postgres unique, partage par l'api et le worker.
 *
 * Il remplace les deux copies qui coexistaient jusqu'a la tranche 2. La taille
 * se regle par service : l'api sert des requetes courtes et nombreuses, le
 * worker en tient peu mais longtemps.
 */
const TAILLE_MAX = Number(process.env.PG_POOL_MAX ?? 10);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number.isFinite(TAILLE_MAX) && TAILLE_MAX > 0 ? TAILLE_MAX : 10,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
});

pool.on("error", (erreur) => {
  console.error("[postgres] erreur de pool :", erreur.message);
});

/** Ping minimal, utilise par la route de sante. */
export async function pingPostgres(): Promise<void> {
  await pool.query("SELECT 1");
}

export async function fermerPostgres(): Promise<void> {
  await pool.end();
}
