# OneUptime IoT-enheder

## Oversigt

OneUptime overvåger flåder af IoT-enheder — sensorer, gateways, controllere og edge-bokse — ved at indlæse et lille sæt `iot_*` metrikker, mærket med hvilken **flåde** hver måling tilhører og dens eget **enheds-id**. OneUptime grupperer disse metrikker i en flåde, opbygger en live enhedsoversigt og sporer batteri, forbindelse, temperatur, CPU, hukommelse og tilgængelighed pr. enhed.

Enheder kan sende målinger på to måder, og begge fører ind i nøjagtig den samme flådeoversigt, de samme dashboards og de samme monitorer:

- **OpenTelemetry (OTLP)** — en OTel SDK på enheden eller en OpenTelemetry Collector på en gateway, der fordeler til mange enheder.
- **MQTT** — forbind direkte til OneUptimes indbyggede MQTT-endpoint (MQTT-over-WebSocket på `wss://<your-host>/mqtt` eller rå MQTT TCP på selv-hostede deployments) og publicer JSON-målinger. Ingen collector påkrævet, og understøttelse af Last Will giver dig øjeblikkelig offline-detektering.

Der er ingen proprietær agent at installere på enhedssiden. Denne side er **indlæsningsguiden**. For konfiguration af IoT-monitorer og alarmer oven på de data, du sender, se [IoT-enhedsmonitor](/docs/monitor/iot-device-monitor).

## Forudsætninger

- En enhed, gateway eller collector, der kan sende OTLP/HTTP til OneUptime
- Netværksforbindelse fra enheden/gatewayen til din OneUptime-instans
- Et **OneUptime Telemetry Ingestion Token** — opret et fra _Project Settings → Telemetry Ingestion Keys_ og kopier `x-oneuptime-token`-værdien

## Hvordan OneUptime modellerer IoT

OneUptime kortlægger dine enheder på to begreber ved hjælp af OpenTelemetry-ressourceattributter:

- **Flåde** — en logisk gruppe af enheder (for eksempel `building-a-sensors` eller `field-gateways`). Flåden udledes af ressourceattributten `iot.fleet.name` og vises i OneUptime som telemetritjenesten `iot/<fleet>`. Sæt `service.name=iot/<fleet>`, så logs og metrikker placeres under den samme tjeneste.
- **Enhed** — en individuel enhed inden for en flåde, identificeret ved attributten `device.id`. OneUptime opbygger og vedligeholder en enhedsoversigt pr. flåde nøglet på `device.id`.

Valgfrie attributter forfiner, hvordan hver enhed klassificeres og afgrænses i monitorer:

| Attribut             | Påkrævet | Beskrivelse                                                                      |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `iot.fleet.name`     | Ja       | Den flåde, denne enhed tilhører. Bliver til OneUptime-tjenesten `iot/<fleet>`    |
| `device.id`          | Ja       | Stabilt, unikt id for enheden inden for flåden                                   |
| `iot.device.kind`    | Nej      | Enhedsklassen — for eksempel `Device`, `Sensor` eller `Gateway`. Standard er `Device` |
| `iot.device.type`    | Nej      | En finere enhedstype/model brugt til at filtrere monitorer (for eksempel `temp-sensor`) |
| `iot.device.firmware`| Nej      | Firmwareversion rapporteret af enheden                                          |

## Afsendelse af metrikker via OpenTelemetry SDK

Hvis din enhed kører en OpenTelemetry SDK direkte, så peg den mod OneUptime og stempl IoT-ressourceattributterne via standard `OTEL_*` miljøvariablerne. Erstat token, endpoint, flådenavn og enheds-id med værdier for dit miljø.

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
```

| Miljøvariabel                 | Påkrævet | Beskrivelse                                                                                          |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Ja       | OneUptime OTLP-endpoint (`https://oneuptime.com/otlp`, eller `http(s)://YOUR-ONEUPTIME-HOST/otlp` selv-hostet) |
| `OTEL_EXPORTER_OTLP_HEADERS`  | Ja       | `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`                                                    |
| `OTEL_RESOURCE_ATTRIBUTES`    | Ja       | Kommasepareret liste af ressourceattributter. Skal inkludere `iot.fleet.name`, `device.id` og `service.name=iot/<fleet>` |

