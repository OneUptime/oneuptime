# Components

Components are the building blocks you add after the trigger. Each one does one thing — send a message, call an API, check a condition — and connects to whatever comes next.

This page is the catalog. For how to drag, drop, and connect them on the canvas, see [Authoring a Workflow](/docs/workflows/authoring).

## API

Make an HTTP request to any URL.

**Settings**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`.
- **URL** — the address to call.
- **Headers** — any headers to send.
- **Body** — the request body for `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Success** — fires when the call worked (2xx response). Passes along the status, headers, and body.
- **Error** — fires on a network failure or non-2xx response. Passes along the error message.

Use this for: any external API, your own admin endpoints, or any integration that doesn't have its own component.

## Webhook (outbound)

A simpler version of the API component for "fire and forget" cases. Posts a JSON body to a URL.

Use **API** if you need to read the response. Use **Webhook** if you just want to send a notification and move on.

## Slack

Post a message to a Slack channel.

**Settings**:

- **Channel** — the channel name. The bot must already be in that channel.
- **Message** — the text to send. Supports Slack formatting.

Connect Slack to your project first under **Project Settings → Workspace Connections → Slack**. See [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Post a message to a Microsoft Teams channel.

**Settings**:

- **Team and channel** — where to post.
- **Message** — the text to send.

See [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) for setup.

## Discord

Post a message to a Discord channel through an incoming webhook URL.

## Telegram

Send a message to a Telegram chat using a bot token and chat ID.

## Email

Send an email through OneUptime.

**Settings**:

- **To** — the recipient's email address.
- **Subject** — the subject line.
- **Body** — the message in Markdown or HTML.

The email goes out from your project's configured sender — see [SMTP](/docs/emails/smtp).

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
- **Text → JSON** — parse a string into a JSON object. Useful when something arrived as text and you need to read a field.

## Conditions

Branch based on a comparison.

**Settings**:

- **Left value** — usually a value from an earlier block.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — what to compare against.

**Outputs**: **Yes** and **No**. Connect the next blocks to whichever branch you want.

## Delay

Pause the workflow for a set amount of time before continuing. Useful when you need to give another system a moment to catch up.

## Log

Write a line to the run log. No external effect — it just shows up in the workflow's logs for you to read. Handy for debugging.

## Execute Workflow

Call another workflow from this one. The called workflow runs on its own — your workflow continues without waiting for it to finish.

Use this to share common logic. Build a "post to incident channel" workflow once, then call it from any other workflow that needs to notify the channel.

There's a safety limit so workflows can't keep calling each other in a loop. See [Configuration & Safety](/docs/workflows/configuration).

## OneUptime data components

For every kind of record in OneUptime (monitors, incidents, alerts, status pages, on-call policies, and many more), the palette has these components — search by the type's name:

- **Find One** — get one record by ID or filter.
- **Find** — get a list of records.
- **Create** — add a new record.
- **Update** — change one record.
- **Delete** — remove one record.
- **Count** — count records matching a filter.

This is how a workflow can read and change OneUptime data. For example: a webhook from your CI tool can use **Create Incident** to open an incident with the failure details.

## Which component should I use?

A few quick rules:

- If there's a dedicated block for what you want (Slack, Email, a OneUptime record), use it — you get nicer error handling and clearer logs.
- For any other external API, use **API**.
- To reshape data between blocks, use **Custom Code** or **JSON**.
- To take different actions based on a value, use **Conditions**.

## Where to read next

- [Variables](/docs/workflows/variables) — passing data between blocks.
- [Runs & Logs](/docs/workflows/runs-and-logs) — checking what each block did on a run.
- [Configuration & Safety](/docs/workflows/configuration) — limits, owners, and secrets.
