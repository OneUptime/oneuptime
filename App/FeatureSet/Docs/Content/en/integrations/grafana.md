# Grafana Integration

Turn [Grafana](https://grafana.com) alerts into OneUptime incidents. Grafana evaluates the alert rules on your dashboards; OneUptime records, escalates, and tracks them.

This integration is **inbound**: Grafana's alerting posts to a OneUptime **[Workflow](/docs/workflows/index)** that starts with a **Webhook trigger**, using a Grafana **Webhook contact point**.

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Prerequisites

- Grafana 9+ with [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) enabled (the default on modern Grafana).
- Grafana must be able to reach your OneUptime instance over HTTPS.
- A OneUptime project where you can create workflows.

## Step 1 — Build the OneUptime workflow

1. Open **Workflows → Create Workflow**, name it `Grafana → Incidents`, and open the **Builder**.
2. Add a **Webhook** trigger and **copy its URL**. Rename the block to `Grafana`.
3. Add a **Conditions** block connected to the trigger:
   - **Left**: `{{Grafana.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. From **Yes**, add a **Create Incident** block:
   - **Title**: `{{Grafana.Request Body.title}}`
   - **Description**: `{{Grafana.Request Body.message}}`
   - **Severity**: choose one (or branch on `{{Grafana.Request Body.commonLabels.severity}}`).
5. **Save** (leave disabled until tested).

Grafana's webhook payload follows the Alertmanager shape — it includes `status`, an `alerts` array, `commonLabels`, and `commonAnnotations`, plus convenient top-level `title` and `message` fields.

## Step 2 — Configure the Grafana contact point

1. In Grafana, go to **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: paste your workflow's webhook URL. **HTTP Method**: `POST`.
4. Save the contact point.
5. Go to **Alerting → Notification policies** and route the alerts you want (or the default policy) to the **OneUptime** contact point.

## Step 3 — Test it

1. Enable the workflow.
2. In the contact point screen, use **Test** to send a sample notification, or let a real alert rule fire.
3. Check the workflow's **Logs** tab and your **Incidents** list.

## Resolving on recovery (optional)

When the alert clears, Grafana sends another notification with `status: resolved`. Add a second **Conditions** branch (`status == resolved`), find the matching incident, and move it to your resolved state with **Update Incident**.

## Notes

- **Legacy alerting (Grafana 8 and earlier)** sends a different payload (`ruleName`, `state`, `evalMatches`). If you're on legacy alerting, reference `{{Grafana.Request Body.ruleName}}` and `{{Grafana.Request Body.state}}` instead, and branch on `state == alerting`.
- You can also skip Grafana's alerting entirely and have OneUptime monitor the same metrics directly — see the [Metrics Monitor](/docs/monitor/metrics-monitor).

## Troubleshooting

- **No run appears** — confirm Grafana can reach the URL (check Grafana's server logs) and the workflow is **Enabled**.
- **Empty fields** — inspect the trigger output in the **Logs** tab; reference fields that exist for your alerting version.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — the inbound pattern.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — closely related payload.
- [Metrics Monitor](/docs/monitor/metrics-monitor) — monitor metrics in OneUptime directly.
