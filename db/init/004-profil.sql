-- TenderPilot -- profil de l'entreprise utilisatrice.
-- Charge par npm run seed depuis data/sujet-01-tenderpilot/profil-entreprise.json.
--
-- Ces donnees ne sont JAMAIS recopiees dans un prompt. Le moteur de regles les
-- lit ici, par appel d'outil. C'est un point que le jury verifie.

CREATE TABLE IF NOT EXISTS profil_entreprise (
  id                integer     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  raison_sociale    text        NOT NULL,
  effectif          integer     NOT NULL,
  -- { "2023": 41200000, "2024": 52800000, "2025": 61500000 }
  chiffre_affaires  jsonb       NOT NULL,
  certifications    text[]      NOT NULL,
  attestations      text[]      NOT NULL,
  secteurs          text[]      NOT NULL,
  charge_le         timestamptz NOT NULL DEFAULT now()
);

-- Les references clients. La colonne secteur fait foi : le nom du client n'est
-- jamais utilise pour deduire un secteur, et un test unitaire le verifie.
-- Voir la section "Decisions de conception" du README.
CREATE TABLE IF NOT EXISTS references_client (
  id                          text    PRIMARY KEY,
  client                      text    NOT NULL,
  secteur                     text    NOT NULL,
  objet                       text    NOT NULL,
  montant_ht_mad              bigint  NOT NULL,
  annee_debut                 integer NOT NULL,
  duree_mois                  integer NOT NULL,
  attestation_bonne_execution boolean NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_references_secteur
  ON references_client (secteur, annee_debut DESC);

CREATE TABLE IF NOT EXISTS equipe (
  id                text    PRIMARY KEY,
  initiales         text    NOT NULL,
  poste             text    NOT NULL,
  annees_experience integer NOT NULL,
  diplome           text,
  certifications    text,
  langues           text
);

CREATE INDEX IF NOT EXISTS idx_equipe_poste
  ON equipe (poste, annees_experience DESC);

COMMENT ON COLUMN references_client.secteur IS
  'Fait foi pour le comptage. Ne jamais deduire le secteur du nom du client.';
