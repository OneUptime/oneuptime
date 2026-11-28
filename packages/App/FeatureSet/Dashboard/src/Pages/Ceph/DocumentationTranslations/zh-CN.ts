import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in Simplified Chinese (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * Simplified Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Simplified Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Engine 20.10 或更高版本及 Docker Compose v2 插件，所在机器能通过端口 9283 访问你的 Ceph mgr 守护进程",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "Ceph 管理节点上的命令行终端，其中 `ceph` CLI 能以管理员权限运行",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "然后列出你的 mgr 守护进程。代理需要**全部**守护进程，包括活动的和备用的：",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "只有**活动**的 mgr 会返回指标（备用的 mgr 返回空响应），因此抓取每个 mgr 可以在活动 mgr 故障转移时让指标持续流入。",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "脚本会询问你的 OneUptime URL 和摄取密钥，两者都显示在第 1 步中（在那里选择一个密钥即可在此处填好），然后询问：",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **集群名称**：集群在 OneUptime 中显示的名称。为每个集群取一个独立的名称并保持不变：新名称会注册一个新集群。",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **mgr 端点**：上一步中的每个 mgr，以逗号分隔的 `host:port` 形式填写，例如 `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`。脚本会添加方括号。",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **OneUptime AI 代理**：是否允许它应用修复；回答 **N** 可让它保持只读。在 `ceph` 能以管理员权限运行的地方，脚本还会提议为 AI 代理创建它自己的 Ceph 客户端。",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "它会安装到 `/opt/oneuptime-ceph-agent`，写入一个权限为 `0600` 的 `.env` 文件，并用 Docker Compose 启动代理。再次运行脚本会沿用该 `.env` 中的所有内容而不再询问，所以升级也是这样做的。",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "在日志中查找 `Everything is ready. Begin running and processing data.`。之后集群会自动出现在 **Ceph** 部分，通常在一分钟左右。",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "Docker Compose 还会运行 **`oneuptime-ceph-ai-agent`**，即 OneUptime AI 代理。如果安装脚本创建了它的 Ceph 客户端，它已经在工作；否则它会等待客户端——参见“高级”中的 **OneUptime AI 代理**。",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**OneUptime AI 代理（默认开启，只读）。** AI 调查已开启：一旦它有了 Ceph 客户端，就会让 OneUptime AI 使用只读的 `ceph` 命令调查此集群上的事件和警报，除非你允许修复，否则不会做任何更改。",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "安装脚本会把这些写入 `/opt/oneuptime-ceph-agent/.env`。更改其中任何一项后，在 `/opt/oneuptime-ceph-agent` 中用 `docker compose up -d` 应用它。",
  "| Variable | Required | Description |": "| 变量 | 必填 | 说明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 实例 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 是 | 遥测摄取密钥，即第 1 步中选择的那个 |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | 是 | 在 OneUptime 中显示的集群标识符。作为资源属性 `ceph.cluster.name` 标记在每个指标上。请保持不变：更改它会注册一个新集群（默认：`ceph`） |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | 是 | **全部** mgr 守护进程的 `host:port` 列表，以逗号分隔并用方括号括起来，例如 `[ceph-mon-1:9283,ceph-mon-2:9283]`。安装脚本会为你添加方括号 |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI 代理自己的设置见 **OneUptime AI 代理** 部分。",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **抓取所有 mgr**（活动的和备用的），因此指标能挺过活动 mgr 的故障转移。",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **每 30 秒一次。** mgr 的 prometheus 模块会将一次抓取缓存 `mgr/prometheus/scrape_interval`（默认 15 秒）：抓取频率不要高于此值，否则只会重复读取缓存。",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** 会按原样保留 Ceph 导出的标签（`ceph_daemon`、`pool_id`），因此序列在 mgr 故障转移期间保持连续。",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "这是代理运行的完整 `otel-collector-config.yaml`；`.env` 文件提供 `${env:...}` 的值：",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "代理可以跟踪 `/var/log/ceph/ceph.log` 并将其发送到 OneUptime，从而填充 **集群日志** 页面。该功能默认关闭，因为代理必须运行在拥有集群日志的主机上，默认是 mon 主机。",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. 在 `otel-collector-config.yaml` 中，取消注释 `filelog` 接收器和 `logs` 管道。",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. 在 `docker-compose.yml` 中，取消注释 `/var/log/ceph:/var/log/ceph:ro` 卷。",
  "3. Apply both:": "3. 应用这两项更改：",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "日志行按原样发送；OneUptime 在读取时解析 ceph.log 格式（时间戳、守护进程、INF/WRN/ERR 级别、消息），`resource` 处理器会标记 `ceph.cluster.name`，使日志落到此集群上。",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "任何带有 `oneuptime.label.` 前缀的资源属性都会成为集群上的项目标签：`oneuptime.label.<dimension>=<value>` 即标签 `<dimension>:<value>`。将它们添加到 `otel-collector-config.yaml` 的 `resource` 处理器中，放在 `ceph.cluster.name` 旁边：",
  "Then restart the collector so it reads the new config:":
    "然后重启收集器，让它读取新配置：",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "集群会带着 `team:storage` 和 `env:production` 标签出现。标签匹配不区分大小写，因此会复用现有的 `Production` 标签；在 OneUptime 界面中添加的标签永远不会被代理删除。",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "代理会发送 mgr 的 prometheus 模块导出的所有内容。OneUptime 的 Ceph 页面、指标目录和警报模板基于：",
  "| Category | Data |": "| 类别 | 数据 |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **集群健康状况** | `ceph_health_status`（0 = OK，1 = WARN，2 = ERR）、监视器仲裁、总原始容量和已用原始容量 |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | 每个 OSD 的 up / in 状态（按 `ceph_daemon` 标签，例如 `osd.3`） |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **存储池** | 每个存储池的已存储字节数、最大可用量、对象数、读/写操作数和吞吐量 |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **Placement Group** | 活动、降级和副本不足的 PG 数量 |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` 还会运行 **`oneuptime-ceph-ai-agent`**。当 OneUptime AI 调查此集群上的事件或警报时，会通过它运行 `ceph` 命令：`ceph health detail`、`ceph osd tree`、`ceph pg dump_stuck`、`ceph crash ls`。它注册为名为 `CEPH_CLUSTER_NAME` 的集群，并显示在集群的 **人工智能 → AI 代理** 页面上。",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "它以自己的 Ceph 客户端 `client.oneuptime-ai` 连接，使用集群的最小 `ceph.conf` 和该客户端的密钥环，二者放在 `docker-compose.yml` 旁边的 `ceph/` 文件夹中。全新安装时，如果 `ceph` 在你运行脚本的机器上能以管理员权限运行，安装脚本会提议创建它们。否则，或者要稍后添加它们，请在 Ceph 管理节点上运行：",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "如果代理运行在另一台机器上，用同样的方式把这两个文件复制到它的 `ceph/` 文件夹中。**切勿把管理员密钥环放在那里。**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **客户端的 caps 是硬性上限。** 有了这些读取 caps，它运行的任何命令都无法更改集群。修复（把 OSD 重新标记为 in、清除 `noout`）还需要 `.env` 中的 `ONEUPTIME_AI_ALLOW_WRITES=true` 以及代理 README 中的修复 caps。",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- 检查它：`docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- 不使用 OneUptime AI？从 `docker-compose.yml` 中删除 `oneuptime-ceph-ai-agent` 服务。",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "它可以运行什么以及修复如何进行：[基础设施 AI 代理](/docs/ai/infrastructure-ai-agents#ceph-clusters)。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**升级**——收集器镜像固定在 `docker-compose.yml` 中，其配置是旁边的一个文件，所以仅拉取镜像并不会让代理更新。请再次运行安装脚本。它会沿用你现有 `.env` 中的每个值（不会再询问任何内容），下载最新的 `docker-compose.yml` 和 `otel-collector-config.yaml`（你编辑过的文件会以 `<file>.bak.<timestamp>` 保留在新文件旁边），拉取镜像并用它们重新创建代理。AI 代理的 `ceph/` 文件夹保持不变：",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "该配置会把它固定的收集器版本报告为集群的 **代理版本**。当此 OneUptime 固定了更新的版本时，旁边的警告标志会打开这些命令。",
  "**Uninstall** the agent:": "**卸载**代理：",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "如果你创建了 AI 代理的 Ceph 客户端，请在管理节点上删除它：`ceph auth del client.oneuptime-ai`。",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` 会检查整条链路（容器运行时、每个 mgr 端点及其中活动与备用的陷阱、集群名称标记、令牌格式、收集器自身指标），并直接询问 OneUptime 是否接受你的摄取密钥。最后一项检查最重要：OneUptime 的 OTLP 端点会以 `401` 或 `422` 拒绝错误的密钥，而收集器只会为每个批次记录一行很容易被忽略的 `Exporting failed`，所以脚本会向 `GET /otlp/v1/validate` 请求直接的 200/401 判定。",
  "It ends with a verdict naming the most likely cause.":
    "最后它会给出判定，指出最可能的原因。",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. 检查收集器日志：`docker logs oneuptime-ceph-agent`，查找导出错误（`401` 表示摄取密钥错误，连接被拒绝表示 `ONEUPTIME_URL` 错误）。",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. 确认 mgr 端点提供指标：`curl http://<active-mgr>:9283/metrics | head`，你应该能看到 `ceph_*` 指标行。如果没有，请启用该模块：`ceph mgr module enable prometheus`。",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. 确保 `CEPH_MGR_ENDPOINTS` 用方括号括起来：没有方括号时，收集器会把整个逗号分隔的字符串当作单个（无效的）目标。",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. 检查代理是否在运行：`docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. 检查代理日志中的错误：`docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. 确认你的 OneUptime URL 和摄取密钥正确。",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. 确保代理所在机器能通过网络访问 OneUptime 实例。",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "你可能只抓取了（之前的）活动 mgr。在 `CEPH_MGR_ENDPOINTS` 中列出**每一个** mgr 守护进程：抓取备用 mgr 的开销很小，并且返回空响应。",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "如果你的集群将 `mgr/prometheus/standby_behaviour` 设置为 `error`，这是预期行为：此时备用 mgr 会以 HTTP 500 响应。活动 mgr 的抓取仍会成功，所以这些错误只是噪音；把该行为改回 `default` 即可让它们消失。",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "集群的标识来自 `CEPH_CLUSTER_NAME`，它作为 `ceph.cluster.name` 标记在每个指标上。在 `.env` 中修正它，并在 `/opt/oneuptime-ceph-agent` 中用 `docker compose up -d` 应用——注意，新名称会注册一个新集群。",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **集群名称**：准确输入 **`ceph-1`**；不同的名称会注册一个新集群。",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "集群的标识来自 `CEPH_CLUSTER_NAME`，它作为 `ceph.cluster.name` 标记在每个指标上。此集群是 **`ceph-1`**。在 `.env` 中修正它，并在 `/opt/oneuptime-ceph-agent` 中用 `docker compose up -d` 应用——注意，新名称会注册一个新集群。",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "该命令已经带有你的 OneUptime URL 和摄取密钥。其余内容由脚本询问：",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "从此 OneUptime 下载 `docker-compose.yml` 和 `otel-collector-config.yaml` 到一个新文件夹：",
  "Create a `.env` file next to them:": "在它们旁边创建一个 `.env` 文件：",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- 将 `my-ceph-cluster` 替换为此集群的名称，例如 `ceph-prod`。集群在 OneUptime 中就以此名称显示，所以请保持不变：新名称会注册一个新集群。",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- 在 `CEPH_MGR_ENDPOINTS` 中列出**每一个** mgr 守护进程，以逗号分隔并用方括号括起来——没有方括号时，收集器会把整个列表当作一个无效目标读取。",
  "Start the agent:": "启动代理：",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中选择一个摄取密钥，以填入 `<YOUR_API_KEY>`。",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "Docker Compose 还会启动 **`oneuptime-ceph-ai-agent`**，即 OneUptime AI 代理。它会等待属于自己的 Ceph 客户端——参见“高级”中的 **OneUptime AI 代理**；如果你不使用 OneUptime AI，也可以从 `docker-compose.yml` 中删除它的服务。",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "代理从 `docker-compose.yml` 旁边的 `.env` 文件读取这些值。更改其中任何一项后，在 `docker-compose.yml` 所在的文件夹中用 `docker compose up -d` 应用它。",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | 是 | **全部** mgr 守护进程的 `host:port` 列表，以逗号分隔并用方括号括起来，例如 `[ceph-mon-1:9283,ceph-mon-2:9283]` |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "它以自己的 Ceph 客户端 `client.oneuptime-ai` 连接，使用集群的最小 `ceph.conf` 和该客户端的密钥环，二者放在 `docker-compose.yml` 旁边的 `ceph/` 文件夹中。在 Ceph 管理节点上，于代理的文件夹中运行：",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "在代理的文件夹（即 `docker-compose.yml` 所在的文件夹）中运行这些命令。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**升级**——收集器镜像固定在 `docker-compose.yml` 中，其配置是旁边的一个文件，所以仅拉取镜像并不会让代理更新。请重新下载这两个文件；你的 `.env` 会保留，而你对其中任一文件做过的更改需要重新做一遍：",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "然后拉取镜像并重新创建代理，让收集器读取新配置：",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "集群的标识来自 `CEPH_CLUSTER_NAME`，它作为 `ceph.cluster.name` 标记在每个指标上。在 `.env` 中修正它，并在 `docker-compose.yml` 所在的文件夹中用 `docker compose up -d` 应用——注意，新名称会注册一个新集群。",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- 这会为 **`ceph-1`** 安装代理——请让 `CEPH_CLUSTER_NAME` 保持原样，否则数据会注册为一个新集群。",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "集群的标识来自 `CEPH_CLUSTER_NAME`，它作为 `ceph.cluster.name` 标记在每个指标上。此集群是 **`ceph-1`**。在 `.env` 中修正它，并在 `docker-compose.yml` 所在的文件夹中用 `docker compose up -d` 应用——注意，新名称会注册一个新集群。",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | 否 | 收集器的容器名称（默认：`oneuptime-ceph-agent`）。同一台机器上第二个集群的代理需要自己的容器名称：除非你自行设置，否则安装脚本会按新代理的文件夹为其容器命名，并在你再次运行脚本时保留这些名称 |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | 否 | AI 代理的容器名称（默认：`oneuptime-ceph-ai-agent`）。除非你自行设置，否则安装脚本会按第二个集群的收集器为其 AI 代理命名（`oneuptime-ceph-ai-agent-cluster2` 与 `oneuptime-ceph-agent-cluster2` 并列），并在你再次运行脚本时保留该名称 |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "一个代理读取一个集群。对于第二个集群，请在单独的文件夹中安装第二个代理，并使用它自己的容器名称——两个容器不能共用一个名称：",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "除非你设置它们的变量（例如 `CEPH_AGENT_CONTAINER_NAME`），否则脚本会按文件夹为容器命名，例如 `oneuptime-ceph-agent-cluster2`。它会把名称保存在该代理的 `.env` 中，所以用同一个 `INSTALL_DIR` 再次运行脚本来升级代理时会保留这些名称；而你曾在 `docker-compose.yml` 中编辑过 `container_name` 的代理，也会保留那个名称。",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "请为每个文件夹取一个独有的名称：Docker Compose 只按文件夹为项目命名，因此如果某个文件夹与别处已在运行代理的文件夹同名，脚本会拒绝它。用 `-d` 把文件夹传给诊断脚本。",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | 否 | 收集器的容器名称（默认：`oneuptime-ceph-agent`）。同一台机器上第二个集群的代理需要自己的容器名称 |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | 否 | AI 代理的容器名称（默认：`oneuptime-ceph-ai-agent`）。同一台机器上第二个集群的代理需要自己的容器名称 |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "一个代理读取一个集群。对于第二个集群，请在单独的文件夹中设置第二个代理，并使用它自己的容器名称——两个容器不能共用一个名称。请在该代理的 `.env` 中设置这些名称：",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "请为每个文件夹取一个独有的名称：Docker Compose 只按文件夹为项目命名，因此同名的第二个文件夹会替换第一个代理的容器。不要把这些名称写进 `docker-compose.yml`，升级会替换该文件。",
};

export default TRANSLATION;
