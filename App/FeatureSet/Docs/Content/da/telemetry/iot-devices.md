# OneUptime IoT-enheder

## Oversigt

OneUptime overvåger flåder af IoT-enheder — sensorer, gateways, controllere og edge-bokse — ved at indlæse standard OpenTelemetry (OTLP) metrikker. Hver enhed (eller en gateway på dens vegne) sender et lille sæt `iot_*` metrikker over OTLP HTTP, mærket med hvilken **flåde** den tilhører og dens eget **enheds-id**. OneUptime grupperer disse metrikker i en flåde, opbygger en live enhedsoversigt og sporer batteri, forbindelse, temperatur, CPU, hukommelse og tilgængelighed pr. enhed.

Der er ingen agent at installere på enhedssiden — alt, der kan tale OTLP (en OpenTelemetry SDK på enheden eller en OpenTelemetry Collector, der kører på en gateway og fordeler til mange enheder), fungerer. Denne side er **indlæsningsguiden**. For konfiguration af IoT-monitorer og alarmer oven på de data, du sender, se [IoT-enhedsmonitor](/docs/monitor/iot-device-monitor).

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

Udsend dine målinger som metrikker ved hjælp af `iot_*`-navnene nedenfor (se [Metrikkonventioner](#metric-conventions)). I løbet af cirka et minut vises enheden under **IoT**-sektionen i OneUptime-dashboardet.

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
    # OneUptime kræver JSON-encoderen i stedet for standard Proto(buf)
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

- **`resource`** stempler hver post med flådeattributterne. Sæt `iot.fleet.name` (og det matchende `service.name=iot/<fleet>`) pr. gateway, så hver gateways enheder havner i den rigtige flåde.
- Behold `device.id` (og valgfrit `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) på hvert datapunkt, så OneUptime kan slå den individuelle enhed op inde i flåden.
- **`otlphttp`** sender til OneUptime over HTTPS med indlæsningstokenet vedhæftet. Bemærk, at `encoding: json` og headeren `Content-Type: application/json` er påkrævet.

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
3. Hvis du bruger en collector, så sørg for, at `encoding: json` og `Content-Type: application/json` er sat på `otlphttp`-eksportøren.

### Enheder mangler i oversigten

1. Sørg for, at hvert datapunkt bærer en `device.id`-label — enheder nøgles på den.
2. Send `iot_device_info` (kun identitet) for enheder, der endnu ikke har rapporteret målinger, så de stadig vises i oversigten.
3. Tjek, at `device.id`-værdierne er stabile på tværs af rapporter; et skiftende id skaber duplikerede enhedsrækker.

### HTTP 401 / 403 fra eksportøren

Indlæsningstokenet er ugyldigt, tilbagekaldt eller mangler. Generer et nyt fra _Project Settings → Telemetry Ingestion Keys_ og opdater `x-oneuptime-token`-headeren.

### Metrikker vises ikke i grafer

1. Bekræft, at du bruger de nøjagtige `iot_*` metriknavne fra tabellen [Metrikkonventioner](#metric-conventions) — ukendte navne gemmes som generiske metrikker og vil ikke udfylde IoT-grafer.
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
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

Hvis din instans kun kører HTTP, så skift skemaet til `http://` og brug den passende port.

## Næste skridt

- Konfigurer en **IoT-enhedsmonitor** for at alarmere om enheder offline, lavt batteri, svagt signal, høj temperatur og høje CPU-betingelser — se [IoT-enhedsmonitor](/docs/monitor/iot-device-monitor).
- For ikke-containeriserede værter (Linux / macOS / Windows-VM'er og fysiske maskiner), brug [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
- For at lære den underliggende OTLP-integration i dybden, se [Integrer OpenTelemetry med OneUptime](/docs/telemetry/open-telemetry).
