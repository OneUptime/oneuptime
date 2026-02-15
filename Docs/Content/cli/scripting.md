# Scripting and CI/CD

The OneUptime CLI is designed for automation. It supports environment-variable-based authentication, JSON output for programmatic parsing, and appropriate exit codes for pipeline integration.

## Environment Variables

Set these environment variables to authenticate without saved contexts:

```bash
export ONEUPTIME_API_KEY=sk-your-api-key
export ONEUPTIME_URL=https://oneuptime.com
```

These take precedence over saved contexts but are overridden by CLI flags.

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Authentication error (missing or invalid credentials) |
| `3` | Not found (404) |

Use exit codes in scripts to handle errors:

```bash
if ! oneuptime monitor list > /dev/null 2>&1; then
  echo "Failed to list monitors"
  exit 1
fi
```

## JSON Processing with jq

Use `-o json` to produce machine-readable output:

```bash
# Extract all incident titles
oneuptime incident list -o json | jq '.[].title'

# Get the ID of a newly created monitor
NEW_ID=$(oneuptime monitor create --data '{"name":"API Health"}' -o json | jq -r '._id')
echo "Created monitor: $NEW_ID"

# Count incidents matching a filter
oneuptime incident count --query '{"status":"active"}'
```

## Creating Resources from Files

Use `--file` to create resources from JSON files, useful for version-controlled infrastructure:

```bash
# monitor.json
# {
#   "name": "API Health Check",
#   "projectId": "your-project-id"
# }

oneuptime monitor create --file monitor.json
```

## Batch Operations

Process multiple resources in a loop:

```bash
# Create multiple monitors from a JSON array file
cat monitors.json | jq -r '.[] | @json' | while read monitor; do
  oneuptime monitor create --data "$monitor"
done
```

## CI/CD Pipeline Examples

### GitHub Actions

```yaml
name: Check Service Health
on:
  schedule:
    - cron: '*/5 * * * *'

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - name: Install OneUptime CLI
        run: npm install -g @oneuptime/cli

      - name: Check for down monitors
        env:
          ONEUPTIME_API_KEY: ${{ secrets.ONEUPTIME_API_KEY }}
          ONEUPTIME_URL: https://oneuptime.com
        run: |
          DOWN_COUNT=$(oneuptime monitor count --query '{"status":"down"}')
          if [ "$DOWN_COUNT" -gt 0 ]; then
            echo "WARNING: $DOWN_COUNT monitors are down"
            exit 1
          fi
```

### Generic CI/CD Script

```bash
#!/bin/bash
set -e

export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="$CI_ONEUPTIME_URL"

# Create a deployment incident
oneuptime incident create --data '{
  "title": "Deployment Started",
  "status": "investigating"
}'

# Run deployment steps here...

# Resolve the incident after successful deployment
oneuptime incident update "$INCIDENT_ID" --data '{"status":"resolved"}'
```

### Docker

```dockerfile
FROM node:20-slim
RUN npm install -g @oneuptime/cli
ENV ONEUPTIME_API_KEY=""
ENV ONEUPTIME_URL=""
ENTRYPOINT ["oneuptime"]
```

```bash
docker run --rm \
  -e ONEUPTIME_API_KEY=sk-abc123 \
  -e ONEUPTIME_URL=https://oneuptime.com \
  oneuptime-cli incident list
```

## Using a Specific Context in Scripts

If you have multiple contexts saved, target a specific one:

```bash
oneuptime --context production incident list
oneuptime --context staging monitor count
```
