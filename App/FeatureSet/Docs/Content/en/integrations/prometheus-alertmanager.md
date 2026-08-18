# Prometheus Alertmanager Integration

Turn [Prometheus Alertmanager](https://prometheus.io/docs/alerting/latest/alertmanager/) notifications into OneUptime incidents. Prometheus evaluates your alerting rules, Alertmanager routes them, and OneUptime records and escalates them.

This integration is **inbound**, and there are two ways to build it:

| Approach                                                                             | Use it when                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[Incoming Request monitor](/docs/monitor/incoming-request-monitor)** (recommended) | You want alerts to become incidents with on-call escalation, one incident per alert, and automatic resolution on recovery. No custom logic to maintain. |
| **[Workflow](/docs/workflows/index) with a Webhook trigger**                         | You need routing logic OneUptime doesn't do natively — calling other systems, reshaping payloads, conditional branching.                                |

```text
Prometheus rule fires  ──►  Alertmanager webhook receiver  ──►  OneUptime  ──►  Incident + on-call
```

## Prerequisites

- A Prometheus + Alertmanager setup where you can edit `alertmanager.yml`.
- Alertmanager must be able to reach your OneUptime instance over HTTPS.
- A OneUptime project where you can create monitors (or workflows).

## Option 1 — Incoming Request monitor

### Step 1 — Create the monitor

1. Go to **Monitors → Create Monitor** and choose **Incoming Request**.
2. Open the monitor and click **Documentation** in the left menu. Copy the URL:

   ```
   https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
   ```

   Use your own host if self-hosted. The secret key in the path is the only credential.

### Step 2 — Point Alertmanager at it

In `alertmanager.yml`:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
```

`send_resolved: true` is required — it is what tells OneUptime an alert has recovered. Reload Alertmanager with `curl -X POST http://localhost:9093/-/reload`, or restart it.

Alertmanager sends `Content-Type: application/json`, which OneUptime needs in order to read fields out of the payload.

### Step 3 — Configure the criteria

Open the monitor's **Criteria** and edit the first criteria.

**Filter**

- **Filter Type**: `JavaScript Expression`
- **Filter Condition**: `Evaluates To True`
- **Value**: `"{{requestBody.status}}" === "firing"`

  The quotes around the placeholder are required for a string comparison. A `Request Body` / `Contains` / `"status":"firing"` filter works too if you'd rather not use an expression.

**Actions**

- Turn on _When filters match, change monitor status_ and set it to **Offline** (or Degraded).
- Turn on _When filters match, declare an incident_. Set the **Title**, **Severity**, and the **On-Call Policies** that should be paged.
- Under **Advanced Options** on that incident, turn on **Auto Resolve Incident**. Without this, recovery notifications are ignored and incidents stay open forever.

**Settings → Group incidents and alerts by a payload field**

Turn this on so one endpoint can hold several concurrent incidents — one per alert — instead of a single incident per notification.

| Field                              | Value                               |
| ---------------------------------- | ----------------------------------- |
| Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
| Field that signals recovery        | `requestBody.alerts[*].status`      |
| Value that means recovered         | `resolved`                          |
| Max incidents per request          | `100`                               |

`[*]` fans out over Alertmanager's `alerts` array, opening one incident per **distinct** extracted value. Because both paths use `[*]`, recovery is judged per alert: in a payload where one alert resolved and two are still firing, only the resolved one closes.

> **Warning:** Group by something genuinely unique per alert. Alertmanager's `fingerprint` is a hash of the alert's full label set, so it always is. A label works only if it varies **within** a notification — and any label listed in your route's `group_by` never does, because that is what defines the aggregation group. With the `group_by: ["alertname", "instance"]` above, grouping by `requestBody.alerts[*].labels.alertname` extracts the same value from every alert in the payload, so all of them collapse into a single incident. Worse, duplicate values keep only their **first** occurrence, so a payload whose first alert is `resolved` closes that incident while the rest are still firing.

### Step 4 — Write the incident title and description

The grouping key is available as a variable named after the last segment of the path, so `requestBody.alerts[*].fingerprint` gives you `{{fingerprint}}`. That is a hash, not something to show a responder — title the incident from the labels shared across the notification instead. `commonLabels` carries every label in your route's `group_by`, so with the configuration above `alertname` and `instance` are both available:

- **Title**: `{{requestBody.commonLabels.alertname}} on {{requestBody.commonLabels.instance}}`
- **Description**:

  ```
  {{requestBody.commonAnnotations.summary}}

  {{requestBody.commonAnnotations.description}}
  Severity: {{requestBody.commonLabels.severity}}
  Alertmanager: {{requestBody.externalURL}}
  ```

`commonLabels` and `commonAnnotations` hold the fields shared across the notification. A per-alert path like `requestBody.alerts[0].annotations.summary` always reads the _first_ alert in the payload, not the one this particular incident was opened for — so keep `group_by` tight if you want each incident to carry its own annotation text. A path that does not resolve is printed verbatim, braces and all, rather than left blank. See [Incident & Alert Dynamic Templating](/docs/monitor/incident-alert-templating) for the full variable list.

### Step 5 — Send the monitor back to Operational (optional)

Criteria only act when they match, so add a second criteria so the monitor doesn't stay Offline after everything clears:

- **Filter Type**: `JavaScript Expression`, **Value**: `"{{requestBody.status}}" === "resolved"`
- _Change monitor status to_ **Operational**, and declare no incident.

### Step 6 — Test it

```bash
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{
    "version": "4",
    "status": "firing",
    "commonLabels": { "alertname": "HighCPU", "severity": "critical" },
    "commonAnnotations": { "summary": "CPU above 90% for 5m" },
    "externalURL": "http://alertmanager:9093",
    "alerts": [
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-1" },
        "fingerprint": "a1b2c3d4e5f60001"
      },
      {
        "status": "firing",
        "labels": { "alertname": "HighCPU", "instance": "web-2" },
        "fingerprint": "a1b2c3d4e5f60002"
      }
    ]
  }'
```

You should get two incidents — one per `fingerprint`. Re-send with both alerts' `status` set to `resolved` and both should close.

You can also fire a real alert with `amtool`:

```bash
amtool alert add test_alert severity=warning \
  --annotation=summary="Test from Alertmanager" \
  --alertmanager.url=http://localhost:9093
```

## Option 2 — Workflow

Use this when you need logic beyond "alert becomes incident".

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
5. **Save**, then point the `webhook_configs` URL in Step 2 above at the workflow's URL instead.

For one incident per alert, add a [Custom Code](/docs/workflows/components#custom-code) block that loops over `Request Body.alerts`. With `send_resolved: true`, add a second **Conditions** branch on `status == resolved` that finds the matching incident and moves it to your resolved state with **Update Incident**.

## Dead man's switch

Neither option tells you when Prometheus itself stops working — no alerts arriving looks exactly like nothing being wrong. The usual answer is an always-firing alert routed to a monitor that expects it on a schedule. [kube-prometheus-stack](https://github.com/prometheus-community/helm-charts/tree/main/charts/kube-prometheus-stack) ships one called `Watchdog`; on a plain Prometheus, add an alerting rule with an expression that is always true (`vector(1)`).

Create a **second** Incoming Request monitor, route `Watchdog` to it on a short `repeat_interval`, and give that monitor a **Filter Type: Incoming Request** / **Filter Condition: Not Recieved In Minutes** criteria. That is the one case where a missing-request criteria belongs on an alert receiver.

This is the Step 2 configuration with the watchdog route and receiver merged in — a sub-route is matched before the parent's own receiver, so `Watchdog` goes to the second monitor and everything else still goes to the first:

```yaml
receivers:
  - name: oneuptime
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/YOUR_SECRET_KEY"
        send_resolved: true

  - name: oneuptime-watchdog
    webhook_configs:
      - url: "https://oneuptime.com/heartbeat/WATCHDOG_SECRET_KEY"

route:
  receiver: oneuptime
  group_by: ["alertname", "instance"]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    - receiver: oneuptime-watchdog
      matchers:
        - alertname = "Watchdog"
      group_wait: 0s
      group_interval: 5m
      repeat_interval: 5m
```

## Troubleshooting

- **Nothing arrives** — confirm Alertmanager can reach the URL; check its logs for delivery errors. OneUptime answers every request with an empty `200` before it validates anything, so a `200` does not confirm the payload was accepted. Check the monitor's timeline instead.
- **Incidents open but never close** — check `send_resolved: true` in Alertmanager, the recovery field and value on the criteria (the comparison is case-sensitive), and **Auto Resolve Incident** under the incident's **Advanced Options**. Two subtler causes: a payload carrying more distinct keys than **Max incidents per request** hides the ones past the cap from recovery too; and if the `resolved` notification is the one dropped by ingest coalescing (below), the incident is stranded permanently, because Alertmanager repeats firing notifications but not resolved ones. Close those by hand.
- **No incidents at all, monitor status unchanged** — the grouping path must start with the literal `requestBody.`, and only the first `[*]` in a path is a wildcard. Both mistakes fail silently.
- **Incident text shows raw `{{...}}` placeholders** — the path did not resolve, and OneUptime leaves unresolved placeholders in place rather than blanking them. Different rules set different annotations, so reference fields that actually exist for your rules (`commonAnnotations` versus per-alert `annotations`).
- **Only one incident for a payload full of alerts** — you grouped by a label that does not vary inside a notification, most often one that is also in your route's `group_by`. Group by `requestBody.alerts[*].fingerprint` instead.
- **Too many incidents** — widen `group_by` / `group_interval` so Alertmanager batches related alerts. Lowering **Max incidents per request** caps them, but it also hides the keys past the cap from recovery.
- **Some notifications appear to be skipped under heavy bursts** — same-monitor requests are coalesced at ingest so one sender cannot overwhelm a monitor, which can drop an intermediate payload when notifications arrive back to back. Increasing `group_wait` and `group_interval` spaces them out. Coalescing is controlled by the app container's `INCOMING_REQUEST_INGEST_COALESCE_ENABLED` environment variable, which defaults to on; self-hosted operators who need every payload evaluated can set it to `false` on that container.

## Where to read next

- [Incoming Request Monitor](/docs/monitor/incoming-request-monitor) — the monitor type, its criteria, and incident grouping in full.
- [Integrations Overview](/docs/integrations/index) — the inbound and outbound patterns.
- [Grafana](/docs/integrations/grafana) — same idea, Grafana alerting.
- [Webhook trigger](/docs/workflows/triggers#webhook) — how the workflow receiving URL works.
