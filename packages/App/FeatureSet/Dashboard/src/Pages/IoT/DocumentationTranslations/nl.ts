import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in Dutch (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * Dutch. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Dutch words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "Een apparaat met een OpenTelemetry-SDK dat OTLP via HTTP exporteert",
  "Network access from the device to your OneUptime instance":
    "Netwerktoegang van het apparaat tot je OneUptime-instantie",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "Vervang `building-a-sensors` en `sensor-001` door je vlootnaam en de apparaat-id. Houd `iot.fleet.name` stabiel: wie hem wijzigt, registreert een gloednieuwe vloot.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Kies in stap 1 een inname-sleutel om `<YOUR_API_KEY>` in te vullen.",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "Stuur je metingen als metrieken met namen volgens de `iot_*`-conventies, en geef elk datapunt een `device.id`-attribuut, bijvoorbeeld:",
  "| Metric | Value | Datapoint attribute |":
    "| Metriek | Waarde | Datapuntattribuut |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "De apparaatinventaris is gesleuteld op de `device.id` van het datapunt, niet op die van de resource, dus zet hem bij elke meting en daarnaast in `OTEL_RESOURCE_ATTRIBUTES`. Alle herkende namen staan onder **Metriekconventies** in Geavanceerd.",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. Controleer of het apparaat zonder fouten exporteert: zoek in de logboeken van de SDK naar exportfouten en HTTP-antwoorden `401` of `422`.",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. Open in het OneUptime-dashboard het onderdeel **IoT**: je vloot zou binnen een minuut of zo moeten verschijnen.",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Open het tabblad **Apparaten** van de vloot: elke verstuurde `device.id` zou moeten staan met de laatste status van batterij, signaal, temperatuur, CPU, geheugen en up/down.",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. Open **Metrieken** onder de vloot om een van de `iot_*`-reeksen in een grafiek te zetten.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "Er hoeft geen agent op het apparaat te worden geïnstalleerd. OneUptime deelt je apparaten met OpenTelemetry-attributen in onder twee begrippen:",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **Vloot**: een logische groep apparaten (bijvoorbeeld `building-a-sensors` of `field-gateways`). De vloot wordt afgeleid van het resource-attribuut `iot.fleet.name` en verschijnt in OneUptime als de telemetrieservice `iot/<fleet>`. Zet `service.name=iot/<fleet>` zodat logboeken en metrieken onder dezelfde service vallen.",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **Apparaat**: een afzonderlijk apparaat binnen een vloot, herkend aan het attribuut `device.id` van elk datapunt. OneUptime bouwt en onderhoudt per vloot een apparaatinventaris, gesleuteld op `device.id`.",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "De attributen die OneUptime leest; de optionele verfijnen hoe elk apparaat wordt ingedeeld en in monitors wordt afgebakend:",
  "| Attribute | Set on | Required | Description |":
    "| Attribuut | Gezet op | Verplicht | Beschrijving |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | Resource | Ja | De vloot waartoe dit apparaat behoort. Wordt de OneUptime-service `iot/<fleet>` |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | Elk datapunt | Ja | Stabiele, unieke id van het apparaat binnen de vloot |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | Elk datapunt | Nee | De apparaatklasse, bijvoorbeeld `Device`, `Sensor` of `Gateway`. Standaard `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Elk datapunt | Nee | Een fijner apparaattype of -model om monitors op te filteren (bijvoorbeeld `temp-sensor`) |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | Elk datapunt | Nee | Firmwareversie die het apparaat meldt |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime herkent de volgende `iot_*`-metrieknamen. Elk datapunt moet het label `device.id` dragen, zodat de meting aan het juiste apparaat wordt toegeschreven. Je hoeft alleen de metrieken te sturen die zinvol zijn voor je apparaat: ontbrekende worden gewoon niet getoond.",
  "| Metric Name | Meaning |": "| Metrieknaam | Betekenis |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | Beschikbaarheid van het apparaat. `1` = up/bereikbaar, `0` = down. Stuurt de IoT-apparaatmonitor aan |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | Signaal met alleen de identiteit. Draagt `device.id` / klasse / type / firmware, zodat een apparaat in de inventaris verschijnt nog voordat het metingen meldt |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | Laadniveau van de batterij, `0`–`100` (%) |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | Draadloze signaalsterkte in dBm (bijvoorbeeld wifi-, LoRa- of mobiele RSSI) |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | Temperatuur van apparaat of sensor in °C |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | CPU-gebruik als verhouding `0`–`1` (de apparaatinventaris toont het als percentage) |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | Geheugen dat nu in gebruik is, in bytes |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | Totaal beschikbaar geheugen op het apparaat, in bytes |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | Seconden sinds het apparaat voor het laatst is opgestart |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. Controleer of `iot.fleet.name` als **resource**-attribuut is gezet (niet als datapuntlabel) en of `service.name` gelijk is aan `iot/<fleet>`.",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. Controleer of het exporter-endpoint `<YOUR_ONEUPTIME_URL>/otlp` is en of de header `x-oneuptime-token` een geldige inname-sleutel bevat.",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. Zorg dat elk datapunt een label `device.id` draagt: apparaten worden daarop gesleuteld.",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. Stuur `iot_device_info` (alleen identiteit) voor apparaten die nog geen metingen hebben gemeld, zodat ze toch in de inventaris verschijnen.",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. Controleer of de waarden van `device.id` stabiel blijven tussen meldingen; een wisselende id maakt dubbele apparaatrijen aan.",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401` betekent dat de inname-sleutel ontbreekt, onjuist of verlopen is; `422` betekent dat hij is uitgeschakeld of een browsersleutel is, die geen apparaattelemetrie kan sturen. Kies hierboven een andere sleutel (of maak een nieuwe) en werk de header `x-oneuptime-token` bij die je apparaat of collector stuurt.",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. Gebruik de exacte `iot_*`-metrieknamen uit **Metriekconventies** onder Geavanceerd: andere namen worden als algemene metrieken opgeslagen en vullen de IoT-grafieken niet.",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` is een verhouding van `0`–`1`; stuur de ruwe verhouding en OneUptime toont hem als percentage.",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. Reken op maximaal een minuut voordat de eerste datapunten verschijnen nadat een apparaat begint te melden.",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "Hiermee gaan de metingen naar de vloot **`fleet-1`**. Vervang `sensor-001` door de id van het apparaat en laat `iot.fleet.name` precies zoals hij is: een andere naam registreert een nieuwe vloot.",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "Een gateway die de OpenTelemetry Collector kan draaien (met Docker of met het binaire bestand `otelcol-contrib`)",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "Apparaten die OTLP naar de gateway sturen, en netwerktoegang van de gateway tot je OneUptime-instantie",
  "Save this as `config.yaml` on the gateway:":
    "Sla dit op als `config.yaml` op de gateway:",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- Zet `iot.fleet.name` (en de bijbehorende `service.name=iot/<fleet>`) per gateway, zodat de apparaten van elke gateway in de juiste vloot terechtkomen.",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- Houd `device.id` (en optioneel `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) op elk datapunt, zodat OneUptime het afzonderlijke apparaat binnen de vloot kan herleiden.",
  "Run it from the directory that holds `config.yaml`:":
    "Start hem vanuit de map waarin `config.yaml` staat:",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "Apparaten sturen daarna OTLP naar de gateway (gRPC op poort `4317`, HTTP op poort `4318`), bijvoorbeeld met `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in de SDK van elk apparaat.",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "Staat `otelcol-contrib` al op de gateway? Wijs hem naar het bestand:",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. Controleer of de collector van de gateway zonder fouten exporteert: zoek in zijn logboeken naar exportfouten en HTTP-antwoorden `401` of `422` (`docker logs -f otel-collector` als hij in Docker draait).",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** ontvangt van je apparaten via gRPC (`4317`) en HTTP (`4318`). Ontvang metingen op elke andere manier die de collector ondersteunt (een MQTT-brug, bestandslogboeken, …) en stuur ze door dezelfde pipeline.",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** voorziet elk record van de vlootattributen. Zet `iot.fleet.name` (en de bijbehorende `service.name=iot/<fleet>`) per gateway, zodat de apparaten van elke gateway in de juiste vloot terechtkomen.",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** bundelt records vóór de export, zodat de gateway niet voor elke meting een HTTP-rondreis betaalt.",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** stuurt via HTTPS naar OneUptime, met het inname-token erbij. Zowel de standaard protobuf-codering als `encoding: json` wordt geaccepteerd.",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- Elke meting die deze gateway doorstuurt, gaat naar de vloot **`fleet-1`**: laat `iot.fleet.name` en `service.name` precies zoals ze zijn, anders registreren de metingen een nieuwe vloot. Een gateway voor een andere vloot zet zijn eigen.",
  "Any MQTT client that can connect over WebSocket":
    "Elke MQTT-client die via WebSocket kan verbinden",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "Bijvoorbeeld met de Node.js-client `mqtt` (`npm install mqtt`):",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Vervang `building-a-sensors` en `sensor-001` door je vlootnaam en de apparaat-id: OneUptime maakt de vloot en het apparaat aan op basis van het topic. De Last Will meldt het apparaat offline zodra de verbinding wegvalt; apparaten die rechtstreeks verbinden, zijn beter af met een eigen referentie (beide onder Geavanceerd).",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. Controleer of de client zonder fouten verbindt en publiceert: een verbinding die met retourcode 4 wordt geweigerd (onjuiste gebruikersnaam of onjuist wachtwoord), betekent dat de sleutel onjuist is.",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Open het tabblad **Apparaten** van de vloot: elk apparaat waarvoor je hebt gepubliceerd, zou moeten staan met de laatste status van batterij, signaal, temperatuur, CPU, geheugen en up/down.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "Er hoeft geen agent op het apparaat te worden geïnstalleerd. OneUptime deelt je apparaten in onder twee begrippen, en bij MQTT legt het topic beide vast:",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **Vloot**: de `<fleet>` in `oneuptime/<fleet>/…`, een logische groep apparaten (bijvoorbeeld `building-a-sensors`). Hij wordt de `iot.fleet.name` van de metingen en verschijnt in OneUptime als de telemetrieservice `iot/<fleet>`.",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **Apparaat**: de `<device>` in `oneuptime/<fleet>/<device>/…`, een afzonderlijk apparaat binnen de vloot. Hij wordt de `device.id` van elke meting, en OneUptime bouwt en onderhoudt per vloot een daarop gesleutelde apparaatinventaris.",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    'Optionele attributen verfijnen hoe elk apparaat wordt ingedeeld en in monitors wordt afgebakend. Zet ze in de map `"attributes"` van een telemetriepublicatie: ze worden op elk datapunt van die publicatie gezet:',
  "| Attribute | Description |": "| Attribuut | Beschrijving |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | De apparaatklasse, bijvoorbeeld `Device`, `Sensor` of `Gateway`. Standaard `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Een fijner apparaattype of -model om monitors op te filteren (bijvoorbeeld `temp-sensor`) |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | Firmwareversie die het apparaat meldt |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime herkent de volgende `iot_*`-metrieknamen. Via MQTT benoemt het topic het apparaat, dus elke meting wordt eraan toegeschreven. Je hoeft alleen de metrieken te sturen die zinvol zijn voor je apparaat: ontbrekende worden gewoon niet getoond.",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "De projectbrede inname-sleutel past bij gateways die namens veel apparaten publiceren. Registreer apparaten die rechtstreeks verbinden elk afzonderlijk op het tabblad **Apparaatregister** van de vloot: het geeft een referentie per apparaat uit; de referentie-ID is de MQTT-**gebruikersnaam** en het geheim is het **wachtwoord**. De vloot verschijnt met zijn eerste meting, dus stuur er eerst een met de projectbrede sleutel, zoals in stap 2.",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **Topic-isolatie**: een apparaatreferentie kan alleen publiceren onder de eigen topics `oneuptime/<fleet>/<device>/…`; al het andere wordt verworpen.",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **Afzonderlijke intrekking**: schakel de referentie van één apparaat uit of verwijder hem zonder de rest van de vloot aan te raken; een verbonden apparaat wordt binnen enkele seconden afgesloten.",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **Offline-detectie bij stille uitval**: een geregistreerd apparaat blijft als offline in de inventaris staan wanneer het stopt met melden, in plaats van te verdwijnen, ook als het zonder Last Will uitvalt.",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "Registreer een MQTT-**Last Will** op `oneuptime/<fleet>/<device>/status` met de payload `offline`: valt het apparaat uit, dan publiceert OneUptime namens het apparaat `iot_device_up = 0` zodra de sessie wegvalt, wat de meegeleverde waarschuwingssjabloon Device Offline zonder polling activeert. Publiceer na het verbinden `online` op hetzelfde topic, zodat het apparaat weer als up verschijnt; het voorbeeld in stap 2 doet beide. Elke meting die het apparaat publiceert, telt ook als up, dus een apparaat dat metingen blijft sturen, blijft up zonder zijn status opnieuw te publiceren. Het statustopic accepteert ook `1`/`0`, `true`/`false` en `up`/`down`.",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "Houd de MQTT-keepalive op het WebSocket-endpoint **onder 5 minuten** (de standaardwaarden van 60 s van clientbibliotheken zijn prima): inactieve WebSocket-verbindingen worden na 300 seconden gesloten, wat de Last Will en een valse offline-waarschuwing zou activeren.",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "Publiceer onder het vaste voorvoegsel `oneuptime/`. De vloot- en apparaatsegmenten mogen geen `/`, `+` of `#` bevatten, niet met `$` beginnen en zijn beperkt tot 100 tekens.",
  "| Topic | Payload |": "| MQTT-topic | Payload |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | Een JSON-object met metingen, `{"metrics":{"iot_temperature_celsius":21.5}}`, of een plat object waarvan de numerieke velden de metrieken zijn |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | Eén waarde: een los getal (`23.4`) of `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` of `offline`, omgezet naar `iot_device_up` |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    'Telemetriepayloads kunnen ook `"attributes"` bevatten (een map met strings die op elk datapunt wordt gezet; gebruik hem voor `iot.device.kind`, `iot.device.type`, `iot.device.firmware` of je eigen labels) en `"timestamp"` (ISO-8601, of Unix-seconden/-milliseconden). Beide zijn optioneel; ontbreekt `timestamp`, dan wordt het innametijdstip gebruikt.',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "Het endpoint is alleen voor inname: abonnementen worden geweigerd. Een publicatie is beperkt tot 128 KB en 100 metrieken. Publicaties buiten dit contract, of met misvormde payloads, worden geaccepteerd en verworpen (MQTT 3.1.1 kent geen foutantwoord per bericht), en OneUptime logt een waarschuwing met de reden.",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "Zelf gehoste installaties kunnen daarnaast kaal MQTT over TCP openstellen (`MQTT_INGEST_PORT`, standaard `1883`). De listener is standaard intern in het cluster- of Compose-netwerk: stel hem open als je apparaten geen WebSocket spreken. Het keepalive-plafond van WebSocket geldt daar niet.",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "Zet `MQTT_INGEST_ENABLED=false` op de app-service om de MQTT-listeners uit te zetten.",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. Controleer of het topic precies `oneuptime/<fleet>/<device>/…` volgt: het vlootsegment van het topic maakt de vloot aan.",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. Publicaties buiten het topiccontract, of met misvormde payloads, worden geaccepteerd en verworpen (MQTT 3.1.1 kent geen foutantwoord per bericht). Vergelijk de jouwe met **MQTT-topics en -payloads** onder Geavanceerd; op een zelf gehoste instantie noemen de logboeken van de app de reden (`MQTT: dropped publish to …`).",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "OneUptime weigert onjuiste referenties bij CONNECT met retourcode 4. Controleer of:",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- het wachtwoord een geldige inname-sleutel is, of, voor een geregistreerd apparaat, het geheim van de referentie, met de referentie-ID als gebruikersnaam;",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- de sleutel een serversleutel is (browsersleutels worden via MQTT geweigerd) en niet is uitgeschakeld of verlopen.",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. De apparaat-id is het segment `<device>` van het topic: houd hem stabiel tussen publicaties; een wisselende id maakt dubbele apparaatrijen aan.",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. Publiceer `iot_device_info` (alleen identiteit) of een `status`-bericht voor apparaten die nog geen metingen hebben gemeld, zodat ze toch in de inventaris verschijnen.",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "Op het WebSocket-endpoint worden inactieve verbindingen na 300 seconden gesloten, wat de Last Will en een valse Device Offline-waarschuwing activeert. Houd de MQTT-keepalive onder 5 minuten; de standaardwaarden van 60 s van clientbibliotheken zijn prima.",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Vervang `sensor-001` door de id van het apparaat: OneUptime voegt het apparaat op basis van het topic toe aan de vloot **`fleet-1`**. De Last Will meldt het apparaat offline zodra de verbinding wegvalt; apparaten die rechtstreeks verbinden, zijn beter af met een eigen referentie (beide onder Geavanceerd).",
};

export default TRANSLATION;
