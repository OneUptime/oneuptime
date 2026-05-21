# Configuration & Safety

This page covers the settings and safety limits worth knowing about before you point a workflow at real traffic.

## Turning a workflow on or off

Every workflow has an **Enabled** switch in **Settings**. When it's off, the workflow doesn't run — webhook calls, scheduled times, and OneUptime events are all ignored. New workflows start disabled.

Use this switch as your "ready to go" gate:

1. Build the workflow.
2. Click **Run Manually** with a realistic payload.
3. Check the **Logs** — make sure every block went where you expected.
4. Flip **Enabled** on.

Turning a workflow off doesn't stop runs that are already in progress; it just stops new ones from starting.

## Owners and labels

- **Owners** — users and teams listed as owners get access to the workflow and can opt in to notifications when it fails. Set them under **Settings → Owners**.
- **Labels** — tags for grouping workflows. The workflow list lets you filter by label, which makes a busy project a lot easier to navigate. Useful when you have workflows organized by team, integration, or environment.
- **Label rules** — under **Workflows → Settings → Label Rules**, automatically apply labels to new workflows based on name or description patterns.
- **Owner rules** — under **Workflows → Settings → Owner Rules**, automatically assign owners to new workflows.

## Secrets

Mark a global variable as a **secret** if it contains something sensitive. The value is encrypted, hidden in the UI after you save, and hidden in the run logs (shown as `[REDACTED]`).

Use secret variables for:

- API keys for outside services.
- Authentication tokens.
- Webhook signing keys.
- Anything you wouldn't want someone with read-only access to see.

Don't paste a secret directly into a block — values like `Authorization: Bearer eyJh...` end up visible in the workflow and the logs. Use `{{variable.MY_SECRET}}` instead.

## How long a run can take

Each run has a maximum length. If a run hasn't finished in time, it's marked **Timeout** and the block in progress is cancelled. The default is generous — long enough for normal HTTP calls and chains of blocks.

Individual blocks have their own time limits inside that — for example, an API block gives up on a hung outbound request well before the whole run does.

## Limit on calling other workflows

The **Execute Workflow** component lets one workflow call another. To prevent accidental loops where workflow A calls B which calls A again, there's a cap on how deep the chain can go. A run that goes past the limit ends with a clear error.

If you have a real need for a long chain (like a job that processes one item per run), it's usually simpler to loop inside a single workflow using **Custom Code**.

## Webhook security

Webhook triggers give you a unique URL. Anyone who knows the URL can hit it. To protect against accidental or unwanted callers:

- Treat the URL like a password. Don't share it publicly or commit it to a public repo.
- For sensitive workflows, ask the calling system to send a shared token as a header (like `X-Webhook-Token`) and check it with a **Conditions** block before doing anything important. Save the expected token as a secret variable.
- For very sensitive workflows, prefer a OneUptime event trigger and a manual import step instead of a public webhook.

## Outbound network access

API and other HTTP blocks make their requests from OneUptime. If you self-host, make sure your installation can reach the services you're calling. If you use OneUptime Cloud, our outbound IP ranges are listed in [IP Addresses](/docs/configuration/ip-addresses) so you can allow them on the other side.

## Permissions

Workflows respect your project's role-based access control. The relevant permissions:

- **Create / Read / Edit / Delete Workflow** — the basic permissions on the workflow itself.
- **Run Workflow** — needed to click **Run Manually** or trigger a workflow via API.
- **Read Workflow Log** — needed to view runs.
- **Read / Create / Edit / Delete Workflow Variable** — control over the global variables list.

Most engineers should have create/edit/read on workflows but not on variables. Save variable edit access for the people who manage your project's secrets.

## Plan limits

OneUptime Cloud caps the number of runs per month on smaller plans. Your current limit is shown under **Project Settings → Billing**. When you reach it, new triggers are rejected until the next billing cycle. Self-hosted installations don't have this limit.

## When workflows aren't the right tool

A few cases where you should reach for something else:

- **Heavy computation or large datasets** — workflows are designed for light glue work, not number crunching. Run heavy work in your own infrastructure and let a workflow kick it off.
- **Long-running processes that span hours** — a single run is meant to finish quickly. If you need to "do A, wait two hours, do B," use an external scheduler that sends a webhook back to OneUptime when it's time.
- **Step-by-step incident response with humans in the loop** — that's what [Runbooks](/docs/runbooks/index) are for. Workflows are for unattended automation.

## Where to read next

- [Workflows Overview](/docs/workflows/index) — the big picture.
- [Components](/docs/workflows/components) — block-by-block reference.
- [Runbooks](/docs/runbooks/index) — when to use a runbook instead.
