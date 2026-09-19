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
| 30 % | Profondeur agentique | La boucle doit être **visible à l'écran** : plan, appels d'outils, modèle utilisé, échecs, reprises, escalades. Un graphe LangGraph avec état persisté, pas une suite d'appels. |
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
   C'est éliminatoire, et les dépôts sont publics.
4. **Ne jamais inventer.** Pas de référence client fabriquée, pas d'exigence
   déduite d'une page illisible, pas de montant approximatif. Quand
   l'information manque, le système le déclare et laisse l'humain trancher.
5. **`docker compose up` reste fonctionnel après chaque tranche.** Une
   régression de démarrage se corrige immédiatement, avant toute autre chose.
6. **Tout état utile survit au redémarrage.** Corrections humaines, exigences
   extraites, journal d'agent et checkpoints LangGraph sont en Postgres.
7. **Aucune boucle d'agent sans condition d'arrêt.** Nombre maximal
   d'itérations sur chaque nœud, puis escalade à l'humain.
8. **Le modèle ne produit aucun nombre.** Version forte de la règle 1 : sur
   chaque fait chiffré, le modèle recopie la valeur telle qu'elle apparaît dans
   le document ("soixante", "12 778 000.00"), et une fonction TypeScript pure,
   testée unitairement, la convertit. Un jury peut ainsi vérifier en une ligne
   qu'aucun chiffre du verdict ne sort d'un prompt. Si la conversion échoue, le
   fait vaut `null`, la confiance est plafonnée, et rien n'est deviné.

9. **Une migration appliquée est immuable.** Depuis la tranche 8, la base
   contient du travail humain : `npm run reset` n'est plus une réponse
   acceptable à un changement de schéma. Les fichiers de `db/migrations` sont
   appliqués une fois, enregistrés dans `schema_migrations`, et ne sont jamais
   réécrits. Une correction passe par une migration supplémentaire, sinon la
   base d'un autre poste ne rejouerait pas la modification.

## 4. Stack

- Interface : React 18 + TypeScript (Vite)
- API et agents : Node.js 20 + TypeScript (Fastify)
- Orchestration : LangGraph (`@langchain/langgraph`), checkpointer Postgres
- Base : PostgreSQL 16, pgvector en dimension **512**
- Cache et file : Redis 7, BullMQ pour l'ingestion et l'OCR
- Exécution : Docker Compose — `web`, `api`, `worker`, `postgres`, `redis`
- PDF : `unpdf` ou `pdf-parse` pour la couche texte, Tesseract pour l'OCR
- Validation : `zod` sur toute sortie de modèle
- Export : librairie `docx`
- Outils de développement : `nodemon` en mode scrutin (`--legacy-watch`), parce que les événements du système de fichiers ne traversent pas un montage Windows vers un conteneur Linux et que le rechargement à chaud ne se déclencherait jamais.
- Téléversement : `@fastify/multipart`, pour recevoir le PDF déposé par l'interface.
- Extension de schéma acceptée : colonne `motif_echec` sur `documents`, sans laquelle un statut `echec` serait affiché sans sa raison.

Ne pas ajouter de dépendance ni de service hors de cette liste sans le signaler.

## 5. Modèles et routage — critère d'évaluation

Deux endpoints Azure OpenAI sont fournis. **Le choix du modèle au bon endroit
fait partie de l'évaluation de l'architecture agentique**, et l'usage est
partagé entre tous les participants et suivi. Le routage est donc explicite,
centralisé dans un seul module `src/llm.ts`, et jamais improvisé dans le code.

