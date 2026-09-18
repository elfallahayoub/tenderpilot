import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  analyserCompletude,
  composantesAnnoncees,
  decrireManques,
  figureCommeTitre,
} from "./completude.js";
import {
  decrireLacune,
  detecterLacunes,
  estArticleDeParticipation,
  numerosPresents,
  trousInterieurs,
} from "./lacunes.js";

/** Page 1 reelle, identique sur les dix avis y compris les scans. */
const PAGE_UN = `APPEL D'OFFRES OUVERT SUR OFFRES DE PRIX N° AO-2026-004
Objet : l'audit et la sécurisation du système d'information.
Estimation du marché 8 593 000.00 MAD TTC
Le présent dossier de consultation comprend le règlement de la consultation, le cahier des prescriptions spéciales, le
bordereau des prix et le planning prévisionnel d'exécution.`;

const PAGE_REGLEMENT = `RÈGLEMENT DE LA CONSULTATION
Article premier — Objet de la consultation`;

const PAGE_CPS = `CAHIER DES PRESCRIPTIONS SPÉCIALES
Article 1 — Objet du marché`;

const PAGE_BORDEREAU = `BORDEREAU DES PRIX — DÉTAIL ESTIMATIF
N° Désignation des prestations Unité Quantité
PLANNING PRÉVISIONNEL D'EXÉCUTION
Jalon Livrable Échéance`;

// --- Composition annoncee ---------------------------------------------------

test("les quatre composantes annoncees sont relevees", () => {
  const annoncees = composantesAnnoncees([{ numero: 1, texte: PAGE_UN }]);
  assert.deepEqual(annoncees, [
    "reglement de la consultation",
    "cahier des prescriptions speciales",
    "bordereau des prix",
    "planning previsionnel d execution",
  ]);
});

test("un avis complet est declare complet", () => {
  const resultat = analyserCompletude([
    { numero: 1, texte: PAGE_UN },
    { numero: 2, texte: PAGE_REGLEMENT },
    { numero: 4, texte: PAGE_CPS },
    { numero: 7, texte: PAGE_BORDEREAU },
  ]);
  assert.equal(resultat.complet, true);
  assert.deepEqual(resultat.manquantes, []);
  assert.equal(resultat.composantes.filter((c) => c.trouvee).length, 4);
});

test("SCAN : le bordereau et le planning absents sont NOMMES", () => {
  // AO-2026-004 et AO-2026-009 : pages 1, 2, 3 et 4 seulement.
  const resultat = analyserCompletude([
    { numero: 1, texte: PAGE_UN },
    { numero: 2, texte: PAGE_REGLEMENT },
    { numero: 4, texte: PAGE_CPS },
  ]);
  assert.equal(resultat.complet, false);
  assert.deepEqual(resultat.manquantes, ["bordereau des prix", "planning previsionnel d execution"]);
  assert.ok(decrireManques(resultat.manquantes).includes("bordereau des prix"));
});

test("l'annonce ne se valide jamais elle-meme", () => {
  // La page 1 contient les quatre libelles dans sa phrase d'annonce. Si on la
  // comptait, tout document serait declare complet.
  const resultat = analyserCompletude([{ numero: 1, texte: PAGE_UN }]);
  assert.equal(resultat.complet, false);
  assert.equal(resultat.manquantes.length, 4);
});

test("REGRESSION : une mention du bordereau ne vaut pas sa presence", () => {
  // Le cahier des prescriptions renvoie au bordereau sans le contenir. Compter
  // cette phrase declarait present un document absent.
  const cpsQuiMentionne = `CAHIER DES PRESCRIPTIONS SPÉCIALES
Article 1 — Objet du marché
Les prestations sont décrites de manière détaillée à l'article 5 et dans le bordereau des prix annexé au présent cahier.`;

  const resultat = analyserCompletude([
    { numero: 1, texte: PAGE_UN },
    { numero: 2, texte: PAGE_REGLEMENT },
    { numero: 4, texte: cpsQuiMentionne },
  ]);
  assert.ok(
    resultat.manquantes.includes("bordereau des prix"),
    "le bordereau est seulement mentionne, il reste absent",
  );
  assert.ok(figureCommeTitre(PAGE_BORDEREAU, "bordereau des prix"), "en titre, il est present");
  assert.equal(figureCommeTitre(cpsQuiMentionne, "bordereau des prix"), false);
});

test("REGRESSION : le dossier ADMINISTRATIF n'est pas la composition du dossier", () => {
  // L'article 5 du reglement enumere les pieces du dossier administratif.
  // Une regex trop large y voyait la composition du dossier de consultation et
  // declarait absentes sept "composantes" qui sont des attestations.
  const article5 = `Article 5 — Contenu des dossiers
Le dossier administratif comprend la déclaration sur l'honneur, l'attestation fiscale, l'attestation CNSS, le certificat du registre de commerce et le récépissé du cautionnement provisoire.`;

  assert.deepEqual(composantesAnnoncees([{ numero: 2, texte: article5 }]), []);
  assert.equal(analyserCompletude([{ numero: 2, texte: article5 }]).annonceSaComposition, false);
});

