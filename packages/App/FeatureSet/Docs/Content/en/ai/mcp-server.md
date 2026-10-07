# MCP Server

The OneUptime Model Context Protocol (MCP) Server provides LLMs with direct access to your OneUptime instance, enabling AI-powered monitoring, incident management, and observability operations.

## What is the OneUptime MCP Server?

The OneUptime MCP Server is a bridge between Large Language Models (LLMs) and your OneUptime instance. It implements the Model Context Protocol (MCP), allowing AI assistants like Claude to interact directly with your monitoring infrastructure.

## How It Works

The MCP server is hosted alongside your OneUptime instance and accessible via the Streamable HTTP transport. No local installation is required.

**Cloud Users**: `https://oneuptime.com/mcp`
**Self-Hosted Users**: `https://your-oneuptime-domain.com/mcp`

## Key Features

- **~155 Tools**: Full CRUD tools for 22 resource types (incidents, alerts, monitors, status pages, on-call, and more), read-only telemetry tools, plus workflow and helper tools
- **Real-time Operations**: Create, read, update, and delete resources in real-time
- **Type-safe Interface**: Fully typed with comprehensive input validation
- **Secure Authentication**: Sign in with your OneUptime account (OAuth 2.1), or send a per-request API key for unattended agents
- **Safety Annotations**: Read-only tools carry `readOnlyHint` and delete tools carry `destructiveHint`, so MCP clients can auto-approve safe calls and ask before destructive ones
- **Easy Integration**: Works with Claude Desktop and other MCP-compatible clients
- **Stateless by Design**: No session IDs — every request is self-contained, so the server works behind load balancers and multi-replica deployments

## What You Can Do

With the OneUptime MCP Server, AI assistants can help you:

- **Monitor Management**: Create and configure monitors, check their status, and review status history
- **Incident Response**: Create, acknowledge, and resolve incidents, add internal or public notes, and track resolution
- **Team Operations**: Manage teams and on-call policies
- **Status Pages**: Manage status pages and create announcements
- **Alerting**: Acknowledge and resolve alerts, add alert notes, and manage alert states and severities
- **Scheduled Maintenance**: Create and manage scheduled maintenance events
- **Telemetry**: Query logs, metrics, traces, exceptions, and monitor logs (read-only)

## Requirements

- OneUptime instance (cloud or self-hosted)
- MCP-compatible client (Claude Desktop, VS Code with GitHub Copilot, etc.)
- A OneUptime account to sign in with, or a OneUptime API key for an agent that runs unattended (only required for authenticated operations - public tools work without either)

## Signing In with OneUptime

The simplest way to connect is to give your MCP client the server URL and nothing else. The first time the client needs your data, it opens a OneUptime page in your browser where you:

1. Sign in to OneUptime, if you are not signed in already
2. Choose the project the client should work in
3. Choose whether the client may **read and write**, or **read only**
4. Click **Authorize**

The client then acts as you in that project. There is no API key to create, copy, or rotate, and nothing secret is stored in a configuration file.

What a connected client can do:

- **It has your permissions, and never more.** Whatever your teams allow you to do in the project is what the client can do. If your role changes or you leave the project, that applies to the client's very next request.
- **Read only means read only.** A client authorized as read only can use the `get_`, `list_`, and `count_` tools. Tools that create, update, delete, acknowledge, or resolve are refused, by the MCP server and by the OneUptime API behind it. You can never give a client more access than it asked for.
- **It is for one project.** To use a second project, connect the client again and choose that project.
- **It works only through the MCP server.** The client's access token is accepted by the MCP endpoint and nowhere else. It cannot be used to call the OneUptime REST API directly.
- **Instance administrators get no special treatment.** A client connected by a master admin has what that person's teams grant in the project, not instance-wide access.

### Managing Connected Clients

Every client that was connected by signing in is listed under **Project Settings** → **MCP Server** → **Connected MCP Clients**, with who connected it, what it may do, and when it was last used. You see the clients you connected; project owners and admins see everyone's.

Click **Disconnect** to sign a client out. It stops working immediately.

A client stays connected for as long as it is used. One that has not been used for 30 days has to sign in again.

### Controlling Who Can Connect Clients

