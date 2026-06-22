# Integrer OpenTelemetry (logging, metrikker og traces) med OneUptime.

### Trin 1 – Opret Telemetry Ingestion Token.

Når du har oprettet en OneUptime-konto, kan du oprette et telemetriindtagelsestoken til at indsamle logs, metrikker og traces fra din applikation.

Når du har tilmeldt dig OneUptime og oprettet et projekt, skal du klikke på "Mere" i navigationslinjen og klikke på "Projektindstillinger".

På siden Telemetry Ingestion Key skal du klikke på "Opret indtagelsesnøgle" for at oprette et token.

![Opret tjeneste](/docs/static/images/TelemetryIngestionKeys.png)

Når du har oprettet et token, skal du klikke på "Vis" for at se tokenet.

![Vis tjeneste](/docs/static/images/TelemetryIngestionKeyView.png)

### Trin 2

#### Konfigurer telemetritjenesten i din applikation.

#### Applikationslogs

Vi bruger OpenTelemetry til at indsamle applikationslogs. OneUptime understøtter i øjeblikket logindtagelse fra disse OpenTelemetry SDK'er. Følg venligst instruktionerne for at konfigurere telemetritjenesten i din applikation.

- [C++](https://opentelemetry.io/docs/instrumentation/cpp/)
- [Go](https://opentelemetry.io/docs/instrumentation/go/)
- [Java](https://opentelemetry.io/docs/instrumentation/java/)
- [JavaScript / TypeScript / NodeJS / Browser](https://opentelemetry.io/docs/instrumentation/js/)
- [Python](https://opentelemetry.io/docs/instrumentation/python/)
- [Ruby](https://opentelemetry.io/docs/instrumentation/ruby/)
- [PHP](https://opentelemetry.io/docs/instrumentation/php/)
- [Erlang](https://opentelemetry.io/docs/instrumentation/erlang/)
- [Rust](https://opentelemetry.io/docs/instrumentation/rust/)
- [.NET / C#](https://opentelemetry.io/docs/instrumentation/net/)
- [Swift](https://opentelemetry.io/docs/instrumentation/swift/)

**Integrer med OneUptime**

Når du har konfigureret telemetritjenesten i din applikation, kan du integrere med OneUptime ved at indstille følgende miljøvariabler.

| Miljøvariabel               | Værdi                                          |
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

Hvis du selvhoster oneuptime, kan dette ændres til dit selvhostede OpenTelemetry Collector-endpoint (f.eks. `http(s)://YOUR-ONEUPTIME-HOST/otlp`)

Når du kører din applikation, bør du se loggene på OneUptime-telemetriservicesiden. Kontakt venligst support@oneuptime.com, hvis du har brug for hjælp.

#### Brug af OpenTelemetry Collector

Du kan også bruge OpenTelemetry Collector i stedet for at sende telemetridata direkte fra din applikation.
Hvis du bruger OpenTelemetry Collector, kan du konfigurere OneUptime-eksportøren i collector-konfigurationsfilen.

Her er eksempelkonfigurationen til OpenTelemetry Collector.

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
    # Kræver brug af JSON-encoder i stedet for standard Proto(buf)
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "ONEUPTIME_TOKEN" # Dit OneUptime-token

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
