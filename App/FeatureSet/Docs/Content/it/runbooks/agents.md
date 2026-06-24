# Agenti Runbook

Un **Agente Runbook** è un piccolo processo self-hosted che esegue i passi Bash _e_ JavaScript dei tuoi runbook **dentro la tua infrastruttura**. Il Worker OneUptime non esegue mai i tuoi script — li mette in coda, e l'Agente Runbook scelto dall'autore del passo li reclama, li esegue e restituisce il risultato.

JavaScript continua a girare in un sandbox `isolated-vm`; la differenza è che il sandbox vive sull'host del tuo agente invece che sul nostro.

Questa pagina spiega come installare un agente, puntare i passi Bash e JavaScript verso di esso e gestirlo giorno per giorno.

## Perché esistono gli agenti

Le versioni precedenti di OneUptime eseguivano i passi Bash e JavaScript sul Worker. JavaScript era in sandbox (tramite `isolated-vm`), Bash no. Entrambi avevano problemi per qualunque installazione che andasse oltre un self-hosting mono-tenant:

- **Confine di fiducia.** Chiunque potesse scrivere un runbook poteva eseguire codice sul Worker, con accesso alle variabili d'ambiente e al filesystem del Worker. Il sandbox JavaScript bloccava le cose ovvie ma non poteva impedire a un utente determinato di sondare cosa fosse raggiungibile dalla nostra rete.
- **Raggio d'azione.** La maggior parte dei passi utili vuole operare sull'infrastruttura _del cliente_ ("riavvia questo servizio", "kubectl sul nostro cluster", "cerca un record nel nostro DB interno") — non su quella di OneUptime.

Gli Agenti Runbook capovolgono la situazione. I passi Bash e JavaScript non girano da noi. Girano su un host che controlli tu, e tu decidi cosa quell'host può fare.

## Come funziona

1. Crei un Agente Runbook in OneUptime. OneUptime genera un ID e una chiave segreta.
2. Esegui il container dell'agente su un host della tua infrastruttura con quell'ID/chiave più l'URL del tuo OneUptime.
3. L'agente fa polling su OneUptime ogni pochi secondi chiedendo "c'è lavoro per me?".
4. Quando scrivi un passo Bash o JavaScript, scegli l'agente da un dropdown — il passo è legato a quello specifico agente.
5. Quando il passo viene eseguito, il Worker inserisce una riga di job con `targetAgentId` impostato su quell'agente. Solo quell'agente può reclamarlo.
6. L'agente esegue lo script localmente — `bash -c <script>` per Bash, un sandbox `isolated-vm` per JavaScript — cattura il risultato e lo restituisce. Il Worker riprende il runbook con il risultato.

L'agente ha bisogno solo di **HTTPS in uscita** verso la tua istanza OneUptime. Non accetta alcuna connessione in entrata.

## Installare un agente

### 1. Crea il record dell'agente

Vai su **Runbook → Impostazioni → Agenti** e crea un nuovo agente. Compila:

| Campo           | Note                                                                                                                                    |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Nome**        | Un nome amichevole — di solito `dove-gira-e-cosa-può-fare`, es. `prod-eu-west-1`. È ciò che appare nel dropdown quando scrivi un passo. |
| **Descrizione** | Opzionale. Una frase su cosa questo host riesce a raggiungere. Il te del futuro ti ringrazierà.                                         |

### 2. Copia il comando di installazione

Dopo aver creato l'agente, clicca **Mostra istruzioni di setup** sulla sua riga. Vedrai un comando `docker run` precompilato con ID e chiave di questo agente. **Salva la chiave ora** — puoi rigenerarla in seguito, ma non potrai più vedere lo stesso valore della chiave dopo aver chiuso il modale.

### 3. Eseguilo su un host della tua infrastruttura

Esegui il comando Docker su qualunque host del tuo ambiente che possa:

- raggiungere la tua istanza OneUptime via HTTPS, e
- fare le cose che vuoi che i tuoi passi Bash/JavaScript facciano (es. SSH ad altri host, `kubectl`, parlare con un database).

```bash
docker run --name oneuptime-runbook-agent --restart unless-stopped \
  -e RUNBOOK_AGENT_ID=<agent-id> \
  -e RUNBOOK_AGENT_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runbook-agent:release
```

### 4. Verifica che l'agente sia connesso

Torna su **Runbook → Impostazioni → Agenti**. Entro circa 60 secondi la riga dell'agente dovrebbe passare a `Connected` con un timestamp **Last seen** fresco. Se rimane `Disconnected`:

- Controlla i log del container (`docker logs oneuptime-runbook-agent`) per errori di autenticazione o di rete.
- Verifica che l'host raggiunga il tuo URL OneUptime con `curl`.
- Verifica che ID e chiave siano stati copiati senza spazi bianchi.

## Puntare un passo su un agente

Nel tuo runbook aggiungi un passo Bash o JavaScript. Il form ha un dropdown **Agente Runbook** che elenca ogni agente nel progetto corrente (con un indicatore di connesso/disconnesso):

- Scegli l'agente che deve eseguire questo passo.
- Scrivi il tuo script nell'editor sotto.

Quando il runbook girerà e arriverà al passo, il Worker mette in coda un job indirizzato all'ID di quell'agente. Solo quell'agente può reclamarlo. Bash è eseguito tramite `bash -c`; JavaScript gira dentro un sandbox `isolated-vm` sull'agente (niente filesystem, niente rete, niente `Function`/`eval`).

Ti serve più di un agente? Creali e poi punta i singoli passi su quello più adatto. Se vuoi ridondanza puoi scrivere due runbook (uno per agente) o dividere i passi fra agenti.

## Note operative

### Timeout

