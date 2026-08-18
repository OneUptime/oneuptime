# Componenti

I componenti sono i mattoncini che aggiungi dopo il trigger. Ognuno fa una cosa sola — manda un messaggio, chiama un'API, verifica una condizione — e si collega a ciò che viene dopo.

Questa pagina è il catalogo. Per sapere come aggiungerli e collegarli sulla tela, vedi [Creare un workflow](/docs/workflows/authoring).

## API

Fa una richiesta HTTP verso qualsiasi URL.

**Settings**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` o `DELETE`.
- **URL** — l'indirizzo da chiamare.
- **Headers** — gli header da inviare, se ce ne sono.
- **Body** — il corpo della richiesta per `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Success** — scatta quando la chiamata è andata a buon fine (risposta 2xx). Porta con sé lo stato, gli header e il corpo.
- **Error** — scatta in caso di errore di rete o di risposta non 2xx. Porta con sé il messaggio di errore.

Usalo per: qualsiasi API esterna, i tuoi endpoint di amministrazione, o qualunque integrazione che non abbia un componente dedicato.

## AI

### Generate Text with AI

Genera una risposta testuale a partire da un prompt e, se vuoi, da un contesto JSON. Il componente usa il provider LLM predefinito configurato nel progetto e, quando c'è, ripiega sul provider globale dell'installazione. Le credenziali e gli endpoint del provider si configurano centralmente: non sono argomenti del workflow.

**Settings**:

- **System Instructions** — indicazioni facoltative su ruolo, tono e vincoli del modello.
- **Prompt** — il compito da svolgere, obbligatorio. Può contenere variabili del workflow e output dei componenti precedenti.
- **Context** — JSON facoltativo che scegli deliberatamente di allegare alla richiesta. Viene accodato dopo un marcatore esplicito di fine messaggio e, per tutto il resto del messaggio, trattato come dato non attendibile.
- **Temperature** — la variabilità, da `0` a `1`. Il valore predefinito è `0.2`, per un'automazione prevedibile.
- **Maximum Output Tokens** — da `1` a `4096`. Il valore predefinito è `1024`.

System Instructions, Prompt e Context serializzato, messi insieme, non possono superare i 50.000 caratteri. La richiesta al provider dura al massimo 60 secondi e viene tentata una volta sola. Per ogni progetto possono essere in corso al massimo tre richieste AI di workflow alla volta.

**Outputs**:

- **Response** — il testo generato.
- **Provider** e **Model** — la configurazione usata per la chiamata.
- **Total Tokens** e **Completion Tokens** — il consumo dichiarato dal provider.
- **LLM Log ID** — la voce di log AI contabilizzata per questa chiamata.
- **Error** — l'errore di convalida, accesso, provider, budget, fatturazione o timeout, quando c'è.

Collega **Success** ai componenti che devono usare la risposta. Collega **Error** a un percorso esplicito di ripiego, allerta o log. Il componente fa una sola richiesta al modello, senza definizioni di strumenti né campi di capacità nativi del provider: da solo non può interrogare OneUptime, chiamare API o modificare i dati del progetto. Oltre alle istruzioni di sicurezza fisse che OneUptime aggiunge al componente, al provider vengono inviati solo System Instructions, Prompt e Context che hai configurato tu, dopo che le variabili di workflow contenute in quei campi sono state risolte. Il provider e il modello configurati restano comunque un confine di fiducia, perché un modello può avere capacità intrinseche gestite dal provider.

L'output del modello è testo non attendibile. Rileggilo prima di mandare comunicazioni ai clienti, e non usare testo AI in forma libera come unica autorizzazione per azioni distruttive di un workflow. Per i dettagli su provider, traffico in uscita, logging e costi vedi [Configurazione e sicurezza del workflow](/docs/workflows/configuration).

## Webhook (outbound)

Una versione più semplice del componente API, per i casi "spara e dimentica". Invia un corpo JSON a un URL.

Usa **API** se ti serve leggere la risposta. Usa **Webhook** se vuoi solo mandare una notifica e tirare dritto.

