import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normaliserEntier, normaliserNombre } from "./nombres.js";

/**
 * Regle 8 du CLAUDE.md : aucun nombre du systeme ne vient d'un prompt.
 * Ces tests sont donc la garantie de tous les chiffres du verdict.
 */

test("chiffres simples", () => {
  assert.equal(normaliserNombre("60"), 60);
  assert.equal(normaliserNombre("4"), 4);
  assert.equal(normaliserNombre(" 85 "), 85);
});

test("montants avec separateurs de milliers et decimales", () => {
  assert.equal(normaliserNombre("12 778 000.00"), 12778000);
  assert.equal(normaliserNombre("12 778 000.00 MAD"), 12778000);
  assert.equal(normaliserNombre("12 778 000,00 MAD"), 12778000);
  assert.equal(normaliserNombre("8 519 000.00 MAD TTC"), 8519000);
  assert.equal(normaliserNombre("128 000.00"), 128000);
  assert.equal(normaliserNombre("1 200,50"), 1200.5);
});

test("espaces insecables comme separateurs de milliers", () => {
  assert.equal(normaliserNombre("12 778 000"), 12778000);
  assert.equal(normaliserNombre("12 778 000"), 12778000);
});

test("unites simples en toutes lettres", () => {
  assert.equal(normaliserNombre("cinq"), 5);
  assert.equal(normaliserNombre("huit"), 8);
  assert.equal(normaliserNombre("douze"), 12);
  assert.equal(normaliserNombre("seize"), 16);
});

test("formes composees du francais", () => {
  assert.equal(normaliserNombre("soixante"), 60);
  assert.equal(normaliserNombre("soixante-dix"), 70);
  assert.equal(normaliserNombre("soixante-quinze"), 75);
  assert.equal(normaliserNombre("quatre-vingts"), 80);
  assert.equal(normaliserNombre("quatre-vingt"), 80);
  assert.equal(normaliserNombre("quatre-vingt-cinq"), 85);
  assert.equal(normaliserNombre("quatre-vingt-dix"), 90);
  assert.equal(normaliserNombre("quatre-vingt-dix-neuf"), 99);
  assert.equal(normaliserNombre("cent vingt"), 120);
  assert.equal(normaliserNombre("cent"), 100);
});

test("formes composees ecrites avec des espaces", () => {
  assert.equal(normaliserNombre("quatre vingts"), 80);
  assert.equal(normaliserNombre("quatre vingt cinq"), 85);
  assert.equal(normaliserNombre("soixante dix"), 70);
});

test("centaines, milliers et millions", () => {
  assert.equal(normaliserNombre("deux cents"), 200);
  assert.equal(normaliserNombre("mille"), 1000);
  assert.equal(normaliserNombre("mille deux cents"), 1200);
  assert.equal(normaliserNombre("deux millions"), 2000000);
  assert.equal(normaliserNombre("trois cent cinquante mille"), 350000);
});

test("les deux cas reels de AO-2026-001", () => {
  // Article 6, phrase isolee en tete de page 3.
  assert.equal(normaliserNombre("soixante"), 60);
  assert.equal(normaliserNombre("quatre-vingt-cinq"), 85);
  // Article 3.1 du reglement.
  assert.equal(normaliserNombre("12 778 000.00"), 12778000);
  // Article 4.7 du reglement.
  assert.equal(normaliserNombre("60"), 60);
});

test("mots d'unite toleres autour de la valeur", () => {
  assert.equal(normaliserNombre("soixante points"), 60);
  assert.equal(normaliserNombre("quatre-vingt-cinq points"), 85);
  assert.equal(normaliserNombre("60 personnes"), 60);
  assert.equal(normaliserNombre("huit ans"), 8);
  assert.equal(normaliserNombre("cinq annees"), 5);
});

test("qualificatifs d'unite observes dans les avis reels", () => {
  // Article 4.6 du reglement de AO-2026-001.
  assert.equal(normaliserNombre("cinq dernières années"), 5);
  // Article 6, phrase isolee en tete de page 3.
  assert.equal(normaliserNombre("quatre-vingt-cinq points techniques"), 85);
  assert.equal(normaliserNombre("trois derniers exercices clos"), 3);
  assert.equal(normaliserNombre("soixante jours"), null); // "jours" reste inconnu
});

test("un qualificatif tolere ne transforme pas une phrase vague en nombre", () => {
  // Le risque de la tolerance serait d'extraire 1 de "un nombre suffisant".
  assert.equal(normaliserNombre("un nombre suffisant"), null);
  assert.equal(normaliserNombre("les dernières années"), null);
  assert.equal(normaliserNombre("des points techniques"), null);
});

test("accents et casse sans effet", () => {
  assert.equal(normaliserNombre("SOIXANTE"), 60);
  assert.equal(normaliserNombre("Quatre-Vingt-Cinq"), 85);
  assert.equal(normaliserNombre("cinq années"), 5);
});

test("refus plutot que devinette", () => {
  assert.equal(normaliserNombre(null), null);
  assert.equal(normaliserNombre(undefined), null);
  assert.equal(normaliserNombre(""), null);
  assert.equal(normaliserNombre("   "), null);
  assert.equal(normaliserNombre("plusieurs"), null);
  assert.equal(normaliserNombre("un nombre suffisant"), null);
  assert.equal(normaliserNombre("beaucoup de points"), null);
});

test("normaliserEntier arrondit et conserve le refus", () => {
  assert.equal(normaliserEntier("60"), 60);
  assert.equal(normaliserEntier("4,6"), 5);
  assert.equal(normaliserEntier("quatre-vingts"), 80);
  assert.equal(normaliserEntier("plusieurs"), null);
});
