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
- **Secure Authentication**: Per-request API key authentication with proper error handling
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
- Valid OneUptime API key (only required for authenticated operations - public tools work without it)

## Getting Your API Key

1. Log in to your OneUptime instance
2. Navigate to **Settings** → **API Keys**
3. Click **Create API Key**
4. Provide a name (e.g., "MCP Server")
5. Select the appropriate permissions for your use case
6. Copy the generated API key

API keys are project-scoped: the MCP server infers your project from the key, so create tools never need a `projectId` argument.

> **Warning — never give an AI agent a master key.** A OneUptime *master* API key is also accepted on this header and grants instance-wide admin access. Always use a project API key with the least privilege the agent needs (a read-only key is enough for all `get_`/`list_`/`count_` tools).

## Configuration

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

This configuration allows access to public status page tools and help resources without requiring authentication.

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

## Authentication

The MCP server supports two modes of operation:

### Public Tools (No Authentication Required)

You can connect to the MCP server without an API key to access public tools:

- **`oneuptime_help`**: Get help and guidance about OneUptime MCP capabilities
- **`oneuptime_list_resources`**: List available resources and their operations
- **`get_public_status_page_overview`**: Get overview of a public status page
- **`get_public_status_page_incidents`**: Get incidents from a public status page
- **`get_public_status_page_scheduled_maintenance`**: Get scheduled maintenance events
- **`get_public_status_page_announcements`**: Get announcements from a public status page

Public status page tools accept either a status page ID (UUID) or the status page domain name.

### Authenticated Tools (API Key Required)

For all other operations (managing monitors, incidents, teams, etc.), authentication is required via one of the following headers:

- `x-api-key`: Your OneUptime API key
- `Authorization`: Bearer token with your API key (e.g., `Bearer your-api-key-here`)

The `Bearer` scheme is case-insensitive. Tool errors are returned as in-band tool results (`isError: true`) with a `statusCode`, details, and a suggestion — not as MCP protocol errors — so agents can read the failure and self-correct.

## Workflow Tools

Beyond the per-resource CRUD tools, the server ships purpose-built workflow tools for incident and alert response:

- **`acknowledge_incident`** / **`resolve_incident`**: Move an incident to the project's Acknowledged or Resolved state — equivalent to pressing the button in the dashboard
- **`acknowledge_alert`** / **`resolve_alert`**: The same for alerts
- **`add_incident_note`**: Add a note to an incident with `visibility: "internal"` (team only, the default) or `visibility: "public"` (posted to the status page). Markdown is supported
- **`add_alert_note`**: Add an internal note to an alert

A typical loop: `list_incidents` → `acknowledge_incident` → investigate with `list_logs` → `add_incident_note` (public) → `resolve_incident`.

## Who Am I

The **`oneuptime_whoami`** tool returns the project your API key belongs to (ID and name). It is a useful first call for an agent to orient itself — and since create tools infer `projectId` from the API key, the agent never needs to pass a project ID.

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

For viewing data only, add read permissions for your API key.

### Full Access

For full access to create, update, and delete resources, ensure your API key has Project Admin permissions.

### Best Practices

- Use Specific Permissions: Only grant the minimum permissions needed
- Rotate API Keys: Regularly rotate your API keys
- Monitor Usage: Keep track of API key usage in OneUptime
- Separate Keys: Use different API keys for different environments

## Troubleshooting

### Permission Errors

Ensure your API key has the necessary permissions:

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
