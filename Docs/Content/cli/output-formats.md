# Output Formats

The OneUptime CLI supports three output formats: **table**, **JSON**, and **wide**. You can set the format with the `-o` or `--output` flag on any command.

## Table (Default)

The default format when running in an interactive terminal. Displays results as an ASCII table with intelligently selected columns.

```bash
oneuptime incident list
```

```
┌──────────────────┬───────────────────────┬────────────┬─────────────────────┐
│ _id              │ title                 │ status     │ createdAt           │
├──────────────────┼───────────────────────┼────────────┼─────────────────────┤
│ abc-123          │ API Outage            │ active     │ 2025-01-15T10:30:00 │
│ def-456          │ Database Slowdown     │ resolved   │ 2025-01-14T08:15:00 │
└──────────────────┴───────────────────────┴────────────┴─────────────────────┘
```

Table format behavior:
- Selects up to 6 columns, prioritizing: `_id`, `name`, `title`, `status`, `createdAt`, `updatedAt`
- Truncates values longer than 60 characters with `...`
- Uses color-coded headers (disable with `--no-color`)

## JSON

Raw JSON output, pretty-printed with 2-space indentation. This is the best format for scripting and piping to other tools.

```bash
oneuptime incident list -o json
```

```json
[
  {
    "_id": "abc-123",
    "title": "API Outage",
    "status": "active",
    "createdAt": "2025-01-15T10:30:00Z"
  }
]
```

JSON format is automatically used when the output is piped to another command (non-TTY mode):

```bash
# JSON is used automatically when piping
oneuptime incident list | jq '.[].title'
```

## Wide

Displays all columns without truncation. Useful for detailed inspection but may produce very wide output.

```bash
oneuptime incident list -o wide
```

## Disabling Color

Color output can be disabled in several ways:

```bash
# Using the --no-color flag
oneuptime --no-color incident list

# Using the NO_COLOR environment variable
NO_COLOR=1 oneuptime incident list
```

## Special Output Cases

| Scenario | Output |
|----------|--------|
| Empty result set | `"No results found."` |
| No data returned | `"No data returned."` |
| Single object (e.g., `get`) | Key-value table format |
| `count` command | Plain numeric value |
