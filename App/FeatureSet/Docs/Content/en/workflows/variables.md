# Variables

Workflows are about moving data — from the trigger to the first block, from one block to the next, and from shared values into anywhere you need them. Variables are how that data moves.

There are two variable scopes, plus component outputs produced during a run.

## Global variables

Project-wide values you save once and reuse anywhere. Think API keys, URLs, channel names — anything you don't want to copy into ten different workflows.

Find them under **Workflows → Global Variables**. Each has:

- **Name** — how you'll reference it. Use `UPPER_SNAKE_CASE` so it stands out in your blocks.
- **Value** — the actual value. Multi-line values work too.
- **Is Secret** — when on, the value is hidden in the UI after you save and is hidden from run logs.

Use a global variable in any workflow with:

```
{{global.variables.NAME}}
```

For example, if you saved your PagerDuty key as `PAGERDUTY_KEY`, any block can use it as `{{global.variables.PAGERDUTY_KEY}}` — the editor stores the reference, and workflow logging scrubs the resolved secret value.

## Local workflow variables

Variables scoped to one workflow use:

```
{{local.variables.NAME}}
```

## Component outputs (data from earlier blocks)

Every trigger and component can produce output during an execution. Use the component-value picker in the editor to create the reference; it uses the component's stable canvas ID, not its displayed title.

Reference an earlier block's output like this:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` is the component ID shown by the picker. `FIELD_ID` is the selected return-value ID.

Examples:

- After an **API** component whose ID is `lookup-user` runs, its status code is `{{local.components.lookup-user.returnValues.response-status}}` and its body is `{{local.components.lookup-user.returnValues.response-body}}`.
- After an incident trigger whose ID is `incident-trigger`, its title is `{{local.components.incident-trigger.returnValues.title}}`.
- After a **Custom Code** component whose ID is `transform`, its returned value is `{{local.components.transform.returnValues.value}}`.

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
2. **Conditions** block: select the webhook's Request Body output and use its `status` property, operator `==`, right `failed`.
3. From the **Yes** branch, a **Create Incident** block with:
   - Title: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Using a secret in an API call

A workflow that calls PagerDuty:

1. Save `PAGERDUTY_KEY` as a secret global variable.
2. On the **API** block, set the `Authorization` header to `Token token={{global.variables.PAGERDUTY_KEY}}`.

The key stays out of the workflow and the logs.

### Chaining two API calls

The first call gives you an ID the second one needs:

1. **API** component `LookupOrder`: use the picker to insert the manual trigger's JSON email field in `GET /orders?email=...`.
2. **API** component `CancelOrder`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

If `LookupOrder` fails, its **error** output fires instead of **success**. Connect that to an Email or Slack block so failures don't go unnoticed.

## Gotchas

- **Use the pickers.** They insert the exact component, return-value, and variable IDs expected by the runner and keep references independent of display labels.
- **Variable names are case-sensitive.** `{{global.variables.MyKey}}` and `{{global.variables.mykey}}` are different.
- **Missing fields become empty.** Referring to a field that doesn't exist gives you an empty string, not an error. Convenient — but it can hide bugs. Use a **Conditions** block to check important fields before continuing.

## Where to read next

- [Components](/docs/workflows/components) — the full list of outputs each block produces.
- [Runs & Logs](/docs/workflows/runs-and-logs) — see the actual value of every variable after a run.
- [Configuration & Safety](/docs/workflows/configuration) — what's safe to put in a global variable.
