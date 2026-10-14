# Scripting e CI/CD

La CLI funziona in uno script come in un terminale. Dalle una chiave API in variabili d'ambiente, leggi le sue risposte come JSON e lascia che il suo codice di uscita dica allo script che cosa è successo. Questa pagina mostra ciascuna di queste cose, e pipeline complete per GitHub Actions, GitLab CI e Docker.

:::cards
- [Dare a uno script la sua chiave API](#dare-a-uno-script-la-sua-chiave-api): Due variabili d'ambiente, nessun contesto salvato.
- [Codici di uscita](#codici-di-uscita): 0 quando ha funzionato, e perché non ha funzionato.
- [Leggere le risposte con jq](#leggere-le-risposte-con-jq): ID, titoli e date estratti dal JSON.
- [Esempi di pipeline](#esempi-di-pipeline): GitHub Actions, GitLab CI e Docker.
:::

## Come uno script usa la CLI

Un deployment può prima chiedere a OneUptime se c'è un incidente aperto, e fermarsi se ce n'è uno:

```mermaid title="Un deployment che aspetta finché c'è un incidente aperto"
flowchart TB
    J["Il job di CI parte"] --> S["I suoi secret impostano<br/>ONEUPTIME_API_KEY<br/>e ONEUPTIME_URL"]
    S --> Q["oneuptime incident count<br/>degli incidenti non risolti"]
    Q -->|"0"| D["Esegui il<br/>deployment"]
    Q -->|"1 o più"| X["Fermati:<br/>c'è un incidente<br/>aperto"]
    Q -->|"codice di<br/>uscita 2"| A["Fermati:<br/>controlla la<br/>chiave API"]
```

## Dare a uno script la sua chiave API

Imposta `ONEUPTIME_API_KEY` e `ONEUPTIME_URL` dai secret del tuo sistema di CI. La CLI allora non ha bisogno né di `login` né di un file di configurazione. Un flag viene ancora prima di loro per un singolo comando, e loro vengono prima dei contesti salvati.

```bash
export ONEUPTIME_API_KEY="$CI_ONEUPTIME_API_KEY"
export ONEUPTIME_URL="https://oneuptime.com"
oneuptime incident count
```

> [!TIP]
> Dai a ogni pipeline una chiave API tutta sua, con solo l'accesso che le serve: un controllo che si limita a leggere ha bisogno di una chiave che si limita a leggere. Elimina la chiave in OneUptime quando la pipeline viene dismessa.

Se una macchina esegue job per più progetti, salva un contesto per ciascuno e indicalo in ogni comando, così un job non usa mai il contesto attuale di un altro:

```bash
oneuptime --context production incident count
oneuptime --context staging monitor count
```

## Codici di uscita

| Codice | Significato | Per esempio |
| --- | --- | --- |
| `0` | Ha funzionato | Un elenco, anche uno che non trova nulla |
| `1` | Non è riuscito | OneUptime ha rifiutato la richiesta, come `API error (422)`; JSON non valido; un'opzione mancante o sconosciuta; un contesto non salvato |
| `2` | Nessuna chiave API utilizzabile | Credenziali non trovate; una chiave API non valida; una chiave sotto il suo piano (`402`); `401` |
| `3` | Non trovato | OneUptime ha risposto `404`: il record non esiste, si trova in un altro progetto, oppure la chiave non può leggerlo |

`whoami` e `context current` terminano con `0` anche quando non è salvato nulla: riferiscono che cosa è impostato, non lo verificano. Uno script distingue i casi dal codice:

```bash
oneuptime incident get "$INCIDENT_ID" -o json > incident.json
case $? in
  0) echo "Saved the incident to incident.json" ;;
  2) echo "Check ONEUPTIME_API_KEY and ONEUPTIME_URL" >&2; exit 1 ;;
  3) echo "There is no incident $INCIDENT_ID" >&2; exit 1 ;;
  *) echo "OneUptime refused the request" >&2; exit 1 ;;
esac
```

I messaggi di errore vanno sullo standard error, quindi `incident.json` contiene solo la risposta.

## Leggere le risposte con jq

Scrivi `-o json` negli script. In una pipe la CLI stampa comunque JSON, ma il flag fa funzionare lo script ovunque giri:

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

Un conteggio stampa un solo numero, pronto per il confronto:

```bash
OPEN=$(oneuptime incident count --query '{"currentIncidentState":{"isResolvedState":false}}')
echo "$OPEN incidents are open"
```

## Creare record da file

Tieni i record come file JSON accanto al tuo codice, e creali da lì:

```json title="monitors/checkout-api.json"
{
  "name": "Checkout API",
  "monitorType": "Manual"
}
```

```bash
oneuptime monitor create --file monitors/checkout-api.json
```

Molti record da un array JSON, una creazione per ciascuno:

```bash
jq -c '.[]' monitors.json | while IFS= read -r monitor; do
  oneuptime monitor create --data "$monitor" -o json | jq -r '._id'
done
```

> [!NOTE]
> Ogni esecuzione crea nuovi record. Per mantenere monitor e pagine di stato allineati ai file, modificare solo ciò che è cambiato e rimuovere ciò che non c'è più, usa il [provider Terraform](/docs/terraform/index).

## Esempi di pipeline

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

In GitHub Actions, aggiungi `ONEUPTIME_API_KEY` in **Settings → Secrets and variables → Actions** del repository; in GitLab, aggiungila come variabile CI/CD mascherata. Con l'immagine Docker, passa le variabili a ogni esecuzione:

```bash
docker build -t oneuptime-cli .
docker run --rm -e ONEUPTIME_API_KEY -e ONEUPTIME_URL oneuptime-cli incident count
```

## Passi successivi

:::cards
- [Autenticazione](/docs/cli/authentication): Quale chiave usa un comando quando ne sono impostate diverse.
- [Formati di output](/docs/cli/output-formats): Il JSON che i tuoi script leggono.
- [Operazioni sulle risorse](/docs/cli/resource-operations): Filtri, paginazione e i campi di un record.
- [Provider Terraform](/docs/terraform/index): Tenere la configurazione di OneUptime in file.
:::