## Slack

Pubblica un messaggio in un canale Slack.

**Settings**:

- **Channel** — il nome del canale. Il bot deve già farne parte.
- **Message** — il testo da inviare. Supporta la formattazione di Slack.

Collega prima Slack al tuo progetto in **Impostazioni del progetto → Area di lavoro → Slack**. Vedi [Connessione dell'area di lavoro Slack](/docs/workspace-connections/slack).

## Microsoft Teams

Pubblica un messaggio in un canale di Microsoft Teams.

**Settings**:

- **Team and channel** — dove pubblicare.
- **Message** — il testo da inviare.

Per la configurazione vedi [Connessione dell'area di lavoro Microsoft Teams](/docs/workspace-connections/microsoft-teams).

## Discord

Pubblica un messaggio in un canale Discord tramite un URL di webhook in entrata.

## Telegram

Manda un messaggio a una chat Telegram usando un token del bot e un chat ID.

## Email

Manda un'email attraverso OneUptime.

**Settings**:

- **To** — l'indirizzo email del destinatario.
- **Subject** — l'oggetto.
- **Body** — il messaggio, in Markdown o HTML.

L'email parte dal mittente configurato nel tuo progetto — vedi [SMTP](/docs/emails/smtp).

## Custom Code

Esegue un pezzetto di JavaScript quando ti serve qualcosa che gli altri blocchi non sanno fare.

**Settings**:

- **Code** — il tuo JavaScript. L'ultimo valore (o quello che restituisci da una funzione asincrona) diventa l'output del blocco.
- **Arguments** — valori con un nome che puoi passargli.

**Outputs**: success (il valore che restituisci) ed error (qualunque eccezione).

Usalo per: rimodellare i dati tra due sistemi, fare un calcolo veloce, tutto ciò che non merita un blocco tutto suo. Per script più corposi usa invece un [Runbook](/docs/runbooks/index).

## JSON

Converte tra testo e JSON.

- **JSON → Text** — trasforma un oggetto JSON in una stringa. Utile quando il blocco successivo si aspetta del testo.
- **Text → JSON** — interpreta una stringa come oggetto JSON. Utile quando qualcosa è arrivato come testo e ti serve leggerne un campo.

## Conditions

Ramifica in base a un confronto. Nel pannello **Aggiungi componente** questo blocco si chiama **If / Else** e sta nella categoria Conditions.

**Settings**:

- **Left value** — di solito un valore che arriva da un blocco precedente.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — il termine di paragone.

**Outputs**: **Yes** e **No**. Collega i blocchi successivi al ramo che ti interessa.

## Delay

Mette in pausa il workflow per un tempo stabilito prima di proseguire. Utile quando devi dare a un altro sistema il tempo di stare al passo.

## Log

Scrive una riga nel log dell'esecuzione. Non ha nessun effetto esterno: compare soltanto nei log del workflow, perché tu la legga. Comodissimo per il debug.

## Execute Workflow

Chiama un altro workflow da questo. Il workflow chiamato va per conto suo: il tuo prosegue senza aspettare che finisca.

Usalo per condividere logica comune. Costruisci una volta sola un workflow "pubblica sul canale dell'incidente" e poi richiamalo da qualunque altro workflow debba avvisare quel canale.

C'è un limite di sicurezza, così i workflow non possono chiamarsi a vicenda all'infinito. Vedi [Configurazione e sicurezza del workflow](/docs/workflows/configuration).

## Componenti sui dati di OneUptime

Per ogni tipo di record di OneUptime (monitor, incidenti, avvisi, pagine di stato, policy di reperibilità e molti altri) il pannello **Aggiungi componente** offre questi componenti — cercali per il nome del tipo. Ogni titolo è generato a partire dal tipo di record, quindi per i monitor l'elenco diventa:

- **Find One Monitor** — legge un record che corrisponde alla query.
- **Find Many Monitors** — legge l'elenco dei record che corrispondono alla query.
- **Create One Monitor** — aggiunge un record a partire da un oggetto JSON.
- **Create Many Monitors** — aggiunge più record a partire da un array JSON.
- **Update One Monitor** — applica i dati da scrivere a un record corrispondente.
- **Update Many Monitors** — applica i dati da scrivere ai record corrispondenti, fino a Limit.
- **Delete One Monitor** — elimina un record corrispondente.
- **Delete Many Monitors** — elimina i record corrispondenti, fino a Limit.

Lo stesso insieme ti dà anche tre trigger — **On Create Monitor**, **On Update Monitor** e **On Delete Monitor**. Vedi [Trigger del workflow](/docs/workflows/triggers).

Ogni tipo offre solo i componenti che il suo modello consente. Un tipo in sola lettura ha i due componenti Find e nient'altro, quindi se nel pannello non trovi **Delete One Monitor** vuol dire che quel tipo non lo permette.

È così che un workflow legge e modifica i dati di OneUptime. Per esempio: un webhook del tuo strumento di CI può usare **Create One Incident** per aprire un incidente con i dettagli del fallimento.

## Lavorare con i record

Ogni campo di un componente sui dati è indicizzato sui nomi delle **colonne** del record — gli stessi nomi che usa l'API, non le etichette che vedi nei form della dashboard. La colonna dell'ID è `_id`. La grafia `id` è accettata come alias ovunque tu possa scrivere il nome di una colonna, ma quello che un record restituisce è `_id`, quindi è quello da leggere in uscita:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** decide su quali record agisce il componente. Le chiavi sono colonne, i valori sono ciò a cui devono corrispondere:

```json
{ "monitorType": "Website", "isEnabled": true }
```

Una query è sempre limitata al progetto in cui gira il workflow. Non puoi raggiungere i record di un altro progetto, e non devi aggiungere tu il progetto alla query.

**JSON Object** su Create One, **JSON Array** su Create Many e **Data (JSON Object)** sui componenti Update contengono i campi da scrivere, indicizzati allo stesso modo:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

Una chiave che non è una colonna viene ignorata invece che rifiutata — il log dell'esecuzione elenca quelle che ha scartato, quindi guarda lì quando un campo non arriva a destinazione. **Select Fields**, sui componenti Find e sui trigger, usa le stesse chiavi di colonna con valore `true`: `{"_id": true, "name": true}`.

**Skip** e **Limit** sono due campi numerici su Find Many, Update Many e Delete Many — `Skip: 0` con `Limit: 100` prende le prime cento corrispondenze. Limit vale `10` di default e, su Update Many e Delete Many, limita quanti record vengono davvero scritti, non solo quanti tornano indietro. Quindi `Items Deleted: 10` significa che sono stati eliminati dieci record, non che dieci corrispondevano. Alza Limit quando vuoi modificarne più di dieci.

**Success** ed **Error** dicono se la query è andata a buon fine, non che cosa ha trovato. Una query che non corrisponde a niente restituisce `0` ed esce comunque da Success: non è un fallimento. Per ramificare in base al fatto che ci siano state corrispondenze, leggi il conteggio restituito dentro un blocco **If / Else**.

## Quale componente conviene usare?

Qualche regola veloce:

- Se per quello che vuoi fare esiste un blocco dedicato (Slack, Email, un record di OneUptime), usa quello — ottieni una gestione degli errori migliore e log più chiari.
- Per qualsiasi altra API esterna, usa **API**.
- Per riassumere, classificare o scrivere testo a partire da dati del workflow che selezioni esplicitamente, usa **Generate Text with AI**.
- Per rimodellare i dati tra un blocco e l'altro, usa **Custom Code** o **JSON**.
- Per fare cose diverse a seconda di un valore, usa **Conditions**.

## Cosa leggere dopo

- [Variabili del workflow](/docs/workflows/variables) — passare i dati da un blocco all'altro.
- [Esecuzioni e log del workflow](/docs/workflows/runs-and-logs) — controllare che cosa ha fatto ogni blocco durante un'esecuzione.
- [Configurazione e sicurezza del workflow](/docs/workflows/configuration) — limiti, proprietari e segreti.
