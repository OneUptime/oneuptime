# Variabili

I workflow riguardano lo spostamento di dati — dal trigger al primo blocco, da un blocco al successivo e dai valori condivisi verso qualsiasi punto ti serva. Le variabili sono il modo in cui quei dati si spostano.

Ci sono due ambiti (scope) di variabili, più gli output dei componenti prodotti durante un'esecuzione.

## Variabili globali

Valori a livello di progetto che salvi una volta e riusi ovunque. Pensa a chiavi API, URL, nomi di canale — qualsiasi cosa non vuoi copiare in dieci workflow diversi.

Le trovi in **Workflows → Global Variables**. Ognuna ha:

- **Name** — come la richiamerai. Almeno due caratteri, senza spazi, e solo lettere, numeri, trattini e underscore. `UPPER_SNAKE_CASE` è una buona abitudine perché risalta nei tuoi blocchi.
- **Description** — facoltativo, testo libero per ricordarti a cosa serve.
- **Secret** — quando è attivo, il valore viene rimosso dai log delle esecuzioni e dalle tracce dei passaggi.
- **Content** — il valore vero e proprio. È un campo di testo lungo, quindi funzionano anche i valori multi-riga.

Usa una variabile globale in qualsiasi workflow con:

```
{{global.variables.NAME}}
```

Per esempio, se hai salvato la tua chiave PagerDuty come `PAGERDUTY_KEY`, qualsiasi blocco può usarla come `{{global.variables.PAGERDUTY_KEY}}` — l'editor memorizza il riferimento, e il logging del workflow rimuove il valore segreto risolto.

Le variabili vengono create ed eliminate, non modificate. Non c'è un pulsante di modifica nella tabella, quindi per cambiare un valore nell'interfaccia devi eliminare la variabile e crearla di nuovo — oppure aggiornarla tramite l'API, trattato alla fine di questa pagina. Le variabili globali e del workflow sono una funzionalità del piano Growth.

## Variabili locali del workflow

Variabili con ambito limitato a un solo workflow, gestite in **Workflow Variables** nel menu laterale di quel workflow. Richiamale con:

```
{{local.variables.NAME}}
```

## Output dei componenti (dati dai blocchi precedenti)

Ogni trigger e componente può produrre un output durante un'esecuzione. Usa il selettore di valori dei componenti nell'editor per creare il riferimento invece di digitarlo — inserisce esattamente gli id che il runner si aspetta.

Richiama l'output di un blocco precedente così:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` è l'**Identifier** del blocco — l'id breve mostrato sul blocco, non il nome visualizzato su di esso. I nuovi blocchi ne ricevono uno come `api-get-1`, e puoi rinominarlo nella sezione **ID** del blocco. Rinominarlo rompe ogni riferimento che già punta a esso, allo stesso modo in cui rinominare una variabile lo fa. `FIELD_ID` è l'id del return value selezionato.

Esempi:

- Dopo che un componente **API** con ID `lookup-user` viene eseguito, il suo status code è `{{local.components.lookup-user.returnValues.response-status}}` e il suo corpo è `{{local.components.lookup-user.returnValues.response-body}}`.
- Dopo un componente **Run Custom JavaScript** con ID `transform`, il valore restituito è `{{local.components.transform.returnValues.returnValue}}`.
- I trigger per un tipo di record — **On Create Incident** e simili — restituiscono esattamente un valore, `model`, e tu vi accedi in profondità. Per un trigger con ID `incident-on-create-1`, il titolo dell'incidente è `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Le variabili locali esistono solo durante l'esecuzione corrente. Ogni nuova esecuzione riparte da zero.

## Dove funzionano le variabili

Quasi ogni campo di testo accetta variabili:

- L'URL su un blocco API.
- Il testo del messaggio su Slack, Teams, Discord, Telegram, Email.
- L'oggetto e il corpo di un'email.
- Gli header e i campi del body (dentro valori stringa).
- Entrambi i lati di un blocco **If / Else** (elencato sotto la categoria Conditions).

Nei campi JSON puoi usare una variabile dentro un valore stringa, ma non come chiave. Un riferimento che occupa interamente un valore viene sostituito così com'è, quindi puoi inserire un intero oggetto in un campo JSON in questo modo. Se devi costruire una struttura dinamicamente, usa un blocco **Run Custom JavaScript** per costruirla, poi passa il suo output al blocco successivo.

Il blocco **Run Custom JavaScript** non riceve variabili automaticamente — nulla viene iniettato nella sandbox. Metti `{{global.variables.NAME}}` (o qualsiasi riferimento a un componente) nel campo JSON **Arguments** del blocco; quei valori vengono sostituiti prima che lo script venga eseguito e arrivano come `args`.

## Iterare su array

