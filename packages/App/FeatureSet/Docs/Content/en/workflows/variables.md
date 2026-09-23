# Variables

Workflows are about moving data — from the trigger to the first block, from one block to the next, and from shared values into anywhere you need them. Variables are how that data moves.

There are two variable scopes, plus component outputs produced during a run.

## Global variables

Project-wide values you save once and reuse anywhere. Think API keys, URLs, channel names — anything you don't want to copy into ten different workflows.

Find them under **Workflows → Global Variables**. **Create Workflow Variable** creates a static variable, which has:

- **Name** — how you'll reference it. At least two characters, no spaces, and only letters, numbers, hyphens and underscores. `UPPER_SNAKE_CASE` is a good habit because it stands out in your blocks.
- **Description** — optional, free text to remind you what it's for.
- **Content** — the actual value. It's a long-text field, so multi-line values work.
- **Secret** — when on, the value is scrubbed out of run logs and step traces.

To create an **OAuth 2.0 access token** variable instead, open the **More** menu (**⋯**) next to **Create Workflow Variable** and choose **Create OAuth 2.0 Variable**. OAuth 2.0 variables have [their own section](#oauth-20-variables-tokens-that-refresh-themselves) below. A variable's type can't be changed after it's saved.

Use a global variable in any workflow with:

```
{{global.variables.NAME}}
```

For example, if you saved your PagerDuty key as `PAGERDUTY_KEY`, any block can use it as `{{global.variables.PAGERDUTY_KEY}}` — the editor stores the reference, and workflow logging scrubs the resolved secret value.

The list shows each variable's name, type and description. Click **View** on a row to open the variable's page, where you can do everything else:

- **Edit Variable** changes the name, the description and — for a static variable that isn't secret yet — the secret flag. Once a variable is secret it stays secret.
- **Update Content** replaces a static value. The saved content can't be read back, so you type the new value in full.
- **Use in Workflows** shows the exact reference to paste into your blocks, with a copy button.
- **Delete Workflow Variable** deletes it, after asking you to confirm.

You can also update a variable over the API, which is covered at the end of this page. Global and workflow variables are a Growth plan feature.

## Local workflow variables

Variables scoped to one workflow, managed under **Workflow Variables** in that workflow's left menu. They work the same way as global variables: **Create Workflow Variable** creates a static variable, the **More** menu (**⋯**) creates an OAuth 2.0 variable, and **View** opens a variable's own page. Reference them with:

```
{{local.variables.NAME}}
```

## OAuth 2.0 variables (tokens that refresh themselves)

A bearer token pasted into a static variable works until it expires, usually within the hour. After that, every run that uses it fails with `401 Unauthorized` until someone pastes a new one. An **OAuth 2.0 access token** variable stores what the OAuth token exchange needs instead of the token itself, and OneUptime keeps the token current.

You use it exactly like any other variable:

```
Authorization: Bearer {{global.variables.CRM_API_TOKEN}}
```

### How the token stays fresh

- The first time a workflow uses the variable, OneUptime asks your identity provider's token endpoint for an access token and keeps it.
- Before every step that refers to the variable, the runner checks the token. If it has expired, or expires within the next minute, a new one is fetched before the step runs. The component always receives a token that hasn't expired, however long the variable sat unused and however long the run has been going.
- Only steps that actually refer to the variable trigger a refresh. A run that never uses a variable never fetches its token, and doesn't fail because that provider is down.
- When many runs need a new token at the same moment, one of them fetches it and the others use that one.
- If the provider doesn't say when a token expires (no `expires_in`, and the token isn't a JWT with an `exp` claim), OneUptime fetches a new one once per run and shares it between that run's steps.

### Grant types

