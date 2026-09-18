# TenderPilot — instructions du projet

Hackathon Agentic AI ESISA × numeOS, sujet 01. Projet individuel.
Deadline : samedi 19 septembre 2026, minuit. Réponds, commente et commite en français.

Objectif : finir premier. Cela ne s'obtient pas en livrant plus de
fonctionnalités que les autres, mais en livrant un produit qui **tourne devant
le jury sur des cas qu'il n'a pas préparés**, dont **chaque affirmation est
vérifiable en un clic**, et dont **on peut prouver la qualité avec des chiffres**.

---

## 1. Le produit

Une application web où une PME dépose un avis d'appel d'offres en PDF. Une
équipe d'agents en extrait les exigences tracées page par page, rend un verdict
go / no-go argumenté, et rédige un brouillon de mémoire technique exportable,
que l'humain corrige section par section.

L'entreprise utilisatrice est ATLAS DIGITAL SERVICES SARL, profil dans
`data/sujet-01-tenderpilot/profil-entreprise.json`.

## 2. Comment la note est calculée

| Poids | Critère | Conséquence directe sur le code |
|---|---|---|
| 30 % | Profondeur agentique | La boucle doit être **visible à l'écran** : plan, appels d'outils, échecs, reprises, escalades. Un graphe LangGraph avec état persisté, pas une suite d'appels. |
| 25 % | Produit fonctionnel en direct | `docker compose up` sur une machine vierge, et ça marche sur un avis jamais vu. |
| 20 % | Fiabilité et garde-fous | Traçabilité page par page, niveaux de confiance, refus d'inventer, pages non lues déclarées. |
| 15 % | Qualité technique | Code lisible, README utile, tests des règles déterministes. |
| 10 % | Pitch et vidéo | Deux minutes, le problème en quinze secondes, l'agent qui raisonne à l'écran. |

Les trois premières lignes se gagnent dans **l'interface**, pas dans le backend.
Un raisonnement parfait qu'on ne voit pas ne rapporte rien.

## 3. Règles absolues

1. **Le code décide et compte, le modèle lit et rédige.** Toute comparaison
   numérique — chiffre d'affaires contre seuil, effectif, nombre de références
   dans un secteur, années d'expérience, dates — se fait en TypeScript, dans un
   moteur de règles testé unitairement. Jamais dans un prompt.
2. **Le numéro de page et l'extrait source sont stockés dès l'extraction**, sur
   chaque exigence. Impossibles à reconstituer après coup.
3. **Aucune clé API dans le dépôt.** `.env` dans `.gitignore`, seul
   `.env.example` est versionné. Ne jamais lire, écrire ni afficher `.env`.
   C'est éliminatoire.
4. **Ne jamais inventer.** Pas de référence client fabriquée, pas d'exigence
   déduite d'une page illisible, pas de montant approximatif. Quand
   l'information manque, le système le déclare et laisse l'humain trancher.
5. **`docker compose up` reste fonctionnel après chaque tranche.** Une
   régression de démarrage se corrige immédiatement, avant toute autre chose.
6. **Tout état utile survit au redémarrage.** Les corrections humaines, les
   exigences extraites et les checkpoints LangGraph sont en Postgres, pas en
   mémoire.

## 4. Stack

- Interface : React 18 + TypeScript (Vite)
- API et agents : Node.js 20 + TypeScript (Fastify)
- Orchestration : LangGraph (`@langchain/langgraph`), checkpointer Postgres
- Base : PostgreSQL 16, pgvector pour retrouver les références à citer
- Cache et file : Redis 7, BullMQ pour l'ingestion et l'OCR
- Modèle : endpoint numeOS compatible OpenAI (`LLM_BASE_URL`, `LLM_API_KEY`)
- Exécution : Docker Compose — `web`, `api`, `worker`, `postgres`, `redis`
- PDF : `unpdf` ou `pdf-parse` pour la couche texte, Tesseract pour l'OCR
- Export : librairie `docx`

Ne pas ajouter de dépendance ni de service hors de cette liste sans le signaler.

## 5. Les cinq agents

| Agent | Responsabilité | Entrée → sortie |
|---|---|---|
| Extractor | Parse l'avis en exigences structurées, typées, sourcées. | Document → `Requirement[]` |
| Qualifier | Confronte les exigences au profil. Prépare les faits pour le moteur de règles. | `Requirement[]` + profil → `Evaluation[]` |
| Writer | Rédige le mémoire section par section en citant les références réelles. | Exigences + références → sections |
| Compliance | Relit contre la checklist administrative, refuse de valider si une pièce manque. | Livrable → verdict + manques |
| Orchestrator | Planifie, relance les agents en échec, escalade à l'humain. | Graphe LangGraph |

La séparation des responsabilités n'est pas négociable : un unique appel au
modèle qui produirait tout le résultat ne satisfait pas le cahier des charges.

