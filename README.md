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
des citations, et la construction des faits machine.

## Les cinq agents

| Agent | Responsabilité | Modèle | État |
|---|---|---|---|
| Ingestor | Lit le PDF page par page, déclare les pages illisibles. | aucun | fait |
| Extractor | Transforme chaque page en exigences typées et sourcées. | gpt-4.1 | fait |
| Qualifier | Normalise chaque exigence en fait vérifiable. | gpt-4.1, gpt-5.5 si ambigu | à venir |
| Writer | Rédige le mémoire en citant les références réelles. | gpt-4.1 | à venir |
| Compliance | Relit contre la checklist administrative. | gpt-4.1 | à venir |
| Orchestrator | Planifie, relance, escalade à l'humain. | gpt-5.5 | à venir |

Déposer un avis déclenche la chaîne complète. L'ingestion met l'extraction en
file dès qu'elle a terminé, et chaque étape écrit une ligne dans le journal
d'agent avec le modèle utilisé, les jetons réellement consommés et la durée.

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
tout aussi important : quand la conversion échoue, le fait vaut `null`, la
confiance est plafonnée, et l'exigence reste affichée sans forme machine. Le
système préfère dire qu'il ne sait pas.

**Aucune citation n'est crue sur parole.** Le modèle doit recopier l'extrait
littéral. Le code cherche ensuite cet extrait dans le texte de la page
réellement stocké, et enregistre la sous-chaîne d'origine, jamais celle du
modèle. Une citation introuvable est une hallucination : l'exigence est rejetée
et l'événement est journalisé sous un libellé dédié, ce qui en fait un
indicateur mesurable. Lors de la mise au point, ce garde-fou a rejeté quatre
exigences dont le modèle avait reformulé les lignes d'un tableau en phrase.

**Le document entier n'entre jamais dans un prompt.** Un appel par page
lisible, plus une ligne de contexte calculée par le code : le titre de section
en vigueur. C'est ce qui permet de rattacher au règlement la phrase isolée de la
page 3, qui n'a ni en-tête ni grille autour d'elle.

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
| Tests unitaires des règles déterministes | 31 sur 31 |
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
