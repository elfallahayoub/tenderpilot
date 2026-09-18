# TenderPilot

Une PME dépose un avis d'appel d'offres en PDF. Une équipe d'agents en extrait
les exigences tracées page par page, rend un verdict go / no-go argumenté, et
rédige un brouillon de mémoire technique que l'humain corrige section par
section.

Le problème est simple à énoncer et coûteux à résoudre à la main. Un dossier de
consultation marocain disperse ses conditions éliminatoires sur sept pages, dans
trois documents distincts, et une seule condition manquée fait rejeter l'offre
sans examen au fond. Répondre à un avis mobilise plusieurs jours de travail, et
la décision de répondre ou non se prend souvent sans avoir tout lu.

L'entreprise utilisatrice est ATLAS DIGITAL SERVICES SARL.

## Lancement

Trois commandes, sur une machine où Docker est installé.

```bash
cp .env.example .env     # puis renseigner les deux clés
docker compose up -d --build
open http://localhost:5173
```

L'interface est sur le port 5173, l'API sur le port 3000. La route `/health`
indique l'état de Postgres, de Redis, et nomme les variables d'environnement
manquantes sans jamais afficher leur valeur.

### Remettre à zéro entre deux démonstrations

```bash
npm run reset      # base et fichiers effacés, cache des appels au modèle CONSERVÉ
npm run reset:all  # tout effacé, cache compris
```

La distinction compte. Le cache Redis mémorise chaque appel au modèle sous
l'empreinte de son prompt. `npm run reset` permet de rejouer la démonstration
autant de fois que nécessaire sans refacturer un seul jeton, ce qui importe
puisque l'usage des modèles est partagé entre tous les participants.
`npm run reset:all` repart d'un cache vide, et la prochaine extraction est
facturée.

### Tests

```bash
npm test
```

Les tests portent sur les règles déterministes, c'est-à-dire sur le code dont
dépend la justesse des verdicts : la normalisation des nombres, la vérification
des citations, la construction des faits machine, et le barème de confiance.

## Les cinq agents

| Agent | Responsabilité | Modèle | État |
|---|---|---|---|
| Ingestor | Lit le PDF page par page, déclare les pages illisibles. | aucun | fait |
| Extractor | Transforme chaque page en exigences typées et sourcées. | gpt-4.1 | fait |
| Qualifier | Évalue chaque exigence contre le profil, prépare le verdict. | gpt-4.1, gpt-5.5 si ambigu | fait |
| Writer | Rédige le mémoire en citant les références réelles. | gpt-4.1 | à venir |
| Compliance | Relit contre la checklist administrative. | gpt-4.1 | à venir |
| Orchestrator | Planifie, relance, escalade à l'humain. | gpt-5.5 | à venir |

Déposer un avis déclenche la chaîne complète : ingestion, puis extraction, puis
qualification, chacune mettant la suivante en file. Chaque étape écrit une ligne
dans le journal d'agent avec le modèle utilisé, les jetons réellement consommés
et la durée.

Le Qualifier ne décide jamais seul. Il lit le profil en base par appel d'outil,
et c'est le moteur de règles en TypeScript qui compare et produit le verdict.
Les deux modèles n'interviennent qu'aux endroits où le code ne peut pas trancher
seul, et chaque évaluation porte la trace de son origine :

| Origine | Ce qui s'est passé |
|---|---|
| `deterministe` | Le code a comparé et conclu seul. |
| `normalisation_gpt41` | Une exigence éliminatoire sans fait machine a fait l'objet d'une seconde passe de normalisation, puis le code a comparé. |
| `arbitrage_gpt55` | Deux intitulés différents désignaient la même pièce, le modèle l'a établi, le code a conclu. |
| `non_evaluable` | Aucune forme machine : l'exigence remonte à l'humain. |

Cette colonne est affichée dans le détail de chaque exigence. Le routage des
modèles se démontre ainsi à l'écran, sans avoir à l'expliquer.

### Avant de déposer un avis

```bash
npm run seed
```

Charge le profil d'ATLAS DIGITAL SERVICES, ses 24 références et ses 14 CV en
base. Le script est idempotent. Sans lui, la qualification échoue explicitement
au lieu de produire un verdict sur un profil vide.

## La frontière entre le modèle et le code

C'est la décision d'architecture la plus importante du projet, et elle est
vérifiable en une ligne.

**Le modèle ne produit aucun nombre.** Sur la page 3 de AO-2026-001, le seuil
éliminatoire est écrit « une note technique inférieure à soixante points sur les
quatre-vingt-cinq points techniques est éliminatoire ». Le modèle renvoie les
deux valeurs telles qu'il les lit, sous forme de texte :

