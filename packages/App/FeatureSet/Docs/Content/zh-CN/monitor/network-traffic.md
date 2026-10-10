# 网络流量（NetFlow、IPFIX 和 sFlow）

路由器、防火墙和交换机可以把经过它们的流量描述为**流记录**：谁和谁通信、使用哪种协议和端口、经过哪些接口、传输了多少字节。将这些导出发送到 OneUptime 探测器，**流量**页面就会显示你的流量去向：在任意时间范围内最繁忙的地址、会话、应用和接口。

流量页面出现在三个地方：

- **网络** -> **流量**：整个网络，在一个页面上显示所有设备的流，以及所有尚未成为设备却在发送流的地址。
- 站点的**流量**页面：该站点的设备。
- 设备的**流量**选项卡：这一台设备及其接口。在设备的探测器上运行的抓包列在流的下方，供你需要数据包本身时使用。

## 流量页面显示什么

- 时间范围内的四个数字：**流量**（字节）、**平均**和**峰值**速率，以及**流**（设备发送的流记录数）。
- **流量随时间的变化**，单位为比特每秒。在图表上拖动可放大某一时段；双击图表或使用**重置缩放**即可返回。
- **主要源地址**和**主要目的地址**：发送和接收最多的十个地址。
- **主要应用**：按协议和服务端口统计的流量，以该端口上通常运行的服务命名（HTTPS 即 TCP 端口 443）。
- 设备页面上的**主要接口**：每个接口进入和流出的流量，以及来自设备 SNMP 遍历的名称和速率。站点和网络页面上则是**主要设备**。
- **主要会话**：最繁忙的十对地址，可显示为从发送方到接收方的图示，也可显示为列表。

点击任意一行——地址、应用、接口、设备或图示中的色带——整个页面都会收窄到该流量。页面上方的标签说明当前收窄到什么；点击标签上的 x 即可恢复。**查找 IP 地址**可将页面收窄到发往或来自某个地址的流量。时间范围和筛选条件保存在页面地址中，因此链接打开的是完全相同的视图。

## 流如何到达这里

每个探测器都运行一个流收集器。它监听三个 UDP 端口，每个端口都能读取所有格式：

| 端口     | 通常用于                    |
| -------- | --------------------------- |
| UDP 2055 | NetFlow v5, NetFlow v9      |
| UDP 4739 | IPFIX                       |
| UDP 6343 | sFlow v5                    |

探测器会解码记录，将采样的计数按采样率乘回，每隔几秒汇总同一会话的记录，然后发送到 OneUptime。每条记录按其设备发送时所用的地址匹配到设备（对于 sFlow，是数据报中的代理地址）：

1. 探测器轮询的设备中，主机名就是该地址（或解析为该地址）的设备，或在其**设置**页面的**其他地址**中列出该地址的设备；
2. 在你自己的（自定义）探测器上，项目中主机名为该地址或其他地址中包含该地址的任何设备；
3. 否则，在你自己的探测器上，这些流会保留在网络的流量页面的**流的发送方**下，直到你指明它们属于哪台设备。全局探测器会丢弃它们。

流会保留 30 天，一个页面最多显示 31 天。

## 设置方法

1. **使用位于设备网络中的探测器。** 流是设备发送的 UDP 数据报，因此需要一个设备能到达的[自定义探测器](/docs/probe/custom-probe)。位于公共互联网上的全局探测器收不到它们。
2. **让数据报到达探测器。** 允许从设备到探测器的 UDP 2055、4739 和 6343。按照自定义探测器页面所示以主机网络（`--network host`）启动的 Docker 探测器可以直接接收；不使用主机网络时，请用 `-p 2055:2055/udp -p 4739:4739/udp -p 6343:6343/udp` 发布这些端口。
3. **在设备上开启流导出**，并发送到探测器的 IP 地址。常见设备的命令见下文。在第一条流到达之前，设备自己的**流量**选项卡也会显示包含探测器端口的相同步骤。
4. **检查设备的地址。** 记录按设备发送时所用的地址匹配。如果设备从不是其主机名的环回地址或管理接口发送，请将该地址加入设备的**其他地址**。

收集器默认开启。其设置是探测器上的环境变量：

