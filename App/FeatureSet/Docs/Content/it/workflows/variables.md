# Variabili

Un workflow è utile solo quando i dati lo attraversano. Le variabili sono il modo in cui questi dati si muovono — dal trigger al primo componente, dall'output di un componente all'input del successivo, e dai segreti a livello di progetto ovunque vengano referenziati.

OneUptime ha due tipi di variabili e una sola sintassi di interpolazione che funziona per entrambe.

## Variabili globali

Valori a livello di progetto definiti una sola volta in **Workflows → Variabili globali**. Pensa a chiavi API, URL di base, nomi di canali, qualsiasi cosa tu non voglia cablare manualmente in dieci workflow.

Una variabile globale ha:

- **Nome** — l'identificatore con cui la referenzi. Usa `UPPER_SNAKE_CASE` per renderla evidente nei template.
- **Valore** — il valore stringa. Sono supportati valori multi-riga.
- **Is Secret** — quando è attivo, il valore è in sola scrittura nell'interfaccia dopo il salvataggio ed è oscurato nei log delle esecuzioni.

Referenzia una variabile globale da qualsiasi punto di qualsiasi workflow con:

```
{{variable.NAME}}
```

Per esempio, se hai definito `PAGERDUTY_KEY` come variabile segreta, ogni componente API che chiama PagerDuty può leggerla come `{{variable.PAGERDUTY_KEY}}` senza che nessuno veda la chiave vera nel JSON del workflow.

## Variabili locali

Le variabili locali sono i valori di ritorno dei nodi che hanno già eseguito in questa esecuzione. Ogni trigger e ogni componente ne pubblica uno — vedi [Trigger](/docs/workflows/triggers) e [Componenti](/docs/workflows/components) per gli elenchi nodo per nodo.

Referenzia una variabile locale come:

```
{{NodeId.fieldName}}
```

Il `NodeId` è il nome del trigger o del componente sul canvas (puoi rinominarlo per leggibilità — tienilo corto e in `PascalCase` per mantenere puliti i riferimenti). Il `fieldName` è qualunque cosa quel nodo pubblichi.

Esempi:

- Dopo che un componente **API** chiamato `LookupUser` è ritornato con successo, i nodi a valle possono leggere il suo status code come `{{LookupUser.response-status}}` e il body parsato come `{{LookupUser.response-body}}`.
- Dopo un trigger **Incident → On Create** chiamato `Incident`, puoi leggere `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}` e qualsiasi altra colonna sull'incidente.
- Dopo un componente **Custom Code** chiamato `Transform`, il valore ritornato è esposto come `{{Transform.value}}`.

Le variabili locali hanno scope di una singola esecuzione. L'esecuzione successiva parte con una lavagna pulita.

## Dove funziona l'interpolazione

Quasi ogni argomento in stile testo supporta l'interpolazione:

- I campi URL sul componente API
- Il testo del messaggio su Slack / Teams / Discord / Telegram / Email
- L'oggetto e il body di Email
- I campi degli header e del body (usala dentro i valori JSON)
- Gli operandi sinistro e destro su Conditions

Gli argomenti puro-JSON accettano interpolazione dentro i valori stringa; non puoi interpolare una chiave. Se devi costruire una struttura dinamica, usa **Custom Code** per assemblare il payload e poi pipe il suo valore di ritorno nel nodo successivo.

Il componente **Custom Code** legge le variabili in modo diverso — le variabili globali sono esposte su `args.variables`, e i valori di ritorno a monte vengono passati come argomenti con nome che configuri sul componente.

## Esempi

### Costruire un payload da un trigger

Un webhook riceve il risultato di una build CI. Il body è JSON come `{ "service": "checkout", "status": "failed" }`. Per trasformarlo in un incidente OneUptime:

1. Trigger **Webhook** chiamato `CIWebhook`.
2. Componente **Conditions**: left `{{CIWebhook.Request Body.status}}`, operator `==`, right `failed`.
3. Dalla porta `yes`, un componente **Create Incident** con:
   - Title: `Build CI fallita: {{CIWebhook.Request Body.service}}`
   - Description: `Vedi {{CIWebhook.Request Body.url}} per i log della build.`

### Usare un segreto in una chiamata API in uscita

Un workflow che chiama PagerDuty:

1. Definisci `PAGERDUTY_KEY` come variabile globale segreta.
2. Sul componente **API**, imposta l'header `Authorization` a `Token token={{variable.PAGERDUTY_KEY}}`.

La chiave non compare mai nel JSON del workflow né nei log delle esecuzioni.

### Concatenare due chiamate API

La prima chiamata restituisce un ID di cui ha bisogno la seconda chiamata:

1. Componente **API** `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. Componente **API** `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Se `LookupOrder` restituisce una risposta non-2xx, scatta la sua porta `error` invece di `success` — collega quel ramo a un componente Email o Slack così i fallimenti non sono silenziosi.

## Qualche insidia

- **I refusi nei nomi dei nodi rompono i riferimenti in silenzio.** Se rinomini un nodo dopo aver cablato `{{OldName.field}}` a valle, aggiorna ogni riferimento. Guarda il log dell'esecuzione — se vedi il letterale `{{OldName.field}}` nell'argomento catturato, il lookup non si è risolto.
- **I segreti sono case-sensitive.** `{{variable.MyKey}}` e `{{variable.mykey}}` sono variabili diverse.
- **I campi mancanti sono vuoti.** Referenziare `{{Foo.nonexistent}}` produce una stringa vuota, non un errore. Utile, ma può mascherare bug — usa un nodo **Conditions** per asserire la presenza se il campo è richiesto dal passo successivo.

## Cosa leggere dopo

- [Componenti](/docs/workflows/components) — il catalogo completo dei nomi dei valori di ritorno.
- [Esecuzioni e log](/docs/workflows/runs-and-logs) — ispeziona il valore letterale di ogni argomento interpolato dopo un'esecuzione.
- [Configurazione e sicurezza](/docs/workflows/configuration) — cosa è sicuro mettere in una variabile globale.
