# Skripting og CI/CD

OneUptime CLI er designet for automatisering. Det støtter miljøvariabelbasert autentisering, JSON-utdata for programmatisk parsing og passende avslutkoder for pipelineintegrasjon.

## Miljøvariabler

Angi disse miljøvariablene for å autentisere uten lagrede kontekster:

```bash
export ONEUPTIME_API_KEY=sk-your-api-key
export ONEUPTIME_URL=https://oneuptime.com
```

Disse har prioritet over lagrede kontekster, men overstyres av CLI-flagg.

## Avslutkoder

| Kode | Betydning                                                 |
| ---- | --------------------------------------------------------- |
| `0`  | Vellykket                                                 |
| `1`  | Generell feil                                             |
| `2`  | Autentiseringsfeil (manglende eller ugyldig legitimasjon) |
| `3`  | Ikke funnet (404)                                         |

Bruk avslutkoder i skript for å håndtere feil:

```bash
if ! oneuptime monitor list > /dev/null 2>&1; then
  echo "Failed to list monitors"
  exit 1
fi
```

## JSON-behandling med jq

Bruk `-o json` for å produsere maskinlesbar utdata:

```bash
# Hent alle hendelsestitler
oneuptime incident list -o json | jq '.[].title'

# Hent ID-en til en nyopprettet monitor
NEW_ID=$(oneuptime monitor create --data '{"name":"API Health"}' -o json | jq -r '._id')
echo "Created monitor: $NEW_ID"

# Tell hendelser etter alvorlighetsgrad
oneuptime incident count --query '{"incidentSeverityId":"<severity-id>"}'
```

## Opprette ressurser fra filer

Bruk `--file` for å opprette ressurser fra JSON-filer, nyttig for versjonsbasert infrastruktur:

```bash
# monitor.json
# {
#   "name": "API Health Check",
#   "projectId": "your-project-id"
# }

oneuptime monitor create --file monitor.json
```

## Batchoperasjoner

Behandle flere ressurser i en løkke:

```bash
# Opprett flere monitorer fra en JSON-matrisefil
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

### Generisk CI/CD-skript

```bash
#!/bin/bash
set -e

export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="$CI_ONEUPTIME_URL"

# Opprett en distribusjonshendelse og fang ID-en
# Merk: currentIncidentStateId og incidentSeverityId må referere til eksisterende tilstands-/alvorlighetsgrads-ID-er i prosjektet ditt
INCIDENT_ID=$(oneuptime incident create --data '{
  "title": "Deployment Started",
  "currentIncidentStateId": "'"$INVESTIGATING_STATE_ID"'",
  "incidentSeverityId": "'"$SEVERITY_ID"'",
  "declaredAt": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
}' -o json | jq -r '._id')

# Kjør distribusjonstrinn her...

# Løs hendelsen etter vellykket distribusjon
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

## Bruke en spesifikk kontekst i skript

Hvis du har flere lagrede kontekster, kan du rette deg mot en spesifikk:

```bash
oneuptime --context production incident list
oneuptime --context staging monitor count
```
