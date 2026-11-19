import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Host setup guide in Traditional Chinese (#8341): each piece of the English
 * guide's markdown (Pages/Host/Utils/DocumentationMarkdown.ts) and its
 * Traditional Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Traditional Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker installed on the host you want to monitor":
    "在要監視的主機上安裝好 Docker",
  "Network access from the host to your OneUptime instance":
    "主機能透過網路連到你的 OneUptime 執行個體",
  "Save this as `config.yaml` in the directory you will run `docker run` from — step 3 mounts it into the container.":
    "將其儲存為 `config.yaml`，放在你將要執行 `docker run` 的目錄中——第 3 步會把它掛載到容器裡。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中選擇一個擷取金鑰，以填入 `<YOUR_API_KEY>`。",
  "`--network host`, `--pid host`, and the `/hostfs` bind mount let the `hostmetrics` and `process` scrapers read CPU, memory, disk, and per-process information from the host kernel rather than the container. Without these, you'd only see metrics for the collector container itself.":
    "`--network host`、`--pid host` 與 `/hostfs` 繫結掛載讓 `hostmetrics` 與 `process` 擷取器從主機核心而不是容器讀取 CPU、記憶體、磁碟以及每個處理程序的資訊。沒有這些，你只會看到收集器容器本身的指標。",
  "Open the **Hosts** list in OneUptime — your host appears automatically once the first metric batch lands (usually within 30 seconds). Not there? Check the collector:":
    "在 OneUptime 中開啟 **主機** 清單——第一批指標送達後（通常在 30 秒內），你的主機就會自動出現。沒看到？檢查收集器：",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer, so add it on Linux hosts only; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI 調查預設對每台主機開啟**：主機 AI 代理程式在主機上執行後，OneUptime AI 就會用 `systemctl status`、`df -h`、`free -m` 與 `ps aux` 等唯讀指令調查那裡的事件與警示，除非你允許修復，否則不會變更任何內容。它是一個帶有專屬安裝程式的 Linux 容器，所以只在 Linux 主機上新增；它需要附 Compose 外掛程式的 Docker（系統引擎，而不是 rootless Docker）：",
  "The first line downloads the script as `install.sh`, so you can read it before you run it. It asks for your OneUptime URL, the ingestion key and the host's name — leave the name empty to use the hostname, which is what this collector reports. Once it connects, it shows as Connected on the host's **AI → AI agent** page and at the bottom of its **Overview**. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#hosts).":
    "第一行把指令碼下載為 `install.sh`，讓你能在執行前先閱讀。它會詢問你的 OneUptime URL、擷取金鑰與主機名稱——名稱留空即使用主機名稱，也就是此收集器回報的名稱。連線後，它會在主機的 **人工智慧 → AI 代理程式** 頁面與其 **概覽** 底部顯示為已連線。它可以執行什麼，以及修復如何運作：[基礎架構 AI 代理程式](/docs/ai/infrastructure-ai-agents#hosts)。",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to the `config.yaml` you mounted into the container and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "這份組態已經把機器的 IP 位址、MAC 位址、架構、機器 ID、作業系統描述與作業系統版本填入它在 **資產清單** 中的項目，CMDB 匯出讀取的正是這個項目。序號、製造商、型號與韌體（BIOS / UEFI）版本則不同：**任何資源偵測器都無法取得它們**。它們透過 DMI 來自機器的韌體。請在佈建時讀取一次，並把它們寫到資源上——把這個處理器加入你掛載到容器中的 `config.yaml`中，並在指標管線中引用它。把它合併到你的組態已有的各區段中——不要再新增第二個 `processors:` 或 `service:` 鍵。",
  "Then recreate the container so it reads the edited file — remove it, and run the `docker run` command from step 3 again:":
    "然後重新建立容器，讓它讀取編輯後的檔案——移除容器，再執行一次第 3 步中的 `docker run` 指令：",
  "The values are the machine's own, so they are written once by whatever provisions it. On Linux, read them as root (`bios_version` is readable by anyone):":
    "這些值屬於機器本身，因此由佈建它的程式寫入一次。在 Linux 上，以 root 身分讀取（`bios_version` 任何人都能讀取）：",
  "Within a few minutes the values show on the machine's **Inventory** item under **Details**. They are stamped, not detected, so run this again after a motherboard swap or a firmware update.":
    "幾分鐘內，這些值就會出現在機器在 **資產清單** 中的項目的 **詳細資料** 下。它們是寫入的，而不是偵測到的，因此更換主機板或更新韌體後要再執行一次。",
  "`host.manufacturer`, `host.model.name`, `host.firmware.version` and `host.bios.version` are accepted as alternative spellings and stored under the `device.*` keys above (and `device.serial_number` under `host.serial_number`), so a config written either way ends up in one place.":
    "`host.manufacturer`、`host.model.name`、`host.firmware.version` 與 `host.bios.version` 也被接受為替代寫法，並儲存在上方的 `device.*` 鍵下（`device.serial_number` 儲存在 `host.serial_number` 下），因此無論組態採用哪種寫法，結果都在同一個位置。",
  "> **Don't set `device.manufacturer` on a mobile app's resource and a host's from the same config.** On a resource that carries no `host.name` or `host.id`, `device.manufacturer` still marks the batch as mobile Real User Monitoring.":
    "> **不要在同一份組態中同時為行動應用程式的資源與主機的資源設定 `device.manufacturer`。** 在不帶 `host.name` 或 `host.id` 的資源上，`device.manufacturer` 仍會把該批次標記為行動版真實使用者監控（Real User Monitoring）。",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project Label and attached to the host (and to the telemetry service emitted from this collector). Pattern: `oneuptime.label.<dimension>=<value>` becomes a label named `<dimension>:<value>`.":
    "任何以 `oneuptime.label.` 為前置詞的資源屬性都會升級為專案標籤，並附加到主機（以及此收集器發出的遙測服務）上。格式：`oneuptime.label.<dimension>=<value>` 會變成名為 `<dimension>:<value>` 的標籤。",
  "Add a `resource` processor to the `config.yaml` you mounted into the container and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "在你掛載到容器中的 `config.yaml`中新增一個 `resource` 處理器，並在指標管線中引用它。把它合併到你的組態已有的各區段中——不要再新增第二個 `processors:` 或 `service:` 鍵。",
  "The host shows up tagged `team:payments`, `env:production`, and `region:us-east-1`. Labels are matched case-insensitively, so an existing manually-created `Production` label is reused rather than duplicated. Labels added manually in the OneUptime UI are never removed by the collector.":
    "該主機會帶著 `team:payments`、`env:production` 與 `region:us-east-1` 標籤顯示。標籤比對不區分大小寫，因此既有的、手動建立的 `Production` 標籤會被重複使用，而不會重複建立。在 OneUptime 介面中手動加入的標籤永遠不會被收集器移除。",
  "Hosts are auto-discovered from the OTel `host.name` resource attribute, which the `resourcedetection` processor sets. OneUptime registers the host once a batch that carries `host.name` also carries any of:":
    "主機透過 OTel 資源屬性 `host.name` 自動探索，該屬性由 `resourcedetection` 處理器設定。一旦某個帶有 `host.name` 的批次還帶有下列任一項，OneUptime 就會註冊該主機：",
  "- `hostmetrics` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR":
    "- `hostmetrics` 接收器的指標（CPU、記憶體、磁碟、檔案系統、網路、負載、處理程序），或",
  "- `process` scraper metrics (per-process CPU/memory/threads), OR":
    "- `process` 擷取器的指標（每個處理程序的 CPU/記憶體/執行緒），或",
  "- an `os.type` or `container.runtime` resource attribute, on metrics, logs or traces":
    "- 指標、日誌或追蹤上的 `os.type` 或 `container.runtime` 資源屬性",
  "…and starts populating the Overview, Metrics, Processes, and Logs tabs. `host.id` or `host.arch` alone do not register a host, and telemetry that carries a Kubernetes identity (`k8s.cluster.name`, `k8s.node.name`, `k8s.pod.name`, …) is filed under its Kubernetes cluster instead.":
    "……並開始填入概覽、指標、處理程序與日誌索引標籤。只有 `host.id` 或 `host.arch` 不會註冊主機，而帶有 Kubernetes 身分（`k8s.cluster.name`、`k8s.node.name`、`k8s.pod.name`、…）的遙測會改為歸入其 Kubernetes 叢集。",
  "**Running on OpenStack?** Use `detectors: [nova, system, env]`, so `host.id` is the instance's UUID and OneUptime links this host to its instance, and set `host.name` to `enabled: false` under `nova: resource_attributes:` so its name stays the one `system` reports.":
    "**在 OpenStack 上執行？** 使用 `detectors: [nova, system, env]`，這樣 `host.id` 就是執行個體的 UUID，OneUptime 會把這台主機連結到它的執行個體；並在 `nova: resource_attributes:` 下把 `host.name` 設為 `enabled: false`，讓它的名稱維持為 `system` 回報的名稱。",
  "The same resource attributes become the machine's **Inventory** item, which is what a CMDB export reads. `host.ip`, `host.mac`, `host.arch`, `host.id`, `os.type`, `os.description` and `os.version` all come from the `resourcedetection` processor; serial number, make, model and firmware version have no detector and are stamped on separately (see **Record the serial number, make, model and firmware version**).":
    "同樣的資源屬性構成機器在 **資產清單** 中的項目，CMDB 匯出讀取的正是這個項目。`host.ip`、`host.mac`、`host.arch`、`host.id`、`os.type`、`os.description` 與 `os.version` 都來自 `resourcedetection` 處理器；序號、製造商、型號與韌體版本沒有偵測器，需要另行寫入（請參見 **記錄序號、製造商、型號與韌體版本**）。",
  "Once the host is reporting:": "主機開始回報後：",
  "- The **Metrics** tab visualizes `system.*` time-series.":
    "- **指標** 索引標籤會顯示 `system.*` 時間序列。",
  "- The **Processes** tab lists processes ordered by CPU once the `process` scraper is enabled.":
    "- 啟用 `process` 擷取器後，**處理程序** 索引標籤會依 CPU 排序列出處理程序。",
  "- The **Logs** tab streams any logs whose resource attributes include `host.name`.":
    "- **日誌** 索引標籤會即時顯示資源屬性中包含 `host.name` 的所有日誌。",
  "The config reports the collector release it is for (`oneuptime.agent.version`) as the host's **Agent Version**. When this OneUptime pins a newer release, a warning sign beside it opens these steps.":
    "這份組態會把它所針對的收集器版本（`oneuptime.agent.version`）回報為主機的 **代理程式版本**。當此 OneUptime 固定了更新的版本時，旁邊的警告標誌會開啟這些步驟。",
  "1. Save the config from step 2 again, with the same ingestion key: it reports the new version. Copy across any change you made to yours.":
    "1. 用同一個擷取金鑰再次儲存第 2 步的組態：它會回報新版本。把你對自己組態做過的任何變更都搬過去。",
  "2. In the folder that holds it, install the new release and restart the collector:":
    "2. 在存放它的資料夾中安裝新版本，並重新啟動收集器：",
  "1. Read the collector's logs for export errors: `docker logs -f otel-collector`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in the `config.yaml` you mounted into the container.":
    "1. 查看收集器日誌中的匯出錯誤：`docker logs -f otel-collector`。HTTP `401` 表示金鑰缺少、錯誤或已過期；`422` 表示它已被停用（或是瀏覽器金鑰，無法傳送主機遙測）。請在第 1 步選擇一個可用的金鑰，並更新你掛載到容器中的 `config.yaml`中的 `x-oneuptime-token`。",
  "2. Check the host can reach OneUptime: `curl -v <YOUR_ONEUPTIME_URL>/otlp` from the same machine.":
    "2. 確認主機能連到 OneUptime：在同一台機器上執行 `curl -v <YOUR_ONEUPTIME_URL>/otlp`。",
  "3. Keep `resourcedetection` in the metrics pipeline — it sets `host.name`, which is how OneUptime recognises the host.":
    "3. 在指標管線中保留 `resourcedetection`——它會設定 `host.name`，OneUptime 正是據此辨識主機。",
  "The collector is reading its own container's kernel view. Run it with `--network host`, `--pid host`, the `/:/hostfs` bind mount and the `HOST_*` variables exactly as step 3 shows — without them the `hostmetrics` and `process` scrapers only see the collector container itself.":
    "收集器讀取的是它自己容器的核心檢視。請完全依第 3 步所示，以 `--network host`、`--pid host`、`/:/hostfs` 繫結掛載與 `HOST_*` 變數執行它——沒有這些，`hostmetrics` 與 `process` 擷取器只能看到收集器容器本身。",
  "A Debian or Ubuntu host (amd64 or arm64) with `sudo`":
    "一台具備 `sudo` 的 Debian 或 Ubuntu 主機（amd64 或 arm64）",
  "Save this as `config.yaml` in your current directory — step 3 installs it.":
    "將其儲存為目前目錄中的 `config.yaml`——第 3 步會安裝它。",
  "> **Note for native installs:** Unlike Docker, the package install reads `/proc` and `/sys` directly — no `HOST_PROC` env vars or `/hostfs` mount required. The systemd unit shipped with the package runs as the unprivileged `otelcol-contrib` user; if you want the `process` scraper to see processes owned by other users, grant it `CAP_SYS_PTRACE` or run it as root.":
    "> **原生安裝說明：** 與 Docker 不同，套件安裝會直接讀取 `/proc` 與 `/sys`——不需要 `HOST_PROC` 環境變數，也不需要 `/hostfs` 掛載。套件附帶的 systemd 單元以無特權使用者 `otelcol-contrib` 執行；如果你希望 `process` 擷取器看到其他使用者的處理程序，請授與它 `CAP_SYS_PTRACE` 或以 root 身分執行它。",
  "`otelcol-contrib` has bundled the `systemd` receiver since **v0.142.0**; run **v0.143.0 or newer**, which is where its CPU metric settled on its current name and stopped probing non-service units. Turn it on by adding it to `/etc/otelcol-contrib/config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "`otelcol-contrib` 從 **v0.142.0** 起就內建了 `systemd` 接收器；請執行 **v0.143.0 或更新版本**，從這個版本起，它的 CPU 指標改用了現在的名稱，也不再查詢非服務單元。把它加入 `/etc/otelcol-contrib/config.yaml` 與指標管線即可啟用。把它合併到你的組態已有的各區段中——不要再新增第二個 `processors:` 或 `service:` 鍵。",
  "Then restart the service:": "然後重新啟動服務：",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so the packaged service — which runs as the `otelcol-contrib` user — needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "此接收器 **僅限 Linux**，且處於 **alpha** 階段。它透過系統 D-Bus 讀取單元狀態，使用的唯讀呼叫與 `systemctl list-units` 相同，而 systemd 允許無特權地進行這些呼叫，因此以 `otelcol-contrib` 使用者執行的套件服務不需要額外權限。容器化的收集器無法連到主機的匯流排，因此請使用原生安裝。指標送達後，主機的 **Systemd 單元** 索引標籤會列出每個收集到的單元及其目前狀態（`active`、`failed`、`inactive`、...）。",
  "Each unit costs eight datapoints per scrape for the state set, plus two more if you leave the CPU metric on, so on a host with hundreds of units narrow `units:` or raise `collection_interval` rather than scraping everything.":
    "每個單元每次收集要為狀態集花費八個資料點，若保持 CPU 指標開啟還要再多兩個，因此在有數百個單元的主機上，請縮小 `units:` 的範圍或調大 `collection_interval`，而不要全部收集。",
  "**AI investigations are on by default** for every host: once the Host AI agent runs on it, OneUptime AI investigates incidents and alerts there with read-only commands such as `systemctl status`, `df -h`, `free -m` and `ps aux`, and changes nothing unless you allow fixes. It is a Linux container with its own installer; it needs Docker (the system engine, not rootless Docker) with the Compose plugin:":
    "**AI 調查預設對每台主機開啟**：主機 AI 代理程式在主機上執行後，OneUptime AI 就會用 `systemctl status`、`df -h`、`free -m` 與 `ps aux` 等唯讀指令調查那裡的事件與警示，除非你允許修復，否則不會變更任何內容。它是一個帶有專屬安裝程式的 Linux 容器；它需要附 Compose 外掛程式的 Docker（系統引擎，而不是 rootless Docker）：",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI, and the packaged collector runs unprivileged, so it cannot read them itself. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "這份組態已經把機器的 IP 位址、MAC 位址、架構、機器 ID、作業系統描述與作業系統版本填入它在 **資產清單** 中的項目，CMDB 匯出讀取的正是這個項目。序號、製造商、型號與韌體（BIOS / UEFI）版本則不同：**任何資源偵測器都無法取得它們**。它們透過 DMI 來自機器的韌體，而套件中的收集器以無特權方式執行，無法自行讀取它們。請在佈建時讀取一次，並把它們寫到資源上——把這個處理器加入 `/etc/otelcol-contrib/config.yaml` 中，並在指標管線中引用它。把它合併到你的組態已有的各區段中——不要再新增第二個 `processors:` 或 `service:` 鍵。",
  "Add a `resource` processor to `/etc/otelcol-contrib/config.yaml` and reference it from the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "在 `/etc/otelcol-contrib/config.yaml` 中新增一個 `resource` 處理器，並在指標管線中引用它。把它合併到你的組態已有的各區段中——不要再新增第二個 `processors:` 或 `service:` 鍵。",
  "- The **Systemd Units** tab lists unit state once the `systemd` receiver is enabled (see **Enable the Systemd Units tab**).":
    "- 啟用 `systemd` 接收器後，**Systemd 單元** 索引標籤會列出單元狀態（請參見 **啟用「Systemd 單元」索引標籤**）。",
  "1. Read the collector's logs for export errors: `sudo journalctl -u otelcol-contrib -f`. An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `/etc/otelcol-contrib/config.yaml`.":
    "1. 查看收集器日誌中的匯出錯誤：`sudo journalctl -u otelcol-contrib -f`。HTTP `401` 表示金鑰缺少、錯誤或已過期；`422` 表示它已被停用（或是瀏覽器金鑰，無法傳送主機遙測）。請在第 1 步選擇一個可用的金鑰，並更新 `/etc/otelcol-contrib/config.yaml` 中的 `x-oneuptime-token`。",
  "1. Keep `resourcedetection` in the same metrics pipeline as the `systemd` receiver — the receiver attaches only `systemd.unit.name` to each unit, so without `host.name` the samples never attach to the host.":
    "1. 把 `resourcedetection` 保留在與 `systemd` 接收器相同的指標管線中——接收器只會為每個單元附加 `systemd.unit.name`，因此沒有 `host.name`，這些樣本永遠不會連結到主機。",
  "2. Run `otelcol-contrib` v0.143.0 or newer: older builds stop at startup with `'receivers' unknown type: \"systemd\"`, or name the CPU metric differently (see **Enable the Systemd Units tab**).":
    "2. 執行 `otelcol-contrib` v0.143.0 或更新版本：較舊的組建在啟動時會因 `'receivers' unknown type: \"systemd\"` 而停止，或為 CPU 指標取了別的名稱（請參見 **啟用「Systemd 單元」索引標籤**）。",
  "3. Check the collector can reach the system D-Bus: `/run/dbus/system_bus_socket` must exist, and `systemctl list-units` run as the collector's user is the quickest test. Root is not required.":
    "3. 確認收集器能連到系統 D-Bus：`/run/dbus/system_bus_socket` 必須存在，以收集器的使用者身分執行 `systemctl list-units` 是最快的測試。不需要 root。",
  "A RHEL, CentOS, Fedora or Amazon Linux host (x86_64 or aarch64) with `sudo`":
    "一台具備 `sudo` 的 RHEL、CentOS、Fedora 或 Amazon Linux 主機（x86_64 或 aarch64）",
  "A Linux host (x86_64 or aarch64) that runs systemd, with `sudo`":
    "一台執行 systemd 並具備 `sudo` 的 Linux 主機（x86_64 或 aarch64）",
  "Drop a systemd unit at `/etc/systemd/system/otelcol-contrib.service`:":
    "在 `/etc/systemd/system/otelcol-contrib.service` 放置一個 systemd 單元：",
  "Then enable and start it:": "然後啟用並啟動它：",
  "Use this when packages aren't available — locked-down servers, or container base images you want to instrument from outside. No `HOST_PROC` env vars or `/hostfs` mount are needed: the collector reads kernel state directly, and `User=root` lets the `process` scraper see processes owned by other users (granting `CAP_SYS_PTRACE` instead works too).":
    "在沒有套件可用時使用此方式——例如受限的伺服器，或你想從外部檢測的容器基礎映像檔。不需要 `HOST_PROC` 環境變數或 `/hostfs` 掛載：收集器直接讀取核心狀態，`User=root` 讓 `process` 擷取器能看到其他使用者的處理程序（改為授與 `CAP_SYS_PTRACE` 也可以）。",
  "The receiver is **Linux-only** and **alpha**. It reads unit state over the system D-Bus using the same read-only calls as `systemctl list-units`, which systemd allows unprivileged, so it needs no extra rights. A containerised collector cannot reach the host's bus, so use a native install. Once metrics arrive, the host **Systemd Units** tab populates with every scraped unit and its current state (`active`, `failed`, `inactive`, ...).":
    "此接收器 **僅限 Linux**，且處於 **alpha** 階段。它透過系統 D-Bus 讀取單元狀態，使用的唯讀呼叫與 `systemctl list-units` 相同，而 systemd 允許無特權地進行這些呼叫，因此它不需要額外權限。容器化的收集器無法連到主機的匯流排，因此請使用原生安裝。指標送達後，主機的 **Systemd 單元** 索引標籤會列出每個收集到的單元及其目前狀態（`active`、`failed`、`inactive`、...）。",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through DMI. Read them once at provisioning time and stamp them onto the resource — add this processor to `/opt/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "這份組態已經把機器的 IP 位址、MAC 位址、架構、機器 ID、作業系統描述與作業系統版本填入它在 **資產清單** 中的項目，CMDB 匯出讀取的正是這個項目。序號、製造商、型號與韌體（BIOS / UEFI）版本則不同：**任何資源偵測器都無法取得它們**。它們透過 DMI 來自機器的韌體。請在佈建時讀取一次，並把它們寫到資源上——把這個處理器加入 `/opt/otelcol-contrib/config.yaml` 中，並在指標管線中引用它。把它合併到你的組態已有的各區段中——不要再新增第二個 `processors:` 或 `service:` 鍵。",
  "A Mac (Apple silicon or Intel) and an administrator account for `sudo`":
    "一台 Mac（Apple 晶片或 Intel）以及一個可用於 `sudo` 的系統管理員帳戶",
  "Create `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`:":
    "建立 `/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist`：",
  "Load it:": "載入它：",
  "> **Install the contrib build, as above.** The core `otelcol` build has no `resourcedetection` processor, so it refuses to start with this config.":
    "> **請如上所示安裝 contrib 組建。** core 組建 `otelcol` 沒有 `resourcedetection` 處理器，因此用這份組態會拒絕啟動。",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware. Read them once at provisioning time and stamp them onto the resource — add this processor to `/etc/otelcol-contrib/config.yaml` and name it in the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "這份組態已經把機器的 IP 位址、MAC 位址、架構、機器 ID、作業系統描述與作業系統版本填入它在 **資產清單** 中的項目，CMDB 匯出讀取的正是這個項目。序號、製造商、型號與韌體（BIOS / UEFI）版本則不同：**任何資源偵測器都無法取得它們**。它們來自機器的韌體。請在佈建時讀取一次，並把它們寫到資源上——把這個處理器加入 `/etc/otelcol-contrib/config.yaml` 中，並在指標管線中引用它。把它合併到你的組態已有的各區段中——不要再新增第二個 `processors:` 或 `service:` 鍵。",
  "Then restart the collector:": "然後重新啟動收集器：",
  "The values are the machine's own, so they are written once by whatever provisions it. On a Mac, read them like this — the manufacturer is `Apple Inc.`:":
    "這些值屬於機器本身，因此由佈建它的程式寫入一次。在 Mac 上這樣讀取（製造商是 `Apple Inc.`）：",
  "`hw.model` is the model *identifier* (`MacBookPro18,3`), not the marketing name. Put it in `device.model.name` anyway — `device.model.identifier` marks a batch as a mobile app.":
    "`hw.model` 是型號*識別碼*（`MacBookPro18,3`），不是行銷名稱。仍然把它放進 `device.model.name`——`device.model.identifier` 會把批次標記為行動應用程式。",
  "Windows 10 1803+ or Windows Server 2019+ (for the built-in `tar.exe`)":
    "Windows 10 1803+ 或 Windows Server 2019+（為了內建的 `tar.exe`）",
  "An elevated PowerShell prompt (Run as administrator)":
    "以系統管理員身分執行的 PowerShell 提示字元",
  "Save this as `config.yaml` in the folder you will run the PowerShell commands from — step 3 copies it into place.":
    "將其儲存為 `config.yaml`，放在你將要執行 PowerShell 指令的資料夾中——第 3 步會把它複製到位。",
  "On Windows, install the upstream **`otelcol-contrib`** collector — from **v0.155.0** it bundles the `windows_service` receiver that powers the host **Services** tab. Run from an elevated PowerShell prompt:":
    "在 Windows 上，安裝上游的 **`otelcol-contrib`** 收集器——從 **v0.155.0** 起，它內建了為主機 **服務** 索引標籤提供資料的 `windows_service` 接收器。在以系統管理員身分執行的 PowerShell 提示字元中執行：",
  "> **Note:** The service runs as `LocalSystem` so it can read every Windows service. On Windows the `load` scraper only emulates a load average from the *Processor Queue Length* counter (it starts at 0); if it can't read the counter it is logged and skipped, so the rest of the `hostmetrics` config runs unchanged. The [Host OpenTelemetry Collector docs](/docs/telemetry/host-otel-collector) also cover the signed `.msi` installer.":
    "> **注意：** 此服務以 `LocalSystem` 執行，以便讀取每個 Windows 服務。在 Windows 上，`load` 擷取器只是根據 *Processor Queue Length* 計數器模擬負載平均值（從 0 開始）；如果讀不到該計數器，會記錄到日誌並略過，其餘的 `hostmetrics` 組態照常執行。[主機 OpenTelemetry Collector 文件](/docs/telemetry/host-otel-collector) 也介紹了已簽署的 `.msi` 安裝程式。",
  "Logs are written to the Windows Application event log; view them in **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`).":
    "日誌寫入 Windows 的應用程式事件記錄；在 **Event Viewer → Windows Logs → Application**（來源 `otelcol-contrib`）中檢視。",
  "From **v0.155.0** `otelcol-contrib` includes the `windows_service` receiver — turn it on by adding it to `C:\\Program Files\\otelcol-contrib\\config.yaml` and the metrics pipeline. Merge it into the sections your config already has — don't add a second `processors:` or `service:` key.":
    "從 **v0.155.0** 起，`otelcol-contrib` 內建了 `windows_service` 接收器——把它加入 `C:\\Program Files\\otelcol-contrib\\config.yaml` 與指標管線即可啟用。把它合併到你的組態已有的各區段中——不要再新增第二個 `processors:` 或 `service:` 鍵。",
  "The receiver is **Windows-only** and **alpha**. Once metrics arrive, the host **Services** tab populates automatically with each service's running state and startup type.":
    "此接收器 **僅限 Windows**，且處於 **alpha** 階段。指標送達後，主機的 **服務** 索引標籤會自動顯示每個服務的執行狀態與啟動類型。",
  "The config already fills the machine's IP addresses, MAC addresses, architecture, machine id, OS description and OS version onto its **Inventory** item, which is what a CMDB export reads. Serial number, make, model and firmware (BIOS / UEFI) version are different: **no resource detector can produce them.** They come from the machine's firmware through WMI.":
    "這份組態已經把機器的 IP 位址、MAC 位址、架構、機器 ID、作業系統描述與作業系統版本填入它在 **資產清單** 中的項目，CMDB 匯出讀取的正是這個項目。序號、製造商、型號與韌體（BIOS / UEFI）版本則不同：**任何資源偵測器都無法取得它們**。它們透過 WMI 來自機器的韌體。",
  "Run this from an elevated PowerShell prompt on the machine — it queries WMI and prints the exact YAML for *this* machine:":
    "在這台機器上以系統管理員身分執行的 PowerShell 提示字元中執行以下指令——它會查詢 WMI，並印出*這台*機器的確切 YAML：",
  "It prints one processor entry, already indented. Add it inside the `processors:` block your `config.yaml` already has — alongside `resourcedetection:`, `resource:` and `batch:`, not as a second `processors:` key — then name it in the metrics pipeline:":
    "它會印出一個已縮排好的處理器項目。把它加入你的 `config.yaml` 已有的 `processors:` 區塊中——與 `resourcedetection:`、`resource:` 與 `batch:` 並列，而不是作為第二個 `processors:` 鍵——然後在指標管線中引用它：",
  "Use `Get-CimInstance`, not the deprecated `Get-WmiObject` — it is absent from PowerShell 7 and later. Values are emitted in single quotes with any embedded quote doubled, so a serial or model containing punctuation stays valid YAML. A field the firmware leaves empty prints as `''`; drop that attribute rather than shipping a blank one.":
    "請使用 `Get-CimInstance`，不要使用已淘汰的 `Get-WmiObject`——後者在 PowerShell 7 及更新版本中已不存在。值會以單引號括住輸出，內部的引號會加倍，因此含標點的序號或型號仍是有效的 YAML。韌體留空的欄位會輸出為 `''`；請移除該屬性，不要傳送空值。",
  "Within a few minutes the machine's **Inventory** item shows `host.serial_number`, `device.manufacturer`, `device.model.name` and `device.firmware.version` under **Details**, alongside the IP and MAC addresses and machine id the detector already supplies. Run this again after a motherboard swap or a BIOS update — the values are stamped, not detected, so they do not update themselves.":
    "幾分鐘內，機器在 **資產清單** 中的項目會在 **詳細資料** 下顯示 `host.serial_number`、`device.manufacturer`、`device.model.name` 與 `device.firmware.version`，與偵測器已提供的 IP 位址、MAC 位址與機器 ID 並列。更換主機板或更新 BIOS 後請再執行一次——這些值是寫入的，不是偵測到的，因此不會自行更新。",
  "- The **Services** tab lists each service's state once the `windows_service` receiver is enabled (see **Enable the Windows Services tab**).":
    "- 啟用 `windows_service` 接收器後，**服務** 索引標籤會列出每個服務的狀態（請參見 **啟用「Windows 服務」索引標籤**）。",
  "1. Read the collector's logs for export errors: **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`). An HTTP `401` means the key is missing, wrong or expired; `422` means it has been disabled (or is a browser key, which cannot send host telemetry). Pick a working key in step 1 and update `x-oneuptime-token` in `C:\\Program Files\\otelcol-contrib\\config.yaml`.":
    "1. 查看收集器日誌中的匯出錯誤：**Event Viewer → Windows Logs → Application**（來源 `otelcol-contrib`）。HTTP `401` 表示金鑰缺少、錯誤或已過期；`422` 表示它已被停用（或是瀏覽器金鑰，無法傳送主機遙測）。請在第 1 步選擇一個可用的金鑰，並更新 `C:\\Program Files\\otelcol-contrib\\config.yaml` 中的 `x-oneuptime-token`。",
  "1. Run the collector in the foreground to see the real error instead of the generic `Error 1064`:":
    "1. 在前景執行收集器，以看到真正的錯誤，而不是籠統的 `Error 1064`：",
  '2. `Error 2: The system cannot find the file specified` means the service points at a file that is not there — compare `BINARY_PATH_NAME` from `sc.exe qc "otelcol-contrib"` with the contents of `C:\\Program Files\\otelcol-contrib`. The archive must be the `otelcol-contrib_` one, which unpacks `otelcol-contrib.exe`.':
    '2. `Error 2: The system cannot find the file specified` 表示服務指向了一個不存在的檔案——把 `sc.exe qc "otelcol-contrib"` 中的 `BINARY_PATH_NAME` 與 `C:\\Program Files\\otelcol-contrib` 的內容做比較。壓縮檔必須是會解壓縮出 `otelcol-contrib.exe` 的 `otelcol-contrib_` 壓縮檔。',
  "3. **Event Viewer → Windows Logs → Application** (source `otelcol-contrib`) records the startup error the service manager swallowed.":
    "3. **Event Viewer → Windows Logs → Application**（來源 `otelcol-contrib`）記錄了被服務管理員吞掉的啟動錯誤。",
  "If you set `include_services` but still see every service, the collector hasn't picked up the edit — restart the service (`Restart-Service otelcol-contrib`) and give the Services tab a few minutes to refresh its rolling window.":
    "如果你設定了 `include_services` 卻仍然看到所有服務，表示收集器沒有讀取到這次修改——請重新啟動服務（`Restart-Service otelcol-contrib`），並給「服務」索引標籤幾分鐘時間重新整理其滾動視窗。",
  "Kubernetes nodes are monitored by the **OneUptime Kubernetes agent** rather than a host collector: each node appears under **Kubernetes** → your cluster → **Nodes**, next to its pods and workloads, not in the **Hosts** list. The steps below install the agent on a standard cluster; the install guide in the **Kubernetes** section has the steps for Amazon EKS, Google GKE, Azure AKS, GKE Autopilot and EKS Fargate.":
    "Kubernetes 節點由 **OneUptime Kubernetes 代理程式** 而不是主機收集器監視：每個節點都出現在 **Kubernetes** → 你的叢集 → **節點** 下，與它的 Pod 和工作負載並列，而不在 **主機** 清單中。下方的步驟在標準叢集上安裝代理程式；**Kubernetes** 區段的安裝指南提供了 Amazon EKS、Google GKE、Azure AKS、GKE Autopilot 與 EKS Fargate 的步驟。",
  "A Kubernetes cluster running v1.23 or later":
    "執行 v1.23 或更新版本的 Kubernetes 叢集",
  "`kubectl` and `helm` (v3) installed on your machine":
    "你的電腦上已安裝 `kubectl` 和 `helm`（v3）",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "叢集不對？用 `kubectl config use-context <context-name>` 切換。",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "將 `my-cluster` 換成此叢集的名稱，例如 `prod-us-east-1`。叢集在 OneUptime 中就以此名稱顯示，所以請保持不變：新名稱會註冊一個新叢集。",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` 會開啟 **AI 調查**，與 chart 的預設相同：OneUptime AI 會透過 Kubernetes AI 代理程式，使用唯讀 kubectl 調查此叢集上的事件與警示。",
  "You should see:": "你應該會看到：",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "收集器與 Kubernetes AI 代理程式，以及每個節點上各一個 `-logs` 和 `-ebpf` Pod。它們變成 `Running` 後，叢集會自動出現在 **Kubernetes** 區段，通常在一兩分鐘內。",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes AI 代理程式（預設開啟，唯讀）。** `kubernetes-agent-ai-agent` Pod 讓 OneUptime AI 使用相同的 API 金鑰，以唯讀 kubectl（`get`、`describe`、`logs`、`events`、`top`）調查此叢集上的事件與警示；除非你之後授予它寫入權限，否則它無法變更任何內容。開啟叢集並前往 **人工智慧 → 代理程式** 即可看到它。不需要它？安裝時以 `--set aiAgent.enabled=false` 取代 `--set aiAgent.enabled=true`。",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "命名空間規則決定代理程式從每個命名空間收集什麼。若只從 `default`、`production` 和 `staging` 收集 Pod 日誌與 eBPF 資料：",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "若要保留全部內容，只停止吵雜命名空間的日誌，請只將它們從 `podLogs` 排除：",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **範圍：** `podLogs`（容器的 stdout/stderr）、`ebpfDiscovery`（eBPF 追蹤與指標）、`metrics`（含命名空間的指標）和 `traces`（所有 span）。",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **模式** 會比對完整的命名空間名稱，並接受 `*`，例如 `team-*`。`exclude` 規則一律優先於 `include` 規則。",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **設定規則會取代預設規則**，預設規則會將 `kube-system` 排除在 `podLogs` 和 `ebpfDiscovery` 之外。如果仍需要它，請像第二個範例那樣把它留在清單中。",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- 節點與叢集指標沒有命名空間，因此一律保留。",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` 需要 Helm 3.10 或更新版本。",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**只傳送重要的日誌行。** 在 Pod 日誌行離開叢集之前，捨棄低於某個嚴重性的行：",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    '接受 `TRACE`、`DEBUG`、`INFO`、`WARN`、`ERROR` 和 `FATAL`：`WARN` 會保留警告、錯誤與嚴重錯誤的行。嚴重性從日誌行本身讀取（`[ERROR]`、`level=warn`、`"level":"info"`）。Kubernetes 事件永遠不會因此被捨棄。',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**關閉 Pod 日誌。** 指標不受影響：節點收集器會繼續執行以收集 kubelet 和 cAdvisor 指標，只是不再讀取 Pod 日誌：",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**變更日誌的讀取方式。** 預設集會替你選擇；明確指定的 `logs.mode` 一律優先：",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`：透過 hostPath 讀取每個節點上的 `/var/log/pods`（負擔最低；需要 hostPath）。",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`：由一個 Deployment 透過 Kubernetes API 追蹤 Pod 日誌（適用於任何叢集）。",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`：不收集 Pod 日誌。",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "這會讀取 API 伺服器，也就是它在叢集內回應的地方。etcd、排程器和控制器管理員在控制平面節點上回應，代理程式的 Pod 無法猜出這些節點，所以只要你列出每個節點的位址，它就會讀取它們：",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **排程器和控制器管理員** 提供 HTTPS 並接受代理程式的權杖，但 kubeadm 會把它們繫結到 `127.0.0.1`：請給它們一個代理程式的 Pod 能連到的 `--bind-address`。",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** 如上所述，在 kubeadm 的 `--listen-metrics-urls`（連接埠 2381，在你加入節點位址之前繫結到 `127.0.0.1`）以純 HTTP 提供指標。也可以用它要求的用戶端憑證抓取它的 HTTPS 用戶端連接埠 2379：把 `ca.crt`、`tls.crt` 和 `tls.key` 放進 `oneuptime-agent` 中的一個 Secret，並在 `controlPlane.etcd.clientCertSecret` 中指定它。",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "僅適用於自行管理的叢集：受控服務（EKS、GKE、AKS）不會公開其控制平面指標。",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "成本監控預設為開啟：代理程式內建開放原始碼的 OpenCost 引擎（以及它需要的小型 Prometheus），依雲端供應商公開的牌價為你的節點與磁碟區定價，不需要憑證，並傳送每個命名空間與工作負載的成本。第一個完整小時過後，叢集的概覽與「成本」頁面會出現第一批資料。",
  "On an agent installed before it was on by default, upgrade it:":
    "對於在預設開啟之前安裝的代理程式，請升級它：",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **關閉它：** 在同一次升級中加入 `--set cost.enabled=false`。",
  "- **Already running Kubecost or OpenCost?** Point the agent at it instead, and nothing is bundled: add `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (or your Kubecost service).":
    "- **已經在執行 Kubecost 或 OpenCost？** 改為讓代理程式指向它，這樣就不會內建任何元件：加入 `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003`（或你的 Kubecost 服務）。",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **地端或裸機？** 用 `--set cost.opencost.customPricing.enabled=true` 設定費率表（每資源小時的美元價格；請參閱 chart 的 `values.yaml`）。",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "完整指南：[Kubernetes 成本可觀測性](/docs/telemetry/kubernetes-cost)。",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "代理程式在每個節點上執行 [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/)。它不需要 SDK 或 sidecar，就能擷取 Go、.NET、Java、Node.js、Python、Ruby 和 Rust 服務的 HTTP/HTTPS、gRPC 與 SQL/Redis 流量，並透過收集器傳送追蹤、要求（RED）指標與服務圖資料。",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**要求：** 具備 BTF 的 Linux 核心 **5.8+**（Debian 11+、Ubuntu 20.10+、Fedora 34+、RHEL 9+ 的預設）。eBPF Pod 以 **特權** 模式執行，這是載入 eBPF 程式所必需的。",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "如果你的節點執行較舊的核心、不允許特權 Pod，或是你的服務已經用 OpenTelemetry SDK 傳送追蹤而你不想要重複資料，請 **關閉它**：",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**選擇訊號。** 每個系列都用 `--set ebpf.features.<name>=false`（或 `=true`）切換：",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | 預設 | 新增的內容 |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | 開 | 每個服務的 HTTP/gRPC 要求速率、錯誤與延遲 |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | 開 | span 的呼叫次數與持續時間（`traces.span.metrics.*`） |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | 開 | 呼叫端 → 被呼叫端的邊；驅動服務地圖 |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | 開 | Pod 之間的 TCP/UDP 流量計數器 |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | 關 | 跨區域的網路指標（會使其基數加倍） |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | 開 | 節點層級的 TCP RTT、連線失敗與重傳計數器 |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**跨服務追蹤傳播**（把從 Pod A → Pod B 的要求串成一條追蹤，即使在另一個節點上也一樣）**預設開啟**。它透過改寫正在傳輸的流量來運作（在核心中擴充純文字 HTTP 要求，並為 TLS 與原始 TCP 附加一個 TCP 選項），而這種位元組計算一旦出錯就會讓資料流失去同步：已回報的症狀是經過 nginx 等 L7 代理的傳輸在回應超過 ~64KB 時卡住。如果你遇到這種情況，或服務網格開始讓 Pod 失敗，請用 `--set ebpf.contextPropagation=false` 關閉它；OpenTelemetry SDK 會在使用者空間傳播 `traceparent`，不需要這些動作。",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "每個 `oneuptime.labels.<key>=<value>` 都會成為叢集及其回報之服務與主機上的標籤 `<key>:<value>`。標籤比對不區分大小寫，因此會重複使用現有的 `Production` 標籤；在 OneUptime 介面中新增的標籤絕不會被代理程式移除。",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**升級** 到最新的 chart。`--reset-then-reuse-values`（Helm 3.14+）會保留你設定的值（預設集、叢集名稱、篩選條件），其餘全部採用新 chart 的值；在此之上加入任何新的 `--set` 旗標：",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "在 Helm 3.13 及更早版本中，請改用你設定的值進行升級：",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "請勿使用 `--reuse-values`：它也會保留你升級前那個 chart 的預設值，導致較新 chart 的預設值（包括其 eBPF 映像檔）永遠不會生效。",
  "**Uninstall** the agent and its namespace:":
    "**解除安裝** 代理程式及其命名空間：",
  "| Category | Data |": "| 類別 | 資料 |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **節點指標** | CPU、記憶體、檔案系統與網路使用量 |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod 與容器指標** | CPU、記憶體、網路 I/O 與重新啟動次數 |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **叢集指標** | 節點狀況、可配置資源、Pod 與工作負載數量 |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes 事件** | 警告、錯誤與排程事件 |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Pod 日誌** | 每個容器的 stdout/stderr，在各個節點上讀取 |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **應用程式追蹤** *(eBPF)* | 來自每個 Pod 的 HTTP、gRPC 與 SQL/Redis span，不需要 SDK 或程式碼變更 |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **要求指標與服務圖** *(eBPF)* | 每個服務的要求速率、錯誤與延遲，以及服務地圖所用的呼叫端 → 被呼叫端的邊 |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **網路流量** *(eBPF)* | Pod 之間的 TCP/UDP 位元組與封包計數器 |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **工作負載成本** *(預設開啟)* | 每個命名空間、工作負載與 Pod 的支出，以及閒置容量與效率，也以可設定警示的指標形式提供 |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "你的叢集封鎖了 `hostPath` 磁碟區或特權 Pod。這在 **GKE Autopilot** 和 **EKS Fargate** 上很正常：請在本指南頂端選擇該平台，並依照它的步驟操作。而在 **OpenShift** 上，安裝會成功，但代理程式的節點 Pod 永遠不會啟動：請選擇 **Red Hat OpenShift**。",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "在任何其他採用嚴格 Pod Security 原則的叢集上，請移除失敗的 release：",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "接著加上 `--set preset=gke-autopilot`，再次執行安裝命令。這個預設集會透過 Kubernetes API 而非 hostPath 讀取 Pod 日誌，套用強化的安全性內容，並排除需要特權的 eBPF 與效能分析 Pod。",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. 檢查代理程式的 Pod 是否正在執行：`kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. 檢查收集器的日誌：`kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. 確認安裝命令中的 OneUptime URL 與擷取金鑰正確。",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. 確定叢集能透過網路連到你的 OneUptime 執行個體。",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. 檢查 AI 代理程式的 Pod：`kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. 檢查它的日誌：`kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. 沒有 Pod？升級 chart（請參閱「進階」中的 **升級或解除安裝代理程式**），並加入 `--set aiAgent.enabled=true`。",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. 檢查叢集名稱是否一致：本指南安裝的是 **`my-cluster`**。",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. 確認代理程式的 RBAC 權限：`kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. 在收集器的日誌中尋找匯出錯誤：`kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **核心太舊或沒有 BTF。** eBPF 需要具備 BTF 的 Linux 5.8+；請在節點上用 `uname -r` 檢查。如果無法升級，請用 `--set ebpf.enabled=false` 關閉 eBPF。",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **特權 Pod 遭封鎖。** 有些嚴格鎖定的叢集會拒絕它們。請關閉 eBPF。",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **主機上沒有 `debugfs` / `tracefs`。** 只關閉 TCP 統計系列：`--set ebpf.features.tcpStats=false`。",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. 檢查 eBPF Pod 是否正常：`kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. 開啟 OBI 的偵錯輸出，確認它看得到流量：`--set ebpf.printTraces=true --set ebpf.logLevel=debug`，然後閱讀 `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`。",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. 如果 span 出現在那裡，卻沒有出現在 OneUptime 中，請在收集器的日誌中尋找匯出錯誤：`kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
};

export default TRANSLATION;
