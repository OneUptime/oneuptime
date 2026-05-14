# Syslog-Daten an OneUptime senden

## Übersicht

Der OpenTelemetry Ingest-Dienst akzeptiert jetzt native Syslog-Payloads. Sie können Nachrichten von jeder RFC3164- oder RFC5424-kompatiblen Quelle direkt über HTTPS an OneUptime weiterleiten. OneUptime parst Syslog-Priorität, Facility, Schweregrad, strukturierte Daten und Nachrichtentext, bevor alles als durchsuchbare Logs gespeichert wird.

## Voraussetzungen

- **Telemetrie-Ingestion-Token** – erstellen Sie eines über *Projekteinstellungen → Telemetrie-Ingestion-Schlüssel* und kopieren Sie den `x-oneuptime-token`-Wert.
- **Syslog-Forwarder** – jedes Tool, das HTTP-POST-Anfragen senden kann (z. B. `curl`, `rsyslog` über `omhttp` oder `syslog-ng` mit dem HTTP-Ziel-Plugin).
- **Dienstname (optional)** – setzen Sie den `x-oneuptime-service-name`-Header, um eingehende Logs einem bestimmten Telemetrie-Dienst zuzuordnen.

## Endpunkt

```
POST https://oneuptime.com/syslog/v1/logs
```

- Ersetzen Sie `oneuptime.com` durch Ihren Host, wenn Sie OneUptime selbst hosten.
- Schließen Sie immer den `x-oneuptime-token`-Header in die Anfrage ein.

## Anfragekörper

Senden Sie zeilengetrennte Syslog-Zeichenketten oder eine JSON-Payload mit einem `messages`-Array. Sowohl RFC3164 (BSD) als auch RFC5424-Formate werden unterstützt.

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### Unterstützte Content-Types

- `application/json` – empfohlen.
- `text/plain` – zeilengetrennte Nachrichten.
- `application/octet-stream` – rohe Payloads. Gzip-Komprimierung (`Content-Encoding: gzip`) wird ebenfalls akzeptiert.

## Schnelltest mit curl

```bash
curl \
  -X POST https://oneuptime.com/syslog/v1/logs \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: YOUR_TELEMETRY_KEY" \
  -H "x-oneuptime-service-name: production-web" \
  -d '{
    "messages": [
      "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login"
    ]
  }'
```

## Weiterleitung von rsyslog

1. HTTP-Ausgabemodul installieren:
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. Ziel an `/etc/rsyslog.d/oneuptime.conf` anhängen:
   ```
   module(load="omhttp")

   template(name="OneUptimeJson" type="list") {
     constant(value="{\"messages\":[\"")
     property(name="rawmsg")
     constant(value="\"]}")
   }

   action(
     type="omhttp"
     server="oneuptime.com"
     serverport="443"
     usehttps="on"
     endpoint="/syslog/v1/logs"
     header="Content-Type: application/json"
     header="x-oneuptime-token: YOUR_TELEMETRY_KEY"
     header="x-oneuptime-service-name: rsyslog-demo"
     template="OneUptimeJson"
   )
   ```
3. rsyslog neu starten:
   ```bash
   sudo systemctl restart rsyslog
   ```

## Geparste Attribute

OneUptime fügt jedem Log-Eintrag automatisch die folgenden Attribute hinzu:

- `syslog.priority`, `syslog.facility.code`, `syslog.facility.name`
- `syslog.severity.code`, `syslog.severity.name`
- `syslog.hostname`, `syslog.appName`, `syslog.processId`, `syslog.messageId`
- `syslog.structured.*` (abgeflachte RFC5424-strukturierte Daten)
- `syslog.raw` (ursprüngliche Nachricht für Nachverfolgbarkeit)

Diese Attribute werden im Telemetrie-Log-Explorer durchsuchbar.

## Fehlerbehebung

- **HTTP 401 oder leere Ergebnisse** – überprüfen Sie, ob der `x-oneuptime-token`-Header zum Projekt gehört, das die Logs empfängt.
- **Keine Logs erscheinen** – stellen Sie sicher, dass der Anfragekörper tatsächlich Syslog-Zeilen enthält. Leere Körper werden mit HTTP 400 abgelehnt.
- **Unerwarteter Dienstname** – setzen Sie `x-oneuptime-service-name`, um die Standard-Erkennungslogik zu überschreiben.
