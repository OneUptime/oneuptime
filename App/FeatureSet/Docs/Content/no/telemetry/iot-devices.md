# OneUptime IoT-enheter

## Oversikt

OneUptime overvåker flåter av IoT-enheter — sensorer, gatewayer, kontrollere og edge-bokser — ved å ta imot standard OpenTelemetry (OTLP)-metrikker. Hver enhet (eller en gateway på dens vegne) sender et lite sett med `iot_*`-metrikker over OTLP HTTP, merket med hvilken **flåte** den tilhører og sin egen **enhets-id**. OneUptime grupperer disse metrikkene i en flåte, bygger en live enhetsoversikt og sporer per enhet batteri, tilkobling, temperatur, CPU, minne og tilgjengelighet.

Det finnes ingen agent å installere på enhetssiden — alt som kan snakke OTLP (en OpenTelemetry-SDK på enheten, eller en OpenTelemetry Collector som kjører på en gateway og fordeler til mange enheter) fungerer. Denne siden er **veiledningen for ingestion**. For å konfigurere IoT-monitorer og varsler oppå dataene du sender, se [IoT-enhetsmonitor](/docs/monitor/iot-device-monitor).

## Forutsetninger

- En enhet, gateway eller collector som kan sende OTLP/HTTP til OneUptime
- Nettverkstilgang fra enheten/gatewayen til din OneUptime-instans
- En **OneUptime Telemetry Ingestion Token** — opprett en fra _Project Settings → Telemetry Ingestion Keys_ og kopier `x-oneuptime-token`-verdien

## Hvordan OneUptime modellerer IoT

OneUptime kartlegger enhetene dine til to konsepter ved hjelp av OpenTelemetry-ressursattributter:

- **Flåte** — en logisk gruppe av enheter (for eksempel `building-a-sensors` eller `field-gateways`). Flåten utledes fra ressursattributtet `iot.fleet.name` og vises i OneUptime som telemetritjenesten `iot/<fleet>`. Sett `service.name=iot/<fleet>` slik at logger og metrikker stiller opp under samme tjeneste.
- **Enhet** — en individuell enhet innenfor en flåte, identifisert av attributtet `device.id`. OneUptime bygger og vedlikeholder en enhetsoversikt per flåte med `device.id` som nøkkel.

Valgfrie attributter forfiner hvordan hver enhet klassifiseres og avgrenses i monitorer:

| Attributt            | Påkrevd | Beskrivelse                                                                      |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `iot.fleet.name`     | Ja      | Flåten denne enheten tilhører. Blir OneUptime-tjenesten `iot/<fleet>`    |
| `device.id`          | Ja      | Stabil, unik id for enheten innenfor flåten                                |
| `iot.device.kind`    | Nei       | Enhetsklassen — for eksempel `Device`, `Sensor` eller `Gateway`. Standard er `Device` |
| `iot.device.type`    | Nei       | En finere enhetstype/modell brukt for å filtrere monitorer (for eksempel `temp-sensor`) |
| `iot.device.firmware`| Nei       | Fastvareversjon rapportert av enheten                                          |

## Sende metrikker via OpenTelemetry-SDK-en

Hvis enheten din kjører en OpenTelemetry-SDK direkte, pek den mot OneUptime og stempel inn IoT-ressursattributtene via standard `OTEL_*`-miljøvariabler. Bytt ut token, endepunkt, flåtenavn og enhets-id med verdier for ditt miljø.

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
```

| Miljøvariabel          | Påkrevd | Beskrivelse                                                                                          |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Ja      | OneUptime OTLP-endepunkt (`https://oneuptime.com/otlp`, eller `http(s)://YOUR-ONEUPTIME-HOST/otlp` selvhostet) |
| `OTEL_EXPORTER_OTLP_HEADERS`  | Ja      | `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`                                                    |
| `OTEL_RESOURCE_ATTRIBUTES`    | Ja      | Kommaseparerte ressursattributter. Må inkludere `iot.fleet.name`, `device.id` og `service.name=iot/<fleet>` |

