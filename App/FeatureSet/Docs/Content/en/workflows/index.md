# Workflows Overview

Workflows let you automate tasks in OneUptime without writing code. Drag and drop a few blocks onto a canvas, connect them together, and you have automation that runs whenever something happens — an incident opens, a schedule fires, or another tool sends data to OneUptime.

Think of workflows as background helpers for your project: they react to events, talk to other tools, and quietly keep things in sync while you focus on your work.

## What you can do with workflows

- **Connect OneUptime to your other tools** — send incidents to Slack, create Jira tickets, post to a webhook in your stack.
- **React to what happens in OneUptime** — when a critical incident is created, notify the on-call team and open a ticket automatically.
- **Run jobs on a schedule** — every five minutes, every night, every Monday morning.
- **Receive data from outside** — let other systems push data into OneUptime through a unique URL.
- **Reuse common automation** — build it once, call it from any other workflow.

## How a workflow works

Every workflow has three parts:

1. **A trigger** — what starts the workflow. This can be a manual button, a schedule, an incoming webhook, or an event in OneUptime (like a new incident).
2. **One or more components** — what the workflow does. Send a message, make an HTTP call, run a quick check, branch based on a condition.
3. **Connections between them** — you draw lines from one block to the next to decide the order.

You build all of this visually on a canvas. No coding required for most workflows, though you can drop in a snippet of JavaScript when you need to.

## Key terms

| Term | What it means |
| --- | --- |
| **Workflow** | The whole automation — a name, a canvas, and a switch to turn it on or off. |
| **Trigger** | The first block. It decides when the workflow runs. Every workflow has exactly one trigger. |
| **Component** | An action block — sends a message, makes a request, checks a condition. |
| **Run** | One execution of the workflow. Saved with timestamps and the output of every block. |
| **Global variable** | A value (like an API key) you save once and reuse in any workflow. |

## Where to find workflows in OneUptime

Open **Workflows** in the left navigation. From there:

- **Workflows** — your list of workflows. Create a new one or open an existing one.
- **Builder tab** — the canvas where you design the workflow.
- **Logs tab** — every run of this workflow, with details.
- **Settings tab** — name, description, owners, labels, enable/disable.
- **Global Variables** — values shared across all your workflows.
- **Runs & Logs** — execution history across every workflow in your project.

## Building your first workflow

1. **Create** — give your workflow a name and a short description.
2. **Pick a trigger** — manual, scheduled, webhook, or an event from OneUptime.
3. **Add components** — drag actions onto the canvas and connect them.
4. **Test** — click **Run Manually** and watch what happens in the logs.
5. **Turn it on** — flip the **Enabled** switch in Settings when you're ready.

## A quick example

Say you want to post in Slack whenever a critical incident is created:

1. Create a workflow called "Critical incidents to Slack."
2. Pick the **Incident → On Create** trigger.
3. Add a **Conditions** block. Set it to check whether the incident title contains "Sev 1."
4. From the **Yes** branch, add a **Slack** block. Pick the channel and write the message.
5. Turn the workflow on.

The next time someone opens an incident with "Sev 1" in the title, Slack lights up.

## How workflows fit with the rest of OneUptime

- **Monitors** spot the problem. **Incidents** record it. **Workflows** react to it.
- **Runbooks** are step-by-step guides for people. Workflows are unattended automation. Use a runbook when a human needs to make decisions; use a workflow when the steps are automatic.
- **Workspace connections** (Slack, Teams) are where workflows send their messages.

## Where to read next

- [Authoring a Workflow](/docs/workflows/authoring) — building on the canvas.
- [Triggers](/docs/workflows/triggers) — the different ways a workflow can start.
- [Components](/docs/workflows/components) — the building blocks you can add.
- [Variables](/docs/workflows/variables) — using values across blocks and workflows.
- [Runs & Logs](/docs/workflows/runs-and-logs) — checking what happened.
- [Configuration & Safety](/docs/workflows/configuration) — settings worth knowing about.
