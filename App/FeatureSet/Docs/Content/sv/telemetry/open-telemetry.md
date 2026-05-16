# Integrera OpenTelemetry (loggning, mätvärden och spårningar) med OneUptime. 

### Steg 1 – Skapa telemetriintagningstoken.

När du har skapat ett OneUptime-konto kan du skapa en telemetriintagningstoken för att mata in loggar, mätvärden och spårningar från din applikation.

Efter att du registrerat dig på OneUptime och skapat ett projekt, klicka på "Mer" i navigeringsfältet och klicka på "Projektinställningar".

På sidan Telemetriintagningsnyckel, klicka på "Skapa intagningsnyckel" för att skapa en token. 

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

När du har skapat en token klickar du på "Visa" för att visa token.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)


### Steg 2 

#### Konfigurera telemetritjänsten i din applikation.

#### Applikationsloggar

Vi använder OpenTelemetry för att samla in applikationsloggar. OneUptime stöder för närvarande loggintagning från dessa OpenTelemetry SDK:er. Följ instruktionerna för att konfigurera telemetritjänsten i din applikation.

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


**Integrera med OneUptime**

När du har konfigurerat telemetritjänsten i din applikation kan du integrera med OneUptime genom att ange följande miljövariabler.

| Miljövariabel | Värde |
| --- | --- |
| OTEL_EXPORTER_OTLP_HEADERS | x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN |
| OTEL_EXPORTER_OTLP_ENDPOINT | https://oneuptime.com/otlp |
| OTEL_SERVICE_NAME | NAME_OF_YOUR_SERVICE |


**Exempel**

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=9c8806e0-a4aa-11ee-be95-010d5967b068
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```


**Egeninstallerad OneUptime**

Om du egeninstallerar OneUptime kan detta ändras till din egeninstallerade OpenTelemetry-samlarsslutpunkt (t.ex. `http(s)://YOUR-ONEUPTIME-HOST/otlp`)

När du kör din applikation bör du se loggarna på OneUptime-telemetritjänstens sida. Kontakta support@oneuptime.com om du behöver hjälp.


#### Använda OpenTelemetry Collector

Du kan också använda OpenTelemetry-samlaren istället för att skicka telemetridata direkt från din applikation. 
Om du använder OpenTelemetry Collector kan du konfigurera OneUptime-exportören i samlarens konfigurationsfil.

Här är exempelkonfigurationen för OpenTelemetry Collector.

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:

  # Export over HTTP
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # Requires use JSON encoder insted of default Proto(buf)
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "ONEUPTIME_TOKEN" # Your OneUptime token

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