Send avlesningene dine som metrikker med `iot_*`-navnene nedenfor (se [Metrikkonvensjoner](#metric-conventions)). I løpet av et minutt eller så dukker enheten opp under **IoT**-seksjonen i OneUptime-dashbordet.

## Sende metrikker via en OpenTelemetry Collector

Når mange enheter rapporterer gjennom en gateway, kjør en OpenTelemetry Collector på gatewayen og eksporter til OneUptime. `resource`-prosessoren stempler inn flåteattributtene; motta avlesninger fra enhetene dine (OTLP, MQTT-bro, fil-logger osv.) og videresend dem:

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
    # OneUptime krever JSON-koderen i stedet for standard Proto(buf)
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

- **`resource`** stempler hver post med flåteattributtene. Sett `iot.fleet.name` (og det matchende `service.name=iot/<fleet>`) per gateway slik at hver gateways enheter havner i riktig flåte.
- Behold `device.id` (og eventuelt `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) på hvert datapunkt slik at OneUptime kan finne den individuelle enheten inne i flåten.
- **`otlphttp`** sender til OneUptime over HTTPS med ingestion-token vedlagt. Merk at `encoding: json` og headeren `Content-Type: application/json` er påkrevd.

## Metrikkonvensjoner

OneUptime gjenkjenner følgende `iot_*`-metrikknavn. Hvert datapunkt bør bære `device.id`-etiketten slik at avlesningen tilskrives riktig enhet. Du trenger bare å sende de metrikkene som gir mening for enheten din — de som mangler blir rett og slett ikke tegnet i diagrammer.

| Metrikknavn                 | Betydning                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `iot_device_up`             | Enhetstilgjengelighet. `1` = oppe/tilgjengelig, `0` = nede. Driver IoT-enhetsmonitoren |
| `iot_device_info`           | Identitetssignal alene. Bærer `device.id` / kind / type / firmware slik at en enhet vises i oversikten selv før den rapporterer avlesninger |
| `iot_battery_percent`       | Batteriladenivå, `0`–`100` (%)                                            |
| `iot_signal_strength_dbm`   | Trådløs signalstyrke i dBm (for eksempel Wi-Fi / LoRa / mobil-RSSI)      |
| `iot_temperature_celsius`   | Enhets- eller sensortemperatur i °C                                             |
| `iot_cpu_usage_ratio`       | CPU-bruk som et forholdstall `0`–`1` (OneUptime lagrer det som en prosentandel)        |
| `iot_memory_usage_bytes`    | Minne som er i bruk nå, i bytes                                                |
| `iot_memory_size_bytes`     | Totalt tilgjengelig minne på enheten, i bytes                                 |
| `iot_uptime_seconds`        | Sekunder siden enheten sist startet opp                                           |

## Verifiser installasjonen

1. Bekreft at enheten eller gatewayen din eksporterer uten feil (sjekk SDK-/collector-loggene for eksporteringsfeil og HTTP `401`/`403`-svar).
2. I OneUptime-dashbordet, åpne **IoT**-seksjonen — flåten din skal dukke opp som `iot/<fleet>` innen et minutt eller så.
3. Åpne flåtens **Devices**-fane — hver `device.id` du sendte skal være oppført med sitt nyeste batteri, signal, temperatur, CPU, minne og oppe/nede-status.
4. Åpne **Metrics** under flåten for å tegne diagram over hvilken som helst av `iot_*`-seriene ovenfor.

## Feilsøking

### Flåten dukker ikke opp

1. Verifiser at `iot.fleet.name` er satt som et **ressurs**-attributt (ikke en datapunkt-etikett), og at `service.name` er `iot/<fleet>`.
2. Bekreft at eksportør-endepunktet er `https://oneuptime.com/otlp` (eller din selvhostede `…/otlp`) og at `x-oneuptime-token`-headeren bærer en gyldig token.
3. Hvis du bruker en collector, påse at `encoding: json` og `Content-Type: application/json` er satt på `otlphttp`-eksportøren.

### Enheter mangler fra oversikten

1. Sørg for at hvert datapunkt bærer en `device.id`-etikett — enheter har den som nøkkel.
2. Send `iot_device_info` (kun identitet) for enheter som ennå ikke har rapportert avlesninger, slik at de likevel vises i oversikten.
3. Sjekk at `device.id`-verdiene er stabile på tvers av rapporter; en id som endrer seg lager dupliserte enhetsrader.

### HTTP 401 / 403 fra eksportøren

Ingestion-token er ugyldig, tilbakekalt eller mangler. Generer en ny fra _Project Settings → Telemetry Ingestion Keys_ og oppdater `x-oneuptime-token`-headeren.

### Metrikker tegnes ikke i diagrammer

1. Bekreft at du bruker de nøyaktige `iot_*`-metrikknavnene fra tabellen [Metrikkonvensjoner](#metric-conventions) — ukjente navn lagres som generiske metrikker og fyller ikke IoT-diagrammene.
2. Husk at `iot_cpu_usage_ratio` er et `0`–`1`-forholdstall; send det rå forholdstallet, så gjengir OneUptime det som en prosentandel.
3. Gi det opptil et minutt før de første datapunktene viser seg etter at en enhet begynner å rapportere.

## Selvhostet OneUptime

Hvis du selvhoster OneUptime, pek endepunktet mot din egen instans:

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

Hvis instansen din kun er HTTP, endre skjemaet til `http://` og bruk riktig port.

## Neste steg

- Konfigurer en **IoT-enhetsmonitor** for å varsle ved enhet frakoblet, lavt batteri, svakt signal, høy temperatur og høy CPU — se [IoT-enhetsmonitor](/docs/monitor/iot-device-monitor).
- For ikke-containeriserte verter (Linux / macOS / Windows-VM-er og fysisk maskinvare), bruk [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
- For å lære den underliggende OTLP-integrasjonen i dybden, se [Integrer OpenTelemetry med OneUptime](/docs/telemetry/open-telemetry).
