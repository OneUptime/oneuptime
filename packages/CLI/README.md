# @oneuptime/cli

Command-line interface for OneUptime. Every resource of the OneUptime REST API is a command, with a subcommand for every request the API takes for it: list, get, create, update, delete and count, the fields a resource has, and the dashboard's buttons such as acknowledge and resolve. People at a terminal get tables, and scripts and AI agents get JSON with `--json`.

## Installation

Every OneUptime serves an installer for the CLI at `/install/cli`. It asks your OneUptime for its version, and installs the CLI of the same version with npm:

```bash
curl -fsSL https://oneuptime.com/install/cli -o install.sh
ONEUPTIME_URL=https://oneuptime.com bash install.sh
```

On a self-hosted OneUptime, download it from your OneUptime's address, and give that address as `ONEUPTIME_URL`. Or install the CLI with npm yourself:

```bash
npm install -g @oneuptime/cli
oneuptime --version
```

The CLI needs Node.js 22 or later. It has no dependencies, so npm installs it without fetching other packages or building anything.

The CLI is released with OneUptime and has the same version number. On a self-hosted OneUptime, install the CLI of your OneUptime's version, so its commands match the records your server has:

```bash
npm install -g @oneuptime/cli@<your-oneuptime-version>
```

> **Warning:** CLI versions before 14.0.64 stop as soon as they start, with an error such as `Cannot find module 'Common/Models/DatabaseModels/Index'`. Install 14.0.64 or later with `npm install -g @oneuptime/cli@latest`. On a self-hosted OneUptime older than 14.0.64, [upgrade OneUptime](https://oneuptime.com/docs/installation/upgrading#how-to-upgrade) first, then install the CLI of the version you upgraded to.

## Quick Start

```bash
# Authenticate with your OneUptime instance
oneuptime login <api-key> <instance-url>
oneuptime login sk-your-api-key https://oneuptime.com

# Check that OneUptime takes the key, and see its project
oneuptime whoami --check

# List incidents
oneuptime incident list --limit 10

# Get a single resource by ID
oneuptime monitor get 550e8400-e29b-41d4-a716-446655440000

# Create a resource, a flag per field
oneuptime monitor create --name "API Health" --monitor-type Manual

# The fields a resource has, and the flags that set them
oneuptime monitor fields

# Acknowledge an incident, as the dashboard's button does
oneuptime incident acknowledge 550e8400-e29b-41d4-a716-446655440000

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

`oneuptime whoami` shows what the next command will use without asking OneUptime. `oneuptime whoami --check` asks OneUptime: it shows the key's project, OneUptime's version and the CLI's, says what to install when the two differ, and exits with `2` when OneUptime refuses the key.

## Command Reference

### Authentication

| Command                           | Description                                              |
| --------------------------------- | -------------------------------------------------------- |
| `oneuptime login <api-key> <url>` | Authenticate and create a context                        |
| `oneuptime context list`          | List all contexts                                        |
| `oneuptime context use <name>`    | Switch active context                                    |
| `oneuptime context current`       | Show current context                                     |
| `oneuptime context delete <name>` | Remove a context                                         |
| `oneuptime whoami`                | Show current auth info; `--check` asks OneUptime as well |

### Resource Operations

A resource takes the subcommands the API takes for it: `list`, `get` and `count` to read it, and `create`, `update` and `delete` to change it. Most resources take all six. The ones OneUptime writes itself, such as an email log, are read only. `oneuptime <resource> --help` lists the subcommands a resource has:

| Subcommand                                   | Description                                                  |
| -------------------------------------------- | ------------------------------------------------------------ |
| `<resource> list [options]`                  | List resources with filtering and pagination                 |
| `<resource> get <id>`                        | Get a single resource by ID                                  |
| `<resource> create [--<field> <value>]`      | Create a new resource, a flag per field                      |
| `<resource> update <id> [--<field> <value>]` | Update an existing resource                                  |
| `<resource> delete <id>`                     | Delete a resource                                            |
| `<resource> count [--query <json>]`          | Count resources                                              |
| `<resource> fields`                          | List its fields: what each is for, and the flag that sets it |
| `<resource> acknowledge <id>`                | Acknowledge an incident, an alert, or an episode of either   |
| `<resource> resolve <id>`                    | Resolve one                                                  |
| `<resource> start <id>`                      | Start a maintenance event (`scheduled-maintenance-event`)    |
| `<resource> end <id>`                        | End one                                                      |
| `<resource> add-note <id> --note <markdown>` | Add a note to any of those, `--public` for its status pages  |

### List Options

```
--query <json>    Filter criteria as JSON
--limit <n>       Maximum number of results (default: 10)
--skip <n>        Number of results to skip (default: 0)
--sort <json>     Sort order as JSON (e.g. '{"createdAt": "DESC"}')
--fields <names>  The fields to return, separated by commas
--all             Every record that matches, page after page (records only)
-o, --output      Output format: json, table, wide
--json            The same as -o json
```

### Create and Update

`create` and `update` take a flag for each field the API takes: `--title <text>`, `--incident-severity-id <id>`, `--labels <ids>` (IDs separated by commas), `--is-visible-on-status-page [true|false]` (true when given alone), `--monitor-steps <json>`. `oneuptime <resource> create --help` lists them, and `oneuptime <resource> fields` says what each field is for. `--data <json>` and `--file <path>` give the fields as JSON instead, and flags go on top of them.

Where a field names a person by user ID, a second flag names them by email address: `--user-email` beside `--user-id`, `--owner-user-emails` beside `--owner-users`. The CLI finds the person among the members and invitees of the API key's project. A team member named by an address nobody in the project has is invited, as the dashboard's Invite does:

```bash
oneuptime incident-user-owner create --incident-id <incident-id> --user-email alice@example.com
oneuptime team-member create --team-id <team-id> --user-email new-hire@example.com
```

### Utility Commands

| Command                | Description                                                        |
| ---------------------- | ------------------------------------------------------------------ |
| `oneuptime version`    | Print CLI version                                                  |
| `oneuptime whoami`     | Show current authentication info                                   |
| `oneuptime resources`  | List all available resource types                                  |
| `oneuptime deploy`     | Record a deploy, or another change, for charts and OneUptime AI    |
| `oneuptime dbt upload` | Send a dbt project's artifacts to Data Observability after a build |

`oneuptime deploy` writes with a telemetry ingestion key, not an API key:

```bash
ONEUPTIME_URL=https://oneuptime.com \
ONEUPTIME_TELEMETRY_INGESTION_KEY=xxx \
oneuptime deploy --service checkout --service-version 2.3.1 --commit "$GIT_SHA" --environment production
```

`oneuptime dbt upload` sends a dbt project's `manifest.json` and `run_results.json` after a build, with the same key:

```bash
ONEUPTIME_URL=https://oneuptime.com \
ONEUPTIME_TELEMETRY_INGESTION_KEY=xxx \
oneuptime dbt upload --target-path target
```

## Output Formats

| Format  | Description                             |
| ------- | --------------------------------------- |
| `table` | Formatted ASCII table (default for TTY) |
| `json`  | Raw JSON (default when piped)           |
| `wide`  | Table with all columns shown            |

Every command takes `-o` and `--json`, anywhere on the command line. `--json` is the same as `-o json`. Any other value of `-o` is rejected with an error. A command whose answer is a sentence, such as `delete` or `acknowledge`, prints the sentence unless JSON is asked for, and with JSON asked for, an error is one JSON object on standard error.

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
oneuptime incident list --json --limit 100

# Count resources with filter
oneuptime incident count --query '{"currentIncidentStateId":"..."}'

# Create from a JSON file
oneuptime monitor create --file monitor.json

# Use environment variables in CI/CD
ONEUPTIME_API_KEY=sk-xxx ONEUPTIME_URL=https://oneuptime.com oneuptime incident list
```

Every command exits with `0` when it worked, `1` when OneUptime refused it or a value is wrong, `2` when the API key is missing or refused, and `3` when the record is not there.

## AI Agents

An agent that runs commands can work with OneUptime through the CLI instead of the MCP server. Give it the key in `ONEUPTIME_API_KEY`, and have it add `--json` to every command. `oneuptime resources --json` lists what it can work with, `oneuptime <resource> fields --json` a resource's fields and flags, and `oneuptime <resource> --help` its subcommands.

## Environment Variables

| Variable                            | Description                                                               |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `ONEUPTIME_API_KEY`                 | API key for authentication                                                |
| `ONEUPTIME_URL`                     | OneUptime instance URL                                                    |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Telemetry ingestion key for `oneuptime deploy` and `oneuptime dbt upload` |
| `NO_COLOR`                          | Disable colored output                                                    |

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
| `--json`                | The same as `-o json`                   |
| `--no-color`            | Disable colored output                  |

## Supported Resources

Every resource of the OneUptime REST API is a command: `oneuptime <resource> <subcommand>`, 450 and more of them. They are worked out from OneUptime's models by the rule the API documents itself by, so a resource OneUptime gains is a command of the CLI of the same version. `oneuptime resources` lists the ones your version has (`--type database` for records, `--type analytics` for telemetry).

Some of them, by area:

| Area                  | Commands                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Monitoring            | `monitor`, `monitor-status`, `monitor-group`, `probe`                                                                   |
| Incidents             | `incident`, `incident-severity`, `incident-state`, `incident-internal-note`, `incident-public-note`, `incident-episode` |
| Alerts                | `alert`, `alert-severity`, `alert-state`, `alert-internal-note`, `alert-episode`                                        |
| Status pages          | `status-page`, `status-page-announcement`, `status-page-subscriber`                                                     |
| Scheduled maintenance | `scheduled-maintenance-event`, `scheduled-maintenance-state`                                                            |
| On-call               | `on-call-policy`, `on-call-policy-schedule`, `escalation-rule`                                                          |
| Teams and access      | `team`, `team-member`, `label`, `api-key`                                                                               |
| Infrastructure        | `host`, `kubernetes-cluster`, `network-device`, `service`                                                               |
| Cloud                 | `cloud-account`, `cloud-resource`, `cloud-budget`                                                                       |
| Automation            | `workflow`, `runbook`, `dashboard`                                                                                      |
| Telemetry             | `log`, `metric`, `span`, `exception-instance`, `monitor-log`, `audit-log`                                               |

The [command reference](https://oneuptime.com/docs/cli/command-reference) describes every command and its options.

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

The tests never touch your own `~/.oneuptime`: each test file runs in a throwaway home of its own (`Tests/Setup`), and a run fails if your `~/.oneuptime` changed while it ran.

## License

Apache-2.0
