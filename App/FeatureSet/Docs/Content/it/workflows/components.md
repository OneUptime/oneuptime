# Componenti

I componenti sono i nodi di azione che posizioni dopo un trigger. Ognuno fa una cosa sola — esegue una richiesta HTTP, invia un messaggio Slack, dirama in base a una condizione, esegue uno snippet JavaScript — ed espone una o più porte di output a cui collegare il nodo successivo.

Questa pagina è un catalogo. Per le regole di cablaggio e il canvas vero e proprio, vedi [Creare un workflow](/docs/workflows/authoring).

## API

Esegue una richiesta HTTP in uscita verso qualsiasi URL.

**Argomenti**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- **URL** — l'URL della richiesta. Interpolato.
- **Request Headers** — oggetto JSON di header.
- **Request Body** — body JSON o testo per `POST` / `PUT` / `PATCH`.

**Porte di output**:

- `success` — scatta quando lo stato della risposta è 2xx. Valori di ritorno: `response-status`, `response-headers`, `response-body`.
- `error` — scatta in caso di errore di rete o risposta non-2xx. Valore di ritorno: messaggio di `error`.

Usalo per: qualsiasi API REST di terze parti, i tuoi endpoint admin, integrazioni leggere che non hanno un componente dedicato.

## Webhook (in uscita)

Un wrapper sottile attorno al componente API per il caso "fire and forget". Esegue un POST di un body JSON a un URL ed espone una sola coppia `success` / `error`.

Preferisci **API** se devi leggere il body della risposta a valle; preferisci **Webhook** se vuoi solo notificare un altro sistema.

## Slack

Pubblica un messaggio in un canale Slack usando la connessione del workspace Slack del tuo progetto.

**Argomenti**:

- **Channel name** — il canale in cui pubblicare. Il bot deve già essere membro di quel canale.
- **Message text** — il body. Interpolato; supporta il mrkdwn di Slack.

Configura prima la connessione del workspace in **Project Settings → Workspace Connections → Slack**. Vedi [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Pubblica un messaggio in un canale Microsoft Teams usando la connessione Teams del tuo progetto.

**Argomenti**:

- **Team & channel** — la destinazione.
- **Message text** — il body.

Vedi [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) per la configurazione della connessione.

## Discord

Pubblica un messaggio in un canale Discord tramite un URL di webhook in entrata configurato sul componente.

## Telegram

Invia un messaggio a una chat Telegram tramite un token bot e un chat ID configurati sul componente.

## Email

Invia un'email tramite la configurazione SMTP di OneUptime.

**Argomenti**:

- **To** — indirizzo email del destinatario.
- **Subject** — interpolato.
- **Body** — Markdown o HTML.

L'email viene inviata dall'indirizzo mittente configurato sul progetto (vedi [SMTP](/docs/emails/smtp)).

## Custom Code

Esegue uno snippet di JavaScript con accesso alle variabili del workflow e ai valori di ritorno del nodo a monte.

**Argomenti**:

- **Code** — il body JavaScript. Il valore dell'ultima espressione (o ciò che viene ritornato da `(async () => { ... })()`) diventa il valore di ritorno del componente.
- **Arguments** — valori con nome opzionali passati come `args`.

**Porte di output**: `success` (valore di ritorno), `error` (eccezione catturata).

Usalo per: trasformare un payload tra due sistemi, fare una piccola computazione che non merita un componente proprio, chiamare logica JavaScript-only. Lo scripting più pesante che deve girare dentro la tua infrastruttura va in un passo Bash o JavaScript di un [Runbook](/docs/runbooks/index).

## JSON

Converte tra testo e JSON.

- **JSON → Text** — serializza un oggetto JSON in una stringa (utile per pipare in un argomento `body` di un componente in uscita che si aspetta del testo).
- **Text → JSON** — parsifica una stringa in un oggetto JSON. Utile quando un'API a monte ha restituito il suo body come testo ma devi leggere un campo.

## Conditions

Si dirama in base a un confronto. Configura:

- **Left value** — tipicamente un riferimento interpolato come `{{Incident.title}}`.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — il valore con cui confrontare.

**Porte di output**: `yes` e `no`. Collega il resto del workflow al ramo che corrisponde alla tua intenzione.

## Schedule (ritardo)

Mette in pausa un workflow per una durata configurata prima di continuare. Utile quando devi dare a un sistema esterno un momento per stabilizzarsi prima di verificarne lo stato.

## Log

Scrive una riga nel log dell'esecuzione del workflow. Pura comodità di debug; la riga viene catturata sull'esecuzione e visibile in **Logs**. Nessun side effect esterno.

## Execute Workflow

Chiama un altro workflow come sub-step. Il workflow chiamato gira indipendentemente (fire-and-forget) — il controllo torna al chiamante non appena la chiamata viene dispatchata.

Usalo per fattorizzare logica condivisa fuori da più workflow: costruisci una volta un workflow "post-to-incident-channel" e chiamalo da ogni altro workflow che deve notificare il canale.

Un limite di ricorsione impedisce ai workflow di chiamarsi a vicenda in un loop infinito. Vedi [Configurazione e sicurezza](/docs/workflows/configuration).

## Componenti di modello (CRUD sulle entità OneUptime)

Per ogni entità OneUptime che supporta i workflow (monitor, incidenti, allarmi, status page, policy on-call, ecc.), la palette espone automaticamente i seguenti componenti — ricercabili per nome dell'entità:

- **Find One {Entity}** — recupera un singolo record per query.
- **Find {Entity}** — recupera una lista di record per query (paginata).
- **Create {Entity}** — inserisce un nuovo record.
- **Update {Entity}** — aggiorna un record per ID.
- **Delete {Entity}** — cancella un record per ID.
- **Count {Entity}** — conta i record che corrispondono a una query.

È così che un workflow può leggere e scrivere lo stato di OneUptime senza uscire dalla piattaforma. Per esempio: un webhook dal tuo tool CI chiama **Create Incident** con il messaggio di fallimento della build; oppure un workflow schedulato esegue **Find Incident** ogni cinque minuti e invia per email un riepilogo.

## Scegliere il componente giusto

Qualche regola pratica:

- Se esiste un componente dedicato per quello che vuoi fare (Slack, Email, un CRUD su un'entità OneUptime), usalo — ti dà una gestione errori più pulita e log più chiari rispetto al fai-da-te.
- Se devi chiamare un'API HTTP esterna che non ha un componente dedicato, usa **API**.
- Se devi *modellare* dati tra due componenti, usa **Custom Code** o **JSON**.
- Se devi compiere azioni diverse in base a un valore, usa **Conditions**.

## Cosa leggere dopo

- [Variabili](/docs/workflows/variables) — come far passare dati da un componente al successivo.
- [Esecuzioni e log](/docs/workflows/runs-and-logs) — come ispezionare cosa ha restituito ogni componente durante un'esecuzione.
- [Configurazione e sicurezza](/docs/workflows/configuration) — limiti, ownership e segreti.
