# Components

Components are the building blocks you add after the trigger. Each one does one thing — send a message, call an API, check a condition — and connects to whatever comes next.

This page is the catalog. For how to add and connect them on the canvas, see [Authoring a Workflow](/docs/workflows/authoring).

You rarely need this page open while you build. Every block's settings end with **How to use**: what the block does, the steps to set it up, an example built from your own workflow, and the mistakes people commonly make. Click **How to use** at the top of the settings to jump there.

## API

Make an HTTP request to any URL. There is one block per method: **API Get (JSON)**, **API Post (JSON)**, **API Put (JSON)**, **API Patch (JSON)** and **API Delete (JSON)**.

**Settings**:

- **URL** — the address to call.
- **Request Body** — the JSON to send, for `POST`, `PUT` and `PATCH`.
- **Request Headers** — any headers to send, such as an API key. They are under the block's advanced settings.

**Outputs**:

- **Success** — fires when the call worked (2xx response).
- **Error** — fires on a network failure or non-2xx response.

Either way, the block returns **Response Status**, **Response Headers** and **Response Body**, plus **Error** with the reason when it failed. Read one field of a JSON response by adding its name to the reference, as in `{{local.components.api-get-1.returnValues.response-body.id}}`. Redirects are not followed.

Use this for: any external API, your own admin endpoints, or any integration that doesn't have its own component.

## AI

### Generate Text with AI

Generate one text response from a prompt and optional JSON context. The component uses the project's configured default LLM provider, falling back to the installation's global provider when one is available. Provider credentials and endpoints are configured centrally; they are not workflow arguments.

**Settings**:

- **System Instructions** — optional guidance for the model's role, tone, and constraints.
- **Prompt** — the required task. It's sent exactly as you type it, so Markdown is fine, and it can include workflow variables and outputs from earlier components.
- **Context** — optional JSON that you deliberately include with the request. It is appended after an explicit end-of-message trust marker and treated as untrusted data through the rest of the message.
- **Temperature** — variation from `0` to `1`. The default is `0.2` for predictable automation.
- **Maximum Output Tokens** — from `1` to `4096`. The default is `1024`.

The combined System Instructions, Prompt, and serialized Context are limited to 50,000 characters. The provider request has a 60-second maximum duration and is attempted once. At most three workflow AI requests can run concurrently per project.

**Outputs**:

- **Response** — the generated text.
- **Provider** and **Model** — the configuration used for the call.
- **Total Tokens** and **Completion Tokens** — usage reported by the provider.
- **LLM Log ID** — the metered AI log entry for the call.
- **Error** — the validation, access, provider, budget, billing, or timeout error, when present.

Connect **Success** to components that should use the response. Connect **Error** to an explicit fallback, alert, or log path. The component makes one model request without tool definitions or provider-native capability fields: it cannot query OneUptime, call APIs, or change project data by itself. Besides OneUptime's fixed component-safety instructions, only the System Instructions, Prompt, and Context you configure are sent to the provider, after workflow variables in those fields are resolved. The configured provider/model remains a trust boundary because a model can have intrinsic provider-managed capabilities.

Model output is untrusted text. Review it before sending customer-facing communications, and do not use free-form AI text alone to authorize destructive workflow actions. See [Configuration & Safety](/docs/workflows/configuration) for provider, egress, logging, and cost details.

## Slack

Post a message to a Slack channel through an incoming webhook.

**Settings**:

- **Slack Incoming Webhook URL** — the webhook for the channel to post to. Slack's guide to [creating one](https://api.slack.com/messaging/webhooks) takes a couple of minutes.
- **Message Text** — the text to send. It's sent exactly as you type it, so use Slack's own formatting: `*bold*`, `_italic_`, `~strikethrough~` and `<https://example.com|a link>`.

## Microsoft Teams

Post a message to a Microsoft Teams channel.

**Settings**:

- **Teams Incoming Webhook URL** — the channel webhook to post to. Microsoft's guide shows how to [create one with Teams Workflows](https://support.microsoft.com/en-us/teams/apps-service/create-incoming-webhooks-with-workflows-for-microsoft-teams).
- **Message Text** — the text to send.

## Discord

Post a message to a Discord channel through an incoming webhook URL.

## Telegram

Send a message to a Telegram chat using a bot token and chat ID.

## Email

Send an email through an SMTP server that you enter on the block.

**Settings**:

- **From Email** — the sender, for example `Alerts <alerts@company.com>`.
- **To Email** — the recipient's email address. Separate several addresses with commas or semicolons.
- **Subject** — the subject line.
- **Email Body** — the message, sent as HTML.
- **SMTP Host** and **SMTP Port** — the mail server to connect to.
- **SMTP Username** and **SMTP Password** — optional. Fill in both or neither.
- **Use Implicit TLS** — turn on for implicit TLS, usually on port 465. Leave off for STARTTLS, usually on port 587.

**Outputs**:

- **Success** — fires when the SMTP server accepted the message.
- **Error** — fires when the SMTP host is refused, the server can't be reached, or it rejects the message. Passes along the error message. A missing **To Email**, **From Email**, **SMTP Host** or **SMTP Port** stops the run instead.

