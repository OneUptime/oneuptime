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

使用下面的 `iot_*` 名称将你的读数作为指标发出（参阅[指标约定](#metric-conventions)）。大约一分钟内，设备会出现在 OneUptime 仪表板的 **IoT** 区域。

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

1. 确认你使用的是[指标约定](#metric-conventions)表中精确的 `iot_*` 指标名称——无法识别的名称会作为通用指标存储，不会填充 IoT 图表。
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
