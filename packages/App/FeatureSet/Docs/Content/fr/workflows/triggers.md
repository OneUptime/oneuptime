# Déclencheurs

Un déclencheur est le premier bloc d'un workflow — c'est lui qui décide quand le workflow s'exécute. Chaque workflow possède exactement un déclencheur. Vous choisissez parmi quatre familles.

## Manual

Exécutez le workflow à la demande en cliquant sur **Exécuter le flux de travail** sur la page **Constructeur**, en remplissant les champs du déclencheur, puis en confirmant avec **Run Workflow Manually**. Le déclencheur Manual accepte une charge utile JSON que le reste du workflow peut lire.

Pratique pour : les automatisations en un clic auxquelles vous voulez un bouton, du genre « faire tourner cette clé » ou « envoyer une alerte de test ».

**Sortie** : le JSON que vous avez collé, ou un objet vide si vous n'en avez pas mis.

## Schedule

Exécutez le workflow selon une planification répétée, décrite par une expression cron.

Pratique pour : le ménage nocturne, une synchronisation toutes les heures, un rapport hebdomadaire.

**Réglage** : une expression cron. Quelques classiques :

- `0 * * * *` — toutes les heures, à l'heure pile.
- `*/5 * * * *` — toutes les 5 minutes.
- `0 9 * * 1` — tous les lundis à 9 h 00.

Si le système est brièvement indisponible, l'exécution est reprise dès qu'il se rétablit — inutile de vous soucier des battements manqués lors d'une courte panne.

## Webhook

OneUptime crée une URL unique. Tout ce qui frappe cette URL démarre le workflow. Les en-têtes, les paramètres de requête et le corps de l'appel sont transmis.

Pratique pour : faire entrer des données dans OneUptime depuis un autre outil — retours de CI/CD, alertes venues d'une autre supervision, inscriptions dans votre CRM.

**Sortie** :

- **Request Headers** — tous les en-têtes de la requête entrante.
- **Request Query Params** — la chaîne de requête analysée.
- **Request Body** — le corps analysé (ou le texte brut s'il n'est pas en JSON).

L'URL accepte aussi bien `GET` que `POST`. L'appelant reçoit un accusé de réception immédiat — le workflow, lui, tourne en arrière-plan.

Traitez cette URL comme un mot de passe. Quiconque la possède peut démarrer votre workflow.

## Déclencheurs d'événements OneUptime

À peu près tout ce qui existe dans OneUptime — moniteurs, incidents, alertes, maintenances planifiées, pages de statut, politiques d'astreinte, équipes — peut déclencher un workflow. Chacun propose trois événements :

- **On Create** — se déclenche quand un nouvel élément est ajouté.
- **On Update** — se déclenche quand un élément est modifié.
- **On Delete** — se déclenche quand un élément est supprimé.

C'est ainsi que vous construisez « quand X se produit dans OneUptime, fais Y » sans avoir à surveiller quoi que ce soit en boucle.

L'enregistrement complet est transmis au bloc suivant. Par exemple, le déclencheur **Incident → On Create** transmet le nouvel incident, si bien que le bloc suivant peut en lire le titre, la description, la sévérité et n'importe quel autre champ.

### Les événements les plus utilisés

- **Incident** — réagir à l'ouverture, à la mise à jour (prise en charge, résolution) ou à la suppression d'un incident.
- **Alerte** — les trois mêmes, pour les alertes.
- **Moniteur** — réagir à l'ajout, à la modification ou au retrait d'un moniteur.
- **Maintenance planifiée** — annoncer automatiquement une fenêtre de maintenance dès qu'elle est planifiée.
- **Page de statut Abonné** — souhaiter la bienvenue à quelqu'un qui s'abonne à une page de statut.
- **Politique d'astreinte** — répercuter les changements de planning vers un autre système de roulement.

Cherchez par son nom dans le panneau **Add Trigger** pour trouver celui qu'il vous faut.

## Quel déclencheur choisir ?

| Ce que vous voulez faire…              | Choisissez             |
| -------------------------------------- | ---------------------- |
| Cliquer sur un bouton pour l'exécuter  | **Manual**             |
| Tourner selon une planification répétée | **Schedule**          |
| Laisser un autre système pousser des données | **Webhook**       |
| Réagir à quelque chose dans OneUptime  | **Événement OneUptime** |

Un workflow ne peut avoir qu'un seul déclencheur. Si vous avez besoin de deux façons de lancer la même automatisation, mettez la logique commune dans un workflow et appelez-le depuis deux workflows « enveloppes » minimalistes, à l'aide du composant **Execute Workflow**.

## Où lire ensuite

- [Composants de workflow](/docs/workflows/components) — les actions que vous ajoutez après le déclencheur.
- [Variables de workflow](/docs/workflows/variables) — lire la sortie du déclencheur depuis les blocs suivants.
- [Exécutions et journaux de workflow](/docs/workflows/runs-and-logs) — vérifier que votre déclencheur s'est bien activé.
