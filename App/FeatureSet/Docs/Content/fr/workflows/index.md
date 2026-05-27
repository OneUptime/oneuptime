# Présentation des workflows

Les workflows vous permettent d'automatiser des tâches dans OneUptime sans écrire de code. Glissez et déposez quelques blocs sur un canevas, reliez-les entre eux, et vous obtenez une automatisation qui s'exécute dès qu'un événement se produit — un incident s'ouvre, une planification se déclenche ou un autre outil envoie des données à OneUptime.

Considérez les workflows comme des assistants d'arrière-plan pour votre projet : ils réagissent aux événements, dialoguent avec d'autres outils et maintiennent les choses synchronisées en toute discrétion pendant que vous vous concentrez sur votre travail.

## Ce que vous pouvez faire avec les workflows

- **Connecter OneUptime à vos autres outils** — envoyer des incidents vers Slack, créer des tickets Jira, publier vers un webhook dans votre stack.
- **Réagir à ce qui se passe dans OneUptime** — quand un incident critique est créé, prévenir l'équipe d'astreinte et ouvrir un ticket automatiquement.
- **Exécuter des tâches selon une planification** — toutes les cinq minutes, chaque nuit, tous les lundis matin.
- **Recevoir des données depuis l'extérieur** — laisser d'autres systèmes pousser des données vers OneUptime via une URL unique.
- **Réutiliser des automatisations courantes** — construisez-les une seule fois, appelez-les depuis n'importe quel autre workflow.

## Comment fonctionne un workflow

Chaque workflow comporte trois parties :

1. **Un déclencheur** — ce qui démarre le workflow. Cela peut être un bouton manuel, une planification, un webhook entrant ou un événement dans OneUptime (comme un nouvel incident).
2. **Un ou plusieurs composants** — ce que fait le workflow. Envoyer un message, effectuer un appel HTTP, lancer une vérification rapide, créer un embranchement selon une condition.
3. **Des connexions entre eux** — vous tracez des lignes d'un bloc au suivant pour décider de l'ordre.

Vous construisez tout cela visuellement sur un canevas. Aucune programmation n'est requise pour la plupart des workflows, même si vous pouvez insérer un extrait de JavaScript lorsque vous en avez besoin.

## Termes clés

| Terme | Signification |
| --- | --- |
| **Workflow** | L'automatisation complète — un nom, un canevas et un interrupteur pour l'activer ou la désactiver. |
| **Déclencheur** | Le premier bloc. Il décide quand le workflow s'exécute. Chaque workflow possède exactement un déclencheur. |
| **Composant** | Un bloc d'action — envoie un message, effectue une requête, vérifie une condition. |
| **Exécution** | Une exécution du workflow. Enregistrée avec les horodatages et la sortie de chaque bloc. |
| **Variable globale** | Une valeur (comme une clé d'API) que vous enregistrez une seule fois et réutilisez dans n'importe quel workflow. |

## Où trouver les workflows dans OneUptime

Ouvrez **Workflows** dans la navigation de gauche. À partir de là :

- **Workflows** — votre liste de workflows. Créez-en un nouveau ou ouvrez-en un existant.
- **Onglet Builder** — le canevas où vous concevez le workflow.
- **Onglet Logs** — toutes les exécutions de ce workflow, avec leurs détails.
- **Onglet Settings** — nom, description, propriétaires, étiquettes, activation/désactivation.
- **Global Variables** — valeurs partagées entre tous vos workflows.
- **Runs & Logs** — historique des exécutions de tous les workflows de votre projet.

## Construire votre premier workflow

1. **Créez** — donnez un nom et une brève description à votre workflow.
2. **Choisissez un déclencheur** — manuel, planifié, webhook ou un événement OneUptime.
3. **Ajoutez des composants** — glissez les actions sur le canevas et reliez-les.
4. **Testez** — cliquez sur **Run Manually** et observez ce qui se passe dans les journaux.
5. **Activez-le** — basculez l'interrupteur **Enabled** dans Settings lorsque vous êtes prêt.

## Un exemple rapide

Supposons que vous vouliez publier dans Slack chaque fois qu'un incident critique est créé :

1. Créez un workflow appelé « Incidents critiques vers Slack ».
2. Choisissez le déclencheur **Incident → On Create**.
3. Ajoutez un bloc **Conditions**. Configurez-le pour vérifier si le titre de l'incident contient « Sev 1 ».
4. Depuis la branche **Yes**, ajoutez un bloc **Slack**. Choisissez le canal et rédigez le message.
5. Activez le workflow.

La prochaine fois que quelqu'un ouvrira un incident avec « Sev 1 » dans le titre, Slack s'illumine.

## Comment les workflows s'intègrent au reste de OneUptime

- Les **monitors** détectent le problème. Les **incidents** l'enregistrent. Les **workflows** y réagissent.
- Les **runbooks** sont des guides pas à pas pour les humains. Les workflows sont des automatisations sans surveillance. Utilisez un runbook lorsqu'une personne doit prendre des décisions ; utilisez un workflow lorsque les étapes sont automatiques.
- Les **connexions d'espace de travail** (Slack, Teams) sont l'endroit où les workflows envoient leurs messages.

## Pour aller plus loin

- [Création d'un workflow](/docs/workflows/authoring) — la construction sur le canevas.
- [Déclencheurs](/docs/workflows/triggers) — les différentes manières de démarrer un workflow.
- [Composants](/docs/workflows/components) — les briques de base que vous pouvez ajouter.
- [Variables](/docs/workflows/variables) — l'utilisation de valeurs entre blocs et entre workflows.
- [Exécutions et journaux](/docs/workflows/runs-and-logs) — vérifier ce qui s'est passé.
- [Configuration et sécurité](/docs/workflows/configuration) — les paramètres à connaître.
