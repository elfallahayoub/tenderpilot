import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "./db.js";

/**
 * Executeur de migrations.
 *
 * Jusqu'a la tranche 8, le schema etait joue par docker-entrypoint-initdb.d,
 * qui ne s'execute qu'a la creation du volume : tout changement passait donc
 * par `npm run reset`, c'est-a-dire par la destruction de la base. Acceptable
 * tant qu'elle ne contenait que des donnees regenerables, inacceptable des
 * qu'elle porte du travail humain.
 *
 * Un seul mecanisme desormais. Sur un volume vierge les migrations
 * s'appliquent toutes d'affilee ; sur une base existante, seules les nouvelles.
 *
 * REGLE : une migration deja appliquee est IMMUABLE. Une correction passe par
 * une migration supplementaire, jamais par la reecriture d'un fichier ancien :
 * la base d'un autre poste ne rejouerait pas la modification.
 */

const DOSSIER = process.env.DOSSIER_MIGRATIONS ?? "/app/migrations";

/**
 * Verrou consultatif Postgres. L'api et le worker demarrent ensemble et
 * appelleraient l'executeur en meme temps : le second attend ici, puis
 * constate qu'il n'y a plus rien a faire.
 */
const CLE_VERROU = 828_120_008;

export type ResultatMigrations = {
  appliquees: string[];
  dejaAppliquees: number;
};

export async function appliquerMigrations(): Promise<ResultatMigrations> {
  const client = await pool.connect();

  try {
    // Le verrou est pris AVANT toute ecriture : deux processus qui creeraient
    // la table de suivi en meme temps se marcheraient dessus.
    await client.query("SELECT pg_advisory_lock($1)", [CLE_VERROU]);

    try {
      await client.query(
        `CREATE TABLE IF NOT EXISTS schema_migrations (
           nom          text        PRIMARY KEY,
           applique_le  timestamptz NOT NULL DEFAULT now()
         )`,
      );

      const fichiers = (await readdir(DOSSIER))
        .filter((nom) => nom.endsWith(".sql"))
        .sort();

      const connues = new Set(
        (await client.query<{ nom: string }>("SELECT nom FROM schema_migrations")).rows.map(
          (ligne) => ligne.nom,
        ),
      );

      const appliquees: string[] = [];

      for (const fichier of fichiers) {
        if (connues.has(fichier)) continue;

        const sql = await readFile(join(DOSSIER, fichier), "utf8");

        // Une migration par transaction : elle passe entierement ou pas du
        // tout, et la base ne reste jamais a moitie migree.
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations (nom) VALUES ($1)", [fichier]);
          await client.query("COMMIT");
          appliquees.push(fichier);
        } catch (erreur) {
          await client.query("ROLLBACK");
          const message = erreur instanceof Error ? erreur.message : String(erreur);
          // Aucune erreur n'est avalee : une base a moitie migree doit arreter
          // le demarrage, pas produire des resultats partiels en silence.
          throw new Error(`migration ${fichier} refusee : ${message}`);
        }
      }

      return { appliquees, dejaAppliquees: connues.size };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [CLE_VERROU]);
    }
  } finally {
    client.release();
  }
}
