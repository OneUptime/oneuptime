# Fluentd zum Senden von Telemetriedaten an OneUptime verwenden

## Übersicht

Sie können das [Fluentd](https://www.fluentd.org/)-Plugin verwenden, um Logs und Telemetriedaten aus Ihren Anwendungen und Diensten zu sammeln. Das Plugin sendet die Telemetriedaten an die OneUptime HTTP-Quelle. Sie können das HTTP-Output-Plugin von Fluentd verwenden, um die Telemetriedaten an die OneUptime HTTP-Quelle zu senden. Dieses Plugin finden Sie hier: https://docs.fluentd.org/output/http

## Erste Schritte

Fluentd unterstützt hunderte von Datenquellen und Sie können Logs aus jeder dieser Quellen in OneUptime importieren. Zu den beliebten Quellen gehören:

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

Die vollständige Liste der unterstützten Quellen finden Sie [hier](https://www.fluentd.org/datasources)

## Voraussetzungen

- **Schritt 1: Fluentd auf Ihrem System installieren** - Sie können Fluentd gemäß den [hier](https://docs.fluentd.org/installation) bereitgestellten Anweisungen installieren
- **Schritt 2: Für OneUptime-Konto anmelden** - Sie können sich [hier](https://oneuptime.com) für ein kostenloses Konto anmelden.
- **Schritt 3: OneUptime-Projekt erstellen**
- **Schritt 4: Telemetrie-Ingestion-Token erstellen**

## Konfiguration

Sie können die folgende Konfiguration verwenden, um die Telemetriedaten an die OneUptime HTTP-Quelle zu senden. Die Konfigurationsdatei befindet sich normalerweise unter `/etc/fluentd/fluent.conf` oder `/etc/td-agent/td-agent.conf`.

Ersetzen Sie `YOUR_SERVICE_TOKEN` durch das in der vorherigen Schritt erstellte Token. Ersetzen Sie auch `YOUR_SERVICE_NAME` durch den Namen Ihres Dienstes. Der Dienstname kann ein beliebiger Name sein. Wenn der Dienst in OneUptime nicht existiert, wird er automatisch erstellt.

```yaml
# Alle Muster abgleichen 
<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```

**Wenn Sie OneUptime selbst hosten**: Wenn Sie OneUptime selbst hosten, können Sie `endpoint_url` durch die URL Ihrer OneUptime-Instanz ersetzen. `http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`

## Verwendung

Sobald Sie die Konfiguration zur Fluentd-Konfigurationsdatei hinzugefügt haben, können Sie den Fluentd-Dienst neu starten. Sobald der Dienst neu gestartet wurde, werden die Telemetriedaten an die OneUptime HTTP-Quelle gesendet. Sie können die Telemetriedaten jetzt im OneUptime-Dashboard sehen. Bei Fragen oder wenn Sie Hilfe bei der Konfiguration benötigen, wenden Sie sich bitte an support@oneuptime.com
