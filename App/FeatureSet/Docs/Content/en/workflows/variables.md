# Variables

Workflows are about moving data — from the trigger to the first block, from one block to the next, and from shared values into anywhere you need them. Variables are how that data moves.

There are two variable scopes, plus component outputs produced during a run.

## Global variables

Project-wide values you save once and reuse anywhere. Think API keys, URLs, channel names — anything you don't want to copy into ten different workflows.

Find them under **Workflows → Global Variables**. Each has:

- **Name** — how you'll reference it. At least two characters, no spaces, and only letters, numbers, hyphens and underscores. `UPPER_SNAKE_CASE` is a good habit because it stands out in your blocks.
- **Description** — optional, free text to remind you what it's for.
- **Secret** — when on, the value is scrubbed out of run logs and step traces.
- **Content** — the actual value. It's a long-text field, so multi-line values work.

Use a global variable in any workflow with:

```
{{global.variables.NAME}}
```

For example, if you saved your PagerDuty key as `PAGERDUTY_KEY`, any block can use it as `{{global.variables.PAGERDUTY_KEY}}` — the editor stores the reference, and workflow logging scrubs the resolved secret value.

Variables are created and deleted, not edited. There's no edit button on the table, so to change a value in the UI you delete the variable and create it again — or update it over the API, which is covered at the end of this page. Global and workflow variables are a Growth plan feature.

## Local workflow variables

Variables scoped to one workflow, managed under **Workflow Variables** in that workflow's left menu. Reference them with:

```
{{local.variables.NAME}}
```

## Component outputs (data from earlier blocks)

Every trigger and component can produce output during an execution. Use the component-value picker in the editor to create the reference rather than typing it — it inserts the exact ids the runner expects.

Reference an earlier block's output like this:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` is the block's **Identifier** — the short id shown on the block, not the name displayed on it. New blocks get one like `api-get-1`, and you can rename it in the block's **ID** section. Renaming it breaks every reference already pointing at it, the same way renaming a variable does. `FIELD_ID` is the selected return-value id.

Examples:

- After an **API** component whose ID is `lookup-user` runs, its status code is `{{local.components.lookup-user.returnValues.response-status}}` and its body is `{{local.components.lookup-user.returnValues.response-body}}`.
- After a **Run Custom JavaScript** component whose ID is `transform`, its returned value is `{{local.components.transform.returnValues.returnValue}}`.
- Triggers for a record type — **On Create Incident** and friends — return exactly one value, `model`, and you drill into it. For a trigger whose ID is `incident-on-create-1`, the incident's title is `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Local variables only exist during the current run. Each new run starts fresh.

## Where variables work

Almost every text field accepts variables:

- The URL on an API block.
- The message text on Slack, Teams, Discord, Telegram, Email.
- The subject and body of an email.
- Headers and body fields (inside string values).
- Both sides of an **If / Else** block (listed under the Conditions category).

In JSON fields you can use a variable inside a string value, but not as a key. A reference that occupies a whole value on its own is substituted bare, so you can drop an entire object into a JSON field that way. If you need to build a structure dynamically, use a **Run Custom JavaScript** block to build it, then pass its output to the next block.

The **Run Custom JavaScript** block doesn't get variables automatically — nothing is injected into the sandbox. Put `{{global.variables.NAME}}` (or any component reference) into the block's **Arguments** JSON field; those values are substituted before the script runs and arrive as `args`.

## Looping over arrays

Inside a text field you can iterate an array with `{{#each path}}…{{/each}}`. Within the block, `{{property}}` reads from the current element, `{{@index}}` is the 0-based position, and `{{this}}` is the element itself for arrays of plain values. Names inside an `{{#each}}` block are trimmed, so stray spaces are harmless there — unlike everywhere else.

## Examples

### Building a payload from a webhook

A webhook arrives with a body like `{ "service": "checkout", "status": "failed" }`. To turn that into a OneUptime incident:

1. **Webhook** trigger with the id `ci-webhook`.
2. **If / Else** block: select the webhook's Request Body output and use its `status` property, operator `==`, right `failed`.
3. From the **Yes** branch, a **Create One Incident** block with:
   - Title: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Using a secret in an API call

A workflow that calls PagerDuty:

1. Save `PAGERDUTY_KEY` as a secret global variable.
2. On the **API** block, set the `Authorization` header to `Token token={{global.variables.PAGERDUTY_KEY}}`.

The key stays out of the workflow and the logs.

### Chaining two API calls

The first call gives you an ID the second one needs:

1. **API** component `lookup-order`: use the picker to insert the manual trigger's JSON email field in `GET /orders?email=...`.
2. **API** component `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

If `lookup-order` fails, its **Error** output fires instead of **Success**. Connect that to an Email or Slack block so failures don't go unnoticed.

## Updating a variable from a workflow

A common pattern is rotating a credential on a schedule: fetch a fresh token from a third party, then store it back in the variable so the next run picks it up. Do that with an **API** block calling the OneUptime API.

`PUT /api/workflow-variable/<variable-id>` with an `ApiKey` header, and — this is the part that trips people up — the fields you want to change **wrapped in a `data` object**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

A flat body without the `data` wrapper is rejected with a 400. Send only the fields you actually want to change; `name` and `description` can stay out of the payload.

The API key needs **Edit Workflow Variables**. No read permission is required — the update doesn't read the row back.

Two things to watch:

- **Don't rename a variable you reference.** `name` is part of `{{local.variables.NAME}}`. Changing it leaves every existing reference unresolved, and an unresolved reference is passed through as literal text — see the gotcha below.
- **A variable can be written this way but never read back.** `content` is write-only over the API for every variable, secret or not. That's what makes a variable a safe place to park a rotating token. Marking it secret additionally keeps the value out of run logs and step traces.

## Gotchas

- **Use the pickers.** They insert the exact component, return-value, and variable ids the runner expects, and keep references independent of display labels.
- **Variable names are case-sensitive.** `{{global.variables.MyKey}}` and `{{global.variables.mykey}}` are different.
- **A reference that doesn't resolve is left as-is, not blanked.** Referring to something that doesn't exist is not an error, and it doesn't give you an empty string either: the braces are passed straight through, so `{{local.components.api-get-1.returnValues.body}}` with a mistyped step id ends up in your Slack message, URL or request body verbatim, and the run still reports **Executed**. The run log carries a warning line naming any reference that slipped through.
- **The builder can't check variable names.** It flags component references it can't match — an unknown step id, an unknown return value, a malformed root — before you save. It can't tell whether a variable exists, so a renamed variable is caught only by the run log.
- **Spaces inside the braces are not trimmed.** `{{ local.variables.NAME }}` is a different lookup from `{{local.variables.NAME}}` and never resolves. The one exception is inside an `{{#each}}` block, where names are trimmed.

## Where to read next

- [Components](/docs/workflows/components) — the full list of outputs each block produces.
- [Runs & Logs](/docs/workflows/runs-and-logs) — see the actual value of every variable after a run.
- [Configuration & Safety](/docs/workflows/configuration) — what's safe to put in a global variable.
