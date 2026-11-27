import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The XcpNg setup guide in Traditional Chinese (#8341): each piece of the English
 * guide's markdown (Pages/XcpNg/Utils/DocumentationMarkdown.ts) and its
 * Traditional Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Traditional Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Xen Orchestra 6.9 or later, connected to the pools you want to monitor. Its OpenMetrics plugin needs a Premium licence on an XOA; Xen Orchestra built from sources includes it":
    "Xen Orchestra 6.9 或更新版本，並已連線到你要監控的資源池。在 XOA 上，其 OpenMetrics 外掛程式需要 Premium 授權；從原始碼建置的 Xen Orchestra 已內含該外掛程式",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on a machine that can reach Xen Orchestra over HTTPS":
    "Docker Engine 20.10 或更新版本及 Docker Compose v2 外掛程式，所在機器能透過 HTTPS 連到 Xen Orchestra",
  "A certificate on Xen Orchestra that names the address the agent connects to. The self-signed certificate Xen Orchestra makes for itself names none, so no current TLS client can check it — see **Xen Orchestra's certificate** under Advanced":
    "Xen Orchestra 上的一張憑證，其名稱中包含代理程式連線的位址。Xen Orchestra 為自己產生的自我簽署憑證不含任何名稱，因此目前沒有任何 TLS 用戶端能驗證它——請參閱進階中的 **Xen Orchestra 的憑證**",
  "1. In Xen Orchestra, open *Settings → Plugins* and find **openmetrics**.":
    "1. 在 Xen Orchestra 中開啟 *Settings → Plugins*，找到 **openmetrics**。",
  "2. Turn it on. The first time it starts, it makes a secret and keeps it, and Xen Orchestra keeps it across restarts.":
    "2. 啟用它。它在第一次啟動時會產生一個密鑰並保留下來，Xen Orchestra 在重新啟動後也會保留它。",
  "3. Open the plugin's settings and copy its **Prometheus secret** — you give it to the agent in the next step. You can also type a secret of your own there and save it.":
    "3. 開啟外掛程式的設定，複製它的 **Prometheus secret**——你會在下一步把它交給代理程式。你也可以在那裡輸入自己的密鑰並儲存。",
  "The plugin answers on Xen Orchestra's own address and certificate, at `/openmetrics/metrics`, and only to a request that carries its secret. It serves every pool Xen Orchestra is connected to, so one agent covers them all.":
    "外掛程式在 Xen Orchestra 自己的位址上、以其自己的憑證在 `/openmetrics/metrics` 回應，而且只回應帶有其密鑰的要求。它提供 Xen Orchestra 所連線的每個資源池，因此一個代理程式就能涵蓋全部。",
  "The script asks for your OneUptime URL and ingestion key, both shown in step 1 (pick a key there to have them filled in here), and then for:":
    "指令碼會詢問你的 OneUptime URL 和擷取金鑰，兩者都顯示在第 1 步中（在那裡選擇一個金鑰即可在此處填好），然後詢問：",
  "- **Xen Orchestra's address** — as you open it in a browser, e.g. `https://xo.example.com` or `https://10.0.0.5:8443`.":
    "- **Xen Orchestra 的位址**——也就是你在瀏覽器中開啟它的位址，例如 `https://xo.example.com` 或 `https://10.0.0.5:8443`。",
  "- **The OpenMetrics plugin's secret** — from the previous step. It is not shown as you type it.":
    "- **OpenMetrics 外掛程式的密鑰**——來自上一步。輸入時不會顯示。",
  "- **What to call this Xen Orchestra** — the name each of its pools shows on its Settings. Press Enter to use its address.":
    "- **這個 Xen Orchestra 的名稱**——它的每個資源池在其設定中顯示的名稱。按 Enter 即使用其位址。",
  "The script then reads Xen Orchestra's certificate. When this machine already trusts it, the agent trusts the same CA bundle. When it does not, the script shows the certificate's SHA-256 fingerprint: compare it with the one on Xen Orchestra's machine and answer **y** to trust that certificate and nothing else. It never turns the check off. It then asks the plugin for its metrics with the secret and says which pools Xen Orchestra reports, before it installs anything.":
    "接著指令碼會讀取 Xen Orchestra 的憑證。如果這台機器已經信任它，代理程式就信任同一個 CA 憑證組合。如果不信任，指令碼會顯示憑證的 SHA-256 指紋：請將其與 Xen Orchestra 所在機器上的指紋比對，然後回答 **y**，只信任這一張憑證。它從不關閉驗證。在安裝任何內容之前，它會用密鑰向外掛程式要求指標，並說明 Xen Orchestra 回報了哪些資源池。",
  "It installs to `/opt/oneuptime-xcp-ng-agent`, writes a `0600` `.env` file and starts the agent with Docker Compose. Running the script again reuses everything in that `.env` instead of asking again, so it is also how you upgrade.":
    "它會安裝到 `/opt/oneuptime-xcp-ng-agent`，寫入一個權限為 `0600` 的 `.env` 檔案，並用 Docker Compose 啟動代理程式。再次執行指令碼會沿用該 `.env` 中的所有內容而不再詢問，所以升級也是這樣做的。",
  "`docker compose ps` lists `oneuptime-xcp-ng-agent`. In its logs, look for `Everything is ready. Begin running and processing data.` The agent reads Xen Orchestra every minute, and each pool it reports then appears in the **XCP-ng** section under the name Xen Orchestra gives it, with its hosts, VMs and storage.":
    "`docker compose ps` 會列出 `oneuptime-xcp-ng-agent`。在它的日誌中尋找 `Everything is ready. Begin running and processing data.`。代理程式每分鐘讀取一次 Xen Orchestra，它回報的每個資源池隨後會以 Xen Orchestra 給它的名稱出現在 **XCP-ng** 區段，並帶有其主機、虛擬機器與儲存空間。",
  "The install script writes these to `/opt/oneuptime-xcp-ng-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`.":
    "安裝指令碼會把這些寫入 `/opt/oneuptime-xcp-ng-agent/.env`。變更其中任何一項後，在 `/opt/oneuptime-xcp-ng-agent` 中用 `docker compose up -d` 套用。",
  "| Variable | Required | Description |": "| 變數 | 必填 | 說明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 執行個體 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key — the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 是 | 遙測擷取金鑰，即第 1 步中選擇的那個 |",
  "| `XO_ADDRESS` | Yes | Xen Orchestra's `host` or `host:port`, without a scheme |":
    "| `XO_ADDRESS` | 是 | Xen Orchestra 的 `host` 或 `host:port`，不含通訊協定 |",
  "| `XO_SCHEME` | No | `https` (default). `http` only in a lab: the secret then crosses the network in clear |":
    "| `XO_SCHEME` | 否 | `https`（預設）。`http` 僅限實驗環境：此時密鑰會以明文穿過網路 |",
  "| `XO_OPENMETRICS_SECRET` | Yes | The OpenMetrics plugin's secret, sent as a Bearer token. Every `$` in it is written as `$$` |":
    "| `XO_OPENMETRICS_SECRET` | 是 | OpenMetrics 外掛程式的密鑰，以 Bearer 權杖傳送。其中的每個 `$` 都寫成 `$$` |",
  "| `XO_NAME` | No | What to call this Xen Orchestra in OneUptime, shown on each of its pools' Settings (default: its address) |":
    "| `XO_NAME` | 否 | 這個 Xen Orchestra 在 OneUptime 中的名稱，顯示在它每個資源池的設定中（預設：其位址） |",
  "| `XO_TLS_SERVER_NAME` | No | The name Xen Orchestra's certificate is checked against, when `XO_ADDRESS` is an address the certificate does not list |":
    "| `XO_TLS_SERVER_NAME` | 否 | 當 `XO_ADDRESS` 是憑證中未列出的位址時，用來驗證 Xen Orchestra 憑證的名稱 |",
  "| `XO_URL` | Install script | Xen Orchestra's address as typed; the script derives `XO_SCHEME` and `XO_ADDRESS` from it |":
    "| `XO_URL` | 安裝指令碼 | 依輸入原樣保存的 Xen Orchestra 位址；指令碼從中推導出 `XO_SCHEME` 與 `XO_ADDRESS` |",
  "| `XO_TLS_FINGERPRINT` | Install script | The SHA-256 fingerprint of Xen Orchestra's own certificate, when the agent trusts that certificate and nothing else |":
    "| `XO_TLS_FINGERPRINT` | 安裝指令碼 | 當代理程式只信任 Xen Orchestra 自己的憑證時，該憑證的 SHA-256 指紋 |",
  "| `XO_CA_FILE` | Install script | A CA bundle that issued Xen Orchestra's certificate, which the script copies to `xo-ca.pem` |":
    "| `XO_CA_FILE` | 安裝指令碼 | 簽發 Xen Orchestra 憑證的 CA 憑證組合，指令碼會將其複製到 `xo-ca.pem` |",
  "| `ONEUPTIME_AI_XO_READ_TOKEN` | No | A token of a Xen Orchestra user holding a copy of the built-in **Read only** role and nothing else: the XCP-ng AI agent runs when it is set, and reads with it |":
    "| `ONEUPTIME_AI_XO_READ_TOKEN` | 否 | 只持有內建 **Read only** 角色副本的 Xen Orchestra 使用者的權杖：設定後 XCP-ng AI 代理程式就會執行，並用它讀取 |",
  "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | No | Only for fixes: a token of another user, whose role allows them. The AI agent changes nothing without it |":
    "| `ONEUPTIME_AI_XO_WRITE_TOKEN` | 否 | 僅用於修正：另一個使用者的權杖，其角色允許這些修正。沒有它，AI 代理程式不會變更任何內容 |",
  "| `XCP_NG_POOL_ID` | No | The XAPI UUID of the pool the AI agent serves (default: the one pool its read token can see) |":
    "| `XCP_NG_POOL_ID` | 否 | AI 代理程式所服務資源池的 XAPI UUID（預設：其讀取權杖能看到的唯一資源池） |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | No | Overrides `XCP_NG_POOL_ID` as the pool the AI agent registers as |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | 否 | 覆寫 `XCP_NG_POOL_ID`，作為 AI 代理程式註冊時使用的資源池 |",
  "| `ONEUPTIME_AI_INVESTIGATION` | No | `true` or `false`: whether OneUptime AI may run the AI agent's read-only commands while it investigates (default: on) |":
    "| `ONEUPTIME_AI_INVESTIGATION` | 否 | `true` 或 `false`：OneUptime AI 在調查時能否執行 AI 代理程式的唯讀指令（預設：開啟） |",
  "| `ONEUPTIME_AI_FIXES` | No | `off`, `ask-for-approval`, `automatic` or `bypass-approval`: how OneUptime AI may apply a fix |":
    "| `ONEUPTIME_AI_FIXES` | 否 | `off`、`ask-for-approval`、`automatic` 或 `bypass-approval`：OneUptime AI 可以如何套用修正 |",
  "| `ONEUPTIME_AI_ALLOW_WRITES` | No | `true` lets the AI agent apply fixes, with the token for changes. Anything else keeps it read-only |":
    "| `ONEUPTIME_AI_ALLOW_WRITES` | 否 | `true` 讓 AI 代理程式使用變更權杖套用修正。其他任何值都會讓它維持唯讀 |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | No | The `vm/<uuid>`, `host/<uuid>`, `pbd/<uuid>` or `schedule/<uuid>` a fix may touch, comma-separated (default: all) |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | 否 | 修正可以觸及的 `vm/<uuid>`、`host/<uuid>`、`pbd/<uuid>` 或 `schedule/<uuid>`，以逗號分隔（預設：全部） |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | No | The same, for what OneUptime AI must never change: the VM the AI agent runs in, and Xen Orchestra's own |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | 否 | 同上，用於 OneUptime AI 絕不能變更的內容：AI 代理程式所在的虛擬機器，以及 Xen Orchestra 自己的虛擬機器 |",
  "| `LOG_LEVEL` | No | The AI agent's log level: `debug`, `info` (default), `warn` or `error` |":
    "| `LOG_LEVEL` | 否 | AI 代理程式的日誌層級：`debug`、`info`（預設）、`warn` 或 `error` |",
  "| `COMPOSE_PROFILES` | No | `xcp-ng-ai-agent` starts the AI agent; the install script writes it when the read token is set |":
    "| `COMPOSE_PROFILES` | 否 | `xcp-ng-ai-agent` 會啟動 AI 代理程式；安裝指令碼會在設定了讀取權杖時寫入它 |",
  "The agent checks Xen Orchestra's certificate against `xo-ca.pem`, next to `docker-compose.yml`.":
    "代理程式以 `docker-compose.yml` 旁邊的 `xo-ca.pem` 驗證 Xen Orchestra 的憑證。",
  "The agent checks Xen Orchestra's certificate on every read, against `xo-ca.pem` and nothing else. That file holds one of three things:":
    "代理程式每次讀取時都會驗證 Xen Orchestra 的憑證，只依據 `xo-ca.pem`。該檔案包含以下三者之一：",
  "- **Xen Orchestra's own certificate**, pinned by its SHA-256 fingerprint (`XO_TLS_FINGERPRINT`): the agent trusts that certificate and no other.":
    "- **Xen Orchestra 自己的憑證**，以其 SHA-256 指紋固定（`XO_TLS_FINGERPRINT`）：代理程式只信任這一張憑證。",
  "- **The CA that issued it** (`XO_CA_FILE`), for a certificate from a CA of your own.":
    "- **簽發它的 CA**（`XO_CA_FILE`），用於你自己的 CA 簽發的憑證。",
  "- **This machine's CA bundle**, for a certificate this machine already trusts.":
    "- **這台機器的 CA 憑證組合**，用於這台機器已經信任的憑證。",
  "Either way, the certificate must name the address the agent connects to: the agent checks the names a certificate is issued to, as every current TLS client does, and not its subject. The self-signed certificate Xen Orchestra makes for itself names none, so the agent cannot trust it, pinned or not, and fails with `x509: certificate is not valid for any names`. Give Xen Orchestra a certificate that names its address — from your CA, or a self-signed one with a subject alternative name — as [Xen Orchestra's certificate](/docs/telemetry/xcp-ng#xen-orchestras-certificate) shows.":
    "無論哪種方式，憑證都必須在名稱中包含代理程式連線的位址：與目前所有 TLS 用戶端一樣，代理程式驗證的是憑證簽發給的名稱，而不是其主體。Xen Orchestra 為自己產生的自我簽署憑證不含任何名稱，因此無論是否固定，代理程式都無法信任它，並會以 `x509: certificate is not valid for any names` 失敗。請依照 [Xen Orchestra 的憑證](/docs/telemetry/xcp-ng#xen-orchestras-certificate) 所示，為 Xen Orchestra 設定一張名稱中包含其位址的憑證——由你的 CA 簽發，或是帶有主體別名（subject alternative name）的自我簽署憑證。",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When a pinned certificate is renewed, the agent stops reading Xen Orchestra until it trusts the new one. Run the install script again: it shows the new fingerprint and stops, changing nothing. Check that fingerprint on Xen Orchestra's machine, then run the script once more with it: `XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`.":
    "如果憑證用不同於 `XO_ADDRESS` 中位址的名稱來識別 Xen Orchestra，請把 `XO_TLS_SERVER_NAME` 設為該名稱。固定的憑證更新後，代理程式會停止讀取 Xen Orchestra，直到它信任新憑證為止。請再次執行安裝指令碼：它會顯示新的指紋並停止，不做任何變更。在 Xen Orchestra 所在機器上核對該指紋，然後帶上它再執行一次指令碼：`XO_TLS_FINGERPRINT=<new fingerprint> bash install.sh`。",
  "Every minute the agent reads the plugin, which reads each host's XAPI round-robin databases at 60-second resolution. It keeps the `xcp_*` series, and moves each series' pool to the batch it sends, as `xcp_ng.pool.id` (the pool's UUID, which never changes) and `xcp_ng.pool.name`:":
    "代理程式每分鐘讀取一次外掛程式，外掛程式以 60 秒的解析度讀取每台主機的 XAPI 循環資料庫（round-robin）。代理程式保留 `xcp_*` 序列，並把每個序列的資源池移到它傳送的批次上，作為 `xcp_ng.pool.id`（資源池的 UUID，永不改變）與 `xcp_ng.pool.name`：",
  "| Category | Series |": "| 類別 | 序列 |",
  "| **Pool** | `xcp_pool_connected` — present while Xen Orchestra is connected to the pool |":
    "| **資源池** | `xcp_pool_connected`——只要 Xen Orchestra 與該資源池保持連線就存在 |",
  "| **Hosts** | `xcp_host_status` (power state and whether it is enabled), `xcp_host_uptime_seconds`, `xcp_host_cpu_average`, `xcp_host_load_average`, `xcp_host_memory_*`, `xcp_host_running_vcpus`, `xcp_host_network_*` per interface, `xcp_host_disk_*` per storage repository |":
    "| **主機** | `xcp_host_status`（電源狀態及是否已啟用）、`xcp_host_uptime_seconds`、`xcp_host_cpu_average`、`xcp_host_load_average`、`xcp_host_memory_*`、`xcp_host_running_vcpus`、依介面的 `xcp_host_network_*`、依儲存庫的 `xcp_host_disk_*` |",
  "| **VMs** | `xcp_vm_status`, `xcp_vm_uptime_seconds`, `xcp_vm_cpu_usage`, `xcp_vm_runstate_*` (CPU contention), `xcp_vm_memory_*`, `xcp_vm_network_*` per interface, `xcp_vm_disk_*` per disk, `xcp_vm_power_consumption_watts` |":
    "| **虛擬機器** | `xcp_vm_status`、`xcp_vm_uptime_seconds`、`xcp_vm_cpu_usage`、`xcp_vm_runstate_*`（CPU 爭用）、`xcp_vm_memory_*`、依介面的 `xcp_vm_network_*`、依磁碟的 `xcp_vm_disk_*`、`xcp_vm_power_consumption_watts` |",
  "| **Storage** | `xcp_sr_physical_size_bytes`, `xcp_sr_physical_usage_bytes`, `xcp_sr_virtual_size_bytes`, `xcp_vdi_virtual_size_bytes`, `xcp_vdi_physical_usage_bytes` |":
    "| **儲存空間** | `xcp_sr_physical_size_bytes`、`xcp_sr_physical_usage_bytes`、`xcp_sr_virtual_size_bytes`、`xcp_vdi_virtual_size_bytes`、`xcp_vdi_physical_usage_bytes` |",
  "| **XOSTOR** | `xcp_xostor_*`, on pools that run XOSTOR |":
    "| **XOSTOR** | `xcp_xostor_*`，用於執行 XOSTOR 的資源池 |",
  'Control domains report as VMs with `is_control_domain="true"`; the pages hide them unless you ask for them.':
    '控制網域以帶有 `is_control_domain="true"` 的虛擬機器形式回報；除非你要求顯示，否則頁面會隱藏它們。',
  "Xen Orchestra types eight throughput series as counters, though each holds XAPI's per-second rate: `xcp_host_network_receive_bytes_total`, `xcp_host_network_transmit_bytes_total`, and the VM network, network error and disk read and write series. The agent turns them into gauges with their values untouched, so OneUptime stores them as the rates they are, in bytes or errors per second.":
    "Xen Orchestra 把八個輸送量序列標為計數器，儘管每個序列存放的都是 XAPI 的每秒速率：`xcp_host_network_receive_bytes_total`、`xcp_host_network_transmit_bytes_total`，以及虛擬機器的網路、網路錯誤與磁碟讀寫序列。代理程式會在不改動其值的情況下把它們轉換為量測值（gauge），因此 OneUptime 會依它們本來的速率儲存，單位為每秒位元組數或錯誤數。",
  "OneUptime adds four 0/1 series for each pool, which the alert templates read: `xcp_ng.host.running`, `xcp_ng.host.enabled`, `xcp_ng.vm.running` and `xcp_ng.vm.stopped_after_running` (a VM halted or paused that ran in the last day). It also stamps every point with `xcp_ng.scope` (`pool`, `host`, `vm`, `sr`, `vdi` or `xostor`) and `xcp_ng.id` (that object's UUID), which monitors and dashboards filter on.":
    "OneUptime 為每個資源池加入四個 0/1 序列，供警示範本讀取：`xcp_ng.host.running`、`xcp_ng.host.enabled`、`xcp_ng.vm.running` 與 `xcp_ng.vm.stopped_after_running`（過去一天內執行過、現已停止或暫停的虛擬機器）。它也會為每個資料點加上 `xcp_ng.scope`（`pool`、`host`、`vm`、`sr`、`vdi` 或 `xostor`）與 `xcp_ng.id`（該物件的 UUID），監測器與儀表板據此篩選。",
  "Not kept: Xen Orchestra's own process series (`xo_*`), which belong to no pool, and a host's power read over IPMI, which the plugin sends without its pool. Each VM's estimated share of it is kept.":
    "不保留的內容：不屬於任何資源池的 Xen Orchestra 自身程序序列（`xo_*`），以及透過 IPMI 讀取、外掛程式傳送時不帶資源池的主機功率。其中每台虛擬機器的估算份額會保留。",
  "One agent reads one Xen Orchestra and every pool it manages. For a second Xen Orchestra, install a second agent in a folder of its own, with its own `container_name` in its `docker-compose.yml`:":
    "一個代理程式讀取一個 Xen Orchestra 及其管理的每個資源池。若要讀取第二個 Xen Orchestra，請在獨立的資料夾中安裝第二個代理程式，並在其 `docker-compose.yml` 中使用它自己的 `container_name`：",
  "Don't let two Xen Orchestras that manage the same pool both be read: the pool is one pool in OneUptime, by its UUID, and would be reported twice.":
    "不要同時讀取管理同一資源池的兩個 Xen Orchestra：依其 UUID，該資源池在 OneUptime 中是同一個資源池，會被回報兩次。",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on each pool the agent reads: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `oneuptime.agent.version`:":
    "任何帶有 `oneuptime.label.` 前置詞的資源屬性，都會成為代理程式所讀取的每個資源池上的專案標籤：`oneuptime.label.<dimension>=<value>` 即標籤 `<dimension>:<value>`。將它們加入 `otel-collector-config.yaml` 的 `resource` 處理器中，放在 `oneuptime.agent.version` 旁邊：",
  "Then restart the collector so it reads the new config:":
    "然後重新啟動收集器，讓它讀取新組態：",
  "The pools show up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent. Running the install script again replaces an edited `otel-collector-config.yaml` and keeps yours next to it as `otel-collector-config.yaml.bak.<timestamp>`.":
    "資源池會帶著 `team:platform` 與 `env:production` 標籤出現。標籤比對不區分大小寫，因此會重複使用現有的 `Production` 標籤；在 OneUptime 介面中新增的標籤絕不會被代理程式移除。再次執行安裝指令碼會取代編輯過的 `otel-collector-config.yaml`，並把你的版本以 `otel-collector-config.yaml.bak.<timestamp>` 保留在旁邊。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` (nothing is asked again), checks Xen Orchestra's certificate the same way, downloads the latest `docker-compose.yml` and `otel-collector-config.yaml` — a file you edited is kept next to the new one as `<file>.bak.<timestamp>` — pulls the image and recreates the agent with it:":
    "**升級**——收集器映像檔固定在 `docker-compose.yml` 中，其組態是旁邊的一個檔案，所以只提取映像檔並不會讓代理程式更新。請再次執行安裝指令碼。它會沿用你現有 `.env` 中的每個值（不會再詢問任何內容），以同樣的方式驗證 Xen Orchestra 的憑證，下載最新的 `docker-compose.yml` 與 `otel-collector-config.yaml`（你編輯過的檔案會以 `<file>.bak.<timestamp>` 保留在新檔案旁邊），提取映像檔並用它重新建立代理程式：",
  "The config reports the collector version it pins as each pool's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "組態會把它固定的收集器版本回報為每個資源池的 **代理程式版本**。當這個 OneUptime 固定了更新的版本時，旁邊的警告標誌會開啟這些指令。",
  "**Uninstall** the agent:": "**解除安裝**代理程式：",
  "Then turn off the OpenMetrics plugin in Xen Orchestra if nothing else reads it.":
    "接著，如果沒有其他程式讀取 OpenMetrics 外掛程式，就在 Xen Orchestra 中將其關閉。",
  "`troubleshoot.sh` checks the whole chain — the container, Xen Orchestra's certificate against `xo-ca.pem`, the plugin and its secret, the pools it reports — and asks OneUptime directly whether it accepts your ingestion key. That last check matters most: OneUptime's OTLP endpoints refuse a bad key with `401` or `422`, which the collector logs as a single `Exporting failed` line per batch that is easy to miss.":
    "`troubleshoot.sh` 會檢查整條鏈路——容器、依據 `xo-ca.pem` 驗證的 Xen Orchestra 憑證、外掛程式及其密鑰、它回報的資源池——並直接詢問 OneUptime 是否接受你的擷取金鑰。最後這項檢查最重要：OneUptime 的 OTLP 端點會以 `401` 或 `422` 拒絕錯誤的金鑰，而收集器只會為每個批次記錄一行很容易漏看的 `Exporting failed`。",
  "It ends with a verdict naming the most likely cause. It never prints the secret.":
    "最後它會給出判定，指出最可能的原因。它從不列印密鑰。",
  "OneUptime marks a pool Disconnected when nothing has been read for it for 15 minutes.":
    "如果 15 分鐘內沒有為某個資源池讀取到任何內容，OneUptime 會將其標為「已中斷」。",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in `/opt/oneuptime-xcp-ng-agent`): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. 如果這個 Xen Orchestra 的所有資源池都是「已中斷」，請檢查代理程式（在 `/opt/oneuptime-xcp-ng-agent` 中）：`docker compose ps` 與 `docker compose logs oneuptime-xcp-ng-agent | grep -i error`。",
  "2. If only one is, Xen Orchestra stopped reporting it: under *Settings → Servers* in Xen Orchestra, the pool's server must be connected. The pool's hosts, VMs and storage stay as Xen Orchestra last reported them.":
    "2. 如果只有一個是，表示 Xen Orchestra 停止回報它了：在 Xen Orchestra 的 *Settings → Servers* 中，該資源池的伺服器必須處於已連線狀態。資源池的主機、虛擬機器與儲存空間會維持 Xen Orchestra 最後回報時的樣子。",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in `/opt/oneuptime-xcp-ng-agent`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "收集器會記錄 `server returned HTTP status 401 Unauthorized`。從 *Settings → Plugins → openmetrics* 重新複製密鑰，在 `.env` 中把 `XO_OPENMETRICS_SECRET` 設為它（以單引號括住，每個 `$` 寫成 `$$`），然後在 `/opt/oneuptime-xcp-ng-agent` 中用 `docker compose up -d` 套用。在 6.8 之前，Xen Orchestra 每次重新啟動都會產生新的密鑰。",
  'Xen Orchestra answers, but its OpenMetrics plugin does not. Turn the plugin on under *Settings → Plugins → openmetrics* (an XOA needs a Premium licence for it), and check that Xen Orchestra is 6.9 or later. `/openmetrics/health` answers `{"status":"ok"}` without a secret while the plugin runs.':
    'Xen Orchestra 有回應，但其 OpenMetrics 外掛程式沒有。在 *Settings → Plugins → openmetrics* 中啟用外掛程式（XOA 需要 Premium 授權才能使用），並確認 Xen Orchestra 為 6.9 或更新版本。外掛程式執行時，`/openmetrics/health` 無需密鑰即可回應 `{"status":"ok"}`。',
  "- `x509: certificate is not valid for any names` — the certificate names no address, as Xen Orchestra's own self-signed one does. Give Xen Orchestra a certificate that names its address.":
    "- `x509: certificate is not valid for any names`——憑證的名稱中不含任何位址，Xen Orchestra 自己的自我簽署憑證就是如此。請為 Xen Orchestra 設定一張名稱中包含其位址的憑證。",
  "- `x509: certificate is valid for <names>, not <address>` — connect to one of those names, or set `XO_TLS_SERVER_NAME` to one.":
    "- `x509: certificate is valid for <names>, not <address>`——請連線到其中一個名稱，或把 `XO_TLS_SERVER_NAME` 設為其中之一。",
  "- `x509: certificate signed by unknown authority` — `xo-ca.pem` does not hold this certificate or the CA that issued it. The certificate was renewed, or the file holds the wrong one: write it again, as **Xen Orchestra's certificate** under Advanced says.":
    "- `x509: certificate signed by unknown authority`——`xo-ca.pem` 中既沒有這張憑證，也沒有簽發它的 CA。憑證已更新，或者檔案中放的是別的憑證：請依進階中的 **Xen Orchestra 的憑證** 所述重新寫入。",
  "Xen Orchestra reports only the pools it is connected to, and the agent reads only that Xen Orchestra. Connect the pool's server under *Settings → Servers* in Xen Orchestra; the pool appears in OneUptime with the next read. A pool read by another Xen Orchestra needs an agent beside that one.":
    "Xen Orchestra 只回報與它連線的資源池，而代理程式只讀取這個 Xen Orchestra。在 Xen Orchestra 的 *Settings → Servers* 中連線該資源池的伺服器；下次讀取時，資源池就會出現在 OneUptime 中。由另一個 Xen Orchestra 讀取的資源池，需要在那個 Xen Orchestra 旁邊另配一個代理程式。",
  "- **What to call this Xen Orchestra** — the command already names it **`xo-paris`**, as this pool's Settings show it.":
    "- **這個 Xen Orchestra 的名稱**——指令中已經將其命名為 **`xo-paris`**，與這個資源池的設定中顯示的一致。",
  "The command already carries your OneUptime URL and ingestion key. The script asks for the rest:":
    "該指令已經帶有你的 OneUptime URL 與擷取金鑰。其餘內容由指令碼詢問：",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "從此 OneUptime 下載 `docker-compose.yml` 與 `otel-collector-config.yaml` 到一個新資料夾：",
  "Create a `.env` file next to them — it holds the plugin's secret, so keep it private with `chmod 600 .env`:":
    "在它們旁邊建立一個 `.env` 檔案——它保存著外掛程式的密鑰，因此請用 `chmod 600 .env` 將其設為私有：",
  "- Set `XO_ADDRESS` to Xen Orchestra's `host` or `host:port`, without `https://`.":
    "- 把 `XO_ADDRESS` 設為 Xen Orchestra 的 `host` 或 `host:port`，不含 `https://`。",
  "- Put the plugin's secret between single quotes. If it holds a `$`, write each one as `$$`: the collector reads the value once more.":
    "- 把外掛程式的密鑰放在單引號之間。如果其中有 `$`，請把每個都寫成 `$$`：收集器會再讀取一次該值。",
  "- `XO_NAME` is what each pool's Settings call this Xen Orchestra.":
    "- `XO_NAME` 是每個資源池的設定中對這個 Xen Orchestra 的稱呼。",
  "Then give the agent Xen Orchestra's certificate, as `xo-ca.pem` next to `docker-compose.yml` — the agent checks Xen Orchestra against this file and nothing else. To trust Xen Orchestra's own certificate, read it and check its fingerprint against the one on Xen Orchestra's machine:":
    "接著把 Xen Orchestra 的憑證交給代理程式，作為 `docker-compose.yml` 旁邊的 `xo-ca.pem`——代理程式只依據這個檔案驗證 Xen Orchestra。若要信任 Xen Orchestra 自己的憑證，請讀取它，並將其指紋與 Xen Orchestra 所在機器上的指紋核對：",
  "When a CA of your own issued it, copy that CA's certificate to `xo-ca.pem` instead; when a public CA did, copy this machine's CA bundle (`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`).":
    "如果憑證由你自己的 CA 簽發，請改為把該 CA 的憑證複製到 `xo-ca.pem`；如果由公開 CA 簽發，請複製這台機器的 CA 憑證組合（`cp /etc/ssl/certs/ca-certificates.crt xo-ca.pem`）。",
  "Start the agent:": "啟動代理程式：",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中選擇一個擷取金鑰，以填入 `<YOUR_API_KEY>`。",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "代理程式從 `docker-compose.yml` 旁邊的 `.env` 檔案讀取這些值。變更其中任何一項後，在 `docker-compose.yml` 所在的資料夾中用 `docker compose up -d` 套用。",
  "When the certificate names Xen Orchestra by another name than the address in `XO_ADDRESS`, set `XO_TLS_SERVER_NAME` to that name. When the certificate in `xo-ca.pem` is renewed, read it again as in step 3, then run `docker compose up -d --force-recreate`.":
    "如果憑證用不同於 `XO_ADDRESS` 中位址的名稱來識別 Xen Orchestra，請把 `XO_TLS_SERVER_NAME` 設為該名稱。當 `xo-ca.pem` 中的憑證更新時，請依第 3 步重新讀取，然後執行 `docker compose up -d --force-recreate`。",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "在代理程式的資料夾（也就是 `docker-compose.yml` 所在的資料夾）中執行這些指令。",
  "**Upgrade** — the collector image is pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `xo-ca.pem` stay, and a change you made to either file has to be made again:":
    "**升級**——收集器映像檔固定在 `docker-compose.yml` 中，其組態是旁邊的一個檔案，所以只提取映像檔並不會讓代理程式更新。請重新下載這兩個檔案；你的 `.env` 與 `xo-ca.pem` 會保留，而你對其中任一檔案做過的變更需要重做一次：",
  "Then pull the image and recreate the agent, so the collector reads its new config:":
    "然後提取映像檔並重新建立代理程式，讓收集器讀取新組態：",
  "1. If every pool of this Xen Orchestra is Disconnected, check the agent (in the agent's folder): `docker compose ps` and `docker compose logs oneuptime-xcp-ng-agent | grep -i error`.":
    "1. 如果這個 Xen Orchestra 的所有資源池都是「已中斷」，請檢查代理程式（在代理程式的資料夾中）：`docker compose ps` 與 `docker compose logs oneuptime-xcp-ng-agent | grep -i error`。",
  "The collector logs `server returned HTTP status 401 Unauthorized`. Copy the secret again from *Settings → Plugins → openmetrics*, set `XO_OPENMETRICS_SECRET` to it in `.env` — between single quotes, every `$` written as `$$` — and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. Before 6.8, Xen Orchestra made a new secret each time it restarted.":
    "收集器會記錄 `server returned HTTP status 401 Unauthorized`。從 *Settings → Plugins → openmetrics* 重新複製密鑰，在 `.env` 中把 `XO_OPENMETRICS_SECRET` 設為它（以單引號括住，每個 `$` 寫成 `$$`），然後在 `docker-compose.yml` 所在的資料夾中用 `docker compose up -d` 套用。在 6.8 之前，Xen Orchestra 每次重新啟動都會產生新的密鑰。",
};

export default TRANSLATION;