Dentro un campo di testo puoi iterare un array con `{{#each path}}…{{/each}}`. All'interno del blocco, `{{property}}` legge dall'elemento corrente, `{{@index}}` è la posizione a base 0, e `{{this}}` è l'elemento stesso per array di valori semplici. I nomi dentro un blocco `{{#each}}` vengono ripuliti dagli spazi, quindi gli spazi superflui lì sono innocui — a differenza di ovunque altro.

## Esempi

### Costruire un payload da un webhook

Un webhook arriva con un body come `{ "service": "checkout", "status": "failed" }`. Per trasformarlo in un incidente OneUptime:

1. Trigger **Webhook** con id `ci-webhook`.
2. Blocco **If / Else**: seleziona l'output Request Body del webhook e usa la sua proprietà `status`, operatore `==`, destra `failed`.
3. Dal ramo **Yes**, un blocco **Create One Incident** con:
   - Title: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Usare un segreto in una chiamata API

Un workflow che chiama PagerDuty:

1. Salva `PAGERDUTY_KEY` come variabile globale segreta.
2. Sul blocco **API**, imposta l'header `Authorization` su `Token token={{global.variables.PAGERDUTY_KEY}}`.

La chiave rimane fuori dal workflow e dai log.

### Concatenare due chiamate API

La prima chiamata ti dà un ID di cui la seconda ha bisogno:

1. Componente **API** `lookup-order`: usa il selettore per inserire il campo email JSON del trigger manuale in `GET /orders?email=...`.
2. Componente **API** `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Se `lookup-order` fallisce, la sua uscita **Error** scatta al posto di **Success**. Collegala a un blocco Email o Slack così i fallimenti non passano inosservati.

## Aggiornare una variabile da un workflow

Uno schema comune è ruotare una credenziale su una pianificazione: recuperare un token fresco da terze parti, poi memorizzarlo nella variabile così la prossima esecuzione lo utilizza. Fallo con un blocco **API** che chiama l'API di OneUptime.

`PUT /api/workflow-variable/<variable-id>` con un header `ApiKey`, e — questa è la parte che confonde le persone — i campi che vuoi cambiare **avvolti in un oggetto `data`**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

Un body piatto senza il wrapper `data` viene rifiutato con un 400. Invia solo i campi che vuoi effettivamente cambiare; `name` e `description` possono restare fuori dal payload.

La chiave API ha bisogno di **Edit Workflow Variables**. Non è richiesto alcun permesso di lettura — l'aggiornamento non rilegge la riga.

Due cose da tenere d'occhio:

- **Non rinominare una variabile che richiami.** `name` fa parte di `{{local.variables.NAME}}`. Cambiarlo lascia irrisolto ogni riferimento esistente, e un riferimento irrisolto viene passato come testo letterale — vedi la trappola qui sotto.
- **Una variabile può essere scritta così ma mai riletta.** `content` è di sola scrittura tramite API per ogni variabile, segreta o no. È questo che rende una variabile un posto sicuro dove parcheggiare un token in rotazione. Contrassegnarla come segreta mantiene inoltre il valore fuori dai log delle esecuzioni e dalle tracce dei passaggi.

## Trappole

- **Usa i selettori.** Inseriscono esattamente gli id di componente, return value e variabile che il runner si aspetta, e mantengono i riferimenti indipendenti dalle etichette visualizzate.
- **I nomi delle variabili distinguono maiuscole e minuscole.** `{{global.variables.MyKey}}` e `{{global.variables.mykey}}` sono diversi.
- **Un riferimento che non si risolve viene lasciato così com'è, non svuotato.** Fare riferimento a qualcosa che non esiste non è un errore, e non ti dà nemmeno una stringa vuota: le parentesi graffe vengono passate direttamente, quindi `{{local.components.api-get-1.returnValues.body}}` con un id di passaggio scritto male finisce nel tuo messaggio Slack, URL o request body alla lettera, e l'esecuzione riporta comunque **Executed**. Il log dell'esecuzione riporta una riga di avviso che nomina qualsiasi riferimento che è passato inosservato.
- **Il builder non può controllare i nomi delle variabili.** Segnala i riferimenti a componenti che non riesce ad abbinare — un id di passaggio sconosciuto, un return value sconosciuto, una radice malformata — prima che tu salvi. Non può dire se una variabile esiste, quindi una variabile rinominata viene individuata solo dal log dell'esecuzione.
- **Gli spazi dentro le parentesi graffe non vengono rimossi.** `{{ local.variables.NAME }}` è una ricerca diversa da `{{local.variables.NAME}}` e non si risolve mai. L'unica eccezione è dentro un blocco `{{#each}}`, dove i nomi vengono ripuliti dagli spazi.

## Cosa leggere dopo

- [Componenti del workflow](/docs/workflows/components) — l'elenco completo degli output prodotti da ciascun blocco.
- [Esecuzioni e log del workflow](/docs/workflows/runs-and-logs) — vedi il valore effettivo di ogni variabile dopo un'esecuzione.
- [Configurazione e sicurezza del workflow](/docs/workflows/configuration) — cosa è sicuro mettere in una variabile globale.
