# FluentBit zum Senden von Telemetriedaten an OneUptime verwenden

## Übersicht

Sie können das [FluentBit](https://docs.fluentbit.io/manual)-Plugin verwenden, um Logs und Telemetriedaten aus Ihren Anwendungen und Diensten zu sammeln. Das Plugin sendet die Telemetriedaten an den OneUptime OpenTelemetry HTTP Collector. Sie können das OpenTelemetry-Output-Plugin von FluentBit verwenden, um die Telemetriedaten an den OneUptime OpenTelemetry HTTP Collector zu senden. Dieses Plugin finden Sie hier: https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## Erste Schritte

FluentBit unterstützt hunderte von Datenquellen und Sie können Logs und Telemetrie aus jeder dieser Quellen in OneUptime importieren. Zu den beliebten Quellen gehören:

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

und viele mehr.

Die vollständige Liste der unterstützten Quellen finden Sie [hier](https://docs.fluentbit.io/manual)

## Voraussetzungen

- **Schritt 1: FluentBit auf Ihrem System installieren** - Sie können FluentBit gemäß den [hier](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit) bereitgestellten Anweisungen installieren
- **Schritt 2: Für OneUptime-Konto anmelden** - Sie können sich [hier](https://oneuptime.com) für ein kostenloses Konto anmelden. Beachten Sie, dass das Konto zwar kostenlos ist, die Log-Aufnahme jedoch eine kostenpflichtige Funktion ist.
- **Schritt 3: OneUptime-Projekt erstellen** - Sobald Sie das Konto haben, können Sie ein Projekt über das OneUptime-Dashboard erstellen.
- **Schritt 4: Telemetrie-Ingestion-Token erstellen** - Sobald Sie ein OneUptime-Konto erstellt haben, können Sie ein Telemetrie-Ingestion-Token erstellen.

Nachdem Sie sich bei OneUptime angemeldet und ein Projekt erstellt haben, klicken Sie in der Navigationsleiste auf „Mehr" und dann auf „Projekteinstellungen".

Klicken Sie auf der Seite Telemetrie-Ingestion-Schlüssel auf „Ingestion-Schlüssel erstellen", um ein Token zu erstellen.

![Service erstellen](/docs/static/images/TelemetryIngestionKeys.png)

Sobald Sie ein Token erstellt haben, klicken Sie auf „Anzeigen", um das Token einzusehen.

![Service anzeigen](/docs/static/images/TelemetryIngestionKeyView.png)


## Konfiguration

Sie können die folgende Konfiguration verwenden, um die Telemetriedaten an den OneUptime OpenTelemetry HTTP Collector zu senden. Fügen Sie diese Konfiguration zur FluentBit-Konfigurationsdatei hinzu. Die Konfigurationsdatei befindet sich normalerweise unter `/etc/fluent-bit/fluent-bit.yaml`. So würde ein Outputs-Abschnitt der Konfigurationsdatei aussehen:


```yaml


outputs:
  - name: stdout
    match: '*'
  - name: opentelemetry
    match: '*'
    host: 'oneuptime.com'
    port: 443
    metrics_uri: '/otlp/v1/metrics'
    logs_uri: '/otlp/v1/logs'
    traces_uri: '/otlp/v1/traces'
    tls: On
    header:
      - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN

```

Stellen Sie sicher, dass Sie `opentelemetry_envelope` in Ihrem Inputs-Abschnitt haben. Hier ist ein Beispiel für den Inputs-Abschnitt:

```yaml
pipeline:
  inputs:
      # Ihre Inputs

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            # Ersetzen Sie YOUR_SERVICE_NAME durch den Namen Ihres Dienstes
            value: YOUR_SERVICE_NAME
```

**Wenn Sie OneUptime selbst hosten**: Wenn Sie OneUptime selbst hosten, können Sie `host` durch den Host Ihrer OneUptime-Instanz ersetzen. Wenn Sie auf einem HTTP-Server (nicht HTTPS) hosten, können Sie `port` durch den Port Ihrer OneUptime-Instanz ersetzen (wahrscheinlich Port 80).

## Verwendung

Sobald Sie die Konfiguration zur FluentBit-Konfigurationsdatei hinzugefügt haben, können Sie den FluentBit-Dienst neu starten. Sobald der Dienst neu gestartet wurde, werden die Telemetriedaten an die OneUptime HTTP-Quelle gesendet. Sie können die Telemetriedaten jetzt im OneUptime-Dashboard sehen. Bei Fragen oder wenn Sie Hilfe bei der Konfiguration benötigen, wenden Sie sich bitte an support@oneuptime.com
