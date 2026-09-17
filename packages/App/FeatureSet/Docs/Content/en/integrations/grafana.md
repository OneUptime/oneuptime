# Grafana Integration

Turn [Grafana](https://grafana.com) alerts into OneUptime incidents. Grafana evaluates the alert rules on your dashboards; OneUptime records, escalates, and tracks them.

This integration is **inbound**: a Grafana **Webhook contact point** posts to OneUptime. There are two ways to receive it.

| Approach                                                                             | Use it when                                                                                                                |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **[Incoming Request monitor](/docs/monitor/incoming-request-monitor)** (recommended) | You want alerts to become incidents with on-call escalation, one incident per alert, and automatic resolution on recovery. |
| **[Workflow](/docs/workflows/index) with a Webhook trigger**                         | You need routing logic OneUptime doesn't do natively — calling other systems, reshaping payloads, conditional branching.   |

```text
Grafana alert rule fires  ──►  Webhook contact point  ──►  OneUptime  ──►  Incident + on-call
```

Grafana's webhook payload follows the Alertmanager shape — `status`, an `alerts` array, `commonLabels`, and `commonAnnotations`, plus convenient top-level `title` and `message` fields.

## Prerequisites

- Grafana 9+ with [unified alerting](https://grafana.com/docs/grafana/latest/alerting/) enabled (the default on modern Grafana).
- Grafana must be able to reach your OneUptime instance over HTTPS.
- A OneUptime project where you can create monitors (or workflows).

## Option 1 — Incoming Request monitor

1. Go to **Monitors → Create Monitor** and choose **Incoming Request**. Open it and click **Documentation** in the left menu to copy the URL.
2. Open the monitor's **Criteria** and set **Filter Type** to `JavaScript Expression` and **Value** to `"{{requestBody.status}}" === "firing"`.
3. Declare an incident on match, choose the **On-Call Policies** to page, and turn on **Auto Resolve Incident** under **Advanced Options**.
4. Under **Settings**, turn on **Group incidents and alerts by a payload field** and set:

   | Field                              | Value                               |
   | ---------------------------------- | ----------------------------------- |
   | Open a separate incident for each… | `requestBody.alerts[*].fingerprint` |
   | Field that signals recovery        | `requestBody.alerts[*].status`      |
   | Value that means recovered         | `resolved`                          |

5. Title the incident `{{requestBody.commonLabels.alertname}}` and describe it with `{{requestBody.message}}` or `{{requestBody.commonAnnotations.summary}}`. (`{{fingerprint}}` holds the grouping key itself, but it is a hash — not something to show a responder.)
6. Point the Grafana contact point at the monitor's URL (see the contact point steps below).

Each **distinct** grouping value becomes its own incident, and each clears when Grafana reports it resolved. Grafana's per-alert `fingerprint` is unique to an alert's label set, which is why it is the grouping path above. The [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) page walks through the same setup in more detail — the payload shape is the same, so every step there applies here.

> **Warning:** Do not group by a label that is constant across a notification. Grafana's default notification policy groups by `grafana_folder` and `alertname`, so every alert in one webhook shares an alertname — grouping by `requestBody.alerts[*].labels.alertname` would collapse the whole payload into a single incident. The grouping paths must also start with the literal `requestBody.`, and only the first `[*]` in a path is a wildcard. All of these fail silently.

## Option 2 — Workflow

Use this when you need logic beyond "alert becomes incident".

### Step 1 — Build the OneUptime workflow

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

## Configure the Grafana contact point

1. In Grafana, go to **Alerting → Contact points → Add contact point**.
2. **Name**: `OneUptime`. **Integration**: **Webhook**.
3. **URL**: paste the monitor URL from Option 1, or the workflow's webhook URL from Option 2. **HTTP Method**: `POST`.
4. Save the contact point.
5. Go to **Alerting → Notification policies** and route the alerts you want (or the default policy) to the **OneUptime** contact point.

## Test it

1. Enable the workflow, if you built one.
2. In the contact point screen, use **Test** to send a sample notification, or let a real alert rule fire.
3. Check your **Incidents** list — and the workflow's **Logs** tab if you used Option 2.

## Resolving on recovery

When the alert clears, Grafana sends another notification with `status: resolved`.

With **Option 1**, the recovery field and value configured above close the matching incident automatically — provided **Auto Resolve Incident** is on.

With **Option 2**, add a second **Conditions** branch (`status == resolved`), find the matching incident, and move it to your resolved state with **Update Incident**.

## Notes

- **Legacy alerting (Grafana 8 and earlier)** sends a different payload (`ruleName`, `state`, `evalMatches`). If you're on legacy alerting, reference `{{Grafana.Request Body.ruleName}}` and `{{Grafana.Request Body.state}}` instead, and branch on `state == alerting`.
- You can also skip Grafana's alerting entirely and have OneUptime monitor the same metrics directly — see the [Metrics Monitor](/docs/monitor/metrics-monitor).

## Troubleshooting

- **Nothing arrives** — confirm Grafana can reach the URL (check Grafana's server logs) and, for Option 2, that the workflow is **Enabled**. OneUptime answers every incoming request with an empty `200` before validating it, so a `200` in Grafana's logs does not confirm the payload was accepted.
- **Incidents open but never close** — check the recovery field and value on the criteria, and that **Auto Resolve Incident** is on under the incident's **Advanced Options**. The comparison is case-sensitive.
- **Only one incident for a payload full of alerts** — you grouped by a label that does not vary inside a notification. Group by `requestBody.alerts[*].fingerprint` instead.
- **Incident text shows raw `{{...}}` placeholders** — the path did not resolve, and unresolved placeholders are left in place rather than blanked. Reference fields that exist for your alerting version; inspect the trigger output in the **Logs** tab if you used Option 2.

## Where to read next

- [Incoming Request Monitor](/docs/monitor/incoming-request-monitor) — the monitor type, its criteria, and incident grouping in full.
- [Integrations Overview](/docs/integrations/index) — the inbound pattern.
- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — closely related payload.
- [Metrics Monitor](/docs/monitor/metrics-monitor) — monitor metrics in OneUptime directly.
