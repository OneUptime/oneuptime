import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Ceph setup guide in Traditional Chinese (#8341): each piece of the English
 * guide's markdown (Pages/Ceph/Utils/DocumentationMarkdown.ts) and its
 * Traditional Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Traditional Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach your Ceph mgr daemons on port 9283":
    "Docker Engine 20.10 或更新版本及 Docker Compose v2 外掛程式，所在機器能透過連接埠 9283 連到你的 Ceph mgr 常駐程式",
  "A shell on a Ceph admin node, where the `ceph` CLI works with admin rights":
    "Ceph 管理節點上的命令列終端機，其中 `ceph` CLI 能以系統管理員權限執行",
  "Then list your mgr daemons — the agent needs **all** of them, active and standbys:":
    "然後列出你的 mgr 常駐程式。代理程式需要**全部**常駐程式，包括使用中的與待命的：",
  "Only the **active** mgr returns metrics — standbys answer with an empty response — so scraping every mgr keeps metrics flowing when the active one fails over.":
    "只有**使用中**的 mgr 會傳回指標（待命的 mgr 傳回空白回應），因此抓取每個 mgr，可在使用中的 mgr 容錯移轉時讓指標持續流入。",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "指令碼會詢問你的 OneUptime URL 和擷取金鑰，兩者都顯示在第 1 步中（在那裡選擇一個金鑰即可在此處填好），然後詢問：",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **叢集名稱**：叢集在 OneUptime 中顯示的名稱。為每個叢集取一個獨立的名稱並保持不變：新名稱會註冊一個新叢集。",
  "- **Mgr endpoints** — every mgr from the previous step as comma-separated `host:port`, e.g. `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`. The script adds the square brackets.":
    "- **mgr 端點**：上一步中的每個 mgr，以逗號分隔的 `host:port` 形式填寫，例如 `ceph-mon-1:9283,ceph-mon-2:9283,ceph-mon-3:9283`。指令碼會加上方括號。",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only. Where `ceph` works with admin rights, the script also offers to create the AI agent's own Ceph client.":
    "- **OneUptime AI 代理程式**：是否允許它套用修復；回答 **N** 可讓它保持唯讀。在 `ceph` 能以系統管理員權限執行的地方，指令碼也會提議為 AI 代理程式建立它自己的 Ceph 用戶端。",
  "It installs to `/opt/oneuptime-ceph-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "它會安裝到 `/opt/oneuptime-ceph-agent`，寫入一個權限為 `0600` 的 `.env` 檔案，並用 Docker Compose 啟動代理程式。再次執行指令碼會沿用該 `.env` 中的所有內容而不再詢問，所以升級也是這樣做的。",
  "Look for `Everything is ready. Begin running and processing data.` in the logs. The cluster then appears automatically in the **Ceph** section, usually within a minute or so.":
    "在日誌中尋找 `Everything is ready. Begin running and processing data.`。之後叢集會自動出現在 **Ceph** 區段，通常在一分鐘左右。",
  "Docker Compose also runs **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. If the install script created its Ceph client it is already working; otherwise it waits for one — see **OneUptime AI agent** under Advanced.":
    "Docker Compose 也會執行 **`oneuptime-ceph-ai-agent`**，也就是 OneUptime AI 代理程式。如果安裝指令碼建立了它的 Ceph 用戶端，它已經在運作；否則它會等待用戶端——請參閱「進階」中的 **OneUptime AI 代理程式**。",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: once it has its Ceph client, it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `ceph` commands, and changes nothing unless you allow fixes.":
    "**OneUptime AI 代理程式（預設開啟，唯讀）。** AI 調查已開啟：一旦它有了 Ceph 用戶端，就會讓 OneUptime AI 使用唯讀的 `ceph` 指令調查此叢集上的事件與警示，除非你允許修復，否則不會做任何變更。",
  "The install script writes these to `/opt/oneuptime-ceph-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent`.":
    "安裝指令碼會把這些寫入 `/opt/oneuptime-ceph-agent/.env`。變更其中任何一項後，在 `/opt/oneuptime-ceph-agent` 中用 `docker compose up -d` 套用。",
  "| Variable | Required | Description |": "| 變數 | 必填 | 說明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 執行個體 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 是 | 遙測擷取金鑰，即第 1 步中選擇的那個 |",
  "| `CEPH_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `ceph.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `ceph`) |":
    "| `CEPH_CLUSTER_NAME` | 是 | 在 OneUptime 中顯示的叢集識別碼。以資源屬性 `ceph.cluster.name` 標記在每個指標上。請保持不變：變更它會註冊一個新叢集（預設：`ceph`） |",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]`. The install script adds the brackets for you |":
    "| `CEPH_MGR_ENDPOINTS` | 是 | **全部** mgr 常駐程式的 `host:port` 清單，以逗號分隔並用方括號括起來，例如 `[ceph-mon-1:9283,ceph-mon-2:9283]`。安裝指令碼會為你加上方括號 |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI 代理程式本身的設定請見 **OneUptime AI 代理程式** 一節。",
  "- **All mgrs are scraped** (active and standbys), so metrics survive an active-mgr failover.":
    "- **抓取所有 mgr**（使用中的與待命的），因此指標能撐過使用中 mgr 的容錯移轉。",
  "- **Every 30 seconds.** The mgr prometheus module caches a scrape for `mgr/prometheus/scrape_interval` (15 seconds by default) — never scrape more often than that, you would only re-read the cache.":
    "- **每 30 秒一次。** mgr 的 prometheus 模組會將一次抓取快取 `mgr/prometheus/scrape_interval`（預設 15 秒）：抓取頻率不要高於此值，否則只會重複讀取快取。",
  "- **`honor_labels: true`** keeps the labels Ceph exports (`ceph_daemon`, `pool_id`) as they are, so series stay continuous across mgr failovers.":
    "- **`honor_labels: true`** 會原樣保留 Ceph 匯出的標籤（`ceph_daemon`、`pool_id`），因此序列在 mgr 容錯移轉期間保持連續。",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values:":
    "這是代理程式執行的完整 `otel-collector-config.yaml`；`.env` 檔案提供 `${env:...}` 的值：",
  "The agent can tail `/var/log/ceph/ceph.log` and ship it to OneUptime, which fills the **Cluster Log** page. It is off by default because the agent must run on a host that has the cluster log — a mon host by default.":
    "代理程式可以追蹤 `/var/log/ceph/ceph.log` 並傳送到 OneUptime，藉此填入 **叢集日誌** 頁面。此功能預設關閉，因為代理程式必須在擁有叢集日誌的主機上執行，預設是 mon 主機。",
  "1. In `otel-collector-config.yaml`, uncomment the `filelog` receiver and the `logs` pipeline.":
    "1. 在 `otel-collector-config.yaml` 中，取消註解 `filelog` 接收器與 `logs` 管線。",
  "2. In `docker-compose.yml`, uncomment the `/var/log/ceph:/var/log/ceph:ro` volume.":
    "2. 在 `docker-compose.yml` 中，取消註解 `/var/log/ceph:/var/log/ceph:ro` 磁碟區。",
  "3. Apply both:": "3. 套用這兩項變更：",
  "Lines ship verbatim; OneUptime parses the ceph.log format (timestamp, daemon, INF/WRN/ERR level, message) when it reads them, and the `resource` processor stamps `ceph.cluster.name` so the log lands on this cluster.":
    "日誌行會原樣傳送；OneUptime 在讀取時會解析 ceph.log 格式（時間戳記、常駐程式、INF/WRN/ERR 層級、訊息），`resource` 處理器會標記 `ceph.cluster.name`，讓日誌落在此叢集上。",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `ceph.cluster.name`:":
    "任何帶有 `oneuptime.label.` 前置詞的資源屬性都會成為叢集上的專案標籤：`oneuptime.label.<dimension>=<value>` 即標籤 `<dimension>:<value>`。將它們加入 `otel-collector-config.yaml` 的 `resource` 處理器中，放在 `ceph.cluster.name` 旁邊：",
  "Then restart the collector so it reads the new config:":
    "然後重新啟動收集器，讓它讀取新組態：",
  "The cluster shows up tagged `team:storage` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "叢集會帶著 `team:storage` 與 `env:production` 標籤出現。標籤比對不區分大小寫，因此會重複使用現有的 `Production` 標籤；在 OneUptime 介面中新增的標籤絕不會被代理程式移除。",
  "The agent ships everything the mgr prometheus module exports. OneUptime's Ceph pages, metric catalog and alert templates are built on:":
    "代理程式會傳送 mgr 的 prometheus 模組匯出的所有內容。OneUptime 的 Ceph 頁面、指標目錄與警示範本是根據：",
  "| Category | Data |": "| 類別 | 資料 |",
  "| **Cluster Health** | `ceph_health_status` (0 = OK, 1 = WARN, 2 = ERR), monitor quorum, total and used raw capacity |":
    "| **叢集健康狀況** | `ceph_health_status`（0 = OK，1 = WARN，2 = ERR）、監視器仲裁、總原始容量與已用原始容量 |",
  "| **OSD** | Up / in state for every OSD (per `ceph_daemon` label, e.g. `osd.3`) |":
    "| **OSD** | 每個 OSD 的 up / in 狀態（依 `ceph_daemon` 標籤，例如 `osd.3`） |",
  "| **Pool** | Stored bytes, max available, object counts, read/write operations and throughput per pool |":
    "| **儲存池** | 每個儲存池的已儲存位元組、最大可用量、物件數、讀取/寫入作業數與輸送量 |",
  "| **Placement Groups** | Active, degraded, and undersized PG counts |":
    "| **Placement Group** | 使用中、降級與副本不足的 PG 數量 |",
  "`docker-compose.yml` also runs **`oneuptime-ceph-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs `ceph` commands through it — `ceph health detail`, `ceph osd tree`, `ceph pg dump_stuck`, `ceph crash ls`. It registers as the cluster named `CEPH_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` 也會執行 **`oneuptime-ceph-ai-agent`**。當 OneUptime AI 調查此叢集上的事件或警示時，會透過它執行 `ceph` 指令：`ceph health detail`、`ceph osd tree`、`ceph pg dump_stuck`、`ceph crash ls`。它會註冊為名為 `CEPH_CLUSTER_NAME` 的叢集，並顯示在叢集的 **人工智慧 → AI 代理程式** 頁面上。",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. The install script offers to create them on a fresh install, when `ceph` works with admin rights on the machine you run it on. Otherwise, or to add them later, on a Ceph admin node:":
    "它以自己的 Ceph 用戶端 `client.oneuptime-ai` 連線，使用叢集的最精簡 `ceph.conf` 與該用戶端的金鑰環，兩者放在 `docker-compose.yml` 旁邊的 `ceph/` 資料夾中。全新安裝時，如果 `ceph` 在你執行指令碼的機器上能以系統管理員權限執行，安裝指令碼會提議建立它們。否則，或要稍後再加入它們，請在 Ceph 管理節點上執行：",
  "If the agent runs on another machine, copy the two files into its `ceph/` folder the same way. **Never put the admin keyring there.**":
    "如果代理程式在另一台機器上執行，請用同樣的方式把這兩個檔案複製到它的 `ceph/` 資料夾中。**切勿把系統管理員的金鑰環放在那裡。**",
  "- **The client's caps are the hard limit.** With these read caps nothing it runs can change the cluster. Fixes — marking an OSD back in, clearing `noout` — also need `ONEUPTIME_AI_ALLOW_WRITES=true` in `.env` and the fixes caps from the agent's README.":
    "- **用戶端的 caps 是硬性上限。** 有了這些讀取 caps，它執行的任何指令都無法變更叢集。修復（把 OSD 重新標記為 in、清除 `noout`）還需要 `.env` 中的 `ONEUPTIME_AI_ALLOW_WRITES=true`，以及代理程式 README 中的修復 caps。",
  "- Check it: `docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- 檢查它：`docker exec oneuptime-ceph-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-ceph-ai-agent` service from `docker-compose.yml`.":
    "- 不使用 OneUptime AI？從 `docker-compose.yml` 中刪除 `oneuptime-ceph-ai-agent` 服務。",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#ceph-clusters).":
    "它可以執行什麼，以及修復如何運作：[基礎架構 AI 代理程式](/docs/ai/infrastructure-ai-agents#ceph-clusters)。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them. The AI agent's `ceph/` folder stays as it is:":
    "**升級**——收集器映像檔固定在 `docker-compose.yml` 中，其組態是旁邊的一個檔案，所以只提取映像檔並不會讓代理程式更新。請再次執行安裝指令碼。它會沿用你現有 `.env` 中的每個值（不會再詢問任何內容），下載最新的 `docker-compose.yml` 與 `otel-collector-config.yaml`（你編輯過的檔案會以 `<file>.bak.<timestamp>` 保留在新檔案旁邊），提取映像檔並用它們重新建立代理程式。AI 代理程式的 `ceph/` 資料夾保持不變：",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "該組態會把它固定的收集器版本回報為叢集的 **代理程式版本**。當此 OneUptime 固定了較新的版本時，旁邊的警告標誌會開啟這些指令。",
  "**Uninstall** the agent:": "**解除安裝**代理程式：",
  "If you created the AI agent's Ceph client, remove it on an admin node: `ceph auth del client.oneuptime-ai`.":
    "如果你建立了 AI 代理程式的 Ceph 用戶端，請在管理節點上移除它：`ceph auth del client.oneuptime-ai`。",
  "`troubleshoot.sh` checks the whole chain — container runtime, every mgr endpoint (including the active-vs-standby trap), cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` 會檢查整條鏈路（容器執行階段、每個 mgr 端點及其中使用中與待命的陷阱、叢集名稱標記、權杖格式、收集器本身的指標），並直接詢問 OneUptime 是否接受你的擷取金鑰。最後一項檢查最重要：OneUptime 的 OTLP 端點會以 `401` 或 `422` 拒絕錯誤的金鑰，而收集器只會為每個批次記錄一行很容易被忽略的 `Exporting failed`，所以指令碼會向 `GET /otlp/v1/validate` 要求直接的 200/401 判定。",
  "It ends with a verdict naming the most likely cause.":
    "最後它會給出判定，指出最可能的原因。",
  "1. Check the collector logs: `docker logs oneuptime-ceph-agent` — look for export errors (`401` means a bad ingestion key, connection refused means a wrong `ONEUPTIME_URL`).":
    "1. 檢查收集器日誌：`docker logs oneuptime-ceph-agent`，尋找匯出錯誤（`401` 表示擷取金鑰錯誤，連線遭拒表示 `ONEUPTIME_URL` 錯誤）。",
  "2. Verify a mgr endpoint serves metrics: `curl http://<active-mgr>:9283/metrics | head` — you should see `ceph_*` metric lines. If not, enable the module: `ceph mgr module enable prometheus`.":
    "2. 確認 mgr 端點有提供指標：`curl http://<active-mgr>:9283/metrics | head`，你應該會看到 `ceph_*` 指標行。如果沒有，請啟用該模組：`ceph mgr module enable prometheus`。",
  "3. Make sure `CEPH_MGR_ENDPOINTS` is wrapped in square brackets — without them the collector treats the whole comma-separated string as a single (invalid) target.":
    "3. 確定 `CEPH_MGR_ENDPOINTS` 用方括號括起來：沒有方括號時，收集器會把整個以逗號分隔的字串當成單一（無效的）目標。",
  "1. Check that the agent is running: `docker ps --filter name=oneuptime-ceph-agent`":
    "1. 檢查代理程式是否正在執行：`docker ps --filter name=oneuptime-ceph-agent`",
  "2. Check the agent logs for errors: `docker logs oneuptime-ceph-agent 2>&1 | grep -i error`":
    "2. 檢查代理程式日誌中的錯誤：`docker logs oneuptime-ceph-agent 2>&1 | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. 確認你的 OneUptime URL 與擷取金鑰正確。",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. 確定代理程式所在的機器能透過網路連到 OneUptime 執行個體。",
  "You are probably scraping only the (previously) active mgr. List **every** mgr daemon in `CEPH_MGR_ENDPOINTS` — scrapes of standby mgrs are cheap and return empty responses.":
    "你可能只抓取了（先前的）使用中 mgr。在 `CEPH_MGR_ENDPOINTS` 中列出**每一個** mgr 常駐程式：抓取待命 mgr 的成本很低，而且會傳回空白回應。",
  "Expected if `mgr/prometheus/standby_behaviour` is set to `error` on your cluster — standbys then answer with HTTP 500. The active mgr's scrape still succeeds, so the errors are noise; switch the behaviour back to `default` to silence them.":
    "如果你的叢集將 `mgr/prometheus/standby_behaviour` 設為 `error`，這是預期中的行為：此時待命 mgr 會以 HTTP 500 回應。使用中 mgr 的抓取仍會成功，所以這些錯誤只是雜訊；把該行為改回 `default` 即可讓它們消失。",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "叢集的身分來自 `CEPH_CLUSTER_NAME`，它以 `ceph.cluster.name` 標記在每個指標上。在 `.env` 中修正它，並在 `/opt/oneuptime-ceph-agent` 中用 `docker compose up -d` 套用——請注意，新名稱會註冊一個新叢集。",
  "- **Cluster name** — enter **`ceph-1`** exactly; a different name registers a new cluster.":
    "- **叢集名稱**：準確輸入 **`ceph-1`**；不同的名稱會註冊一個新叢集。",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-ceph-agent` — note that a new name registers a new cluster.":
    "叢集的身分來自 `CEPH_CLUSTER_NAME`，它以 `ceph.cluster.name` 標記在每個指標上。此叢集是 **`ceph-1`**。在 `.env` 中修正它，並在 `/opt/oneuptime-ceph-agent` 中用 `docker compose up -d` 套用——請注意，新名稱會註冊一個新叢集。",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "該指令已經帶有你的 OneUptime URL 與擷取金鑰。其餘內容由指令碼詢問：",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "從此 OneUptime 下載 `docker-compose.yml` 與 `otel-collector-config.yaml` 到一個新資料夾：",
  "Create a `.env` file next to them:": "在它們旁邊建立一個 `.env` 檔案：",
  "- Replace `my-ceph-cluster` with a name for this cluster, such as `ceph-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- 將 `my-ceph-cluster` 換成此叢集的名稱，例如 `ceph-prod`。叢集在 OneUptime 中就以此名稱顯示，所以請保持不變：新名稱會註冊一個新叢集。",
  "- List **every** mgr daemon in `CEPH_MGR_ENDPOINTS`, comma-separated and wrapped in square brackets — without the brackets the collector reads the whole list as one invalid target.":
    "- 在 `CEPH_MGR_ENDPOINTS` 中列出**每一個** mgr 常駐程式，以逗號分隔並用方括號括起來——沒有方括號時，收集器會把整份清單當成一個無效目標讀取。",
  "Start the agent:": "啟動代理程式：",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中選擇一個擷取金鑰，以填入 `<YOUR_API_KEY>`。",
  "Docker Compose also starts **`oneuptime-ceph-ai-agent`**, the OneUptime AI agent. It waits for a Ceph client of its own — see **OneUptime AI agent** under Advanced, or delete its service from `docker-compose.yml` if you do not use OneUptime AI.":
    "Docker Compose 也會啟動 **`oneuptime-ceph-ai-agent`**，也就是 OneUptime AI 代理程式。它會等待屬於自己的 Ceph 用戶端——請參閱「進階」中的 **OneUptime AI 代理程式**；如果你不使用 OneUptime AI，也可以從 `docker-compose.yml` 中刪除它的服務。",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "代理程式從 `docker-compose.yml` 旁邊的 `.env` 檔案讀取這些值。變更其中任何一項後，在 `docker-compose.yml` 所在的資料夾中用 `docker compose up -d` 套用。",
  "| `CEPH_MGR_ENDPOINTS` | Yes | Comma-separated `host:port` list of **all** mgr daemons, wrapped in square brackets, e.g. `[ceph-mon-1:9283,ceph-mon-2:9283]` |":
    "| `CEPH_MGR_ENDPOINTS` | 是 | **全部** mgr 常駐程式的 `host:port` 清單，以逗號分隔並用方括號括起來，例如 `[ceph-mon-1:9283,ceph-mon-2:9283]` |",
  "It connects as its own Ceph client, `client.oneuptime-ai`, with the cluster's minimal `ceph.conf` and that client's keyring in a `ceph/` folder next to `docker-compose.yml`. On a Ceph admin node, in the agent's folder:":
    "它以自己的 Ceph 用戶端 `client.oneuptime-ai` 連線，使用叢集的最精簡 `ceph.conf` 與該用戶端的金鑰環，兩者放在 `docker-compose.yml` 旁邊的 `ceph/` 資料夾中。在 Ceph 管理節點上，於代理程式的資料夾中執行：",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "在代理程式的資料夾（也就是 `docker-compose.yml` 所在的資料夾）中執行這些指令。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**升級**——收集器映像檔固定在 `docker-compose.yml` 中，其組態是旁邊的一個檔案，所以只提取映像檔並不會讓代理程式更新。請重新下載這兩個檔案；你的 `.env` 會保留，而你對其中任一檔案做過的變更需要重做一次：",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "然後提取映像檔並重新建立代理程式，讓收集器讀取新組態：",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "叢集的身分來自 `CEPH_CLUSTER_NAME`，它以 `ceph.cluster.name` 標記在每個指標上。在 `.env` 中修正它，並在 `docker-compose.yml` 所在的資料夾中用 `docker compose up -d` 套用——請注意，新名稱會註冊一個新叢集。",
  "- This installs the agent for **`ceph-1`** — keep `CEPH_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- 這會為 **`ceph-1`** 安裝代理程式——請讓 `CEPH_CLUSTER_NAME` 保持原樣，否則資料會註冊為一個新叢集。",
  "The cluster's identity comes from `CEPH_CLUSTER_NAME`, stamped on every metric as `ceph.cluster.name`. This cluster is **`ceph-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "叢集的身分來自 `CEPH_CLUSTER_NAME`，它以 `ceph.cluster.name` 標記在每個指標上。此叢集是 **`ceph-1`**。在 `.env` 中修正它，並在 `docker-compose.yml` 所在的資料夾中用 `docker compose up -d` 套用——請注意，新名稱會註冊一個新叢集。",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `CEPH_AGENT_CONTAINER_NAME` | 否 | 收集器的容器名稱（預設：`oneuptime-ceph-agent`）。同一台機器上第二個叢集的代理程式需要自己的容器名稱：除非你自行設定，否則安裝指令碼會依新代理程式的資料夾為其容器命名，並在你再次執行指令碼時保留這些名稱 |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-ceph-ai-agent-cluster2` beside `oneuptime-ceph-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | 否 | AI 代理程式的容器名稱（預設：`oneuptime-ceph-ai-agent`）。除非你自行設定，否則安裝指令碼會依第二個叢集的收集器為其 AI 代理程式命名（`oneuptime-ceph-ai-agent-cluster2` 與 `oneuptime-ceph-agent-cluster2` 並列），並在你再次執行指令碼時保留該名稱 |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "一個代理程式讀取一個叢集。若要讀取第二個叢集，請在獨立的資料夾中安裝第二個代理程式，並使用它自己的容器名稱——兩個容器不能共用一個名稱：",
  "The script names the containers after the folder, such as `oneuptime-ceph-agent-cluster2`, unless you set their variables, such as `CEPH_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "除非你設定它們的變數（例如 `CEPH_AGENT_CONTAINER_NAME`），否則指令碼會依資料夾為容器命名，例如 `oneuptime-ceph-agent-cluster2`。它會把名稱保存在該代理程式的 `.env` 中，所以用同一個 `INSTALL_DIR` 再次執行指令碼來升級代理程式時會保留這些名稱；而你曾在 `docker-compose.yml` 中編輯過 `container_name` 的代理程式，也會保留那個名稱。",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "請為每個資料夾取一個獨有的名稱：Docker Compose 只依資料夾為專案命名，因此如果某個資料夾與別處已在執行代理程式的資料夾同名，指令碼會拒絕它。用 `-d` 把資料夾傳給診斷指令碼。",
  "| `CEPH_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-ceph-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AGENT_CONTAINER_NAME` | 否 | 收集器的容器名稱（預設：`oneuptime-ceph-agent`）。同一台機器上第二個叢集的代理程式需要自己的容器名稱 |",
  "| `CEPH_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-ceph-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `CEPH_AI_AGENT_CONTAINER_NAME` | 否 | AI 代理程式的容器名稱（預設：`oneuptime-ceph-ai-agent`）。同一台機器上第二個叢集的代理程式需要自己的容器名稱 |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "一個代理程式讀取一個叢集。若要讀取第二個叢集，請在獨立的資料夾中設定第二個代理程式，並使用它自己的容器名稱——兩個容器不能共用一個名稱。請在該代理程式的 `.env` 中設定這些名稱：",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "請為每個資料夾取一個獨有的名稱：Docker Compose 只依資料夾為專案命名，因此同名的第二個資料夾會取代第一個代理程式的容器。不要把這些名稱寫進 `docker-compose.yml`，升級會取代該檔案。",
};

export default TRANSLATION;