The block connects straight to the server in its settings. It does not use your project's [SMTP](/docs/emails/smtp) settings or OneUptime's own mail server, and the emails it sends do not appear in Notification Logs. To check what it did, look at the workflow's [Runs](/docs/workflows/runs-and-logs).

Connections to loopback (`localhost`, `127.0.0.1`), link-local and cloud metadata addresses are refused. On OneUptime Cloud, an SMTP host on a private network address, or a name that resolves to one, is refused too. Self-hosted installs can reach a mail server on their own network, unless `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` is set to `true`. A refused host takes the **Error** output, and nothing is sent.

## Custom Code

Run a small piece of JavaScript when you need something the other blocks can't do.

**Settings**:

- **Code** — your JavaScript. The last value (or what you return from an async function) becomes the block's output.
- **Arguments** — named values you can pass in.

**Outputs**: success (your return value) and error (any exception).

Use this for: reshaping data between two systems, doing a small calculation, anything that doesn't deserve its own block. For heavier scripting, use a [Runbook](/docs/runbooks/index) instead.

## JSON

Convert between text and JSON.

- **JSON → Text** — turn a JSON object into a string. Useful when the next block expects text.
- **Text → JSON** — parse a string into a JSON object. Useful when something arrived as text and you need to read a field. Its **Text** box takes several lines, so you can paste a whole document to test with.

## Conditions

Branch based on a comparison. In the **Add Component** panel this block is called **If / Else**, under **Popular**.

Its settings read as a sentence: **If** *value to check* *comparison* *compare with*, continue on **Yes**, otherwise on **No**. Under the settings, the condition is read back in words, so you can see it says what you mean. On the canvas the block shows its condition too, for example *If environment is equal to “production”*.

**Settings**:

- **Value to check** — usually a value from an earlier block. Press **{ }** in the box to pick one, or type `{{`.
- **Comparison** — in words:
  - **is equal to** and **is not equal to**;
  - for text: **contains**, **does not contain**, **starts with** and **ends with**;
  - for numbers: **is greater than**, **is greater than or equal to**, **is less than** and **is less than or equal to**;
  - **is empty** and **is not empty**, which check whether the value is there at all;
  - **is true** and **is false**.
- **Compare with** — what to compare against, typed or picked the same way. Is empty, is not empty, is true and is false do not use it.
- **Compare as** — folded away under the comparison: **Text**, **Number** or **True / False**. The number comparisons compare numbers and the text comparisons compare text, so you rarely need it. Choose **Text** to order dates written `2026-10-01`, or **Number** to make `200` and `200.0` equal.

How the values are compared:

- As text, capital letters count: `Error` is not `error`.
- As numbers, text that is not a number counts as `0`. The settings point out a typed value like that.
- As true or false, only `true` counts as true.
- **is empty** is met by nothing at all, blank text, an empty list or object, or a value the earlier block did not have, such as a field the webhook did not send. `0` and `false` are values, so they are not empty.

**Outputs**: **Yes** runs when the condition is met and **No** when it is not. Connect the next blocks to whichever branch you want.

Blocks set up before the settings had these names run exactly as they did. One old choice is no longer offered: comparing a value as **Null** or **Undefined**, which ignored what the value held, so it could never tell whether something was missing. A block that still uses it says so when you open it; choose **is empty** to check for a missing value.

## Sleep

Pause the workflow for a set amount of time before continuing. Useful when you need to give another system a moment to catch up.

**Settings**: **Days**, **Hours**, **Minutes** and **Seconds**, which add up. The longest wait is 30 days.

While it waits, the run is put aside and picked up again when the time is up, so a long wait does not hold anything up.

## Log

Write to the run log. No external effect — it just shows up in the workflow's logs for you to read. Handy for debugging.

**Settings**:

- **Value** — what to write. It can run to several lines, and it can include values from earlier blocks, like `{{local.components.webhook-1.returnValues.request-body}}`.

## Execute Workflow

Call another workflow from this one. The called workflow runs on its own — your workflow continues without waiting for it to finish.

Use this to share common logic. Build a "post to incident channel" workflow once, then call it from any other workflow that needs to notify the channel.

There's a safety limit so workflows can't keep calling each other in a loop. See [Configuration & Safety](/docs/workflows/configuration).

## OneUptime data components

For every kind of record in OneUptime (monitors, incidents, alerts, status pages, on-call policies, and many more), the **Add Component** panel has these components: under **OneUptime resources**, click the record type (**Browse all resources** has the ones not shown), or search by the type's name. Each title is generated from the record type, so the Monitor set reads:

- **Find One Monitor** — read one record matching the query.
- **Find Many Monitors** — read a list of records matching the query.
- **Create One Monitor** — add one record from a JSON object.
- **Create Many Monitors** — add several records from a JSON array.
- **Update One Monitor** — apply the write payload to one matching record.
- **Update Many Monitors** — apply the write payload to matching records, up to Limit.
- **Delete One Monitor** — delete one matching record.
- **Delete Many Monitors** — delete matching records, up to Limit.

