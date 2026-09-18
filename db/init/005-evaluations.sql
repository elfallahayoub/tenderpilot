-- TenderPilot -- evaluations et verdict.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS statut_qualification text NOT NULL DEFAULT 'en_attente'
    CHECK (statut_qualification IN ('en_attente', 'en_cours', 'termine', 'echec')),
  ADD COLUMN IF NOT EXISTS motif_qualification text,
  ADD COLUMN IF NOT EXISTS verdict text CHECK (verdict IN ('go', 'no_go')),
  -- Annee servant a compter l'anciennete des references, et d'ou elle vient.
  ADD COLUMN IF NOT EXISTS annee_reference integer,
  ADD COLUMN IF NOT EXISTS origine_annee_reference text;

-- Une evaluation par exigence. Le statut et la preuve sont produits par le
-- moteur de regles en TypeScript, jamais par un modele. La colonne origine
-- montre a l'ecran quelle part revient au code et quelle part a un modele.
CREATE TABLE IF NOT EXISTS evaluations (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  requirement_id uuid        NOT NULL UNIQUE REFERENCES requirements (id) ON DELETE CASCADE,
  statut         text        NOT NULL
                 CHECK (statut IN ('satisfait', 'non_satisfait', 'indetermine')),
  preuve         text        NOT NULL,
  bloquant       boolean     NOT NULL,
  origine        text        NOT NULL
                 CHECK (origine IN ('deterministe', 'normalisation_gpt41',
                                    'arbitrage_gpt55', 'non_evaluable')),
  modele         text,
  cree_le        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evaluations_document
  ON evaluations (document_id, bloquant DESC);

COMMENT ON COLUMN evaluations.preuve IS
  'Produite par le moteur de regles. Exemple : CA moyen 51 833 333 MAD > 12 778 000 MAD requis.';
COMMENT ON COLUMN evaluations.origine IS
  'deterministe : code seul. normalisation_gpt41 / arbitrage_gpt55 : un modele a aide, sans decider.';
