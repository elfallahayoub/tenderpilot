import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  canoniser,
  chiffresNonSources,
  nombresDuTexte,
  retirerLesNombres,
} from "./chiffres.js";

/**
 * C'est le garde-fou qui empeche un montant invente d'entrer dans un memoire
 * exportable. Il doit etre strict : un faux negatif ici laisse passer un
 * chiffre faux dans un document qui circulera.
 */

test("deux ecritures de la meme valeur donnent la meme clef", () => {
  assert.equal(canoniser("6 424 000.00"), "6424000");
  assert.equal(canoniser("6424000"), "6424000");
  assert.equal(canoniser("6 424 000,00"), "6424000");
  assert.equal(canoniser("12 778 000"), "12778000");
  assert.equal(canoniser("2026"), "2026");
});

test("ce qui n'est pas un nombre ne devient pas un nombre", () => {
  assert.equal(canoniser(""), null);
  assert.equal(canoniser("..."), null);
  assert.equal(canoniser(","), null);
});

test("les nombres d'un texte sont tous releves", () => {
  const texte = "Le marche porte sur 12 778 000.00 MAD, execute en 2023 sur 8 mois.";
  assert.deepEqual(nombresDuTexte(texte).sort(), ["12778000", "2023", "8"].sort());
});

test("un denombrement en toutes lettres est un nombre comme un autre", () => {
  // Le contrat est total : tout nombre, en chiffres ou en lettres, compte.
  assert.deepEqual(nombresDuTexte("Nous appliquons une demarche en quatre phases."), ["4"]);
  assert.deepEqual(nombresDuTexte("Une equipe dediee, un comite de pilotage."), []);
});

test("CAS NOMINAL : une section qui recopie sa matiere est acceptee", () => {
  const materiau = [
    "REF-02 Agence Nationale de Reglementation des Telecommunications, education, 2022, 5648000 MAD",
    "CA moyen 51 833 333 MAD sur 2023, 2024, 2025 >= 12 778 000 MAD requis",
  ].join("\n");
  const section =
    "Notre reference REF-02, executee en 2022 pour un montant de 5 648 000 MAD, " +
    "atteste de notre experience. Notre chiffre d'affaires moyen s'eleve a 51 833 333 MAD.";

  assert.deepEqual(chiffresNonSources(section, materiau), []);
});

test("REJET : un montant invente est detecte", () => {
  const materiau = "REF-02, education, 2022, 5648000 MAD";
  const section = "Notre reference REF-02, d'un montant de 9 200 000 MAD, executee en 2022.";

  const fautifs = chiffresNonSources(section, materiau);
  assert.deepEqual(fautifs, ["9200000"]);
});

test("REJET : une annee inventee est detectee", () => {
  const materiau = "REF-02, education, 2022";
  assert.deepEqual(chiffresNonSources("Marche execute en 2019.", materiau), ["2019"]);
});

test("REJET : un seuil reecrit est detecte", () => {
  // Le Writer ne doit pas reecrire une valeur du verdict, meme voisine.
  const materiau = "note technique minimum : 60 sur 85";
  assert.deepEqual(chiffresNonSources("Le seuil est de 65 points sur 85.", materiau), ["65"]);
});

test("un denombrement introduit par le modele est rejete comme un chiffre", () => {
  const materiau = "REF-02, education, 2022";
  const section =
    "Nous appliquons une demarche iterative en quatre phases, avec trois comites de suivi.";
  assert.deepEqual(chiffresNonSources(section, materiau).sort(), ["3", "4"]);
});

test("la verification ne depend pas de la mise en forme du nombre", () => {
  const materiau = "montant 5648000";
  // Le modele ecrit le meme montant avec des separateurs : accepte.
  assert.deepEqual(chiffresNonSources("un montant de 5 648 000 MAD", materiau), []);
  assert.deepEqual(chiffresNonSources("un montant de 5 648 000,00 MAD", materiau), []);
});

test("l'extrait de style est prive de ses chiffres", () => {
  // Les memoires deja rendus portent les montants d'anciens marches. Les
  // retirer rend leur recopie impossible plutot que detectable apres coup.
  const extrait =
    "Marche execute en 2023, duree 8 mois, montant 6 424 000.00 MAD HT. Quatre phases.";
  const nettoye = retirerLesNombres(extrait);

  assert.deepEqual(nombresDuTexte(nettoye), []);
  // Les nombres en lettres partent aussi : un extrait disant "Quatre phases"
  // pousserait le modele a ecrire un nombre absent de la matiere.
  assert.ok(nettoye.includes("phases"));
  assert.ok(!nettoye.includes("Quatre"));
  assert.ok(!nettoye.includes("6 424 000"));
});

test("un extrait de style nettoye ne peut pas autoriser un chiffre", () => {
  const materiau = retirerLesNombres("montant 6 424 000.00 MAD, execute en 2023");
  assert.deepEqual(chiffresNonSources("un montant de 6 424 000 MAD", materiau), ["6424000"]);
});

test("FAILLE FERMEE : un nombre en toutes lettres est detecte comme les autres", () => {
  // Constate sur une vraie generation : le modele ecrivait "deux mille
  // vingt-deux" et "Deux de ces references", donc des affirmations chiffrees
  // que le controle des chiffres ne voyait pas.
  const materiau = "REF-02, education, 2022";
  assert.deepEqual(chiffresNonSources("Marche execute en deux mille vingt-deux.", materiau), []);
  assert.deepEqual(chiffresNonSources("Deux de ces references sont attestees.", materiau), ["2"]);
  assert.deepEqual(chiffresNonSources("Une demarche en quatre phases.", materiau), ["4"]);
});

test("un article indefini n'est pas un denombrement", () => {
  const materiau = "REF-02, education, 2022";
  // "un" et "une" isoles sont des articles, pas des quantites : les compter
  // ferait de "un comite de pilotage" une affirmation chiffree.
  assert.deepEqual(chiffresNonSources("Un comite de pilotage se reunit.", materiau), []);
  assert.deepEqual(chiffresNonSources("Une equipe dediee est mobilisee.", materiau), []);
});

test("les nombres composes en lettres sont reconnus", () => {
  assert.deepEqual(chiffresNonSources("quatre-vingt-cinq points", "seuil 85"), []);
  assert.deepEqual(chiffresNonSources("soixante points", "seuil 60"), []);
  assert.deepEqual(chiffresNonSources("soixante points", "seuil 85"), ["60"]);
});