Udsend dine målinger som metrikker ved hjælp af `iot_*`-navnene nedenfor (se [Metrikkonventioner](#metrikkonventioner)). I løbet af cirka et minut vises enheden under **IoT**-sektionen i OneUptime-dashboardet.

## Afsendelse af metrikker via en OpenTelemetry Collector

Når mange enheder rapporterer gennem en gateway, så kør en OpenTelemetry Collector på gatewayen og eksporter til OneUptime. `resource`-processoren stempler flådeattributterne; modtag målinger fra dine enheder (OTLP, MQTT-bro, fil-logs osv.) og videresend dem:

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
    headers:
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp]
```

- **`resource`** stempler hver post med flådeattributterne. Sæt `iot.fleet.name` (og det matchende `service.name=iot/<fleet>`) pr. gateway, så hver gateways enheder havner i den rigtige flåde.
- Behold `device.id` (og valgfrit `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) på hvert datapunkt, så OneUptime kan slå den individuelle enhed op inde i flåden.
- **`otlphttp`** sender til OneUptime over HTTPS med indlæsningstokenet vedhæftet. Både standard protobuf-encodingen og `encoding: json` accepteres.

## Afsendelse af metrikker via MQTT

OneUptime leveres med et indbygget MQTT-endpoint, så enheder, der allerede taler MQTT, kan sende målinger direkte — ingen OpenTelemetry SDK, collector eller bro påkrævet. Alt, der publiceres over MQTT, havner i den samme pipeline som OTLP: flåder oprettes automatisk, enhedsoversigten opdateres, og hver IoT-monitor og alarmskabelon fungerer uændret.

**Endpoints**

| Transport             | Adresse                                | Bemærkninger                                                                              |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| MQTT over WebSocket   | `wss://<your-host>/mqtt`               | Fungerer på alle deployments — kører på den normale HTTPS-port gennem OneUptime-ingressen |
| MQTT over TCP         | `<app-host>:1883` (`MQTT_INGEST_PORT`) | Selv-hostet: internt i cluster-/compose-netværket som standard; eksponer det, hvis du har brug for det |

**Autentificering** — to muligheder:

- **Projektomfattende**: send dit **Telemetry Ingestion Token** som MQTT-adgangskoden (brugernavnet ignoreres; hvis din klient kun eksponerer et brugernavnsfelt, så indsæt tokenet der i stedet). Det rigtige valg for gateways, der publicerer på vegne af mange enheder.
- **Pr. enhed** (anbefales for enheder, der forbinder direkte): registrer enheden under flådens **Device Registry**-fane i dashboardet. Registreringen udsteder en legitimation pr. enhed — legitimations-id'et er MQTT-**brugernavnet**, og hemmeligheden er **adgangskoden**. Enhedsautentificerede klienter kan kun publicere under deres egne `oneuptime/<fleet>/<device>/…`-emner, en enkelt kompromitteret enhed kan tilbagekaldes fra dashboardet uden at røre resten af flåden (tilbagekaldelsen træder i kraft i løbet af cirka et minut, selv for forbundne sessioner), og registrerede enheder får **detektering af stille død**: de forbliver i oversigten som Offline i stedet for at forsvinde, når de holder op med at rapportere, og alarmskabelonen Device Offline udløses for dem, selv hvis de dør uden en Last Will.

Ugyldige legitimationsoplysninger afvises ved CONNECT med returkode 4 (forkert brugernavn eller adgangskode), så en fejlkonfigureret enhed fejler højlydt.

**Emner** — publicer under det faste `oneuptime/`-præfiks. Flåde- og enhedssegmenter må ikke indeholde `/`, `+` eller `#`, og de er begrænset til 100 tegn:

| Emne                                             | Payload                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `oneuptime/<fleet>/<device>/telemetry`           | JSON-objekt med målinger — `{ "metrics": { "iot_temperature_celsius": 21.5 } }`, eller et fladt objekt, hvis numeriske felter er metrikkerne |
| `oneuptime/<fleet>/<device>/metrics/<metricName>`| En enkelt værdi — et bart tal (`23.4`) eller `{ "value": 23.4 }`                                      |
| `oneuptime/<fleet>/<device>/status`              | `"online"` eller `"offline"` (også `1`/`0`, `true`/`false`, `up`/`down`) — mapper til `iot_device_up` |