```json
{ "kind": "note_technique_min", "valeurBrute": "soixante", "surBrute": "quatre-vingt-cinq" }
```

C'est une fonction TypeScript pure, `normaliserNombre`, testée unitairement, qui
rend 60 et 85. Aucun chiffre du verdict ne sort d'un prompt. Le corollaire est
tout aussi important : quand la conversion échoue, le fait vaut `null` et
l'exigence reste affichée sans forme machine, avec une confiance abaissée en
conséquence. Le système préfère dire qu'il ne sait pas.

**Aucune citation n'est crue sur parole.** Le modèle doit recopier l'extrait
littéral. Le code cherche ensuite cet extrait dans le texte de la page
réellement stocké, et enregistre la sous-chaîne d'origine, jamais celle du
modèle. Une citation introuvable est une hallucination : l'exigence est rejetée
et l'événement est journalisé sous un libellé dédié, ce qui en fait un
indicateur mesurable. Lors de la mise au point, ce garde-fou a rejeté quatre
exigences dont le modèle avait reformulé les lignes d'un tableau en phrase.

**La confiance est calculée, pas déclarée.** Le modèle répondait 1 sur chaque
exigence, ce qui n'informait personne. Elle est désormais calculée par le code à
partir de ce qu'il constate au moment d'enregistrer l'exigence, donc
reproductible et explicable ligne à ligne. Le détail du calcul est affiché dans
l'interface.

| Signal | Points |
|---|---|
| socle | 0,40 |
| citation recopiée à l'identique | +0,30 |
| citation retrouvée après normalisation des blancs ou de la casse | +0,15 |
| fait machine construit | +0,15 |
| aucun fait proposé, exigence non chiffrable | +0,05 |
| fait proposé mais non normalisable | +0,00 |
| article identifié et cohérent avec la section calculée | +0,10 |
| article identifié, cohérence indéterminable | +0,05 |
| article absent, ou en contradiction avec la section | +0,00 |
| page obtenue sans reprise du modèle | +0,05 |
| page ayant demandé une reprise ou plus | +0,00 |

Le maximum vaut exactement 1. Le minimum d'une exigence retenue vaut 0,40 :
en dessous, la citation serait introuvable et l'exigence aurait été rejetée
plutôt que notée.

**Le document entier n'entre jamais dans un prompt.** Un appel par page
lisible, plus une ligne de contexte calculée par le code : le titre de section
en vigueur. C'est ce qui permet de rattacher au règlement la phrase isolée de la
page 3, qui n'a ni en-tête ni grille autour d'elle.

## Décisions de conception

Trois choix demandent une explication, parce qu'ils ne vont pas de soi et qu'on
peut légitimement en attendre l'inverse.

### Le seuil de note technique reste indéterminé, il ne fait jamais basculer en no-go

L'article 6 de plusieurs avis pose qu'« une note technique inférieure à soixante
points sur les quatre-vingt-cinq points techniques est éliminatoire ». C'est bien
une condition éliminatoire, et elle est extraite comme telle.

Elle n'est pourtant jamais évaluée. La raison est qu'elle porte sur une note que
la commission attribuera à l'offre après dépôt. **C'est une propriété de l'offre
à venir, pas une propriété de l'entreprise.** Le profil ne contient aucune
information permettant de la trancher, et aucune n'existe à ce stade. Répondre
« satisfait » serait une promesse sans fondement, répondre « non satisfait »
condamnerait à tort tous les avis qui contiennent cette clause, c'est-à-dire la
plupart.

Le système la classe donc `indetermine`, avec une preuve qui dit pourquoi, et
l'affiche en tête juste après les points bloquants, comme un point à surveiller
par l'humain. C'est la seule réponse qui n'invente rien.

### Le comptage des références ne passe jamais par le nom du client

Le jeu de données contient un piège qu'il faut nommer. Dans
`profil-entreprise.json` :

| Référence | Client | Secteur déclaré |
|---|---|---|
| REF-02 | Agence Nationale de Réglementation des Télécommunications | éducation |
| REF-04 | Ministère de l'Éducation Nationale | énergie |

Un système qui jugerait le secteur d'après le nom du client se tromperait deux
fois : il écarterait REF-02, qui compte, et retiendrait REF-04, qui ne compte
pas. Un modèle de langue commettrait cette erreur spontanément, parce qu'elle est
la lecture la plus naturelle.

Le comptage des références est donc **entièrement déterministe et porte sur la
colonne `secteur`**, jamais sur le nom du client, et il n'est jamais soumis à
l'arbitrage d'un modèle. Un test unitaire dédié échoue si cette règle est un jour
contournée.

