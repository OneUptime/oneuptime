# Configurazione e sicurezza dei runbook

Questo è il riferimento per operatori e revisori della sicurezza: dove viene eseguito ogni tipo di passaggio, i limiti e i timeout a cui è soggetto un passaggio, chi può fare cosa e come vengono protetti i runbook.

:::cards
- [Dove viene eseguito ogni tipo di passaggio](#dove-viene-eseguito-ogni-tipo-di-passaggio): Il Worker, un Runner o una persona.
- [Limiti di output e timeout](#limiti-di-output-e-timeout): Ogni limite a cui è soggetto un passaggio.
- [Autorizzazioni](#autorizzazioni): Autorizzazioni granulari, i tre ruoli dei runbook e quali runbook raggiunge un ruolo.
- [Note di protezione](#note-di-protezione): Sandbox, accesso di rete e autenticazione dei Runner.
:::

## Dove viene eseguito ogni tipo di passaggio

```mermaid title="Quali passaggi vengono eseguiti dove"
flowchart TB
    subgraph ou["OneUptime"]
        worker["Worker"]
        onworker["Passaggi di<br/>richiesta HTTP<br/>Passaggi IA"]
    end
    subgraph yours["La tua infrastruttura"]
        runner["Runner"]
        onrunner["Passaggi<br/>JavaScript e Bash<br/>Passaggi SSH<br/>e kubectl"]
    end
    person["Una persona"]
    worker --> onworker
    worker -->|"Passaggi<br/>Manual e<br/>approvazioni"| person
    worker --->|"mette in coda<br/>un lavoro<br/>per il Runner<br/>del passaggio"| runner
    runner --> onrunner
```

| Tipo di passaggio | Viene eseguito su | Come |
| --- | --- | --- |
| Manual | Una persona | L'esecuzione attende finché qualcuno non completa o salta il passaggio. |
| JavaScript | Un Runner | In una sandbox `isolated-vm`. |
| HTTP request | Il Worker di OneUptime | Una chiamata HTTP in uscita. |
| Bash | Un Runner | `bash -c <script>`. |
| SSH | Un Runner | Una connessione SSH che esegue lo script con bash sulla macchina, con accesso tramite una [variabile](/docs/runbooks/variables) segreta. |
| kubectl | Un Runner | `bash -c <script>`, con `KUBECONFIG` che punta al cluster. |
| AI | Il Worker di OneUptime | Una chiamata al provider LLM del progetto. |

## Come vengono inviati i passaggi dei Runner

I passaggi JavaScript, Bash, SSH e kubectl **non vengono mai eseguiti sul Worker di OneUptime**. Vengono inviati come lavori a un [agente di runbook](/docs/runbooks/agents) specifico: un piccolo processo che installi su un host della tua infrastruttura. Un passaggio che non ne sceglie nessuno va al [Runner predefinito del progetto](/docs/runbooks/agents#il-runner-predefinito-del-progetto), se ne ha uno; altrimenti un passaggio JavaScript va ai [Runner globali](/docs/runbooks/agents#runner-globali) che OneUptime esegue per ogni progetto.

Il modello di invio:

1. Chi scrive il passaggio del runbook sceglie un Runner dal menu a tendina mentre lo scrive.
2. Quando il passaggio viene eseguito, il Worker inserisce una riga in `RunnerJob` con `targetAgentId` impostato sull'ID di quel Runner, o su quello del Runner predefinito del progetto per un passaggio che non ne ha scelto nessuno, e stato `Pending`. Un passaggio JavaScript che non ne ha scelto nessuno, in un progetto senza Runner predefinito che usa i Runner globali, riceve invece `runsOnGlobalRunner`.
3. Quel Runner specifico (e solo lui) prende in carico il lavoro in modo atomico, lo esegue in locale — Bash e kubectl tramite `bash -c <script>`, JavaScript in una sandbox `isolated-vm`, SSH tramite una connessione alla macchina, ciascuno con le variabili che nomina già inserite — e restituisce il risultato. Qualsiasi Runner globale può prendere in carico un lavoro con `runsOnGlobalRunner`.
4. Il Worker riprende il runbook con il risultato.

Non esiste più il flag d'ambiente `RUNBOOK_BASH_ENABLED`. Il funzionamento di questi passaggi in un'installazione dipende solo dal fatto che il progetto abbia un Runner connesso con **Esegue i runbook** attivo. Un passaggio JavaScript funziona anche su un Runner globale.

## Limiti di output e timeout

| Limite | Valore | Si applica a |
| --- | --- | --- |
| Output per passaggio | **50 KB**. L'output più lungo viene troncato con un marcatore. | Ogni passaggio automatico |
| Execution timeout | **30 secondi** per impostazione predefinita | Passaggi JavaScript, Bash, SSH e kubectl |
| Request timeout | **30 secondi** per impostazione predefinita | Passaggi di richiesta HTTP |
| Claim timeout | **2 minuti** per impostazione predefinita: quanto il Worker attende che il Runner scelto prenda in carico il lavoro prima di farlo fallire | Passaggi JavaScript, Bash, SSH e kubectl |
| Intervallo dei timeout | **Da 1 secondo a 1 ora** | Ogni timeout |
| Attesa di una persona | Nessun limite | Passaggi Manual e approvazioni |

Imposta i timeout passaggio per passaggio, in **Altri campi** del passaggio, nella pagina **Passaggi** del runbook; lascia un campo vuoto per mantenere il valore predefinito. Un valore fuori intervallo viene riportato nei limiti quando il passaggio viene eseguito, così una configurazione digitata male non può né disattivare il timeout né occupare indefinitamente uno slot del Worker.

## Autorizzazioni

Le autorizzazioni dei runbook si trovano nel gruppo di autorizzazioni `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — gestire i modelli di runbook.
- `CreateRunbookExecution`, `EditRunbookExecution`, `DeleteRunbookExecution`, `ReadRunbookExecution` — avviare, spuntare, eliminare e leggere le esecuzioni.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — gestire le regole di attivazione automatica.
- `CreateRunner`, `EditRunner`, `DeleteRunner`, `ReadRunner` — gestire i Runner che eseguono i passaggi nella tua infrastruttura. (Prima della ridenominazione in Runner si chiamavano `*RunbookAgent`; le assegnazioni esistenti sono state migrate, quindi non c'è nulla da riassegnare.)
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (ruoli) — `RunbookAdmin` costruisce i runbook, le loro regole e i Runner su cui girano, e li esegue. `RunbookMember` apre i runbook e le loro esecuzioni e li esegue — avvia un'esecuzione, ne completa o salta i passaggi e la annulla — ma non crea, modifica né elimina alcun runbook o Runner. `RunbookViewer` legge i runbook e le loro esecuzioni e non esegue nulla. `RunbookAdmin` raccoglie tutte le autorizzazioni granulari qui sopra.

Un ruolo esegue i runbook raggiunti dal suo ambito. Un'assegnazione di `RunbookMember`, `RunbookAdmin` o `ProjectMember` limitata ad alcune etichette avvia e fa avanzare le esecuzioni dei runbook che portano quelle etichette, una limitata a **Owned** quelle dei runbook di proprietà del suo team, e il blocco di un'etichetta da parte di un team gli toglie quei runbook. `CreateRunbookExecution` e `EditRunbookExecution` riguardano le esecuzioni, che non hanno etichette, quindi raggiungono ogni runbook del progetto. L'approvazione di un suggerimento di rimedio che avvia un runbook viene verificata allo stesso modo.

La pianificazione e il webhook di un runbook avviano esecuzioni senza nessuno presente, quindi configurarli richiede il permesso di modificare il runbook e di eseguirlo, e lo stesso vale per vederne l'URL del webhook. Disattivarli richiede solo il permesso di modificarlo. Vedi [Trigger dei runbook](/docs/runbooks/triggers#chi-può-configurare-i-trigger).

Le variabili dei runbook sono escluse da `RunbookAdmin`, che le legge soltanto, per sceglierle nei passaggi che scrive. Gestire le variabili richiede `ProjectOwner` o `ProjectAdmin`, oppure i permessi `CreateRunbookSecret`, `EditRunbookSecret`, `DeleteRunbookSecret` e `ReadRunbookSecret`: i permessi dei segreti dei runbook, che hanno mantenuto i loro nomi quando i segreti sono diventati variabili. Vedi [Variabili dei runbook](/docs/runbooks/variables).

Anche le regole del proprietario e delle etichette in **Runbook → Impostazioni** sono fuori da `RunbookAdmin`. Gestirle richiede `ProjectOwner` o `ProjectAdmin`, oppure le autorizzazioni `CreateRunbookOwnerRule` e `CreateRunbookLabelRule` con le loro corrispondenti di modifica, eliminazione e lettura.

Per come si combinano ruoli e autorizzazioni granulari, vedi [Utenti, team e autorizzazioni](/docs/permissions/index).

## Coda e worker

Le esecuzioni dei runbook girano sulla coda BullMQ `Runbook`. Ogni processo Worker esegue fino a 25 esecuzioni alla volta; il numero è fissato nel codice, non da una variabile d'ambiente.

Quando un passaggio manuale viene spuntato tramite l'API, l'esecuzione viene rimessa in coda per proseguire dal passaggio successivo. Attende come `Scheduled` finché un Worker non la riprende, e un'esecuzione in coda non fallisce mai per l'attesa.

## Note di protezione

- **JavaScript, Bash, SSH e kubectl** vengono eseguiti su un host Runner che controlli tu, non sul Worker di OneUptime. JavaScript gira in un isolate `isolated-vm` separato con 128 MB di memoria e senza accesso al file system o ai processi del Runner; può fare richieste HTTP con `axios`, ma le richieste verso reti private e indirizzi di loopback e link-local vengono rifiutate. Bash viene eseguito tramite `bash -c`, con il timeout applicato sul Runner. Un passaggio JavaScript che non ne sceglie nessuno viene eseguito sul Runner predefinito del progetto oppure, se non ce n'è uno, su un Runner globale.
- **I passaggi SSH** accedono solo quando la macchina presenta una delle chiavi host che il passaggio indica. Un passaggio che non ne indica nessuna accetta qualsiasi chiave, e il suo output indica quella che la macchina ha presentato, da indicare nel passaggio.
- **I passaggi HTTP** usano una convalida dello stato permissiva, così una risposta 4xx o 5xx viene registrata come passaggio non riuscito invece di sollevare un'eccezione, e l'output acquisito riflette ciò che il servizio remoto ha davvero restituito. I reindirizzamenti non vengono seguiti. Il Worker non chiama mai indirizzi di loopback o link-local, come un endpoint di metadati cloud; su OneUptime Cloud rifiuta anche gli indirizzi di rete privata, e un OneUptime self-hosted li rifiuta con `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`.
- **I passaggi IA** non vedono mai le note private degli incidenti né i messaggi di Slack e Microsoft Teams, e l'output dei passaggi precedenti viene analizzato alla ricerca di segreti, che vengono oscurati prima di raggiungere il modello. Le immagini incorporate e i dati codificati lunghi vengono esclusi dal prompt. Vedi [AI](/docs/runbooks/authoring#ai).
- **Runner globali**: eseguono solo passaggi JavaScript, ognuno in una sandbox creata per quel passaggio e scartata dopo, che raggiunge solo indirizzi pubblici di internet, per al massimo 5 minuti, e al massimo tre passaggi di uno stesso progetto alla volta. Ricevono solo le variabili segrete del progetto stesso del passaggio attivate per i Runner globali; quello incluso ha una propria chiave e nient'altro del server. Vedi [Runner globali](/docs/runbooks/agents#runner-globali).
- **L'autenticazione dei Runner** avviene tramite ID e chiave segreta, impostati sul container del Runner come variabili d'ambiente. Lato server, l'identità effettiva del Runner proviene dalla riga del database corrispondente all'ID e alla chiave presentati: un client non può spacciarsi per un altro Runner nemmeno con una chiave compromessa.
- **Le variabili segrete** sono cifrate a riposo, mai restituite dall'API e consegnate solo ai Runner che elencano, quando questi prendono in carico un passaggio che le nomina. Una variabile segreta viene consegnata anche a un Runner globale che prende in carico un passaggio del progetto della variabile, quando la variabile consente l'uso ai Runner globali. Il Runner sostituisce ogni segreto ricevuto da un passaggio con `[REDACTED]` in ciò che il passaggio stampa, e OneUptime lo fa di nuovo prima di salvare l'output. Un passaggio di richiesta HTTP, che OneUptime invia da sé, riceve ogni segreto del proprio progetto che nomina, e li nasconde nella risposta che registra.

## Tabelle del database

| Tabella | Cosa contiene |
| --- | --- |
| `Runbook` | Il modello: nome, slug, descrizione, `isEnabled`, etichette e i passaggi in JSON. |
| `RunbookExecution` | Una riga per esecuzione, con le chiavi esterne facoltative `incidentId`, `alertId` e `scheduledMaintenanceId` e un array JSON `stepExecutions` che fotografa i passaggi e lo stato di ciascuno. |
| `RunbookRule` | Le regole di attivazione automatica, con un discriminatore `triggerEntityType` (Incident, Alert, ScheduledMaintenance), una relazione molti-a-molti con i runbook da avviare e ciò che confrontano: una colonna JSON `criteria` (le condizioni) più collegamenti molti-a-molti a monitor, gravità degli incidenti, gravità degli avvisi, etichette ed etichette dei monitor, e pattern per titolo, descrizione, nome del monitor e descrizione del monitor. |
| `Runner` | Una riga per Runner installato: nome, chiave segreta, `lastAlive`, `connectionStatus`, informazioni sull'host e funzionalità. Un Runner globale ha `isGlobalRunner` impostato e nessun progetto; il Runner predefinito del progetto ha `isProjectDefault` impostato. |
| `RunnerJob` | Una riga per passaggio inviato a un Runner: `targetAgentId` (il Runner scelto da chi ha scritto il passaggio), tipo di passaggio, script o payload, stato (`Pending` → `Claimed` → `Running` → `Succeeded`, `Failed`, `TimedOut` o `Cancelled`), scadenza della presa in carico, lease, output e codice di uscita. `runsOnGlobalRunner` segna un passaggio che qualsiasi Runner globale può prendere in carico. |
| `RunbookVariable` | Le variabili dei runbook: quelle globali del progetto e quelle proprie di un runbook, che lo indicano in `runbookId`; il valore di un segreto cifrato, e i Runner che possono ricevere un segreto. |

## Consigli operativi

- **Assicurati che il Runner scelto per un passaggio sia in buona salute.** Se ti serve ridondanza, esegui un secondo Runner e dividi i passaggi tra i due, oppure tieni un runbook di riserva che punti all'altro Runner.
- **Acquisisci URL, non blob.** Se un passaggio produce più di qualche KB di output, scrivilo in uno storage di oggetti o nel tuo sistema di logging e restituisci l'URL.
- **L'idempotenza conta.** Un passaggio di richiesta HTTP o IA viene eseguito di nuovo se il Worker si riavvia a metà del passaggio e l'esecuzione riprende. Un passaggio su un Runner viene inviato al massimo una volta per esecuzione, ma uno script può essere stato eseguito in parte prima di un errore, e potresti eseguire di nuovo il runbook. Progetta i passaggi perché si possano ripetere senza rischi.

## Prossimi passi

:::cards
- [Agenti di runbook](/docs/runbooks/agents): Installare, gestire e risolvere i problemi dei Runner.
- [Variabili dei runbook](/docs/runbooks/variables): I valori e i segreti che usano i passaggi, e i Runner che li ricevono.
- [Utenti, team e autorizzazioni](/docs/permissions/index): Come ruoli, etichette e team decidono chi esegue cosa.
:::