**Le Qualifier ne décide pas seul.** Il normalise l'exigence en fait vérifiable
(`type: chiffre_affaires_min, valeur: 12778000`), et c'est le moteur de règles
en TypeScript qui compare au profil et produit le verdict.

## 6. Contrats de données

Ces formes sont le contrat entre les agents. Ne pas les changer sans raison.

```ts
type Requirement = {
  id: string;
  texte: string;              // l'exigence reformulée, courte
  citation: string;           // extrait littéral du document
  page: number;               // page source, obligatoire
  article: string | null;     // "Règlement art. 3.4", "CPS art. 7"
  type: "obligatoire" | "optionnelle" | "eliminatoire";
  categorie: "administratif" | "financier" | "technique" | "equipe" | "delai";
  fait: Fait | null;          // forme machine, null si non normalisable
  confiance: number;          // 0 à 1, affiché dans l'interface
};

type Fait =
  | { kind: "chiffre_affaires_min"; valeur: number }
  | { kind: "effectif_min"; valeur: number }
  | { kind: "certification_requise"; nom: string }
  | { kind: "references_min"; nombre: number; secteur: string; anneesMax: number }
  | { kind: "profil_equipe"; poste: string; nombre: number; experienceMin: number }
  | { kind: "attestation_requise"; nom: string }
  | { kind: "note_technique_min"; valeur: number; sur: number };

type Evaluation = {
  requirementId: string;
  statut: "satisfait" | "non_satisfait" | "indetermine";
  preuve: string;             // "CA moyen 51 833 333 MAD > 12 778 000 MAD requis"
  bloquant: boolean;          // vrai si non satisfait ET type éliminatoire
};
```

Chaque `Fait` a une fonction d'évaluation pure en TypeScript, avec un test
unitaire. C'est le cœur de la fiabilité, et c'est ce que le jury ira lire.

## 7. Les sept exigences

| Réf. | Exigence | Critère d'acceptation, vérifié à l'écran |
|---|---|---|
| EX-01 | Déposer un avis PDF et déclencher le traitement. | Glisser `AO-2026-001.pdf` lance le traitement et affiche une progression par étape. |
| EX-02 | Matrice de conformité, chaque exigence typée. | Les articles 3 et 4 du règlement, l'article 7 du CPS et le seuil de la grille de notation apparaissent tous, correctement typés. |
| EX-03 | Chaque exigence cite sa page source, accessible en un clic. | Un clic ouvre le PDF à la bonne page, avec l'extrait littéral affiché. |
| EX-04 | Score go / no-go justifié, avec les points bloquants. | Sur les 10 avis fournis : 6 go et 4 no-go. Les bloquants sont en tête de liste. |
| EX-05 | Mémoire technique en sections, exportable DOCX ou PDF. | Le fichier s'ouvre dans Word, et chaque référence citée existe dans `references.csv`. |
| EX-06 | Revue humaine : valider ou corriger une section, la correction est conservée. | Après rechargement, la correction est là, et elle se retrouve dans l'export. |
| EX-07 | Un document illisible produit un message clair. | Les pages non lues sont listées nommément, aucune exigence n'est inventée pour les combler. |

## 8. Les trois différenciateurs

Au-delà des sept exigences, ces trois éléments sont ce qui distingue un projet
noté 15 d'un projet noté 18. À construire **pendant** les tranches, pas après.

### 8.1. Le journal de l'agent, visible à l'écran

Un panneau latéral qui affiche, en direct pendant le traitement : l'étape en
cours, l'outil appelé avec ses arguments, la durée, le résultat en une ligne,
les échecs et les reprises, les escalades vers l'humain. Chaque ligne est
horodatée et persistée en base (table `agent_events`), donc rejouable après
coup pour n'importe quel traitement.

C'est ce qui prouve la profondeur agentique (30 %), et c'est le plan de la
vidéo. Sans ce panneau, le jury voit un formulaire et un résultat.

### 8.2. La page « Qualité », avec des chiffres honnêtes

Construire un jeu de vérité annoté à la main, dans `eval/verite-terrain.json` :
pour chacun des 10 avis, le verdict attendu et la liste des exigences
éliminatoires attendues. Puis une commande `npm run eval` qui repasse les 10
avis et affiche :

- verdicts corrects : X / 10
- rappel sur les exigences éliminatoires : X %
- exigences extraites en trop (bruit) : X
- pages non lues déclarées : X

Afficher ces chiffres dans l'application. Le cahier des charges valorise
explicitement cette démarche, et un taux assumé de 85 % vaut mieux qu'un 100 %
revendiqué sans preuve.

### 8.3. La mémoire des corrections

Quand l'humain corrige une section du mémoire (EX-06), la correction est
stockée et **réinjectée dans le contexte des sections suivantes** et des
traitements suivants. C'est le scénario de test explicite du cahier des
charges : « la correction est conservée et réutilisée ».

## 9. Les données

Dans `data/sujet-01-tenderpilot/` :

