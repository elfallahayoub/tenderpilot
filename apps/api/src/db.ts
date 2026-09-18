import pg from "pg";

/**
 * Pool Postgres unique pour tout le processus.
 * La connexion est paresseuse : le pool ne se connecte qu'a la premiere requete,
 * donc l'API demarre meme si Postgres repond en retard.
 */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
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
