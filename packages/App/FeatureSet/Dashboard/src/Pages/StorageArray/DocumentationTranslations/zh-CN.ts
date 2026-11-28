import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in Simplified Chinese (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * Simplified Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Simplified Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 或更高版本及 Docker Compose v2 插件，所在机器能通过 HTTPS（TCP 443）访问 FlashArray 的管理地址",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "FlashArray 上的管理员账户，用于为代理创建只读用户",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "创建令牌时请选择 **永不过期**，否则代理会在令牌过期当天停止工作。",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "以管理员身份通过 SSH 登录 FlashArray。第一条命令会询问新用户的密码；第二条命令会打印该用户的 API 令牌：",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. 打开 **Settings → Users and Policies**（旧版本中为 **Settings → Access**）。",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. 在 **Users** 面板的 ⋮ 菜单中选择 **Create User…**，将其命名为 `oneuptime`，并授予 **readonly** 角色。",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. 在新用户的 ⋮ 菜单中选择 **Create API Token…**，将 **Expires In** 留空，然后复制令牌。",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "出现 `purefa_info{...} 1` 行，说明阵列原生提供指标：继续即可。出现 **404** 说明它的 Purity//FA 较旧（Pure 记载原生端点适用于 6.7.0 及更高版本；其导出器的弃用通知写的是 6.6.11 及更高版本）——请改为在本指南顶部选择 **FlashArray，旧版 Purity**。",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "第一行会把脚本下载为 `install.sh`，这样你可以在运行前先阅读它。",
  "The command carries the platform you picked above. The script asks for:":
    "该命令带有你在上方选择的平台。脚本会询问：",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- 你的 **OneUptime URL** 和 **摄取密钥**，两者都显示在第 1 步中（在那里选择一个密钥即可在此处填好）",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- **阵列名称**：阵列在 OneUptime 中显示的名称。为每个阵列取一个独立的名称并保持不变：新名称会注册一个新的存储阵列",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- FlashArray 的 **管理地址**（主机名或 IP，不带 `https://`）和只读用户的 **API 令牌**，脚本读取令牌时不会回显",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- 是否验证阵列的证书：除非阵列装有你信任的 CA 签发的证书，否则回答 **N**（阵列出厂时带有自签名证书）",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "它会安装到 `/opt/oneuptime-storage-array-agent`，写入一个只有你能读取的 `.env` 文件（其中包含 API 令牌），并用 Docker Compose 启动代理。",
  "Download the compose file and the collector configs from this OneUptime into a new folder:":
    "从此 OneUptime 下载 compose 文件和收集器配置到一个新文件夹：",
  "Create a `.env` file next to them:": "在它们旁边创建一个 `.env` 文件：",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- 将 `my-storage-array` 替换为此阵列的名称，例如 `fa-prod-01`。阵列在 OneUptime 中就以此名称显示，所以请保持不变：新名称会注册一个新的存储阵列。",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- 将 `PURE_FA_ENDPOINT` 设为 FlashArray 的管理地址（主机名或 IP，不带 `https://`），将 `PURE_FA_API_TOKEN` 设为只读用户的 API 令牌。运行 `chmod 600 .env`：该文件包含令牌。",
  "Start the agent:": "启动代理：",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中选择一个摄取密钥，以填入 `<YOUR_API_KEY>`。",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "在日志中查找 `Everything is ready. Begin running and processing data.`。首次抓取后，阵列会自动出现在 **存储阵列** 部分，通常在一两分钟内。",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "安装脚本会把这些值写入 `/opt/oneuptime-storage-array-agent/.env`；用 Docker Compose 安装时，则从 `docker-compose.yml` 旁边的 `.env` 文件读取。更改其中任何一项后，在代理的文件夹中用 `docker compose up -d` 应用它。",
  "| Variable | Required | Description |": "| 变量 | 必填 | 说明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 实例 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 是 | 遥测摄取密钥，即第 1 步中选择的那个 |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | 是 | 此阵列在 OneUptime 中注册所用的名称。作为资源属性 `storage.array.name` 标记在每个指标上。请保持不变：更改它会注册一个新的存储阵列 |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | 否 | 平台，作为资源属性 `storage.system` 标记：`purestorage.flasharray` 或 `purestorage.flashblade`（默认：`purestorage.flasharray`） |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | 否 | 运行哪份随附配置：`otel-collector-config.yaml`（FlashArray 原生端点，默认）、`otel-collector-config.flasharray-exporter.yaml`（较旧的 FlashArray）或 `otel-collector-config.flashblade.yaml`（FlashBlade） |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | 否 | 启动该配置需要的导出器：原生 FlashArray 配置留空，其他配置为 `flasharray-exporter` 或 `flashblade` |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | FlashArray 的管理地址：主机名或 IP，不带 `https://` |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | 具有 readonly 角色的 FlashArray 用户的 API 令牌 |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | FlashBlade 的管理地址：主机名或 IP，不带 `https://` |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | 具有 readonly 角色的 FlashBlade 用户的 API 令牌 |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | 否 | `true` 在原生端点上接受阵列的自签名证书；`false` 则验证它（默认：`true`）。Pure 的导出器从不验证阵列的证书，所以此项对它们不适用 |",
  "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | No | The agent's container name (default: `oneuptime-storage-array-agent`). A second array's agent on the same machine needs one of its own: the install script names a new agent after its folder unless you set it, and keeps it when you run the script again |":
    "| `STORAGE_ARRAY_AGENT_CONTAINER_NAME` | 否 | 代理的容器名称（默认：`oneuptime-storage-array-agent`）。同一台机器上第二个阵列的代理需要自己的容器名称：除非你自行设置，否则安装脚本会按新代理的文件夹为它命名，并在你再次运行脚本时保留该名称 |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- 收集器通过 HTTPS 读取 FlashArray 自身的 OpenMetrics 端点，并把令牌作为 Bearer 凭据——不运行任何导出器。",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **每个端点一个抓取作业**，各按值得的频率读取：`/metrics/array` 每 60 秒一次；`/metrics/volumes`、`/metrics/hosts` 和 `/metrics/pods` 每 2 分钟一次；`/metrics/directories` 每 30 分钟一次——目录空间对阵列来说计算代价很高。",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **每个作业都给自己的序列加上标签 `scrape_endpoint: <endpoint>`**，这样 OneUptime 就知道一个批次是哪些对象的完整列表——已删除的对象正是这样离开资产清单的。请保持标签与随附时一致。",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **按卷和按主机的延迟保留三个维度**（`usec_per_read_op`、`usec_per_write_op`、`usec_per_mirrored_write_op`）；一条 `metric_relabel_configs` 规则会丢弃 QoS、队列、SAN 和服务时间的细分，这些细分会让大型阵列的序列数成倍增加。整个阵列级别的细分会保留。",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **不设 `send_batch_max_size`。** OneUptime 根据一次完整的抓取重建资产清单，所以 `batch` 处理器从不拆分抓取。",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "这是代理运行的完整 `otel-collector-config.yaml`；`.env` 文件提供 `${env:...}` 的值：",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "在你开启 syslog 接收器之前，代理只发送指标。阵列会把警报和审计事件作为 syslog 转发；代理会在每一行上标记 `storage.array.name`，所以它们会进入此阵列的 **日志** 页面。",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. 在 `otel-collector-config.yaml` 中，取消注释 `syslog/tcp` 和 `syslog/udp` 接收器以及 `logs` 管道。传统 BSD syslog 时间戳不带时区：除非阵列的时钟运行在 UTC，否则请把 `location` 设为阵列所在的时区。",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. 在 `docker-compose.yml` 中，取消注释发布 `5514/tcp` 和 `5514/udp` 的 `ports:` 块，并在机器的防火墙上为阵列的管理网络开放该端口。",
  "3. Apply both:": "3. 应用这两项更改：",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. 在 FlashArray 上，以管理员身份打开 **Settings → System → Syslog Servers**，添加 `udp://<agent-host>:5514`（或 `tcp://<agent-host>:5514`）并发送一条测试消息。",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "任何带有 `oneuptime.label.` 前缀的资源属性都会成为阵列上的项目标签：`oneuptime.label.<dimension>=<value>` 即标签 `<dimension>:<value>`。将它们添加到你所用收集器配置的 `resource` 处理器中，放在 `storage.array.name` 旁边：",
  "Then restart the collector so it reads the new config:":
    "然后重启收集器，让它读取新配置：",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "阵列会带着 `team:storage` 和 `env:production` 标签出现。标签匹配不区分大小写，因此会复用现有的 `Production` 标签；在 OneUptime 界面中添加的标签永远不会被代理删除。",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "每个值都是 FlashArray 自己计算的仪表值——延迟以每次操作的微秒计，吞吐量以每秒计。OneUptime 的存储阵列页面、指标目录和警报模板都基于：",
  "| Endpoint | Data |": "| 端点 | 数据 |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **阵列**（`/metrics/array`） | `purefa_info`、容量与数据缩减（`purefa_array_space_*`）、性能、未解决的警报（`purefa_alerts_open`）、硬件组件、驱动器、控制器和网络接口 |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **卷**（`/metrics/volumes`） | 每个卷的延迟、IOPS、带宽、空间和数据缩减 |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **主机**（`/metrics/hosts`） | 每台主机的连接性、已连接卷、延迟、IOPS 和空间 |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **Pod**（`/metrics/pods`） | ActiveCluster 和 ActiveDR 副本链路滞后、仲裁器状态、性能和空间 |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **目录**（`/metrics/directories`） | FlashArray 文件服务中受管目录的空间和性能 |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env` and its own container name — two containers cannot share one:":
    "一个代理读取一个阵列。要从同一台机器监控多个阵列，请把每个代理安装到各自的文件夹中，使用各自的 `.env` 和各自的容器名称——两个容器不能共用一个名称：",
  "Without `STORAGE_ARRAY_AGENT_CONTAINER_NAME`, the script names the container after the folder. It keeps the name in that agent's `.env`, so running the script again to upgrade the agent keeps it, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name. With Docker Compose, set `STORAGE_ARRAY_AGENT_CONTAINER_NAME` in each agent's `.env` instead.":
    "若未设置 `STORAGE_ARRAY_AGENT_CONTAINER_NAME`，脚本会按文件夹为容器命名。它会把名称保存在该代理的 `.env` 中，所以再次运行脚本来升级代理时会保留它；而你曾在 `docker-compose.yml` 中编辑过 `container_name` 的代理，也会保留那个名称。使用 Docker Compose 时，请改为在每个代理的 `.env` 中设置 `STORAGE_ARRAY_AGENT_CONTAINER_NAME`。",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "代理附带一个 systemd 单元，它假定使用安装脚本的文件夹 `/opt/oneuptime-storage-array-agent`。安装脚本不会下载它，所以请自行获取：",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**升级**——收集器镜像固定在 `docker-compose.yml` 中，其配置是旁边的文件，所以仅拉取镜像并不会让代理更新。请再次运行安装脚本。它会沿用你现有 `.env` 中的每个值（不会再询问任何内容），下载最新的 `docker-compose.yml` 和收集器配置（你编辑过的文件会以 `<file>.bak.<timestamp>` 保留在新文件旁边），并用它们重新创建代理：",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "安装在 `/opt/oneuptime-storage-array-agent` 之外的代理（例如第二个阵列的代理）需要指定其文件夹：`INSTALL_DIR=<folder> bash install.sh`。",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "改用 Docker Compose 安装的？在代理的文件夹中重新下载 compose 文件和收集器配置；你的 `.env` 会保留，而你对其中任何文件所做的更改都需要重新做一遍：",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "然后拉取镜像并重新创建代理，让收集器读取新配置：",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "该配置会把它固定的收集器版本报告为阵列的 **代理版本**。当此 OneUptime 固定了更新的版本时，旁边的警告标志会打开这些命令。",
  "**Uninstall** the agent:": "**卸载**代理：",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "如果不再需要，再到阵列上删除只读用户及其 API 令牌。",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` 会检查整条链路（容器运行时、按收集器实际访问方式检查的阵列端点——原生端点或 Pure 的导出器、DNS、TLS、API 令牌——阵列名称标记、收集器自身指标），并直接询问 OneUptime 是否接受你的摄取密钥。最后一项检查最重要：OneUptime 的 OTLP 端点会以 `401` 或 `422` 拒绝错误的密钥，而收集器只会为每个批次记录一行很容易被忽略的 `Exporting failed`，所以脚本会向 `GET /otlp/v1/validate` 请求直接的 200/401 判定。",
  "It ends with a verdict naming the most likely cause.":
    "最后它会给出判定，指出最可能的原因。",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. 检查收集器日志：`docker logs oneuptime-storage-array-agent`。`server returned HTTP status 401` 表示阵列拒绝了 API 令牌，`404` 表示 FlashArray 没有原生端点，`x509` 表示针对阵列的自签名证书开启了 TLS 验证，`no such host` 或 `connection refused` 表示 `PURE_FA_ENDPOINT` 有误，导出时的 `401` 表示摄取密钥有误。",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. 确保已设置 `STORAGE_ARRAY_NAME`——发现依据的是资源属性 `storage.array.name`，没有它收集器会拒绝启动。",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. 确保 `STORAGE_ARRAY_COLLECTOR_CONFIG` 和 `COMPOSE_PROFILES` 指向同一个平台。",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "这台 FlashArray 的 Purity//FA 没有原生 OpenMetrics 端点。在 `.env` 中设置 `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` 和 `COMPOSE_PROFILES=flasharray-exporter`，然后运行 `docker compose up -d`——或者用较旧 Purity 的选项重新运行 `install.sh`。把阵列升级到 Purity//FA 6.7 或更高版本后，切回原生配置并去掉该 profile。",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "检查你粘贴的是令牌而不是用户的密码；该用户仍然存在并具有 readonly 角色；以及令牌没有过期。创建一个新令牌（在 FlashArray 上用 `pureadmin create --api-token oneuptime`），把它作为 `PURE_FA_API_TOKEN` 写入 `.env`，然后运行 `docker compose up -d`。",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "阵列默认提供自签名证书，任何 Docker 镜像都不信任它。请设置 `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true`（在私有管理网络上这是务实的选择），或者在阵列上安装一张由收集器镜像信任的 CA 签发的证书。",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` 或 `pure-fb-exporter` 没有运行：`COMPOSE_PROFILES` 必须与 `STORAGE_ARRAY_COLLECTOR_CONFIG` 匹配——FlashArray 导出器配置用 `flasharray-exporter`，FlashBlade 配置用 `flashblade`。修正 `.env` 并运行 `docker compose up -d`；之后 `docker compose ps` 会列出该导出器。",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. 检查代理是否在运行：`docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. 检查代理日志中的错误：`docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. 确认你的 OneUptime URL 和摄取密钥正确。",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. 确保代理所在机器能通过网络访问 OneUptime 实例。",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "阵列的标识来自 `STORAGE_ARRAY_NAME`，它作为 `storage.array.name` 标记在每个指标上。在 `.env` 中修正它，并在代理的文件夹中用 `docker compose up -d` 应用——注意，新名称会注册一个新的存储阵列。",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "它会把阵列注册为 **`array-1`**——这是此阵列在 OneUptime 中已有的名称。",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- 这会为 **`array-1`** 安装代理——请让 `STORAGE_ARRAY_NAME` 保持原样，否则数据会注册为一个新的存储阵列。",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "阵列的标识来自 `STORAGE_ARRAY_NAME`，它作为 `storage.array.name` 标记在每个指标上。此阵列是 **`array-1`**。在 `.env` 中修正它，并在代理的文件夹中用 `docker compose up -d` 应用——注意，新名称会注册一个新的存储阵列。",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "该命令已经带有你的 OneUptime URL、摄取密钥和你在上方选择的平台。脚本会询问：",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "该机器能访问 `quay.io`，Docker 从那里拉取 Pure 的导出器镜像",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter` 会在收集器旁边启动 Pure 的导出器 `pure-fa-exporter`；两者必须匹配。",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "在代理的文件夹中，`docker compose ps` 还会列出 **`pure-fa-exporter`**，即 Pure 的导出器，收集器通过它读取 FlashArray。",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- 收集器通过 Pure 的导出器 `pure-fa-exporter` 读取 FlashArray，导出器使用收集器每次抓取时发送的令牌登录 FlashArray 的 REST API。导出器的端口只在 compose 网络内。",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 或更高版本及 Docker Compose v2 插件，所在机器能通过 HTTPS（TCP 443）访问 FlashBlade 的管理地址",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "FlashBlade 上的管理员账户，用于为代理创建只读用户",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "在 FlashBlade 上，以管理员身份创建一个名为 `oneuptime`、具有 **readonly** 角色的用户（在 FlashBlade GUI 的用户设置中，或在 Purity//FB CLI 中使用 `pureadmin`），并为它创建一个 **API 令牌**。创建令牌时请选择 **永不过期**，否则代理会在令牌过期当天停止工作。",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "FlashBlade 的 API 令牌以 `T-` 开头。没有本地用户的 Purity//FB 版本改用目录服务（LDAP 或 Active Directory）账户，其所属组映射到 readonly 角色。",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- FlashBlade 的 **管理地址**（主机名或 IP，不带 `https://`）和只读用户的 **API 令牌**，脚本读取令牌时不会回显",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- 将 `PURE_FB_ENDPOINT` 设为 FlashBlade 的管理地址（主机名或 IP，不带 `https://`），将 `PURE_FB_API_TOKEN` 设为只读用户的 API 令牌。运行 `chmod 600 .env`：该文件包含令牌。",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "在代理的文件夹中，`docker compose ps` 还会列出 **`pure-fb-exporter`**，即 Pure 的导出器，收集器通过它读取 FlashBlade。",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- 收集器通过 Pure 的导出器 `pure-fb-exporter` 读取 FlashBlade，导出器使用收集器每次抓取时发送的令牌登录 FlashBlade 的 REST API。导出器的端口只在 compose 网络内。",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **每个端点一个抓取作业**，各按值得的频率读取：`/metrics/array` 每 60 秒一次；`/metrics/filesystems` 和 `/metrics/objectstore` 每 5 分钟一次——FlashBlade REST API 并非为快速报告每个文件系统和存储桶而设计。",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. 在 FlashBlade 上，以管理员身份在其 syslog 设置中添加 syslog 服务器 `udp://<agent-host>:5514`（或 `tcp://`）。",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "每个值都是 FlashBlade 自己计算的仪表值——延迟以每次操作的微秒计，吞吐量以每秒计。OneUptime 的存储阵列页面、指标目录和警报模板都基于：",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **阵列**（`/metrics/array`） | `purefb_info`、容量与数据缩减（`purefb_array_space_*`）、各协议的性能、未解决的警报（`purefb_alerts_open`）、硬件健康状况（`purefb_hardware_health`） |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **文件系统**（`/metrics/filesystems`） | 每个文件系统的空间、数据缩减和性能 |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **对象存储**（`/metrics/objectstore`） | 每个存储桶的空间、配额、对象数和性能 |",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that reaches every node of the cluster on UDP 161 (SNMP)":
    "Docker Engine 20.10 或更高版本及 Docker Compose v2 插件，所在机器能通过 UDP 161（SNMP）访问集群的每个节点",
  "An administrator account on the cluster, to turn on SNMP and set the agent's read-only community or SNMPv3 user":
    "集群上的管理员账户，用于启用 SNMP 并为代理设置只读团体名或 SNMPv3 用户",
  "SSH to any node as an administrator: OneFS applies SNMP settings to the whole cluster. If the cluster already answers SNMP for another tool, give the agent the same community or user and skip this step. Otherwise, turn on SNMP v2c with a read-only community of your own, not OneFS's default `I$ilonpublic`:":
    "以管理员身份通过 SSH 登录任意节点：OneFS 会将 SNMP 设置应用到整个集群。如果集群已经为其他工具响应 SNMP，请为代理提供相同的团体名或用户，并跳过此步骤。否则，请使用你自己的只读团体名启用 SNMP v2c，不要使用 OneFS 默认的 `I$ilonpublic`：",
  "Or turn on SNMPv3, which authenticates and encrypts every poll. OneFS has one SNMPv3 read-only user, `general` until you rename it: give it passwords of at least eight characters, without spaces:":
    "或者启用 SNMPv3，它会对每次轮询进行认证和加密。OneFS 只有一个 SNMPv3 只读用户，在你重命名之前名为 `general`：为它设置至少八个字符且不含空格的密码：",
  "`isi snmp settings view` shows the settings, with the user's authentication and privacy protocols. Allow UDP 161 from the agent's machine to every node, and list the nodes' addresses with `isi network interfaces list`.":
    "`isi snmp settings view` 会显示设置，包括该用户的认证协议和隐私协议。允许从代理所在机器到每个节点的 UDP 161，并用 `isi network interfaces list` 列出各节点的地址。",
  "- **every node's address**, separated by commas: each node's own address, never the SmartConnect zone name, since a node answers only for its own drives, sensors and ports":
    "- **每个节点的地址**，以逗号分隔：每个节点自己的地址，而不是 SmartConnect 区域名称，因为节点只会为它自己的驱动器、传感器和端口应答",
  "- the **SNMP version**, then the read-only **community**, or the SNMPv3 **user** and its two passwords, each read without echo":
    "- **SNMP 版本**，然后是只读**团体名**，或 SNMPv3 **用户**及其两个密码，脚本读取时均不会回显",
  "A user whose protocols are not SHA and AES needs `POWERSCALE_SNMP_AUTH_PROTOCOL` and `POWERSCALE_SNMP_PRIVACY_PROTOCOL` in front of `bash install.sh`, and a user without privacy `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.":
    "如果用户的协议不是 SHA 和 AES，需要在 `bash install.sh` 前加上 `POWERSCALE_SNMP_AUTH_PROTOCOL` 和 `POWERSCALE_SNMP_PRIVACY_PROTOCOL`；不使用隐私保护的用户则需要加上 `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`。",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the community or the SNMPv3 passwords), with one poll per node, and starts the agent with Docker Compose. When the cluster gains a node, add its address to `POWERSCALE_NODES` in that file and run `bash install.sh` again.":
    "它会安装到 `/opt/oneuptime-storage-array-agent`，写入一个只有你能读取的 `.env` 文件（其中包含团体名或 SNMPv3 密码），每个节点一项轮询，并用 Docker Compose 启动代理。集群新增节点时，请将其地址添加到该文件的 `POWERSCALE_NODES` 中，然后再次运行 `bash install.sh`。",
  "- Replace `my-storage-array` with a name for this cluster, such as `ps-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- 将 `my-storage-array` 替换为此集群的名称，例如 `ps-prod`。集群在 OneUptime 中就以此名称显示，所以请保持不变：新名称会注册一个新的存储阵列。",
  "- List every node in `POWERSCALE_NODES` and give each its own `POWERSCALE_NODE_<n>` and `snmp/node-<n>` in `POWERSCALE_SNMP_RECEIVERS`, up to 252, after `snmp/cluster` and `snmp/quotas`. An IPv6 address goes in brackets, such as `[fd00::11]`.":
    "- 在 `POWERSCALE_NODES` 中列出每个节点，并为每个节点分配各自的 `POWERSCALE_NODE_<n>`，以及在 `POWERSCALE_SNMP_RECEIVERS` 中 `snmp/cluster` 和 `snmp/quotas` 之后的各自的 `snmp/node-<n>`，最多 252 个。IPv6 地址要放在方括号中，例如 `[fd00::11]`。",
  "- For SNMPv3, set `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` and `POWERSCALE_SNMP_PRIVACY_PASSWORD` instead of the community. Run `chmod 600 .env`: it holds the community or the passwords.":
    "- 对于 SNMPv3，请设置 `POWERSCALE_SNMP_VERSION=v3`、`POWERSCALE_SNMP_USER`、`POWERSCALE_SNMP_AUTH_PASSWORD` 和 `POWERSCALE_SNMP_PRIVACY_PASSWORD`，而不是团体名。运行 `chmod 600 .env`：该文件包含团体名或密码。",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this cluster registers under in OneUptime, stamped on every metric as `storage.array.name`. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | 是 | 此集群在 OneUptime 中注册所用的名称，作为 `storage.array.name` 标记在每个指标上。请保持不变：更改它会注册一个新的存储阵列 |",
  "| `STORAGE_SYSTEM` | Yes | `dell.powerscale` |":
    "| `STORAGE_SYSTEM` | 是 | `dell.powerscale` |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Yes | `otel-collector-config.powerscale.yaml` |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | 是 | `otel-collector-config.powerscale.yaml` |",
  "| `POWERSCALE_NODES` | Yes | Every node's address, separated by commas. The install script writes the polls below from it |":
    "| `POWERSCALE_NODES` | 是 | 每个节点的地址，以逗号分隔。安装脚本据此写入下面的轮询 |",
  "| `POWERSCALE_ENDPOINT` | Yes | The node the cluster's own health, capacity and quotas are read through: the first in `POWERSCALE_NODES` |":
    "| `POWERSCALE_ENDPOINT` | 是 | 读取集群自身健康状况、容量和配额所经由的节点：`POWERSCALE_NODES` 中的第一个 |",
  "| `POWERSCALE_SNMP_RECEIVERS` | Yes | The polls the collector runs: `snmp/cluster`, `snmp/quotas`, then `snmp/node-<n>` for each node |":
    "| `POWERSCALE_SNMP_RECEIVERS` | 是 | 收集器运行的轮询：`snmp/cluster`、`snmp/quotas`，然后是每个节点的 `snmp/node-<n>` |",
  "| `POWERSCALE_NODE_<n>` | Yes | Node `<n>`'s address, from 1 to 252 |":
    "| `POWERSCALE_NODE_<n>` | 是 | 节点 `<n>` 的地址，从 1 到 252 |",
  "| `POWERSCALE_SNMP_VERSION` | No | `v2c` (default) or `v3` |":
    "| `POWERSCALE_SNMP_VERSION` | 否 | `v2c`（默认）或 `v3` |",
  "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | The cluster's read-only community |":
    "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | 集群的只读团体名 |",
  "| `POWERSCALE_SNMP_USER` | SNMPv3 | The cluster's SNMPv3 read-only user |":
    "| `POWERSCALE_SNMP_USER` | SNMPv3 | 集群的 SNMPv3 只读用户 |",
  "| `POWERSCALE_SNMP_SECURITY_LEVEL` | No | `auth_priv` (default), `auth_no_priv` or `no_auth_no_priv` |":
    "| `POWERSCALE_SNMP_SECURITY_LEVEL` | 否 | `auth_priv`（默认）、`auth_no_priv` 或 `no_auth_no_priv` |",
  "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | No | `SHA` (default), `MD5`, `SHA224`, `SHA256`, `SHA384` or `SHA512` |":
    "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | 否 | `SHA`（默认）、`MD5`、`SHA224`、`SHA256`、`SHA384` 或 `SHA512` |",
  "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | The SNMPv3 user's authentication password |":
    "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | SNMPv3 用户的认证密码 |",
  "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | No | `AES` (default), `DES`, `AES192`, `AES256`, `AES192C` or `AES256C` |":
    "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | 否 | `AES`（默认）、`DES`、`AES192`、`AES256`、`AES192C` 或 `AES256C` |",
  "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | The SNMPv3 user's privacy password |":
    "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | SNMPv3 用户的隐私密码 |",
  "- **One collector, no exporter.** The collector's own SNMP receiver reads Dell's ISILON-MIB; nothing else runs beside it.":
    "- **一个收集器，没有导出器。** 收集器自带的 SNMP 接收器读取 Dell 的 ISILON-MIB；旁边不运行任何其他组件。",
  "- **The cluster's objects once, through `POWERSCALE_ENDPOINT`:** its health, capacity, throughput and node counts every 60 seconds (`snmp/cluster`), and its SmartQuotas every 5 minutes (`snmp/quotas`).":
    "- **集群的对象通过 `POWERSCALE_ENDPOINT` 读取一次：** 每 60 秒读取其健康状况、容量、吞吐量和节点数（`snmp/cluster`），每 5 分钟读取其 SmartQuotas（`snmp/quotas`）。",
  "- **Each node's from the node:** its health, CPU, protocol performance, drives, sensors and ports every 60 seconds (`snmp/node-<n>`).":
    "- **每个节点的对象从该节点本身读取：** 每 60 秒读取其健康状况、CPU、协议性能、驱动器、传感器和端口（`snmp/node-<n>`）。",
  "- **Every poll labels its series `scrape_endpoint: <poll>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted quota leaves the inventory. Keep the labels as shipped.":
    "- **每次轮询都给自己的序列加上标签 `scrape_endpoint: <poll>`**，这样 OneUptime 就知道一个批次是哪些对象的完整列表——已删除的配额正是这样离开资产清单的。请保持标签与随附时一致。",
  "The full config, one SNMP receiver per node slot, is `otel-collector-config.powerscale.yaml` in the agent's folder:":
    "完整配置为代理文件夹中的 `otel-collector-config.powerscale.yaml`，每个节点槽位一个 SNMP 接收器：",
  "Then turn SNMP off on the cluster, or change the agent's community or SNMPv3 passwords, if nothing else polls it.":
    "如果没有其他工具轮询该集群，再在集群上关闭 SNMP，或更改代理的团体名或 SNMPv3 密码。",
  "`troubleshoot.sh` checks the whole chain — the container runtime, the node addresses and the community or SNMPv3 user in `.env`, each node with `snmpget` when the machine has it, array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key.":
    "`troubleshoot.sh` 会检查整条链路（容器运行时、`.env` 中的节点地址和团体名或 SNMPv3 用户、机器上有 `snmpget` 时用它检查每个节点、阵列名称标记、收集器自身指标），并直接询问 OneUptime 是否接受你的摄取密钥。",
  "`Error scraping metrics` with `request timeout` in `docker logs oneuptime-storage-array-agent` names a node that does not answer SNMP from this machine: SNMP is off for the version the agent uses, the community or SNMPv3 user is not the cluster's, or UDP 161 is blocked on the way. A node that answers but is missing from the cluster's nodes is not in `POWERSCALE_NODES`: add it and run `bash install.sh` again.":
    "`docker logs oneuptime-storage-array-agent` 中带有 `request timeout` 的 `Error scraping metrics` 指出了一个对来自这台机器的 SNMP 没有响应的节点：代理所用版本的 SNMP 已关闭、团体名或 SNMPv3 用户不属于该集群，或者 UDP 161 在途中被阻断。能响应却不在集群节点中的节点，就是不在 `POWERSCALE_NODES` 中：添加它，然后再次运行 `bash install.sh`。",
};

export default TRANSLATION;
