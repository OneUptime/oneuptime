import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The VMware setup guide in Simplified Chinese (#8341): each piece of the English
 * guide's markdown (Pages/VMware/Utils/DocumentationMarkdown.ts) and its
 * Simplified Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Simplified Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach vCenter over HTTPS (TCP 443) — ideally not a VM on the cluster it watches":
    "Docker Engine 20.10 及以上版本并带有 Docker Compose v2 插件，所在机器能通过 HTTPS（TCP 443）访问 vCenter——最好不是它所监控的集群上的虚拟机",
  "vCenter Server or ESXi **7.0 or later** (the collector's `vcenter` receiver supports vSphere 7 and 8)":
    "vCenter Server 或 ESXi **7.0 或更高版本**（收集器的 `vcenter` 接收器支持 vSphere 7 和 8）",
  "One agent per vCenter Server, or per standalone ESXi host that no vCenter manages":
    "每个 vCenter Server 一个代理，或每个不受任何 vCenter 管理的独立 ESXi 主机一个代理",
  "1. Create the account: *Menu → Administration → Single Sign On → Users and Groups*, pick the `vsphere.local` domain (or your identity source), **Add** a user such as `oneuptime` and set a password. This yields the principal `oneuptime@vsphere.local`.":
    "1. 创建账户：在 *Menu → Administration → Single Sign On → Users and Groups* 中选择 `vsphere.local` 域（或你的身份源），用 **Add** 添加一个用户，例如 `oneuptime`，并设置密码。这样就得到主体 `oneuptime@vsphere.local`。",
  "2. Grant the role: select the top-level **vCenter Server** object in the *Hosts and Clusters* inventory, open the **Permissions** tab, click **Add**, choose the user, set the role to **Read-Only**, and tick **Propagate to children**.":
    "2. 授予角色：在 *Hosts and Clusters* 清单中选中顶层的 **vCenter Server** 对象，打开 **Permissions** 选项卡，点击 **Add**，选择该用户，将角色设为 **Read-Only**，并勾选 **Propagate to children**。",
  "Propagation is the part people miss. The receiver walks datacenters → clusters → hosts → VMs → datastores → resource pools, and every object the user cannot see is silently absent from the metrics — a Read-Only role granted on the vCenter object *without* propagation yields an inventory with nothing in it.":
    "传播是人们最容易漏掉的一步。接收器会依次遍历数据中心 → 集群 → 主机 → 虚拟机 → 数据存储 → 资源池，用户看不到的每个对象都会悄无声息地从指标中缺失——在 vCenter 对象上授予 Read-Only 角色却 *不* 传播，得到的清单将是空的。",
  "From a machine with administrator credentials:":
    "在具有管理员凭据的机器上：",
  "This creates `oneuptime@vsphere.local` with the Read-Only role on the vCenter root, propagated to every object below it.":
    "这会创建 `oneuptime@vsphere.local`，并在 vCenter 根上授予 Read-Only 角色，传播到其下的每个对象。",
  "For an ESXi host that no vCenter manages, create the user under *Host → Manage → Security & Users → Users* in the ESXi Host Client, and assign it the Read-Only role under *Host → Manage → Security & Users → Permissions*.":
    "对于不受任何 vCenter 管理的 ESXi 主机，在 ESXi Host Client 的 *Host → Manage → Security & Users → Users* 下创建用户，并在 *Host → Manage → Security & Users → Permissions* 下为其分配 Read-Only 角色。",
  "In the next step, use the host itself as the endpoint (`https://esxi01.example.com`) with this local user. Everything the host knows is collected — the host, its VMs, datastores and resource pools; a standalone host has no datacenter or cluster object, so those pages stay empty.":
    "在下一步中，把主机本身用作端点（`https://esxi01.example.com`），并使用这个本地用户。主机知道的一切都会被收集——主机本身、它的虚拟机、数据存储和资源池；独立主机没有数据中心或集群对象，因此那些页面会保持为空。",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "脚本会询问你的 OneUptime URL 和摄取密钥，两者都显示在第 1 步中（在那里选择一个密钥即可在此处填好），然后询问：",
  "- **vCenter name** — how the vCenter appears in OneUptime. Give every vCenter its own and keep it stable: a new name registers a new vCenter.":
    "- **vCenter 名称**：vCenter 在 OneUptime 中显示的名称。为每个 vCenter 取一个独有的名称并保持不变：新名称会注册为一个新的 vCenter。",
  "- **vCenter endpoint** — scheme and host, without `/sdk`, e.g. `https://vcsa.example.com`.":
    "- **vCenter 端点**：协议和主机，不带 `/sdk`，例如 `https://vcsa.example.com`。",
  "- **The read-only user and its password** — the password is read without echo.":
    "- **只读用户及其密码**：输入密码时不回显。",
  "- **TLS verification** — whether to skip it, since vCenter ships a self-signed certificate by default; and the **collection interval** (`2m`).":
    "- **TLS 验证**：是否跳过它，因为 vCenter 默认使用自签名证书；以及 **收集间隔**（`2m`）。",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **OneUptime AI 代理**：是否允许它应用修复；回答 **N** 可使其保持只读。",
  "It installs to `/opt/oneuptime-vmware-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Values are quoted for Docker Compose as they are written, so a password containing `$`, `#`, spaces or quotes works exactly as typed, and re-running the script reuses everything in an existing `.env` instead of prompting again.":
    "它会安装到 `/opt/oneuptime-vmware-agent`，写入一个权限为 `0600` 的 `.env` 文件，并用 Docker Compose 启动代理。值会按输入的原样为 Docker Compose 加上引号，因此包含 `$`、`#`、空格或引号的密码会完全按你输入的那样生效；再次运行脚本时，它会复用现有 `.env` 中的所有内容，而不会再次询问。",
  "Look for `Everything is ready. Begin running and processing data.` in the logs — then give it one collection interval (2 minutes by default): nothing is sent until the first full inventory walk completes. The vCenter then appears automatically in the **VMware** section, with its datacenters, clusters, ESXi hosts, virtual machines, datastores and resource pools inventoried.":
    "在日志中查找 `Everything is ready. Begin running and processing data.`——然后等待一个收集间隔（默认 2 分钟）：在第一次完整遍历清单之前不会发送任何数据。之后该 vCenter 会自动出现在 **VMware** 部分，其数据中心、集群、ESXi 主机、虚拟机、数据存储和资源池都会列入清单。",
  "`docker compose ps` also lists **`oneuptime-vmware-ai-agent`**, the OneUptime AI agent — see **OneUptime AI agent** under Advanced.":
    "`docker compose ps` 还会列出 OneUptime AI 代理 **`oneuptime-vmware-ai-agent`**——参见“高级”中的 **OneUptime AI 代理**。",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this vCenter with read-only `govc` commands, and changes nothing unless you allow fixes.":
    "**OneUptime AI 代理（默认开启，只读）。** AI 调查已开启：它让 OneUptime AI 用只读的 `govc` 命令调查此 vCenter 上的事件和警报，除非你允许修复，否则不会更改任何内容。",
  "The install script writes these to `/opt/oneuptime-vmware-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-vmware-agent`.":
    "安装脚本会把这些写入 `/opt/oneuptime-vmware-agent/.env`。更改其中任何一项后，在 `/opt/oneuptime-vmware-agent` 中用 `docker compose up -d` 应用它。",
  "| Variable | Required | Description |": "| 变量 | 必填 | 说明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 实例的 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 是 | 遥测摄取密钥，即第 1 步中选择的那个 |",
  "| `VMWARE_VCENTER_NAME` | Yes | The name this vCenter registers under in OneUptime. Stamped on every metric as the `vmware.vcenter.name` resource attribute. Keep it stable — changing it registers a new vCenter (default: `vmware-vcenter`) |":
    "| `VMWARE_VCENTER_NAME` | 是 | 此 vCenter 在 OneUptime 中注册所用的名称。以 `vmware.vcenter.name` 资源属性的形式打在每条指标上。请保持不变——更改它会注册一个新的 vCenter（默认：`vmware-vcenter`） |",
  "| `VCENTER_ENDPOINT` | Yes | Scheme + host of vCenter Server or a standalone ESXi host, **without** `/sdk`, e.g. `https://vcsa.example.com` |":
    "| `VCENTER_ENDPOINT` | 是 | vCenter Server 或独立 ESXi 主机的协议 + 主机，**不带** `/sdk`，例如 `https://vcsa.example.com` |",
  "| `VCENTER_USERNAME` | Yes | vSphere user with the Read-Only role, e.g. `oneuptime@vsphere.local` (or `DOMAIN\\user` for an Active Directory identity source) |":
    "| `VCENTER_USERNAME` | 是 | 具有 Read-Only 角色的 vSphere 用户，例如 `oneuptime@vsphere.local`（Active Directory 身份源则为 `DOMAIN\\user`） |",
  "| `VCENTER_PASSWORD` | Yes | That user's password. If it contains `$`, `#`, spaces or quotes, single-quote it in `.env` (the install script does this for you) |":
    "| `VCENTER_PASSWORD` | 是 | 该用户的密码。如果包含 `$`、`#`、空格或引号，请在 `.env` 中用单引号括起来（安装脚本会替你这样做） |",
  "| `VCENTER_INSECURE_SKIP_VERIFY` | No | `true` to accept vCenter's default self-signed (VMCA) certificate; `false` keeps TLS verification on (default: `false`) |":
    "| `VCENTER_INSECURE_SKIP_VERIFY` | 否 | 设为 `true` 以接受 vCenter 默认的自签名（VMCA）证书；`false` 保持 TLS 验证开启（默认：`false`） |",
  "| `VCENTER_COLLECTION_INTERVAL` | No | How often the whole inventory is polled. Raise to `5m` or `10m` for very large vCenters (default: `2m`) |":
    "| `VCENTER_COLLECTION_INTERVAL` | 否 | 轮询整个清单的频率。对于非常大的 vCenter，可提高到 `5m` 或 `10m`（默认：`2m`） |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI 代理自己的设置见 **OneUptime AI 代理** 部分。",
  "This is the `docker-compose.yml` the agent runs (the `.env` file supplies the values). The collector image is pinned; when a newer OneUptime release bumps the pin, download both files again before pulling:":
    "这是代理运行的 `docker-compose.yml`（值由 `.env` 文件提供）。收集器镜像版本是固定的；当较新的 OneUptime 版本提升了固定的版本时，请在拉取之前重新下载这两个文件：",
  "And the full `otel-collector-config.yaml`. The `resource` processor stamps the `vmware.vcenter.name` attribute that registers the vCenter in OneUptime and that every VMware page, monitor and alert template scopes on — keep it in place if you customize the config. The `batch` processor deliberately has no `send_batch_max_size`: OneUptime reads a whole collection per request to sum inventory counts and infer VM power state, so a collection must never be split across exports:":
    "以及完整的 `otel-collector-config.yaml`。`resource` 处理器会打上 `vmware.vcenter.name` 属性：vCenter 凭它在 OneUptime 中注册，每个 VMware 页面、监控器和警报模板也都以它限定范围——自定义配置时请保留它。`batch` 处理器有意不设 `send_batch_max_size`：OneUptime 每个请求读取一次完整的收集，用来汇总清单计数并推断虚拟机电源状态，因此一次收集绝不能拆分到多次导出中：",
  "Every `VCENTER_COLLECTION_INTERVAL` the receiver walks the full vSphere inventory and emits one OpenTelemetry resource per object. Identity lives in **resource attributes** — `vcenter.datacenter.name`, `vcenter.cluster.name`, `vcenter.host.name`, `vcenter.vm.name` / `vcenter.vm.id`, `vcenter.datastore.name`, `vcenter.resource_pool.name` / `vcenter.resource_pool.inventory_path` — and the agent adds `vmware.vcenter.name` on top so OneUptime can route everything to your vCenter.":
    "每隔一个 `VCENTER_COLLECTION_INTERVAL`，接收器会遍历整个 vSphere 清单，并为每个对象发出一个 OpenTelemetry 资源。标识位于 **资源属性** 中——`vcenter.datacenter.name`、`vcenter.cluster.name`、`vcenter.host.name`、`vcenter.vm.name` / `vcenter.vm.id`、`vcenter.datastore.name`、`vcenter.resource_pool.name` / `vcenter.resource_pool.inventory_path`——代理还会在此之上添加 `vmware.vcenter.name`，让 OneUptime 能把所有数据都归到你的 vCenter。",
  "| vSphere object | Identity (resource attributes) | Metrics |":
    "| vSphere 对象 | 标识（资源属性） | 指标 |",
  "| **Datacenter** | `vcenter.datacenter.name` | `vcenter.datacenter.cluster.count{status}`, `.host.count{status,power_state}`, `.vm.count{status,power_state}`, `.datastore.count`, `.disk.space{disk_state}`, `.cpu.limit`, `.memory.limit` |":
    "| **数据中心** | `vcenter.datacenter.name` | `vcenter.datacenter.cluster.count{status}`, `.host.count{status,power_state}`, `.vm.count{status,power_state}`, `.datastore.count`, `.disk.space{disk_state}`, `.cpu.limit`, `.memory.limit` |",
  "| **Cluster** | + `vcenter.cluster.name` | `vcenter.cluster.cpu.effective`, `.cpu.limit`, `.memory.effective`, `.memory.limit`, `.host.count{effective}`, `.vm.count{power_state}`, `.vm_template.count`, `vcenter.cluster.vsan.*` |":
    "| **集群** | + `vcenter.cluster.name` | `vcenter.cluster.cpu.effective`, `.cpu.limit`, `.memory.effective`, `.memory.limit`, `.host.count{effective}`, `.vm.count{power_state}`, `.vm_template.count`, `vcenter.cluster.vsan.*` |",
  "| **ESXi host** | + `vcenter.host.name` (and `vcenter.cluster.name` when clustered) | `vcenter.host.cpu.usage` / `.capacity` / `.utilization` / `.reserved`, `.memory.usage` / `.utilization` / `.capacity`, `.disk.latency.avg` / `.latency.max` / `.throughput`, `.network.usage` / `.throughput` / `.packet.rate` / `.packet.drop.rate` / `.packet.error.rate`, `vcenter.host.vsan.*` |":
    "| **ESXi 主机** | + `vcenter.host.name`（位于集群中时还有 `vcenter.cluster.name`） | `vcenter.host.cpu.usage` / `.capacity` / `.utilization` / `.reserved`, `.memory.usage` / `.utilization` / `.capacity`, `.disk.latency.avg` / `.latency.max` / `.throughput`, `.network.usage` / `.throughput` / `.packet.rate` / `.packet.drop.rate` / `.packet.error.rate`, `vcenter.host.vsan.*` |",
  "| **Virtual machine** | + `vcenter.host.name`, `vcenter.vm.name`, `vcenter.vm.id` (instance UUID); `vcenter.resource_pool.*` or `vcenter.virtual_app.*` | `vcenter.vm.disk.usage{disk_state}`, `.disk.utilization`, `.memory.usage` / `.utilization` / `.ballooned` / `.swapped` / `.swapped_ssd`; **powered-on VMs only:** `.cpu.usage`, `.cpu.readiness`, `.cpu.utilization`, `.disk.latency.*` / `.throughput`, `.network.*`, `vcenter.vm.vsan.*` |":
    "| **虚拟机** | + `vcenter.host.name`、`vcenter.vm.name`、`vcenter.vm.id`（实例 UUID）；`vcenter.resource_pool.*` 或 `vcenter.virtual_app.*` | `vcenter.vm.disk.usage{disk_state}`, `.disk.utilization`, `.memory.usage` / `.utilization` / `.ballooned` / `.swapped` / `.swapped_ssd`；**仅限已开机的虚拟机：** `.cpu.usage`, `.cpu.readiness`, `.cpu.utilization`, `.disk.latency.*` / `.throughput`, `.network.*`, `vcenter.vm.vsan.*` |",
  "| **VM template** | `vcenter.vm_template.name`, `vcenter.vm_template.id` | `vcenter.vm.disk.usage{disk_state}` only |":
    "| **虚拟机模板** | `vcenter.vm_template.name`、`vcenter.vm_template.id` | 仅 `vcenter.vm.disk.usage{disk_state}` |",
  "| **Datastore** | + `vcenter.datastore.name` | `vcenter.datastore.disk.usage{disk_state}`, `.disk.utilization` |":
    "| **数据存储** | + `vcenter.datastore.name` | `vcenter.datastore.disk.usage{disk_state}`, `.disk.utilization` |",
  "| **Resource pool** | + `vcenter.resource_pool.name`, `vcenter.resource_pool.inventory_path` | `vcenter.resource_pool.cpu.usage` / `.cpu.shares`, `.memory.usage{type}` / `.memory.shares` / `.memory.ballooned` / `.memory.swapped` / `.memory.granted{type}` |":
    "| **资源池** | + `vcenter.resource_pool.name`、`vcenter.resource_pool.inventory_path` | `vcenter.resource_pool.cpu.usage` / `.cpu.shares`, `.memory.usage{type}` / `.memory.shares` / `.memory.ballooned` / `.memory.swapped` / `.memory.granted{type}` |",
  "Datapoint attributes (`{...}` above) are what you filter and group by in monitor criteria: `direction` (`read`/`write`, `transmitted`/`received`), `disk_state` (`available`/`used`), `status` (`red`/`yellow`/`green`/`gray`), `effective` (`true`/`false`), `power_state` (`on`/`off`/`standby`/`suspended`/`unknown`), `object` (the NIC or disk instance), `cpu_reservation_type` (`total`/`used`) and `type`. In OneUptime, resource attributes are `resource.`-prefixed (`resource.vcenter.host.name`) and datapoint attributes are bare (`disk_state`). Units are the receiver's own: MHz for CPU usage and capacity, `%` for utilization and CPU readiness, MiB for host/VM/resource-pool memory, bytes for cluster and datacenter memory and all disk space, `ms` for disk latency and `µs` for vSAN latency.":
    "数据点属性（上面的 `{...}`）是你在监控器条件中用来筛选和分组的依据：`direction`（`read`/`write`、`transmitted`/`received`）、`disk_state`（`available`/`used`）、`status`（`red`/`yellow`/`green`/`gray`）、`effective`（`true`/`false`）、`power_state`（`on`/`off`/`standby`/`suspended`/`unknown`）、`object`（网卡或磁盘实例）、`cpu_reservation_type`（`total`/`used`）以及 `type`。在 OneUptime 中，资源属性带有 `resource.` 前缀（`resource.vcenter.host.name`），数据点属性则不带前缀（`disk_state`）。单位沿用接收器自己的：CPU 使用量和容量用 MHz，利用率和 CPU 就绪度用 `%`，主机、虚拟机和资源池的内存用 MiB，集群和数据中心的内存以及所有磁盘空间用字节，磁盘延迟用 `ms`，vSAN 延迟用 `µs`。",
  "The receiver does not export a per-VM power-state metric. Instead it emits `vcenter.vm.cpu.*` **only for powered-on VMs**, so OneUptime infers the state from what arrived in each collection: a VM that reported CPU metrics is *powered on*; one that reported only memory and disk usage is *powered off* (or suspended — vSphere does not tell them apart here). This inference reads a whole collection at a time, which is why the shipped `batch` processor has a large `send_batch_size` and deliberately no `send_batch_max_size`: a collection split across two exports would zero inventory counts and flip VMs to off. Keep the batch settings as shipped.":
    "接收器不会导出按虚拟机划分的电源状态指标。它 **只为已开机的虚拟机** 发出 `vcenter.vm.cpu.*`，因此 OneUptime 根据每次收集中到达的内容推断状态：报告了 CPU 指标的虚拟机是 *已开机*；只报告了内存和磁盘使用量的虚拟机是 *已关机*（或已挂起——vSphere 在这里不区分两者）。这种推断一次读取一整次收集，所以随附的 `batch` 处理器设置了较大的 `send_batch_size`，并有意不设 `send_batch_max_size`：一次收集若拆分到两次导出中，会让清单计数归零，并把虚拟机翻转为关机。请保持 batch 设置不变。",
  "By default the agent ships **metrics only** — the Logs tab of the vCenter dashboard stays empty until you enable a log receiver. The shipped config contains a commented-out `syslog` receiver pair (TCP and UDP on port 5514, RFC 3164 — ESXi's native format) wired to a commented `logs` pipeline that stamps `vmware.vcenter.name` so the logs land on this vCenter.":
    "默认情况下，代理 **只发送指标**——在你启用日志接收器之前，vCenter 仪表板的“日志”选项卡会一直是空的。随附的配置中包含一对已注释掉的 `syslog` 接收器（端口 5514 上的 TCP 和 UDP，RFC 3164——ESXi 的原生格式），连接到一条已注释掉的 `logs` 管道，该管道会打上 `vmware.vcenter.name`，让日志落到此 vCenter 上。",
  "1. **Uncomment the two `syslog/*` receivers and the `logs` pipeline** in `otel-collector-config.yaml`.":
    "1. 在 `otel-collector-config.yaml` 中 **取消注释两个 `syslog/*` 接收器和 `logs` 管道**。",
  "2. **Uncomment the `ports:` block** in `docker-compose.yml`, then apply it — and open the port on the machine's firewall for the ESXi management network:":
    "2. 在 `docker-compose.yml` 中 **取消注释 `ports:` 块**，然后应用它，并在机器的防火墙上为 ESXi 管理网络开放该端口：",
  "3. **Point every ESXi host at the agent.** Select the host, open *Configure → System → Advanced System Settings*, set `Syslog.global.logHost` to `udp://<agent-host>:5514` (or `tcp://`), then allow the outbound traffic under *Configure → System → Firewall → Edit → syslog*. Or per host with `esxcli`:":
    "3. **让每台 ESXi 主机指向代理。** 选中主机，打开 *Configure → System → Advanced System Settings*，将 `Syslog.global.logHost` 设为 `udp://<agent-host>:5514`（或 `tcp://`），然后在 *Configure → System → Firewall → Edit → syslog* 下允许出站流量。也可以用 `esxcli` 逐台主机设置：",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project label and attached to the vCenter. Add the attributes to the `resource` processor in `otel-collector-config.yaml`, next to `vmware.vcenter.name`:":
    "任何以 `oneuptime.label.` 为前缀的资源属性都会提升为项目标签并附加到 vCenter 上。在 `otel-collector-config.yaml` 的 `resource` 处理器中，在 `vmware.vcenter.name` 旁边添加这些属性：",
  "Then restart the collector so it reads the new config:":
    "然后重启收集器，让它读取新配置：",
  "The vCenter shows up tagged `team:platform` and `env:production`. Labels added manually in the OneUptime UI are never removed by the agent.":
    "该 vCenter 会带着 `team:platform` 和 `env:production` 标签显示。在 OneUptime 界面中手动添加的标签永远不会被代理删除。",
  "`docker-compose.yml` also runs **`oneuptime-vmware-ai-agent`**. While OneUptime AI investigates an incident or alert on this vCenter, it runs `govc` commands through it — a VM's power state, the host it runs on, recent events and tasks, performance counters. It logs in with the vCenter credentials from the same `.env` (OneUptime never sends it any), registers as the vCenter named `VMWARE_VCENTER_NAME`, and appears on the vCenter's **AI → AI agent** page.":
    "`docker-compose.yml` 还会运行 **`oneuptime-vmware-ai-agent`**。当 OneUptime AI 调查此 vCenter 上的事件或警报时，会通过它运行 `govc` 命令——虚拟机的电源状态、它所在的主机、最近的事件和任务、性能计数器。它使用同一个 `.env` 中的 vCenter 凭据登录（OneUptime 从不向它发送任何凭据），注册为名为 `VMWARE_VCENTER_NAME` 的 vCenter，并出现在该 vCenter 的 **人工智能 → AI 代理** 页面上。",
  "- **The vSphere role is the hard limit.** With the collector's Read-Only user it can read and nothing else.":
    "- **vSphere 角色是硬性上限。** 使用收集器的 Read-Only 用户时，它只能读取，别无其他。",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — powering a VM back on, a guest reboot — also need a vSphere user of its own whose role allows them, set as `ONEUPTIME_AI_VCENTER_USERNAME` / `ONEUPTIME_AI_VCENTER_PASSWORD`; the agent's README has the `govc` commands for that role. The install script asks about fixes on a fresh install and writes these settings for you.":
    "- 除非设置 `ONEUPTIME_AI_ALLOW_WRITES=true`，否则它是 **只读** 的。修复操作（重新打开虚拟机电源、重启客户机）还需要一个专用的 vSphere 用户，其角色允许这些操作，通过 `ONEUPTIME_AI_VCENTER_USERNAME` / `ONEUPTIME_AI_VCENTER_PASSWORD` 设置；代理的 README 中有该角色所需的 `govc` 命令。 全新安装时，安装脚本会询问是否允许修复，并替你写入这些设置。",
  "- It never changes the VM named after the host in `VCENTER_ENDPOINT` — normally the vCenter appliance. When the endpoint is an IP address, or the appliance's VM has another name, put that VM's name in `ONEUPTIME_AI_PROTECTED_TARGETS`, together with the VM the agent runs on.":
    "- 它从不更改以 `VCENTER_ENDPOINT` 中的主机命名的虚拟机——通常就是 vCenter 设备。当端点是 IP 地址，或设备的虚拟机另有名称时，请把该虚拟机的名称连同代理所在的虚拟机一起放入 `ONEUPTIME_AI_PROTECTED_TARGETS`。",
  "- Check it: `docker exec oneuptime-vmware-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- 检查它：`docker exec oneuptime-vmware-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-vmware-ai-agent` service from `docker-compose.yml`.":
    "- 不使用 OneUptime AI？从 `docker-compose.yml` 中删除 `oneuptime-vmware-ai-agent` 服务。",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#vmware-vcenter).":
    "它可以运行什么以及修复如何进行：[基础设施 AI 代理](/docs/ai/infrastructure-ai-agents#vmware-vcenter)。",
  "**Upgrade** — re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml`, and recreates the agent with them:":
    "**升级**——重新运行安装脚本。它会复用现有 `.env` 中的每个值（不会再次询问），下载最新的 `docker-compose.yml` 和 `otel-collector-config.yaml`，并用它们重新创建代理：",
  "The config reports the collector version it pins as the vCenter's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "该配置会把它固定的收集器版本报告为 vCenter 的 **代理版本**。当此 OneUptime 固定了更新的版本时，旁边的警告标志会打开这些命令。",
  "**Uninstall:**": "**卸载：**",
  "Then remove the `oneuptime` user's permission in vCenter (and the OneUptime AI fixes user's, if you created one) if you no longer need it.":
    "如果不再需要，再在 vCenter 中移除 `oneuptime` 用户的权限（如果你创建了 OneUptime AI 修复用户，也一并移除它的权限）。",
  "`troubleshoot.sh` checks the whole chain — container runtime, vCenter reachability and credentials, vCenter-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` 会检查整条链路——容器运行时、vCenter 的可达性和凭据、vCenter 名称的标记、令牌格式、收集器自身指标——并直接询问 OneUptime 是否接受你的摄取密钥。最后这项检查最重要：OneUptime 的 OTLP 端点会以 `401` 或 `422` 拒绝错误的密钥，而收集器只会为每个 batch 记录一行很容易漏看的 `Exporting failed`，因此脚本会向 `GET /otlp/v1/validate` 请求一个直接的 200/401 判定。",
  "It ends with a verdict naming the most likely cause.":
    "最后它会给出判定，指出最可能的原因。",
  "1. Check that the agent is running (in `/opt/oneuptime-vmware-agent`): `docker compose ps`":
    "1. 检查代理是否在运行（在 `/opt/oneuptime-vmware-agent` 中）：`docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-vmware-agent | grep -i error`":
    "2. 检查代理日志中的错误：`docker compose logs oneuptime-vmware-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. 确认你的 OneUptime URL 和摄取密钥正确。",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. 确保代理所在机器能通过网络访问 OneUptime 实例。",
  "1. Check the collector logs: a login error (`incorrect user name or password`, `InvalidLogin`) means bad credentials — or a password containing `$`, `#`, spaces or quotes that is not single-quoted in `.env` (Docker Compose expands `$VAR` and treats a space followed by `#` as a comment otherwise), `x509: certificate signed by unknown authority` means TLS verification is on against a self-signed certificate (set `VCENTER_INSECURE_SKIP_VERIFY=true`), `connection refused` / `no such host` means a wrong `VCENTER_ENDPOINT`.":
    "1. 检查收集器日志：登录错误（`incorrect user name or password`、`InvalidLogin`）表示凭据有误——或者是密码包含 `$`、`#`、空格或引号，却没有在 `.env` 中用单引号括起来（否则 Docker Compose 会展开 `$VAR`，并把空格后跟 `#` 视为注释）；`x509: certificate signed by unknown authority` 表示在使用自签名证书时开启了 TLS 验证（设置 `VCENTER_INSECURE_SKIP_VERIFY=true`）；`connection refused` / `no such host` 表示 `VCENTER_ENDPOINT` 有误。",
  "2. Verify the endpoint is reachable from the agent's network (the collector image is distroless, so test from alongside it) — you should see an XML document advertising `urn:vim25`:":
    "2. 确认从代理所在网络能访问端点（收集器镜像是 distroless 的，因此请在它旁边的机器上测试）——你应该会看到一个声明 `urn:vim25` 的 XML 文档：",
  "3. Make sure `VMWARE_VCENTER_NAME` is set — discovery keys on the `vmware.vcenter.name` resource attribute.":
    "3. 确保已设置 `VMWARE_VCENTER_NAME`——发现依据的是 `vmware.vcenter.name` 资源属性。",
  "4. Give it one collection interval: nothing is sent until the first full inventory walk completes.":
    "4. 等待一个收集间隔：在第一次完整遍历清单之前不会发送任何数据。",
  "Use the full principal — `oneuptime@vsphere.local`, or `DOMAIN\\user` / `user@domain.example` for an Active Directory identity source — and check how the password is written in `.env`. Docker Compose expands `$VAR` references in unquoted and double-quoted values and treats a space followed by `#` as the start of a comment, so a password containing `$`, `#`, spaces or quotes must be **single-quoted** — `VCENTER_PASSWORD='p@ss$word'`, which is what the install script writes. A password that itself contains a single quote goes in double quotes, with every `$` written as `$$` and `\"` / `\\` escaped with a backslash. A locked account (too many failed attempts) rejects a correct password too; check *Administration → Single Sign On → Users and Groups*.":
    "使用完整的主体名称（`oneuptime@vsphere.local`，Active Directory 身份源则为 `DOMAIN\\user` / `user@domain.example`），并检查密码在 `.env` 中的写法。Docker Compose 会展开未加引号和双引号值中的 `$VAR` 引用，并把空格后跟 `#` 视为注释的开始，因此包含 `$`、`#`、空格或引号的密码必须 **用单引号括起来**：`VCENTER_PASSWORD='p@ss$word'`，安装脚本写入的正是这种形式。本身包含单引号的密码要用双引号括起来，每个 `$` 写成 `$$`，`\"` / `\\` 用反斜杠转义。被锁定的账户（失败尝试次数过多）也会拒绝正确的密码；请检查 *Administration → Single Sign On → Users and Groups*。",
  "vCenter appliances present a certificate issued by their own VMCA, which no Docker image trusts. Either set `VCENTER_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network) or replace vCenter's machine certificate with one issued by a CA the collector image trusts. Do **not** point the endpoint at an `http://` URL — vCenter only serves the SDK over HTTPS.":
    "vCenter 设备出示的是由其自身 VMCA 签发的证书，任何 Docker 镜像都不信任它。要么设置 `VCENTER_INSECURE_SKIP_VERIFY=true`（在私有管理网络上这是务实的选择），要么用收集器镜像信任的 CA 签发的证书替换 vCenter 的机器证书。**不要** 把端点指向 `http://` URL——vCenter 只通过 HTTPS 提供 SDK。",
  "The Read-Only role was granted on the vCenter object without **Propagate to children**, or on a narrower object than the vCenter root. Objects the user cannot see are silently absent. Fix the permission on the top-level vCenter object with propagation enabled; the next collection fills in the inventory.":
    "Read-Only 角色是在没有 **Propagate to children** 的情况下授予 vCenter 对象的，或者授予了比 vCenter 根更窄的对象。用户看不到的对象会悄无声息地缺失。请在顶层 vCenter 对象上启用传播并修正权限；下一次收集就会填满清单。",
  "VM power state is inferred from the `vcenter.vm.cpu.*` datapoints arriving in the same collection as the VM's memory and disk datapoints (see **How VM power state is worked out** under Advanced). If you customized the `batch` processor and added a `send_batch_max_size`, a large inventory is split across exports and the CPU datapoints land in a different request — restore the shipped batch settings.":
    "虚拟机电源状态的推断依据是：`vcenter.vm.cpu.*` 数据点是否与该虚拟机的内存和磁盘数据点在同一次收集中到达（参见“高级”中的 **如何判断虚拟机的电源状态**）。如果你自定义了 `batch` 处理器并添加了 `send_batch_max_size`，大型清单就会被拆分到多次导出中，CPU 数据点会落在另一个请求里——请恢复随附的 batch 设置。",
  "Each collection is a full walk of the inventory plus one performance query per object batch. For vCenters with thousands of VMs raise `VCENTER_COLLECTION_INTERVAL` to `5m` or `10m` (a collection that takes longer than the interval is skipped, not overlapped), match `max_query_metrics` to your vCenter's `vpxd.stats.maxQueryMetrics` if the log reports `The maximum number of performance metrics per query exceeded`, and raise `limit_mib` if the memory limiter reports dropped data.":
    "每次收集都是对清单的一次完整遍历，外加每批对象一次性能查询。对于拥有数千台虚拟机的 vCenter，请把 `VCENTER_COLLECTION_INTERVAL` 提高到 `5m` 或 `10m`（耗时超过间隔的收集会被跳过，而不是重叠执行）；如果日志报告 `The maximum number of performance metrics per query exceeded`，请让 `max_query_metrics` 与你的 vCenter 的 `vpxd.stats.maxQueryMetrics` 一致；如果内存限制器报告丢弃了数据，请提高 `limit_mib`。",
  "The vCenter identity comes from `VMWARE_VCENTER_NAME`, stamped on every metric as `vmware.vcenter.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-vmware-agent` — note that a new name registers a new vCenter.":
    "vCenter 的标识来自 `VMWARE_VCENTER_NAME`，它以 `vmware.vcenter.name` 的形式打在每条指标上。在 `.env` 中修正它，并在 `/opt/oneuptime-vmware-agent` 中用 `docker compose up -d` 应用。注意，新名称会注册为一个新的 vCenter。",
  "- **vCenter name** — enter **`vcenter-1`** exactly; a different name registers a new vCenter.":
    "- **vCenter 名称**：准确输入 **`vcenter-1`**；换一个名称会注册一个新的 vCenter。",
  "The vCenter identity comes from `VMWARE_VCENTER_NAME`, stamped on every metric as `vmware.vcenter.name`. This vCenter is **`vcenter-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-vmware-agent` — note that a new name registers a new vCenter.":
    "vCenter 的标识来自 `VMWARE_VCENTER_NAME`，它以 `vmware.vcenter.name` 的形式打在每条指标上。此 vCenter 为 **`vcenter-1`**。在 `.env` 中修正它，并在 `/opt/oneuptime-vmware-agent` 中用 `docker compose up -d` 应用。注意，新名称会注册为一个新的 vCenter。",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "该命令已经带有你的 OneUptime URL 和摄取密钥。其余内容由脚本询问：",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "从此 OneUptime 下载 `docker-compose.yml` 和 `otel-collector-config.yaml` 到一个新文件夹：",
  "Create a `.env` file next to them:": "在它们旁边创建一个 `.env` 文件：",
  "- Replace `my-vcenter` with a name for this vCenter, such as `vcenter-prod`. It is how the vCenter appears in OneUptime, so keep it stable: a new name registers a new vCenter.":
    "- 把 `my-vcenter` 替换为此 vCenter 的名称，例如 `vcenter-prod`。这是该 vCenter 在 OneUptime 中显示的名称，因此请保持不变：新名称会注册为一个新的 vCenter。",
  "- Set `VCENTER_ENDPOINT` to the scheme and host of your vCenter, or of a standalone ESXi host, **without** `/sdk`.":
    "- 将 `VCENTER_ENDPOINT` 设为你的 vCenter（或独立 ESXi 主机）的协议和主机，**不带** `/sdk`。",
  "- Keep the password in single quotes: Docker Compose expands `$` and treats a space followed by `#` as a comment in unquoted values.":
    "- 让密码保持在单引号中：在未加引号的值中，Docker Compose 会展开 `$`，并把空格后跟 `#` 视为注释。",
  "- `VCENTER_INSECURE_SKIP_VERIFY=true` accepts vCenter's default self-signed (VMCA) certificate.":
    "- `VCENTER_INSECURE_SKIP_VERIFY=true` 会接受 vCenter 默认的自签名（VMCA）证书。",
  "It holds a password, so make it private, then start the agent:":
    "它包含密码，因此请把它设为仅自己可读，然后启动代理：",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步选择一个摄取密钥，即可填入 `<YOUR_API_KEY>`。",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "代理从 `docker-compose.yml` 旁边的 `.env` 文件读取这些值。更改其中任何一项后，在 `docker-compose.yml` 所在的文件夹中用 `docker compose up -d` 应用它。",
  "| `VCENTER_PASSWORD` | Yes | That user's password. If it contains `$`, `#`, spaces or quotes, single-quote it in `.env` — see **vCenter rejects the login** under Troubleshooting |":
    "| `VCENTER_PASSWORD` | 是 | 该用户的密码。如果包含 `$`、`#`、空格或引号，请在 `.env` 中用单引号括起来——参见“故障排除”中的 **vCenter 拒绝登录** |",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — powering a VM back on, a guest reboot — also need a vSphere user of its own whose role allows them, set as `ONEUPTIME_AI_VCENTER_USERNAME` / `ONEUPTIME_AI_VCENTER_PASSWORD`; the agent's README has the `govc` commands for that role. Set them in `.env` and run `docker compose up -d`.":
    "- 除非设置 `ONEUPTIME_AI_ALLOW_WRITES=true`，否则它是 **只读** 的。修复操作（重新打开虚拟机电源、重启客户机）还需要一个专用的 vSphere 用户，其角色允许这些操作，通过 `ONEUPTIME_AI_VCENTER_USERNAME` / `ONEUPTIME_AI_VCENTER_PASSWORD` 设置；代理的 README 中有该角色所需的 `govc` 命令。在 `.env` 中设置它们，然后运行 `docker compose up -d`。",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "在代理的文件夹（即 `docker-compose.yml` 所在的文件夹）中运行这些命令。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download `docker-compose.yml` and `otel-collector-config.yaml` again; your `.env` stays, and a change you made to either file has to be made again:":
    "**升级**——收集器镜像固定在 `docker-compose.yml` 中，其配置是旁边的一个文件，因此仅拉取镜像并不能让代理更新。重新下载 `docker-compose.yml` 和 `otel-collector-config.yaml`；你的 `.env` 会保留，而你对这两个文件做过的更改需要重新做一遍：",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "然后拉取镜像并重新创建代理，让收集器读取新配置：",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. 检查代理是否在运行（在代理所在的文件夹中）：`docker compose ps`",
  "Use the full principal — `oneuptime@vsphere.local`, or `DOMAIN\\user` / `user@domain.example` for an Active Directory identity source — and check how the password is written in `.env`. Docker Compose expands `$VAR` references in unquoted and double-quoted values and treats a space followed by `#` as the start of a comment, so a password containing `$`, `#`, spaces or quotes must be **single-quoted** — `VCENTER_PASSWORD='p@ss$word'`. A password that itself contains a single quote goes in double quotes, with every `$` written as `$$` and `\"` / `\\` escaped with a backslash. A locked account (too many failed attempts) rejects a correct password too; check *Administration → Single Sign On → Users and Groups*.":
    "使用完整的主体名称（`oneuptime@vsphere.local`，Active Directory 身份源则为 `DOMAIN\\user` / `user@domain.example`），并检查密码在 `.env` 中的写法。Docker Compose 会展开未加引号和双引号值中的 `$VAR` 引用，并把空格后跟 `#` 视为注释的开始，因此包含 `$`、`#`、空格或引号的密码必须 **用单引号括起来**：`VCENTER_PASSWORD='p@ss$word'`。本身包含单引号的密码要用双引号括起来，每个 `$` 写成 `$$`，`\"` / `\\` 用反斜杠转义。被锁定的账户（失败尝试次数过多）也会拒绝正确的密码；请检查 *Administration → Single Sign On → Users and Groups*。",
  "The vCenter identity comes from `VMWARE_VCENTER_NAME`, stamped on every metric as `vmware.vcenter.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new vCenter.":
    "vCenter 的标识来自 `VMWARE_VCENTER_NAME`，它以 `vmware.vcenter.name` 的形式打在每条指标上。在 `.env` 中修正它，并在 `docker-compose.yml` 所在的文件夹中用 `docker compose up -d` 应用。注意，新名称会注册为一个新的 vCenter。",
  "- This installs the agent for **`vcenter-1`** — keep `VMWARE_VCENTER_NAME` exactly as it is, or the data registers as a new vCenter.":
    "- 这会为 **`vcenter-1`** 安装代理——请让 `VMWARE_VCENTER_NAME` 保持原样，否则数据会注册为一个新的 vCenter。",
  "The vCenter identity comes from `VMWARE_VCENTER_NAME`, stamped on every metric as `vmware.vcenter.name`. This vCenter is **`vcenter-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new vCenter.":
    "vCenter 的标识来自 `VMWARE_VCENTER_NAME`，它以 `vmware.vcenter.name` 的形式打在每条指标上。此 vCenter 为 **`vcenter-1`**。在 `.env` 中修正它，并在 `docker-compose.yml` 所在的文件夹中用 `docker compose up -d` 应用。注意，新名称会注册为一个新的 vCenter。",
  "A Linux machine (x86_64 or arm64) with systemd 235 or later — Ubuntu 18.04, Debian 10, RHEL 8 or newer — and `sudo`, that can reach vCenter over HTTPS (TCP 443) — ideally not a VM on the cluster it watches":
    "一台 Linux 机器（x86_64 或 arm64），带有 systemd 235 或更高版本（Ubuntu 18.04、Debian 10、RHEL 8 或更新版本）和 `sudo`，能通过 HTTPS（TCP 443）访问 vCenter——最好不是它所监控的集群上的虚拟机",
  "Run these on the Linux machine that will host the agent. They download `otelcol-contrib` 0.165.0 — the release of the upstream OpenTelemetry Collector the agent pins — with the agent's `otel-collector-config.yaml` and its systemd unit from this OneUptime, and install them to `/opt/oneuptime-vmware-agent`:":
    "在将要运行代理的 Linux 机器上运行这些命令。它们会从此 OneUptime 下载 `otelcol-contrib` 0.165.0（代理固定使用的上游 OpenTelemetry Collector 版本），连同代理的 `otel-collector-config.yaml` 及其 systemd 单元，并安装到 `/opt/oneuptime-vmware-agent`：",
  "The agent's settings go in `/opt/oneuptime-vmware-agent/.env`. It holds a password, so make it readable by root alone, then open it (`sudoedit` uses your `$EDITOR`):":
    "代理的设置写在 `/opt/oneuptime-vmware-agent/.env` 中。它包含密码，因此请让它仅 root 可读，然后打开它（`sudoedit` 会使用你的 `$EDITOR`）：",
  "Put this in it:": "写入以下内容：",
  '- Keep the user name and the password in double quotes, with each `\\` written `\\\\` and each `"` written `\\"` — `DOMAIN\\user` is `"DOMAIN\\\\user"` — while `$`, `#`, `\'` and spaces go in as they are. systemd reads this file, not a shell, and this is the form every systemd version reads the same: older ones (RHEL 8\'s, for one) drop a backslash even inside single quotes.':
    '- 用户名和密码要放在双引号中，每个 `\\` 写成 `\\\\`，每个 `"` 写成 `\\"`（`DOMAIN\\user` 写作 `"DOMAIN\\\\user"`），而 `$`、`#`、`\'` 和空格按原样写入。读取这个文件的是 systemd 而不是 shell，这是所有 systemd 版本都以同样方式读取的形式：较旧的版本（例如 RHEL 8 中的版本）即使在单引号内也会去掉反斜杠。',
  "Then start the agent, and have it start on every boot:":
    "然后启动代理，并让它在每次开机时启动：",
  "systemd runs the collector as a throwaway unprivileged user, with no capabilities and nothing it can write to. This install runs the collector alone: the OneUptime AI agent ships only as a container image — see **OneUptime AI agent** under Advanced.":
    "systemd 以一个一次性的非特权用户运行收集器，不授予任何 capabilities，也没有任何它可以写入的位置。此安装只运行收集器：OneUptime AI 代理只以容器镜像的形式提供——参见“高级”中的 **OneUptime AI 代理**。",
  "The service should be `active (running)`. Look for `Everything is ready. Begin running and processing data.` in the log — then give it one collection interval (2 minutes by default): nothing is sent until the first full inventory walk completes. The vCenter then appears automatically in the **VMware** section, with its datacenters, clusters, ESXi hosts, virtual machines, datastores and resource pools inventoried.":
    "服务应处于 `active (running)` 状态。在日志中查找 `Everything is ready. Begin running and processing data.`——然后等待一个收集间隔（默认 2 分钟）：在第一次完整遍历清单之前不会发送任何数据。之后该 vCenter 会自动出现在 **VMware** 部分，其数据中心、集群、ESXi 主机、虚拟机、数据存储和资源池都会列入清单。",
  "The service reads these from `/opt/oneuptime-vmware-agent/.env`, the defaults included: its systemd unit sets them when the file leaves them out. After changing one, apply it with `sudo systemctl restart oneuptime-vmware-agent`.":
    "服务从 `/opt/oneuptime-vmware-agent/.env` 读取这些值，包括默认值：文件中省略的值由其 systemd 单元设置。更改其中任何一项后，用 `sudo systemctl restart oneuptime-vmware-agent` 应用它。",
  "| `VCENTER_USERNAME` | Yes | vSphere user with the Read-Only role, e.g. `oneuptime@vsphere.local` (or `DOMAIN\\user` for an Active Directory identity source), double-quoted in `.env` with each `\\` written `\\\\` |":
    "| `VCENTER_USERNAME` | 是 | 具有 Read-Only 角色的 vSphere 用户，例如 `oneuptime@vsphere.local`（Active Directory 身份源则为 `DOMAIN\\user`），在 `.env` 中用双引号括起来，每个 `\\` 写成 `\\\\` |",
  '| `VCENTER_PASSWORD` | Yes | That user\'s password, double-quoted in `.env` with each `\\` written `\\\\` and each `"` written `\\"`, the form every systemd version reads as typed — see **vCenter rejects the login** under Troubleshooting |':
    '| `VCENTER_PASSWORD` | 是 | 该用户的密码，在 `.env` 中用双引号括起来，每个 `\\` 写成 `\\\\`，每个 `"` 写成 `\\"`，这是所有 systemd 版本都按输入原样读取的形式——参见“故障排除”中的 **vCenter 拒绝登录** |',
  "This is the systemd unit the agent runs, installed as `/etc/systemd/system/oneuptime-vmware-agent.service` (`/opt/oneuptime-vmware-agent/.env` supplies the values). It runs the collector as a throwaway unprivileged user with no capabilities, and serves the collector's own metrics on `127.0.0.1:8890` rather than the usual `8888`, so the agent runs beside another OpenTelemetry Collector on the same machine:":
    "这是代理运行的 systemd 单元，安装为 `/etc/systemd/system/oneuptime-vmware-agent.service`（值由 `/opt/oneuptime-vmware-agent/.env` 提供）。它以一个没有 capabilities 的一次性非特权用户运行收集器，并在 `127.0.0.1:8890` 而不是通常的 `8888` 上提供收集器自身的指标，这样代理就能与同一台机器上的另一个 OpenTelemetry Collector 并存运行：",
  "And the full `otel-collector-config.yaml`, in `/opt/oneuptime-vmware-agent` — the same file the Docker install runs. The `resource` processor stamps the `vmware.vcenter.name` attribute that registers the vCenter in OneUptime and that every VMware page, monitor and alert template scopes on — keep it in place if you customize the config. The `batch` processor deliberately has no `send_batch_max_size`: OneUptime reads a whole collection per request to sum inventory counts and infer VM power state, so a collection must never be split across exports:":
    "以及位于 `/opt/oneuptime-vmware-agent` 中的完整 `otel-collector-config.yaml`——与 Docker 安装运行的是同一个文件。`resource` 处理器会打上 `vmware.vcenter.name` 属性：vCenter 凭它在 OneUptime 中注册，每个 VMware 页面、监控器和警报模板也都以它限定范围——自定义配置时请保留它。`batch` 处理器有意不设 `send_batch_max_size`：OneUptime 每个请求读取一次完整的收集，用来汇总清单计数并推断虚拟机电源状态，因此一次收集绝不能拆分到多次导出中：",
  "1. **Uncomment the two `syslog/*` receivers and the `logs` pipeline** in `/opt/oneuptime-vmware-agent/otel-collector-config.yaml` (`sudoedit` it).":
    "1. 在 `/opt/oneuptime-vmware-agent/otel-collector-config.yaml` 中 **取消注释两个 `syslog/*` 接收器和 `logs` 管道**（用 `sudoedit` 编辑）。",
  "2. **Restart the agent** — the collector listens on this machine itself, so there is no port to publish — and open port 5514 (TCP and UDP) on the machine's firewall for the ESXi management network:":
    "2. **重启代理**——收集器就在这台机器上监听，因此无需发布端口——并在机器的防火墙上为 ESXi 管理网络开放端口 5514（TCP 和 UDP）：",
  "The OneUptime AI agent runs the read-only `govc` commands OneUptime AI asks for while it investigates an incident or alert on this vCenter — a VM's power state, the host it runs on, recent events and tasks, performance counters. It ships only as a container image (`oneuptime/resource-ai-agent`), so an install without Docker runs the collector alone. Inventory, metrics, monitors, alerts and syslog work the same without it.":
    "OneUptime AI 代理会运行 OneUptime AI 在调查此 vCenter 上的事件或警报时请求的只读 `govc` 命令——虚拟机的电源状态、它所在的主机、最近的事件和任务、性能计数器。它只以容器镜像（`oneuptime/resource-ai-agent`）的形式提供，因此不使用 Docker 的安装只运行收集器。没有它，清单、指标、监控器、警报和 syslog 也照常工作。",
  "To add it, run it with Docker on any machine that can reach vCenter. Download the agent's `docker-compose.yml`, write a `.env` next to it with the settings of `/opt/oneuptime-vmware-agent/.env` — quoted the Docker Compose way, in single quotes, since Docker Compose expands `$` in double quotes — and start the AI agent alone, not the collector beside it in that file, or every metric would arrive twice:":
    "要添加它，请在任何能访问 vCenter 的机器上用 Docker 运行它。下载代理的 `docker-compose.yml`，在它旁边写一个 `.env`，内容为 `/opt/oneuptime-vmware-agent/.env` 中的设置——按 Docker Compose 的方式加引号，也就是用单引号，因为 Docker Compose 会展开双引号中的 `$`——然后只启动 AI 代理，而不要启动该文件中与它并列的收集器，否则每条指标都会到达两次：",
  "It registers as the vCenter named `VMWARE_VCENTER_NAME` — the one this collector reports into — and appears on the vCenter's **AI → AI agent** page. It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true` in that `.env`. What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#vmware-vcenter).":
    "它注册为名为 `VMWARE_VCENTER_NAME` 的 vCenter（即此收集器上报到的那个），并出现在该 vCenter 的 **人工智能 → AI 代理** 页面上。除非在该 `.env` 中设置 `ONEUPTIME_AI_ALLOW_WRITES=true`，否则它是 **只读** 的。它可以运行什么以及修复如何进行：[基础设施 AI 代理](/docs/ai/infrastructure-ai-agents#vmware-vcenter)。",
  "**Upgrade** — run the install commands again, then restart the agent. They download the collector release this OneUptime pins with the latest `otel-collector-config.yaml` and systemd unit, and replace the installed ones; your `.env` stays, and a change you made to the config has to be made again:":
    "**升级**——重新运行安装命令，然后重启代理。它们会下载此 OneUptime 固定的收集器版本，以及最新的 `otel-collector-config.yaml` 和 systemd 单元，并替换已安装的文件；你的 `.env` 会保留，而你对配置做过的更改需要重新做一遍：",
  "Then remove the `oneuptime` user's permission in vCenter if you no longer need it.":
    "如果不再需要，再在 vCenter 中移除 `oneuptime` 用户的权限。",
  "The diagnostic script, `troubleshoot.sh`, needs Docker. Without it, start from the service and its log:":
    "诊断脚本 `troubleshoot.sh` 需要 Docker。没有 Docker 时，请从服务及其日志入手：",
  "`active (running)`, with `Everything is ready. Begin running and processing data.` in the log, means the collector started; the topics below say what the log means when it cannot reach vCenter or OneUptime. A service that keeps restarting (`activating (auto-restart)`) logs why: `Failed with result 'resources'` means systemd cannot read `/opt/oneuptime-vmware-agent/.env`, and `cannot unmarshal the configuration` or `requires positive value` means a value in it is not one the collector takes — `VCENTER_INSECURE_SKIP_VERIFY` is `true` or `false`, `VCENTER_COLLECTION_INTERVAL` a duration such as `2m`.":
    "`active (running)`，且日志中有 `Everything is ready. Begin running and processing data.`，表示收集器已启动；下面的各个主题说明了当它无法访问 vCenter 或 OneUptime 时日志的含义。不断重启的服务（`activating (auto-restart)`）会在日志中写明原因：`Failed with result 'resources'` 表示 systemd 无法读取 `/opt/oneuptime-vmware-agent/.env`，`cannot unmarshal the configuration` 或 `requires positive value` 表示其中某个值不是收集器接受的值——`VCENTER_INSECURE_SKIP_VERIFY` 应为 `true` 或 `false`，`VCENTER_COLLECTION_INTERVAL` 应为 `2m` 这样的时长。",
  "1. Check that the agent is running: `systemctl status oneuptime-vmware-agent --no-pager`":
    "1. 检查代理是否在运行：`systemctl status oneuptime-vmware-agent --no-pager`",
  "2. Check its log for errors: `sudo journalctl -u oneuptime-vmware-agent | grep -i error`":
    "2. 检查它的日志中的错误：`sudo journalctl -u oneuptime-vmware-agent | grep -i error`",
  '3. Ask OneUptime whether it takes your ingestion key. `"valid":true` with `"keyType":"Server"` means it does; anything else says what is wrong with the key:':
    '3. 询问 OneUptime 是否接受你的摄取密钥。`"valid":true` 加上 `"keyType":"Server"` 表示接受；其他任何响应都会说明密钥哪里有问题：',
  "1. Check the log (`sudo journalctl -u oneuptime-vmware-agent -n 100 --no-pager`): a login error (`incorrect user name or password`, `InvalidLogin`) means bad credentials — or a user name or password that is not double-quoted, backslashes doubled, in `.env`; `x509: certificate signed by unknown authority` means TLS verification is on against a certificate this machine does not trust (see **x509 or other TLS errors**); `connection refused` / `no such host` means a wrong `VCENTER_ENDPOINT`; `Exporting failed` with a `401` or `422` means OneUptime refuses the ingestion key.":
    "1. 检查日志（`sudo journalctl -u oneuptime-vmware-agent -n 100 --no-pager`）：登录错误（`incorrect user name or password`、`InvalidLogin`）表示凭据有误——或者是用户名或密码在 `.env` 中没有放在双引号里并把反斜杠写成两个；`x509: certificate signed by unknown authority` 表示在使用此机器不信任的证书时开启了 TLS 验证（参见 **x509 或其他 TLS 错误**）；`connection refused` / `no such host` 表示 `VCENTER_ENDPOINT` 有误；带有 `401` 或 `422` 的 `Exporting failed` 表示 OneUptime 拒绝了该摄取密钥。",
  "2. Verify the endpoint is reachable. The collector runs on this machine, not in a container, so a plain `curl` takes its path — you should see an XML document advertising `urn:vim25`:":
    "2. 确认能访问端点。收集器运行在这台机器上而不是容器中，因此普通的 `curl` 走的就是它的路径——你应该会看到一个声明 `urn:vim25` 的 XML 文档：",
  "3. Read the collector's own counters: `otelcol_receiver_accepted_metric_points` grows while vCenter answers, `otelcol_exporter_sent_metric_points` while OneUptime takes the data, and `otelcol_exporter_send_failed_metric_points` appears when it does not:":
    "3. 查看收集器自身的计数器：只要 vCenter 有响应，`otelcol_receiver_accepted_metric_points` 就会增长；只要 OneUptime 接收数据，`otelcol_exporter_sent_metric_points` 就会增长；不接收时会出现 `otelcol_exporter_send_failed_metric_points`：",
  "4. Make sure `VMWARE_VCENTER_NAME` is set — discovery keys on the `vmware.vcenter.name` resource attribute.":
    "4. 确保已设置 `VMWARE_VCENTER_NAME`——发现依据的是 `vmware.vcenter.name` 资源属性。",
  "5. Give it one collection interval: nothing is sent until the first full inventory walk completes.":
    "5. 等待一个收集间隔：在第一次完整遍历清单之前不会发送任何数据。",
  'Use the full principal — `oneuptime@vsphere.local`, or `DOMAIN\\user` / `user@domain.example` for an Active Directory identity source — and check how it and the password are written in `/opt/oneuptime-vmware-agent/.env`. systemd reads that file with rules of its own, and not the same ones in every version: outside quotes it drops a backslash (`DOMAIN\\user` becomes `DOMAINuser`) and nothing starts a comment, and older versions (RHEL 8\'s, for one) drop a backslash inside single quotes too. The form every version reads as typed is double quotes, with each `\\` written `\\\\` and each `"` written `\\"` — `VCENTER_USERNAME="DOMAIN\\\\user"`, `VCENTER_PASSWORD="p@ss$word"`; `$`, `#`, `\'` and spaces go in as they are. Restart the agent after changing either. A locked account (too many failed attempts) rejects a correct password too; check *Administration → Single Sign On → Users and Groups*.':
    '使用完整的主体名称（`oneuptime@vsphere.local`，Active Directory 身份源则为 `DOMAIN\\user` / `user@domain.example`），并检查用户名和密码在 `/opt/oneuptime-vmware-agent/.env` 中的写法。systemd 按自己的规则读取该文件，而且各个版本的规则并不相同：在引号之外它会去掉反斜杠（`DOMAIN\\user` 变成 `DOMAINuser`），并且没有任何字符会开始注释；较旧的版本（例如 RHEL 8 中的版本）在单引号内也会去掉反斜杠。所有版本都按输入原样读取的形式是双引号，每个 `\\` 写成 `\\\\`，每个 `"` 写成 `\\"`——`VCENTER_USERNAME="DOMAIN\\\\user"`、`VCENTER_PASSWORD="p@ss$word"`；`$`、`#`、`\'` 和空格按原样写入。更改其中任何一个后都要重启代理。被锁定的账户（失败尝试次数过多）也会拒绝正确的密码；请检查 *Administration → Single Sign On → Users and Groups*。',
  "vCenter appliances present a certificate issued by their own VMCA, which this machine does not trust out of the box. Either set `VCENTER_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or keep verification on: the collector runs on this machine and trusts its CA store, so add vCenter's root certificate to it — the `.0` files under `certs/lin/` in `https://<vcenter>/certs/download.zip`, copied with a `.crt` name into `/usr/local/share/ca-certificates/` and loaded with `sudo update-ca-certificates` on Debian and Ubuntu, or copied into `/etc/pki/ca-trust/source/anchors/` and loaded with `sudo update-ca-trust` on RHEL and its relatives. Restart the agent either way. Do **not** point the endpoint at an `http://` URL — vCenter only serves the SDK over HTTPS.":
    "vCenter 设备出示的是由其自身 VMCA 签发的证书，这台机器默认并不信任它。要么设置 `VCENTER_INSECURE_SKIP_VERIFY=true`（在私有管理网络上这是务实的选择），要么保持验证开启：收集器运行在这台机器上并信任它的 CA 存储，因此把 vCenter 的根证书加进去——即 `https://<vcenter>/certs/download.zip` 中 `certs/lin/` 下的 `.0` 文件：在 Debian 和 Ubuntu 上以 `.crt` 名称复制到 `/usr/local/share/ca-certificates/`，再用 `sudo update-ca-certificates` 加载；在 RHEL 及其衍生发行版上复制到 `/etc/pki/ca-trust/source/anchors/`，再用 `sudo update-ca-trust` 加载。无论哪种方式，都要重启代理。**不要** 把端点指向 `http://` URL——vCenter 只通过 HTTPS 提供 SDK。",
  "The vCenter identity comes from `VMWARE_VCENTER_NAME`, stamped on every metric as `vmware.vcenter.name`. Fix it in `/opt/oneuptime-vmware-agent/.env` and apply it with `sudo systemctl restart oneuptime-vmware-agent` — note that a new name registers a new vCenter.":
    "vCenter 的标识来自 `VMWARE_VCENTER_NAME`，它以 `vmware.vcenter.name` 的形式打在每条指标上。在 `/opt/oneuptime-vmware-agent/.env` 中修正它，并用 `sudo systemctl restart oneuptime-vmware-agent` 应用。注意，新名称会注册为一个新的 vCenter。",
  "The vCenter identity comes from `VMWARE_VCENTER_NAME`, stamped on every metric as `vmware.vcenter.name`. This vCenter is **`vcenter-1`**. Fix it in `/opt/oneuptime-vmware-agent/.env` and apply it with `sudo systemctl restart oneuptime-vmware-agent` — note that a new name registers a new vCenter.":
    "vCenter 的标识来自 `VMWARE_VCENTER_NAME`，它以 `vmware.vcenter.name` 的形式打在每条指标上。此 vCenter 为 **`vcenter-1`**。在 `/opt/oneuptime-vmware-agent/.env` 中修正它，并用 `sudo systemctl restart oneuptime-vmware-agent` 应用。注意，新名称会注册为一个新的 vCenter。",
};

export default TRANSLATION;
