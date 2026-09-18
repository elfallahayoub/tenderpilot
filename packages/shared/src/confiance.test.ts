import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  calculerConfiance,
  coherenceArticle,
  PLAFOND_CONFIANCE_OCR,
  SOCLE,
  type SignauxConfiance,
} from "./confiance.js";

function signaux(partiel: Partial<SignauxConfiance> = {}): SignauxConfiance {
  return {
    citation: "exacte",
    fait: "construit",
    article: "coherent",
    reprises: 0,
    ...partiel,
  };
}

test("le meilleur cas vaut exactement 1", () => {
  assert.equal(calculerConfiance(signaux()).valeur, 1);
});

test("le pire cas retenu vaut le socle", () => {
  const pire = calculerConfiance(
    signaux({ citation: "normalisee", fait: "non_normalisable", article: "absent", reprises: 2 }),
  );
  // 0.40 socle + 0.15 citation normalisee = 0.55, jamais en dessous du socle.
  assert.equal(pire.valeur, 0.55);
  assert.ok(pire.valeur >= SOCLE);
});

test("chaque signal deplace le score, aucun n'est decoratif", () => {
  const reference = calculerConfiance(signaux()).valeur;
  assert.ok(calculerConfiance(signaux({ citation: "normalisee" })).valeur < reference);
  assert.ok(calculerConfiance(signaux({ fait: "non_applicable" })).valeur < reference);
  assert.ok(calculerConfiance(signaux({ fait: "non_normalisable" })).valeur < reference);
  assert.ok(calculerConfiance(signaux({ article: "indeterminable" })).valeur < reference);
  assert.ok(calculerConfiance(signaux({ article: "absent" })).valeur < reference);
  assert.ok(calculerConfiance(signaux({ reprises: 1 })).valeur < reference);
});

test("un fait non normalisable pese plus lourd qu'une absence de fait", () => {
  const absent = calculerConfiance(signaux({ fait: "non_applicable" })).valeur;
  const casse = calculerConfiance(signaux({ fait: "non_normalisable" })).valeur;
  assert.ok(casse < absent);
});

test("le score reste borne entre 0 et 1", () => {
  for (const citation of ["exacte", "normalisee"] as const) {
    for (const fait of ["construit", "non_applicable", "non_normalisable"] as const) {
      for (const article of ["coherent", "indeterminable", "absent", "incoherent"] as const) {
        for (const reprises of [0, 1, 2]) {
          const resultat = calculerConfiance({ citation, fait, article, reprises });
          assert.ok(resultat.valeur >= 0 && resultat.valeur <= 1, JSON.stringify(resultat));
        }
      }
    }
  }
});

test("la justification nomme les quatre signaux", () => {
  const detail = calculerConfiance(signaux({ reprises: 2 }));
  assert.equal(detail.justification.length, 5); // socle + 4 signaux
  assert.ok(detail.justification[4]!.includes("2 reprises"));
});

test("cas reels de AO-2026-001", () => {
  // Article 3.1 : citation exacte, fait construit, article "Article 3.1" sans
  // mention de sa source, page obtenue du premier coup.
  assert.equal(
    calculerConfiance(signaux({ article: "indeterminable" })).valeur,
    0.95,
  );
  // Page 3 : le seuil eliminatoire, sans article identifiable.
  assert.equal(calculerConfiance(signaux({ article: "absent" })).valeur, 0.9);
  // Une exigence en prose sans valeur chiffrable.
  assert.equal(
    calculerConfiance(signaux({ fait: "non_applicable", article: "indeterminable" })).valeur,
    0.85,
  );
});

test("une exigence issue d'une page OCR est plafonnee", () => {
  const surCoucheTexte = calculerConfiance(signaux({ source: "texte" }));
  const surOcr = calculerConfiance(signaux({ source: "ocr" }));

  assert.equal(surCoucheTexte.valeur, 1);
  assert.equal(surOcr.valeur, PLAFOND_CONFIANCE_OCR);
  assert.ok(surOcr.justification.some((ligne) => ligne.includes("OCR")));
});

test("le plafond OCR ne releve jamais une confiance basse", () => {
  const faible = calculerConfiance(
    signaux({ citation: "normalisee", fait: "non_normalisable", article: "absent", reprises: 2, source: "ocr" }),
  );
  // 0.55 est deja sous le plafond : il reste a 0.55, le plafond ne l'augmente pas.
  assert.equal(faible.valeur, 0.55);
  assert.ok(!faible.justification.some((ligne) => ligne.includes("plafonne")));
});

test("sans source declaree, aucun plafond n'est applique", () => {
  assert.equal(calculerConfiance(signaux()).valeur, 1);
});

test("coherence de l'article avec la section calculee", () => {
  assert.equal(
    coherenceArticle("CPS art. 7", "CAHIER DES PRESCRIPTIONS SPÉCIALES"),
    "coherent",
  );
  assert.equal(
    coherenceArticle("Règlement art. 3.4", "RÈGLEMENT DE LA CONSULTATION"),
    "coherent",
  );
  assert.equal(
    coherenceArticle("CPS art. 7", "RÈGLEMENT DE LA CONSULTATION"),
    "incoherent",
  );
  assert.equal(
    coherenceArticle("Règlement art. 3.4", "CAHIER DES PRESCRIPTIONS SPÉCIALES"),
    "incoherent",
  );
  // Le cas le plus frequent : l'article ne nomme pas sa source.
  assert.equal(coherenceArticle("Article 3.2", "RÈGLEMENT DE LA CONSULTATION"), "indeterminable");
  assert.equal(coherenceArticle(null, "RÈGLEMENT DE LA CONSULTATION"), "absent");
  assert.equal(coherenceArticle("", "RÈGLEMENT DE LA CONSULTATION"), "absent");
  assert.equal(coherenceArticle("CPS art. 7", null), "indeterminable");
});
