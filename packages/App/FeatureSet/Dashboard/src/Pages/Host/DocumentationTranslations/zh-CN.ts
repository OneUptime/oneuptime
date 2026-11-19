import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in Simplified Chinese (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * Simplified Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Simplified Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "在要监控的主机上安装好 Docker",
  "Network access from the host to your OneUptime instance":
    "主机能通过网络访问你的 OneUptime 实例",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "将其保存为 `config.yaml`，放在你将要运行 `docker run` 的目录中——第 3 步会把它挂载到容器里。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中选择一个摄取密钥，以填入 `<YOUR_API_KEY>`。",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "`--network host`、`--pid host` 和 `/hostfs` 绑定挂载让 `hostmetrics` 和 `process` 采集器从主机内核而不是容器中读取 CPU、内存、磁盘以及每个进程的信息。没有这些，你只能看到收集器容器本身的指标。",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "在 OneUptime 中打开 **主机** 列表——第一批指标到达后（通常在 30 秒内），你的主机就会自动出现。没有看到？检查收集器：",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI 调查默认对每台主机开启**：主机 AI 代理在主机上运行后，OneUptime AI 就会用 `systemctl status`、`df -h`、`free -m` 和 `ps aux` 等只读命令调查那里的事件和警报，除非你允许修复，否则不会更改任何内容。它是一个带有自己安装程序的 Linux 容器，所以只在 Linux 主机上添加；它需要带 Compose 插件的 Docker（系统引擎，而不是 rootless Docker）：",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "第一行把脚本下载为 `install.sh`，这样你可以在运行前先阅读它。它会询问你的 OneUptime URL、摄取密钥和主机名——名称留空即使用主机名，也就是此收集器上报的名称。连接后，它会在主机的 **人工智能 → AI 代理** 页面和其 **概览** 底部显示为已连接。它可以运行什么以及修复如何进行：[基础设施 AI 代理](/docs/ai/infrastructure-ai-agents#hosts)。",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "该配置已经把机器的 IP 地址、MAC 地址、架构、机器 ID、操作系统描述和操作系统版本填入它在 **资产清单** 中的条目，CMDB 导出读取的正是这个条目。序列号、制造商、型号和固件（BIOS / UEFI）版本则不同：**任何资源检测器都无法得到它们**。它们通过 DMI 来自机器的固件。请在置备时读取一次，并把它们写到资源上——把这个处理器添加到你挂载到容器中的 `config.yaml`中，并在指标管道中引用它。把它合并到你的配置已有的各部分中——不要再添加第二个 `processors:` 或 `service:` 键。",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "然后重新创建容器，让它读取编辑后的文件——删除容器，再运行一次第 3 步中的 `docker run` 命令：",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "这些值是机器本身的，因此由置备它的程序写入一次。在 Linux 上，以 root 身份读取（`bios_version` 任何人都可以读取）：",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "几分钟内，这些值就会出现在机器在 **资产清单** 中的条目的 **详情** 下。它们是写入的，而不是检测到的，因此在更换主板或更新固件后要再运行一次。",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`、`host.model.name`、`host.firmware.version` 和 `host.bios.version` 也被接受为替代写法，并存储在上面的 `device.*` 键下（`device.serial_number` 存储在 `host.serial_number` 下），因此无论配置采用哪种写法，结果都在同一个位置。",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **不要在同一份配置中同时给移动应用的资源和主机的资源设置 `device.manufacturer`。** 在不带 `host.name` 或 `host.id` 的资源上，`device.manufacturer` 仍会把该批次标记为移动端真实用户监控（Real User Monitoring）。",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "任何以 `oneuptime.label.` 为前缀的资源属性都会提升为项目标签，并附加到主机（以及此收集器发出的遥测服务）上。格式：`oneuptime.label.<dimension>=<value>` 会变成名为 `<dimension>:<value>` 的标签。",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "在你挂载到容器中的 `config.yaml`中添加一个 `resource` 处理器，并在指标管道中引用它。把它合并到你的配置已有的各部分中——不要再添加第二个 `processors:` 或 `service:` 键。",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "该主机会带着 `team:payments`、`env:production` 和 `region:us-east-1` 标签显示。标签匹配不区分大小写，因此已有的、手动创建的 `Production` 标签会被复用，而不会重复创建。在 OneUptime 界面中手动添加的标签永远不会被收集器删除。",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "主机通过 OTel 资源属性 `host.name` 自动发现，该属性由 `resourcedetection` 处理器设置。一旦某个带有 `host.name` 的批次还带有以下任一项，OneUptime 就会注册该主机：",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- `hostmetrics` 接收器的指标（CPU、内存、磁盘、文件系统、网络、负载、进程），或",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- `process` 采集器的指标（每个进程的 CPU/内存/线程），或",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- 指标、日志或追踪上的 `os.type` 或 `container.runtime` 资源属性",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "……并开始填充概览、指标、进程和日志选项卡。仅有 `host.id` 或 `host.arch` 不会注册主机，而带有 Kubernetes 身份（`k8s.cluster.name`、`k8s.node.name`、`k8s.pod.name`、…）的遥测会改为归入其 Kubernetes 集群。",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**运行在 OpenStack 上？** 使用 `detectors: [nova, system, env]`，这样 `host.id` 就是实例的 UUID，OneUptime 会把此主机关联到它的实例；并在 `nova: resource_attributes:` 下把 `host.name` 设为 `enabled: false`，让它的名称保持为 `system` 上报的名称。",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "同样的资源属性构成机器在 **资产清单** 中的条目，CMDB 导出读取的正是这个条目。`host.ip`、`host.mac`、`host.arch`、`host.id`、`os.type`、`os.description` 和 `os.version` 都来自 `resourcedetection` 处理器；序列号、制造商、型号和固件版本没有检测器，需要另行写入（参见 **记录序列号、制造商、型号和固件版本**）。",
  "Once the host is reporting:": "主机开始上报后：",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- **指标** 选项卡显示 `system.*` 时间序列。",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- 启用 `process` 采集器后，**进程** 选项卡按 CPU 排序列出进程。",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- **日志** 选项卡实时显示资源属性中包含 `host.name` 的所有日志。",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "该配置会把它所针对的收集器版本（`oneuptime.agent.version`）上报为主机的 **代理版本**。当此 OneUptime 固定了更新的版本时，旁边的警告标志会打开这些步骤。",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. 用同一个摄取密钥再次保存第 2 步的配置：它会上报新版本。把你对自己配置做过的任何更改都移过去。",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. 在存放它的文件夹中安装新版本，并重启收集器：",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. 查看收集器日志中的导出错误：`docker logs -f otel-collector`。HTTP `401` 表示密钥缺失、错误或已过期；`422` 表示它已被禁用（或者是浏览器密钥，无法发送主机遥测）。请在第 1 步选择一个可用的密钥，并更新你挂载到容器中的 `config.yaml`中的 `x-oneuptime-token`。",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. 检查主机能否访问 OneUptime：在同一台机器上运行 `curl -v <YOUR_ONEUPTIME_URL>/otlp`。",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. 在指标管道中保留 `resourcedetection`——它设置 `host.name`，OneUptime 正是据此识别主机的。",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "收集器读取的是它自己容器的内核视图。请完全按第 3 步所示，用 `--network host`、`--pid host`、`/:/hostfs` 绑定挂载和 `HOST_*` 变量运行它——没有这些，`hostmetrics` 和 `process` 采集器只能看到收集器容器本身。",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "一台带 `sudo` 的 Debian 或 Ubuntu 主机（amd64 或 arm64）",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "将其保存为当前目录中的 `config.yaml`——第 3 步会安装它。",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **原生安装说明：** 与 Docker 不同，软件包安装直接读取 `/proc` 和 `/sys`——不需要 `HOST_PROC` 环境变量，也不需要 `/hostfs` 挂载。软件包附带的 systemd 单元以无特权用户 `otelcol-contrib` 运行；如果你希望 `process` 采集器看到其他用户的进程，请授予它 `CAP_SYS_PTRACE` 或以 root 身份运行它。",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`otelcol-contrib` 从 **v0.142.0** 起就内置了 `systemd` 接收器；请运行 **v0.143.0 或更高版本**，从这个版本起，它的 CPU 指标改用了现在的名称，也不再查询非服务单元。把它添加到 `/etc/otelcol-contrib/config.yaml` 和指标管道中即可启用。把它合并到你的配置已有的各部分中——不要再添加第二个 `processors:` 或 `service:` 键。",
  "Then restart the service:": "然后重启服务：",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "该接收器 **仅限 Linux**，且处于 **alpha** 阶段。它通过系统 D-Bus 读取单元状态，使用的只读调用与 `systemctl list-units` 相同，而 systemd 允许无特权地进行这些调用，因此以 `otelcol-contrib` 用户运行的软件包服务不需要额外权限。容器化的收集器无法访问主机的总线，因此请使用原生安装。指标到达后，主机的 **Systemd 单元** 选项卡会列出每个采集到的单元及其当前状态（`active`、`failed`、`inactive`、...）。",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "每个单元每次采集要为状态集花费八个数据点，如果保留 CPU 指标开启还要再多两个，因此在有数百个单元的主机上，请缩小 `units:` 的范围或调大 `collection_interval`，而不要全部采集。",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI 调查默认对每台主机开启**：主机 AI 代理在主机上运行后，OneUptime AI 就会用 `systemctl status`、`df -h`、`free -m` 和 `ps aux` 等只读命令调查那里的事件和警报，除非你允许修复，否则不会更改任何内容。它是一个带有自己安装程序的 Linux 容器；它需要带 Compose 插件的 Docker（系统引擎，而不是 rootless Docker）：",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "该配置已经把机器的 IP 地址、MAC 地址、架构、机器 ID、操作系统描述和操作系统版本填入它在 **资产清单** 中的条目，CMDB 导出读取的正是这个条目。序列号、制造商、型号和固件（BIOS / UEFI）版本则不同：**任何资源检测器都无法得到它们**。它们通过 DMI 来自机器的固件，而软件包中的收集器以无特权方式运行，无法自行读取它们。请在置备时读取一次，并把它们写到资源上——把这个处理器添加到 `/etc/otelcol-contrib/config.yaml` 中，并在指标管道中引用它。把它合并到你的配置已有的各部分中——不要再添加第二个 `processors:` 或 `service:` 键。",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "在 `/etc/otelcol-contrib/config.yaml` 中添加一个 `resource` 处理器，并在指标管道中引用它。把它合并到你的配置已有的各部分中——不要再添加第二个 `processors:` 或 `service:` 键。",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- 启用 `systemd` 接收器后，**Systemd 单元** 选项卡会列出单元状态（参见 **启用“Systemd 单元”选项卡**）。",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. 查看收集器日志中的导出错误：`sudo journalctl -u otelcol-contrib -f`。HTTP `401` 表示密钥缺失、错误或已过期；`422` 表示它已被禁用（或者是浏览器密钥，无法发送主机遥测）。请在第 1 步选择一个可用的密钥，并更新 `/etc/otelcol-contrib/config.yaml` 中的 `x-oneuptime-token`。",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. 把 `resourcedetection` 保留在与 `systemd` 接收器相同的指标管道中——接收器只给每个单元附加 `systemd.unit.name`，因此没有 `host.name`，这些样本永远不会关联到主机。",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. 运行 `otelcol-contrib` v0.143.0 或更高版本：较旧的构建在启动时会因 `'receivers' unknown type: \"systemd\"` 而停止，或者给 CPU 指标起了别的名称（参见 **启用“Systemd 单元”选项卡**）。",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. 检查收集器能否访问系统 D-Bus：`/run/dbus/system_bus_socket` 必须存在，以收集器的用户身份运行 `systemctl list-units` 是最快的测试。不需要 root。",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "一台带 `sudo` 的 RHEL、CentOS、Fedora 或 Amazon Linux 主机（x86_64 或 aarch64）",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "一台运行 systemd 并带 `sudo` 的 Linux 主机（x86_64 或 aarch64）",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "在 `/etc/systemd/system/otelcol-contrib.service` 放置一个 systemd 单元：",
  "Then enable and start it:": "然后启用并启动它：",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "在没有软件包可用时使用此方式——例如受限的服务器，或你想从外部插桩的容器基础镜像。不需要 `HOST_PROC` 环境变量或 `/hostfs` 挂载：收集器直接读取内核状态，`User=root` 让 `process` 采集器能看到其他用户的进程（改为授予 `CAP_SYS_PTRACE` 也可以）。",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "该接收器 **仅限 Linux**，且处于 **alpha** 阶段。它通过系统 D-Bus 读取单元状态，使用的只读调用与 `systemctl list-units` 相同，而 systemd 允许无特权地进行这些调用，因此它不需要额外权限。容器化的收集器无法访问主机的总线，因此请使用原生安装。指标到达后，主机的 **Systemd 单元** 选项卡会列出每个采集到的单元及其当前状态（`active`、`failed`、`inactive`、...）。",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "该配置已经把机器的 IP 地址、MAC 地址、架构、机器 ID、操作系统描述和操作系统版本填入它在 **资产清单** 中的条目，CMDB 导出读取的正是这个条目。序列号、制造商、型号和固件（BIOS / UEFI）版本则不同：**任何资源检测器都无法得到它们**。它们通过 DMI 来自机器的固件。请在置备时读取一次，并把它们写到资源上——把这个处理器添加到 `/opt/otelcol-contrib/config.yaml` 中，并在指标管道中引用它。把它合并到你的配置已有的各部分中——不要再添加第二个 `processors:` 或 `service:` 键。",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "一台 Mac（Apple 芯片或 Intel）以及一个可用于 `sudo` 的管理员账户",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "创建 `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`：",
  "Load it:": "加载它：",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **请如上所示安装 contrib 构建。** core 构建 `otelcol` 没有 `resourcedetection` 处理器，因此用这份配置会拒绝启动。",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "该配置已经把机器的 IP 地址、MAC 地址、架构、机器 ID、操作系统描述和操作系统版本填入它在 **资产清单** 中的条目，CMDB 导出读取的正是这个条目。序列号、制造商、型号和固件（BIOS / UEFI）版本则不同：**任何资源检测器都无法得到它们**。它们来自机器的固件。请在置备时读取一次，并把它们写到资源上——把这个处理器添加到 `/etc/otelcol-contrib/config.yaml` 中，并在指标管道中引用它。把它合并到你的配置已有的各部分中——不要再添加第二个 `processors:` 或 `service:` 键。",
  "Then restart the collector:": "然后重启收集器：",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "这些值是机器本身的，因此由置备它的程序写入一次。在 Mac 上这样读取（制造商是 `Apple Inc.`）：",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` 是型号*标识符*（`MacBookPro18,3`），不是市场名称。仍然把它放进 `device.model.name`——`device.model.identifier` 会把批次标记为移动应用。",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803+ 或 Windows Server 2019+（为了内置的 `tar.exe`）",
  "An elevated PowerShell prompt (Run as administrator)":
    "以管理员身份运行的 PowerShell 提示符",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "将其保存为 `config.yaml`，放在你将要运行 PowerShell 命令的文件夹中——第 3 步会把它复制到位。",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "在 Windows 上，安装上游的 **`otelcol-contrib`** 收集器——从 **v0.155.0** 起，它内置了为主机 **服务** 选项卡提供数据的 `windows_service` 接收器。在以管理员身份运行的 PowerShell 提示符中执行：",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **注意：** 该服务以 `LocalSystem` 运行，以便读取每个 Windows 服务。在 Windows 上，`load` 采集器只是根据 *Processor Queue Length* 计数器模拟负载平均值（从 0 开始）；如果读不到该计数器，会记录日志并跳过，其余的 `hostmetrics` 配置照常运行。[主机 OpenTelemetry Collector 文档](/docs/telemetry/host-otel-collector) 也介绍了已签名的 `.msi` 安装程序。",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "日志写入 Windows 的应用程序事件日志；在 **Event Viewer → Windows Logs → Application**（来源 `otelcol-contrib`）中查看。",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "从 **v0.155.0** 起，`otelcol-contrib` 内置了 `windows_service` 接收器——把它添加到 `C:\\Program Files\\otelcol-contrib\\config.yaml` 和指标管道中即可启用。把它合并到你的配置已有的各部分中——不要再添加第二个 `processors:` 或 `service:` 键。",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "该接收器 **仅限 Windows**，且处于 **alpha** 阶段。指标到达后，主机的 **服务** 选项卡会自动显示每个服务的运行状态和启动类型。",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "该配置已经把机器的 IP 地址、MAC 地址、架构、机器 ID、操作系统描述和操作系统版本填入它在 **资产清单** 中的条目，CMDB 导出读取的正是这个条目。序列号、制造商、型号和固件（BIOS / UEFI）版本则不同：**任何资源检测器都无法得到它们**。它们通过 WMI 来自机器的固件。",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "在这台机器上以管理员身份运行的 PowerShell 提示符中执行以下命令——它会查询 WMI，并打印出*这台*机器的确切 YAML：",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "它会打印一个已缩进好的处理器条目。把它添加到你的 `config.yaml` 已有的 `processors:` 块中——与 `resourcedetection:`、`resource:` 和 `batch:` 并列，而不是作为第二个 `processors:` 键——然后在指标管道中引用它：",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "请使用 `Get-CimInstance`，不要使用已弃用的 `Get-WmiObject`——后者在 PowerShell 7 及更高版本中已不存在。值会用单引号括起来输出，内部的引号会加倍，因此含标点的序列号或型号仍是有效的 YAML。固件留空的字段会输出为 `''`；请删除该属性，不要发送空值。",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "几分钟内，机器在 **资产清单** 中的条目会在 **详情** 下显示 `host.serial_number`、`device.manufacturer`、`device.model.name` 和 `device.firmware.version`，与检测器已提供的 IP 地址、MAC 地址和机器 ID 并列。更换主板或更新 BIOS 后请再运行一次——这些值是写入的，不是检测到的，因此不会自行更新。",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- 启用 `windows_service` 接收器后，**服务** 选项卡会列出每个服务的状态（参见 **启用“Windows 服务”选项卡**）。",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. 查看收集器日志中的导出错误：**Event Viewer → Windows Logs → Application**（来源 `otelcol-contrib`）。HTTP `401` 表示密钥缺失、错误或已过期；`422` 表示它已被禁用（或者是浏览器密钥，无法发送主机遥测）。请在第 1 步选择一个可用的密钥，并更新 `C:\\Program Files\\otelcol-contrib\\config.yaml` 中的 `x-oneuptime-token`。",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. 在前台运行收集器，以看到真正的错误，而不是笼统的 `Error 1064`：",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. `Error 2: The system cannot find the file specified` 表示服务指向了一个不存在的文件——把 `sc.exe qc "otelcol-contrib"` 中的 `BINARY_PATH_NAME` 与 `C:\\Program Files\\otelcol-contrib` 的内容进行比较。压缩包必须是会解压出 `otelcol-contrib.exe` 的 `otelcol-contrib_` 压缩包。',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application**（来源 `otelcol-contrib`）记录了被服务管理器吞掉的启动错误。",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "如果你设置了 `include_services` 却仍然看到所有服务，说明收集器没有读取到这次修改——请重启服务（`Restart-Service otelcol-contrib`），并给“服务”选项卡几分钟时间刷新其滚动窗口。",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "Kubernetes 节点由 **OneUptime Kubernetes 代理** 而不是主机收集器监控：每个节点都出现在 **Kubernetes** → 你的集群 → **节点** 下，与它的 Pod 和工作负载并列，而不在 **主机** 列表中。下面的步骤在标准集群上安装代理；**Kubernetes** 部分的安装指南提供了 Amazon EKS、Google GKE、Azure AKS、GKE Autopilot 和 EKS Fargate 的步骤。",
  "A Kubernetes cluster running v1.23 or later":
    "运行 v1.23 或更高版本的 Kubernetes 集群",
  "`kubectl` and `helm` (v3) installed on your machine":
    "你的机器上已安装 `kubectl` 和 `helm`（v3）",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "集群不对？用 `kubectl config use-context <context-name>` 切换。",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "将 `my-cluster` 替换为此集群的名称，例如 `prod-us-east-1`。集群在 OneUptime 中就以此名称显示，所以请保持不变：新名称会注册一个新集群。",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` 会开启 **AI 调查**，与 chart 的默认设置一致：OneUptime AI 通过 Kubernetes AI 代理，使用只读 kubectl 调查此集群上的事件和警报。",
  "You should see:": "你应该会看到：",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "收集器和 Kubernetes AI 代理，外加每个节点上各一个 `-logs` 和 `-ebpf` Pod。它们变为 `Running` 后，集群会自动出现在 **Kubernetes** 部分，通常在一两分钟内。",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes AI 代理（默认开启，只读）。** `kubernetes-agent-ai-agent` Pod 让 OneUptime AI 使用相同的 API 密钥，以只读 kubectl（`get`、`describe`、`logs`、`events`、`top`）调查此集群上的事件和警报；除非你之后授予它写入权限，否则它无法更改任何内容。打开集群并前往 **人工智能 → 智能体** 即可看到它。不需要它？安装时用 `--set aiAgent.enabled=false` 代替 `--set aiAgent.enabled=true`。",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "命名空间规则决定代理从每个命名空间收集什么。若只从 `default`、`production` 和 `staging` 收集 Pod 日志和 eBPF 数据：",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "若要保留全部内容，只停止嘈杂命名空间的日志，请仅将它们从 `podLogs` 中排除：",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **范围：** `podLogs`（容器的 stdout/stderr）、`ebpfDiscovery`（eBPF 追踪和指标）、`metrics`（带命名空间的指标）和 `traces`（所有 span）。",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **模式** 匹配完整的命名空间名称，并支持 `*`，如 `team-*`。`exclude` 规则总是优先于 `include` 规则。",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **设置规则会替换默认规则**，默认规则会将 `kube-system` 排除在 `podLogs` 和 `ebpfDiscovery` 之外。如果仍需要它，请像第二个示例那样把它保留在列表中。",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- 节点和集群指标没有命名空间，因此始终保留。",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` 需要 Helm 3.10 或更高版本。",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**只发送重要的日志行。** 在 Pod 日志行离开集群之前，丢弃低于某个严重级别的行：",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    '接受 `TRACE`、`DEBUG`、`INFO`、`WARN`、`ERROR` 和 `FATAL`：`WARN` 保留警告、错误和致命行。严重级别从日志行本身读取（`[ERROR]`、`level=warn`、`"level":"info"`）。Kubernetes 事件永远不会因此被丢弃。',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**关闭 Pod 日志。** 指标不受影响：节点收集器会继续运行以采集 kubelet 和 cAdvisor 指标，只是不再读取 Pod 日志：",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**更改日志的读取方式。** 预设会为你选择；显式设置的 `logs.mode` 总是优先：",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`：通过 hostPath 读取每个节点上的 `/var/log/pods`（开销最低；需要 hostPath）。",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`：由一个 Deployment 通过 Kubernetes API 跟踪 Pod 日志（适用于任何集群）。",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`：不收集 Pod 日志。",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "这会读取 API 服务器，即它在集群内应答的地方。etcd、调度器和控制器管理器在控制平面节点上应答，代理的 Pod 无法猜出这些节点，所以只要你列出每个节点的地址，它就会读取它们：",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **调度器和控制器管理器** 提供 HTTPS 并接受代理的令牌，但 kubeadm 会把它们绑定到 `127.0.0.1`：请给它们一个代理的 Pod 能够访问的 `--bind-address`。",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** 如上所述，在 kubeadm 的 `--listen-metrics-urls`（端口 2381，在你添加节点地址之前绑定到 `127.0.0.1`）上以明文 HTTP 提供指标。也可以用它要求的客户端证书抓取它的 HTTPS 客户端端口 2379：把 `ca.crt`、`tls.crt` 和 `tls.key` 放进 `oneuptime-agent` 中的一个 Secret，并在 `controlPlane.etcd.clientCertSecret` 中指定它。",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "仅适用于自管理集群：托管服务（EKS、GKE、AKS）不会公开其控制平面指标。",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "成本监控默认开启：代理内置开源的 OpenCost 引擎（以及它所需的小型 Prometheus），按云服务商公开的目录价格为你的节点和卷定价，无需凭据，并发送每个命名空间和工作负载的成本。第一个完整小时之后，集群的概览和“成本”页面上会出现首批数据。",
  "On an agent installed before it was on by default, upgrade it:":
    "对于在默认开启之前安装的代理，请升级它：",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **关闭它：** 在同一次升级中添加 `--set cost.enabled=false`。",
  "- **Already running Kubecost or OpenCost?** Point the agent at it instead, and nothing is bundled: add `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (or your Kubecost service).":
    "- **已经在运行 Kubecost 或 OpenCost？** 改为让代理指向它，这样就不会内置任何组件：添加 `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003`（或你的 Kubecost 服务）。",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **本地部署或裸机？** 用 `--set cost.opencost.customPricing.enabled=true` 设置价目表（每资源小时的美元价格；参见 chart 的 `values.yaml`）。",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "完整指南：[Kubernetes 成本可观测性](/docs/telemetry/kubernetes-cost)。",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "代理在每个节点上运行 [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/)。它无需 SDK 和 sidecar，即可捕获 Go、.NET、Java、Node.js、Python、Ruby 和 Rust 服务的 HTTP/HTTPS、gRPC 和 SQL/Redis 流量，并通过收集器发送追踪、请求（RED）指标和服务图数据。",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**要求：** 带 BTF 的 Linux 内核 **5.8+**（Debian 11+、Ubuntu 20.10+、Fedora 34+、RHEL 9+ 上的默认配置）。eBPF Pod 以 **特权** 方式运行，这是加载 eBPF 程序所必需的。",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "如果你的节点运行较旧的内核、不允许特权 Pod，或者你的服务已经用 OpenTelemetry SDK 发送追踪而你不想要重复数据，请 **关闭它**：",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**选择信号。** 每个系列都用 `--set ebpf.features.<name>=false`（或 `=true`）开关：",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | 默认 | 增加的内容 |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | 开 | 每个服务的 HTTP/gRPC 请求速率、错误和延迟 |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | 开 | span 的调用次数和时长（`traces.span.metrics.*`） |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | 开 | 调用方 → 被调用方的边；驱动服务地图 |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | 开 | Pod 之间的 TCP/UDP 流计数器 |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | 关 | 跨可用区的网络指标（会使其基数翻倍） |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | 开 | 节点级 TCP RTT、连接失败和重传计数器 |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**跨服务追踪传播**（把从 Pod A → Pod B 的请求连接成一条追踪，即使在另一个节点上也是如此）**默认开启**。它通过改写正在传输的流量来工作（在内核中扩展明文 HTTP 请求，并给 TLS 和原始 TCP 附加一个 TCP 选项），而这种字节计算一旦出错就会使数据流失去同步：已报告的症状是经过 nginx 等 L7 代理的传输在响应超过 ~64KB 时卡住。如果你遇到这种情况，或者服务网格开始让 Pod 失败，请用 `--set ebpf.contextPropagation=false` 关闭它；OpenTelemetry SDK 会在用户空间传播 `traceparent`，而无需这些操作。",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "每个 `oneuptime.labels.<key>=<value>` 都会成为集群及其上报的服务和主机上的标签 `<key>:<value>`。标签匹配不区分大小写，因此会复用现有的 `Production` 标签；在 OneUptime 界面中添加的标签永远不会被代理删除。",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**升级** 到最新的 chart。`--reset-then-reuse-values`（Helm 3.14+）会保留你设置的值（预设、集群名称、筛选条件），其余全部采用新 chart 的值；在此基础上添加任何新的 `--set` 标志：",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "在 Helm 3.13 及更早版本中，请改用你设置的值进行升级：",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "不要使用 `--reuse-values`：它还会保留你升级前那个 chart 的默认值，导致较新 chart 的默认值（包括其 eBPF 镜像）永远不会生效。",
  "**Uninstall** the agent and its namespace:": "**卸载** 代理及其命名空间：",
  "| Category | Data |": "| 类别 | 数据 |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **节点指标** | CPU、内存、文件系统和网络使用情况 |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod 和容器指标** | CPU、内存、网络 I/O 和重启次数 |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **集群指标** | 节点状况、可分配资源、Pod 和工作负载数量 |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes 事件** | 警告、错误和调度事件 |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Pod 日志** | 每个容器的 stdout/stderr，在各个节点上读取 |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **应用追踪** *(eBPF)* | 来自每个 Pod 的 HTTP、gRPC 和 SQL/Redis span，无需 SDK 或代码更改 |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **请求指标和服务图** *(eBPF)* | 每个服务的请求速率、错误和延迟，以及服务地图所用的调用方 → 被调用方的边 |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **网络流** *(eBPF)* | Pod 之间的 TCP/UDP 字节和数据包计数器 |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **工作负载成本** *(默认开启)* | 每个命名空间、工作负载和 Pod 的支出，以及闲置容量和效率，也以可设置警报的指标形式提供 |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "你的集群阻止了 `hostPath` 卷或特权 Pod。这在 **GKE Autopilot** 和 **EKS Fargate** 上很正常：请在本指南顶部选择该平台并按其步骤操作。而在 **OpenShift** 上，安装会成功，但代理的节点 Pod 永远不会启动：请选择 **Red Hat OpenShift**。",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "在任何其他具有严格 Pod Security 策略的集群上，请删除失败的 release：",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "然后添加 `--set preset=gke-autopilot`，再次运行安装命令。该预设通过 Kubernetes API 而不是 hostPath 读取 Pod 日志，应用加固的安全上下文，并去掉需要特权的 eBPF 和性能分析 Pod。",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. 检查代理的 Pod 是否在运行：`kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. 检查收集器的日志：`kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. 确认安装命令中的 OneUptime URL 和摄取密钥正确。",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. 确保集群能通过网络访问你的 OneUptime 实例。",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. 检查 AI 代理的 Pod：`kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. 检查它的日志：`kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. 没有 Pod？升级 chart（参见“高级”中的 **升级或卸载代理**），并添加 `--set aiAgent.enabled=true`。",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. 检查集群名称是否一致：本指南安装的是 **`my-cluster`**。",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. 确认代理的 RBAC 权限：`kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. 在收集器的日志中查找导出错误：`kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **内核过旧或没有 BTF。** eBPF 需要带 BTF 的 Linux 5.8+；请在节点上用 `uname -r` 检查。如果无法升级，请用 `--set ebpf.enabled=false` 关闭 eBPF。",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **特权 Pod 被阻止。** 一些锁定严格的集群会拒绝它们。请关闭 eBPF。",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **主机上没有 `debugfs` / `tracefs`。** 只关闭 TCP 统计系列：`--set ebpf.features.tcpStats=false`。",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. 检查 eBPF Pod 是否健康：`kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. 打开 OBI 的调试输出，确认它能看到流量：`--set ebpf.printTraces=true --set ebpf.logLevel=debug`，然后阅读 `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`。",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. 如果 span 出现在那里，却没有出现在 OneUptime 中，请在收集器的日志中查找导出错误：`kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
