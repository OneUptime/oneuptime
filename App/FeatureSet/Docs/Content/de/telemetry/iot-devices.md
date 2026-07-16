# OneUptime IoT-Geräte

## Überblick

OneUptime überwacht Flotten von IoT-Geräten — Sensoren, Gateways, Controller und Edge-Boxen — indem es standardmäßige OpenTelemetry-Metriken (OTLP) erfasst. Jedes Gerät (oder ein Gateway in seinem Namen) sendet einen kleinen Satz von `iot_*`-Metriken über OTLP HTTP, versehen mit der **Flotte**, zu der es gehört, und seiner eigenen **Geräte-ID**. OneUptime gruppiert diese Metriken zu einer Flotte, erstellt ein Live-Geräteinventar und verfolgt pro Gerät Akku, Konnektivität, Temperatur, CPU, Arbeitsspeicher und Verfügbarkeit.

Auf der Geräteseite muss kein Agent installiert werden — alles, was OTLP sprechen kann (ein OpenTelemetry-SDK auf dem Gerät oder ein OpenTelemetry Collector, der auf einem Gateway läuft und an viele Geräte verteilt), funktioniert. Diese Seite ist der **Erfassungsleitfaden**. Informationen zur Konfiguration von IoT-Monitoren und Warnungen auf Basis der gesendeten Daten finden Sie unter [IoT Device Monitor](/docs/monitor/iot-device-monitor).

## Voraussetzungen

- Ein Gerät, Gateway oder Collector, der OTLP/HTTP an OneUptime senden kann
- Netzwerkerreichbarkeit vom Gerät/Gateway zu Ihrer OneUptime-Instanz
- Ein **OneUptime Telemetry Ingestion Token** — erstellen Sie eines unter _Project Settings → Telemetry Ingestion Keys_ und kopieren Sie den `x-oneuptime-token`-Wert

## Wie OneUptime IoT modelliert

OneUptime ordnet Ihre Geräte mithilfe von OpenTelemetry-Ressourcenattributen zwei Konzepten zu:

- **Flotte** — eine logische Gruppe von Geräten (zum Beispiel `building-a-sensors` oder `field-gateways`). Die Flotte wird aus dem Ressourcenattribut `iot.fleet.name` abgeleitet und erscheint in OneUptime als der Telemetrie-Service `iot/<fleet>`. Setzen Sie `service.name=iot/<fleet>`, damit Logs und Metriken unter demselben Service zusammenlaufen.
- **Gerät** — ein einzelnes Gerät innerhalb einer Flotte, identifiziert durch das Attribut `device.id`. OneUptime erstellt und pflegt ein Geräteinventar pro Flotte, das auf `device.id` basiert.

Optionale Attribute verfeinern, wie jedes Gerät klassifiziert und in Monitoren eingegrenzt wird:

| Attribut             | Erforderlich | Beschreibung                                                                     |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `iot.fleet.name`     | Ja      | Die Flotte, zu der dieses Gerät gehört. Wird zum OneUptime-Service `iot/<fleet>`    |
| `device.id`          | Ja      | Stabile, eindeutige ID für das Gerät innerhalb der Flotte                                |
| `iot.device.kind`    | Nein       | Die Geräteklasse — zum Beispiel `Device`, `Sensor` oder `Gateway`. Standardwert ist `Device` |
| `iot.device.type`    | Nein       | Ein feinerer Gerätetyp/-modell, der zum Filtern von Monitoren verwendet wird (zum Beispiel `temp-sensor`) |
| `iot.device.firmware`| Nein       | Vom Gerät gemeldete Firmware-Version                                          |

## Metriken über das OpenTelemetry-SDK senden

