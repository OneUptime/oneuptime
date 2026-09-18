# Variabili

I workflow servono a spostare dati — dal trigger al primo blocco, da un blocco al successivo e dai valori condivisi verso qualunque punto ti serva. Le variabili sono il mezzo con cui quei dati si spostano.

Gli ambiti delle variabili sono due, ai quali si aggiungono gli output dei componenti prodotti durante un'esecuzione.

## Variabili globali

Valori validi per tutto il progetto, che salvi una volta e riusi ovunque. Pensa alle chiavi API, agli URL, ai nomi dei canali — a tutto ciò che non vuoi copiare a mano in dieci workflow diversi.

Li trovi in **Flussi di lavoro → Variabili globali**. Ognuno ha:

- **Nome** — il nome con cui lo richiamerai. Almeno due caratteri, senza spazi, e solo lettere, numeri, trattini e trattini bassi. `UPPER_SNAKE_CASE` è una buona abitudine, perché salta all'occhio dentro i blocchi.
- **Descrizione** — facoltativa, testo libero per ricordarti a che cosa serve.
- **Segreto** — se attivo, il valore viene ripulito dai log delle esecuzioni e dalle tracce dei passaggi.
- **Contenuto** — il valore vero e proprio. È un campo di testo lungo, quindi vanno bene anche i valori su più righe.

Usa una variabile globale in qualsiasi workflow così:

```
{{global.variables.NAME}}
```

Per esempio, se hai salvato la tua chiave PagerDuty come `PAGERDUTY_KEY`, qualsiasi blocco può usarla come `{{global.variables.PAGERDUTY_KEY}}`: l'editor conserva il riferimento, e il logging del workflow ripulisce il valore segreto una volta risolto.

Le variabili si creano e si eliminano, non si modificano. Nella tabella non c'è un pulsante di modifica, quindi per cambiare un valore dall'interfaccia devi eliminare la variabile e ricrearla — oppure aggiornarla via API, come vedremo alla fine di questa pagina. Le variabili globali e quelle di workflow sono una funzionalità del piano Growth.

## Variabili locali del workflow

Variabili che valgono solo dentro un workflow, gestite in **Variabili del flusso** nel menu di sinistra di quel workflow. Le richiami così:

```
{{local.variables.NAME}}
```

## Output dei componenti (i dati dei blocchi precedenti)

Ogni trigger e ogni componente può produrre un output durante un'esecuzione. Per scrivere il riferimento usa il selettore di valori dei componenti dell'editor invece di digitarlo a mano: inserisce esattamente gli id che il runner si aspetta.

Ecco come si richiama l'output di un blocco precedente:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` è l'**Identifier** del blocco — l'id breve stampato sul blocco, non il nome che ci vedi sopra. I blocchi nuovi ne ricevono uno tipo `api-get-1`, e puoi rinominarlo nella sezione **ID** del blocco. Rinominarlo rompe ogni riferimento che già lo usa, esattamente come succede quando rinomini una variabile. `FIELD_ID` è l'id del valore di ritorno che hai scelto.

Qualche esempio:

- Dopo l'esecuzione di un componente **API** con ID `lookup-user`, il suo codice di stato è `{{local.components.lookup-user.returnValues.response-status}}` e il suo corpo è `{{local.components.lookup-user.returnValues.response-body}}`.
- Dopo un componente **Run Custom JavaScript** con ID `transform`, il valore restituito è `{{local.components.transform.returnValues.returnValue}}`.
- I trigger legati a un tipo di record — **On Create Incident** e compagni — restituiscono un solo valore, `model`, dentro il quale scendi. Per un trigger con ID `incident-on-create-1`, il titolo dell'incidente è `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Le variabili locali esistono solo per la durata dell'esecuzione in corso. Ogni nuova esecuzione riparte da zero.

## Dove funzionano le variabili

Le accetta quasi ogni campo di testo:

- L'URL di un blocco API.
- Il testo del messaggio su Slack, Teams, Discord, Telegram, Email.
- L'oggetto e il corpo di un'email.
- I campi degli header e del body (dentro i valori stringa).
- Entrambi i lati di un blocco **If / Else** (che trovi nella categoria Conditions).

Nei campi JSON puoi usare una variabile dentro un valore stringa, ma non come chiave. Un riferimento che occupa da solo un intero valore viene sostituito così com'è, quindi in questo modo puoi calare un oggetto intero dentro un campo JSON. Se devi costruire una struttura in modo dinamico, usa un blocco **Run Custom JavaScript** per crearla e passa il suo output al blocco successivo.

Il blocco **Run Custom JavaScript** non riceve le variabili in automatico: nella sandbox non viene iniettato nulla. Metti `{{global.variables.NAME}}` (o qualsiasi riferimento a un componente) nel campo JSON **Arguments** del blocco; quei valori vengono sostituiti prima che lo script parta e arrivano dentro `args`.

## Ciclare su un array

