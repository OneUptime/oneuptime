# Agenti Runbook

Un **Agente Runbook** è un piccolo processo self-hosted che esegue gli step Bash dei tuoi runbook **all'interno della tua infrastruttura**. Il Worker di OneUptime non esegue mai i tuoi comandi shell — li mette in coda, e un Agente Runbook che hai installato nel tuo ambiente li raccoglie, li esegue e rinvia il risultato.

Questa pagina spiega come installare un agente, indirizzare gli step Bash verso di esso e gestirlo quotidianamente.

## Perché esistono gli agenti

Le versioni precedenti di OneUptime eseguivano gli step Bash direttamente sul Worker. Funzionava per deployment self-hosted single-tenant in cui gli operatori avevano già accesso shell alla macchina, ma ha due problemi per tutti gli altri:

- **Confine di fiducia.** Chiunque possa scrivere un runbook può eseguire shell sul Worker, con accesso a tutte le variabili d'ambiente e al filesystem del Worker.
- **Portata.** La maggior parte degli step Bash utili vuole operare sull'infrastruttura del *cliente* ("riavvia questo servizio", "kubectl sul nostro cluster"), non su quella di OneUptime.

Gli Agenti Runbook invertono questo. Gli step Bash non girano da noi. Girano su un host che controlli tu, e sei tu a decidere cosa quell'host può fare.

## Come funziona

1. Crei un Agente Runbook in OneUptime. OneUptime genera un ID e una chiave segreta.
2. Esegui il container dell'agente su un host della tua infrastruttura con quell'ID/chiave più il tuo URL OneUptime.
3. L'agente chiede a OneUptime ogni pochi secondi: "c'è lavoro per me?"
4. Quando viene eseguito uno step Bash, il Worker inserisce una riga di job marcata con l'**Agent Tag** dello step e ne mette lo stato a `Pending`.
5. Qualsiasi agente sano dello stesso progetto che porti quel tag rivendica il job (in modo atomico — mai due agenti eseguono lo stesso job), esegue `bash -c <tuo script>` localmente, cattura stdout/stderr/exit code, e rinvia il risultato.
6. Il Worker riprende il runbook con il risultato.

L'agente ha bisogno solo di **HTTPS in uscita** verso la tua istanza OneUptime. Non accetta alcuna connessione in ingresso.

## Installare un agente

### 1. Creare il record dell'agente

Vai su **Runbooks → Agents → Crea nuovo**. Compila:

| Campo | Note |
| --- | --- |
| **Nome** | Un nome parlante — di solito `dove-gira-e-cosa-può-fare`, es. `prod-eu-west-1`. |
| **Descrizione** | Opzionale. Una frase su cosa può raggiungere questo host. Il tuo io futuro ti ringrazierà. |
| **Tag** | Separati da virgole. Gli step Bash mirano a un tag; qualsiasi agente nel progetto con quel tag può eseguirli. Schemi comuni: `prod`, `staging`, `eu-west-1`, `db-host`. |

### 2. Copiare il comando di installazione

Dopo aver creato l'agente, clicca **Mostra istruzioni di setup** nella sua riga. Vedrai un comando `docker run` precaricato con ID e chiave di questo agente. **Salva la chiave ora** — puoi resettarla in seguito, ma non potrai rivedere lo stesso valore dopo aver chiuso il modale.

### 3. Eseguirlo su un host della tua infrastruttura

Esegui il comando Docker su un qualsiasi host del tuo ambiente che possa:

- raggiungere la tua istanza OneUptime via HTTPS, e
- fare le cose che vuoi facciano i tuoi step Bash (es. SSH verso altri host, `kubectl`, parlare con un database).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.tuo-dominio.com \
  -d oneuptime/runbook-agent:release
