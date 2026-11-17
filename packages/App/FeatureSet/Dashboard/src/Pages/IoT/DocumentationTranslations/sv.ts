import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in Swedish (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * Swedish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Swedish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "En enhet med ett OpenTelemetry-SDK som exporterar OTLP över HTTP",
  "Network access from the device to your OneUptime instance":
    "Nätverksåtkomst från enheten till din OneUptime-instans",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "Ersätt `building-a-sensors` och `sensor-001` med din flottas namn och enhetens id. Håll `iot.fleet.name` stabilt: ändrar du det registreras en helt ny flotta.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Välj en intagningsnyckel i steg 1 för att fylla i `<YOUR_API_KEY>`.",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "Skicka dina avläsningar som mätvärden med namn enligt `iot_*`-konventionerna, och ge varje datapunkt ett `device.id`-attribut, till exempel:",
  "| Metric | Value | Datapoint attribute |":
    "| Mätvärde | Värde | Datapunktsattribut |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "Enhetsinventariet är nycklat på datapunktens `device.id`, inte på resursens, så sätt det på varje mätning och dessutom i `OTEL_RESOURCE_ATTRIBUTES`. Alla igenkända namn finns under **Konventioner för mätvärden** i Avancerad.",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. Bekräfta att enheten exporterar utan fel: kontrollera SDK:ns loggar efter exportfel och HTTP-svar `401` eller `422`.",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. Öppna avsnittet **IoT** i OneUptimes instrumentpanel: din flotta bör dyka upp inom en minut eller så.",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Öppna flottans flik **Enheter**: varje `device.id` du skickat bör finnas med i listan med senaste status för batteri, signal, temperatur, CPU, minne och uppe/nere.",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. Öppna **Mätvärden** under flottan för att visa någon av `iot_*`-serierna i ett diagram.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "Det finns ingen agent att installera på enheten. OneUptime knyter dina enheter till två begrepp med hjälp av OpenTelemetry-attribut:",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **Flotta**: en logisk grupp enheter (till exempel `building-a-sensors` eller `field-gateways`). Flottan härleds från resursattributet `iot.fleet.name` och visas i OneUptime som telemetritjänsten `iot/<fleet>`. Sätt `service.name=iot/<fleet>` så att loggar och mätvärden hamnar under samma tjänst.",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **Enhet**: en enskild enhet i en flotta, identifierad med attributet `device.id` på varje datapunkt. OneUptime bygger och underhåller ett enhetsinventarium per flotta, nycklat på `device.id`.",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "Attributen som OneUptime läser; de valfria förfinar hur varje enhet klassificeras och avgränsas i övervakare:",
  "| Attribute | Set on | Required | Description |":
    "| Attribut | Sätts på | Obligatorisk | Beskrivning |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | Resurs | Ja | Flottan som enheten tillhör. Blir OneUptime-tjänsten `iot/<fleet>` |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | Varje datapunkt | Ja | Stabilt, unikt id för enheten i flottan |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | Varje datapunkt | Nej | Enhetsklassen, till exempel `Device`, `Sensor` eller `Gateway`. Standard är `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Varje datapunkt | Nej | En finare enhetstyp eller -modell för filtrering av övervakare (till exempel `temp-sensor`) |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | Varje datapunkt | Nej | Firmwareversionen som enheten rapporterar |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime känner igen följande `iot_*`-mätvärdesnamn. Varje datapunkt bör ha etiketten `device.id` så att avläsningen tillskrivs rätt enhet. Du behöver bara skicka de mätvärden som är meningsfulla för din enhet: de som saknas visas helt enkelt inte.",
  "| Metric Name | Meaning |": "| Mätvärdesnamn | Betydelse |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | Enhetens tillgänglighet. `1` = uppe/nåbar, `0` = nere. Styr IoT-enhetsövervakaren |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | Signal med enbart identitet. Bär `device.id` / klass / typ / firmware så att en enhet visas i inventariet redan innan den rapporterar avläsningar |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | Batteriets laddningsnivå, `0`–`100` (%) |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | Trådlös signalstyrka i dBm (till exempel RSSI för Wi-Fi, LoRa eller mobilnät) |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | Enhetens eller sensorns temperatur i °C |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | CPU-användning som kvot `0`–`1` (enhetsinventariet visar den i procent) |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | Minne som används just nu, i byte |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | Totalt tillgängligt minne på enheten, i byte |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | Sekunder sedan enheten senast startade |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. Kontrollera att `iot.fleet.name` är satt som **resurs**-attribut (inte som datapunktsetikett) och att `service.name` är `iot/<fleet>`.",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. Bekräfta att exportörens slutpunkt är `<YOUR_ONEUPTIME_URL>/otlp` och att huvudet `x-oneuptime-token` innehåller en giltig intagningsnyckel.",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. Se till att varje datapunkt har etiketten `device.id`: enheterna är nycklade på den.",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. Skicka `iot_device_info` (enbart identitet) för enheter som ännu inte har rapporterat avläsningar, så att de ändå visas i inventariet.",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. Kontrollera att värdena för `device.id` är stabila mellan rapporterna; ett id som ändras skapar dubbla enhetsrader.",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401` betyder att intagningsnyckeln saknas, är fel eller har gått ut; `422` betyder att den har inaktiverats eller är en webbläsarnyckel, som inte kan skicka enhetstelemetri. Välj en annan nyckel ovan (eller skapa en ny) och uppdatera huvudet `x-oneuptime-token` som din enhet eller insamlare skickar.",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. Använd exakt de `iot_*`-mätvärdesnamn som står i **Konventioner för mätvärden** under Avancerad: andra namn lagras som allmänna mätvärden och fyller inte IoT-diagrammen.",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` är en kvot på `0`–`1`; skicka den råa kvoten så visar OneUptime den i procent.",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. Räkna med upp till en minut innan de första datapunkterna dyker upp efter att en enhet börjat rapportera.",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "Det här skickar avläsningarna till flottan **`fleet-1`**. Ersätt `sensor-001` med enhetens id och låt `iot.fleet.name` stå exakt som det är: ett annat namn registrerar en ny flotta.",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "En gateway som kan köra OpenTelemetry Collector (med Docker eller med binärfilen `otelcol-contrib`)",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "Enheter som skickar OTLP till gatewayen, och nätverksåtkomst från gatewayen till din OneUptime-instans",
  "Save this as `config.yaml` on the gateway:":
    "Spara det här som `config.yaml` på gatewayen:",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- Sätt `iot.fleet.name` (och motsvarande `service.name=iot/<fleet>`) per gateway så att varje gateways enheter hamnar i rätt flotta.",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- Behåll `device.id` (och eventuellt `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) på varje datapunkt så att OneUptime kan hitta den enskilda enheten i flottan.",
  "Run it from the directory that holds `config.yaml`:":
    "Kör den från katalogen som innehåller `config.yaml`:",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "Enheterna skickar sedan OTLP till gatewayen (gRPC på port `4317`, HTTP på port `4318`), till exempel med `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` i varje enhets SDK.",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "Har du redan `otelcol-contrib` på gatewayen? Peka den mot filen:",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. Bekräfta att gatewayens insamlare exporterar utan fel: kontrollera dess loggar efter exportfel och HTTP-svar `401` eller `422` (`docker logs -f otel-collector` när den körs i Docker).",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** tar emot från dina enheter över gRPC (`4317`) och HTTP (`4318`). Ta emot avläsningar på vilket annat sätt som helst som insamlaren stöder (en MQTT-brygga, filloggar, …) och skicka dem genom samma pipeline.",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** förser varje post med flottans attribut. Sätt `iot.fleet.name` (och motsvarande `service.name=iot/<fleet>`) per gateway så att varje gateways enheter hamnar i rätt flotta.",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** samlar poster före export så att gatewayen inte betalar en HTTP-tur och retur per avläsning.",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** skickar till OneUptime över HTTPS med ingestion-token bifogad. Både standardkodningen protobuf och `encoding: json` godtas.",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- Varje avläsning som den här gatewayen vidarebefordrar går till flottan **`fleet-1`**: låt `iot.fleet.name` och `service.name` stå exakt som de är, annars registrerar avläsningarna en ny flotta. En gateway för en annan flotta sätter sina egna.",
  "Any MQTT client that can connect over WebSocket":
    "Vilken MQTT-klient som helst som kan ansluta över WebSocket",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "Till exempel med Node.js-klienten `mqtt` (`npm install mqtt`):",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Ersätt `building-a-sensors` och `sensor-001` med din flottas namn och enhetens id: OneUptime skapar flottan och enheten utifrån topicet. Last Will rapporterar enheten som offline i samma ögonblick som anslutningen bryts; enheter som ansluter direkt klarar sig bättre med egna inloggningsuppgifter (båda under Avancerad).",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. Bekräfta att klienten ansluter och publicerar utan fel: en anslutning som nekas med returkod 4 (fel användarnamn eller lösenord) betyder att nyckeln är fel.",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Öppna flottans flik **Enheter**: varje enhet du publicerat för bör finnas med i listan med senaste status för batteri, signal, temperatur, CPU, minne och uppe/nere.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "Det finns ingen agent att installera på enheten. OneUptime knyter dina enheter till två begrepp, och med MQTT bestämmer topicet båda:",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **Flotta**: `<fleet>` i `oneuptime/<fleet>/…`, en logisk grupp enheter (till exempel `building-a-sensors`). Den blir avläsningarnas `iot.fleet.name` och visas i OneUptime som telemetritjänsten `iot/<fleet>`.",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **Enhet**: `<device>` i `oneuptime/<fleet>/<device>/…`, en enskild enhet i flottan. Den blir `device.id` för varje avläsning, och OneUptime bygger och underhåller ett enhetsinventarium per flotta, nycklat på den.",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    'Valfria attribut förfinar hur varje enhet klassificeras och avgränsas i övervakare. Lägg dem i tabellen `"attributes"` i en telemetripublicering: de sätts på varje datapunkt i den publiceringen:',
  "| Attribute | Description |": "| Attribut | Beskrivning |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | Enhetsklassen, till exempel `Device`, `Sensor` eller `Gateway`. Standard är `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | En finare enhetstyp eller -modell för filtrering av övervakare (till exempel `temp-sensor`) |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | Firmwareversionen som enheten rapporterar |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime känner igen följande `iot_*`-mätvärdesnamn. Över MQTT namnger topicet enheten, så varje avläsning tillskrivs den. Du behöver bara skicka de mätvärden som är meningsfulla för din enhet: de som saknas visas helt enkelt inte.",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "Den projektövergripande intagningsnyckeln passar gatewayer som publicerar för många enheters räkning. Registrera enheter som ansluter direkt var för sig under flottans flik **Enhetsregister**: den utfärdar inloggningsuppgifter per enhet; uppgifternas ID är MQTT-**användarnamnet** och hemligheten är **lösenordet**. Flottan visas med sin första avläsning, så skicka först en med den projektövergripande nyckeln, som i steg 2.",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **Topic-isolering**: en enhets inloggningsuppgifter kan bara publicera under dess egna topics `oneuptime/<fleet>/<device>/…`; allt annat kastas.",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **Individuell återkallelse**: inaktivera eller ta bort en enhets inloggningsuppgifter utan att röra resten av flottan; en ansluten enhet kopplas bort inom några sekunder.",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **Offlinedetektering vid tyst haveri**: en registrerad enhet ligger kvar i inventariet som offline när den slutar rapportera, i stället för att försvinna, även om den dör utan Last Will.",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "Registrera en MQTT-**Last Will** på `oneuptime/<fleet>/<device>/status` med nyttolasten `offline`: om enheten dör publicerar OneUptime `iot_device_up = 0` för dess räkning i samma ögonblick som sessionen bryts, vilket utlöser den medföljande larmmallen Device Offline utan avfrågning. Publicera `online` på samma topic efter anslutningen så att enheten visas som uppe igen; exemplet i steg 2 gör båda. Varje avläsning som enheten publicerar räknas också som uppe, så en enhet som fortsätter skicka avläsningar förblir uppe utan att publicera sin status igen. Statustopicet godtar också `1`/`0`, `true`/`false` och `up`/`down`.",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "Håll MQTT-keepalive **under 5 minuter** på WebSocket-slutpunkten (klientbibliotekens standard på 60 s fungerar): inaktiva WebSocket-anslutningar stängs efter 300 sekunder, vilket skulle utlösa Last Will och en falsk offlineavisering.",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "Publicera under det fasta prefixet `oneuptime/`. Flott- och enhetssegmenten får inte innehålla `/`, `+` eller `#` eller börja med `$`, och de är begränsade till 100 tecken.",
  "| Topic | Payload |": "| MQTT-topic | Nyttolast |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | Ett JSON-objekt med avläsningar, `{"metrics":{"iot_temperature_celsius":21.5}}`, eller ett platt objekt vars numeriska fält är mätvärdena |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | Ett enda värde: ett rent tal (`23.4`) eller `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` eller `offline`, omsatt till `iot_device_up` |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    'Telemetrinyttolaster kan också innehålla `"attributes"` (en tabell med strängar som sätts på varje datapunkt; använd den för `iot.device.kind`, `iot.device.type`, `iot.device.firmware` eller egna etiketter) och `"timestamp"` (ISO-8601 eller Unix-sekunder/-millisekunder). Båda är valfria; saknas `timestamp` används mottagningstiden.',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "Slutpunkten är bara till för mottagning: prenumerationer nekas. En publicering är begränsad till 128 KB och 100 mätvärden. Publiceringar utanför det här kontraktet eller med felaktiga nyttolaster godtas och kastas (MQTT 3.1.1 har inget felsvar per meddelande), och OneUptime loggar en varning med orsaken.",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "Egenhostade installationer kan dessutom öppna för rå MQTT över TCP (`MQTT_INGEST_PORT`, standard `1883`). Lyssnaren är som standard intern i klustrets eller Compose-nätverket: öppna för den om dina enheter inte kan prata WebSocket. Taket för WebSocket-keepalive gäller inte där.",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "Sätt `MQTT_INGEST_ENABLED=false` på apptjänsten för att stänga av MQTT-lyssnarna.",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. Bekräfta att topicet följer `oneuptime/<fleet>/<device>/…` exakt: det är topicets flottsegment som skapar flottan.",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. Publiceringar utanför topic-kontraktet eller med felaktiga nyttolaster godtas och kastas (MQTT 3.1.1 har inget felsvar per meddelande). Jämför dina med **MQTT-topics och -nyttolaster** under Avancerad; på en egenhostad instans anger appens loggar orsaken (`MQTT: dropped publish to …`).",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "OneUptime avvisar felaktiga inloggningsuppgifter vid CONNECT med returkod 4. Kontrollera att:",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- lösenordet är en giltig intagningsnyckel eller, för en registrerad enhet, uppgifternas hemlighet med uppgifternas ID som användarnamn;",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- nyckeln är en servernyckel (webbläsarnycklar nekas över MQTT) och varken har inaktiverats eller gått ut.",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. Enhetens id är topicets segment `<device>`: håll det stabilt mellan publiceringar; ett id som ändras skapar dubbla enhetsrader.",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. Publicera `iot_device_info` (enbart identitet) eller ett `status`-meddelande för enheter som ännu inte har rapporterat avläsningar, så att de ändå visas i inventariet.",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "På WebSocket-slutpunkten stängs inaktiva anslutningar efter 300 sekunder, vilket utlöser Last Will och en falsk Device Offline-larm. Håll MQTT-keepalive under 5 minuter; klientbibliotekens standard på 60 s fungerar.",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Ersätt `sensor-001` med enhetens id: OneUptime lägger till enheten i flottan **`fleet-1`** utifrån topicet. Last Will rapporterar enheten som offline i samma ögonblick som anslutningen bryts; enheter som ansluter direkt klarar sig bättre med egna inloggningsuppgifter (båda under Avancerad).",
};

export default TRANSLATION;