Dentro un campo di testo puoi scorrere un array con `{{#each path}}…{{/each}}`. All'interno del blocco, `{{property}}` legge dall'elemento corrente, `{{@index}}` è la posizione a partire da 0 e `{{this}}` è l'elemento stesso, utile per gli array di valori semplici. I nomi dentro un blocco `{{#each}}` vengono ripuliti dagli spazi, quindi lì gli spazi di troppo non fanno danni — al contrario di quanto succede ovunque altro.

## Esempi

### Costruire un payload a partire da un webhook

Arriva un webhook con un corpo tipo `{ "service": "checkout", "status": "failed" }`. Per trasformarlo in un incidente di OneUptime:

1. Trigger **Webhook** con id `ci-webhook`.
2. Blocco **If / Else**: seleziona l'output Request Body del webhook e usane la proprietà `status`, operatore `==`, valore a destra `failed`.
3. Dal ramo **Yes**, un blocco **Create One Incident** con:
   - Titolo: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Descrizione: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Usare un segreto in una chiamata API

Un workflow che chiama PagerDuty:

1. Salva `PAGERDUTY_KEY` come variabile globale segreta.
2. Sul blocco **API**, imposta l'header `Authorization` a `Token token={{global.variables.PAGERDUTY_KEY}}`.

La chiave resta fuori dal workflow e fuori dai log.

### Concatenare due chiamate API

La prima chiamata ti dà un ID che serve alla seconda:

1. Componente **API** `lookup-order`: usa il selettore per inserire il campo email del JSON del trigger manuale in `GET /orders?email=...`.
2. Componente **API** `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Se `lookup-order` fallisce, scatta il suo output **Error** invece di **Success**. Collegalo a un blocco Email o Slack, così i fallimenti non passano inosservati.

## Aggiornare una variabile da un workflow

Uno schema ricorrente è la rotazione periodica di una credenziale: recuperi un token fresco da un servizio esterno e lo riscrivi nella variabile, così l'esecuzione successiva lo trova già pronto. Si fa con un blocco **API** che chiama l'API di OneUptime.

`PUT /api/workflow-variable/<variable-id>` con un header `ApiKey` e — qui è dove tutti inciampano — i campi che vuoi cambiare **avvolti in un oggetto `data`**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

Un corpo piatto, senza l'involucro `data`, viene rifiutato con un 400. Manda solo i campi che vuoi davvero cambiare: `name` e `description` possono restare fuori dal payload.

La chiave API ha bisogno del permesso **Edit Workflow Variables**. Non serve nessun permesso di lettura — l'aggiornamento non rilegge la riga.

Due cose a cui fare attenzione:

- **Non rinominare una variabile a cui fai riferimento.** `name` fa parte di `{{local.variables.NAME}}`. Cambiarlo lascia irrisolto ogni riferimento esistente, e un riferimento irrisolto viene passato oltre come testo letterale — vedi la trappola qui sotto.
- **Una variabile si può scrivere in questo modo, ma non rileggere.** `content` è in sola scrittura via API per qualsiasi variabile, segreta o no. È proprio questo a rendere una variabile un posto sicuro dove parcheggiare un token che ruota. Contrassegnarla come segreta, in più, tiene il valore fuori dai log delle esecuzioni e dalle tracce dei passaggi.

## Trappole

- **Usa i selettori.** Inseriscono esattamente gli id di componente, di valore di ritorno e di variabile che il runner si aspetta, e tengono i riferimenti indipendenti dalle etichette visualizzate.
- **I nomi delle variabili distinguono maiuscole e minuscole.** `{{global.variables.MyKey}}` e `{{global.variables.mykey}}` sono due cose diverse.
- **Un riferimento che non si risolve resta com'è, non diventa vuoto.** Fare riferimento a qualcosa che non esiste non è un errore, e non ti restituisce nemmeno una stringa vuota: le graffe vengono passate oltre tali e quali, quindi `{{local.components.api-get-1.returnValues.body}}` con l'id del passaggio sbagliato finisce testuale nel tuo messaggio Slack, nell'URL o nel corpo della richiesta, e l'esecuzione risulta comunque **Executed**. Il log dell'esecuzione riporta una riga di avviso con il nome di ogni riferimento che è passato in questo modo.
- **Il builder non può controllare i nomi delle variabili.** Segnala i riferimenti a componenti che non riesce a far corrispondere — un id di passaggio sconosciuto, un valore di ritorno sconosciuto, una radice malformata — prima che tu salvi. Non può però sapere se una variabile esiste, quindi una variabile rinominata la scopri solo dal log dell'esecuzione.
- **Gli spazi dentro le graffe non vengono tolti.** `{{ local.variables.NAME }}` è una ricerca diversa da `{{local.variables.NAME}}` e non si risolve mai. L'unica eccezione è dentro un blocco `{{#each}}`, dove i nomi vengono ripuliti dagli spazi.

## Cosa leggere dopo

- [Componenti del workflow](/docs/workflows/components) — l'elenco completo degli output che ogni blocco produce.
- [Esecuzioni e log del workflow](/docs/workflows/runs-and-logs) — vedere il valore reale di ogni variabile dopo un'esecuzione.
- [Configurazione e sicurezza del workflow](/docs/workflows/configuration) — che cosa si può mettere tranquillamente in una variabile globale.
