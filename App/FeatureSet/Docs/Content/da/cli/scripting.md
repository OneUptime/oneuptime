# Scripting og CI/CD

OneUptime CLI er designet til automatisering. Den understøtter miljøvariabelbaseret autentificering, JSON-output til programmatisk parsing og passende exit-koder til pipeline-integration.

## Miljøvariabler

Sæt disse miljøvariabler for at autentificere uden gemte kontekster:

```bash
export ONEUPTIME_API_KEY=sk-your-api-key
export ONEUPTIME_URL=https://oneuptime.com
```

Disse har forrang over gemte kontekster, men tilsidesættes af CLI-flag.

## Exit-koder

| Kode | Betydning |
|------|---------|
| `0` | Succes |
| `1` | Generel fejl |
| `2` | Autentificeringsfejl (manglende eller ugyldige legitimationsoplysninger) |
| `3` | Ikke fundet (404) |

Brug exit-koder i scripts til at håndtere fejl:

```bash
if ! oneuptime monitor list > /dev/null 2>&1; then
  echo "Failed to list monitors"
  exit 1
fi
```

## JSON-behandling med jq

Brug `-o json` til at producere maskinlæsbart output:

```bash
# Udtræk alle incidenttitler
oneuptime incident list -o json | jq '.[].title'

# Hent ID'et for en nyoprettet monitor
NEW_ID=$(oneuptime monitor create --data '{"name":"API Health"}' -o json | jq -r '._id')
echo "Created monitor: $NEW_ID"

# Tæl incidents efter alvorlighed
oneuptime incident count --query '{"incidentSeverityId":"<severity-id>"}'
```

## Oprettelse af ressourcer fra filer

Brug `--file` til at oprette ressourcer fra JSON-filer, nyttigt til versionsstyret infrastruktur:

```bash
# monitor.json
# {
#   "name": "API Health Check",
#   "projectId": "your-project-id"
# }

oneuptime monitor create --file monitor.json
```

## Batchoperationer

Behandl flere ressourcer i en løkke:

```bash
# Opret flere monitorer fra en JSON-array-fil
cat monitors.json | jq -r '.[] | @json' | while read monitor; do
  oneuptime monitor create --data "$monitor"
done
```

## CI/CD-pipeline-eksempler

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

### Generisk CI/CD-script

```bash
#!/bin/bash
set -e

export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="$CI_ONEUPTIME_URL"

# Opret et deployment-incident og fang ID'et
# Bemærk: currentIncidentStateId og incidentSeverityId skal referere til eksisterende tilstands-/alvorlighedsID'er i dit projekt
INCIDENT_ID=$(oneuptime incident create --data '{
  "title": "Deployment Started",
  "currentIncidentStateId": "'"$INVESTIGATING_STATE_ID"'",
  "incidentSeverityId": "'"$SEVERITY_ID"'",
  "declaredAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}' -o json | jq -r '._id')

# Kør deployment-trin her...

# Løs incidentet efter vellykket deployment
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

## Brug af en specifik kontekst i scripts

Hvis du har flere gemte kontekster, kan du målrette en specifik:

```bash
oneuptime --context production incident list
oneuptime --context staging monitor count
```