Wenn Ihr Gerät ein OpenTelemetry-SDK direkt ausführt, richten Sie es auf OneUptime aus und versehen Sie die IoT-Ressourcenattribute über die standardmäßigen `OTEL_*`-Umgebungsvariablen. Ersetzen Sie Token, Endpunkt, Flottennamen und Geräte-ID durch die Werte für Ihre Umgebung.

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
```

| Umgebungsvariable             | Erforderlich | Beschreibung                                                                                         |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Ja      | OneUptime OTLP-Endpunkt (`https://oneuptime.com/otlp` oder `http(s)://YOUR-ONEUPTIME-HOST/otlp` bei Self-Hosting) |
| `OTEL_EXPORTER_OTLP_HEADERS`  | Ja      | `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`                                                    |
| `OTEL_RESOURCE_ATTRIBUTES`    | Ja      | Kommagetrennte Ressourcenattribute. Muss `iot.fleet.name`, `device.id` und `service.name=iot/<fleet>` enthalten |

Senden Sie Ihre Messwerte als Metriken unter Verwendung der `iot_*`-Namen unten (siehe [Metrikkonventionen](#metrikkonventionen)). Innerhalb von etwa einer Minute erscheint das Gerät im Abschnitt **IoT** des OneUptime-Dashboards.

## Metriken über einen OpenTelemetry Collector senden

Wenn viele Geräte über ein Gateway melden, betreiben Sie einen OpenTelemetry Collector auf dem Gateway und exportieren Sie an OneUptime. Der `resource`-Prozessor versieht die Daten mit den Flottenattributen; empfangen Sie Messwerte von Ihren Geräten (OTLP, MQTT-Bridge, Datei-Logs usw.) und leiten Sie sie weiter:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: iot.fleet.name
        value: field-gateways
        action: upsert
      - key: service.name
        value: iot/field-gateways
        action: upsert

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # OneUptime erfordert den JSON-Encoder anstelle des standardmäßigen Proto(buf)
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp]
```

- **`resource`** versieht jeden Datensatz mit den Flottenattributen. Setzen Sie `iot.fleet.name` (und das passende `service.name=iot/<fleet>`) pro Gateway, damit die Geräte jedes Gateways in der richtigen Flotte landen.
- Behalten Sie `device.id` (und optional `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) an jedem Datenpunkt bei, damit OneUptime das einzelne Gerät innerhalb der Flotte auflösen kann.
- **`otlphttp`** sendet über HTTPS an OneUptime mit angehängtem Erfassungstoken. Beachten Sie, dass `encoding: json` und der Header `Content-Type: application/json` erforderlich sind.

## Metriken über MQTT senden

OneUptime bringt einen integrierten MQTT-Endpunkt mit, sodass Geräte, die bereits MQTT sprechen, Messwerte direkt senden können — kein OpenTelemetry-SDK, kein Collector und keine Bridge erforderlich. Alles, was über MQTT veröffentlicht wird, landet in derselben Pipeline wie OTLP: Flotten werden automatisch erstellt, das Geräteinventar wird aktualisiert, und jeder IoT-Monitor und jede Warnungsvorlage funktioniert unverändert.

**Endpunkte**

| Transport             | Adresse                                | Hinweise                                                                                  |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| MQTT über WebSocket   | `wss://<your-host>/mqtt`               | Funktioniert bei jeder Bereitstellung — läuft über den normalen HTTPS-Port durch den OneUptime-Ingress |
| MQTT über TCP         | `<app-host>:1883` (`MQTT_INGEST_PORT`) | Self-Hosting: standardmäßig intern im Cluster-/Compose-Netzwerk; geben Sie ihn frei, wenn Sie ihn benötigen |

**Authentifizierung** — zwei Möglichkeiten:

- **Projektweit**: Senden Sie Ihr **Telemetry Ingestion Token** als MQTT-Passwort (der Benutzername wird ignoriert; wenn Ihr Client nur ein Benutzernamensfeld bietet, tragen Sie das Token stattdessen dort ein). Richtig für Gateways, die im Namen vieler Geräte veröffentlichen.
- **Pro Gerät** (empfohlen für Geräte, die sich direkt verbinden): Registrieren Sie das Gerät im Tab **Device Registry** der Flotte im Dashboard. Die Registrierung stellt Zugangsdaten für dieses Gerät aus — die Credential-ID ist der MQTT-**Benutzername** und das Secret ist das **Passwort**. Geräteauthentifizierte Clients dürfen nur unter ihren eigenen `oneuptime/<fleet>/<device>/…`-Topics veröffentlichen, ein einzelnes kompromittiertes Gerät kann über das Dashboard widerrufen werden, ohne den Rest der Flotte anzutasten (der Widerruf wird innerhalb von etwa einer Minute wirksam, auch bei bereits verbundenen Sitzungen), und registrierte Geräte erhalten eine **Offline-Erkennung bei stillem Ausfall**: Sie bleiben als Offline im Inventar, anstatt zu verschwinden, wenn sie keine Meldungen mehr senden, und die Warnungsvorlage **Device Offline** wird für sie ausgelöst, selbst wenn sie ohne Last Will ausfallen.

