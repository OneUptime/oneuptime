import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in Simplified Chinese (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * Simplified Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Simplified Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman 4.0 或更高版本",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "Podman 位于 `/run/podman/podman.sock` 的 Docker 兼容 API 套接字——用 `sudo systemctl enable --now podman.socket` 开启它",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "要收集日志的容器必须使用 `k8s-file` 日志驱动——rootful 模式的 Podman 默认使用 `journald`，代理无法读取",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "然后在旁边用相同的 URL、密钥和主机名启动 OneUptime AI 代理。**AI 调查默认开启**：OneUptime AI 调查此主机上的事件或警报时，会通过 AI 代理对 Podman 的 Docker 兼容套接字运行只读的 `docker` 命令，除非你允许修复，否则不会做任何更改——参见 高级 中的 **OneUptime AI 智能体**。跳过此命令即可在没有 AI 调查的情况下运行收集器。",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "将 `my-podman-host` 替换为此主机的名称，例如 `prod-podman-01`。主机在 OneUptime 中就以这个名称显示，所以请保持不变：新名称会注册为新主机。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步选择一个摄取密钥，即可填入 `<YOUR_API_KEY>`。",
  "Look for this line in the logs:": "在日志中查找这一行：",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "代理连接后，主机会自动出现在 **Podman** 部分，通常在一分钟左右。OneUptime AI 代理会在主机的 **人工智能 → AI 代理** 页面和其 **概览** 底部显示为 已连接。",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**有指标却没有日志？** rootful 模式的 Podman 默认把容器日志写入 `journald`，代理无法读取。请用 `--log-driver k8s-file` 运行你的容器——参见 高级 中的 **收集所有容器的日志（k8s-file 日志驱动）**。",
  "| Variable | Required | Description |": "| 变量 | 必填 | 说明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 实例的 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | 是 | 第 1 步中的遥测摄取密钥 |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | 否 | 此主机的易记名称。默认为 `podman-host` |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | 否 | 代理与 Podman 套接字通信时使用的 Docker API 版本。默认为空：代理会与套接字协商版本。仅在需要固定版本时设置（参见 故障排除） |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` 到 `ONEUPTIME_LOG_OPERATOR_5` | 否 | 你自己的收集器操作符，每个都以 JSON 形式提供，用于代理读取不了的日志格式 |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "将每个变量以 `-e NAME=value` 的形式传给 `podman run`。之后要修改某个变量，请用 `podman rm -f oneuptime-podman-agent` 删除代理，再用新值重新运行命令。",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "代理读取 Podman **`k8s-file`** 日志驱动写入的文件（`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`），因此只能看到使用它（或 `json-file`，Podman 把它当作同一个基于文件的驱动）的容器的日志。rootful 模式的 Podman 默认使用 **`journald`**，代理无法读取，也无法读取 `syslog` 之类的远程驱动。",
  "Check a container's log driver, and Podman's default:":
    "检查容器的日志驱动和 Podman 的默认驱动：",
  "Run a single container with `k8s-file`:": "用 `k8s-file` 运行单个容器：",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "将 Compose 服务切换为带轮转的 `k8s-file`：",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "或者在 `containers.conf`（rootful 模式为 `/etc/containers/containers.conf`，rootless 模式为 `~/.config/containers/containers.conf`）中，为之后创建的所有容器更改默认驱动：",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "然后 **重新创建** 受影响的容器（仅重启不够）：容器会保留创建时的日志驱动。必须保留 `journald`？代理仍会通过套接字收集指标；只有容器日志需要基于文件的驱动。",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent` 是第 2 步启动的第二个容器，在 OneUptime AI 调查此主机上的事件或警报时，通过 Podman 的 Docker 兼容套接字运行它所请求的 `docker` 命令。**AI 调查默认开启**：它一连接，OneUptime AI 就会用它进行调查，主机的 **人工智能 → AI 代理** 页面和 **概览** 会显示它的状态。要关闭调查，请使用该页面上的 **AI 可以执行的操作**；要在没有 AI 代理的情况下运行收集器，请用 `podman rm -f oneuptime-podman-ai-agent` 删除它。",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **默认只读。** 它运行 `docker ps`、`docker logs --tail 200 NAME`、`docker inspect` 和 `docker stats --no-stream` 等命令，绝不运行 `exec`、`run`、`rm` 或 `prune`。`docker inspect` 输出中的环境变量值会在任何内容离开主机之前被遮蔽。",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **修复需要主动开启。** 在命令中加上 `-e ONEUPTIME_AI_ALLOW_WRITES=true`，即可允许它重启、启动、停止、暂停、终止指定名称的容器或更改其限制。旁边的 `ONEUPTIME_AI_FIXES` 决定每项修复是否需要审批（`ask-for-approval`、`automatic` 或 `bypass-approval`），主机的 **人工智能 → AI 代理** 页面会显示这一点。`ONEUPTIME_AI_WRITE_TARGETS`（逗号分隔的通配符，例如 `web-*,api-*`）限定可操作的容器；`ONEUPTIME_AI_PROTECTED_TARGETS` 添加它绝不能更改的容器。它绝不会更改自身或收集器。",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- 它需要与收集器相同的套接字，并且由于套接字归 root 所有，它以 root 身份运行。以 `:ro` 方式挂载套接字并不会让 API 变为只读——真正的限制是代理的命令策略。",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- 它的日志：`podman logs -f oneuptime-podman-ai-agent`。它可以运行什么，以及修复如何工作：[基础设施 AI 代理](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts)。",
  "| Tag | Description |": "| 标签 | 说明 |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | 最新稳定版（community） |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | 最新稳定版（enterprise） |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | 固定的版本，例如 `10.0.31` |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | 同一镜像，镜像于 GHCR |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "用其中一个替换 `podman run` 命令末尾的 `oneuptime/podman-agent:release`。",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**升级**：拉取最新镜像，并删除正在运行的代理：",
  "Then run both `podman run` commands from step 2 again.":
    "然后重新运行第 2 步中的两条 `podman run` 命令。",
  "**Uninstall:**": "**卸载：**",
  "| Category | Data |": "| 类别 | 数据 |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **CPU 指标** | 总使用量、使用率、节流时间（按容器） |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **内存指标** | 使用量、限制、百分比、RSS、缓存（按容器） |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **网络指标** | 接收/发送的字节数和数据包数（按容器） |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **块 I/O 指标** | 读/写字节数和操作数（按容器） |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **容器信息** | 运行时间、重启次数、进程数 |",
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **容器日志** | 所有使用 `k8s-file` 日志驱动的容器的 stdout/stderr 日志 |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    '这些指标来自收集器的 `docker_stats` 接收器，经由 Podman 的 Docker 兼容套接字，因此名称与 Docker 代理的相同。每行日志的严重级别取自它标明的级别（`[ERROR]`、`level=warn`、`{"level":"info"}`）；没有级别的行按其输出流确定：stderr 为 `ERROR`，stdout 为 `INFO`。',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "代理必须以 root 身份运行才能读取 `/run/podman/podman.sock`。请确认你的 `podman run` 命令中有 `--user 0:0` 标志，并且套接字已开启：",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "这是 rootful 模式 Podman 的套接字，也就是代理读取的那个。以 rootless 模式运行 Podman？它的套接字是 `/run/user/<uid>/podman/podman.sock`（用 `systemctl --user enable --now podman.socket` 开启），存储是 `~/.local/share/containers/storage`：请改为把它们挂载到代理容器中的 `/run/podman/podman.sock` 和 `/var/lib/containers/storage`——参见 Podman 代理文档。",
  "The agent's logs show:": "代理的日志显示：",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "设有最高版本的服务器会拒绝更新的客户端，收集器因此退出，容器反复重启。只有当 `DOCKER_API_VERSION` 指定了版本时，代理才会固定 Docker API 版本，而旧的代理镜像固定了 `1.44`。请删除代理（`podman rm -f oneuptime-podman-agent`），拉取最新镜像（`podman pull oneuptime/podman-agent:release`），然后去掉 `-e DOCKER_API_VERSION` 重新运行第 2 步中的命令。之后代理会与套接字协商版本。",
  "To pin a version anyway, use no more than the version the socket reports:":
    "如果仍要固定版本，请不要超过套接字上报的版本：",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "将它加到命令中，例如 `-e DOCKER_API_VERSION=1.41`。较新的服务器仍然支持旧的 API 版本，因此固定的版本在升级后仍可使用。",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. 检查代理是否在运行：`podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. 检查代理的日志中是否有错误：`podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. 确认 `podman run` 命令中的 OneUptime URL 和摄取密钥正确。",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. 确认主机能通过网络访问你的 OneUptime 实例。",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "检查 Podman 套接字是否已挂载到代理中。它的镜像没有 shell，所以请从一个共享其挂载的临时容器中查看：",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "然后在代理的日志中查找导出错误（`podman logs oneuptime-podman-agent 2>&1 | grep -i error`），并确认摄取密钥有效且未过期。",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "指标能收到，但 **日志** 选项卡为空，或只显示代理自己的日志？你的容器很可能没有使用基于文件的日志驱动（`k8s-file` 或 `json-file`）——rootful 模式的 Podman 默认使用 `journald`，代理无法读取。",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "如果第 1 步显示 `no files match the configured criteria`，或者第 3 步没有列出你的容器的任何文件，说明它们没有使用 `k8s-file`。请切换它们（参见 高级 中的 **收集所有容器的日志（k8s-file 日志驱动）**），然后逐个重新创建：容器会保留创建时的日志驱动：",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "主机页面显示主机名等于该主机标识符的数据，代理从 `PODMAN_HOST_NAME` 获取这个标识符。如果在主机注册后更改 `PODMAN_HOST_NAME`，OneUptime 会以新名称注册第二台主机——日志就在那台主机上。检查代理上报的名称：",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "主机的名称来自 `PODMAN_HOST_NAME`。未设置它就启动的代理会上报 `podman-host`，因此这样设置的所有主机看起来都是同一台主机。请在每台主机上为 `PODMAN_HOST_NAME` 设置一个独有的名称，并重新创建代理：`podman rm -f oneuptime-podman-agent`，然后用新名称运行第 2 步中的命令。",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "这会为 **`web-1`** 安装代理——请保持 `PODMAN_HOST_NAME` 原样不变，否则数据会注册为一台新主机。",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "适用于 `podman compose` 的 Compose 提供程序：`podman-compose` 或 Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "第二个服务是 OneUptime AI 代理，使用相同的 URL、密钥和主机名。**AI 调查默认开启**：OneUptime AI 调查此主机上的事件或警报时，会通过 AI 代理对 Podman 的 Docker 兼容套接字运行只读的 `docker` 命令，除非你允许修复，否则不会做任何更改——参见 高级 中的 **OneUptime AI 智能体**。删除 `oneuptime-podman-ai-agent` 服务即可在没有 AI 调查的情况下运行收集器。",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "在代理的 `environment:` 列表中设置每个变量，然后运行 `podman compose up -d`，用新值重新创建它。",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent` 是 docker-compose.yml 中的第二个服务，在 OneUptime AI 调查此主机上的事件或警报时，通过 Podman 的 Docker 兼容套接字运行它所请求的 `docker` 命令。**AI 调查默认开启**：它一连接，OneUptime AI 就会用它进行调查，主机的 **人工智能 → AI 代理** 页面和 **概览** 会显示它的状态。要关闭调查，请使用该页面上的 **AI 可以执行的操作**；要在没有 AI 代理的情况下运行收集器，请删除它的服务并运行 `podman compose up -d --remove-orphans`。",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **修复需要主动开启。** 在它的 `environment:` 列表中加上 `- ONEUPTIME_AI_ALLOW_WRITES=true`，即可允许它重启、启动、停止、暂停、终止指定名称的容器或更改其限制。旁边的 `ONEUPTIME_AI_FIXES` 决定每项修复是否需要审批（`ask-for-approval`、`automatic` 或 `bypass-approval`），主机的 **人工智能 → AI 代理** 页面会显示这一点。`ONEUPTIME_AI_WRITE_TARGETS`（逗号分隔的通配符，例如 `web-*,api-*`）限定可操作的容器；`ONEUPTIME_AI_PROTECTED_TARGETS` 添加它绝不能更改的容器。它绝不会更改自身或收集器。",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "用其中一个替换代理 `image:` 行中的 `oneuptime/podman-agent:release`。",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**升级**：在包含 docker-compose.yml 的文件夹中，拉取最新镜像并重新创建容器：",
  "**Uninstall** — stop and remove everything the file started:":
    "**卸载**：停止并删除该文件启动的所有内容：",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    '代理必须以 root 身份运行才能读取 `/run/podman/podman.sock`。请确认 docker-compose.yml 中代理的服务设置了 `user: "0:0"`，并且套接字已开启：',
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "设有最高版本的服务器会拒绝更新的客户端，收集器因此退出，容器反复重启。只有当 `DOCKER_API_VERSION` 指定了版本时，代理才会固定 Docker API 版本，而旧的代理镜像固定了 `1.44`。请从代理的 `environment:` 列表中去掉 `DOCKER_API_VERSION`，然后运行 `podman compose pull` 和 `podman compose up -d`。之后代理会与套接字协商版本。",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "将它加到代理的 `environment:` 列表中，例如 `- DOCKER_API_VERSION=1.41`，然后运行 `podman compose up -d`。较新的服务器仍然支持旧的 API 版本，因此固定的版本在升级后仍可使用。",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. 确认 docker-compose.yml 中的 OneUptime URL 和摄取密钥正确。",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "主机的名称来自 `PODMAN_HOST_NAME`。未设置它就启动的代理会上报 `podman-host`，因此这样设置的所有主机看起来都是同一台主机。请在每台主机上为 `PODMAN_HOST_NAME` 设置一个独有的名称，并运行 `podman compose up -d`，用它重新创建代理。",
};

export default TRANSLATION;
