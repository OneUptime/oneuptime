# Trigger

Un trigger è il primo blocco di un workflow — decide quando il workflow viene eseguito. Ogni workflow ha esattamente un trigger, e puoi sceglierlo tra quattro tipi.

## Manual

Esegui il workflow su richiesta: clicca **Esegui flusso di lavoro** nella pagina **Costruttore**, compila i campi del trigger e conferma con **Run Workflow Manually**. Il trigger Manual accetta un payload JSON che il resto del workflow può leggere.

Utile per: automazioni da un clic per cui vuoi un pulsante, tipo "ruota questa chiave" o "manda un avviso di prova".

**Output**: il JSON che hai incollato, oppure un oggetto vuoto se non ne hai messo nessuno.

## Schedule

Esegui il workflow a intervalli regolari usando un'espressione cron.

Utile per: pulizie notturne, sincronizzazioni orarie, report settimanali.

**Impostazione**: un'espressione cron. Alcune tra le più comuni:

- `0 * * * *` — ogni ora, allo scoccare dell'ora.
- `*/5 * * * *` — ogni 5 minuti.
- `0 9 * * 1` — ogni lunedì alle 9:00.

Se il sistema è brevemente non disponibile, l'esecuzione viene recuperata non appena si riprende — per le interruzioni brevi non devi preoccuparti degli scatti mancati.

## Webhook

OneUptime crea un URL univoco. Qualsiasi cosa chiami quell'URL avvia il workflow. Header, parametri di query e corpo della richiesta vengono passati al workflow.

Utile per: far arrivare dati dentro OneUptime da un altro strumento — callback di CI/CD, avvisi da altri sistemi di monitoraggio, nuove registrazioni sul tuo CRM.

**Output**:

- **Request Headers** — tutti gli header della richiesta in arrivo.
- **Request Query Params** — la query string già interpretata.
- **Request Body** — il corpo già interpretato (o il testo grezzo se non è JSON).

L'URL accetta sia `GET` sia `POST`. Chi chiama riceve subito una conferma di ricezione — il workflow vero e proprio viene eseguito in background.

Tratta quell'URL come una password. Chiunque ce l'abbia può avviare il tuo workflow.

## Trigger sugli eventi di OneUptime

Quasi ogni cosa in OneUptime — monitor, incidenti, avvisi, manutenzioni programmate, pagine di stato, criteri di reperibilità, team — può far partire un workflow. Ognuna offre tre eventi:

- **On Create** — scatta quando ne viene aggiunto uno nuovo.
- **On Update** — scatta quando uno viene modificato.
- **On Delete** — scatta quando uno viene eliminato.

È così che costruisci un "quando succede X in OneUptime, fai Y" senza dover controllare le cose in un ciclo.

Al blocco successivo viene passato il record completo. Per esempio, il trigger **Incident → On Create** passa il nuovo incidente, così il blocco successivo può leggerne titolo, descrizione, gravità e qualsiasi altro campo.

### Gli eventi che i team usano di più

- **Incident** — reagisci quando un incidente viene aperto, aggiornato (preso in carico, risolto) o eliminato.
- **Alert** — gli stessi tre eventi, ma per gli avvisi.
- **Monitor** — reagisci quando un monitor viene aggiunto, modificato o rimosso.
- **Scheduled Maintenance** — annuncia automaticamente una finestra di manutenzione appena viene pianificata.
- **Status Page Subscriber** — dai il benvenuto a chi si iscrive a una pagina di stato.
- **On-Call Duty Policy** — sincronizza i cambi di turno con un altro sistema di reperibilità.

Cerca per nome nel pannello **Add Trigger** per trovare quello che ti serve.

## Quale trigger dovrei usare?

| Se vuoi…                                    | Scegli              |
| ----------------------------------- | ------------------- |
| Cliccare un pulsante per eseguire il workflow | **Manual**    |
| Eseguirlo a intervalli regolari     | **Schedule**        |
| Far arrivare dati da un altro sistema | **Webhook**       |
| Reagire a qualcosa dentro OneUptime | **OneUptime event** |

Un workflow può avere un solo trigger. Se ti servono due modi per avviare la stessa automazione, metti la logica condivisa in un workflow e richiamalo da due workflow "wrapper" leggeri usando il componente **Execute Workflow**.

## Cosa leggere dopo

- [Componenti del workflow](/docs/workflows/components) — le azioni che aggiungi dopo il trigger.
- [Variabili del workflow](/docs/workflows/variables) — leggere l'output del trigger dai blocchi successivi.
- [Esecuzioni e log del workflow](/docs/workflows/runs-and-logs) — verificare che il tuo trigger sia scattato.
