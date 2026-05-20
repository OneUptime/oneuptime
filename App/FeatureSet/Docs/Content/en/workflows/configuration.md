# Configuration & Safety

This page collects the settings and safety limits worth knowing about before you point a workflow at production traffic.

## Enable / disable

Every workflow has an **isEnabled** flag in **Settings**. Disabled workflows never fire — model events, webhooks, and scheduled runs are ignored. New workflows ship disabled.

Treat this as your "ready for prod" switch:

1. Build the workflow.
2. Click **Run Manually** with a representative payload.
3. Check **Logs** — confirm every node took the port you expected.
4. Flip **isEnabled** on.

Disabling a workflow does not affect runs that are already in flight; it only stops new ones from being created.

## Ownership and labels

- **Owners** — users and teams listed as owners receive permission-based access and (optionally) notifications when the workflow fails. Configure under **Settings → Owners**.
- **Labels** — many-to-many tags for organizing workflows. Filter the workflow list by label. Useful when a project has dozens of workflows organized by team, by integration, or by environment.
- **Label rules** — under **Workflows → Settings → Label Rules**, auto-apply labels to new workflows based on regex matches on name or description.
- **Owner rules** — under **Workflows → Settings → Owner Rules**, auto-assign owners to new workflows.

## Secrets

Global variables can be marked as **secret**. The value is encrypted at rest, write-only in the UI after save, and redacted from run logs (replaced with `[REDACTED]`).

Use secret variables for:

- API keys for outbound integrations.
- Bearer tokens.
- Webhook signing keys.
- Any value an attacker with read-access to a workflow shouldn't see.

Do not paste a secret directly into a component's argument — references like `Authorization: Bearer eyJh...` show up in the workflow JSON and the run logs in clear text. Reference `{{variable.MY_SECRET}}` instead.

## Run timeout

Each run has a maximum duration. If a run hasn't finished within the timeout, it's marked `Timeout` and any in-flight component is cancelled. The default is generous (minutes, not seconds) — see the worker's environment configuration for the exact value in your installation.

Most components have their own per-call timeouts inside the run timeout — e.g., the API component will give up on a hung outbound request well before the whole run does.

## Recursion limit

The **Execute Workflow** component lets one workflow call another. To prevent runaway loops where A calls B calls A indefinitely, the worker tracks the call chain and stops a chain that exceeds a fixed depth (typically a small number like 5). The terminating run is marked `Error` with a clear message about the recursion limit.

If you have a legitimate need for a long chain (e.g., a recursive folder walk that processes one level per run), refactor it into a single workflow that iterates internally via **Custom Code** — that pattern is not subject to the chain limit.

## Webhook security

Webhook triggers expose a unique HTTPS URL. Anyone who learns the URL can hit it. To defend against accidental or hostile callers:

- Treat the URL as a shared secret. Do not paste it into public chat or commit it to a public repo.
- For high-value workflows, ask the calling system to include a shared secret as a header (e.g., `X-Webhook-Token`) and validate it in a **Conditions** node before doing anything destructive. Define the expected token as a secret global variable.
- For very high-value workflows, prefer a model-event trigger and a manual import step instead of a public webhook.

## Outbound network egress

The API and other HTTP-style components send requests from the OneUptime Workflow Worker's network. If you self-host OneUptime, the worker's outbound network is your concern — make sure it can reach the third-party APIs you call. If you use OneUptime Cloud, our IP egress range is published in [IP Addresses](/docs/configuration/ip-addresses) so you can allowlist on the receiving side.

## Permissions

Workflows are first-class resources subject to project-level role-based access control:

- `CreateWorkflow`, `ReadWorkflow`, `EditWorkflow`, `DeleteWorkflow` — the four CRUD permissions on workflow templates.
- `RunWorkflow` — needed to click **Run Manually** or to dispatch a workflow via API.
- `ReadWorkflowLog` — needed to view the **Runs & Logs** page.
- `ReadWorkflowVariable`, `CreateWorkflowVariable`, `EditWorkflowVariable`, `DeleteWorkflowVariable` — control over the global variables list.

Most engineers should have create/edit/read on workflows but not on variables. Reserve variable edit access for the people who manage your project's secrets.

## Quotas

OneUptime Cloud caps the number of runs per month per project on smaller plans. The cap is shown on **Project Settings → Billing**. When you hit it, new triggers are rejected (and recorded with a "quota exceeded" reason on the affected workflow) until the next billing cycle. Self-hosted installations are not subject to a quota.

## What workflows are *not* good at

A few patterns where you should reach for a different tool:

- **Long-running computation** — workflows are oriented around glue between systems, not crunching big datasets. Run heavy work in your own infrastructure and use a workflow to kick it off.
- **Stateful workflows that span minutes/hours** — a single run is meant to finish quickly. If you need "do thing A, then wait two hours, then do thing B," model the wait as an external scheduler that posts back to a webhook trigger.
- **Step-by-step incident response with human checkpoints** — that's what [Runbooks](/docs/runbooks/index) are for. Use a workflow if there's no human in the loop; use a runbook if there is.

## Where to read next

- [Workflows Overview](/docs/workflows/index) — the conceptual map.
- [Components](/docs/workflows/components) — argument details for each action.
- [Runbooks](/docs/runbooks/index) — when to use a runbook instead.
