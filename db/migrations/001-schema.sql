-- TenderPilot -- schema initial.
-- Rejoue uniquement au premier demarrage du volume postgres.
-- Pour le rejouer : npm run reset (docker compose down -v).

CREATE EXTENSION IF NOT EXISTS vector;

-- Journal de l'agent. Miroir exact du type AgentEvent du CLAUDE.md.
-- C'est la source du panneau lateral : chaque etape, son modele, son cout.
CREATE TABLE IF NOT EXISTS agent_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid        NOT NULL,
  horodatage  timestamptz NOT NULL DEFAULT now(),
  agent       text        NOT NULL,
  etape       text        NOT NULL,
  modele      text,
  tokens      integer,
  duree_ms    integer     NOT NULL,
  statut      text        NOT NULL
              CHECK (statut IN ('succes', 'echec', 'reprise', 'escalade')),
  detail      text        NOT NULL DEFAULT ''
);

-- Rejouer un traitement dans l'ordre.
CREATE INDEX IF NOT EXISTS idx_agent_events_run
  ON agent_events (run_id, horodatage);

-- Retrouver immediatement les echecs et les escalades, tous traitements confondus.
CREATE INDEX IF NOT EXISTS idx_agent_events_statut
  ON agent_events (statut, horodatage DESC);

COMMENT ON TABLE agent_events IS
  'Journal des etapes d''agent : modele utilise, tokens, duree, statut.';
