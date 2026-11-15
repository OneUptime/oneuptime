import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in French (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * French. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its French words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "Un appareil exécutant un SDK OpenTelemetry qui exporte OTLP via HTTP",
  "Network access from the device to your OneUptime instance":
    "Un accès réseau de l'appareil à votre instance OneUptime",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "Remplacez `building-a-sensors` et `sensor-001` par le nom de votre flotte et l'id de l'appareil. Gardez `iot.fleet.name` stable : le modifier enregistre une flotte entièrement nouvelle.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Choisissez une clé d'ingestion à l'étape 1 pour remplir `<YOUR_API_KEY>`.",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "Émettez vos mesures comme des métriques nommées selon les conventions `iot_*`, et donnez à chaque point de données un attribut `device.id`, par exemple :",
  "| Metric | Value | Datapoint attribute |":
    "| Métrique | Valeur | Attribut du point de données |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "L'inventaire des appareils est indexé sur le `device.id` du point de données, pas sur celui de la ressource : définissez-le donc sur chaque mesure en plus de `OTEL_RESOURCE_ATTRIBUTES`. Tous les noms reconnus figurent sous **Conventions des métriques** dans Avancé.",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. Vérifiez que l'appareil exporte sans erreur : consultez les journaux du SDK à la recherche d'échecs d'export et de réponses HTTP `401` ou `422`.",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. Dans le tableau de bord OneUptime, ouvrez la section **IoT** : votre flotte devrait apparaître en une minute environ.",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Ouvrez l'onglet **Appareils** de la flotte : chaque `device.id` envoyé devrait y figurer avec son dernier état de batterie, de signal, de température, de CPU, de mémoire et de disponibilité.",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. Ouvrez **Métriques** sous la flotte pour tracer n'importe laquelle des séries `iot_*`.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "Il n'y a aucun agent à installer sur l'appareil. OneUptime rattache vos appareils à deux notions à l'aide d'attributs OpenTelemetry :",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **Flotte** : un groupe logique d'appareils (par exemple `building-a-sensors` ou `field-gateways`). La flotte est déduite de l'attribut de ressource `iot.fleet.name` et apparaît dans OneUptime comme le service de télémétrie `iot/<fleet>`. Définissez `service.name=iot/<fleet>` pour que journaux et métriques se rangent sous le même service.",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **Appareil** : un appareil individuel au sein d'une flotte, identifié par l'attribut `device.id` de chaque point de données. OneUptime construit et tient à jour un inventaire des appareils par flotte, indexé sur `device.id`.",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "Les attributs que lit OneUptime ; les facultatifs précisent comment chaque appareil est classé et ciblé dans les moniteurs :",
  "| Attribute | Set on | Required | Description |":
    "| Attribut | Défini sur | Obligatoire | Description |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | Ressource | Oui | La flotte à laquelle appartient cet appareil. Devient le service OneUptime `iot/<fleet>` |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | Chaque point de données | Oui | Id stable et unique de l'appareil au sein de la flotte |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | Chaque point de données | Non | La classe d'appareil, par exemple `Device`, `Sensor` ou `Gateway`. Par défaut `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Chaque point de données | Non | Un type ou modèle d'appareil plus fin, utilisé pour filtrer les moniteurs (par exemple `temp-sensor`) |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | Chaque point de données | Non | Version du firmware signalée par l'appareil |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime reconnaît les noms de métriques `iot_*` suivants. Chaque point de données doit porter le label `device.id` pour que la mesure soit attribuée au bon appareil. Envoyez seulement les métriques qui ont un sens pour votre appareil : celles qui manquent ne sont tout simplement pas tracées.",
  "| Metric Name | Meaning |": "| Nom de la métrique | Signification |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | Disponibilité de l'appareil. `1` = disponible/joignable, `0` = indisponible. Alimente le moniteur d'appareil IoT |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | Signal d'identité seule. Porte `device.id` / classe / type / firmware pour qu'un appareil apparaisse dans l'inventaire avant même de signaler des mesures |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | Niveau de charge de la batterie, `0`–`100` (%) |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | Puissance du signal sans fil en dBm (par exemple RSSI Wi-Fi, LoRa ou cellulaire) |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | Température de l'appareil ou du capteur en °C |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | Utilisation du CPU sous forme de ratio `0`–`1` (l'inventaire des appareils l'affiche en pourcentage) |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | Mémoire actuellement utilisée, en octets |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | Mémoire totale disponible sur l'appareil, en octets |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | Secondes écoulées depuis le dernier démarrage de l'appareil |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. Vérifiez que `iot.fleet.name` est défini comme attribut de **ressource** (et non comme label du point de données), et que `service.name` vaut `iot/<fleet>`.",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. Vérifiez que le point de terminaison de l'exportateur est `<YOUR_ONEUPTIME_URL>/otlp` et que l'en-tête `x-oneuptime-token` porte une clé d'ingestion valide.",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. Assurez-vous que chaque point de données porte un label `device.id` : les appareils sont indexés dessus.",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. Envoyez `iot_device_info` (identité seule) pour les appareils qui n'ont encore signalé aucune mesure, afin qu'ils apparaissent tout de même dans l'inventaire.",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. Vérifiez que les valeurs de `device.id` restent stables d'un envoi à l'autre ; un id qui change crée des lignes d'appareil en double.",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401` signifie que la clé d'ingestion est absente, erronée ou expirée ; `422` signifie qu'elle a été désactivée, ou qu'il s'agit d'une clé de navigateur, qui ne peut pas envoyer la télémétrie des appareils. Sélectionnez une autre clé ci-dessus (ou créez-en une) et mettez à jour l'en-tête `x-oneuptime-token` que votre appareil ou votre collecteur envoie.",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. Utilisez les noms exacts de métriques `iot_*` de **Conventions des métriques** sous Avancé : les autres noms sont stockés comme métriques génériques et n'alimentent pas les graphiques IoT.",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` est un ratio `0`–`1` ; envoyez le ratio brut et OneUptime l'affiche en pourcentage.",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. Comptez jusqu'à une minute pour que les premiers points de données apparaissent après qu'un appareil a commencé à signaler.",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "Ceci envoie les mesures à la flotte **`fleet-1`**. Remplacez `sensor-001` par l'id de l'appareil et laissez `iot.fleet.name` exactement tel quel : un autre nom enregistre une nouvelle flotte.",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "Une passerelle capable d'exécuter l'OpenTelemetry Collector (avec Docker, ou le binaire `otelcol-contrib`)",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "Des appareils qui envoient OTLP à la passerelle, et un accès réseau de la passerelle à votre instance OneUptime",
  "Save this as `config.yaml` on the gateway:":
    "Enregistrez ceci sous `config.yaml` sur la passerelle :",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- Définissez `iot.fleet.name` (et le `service.name=iot/<fleet>` correspondant) pour chaque passerelle, afin que les appareils de chaque passerelle arrivent dans la bonne flotte.",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- Gardez `device.id` (et, en option, `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) sur chaque point de données pour que OneUptime puisse identifier chaque appareil au sein de la flotte.",
  "Run it from the directory that holds `config.yaml`:":
    "Lancez-le depuis le répertoire qui contient `config.yaml` :",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "Les appareils envoient ensuite OTLP à la passerelle (gRPC sur le port `4317`, HTTP sur le port `4318`), par exemple avec `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` dans le SDK de chaque appareil.",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "Vous avez déjà `otelcol-contrib` sur la passerelle ? Faites-le pointer vers le fichier :",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. Vérifiez que le collecteur de la passerelle exporte sans erreur : consultez ses journaux à la recherche d'échecs d'export et de réponses HTTP `401` ou `422` (`docker logs -f otel-collector` lorsqu'il tourne dans Docker).",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** reçoit les données de vos appareils via gRPC (`4317`) et HTTP (`4318`). Recevez les mesures par tout autre moyen que le collecteur prend en charge (un pont MQTT, des journaux de fichiers, …) et faites-les passer par le même pipeline.",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** appose sur chaque enregistrement les attributs de la flotte. Définissez `iot.fleet.name` (et le `service.name=iot/<fleet>` correspondant) pour chaque passerelle, afin que les appareils de chaque passerelle arrivent dans la bonne flotte.",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** regroupe les enregistrements avant l'export, pour que la passerelle ne paie pas un aller-retour HTTP par mesure.",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** envoie à OneUptime via HTTPS avec le jeton d'ingestion joint. L'encodage protobuf par défaut comme `encoding: json` sont acceptés.",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- Chaque mesure que cette passerelle transmet va à la flotte **`fleet-1`** : laissez `iot.fleet.name` et `service.name` exactement tels quels, sinon les mesures enregistrent une nouvelle flotte. Une passerelle d'une autre flotte définit les siens.",
  "Any MQTT client that can connect over WebSocket":
    "Tout client MQTT capable de se connecter via WebSocket",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "Par exemple, avec le client Node.js `mqtt` (`npm install mqtt`) :",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Remplacez `building-a-sensors` et `sensor-001` par le nom de votre flotte et l'id de l'appareil : OneUptime crée la flotte et l'appareil à partir du topic. Le Last Will signale l'appareil hors ligne dès que sa connexion tombe ; les appareils qui se connectent directement gagnent à avoir leurs propres identifiants (les deux sous Avancé).",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. Vérifiez que le client se connecte et publie sans erreur : une connexion refusée avec le code de retour 4 (nom d'utilisateur ou mot de passe incorrect) signifie que la clé est erronée.",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Ouvrez l'onglet **Appareils** de la flotte : chaque appareil pour lequel vous avez publié devrait y figurer avec son dernier état de batterie, de signal, de température, de CPU, de mémoire et de disponibilité.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "Il n'y a aucun agent à installer sur l'appareil. OneUptime rattache vos appareils à deux notions, et avec MQTT c'est le topic qui définit les deux :",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **Flotte** : le `<fleet>` de `oneuptime/<fleet>/…`, un groupe logique d'appareils (par exemple `building-a-sensors`). Il devient le `iot.fleet.name` des mesures et apparaît dans OneUptime comme le service de télémétrie `iot/<fleet>`.",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **Appareil** : le `<device>` de `oneuptime/<fleet>/<device>/…`, un appareil individuel au sein de la flotte. Il devient le `device.id` de chaque mesure, et OneUptime construit et tient à jour un inventaire des appareils par flotte, indexé dessus.",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    'Des attributs facultatifs précisent comment chaque appareil est classé et ciblé dans les moniteurs. Placez-les dans la table `"attributes"` d\'une publication de télémétrie : ils sont apposés sur chaque point de données de cette publication :',
  "| Attribute | Description |": "| Attribut | Rôle |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | La classe d'appareil, par exemple `Device`, `Sensor` ou `Gateway`. Par défaut `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Un type ou modèle d'appareil plus fin, utilisé pour filtrer les moniteurs (par exemple `temp-sensor`) |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | Version du firmware signalée par l'appareil |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime reconnaît les noms de métriques `iot_*` suivants. Avec MQTT, le topic nomme l'appareil : chaque mesure lui est donc attribuée. Envoyez seulement les métriques qui ont un sens pour votre appareil : celles qui manquent ne sont tout simplement pas tracées.",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "La clé d'ingestion du projet convient aux passerelles qui publient pour le compte de nombreux appareils. Pour les appareils qui se connectent directement, enregistrez chacun dans l'onglet **Registre des appareils** de la flotte : il délivre des identifiants par appareil ; l'ID des identifiants est le **nom d'utilisateur** MQTT et le secret est le **mot de passe**. La flotte apparaît avec sa première mesure : envoyez-en donc d'abord une avec la clé du projet, comme à l'étape 2.",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **Isolation des topics** : des identifiants d'appareil ne peuvent publier que sous leurs propres topics `oneuptime/<fleet>/<device>/…` ; tout le reste est ignoré.",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **Révocation individuelle** : désactivez ou supprimez les identifiants d'un appareil sans toucher au reste de la flotte ; un appareil connecté est coupé en quelques secondes.",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **Détection des pannes silencieuses** : un appareil enregistré reste dans l'inventaire comme hors ligne quand il cesse de signaler, au lieu de disparaître, même s'il s'arrête sans Last Will.",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "Enregistrez un **Last Will** MQTT sur `oneuptime/<fleet>/<device>/status` avec la charge utile `offline` : si l'appareil s'arrête, OneUptime publie `iot_device_up = 0` en son nom dès que la session tombe, ce qui déclenche le modèle d'alerte Device Offline fourni, sans interrogation périodique. Publiez `online` sur le même topic après la connexion pour que l'appareil réapparaisse comme disponible ; l'exemple de l'étape 2 fait les deux. Toute mesure publiée par l'appareil compte aussi comme disponible : un appareil qui continue d'envoyer des mesures reste donc disponible sans republier son état. Le topic d'état accepte aussi `1`/`0`, `true`/`false` et `up`/`down`.",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "Gardez le keepalive MQTT **sous 5 minutes** sur le point de terminaison WebSocket (les valeurs par défaut de 60 s des bibliothèques clientes conviennent) : les connexions WebSocket inactives sont fermées au bout de 300 secondes, ce qui déclencherait le Last Will et une fausse alerte hors ligne.",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "Publiez sous le préfixe fixe `oneuptime/`. Les segments de flotte et d'appareil ne doivent contenir ni `/`, ni `+`, ni `#`, ni commencer par `$`, et sont limités à 100 caractères.",
  "| Topic | Payload |": "| Topic MQTT | Charge utile |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | Un objet JSON de mesures, `{"metrics":{"iot_temperature_celsius":21.5}}`, ou un objet plat dont les champs numériques sont les métriques |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | Une seule valeur : un nombre seul (`23.4`) ou `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` ou `offline`, converti en `iot_device_up` |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    'Les charges utiles de télémétrie peuvent aussi porter `"attributes"` (une table de chaînes apposée sur chaque point de données ; utilisez-la pour `iot.device.kind`, `iot.device.type`, `iot.device.firmware` ou vos propres labels) et `"timestamp"` (ISO-8601, ou secondes/millisecondes Unix). Les deux sont facultatifs ; l\'heure d\'ingestion est utilisée en l\'absence de `timestamp`.',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "Le point de terminaison sert uniquement à l'ingestion : les abonnements sont refusés. Une publication est plafonnée à 128 Ko et 100 métriques. Les publications hors de ce contrat, ou aux charges utiles mal formées, sont acceptées puis ignorées (MQTT 3.1.1 n'a pas de réponse d'erreur par message), et OneUptime journalise un avertissement avec la raison.",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "Les déploiements auto-hébergés peuvent en plus exposer MQTT brut sur TCP (`MQTT_INGEST_PORT`, par défaut `1883`). L'écouteur est interne au réseau du cluster ou de Compose par défaut : exposez-le si vos appareils ne parlent pas WebSocket. Le plafond de keepalive de WebSocket ne s'y applique pas.",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "Définissez `MQTT_INGEST_ENABLED=false` sur le service de l'application pour désactiver les écouteurs MQTT.",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. Vérifiez que le topic suit exactement `oneuptime/<fleet>/<device>/…` : c'est le segment de flotte du topic qui crée la flotte.",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. Les publications hors du contrat des topics, ou aux charges utiles mal formées, sont acceptées puis ignorées (MQTT 3.1.1 n'a pas de réponse d'erreur par message). Comparez les vôtres avec **Topics et charges utiles MQTT** sous Avancé ; sur une instance auto-hébergée, les journaux de l'application donnent la raison (`MQTT: dropped publish to …`).",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "OneUptime rejette les identifiants erronés au CONNECT avec le code de retour 4. Vérifiez que :",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- le mot de passe est une clé d'ingestion valide ou, pour un appareil enregistré, le secret des identifiants, avec leur ID comme nom d'utilisateur ;",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- la clé est une clé serveur (les clés de navigateur sont refusées via MQTT) et n'a été ni désactivée ni n'a expiré.",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. L'id de l'appareil est le segment `<device>` du topic : gardez-le stable d'une publication à l'autre ; un id qui change crée des lignes d'appareil en double.",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. Publiez `iot_device_info` (identité seule) ou un message `status` pour les appareils qui n'ont encore signalé aucune mesure, afin qu'ils apparaissent tout de même dans l'inventaire.",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "Sur le point de terminaison WebSocket, les connexions inactives sont fermées au bout de 300 secondes, ce qui déclenche le Last Will et une fausse alerte Device Offline. Gardez le keepalive MQTT sous 5 minutes ; les valeurs par défaut de 60 s des bibliothèques clientes conviennent.",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Remplacez `sensor-001` par l'id de l'appareil : OneUptime ajoute l'appareil à la flotte **`fleet-1`** à partir du topic. Le Last Will signale l'appareil hors ligne dès que sa connexion tombe ; les appareils qui se connectent directement gagnent à avoir leurs propres identifiants (les deux sous Avancé).",
};

export default TRANSLATION;
