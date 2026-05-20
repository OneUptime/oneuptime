# Triggers

A trigger is the starting node of a workflow. It has no input port — execution begins here. OneUptime supports four families of triggers; every workflow uses exactly one.

## Manual

Run a workflow on demand by clicking **Run Manually** on the workflow page. You can paste an optional JSON payload that the workflow can read as `{{Manual.JSON}}`.

Use this when you want a button that triggers a piece of automation — a one-click "rotate the on-call key" or "rebuild the search index" workflow that doesn't need a recurring schedule or an event to fire it.

**Arguments**: none.

**Return values**:

| Name | Type | Description |
| --- | --- | --- |
| `JSON` | JSON | The JSON payload supplied at run time, or an empty object. |

## Schedule

Run a workflow on a cron schedule. Configure the cadence with a standard cron expression.

Use this for recurring jobs: nightly cleanup, hourly sync, weekly export.

**Arguments**:

| Name | Type | Description |
| --- | --- | --- |
| `Schedule at` | CronTab | Standard 5-field cron expression. For example, `0 * * * *` runs at the top of every hour, `*/5 * * * *` every five minutes. |

**Return values**:

| Name | Type | Description |
| --- | --- | --- |
| `executedAt` | Date | The scheduled run time. |

Scheduled workflows run on the Workflow Worker in the project's region. If the worker is briefly unavailable, the run is dispatched when it recovers — you do not need to guard against missed ticks for short outages.

## Webhook

Expose a unique HTTPS URL that an external system `POST`s to. The request headers, query parameters, and body are exposed as return values for downstream components to read.

Use this to receive data *into* OneUptime from a third-party system: CI/CD callbacks, alerts from another monitoring tool, customer signups in your CRM.

**Arguments**: none. The URL is allocated automatically when the workflow is saved and shown on the trigger node. Treat it like a secret — anyone with the URL can trigger the workflow.

**Return values**:

| Name | Type | Description |
| --- | --- | --- |
| `Request Headers` | JSON | All headers from the incoming HTTP request. |
| `Request Query Params` | JSON | Parsed query string. |
| `Request Body` | JSON | Parsed request body. If the body is not valid JSON, it arrives as a string under the `raw` key. |

The webhook accepts `GET` and `POST`. The response to the caller is a `200 OK` with a JSON acknowledgment as soon as the run is enqueued — the workflow itself runs asynchronously, so do not expect to read the result of downstream components in the HTTP response.

## Model event triggers

Almost every OneUptime entity — monitors, incidents, alerts, scheduled maintenance events, status pages, on-call policies, teams, telemetry services, and many more — exposes three triggers:

- **On Create** — fires when a new record of this type is created.
- **On Update** — fires when an existing record is changed. The trigger exposes both the old and new values.
- **On Delete** — fires when a record is deleted.

This is how you build "when X happens in OneUptime, do Y" automation without polling.

The model itself is exposed as a return value with the same field names you see on the resource. For example, the **Incident → On Create** trigger returns the full `Incident` object so that downstream nodes can read `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}`, etc.

**Arguments**: typically none for create/delete. Update triggers may let you narrow the fields you want to react to, so you don't fire on cosmetic changes.

**Return values** (varies by model):

| Name | Type | Description |
| --- | --- | --- |
| Model fields | (varies) | Every column on the entity — name, status, timestamps, foreign keys. |
| `previous` (Update only) | JSON | The record as it was before the change. |

### Common model triggers

A non-exhaustive list of the model events teams reach for most:

- **Incident** — `On Create`, `On Update` (use to react to state changes like Acknowledged or Resolved), `On Delete`.
- **Alert** — same three events on the alert model.
- **Monitor** — react when a monitor is added, edited, or removed; combine with conditions to act only on production monitors.
- **Scheduled Maintenance** — automate downstream announcements when a maintenance window is created or its state changes.
- **Status Page Subscriber** — fire a welcome flow when someone subscribes.
- **On-Call Duty Policy** — sync schedule changes to an external roster.

If the model is exposed in the OneUptime API, it can almost certainly trigger a workflow — search the trigger palette by entity name.

## Picking the right trigger

| If you want to… | Use |
| --- | --- |
| Build a button on a workflow that someone clicks | **Manual** |
| Run a job every N minutes/hours/days | **Schedule** |
| Have an external system push data into OneUptime | **Webhook** |
| React to something that happens *inside* OneUptime | **Model event** |

Workflows can only have one trigger. If you need two different start signals to share most of the same logic, factor the shared steps into one workflow and call it from two thin "wrapper" workflows using the **Execute Workflow** component (see [Components](/docs/workflows/components)).

## Where to read next

- [Components](/docs/workflows/components) — the actions you wire after the trigger.
- [Variables](/docs/workflows/variables) — how to read trigger return values from downstream nodes.
- [Runs & Logs](/docs/workflows/runs-and-logs) — how to confirm your trigger is firing.
