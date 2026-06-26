# PagerDuty Integration

Trigger a [PagerDuty](https://www.pagerduty.com) incident whenever a OneUptime incident is created, and resolve it when OneUptime resolves. Useful when PagerDuty owns your escalation and on-call schedules and you want OneUptime's monitoring to feed it.

This integration is **outbound**: OneUptime calls PagerDuty's [Events API v2](https://developer.pagerduty.com/docs/events-api-v2/overview/). It uses a OneUptime **[Workflow](/docs/workflows/index)** with an **Incident → On Create** trigger and an **API component**.

> OneUptime has its own on-call and escalation built in — see [On Call](/docs/on-call/incoming-call-policy). Use this integration only if you specifically want events to land in PagerDuty as well.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/enqueue)  ──►  PagerDuty incident
```

## Prerequisites

- A PagerDuty service with an **Events API v2** integration. In PagerDuty: **Service → Integrations → Add integration → Events API v2**. Copy the **Integration Key** (also called the _routing key_).
- A OneUptime project where you can create workflows.

## Step 1 — Store the routing key

1. Go to **Workflows → Global Variables → Create**.
2. Name it `PAGERDUTY_ROUTING_KEY`, paste the integration key, and turn on **Is Secret**.

## Step 2 — Build the "trigger" workflow

1. Open **Workflows → Create Workflow**, name it `Incidents → PagerDuty`, and open the **Builder**.
2. Add an **Incident** trigger set to **On Create**. Rename it `Incident`.
3. Add an **API** block connected to the trigger:

   - **Method**: `POST`
   - **URL**: `https://events.pagerduty.com/v2/enqueue`
   - **Headers**: `Content-Type: application/json`
   - **Body**:

     ```json
     {
       "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
       "event_action": "trigger",
       "dedup_key": "oneuptime-{{Incident._id}}",
       "payload": {
         "summary": "{{Incident.title}}",
         "source": "OneUptime",
         "severity": "critical",
         "custom_details": {
           "description": "{{Incident.description}}"
         }
       }
     }
     ```

   The **`dedup_key`** ties this PagerDuty incident to the OneUptime incident so you can resolve it later. Using the OneUptime incident id keeps it unique and predictable.

4. **Save**, enable, and create a test incident. A `202` response in the workflow logs means PagerDuty accepted the event.

## Step 3 — Resolve on OneUptime resolve (recommended)

1. In the **same** workflow, add a second **Incident** trigger? No — a workflow has one trigger. Instead create a **second** workflow named `Resolve PagerDuty` with an **Incident → On Update** trigger.
2. Add a **Conditions** block to check the incident is now resolved (branch on the incident's state/`{{Incident.currentIncidentState.name}}` equal to your resolved state name).
3. From **Yes**, add an **API** block to PagerDuty with the **same `dedup_key`** and `event_action` set to `resolve`:

   ```json
   {
     "routing_key": "{{variable.PAGERDUTY_ROUTING_KEY}}",
     "event_action": "resolve",
     "dedup_key": "oneuptime-{{Incident._id}}"
   }
   ```

PagerDuty matches the `dedup_key` and closes the original incident.

## Severity mapping (optional)

PagerDuty's `severity` accepts `critical`, `error`, `warning`, or `info`. To map from OneUptime severities, add **Conditions** branches on `{{Incident.incidentSeverity.name}}` before the API block and send a different body from each.

## Inbound (optional)

To go the other way — open a OneUptime incident from a PagerDuty event — add a **Webhook** trigger workflow and point a PagerDuty [V3 webhook](https://developer.pagerduty.com/docs/webhooks/v3-overview/) (or an Events Orchestration) at its URL, then use **Create Incident**. See the [inbound pattern](/docs/integrations/index#inbound-another-tool-sends-data-into-oneuptime).

## Troubleshooting

- **`400` with `"invalid routing key"`** — the integration must be **Events API v2**, not the older Events API v1 or a different integration type. Re-copy the key.
- **Resolve doesn't close anything** — the `dedup_key` on the resolve call must match the trigger call exactly.
- **Nothing in the logs** — confirm the workflow is **Enabled** and the trigger is **On Create**.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — patterns and the auth cheat sheet.
- [On Call](/docs/on-call/incoming-call-policy) — OneUptime's built-in escalation.
- [Opsgenie](/docs/integrations/opsgenie) — the same idea for Opsgenie.
