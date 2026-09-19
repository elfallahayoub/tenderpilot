-- TenderPilot -- revue humaine des sections du memoire.
--
-- A partir d'ici la base contient du travail humain. Toute migration
-- ulterieure doit le preserver : npm run reset n'est plus une reponse
-- acceptable a un changement de schema.

ALTER TABLE sections_memoire
  -- La correction de l'humain. NULL tant que la section n'a pas ete reecrite.
  -- Le contenu effectif, a l'ecran comme a l'export, est toujours
  -- COALESCE(contenu_humain, contenu) : une seule verite, lue au meme endroit.
  ADD COLUMN IF NOT EXISTS contenu_humain text,
  ADD COLUMN IF NOT EXISTS statut_revue text NOT NULL DEFAULT 'a_revoir'
    CHECK (statut_revue IN ('a_revoir', 'validee', 'corrigee')),
  ADD COLUMN IF NOT EXISTS revue_le timestamptz;

-- Retrouver les corrections humaines passees, pour les reinjecter dans les
-- traitements suivants : c'est la memoire des corrections.
CREATE INDEX IF NOT EXISTS idx_sections_corrigees
  ON sections_memoire (titre, revue_le DESC)
  WHERE statut_revue = 'corrigee';

COMMENT ON COLUMN sections_memoire.contenu_humain IS
  'Travail humain. Jamais ecrase par une regeneration sans demande explicite.';
COMMENT ON COLUMN sections_memoire.statut_revue IS
  'a_revoir : produite par le modele. validee : relue telle quelle. corrigee : reecrite.';
