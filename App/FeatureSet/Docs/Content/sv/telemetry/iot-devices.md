# OneUptime IoT-enheter

## Översikt

OneUptime övervakar flottor av IoT-enheter — sensorer, gateways, styrenheter och edge-boxar — genom att ta emot standardiserade OpenTelemetry-mätvärden (OTLP). Varje enhet (eller en gateway å dess vägnar) skickar en liten uppsättning `iot_*`-mätvärden via OTLP HTTP, märkta med vilken **flotta** den tillhör och sitt eget **enhets-id**. OneUptime grupperar dessa mätvärden i en flotta, bygger ett live-inventarium över enheter och spårar batteri, anslutning, temperatur, CPU, minne och tillgänglighet per enhet.

Det finns ingen agent att installera på enhetssidan — allt som kan tala OTLP (ett OpenTelemetry-SDK på enheten, eller en OpenTelemetry Collector som körs på en gateway och fördelar till många enheter) fungerar. Den här sidan är **installationsguiden**. För att konfigurera IoT-monitorer och varningar ovanpå de data du skickar, se [IoT Device Monitor](/docs/monitor/iot-device-monitor).

## Förutsättningar

- En enhet, gateway eller collector som kan skicka OTLP/HTTP till OneUptime
- Nätverksåtkomst från enheten/gatewayen till din OneUptime-instans
- En **OneUptime Telemetry Ingestion Token** — skapa en från _Project Settings → Telemetry Ingestion Keys_ och kopiera värdet för `x-oneuptime-token`

## Hur OneUptime modellerar IoT

OneUptime mappar dina enheter mot två koncept med hjälp av OpenTelemetry-resursattribut:

- **Flotta** — en logisk grupp av enheter (till exempel `building-a-sensors` eller `field-gateways`). Flottan härleds från resursattributet `iot.fleet.name` och visas i OneUptime som telemetritjänsten `iot/<fleet>`. Ange `service.name=iot/<fleet>` så att loggar och mätvärden hamnar under samma tjänst.
- **Enhet** — en enskild enhet inom en flotta, identifierad av attributet `device.id`. OneUptime bygger och underhåller ett enhetsinventarium per flotta med `device.id` som nyckel.

Valfria attribut förfinar hur varje enhet klassificeras och avgränsas i monitorer:

| Attribut             | Obligatoriskt | Beskrivning                                                                      |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `iot.fleet.name`     | Ja      | Flottan som den här enheten tillhör. Blir OneUptime-tjänsten `iot/<fleet>`    |
| `device.id`          | Ja      | Stabilt, unikt id för enheten inom flottan                                |
| `iot.device.kind`    | Nej       | Enhetsklassen — till exempel `Device`, `Sensor` eller `Gateway`. Standardvärdet är `Device` |
| `iot.device.type`    | Nej       | En mer detaljerad enhetstyp/-modell som används för att filtrera monitorer (till exempel `temp-sensor`) |
| `iot.device.firmware`| Nej       | Fast programvaruversion som enheten rapporterar                                          |

## Skicka mätvärden via OpenTelemetry-SDK:et

Om din enhet kör ett OpenTelemetry-SDK direkt, peka det mot OneUptime och stämpla IoT-resursattributen via de vanliga `OTEL_*`-miljövariablerna. Ersätt token, slutpunkt, flottnamn och enhets-id med värden för din miljö.

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
```

| Miljövariabel          | Obligatoriskt | Beskrivning                                                                                          |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Ja      | OneUptime OTLP-slutpunkt (`https://oneuptime.com/otlp`, eller `http(s)://YOUR-ONEUPTIME-HOST/otlp` vid självhosting) |
| `OTEL_EXPORTER_OTLP_HEADERS`  | Ja      | `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`                                                    |
| `OTEL_RESOURCE_ATTRIBUTES`    | Ja      | Kommaseparerade resursattribut. Måste innehålla `iot.fleet.name`, `device.id` och `service.name=iot/<fleet>` |

