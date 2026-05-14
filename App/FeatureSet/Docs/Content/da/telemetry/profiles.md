# Send kontinuerlige profileringsdata til OneUptime

## Oversigt

Kontinuerlig profilering er den fjerde søjle i observabilitet ved siden af logs, metrikker og traces. Profiler fanger, hvordan din applikation bruger CPU-tid, allokerer hukommelse og bruger systemressourcer på funktionsniveau. OneUptime indsamler profileringsdata via OpenTelemetry Protocol (OTLP) og gemmer dem sammen med dine andre telemetrisignaler til samlet analyse.

Med profileringsdata i OneUptime kan du identificere varme funktioner, der forbruger CPU, opdage hukommelseslækager, finde konkurrenceflaskehalse og korrelere ydeevneproblemer med specifikke traces og spans.

## Understøttede profiltyper

OneUptime understøtter følgende profiltyper:

| Profiltype | Beskrivelse | Enhed |
| --- | --- | --- |
| cpu | CPU-tid brugt på at eksekvere kode | nanosekunder |
| wall | Vægurtid (inkluderer ventetid/dvale) | nanosekunder |
| alloc_objects | Antal heap-allokeringer | antal |
| alloc_space | Bytes af heap-hukommelse allokeret | bytes |
| goroutine | Antal aktive goroutines (Go) | antal |
| contention | Tid brugt på at vente på låse/mutexer | nanosekunder |

## Kom i gang

### Trin 1 – Opret et Telemetry Ingestion Token

Når du har tilmeldt dig OneUptime og oprettet et projekt, skal du klikke på "Mere" i navigationslinjen og klikke på "Projektindstillinger".

På siden Telemetry Ingestion Key skal du klikke på "Opret indtagelsesnøgle" for at oprette et token.

![Opret tjeneste](/docs/static/images/TelemetryIngestionKeys.png)

Når du har oprettet et token, skal du klikke på "Vis" for at se tokenet.

![Vis tjeneste](/docs/static/images/TelemetryIngestionKeyView.png)

### Trin 2 – Konfigurer din profiler

OneUptime accepterer profileringsdata over både gRPC og HTTP ved hjælp af OTLP-profiler-protokollen.

| Protokol | Endpoint |
| --- | --- |
| gRPC | `your-oneuptime-host:4317` (OTLP standard gRPC-port) |
| HTTP | `https://your-oneuptime-host/otlp/v1/profiles` |

**Miljøvariabler**

Indstil følgende miljøvariabler for at pege din profiler mod OneUptime:

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**Selvhostet OneUptime**

Hvis du selvhoster OneUptime, skal du erstatte endpointet med din egen host (f.eks. `http(s)://YOUR-ONEUPTIME-HOST/otlp`). Til gRPC skal du oprette forbindelse direkte til port 4317 på din OneUptime-host.

## Instrumenteringsvejledning

### Brug af Grafana Alloy (eBPF-baseret profilering)

Grafana Alloy (tidligere Grafana Agent) kan indsamle CPU-profiler fra alle processer på en Linux-host ved hjælp af eBPF, uden nogen kodeændringer. Konfigurer det til at eksportere via OTLP til OneUptime.

Eksempel på Alloy-konfiguration:

```hcl
pyroscope.ebpf "default" {
  forward_to = [pyroscope.write.oneuptime.receiver]
  targets    = discovery.process.all.targets
}

pyroscope.write "oneuptime" {
  endpoint {
    url = "https://oneuptime.com/pyroscope"
    headers = {
      "x-oneuptime-token" = "YOUR_ONEUPTIME_SERVICE_TOKEN",
    }
  }
}
```

### Brug af async-profiler (Java)

Til Java-applikationer skal du bruge [async-profiler](https://github.com/async-profiler/async-profiler) med OpenTelemetry Java-agenten til at sende profileringsdata via OTLP.

```bash
# Start din Java-applikation med OpenTelemetry Java-agenten
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.exporter.otlp.endpoint=https://oneuptime.com/otlp \
  -Dotel.exporter.otlp.headers=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN \
  -Dotel.service.name=my-java-service \
  -jar my-app.jar
```

### Brug af Go pprof med OTLP-eksport

Til Go-applikationer kan du bruge standard `net/http/pprof`-pakken sammen med en OTLP-eksportør. Konfigurer kontinuerlig profilering ved periodisk at indsamle pprof-data og videresende dem til OneUptime.

```go
import (
    "runtime/pprof"
    "bytes"
    "time"
)

// Indsaml en 30-sekunders CPU-profil og eksporter periodisk
func collectProfile() {
    var buf bytes.Buffer
    pprof.StartCPUProfile(&buf)
    time.Sleep(30 * time.Second)
    pprof.StopCPUProfile()
    // Konvertér pprof-output til OTLP-format og send til OneUptime
}
```

Alternativt kan du bruge OpenTelemetry Collector med en profileringsmodtager, der skraber din Go-applikations `/debug/pprof`-endpoint og eksporterer via OTLP.

### Brug af py-spy (Python)

Til Python-applikationer kan [py-spy](https://github.com/benfred/py-spy) optage CPU-profiler uden kodeændringer. Brug OpenTelemetry Collector til at modtage og videresende profildata.

```bash
# Optag profiler og send til en lokal OTLP-collector
py-spy record --format speedscope --pid $PID -o profile.json
```

Til kontinuerlig profilering skal du køre py-spy ved siden af din applikation og konfigurere OpenTelemetry Collector til at indsamle og videresende profilerne til OneUptime.

## Brug af OpenTelemetry Collector

Du kan bruge OpenTelemetry Collector som en proxy til at modtage profiler fra dine applikationer og videresende dem til OneUptime.

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
      "x-oneuptime-token": "YOUR_ONEUPTIME_SERVICE_TOKEN"

service:
  pipelines:
    profiles:
      receivers: [otlp]
      exporters: [otlphttp]
```

## Funktioner

### Flammegraf-visualisering

OneUptime gengiver profildata som interaktive flammegrafier. Hver søjle repræsenterer en funktion i kaldestakken, og dens bredde er proportional med den tid eller de ressourcer, der forbruges. Du kan klikke på enhver funktion for at zoome ind og se dens kaldere og kaldte.

### Funktionsliste

Se en sorterbar tabel over alle funktioner optaget i en profil, rangeret efter selvtid, samlet tid eller allokeringsantal. Dette hjælper dig med hurtigt at identificere de mest kostbare funktioner i din applikation.

### Trace-korrelation

Profiler i OneUptime kan korreleres med distribuerede traces. Når en profil inkluderer trace- og span-ID'er (via OTLP-linktabellen), kan du navigere direkte fra en langsom trace-span til den tilsvarende CPU- eller hukommelsesprofil for at forstå præcis, hvilken kode der blev eksekveret.

### Filtrering efter profiltype

Filtrer profiler efter type (cpu, wall, alloc_objects, alloc_space, goroutine, contention) for at fokusere på den specifikke ressourcedimension, du undersøger.

## Dataopbevaring

Profildata-opbevaring konfigureres pr. telemetritjeneste i dine OneUptime-projektindstillinger. Standardopbevaringsperioden er 15 dage. Data slettes automatisk, efter opbevaringsperioden udløber.

For at ændre opbevaringsperioden for en tjeneste skal du navigere til **Telemetri > Tjenester > [Din Tjeneste] > Indstillinger** og opdatere dataopbevaringsværdien.

## Har du brug for hjælp?

Kontakt venligst support@oneuptime.com, hvis du har brug for hjælp til at opsætte profilering med OneUptime.