| Usage | Modèle | Variables |
|---|---|---|
| Orchestration, planification, décisions à plusieurs étapes, arbitrages ambigus | **gpt-5.5** | `LLM_URL`, `LLM_API_KEY`, `LLM_MODEL` |
| Extraction, classification, résumé, reformulation, sortie JSON, appels d'outils répétitifs | **gpt-4.1** | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_DEPLOYMENT_NAME` |
| Indexation et recherche sémantique des références | **embedder-small-3**, 512 dimensions | `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, servi par `LLM_URL` et `LLM_API_KEY` |

Conséquences dans le code :

- **L'embedder n'est pas servi par le déploiement Azure.** `AZURE_OPENAI_ENDPOINT`
  répond 404 sur `embedder-small-3` : les embeddings passent par la surface v1
  de `LLM_URL`, avec un jeton porteur, le modèle dans le corps et le paramètre
  `dimensions` à 512. Vérifié, et documenté dans le README.

- Extractor, Writer et Compliance tournent sur **gpt-4.1**. Seuls
  l'Orchestrator et le Qualifier en cas ambigu utilisent **gpt-5.5**.
- Les embeddings du profil, des références et des offres passées sont calculés
  **une seule fois** par un script de seed, puis stockés. Jamais recalculés.
- Chaque appel passe par `llm.ts`, qui journalise modèle, tokens et durée dans
  `agent_events`. Le journal affiche quel modèle a traité quelle étape : le
  routage se démontre à l'écran sans avoir à l'expliquer.
- Cache Redis sur les appels identiques, clé = hash du prompt et du modèle.
- `max_tokens` borné sur chaque appel, prompts courts, données passées par
  appel d'outil et non recopiées dans le prompt.

## 6. Les cinq agents

| Agent | Responsabilité | Entrée → sortie | Modèle |
|---|---|---|---|
| Extractor | Parse l'avis en exigences structurées, typées, sourcées. | Document → `Requirement[]` | gpt-4.1 |
| Qualifier | Normalise chaque exigence en fait vérifiable et prépare le verdict. | `Requirement[]` + profil → `Evaluation[]` | gpt-4.1, gpt-5.5 si ambigu |
| Writer | Rédige le mémoire section par section en citant les références réelles. | Exigences + références → sections | gpt-4.1 |
| Compliance | Relit contre la checklist administrative, refuse de valider si une pièce manque. | Livrable → verdict + manques | gpt-4.1 |
| Orchestrator | Planifie, relance les agents en échec, escalade à l'humain. | Graphe LangGraph | gpt-5.5 |

La séparation des responsabilités n'est pas négociable : un unique appel au
modèle qui produirait tout le résultat ne satisfait pas le cahier des charges.

**Le Qualifier ne décide pas seul.** Il produit un fait machine
(`chiffre_affaires_min: 12778000`) ; c'est le moteur de règles en TypeScript qui
compare au profil et produit le verdict.

## 7. Contrats de données

Ces formes sont le contrat entre les agents. Toute sortie de modèle est validée
par un schéma `zod` correspondant, avec au maximum deux tentatives de reprise,
puis statut `indetermine` et escalade — jamais de valeur devinée.

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
  bloquant: boolean;          // non satisfait ET type éliminatoire
};

type AgentEvent = {
  id: string;
  runId: string;
  horodatage: string;
  agent: string;              // "extractor", "orchestrator", ...
  etape: string;              // "lecture page 4", "appel outil references"
  modele: string | null;      // "gpt-4.1", "gpt-5.5", null si code pur
  tokens: number | null;
  dureeMs: number;
  statut: "succes" | "echec" | "reprise" | "escalade";
  detail: string;
};
```

Chaque variante de `Fait` a une fonction d'évaluation pure en TypeScript, avec
un test unitaire. C'est le cœur de la fiabilité, et c'est ce que le jury lira.

## 8. Les sept exigences

| Réf. | Exigence | Critère d'acceptation, vérifié à l'écran |
|---|---|---|
| EX-01 | Déposer un avis PDF et déclencher le traitement. | Glisser `AO-2026-001.pdf` lance le traitement et affiche une progression par étape. |
| EX-02 | Matrice de conformité, chaque exigence typée. | Les articles 3 et 4 du règlement, l'article 7 du CPS et le seuil de la grille de notation apparaissent tous, correctement typés. |
| EX-03 | Chaque exigence cite sa page source, accessible en un clic. | Un clic ouvre le PDF à la bonne page, avec l'extrait littéral affiché. |
| EX-04 | Score go / no-go justifié, avec les points bloquants. | Sur les 10 avis fournis : 6 go et 4 no-go. Les bloquants sont en tête de liste. |
| EX-05 | Mémoire technique en sections, exportable DOCX ou PDF. | Le fichier s'ouvre dans Word, et chaque référence citée existe dans `references.csv`. |
| EX-06 | Revue humaine : valider ou corriger une section, la correction est conservée. | Après rechargement, la correction est là, et elle se retrouve dans l'export. |
| EX-07 | Un document illisible produit un message clair. | Les pages non lues sont listées nommément, aucune exigence n'est inventée pour les combler. |

## 9. Les trois différenciateurs

