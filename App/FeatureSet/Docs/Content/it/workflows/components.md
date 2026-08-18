# Componenti

I componenti sono i blocchi che aggiungi dopo il trigger. Ognuno fa una cosa — invia un messaggio, chiama un'API, verifica una condizione — e si collega a ciò che viene dopo.

Questa pagina è il catalogo. Per come aggiungerli e collegarli sulla tela, vedi [Authoring a Workflow](/docs/workflows/authoring).

## API

Effettua una richiesta HTTP a qualsiasi URL.

**Settings**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, o `DELETE`.
- **URL** — l'indirizzo da chiamare.
- **Headers** — eventuali header da inviare.
- **Body** — il corpo della richiesta per `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Success** — scatta quando la chiamata ha funzionato (risposta 2xx). Passa lo status, gli header e il body.
- **Error** — scatta su un fallimento di rete o una risposta non 2xx. Passa il messaggio di errore.

Usalo per: qualsiasi API esterna, i tuoi endpoint di amministrazione, o qualsiasi integrazione che non ha un proprio componente dedicato.

## AI

### Generate Text with AI

Genera una risposta testuale da un prompt e un contesto JSON facoltativo. Il componente usa il provider LLM predefinito configurato per il progetto, ricadendo sul provider globale dell'installazione quando disponibile. Le credenziali e gli endpoint del provider sono configurati centralmente; non sono argomenti del workflow.

**Settings**:

- **System Instructions** — guida facoltativa per il ruolo, il tono e i vincoli del modello.
- **Prompt** — il compito richiesto. Può includere variabili del workflow e output di componenti precedenti.
- **Context** — JSON facoltativo che includi deliberatamente nella richiesta. Viene aggiunto dopo un marcatore esplicito di fine messaggio e trattato come dato non attendibile per il resto del messaggio.
- **Temperature** — variazione da `0` a `1`. Il valore predefinito è `0.2` per un'automazione prevedibile.
- **Maximum Output Tokens** — da `1` a `4096`. Il valore predefinito è `1024`.

System Instructions, Prompt e Context serializzato combinati sono limitati a 50.000 caratteri. La richiesta al provider ha una durata massima di 60 secondi e viene tentata una sola volta. Al massimo tre richieste AI di workflow possono essere eseguite contemporaneamente per progetto.

**Outputs**:

- **Response** — il testo generato.
- **Provider** e **Model** — la configurazione usata per la chiamata.
- **Total Tokens** e **Completion Tokens** — utilizzo riportato dal provider.
- **LLM Log ID** — la voce di log AI misurata per la chiamata.
- **Error** — l'errore di validazione, accesso, provider, budget, fatturazione o timeout, quando presente.

Collega **Success** ai componenti che devono usare la risposta. Collega **Error** a un fallback, un avviso o un percorso di log esplicito. Il componente effettua una singola richiesta al modello senza definizioni di strumenti o campi di capacità nativi del provider: non può interrogare OneUptime, chiamare API o modificare i dati del progetto da solo. Oltre alle istruzioni di sicurezza fisse del componente di OneUptime, solo System Instructions, Prompt e Context che configuri vengono inviati al provider, dopo che le variabili del workflow in quei campi sono state risolte. Il provider/modello configurato rimane un confine di fiducia perché un modello può avere capacità intrinseche gestite dal provider.

L'output del modello è testo non attendibile. Rivedilo prima di inviare comunicazioni rivolte ai clienti, e non usare testo AI in forma libera da solo per autorizzare azioni distruttive del workflow. Vedi [Configuration & Safety](/docs/workflows/configuration) per dettagli su provider, egress, logging e costi.

## Webhook (in uscita)

Una versione più semplice del componente API per i casi "invia e dimentica". Invia un body JSON a un URL.

Usa **API** se devi leggere la risposta. Usa **Webhook** se vuoi solo inviare una notifica e andare avanti.

## Slack

Pubblica un messaggio su un canale Slack.

**Settings**:

- **Channel** — il nome del canale. Il bot deve già essere in quel canale.
- **Message** — il testo da inviare. Supporta la formattazione Slack.

Collega Slack al tuo progetto prima in **Project Settings → Workspace → Slack**. Vedi [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Pubblica un messaggio su un canale Microsoft Teams.

**Settings**:

- **Team and channel** — dove pubblicare.
- **Message** — il testo da inviare.

Vedi [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) per la configurazione.

## Discord

Pubblica un messaggio su un canale Discord tramite un URL webhook in entrata.

## Telegram

Invia un messaggio a una chat Telegram usando un token bot e un chat ID.

## Email

Invia un'email tramite OneUptime.

**Settings**:

- **To** — l'indirizzo email del destinatario.
- **Subject** — l'oggetto.
- **Body** — il messaggio in Markdown o HTML.

L'email viene inviata dal mittente configurato del tuo progetto — vedi [SMTP](/docs/emails/smtp).

## Custom Code

Esegui un piccolo pezzo di JavaScript quando ti serve qualcosa che gli altri blocchi non possono fare.

**Settings**:

- **Code** — il tuo JavaScript. L'ultimo valore (o ciò che restituisci da una funzione asincrona) diventa l'output del blocco.
- **Arguments** — valori con nome che puoi passare.

**Outputs**: success (il tuo valore di ritorno) ed error (qualsiasi eccezione).

Usalo per: rimodellare dati tra due sistemi, fare un piccolo calcolo, qualsiasi cosa che non merita un proprio blocco. Per scripting più pesante, usa un [Runbook](/docs/runbooks/index) al suo posto.

## JSON

Converti tra testo e JSON.

- **JSON → Text** — trasforma un oggetto JSON in una stringa. Utile quando il blocco successivo si aspetta del testo.
- **Text → JSON** — analizza una stringa in un oggetto JSON. Utile quando qualcosa è arrivato come testo e devi leggere un campo.

## Conditions

Ramifica in base a un confronto. Nel pannello **Add Component** questo blocco si chiama **If / Else**, sotto la categoria Conditions.

**Settings**:

- **Left value** — di solito un valore da un blocco precedente.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — con cosa confrontare.

**Outputs**: **Yes** e **No**. Collega i blocchi successivi al ramo che desideri.

## Delay

Metti in pausa il workflow per un periodo di tempo prestabilito prima di continuare. Utile quando devi dare a un altro sistema un momento per recuperare.

## Log

Scrive una riga nel log dell'esecuzione. Nessun effetto esterno — compare semplicemente nei log del workflow perché tu li legga. Comodo per il debug.

## Execute Workflow

Chiama un altro workflow da questo. Il workflow chiamato viene eseguito per conto proprio — il tuo workflow continua senza aspettare che finisca.

Usalo per condividere logica comune. Costruisci un workflow "pubblica sul canale dell'incidente" una volta, poi richiamalo da qualsiasi altro workflow che deve notificare il canale.

C'è un limite di sicurezza che impedisce ai workflow di continuare a chiamarsi a vicenda in un ciclo. Vedi [Configuration & Safety](/docs/workflows/configuration).

## Componenti dati di OneUptime

Per ogni tipo di record in OneUptime (monitor, incidenti, alert, pagine di stato, politiche di reperibilità e molti altri), il pannello **Add Component** ha questi componenti — cercali per il nome del tipo. Ogni titolo è generato dal tipo di record, quindi il set Monitor riporta:

- **Find One Monitor** — legge un record che corrisponde alla query.
- **Find Many Monitors** — legge un elenco di record che corrispondono alla query.
- **Create One Monitor** — aggiunge un record da un oggetto JSON.
- **Create Many Monitors** — aggiunge più record da un array JSON.
- **Update One Monitor** — applica il payload di scrittura a un record corrispondente.
- **Update Many Monitors** — applica il payload di scrittura ai record corrispondenti, fino a Limit.
- **Delete One Monitor** — elimina un record corrispondente.
- **Delete Many Monitors** — elimina i record corrispondenti, fino a Limit.

Lo stesso set fornisce tre trigger — **On Create Monitor**, **On Update Monitor** e **On Delete Monitor**. Vedi [Triggers](/docs/workflows/triggers).

Un tipo offre solo i componenti che il suo modello consente. Un tipo di sola lettura ha solo i due componenti Find e nient'altro, quindi se non trovi **Delete One Monitor** nel pannello, quel tipo non lo permette.

Così un workflow può leggere e modificare i dati di OneUptime. Per esempio: un webhook dal tuo strumento CI può usare **Create One Incident** per aprire un incidente con i dettagli del fallimento.

## Lavorare con i record

Ogni campo su un componente dati è basato sui nomi delle **colonne** del record — gli stessi nomi usati dall'API, non le etichette del modulo sulla dashboard. La colonna ID è `_id`. L'ortografia `id` è accettata come alias ovunque tu possa digitare un nome di colonna, ma `_id` è ciò che un record restituisce, quindi è quello da leggere in uscita:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** decide su quali record agisce il componente. Le chiavi sono colonne, i valori sono cosa deve corrispondere:

```json
{ "monitorType": "Website", "isEnabled": true }
```

Una query è sempre limitata al progetto in cui viene eseguito il workflow. Non puoi raggiungere i record di un altro progetto, e non devi aggiungere tu stesso il progetto alla query.

**JSON Object** su Create One, **JSON Array** su Create Many, e **Data (JSON Object)** sui componenti Update contengono i campi da scrivere, con le stesse chiavi:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

Una chiave che non è una colonna viene ignorata invece di essere rifiutata — il log dell'esecuzione nomina quelle che ha scartato, quindi controlla lì quando un campo non arriva. **Select Fields**, sui componenti Find e sui trigger, usa le stesse chiavi di colonna con valori `true`: `{"_id": true, "name": true}`.

**Skip** e **Limit** sono due campi numerici su Find Many, Update Many e Delete Many — `Skip: 0` con `Limit: 100` prende i primi cento risultati corrispondenti. Limit ha come predefinito `10`, e su Update Many e Delete Many limita quanti record vengono effettivamente scritti, non solo quanti tornano indietro. Quindi `Items Deleted: 10` significa che dieci record sono stati eliminati, non che dieci corrispondevano. Aumenta Limit quando intendi modificare più di dieci.

**Success** ed **Error** riportano se la query è stata eseguita, non cosa ha trovato. Una query che non corrisponde a nulla restituisce `0` e passa comunque attraverso Success — non è un fallimento. Per ramificare in base a se qualcosa è stato trovato, leggi il conteggio restituito in un blocco **If / Else**.

## Quale componente dovrei usare?

Alcune regole rapide:

- Se c'è un blocco dedicato per quello che vuoi (Slack, Email, un record OneUptime), usalo — ottieni una gestione degli errori più curata e log più chiari.
- Per qualsiasi altra API esterna, usa **API**.
- Per riassumere, classificare o redigere testo da dati del workflow esplicitamente selezionati, usa **Generate Text with AI**.
- Per rimodellare dati tra blocchi, usa **Custom Code** o **JSON**.
- Per intraprendere azioni diverse in base a un valore, usa **Conditions**.

## Cosa leggere dopo

- [Variabili del workflow](/docs/workflows/variables) — passare dati tra i blocchi.
- [Esecuzioni e log del workflow](/docs/workflows/runs-and-logs) — controllare cosa ha fatto ciascun blocco in un'esecuzione.
- [Configurazione e sicurezza del workflow](/docs/workflows/configuration) — limiti, proprietari e segreti.
