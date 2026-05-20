# Workflows Overview

Workflows are OneUptime's visual automation builder. Drag a trigger onto a canvas, wire it to a chain of actions — HTTP calls, Slack messages, JavaScript snippets, conditional branches, database lookups — and you have automation that runs whenever an event in OneUptime (or the outside world) fires.

If runbooks are checklists for humans during an incident, workflows are background jobs for your project — they run unattended, they react to things, and they glue OneUptime to the rest of your stack.

## At a glance

- **Top-level feature** in the OneUptime dashboard under **Workflows**.
- **Three trigger styles**: Manual, Schedule (cron), Webhook — plus a **model-event trigger** that fires when any OneUptime entity (incident, alert, monitor, status page, etc.) is created, updated, or deleted.
- **Visual canvas**: drag nodes from a component palette, connect output ports to input ports.
- **Mixed automation**: HTTP requests, Slack / Discord / Microsoft Teams / Telegram messages, custom JavaScript, JSON parsing, conditionals, email, sub-workflow calls, and CRUD operations on OneUptime models.
- **Global Variables**: project-wide secrets and config you reference from any workflow without copy-pasting.
- **Runs & Logs**: every execution is recorded with status, timing, and per-step output.

## Why use workflows?

Most teams reach for workflows when they want to:

- **Plug OneUptime into another system** — post an incident to PagerDuty, mirror an alert into Jira, ping a webhook in your stack.
- **React to OneUptime events** — when a `Sev 1` incident opens, page the on-call manager *and* create a Linear ticket *and* lock a feature flag.
- **Schedule recurring jobs** — every five minutes, query an internal API and write the result into an external system.
- **Receive data from outside OneUptime** — a webhook from a CI system kicks off a chain of OneUptime updates.
- **Reuse small chunks of glue logic** — one workflow calls another, so common patterns live in one place.

## Key concepts

| Term | Meaning |
| --- | --- |
| **Workflow** | The canvas. A named, reusable graph of triggers and components with an `isEnabled` flag. |
| **Trigger** | The node that starts a workflow run. Manual, Schedule, Webhook, or a model event. Every workflow has exactly one trigger. |
| **Component** | A node that does work — an HTTP call, a Slack message, a JavaScript snippet, a conditional, etc. |
| **Port** | An input or output socket on a node. Components have output ports like `success` and `error`; you connect a port to the next node's input port. |
| **Run / Log** | One execution of a workflow. Holds the timestamp, status (Running, Success, Failed, Timeout), and the captured output of every node that ran. |
| **Global Variable** | A named value (often a secret or API key) defined once at the project level and referenced from any workflow as `{{variable.NAME}}`. |
| **Local Variable** | A value scoped to a single workflow run — typically the return value of an earlier node, referenced as `{{ComponentId.portName}}`. |

## Where workflows live in the dashboard

| Page | What you do there |
| --- | --- |
| **Workflows** | Browse, create, and search workflow templates. |
| **A workflow's Builder tab** | The drag-and-drop canvas. Add nodes, connect ports, configure arguments. |
| **A workflow's Logs tab** | Every run of this workflow with filters for status and time range. Click a run to see per-node output. |
| **A workflow's Settings tab** | Rename, enable/disable, change the description, manage labels, delete. |
| **Workflows → Global Variables** | Define project-wide values referenced from any workflow. Mark a value as a secret to hide it from the UI after save. |
| **Workflows → Runs & Logs** | Project-wide execution history across all workflows. |

## The lifecycle of a workflow

1. **Author** — Create a workflow, drop a trigger on the canvas, drag in the components you need, connect them, and configure each one.
2. **Enable** — Workflows ship disabled. Flip the switch in Settings once you're confident the wiring is right.
3. **Trigger** — Manual: click **Run Manually** with an optional JSON payload. Schedule: cron fires. Webhook: an external system `POST`s to the workflow URL. Model event: someone (or another workflow) creates/updates/deletes a monitor, incident, alert, etc.
4. **Execute** — The Workflow Worker walks the graph in order. Each component reads its arguments (literal values or interpolated variables), does its job, writes its return value, and chooses an output port. The next node fires.
5. **Audit** — The run shows up in **Logs**. Status, total duration, per-component output and any errors are kept for the lifetime of the project.

## A worked example

Goal: when an incident is created with `Sev 1` in the title, post to a Slack channel and open a ticket in your internal admin tool.

**1. Create a workflow** named "Sev 1 fan-out."

**2. Drop a trigger.** Pick the **Incident → On Create** trigger from the palette. The trigger exposes the new incident as a return value.

**3. Drop a Conditional component.** Connect the trigger's output port to its input. Set the condition: `{{Incident.title}}` *contains* `Sev 1`.

**4. From the Conditional's `yes` port, drop a Slack component.** Channel: `#incident-room`. Message body: `Sev 1 declared: {{Incident.title}} — {{Incident.dashboardUrl}}`.

**5. From the same `yes` port (in parallel), drop an API component.** `POST` to `https://admin.internal/incidents`. Body: a small JSON object built from the incident.

**6. Enable the workflow.** Open an incident titled "Sev 1 — checkout 500s" in a different tab. Within a few seconds the Slack message arrives, and a new run appears under **Logs** with each node's output captured.

## How workflows fit with the rest of OneUptime

- **Monitors** detect problems; **incidents/alerts** record them; **workflows** react to them — post messages, open tickets, kick off automation.
- **Runbooks** are response procedures for humans (with optional script steps). Workflows are unattended background automation. They're complementary — a runbook step might `POST` to a webhook trigger of a workflow.
- **Workspace connections** (Slack, Microsoft Teams) are the typical destinations for workflow notifications.
- **Dashboards** are read-only views; workflows are the write side — they update OneUptime state, call external APIs, and move data around.

## Where to read next

- [Authoring a Workflow](/docs/workflows/authoring) — building a workflow on the canvas, configuring nodes, wiring ports.
- [Triggers](/docs/workflows/triggers) — Manual, Schedule, Webhook, and model-event triggers in detail.
- [Components](/docs/workflows/components) — the catalog of actions and how to configure each one.
- [Variables](/docs/workflows/variables) — global variables, local variables, and how interpolation works.
- [Runs & Logs](/docs/workflows/runs-and-logs) — reading execution history, debugging failures.
- [Configuration & Safety](/docs/workflows/configuration) — enabling/disabling, ownership, labels, secrets, recursion limits.