The same set gives you three triggers — **On Create Monitor**, **On Update Monitor**, and **On Delete Monitor**. See [Triggers](/docs/workflows/triggers).

A type only offers the components its model allows. A read-only type has the two Find components and nothing else, so if you can't find **Delete One Monitor** in the panel, that type doesn't permit it.

This is how a workflow can read and change OneUptime data. For example: a webhook from your CI tool can use **Create One Incident** to open an incident with the failure details.

These components act as a Project Admin of the workflow's project: what a Project Admin may not do, or your plan doesn't include, is refused, and the run log says why. See [What workflow steps can do](/docs/workflows/configuration#what-workflow-steps-can-do).

### Declaring an incident from a template

**Create One Incident** can declare the incident from one of your [incident templates](/docs/incidents/settings#incident-templates): pick it under **Incident Template**, the step's first setting. The template fills in every field **JSON Object** leaves out — the title, description, severity, initial state, monitors and other resources, on-call policies, labels, status pages and custom fields — and its owners become the incident's owners. Anything you set in **JSON Object** wins over the template's, a state included, so with a template picked **JSON Object** only needs what should differ, and can be left empty.

The incident records the template it was declared from in `createdIncidentTemplateId`. That column is OneUptime's to set: a step that sends it in **JSON Object** is refused, and its run log points you to **Incident Template**. A template from another project, or one that was deleted, takes the step's **Error** output, and on a plan that doesn't include incident templates the step is refused with the plan it needs. See [How a template gets applied](/docs/incidents/settings#how-a-template-gets-applied).

## Working with records

Every field on a data component is keyed on the record's own **column** names — the same names the API uses, not the labels on the dashboard form. The ID column is `_id`. The `id` spelling is accepted as an alias anywhere you can type a column name, but `_id` is what a record gives back, so that's what to read on the way out:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** decides which records the component acts on. Keys are columns, values are what to match:

```json
{ "monitorType": "Website", "isEnabled": true }
```

A query is always scoped to the project the workflow runs in. You can't reach another project's records, and you don't need to add the project to the query yourself.

**JSON Object** on Create One, **JSON Array** on Create Many, and **Data (JSON Object)** on the Update components carry the fields to write, keyed the same way:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

A key that isn't a column is ignored rather than rejected — the run log names the ones it dropped, so check there when a field doesn't land. **Select Fields**, on the Find components and the triggers, uses the same column keys with `true` values: `{"_id": true, "name": true}`.

**Custom fields** are one column, `customFields`, holding each custom field's value under the field's name. The Update components change only the custom fields you name, and every other one keeps its value:

```json
{ "customFields": { "Notification Count": 1 } }
```

sets **Notification Count** and leaves the record's other custom fields as they were. Set a custom field to `null` to clear it, or set `customFields` itself to `null` to clear them all. Two workflows that update different custom fields of the same record at the same moment both land. This is the Update components only: the OneUptime API writes `customFields` whole, so a request to it must carry every custom field you want to keep.

You rarely type these keys yourself. In the component's settings, **Add a field** (or **Add a condition** on a query) lists the model's columns by name, with the kind of value each one takes. Search it by name, by column key or by what the field does, and press Enter to add the best match. On a create, the fields the record can't be created without come first, then the model's main fields (the ones it fills in for you if you leave them out), then everything else.

Fields OneUptime fills in itself aren't offered when you write a record: the record's `_id`, **Created At**, **Updated At**, **Created by User**, slugs, record numbers and notification statuses. Who created, archived or resolved a record, and when, is never a workflow's to set: a record a workflow creates is created by nobody, a value a workflow sends for one of those fields beside other fields is ignored, and an Update that sends nothing else fails with a message naming them. An update only offers fields that can change after a record exists. A query still offers the ID, the timestamps and **Created by User**, because they're useful to filter on. **Deleted At** isn't offered anywhere: records are deleted outright, so it's always empty.

**Skip** and **Limit** are two number fields on Find Many, Update Many, and Delete Many — `Skip: 0` with `Limit: 100` takes the first hundred matches. Limit defaults to `10`, and on Update Many and Delete Many it caps how many records are actually written, not just how many come back. So `Items Deleted: 10` means ten records were deleted, not that ten matched. Raise Limit when you mean to change more than ten.

**Success** and **Error** report whether the query ran, not what it found. A query matching nothing returns `0` and still leaves through Success — that is not a failure. To branch on whether anything matched, read the returned count in an **If / Else** block.

## Which component should I use?

A few quick rules:

- If there's a dedicated block for what you want (Slack, Email, a OneUptime record), use it — you get nicer error handling and clearer logs.
- For any other external API, use **API**.
- To summarize, classify, or draft text from explicitly selected workflow data, use **Generate Text with AI**.
- To reshape data between blocks, use **Custom Code** or **JSON**.
- To take different actions based on a value, use **Conditions**.

## Where to read next

- [Variables](/docs/workflows/variables) — passing data between blocks.
- [Runs](/docs/workflows/runs-and-logs) — checking what each block did on a run.
- [Configuration & Safety](/docs/workflows/configuration) — limits, owners, and secrets.
