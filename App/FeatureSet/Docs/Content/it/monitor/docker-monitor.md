# Monitor Docker

Il monitoraggio Docker ti consente di monitorare lo stato e le prestazioni dei tuoi host Docker e dei container in esecuzione su di essi. OneUptime raccoglie metriche e log dei container tramite un OpenTelemetry Collector pre-configurato (l'**Agente Docker OneUptime**) e li valuta rispetto ai criteri configurati.

## Panoramica

I monitor Docker usano metriche e log dai tuoi host per fornire visibilità sui carichi di lavoro dei container. Questo ti consente di:

- Monitorare lo stato dell'host Docker e dei singoli container
- Monitorare CPU, memoria, rete, I/O a blocchi e conteggi di processi tra i container
- Rilevare riavvii, crash e throttling CPU dei container
- Trasmettere log strutturati dei container in formato nativo OpenTelemetry
- Avvisare in caso di CPU elevata, memoria elevata, loop di riavvio e altro

## Creazione di un Monitor Docker

1. Vai su **Monitor** nella Dashboard di OneUptime
2. Clicca su **Crea Monitor**
3. Seleziona **Docker** come tipo di monitor
4. Seleziona l'host Docker e l'ambito delle risorse da monitorare
5. Configura le query di metriche e l'aggregazione
6. Configura i criteri di monitoraggio secondo necessità

## Opzioni di Configurazione

### Host Docker

Seleziona l'host Docker da monitorare. Gli host vengono registrati automaticamente la prima volta che l'Agente Docker OneUptime invia telemetria da loro — non è necessario crearli manualmente.

### Ambito delle Risorse

Scegli il livello al quale monitorare le risorse:

| Ambito    | Descrizione                                                   |
| --------- | ------------------------------------------------------------- |
| Host      | Monitora l'intero host Docker, aggregato su tutti i container |
| Container | Monitora un container specifico per nome o immagine           |

### Query di Metriche

Configura una o più query di metriche da valutare. Ogni query specifica:

- **Nome della metrica** — La metrica del container da interrogare
- **Aggregazione** — Come aggregare i valori delle metriche (Media, Somma, Massimo, Minimo)
- **Filtri** — Filtraggio aggiuntivo basato sugli attributi (es. per nome del container, immagine o host)
- **Raggruppa Per** — Facoltativamente raggruppa per `resource.container.name` in modo che ogni container sia valutato indipendentemente

Puoi anche creare **formule** che combinano più query di metriche usando espressioni matematiche.

### Finestra Temporale Rolling

Seleziona la finestra temporale per la valutazione delle metriche:

- Ultimo 1 Minuto
- Ultimi 5 Minuti
- Ultimi 10 Minuti
- Ultimi 15 Minuti
- Ultimi 30 Minuti
- Ultimi 60 Minuti

## Metriche Raccolte

L'Agente Docker usa il receiver `docker_stats` di OpenTelemetry, che raccoglie dati dall'API Docker Engine a intervalli configurabili (predefinito ogni 30 secondi).

### CPU

| Metrica                                           | Descrizione                                            |
| ------------------------------------------------- | ------------------------------------------------------ |
| `container.cpu.utilization`                       | Utilizzo CPU come percentuale della CPU dell'host      |
| `container.cpu.usage.total`                       | Tempo CPU cumulativo consumato dal container           |
| `container.cpu.throttling_data.throttled_time`    | Tempo per cui il container è stato limitato dai cgroup |
| `container.cpu.throttling_data.throttled_periods` | Numero di periodi di throttling                        |

### Memoria

| Metrica                        | Descrizione                                        |
| ------------------------------ | -------------------------------------------------- |
| `container.memory.usage.total` | Utilizzo corrente della memoria in byte            |
| `container.memory.usage.limit` | Limite di memoria in byte                          |
| `container.memory.percent`     | Utilizzo della memoria come percentuale del limite |

### Rete

| Metrica                               | Descrizione           |
| ------------------------------------- | --------------------- |
| `container.network.io.usage.rx_bytes` | Byte totali ricevuti  |
| `container.network.io.usage.tx_bytes` | Byte totali trasmessi |

### I/O a Blocchi

| Metrica                                              | Descrizione                            |
| ---------------------------------------------------- | -------------------------------------- |
| `container.blockio.io_service_bytes_recursive.read`  | Byte letti dai dispositivi a blocchi   |
| `container.blockio.io_service_bytes_recursive.write` | Byte scritti sui dispositivi a blocchi |

### Informazioni sul Container

| Metrica                | Descrizione                                        |
| ---------------------- | -------------------------------------------------- |
| `container.uptime`     | Uptime del container in secondi                    |
| `container.restarts`   | Numero di volte che il container è stato riavviato |
| `container.pids.count` | Numero di processi all'interno del container       |

## Criteri di Monitoraggio

### Tipi di Controllo Disponibili

| Tipo di Controllo | Descrizione                                             |
| ----------------- | ------------------------------------------------------- |
| Metric Value      | Il valore della query di metriche o formula configurata |

### Tipi di Aggregazione

| Aggregazione  | Descrizione                                |
| ------------- | ------------------------------------------ |
| Average       | Valore medio nella finestra temporale      |
| Sum           | Somma di tutti i valori                    |
| Maximum Value | Valore più alto nella finestra temporale   |
| Minimum Value | Valore più basso nella finestra temporale  |
| All Values    | Tutti i valori devono soddisfare i criteri |
| Any Value     | Almeno un valore deve soddisfare i criteri |

### Tipi di Filtro

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Template di Avvisi Pre-costruiti

OneUptime fornisce template per scenari comuni di monitoraggio Docker:

| Template               | Descrizione                                  | Soglia | Aggregazione        |
| ---------------------- | -------------------------------------------- | ------ | ------------------- |
| High Container CPU     | Utilizzo CPU per container                   | > 90%  | Max (per container) |
| High Container Memory  | Utilizzo memoria come percentuale del limite | > 85%  | Max (per container) |
| High CPU Throttling    | Periodi di throttling CPU                    | > 0    | Max (per container) |
| Container Restart Loop | Conteggio riavvii container                  | > 3    | Sum                 |
| Container Down         | Uptime container azzerato                    | = 0    | Min                 |

> Nota: I template di CPU, memoria e throttling usano l'aggregazione **Max** raggruppata per `resource.container.name`. Questo impedisce che il segnale di un singolo container intensivo venga diluito da molti container inattivi sullo stesso host.

## Log Raccolti

Oltre alle metriche, l'Agente Docker monitora il file `*-json.log` di ogni container tramite il receiver filelog di OpenTelemetry e trasmette i record di log nel formato nativo OTLP. Ogni record di log viene arricchito con:

- `resource.host.name` — l'identificatore dell'host Docker
- `resource.container.id` — l'ID completo del container
- `resource.container.runtime` — sempre `docker`
- `attributes["log.iostream"]` — `stdout` o `stderr`
- `severityText` / `severityNumber` — derivati dallo stream: `stderr` → `ERROR`, `stdout` → `INFO`
- `body` — la riga di log grezza emessa dal processo del container
- `time` — il timestamp del daemon Docker per la riga

I log appaiono nella scheda **Log** dell'host Docker e nella pagina dei dettagli di ogni container.

### Requisito del Driver di Log

**L'Agente Docker acquisisce solo i log dai container che usano il driver di log `json-file` di Docker.** Questo è il driver predefinito di Docker, ma può essere sovrascritto per container o globalmente:

- **Driver `local`** — scrive blocchi protobuf binari in `/var/lib/docker/containers/<id>/local-logs/container.log`. Il receiver filelog non può analizzare questo formato.
- **`journald`**, **`syslog`**, **`fluentd`**, **`gelf`**, **`awslogs`**, **`splunk`**, ecc. — inviano i log a una destinazione remota; nessun file da monitorare.
- **`none`** — scarta completamente i log.

Se uno qualsiasi dei precedenti è in uso, vedrai le metriche nella pagina dell'host Docker ma la scheda **Log** sarà vuota (o conterrà solo i log dell'Agente Docker stesso).