Ungültige Zugangsdaten werden bereits beim CONNECT mit Rückgabecode 4 (falscher Benutzername oder falsches Passwort) abgelehnt, sodass ein falsch konfiguriertes Gerät laut scheitert.

**Topics** — veröffentlichen Sie unter dem festen Präfix `oneuptime/`. Flotten- und Gerätesegmente dürfen kein `/`, `+` oder `#` enthalten und sind auf 100 Zeichen begrenzt:

| Topic                                            | Payload                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `oneuptime/<fleet>/<device>/telemetry`           | JSON-Objekt mit Messwerten — `{ "metrics": { "iot_temperature_celsius": 21.5 } }`, oder ein flaches Objekt, dessen numerische Felder die Metriken sind |
| `oneuptime/<fleet>/<device>/metrics/<metricName>`| Ein einzelner Wert — eine bloße Zahl (`23.4`) oder `{ "value": 23.4 }`                                |
| `oneuptime/<fleet>/<device>/status`              | `"online"` oder `"offline"` (auch `1`/`0`, `true`/`false`, `up`/`down`) — wird auf `iot_device_up` abgebildet |

Telemetrie-Payloads können außerdem `"attributes"` (eine String-Map, die an jeden Datenpunkt angehängt wird — verwenden Sie sie für `iot.device.kind`, `iot.device.type`, `iot.device.firmware` oder Ihre eigenen Labels) und `"timestamp"` (ISO-8601 oder Unix-Sekunden/-Millisekunden) tragen. Beide sind optional; fehlt `timestamp`, wird der Erfassungszeitpunkt verwendet.

**Offline-Erkennung mit Last Will** — registrieren Sie ein MQTT Last Will auf `oneuptime/<fleet>/<device>/status` mit dem Payload `offline`. Wenn das Gerät ausfällt oder das Netzwerk verlässt, veröffentlicht der Broker in seinem Namen `iot_device_up = 0`, sobald die Sitzung endet — das löst die standardmäßige Warnungsvorlage **Device Offline** aus und setzt das Gerät im Inventar auf Down, ohne Polling und ohne Warten auf einen verpassten Scrape. Veröffentlichen Sie nach dem Verbinden `online` auf demselben Topic, damit das Gerät wieder als Up angezeigt wird.

Beispiel mit `mosquitto_pub` (rohes TCP, Self-Hosting):

```bash
mosquitto_pub -h YOUR-ONEUPTIME-APP-HOST -p 1883 \
  -u oneuptime -P "YOUR_TELEMETRY_INGESTION_TOKEN" \
  -t "oneuptime/building-a-sensors/sensor-001/telemetry" \
  -m '{"metrics":{"iot_device_up":1,"iot_battery_percent":87,"iot_temperature_celsius":21.5},"attributes":{"iot.device.type":"temp-sensor","iot.device.firmware":"1.4.2"}}'
```

Beispiel mit Node.js `mqtt` über WebSocket (funktioniert gegen oneuptime.com und jede selbst gehostete Instanz):

```javascript
const mqtt = require("mqtt");

const client = mqtt.connect("wss://oneuptime.com/mqtt", {
  username: "oneuptime", // ignoriert — authentifiziert wird über das Token unten
  password: "YOUR_TELEMETRY_INGESTION_TOKEN",
  will: {
    topic: "oneuptime/building-a-sensors/sensor-001/status",
    payload: "offline",
  },
});

client.on("connect", () => {
  client.publish("oneuptime/building-a-sensors/sensor-001/status", "online");
  setInterval(() => {
    client.publish(
      "oneuptime/building-a-sensors/sensor-001/telemetry",
      JSON.stringify({
        metrics: {
          iot_device_up: 1,
          iot_battery_percent: readBattery(),
          iot_temperature_celsius: readTemperature(),
        },
      }),
    );
  }, 60 * 1000);
});
```

