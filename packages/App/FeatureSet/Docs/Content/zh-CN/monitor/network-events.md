# 网络事件（syslog 和 SNMP trap）

路由器、防火墙、交换机和接入点会在各自的 syslog 中说明自己发生了什么：链路断开、隧道中断、防火墙发生故障切换、有人登录。每个厂商的说法各不相同。将它们的 syslog 发送到 OneUptime 探测器，**事件**页面就会用同样的措辞显示发生了什么，不论设备出自哪家厂商，并在再次发生时向你发出警报。

事件页面出现在两个地方：

- **网络** -> **事件**：整个网络，在一个页面上显示所有设备的事件，以及所有尚未成为设备却在发送 syslog 的地址。
- 设备的**事件**选项卡：这一台设备报告的内容。

## 事件页面显示什么

- 时间范围内的事件，最新的在前。每一行说明发生了什么、在哪台设备上、涉及什么（接口、隧道、网关），以及设备自己的原话。
- **问题**、**恢复**和**信息**，各自带有时间范围内的数量。点击其中一个即可只看这一类。
- **所有事件**选择器，以及网络页面上的 **All devices** 选择器，可进一步缩小列表。时间范围和筛选条件保存在页面地址中，因此链接打开的是完全相同的视图。
- 点击某个事件即可打开它：何时发生、涉及什么、设备发送的原始消息，以及 OneUptime 从中读出的每个属性。
- **创建警报**提供大多数网络都需要的警报，**为此事件创建警报**则为你打开的事件创建一个警报。参见[警报](#警报)。

事件就是日志。事件页面上的所有内容也都可以在**日志**中搜索、绘制图表和设置警报：事件是属性 `event.domain` 为 `network` 的日志，发生了什么记录在 `event.name` 中。

## OneUptime 读取什么

任何产品的 RFC 3164 和 RFC 5424 格式 syslog 以及 Common Event Format（CEF）都可以读取。此外，OneUptime 还了解以下产品写入的内容：

| 厂商 | 产品 | 读取的事件 | 属性 |
| --- | --- | --- | --- |
| Cisco | IOS, IOS XE, NX-OS, ASA | 接口、设备、高可用、VPN、路由、硬件、交换、登录 | `cisco.*` |
| Sophos | Sophos Firewall (SFOS, XG, XGS) | 接口、设备、高可用、VPN、WAN、登录 | `sophos.*` |
| Fortinet | FortiGate (FortiOS) | 接口、设备、高可用、VPN、WAN、硬件、登录 | `fortigate.*` |
| Extreme Networks | ExtremeXOS, Switch Engine | 接口、设备、高可用、路由、硬件、交换、登录 | `extreme.*` |
| Extreme Networks | Fabric Engine, VOSS | 接口、路由 | `extreme.*` |
| HPE Aruba Networking | AOS-CX | 接口、硬件 | `aruba.*` |
| HPE Aruba Networking | AOS-Switch (ArubaOS-Switch, ProCurve) | 接口 | `aruba.*` |
| MikroTik | RouterOS | 接口、设备、登录 | `mikrotik.*` |
| Cambium Networks | Enterprise Wi-Fi (cnPilot, XV, XE, XH) | 设备、VPN、Wi-Fi | `cambium.*` |
| Ubiquiti | UniFi Network | 设备、WAN、交换、登录、Wi-Fi | `cef.*` |
| 任意 | 基于 Linux 的设备（kernel、hostapd、OpenSSH、Dropbear） | 接口、登录、Wi-Fi | - |

采用上述某种格式的消息，其自身字段会以最后一列中的前缀保存为属性，因此 Sophos 防火墙上的 `con_name="HQ-Branch1"` 就是属性 `sophos.con_name`。来自其他任何产品的 CEF 消息，其头部和扩展字段保存在 `cef.*` 下。OneUptime 无法归类的消息仍会在读取 syslog 头部后保存为日志；你可以自己为它的事件命名，参见[你自己的事件](#你自己的事件)。

标准 SNMP Trap 会被读取为同样的事件：`linkDown` 和 `linkUp` 成为**接口中断**和**接口连通**，`coldStart` 和 `warmStart` 成为**设备已重启**。

## 事件

OneUptime 识别的每条消息都会以下列名称之一保存在 `event.name` 中，不论设备出自哪家厂商：

| 事件 | `event.name` | 类型 | 涉及 |
| --- | --- | --- | --- |
| 接口中断 | `interface.down` | 问题 | `network.interface.name` |
| 接口连通 | `interface.up` | 恢复 | `network.interface.name` |
| 端口被交换机关闭 | `interface.error_disabled` | 问题 | `network.interface.name` |
| 设备已重启 | `device.reboot` | 问题 | - |
| 配置已更改 | `device.config_change` | 信息 | `user.name` |
| 设备离线 | `device.offline` | 问题 | - |
| 设备在线 | `device.online` | 恢复 | - |
| 故障切换 | `ha.failover` | 问题 | `ha.role` |
| 高可用性状态已变化 | `ha.state_change` | 信息 | `ha.role` |
| 高可用性对端中断 | `ha.peer_down` | 问题 | `ha.peer` |
| 高可用性对端恢复 | `ha.peer_up` | 恢复 | `ha.peer` |
| VPN 隧道中断 | `vpn.tunnel_down` | 问题 | `vpn.tunnel.name` |
| VPN 隧道连通 | `vpn.tunnel_up` | 恢复 | `vpn.tunnel.name` |
| 路由邻居中断 | `routing.neighbor_down` | 问题 | `network.peer.address` |
| 路由邻居恢复 | `routing.neighbor_up` | 恢复 | `network.peer.address` |
| 网关中断 | `gateway.down` | 问题 | `network.gateway.name` |
| 网关恢复 | `gateway.up` | 恢复 | `network.gateway.name` |
| WAN 故障切换 | `wan.failover` | 问题 | `network.gateway.name` |
| SD-WAN 链路低于其 SLA | `sdwan.sla_not_met` | 问题 | `network.gateway.name` |
| SD-WAN 链路恢复到 SLA 之内 | `sdwan.sla_met` | 恢复 | `network.gateway.name` |
| 风扇故障 | `hardware.fan_failed` | 问题 | `hw.name` |
| 风扇恢复工作 | `hardware.fan_ok` | 恢复 | `hw.name` |
| 电源故障 | `hardware.power_supply_failed` | 问题 | `hw.name` |
| 电源恢复工作 | `hardware.power_supply_ok` | 恢复 | `hw.name` |
| 温度过高 | `hardware.temperature_high` | 问题 | - |
| 检测到环路 | `loop.detected` | 问题 | `network.interface.name` |
| 生成树拓扑变化 | `stp.topology_change` | 信息 | - |
| PoE 故障 | `poe.fault` | 问题 | `network.interface.name` |
| 登录失败 | `auth.login_failed` | 问题 | `user.name` |
| 已登录 | `auth.login_success` | 信息 | `user.name` |
| Wi-Fi 客户端已连接 | `wireless.client_connected` | 信息 | `client.mac` |
| Wi-Fi 客户端已断开 | `wireless.client_disconnected` | 信息 | `client.mac` |

最后一列是说明事件涉及什么的属性。并非每个产品都会报告每种事件：交换机没有 VPN 隧道，而产品的 syslog 能说明的内容也有限。

每个事件还带有：

| 属性 | 内容 |
| --- | --- |
| `event.domain` | `network`，每个网络事件都有 |
| `event.kind` | `problem`、`recovery` 或 `info` |
| `event.category` | `interface`、`device`、`ha`、`vpn`、`routing`、`wan`、`hardware`、`switching`、`security` 或 `wireless`（上表中的事件） |
| `event.device` | 哪台设备：它在 OneUptime 中的名称，否则是它自报的名称，否则是它的地址 |
| `event.message` | 设备说了什么，即它自己的原话 |
| `syslog.vendor`、`syslog.parser` | 消息是按谁的格式读取的 |

## 事件如何到达这里

每个探测器都在端口 5140 上通过 UDP 和 TCP 监听 syslog。通过 TCP 时，一条消息是一行，或者按 RFC 6587 所述在前面带有长度。探测器每隔几秒将收到的内容转发给 OneUptime，OneUptime 再按消息的来源地址将每条消息匹配到设备：

1. 探测器轮询的设备中，主机名就是该地址（或解析为该地址）的设备，或在其**设置**页面的**其他地址**中列出该地址的设备；
2. 在你自己的（自定义）探测器上，项目中具有该地址的任何设备，或者主机名与消息所带主机名相同的设备（仅当恰好有一台设备使用该名称时）；
3. 否则，在你自己的探测器上，消息会保留在网络的事件页面的**正在发送 syslog，尚未成为设备**下，直到你指明它属于哪台设备。全局探测器会丢弃它。

来自未知地址、没有 syslog 优先级且不是事件的行会被视为噪声并丢弃。

控制器代表它所管理的设备发言：UniFi 控制台会报告其接入点和交换机的情况。当一台设备发来的消息通过 MAC 地址、序列号、地址或控制器为其起的名称指明另一台设备时，事件归属于那台设备，日志则在 `syslog.relay.name` 中保留转发它的控制器的名称。

日志按探测器收到它的时间保存。被积压过的消息（其自身时间戳采用带时区的 RFC 5424 格式，且早于 5 分钟前）保留设备的时间，最多可追溯 7 天。其他任何与探测器时钟相差超过 5 分钟的时间戳都不予采信：日志按收到的时间保存，设备的时间保留在 `syslog.deviceTime` 中。

你通过 HTTPS 发送到 [syslog 端点](/docs/telemetry/syslog)的 syslog 由相同的解析器读取。在那里，当消息采用网络厂商自己的格式，或通过 MAC 地址、序列号、地址或主机名指明你的某台网络设备时，它就成为网络事件；服务器的 `sshd` 行仍是普通日志。

## 设置方法

1. **使用位于设备网络中的探测器。** syslog 由你的设备发送，因此需要一个设备能到达的[自定义探测器](/docs/probe/custom-probe)。位于公共互联网上的全局探测器收不到它。
2. **让 syslog 到达探测器。** 允许从设备到探测器的端口 5140（UDP 或 TCP）。按照自定义探测器页面所示以主机网络（`--network host`）启动的 Docker 探测器可以直接接收；不使用主机网络时，请用 `-p 5140:5140/udp -p 5140:5140/tcp` 发布该端口。对于只能发送到端口 514 的设备，请用 `-p 514:5140/udp` 发布，或在使用主机网络的探测器上设置 `PROBE_SYSLOG_RECEIVER_PORT=514`。
3. **将探测器设为设备的 syslog 服务器。** 常见设备的命令见下文。在第一条消息到达之前，**事件**页面会显示相同的步骤，之后会自动变成列表。
4. **检查设备的地址。** 消息按设备发送时所用的地址匹配。如果设备从不是其主机名的环回地址或管理接口发送，请将该地址加入设备的**其他地址**。

syslog 接收器默认开启。其设置是探测器上的环境变量：

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `PROBE_SYSLOG_RECEIVER_ENABLED` | 设为 `false` 可关闭 syslog 接收器 | `true` |
| `PROBE_SYSLOG_RECEIVER_PORT` | UDP 和 TCP 使用的端口 | `5140` |
| `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` | 所有设备合计每分钟转发的消息数 | `600` |

超过限制后，探测器仍会转发它读取为网络事件的消息，最多再转发同样多的数量，这样大量例行的行就不会挤掉那条说明链路断开的消息。早于此功能的探测器只有在以 `PROBE_SYSLOG_RECEIVER_ENABLED=true` 启动时才会监听，而且只通过 UDP：请更新它。

### Cisco IOS、IOS XE 和 NX-OS

```text
logging host <probe-address> transport udp port 5140
logging trap informational
service timestamps log datetime msec
```

第二行发送信息级别及更严重的消息：链路变化、重启和登录都在其中。在 NX-OS 上，这一行是 `logging server <probe-address> 6 port 5140 use-vrf management`。

### Sophos Firewall

1. 在防火墙的 Web 管理界面中打开 **System services** > **Log settings**，并在 **Syslog servers** 下选择 **Add**。
2. 输入探测器的 IP 地址和端口 `5140`，并将严重级别设为 **Information**。防火墙提供的两种日志格式都可以读取。
3. 回到 **Log settings**，为要发送的日志勾选新服务器：至少勾选系统事件，以及用于 SLA 变化的 **SD-WAN**。防火墙的流量日志数量很多，除非你需要，否则不要勾选。

### Fortinet FortiGate

```text
config log syslogd setting
    set status enable
    set server "<probe-address>"
    set port 5140
    set mode udp
    set format default
end
```

FortiGate 发送其日志设置所选择的内容。事件日志包含隧道、链路和故障切换；流量日志数量很多，除非你需要，否则不要启用。

### Extreme Networks

```text
configure syslog add <probe-address>:5140 vr VR-Default local7
enable log target syslog <probe-address>:5140 vr VR-Default local7
enable syslog
```

将 `VR-Default` 改为可到达探测器的虚拟路由器。

### HPE Aruba

```text
logging <probe-address> udp 5140 severity info
```

在 AOS-CX 上，如果通过管理端口到达探测器，请在该行中加上 `vrf mgmt`。在 AOS-Switch 上，这一行是 `logging <probe-address> udp 5140`。

### MikroTik RouterOS

```text
/system logging action set remote remote=<probe-address> remote-port=5140
/system logging add topics=info action=remote
/system logging add topics=warning action=remote
/system logging add topics=error action=remote
/system logging add topics=critical action=remote
```

第一行将路由器内置的远程操作指向探测器；其余各行选择它发送什么。远程日志格式保持不变。

### Ubiquiti UniFi

1. 在 UniFi Network 中打开 **Integration** > **System Logging / SIEM**，并选择 **SIEM Server** 作为目标。
2. 输入探测器的 IP 地址和端口 `5140`，并选择要导出的日志类别。

控制台会报告它所管理的接入点和交换机的情况。如果设备带着 MAC 地址登记在 OneUptime 中，事件会出现在该设备自己的页面上，否则出现在控制台的页面上。

### Cambium Networks

1. 在 cnMaestro 或接入点的 Web 界面中打开系统设置，找到 syslog 服务器。
2. 将探测器的 IP 地址填为 syslog 服务器，在表单要求端口的地方填写端口 `5140`，并将 syslog 严重级别设为 **Info**。

如果没有可设置的端口，接入点会发送到端口 514：请按[设置方法](#设置方法)的第 2 步将探测器的端口发布到该端口。

### 其他设备

在设备上添加远程 syslog 服务器：探测器的 IP 地址、端口 5140、通过 UDP 或 TCP，发送信息级别及更严重的消息。OneUptime 不了解其格式的设备，其消息仍会被保存，你可以自己为它的事件命名。

## 警报

事件页面上的**创建警报**列出大多数网络都需要的警报。每个警报都会打开已填好的**创建监视器**，你可以在保存前修改任何内容：

| 警报 | 何时通知你 | 每个警报对应 | 何时关闭 |
| --- | --- | --- | --- |
| VPN 隧道中断 | `vpn.tunnel_down` | 设备和隧道 | 该隧道的 `vpn.tunnel_up` |
| 防火墙或交换机发生故障切换 | `ha.failover` | 设备 | 5 分钟内没有再次发生 |
| WAN 链路中断 | `gateway.down` | 设备和网关 | 该网关的 `gateway.up` |
| 路由邻居中断 | `routing.neighbor_down` | 设备和邻居 | 该邻居的 `routing.neighbor_up` |
| 设备重启 | `device.reboot` | 设备 | 5 分钟内没有再次发生 |
| 硬件故障 | 风扇、电源或温度 | 设备和组件 | 同一组件被报告恢复正常 |
| 接口中断 | `interface.down` | 设备和接口 | 该接口的 `interface.up` |
| 有人反复登录失败 | 超过 10 次 `auth.login_failed`，发生在 5 分钟内 | 设备 | 连续 5 分钟不超过 10 次 |

每个警报都是一个[日志监控](/docs/monitor/logs-monitor)，统计最近 5 分钟内的事件，并设置了 **Group by Attributes**，使每条隧道、每个网关或接口都有自己的警报，同时将**按属性解决**设为说明问题已结束的事件。这样的警报会一直保持打开，直到同一设备、同一隧道的该事件到达，无论需要多久；参见[由日志解决](/docs/monitor/logs-monitor#由日志解决)。OneUptime 不读取任何说明温度恢复正常的事件，因此温度警报会一直打开，直到你将其解决。

从设备的**事件**选项卡创建的监视器只监视该设备。对于其他任何事件，请在事件页面上打开其中一个，然后点击**为此事件创建警报**。要把警报发送到某处，或呼叫某人，请像对其他监视器一样，为该监视器添加值班策略或工作流。

## 尚未成为设备的地址

syslog 可能在发送它的设备被添加到 OneUptime 之前到达。在你自己的探测器上，它会被保留，其事件以设备自报的名称显示在网络的事件页面上，其地址列在**正在发送 syslog，尚未成为设备**下：

- **添加为设备**会打开 **添加设备**，并已填好地址和探测器。已经到达的消息留在网络的页面上；新消息归属于该设备。
- **这是我的设备之一**会将该地址加入某台设备的**其他地址**：当你已添加的设备从另一个地址（例如环回地址）发送时使用。从下一分钟起，它的消息归属于那台设备。

位于同一个 NAT 地址后面的多台设备共用该地址，因此它们的消息会归属于拥有该地址的那一台设备，除非消息指明了自己的设备。

## 你自己的事件

对于 OneUptime 不了解其格式的设备，或它不读取的事件，需要使用[日志管道](/docs/telemetry/log-pipelines)：

1. 创建一个管道，使其筛选条件匹配该设备的日志，例如 `attributes.networkDevice.name = 'rack-ups'`。
2. 添加 **Grok Parser** 或 **Key=Value Parser**，从消息中提取你需要的字段。
3. 添加**类别处理器**，将**目标属性**设为 `event.name`，并为每种事件添加一条规则。像上面的事件那样为每条规则命名，使用小写字母并以点或下划线分隔：`ups.on_battery`。

带有这种名称的网络设备日志会成为网络事件：它会出现在事件页面上，**为此事件创建警报**也对它有效。要说明它涉及什么，请添加**属性重映射器**，将你的字段复制到事件表中的某个属性，例如 `hw.name`。除非你的管道将 `event.kind` 设为 `problem` 或 `recovery`，否则事件会列在**信息**下。以内置事件命名的规则（例如 `interface.down`）会生成该内置事件，并带有它的类型和警报。

管道属于它所在的项目。要在另一个项目中使用，请在那里用相同的处理器创建它。

## 不包含的内容

- **基于 TLS 的 syslog**（RFC 5425）。探测器接收明文的 UDP 和 TCP；请将设备与探测器之间的路径保持在你信任的网络内。
- **在项目之间共享解析器。** 管道目前还不能导出和导入。
- **来自四种标准 Trap 之外的 SNMP Trap 的事件。** 厂商自有的 Trap 会保存为日志，可使用 **SNMP Trap Received (Trap OID)** 条件在[网络设备监控](/docs/monitor/network-device-monitor)中对其设置警报。
- **Cambium cnMatrix 交换机、Aruba 移动控制器和 CEF 模式下的 FortiGate。** 它们的消息会被保存并可搜索；目前还不会从中读取事件。
- **实时跟踪。** 事件页面显示的是打开时已到达的内容；请使用页面的刷新按钮，或使用**日志**的实时跟踪。

## 故障排查

如果事件页面仍然显示设置步骤：

- **探测器收到任何数据了吗？** 网络的事件页面会在**正在发送 syslog，尚未成为设备**下列出时间范围内发送过 syslog 的所有地址。如果设备在那里，说明它从不是其主机名的地址发送：请将该地址加入它的**其他地址**。
- **防火墙和 Docker。** 允许从设备到探测器的端口 5140；如果探测器在 Docker 中运行，请发布该端口。许多设备在未另行指定时会发送到端口 514。
- **探测器的日志。** 探测器在启动时会记录它监听的端口，或记录它无法打开该端口。当它因超过 `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` 而丢弃消息时，会每分钟记录一次丢弃的数量。
- **全局探测器。** 由全局探测器轮询的设备无法从私有网络向其发送 syslog。请在设备所在网络中运行自定义探测器，并在设备设置中选择它。
- **消息到达了，但没有事件。** 页面会说明这一点，每条消息都在设备的**日志**选项卡上。请检查设备是否发送信息级别的消息而不仅仅是错误，以及产品是否属于 [OneUptime 读取什么](#oneuptime-读取什么)中列出的产品；否则，请在日志管道中为它的事件命名。
