# Scripting en CI/CD

De CLI werkt in een script net zo als in een terminal. Geef hem een API-sleutel in omgevingsvariabelen, lees zijn antwoorden als JSON en laat zijn exitcode het script vertellen wat er gebeurde. Deze pagina laat elk daarvan zien, en complete pipelines voor GitHub Actions, GitLab CI en Docker.

:::cards
- [Een script zijn API-sleutel geven](#een-script-zijn-api-sleutel-geven): Twee omgevingsvariabelen, geen opgeslagen context.
- [Exitcodes](#exitcodes): 0 als het lukte, en waarom het anders niet lukte.
- [Antwoorden lezen met jq](#antwoorden-lezen-met-jq): ID's, titels en datums uit de JSON.
- [Voorbeelden van pipelines](#voorbeelden-van-pipelines): GitHub Actions, GitLab CI en Docker.
:::

## Hoe een script de CLI gebruikt

Een deployment kan OneUptime eerst vragen of er een incident openstaat, en stoppen als dat zo is:

```mermaid title="Een deployment die wacht zolang er een incident openstaat"
flowchart TB
    J["De CI-job start"] --> S["Zijn secrets zetten<br/>ONEUPTIME_API_KEY<br/>en ONEUPTIME_URL"]
    S --> Q["oneuptime incident count<br/>van niet opgeloste incidenten"]
    Q -->|"0"| D["Deployen"]
    Q -->|"1 of meer"| X["Stoppen: er staat<br/>een incident open"]
    Q -->|"exitcode 2"| A["Stoppen: controleer<br/>de API-sleutel"]
```

## Een script zijn API-sleutel geven

Stel `ONEUPTIME_API_KEY` en `ONEUPTIME_URL` in vanuit de secrets van je CI-systeem. De CLI heeft dan geen `login` en geen configuratiebestand nodig. Een vlag gaat er voor één opdracht nog steeds voor, en zij gaan voor opgeslagen contexten.

```bash
export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="https://oneuptime.com"
oneuptime incident count
```

> [!TIP]
> Geef elke pipeline een eigen API-sleutel met alleen de toegang die hij nodig heeft: een controle die alleen leest, heeft een sleutel nodig die alleen leest. Verwijder de sleutel in OneUptime als de pipeline wordt opgeheven.

Draait één machine jobs voor meerdere projecten, sla dan voor elk een context op en noem die in elke opdracht, zodat een job nooit de huidige context van een andere gebruikt:

```bash
oneuptime --context production incident count
oneuptime --context staging monitor count
```

## Exitcodes

| Code | Betekenis | Bijvoorbeeld |
| --- | --- | --- |
| `0` | Het is gelukt | Een lijst, ook een die niets vindt |
| `1` | Het is mislukt | OneUptime weigerde het verzoek, zoals `API error (422)`; ongeldige JSON; een ontbrekende of onbekende optie; een context die niet is opgeslagen |
| `2` | Geen bruikbare API-sleutel | Geen inloggegevens gevonden; een ongeldige API-sleutel; een sleutel onder zijn abonnement (`402`); `401` |
| `3` | Niet gevonden | OneUptime antwoordde `404`: het record bestaat niet, staat in een ander project, of de sleutel mag het niet lezen |

`whoami` en `context current` eindigen met `0`, ook als er niets is opgeslagen: ze melden wat er is ingesteld, ze controleren het niet. Een script onderscheidt de gevallen aan de code:

```bash
oneuptime incident get "$INCIDENT_ID" -o json > incident.json
case $? in
  0) echo "Saved the incident to incident.json" ;;
  2) echo "Check ONEUPTIME_API_KEY and ONEUPTIME_URL" >&2; exit 1 ;;
  3) echo "There is no incident $INCIDENT_ID" >&2; exit 1 ;;
  *) echo "OneUptime refused the request" >&2; exit 1 ;;
esac
```

Foutmeldingen gaan naar de standaardfoutuitvoer, dus `incident.json` bevat alleen het antwoord.

## Antwoorden lezen met jq

Schrijf `-o json` in scripts. In een pipe drukt de CLI toch JSON af, maar de vlag houdt het script werkend waar het ook draait:

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

Een telling drukt één getal af, klaar om te vergelijken:

```bash
OPEN=$(oneuptime incident count --query '{"currentIncidentState":{"isResolvedState":false}}')
echo "$OPEN incidents are open"
```

## Records maken uit bestanden

Bewaar records als JSON-bestanden naast je code, en maak ze vanaf daar aan:

```json title="monitors/checkout-api.json"
{
  "name": "Checkout API",
  "monitorType": "Manual"
}
```

```bash
oneuptime monitor create --file monitors/checkout-api.json
```

Veel records uit één JSON-array, één aanmaak per record:

```bash
jq -c '.[]' monitors.json | while IFS= read -r monitor; do
  oneuptime monitor create --data "$monitor" -o json | jq -r '._id'
done
```

> [!NOTE]
> Elke run maakt nieuwe records. Om monitoren en statuspagina's gelijk te houden met bestanden, alleen te wijzigen wat veranderde en te verwijderen wat weg is, gebruik je de [Terraform-provider](/docs/terraform/index).

## Voorbeelden van pipelines

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

Voeg in GitHub Actions `ONEUPTIME_API_KEY` toe onder **Settings → Secrets and variables → Actions** van de repository; voeg hem in GitLab toe als gemaskeerde CI/CD-variabele. Geef met de Docker-image de variabelen aan elke run mee:

```bash
docker build -t oneuptime-cli .
docker run --rm -e ONEUPTIME_API_KEY -e ONEUPTIME_URL oneuptime-cli incident count
```

## Volgende stappen

:::cards
- [Authenticatie](/docs/cli/authentication): Welke sleutel een opdracht gebruikt als er meerdere zijn ingesteld.
- [Uitvoerformaten](/docs/cli/output-formats): De JSON die je scripts lezen.
- [Bewerkingen op bronnen](/docs/cli/resource-operations): Filters, pagina's en de velden van een record.
- [Terraform-provider](/docs/terraform/index): De configuratie van OneUptime in bestanden bewaren.
:::