A ogni passo Bash o JavaScript si applicano due timeout:

| Timeout               | Default    | Cosa controlla                                                                                                                                                                                                       |
| --------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claim timeout**     | 2 minuti   | Quanto tempo il Worker aspetta che l'agente selezionato reclami il job. Se non lo prende in tempo, il passo fallisce con `TimedOut` e il runbook prosegue (o si ferma, a seconda di **Continua in caso di errore**). |
| **Execution timeout** | 30 secondi | Quanto tempo l'agente lascia girare lo script prima di terminarlo. Configurabile per passo. (Bash riceve `SIGKILL`; l'isolate di JavaScript viene smontato.)                                                         |

La finestra di attesa complessiva del Worker è `claim timeout + execution timeout + qualche secondo`. Scegli numeri che si adattino al passo.

### Lease e heartbeat

Quando un agente reclama un job, riceve un lease breve (30 secondi di default). Mentre lo script gira, l'agente rinnova il lease ogni 10 secondi. Se l'agente muore o perde la rete a metà script, il lease scade e il Worker marca il job come `TimedOut` invece di attendere all'infinito.

I processi figli di Bash **non** vengono cancellati automaticamente quando il lease scade (anche un isolate JavaScript viene lasciato finire, se mai finisce) — ma il Worker smette di aspettarli, e l'agente non potrà inviare un risultato una volta che un'altra rivendicazione ha preso il posto. Progetta gli script per essere sicuri da rieseguire se ti serve l'exactly-once.

### Nessun agente online

Se l'agente selezionato è offline al momento dell'esecuzione del passo, il job resta `Pending` finché il claim timeout non scade, poi fallisce con un messaggio chiaro "nessun agente ha reclamato il job". La pagina degli agenti è il posto dove confermare la copertura prima di lanciare un runbook sul serio.

### Cap sull'output

La somma di stdout + stderr è limitata a **50&nbsp;KB** per passo. Output più grande viene troncato con un marcatore. Se ti serve il log intero, scrivilo su S3 o sul tuo log store dentro lo script e fai `echo` dell'URL.

### Annullamento

Annullare un'esecuzione di runbook (dalla vista esecuzione o dall'API) marca immediatamente come `Cancelled` tutti i suoi job Bash e JavaScript in `Pending`/`Claimed`/`Running`. Un agente che è già a metà script porterà a termine il suo lavoro, ma il suo risultato non sarà accettato dal server.

### Concorrenza

Ogni agente esegue di default un job alla volta. Per permetterne di più, imposta `RUNBOOK_AGENT_CONCURRENCY` sul container dell'agente — ma ricorda che l'agente condivide l'host con qualunque altra cosa ci viva.

## Variabili d'ambiente

L'agente legge queste all'avvio:

| Variabile                                 | Obbligatoria | Default | Note                                                                          |
| ----------------------------------------- | ------------ | ------- | ----------------------------------------------------------------------------- |
| `ONEUPTIME_URL`                           | sì           | —       | URL base della tua istanza OneUptime, es. `https://oneuptime.yourdomain.com`. |
| `RUNBOOK_AGENT_ID`                        | sì           | —       | L'UUID mostrato nel modale di setup dell'agente.                              |
| `RUNBOOK_AGENT_KEY`                       | sì           | —       | Il segreto mostrato nel modale di setup dell'agente.                          |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS`          | no           | `5000`  | Ogni quanto l'agente fa polling per nuovi job.                                |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS`     | no           | `60000` | Ogni quanto l'agente segnala di essere vivo.                                  |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS` | no           | `10000` | Ogni quanto l'agente rinnova il lease di un job in corso.                     |
| `RUNBOOK_AGENT_CONCURRENCY`               | no           | `1`     | Numero massimo di job simultanei su questo agente.                            |

## Rotazione della chiave di un agente

Se una chiave trapela, apri l'agente in OneUptime e rigenera la sua chiave. La vecchia smette di funzionare subito. Aggiorna il container dell'agente con la nuova chiave e riavvialo.

## Permessi

La gestione degli agenti vive sotto il gruppo di permessi Runbook esistente:

- `CreateRunbookAgent`, `EditRunbookAgent`, `DeleteRunbookAgent`, `ReadRunbookAgent` — gestire i record degli agenti.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (ruoli) — assegnabili a un team per concedere controllo totale, uso quotidiano o accesso in sola lettura. `RunbookAdmin` raggruppa tutti i permessi granulari sopra.

I permessi per _scatenare_ un runbook (e quindi far partire il dispatch dei passi Bash e JavaScript) restano `CreateRunbookExecution` / `EditRunbookExecution`.

## API rivolta all'agente

Per i curiosi — l'agente usa questi endpoint, montati sotto `/runbook-agent-ingest`. Sono autenticati tramite ID + chiave dell'agente nel body JSON (o header `x-agent-id` / `x-agent-key`).

| Endpoint                     | Scopo                                                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /heartbeat`            | Liveness; aggiorna `lastAlive`, `connectionStatus`, `hostInfo`, `agentVersion`.                                                                     |
| `POST /claim-next-job`       | Reclamare in modo atomico il job `Pending` più vecchio destinato all'ID di questo agente. Restituisce `{ job: null }` quando non c'è nulla da fare. |
| `POST /job/:jobId/heartbeat` | Rinfrescare il lease del job. Restituisce 404 una volta che il lease è scaduto o il job è terminale.                                                |
| `POST /job/:jobId/result`    | Inviare l'esito finale. Ignorato se il lease è già passato.                                                                                         |

Non dovresti aver bisogno di chiamarli a mano — l'agente fornito lo fa. Sono documentati qui nel caso tu debba costruire un tuo agente perché il nostro non si adatta a un tuo vincolo.
