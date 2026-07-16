# OneUptime IoT 设备

## 概述

OneUptime 通过采集标准的 OpenTelemetry (OTLP) 指标来监控 IoT 设备机群——传感器、网关、控制器和边缘盒子。每台设备（或代表它的网关）通过 OTLP HTTP 推送一小组 `iot_*` 指标，并标注它所属的**机群**及其自身的**设备 id**。OneUptime 将这些指标归入一个机群，构建实时设备清单，并跟踪每台设备的电量、连接性、温度、CPU、内存和可用性。

设备端无需安装任何代理——任何能够使用 OTLP 通信的组件（设备上的 OpenTelemetry SDK，或运行在网关上、向多台设备扇出的 OpenTelemetry Collector）都可以工作。本页是**采集指南**。关于在你推送的数据之上配置 IoT 监控器和告警，请参阅 [IoT 设备监控器](/docs/monitor/iot-device-monitor)。

## 前提条件

- 一台能够向 OneUptime 发送 OTLP/HTTP 的设备、网关或采集器
- 设备/网关到你的 OneUptime 实例的网络可达性
- 一个 **OneUptime 遥测采集令牌**——从 _Project Settings → Telemetry Ingestion Keys_ 创建一个，并复制 `x-oneuptime-token` 的值

## OneUptime 如何对 IoT 建模

OneUptime 使用 OpenTelemetry 资源属性将你的设备映射到两个概念上：

- **机群（Fleet）**——一组设备的逻辑分组（例如 `building-a-sensors` 或 `field-gateways`）。机群由 `iot.fleet.name` 资源属性派生，并在 OneUptime 中显示为遥测服务 `iot/<fleet>`。请设置 `service.name=iot/<fleet>`，以便日志和指标归在同一个服务下。
- **设备（Device）**——机群内的单台设备，由 `device.id` 属性标识。OneUptime 以 `device.id` 为键构建并维护每个机群的设备清单。

可选属性可以进一步细化每台设备在监控器中的分类和范围划分方式：

| 属性                  | 是否必需 | 描述                                                                              |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `iot.fleet.name`     | 是       | 该设备所属的机群。会成为 OneUptime 服务 `iot/<fleet>`                              |
| `device.id`          | 是       | 机群内设备的稳定且唯一的 id                                                        |
| `iot.device.kind`    | 否       | 设备类别——例如 `Device`、`Sensor` 或 `Gateway`。默认为 `Device`                   |
| `iot.device.type`    | 否       | 用于过滤监控器的更细粒度设备类型/型号（例如 `temp-sensor`）                         |
| `iot.device.firmware`| 否       | 设备上报的固件版本                                                                 |

## 通过 OpenTelemetry SDK 发送指标

如果你的设备直接运行 OpenTelemetry SDK，请将其指向 OneUptime，并通过标准的 `OTEL_*` 环境变量打上 IoT 资源属性。请将令牌、端点、机群名称和设备 id 替换为适合你环境的值。

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
```

| 环境变量                       | 是否必需 | 描述                                                                                                  |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 是       | OneUptime OTLP 端点（`https://oneuptime.com/otlp`，自托管时为 `http(s)://YOUR-ONEUPTIME-HOST/otlp`） |
| `OTEL_EXPORTER_OTLP_HEADERS`  | 是       | `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`                                                    |
| `OTEL_RESOURCE_ATTRIBUTES`    | 是       | 逗号分隔的资源属性。必须包含 `iot.fleet.name`、`device.id` 和 `service.name=iot/<fleet>`               |

