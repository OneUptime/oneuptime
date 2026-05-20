# Variables

A workflow is only useful when data flows through it. Variables are how that data moves — from the trigger into the first component, from one component's output into the next component's input, and from project-level secrets into anywhere they're referenced.

OneUptime has two kinds of variables and one interpolation syntax that works for both.

## Global variables

Project-wide values defined once under **Workflows → Global Variables**. Think API keys, base URLs, channel names, anything you don't want to hard-code into ten workflows.

A global variable has:

- **Name** — the identifier you reference it by. Use `UPPER_SNAKE_CASE` to make it obvious in templates.
- **Value** — the string value. Multi-line values are supported.
- **Is Secret** — when on, the value is write-only in the UI after save and is redacted from run logs.

Reference a global variable from anywhere in any workflow with:

```
{{variable.NAME}}
```

For example, if you defined `PAGERDUTY_KEY` as a secret variable, every API component that calls PagerDuty can read it as `{{variable.PAGERDUTY_KEY}}` without anyone seeing the actual key in the workflow JSON.

## Local variables

Local variables are the return values of nodes that already ran in this execution. Every trigger and every component publishes one — see [Triggers](/docs/workflows/triggers) and [Components](/docs/workflows/components) for the per-node lists.

Reference a local variable as:

```
{{NodeId.fieldName}}
```

The `NodeId` is the trigger or component's name on the canvas (you can rename it for readability — keep it short and `PascalCase` so the references stay clean). The `fieldName` is whatever that node publishes.

Examples:

- After an **API** component named `LookupUser` returns successfully, downstream nodes can read its status code as `{{LookupUser.response-status}}` and the parsed body as `{{LookupUser.response-body}}`.
- After an **Incident → On Create** trigger named `Incident`, you can read `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}`, and any other column on the incident.
- After a **Custom Code** component named `Transform`, the returned value is exposed as `{{Transform.value}}`.

Local variables are scoped to a single run. The next run starts with a fresh slate.

## Where interpolation works

Almost every text-style argument supports interpolation:

- URL fields on the API component
- Message text on Slack / Teams / Discord / Telegram / Email
- Subject and body on Email
- Headers and body fields (use it inside JSON values)
- Left and right operands on Conditions

Pure-JSON arguments accept interpolation inside string values; you cannot interpolate a key. If you need to build a dynamic structure, use **Custom Code** to assemble the payload and then pipe its return value into the next node.

The **Custom Code** component reads variables differently — global variables are exposed on `args.variables`, and upstream return values are passed in as named arguments you configure on the component.

## Examples

### Build a payload from a trigger

A webhook receives a CI build result. The body is JSON like `{ "service": "checkout", "status": "failed" }`. To turn that into a OneUptime incident:

1. **Webhook** trigger named `CIWebhook`.
2. **Conditions** component: left `{{CIWebhook.Request Body.status}}`, operator `==`, right `failed`.
3. From the `yes` port, a **Create Incident** component with:
   - Title: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Description: `See {{CIWebhook.Request Body.url}} for the build logs.`

### Use a secret in an outbound API call

A workflow that calls PagerDuty:

1. Define `PAGERDUTY_KEY` as a secret global variable.
2. On the **API** component, set the `Authorization` header to `Token token={{variable.PAGERDUTY_KEY}}`.

The key never appears in the workflow JSON or in run logs.

### Chain two API calls

The first call returns an ID that the second call needs:

1. **API** component `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. **API** component `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

If `LookupOrder` returns a non-2xx response, its `error` port fires instead of `success` — wire that branch to an Email or Slack component so failures aren't silent.

## A few gotchas

- **Typos in node names break references silently.** If you rename a node after wiring `{{OldName.field}}` downstream, update every reference. Look at the run log — if you see the literal `{{OldName.field}}` in the captured argument, the lookup didn't resolve.
- **Secrets are case-sensitive.** `{{variable.MyKey}}` and `{{variable.mykey}}` are different variables.
- **Missing fields are empty.** Referencing `{{Foo.nonexistent}}` produces an empty string, not an error. Useful, but it can mask bugs — use a **Conditions** node to assert presence if the field is required for the next step.

## Where to read next

- [Components](/docs/workflows/components) — the full catalog of return-value names.
- [Runs & Logs](/docs/workflows/runs-and-logs) — inspect the literal value of every interpolated argument after a run.
- [Configuration & Safety](/docs/workflows/configuration) — what's safe to put in a global variable.
