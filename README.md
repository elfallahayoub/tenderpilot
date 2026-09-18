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

**Une évolution de schéma impose `npm run reset`.** Les scripts de `db/init`
ne rejouent qu'à la création du volume Postgres. C'est sans conséquence
aujourd'hui, la base ne contenant aucune donnée produite par un humain. Ce ne
sera plus vrai dès que la revue humaine existera : les corrections de sections
seront alors une donnée irremplaçable, et il faudra un vrai mécanisme de
migration plutôt qu'une remise à zéro.

### Tests

```bash
npm test
```

Les tests portent sur les règles déterministes, c'est-à-dire sur le code dont
dépend la justesse des verdicts : la normalisation des nombres, la vérification
des citations, la construction des faits machine, le barème de confiance, le
moteur de règles, le caractère éliminatoire, l'année de référence, la complétude
du dossier et la détection des conditions illisibles.

## Les cinq agents

| Agent | Responsabilité | Modèle | État |
|---|---|---|---|
| Ingestor | Lit le PDF page par page, OCRise les scans, déclare ce qu'il n'a pas lu. | aucun | fait |
| Extractor | Transforme chaque page en exigences typées et sourcées. | gpt-4.1 | fait |
| Qualifier | Évalue chaque exigence contre le profil, prépare le verdict. | gpt-4.1, gpt-5.5 si ambigu | fait |
| Writer | Rédige le mémoire section par section en citant les références réelles. | gpt-4.1 | fait |
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

### Le journal de l'agent

Un panneau latéral affiche, en direct pendant le traitement puis rejouable
ensuite, chaque étape du système : l'agent qui l'a exécutée, le modèle employé,
les jetons consommés et la durée. Les étapes en code pur y figurent au même
titre que les appels au modèle, sous le libellé `code seul`.

Sur AO-2026-001, le panneau donne ceci en une ligne :

| Modèle | Volume |
|---|---|
| gpt-4.1 | 9 appels |
| gpt-5.5 | 1 appel |
| code seul | 22 étapes |

Les neuf appels à gpt-4.1 sont les sept extractions de page et deux secondes
passes de normalisation. L'unique appel à gpt-5.5 est l'arbitrage qui rapproche
« attestation de la Caisse Nationale de Sécurité Sociale » de « Attestation
CNSS ». Tout le reste est du code. C'est le routage, chiffré, sans commentaire.

Trois états se repèrent au liseré seul, sans lire : ambre pour une reprise,
rouge pour une escalade, violet pour une exigence rejetée faute de citation.

**Le journal se rejoue à l'identique.** Une colonne `sequence` donne un ordre
total d'écriture : relire le journal d'un document traité des semaines plus tôt
rend exactement la même suite, octet pour octet. L'horodatage seul ne le
garantissait pas, `now()` rendant l'heure de transaction.

`modele` et `tokens` ne sont renseignés que par le module d'appel au modèle.
Une première version laissait les agents recopier ces valeurs dans leurs étapes
de synthèse, et le récapitulatif annonçait dix-huit appels à gpt-4.1 pour sept
pages. Un chiffre faux vaut moins que pas de chiffre.

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

Huit choix demandent une explication, parce qu'ils ne vont pas de soi et qu'on
peut légitimement en attendre l'inverse. Plusieurs viennent d'une erreur
constatée en exécutant le système sur les dix avis, pas d'une intuition.

### Aucun nombre inventé, ni en chiffres ni en toutes lettres

La règle 8 du projet interdit au modèle de produire un nombre. Le Writer la
généralise à toute la chaîne : **tout nombre écrit dans le mémoire, quelle que
soit sa forme, doit se trouver dans la matière fournie à la section.** Une
fonction pure relève les nombres de la section produite et la rejette si l'un
d'eux est introuvable. La section est régénérée une fois, puis marquée « à
compléter par l'humain », avec son motif, et apparaît ainsi marquée dans le
DOCX.

La première version de ce contrôle ne regardait que les chiffres. Elle a
laissé passer deux choses sur une génération réelle, et c'est en lisant la
sortie que je les ai vues :

