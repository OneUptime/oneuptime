import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The StorageArray setup guide in Traditional Chinese (#8341): each piece of the English
 * guide's markdown (Pages/StorageArray/Utils/DocumentationMarkdown.ts) and its
 * Traditional Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Traditional Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashArray's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 或更新版本及 Docker Compose v2 外掛程式，所在機器能透過 HTTPS（TCP 443）連到 FlashArray 的管理位址",
  "An administrator account on the FlashArray, to create the agent's read-only user":
    "FlashArray 上的管理員帳戶，用於為代理程式建立唯讀使用者",
  "Create the token **without an expiry**, or the agent stops the day it expires.":
    "建立權杖時請選擇 **永不過期**，否則代理程式會在權杖過期當天停止運作。",
  "SSH to the FlashArray as an administrator. The first command asks for the new user's password; the second prints its API token:":
    "以管理員身分透過 SSH 登入 FlashArray。第一個指令會詢問新使用者的密碼；第二個指令會印出該使用者的 API 權杖：",
  "1. Open **Settings → Users and Policies** (**Settings → Access** on older releases).":
    "1. 開啟 **Settings → Users and Policies**（舊版本中為 **Settings → Access**）。",
  "2. From the ⋮ menu of the **Users** panel choose **Create User…**, name it `oneuptime` and give it the **readonly** role.":
    "2. 在 **Users** 面板的 ⋮ 選單中選擇 **Create User…**，將其命名為 `oneuptime`，並授予 **readonly** 角色。",
  "3. From the new user's ⋮ menu choose **Create API Token…**, leave **Expires In** empty, and copy the token.":
    "3. 在新使用者的 ⋮ 選單中選擇 **Create API Token…**，將 **Expires In** 留空，然後複製權杖。",
  "A `purefa_info{...} 1` line means the array serves its metrics natively: carry on. A **404** means its Purity//FA is older (Pure documents the native endpoint for 6.7.0 and later; its exporter's deprecation notice says 6.6.11 and later) — pick **FlashArray, older Purity** at the top of this guide instead.":
    "出現 `purefa_info{...} 1` 這一行，表示陣列原生提供指標：繼續即可。出現 **404** 表示它的 Purity//FA 較舊（Pure 記載原生端點適用於 6.7.0 及更新版本；其匯出器的淘汰通知寫的是 6.6.11 及更新版本）——請改為在本指南頂端選擇 **FlashArray，舊版 Purity**。",
  "The first line downloads the script as `install.sh`, so you can read it before you run it.":
    "第一行會把指令碼下載為 `install.sh`，讓你可以在執行前先閱讀它。",
  "The command carries the platform you picked above. The script asks for:":
    "該指令帶有你在上方選擇的平台。指令碼會詢問：",
  "- your **OneUptime URL** and **ingestion key**, both shown in step 1 (pick a key there to have them filled in here)":
    "- 你的 **OneUptime URL** 與 **擷取金鑰**，兩者都顯示在第 1 步中（在那裡選擇一個金鑰即可在此處填好）",
  "- an **array name** — how the array appears in OneUptime. Give every array its own and keep it stable: a new name registers a new storage array":
    "- **陣列名稱**：陣列在 OneUptime 中顯示的名稱。為每個陣列取一個獨立的名稱並保持不變：新名稱會註冊一個新的儲存陣列",
  "- the FlashArray's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- FlashArray 的 **管理位址**（主機名稱或 IP，不加 `https://`）與唯讀使用者的 **API 權杖**，指令碼讀取權杖時不會回顯",
  "- whether to verify the array's certificate — answer **N** unless the array carries a certificate from a CA you trust (arrays ship a self-signed one)":
    "- 是否驗證陣列的憑證：除非陣列裝有你信任的 CA 簽發的憑證，否則回答 **N**（陣列出廠時帶有自我簽署憑證）",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the API token) and starts the agent with Docker Compose.":
    "它會安裝到 `/opt/oneuptime-storage-array-agent`，寫入一個只有你能讀取的 `.env` 檔案（其中包含 API 權杖），並用 Docker Compose 啟動代理程式。",
  "Download the compose file and the collector configs from this OneUptime into a new folder:":
    "從此 OneUptime 下載 compose 檔案與收集器組態到一個新資料夾：",
  "Create a `.env` file next to them:": "在它們旁邊建立一個 `.env` 檔案：",
  "- Replace `my-storage-array` with a name for this array, such as `fa-prod-01`. It is how the array appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- 將 `my-storage-array` 換成此陣列的名稱，例如 `fa-prod-01`。陣列在 OneUptime 中就以此名稱顯示，所以請保持不變：新名稱會註冊一個新的儲存陣列。",
  "- Set `PURE_FA_ENDPOINT` to the FlashArray's management address — host name or IP, no `https://` — and `PURE_FA_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- 將 `PURE_FA_ENDPOINT` 設為 FlashArray 的管理位址（主機名稱或 IP，不加 `https://`），將 `PURE_FA_API_TOKEN` 設為唯讀使用者的 API 權杖。執行 `chmod 600 .env`：該檔案包含權杖。",
  "Start the agent:": "啟動代理程式：",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中選擇一個擷取金鑰，以填入 `<YOUR_API_KEY>`。",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The array then appears automatically in the **Storage Arrays** section after its first scrape, usually within a minute or two.":
    "在日誌中尋找 `Everything is ready. Begin running and processing data.`。第一次抓取後，陣列會自動出現在 **儲存陣列** 區段，通常在一兩分鐘內。",
  "The install script writes these to `/opt/oneuptime-storage-array-agent/.env`; a Docker Compose install reads them from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the agent's folder.":
    "安裝指令碼會把這些值寫入 `/opt/oneuptime-storage-array-agent/.env`；以 Docker Compose 安裝時，則從 `docker-compose.yml` 旁邊的 `.env` 檔案讀取。變更其中任何一項後，在代理程式的資料夾中用 `docker compose up -d` 套用。",
  "| Variable | Required | Description |": "| 變數 | 必填 | 說明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 執行個體 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 是 | 遙測擷取金鑰，即第 1 步中選擇的那個 |",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this array registers under in OneUptime. Stamped on every metric as the `storage.array.name` resource attribute. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | 是 | 此陣列在 OneUptime 中註冊所用的名稱。以資源屬性 `storage.array.name` 標記在每個指標上。請保持不變：變更它會註冊一個新的儲存陣列 |",
  "| `STORAGE_SYSTEM` | No | The platform, stamped as the `storage.system` resource attribute: `purestorage.flasharray` or `purestorage.flashblade` (default: `purestorage.flasharray`) |":
    "| `STORAGE_SYSTEM` | 否 | 平台，以資源屬性 `storage.system` 標記：`purestorage.flasharray` 或 `purestorage.flashblade`（預設：`purestorage.flasharray`） |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | No | Which shipped config runs: `otel-collector-config.yaml` (FlashArray, native — the default), `otel-collector-config.flasharray-exporter.yaml` (older FlashArray) or `otel-collector-config.flashblade.yaml` (FlashBlade) |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | 否 | 執行哪一份隨附組態：`otel-collector-config.yaml`（FlashArray 原生端點，預設）、`otel-collector-config.flasharray-exporter.yaml`（較舊的 FlashArray）或 `otel-collector-config.flashblade.yaml`（FlashBlade） |",
  "| `COMPOSE_PROFILES` | No | Starts the exporter the config needs: empty for the native FlashArray config, `flasharray-exporter` or `flashblade` for the others |":
    "| `COMPOSE_PROFILES` | 否 | 啟動該組態需要的匯出器：原生 FlashArray 組態留空，其他組態為 `flasharray-exporter` 或 `flashblade` |",
  "| `PURE_FA_ENDPOINT` | FlashArray | The FlashArray's management address — host name or IP, no `https://` |":
    "| `PURE_FA_ENDPOINT` | FlashArray | FlashArray 的管理位址：主機名稱或 IP，不加 `https://` |",
  "| `PURE_FA_API_TOKEN` | FlashArray | API token of the FlashArray user with the readonly role |":
    "| `PURE_FA_API_TOKEN` | FlashArray | 具有 readonly 角色的 FlashArray 使用者的 API 權杖 |",
  "| `PURE_FB_ENDPOINT` | FlashBlade | The FlashBlade's management address — host name or IP, no `https://` |":
    "| `PURE_FB_ENDPOINT` | FlashBlade | FlashBlade 的管理位址：主機名稱或 IP，不加 `https://` |",
  "| `PURE_FB_API_TOKEN` | FlashBlade | API token of the FlashBlade user with the readonly role |":
    "| `PURE_FB_API_TOKEN` | FlashBlade | 具有 readonly 角色的 FlashBlade 使用者的 API 權杖 |",
  "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | No | `true` accepts the array's self-signed certificate on the native endpoint; `false` verifies it (default: `true`). Pure's exporters never verify the array's certificate, so it does not apply to them |":
    "| `STORAGE_ARRAY_INSECURE_SKIP_VERIFY` | 否 | `true` 在原生端點上接受陣列的自我簽署憑證；`false` 則驗證它（預設：`true`）。Pure 的匯出器從不驗證陣列的憑證，所以此項對它們不適用 |",
  "- The collector reads the FlashArray's own OpenMetrics endpoint over HTTPS with the token as a Bearer credential — no exporter runs.":
    "- 收集器透過 HTTPS 讀取 FlashArray 本身的 OpenMetrics 端點，並以權杖作為 Bearer 認證——不執行任何匯出器。",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/volumes`, `/metrics/hosts` and `/metrics/pods` every 2 minutes; `/metrics/directories` every 30 minutes — directory space is expensive for the array to compute.":
    "- **每個端點一個抓取工作**，各依值得的頻率讀取：`/metrics/array` 每 60 秒一次；`/metrics/volumes`、`/metrics/hosts` 與 `/metrics/pods` 每 2 分鐘一次；`/metrics/directories` 每 30 分鐘一次——目錄空間對陣列來說計算代價很高。",
  "- **Every job labels its series `scrape_endpoint: <endpoint>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted object leaves the inventory. Keep the labels as shipped.":
    "- **每個工作都為自己的序列加上標籤 `scrape_endpoint: <endpoint>`**，讓 OneUptime 知道一個批次是哪些物件的完整列表——已刪除的物件正是這樣離開資產清單的。請讓標籤保持隨附時的樣子。",
  "- **Per-volume and per-host latency keeps three dimensions** (`usec_per_read_op`, `usec_per_write_op`, `usec_per_mirrored_write_op`); a `metric_relabel_configs` rule drops the QoS, queue, SAN and service-time breakdown, which multiplies the series count of a large array. The array-wide breakdown is kept.":
    "- **依磁碟區與依主機的延遲保留三個維度**（`usec_per_read_op`、`usec_per_write_op`、`usec_per_mirrored_write_op`）；一條 `metric_relabel_configs` 規則會捨棄 QoS、佇列、SAN 與服務時間的細分，這些細分會讓大型陣列的序列數成倍增加。整個陣列層級的細分會保留。",
  "- **No `send_batch_max_size`.** OneUptime rebuilds the inventory from one whole scrape, so the `batch` processor never splits one.":
    "- **不設 `send_batch_max_size`。** OneUptime 根據一次完整的抓取重建資產清單，所以 `batch` 處理器從不拆分抓取。",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "這是代理程式執行的完整 `otel-collector-config.yaml`；`.env` 檔案提供 `${env:...}` 的值：",
  "The agent ships metrics only until you turn on its syslog receivers. Arrays forward their alerts and audit events as syslog; the agent stamps `storage.array.name` on every line, so they land on this array's **Logs** page.":
    "在你開啟 syslog 接收器之前，代理程式只傳送指標。陣列會把警示與稽核事件以 syslog 轉送；代理程式會在每一行標記 `storage.array.name`，所以它們會進入此陣列的 **日誌** 頁面。",
  "1. In `otel-collector-config.yaml`, uncomment the `syslog/tcp` and `syslog/udp` receivers and the `logs` pipeline. Classic BSD syslog timestamps carry no time zone: set `location` to the array's time zone unless its clock runs on UTC.":
    "1. 在 `otel-collector-config.yaml` 中，取消註解 `syslog/tcp` 與 `syslog/udp` 接收器以及 `logs` 管線。傳統 BSD syslog 時間戳記不帶時區：除非陣列的時鐘以 UTC 運作，否則請把 `location` 設為陣列所在的時區。",
  "2. In `docker-compose.yml`, uncomment the `ports:` block that publishes `5514/tcp` and `5514/udp`, and open the port on the machine's firewall for the array's management network.":
    "2. 在 `docker-compose.yml` 中，取消註解發布 `5514/tcp` 與 `5514/udp` 的 `ports:` 區塊，並在機器的防火牆上為陣列的管理網路開放該連接埠。",
  "3. Apply both:": "3. 套用這兩項變更：",
  "4. On the FlashArray, as an administrator, open **Settings → System → Syslog Servers**, add `udp://<agent-host>:5514` (or `tcp://<agent-host>:5514`) and send a test message.":
    "4. 在 FlashArray 上，以管理員身分開啟 **Settings → System → Syslog Servers**，新增 `udp://<agent-host>:5514`（或 `tcp://<agent-host>:5514`）並傳送一則測試訊息。",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the array: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor of the collector config you use, next to `storage.array.name`:":
    "任何帶有 `oneuptime.label.` 前置詞的資源屬性都會成為陣列上的專案標籤：`oneuptime.label.<dimension>=<value>` 即標籤 `<dimension>:<value>`。將它們加入你所用收集器組態的 `resource` 處理器中，放在 `storage.array.name` 旁邊：",
  "Then restart the collector so it reads the new config:":
    "然後重新啟動收集器，讓它讀取新組態：",
  "The array shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "陣列會帶著 `team:storage` 與 `env:production` 標籤出現。標籤比對不區分大小寫，因此會重複使用現有的 `Production` 標籤；在 OneUptime 介面中新增的標籤絕不會被代理程式移除。",
  "Every value is a gauge the FlashArray computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "每個值都是 FlashArray 自己計算的儀表值——延遲以每次操作的微秒計，輸送量以每秒計。OneUptime 的儲存陣列頁面、指標目錄與警示範本都以下列資料為基礎：",
  "| Endpoint | Data |": "| 端點 | 資料 |",
  "| **Array** (`/metrics/array`) | `purefa_info`, capacity and data reduction (`purefa_array_space_*`), performance, open alerts (`purefa_alerts_open`), hardware components, drives, controllers and network interfaces |":
    "| **陣列**（`/metrics/array`） | `purefa_info`、容量與資料縮減（`purefa_array_space_*`）、效能、未解決的警示（`purefa_alerts_open`）、硬體元件、磁碟機、控制器與網路介面 |",
  "| **Volumes** (`/metrics/volumes`) | Latency, IOPS, bandwidth, space and data reduction per volume |":
    "| **磁碟區**（`/metrics/volumes`） | 每個磁碟區的延遲、IOPS、頻寬、空間與資料縮減 |",
  "| **Hosts** (`/metrics/hosts`) | Connectivity, connected volumes, latency, IOPS and space per host |":
    "| **主機**（`/metrics/hosts`） | 每台主機的連線能力、已連線磁碟區、延遲、IOPS 與空間 |",
  "| **Pods** (`/metrics/pods`) | ActiveCluster and ActiveDR replica link lag, mediator status, performance and space |":
    "| **Pod**（`/metrics/pods`） | ActiveCluster 與 ActiveDR 複本連結延遲、仲裁器狀態、效能與空間 |",
  "| **Directories** (`/metrics/directories`) | Space and performance of FlashArray file services' managed directories |":
    "| **目錄**（`/metrics/directories`） | FlashArray 檔案服務中受管目錄的空間與效能 |",
  "One agent reads one array. To monitor several from the same machine, install each into its own folder with its own `.env`, and give each its own `container_name` in its `docker-compose.yml` (for example `oneuptime-storage-array-agent-fa02`) — two containers cannot share a name:":
    "一個代理程式讀取一個陣列。要從同一台機器監控多個陣列，請把每個代理程式安裝到各自的資料夾中，使用各自的 `.env`，並在各自的 `docker-compose.yml` 中設定各自的 `container_name`（例如 `oneuptime-storage-array-agent-fa02`）——兩個容器不能共用一個名稱：",
  "The agent ships a systemd unit that assumes the install script's folder, `/opt/oneuptime-storage-array-agent`. The install script does not download it, so fetch it:":
    "代理程式附帶一個 systemd 單元，它假定使用安裝指令碼的資料夾 `/opt/oneuptime-storage-array-agent`。安裝指令碼不會下載它，所以請自行取得：",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its configs are files beside it, so pulling alone does not move the agent forward. Re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and collector configs — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — and recreates the agent with them:":
    "**升級**——收集器映像檔固定在 `docker-compose.yml` 中，其組態是旁邊的檔案，所以只提取映像檔並不會讓代理程式更新。請再次執行安裝指令碼。它會沿用你現有 `.env` 中的每個值（不會再詢問任何內容），下載最新的 `docker-compose.yml` 與收集器組態（你編輯過的檔案會以 `<file>.bak.<timestamp>` 保留在新檔案旁邊），並用它們重新建立代理程式：",
  "An agent installed outside `/opt/oneuptime-storage-array-agent` (a second array's, say) needs its folder: `INSTALL_DIR=<folder> bash install.sh`.":
    "安裝在 `/opt/oneuptime-storage-array-agent` 以外的代理程式（例如第二個陣列的代理程式）需要指定其資料夾：`INSTALL_DIR=<folder> bash install.sh`。",
  "Installed it with Docker Compose instead? In the agent's folder, download the compose file and the collector configs again; your `.env` stays, and a change you made to any of them has to be made again:":
    "改用 Docker Compose 安裝的？在代理程式的資料夾中重新下載 compose 檔案與收集器組態；你的 `.env` 會保留，而你對其中任何檔案所做的變更都需要重做一遍：",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "然後提取映像檔並重新建立代理程式，讓收集器讀取新組態：",
  "The config reports the collector version it pins as the array's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "該組態會把它固定的收集器版本回報為陣列的 **代理程式版本**。當此 OneUptime 固定了較新的版本時，旁邊的警告標誌會開啟這些指令。",
  "**Uninstall** the agent:": "**解除安裝**代理程式：",
  "Then delete the read-only user and its API token on the array if you no longer need them.":
    "如果不再需要，再到陣列上刪除唯讀使用者及其 API 權杖。",
  "`troubleshoot.sh` checks the whole chain — container runtime, the array endpoint exactly as the collector reaches it (the native endpoint or Pure's exporter, DNS, TLS, the API token), array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` 會檢查整條鏈路（容器執行階段、依收集器實際連線方式檢查的陣列端點——原生端點或 Pure 的匯出器、DNS、TLS、API 權杖——陣列名稱標記、收集器本身的指標），並直接詢問 OneUptime 是否接受你的擷取金鑰。最後一項檢查最重要：OneUptime 的 OTLP 端點會以 `401` 或 `422` 拒絕錯誤的金鑰，而收集器只會為每個批次記錄一行很容易被忽略的 `Exporting failed`，所以指令碼會向 `GET /otlp/v1/validate` 要求直接的 200/401 判定。",
  "It ends with a verdict naming the most likely cause.":
    "最後它會給出判定，指出最可能的原因。",
  "1. Check the collector logs: `docker logs oneuptime-storage-array-agent`. `server returned HTTP status 401` means the array refused the API token, `404` means the FlashArray has no native endpoint, `x509` means TLS verification is on against the array's self-signed certificate, `no such host` or `connection refused` means a wrong `PURE_FA_ENDPOINT`, and an export `401` means a bad ingestion key.":
    "1. 檢查收集器日誌：`docker logs oneuptime-storage-array-agent`。`server returned HTTP status 401` 表示陣列拒絕了 API 權杖，`404` 表示 FlashArray 沒有原生端點，`x509` 表示針對陣列的自我簽署憑證開啟了 TLS 驗證，`no such host` 或 `connection refused` 表示 `PURE_FA_ENDPOINT` 有誤，匯出時的 `401` 表示擷取金鑰有誤。",
  "2. Make sure `STORAGE_ARRAY_NAME` is set — discovery keys on the `storage.array.name` resource attribute, and the collector refuses to start without it.":
    "2. 確定已設定 `STORAGE_ARRAY_NAME`——探索依據的是資源屬性 `storage.array.name`，沒有它收集器會拒絕啟動。",
  "3. Make sure `STORAGE_ARRAY_COLLECTOR_CONFIG` and `COMPOSE_PROFILES` name the same platform.":
    "3. 確定 `STORAGE_ARRAY_COLLECTOR_CONFIG` 與 `COMPOSE_PROFILES` 指向同一個平台。",
  "Its Purity//FA has no native OpenMetrics endpoint. Set `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` and `COMPOSE_PROFILES=flasharray-exporter` in `.env` and run `docker compose up -d` — or re-run `install.sh` with the older-Purity choice. After upgrading the array to Purity//FA 6.7 or later, switch back to the native config and drop the profile.":
    "這台 FlashArray 的 Purity//FA 沒有原生 OpenMetrics 端點。在 `.env` 中設定 `STORAGE_ARRAY_COLLECTOR_CONFIG=otel-collector-config.flasharray-exporter.yaml` 與 `COMPOSE_PROFILES=flasharray-exporter`，然後執行 `docker compose up -d`——或者以較舊 Purity 的選項重新執行 `install.sh`。把陣列升級到 Purity//FA 6.7 或更新版本後，切回原生組態並移除該 profile。",
  "Check that you pasted the token, not the user's password; that the user still exists and holds the readonly role; and that the token has not expired. Create a new token (`pureadmin create --api-token oneuptime` on a FlashArray), put it in `.env` as `PURE_FA_API_TOKEN` and run `docker compose up -d`.":
    "檢查你貼上的是權杖而不是使用者的密碼；該使用者仍然存在並具有 readonly 角色；以及權杖沒有過期。建立一個新權杖（在 FlashArray 上用 `pureadmin create --api-token oneuptime`），把它以 `PURE_FA_API_TOKEN` 寫入 `.env`，然後執行 `docker compose up -d`。",
  "Arrays present a self-signed certificate by default, which no Docker image trusts. Set `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or install a certificate on the array from a CA the collector image trusts.":
    "陣列預設提供自我簽署憑證，任何 Docker 映像檔都不信任它。請設定 `STORAGE_ARRAY_INSECURE_SKIP_VERIFY=true`（在私人管理網路上這是務實的選擇），或在陣列上安裝一張由收集器映像檔信任的 CA 簽發的憑證。",
  "`pure-fa-exporter` or `pure-fb-exporter` is not running: `COMPOSE_PROFILES` must match `STORAGE_ARRAY_COLLECTOR_CONFIG` — `flasharray-exporter` for the FlashArray exporter config, `flashblade` for the FlashBlade config. Fix `.env` and run `docker compose up -d`; `docker compose ps` then lists the exporter.":
    "`pure-fa-exporter` 或 `pure-fb-exporter` 沒有執行：`COMPOSE_PROFILES` 必須與 `STORAGE_ARRAY_COLLECTOR_CONFIG` 相符——FlashArray 匯出器組態用 `flasharray-exporter`，FlashBlade 組態用 `flashblade`。修正 `.env` 並執行 `docker compose up -d`；之後 `docker compose ps` 會列出該匯出器。",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-storage-array-agent`":
    "1. 檢查代理程式是否正在執行：`docker ps --filter name=oneuptime-storage-array-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`":
    "2. 檢查代理程式日誌中的錯誤：`docker logs oneuptime-storage-array-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. 確認你的 OneUptime URL 與擷取金鑰正確。",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. 確定代理程式所在的機器能透過網路連到 OneUptime 執行個體。",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "陣列的身分來自 `STORAGE_ARRAY_NAME`，它以 `storage.array.name` 標記在每個指標上。在 `.env` 中修正它，並在代理程式的資料夾中用 `docker compose up -d` 套用——請注意，新名稱會註冊一個新的儲存陣列。",
  "It registers the array as **`array-1`** — the name this array already has in OneUptime.":
    "它會把陣列註冊為 **`array-1`**——這是此陣列在 OneUptime 中已有的名稱。",
  "- This installs the agent for **`array-1`** — keep `STORAGE_ARRAY_NAME` exactly as it is, or the data registers as a new storage array.":
    "- 這會為 **`array-1`** 安裝代理程式——請讓 `STORAGE_ARRAY_NAME` 保持原樣，否則資料會註冊為一個新的儲存陣列。",
  "The array's identity comes from `STORAGE_ARRAY_NAME`, stamped on every metric as `storage.array.name`. This array is **`array-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the agent's folder — note that a new name registers a new storage array.":
    "陣列的身分來自 `STORAGE_ARRAY_NAME`，它以 `storage.array.name` 標記在每個指標上。此陣列是 **`array-1`**。在 `.env` 中修正它，並在代理程式的資料夾中用 `docker compose up -d` 套用——請注意，新名稱會註冊一個新的儲存陣列。",
  "The command already carries your OneUptime URL, ingestion key and the platform you picked above. The script asks for:":
    "該指令已經帶有你的 OneUptime URL、擷取金鑰與你在上方選擇的平台。指令碼會詢問：",
  "Access from that machine to `quay.io`, where Docker pulls Pure's exporter image":
    "該機器能連到 `quay.io`，Docker 從那裡提取 Pure 的匯出器映像檔",
  "- `COMPOSE_PROFILES=flasharray-exporter` starts `pure-fa-exporter`, Pure's exporter, next to the collector; the two must match.":
    "- `COMPOSE_PROFILES=flasharray-exporter` 會在收集器旁邊啟動 Pure 的匯出器 `pure-fa-exporter`；兩者必須相符。",
  "`docker compose ps` in the agent's folder also lists **`pure-fa-exporter`**, Pure's exporter, which the collector reads the FlashArray through.":
    "在代理程式的資料夾中，`docker compose ps` 還會列出 **`pure-fa-exporter`**，即 Pure 的匯出器，收集器透過它讀取 FlashArray。",
  "- The collector reads the FlashArray through `pure-fa-exporter`, Pure's exporter, which logs in to the FlashArray's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- 收集器透過 Pure 的匯出器 `pure-fa-exporter` 讀取 FlashArray，匯出器使用收集器每次抓取時傳送的權杖登入 FlashArray 的 REST API。匯出器的連接埠只在 compose 網路內。",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach the FlashBlade's management address over HTTPS (TCP 443)":
    "Docker Engine 20.10 或更新版本及 Docker Compose v2 外掛程式，所在機器能透過 HTTPS（TCP 443）連到 FlashBlade 的管理位址",
  "An administrator account on the FlashBlade, to create the agent's read-only user":
    "FlashBlade 上的管理員帳戶，用於為代理程式建立唯讀使用者",
  "On the FlashBlade, as an administrator, create a user named `oneuptime` with the **readonly** role — in the FlashBlade GUI's user settings, or with `pureadmin` in the Purity//FB CLI — and create an **API token** for it. Create the token **without an expiry**, or the agent stops the day it expires.":
    "在 FlashBlade 上，以管理員身分建立一個名為 `oneuptime`、具有 **readonly** 角色的使用者（在 FlashBlade GUI 的使用者設定中，或在 Purity//FB CLI 中使用 `pureadmin`），並為它建立一個 **API 權杖**。建立權杖時請選擇 **永不過期**，否則代理程式會在權杖過期當天停止運作。",
  "FlashBlade API tokens start with `T-`. A Purity//FB release without local users takes a directory service (LDAP or Active Directory) account whose group maps to the readonly role instead.":
    "FlashBlade 的 API 權杖以 `T-` 開頭。沒有本機使用者的 Purity//FB 版本改用目錄服務（LDAP 或 Active Directory）帳戶，其所屬群組對應到 readonly 角色。",
  "- the FlashBlade's **management address** (host name or IP, no `https://`) and the read-only user's **API token**, which it reads without echoing":
    "- FlashBlade 的 **管理位址**（主機名稱或 IP，不加 `https://`）與唯讀使用者的 **API 權杖**，指令碼讀取權杖時不會回顯",
  "- Set `PURE_FB_ENDPOINT` to the FlashBlade's management address — host name or IP, no `https://` — and `PURE_FB_API_TOKEN` to the read-only user's API token. Run `chmod 600 .env`: it holds the token.":
    "- 將 `PURE_FB_ENDPOINT` 設為 FlashBlade 的管理位址（主機名稱或 IP，不加 `https://`），將 `PURE_FB_API_TOKEN` 設為唯讀使用者的 API 權杖。執行 `chmod 600 .env`：該檔案包含權杖。",
  "`docker compose ps` in the agent's folder also lists **`pure-fb-exporter`**, Pure's exporter, which the collector reads the FlashBlade through.":
    "在代理程式的資料夾中，`docker compose ps` 還會列出 **`pure-fb-exporter`**，即 Pure 的匯出器，收集器透過它讀取 FlashBlade。",
  "- The collector reads the FlashBlade through `pure-fb-exporter`, Pure's exporter, which logs in to the FlashBlade's REST API with the token the collector sends on every scrape. The exporter's port stays on the compose network.":
    "- 收集器透過 Pure 的匯出器 `pure-fb-exporter` 讀取 FlashBlade，匯出器使用收集器每次抓取時傳送的權杖登入 FlashBlade 的 REST API。匯出器的連接埠只在 compose 網路內。",
  "- **One scrape job per endpoint**, each read as often as it is worth: `/metrics/array` every 60 seconds; `/metrics/filesystems` and `/metrics/objectstore` every 5 minutes — the FlashBlade REST API is not built to report every file system and bucket quickly.":
    "- **每個端點一個抓取工作**，各依值得的頻率讀取：`/metrics/array` 每 60 秒一次；`/metrics/filesystems` 與 `/metrics/objectstore` 每 5 分鐘一次——FlashBlade REST API 並非為快速回報每個檔案系統與儲存貯體而設計。",
  "4. On the FlashBlade, as an administrator, add a syslog server `udp://<agent-host>:5514` (or `tcp://`) in its syslog settings.":
    "4. 在 FlashBlade 上，以管理員身分在其 syslog 設定中新增 syslog 伺服器 `udp://<agent-host>:5514`（或 `tcp://`）。",
  "Every value is a gauge the FlashBlade computes itself — latency per operation in microseconds, throughput per second. OneUptime's Storage Array pages, metric catalog and alert templates are built on:":
    "每個值都是 FlashBlade 自己計算的儀表值——延遲以每次操作的微秒計，輸送量以每秒計。OneUptime 的儲存陣列頁面、指標目錄與警示範本都以下列資料為基礎：",
  "| **Array** (`/metrics/array`) | `purefb_info`, capacity and data reduction (`purefb_array_space_*`), performance per protocol, open alerts (`purefb_alerts_open`), hardware health (`purefb_hardware_health`) |":
    "| **陣列**（`/metrics/array`） | `purefb_info`、容量與資料縮減（`purefb_array_space_*`）、各通訊協定的效能、未解決的警示（`purefb_alerts_open`）、硬體健康狀態（`purefb_hardware_health`） |",
  "| **File systems** (`/metrics/filesystems`) | Space, data reduction and performance per file system |":
    "| **檔案系統**（`/metrics/filesystems`） | 每個檔案系統的空間、資料縮減與效能 |",
  "| **Object store** (`/metrics/objectstore`) | Space, quota, object counts and performance per bucket |":
    "| **物件儲存**（`/metrics/objectstore`） | 每個儲存貯體的空間、配額、物件數與效能 |",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that reaches every node of the cluster on UDP 161 (SNMP)":
    "Docker Engine 20.10 或更新版本及 Docker Compose v2 外掛程式，所在機器能透過 UDP 161（SNMP）連到叢集的每個節點",
  "An administrator account on the cluster, to turn on SNMP and set the agent's read-only community or SNMPv3 user":
    "叢集上的管理員帳戶，用於啟用 SNMP 並為代理程式設定唯讀社群或 SNMPv3 使用者",
  "SSH to any node as an administrator: OneFS applies SNMP settings to the whole cluster. If the cluster already answers SNMP for another tool, give the agent the same community or user and skip this step. Otherwise, turn on SNMP v2c with a read-only community of your own, not OneFS's default `I$ilonpublic`:":
    "以管理員身分透過 SSH 登入任一節點：OneFS 會將 SNMP 設定套用到整個叢集。如果叢集已經為其他工具回應 SNMP，請為代理程式提供相同的社群或使用者，並跳過此步驟。否則，請使用你自己的唯讀社群啟用 SNMP v2c，不要使用 OneFS 預設的 `I$ilonpublic`：",
  "Or turn on SNMPv3, which authenticates and encrypts every poll. OneFS has one SNMPv3 read-only user, `general` until you rename it: give it passwords of at least eight characters, without spaces:":
    "或者啟用 SNMPv3，它會對每次輪詢進行驗證和加密。OneFS 只有一個 SNMPv3 唯讀使用者，在你重新命名之前名為 `general`：為它設定至少八個字元且不含空格的密碼：",
  "`isi snmp settings view` shows the settings, with the user's authentication and privacy protocols. Allow UDP 161 from the agent's machine to every node, and list the nodes' addresses with `isi network interfaces list`.":
    "`isi snmp settings view` 會顯示設定，包括該使用者的驗證通訊協定和隱私通訊協定。允許從代理程式所在機器到每個節點的 UDP 161，並用 `isi network interfaces list` 列出各節點的位址。",
  "- **every node's address**, separated by commas: each node's own address, never the SmartConnect zone name, since a node answers only for its own drives, sensors and ports":
    "- **每個節點的位址**，以逗號分隔：每個節點自己的位址，而不是 SmartConnect 區域名稱，因為節點只會為它自己的磁碟機、感應器和連接埠回應",
  "- the **SNMP version**, then the read-only **community**, or the SNMPv3 **user** and its two passwords, each read without echo":
    "- **SNMP 版本**，然後是唯讀**社群**，或 SNMPv3 **使用者**及其兩個密碼，指令碼讀取時都不會回顯",
  "A user whose protocols are not SHA and AES needs `POWERSCALE_SNMP_AUTH_PROTOCOL` and `POWERSCALE_SNMP_PRIVACY_PROTOCOL` in front of `bash install.sh`, and a user without privacy `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`.":
    "如果使用者的通訊協定不是 SHA 和 AES，需要在 `bash install.sh` 前加上 `POWERSCALE_SNMP_AUTH_PROTOCOL` 和 `POWERSCALE_SNMP_PRIVACY_PROTOCOL`；不使用隱私保護的使用者則需要加上 `POWERSCALE_SNMP_SECURITY_LEVEL=auth_no_priv`。",
  "It installs to `/opt/oneuptime-storage-array-agent`, writes a `.env` file only you can read (it holds the community or the SNMPv3 passwords), with one poll per node, and starts the agent with Docker Compose. When the cluster gains a node, add its address to `POWERSCALE_NODES` in that file and run `bash install.sh` again.":
    "它會安裝到 `/opt/oneuptime-storage-array-agent`，寫入一個只有你能讀取的 `.env` 檔案（其中包含社群或 SNMPv3 密碼），每個節點一項輪詢，並用 Docker Compose 啟動代理程式。叢集新增節點時，請將其位址加到該檔案的 `POWERSCALE_NODES` 中，然後再次執行 `bash install.sh`。",
  "- Replace `my-storage-array` with a name for this cluster, such as `ps-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new storage array.":
    "- 將 `my-storage-array` 替換為此叢集的名稱，例如 `ps-prod`。叢集在 OneUptime 中就以此名稱顯示，所以請保持不變：新名稱會註冊一個新的儲存陣列。",
  "- List every node in `POWERSCALE_NODES` and give each its own `POWERSCALE_NODE_<n>` and `snmp/node-<n>` in `POWERSCALE_SNMP_RECEIVERS`, up to 252, after `snmp/cluster` and `snmp/quotas`. An IPv6 address goes in brackets, such as `[fd00::11]`.":
    "- 在 `POWERSCALE_NODES` 中列出每個節點，並為每個節點指派各自的 `POWERSCALE_NODE_<n>`，以及在 `POWERSCALE_SNMP_RECEIVERS` 中 `snmp/cluster` 和 `snmp/quotas` 之後的各自的 `snmp/node-<n>`，最多 252 個。IPv6 位址要放在方括號中，例如 `[fd00::11]`。",
  "- For SNMPv3, set `POWERSCALE_SNMP_VERSION=v3`, `POWERSCALE_SNMP_USER`, `POWERSCALE_SNMP_AUTH_PASSWORD` and `POWERSCALE_SNMP_PRIVACY_PASSWORD` instead of the community. Run `chmod 600 .env`: it holds the community or the passwords.":
    "- 對於 SNMPv3，請設定 `POWERSCALE_SNMP_VERSION=v3`、`POWERSCALE_SNMP_USER`、`POWERSCALE_SNMP_AUTH_PASSWORD` 和 `POWERSCALE_SNMP_PRIVACY_PASSWORD`，而不是社群。執行 `chmod 600 .env`：該檔案包含社群或密碼。",
  "| `STORAGE_ARRAY_NAME` | Yes | The name this cluster registers under in OneUptime, stamped on every metric as `storage.array.name`. Keep it stable — changing it registers a new storage array |":
    "| `STORAGE_ARRAY_NAME` | 是 | 此叢集在 OneUptime 中註冊所用的名稱，以 `storage.array.name` 標記在每個指標上。請保持不變：變更它會註冊一個新的儲存陣列 |",
  "| `STORAGE_SYSTEM` | Yes | `dell.powerscale` |":
    "| `STORAGE_SYSTEM` | 是 | `dell.powerscale` |",
  "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | Yes | `otel-collector-config.powerscale.yaml` |":
    "| `STORAGE_ARRAY_COLLECTOR_CONFIG` | 是 | `otel-collector-config.powerscale.yaml` |",
  "| `POWERSCALE_NODES` | Yes | Every node's address, separated by commas. The install script writes the polls below from it |":
    "| `POWERSCALE_NODES` | 是 | 每個節點的位址，以逗號分隔。安裝指令碼據此寫入下面的輪詢 |",
  "| `POWERSCALE_ENDPOINT` | Yes | The node the cluster's own health, capacity and quotas are read through: the first in `POWERSCALE_NODES` |":
    "| `POWERSCALE_ENDPOINT` | 是 | 讀取叢集本身健康狀況、容量和配額所經由的節點：`POWERSCALE_NODES` 中的第一個 |",
  "| `POWERSCALE_SNMP_RECEIVERS` | Yes | The polls the collector runs: `snmp/cluster`, `snmp/quotas`, then `snmp/node-<n>` for each node |":
    "| `POWERSCALE_SNMP_RECEIVERS` | 是 | 收集器執行的輪詢：`snmp/cluster`、`snmp/quotas`，然後是每個節點的 `snmp/node-<n>` |",
  "| `POWERSCALE_NODE_<n>` | Yes | Node `<n>`'s address, from 1 to 252 |":
    "| `POWERSCALE_NODE_<n>` | 是 | 節點 `<n>` 的位址，從 1 到 252 |",
  "| `POWERSCALE_SNMP_VERSION` | No | `v2c` (default) or `v3` |":
    "| `POWERSCALE_SNMP_VERSION` | 否 | `v2c`（預設）或 `v3` |",
  "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | The cluster's read-only community |":
    "| `POWERSCALE_SNMP_COMMUNITY` | SNMP v2c | 叢集的唯讀社群 |",
  "| `POWERSCALE_SNMP_USER` | SNMPv3 | The cluster's SNMPv3 read-only user |":
    "| `POWERSCALE_SNMP_USER` | SNMPv3 | 叢集的 SNMPv3 唯讀使用者 |",
  "| `POWERSCALE_SNMP_SECURITY_LEVEL` | No | `auth_priv` (default), `auth_no_priv` or `no_auth_no_priv` |":
    "| `POWERSCALE_SNMP_SECURITY_LEVEL` | 否 | `auth_priv`（預設）、`auth_no_priv` 或 `no_auth_no_priv` |",
  "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | No | `SHA` (default), `MD5`, `SHA224`, `SHA256`, `SHA384` or `SHA512` |":
    "| `POWERSCALE_SNMP_AUTH_PROTOCOL` | 否 | `SHA`（預設）、`MD5`、`SHA224`、`SHA256`、`SHA384` 或 `SHA512` |",
  "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | The SNMPv3 user's authentication password |":
    "| `POWERSCALE_SNMP_AUTH_PASSWORD` | SNMPv3 | SNMPv3 使用者的驗證密碼 |",
  "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | No | `AES` (default), `DES`, `AES192`, `AES256`, `AES192C` or `AES256C` |":
    "| `POWERSCALE_SNMP_PRIVACY_PROTOCOL` | 否 | `AES`（預設）、`DES`、`AES192`、`AES256`、`AES192C` 或 `AES256C` |",
  "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | The SNMPv3 user's privacy password |":
    "| `POWERSCALE_SNMP_PRIVACY_PASSWORD` | SNMPv3 | SNMPv3 使用者的隱私密碼 |",
  "- **One collector, no exporter.** The collector's own SNMP receiver reads Dell's ISILON-MIB; nothing else runs beside it.":
    "- **一個收集器，沒有匯出器。** 收集器內建的 SNMP 接收器讀取 Dell 的 ISILON-MIB；旁邊不執行任何其他元件。",
  "- **The cluster's objects once, through `POWERSCALE_ENDPOINT`:** its health, capacity, throughput and node counts every 60 seconds (`snmp/cluster`), and its SmartQuotas every 5 minutes (`snmp/quotas`).":
    "- **叢集的物件透過 `POWERSCALE_ENDPOINT` 讀取一次：** 每 60 秒讀取其健康狀況、容量、輸送量和節點數（`snmp/cluster`），每 5 分鐘讀取其 SmartQuotas（`snmp/quotas`）。",
  "- **Each node's from the node:** its health, CPU, protocol performance, drives, sensors and ports every 60 seconds (`snmp/node-<n>`).":
    "- **每個節點的物件從該節點本身讀取：** 每 60 秒讀取其健康狀況、CPU、通訊協定效能、磁碟機、感應器和連接埠（`snmp/node-<n>`）。",
  "- **Every poll labels its series `scrape_endpoint: <poll>`**, so OneUptime knows which objects a batch is the complete list of — that is how a deleted quota leaves the inventory. Keep the labels as shipped.":
    "- **每次輪詢都為自己的序列加上標籤 `scrape_endpoint: <poll>`**，讓 OneUptime 知道一個批次是哪些物件的完整列表——已刪除的配額正是這樣離開資產清單的。請讓標籤保持隨附時的樣子。",
  "The full config, one SNMP receiver per node slot, is `otel-collector-config.powerscale.yaml` in the agent's folder:":
    "完整組態為代理程式資料夾中的 `otel-collector-config.powerscale.yaml`，每個節點欄位一個 SNMP 接收器：",
  "Then turn SNMP off on the cluster, or change the agent's community or SNMPv3 passwords, if nothing else polls it.":
    "如果沒有其他工具輪詢該叢集，再在叢集上關閉 SNMP，或變更代理程式的社群或 SNMPv3 密碼。",
  "`troubleshoot.sh` checks the whole chain — the container runtime, the node addresses and the community or SNMPv3 user in `.env`, each node with `snmpget` when the machine has it, array-name stamping, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key.":
    "`troubleshoot.sh` 會檢查整條鏈路（容器執行階段、`.env` 中的節點位址和社群或 SNMPv3 使用者、機器上有 `snmpget` 時用它檢查每個節點、陣列名稱標記、收集器本身的指標），並直接詢問 OneUptime 是否接受你的擷取金鑰。",
  "`Error scraping metrics` with `request timeout` in `docker logs oneuptime-storage-array-agent` names a node that does not answer SNMP from this machine: SNMP is off for the version the agent uses, the community or SNMPv3 user is not the cluster's, or UDP 161 is blocked on the way. A node that answers but is missing from the cluster's nodes is not in `POWERSCALE_NODES`: add it and run `bash install.sh` again.":
    "`docker logs oneuptime-storage-array-agent` 中帶有 `request timeout` 的 `Error scraping metrics` 指出了一個對來自這台機器的 SNMP 沒有回應的節點：代理程式所用版本的 SNMP 已關閉、社群或 SNMPv3 使用者不屬於該叢集，或者 UDP 161 在途中遭到封鎖。能回應卻不在叢集節點中的節點，就是不在 `POWERSCALE_NODES` 中：加入它，然後再次執行 `bash install.sh`。",
};

export default TRANSLATION;