Au-delà des sept exigences, ce sont eux qui séparent un 15 d'un 18. À
construire **pendant** les tranches, pas après.

### 9.1. Le journal de l'agent, visible à l'écran

Un panneau latéral qui affiche en direct, à partir de la table `agent_events` :
l'étape en cours, l'outil appelé, **le modèle utilisé et les tokens**, la
durée, les échecs, les reprises, les escalades. Persisté, donc rejouable après
coup pour n'importe quel traitement.

C'est la preuve de la profondeur agentique (30 %), la démonstration du routage
des modèles, et le plan tout fait de la vidéo. Sans ce panneau, le jury voit un
formulaire et un résultat.

### 9.2. La page « Qualité », avec des chiffres honnêtes

Construire un jeu de vérité annoté à la main dans `eval/verite-terrain.json` :
pour chacun des 10 avis, le verdict attendu et les exigences éliminatoires
attendues. Puis `npm run eval` repasse les 10 avis et affiche :

- verdicts corrects : X / 10
- rappel sur les exigences éliminatoires : X %
- exigences extraites en trop (bruit) : X
- pages non lues déclarées : X
- coût : tokens par avis, par modèle

Afficher ces chiffres dans l'application. Le cahier des charges valorise
explicitement cette démarche, et un taux assumé de 85 % vaut mieux qu'un 100 %
revendiqué sans preuve.

### 9.3. La mémoire des corrections

Quand l'humain corrige une section (EX-06), la correction est stockée et
**réinjectée dans le contexte des sections suivantes et des traitements
suivants**. C'est un scénario de test explicite du cahier des charges : « la
correction est conservée et réutilisée ».

### 9.4. Aucun chiffre inventé, du début à la fin

Généralisation de la règle 8 à toute la chaîne, y compris au Writer. Le
principe est unique et se vérifie d'une seule manière : **tout nombre écrit en
chiffres, où qu'il apparaisse dans le système, doit se trouver dans la matière
fournie.**

- L'Extractor recopie les valeurs telles qu'elles figurent dans le document, et
  `normaliserNombre` les convertit.
- Le moteur de règles produit les preuves chiffrées, à partir du profil lu en
  base par appel d'outil.
- Le Writer n'écrit aucun chiffre absent de sa matière. Les dénombrements se
  rédigent en toutes lettres, « quatre phases » ; les chiffres sont réservés à
  la recopie d'une valeur fournie. Une fonction pure relève tous les nombres de
  la section produite et la rejette si l'un d'eux est introuvable dans la
  matière.
- Le Reporter recopie, il ne recalcule jamais.

Un seul mécanisme couvre ainsi les montants, les dates, les seuils et les
valeurs du verdict. Une section rejetée est régénérée une fois, puis marquée
« à compléter par l'humain » : un mémoire fluide contenant un chiffre inventé
vaut moins qu'un mémoire qui déclare ses trous.

## 10. Les données

Dans `data/sujet-01-tenderpilot/` :

- `avis/` : 10 dossiers de consultation, 7 pages chacun
- `profil-entreprise.json` et `.pdf` : identité, capacités, 24 références, 14 CV
- `references.csv`, `equipe.csv` : les mêmes données, directement exploitables
- `attestations/` : 4 pièces administratives
- `offres-passees/` : 2 mémoires techniques rendus — la matière à citer

**Ces données ne sont jamais recopiées dans un prompt.** Le profil et les
références se lisent par appel d'outil, depuis la base. Le jury vérifie ce point.

## 11. Pièges connus, à traiter explicitement

- **Les exigences sont dispersées** : conditions de participation à l'article 3
  du règlement, capacités techniques à l'article 4, composition de l'équipe à
  l'article 7 du CPS, et un seuil éliminatoire caché sous la grille de notation
  de l'article 6 (« une note technique inférieure à soixante points sur les
  quatre-vingt-cinq points techniques est éliminatoire »). L'extraction
  parcourt **toutes** les pages, sans exception.
- **AO-2026-004 et AO-2026-009 sont des scans intégraux**, sans couche texte :
  OCR obligatoire. Ils ne contiennent que **4 pages sur les 7 attendues** :
  trois pages manquent et doivent être signalées nommément.
- **6 go et 4 no-go** sur les 10 avis. Répondre systématiquement « non » se
  trompe six fois sur dix.
