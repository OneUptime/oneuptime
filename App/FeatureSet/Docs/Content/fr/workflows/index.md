# Présentation des workflows

Les workflows vous permettent d'automatiser des tâches dans OneUptime sans écrire de code. Ajoutez quelques blocs sur un canevas, reliez-les entre eux, et vous obtenez une automatisation qui s'exécute dès que quelque chose se produit — un incident s'ouvre, une planification se déclenche, ou un autre outil envoie des données à OneUptime.

Considérez les workflows comme des assistants d'arrière-plan pour votre projet : ils réagissent aux événements, dialoguent avec d'autres outils et maintiennent les choses synchronisées en toute discrétion pendant que vous vous concentrez sur votre travail.

## Ce que vous pouvez faire avec les workflows

- **Connecter OneUptime à vos autres outils** — envoyer des incidents vers Slack, créer des tickets Jira, publier vers un webhook dans votre stack.
- **Réagir à ce qui se passe dans OneUptime** — quand un incident critique est créé, prévenir l'équipe d'astreinte et ouvrir un ticket automatiquement.
- **Exécuter des tâches selon une planification** — toutes les cinq minutes, chaque nuit, tous les lundis matin.
- **Recevoir des données depuis l'extérieur** — laisser d'autres systèmes pousser des données vers OneUptime via une URL unique.
- **Réutiliser une automatisation courante** — construisez-la une seule fois, appelez-la depuis n'importe quel autre workflow.

## Comment fonctionne un workflow

Chaque workflow comporte trois parties :

1. **Un déclencheur** — ce qui démarre le workflow. Cela peut être un bouton manuel, une planification, un webhook entrant ou un événement dans OneUptime (comme un nouvel incident).
2. **Un ou plusieurs composants** — ce que fait le workflow. Envoyer un message, effectuer un appel HTTP, lancer une vérification rapide, créer un embranchement selon une condition.
3. **Des connexions entre eux** — vous tracez des lignes d'un bloc au suivant pour décider de l'ordre.

Vous construisez tout cela visuellement sur un canevas. Aucune programmation n'est requise pour la plupart des workflows, même si vous pouvez ajouter un extrait de JavaScript lorsque vous en avez besoin.

## Termes clés

| Terme                | Signification                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Workflow**         | L'automatisation complète — un nom, un canevas et un interrupteur pour l'activer ou la désactiver.          |
| **Déclencheur**      | Le premier bloc. Il décide quand le workflow s'exécute. Chaque workflow possède exactement un déclencheur. |
| **Composant**        | Un bloc d'action — envoie un message, effectue une requête, vérifie une condition.                          |
| **Exécution**        | Une exécution du workflow. Enregistrée avec les horodatages et la sortie de chaque bloc.                    |
| **Variable globale** | Une valeur (comme une clé d'API) que vous enregistrez une seule fois et réutilisez dans n'importe quel workflow. |

## Où trouver les workflows dans OneUptime

Ouvrez **Flux de travail** dans la navigation de gauche. Cette section contient :

- **Flux de travail** — votre liste de workflows. Créez-en un nouveau ou ouvrez-en un existant.
- **Variables globales** — valeurs partagées entre tous vos workflows.
- **Exécutions & journaux** — historique des exécutions de tous les workflows de votre projet.

Ouvrez un workflow et son propre menu de gauche contient :

- **Vue d'ensemble** — nom, description, étiquettes et l'interrupteur **Activé**.
- **Constructeur** — le canevas où vous concevez le workflow.
- **Variables de flux de travail** — valeurs limitées à ce seul workflow.
- **Exécutions & journaux** — chaque exécution de ce workflow, avec ses détails.
- **Paramètres** — secret du webhook, duplication et export.

## Construire votre premier workflow

1. **Créer** — choisissez un point de départ, puis donnez un nom à votre workflow.
2. **Choisir un déclencheur** — manuel, planifié, webhook ou un événement OneUptime.
3. **Ajouter des composants** — ajoutez des actions sur le canevas et reliez-les.
4. **Activez-le** — basculez **Activé** sur oui depuis la page **Vue d'ensemble**. Un workflow désactivé ne peut pas s'exécuter du tout, pas même à la main.
5. **Testez** — cliquez sur **Run Workflow** sur le **Constructeur** et observez le journal d'exécution.

## Un exemple rapide

Supposons que vous vouliez publier dans Slack chaque fois qu'un incident critique est créé :

1. Créez un workflow appelé « Incidents critiques vers Slack ».
2. Choisissez le déclencheur **On Create Incident**.
3. Ajoutez un bloc **If / Else**. Configurez-le pour vérifier si le titre de l'incident contient « Sev 1 ».
4. Depuis la branche **Yes**, ajoutez un bloc **Slack**. Choisissez le canal et rédigez le message.
5. Activez le workflow.

La prochaine fois que quelqu'un ouvre un incident avec « Sev 1 » dans le titre, Slack s'allume.

## Comment les workflows s'intègrent au reste de OneUptime

- Les **Moniteurs** repèrent le problème. Les **Incidents** l'enregistrent. Les **Workflows** y réagissent.
- Les **Runbooks** sont des guides étape par étape destinés aux personnes. Les workflows sont une automatisation sans surveillance. Utilisez un runbook quand un humain doit prendre des décisions ; utilisez un workflow quand les étapes sont automatiques.
- Les **connexions d'espace de travail** (Slack, Teams) sont l'endroit où les workflows envoient leurs messages.

## Où lire ensuite

- [Créer un workflow](/docs/workflows/authoring) — construire sur le canevas.
- [Déclencheurs de workflow](/docs/workflows/triggers) — les différentes façons de démarrer un workflow.
- [Composants de workflow](/docs/workflows/components) — les blocs que vous pouvez ajouter.
- [Variables de workflow](/docs/workflows/variables) — utiliser des valeurs à travers les blocs et les workflows.
- [Exécutions et journaux de workflow](/docs/workflows/runs-and-logs) — vérifier ce qui s'est passé.
- [Configuration et sécurité des workflows](/docs/workflows/configuration) — les paramètres à connaître.
