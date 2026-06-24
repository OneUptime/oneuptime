# Integrare OpenTelemetry (logging, metriche e tracce) con OneUptime.

### Fase 1 - Creare un Token di Acquisizione Telemetria.

Una volta creato un account OneUptime, è possibile creare un token di acquisizione telemetria per acquisire log, metriche e tracce dall'applicazione.

Dopo aver effettuato la registrazione a OneUptime e creato un progetto, fare clic su "Altro" nella barra di navigazione e fare clic su "Impostazioni Progetto".

Nella pagina Chiave di Acquisizione Telemetria, fare clic su "Crea Chiave di Acquisizione" per creare un token.

![Crea Servizio](/docs/static/images/TelemetryIngestionKeys.png)

Una volta creato il token, fare clic su "Visualizza" per vederlo.

![Visualizza Servizio](/docs/static/images/TelemetryIngestionKeyView.png)

### Fase 2

#### Configurare il servizio di telemetria nella propria applicazione.

#### Log Applicazione

Si usa OpenTelemetry per raccogliere i log dell'applicazione. OneUptime attualmente supporta l'acquisizione di log da questi SDK OpenTelemetry. Seguire le istruzioni per configurare il servizio di telemetria nella propria applicazione.

- [C++](https://opentelemetry.io/docs/instrumentation/cpp/)
- [Go](https://opentelemetry.io/docs/instrumentation/go/)
- [Java](https://opentelemetry.io/docs/instrumentation/java/)
- [JavaScript / Typescript / NodeJS / Browser](https://opentelemetry.io/docs/instrumentation/js/)
- [Python](https://opentelemetry.io/docs/instrumentation/python/)
- [Ruby](https://opentelemetry.io/docs/instrumentation/ruby/)
- [PHP](https://opentelemetry.io/docs/instrumentation/php/)
- [Erlang](https://opentelemetry.io/docs/instrumentation/erlang/)
- [Rust](https://opentelemetry.io/docs/instrumentation/rust/)
- [.NET / C#](https://opentelemetry.io/docs/instrumentation/net/)
- [Swift](https://opentelemetry.io/docs/instrumentation/swift/)

**Integrazione con OneUptime**

Una volta configurato il servizio di telemetria nella propria applicazione, è possibile integrarsi con OneUptime impostando le seguenti variabili d'ambiente.

| Variabile d'Ambiente        | Valore                                            |
| --------------------------- | ------------------------------------------------- |
| OTEL_EXPORTER_OTLP_HEADERS  | x-oneuptime-token=VOSTRO_TOKEN_SERVIZIO_ONEUPTIME |
| OTEL_EXPORTER_OTLP_ENDPOINT | https://oneuptime.com/otlp                        |
| OTEL_SERVICE_NAME           | NOME_DEL_VOSTRO_SERVIZIO                          |

**Esempio**

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=9c8806e0-a4aa-11ee-be95-010d5967b068
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=mio-servizio
```

**OneUptime Self-Hosted**

Se si ospita autonomamente OneUptime, questo può essere cambiato con il proprio endpoint del collector OpenTelemetry self-hosted (ad es.: `http(s)://VOSTRO-HOST-ONEUPTIME/otlp`)

Una volta eseguita l'applicazione, si dovrebbero vedere i log nella pagina del servizio di telemetria di OneUptime. Contattare support@oneuptime.com per qualsiasi assistenza.

#### Uso del Collector OpenTelemetry

È anche possibile usare il collector OpenTelemetry invece di inviare i dati di telemetria direttamente dall'applicazione.
Se si usa il Collector OpenTelemetry, è possibile configurare l'esportatore OneUptime nel file di configurazione del collector.

Ecco la configurazione di esempio per il Collector OpenTelemetry.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  # Esporta via HTTP
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # Richiede l'uso del codificatore JSON invece del Proto(buf) predefinito
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "TOKEN_ONEUPTIME" # Il proprio token OneUptime

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
