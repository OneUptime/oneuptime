# Opsgenie Integration

Create an [Opsgenie](https://www.atlassian.com/software/opsgenie) alert whenever a OneUptime incident is created, and close it when OneUptime resolves.

This integration is **outbound**: OneUptime calls the [Opsgenie Alert API](https://docs.opsgenie.com/docs/alert-api). It uses a OneUptime **[Workflow](/docs/workflows/index)** with an **Incident → On Create** trigger and an **API component**.

```text
OneUptime Incident → On Create  ──►  API component (POST /v2/alerts)  ──►  Opsgenie alert
```

## Prerequisites

- An Opsgenie **API key** from an API integration: **Settings → Integrations → Add → API**. Copy the key.
- Know your region. The default API host is `https://api.opsgenie.com`; EU accounts use `https://api.eu.opsgenie.com`.
- A OneUptime project where you can create workflows.

## Step 1 — Store the API key

1. Go to **Workflows → Global Variables → Create**.
2. Name it `OPSGENIE_KEY`, paste the API key, and turn on **Is Secret**.

## Step 2 — Build the "create alert" workflow

1. Open **Workflows → Create Workflow**, name it `Incidents → Opsgenie`, and open the **Builder**.
2. Add an **Incident** trigger set to **On Create**. Rename it `Incident`.
3. Add an **API** block connected to the trigger:

   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts` _(use `api.eu.opsgenie.com` for EU)_
   - **Headers**:

     ```text
     Authorization: GenieKey {{variable.OPSGENIE_KEY}}
     Content-Type: application/json
     ```

   - **Body**:

     ```json
     {
       "message": "{{Incident.title}}",
       "alias": "oneuptime-{{Incident._id}}",
       "description": "{{Incident.description}}",
       "priority": "P1",
       "source": "OneUptime"
     }
     ```

   The **`alias`** ties this Opsgenie alert to the OneUptime incident so you can close it later by alias. Note the Opsgenie auth scheme is the literal word `GenieKey` followed by a space and your key.

4. **Save**, enable, and create a test incident. A `202 Accepted` response in the workflow logs means Opsgenie queued the alert.

## Step 3 — Close on OneUptime resolve (recommended)

1. Create a **second** workflow named `Close Opsgenie` with an **Incident → On Update** trigger.
2. Add a **Conditions** block that checks the incident is now resolved (branch on `{{Incident.currentIncidentState.name}}`).
3. From **Yes**, add an **API** block:
   - **Method**: `POST`
   - **URL**: `https://api.opsgenie.com/v2/alerts/oneuptime-{{Incident._id}}/close?identifierType=alias`
   - **Headers**: same `Authorization: GenieKey {{variable.OPSGENIE_KEY}}`
   - **Body**: `{ "source": "OneUptime", "note": "Resolved in OneUptime" }`

Opsgenie looks up the alert by alias and closes it.

## Priority mapping (optional)

Opsgenie priorities run `P1`–`P5`. Map from OneUptime severities with **Conditions** branches on `{{Incident.incidentSeverity.name}}` before the API block.

## Troubleshooting

- **`401`/`403`** — wrong key, wrong region host, or the integration lacks alert-create permission. Confirm you're using an **API** integration key and the matching `api`/`api.eu` host.
- **Close returns `404`** — the `alias` on the close call must match the create call exactly, and `identifierType=alias` must be in the query string.
- **Nothing happens** — confirm the workflow is **Enabled**.

## Where to read next

- [Integrations Overview](/docs/integrations/index) — patterns and the auth cheat sheet.
- [PagerDuty](/docs/integrations/pagerduty) — the same idea for PagerDuty.
- [On Call](/docs/on-call/incoming-call-policy) — OneUptime's built-in escalation.
