import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  calculerVerdict,
  chercherCorrespondance,
  chiffreAffairesMoyen,
  compterReferences,
  estBloquant,
  evaluerFait,
  type Profil,
  type ReferenceClient,
} from "./regles.js";

/**
 * Le moteur de regles est ce que le jury lira pour juger de la fiabilite.
 * Les valeurs utilisees ici sont celles du profil reel d'ATLAS DIGITAL
 * SERVICES, pas des valeurs inventees pour faire passer les tests.
 */

const REFERENCES: ReferenceClient[] = [
  // Le piege du jeu de donnees, reproduit tel quel.
  {
    id: "REF-02",
    client: "Agence Nationale de Réglementation des Télécommunications",
    secteur: "éducation",
    objet: "La refonte du portail citoyen",
    montantHtMad: 5648000,
    anneeDebut: 2022,
    dureeMois: 6,
    attestationBonneExecution: true,
  },
  {
    id: "REF-04",
    client: "Ministère de l'Éducation Nationale",
    secteur: "énergie",
    objet: "La mise en conformité à la protection des données",
    montantHtMad: 5295000,
    anneeDebut: 2024,
    dureeMois: 8,
    attestationBonneExecution: true,
  },
  {
    id: "REF-08",
    client: "Office National de l'Electricité",
    secteur: "éducation",
    objet: "Le deploiement d'une plateforme de formation",
    montantHtMad: 4200000,
    anneeDebut: 2021,
    dureeMois: 10,
    attestationBonneExecution: true,
  },
  {
    id: "REF-12",
    client: "Region Souss-Massa",
    secteur: "éducation",
    objet: "La refonte applicative",
    montantHtMad: 3900000,
    anneeDebut: 2022,
    dureeMois: 9,
    attestationBonneExecution: true,
  },
  {
    id: "REF-19",
    client: "Direction Generale des Impots",
    secteur: "éducation",
    objet: "La maintenance applicative",
    montantHtMad: 6100000,
    anneeDebut: 2024,
    dureeMois: 12,
    attestationBonneExecution: true,
  },
  {
    id: "REF-21",
    client: "Academie Regionale de l'Education",
    secteur: "santé",
    objet: "Un projet ancien",
    montantHtMad: 2000000,
    anneeDebut: 2015,
    dureeMois: 6,
    attestationBonneExecution: false,
  },
];

const PROFIL: Profil = {
  raisonSociale: "ATLAS DIGITAL SERVICES SARL",
  effectif: 84,
  chiffreAffaires: { "2023": 41200000, "2024": 52800000, "2025": 61500000 },
  certifications: ["ISO 9001:2015", "ISO 27001:2022", "Qualiopi"],
  attestations: [
    "Attestation fiscale",
    "Attestation CNSS",
    "Certificat du registre de commerce",
    "Assurance responsabilité civile professionnelle",
    "Déclaration sur l'honneur",
  ],
  references: REFERENCES,
  equipe: [
    { id: "CV-01", initiales: "C.Y.", poste: "Chef de projet", anneesExperience: 12 },
    { id: "CV-05", initiales: "A.B.", poste: "Chef de projet", anneesExperience: 10 },
    { id: "CV-02", initiales: "E.Q.", poste: "Architecte technique", anneesExperience: 14 },
    { id: "CV-03", initiales: "X.L.", poste: "Ingénieur de développement", anneesExperience: 12 },
    { id: "CV-07", initiales: "M.T.", poste: "Ingénieur de développement", anneesExperience: 14 },
    { id: "CV-09", initiales: "R.K.", poste: "Ingénieur qualité", anneesExperience: 11 },
  ],
};

const ANNEE = 2026;

// --- Le piege du jeu de donnees ---------------------------------------------

test("PIEGE : le secteur est celui de la colonne, jamais celui du nom du client", () => {
  const retenues = compterReferences(REFERENCES, "éducation", 5, ANNEE);
  const ids = retenues.map((reference) => reference.id).sort();

  // REF-02 compte bien que son client soit une agence de telecommunications.
  assert.ok(ids.includes("REF-02"), "REF-02 doit compter : sa colonne secteur vaut education");

  // REF-04 ne compte pas, bien que son client soit le Ministere de l'Education.
  assert.ok(
    !ids.includes("REF-04"),
    "REF-04 ne doit PAS compter : sa colonne secteur vaut energie, seul le nom du client evoque l'education",
  );

  // Ce test echoue si le comptage passe un jour par le nom du client.
  const parNomDuClient = REFERENCES.filter((reference) =>
    reference.client.toLowerCase().includes("éducation".toLowerCase()),
  ).map((reference) => reference.id);
  assert.deepEqual(parNomDuClient, ["REF-04"]);
  assert.notDeepEqual(ids, parNomDuClient);
});

test("PIEGE : aucune reference hors secteur ne se glisse dans le compte", () => {
  for (const reference of compterReferences(REFERENCES, "éducation", 5, ANNEE)) {
    assert.equal(reference.secteur, "éducation", `${reference.id} n'est pas du bon secteur`);
  }
});

