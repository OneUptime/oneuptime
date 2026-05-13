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

# Count incidents by severity
oneuptime incident count --query '{"incidentSeverityId":"<severity-id>"}'
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
name: Check Active Incidents
on:
  schedule:
    - cron: '*/5 * * * *'

jobs:
  health-check:
    runs-on: ubuntu-latest
    steps:
      - name: Install OneUptime CLI
        run: npm install -g @oneuptime/cli

      - name: Check for active incidents
        env:
          ONEUPTIME_API_KEY: ${{ secrets.ONEUPTIME_API_KEY }}
          ONEUPTIME_URL: https://oneuptime.com
        run: |
          INCIDENT_COUNT=$(oneuptime incident count)
          if [ "$INCIDENT_COUNT" -gt 0 ]; then
            echo "WARNING: $INCIDENT_COUNT incidents found"
            exit 1
          fi
```

### Generic CI/CD Script

```bash
#!/bin/bash
set -e

export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="$CI_ONEUPTIME_URL"

# Create a deployment incident and capture the ID
# Note: currentIncidentStateId and incidentSeverityId must reference existing state/severity IDs in your project
INCIDENT_ID=$(oneuptime incident create --data '{
  "title": "Deployment Started",
  "currentIncidentStateId": "'"$INVESTIGATING_STATE_ID"'",
  "incidentSeverityId": "'"$SEVERITY_ID"'",
  "declaredAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}' -o json | jq -r '._id')

# Run deployment steps here...

# Resolve the incident after successful deployment
oneuptime incident update "$INCIDENT_ID" --data '{"currentIncidentStateId":"'"$RESOLVED_STATE_ID"'"}'
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
