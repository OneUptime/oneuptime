# Trigger

Un trigger è il nodo di partenza di un workflow. Non ha porta di input — l'esecuzione comincia qui. OneUptime supporta quattro famiglie di trigger; ogni workflow ne usa esattamente uno.

## Manuale

Esegui un workflow su richiesta cliccando **Esegui manualmente** sulla pagina del workflow. Puoi incollare un payload JSON opzionale che il workflow può leggere come `{{Manual.JSON}}`.

Usalo quando vuoi un pulsante che faccia partire un'automazione — un workflow "ruota la chiave on-call" o "ricostruisci l'indice di ricerca" da un clic, che non ha bisogno di una schedulazione ricorrente o di un evento per essere innescato.

**Argomenti**: nessuno.

**Valori di ritorno**:

| Nome | Tipo | Descrizione |
| --- | --- | --- |
| `JSON` | JSON | Il payload JSON fornito al momento dell'esecuzione, oppure un oggetto vuoto. |

## Schedule

Esegui un workflow su una schedulazione cron. Configura la cadenza con un'espressione cron standard.

Usalo per job ricorrenti: pulizia notturna, sincronizzazione oraria, esportazione settimanale.

**Argomenti**:

| Nome | Tipo | Descrizione |
| --- | --- | --- |
| `Schedule at` | CronTab | Espressione cron standard a 5 campi. Per esempio, `0 * * * *` viene eseguito all'inizio di ogni ora, `*/5 * * * *` ogni cinque minuti. |

**Valori di ritorno**:

| Nome | Tipo | Descrizione |
| --- | --- | --- |
| `executedAt` | Date | L'orario schedulato dell'esecuzione. |

I workflow schedulati girano sul Workflow Worker nella regione del progetto. Se il worker è temporaneamente non disponibile, l'esecuzione viene dispatchata quando si riprende — non serve proteggersi da tick persi per brevi interruzioni.

## Webhook

Espone un URL HTTPS univoco a cui un sistema esterno fa `POST`. Gli header, i parametri di query e il body della richiesta sono esposti come valori di ritorno che i componenti a valle possono leggere.

Usalo per ricevere dati *dentro* OneUptime da un sistema di terze parti: callback CI/CD, allarmi da un altro tool di monitoring, signup di clienti dal tuo CRM.

**Argomenti**: nessuno. L'URL viene allocato automaticamente al salvataggio del workflow e mostrato sul nodo trigger. Trattalo come un segreto — chiunque conosca l'URL può innescare il workflow.

**Valori di ritorno**:

| Nome | Tipo | Descrizione |
| --- | --- | --- |
| `Request Headers` | JSON | Tutti gli header dalla richiesta HTTP in arrivo. |
| `Request Query Params` | JSON | La query string parsata. |
| `Request Body` | JSON | Il body della richiesta parsato. Se il body non è JSON valido, arriva come stringa sotto la chiave `raw`. |

Il webhook accetta `GET` e `POST`. La risposta al chiamante è un `200 OK` con un acknowledgment JSON non appena l'esecuzione viene messa in coda — il workflow stesso gira in modo asincrono, quindi non aspettarti di poter leggere il risultato dei componenti a valle nella risposta HTTP.

## Trigger su evento di modello

Quasi ogni entità OneUptime — monitor, incidenti, allarmi, eventi di manutenzione programmata, status page, policy on-call, team, servizi di telemetria e molti altri — espone tre trigger:

- **On Create** — scatta quando viene creato un nuovo record di questo tipo.
- **On Update** — scatta quando un record esistente viene modificato. Il trigger espone sia i valori vecchi sia quelli nuovi.
- **On Delete** — scatta quando un record viene cancellato.

È così che costruisci automazioni "quando succede X in OneUptime, fai Y" senza polling.

Il modello stesso viene esposto come valore di ritorno con gli stessi nomi di campo che vedi sulla risorsa. Ad esempio, il trigger **Incident → On Create** ritorna l'intero oggetto `Incident` cosicché i nodi a valle possano leggere `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}`, ecc.

**Argomenti**: tipicamente nessuno per create/delete. I trigger di update possono permetterti di restringere i campi a cui vuoi reagire, in modo da non scattare su modifiche cosmetiche.

**Valori di ritorno** (variano per modello):

| Nome | Tipo | Descrizione |
| --- | --- | --- |
| Campi del modello | (varia) | Ogni colonna sull'entità — nome, stato, timestamp, foreign key. |
| `previous` (solo Update) | JSON | Il record com'era prima della modifica. |

### Trigger di modello comuni

Una lista non esaustiva degli eventi di modello che i team usano più spesso:

- **Incident** — `On Create`, `On Update` (usalo per reagire a cambi di stato come Acknowledged o Resolved), `On Delete`.
- **Alert** — gli stessi tre eventi sul modello allarme.
- **Monitor** — reagisci quando un monitor viene aggiunto, modificato o rimosso; combinalo con condizioni per agire solo sui monitor di produzione.
- **Scheduled Maintenance** — automatizza annunci a valle quando una finestra di manutenzione viene creata o cambia stato.
- **Status Page Subscriber** — fai partire un flusso di benvenuto quando qualcuno si iscrive.
- **On-Call Duty Policy** — sincronizza i cambi di schedulazione con una rotazione esterna.

Se il modello è esposto nell'API OneUptime, quasi sicuramente può innescare un workflow — cerca nella palette dei trigger per nome dell'entità.

## Scegliere il trigger giusto

| Se vuoi… | Usa |
| --- | --- |
| Costruire un pulsante su un workflow che qualcuno clicca | **Manual** |
| Eseguire un job ogni N minuti/ore/giorni | **Schedule** |
| Far inviare dati a OneUptime da un sistema esterno | **Webhook** |
| Reagire a qualcosa che succede *dentro* OneUptime | **Evento di modello** |

I workflow possono avere un solo trigger. Se hai bisogno che due segnali di partenza diversi condividano la maggior parte della stessa logica, fattorizza i passi condivisi in un solo workflow e chiamalo da due workflow "wrapper" sottili tramite il componente **Execute Workflow** (vedi [Componenti](/docs/workflows/components)).

## Cosa leggere dopo

- [Componenti](/docs/workflows/components) — le azioni da collegare dopo il trigger.
- [Variabili](/docs/workflows/variables) — come leggere i valori di ritorno del trigger dai nodi a valle.
- [Esecuzioni e log](/docs/workflows/runs-and-logs) — come confermare che il tuo trigger sta scattando.