使用下面的 `iot_*` 名称将你的读数作为指标发出（参阅[指标约定](#指标约定)）。大约一分钟内，设备会出现在 OneUptime 仪表板的 **IoT** 区域。

## 通过 OpenTelemetry Collector 发送指标

当许多设备通过网关上报时，在网关上运行一个 OpenTelemetry Collector 并导出到 OneUptime。`resource` 处理器负责打上机群属性；从你的设备接收读数（OTLP、MQTT 桥接、文件日志等）并将其转发出去：

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
    # OneUptime 要求使用 JSON 编码器，而不是默认的 Proto(buf)
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

- **`resource`** 为每条记录打上机群属性。请为每个网关设置 `iot.fleet.name`（以及匹配的 `service.name=iot/<fleet>`），使每个网关的设备落入正确的机群。
- 在每个数据点上保留 `device.id`（可选保留 `iot.device.kind` / `iot.device.type` / `iot.device.firmware`），以便 OneUptime 能在机群内解析出单台设备。
- **`otlphttp`** 通过 HTTPS 携带采集令牌发送到 OneUptime。请注意 `encoding: json` 和 `Content-Type: application/json` 请求头是必需的。

## 通过 MQTT 发送指标

OneUptime 内置了 MQTT 端点，因此已经能够使用 MQTT 通信的设备可以直接推送读数——无需 OpenTelemetry SDK、采集器或桥接。通过 MQTT 发布的一切都会进入与 OTLP 相同的管道：机群会被自动创建，设备清单会更新，每个 IoT 监控器和告警模板都无需改动即可工作。

**端点**

| 传输方式               | 地址                                     | 说明                                                                                       |
| --------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| MQTT over WebSocket   | `wss://<your-host>/mqtt`                | 在每种部署上都可用——通过 OneUptime ingress 走常规的 HTTPS 端口                              |
| MQTT over TCP         | `<app-host>:1883`（`MQTT_INGEST_PORT`）  | 自托管：默认仅在集群/compose 网络内部可用；如果你需要，请自行将其暴露出来                     |

**认证**——有两种方式：

- **项目级**：将你的**遥测采集令牌**作为 MQTT 密码发送（用户名会被忽略；如果你的客户端只暴露了用户名字段，请改为把令牌填在那里）。适合代表多台设备发布数据的网关。
- **按设备**（推荐用于直接连接的设备）：在仪表板中该机群的 **Device Registry** 标签页下注册设备。注册会签发一份按设备的凭据——凭据 ID 即 MQTT **用户名**，密钥即**密码**。使用设备认证的客户端只能在它们自己的 `oneuptime/<fleet>/<device>/…` 主题下发布；单台被攻破的设备可以从仪表板吊销，而不影响机群中的其余设备（吊销大约在一分钟内生效，即使对于已连接的会话也是如此）；并且已注册的设备还能获得**静默死亡离线检测**：当它们停止上报时，会以 Offline 状态留在清单中而不是消失，并且即使它们在没有 Last Will 的情况下死亡，设备离线告警模板也会为它们触发。

无效的凭据会在 CONNECT 时以返回码 4（用户名或密码错误）被拒绝，因此配置错误的设备会明确地失败。

**主题**——在固定的 `oneuptime/` 前缀下发布。机群段和设备段不得包含 `/`、`+` 或 `#`，且限制为 100 个字符：

| 主题                                              | 负载                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `oneuptime/<fleet>/<device>/telemetry`           | 读数的 JSON 对象——`{ "metrics": { "iot_temperature_celsius": 21.5 } }`，或一个扁平对象，其数值字段即为指标 |
| `oneuptime/<fleet>/<device>/metrics/<metricName>`| 单个值——一个裸数字（`23.4`）或 `{ "value": 23.4 }`                                                     |
| `oneuptime/<fleet>/<device>/status`              | `"online"` 或 `"offline"`（也可用 `1`/`0`、`true`/`false`、`up`/`down`）——映射到 `iot_device_up`        |

遥测负载还可以携带 `"attributes"`（一个打在每个数据点上的字符串映射——可用它来传 `iot.device.kind`、`iot.device.type`、`iot.device.firmware` 或你自己的标签）和 `"timestamp"`（ISO-8601，或 unix 秒/毫秒）。两者都是可选的；缺少 `timestamp` 时使用采集时间。

**使用 Last Will 进行离线检测**——在 `oneuptime/<fleet>/<device>/status` 上注册一个负载为 `offline` 的 MQTT Last Will。如果设备死亡或从网络上掉线，broker 会在会话结束的那一刻代表它发布 `iot_device_up = 0`——这会触发内置的**设备离线**告警模板，并将设备在清单中翻转为 Down，无需轮询，也无需等待一次错过的抓取。连接之后向同一主题发布 `online`，设备便会再次显示为 Up。

使用 `mosquitto_pub` 的示例（原始 TCP，自托管）：

```bash
mosquitto_pub -h YOUR-ONEUPTIME-APP-HOST -p 1883 \
  -u oneuptime -P "YOUR_TELEMETRY_INGESTION_TOKEN" \
  -t "oneuptime/building-a-sensors/sensor-001/telemetry" \
  -m '{"metrics":{"iot_device_up":1,"iot_battery_percent":87,"iot_temperature_celsius":21.5},"attributes":{"iot.device.type":"temp-sensor","iot.device.firmware":"1.4.2"}}'
```

使用 Node.js `mqtt` over WebSocket 的示例（适用于 oneuptime.com 和任何自托管实例）：

```javascript
const mqtt = require("mqtt");

const client = mqtt.connect("wss://oneuptime.com/mqtt", {
  username: "oneuptime", // 会被忽略——真正用于认证的是下面的令牌
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

使用 Python `paho-mqtt` over WebSocket 的示例：

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

注意事项：

- 该端点**仅用于采集**：订阅会被拒绝（SUBACK 失败）。如果你希望 broker 确认收到，请使用 QoS 1。采集是**至少一次**的——在确认丢失后进行的 QoS 1/2 重传可能产生重复的数据点。
- 在主题约定之外的发布，或负载格式错误的发布，会被接受并**丢弃**（MQTT 3.1.1 没有逐条消息的错误回复）——服务器会记录一条带有原因的警告，因此如果数据没有到达，请检查 OneUptime 应用日志。
- 在 WebSocket 端点上，请将 MQTT keepalive 保持在 **5 分钟以内**——OneUptime ingress 会在 300 秒后关闭空闲的 WebSocket 连接，这会触发你的 Last Will 以及一条虚假的设备离线告警。客户端库的默认值（`mqtt` 和 `paho-mqtt` 均为 60 秒）没有问题。原始 TCP 端点没有这一上限。
- 负载上限为 128 KB，且每次发布最多 100 个指标；超大的数据包会导致连接断开。

## 指标约定

OneUptime 识别以下 `iot_*` 指标名称。每个数据点都应带有 `device.id` 标签，以便将读数归因到正确的设备。你只需发送对你的设备有意义的指标——缺失的指标只是不会被绘制成图表。

| 指标名称                     | 含义                                                                            |
| --------------------------- | ------------------------------------------------------------------------------ |
| `iot_device_up`             | 设备可用性。`1` = 在线/可达，`0` = 离线。驱动 IoT 设备监控器                       |
| `iot_device_info`           | 仅身份信号。携带 `device.id` / kind / type / firmware，使设备即使尚未上报读数也能出现在清单中 |
| `iot_battery_percent`       | 电池电量水平，`0`–`100`（%）                                                     |
| `iot_signal_strength_dbm`   | 无线信号强度，单位 dBm（例如 Wi-Fi / LoRa / 蜂窝 RSSI）                          |
| `iot_temperature_celsius`   | 设备或传感器温度，单位 °C                                                        |
| `iot_cpu_usage_ratio`       | CPU 利用率，以 `0`–`1` 的比率表示（OneUptime 将其存储为百分比）                  |
| `iot_memory_usage_bytes`    | 当前已使用内存，单位 bytes                                                       |
| `iot_memory_size_bytes`     | 设备上的可用内存总量，单位 bytes                                                 |
| `iot_uptime_seconds`        | 自设备上次启动以来的秒数                                                         |

## 验证安装

1. 确认你的设备或网关导出时没有错误（检查 SDK/采集器日志中是否有导出失败以及 HTTP `401`/`403` 响应）。
2. 在 OneUptime 仪表板中，打开 **IoT** 区域——你的机群应在大约一分钟内以 `iot/<fleet>` 的形式出现。
3. 打开机群的 **Devices** 标签页——你发送的每个 `device.id` 都应被列出，并显示其最新的电量、信号、温度、CPU、内存和在线/离线状态。
4. 打开机群下的 **Metrics**，绘制上述任意 `iot_*` 序列。

## 故障排查

### 机群未出现

1. 验证 `iot.fleet.name` 被设置为**资源**属性（而非数据点标签），且 `service.name` 为 `iot/<fleet>`。
2. 确认导出器端点为 `https://oneuptime.com/otlp`（或你自托管的 `…/otlp`），且 `x-oneuptime-token` 请求头携带了有效令牌。
3. 如果使用采集器，请确保在 `otlphttp` 导出器上设置了 `encoding: json` 和 `Content-Type: application/json`。

### 设备未出现在清单中

1. 确保每个数据点都带有 `device.id` 标签——设备以它为键。
2. 对尚未上报读数的设备发送 `iot_device_info`（仅身份），使它们仍能显示在清单中。
3. 检查 `device.id` 的值在各次上报之间保持稳定；变化的 id 会创建重复的设备行。

### 导出器返回 HTTP 401 / 403

采集令牌无效、已吊销或缺失。请从 _Project Settings → Telemetry Ingestion Keys_ 生成一个新令牌，并更新 `x-oneuptime-token` 请求头。

### 指标未绘制成图表

1. 确认你使用的是[指标约定](#指标约定)表中精确的 `iot_*` 指标名称——无法识别的名称会作为通用指标存储，不会填充 IoT 图表。
2. 请记住 `iot_cpu_usage_ratio` 是一个 `0`–`1` 的比率；发送原始比率，OneUptime 会将其渲染为百分比。
3. 设备开始上报后，首批数据点最多需要一分钟才会显现。

## 自托管 OneUptime

如果你正在自托管 OneUptime，请将端点指向你自己的实例：

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://your-oneuptime-host.example.com/otlp
```

或者，在采集器中：

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

如果你的实例仅支持 HTTP，请将协议改为 `http://` 并使用相应的端口。

## 后续步骤

- 配置一个 **IoT 设备监控器**，以在设备离线、电量低、信号弱、温度高和 CPU 高等情况下告警——参阅 [IoT 设备监控器](/docs/monitor/iot-device-monitor)。
- 对于非容器化主机（Linux / macOS / Windows 虚拟机和裸机），请使用[主机 OpenTelemetry Collector](/docs/telemetry/host-otel-collector)。
- 要深入了解底层的 OTLP 集成，请参阅[将 OpenTelemetry 与 OneUptime 集成](/docs/telemetry/open-telemetry)。
