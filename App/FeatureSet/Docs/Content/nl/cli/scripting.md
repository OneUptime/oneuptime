# Scripting en CI/CD

De OneUptime CLI is ontworpen voor automatisering. Hij ondersteunt authenticatie via omgevingsvariabelen, JSON-uitvoer voor programmatische verwerking en geschikte exitcodes voor pipelineintegratie.

## Omgevingsvariabelen

Stel deze omgevingsvariabelen in om te authenticeren zonder opgeslagen contexten:

```bash
export ONEUPTIME_API_KEY=sk-your-api-key
export ONEUPTIME_URL=https://oneuptime.com
```

Deze hebben prioriteit boven opgeslagen contexten maar worden overschreven door CLI-vlaggen.

## Exitcodes

| Code | Betekenis                                                  |
| ---- | ---------------------------------------------------------- |
| `0`  | Geslaagd                                                   |
| `1`  | Algemene fout                                              |
| `2`  | Authenticatiefout (ontbrekende of ongeldige inloggegevens) |
| `3`  | Niet gevonden (404)                                        |

Gebruik exitcodes in scripts om fouten af te handelen:

```bash
if ! oneuptime monitor list > /dev/null 2>&1; then
  echo "Failed to list monitors"
  exit 1
fi
```

## JSON-verwerking met jq

Gebruik `-o json` voor machineleesbare uitvoer:

```bash
# Alle incidenttitels ophalen
oneuptime incident list -o json | jq '.[].title'

# Het ID van een nieuw aangemaakte monitor vastleggen
NEW_ID=$(oneuptime monitor create --data '{"name":"API Health"}' -o json | jq -r '._id')
echo "Created monitor: $NEW_ID"

# Incidenten tellen op ernst
oneuptime incident count --query '{"incidentSeverityId":"<severity-id>"}'
```

## Resources aanmaken vanuit bestanden

Gebruik `--file` om resources aan te maken vanuit JSON-bestanden, nuttig voor versiebeheerde infrastructuur:

```bash
# monitor.json
# {
#   "name": "API Health Check",
#   "projectId": "your-project-id"
# }

oneuptime monitor create --file monitor.json
```

## Batchbewerkingen

Verwerk meerdere resources in een lus:

```bash
# Meerdere monitors aanmaken vanuit een JSON-arraybestand
cat monitors.json | jq -r '.[] | @json' | while read monitor; do
  oneuptime monitor create --data "$monitor"
done
```

## CI/CD Pipeline-voorbeelden

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

### Generiek CI/CD-script

```bash
#!/bin/bash
set -e

export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="$CI_ONEUPTIME_URL"

# Een implementatie-incident aanmaken en het ID vastleggen
# Opmerking: currentIncidentStateId en incidentSeverityId moeten verwijzen naar bestaande status/ernst-ID's in uw project
INCIDENT_ID=$(oneuptime incident create --data '{
  "title": "Deployment Started",
  "currentIncidentStateId": "'"$INVESTIGATING_STATE_ID"'",
  "incidentSeverityId": "'"$SEVERITY_ID"'",
  "declaredAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}' -o json | jq -r '._id')

# Implementatiestappen hier uitvoeren...

# Het incident oplossen na een geslaagde implementatie
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

## Een specifieke context gebruiken in scripts

Als u meerdere opgeslagen contexten heeft, richt u zich op een specifieke:

```bash
oneuptime --context production incident list
oneuptime --context staging monitor count
```