Skicka dina avläsningar som mätvärden med `iot_*`-namnen nedan (se [Metric Conventions](#metric-conventions)). Inom ungefär en minut visas enheten under **IoT**-sektionen i OneUptime-instrumentpanelen.

## Skicka mätvärden via en OpenTelemetry Collector

När många enheter rapporterar via en gateway, kör en OpenTelemetry Collector på gatewayen och exportera till OneUptime. Processorn `resource` stämplar flottattributen; ta emot avläsningar från dina enheter (OTLP, MQTT-brygga, filloggar osv.) och vidarebefordra dem:

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
    # OneUptime kräver JSON-kodaren i stället för standardvärdet Proto(buf)
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

- **`resource`** stämplar varje post med flottattributen. Ange `iot.fleet.name` (och det matchande `service.name=iot/<fleet>`) per gateway så att varje gateways enheter hamnar i rätt flotta.
- Behåll `device.id` (och eventuellt `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) på varje datapunkt så att OneUptime kan identifiera den enskilda enheten inom flottan.
- **`otlphttp`** skickar till OneUptime över HTTPS med ingestion-token bifogad. Observera att `encoding: json` och headern `Content-Type: application/json` krävs.

## Metric Conventions

OneUptime känner igen följande `iot_*`-mätvärdesnamn. Varje datapunkt bör bära etiketten `device.id` så att avläsningen tillskrivs rätt enhet. Du behöver bara skicka de mätvärden som är relevanta för din enhet — saknade mätvärden ritas helt enkelt inte ut i diagram.

| Mätvärdesnamn                 | Betydelse                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `iot_device_up`             | Enhetens tillgänglighet. `1` = uppe/nåbar, `0` = nere. Driver IoT Device-monitorn |
| `iot_device_info`           | Signal endast för identitet. Bär `device.id` / kind / type / firmware så att en enhet visas i inventariet redan innan den rapporterar avläsningar |
| `iot_battery_percent`       | Batteriets laddningsnivå, `0`–`100` (%)                                            |
| `iot_signal_strength_dbm`   | Trådlös signalstyrka i dBm (till exempel Wi-Fi / LoRa / mobilnäts-RSSI)      |
| `iot_temperature_celsius`   | Enhetens eller sensorns temperatur i °C                                             |
| `iot_cpu_usage_ratio`       | CPU-användning som ett förhållande `0`–`1` (OneUptime lagrar det som en procentandel)        |
| `iot_memory_usage_bytes`    | Minne som för närvarande används, i bytes                                                |
| `iot_memory_size_bytes`     | Totalt tillgängligt minne på enheten, i bytes                                 |
| `iot_uptime_seconds`        | Antal sekunder sedan enheten senast startade                                           |

## Verifiera installationen

1. Bekräfta att din enhet eller gateway exporterar utan fel (kontrollera SDK:ets/collectorns loggar efter exportfel och HTTP-svaren `401`/`403`).
2. Öppna **IoT**-sektionen i OneUptime-instrumentpanelen — din flotta bör visas som `iot/<fleet>` inom ungefär en minut.
3. Öppna flottans flik **Devices** — varje `device.id` du skickade bör listas med sitt senaste batteri, signal, temperatur, CPU, minne och uppe/nere-status.
4. Öppna **Metrics** under flottan för att rita upp någon av `iot_*`-serierna ovan i diagram.

## Felsökning

### Flottan visas inte

1. Verifiera att `iot.fleet.name` är angivet som ett **resurs**attribut (inte en datapunktsetikett), och att `service.name` är `iot/<fleet>`.
2. Bekräfta att exportörens slutpunkt är `https://oneuptime.com/otlp` (eller din självhostade `…/otlp`) och att headern `x-oneuptime-token` bär en giltig token.
3. Om du använder en collector, säkerställ att `encoding: json` och `Content-Type: application/json` är inställda på `otlphttp`-exportören.

### Enheter saknas i inventariet

1. Se till att varje datapunkt bär en `device.id`-etikett — enheter nycklas på den.
2. Skicka `iot_device_info` (endast identitet) för enheter som ännu inte har rapporterat avläsningar så att de ändå visas i inventariet.
3. Kontrollera att `device.id`-värdena är stabila mellan rapporter; ett föränderligt id skapar dubbletter av enhetsrader.

### HTTP 401 / 403 från exportören

Ingestion-token är ogiltig, återkallad eller saknas. Generera en ny från _Project Settings → Telemetry Ingestion Keys_ och uppdatera headern `x-oneuptime-token`.

### Mätvärden ritas inte ut i diagram

1. Bekräfta att du använder exakt de `iot_*`-mätvärdesnamn som finns i tabellen [Metric Conventions](#metric-conventions) — okända namn lagras som generiska mätvärden och fyller inte IoT-diagrammen.
2. Kom ihåg att `iot_cpu_usage_ratio` är ett förhållande `0`–`1`; skicka det råa förhållandet så renderar OneUptime det som en procentandel.
3. Ge det upp till en minut innan de första datapunkterna dyker upp efter att en enhet börjar rapportera.

## Självhostad OneUptime

Om du självhostar OneUptime, peka slutpunkten mot din egen instans:

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

Om din instans endast använder HTTP, ändra schemat till `http://` och använd lämplig port.

## Nästa steg

- Konfigurera en **IoT Device Monitor** för att varna vid enhet offline, lågt batteri, svag signal, hög temperatur och hög CPU-belastning — se [IoT Device Monitor](/docs/monitor/iot-device-monitor).
- För icke-containeriserade värdar (Linux / macOS / Windows-VM:ar och fysiska maskiner), använd [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
- För att lära dig den underliggande OTLP-integrationen på djupet, se [Integrate OpenTelemetry with OneUptime](/docs/telemetry/open-telemetry).
