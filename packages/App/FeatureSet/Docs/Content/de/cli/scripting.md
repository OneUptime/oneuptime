# Skripting & CI/CD

Die CLI arbeitet in einem Skript genauso wie im Terminal. Geben Sie ihr einen API-Schlüssel in Umgebungsvariablen, lesen Sie ihre Antworten als JSON und lassen Sie ihren Exit-Code dem Skript sagen, was passiert ist. Diese Seite zeigt jedes davon und vollständige Pipelines für GitHub Actions, GitLab CI und Docker.

:::cards
- [Einem Skript seinen API-Schlüssel geben](#einem-skript-seinen-api-schlüssel-geben): Zwei Umgebungsvariablen, kein gespeicherter Kontext.
- [Exit-Codes](#exit-codes): 0, wenn es geklappt hat, und warum es nicht geklappt hat.
- [Antworten mit jq lesen](#antworten-mit-jq-lesen): IDs, Titel und Daten aus dem JSON.
- [Beispiele für Pipelines](#beispiele-für-pipelines): GitHub Actions, GitLab CI und Docker.
:::

## Wie ein Skript die CLI verwendet

Ein Deployment kann OneUptime zuerst fragen, ob ein Vorfall offen ist, und anhalten, wenn einer offen ist:

```mermaid title="Ein Deployment, das wartet, solange ein Vorfall offen ist"
flowchart TB
    J["Der CI-Job startet"] --> S["Seine Secrets setzen<br/>ONEUPTIME_API_KEY<br/>und ONEUPTIME_URL"]
    S --> Q["oneuptime incident count<br/>der nicht gelösten Vorfälle"]
    Q -->|"0"| D["Deployen"]
    Q -->|"1 oder mehr"| X["Anhalten: ein Vorfall<br/>ist offen"]
    Q -->|"Exit-Code 2"| A["Anhalten: den<br/>API-Schlüssel prüfen"]
```

## Einem Skript seinen API-Schlüssel geben

Setzen Sie `ONEUPTIME_API_KEY` und `ONEUPTIME_URL` aus den Secrets Ihres CI-Systems. Die CLI braucht dann kein `login` und keine Konfigurationsdatei. Ein Flag geht ihnen für einen einzelnen Befehl weiterhin vor, und sie gehen gespeicherten Kontexten vor.

```bash
export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="https://oneuptime.com"
oneuptime incident count
```

> [!TIP]
> Geben Sie jeder Pipeline einen eigenen API-Schlüssel mit nur dem Zugriff, den sie braucht: Eine Prüfung, die nur liest, braucht einen Schlüssel, der nur liest. Löschen Sie den Schlüssel in OneUptime, wenn die Pipeline außer Dienst geht.

Führt ein Rechner Jobs für mehrere Projekte aus, speichern Sie für jedes einen Kontext und nennen Sie ihn in jedem Befehl, damit ein Job nie den aktuellen Kontext eines anderen verwendet:

```bash
oneuptime --context production incident count
oneuptime --context staging monitor count
```

## Exit-Codes

| Code | Bedeutung | Zum Beispiel |
| --- | --- | --- |
| `0` | Es hat geklappt | Eine Liste, auch eine, die nichts findet |
| `1` | Es ist fehlgeschlagen | OneUptime hat die Anfrage abgelehnt, etwa mit `API error (422)`; ungültiges JSON; eine fehlende oder unbekannte Option; ein Kontext, der nicht gespeichert ist |
| `2` | Kein verwendbarer API-Schlüssel | Keine Anmeldedaten gefunden; ein ungültiger API-Schlüssel; ein Schlüssel unter seinem Tarif (`402`); `401` |
| `3` | Nicht gefunden | OneUptime hat mit `404` geantwortet: Der Datensatz existiert nicht, liegt in einem anderen Projekt, oder der Schlüssel darf ihn nicht lesen |

`whoami` und `context current` enden mit `0`, auch wenn nichts gespeichert ist: Sie berichten, was gesetzt ist, sie prüfen es nicht. Ein Skript unterscheidet die Fälle am Code:

```bash
oneuptime incident get "$INCIDENT_ID" -o json > incident.json
case $? in
  0) echo "Saved the incident to incident.json" ;;
  2) echo "Check ONEUPTIME_API_KEY and ONEUPTIME_URL" >&2; exit 1 ;;
  3) echo "There is no incident $INCIDENT_ID" >&2; exit 1 ;;
  *) echo "OneUptime refused the request" >&2; exit 1 ;;
esac
```

Fehlermeldungen gehen in die Standardfehlerausgabe, daher enthält `incident.json` nur die Antwort.

## Antworten mit jq lesen

Schreiben Sie `-o json` in Skripten. In einer Pipe gibt die CLI ohnehin JSON aus, aber das Flag hält das Skript lauffähig, wo immer es läuft:

```bash
# The title of each incident
oneuptime incident list -o json | jq -r '.[].title'

# The ID of a new monitor
MONITOR_ID=$(oneuptime monitor create --data '{"name":"Checkout API","monitorType":"Manual"}' -o json | jq -r '._id')

# When each incident was created: dates come as objects
oneuptime incident list -o json | jq -r '.[] | "\(.createdAt.value)  \(.title)"'

# The newest 100 incidents as CSV
oneuptime incident list --limit 100 -o json | jq -r '.[] | [._id, .title, .createdAt.value] | @csv'
```

Eine Zählung gibt eine Zahl aus, bereit zum Vergleichen:

```bash
OPEN=$(oneuptime incident count --query '{"currentIncidentState":{"isResolvedState":false}}')
echo "$OPEN incidents are open"
```

## Datensätze aus Dateien erstellen

Bewahren Sie Datensätze als JSON-Dateien neben Ihrem Code auf und erstellen Sie sie von dort:

```json title="monitors/checkout-api.json"
{
  "name": "Checkout API",
  "monitorType": "Manual"
}
```

```bash
oneuptime monitor create --file monitors/checkout-api.json
```

Viele Datensätze aus einem JSON-Array, ein Erstellen für jeden:

```bash
jq -c '.[]' monitors.json | while IFS= read -r monitor; do
  oneuptime monitor create --data "$monitor" -o json | jq -r '._id'
done
```

> [!NOTE]
> Jeder Lauf erstellt neue Datensätze. Um Monitore und Statusseiten mit Dateien im Gleichschritt zu halten, nur das Geänderte zu ändern und das Entfernte zu entfernen, verwenden Sie den [Terraform-Provider](/docs/terraform/index).

## Beispiele für Pipelines

:::tabs
@tab GitHub Actions
```yaml title=".github/workflows/deploy.yml"
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: lts/*
      - name: Install the OneUptime CLI
        run: npm install -g @oneuptime/cli
      - name: Stop while an incident is open
        env:
          ONEUPTIME_API_KEY: ${{ secrets.ONEUPTIME_API_KEY }}
          ONEUPTIME_URL: https://oneuptime.com
        run: |
          OPEN=$(oneuptime incident count --query '{"currentIncidentState":{"isResolvedState":false}}')
          if [ "$OPEN" -gt 0 ]; then
            echo "$OPEN incidents are open: not deploying."
            exit 1
          fi
      - name: Deploy
        run: ./deploy.sh
```
@tab GitLab CI
```yaml title=".gitlab-ci.yml"
check-incidents:
  stage: test
  image: node:lts
  variables:
    ONEUPTIME_URL: https://oneuptime.com
  script:
    - npm install -g @oneuptime/cli
    - OPEN=$(oneuptime incident count --query '{"currentIncidentState":{"isResolvedState":false}}')
    - echo "$OPEN incidents are open"
    - test "$OPEN" -eq 0
```
@tab Docker
```dockerfile title="Dockerfile"
FROM node:lts-slim
RUN npm install -g @oneuptime/cli
ENTRYPOINT ["oneuptime"]
```
:::

In GitHub Actions fügen Sie `ONEUPTIME_API_KEY` unter **Settings → Secrets and variables → Actions** des Repositorys hinzu; in GitLab als maskierte CI/CD-Variable. Mit dem Docker-Image übergeben Sie die Variablen jedem Lauf:

```bash
docker build -t oneuptime-cli .
docker run --rm -e ONEUPTIME_API_KEY -e ONEUPTIME_URL oneuptime-cli incident count
```

## Nächste Schritte

:::cards
- [Authentifizierung](/docs/cli/authentication): Welchen Schlüssel ein Befehl verwendet, wenn mehrere gesetzt sind.
- [Ausgabeformate](/docs/cli/output-formats): Das JSON, das Ihre Skripte lesen.
- [Ressourcenoperationen](/docs/cli/resource-operations): Filter, Seiten und die Felder eines Datensatzes.
- [Terraform-Provider](/docs/terraform/index): Die Konfiguration von OneUptime in Dateien halten.
:::
