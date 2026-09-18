import { strict as assert } from "node:assert";
import { test } from "node:test";
import { objetDeLAvis } from "./objet.js";

/** Page 1 reelle de AO-2026-001. */
const PAGE_UN = `ROYAUME DU MAROC
MINISTÈRE DE L'ÉDUCATION NATIONALE
APPEL D'OFFRES OUVERT SUR OFFRES DE PRIX N° AO-2026-001
Objet : la maintenance applicative du parc logiciel métier.
Maître d'ouvrage Ministère de l'Éducation Nationale`;

test("l'objet de AO-2026-001 est lu, sans son point final", () => {
  assert.equal(objetDeLAvis([PAGE_UN]), "la maintenance applicative du parc logiciel métier");
});

test("l'objet d'un scan OCRise se lit aussi", () => {
  const ocr = "APPEL D'OFFRES OUVERT SUR OFFRES DE PRIX N° AO-2026-004\nObjet : l'audit et la sécurisation du système d'information.";
  assert.equal(objetDeLAvis([ocr]), "l'audit et la sécurisation du système d'information");
});

test("la premiere page qui porte un objet l'emporte", () => {
  const cps = "Objet : le present cahier des prescriptions speciales";
  assert.equal(objetDeLAvis([PAGE_UN, cps])?.startsWith("la maintenance"), true);
});

test("sans objet, rien n'est invente", () => {
  assert.equal(objetDeLAvis(["Un texte sans objet declare."]), null);
  assert.equal(objetDeLAvis([]), null);
  assert.equal(objetDeLAvis([""]), null);
});

test("un objet trop court est refuse plutot que rendu", () => {
  assert.equal(objetDeLAvis(["Objet : ok"]), null);
});
