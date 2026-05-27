# Triggers

A trigger is the first block in a workflow — it decides when the workflow runs. Every workflow has exactly one trigger. You pick from four kinds.

## Manual

Run the workflow on demand by clicking **Run Manually** on the workflow page. You can paste a JSON payload that the rest of the workflow can read.

Good for: one-click automations you want a button for, like "rotate this key" or "send a test alert."

**Output**: the JSON you pasted in, or an empty object if you didn't.

## Schedule

Run the workflow on a repeating schedule using a cron expression.

Good for: nightly cleanup, hourly sync, weekly reports.

**Setting**: a cron expression. A few common ones:

- `0 * * * *` — every hour, on the hour.
- `*/5 * * * *` — every 5 minutes.
- `0 9 * * 1` — every Monday at 9:00 AM.

If the system is briefly unavailable, the run is picked up as soon as it recovers — you don't need to worry about missed ticks for short outages.

## Webhook

OneUptime creates a unique URL. Anything that hits that URL starts the workflow. The headers, query parameters, and body of the request are passed in.

Good for: receiving data into OneUptime from another tool — CI/CD callbacks, alerts from other monitoring, signups in your CRM.

**Output**:

- **Request Headers** — all the headers from the incoming request.
- **Request Query Params** — the parsed query string.
- **Request Body** — the parsed body (or the raw text if it's not JSON).

The URL accepts both `GET` and `POST`. The caller gets a quick acknowledgement — the workflow itself runs in the background.

Treat the URL like a password. Anyone who has it can start your workflow.

## OneUptime event triggers

Almost every thing in OneUptime — monitors, incidents, alerts, scheduled maintenance, status pages, on-call policies, teams — can trigger a workflow. Each one offers three events:

- **On Create** — fires when a new one is added.
- **On Update** — fires when one is changed.
- **On Delete** — fires when one is deleted.

This is how you build "when X happens in OneUptime, do Y" without needing to check things in a loop.

The full record is passed to the next block. For example, the **Incident → On Create** trigger passes the new incident, so the next block can read its title, description, severity, and any other field.

### Events teams use most

- **Incident** — react when an incident is opened, updated (acknowledged, resolved), or deleted.
- **Alert** — same three for alerts.
- **Monitor** — react when a monitor is added, edited, or removed.
- **Scheduled Maintenance** — announce a maintenance window automatically when it's scheduled.
- **Status Page Subscriber** — welcome someone who subscribes to a status page.
- **On-Call Duty Policy** — sync schedule changes to another roster system.

Search the trigger palette by name to find the one you want.

## Which trigger should I use?

| If you want to… | Pick |
| --- | --- |
| Click a button to run the workflow | **Manual** |
| Run on a repeating schedule | **Schedule** |
| Have another system push data in | **Webhook** |
| React to something inside OneUptime | **OneUptime event** |

A workflow can only have one trigger. If you need two ways to start the same automation, build the shared logic in one workflow and call it from two thin "wrapper" workflows using the **Execute Workflow** component.

## Where to read next

- [Components](/docs/workflows/components) — the actions you add after the trigger.
- [Variables](/docs/workflows/variables) — reading trigger output from later blocks.
- [Runs & Logs](/docs/workflows/runs-and-logs) — confirming your trigger fired.
