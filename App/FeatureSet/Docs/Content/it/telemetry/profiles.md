# Inviare Dati di Profiling Continuo a OneUptime

## Panoramica

Il profiling continuo è il quarto pilastro dell'osservabilità insieme a log, metriche e tracce. I profili catturano come la propria applicazione impiega il tempo di CPU, alloca memoria e usa le risorse di sistema a livello di funzione. OneUptime acquisisce i dati di profiling tramite il protocollo OpenTelemetry (OTLP) e li archivia insieme agli altri segnali di telemetria per un'analisi unificata.

Con i dati di profiling in OneUptime, è possibile identificare le funzioni calde che consumano CPU, rilevare perdite di memoria, trovare colli di bottiglia da contention e correlare i problemi di prestazioni con tracce e span specifici.

## Tipi di Profilo Supportati

OneUptime supporta i seguenti tipi di profilo:

| Tipo di Profilo | Descrizione | Unità |
| --- | --- | --- |
| cpu | Tempo CPU impiegato nell'esecuzione del codice | nanosecondi |
| wall | Tempo wall-clock (include attesa/sleep) | nanosecondi |
| alloc_objects | Numero di allocazioni heap | conteggio |
| alloc_space | Byte di memoria heap allocata | byte |
| goroutine | Numero di goroutine attive (Go) | conteggio |
| contention | Tempo trascorso in attesa di lock/mutex | nanosecondi |

## Per Iniziare

### Fase 1 - Creare un Token di Acquisizione Telemetria

Dopo aver effettuato la registrazione a OneUptime e creato un progetto, fare clic su "Altro" nella barra di navigazione e fare clic su "Impostazioni Progetto".

Nella pagina Chiave di Acquisizione Telemetria, fare clic su "Crea Chiave di Acquisizione" per creare un token.

![Crea Servizio](/docs/static/images/TelemetryIngestionKeys.png)

Una volta creato il token, fare clic su "Visualizza" per vederlo.

![Visualizza Servizio](/docs/static/images/TelemetryIngestionKeyView.png)

### Fase 2 - Configurare il Proprio Profiler

OneUptime accetta dati di profiling sia via gRPC che HTTP usando il protocollo OTLP profiles.

| Protocollo | Endpoint |
| --- | --- |
| gRPC | `vostro-host-oneuptime:4317` (porta gRPC standard OTLP) |
| HTTP | `https://vostro-host-oneuptime/otlp/v1/profiles` |

**Variabili d'Ambiente**

Impostare le seguenti variabili d'ambiente per puntare il profiler a OneUptime:

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=VOSTRO_TOKEN_SERVIZIO_ONEUPTIME
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=mio-servizio
```

**OneUptime Self-Hosted**

Se si ospita autonomamente OneUptime, sostituire l'endpoint con il proprio host (ad es., `http(s)://VOSTRO-HOST-ONEUPTIME/otlp`). Per gRPC, connettersi direttamente alla porta 4317 sul proprio host OneUptime.

## Guida alla Strumentazione

### Uso di Grafana Alloy (profiling basato su eBPF)

Grafana Alloy (precedentemente Grafana Agent) può raccogliere profili CPU da tutti i processi su un host Linux usando eBPF, senza modifiche al codice richieste. Configurarlo per esportare via OTLP a OneUptime.

Esempio di configurazione Alloy:

```hcl
pyroscope.ebpf "default" {
  forward_to = [pyroscope.write.oneuptime.receiver]
  targets    = discovery.process.all.targets
}

pyroscope.write "oneuptime" {
  endpoint {
    url = "https://oneuptime.com/pyroscope"
    headers = {
      "x-oneuptime-token" = "VOSTRO_TOKEN_SERVIZIO_ONEUPTIME",
    }
  }
}
```

### Uso di async-profiler (Java)

