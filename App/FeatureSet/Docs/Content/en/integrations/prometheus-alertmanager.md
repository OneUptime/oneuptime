# Prometheus Alertmanager Integration

Turn [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) notifications into OneUptime incidents. Prometheus evaluates your alerting rules, Alertmanager routes them, and OneUptime records and escalates them.

This integration is **inbound**: Alertmanager POSTs to a OneUptime **[Workflow](/docs/workflows/index)** that starts with a **Webhook trigger**.

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime Webhook trigger  ──►  Create Incident
```

## Prerequisites

- A Prometheus + Alertmanager setup where you can edit `alertmanager.yml`.
- Alertmanager must be able to reach your OneUptime instance over HTTPS.
- A OneUptime project where you can create workflows.

## Step 1 — Build the OneUptime workflow

1. Open **Workflows → Create Workflow**, name it `Alertmanager → Incidents`, and open the **Builder**.
2. Add a **Webhook** trigger and **copy its URL**. Rename the block to `Alertmanager`.
3. Add a **Conditions** block connected to the trigger:
   - **Left**: `{{Alertmanager.Request Body.status}}`
   - **Operator**: `==`
   - **Right**: `firing`
4. From **Yes**, add a **Create Incident** block:
   - **Title**: `{{Alertmanager.Request Body.commonAnnotations.summary}}`
   - **Description**: `{{Alertmanager.Request Body.commonAnnotations.description}}\nAlert: {{Alertmanager.Request Body.commonLabels.alertname}}`
   - **Severity**: choose one (or branch on `{{Alertmanager.Request Body.commonLabels.severity}}` first).
5. **Save** (leave disabled until tested).

> **About grouped alerts.** Alertmanager groups alerts and sends an `alerts` **array**. The `commonLabels` and `commonAnnotations` above are the fields shared across the group — perfect for one incident per notification. If you want **one incident per alert**, add a [Custom Code](/docs/workflows/components#custom-code) block that loops over `Request Body.alerts` and creates an incident for each. Tune grouping with `group_by` in your route.

## Step 2 — Configure Alertmanager

Add a webhook receiver pointing at the workflow URL, and route alerts to it. In `alertmanager.yml`:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://<your-workflow-webhook-url>"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 3h
```

Reload Alertmanager (`curl -X POST http://localhost:9093/-/reload` or restart it).

## Step 3 — Test it

1. Enable the workflow.
2. Fire a test alert — for example, with `amtool`:

   ```bash
   amtool alert add test_alert severity=warning --annotation=summary="Test from Alertmanager" --alertmanager.url=http://localhost:9093
   ```

3. Check the workflow's **Logs** tab and your **Incidents** list.

## Resolving on recovery (optional)

With `send_resolved: true`, Alertmanager also POSTs when an alert clears, this time with `status: resolved`. Add a second **Conditions** branch (`status == resolved`), find the matching incident (match on `commonLabels.alertname`), and move it to your resolved state with **Update Incident**.

## Troubleshooting

- **No run appears** — confirm Alertmanager can reach the URL (check its logs for delivery errors) and that the workflow is **Enabled**.
- **Incident fields are empty** — different rules set different annotations. Inspect the trigger output in the **Logs** tab and reference fields that actually exist (`commonAnnotations` vs per-alert `annotations`).
- **Too many incidents** — increase `group_by`/`group_interval` so Alertmanager batches related alerts.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — the inbound pattern.
- [Grafana](/docs/integrations/grafana) — same idea, Grafana alerting.
- [Webhook trigger](/docs/workflows/triggers#webhook) — how the receiving URL works.
