-- TenderPilot -- exigences extraites.
-- Rejoue uniquement au premier demarrage du volume postgres : npm run reset.

-- L'extraction est un etat distinct de l'ingestion : un PDF peut etre lu
-- integralement et son analyse rester a faire, ou echouer.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS statut_extraction text NOT NULL DEFAULT 'en_attente'
    CHECK (statut_extraction IN ('en_attente', 'en_cours', 'termine', 'echec')),
  ADD COLUMN IF NOT EXISTS motif_extraction text;

-- Une exigence, telle que definie au CLAUDE.md section 7.
-- La citation stockee ici est, par construction, une sous-chaine exacte du
-- texte de la page referencee : elle est verifiee par code avant insertion.
-- Le champ fait ne contient que des nombres produits par normaliserNombre.
CREATE TABLE IF NOT EXISTS requirements (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  page_id      uuid        NOT NULL REFERENCES pages (id) ON DELETE CASCADE,
  numero_page  integer     NOT NULL CHECK (numero_page >= 1),
  texte        text        NOT NULL,
  citation     text        NOT NULL,
  article      text,
  type         text        NOT NULL
               CHECK (type IN ('obligatoire', 'optionnelle', 'eliminatoire')),
  categorie    text        NOT NULL
               CHECK (categorie IN ('administratif', 'financier', 'technique', 'equipe', 'delai')),
  fait         jsonb,
  confiance    real        NOT NULL CHECK (confiance >= 0 AND confiance <= 1),
  cree_le      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_requirements_document
  ON requirements (document_id, numero_page);

-- Retrouver vite les points bloquants d'un avis.
CREATE INDEX IF NOT EXISTS idx_requirements_type
  ON requirements (document_id, type);

COMMENT ON COLUMN requirements.citation IS
  'Sous-chaine exacte du texte de la page, verifiee par verifierCitation.';
COMMENT ON COLUMN requirements.fait IS
  'Forme machine. Tous les nombres viennent de normaliserNombre, jamais du modele.';

-- La confiance est calculee par le code (packages/shared/src/confiance.ts) a
-- partir de signaux objectifs, jamais declaree par le modele. On conserve le
-- detail du calcul pour que le score soit explicable a l'ecran.
ALTER TABLE requirements
  ADD COLUMN IF NOT EXISTS confiance_detail text;

COMMENT ON COLUMN requirements.confiance IS
  'Calculee par calculerConfiance a partir de signaux constates, jamais par le modele.';
