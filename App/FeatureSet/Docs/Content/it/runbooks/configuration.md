# Configurazione e sicurezza dei runbook

## Come girano davvero Bash e JavaScript

I passi Bash e JavaScript **non vengono mai eseguiti sul Worker OneUptime**. Vengono dispacciati come job a uno specifico [Agente Runbook](/docs/runbooks/agents) — un piccolo processo che installi su un host nella tua infrastruttura.

Il modello di dispatch:

1. L'autore del passo del runbook sceglie un Agente Runbook dal dropdown mentre scrive il passo.
2. Quando il passo viene eseguito, il Worker inserisce una riga in `RunbookAgentJob` con `targetAgentId` impostato sull'ID di quell'agente e status `Pending`.
3. Quello specifico agente (e solo quello) reclama atomicamente il job, esegue lo script localmente — Bash via `bash -c <script>`, JavaScript dentro un sandbox `isolated-vm` — e restituisce il risultato.
4. Il Worker riprende il runbook con il risultato.

Non esiste più alcun flag d'ambiente `RUNBOOK_BASH_ENABLED`. Se i passi Bash o JavaScript funzionino in un deployment dipende interamente dal fatto che esista almeno un Agente Runbook connesso nel progetto.

## Limiti di output e timeout

- Output per passo: **50&nbsp;KB**. Output più grande viene troncato con un marcatore.
- Timeout di esecuzione predefinito per passo: **30 secondi** per JavaScript, Bash e HTTP. Configurabile per passo.
- **Claim timeout** per passo per Bash e JavaScript: **2 minuti** — quanto il Worker aspetta che l'agente selezionato prenda il job prima di farlo fallire.

## Permessi

I permessi runbook vivono nel gruppo di permessi `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — gestire i modelli di runbook.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — avviare, spuntare e leggere le esecuzioni.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — gestire le regole di auto-trigger.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — gestire gli Agenti Runbook che eseguono i passi Bash e JavaScript nella tua infrastruttura.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (ruoli) — assegnabili a un team per concedere controllo totale, uso quotidiano o accesso in sola lettura. `RunbookAdmin` raggruppa tutti i permessi granulari sopra.

## Coda e worker

Le esecuzioni runbook girano sulla coda BullMQ `Runbook`. La concorrenza del worker è 25 — regolala nel tuo deployment se hai molte esecuzioni simultanee.

Quando un passo manuale viene spuntato via API, l'esecuzione viene re-inserita in coda per continuare dal passo successivo. Questo tiene caldo il worker per il resto del runbook.

## Note di hardening

- **JavaScript e Bash** girano su un host Agente Runbook che controlli tu, non sul Worker OneUptime. JavaScript è racchiuso in un sandbox `isolated-vm` con il prelude consueto (interrompe le catene di prototipi, rimuove `Function`/`eval`, congela i prototipi built-in). Bash gira via `bash -c` con applicazione del timeout sull'agente.
- **I passi HTTP** usano un validatore di status permissivo, quindi una risposta 4xx o 5xx viene registrata come passo fallito invece di essere lanciata come eccezione. Così l'output catturato riflette ciò che l'upstream ha effettivamente restituito.
- **L'autenticazione dell'agente** avviene tramite ID + chiave segreta, impostati sul container dell'agente come variabili d'ambiente. Lato server, l'identità autoritativa dell'agente proviene dalla riga DB indicizzata dall'ID/chiave presentati — i client non possono impersonare un altro agente nemmeno con una chiave compromessa.

## Tabelle database

- `Runbook` — modello (nome, slug, descrizione, isEnabled, JSON dei passi).
- `RunbookExecution` — una riga per esecuzione, con foreign key nullable `incidentId`, `alertId` e `scheduledMaintenanceId` e un array JSON `stepExecutions` che cattura i passi e lo stato per passo.
- `RunbookRule` — regole di auto-trigger con un discriminatore `triggerEntityType` (Incident, Alert, ScheduledMaintenance) e una relazione molti-a-molti con i runbook da avviare.
- `RunbookAgent` — una riga per agente installato: nome, chiave segreta, `lastAlive`, `connectionStatus`, info host.
- `RunbookAgentJob` — una riga per passo Bash o JavaScript dispacciato: `targetAgentId` (l'agente scelto dall'autore del passo), tipo di passo, script, status (`Pending` → `Claimed` → `Running` → `Succeeded`/`Failed`/`TimedOut`/`Cancelled`), deadline del claim, lease, output, exit code.

## Consigli operativi

- **Assicurati che l'agente scelto su un passo sia in salute.** Se ti serve ridondanza, esegui un secondo agente e dividi i passi fra loro, o tieni un runbook di backup che punta all'altro agente.
- **Cattura URL, non blob.** Se un passo genera più di qualche KB di output, scrivilo su S3 o sul tuo stack di logging e restituisci l'URL.
- **L'idempotenza conta.** I passi automatizzati (HTTP, JavaScript, Bash) possono essere eseguiti più di una volta se il worker si riavvia a metà passo o se il lease dell'agente scade mentre uno script è ancora in esecuzione; progettali per essere sicuri da rieseguire.
