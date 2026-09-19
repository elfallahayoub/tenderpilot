-- TenderPilot -- ingestion des avis.
-- Rejoue uniquement au premier demarrage du volume postgres : npm run reset.

-- Un avis depose. L'empreinte est unique : redeposer le meme fichier
-- retrouve le document existant au lieu de relancer un traitement.
CREATE TABLE IF NOT EXISTS documents (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nom_fichier  text        NOT NULL,
  chemin       text        NOT NULL,
  nb_pages     integer,                      -- NULL tant que l'extraction n'a pas eu lieu
  statut       text        NOT NULL DEFAULT 'recu'
               CHECK (statut IN ('recu', 'en_cours', 'traite', 'echec')),
  hash_sha256  char(64)    NOT NULL UNIQUE,
  motif_echec  text,                         -- renseigne uniquement si statut = 'echec'
  cree_le      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_cree_le ON documents (cree_le DESC);

-- Une ligne par page reelle du PDF. Le numero vient de la structure du
-- document, jamais d'un decoupage du texte : c'est la fondation de EX-03,
-- une erreur ici serait irrattrapable en aval.
CREATE TABLE IF NOT EXISTS pages (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      uuid    NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  numero           integer NOT NULL CHECK (numero >= 1),
  -- Texte brut tel qu'extrait. Aucune normalisation destructrice : sauts de
  -- ligne et espaces multiples sont conserves, l'Extractor en a besoin pour
  -- reperer les articles et la citation litterale doit coller au PDF.
  texte            text    NOT NULL DEFAULT '',
  nb_caracteres    integer NOT NULL,
  source           text    NOT NULL CHECK (source IN ('texte', 'ocr')),
  lisible          boolean NOT NULL,
  motif_illisible  text,                     -- renseigne uniquement si lisible = false
  UNIQUE (document_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_pages_document ON pages (document_id, numero);

COMMENT ON COLUMN pages.numero IS
  'Numero de page issu de la structure PDF (getPage), base 1.';
COMMENT ON COLUMN pages.texte IS
  'Texte brut non normalise, tel que rendu par la couche texte ou l''OCR.';
