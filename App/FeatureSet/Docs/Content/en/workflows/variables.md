# Variables

Workflows are about moving data — from the trigger to the first block, from one block to the next, and from shared values into anywhere you need them. Variables are how that data moves.

There are two kinds, and they share the same syntax.

## Global variables

Project-wide values you save once and reuse anywhere. Think API keys, URLs, channel names — anything you don't want to copy into ten different workflows.

Find them under **Workflows → Global Variables**. Each has:

- **Name** — how you'll reference it. Use `UPPER_SNAKE_CASE` so it stands out in your blocks.
- **Value** — the actual value. Multi-line values work too.
- **Is Secret** — when on, the value is hidden in the UI after you save and is hidden from run logs.

Use a global variable in any workflow with:

```
{{variable.NAME}}
```

For example, if you saved your PagerDuty key as `PAGERDUTY_KEY`, any block can use it as `{{variable.PAGERDUTY_KEY}}` — the real key never shows up in the workflow or its logs.

## Local variables (data from earlier blocks)

Local variables are the output of blocks that already ran in this execution. Every trigger and every component produces some output you can read.

Reference an earlier block's output like this:

```
{{BlockName.fieldName}}
```

`BlockName` is the name of the trigger or component on the canvas (you can rename it to something short and clear). `fieldName` is whatever that block produces.

Examples:

- After an **API** block named `LookupUser` runs, you can read the status code as `{{LookupUser.response-status}}` and the body as `{{LookupUser.response-body}}`.
- After an **Incident → On Create** trigger named `Incident`, you can read `{{Incident.title}}`, `{{Incident.description}}`, and any other field on the incident.
- After a **Custom Code** block named `Transform`, the returned value is at `{{Transform.value}}`.

Local variables only exist during the current run. Each new run starts fresh.

## Where variables work

Almost every text field accepts variables:

- The URL on an API block.
- The message text on Slack, Teams, Discord, Telegram, Email.
- The subject and body of an email.
- Headers and body fields (inside string values).
- Both sides of a Conditions block.

Pure JSON fields accept variables inside string values, but you can't use a variable as a key. If you need to build a structure dynamically, use a **Custom Code** block to build it, then pass its output to the next block.

The **Custom Code** block reads variables differently — global variables come in on `args.variables`, and you decide which earlier outputs to pass in as arguments.

## Examples

### Building a payload from a webhook

A webhook arrives with a body like `{ "service": "checkout", "status": "failed" }`. To turn that into a OneUptime incident:

1. **Webhook** trigger named `CIWebhook`.
2. **Conditions** block: left `{{CIWebhook.Request Body.status}}`, operator `==`, right `failed`.
3. From the **Yes** branch, a **Create Incident** block with:
   - Title: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Description: `See {{CIWebhook.Request Body.url}} for the logs.`

### Using a secret in an API call

A workflow that calls PagerDuty:

1. Save `PAGERDUTY_KEY` as a secret global variable.
2. On the **API** block, set the `Authorization` header to `Token token={{variable.PAGERDUTY_KEY}}`.

The key stays out of the workflow and the logs.

### Chaining two API calls

The first call gives you an ID the second one needs:

1. **API** block `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. **API** block `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

If `LookupOrder` fails, its **error** output fires instead of **success**. Connect that to an Email or Slack block so failures don't go unnoticed.

## Gotchas

- **Renaming a block breaks references.** If you rename a block, update every place it's used. In the run log, an unresolved reference shows up as the literal `{{BlockName.field}}` text.
- **Variable names are case-sensitive.** `{{variable.MyKey}}` and `{{variable.mykey}}` are different.
- **Missing fields become empty.** Referring to a field that doesn't exist gives you an empty string, not an error. Convenient — but it can hide bugs. Use a **Conditions** block to check important fields before continuing.

## Where to read next

- [Components](/docs/workflows/components) — the full list of outputs each block produces.
- [Runs & Logs](/docs/workflows/runs-and-logs) — see the actual value of every variable after a run.
- [Configuration & Safety](/docs/workflows/configuration) — what's safe to put in a global variable.