> « La référence REF-02 [...] exécutée en **deux mille vingt-deux** »
>
> « **Deux** de ces références sont appuyées par des attestations de bonne
> exécution. »

La première est anodine, la seconde est une affirmation chiffrée que rien ne
fondait : le décompte des attestations n'était pas dans la matière. Le modèle,
à qui l'on demandait d'écrire les dénombrements en lettres, avait trouvé là une
sortie parfaitement légale et parfaitement fausse.

Le contrôle couvre désormais les deux formes, et la consigne a changé de sens :
une valeur fournie se recopie **en chiffres**, et aucun dénombrement n'est
introduit. La vérification n'a pas été assouplie pour améliorer le résultat,
elle a été durcie parce qu'elle était trouée. La matière a été complétée en
conséquence : chaque référence indique désormais si elle porte une attestation.

### Un no-go est solide sur un document incomplet, un go ne l'est pas

C'est l'asymétrie qui gouverne tout le traitement des documents partiellement
lus, et elle mérite d'être énoncée avant le reste.

**Un no-go reste valable même si une partie du document n'a pas été lue.** Un
point bloquant trouvé est un point bloquant. Lire les pages manquantes ne
pourrait qu'en ajouter, jamais en retirer. La conclusion tient.

**Un go sur un document incomplet ne vaut rien.** Les pages absentes ou
illisibles peuvent porter précisément la condition qui bloque. Conclure « go »
reviendrait à tirer de l'absence de preuve la preuve de l'absence.

Le verdict reste donc binaire, pour que le décompte reste comparable aux six go
et quatre no-go attendus, mais il est accompagné d'une **réserve** qui n'est
jamais silencieuse. Un go assorti d'une réserve s'affiche **GO SOUS RÉSERVE**,
en ambre, avec la liste nommée de ce qui n'a pas été lu. La réserve est aussi
visible que le verdict. Sur un no-go, la réserve est affichée avec la mention
qu'elle ne l'affaiblit pas.

Quatre causes déclenchent une réserve, cumulables et toutes nommées : une
composante annoncée du dossier est absente, une énumération de conditions
présente un trou que l'OCR n'a pas su combler, une page reste illisible même
après OCR, ou la reconnaissance d'une page est sous le seuil de confiance.

Et quand **aucune** page n'est lisible, il n'y a pas de verdict du tout : le
système affiche « verdict impossible » et dit pourquoi.

### Le système nomme ce qui manque, il ne compte pas des pages

Comment savoir qu'un dossier est incomplet ? La tentation serait de comparer :
huit avis sur dix ont sept pages, donc ceux qui en ont quatre sont amputés de
trois. **Le système ne fait jamais cela.** Déduire un document d'un autre
supposerait une norme qui n'existe nulle part, et tomberait au premier avis
légitimement plus court.

Le document annonce lui-même sa composition, en première page, et cette phrase
s'OCRise proprement même sur les scans dégradés :

> Le présent dossier de consultation comprend le règlement de la consultation,
> le cahier des prescriptions spéciales, le bordereau des prix et le planning
> prévisionnel d'exécution.

Le code relève les quatre composantes annoncées, cherche l'en-tête de chacune
dans les pages, et nomme celles qui manquent. Sur AO-2026-004 et AO-2026-009 il
trouve le règlement et le cahier des prescriptions, et déclare absents **le
bordereau des prix et le planning prévisionnel**. Un test unitaire vérifie que
l'annonce ne se valide jamais elle-même, la page qui la porte contenant les
quatre libellés.

Dire ce qui manque vaut mieux que dire combien de pages manquent.

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

### Le caractère éliminatoire est établi par le code, pas par le modèle

À la première exécution sur les dix avis, le système a rendu dix go alors que
quatre no-go étaient attendus. Le moteur de règles avait pourtant correctement
détecté treize exigences non satisfaites, dont trois certifications absentes du
profil. Aucune n'était bloquante.

La cause tenait au champ `type`. Les pages 2 de AO-2026-001 et de AO-2026-002
portent la même phrase, mot pour mot : « Le non-respect d'une condition
qualifiée d'éliminatoire entraîne le rejet de l'offre sans examen au fond. » Le
modèle avait typé les conditions de la première éliminatoires, et celles de la
seconde obligatoires. Une variance de lecture sur le champ qui décide du verdict
n'est pas acceptable.

