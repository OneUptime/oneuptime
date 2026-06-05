# Datadog Integration

Turn [Datadog](https://www.datadoghq.com) monitor alerts into OneUptime incidents, so Datadog's detection feeds OneUptime's incident response and status pages.

This integration is **inbound**: Datadog's [Webhooks integration](https://docs.datadoghq.com/integrations/webhooks/) posts to a OneUptime **[Workflow](/docs/workflows/index)** that starts with a **Webhook trigger**.

```text
Datadog monitor alerts  ──►  Webhook integration  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Prerequisites

- A Datadog account where you can configure integrations and monitors.
- A OneUptime project where you can create workflows.

## Step 1 — Build the OneUptime workflow

1. Open **Workflows → Create Workflow**, name it `Datadog → Incidents`, and open the **Builder**.
2. Add a **Webhook** trigger and **copy its URL**. Rename the block to `Datadog`.
3. Add a **Conditions** block connected to the trigger:
   - **Left**: `{{Datadog.Request Body.transition}}`
   - **Operator**: `==`
   - **Right**: `Triggered`
4. From **Yes**, add a **Create Incident** block:
   - **Title**: `{{Datadog.Request Body.title}}`
   - **Description**: `{{Datadog.Request Body.body}}\nHost: {{Datadog.Request Body.host}}\n{{Datadog.Request Body.link}}`
   - **Severity**: choose one.
5. **Save** (leave disabled until tested).

## Step 2 — Create the Datadog webhook

1. In Datadog, go to **Integrations → Webhooks** (install the **Webhooks** integration if you haven't).
2. **Add a webhook**:
   - **Name**: `oneuptime` (this becomes `@webhook-oneuptime`).
   - **URL**: your workflow's webhook URL.
   - **Payload** — Datadog lets you define the JSON body using [template variables](https://docs.datadoghq.com/integrations/webhooks/#usage):

     ```json
     {
       "title": "$EVENT_TITLE",
       "body": "$TEXT_ONLY_MSG",
       "alert_type": "$ALERT_TYPE",
       "transition": "$ALERT_TRANSITION",
       "id": "$ALERT_ID",
       "host": "$HOSTNAME",
       "link": "$LINK",
       "priority": "$PRIORITY"
     }
     ```

3. Save the webhook.

## Step 3 — Send a monitor's alerts to the webhook

Add the webhook handle to the monitors you want to forward. In each monitor's **notification message**, include:

```text
{{#is_alert}}@webhook-oneuptime{{/is_alert}}
{{#is_recovery}}@webhook-oneuptime{{/is_recovery}}
```

This sends both the alert and the recovery to OneUptime. (To forward everything, you can also add `@webhook-oneuptime` to a monitor unconditionally.)

## Step 4 — Test it

1. Enable the workflow.
2. From a monitor, use **Test Notifications → Alert**, or let a real monitor trip.
3. Check the workflow's **Logs** tab and your **Incidents** list.

## Resolving on recovery (optional)

`$ALERT_TRANSITION` is `Recovered` when a monitor clears. Add a second **Conditions** branch (`transition == Recovered`), find the matching incident (match on the `id` you sent), and move it to your resolved state with **Update Incident**.

## Troubleshooting

- **No run appears** — confirm the monitor's message includes `@webhook-oneuptime` and the workflow is **Enabled**.
- **Fields are empty** — Datadog only substitutes template variables that apply to the event. Inspect the trigger output in the **Logs** tab and adjust your webhook payload.
- **Duplicate incidents** — a monitor that re-alerts (renotify) sends multiple `Triggered` events; dedupe with a **Find Incident** check on the `id` before creating.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — the inbound pattern.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) and [Grafana](/docs/integrations/grafana) — other inbound sources.
- [Webhook trigger](/docs/workflows/triggers#webhook) — how the receiving URL works.