- **Client Credentials**: OneUptime signs in as your application. This is the usual choice for server-to-server APIs such as Microsoft Graph, Auth0 or Okta APIs, or an internal service behind Keycloak.
- **Refresh Token**: for delegated access on behalf of a user. Authorise the application once (for example in your provider's OAuth playground or with Postman) and paste the refresh token you get. OneUptime exchanges it for access tokens. If your provider rotates refresh tokens, OneUptime saves each new one. A public client with no client secret works too.

### Settings

- **Token URL**: your provider's token endpoint, for example `https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token` (Microsoft Entra ID), `https://oauth2.googleapis.com/token` (Google), `https://{your-domain}/oauth2/default/v1/token` (Okta) or `https://{your-domain}/oauth/token` (Auth0).
- **Client ID** and **Client Secret**: from the application you registered with the provider.
- **Refresh Token**: Refresh Token grant only.
- **Scope**: space-separated. Leave it empty to get the provider's default scopes.
- **Additional Parameters**: extra form fields for the token request, such as `audience` for Auth0 or `resource` for Azure AD v1. Anyone who can read the variable can read these, so don't put secrets here.
- **Client Authentication**: whether the client ID and secret go in an HTTP Basic header (the default) or in the request body. If your provider answers `invalid_client`, try the other one.

When you save a new OAuth 2.0 variable, OneUptime fetches its first token straight away and tells you what the provider said. A typo in the secret or the URL shows up then, not hours later in a failed run.

The variable's page (click **View** on its row) has an **OAuth 2.0 Settings** card. **Edit Settings** changes the token URL, client ID, scope, additional parameters and client authentication; the grant type is fixed once saved.

### The Access Token card

The **Access Token** card on an OAuth 2.0 variable's page shows one of:

- **Valid**: the cached token hasn't expired yet.
- **Expired**: normal for a variable no workflow has used lately. The next run that uses it fetches a new token.
- **Not fetched yet**: no token has been fetched since the variable was created or its settings changed.
- **No expiry reported**: the provider didn't say when the token expires, so each run fetches a new one.
- **Refresh failed**: the last attempt to get a token failed. The provider's reason is shown. The next successful refresh clears it.

**Refresh now**, under the status, fetches a new token straight away. Use it to check new settings without running a workflow. **Update Credentials**, on the **OAuth 2.0 Settings** card, replaces the client secret or the refresh token, then fetches a token with them. Changing any setting (token URL, client ID, scope and so on) discards the cached token, so the next run fetches one with the new settings.

### When the provider says no

The step that needed the token fails before it runs, and the run log names the variable and quotes the provider's answer, for example `Could not get an OAuth 2.0 access token for {{global.variables.CRM_API_TOKEN}}: The token endpoint refused the request (HTTP 400): invalid_grant - Token has been expired or revoked.` The same reason appears on the variable's **Access Token** card. `invalid_grant` on a Refresh Token variable almost always means the refresh token itself has expired or been revoked, and **Update Credentials** is the fix.

If the refresh fails while the cached token hasn't actually expired yet (it was only inside the one-minute margin), the step goes ahead with the cached token and the log says so.

### Security

- OAuth 2.0 variables are always secret. The access token is replaced with `[REDACTED]` in run logs and step traces, including a token that was replaced partway through a run.
- The client secret, the refresh token and the access token are encrypted in the database and can never be read back through the API or the dashboard. **Refresh now** reports when the new token expires, never the token.
- The token URL has to be `http` or `https`. Requests to loopback, link-local and cloud metadata addresses are refused. On OneUptime Cloud, private network addresses are refused too. Self-hosted installs can reach an identity provider on their own network. OneUptime doesn't follow redirects on token requests, so point the Token URL at the address the endpoint actually answers on. A token request gives up after 20 seconds.

### Switching an existing static token to OAuth 2.0

A variable's type is fixed once it's saved. Delete the static variable and create an OAuth 2.0 variable with the **same name**. Workflows refer to variables by name, so they pick up the new one without any change.

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

If the credential is an OAuth 2.0 access token, you don't need to build this yourself. An [OAuth 2.0 variable](#oauth-20-variables-tokens-that-refresh-themselves) fetches and refreshes the token on its own.

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