Le caractère éliminatoire est donc désormais lu dans le texte par des règles
pures et testées. Le code découpe la page en articles, cherche dans chaque bloc
les formulations par lesquelles un marché public annonce un rejet, et
requalifie les exigences de cet article. La règle ne fait que **renforcer** le
type produit par le modèle, jamais le déclasser : sur un go / no-go, se tromper
dans le sens du doute est la seule erreur acceptable.

Chaque requalification est journalisée, et le rattachement se fait page par
page, ce qui évite de confondre l'article 7 du règlement et l'article 7 du
cahier des prescriptions spéciales.

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
| indexation, recherche sémantique | embedder-small-3 | 512 dimensions, calculés une seule fois au seed. |

Un agent déclare ce qu'il fait, jamais quel modèle il veut. Le choix est une
décision d'architecture, centralisée, pas une décision locale.

**Attention au point de terminaison de l'embedder.** Il n'est pas servi par le
déploiement Azure, qui répond 404 sur `embedder-small-3`, mais par la surface v1
de `LLM_URL`, avec un jeton porteur et le modèle dans le corps de la requête.

Le module garantit aussi ce que le service ne garantit pas. La forme de la
sortie est imposée au service par un JSON Schema en mode strict. Le contenu est
validé par zod côté application, avec deux reprises au maximum en renvoyant
l'erreur au modèle, puis statut `indetermine` et escalade. Chaque appel est mis
en cache sous l'empreinte du modèle, des prompts et du schéma.

## Ce qui est vérifié, avec des chiffres

Sur les dix avis fournis :

| Vérification | Résultat |
|---|---|
| Citations présentes mot pour mot dans la page annoncée | 249 sur 249 |
| Tests unitaires des règles déterministes | 101 sur 101 |
| Verdicts rendus | 5 go, 2 go sous réserve, 3 no-go |
| Pages lues par reconnaissance optique | 8, toutes exploitables |
| Confiance maximale d'une exigence issue d'un scan | 0,60, le plafond |

**Le résultat attendu est 6 go et 4 no-go. J'obtiens 7 go, dont 2 sous réserve,
et 3 no-go. Il me manque un no-go, et je sais lequel.**

Les trois no-go reposent chacun sur une preuve vérifiable : une certification
exigée à l'article 3.4 que l'entreprise ne détient pas, ISO 22301:2019 pour
AO-2026-002, ISO 45001:2018 pour AO-2026-008 et AO-2026-010.

Or **neuf avis sur dix portent une certification lisible à ce même article 3.4.
Le dixième est AO-2026-004, et c'est précisément cette ligne que l'OCR ne rend
pas.** Le système en a extrait zéro certification, et affiche à l'écran : « des
conditions de participation n'ont pas pu être lues, page 2 : article 3,
conditions 3.2, 3.3 et 3.4 ». Il ne devine pas laquelle, il ne la fabrique pas,
et il ne prononce pas un go franc.

C'est le comportement voulu. Un système qui aurait obtenu 10 sur 10 ici aurait
inventé une certification qu'aucune image ne permet de lire.

Deux mesures confirment le diagnostic plutôt que de l'illustrer. La page 2 de
AO-2026-004 est la seule des huit pages reconnues à passer sous le seuil de
confiance, à 73,5 pour un seuil de 75. Et la source du scan est à 120 points par
pouce : rendre la page à 300, 400 ou 600 dpi laisse les mêmes lignes illisibles,
l'information n'est pas dans le fichier.

## Limites connues

- Sur AO-2026-004, la condition de certification de l'article 3.4 reste
  illisible malgré l'OCR. Le système le dit nommément au lieu de la deviner,
  mais il ne peut donc pas trancher cet avis avec certitude.
- Le résultat sur les dix avis est de 7 go, dont 2 sous réserve, et 3 no-go,
  pour 6 go et 4 no-go attendus. L'écart est analysé plus haut.
- Le mémoire technique, la revue humaine, le journal d'agent à l'écran et la
  page Qualité ne sont pas encore construits.
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