- `avis/` : 10 dossiers de consultation, 7 pages chacun
- `profil-entreprise.json` et `.pdf` : identité, capacités, 24 références, 14 CV
- `references.csv`, `equipe.csv` : les mêmes données, directement exploitables
- `attestations/` : 4 pièces administratives
- `offres-passees/` : 2 mémoires techniques rendus — la matière à citer

**Ces données ne sont jamais recopiées dans un prompt.** Le profil et les
références se lisent par appel d'outil, depuis la base. Le jury vérifie ce
point.

## 10. Pièges connus, à traiter explicitement

- **Les exigences sont dispersées** : conditions de participation à l'article 3
  du règlement, capacités techniques à l'article 4, composition de l'équipe à
  l'article 7 du CPS, et un seuil éliminatoire caché sous la grille de notation
  de l'article 6 (« une note technique inférieure à soixante points sur les
  quatre-vingt-cinq points techniques est éliminatoire »). Un agent qui ne lit
  qu'un article en rate. L'extraction parcourt **toutes** les pages.
- **AO-2026-004 et AO-2026-009 sont des scans intégraux**, sans couche texte :
  OCR obligatoire. Ils ne contiennent que **4 pages sur les 7 attendues** :
  trois pages manquent et doivent être signalées nommément.
- **6 go et 4 no-go** sur les 10 avis. Répondre systématiquement « non » se
  trompe six fois sur dix.
- Le profil détient ISO 9001:2015, ISO 27001:2022 et Qualiopi, mais pas tout.
  Un avis exigeant une certification absente bascule en no-go.
- Les seuils sont exprimés en toutes lettres ou en chiffres selon les avis :
  la normalisation des montants et des durées doit être testée.

## 11. Anti-patterns qui coûtent des points

- Un prompt géant qui reçoit tout le PDF et renvoie tout le résultat.
- Un verdict go / no-go produit par le modèle.
- Une exigence affichée sans page source.
- Une section de mémoire qui cite une référence absente de `references.csv`.
- Un `try / catch` qui avale l'erreur et affiche un résultat partiel sans le dire.
- Un état conservé en mémoire du processus, perdu au redémarrage.
- Une interface chargée : le jury note la lisibilité, pas le design.

## 12. Hors périmètre

Non attendus, et non valorisés s'ils sont livrés : authentification et gestion
des rôles, soumission réelle sur un portail de marchés publics, versionnement
documentaire, workflow de validation à plusieurs, design graphique élaboré.

## 13. Méthode de travail

- **Un plan avant le code.** Pour chaque tranche : découpage en fichiers,
  schémas, points d'incertitude. Attendre validation, puis coder.
- **Une tranche verticale à la fois**, testée dans le navigateur avant de
  passer à la suivante.
- **Définition de terminé** pour une tranche : ça marche dans le navigateur, ça
  survit à un `docker compose down && up`, le cas d'échec est géré, et c'est
  commité.
- **Un commit par tranche**, message en français, court et précis.
- Quand une hypothèse est incertaine, la signaler au lieu de choisir en
  silence.

## 14. Ordre de construction

1. Squelette Docker à cinq services qui démarre à vide.
2. Ingestion PDF, texte + numéro de page, cache Redis par document.
3. Extractor et matrice de conformité (EX-01, EX-02, EX-03).
4. Moteur de règles testé et Qualifier (EX-04).
5. Journal de l'agent à l'écran (8.1).
6. OCR et déclaration des pages non lues (EX-07).
7. Writer et export DOCX (EX-05).
8. Revue humaine et mémoire des corrections (EX-06, 8.3).
9. Jeu de vérité et page Qualité (8.2).
10. README, vidéo, test sur clone vierge.

Ne jamais passer à l'étape suivante en laissant la précédente à moitié faite.

## 15. Bonus — seulement après le gel du périmètre

Ne rien commencer ici tant que les points 1 à 10 ne sont pas terminés.

1. **Détecter les contradictions internes du CPS** — par exemple un délai
   annoncé différemment entre le règlement et le cahier des prescriptions.
   Réutilise les exigences déjà extraites, aucune infrastructure nouvelle, se
   démontre en dix secondes.
2. **Comparer avec les marchés attribués similaires**, à partir des offres
   passées fournies.
3. **Veille** : alerter sur les nouveaux avis correspondant au profil.

Le traitement d'un document bilingue est listé comme bonus au cahier des
charges, mais **tous les avis fournis sont en français** : il n'y a aucun
document sur lequel le démontrer devant le jury. À laisser de côté.

## 16. Le README, écrit en même temps que le code

Le jury le lit avant de lancer le projet. Il contient, dans cet ordre : le
problème métier en cinq lignes, une capture de la matrice de conformité, le
schéma des cinq agents et du graphe, la frontière entre le modèle et le code
avec un exemple, le lancement en trois commandes, les résultats de `npm run
eval`, et les limites connues assumées.
