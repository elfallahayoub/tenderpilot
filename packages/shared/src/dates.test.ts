import { strict as assert } from "node:assert";
import { test } from "node:test";
import { determinerAnneeReference, lireAnneeSeancePublique } from "./dates.js";

/** Page 1 reelle de AO-2026-001, reduite a ce qui compte ici. */
const PAGE_UN = `ROYAUME DU MAROC
MINISTÈRE DE L'ÉDUCATION NATIONALE
APPEL D'OFFRES OUVERT SUR OFFRES DE PRIX N° AO-2026-001
Estimation du marché 8 519 000.00 MAD TTC
Délai d'exécution 12 mois
Date de la séance publique 12/03/2026 à 10h00
Mode de passation Appel d'offres ouvert`;

test("la date de seance publique de AO-2026-001 est lue", () => {
  const lue = lireAnneeSeancePublique([PAGE_UN]);
  assert.equal(lue?.annee, 2026);
  assert.ok(lue?.extrait.includes("12/03/2026"));
});

test("l'origine est tracee quand la date vient du document", () => {
  const resultat = determinerAnneeReference([PAGE_UN], 2030);
  assert.equal(resultat.annee, 2026);
  assert.equal(resultat.origine, "seance_publique");
  // L'annee courante fournie ne doit pas prendre le dessus.
  assert.notEqual(resultat.annee, 2030);
});

test("repli sur l'annee courante quand l'avis ne dit rien", () => {
  const resultat = determinerAnneeReference(["Un texte sans aucune date."], 2026);
  assert.equal(resultat.annee, 2026);
  assert.equal(resultat.origine, "annee_courante");
  assert.equal(resultat.extrait, null);
});

test("repli sur l'annee courante quand les pages sont vides", () => {
  assert.equal(determinerAnneeReference([], 2026).origine, "annee_courante");
  assert.equal(determinerAnneeReference(["", "  "], 2026).origine, "annee_courante");
});

test("la mention peut suivre la date", () => {
  const lue = lireAnneeSeancePublique(["Le 05/04/2027, il sera procede a la séance publique."]);
  assert.equal(lue?.annee, 2027);
});

test("la seance publique prime sur une autre date presente avant elle", () => {
  const texte = `Date limite de retrait du dossier 01/02/2025
Date de la séance publique 12/03/2026 à 10h00`;
  assert.equal(lireAnneeSeancePublique([texte])?.annee, 2026);
});

test("a defaut de seance publique, la premiere date du document sert", () => {
  const lue = lireAnneeSeancePublique(["Fait à Tétouan, le 12/03/2026"]);
  assert.equal(lue?.annee, 2026);
});

test("les separateurs usuels sont acceptes", () => {
  assert.equal(lireAnneeSeancePublique(["séance publique 12-03-2026"])?.annee, 2026);
  assert.equal(lireAnneeSeancePublique(["séance publique 12.03.2026"])?.annee, 2026);
  assert.equal(lireAnneeSeancePublique(["séance publique 1/3/2026"])?.annee, 2026);
});

test("une annee invraisemblable est refusee", () => {
  assert.equal(lireAnneeSeancePublique(["séance publique 12/03/1899"]), null);
  assert.equal(lireAnneeSeancePublique(["reference 12/03/9999"]), null);
});

test("un numero de marche ne passe pas pour une date", () => {
  assert.equal(lireAnneeSeancePublique(["Marché N° 12/2026"]), null);
});

test("la recherche parcourt les pages dans l'ordre", () => {
  const resultat = lireAnneeSeancePublique([
    "Page sans date.",
    "Date de la séance publique 09/09/2028",
  ]);
  assert.equal(resultat?.annee, 2028);
});
