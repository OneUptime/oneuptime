# Trigger

Un trigger è il primo blocco in un workflow — decide quando viene eseguito il workflow. Ogni workflow ha esattamente un trigger. Puoi scegliere tra quattro tipi.

## Manual

Esegui il workflow su richiesta cliccando **Esegui flusso di lavoro** sulla pagina **Costruttore**, compilando i campi del trigger e confermando con **Run Workflow Manually**. Il trigger Manual accetta un payload JSON che il resto del workflow può leggere.

Utile per: automazioni con un clic per cui vuoi un pulsante, come "ruota questa chiave" o "invia un avviso di prova."

**Output**: il JSON che hai incollato, oppure un oggetto vuoto se non l'hai fatto.

## Schedule

Esegui il workflow su una pianificazione ricorrente usando un'espressione cron.

Utile per: pulizia notturna, sincronizzazione oraria, report settimanali.

**Impostazione**: un'espressione cron. Alcune comuni:

- `0 * * * *` — ogni ora, allo scoccare dell'ora.
- `*/5 * * * *` — ogni 5 minuti.
- `0 9 * * 1` — ogni lunedì alle 9:00.

Se il sistema è temporaneamente non disponibile, l'esecuzione viene recuperata non appena si ripristina — non devi preoccuparti dei tick mancati per interruzioni brevi.

## Webhook

OneUptime crea un URL univoco. Qualsiasi cosa raggiunga quell'URL avvia il workflow. Le intestazioni, i parametri di query e il corpo della richiesta vengono passati in ingresso.

Utile per: ricevere dati in OneUptime da un altro strumento — callback CI/CD, avvisi da altri sistemi di monitoraggio, iscrizioni nel tuo CRM.

**Output**:

- **Request Headers** — tutte le intestazioni della richiesta in arrivo.
- **Request Query Params** — la stringa di query analizzata.
- **Request Body** — il corpo analizzato (o il testo grezzo se non è JSON).

L'URL accetta sia `GET` che `POST`. Chi chiama riceve una rapida conferma di ricezione — il workflow stesso viene eseguito in background.

Tratta l'URL come una password. Chiunque lo possieda può avviare il tuo workflow.

## Trigger di eventi OneUptime

Quasi ogni cosa in OneUptime — monitor, incidenti, avvisi, manutenzioni programmate, pagine di stato, politiche di reperibilità, team — può attivare un workflow. Ciascuno offre tre eventi:

- **On Create** — si attiva quando ne viene aggiunto uno nuovo.
- **On Update** — si attiva quando uno viene modificato.
- **On Delete** — si attiva quando uno viene eliminato.

È così che costruisci "quando succede X in OneUptime, fai Y" senza dover controllare le cose in un ciclo.

Il record completo viene passato al blocco successivo. Ad esempio, il trigger **Incident → On Create** passa il nuovo incidente, così il blocco successivo può leggerne il titolo, la descrizione, la gravità e qualsiasi altro campo.

### Gli eventi più usati dai team

- **Incident** — reagisci quando un incidente viene aperto, aggiornato (riconosciuto, risolto) o eliminato.
- **Alert** — le stesse tre opzioni per gli avvisi.
- **Monitor** — reagisci quando un monitor viene aggiunto, modificato o rimosso.
- **Scheduled Maintenance** — annuncia automaticamente una finestra di manutenzione quando viene programmata.
- **Status Page Subscriber** — dai il benvenuto a chi si iscrive a una pagina di stato.
- **On-Call Duty Policy** — sincronizza le modifiche alla pianificazione con un altro sistema di turni.

Cerca nel pannello **Add Trigger** per nome per trovare quello che ti serve.

## Quale trigger dovrei usare?

| Se vuoi…                                       | Scegli               |
| ----------------------------------------------- | --------------------- |
| Cliccare un pulsante per eseguire il workflow   | **Manual**            |
| Eseguire su una pianificazione ricorrente       | **Schedule**          |
| Far inviare dati da un altro sistema            | **Webhook**           |
| Reagire a qualcosa dentro OneUptime             | **OneUptime event**   |

Un workflow può avere un solo trigger. Se hai bisogno di due modi per avviare la stessa automazione, costruisci la logica condivisa in un workflow e richiamala da due workflow "wrapper" più semplici usando il componente **Execute Workflow**.

## Dove leggere in seguito

- [Componenti del workflow](/docs/workflows/components) — le azioni che aggiungi dopo il trigger.
- [Variabili del workflow](/docs/workflows/variables) — leggere l'output del trigger dai blocchi successivi.
- [Esecuzioni e log del workflow](/docs/workflows/runs-and-logs) — verificare che il tuo trigger si sia attivato.
