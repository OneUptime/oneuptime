# Command Reference

Every command of the `oneuptime` CLI, with its arguments, options and defaults. Add `--help` to any command to see the same in your terminal.

:::cards
- [Global options](#global-options): The options every command takes.
- [Login and contexts](#login-and-contexts): login and the context commands.
- [Resource commands](#resource-commands): The operations, fields and actions of every resource.
- [Other commands](#other-commands): deploy, dbt upload, data-checks apply, whoami, resources, version and help.
:::

## The commands

```mermaid title="The commands of the oneuptime CLI"
flowchart LR
    O["oneuptime"] --> L["login"]
    O --> C["context"]
    C --> C1["list<br/>use<br/>current<br/>delete"]
    O --> R["incident, monitor<br/>and every resource"]
    R --> R1["list<br/>get<br/>create<br/>update<br/>delete<br/>count<br/>fields"]
    R --> R2["acknowledge<br/>resolve<br/>start<br/>end<br/>add-note"]
    O --> D["dbt"]
    D --> D1["upload"]
    O --> U["deploy<br/>whoami<br/>resources<br/>version<br/>help"]
```

## Global options

| Option | What it does | Default |
| --- | --- | --- |
| `--api-key <key>` | The API key for this command | `ONEUPTIME_API_KEY`, then the context's key |
| `--url <url>` | Your OneUptime's address for this command | `ONEUPTIME_URL`, then the context's URL |
| `--context <name>` | The saved context to use for this command | The current context |
| `-o, --output <format>` | `json`, `table` or `wide` | `table` in a terminal, `json` in a pipe |
| `--json` | The same as `-o json` | |
| `--no-color` | Prints without colors | Colors, unless `NO_COLOR` is set |
| `-V, --version` | Prints the CLI's version | |
| `-h, --help` | Shows the help of a command | |

The options go before or after the command: `oneuptime --context staging incident list` and `oneuptime incident list --context staging` do the same.

Every command takes `-o` and `--json`, so the tables below leave them out. A command whose answer is a sentence, such as `delete`, prints the sentence unless `-o json` or `--json` asks for JSON: see [Output Formats](/docs/cli/output-formats#json).

## Login and contexts

### `oneuptime login`

Saves an API key and an address as a context, and makes it the current one. See [Log in](/docs/cli/authentication#log-in).

```bash
oneuptime login <api-key> <instance-url> [--context-name <name>]
```

| Argument or option | Required | What it is | Default |
| --- | --- | --- | --- |
| `<api-key>` | Yes | An API key of your project | |
| `<instance-url>` | Yes | Your OneUptime's address, such as `https://oneuptime.com` | |
| `--context-name <name>` | No | The name to save the context under | `default` |

### `oneuptime context list`

Lists the saved contexts; `*` marks the current one. API keys are never listed: JSON gives each context's `name`, `apiUrl` and `isCurrent`.

```bash
oneuptime context list
```

### `oneuptime context use`

Makes a saved context the current one.

```bash
oneuptime context use <name>
```

| Argument | Required | What it is |
| --- | --- | --- |
| `<name>` | Yes | The name of a saved context |

### `oneuptime context current`

Shows the current context's name and URL, and its API key with all but the first four and last four characters hidden.

```bash
oneuptime context current
```

### `oneuptime context delete`

Deletes a saved context. If it was the current one, the first context left becomes current.

```bash
oneuptime context delete <name>
```

| Argument | Required | What it is |
| --- | --- | --- |
| `<name>` | Yes | The name of a saved context |

## Resource commands

`<resource>` is the command of a kind of record, from the [Resources](#resources) table, such as `incident` or `monitor`. A resource has the operations the API takes for it, most of them all six, and `oneuptime <resource> --help` lists its own. See [Resource Operations](/docs/cli/resource-operations) for examples.

### `oneuptime <resource> list`

Lists records, newest first. Labels are listed by name instead, numbered labels first (`2. Team` before `10. Owner`).

```bash
oneuptime <resource> list [--query <json>] [--limit <n>] [--skip <n>] [--sort <json>] [--fields <names>] [--all]
```

| Option | What it does | Default |
| --- | --- | --- |
| `--query <json>` | A filter, as JSON | Every record the key may read |
| `--limit <n>` | The most records to return, up to 10,000 | `10` |
| `--skip <n>` | How many records to pass over first | `0` |
| `--sort <json>` | The order, as JSON: `{"<field>":"ASC"}` or `{"<field>":"DESC"}` | Newest first |
| `--fields <names>` | The fields to return, separated by commas; a field of a related record after a dot, as in `currentIncidentState.name` | Every field the key may read |
| `--all` | Every record that matches, 100 at a time, up to 100,000, in place of `--limit` and `--skip`. Records only: telemetry has no `--all` | |

### `oneuptime <resource> get`

Reads one record.

```bash
oneuptime <resource> get <id> [--fields <names>]
```

| Argument or option | Required | What it is |
| --- | --- | --- |
| `<id>` | Yes | The record's ID, a UUID |
| `--fields <names>` | No | The fields to return, separated by commas. Default: every field the key may read |

### `oneuptime <resource> create`

Creates a record and prints it.

```bash
oneuptime <resource> create [--<field> <value>]... [--data <json>] [--file <path>]
```

| Option | Required | What it is |
| --- | --- | --- |
| `--<field> <value>` | The fields a create must give | A field's value: `--title <text>`, `--incident-severity-id <id>`, `--labels <ids>`. `oneuptime <resource> create --help` lists them. Records only |
| `--data <json>` | No | The record, as JSON |
| `--file <path>` | No | A JSON file holding the record. Given with `--data`, the file is used |

The flags go on top of `--data` or `--file`. A field that names a person by user ID has a flag that names them by email address too: `--user-email` beside `--user-id`.

### `oneuptime <resource> update`

Changes the fields you give.

```bash
oneuptime <resource> update <id> [--<field> <value>]... [--data <json>] [--file <path>]
```

| Argument or option | Required | What it is |
| --- | --- | --- |
| `<id>` | Yes | The record's ID |
| `--<field> <value>` | No | A field to change: `oneuptime <resource> update --help` lists them. Records only |
| `--data <json>` | No | The fields to change, as JSON |
| `--file <path>` | No | A JSON file holding the fields to change. Given with `--data`, the file is used |

### `oneuptime <resource> delete`

Deletes a record at once, without asking.

```bash
oneuptime <resource> delete <id> [--force]
```

| Argument or option | Required | What it is |
| --- | --- | --- |
| `<id>` | Yes | The record's ID |
| `--force` | No | Accepted and changes nothing: `delete` never asks to confirm |

### `oneuptime <resource> count`

Counts records, and prints the number.

```bash
oneuptime <resource> count [--query <json>]
```

| Option | Required | What it is |
| --- | --- | --- |
| `--query <json>` | No | A filter, as JSON. Without one, every record the key may read |

### `oneuptime <resource> fields`

Lists the resource's fields: what each is for, its type, whether a create must give it, and the flag that sets it. It reads them from the CLI itself, with no API key and no request.

```bash
oneuptime <resource> fields
```

### `oneuptime <resource> acknowledge`

Moves an incident, an alert or an episode of either to your project's acknowledged state, as the dashboard's button does. A record that is acknowledged already, or past it, is left as it is.

```bash
oneuptime <resource> acknowledge <id>
```

| Argument | Required | What it is |
| --- | --- | --- |
| `<id>` | Yes | The record's ID |

### `oneuptime <resource> resolve`

Moves an incident, an alert or an episode of either to your project's resolved state.

```bash
oneuptime <resource> resolve <id>
```

| Argument | Required | What it is |
| --- | --- | --- |
| `<id>` | Yes | The record's ID |

### `oneuptime <resource> start`

Moves a maintenance event to your project's ongoing state.

```bash
oneuptime <resource> start <id>
```

| Argument | Required | What it is |
| --- | --- | --- |
| `<id>` | Yes | The event's ID |

### `oneuptime <resource> end`

Moves a maintenance event to your project's ended state.

```bash
oneuptime <resource> end <id>
```

| Argument | Required | What it is |
| --- | --- | --- |
| `<id>` | Yes | The event's ID |

### `oneuptime <resource> add-note`

Adds a note to an incident, an alert, an episode of either or a maintenance event.

```bash
oneuptime <resource> add-note <id> --note <markdown> [--public]
```

| Argument or option | Required | What it is |
| --- | --- | --- |
| `<id>` | Yes | The record's ID |
| `--note <markdown>` | Yes | The note, in Markdown |
| `--public` | No | Posts it on the record's status pages, where its subscribers are told. Incidents, their episodes and scheduled maintenance only |

### Resources

Every resource of the OneUptime API is a command, with the operations the API takes for it, `fields`, and the actions of the records that have them:

{{CLI_RESOURCE_COMMANDS}}

The CLI is released with OneUptime, so `oneuptime resources` lists the commands of the version you installed.

### API requests

Each operation is one request to the API, with the key in the `APIKey` header. `<path>` is the resource's API path, from `oneuptime resources`: `/incident` for `incident`, `/on-call-duty-policy` for `on-call-policy`.

| Operation | Request | Body |
| --- | --- | --- |
| `list` | `POST /api/<path>/get-list` | `query`, `select`, `skip`, `limit` and `sort` |
| `get` | `POST /api/<path>/<id>/get-item` | `select` |
| `create` | `POST /api/<path>` | `{"data": ...}` |
| `update` | `PUT /api/<path>/<id>/` | `{"data": ...}` |
| `delete` | `DELETE /api/<path>/<id>/` | None |
| `count` | `POST /api/<path>/count` | `query` |

An action reads your project's states and the record, then creates a row of the record's state timeline, as the dashboard's button does: `acknowledge` on an incident creates an `incident-state-timeline`. `add-note` creates an `incident-internal-note`, or with `--public` an `incident-public-note`. An email flag first lists the project's team members with that address. When OneUptime refuses a field the key may not read, a list or a get asks again without it.

## Other commands

### `oneuptime deploy`

Records a deploy, or another change, from a pipeline: it is drawn on the service's charts and read by OneUptime AI when it investigates an incident. It writes with a telemetry ingestion key, not an API key. See [Deploys and changes](/docs/telemetry/change-events).

```bash
oneuptime deploy [--service <name>] [--service-version <version>] [--previous-version <version>] [--commit <sha>] [--repository <url>] [--branch <name>] [--pull-request <number>] [--environment <name>] [--title <title>] [--description <text>] [--type <type>] [--time <time>] [--attribute <key=value...>] [--ingestion-key <key>]
```

| Option | Required | What it is | Default |
| --- | --- | --- | --- |
| `--service <name>` | No | The service that was deployed | A project-wide change |
| `--service-version <version>` | No | The version deployed | |
| `--previous-version <version>` | No | The version it replaced | |
| `--commit <sha>` | No | The commit deployed | |
| `--repository <url>` | No | The repository the commit is in | |
| `--branch <name>` | No | The branch deployed | |
| `--pull-request <number>` | No | The pull request deployed | |
| `--environment <name>` | No | The environment deployed to | |
| `--title <title>` | No | The change's title; another kind than a deploy needs one | `Deploy <version>` |
| `--description <text>` | No | Details of the change | |
| `--type <type>` | No | The kind of change, such as `config-change` or `rollback` | `deployment` |
| `--time <time>` | No | When it happened, such as `2026-10-19T10:00:00Z` | Now |
| `--attribute <key=value...>` | No | More attributes, as `key=value`, one or more | |
| `--ingestion-key <key>` | No | A telemetry ingestion key of the project | `ONEUPTIME_TELEMETRY_INGESTION_KEY` |

### `oneuptime dbt upload`

Sends a dbt project's artifacts after a build, from CI or a dbt Cloud job, to Data Observability. Its models show on the tables they build, with their lineage, its tests show beside OneUptime's checks and can alert, and each build is a run of the project's pipeline. It reads `manifest.json` and `run_results.json` from dbt's target folder, sends only what Data Observability reads of them, and writes with a telemetry ingestion key, not an API key. The Documentation page of Data Observability, in your dashboard, shows it in a CI job.

```bash
oneuptime dbt upload [--target-path <dir>] [--manifest <file>] [--run-results <file>] [--project <name>] [--ingestion-key <key>]
```

| Option | Required | What it is | Default |
| --- | --- | --- | --- |
| `--target-path <dir>` | No | The folder dbt wrote its artifacts to | `target` |
| `--manifest <file>` | No | The manifest to send | `manifest.json` in the target folder |
| `--run-results <file>` | No | The run results to send | `run_results.json` in the target folder |
| `--project <name>` | No | The dbt project's name, needed only when no manifest is sent | The manifest's project |
| `--ingestion-key <key>` | No | A telemetry ingestion key of the project | `ONEUPTIME_TELEMETRY_INGESTION_KEY` |

### `oneuptime data-checks apply`

Makes the project's data checks match a YAML file, so they are kept in a repository and reviewed like code. A mistake anywhere in the file applies nothing and exits with an error. The file's format is in [Checks and Reconciliations](/docs/data-observability/checks).

```bash
oneuptime data-checks apply <file> [--dry-run] [--prune]
```

| Option | Required | What it is | Default |
| --- | --- | --- | --- |
| `--dry-run` | No | Says what would change, and changes nothing | Off |
| `--prune` | No | Deletes checks an earlier apply made that the file no longer names | Off |

### `oneuptime whoami`

Shows the URL and the API key the next command will use, with the key masked, and the context they come from. Without `--check`, it does not call OneUptime. See [Check what the CLI will use](/docs/cli/authentication#check-what-the-cli-will-use).

```bash
oneuptime whoami [--check]
```

| Option | Required | What it is |
| --- | --- | --- |
| `--check` | No | Asks OneUptime whether it takes the key, and shows the key's project, your OneUptime's version and the CLI's |

### `oneuptime resources`

Lists every kind of record the CLI has a command for: its command, singular and plural names, type and API path, and the total. JSON gives each one's `name`, `singularName`, `pluralName`, `modelType`, `apiPath`, `operations` and `actions`.

```bash
oneuptime resources [--type <type>]
```

| Option | Required | What it is | Default |
| --- | --- | --- | --- |
| `--type <type>` | No | `database` for records, `analytics` for telemetry | Both |

### `oneuptime version`

Prints the CLI's version, as `oneuptime --version` does.

```bash
oneuptime version
```

### `oneuptime help`

Shows the help of the CLI, or of a command.

```bash
oneuptime help [command]
```

## Environment variables

| Variable | What it does |
| --- | --- |
| `ONEUPTIME_API_KEY` | The API key, when no `--api-key` flag gives one |
| `ONEUPTIME_URL` | Your OneUptime's address, when no `--url` flag gives one |
| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | The telemetry ingestion key `oneuptime deploy` writes with, when no `--ingestion-key` flag gives one |
| `NO_COLOR` | Set to any value, turns colors off |

## Files

| File | What it holds |
| --- | --- |
| `~/.oneuptime/config.json` | The saved contexts, their API keys, and the current context |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | It worked |
| `1` | It failed: OneUptime refused the request, or the command was wrong |
| `2` | No usable API key: none found, invalid, or below its plan |
| `3` | Not found: OneUptime answered `404` |

See [Exit codes](/docs/cli/scripting#exit-codes) for examples.

## Next steps

:::cards
- [CLI Overview](/docs/cli/index): Install the CLI and run your first commands.
- [Resource Operations](/docs/cli/resource-operations): Examples of every operation.
- [Scripting & CI/CD](/docs/cli/scripting): The CLI in scripts and pipelines.
:::
