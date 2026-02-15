# @oneuptime/cli

Command-line interface for managing OneUptime resources. Supports all MCP-enabled resources with full CRUD operations, named contexts for multiple environments, and flexible output formats.

## Installation

```bash
npm install -g @oneuptime/cli
```

Or run directly within the monorepo:

```bash
cd CLI
npm install
npm start -- --help
```

## Quick Start

```bash
# Authenticate with your OneUptime instance
oneuptime login <api-key> <instance-url>
oneuptime login sk-your-api-key https://oneuptime.com

# List incidents
oneuptime incident list --limit 10

# Get a single resource by ID
oneuptime monitor get 550e8400-e29b-41d4-a716-446655440000

# Create a resource
oneuptime monitor create --data '{"name":"API Health","projectId":"..."}'

# See all available resources
oneuptime resources
```

## Authentication & Contexts

The CLI supports multiple authentication contexts, making it easy to switch between environments.

### Setting Up

```bash
# Create a production context
oneuptime login sk-prod-key https://oneuptime.com --context-name production

# Create a staging context
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

### Switching Contexts

```bash
# List all contexts
oneuptime context list

# Switch active context
oneuptime context use staging

# Show current context
oneuptime context current

# Delete a context
oneuptime context delete old-context
```

### Credential Resolution Order

1. CLI flags: `--api-key` and `--url`
2. Environment variables: `ONEUPTIME_API_KEY` and `ONEUPTIME_URL`
3. Current context from config file (`~/.oneuptime/config.json`)

## Command Reference

### Authentication

| Command | Description |
|---|---|
| `oneuptime login <api-key> <url>` | Authenticate and create a context |
| `oneuptime context list` | List all contexts |
| `oneuptime context use <name>` | Switch active context |
| `oneuptime context current` | Show current context |
| `oneuptime context delete <name>` | Remove a context |
| `oneuptime whoami` | Show current auth info |

### Resource Operations

Every discovered resource supports these subcommands:

| Subcommand | Description |
|---|---|
| `<resource> list [options]` | List resources with filtering and pagination |
| `<resource> get <id>` | Get a single resource by ID |
| `<resource> create --data <json>` | Create a new resource |
| `<resource> update <id> --data <json>` | Update an existing resource |
| `<resource> delete <id>` | Delete a resource |
| `<resource> count [--query <json>]` | Count resources |

### List Options

```
--query <json>    Filter criteria as JSON
--limit <n>       Maximum number of results (default: 10)
--skip <n>        Number of results to skip (default: 0)
--sort <json>     Sort order as JSON (e.g. '{"createdAt": -1}')
-o, --output      Output format: json, table, wide
```

### Utility Commands

| Command | Description |
|---|---|
| `oneuptime version` | Print CLI version |
| `oneuptime whoami` | Show current authentication info |
| `oneuptime resources` | List all available resource types |

## Output Formats

| Format | Description |
|---|---|
| `table` | Formatted ASCII table (default for TTY) |
| `json` | Raw JSON (default when piped) |
| `wide` | Table with all columns shown |

```bash
# Explicit format
oneuptime incident list -o json
oneuptime incident list -o table
oneuptime incident list -o wide

# Pipe to jq (auto-detects JSON)
oneuptime incident list | jq '.[].title'
```

## Scripting Examples

```bash
# List incidents as JSON for scripting
oneuptime incident list -o json --limit 100

# Count resources with filter
oneuptime incident count --query '{"currentIncidentStateId":"..."}'

# Create from a JSON file
oneuptime monitor create --file monitor.json

# Use environment variables in CI/CD
ONEUPTIME_API_KEY=sk-xxx ONEUPTIME_URL=https://oneuptime.com oneuptime incident list
```

## Environment Variables

| Variable | Description |
|---|---|
| `ONEUPTIME_API_KEY` | API key for authentication |
| `ONEUPTIME_URL` | OneUptime instance URL |
| `NO_COLOR` | Disable colored output |

## Configuration File

The CLI stores configuration at `~/.oneuptime/config.json` with `0600` permissions. The file contains:

```json
{
  "currentContext": "production",
  "contexts": {
    "production": {
      "name": "production",
      "apiUrl": "https://oneuptime.com",
      "apiKey": "sk-..."
    }
  },
  "defaults": {
    "output": "table",
    "limit": 10
  }
}
```

## Global Options

| Option | Description |
|---|---|
| `--api-key <key>` | Override API key for this command |
| `--url <url>` | Override instance URL for this command |
| `--context <name>` | Use a specific context for this command |
| `-o, --output <format>` | Output format: json, table, wide |
| `--no-color` | Disable colored output |

## Supported Resources

Run `oneuptime resources` to see all available resource types. Resources are auto-discovered from OneUptime models that have MCP enabled. Currently supported:

- **Incident** - Manage incidents
- **Alert** - Manage alerts
- **Monitor** - Manage monitors
- **Monitor Status** - Manage monitor statuses
- **Incident State** - Manage incident states
- **Status Page** - Manage status pages
- **On-Call Policy** - Manage on-call duty policies
- **Team** - Manage teams
- **Scheduled Maintenance Event** - Manage scheduled maintenance

As more models are MCP-enabled in OneUptime, they automatically become available in the CLI.

## Development

```bash
cd CLI
npm install
npm start -- --help     # Run via ts-node
npm test                # Run tests
npm run compile         # Type-check
```

## License

Apache-2.0