- Le profil détient ISO 9001:2015, ISO 27001:2022 et Qualiopi, mais pas tout.
  Un avis exigeant une certification absente bascule en no-go.
- Les montants et durées apparaissent en chiffres ou en toutes lettres selon
  les avis : la normalisation doit être testée.

## 12. Anti-patterns qui coûtent des points

- Un prompt géant qui reçoit tout le PDF et renvoie tout le résultat.
- Un verdict go / no-go produit par le modèle.
- Une exigence affichée sans page source.
- Une section de mémoire citant une référence absente de `references.csv`.
- Un `try / catch` qui avale l'erreur et affiche un résultat partiel sans le dire.
- gpt-5.5 appelé pour de l'extraction ou du formatage.
- Un état conservé en mémoire du processus, perdu au redémarrage.
- Une interface chargée : le jury note la lisibilité, pas le design.

## 13. Hors périmètre

Non attendus, et non valorisés s'ils sont livrés : authentification et gestion
des rôles, soumission réelle sur un portail de marchés publics, versionnement
documentaire, workflow de validation à plusieurs, design graphique élaboré.

## 14. Méthode de travail

- **Un plan avant le code.** Pour chaque tranche : découpage en fichiers,
  schémas, points d'incertitude. Attendre validation, puis coder.
- **Une tranche verticale à la fois**, testée dans le navigateur avant de
  passer à la suivante.
- **Définition de terminé** : ça marche dans le navigateur, ça survit à un
  `docker compose down && up`, le cas d'échec est géré, c'est commité et poussé.
- **Un commit par tranche**, message en français, court et précis.
- Signaler toute hypothèse incertaine au lieu de choisir en silence.

## 15. Ordre de construction

1. Squelette Docker à cinq services qui démarre à vide.
2. Ingestion PDF : texte, numéro de page, cache Redis par document.
3. Extractor et matrice de conformité (EX-01, EX-02, EX-03).
4. Moteur de règles testé et Qualifier (EX-04).
5. Journal de l'agent à l'écran (9.1).
6. OCR et déclaration des pages non lues (EX-07).
7. Writer et export DOCX (EX-05).
8. Revue humaine et mémoire des corrections (EX-06, 9.3).
9. Jeu de vérité et page Qualité (9.2).
10. README, vidéo, test sur clone vierge.

Ne jamais passer à l'étape suivante en laissant la précédente à moitié faite.

## 16. La démonstration devant le jury

Le produit doit permettre de dérouler ceci sans préparation, en trois minutes :

1. Déposer un avis jamais vu. Le journal de l'agent défile : plan, extraction
   page par page, modèles utilisés.
2. La matrice s'affiche. Cliquer sur une exigence éliminatoire, le PDF s'ouvre
   à la bonne page sur l'extrait cité.
3. Le verdict no-go apparaît, avec le bloquant en tête et la preuve chiffrée.
4. Déposer un scan. Le système annonce les pages qu'il n'a pas pu lire, et
   n'invente rien.
5. Générer le mémoire, corriger une section, la correction reste après
   rechargement et se retrouve dans l'export DOCX.
6. Ouvrir la page Qualité : les chiffres, assumés.

Prévoir une commande `npm run reset` qui remet la base à zéro en quelques
secondes, pour pouvoir refaire la démonstration devant chaque évaluateur.

## 17. Bonus — seulement après le gel du périmètre

Ne rien commencer ici tant que les points 1 à 10 ne sont pas terminés.

1. **Détecter les contradictions internes du CPS** — un délai annoncé
   différemment entre le règlement et le cahier des prescriptions, par exemple.
   Réutilise les exigences déjà extraites, aucune infrastructure nouvelle, se
   démontre en dix secondes.
2. **Comparer avec les marchés attribués similaires**, à partir des offres
   passées fournies.
3. **Veille** : alerter sur les nouveaux avis correspondant au profil.

Le document bilingue est listé comme bonus, mais **tous les avis fournis sont
en français** : rien sur quoi le démontrer devant le jury. À laisser de côté.

## 18. Le README, écrit en même temps que le code

Le jury le lit avant de lancer le projet. Dans cet ordre : le problème métier en
cinq lignes, une capture de la matrice de conformité, le schéma des cinq agents
et du graphe, la frontière entre le modèle et le code avec un exemple, le
routage des modèles et pourquoi, le lancement en trois commandes, les résultats
de `npm run eval`, et les limites connues assumées.