Per le applicazioni Java, usare [async-profiler](https://github.com/async-profiler/async-profiler) con l'agente Java OpenTelemetry per inviare i dati di profiling via OTLP.

```bash
# Avviare l'applicazione Java con l'agente Java OpenTelemetry
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.exporter.otlp.endpoint=https://oneuptime.com/otlp \
  -Dotel.exporter.otlp.headers=x-oneuptime-token=VOSTRO_TOKEN_SERVIZIO_ONEUPTIME \
  -Dotel.service.name=mio-servizio-java \
  -jar mia-app.jar
```

### Uso di Go pprof con Esportazione OTLP

Per le applicazioni Go, è possibile usare il pacchetto standard `net/http/pprof` insieme a un esportatore OTLP. Configurare il profiling continuo raccogliendo periodicamente dati pprof e inoltrandoli a OneUptime.

```go
import (
    "runtime/pprof"
    "bytes"
    "time"
)

// Raccogliere un profilo CPU di 30 secondi ed esportare periodicamente
func collectProfile() {
    var buf bytes.Buffer
    pprof.StartCPUProfile(&buf)
    time.Sleep(30 * time.Second)
    pprof.StopCPUProfile()
    // Convertire l'output pprof in formato OTLP e inviare a OneUptime
}
```

In alternativa, usare il Collector OpenTelemetry con un receiver di profiling che effettua lo scraping dell'endpoint `/debug/pprof` dell'applicazione Go ed esporta via OTLP.

### Uso di py-spy (Python)

Per le applicazioni Python, [py-spy](https://github.com/benfred/py-spy) può acquisire profili CPU senza modifiche al codice. Usare il Collector OpenTelemetry per ricevere e inoltrare i dati di profilo.

```bash
# Acquisire profili e inviarli a un collector OTLP locale
py-spy record --format speedscope --pid $PID -o profile.json
```

Per il profiling continuo, eseguire py-spy insieme all'applicazione e configurare il Collector OpenTelemetry per acquisire e inoltrare i profili a OneUptime.

## Uso del Collector OpenTelemetry

È possibile usare il Collector OpenTelemetry come proxy per ricevere profili dalle proprie applicazioni e inoltrarli a OneUptime.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "VOSTRO_TOKEN_SERVIZIO_ONEUPTIME"

service:
  pipelines:
    profiles:
      receivers: [otlp]
      exporters: [otlphttp]
```

## Funzionalità

### Visualizzazione Flamegraph

OneUptime visualizza i dati di profilo come flamegraph interattivi. Ogni barra rappresenta una funzione nello stack di chiamate e la sua larghezza è proporzionale al tempo o alle risorse consumate. È possibile fare clic su qualsiasi funzione per ingrandire e vedere i suoi chiamanti e i chiamati.

### Elenco Funzioni

Visualizzare una tabella ordinabile di tutte le funzioni acquisite in un profilo, classificate per tempo proprio, tempo totale o conteggio delle allocazioni. Questo aiuta a identificare rapidamente le funzioni più costose nell'applicazione.

### Correlazione Tracce

I profili in OneUptime possono essere correlati con le tracce distribuite. Quando un profilo include ID di traccia e span (tramite la tabella di link OTLP), è possibile navigare direttamente da uno span di traccia lento al corrispondente profilo CPU o memoria per capire esattamente quale codice era in esecuzione.

### Filtraggio per Tipo di Profilo

Filtrare i profili per tipo (cpu, wall, alloc_objects, alloc_space, goroutine, contention) per concentrarsi sulla dimensione della risorsa specifica che si sta esaminando.

## Conservazione dei Dati

La conservazione dei dati di profilo è configurata per servizio di telemetria nelle impostazioni del progetto OneUptime. Il periodo di conservazione predefinito è di 15 giorni. I dati vengono eliminati automaticamente dopo la scadenza del periodo di conservazione.

Per modificare il periodo di conservazione per un servizio, navigare a **Telemetria > Servizi > [Il Proprio Servizio] > Impostazioni** e aggiornare il valore di conservazione dei dati.

## Hai Bisogno di Aiuto?

Contattare support@oneuptime.com per qualsiasi assistenza nella configurazione del profiling con OneUptime.
