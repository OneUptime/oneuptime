# Variabili

I workflow servono a spostare dati — dal trigger al primo blocco, da un blocco al successivo e dai valori condivisi ovunque servano. Le variabili sono il modo in cui questi dati si spostano.

Esistono due tipi e condividono la stessa sintassi.

## Variabili globali

Valori a livello di progetto che salvi una sola volta e riutilizzi ovunque. Pensa a chiavi API, URL, nomi di canali — qualsiasi cosa che non vuoi copiare in dieci workflow diversi.

Le trovi sotto **Workflows → Global Variables**. Ognuna ha:

- **Name** — come la richiamerai. Usa `UPPER_SNAKE_CASE` per farla risaltare nei tuoi blocchi.
- **Value** — il valore vero e proprio. Funzionano anche i valori su piu righe.
- **Is Secret** — se attivo, il valore viene nascosto nell'interfaccia dopo il salvataggio e nei log delle esecuzioni.

Usa una variabile globale in qualsiasi workflow con:

```
{{variable.NAME}}
```

Per esempio, se hai salvato la tua chiave PagerDuty come `PAGERDUTY_KEY`, qualsiasi blocco puo usarla come `{{variable.PAGERDUTY_KEY}}` — la chiave reale non appare mai nel workflow ne nei suoi log.

## Variabili locali (dati dai blocchi precedenti)

Le variabili locali sono l'output dei blocchi gia eseguiti in questa esecuzione. Ogni trigger e ogni componente produce un output che puoi leggere.

Fai riferimento all'output di un blocco precedente in questo modo:

```
{{BlockName.fieldName}}
```

`BlockName` e il nome del trigger o del componente sul canvas (puoi rinominarlo in qualcosa di breve e chiaro). `fieldName` e cio che quel blocco produce.

Esempi:

- Dopo l'esecuzione di un blocco **API** chiamato `LookupUser`, puoi leggere il codice di stato come `{{LookupUser.response-status}}` e il body come `{{LookupUser.response-body}}`.
- Dopo un trigger **Incident → On Create** chiamato `Incident`, puoi leggere `{{Incident.title}}`, `{{Incident.description}}` e qualsiasi altro campo dell'incidente.
- Dopo un blocco **Custom Code** chiamato `Transform`, il valore restituito si trova in `{{Transform.value}}`.

Le variabili locali esistono solo durante l'esecuzione corrente. Ogni nuova esecuzione inizia da zero.

## Dove funzionano le variabili

Quasi tutti i campi di testo accettano variabili:

- L'URL di un blocco API.
- Il testo del messaggio in Slack, Teams, Discord, Telegram, Email.
- L'oggetto e il body di un'email.
- I campi header e body (all'interno di valori stringa).
- Entrambi i lati di un blocco Conditions.

I campi puri JSON accettano variabili all'interno di valori stringa, ma non puoi usare una variabile come chiave. Se devi costruire una struttura dinamicamente, usa un blocco **Custom Code** per crearla e passa il suo output al blocco successivo.

Il blocco **Custom Code** legge le variabili in modo diverso — le variabili globali arrivano in `args.variables`, e tu decidi quali output precedenti passare come argomenti.

## Esempi

### Costruire un payload da un webhook

Arriva un webhook con un body come `{ "service": "checkout", "status": "failed" }`. Per trasformarlo in un incidente OneUptime:

1. Trigger **Webhook** chiamato `CIWebhook`.
2. Blocco **Conditions**: left `{{CIWebhook.Request Body.status}}`, operatore `==`, right `failed`.
3. Dal ramo **Yes**, un blocco **Create Incident** con:
   - Titolo: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Descrizione: `See {{CIWebhook.Request Body.url}} for the logs.`

### Usare un segreto in una chiamata API

Un workflow che chiama PagerDuty:

1. Salva `PAGERDUTY_KEY` come variabile globale segreta.
2. Sul blocco **API**, imposta l'header `Authorization` su `Token token={{variable.PAGERDUTY_KEY}}`.

La chiave resta fuori dal workflow e dai log.

### Concatenare due chiamate API

La prima chiamata ti fornisce un ID di cui ha bisogno la seconda:

1. Blocco **API** `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. Blocco **API** `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Se `LookupOrder` fallisce, scatta il suo output **error** invece di **success**. Collegalo a un blocco Email o Slack cosi i fallimenti non passano inosservati.

## Attenzione

- **Rinominare un blocco rompe i riferimenti.** Se rinomini un blocco, aggiorna ogni luogo in cui viene utilizzato. Nel log dell'esecuzione, un riferimento non risolto appare come testo letterale `{{BlockName.field}}`.
- **I nomi delle variabili sono case-sensitive.** `{{variable.MyKey}}` e `{{variable.mykey}}` sono diverse.
- **I campi mancanti diventano vuoti.** Fare riferimento a un campo che non esiste restituisce una stringa vuota, non un errore. Comodo — ma puo nascondere bug. Usa un blocco **Conditions** per verificare i campi importanti prima di continuare.

## Letture successive

- [Componenti](/docs/workflows/components) — l'elenco completo degli output prodotti da ciascun blocco.
- [Esecuzioni e log](/docs/workflows/runs-and-logs) — vedi il valore effettivo di ogni variabile dopo un'esecuzione.
- [Configurazione e sicurezza](/docs/workflows/configuration) — cosa e sicuro mettere in una variabile globale.
