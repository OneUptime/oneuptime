import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in Simplified Chinese (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * Simplified Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Simplified Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "运行 OpenTelemetry SDK 并通过 HTTP 导出 OTLP 的设备",
  "Network access from the device to your OneUptime instance":
    "设备到你的 OneUptime 实例的网络访问",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "将 `building-a-sensors` 和 `sensor-001` 替换为你的设备群名称和设备 id。请保持 `iot.fleet.name` 不变：更改它会注册一个全新的设备群。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中选择一个摄取密钥，以填入 `<YOUR_API_KEY>`。",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "将读数作为按照 `iot_*` 约定命名的指标发出，并为每个数据点加上 `device.id` 属性，例如：",
  "| Metric | Value | Datapoint attribute |": "| 指标 | 值 | 数据点属性 |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "设备清单以数据点的 `device.id` 为键，而不是资源的，所以除了在 `OTEL_RESOURCE_ATTRIBUTES` 中设置，还要在每次测量上设置它。所有可识别的名称都在“高级”中的 **指标约定** 里。",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. 确认设备导出时没有错误：检查 SDK 日志中的导出失败以及 HTTP `401` 或 `422` 响应。",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. 在 OneUptime 仪表板中打开 **IoT** 部分：你的设备群应在一分钟左右出现。",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. 打开设备群的 **设备** 选项卡：你发送的每个 `device.id` 都应列出，并带有最新的电池、信号、温度、CPU、内存和在线/离线状态。",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. 打开设备群下的 **指标**，为任意 `iot_*` 序列绘制图表。",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "设备上无需安装任何代理。OneUptime 使用 OpenTelemetry 属性把你的设备映射到两个概念：",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **设备群**：一组逻辑上的设备（例如 `building-a-sensors` 或 `field-gateways`）。设备群由资源属性 `iot.fleet.name` 得出，并在 OneUptime 中显示为遥测服务 `iot/<fleet>`。请设置 `service.name=iot/<fleet>`，让日志和指标归到同一个服务下。",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **设备**：设备群中的单个设备，由每个数据点上的 `device.id` 属性标识。OneUptime 会以 `device.id` 为键，为每个设备群建立并维护设备清单。",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "OneUptime 读取的属性；可选属性用于细化每个设备的分类以及在监控中的范围：",
  "| Attribute | Set on | Required | Description |":
    "| 属性 | 设置位置 | 必填 | 说明 |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | 资源 | 是 | 此设备所属的设备群。会成为 OneUptime 服务 `iot/<fleet>` |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | 每个数据点 | 是 | 设备在设备群内稳定且唯一的 id |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | 每个数据点 | 否 | 设备类别，例如 `Device`、`Sensor` 或 `Gateway`。默认为 `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | 每个数据点 | 否 | 更细的设备类型或型号，用于筛选监控（例如 `temp-sensor`） |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | 每个数据点 | 否 | 设备上报的固件版本 |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime 可识别以下 `iot_*` 指标名称。每个数据点都应带有 `device.id` 标签，这样读数才会归到正确的设备。你只需发送对你的设备有意义的指标，缺少的指标只是不会绘制出来。",
  "| Metric Name | Meaning |": "| 指标名称 | 含义 |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | 设备可用性。`1` = 在线/可达，`0` = 离线。驱动 IoT 设备监控 |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | 仅含身份信息的信号。携带 `device.id` / 类别 / 类型 / 固件，使设备在上报读数之前就出现在清单中 |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | 电池电量，`0`–`100`（%） |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | 无线信号强度，单位 dBm（例如 Wi-Fi / LoRa / 蜂窝网络 RSSI） |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | 设备或传感器温度，单位 °C |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | CPU 使用率，比例为 `0`–`1`（设备清单以百分比显示） |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | 当前已用内存，单位字节 |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | 设备可用的总内存，单位字节 |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | 设备自上次启动以来的秒数 |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. 确认 `iot.fleet.name` 是作为 **资源** 属性（而不是数据点标签）设置的，并且 `service.name` 为 `iot/<fleet>`。",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. 确认导出器端点为 `<YOUR_ONEUPTIME_URL>/otlp`，并且 `x-oneuptime-token` 标头带有有效的摄取密钥。",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. 确保每个数据点都带有 `device.id` 标签：设备以它为键。",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. 对尚未上报读数的设备，发送 `iot_device_info`（仅身份信息），让它们仍然出现在清单中。",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. 检查 `device.id` 的值在各次上报之间保持不变；id 变化会产生重复的设备行。",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401` 表示摄取密钥缺失、错误或已过期；`422` 表示它已被禁用，或是无法发送设备遥测的浏览器密钥。请在上方选择其他密钥（或新建一个），并更新你的设备或收集器发送的 `x-oneuptime-token` 标头。",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. 使用“高级”中 **指标约定** 里的确切 `iot_*` 指标名称：其他名称会作为通用指标存储，不会填充 IoT 图表。",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` 是 `0`–`1` 的比例；直接发送原始比例，OneUptime 会以百分比显示。",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. 设备开始上报后，最多等待一分钟，首批数据点才会出现。",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "这会将读数发送到设备群 **`fleet-1`**。将 `sensor-001` 替换为设备的 id，并让 `iot.fleet.name` 保持原样：其他名称会注册一个新的设备群。",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "能够运行 OpenTelemetry Collector 的网关（使用 Docker 或 `otelcol-contrib` 二进制文件）",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "向网关发送 OTLP 的设备，以及网关到你的 OneUptime 实例的网络访问",
  "Save this as `config.yaml` on the gateway:":
    "将以下内容另存为网关上的 `config.yaml`：",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- 为每个网关设置 `iot.fleet.name`（以及对应的 `service.name=iot/<fleet>`），让每个网关的设备进入正确的设备群。",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- 在每个数据点上保留 `device.id`（以及可选的 `iot.device.kind` / `iot.device.type` / `iot.device.firmware`），以便 OneUptime 在设备群中识别出单个设备。",
  "Run it from the directory that holds `config.yaml`:":
    "在包含 `config.yaml` 的目录中运行它：",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "之后设备向网关发送 OTLP（gRPC 使用端口 `4317`，HTTP 使用端口 `4318`），例如在每个设备的 SDK 中设置 `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318`。",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "网关上已经有 `otelcol-contrib`？将它指向该文件：",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. 确认网关的收集器导出时没有错误：检查其日志中的导出失败以及 HTTP `401` 或 `422` 响应（在 Docker 中运行时使用 `docker logs -f otel-collector`）。",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** 通过 gRPC（`4317`）和 HTTP（`4318`）接收来自设备的数据。也可以用收集器支持的其他任何方式（MQTT 桥接、文件日志……）接收读数，再经由同一条管道转发。",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** 为每条记录加上设备群属性。为每个网关设置 `iot.fleet.name`（以及对应的 `service.name=iot/<fleet>`），让每个网关的设备进入正确的设备群。",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** 在导出前将记录分批，使网关不必为每个读数各做一次 HTTP 往返。",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** 通过 HTTPS 发送到 OneUptime，并附带摄取令牌。默认的 protobuf 编码和 `encoding: json` 都可接受。",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- 此网关转发的每个读数都会进入设备群 **`fleet-1`**：请让 `iot.fleet.name` 和 `service.name` 保持原样，否则读数会注册一个新的设备群。其他设备群的网关设置自己的值。",
  "Any MQTT client that can connect over WebSocket":
    "任何能够通过 WebSocket 连接的 MQTT 客户端",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "例如，使用 Node.js 的 `mqtt` 客户端（`npm install mqtt`）：",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "将 `building-a-sensors` 和 `sensor-001` 替换为你的设备群名称和设备 id：OneUptime 会根据主题创建设备群和设备。连接一断开，Last Will 就会报告设备离线；直接连接的设备最好使用自己的凭据（两者都在“高级”中）。",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. 确认客户端连接和发布时没有错误：连接被拒绝且返回码为 4（用户名或密码错误）表示密钥错误。",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. 打开设备群的 **设备** 选项卡：你为其发布过的每个设备都应列出，并带有最新的电池、信号、温度、CPU、内存和在线/离线状态。",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "设备上无需安装任何代理。OneUptime 把你的设备映射到两个概念，而使用 MQTT 时，主题决定了这两者：",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **设备群**：`oneuptime/<fleet>/…` 中的 `<fleet>`，即一组逻辑上的设备（例如 `building-a-sensors`）。它会成为读数的 `iot.fleet.name`，并在 OneUptime 中显示为遥测服务 `iot/<fleet>`。",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **设备**：`oneuptime/<fleet>/<device>/…` 中的 `<device>`，即设备群中的单个设备。它会成为每个读数的 `device.id`，OneUptime 会以它为键，为每个设备群建立并维护设备清单。",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    '可选属性用于细化每个设备的分类以及在监控中的范围。把它们放进遥测发布的 `"attributes"` 映射中：它们会加到该次发布的每个数据点上：',
  "| Attribute | Description |": "| 属性 | 说明 |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | 设备类别，例如 `Device`、`Sensor` 或 `Gateway`。默认为 `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | 更细的设备类型或型号，用于筛选监控（例如 `temp-sensor`） |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | 设备上报的固件版本 |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime 可识别以下 `iot_*` 指标名称。通过 MQTT 时，主题会指明设备，因此每个读数都归到该设备。你只需发送对你的设备有意义的指标，缺少的指标只是不会绘制出来。",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "项目级摄取密钥适合代表众多设备发布的网关。对于直接连接的设备，请在设备群的 **设备注册表** 选项卡中逐个注册：它会为每个设备签发凭据，凭据 ID 是 MQTT **用户名**，密钥是 **密码**。设备群会随第一个读数出现，所以请先用项目级密钥发送一个读数，如第 2 步所示。",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **主题隔离**：设备凭据只能在其自己的 `oneuptime/<fleet>/<device>/…` 主题下发布；其他一切都会被丢弃。",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **单独撤销**：禁用或删除某个设备的凭据，不影响设备群中的其他设备；已连接的设备会在几秒内被断开。",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **静默故障离线检测**：已注册的设备停止上报后，会以离线状态留在清单中，而不是消失，即使它在没有 Last Will 的情况下停止运行也是如此。",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "在 `oneuptime/<fleet>/<device>/status` 上注册一个 MQTT **Last Will**，负载为 `offline`：如果设备停止运行，OneUptime 会在会话断开的那一刻代它发布 `iot_device_up = 0`，从而无需轮询就触发内置的 Device Offline 警报模板。连接后向同一主题发布 `online`，设备就会重新显示为在线；第 2 步中的示例两者都做了。设备发布的任何读数也都算作在线，所以持续发送读数的设备无需再次发布状态就会保持在线。状态主题还接受 `1`/`0`、`true`/`false` 以及 `up`/`down`。",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "在 WebSocket 端点上，请将 MQTT keepalive 保持在 **5 分钟以内**（客户端库默认的 60 秒即可）：空闲的 WebSocket 连接会在 300 秒后关闭，这会触发 Last Will 以及错误的离线警报。",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "在固定前缀 `oneuptime/` 下发布。设备群和设备段不能包含 `/`、`+` 或 `#`，也不能以 `$` 开头，并且限制为 100 个字符。",
  "| Topic | Payload |": "| 主题 | 负载 |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | 读数的 JSON 对象（`{"metrics":{"iot_temperature_celsius":21.5}}`），或数值字段即为指标的扁平对象 |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | 单个值：纯数字（`23.4`）或 `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` 或 `offline`，对应 `iot_device_up` |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    '遥测负载还可以带有 `"attributes"`（加到每个数据点上的字符串映射；可用于 `iot.device.kind`、`iot.device.type`、`iot.device.firmware` 或你自己的标签）和 `"timestamp"`（ISO-8601，或 Unix 秒/毫秒）。两者都是可选的；缺少 `timestamp` 时使用摄取时间。',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "该端点只用于摄取：订阅会被拒绝。每次发布限制为 128 KB 和 100 个指标。超出此约定或负载格式错误的发布会被接受后丢弃（MQTT 3.1.1 没有逐条消息的错误回复），OneUptime 会记录一条带原因的警告。",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "自托管部署还可以额外开放原始 MQTT over TCP（`MQTT_INGEST_PORT`，默认 `1883`）。该监听器默认只在集群或 Compose 网络内部可用：如果你的设备无法使用 WebSocket，请将其开放。WebSocket 的 keepalive 上限在那里不适用。",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "在应用服务上设置 `MQTT_INGEST_ENABLED=false` 可关闭 MQTT 监听器。",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. 确认主题严格遵循 `oneuptime/<fleet>/<device>/…`：创建设备群的是主题中的设备群段。",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. 超出主题约定或负载格式错误的发布会被接受后丢弃（MQTT 3.1.1 没有逐条消息的错误回复）。请将你的发布与“高级”中的 **MQTT 主题和负载** 对照；在自托管实例上，应用日志会写明原因（`MQTT: dropped publish to …`）。",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "OneUptime 会在 CONNECT 时以返回码 4 拒绝错误的凭据。请检查：",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- 密码是有效的摄取密钥，或者对于已注册的设备，是凭据的密钥，并以凭据 ID 作为用户名；",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- 该密钥是服务器密钥（浏览器密钥会被 MQTT 拒绝），且未被禁用或过期。",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. 设备 id 是主题中的 `<device>` 段：在各次发布之间保持它不变；id 变化会产生重复的设备行。",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. 对尚未上报读数的设备，发布 `iot_device_info`（仅身份信息）或一条 `status` 消息，让它们仍然出现在清单中。",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "在 WebSocket 端点上，空闲连接会在 300 秒后关闭，这会触发 Last Will 以及错误的 Device Offline 警报。请将 MQTT keepalive 保持在 5 分钟以内；客户端库默认的 60 秒即可。",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "将 `sensor-001` 替换为设备的 id：OneUptime 会根据主题把设备加入设备群 **`fleet-1`**。连接一断开，Last Will 就会报告设备离线；直接连接的设备最好使用自己的凭据（两者都在“高级”中）。",
};

export default TRANSLATION;