test("l'anciennete est comptee depuis l'annee de reference", () => {
  assert.equal(compterReferences(REFERENCES, "éducation", 5, 2026).length, 4);
  // Avec une fenetre de 2 ans, seules 2022 et apres restent hors de portee sauf 2024.
  assert.equal(compterReferences(REFERENCES, "éducation", 2, 2026).length, 1);
  // Une fenetre large rattrape tout.
  assert.equal(compterReferences(REFERENCES, "éducation", 20, 2026).length, 4);
});

// --- Chiffre d'affaires -----------------------------------------------------

test("chiffre d'affaires moyen sur les trois derniers exercices", () => {
  const calcul = chiffreAffairesMoyen(PROFIL.chiffreAffaires);
  assert.ok(calcul !== null);
  assert.equal(Math.round(calcul.moyenne), 51833333);
  assert.deepEqual(calcul.annees, ["2023", "2024", "2025"]);
});

test("seuil de chiffre d'affaires de AO-2026-001", () => {
  const resultat = evaluerFait(
    { kind: "chiffre_affaires_min", valeur: 12778000 },
    PROFIL,
    ANNEE,
  );
  assert.equal(resultat.statut, "satisfait");
  assert.ok(resultat.preuve.includes("51 833 333 MAD"));
  assert.ok(resultat.preuve.includes("12 778 000 MAD"));
});

test("un seuil de chiffre d'affaires hors de portee bascule en non satisfait", () => {
  const resultat = evaluerFait(
    { kind: "chiffre_affaires_min", valeur: 90000000 },
    PROFIL,
    ANNEE,
  );
  assert.equal(resultat.statut, "non_satisfait");
});

test("seuls les trois exercices les plus recents comptent", () => {
  const ancien = { ...PROFIL, chiffreAffaires: { "2019": 1, "2023": 41200000, "2024": 52800000, "2025": 61500000 } };
  const calcul = chiffreAffairesMoyen(ancien.chiffreAffaires);
  assert.equal(Math.round(calcul!.moyenne), 51833333);
});

// --- Effectif ---------------------------------------------------------------

test("effectif", () => {
  assert.equal(evaluerFait({ kind: "effectif_min", valeur: 60 }, PROFIL, ANNEE).statut, "satisfait");
  assert.equal(
    evaluerFait({ kind: "effectif_min", valeur: 200 }, PROFIL, ANNEE).statut,
    "non_satisfait",
  );
});

// --- Certifications ---------------------------------------------------------

test("certification detenue, avec ou sans le mot certification", () => {
  assert.equal(
    evaluerFait({ kind: "certification_requise", nom: "ISO 9001:2015" }, PROFIL, ANNEE).statut,
    "satisfait",
  );
  assert.equal(
    evaluerFait(
      { kind: "certification_requise", nom: "certification ISO 9001:2015" },
      PROFIL,
      ANNEE,
    ).statut,
    "satisfait",
  );
});

test("certification absente : non satisfait, et un arbitrage est propose", () => {
  const resultat = evaluerFait(
    { kind: "certification_requise", nom: "ISO 14001:2015" },
    PROFIL,
    ANNEE,
  );
  assert.equal(resultat.statut, "non_satisfait");
  assert.ok(resultat.arbitrage, "la regle doit proposer un arbitrage avant de conclure");
  assert.deepEqual(resultat.arbitrage?.candidats, PROFIL.certifications);
});

test("apres arbitrage negatif, l'absence est definitive", () => {
  const resultat = evaluerFait(
    { kind: "certification_requise", nom: "ISO 14001:2015" },
    PROFIL,
    ANNEE,
    { indice: -1 },
  );
  assert.equal(resultat.statut, "non_satisfait");
  assert.equal(resultat.arbitrage, undefined);
  assert.ok(resultat.preuve.includes("apres arbitrage"));
});

// --- Attestations -----------------------------------------------------------

test("le cas reel qui exige un arbitrage : CNSS en toutes lettres", () => {
  const exige = "attestation de la Caisse Nationale de Sécurité Sociale";

  // Aucune comparaison textuelle ne rapproche cet intitule de "Attestation CNSS".
  assert.equal(chercherCorrespondance(exige, PROFIL.attestations), -1);

  const sansArbitrage = evaluerFait({ kind: "attestation_requise", nom: exige }, PROFIL, ANNEE);
  assert.equal(sansArbitrage.statut, "non_satisfait");
  assert.ok(sansArbitrage.arbitrage);

  // Le modele repond "indice 1", le CODE produit le verdict.
  const avecArbitrage = evaluerFait({ kind: "attestation_requise", nom: exige }, PROFIL, ANNEE, {
    indice: 1,
  });
  assert.equal(avecArbitrage.statut, "satisfait");
  assert.ok(avecArbitrage.preuve.includes("Attestation CNSS"));
});

test("attestation reconnue sans arbitrage quand l'intitule se recoupe", () => {
  const resultat = evaluerFait(
    { kind: "attestation_requise", nom: "Attestation fiscale" },
    PROFIL,
    ANNEE,
  );
  assert.equal(resultat.statut, "satisfait");
});