Telemetri-payloads kan også bære `"attributes"` (et string-map, der stemples på hvert datapunkt — brug det til `iot.device.kind`, `iot.device.type`, `iot.device.firmware` eller dine egne labels) og `"timestamp"` (ISO-8601 eller unix-sekunder/-millisekunder). Begge er valgfrie; indlæsningstidspunktet bruges, når `timestamp` mangler.

**Offline-detektering med Last Will** — registrer en MQTT Last Will på `oneuptime/<fleet>/<device>/status` med payloaden `offline`. Hvis enheden dør eller falder af netværket, publicerer brokeren `iot_device_up = 0` på dens vegne i det øjeblik, sessionen slutter — hvilket udløser standardalarmskabelonen **Device Offline** og vender enheden til Nede i oversigten, uden polling og uden at vente på en mistet scrape. Publicer `online` til det samme emne efter forbindelse, så enheden vises som Oppe igen.

Eksempel med `mosquitto_pub` (rå TCP, selv-hostet):

```bash
mosquitto_pub -h YOUR-ONEUPTIME-APP-HOST -p 1883 \
  -u oneuptime -P "YOUR_TELEMETRY_INGESTION_TOKEN" \
  -t "oneuptime/building-a-sensors/sensor-001/telemetry" \
  -m '{"metrics":{"iot_device_up":1,"iot_battery_percent":87,"iot_temperature_celsius":21.5},"attributes":{"iot.device.type":"temp-sensor","iot.device.firmware":"1.4.2"}}'
```

Eksempel med Node.js `mqtt` over WebSocket (fungerer mod oneuptime.com og enhver selv-hostet instans):

```javascript
const mqtt = require("mqtt");

const client = mqtt.connect("wss://oneuptime.com/mqtt", {
  username: "oneuptime", // ignoreres — det er tokenet nedenfor, der autentificerer
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

Eksempel med Python `paho-mqtt` over WebSocket:

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

Bemærkninger:

- Endpointet er **kun til indlæsning**: abonnementer afvises (SUBACK-fejl). Brug QoS 1, hvis du vil have brokeren til at bekræfte modtagelsen. Indlæsning er **mindst én gang** — en QoS 1/2-gentransmission efter en mistet bekræftelse kan producere duplikerede datapunkter.
- Publiceringer uden for emnekontrakten eller med misdannede payloads accepteres og **droppes** (MQTT 3.1.1 har ingen fejlrespons pr. besked) — serveren logger en advarsel med årsagen, så tjek OneUptime-app-logs, hvis der ikke ankommer data.
- På WebSocket-endpointet skal du holde MQTT-keepalive **under 5 minutter** — OneUptime-ingressen lukker inaktive WebSocket-forbindelser efter 300 sekunder, hvilket ville udløse din Last Will og en falsk Device Offline-alarm. Klientbibliotekernes standardværdier (60 s for `mqtt` og `paho-mqtt`) er fine. Det rå TCP-endpoint har ikke et sådant loft.
- Payloads er begrænset til 128 KB og 100 metrikker pr. publicering; for store pakker afbryder forbindelsen.

## Metrikkonventioner

OneUptime genkender følgende `iot_*` metriknavne. Hvert datapunkt bør bære `device.id`-labelen, så målingen tilskrives den rigtige enhed. Du behøver kun at sende de metrikker, der giver mening for din enhed — manglende metrikker bliver blot ikke vist i grafer.

| Metriknavn                  | Betydning                                                                      |
| --------------------------- | ------------------------------------------------------------------------------ |
| `iot_device_up`             | Enhedens tilgængelighed. `1` = oppe/tilgængelig, `0` = nede. Driver IoT-enhedsmonitoren |
| `iot_device_info`           | Kun identitetssignal. Bærer `device.id` / kind / type / firmware, så en enhed vises i oversigten, selv før den rapporterer målinger |
| `iot_battery_percent`       | Batteriets opladningsniveau, `0`–`100` (%)                                     |
| `iot_signal_strength_dbm`   | Trådløs signalstyrke i dBm (for eksempel Wi-Fi / LoRa / mobil-RSSI)            |
| `iot_temperature_celsius`   | Enheds- eller sensortemperatur i °C                                            |
| `iot_cpu_usage_ratio`       | CPU-udnyttelse som et forhold `0`–`1` (OneUptime gemmer det som en procentdel)  |
| `iot_memory_usage_bytes`    | Hukommelse, der aktuelt er i brug, i bytes                                     |
| `iot_memory_size_bytes`     | Samlet hukommelse tilgængelig på enheden, i bytes                              |
| `iot_uptime_seconds`        | Sekunder siden enheden sidst startede                                          |

## Verificer installationen

1. Bekræft, at din enhed eller gateway eksporterer uden fejl (tjek SDK-/collector-logs for eksportfejl og HTTP `401`/`403`-svar).
2. I OneUptime-dashboardet skal du åbne **IoT**-sektionen — din flåde bør vises som `iot/<fleet>` i løbet af cirka et minut.
3. Åbn flådens **Devices**-fane — hvert `device.id`, du har sendt, bør være listet med dets seneste batteri, signal, temperatur, CPU, hukommelse og oppe/nede-status.
4. Åbn **Metrics** under flåden for at tegne grafer over en hvilken som helst af `iot_*`-serierne ovenfor.

## Fejlfinding

### Flåden vises ikke

1. Verificer, at `iot.fleet.name` er sat som en **ressource**-attribut (ikke en datapunkt-label), og at `service.name` er `iot/<fleet>`.
2. Bekræft, at eksportør-endpointet er `https://oneuptime.com/otlp` (eller dit selv-hostede `…/otlp`), og at `x-oneuptime-token`-headeren bærer et gyldigt token.
3. Hvis du bruger MQTT, så bekræft, at emnet følger `oneuptime/<fleet>/<device>/…` nøjagtigt — det er emnets flådesegment, der opretter flåden.

