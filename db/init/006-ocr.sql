-- TenderPilot -- OCR, completude et reserve sur le verdict.

-- Confiance moyenne rendue par Tesseract sur la page, de 0 a 100.
-- NULL quand la page vient d'une couche texte : il n'y a rien a douter.
ALTER TABLE pages
  ADD COLUMN IF NOT EXISTS qualite_ocr real,
  ADD COLUMN IF NOT EXISTS duree_ocr_ms integer;

-- Un verdict ne se lit jamais sans sa reserve.
--
-- Asymetrie fondatrice : un no-go sur un document incomplet reste solide, un
-- point bloquant trouve est un point bloquant et lire davantage ne peut
-- qu'en ajouter. Un go sur un document incomplet, lui, ne vaut rien : les
-- pages absentes ou illisibles peuvent porter la condition qui bloque.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS complet boolean,
  ADD COLUMN IF NOT EXISTS composantes_manquantes text[],
  ADD COLUMN IF NOT EXISTS reserve text;

COMMENT ON COLUMN documents.complet IS
  'Etabli a partir de la composition que le document annonce en page 1, jamais par comparaison avec un autre avis.';
COMMENT ON COLUMN documents.reserve IS
  'Non nul quand le verdict ne peut pas etre tenu pour franc. Toujours affiche a cote du verdict.';
COMMENT ON COLUMN pages.qualite_ocr IS
  'Confiance moyenne de Tesseract sur les mots reconnus. NULL pour une couche texte.';
