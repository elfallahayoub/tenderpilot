-- TenderPilot -- memoire technique, embeddings et sections redigees.

-- Embeddings calcules une seule fois au seed, jamais recalcules.
-- Dimension 512, imposee par le CLAUDE.md et par le parametre dimensions de
-- embedder-small-3.
ALTER TABLE references_client
  ADD COLUMN IF NOT EXISTS embedding vector(512);

-- Sections des deux memoires techniques deja rendus. Elles servent de gabarit
-- de style, pas de base de connaissances : leurs chiffres sont retires avant
-- d'etre montres au Writer, pour qu'il ne puisse pas recopier le montant d'un
-- ancien marche dans un nouveau memoire.
CREATE TABLE IF NOT EXISTS extraits_offres_passees (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source    text NOT NULL,
  section   text NOT NULL,
  texte     text NOT NULL,
  embedding vector(512),
  UNIQUE (source, section)
);

-- Une section du memoire. Le contenu est celui produit et VERIFIE : une
-- section dont les garde-fous ont echoue deux fois est conservee au statut
-- a_completer, avec son motif, et apparait marquee dans le DOCX. Jamais omise.
CREATE TABLE IF NOT EXISTS sections_memoire (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       uuid        NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  ordre             integer     NOT NULL,
  titre             text        NOT NULL,
  contenu           text        NOT NULL DEFAULT '',
  statut            text        NOT NULL
                    CHECK (statut IN ('redigee', 'a_completer')),
  motif             text,
  references_citees text[]      NOT NULL DEFAULT '{}',
  modele            text,
  tokens            integer,
  tentatives        integer     NOT NULL DEFAULT 1,
  cree_le           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, ordre)
);

CREATE INDEX IF NOT EXISTS idx_sections_document
  ON sections_memoire (document_id, ordre);

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS statut_memoire text NOT NULL DEFAULT 'absent'
    CHECK (statut_memoire IN ('absent', 'en_cours', 'termine', 'echec')),
  ADD COLUMN IF NOT EXISTS motif_memoire text;

COMMENT ON COLUMN sections_memoire.references_citees IS
  'Identifiants verifies comme existants dans references_client ET fournis en candidats.';
COMMENT ON TABLE extraits_offres_passees IS
  'Gabarit de style. Les chiffres en sont retires avant tout usage par le Writer.';
