# @oneuptime/cli

Command-line interface for managing OneUptime resources. Supports every MCP-enabled resource (records with full CRUD operations, telemetry with list, create and count), named contexts for multiple environments, and flexible output formats.

## Installation

```bash
npm install -g @oneuptime/cli
oneuptime --version
```

The CLI needs Node.js 22 or later. It has no dependencies, so npm installs it without fetching other packages or building anything.

Or run directly within the monorepo:

```bash
cd packages/CLI
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

| Command                           | Description                       |
| --------------------------------- | --------------------------------- |
| `oneuptime login <api-key> <url>` | Authenticate and create a context |
| `oneuptime context list`          | List all contexts                 |
| `oneuptime context use <name>`    | Switch active context             |
| `oneuptime context current`       | Show current context              |
| `oneuptime context delete <name>` | Remove a context                  |
| `oneuptime whoami`                | Show current auth info            |

### Resource Operations

Every resource supports `list`, `create` and `count`. Records (monitors, incidents, teams and the like) also support `get`, `update` and `delete`; telemetry (logs, metrics, spans and the like) does not:

| Subcommand                             | Description                                  |
| -------------------------------------- | -------------------------------------------- |
| `<resource> list [options]`            | List resources with filtering and pagination |
| `<resource> get <id>`                  | Get a single resource by ID                  |
| `<resource> create --data <json>`      | Create a new resource                        |
| `<resource> update <id> --data <json>` | Update an existing resource                  |
| `<resource> delete <id>`               | Delete a resource                            |
| `<resource> count [--query <json>]`    | Count resources                              |

### List Options

```
--query <json>    Filter criteria as JSON
--limit <n>       Maximum number of results (default: 10)
--skip <n>        Number of results to skip (default: 0)
--sort <json>     Sort order as JSON (e.g. '{"createdAt": -1}')
-o, --output      Output format: json, table, wide
```

### Utility Commands

| Command               | Description                                                     |
| --------------------- | --------------------------------------------------------------- |
| `oneuptime version`   | Print CLI version                                               |
| `oneuptime whoami`    | Show current authentication info                                |
| `oneuptime resources` | List all available resource types                               |
| `oneuptime deploy`    | Record a deploy, or another change, for charts and OneUptime AI |

`oneuptime deploy` writes with a telemetry ingestion key, not an API key:

```bash
ONEUPTIME_URL=https://oneuptime.com \
ONEUPTIME_TELEMETRY_INGESTION_KEY=xxx \
oneuptime deploy --service checkout --service-version 2.3.1 --commit "$GIT_SHA" --environment production
```

## Output Formats

| Format  | Description                             |
| ------- | --------------------------------------- |
| `table` | Formatted ASCII table (default for TTY) |
| `json`  | Raw JSON (default when piped)           |
| `wide`  | Table with all columns shown            |

`-o` applies to `<resource> list`, `get`, `create`, `update` and `count`, as well as `oneuptime resources` and `oneuptime context list`, and can go anywhere on the command line. Any other value is rejected with an error.

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

| Variable                            | Description                                    |
| ----------------------------------- | ---------------------------------------------- |
| `ONEUPTIME_API_KEY`                 | API key for authentication                     |
| `ONEUPTIME_URL`                     | OneUptime instance URL                         |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Telemetry ingestion key for `oneuptime deploy` |
| `NO_COLOR`                          | Disable colored output                         |

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
  }
}
```

Output format and list size are not read from this file. Pass `-o` and `--limit` per command; without `-o`, the CLI prints a table in a terminal and JSON when piped. Older versions wrote a `defaults` block here; it was never read and can be deleted.

## Global Options

| Option                  | Description                             |
| ----------------------- | --------------------------------------- |
| `--api-key <key>`       | Override API key for this command       |
| `--url <url>`           | Override instance URL for this command  |
| `--context <name>`      | Use a specific context for this command |
| `-o, --output <format>` | Output format: json, table, wide        |
| `--no-color`            | Disable colored output                  |

## Supported Resources

Every resource is a command: `oneuptime <resource> <subcommand>`. Resources are discovered from the OneUptime models that have MCP enabled, and `oneuptime resources` lists the ones your version has (`--type database` for records, `--type analytics` for telemetry).

Records take `list`, `get`, `create`, `update`, `delete` and `count`:

| Area                  | Commands                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monitoring            | `monitor`, `monitor-status`, `monitor-status-event`                                                                                                                   |
| Incidents             | `incident`, `incident-state`, `incident-severity`, `incident-state-timeline`, `incident-public-note`, `incident-internal-note`, `incident-alert`, `postmortem-status` |
| Alerts                | `alert`, `alert-state`, `alert-severity`, `alert-state-timeline`, `alert-internal-note`                                                                               |
| Status pages          | `status-page`, `status-page-announcement`                                                                                                                             |
| Scheduled maintenance | `scheduled-maintenance-event`, `scheduled-maintenance-state`, `scheduled-maintenance-state-timeline`                                                                  |
| Teams and on-call     | `team`, `on-call-policy`                                                                                                                                              |
| Security              | `security-case`, `security-case-note`, `security-case-priority`, `security-case-status`, `security-detection`, `security-playbook`                                    |
| Labels                | `label`                                                                                                                                                               |

Telemetry takes `list`, `create` and `count`:

| Area             | Commands                                                     |
| ---------------- | ------------------------------------------------------------ |
| Observability    | `log`, `metric`, `span`, `exception-instance`, `monitor-log` |
| Security         | `security-event`, `threat-intel-indicator`                   |
| Changes and cost | `change-event`, `kubernetes-cost-allocation`                 |

As more models are MCP-enabled in OneUptime, they become available in the CLI as well. The [command reference](https://oneuptime.com/docs/cli/command-reference) describes every command and its options.

## Development

```bash
cd packages/CLI
npm install
npm start -- --help     # Run via ts-node
npm test                # Run tests
npm run compile         # Type-check
npm run build           # Bundle into build/dist/Index.js, the file npm publishes
npm run smoke-test      # Pack, install as a customer does, and run it
```

## License

Apache-2.0
