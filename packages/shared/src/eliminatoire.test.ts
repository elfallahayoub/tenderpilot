import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  annonceUneElimination,
  articlesEliminatoiresDeLaPage,
  estEliminatoireSelonLeTexte,
  numeroArticle,
} from "./eliminatoire.js";

/**
 * Ces tests encodent la cause d'un echec constate : dix go rendus alors que
 * quatre no-go etaient attendus, parce que le modele typait "obligatoire" sur
 * un avis ce qu'il typait "eliminatoire" sur un autre, a texte identique.
 */

/** Page 2 reelle de AO-2026-001, reduite a sa structure d'articles. */
const PAGE_DEUX = `RÈGLEMENT DE LA CONSULTATION
Article premier — Objet de la consultation
La présente consultation a pour objet la maintenance applicative du parc logiciel métier.
Article 2 — Allotissement
Les prestations sont réparties en lots indissociables listés ci-après.
Article 3 — Conditions requises des concurrents
Peuvent participer à la présente consultation les personnes physiques ou morales qui satisfont aux conditions
suivantes. Le non-respect d'une condition qualifiée d'éliminatoire entraîne le rejet de l'offre sans examen au fond.
3.1. Justifier d'un chiffre d'affaires annuel moyen hors taxes supérieur à 12 778 000.00 MAD.
3.4. Être titulaire de la certification ISO 9001:2015 et en justifier par la production du certificat.
Article 4 — Capacités techniques et professionnelles
4.6. Justifier d'au moins 4 références de prestations similaires dans le secteur éducation.
4.7. Disposer d'un effectif permanent d'au moins 60 personnes.
Article 6 — Critères de jugement des offres
Les offres jugées recevables sont notées sur cent points selon la grille suivante.`;

test("l'article 3 est eliminatoire, l'article 4 ne l'est pas", () => {
  const articles = articlesEliminatoiresDeLaPage(PAGE_DEUX);
  assert.ok(articles.has("3"), "l'article 3 annonce le rejet de l'offre");
  assert.ok(!articles.has("4"), "l'article 4 n'annonce rien de tel");
  assert.ok(!articles.has("2"));
  assert.ok(!articles.has("6"));
});

test("la clause ne deborde pas sur l'article suivant", () => {
  // 4.6 et 4.7 ne doivent pas heriter de la clause de l'article 3.
  assert.equal(estEliminatoireSelonLeTexte("Article 3.4", PAGE_DEUX), true);
  assert.equal(estEliminatoireSelonLeTexte("Article 3.1", PAGE_DEUX), true);
  assert.equal(estEliminatoireSelonLeTexte("Article 4.6", PAGE_DEUX), false);
  assert.equal(estEliminatoireSelonLeTexte("Article 4.7", PAGE_DEUX), false);
});

test("REGRESSION : deux avis au texte identique donnent le meme resultat", () => {
  // AO-2026-001 exige ISO 9001:2015, AO-2026-002 exige ISO 22301:2019, au
  // meme article 3.4, sous la meme clause. Le modele avait type l'un
  // eliminatoire et l'autre obligatoire. Le code, lui, ne varie pas.
  const pageDeAO001 = PAGE_DEUX;
  const pageDeAO002 = PAGE_DEUX.replace("ISO 9001:2015", "ISO 22301:2019");

  assert.equal(
    estEliminatoireSelonLeTexte("Article 3.4", pageDeAO001),
    estEliminatoireSelonLeTexte("Article 3.4", pageDeAO002),
  );
  assert.equal(estEliminatoireSelonLeTexte("Article 3.4", pageDeAO002), true);
});

test("les formulations usuelles de rejet sont reconnues", () => {
  assert.ok(annonceUneElimination("entraîne le rejet de l'offre sans examen au fond"));
  assert.ok(annonceUneElimination("Une note technique inférieure à soixante points est éliminatoire."));
  assert.ok(annonceUneElimination("Tout pli parvenu hors délai est écarté sans être ouvert."));
  assert.ok(annonceUneElimination("L'offre est déclarée non recevable."));
});

test("une phrase anodine n'est pas une clause d'elimination", () => {
  assert.ok(!annonceUneElimination("Les prestations sont réparties en lots indissociables."));
  assert.ok(!annonceUneElimination("Une démarche d'éco-conception sera valorisée."));
  assert.ok(!annonceUneElimination("Le délai global d'exécution est fixé à 12 mois."));
  assert.ok(!annonceUneElimination(""));
});

test("le numero d'article est extrait de ses ecritures usuelles", () => {
  assert.equal(numeroArticle("Article 3.4"), "3");
  assert.equal(numeroArticle("Règlement art. 3.1"), "3");
  assert.equal(numeroArticle("CPS art. 7.10"), "7");
  assert.equal(numeroArticle("Article 12"), "12");
  assert.equal(numeroArticle("Article premier"), null);
  assert.equal(numeroArticle(null), null);
  assert.equal(numeroArticle("sans numero"), null);
});

test("sans article identifie, le texte ne peut rien rendre eliminatoire", () => {
  assert.equal(estEliminatoireSelonLeTexte(null, PAGE_DEUX), false);
  assert.equal(estEliminatoireSelonLeTexte("Article premier", PAGE_DEUX), false);
});

test("l'article 7 du CPS et celui du reglement ne se confondent pas", () => {
  // Le rattachement se fait page par page : deux articles 7 sur deux pages
  // differentes restent independants.
  const pageReglement = `Article 7 — Dépôt des plis
Tout pli parvenu hors délai est écarté sans être ouvert.`;
  const pageCps = `CAHIER DES PRESCRIPTIONS SPÉCIALES
Article 7 — Composition de l'équipe projet
Le titulaire mobilise une équipe dédiée dont la composition minimale est précisée ci-dessous.`;

  assert.equal(estEliminatoireSelonLeTexte("Article 7", pageReglement), true);
  assert.equal(estEliminatoireSelonLeTexte("CPS art. 7", pageCps), false);
});

test("une page sans article ne rend rien eliminatoire", () => {
  assert.equal(articlesEliminatoiresDeLaPage("").size, 0);
  assert.equal(
    articlesEliminatoiresDeLaPage("Un texte libre, sans en-tete d'article, qui parle de rejet.").size,
    0,
  );
});
