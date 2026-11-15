import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in Italian (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * Italian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Italian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "Un dispositivo con un SDK OpenTelemetry che esporta OTLP via HTTP",
  "Network access from the device to your OneUptime instance":
    "Accesso di rete dal dispositivo alla tua istanza di OneUptime",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "Sostituisci `building-a-sensors` e `sensor-001` con il nome della tua flotta e l'id del dispositivo. Mantieni stabile `iot.fleet.name`: cambiarlo registra una flotta del tutto nuova.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Scegli una chiave di ingestione nel passaggio 1 per compilare `<YOUR_API_KEY>`.",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "Emetti le tue letture come metriche con i nomi delle convenzioni `iot_*` e dai a ogni punto dati un attributo `device.id`, per esempio:",
  "| Metric | Value | Datapoint attribute |":
    "| Metrica | Valore | Attributo del punto dati |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "L'inventario dei dispositivi è indicizzato sul `device.id` del punto dati, non su quello della risorsa, quindi impostalo su ogni misurazione oltre che in `OTEL_RESOURCE_ATTRIBUTES`. Tutti i nomi riconosciuti sono in **Convenzioni delle metriche**, in Avanzato.",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. Verifica che il dispositivo esporti senza errori: controlla nei registri dell'SDK eventuali errori di esportazione e risposte HTTP `401` o `422`.",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. Nella dashboard di OneUptime, apri la sezione **IoT**: la tua flotta dovrebbe comparire entro un minuto circa.",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Apri la scheda **Dispositivi** della flotta: ogni `device.id` inviato dovrebbe essere elencato con l'ultimo stato di batteria, segnale, temperatura, CPU, memoria e attivo/inattivo.",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. Apri **Metriche** sotto la flotta per tracciare una qualsiasi delle serie `iot_*`.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "Non c'è nessun agente da installare sul dispositivo. OneUptime associa i tuoi dispositivi a due concetti tramite attributi OpenTelemetry:",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **Flotta**: un gruppo logico di dispositivi (per esempio `building-a-sensors` o `field-gateways`). La flotta deriva dall'attributo di risorsa `iot.fleet.name` e compare in OneUptime come servizio di telemetria `iot/<fleet>`. Imposta `service.name=iot/<fleet>` perché registri e metriche si allineino sotto lo stesso servizio.",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **Dispositivo**: un singolo dispositivo all'interno di una flotta, identificato dall'attributo `device.id` di ogni punto dati. OneUptime crea e mantiene un inventario dei dispositivi per flotta, indicizzato su `device.id`.",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "Gli attributi che OneUptime legge; quelli facoltativi affinano come ogni dispositivo viene classificato e delimitato nei monitor:",
  "| Attribute | Set on | Required | Description |":
    "| Attributo | Impostato su | Obbligatorio | Descrizione |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | Risorsa | Sì | La flotta a cui appartiene questo dispositivo. Diventa il servizio di OneUptime `iot/<fleet>` |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | Ogni punto dati | Sì | Id stabile e univoco del dispositivo all'interno della flotta |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | Ogni punto dati | No | La classe del dispositivo, per esempio `Device`, `Sensor` o `Gateway`. Predefinito: `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Ogni punto dati | No | Un tipo o modello di dispositivo più specifico, usato per filtrare i monitor (per esempio `temp-sensor`) |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | Ogni punto dati | No | Versione del firmware riportata dal dispositivo |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime riconosce i seguenti nomi di metriche `iot_*`. Ogni punto dati deve portare l'etichetta `device.id` perché la lettura venga attribuita al dispositivo giusto. Ti basta inviare le metriche sensate per il tuo dispositivo: quelle mancanti semplicemente non vengono tracciate.",
  "| Metric Name | Meaning |": "| Nome della metrica | Significato |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | Disponibilità del dispositivo. `1` = attivo/raggiungibile, `0` = inattivo. Alimenta il monitor dei dispositivi IoT |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | Segnale di sola identità. Porta `device.id` / classe / tipo / firmware perché un dispositivo compaia nell'inventario anche prima di inviare letture |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | Livello di carica della batteria, `0`–`100` (%) |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | Intensità del segnale wireless in dBm (per esempio RSSI Wi-Fi, LoRa o cellulare) |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | Temperatura del dispositivo o del sensore in °C |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | Utilizzo della CPU come rapporto `0`–`1` (l'inventario dei dispositivi lo mostra come percentuale) |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | Memoria attualmente in uso, in byte |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | Memoria totale disponibile sul dispositivo, in byte |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | Secondi dall'ultimo avvio del dispositivo |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. Verifica che `iot.fleet.name` sia impostato come attributo di **risorsa** (non come etichetta del punto dati) e che `service.name` sia `iot/<fleet>`.",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. Verifica che l'endpoint dell'exporter sia `<YOUR_ONEUPTIME_URL>/otlp` e che l'header `x-oneuptime-token` porti una chiave di ingestione valida.",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. Assicurati che ogni punto dati porti un'etichetta `device.id`: i dispositivi sono indicizzati su di essa.",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. Invia `iot_device_info` (sola identità) per i dispositivi che non hanno ancora inviato letture, così compaiono comunque nell'inventario.",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. Controlla che i valori di `device.id` restino stabili tra un invio e l'altro; un id che cambia crea righe di dispositivo duplicate.",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401` significa che la chiave di ingestione manca, è errata o è scaduta; `422` significa che è stata disattivata o che è una chiave del browser, che non può inviare la telemetria dei dispositivi. Seleziona un'altra chiave qui sopra (o creane una nuova) e aggiorna l'header `x-oneuptime-token` inviato dal tuo dispositivo o dal collector.",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. Usa i nomi esatti delle metriche `iot_*` di **Convenzioni delle metriche**, in Avanzato: gli altri nomi vengono salvati come metriche generiche e non popolano i grafici IoT.",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` è un rapporto `0`–`1`; invia il rapporto grezzo e OneUptime lo mostra come percentuale.",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. Attendi fino a un minuto perché compaiano i primi punti dati dopo che un dispositivo ha iniziato a inviare.",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "Così le letture vanno alla flotta **`fleet-1`**. Sostituisci `sensor-001` con l'id del dispositivo e lascia `iot.fleet.name` esattamente com'è: un altro nome registra una nuova flotta.",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "Un gateway in grado di eseguire l'OpenTelemetry Collector (con Docker o con il binario `otelcol-contrib`)",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "Dispositivi che inviano OTLP al gateway, e accesso di rete dal gateway alla tua istanza di OneUptime",
  "Save this as `config.yaml` on the gateway:":
    "Salva questo come `config.yaml` sul gateway:",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- Imposta `iot.fleet.name` (e il corrispondente `service.name=iot/<fleet>`) per ogni gateway, così i dispositivi di ciascun gateway finiscono nella flotta giusta.",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- Mantieni `device.id` (e, facoltativamente, `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) su ogni punto dati, così OneUptime può risalire al singolo dispositivo all'interno della flotta.",
  "Run it from the directory that holds `config.yaml`:":
    "Eseguilo dalla directory che contiene `config.yaml`:",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "I dispositivi inviano poi OTLP al gateway (gRPC sulla porta `4317`, HTTP sulla porta `4318`), per esempio con `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` nell'SDK di ogni dispositivo.",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "Hai già `otelcol-contrib` sul gateway? Puntalo al file:",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. Verifica che il collector del gateway esporti senza errori: controlla nei suoi registri eventuali errori di esportazione e risposte HTTP `401` o `422` (`docker logs -f otel-collector` quando gira in Docker).",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** riceve dai tuoi dispositivi via gRPC (`4317`) e HTTP (`4318`). Ricevi le letture in qualsiasi altro modo supportato dal collector (un bridge MQTT, registri su file, …) e inoltrale attraverso la stessa pipeline.",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** applica a ogni record gli attributi della flotta. Imposta `iot.fleet.name` (e il corrispondente `service.name=iot/<fleet>`) per ogni gateway, così i dispositivi di ciascun gateway finiscono nella flotta giusta.",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** raggruppa i record prima dell'esportazione, così il gateway non paga un giro HTTP di andata e ritorno per ogni lettura.",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** invia a OneUptime via HTTPS con il token di ingestione allegato. Sono accettate sia la codifica protobuf predefinita sia `encoding: json`.",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- Ogni lettura inoltrata da questo gateway va alla flotta **`fleet-1`**: lascia `iot.fleet.name` e `service.name` esattamente come sono, altrimenti le letture registrano una nuova flotta. Un gateway di un'altra flotta imposta i propri.",
  "Any MQTT client that can connect over WebSocket":
    "Qualsiasi client MQTT in grado di connettersi via WebSocket",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "Per esempio, con il client Node.js `mqtt` (`npm install mqtt`):",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Sostituisci `building-a-sensors` e `sensor-001` con il nome della tua flotta e l'id del dispositivo: OneUptime crea la flotta e il dispositivo a partire dal topic. Il Last Will segnala il dispositivo offline nel momento in cui cade la connessione; ai dispositivi che si connettono direttamente conviene una credenziale propria (entrambe le cose in Avanzato).",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. Verifica che il client si connetta e pubblichi senza errori: una connessione rifiutata con codice di ritorno 4 (nome utente o password errati) significa che la chiave è errata.",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Apri la scheda **Dispositivi** della flotta: ogni dispositivo per cui hai pubblicato dovrebbe essere elencato con l'ultimo stato di batteria, segnale, temperatura, CPU, memoria e attivo/inattivo.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "Non c'è nessun agente da installare sul dispositivo. OneUptime associa i tuoi dispositivi a due concetti e, con MQTT, il topic li stabilisce entrambi:",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **Flotta**: il `<fleet>` in `oneuptime/<fleet>/…`, un gruppo logico di dispositivi (per esempio `building-a-sensors`). Diventa l'`iot.fleet.name` delle letture e compare in OneUptime come servizio di telemetria `iot/<fleet>`.",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **Dispositivo**: il `<device>` in `oneuptime/<fleet>/<device>/…`, un singolo dispositivo all'interno della flotta. Diventa il `device.id` di ogni lettura, e OneUptime crea e mantiene un inventario dei dispositivi per flotta indicizzato su di esso.",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    'Gli attributi facoltativi affinano come ogni dispositivo viene classificato e delimitato nei monitor. Mettili nella mappa `"attributes"` di una pubblicazione di telemetria: vengono applicati a ogni punto dati di quella pubblicazione:',
  "| Attribute | Description |": "| Attributo | Descrizione |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | La classe del dispositivo, per esempio `Device`, `Sensor` o `Gateway`. Predefinito: `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Un tipo o modello di dispositivo più specifico, usato per filtrare i monitor (per esempio `temp-sensor`) |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | Versione del firmware riportata dal dispositivo |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime riconosce i seguenti nomi di metriche `iot_*`. Con MQTT il topic nomina il dispositivo, quindi ogni lettura gli viene attribuita. Ti basta inviare le metriche sensate per il tuo dispositivo: quelle mancanti semplicemente non vengono tracciate.",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "La chiave di ingestione a livello di progetto è adatta ai gateway che pubblicano per conto di molti dispositivi. Per i dispositivi che si connettono direttamente, registra ciascuno nella scheda **Registro dei dispositivi** della flotta: emette una credenziale per dispositivo; l'ID della credenziale è il **nome utente** MQTT e il segreto è la **password**. La flotta compare con la sua prima lettura, quindi inviane prima una con la chiave di progetto, come nel passaggio 2.",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **Isolamento dei topic**: una credenziale di dispositivo può pubblicare solo sotto i propri topic `oneuptime/<fleet>/<device>/…`; tutto il resto viene scartato.",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **Revoca individuale**: disattiva o elimina la credenziale di un dispositivo senza toccare il resto della flotta; un dispositivo connesso viene scollegato entro pochi secondi.",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **Rilevamento offline dei guasti silenziosi**: un dispositivo registrato resta nell'inventario come offline quando smette di inviare, invece di sparire, anche se si spegne senza Last Will.",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "Registra un **Last Will** MQTT su `oneuptime/<fleet>/<device>/status` con payload `offline`: se il dispositivo si spegne, OneUptime pubblica `iot_device_up = 0` al suo posto nel momento in cui cade la sessione, il che fa scattare il modello di avviso Device Offline incluso, senza polling. Pubblica `online` sullo stesso topic dopo la connessione perché il dispositivo torni a risultare attivo; l'esempio del passaggio 2 fa entrambe le cose. Anche ogni lettura pubblicata dal dispositivo conta come attivo, quindi un dispositivo che continua a inviare letture resta attivo senza ripubblicare il suo stato. Il topic di stato accetta anche `1`/`0`, `true`/`false` e `up`/`down`.",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "Mantieni il keepalive MQTT **sotto i 5 minuti** sull'endpoint WebSocket (i valori predefiniti di 60 s delle librerie client vanno bene): le connessioni WebSocket inattive vengono chiuse dopo 300 secondi, il che farebbe scattare il Last Will e un falso avviso di dispositivo offline.",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "Pubblica sotto il prefisso fisso `oneuptime/`. I segmenti di flotta e di dispositivo non possono contenere `/`, `+` o `#` né iniziare con `$`, e sono limitati a 100 caratteri.",
  "| Topic | Payload |": "| Topic MQTT | Payload |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | Un oggetto JSON di letture, `{"metrics":{"iot_temperature_celsius":21.5}}`, o un oggetto piatto i cui campi numerici sono le metriche |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | Un singolo valore: un numero semplice (`23.4`) o `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` o `offline`, convertito in `iot_device_up` |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    'I payload di telemetria possono portare anche `"attributes"` (una mappa di stringhe applicata a ogni punto dati; usala per `iot.device.kind`, `iot.device.type`, `iot.device.firmware` o per le tue etichette) e `"timestamp"` (ISO-8601, o secondi/millisecondi Unix). Entrambi sono facoltativi; in assenza di `timestamp` si usa l\'ora di ingestione.',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "L'endpoint è di sola ingestione: le sottoscrizioni vengono rifiutate. Una pubblicazione è limitata a 128 KB e 100 metriche. Le pubblicazioni fuori da questo contratto, o con payload malformati, vengono accettate e scartate (MQTT 3.1.1 non ha una risposta di errore per messaggio), e OneUptime registra un avviso con il motivo.",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "Le installazioni self-hosted possono esporre in più MQTT diretto su TCP (`MQTT_INGEST_PORT`, predefinito `1883`). Il listener è interno alla rete del cluster o di Compose per impostazione predefinita: esponilo se i tuoi dispositivi non parlano WebSocket. Lì non si applica il limite di keepalive di WebSocket.",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "Imposta `MQTT_INGEST_ENABLED=false` sul servizio dell'app per disattivare i listener MQTT.",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. Verifica che il topic segua esattamente `oneuptime/<fleet>/<device>/…`: è il segmento di flotta del topic a creare la flotta.",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. Le pubblicazioni fuori dal contratto dei topic, o con payload malformati, vengono accettate e scartate (MQTT 3.1.1 non ha una risposta di errore per messaggio). Confronta le tue con **Topic e payload MQTT**, in Avanzato; su un'istanza self-hosted i registri dell'app indicano il motivo (`MQTT: dropped publish to …`).",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "OneUptime rifiuta le credenziali errate al CONNECT con codice di ritorno 4. Controlla che:",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- la password sia una chiave di ingestione valida o, per un dispositivo registrato, il segreto della credenziale, con il suo ID credenziale come nome utente;",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- la chiave sia una chiave server (le chiavi del browser vengono rifiutate via MQTT) e non sia stata disattivata né sia scaduta.",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. L'id del dispositivo è il segmento `<device>` del topic: mantienilo stabile tra una pubblicazione e l'altra; un id che cambia crea righe di dispositivo duplicate.",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. Pubblica `iot_device_info` (sola identità) o un messaggio `status` per i dispositivi che non hanno ancora inviato letture, così compaiono comunque nell'inventario.",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "Sull'endpoint WebSocket le connessioni inattive vengono chiuse dopo 300 secondi, il che fa scattare il Last Will e un falso avviso Device Offline. Mantieni il keepalive MQTT sotto i 5 minuti; i valori predefiniti di 60 s delle librerie client vanno bene.",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Sostituisci `sensor-001` con l'id del dispositivo: OneUptime aggiunge il dispositivo alla flotta **`fleet-1`** a partire dal topic. Il Last Will segnala il dispositivo offline nel momento in cui cade la connessione; ai dispositivi che si connettono direttamente conviene una credenziale propria (entrambe le cose in Avanzato).",
};

export default TRANSLATION;
