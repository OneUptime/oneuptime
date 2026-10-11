# 网络设备厂商指南(Sophos、Extreme、Cambium)

如何用 OneUptime 端到端地监控三种常见环境：带 IPsec 隧道、WAN 链路和 SD-WAN 的 Sophos Firewall（XGS、SFOS）；带 Fabric 的 Extreme Networks 交换机（EXOS / Switch Engine 和 Fabric Engine / VOSS）；以及 Cambium Networks cnMatrix 交换机和 Enterprise Wi-Fi 接入点，细到每个射频的信道和发射功率。

:::cards
- [Sophos Firewall](#sophos-firewall-xgs-sfos): 隧道、WAN 链路、网关和 SD-WAN。
- [Extreme Networks](#extreme-networks-exos-switch-engine-和-fabric-engine-voss): 交换机、Fabric 及其硬件。
- [Cambium Networks](#cambium-networks-enterprise-wi-fi-和-cnmatrix): 细到每个射频的接入点，以及 cnMatrix 交换机。
:::

## 工作原理

每份指南都使用相同的组成部分：

```mermaid title="每份厂商指南使用的组成部分"
flowchart TB
    Device["防火墙、交换机或<br/>接入点"]
    Probe["探测器"]
    Snmp["厂商模板：<br/>健康 OID 和 SNMP 表"]
    Syslog["Syslog：日志管道、<br/>日志监视器、记录规则"]
    Monitor["带推荐警报的<br/>Network Device 监视器"]
    Incident["事件和警报"]
    Device -->|"SNMP"| Probe
    Device -->|"Syslog 和 Trap"| Probe
    Probe --> Snmp
    Probe --> Syslog
    Snmp --> Monitor
    Monitor --> Incident
    Syslog --> Incident
```

- 每台设备一个[网络设备](/docs/monitor/network-device-monitor)，由能到达它的探测器轮询，并带有一个厂商模板，提供合适的健康 OID 和 [SNMP 表](/docs/monitor/network-device-monitor#snmp-表)。
- 每台设备一个用于警报的 Network Device 监视器。从设备页面创建它，[推荐警报](/docs/monitor/network-device-monitor#推荐警报包)就会自动填好，其中包括为每个知道何为健康的表设置的按行警报。对于设备群，[警报策略](/docs/monitor/network-device-monitor#警报策略)会在每台设备上维持一个监视器。
- 对于厂商只在日志中报告的内容：发送到探测器的 syslog、把每一行转换为属性的[日志管道](/docs/telemetry/log-pipelines)、按隧道或网关各发一次警报的[带 Group By 的日志监视器](/docs/monitor/logs-monitor#按分组告警group-by)，以及把这些日志中的数字绘制成图表的[日志记录规则](/docs/telemetry/log-recording-rules)。

## Sophos Firewall (XGS / SFOS)

| 你想看到的 | 来自哪里 |
| --- | --- |
| 防火墙健康状况：内存、磁盘、交换空间、HA 状态、IPsec 服务、每个核心的 CPU | SNMP，使用 **Sophos Firewall (SFOS / XGS)** 厂商模板 |
| 每条 IPsec 隧道的状态，按名称 | SNMP 表 `ipsec_tunnels`（SFOS v20 及更高版本） |
| 每条 WAN 链路的状态、吞吐量、利用率和错误 | WAN 端口的接口遍历 |
| 每条 WAN 链路的延迟、丢包率和抖动 | 来自 OneUptime 探测器的 Ping 监视器和设备轮询 |
| 网关上线和下线、SD-WAN SLA 是否达标、SD-WAN 路由变化 | 防火墙的 syslog |
| 每个网关的 SD-WAN 延迟、抖动和丢包率图表 | 基于 SD-WAN SLA 日志的日志记录规则 |

无论哪个 SFOS 版本，Sophos 都不通过 SNMP 报告网关或 SD-WAN 的健康状况：这些信息只存在于防火墙的日志和 Sophos Central 的警报中，所以最后三行要通过 syslog 实现。

### 注册防火墙

:::steps
1. 在防火墙上，在 **Administration → SNMP** 下开启 SNMP：添加一个 SNMPv3 用户或 v2c 团体字符串，并允许探测器的地址查询它。
2. 在 OneUptime 中，前往**网络 → Devices**，点击 **Add Device**。输入防火墙的管理地址，选择一个能到达它的探测器，并在 **SNMP** 下添加 SNMP 凭据。
3. 在设备的**设置**页面上，在 **Polling & Data Collection** 下，从 **Vendor Health Template** 应用 **Sophos Firewall (SFOS / XGS)** 模板，并从 **Add a Vendor's Tables** 添加其表。或者开启 **Auto-Apply Vendor Health Template**，首次轮询会同时完成这两项。
:::

下一次轮询后，设备的 **SNMP Tables** 页面会列出每个 IPsec 连接及其状态（active、inactive、partially active），以及各个 CPU 核心。SFOS 从 196608 开始为其核心编号，这就是 CPU 来自表而不是单个 `hrProcessorLoad.1` 的原因。

### 对每条 IPsec 隧道发出警报

在设备页面上点击**创建监视器**。推荐警报包括 **IPsec Tunnels: row unhealthy**，即在 `ipsec_tunnels` 表上 Row 为 `*` 的 **SNMP Table Row Is Unhealthy** 条件：它为每条非 active 的隧道打开一个以隧道命名的事件，并在隧道恢复时逐个解决。

Sophos 报告为 active 的隧道只说明其安全关联已建立。要证明有流量通过，请从一个站点的探测器向每条隧道对端的主机添加 [Ping 监视器](/docs/monitor/ping-monitor)，并在**网络 → 拓扑 → Site Links** 下把隧道绘制为两个[站点](/docs/monitor/network-sites)之间的站点链路，绑定到该监视器：地图上的链路随后会显示该监视器的颜色。

### WAN 链路

- **端口健康状况。** 接口遍历已经测量了每个 WAN 端口的状态、入站和出站比特、利用率和错误。在防火墙的监视器上，将**接口**设为 WAN 端口名称（或设为 `*` 表示每个端口）的 **SNMP Interface Is Down** 或 **SNMP Interface Utilization (in %)** 条件会按链路发出警报。
- **路径质量。** 每条链路的延迟、丢包率和抖动从防火墙外部测量：从 OneUptime 云探测器到每条 WAN 链路公网地址的 Ping 监视器，以及从站点的探测器到每个 ISP 网关的 Ping 监视器。这些监视器上的丢包率和抖动条件会按链路发出警报，**网络 → 拓扑 → Latency Matrix** 则可以一眼看到每个探测器与每个监视器的对比。
- **流量。** SFOS 导出 NetFlow v5。把它发送到探测器的 UDP 2055（探测器的流收集器默认在此监听），设备的 **Traffic** 页面就会显示每条 WAN 链路上谁在和谁通信；详情见[网络流量](/docs/monitor/network-traffic)。

### 从 syslog 获取网关和 SD-WAN 信息

:::steps
1. 开启探测器的 syslog 接收器：在探测器上设置 `PROBE_SYSLOG_RECEIVER_ENABLED=true`。它默认监听 UDP 5140（可用 `PROBE_SYSLOG_RECEIVER_PORT` 更改）；如果探测器运行在 Docker 中，请发布该端口。消息会匹配到主机名或某个**其他地址**是发送方地址的网络设备，并显示在设备的**日志**页面上。
2. 在防火墙上，在 **System services → Log settings** 下添加指向探测器和该端口的 syslog 服务器，并勾选 IPsec 和网关的 **Event** 日志类型以及 **SD-WAN** 日志类型：在勾选之前，SLA 日志一直处于关闭状态。
3. 在**日志 → 设置 → 管道**下，创建一个过滤条件匹配防火墙日志的管道，例如 `attributes.networkDevice.name = 'hq-firewall'`，并添加一个 **Target Prefix** 为 `sophos` 的 **Key=Value Parser**。把防火墙的一行日志粘贴到其测试器中，即可看到你的 SFOS 版本生成的确切属性名称；[Sophos 示例](/docs/telemetry/log-pipelines#示例sophos-xgs-防火墙)对此有逐步说明。
4. 在防火墙的日志上创建[日志监视器](/docs/monitor/logs-monitor)，每个都设置 **Group by Attributes**，让每条隧道或每个网关单独发出警报，条件为在几分钟内 **Log Count** **Greater Than** `0`。下表中的三行是可以先建立的监视器。
5. 绘制 SD-WAN 质量图表：开启 SD-WAN 日志后，防火墙会按配置文件和网关写入 SLA 摘要（`latency`、`jitter`、`packet_loss`）。在**日志 → 设置 → 记录规则**下，为每个数字创建一条规则，例如按 `sophos.gw_name` 和 `sophos.profile_name` 分组的 `sophos.latency` 平均值，然后绘制结果图表，或用按网关分组的 [Metrics 监视器](/docs/monitor/metrics-monitor)对其发出警报。[日志记录规则](/docs/telemetry/log-recording-rules)逐步讲解了这个示例。
:::

| 警报 | 要统计的日志 | 分组依据 |
| --- | --- | --- |
| IPsec 隧道终止 | 属性 `sophos.log_component` = `IPSec`，正文包含 `terminated` | `sophos.con_name` |
| 网关宕机 | 属性 `sophos.log_component` = `Gateway`，正文包含 `is Down` | `sophos.gatewayname` |
| SD-WAN SLA 未达标 | 属性 `sophos.log_type` = `SD-WAN`，正文包含 `SLA not met` | `sophos.gw_name` |

syslog 事件补充了 SNMP 表：它们在隧道断开的那一刻到达，而表还能发现从未建立起来的隧道。

### Trap

每条 Sophos 通知都是同一个 Trap `sfosNotification`（`1.3.6.1.4.1.2604.5.1.8.1.1`），事件以文本形式放在 `sfosTrapMessage`（`1.3.6.1.4.1.2604.5.1.8.1.2`）中。要对某一类事件发出警报，请把 **SNMP Trap Received (Trap OID)** Equal To `1.3.6.1.4.1.2604.5.1.8.1.1` 与针对该 varbind 的 **SNMP Trap Varbind Value** 组合起来，例如 Contains `IPSec`。把防火墙的 Trap 目标设为 SNMP v2c：探测器的 Trap 接收器接收 v1 和 v2c Trap。

## Extreme Networks (EXOS / Switch Engine 和 Fabric Engine / VOSS)

| 你想看到的 | 来自哪里 |
| --- | --- |
| EXOS：CPU、温度及其告警、电源状态、电源、风扇、每个插槽的内存、堆叠成员 | **Extreme Networks EXOS / Switch Engine** 模板 |
| Fabric Engine：每个插槽的 CPU 和内存、温度传感器、风扇、电源、vIST 会话、I-SID 数量 | **Extreme Networks Fabric Engine / VOSS** 模板 |
| 每个 Fabric Connect（IS-IS）邻接，按其邻居命名 | Fabric Engine 模板的表 `isis_adjacencies` |
| 端口、LLDP 邻居、网络地图 | 两者都来自接口遍历 |

### 选择哪个模板

运行在 Extreme 通用硬件（5000 和 7000 系列）上的 Fabric Engine 报告的企业号与 EXOS 相同：只有其系统描述（`7520-48Y-8C-FabricEngine (9.0.4.0)`）能说明正在运行哪个操作系统。OneUptime 会同时读取两者，所以自动应用和设备页面的建议都会选出正确的模板；较旧的 VSP 交换机报告的是 Avaya/Nortel 的弧，会直接被识别为 Fabric Engine。

### Fabric 和硬件警报

Fabric Engine 交换机上的推荐警报包括 **Fabric Adjacencies (IS-IS): row unhealthy**，为邻接未建立的每个邻居打开一个事件。Fabric Engine 还会在邻接变化时发送一个 Trap，即 `rcnIsisPlsbAdjStateTrap`（`1.3.6.1.4.1.2272.1.21.0.281`），针对它的 **SNMP Trap Received (Trap OID)** 条件能在几秒内、赶在下一次轮询之前发出警报。

电源、风扇、温度传感器和堆叠成员都是声明了健康值的表，所以它们在推荐警报中各有一个按行警报。

### 流和 Wi-Fi

EXOS 和 Fabric Engine 以 sFlow 和 IPFIX 导出流。把 sFlow 发送到探测器的 UDP 6343，或把 IPFIX 发送到 UDP 4739，设备的 **Traffic** 页面就会显示其流量；参见[网络流量](/docs/monitor/network-traffic)。

IQ Engine（HiveOS）接入点和 ExtremeCloud IQ Controller 有各自的厂商模板，会填充设备的 **Wi-Fi** 页面。[支持的 Wi-Fi 厂商](/docs/monitor/network-device-monitor#支持的-wi-fi-厂商)介绍了它们，以及 Ubiquiti UniFi、HPE Aruba、TP-Link Omada 和 Juniper Mist。

## Cambium Networks (Enterprise Wi-Fi 和 cnMatrix)

### 接入点

:::steps
1. 在接入点上开启 SNMP。在 cnMaestro 中，SNMP 按 AP 组设置：**Configuration → Wi-Fi Profiles → AP Groups → Management → SNMP**。使用 v2c 只读团体字符串或 SNMPv3 用户开启它。
2. 用管理地址和这些凭据添加每个接入点，并应用 **Cambium Networks Enterprise Wi-Fi (cnPilot, XV, XE, XH)** 模板，或开启自动应用。
3. 打开设备的 **Wi-Fi** 页面。它显示有多少射频开启、客户端和 SSID，然后是每个射频的频段、信道、频率、信道带宽、发射功率、客户端、底噪和空口时间，以及每个 SSID 及其客户端。频率根据频段和信道计算得出；接入点本身不报告它。
:::

有用的警报，全部设置在 `wifi_radios` 表上，Row 为 `*`，让每个射频单独发出警报：

| 警报 | 条件 |
| --- | --- |
| 射频被关闭 | **SNMP Table Row Is Unhealthy**，属于推荐警报 |
| 发射功率发生变化 | **SNMP Table Value**，列 TX Power，Not Equal To 你规划的功率 |
| 拥挤的射频 | **SNMP Table Value**，列 Clients，Greater Than 你的上限 |
| 嘈杂的信道 | **SNMP Table Value**，列 Noise Floor，Greater Than `-80` |

每个数值型射频值也是一个指标（`oneuptime.monitor.snmp.table.value`，每个射频和每列一个序列），所以信道、功率和客户端可以在仪表板上随时间绘制图表；不断变化的信道说明 DFS 在起作用。

Cambium 仅从固件 6.5.3 起报告客户端总数；更早的固件返回 0。

### cnMatrix 交换机

**Cambium Networks cnMatrix** 模板收集 CPU、RAM、闪存、温度和供电电压，并以表的形式收集风扇、冗余电源和每个端口的 PoE 功耗。端口和 LLDP 邻居与任何交换机一样来自接口遍历。

### cnMaestro 告警

cnMaestro 可以把它的告警（例如接入点离线）发送到 HTTPS Webhook。把它指向一个 [Incoming Request 监视器](/docs/monitor/incoming-request-monitor)，即可把这些告警变成与 SNMP 数据并列的 OneUptime 事件。

## 故障排查

:::details IPsec Tunnels 表没有状态
隧道状态需要 SFOS v20 或更高版本。还要检查你凭据的 SNMP 视图是否包含 Sophos 企业树（`1.3.6.1.4.1.2604`）：受限的 v3 用户通常只能看到系统组和 IF-MIB。
:::

:::details 收不到防火墙的 syslog
探测器的 syslog 接收器默认关闭：设置 `PROBE_SYSLOG_RECEIVER_ENABLED=true`，并把 UDP 5140 或你的 `PROBE_SYSLOG_RECEIVER_PORT` 发布到探测器。消息按发送方的地址匹配到设备，所以防火墙在 OneUptime 中的主机名或其某个**其他地址**必须是它发送 syslog 时使用的地址。
:::

:::details Fabric Engine 交换机被应用了 EXOS 模板
模板是根据交换机的系统描述选择的。检查设备的概览是否显示了提到 Fabric Engine 的描述（例如 `7520-48Y-8C-FabricEngine (9.0.4.0)`）；如果是，请删除 EXOS 的 OID 和表，并从 **Vendor Health Template** 应用 **Extreme Networks Fabric Engine / VOSS**。
:::

:::details Cambium 接入点报告 0 个客户端
客户端总数需要固件 6.5.3 或更高版本。在更早的固件上，射频仍会报告其信道、功率和底噪。
:::

## 后续步骤

:::cards
- [网络设备监控](/docs/monitor/network-device-monitor): 设备收集的一切，以及它可以发出警报的每个条件。
- [日志管道](/docs/telemetry/log-pipelines): 把防火墙日志解析为属性。
- [日志监控](/docs/monitor/logs-monitor): 按隧道或网关各发一次警报。
:::
