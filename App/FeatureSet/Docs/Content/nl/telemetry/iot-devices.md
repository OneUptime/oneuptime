# OneUptime IoT-apparaten

## Overzicht

OneUptime monitort vloten van IoT-apparaten — sensoren, gateways, controllers en edge-boxen — door standaard OpenTelemetry (OTLP) metrics te verwerken. Elk apparaat (of een gateway namens het apparaat) pusht een kleine set `iot_*` metrics via OTLP HTTP, voorzien van een label dat aangeeft tot welke **vloot** het behoort en zijn eigen **device-id**. OneUptime groepeert die metrics in een vloot, bouwt een live apparaatinventaris op en houdt per apparaat de accu, connectiviteit, temperatuur, CPU, geheugen en beschikbaarheid bij.

Er is geen agent die je aan de apparaatzijde hoeft te installeren — alles wat OTLP kan spreken (een OpenTelemetry SDK op het apparaat, of een OpenTelemetry Collector die op een gateway draait en uitwaaiert naar veel apparaten) werkt. Deze pagina is de **ingestie-handleiding**. Voor het configureren van IoT-monitors en -waarschuwingen bovenop de data die je pusht, zie [IoT Device Monitor](/docs/monitor/iot-device-monitor).

## Vereisten

- Een apparaat, gateway of collector die OTLP/HTTP naar OneUptime kan sturen
- Netwerkbereikbaarheid van het apparaat/de gateway naar je OneUptime-instantie
- Een **OneUptime Telemetry Ingestion Token** — maak er een aan via _Project Settings → Telemetry Ingestion Keys_ en kopieer de `x-oneuptime-token`-waarde

## Hoe OneUptime IoT modelleert

OneUptime brengt je apparaten onder in twee concepten met behulp van OpenTelemetry-resourceattributen:

- **Vloot** — een logische groep apparaten (bijvoorbeeld `building-a-sensors` of `field-gateways`). De vloot wordt afgeleid van het `iot.fleet.name`-resourceattribuut en verschijnt in OneUptime als de telemetry-service `iot/<fleet>`. Stel `service.name=iot/<fleet>` in zodat logs en metrics onder dezelfde service worden uitgelijnd.
- **Apparaat** — een afzonderlijk apparaat binnen een vloot, geïdentificeerd door het `device.id`-attribuut. OneUptime bouwt en onderhoudt per vloot een apparaatinventaris met `device.id` als sleutel.

Optionele attributen verfijnen hoe elk apparaat wordt geclassificeerd en gescoopt in monitors:

| Attribuut            | Vereist | Beschrijving                                                                      |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `iot.fleet.name`     | Ja      | De vloot waartoe dit apparaat behoort. Wordt de OneUptime-service `iot/<fleet>`    |
| `device.id`          | Ja      | Stabiele, unieke id voor het apparaat binnen de vloot                                |
| `iot.device.kind`    | Nee       | De apparaatklasse — bijvoorbeeld `Device`, `Sensor` of `Gateway`. Standaard `Device` |
| `iot.device.type`    | Nee       | Een fijnmaziger apparaattype/-model dat wordt gebruikt om monitors te filteren (bijvoorbeeld `temp-sensor`) |
| `iot.device.firmware`| Nee       | Firmwareversie die door het apparaat wordt gerapporteerd                                          |

## Metrics verzenden via de OpenTelemetry SDK

Als je apparaat rechtstreeks een OpenTelemetry SDK draait, wijs deze dan naar OneUptime en stempel de IoT-resourceattributen via de standaard `OTEL_*`-omgevingsvariabelen. Vervang het token, het endpoint, de vlootnaam en de device-id door de waarden voor jouw omgeving.

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
```

| Omgevingsvariabele          | Vereist | Beschrijving                                                                                          |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Ja      | OneUptime OTLP-endpoint (`https://oneuptime.com/otlp`, of `http(s)://YOUR-ONEUPTIME-HOST/otlp` bij self-hosting) |
| `OTEL_EXPORTER_OTLP_HEADERS`  | Ja      | `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`                                                    |
| `OTEL_RESOURCE_ATTRIBUTES`    | Ja      | Door komma's gescheiden resourceattributen. Moet `iot.fleet.name`, `device.id` en `service.name=iot/<fleet>` bevatten |

