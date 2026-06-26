# Intégrations

OneUptime se connecte aux outils déjà utilisés par votre équipe — Zabbix, Jira, PagerDuty, Slack, et bien d'autres — via **[Workflows](/docs/workflows/index)**, le moteur d'automatisation intégré. Aucun plugin séparé à installer. Vous configurez une intégration sur un canevas glisser-déposer, et elle s'exécute dès que quelque chose se produit.

Cette page explique les deux schémas utilisés par chaque intégration. Une fois que vous les comprenez, vous pouvez connecter OneUptime à presque n'importe quoi, même des outils qui n'ont pas leur propre page ici.

## Les deux schémas

Chaque intégration fait circuler des données dans l'une des deux directions (et beaucoup utilisent les deux).

### Entrant — un autre outil envoie des données dans OneUptime

Utilisez ceci lorsqu'un système externe doit _créer ou mettre à jour quelque chose dans OneUptime_ — généralement ouvrir un incident ou une alerte lorsqu'il détecte un problème.

1. Créez un workflow qui commence par un **[déclencheur Webhook](/docs/workflows/triggers#webhook)**. OneUptime vous donne une URL unique.
2. Dans l'autre outil, configurez une action webhook / notification qui POSTs vers cette URL lorsque quelque chose se produit.
3. Dans le workflow, lisez la charge utile entrante et utilisez un composant **Create Incident** (ou Create Alert) pour l'enregistrer.

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

### Sortant — OneUptime envoie des données vers un autre outil

Utilisez ceci lorsque _quelque chose dans OneUptime doit apparaître dans un autre outil_ — ouvrir un ticket Jira, alerter quelqu'un dans PagerDuty, publier dans Slack.

1. Créez un workflow qui commence par un **[déclencheur d'événement OneUptime](/docs/workflows/triggers#oneuptime-event-triggers)** — par exemple **Incident → On Create**.
2. Ajoutez un **[composant API](/docs/workflows/components#api)** qui appelle l'API REST de l'autre outil avec les détails de l'incident.
3. Stockez toutes les clés d'API en tant que **[variables globales](/docs/workflows/variables#global-variables)** secrètes pour qu'elles n'apparaissent jamais dans le workflow ni dans ses journaux.

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## Catalogue

| Outil                                                                 | Direction           | Ce qu'il fait                                                                           |
| --------------------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| [Zabbix](/docs/integrations/zabbix)                                   | Entrant             | Transformer les problèmes Zabbix en incidents OneUptime (et les résoudre à la reprise). |
| [Jira](/docs/integrations/jira)                                       | Sortant (+ entrant) | Ouvrir un ticket Jira pour chaque incident ; synchroniser l'état en retour.             |
| [PagerDuty](/docs/integrations/pagerduty)                             | Sortant (+ entrant) | Déclencher et résoudre des événements PagerDuty depuis les incidents OneUptime.         |
| [Opsgenie](/docs/integrations/opsgenie)                               | Sortant (+ entrant) | Créer et fermer des alertes Opsgenie.                                                   |
| [ServiceNow](/docs/integrations/servicenow)                           | Sortant (+ entrant) | Ouvrir des incidents ServiceNow depuis OneUptime.                                       |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | Entrant             | Convertir les notifications Alertmanager en incidents.                                  |
| [Grafana](/docs/integrations/grafana)                                 | Entrant             | Convertir les alertes Grafana en incidents.                                             |
| [Datadog](/docs/integrations/datadog)                                 | Entrant             | Convertir les alertes de monitor Datadog en incidents.                                  |
| [GitHub](/docs/integrations/github)                                   | Sortant             | Ouvrir un ticket GitHub pour un incident.                                               |
| [GitLab](/docs/integrations/gitlab)                                   | Sortant             | Ouvrir un ticket GitLab pour un incident.                                               |
| [Discord](/docs/integrations/discord)                                 | Sortant             | Publier les mises à jour d'incidents dans un canal Discord.                             |
| [Telegram](/docs/integrations/telegram)                               | Sortant             | Envoyer les mises à jour d'incidents vers un chat Telegram.                             |
| [Slack](/docs/workspace-connections/slack)                            | Les deux            | Connexion d'espace de travail native — canaux, alertes et astreintes.                   |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams)        | Les deux            | Connexion d'espace de travail native.                                                   |

> **Slack et Microsoft Teams** disposent d'une connexion native plus approfondie qui va au-delà des workflows — canaux d'incident automatiques, actions bidirectionnelles et notifications d'astreinte. Utilisez les connexions d'espace de travail [Slack](/docs/workspace-connections/slack) et [Microsoft Teams](/docs/workspace-connections/microsoft-teams) pour cela plutôt que de créer un workflow.

## Gestion des secrets

Ne collez jamais une clé d'API ou un jeton directement dans un bloc. À la place :

1. Allez dans **Workflows → Global Variables**.
2. Créez une variable — par exemple `JIRA_AUTH` — et activez **Is Secret**.
3. Référencez-la partout avec `{{variable.JIRA_AUTH}}`.

Les variables secrètes sont masquées dans l'interface après l'enregistrement et supprimées des journaux d'exécution. Voir [Variables](/docs/workflows/variables#global-variables).

## Aide-mémoire d'authentification

La plupart des intégrations sortantes nécessitent un en-tête `Authorization` sur le bloc API. Les formes courantes :

| Schéma                 | Valeur de l'en-tête                        | Utilisé par                     |
| ---------------------- | ------------------------------------------ | ------------------------------- |
| Bearer token           | `Bearer {{variable.TOKEN}}`                | GitHub, nombreuses API modernes |
| Basic auth             | `Basic {{variable.BASE64_USER_PASS}}`      | Jira, ServiceNow                |
| En-tête de clé API     | `GenieKey {{variable.OPSGENIE_KEY}}`       | Opsgenie                        |
| Token dans le corps    | champ `routing_key` dans le corps JSON     | PagerDuty Events API            |
| En-tête de token privé | `PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}` | GitLab                          |

Pour Basic auth, encodez en base64 `username:password` (ou `email:api_token`) **une seule fois**, puis stockez le résultat en tant que secret. Sur macOS/Linux :

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## Votre outil n'est pas dans la liste ?

Presque tout outil correspond à l'un des deux schémas ci-dessus :

- Si l'outil peut **envoyer un webhook** lorsque quelque chose se produit, utilisez le schéma **entrant** — pointez son webhook vers un déclencheur Webhook OneUptime.
- Si l'outil dispose d'une **API REST**, utilisez le schéma **sortant** — appelez-la depuis un **composant API**.
- Si vous avez besoin de remodeler les données entre les deux, ajoutez un bloc **[Custom Code](/docs/workflows/components#custom-code)**.

Cela couvre la longue traîne — Zendesk, AWS CloudWatch (via SNS), New Relic, Splunk, StatusCake, et ainsi de suite. La recette est la même ; seuls l'URL et la charge utile changent.

## Pour aller plus loin

- [Présentation des workflows](/docs/workflows/index) — comment fonctionne le moteur d'automatisation.
- [Déclencheurs](/docs/workflows/triggers) — les déclencheurs Webhook et événements OneUptime en détail.
- [Composants](/docs/workflows/components) — les composants API, Webhook et de données.
- [Variables](/docs/workflows/variables) — les secrets et la transmission de données entre blocs.
- [Zabbix](/docs/integrations/zabbix) et [Jira](/docs/integrations/jira) — des exemples complets et concrets.
