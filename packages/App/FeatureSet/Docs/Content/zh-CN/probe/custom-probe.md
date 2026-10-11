# 自定义探针

自定义探测器是在你自己的网络中运行的小型代理。它检查你添加了它的监视器（例如内部网站、API 和防火墙后的服务器），并把结果发送到 OneUptime。它只通过 HTTPS 建立出站连接，因此你的网络中无需有任何东西接受来自互联网的连接。

:::cards
- [工作原理](#工作原理): 探测器做什么，以及 OneUptime 如何知道它在运行。
- [安装探测器](#安装探测器): 在 OneUptime 中创建，用 Docker、Docker Compose 或 Kubernetes 运行，并把它添加到监视器。
- [环境变量](#环境变量): 探测器读取的每个设置及其默认值。
- [诊断已断开的探测器](#诊断已断开的探测器): 找出探测器发往 OneUptime 的请求卡在哪里。
:::

## 工作原理

```mermaid title="自定义探测器做什么"
sequenceDiagram
    participant P as 自定义探测器
    participant O as OneUptime
    P->>O: 我在运行<br/>（每分钟）
    P->>O: 我的哪些监视器<br/>到期了?
    O-->>P: 要检查的监视器
    Note over P: 在你的网络中<br/>逐个检查
    P->>O: 发送结果
    Note over O: 更新状态，<br/>打开事件或告警
```

- **探测器向外连接。** 每个请求都从探测器通过 HTTPS 发往 `ONEUPTIME_URL`。网络外部无需访问探测器。
- **它只检查自己的监视器。** 探测器向 OneUptime 询问添加了它的监视器，在每个监视器到期时进行检查，并把结果发回。监视器的状态是否改变，由 OneUptime 根据结果决定。
- **OneUptime 留意它是否在运行。** 探测器的每个请求都算作存活信号，探测器至少每分钟发送一次。大约三分钟内没有任何请求时，探测器显示 **已断开** ，并通知它的所有者。没有所有者的探测器会通知项目的所有者。

## 开始之前

- **在 OneUptime Cloud 上需要 Growth 套餐。** 创建探测器需要它。自托管安装没有套餐限制。
- **创建探测器的权限。** 项目所有者、管理员和成员拥有此权限，角色允许创建探测器的任何人也有。
- **要监控的网络中的一台机器。** 它需要 Docker、Docker Compose 或 Kubernetes，一条通往探测器要检查的服务的路由，以及到 `ONEUPTIME_URL` 的出站 HTTPS。

## 安装探测器

:::steps
### 创建探测器

打开 **监控 → 设置 → 探测器** ，点击 **创建探测器** 。填写 **名称** 和 **描述** ：两者都必填。 **更多字段** 中有 **探测器徽标** 、 **在新建监视器上自动启用监控** （为你新建的每个监视器选择此探测器）以及 **标签** 。

### 复制它的 ID 和密钥

探测器需要 ID 和密钥才能连接。要复制它们，在 **自定义探针** 表中打开探测器的菜单，选择 **显示 ID 和密钥** 。能看到该表的人都可以复制探测器的 ID；只有项目所有者和管理员能看到密钥，他们看到的是 **显示 ID 和密钥** ，其他人看到的是 **显示 ID** 。

项目所有者和管理员也可以点击探测器：其页面上的 **Set up your Custom Probe** 卡片会显示已填好 ID 和密钥的 Docker 命令。

### 运行探测器

在选好的机器上，用探测器的 ID 和密钥运行它。如果你自托管 OneUptime，请把 `ONEUPTIME_URL` 设为你的安装地址，而不是 `https://oneuptime.com`。

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

然后用 `docker compose up -d` 启动它。
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

然后用 `kubectl apply -f oneuptime-probe.yaml` 应用它。
:::

主机网络（`--network host`、`network_mode: host`）让探测器使用主机自身的网络，包括 IPv6。在不使用主机网络运行之前，请先阅读 [监控 IPv6 目标](#监控-ipv6-目标)。

### 检查它是否连接

一两分钟内， **自定义探针** 表中探测器的 **状态** 会变为 **已连接** 。如果仍是 **已断开** ，原因写在探测器的日志里：参见 [诊断已断开的探测器](#诊断已断开的探测器)。

### 让探测器检查监视器

探测器只检查添加了它的监视器。新监视器在 **创建监视器** 的 **探测器与间隔** 步骤中选择探测器。对于已有的监视器，打开它并前往 **配置 → 探测器与间隔** 。该页面有三张卡片：

- **监控间隔** ：监视器的每个探测器检查它的频率。选择一个间隔后会立即保存。合成、Custom Code 和 SSL 证书监视器提供 5 分钟或更长的间隔；已经使用更短间隔或通过 API 设置了计划的监视器会保留原设置，并在列表中显示。
- **探测器** ：点击 **添加探测器** ，选择你的自定义探测器。要让某个探测器不再检查此监视器，可在该行菜单中用 **编辑** 关闭它，或删除该行。
- **探测器一致性** ：监视器状态改变前，需要有多少个探测器看到相同的结果，填入句子"一致的探测器达到 ... 时更改此监视器的状态"中。留空表示全部。只有已启用且已连接的探测器参与，因此比它们更大的数字也表示全部。离开输入框或按 **Enter** 时保存该数字。

探测器不检查的监视器（手动、入站请求、入站邮件、服务器、网络设备和遥测监视器）没有探测器与间隔页面。
:::

> [!TIP]
> 需要检查私有地址（如 `http://10.0.0.5/health`）的探测器需要 `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true`。在你允许之前，探测器会拒绝私有地址：参见 [私有网络访问](/docs/self-hosted/private-network-access)。

## 通过代理连接

如果探测器必须经过代理才能访问 OneUptime 或它检查的站点，请把代理的地址告诉它：

| 变量 | 作用 |
| --- | --- |
| `HTTPS_PROXY_URL` | HTTPS 地址使用的代理，包括 OneUptime 本身和大多数站点。 |
| `HTTP_PROXY_URL` | 普通 HTTP 地址使用的代理。 |
| `NO_PROXY` | 探测器直接访问的主机，用逗号分隔。 |

代理地址写作 `http://proxy.example.com:8080`；如果代理需要用户名和密码，写作 `http://username:password@proxy.example.com:8080`。大多数代理两种地址都能处理，所以请把两个变量设为同一个 URL。

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
```
:::

经过代理的内容：

- **探测器自身发往 OneUptime 的请求。**
- **监视器的 HTTP 检查** ：Website、API、External Status Page、Custom Code、SSL 证书、合成和域名监视器。SSL 证书和合成监视器使用 `HTTPS_PROXY_URL`，只设置了 `HTTP_PROXY_URL` 时则使用它。
- **不包括其他检查。** Ping、Port、DNS、SNMP 等非 HTTP 的检查直接连接。

`NO_PROXY` 的条目可以是主机名（`api.internal`）、以点或 `*.` 开头表示其下所有名称的域名（`.internal.example.com`）、它们加上 `:port` 的形式，或表示全部的 `*`。不读取 IP 范围：请逐个列出地址。小写的 `http_proxy`、`https_proxy` 和 `no_proxy`，以及 `HTTP_PROXY` 和 `HTTPS_PROXY`，同样有效。

## 监控 IPv6 目标

只有探测器自身的网络有 IPv6 时，它才能监控 IPv6 目标：

- **带 `--network host` 的 Docker，或带 `network_mode: host` 的 Compose** （上面的配置）：探测器共享主机的网络，因此只有主机有 IPv6 时它才有。
- **Docker 桥接网络** （不使用主机网络时得到的网络）：没有 IPv6，除非为该网络开启了 IPv6（见下文）。
- **Kubernetes** ：只有在双栈或纯 IPv6 集群上，Pod 才有 IPv6。

要检查，可在探测器内部 ping 一个公网 IPv6 地址：

:::tabs
@tab Docker
```bash
docker exec oneuptime-probe ping -6 -c 1 2001:4860:4860::8888
```
@tab Kubernetes
```bash
kubectl exec deploy/oneuptime-probe -- ping -6 -c 1 2001:4860:4860::8888
```
:::

`1 received` 表示探测器可以访问 IPv6 目标。如果探测器没有可用的 IPv6，`ping` 会立即失败，错误会说明原因：

| 错误 | 含义 |
| --- | --- |
| `Network is unreachable` | 探测器的网络没有 IPv6 路由：没有 IPv6 的 Docker 桥接网络、仅 IPv4 的 Kubernetes 集群，或没有 IPv6 连接的主机。 |
| `Cannot assign requested address` | 探测器的网络命名空间中关闭了 IPv6。检查 `net.ipv6.conf.all.disable_ipv6` 和 `net.ipv6.conf.lo.disable_ipv6`：在探测器内运行 `cat /proc/sys/net/ipv6/conf/all/disable_ipv6`，关闭时会输出 `1`。使用主机网络时，这些是主机的设置。 |
| `Address family not supported by protocol` | 内核以 `ipv6.disable=1` 启动，因此这台机器完全没有 IPv6。从内核命令行中删除它并重启，或在另一台机器上运行探测器。 |

在每种情况下都没有向目标发送任何内容，因此探测器无法判断它是否正常。检查仍会失败，但 Ping 监视器的失败原因会指出是探测器的问题，而不是说目标没有响应：

```text
This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.
```

随失败一起记录的网络路径显示 `Traceroute could not run: this probe cannot send IPv6 traffic (...)`。修好探测器的网络，或把监视器移到有 IPv6 的探测器上。

### 不使用主机网络时的 IPv6

如果无法使用主机网络，请把探测器接入一个开启了 IPv6 的 Docker 网络。主机本身仍然需要 IPv6。

```bash
docker network create --ipv6 oneuptime-probe-ipv6
docker run --name oneuptime-probe --network oneuptime-probe-ipv6 -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Docker Engine 27 及更高版本会为该网络选择一个 IPv6 子网，并把探测器的出站 IPv6 伪装在主机地址之后。更早的版本需要显式的 IPv6 子网（例如 `docker network create --ipv6 --subnet fd00:0:0:1::/64 oneuptime-probe-ipv6`），以及 `/etc/docker/daemon.json` 中的 `"ip6tables": true` 和 `"experimental": true`。使用 Docker Compose 时，删除 `network_mode: host`，并在探测器的网络上设置 `enable_ipv6: true`。

## 发现扫描中的 NetBIOS 名称查询

开启了 **查询 Windows 名称（NetBIOS）** 的 [网络发现扫描](/docs/monitor/network-device-monitor) 会从探测器向每台没有 SNMP 系统名称的主机发送 NetBIOS 名称查询（NBSTAT）。对使用它的扫描，请允许以下流量：

- **查询哪些主机：** 既没有 SNMP 系统名称也没有反向 DNS 名称（PTR）的已发现主机，并且只查询私有地址（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`）或运营商级 NAT 地址（`100.64.0.0/10`）。从不查询公网地址；如果从探测器进行的反向 DNS 查询返回了名称，也不会向该主机发送查询。反向查询失败、超时，或因查询时间预算用完而被跳过的主机，即使有 PTR 记录，仍可能被查询。
- **出站：** 从探测器上一个临时（随机、高编号）源端口发往这些主机 UDP 端口 137 的 UDP。上面的代理设置不适用于它。
- **入站：** 从每台主机的 UDP 端口 137 回到该临时端口的应答。有状态防火墙会自动放行。没有应答时，这些主机仍以 IP 地址命名。

该查询不需要额外的容器 capability，在 Kubernetes Pod 网络中也能工作。每次扫描最多查询 2,000 台主机（`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` 可提高到 4,000），对未应答的主机再发送一次查询，按每秒约 100 个的速度发送查询，并在按这项工作量确定的时间限制处停止 - 完整查询 2,000 台主机约需 54 秒，任何情况下都不超过两分钟。无论扫描如何设置，全局探测器都不会发送 NetBIOS 查询，所以需要 NetBIOS 名称的扫描请从自定义探测器运行。新扫描默认开启此选项。向大量主机发送 NBSTAT 查询可能触发入侵检测规则，因此在意这一点的网络上请关闭它，或事先告知你的安全团队。

## 环境变量

探测器在启动时从环境中读取设置：修改后请重启探测器。探测器无法读取的数字，或超出变量允许范围的数字，会被忽略并使用默认值；数据包捕获的上限则会被调整到其范围之内。

### 必填

| 变量 | 说明 |
| --- | --- |
| `PROBE_KEY` | 探测器的密钥，来自 **显示 ID 和密钥** 。没有它，探测器在启动时就会停止。 |
| `PROBE_ID` | 探测器的 ID，来自 **显示 ID 和密钥** 。没有它，探测器在启动时就会停止。 |
| `ONEUPTIME_URL` | OneUptime 的位置：`https://oneuptime.com`，或你自己安装的地址。没有它，探测器在启动时就会停止。 |

### 检查监视器

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PROBE_MONITORING_WORKERS` | `1` | 探测器同时检查的监视器批次数。 |
| `PROBE_MONITOR_FETCH_LIMIT` | `10` | 一个批次中的监视器数量。 |
| `PROBE_MONITOR_RETRY_LIMIT` | `3` | 监视器检查首次失败后的重试次数，在步骤没有设置自己的重试次数时使用，因此最多尝试 4 次。`0` 关闭重试。 |
| `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` | `900000` | 检查一个监视器的期限，超过后放弃本次检查并在下一个周期重试。提高合成脚本超时时，默认值也会随之增大，因此脚本永远不会被中途截断。 |
| `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | 合成监视器脚本的超时时间，单位为毫秒。 |
| `PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED` | `false` | 设为 `true` 后，合成监视器中的 Chromium 会在它自己的沙箱中运行。只有在探测器的容器使用允许沙箱的 seccomp 配置文件（例如 Playwright 的配置文件）运行时才开启它：没有这样的配置文件，Chromium 无法启动。关闭时，探测器会在启动时记录一条警告。 |
| `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Custom Code 监视器脚本的超时时间，单位为毫秒。 |
| `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` | `false` | 设为 `true` 后，此探测器上的 Website、API、External Status Page 和 Custom Code 监视器可以访问私有地址。参见 [私有网络访问](/docs/self-hosted/private-network-access)。 |
| `PROBE_NETWORK_DEVICE_POLL_CONCURRENCY` | `25` | 探测器同时轮询的网络设备数量。轮询设备很多的探测器可以调高它。 |

合成监视器运行时的限制（同时运行的数量、内存和磁盘）见 [合成监控](/docs/monitor/synthetic-monitor) 页面。

### 与 OneUptime 通信

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `HTTP_PROXY_URL`、`HTTPS_PROXY_URL`、`NO_PROXY` | 无 | 代理设置：参见 [通过代理连接](#通过代理连接)。 |
| `PROBE_API_REQUEST_TIMEOUT_IN_MS` | `45000` | 探测器发往 OneUptime 的每个请求的期限。 |
| `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` | `10000` | 发往 OneUptime 的请求慢于此值时记录警告。 |

### 网络发现

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` | `5400000`（90 分钟） | 一轮网络发现扫描的期限，超过后放弃，并将扫描报告为失败。 |
| `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` | `30000` | 正在进行的发现扫描上传已发现主机的频率，这样长时间的扫描也能显示进度，其设备可在扫描完成前导入。最小值 `5000`。 |
| `PROBE_DISCOVERY_SCAN_CONCURRENCY` | `0` | 一轮发现扫描同时探测的地址数量（固定值）。不设置（或设为 `0`）时，根据扫描目标自动确定；除非探测器容器特别小或特别大，这正是你需要的。 |
| `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` | `0` | 为扫描发现的主机查询反向 DNS 名称（PTR）的时间限制，单位为毫秒。见下文。 |
| `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` | `0` | 一次扫描的 NetBIOS 查询最多可询问的主机数。见下文。 |
| `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` | `4` | 此探测器上同时运行的独立发现扫描的最大数量，范围 1 到 16。见下文。 |

`PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS`：不设置（或设为 `0`）时，根据主机数量确定限制：约 860 台主机以内为 60 秒，随主机数增加，最多 10 分钟。可设为 1000 到 1200000。查询未能按时覆盖的主机不会获得反向 DNS 名称（除非 SNMP 或 NetBIOS 为其命名，否则按 IP 地址列出），扫描的状态消息会说明遗漏了多少。超时或失败的查询会在限制内重试一次，并依次询问探测器的每个名称服务器。对位于慢速 DNS 服务器后的大型网络，请调高此值。

`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS`：对于开启了 NetBIOS 名称的扫描，查询会询问每台没有 SNMP 系统名称的主机，没有反向 DNS 名称的主机优先。不设置（或设为 `0`）时保持内置上限 2,000；可设为 1 到 4000。超出上限的主机不会被询问，扫描的状态消息会说明数量。调高它也会延长查询时间（时间限制据此确定：4,000 台主机约 104 秒），并在网络上发送更多 NBSTAT 数据报，而入侵检测规则会关注这些数据报。

`PROBE_DISCOVERY_MAX_CONCURRENT_SCANS`：只要还有容量，探测器每分钟检查一次是否有其他待处理的扫描，因此一个长时间的扫描不会阻塞所有其他扫描。所有槽位都被占用时，其他扫描保持待处理，直到有槽位空出。每个扫描都有自己的主机并发数，因此资源用量随这两个设置增长；对于小型容器，请降低其中任一限制。设为 1 时扫描按顺序依次运行。

在把自定义探测器升级为使用并发发现之前，请先升级 OneUptime 服务器。服务器必须能排除探测器仍在运行的扫描，这样编辑正在运行的扫描时，其新配置才能安全地排队。将升级后的探测器连接到旧服务器时，请在服务器升级之前设置 `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1`。

### 数据包捕获

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `PROBE_PACKET_CAPTURE_ENABLED` | 关闭 | 设为 `true` 后，拥有权限的人可以从控制台在此探测器上启动数据包捕获。捕获还需要主机网络和 `NET_RAW` capability。参见 [抓包](/docs/probe/packet-capture)。 |
| `PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS` | `1800` | 此探测器运行的最长数据包捕获，范围 5 到 1800。 |
| `PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB` | `25` | 此探测器生成的最大捕获文件，范围 1 到 25。 |

### 探测器监听的内容

除非你开启某个监听器，或保留默认开启的监听器，否则探测器只建立出站连接：

| 监听器 | 设置 | 默认值 | 了解更多 |
| --- | --- | --- | --- |
| 入站请求和心跳 | `PROBE_INGRESS_PORT` | 关闭 | [入站请求 Ingress](/docs/probe/incoming-request-ingress) |
| SNMP Trap | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | 开启，UDP 162 | [网络设备监控](/docs/monitor/network-device-monitor) |
| Syslog | `PROBE_SYSLOG_RECEIVER_ENABLED` | 关闭，UDP 5140 | [网络设备厂商指南](/docs/monitor/network-vendor-guides) |
| NetFlow、IPFIX 和 sFlow | `PROBE_NETFLOW_RECEIVER_ENABLED` | 开启，UDP 2055、4739 和 6343 | [网络流量](/docs/monitor/network-traffic) |
| 健康检查 | `PORT` | 开启，TCP 3874 | `/status/live` 和 `/status/ready` |

在容器中，只有使用主机网络或发布端口时，其他机器才能访问该端口。

Syslog 接收器每分钟最多转发 `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` 条消息，默认 `600` 条，丢弃其余的消息，并记录丢弃了多少条。

`PROBE_NAME` 和 `PROBE_DESCRIPTION` 只由使用 `REGISTER_PROBE_KEY` 自行注册的探测器读取，例如自托管安装为所有项目运行的探测器。自定义探测器的名称和描述取自控制台。

## 故障排除

### 诊断已断开的探测器

当探测器发往 OneUptime 的请求不再成功时，探测器会被标记为 `Disconnected`。探测器的日志会说明每个失败请求卡在哪里，因此很少需要猜测。

:::steps
#### 阅读启动时打印的环境信息块

每个探测器启动时都会打印一个 JSON 块，包含它使用的 OneUptime 地址、请求期限、代理设置、继承的 DNS 解析器、Node 和操作系统版本，以及是否关闭了 TLS 验证。报告问题时请附上这个块。

#### 找到失败报告

每个发往 OneUptime 的失败请求都会记录一个包含 `stalledAt` 和 `whatThisMeans` 的块。`stalledAt` 是请求始终没能通过的阶段：

| `stalledAt` | 含义 |
| --- | --- |
| `SocketAssignment` | 没有任何内容离开这台机器。套接字池已满，或配置的代理始终没有建立 CONNECT 隧道。 |
| `TcpConnect` | 机器发送了 SYN，却没有收到任何回应：防火墙或安全设备在丢弃数据包，或主机不可达。 |
| `TlsHandshake` | TCP 已连接，TLS 始终没有完成。通常是检查 TLS 的中间设备所致。 |
| `RequestSend` | 已连接，但请求始终没有完整写出：对端停止了读取。 |
| `WaitingForServerResponse` | 请求已送达，服务器却没有返回任何内容。 **探测器的网络没有问题** ：请检查 OneUptime 服务器、它的负载均衡器和反向代理。 |
| `ResponseBody` | 服务器开始应答，却在中途停住了。 |
| `Unknown` | 探测器无法判断请求停在了哪里。接下来请阅读下面的连接自检。 |

同一个块还会报告 `deadlineOverrunInMs`。如果 45000ms 的期限在实际时间上用了远超 45000ms，说明是探测器进程本身被阻塞了：在排查网络之前，先检查块中的 `probeProcess.eventLoopMaxDriftInMs`。

#### 阅读连接自检

连续失败三次后，探测器会逐层测试同一台服务器（依次为 DNS、TCP、TLS，然后是一次真实的 HTTP 往返），并记录每个阶段及其耗时。第一个失败的阶段就是答案。配置了代理时，探测器测试的是到代理的那一段，因为那是它实际经过的唯一一段。该测试最多每五分钟运行一次。

#### 在请求失败之前留意慢请求

成功但耗时超过 `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` 的请求会连同耗时一起记录。开始记录 20 秒请求的探测器，正在逼近 45 秒的期限。
:::

在 OneUptime 服务器端，应答缓慢的探测器请求，或在发送应答前探测器已放弃的请求，也会连同探测器的 id 一起被记录。把这两份日志放在一起，就能看出问题出在连接的哪一端。

### 其他问题

:::details 探测器启动后立即停止
它的日志会说明缺少什么：`PROBE_KEY is not set`、`PROBE_INGEST_URL or ONEUPTIME_URL is not set` 或 `PROBE_ID or REGISTER_PROBE_KEY should be set`。如果三者都已设置，但 ID 和密钥与任何探测器都不匹配，探测器会每隔 30 秒尝试一次，共 10 次，然后以 `Unable to register probe after 10 attempts` 停止。请用 **显示 ID 和密钥** 重新复制 ID 和密钥。
:::

:::details 探测器一直正常，直到有人重置了它的密钥
探测器页面上的 **重置探测器密钥** 会生成新密钥，旧密钥立即失效。用 **显示 ID 和密钥** 复制新密钥，把它设为 `PROBE_KEY`，然后重启探测器。
:::

:::details 监视器提示无法访问私有地址
在你允许之前，探测器会拒绝私有地址。在探测器上设置 `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` 并重启它：参见 [私有网络访问](/docs/self-hosted/private-network-access)。
:::

如果问题仍未解决，请在 [GitHub](https://github.com/oneuptime/oneuptime) 上创建 issue，或 [联系支持](https://oneuptime.com/support)。

## 后续步骤

:::cards
- [创建监视器](/docs/monitor/create-monitor): 选择要检查的内容，以及由哪些探测器检查。
- [入站请求 Ingress](/docs/probe/incoming-request-ingress): 让无法访问互联网的服务通过探测器发送心跳。
- [抓包](/docs/probe/packet-capture): 从控制台捕获探测器看到的流量。
- [私有网络访问](/docs/self-hosted/private-network-access): 让探测器检查私有地址。
:::
