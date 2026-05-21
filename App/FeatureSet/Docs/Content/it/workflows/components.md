# Componenti

I componenti sono i blocchi che aggiungi dopo il trigger. Ognuno fa una cosa sola — invia un messaggio, chiama un'API, verifica una condizione — e si collega a cio che viene dopo.

Questa pagina e il catalogo. Per sapere come trascinare, rilasciare e collegare i blocchi sul canvas, vedi [Creazione di un workflow](/docs/workflows/authoring).

## API

Effettua una richiesta HTTP verso qualsiasi URL.

**Impostazioni**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` o `DELETE`.
- **URL** — l'indirizzo da chiamare.
- **Headers** — gli header da inviare.
- **Body** — il corpo della richiesta per `POST` / `PUT` / `PATCH`.

**Output**:

- **Success** — scatta quando la chiamata ha funzionato (risposta 2xx). Trasmette stato, header e body.
- **Error** — scatta in caso di errore di rete o risposta non 2xx. Trasmette il messaggio di errore.

Usalo per: qualsiasi API esterna, i tuoi endpoint amministrativi o qualsiasi integrazione che non abbia un componente dedicato.

## Webhook (in uscita)

Una versione piu semplice del componente API per i casi "fire and forget". Invia un body JSON a un URL.

Usa **API** se devi leggere la risposta. Usa **Webhook** se vuoi solo inviare una notifica e proseguire.

## Slack

Pubblica un messaggio in un canale Slack.

**Impostazioni**:

- **Channel** — il nome del canale. Il bot deve essere gia presente in quel canale.
- **Message** — il testo da inviare. Supporta la formattazione di Slack.

Connetti prima Slack al tuo progetto da **Project Settings → Workspace Connections → Slack**. Vedi [Connessione del workspace Slack](/docs/workspace-connections/slack).

## Microsoft Teams

Pubblica un messaggio in un canale Microsoft Teams.

**Impostazioni**:

- **Team e canale** — dove pubblicare.
- **Message** — il testo da inviare.

Vedi [Connessione del workspace Microsoft Teams](/docs/workspace-connections/microsoft-teams) per la configurazione.

## Discord

Pubblica un messaggio in un canale Discord tramite un URL webhook in entrata.

## Telegram

Invia un messaggio a una chat Telegram utilizzando un token bot e un ID chat.

## Email

Invia un'email tramite OneUptime.

**Impostazioni**:

- **To** — l'indirizzo email del destinatario.
- **Subject** — l'oggetto.
- **Body** — il messaggio in Markdown o HTML.

L'email viene inviata dal mittente configurato per il tuo progetto — vedi [SMTP](/docs/emails/smtp).

## Custom Code

Esegui un piccolo pezzo di JavaScript quando ti serve qualcosa che gli altri blocchi non possono fare.

**Impostazioni**:

- **Code** — il tuo JavaScript. L'ultimo valore (o cio che restituisci da una funzione asincrona) diventa l'output del blocco.
- **Arguments** — valori nominati che puoi passare in input.

**Output**: success (il tuo valore di ritorno) ed error (qualsiasi eccezione).

Usalo per: rimodellare i dati tra due sistemi, fare un piccolo calcolo, qualsiasi cosa che non merita un blocco dedicato. Per scripting piu pesante, usa un [Runbook](/docs/runbooks/index).

## JSON

Converte tra testo e JSON.

- **JSON → Text** — trasforma un oggetto JSON in una stringa. Utile quando il blocco successivo si aspetta testo.
- **Text → JSON** — analizza una stringa per ottenere un oggetto JSON. Utile quando qualcosa e arrivato come testo e ti serve leggerne un campo.

## Conditions

Crea una ramificazione in base a un confronto.

**Impostazioni**:

- **Left value** — di solito un valore proveniente da un blocco precedente.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — con cosa confrontare.

**Output**: **Yes** e **No**. Collega i blocchi successivi al ramo che preferisci.

## Delay

Mette in pausa il workflow per un tempo prestabilito prima di proseguire. Utile quando devi dare a un altro sistema un momento per recuperare.

## Log

Scrive una riga nel log dell'esecuzione. Nessun effetto esterno — appare semplicemente nei log del workflow per consultarla. Utile per il debug.

## Execute Workflow

Chiama un altro workflow da questo. Il workflow chiamato viene eseguito per conto proprio — il tuo workflow prosegue senza attendere che termini.

Usalo per condividere logica comune. Costruisci una volta un workflow "pubblica nel canale dell'incidente" e poi chiamalo da qualsiasi altro workflow che debba notificare quel canale.

C'e un limite di sicurezza in modo che i workflow non si chiamino tra loro in un ciclo. Vedi [Configurazione e sicurezza](/docs/workflows/configuration).

## Componenti per i dati di OneUptime

Per ogni tipo di record di OneUptime (monitor, incidenti, allarmi, status page, policy on-call e molti altri), la palette include questi componenti — cerca per nome del tipo:

- **Find One** — ottieni un record per ID o filtro.
- **Find** — ottieni un elenco di record.
- **Create** — aggiungi un nuovo record.
- **Update** — modifica un record.
- **Delete** — rimuovi un record.
- **Count** — conta i record che corrispondono a un filtro.

Ecco come un workflow puo leggere e modificare i dati di OneUptime. Per esempio: un webhook dal tuo strumento CI puo usare **Create Incident** per aprire un incidente con i dettagli del fallimento.

## Quale componente usare?

Alcune regole rapide:

- Se esiste un blocco dedicato a cio che ti serve (Slack, Email, un record OneUptime), usalo — avrai una gestione degli errori migliore e log piu chiari.
- Per qualsiasi altra API esterna, usa **API**.
- Per rimodellare i dati tra blocchi, usa **Custom Code** o **JSON**.
- Per intraprendere azioni diverse in base a un valore, usa **Conditions**.

## Letture successive

- [Variabili](/docs/workflows/variables) — passare dati tra i blocchi.
- [Esecuzioni e log](/docs/workflows/runs-and-logs) — controllare cosa ha fatto ciascun blocco durante un'esecuzione.
- [Configurazione e sicurezza](/docs/workflows/configuration) — limiti, proprietari e segreti.
