import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in Spanish (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * Spanish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Spanish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "Un dispositivo con un SDK de OpenTelemetry que exporte OTLP por HTTP",
  "Network access from the device to your OneUptime instance":
    "Acceso de red desde el dispositivo a tu instancia de OneUptime",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "Sustituye `building-a-sensors` y `sensor-001` por el nombre de tu flota y el id del dispositivo. Mantén `iot.fleet.name` estable: cambiarlo registra una flota completamente nueva.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Elige una clave de ingesta en el paso 1 para rellenar `<YOUR_API_KEY>`.",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "Emite tus lecturas como métricas con nombres según las convenciones `iot_*` y da a cada punto de datos un atributo `device.id`, por ejemplo:",
  "| Metric | Value | Datapoint attribute |":
    "| Métrica | Valor | Atributo del punto de datos |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "El inventario de dispositivos se indexa por el `device.id` del punto de datos, no por el del recurso, así que defínelo en cada medición además de en `OTEL_RESOURCE_ATTRIBUTES`. Todos los nombres reconocidos están en **Convenciones de métricas**, en Avanzado.",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. Confirma que el dispositivo exporta sin errores: revisa los registros del SDK en busca de fallos de exportación y respuestas HTTP `401` o `422`.",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. En el panel de OneUptime, abre la sección **IoT**: tu flota debería aparecer en cerca de un minuto.",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Abre la pestaña **Dispositivos** de la flota: cada `device.id` que enviaste debería aparecer con su último estado de batería, señal, temperatura, CPU, memoria y activo/inactivo.",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. Abre **Métricas** en la flota para representar cualquiera de las series `iot_*`.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "No hay ningún agente que instalar en el dispositivo. OneUptime asigna tus dispositivos a dos conceptos mediante atributos de OpenTelemetry:",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **Flota**: un grupo lógico de dispositivos (por ejemplo `building-a-sensors` o `field-gateways`). La flota se deriva del atributo de recurso `iot.fleet.name` y aparece en OneUptime como el servicio de telemetría `iot/<fleet>`. Define `service.name=iot/<fleet>` para que los registros y las métricas queden bajo el mismo servicio.",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **Dispositivo**: un dispositivo individual dentro de una flota, identificado por el atributo `device.id` de cada punto de datos. OneUptime crea y mantiene un inventario de dispositivos por flota indexado por `device.id`.",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "Los atributos que lee OneUptime; los opcionales afinan cómo se clasifica cada dispositivo y cómo se acota en los monitores:",
  "| Attribute | Set on | Required | Description |":
    "| Atributo | Se define en | Obligatorio | Descripción |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | Recurso | Sí | La flota a la que pertenece este dispositivo. Se convierte en el servicio de OneUptime `iot/<fleet>` |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | Cada punto de datos | Sí | Id estable y único del dispositivo dentro de la flota |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | Cada punto de datos | No | La clase de dispositivo, por ejemplo `Device`, `Sensor` o `Gateway`. Por defecto, `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Cada punto de datos | No | Un tipo o modelo de dispositivo más fino, usado para filtrar monitores (por ejemplo `temp-sensor`) |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | Cada punto de datos | No | Versión de firmware que informa el dispositivo |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime reconoce los siguientes nombres de métricas `iot_*`. Cada punto de datos debe llevar la etiqueta `device.id` para que la lectura se atribuya al dispositivo correcto. Solo tienes que enviar las métricas que tengan sentido para tu dispositivo: las que falten simplemente no se representan.",
  "| Metric Name | Meaning |": "| Nombre de la métrica | Significado |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | Disponibilidad del dispositivo. `1` = activo/accesible, `0` = inactivo. Alimenta el monitor de dispositivo IoT |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | Señal solo de identidad. Lleva `device.id` / clase / tipo / firmware para que un dispositivo aparezca en el inventario incluso antes de informar lecturas |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | Nivel de carga de la batería, `0`–`100` (%) |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | Intensidad de la señal inalámbrica en dBm (por ejemplo, RSSI de Wi-Fi, LoRa o red móvil) |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | Temperatura del dispositivo o del sensor en °C |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | Uso de CPU como proporción `0`–`1` (el inventario de dispositivos la muestra como porcentaje) |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | Memoria en uso, en bytes |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | Memoria total disponible en el dispositivo, en bytes |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | Segundos desde el último arranque del dispositivo |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. Verifica que `iot.fleet.name` esté definido como atributo de **recurso** (no como etiqueta del punto de datos) y que `service.name` sea `iot/<fleet>`.",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. Confirma que el endpoint del exportador sea `<YOUR_ONEUPTIME_URL>/otlp` y que la cabecera `x-oneuptime-token` lleve una clave de ingesta válida.",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. Asegúrate de que cada punto de datos lleve una etiqueta `device.id`: los dispositivos se indexan por ella.",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. Envía `iot_device_info` (solo identidad) para los dispositivos que aún no han informado lecturas, para que igualmente aparezcan en el inventario.",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. Comprueba que los valores de `device.id` sean estables entre envíos; un id que cambia crea filas de dispositivo duplicadas.",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401` significa que falta la clave de ingesta, que es incorrecta o que ha caducado; `422` significa que se ha desactivado o que es una clave de navegador, que no puede enviar telemetría de dispositivos. Elige otra clave arriba (o crea una nueva) y actualiza la cabecera `x-oneuptime-token` que envía tu dispositivo o recopilador.",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. Usa los nombres exactos de métricas `iot_*` de **Convenciones de métricas**, en Avanzado: otros nombres se guardan como métricas genéricas y no llenan los gráficos de IoT.",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` es una proporción `0`–`1`; envía la proporción tal cual y OneUptime la muestra como porcentaje.",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. Deja hasta un minuto para que aparezcan los primeros puntos de datos después de que un dispositivo empiece a informar.",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "Esto envía las lecturas a la flota **`fleet-1`**. Sustituye `sensor-001` por el id del dispositivo y deja `iot.fleet.name` exactamente como está: otro nombre registra una flota nueva.",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "Un gateway que pueda ejecutar el OpenTelemetry Collector (con Docker o con el binario `otelcol-contrib`)",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "Dispositivos que envíen OTLP al gateway, y acceso de red desde el gateway a tu instancia de OneUptime",
  "Save this as `config.yaml` on the gateway:":
    "Guarda esto como `config.yaml` en el gateway:",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- Define `iot.fleet.name` (y el `service.name=iot/<fleet>` correspondiente) en cada gateway para que los dispositivos de cada gateway lleguen a la flota correcta.",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- Mantén `device.id` (y, opcionalmente, `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) en cada punto de datos para que OneUptime pueda identificar el dispositivo individual dentro de la flota.",
  "Run it from the directory that holds `config.yaml`:":
    "Ejecútalo desde el directorio que contiene `config.yaml`:",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "Después, los dispositivos envían OTLP al gateway (gRPC en el puerto `4317`, HTTP en el puerto `4318`), por ejemplo con `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` en el SDK de cada dispositivo.",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "¿Ya tienes `otelcol-contrib` en el gateway? Apúntalo al archivo:",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. Confirma que el recopilador del gateway exporta sin errores: revisa sus registros en busca de fallos de exportación y respuestas HTTP `401` o `422` (`docker logs -f otel-collector` cuando se ejecuta en Docker).",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** recibe de tus dispositivos por gRPC (`4317`) y HTTP (`4318`). Recibe lecturas de cualquier otra forma que admita el recopilador (un puente MQTT, registros en archivos, …) y reenvíalas por la misma canalización.",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** marca cada registro con los atributos de la flota. Define `iot.fleet.name` (y el `service.name=iot/<fleet>` correspondiente) en cada gateway para que los dispositivos de cada gateway lleguen a la flota correcta.",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** agrupa los registros antes de exportarlos para que el gateway no pague un viaje HTTP de ida y vuelta por cada lectura.",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** envía a OneUptime por HTTPS con el token de ingesta adjunto. Se aceptan tanto la codificación protobuf predeterminada como `encoding: json`.",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- Cada lectura que reenvía este gateway va a la flota **`fleet-1`**: deja `iot.fleet.name` y `service.name` exactamente como están, o las lecturas registrarán una flota nueva. Un gateway de otra flota define los suyos.",
  "Any MQTT client that can connect over WebSocket":
    "Cualquier cliente MQTT que pueda conectarse por WebSocket",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "Por ejemplo, con el cliente `mqtt` de Node.js (`npm install mqtt`):",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Sustituye `building-a-sensors` y `sensor-001` por el nombre de tu flota y el id del dispositivo: OneUptime crea la flota y el dispositivo a partir del tema. El Last Will informa que el dispositivo está desconectado en cuanto cae su conexión; a los dispositivos que se conectan directamente les conviene una credencial propia (ambas cosas en Avanzado).",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. Confirma que el cliente se conecta y publica sin errores: una conexión rechazada con el código de retorno 4 (usuario o contraseña incorrectos) significa que la clave es incorrecta.",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Abre la pestaña **Dispositivos** de la flota: cada dispositivo para el que publicaste debería aparecer con su último estado de batería, señal, temperatura, CPU, memoria y activo/inactivo.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "No hay ningún agente que instalar en el dispositivo. OneUptime asigna tus dispositivos a dos conceptos y, con MQTT, el tema define ambos:",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **Flota**: el `<fleet>` de `oneuptime/<fleet>/…`, un grupo lógico de dispositivos (por ejemplo `building-a-sensors`). Se convierte en el `iot.fleet.name` de las lecturas y aparece en OneUptime como el servicio de telemetría `iot/<fleet>`.",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **Dispositivo**: el `<device>` de `oneuptime/<fleet>/<device>/…`, un dispositivo individual dentro de la flota. Se convierte en el `device.id` de cada lectura, y OneUptime crea y mantiene un inventario de dispositivos por flota indexado por él.",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    'Los atributos opcionales afinan cómo se clasifica cada dispositivo y cómo se acota en los monitores. Ponlos en el mapa `"attributes"` de una publicación de telemetría: se aplican a cada punto de datos de esa publicación:',
  "| Attribute | Description |": "| Atributo | Descripción |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | La clase de dispositivo, por ejemplo `Device`, `Sensor` o `Gateway`. Por defecto, `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Un tipo o modelo de dispositivo más fino, usado para filtrar monitores (por ejemplo `temp-sensor`) |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | Versión de firmware que informa el dispositivo |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime reconoce los siguientes nombres de métricas `iot_*`. Con MQTT, el tema nombra el dispositivo, así que cada lectura se le atribuye. Solo tienes que enviar las métricas que tengan sentido para tu dispositivo: las que falten simplemente no se representan.",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "La clave de ingesta de todo el proyecto es adecuada para gateways que publican en nombre de muchos dispositivos. Para los dispositivos que se conectan directamente, registra cada uno en la pestaña **Registro de dispositivos** de la flota: emite una credencial por dispositivo; el ID de la credencial es el **usuario** de MQTT y el secreto es la **contraseña**. La flota aparece con su primera lectura, así que envía primero una con la clave de todo el proyecto, como en el paso 2.",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **Aislamiento de temas**: una credencial de dispositivo solo puede publicar en sus propios temas `oneuptime/<fleet>/<device>/…`; todo lo demás se descarta.",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **Revocación individual**: desactiva o elimina la credencial de un dispositivo sin tocar el resto de la flota; un dispositivo conectado queda desconectado en pocos segundos.",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **Detección de desconexión silenciosa**: un dispositivo registrado permanece en el inventario como desconectado cuando deja de informar, en lugar de desaparecer, aunque muera sin Last Will.",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "Registra un **Last Will** de MQTT en `oneuptime/<fleet>/<device>/status` con la carga útil `offline`: si el dispositivo muere, OneUptime publica `iot_device_up = 0` en su nombre en cuanto cae la sesión, lo que activa la plantilla de alerta Device Offline incluida, sin sondeo. Publica `online` en el mismo tema después de conectarte para que el dispositivo vuelva a aparecer como activo; el ejemplo del paso 2 hace ambas cosas. Cualquier lectura que publique el dispositivo también cuenta como activo, así que un dispositivo que sigue enviando lecturas permanece activo sin volver a publicar su estado. El tema de estado también acepta `1`/`0`, `true`/`false` y `up`/`down`.",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "Mantén el keepalive de MQTT **por debajo de 5 minutos** en el endpoint de WebSocket (los valores predeterminados de 60 s de las bibliotecas cliente sirven): las conexiones WebSocket inactivas se cierran a los 300 segundos, lo que dispararía el Last Will y una falsa alerta de desconexión.",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "Publica bajo el prefijo fijo `oneuptime/`. Los segmentos de flota y de dispositivo no pueden contener `/`, `+` ni `#`, ni empezar por `$`, y están limitados a 100 caracteres.",
  "| Topic | Payload |": "| Tema | Carga útil |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | Un objeto JSON de lecturas, `{"metrics":{"iot_temperature_celsius":21.5}}`, o un objeto plano cuyos campos numéricos son las métricas |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | Un único valor: un número sin más (`23.4`) o `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` u `offline`, que se asigna a `iot_device_up` |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    'Las cargas útiles de telemetría también pueden llevar `"attributes"` (un mapa de cadenas aplicado a cada punto de datos; úsalo para `iot.device.kind`, `iot.device.type`, `iot.device.firmware` o tus propias etiquetas) y `"timestamp"` (ISO-8601, o segundos/milisegundos Unix). Ambos son opcionales; si falta `timestamp`, se usa la hora de ingesta.',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "El endpoint es solo de ingesta: las suscripciones se rechazan. Una publicación está limitada a 128 KB y 100 métricas. Las publicaciones fuera de este contrato, o con cargas útiles mal formadas, se aceptan y se descartan (MQTT 3.1.1 no tiene respuesta de error por mensaje), y OneUptime registra una advertencia con el motivo.",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "Las instalaciones autoalojadas pueden exponer además MQTT sin más sobre TCP (`MQTT_INGEST_PORT`, por defecto `1883`). El listener es interno a la red del clúster o de Compose por defecto: exponlo si tus dispositivos no pueden usar WebSocket. El límite de keepalive de WebSocket no se aplica ahí.",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "Define `MQTT_INGEST_ENABLED=false` en el servicio de la app para desactivar los listeners de MQTT.",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. Confirma que el tema siga exactamente `oneuptime/<fleet>/<device>/…`: el segmento de flota del tema es lo que crea la flota.",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. Las publicaciones fuera del contrato de temas, o con cargas útiles mal formadas, se aceptan y se descartan (MQTT 3.1.1 no tiene respuesta de error por mensaje). Compara las tuyas con **Temas y cargas útiles de MQTT**, en Avanzado; en una instancia autoalojada, los registros de la app indican el motivo (`MQTT: dropped publish to …`).",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "OneUptime rechaza las credenciales incorrectas en CONNECT con el código de retorno 4. Comprueba que:",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- la contraseña sea una clave de ingesta válida o, para un dispositivo registrado, el secreto de la credencial, con su ID de credencial como usuario;",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- la clave sea una clave de servidor (las claves de navegador se rechazan por MQTT) y no esté desactivada ni caducada.",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. El id del dispositivo es el segmento `<device>` del tema: mantenlo estable entre publicaciones; un id que cambia crea filas de dispositivo duplicadas.",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. Publica `iot_device_info` (solo identidad) o un mensaje `status` para los dispositivos que aún no han informado lecturas, para que igualmente aparezcan en el inventario.",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "En el endpoint de WebSocket, las conexiones inactivas se cierran a los 300 segundos, lo que dispara el Last Will y una falsa alerta Device Offline. Mantén el keepalive de MQTT por debajo de 5 minutos; los valores predeterminados de 60 s de las bibliotecas cliente sirven.",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Sustituye `sensor-001` por el id del dispositivo: OneUptime añade el dispositivo a la flota **`fleet-1`** a partir del tema. El Last Will informa que el dispositivo está desconectado en cuanto cae su conexión; a los dispositivos que se conectan directamente les conviene una credencial propia (ambas cosas en Avanzado).",
};

export default TRANSLATION;