Beispiel mit Python `paho-mqtt` über WebSocket:

```python
import json
import paho.mqtt.client as mqtt

client = mqtt.Client(transport="websockets")
client.username_pw_set("oneuptime", "YOUR_TELEMETRY_INGESTION_TOKEN")
client.tls_set()
client.will_set("oneuptime/building-a-sensors/sensor-001/status", "offline")
client.ws_set_options(path="/mqtt")
client.connect("oneuptime.com", 443)

client.publish("oneuptime/building-a-sensors/sensor-001/status", "online")
client.publish(
    "oneuptime/building-a-sensors/sensor-001/telemetry",
    json.dumps({"metrics": {"iot_device_up": 1, "iot_temperature_celsius": 21.5}}),
)
```

Hinweise:

- Der Endpunkt dient **ausschließlich der Erfassung**: Subscriptions werden abgelehnt (SUBACK-Fehler). Verwenden Sie QoS 1, wenn der Broker den Empfang bestätigen soll. Die Erfassung erfolgt **mindestens einmal** — eine QoS-1/2-Neuübertragung nach einer verlorenen Bestätigung kann doppelte Datenpunkte erzeugen.
- Veröffentlichungen außerhalb des Topic-Vertrags oder mit fehlerhaften Payloads werden angenommen und **verworfen** (MQTT 3.1.1 kennt keine Fehlerantwort pro Nachricht) — der Server protokolliert eine Warnung mit dem Grund; prüfen Sie also die Logs der OneUptime-App, wenn keine Daten ankommen.
- Halten Sie am WebSocket-Endpunkt das MQTT-Keepalive **unter 5 Minuten** — der OneUptime-Ingress schließt inaktive WebSocket-Verbindungen nach 300 Sekunden, was Ihr Last Will und eine falsche Device-Offline-Warnung auslösen würde. Die Standardwerte der Client-Bibliotheken (60 s bei `mqtt` und `paho-mqtt`) sind in Ordnung. Der rohe TCP-Endpunkt hat keine solche Obergrenze.
- Payloads sind auf 128 KB und 100 Metriken pro Veröffentlichung begrenzt; zu große Pakete führen zum Verbindungsabbruch.

## Metrikkonventionen

OneUptime erkennt die folgenden `iot_*`-Metriknamen. Jeder Datenpunkt sollte das Label `device.id` tragen, damit der Messwert dem richtigen Gerät zugeordnet wird. Sie müssen nur die Metriken senden, die für Ihr Gerät sinnvoll sind — fehlende werden einfach nicht dargestellt.

| Metrikname                  | Bedeutung                                                                       |
| --------------------------- | ------------------------------------------------------------------------------ |
| `iot_device_up`             | Geräteverfügbarkeit. `1` = oben/erreichbar, `0` = unten. Steuert den IoT Device Monitor |
| `iot_device_info`           | Reines Identitätssignal. Trägt `device.id` / kind / type / firmware, damit ein Gerät im Inventar erscheint, noch bevor es Messwerte meldet |
| `iot_battery_percent`       | Akkuladestand, `0`–`100` (%)                                            |
| `iot_signal_strength_dbm`   | Drahtlose Signalstärke in dBm (zum Beispiel Wi-Fi / LoRa / Mobilfunk-RSSI)      |
| `iot_temperature_celsius`   | Geräte- oder Sensortemperatur in °C                                             |
| `iot_cpu_usage_ratio`       | CPU-Auslastung als Verhältnis `0`–`1` (OneUptime speichert sie als Prozentsatz)        |
| `iot_memory_usage_bytes`    | Aktuell genutzter Arbeitsspeicher, in bytes                                                |
| `iot_memory_size_bytes`     | Insgesamt auf dem Gerät verfügbarer Arbeitsspeicher, in bytes                                 |
| `iot_uptime_seconds`        | Sekunden seit dem letzten Start des Geräts                                           |