| 变量                                | 作用                                                                | 默认值  |
| ----------------------------------- | ------------------------------------------------------------------- | ------- |
| PROBE_NETFLOW_RECEIVER_ENABLED      | 设为 `false` 可关闭流收集器                                         | true    |
| PROBE_NETFLOW_RECEIVER_PORT         | NetFlow 端口；设为 `0` 则不再监听该端口                             | 2055    |
| PROBE_IPFIX_RECEIVER_PORT           | IPFIX 端口；设为 `0` 则不再监听该端口                               | 4739    |
| PROBE_SFLOW_RECEIVER_PORT           | sFlow 端口；设为 `0` 则不再监听该端口                               | 6343    |
| PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE | 所有设备和端口合计每分钟接受的数据报数                              | 6000    |

### Cisco IOS XE（Flexible NetFlow）

将 IPFIX 导出到 UDP 4739。在每个要查看流量的接口上加上最后一行：在流量进入每个接口时测量，每段会话只计一次。

```text
flow exporter ONEUPTIME
 destination <probe-address>
 source Loopback0
 transport udp 4739
 export-protocol ipfix
 template data timeout 60
 option interface-table
 option sampler-table
!
flow monitor ONEUPTIME
 exporter ONEUPTIME
 cache timeout active 60
 record netflow ipv4 original-input
!
interface GigabitEthernet0/0/0
 ip flow monitor ONEUPTIME input
```

### Cisco IOS（NetFlow v9）

将 NetFlow v9 导出到 UDP 2055。

```text
ip flow-export version 9
ip flow-export destination <probe-address> 2055
ip flow-export source Loopback0
ip flow-export template timeout-rate 1
ip flow-cache timeout active 1
!
interface GigabitEthernet0/0
 ip flow ingress
```

### Arista EOS（sFlow）

将 sFlow 导出到 UDP 6343。sFlow 每 N 个数据包采样 1 个（此处为 16384），流量页面会将样本乘回，因此数字是估计值。

```text
sflow sample 16384
sflow destination <probe-address> 6343
sflow source-interface Loopback0
sflow run
```

### Cisco Meraki MX 和 Z

MX 设备和 Z 系列远程办公网关从 Meraki 控制台导出 NetFlow v9：

1. 打开 **Network-wide** > **General**，找到 **Reporting**。
2. 将 **NetFlow traffic reporting** 设为 **Enabled: send NetFlow traffic statistics**。
3. 将探测器的 IP 地址填入 **NetFlow collector IP**，将 `2055` 填入 **NetFlow collector port**，然后保存。

MX 或 Z 只能看到经过它的流量。交换机在 VLAN 内部转发的流量不会到达它，因此不在导出数据中。

### Juniper（内联 J-Flow）

从 MX 路由器将 IPFIX 导出到 UDP 4739；请使用承载你要采样的接口的 FPC。

```text
set services flow-monitoring version-ipfix template ONEUPTIME ipv4-template
set services flow-monitoring version-ipfix template ONEUPTIME flow-active-timeout 60
set services flow-monitoring version-ipfix template ONEUPTIME template-refresh-rate seconds 60
set chassis fpc 0 sampling-instance ONEUPTIME
set forwarding-options sampling instance ONEUPTIME input rate 1
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> port 4739
set forwarding-options sampling instance ONEUPTIME family inet output flow-server <probe-address> version-ipfix template ONEUPTIME
set forwarding-options sampling instance ONEUPTIME family inet output inline-jflow source-address <device-address>
set interfaces ge-0/0/0 unit 0 family inet sampling input
```

### Fortinet FortiGate

将 NetFlow v9 导出到 UDP 2055。在 FortiOS 7.2 及更高版本中，收集器是 `config system netflow` 内 `config collectors` 下的一个条目。

```text
config system netflow
    set collector-ip <probe-address>
    set collector-port 2055
    set template-tx-timeout 60
end
config system interface
    edit "port1"
        set netflow-sampler both
    next
end
```

### Palo Alto Networks

1. 在 **Device** > **Server Profiles** > **NetFlow** 下，添加一个包含探测器 IP 地址和端口 `2055` 的配置文件，并将 **Active Timeout** 设为 1 分钟。
2. 在 **Network** > **Interfaces** 下，打开每个要查看流量的接口，在 **Advanced** 选项卡中将该配置文件选为其 **NetFlow Profile**。
3. 提交（commit）。

### MikroTik RouterOS 7

```text
/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m
/ip traffic-flow target add dst-address=<probe-address> port=2055 version=9
```

### pfSense 和 Linux 主机