Verstuur je metingen als metrics met de `iot_*`-namen hieronder (zie [Metric-conventies](#metric-conventies)). Binnen ongeveer een minuut verschijnt het apparaat in het gedeelte **IoT** van het OneUptime-dashboard.

## Metrics verzenden via een OpenTelemetry Collector

Wanneer veel apparaten rapporteren via een gateway, draai dan een OpenTelemetry Collector op de gateway en exporteer naar OneUptime. De `resource`-processor stempelt de vlootattributen; ontvang metingen van je apparaten (OTLP, MQTT-bridge, bestandslogs, enz.) en stuur ze door:

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
    # OneUptime vereist de JSON-encoder in plaats van de standaard Proto(buf)
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

- **`resource`** stempelt elk record met de vlootattributen. Stel `iot.fleet.name` (en de bijbehorende `service.name=iot/<fleet>`) per gateway in zodat de apparaten van elke gateway in de juiste vloot terechtkomen.
- Houd `device.id` (en optioneel `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) op elk datapunt zodat OneUptime het afzonderlijke apparaat binnen de vloot kan herleiden.
- **`otlphttp`** verstuurt naar OneUptime via HTTPS met het ingestietoken eraan gekoppeld. Let op: `encoding: json` en de `Content-Type: application/json`-header zijn vereist.

## Metrics verzenden via MQTT

OneUptime wordt geleverd met een ingebouwd MQTT-endpoint, zodat apparaten die al MQTT spreken hun metingen rechtstreeks kunnen pushen — er is geen OpenTelemetry SDK, collector of bridge vereist. Alles wat via MQTT wordt gepubliceerd, komt in dezelfde pijplijn terecht als OTLP: vloten worden automatisch aangemaakt, de apparaatinventaris wordt bijgewerkt en elke IoT-monitor en elk waarschuwingssjabloon werkt ongewijzigd.

**Endpoints**

| Transport             | Adres                                  | Opmerkingen                                                                               |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| MQTT over WebSocket   | `wss://<your-host>/mqtt`               | Werkt op elke deployment — loopt via de normale HTTPS-poort door de OneUptime-ingress     |
| MQTT over TCP         | `<app-host>:1883` (`MQTT_INGEST_PORT`) | Self-hosted: standaard alleen intern binnen het cluster-/compose-netwerk; stel deze bloot als je hem nodig hebt |

**Authenticatie** — twee opties:

- **Projectbreed**: verstuur je **Telemetry Ingestion Token** als het MQTT-wachtwoord (de gebruikersnaam wordt genegeerd; als je client alleen een gebruikersnaamveld biedt, zet het token dan daarin). Geschikt voor gateways die namens veel apparaten publiceren.
- **Per apparaat** (aanbevolen voor apparaten die rechtstreeks verbinden): registreer het apparaat onder het tabblad **Device Registry** van de vloot in het dashboard. Registratie geeft een credential per apparaat uit — de credential-id is de MQTT-**gebruikersnaam** en het geheim is het **wachtwoord**. Clients die per apparaat zijn geauthenticeerd, kunnen alleen publiceren onder hun eigen `oneuptime/<fleet>/<device>/…`-topics, een enkel gecompromitteerd apparaat kan vanuit het dashboard worden ingetrokken zonder de rest van de vloot aan te raken (intrekking wordt binnen ongeveer een minuut van kracht, zelfs voor verbonden sessies), en geregistreerde apparaten krijgen **offlinedetectie bij stille uitval**: ze blijven als Offline in de inventaris staan in plaats van te verdwijnen wanneer ze stoppen met rapporteren, en het waarschuwingssjabloon Device Offline wordt voor hen geactiveerd, zelfs als ze uitvallen zonder Last Will.

Ongeldige credentials worden bij CONNECT geweigerd met retourcode 4 (bad username or password), zodat een verkeerd geconfigureerd apparaat luid en duidelijk faalt.

**Topics** — publiceer onder het vaste `oneuptime/`-voorvoegsel. Vloot- en apparaatsegmenten mogen geen `/`, `+` of `#` bevatten en zijn beperkt tot 100 tekens:

| Topic                                            | Payload                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `oneuptime/<fleet>/<device>/telemetry`           | JSON-object met metingen — `{ "metrics": { "iot_temperature_celsius": 21.5 } }`, of een plat object waarvan de numerieke velden de metrics zijn |
| `oneuptime/<fleet>/<device>/metrics/<metricName>`| Eén enkele waarde — een kaal getal (`23.4`) of `{ "value": 23.4 }`                                    |
| `oneuptime/<fleet>/<device>/status`              | `"online"` of `"offline"` (ook `1`/`0`, `true`/`false`, `up`/`down`) — wordt toegewezen aan `iot_device_up` |

Telemetry-payloads mogen ook `"attributes"` bevatten (een string-map die op elk datapunt wordt gestempeld — gebruik deze voor `iot.device.kind`, `iot.device.type`, `iot.device.firmware` of je eigen labels) en `"timestamp"` (ISO-8601, of unix-seconden/-milliseconden). Beide zijn optioneel; als `timestamp` ontbreekt, wordt het ingestietijdstip gebruikt.

**Offlinedetectie met Last Will** — registreer een MQTT Last Will op `oneuptime/<fleet>/<device>/status` met payload `offline`. Als het apparaat uitvalt of van het netwerk verdwijnt, publiceert de broker namens het apparaat `iot_device_up = 0` op het moment dat de sessie eindigt — waarmee het standaard waarschuwingssjabloon **Device Offline** wordt geactiveerd en het apparaat in de inventaris op Down wordt gezet, zonder polling en zonder te wachten op een gemiste scrape. Publiceer `online` op hetzelfde topic na het verbinden zodat het apparaat weer als Up wordt weergegeven.

Voorbeeld met `mosquitto_pub` (ruwe TCP, self-hosted):

```bash
mosquitto_pub -h YOUR-ONEUPTIME-APP-HOST -p 1883 \
  -u oneuptime -P "YOUR_TELEMETRY_INGESTION_TOKEN" \
  -t "oneuptime/building-a-sensors/sensor-001/telemetry" \
  -m '{"metrics":{"iot_device_up":1,"iot_battery_percent":87,"iot_temperature_celsius":21.5},"attributes":{"iot.device.type":"temp-sensor","iot.device.firmware":"1.4.2"}}'
```

Voorbeeld met Node.js `mqtt` via WebSocket (werkt tegen oneuptime.com en elke self-hosted instantie):

```javascript
const mqtt = require("mqtt");

const client = mqtt.connect("wss://oneuptime.com/mqtt", {
  username: "oneuptime", // genegeerd — het token hieronder is wat authenticeert
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

Voorbeeld met Python `paho-mqtt` via WebSocket:

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

Opmerkingen:

- Het endpoint is **alleen voor ingestie**: abonnementen worden geweigerd (SUBACK-fout). Gebruik QoS 1 als je wilt dat de broker de ontvangst bevestigt. Ingestie is **at-least-once** — een QoS 1/2-hertransmissie na een verloren bevestiging kan dubbele datapunten opleveren.
- Publicaties buiten het topiccontract of met misvormde payloads worden geaccepteerd en **verworpen** (MQTT 3.1.1 heeft geen foutantwoord per bericht) — de server logt een waarschuwing met de reden, dus controleer de OneUptime-app-logs als er geen data binnenkomt.
- Houd op het WebSocket-endpoint de MQTT-keepalive **onder 5 minuten** — de OneUptime-ingress sluit inactieve WebSocket-verbindingen na 300 seconden, wat je Last Will en een valse Device Offline-waarschuwing zou activeren. De standaardwaarden van clientbibliotheken (60 s voor `mqtt` en `paho-mqtt`) zijn prima. Het ruwe TCP-endpoint kent zo'n bovengrens niet.
- Payloads zijn begrensd op 128 KB en 100 metrics per publicatie; te grote pakketten verbreken de verbinding.

## Metric-conventies

OneUptime herkent de volgende `iot_*`-metricnamen. Elk datapunt moet het `device.id`-label dragen zodat de meting aan het juiste apparaat wordt toegeschreven. Je hoeft alleen de metrics te versturen die zinvol zijn voor je apparaat — ontbrekende metrics worden eenvoudigweg niet in grafieken weergegeven.

| Metricnaam                 | Betekenis                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `iot_device_up`             | Apparaatbeschikbaarheid. `1` = up/bereikbaar, `0` = down. Stuurt de IoT Device monitor aan |
| `iot_device_info`           | Signaal met alleen identiteit. Draagt `device.id` / kind / type / firmware zodat een apparaat in de inventaris verschijnt nog vóór het metingen rapporteert |
| `iot_battery_percent`       | Acculaadniveau, `0`–`100` (%)                                            |
| `iot_signal_strength_dbm`   | Draadloze signaalsterkte in dBm (bijvoorbeeld Wi-Fi / LoRa / cellulaire RSSI)      |
| `iot_temperature_celsius`   | Apparaat- of sensortemperatuur in °C                                             |
| `iot_cpu_usage_ratio`       | CPU-gebruik als een verhouding `0`–`1` (OneUptime slaat dit op als een percentage)        |
| `iot_memory_usage_bytes`    | Momenteel gebruikt geheugen, in bytes                                                |
| `iot_memory_size_bytes`     | Totaal beschikbaar geheugen op het apparaat, in bytes                                 |
| `iot_uptime_seconds`        | Seconden sinds het apparaat voor het laatst is opgestart                                           |

## De installatie verifiëren

1. Bevestig dat je apparaat of gateway zonder fouten exporteert (controleer de SDK-/collector-logs op exportfouten en HTTP `401`/`403`-antwoorden).
2. Open in het OneUptime-dashboard het gedeelte **IoT** — je vloot zou binnen ongeveer een minuut moeten verschijnen als `iot/<fleet>`.
3. Open het tabblad **Devices** van de vloot — elke `device.id` die je hebt verstuurd, zou vermeld moeten staan met de meest recente accu, signaal, temperatuur, CPU, geheugen en up/down-status.
4. Open **Metrics** onder de vloot om een van de bovenstaande `iot_*`-reeksen in een grafiek weer te geven.

## Probleemoplossing

### Vloot verschijnt niet

1. Controleer of `iot.fleet.name` is ingesteld als een **resource**-attribuut (niet als een datapuntlabel), en dat `service.name` gelijk is aan `iot/<fleet>`.
2. Bevestig dat het exporter-endpoint `https://oneuptime.com/otlp` is (of je self-hosted `…/otlp`) en dat de `x-oneuptime-token`-header een geldig token draagt.
3. Als je een collector gebruikt, zorg er dan voor dat `encoding: json` en `Content-Type: application/json` zijn ingesteld op de `otlphttp`-exporter.

### Apparaten ontbreken in de inventaris

1. Zorg ervoor dat elk datapunt een `device.id`-label draagt — apparaten worden hierop gesleuteld.
2. Verstuur `iot_device_info` (alleen identiteit) voor apparaten die nog geen metingen hebben gerapporteerd, zodat ze toch in de inventaris verschijnen.
3. Controleer of de `device.id`-waarden stabiel zijn over rapportages heen; een veranderende id creëert dubbele apparaatrijen.

### HTTP 401 / 403 van de exporter

Het ingestietoken is ongeldig, ingetrokken of ontbreekt. Genereer een nieuw token via _Project Settings → Telemetry Ingestion Keys_ en werk de `x-oneuptime-token`-header bij.

### Metrics worden niet in grafieken weergegeven

1. Bevestig dat je exact de `iot_*`-metricnamen uit de tabel [Metric-conventies](#metric-conventies) gebruikt — niet-herkende namen worden opgeslagen als generieke metrics en vullen geen IoT-grafieken.
2. Onthoud dat `iot_cpu_usage_ratio` een `0`–`1`-verhouding is; verstuur de ruwe verhouding en OneUptime geeft deze weer als een percentage.
3. Houd er rekening mee dat het tot een minuut kan duren voordat de eerste datapunten verschijnen nadat een apparaat begint met rapporteren.

## Self-hosted OneUptime

Als je OneUptime zelf host, wijs het endpoint dan naar je eigen instantie:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://your-oneuptime-host.example.com/otlp
```

Of, in een collector:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

Als je instantie alleen HTTP gebruikt, wijzig dan het schema naar `http://` en gebruik de juiste poort.

## Volgende stappen

- Configureer een **IoT Device Monitor** om te waarschuwen bij apparaat offline, lage accu, zwak signaal, hoge temperatuur en hoge CPU-condities — zie [IoT Device Monitor](/docs/monitor/iot-device-monitor).
- Gebruik voor niet-gecontaineriseerde hosts (Linux / macOS / Windows VM's en bare metal) de [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
- Om de onderliggende OTLP-integratie diepgaand te leren kennen, zie [Integrate OpenTelemetry with OneUptime](/docs/telemetry/open-telemetry).
