import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in German (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * German. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its German words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "Ein Gerät mit einem OpenTelemetry-SDK, das OTLP über HTTP exportiert",
  "Network access from the device to your OneUptime instance":
    "Netzwerkzugriff vom Gerät auf Ihre OneUptime-Instanz",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "Ersetzen Sie `building-a-sensors` und `sensor-001` durch Ihren Flottennamen und Ihre Geräte-ID. Halten Sie `iot.fleet.name` stabil: Eine Änderung registriert eine ganz neue Flotte.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Wählen Sie in Schritt 1 einen Ingestion-Schlüssel, um `<YOUR_API_KEY>` auszufüllen.",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "Geben Sie Ihre Messwerte als Metriken nach den `iot_*`-Konventionen aus, und versehen Sie jeden Datenpunkt mit einem `device.id`-Attribut, zum Beispiel:",
  "| Metric | Value | Datapoint attribute |":
    "| Metrik | Wert | Datenpunkt-Attribut |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "Das Geräteinventar ist nach der `device.id` des Datenpunkts geschlüsselt, nicht nach der der Ressource; setzen Sie sie daher bei jeder Messung und zusätzlich in `OTEL_RESOURCE_ATTRIBUTES`. Alle erkannten Namen stehen unter **Metrikkonventionen** in Erweitert.",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. Vergewissern Sie sich, dass das Gerät fehlerfrei exportiert: Prüfen Sie die Protokolle des SDK auf Exportfehler und HTTP-Antworten `401` oder `422`.",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. Öffnen Sie im OneUptime-Dashboard den Bereich **IoT**: Ihre Flotte sollte innerhalb etwa einer Minute erscheinen.",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Öffnen Sie den Tab **Geräte** der Flotte: Jede gesendete `device.id` sollte mit ihrem neuesten Akku-, Signal-, Temperatur-, CPU-, Speicher- und Up/Down-Status aufgeführt sein.",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. Öffnen Sie **Metriken** unter der Flotte, um eine beliebige der `iot_*`-Reihen darzustellen.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "Auf dem Gerät ist kein Agent zu installieren. OneUptime ordnet Ihre Geräte anhand von OpenTelemetry-Attributen zwei Konzepten zu:",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **Flotte**: eine logische Gruppe von Geräten (zum Beispiel `building-a-sensors` oder `field-gateways`). Die Flotte wird aus dem Ressourcenattribut `iot.fleet.name` abgeleitet und erscheint in OneUptime als Telemetriedienst `iot/<fleet>`. Setzen Sie `service.name=iot/<fleet>`, damit Protokolle und Metriken unter demselben Dienst zusammenlaufen.",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **Gerät**: ein einzelnes Gerät innerhalb einer Flotte, erkannt am Attribut `device.id` jedes Datenpunkts. OneUptime erstellt und pflegt pro Flotte ein Geräteinventar, geschlüsselt nach `device.id`.",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "Die Attribute, die OneUptime liest; die optionalen verfeinern, wie jedes Gerät eingeordnet und in Monitoren eingegrenzt wird:",
  "| Attribute | Set on | Required | Description |":
    "| Attribut | Gesetzt auf | Erforderlich | Beschreibung |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | Ressource | Ja | Die Flotte, zu der dieses Gerät gehört. Wird zum OneUptime-Dienst `iot/<fleet>` |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | Jeder Datenpunkt | Ja | Stabile, eindeutige ID des Geräts innerhalb der Flotte |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | Jeder Datenpunkt | Nein | Die Geräteklasse, zum Beispiel `Device`, `Sensor` oder `Gateway`. Standard: `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Jeder Datenpunkt | Nein | Ein feinerer Gerätetyp bzw. ein Modell zum Filtern von Monitoren (zum Beispiel `temp-sensor`) |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | Jeder Datenpunkt | Nein | Vom Gerät gemeldete Firmware-Version |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime erkennt die folgenden `iot_*`-Metriknamen. Jeder Datenpunkt sollte das Label `device.id` tragen, damit der Messwert dem richtigen Gerät zugeordnet wird. Senden Sie nur die Metriken, die für Ihr Gerät sinnvoll sind; fehlende werden einfach nicht dargestellt.",
  "| Metric Name | Meaning |": "| Metrikname | Bedeutung |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | Geräteverfügbarkeit. `1` = up/erreichbar, `0` = down. Steuert den IoT-Gerätemonitor |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | Reines Identitätssignal. Trägt `device.id` / Klasse / Typ / Firmware, damit ein Gerät im Inventar erscheint, noch bevor es Messwerte meldet |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | Akkuladestand, `0`–`100` (%) |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | Funksignalstärke in dBm (zum Beispiel Wi-Fi-, LoRa- oder Mobilfunk-RSSI) |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | Geräte- oder Sensortemperatur in °C |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | CPU-Auslastung als Verhältnis `0`–`1` (das Geräteinventar zeigt sie als Prozentsatz) |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | Aktuell belegter Speicher, in Bytes |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | Gesamter verfügbarer Speicher des Geräts, in Bytes |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | Sekunden seit dem letzten Start des Geräts |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. Prüfen Sie, ob `iot.fleet.name` als **Ressourcen**-Attribut gesetzt ist (nicht als Datenpunkt-Label) und ob `service.name` den Wert `iot/<fleet>` hat.",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. Vergewissern Sie sich, dass der Exporter-Endpunkt `<YOUR_ONEUPTIME_URL>/otlp` ist und der Header `x-oneuptime-token` einen gültigen Ingestion-Schlüssel trägt.",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. Stellen Sie sicher, dass jeder Datenpunkt ein Label `device.id` trägt: Geräte werden danach geschlüsselt.",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. Senden Sie `iot_device_info` (nur Identität) für Geräte, die noch keine Messwerte gemeldet haben, damit sie trotzdem im Inventar erscheinen.",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. Prüfen Sie, ob die Werte von `device.id` über alle Meldungen stabil sind; eine wechselnde ID erzeugt doppelte Gerätezeilen.",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401` bedeutet, dass der Ingestion-Schlüssel fehlt, falsch oder abgelaufen ist; `422` bedeutet, dass er deaktiviert wurde oder ein Browserschlüssel ist, der keine Gerätetelemetrie senden kann. Wählen Sie oben einen anderen Schlüssel (oder erstellen Sie einen neuen) und aktualisieren Sie den Header `x-oneuptime-token`, den Ihr Gerät oder Collector sendet.",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. Verwenden Sie die genauen `iot_*`-Metriknamen aus **Metrikkonventionen** unter Erweitert: Andere Namen werden als allgemeine Metriken gespeichert und füllen die IoT-Diagramme nicht.",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` ist ein Verhältnis von `0`–`1`; senden Sie das rohe Verhältnis, OneUptime zeigt es als Prozentsatz an.",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. Rechnen Sie mit bis zu einer Minute, bis die ersten Datenpunkte erscheinen, nachdem ein Gerät mit dem Melden begonnen hat.",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "Damit gehen die Messwerte an die Flotte **`fleet-1`**. Ersetzen Sie `sensor-001` durch die ID des Geräts, und lassen Sie `iot.fleet.name` genau so, wie es ist: Ein anderer Name registriert eine neue Flotte.",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "Ein Gateway, das den OpenTelemetry Collector ausführen kann (mit Docker oder dem Binary `otelcol-contrib`)",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "Geräte, die OTLP an das Gateway senden, und Netzwerkzugriff vom Gateway auf Ihre OneUptime-Instanz",
  "Save this as `config.yaml` on the gateway:":
    "Speichern Sie dies als `config.yaml` auf dem Gateway:",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- Setzen Sie `iot.fleet.name` (und das passende `service.name=iot/<fleet>`) pro Gateway, damit die Geräte jedes Gateways in der richtigen Flotte landen.",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- Behalten Sie `device.id` (und optional `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) an jedem Datenpunkt, damit OneUptime das einzelne Gerät innerhalb der Flotte auflösen kann.",
  "Run it from the directory that holds `config.yaml`:":
    "Führen Sie ihn in dem Verzeichnis aus, in dem `config.yaml` liegt:",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "Die Geräte senden dann OTLP an das Gateway (gRPC auf Port `4317`, HTTP auf Port `4318`), zum Beispiel mit `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` im SDK jedes Geräts.",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "Ist `otelcol-contrib` bereits auf dem Gateway? Verweisen Sie es auf die Datei:",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. Vergewissern Sie sich, dass der Collector des Gateways fehlerfrei exportiert: Prüfen Sie seine Protokolle auf Exportfehler und HTTP-Antworten `401` oder `422` (`docker logs -f otel-collector`, wenn er in Docker läuft).",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** empfängt von Ihren Geräten über gRPC (`4317`) und HTTP (`4318`). Empfangen Sie Messwerte auf jedem anderen Weg, den der Collector unterstützt (eine MQTT-Bridge, Dateiprotokolle, …), und leiten Sie sie durch dieselbe Pipeline.",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** versieht jeden Datensatz mit den Flottenattributen. Setzen Sie `iot.fleet.name` (und das passende `service.name=iot/<fleet>`) pro Gateway, damit die Geräte jedes Gateways in der richtigen Flotte landen.",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** bündelt Datensätze vor dem Export, damit das Gateway nicht für jeden Messwert eine HTTP-Rundreise bezahlt.",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** sendet über HTTPS an OneUptime, mit angehängtem Aufnahme-Token. Sowohl die standardmäßige Protobuf-Kodierung als auch `encoding: json` werden akzeptiert.",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- Jeder Messwert, den dieses Gateway weiterleitet, geht an die Flotte **`fleet-1`**: Lassen Sie `iot.fleet.name` und `service.name` genau so, wie sie sind, sonst registrieren die Messwerte eine neue Flotte. Ein Gateway für eine andere Flotte setzt seine eigenen.",
  "Any MQTT client that can connect over WebSocket":
    "Ein beliebiger MQTT-Client, der sich über WebSocket verbinden kann",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "Zum Beispiel mit dem Node.js-Client `mqtt` (`npm install mqtt`):",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Ersetzen Sie `building-a-sensors` und `sensor-001` durch Ihren Flottennamen und Ihre Geräte-ID: OneUptime legt Flotte und Gerät anhand des Topics an. Der Last Will meldet das Gerät offline, sobald seine Verbindung abbricht; Geräte, die sich direkt verbinden, fahren mit einer eigenen Zugangskennung besser (beides unter Erweitert).",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. Vergewissern Sie sich, dass sich der Client fehlerfrei verbindet und veröffentlicht: Eine mit Rückgabecode 4 abgelehnte Verbindung (falscher Benutzername oder falsches Passwort) bedeutet, dass der Schlüssel falsch ist.",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Öffnen Sie den Tab **Geräte** der Flotte: Jedes Gerät, für das Sie veröffentlicht haben, sollte mit seinem neuesten Akku-, Signal-, Temperatur-, CPU-, Speicher- und Up/Down-Status aufgeführt sein.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "Auf dem Gerät ist kein Agent zu installieren. OneUptime ordnet Ihre Geräte zwei Konzepten zu, und bei MQTT legt das Topic beide fest:",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **Flotte**: das `<fleet>` in `oneuptime/<fleet>/…`, eine logische Gruppe von Geräten (zum Beispiel `building-a-sensors`). Es wird zum `iot.fleet.name` der Messwerte und erscheint in OneUptime als Telemetriedienst `iot/<fleet>`.",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **Gerät**: das `<device>` in `oneuptime/<fleet>/<device>/…`, ein einzelnes Gerät innerhalb der Flotte. Es wird zur `device.id` jedes Messwerts, und OneUptime erstellt und pflegt pro Flotte ein danach geschlüsseltes Geräteinventar.",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    'Optionale Attribute verfeinern, wie jedes Gerät eingeordnet und in Monitoren eingegrenzt wird. Legen Sie sie in die Map `"attributes"` einer Telemetrie-Veröffentlichung; sie werden auf jeden Datenpunkt dieser Veröffentlichung gesetzt:',
  "| Attribute | Description |": "| Attribut | Beschreibung |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | Die Geräteklasse, zum Beispiel `Device`, `Sensor` oder `Gateway`. Standard: `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Ein feinerer Gerätetyp bzw. ein Modell zum Filtern von Monitoren (zum Beispiel `temp-sensor`) |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | Vom Gerät gemeldete Firmware-Version |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime erkennt die folgenden `iot_*`-Metriknamen. Über MQTT benennt das Topic das Gerät, daher wird jeder Messwert ihm zugeordnet. Senden Sie nur die Metriken, die für Ihr Gerät sinnvoll sind; fehlende werden einfach nicht dargestellt.",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "Der projektweite Ingestion-Schlüssel passt zu Gateways, die im Namen vieler Geräte veröffentlichen. Registrieren Sie Geräte, die sich direkt verbinden, einzeln im Tab **Geräteregister** der Flotte: Er stellt eine Zugangskennung pro Gerät aus; die Kennungs-ID ist der MQTT-**Benutzername** und das Geheimnis das **Passwort**. Die Flotte erscheint mit ihrem ersten Messwert, senden Sie also zuerst einen mit dem projektweiten Schlüssel, wie in Schritt 2.",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **Topic-Isolation**: Eine Gerätekennung kann nur unter ihren eigenen Topics `oneuptime/<fleet>/<device>/…` veröffentlichen; alles andere wird verworfen.",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **Einzelner Widerruf**: Deaktivieren oder löschen Sie die Kennung eines Geräts, ohne den Rest der Flotte anzutasten; ein verbundenes Gerät wird innerhalb weniger Sekunden getrennt.",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **Offline-Erkennung bei stillem Ausfall**: Ein registriertes Gerät bleibt als offline im Inventar, wenn es nicht mehr meldet, statt zu verschwinden, selbst wenn es ohne Last Will ausfällt.",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "Registrieren Sie einen MQTT-**Last Will** auf `oneuptime/<fleet>/<device>/status` mit der Payload `offline`: Fällt das Gerät aus, veröffentlicht OneUptime in seinem Namen `iot_device_up = 0`, sobald die Sitzung abbricht, was die mitgelieferte Warnungsvorlage Device Offline ohne Polling auslöst. Veröffentlichen Sie nach dem Verbinden `online` auf demselben Topic, damit das Gerät wieder als up erscheint; das Beispiel in Schritt 2 tut beides. Jeder Messwert, den das Gerät veröffentlicht, zählt ebenfalls als up, sodass ein Gerät, das weiter Messwerte sendet, up bleibt, ohne seinen Status erneut zu veröffentlichen. Das Status-Topic akzeptiert auch `1`/`0`, `true`/`false` und `up`/`down`.",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "Halten Sie das MQTT-Keepalive auf dem WebSocket-Endpunkt **unter 5 Minuten** (die Standardwerte der Client-Bibliotheken von 60 s sind in Ordnung): Inaktive WebSocket-Verbindungen werden nach 300 Sekunden geschlossen, was den Last Will und einen falschen Offline-Warnung auslösen würde.",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "Veröffentlichen Sie unter dem festen Präfix `oneuptime/`. Die Flotten- und Gerätesegmente dürfen weder `/`, `+` noch `#` enthalten, nicht mit `$` beginnen und sind auf 100 Zeichen begrenzt.",
  "| Topic | Payload |": "| MQTT-Topic | Payload |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | Ein JSON-Objekt mit Messwerten, `{"metrics":{"iot_temperature_celsius":21.5}}`, oder ein flaches Objekt, dessen numerische Felder die Metriken sind |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | Ein einzelner Wert: eine bloße Zahl (`23.4`) oder `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` oder `offline`, abgebildet auf `iot_device_up` |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    'Telemetrie-Payloads können außerdem `"attributes"` (eine String-Map, die auf jeden Datenpunkt gesetzt wird; nutzen Sie sie für `iot.device.kind`, `iot.device.type`, `iot.device.firmware` oder eigene Labels) und `"timestamp"` (ISO-8601 oder Unix-Sekunden/-Millisekunden) enthalten. Beides ist optional; fehlt `timestamp`, wird der Aufnahmezeitpunkt verwendet.',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "Der Endpunkt dient nur der Aufnahme: Abonnements werden abgelehnt. Eine Veröffentlichung ist auf 128 KB und 100 Metriken begrenzt. Veröffentlichungen außerhalb dieses Vertrags oder mit fehlerhaften Payloads werden angenommen und verworfen (MQTT 3.1.1 kennt keine Fehlerantwort pro Nachricht), und OneUptime protokolliert eine Warnung mit dem Grund.",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "Selbst gehostete Installationen können zusätzlich rohes MQTT über TCP freigeben (`MQTT_INGEST_PORT`, Standard `1883`). Der Listener ist standardmäßig nur im Cluster- oder Compose-Netzwerk erreichbar; geben Sie ihn frei, wenn Ihre Geräte kein WebSocket sprechen. Die Keepalive-Obergrenze von WebSocket gilt dort nicht.",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "Setzen Sie `MQTT_INGEST_ENABLED=false` beim App-Dienst, um die MQTT-Listener abzuschalten.",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. Vergewissern Sie sich, dass das Topic genau `oneuptime/<fleet>/<device>/…` folgt: Das Flottensegment des Topics legt die Flotte an.",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. Veröffentlichungen außerhalb des Topic-Vertrags oder mit fehlerhaften Payloads werden angenommen und verworfen (MQTT 3.1.1 kennt keine Fehlerantwort pro Nachricht). Vergleichen Sie Ihre mit **MQTT-Topics und -Payloads** unter Erweitert; auf einer selbst gehosteten Instanz nennen die Protokolle der App den Grund (`MQTT: dropped publish to …`).",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "OneUptime weist falsche Zugangsdaten bei CONNECT mit Rückgabecode 4 ab. Prüfen Sie, ob:",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- das Passwort ein gültiger Ingestion-Schlüssel ist (oder, bei einem registrierten Gerät, das Geheimnis der Zugangskennung mit ihrer Kennungs-ID als Benutzername);",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- der Schlüssel ein Serverschlüssel ist (Browserschlüssel werden über MQTT abgelehnt) und weder deaktiviert noch abgelaufen ist.",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. Die Geräte-ID ist das Segment `<device>` des Topics: Halten Sie sie über alle Veröffentlichungen stabil; eine wechselnde ID erzeugt doppelte Gerätezeilen.",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. Veröffentlichen Sie `iot_device_info` (nur Identität) oder eine `status`-Nachricht für Geräte, die noch keine Messwerte gemeldet haben, damit sie trotzdem im Inventar erscheinen.",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "Auf dem WebSocket-Endpunkt werden inaktive Verbindungen nach 300 Sekunden geschlossen, was den Last Will und einen falschen Device-Offline-Warnung auslöst. Halten Sie das MQTT-Keepalive unter 5 Minuten; die Standardwerte der Client-Bibliotheken von 60 s sind in Ordnung.",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Ersetzen Sie `sensor-001` durch die ID des Geräts: OneUptime fügt das Gerät anhand des Topics der Flotte **`fleet-1`** hinzu. Der Last Will meldet das Gerät offline, sobald seine Verbindung abbricht; Geräte, die sich direkt verbinden, fahren mit einer eigenen Zugangskennung besser (beides unter Erweitert).",
};

export default TRANSLATION;
