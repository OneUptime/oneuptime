# Agenti di runbook

Un **agente di runbook**, chiamato **Runner** nella dashboard, è un piccolo processo self-hosted che esegue i passaggi JavaScript, Bash, SSH e kubectl dei tuoi runbook **nella tua infrastruttura**. Il Worker di OneUptime non esegue mai i tuoi script: li mette in coda, e il Runner scelto da chi ha scritto il passaggio prende in carico ciascuno, lo esegue e restituisce il risultato. Questa pagina è per chi installa e gestisce i Runner. Un passaggio che non sceglie alcun Runner viene eseguito sul [Runner predefinito del progetto](#il-runner-predefinito-del-progetto), se ne hai impostato uno; altrimenti un passaggio JavaScript viene eseguito su un [Runner globale](#runner-globali), uno di quelli che OneUptime esegue per ogni progetto.

:::cards
- [Installare un Runner](#installare-un-runner): Dalla dashboard a un container connesso, in cinque passaggi.
- [Indirizzare un passaggio a un Runner](#indirizzare-un-passaggio-a-un-runner): Collegare un passaggio al Runner che deve eseguirlo.
- [Il Runner predefinito del progetto](#il-runner-predefinito-del-progetto): Il Runner su cui viene eseguito un passaggio o un repository di codice che non ne sceglie nessuno.
- [Runner globali](#runner-globali): I Runner che OneUptime esegue per ogni progetto, e cosa eseguono.
- [Timeout](#timeout): I timeout di presa in carico e di esecuzione, e come interagiscono.
- [Variabili d'ambiente](#variabili-dambiente): Cosa legge il container all'avvio.
:::

## Come funziona

```mermaid title="Cosa passa sulla rete tra un Runner e OneUptime"
flowchart TB
    subgraph cloud["OneUptime"]
        direction LR
        worker["Il Worker mette in coda il passaggio"]
        ingest["API dei Runner"]
    end
    subgraph yours["La tua infrastruttura"]
        direction LR
        runner["Container del Runner"]
        targets["Host, cluster, servizi interni"]
    end
    worker --> ingest
    runner -->|"HTTPS in uscita, ID e chiave del Runner"| ingest
    ingest -->|"Lavoro preso in carico, con i suoi segreti"| runner
    runner -->|"Script, SSH o API di Kubernetes"| targets
```

1. Crei un Runner in OneUptime. OneUptime genera per lui un ID e una chiave segreta.
2. Esegui il container del Runner su un host della tua infrastruttura, con quell'ID, quella chiave e l'URL del tuo OneUptime.
3. Il Runner chiede lavoro a OneUptime ogni 5 secondi e segnala di essere attivo ogni 60 secondi.
4. Quando scrivi un passaggio JavaScript, Bash, SSH o kubectl, scegli il Runner da un menu a tendina, sotto **Altri campi** del passaggio. Il passaggio è legato a quel Runner. Un passaggio che non ne sceglie nessuno viene eseguito sul Runner predefinito del progetto, se ne hai impostato uno, e altrimenti un passaggio JavaScript su **Runner globale**.
5. Quando il passaggio viene eseguito, il Worker mette in coda un lavoro con `targetAgentId` impostato su quel Runner. Solo quel Runner può prenderlo in carico.
6. Il Runner esegue il job in locale — `bash -c <script>` per Bash e kubectl, una sandbox `isolated-vm` per JavaScript, una connessione SSH che esegue lo script con bash sulla macchina —, acquisisce il risultato, vi nasconde i segreti del passaggio e lo rimanda indietro. Il Worker riprende il runbook con il risultato.

Il Runner ha bisogno solo di **HTTPS in uscita** verso la tua istanza di OneUptime. Non accetta connessioni in entrata.

Un Runner conserva solo il suo ID e la sua chiave. Tutto il resto lo riceve con il job che prende in carico: uno script con inserite le [variabili di runbook](/docs/runbooks/variables) che nomina, e la chiave o la password di un passaggio SSH o il kubeconfig di un passaggio kubectl. Riceve un segreto solo se quel segreto glielo consente. Per questo chiunque abbia la chiave di un Runner può agire come quel Runner: tratta la chiave come i segreti che può usare.

## Perché gli script vengono eseguiti su un Runner

Eseguire gli script sul Worker di OneUptime presentava due problemi:

- **Confine di fiducia.** Chiunque potesse scrivere un runbook poteva eseguire codice sul Worker, con accesso a tutto ciò che il Worker poteva raggiungere.
- **Portata.** La maggior parte dei passaggi utili agisce sulla _tua_ infrastruttura («riavvia questo servizio», «cerca un record nel nostro database interno»), non su quella di OneUptime.

Con i Runner, quei passaggi vengono eseguiti su un host che controlli tu, e sei tu a decidere cosa può fare quell'host. I passaggi di richiesta HTTP e IA restano sul Worker, perché non hanno bisogno di nulla della tua rete.

## Runner globali

I Runner globali sono i Runner che OneUptime esegue per ogni progetto. Un passaggio JavaScript che non sceglie un Runner proprio viene eseguito su uno di questi, a meno che il progetto non abbia un [Runner predefinito](#il-runner-predefinito-del-progetto), così puoi scriverlo prima di installare qualsiasi cosa. **Runbook → Agenti di runbook** li elenca sotto **Runner globali**, sopra i tuoi Runner, e il menu a discesa **Runner** di un passaggio JavaScript propone per primo **Runner globale**, o subito dopo il Runner predefinito del progetto. Il menu a discesa di un passaggio Bash, SSH o kubectl lo mostra per ultimo, in grigio, con **Esegue solo passaggi JavaScript.** Quei passaggi vengono eseguiti su un Runner tuo, nella tua rete, mai su uno condiviso da tutti i progetti.

| | Runner globale | Il tuo Runner |
| --- | --- | --- |
| Passaggi che esegue | JavaScript | JavaScript, Bash, SSH e kubectl |
| Cosa può raggiungere un passaggio | Indirizzi pubblici di internet | Ciò che raggiunge il suo host |
| Durata massima di un passaggio | 5 minuti | 1 ora |
| Variabili segrete | Quelle che lasci usare ai Runner globali | Quelle che lo elencano |
| Comandi Bash di OneUptime AI | Mai | Per le regole IA che lo scelgono |
| Correzioni di codice di OneUptime AI | Aperte per la revisione senza compilarle né testarle | Compilate e testate prima che si apra la pull request |

Un Runner globale esegue i passaggi di molti progetti, quindi ogni passaggio è tenuto separato da tutti gli altri:

- Ogni passaggio viene eseguito in una propria sandbox `isolated-vm`, creata per quel passaggio e scartata dopo: niente file, niente processi, niente variabili d'ambiente e niente che resti da un passaggio al successivo.
- Le sue richieste HTTP raggiungono solo indirizzi pubblici di internet, mai un indirizzo privato, di loopback o link-local né un endpoint di metadati cloud, quindi un Runner globale non raggiunge mai la tua rete.
- Riceve una variabile segreta solo quando il suo interruttore **I Runner globali possono usarlo** è attivo, e solo per un passaggio del progetto della variabile.
- Un progetto esegue al massimo tre passaggi alla volta sui Runner globali, così nessun progetto li tiene per sé.

Un Runner globale si occupa anche delle correzioni di codice di OneUptime AI, in ogni repository di codice che lavora su **Runner globale**. Scrive ogni correzione e apre la pull request, ma non esegue alcun comando, nemmeno i comandi di setup, build e test del repository, quindi la pull request dice che la sua verifica è stata saltata. Raggiunge solo server Git su internet, tramite HTTPS, tranne su un OneUptime self-hosted, dove può raggiungere anche i server Git privati che il server stesso può raggiungere.

Scegli uno dei tuoi Runner per un passaggio che deve raggiungere la tua rete, o per tenere il passaggio su host che controlli. Per tenere ogni passaggio sui tuoi Runner, disattiva **Usa i Runner globali** in fondo a **Runbook → Agenti di runbook**. Un passaggio JavaScript che non sceglie alcun Runner viene allora eseguito sul Runner predefinito del progetto oppure, se non ce n'è uno, fallisce, dicendolo, finché non sceglie uno dei tuoi; un passaggio che sceglie uno dei tuoi Runner lo mantiene in ogni caso. Un repository di codice che non sceglie alcun Runner nelle sue impostazioni in Codice lavora anch'esso sul Runner predefinito del progetto oppure, se non ce n'è uno, su un Runner globale, e ha bisogno di uno dei tuoi finché l'interruttore è disattivato; vedi [Codice](/docs/ai/ai-agent#scegli-il-runner-del-repository).

### Da dove vengono i Runner globali

Su OneUptime Cloud li esegue OneUptime. Un'installazione self-hosted ne esegue uno proprio per impostazione predefinita, come esegue le proprie sonde globali: il servizio `global-runner` in Docker Compose e il deployment `globalRunner` nel chart Helm. Ha una propria chiave, `GLOBAL_RUNNER_KEY`, e nient'altro del server.

Un amministratore principale può aggiungerne altri, per eseguire passaggi e correzioni di codice da altri host: nella Dashboard di amministrazione apri **Impostazioni**, poi **Runner globali**, creane uno ed esegui il comando che dà il suo **Mostra ID e chiave** su un host che raggiunge internet.

Per disattivare quello incluso, imposta `GLOBAL_RUNNER_REPLICAS=0` nel `config.env` di Docker Compose, oppure `globalRunner.enabled` a `false` nel chart Helm. Senza alcun Runner globale, **Runbook → Agenti di runbook** elenca solo i tuoi Runner, e ogni passaggio JavaScript e ogni repository di codice ne sceglie uno.

## Prima di iniziare

- **Un host con Docker** nella tua infrastruttura, che raggiunga l'URL del tuo OneUptime in HTTPS e i sistemi su cui agiscono i tuoi passaggi.
- **Un ruolo che crea Runner.** Project Owner, Project Admin, Project Member e Runbook Admin possono crearne uno. Solo un Project Owner, un Project Admin o un Runbook Admin possono vedere la chiave di un Runner, contenuta nel comando di installazione.

## Installare un Runner

### 1. Crea il record dell'agente

Vai in **Runbook → Agenti di runbook** e crea un nuovo agente. Fai clic su **Crea: Runner** e compila i suoi campi, tutti in un'unica pagina:

| Campo | Dove | Note |
| --- | --- | --- |
| **Nome** | Nella pagina | Un nome chiaro, di solito dove gira e cosa può raggiungere, come `prod-eu-west-1`. È ciò che scegli quando scrivi un passaggio. |
| **Descrizione** | Nella pagina | Facoltativa. Una frase su cosa può raggiungere questo host. |
| **Esegue i runbook** | In **Altri campi** | Attivo per impostazione predefinita. Consente a questo Runner di prendere passaggi di runbook. |
| **Etichette** | In **Altri campi** | Facoltative. |

Un Runner applica una modifica alle sue funzionalità al successivo heartbeat; non serve riavviarlo. L'IA non è una funzionalità. Un repository di codice sceglie, nelle sue impostazioni in Codice, il Runner su cui l'IA ci lavora, e la pagina del Runner elenca i repository che lo scelgono. Una regola IA sceglie il Runner su cui OneUptime AI esegue i suoi comandi: è scegliere lì un Runner a permettere ai comandi di OneUptime AI di eseguirsi su di esso.

### 2. Copia il comando di installazione

Nella riga del Runner, fai clic su **Mostra istruzioni di configurazione**. La finestra **Configurazione dell'agente Runbook** mostra un comando `docker run` già compilato con l'ID e la chiave di questo Runner. Lo stesso comando si trova nella pagina del Runner, in **Istruzioni di configurazione**.

Solo un Project Owner, un Project Admin o un Runbook Admin possono leggere la chiave. Gli altri vedono «Non hai l'autorizzazione per visualizzare la chiave di questo agente Runbook» al posto del comando.

### 3. Eseguilo su un host della tua infrastruttura

Esegui il comando su un host del tuo ambiente che possa:

- raggiungere la tua istanza di OneUptime in HTTPS, e
- fare ciò che serve ai tuoi passaggi, ad esempio raggiungere altri host via SSH, chiamare il server API di un cluster o parlare con un database.

```bash
docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<runner-id> \
  -e ONEUPTIME_RUNNER_KEY=<runner-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runner:release
```

### 4. Verifica che l'agente sia connesso

Torna in **Runbook → Agenti di runbook**. Entro un minuto dall'avvio del container, lo **Stato** del Runner dovrebbe indicare **Connesso**, con un **Visto l'ultima volta** recente. Nella pagina del Runner, la scheda **Stato dell'agente Runbook** mostra la sua **Versione dell'agente Runbook** e il suo **Host**. Se resta **Mai connesso** o **Disconnesso**, vedi [Risoluzione dei problemi](#risoluzione-dei-problemi).

### 5. Mantieni l'agente aggiornato

Quando un agente esegue una versione più vecchia del tuo OneUptime, accanto alla sua **Versione dell'agente Runbook** compare un segnale di avviso nella sua pagina. Selezionalo per vedere come aggiornarlo: scarica la nuova immagine e rimuovi il container, poi esegui di nuovo il comando di installazione del passaggio 2. Un agente installato dal chart dell'agente Kubernetes si aggiorna invece con il chart.

```bash
docker pull oneuptime/runner:release
docker rm -f oneuptime-runner
```

## Indirizzare un passaggio a un Runner

:::steps
### Aggiungi un passaggio che viene eseguito su un Runner

Nei **Passaggi** del tuo runbook, aggiungi un passaggio JavaScript, Bash, SSH o kubectl.

### Scegli il Runner

Apri **Altri campi** del passaggio: il suo menu **Runner** elenca ogni Runner del progetto, con il suo stato di connessione, e la riga chiusa indica il Runner su cui viene eseguito il passaggio. Se il progetto non ne ha ancora, il passaggio lo dice e ti indica **Runbooks › Runners**. La prima scelta è ciò su cui viene eseguito un passaggio che non sceglie alcun Runner: il [Runner predefinito del progetto](#il-runner-predefinito-del-progetto), contrassegnato da **Predefinito del progetto**, oppure, per un passaggio JavaScript, **Runner globale**.

### Salva i passaggi

Fai clic su **Salva passaggi**. Quando un'esecuzione raggiunge il passaggio, il Worker mette in coda un lavoro per l'ID di quel Runner, e solo quel Runner può prenderlo in carico. Un passaggio su **Runner globale** attende il Runner globale che si libera.
:::

Bash viene eseguito con `bash -c`. JavaScript viene eseguito in una sandbox `isolated-vm` sul Runner, senza accesso al file system o ai processi; può chiamare API HTTP pubbliche con `axios`, ma non indirizzi di una rete privata. Un passaggio SSH o kubectl accede con una [variabile di runbook](/docs/runbooks/variables) segreta, che deve elencare il Runner del passaggio in **I tuoi Runner che possono usarlo**.

Ti serve più di un Runner? Creali, poi indirizza ogni passaggio a quello adatto. Per la ridondanza, esegui un secondo Runner e dividi i passaggi tra i due, oppure tieni un runbook di riserva i cui passaggi puntano all'altro Runner.

## Il Runner predefinito del progetto

Un progetto può rendere uno dei propri Runner il suo predefinito, come rende predefinita una configurazione Twilio. Ogni passaggio di runbook che non sceglie alcun Runner viene allora eseguito su di esso: i passaggi Bash, SSH e kubectl, e i passaggi JavaScript, che altrimenti verrebbero eseguiti su un Runner globale. Lo stesso vale per l'IA in ogni repository di codice che non sceglie alcun Runner nelle sue impostazioni in Codice.

Per rendere un Runner il predefinito, vai su **Runbook → Agenti di runbook**, apri il menu **⋯** nella riga del Runner, fai clic su **Imposta come predefinito del progetto** e conferma con **Rendi predefinito del progetto**. Oppure apri il Runner e, nella sua scheda **Impostazione predefinita del progetto**, attiva **Usa come predefinito del progetto**. L'elenco contrassegna il predefinito con **Predefinito del progetto**, accanto al suo nome, e così fa il menu a discesa **Runner** di un passaggio, sulla sua prima scelta. Un progetto ha un solo Runner predefinito: rendere predefinito un altro Runner lo sostituisce. **Non usare più come predefinito del progetto**, nello stesso menu, o l'interruttore nella pagina del Runner, smette di usarlo.

Dove viene eseguito un passaggio che non sceglie alcun Runner:

| Il progetto | Un passaggio JavaScript | Un passaggio Bash, SSH o kubectl |
| --- | --- | --- |
| Ha un Runner predefinito | Il Runner predefinito | Il Runner predefinito |
| Non ne ha, e usa i Runner globali | Un Runner globale | Da nessuna parte: il passaggio fallisce, dicendo che non ha un Runner |
| Non ne ha, e non usa i Runner globali | Da nessuna parte: il passaggio fallisce, dicendolo | Da nessuna parte: il passaggio fallisce, dicendo che non ha un Runner |

Un passaggio che ha scelto un Runner lo mantiene, qualunque sia il predefinito, e un passaggio JavaScript può ancora scegliere da sé **Runner globale**. Impostare un predefinito non modifica alcun passaggio salvato.

Il predefinito è uno dei Runner propri del progetto che esegue i passaggi di runbook: non un Runner globale, non il Runner nel cluster installato dall'agente Kubernetes, e non uno con **Esegue i runbook** disattivato. Finché un Runner è il predefinito, il suo **Esegue i runbook** resta attivo. Quando il predefinito non è connesso, il menu a discesa di un passaggio lo dice, e un passaggio su di esso lo attende, come per qualsiasi Runner, finché non scade il suo claim timeout.

I passaggi di runbook e i repository di codice che non scelgono alcun Runner usano il predefinito, e lo seguono quando un altro Runner diventa il predefinito. Una regola IA sceglie il proprio Runner, e una regola nuova parte sul predefinito.

## Note operative

### Timeout

A ogni passaggio eseguito su un Runner si applicano due timeout:

| Timeout | Predefinito | Cosa controlla |
| --- | --- | --- |
| **Timeout di presa in carico** | 2 minuti | Quanto il Worker attende che il Runner scelto prenda in carico il lavoro. Se il Runner non lo prende in tempo, il passaggio fallisce per timeout e il runbook prosegue (o si ferma, a seconda di **Continua in caso di errore**). |
| **Timeout di esecuzione** | 30 secondi | Quanto il Runner lascia girare il passaggio prima di fermarlo. Bash riceve `SIGKILL`; la sandbox di JavaScript viene distrutta. |

Entrambi sono configurabili per passaggio. Apri **Runbook › il tuo runbook › Passaggi**, espandi il passaggio e imposta **Timeout di esecuzione** e **Timeout di presa in carico** (in secondi) in **Altri campi**. Lascia un campo vuoto per usare il valore predefinito. Ognuno accetta da 1 secondo a 1 ora; i valori fuori da questo intervallo vengono riportati nei limiti quando il passaggio viene eseguito.

La finestra di attesa complessiva del Worker è `claim timeout + execution timeout + a few seconds`. Scegli valori adatti al passaggio.

Due cose da tenere presenti quando riduci il claim timeout:

- Il Runner chiede lavoro a ogni ciclo di polling (`ONEUPTIME_RUNNER_POLL_INTERVAL_MS`, 5 secondi per impostazione predefinita). Un claim timeout più breve di un ciclo può scadere prima che un Runner perfettamente sano abbia anche solo visto il lavoro, e il passaggio fallisce allora con lo stesso messaggio di un Runner offline.
- Un Runner esegue un lavoro alla volta per impostazione predefinita (`ONEUPTIME_RUNNER_CONCURRENCY`). Mentre un passaggio lungo lo occupa, gli altri passaggi diretti allo stesso Runner esauriscono i propri claim timeout. Se porti un execution timeout a qualche minuto, aumenta di conseguenza il claim timeout dei passaggi che condividono quel Runner, oppure assegna loro un altro Runner.

### Lease e heartbeat

```mermaid title="Un lavoro tra OneUptime e il suo Runner"
sequenceDiagram
    participant O as OneUptime
    participant R as Runner
    O->>O: Mettere in coda un lavoro per questo Runner
    R->>O: Prendere in carico il lavoro successivo
    O-->>R: Il lavoro, con un lease di 30 secondi
    loop Ogni 10 secondi durante l'esecuzione
        R->>O: Rinnovare il lease
    end
    R->>O: Inviare il risultato
    O->>O: Registrare l'output e proseguire l'esecuzione
```

Quando un Runner prende in carico un lavoro, riceve un lease breve (30 secondi per impostazione predefinita). Mentre il passaggio è in esecuzione, il Runner rinnova il lease ogni 10 secondi. Se il Runner muore o perde la rete a metà di uno script, il lease scade e il Worker segna il lavoro come `TimedOut` invece di attendere per sempre.

I processi figli di Bash **non** vengono annullati automaticamente alla scadenza del lease (anche una sandbox JavaScript viene lasciata finire, se mai finisce), ma il Worker smette di aspettarli e il Runner non può più inviare un risultato una volta che un'altra presa in carico è subentrata. Progetta script che si possano rieseguire senza rischi se per te conta l'esecuzione unica.

### Se il Worker di OneUptime si riavvia a metà di un passaggio

Un'esecuzione di runbook gira su un solo Worker dall'inizio alla fine, quindi un deploy o un crash possono interromperla mentre un passaggio è in corso. Cosa succede dopo dipende dal fatto che l'esecuzione venga ripresa:

- **Viene ripresa.** Il Worker che la riprende trova il lavoro che il tuo passaggio ha già creato e **vi si ricollega**. Attende quel lavoro invece di inviare al tuo Runner una seconda copia dello script. Se il Runner aveva già finito, viene usato il risultato registrato così com'è. Un passaggio viene inviato a un Runner al massimo una volta per esecuzione.
- **Non viene ripresa.** Se l'esecuzione non viene mai ripresa, una scansione la segna come `Failed` quando supera la finestra di presa in carico e di esecuzione configurata per il suo passaggio attuale, con un messaggio che indica quel passaggio. Un'esecuzione non resta mai bloccata in `Running`.

L'unica cosa che questo non può dirti è fin dove è arrivato uno script prima che il Worker sparisse. Un passaggio che era in corso viene segnalato come non riuscito con una nota che potrebbe essere stato eseguito in parte: controlla il sistema di destinazione prima di eseguire di nuovo il runbook.

### Nessun agente online

Se il Runner scelto è offline quando il passaggio viene eseguito, il lavoro attende come `Pending` finché non scade il claim timeout, e poi il passaggio fallisce con "No runbook agent picked up this step before the wait window expired." La pagina **Agenti di runbook** è il posto dove verificare la copertura prima di eseguire un runbook in una situazione reale. Un passaggio su un Runner globale fallisce invece con "No global Runner picked up this step before the wait window expired."

### Limite di output

stdout e stderr insieme sono limitati a **50 KB** per passaggio. L'output più lungo viene troncato con un marcatore. Se ti serve un log completo, scrivilo dallo script nel tuo sistema di log o in uno storage di oggetti e stampa l'URL con `echo`.

### Annullamento

Annullare un'esecuzione di runbook, dalla pagina dell'esecuzione o dall'API, segna subito tutti i suoi lavori `Pending`, `Claimed` e `Running` come `Cancelled`. Un Runner già a metà di uno script porta a termine il suo lavoro, ma il server non ne accetta il risultato, e nessun passaggio successivo del runbook viene inviato.

### Concorrenza

Ogni Runner esegue un lavoro alla volta per impostazione predefinita. Per consentirne di più, imposta `ONEUPTIME_RUNNER_CONCURRENCY` sul container, ma ricorda che il Runner condivide l'host con tutto ciò che vi gira già.

## Variabili d'ambiente

Il Runner legge queste variabili all'avvio:

| Variabile | Obbligatoria | Predefinito | Note |
| --- | --- | --- | --- |
| `ONEUPTIME_URL` | sì | — | URL di base della tua istanza di OneUptime, ad esempio `https://oneuptime.yourdomain.com`. |
| `ONEUPTIME_RUNNER_ID` | sì | — | L'ID del Runner, dal suo comando di installazione. |
| `ONEUPTIME_RUNNER_KEY` | sì | — | La chiave segreta del Runner, dal suo comando di installazione. |
| `ONEUPTIME_RUNNER_POLL_INTERVAL_MS` | no | `5000` | Ogni quanto il Runner chiede nuovi lavori. Un valore sotto `1000` torna al predefinito. |
| `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS` | no | `60000` | Ogni quanto il Runner segnala di essere attivo. Un valore sotto `5000` torna al predefinito. |
| `ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS` | no | `10000` | Ogni quanto il Runner rinnova il lease di un lavoro in corso. Un valore sotto `1000` torna al predefinito. |
| `ONEUPTIME_RUNNER_CONCURRENCY` | no | `1` | Numero massimo di lavori contemporanei su questo Runner. |
| `ONEUPTIME_RUNNER_ENABLE_RUNBOOKS` | no | — | Impostalo su `false` perché questo Runner smetta di prendere passaggi di runbook, qualunque cosa dica la dashboard. Può solo disattivare la funzionalità. |
| `ONEUPTIME_RUNNER_ENABLE_CODE_FIXES` | no | — | Impostalo su `false` perché questo Runner smetta di prendere correzioni di codice con IA, anche per un repository di codice che lo sceglie. |
| `ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS` | no | — | Impostalo su `false` perché questo Runner smetta di eseguire comandi di rimedio con IA, qualunque cosa dica la dashboard. |

## Ruotare la chiave di un agente

Se una chiave viene esposta, reimpostala. La vecchia chiave smette subito di funzionare.

:::steps
### Reimposta la chiave

Apri il Runner da **Runbook → Agenti di runbook**, fai clic su **Reimposta la chiave dell'agente Runbook** e conferma. Il Runner smette di connettersi finché non ha la nuova chiave.

### Esegui il container con la nuova chiave

Copia il nuovo comando dalle **Istruzioni di configurazione** del Runner, rimuovi il vecchio container ed esegui il nuovo comando sullo stesso host:

```bash
docker rm -f oneuptime-runner
```

### Verifica che si riconnetta

In **Runbook → Agenti di runbook**, lo **Stato** del Runner torna a **Connesso** entro un minuto.
:::

## Autorizzazioni

La gestione degli agenti si trova nel gruppo di autorizzazioni Runbooks esistente:

- `CreateRunner`, `EditRunner`, `DeleteRunner`, `ReadRunner` — gestire i record degli agenti.
- `RunbookAdmin`, `RunbookMember`, `RunbookViewer` (ruoli) — `RunbookAdmin` costruisce i runbook, le loro regole e i Runner su cui girano, e li esegue. `RunbookMember` apre i runbook e le loro esecuzioni e li esegue — avvia un'esecuzione, ne completa o salta i passaggi e la annulla — ma non crea, modifica né elimina alcun runbook o Runner. `RunbookViewer` legge i runbook e le loro esecuzioni e non esegue nulla. `RunbookAdmin` raccoglie tutte le autorizzazioni granulari qui sopra.
- I Runner globali non appartengono ad alcun progetto: solo un amministratore principale ne aggiunge, modifica o rimuove uno, nella Dashboard di amministrazione. Chiunque possa leggere i Runner di un progetto li vede, e disattivare **Usa i Runner globali** richiede il permesso di modificare il progetto.

Avviare un runbook (e quindi inviarne i passaggi ai Runner) richiede un ruolo che esegue i runbook — `ProjectOwner`, `ProjectAdmin`, `ProjectMember`, `RunbookAdmin` o `RunbookMember` — oppure `CreateRunbookExecution`; completare, saltare o annullare un'esecuzione accetta anche `EditRunbookExecution`. Un ruolo esegue solo i runbook raggiunti dal suo ambito.

La chiave di un Runner è leggibile solo da Project Owner, Project Admin e Runbook Admin.

## API lato agente

Per i curiosi: il Runner usa questi endpoint, montati in `/runner-ingest`. Il percorso precedente alla fusione, `/runbook-agent-ingest`, viene ancora servito per gli agenti non ancora ridistribuiti, quindi aggiornare il server non li rompe. Vengono autenticati con l'ID e la chiave del Runner nel corpo JSON (`agentId` e `agentKey`), oppure negli header `x-agent-id` e `x-agent-key`.

| Endpoint | Scopo |
| --- | --- |
| `POST /heartbeat` | Segnale di vita. Aggiorna l'ultimo contatto, la versione e le informazioni sull'host del Runner, e restituisce le funzionalità che il progetto gli ha concesso. |
| `POST /claim-next-job` | Prendere in carico in modo atomico il lavoro `Pending` più vecchio destinato all'ID di questo Runner. Restituisce `{ job: null }` quando non c'è nulla da fare. Un Runner globale prende invece in carico il passaggio più vecchio che attende un qualsiasi Runner globale. |
| `POST /job/:jobId/heartbeat` | Rinnovare il lease del lavoro. Restituisce 404 quando il lease è scaduto o il lavoro è terminato. |
| `POST /job/:jobId/result` | Inviare il risultato finale. Viene ignorato se il lease è già passato ad altri. |
| `POST /disconnect` | Disconnettersi in uno spegnimento pulito. |

Non dovresti doverli chiamare a mano: lo fa il container del Runner. Sono documentati qui perché tu possa costruire il tuo agente se hai un vincolo a cui il nostro non si adatta.

## Risoluzione dei problemi

:::details Il Runner resta Mai connesso o Disconnesso
- Controlla i log del container con `docker logs oneuptime-runner` per errori di autenticazione o di rete.
- Verifica che l'host raggiunga l'URL del tuo OneUptime, ad esempio con `curl`.
- Verifica che ID e chiave siano stati copiati senza spazi, e che `ONEUPTIME_URL` sia l'indirizzo con cui apri OneUptime.

**Mai connesso** significa che il Runner non si è mai fatto vivo. **Disconnesso** significa che lo ha fatto, ma non negli ultimi 5 minuti.
:::

:::details I passaggi falliscono con "No runbook agent picked up this step before the wait window expired."
Il Runner del passaggio non ha preso in carico il lavoro entro il suo claim timeout. Verifica che il Runner sia **Connesso**, che **Esegue i runbook** sia attivo e che non sia occupato da un passaggio lungo: esegue un lavoro alla volta, a meno che tu non aumenti `ONEUPTIME_RUNNER_CONCURRENCY`. Un claim timeout più breve dell'intervallo di polling fallisce allo stesso modo.
:::

:::details I passaggi falliscono con "The runbook agent stopped responding while this step was running."
Il Runner ha preso in carico il lavoro, poi ha smesso di rinnovare il lease: si è bloccato, si è riavviato o ha perso la rete. Verifica che sia online, poi controlla il sistema di destinazione prima di eseguire di nuovo il runbook.
:::

:::details Il Runner registra "No capability is enabled"
Tutte le funzionalità sono disattivate per questo Runner. Attiva **Esegue i runbook** nella pagina del Runner in OneUptime. Applica la modifica al successivo heartbeat.
:::

:::details Un passaggio fallisce perché il suo Runner non può usare una variabile segreta
Il passaggio nomina una variabile segreta che non consente l'uso al suo Runner, quindi il Runner non l'ha ricevuta e il passaggio non è stato eseguito. L'errore indica il segreto e cosa cambiare. In **Runbook → Impostazioni → Variabili globali**, o in **Impostazioni → Variabili** del runbook, aggiungi il Runner in **I tuoi Runner che possono usarlo**, oppure attiva **I Runner globali possono usarlo** per un passaggio su un Runner globale. Oppure scegli un Runner che il segreto consente.
:::

:::details Un passaggio kubectl fallisce perché il suo Runner è troppo vecchio
Il passaggio è fallito con "This kubectl step runs a script, and this Runner is too old to run one, so it was not run." Un Runner più vecchio degli script kubectl non può eseguirne uno. Un passaggio Kubernetes portato in uno script kubectl con l'aggiornamento viene ancora eseguito su di esso come l'azione con cui è stato scritto, finché il suo script o il suo kubeconfig non cambiano. Aggiorna il Runner, come mostra [Mantenere aggiornato l'agente](#5-mantieni-lagente-aggiornato), poi esegui di nuovo il runbook.
:::

## Prossimi passi

:::cards
- [Scrivere un runbook](/docs/runbooks/authoring): Scrivere i passaggi che vengono eseguiti sul tuo Runner.
- [Variabili dei runbook](/docs/runbooks/variables): I valori e i segreti che usano i tuoi passaggi, e i Runner che li ricevono.
- [Configurazione e sicurezza dei runbook](/docs/runbooks/configuration): Limiti, autorizzazioni e protezione.
:::