### Enheder mangler i oversigten

1. Sørg for, at hvert datapunkt bærer en `device.id`-label — enheder nøgles på den.
2. Send `iot_device_info` (kun identitet) for enheder, der endnu ikke har rapporteret målinger, så de stadig vises i oversigten.
3. Tjek, at `device.id`-værdierne er stabile på tværs af rapporter; et skiftende id skaber duplikerede enhedsrækker.

### HTTP 401 / 403 fra eksportøren

Indlæsningstokenet er ugyldigt, tilbagekaldt eller mangler. Generer et nyt fra _Project Settings → Telemetry Ingestion Keys_ og opdater `x-oneuptime-token`-headeren.

### Metrikker vises ikke i grafer

1. Bekræft, at du bruger de nøjagtige `iot_*` metriknavne fra tabellen [Metrikkonventioner](#metrikkonventioner) — ukendte navne gemmes som generiske metrikker og vil ikke udfylde IoT-grafer.
2. Husk, at `iot_cpu_usage_ratio` er et `0`–`1`-forhold; send det rå forhold, og OneUptime gengiver det som en procentdel.
3. Tillad op til et minut, før de første datapunkter dukker op, efter en enhed begynder at rapportere.

## Selv-hostet OneUptime

Hvis du selv-hoster OneUptime, så peg endpointet mod din egen instans:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://your-oneuptime-host.example.com/otlp
```

Eller, i en collector:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

For MQTT skal du forbinde til `wss://your-oneuptime-host.example.com/mqtt` eller eksponere app-tjenestens rå MQTT TCP-port (`MQTT_INGEST_PORT`, standard `1883`), hvis dine enheder ikke kan tale WebSocket. Sæt `MQTT_INGEST_ENABLED=false` på app-tjenesten for at slå MQTT-lytterne helt fra.

Hvis din instans kun kører HTTP, så skift skemaet til `http://` (og `ws://` for MQTT) og brug den passende port.

## Næste skridt

- Konfigurer en **IoT-enhedsmonitor** for at alarmere om enheder offline, lavt batteri, svagt signal, høj temperatur og høje CPU-betingelser — se [IoT-enhedsmonitor](/docs/monitor/iot-device-monitor).
- For ikke-containeriserede værter (Linux / macOS / Windows-VM'er og fysiske maskiner), brug [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
- For at lære den underliggende OTLP-integration i dybden, se [Integrer OpenTelemetry med OneUptime](/docs/telemetry/open-telemetry).
