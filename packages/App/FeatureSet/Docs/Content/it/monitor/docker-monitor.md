# Monitor Docker

Un monitor Docker sorveglia i container di un host Docker e vi avvisa quando un container si surriscalda, esaurisce la memoria o entra in un loop di riavvii. Legge le metriche che l'agente Docker di OneUptime invia dall'host, quindi niente viene sondato dall'esterno: installate l'agente, poi create il monitor da un modello o dalla vostra query.

:::cards
- [Creare il monitor](#creare-un-monitor-docker): Sei passaggi nella dashboard.
- [Modelli](#modelli-di-avviso-pronti): Sette avvisi pronti, un incidente per container.
- [Metriche](#metriche-raccolte): Cosa raccoglie l'agente e cosa significa ogni metrica.
- [Log](#log-raccolti): I log dei container e il driver di log di cui hanno bisogno.
:::

## Come funziona

L'agente Docker di OneUptime viene eseguito come container sull'host. Ogni 30 secondi legge le statistiche dei container dall'API di Docker Engine, segue i file di log dei container e invia entrambi a OneUptime tramite OTLP. I primi dati di un host lo registrano in OneUptime.

Un monitor Docker è legato a un host. Ogni minuto esegue la sua query sulle metriche dei container di quell'host e confronta il risultato con i suoi criteri.

```mermaid title="Da un host Docker all'incidente"
flowchart TB
    subgraph host["Il vostro host Docker"]
        direction LR
        containers["Container"] --> agent["Agente Docker di OneUptime"]
    end
    agent -->|"metriche e log tramite OTLP"| oneuptime["OneUptime"]
    oneuptime -->|"primi dati"| registered["Host Docker registrato"]
    oneuptime --> monitor["Monitor Docker"]
    monitor -->|"ogni minuto"| criteria{"Criteri soddisfatti?"}
    criteria -->|"sì"| incident["Incidente o avviso"]
    criteria -->|"no"| online["Monitor online"]
```

## Prima di iniziare

- **Installate l'agente Docker** sull'host. La [guida all'agente Docker](/docs/telemetry/docker-host) spiega come installarlo, aggiornarlo e verificarlo.
- **Verificate che l'host sia registrato.** Compare in **Prodotti → Infrastruttura → Docker → Tutti gli host**, con il nome del `DOCKER_HOST_NAME` dell'agente, appena arrivano i suoi primi dati.
- **Per i log dei container**, eseguite i container con il driver di log `json-file` di Docker. Vedete [Requisito del driver di log](#requisito-del-driver-di-log).

## Creare un monitor Docker

:::steps
### Iniziare un nuovo monitor

Andate in **Monitor** e fate clic su **Crea monitor**.

### Scegliere Docker Container

In **Tipo di monitor**, fate clic su **Altri tipi di monitor** e scegliete **Docker Container** in **Infrastruttura**, oppure digitate `docker` nella casella di ricerca. Inserite un **Nome** – viene usato nei titoli di incidenti e avvisi – e fate clic su **Avanti**.

### Scegliere l'host

In **Configurazione monitor Docker**, scegliete l'host da **Host Docker**. Ogni host che ha inviato dati è nell'elenco. Una volta scelto, una riga sotto il campo dice se arrivano dati. **Aggiungi host Docker** apre i passi di configurazione con le vostre chiavi già inserite, che attendono i primi dati.

### Scegliere cosa sorvegliare

Un nuovo monitor parte da **Host Stopped Reporting**, in **Su cosa avvisare**. Per controllare altro:

- **Cambia** – scegliete un altro [modello](#modelli-di-avviso-pronti). Imposta la metrica, l'aggregazione, l'intervallo di tempo e le soglie, e sostituisce i criteri più sotto con i propri. Potete comunque cambiare l'**Intervallo di tempo**.
- **Custom Metric** (in **Altri campi**) – scegliete una metrica da **Metrica Docker**, poi impostate **Aggregazione** e **Intervallo di tempo**. **Nome del container** e **Immagine del container** la restringono ad alcuni container.
- **Avanzato** (in **Altri campi**) – costruite voi query e formule in **Seleziona metriche**. Usate **Raggruppa per** `resource.container.name` per giudicare ogni container separatamente.

### Rivedere i criteri

Aprite ogni criterio in **Criteri del monitor** e verificatene **Metrica**, **Aggregazione**, **Condizione** e **Soglia**. Un modello li compila. Con **Custom Metric** o **Avanzato**, il monitor parte con i [criteri predefiniti](#criteri-predefiniti), che notano solo una metrica che non invia dati, quindi impostate la vostra soglia.

### Creare il monitor

Fate clic su **Crea monitor**. OneUptime apre la pagina del monitor e lo valuta ogni minuto. Gli incidenti e gli avvisi che genera compaiono anche nelle pagine **Incidenti** e **Avvisi** dell'host.
:::

> [!TIP]
> Per configurare più modelli alla volta, aprite l'host da **Prodotti → Infrastruttura → Docker** e andate in **Raccomandazioni**. Scegliete i modelli che volete, scegliete chi viene avvisato, e OneUptime crea un monitor per modello.

## Impostazioni del monitor

| Campo | Scheda | Cosa fa |
| --- | --- | --- |
| **Host Docker** | Tutte | Obbligatorio. Limita ogni query al `resource.host.name` dell'host. OneUptime aggiunge anche `resource.container.runtime = docker` a ogni query. |
| **Metrica Docker** | Custom Metric | Una metrica del catalogo dell'agente, raggruppata in CPU, memoria, rete, I/O a blocchi e container. |
| **Nome del container** | Custom Metric, Avanzato | Facoltativo. Corrispondenza esatta su `resource.container.name`, per esempio `my-container`. |
| **Immagine del container** | Custom Metric, Avanzato | Facoltativo. Corrispondenza esatta su `resource.container.image.name`, per esempio `nginx:latest`. |
| **Aggregazione** | Custom Metric | Come vengono combinati i campioni: **Media**, **Massimo**, **Minimo**, **Somma** o **Conteggio**. Parte dall'aggregazione abituale della metrica. |
| **Intervallo di tempo** | Tutte | La finestra mobile che la query legge, da **Past 1 Minute** a **Past 365 Days**. Un nuovo monitor parte da **Past 1 Minute**; i modelli impostano la propria. |
| **Seleziona metriche** | Avanzato | Il costruttore di query: **Metrica**, **Aggregate by**, **Filter by attributes**, **Raggruppa per**, più **Aggiungi metrica** e **Aggiungi formula** per combinare le query. |

## Modelli di avviso pronti

L'elenco di **Su cosa avvisare** offre sette modelli. Ognuno costruisce un monitor completo: una query, un criterio che scatta e uno che ripristina. Tutti i modelli tranne **Host Stopped Reporting** raggruppano la loro query per `resource.container.name`, così ogni container viene giudicato separatamente, un container occupato non ne nasconde un altro, e ogni container che supera la soglia riceve il proprio incidente e il proprio avviso. Le soglie sono punti di partenza modificabili.

Salvo diversa indicazione nella tabella, un criterio scatta solo quando la condizione vale per ogni minuto della sua finestra, e si ripristina il 10% oltre la soglia, così un valore che oscila sul limite non cambia stato di continuo.

| Modello | Gravità | Sorveglia | Scatta quando | Si ripristina quando |
| --- | --- | --- | --- | --- |
| Host Stopped Reporting | Critico | `container.memory.percent`, Count su tutti i container dell'host, ultimi 10 minuti | Nessun dato per tutta la finestra | I dati tornano ad arrivare |
| High Container CPU Usage | Warning | `container.cpu.utilization`, Max per container, ultimi 5 minuti | Sopra 80 (% di un core) | A 72 o meno |
| High Container Memory Usage | Warning | `container.memory.percent`, Max per container, ultimi 5 minuti | Sopra l'85% | Al 76,5% o meno |
| Container Restart Loop | Critico | `container.restarts.increase`, Sum per container, ultimi 15 minuti | Più di 3 riavvii nella finestra (Somma) | 2,7 o meno |
| Container CPU Throttling | Warning | Crescita di `container.cpu.throttling_data.throttled_time` in ms per container, ultimi 5 minuti | Più di 1000 ms nella finestra (Somma) | 900 ms o meno |
| High Container Process Count | Warning | `container.pids.count`, Max per container, ultimi 5 minuti | Sopra 2000 | A 1800 o meno |
| Container Restarted (Low Uptime) | Critico | `container.uptime`, Min per container, ultimo 1 minuto | Meno di 120 secondi | 132 secondi o più |

**Gravità** è l'etichetta che mostra il selettore. L'incidente e l'avviso creati da un modello partono dalla gravità di incidente e di avviso più alta del vostro progetto; cambiatele nei criteri.

> [!NOTE]
> **Host Stopped Reporting** scatta quando dall'host non arriva nulla per dieci minuti: l'host è giù, oppure l'agente si è fermato, ha perso la connessione a OneUptime o si è visto revocare il token. Si risolve quando i dati tornano ad arrivare. Quando i dati smettono di arrivare, gli altri modelli non hanno nulla da confrontare e mantengono il loro ultimo stato, quindi è questo il modello che ve lo segnala. Un host senza altri container continua comunque a inviare dati, perché l'agente gira come container e invia i propri.

> [!NOTE]
> `container.cpu.utilization` è il numero stampato da `docker stats`, in media sull'intervallo di 30 secondi dell'agente: il 100% è un core di CPU intero, non l'intero host, quindi un container che usa due core segna 200. Su un host multicore la soglia di 80 è un budget di CPU, non una quota della macchina.

> [!NOTE]
> `container.memory.percent` divide per il limite di memoria del container quando è impostato, e altrimenti per la memoria totale **dell'host**. Verificate se il container è stato avviato con `--memory` prima di trattare un superamento come un'imminente terminazione per memoria esaurita.

> [!WARNING]
> `container.cpu.throttling_data.throttled_time` cresce soltanto, quindi **Container CPU Throttling** avvisa in base a quanto è cresciuto nella finestra: una query di Massimo e una di Minimo al minuto, sottratte da una formula e sommate. Con la raccolta dell'agente ogni 30 secondi, questo vede circa metà della limitazione reale, e la soglia ne tiene già conto. Se portate il `collection_interval` dell'agente a 60 secondi o più, ogni minuto contiene un solo campione e il modello smette di avvisare.

> [!NOTE]
> Anche `container.restarts` cresce soltanto, finché un riavvio manuale o un container ricreato non lo fa ripartire da 0, quindi l'agente invia anche `container.restarts.increase` con ogni campione: i riavvii dal suo campione precedente del container. **Container Restart Loop** li somma, quindi conta ogni riavvio per quanto distanti siano i campioni, e un riavvio manuale non conta. Docker segnala come in esecuzione un container che sta riavviando, quindi l'agente continua a campionare un container in un loop di riavvii tra un'esecuzione e l'altra. Un agente più vecchio non invia `container.restarts.increase`: prima [aggiornatelo](/docs/telemetry/docker-host#aggiornare-lagent). Un monitor creato dal modello prima di allora legge di quanto è cresciuto `container.restarts` entro ogni minuto, e così perde circa metà dei riavvii di un loop: eliminatelo e create di nuovo il modello.

> [!CAUTION]
> `container.uptime` esiste solo per i container in esecuzione. Un container che si ferma e resta fermo non invia dati, quindi **Container Restarted (Low Uptime)** coglie riavvii e nuovi deploy, non uno spegnimento definitivo. Un container pensato per girare meno di due minuti resta in stato di avviso per tutta la sua vita. Per un servizio che deve restare attivo, sorvegliate anche ciò che serve, per esempio con un [monitor API](/docs/monitor/api-monitor).

## Metriche raccolte

L'agente usa il receiver OpenTelemetry `docker_stats` sul socket di Docker, ogni 30 secondi. Le metriche di ogni container portano la sua identità come attributi di risorsa: `resource.container.name`, `resource.container.image.name`, `resource.container.id`, `resource.container.runtime` (`docker`) e `resource.host.name`.

### CPU

| Metrica | Descrizione |
| --- | --- |
| `container.cpu.utilization` | CPU usata in ogni intervallo di 30 secondi, dove il 100% è un core di CPU intero (la colonna CPU% di `docker stats`). |
| `container.cpu.usage.total` | Tempo di CPU usato dall'avvio del container, in nanosecondi. Un contatore sull'intera vita. |
| `container.cpu.throttling_data.throttled_time` | Nanosecondi in cui il container è stato limitato dal suo limite di CPU dall'avvio. Un contatore sull'intera vita. |
| `container.cpu.throttling_data.throttled_periods` | Periodi di limitazione dall'avvio del container. Un contatore sull'intera vita. |

### Memoria

| Metrica | Descrizione |
| --- | --- |
| `container.memory.usage.total` | Memoria in uso, in byte. |
| `container.memory.usage.limit` | Limite di memoria, in byte. |
| `container.memory.percent` | Utilizzo della memoria come percentuale del limite del container, o della memoria totale dell'host quando il container non ha limite. |

### Rete

| Metrica | Descrizione |
| --- | --- |
| `container.network.io.usage.rx_bytes` | Byte ricevuti. Un contatore sull'intera vita. |
| `container.network.io.usage.tx_bytes` | Byte inviati. Un contatore sull'intera vita. |

### I/O a blocchi

| Metrica | Descrizione |
| --- | --- |
| `container.blockio.io_service_bytes_recursive` | Byte letti e scritti su ogni dispositivo a blocchi dall'avvio del container, divisi per `operation` (`read`, `write`). Un contatore cumulativo. L'elenco lo offre filtrato sulle letture e sulle scritture. |

### Container

| Metrica | Descrizione |
| --- | --- |
| `container.uptime` | Secondi dall'avvio del container. La comunicano solo i container in esecuzione. |
| `container.restarts` | Quante volte il container si è riavviato da quando è stato creato. Un contatore sull'intera vita. |
| `container.restarts.increase` | Riavvii dal campione precedente del container da parte dell'agente, inviati con ogni campione. La loro somma su una finestra sono i riavvii in quella finestra, quindi avvisate su questo e non sul contatore sull'intera vita. |
| `container.pids.count` | Task nel container. Il controller pids del cgroup conta i thread oltre ai processi. |

`container.cpu.throttling_data.throttled_periods` non è nell'elenco; interrogatela da **Avanzato**.

## Criteri di monitoraggio

Un criterio confronta una delle query o formule del monitor con una soglia. I criteri di un monitor Docker non hanno un **Tipo di filtro**: ogni regola controlla il valore della metrica, con questi campi.

| Campo | Cosa fa |
| --- | --- |
| **Metrica** | La query o la formula da controllare, tramite il suo nome di variabile. |
| **Aggregazione** | Come i valori della finestra diventano un'unica risposta: **Media**, **Somma**, **Maximum Value**, **Minimum Value**, **All Values** (ogni valore deve corrispondere, su tutta la finestra) o **Any Value** (ne basta uno). |
| **Condizione** | **Maggiore di**, **Minore di**, **Maggiore o uguale a**, **Minore o uguale a** o **Uguale a**, oppure una condizione di anomalia: **Anomalously High**, **Anomalously Low** o **Anomalous**. **Nessun dato** è vera quando la query non ha restituito nulla nella finestra, **Dati presenti** quando ha restituito qualcosa. |
| **Soglia** | Il valore con cui confrontare. Accanto c'è un elenco di unità quando la metrica ha un'unità. Non viene mostrato per le condizioni di anomalia. |
| **Sensibilità** | Solo condizioni di anomalia. **Bassa** (4σ), **Media** (3σ, il predefinito) o **Alta** (2σ). |
| **Finestra di riferimento** | Solo condizioni di anomalia. 14 giorni (il predefinito), 28, 60 o 90 giorni di storico. |
| **Se nessun dato** | In **Altri campi**. Cosa succede quando la finestra non ha campioni: **Ignore** (predefinito), **Treat As Zero** o **Trigger**. |

Le condizioni di anomalia confrontano ogni valore con la stessa ora della settimana nella baseline. Restano in uno stato «Learning», e non generano nulla, finché la finestra di riferimento non contiene abbastanza storico.

Ogni criterio indica anche cosa fare quando corrisponde: cambiare lo stato del monitor, creare un avviso o dichiarare un incidente. I criteri vengono controllati dall'alto verso il basso, e decide il primo che corrisponde.

### Criteri predefiniti

Un monitor che non create da un modello parte con due criteri:

| Ordine | Criterio | Corrisponde quando | Poi |
| --- | --- | --- | --- |
| 1 | Check if _monitor name_ is offline | La prima query non ha dati per l'intera finestra | Segna il monitor come **Offline** e dichiara l'incidente «_monitor name_ is offline», che si risolve da solo quando il monitor si riprende. |
| 2 | Check if _monitor name_ is online | La prima query ha dati | Segna il monitor come **Operativo**. |

> [!IMPORTANT]
> Un valore di `0` è un dato: una metrica che spesso vale zero, come i riavvii o gli errori, non porta il monitor offline. Per ricevere un avviso su un valore, parti da un modello o aggiungi un criterio con una soglia. Quando non arriva alcun dato e nessun criterio corrisponde, il monitor mantiene il suo stato e gli incidenti aperti restano aperti: il silenzio non è un ripristino. Il tempo in cui OneUptime stesso non riceveva dati non conta mai come assenza di dati: un controllo la cui finestra lo contiene attende, come spiega [Quando OneUptime non riceve dati](/docs/monitor/when-oneuptime-is-not-receiving).

## Log raccolti

L'agente segue anche il file `*-json.log` di ogni container e invia ogni riga come record di log OpenTelemetry con:

| Campo | Valore |
| --- | --- |
| `resource.host.name` | L'host, da `DOCKER_HOST_NAME`. |
| `resource.container.id` | L'ID completo del container. |
| `resource.container.runtime` | Sempre `docker`. |
| `attributes["log.iostream"]` | `stdout` o `stderr`. |
| `severityText` / `severityNumber` | Letti da una parola chiave di livello dove un livello compare nella riga (`[ERROR]`, `app.INFO:`, `{"level":"warn"}`, `level=error`). Una riga senza livello ricade sul proprio stream: `stderr` è `ERROR`, `stdout` è `INFO`. |
| `body` | La riga scritta dal container. Le righe che iniziano con uno spazio o una parentesi chiusa, come le righe di uno stack trace, vengono unite alla riga precedente. |
| `time` | Il timestamp del demone Docker per la riga. |

I log compaiono nella pagina **Registri** dell'host e nella pagina di ogni container.

### Requisito del driver di log

L'agente può leggere solo i log dei container che usano il driver di log `json-file` di Docker. È il predefinito di Docker, ma un container o l'intero demone possono usarne un altro:

| Driver | Cosa vede l'agente |
| --- | --- |
| `json-file` | Ogni riga. |
| `local` | Niente: il file è binario e l'agente non può analizzarlo. |
| `journald`, `syslog`, `fluentd`, `gelf`, `awslogs`, `splunk`, … | Niente: i log vanno altrove, quindi non c'è un file da seguire. |
| `none` | Niente: i log vengono scartati. |

Verificate il driver di un container, e quello predefinito del demone:

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
docker info --format '{{.LoggingDriver}}'
```

Passate a `json-file`. Docker imposta il driver di log di un container quando il container viene creato, quindi ricreate ogni container dopo la modifica: un riavvio mantiene il vecchio driver.

:::tabs
@tab Docker Compose
Impostate il driver su ogni servizio, con la rotazione:

```yaml title="docker-compose.yml"
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
```

Poi ricreate il servizio:

```bash
docker compose up -d --force-recreate <service>
```
@tab Demone Docker
Rendete `json-file` il predefinito per ogni container creato in seguito:

```json title="/etc/docker/daemon.json"
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Riavviate il demone Docker, poi rimuovete e ricreate ogni container:

```bash
docker rm -f <container>
docker run ... <image>
```
:::

## Risoluzione dei problemi

:::details L'host non è nell'elenco Host Docker
Gli host si registrano da soli a partire dai dati dell'agente. Verificate che il container dell'agente sia in esecuzione e che l'host compaia in **Prodotti → Infrastruttura → Docker → Tutti gli host**. La [guida all'agente Docker](/docs/telemetry/docker-host) contiene i controlli da eseguire sull'host.
:::

:::details Le metriche arrivano ma la pagina Registri è vuota
Quasi certamente i container non usano il driver di log `json-file`. Verificateli con i comandi di [Requisito del driver di log](#requisito-del-driver-di-log), cambiate quelli di cui volete i log e ricreateli.
:::

:::details L'agente registra «no files match the configured criteria»
L'agente cerca `/var/lib/docker/containers/*/*-json.log` e non ha trovato nulla. O nessun container sull'host usa `json-file`, o il mount `/var/lib/docker/containers` dell'agente (`-v /var/lib/docker/containers:/var/lib/docker/containers:ro`) manca o è vuoto, oppure l'agente gira su Docker Desktop per macOS, i cui file dei container si trovano nella sua VM Linux.
:::

:::details I dati arrivano con il nome host sbagliato
OneUptime identifica un host tramite `resource.host.name`, che l'agente prende da `DOCKER_HOST_NAME`. Cambiare `DOCKER_HOST_NAME` dopo i primi dati crea un secondo host invece di rinominare il primo, e un monitor resta legato al nome con cui è stato creato.
:::

:::details Un avviso sulla CPU non scatta mai
Raggruppate la query per `resource.container.name` e aggregate con **Massimo**, come fa il modello **High Container CPU Usage**. Una media su tutti i container di un host occupato viene abbassata da quelli inattivi. Ricordate che il 100% significa un core intero, quindi un container a cui sono consentiti più core ha bisogno di una soglia più alta. Se la CPU di un container è una linea piatta qualunque sia il suo carico, sull'host gira un agente più vecchio: [aggiornatelo](/docs/telemetry/docker-host#aggiornare-lagent).
:::

:::details Il modello per la limitazione ha smesso di avvisare
Misura di quanto è cresciuto `container.cpu.throttling_data.throttled_time` tra due campioni dello stesso minuto. Se il `collection_interval` dell'agente è di 60 secondi o più, ogni minuto contiene un solo campione, la crescita vale sempre 0 e il modello non scatta mai. Mantenete il valore predefinito dell'agente, 30 secondi.
:::

:::details Il modello per i loop di riavvio non scatta mai o perde dei riavvii
Legge `container.restarts.increase`, che un agente più vecchio non invia: [aggiornate l'agente](/docs/telemetry/docker-host#aggiornare-lagent). Un monitor creato dal modello prima di allora legge di quanto è cresciuto `container.restarts` tra due campioni dello stesso minuto, e perde i riavvii tra i campioni di due minuti diversi: eliminatelo e create di nuovo il modello.
:::

## Passaggi successivi

:::cards
- [Agent Docker](/docs/telemetry/docker-host): Installare, aggiornare e risolvere i problemi dell'agente che questo monitor legge.
- [Monitor Podman](/docs/monitor/podman-monitor): Lo stesso monitor per gli host Podman.
- [Monitor Docker Swarm](/docs/monitor/docker-swarm-monitor): Sorvegliare i task di un cluster Swarm.
- [Panoramica degli incidenti](/docs/incidents/index): Cosa succede dopo che un criterio ha dichiarato un incidente.
:::
