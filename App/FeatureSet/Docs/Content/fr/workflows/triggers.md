# Déclencheurs

Un déclencheur est le premier bloc d'un workflow — il décide quand le workflow s'exécute. Chaque workflow possède exactement un déclencheur. Vous choisissez parmi quatre types.

## Manual

Exécutez le workflow à la demande en cliquant sur **Run Manually** depuis la page du workflow. Vous pouvez coller une charge utile JSON que le reste du workflow pourra lire.

Idéal pour : les automatisations en un clic pour lesquelles vous voulez un bouton, comme « faire tourner cette clé » ou « envoyer une alerte de test ».

**Sortie** : le JSON que vous avez collé, ou un objet vide si vous n'en avez pas fourni.

## Schedule

Exécutez le workflow selon une planification récurrente à l'aide d'une expression cron.

Idéal pour : le nettoyage nocturne, la synchronisation horaire, les rapports hebdomadaires.

**Paramètre** : une expression cron. Quelques expressions courantes :

- `0 * * * *` — toutes les heures, à l'heure pile.
- `*/5 * * * *` — toutes les 5 minutes.
- `0 9 * * 1` — chaque lundi à 9 h 00.

Si le système est brièvement indisponible, l'exécution est lancée dès qu'il se rétablit — vous n'avez pas à vous soucier des occurrences manquées pour de courtes interruptions.

## Webhook

OneUptime crée une URL unique. Tout appel à cette URL démarre le workflow. Les en-têtes, les paramètres de requête et le corps de la requête sont transmis.

Idéal pour : recevoir des données dans OneUptime depuis un autre outil — rappels CI/CD, alertes provenant d'un autre outil de monitoring, inscriptions dans votre CRM.

**Sortie** :

- **Request Headers** — tous les en-têtes de la requête entrante.
- **Request Query Params** — la chaîne de requête analysée.
- **Request Body** — le corps analysé (ou le texte brut s'il n'est pas du JSON).

L'URL accepte à la fois `GET` et `POST`. L'appelant reçoit un accusé de réception rapide — le workflow lui-même s'exécute en arrière-plan.

Traitez l'URL comme un mot de passe. Toute personne qui la possède peut démarrer votre workflow.

## Déclencheurs d'événements OneUptime

Presque tout dans OneUptime — monitors, incidents, alertes, maintenances planifiées, status pages, politiques d'astreinte, équipes — peut déclencher un workflow. Chacun offre trois événements :

- **On Create** — se déclenche lorsqu'un nouvel élément est ajouté.
- **On Update** — se déclenche lorsqu'un élément est modifié.
- **On Delete** — se déclenche lorsqu'un élément est supprimé.

C'est ainsi que vous construisez « quand X se produit dans OneUptime, faire Y » sans avoir à vérifier les choses en boucle.

L'enregistrement complet est transmis au bloc suivant. Par exemple, le déclencheur **Incident → On Create** transmet le nouvel incident, ce qui permet au bloc suivant de lire son titre, sa description, sa gravité et tout autre champ.

### Événements les plus utilisés

- **Incident** — réagir lorsqu'un incident est ouvert, mis à jour (acquitté, résolu) ou supprimé.
- **Alert** — les trois mêmes événements pour les alertes.
- **Monitor** — réagir lorsqu'un monitor est ajouté, modifié ou supprimé.
- **Scheduled Maintenance** — annoncer automatiquement une fenêtre de maintenance dès qu'elle est planifiée.
- **Status Page Subscriber** — accueillir une personne qui s'abonne à une status page.
- **On-Call Duty Policy** — synchroniser les changements de planning avec un autre système de roulement.

Cherchez dans la palette des déclencheurs par nom pour trouver celui que vous voulez.

## Quel déclencheur choisir ?

| Si vous voulez… | Choisissez |
| --- | --- |
| Cliquer sur un bouton pour exécuter le workflow | **Manual** |
| Exécuter selon une planification récurrente | **Schedule** |
| Laisser un autre système pousser des données | **Webhook** |
| Réagir à quelque chose dans OneUptime | **Événement OneUptime** |

Un workflow ne peut avoir qu'un seul déclencheur. Si vous avez besoin de deux manières de démarrer la même automatisation, regroupez la logique partagée dans un workflow et appelez-le depuis deux workflows « enveloppes » légers à l'aide du composant **Execute Workflow**.

## Pour aller plus loin

- [Composants](/docs/workflows/components) — les actions que vous ajoutez après le déclencheur.
- [Variables](/docs/workflows/variables) — lire la sortie du déclencheur depuis les blocs suivants.
- [Exécutions et journaux](/docs/workflows/runs-and-logs) — confirmer que votre déclencheur s'est bien lancé.
