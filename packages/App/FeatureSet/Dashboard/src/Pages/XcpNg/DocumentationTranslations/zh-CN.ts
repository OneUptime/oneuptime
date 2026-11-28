import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in Simplified Chinese (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * Simplified Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Simplified Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 或更高版本，并已连接到你要监控的资源池。在 XOA 上，其 OpenMetrics 插件需要 Premium 许可证；从源码构建的 Xen Orchestra 已包含该插件",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Engine 20.10 或更高版本及 Docker Compose v2 插件，所在机器能通过 HTTPS 访问 Xen Orchestra",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "Xen Orchestra 上的一个证书，其名称中包含代理连接的地址。Xen Orchestra 为自己生成的自签名证书不包含任何名称，因此当前没有任何 TLS 客户端能校验它——请参阅高级中的 **Xen Orchestra 的证书**",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. 在 Xen Orchestra 中打开 *Settings → Plugins*，找到 **openmetrics**。",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. 启用它。它在首次启动时会生成一个密钥并保留下来，Xen Orchestra 在重启后也会保留它。",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. 打开插件的设置，复制它的 **Prometheus secret**——你会在下一步把它交给代理。你也可以在那里输入自己的密钥并保存。",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "插件在 Xen Orchestra 自己的地址上、以其自己的证书在 `/openmetrics/metrics` 应答，并且只应答携带其密钥的请求。它提供 Xen Orchestra 所连接的每个资源池，因此一个代理即可覆盖全部。",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "脚本会询问你的 OneUptime URL 和摄取密钥，两者都显示在第 1 步中（在那里选择一个密钥即可在此处填好），然后询问：",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **Xen Orchestra 的地址**——即你在浏览器中打开它的地址，例如 `https://xo.example.com` 或 `https://10.0.0.5:8443`。",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **OpenMetrics 插件的密钥**——来自上一步。输入时不会显示。",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **这个 Xen Orchestra 的名称**——它的每个资源池在其设置中显示的名称。按 Enter 即使用其地址。",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "随后脚本会读取 Xen Orchestra 的证书。如果这台机器已经信任它，代理就信任同一个 CA 证书包。如果不信任，脚本会显示证书的 SHA-256 指纹：请将其与 Xen Orchestra 所在机器上的指纹比对，然后回答 **y**，只信任这一个证书。它从不关闭校验。在安装任何内容之前，它会用密钥向插件请求指标，并说明 Xen Orchestra 报告了哪些资源池。",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "它会安装到 `/opt/oneuptime-xcp-ng-agent`，写入一个权限为 `0600` 的 `.env` 文件，并用 Docker Compose 启动代理。再次运行脚本会沿用该 `.env` 中的所有内容而不再询问，所以升级也是这样做的。",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps` 会列出 `oneuptime-xcp-ng-agent`。在它的日志中查找 `Everything is ready. Begin running and processing data.`。代理每分钟读取一次 Xen Orchestra，它报告的每个资源池随后会以 Xen Orchestra 给它的名称出现在 **XCP-ng** 部分，并带有其主机、虚拟机和存储。",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "安装脚本会把这些写入 `/opt/oneuptime-xcp-ng-agent/.env`。更改其中任何一项后，在 `/opt/oneuptime-xcp-ng-agent` 中用 `docker compose up -d` 应用它。",
  "| Variable | Required | Description |": "| 变量 | 必填 | 说明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 实例 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 是 | 遥测摄取密钥，即第 1 步中选择的那个 |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | 是 | Xen Orchestra 的 `host` 或 `host:port`，不带协议 |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | 否 | `https`（默认）。`http` 仅限实验环境：此时密钥会以明文穿过网络 |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | 是 | OpenMetrics 插件的密钥，作为 Bearer 令牌发送。其中的每个 `$` 都写成 `$$` |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | 否 | 这个 Xen Orchestra 在 OneUptime 中的名称，显示在它每个资源池的设置中（默认：其地址） |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | 否 | 当 `XO_ADDRESS` 是证书中未列出的地址时，用来校验 Xen Orchestra 证书的名称 |",
  "| `XCP_NG_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-xcp-ng-agent`). A second Xen Orchestra's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AGENT_CONTAINER_NAME` | 否 | 代理的容器名称（默认：`oneuptime-xcp-ng-agent`）。同一台机器上第二个 Xen Orchestra 的代理需要自己的容器名称：除非你自行设置，否则安装脚本会按新代理的文件夹为它命名，并在你再次运行脚本时保留该名称 |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | 安装脚本 | 按输入原样保存的 Xen Orchestra 地址；脚本从中推导出 `XO_SCHEME` 和 `XO_ADDRESS` |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | 安装脚本 | 当代理只信任 Xen Orchestra 自己的证书时，该证书的 SHA-256 指纹 |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | 安装脚本 | 签发 Xen Orchestra 证书的 CA 证书包，脚本会将其复制到 `xo-ca.pem` |",
  "| `ONEUPTIME_AI_XO_READ_TOKEN` | No | A token of a Xen Orchestra user holding a copy of the built-in **Read only** role and nothing else: the XCP-ng AI agent runs when it is set, and reads with it |":
    "| `ONEUPTIME_AI_XO_READ_TOKEN` | 否 | 只持有内置 **Read only** 角色副本的 Xen Orchestra 用户的令牌：设置后 XCP-ng AI 代理就会运行，并用它读取 |",
  "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Only for fixes: a token of another user, whose role allows them. The AI agent changes nothing without it |":
    "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | 否 | 仅用于修复：另一个用户的令牌，其角色允许这些修复。没有它，AI 代理不会更改任何内容 |",
  "| `XCP_NG_POOL_ID` | No | The XAPI UUID of the pool the AI agent serves (default: the one pool its read token can see) |":
    "| `XCP_NG_POOL_ID` | 否 | AI 代理所服务资源池的 XAPI UUID（默认：其读取令牌能看到的唯一资源池） |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | No | Overrides `XCP_NG_POOL_ID` as the pool the AI agent registers as |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | 否 | 覆盖 `XCP_NG_POOL_ID`，作为 AI 代理注册时使用的资源池 |",
  "| `ONEUPTIME_AI_INVESTIGATION` | No | `true` or `false`: whether OneUptime AI may run the AI agent's read-only commands while it investigates (default: on) |":
    "| `ONEUPTIME_AI_INVESTIGATION` | 否 | `true` 或 `false`：OneUptime AI 在调查时能否运行 AI 代理的只读命令（默认：开启） |",
  "| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` or `bypass-approval`: how OneUptime AI may apply a fix |":
    "| `ONEUPTIME_AI_FIXES` | 否 | `off`、`ask-for-approval`、`automatic` 或 `bypass-approval`：OneUptime AI 可以如何应用修复 |",
  "| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` lets the AI agent apply fixes, with the token for changes. Anything else keeps it read-only |":
    "| `ONEUPTIME_AI_ALLOW_WRITES` | 否 | `true` 让 AI 代理使用更改令牌应用修复。其他任何值都会让它保持只读 |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | No | The `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` or `schedule/<uuid>` a fix may touch, comma-separated (default: all) |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | 否 | 修复可以触及的 `vm/<uuid>`、`host/<uuid>`、`pbd/<uuid>` 或 `schedule/<uuid>`，以逗号分隔（默认：全部） |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | The same, for what OneUptime AI must never change: the VM the AI agent runs in, and Xen Orchestra's own |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | 否 | 同上，用于 OneUptime AI 绝不能更改的内容：AI 代理运行所在的虚拟机，以及 Xen Orchestra 自己的虚拟机 |",
  "| `LOG_LEVEL` | No | The AI agent's log level: `debug`, `info` (default), `warn` or `error` |":
    "| `LOG_LEVEL` | 否 | AI 代理的日志级别：`debug`、`info`（默认）、`warn` 或 `error` |",
  "| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` starts the AI agent; the install script writes it when the read token is set |":
    "| `COMPOSE_PROFILES` | 否 | `xcp-ng-ai-agent` 会启动 AI 代理；安装脚本会在设置了读取令牌时写入它 |",
  "| `XCP_NG_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-xcp-ng-ai-agent`). The install script names a second Xen Orchestra's AI agent after its collector (`oneuptime-xcp-ng-ai-agent-lab` beside `oneuptime-xcp-ng-agent-lab`) unless you set it, and keeps it when you run the script again |":
    "| `XCP_NG_AI_AGENT_CONTAINER_NAME` | 否 | AI 代理的容器名称（默认：`oneuptime-xcp-ng-ai-agent`）。除非你自行设置，否则安装脚本会按第二个 Xen Orchestra 的收集器为其 AI 代理命名（`oneuptime-xcp-ng-ai-agent-lab` 与 `oneuptime-xcp-ng-agent-lab` 并列），并在你再次运行脚本时保留该名称 |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "代理用 `docker-compose.yml` 旁边的 `xo-ca.pem` 校验 Xen Orchestra 的证书。",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "代理每次读取时都会校验 Xen Orchestra 的证书，只依据 `xo-ca.pem`。该文件包含以下三者之一：",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **Xen Orchestra 自己的证书**，通过其 SHA-256 指纹固定（`XO_TLS_FINGERPRINT`）：代理只信任这一个证书。",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **签发它的 CA**（`XO_CA_FILE`），用于你自己的 CA 签发的证书。",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **这台机器的 CA 证书包**，用于这台机器已经信任的证书。",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "无论哪种方式，证书都必须在名称中包含代理连接的地址：与当前所有 TLS 客户端一样，代理校验的是证书签发给的名称，而不是其主题。Xen Orchestra 为自己生成的自签名证书不包含任何名称，因此无论是否固定，代理都无法信任它，并会以 `x509: certificate is not valid for any names` 失败。请按照 [Xen Orchestra 的证书](/docs/telemetry/xcp-ng#xen-orchestras-certificate) 所示，为 Xen Orchestra 配置一个名称中包含其地址的证书——由你的 CA 签发，或是带有主题备用名称（subject alternative name）的自签名证书。",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "如果证书用不同于 `XO_ADDRESS` 中地址的名称来标识 Xen Orchestra，请把 `XO_TLS_SERVER_NAME` 设为该名称。固定的证书续期后，代理会停止读取 Xen Orchestra，直到它信任新证书。请再次运行安装脚本：它会显示新的指纹并停止，不做任何更改。在 Xen Orchestra 所在机器上核对该指纹，然后带上它再运行一次脚本：`XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`。",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "代理每分钟读取一次插件，插件以 60 秒的分辨率读取每台主机的 XAPI 循环数据库（round-robin）。代理保留 `xcp_*` 序列，并把每个序列的资源池移到它发送的批次上，作为 `xcp_ng.pool.id`（资源池的 UUID，永不改变）和 `xcp_ng.pool.name`：",
  "| Category | Series |": "| 类别 | 序列 |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **资源池** | `xcp_pool_connected`——只要 Xen Orchestra 与该资源池保持连接就存在 |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **主机** | `xcp_host_status`（电源状态及是否已启用）、`xcp_host_uptime_seconds`、`xcp_host_cpu_average`、`xcp_host_load_average`、`xcp_host_memory_*`、`xcp_host_running_vcpus`、按接口的 `xcp_host_network_*`、按存储库的 `xcp_host_disk_*` |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **虚拟机** | `xcp_vm_status`、`xcp_vm_uptime_seconds`、`xcp_vm_cpu_usage`、`xcp_vm_runstate_*`（CPU 争用）、`xcp_vm_memory_*`、按接口的 `xcp_vm_network_*`、按磁盘的 `xcp_vm_disk_*`、`xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **存储** | `xcp_sr_physical_size_bytes`、`xcp_sr_physical_usage_bytes`、`xcp_sr_virtual_size_bytes`、`xcp_vdi_virtual_size_bytes`、`xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*`，用于运行 XOSTOR 的资源池 |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    '控制域以带有 `is_control_domain="true"` 的虚拟机形式报告；除非你要求显示，否则页面会隐藏它们。',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "Xen Orchestra 把八个吞吐量序列标为计数器，尽管每个序列存放的都是 XAPI 的每秒速率：`xcp_host_network_receive_bytes_total`、`xcp_host_network_transmit_bytes_total`，以及虚拟机的网络、网络错误和磁盘读写序列。代理会在不改动其值的情况下把它们转换为仪表（gauge），因此 OneUptime 会按它们本来的速率存储，单位为每秒字节数或错误数。",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "OneUptime 为每个资源池添加四个 0/1 序列，供警报模板读取：`xcp_ng.host.running`、`xcp_ng.host.enabled`、`xcp_ng.vm.running` 和 `xcp_ng.vm.stopped_after_running`（过去一天内运行过、现已停止或暂停的虚拟机）。它还会给每个数据点加上 `xcp_ng.scope`（`pool`、`host`、`vm`、`sr`、`vdi` 或 `xostor`）和 `xcp_ng.id`（该对象的 UUID），监视器和仪表板据此筛选。",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "不保留的内容：不属于任何资源池的 Xen Orchestra 自身进程序列（`xo_*`），以及通过 IPMI 读取、插件发送时不带资源池的主机功率。其中每台虚拟机的估算份额会保留。",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with a container name of its own — two containers cannot share one:":
    "一个代理读取一个 Xen Orchestra 及其管理的每个资源池。对于第二个 Xen Orchestra，请在单独的文件夹中安装第二个代理，并使用它自己的容器名称——两个容器不能共用一个名称：",
  "Without `XCP_NG_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `XCP_NG_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "若未设置 `XCP_NG_AGENT_CONTAINER_NAME`，脚本会按文件夹为容器命名。它会把名称保存在该代理的 `.env` 中，所以再次运行脚本来升级代理时会保留它；而你曾在 `docker-compose.yml` 中编辑过 `container_name` 的代理，也会保留那个名称。使用 Docker Compose 时，请改为在每个代理的 `.env` 中设置 `XCP_NG_AGENT_CONTAINER_NAME`。",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "不要同时读取管理同一资源池的两个 Xen Orchestra：按其 UUID，该资源池在 OneUptime 中是同一个资源池，会被报告两次。",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "任何带有 `oneuptime.label.` 前缀的资源属性，都会成为代理所读取的每个资源池上的项目标签：`oneuptime.label.<dimension>=<value>` 即标签 `<dimension>:<value>`。将它们添加到 `otel-collector-config.yaml` 的 `resource` 处理器中，放在 `oneuptime.agent.version` 旁边：",
  "Then restart the collector so it reads the new config:":
    "然后重启收集器，让它读取新配置：",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "资源池会带着 `team:platform` 和 `env:production` 标签出现。标签匹配不区分大小写，因此会复用现有的 `Production` 标签；在 OneUptime 界面中添加的标签永远不会被代理删除。再次运行安装脚本会替换编辑过的 `otel-collector-config.yaml`，并把你的版本以 `otel-collector-config.yaml.bak.<timestamp>` 保留在旁边。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**升级**——收集器镜像固定在 `docker-compose.yml` 中，其配置是旁边的一个文件，所以仅拉取镜像并不会让代理更新。请再次运行安装脚本。它会沿用你现有 `.env` 中的每个值（不会再询问任何内容），以同样的方式校验 Xen Orchestra 的证书，下载最新的 `docker-compose.yml` 和 `otel-collector-config.yaml`（你编辑过的文件会以 `<file>.bak.<timestamp>` 保留在新文件旁边），拉取镜像并用它重新创建代理：",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "配置会把它固定的收集器版本报告为每个资源池的 **代理版本**。当这个 OneUptime 固定了更新的版本时，旁边的警告标志会打开这些命令。",
  "**Uninstall** the agent:": "**卸载**代理：",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "然后，如果没有其他程序读取 OpenMetrics 插件，就在 Xen Orchestra 中将其关闭。",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh` 会检查整条链路——容器、依据 `xo-ca.pem` 校验的 Xen Orchestra 证书、插件及其密钥、它报告的资源池——并直接询问 OneUptime 是否接受你的摄取密钥。最后这项检查最重要：OneUptime 的 OTLP 端点会以 `401` 或 `422` 拒绝错误的密钥，而收集器只会为每个批次记录一行很容易漏看的 `Exporting failed`。",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "最后它会给出判定，指出最可能的原因。它从不打印密钥。",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "如果 15 分钟内没有为某个资源池读取到任何内容，OneUptime 会将其标为“已断开”。",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. 如果这个 Xen Orchestra 的所有资源池都是“已断开”，请检查代理（在 `/opt/oneuptime-xcp-ng-agent` 中）：`docker compose ps` 和 `docker compose logs oneuptime-xcp-ng-agent | grep -i error`。",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. 如果只有一个是，说明 Xen Orchestra 停止报告它了：在 Xen Orchestra 的 *Settings → Servers* 中，该资源池的服务器必须处于已连接状态。资源池的主机、虚拟机和存储会保持 Xen Orchestra 最后报告时的样子。",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "收集器会记录 `server returned HTTP status 401 Unauthorized`。从 *Settings → Plugins → openmetrics* 重新复制密钥，在 `.env` 中把 `XO_OPENMETRICS_SECRET` 设为它（用单引号括起，每个 `$` 写成 `$$`），然后在 `/opt/oneuptime-xcp-ng-agent` 中用 `docker compose up -d` 应用。在 6.8 之前，Xen Orchestra 每次重启都会生成一个新密钥。",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'Xen Orchestra 有应答，但其 OpenMetrics 插件没有。在 *Settings → Plugins → openmetrics* 中启用插件（XOA 需要 Premium 许可证才能使用），并确认 Xen Orchestra 为 6.9 或更高版本。插件运行时，`/openmetrics/health` 无需密钥即可应答 `{"status":"ok"}`。',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names`——证书的名称中不含任何地址，Xen Orchestra 自己的自签名证书就是这样。请为 Xen Orchestra 配置一个名称中包含其地址的证书。",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>`——请连接到其中一个名称，或把 `XO_TLS_SERVER_NAME` 设为其中之一。",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority`——`xo-ca.pem` 中既没有这个证书，也没有签发它的 CA。证书已续期，或者文件中放的是别的证书：请按高级中的 **Xen Orchestra 的证书** 所述重新写入。",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "Xen Orchestra 只报告与它相连的资源池，而代理只读取这个 Xen Orchestra。在 Xen Orchestra 的 *Settings → Servers* 中连接该资源池的服务器；下次读取时，资源池就会出现在 OneUptime 中。由另一个 Xen Orchestra 读取的资源池，需要在那个 Xen Orchestra 旁边另配一个代理。",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **这个 Xen Orchestra 的名称**——命令中已经将其命名为 **`xo-paris`**，与这个资源池的设置中显示的一致。",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "该命令已经带有你的 OneUptime URL 和摄取密钥。其余内容由脚本询问：",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "从此 OneUptime 下载 `docker-compose.yml` 和 `otel-collector-config.yaml` 到一个新文件夹：",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "在它们旁边创建一个 `.env` 文件——它保存着插件的密钥，因此请用 `chmod 600 .env` 将其设为私有：",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- 把 `XO_ADDRESS` 设为 Xen Orchestra 的 `host` 或 `host:port`，不带 `https://`。",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- 把插件的密钥放在单引号之间。如果其中有 `$`，请把每个都写成 `$$`：收集器会再读取一次该值。",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` 是每个资源池的设置中对这个 Xen Orchestra 的称呼。",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "然后把 Xen Orchestra 的证书交给代理，作为 `docker-compose.yml` 旁边的 `xo-ca.pem`——代理只依据这个文件校验 Xen Orchestra。若要信任 Xen Orchestra 自己的证书，请读取它，并将其指纹与 Xen Orchestra 所在机器上的指纹核对：",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "如果证书由你自己的 CA 签发，请改为把该 CA 的证书复制到 `xo-ca.pem`；如果由公共 CA 签发，请复制这台机器的 CA 证书包（`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`）。",
  "Start the agent:": "启动代理：",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中选择一个摄取密钥，以填入 `<YOUR_API_KEY>`。",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "代理从 `docker-compose.yml` 旁边的 `.env` 文件读取这些值。更改其中任何一项后，在 `docker-compose.yml` 所在的文件夹中用 `docker compose up -d` 应用它。",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "如果证书用不同于 `XO_ADDRESS` 中地址的名称来标识 Xen Orchestra，请把 `XO_TLS_SERVER_NAME` 设为该名称。当 `xo-ca.pem` 中的证书续期时，请按第 3 步重新读取，然后运行 `docker compose up -d --force-recreate`。",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "在代理的文件夹（即 `docker-compose.yml` 所在的文件夹）中运行这些命令。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**升级**——收集器镜像固定在 `docker-compose.yml` 中，其配置是旁边的一个文件，所以仅拉取镜像并不会让代理更新。请重新下载这两个文件；你的 `.env` 和 `xo-ca.pem` 会保留，而你对其中任一文件做过的更改需要重新做一遍：",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "然后拉取镜像并重新创建代理，让收集器读取新配置：",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. 如果这个 Xen Orchestra 的所有资源池都是“已断开”，请检查代理（在代理的文件夹中）：`docker compose ps` 和 `docker compose logs oneuptime-xcp-ng-agent | grep -i error`。",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "收集器会记录 `server returned HTTP status 401 Unauthorized`。从 *Settings → Plugins → openmetrics* 重新复制密钥，在 `.env` 中把 `XO_OPENMETRICS_SECRET` 设为它（用单引号括起，每个 `$` 写成 `$$`），然后在 `docker-compose.yml` 所在的文件夹中用 `docker compose up -d` 应用。在 6.8 之前，Xen Orchestra 每次重启都会生成一个新密钥。",
};

export default TRANSLATION;
