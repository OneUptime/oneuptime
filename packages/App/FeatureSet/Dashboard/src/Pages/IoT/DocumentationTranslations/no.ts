import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in Norwegian (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * Norwegian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Norwegian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "En enhet med et OpenTelemetry-SDK som eksporterer OTLP over HTTP",
  "Network access from the device to your OneUptime instance":
    "Nettverkstilgang fra enheten til OneUptime-instansen din",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "Erstatt `building-a-sensors` og `sensor-001` med navnet på flåten din og enhetens id. Hold `iot.fleet.name` stabil: endrer du den, registreres en helt ny flåte.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Velg en inntaksnøkkel i trinn 1 for å fylle inn `<YOUR_API_KEY>`.",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "Send målingene dine som målinger med navn etter `iot_*`-konvensjonene, og gi hvert datapunkt et `device.id`-attributt, for eksempel:",
  "| Metric | Value | Datapoint attribute |":
    "| Måling | Verdi | Datapunktattributt |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "Enhetsinventaret er nøklet på datapunktets `device.id`, ikke på ressursens, så sett den på hver måling i tillegg til i `OTEL_RESOURCE_ATTRIBUTES`. Alle gjenkjente navn står under **Målingskonvensjoner** i Avansert.",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. Bekreft at enheten eksporterer uten feil: sjekk loggene til SDK-et for eksportfeil og HTTP-svar `401` eller `422`.",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. Åpne delen **IoT** i OneUptime-dashbordet: flåten din bør dukke opp innen et minutt eller så.",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Åpne flåtens fane **Enheter**: hver `device.id` du har sendt, bør stå på listen med siste status for batteri, signal, temperatur, CPU, minne og oppe/nede.",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. Åpne **Målinger** under flåten for å vise en av `iot_*`-seriene i et diagram.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "Det er ingen agent å installere på enheten. OneUptime knytter enhetene dine til to begreper ved hjelp av OpenTelemetry-attributter:",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **Flåte**: en logisk gruppe enheter (for eksempel `building-a-sensors` eller `field-gateways`). Flåten utledes av ressursattributtet `iot.fleet.name` og vises i OneUptime som telemetritjenesten `iot/<fleet>`. Sett `service.name=iot/<fleet>`, så logger og målinger samles under samme tjeneste.",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **Enhet**: en enkelt enhet i en flåte, identifisert med attributtet `device.id` på hvert datapunkt. OneUptime bygger og vedlikeholder et enhetsinventar per flåte, nøklet på `device.id`.",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "Attributtene OneUptime leser; de valgfrie presiserer hvordan hver enhet klassifiseres og avgrenses i monitorer:",
  "| Attribute | Set on | Required | Description |":
    "| Attributt | Settes på | Påkrevd | Beskrivelse |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | Ressurs | Ja | Flåten denne enheten hører til. Blir OneUptime-tjenesten `iot/<fleet>` |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | Hvert datapunkt | Ja | Stabil, unik id for enheten i flåten |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | Hvert datapunkt | Nei | Enhetsklassen, for eksempel `Device`, `Sensor` eller `Gateway`. Standard er `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Hvert datapunkt | Nei | En finere enhetstype eller -modell for filtrering av monitorer (for eksempel `temp-sensor`) |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | Hvert datapunkt | Nei | Fastvareversjonen enheten rapporterer |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime gjenkjenner følgende `iot_*`-målingsnavn. Hvert datapunkt bør ha etiketten `device.id`, så målingen tilskrives riktig enhet. Du trenger bare å sende målingene som gir mening for enheten din: de som mangler, vises rett og slett ikke.",
  "| Metric Name | Meaning |": "| Målingsnavn | Betydning |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | Enhetens tilgjengelighet. `1` = oppe/nåbar, `0` = nede. Styrer IoT-enhetsmonitoren |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | Signal med bare identitet. Bærer `device.id` / klasse / type / fastvare, så en enhet vises i inventaret allerede før den rapporterer målinger |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | Batteriets ladenivå, `0`–`100` (%) |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | Trådløs signalstyrke i dBm (for eksempel Wi-Fi-, LoRa- eller mobil-RSSI) |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | Temperaturen til enheten eller sensoren i °C |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | CPU-bruk som forhold `0`–`1` (enhetsinventaret viser den i prosent) |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | Minne i bruk akkurat nå, i byte |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | Totalt tilgjengelig minne på enheten, i byte |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | Sekunder siden enheten sist startet |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. Bekreft at `iot.fleet.name` er satt som **ressurs**-attributt (ikke som datapunktetikett), og at `service.name` er `iot/<fleet>`.",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. Bekreft at eksportørens endepunkt er `<YOUR_ONEUPTIME_URL>/otlp`, og at headeren `x-oneuptime-token` inneholder en gyldig inntaksnøkkel.",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. Sørg for at hvert datapunkt har etiketten `device.id`: enhetene er nøklet på den.",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. Send `iot_device_info` (bare identitet) for enheter som ennå ikke har rapportert målinger, så de likevel vises i inventaret.",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. Sjekk at verdiene for `device.id` er stabile på tvers av rapporter; en id som skifter, gir dupliserte enhetsrader.",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401` betyr at inntaksnøkkelen mangler, er feil eller er utløpt; `422` betyr at den er deaktivert eller er en nettlesernøkkel, som ikke kan sende enhetstelemetri. Velg en annen nøkkel ovenfor (eller opprett en ny), og oppdater headeren `x-oneuptime-token` som enheten eller innsamleren din sender.",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. Bruk de nøyaktige `iot_*`-målingsnavnene fra **Målingskonvensjoner** under Avansert: andre navn lagres som generelle målinger og fyller ikke IoT-diagrammene.",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` er et forhold på `0`–`1`; send det rå forholdet, så viser OneUptime det i prosent.",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. Regn med opptil ett minutt før de første datapunktene dukker opp etter at en enhet har begynt å rapportere.",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "Dette sender målingene til flåten **`fleet-1`**. Erstatt `sensor-001` med enhetens id, og la `iot.fleet.name` stå nøyaktig som den er: et annet navn registrerer en ny flåte.",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "En gateway som kan kjøre OpenTelemetry Collector (med Docker eller med binærfilen `otelcol-contrib`)",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "Enheter som sender OTLP til gatewayen, og nettverkstilgang fra gatewayen til OneUptime-instansen din",
  "Save this as `config.yaml` on the gateway:":
    "Lagre dette som `config.yaml` på gatewayen:",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- Sett `iot.fleet.name` (og tilsvarende `service.name=iot/<fleet>`) per gateway, så enhetene til hver gateway havner i riktig flåte.",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- Behold `device.id` (og eventuelt `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) på hvert datapunkt, så OneUptime kan finne den enkelte enheten i flåten.",
  "Run it from the directory that holds `config.yaml`:":
    "Kjør den fra mappen som inneholder `config.yaml`:",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "Enhetene sender deretter OTLP til gatewayen (gRPC på port `4317`, HTTP på port `4318`), for eksempel med `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` i SDK-et til hver enhet.",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "Har du allerede `otelcol-contrib` på gatewayen? Pek den på filen:",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. Bekreft at innsamleren på gatewayen eksporterer uten feil: sjekk loggene dens for eksportfeil og HTTP-svar `401` eller `422` (`docker logs -f otel-collector` når den kjører i Docker).",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** mottar fra enhetene dine over gRPC (`4317`) og HTTP (`4318`). Motta målinger på en hvilken som helst annen måte innsamleren støtter (en MQTT-bro, fillogger, …), og send dem gjennom den samme pipelinen.",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** setter flåtens attributter på hver post. Sett `iot.fleet.name` (og tilsvarende `service.name=iot/<fleet>`) per gateway, så enhetene til hver gateway havner i riktig flåte.",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** samler poster før eksport, så gatewayen ikke betaler én HTTP-rundtur per måling.",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** sender til OneUptime over HTTPS med ingestion-tokenet vedlagt. Både standardkodingen protobuf og `encoding: json` godtas.",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- Hver måling denne gatewayen videresender, går til flåten **`fleet-1`**: la `iot.fleet.name` og `service.name` stå nøyaktig som de er, ellers registrerer målingene en ny flåte. En gateway for en annen flåte setter sine egne.",
  "Any MQTT client that can connect over WebSocket":
    "En hvilken som helst MQTT-klient som kan koble til over WebSocket",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "For eksempel med Node.js-klienten `mqtt` (`npm install mqtt`):",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Erstatt `building-a-sensors` og `sensor-001` med navnet på flåten din og enhetens id: OneUptime oppretter flåten og enheten ut fra topicet. Last Will melder enheten offline i det øyeblikket forbindelsen faller; enheter som kobler til direkte, er bedre tjent med egen legitimasjon (begge deler under Avansert).",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. Bekreft at klienten kobler til og publiserer uten feil: en tilkobling som avvises med returkode 4 (feil brukernavn eller passord), betyr at nøkkelen er feil.",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Åpne flåtens fane **Enheter**: hver enhet du har publisert for, bør stå på listen med siste status for batteri, signal, temperatur, CPU, minne og oppe/nede.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "Det er ingen agent å installere på enheten. OneUptime knytter enhetene dine til to begreper, og med MQTT bestemmer topicet begge:",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **Flåte**: `<fleet>` i `oneuptime/<fleet>/…`, en logisk gruppe enheter (for eksempel `building-a-sensors`). Den blir målingenes `iot.fleet.name` og vises i OneUptime som telemetritjenesten `iot/<fleet>`.",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **Enhet**: `<device>` i `oneuptime/<fleet>/<device>/…`, en enkelt enhet i flåten. Den blir `device.id` for hver måling, og OneUptime bygger og vedlikeholder et enhetsinventar per flåte, nøklet på den.",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    'Valgfrie attributter presiserer hvordan hver enhet klassifiseres og avgrenses i monitorer. Legg dem i tabellen `"attributes"` i en telemetripublisering: de settes på hvert datapunkt i den publiseringen:',
  "| Attribute | Description |": "| Attributt | Beskrivelse |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | Enhetsklassen, for eksempel `Device`, `Sensor` eller `Gateway`. Standard er `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | En finere enhetstype eller -modell for filtrering av monitorer (for eksempel `temp-sensor`) |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | Fastvareversjonen enheten rapporterer |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime gjenkjenner følgende `iot_*`-målingsnavn. Over MQTT navngir topicet enheten, så hver måling tilskrives den. Du trenger bare å sende målingene som gir mening for enheten din: de som mangler, vises rett og slett ikke.",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "Den prosjektdekkende inntaksnøkkelen passer for gatewayer som publiserer på vegne av mange enheter. Registrer enheter som kobler til direkte, hver for seg under flåtens fane **Enhetsregister**: den utsteder legitimasjon per enhet; legitimasjonens ID er MQTT-**brukernavnet**, og hemmeligheten er **passordet**. Flåten vises med sin første måling, så send først én med den prosjektdekkende nøkkelen, som i trinn 2.",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **Topic-isolering**: legitimasjonen til en enhet kan bare publisere under dens egne topics `oneuptime/<fleet>/<device>/…`; alt annet forkastes.",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **Individuell tilbakekalling**: deaktiver eller slett legitimasjonen til én enhet uten å røre resten av flåten; en tilkoblet enhet kobles fra i løpet av noen sekunder.",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **Offline-deteksjon ved stille utfall**: en registrert enhet blir stående i inventaret som offline når den slutter å rapportere, i stedet for å forsvinne, også om den dør uten Last Will.",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "Registrer en MQTT-**Last Will** på `oneuptime/<fleet>/<device>/status` med payloaden `offline`: dør enheten, publiserer OneUptime `iot_device_up = 0` på dens vegne i det øyeblikket økten faller, noe som utløser den medfølgende varselmalen Device Offline uten polling. Publiser `online` på samme topic etter tilkobling, så enheten vises som oppe igjen; eksemplet i trinn 2 gjør begge deler. Enhver måling enheten publiserer, teller også som oppe, så en enhet som fortsetter å sende målinger, forblir oppe uten å publisere statusen sin på nytt. Statustopicet godtar også `1`/`0`, `true`/`false` og `up`/`down`.",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "Hold MQTT-keepalive **under 5 minutter** på WebSocket-endepunktet (standardverdien på 60 s i klientbibliotekene er grei): inaktive WebSocket-tilkoblinger lukkes etter 300 sekunder, noe som ville utløst Last Will og et falskt offline-varsel.",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "Publiser under det faste prefikset `oneuptime/`. Flåte- og enhetssegmentene kan ikke inneholde `/`, `+` eller `#` eller begynne med `$`, og de er begrenset til 100 tegn.",
  "| Topic | Payload |": "| MQTT-topic | Payload |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | Et JSON-objekt med målinger, `{"metrics":{"iot_temperature_celsius":21.5}}`, eller et flatt objekt der de numeriske feltene er målingene |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | Én enkelt verdi: et rent tall (`23.4`) eller `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` eller `offline`, omsatt til `iot_device_up` |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    'Telemetri-payloads kan også inneholde `"attributes"` (en tabell med strenger som settes på hvert datapunkt; bruk den til `iot.device.kind`, `iot.device.type`, `iot.device.firmware` eller egne etiketter) og `"timestamp"` (ISO-8601 eller Unix-sekunder/-millisekunder). Begge er valgfrie; mangler `timestamp`, brukes mottakstidspunktet.',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "Endepunktet er bare for mottak: abonnementer avvises. En publisering er begrenset til 128 KB og 100 målinger. Publiseringer utenfor denne kontrakten eller med misdannede payloads godtas og forkastes (MQTT 3.1.1 har ikke noe feilsvar per melding), og OneUptime logger et varsel med årsaken.",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "Selvhostede installasjoner kan i tillegg åpne for rå MQTT over TCP (`MQTT_INGEST_PORT`, standard `1883`). Lytteren er som standard intern i klynge- eller Compose-nettverket: åpne for den hvis enhetene dine ikke kan snakke WebSocket. WebSocket-taket for keepalive gjelder ikke der.",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "Sett `MQTT_INGEST_ENABLED=false` på app-tjenesten for å slå av MQTT-lytterne.",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. Bekreft at topicet følger `oneuptime/<fleet>/<device>/…` nøyaktig: det er topicets flåtesegment som oppretter flåten.",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. Publiseringer utenfor topic-kontrakten eller med misdannede payloads godtas og forkastes (MQTT 3.1.1 har ikke noe feilsvar per melding). Sammenlign dine med **MQTT-topics og -payloads** under Avansert; på en selvhostet instans oppgir appens logger årsaken (`MQTT: dropped publish to …`).",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "OneUptime avviser feil legitimasjon ved CONNECT med returkode 4. Sjekk at:",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- passordet er en gyldig inntaksnøkkel eller, for en registrert enhet, legitimasjonens hemmelighet med legitimasjons-ID-en som brukernavn;",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- nøkkelen er en servernøkkel (nettlesernøkler avvises over MQTT) og verken er deaktivert eller utløpt.",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. Enhetens id er topicets segment `<device>`: hold den stabil på tvers av publiseringer; en id som skifter, gir dupliserte enhetsrader.",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. Publiser `iot_device_info` (bare identitet) eller en `status`-melding for enheter som ennå ikke har rapportert målinger, så de likevel vises i inventaret.",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "På WebSocket-endepunktet lukkes inaktive tilkoblinger etter 300 sekunder, noe som utløser Last Will og et falskt Device Offline-varsel. Hold MQTT-keepalive under 5 minutter; standardverdien på 60 s i klientbibliotekene er grei.",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Erstatt `sensor-001` med enhetens id: OneUptime legger enheten til flåten **`fleet-1`** ut fra topicet. Last Will melder enheten offline i det øyeblikket forbindelsen faller; enheter som kobler til direkte, er bedre tjent med egen legitimasjon (begge deler under Avansert).",
};

export default TRANSLATION;
