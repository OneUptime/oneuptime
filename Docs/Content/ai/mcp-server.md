# MCP Server

The OneUptime Model Context Protocol (MCP) Server provides LLMs with direct access to your OneUptime instance, enabling AI-powered monitoring, incident management, and observability operations.

## What is the OneUptime MCP Server?

The OneUptime MCP Server is a bridge between Large Language Models (LLMs) and your OneUptime instance. It implements the Model Context Protocol (MCP), allowing AI assistants like Claude to interact directly with your monitoring infrastructure.

## How It Works

The MCP server is hosted alongside your OneUptime instance and accessible via the Streamable HTTP transport. No local installation is required.

**Cloud Users**: `https://oneuptime.com/mcp`
**Self-Hosted Users**: `https://your-oneuptime-domain.com/mcp`

## Key Features

- **Complete API Coverage**: Access to 711 OneUptime API endpoints
- **126 Resource Types**: Manage all OneUptime resources including monitors, incidents, teams, probes, and more
- **Real-time Operations**: Create, read, update, and delete resources in real-time
- **Type-safe Interface**: Fully typed with comprehensive input validation
- **Secure Authentication**: API key-based authentication with proper error handling
- **Easy Integration**: Works with Claude Desktop and other MCP-compatible clients
- **Session Management**: Built-in session handling with automatic reconnection support

## What You Can Do

With the OneUptime MCP Server, AI assistants can help you:

- **Monitor Management**: Create and configure monitors, check their status, and manage monitor groups
- **Incident Response**: Create incidents, add notes, assign team members, and track resolution
- **Team Operations**: Manage teams, permissions, and on-call schedules
- **Status Pages**: Update status pages, create announcements, and manage subscribers
- **Alerting**: Configure alert rules, manage escalation policies, and check notification logs
- **Probes**: Deploy and manage monitoring probes across different locations
- **Reports & Analytics**: Generate reports and analyze monitoring data

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

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | GET | Server-sent events stream for server-to-client notifications |
| `/mcp` | POST | JSON-RPC requests for tool calls and other operations |
| `/mcp` | DELETE | Session cleanup and termination |
| `/mcp/health` | GET | Health check endpoint |
| `/mcp/tools` | GET | REST API to list available tools |

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
- **`resolve_status_page_domain`**: Resolve a domain to its status page ID

Public status page tools accept either a status page ID (UUID) or the status page domain name.

### Authenticated Tools (API Key Required)

For all other operations (managing monitors, incidents, teams, etc.), authentication is required via one of the following headers:

- `x-api-key`: Your OneUptime API key
- `Authorization`: Bearer token with your API key (e.g., `Bearer your-api-key-here`)

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
"Who are the members of the infrastructure team?"
"Who's currently on call for the infrastructure team?"
"Show me the on-call schedule for this week"
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
- The MCP server uses the `mcp-session-id` header to track sessions
- Ensure your client properly handles the session ID returned by the server
- Sessions are automatically cleaned up when connections close

## Available Resources

The MCP server provides access to 126 resource types including:

**Monitoring**: Monitor, MonitorStatus, MonitorGroup, Probe
**Incidents**: Incident, IncidentState, IncidentNote, IncidentTemplate
**Alerts**: Alert, AlertState, AlertSeverity
**Status Pages**: StatusPage, StatusPageAnnouncement, StatusPageSubscriber
**On-Call**: On-CallPolicy, EscalationRule, On-CallSchedule
**Teams**: Team, TeamMember, TeamPermission
**Telemetry**: TelemetryService, Log, Span, Metric
**Workflows**: Workflow, WorkflowVariable, WorkflowLog

Each resource supports standard operations: List, Count, Get, Create, Update, and Delete.
