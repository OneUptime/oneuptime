import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The VMware setup guide in Traditional Chinese (#8341): each piece of the English
 * guide's markdown (Pages/VMware/Utils/DocumentationMarkdown.ts) and its
 * Traditional Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Traditional Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach vCenter over HTTPS (TCP 443) — ideally not a VM on the cluster it watches":
    "Docker Engine 20.10 或以上版本並附 Docker Compose v2 外掛程式，所在機器能透過 HTTPS（TCP 443）連到 vCenter——最好不是它所監視的叢集上的虛擬機器",
  "vCenter Server or ESXi **7.0 or later** (the collector's `vcenter` receiver supports vSphere 7 and 8)":
    "vCenter Server 或 ESXi **7.0 或更新版本**（收集器的 `vcenter` 接收器支援 vSphere 7 與 8）",
  "One agent per vCenter Server, or per standalone ESXi host that no vCenter manages":
    "每個 vCenter Server 一個代理程式，或每個不受任何 vCenter 管理的獨立 ESXi 主機一個代理程式",
  "1. Create the account: *Menu → Administration → Single Sign On → Users and Groups*, pick the `vsphere.local` domain (or your identity source), **Add** a user such as `oneuptime` and set a password. This yields the principal `oneuptime@vsphere.local`.":
    "1. 建立帳戶：在 *Menu → Administration → Single Sign On → Users and Groups* 中選擇 `vsphere.local` 網域（或你的身分識別來源），用 **Add** 新增一個使用者，例如 `oneuptime`，並設定密碼。這樣就得到主體 `oneuptime@vsphere.local`。",
  "2. Grant the role: select the top-level **vCenter Server** object in the *Hosts and Clusters* inventory, open the **Permissions** tab, click **Add**, choose the user, set the role to **Read-Only**, and tick **Propagate to children**.":
    "2. 授與角色：在 *Hosts and Clusters* 詳細目錄中選取最上層的 **vCenter Server** 物件，開啟 **Permissions** 索引標籤，按一下 **Add**，選擇該使用者，將角色設為 **Read-Only**，並勾選 **Propagate to children**。",
  "Propagation is the part people miss. The receiver walks datacenters → clusters → hosts → VMs → datastores → resource pools, and every object the user cannot see is silently absent from the metrics — a Read-Only role granted on the vCenter object *without* propagation yields an inventory with nothing in it.":
    "傳播是大家最容易漏掉的一步。接收器會依序走訪資料中心 → 叢集 → 主機 → 虛擬機器 → 資料存放區 → 資源集區，使用者看不到的每個物件都會無聲無息地從指標中缺席——在 vCenter 物件上授與 Read-Only 角色卻 *不* 傳播，得到的詳細目錄會是空的。",
  "From a machine with administrator credentials:":
    "在具有系統管理員認證資訊的機器上：",
  "This creates `oneuptime@vsphere.local` with the Read-Only role on the vCenter root, propagated to every object below it.":
    "這會建立 `oneuptime@vsphere.local`，並在 vCenter 根層級授與 Read-Only 角色，傳播到其下的每個物件。",
  "For an ESXi host that no vCenter manages, create the user under *Host → Manage → Security & Users → Users* in the ESXi Host Client, and assign it the Read-Only role under *Host → Manage → Security & Users → Permissions*.":
    "對於不受任何 vCenter 管理的 ESXi 主機，在 ESXi Host Client 的 *Host → Manage → Security & Users → Users* 下建立使用者，並在 *Host → Manage → Security & Users → Permissions* 下為其指派 Read-Only 角色。",
  "In the next step, use the host itself as the endpoint (`https://esxi01.example.com`) with this local user. Everything the host knows is collected — the host, its VMs, datastores and resource pools; a standalone host has no datacenter or cluster object, so those pages stay empty.":
    "在下一步中，把主機本身當作端點（`https://esxi01.example.com`），並使用這個本機使用者。主機知道的一切都會被收集——主機本身、它的虛擬機器、資料存放區與資源集區；獨立主機沒有資料中心或叢集物件，因此那些頁面會保持空白。",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "指令碼會詢問你的 OneUptime URL 和擷取金鑰，兩者都顯示在第 1 步中（在那裡選擇一個金鑰即可在此處填好），然後詢問：",
  "- **vCenter name** — how the vCenter appears in OneUptime. Give every vCenter its own and keep it stable: a new name registers a new vCenter.":
    "- **vCenter 名稱**：vCenter 在 OneUptime 中顯示的名稱。為每個 vCenter 取一個專屬名稱並保持不變：新名稱會註冊為一個新的 vCenter。",
  "- **vCenter endpoint** — scheme and host, without `/sdk`, e.g. `https://vcsa.example.com`.":
    "- **vCenter 端點**：通訊協定與主機，不加 `/sdk`，例如 `https://vcsa.example.com`。",
  "- **The read-only user and its password** — the password is read without echo.":
    "- **唯讀使用者及其密碼**：輸入密碼時不會顯示。",
  "- **TLS verification** — whether to skip it, since vCenter ships a self-signed certificate by default; and the **collection interval** (`2m`).":
    "- **TLS 驗證**：是否略過，因為 vCenter 預設使用自我簽署憑證；以及 **收集間隔**（`2m`）。",
  "- **OneUptime AI agent** — whether it may apply fixes; answer **N** to keep it read-only.":
    "- **OneUptime AI 代理程式**：是否允許它套用修復；回答 **N** 可讓它維持唯讀。",
  "It installs to `/opt/oneuptime-vmware-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Values are quoted for Docker Compose as they are written, so a password containing `$`, `#`, spaces or quotes works exactly as typed, and re-running the script reuses everything in an existing `.env` instead of prompting again.":
    "它會安裝到 `/opt/oneuptime-vmware-agent`，寫入一個權限為 `0600` 的 `.env` 檔案，並用 Docker Compose 啟動代理程式。值會依照輸入的原樣為 Docker Compose 加上引號，因此包含 `$`、`#`、空格或引號的密碼會完全依你輸入的方式生效；再次執行指令碼時，它會重複使用現有 `.env` 中的所有內容，而不會再次詢問。",
  "Look for `Everything is ready. Begin running and processing data.` in the logs — then give it one collection interval (2 minutes by default): nothing is sent until the first full inventory walk completes. The vCenter then appears automatically in the **VMware** section, with its datacenters, clusters, ESXi hosts, virtual machines, datastores and resource pools inventoried.":
    "在日誌中尋找 `Everything is ready. Begin running and processing data.`——然後等待一個收集間隔（預設 2 分鐘）：在第一次完整走訪詳細目錄之前不會傳送任何資料。之後該 vCenter 會自動出現在 **VMware** 區段，其資料中心、叢集、ESXi 主機、虛擬機器、資料存放區與資源集區都會列入詳細目錄。",
  "`docker compose ps` also lists **`oneuptime-vmware-ai-agent`**, the OneUptime AI agent — see **OneUptime AI agent** under Advanced.":
    "`docker compose ps` 也會列出 OneUptime AI 代理程式 **`oneuptime-vmware-ai-agent`**——請參見「進階」中的 **OneUptime AI 代理程式**。",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this vCenter with read-only `govc` commands, and changes nothing unless you allow fixes.":
    "**OneUptime AI 代理程式（預設開啟，唯讀）。** AI 調查已開啟：它讓 OneUptime AI 用唯讀的 `govc` 指令調查此 vCenter 上的事件與警示，除非你允許修復，否則不會變更任何內容。",
  "The install script writes these to `/opt/oneuptime-vmware-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-vmware-agent`.":
    "安裝指令碼會把這些寫入 `/opt/oneuptime-vmware-agent/.env`。變更其中任何一項後，在 `/opt/oneuptime-vmware-agent` 中用 `docker compose up -d` 套用。",
  "| Variable | Required | Description |": "| 變數 | 必填 | 說明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 執行個體的 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 是 | 遙測擷取金鑰，即第 1 步中選擇的那個 |",
  "| `VMWARE_VCENTER_NAME` | Yes | The name this vCenter registers under in OneUptime. Stamped on every metric as the `vmware.vcenter.name` resource attribute. Keep it stable — changing it registers a new vCenter (default: `vmware-vcenter`) |":
    "| `VMWARE_VCENTER_NAME` | 是 | 此 vCenter 在 OneUptime 中註冊所用的名稱。以 `vmware.vcenter.name` 資源屬性的形式標記在每筆指標上。請保持不變——變更它會註冊一個新的 vCenter（預設：`vmware-vcenter`） |",
  "| `VCENTER_ENDPOINT` | Yes | Scheme + host of vCenter Server or a standalone ESXi host, **without** `/sdk`, e.g. `https://vcsa.example.com` |":
    "| `VCENTER_ENDPOINT` | 是 | vCenter Server 或獨立 ESXi 主機的通訊協定 + 主機，**不加** `/sdk`，例如 `https://vcsa.example.com` |",
  "| `VCENTER_USERNAME` | Yes | vSphere user with the Read-Only role, e.g. `oneuptime@vsphere.local` (or `DOMAIN\\user` for an Active Directory identity source) |":
    "| `VCENTER_USERNAME` | 是 | 具有 Read-Only 角色的 vSphere 使用者，例如 `oneuptime@vsphere.local`（Active Directory 身分識別來源則為 `DOMAIN\\user`） |",
  "| `VCENTER_PASSWORD` | Yes | That user's password. If it contains `$`, `#`, spaces or quotes, single-quote it in `.env` (the install script does this for you) |":
    "| `VCENTER_PASSWORD` | 是 | 該使用者的密碼。如果包含 `$`、`#`、空格或引號，請在 `.env` 中用單引號括起來（安裝指令碼會替你這麼做） |",
  "| `VCENTER_INSECURE_SKIP_VERIFY` | No | `true` to accept vCenter's default self-signed (VMCA) certificate; `false` keeps TLS verification on (default: `false`) |":
    "| `VCENTER_INSECURE_SKIP_VERIFY` | 否 | 設為 `true` 以接受 vCenter 預設的自我簽署（VMCA）憑證；`false` 讓 TLS 驗證保持開啟（預設：`false`） |",
  "| `VCENTER_COLLECTION_INTERVAL` | No | How often the whole inventory is polled. Raise to `5m` or `10m` for very large vCenters (default: `2m`) |":
    "| `VCENTER_COLLECTION_INTERVAL` | 否 | 輪詢整個詳細目錄的頻率。對於非常大的 vCenter，可提高到 `5m` 或 `10m`（預設：`2m`） |",
  "The OneUptime AI agent's own settings are under **OneUptime AI agent**.":
    "OneUptime AI 代理程式本身的設定請見 **OneUptime AI 代理程式** 一節。",
  "This is the `docker-compose.yml` the agent runs (the `.env` file supplies the values). The collector image is pinned; when a newer OneUptime release bumps the pin, download both files again before pulling:":
    "這是代理程式執行的 `docker-compose.yml`（值由 `.env` 檔案提供）。收集器映像檔的版本是固定的；當較新的 OneUptime 版本提高了固定的版本時，請在提取之前重新下載這兩個檔案：",
  "And the full `otel-collector-config.yaml`. The `resource` processor stamps the `vmware.vcenter.name` attribute that registers the vCenter in OneUptime and that every VMware page, monitor and alert template scopes on — keep it in place if you customize the config. The `batch` processor deliberately has no `send_batch_max_size`: OneUptime reads a whole collection per request to sum inventory counts and infer VM power state, so a collection must never be split across exports:":
    "以及完整的 `otel-collector-config.yaml`。`resource` 處理器會標記 `vmware.vcenter.name` 屬性：vCenter 憑它在 OneUptime 中註冊，每個 VMware 頁面、監視器與警示範本也都以它限定範圍——自訂組態時請保留它。`batch` 處理器刻意不設 `send_batch_max_size`：OneUptime 每個請求讀取一次完整的收集，用來加總詳細目錄計數並推斷虛擬機器的電源狀態，因此一次收集絕不能拆分到多次匯出中：",
  "Every `VCENTER_COLLECTION_INTERVAL` the receiver walks the full vSphere inventory and emits one OpenTelemetry resource per object. Identity lives in **resource attributes** — `vcenter.datacenter.name`, `vcenter.cluster.name`, `vcenter.host.name`, `vcenter.vm.name` / `vcenter.vm.id`, `vcenter.datastore.name`, `vcenter.resource_pool.name` / `vcenter.resource_pool.inventory_path` — and the agent adds `vmware.vcenter.name` on top so OneUptime can route everything to your vCenter.":
    "每隔一個 `VCENTER_COLLECTION_INTERVAL`，接收器會走訪整個 vSphere 詳細目錄，並為每個物件發出一個 OpenTelemetry 資源。識別資訊位於 **資源屬性** 中——`vcenter.datacenter.name`、`vcenter.cluster.name`、`vcenter.host.name`、`vcenter.vm.name` / `vcenter.vm.id`、`vcenter.datastore.name`、`vcenter.resource_pool.name` / `vcenter.resource_pool.inventory_path`——代理程式還會在此之上加入 `vmware.vcenter.name`，讓 OneUptime 能把所有資料都歸到你的 vCenter。",
  "| vSphere object | Identity (resource attributes) | Metrics |":
    "| vSphere 物件 | 識別資訊（資源屬性） | 指標 |",
  "| **Datacenter** | `vcenter.datacenter.name` | `vcenter.datacenter.cluster.count{status}`, `.host.count{status,power_state}`, `.vm.count{status,power_state}`, `.datastore.count`, `.disk.space{disk_state}`, `.cpu.limit`, `.memory.limit` |":
    "| **資料中心** | `vcenter.datacenter.name` | `vcenter.datacenter.cluster.count{status}`, `.host.count{status,power_state}`, `.vm.count{status,power_state}`, `.datastore.count`, `.disk.space{disk_state}`, `.cpu.limit`, `.memory.limit` |",
  "| **Cluster** | + `vcenter.cluster.name` | `vcenter.cluster.cpu.effective`, `.cpu.limit`, `.memory.effective`, `.memory.limit`, `.host.count{effective}`, `.vm.count{power_state}`, `.vm_template.count`, `vcenter.cluster.vsan.*` |":
    "| **叢集** | + `vcenter.cluster.name` | `vcenter.cluster.cpu.effective`, `.cpu.limit`, `.memory.effective`, `.memory.limit`, `.host.count{effective}`, `.vm.count{power_state}`, `.vm_template.count`, `vcenter.cluster.vsan.*` |",
  "| **ESXi host** | + `vcenter.host.name` (and `vcenter.cluster.name` when clustered) | `vcenter.host.cpu.usage` / `.capacity` / `.utilization` / `.reserved`, `.memory.usage` / `.utilization` / `.capacity`, `.disk.latency.avg` / `.latency.max` / `.throughput`, `.network.usage` / `.throughput` / `.packet.rate` / `.packet.drop.rate` / `.packet.error.rate`, `vcenter.host.vsan.*` |":
    "| **ESXi 主機** | + `vcenter.host.name`（位於叢集中時還有 `vcenter.cluster.name`） | `vcenter.host.cpu.usage` / `.capacity` / `.utilization` / `.reserved`, `.memory.usage` / `.utilization` / `.capacity`, `.disk.latency.avg` / `.latency.max` / `.throughput`, `.network.usage` / `.throughput` / `.packet.rate` / `.packet.drop.rate` / `.packet.error.rate`, `vcenter.host.vsan.*` |",
  "| **Virtual machine** | + `vcenter.host.name`, `vcenter.vm.name`, `vcenter.vm.id` (instance UUID); `vcenter.resource_pool.*` or `vcenter.virtual_app.*` | `vcenter.vm.disk.usage{disk_state}`, `.disk.utilization`, `.memory.usage` / `.utilization` / `.ballooned` / `.swapped` / `.swapped_ssd`; **powered-on VMs only:** `.cpu.usage`, `.cpu.readiness`, `.cpu.utilization`, `.disk.latency.*` / `.throughput`, `.network.*`, `vcenter.vm.vsan.*` |":
    "| **虛擬機器** | + `vcenter.host.name`、`vcenter.vm.name`、`vcenter.vm.id`（執行個體 UUID）；`vcenter.resource_pool.*` 或 `vcenter.virtual_app.*` | `vcenter.vm.disk.usage{disk_state}`, `.disk.utilization`, `.memory.usage` / `.utilization` / `.ballooned` / `.swapped` / `.swapped_ssd`；**僅限已開機的虛擬機器：** `.cpu.usage`, `.cpu.readiness`, `.cpu.utilization`, `.disk.latency.*` / `.throughput`, `.network.*`, `vcenter.vm.vsan.*` |",
  "| **VM template** | `vcenter.vm_template.name`, `vcenter.vm_template.id` | `vcenter.vm.disk.usage{disk_state}` only |":
    "| **虛擬機器範本** | `vcenter.vm_template.name`、`vcenter.vm_template.id` | 僅 `vcenter.vm.disk.usage{disk_state}` |",
  "| **Datastore** | + `vcenter.datastore.name` | `vcenter.datastore.disk.usage{disk_state}`, `.disk.utilization` |":
    "| **資料存放區** | + `vcenter.datastore.name` | `vcenter.datastore.disk.usage{disk_state}`, `.disk.utilization` |",
  "| **Resource pool** | + `vcenter.resource_pool.name`, `vcenter.resource_pool.inventory_path` | `vcenter.resource_pool.cpu.usage` / `.cpu.shares`, `.memory.usage{type}` / `.memory.shares` / `.memory.ballooned` / `.memory.swapped` / `.memory.granted{type}` |":
    "| **資源集區** | + `vcenter.resource_pool.name`、`vcenter.resource_pool.inventory_path` | `vcenter.resource_pool.cpu.usage` / `.cpu.shares`, `.memory.usage{type}` / `.memory.shares` / `.memory.ballooned` / `.memory.swapped` / `.memory.granted{type}` |",
  "Datapoint attributes (`{...}` above) are what you filter and group by in monitor criteria: `direction` (`read`/`write`, `transmitted`/`received`), `disk_state` (`available`/`used`), `status` (`red`/`yellow`/`green`/`gray`), `effective` (`true`/`false`), `power_state` (`on`/`off`/`standby`/`suspended`/`unknown`), `object` (the NIC or disk instance), `cpu_reservation_type` (`total`/`used`) and `type`. In OneUptime, resource attributes are `resource.`-prefixed (`resource.vcenter.host.name`) and datapoint attributes are bare (`disk_state`). Units are the receiver's own: MHz for CPU usage and capacity, `%` for utilization and CPU readiness, MiB for host/VM/resource-pool memory, bytes for cluster and datacenter memory and all disk space, `ms` for disk latency and `µs` for vSAN latency.":
    "資料點屬性（上方的 `{...}`）是你在監視器條件中用來篩選與分組的依據：`direction`（`read`/`write`、`transmitted`/`received`）、`disk_state`（`available`/`used`）、`status`（`red`/`yellow`/`green`/`gray`）、`effective`（`true`/`false`）、`power_state`（`on`/`off`/`standby`/`suspended`/`unknown`）、`object`（網路卡或磁碟執行個體）、`cpu_reservation_type`（`total`/`used`）以及 `type`。在 OneUptime 中，資源屬性帶有 `resource.` 前置詞（`resource.vcenter.host.name`），資料點屬性則不帶前置詞（`disk_state`）。單位沿用接收器本身的：CPU 使用量與容量用 MHz，使用率與 CPU 就緒度用 `%`，主機、虛擬機器與資源集區的記憶體用 MiB，叢集與資料中心的記憶體以及所有磁碟空間用位元組，磁碟延遲用 `ms`，vSAN 延遲用 `µs`。",
  "The receiver does not export a per-VM power-state metric. Instead it emits `vcenter.vm.cpu.*` **only for powered-on VMs**, so OneUptime infers the state from what arrived in each collection: a VM that reported CPU metrics is *powered on*; one that reported only memory and disk usage is *powered off* (or suspended — vSphere does not tell them apart here). This inference reads a whole collection at a time, which is why the shipped `batch` processor has a large `send_batch_size` and deliberately no `send_batch_max_size`: a collection split across two exports would zero inventory counts and flip VMs to off. Keep the batch settings as shipped.":
    "接收器不會匯出依虛擬機器區分的電源狀態指標。它 **只為已開機的虛擬機器** 發出 `vcenter.vm.cpu.*`，因此 OneUptime 會根據每次收集中送達的內容推斷狀態：回報了 CPU 指標的虛擬機器是 *已開機*；只回報了記憶體與磁碟使用量的虛擬機器是 *已關機*（或已暫停——vSphere 在這裡不區分兩者）。這種推斷一次讀取一整次收集，所以隨附的 `batch` 處理器設定了較大的 `send_batch_size`，並刻意不設 `send_batch_max_size`：一次收集若拆分到兩次匯出中，會讓詳細目錄計數歸零，並把虛擬機器翻轉為關機。請讓 batch 設定維持原樣。",
  "By default the agent ships **metrics only** — the Logs tab of the vCenter dashboard stays empty until you enable a log receiver. The shipped config contains a commented-out `syslog` receiver pair (TCP and UDP on port 5514, RFC 3164 — ESXi's native format) wired to a commented `logs` pipeline that stamps `vmware.vcenter.name` so the logs land on this vCenter.":
    "預設情況下，代理程式 **只傳送指標**——在你啟用日誌接收器之前，vCenter 儀表板的「日誌」索引標籤會一直是空的。隨附的組態中包含一對已註解掉的 `syslog` 接收器（連接埠 5514 上的 TCP 與 UDP，RFC 3164——ESXi 的原生格式），連接到一條已註解掉的 `logs` 管線，該管線會標記 `vmware.vcenter.name`，讓日誌落到此 vCenter 上。",
  "1. **Uncomment the two `syslog/*` receivers and the `logs` pipeline** in `otel-collector-config.yaml`.":
    "1. 在 `otel-collector-config.yaml` 中 **取消註解兩個 `syslog/*` 接收器與 `logs` 管線**。",
  "2. **Uncomment the `ports:` block** in `docker-compose.yml`, then apply it — and open the port on the machine's firewall for the ESXi management network:":
    "2. 在 `docker-compose.yml` 中 **取消註解 `ports:` 區塊**，然後套用，並在機器的防火牆上為 ESXi 管理網路開放該連接埠：",
  "3. **Point every ESXi host at the agent.** Select the host, open *Configure → System → Advanced System Settings*, set `Syslog.global.logHost` to `udp://<agent-host>:5514` (or `tcp://`), then allow the outbound traffic under *Configure → System → Firewall → Edit → syslog*. Or per host with `esxcli`:":
    "3. **讓每台 ESXi 主機指向代理程式。** 選取主機，開啟 *Configure → System → Advanced System Settings*，將 `Syslog.global.logHost` 設為 `udp://<agent-host>:5514`（或 `tcp://`），然後在 *Configure → System → Firewall → Edit → syslog* 下允許輸出流量。也可以用 `esxcli` 逐台主機設定：",
  "Any resource attribute prefixed with `oneuptime.label.` is promoted to a project label and attached to the vCenter. Add the attributes to the `resource` processor in `otel-collector-config.yaml`, next to `vmware.vcenter.name`:":
    "任何以 `oneuptime.label.` 為前置詞的資源屬性都會升級為專案標籤並附加到 vCenter 上。在 `otel-collector-config.yaml` 的 `resource` 處理器中，於 `vmware.vcenter.name` 旁加入這些屬性：",
  "Then restart the collector so it reads the new config:":
    "然後重新啟動收集器，讓它讀取新組態：",
  "The vCenter shows up tagged `team:platform` and `env:production`. Labels added manually in the OneUptime UI are never removed by the agent.":
    "該 vCenter 會帶著 `team:platform` 與 `env:production` 標籤顯示。在 OneUptime 介面中手動加入的標籤永遠不會被代理程式移除。",
  "`docker-compose.yml` also runs **`oneuptime-vmware-ai-agent`**. While OneUptime AI investigates an incident or alert on this vCenter, it runs `govc` commands through it — a VM's power state, the host it runs on, recent events and tasks, performance counters. It logs in with the vCenter credentials from the same `.env` (OneUptime never sends it any), registers as the vCenter named `VMWARE_VCENTER_NAME`, and appears on the vCenter's **AI → AI agent** page.":
    "`docker-compose.yml` 也會執行 **`oneuptime-vmware-ai-agent`**。當 OneUptime AI 調查此 vCenter 上的事件或警示時，會透過它執行 `govc` 指令——虛擬機器的電源狀態、它所在的主機、最近的事件與工作、效能計數器。它使用同一個 `.env` 中的 vCenter 認證資訊登入（OneUptime 從不傳送任何認證資訊給它），註冊為名為 `VMWARE_VCENTER_NAME` 的 vCenter，並出現在該 vCenter 的 **人工智慧 → AI 代理程式** 頁面上。",
  "- **The vSphere role is the hard limit.** With the collector's Read-Only user it can read and nothing else.":
    "- **vSphere 角色是硬性上限。** 使用收集器的 Read-Only 使用者時，它只能讀取，別無其他。",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — powering a VM back on, a guest reboot — also need a vSphere user of its own whose role allows them, set as `ONEUPTIME_AI_VCENTER_USERNAME` / `ONEUPTIME_AI_VCENTER_PASSWORD`; the agent's README has the `govc` commands for that role. The install script asks about fixes on a fresh install and writes these settings for you.":
    "- 除非設定 `ONEUPTIME_AI_ALLOW_WRITES=true`，否則它是 **唯讀** 的。修復動作（重新開啟虛擬機器電源、重新開機客體作業系統）還需要一個專用的 vSphere 使用者，其角色允許這些動作，透過 `ONEUPTIME_AI_VCENTER_USERNAME` / `ONEUPTIME_AI_VCENTER_PASSWORD` 設定；代理程式的 README 列有該角色所需的 `govc` 指令。全新安裝時，安裝指令碼會詢問是否允許修復，並替你寫入這些設定。",
  "- It never changes the VM named after the host in `VCENTER_ENDPOINT` — normally the vCenter appliance. When the endpoint is an IP address, or the appliance's VM has another name, put that VM's name in `ONEUPTIME_AI_PROTECTED_TARGETS`, together with the VM the agent runs on.":
    "- 它從不變更以 `VCENTER_ENDPOINT` 中的主機命名的虛擬機器——通常就是 vCenter 應用裝置。當端點是 IP 位址，或應用裝置的虛擬機器另有名稱時，請把該虛擬機器的名稱連同代理程式所在的虛擬機器一起放入 `ONEUPTIME_AI_PROTECTED_TARGETS`。",
  "- Check it: `docker exec oneuptime-vmware-ai-agent wget -qO- http://127.0.0.1:3877/status`":
    "- 檢查它：`docker exec oneuptime-vmware-ai-agent wget -qO- http://127.0.0.1:3877/status`",
  "- Not using OneUptime AI? Delete the `oneuptime-vmware-ai-agent` service from `docker-compose.yml`.":
    "- 不使用 OneUptime AI？從 `docker-compose.yml` 中刪除 `oneuptime-vmware-ai-agent` 服務。",
  "What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#vmware-vcenter).":
    "它可以執行什麼，以及修復如何運作：[基礎架構 AI 代理程式](/docs/ai/infrastructure-ai-agents#vmware-vcenter)。",
  "**Upgrade** — re-run the install script. It reuses every value in your existing `.env` (nothing is prompted for again), downloads the latest `docker-compose.yml` and `otel-collector-config.yaml`, and recreates the agent with them:":
    "**升級**——重新執行安裝指令碼。它會重複使用現有 `.env` 中的每個值（不會再次詢問），下載最新的 `docker-compose.yml` 與 `otel-collector-config.yaml`，並用它們重新建立代理程式：",
  "The config reports the collector version it pins as the vCenter's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "該組態會把它固定的收集器版本回報為 vCenter 的 **代理程式版本**。當此 OneUptime 固定了更新的版本時，旁邊的警告標誌會開啟這些指令。",
  "**Uninstall:**": "**解除安裝：**",
  "Then remove the `oneuptime` user's permission in vCenter (and the OneUptime AI fixes user's, if you created one) if you no longer need it.":
    "如果不再需要，再在 vCenter 中移除 `oneuptime` 使用者的權限（如果你建立了 OneUptime AI 修復使用者，也一併移除它的權限）。",
  "`troubleshoot.sh` checks the whole chain — container runtime, vCenter reachability and credentials, vCenter-name stamping, token shape, collector self-metrics — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss, so the script asks `GET /otlp/v1/validate` for a direct 200/401 verdict.":
    "`troubleshoot.sh` 會檢查整條鏈路——容器執行階段、vCenter 的連線能力與認證資訊、vCenter 名稱的標記、權杖格式、收集器本身的指標——並直接詢問 OneUptime 是否接受你的擷取金鑰。最後這項檢查最重要：OneUptime 的 OTLP 端點會以 `401` 或 `422` 拒絕錯誤的金鑰，而收集器只會為每個 batch 記錄一行很容易漏看的 `Exporting failed`，因此指令碼會向 `GET /otlp/v1/validate` 要求一個直接的 200/401 判定。",
  "It ends with a verdict naming the most likely cause.":
    "最後它會給出判定，指出最可能的原因。",
  "1. Check that the agent is running (in `/opt/oneuptime-vmware-agent`): `docker compose ps`":
    "1. 檢查代理程式是否在執行（在 `/opt/oneuptime-vmware-agent` 中）：`docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-vmware-agent | grep -i error`":
    "2. 檢查代理程式日誌中的錯誤：`docker compose logs oneuptime-vmware-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. 確認你的 OneUptime URL 與擷取金鑰正確。",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. 確定代理程式所在的機器能透過網路連到 OneUptime 執行個體。",
  "1. Check the collector logs: a login error (`incorrect user name or password`, `InvalidLogin`) means bad credentials — or a password containing `$`, `#`, spaces or quotes that is not single-quoted in `.env` (Docker Compose expands `$VAR` and treats a space followed by `#` as a comment otherwise), `x509: certificate signed by unknown authority` means TLS verification is on against a self-signed certificate (set `VCENTER_INSECURE_SKIP_VERIFY=true`), `connection refused` / `no such host` means a wrong `VCENTER_ENDPOINT`.":
    "1. 檢查收集器日誌：登入錯誤（`incorrect user name or password`、`InvalidLogin`）表示認證資訊有誤——或者是密碼包含 `$`、`#`、空格或引號，卻沒有在 `.env` 中用單引號括起來（否則 Docker Compose 會展開 `$VAR`，並把空格後接 `#` 視為註解）；`x509: certificate signed by unknown authority` 表示在使用自我簽署憑證時開啟了 TLS 驗證（設定 `VCENTER_INSECURE_SKIP_VERIFY=true`）；`connection refused` / `no such host` 表示 `VCENTER_ENDPOINT` 有誤。",
  "2. Verify the endpoint is reachable from the agent's network (the collector image is distroless, so test from alongside it) — you should see an XML document advertising `urn:vim25`:":
    "2. 確認從代理程式所在的網路能連到端點（收集器映像檔是 distroless 的，因此請在它旁邊的機器上測試）——你應該會看到一份宣告 `urn:vim25` 的 XML 文件：",
  "3. Make sure `VMWARE_VCENTER_NAME` is set — discovery keys on the `vmware.vcenter.name` resource attribute.":
    "3. 確定已設定 `VMWARE_VCENTER_NAME`——探索依據的是 `vmware.vcenter.name` 資源屬性。",
  "4. Give it one collection interval: nothing is sent until the first full inventory walk completes.":
    "4. 等待一個收集間隔：在第一次完整走訪詳細目錄之前不會傳送任何資料。",
  "Use the full principal — `oneuptime@vsphere.local`, or `DOMAIN\\user` / `user@domain.example` for an Active Directory identity source — and check how the password is written in `.env`. Docker Compose expands `$VAR` references in unquoted and double-quoted values and treats a space followed by `#` as the start of a comment, so a password containing `$`, `#`, spaces or quotes must be **single-quoted** — `VCENTER_PASSWORD='p@ss$word'`, which is what the install script writes. A password that itself contains a single quote goes in double quotes, with every `$` written as `$$` and `\"` / `\\` escaped with a backslash. A locked account (too many failed attempts) rejects a correct password too; check *Administration → Single Sign On → Users and Groups*.":
    "使用完整的主體名稱（`oneuptime@vsphere.local`，Active Directory 身分識別來源則為 `DOMAIN\\user` / `user@domain.example`），並檢查密碼在 `.env` 中的寫法。Docker Compose 會展開未加引號與雙引號值中的 `$VAR` 參照，並把空格後接 `#` 視為註解的開頭，因此包含 `$`、`#`、空格或引號的密碼必須 **用單引號括起來**：`VCENTER_PASSWORD='p@ss$word'`，安裝指令碼寫入的正是這種形式。本身包含單引號的密碼要用雙引號括起來，每個 `$` 寫成 `$$`，`\"` / `\\` 則用反斜線跳脫。遭鎖定的帳戶（失敗嘗試次數過多）也會拒絕正確的密碼；請檢查 *Administration → Single Sign On → Users and Groups*。",
  "vCenter appliances present a certificate issued by their own VMCA, which no Docker image trusts. Either set `VCENTER_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network) or replace vCenter's machine certificate with one issued by a CA the collector image trusts. Do **not** point the endpoint at an `http://` URL — vCenter only serves the SDK over HTTPS.":
    "vCenter 應用裝置出示的是由其自身 VMCA 簽發的憑證，任何 Docker 映像檔都不信任它。要麼設定 `VCENTER_INSECURE_SKIP_VERIFY=true`（在私人管理網路上這是務實的選擇），要麼用收集器映像檔信任的 CA 所簽發的憑證取代 vCenter 的機器憑證。**不要** 把端點指向 `http://` URL——vCenter 只透過 HTTPS 提供 SDK。",
  "The Read-Only role was granted on the vCenter object without **Propagate to children**, or on a narrower object than the vCenter root. Objects the user cannot see are silently absent. Fix the permission on the top-level vCenter object with propagation enabled; the next collection fills in the inventory.":
    "Read-Only 角色是在沒有 **Propagate to children** 的情況下授與 vCenter 物件的，或授與了比 vCenter 根層級更窄的物件。使用者看不到的物件會無聲無息地缺席。請在最上層的 vCenter 物件上啟用傳播並修正權限；下一次收集就會填滿詳細目錄。",
  "VM power state is inferred from the `vcenter.vm.cpu.*` datapoints arriving in the same collection as the VM's memory and disk datapoints (see **How VM power state is worked out** under Advanced). If you customized the `batch` processor and added a `send_batch_max_size`, a large inventory is split across exports and the CPU datapoints land in a different request — restore the shipped batch settings.":
    "虛擬機器電源狀態的推斷依據是：`vcenter.vm.cpu.*` 資料點是否與該虛擬機器的記憶體與磁碟資料點在同一次收集中送達（請參見「進階」中的 **如何判斷虛擬機器的電源狀態**）。如果你自訂了 `batch` 處理器並加入了 `send_batch_max_size`，大型詳細目錄就會被拆分到多次匯出中，CPU 資料點會落在另一個請求裡——請還原隨附的 batch 設定。",
  "Each collection is a full walk of the inventory plus one performance query per object batch. For vCenters with thousands of VMs raise `VCENTER_COLLECTION_INTERVAL` to `5m` or `10m` (a collection that takes longer than the interval is skipped, not overlapped), match `max_query_metrics` to your vCenter's `vpxd.stats.maxQueryMetrics` if the log reports `The maximum number of performance metrics per query exceeded`, and raise `limit_mib` if the memory limiter reports dropped data.":
    "每次收集都是對詳細目錄的一次完整走訪，外加每批物件一次效能查詢。對於擁有數千台虛擬機器的 vCenter，請把 `VCENTER_COLLECTION_INTERVAL` 提高到 `5m` 或 `10m`（耗時超過間隔的收集會被略過，而不是重疊執行）；如果日誌回報 `The maximum number of performance metrics per query exceeded`，請讓 `max_query_metrics` 與你的 vCenter 的 `vpxd.stats.maxQueryMetrics` 一致；如果記憶體限制器回報捨棄了資料，請提高 `limit_mib`。",
  "The vCenter identity comes from `VMWARE_VCENTER_NAME`, stamped on every metric as `vmware.vcenter.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-vmware-agent` — note that a new name registers a new vCenter.":
    "vCenter 的識別名稱來自 `VMWARE_VCENTER_NAME`，它會以 `vmware.vcenter.name` 的形式標記在每筆指標上。在 `.env` 中修正它，並在 `/opt/oneuptime-vmware-agent` 中用 `docker compose up -d` 套用。請注意，新名稱會註冊為一個新的 vCenter。",
  "- **vCenter name** — enter **`vcenter-1`** exactly; a different name registers a new vCenter.":
    "- **vCenter 名稱**：準確輸入 **`vcenter-1`**；換一個名稱會註冊一個新的 vCenter。",
  "The vCenter identity comes from `VMWARE_VCENTER_NAME`, stamped on every metric as `vmware.vcenter.name`. This vCenter is **`vcenter-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-vmware-agent` — note that a new name registers a new vCenter.":
    "vCenter 的識別名稱來自 `VMWARE_VCENTER_NAME`，它會以 `vmware.vcenter.name` 的形式標記在每筆指標上。此 vCenter 為 **`vcenter-1`**。在 `.env` 中修正它，並在 `/opt/oneuptime-vmware-agent` 中用 `docker compose up -d` 套用。請注意，新名稱會註冊為一個新的 vCenter。",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "該指令已經帶有你的 OneUptime URL 與擷取金鑰。其餘內容由指令碼詢問：",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "從此 OneUptime 下載 `docker-compose.yml` 與 `otel-collector-config.yaml` 到一個新資料夾：",
  "Create a `.env` file next to them:": "在它們旁邊建立一個 `.env` 檔案：",
  "- Replace `my-vcenter` with a name for this vCenter, such as `vcenter-prod`. It is how the vCenter appears in OneUptime, so keep it stable: a new name registers a new vCenter.":
    "- 把 `my-vcenter` 換成此 vCenter 的名稱，例如 `vcenter-prod`。這是該 vCenter 在 OneUptime 中顯示的名稱，因此請保持不變：新名稱會註冊為一個新的 vCenter。",
  "- Set `VCENTER_ENDPOINT` to the scheme and host of your vCenter, or of a standalone ESXi host, **without** `/sdk`.":
    "- 將 `VCENTER_ENDPOINT` 設為你的 vCenter（或獨立 ESXi 主機）的通訊協定與主機，**不加** `/sdk`。",
  "- Keep the password in single quotes: Docker Compose expands `$` and treats a space followed by `#` as a comment in unquoted values.":
    "- 讓密碼保持在單引號中：在未加引號的值中，Docker Compose 會展開 `$`，並把空格後接 `#` 視為註解。",
  "- `VCENTER_INSECURE_SKIP_VERIFY=true` accepts vCenter's default self-signed (VMCA) certificate.":
    "- `VCENTER_INSECURE_SKIP_VERIFY=true` 會接受 vCenter 預設的自我簽署（VMCA）憑證。",
  "It holds a password, so make it private, then start the agent:":
    "它包含密碼，因此請把它設為只有自己可讀，然後啟動代理程式：",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步選擇一個擷取金鑰，即可填入 `<YOUR_API_KEY>`。",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "代理程式從 `docker-compose.yml` 旁邊的 `.env` 檔案讀取這些值。變更其中任何一項後，在 `docker-compose.yml` 所在的資料夾中用 `docker compose up -d` 套用。",
  "| `VCENTER_PASSWORD` | Yes | That user's password. If it contains `$`, `#`, spaces or quotes, single-quote it in `.env` — see **vCenter rejects the login** under Troubleshooting |":
    "| `VCENTER_PASSWORD` | 是 | 該使用者的密碼。如果包含 `$`、`#`、空格或引號，請在 `.env` 中用單引號括起來——請參見「疑難排解」中的 **vCenter 拒絕登入** |",
  "- It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true`. Fixes — powering a VM back on, a guest reboot — also need a vSphere user of its own whose role allows them, set as `ONEUPTIME_AI_VCENTER_USERNAME` / `ONEUPTIME_AI_VCENTER_PASSWORD`; the agent's README has the `govc` commands for that role. Set them in `.env` and run `docker compose up -d`.":
    "- 除非設定 `ONEUPTIME_AI_ALLOW_WRITES=true`，否則它是 **唯讀** 的。修復動作（重新開啟虛擬機器電源、重新開機客體作業系統）還需要一個專用的 vSphere 使用者，其角色允許這些動作，透過 `ONEUPTIME_AI_VCENTER_USERNAME` / `ONEUPTIME_AI_VCENTER_PASSWORD` 設定；代理程式的 README 列有該角色所需的 `govc` 指令。在 `.env` 中設定它們，然後執行 `docker compose up -d`。",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "在代理程式的資料夾（也就是 `docker-compose.yml` 所在的資料夾）中執行這些指令。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download `docker-compose.yml` and `otel-collector-config.yaml` again; your `.env` stays, and a change you made to either file has to be made again:":
    "**升級**——收集器映像檔固定在 `docker-compose.yml` 中，其組態是旁邊的一個檔案，因此光是提取映像檔並不能讓代理程式更新。重新下載 `docker-compose.yml` 與 `otel-collector-config.yaml`；你的 `.env` 會保留，而你對這兩個檔案做過的變更需要重新做一遍：",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "然後提取映像檔並重新建立代理程式，讓收集器讀取新組態：",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. 檢查代理程式是否在執行（在代理程式資料夾中）：`docker compose ps`",
  "Use the full principal — `oneuptime@vsphere.local`, or `DOMAIN\\user` / `user@domain.example` for an Active Directory identity source — and check how the password is written in `.env`. Docker Compose expands `$VAR` references in unquoted and double-quoted values and treats a space followed by `#` as the start of a comment, so a password containing `$`, `#`, spaces or quotes must be **single-quoted** — `VCENTER_PASSWORD='p@ss$word'`. A password that itself contains a single quote goes in double quotes, with every `$` written as `$$` and `\"` / `\\` escaped with a backslash. A locked account (too many failed attempts) rejects a correct password too; check *Administration → Single Sign On → Users and Groups*.":
    "使用完整的主體名稱（`oneuptime@vsphere.local`，Active Directory 身分識別來源則為 `DOMAIN\\user` / `user@domain.example`），並檢查密碼在 `.env` 中的寫法。Docker Compose 會展開未加引號與雙引號值中的 `$VAR` 參照，並把空格後接 `#` 視為註解的開頭，因此包含 `$`、`#`、空格或引號的密碼必須 **用單引號括起來**：`VCENTER_PASSWORD='p@ss$word'`。本身包含單引號的密碼要用雙引號括起來，每個 `$` 寫成 `$$`，`\"` / `\\` 則用反斜線跳脫。遭鎖定的帳戶（失敗嘗試次數過多）也會拒絕正確的密碼；請檢查 *Administration → Single Sign On → Users and Groups*。",
  "The vCenter identity comes from `VMWARE_VCENTER_NAME`, stamped on every metric as `vmware.vcenter.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new vCenter.":
    "vCenter 的識別名稱來自 `VMWARE_VCENTER_NAME`，它會以 `vmware.vcenter.name` 的形式標記在每筆指標上。在 `.env` 中修正它，並在 `docker-compose.yml` 所在的資料夾中用 `docker compose up -d` 套用。請注意，新名稱會註冊為一個新的 vCenter。",
  "- This installs the agent for **`vcenter-1`** — keep `VMWARE_VCENTER_NAME` exactly as it is, or the data registers as a new vCenter.":
    "- 這會為 **`vcenter-1`** 安裝代理程式——請讓 `VMWARE_VCENTER_NAME` 維持原樣，否則資料會註冊為一個新的 vCenter。",
  "The vCenter identity comes from `VMWARE_VCENTER_NAME`, stamped on every metric as `vmware.vcenter.name`. This vCenter is **`vcenter-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml` — note that a new name registers a new vCenter.":
    "vCenter 的識別名稱來自 `VMWARE_VCENTER_NAME`，它會以 `vmware.vcenter.name` 的形式標記在每筆指標上。此 vCenter 為 **`vcenter-1`**。在 `.env` 中修正它，並在 `docker-compose.yml` 所在的資料夾中用 `docker compose up -d` 套用。請注意，新名稱會註冊為一個新的 vCenter。",
  "A Linux machine (x86_64 or arm64) with systemd 235 or later — Ubuntu 18.04, Debian 10, RHEL 8 or newer — and `sudo`, that can reach vCenter over HTTPS (TCP 443) — ideally not a VM on the cluster it watches":
    "一台 Linux 機器（x86_64 或 arm64），具備 systemd 235 或更新版本（Ubuntu 18.04、Debian 10、RHEL 8 或更新版本）與 `sudo`，能透過 HTTPS（TCP 443）連到 vCenter——最好不是它所監視的叢集上的虛擬機器",
  "Run these on the Linux machine that will host the agent. They download `otelcol-contrib` 0.165.0 — the release of the upstream OpenTelemetry Collector the agent pins — with the agent's `otel-collector-config.yaml` and its systemd unit from this OneUptime, and install them to `/opt/oneuptime-vmware-agent`:":
    "在將要執行代理程式的 Linux 機器上執行這些指令。它們會從此 OneUptime 下載 `otelcol-contrib` 0.165.0（代理程式固定使用的上游 OpenTelemetry Collector 版本），連同代理程式的 `otel-collector-config.yaml` 及其 systemd 單元，並安裝到 `/opt/oneuptime-vmware-agent`：",
  "The agent's settings go in `/opt/oneuptime-vmware-agent/.env`. It holds a password, so make it readable by root alone, then open it (`sudoedit` uses your `$EDITOR`):":
    "代理程式的設定寫在 `/opt/oneuptime-vmware-agent/.env` 中。它包含密碼，因此請讓它只有 root 可讀，然後開啟它（`sudoedit` 會使用你的 `$EDITOR`）：",
  "Put this in it:": "寫入以下內容：",
  '- Keep the user name and the password in double quotes, with each `\\` written `\\\\` and each `"` written `\\"` — `DOMAIN\\user` is `"DOMAIN\\\\user"` — while `$`, `#`, `\'` and spaces go in as they are. systemd reads this file, not a shell, and this is the form every systemd version reads the same: older ones (RHEL 8\'s, for one) drop a backslash even inside single quotes.':
    '- 使用者名稱與密碼要放在雙引號中，每個 `\\` 寫成 `\\\\`，每個 `"` 寫成 `\\"`（`DOMAIN\\user` 寫作 `"DOMAIN\\\\user"`），而 `$`、`#`、`\'` 與空格則照原樣寫入。讀取這個檔案的是 systemd 而不是 shell，這是所有 systemd 版本都以同樣方式讀取的形式：較舊的版本（例如 RHEL 8 中的版本）即使在單引號內也會去掉反斜線。',
  "Then start the agent, and have it start on every boot:":
    "然後啟動代理程式，並讓它在每次開機時啟動：",
  "systemd runs the collector as a throwaway unprivileged user, with no capabilities and nothing it can write to. This install runs the collector alone: the OneUptime AI agent ships only as a container image — see **OneUptime AI agent** under Advanced.":
    "systemd 以一個用完即丟的非特權使用者執行收集器，不授與任何 capabilities，也沒有任何它可以寫入的位置。此安裝只執行收集器：OneUptime AI 代理程式只以容器映像檔的形式提供——請參見「進階」中的 **OneUptime AI 代理程式**。",
  "The service should be `active (running)`. Look for `Everything is ready. Begin running and processing data.` in the log — then give it one collection interval (2 minutes by default): nothing is sent until the first full inventory walk completes. The vCenter then appears automatically in the **VMware** section, with its datacenters, clusters, ESXi hosts, virtual machines, datastores and resource pools inventoried.":
    "服務應處於 `active (running)` 狀態。在日誌中尋找 `Everything is ready. Begin running and processing data.`——然後等待一個收集間隔（預設 2 分鐘）：在第一次完整走訪詳細目錄之前不會傳送任何資料。之後該 vCenter 會自動出現在 **VMware** 區段，其資料中心、叢集、ESXi 主機、虛擬機器、資料存放區與資源集區都會列入詳細目錄。",
  "The service reads these from `/opt/oneuptime-vmware-agent/.env`, the defaults included: its systemd unit sets them when the file leaves them out. After changing one, apply it with `sudo systemctl restart oneuptime-vmware-agent`.":
    "服務從 `/opt/oneuptime-vmware-agent/.env` 讀取這些值，包括預設值：檔案中省略的值由其 systemd 單元設定。變更其中任何一項後，用 `sudo systemctl restart oneuptime-vmware-agent` 套用。",
  "| `VCENTER_USERNAME` | Yes | vSphere user with the Read-Only role, e.g. `oneuptime@vsphere.local` (or `DOMAIN\\user` for an Active Directory identity source), double-quoted in `.env` with each `\\` written `\\\\` |":
    "| `VCENTER_USERNAME` | 是 | 具有 Read-Only 角色的 vSphere 使用者，例如 `oneuptime@vsphere.local`（Active Directory 身分識別來源則為 `DOMAIN\\user`），在 `.env` 中用雙引號括起來，每個 `\\` 寫成 `\\\\` |",
  '| `VCENTER_PASSWORD` | Yes | That user\'s password, double-quoted in `.env` with each `\\` written `\\\\` and each `"` written `\\"`, the form every systemd version reads as typed — see **vCenter rejects the login** under Troubleshooting |':
    '| `VCENTER_PASSWORD` | 是 | 該使用者的密碼，在 `.env` 中用雙引號括起來，每個 `\\` 寫成 `\\\\`，每個 `"` 寫成 `\\"`，這是所有 systemd 版本都照輸入原樣讀取的形式——請參見「疑難排解」中的 **vCenter 拒絕登入** |',
  "This is the systemd unit the agent runs, installed as `/etc/systemd/system/oneuptime-vmware-agent.service` (`/opt/oneuptime-vmware-agent/.env` supplies the values). It runs the collector as a throwaway unprivileged user with no capabilities, and serves the collector's own metrics on `127.0.0.1:8890` rather than the usual `8888`, so the agent runs beside another OpenTelemetry Collector on the same machine:":
    "這是代理程式執行的 systemd 單元，安裝為 `/etc/systemd/system/oneuptime-vmware-agent.service`（值由 `/opt/oneuptime-vmware-agent/.env` 提供）。它以一個沒有 capabilities、用完即丟的非特權使用者執行收集器，並在 `127.0.0.1:8890` 而不是通常的 `8888` 上提供收集器本身的指標，這樣代理程式就能與同一台機器上的另一個 OpenTelemetry Collector 並存執行：",
  "And the full `otel-collector-config.yaml`, in `/opt/oneuptime-vmware-agent` — the same file the Docker install runs. The `resource` processor stamps the `vmware.vcenter.name` attribute that registers the vCenter in OneUptime and that every VMware page, monitor and alert template scopes on — keep it in place if you customize the config. The `batch` processor deliberately has no `send_batch_max_size`: OneUptime reads a whole collection per request to sum inventory counts and infer VM power state, so a collection must never be split across exports:":
    "以及位於 `/opt/oneuptime-vmware-agent` 中的完整 `otel-collector-config.yaml`——與 Docker 安裝執行的是同一個檔案。`resource` 處理器會標記 `vmware.vcenter.name` 屬性：vCenter 憑它在 OneUptime 中註冊，每個 VMware 頁面、監視器與警示範本也都以它限定範圍——自訂組態時請保留它。`batch` 處理器刻意不設 `send_batch_max_size`：OneUptime 每個請求讀取一次完整的收集，用來加總詳細目錄計數並推斷虛擬機器的電源狀態，因此一次收集絕不能拆分到多次匯出中：",
  "1. **Uncomment the two `syslog/*` receivers and the `logs` pipeline** in `/opt/oneuptime-vmware-agent/otel-collector-config.yaml` (`sudoedit` it).":
    "1. 在 `/opt/oneuptime-vmware-agent/otel-collector-config.yaml` 中 **取消註解兩個 `syslog/*` 接收器與 `logs` 管線**（用 `sudoedit` 編輯）。",
  "2. **Restart the agent** — the collector listens on this machine itself, so there is no port to publish — and open port 5514 (TCP and UDP) on the machine's firewall for the ESXi management network:":
    "2. **重新啟動代理程式**——收集器就在這台機器上接聽，因此不需要發布連接埠——並在機器的防火牆上為 ESXi 管理網路開放連接埠 5514（TCP 與 UDP）：",
  "The OneUptime AI agent runs the read-only `govc` commands OneUptime AI asks for while it investigates an incident or alert on this vCenter — a VM's power state, the host it runs on, recent events and tasks, performance counters. It ships only as a container image (`oneuptime/resource-ai-agent`), so an install without Docker runs the collector alone. Inventory, metrics, monitors, alerts and syslog work the same without it.":
    "OneUptime AI 代理程式會執行 OneUptime AI 在調查此 vCenter 上的事件或警示時要求的唯讀 `govc` 指令——虛擬機器的電源狀態、它所在的主機、最近的事件與工作、效能計數器。它只以容器映像檔（`oneuptime/resource-ai-agent`）的形式提供，因此不使用 Docker 的安裝只執行收集器。沒有它，詳細目錄、指標、監視器、警示與 syslog 也照常運作。",
  "To add it, run it with Docker on any machine that can reach vCenter. Download the agent's `docker-compose.yml`, write a `.env` next to it with the settings of `/opt/oneuptime-vmware-agent/.env` — quoted the Docker Compose way, in single quotes, since Docker Compose expands `$` in double quotes — and start the AI agent alone, not the collector beside it in that file, or every metric would arrive twice:":
    "若要加入它，請在任何能連到 vCenter 的機器上用 Docker 執行它。下載代理程式的 `docker-compose.yml`，在它旁邊寫一個 `.env`，內容為 `/opt/oneuptime-vmware-agent/.env` 中的設定——依 Docker Compose 的方式加引號，也就是用單引號，因為 Docker Compose 會展開雙引號中的 `$`——然後只啟動 AI 代理程式，而不要啟動該檔案中與它並列的收集器，否則每筆指標都會送達兩次：",
  "It registers as the vCenter named `VMWARE_VCENTER_NAME` — the one this collector reports into — and appears on the vCenter's **AI → AI agent** page. It is **read-only** unless you set `ONEUPTIME_AI_ALLOW_WRITES=true` in that `.env`. What it may run and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#vmware-vcenter).":
    "它註冊為名為 `VMWARE_VCENTER_NAME` 的 vCenter（也就是此收集器回報的那個），並出現在該 vCenter 的 **人工智慧 → AI 代理程式** 頁面上。除非在該 `.env` 中設定 `ONEUPTIME_AI_ALLOW_WRITES=true`，否則它是 **唯讀** 的。它可以執行什麼，以及修復如何運作：[基礎架構 AI 代理程式](/docs/ai/infrastructure-ai-agents#vmware-vcenter)。",
  "**Upgrade** — run the install commands again, then restart the agent. They download the collector release this OneUptime pins with the latest `otel-collector-config.yaml` and systemd unit, and replace the installed ones; your `.env` stays, and a change you made to the config has to be made again:":
    "**升級**——重新執行安裝指令，然後重新啟動代理程式。它們會下載此 OneUptime 固定的收集器版本，以及最新的 `otel-collector-config.yaml` 與 systemd 單元，並取代已安裝的檔案；你的 `.env` 會保留，而你對組態做過的變更需要重新做一遍：",
  "Then remove the `oneuptime` user's permission in vCenter if you no longer need it.":
    "如果不再需要，再在 vCenter 中移除 `oneuptime` 使用者的權限。",
  "The diagnostic script, `troubleshoot.sh`, needs Docker. Without it, start from the service and its log:":
    "診斷指令碼 `troubleshoot.sh` 需要 Docker。沒有 Docker 時，請從服務及其日誌著手：",
  "`active (running)`, with `Everything is ready. Begin running and processing data.` in the log, means the collector started; the topics below say what the log means when it cannot reach vCenter or OneUptime. A service that keeps restarting (`activating (auto-restart)`) logs why: `Failed with result 'resources'` means systemd cannot read `/opt/oneuptime-vmware-agent/.env`, and `cannot unmarshal the configuration` or `requires positive value` means a value in it is not one the collector takes — `VCENTER_INSECURE_SKIP_VERIFY` is `true` or `false`, `VCENTER_COLLECTION_INTERVAL` a duration such as `2m`.":
    "`active (running)`，且日誌中有 `Everything is ready. Begin running and processing data.`，表示收集器已啟動；下面的各個主題說明了當它無法連到 vCenter 或 OneUptime 時日誌的含義。不斷重新啟動的服務（`activating (auto-restart)`）會在日誌中寫明原因：`Failed with result 'resources'` 表示 systemd 無法讀取 `/opt/oneuptime-vmware-agent/.env`，`cannot unmarshal the configuration` 或 `requires positive value` 表示其中某個值不是收集器接受的值——`VCENTER_INSECURE_SKIP_VERIFY` 應為 `true` 或 `false`，`VCENTER_COLLECTION_INTERVAL` 應為 `2m` 這樣的時間長度。",
  "1. Check that the agent is running: `systemctl status oneuptime-vmware-agent --no-pager`":
    "1. 檢查代理程式是否在執行：`systemctl status oneuptime-vmware-agent --no-pager`",
  "2. Check its log for errors: `sudo journalctl -u oneuptime-vmware-agent | grep -i error`":
    "2. 檢查它的日誌中的錯誤：`sudo journalctl -u oneuptime-vmware-agent | grep -i error`",
  '3. Ask OneUptime whether it takes your ingestion key. `"valid":true` with `"keyType":"Server"` means it does; anything else says what is wrong with the key:':
    '3. 詢問 OneUptime 是否接受你的擷取金鑰。`"valid":true` 加上 `"keyType":"Server"` 表示接受；其他任何回應都會說明金鑰哪裡有問題：',
  "1. Check the log (`sudo journalctl -u oneuptime-vmware-agent -n 100 --no-pager`): a login error (`incorrect user name or password`, `InvalidLogin`) means bad credentials — or a user name or password that is not double-quoted, backslashes doubled, in `.env`; `x509: certificate signed by unknown authority` means TLS verification is on against a certificate this machine does not trust (see **x509 or other TLS errors**); `connection refused` / `no such host` means a wrong `VCENTER_ENDPOINT`; `Exporting failed` with a `401` or `422` means OneUptime refuses the ingestion key.":
    "1. 檢查日誌（`sudo journalctl -u oneuptime-vmware-agent -n 100 --no-pager`）：登入錯誤（`incorrect user name or password`、`InvalidLogin`）表示認證資訊有誤——或者是使用者名稱或密碼在 `.env` 中沒有放在雙引號裡並把反斜線寫成兩個；`x509: certificate signed by unknown authority` 表示在使用此機器不信任的憑證時開啟了 TLS 驗證（請參見 **x509 或其他 TLS 錯誤**）；`connection refused` / `no such host` 表示 `VCENTER_ENDPOINT` 有誤；帶有 `401` 或 `422` 的 `Exporting failed` 表示 OneUptime 拒絕了該擷取金鑰。",
  "2. Verify the endpoint is reachable. The collector runs on this machine, not in a container, so a plain `curl` takes its path — you should see an XML document advertising `urn:vim25`:":
    "2. 確認能連到端點。收集器執行在這台機器上而不是容器中，因此一般的 `curl` 走的就是它的路徑——你應該會看到一份宣告 `urn:vim25` 的 XML 文件：",
  "3. Read the collector's own counters: `otelcol_receiver_accepted_metric_points` grows while vCenter answers, `otelcol_exporter_sent_metric_points` while OneUptime takes the data, and `otelcol_exporter_send_failed_metric_points` appears when it does not:":
    "3. 查看收集器本身的計數器：只要 vCenter 有回應，`otelcol_receiver_accepted_metric_points` 就會增長；只要 OneUptime 接收資料，`otelcol_exporter_sent_metric_points` 就會增長；不接收時會出現 `otelcol_exporter_send_failed_metric_points`：",
  "4. Make sure `VMWARE_VCENTER_NAME` is set — discovery keys on the `vmware.vcenter.name` resource attribute.":
    "4. 確定已設定 `VMWARE_VCENTER_NAME`——探索依據的是 `vmware.vcenter.name` 資源屬性。",
  "5. Give it one collection interval: nothing is sent until the first full inventory walk completes.":
    "5. 等待一個收集間隔：在第一次完整走訪詳細目錄之前不會傳送任何資料。",
  'Use the full principal — `oneuptime@vsphere.local`, or `DOMAIN\\user` / `user@domain.example` for an Active Directory identity source — and check how it and the password are written in `/opt/oneuptime-vmware-agent/.env`. systemd reads that file with rules of its own, and not the same ones in every version: outside quotes it drops a backslash (`DOMAIN\\user` becomes `DOMAINuser`) and nothing starts a comment, and older versions (RHEL 8\'s, for one) drop a backslash inside single quotes too. The form every version reads as typed is double quotes, with each `\\` written `\\\\` and each `"` written `\\"` — `VCENTER_USERNAME="DOMAIN\\\\user"`, `VCENTER_PASSWORD="p@ss$word"`; `$`, `#`, `\'` and spaces go in as they are. Restart the agent after changing either. A locked account (too many failed attempts) rejects a correct password too; check *Administration → Single Sign On → Users and Groups*.':
    '使用完整的主體名稱（`oneuptime@vsphere.local`，Active Directory 身分識別來源則為 `DOMAIN\\user` / `user@domain.example`），並檢查使用者名稱與密碼在 `/opt/oneuptime-vmware-agent/.env` 中的寫法。systemd 依自己的規則讀取該檔案，而且各個版本的規則並不相同：在引號之外它會去掉反斜線（`DOMAIN\\user` 變成 `DOMAINuser`），而且沒有任何字元會開始註解；較舊的版本（例如 RHEL 8 中的版本）在單引號內也會去掉反斜線。所有版本都照輸入原樣讀取的形式是雙引號，每個 `\\` 寫成 `\\\\`，每個 `"` 寫成 `\\"`——`VCENTER_USERNAME="DOMAIN\\\\user"`、`VCENTER_PASSWORD="p@ss$word"`；`$`、`#`、`\'` 與空格則照原樣寫入。變更其中任何一個後都要重新啟動代理程式。遭鎖定的帳戶（失敗嘗試次數過多）也會拒絕正確的密碼；請檢查 *Administration → Single Sign On → Users and Groups*。',
  "vCenter appliances present a certificate issued by their own VMCA, which this machine does not trust out of the box. Either set `VCENTER_INSECURE_SKIP_VERIFY=true` (the pragmatic choice on a private management network), or keep verification on: the collector runs on this machine and trusts its CA store, so add vCenter's root certificate to it — the `.0` files under `certs/lin/` in `https://<vcenter>/certs/download.zip`, copied with a `.crt` name into `/usr/local/share/ca-certificates/` and loaded with `sudo update-ca-certificates` on Debian and Ubuntu, or copied into `/etc/pki/ca-trust/source/anchors/` and loaded with `sudo update-ca-trust` on RHEL and its relatives. Restart the agent either way. Do **not** point the endpoint at an `http://` URL — vCenter only serves the SDK over HTTPS.":
    "vCenter 應用裝置出示的是由其自身 VMCA 簽發的憑證，這台機器預設並不信任它。要麼設定 `VCENTER_INSECURE_SKIP_VERIFY=true`（在私人管理網路上這是務實的選擇），要麼保持驗證開啟：收集器執行在這台機器上並信任它的 CA 存放區，因此把 vCenter 的根憑證加進去——也就是 `https://<vcenter>/certs/download.zip` 中 `certs/lin/` 下的 `.0` 檔案：在 Debian 與 Ubuntu 上以 `.crt` 名稱複製到 `/usr/local/share/ca-certificates/`，再用 `sudo update-ca-certificates` 載入；在 RHEL 及其衍生發行版上複製到 `/etc/pki/ca-trust/source/anchors/`，再用 `sudo update-ca-trust` 載入。無論哪種方式，都要重新啟動代理程式。**不要** 把端點指向 `http://` URL——vCenter 只透過 HTTPS 提供 SDK。",
  "The vCenter identity comes from `VMWARE_VCENTER_NAME`, stamped on every metric as `vmware.vcenter.name`. Fix it in `/opt/oneuptime-vmware-agent/.env` and apply it with `sudo systemctl restart oneuptime-vmware-agent` — note that a new name registers a new vCenter.":
    "vCenter 的識別名稱來自 `VMWARE_VCENTER_NAME`，它會以 `vmware.vcenter.name` 的形式標記在每筆指標上。在 `/opt/oneuptime-vmware-agent/.env` 中修正它，並用 `sudo systemctl restart oneuptime-vmware-agent` 套用。請注意，新名稱會註冊為一個新的 vCenter。",
  "The vCenter identity comes from `VMWARE_VCENTER_NAME`, stamped on every metric as `vmware.vcenter.name`. This vCenter is **`vcenter-1`**. Fix it in `/opt/oneuptime-vmware-agent/.env` and apply it with `sudo systemctl restart oneuptime-vmware-agent` — note that a new name registers a new vCenter.":
    "vCenter 的識別名稱來自 `VMWARE_VCENTER_NAME`，它會以 `vmware.vcenter.name` 的形式標記在每筆指標上。此 vCenter 為 **`vcenter-1`**。在 `/opt/oneuptime-vmware-agent/.env` 中修正它，並用 `sudo systemctl restart oneuptime-vmware-agent` 套用。請注意，新名稱會註冊為一個新的 vCenter。",
};

export default TRANSLATION;
