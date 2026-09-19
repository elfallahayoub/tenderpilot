-- TenderPilot -- ordre de relecture du journal d'agent.
--
-- horodatage vient de now(), qui rend l'heure de TRANSACTION. Deux evenements
-- ecrits dans la meme microseconde partageraient leur horodatage, et l'ordre
-- de relecture dependrait alors du plan d'execution. En pratique cela ne s'est
-- pas produit, mais "en pratique" ne suffit pas : le journal doit se rejouer a
-- l'identique de facon demontrable, pas probable.
--
-- La sequence donne un ordre total, stable et monotone. Elle sert aussi a ne
-- rapatrier que les evenements nouveaux pendant qu'un traitement avance.
ALTER TABLE agent_events
  ADD COLUMN IF NOT EXISTS sequence bigserial;

CREATE INDEX IF NOT EXISTS idx_agent_events_sequence
  ON agent_events (run_id, sequence);

COMMENT ON COLUMN agent_events.sequence IS
  'Ordre total d ecriture. Garantit qu un journal se rejoue a l identique.';
