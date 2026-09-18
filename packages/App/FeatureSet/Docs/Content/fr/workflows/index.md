# Présentation des workflows

Les workflows vous permettent d'automatiser des tâches dans OneUptime sans écrire de code. Posez quelques blocs sur un canevas, reliez-les entre eux, et vous obtenez une automatisation qui s'exécute dès que quelque chose arrive — un incident s'ouvre, une planification se déclenche, ou un autre outil envoie des données à OneUptime.

Voyez les workflows comme les petites mains de votre projet : ils réagissent aux événements, dialoguent avec vos autres outils et gardent discrètement les choses en phase pendant que vous vous concentrez sur votre travail.

## Ce que vous pouvez faire avec les workflows

- **Relier OneUptime à vos autres outils** — envoyer les incidents dans Slack, créer des tickets Jira, poster vers un webhook de votre infrastructure.
- **Réagir à ce qui se passe dans OneUptime** — à la création d'un incident critique, prévenir l'équipe d'astreinte et ouvrir un ticket automatiquement.
- **Exécuter des tâches selon une planification** — toutes les cinq minutes, chaque nuit, tous les lundis matin.
- **Recevoir des données de l'extérieur** — laisser d'autres systèmes pousser des données dans OneUptime via une URL unique.
- **Réutiliser les automatisations courantes** — construisez-la une fois, appelez-la depuis n'importe quel autre workflow.

## Comment fonctionne un workflow

Tout workflow comporte trois parties :

1. **Un déclencheur** — ce qui démarre le workflow. Ce peut être un bouton actionné à la main, une planification, un webhook entrant, ou un événement dans OneUptime (un nouvel incident, par exemple).
2. **Un ou plusieurs composants** — ce que fait le workflow. Envoyer un message, lancer un appel HTTP, faire une vérification rapide, créer un embranchement selon une condition.
3. **Les liaisons entre eux** — vous tracez des lignes d'un bloc au suivant pour décider de l'ordre.

Tout cela se construit visuellement, sur un canevas. La plupart des workflows ne demandent aucun code, même si vous pouvez glisser un morceau de JavaScript là où il en faut.

## Termes clés

| Terme                  | Ce que cela désigne                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Workflow**           | L'automatisation dans son ensemble — un nom, un canevas, et un interrupteur pour l'activer ou non.                       |
| **Déclencheur**        | Le premier bloc. Il décide quand le workflow s'exécute. Chaque workflow possède exactement un déclencheur.               |
| **Composant**          | Un bloc d'action — il envoie un message, lance une requête, vérifie une condition.                                       |
| **Exécution**          | Un passage du workflow. Enregistré avec ses horodatages et la sortie de chaque bloc.                                     |
| **Variable globale**   | Une valeur (une clé d'API, par exemple) que vous enregistrez une fois et réutilisez dans n'importe quel workflow.        |

## Où trouver les workflows dans OneUptime

Ouvrez **Flux de travail** dans la navigation de gauche. Cette section contient :

- **Flux de travail** — la liste de vos workflows. Créez-en un ou ouvrez-en un existant.
- **Variables globales** — les valeurs partagées par tous vos workflows.
- **Exécutions & journaux** — l'historique des exécutions de tous les workflows de votre projet.

Ouvrez un workflow en particulier et son propre menu de gauche contient :

- **Vue d'ensemble** — nom, description, étiquettes et interrupteur **Activé**.
- **Constructeur** — le canevas sur lequel vous le concevez.
- **Variables de flux de travail** — les valeurs limitées à ce seul workflow.
- **Exécutions & journaux** — chaque exécution de ce workflow, avec ses détails.
- **Paramètres** — secret du webhook, duplication et export.

## Construire votre premier workflow

1. **Créez-le** — choisissez un point de départ, puis donnez un nom à votre workflow.
2. **Choisissez un déclencheur** — manuel, planifié, webhook, ou un événement venu d'OneUptime.
3. **Ajoutez des composants** — posez des actions sur le canevas et reliez-les.
4. **Activez-le** — basculez **Activé** depuis la page **Vue d'ensemble**. Un workflow désactivé ne peut pas s'exécuter du tout, pas même à la main.
5. **Testez-le** — cliquez sur **Exécuter le flux de travail** dans le Constructeur et regardez le journal d'exécution.

## Un exemple rapide

Disons que vous voulez publier dans Slack chaque fois qu'un incident critique est créé :

1. Créez un workflow nommé « Incidents critiques vers Slack ».
2. Choisissez le déclencheur **On Create Incident**.
3. Ajoutez un bloc **If / Else**. Réglez-le pour vérifier si le titre de l'incident contient « Sev 1 ».
4. Depuis la branche **Oui**, ajoutez un bloc **Slack**. Choisissez le canal et rédigez le message.
5. Activez le workflow.

La prochaine fois que quelqu'un ouvrira un incident avec « Sev 1 » dans le titre, Slack s'allumera.

## Comment les workflows s'articulent avec le reste d'OneUptime

- Les **Moniteurs** repèrent le problème. Les **Incidents** le consignent. Les **Flux de travail** y réagissent.
- Les **Runbooks** sont des guides étape par étape destinés aux personnes. Les workflows sont une automatisation sans surveillance. Utilisez un runbook quand un humain doit prendre des décisions ; utilisez un workflow quand les étapes sont automatiques.
- Les **Connexions de l'espace de travail** (Slack, Teams) sont la destination des messages qu'envoient vos workflows.

## Où lire ensuite

- [Créer un workflow](/docs/workflows/authoring) — la construction sur le canevas.
- [Déclencheurs de workflow](/docs/workflows/triggers) — les différentes façons de démarrer un workflow.
- [Composants de workflow](/docs/workflows/components) — les briques que vous pouvez ajouter.
- [Variables de workflow](/docs/workflows/variables) — faire circuler des valeurs entre les blocs et entre les workflows.
- [Exécutions et journaux de workflow](/docs/workflows/runs-and-logs) — vérifier ce qui s'est passé.
- [Configuration et sécurité des workflows](/docs/workflows/configuration) — les réglages qu'il vaut mieux connaître.
