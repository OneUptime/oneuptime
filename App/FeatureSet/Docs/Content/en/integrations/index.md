# Integrations

OneUptime connects to the tools your team already uses — Zabbix, Jira, PagerDuty, Slack, and many more — through **[Workflows](/docs/workflows/index)**, the built-in automation engine. There's no separate plugin to install. You wire an integration together on a drag-and-drop canvas, and it runs whenever something happens.

This page explains the two patterns every integration uses. Once you understand them, you can connect OneUptime to almost anything, even tools that don't have their own page here.

## The two patterns

Every integration moves data in one of two directions (and many use both).

### Inbound — another tool sends data into OneUptime

Use this when an external system needs to _create or update something in OneUptime_ — usually open an incident or an alert when it detects a problem.

1. Build a workflow that starts with a **[Webhook trigger](/docs/workflows/triggers#webhook)**. OneUptime gives you a unique URL.
2. In the other tool, configure a webhook / notification action that POSTs to that URL when something happens.
3. In the workflow, read the incoming payload and use a **Create Incident** (or Create Alert) component to record it.

```text
Zabbix / Prometheus / Grafana / Datadog  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

### Outbound — OneUptime sends data to another tool

Use this when _something in OneUptime should show up in another tool_ — open a Jira ticket, page someone in PagerDuty, post to Slack.

1. Build a workflow that starts with a **[OneUptime event trigger](/docs/workflows/triggers#oneuptime-event-triggers)** — for example **Incident → On Create**.
2. Add an **[API component](/docs/workflows/components#api)** that calls the other tool's REST API with the incident's details.
3. Store any API keys as **secret [global variables](/docs/workflows/variables#global-variables)** so they never appear in the workflow or its logs.

```text
OneUptime Incident → On Create  ──►  API component  ──►  Jira / PagerDuty / ServiceNow / GitHub
```

## Catalog

| Tool                                                                  | Direction            | What it does                                                                  |
| --------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------- |
| [Zabbix](/docs/integrations/zabbix)                                   | Inbound              | Turn Zabbix problems into OneUptime incidents (and resolve them on recovery). |
| [Jira](/docs/integrations/jira)                                       | Outbound (+ inbound) | Open a Jira issue for every incident; sync status back.                       |
| [PagerDuty](/docs/integrations/pagerduty)                             | Outbound (+ inbound) | Trigger and resolve PagerDuty events from OneUptime incidents.                |
| [Opsgenie](/docs/integrations/opsgenie)                               | Outbound (+ inbound) | Create and close Opsgenie alerts.                                             |
| [ServiceNow](/docs/integrations/servicenow)                           | Outbound (+ inbound) | Open ServiceNow incidents from OneUptime.                                     |
| [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) | Inbound              | Convert Alertmanager notifications into incidents.                            |
| [Grafana](/docs/integrations/grafana)                                 | Inbound              | Convert Grafana alerts into incidents.                                        |
| [Datadog](/docs/integrations/datadog)                                 | Inbound              | Convert Datadog monitor alerts into incidents.                                |
| [GitHub](/docs/integrations/github)                                   | Outbound             | Open a GitHub issue for an incident.                                          |
| [GitLab](/docs/integrations/gitlab)                                   | Outbound             | Open a GitLab issue for an incident.                                          |
| [Discord](/docs/integrations/discord)                                 | Outbound             | Post incident updates to a Discord channel.                                   |
| [Telegram](/docs/integrations/telegram)                               | Outbound             | Send incident updates to a Telegram chat.                                     |
| [Slack](/docs/workspace-connections/slack)                            | Both                 | Native workspace connection — channels, alerts, and on-call.                  |
| [Microsoft Teams](/docs/workspace-connections/microsoft-teams)        | Both                 | Native workspace connection.                                                  |

> **Slack and Microsoft Teams** have a deeper, native connection that goes beyond workflows — automatic incident channels, two-way actions, and on-call notifications. Use the [Slack](/docs/workspace-connections/slack) and [Microsoft Teams](/docs/workspace-connections/microsoft-teams) workspace connections for those rather than building a workflow.

## Handling secrets

Never paste an API key or token directly into a block. Instead:

1. Go to **Workflows → Global Variables**.
2. Create a variable — for example `JIRA_AUTH` — and turn on **Is Secret**.
3. Reference it anywhere with `{{variable.JIRA_AUTH}}`.

Secret variables are hidden in the UI after you save and are scrubbed from run logs. See [Variables](/docs/workflows/variables#global-variables).

## Authentication cheat sheet

Most outbound integrations need an `Authorization` header on the API block. The common forms:

| Scheme               | Header value                               | Used by                  |
| -------------------- | ------------------------------------------ | ------------------------ |
| Bearer token         | `Bearer {{variable.TOKEN}}`                | GitHub, many modern APIs |
| Basic auth           | `Basic {{variable.BASE64_USER_PASS}}`      | Jira, ServiceNow         |
| API key header       | `GenieKey {{variable.OPSGENIE_KEY}}`       | Opsgenie                 |
| Token in body        | `routing_key` field in the JSON body       | PagerDuty Events API     |
| Private token header | `PRIVATE-TOKEN: {{variable.GITLAB_TOKEN}}` | GitLab                   |

For Basic auth, base64-encode `username:password` (or `email:api_token`) **once**, then store the result as the secret. On macOS/Linux:

```bash
printf '%s' 'you@example.com:your_api_token' | base64
```

## Don't see your tool?

Almost any tool fits one of the two patterns above:

- If the tool can **send a webhook** when something happens, use the **inbound** pattern — point its webhook at a OneUptime Webhook trigger.
- If the tool has a **REST API**, use the **outbound** pattern — call it from an **API component**.
- If you need to reshape data between the two, drop in a **[Custom Code](/docs/workflows/components#custom-code)** block.

That covers the long tail — Zendesk, AWS CloudWatch (via SNS), New Relic, Splunk, StatusCake, and so on. The recipe is the same; only the URL and payload change.

## Where to read next

- [Workflows Overview](/docs/workflows/index) — how the automation engine works.
- [Triggers](/docs/workflows/triggers) — Webhook and OneUptime event triggers in detail.
- [Components](/docs/workflows/components) — the API, Webhook, and data components.
- [Variables](/docs/workflows/variables) — secrets and passing data between blocks.
- [Zabbix](/docs/integrations/zabbix) and [Jira](/docs/integrations/jira) — full worked examples.