**Controlla il driver di log di un container specifico:**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**Controlla il driver predefinito del daemon:**

```bash
docker info --format '{{.LoggingDriver}}'
```

**Passa un servizio Docker Compose a `json-file` con rotazione appropriata:**

```yaml
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
```

**Cambia il driver predefinito del daemon** (si applica a ogni container creato successivamente) modificando `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

Poi riavvia il daemon Docker e **ricrea** i container interessati. Docker lega il driver di log al momento della creazione del container, quindi un container esistente mantiene il vecchio driver finché non viene rimosso e ricreato:

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# Docker semplice
docker rm -f <container>
docker run ... <image>
```

## Requisiti di Configurazione

Per usare il monitoraggio Docker, devi:

1. Installare l'Agente Docker OneUptime su ogni host Docker che vuoi monitorare
2. Passare `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` e `DOCKER_HOST_NAME` come variabili d'ambiente
3. Assicurarti che i container che vuoi osservare usino il driver di log `json-file` (vedi sopra)

L'agente è pubblicato come `oneuptime/docker-agent:release` su Docker Hub. Vedi la [guida all'installazione dell'Agente Docker](https://github.com/OneUptime/oneuptime/tree/master/DockerAgent) per i completi esempi `docker run` e `docker compose`.

## Risoluzione dei Problemi

### Le metriche appaiono ma la scheda Log è vuota

I tuoi container quasi certamente non usano il driver di log `json-file`. Esegui i comandi diagnostici nella sezione [Requisito del Driver di Log](#requisito-del-driver-di-log) sopra e cambia i container che necessitano di avere i loro log trasmessi.

### Il receiver filelog registra `no files match the configured criteria`

Questo significa che il glob `/var/lib/docker/containers/*/*-json.log` non ha trovato corrispondenze quando l'agente è partito. O:

1. Nessun container su questo host usa `json-file`, o
2. Il bind mount `-v /var/lib/docker/containers:/var/lib/docker/containers:ro` è mancante o punta a una directory vuota, o
3. L'agente è in esecuzione su Docker Desktop per macOS senza la directory dei container della VM Linux esposta.

### I log arrivano ma sono raggruppati sotto il nome host sbagliato

OneUptime registra automaticamente gli host Docker per `resource.host.name`, che viene preso dalla variabile d'ambiente `DOCKER_HOST_NAME`. Cambiare `DOCKER_HOST_NAME` dopo il primo batch di telemetria creerà una seconda riga di host invece di rinominare quella esistente.

### Gli incidenti non si attivano per "High CPU"

Assicurati che l'aggregazione della query di metriche sia **Max** (non Avg) e che raggruppi per `resource.container.name`. Una media su tutti i container su un host occupato viene diluita dai container inattivi e raramente supera la soglia.