Every project member can connect an MCP client by default. To stop the members of a team from doing so, open the team's **Permissions** page, open **More settings** at the bottom, and add the **Authorize MCP Client** permission under **Block Permissions**. Clients those members already connected stop working at once.

If the project requires single sign-on, sign in to the project with SSO in your browser before you authorize a client. The client's connection lasts as long as that SSO sign-in does; when it lapses, connect the client again.

On OneUptime Cloud, connecting an MCP client is available on the same plans as API keys (Growth and above).

On the Enterprise Edition, every change a connected client makes is recorded in the audit log under the person who connected it, together with the name of the client. Changes made with an API key show the name of the key.

## Getting Your API Key

Use an API key for an agent that runs unattended - a scheduled job or a CI pipeline - where nobody is there to sign in.

1. Log in to your OneUptime instance
2. Navigate to **Project Settings** → **API Keys**
3. Click **Create API Key**
4. Provide a name (e.g., "MCP Server")
5. Under **Access**, pick **Viewer** for an agent that only reads, or **Project Admin** for one that also creates, updates and deletes (see [API Key Permissions](#api-key-permissions))
6. Click **Create API Key**: the key's page opens
7. Copy the API key

API keys are project-scoped: the MCP server infers your project from the key, so create tools never need a `projectId` argument.

> **Warning — never give an AI agent a master key.** A OneUptime *master* API key is also accepted on this header and grants instance-wide admin access. Always use a project API key with the least privilege the agent needs (a read-only key is enough for all `get_`/`list_`/`count_` tools).

## Configuration

### Connecting by Signing In

Add the server URL to your client with no credentials. Use `https://your-oneuptime-domain.com/mcp` for a self-hosted instance.

**Claude Code**

```bash
claude mcp add --transport http oneuptime https://oneuptime.com/mcp
```

Then run `/mcp` inside Claude Code and choose **oneuptime** to sign in.

**Claude (web and desktop)**

Open **Customize** → **Connectors**, choose **Add custom connector**, and enter `https://oneuptime.com/mcp`. Claude asks you to sign in to OneUptime the first time it needs your data.

**VS Code with GitHub Copilot**

Add this to your MCP configuration (see [VS Code with GitHub Copilot](#vs-code-with-github-copilot) for where that file lives). VS Code opens OneUptime for you to sign in when you start the server:

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

**Cursor**

```json
{
  "mcpServers": {
    "oneuptime": {
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

Any other client that supports MCP authorization works the same way: give it the URL and it discovers everything else. See [Signing In (OAuth 2.1)](#signing-in-oauth-21) for the protocol details.

You will also find these steps in the dashboard, with your instance's URL already filled in: open any resource (a monitor, an incident, a status page, and so on), expand **Developer** in its side menu and choose **AI Assistants**. The page also suggests prompts that name the resource and its ID, so the assistant finds it straight away. For a resource the MCP server has no tools for yet, such as a workflow, the page shows how an assistant that can run commands can work with it through the REST API instead.

The rest of this section shows the same clients configured with an API key instead.

### Claude Desktop Configuration

Find your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### For OneUptime Cloud

Add the following configuration:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### For Self-Hosted OneUptime

Replace `oneuptime.com` with your OneUptime domain:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### Public Access (No API Key)

To use only public tools (status page information, help), you can connect without an API key:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

This configuration allows access to public status page tools and help resources without requiring authentication. Individual status pages can opt out of MCP access; see [Public Tools](#public-tools-no-authentication-required).

### VS Code with GitHub Copilot

VS Code supports MCP servers natively with GitHub Copilot (version 1.99+). This allows Copilot to access OneUptime data directly.

#### Step 1: Requirements

- VS Code version 1.99 or later
- GitHub Copilot extension installed and activated
- GitHub Copilot Chat enabled

#### Step 2: Open MCP Configuration

1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS)
2. Type "MCP: Open User Configuration" and press Enter
3. This opens or creates the `mcp.json` configuration file

Alternatively, create `.vscode/mcp.json` in your workspace for project-specific configuration.

#### For OneUptime Cloud

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### For Self-Hosted OneUptime

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### Step 3: Start the MCP Server

1. Press `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Type "MCP: List Servers" to see available servers
3. Click on "oneuptime" to start the server
4. When prompted, enter your OneUptime API key

#### Step 4: Use with Copilot Chat

Open GitHub Copilot Chat and use Agent mode (`@workspace` or ask directly):

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### Security Note

The configuration above uses input variables with `"password": true` to securely prompt for your API key rather than storing it in plain text. VS Code will prompt you to confirm trust when starting the MCP server for the first time.

## Available Endpoints

| Endpoint      | Method | Description                                                                                                                    |
| ------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `/mcp`        | POST   | JSON-RPC requests for tool calls and other operations                                                                            |
| `/mcp`        | GET    | Without an SSE `Accept` header: friendly JSON discovery payload. With one: `405` — the stateless server offers no standalone SSE stream (compliant clients proceed without it) |
| `/mcp`        | DELETE | No-op (the server is stateless, so there is no session to terminate)                                                             |
| `/mcp/health` | GET    | Health check endpoint                                                                                                            |
| `/mcp/tools`  | GET    | REST API to list available tools                                                                                                 |

MCP clients that sign in also use the OAuth endpoints below. A client finds them by itself; they are listed here for people writing a client or configuring a proxy.

| Endpoint                                      | Method | Description                                                              |
| --------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `/mcp/.well-known/oauth-protected-resource`   | GET    | Protected resource metadata (RFC 9728). Also at `/.well-known/oauth-protected-resource/mcp` |
| `/.well-known/oauth-authorization-server/mcp` | GET    | Authorization server metadata (RFC 8414). Also at `/mcp/.well-known/oauth-authorization-server` |
| `/mcp/oauth/authorize`                        | GET    | Authorization endpoint: where the client sends your browser to sign in   |
| `/mcp/oauth/token`                            | POST   | Token endpoint: exchanges an authorization code or a refresh token       |
| `/mcp/oauth/register`                         | POST   | Dynamic Client Registration (RFC 7591)                                   |
| `/mcp/oauth/revoke`                           | POST   | Token revocation (RFC 7009)                                              |

## Authentication

The MCP server supports three modes of operation:

### Public Tools (No Authentication Required)

You can connect to the MCP server without an API key to access public tools:

- **`oneuptime_help`**: Get help and guidance about OneUptime MCP capabilities
- **`oneuptime_list_resources`**: List available resources and their operations
- **`get_public_status_page_overview`**: Get overview of a public status page
- **`get_public_status_page_incidents`**: Get incidents from a public status page
- **`get_public_status_page_scheduled_maintenance`**: Get scheduled maintenance events
- **`get_public_status_page_announcements`**: Get announcements from a public status page

Public status page tools accept either a status page ID (UUID) or the status page domain name.

Status page owners can turn off MCP access for an individual status page: switch off **Enable MCP Server** on **Status Pages → your page → AI → MCP**. The switch saves as soon as it is flipped. MCP access is enabled by default. When it is disabled, the four `get_public_status_page_*` tools return an error for that status page; the status page website, its RSS feed, and its public JSON API are unaffected, and the authenticated status page tools (`get_status_page`, `list_status_pages`, and so on) continue to work for the page's own project.

### Signing In (OAuth 2.1)

For all other operations (managing monitors, incidents, teams, etc.), the caller has to be identified. A client that sends no credentials and calls one of these tools is answered with `401 Unauthorized` and a `WWW-Authenticate` header that points at the server's protected resource metadata. That is the signal an MCP client acts on to sign you in; `initialize`, `tools/list`, and the public tools never ask for it.

The server implements the [MCP authorization specification](https://modelcontextprotocol.io/specification/latest/basic/authorization):

- **Flow**: OAuth 2.1 authorization code with PKCE (`S256` only). Access tokens are sent as `Authorization: Bearer`.
- **Discovery**: protected resource metadata (RFC 9728) and authorization server metadata (RFC 8414). The issuer and the resource are both `https://<host>/mcp`.
- **Client identity**: a Client ID Metadata Document (the client ID is an `https` URL the server fetches), or Dynamic Client Registration (RFC 7591). No client has to be registered by an administrator.
- **Scopes**: `mcp:read` for the `get_`, `list_`, and `count_` tools; `mcp:write` adds every tool that changes something, and includes `mcp:read`. A read-only token that calls a write tool is answered with `403` and `error="insufficient_scope"`.
- **Token lifetimes**: an access token lasts one hour. A refresh token lasts 30 days and is replaced every time it is used; using a refresh token that was already replaced ends the connection.
- **Resource indicators** (RFC 8707): a token is issued for `https://<host>/mcp` and is not accepted anywhere else.
- **Revocation** (RFC 7009): revoking either token ends the connection.

### API Key

An agent that runs unattended authenticates with a OneUptime API key in one of the following headers:

- `x-api-key`: Your OneUptime API key
- `Authorization`: Bearer token with your API key (e.g., `Bearer your-api-key-here`)

The `Bearer` scheme is case-insensitive. A request that carries an API key is never asked to sign in.

Tool errors are returned as in-band tool results (`isError: true`) with a `statusCode`, details, and a suggestion — not as MCP protocol errors — so agents can read the failure and self-correct.

On OneUptime Cloud, API keys work only while the project is on **Growth** or above. Below it, every tool that needs the key answers `402` with a message that names the plan, and the agent is told not to retry. Nothing is deleted: the key works again as it is once the project is back on Growth, with nothing to reconnect. A client connected by signing in acts as a person and keeps working ([API keys and SCIM below their plan](/docs/api-reference/api-reference#api-keys-and-scim-below-their-plan)).

## Workflow Tools

Beyond the per-resource CRUD tools, the server ships purpose-built workflow tools for incident and alert response:

- **`acknowledge_incident`** / **`resolve_incident`**: Move an incident to the project's Acknowledged or Resolved state — equivalent to pressing the button in the dashboard
- **`acknowledge_alert`** / **`resolve_alert`**: The same for alerts
- **`add_incident_note`**: Add a note to an incident with `visibility: "internal"` (team only, the default) or `visibility: "public"` (posted to the status page). Markdown is supported
- **`add_alert_note`**: Add an internal note to an alert

A typical loop: `list_incidents` → `acknowledge_incident` → investigate with `list_logs` → `add_incident_note` (public) → `resolve_incident`.

## Who Am I

The **`oneuptime_whoami`** tool returns the project your credentials belong to (ID and name). For a client that signed in, it also returns who it is signed in as and whether it may make changes. It is a useful first call for an agent to orient itself — and since create tools infer `projectId` from the credentials, the agent never needs to pass a project ID.

## Querying Telemetry

Logs, metrics, traces (spans), exceptions, and monitor logs are exposed as read-only `list_` and `count_` tools (`list_logs`, `list_metrics`, `list_spans`, `list_exception_instances`, `list_monitor_logs`, and their `count_` counterparts). Telemetry is ingested via OpenTelemetry, so there are no create tools.

Always query telemetry with a time-range filter. Query fields accept either a direct value or an operator object:

```json
{
  "query": {
    "time": { "_type": "GreaterThan", "value": "2026-07-04T00:00:00.000Z" }
  },
  "sort": { "time": "DESC" },
  "limit": 50
}
```

Supported operators: `EqualTo`, `NotEqual`, `IsNull`, `NotNull`, `EqualToOrNull`, `GreaterThan`, `LessThan`, `GreaterThanOrEqual`, `LessThanOrEqual`, `InBetween`, `Search`, `Includes`. Sort values are `"ASC"` or `"DESC"`.

## Field Selection and Pagination

`get_` and `list_` tools accept an optional `select` array of field names. By default all readable fields are returned except heavy ones (JSON, very-long-text, and HTML columns), which must be requested explicitly in `select`.

List tools paginate with `limit` (default 10, max 100) and `skip`, and every list response reports exactly what it returned:

```json
{
  "returnedCount": 10,
  "totalCount": 42,
  "skip": 0,
  "limit": 10,
  "hasMore": true,
  "data": ["..."]
}
```

## Verification

Verify the MCP server is running:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/health

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/health
```

List available tools:

```bash
# For OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# For Self-Hosted
curl https://your-oneuptime-domain.com/mcp/tools
```

## Usage Examples

### Basic Information Queries

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### Monitor Management

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### Incident Management

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### Team and On-Call

```
"List the teams in this project"
"Show me our on-call policies"
```

### Status Page Management

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### Public Status Page Queries (No API Key Required)

These queries work without authentication, using only the public status page tools:

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### Advanced Operations

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## API Key Permissions

### Read-Only Access

For viewing data only, pick **Viewer** under **Access** when you create the key, or add read permissions to it on its page.

### Full Access

For full access to create, update, and delete resources, pick **Project Admin** under **Access** when you create the key, or add the Project Admin role to it on its page.

### Best Practices

- Use Specific Permissions: Only grant the minimum permissions needed
- Rotate API Keys: Regularly rotate your API keys
- Monitor Usage: Keep track of API key usage in OneUptime
- Separate Keys: Use different API keys for different environments

## Self-Hosted Configuration

Signing in works out of the box on a self-hosted instance. Two settings are available:

| Environment variable | Helm value | What it does |
| --- | --- | --- |
| `DISABLE_MCP_OAUTH` | `mcpOAuth.disabled` | Set to `true` to switch sign-in off. The OAuth endpoints stop being served and the MCP server accepts API keys only. Nothing is deleted; connected clients work again when it is switched back. |
| `DISABLE_MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENTS` | `mcpOAuth.disableClientIdMetadataDocuments` | Set to `true` on an instance that cannot reach the internet. A client may identify itself with a URL that OneUptime fetches; with this set, clients register with your instance directly instead, which needs no outbound request. |

If you run your own reverse proxy in front of OneUptime, forward `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` (and everything under them) to OneUptime along with `/mcp`. The bundled ingress already does.

The server builds every OAuth URL from the `HOST` and `HTTP_PROTOCOL` settings, so they have to match the address people use to reach your instance.

## Troubleshooting

### Sign-In Issues

- **The client never asks me to sign in**: the client may not support MCP authorization, or it may be configured with an API key header, which takes precedence. Remove the header to sign in instead.
- **My project is greyed out on the authorization page**: the page says why next to the project name - the project's plan does not include connecting MCP clients, the project requires SSO and this browser has not signed in to it with SSO, or your team is blocked from connecting clients.
- **A tool is refused with "read-only"**: the client was authorized as read only. Connect it again and choose **Read and write**.
- **The client stopped working**: it was disconnected, was not used for 30 days, you were removed from the project, or the project's SSO sign-in lapsed. Connect it again.
- **Self-hosted - the client reports that it cannot find the authorization server**: check that `HOST` and `HTTP_PROTOCOL` match your public address, and that your proxy forwards the `/.well-known/oauth-*` paths.

### Permission Errors

Ensure your API key - or, for a client that signed in, your own account - has the necessary permissions:

- Read access for listing resources
- Write access for creating/updating resources
- Delete access if you want to remove resources

### Connection Issues

1. Verify your OneUptime URL is correct
2. Check that your API key is valid
3. Ensure your OneUptime instance is accessible
4. Test the health endpoint

### Invalid API Key

- Verify the API key in your OneUptime settings
- Check for extra spaces or characters
- Ensure the key hasn't expired
- On OneUptime Cloud, a `402` that says API keys need the Growth plan means the project is below it: upgrade the project in **Project Settings** > **Billing**, and the same key works again

### Session Errors

If you receive session-related errors:

- The MCP server is stateless — it does not issue or track session IDs, so every request works against any server replica
- Clients that send an `mcp-session-id` header from a previous server version can simply omit it; it is ignored
- Update older MCP client configurations that expect a session ID to be returned by the server

## Available Resources

The MCP server provides tools for the following resources:

**Monitoring**: Monitor, Monitor Status, Monitor Status Event
**Incidents**: Incident, Incident State, Incident Severity, Incident State Timeline, Incident Public Note, Incident Internal Note
**Alerts**: Alert, Alert State, Alert Severity, Alert State Timeline, Alert Internal Note
**Status Pages**: Status Page, Status Page Announcement
**Scheduled Maintenance**: Scheduled Maintenance Event, Scheduled Maintenance State, Scheduled Maintenance State Timeline
**Teams & On-Call**: Team, On-Call Policy
**Labels**: Label
**Telemetry (read-only)**: Log, Metric, Span, Exception Instance, Monitor Log

Each database resource supports Create, Get, List, Update, Delete, and Count via snake_case tools — for example `create_incident`, `get_incident`, `list_incidents`, `update_incident`, `delete_incident`, `count_incidents`. Telemetry resources expose only `list_` and `count_` tools (for example `list_logs`, `count_spans`).
