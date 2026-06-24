# Integraties

OneUptime verbindt met de tools die je team al gebruikt — Zabbix, Jira, PagerDuty, Slack en nog veel meer — via **[Workflows](/docs/workflows/index)**, de ingebouwde automatiseringsmotor. Er is geen aparte plugin nodig. Je koppelt een integratie samen op een slepen-en-neerzetten-canvas, en die draait telkens als er iets gebeurt.

Deze pagina legt de twee patronen uit die elke integratie gebruikt. Zodra je ze begrijpt, kun je OneUptime met vrijwel alles verbinden, zelfs tools die hier geen eigen pagina hebben.

## De twee patronen

Elke integratie verplaatst data in één van twee richtingen (en veel gebruiken beide).

### Inbound — een andere tool stuurt data naar OneUptime

Gebruik dit wanneer een extern systeem _iets in OneUptime moet aanmaken of bijwerken_ — doorgaans een incident of een alert openen wanneer het een probleem detecteert.

1. Bouw een workflow die start met een **[Webhook trigger](/docs/workflows/triggers#webhook)**. OneUptime geeft je een unieke URL.
2. Configureer in de andere tool een webhook- of notificatieactie die naar die URL POST wanneer er iets gebeurt.
3. Lees in de workflow de inkomende payload en gebruik een **Create Incident**-component (of Create Alert) om hem te registreren.

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

### Outbound — OneUptime stuurt data naar een andere tool

Gebruik dit wanneer _iets in OneUptime ook in een andere tool moet verschijnen_ — een Jira-ticket openen, iemand in PagerDuty pagen, posten naar Slack.

1. Bouw een workflow die start met een **[OneUptime event trigger](/docs/workflows/triggers#oneuptime-event-triggers)** — bijvoorbeeld **Incident → On Create**.
2. Voeg een **[API-component](/docs/workflows/components#api)** toe die de REST API van de andere tool aanroept met de incidentdetails.
3. Sla eventuele API-sleutels op als **geheime [globale variabelen](/docs/workflows/variables#global-variables)** zodat ze nooit in de workflow of de logs verschijnen.

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## Catalogus

| Tool                                                                  | Richting             | Wat het doet                                                                 |
| --------------------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| [Zabbix](/docs/integrations/zabbix)                                   | Inbound              | Zabbix-problemen omzetten in OneUptime-incidenten (en oplossen bij herstel). |
| [Jira](/docs/integrations/jira)                                       | Outbound (+ inbound) | Een Jira-issue openen voor elk incident; status terugkoppelen.               |
| [PagerDuty](/docs/integrations/pagerduty)                             | Outbound (+ inbound) | PagerDuty-events triggeren en oplossen vanuit OneUptime-incidenten.          |
| [Opsgenie](/docs/integrations/opsgenie)                               | Outbound (+ inbound) | Opsgenie-alerts aanmaken en sluiten.                                         |
| [ServiceNow](/docs/integrations/servicenow)                           | Outbound (+ inbound) | ServiceNow-incidenten openen vanuit OneUptime.                               |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | Inbound              | Alertmanager-notificaties omzetten in incidenten.                            |
| [Grafana](/docs/integrations/grafana)                                 | Inbound              | Grafana-alerts omzetten in incidenten.                                       |
| [Datadog](/docs/integrations/datadog)                                 | Inbound              | Datadog-monitoralerts omzetten in incidenten.                                |
| [GitHub](/docs/integrations/github)                                   | Outbound             | Een GitHub-issue openen voor een incident.                                   |
| [GitLab](/docs/integrations/gitlab)                                   | Outbound             | Een GitLab-issue openen voor een incident.                                   |
| [Discord](/docs/integrations/discord)                                 | Outbound             | Incidentupdates posten naar een Discord-kanaal.                              |
| [Telegram](/docs/integrations/telegram)                               | Outbound             | Incidentupdates sturen naar een Telegram-chat.                               |
| [Slack](/docs/workspace-connections/slack)                            | Beide                | Native workspace-verbinding — kanalen, alerts en oncall.                     |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams)        | Beide                | Native workspace-verbinding.                                                 |

> **Slack en Microsoft Teams** hebben een diepere, native verbinding die verder gaat dan workflows — automatische incidentkanalen, bidirectionele acties en oncall-notificaties. Gebruik de [Slack](/docs/workspace-connections/slack)- en [Microsoft Teams](/docs/workspace-connections/microsoft-teams)-workspace-verbindingen daarvoor in plaats van een workflow te bouwen.

## Geheimen beheren

Plak nooit een API-sleutel of token rechtstreeks in een blok. Doe in plaats daarvan:

1. Ga naar **Workflows → Global Variables**.
2. Maak een variabele aan — bijvoorbeeld `JIRA_AUTH` — en zet **Is Secret** aan.
3. Verwijs er overal naar met `{{variable.JIRA_AUTH}}`.

Geheime variabelen worden na het opslaan verborgen in de UI en worden uit de run-logs verwijderd. Zie [Variabelen](/docs/workflows/variables#global-variables).

## Authenticatie spiekbriefje

De meeste outbound-integraties hebben een `Authorization`-header op het API-blok nodig. De veelgebruikte vormen:

| Schema              | Headerwaarde                               | Gebruikt door              |
| ------------------- | ------------------------------------------ | -------------------------- |
| Bearer-token        | `Bearer {{variable.TOKEN}}`                | GitHub, veel moderne API's |
| Basic auth          | `Basic {{variable.BASE64_USER_PASS}}`      | Jira, ServiceNow           |
| API-sleutelheader   | `GenieKey {{variable.OPSGENIE_KEY}}`       | Opsgenie                   |
| Token in body       | `routing_key`-veld in de JSON-body         | PagerDuty Events API       |
| Private-tokenheader | `PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}` | GitLab                     |

Codeer voor Basic auth `gebruikersnaam:wachtwoord` (of `email:api_token`) **één keer** in base64 en sla het resultaat op als het geheim. Op macOS/Linux:

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## Tool niet gevonden?

Vrijwel elke tool past in één van de twee patronen hierboven:

- Als de tool een **webhook kan sturen** wanneer er iets gebeurt, gebruik dan het **inbound**-patroon — wijs zijn webhook naar een OneUptime Webhook trigger.
- Als de tool een **REST API** heeft, gebruik dan het **outbound**-patroon — roep hem aan vanuit een **API-component**.
- Als je data tussen beide moet omvormen, voeg dan een **[Custom Code](/docs/workflows/components#custom-code)**-blok in.

Dat dekt de lange staart — Zendesk, AWS CloudWatch (via SNS), New Relic, Splunk, StatusCake, enzovoort. Het recept is hetzelfde; alleen de URL en payload zijn anders.

## Waar verder lezen

- [Workflows – Overzicht](/docs/workflows/index) — hoe de automatiseringsmotor werkt.
- [Triggers](/docs/workflows/triggers) — Webhook- en OneUptime event-triggers in detail.
- [Componenten](/docs/workflows/components) — de API-, Webhook- en datacomponenten.
- [Variabelen](/docs/workflows/variables) — geheimen en data doorgeven tussen blokken.
- [Zabbix](/docs/integrations/zabbix) en [Jira](/docs/integrations/jira) — uitgewerkte voorbeelden.
