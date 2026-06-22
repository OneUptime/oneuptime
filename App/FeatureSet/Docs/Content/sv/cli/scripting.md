# Skriptning och CI/CD

OneUptime CLI är utformat för automatisering. Det stöder miljövariabelbaserad autentisering, JSON-utdata för programmatisk tolkning och lämpliga avslutningskoder för pipelineintegration.

## Miljövariabler

Ange dessa miljövariabler för att autentisera utan sparade kontexter:

```bash
export ONEUPTIME_API_KEY=sk-your-api-key
export ONEUPTIME_URL=https://oneuptime.com
```

Dessa har prioritet över sparade kontexter men åsidosätts av CLI-flaggor.

## Avslutningskoder

| Kod | Betydelse                                                          |
| --- | ------------------------------------------------------------------ |
| `0` | Lyckades                                                           |
| `1` | Allmänt fel                                                        |
| `2` | Autentiseringsfel (saknade eller ogiltiga autentiseringsuppgifter) |
| `3` | Hittades inte (404)                                                |

Använd avslutningskoder i skript för att hantera fel:

```bash
if ! oneuptime monitor list > /dev/null 2>&1; then
  echo "Failed to list monitors"
  exit 1
fi
```

## JSON-bearbetning med jq

Använd `-o json` för att producera maskinläsbar utdata:

```bash
# Extrahera alla incidenttitlar
oneuptime incident list -o json | jq '.[].title'

# Hämta ID:t för en nyligen skapad monitor
NEW_ID=$(oneuptime monitor create --data '{"name":"API Health"}' -o json | jq -r '._id')
echo "Created monitor: $NEW_ID"

# Räkna incidenter efter allvarlighetsgrad
oneuptime incident count --query '{"incidentSeverityId":"<severity-id>"}'
```

## Skapa resurser från filer

Använd `--file` för att skapa resurser från JSON-filer, vilket är användbart för versionskontrollerad infrastruktur:

```bash
# monitor.json
# {
#   "name": "API Health Check",
#   "projectId": "your-project-id"
# }

oneuptime monitor create --file monitor.json
```

## Batchoperationer

Bearbeta flera resurser i en loop:

```bash
# Skapa flera monitorer från en JSON-arrayfil
cat monitors.json | jq -r '.[] | @json' | while read monitor; do
  oneuptime monitor create --data "$monitor"
done
```

## CI/CD-pipeline-exempel

### GitHub Actions

```yaml
name: Check Active Incidents
on:
  schedule:
    - cron: "*/5 * * * *"

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

### Generellt CI/CD-skript

```bash
#!/bin/bash
set -e

export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="$CI_ONEUPTIME_URL"

# Skapa en driftsättningsincident och fånga ID:t
# Observera: currentIncidentStateId och incidentSeverityId måste referera till befintliga tillstånds-/allvarlighetsgrades-ID:n i ditt projekt
INCIDENT_ID=$(oneuptime incident create --data '{
  "title": "Deployment Started",
  "currentIncidentStateId": "'"$INVESTIGATING_STATE_ID"'",
  "incidentSeverityId": "'"$SEVERITY_ID"'",
  "declaredAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}' -o json | jq -r '._id')

# Kör driftsättningssteg här...

# Lös incidenten efter lyckad driftsättning
oneuptime incident update "$INCIDENT_ID" --data '{"currentIncidentStateId":"'"$RESOLVED_STATE_ID"'"}'
```

### Docker

```dockerfile
FROM node:26-slim
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

## Använda en specifik kontext i skript

Om du har flera sparade kontexter kan du rikta mot en specifik:

```bash
oneuptime --context production incident list
oneuptime --context staging monitor count
```
