# Integrer OpenTelemetry (logging, metrikker og spor) med OneUptime.

### Trinn 1 – Opprett telemetriinnhentingstoken.

Når du har opprettet en OneUptime-konto, kan du opprette et telemetriinnhentingstoken for å hente inn logger, metrikker og spor fra applikasjonen din.

Etter at du har registrert deg for OneUptime og opprettet et prosjekt, klikker du på "More" i navigasjonslinjen og klikker på "Project Settings".

På siden for Telemetry Ingestion Key, klikk på "Create Ingestion Key" for å opprette et token.

![Opprett tjeneste](/docs/static/images/TelemetryIngestionKeys.png)

Når du har opprettet et token, klikker du på "View" for å se tokenet.

![Vis tjeneste](/docs/static/images/TelemetryIngestionKeyView.png)

### Trinn 2

#### Konfigurer telemetritjenesten i applikasjonen din.

#### Applikasjonslogger

Vi bruker OpenTelemetry til å samle inn applikasjonslogger. OneUptime støtter for øyeblikket logginnhenting fra disse OpenTelemetry SDK-ene. Følg instruksjonene for å konfigurere telemetritjenesten i applikasjonen din.

- [C++](https://opentelemetry.io/docs/instrumentation/cpp/)
- [Go](https://opentelemetry.io/docs/instrumentation/go/)
- [Java](https://opentelemetry.io/docs/instrumentation/java/)
- [JavaScript / TypeScript / NodeJS / Nettleser](https://opentelemetry.io/docs/instrumentation/js/)
- [Python](https://opentelemetry.io/docs/instrumentation/python/)
- [Ruby](https://opentelemetry.io/docs/instrumentation/ruby/)
- [PHP](https://opentelemetry.io/docs/instrumentation/php/)
- [Erlang](https://opentelemetry.io/docs/instrumentation/erlang/)
- [Rust](https://opentelemetry.io/docs/instrumentation/rust/)
- [.NET / C#](https://opentelemetry.io/docs/instrumentation/net/)
- [Swift](https://opentelemetry.io/docs/instrumentation/swift/)

**Integrer med OneUptime**

Når du har konfigurert telemetritjenesten i applikasjonen din, kan du integrere med OneUptime ved å sette følgende miljøvariabler.

| Miljøvariabel               | Verdi                                          |
| --------------------------- | ---------------------------------------------- |
| OTEL_EXPORTER_OTLP_HEADERS  | x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN |
| OTEL_EXPORTER_OTLP_ENDPOINT | https://oneuptime.com/otlp                     |
| OTEL_SERVICE_NAME           | NAME_OF_YOUR_SERVICE                           |

**Eksempel**

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=9c8806e0-a4aa-11ee-be95-010d5967b068
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**Selvhostet OneUptime**

Hvis du selvhoster OneUptime, kan dette endres til ditt selvhostede OpenTelemetry Collector-endepunkt (f.eks. `http(s)://YOUR-ONEUPTIME-HOST/otlp`)

Når du kjører applikasjonen, bør du se loggene på OneUptime telemetritjenestesiden. Ta kontakt med support@oneuptime.com hvis du trenger hjelp.

#### Bruke OpenTelemetry Collector

Du kan også bruke OpenTelemetry Collector i stedet for å sende telemetridata direkte fra applikasjonen din.
Hvis du bruker OpenTelemetry Collector, kan du konfigurere OneUptime-eksporteren i Collector-konfigurasjonsfilen.

Her er eksempelkonfigurasjonen for OpenTelemetry Collector.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  # Eksporter over HTTP
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # Krever bruk av JSON-koder i stedet for standard Proto(buf)
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "ONEUPTIME_TOKEN" # Din OneUptime-token

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp]
    metrics:
      receivers: [otlp]
      exporters: [otlphttp]
    logs:
      receivers: [otlp]
      exporters: [otlphttp]
```
