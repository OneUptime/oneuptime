import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in Russian (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * Russian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Russian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "Устройство с SDK OpenTelemetry, экспортирующим OTLP по HTTP",
  "Network access from the device to your OneUptime instance":
    "Сетевой доступ с устройства к вашему экземпляру OneUptime",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "Замените `building-a-sensors` и `sensor-001` именем вашего парка устройств и id устройства. Не меняйте `iot.fleet.name`: при изменении регистрируется совершенно новый парк устройств.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Выберите ключ приёма на шаге 1, чтобы подставить `<YOUR_API_KEY>`.",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "Отправляйте показания как метрики с именами по соглашениям `iot_*` и задавайте каждой точке данных атрибут `device.id`, например:",
  "| Metric | Value | Datapoint attribute |":
    "| Метрика | Значение | Атрибут точки данных |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "Инвентарь устройств строится по `device.id` точки данных, а не ресурса, поэтому задавайте его в каждом измерении, а также в `OTEL_RESOURCE_ATTRIBUTES`. Все распознаваемые имена перечислены в теме **Соглашения о метриках** в разделе Расширенный.",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. Убедитесь, что устройство экспортирует без ошибок: проверьте журналы SDK на сбои экспорта и ответы HTTP `401` или `422`.",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. В панели OneUptime откройте раздел **IoT**: ваш парк устройств должен появиться примерно в течение минуты.",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Откройте вкладку **Устройства** парка: каждый отправленный `device.id` должен быть в списке с последним состоянием батареи, сигнала, температуры, CPU, памяти и доступности.",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. Откройте **Метрики** в парке, чтобы построить график любой из серий `iot_*`.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "На устройство не нужно устанавливать агент. OneUptime сопоставляет ваши устройства двум понятиям с помощью атрибутов OpenTelemetry:",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **Парк устройств**: логическая группа устройств (например, `building-a-sensors` или `field-gateways`). Парк определяется по атрибуту ресурса `iot.fleet.name` и появляется в OneUptime как служба телеметрии `iot/<fleet>`. Задайте `service.name=iot/<fleet>`, чтобы журналы и метрики собирались в одной службе.",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **Устройство**: отдельное устройство в парке, которое определяется по атрибуту `device.id` каждой точки данных. OneUptime ведёт инвентарь устройств для каждого парка по `device.id`.",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "Атрибуты, которые читает OneUptime; необязательные уточняют, как классифицируется каждое устройство и как оно выбирается в мониторах:",
  "| Attribute | Set on | Required | Description |":
    "| Атрибут | Где задаётся | Обязателен | Описание |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | Ресурс | Да | Парк, к которому относится устройство. Становится службой OneUptime `iot/<fleet>` |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | Каждая точка данных | Да | Постоянный уникальный id устройства в парке |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | Каждая точка данных | Нет | Класс устройства, например `Device`, `Sensor` или `Gateway`. По умолчанию `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Каждая точка данных | Нет | Более точный тип или модель устройства для фильтрации мониторов (например, `temp-sensor`) |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | Каждая точка данных | Нет | Версия прошивки, которую сообщает устройство |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime распознаёт следующие имена метрик `iot_*`. Каждая точка данных должна нести метку `device.id`, чтобы показание было отнесено к нужному устройству. Отправляйте только те метрики, которые имеют смысл для вашего устройства: отсутствующие просто не отображаются.",
  "| Metric Name | Meaning |": "| Имя метрики | Значение |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | Доступность устройства. `1` = работает/доступно, `0` = не работает. Управляет монитором устройств IoT |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | Сигнал только с идентификацией. Несёт `device.id` / класс / тип / прошивку, чтобы устройство появилось в инвентаре ещё до отправки показаний |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | Уровень заряда батареи, `0`–`100` (%) |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | Мощность беспроводного сигнала в дБм (например, RSSI Wi-Fi, LoRa или сотовой сети) |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | Температура устройства или датчика в °C |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | Загрузка CPU как доля `0`–`1` (инвентарь устройств показывает её в процентах) |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | Используемая сейчас память, в байтах |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | Общий объём памяти устройства, в байтах |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | Секунды с последней загрузки устройства |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. Проверьте, что `iot.fleet.name` задан как атрибут **ресурса** (а не метка точки данных) и что `service.name` равен `iot/<fleet>`.",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. Убедитесь, что конечная точка экспортёра — `<YOUR_ONEUPTIME_URL>/otlp`, а заголовок `x-oneuptime-token` содержит действительный ключ приёма.",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. Убедитесь, что каждая точка данных несёт метку `device.id`: устройства учитываются по ней.",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. Отправляйте `iot_device_info` (только идентификация) для устройств, которые ещё не прислали показаний, чтобы они всё равно появились в инвентаре.",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. Проверьте, что значения `device.id` не меняются от отправки к отправке; меняющийся id создаёт повторяющиеся строки устройств.",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401` означает, что ключ приёма отсутствует, неверен или истёк; `422` означает, что он отключён или это ключ браузера, который не может отправлять телеметрию устройств. Выберите другой ключ выше (или создайте новый) и обновите заголовок `x-oneuptime-token`, который отправляет ваше устройство или коллектор.",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. Используйте точные имена метрик `iot_*` из темы **Соглашения о метриках** в разделе Расширенный: другие имена сохраняются как обычные метрики и не заполняют графики IoT.",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` — это доля `0`–`1`; отправляйте исходную долю, а OneUptime покажет её в процентах.",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. Подождите до минуты, пока появятся первые точки данных после того, как устройство начнёт отправку.",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "Так показания уходят в парк устройств **`fleet-1`**. Замените `sensor-001` на id устройства и оставьте `iot.fleet.name` ровно таким, как есть: другое имя регистрирует новый парк устройств.",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "Шлюз, на котором можно запустить OpenTelemetry Collector (через Docker или исполняемый файл `otelcol-contrib`)",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "Устройства, отправляющие OTLP на шлюз, и сетевой доступ со шлюза к вашему экземпляру OneUptime",
  "Save this as `config.yaml` on the gateway:":
    "Сохраните это как `config.yaml` на шлюзе:",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- Задавайте `iot.fleet.name` (и соответствующий `service.name=iot/<fleet>`) для каждого шлюза, чтобы устройства каждого шлюза попадали в нужный парк.",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- Сохраняйте `device.id` (и при необходимости `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) в каждой точке данных, чтобы OneUptime мог определить отдельное устройство в парке.",
  "Run it from the directory that holds `config.yaml`:":
    "Запустите его из каталога, где лежит `config.yaml`:",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "Затем устройства отправляют OTLP на шлюз (gRPC на порт `4317`, HTTP на порт `4318`), например с `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` в SDK каждого устройства.",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "`otelcol-contrib` уже есть на шлюзе? Укажите ему файл:",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. Убедитесь, что коллектор шлюза экспортирует без ошибок: проверьте его журналы на сбои экспорта и ответы HTTP `401` или `422` (`docker logs -f otel-collector`, если он работает в Docker).",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** принимает данные от ваших устройств по gRPC (`4317`) и HTTP (`4318`). Принимайте показания любым другим способом, который поддерживает коллектор (мост MQTT, файловые журналы, …), и передавайте их через тот же конвейер.",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** проставляет на каждую запись атрибуты парка. Задавайте `iot.fleet.name` (и соответствующий `service.name=iot/<fleet>`) для каждого шлюза, чтобы устройства каждого шлюза попадали в нужный парк.",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** группирует записи перед экспортом, чтобы шлюз не тратил по одному HTTP-запросу на каждое показание.",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** отправляет данные в OneUptime по HTTPS с приложенным токеном приёма. Принимаются и стандартная кодировка protobuf, и `encoding: json`.",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- Каждое показание, которое пересылает этот шлюз, уходит в парк устройств **`fleet-1`**: оставьте `iot.fleet.name` и `service.name` ровно такими, как есть, иначе показания зарегистрируют новый парк. Шлюз другого парка задаёт свои.",
  "Any MQTT client that can connect over WebSocket":
    "Любой клиент MQTT, который может подключаться по WebSocket",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "Например, с клиентом Node.js `mqtt` (`npm install mqtt`):",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Замените `building-a-sensors` и `sensor-001` именем вашего парка устройств и id устройства: OneUptime создаёт парк и устройство по топику. Last Will сообщает, что устройство отключено, как только обрывается его соединение; устройствам, которые подключаются напрямую, лучше иметь собственные учётные данные (и то и другое в разделе Расширенный).",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. Убедитесь, что клиент подключается и публикует без ошибок: отказ в подключении с кодом возврата 4 (неверное имя пользователя или пароль) означает, что ключ неверен.",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. Откройте вкладку **Устройства** парка: каждое устройство, для которого вы публиковали, должно быть в списке с последним состоянием батареи, сигнала, температуры, CPU, памяти и доступности.",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "На устройство не нужно устанавливать агент. OneUptime сопоставляет ваши устройства двум понятиям, и с MQTT оба задаёт топик:",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **Парк устройств**: `<fleet>` в `oneuptime/<fleet>/…`, логическая группа устройств (например, `building-a-sensors`). Он становится `iot.fleet.name` показаний и появляется в OneUptime как служба телеметрии `iot/<fleet>`.",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **Устройство**: `<device>` в `oneuptime/<fleet>/<device>/…`, отдельное устройство в парке. Оно становится `device.id` каждого показания, и OneUptime ведёт по нему инвентарь устройств для каждого парка.",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    'Необязательные атрибуты уточняют, как классифицируется каждое устройство и как оно выбирается в мониторах. Поместите их в словарь `"attributes"` публикации телеметрии: они проставляются на каждую точку данных этой публикации:',
  "| Attribute | Description |": "| Атрибут | Описание |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | Класс устройства, например `Device`, `Sensor` или `Gateway`. По умолчанию `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | Более точный тип или модель устройства для фильтрации мониторов (например, `temp-sensor`) |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | Версия прошивки, которую сообщает устройство |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime распознаёт следующие имена метрик `iot_*`. В MQTT топик называет устройство, поэтому каждое показание относится к нему. Отправляйте только те метрики, которые имеют смысл для вашего устройства: отсутствующие просто не отображаются.",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "Ключ приёма всего проекта подходит шлюзам, которые публикуют от имени многих устройств. Устройства, которые подключаются напрямую, регистрируйте по одному на вкладке **Реестр устройств** парка: она выдаёт учётные данные для каждого устройства; ID учётных данных — это **имя пользователя** MQTT, а секрет — **пароль**. Парк появляется с первым показанием, поэтому сначала отправьте одно с ключом проекта, как на шаге 2.",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **Изоляция топиков**: учётные данные устройства позволяют публиковать только в его собственные топики `oneuptime/<fleet>/<device>/…`; всё остальное отбрасывается.",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **Отзыв по отдельности**: отключите или удалите учётные данные одного устройства, не затрагивая остальной парк; подключённое устройство отключается за несколько секунд.",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **Обнаружение тихих отказов**: зарегистрированное устройство остаётся в инвентаре как отключённое, когда перестаёт отправлять данные, а не исчезает, даже если оно выходит из строя без Last Will.",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "Зарегистрируйте **Last Will** MQTT в `oneuptime/<fleet>/<device>/status` с полезной нагрузкой `offline`: если устройство выйдет из строя, OneUptime опубликует от его имени `iot_device_up = 0` в момент обрыва сеанса, что запустит стандартный шаблон оповещения Device Offline без опроса. Опубликуйте `online` в тот же топик после подключения, чтобы устройство снова считалось работающим; пример на шаге 2 делает и то и другое. Любое опубликованное устройством показание тоже считается признаком работы, поэтому устройство, которое продолжает отправлять показания, остаётся работающим без повторной публикации статуса. Топик статуса также принимает `1`/`0`, `true`/`false` и `up`/`down`.",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "Держите keepalive MQTT **меньше 5 минут** на конечной точке WebSocket (стандартные 60 с клиентских библиотек подходят): простаивающие соединения WebSocket закрываются через 300 секунд, что вызвало бы Last Will и ложное оповещение об отключении.",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "Публикуйте под фиксированным префиксом `oneuptime/`. Сегменты парка и устройства не могут содержать `/`, `+` или `#`, начинаться с `$` и ограничены 100 символами.",
  "| Topic | Payload |": "| Топик | Полезная нагрузка |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | JSON-объект с показаниями, `{"metrics":{"iot_temperature_celsius":21.5}}`, или плоский объект, числовые поля которого и есть метрики |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | Одно значение: просто число (`23.4`) или `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` или `offline`, переводится в `iot_device_up` |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    'Полезная нагрузка телеметрии может также содержать `"attributes"` (словарь строк, проставляемый на каждую точку данных; используйте его для `iot.device.kind`, `iot.device.type`, `iot.device.firmware` или собственных меток) и `"timestamp"` (ISO-8601 или секунды/миллисекунды Unix). Оба необязательны; без `timestamp` используется время приёма.',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "Конечная точка служит только для приёма: подписки отклоняются. Публикация ограничена 128 КБ и 100 метриками. Публикации вне этого контракта или с некорректной полезной нагрузкой принимаются и отбрасываются (в MQTT 3.1.1 нет ответа об ошибке на каждое сообщение), а OneUptime записывает в журнал предупреждение с причиной.",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "Самостоятельно размещённые установки могут дополнительно открыть чистый MQTT по TCP (`MQTT_INGEST_PORT`, по умолчанию `1883`). По умолчанию слушатель доступен только внутри сети кластера или Compose: откройте его, если ваши устройства не умеют работать с WebSocket. Ограничение keepalive для WebSocket там не действует.",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "Задайте `MQTT_INGEST_ENABLED=false` для службы приложения, чтобы отключить слушатели MQTT.",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. Убедитесь, что топик точно соответствует `oneuptime/<fleet>/<device>/…`: именно сегмент парка в топике создаёт парк.",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. Публикации вне контракта топиков или с некорректной полезной нагрузкой принимаются и отбрасываются (в MQTT 3.1.1 нет ответа об ошибке на каждое сообщение). Сравните свои с темой **Топики и полезная нагрузка MQTT** в разделе Расширенный; на самостоятельно размещённом экземпляре журналы приложения называют причину (`MQTT: dropped publish to …`).",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "OneUptime отклоняет неверные учётные данные при CONNECT с кодом возврата 4. Проверьте, что:",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- пароль является действительным ключом приёма или, для зарегистрированного устройства, секретом учётных данных, а их ID указан как имя пользователя;",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- ключ является серверным (ключи браузера по MQTT отклоняются) и не отключён и не истёк.",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. Id устройства — это сегмент `<device>` топика: не меняйте его между публикациями; меняющийся id создаёт повторяющиеся строки устройств.",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. Публикуйте `iot_device_info` (только идентификация) или сообщение `status` для устройств, которые ещё не прислали показаний, чтобы они всё равно появились в инвентаре.",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "На конечной точке WebSocket простаивающие соединения закрываются через 300 секунд, что вызывает Last Will и ложное оповещение Device Offline. Держите keepalive MQTT меньше 5 минут; стандартные 60 с клиентских библиотек подходят.",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "Замените `sensor-001` на id устройства: OneUptime добавит устройство в парк устройств **`fleet-1`** по топику. Last Will сообщает, что устройство отключено, как только обрывается его соединение; устройствам, которые подключаются напрямую, лучше иметь собственные учётные данные (и то и другое в разделе Расширенный).",
};

export default TRANSLATION;
