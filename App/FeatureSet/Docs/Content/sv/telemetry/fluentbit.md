# Använd FluentBit för att skicka telemetridata till OneUptime

## Översikt

Du kan använda [FluentBit](https://docs.fluentbit.io/manual)-plugin:et för att samla in loggar och telemetridata från dina applikationer och tjänster. Plugin:et skickar telemetridata till OneUptime OpenTelemetry HTTP Collector. Du kan använda opentelemetry-utdataplugin:et för FluentBit för att skicka telemetridata till OneUptime OpenTelemetry HTTP Collector. Det här plugin:et finns här: https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## Kom igång

FluentBit stöder hundratals datakällor och du kan mata in loggar och telemetri från vilken som helst av dessa källor i OneUptime. Några av de populära källorna inkluderar:

- Docker
- Syslog
- Apache
- Nginx
- MySQL
- PostgreSQL
- MongoDB
- NodeJS
- Ruby
- Python
- Java
- PHP
- Go
- Rust

och många fler.

Du hittar den fullständiga listan över källor som stöds [här](https://docs.fluentbit.io/manual)

## Förutsättningar

- **Steg 1: Installera FluentBit på ditt system** – Du kan installera FluentBit med instruktionerna som finns [här](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)
- **Steg 2: Registrera dig för OneUptime-konto** – Du kan registrera dig för ett gratis konto [här](https://oneuptime.com). Observera att kontot är gratis, men loggintagning är en betald funktion. Du hittar mer information om prissättning [här](https://oneuptime.com/pricing).
- **Steg 3: Skapa OneUptime-projekt** – När du har kontot kan du skapa ett projekt från OneUptime-instrumentpanelen. Om du behöver hjälp med att skapa ett projekt eller har frågor, kontakta oss på support@oneuptime.com
- **Steg 4: Skapa telemetriintagningstoken** – När du har skapat ett OneUptime-konto kan du skapa en telemetriintagningstoken för att mata in loggar, mätvärden och spårningar från din applikation.

Efter att du registrerat dig på OneUptime och skapat ett projekt, klicka på "Mer" i navigeringsfältet och klicka på "Projektinställningar".

På sidan Telemetriintagningsnyckel, klicka på "Skapa intagningsnyckel" för att skapa en token.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

När du har skapat en token klickar du på "Visa" för att visa token.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## Konfiguration

Du kan använda följande konfiguration för att skicka telemetridata till OneUptime OpenTelemetry HTTP Collector. Du kan lägga till den här konfigurationen i FluentBit-konfigurationsfilen. Konfigurationsfilen finns vanligtvis på `/etc/fluent-bit/fluent-bit.yaml`. Här är hur ett outputs-avsnitt i konfigurationsfilen kan se ut:

```yaml
outputs:
  - name: stdout
    match: "*"
  - name: opentelemetry
    match: "*"
    host: "oneuptime.com"
    port: 443
    metrics_uri: "/otlp/v1/metrics"
    logs_uri: "/otlp/v1/logs"
    traces_uri: "/otlp/v1/traces"
    tls: On
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

Se till att du har opentelemetry_envelope i ditt inputs-avsnitt. Här är ett exempel på hur inputs-avsnittet kan se ut:

```yaml
pipeline:
  inputs:
    # Your inputs

    processors:
      logs:
        - name: opentelemetry_envelope

        - name: content_modifier
          context: otel_resource_attributes
          action: upsert
          key: service.name
          # Please replace YOUR_SERVICE_NAME with the name of your service
          value: YOUR_SERVICE_NAME
```

Här är den fullständiga exempelkonfigurationsfilen:

```yaml
service:
  flush: 1
  log_level: info

pipeline:
  inputs:
    - name: http
      listen: 0.0.0.0
      port: 8888

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME

  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

**Om du egeninstallerar OneUptime**: Om du egeninstallerar OneUptime kan du ersätta `host` med värden för din OneUptime-instans. Om du är värd på en HTTP-server och inte HTTPS kan du ersätta `port` med porten för din OneUptime-instans (troligen port 80).

I detta fall skulle konfigurationen se ut så här:

```yaml
outputs:
  - name: stdout
    match: "*"
  - name: opentelemetry
    match: "*"
    host: "your-oneuptime-instance.com"
    port: 80
    metrics_uri: "/otlp/v1/metrics"
    logs_uri: "/otlp/v1/logs"
    traces_uri: "/otlp/v1/traces"
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
```

## Användning

När du har lagt till konfigurationen i FluentBit-konfigurationsfilen kan du starta om FluentBit-tjänsten. När tjänsten har startats om skickas telemetridata till OneUptime HTTP Source. Du kan nu börja se telemetridata i OneUptime-instrumentpanelen. Om du har frågor eller behöver hjälp med konfigurationen, kontakta oss på support@oneuptime.com.
