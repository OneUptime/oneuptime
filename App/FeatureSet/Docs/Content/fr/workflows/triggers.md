# Déclencheurs

Un déclencheur est le premier bloc d'un workflow — il décide quand le workflow s'exécute. Chaque workflow possède exactement un déclencheur. Vous choisissez parmi quatre types.

## Manual

Exécutez le workflow à la demande en cliquant sur **Run Workflow** sur la page **Builder**, en remplissant les champs du déclencheur, puis en confirmant avec **Run Workflow Manually**. Le déclencheur Manual prend en entrée une charge utile JSON que le reste du workflow peut lire.

Idéal pour : les automatisations en un clic pour lesquelles vous voulez un bouton, comme « faire tourner cette clé » ou « envoyer une alerte de test ».

**Sortie** : le JSON que vous avez collé, ou un objet vide si vous n'en avez pas fourni.

## Schedule

Exécutez le workflow selon une planification récurrente à l'aide d'une expression cron.

Idéal pour : le nettoyage nocturne, la synchronisation horaire, les rapports hebdomadaires.

**Paramètre** : une expression cron. Quelques expressions courantes :

- `0 * * * *` — toutes les heures, à l'heure pile.
- `*/5 * * * *` — toutes les 5 minutes.
- `0 9 * * 1` — chaque lundi à 9 h 00.

Si le système est brièvement indisponible, l'exécution est reprise dès qu'il se rétablit — vous n'avez pas à vous soucier des occurrences manquées pour de courtes interruptions.

## Webhook

OneUptime crée une URL unique. Tout appel à cette URL démarre le workflow. Les en-têtes, les paramètres de requête et le corps de la requête sont transmis.

Idéal pour : recevoir des données dans OneUptime depuis un autre outil — rappels CI/CD, alertes d'un autre outil de surveillance, inscriptions dans votre CRM.

**Sortie** :

- **Request Headers** — tous les en-têtes de la requête entrante.
- **Request Query Params** — la chaîne de requête analysée.
- **Request Body** — le corps analysé (ou le texte brut s'il ne s'agit pas de JSON).

L'URL accepte à la fois `GET` et `POST`. L'appelant reçoit un accusé de réception rapide — le workflow lui-même s'exécute en arrière-plan.

Traitez l'URL comme un mot de passe. Quiconque la possède peut démarrer votre workflow.

## Déclencheurs d'événements OneUptime

Presque tout ce qui existe dans OneUptime — moniteurs, incidents, alertes, maintenances planifiées, pages de statut, politiques d'astreinte, équipes — peut déclencher un workflow. Chacun propose trois événements :

- **On Create** — se déclenche quand un nouvel élément est ajouté.
- **On Update** — se déclenche quand un élément est modifié.
- **On Delete** — se déclenche quand un élément est supprimé.

C'est ainsi que vous construisez « quand X se produit dans OneUptime, fais Y » sans avoir besoin de vérifier les choses dans une boucle.

L'enregistrement complet est transmis au bloc suivant. Par exemple, le déclencheur **Incident → On Create** transmet le nouvel incident, afin que le bloc suivant puisse lire son titre, sa description, sa gravité et tout autre champ.

### Événements les plus utilisés par les équipes

- **Incident** — réagissez quand un incident est ouvert, modifié (pris en compte, résolu) ou supprimé.
- **Alert** — les trois mêmes pour les alertes.
- **Monitor** — réagissez quand un moniteur est ajouté, modifié ou supprimé.
- **Scheduled Maintenance** — annoncez automatiquement une fenêtre de maintenance dès qu'elle est planifiée.
- **Status Page Subscriber** — accueillez quelqu'un qui s'abonne à une page de statut.
- **On-Call Duty Policy** — synchronisez les changements de planning vers un autre système de rotation.

Recherchez dans le panneau **Add Trigger** par nom pour trouver celui que vous voulez.

## Quel déclencheur dois-je utiliser ?

| Si vous voulez…                                   | Choisissez                |
| -------------------------------------------------- | -------------------------- |
| Cliquer sur un bouton pour exécuter le workflow    | **Manual**                 |
| S'exécuter selon une planification récurrente      | **Schedule**                |
| Faire pousser des données par un autre système     | **Webhook**                 |
| Réagir à quelque chose à l'intérieur de OneUptime  | **événement OneUptime**    |

Un workflow ne peut avoir qu'un seul déclencheur. Si vous avez besoin de deux façons de démarrer la même automatisation, construisez la logique partagée dans un workflow et appelez-la depuis deux workflows « enveloppes » légers à l'aide du composant **Execute Workflow**.

## Où lire ensuite

- [Composants de workflow](/docs/workflows/components) — les actions que vous ajoutez après le déclencheur.
- [Variables de workflow](/docs/workflows/variables) — lire la sortie du déclencheur depuis des blocs ultérieurs.
- [Exécutions et journaux de workflow](/docs/workflows/runs-and-logs) — confirmer que votre déclencheur s'est bien déclenché.
