# Déclencheurs

Un déclencheur est le nœud de départ d'un workflow. Il n'a pas de port d'entrée — l'exécution commence ici. OneUptime prend en charge quatre familles de déclencheurs ; chaque workflow utilise exactement un.

## Manuel

Exécutez un workflow à la demande en cliquant sur **Run Manually** sur la page du workflow. Vous pouvez coller une charge utile JSON optionnelle que le workflow peut lire comme `{{Manual.JSON}}`.

Utilisez-le lorsque vous voulez un bouton qui déclenche un morceau d'automatisation — un workflow « rotation de la clé d'astreinte » ou « reconstruire l'index de recherche » en un clic qui n'a pas besoin de planification récurrente ni d'événement pour se déclencher.

**Arguments** : aucun.

**Valeurs de retour** :

| Nom | Type | Description |
| --- | --- | --- |
| `JSON` | JSON | La charge utile JSON fournie au moment de l'exécution, ou un objet vide. |

## Planifié

Exécute un workflow selon un planning cron. Configurez la cadence avec une expression cron standard.

Utilisez-le pour les tâches récurrentes : nettoyage nocturne, synchronisation horaire, export hebdomadaire.

**Arguments** :

| Nom | Type | Description |
| --- | --- | --- |
| `Schedule at` | CronTab | Expression cron standard à 5 champs. Par exemple, `0 * * * *` s'exécute en début de chaque heure, `*/5 * * * *` toutes les cinq minutes. |

**Valeurs de retour** :

| Nom | Type | Description |
| --- | --- | --- |
| `executedAt` | Date | L'heure d'exécution planifiée. |

Les workflows planifiés s'exécutent sur le Workflow Worker dans la région du projet. Si le worker est brièvement indisponible, l'exécution est dispatchée quand il récupère — vous n'avez pas besoin de vous prémunir contre les tics manqués lors de courtes pannes.

## Webhook

Exposez une URL HTTPS unique vers laquelle un système externe fait un `POST`. Les en-têtes de la requête, les paramètres de requête et le corps sont exposés comme valeurs de retour que les composants en aval peuvent lire.

Utilisez-le pour recevoir des données *dans* OneUptime depuis un système tiers : callbacks CI/CD, alertes d'un autre outil de monitoring, inscriptions de clients dans votre CRM.

**Arguments** : aucun. L'URL est attribuée automatiquement lors de l'enregistrement du workflow et affichée sur le nœud du déclencheur. Traitez-la comme un secret — quiconque possède l'URL peut déclencher le workflow.

**Valeurs de retour** :

| Nom | Type | Description |
| --- | --- | --- |
| `Request Headers` | JSON | Tous les en-têtes de la requête HTTP entrante. |
| `Request Query Params` | JSON | Chaîne de requête analysée. |
| `Request Body` | JSON | Corps de requête analysé. Si le corps n'est pas du JSON valide, il arrive sous forme de chaîne de caractères sous la clé `raw`. |

Le webhook accepte `GET` et `POST`. La réponse à l'appelant est un `200 OK` avec un accusé de réception JSON dès que l'exécution est mise en file d'attente — le workflow lui-même s'exécute de manière asynchrone, donc ne vous attendez pas à lire le résultat des composants en aval dans la réponse HTTP.

## Déclencheurs d'événements de modèle

Presque chaque entité OneUptime — monitors, incidents, alertes, événements de maintenance planifiée, status pages, politiques d'astreinte, équipes, services de télémétrie et bien d'autres — expose trois déclencheurs :

- **On Create** — se déclenche lorsqu'un nouvel enregistrement de ce type est créé.
- **On Update** — se déclenche lorsqu'un enregistrement existant est modifié. Le déclencheur expose à la fois les anciennes et les nouvelles valeurs.
- **On Delete** — se déclenche lorsqu'un enregistrement est supprimé.

C'est ainsi que vous construisez une automatisation « quand X se produit dans OneUptime, faites Y » sans polling.

Le modèle lui-même est exposé comme valeur de retour avec les mêmes noms de champs que vous voyez sur la ressource. Par exemple, le déclencheur **Incident → On Create** retourne l'objet `Incident` complet afin que les nœuds en aval puissent lire `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}`, etc.

**Arguments** : typiquement aucun pour create/delete. Les déclencheurs update peuvent vous laisser restreindre les champs auxquels vous voulez réagir, afin de ne pas vous déclencher sur des changements cosmétiques.

**Valeurs de retour** (varie selon le modèle) :

| Nom | Type | Description |
| --- | --- | --- |
| Champs du modèle | (varie) | Chaque colonne sur l'entité — nom, statut, horodatages, clés étrangères. |
| `previous` (Update uniquement) | JSON | L'enregistrement tel qu'il était avant le changement. |

### Déclencheurs de modèle courants

Une liste non exhaustive des événements de modèle vers lesquels les équipes se tournent le plus :

- **Incident** — `On Create`, `On Update` (à utiliser pour réagir aux changements d'état comme Acknowledged ou Resolved), `On Delete`.
- **Alert** — mêmes trois événements sur le modèle alert.
- **Monitor** — réagit lorsqu'un monitor est ajouté, modifié ou supprimé ; combinez avec des conditions pour n'agir que sur les monitors de production.
- **Scheduled Maintenance** — automatise les annonces en aval lorsqu'une fenêtre de maintenance est créée ou que son état change.
- **Status Page Subscriber** — déclenche un flux de bienvenue lorsque quelqu'un s'abonne.
- **On-Call Duty Policy** — synchronise les changements de planning vers un roster externe.

Si le modèle est exposé dans l'API OneUptime, il peut presque certainement déclencher un workflow — cherchez dans la palette des déclencheurs par nom d'entité.

## Choisir le bon déclencheur

| Si vous voulez… | Utilisez |
| --- | --- |
| Construire un bouton sur un workflow sur lequel quelqu'un clique | **Manuel** |
| Exécuter une tâche toutes les N minutes/heures/jours | **Planifié** |
| Faire pousser des données dans OneUptime depuis un système externe | **Webhook** |
| Réagir à quelque chose qui se produit *à l'intérieur* de OneUptime | **Événement de modèle** |

Les workflows ne peuvent avoir qu'un seul déclencheur. Si vous avez besoin de deux signaux de démarrage différents pour partager la majorité de la même logique, factorisez les étapes partagées dans un seul workflow et appelez-le depuis deux workflows « wrapper » minces en utilisant le composant **Execute Workflow** (voir [Composants](/docs/workflows/components)).

## Où lire ensuite

- [Composants](/docs/workflows/components) — les actions que vous câblez après le déclencheur.
- [Variables](/docs/workflows/variables) — comment lire les valeurs de retour du déclencheur depuis les nœuds en aval.
- [Exécutions et journaux](/docs/workflows/runs-and-logs) — comment confirmer que votre déclencheur se déclenche.