// --- References -------------------------------------------------------------

test("les 4 references education de AO-2026-001", () => {
  const resultat = evaluerFait(
    { kind: "references_min", nombre: 4, secteur: "éducation", anneesMax: 5 },
    PROFIL,
    ANNEE,
  );
  assert.equal(resultat.statut, "satisfait");
  assert.ok(resultat.preuve.includes("REF-02"));
  assert.ok(!resultat.preuve.includes("REF-04"));
});

test("une exigence de 5 references education n'est pas satisfaite", () => {
  const resultat = evaluerFait(
    { kind: "references_min", nombre: 5, secteur: "éducation", anneesMax: 5 },
    PROFIL,
    ANNEE,
  );
  assert.equal(resultat.statut, "non_satisfait");
});

test("le comptage de references n'accepte jamais d'arbitrage", () => {
  // Meme avec un arbitrage fourni, le resultat ne bouge pas : le secteur est
  // une donnee structuree, pas une question d'interpretation.
  const sans = evaluerFait(
    { kind: "references_min", nombre: 4, secteur: "éducation", anneesMax: 5 },
    PROFIL,
    ANNEE,
  );
  const avec = evaluerFait(
    { kind: "references_min", nombre: 4, secteur: "éducation", anneesMax: 5 },
    PROFIL,
    ANNEE,
    { indice: 0 },
  );
  assert.deepEqual(sans, avec);
});

// --- Equipe -----------------------------------------------------------------

test("les quatre profils de l'article 7 du CPS de AO-2026-001", () => {
  const attendus = [
    { poste: "Chef de projet", nombre: 1, experienceMin: 8 },
    { poste: "Architecte technique", nombre: 1, experienceMin: 7 },
    { poste: "Ingénieur de développement", nombre: 2, experienceMin: 5 },
    { poste: "Ingénieur qualité", nombre: 1, experienceMin: 5 },
  ] as const;

  for (const attendu of attendus) {
    const resultat = evaluerFait({ kind: "profil_equipe", ...attendu }, PROFIL, ANNEE);
    assert.equal(resultat.statut, "satisfait", `${attendu.poste} devrait etre satisfait`);
  }
});

test("un poste trop exigeant en experience n'est pas satisfait", () => {
  const resultat = evaluerFait(
    { kind: "profil_equipe", poste: "Chef de projet", nombre: 1, experienceMin: 20 },
    PROFIL,
    ANNEE,
  );
  assert.equal(resultat.statut, "non_satisfait");
});

test("un poste absent propose un arbitrage sur les intitules", () => {
  const resultat = evaluerFait(
    { kind: "profil_equipe", poste: "Scrum master", nombre: 1, experienceMin: 3 },
    PROFIL,
    ANNEE,
  );
  assert.equal(resultat.statut, "non_satisfait");
  assert.ok(resultat.arbitrage);
  assert.ok(resultat.arbitrage!.candidats.includes("Chef de projet"));
});

// --- Note technique ---------------------------------------------------------

test("le seuil de note technique reste indetermine, jamais satisfait ni refuse", () => {
  const resultat = evaluerFait(
    { kind: "note_technique_min", valeur: 60, sur: 85 },
    PROFIL,
    ANNEE,
  );
  assert.equal(resultat.statut, "indetermine");
  assert.ok(resultat.preuve.includes("propriete de l'offre"));
});

test("un seuil de note technique ne bloque jamais un verdict", () => {
  const resultat = evaluerFait({ kind: "note_technique_min", valeur: 60, sur: 85 }, PROFIL, ANNEE);
  assert.equal(estBloquant({ statut: resultat.statut, type: "eliminatoire" }), false);
});

// --- Verdict ----------------------------------------------------------------

test("un seul bloquant suffit a produire un no-go", () => {
  const resultat = calculerVerdict([
    { statut: "satisfait", type: "eliminatoire" },
    { statut: "non_satisfait", type: "eliminatoire" },
    { statut: "satisfait", type: "obligatoire" },
  ]);
  assert.equal(resultat.verdict, "no_go");
  assert.equal(resultat.bloquants, 1);
});

test("une exigence non satisfaite mais non eliminatoire ne bloque pas", () => {
  const resultat = calculerVerdict([
    { statut: "non_satisfait", type: "obligatoire" },
    { statut: "non_satisfait", type: "optionnelle" },
  ]);
  assert.equal(resultat.verdict, "go");
  assert.equal(resultat.bloquants, 0);
});

test("les indetermines sont comptes mais ne font pas basculer le verdict", () => {
  const resultat = calculerVerdict([
    { statut: "indetermine", type: "eliminatoire" },
    { statut: "satisfait", type: "eliminatoire" },
  ]);
  assert.equal(resultat.verdict, "go");
  assert.equal(resultat.indetermines, 1);
  assert.equal(resultat.bloquants, 0);
});

test("un avis sans exigence donne un go, faute de bloquant", () => {
  assert.equal(calculerVerdict([]).verdict, "go");
});
