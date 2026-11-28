import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The DockerSwarm setup guide in Simplified Chinese (#8341): each piece of the English
 * guide's markdown (Pages/DockerSwarm/Utils/DocumentationMarkdown.ts) and its
 * Simplified Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Simplified Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Docker Swarm **manager** node to run it on — the inventory poller calls manager-only API endpoints (`/nodes`, `/services`, `/tasks`)":
    "用来运行它的一个 Docker Swarm **manager** 节点——清单轮询器会调用只有 manager 才有的 API 端点（`/nodes`、`/services`、`/tasks`）",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin":
    "带 Docker Compose v2 插件的 Docker Engine 20.10 或更高版本",
  "When it asks, enter the OneUptime URL and the ingestion key shown in step 1, and a name for the cluster, such as `prod-swarm`. The name is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "在询问时，输入第 1 步中显示的 OneUptime URL 和摄取密钥，以及集群名称，例如 `prod-swarm`。集群在 OneUptime 中就以这个名称显示，所以请保持不变：新名称会注册为新集群。",
  "The script puts the agent in `/opt/oneuptime-docker-swarm-agent` and starts it with Docker Compose.":
    "脚本会把代理放到 `/opt/oneuptime-docker-swarm-agent`，并用 Docker Compose 启动它。",
  "`docker compose ps` lists three containers: the collector (`oneuptime-docker-swarm-agent`), the inventory poller (`oneuptime-docker-swarm-inventory`) and the OneUptime AI agent (`oneuptime-docker-swarm-ai-agent`). The cluster appears in the **Docker Swarm** section within a few minutes, and its Nodes, Services, Tasks, Stacks, Networks, Secrets, Configs and Volumes pages fill in after the first inventory snapshot (≤ 5 minutes).":
    "`docker compose ps` 会列出三个容器：收集器（`oneuptime-docker-swarm-agent`）、清单轮询器（`oneuptime-docker-swarm-inventory`）和 OneUptime AI 代理（`oneuptime-docker-swarm-ai-agent`）。集群会在几分钟内出现在 **Docker Swarm** 部分，其节点、服务、任务、堆栈、网络、密钥、配置和卷页面会在第一次清单快照（≤ 5 分钟）后填充。",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only docker commands such as `docker node ls` and `docker service ps`, and changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced.":
    "**OneUptime AI 代理（默认开启，只读）。** AI 调查已开启：它让 OneUptime AI 用 `docker node ls` 和 `docker service ps` 等只读 docker 命令调查此集群上的事件和警报，除非你允许修复，否则不会做任何更改——参见 高级 中的 **OneUptime AI 智能体**。",
  "Run the agent on a **manager** node: the inventory poller and the OneUptime AI agent call manager-only API endpoints. The collector reports the containers of the node it runs on, so for per-node container metrics run the collector on every node, all with the same `DOCKER_SWARM_CLUSTER_NAME`; the inventory poller only needs to run on one manager. Run the install script on a node that is not a manager, and it leaves the OneUptime AI agent out there.":
    "请在 **manager** 节点上运行代理：清单轮询器和 OneUptime AI 代理会调用只有 manager 才有的 API 端点。收集器只上报它所在节点的容器，因此要获得每个节点的容器指标，请在每个节点上运行收集器，并都使用相同的 `DOCKER_SWARM_CLUSTER_NAME`；清单轮询器只需在一个 manager 上运行。如果在不是 manager 的节点上运行安装脚本，它会在那里省略 OneUptime AI 代理。",
  "Deploying the agent as a swarm stack rather than with Compose? Pin the inventory poller and the AI agent to managers — docker-compose.yml carries this block, commented out, on both services:":
    "以 swarm 堆栈而不是 Compose 部署代理？请把清单轮询器和 AI 代理固定到 manager 上——docker-compose.yml 在两个服务中都带有这个已注释掉的块：",
  "| Variable | Required | Description |": "| 变量 | 必填 | 说明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 实例的 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | 是 | 第 1 步中的遥测摄取密钥 |",
  "| `DOCKER_SWARM_CLUSTER_NAME` | Yes | The cluster's name in OneUptime, and its join key: stamped on every signal as the `docker.swarm.cluster.name` resource attribute. Defaults to `docker-swarm` |":
    "| `DOCKER_SWARM_CLUSTER_NAME` | 是 | 集群在 OneUptime 中的名称，也是它的关联键：作为资源属性 `docker.swarm.cluster.name` 标记在每个信号上。默认为 `docker-swarm` |",
  "| `DOCKER_SWARM_NODE_NAME` | No | This node's name, stamped on its containers' metrics and logs as `docker.swarm.node.name` — what a Docker Swarm monitor's **Node Name** filter matches. The install script sets it to the node's hostname, the name `docker node ls` shows. Empty: no node name is stamped |":
    "| `DOCKER_SWARM_NODE_NAME` | 否 | 此节点的名称，作为 `docker.swarm.node.name` 标记在其容器的指标和日志上——Docker Swarm 监控器的 **节点名称** 过滤器匹配的就是它。安装脚本会把它设为节点的主机名，即 `docker node ls` 显示的名称。为空：不标记节点名称 |",
  "| `DOCKER_INVENTORY_INTERVAL_SECONDS` | No | How often the poller refreshes the inventory snapshot (default `300`) |":
    "| `DOCKER_INVENTORY_INTERVAL_SECONDS` | 否 | 轮询器刷新清单快照的频率（默认 `300`） |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the collector and the inventory poller speak. Empty by default: they use the daemon's own, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | 否 | 收集器和清单轮询器使用的 Docker Engine API 版本。默认为空：它们使用守护进程自己的版本，因此 20.10 及以后的任何 Docker Engine 都能使用。仅在需要固定版本时设置（参见 故障排除） |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` 到 `ONEUPTIME_LOG_OPERATOR_5` | 否 | 你自己的收集器操作符，每个都以 JSON 形式提供，用于代理读取不了的日志格式 |",
  "The install script writes the first four to `/opt/oneuptime-docker-swarm-agent/.env`. Add or change any of them there, then run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent` to recreate the containers with the new values.":
    "安装脚本会把前四个写入 `/opt/oneuptime-docker-swarm-agent/.env`。在那里添加或修改任意一个，然后在 `/opt/oneuptime-docker-swarm-agent` 中运行 `docker compose up -d`，用新值重新创建容器。",
  "The agent's docker-compose.yml also runs the OneUptime AI agent, `oneuptime-docker-swarm-ai-agent`. It runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this cluster, and it appears on the cluster's **AI → AI agent** page. Like the inventory poller it must run on a manager node — on a worker it runs nothing.":
    "代理的 docker-compose.yml 还会运行 OneUptime AI 代理 `oneuptime-docker-swarm-ai-agent`。它在 OneUptime AI 调查此集群上的事件或警报时，运行它所请求的 `docker` 命令，并显示在集群的 **人工智能 → AI 代理** 页面上。与清单轮询器一样，它必须在 manager 节点上运行——在 worker 上它什么都不运行。",
  "- **Read-only by default.** It runs commands such as `docker node ls`, `docker service ls`, `docker service ps NAME` and `docker service logs --tail 200 NAME` — never `service create`/`rm`, `stack deploy`/`rm`, secrets, configs or `exec`. Environment values in `docker service inspect` output are masked before anything leaves the node.":
    "- **默认只读。** 它运行 `docker node ls`、`docker service ls`、`docker service ps NAME` 和 `docker service logs --tail 200 NAME` 等命令，绝不运行 `service create`/`rm`、`stack deploy`/`rm`、密钥、配置或 `exec`。`docker service inspect` 输出中的环境变量值会在任何内容离开节点之前被遮蔽。",
  "- **Fixes are opt-in.** Set `ONEUPTIME_AI_ALLOW_WRITES=true` in `/opt/oneuptime-docker-swarm-agent/.env` and run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent` to let it roll a named service (`docker service update --force`), roll it back or scale it. `ONEUPTIME_AI_FIXES` in the same file says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the cluster's **AI → AI agent** page shows it. Draining a node always needs a person's approval. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs of service and node names) limits what fixes may touch; `ONEUPTIME_AI_PROTECTED_TARGETS` adds services it must never change. It never changes itself, the collector or the inventory poller.":
    "- **修复需要主动开启。** 在 `/opt/oneuptime-docker-swarm-agent/.env` 中设置 `ONEUPTIME_AI_ALLOW_WRITES=true`，并在 `/opt/oneuptime-docker-swarm-agent` 中运行 `docker compose up -d`，即可允许它重新部署指定名称的服务（`docker service update --force`）、回滚或扩缩容。同一文件中的 `ONEUPTIME_AI_FIXES` 决定每项修复是否需要审批（`ask-for-approval`、`automatic` 或 `bypass-approval`），集群的 **人工智能 → AI 代理** 页面会显示这一点。排空节点始终需要人工审批。`ONEUPTIME_AI_WRITE_TARGETS`（服务名和节点名的逗号分隔通配符）限定修复可以触及的对象；`ONEUPTIME_AI_PROTECTED_TARGETS` 添加它绝不能更改的服务。它绝不会更改自身、收集器或清单轮询器。",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- 由于 Docker 套接字归 root 所有，它以 root 身份运行。以 `:ro` 方式挂载套接字并不会让 Docker API 变为只读——真正的限制是代理的命令策略。",
  "- To leave it out, run the install script with `--no-ai-agent`: `sh install.sh --no-ai-agent`.":
    "- 要省略它，请用 `--no-ai-agent` 运行安装脚本：`sh install.sh --no-ai-agent`。",
  "- Its logs: `docker compose logs -f oneuptime-docker-swarm-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-swarm-clusters).":
    "- 它的日志：`docker compose logs -f oneuptime-docker-swarm-ai-agent`。它可以运行什么，以及修复如何工作：[基础设施 AI 代理](/docs/ai/infrastructure-ai-agents#docker-swarm-clusters)。",
  "The agent is three containers, all defined in its docker-compose.yml:":
    "代理由三个容器组成，都定义在它的 docker-compose.yml 中：",
  "1. **Collector** (`oneuptime-docker-swarm-agent`) — the stock `otel/opentelemetry-collector-contrib` image with a tuned config. It scrapes `docker_stats` for per-container CPU and memory, tails container logs, and tails the inventory snapshot file — stamping everything with `docker.swarm.cluster.name`, and each task's metrics with its service and node, before shipping it to OneUptime over OTLP.":
    "1. **收集器**（`oneuptime-docker-swarm-agent`）——带有调优配置的原版 `otel/opentelemetry-collector-contrib` 镜像。它读取 `docker_stats` 获取每个容器的 CPU 和内存，跟踪容器日志和清单快照文件——给所有数据标记 `docker.swarm.cluster.name`，并给每个任务的指标标记其服务和节点，然后通过 OTLP 发送到 OneUptime。",
  "2. **Inventory poller** (`oneuptime-docker-swarm-inventory`) — a small `alpine` + `curl` + `jq` sidecar that every 5 minutes walks the Swarm manager API (`/nodes`, `/services`, `/tasks`, `/networks`, `/secrets`, `/configs`, `/volumes`) and derives stacks from the `com.docker.stack.namespace` service label, writing one JSON line per object for the collector to forward.":
    "2. **清单轮询器**（`oneuptime-docker-swarm-inventory`）——一个由 `alpine` + `curl` + `jq` 组成的小型边车，每 5 分钟遍历一次 Swarm manager API（`/nodes`、`/services`、`/tasks`、`/networks`、`/secrets`、`/configs`、`/volumes`），并从服务标签 `com.docker.stack.namespace` 推导出堆栈，每个对象写一行 JSON，由收集器转发。",
  "3. **OneUptime AI agent** (`oneuptime-docker-swarm-ai-agent`) — runs the commands OneUptime AI asks for; see **The OneUptime AI agent** above.":
    "3. **OneUptime AI 代理**（`oneuptime-docker-swarm-ai-agent`）——运行 OneUptime AI 请求的命令；参见上文的 **OneUptime AI 智能体**。",
  "**Upgrade** — run the install script again. It downloads the latest docker-compose.yml, collector config and inventory poller into `/opt/oneuptime-docker-swarm-agent`, pulls the images and restarts the agent; answer its questions with the same URL, key and cluster name:":
    "**升级**——再次运行安装脚本。它会把最新的 docker-compose.yml、收集器配置和清单轮询器下载到 `/opt/oneuptime-docker-swarm-agent`，拉取镜像并重启代理；用相同的 URL、密钥和集群名称回答它的问题：",
  "It rewrites `.env` from your answers and keeps only the AI agent's target lists and what AI may do (`ONEUPTIME_AI_INVESTIGATION`, `ONEUPTIME_AI_FIXES`): add back any variable you set yourself, such as `DOCKER_API_VERSION`. Turned on AI fixes? Run it as `ONEUPTIME_AI_ALLOW_WRITES=true sh install.sh` to keep them on. Left the AI agent out? Pass `--no-ai-agent` again.":
    "它会根据你的回答重写 `.env`，只保留 AI 代理的目标列表和 AI 可以执行的操作（`ONEUPTIME_AI_INVESTIGATION`、`ONEUPTIME_AI_FIXES`）：请把你自己设置过的变量加回去，例如 `DOCKER_API_VERSION`。开启了 AI 修复？请以 `ONEUPTIME_AI_ALLOW_WRITES=true sh install.sh` 的形式运行它来保留。省略了 AI 代理？请再次传入 `--no-ai-agent`。",
  "**Uninstall:**": "**卸载：**",
  "| Signal | Source | Powers |": "| 信号 | 来源 | 用于 |",
  "| Node / Service / Task / Stack / Network / Secret / Config / Volume inventory | inventory poller → Swarm manager API | the cluster's resource list + detail pages |":
    "| 节点 / 服务 / 任务 / 堆栈 / 网络 / 密钥 / 配置 / 卷的清单 | 清单轮询器 → Swarm manager API | 集群的资源列表和详情页 |",
  "| Cluster counts (nodes ready, tasks running, services, stacks, …) | derived from the same snapshot | the overview cards + sidebar badges |":
    "| 集群计数（就绪节点、运行中的任务、服务、堆栈等…） | 从同一快照推导 | 概览卡片和侧边栏徽标 |",
  "| Container CPU / memory / pids / uptime | `docker_stats` receiver | the Metrics tab |":
    "| 容器的 CPU / 内存 / PID / 运行时间 | `docker_stats` 接收器 | 指标 选项卡 |",
  "| Container stdout/stderr logs | `filelog` receiver | the Logs tab |":
    "| 容器的 stdout/stderr 日志 | `filelog` 接收器 | 日志 选项卡 |",
  "Each task's metrics carry its container (`container.name`, `container.image.name`, and `container.runtime=docker`, which the `docker_stats` receiver adds), its service (`docker.swarm.service.name`) and its node (`docker.swarm.node.id`, and `docker.swarm.node.name` from `DOCKER_SWARM_NODE_NAME`). The agent stamps `docker.swarm.cluster.name` on everything and never `host.name`, so OneUptime attributes the telemetry to this swarm cluster rather than registering each node as a standalone Host or Docker Host.":
    "每个任务的指标都带有它的容器（`container.name`、`container.image.name`，以及 `docker_stats` 接收器添加的 `container.runtime=docker`）、它的服务（`docker.swarm.service.name`）和它的节点（`docker.swarm.node.id`，以及来自 `DOCKER_SWARM_NODE_NAME` 的 `docker.swarm.node.name`）。代理会给所有数据标记 `docker.swarm.cluster.name`，但绝不标记 `host.name`，因此 OneUptime 会把遥测归到这个 swarm 集群，而不是把每个节点注册为独立的主机或 Docker 主机。",
  "Run the diagnostic script on the manager node. It checks the containers, that the inventory poller is on a manager, the snapshot file, the cluster name and the key — and asks OneUptime directly whether it accepts the ingestion key. A rejected key (`401` or `422`) otherwise shows only as an easy-to-miss `Exporting failed` line in the collector's logs.":
    "在 manager 节点上运行诊断脚本。它会检查容器、清单轮询器是否在 manager 上、快照文件、集群名称和密钥——并直接询问 OneUptime 是否接受该摄取密钥。否则，被拒绝的密钥（`401` 或 `422`）只会在收集器日志中显示为一行容易被忽略的 `Exporting failed`。",
  "Otherwise, check the collector's logs (`docker compose logs oneuptime-docker-swarm-agent` in `/opt/oneuptime-docker-swarm-agent`), that `ONEUPTIME_SERVICE_TOKEN` and `ONEUPTIME_URL` in `/opt/oneuptime-docker-swarm-agent/.env` are correct, and that the manager can reach your OneUptime instance.":
    "否则，请检查收集器的日志（在 `/opt/oneuptime-docker-swarm-agent` 中运行 `docker compose logs oneuptime-docker-swarm-agent`），确认 `/opt/oneuptime-docker-swarm-agent/.env` 中的 `ONEUPTIME_SERVICE_TOKEN` 和 `ONEUPTIME_URL` 正确，并确认 manager 能访问你的 OneUptime 实例。",
  "Confirm the poller runs on a manager: `docker node ls` must succeed there. Then look for `failed to emit ...` lines in its logs:":
    "确认轮询器运行在 manager 上：`docker node ls` 必须能在那里成功运行。然后在它的日志中查找 `failed to emit ...` 行：",
  "The cluster is marked disconnected after 15 minutes without telemetry. Make sure the collector container (`oneuptime-docker-swarm-agent`) stays running — `docker compose ps` in `/opt/oneuptime-docker-swarm-agent` shows it.":
    "集群在 15 分钟没有遥测后会被标记为已断开。请确保收集器容器（`oneuptime-docker-swarm-agent`）保持运行——在 `/opt/oneuptime-docker-swarm-agent` 中运行 `docker compose ps` 可以看到它。",
  "The collector's logs show:": "收集器的日志显示：",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The collector pins a version only when `DOCKER_API_VERSION` names one, and older agent files pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Run the install script again: it downloads the current files, which leave the version empty. Then take any `DOCKER_API_VERSION=` line with a version out of `/opt/oneuptime-docker-swarm-agent/.env`, or set it empty — `DOCKER_API_VERSION=` — and run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent`, on every node the collector runs on. The collector then negotiates the version with the daemon.":
    "守护进程会拒绝比自身最高版本更新的客户端，收集器因此退出，容器反复重启。只有当 `DOCKER_API_VERSION` 指定了版本时，收集器才会固定版本，而旧的代理文件固定了 `1.44`，Docker Engine 20.10 到 24 会拒绝它。请再次运行安装脚本：它会下载当前的文件，其中版本为空。然后从 `/opt/oneuptime-docker-swarm-agent/.env` 中去掉任何带版本的 `DOCKER_API_VERSION=` 行，或把它设为空——`DOCKER_API_VERSION=`——并在运行收集器的每个节点上，于 `/opt/oneuptime-docker-swarm-agent` 中运行 `docker compose up -d`。之后收集器会与守护进程协商版本。",
  "To pin a version anyway, use no more than the daemon's maximum, such as `DOCKER_API_VERSION=1.41`:":
    "如果仍要固定版本，请不要超过守护进程的最高版本，例如 `DOCKER_API_VERSION=1.41`：",
  "Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "较新的守护进程仍然支持旧的 API 版本，因此固定的版本在升级 Docker 后仍可使用。",
  "The cluster's name comes from `DOCKER_SWARM_CLUSTER_NAME`. Change it in `/opt/oneuptime-docker-swarm-agent/.env` and run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent` — note that a new name registers a new cluster.":
    "集群的名称来自 `DOCKER_SWARM_CLUSTER_NAME`。在 `/opt/oneuptime-docker-swarm-agent/.env` 中修改它，并在 `/opt/oneuptime-docker-swarm-agent` 中运行 `docker compose up -d`——注意，新名称会注册为新集群。",
  "When it asks, enter the OneUptime URL and the ingestion key shown in step 1, and **`swarm-1`** as the cluster name — exactly, or the data registers as a new cluster.":
    "在询问时，输入第 1 步中显示的 OneUptime URL 和摄取密钥，并把集群名称原样输入为 **`swarm-1`**，否则数据会注册为一个新集群。",
  "Replace `my-swarm` with a name for this cluster, such as `prod-swarm`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "将 `my-swarm` 替换为此集群的名称，例如 `prod-swarm`。集群在 OneUptime 中就以这个名称显示，所以请保持不变：新名称会注册为新集群。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步选择一个摄取密钥，即可填入 `<YOUR_API_KEY>`。",
  "Add this node's name to it. The collector puts it on the node's container metrics, and a Docker Swarm monitor's **Node Name** filter matches it:":
    "在其中加上此节点的名称。收集器会把它标记在该节点的容器指标上，Docker Swarm 监控器的 **节点名称** 过滤器会匹配它：",
  "Then start it:": "然后启动它：",
  "Run the agent on a **manager** node: the inventory poller and the OneUptime AI agent call manager-only API endpoints. The collector reports the containers of the node it runs on, so for per-node container metrics run the collector on every node, all with the same `DOCKER_SWARM_CLUSTER_NAME`; the inventory poller only needs to run on one manager.":
    "请在 **manager** 节点上运行代理：清单轮询器和 OneUptime AI 代理会调用只有 manager 才有的 API 端点。收集器只上报它所在节点的容器，因此要获得每个节点的容器指标，请在每个节点上运行收集器，并都使用相同的 `DOCKER_SWARM_CLUSTER_NAME`；清单轮询器只需在一个 manager 上运行。",
  "| `DOCKER_SWARM_NODE_NAME` | No | This node's name, stamped on its containers' metrics and logs as `docker.swarm.node.name` — what a Docker Swarm monitor's **Node Name** filter matches. Set it to the node's hostname, the name `docker node ls` shows: `echo \"DOCKER_SWARM_NODE_NAME=$(docker info --format '{{.Name}}')\" >> .env`. Empty: no node name is stamped |":
    "| `DOCKER_SWARM_NODE_NAME` | 否 | 此节点的名称，作为 `docker.swarm.node.name` 标记在其容器的指标和日志上——Docker Swarm 监控器的 **节点名称** 过滤器匹配的就是它。请把它设为节点的主机名，即 `docker node ls` 显示的名称：`echo \"DOCKER_SWARM_NODE_NAME=$(docker info --format '{{.Name}}')\" >> .env`。为空：不标记节点名称 |",
  "Set them in the `.env` next to docker-compose.yml, then run `docker compose up -d` to recreate the containers with the new values.":
    "在 docker-compose.yml 旁边的 `.env` 中设置它们，然后运行 `docker compose up -d`，用新值重新创建容器。",
  "- **Fixes are opt-in.** Set `ONEUPTIME_AI_ALLOW_WRITES=true` in the `.env` next to docker-compose.yml and run `docker compose up -d` in the agent's folder to let it roll a named service (`docker service update --force`), roll it back or scale it. `ONEUPTIME_AI_FIXES` in the same file says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the cluster's **AI → AI agent** page shows it. Draining a node always needs a person's approval. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs of service and node names) limits what fixes may touch; `ONEUPTIME_AI_PROTECTED_TARGETS` adds services it must never change. It never changes itself, the collector or the inventory poller.":
    "- **修复需要主动开启。** 在 docker-compose.yml 旁边的 `.env` 中设置 `ONEUPTIME_AI_ALLOW_WRITES=true`，并在代理的文件夹中运行 `docker compose up -d`，即可允许它重新部署指定名称的服务（`docker service update --force`）、回滚或扩缩容。同一文件中的 `ONEUPTIME_AI_FIXES` 决定每项修复是否需要审批（`ask-for-approval`、`automatic` 或 `bypass-approval`），集群的 **人工智能 → AI 代理** 页面会显示这一点。排空节点始终需要人工审批。`ONEUPTIME_AI_WRITE_TARGETS`（服务名和节点名的逗号分隔通配符）限定修复可以触及的对象；`ONEUPTIME_AI_PROTECTED_TARGETS` 添加它绝不能更改的服务。它绝不会更改自身、收集器或清单轮询器。",
  "- To leave it out, delete the `oneuptime-docker-swarm-ai-agent` service from docker-compose.yml.":
    "- 要省略它，请从 docker-compose.yml 中删除 `oneuptime-docker-swarm-ai-agent` 服务。",
  "**Upgrade** — the collector image is pinned in docker-compose.yml and its config is a file next to it, so pulling alone does not move the agent forward. Download the three files again (the commands in step 2 — then re-apply any change you made to docker-compose.yml), and in the agent's folder:":
    "**升级**——收集器镜像固定在 docker-compose.yml 中，其配置是旁边的一个文件，因此仅拉取镜像并不能让代理更新。请重新下载这三个文件（第 2 步中的命令——然后重新应用你对 docker-compose.yml 做过的任何修改），并在代理的文件夹中：",
  "**Uninstall** — in the agent's folder:": "**卸载**——在代理的文件夹中：",
  "Otherwise, check the collector's logs (`docker compose logs oneuptime-docker-swarm-agent` in the agent's folder), that `ONEUPTIME_SERVICE_TOKEN` and `ONEUPTIME_URL` in the `.env` next to docker-compose.yml are correct, and that the manager can reach your OneUptime instance.":
    "否则，请检查收集器的日志（在代理的文件夹中运行 `docker compose logs oneuptime-docker-swarm-agent`），确认 docker-compose.yml 旁边的 `.env` 中的 `ONEUPTIME_SERVICE_TOKEN` 和 `ONEUPTIME_URL` 正确，并确认 manager 能访问你的 OneUptime 实例。",
  "The cluster is marked disconnected after 15 minutes without telemetry. Make sure the collector container (`oneuptime-docker-swarm-agent`) stays running — `docker compose ps` in the agent's folder shows it.":
    "集群在 15 分钟没有遥测后会被标记为已断开。请确保收集器容器（`oneuptime-docker-swarm-agent`）保持运行——在代理的文件夹中运行 `docker compose ps` 可以看到它。",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The collector pins a version only when `DOCKER_API_VERSION` names one, and older agent files pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Download the agent's files again (step 2), which leave the version empty. Then take any `DOCKER_API_VERSION=` line with a version out of the `.env` next to docker-compose.yml, or set it empty — `DOCKER_API_VERSION=` — and run `docker compose up -d` in the agent's folder, on every node the collector runs on. The collector then negotiates the version with the daemon.":
    "守护进程会拒绝比自身最高版本更新的客户端，收集器因此退出，容器反复重启。只有当 `DOCKER_API_VERSION` 指定了版本时，收集器才会固定版本，而旧的代理文件固定了 `1.44`，Docker Engine 20.10 到 24 会拒绝它。请重新下载代理的文件（第 2 步），其中版本为空。然后从 docker-compose.yml 旁边的 `.env` 中去掉任何带版本的 `DOCKER_API_VERSION=` 行，或把它设为空——`DOCKER_API_VERSION=`——并在运行收集器的每个节点上，于代理的文件夹中运行 `docker compose up -d`。之后收集器会与守护进程协商版本。",
  "The cluster's name comes from `DOCKER_SWARM_CLUSTER_NAME`. Change it in the `.env` next to docker-compose.yml and run `docker compose up -d` in the agent's folder — note that a new name registers a new cluster.":
    "集群的名称来自 `DOCKER_SWARM_CLUSTER_NAME`。在 docker-compose.yml 旁边的 `.env` 中修改它，并在代理的文件夹中运行 `docker compose up -d`——注意，新名称会注册为新集群。",
  "This installs the agent for **`swarm-1`** — keep `DOCKER_SWARM_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "这会为 **`swarm-1`** 安装代理——请保持 `DOCKER_SWARM_CLUSTER_NAME` 原样不变，否则数据会注册为一个新集群。",
};

export default TRANSLATION;
