# Resource Operations

The OneUptime CLI provides full CRUD (Create, Read, Update, Delete) operations for all supported resources. Resources are auto-discovered from your OneUptime instance.

## Available Resources

Run the following command to see all available resource types:

```bash
oneuptime resources
```

You can filter by type:

```bash
# Show only database resources
oneuptime resources --type database

# Show only analytics resources
oneuptime resources --type analytics
```

Common resources include:

| Resource | Command |
|----------|---------|
| Incident | `oneuptime incident` |
| Alert | `oneuptime alert` |
| Monitor | `oneuptime monitor` |
| Monitor Status | `oneuptime monitor-status` |
| Incident State | `oneuptime incident-state` |
| Status Page | `oneuptime status-page` |
| On-Call Policy | `oneuptime on-call-policy` |
| Team | `oneuptime team` |
| Scheduled Maintenance Event | `oneuptime scheduled-maintenance-event` |

## List Resources

Retrieve a list of resources with optional filtering, pagination, and sorting.

```bash
oneuptime <resource> list [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--query <json>` | Filter criteria as JSON | None |
| `--limit <n>` | Maximum number of results | `10` |
| `--skip <n>` | Number of results to skip | `0` |
| `--sort <json>` | Sort order as JSON | None |
| `-o, --output <format>` | Output format | `table` |

**Examples:**

```bash
# List the 10 most recent incidents
oneuptime incident list

# Filter incidents by state ID
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# List with pagination
oneuptime incident list --limit 20 --skip 40

# Sort by creation date (descending)
oneuptime incident list --sort '{"createdAt":-1}'

# Output as JSON
oneuptime incident list -o json
```

## Get a Resource

Retrieve a single resource by its ID.

```bash
oneuptime <resource> get <id>
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<id>` | The resource ID (UUID) |

**Examples:**

```bash
# Get a specific incident
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# Get a monitor as JSON
oneuptime monitor get abc-123 -o json
```

## Create a Resource

Create a new resource from inline JSON or a file.

```bash
oneuptime <resource> create [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--data <json>` | Resource data as a JSON object |
| `--file <path>` | Path to a JSON file containing resource data |
| `-o, --output <format>` | Output format |

You must provide either `--data` or `--file`.

**Examples:**

```bash
# Create an incident with inline JSON
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# Create from a JSON file
oneuptime incident create --file incident.json

# Create and output as JSON to capture the ID
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## Update a Resource

Update an existing resource by ID.

```bash
oneuptime <resource> update <id> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<id>` | The resource ID |

**Options:**

| Option | Description |
|--------|-------------|
| `--data <json>` | Fields to update as JSON (required) |
| `-o, --output <format>` | Output format |

**Examples:**

```bash
# Change incident state (e.g., to resolved)
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# Rename a monitor
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## Delete a Resource

Delete a resource by ID.

```bash
oneuptime <resource> delete <id> [--force]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `<id>` | The resource ID |

**Options:**

| Option | Description |
|--------|-------------|
| `--force` | Skip confirmation prompt |

**Examples:**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# Skip confirmation
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## Count Resources

Count resources matching optional filter criteria.

```bash
oneuptime <resource> count [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `--query <json>` | Filter criteria as JSON |

**Examples:**

```bash
# Count all incidents
oneuptime incident count

# Count incidents by state
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# Count monitors
oneuptime monitor count
```

## Analytics Resources

Analytics resources support a limited set of operations compared to database resources:

| Operation | Supported |
|-----------|-----------|
| `list` | Yes |
| `create` | Yes |
| `count` | Yes |
| `get` | No |
| `update` | No |
| `delete` | No |

Use `oneuptime resources --type analytics` to see which analytics resources are available on your instance.