test("un document qui n'annonce rien ne fait l'objet d'aucune conclusion", () => {
  const resultat = analyserCompletude([{ numero: 1, texte: "Un texte sans annonce." }]);
  assert.equal(resultat.annonceSaComposition, false);
  assert.equal(resultat.complet, true);
  assert.deepEqual(resultat.manquantes, []);
});

test("la completude ne deduit jamais un document d'un autre", () => {
  // Le meme document, analyse seul ou accompagne d'un autre avis complet,
  // donne exactement le meme resultat : aucune norme externe n'intervient.
  const scan = [
    { numero: 1, texte: PAGE_UN },
    { numero: 2, texte: PAGE_REGLEMENT },
  ];
  assert.deepEqual(analyserCompletude(scan), analyserCompletude([...scan]));
  // Seul le reglement est present : le CPS, le bordereau et le planning
  // manquent. Ce compte vient du document lui-meme, d'aucun autre.
  assert.deepEqual(analyserCompletude(scan).manquantes, [
    "cahier des prescriptions speciales",
    "bordereau des prix",
    "planning previsionnel d execution",
  ]);
});

// --- Lacunes dans une enumeration -------------------------------------------

test("les trous interieurs sont les seuls signales", () => {
  assert.deepEqual(trousInterieurs([1, 2, 5]), [3, 4]);
  assert.deepEqual(trousInterieurs([6, 7, 8]), []);
  // Une enumeration peut commencer a 6 : rien ne manque avant.
  assert.deepEqual(trousInterieurs([6, 8]), [7]);
  assert.deepEqual(trousInterieurs([3]), []);
  assert.deepEqual(trousInterieurs([]), []);
});

test("les numeros sont reconnus malgre les fautes de l'OCR", () => {
  const bloc = "3.1. Justifier... 3,2. Produire... 3. 5 Produire une declaration";
  assert.deepEqual(numerosPresents(bloc, "3"), [1, 2, 5]);
});

test("CAS REEL : l'article 3 de AO-2026-004 a deux conditions illisibles", () => {
  // Reproduction de la sortie OCR observee : 3.3 et 3.4 sont degradees au
  // point que leur numero meme disparait.
  const pageOcr = `Article 3 — Conditions requises des concurrents
Peuvent participer a la presente consultation les personnes qui satisfont aux conditions
suivantes. Le non-respect d'une condition qualifiee d'eliminatoire entraine le rejet.
3.1 Justifier d'un chiffre d'affaires annuel moyen superieur a 12 890 000.00 MAD
3.2. Produire une ummwwwoemmoeummmumuwm reguliere du concurrent
34.£quo«oe………um…oerœ…œœ«luzm…œvmwmœu
3.5 Produire une declaration sur l'honneur attestant que le concurrent n'est pas
Article 4 — Capacites techniques et professionnelles
4.7 Disposer d'un effectif permanent`;

  const lacunes = detecterLacunes(pageOcr);
  assert.equal(lacunes.length, 1, "seul l'article 3 presente un trou");

  const lacune = lacunes[0]!;
  assert.equal(lacune.article, "3");
  assert.deepEqual(lacune.numerosManquants, ["3.3", "3.4"]);
  assert.equal(lacune.estConditionDeParticipation, true);

  const phrase = decrireLacune(lacune, 2);
  assert.ok(phrase.includes("condition"));
  assert.ok(phrase.includes("page 2"));
  assert.ok(phrase.includes("3.3"));
  assert.ok(phrase.includes("3.4"));
});

test("une page a couche texte ne presente aucune lacune", () => {
  const pageNette = `Article 3 — Conditions requises des concurrents
3.1. Justifier d'un chiffre d'affaires annuel moyen.
3.2. Produire une attestation fiscale.
3.3. Produire une attestation CNSS.
3.4. Etre titulaire de la certification ISO 9001:2015.
3.5. Produire une declaration sur l'honneur.
Article 4 — Capacites techniques
4.6. Justifier de references.
4.7. Disposer d'un effectif.
4.8. Presenter la liste des moyens.`;
  assert.deepEqual(detecterLacunes(pageNette), []);
});

test("un article isole ne declenche aucune alerte", () => {
  // Un seul numero vu : on ne peut rien conclure, et on ne conclut rien.
  assert.deepEqual(detecterLacunes("Article 4 — Capacites\n4.7 Disposer d'un effectif"), []);
});

test("les intitules de conditions de participation sont reconnus", () => {
  assert.equal(estArticleDeParticipation("Conditions requises des concurrents"), true);
  assert.equal(estArticleDeParticipation("Capacités techniques et professionnelles"), true);
  assert.equal(estArticleDeParticipation("Pénalités de retard"), false);
  assert.equal(estArticleDeParticipation("Modalités de règlement"), false);
});
