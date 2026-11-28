import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Proxmox setup guide in Traditional Chinese (#8341): each piece of the English
 * guide's markdown (Pages/Proxmox/Utils/DocumentationMarkdown.ts) and its
 * Traditional Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Traditional Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach every node's Proxmox VE API on port 8006":
    "Docker Engine 20.10 或更新版本及 Docker Compose v2 外掛程式，所在機器能透過連接埠 8006 連到每個節點的 Proxmox VE API",
  "A root shell on any PVE node, or the Proxmox web UI, to create a read-only API token":
    "任一 PVE 節點上的 root shell，或 Proxmox Web 介面，用來建立唯讀 API 權杖",
  "Ideally a machine outside the cluster, or a VM that Proxmox HA restarts on another node — the agent reads the cluster from another node when one goes down, but not when its own machine does":
    "最好是叢集外的機器，或由 Proxmox HA 在另一個節點上重新啟動的虛擬機器——某個節點停機時，代理程式會從另一個節點讀取叢集，但代理程式自己的機器停機時就無法這麼做",
  "As root on any PVE node:": "在任一 PVE 節點上以 root 身分執行：",
  "- The first line only fails, harmlessly, if `monitoring@pam` already exists. API tokens carry their own secret, so the user needs no password or system account.":
    "- 只有當 `monitoring@pam` 已存在時，第一行才會失敗，且不會造成影響。API 權杖有自己的祕密，因此該使用者不需要密碼或系統帳戶。",
  "- `pveum user token add` prints the token secret — copy it now, it is shown only once. The token id is `monitoring@pam!oneuptime`.":
    "- `pveum user token add` 會印出權杖的祕密——請立即複製，它只會顯示一次。權杖 ID 是 `monitoring@pam!oneuptime`。",
  "- The role goes on the user as well as the token because a privilege-separated token only gets the permissions its user also has. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "- 角色要同時授予使用者和權杖，因為權限分離的權杖只能取得其使用者同樣擁有的權限。角色必須位於根路徑 `/`：pve-exporter 會讀取整個叢集的狀態，限定在子路徑上的權杖會以 `Permission check failed (/, Sys.Audit)` 失敗。",
  "1. Go to *Datacenter → Permissions → API Tokens* and click **Add**.":
    "1. 前往 *Datacenter → Permissions → API Tokens* 並按一下 **Add**。",
  "2. Pick (or create) a user, give the token an ID like `oneuptime`, make sure **Privilege Separation** is checked, and click **Add**.":
    "2. 選擇（或建立）一個使用者，為權杖指定一個 ID（例如 `oneuptime`），確認已勾選 **Privilege Separation**，然後按一下 **Add**。",
  "3. Copy the token id (`user@realm!tokenname`) and the secret — the secret is shown only once.":
    "3. 複製權杖 ID（`user@realm!tokenname`）和祕密——祕密只會顯示一次。",
  "4. Under *Datacenter → Permissions*, click **Add** twice to give path `/` the **PVEAuditor** role: once as an **API Token Permission** for the token, once as a **User Permission** for its user.":
    "4. 在 *Datacenter → Permissions* 下按兩次 **Add**，為路徑 `/` 授予 **PVEAuditor** 角色：一次作為權杖的 **API Token Permission**，一次作為其使用者的 **User Permission**。",
  "A privilege-separated token only gets the permissions its user also has, so both need the role. It must sit on the root path `/`: pve-exporter reads cluster-wide status, and a token scoped to a sub-path fails with `Permission check failed (/, Sys.Audit)`.":
    "權限分離的權杖只能取得其使用者同樣擁有的權限，因此兩者都需要該角色。角色必須位於根路徑 `/`：pve-exporter 會讀取整個叢集的狀態，限定在子路徑上的權杖會以 `Permission check failed (/, Sys.Audit)` 失敗。",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "指令碼會詢問你的 OneUptime URL 和擷取金鑰，兩者都顯示在第 1 步中（在那裡選擇一個金鑰即可在此處填好），然後詢問：",
  "- **Cluster name** — how the cluster appears in OneUptime. Give every cluster its own and keep it stable: a new name registers a new cluster.":
    "- **叢集名稱**：叢集在 OneUptime 中顯示的名稱。為每個叢集取一個獨立的名稱並保持不變：新名稱會註冊一個新叢集。",
  "- **Proxmox VE API host** — any node, e.g. `192.168.1.10`. While its API does not answer, the agent reads the cluster from the next node in the list below.":
    "- **Proxmox VE API 主機**：任一節點，例如 `192.168.1.10`。在它的 API 沒有回應期間，代理程式會從下方清單中的下一個節點讀取叢集。",
  "- **Bundled prometheus-pve-exporter** — answer **Y** unless you already run one.":
    "- **隨附的 prometheus-pve-exporter**：除非你已經在執行一個，否則回答 **Y**。",
  "- **API token** — the token id and secret from the previous step.":
    "- **API 權杖**：上一步的權杖 ID 和祕密。",
  "- **Every node's address** — each node's own address, comma-separated, never a virtual IP. With the token, the script offers the cluster's own list: press Enter to take it. The agent also reads the cluster from these when the first node is down.":
    "- **每個節點的位址**：每個節點自己的位址，以逗號分隔，絕不使用虛擬 IP。有了權杖，指令碼會提供叢集自己的清單：按 Enter 即可採用。第一個節點停機時，代理程式也會從這些節點讀取叢集。",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **OneUptime AI 代理程式**：是否允許它套用修復；回答 **N** 可讓它保持唯讀。",
  "It installs to `/opt/oneuptime-proxmox-agent`, writes a `0600` `.env` file and starts everything with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "它會安裝到 `/opt/oneuptime-proxmox-agent`，寫入一個 `0600` 權限的 `.env` 檔案，並用 Docker Compose 啟動所有元件。再次執行指令碼會沿用該 `.env` 中的所有內容而不再詢問，因此這也是升級的方法。",
  "`docker compose ps` lists the collector (`oneuptime-proxmox-agent`), the node failover (`oneuptime-pve-api-failover`), the bundled exporter (`oneuptime-pve-exporter`, unless you use your own) and the OneUptime AI agent (`oneuptime-proxmox-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cluster then appears automatically in the **Proxmox** section.":
    "`docker compose ps` 會列出收集器（`oneuptime-proxmox-agent`）、節點容錯移轉（`oneuptime-pve-api-failover`）、隨附的匯出器（`oneuptime-pve-exporter`，除非你使用自己的匯出器）和 OneUptime AI 代理程式（`oneuptime-proxmox-ai-agent`）。在收集器的日誌中尋找 `Everything is ready. Begin running and processing data.`。之後叢集會自動出現在 **Proxmox** 區段。",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only `pvesh` requests, and changes nothing unless you allow fixes — see **OneUptime AI agent** under Advanced.":
    "**OneUptime AI 代理程式（預設開啟，唯讀）。** AI 調查已開啟：它讓 OneUptime AI 使用唯讀的 `pvesh` 要求調查此叢集上的事件與警示，除非你允許修復，否則不會做任何變更——請參閱進階中的 **OneUptime AI 代理程式**。",
  "Needs Proxmox VE 8.3 or later. Pick an ingestion key in step 1 to show the two commands: they carry the key, which Proxmox VE keeps in the webhook target they add.":
    "需要 Proxmox VE 8.3 或更新版本。在第 1 步中選擇一個擷取金鑰即可顯示這兩個指令：指令中帶有該金鑰，Proxmox VE 會把它保存在指令新增的 Webhook 目標中。",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts.":
    "之後每個客體的頁面會顯示其最近一次備份，叢集的 **建議** 會提供 **Backup Job Failed** 和 **Node Fenced** 警示。",
  "The install script writes these to `/opt/oneuptime-proxmox-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`.":
    "安裝指令碼會把這些寫入 `/opt/oneuptime-proxmox-agent/.env`。變更其中任何一項後，在 `/opt/oneuptime-proxmox-agent` 中用 `docker compose up -d` 套用。",
  "| Variable | Required | Description |": "| 變數 | 必填 | 說明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 執行個體 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 是 | 遙測擷取金鑰，即第 1 步中選擇的那個 |",
  "| `PROXMOX_CLUSTER_NAME` | Yes | Cluster identifier shown in OneUptime. Stamped on every metric as the `proxmox.cluster.name` resource attribute. Keep it stable — changing it registers a new cluster (default: `proxmox-cluster`) |":
    "| `PROXMOX_CLUSTER_NAME` | 是 | 在 OneUptime 中顯示的叢集識別碼。以資源屬性 `proxmox.cluster.name` 標記在每個指標上。請保持不變：變更它會註冊一個新叢集（預設：`proxmox-cluster`） |",
  "| `PVE_HOST` | Yes | The node whose Proxmox VE API the exporter reads the cluster from and the AI agent queries, e.g. `192.168.1.10`. While its API does not answer, both use the next node in `PVE_NODES` that does |":
    "| `PVE_HOST` | 是 | 匯出器透過其 Proxmox VE API 讀取叢集、AI 代理程式向其查詢的節點，例如 `192.168.1.10`。在它的 API 沒有回應期間，兩者都會使用 `PVE_NODES` 中下一個有回應的節點 |",
  "| `PVE_NODES` | On a cluster | Every node's own API address, comma-separated in square brackets, e.g. `[192.168.1.10,192.168.1.11,192.168.1.12]`. Defaults to `PVE_HOST` alone, which is enough for a single node. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen. The agent also reads the cluster from the next of them when `PVE_HOST` goes down. |":
    "| `PVE_NODES` | 叢集時需要 | 每個節點自己的 API 位址，以逗號分隔並放在方括號中，例如 `[192.168.1.10,192.168.1.11,192.168.1.12]`。預設只有 `PVE_HOST`，單一節點時這就足夠了。匯出器只讀取它所詢問的那個節點的開機時啟動（Guest Down）、複寫和訂閱資訊，因此會依序詢問每個節點；遺漏的節點不會被看見。當 `PVE_HOST` 停機時，代理程式也會從其中的下一個節點讀取叢集。 |",
  "| `PVE_EXPORTER_URL` | No | Address (`host:port`, no scheme) of prometheus-pve-exporter. Defaults to the bundled exporter (`pve-exporter:9221`) |":
    "| `PVE_EXPORTER_URL` | 否 | prometheus-pve-exporter 的位址（`host:port`，不含通訊協定）。預設是隨附的匯出器（`pve-exporter:9221`） |",
  "| `PVE_API_TOKEN_ID` | Bundled exporter and AI agent | Full Proxmox API token id, e.g. `monitoring@pam!oneuptime` (PVEAuditor, read-only) |":
    "| `PVE_API_TOKEN_ID` | 隨附的匯出器和 AI 代理程式 | 完整的 Proxmox API 權杖 ID，例如 `monitoring@pam!oneuptime`（PVEAuditor，唯讀） |",
  "| `PVE_API_TOKEN_SECRET` | Bundled exporter and AI agent | Proxmox API token secret |":
    "| `PVE_API_TOKEN_SECRET` | 隨附的匯出器和 AI 代理程式 | Proxmox API 權杖的祕密 |",
  "| `PVE_VERIFY_SSL` | No | Verify the Proxmox API TLS certificate (default: `false` — PVE ships self-signed certificates) |":
    "| `PVE_VERIFY_SSL` | 否 | 驗證 Proxmox API 的 TLS 憑證（預設：`false`——PVE 隨附自我簽署憑證） |",
  "| `COMPOSE_PROFILES` | No | Set to `pve-exporter` to start the bundled exporter container |":
    "| `COMPOSE_PROFILES` | 否 | 設定為 `pve-exporter` 可啟動隨附匯出器的容器 |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI 代理程式本身的設定請見 **OneUptime AI 代理程式** 一節。",
  "When the install script asks **Run the bundled prometheus-pve-exporter?**, answer **n** and give your exporter's address (`host:port`, no scheme).":
    "當安裝指令碼詢問 **Run the bundled prometheus-pve-exporter?** 時，回答 **n** 並填入你的匯出器位址（`host:port`，不含通訊協定）。",
  "Use an address the agent's container can reach — the host's LAN IP or DNS name: `localhost` inside the container is the container itself. Keep `PVE_API_TOKEN_ID` and `PVE_API_TOKEN_SECRET` in `.env` if you use the OneUptime AI agent, which reads the API with that token.":
    "請使用代理程式容器連得到的位址，也就是主機的區域網路 IP 或 DNS 名稱：容器內的 `localhost` 是容器本身。如果你使用 OneUptime AI 代理程式，請在 `.env` 中保留 `PVE_API_TOKEN_ID` 和 `PVE_API_TOKEN_SECRET`，AI 代理程式會用該權杖讀取 API。",
  "The agent scrapes the exporter every 30 seconds: its cluster collectors once, at `PVE_HOST` (or the node it reads the cluster from while `PVE_HOST` is down), and its node collectors once for each node in `PVE_NODES`. Every series carries an `id` label identifying the resource — `node/<name>`, `qemu/<vmid>`, `lxc/<vmid>`, or `storage/<node>/<storage>`:":
    "代理程式每 30 秒抓取一次匯出器：叢集收集器在 `PVE_HOST`（或在 `PVE_HOST` 停機期間代理程式讀取叢集的那個節點）上抓取一次，節點收集器則為 `PVE_NODES` 中的每個節點各抓取一次。每個序列都帶有識別資源的 `id` 標籤——`node/<name>`、`qemu/<vmid>`、`lxc/<vmid>` 或 `storage/<node>/<storage>`：",
  "| Category | Metrics |": "| 類別 | 指標 |",
  "| **Availability** | `pve_up`, `pve_uptime_seconds` |":
    "| **可用性** | `pve_up`、`pve_uptime_seconds` |",
  "| **Node** | `pve_node_info`, `pve_cpu_usage_ratio`, `pve_cpu_usage_limit`, `pve_memory_usage_bytes`, `pve_memory_size_bytes` |":
    "| **節點** | `pve_node_info`、`pve_cpu_usage_ratio`、`pve_cpu_usage_limit`、`pve_memory_usage_bytes`、`pve_memory_size_bytes` |",
  "| **Guest (VM / LXC)** | `pve_guest_info`, plus CPU / memory / network series on `qemu/*` and `lxc/*` ids |":
    "| **客體（VM / LXC）** | `pve_guest_info`，以及 `qemu/*` 和 `lxc/*` ID 上的 CPU / 記憶體 / 網路序列 |",
  "| **Storage** | `pve_disk_usage_bytes`, `pve_disk_size_bytes`, `pve_storage_info` |":
    "| **儲存空間** | `pve_disk_usage_bytes`、`pve_disk_size_bytes`、`pve_storage_info` |",
  "| **HA** | `pve_ha_state` |": "| **HA**（高可用性） | `pve_ha_state` |",
  "| **Backup coverage** | `pve_not_backed_up_total`, `pve_not_backed_up_info` — guests no backup job selects (whether backups ran or succeeded is not exposed) |":
    "| **備份涵蓋範圍** | `pve_not_backed_up_total`、`pve_not_backed_up_info`——沒有被任何備份工作選中的客體（備份是否執行、是否成功不會顯示出來） |",
  "| **Start-on-boot** | `pve_onboot_status` per guest, which **Guest Down** reads |":
    "| **開機時啟動** | 每個客體的 `pve_onboot_status`，**Guest Down** 會讀取它 |",
  "| **Replication** | `pve_replication_*` series per storage replication job — their `id` label is the job id (e.g. `100-0`), not a resource |":
    "| **複寫** | 每個儲存空間複寫工作的 `pve_replication_*` 序列——它們的 `id` 標籤是工作 ID（例如 `100-0`），而不是資源 |",
  "Start-on-boot and replication come from the exporter's node collectors, which read only the node the exporter asks: a node missing from `PVE_NODES` has neither.":
    "開機時啟動和複寫資訊來自匯出器的節點收集器，它們只讀取匯出器所詢問的節點：`PVE_NODES` 中缺少的節點兩者都沒有。",
  "The collector also splits the `id` label into three equality-filterable datapoint attributes (the `transform/pve-identity` processor) — monitor criteria and dashboard filters match on these:":
    "收集器還會把 `id` 標籤拆分為三個可依相等條件篩選的資料點屬性（`transform/pve-identity` 處理器）——監測器條件和儀表板篩選器都依據這些屬性比對：",
  "| Attribute | Values | Example for `qemu/100` |":
    "| 屬性 | 值 | `qemu/100` 的範例 |",
  "| `pve.scope` | `node`, `guest`, `storage`, `cluster` (`qemu` and `lxc` both map to `guest`) | `guest` |":
    "| `pve.scope` | `node`、`guest`、`storage`、`cluster`（`qemu` 和 `lxc` 都對應到 `guest`） | `guest` |",
  "| `pve.id` | Everything after the first `/` of `id` (`pve1`, `100`, `pve1/local`) | `100` |":
    "| `pve.id` | `id` 中第一個 `/` 之後的全部內容（`pve1`、`100`、`pve1/local`） | `100` |",
  "The original `id` label is kept untouched.": "原始的 `id` 標籤保持不變。",
  "The agent reads the whole cluster through one node's API: `PVE_HOST`'s while it answers. Every 15 seconds the `oneuptime-pve-api-failover` container checks that node, and when its API stops answering the collector reads the cluster from the next node in `PVE_NODES` that answers, until `PVE_HOST` answers again. With the API token in `.env` it also passes over a node that answers but is cut off from the quorate part of the cluster, whose view would report every other node down. The OneUptime AI agent does the same for each of its calls. So when a node fails, **Node Offline** fires for it and the rest of the cluster keeps reporting.":
    "代理程式透過一個節點的 API 讀取整個叢集：在 `PVE_HOST` 有回應時使用它的 API。`oneuptime-pve-api-failover` 容器每 15 秒檢查一次該節點，當它的 API 停止回應時，收集器會從 `PVE_NODES` 中下一個有回應的節點讀取叢集，直到 `PVE_HOST` 再次回應。`.env` 中有 API 權杖時，它也會略過雖有回應、卻與叢集中擁有仲裁的部分斷開的節點，因為從這個節點看來，其他所有節點都已停機。OneUptime AI 代理程式在每次呼叫時也會這麼做。因此，當某個節點故障時，會為它觸發 **Node Offline**，而叢集的其餘部分會繼續回報。",
  "Its logs say which node the cluster is read from, and why.":
    "它的日誌會說明叢集是從哪個節點讀取的，以及原因。",
  "What it cannot cover is the machine the agent runs on: if that goes down, the whole cluster goes quiet and **Cluster Stopped Reporting** fires. Run the agent off the cluster, or in a VM that Proxmox HA restarts on another node (`ha-manager add vm:<vmid>`, on shared storage), and run one agent per cluster: each agent reads the whole cluster, so a second one reports every resource twice. See [When a node goes down](/docs/telemetry/proxmox#when-a-node-goes-down).":
    "它無法涵蓋的是代理程式所在的機器：如果這台機器停機，整個叢集都會沉默，並觸發 **Cluster Stopped Reporting**。請在叢集外執行代理程式，或在由 Proxmox HA 在另一個節點上重新啟動的虛擬機器中執行（`ha-manager add vm:<vmid>`，位於共用儲存空間上），並且每個叢集只執行一個代理程式：每個代理程式都會讀取整個叢集，第二個代理程式會讓每個資源被回報兩次。請參閱[節點停機時](/docs/telemetry/proxmox#when-a-node-goes-down)。",
  "This is the full `otel-collector-config.yaml` the agent runs; the `.env` file supplies the `${env:...}` values. The `transform/pve-identity` processor derives the `pve.scope` / `pve.type` / `pve.id` attributes that the built-in Proxmox alert templates and dashboard filters rely on — keep it in place if you customize the config:":
    "這是代理程式執行的完整 `otel-collector-config.yaml`；`.env` 檔案提供 `${env:...}` 的值。`transform/pve-identity` 處理器會衍生出內建 Proxmox 警示範本和儀表板篩選器所依賴的 `pve.scope` / `pve.type` / `pve.id` 屬性——如果你自訂組態，請保留它：",
  "By default the agent ships metrics only, so the cluster's **Logs** tab stays empty. The PVE services log to the systemd journal, and the shipped config has a commented-out `journald` receiver for `pveproxy`, `pvedaemon`, `pve-firewall`, `pve-ha-crm`, `pve-ha-lrm`, `pvescheduler`, `pvestatd` and `qmeventd`.":
    "預設情況下代理程式只傳送指標，因此叢集的 **日誌** 索引標籤是空的。PVE 服務會把日誌寫入 systemd 日誌（journal），隨附的組態中有一個已註解掉的 `journald` 接收器，用於 `pveproxy`、`pvedaemon`、`pve-firewall`、`pve-ha-crm`、`pve-ha-lrm`、`pvescheduler`、`pvestatd` 和 `qmeventd`。",
  "1. **Run the agent on a PVE node.** The journal is per host, so a remote agent cannot read it, and each node ships only its own. To keep the metrics agent off the cluster, run a second, log-only collector on each node instead.":
    "1. **在 PVE 節點上執行代理程式。** journal 按主機保存，因此遠端代理程式無法讀取，每個節點也只傳送自己的 journal。若要讓指標代理程式留在叢集外，請改為在每個節點上另外執行一個只處理日誌的收集器。",
  "2. Uncomment the `journald` receiver and the `logs` pipeline in `otel-collector-config.yaml`, and the two journal volumes in `docker-compose.yml`.":
    "2. 取消 `otel-collector-config.yaml` 中 `journald` 接收器和 `logs` 管線的註解，以及 `docker-compose.yml` 中兩個 journal 磁碟區的註解。",
  "3. **Swap the collector image.** The stock image has no `journalctl` and runs as a user that cannot read the journal. Build this wrapper and point `image:` in `docker-compose.yml` at it:":
    "3. **更換收集器映像檔。** 預設映像檔中沒有 `journalctl`，並且以無法讀取 journal 的使用者身分執行。建置這個包裝映像檔，並讓 `docker-compose.yml` 中的 `image:` 指向它：",
  "4. Apply it:": "4. 套用變更：",
  "Rather keep the stock image? The documentation has a `filelog` fallback that tails `/var/log/syslog`: [Ship Proxmox service logs](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs).":
    "想保留預設映像檔？文件中有一個追蹤 `/var/log/syslog` 的 `filelog` 替代方案：[傳送 Proxmox 服務日誌](/docs/telemetry/proxmox#optional-ship-proxmox-service-logs)。",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cluster: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `proxmox.cluster.name`:":
    "任何帶有 `oneuptime.label.` 前置詞的資源屬性都會成為叢集上的專案標籤：`oneuptime.label.<dimension>=<value>` 即標籤 `<dimension>:<value>`。將它們加入 `otel-collector-config.yaml` 的 `resource` 處理器中，放在 `proxmox.cluster.name` 旁邊：",
  "Then restart the collector so it reads the new config:":
    "然後重新啟動收集器，讓它讀取新組態：",
  "The cluster shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "叢集會帶著 `team:platform` 與 `env:production` 標籤出現。標籤比對不區分大小寫，因此會重複使用現有的 `Production` 標籤；在 OneUptime 介面中新增的標籤絕不會被代理程式移除。",
  "`docker-compose.yml` also runs **`oneuptime-proxmox-ai-agent`**. While OneUptime AI investigates an incident or alert on this cluster, it runs read-only `pvesh` commands through it — `pvesh get /cluster/status`, a guest's current status, a node's failed tasks. There is no `pvesh` binary in it: each command becomes one call to the Proxmox VE API at `PVE_HOST`. It registers as the cluster named `PROXMOX_CLUSTER_NAME` and appears on the cluster's **AI → AI agent** page.":
    "`docker-compose.yml` 也會執行 **`oneuptime-proxmox-ai-agent`**。當 OneUptime AI 調查此叢集上的事件或警示時，會透過它執行唯讀的 `pvesh` 指令——`pvesh get /cluster/status`、某個客體的目前狀態、某個節點失敗的工作。它裡面並沒有 `pvesh` 程式：每個指令都會變成對 `PVE_HOST` 上 Proxmox VE API 的一次呼叫。它會註冊為名為 `PROXMOX_CLUSTER_NAME` 的叢集，並顯示在叢集的 **人工智慧 → AI 代理程式** 頁面上。",
  "- **The API token is the hard limit.** It reads with the collector's PVEAuditor token (`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`), which can read and nothing else. If you run your own exporter and have no token in `.env`, add one.":
    "- **API 權杖是硬性上限。** 它使用收集器的 PVEAuditor 權杖（`PVE_API_TOKEN_ID` / `PVE_API_TOKEN_SECRET`）讀取，該權杖只能讀取，其他都做不了。如果你執行自己的匯出器，而 `.env` 中沒有權杖，請新增一個。",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — starting or rebooting a guest — also need a token of its own that may power guests, set as `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`; the agent's README has the `pveum` commands. If the agent runs in a guest of this cluster, put that guest's VMID in `ONEUPTIME_AI_PROTECTED_TARGETS`.":
    "- 除非你設定 `ONEUPTIME_AI_ALLOW_WRITES=true`，否則它是 **唯讀** 的。修復（啟動或重新開機客體）還需要一個可以為客體開關機的專用權杖，設定為 `ONEUPTIME_AI_PVE_API_TOKEN_ID` / `ONEUPTIME_AI_PVE_API_TOKEN_SECRET`；代理程式的 README 中有相應的 `pveum` 指令。如果代理程式執行在此叢集的某個客體中，請把該客體的 VMID 填入 `ONEUPTIME_AI_PROTECTED_TARGETS`。",
  "- Check it: `docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- 檢查它：`docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-proxmox-ai-agent` service from `docker-compose.yml`.":
    "- 不使用 OneUptime AI？從 `docker-compose.yml` 中刪除 `oneuptime-proxmox-ai-agent` 服務。",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#proxmox-clusters).":
    "它可以執行什麼，以及修復如何運作：[基礎架構 AI 代理程式](/docs/ai/infrastructure-ai-agents#proxmox-clusters)。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the images and recreates the agent with them:":
    "**升級**——收集器映像檔固定在 `docker-compose.yml` 中，其組態是旁邊的一個檔案，所以只提取映像檔並不會讓代理程式更新。請再次執行安裝指令碼。它會沿用你現有 `.env` 中的每個值（不會再詢問任何內容），下載最新的 `docker-compose.yml` 與 `otel-collector-config.yaml`（你編輯過的檔案會以 `<file>.bak.<timestamp>` 保留在新檔案旁邊），提取映像檔並用它們重新建立代理程式：",
  "The config reports the collector version it pins as the cluster's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "該組態會把它固定的收集器版本回報為叢集的 **代理程式版本**。當此 OneUptime 固定了較新的版本時，旁邊的警告標誌會開啟這些指令。",
  "**Uninstall** the agent:": "**解除安裝**代理程式：",
  "Then delete the API token under *Datacenter → Permissions → API Tokens* if you no longer need it.":
    "如果不再需要該 API 權杖，請在 *Datacenter → Permissions → API Tokens* 下將其刪除。",
  "`troubleshoot.sh` checks the whole chain — container runtime, the exporter scrape, cluster-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` 會檢查整條鏈路（容器執行階段、匯出器抓取、叢集名稱標記、權杖格式、收集器自身指標），並直接詢問 OneUptime 是否接受你的擷取金鑰。最後一項檢查最重要：OneUptime 的 OTLP 端點會以 `401` 或 `422` 拒絕錯誤的金鑰，而收集器只會為每個批次記錄一行很容易被忽略的 `Exporting failed`，所以指令碼會向 `GET /otlp/v1/validate` 要求直接的 200/401 判定。",
  "It ends with a verdict naming the most likely cause.":
    "最後它會給出判定，指出最可能的原因。",
  "1. Check that the agent is running (in `/opt/oneuptime-proxmox-agent`): `docker compose ps`":
    "1. 檢查代理程式是否正在執行（在 `/opt/oneuptime-proxmox-agent` 中）：`docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-proxmox-agent | grep -i error`":
    "2. 檢查代理程式日誌中的錯誤：`docker compose logs oneuptime-proxmox-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. 確認你的 OneUptime URL 與擷取金鑰正確。",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. 確定代理程式所在的機器能透過網路連到 OneUptime 執行個體。",
  "1. Check the exporter answers. The bundled exporter does not publish its port on the host, so run curl inside its network namespace — you should see `pve_*` metric lines (for your own exporter, curl its `host:9221` directly):":
    "1. 檢查匯出器是否有回應。隨附的匯出器不會在主機上發布連接埠，因此請在它的網路命名空間中執行 curl——你應該會看到 `pve_*` 指標行（如果是你自己的匯出器，請直接 curl 它的 `host:9221`）：",
  "2. Verify the API token has the **PVEAuditor** role on path `/`, on the token and on its user.":
    "2. 確認 API 權杖在路徑 `/` 上擁有 **PVEAuditor** 角色，權杖和其使用者都要有。",
  "3. Check the collector logs for scrape or export errors (in `/opt/oneuptime-proxmox-agent`): `docker compose logs oneuptime-proxmox-agent`":
    "3. 檢查收集器日誌中的抓取或匯出錯誤（在 `/opt/oneuptime-proxmox-agent` 中）：`docker compose logs oneuptime-proxmox-agent`",
  "The API token is wrong or lacks permissions. Re-check the token id format (`user@realm!tokenname`), the secret, and that the **PVEAuditor** role is granted on path `/` to the token and to its user. The exporter's own logs show the API's answer: `docker logs oneuptime-pve-exporter`":
    "API 權杖錯誤或缺少權限。請重新檢查權杖 ID 的格式（`user@realm!tokenname`）、祕密，以及是否已在路徑 `/` 上把 **PVEAuditor** 角色授予權杖及其使用者。匯出器自己的日誌會顯示 API 的回應：`docker logs oneuptime-pve-exporter`",
  'Guest series (`qemu/*`, `lxc/*` ids) come from the exporter\'s cluster collector. The shipped config enables it (the `cluster=1` scrape parameter) — if you customized the config, restore the `cluster: ["1"]` param.':
    '客體序列（`qemu/*`、`lxc/*` ID）來自匯出器的叢集收集器。隨附的組態啟用了它（`cluster=1` 抓取參數）——如果你自訂了組態，請還原 `cluster: ["1"]` 參數。',
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "它們的開機時啟動旗標和複寫工作來自它們所在的節點，而代理程式只讀取 `PVE_NODES` 中的節點。請在那裡列出每個節點自己的位址，例如 `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`，並在 `/opt/oneuptime-proxmox-agent` 中用 `docker compose up -d` 套用。如果編輯後收集器無法啟動，表示清單少了方括號。`troubleshoot.sh` 會檢查清單中的每個節點。",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "叢集的身分來自 `PROXMOX_CLUSTER_NAME`，它以 `proxmox.cluster.name` 標記在每個指標上。在 `.env` 中修正它，並在 `/opt/oneuptime-proxmox-agent` 中用 `docker compose up -d` 套用——請注意，新名稱會註冊一個新叢集。",
  "- **Cluster name** — enter **`pve-1`** exactly; a different name registers a new cluster.":
    "- **叢集名稱**：準確輸入 **`pve-1`**；不同的名稱會註冊一個新叢集。",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-proxmox-agent` — note that a new name registers a new cluster.":
    "叢集的身分來自 `PROXMOX_CLUSTER_NAME`，它以 `proxmox.cluster.name` 標記在每個指標上。此叢集是 **`pve-1`**。在 `.env` 中修正它，並在 `/opt/oneuptime-proxmox-agent` 中用 `docker compose up -d` 套用——請注意，新名稱會註冊一個新叢集。",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "該指令已經帶有你的 OneUptime URL 與擷取金鑰。其餘內容由指令碼詢問：",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the cluster name you gave the agent, so the notifications reach the same cluster.":
    "需要 Proxmox VE 8.3 或更新版本。第一個指令會新增一個名為 `oneuptime` 的 Webhook 目標，它把每則通知作為此叢集的一筆日誌傳送到 OneUptime，並把金鑰和叢集名稱保存在它的祕密（secrets）中。第二個指令把所有通知都傳送給它。請把 `my-proxmox-cluster` 換成你給代理程式設定的叢集名稱，這樣通知才會送達同一個叢集。",
  "Each guest's page then shows its last backup, and the cluster's **Recommendations** offer the **Backup Job Failed** and **Node Fenced** alerts. To stop sending them:":
    "之後每個客體的頁面會顯示其最近一次備份，叢集的 **建議** 會提供 **Backup Job Failed** 和 **Node Fenced** 警示。若要停止傳送：",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. The command already names **`pve-1`**, so the notifications reach this cluster.":
    "需要 Proxmox VE 8.3 或更新版本。第一個指令會新增一個名為 `oneuptime` 的 Webhook 目標，它把每則通知作為此叢集的一筆日誌傳送到 OneUptime，並把金鑰和叢集名稱保存在它的祕密（secrets）中。第二個指令把所有通知都傳送給它。指令中已經寫明了 **`pve-1`**，因此通知會送達這個叢集。",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "從此 OneUptime 下載 `docker-compose.yml` 與 `otel-collector-config.yaml` 到一個新資料夾：",
  "Create a `.env` file next to them — it holds the token secret, so keep it private with `chmod 600 .env`:":
    "在它們旁邊建立一個 `.env` 檔案——它保存著權杖的祕密，因此請用 `chmod 600 .env` 將其設為私有：",
  "- Replace `my-proxmox-cluster` with a name for this cluster, such as `pve-prod`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "- 將 `my-proxmox-cluster` 換成此叢集的名稱，例如 `pve-prod`。叢集在 OneUptime 中就以此名稱顯示，所以請保持不變：新名稱會註冊一個新叢集。",
  "- Set `PVE_HOST` to any node of the cluster: while its API does not answer, the agent reads the cluster from the next node in `PVE_NODES`, so it needs no virtual IP.":
    "- 把 `PVE_HOST` 設定為叢集中的任一節點：在它的 API 沒有回應期間，代理程式會從 `PVE_NODES` 中的下一個節點讀取叢集，因此不需要虛擬 IP。",
  "- Set `PVE_NODES` to every node's own address, in square brackets, never a virtual IP. The exporter reads start-on-boot (Guest Down), replication and the subscription only for the node it asks, so each node is asked in turn; a node left out goes unseen.":
    "- 把 `PVE_NODES` 設定為每個節點自己的位址，放在方括號中，絕不使用虛擬 IP。匯出器只讀取它所詢問的那個節點的開機時啟動（Guest Down）、複寫和訂閱資訊，因此會依序詢問每個節點；遺漏的節點不會被看見。",
  "- Fill in the token from the previous step. `COMPOSE_PROFILES=pve-exporter` also starts the bundled prometheus-pve-exporter, which reads the API with it.":
    "- 填入上一步的權杖。`COMPOSE_PROFILES=pve-exporter` 也會啟動隨附的 prometheus-pve-exporter，它會用該權杖讀取 API。",
  "Start the agent:": "啟動代理程式：",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中選擇一個擷取金鑰，以填入 `<YOUR_API_KEY>`。",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "代理程式從 `docker-compose.yml` 旁邊的 `.env` 檔案讀取這些值。變更其中任何一項後，在 `docker-compose.yml` 所在的資料夾中用 `docker compose up -d` 套用。",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter instead (`host:port`, no scheme):":
    "不要在 `.env` 中設定 `COMPOSE_PROFILES`，而是讓代理程式指向你的匯出器（`host:port`，不含通訊協定）：",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "在代理程式的資料夾（也就是 `docker-compose.yml` 所在的資料夾）中執行這些指令。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` stays, and a change you made to either file has to be made again:":
    "**升級**——收集器映像檔固定在 `docker-compose.yml` 中，其組態是旁邊的一個檔案，所以只提取映像檔並不會讓代理程式更新。請重新下載這兩個檔案；你的 `.env` 會保留，而你對其中任一檔案做過的變更需要重做一次：",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "然後提取映像檔並重新建立代理程式，讓收集器讀取新組態：",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. 檢查代理程式是否在執行（在代理程式資料夾中）：`docker compose ps`",
  "3. Check the collector logs for scrape or export errors (in the agent's folder): `docker compose logs oneuptime-proxmox-agent`":
    "3. 檢查收集器日誌中的抓取或匯出錯誤（在代理程式的資料夾中）：`docker compose logs oneuptime-proxmox-agent`",
  "Their start-on-boot flags and replication jobs come from the node they run on, and the agent reads only the nodes in `PVE_NODES`. List every node's own address there, such as `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`, and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. If the collector stops starting after an edit, the list lost its square brackets. `troubleshoot.sh` checks every node in the list.":
    "它們的開機時啟動旗標和複寫工作來自它們所在的節點，而代理程式只讀取 `PVE_NODES` 中的節點。請在那裡列出每個節點自己的位址，例如 `PVE_NODES=[192.168.1.10,192.168.1.11,192.168.1.12]`，並在 `docker-compose.yml` 所在的資料夾中用 `docker compose up -d` 套用。如果編輯後收集器無法啟動，表示清單少了方括號。`troubleshoot.sh` 會檢查清單中的每個節點。",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "叢集的身分來自 `PROXMOX_CLUSTER_NAME`，它以 `proxmox.cluster.name` 標記在每個指標上。在 `.env` 中修正它，並在 `docker-compose.yml` 所在的資料夾中用 `docker compose up -d` 套用——請注意，新名稱會註冊一個新叢集。",
  "- This installs the agent for **`pve-1`** — keep `PROXMOX_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "- 這會為 **`pve-1`** 安裝代理程式——請讓 `PROXMOX_CLUSTER_NAME` 保持原樣，否則資料會註冊為一個新叢集。",
  "The cluster's identity comes from `PROXMOX_CLUSTER_NAME`, stamped on every metric as `proxmox.cluster.name`. This cluster is **`pve-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new cluster.":
    "叢集的身分來自 `PROXMOX_CLUSTER_NAME`，它以 `proxmox.cluster.name` 標記在每個指標上。此叢集是 **`pve-1`**。在 `.env` 中修正它，並在 `docker-compose.yml` 所在的資料夾中用 `docker compose up -d` 套用——請注意，新名稱會註冊一個新叢集。",
  "**No agent, but less data.** Proxmox VE 9.0 and later push each node's metrics to OneUptime themselves. HA state, start-on-boot (used by **Guest Down**), backup coverage and replication are not pushed — use the install script or Docker Compose if you need them. Use one or the other for a cluster: running both reports every resource twice.":
    "**不需要代理程式，但資料較少。** Proxmox VE 9.0 及更新版本會自己把每個節點的指標推送到 OneUptime。HA 狀態、開機時啟動（**Guest Down** 會用到）、備份涵蓋範圍和複寫資訊不會被推送——如果需要它們，請使用安裝指令碼或 Docker Compose。一個叢集只用其中一種方式：兩者同時執行會讓每個資源被回報兩次。",
  "Proxmox VE **9.0 or later**": "Proxmox VE **9.0 或更新版本**",
  "The Proxmox web UI, to add a metric server under *Datacenter → Metric Server*":
    "Proxmox Web 介面，用於在 *Datacenter → Metric Server* 下新增指標伺服器",
  "Every node can reach `<YOUR_ONEUPTIME_HOST>` on port `443`":
    "每個節點都能透過連接埠 `443` 連到 `<YOUR_ONEUPTIME_HOST>`",
  "| Field | Value |": "| 欄位 | 值 |",
  "| **Server** | `<YOUR_ONEUPTIME_HOST>` |":
    "| **Server**（伺服器） | `<YOUR_ONEUPTIME_HOST>` |",
  "| **Port** | `443` |": "| **Port**（連接埠） | `443` |",
  "| **Protocol** | `https` |": "| **Protocol**（通訊協定） | `https` |",
  "| **Path** | `/otlp/v1/metrics` |":
    "| **Path**（路徑） | `/otlp/v1/metrics` |",
  "| **Headers** | The JSON below |": "| **Headers**（標頭） | 下方的 JSON |",
  "Add it once for the datacenter — every node of the cluster then pushes its own metrics.":
    "為資料中心新增一次即可——之後叢集中的每個節點都會推送自己的指標。",
  "OneUptime translates the push into the same `pve_*` series the agent sends. The cluster registers itself under your Proxmox cluster name — a standalone node under its node name — and appears in the **Proxmox** section, where the Nodes, Guests and Storage pages, the overview charts, the metric catalog and the CPU / memory / storage alert templates work as they do with the agent.":
    "OneUptime 會把推送轉換為與代理程式傳送的相同的 `pve_*` 序列。叢集會以你的 Proxmox 叢集名稱自行註冊（獨立節點則以其節點名稱註冊），並出現在 **Proxmox** 區段，其中的節點、客體和儲存空間頁面、概覽圖表、指標目錄以及 CPU / 記憶體 / 儲存空間警示範本都和使用代理程式時一樣運作。",
  "Each node pushes only its own status, so a node that goes down cannot report itself down — the nodes still alive report it for it:":
    "每個節點只推送自己的狀態，因此停機的節點無法自己回報停機——仍在運作的節點會替它回報：",
  "- It shows **Offline** on the Proxmox pages about 2 minutes after its last report, and **Node Offline** fires after about 5 minutes.":
    "- 在最後一次回報約 2 分鐘後，它會在 Proxmox 頁面上顯示為 **離線**，約 5 分鐘後觸發 **Node Offline**。",
  "- **Cluster Quorum at Risk** counts it as offline too; it fires about 7–9 minutes after the node went quiet, once its whole 5-minute window has reports.":
    "- **Cluster Quorum at Risk** 也會把它算作離線；它會在節點沉默約 7–9 分鐘後、其整個 5 分鐘時間範圍都有回報資料時觸發。",
  "- Its next report brings it back.": "- 它的下一次回報會讓它恢復。",
  'Offline means "stopped reporting": a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. A standalone host or a whole cluster going silent has nobody left to report it, so the cluster turns **Disconnected** instead. A node silent for more than 7 days is no longer reported. The reports are marked `oneuptime.proxmox.inferred=not-reporting` in Metrics Explorer.':
    "離線表示「停止回報」：`pvestatd` 停止回應、`pmxcfs` 停止，或到 OneUptime 的網路中斷，看起來都一樣。獨立主機或整個叢集陷入沉默時，就沒有節點能替它回報，因此改為叢集顯示為 **已中斷**。沉默超過 7 天的節點不再被回報。這些回報在指標瀏覽器中帶有 `oneuptime.proxmox.inferred=not-reporting` 標記。",
  "The cluster registers under its Proxmox cluster name; a standalone node registers under its node name. A `proxmox.cluster.name` resource attribute set under the metric server's *Resource Attributes* keeps being used instead.":
    "叢集以其 Proxmox 叢集名稱註冊；獨立節點以其節點名稱註冊。如果在指標伺服器的 *Resource Attributes* 下設定了 `proxmox.cluster.name` 資源屬性，則會繼續改用該屬性。",
  "OneUptime translates the push into the `pve_*` series the agent sends, so the Proxmox pages and the CPU / memory / storage alert templates work unchanged. The original `proxmox_*` series stay available in Metrics Explorer for anything else Proxmox VE reports.":
    "OneUptime 會把推送轉換為代理程式傳送的 `pve_*` 序列，因此 Proxmox 頁面和 CPU / 記憶體 / 儲存空間警示範本不需修改即可運作。原始的 `proxmox_*` 序列仍可在指標瀏覽器中使用，用於 Proxmox VE 回報的其他所有內容。",
  "Some alert templates need data only the agent collects:":
    "有些警示範本需要只有代理程式才會收集的資料：",
  "| Needs the agent | Why |": "| 需要代理程式 | 原因 |",
  "| HA state | Not pushed — the **HA Resource in Error State** template needs the agent |":
    "| HA 狀態 | 不推送——**HA Resource in Error State** 範本需要代理程式 |",
  "| Start-on-boot flag | Not pushed — **Guest Down**, which only pages for guests set to start on boot, needs the agent |":
    "| 開機時啟動旗標 | 不推送——**Guest Down** 只針對設定為開機時啟動的客體發出通知，它需要代理程式 |",
  "| Backup coverage and replication | Not pushed — **Guest Not Backed Up** and **Replication Failing** need the agent |":
    "| 備份涵蓋範圍和複寫 | 不推送——**Guest Not Backed Up** 和 **Replication Failing** 需要代理程式 |",
  "Every node has stopped reporting, or never started.":
    "所有節點都已停止回報，或者從未開始回報。",
  "1. Under *Datacenter → Metric Server*, check the OpenTelemetry entry: server `<YOUR_ONEUPTIME_HOST>`, port `443`, protocol `https`, path `/otlp/v1/metrics`, and the `x-oneuptime-token` header with a key from step 1.":
    "1. 在 *Datacenter → Metric Server* 下檢查 OpenTelemetry 項目：伺服器 `<YOUR_ONEUPTIME_HOST>`、連接埠 `443`、通訊協定 `https`、路徑 `/otlp/v1/metrics`，以及帶有第 1 步金鑰的 `x-oneuptime-token` 標頭。",
  "2. Check that the nodes can reach `<YOUR_ONEUPTIME_HOST>` over the network.":
    "2. 檢查節點能否透過網路連到 `<YOUR_ONEUPTIME_HOST>`。",
  "It stopped reporting: a node that is down, a hung `pvestatd`, a stopped `pmxcfs` or a cut network to OneUptime look the same. Its next report brings it back. If you took the node out of the cluster, use **Remove Node** on its page — otherwise it stays Offline for up to 7 days.":
    "它已停止回報：節點停機、`pvestatd` 停止回應、`pmxcfs` 停止，或到 OneUptime 的網路中斷，看起來都一樣。它的下一次回報會讓它恢復。如果你已把該節點移出叢集，請在它的頁面上使用 **移除節點**——否則它會保持離線最多 7 天。",
  "The native push does not send HA state, start-on-boot, backup coverage or replication. Pick **Install script** or **Docker Compose** at the top of this guide to run the agent instead — and remove the metric server, since running both reports every resource twice.":
    "原生推送不會傳送 HA 狀態、開機時啟動、備份涵蓋範圍或複寫資訊。請在本指南頂端選擇 **安裝指令碼** 或 **Docker Compose** 來改為執行代理程式——並刪除指標伺服器，因為兩者同時執行會讓每個資源被回報兩次。",
  "This cluster is **`pve-1`** in OneUptime. If that is not the Proxmox cluster's own name, set `proxmox.cluster.name` to `pve-1` under the metric server's *Resource Attributes*, or the push registers a new cluster.":
    "此叢集在 OneUptime 中是 **`pve-1`**。如果這不是該 Proxmox 叢集自己的名稱，請在指標伺服器的 *Resource Attributes* 下把 `proxmox.cluster.name` 設定為 `pve-1`，否則推送會註冊一個新叢集。",
  "Needs Proxmox VE 8.3 or later. The first command adds a webhook target named `oneuptime`, which sends each notification to OneUptime as a log of this cluster and keeps the key and the cluster's name in its secrets. The second sends every notification to it. Replace `my-proxmox-cluster` with the name the cluster appears under in OneUptime: its Proxmox cluster name, or a standalone node's own name.":
    "需要 Proxmox VE 8.3 或更新版本。第一個指令會新增一個名為 `oneuptime` 的 Webhook 目標，它把每則通知作為此叢集的一筆日誌傳送到 OneUptime，並把金鑰和叢集名稱保存在它的祕密（secrets）中。第二個指令把所有通知都傳送給它。請把 `my-proxmox-cluster` 換成叢集在 OneUptime 中顯示的名稱：它的 Proxmox 叢集名稱，或獨立節點自己的名稱。",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | 否 | 收集器的容器名稱（預設：`oneuptime-proxmox-agent`）。同一台機器上第二個叢集的代理程式需要自己的容器名稱：除非你自行設定，否則安裝指令碼會依新代理程式的資料夾為其容器命名，並在你再次執行指令碼時保留這些名稱 |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). The install script names a second cluster's API failover sidecar after its collector (`oneuptime-pve-api-failover-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | 否 | API 容錯移轉 sidecar 的容器名稱（預設：`oneuptime-pve-api-failover`）。除非你自行設定，否則安裝指令碼會依第二個叢集的收集器為其 API 容錯移轉 sidecar 命名（`oneuptime-pve-api-failover-cluster2` 與 `oneuptime-proxmox-agent-cluster2` 並列），並在你再次執行指令碼時保留該名稱 |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). The install script names a second cluster's bundled exporter after its collector (`oneuptime-pve-exporter-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | 否 | 隨附的匯出器的容器名稱（預設：`oneuptime-pve-exporter`）。除非你自行設定，否則安裝指令碼會依第二個叢集的收集器為其隨附的匯出器命名（`oneuptime-pve-exporter-cluster2` 與 `oneuptime-proxmox-agent-cluster2` 並列），並在你再次執行指令碼時保留該名稱 |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). The install script names a second cluster's AI agent after its collector (`oneuptime-proxmox-ai-agent-cluster2` beside `oneuptime-proxmox-agent-cluster2`) unless you set it, and keeps it when you run the script again |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | 否 | AI 代理程式的容器名稱（預設：`oneuptime-proxmox-ai-agent`）。除非你自行設定，否則安裝指令碼會依第二個叢集的收集器為其 AI 代理程式命名（`oneuptime-proxmox-ai-agent-cluster2` 與 `oneuptime-proxmox-agent-cluster2` 並列），並在你再次執行指令碼時保留該名稱 |",
  "One agent reads one cluster. For a second cluster, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "一個代理程式讀取一個叢集。若要讀取第二個叢集，請在獨立的資料夾中安裝第二個代理程式，並使用它自己的容器名稱——兩個容器不能共用一個名稱：",
  "The script names the containers after the folder, such as `oneuptime-proxmox-agent-cluster2`, unless you set their variables, such as `PROXMOX_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "除非你設定它們的變數（例如 `PROXMOX_AGENT_CONTAINER_NAME`），否則指令碼會依資料夾為容器命名，例如 `oneuptime-proxmox-agent-cluster2`。它會把名稱保存在該代理程式的 `.env` 中，所以用同一個 `INSTALL_DIR` 再次執行指令碼來升級代理程式時會保留這些名稱；而你曾在 `docker-compose.yml` 中編輯過 `container_name` 的代理程式，也會保留那個名稱。",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "請為每個資料夾取一個獨有的名稱：Docker Compose 只依資料夾為專案命名，因此如果某個資料夾與別處已在執行代理程式的資料夾同名，指令碼會拒絕它。用 `-d` 把資料夾傳給診斷指令碼。",
  "| `PROXMOX_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-proxmox-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AGENT_CONTAINER_NAME` | 否 | 收集器的容器名稱（預設：`oneuptime-proxmox-agent`）。同一台機器上第二個叢集的代理程式需要自己的容器名稱 |",
  "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | No | The API failover sidecar's container name (default: `oneuptime-pve-api-failover`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_API_FAILOVER_CONTAINER_NAME` | 否 | API 容錯移轉 sidecar 的容器名稱（預設：`oneuptime-pve-api-failover`）。同一台機器上第二個叢集的代理程式需要自己的容器名稱 |",
  "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-pve-exporter`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_PVE_EXPORTER_CONTAINER_NAME` | 否 | 隨附的匯出器的容器名稱（預設：`oneuptime-pve-exporter`）。同一台機器上第二個叢集的代理程式需要自己的容器名稱 |",
  "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-proxmox-ai-agent`). A second cluster's agent on the same machine needs one of its own |":
    "| `PROXMOX_AI_AGENT_CONTAINER_NAME` | 否 | AI 代理程式的容器名稱（預設：`oneuptime-proxmox-ai-agent`）。同一台機器上第二個叢集的代理程式需要自己的容器名稱 |",
  "One agent reads one cluster. For a second cluster, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "一個代理程式讀取一個叢集。若要讀取第二個叢集，請在獨立的資料夾中設定第二個代理程式，並使用它自己的容器名稱——兩個容器不能共用一個名稱。請在該代理程式的 `.env` 中設定這些名稱：",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "請為每個資料夾取一個獨有的名稱：Docker Compose 只依資料夾為專案命名，因此同名的第二個資料夾會取代第一個代理程式的容器。不要把這些名稱寫進 `docker-compose.yml`，升級會取代該檔案。",
};

export default TRANSLATION;
