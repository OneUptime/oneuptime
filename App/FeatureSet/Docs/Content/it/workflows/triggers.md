# Trigger

Un trigger e il primo blocco di un workflow — decide quando il workflow viene eseguito. Ogni workflow ha esattamente un trigger. Puoi sceglierne tra quattro tipologie.

## Manuale

Esegui il workflow su richiesta cliccando **Run Manually** nella pagina del workflow. Puoi incollare un payload JSON che il resto del workflow potra leggere.

Adatto per: automazioni "one-click" per cui vuoi un pulsante, come "ruota questa chiave" o "invia un test di allarme."

**Output**: il JSON che hai incollato, o un oggetto vuoto se non l'hai fornito.

## Schedule

Esegui il workflow su una pianificazione ricorrente utilizzando un'espressione cron.

Adatto per: pulizia notturna, sincronizzazione oraria, report settimanali.

**Impostazione**: un'espressione cron. Alcune comuni:

- `0 * * * *` — ogni ora, allo scoccare dell'ora.
- `*/5 * * * *` — ogni 5 minuti.
- `0 9 * * 1` — ogni lunedi alle 9:00.

Se il sistema e brevemente non disponibile, l'esecuzione viene avviata non appena si riprende — non devi preoccuparti di scatti persi per brevi interruzioni.

## Webhook

OneUptime crea un URL univoco. Qualunque cosa raggiunga quell'URL avvia il workflow. Gli header, i parametri della query e il body della richiesta vengono passati al workflow.

Adatto per: ricevere dati in OneUptime da un altro strumento — callback CI/CD, allarmi da altri sistemi di monitoraggio, registrazioni nel tuo CRM.

**Output**:

- **Request Headers** — tutti gli header della richiesta in arrivo.
- **Request Query Params** — la query string analizzata.
- **Request Body** — il corpo analizzato (o il testo grezzo se non e JSON).

L'URL accetta sia `GET` che `POST`. Il chiamante riceve un riscontro rapido — il workflow vero e proprio viene eseguito in background.

Tratta l'URL come una password. Chiunque lo possieda puo avviare il tuo workflow.

## Trigger sugli eventi di OneUptime

Quasi tutti gli elementi di OneUptime — monitor, incidenti, allarmi, manutenzioni programmate, status page, policy on-call, team — possono attivare un workflow. Ognuno offre tre eventi:

- **On Create** — scatta quando ne viene aggiunto uno nuovo.
- **On Update** — scatta quando ne viene modificato uno.
- **On Delete** — scatta quando ne viene eliminato uno.

Ecco come costruire "quando X accade in OneUptime, fai Y" senza dover controllare le cose in un ciclo.

Il record completo viene passato al blocco successivo. Per esempio, il trigger **Incident → On Create** passa il nuovo incidente, cosi il blocco successivo puo leggerne titolo, descrizione, severita e qualsiasi altro campo.

### Eventi piu utilizzati dai team

- **Incident** — reagisci quando un incidente viene aperto, aggiornato (preso in carico, risolto) o eliminato.
- **Alert** — gli stessi tre eventi per gli allarmi.
- **Monitor** — reagisci quando un monitor viene aggiunto, modificato o rimosso.
- **Scheduled Maintenance** — annuncia automaticamente una finestra di manutenzione quando viene pianificata.
- **Status Page Subscriber** — dai il benvenuto a chi si iscrive a una status page.
- **On-Call Duty Policy** — sincronizza le modifiche alla pianificazione con un altro sistema di turni.

Cerca nel pannello dei trigger per nome per trovare quello che ti serve.

## Quale trigger usare?

| Se vuoi…                                      | Scegli              |
| --------------------------------------------- | ------------------- |
| Cliccare un pulsante per eseguire il workflow | **Manual**          |
| Eseguire su una pianificazione ricorrente     | **Schedule**        |
| Far inviare dati a un altro sistema           | **Webhook**         |
| Reagire a qualcosa all'interno di OneUptime   | **OneUptime event** |

Un workflow puo avere un solo trigger. Se hai bisogno di due modi per avviare la stessa automazione, costruisci la logica condivisa in un workflow e richiamala da due workflow "wrapper" sottili usando il componente **Execute Workflow**.

## Letture successive

- [Componenti](/docs/workflows/components) — le azioni che aggiungi dopo il trigger.
- [Variabili](/docs/workflows/variables) — leggere l'output del trigger dai blocchi successivi.
- [Esecuzioni e log](/docs/workflows/runs-and-logs) — confermare che il trigger sia scattato.
