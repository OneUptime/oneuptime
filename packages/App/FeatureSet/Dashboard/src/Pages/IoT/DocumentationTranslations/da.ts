import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in Danish (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * Danish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Danish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "En enhed med et OpenTelemetry-SDK, der eksporterer OTLP over HTTP",
  "Network access from the device to your OneUptime instance":
    "Netværksadgang fra enheden til din OneUptime-instans",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "Erstat `building-a-sensors` og `sensor-001` med navnet på din flåde og enhedens id. Hold `iot.fleet.name` stabil: ændrer du det, registreres en helt ny flåde.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Vælg en ingestion-nøgle i trin 1 for at udfylde `<YOUR_API_KEY>`.",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "Send dine målinger som metrikker med navne efter `iot_*`-konventionerne, og giv hvert datapunkt en `device.id`-attribut, for eksempel:",
  "| Metric | Value | Datapoint attribute |":
    "| Metrik | Værdi | Datapunktattribut |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "Enhedsinventaret er nøglet på datapunktets `device.id`, ikke på ressourcens, så sæt det på hver måling og desuden i `OTEL_RESOURCE_ATTRIBUTES`. Alle genkendte navne står under **Metrikkonventioner** i Avanceret.",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. Bekræft, at enheden eksporterer uden fejl: tjek SDK'ets protokoller for eksportfejl og HTTP-svar `401` eller `422`.",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. Åbn afsnittet **IoT** i OneUptime-dashboardet: din flåde burde dukke op inden for et minuts tid.",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Åbn flådens fane **Enheder**: hvert `device.id`, du har sendt, burde stå på listen med seneste status for batteri, signal, temperatur, CPU, hukommelse og oppe/nede.",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. Åbn **Metrikker** under flåden for at vise en af `iot_*`-serierne i et diagram.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "Der er ingen agent at installere på enheden. OneUptime knytter dine enheder til to begreber ved hjælp af OpenTelemetry-attributter:",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **Flåde**: en logisk gruppe enheder (for eksempel `building-a-sensors` eller `field-gateways`). Flåden udledes af ressourceattributten `iot.fleet.name` og vises i OneUptime som telemetritjenesten `iot/<fleet>`. Sæt `service.name=iot/<fleet>`, så protokoller og metrikker samles under samme tjeneste.",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **Enhed**: en enkelt enhed i en flåde, identificeret ved attributten `device.id` på hvert datapunkt. OneUptime opbygger og vedligeholder et enhedsinventar pr. flåde, nøglet på `device.id`.",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "Attributterne, OneUptime læser; de valgfrie præciserer, hvordan hver enhed klassificeres og afgrænses i monitorer:",
  "| Attribute | Set on | Required | Description |":
    "| Attribut | Sættes på | Påkrævet | Beskrivelse |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | Ressource | Ja | Den flåde, enheden hører til. Bliver til OneUptime-tjenesten `iot/<fleet>` |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | Hvert datapunkt | Ja | Stabilt, entydigt id for enheden i flåden |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | Hvert datapunkt | Nej | Enhedsklassen, for eksempel `Device`, `Sensor` eller `Gateway`. Standard er `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Hvert datapunkt | Nej | En finere enhedstype eller -model til filtrering af monitorer (for eksempel `temp-sensor`) |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | Hvert datapunkt | Nej | Firmwareversion, som enheden rapporterer |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime genkender følgende `iot_*`-metriknavne. Hvert datapunkt bør have labelen `device.id`, så målingen tilskrives den rigtige enhed. Du behøver kun at sende de metrikker, der giver mening for din enhed: manglende vises simpelthen ikke.",
  "| Metric Name | Meaning |": "| Metriknavn | Betydning |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | Enhedens tilgængelighed. `1` = oppe/tilgængelig, `0` = nede. Styrer IoT-enhedsmonitoren |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | Signal kun med identitet. Bærer `device.id` / klasse / type / firmware, så en enhed vises i inventaret, allerede før den rapporterer målinger |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | Batteriets ladeniveau, `0`–`100` (%) |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | Trådløs signalstyrke i dBm (for eksempel Wi-Fi-, LoRa- eller mobil-RSSI) |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | Enhedens eller sensorens temperatur i °C |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | CPU-udnyttelse som forhold `0`–`1` (enhedsinventaret viser den i procent) |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | Hukommelse i brug lige nu, i bytes |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | Samlet tilgængelig hukommelse på enheden, i bytes |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | Sekunder siden enheden sidst startede |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. Bekræft, at `iot.fleet.name` er sat som **ressource**-attribut (ikke som datapunktlabel), og at `service.name` er `iot/<fleet>`.",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. Bekræft, at eksporterens endpoint er `<YOUR_ONEUPTIME_URL>/otlp`, og at headeren `x-oneuptime-token` indeholder en gyldig ingestion-nøgle.",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. Sørg for, at hvert datapunkt har labelen `device.id`: enhederne er nøglet på den.",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. Send `iot_device_info` (kun identitet) for enheder, der endnu ikke har rapporteret målinger, så de alligevel vises i inventaret.",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. Tjek, at værdierne for `device.id` er stabile på tværs af rapporter; et id, der skifter, giver dublerede enhedsrækker.",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401` betyder, at ingestion-nøglen mangler, er forkert eller er udløbet; `422` betyder, at den er deaktiveret eller er en browsernøgle, som ikke kan sende enhedstelemetri. Vælg en anden nøgle ovenfor (eller opret en ny), og opdater headeren `x-oneuptime-token`, som din enhed eller collector sender.",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. Brug de nøjagtige `iot_*`-metriknavne fra **Metrikkonventioner** under Avanceret: andre navne gemmes som generelle metrikker og fylder ikke IoT-diagrammerne.",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` er et forhold på `0`–`1`; send det rå forhold, så viser OneUptime det i procent.",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. Regn med op til et minut, før de første datapunkter dukker op, efter at en enhed er begyndt at rapportere.",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "Dette sender målingerne til flåden **`fleet-1`**. Erstat `sensor-001` med enhedens id, og lad `iot.fleet.name` stå præcis, som det er: et andet navn registrerer en ny flåde.",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "En gateway, der kan køre OpenTelemetry Collector (med Docker eller med binærfilen `otelcol-contrib`)",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "Enheder, der sender OTLP til gatewayen, og netværksadgang fra gatewayen til din OneUptime-instans",
  "Save this as `config.yaml` on the gateway:":
    "Gem dette som `config.yaml` på gatewayen:",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- Sæt `iot.fleet.name` (og det tilsvarende `service.name=iot/<fleet>`) pr. gateway, så hver gateways enheder havner i den rigtige flåde.",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- Bevar `device.id` (og eventuelt `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) på hvert datapunkt, så OneUptime kan finde den enkelte enhed i flåden.",
  "Run it from the directory that holds `config.yaml`:":
    "Kør den fra mappen, der indeholder `config.yaml`:",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "Enhederne sender derefter OTLP til gatewayen (gRPC på port `4317`, HTTP på port `4318`), for eksempel med `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` i hver enheds SDK.",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "Har du allerede `otelcol-contrib` på gatewayen? Peg den på filen:",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. Bekræft, at gatewayens collector eksporterer uden fejl: tjek dens protokoller for eksportfejl og HTTP-svar `401` eller `422` (`docker logs -f otel-collector`, når den kører i Docker).",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** modtager fra dine enheder over gRPC (`4317`) og HTTP (`4318`). Modtag målinger på enhver anden måde, som collectoren understøtter (en MQTT-bro, fillogfiler, …), og send dem gennem den samme pipeline.",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** forsyner hver post med flådens attributter. Sæt `iot.fleet.name` (og det tilsvarende `service.name=iot/<fleet>`) pr. gateway, så hver gateways enheder havner i den rigtige flåde.",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** samler poster før eksport, så gatewayen ikke betaler en HTTP-rundtur pr. måling.",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** sender til OneUptime over HTTPS med ingestion-tokenet vedhæftet. Både standardkodningen protobuf og `encoding: json` accepteres.",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- Hver måling, denne gateway videresender, går til flåden **`fleet-1`**: lad `iot.fleet.name` og `service.name` stå præcis, som de er, ellers registrerer målingerne en ny flåde. En gateway for en anden flåde sætter sine egne.",
  "Any MQTT client that can connect over WebSocket":
    "Enhver MQTT-klient, der kan forbinde over WebSocket",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "For eksempel med Node.js-klienten `mqtt` (`npm install mqtt`):",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Erstat `building-a-sensors` og `sensor-001` med navnet på din flåde og enhedens id: OneUptime opretter flåden og enheden ud fra topicet. Last Will melder enheden offline i det øjeblik, forbindelsen falder; enheder, der forbinder direkte, er bedre tjent med deres egne legitimationsoplysninger (begge dele under Avanceret).",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. Bekræft, at klienten forbinder og udgiver uden fejl: en forbindelse, der afvises med returkode 4 (forkert brugernavn eller adgangskode), betyder, at nøglen er forkert.",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Åbn flådens fane **Enheder**: hver enhed, du har udgivet for, burde stå på listen med seneste status for batteri, signal, temperatur, CPU, hukommelse og oppe/nede.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "Der er ingen agent at installere på enheden. OneUptime knytter dine enheder til to begreber, og med MQTT fastlægger topicet begge:",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **Flåde**: `<fleet>` i `oneuptime/<fleet>/…`, en logisk gruppe enheder (for eksempel `building-a-sensors`). Den bliver målingernes `iot.fleet.name` og vises i OneUptime som telemetritjenesten `iot/<fleet>`.",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **Enhed**: `<device>` i `oneuptime/<fleet>/<device>/…`, en enkelt enhed i flåden. Den bliver `device.id` for hver måling, og OneUptime opbygger og vedligeholder et enhedsinventar pr. flåde, nøglet på den.",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    'Valgfrie attributter præciserer, hvordan hver enhed klassificeres og afgrænses i monitorer. Læg dem i tabellen `"attributes"` i en telemetriudgivelse: de sættes på hvert datapunkt i den udgivelse:',
  "| Attribute | Description |": "| Attribut | Beskrivelse |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | Enhedsklassen, for eksempel `Device`, `Sensor` eller `Gateway`. Standard er `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | En finere enhedstype eller -model til filtrering af monitorer (for eksempel `temp-sensor`) |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | Firmwareversion, som enheden rapporterer |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime genkender følgende `iot_*`-metriknavne. Over MQTT navngiver topicet enheden, så hver måling tilskrives den. Du behøver kun at sende de metrikker, der giver mening for din enhed: manglende vises simpelthen ikke.",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "Den projektdækkende ingestion-nøgle passer til gateways, der udgiver på vegne af mange enheder. Registrér enheder, der forbinder direkte, hver for sig under flådens fane **Enhedsregister**: den udsteder legitimationsoplysninger pr. enhed; legitimationens ID er MQTT-**brugernavnet**, og hemmeligheden er **adgangskoden**. Flåden vises med sin første måling, så send først en med den projektdækkende nøgle, som i trin 2.",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **Topic-isolering**: en enheds legitimationsoplysninger kan kun udgive under dens egne topics `oneuptime/<fleet>/<device>/…`; alt andet kasseres.",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **Individuel tilbagekaldelse**: deaktiver eller slet én enheds legitimationsoplysninger uden at røre resten af flåden; en forbundet enhed afbrydes inden for få sekunder.",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **Offlinedetektering ved stille nedbrud**: en registreret enhed bliver stående i inventaret som offline, når den holder op med at rapportere, i stedet for at forsvinde, også hvis den dør uden Last Will.",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "Registrér en MQTT-**Last Will** på `oneuptime/<fleet>/<device>/status` med payloaden `offline`: dør enheden, udgiver OneUptime `iot_device_up = 0` på dens vegne i det øjeblik, sessionen falder, hvilket udløser den medfølgende advarselsskabelon Device Offline uden polling. Udgiv `online` på samme topic efter tilslutning, så enheden igen vises som oppe; eksemplet i trin 2 gør begge dele. Enhver måling, enheden udgiver, tæller også som oppe, så en enhed, der bliver ved med at sende målinger, forbliver oppe uden at udgive sin status igen. Statustopicet accepterer også `1`/`0`, `true`/`false` og `up`/`down`.",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "Hold MQTT-keepalive **under 5 minutter** på WebSocket-endpointet (klientbibliotekernes standard på 60 s er fin): inaktive WebSocket-forbindelser lukkes efter 300 sekunder, hvilket ville udløse Last Will og en falsk offlineadvarsel.",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "Udgiv under det faste præfiks `oneuptime/`. Flåde- og enhedssegmenterne må ikke indeholde `/`, `+` eller `#` eller begynde med `$`, og de er begrænset til 100 tegn.",
  "| Topic | Payload |": "| MQTT-topic | Payload |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | Et JSON-objekt med målinger, `{"metrics":{"iot_temperature_celsius":21.5}}`, eller et fladt objekt, hvis numeriske felter er metrikkerne |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | En enkelt værdi: et rent tal (`23.4`) eller `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` eller `offline`, omsat til `iot_device_up` |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    'Telemetri-payloads kan også indeholde `"attributes"` (en tabel med strenge, der sættes på hvert datapunkt; brug den til `iot.device.kind`, `iot.device.type`, `iot.device.firmware` eller dine egne labels) og `"timestamp"` (ISO-8601 eller Unix-sekunder/-millisekunder). Begge er valgfrie; mangler `timestamp`, bruges modtagelsestidspunktet.',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "Endpointet er kun til modtagelse: abonnementer afvises. En udgivelse er begrænset til 128 KB og 100 metrikker. Udgivelser uden for denne kontrakt eller med misdannede payloads accepteres og kasseres (MQTT 3.1.1 har intet fejlsvar pr. besked), og OneUptime logger en advarsel med årsagen.",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "Selvhostede installationer kan desuden åbne for rå MQTT over TCP (`MQTT_INGEST_PORT`, standard `1883`). Listeneren er som standard intern i klyngens eller Compose-netværket: åbn for den, hvis dine enheder ikke kan tale WebSocket. WebSocket-loftet for keepalive gælder ikke dér.",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "Sæt `MQTT_INGEST_ENABLED=false` på app-tjenesten for at slå MQTT-listenerne fra.",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. Bekræft, at topicet følger `oneuptime/<fleet>/<device>/…` nøjagtigt: det er topicets flådesegment, der opretter flåden.",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. Udgivelser uden for topic-kontrakten eller med misdannede payloads accepteres og kasseres (MQTT 3.1.1 har intet fejlsvar pr. besked). Sammenlign dine med **MQTT-topics og -payloads** under Avanceret; på en selvhostet instans nævner appens protokoller årsagen (`MQTT: dropped publish to …`).",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "OneUptime afviser forkerte legitimationsoplysninger ved CONNECT med returkode 4. Tjek, at:",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- adgangskoden er en gyldig ingestion-nøgle eller, for en registreret enhed, legitimationens hemmelighed med dens legitimations-ID som brugernavn;",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- nøglen er en servernøgle (browsernøgler afvises over MQTT) og hverken er deaktiveret eller udløbet.",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. Enhedens id er topicets segment `<device>`: hold det stabilt på tværs af udgivelser; et id, der skifter, giver dublerede enhedsrækker.",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. Udgiv `iot_device_info` (kun identitet) eller en `status`-besked for enheder, der endnu ikke har rapporteret målinger, så de alligevel vises i inventaret.",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "På WebSocket-endpointet lukkes inaktive forbindelser efter 300 sekunder, hvilket udløser Last Will og en falsk Device Offline-advarsel. Hold MQTT-keepalive under 5 minutter; klientbibliotekernes standard på 60 s er fin.",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Erstat `sensor-001` med enhedens id: OneUptime føjer enheden til flåden **`fleet-1`** ud fra topicet. Last Will melder enheden offline i det øjeblik, forbindelsen falder; enheder, der forbinder direkte, er bedre tjent med deres egne legitimationsoplysninger (begge dele under Avanceret).",
};

export default TRANSLATION;
