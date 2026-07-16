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

Send avlesningene dine som metrikker med `iot_*`-navnene nedenfor (se [Metrikkonvensjoner](#metrikkonvensjoner)). I løpet av et minutt eller så dukker enheten opp under **IoT**-seksjonen i OneUptime-dashbordet.

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

## Sende metrikker via MQTT

OneUptime leveres med et innebygd MQTT-endepunkt, slik at enheter som allerede snakker MQTT kan sende avlesninger direkte — ingen OpenTelemetry-SDK, collector eller bro er nødvendig. Alt som publiseres over MQTT havner i den samme pipelinen som OTLP: flåter opprettes automatisk, enhetsoversikten oppdateres, og hver IoT-monitor og varselmal fungerer uendret.

**Endepunkter**

| Transport             | Adresse                                | Merknader                                                                                     |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| MQTT over WebSocket   | `wss://<your-host>/mqtt`               | Fungerer på alle installasjoner — går over den vanlige HTTPS-porten gjennom OneUptime-ingressen |
| MQTT over TCP         | `<app-host>:1883` (`MQTT_INGEST_PORT`) | Selvhostet: intern i cluster-/compose-nettverket som standard; eksponer den hvis du trenger det |

**Autentisering** — to alternativer:

- **Prosjektomfattende**: send din **Telemetry Ingestion Token** som MQTT-passordet (brukernavnet ignoreres; hvis klienten din kun har et brukernavnfelt, legg tokenet der i stedet). Riktig for gatewayer som publiserer på vegne av mange enheter.
- **Per enhet** (anbefalt for enheter som kobler til direkte): registrer enheten under flåtens **Device Registry**-fane i dashbordet. Registreringen utsteder en legitimasjon per enhet — legitimasjons-ID-en er MQTT-**brukernavnet** og hemmeligheten er **passordet**. Enhetsautentiserte klienter kan kun publisere under sine egne `oneuptime/<fleet>/<device>/…`-topics, en enkelt kompromittert enhet kan tilbakekalles fra dashbordet uten å røre resten av flåten (tilbakekalling trer i kraft innen omtrent et minutt, også for tilkoblede sesjoner), og registrerte enheter får **frakoblingsdeteksjon ved stille død**: de blir stående i oversikten som Frakoblet i stedet for å forsvinne når de slutter å rapportere, og **Device Offline**-varselmalen utløses for dem selv om de dør uten en Last Will.

Ugyldig legitimasjon avvises ved CONNECT med returkode 4 (feil brukernavn eller passord), slik at en feilkonfigurert enhet feiler høylytt.

**Topics** — publiser under det faste `oneuptime/`-prefikset. Flåte- og enhetssegmentene kan ikke inneholde `/`, `+` eller `#`, og er begrenset til 100 tegn:

| Topic                                            | Payload                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `oneuptime/<fleet>/<device>/telemetry`           | JSON-objekt med avlesninger — `{ "metrics": { "iot_temperature_celsius": 21.5 } }`, eller et flatt objekt der de numeriske feltene er metrikkene |
| `oneuptime/<fleet>/<device>/metrics/<metricName>`| En enkelt verdi — et rent tall (`23.4`) eller `{ "value": 23.4 }`                                     |
| `oneuptime/<fleet>/<device>/status`              | `"online"` eller `"offline"` (også `1`/`0`, `true`/`false`, `up`/`down`) — mapper til `iot_device_up`  |

Telemetri-payloads kan også bære `"attributes"` (et strengkart som stemples på hvert datapunkt — bruk det til `iot.device.kind`, `iot.device.type`, `iot.device.firmware` eller dine egne etiketter) og `"timestamp"` (ISO-8601, eller unix-sekunder/-millisekunder). Begge er valgfrie; tidspunktet for ingestion brukes når `timestamp` mangler.

**Frakoblingsdeteksjon med Last Will** — registrer en MQTT Last Will på `oneuptime/<fleet>/<device>/status` med payloaden `offline`. Hvis enheten dør eller faller av nettverket, publiserer brokeren `iot_device_up = 0` på dens vegne i det øyeblikket sesjonen avsluttes — noe som utløser standardvarselmalen **Device Offline** og vipper enheten til Nede i oversikten, uten polling og uten å vente på en tapt scrape. Publiser `online` til det samme topicet etter tilkobling slik at enheten vises som Oppe igjen.

Eksempel med `mosquitto_pub` (rå TCP, selvhostet):

```bash
mosquitto_pub -h YOUR-ONEUPTIME-APP-HOST -p 1883 \
  -u oneuptime -P "YOUR_TELEMETRY_INGESTION_TOKEN" \
  -t "oneuptime/building-a-sensors/sensor-001/telemetry" \
  -m '{"metrics":{"iot_device_up":1,"iot_battery_percent":87,"iot_temperature_celsius":21.5},"attributes":{"iot.device.type":"temp-sensor","iot.device.firmware":"1.4.2"}}'
```

Eksempel med Node.js `mqtt` over WebSocket (fungerer mot oneuptime.com og enhver selvhostet instans):

```javascript
const mqtt = require("mqtt");

const client = mqtt.connect("wss://oneuptime.com/mqtt", {
  username: "oneuptime", // ignoreres — det er tokenet nedenfor som autentiserer
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

Merknader:

- Endepunktet er **kun for ingestion**: abonnementer avvises (SUBACK-feil). Bruk QoS 1 hvis du vil at brokeren skal bekrefte mottak. Ingestion er **minst-én-gang** — en QoS 1/2-retransmisjon etter en tapt bekreftelse kan produsere dupliserte datapunkter.
- Publiseringer utenfor topic-kontrakten eller med feilformede payloads aksepteres og **forkastes** (MQTT 3.1.1 har ingen feilrespons per melding) — serveren logger en advarsel med årsaken, så sjekk OneUptime-applikasjonsloggene hvis data ikke kommer frem.
- På WebSocket-endepunktet må du holde MQTT-keepalive **under 5 minutter** — OneUptime-ingressen lukker inaktive WebSocket-tilkoblinger etter 300 sekunder, noe som ville utløst din Last Will og et falskt Device Offline-varsel. Standardverdiene i klientbibliotekene (60 s for `mqtt` og `paho-mqtt`) er greie. Det rå TCP-endepunktet har ingen slik grense.
- Payloads er begrenset til 128 KB og 100 metrikker per publisering; for store pakker fører til at forbindelsen brytes.

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

1. Bekreft at du bruker de nøyaktige `iot_*`-metrikknavnene fra tabellen [Metrikkonvensjoner](#metrikkonvensjoner) — ukjente navn lagres som generiske metrikker og fyller ikke IoT-diagrammene.
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
