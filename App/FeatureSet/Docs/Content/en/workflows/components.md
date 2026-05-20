# Components

Components are the action nodes you place after a trigger. Each one does one job — make an HTTP request, send a Slack message, branch on a condition, run a JavaScript snippet — and exposes one or more output ports for the next node to connect to.

This page is a catalog. For wiring rules and the canvas itself, see [Authoring a Workflow](/docs/workflows/authoring).

## API

Make an outbound HTTP request to any URL.

**Arguments**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- **URL** — the request URL. Interpolated.
- **Request Headers** — JSON object of headers.
- **Request Body** — JSON or text body for `POST` / `PUT` / `PATCH`.

**Output ports**:

- `success` — fires when the response status is 2xx. Return values: `response-status`, `response-headers`, `response-body`.
- `error` — fires on a network failure or non-2xx response. Return value: `error` message.

Use this for: any third-party REST API, your own admin endpoints, lightweight integrations that don't have a dedicated component.

## Webhook (outbound)

A thin wrapper around the API component for the common "fire and forget" case. Posts a JSON body to a URL and exposes a single `success` / `error` pair.

Prefer **API** if you need to read the response body downstream; prefer **Webhook** if you just want to notify another system.

## Slack

Post a message to a Slack channel using your project's Slack workspace connection.

**Arguments**:

- **Channel name** — the channel to post into. The bot must already be a member of that channel.
- **Message text** — the body. Interpolated; supports Slack mrkdwn.

Set up the workspace connection in **Project Settings → Workspace Connections → Slack** first. See [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Post a message to a Microsoft Teams channel using your project's Teams connection.

**Arguments**:

- **Team & channel** — the destination.
- **Message text** — the body.

See [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) for connection setup.

## Discord

Post a message to a Discord channel via an incoming webhook URL configured on the component.

## Telegram

Send a message to a Telegram chat via a bot token and chat ID configured on the component.

## Email

Send an email through OneUptime's SMTP configuration.

**Arguments**:

- **To** — recipient email address.
- **Subject** — interpolated.
- **Body** — Markdown or HTML.

The email is sent from the project's configured sender address (see [SMTP](/docs/emails/smtp)).

## Custom Code

Run a snippet of JavaScript with access to the workflow's variables and the upstream node's return values.

**Arguments**:

- **Code** — the JavaScript body. The last expression's value (or anything returned from `(async () => { ... })()`) becomes the component's return value.
- **Arguments** — optional named values passed in as `args`.

**Output ports**: `success` (return value), `error` (caught exception).

Use this for: transforming a payload between two systems, doing a small computation that doesn't deserve its own component, calling JS-only logic. Heavier scripting that must run inside your own infrastructure belongs in a [Runbook](/docs/runbooks/index) Bash or JavaScript step.

## JSON

Convert between text and JSON.

- **JSON → Text** — serialize a JSON object to a string (handy for piping into a `body` argument of an outbound component that expects text).
- **Text → JSON** — parse a string into a JSON object. Useful when an upstream API returned its body as text but you need to read a field.

## Conditions

Branch on a comparison. Configure:

- **Left value** — typically an interpolated reference like `{{Incident.title}}`.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — the value to compare against.

**Output ports**: `yes` and `no`. Wire the rest of the workflow off whichever branch matches your intent.

## Schedule (delay)

Pause a workflow for a configured duration before continuing. Useful when you need to give an external system a moment to settle before checking its state.

## Log

Write a line to the workflow run log. Pure debugging aid; the line is captured on the run and visible under **Logs**. No external side effect.

## Execute Workflow

Call another workflow as a sub-step. The called workflow runs independently (fire-and-forget) — control returns to the caller as soon as the call is dispatched.

Use this to factor shared logic out of multiple workflows: build a "post-to-incident-channel" workflow once and call it from every other workflow that needs to notify the channel.

A recursion limit prevents workflows from calling each other in an infinite loop. See [Configuration & Safety](/docs/workflows/configuration).

## Model components (CRUD on OneUptime entities)

For every OneUptime entity that supports workflows (monitors, incidents, alerts, status pages, on-call policies, etc.), the palette automatically exposes the following components — searchable by the entity name:

- **Find One {Entity}** — fetch a single record by query.
- **Find {Entity}** — fetch a list of records by query (paginated).
- **Create {Entity}** — insert a new record.
- **Update {Entity}** — update one record by ID.
- **Delete {Entity}** — delete one record by ID.
- **Count {Entity}** — count records matching a query.

This is how a workflow can read and write OneUptime state without leaving the platform. For example: a webhook from your CI tool calls **Create Incident** with the build's failure message; or a scheduled workflow runs **Find Incident** every five minutes and emails a summary.

## Picking the right component

Some quick rules of thumb:

- If a dedicated component exists for what you want to do (Slack, Email, a CRUD on a OneUptime entity), use it — it gives you nicer error handling and clearer logs than rolling your own.
- If you need to call an external HTTP API that doesn't have a dedicated component, use **API**.
- If you need to *shape* data between two components, use **Custom Code** or **JSON**.
- If you need to take different actions based on a value, use **Conditions**.

## Where to read next

- [Variables](/docs/workflows/variables) — how to feed data from one component into the next.
- [Runs & Logs](/docs/workflows/runs-and-logs) — how to inspect what each component returned during a run.
- [Configuration & Safety](/docs/workflows/configuration) — limits, ownership, and secrets.