```

### 4. Verificare che l'agente sia connesso

Torna su **Runbooks → Agents**. Entro circa 60 secondi la riga dell'agente dovrebbe passare a `Connected` con un timestamp **Last seen** fresco. Se rimane `Disconnected`:

- Controlla i log del container (`docker logs oneuptime-runbook-agent`) per errori di autenticazione o di rete.
- Verifica che l'host raggiunga l'URL OneUptime con `curl`.
- Verifica che ID e chiave siano stati copiati senza spazi.

## Tag e routing

I tag sono il modo in cui uno step Bash trova un agente. Alcuni schemi:

- **Un tag per ambiente.** Tagga l'agente di prod `prod`, quello di staging `staging`. Gli step Bash che puntano a `prod` girano solo su prod.
- **Un tag per regione.** `eu-west-1`, `us-east-1`. Utile quando uno step deve girare vicino alla risorsa che tocca.
- **Più agenti, stesso tag.** Avvia due agenti entrambi taggati `prod`. Ognuno può rivendicare un job — ottieni alta disponibilità e puoi fare riavvii a rotazione senza rompere i runbook.
- **Più tag per agente.** Un agente nel tuo cluster prod EU potrebbe portare `prod`, `eu-west-1` e `kubernetes`. Gli step Bash possono puntare a uno qualsiasi.

Uno step Bash **deve** specificare esattamente un tag agente. Il routing multi-tag (girare su qualsiasi agente che abbia `prod` AND `db`) è nella roadmap, non in questa release.

## Puntare uno step Bash su un agente

Nel tuo runbook, aggiungi uno step Bash. Il form chiederà un **Agent Tag**:

- Inserisci il tag corrispondente all'agente o agli agenti su cui vuoi farlo girare.
- Scrivi il tuo script nell'editor sotto.

Quando il runbook gira e raggiunge questo step, il Worker accoda un job con quel tag. Se almeno un agente sano con quel tag è online, il job viene rivendicato in pochi secondi ed eseguito.

## Note operative

### Timeout

A ogni step Bash si applicano due timeout:

| Timeout | Default | Cosa controlla |
| --- | --- | --- |
| **Claim timeout** | 2 minuti | Quanto il Worker aspetta che *qualche* agente rivendichi il job. Se nessuno lo prende in tempo, lo step fallisce con `TimedOut` e il runbook prosegue (o si ferma, a seconda di **Continua in caso di errore**). |
| **Execution timeout** | 30 secondi | Quanto l'agente lascia girare lo script prima di mandare `SIGKILL`. Configurabile per step. |

La finestra totale di attesa del Worker è `claim timeout + execution timeout + qualche secondo di margine`. Scegli numeri adatti allo step.

### Lease e heartbeat

Quando un agente rivendica un job, riceve un lease breve (30 secondi di default). Mentre lo script gira, l'agente rinnova il lease ogni 10 secondi. Se l'agente muore o perde la rete a metà script, il lease scade e il Worker marca il job `TimedOut` invece di aspettare all'infinito.

Il processo figlio dello script **non** viene cancellato automaticamente quando scade il lease — ma il Worker smette di aspettarlo, e l'agente non potrà inviare un risultato una volta che un altro claim ha preso il sopravvento. Progetta gli script come sicuri da rieseguire se ti interessa l'"exactly-once".

### Nessun agente online

Se nessun agente sano con il tag dello step è online al momento dell'esecuzione, il job resta `Pending` finché non scade il claim timeout, poi fallisce con un messaggio chiaro ("no agent claimed the job"). La pagina Agents è dove confermi la copertura prima di lanciare un runbook sul serio.

### Limite di output

stdout + stderr combinati sono limitati a **50 KB** per step. Output più lungo viene troncato con un marker. Se ti serve il log completo, scrivilo su S3 o sul tuo sistema di log dallo script ed `echo` l'URL.

### Cancellazione

Cancellare un'esecuzione di runbook (dalla vista esecuzione o dall'API) marca immediatamente come `Cancelled` tutti i suoi job Bash `Pending`/`Claimed`/`Running`. Un agente già a metà script finirà il lavoro, ma il suo risultato non sarà accettato dal server.

### Concorrenza

Ogni agente esegue un job alla volta per default. Per permetterne di più, imposta `RUNBOOK_AGENT_CONCURRENCY` sul container dell'agente — ma ricorda che l'agente condivide l'host con tutto il resto che vi gira sopra.

## Variabili d'ambiente

L'agente le legge all'avvio:

| Variabile | Obbligatoria | Default | Note |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | sì | — | URL base della tua istanza OneUptime, es. `https://oneuptime.tuo-dominio.com`. |
| `RUNBOOK_AGENT_ID` | sì | — | L'UUID mostrato nel modale di setup dell'agente. |
| `RUNBOOK_AGENT_KEY` | sì | — | Il segreto mostrato nel modale di setup dell'agente. |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS` | no | `5000` | Ogni quanto l'agente richiede nuovi job. |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS` | no | `60000` | Ogni quanto l'agente segnala di essere vivo. |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | no | `10000` | Ogni quanto l'agente rinnova il lease di un job in corso. |
| `RUNBOOK_AGENT_CONCURRENCY` | no | `1` | Numero massimo di job simultanei su questo agente. |

## Ruotare la chiave di un agente

Se una chiave trapela, apri l'agente in OneUptime e resettagli la chiave. La vecchia smette di funzionare immediatamente. Aggiorna il container dell'agente con la nuova chiave e riavvialo.

## Permessi

La gestione degli agenti vive sotto il gruppo permessi Runbooks esistente:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — gestire i record degli agenti.
- `RunbookManager` (ruolo) — racchiude tutti i precedenti.

I permessi per *avviare* un runbook (e quindi dispatchare step Bash) restano `CreateRunbookExecution` / `EditRunbookExecution`.

## API esposta agli agenti

Per i curiosi — l'agente usa questi endpoint, montati sotto `/runbook-agent-ingest`. Sono autenticati dall'ID + chiave dell'agente nel corpo JSON (o header `x-agent-id` / `x-agent-key`).

| Endpoint | Scopo |
| --- | --- |
| `POST /heartbeat` | Vivacità; aggiorna `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion`. |
| `POST /claim-next-job` | Rivendica atomicamente il job `Pending` più vecchio il cui tag corrisponde a uno dei tag di questo agente. Ritorna `{ job: null }` se non c'è nulla da fare. |
| `POST /job/:jobId/heartbeat` | Rinnova il lease del job. Ritorna 404 una volta che il lease è scaduto o il job è terminale. |
| `POST /job/:jobId/result` | Invia il risultato finale. Ignorato se il lease è già passato a un altro. |

Non dovresti aver bisogno di chiamarli a mano — l'agente incluso lo fa. Sono documentati qui nel caso tu voglia costruire un tuo agente perché il nostro non ti calza.
