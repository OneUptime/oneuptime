import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in Simplified Chinese (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * Simplified Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Simplified Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Engine 20.10 或更高版本及 Docker Compose v2 插件，所在机器能通过端口 8006 访问每个节点的 Proxmox VE API",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "任一 PVE 节点上的 root shell，或 Proxmox Web 界面，用于创建只读 API 令牌",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "最好是集群外的机器，或由 Proxmox HA 在另一个节点上重启的虚拟机——某个节点宕机时，代理会从另一个节点读取集群，但代理自己的机器宕机时就不行了",
  "As root on any PVE node:": "在任一 PVE 节点上以 root 身份运行：",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- 只有当 `monitoring@pam` 已存在时，第一行才会失败，且没有影响。API 令牌自带密钥，因此该用户不需要密码或系统账户。",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add` 会打印令牌密钥——请立即复制，它只显示一次。令牌 ID 是 `monitoring@pam!oneuptime`。",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- 角色既要授予用户，也要授予令牌，因为权限分离的令牌只能获得其用户同样拥有的权限。角色必须位于根路径 `/`：pve-exporter 读取整个集群的状态，限定在子路径上的令牌会以 `Permission check failed (/, Sys.Audit)` 失败。",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. 前往 *Datacenter → Permissions → API Tokens* 并点击 **Add**。",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. 选择（或创建）一个用户，为令牌指定一个 ID（如 `oneuptime`），确保勾选了 **Privilege Separation**，然后点击 **Add**。",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. 复制令牌 ID（`user@realm!tokenname`）和密钥——密钥只显示一次。",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. 在 *Datacenter → Permissions* 下点击两次 **Add**，为路径 `/` 授予 **PVEAuditor** 角色：一次作为令牌的 **API Token Permission**，一次作为其用户的 **User Permission**。",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "权限分离的令牌只能获得其用户同样拥有的权限，因此两者都需要该角色。角色必须位于根路径 `/`：pve-exporter 读取整个集群的状态，限定在子路径上的令牌会以 `Permission check failed (/, Sys.Audit)` 失败。",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "脚本会询问你的 OneUptime URL 和摄取密钥，两者都显示在第 1 步中（在那里选择一个密钥即可在此处填好），然后询问：",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **集群名称**：集群在 OneUptime 中显示的名称。为每个集群取一个独立的名称并保持不变：新名称会注册一个新集群。",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **Proxmox VE API 主机**：任一节点，例如 `192.168.1.10`。在它的 API 没有响应期间，代理会从下面列表中的下一个节点读取集群。",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **随附的 prometheus-pve-exporter**：除非你已经在运行一个，否则回答 **Y**。",
  "- **API token** — the token id and secret from the previous step.":
    "- **API 令牌**：上一步中的令牌 ID 和密钥。",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **每个节点的地址**：每个节点自己的地址，用逗号分隔，绝不使用虚拟 IP。有了令牌，脚本会给出集群自己的列表：按 Enter 即可采用。第一个节点宕机时，代理也会从这些节点读取集群。",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **OneUptime AI 代理**：是否允许它应用修复；回答 **N** 可使其保持只读。",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "它会安装到 `/opt/oneuptime-proxmox-agent`，写入一个 `0600` 权限的 `.env` 文件，并用 Docker Compose 启动所有组件。再次运行脚本会沿用该 `.env` 中的所有内容而不再询问，因此这也是升级的方法。",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps` 会列出收集器（`oneuptime-proxmox-agent`）、节点故障转移（`oneuptime-pve-api-failover`）、随附的导出器（`oneuptime-pve-exporter`，除非你使用自己的导出器）和 OneUptime AI 代理（`oneuptime-proxmox-ai-agent`）。在收集器的日志中查找 `Everything is ready. Begin running and processing data.`。之后集群会自动出现在 **Proxmox** 部分。",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**OneUptime AI 代理（默认开启，只读）。** AI 调查已开启：它让 OneUptime AI 使用只读的 `pvesh` 请求调查此集群上的事件和警报，除非你允许修复，否则不会做任何更改——请参阅高级中的 **OneUptime AI 代理**。",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "需要 Proxmox VE 8.3 或更高版本。在第 1 步中选择一个摄取密钥即可显示这两条命令：命令中带有该密钥，Proxmox VE 会把它保存在命令添加的 Webhook 目标中。",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "之后每个客户机的页面会显示其最近一次备份，集群的 **建议** 会提供 **Backup Job Failed** 和 **Node Fenced** 警报。",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "安装脚本会把这些写入 `/opt/oneuptime-proxmox-agent/.env`。更改其中任何一项后，在 `/opt/oneuptime-proxmox-agent` 中用 `docker compose up -d` 应用它。",
  "| Variable | Required | Description |": "| 变量 | 必填 | 说明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 实例 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 是 | 遥测摄取密钥，即第 1 步中选择的那个 |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | 是 | 在 OneUptime 中显示的集群标识符。作为资源属性 `proxmox.cluster.name` 标记在每个指标上。请保持不变：更改它会注册一个新集群（默认：`proxmox-cluster`） |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | 是 | 导出器通过其 Proxmox VE API 读取集群、AI 代理向其发起查询的节点，例如 `192.168.1.10`。在它的 API 没有响应期间，两者都会使用 `PVE_NODES` 中下一个有响应的节点 |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | 集群时需要 | 每个节点自己的 API 地址，用逗号分隔并放在方括号中，例如 `[192.168.1.10,192.168.1.11,192.168.1.12]`。默认只有 `PVE_HOST`，单节点时这就足够了。导出器只读取它所询问的那个节点的开机启动（Guest Down）、复制和订阅信息，因此会依次询问每个节点；遗漏的节点不会被看到。当 `PVE_HOST` 宕机时，代理也会从其中的下一个节点读取集群。 |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | 否 | prometheus-pve-exporter 的地址（`host:port`，不带协议）。默认是随附的导出器（`pve-exporter:9221`） |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | 随附的导出器和 AI 代理 | 完整的 Proxmox API 令牌 ID，例如 `monitoring@pam!oneuptime`（PVEAuditor，只读） |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | 随附的导出器和 AI 代理 | Proxmox API 令牌密钥 |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | 否 | 验证 Proxmox API 的 TLS 证书（默认：`false`——PVE 自带自签名证书） |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | 否 | 设置为 `pve-exporter` 可启动随附导出器的容器 |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI 代理自己的设置见 **OneUptime AI 代理** 部分。",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "当安装脚本询问 **Run the bundled prometheus-pve-exporter?** 时，回答 **n** 并填写你的导出器地址（`host:port`，不带协议）。",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "请使用代理容器能访问到的地址，即主机的局域网 IP 或 DNS 名称：容器内的 `localhost` 是容器本身。如果你使用 OneUptime AI 代理，请在 `.env` 中保留 `PVE_API_TOKEN_ID` 和 `PVE_API_TOKEN_SECRET`，AI 代理会用该令牌读取 API。",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "代理每 30 秒抓取一次导出器：集群收集器在 `PVE_HOST`（或在 `PVE_HOST` 宕机期间代理读取集群的那个节点）上抓取一次，节点收集器则为 `PVE_NODES` 中的每个节点各抓取一次。每个序列都带有标识资源的 `id` 标签——`node/<name>`、`qemu/<vmid>`、`lxc/<vmid>` 或 `storage/<node>/<storage>`：",
  "| Category | Metrics |": "| 类别 | 指标 |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **可用性** | `pve_up`、`pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **节点** | `pve_node_info`、`pve_cpu_usage_ratio`、`pve_cpu_usage_limit`、`pve_memory_usage_bytes`、`pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **客户机（VM / LXC）** | `pve_guest_info`，以及 `qemu/*` 和 `lxc/*` ID 上的 CPU / 内存 / 网络序列 |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **存储** | `pve_disk_usage_bytes`、`pve_disk_size_bytes`、`pve_storage_info` |",
  "| **HA** | `pve_ha_state` |": "| **HA**（高可用性） | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **备份覆盖情况** | `pve_not_backed_up_total`、`pve_not_backed_up_info`——没有被任何备份作业选中的客户机（备份是否运行、是否成功不会体现出来） |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **开机启动** | 每个客户机的 `pve_onboot_status`，**Guest Down** 会读取它 |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **复制** | 每个存储复制作业的 `pve_replication_*` 序列——它们的 `id` 标签是作业 ID（例如 `100-0`），而不是资源 |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "开机启动和复制信息来自导出器的节点收集器，它们只读取导出器所询问的节点：`PVE_NODES` 中缺少的节点两者都没有。",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "收集器还会把 `id` 标签拆分为三个可按相等条件筛选的数据点属性（`transform/pve-identity` 处理器）——监视器条件和仪表板筛选器都基于这些属性匹配：",
  "| Attribute | Values | Example for `qemu/100` |":
    "| 属性 | 值 | `qemu/100` 的示例 |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`、`guest`、`storage`、`cluster`（`qemu` 和 `lxc` 都映射为 `guest`） | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | `id` 中第一个 `/` 之后的全部内容（`pve1`、`100`、`pve1/local`） | `100` |",
  "The original `id` label is kept untouched.": "原始的 `id` 标签保持不变。",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "代理通过一个节点的 API 读取整个集群：在 `PVE_HOST` 有响应时使用它的 API。`oneuptime-pve-api-failover` 容器每 15 秒检查一次该节点，当它的 API 停止响应时，收集器会从 `PVE_NODES` 中下一个有响应的节点读取集群，直到 `PVE_HOST` 再次响应。`.env` 中有 API 令牌时，它还会跳过虽有响应、却与集群中拥有仲裁的部分断开的节点，因为从这个节点看来，其他所有节点都已宕机。OneUptime AI 代理在每次调用时也会这样做。因此，当某个节点故障时，会为它触发 **Node Offline**，而集群的其余部分会继续上报。",
  "Its logs say which node the cluster is read from, and why.":
    "它的日志会说明集群是从哪个节点读取的，以及原因。",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "它无法兜底的是代理所在的机器：如果这台机器宕机，整个集群都会沉默，并触发 **Cluster Stopped Reporting**。请在集群外运行代理，或在由 Proxmox HA 在另一个节点上重启的虚拟机中运行（`ha-manager add vm:<vmid>`，位于共享存储上），并且每个集群只运行一个代理：每个代理都会读取整个集群，第二个代理会让每个资源被上报两次。请参阅[节点宕机时](/docs/telemetry/proxmox#when-a-node-goes-down)。",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "这是代理运行的完整 `otel-collector-config.yaml`；`.env` 文件提供 `${env:...}` 的值。`transform/pve-identity` 处理器会派生出内置 Proxmox 警报模板和仪表板筛选器所依赖的 `pve.scope` / `pve.type` / `pve.id` 属性——如果你自定义配置，请保留它：",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "默认情况下代理只发送指标，因此集群的 **日志** 选项卡是空的。PVE 服务会把日志写入 systemd 日志（journal），随附的配置中有一个已注释掉的 `journald` 接收器，用于 `pveproxy`、`pvedaemon`、`pve-firewall`、`pve-ha-crm`、`pve-ha-lrm`、`pvescheduler`、`pvestatd` 和 `qmeventd`。",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **在 PVE 节点上运行代理。** journal 按主机保存，因此远程代理无法读取，每个节点也只发送自己的 journal。若要让指标代理留在集群外，请改为在每个节点上另外运行一个只处理日志的收集器。",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. 取消 `otel-collector-config.yaml` 中 `journald` 接收器和 `logs` 管道的注释，以及 `docker-compose.yml` 中两个 journal 卷的注释。",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **更换收集器镜像。** 默认镜像中没有 `journalctl`，并且以无法读取 journal 的用户身份运行。构建这个包装镜像，并让 `docker-compose.yml` 中的 `image:` 指向它：",
  "4. Apply it:": "4. 应用更改：",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "想保留默认镜像？文档中有一个跟踪 `/var/log/syslog` 的 `filelog` 备选方案：[发送 Proxmox 服务日志](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs)。",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "任何带有 `oneuptime.label.` 前缀的资源属性都会成为集群上的项目标签：`oneuptime.label.<dimension>=<value>` 即标签 `<dimension>:<value>`。将它们添加到 `otel-collector-config.yaml` 的 `resource` 处理器中，放在 `proxmox.cluster.name` 旁边：",
  "Then restart the collector so it reads the new config:":
    "然后重启收集器，让它读取新配置：",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "集群会带着 `team:platform` 和 `env:production` 标签出现。标签匹配不区分大小写，因此会复用现有的 `Production` 标签；在 OneUptime 界面中添加的标签永远不会被代理删除。",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` 还会运行 **`oneuptime-proxmox-ai-agent`**。当 OneUptime AI 调查此集群上的事件或警报时，会通过它运行只读的 `pvesh` 命令——`pvesh get /cluster/status`、某个客户机的当前状态、某个节点失败的任务。它里面并没有 `pvesh` 程序：每条命令都会变成对 `PVE_HOST` 上 Proxmox VE API 的一次调用。它注册为名为 `PROXMOX_CLUSTER_NAME` 的集群，并显示在集群的 **人工智能 → AI 代理** 页面上。",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **API 令牌是硬性上限。** 它使用收集器的 PVEAuditor 令牌（`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`）读取，该令牌只能读取，别的都做不了。如果你运行自己的导出器，而 `.env` 中没有令牌，请添加一个。",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- 除非你设置 `ONEUPTIME_AI_ALLOW_WRITES=true`，否则它是 **只读** 的。修复（启动或重启客户机）还需要一个可以为客户机开关机的专用令牌，设置为 `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`；代理的 README 中有相应的 `pveum` 命令。如果代理运行在此集群的某个客户机中，请把该客户机的 VMID 填入 `ONEUPTIME_AI_PROTECTED_TARGETS`。",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- 检查它：`docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- 不使用 OneUptime AI？从 `docker-compose.yml` 中删除 `oneuptime-proxmox-ai-agent` 服务。",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "它可以运行什么以及修复如何进行：[基础设施 AI 代理](/docs/ai/infrastructure-ai-agents#proxmox-clusters)。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**升级**——收集器镜像固定在 `docker-compose.yml` 中，其配置是旁边的一个文件，所以仅拉取镜像并不会让代理更新。请再次运行安装脚本。它会沿用你现有 `.env` 中的每个值（不会再询问任何内容），下载最新的 `docker-compose.yml` 和 `otel-collector-config.yaml`（你编辑过的文件会以 `<file>.bak.<timestamp>` 保留在新文件旁边），拉取镜像并用它们重新创建代理：",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "该配置会把它固定的收集器版本报告为集群的 **代理版本**。当此 OneUptime 固定了更新的版本时，旁边的警告标志会打开这些命令。",
  "**Uninstall** the agent:": "**卸载**代理：",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "如果不再需要该 API 令牌，请在 *Datacenter → Permissions → API Tokens* 下将其删除。",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` 会检查整条链路（容器运行时、导出器抓取、集群名称标记、令牌格式、收集器自身指标），并直接询问 OneUptime 是否接受你的摄取密钥。最后一项检查最重要：OneUptime 的 OTLP 端点会以 `401` 或 `422` 拒绝错误的密钥，而收集器只会为每个批次记录一行很容易被忽略的 `Exporting failed`，所以脚本会向 `GET /otlp/v1/validate` 请求直接的 200/401 判定。",
  "It ends with a verdict naming the most likely cause.":
    "最后它会给出判定，指出最可能的原因。",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. 检查代理是否在运行（在 `/opt/oneuptime-proxmox-agent` 中）：`docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. 检查代理日志中的错误：`docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. 确认你的 OneUptime URL 和摄取密钥正确。",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. 确保代理所在机器能通过网络访问 OneUptime 实例。",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. 检查导出器是否有响应。随附的导出器不会在主机上发布端口，因此请在它的网络命名空间中运行 curl——你应该能看到 `pve_*` 指标行（如果是你自己的导出器，请直接 curl 它的 `host:9221`）：",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. 确认 API 令牌在路径 `/` 上拥有 **PVEAuditor** 角色，令牌和其用户都要有。",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. 检查收集器日志中的抓取或导出错误（在 `/opt/oneuptime-proxmox-agent` 中）：`docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "API 令牌错误或缺少权限。请重新检查令牌 ID 的格式（`user@realm!tokenname`）、密钥，以及是否已在路径 `/` 上把 **PVEAuditor** 角色授予令牌及其用户。导出器自己的日志会显示 API 的应答：`docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    '客户机序列（`qemu/*`、`lxc/*` ID）来自导出器的集群收集器。随附的配置启用了它（`cluster=1` 抓取参数）——如果你自定义了配置，请恢复 `cluster: ["1"]` 参数。',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "它们的开机启动标志和复制作业来自它们所在的节点，而代理只读取 `PVE_NODES` 中的节点。请在那里列出每个节点自己的地址，例如 `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`，并在 `/opt/oneuptime-proxmox-agent` 中用 `docker compose up -d` 应用。如果编辑后收集器无法启动，说明列表丢了方括号。`troubleshoot.sh` 会检查列表中的每个节点。",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "集群的标识来自 `PROXMOX_CLUSTER_NAME`，它作为 `proxmox.cluster.name` 标记在每个指标上。在 `.env` 中修正它，并在 `/opt/oneuptime-proxmox-agent` 中用 `docker compose up -d` 应用——注意，新名称会注册一个新集群。",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **集群名称**：准确输入 **`pve-1`**；不同的名称会注册一个新集群。",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "集群的标识来自 `PROXMOX_CLUSTER_NAME`，它作为 `proxmox.cluster.name` 标记在每个指标上。此集群是 **`pve-1`**。在 `.env` 中修正它，并在 `/opt/oneuptime-proxmox-agent` 中用 `docker compose up -d` 应用——注意，新名称会注册一个新集群。",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "该命令已经带有你的 OneUptime URL 和摄取密钥。其余内容由脚本询问：",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "需要 Proxmox VE 8.3 或更高版本。第一条命令会添加一个名为 `oneuptime` 的 Webhook 目标，它把每条通知作为此集群的一条日志发送到 OneUptime，并把密钥和集群名称保存在它的机密（secrets）中。第二条命令把所有通知都发送给它。请把 `my-proxmox-cluster` 替换为你给代理设置的集群名称，这样通知就会到达同一个集群。",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "之后每个客户机的页面会显示其最近一次备份，集群的 **建议** 会提供 **Backup Job Failed** 和 **Node Fenced** 警报。要停止发送：",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "需要 Proxmox VE 8.3 或更高版本。第一条命令会添加一个名为 `oneuptime` 的 Webhook 目标，它把每条通知作为此集群的一条日志发送到 OneUptime，并把密钥和集群名称保存在它的机密（secrets）中。第二条命令把所有通知都发送给它。命令中已经写明了 **`pve-1`**，因此通知会到达这个集群。",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "从此 OneUptime 下载 `docker-compose.yml` 和 `otel-collector-config.yaml` 到一个新文件夹：",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "在它们旁边创建一个 `.env` 文件——它保存着令牌密钥，因此请用 `chmod 600 .env` 将其设为私有：",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- 将 `my-proxmox-cluster` 替换为此集群的名称，例如 `pve-prod`。集群在 OneUptime 中就以此名称显示，所以请保持不变：新名称会注册一个新集群。",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- 把 `PVE_HOST` 设置为集群中的任一节点：在它的 API 没有响应期间，代理会从 `PVE_NODES` 中的下一个节点读取集群，因此不需要虚拟 IP。",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- 把 `PVE_NODES` 设置为每个节点自己的地址，放在方括号中，绝不使用虚拟 IP。导出器只读取它所询问的那个节点的开机启动（Guest Down）、复制和订阅信息，因此会依次询问每个节点；遗漏的节点不会被看到。",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- 填入上一步中的令牌。`COMPOSE_PROFILES=pve-exporter` 还会启动随附的 prometheus-pve-exporter，它用该令牌读取 API。",
  "Start the agent:": "启动代理：",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中选择一个摄取密钥，以填入 `<YOUR_API_KEY>`。",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "代理从 `docker-compose.yml` 旁边的 `.env` 文件读取这些值。更改其中任何一项后，在 `docker-compose.yml` 所在的文件夹中用 `docker compose up -d` 应用它。",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "不要在 `.env` 中设置 `COMPOSE_PROFILES`，而是让代理指向你的导出器（`host:port`，不带协议）：",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "在代理的文件夹（即 `docker-compose.yml` 所在的文件夹）中运行这些命令。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**升级**——收集器镜像固定在 `docker-compose.yml` 中，其配置是旁边的一个文件，所以仅拉取镜像并不会让代理更新。请重新下载这两个文件；你的 `.env` 会保留，而你对其中任一文件做过的更改需要重新做一遍：",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "然后拉取镜像并重新创建代理，让收集器读取新配置：",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. 检查代理是否在运行（在代理所在的文件夹中）：`docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. 检查收集器日志中的抓取或导出错误（在代理的文件夹中）：`docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "它们的开机启动标志和复制作业来自它们所在的节点，而代理只读取 `PVE_NODES` 中的节点。请在那里列出每个节点自己的地址，例如 `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`，并在 `docker-compose.yml` 所在的文件夹中用 `docker compose up -d` 应用。如果编辑后收集器无法启动，说明列表丢了方括号。`troubleshoot.sh` 会检查列表中的每个节点。",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "集群的标识来自 `PROXMOX_CLUSTER_NAME`，它作为 `proxmox.cluster.name` 标记在每个指标上。在 `.env` 中修正它，并在 `docker-compose.yml` 所在的文件夹中用 `docker compose up -d` 应用——注意，新名称会注册一个新集群。",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- 这会为 **`pve-1`** 安装代理——请让 `PROXMOX_CLUSTER_NAME` 保持原样，否则数据会注册为一个新集群。",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "集群的标识来自 `PROXMOX_CLUSTER_NAME`，它作为 `proxmox.cluster.name` 标记在每个指标上。此集群是 **`pve-1`**。在 `.env` 中修正它，并在 `docker-compose.yml` 所在的文件夹中用 `docker compose up -d` 应用——注意，新名称会注册一个新集群。",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**无需代理，但数据更少。** Proxmox VE 9.0 及更高版本会自己把每个节点的指标推送到 OneUptime。HA 状态、开机启动（**Guest Down** 会用到）、备份覆盖情况和复制信息不会被推送——如果需要它们，请使用安装脚本或 Docker Compose。一个集群只用其中一种方式：两者同时运行会让每个资源被上报两次。",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 或更高版本**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "Proxmox Web 界面，用于在 *Datacenter → Metric Server* 下添加指标服务器",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "每个节点都能通过端口 `443` 访问 `<YOUR_ONEUPTIME_HOST>`",
  "| Field | Value |": "| 字段 | 值 |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server**（服务器） | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port**（端口） | `443` |",
  "| **Protocol** | `https` |": "| **Protocol**（协议） | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path**（路径） | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |": "| **Headers**（标头） | 下面的 JSON |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "为数据中心添加一次即可——之后集群中的每个节点都会推送自己的指标。",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "OneUptime 会把推送转换为与代理发送的相同的 `pve_*` 序列。集群会以你的 Proxmox 集群名称自行注册（独立节点则以其节点名称注册），并出现在 **Proxmox** 部分，其中的节点、客户机和存储页面、概览图表、指标目录以及 CPU / 内存 / 存储警报模板都和使用代理时一样工作。",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "每个节点只推送自己的状态，因此宕机的节点无法自己报告宕机——仍然存活的节点会替它报告：",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- 在最后一次上报约 2 分钟后，它会在 Proxmox 页面上显示为 **离线**，约 5 分钟后触发 **Node Offline**。",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- **Cluster Quorum at Risk** 也会把它算作离线；它会在节点沉默约 7–9 分钟后、其整个 5 分钟窗口都有上报数据时触发。",
  "- Its next report brings it back.": "- 它的下一次上报会让它恢复。",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    "离线意味着“停止上报”：`pvestatd` 挂起、`pmxcfs` 停止，或到 OneUptime 的网络中断，看起来都一样。独立主机或整个集群陷入沉默时，就没有节点能替它上报，因此改为集群显示为 **已断开**。沉默超过 7 天的节点不再被上报。这些上报在指标浏览器中带有 `oneuptime.proxmox.inferred=not-reporting` 标记。",
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "集群以其 Proxmox 集群名称注册；独立节点以其节点名称注册。如果在指标服务器的 *Resource Attributes* 下设置了 `proxmox.cluster.name` 资源属性，则会继续改用该属性。",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "OneUptime 会把推送转换为代理发送的 `pve_*` 序列，因此 Proxmox 页面和 CPU / 内存 / 存储警报模板无需改动即可工作。原始的 `proxmox_*` 序列仍可在指标浏览器中使用，用于 Proxmox VE 上报的其他所有内容。",
  "Some alert templates need data only the agent collects:":
    "有些警报模板需要只有代理才会收集的数据：",
  "| Needs the agent | Why |": "| 需要代理 | 原因 |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| HA 状态 | 不推送——**HA Resource in Error State** 模板需要代理 |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| 开机启动标志 | 不推送——**Guest Down** 只针对设置为开机启动的客户机发出通知，它需要代理 |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| 备份覆盖情况和复制 | 不推送——**Guest Not Backed Up** 和 **Replication Failing** 需要代理 |",
  "Every node has stopped reporting, or never started.":
    "所有节点都已停止上报，或者从未开始上报。",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. 在 *Datacenter → Metric Server* 下检查 OpenTelemetry 条目：服务器 `<YOUR_ONEUPTIME_HOST>`、端口 `443`、协议 `https`、路径 `/otlp/v1/metrics`，以及带有第 1 步中密钥的 `x-oneuptime-token` 标头。",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. 检查节点能否通过网络访问 `<YOUR_ONEUPTIME_HOST>`。",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "它已停止上报：节点宕机、`pvestatd` 挂起、`pmxcfs` 停止，或到 OneUptime 的网络中断，看起来都一样。它的下一次上报会让它恢复。如果你已把该节点移出集群，请在它的页面上使用 **移除节点**——否则它会保持离线最多 7 天。",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "原生推送不会发送 HA 状态、开机启动、备份覆盖情况或复制信息。请在本指南顶部选择 **安装脚本** 或 **Docker Compose** 来改为运行代理——并删除指标服务器，因为两者同时运行会让每个资源被上报两次。",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "此集群在 OneUptime 中是 **`pve-1`**。如果这不是该 Proxmox 集群自己的名称，请在指标服务器的 *Resource Attributes* 下把 `proxmox.cluster.name` 设置为 `pve-1`，否则推送会注册一个新集群。",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "需要 Proxmox VE 8.3 或更高版本。第一条命令会添加一个名为 `oneuptime` 的 Webhook 目标，它把每条通知作为此集群的一条日志发送到 OneUptime，并把密钥和集群名称保存在它的机密（secrets）中。第二条命令把所有通知都发送给它。请把 `my-proxmox-cluster` 替换为集群在 OneUptime 中显示的名称：它的 Proxmox 集群名称，或独立节点自己的名称。",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | 否 | 收集器的容器名称（默认：`oneuptime-proxmox-agent`）。同一台机器上第二个集群的代理需要自己的容器名称：除非你自行设置，否则安装脚本会按新代理的文件夹为其容器命名，并在你再次运行脚本时保留这些名称 |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | 否 | API 故障转移 sidecar 的容器名称（默认：`oneuptime-pve-api-failover`）。除非你自行设置，否则安装脚本会按第二个集群的收集器为其 API 故障转移 sidecar 命名（`oneuptime-pve-api-failover-cluster2` 与 `oneuptime-proxmox-agent-cluster2` 并列），并在你再次运行脚本时保留该名称 |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | 否 | 随附的导出器的容器名称（默认：`oneuptime-pve-exporter`）。除非你自行设置，否则安装脚本会按第二个集群的收集器为其随附的导出器命名（`oneuptime-pve-exporter-cluster2` 与 `oneuptime-proxmox-agent-cluster2` 并列），并在你再次运行脚本时保留该名称 |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | 否 | AI 代理的容器名称（默认：`oneuptime-proxmox-ai-agent`）。除非你自行设置，否则安装脚本会按第二个集群的收集器为其 AI 代理命名（`oneuptime-proxmox-ai-agent-cluster2` 与 `oneuptime-proxmox-agent-cluster2` 并列），并在你再次运行脚本时保留该名称 |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "一个代理读取一个集群。对于第二个集群，请在单独的文件夹中安装第二个代理，并使用它自己的容器名称——两个容器不能共用一个名称：",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "除非你设置它们的变量（例如 `PROXMOX_AGENT_CONTAINER_NAME`），否则脚本会按文件夹为容器命名，例如 `oneuptime-proxmox-agent-cluster2`。它会把名称保存在该代理的 `.env` 中，所以用同一个 `INSTALL_DIR` 再次运行脚本来升级代理时会保留这些名称；而你曾在 `docker-compose.yml` 中编辑过 `container_name` 的代理，也会保留那个名称。",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "请为每个文件夹取一个独有的名称：Docker Compose 只按文件夹为项目命名，因此如果某个文件夹与别处已在运行代理的文件夹同名，脚本会拒绝它。用 `-d` 把文件夹传给诊断脚本。",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | 否 | 收集器的容器名称（默认：`oneuptime-proxmox-agent`）。同一台机器上第二个集群的代理需要自己的容器名称 |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | 否 | API 故障转移 sidecar 的容器名称（默认：`oneuptime-pve-api-failover`）。同一台机器上第二个集群的代理需要自己的容器名称 |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | 否 | 随附的导出器的容器名称（默认：`oneuptime-pve-exporter`）。同一台机器上第二个集群的代理需要自己的容器名称 |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | 否 | AI 代理的容器名称（默认：`oneuptime-proxmox-ai-agent`）。同一台机器上第二个集群的代理需要自己的容器名称 |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "一个代理读取一个集群。对于第二个集群，请在单独的文件夹中设置第二个代理，并使用它自己的容器名称——两个容器不能共用一个名称。请在该代理的 `.env` 中设置这些名称：",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "请为每个文件夹取一个独有的名称：Docker Compose 只按文件夹为项目命名，因此同名的第二个文件夹会替换第一个代理的容器。不要把这些名称写进 `docker-compose.yml`，升级会替换该文件。",
};

export default TRANSLATION;