## Installation überprüfen

1. Bestätigen Sie, dass Ihr Gerät oder Gateway fehlerfrei exportiert (prüfen Sie die SDK-/Collector-Logs auf Exportfehler und HTTP-`401`/`403`-Antworten).
2. Öffnen Sie im OneUptime-Dashboard den Abschnitt **IoT** — Ihre Flotte sollte innerhalb von etwa einer Minute als `iot/<fleet>` erscheinen.
3. Öffnen Sie den Tab **Devices** der Flotte — jede gesendete `device.id` sollte mit ihren neuesten Werten für Akku, Signal, Temperatur, CPU, Arbeitsspeicher und Up/Down-Status aufgelistet sein.
4. Öffnen Sie **Metrics** unter der Flotte, um beliebige der oben genannten `iot_*`-Serien darzustellen.

## Fehlerbehebung

### Flotte erscheint nicht

1. Stellen Sie sicher, dass `iot.fleet.name` als **Ressourcen**attribut gesetzt ist (nicht als Datenpunkt-Label) und dass `service.name` `iot/<fleet>` lautet.
2. Bestätigen Sie, dass der Exporter-Endpunkt `https://oneuptime.com/otlp` (oder Ihr selbst gehostetes `…/otlp`) ist und der Header `x-oneuptime-token` ein gültiges Token trägt.
3. Wenn Sie einen Collector verwenden, stellen Sie sicher, dass `encoding: json` und `Content-Type: application/json` am `otlphttp`-Exporter gesetzt sind.

### Geräte fehlen im Inventar

1. Stellen Sie sicher, dass jeder Datenpunkt ein `device.id`-Label trägt — Geräte werden danach indiziert.
2. Senden Sie `iot_device_info` (reine Identität) für Geräte, die noch keine Messwerte gemeldet haben, damit sie dennoch im Inventar erscheinen.
3. Prüfen Sie, dass die `device.id`-Werte über Meldungen hinweg stabil sind; eine sich ändernde ID erzeugt doppelte Gerätezeilen.

### HTTP 401 / 403 vom Exporter

Das Erfassungstoken ist ungültig, widerrufen oder fehlt. Erstellen Sie ein neues unter _Project Settings → Telemetry Ingestion Keys_ und aktualisieren Sie den Header `x-oneuptime-token`.

### Metriken werden nicht dargestellt

1. Bestätigen Sie, dass Sie die exakten `iot_*`-Metriknamen aus der Tabelle [Metrikkonventionen](#metrikkonventionen) verwenden — unbekannte Namen werden als generische Metriken gespeichert und füllen keine IoT-Diagramme.
2. Denken Sie daran, dass `iot_cpu_usage_ratio` ein Verhältnis `0`–`1` ist; senden Sie das rohe Verhältnis, und OneUptime stellt es als Prozentsatz dar.
3. Rechnen Sie mit bis zu einer Minute, bis die ersten Datenpunkte erscheinen, nachdem ein Gerät mit dem Melden beginnt.

## Selbst gehostetes OneUptime

Wenn Sie OneUptime selbst hosten, richten Sie den Endpunkt auf Ihre eigene Instanz aus:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://your-oneuptime-host.example.com/otlp
```

Oder, in einem Collector:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

Wenn Ihre Instanz nur HTTP unterstützt, ändern Sie das Schema auf `http://` und verwenden Sie den entsprechenden Port.

## Nächste Schritte

- Konfigurieren Sie einen **IoT Device Monitor**, um bei Bedingungen wie Gerät offline, niedrigem Akkustand, schwachem Signal, hoher Temperatur und hoher CPU-Auslastung zu warnen — siehe [IoT Device Monitor](/docs/monitor/iot-device-monitor).
- Für nicht containerisierte Hosts (Linux- / macOS- / Windows-VMs und Bare Metal) verwenden Sie den [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
- Um die zugrunde liegende OTLP-Integration eingehend kennenzulernen, siehe [OpenTelemetry in OneUptime integrieren](/docs/telemetry/open-telemetry).
