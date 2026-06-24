# Send kontinuerlige profileringsdata til OneUptime

## Oversikt

Kontinuerlig profilering er den fjerde søylen i observerbarhet ved siden av logger, metrikker og spor. Profiler fanger opp hvordan applikasjonen bruker CPU-tid, allokerer minne og bruker systemressurser på funksjonsnivå. OneUptime henter inn profileringsdata via OpenTelemetry Protocol (OTLP) og lagrer det ved siden av de andre telemetrirammene for enhetlig analyse.

Med profileringsdata i OneUptime kan du identifisere hete funksjoner som bruker CPU, oppdage minnelekkasjer, finne flaskehalser og korrelere ytelsesproblemer med spesifikke spor og spans.

## Støttede profiltyper

OneUptime støtter følgende profiltyper:

| Profiltype    | Beskrivelse                                | Enhet        |
| ------------- | ------------------------------------------ | ------------ |
| cpu           | CPU-tid brukt på å kjøre kode              | nanosekunder |
| wall          | Veggklokketid (inkluderer venting/sovning) | nanosekunder |
| alloc_objects | Antall heap-allokeringer                   | antall       |
| alloc_space   | Byte av heap-minne allokert                | byte         |
| goroutine     | Antall aktive goroutiner (Go)              | antall       |
| contention    | Tid brukt på å vente på låser/mutexes      | nanosekunder |

## Kom i gang

### Trinn 1 – Opprett et telemetriinnhentingstoken

Etter at du har registrert deg for OneUptime og opprettet et prosjekt, klikker du på "More" i navigasjonslinjen og klikker på "Project Settings".

På siden for Telemetry Ingestion Key, klikk på "Create Ingestion Key" for å opprette et token.

![Opprett tjeneste](/docs/static/images/TelemetryIngestionKeys.png)

Når du har opprettet et token, klikker du på "View" for å se tokenet.

![Vis tjeneste](/docs/static/images/TelemetryIngestionKeyView.png)

### Trinn 2 – Konfigurer profileringsverktøyet ditt

OneUptime aksepterer profileringsdata over både gRPC og HTTP ved hjelp av OTLP-profilprotokollen.

| Protokoll | Endepunkt                                            |
| --------- | ---------------------------------------------------- |
| gRPC      | `your-oneuptime-host:4317` (standard OTLP gRPC-port) |
| HTTP      | `https://your-oneuptime-host/otlp/v1/profiles`       |

**Miljøvariabler**

Sett følgende miljøvariabler for å peke profileringsverktøyet mot OneUptime:

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**Selvhostet OneUptime**

Hvis du selvhoster OneUptime, erstatt endepunktet med din egen vert (f.eks. `http(s)://YOUR-ONEUPTIME-HOST/otlp`). For gRPC, koble direkte til port 4317 på OneUptime-verten din.

## Instrumenteringsguide

### Bruke Grafana Alloy (eBPF-basert profilering)

Grafana Alloy (tidligere Grafana Agent) kan samle inn CPU-profiler fra alle prosesser på en Linux-vert ved hjelp av eBPF, uten kodeendringer. Konfigurer den til å eksportere via OTLP til OneUptime.

Eksempel på Alloy-konfigurasjon:

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

### Bruke async-profiler (Java)

For Java-applikasjoner, bruk [async-profiler](https://github.com/async-profiler/async-profiler) med OpenTelemetry Java-agenten for å sende profileringsdata via OTLP.

```bash
# Start Java-applikasjonen med OpenTelemetry Java-agenten
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.exporter.otlp.endpoint=https://oneuptime.com/otlp \
  -Dotel.exporter.otlp.headers=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN \
  -Dotel.service.name=my-java-service \
  -jar my-app.jar
```

### Bruke Go pprof med OTLP-eksport

For Go-applikasjoner kan du bruke standardpakken `net/http/pprof` ved siden av en OTLP-eksporter. Konfigurer kontinuerlig profilering ved periodisk å samle inn pprof-data og videresende det til OneUptime.

```go
import (
    "runtime/pprof"
    "bytes"
    "time"
)

// Samle inn en 30-sekunders CPU-profil og eksporter periodisk
func collectProfile() {
    var buf bytes.Buffer
    pprof.StartCPUProfile(&buf)
    time.Sleep(30 * time.Second)
    pprof.StopCPUProfile()
    // Konverter pprof-utdata til OTLP-format og send til OneUptime
}
```

Alternativt, bruk OpenTelemetry Collector med en profileringsmottaker som skraper Go-applikasjonens `/debug/pprof`-endepunkt og eksporterer via OTLP.

### Bruke py-spy (Python)

For Python-applikasjoner kan [py-spy](https://github.com/benfred/py-spy) fange opp CPU-profiler uten kodeendringer. Bruk OpenTelemetry Collector til å motta og videresende profildata.

```bash
# Fang opp profiler og send til en lokal OTLP-samler
py-spy record --format speedscope --pid $PID -o profile.json
```

For kontinuerlig profilering, kjør py-spy ved siden av applikasjonen din og konfigurer OpenTelemetry Collector til å hente inn og videresende profilene til OneUptime.

## Bruke OpenTelemetry Collector

Du kan bruke OpenTelemetry Collector som en proxy for å motta profiler fra applikasjonene dine og videresende dem til OneUptime.

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

## Funksjoner

### Flamegraf-visualisering

OneUptime rendrer profildata som interaktive flamegrafer. Hver stolpe representerer en funksjon i kallstakken, og bredden er proporsjonal med tiden eller ressursene som forbrukes. Du kan klikke på en hvilken som helst funksjon for å zoome inn og se dens kallere og kallede.

### Funksjonsliste

Vis en sorterbar tabell over alle funksjoner fanget opp i en profil, rangert etter selvstendig tid, total tid eller allokeringsantall. Dette hjelper deg å raskt identifisere de dyreste funksjonene i applikasjonen din.

### Sporkorrelasjon

Profiler i OneUptime kan korreleres med distribuerte spor. Når en profil inkluderer spor- og span-ID-er (via OTLP-lenketabellen), kan du navigere direkte fra et tregt spor-span til den tilsvarende CPU- eller minneprofilen for å forstå nøyaktig hvilken kode som ble kjørt.

### Filtrering etter profiltype

Filtrer profiler etter type (cpu, wall, alloc_objects, alloc_space, goroutine, contention) for å fokusere på den spesifikke ressursdimensjonen du undersøker.

## Dataoppbevaring

Oppbevaring av profildata konfigureres per telemetritjeneste i OneUptime-prosjektinnstillingene. Standard oppbevaringsperiode er 15 dager. Data slettes automatisk etter at oppbevaringsperioden utløper.

For å endre oppbevaringsperioden for en tjeneste, naviger til **Telemetry > Services > [Din tjeneste] > Settings** og oppdater dataoppberingsverdien.

## Trenger du hjelp?

Ta kontakt med support@oneuptime.com hvis du trenger hjelp med å sette opp profilering med OneUptime.
