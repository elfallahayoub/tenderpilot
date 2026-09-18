import { strict as assert } from "node:assert";
import { test } from "node:test";
import { verifierCitation } from "./citation.js";

/**
 * La citation est la preuve de EX-03. Une citation qui ne figure pas dans la
 * page est une hallucination, et doit etre rejetee par le code, pas jugee a
 * l'oeil.
 */

// Extrait reel de la page 2 de AO-2026-001, retours a la ligne compris.
const PAGE = `3.1. Justifier d'un chiffre d'affaires annuel moyen hors taxes supérieur à 12 778 000.00 MAD au titre des trois derniers
exercices clos, attesté par les états de synthèse certifiés.
3.2. Produire une attestation fiscale délivrée depuis moins de trois mois certifiant la situation régulière du concurrent.`;

test("citation identique au texte de la page", () => {
  const resultat = verifierCitation(PAGE, "3.2. Produire une attestation fiscale");
  assert.equal(resultat.trouvee, true);
  assert.ok(resultat.trouvee && PAGE.includes(resultat.citation));
});

test("le retour a la ligne du PDF devient un espace chez le modele", () => {
  const citee = "supérieur à 12 778 000.00 MAD au titre des trois derniers exercices clos";
  const resultat = verifierCitation(PAGE, citee);
  assert.equal(resultat.trouvee, true);
  // La citation rendue est celle de la PAGE, avec son retour a la ligne.
  assert.ok(resultat.trouvee && resultat.citation.includes("\n"));
  assert.ok(resultat.trouvee && PAGE.includes(resultat.citation));
});

test("la citation rendue est toujours une sous-chaine exacte de la page", () => {
  const resultat = verifierCitation(PAGE, "JUSTIFIER D'UN CHIFFRE D'AFFAIRES ANNUEL MOYEN");
  assert.equal(resultat.trouvee, true);
  assert.ok(resultat.trouvee && PAGE.includes(resultat.citation));
  // Le texte rendu garde la casse d'origine, pas celle du modele.
  assert.ok(resultat.trouvee && resultat.citation.startsWith("Justifier"));
});

test("apostrophe typographique et apostrophe droite sont equivalentes", () => {
  const page = "Le titulaire justifie d’une police d’assurance couvrant sa responsabilite.";
  const resultat = verifierCitation(page, "justifie d'une police d'assurance couvrant");
  assert.equal(resultat.trouvee, true);
  assert.ok(resultat.trouvee && page.includes(resultat.citation));
});

test("espaces multiples sans effet", () => {
  const resultat = verifierCitation(PAGE, "attestation    fiscale   délivrée depuis moins de trois mois");
  assert.equal(resultat.trouvee, true);
});

test("hallucination rejetee", () => {
  const resultat = verifierCitation(PAGE, "Le concurrent doit disposer de la certification ISO 27001");
  assert.equal(resultat.trouvee, false);
  assert.ok(!resultat.trouvee && resultat.motif.includes("ne figure pas"));
});

test("citation trop courte rejetee", () => {
  const resultat = verifierCitation(PAGE, "3.1.");
  assert.equal(resultat.trouvee, false);
  assert.ok(!resultat.trouvee && resultat.motif.includes("trop courte"));
});

test("page vide, aucune citation possible", () => {
  const resultat = verifierCitation("", "une exigence quelconque du document");
  assert.equal(resultat.trouvee, false);
});

test("les bornes rendues ne debordent pas", () => {
  const page = "Debut. Une note technique inférieure à soixante points est éliminatoire. Fin.";
  const resultat = verifierCitation(page, "Une note technique inférieure à soixante points est éliminatoire.");
  assert.equal(resultat.trouvee, true);
  assert.ok(resultat.trouvee && resultat.citation.endsWith("éliminatoire."));
  assert.ok(resultat.trouvee && !resultat.citation.includes("Fin"));
});
