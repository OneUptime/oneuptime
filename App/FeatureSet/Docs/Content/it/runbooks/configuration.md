# Configurazione e sicurezza dei runbook

## Limiti di output

- Output per passo: **50 KB**. Output più grandi vengono troncati con un marcatore.
- Timeout per passo predefinito: **30 secondi** per JavaScript, Bash e HTTP. Configurabile per passo.
- **Claim timeout** predefinito per i passi Bash e JavaScript: **2 minuti** — quanto il Worker aspetta che un Agente Runbook prenda il job prima di farlo fallire.

## Permessi

I permessi dei runbook vivono nel gruppo di permessi `Runbook`:

- `CreateRunbook`, `EditRunbook`, `DeleteRunbook`, `ReadRunbook` — gestire i modelli di runbook.
- `CreateRunbookExecution`, `EditRunbookExecution`, `ReadRunbookExecution` — avviare, spuntare e leggere le esecuzioni.
- `CreateRunbookRule`, `EditRunbookRule`, `DeleteRunbookRule`, `ReadRunbookRule` — gestire le regole di auto-trigger.
- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — gestire gli Agenti Runbook che eseguono i passi Bash nella tua infrastruttura.
- `RunbookManager` (ruolo) — racchiude tutto quanto sopra; assegnalo a un team per dargli pieno accesso ai runbook.

## Coda e worker

Le esecuzioni di runbook girano sulla coda BullMQ `Runbook`. La concorrenza del worker è 25 — regolala nel tuo deploy se hai molte esecuzioni simultanee.

Quando un passo manuale viene spuntato via API, l'esecuzione viene rimessa in coda per continuare al passo successivo. Così il worker resta caldo per il resto del runbook.

## Note di hardening

- I **passi Bash e JavaScript** non girano mai sul Worker di OneUptime. Vengono inviati come job a un [Agente Runbook](/docs/runbooks/agents) che hai installato nella tua infrastruttura. Il Worker mette in coda il job con l'**Agent Tag** e il tipo di passo, un agente lo rivendica atomicamente, lo esegue localmente — Bash via `bash -c <script>`, JavaScript dentro una sandbox `isolated-vm` con il solito preambolo (taglia le catene dei prototype, rimuove `Function` ed `eval`, congela i prototype nativi) — e restituisce il risultato. Il processo Worker stesso non esegue script dei clienti.
- I **passi HTTP** usano un validatore di stato permissivo, quindi una risposta 4xx o 5xx viene registrata come passo fallito invece che lanciata. Così l'output catturato riflette ciò che la controparte ha realmente restituito.

## Tabelle del database

- `Runbook` — modello (nome, slug, descrizione, isEnabled, JSON dei passi).
- `RunbookExecution` — una riga per esecuzione, con chiavi esterne nullable `incidentId`, `alertId` e `scheduledMaintenanceId` e un array JSON `stepExecutions` che fa snapshot di passi e stato per passo.
- `RunbookRule` — regole di auto-trigger con discriminatore `triggerEntityType` (Incident, Alert, ScheduledMaintenance) e una relazione many-to-many ai runbook da avviare.
- `RunbookAgent` — una riga per agente installato: nome, tag, chiave segreta, `lastAlive`, `connectionStatus`, info host.
- `RunbookAgentJob` — una riga per passo Bash o JavaScript dispatchato: tag richiesto, tipo di passo, script, stato (Pending → Claimed → Running → Succeeded/Failed/TimedOut/Cancelled), claim deadline, lease, output, exit code.

## Consigli operativi

- **Esegui almeno un agente per ogni tag che usi**, idealmente due per alta disponibilità. Con due agenti dello stesso tag, l'uno o l'altro può rivendicare un job — puoi fare riavvii a rotazione senza rompere i runbook.
- **Cattura URL, non blob.** Se un passo genera più di qualche KB, scrivilo su S3 o nel tuo stack di log e restituisci l'URL.
- **L'idempotenza conta.** I passi automatizzati (HTTP, JavaScript, Bash) possono girare più di una volta se il worker si riavvia a metà passo o se il lease di un agente scade mentre uno script è in esecuzione; progettali in modo che il retry sia sicuro.
