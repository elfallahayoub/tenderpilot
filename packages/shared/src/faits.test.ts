import { strict as assert } from "node:assert";
import { test } from "node:test";
import { construireFait } from "./faits.js";
import { schemaSortieExtraction, SCHEMA_JSON_EXTRACTION } from "./schemas.js";
import type { FaitBrut } from "./schemas.js";

/** Fait brut vide : le modele renseigne uniquement les champs utiles. */
function brut(partiel: Partial<FaitBrut> & Pick<FaitBrut, "kind">): FaitBrut {
  return {
    valeurBrute: null,
    surBrute: null,
    nomBrut: null,
    nombreBrut: null,
    secteurBrut: null,
    anneesMaxBrut: null,
    posteBrut: null,
    experienceMinBrut: null,
    ...partiel,
  };
}

test("chiffre d'affaires : le montant du document devient un nombre", () => {
  const resultat = construireFait(brut({ kind: "chiffre_affaires_min", valeurBrute: "12 778 000.00" }));
  assert.deepEqual(resultat, { ok: true, fait: { kind: "chiffre_affaires_min", valeur: 12778000 } });
});

test("note technique : le seuil en toutes lettres devient deux nombres", () => {
  const resultat = construireFait(
    brut({ kind: "note_technique_min", valeurBrute: "soixante", surBrute: "quatre-vingt-cinq" }),
  );
  assert.deepEqual(resultat, { ok: true, fait: { kind: "note_technique_min", valeur: 60, sur: 85 } });
});

test("effectif et references", () => {
  assert.deepEqual(construireFait(brut({ kind: "effectif_min", valeurBrute: "60" })), {
    ok: true,
    fait: { kind: "effectif_min", valeur: 60 },
  });
  assert.deepEqual(
    construireFait(
      brut({ kind: "references_min", nombreBrut: "4", secteurBrut: "éducation", anneesMaxBrut: "cinq" }),
    ),
    { ok: true, fait: { kind: "references_min", nombre: 4, secteur: "éducation", anneesMax: 5 } },
  );
});

test("profil d'equipe de l'article 7 du CPS", () => {
  assert.deepEqual(
    construireFait(
      brut({ kind: "profil_equipe", posteBrut: "Chef de projet", nombreBrut: "1", experienceMinBrut: "8" }),
    ),
    { ok: true, fait: { kind: "profil_equipe", poste: "Chef de projet", nombre: 1, experienceMin: 8 } },
  );
});

test("certification et attestation gardent leur nom exact", () => {
  assert.deepEqual(construireFait(brut({ kind: "certification_requise", nomBrut: "ISO 9001:2015" })), {
    ok: true,
    fait: { kind: "certification_requise", nom: "ISO 9001:2015" },
  });
});

test("valeur non convertible : aucun fait, jamais de devinette", () => {
  const resultat = construireFait(brut({ kind: "effectif_min", valeurBrute: "un effectif suffisant" }));
  assert.equal(resultat.ok, false);
  assert.ok(!resultat.ok && resultat.motif.includes("non convertible"));
});

test("champ necessaire absent : aucun fait", () => {
  const sansTotal = construireFait(brut({ kind: "note_technique_min", valeurBrute: "soixante" }));
  assert.equal(sansTotal.ok, false);
  assert.equal(construireFait(null).ok, false);
});

test("un echantillon valide passe zod et respecte le schema envoye au service", () => {
  const echantillon = {
    exigences: [
      {
        texte: "Justifier d'un chiffre d'affaires annuel moyen superieur au seuil.",
        citation: "Justifier d'un chiffre d'affaires annuel moyen hors taxes supérieur à 12 778 000.00 MAD",
        article: "Règlement art. 3.1",
        type: "eliminatoire",
        categorie: "financier",
        fait: brut({ kind: "chiffre_affaires_min", valeurBrute: "12 778 000.00" }),
      },
    ],
  };

  const analyse = schemaSortieExtraction.safeParse(echantillon);
  assert.equal(analyse.success, true);

  // Les deux contrats doivent decrire les memes champs, sinon le mode strict
  // du service et la validation zod divergeraient en silence.
  const attendus = SCHEMA_JSON_EXTRACTION.properties.exigences.items.required;
  const echantillonExigence = echantillon.exigences[0]!;
  assert.deepEqual([...attendus].sort(), Object.keys(echantillonExigence).sort());

  const champsFait = SCHEMA_JSON_EXTRACTION.properties.exigences.items.properties.fait.required;
  assert.deepEqual([...champsFait].sort(), Object.keys(echantillonExigence.fait).sort());
});