### L'année de référence est lue dans l'avis, et le système dit laquelle a servi

« Quatre références exécutées au cours des cinq dernières années » n'a de sens
que rapporté à une date. La bonne date est celle de la séance publique
d'ouverture des plis, annoncée en première page. Elle est lue par expression
régulière en TypeScript, parce que c'est une donnée du document et non une
interprétation : aucun appel au modèle ne se justifie pour cela.

Quand l'avis ne l'annonce pas, le système retombe sur l'année courante. Dans les
deux cas, le journal et l'interface affichent l'année retenue et sa provenance,
`seance_publique` ou `annee_courante`. Un comptage de références dont on ignore
la date de départ ne vaut rien.

### L'arbitrage du modèle porte sur l'équivalence, jamais sur le verdict

L'avis exige « une attestation de la Caisse Nationale de Sécurité Sociale », le
profil détient « Attestation CNSS ». Aucune comparaison de chaînes ne les
rapproche, et pourtant c'est la même pièce.

Quand la correspondance déterministe échoue, le Qualifier pose à gpt-5.5 une
question fermée : parmi ces pièces détenues, laquelle correspond à la pièce
exigée, ou aucune. Le modèle rend un indice dans une liste. **Le verdict, lui,
est produit par le code**, à partir de cet indice. Chaque évaluation porte la
trace de son origine, `deterministe`, `normalisation_gpt41` ou
`arbitrage_gpt55`, et cette origine est affichée dans l'interface.

## Le routage des modèles

Tout appel passe par `packages/shared/src/llm.ts`. Aucun autre fichier n'appelle
un service de modèle, ce qui rend le routage démontrable plutôt que déclaratif.

| Usage déclaré | Modèle | Pourquoi |
|---|---|---|
| extraction, classification, résumé, rédaction | gpt-4.1 | Volume élevé, tâche cadrée, sortie JSON contrainte. |
| orchestration, arbitrage | gpt-5.5 | Peu d'appels, décisions à plusieurs étapes, cas ambigus. |

Un agent déclare ce qu'il fait, jamais quel modèle il veut. Le choix est une
décision d'architecture, centralisée, pas une décision locale.

Le module garantit aussi ce que le service ne garantit pas. La forme de la
sortie est imposée au service par un JSON Schema en mode strict. Le contenu est
validé par zod côté application, avec deux reprises au maximum en renvoyant
l'erreur au modèle, puis statut `indetermine` et escalade. Chaque appel est mis
en cache sous l'empreinte du modèle, des prompts et du schéma.

## Ce qui est vérifié, avec des chiffres

Sur AO-2026-001, sept pages, dix-neuf exigences extraites :

| Vérification | Résultat |
|---|---|
| Citations présentes mot pour mot dans la page annoncée | 19 sur 19 |
| Page annoncée cohérente avec la page source | 19 sur 19 |
| Tests unitaires des règles déterministes | 39 sur 39 |
| Jetons consommés pour un avis complet | environ 27 000 |

Sur AO-2026-004, scan sans couche texte : zéro exigence extraite, quatre pages
déclarées non lues nommément, aucun appel au modèle.

## Limites connues

- Les scans AO-2026-004 et AO-2026-009 ne sont pas encore lus. L'OCR arrive à la
  tranche 6. En attendant, le système déclare ces pages comme non lues plutôt
  que d'en déduire quoi que ce soit. Ces deux fichiers ne contiennent par
  ailleurs que quatre des sept pages attendues.
- Le type d'une exigence, éliminatoire ou obligatoire, reste une lecture du
  modèle. C'est le moteur de règles de la tranche 4 qui décidera du caractère
  bloquant, à partir du fait machine et du profil d'entreprise.
- Le verdict go / no-go, le mémoire technique, la revue humaine et la page
  Qualité ne sont pas encore construits.
- Les scripts d'initialisation de la base ne rejouent qu'à la création du
  volume. Une évolution de schéma passe donc par `npm run reset`.

## Architecture

```
apps/api       Fastify. Dépôt des PDF, lecture des documents, pages, exigences.
apps/worker    Deux agents BullMQ : ingestor puis extractor.
apps/web       React. Zone de dépôt, matrice de conformité, vue page par page.
packages/shared  Types, schémas zod, pool Postgres, journal, llm.ts, règles pures.
db/init        Schéma SQL, rejoué à la création du volume Postgres.
```

Le code partagé est monté dans les trois services, il n'existe donc qu'une
seule définition de chaque contrat de données. L'interface n'en importe que les
types.