在 pfSense 上，安装 **softflowd** 软件包，然后在 **Services** > **softflowd** 下选择接口，填入探测器的 IP 地址和端口 `2055`，并选择 NetFlow 版本 9。在 Linux 主机上，在要查看流量的接口上运行 softflowd：

```bash
softflowd -i eth0 -n <probe-address>:2055 -v 9 -t maxlife=60
```

### 其他设备

将 NetFlow v5、NetFlow v9 或 IPFIX 发送到探测器 IP 地址的 UDP 2055（或 4739），或将 sFlow v5 发送到 UDP 6343。将设备的活动流超时设为 60 秒；对于 NetFlow v9 和 IPFIX，每 60 秒发送一次模板。[网络厂商指南](/docs/monitor/network-vendor-guides)介绍了 Sophos 和 Extreme Networks。

## 尚未成为设备的地址

流可能在发送它们的设备添加到 OneUptime 之前就已到达。在你自己的探测器上，这些流会被保留，网络的流量页面会在**流的发送方**下列出它们的地址，并标记为**尚未成为设备**：

- **添加为设备**会打开添加设备界面，并预先填好地址和探测器。已经到达的流保留在网络页面上；新的流归入该设备。
- **这是我的设备之一**会将该地址加入某台设备的**其他地址**：当你已添加的设备从另一个地址（例如环回地址）发送时使用。从下一分钟起，它的流归入该设备。

位于同一个 NAT 地址后面的多台设备共享该地址，因此它们的流会归入拥有该地址的那一台设备。

## 如何解读这些数字

- **采样。** 采样的设备（sFlow 总是采样，NetFlow 或 IPFIX 可以采样）每 N 个数据包报告 1 个。探测器会将计数乘以 N，因此页面显示的是估计值，并在四个数字下方注明。流量大时很准确，只有少量数据包时较为粗略。
- **重复计算。** 经过两台导出设备的流量会被两台设备都报告。设备页面只计算一次；站点或网络页面会为每台报告它的设备各计算一次。
- **应用。** 应用是指协议和服务端口，以该端口上通常运行的服务命名。这不是深度包检测：端口 8443 上的 HTTPS 显示为 TCP 端口 8443。客户端的临时端口会被忽略，因此到一台服务器的一千个浏览器连接只算一个应用。
- **峰值**是图表中最繁忙时段的速率，因此时间范围越短、时段越短，峰值越尖锐。**平均**是整个时间范围内的字节数。
- **时间。** 流计入它开始的时段。长时间下载会被报告为多条流，运行的每一分钟一条，因此设备的活动超时应设为 60 秒。

## 不包含的内容

- **基于流的告警。** 目前还没有基于流的监控器。要对繁忙的链路告警，请使用读取 SNMP 的[网络设备监控器](/docs/monitor/network-device-monitor)中的接口利用率告警。
- **端口之外的应用名称。** 没有深度包检测，也不读取 Cisco NBAR 的应用名称。
- **Meraki Dashboard API。** 不导入 Meraki 的流量分析；MX 和 Z 设备改为向探测器发送 NetFlow。
- 流量的**异常检测**。
- **来自流记录的接口名称。** 接口名称和速率来自设备的 SNMP 遍历；未遍历的设备显示接口编号。

## 故障排查

如果流量页面仍然显示设置步骤：

- **探测器收到任何数据了吗？** 网络的流量页面会在**流的发送方**下列出过去一小时内发送过流的所有地址。如果设备在那里显示为**尚未成为设备**，说明它从不是其主机名的地址发送：请将该地址加入它的**其他地址**。
- **防火墙和 Docker。** 允许从设备到探测器的 UDP 2055、4739 和 6343；如果探测器在 Docker 中运行，请发布这些端口。
- **探测器日志。** 探测器每分钟记录一次无法读取的内容：不支持格式的数据报（NetFlow v1、v6、v7 或 v8，或版本 5 之前的 sFlow）、格式错误的数据报、等待模板的数据，以及超出 `PROBE_NETFLOW_RATE_LIMIT_PER_MINUTE` 而被丢弃的数据报。
- **模板。** NetFlow v9 和 IPFIX 以模板的形式发送其记录的结构。探测器会将先于模板到达的数据最多保留 10 分钟；请让设备每 60 秒发送一次模板，以便页面在一分钟内显示数据。
- **全局探测器。** 由全局探测器轮询的设备无法从私有网络向其发送流。请在设备所在网络中运行自定义探测器，并在设备设置中选择它。
