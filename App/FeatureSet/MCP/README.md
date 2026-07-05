# OneUptime MCP Server

A Model Context Protocol (MCP) server that exposes OneUptime to AI agents. It lets MCP-compatible clients (Claude, VS Code with Copilot, Cursor, and others) manage incidents, alerts, monitors, status pages, on-call, and telemetry through ~155 tools.

## How it works

- **Transport**: Streamable HTTP at `/mcp`. The server is **stateless** — no session IDs are issued or required, so it is safe behind load balancers and multi-replica deployments.
- **Hosted endpoint**: `https://oneuptime.com/mcp`
- **Self-hosted endpoint**: `https://<your-host>/mcp` (served by the App container behind Nginx)
- **Auth**: per-request API key via the `x-api-key` header or `Authorization: Bearer <key>` (scheme is case-insensitive). There is no environment-variable API key — every request carries its own key.

## Connecting a client

### Claude Desktop

Add to `claude_desktop_config.json`:

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

### Claude Code

```bash
claude mcp add --transport http oneuptime https://oneuptime.com/mcp \
  --header "x-api-key: your-api-key-here"
```

### VS Code (GitHub Copilot)

`.vscode/mcp.json` or the user MCP configuration:

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

### Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "oneuptime": {
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

For self-hosted instances, replace `oneuptime.com` with your OneUptime host in any of the above.

## Authentication

Create a **project API key** in OneUptime under **Project Settings → API Keys** and grant it the least privilege the agent needs (read-only keys work for all `get_`/`list_`/`count_` tools). The project is inferred from the key — create tools never need a `projectId` argument.

> **Warning — never give an AI agent a master key.** A OneUptime *master* API key is also accepted on this header and grants instance-wide admin access. Always use a project-scoped API key with least privilege for AI agents.

Public status page tools and `oneuptime_help` / `oneuptime_list_resources` work without any API key.

## Tool catalog

### Database resources — full CRUD

Each of these 22 models gets six tools: `create_`, `get_`, `list_`, `update_`, `delete_`, `count_` (e.g. `create_incident`, `get_incident`, `list_incidents`, `update_incident`, `delete_incident`, `count_incidents`):

Incident, Alert, Monitor, Status Page, Scheduled Maintenance Event, Team, Monitor Status, On-Call Policy, Incident State, Incident Severity, Alert State, Alert Severity, Incident State Timeline, Alert State Timeline, Incident Public Note, Incident Internal Note, Alert Internal Note, Status Page Announcement, Scheduled Maintenance State, Scheduled Maintenance State Timeline, Label, Monitor Status Event.

### Telemetry resources — read-only

Log, Metric, Span, Exception Instance, and Monitor Log get `list_` and `count_` tools only (e.g. `list_logs`, `count_spans`, `list_exception_instances`). There are no create tools for telemetry — ingestion happens via OpenTelemetry.

### Workflow tools

Purpose-built shortcuts for incident/alert response (`App/FeatureSet/MCP/Tools/WorkflowTools.ts`):

- `acknowledge_incident`, `resolve_incident`
- `acknowledge_alert`, `resolve_alert`
- `add_incident_note` (with `visibility: "internal" | "public"` — public notes post to the status page)
- `add_alert_note`
- `oneuptime_whoami` — returns the project (ID and name) the API key belongs to

### Helper and public tools

- `oneuptime_help`, `oneuptime_list_resources`
- No API key needed: `get_public_status_page_overview`, `get_public_status_page_incidents`, `get_public_status_page_scheduled_maintenance`, `get_public_status_page_announcements`

### Annotations and results

All tools carry MCP annotations and titles: `readOnlyHint` on every `get_`/`list_`/`count_` tool and `destructiveHint` on every `delete_` tool, so clients can auto-approve safe calls and confirm destructive ones. Tool results include `structuredContent` alongside the JSON text. Errors come back as in-band tool results (`isError: true`) with `statusCode`, `details`, and a `suggestion` — not as protocol errors.

## Query, sort, select, and pagination

### Queries

Query fields accept a direct value or an operator object:

```json
{
  "query": {
    "title": { "_type": "Search", "value": "database" },
    "createdAt": { "_type": "GreaterThan", "value": "2026-07-01T00:00:00.000Z" }
  }
}
```

Operators: `EqualTo`, `NotEqual`, `IsNull`, `NotNull`, `EqualToOrNull`, `GreaterThan`, `LessThan`, `GreaterThanOrEqual`, `LessThanOrEqual`, `InBetween`, `Search`, `Includes`.

### Sort

```json
{ "sort": { "createdAt": "DESC" } }
```

Values are `"ASC"` or `"DESC"`.

### Select

`get_` and `list_` tools take an optional `select` array of field names. By default all readable fields are returned **except** heavy ones (JSON / VeryLongText / HTML columns), which must be requested explicitly.

### Pagination

`limit` defaults to 10 (max 100); `skip` offsets into the result set. List responses return the full requested page with honest pagination metadata:

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

## Example workflow

A typical incident-response loop an agent can run:

1. `oneuptime_whoami` — confirm which project the key belongs to.
2. `list_incidents` with `{"sort": {"createdAt": "DESC"}, "limit": 5}` — find the active incident.
3. `acknowledge_incident` — take ownership.
4. `list_logs` with a time-range filter (`{"time": {"_type": "GreaterThan", "value": "..."}}`) and `list_exception_instances` — investigate.
5. `add_incident_note` with `"visibility": "public"` — post a status update for customers.
6. `resolve_incident` — close it out.

## HTTP endpoints

| Endpoint      | Method | Behavior                                                                 |
| ------------- | ------ | ------------------------------------------------------------------------ |
| `/mcp`        | POST   | JSON-RPC (tool calls and all MCP operations)                              |
| `/mcp`        | GET    | Without an SSE `Accept` header: friendly JSON discovery payload. With one: `405` (no standalone SSE stream in stateless mode). |
| `/mcp`        | DELETE | No-op (stateless — nothing to terminate)                                  |
| `/mcp/tools`  | GET    | REST listing of available tools                                           |
| `/mcp/health` | GET    | Health check                                                              |

## Self-hosting

The MCP server ships as part of the App container and is served at `/mcp` behind Nginx — no separate deployment is needed. The OneUptime API URL it talks to is derived from the `HOST` and `HTTP_PROTOCOL` environment variables via `Common/Server/EnvironmentConfig` (inherited from the App service's environment). API keys are never configured on the server; clients supply them per request.

## Development

The MCP server lives in `App/FeatureSet/MCP` and is mounted into the App service at startup (`App/Index.ts`). Tests live in `App/FeatureSet/MCP/Tests` and run as part of the App test suite:

```bash
cd App
npm install
npx jest ./FeatureSet/MCP/Tests --runInBand
```

New models are picked up automatically: decorate a database model with `@EnableMCP` (or set `enableMCP` on an analytics model) and the tool generator creates its tools on the next start.

## License

Apache-2.0 - See LICENSE file for details.
