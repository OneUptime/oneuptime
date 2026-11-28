import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The OpenStack setup guide in Traditional Chinese (#8341): each piece of the English
 * guide's markdown (Pages/OpenStack/Utils/DocumentationMarkdown.ts) and its
 * Traditional Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Traditional Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "With `enable_prometheus` on in `/etc/kolla/globals.yml`, which Kolla-Ansible leaves off until you set it, it runs Prometheus, Alertmanager and an exporter for each thing under the cloud, and ships no alert rules. This guide reads what those run rather than starting a second copy.":
    "在 `/etc/kolla/globals.yml` 中開啟 `enable_prometheus` 後（在你設定之前，Kolla-Ansible 會保持關閉），它會執行 Prometheus、Alertmanager，並為雲端底下的每個元件各執行一個匯出器，但不附帶任何警示規則。本指南讀取它們已在執行的內容，而不是再啟動一份副本。",
  "**How far this guide has been tested:** Its paths and ports were read from Kolla-Ansible's own source. Its commands were then run on a real all-in-one at stable/2026.1 with Open vSwitch, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, without Docker, on Kolla-Ansible's own exporter and on your own at the pinned version and at 1.7.0, the agent's exporter on the Infrastructure only credential, the targets read from its real prometheus.yml, and the logs profile. With Memcached really stopped there, its Alertmanager posted a firing webhook and then a resolved one, and what it posted, sent to a running OneUptime, opened one incident on the right cloud and on no other, and resolved it. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**本指南的測試程度：** 其路徑與連接埠取自 Kolla-Ansible 自己的原始碼。之後，它的指令在一台真實的 stable/2026.1 all-in-one（使用 Open vSwitch）上執行過，並以一個保存代理程式所送內容的 OneUptime 替身作為接收端：使用完整檢視憑證的代理程式（不使用 Docker，分別對接 Kolla-Ansible 自己的匯出器，以及你自己的固定版本與 1.7.0 版匯出器）、使用僅基礎架構憑證的代理程式自帶匯出器、從其真實 prometheus.yml 讀取的目標，以及日誌設定檔。在那裡真的停止 Memcached 後，它的 Alertmanager 先送出觸發的 Webhook，再送出已解決的 Webhook；把這些內容送到執行中的 OneUptime 後，只在正確的雲端上開啟了一個事件，沒有出現在其他雲端上，並隨後將其解決。代理程式與探測器各自把一個真實的 DevStack 一路接到執行中的 OneUptime，中間經歷 nova-compute 的停止與恢復，但不是透過此工具完成的。",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent (or `bash install.sh --without-docker`, under Advanced)":
    "執行代理程式的機器上裝有 Docker Engine 20.10 或更新版本以及 Docker Compose v2 外掛程式（或使用「進階」中的 `bash install.sh --without-docker`）",
  "A machine outside the cloud it watches: an agent inside a failed cloud goes quiet with it":
    "一台位於所監控雲端之外的機器：位於故障雲端內部的代理程式會隨它一起沉默",
  "That machine can reach Keystone and every service's API":
    "這台機器能連到 Keystone 與每個服務的 API",
  "The `openstack` command line, as someone who can create the credential below":
    "`openstack` 命令列，並以能夠建立下方憑證的身分使用",
  "An alert that fires becomes an incident, with on-call and status pages from the first hour, and it resolves when the alert does. There is nothing to install.":
    "觸發的警示會變成事件，從第一個小時起就有待命與狀態頁面，警示解決時事件也隨之解決。不需要安裝任何東西。",
  "1. In OneUptime, make an Incoming Request monitor as [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) says, and copy its **Heartbeat URL**. That is the `<secret key>` address below.":
    "1. 在 OneUptime 中，依照 [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager#receive-alerts-with-a-monitor) 的說明建立一個傳入請求監測器，並複製它的 **Heartbeat URL**。這就是下方帶有 `<secret key>` 的位址。",
  "2. Open the monitor's **Overview → Linked Resources** and add the OpenStack cloud `my-openstack-cloud`. Each incident is then on that cloud's **Incidents** page, so each cloud's Alertmanager needs a monitor of its own. The cloud shows up in that list once its first data arrives, so do this after the steps below, or add the cloud under **OpenStack → All Clouds** first.":
    "2. 開啟監測器的 **概覽 → 已連結的資源**，加入 OpenStack 雲端 `my-openstack-cloud`。這樣每個事件都會出現在該雲端的 **事件** 頁面上，因此每個雲端的 Alertmanager 都需要自己的監測器。雲端在第一批資料抵達後才會出現在該清單中，所以請在完成下方步驟後再做這一步，或先在 **OpenStack → 所有雲端** 中加入該雲端。",
  "Then, on the host you deploy from, write `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`, which Kolla-Ansible reads in place of its own, and apply it:":
    "然後，在你執行部署的主機上寫入 `/etc/kolla/config/prometheus/prometheus-alertmanager.yml`（Kolla-Ansible 會用它取代自己的檔案），並套用它：",
  "- Log in as an admin with `source /etc/kolla/admin-openrc.sh`, which `kolla-ansible post-deploy` writes.":
    "- 使用 `source /etc/kolla/admin-openrc.sh` 以管理員身分登入，該檔案由 `kolla-ansible post-deploy` 寫入。",
  "- **Full view** needs one change, to Cinder. Kolla-Ansible's templates already set `service_type` under `[keystone_authtoken]` on Nova, Neutron, Glance and Placement, but its Cinder says `volume` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Add `service_type = block-storage` under `[keystone_authtoken]` in `/etc/kolla/config/cinder.conf`, then run `kolla-ansible reconfigure -i <inventory> --tags cinder`.":
    "- **完整檢視** 需要對 Cinder 做一處修改。Kolla-Ansible 的範本已在 Nova、Neutron、Glance 與 Placement 的 `[keystone_authtoken]` 下設定了 `service_type`，但它的 Cinder 寫的是 `volume`，目錄寫的是 `block-storage`，兩者不一致時，keystonemiddleware 會以 `401` 拒絕受存取規則限制的憑證。在 `/etc/kolla/config/cinder.conf` 的 `[keystone_authtoken]` 下加入 `service_type = block-storage`，然後執行 `kolla-ansible reconfigure -i <inventory> --tags cinder`。",
  "- **Infrastructure only** takes its overrides at `/etc/kolla/config/nova/policy.yaml`, and the same for `neutron`, `keystone` and `placement`, merged with anything already there. Apply them with `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement`.":
    "- **僅基礎架構** 的覆寫放在 `/etc/kolla/config/nova/policy.yaml`，`neutron`、`keystone` 與 `placement` 也一樣，並與其中已有的內容合併。用 `kolla-ansible reconfigure -i <inventory> --tags nova,neutron,keystone,placement` 套用它們。",
  "**Recommended.** The agent sees everything it reads: services, hypervisors, every project's instances, volumes, networks and routers, and `cinder-volume` and `cinder-scheduler` state and storage pools, which only this level sees. It leaves out Keystone's users and groups, on purpose.":
    "**建議。** 代理程式看得到它讀取的一切：服務、虛擬化主機、每個專案的執行個體、磁碟區、網路與路由器，以及只有這個層級才看得到的 `cinder-volume` 與 `cinder-scheduler` 狀態與儲存池。它刻意不讀取 Keystone 的使用者與群組。",
  "This is an application credential on an account with `admin` on a project of its own, limited by access rules to the exact `GET` calls the agent makes, so it cannot write: on every release we record, every read answered `200` and every write `401`. As an admin, make the project and the account:":
    "這是一個應用程式憑證，屬於在自己專用專案上擁有 `admin` 的帳號，並透過存取規則限制為只能發出代理程式所需的那些 `GET` 呼叫，因此無法寫入：在我們記錄的每個版本上，每次讀取都回應 `200`，每次寫入都回應 `401`。以管理員身分建立專案與帳號：",
  "Then, logged in as that account on that project, make the credential. An access rule is matched against the path the service sees, and a service behind a path prefix refuses the shipped rules with a `401`, so these commands fit them to this cloud from its catalog first:":
    "然後，以該帳號登入該專案，建立憑證。存取規則會與服務看到的路徑比對，而位於路徑前綴之後的服務會以 `401` 拒絕隨附的規則，因此這些指令會先根據目錄把規則調整成適合這個雲端：",
  "- Copy the `id` and the `secret` it prints: the secret is shown only once.":
    "- 複製它輸出的 `id` 與 `secret`：密鑰只會顯示一次。",
  "- Never add `--unrestricted`, which would let it make more credentials.":
    "- 絕對不要加上 `--unrestricted`，否則這個憑證就能建立更多憑證。",
  "- Access rules work only where each service sets `service_type` in its `[keystone_authtoken]` section and has been restarted since: `compute`, `network`, `block-storage` (the rules also carry `volume` and `volumev3`, for a Cinder configured that way), `image` and `placement`. Keystone needs nothing. Without that, the services refuse the credential with a `401`.":
    "- 只有每個服務都在自己的 `[keystone_authtoken]` 區段設定了 `service_type` 且之後重新啟動過，存取規則才會生效：`compute`、`network`、`block-storage`（規則中也帶有 `volume` 與 `volumev3`，供這樣設定的 Cinder 使用）、`image` 與 `placement`。Keystone 不需要任何設定。否則，服務會以 `401` 拒絕該憑證。",
  "- If you won't change that, leave out `--access-rules`. That makes a plain admin application credential, which can write as well as read, so keep it as safe as an admin password.":
    "- 如果你不打算改這些，就拿掉 `--access-rules`。這樣得到的是一個一般的管理員應用程式憑證，既能讀也能寫，所以請像保管管理員密碼一樣保管它。",
  "- It stops working when it expires. To replace it, make the second credential before you delete the first.":
    "- 憑證到期後就會失效。要替換它，請先建立新憑證，再刪除舊憑證。",
  "No admin. The agent sees all of Keystone's projects, domains, services and endpoints, all of Nova including every project's instances, all of Placement, and Neutron's agents and address pools. Volumes, snapshots, networks, subnets, routers, floating IPs and ports appear only for the projects the role is assigned on, so on a project that holds nothing just the shared and external ones, and OneUptime can't see the others.":
    "不需要管理員。代理程式看得到 Keystone 的所有專案、網域、服務與端點，整個 Nova（包括每個專案的執行個體），整個 Placement，以及 Neutron 的代理程式與位址集區。磁碟區、快照、網路、子網路、路由器、浮動 IP 與連接埠只對指派了該角色的專案顯示，因此在空的專案上只看得到共用與外部的那些，OneUptime 看不到其他的。",
  "It does not see `cinder-volume` or `cinder-scheduler` state or storage pools: Cinder's own code asks for an admin there, after policy has already passed, so no override opens them, and only **Full view** sees them.":
    "它看不到 `cinder-volume` 或 `cinder-scheduler` 的狀態以及儲存池：在原則已經放行之後，Cinder 自己的程式碼仍要求管理員，所以任何覆寫都打不開它們，只有 **完整檢視** 看得到。",
  "This is a role of its own, `oneuptime_monitoring`, with the policy overrides the agent ships, on a project of its own that holds nothing and has zero quota. Where Cinder has `enforce_new_defaults` off, which is Cinder's own default, any role on a project can create that project's volumes. With nothing to touch and no quota to make anything with, there is nothing for it to write: on every release we record, every write answered `403`, or `409` and `413` from quota. As an admin, make the role, the project and an account:":
    "這是一個專用角色 `oneuptime_monitoring`，帶有代理程式隨附的原則覆寫，位於一個不含任何內容、配額為零的專用專案上。在 Cinder 關閉了 `enforce_new_defaults` 的地方（這是 Cinder 自己的預設值），專案上的任何角色都能建立該專案的磁碟區。既沒有可碰的東西，也沒有能用來建立任何東西的配額，所以它沒有可寫的內容：在我們記錄的每個版本上，每次寫入都回應 `403`，或因配額回應 `409` 與 `413`。以管理員身分建立角色、專案與帳號：",
  "Download the overrides, and merge each, on every controller, into the file named by `[oslo_policy] policy_file` in that service's config. That is `/etc/nova/policy.yaml` and so on, unless your deployment says otherwise. Each override keeps the service's default and adds the role. oslo.policy notices a changed file on its own, so nothing restarts:":
    "下載這些覆寫，並在每個控制器上把每個覆寫合併到該服務設定中 `[oslo_policy] policy_file` 指向的檔案裡。除非你的部署另有規定，否則就是 `/etc/nova/policy.yaml` 等。每個覆寫都保留服務的預設值並加上該角色。oslo.policy 會自行察覺檔案變更，因此不需要重新啟動任何東西：",
  "**To take the overrides off again, empty the file (`{}`) and never delete it.** On Flamingo (2025.2) and Epoxy (2025.1), oslo.policy raises on every check once a policy file it has read is gone, so that service fails every request. When the service is Keystone, it stops validating tokens and the whole cloud answers `503`. If it has already happened, restart the service.":
    "**要再次移除覆寫，請清空檔案（`{}`），永遠不要刪除它。** 在 Flamingo（2025.2）與 Epoxy（2025.1）上，一旦已讀取過的原則檔案消失，oslo.policy 會在每次檢查時報錯，於是該服務的每個請求都會失敗。當這個服務是 Keystone 時，它會停止驗證權杖，整個雲端都回應 `503`。如果已經發生，請重新啟動該服務。",
  "Then, logged in as that account on that project, make the credential and copy the `id` and the `secret` it prints:":
    "然後，以該帳號登入該專案，建立憑證並複製它輸出的 `id` 與 `secret`：",
  "Putting the role on a real project to see its volumes and routers also lets the account write there, on a cloud where Cinder has `enforce_new_defaults` off. `troubleshoot.sh` warns when the credential's project holds things.":
    "為了查看真實專案的磁碟區與路由器而把角色放到該專案上，在 Cinder 關閉了 `enforce_new_defaults` 的雲端上，也會讓該帳號能在那裡寫入。當憑證所在的專案中有內容時，`troubleshoot.sh` 會發出警告。",
  "For a team watching its own part of a cloud someone else runs. The agent sees one project's volumes, networks and routers, and no infrastructure: no hypervisors, services or storage pools.":
    "適用於在別人營運的雲端中監控自己那一部分的團隊。代理程式看得到一個專案的磁碟區、網路與路由器，看不到任何基礎架構：沒有虛擬化主機、服務或儲存池。",
  "Through the agent it shows no instances at all: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. Only a OneUptime probe, collecting without this agent, can list one project's instances.":
    "透過代理程式，這個層級完全看不到執行個體：匯出器向 Nova 請求所有專案的伺服器，Nova 拒絕一般讀者，這次讀取就整個失敗。只有不經過此代理程式收集的 OneUptime 探測器，才能列出一個專案的執行個體。",
  "This is the plain `reader` role. Give an account the role on the project:":
    "這是一般的 `reader` 角色。在專案上把該角色授予一個帳號：",
  "Neutron and Cinder answer a reader with its own project and no error, so these lists look complete, and hold only that project.":
    "Neutron 與 Cinder 會向讀者回應其自己的專案且不報錯，所以這些清單看起來完整，實際上只包含該專案。",
  "It may be able to write. On a cloud where Cinder has `enforce_new_defaults` off, which is Cinder's own default, plain `reader` can create volumes in its project too. On Epoxy, Flamingo and Gazpacho it did, and on Hibiscus it was refused, because DevStack only turns `enforce_new_defaults` on there.":
    "它可能可以寫入。在 Cinder 關閉了 `enforce_new_defaults` 的雲端上（這是 Cinder 自己的預設值），一般的 `reader` 也能在自己的專案中建立磁碟區。在 Epoxy、Flamingo 與 Gazpacho 上確實如此，而在 Hibiscus 上遭到拒絕，因為 DevStack 只在那裡開啟 `enforce_new_defaults`。",
  "No credential and nothing new to run: the agent reads the exporter Kolla-Ansible already runs, through its internal VIP on `9198`. Skip the install's credential questions by giving it the address:":
    "不需要憑證，也不需要執行任何新東西：代理程式透過 `9198` 上的內部 VIP 讀取 Kolla-Ansible 已在執行的匯出器。安裝時把位址交給它，即可略過憑證相關的提問：",
  "Kolla-Ansible pins exporter 1.7.0 and runs it without `--multi-cloud`, so it has no `/probe`: the agent asks it for everything at once, every 2 minutes, on top of Kolla-Ansible's own Prometheus asking every minute. Its answer also says less. On five real clouds, the pages went without:":
    "Kolla-Ansible 把匯出器固定在 1.7.0，並在不帶 `--multi-cloud` 的情況下執行，所以它沒有 `/probe`：代理程式每 2 分鐘一次向它請求所有內容，此外 Kolla-Ansible 自己的 Prometheus 還會每分鐘請求一次。它的回應包含的資訊也比較少。在五個真實的雲端上，頁面缺少了以下內容：",
  "| Goes without | Because | What it costs |": "| 缺少的內容 | 原因 | 影響 |",
  "| Everything of Cinder's | It asks the catalog for `volumev3`, and finds no such thing where Cinder registers as `block-storage` | **Volumes** and **Storage pools** stay empty, and **Services** has no Block Storage API, `cinder-volume` or `cinder-scheduler`. **Block Storage API Down**, **Block Storage Service Down**, **Storage Pool Warning**, **Storage Pool Critical**, **Volumes in Error** and **Volume Stuck** stay quiet |":
    "| Cinder 的所有內容 | 它向目錄請求 `volumev3`，而在 Cinder 註冊為 `block-storage` 的地方找不到 | **磁碟區** 與 **儲存池** 一直是空的，**服務** 中沒有 Block Storage API、`cinder-volume` 或 `cinder-scheduler`。**Block Storage API Down**、**Block Storage Service Down**、**Storage Pool Warning**、**Storage Pool Critical**、**Volumes in Error** 與 **Volume Stuck** 都不會觸發 |",
  "| How many instances a hypervisor holds, and its aggregates | Nova's list of hypervisors fails at the newest microversion, which Kolla-Ansible asks for | Those two on **Hypervisors**, and what a lost host says it takes with it. Its vCPUs, memory and disk are still there: they come from Placement |":
    "| 虛擬化主機承載的執行個體數量及其彙總 | Nova 的虛擬化主機清單在 Kolla-Ansible 請求的最新微版本上失敗 | **虛擬化主機** 上的這兩項，以及失去的主機宣稱會一併帶走的內容。它的 vCPU、記憶體與磁碟仍然存在：它們來自 Placement |",
  "| Domains | It has no such series | **Domains** stays empty |":
    "| 網域 | 它沒有這樣的序列 | **網域** 一直是空的 |",
  "| An image's status, visibility and creation date | It has no such labels | Those columns on **Images**. **Image Stuck** stays quiet, so an image stuck on its way to `active` goes unnoticed |":
    "| 映像的狀態、可見性與建立日期 | 它沒有這樣的標籤 | **映像** 上的這些欄位。**Image Stuck** 不會觸發，因此卡在變成 `active` 途中的映像不會被發現 |",
  "| A network's MTU | It has no such label | That line on a network's page |":
    "| 網路的 MTU | 它沒有這樣的標籤 | 網路頁面上的那一行 |",
  "If you need those, use one of the other tabs and the agent's own exporter. You can change your mind later: a cloud keeps its name whichever reads it.":
    "如果你需要這些，請使用其他分頁之一以及代理程式自己的匯出器。你之後也可以改變主意：無論由誰讀取，雲端都會保留它的名稱。",
  "The script asks for:": "指令碼會詢問：",
  "- **OneUptime URL and ingestion key**, both shown in step 1. Pick a key there to have them filled in here.":
    "- **OneUptime URL 與擷取金鑰**，兩者都顯示在步驟 1 中。在那裡選擇一個金鑰，即可在這裡自動填入。",
  "- **Cloud name**: how the cloud appears in OneUptime. Keep it stable: a new name registers a new cloud.":
    "- **雲端名稱**：雲端在 OneUptime 中的顯示名稱。請保持不變：新名稱會註冊一個新的雲端。",
  "- **Keystone auth URL**, such as `https://keystone.example.com:5000/v3`.":
    "- **Keystone 驗證 URL**，例如 `https://keystone.example.com:5000/v3`。",
  "- **Region names**, comma-separated (`RegionOne` if you have one).":
    "- **地區名稱**，以逗號分隔（只有一個時為 `RegionOne`）。",
  "- **Application credential**: the ID and secret from the previous step. Neither is echoed to the screen, and neither goes on a command line.":
    "- **應用程式憑證**：上一步中的 ID 與密鑰。兩者都不會顯示在畫面上，也不會出現在命令列中。",
  "- **Private CA file**, only if the cloud's certificate comes from its own certificate authority.":
    "- **私人 CA 檔案**，只有當雲端的憑證來自它自己的憑證授權單位時才需要。",
  "It checks the credential with Keystone before it installs anything, installs to `/opt/oneuptime-openstack-agent` (or to `oneuptime-openstack-agent` in your home folder if you have no rights on `/opt`, and it says which), writes a `.env` file and a `clouds.yaml` only their owner can read, and starts everything with Docker Compose. Running it again reuses all of that instead of asking again, so it is also how you upgrade.":
    "它會在安裝任何東西之前先向 Keystone 驗證憑證，安裝到 `/opt/oneuptime-openstack-agent`（如果你對 `/opt` 沒有權限，則安裝到你主資料夾下的 `oneuptime-openstack-agent`，並告訴你裝在哪裡），寫入只有擁有者才能讀取的 `.env` 檔案與 `clouds.yaml`，然後用 Docker Compose 啟動所有元件。再次執行時會沿用這些內容而不再提問，因此升級也是這樣做的。",
  "`docker compose ps` lists the collector (`oneuptime-openstack-agent`), the bundled exporter (`oneuptime-openstack-exporter`) and the OneUptime AI agent (`oneuptime-openstack-ai-agent`). In the collector's logs, look for `Everything is ready. Begin running and processing data.` The cloud then appears in the **OpenStack** section by itself. Give it about five minutes to fill in: compute, network, volume and Placement are read every 2 minutes, identity and images every 5.":
    "`docker compose ps` 會列出收集器（`oneuptime-openstack-agent`）、內建匯出器（`oneuptime-openstack-exporter`）與 OneUptime AI 代理程式（`oneuptime-openstack-ai-agent`）。在收集器的日誌中尋找 `Everything is ready. Begin running and processing data.`。之後雲端會自動出現在 **OpenStack** 區段中。請等候約五分鐘讓資料填滿：compute、網路、磁碟區與 Placement 每 2 分鐘讀取一次，identity 與映像每 5 分鐘讀取一次。",
  "On the host that runs Kolla-Ansible's Prometheus, this reads its targets from the file Kolla-Ansible rendered, and prints them as settings for the agent:":
    "在執行 Kolla-Ansible 的 Prometheus 的主機上，這會從 Kolla-Ansible 產生的檔案中讀取它的目標，並把它們輸出為代理程式的設定：",
  "Add what it prints to the agent's `.env`, then run `docker compose up -d` in the agent's folder. Each exporter listens on the API network, so the agent's machine needs a route there. The cloud's **Control Plane** card then says how each one is, and says plainly which ones are not watched.":
    "把輸出內容加到代理程式的 `.env` 中，然後在代理程式資料夾中執行 `docker compose up -d`。每個匯出器都在 API 網路上接聽，因此代理程式所在的機器需要一條通往那裡的路由。之後雲端的 **控制平面** 卡片會顯示每個匯出器的狀態，並明確指出哪些沒有受到監控。",
  "| Reads | Port | Setting |": "| 讀取對象 | 連接埠 | 設定 |",
  "| RabbitMQ's Prometheus plugin | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |":
    "| RabbitMQ 的 Prometheus 外掛程式 | `15692` | `OPENSTACK_RABBITMQ_TARGETS` |",
  "| mysqld_exporter | `9104` | `OPENSTACK_MARIADB_TARGETS` |":
    "| mysqld_exporter（用於 MariaDB） | `9104` | `OPENSTACK_MARIADB_TARGETS` |",
  "| memcached_exporter | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |":
    "| memcached_exporter（用於 Memcached） | `9150` | `OPENSTACK_MEMCACHED_TARGETS` |",
  "| HAProxy's own exporter | `9101` | `OPENSTACK_HAPROXY_TARGETS` |":
    "| HAProxy 自己的匯出器 | `9101` | `OPENSTACK_HAPROXY_TARGETS` |",
  "| openstack-network-exporter, for OVN and Open vSwitch | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |":
    "| openstack-network-exporter（用於 OVN 與 Open vSwitch） | `1981` | `OPENSTACK_NETWORK_EXPORTER_TARGETS` |",
  "| prometheus-libvirt-exporter | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |":
    "| prometheus-libvirt-exporter（用於 libvirt） | `9177` | `OPENSTACK_LIBVIRT_HEALTH_TARGETS` |",
  "- **OVN's databases:** Kolla-Ansible runs openstack-network-exporter from 2026.1, on compute and network nodes only, and an OVN database is read from the host it runs on. If your control nodes are neither, add them under `[prometheus-openstack-network-exporter:children]` in your inventory and reconfigure, or the Northbound and Southbound databases read as not watched.":
    "- **OVN 的資料庫：** Kolla-Ansible 從 2026.1 起只在運算節點與網路節點上執行 openstack-network-exporter，而 OVN 資料庫是從它所在的主機讀取的。如果你的控制節點兩者都不是，請把它們加到清單的 `[prometheus-openstack-network-exporter:children]` 下並重新設定，否則 Northbound 與 Southbound 資料庫會顯示為未監控。",
  "- **Before 2026.1** there is no network exporter, so OVN and Open vSwitch read as not watched.":
    "- **2026.1 之前** 沒有網路匯出器，因此 OVN 與 Open vSwitch 會顯示為未監控。",
  "The agent's logs profile runs on each node, and reads Kolla-Ansible's files. It is what joins a line to the cloud's pages:":
    "代理程式的日誌設定檔在每個節點上執行，讀取 Kolla-Ansible 的檔案。正是它把日誌行連結到雲端的頁面：",
  "Kolla's own Fluentd can forward too, with an output in `/etc/kolla/config/fluentd/output/*.conf` as [Fluentd](/docs/telemetry/fluentd) describes, but those records reach **Logs** under a service's name, and not the cloud's pages.":
    "Kolla 自己的 Fluentd 也能轉送，只要依照 [Fluentd](/docs/telemetry/fluentd) 的說明在 `/etc/kolla/config/fluentd/output/*.conf` 中加入輸出即可，但這些記錄會以服務名稱進入 **日誌**，而不會出現在雲端的頁面上。",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from `/var/log/kolla`.":
    "兩者都寫入服務自己的日誌，匯流排上沒有任何取用者。在 **安全事件 → 連線** 中開啟 **在日誌中尋找安全事件** 後，OneUptime 就會從那裡讀取它們。代理程式的日誌設定檔從 `/var/log/kolla` 讀取這兩者。",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw.":
    "這會為每次登入送出一行，由 **OpenStack admin credential used from a new address** 讀取。若只想送出失敗的登入，請把 `identity.authenticate.success` 加到 `notification_opt_out`，這項偵測之後就會讀取稽核篩選器看到的內容。",
  "For who did what through Nova, Neutron, Cinder and Glance, the audit filter needs a setting, which goes in every service's config at once:":
    "要知道誰透過 Nova、Neutron、Cinder 與 Glance 做了什麼，稽核篩選器需要一項設定，它要同時放進所有服務的設定中：",
  "It also needs a paste file, and Kolla-Ansible's config tasks copy no paste file for these services. Put yours on each API host, and mount it over the one in the image with `nova_api_extra_volumes`, `neutron_server_extra_volumes`, `cinder_api_extra_volumes` and `glance_api_extra_volumes` in `globals.yml`. pyCADF's map files are in `/var/lib/kolla/venv/etc/pycadf` in the image. [Who did what](/docs/telemetry/openstack#who-did-what) has the filter's lines.":
    "它還需要一個 paste 檔案，而 Kolla-Ansible 的設定工作不會為這些服務複製任何 paste 檔案。把你自己的檔案放到每台 API 主機上，並在 `globals.yml` 中用 `nova_api_extra_volumes`、`neutron_server_extra_volumes`、`cinder_api_extra_volumes` 與 `glance_api_extra_volumes` 把它掛載到映像中的檔案之上。pyCADF 的對應檔位於映像中的 `/var/lib/kolla/venv/etc/pycadf`。篩選器的設定行請見 [誰做了什麼](/docs/telemetry/openstack#who-did-what)。",
  "OpenStack's `reader` role is scoped to a project everywhere except Keystone and Ironic, and hypervisors, services, agents, pools and Placement default to admin. A policy override can't open all-project lists in Cinder or Neutron, because they scope those lists in code, and Cinder's own code keeps its services and storage pools for an admin. So what a credential can read depends on which level you choose. This is what five real clouds answered, on Epoxy, Flamingo, Gazpacho (OVN and OVS) and Hibiscus:":
    "OpenStack 的 `reader` 角色除了 Keystone 與 Ironic 之外，在所有地方都限定在一個專案內，而虛擬化主機、服務、代理程式、集區與 Placement 預設只開放給管理員。原則覆寫無法打開 Cinder 或 Neutron 中跨所有專案的清單，因為它們在程式碼中限定了這些清單的範圍，而 Cinder 自己的程式碼把它的服務與儲存池保留給管理員。所以憑證能讀取什麼，取決於你選擇的層級。以下是五個真實的雲端在 Epoxy、Flamingo、Gazpacho（OVN 與 OVS）以及 Hibiscus 上的回應：",
  "| Read | Level 1: Full view | Level 2: Infrastructure only | Level 3: Project view |":
    "| 讀取 | 層級 1：完整檢視 | 層級 2：僅基礎架構 | 層級 3：專案檢視 |",
  "| Keystone: projects | all | all | refused |":
    "| Keystone：專案 | 全部 | 全部 | 遭拒絕 |",
  "| Keystone: domains | all | all | refused |":
    "| Keystone：網域 | 全部 | 全部 | 遭拒絕 |",
  "| Keystone: regions | all | what anyone sees | what anyone sees |":
    "| Keystone：地區 | 全部 | 任何人都看得到的 | 任何人都看得到的 |",
  "| Keystone: services | all | all | refused |":
    "| Keystone：服務 | 全部 | 全部 | 遭拒絕 |",
  "| Keystone: endpoints | all | all | refused |":
    "| Keystone：端點 | 全部 | 全部 | 遭拒絕 |",
  "| Nova: servers, all projects | all | all | refused |":
    "| Nova：伺服器，所有專案 | 全部 | 全部 | 遭拒絕 |",
  "| Nova: services | all | all | refused |":
    "| Nova：服務 | 全部 | 全部 | 遭拒絕 |",
  "| Nova: hypervisors | all | all | refused |":
    "| Nova：虛擬化主機 | 全部 | 全部 | 遭拒絕 |",
  "| Nova: aggregates | all | all | refused |":
    "| Nova：彙總 | 全部 | 全部 | 遭拒絕 |",
  "| Nova: availability zones, detail | all | all | refused |":
    "| Nova：可用區域，詳細資料 | 全部 | 全部 | 遭拒絕 |",
  "| Nova: flavors | all | what anyone sees | what anyone sees |":
    "| Nova：規格 | 全部 | 任何人都看得到的 | 任何人都看得到的 |",
  "| Nova: usage per project | all | all | refused |":
    "| Nova：各專案用量 | 全部 | 全部 | 遭拒絕 |",
  "| Placement: resource providers | all | all | refused |":
    "| Placement：資源提供者 | 全部 | 全部 | 遭拒絕 |",
  "| Neutron: agents | all | all | nothing |":
    "| Neutron：代理程式 | 全部 | 全部 | 無 |",
  "| Neutron: networks | all | own project only | own project only |":
    "| Neutron：網路 | 全部 | 僅自己的專案 | 僅自己的專案 |",
  "| Neutron: subnets | all | own project only | own project only |":
    "| Neutron：子網路 | 全部 | 僅自己的專案 | 僅自己的專案 |",
  "| Neutron: routers | all | own project only | own project only |":
    "| Neutron：路由器 | 全部 | 僅自己的專案 | 僅自己的專案 |",
  "| Neutron: floating IPs | all | own project only | own project only |":
    "| Neutron：浮動 IP | 全部 | 僅自己的專案 | 僅自己的專案 |",
  "| Neutron: IP availabilities | all | all | nothing |":
    "| Neutron：IP 可用性 | 全部 | 全部 | 無 |",
  "| Neutron: security groups | all | 409, expected | own project only |":
    "| Neutron：安全性群組 | 全部 | 409，符合預期 | 僅自己的專案 |",
  "| Neutron: ports | all | own project only | own project only |":
    "| Neutron：連接埠 | 全部 | 僅自己的專案 | 僅自己的專案 |",
  "| Neutron: quotas | all | refused | refused |":
    "| Neutron：配額 | 全部 | 遭拒絕 | 遭拒絕 |",
  "| Cinder: volumes, all projects | all | own project only | own project only |":
    "| Cinder：磁碟區，所有專案 | 全部 | 僅自己的專案 | 僅自己的專案 |",
  "| Cinder: services | all | refused | refused |":
    "| Cinder：服務 | 全部 | 遭拒絕 | 遭拒絕 |",
  "| Cinder: pools | all | refused | refused |":
    "| Cinder：集區 | 全部 | 遭拒絕 | 遭拒絕 |",
  "| Cinder: snapshots, all projects | all | own project only | own project only |":
    "| Cinder：快照，所有專案 | 全部 | 僅自己的專案 | 僅自己的專案 |",
  "| Cinder: backups, all projects | all | none recorded | none recorded |":
    "| Cinder：備份，所有專案 | 全部 | 無紀錄 | 無紀錄 |",
  "| Cinder: volume types | all | what anyone sees | what anyone sees |":
    "| Cinder：磁碟區類型 | 全部 | 任何人都看得到的 | 任何人都看得到的 |",
  "| Glance: images | all | what anyone sees | what anyone sees |":
    "| Glance：映像 | 全部 | 任何人都看得到的 | 任何人都看得到的 |",
  "- **all**: the same rows an admin saw.":
    "- **全部**：與管理員看到的列相同。",
  "- **own project only**: that project's rows, and anything shared or external. On a project that holds nothing, that is just the shared and external ones.":
    "- **僅自己的專案**：該專案的列，以及所有共用或外部的內容。在空的專案上，就只有共用與外部的那些。",
  "- **refused**: a `401` or a `403`.": "- **遭拒絕**：`401` 或 `403`。",
  "- **what anyone sees**: every credential saw every row, on clouds that hold only public flavors, volume types and images. A private one in another project takes **Full view**.":
    "- **任何人都看得到的**：在只有公開規格、磁碟區類型與映像的雲端上，每個憑證都看到了每一列。其他專案中的私人項目需要 **完整檢視**。",
  "- **nothing**: a `200` with no rows, on a project that has networks too. It looks like it worked, and it did not.":
    "- **無**：在一個也有網路的專案上回應沒有任何列的 `200`。看起來成功了，實際上並沒有。",
  "- **none recorded**: a `200` with no rows where an admin saw none either, so there was nothing to tell by.":
    "- **無紀錄**：在管理員也一列都沒看到的地方回應沒有任何列的 `200`，因此無從判斷。",
  "- **409, expected**: Neutron tries to create the project's default security group when it lists them, and zero quota does not let it, so it answers `409 Quota exceeded`. That is harmless, and nothing to fix.":
    "- **409，符合預期**：Neutron 在列出安全性群組時會嘗試建立專案的預設安全性群組，而零配額不允許這麼做，於是它回應 `409 Quota exceeded`。這無害，也不需要修正。",
  "A list a credential can't read looks empty here: `troubleshoot.sh` says what this credential can read, and what each gap costs.":
    "憑證無法讀取的清單在這裡看起來是空的：`troubleshoot.sh` 會說明這個憑證能讀取什麼，以及每處缺口的代價。",
  "Monitoring must never be what takes a cloud down, so the agent is gentle by default:":
    "監控絕不能成為拖垮雲端的原因，所以代理程式預設很溫和：",
  "| Reads | Every | Gives |": "| 讀取 | 間隔 | 提供 |",
  "| **Compute (Nova)** | 2 minutes | Services, hypervisors, instances and flavors |":
    "| **運算（Nova）** | 2 分鐘 | 服務、虛擬化主機、執行個體與規格 |",
  "| **Placement** | 2 minutes | What each hypervisor can promise, and has promised |":
    "| **Placement** | 2 分鐘 | 每台虛擬化主機能承諾的量，以及已經承諾的量 |",
  "| **Networking (Neutron)** | 2 minutes | Agents, networks, subnets, address use, routers and floating IPs |":
    "| **網路（Neutron）** | 2 分鐘 | 代理程式、網路、子網路、位址使用、路由器與浮動 IP |",
  "| **Block Storage (Cinder)** | 2 minutes | Services, volumes, snapshots and storage pools |":
    "| **區塊儲存（Cinder）** | 2 分鐘 | 服務、磁碟區、快照與儲存池 |",
  "| **Identity (Keystone)** | 5 minutes | Projects and domains |":
    "| **身分識別（Keystone）** | 5 分鐘 | 專案與網域 |",
  "| **Images (Glance)** | 5 minutes | Images |":
    "| **映像（Glance）** | 5 分鐘 | 映像 |",
  "- Each service is read on its own, so a failing Nova costs only Nova's numbers, and the rest keep reporting.":
    "- 每個服務單獨讀取，因此 Nova 出問題只會損失 Nova 的數據，其餘服務照常回報。",
  "- A read never outlasts its interval, so a slow one never stacks on the next.":
    "- 一次讀取絕不會超過它的間隔，因此慢的讀取永遠不會疊到下一次上。",
  "- Each project's quotas are off. To turn them on, run the installer again with `OPENSTACK_COLLECT_QUOTAS=true`: a second exporter reads them once an hour, at four calls per project per region. Neutron's quotas answer only **Full view**.":
    "- 每個專案的配額預設關閉。要開啟，請用 `OPENSTACK_COLLECT_QUOTAS=true` 重新執行安裝程式：第二個匯出器會每小時讀取一次，每個專案在每個地區呼叫四次。Neutron 的配額只對 **完整檢視** 回應。",
  "- Nova's own quota lists and usage per server are off. To turn one on, delete its `--disable-metric` line from the exporter's `command` in `docker-compose.yml`. The cost is one call per project per scrape.":
    "- Nova 自己的配額清單與各伺服器用量預設關閉。要開啟其中之一，請從 `docker-compose.yml` 中匯出器的 `command` 刪除對應的 `--disable-metric` 行。代價是每次抓取時每個專案多一次呼叫。",
  "- The per-port series are off: listing every port with an admin credential can saturate Neutron on a large cloud.":
    "- 各連接埠的序列預設關閉：在大型雲端上用管理員憑證列出每個連接埠，可能會讓 Neutron 飽和。",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Give the install script every region's name. It writes one `clouds.yaml` entry for each. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "一個雲端就是一個 Keystone，不論它有多少個地區，一個代理程式就能讀取所有地區。把每個地區的名稱都交給安裝指令碼。它會為每個地區寫入一個 `clouds.yaml` 項目。每個項目都必須以其地區命名：由於序列本身不說明來自哪個地區，收集器會把這個名稱作為 `openstack.region.name` 加到匯出器的序列上。之後 OneUptime 中的每個清單都能依地區篩選。",
  "Regions with a Keystone of their own are separate clouds to OneUptime: run one agent for each.":
    "擁有自己 Keystone 的地區在 OneUptime 中是獨立的雲端：請為每個地區各執行一個代理程式。",
  "**[Very Large OpenStack Clouds](/docs/telemetry/openstack-very-large-clouds)** has what each size costs and how each of these works.":
    "**[超大型 OpenStack 雲端](/docs/telemetry/openstack-very-large-clouds)** 說明了每種規模的代價，以及這些方式各自如何運作。",
  "**Past 5,000 instances, summary mode.** The cloud keeps a row for every part and counts per hypervisor, project and status, and its series per instance and per volume stop. It gives up the history of each settled instance's and volume's status, and a chart or a monitor over those series. An instance or volume in a state an alert watches keeps its series, so every alert template goes on working. To keep them for some, choose their projects under **Real usage per instance** on the cloud's **Settings** page.":
    "**超過 5,000 個執行個體：摘要模式。** 雲端會為每個元件保留一列，並依虛擬化主機、專案與狀態計數，而它依執行個體與依磁碟區的序列會停止。它會放棄每個已穩定的執行個體與磁碟區的狀態歷程，以及基於這些序列的圖表或監測器。處於警示所監看狀態的執行個體或磁碟區會保留其序列，因此每個警示範本都能繼續運作。若想為部分執行個體保留，請在雲端的 **設定** 頁面的 **每個執行個體的實際用量** 下選擇它們的專案。",
  "**Sharing a cloud between agents.** Run one agent per region, or per service for the largest clouds, each with the same `OPENSTACK_CLOUD_NAME`. A region and a service belong to one agent, and Keystone to one agent for the whole cloud, or their series arrive twice. List an agent's regions in `OPENSTACK_EXPORTER_CLOUDS`, and its services in `OPENSTACK_AGENT_SERVICES`, such as `compute|placement`.":
    "**在多個代理程式之間分擔一個雲端。** 每個地區執行一個代理程式，對於最大的雲端則每個服務執行一個，並且都使用同一個 `OPENSTACK_CLOUD_NAME`。一個地區與一個服務只屬於一個代理程式，Keystone 則在整個雲端中只屬於一個代理程式，否則它們的序列會抵達兩次。在 `OPENSTACK_EXPORTER_CLOUDS` 中列出代理程式的地區，在 `OPENSTACK_AGENT_SERVICES` 中列出它的服務，例如 `compute|placement`。",
  "**Past 1,500 hypervisors or 100,000 instances, the database path.** The agent can read the cloud's databases rather than its APIs, which at that size cannot be read in a scrape's time. It asks for a read-only account on each service's database, a route to them from this machine, and one exporter per region and Nova cell. It reads the same series, but for whether each Nova worker is alive and how full each storage pool is, which it still reads from the API, and it cannot say whether an API answers. It has not yet been run against a real database.":
    "**超過 1,500 台虛擬化主機或 100,000 個執行個體：資料庫路徑。** 代理程式可以讀取雲端的資料庫而不是它的 API，因為在這種規模下，API 無法在一次抓取的時間內讀完。它需要每個服務資料庫上的唯讀帳號、從這台機器通往那裡的路由，以及每個地區與每個 Nova cell 各一個匯出器。它讀取相同的序列，但每個 Nova worker 是否存活、每個儲存池有多滿仍從 API 讀取，而且它無法判斷 API 是否有回應。它尚未在真實資料庫上執行過。",
  "The install script writes these to `/opt/oneuptime-openstack-agent/.env`. After changing one, apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`.":
    "安裝指令碼會把這些寫入 `/opt/oneuptime-openstack-agent/.env`。變更其中任何一項後，在 `/opt/oneuptime-openstack-agent` 中用 `docker compose up -d` 套用。",
  "| Variable | Required | Description |": "| 變數 | 必填 | 說明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 執行個體的 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | Yes | Telemetry ingestion key: the one picked in step 1 |":
    "| `ONEUPTIME_TELEMETRY_INGESTION_KEY` | 是 | 遙測擷取金鑰：在步驟 1 中選擇的那個 |",
  "| `OPENSTACK_CLOUD_NAME` | Yes | The cloud's name in OneUptime, stamped on every metric as the `openstack.cloud.name` resource attribute. Keep it stable: changing it registers a new cloud |":
    "| `OPENSTACK_CLOUD_NAME` | 是 | 雲端在 OneUptime 中的名稱，作為資源屬性 `openstack.cloud.name` 加到每個指標上。請保持不變：變更它會註冊一個新的雲端 |",
  "| `OPENSTACK_EXPORTER_CLOUDS` | Yes | The `clouds.yaml` entries to read, one per region and named for the region, in square brackets: `[RegionOne,RegionTwo]` |":
    "| `OPENSTACK_EXPORTER_CLOUDS` | 是 | 要讀取的 `clouds.yaml` 項目，每個地區一個並以地區命名，放在方括號中：`[RegionOne,RegionTwo]` |",
  "| `OPENSTACK_AUTH_URL` | Bundled exporter | The Keystone auth URL. `/v3` is added if it is missing |":
    "| `OPENSTACK_AUTH_URL` | 內建匯出器 | Keystone 驗證 URL。缺少 `/v3` 時會自動補上 |",
  "| `OPENSTACK_EXPORTER_ADDRESS` | No | `host:port` of your own exporter, with no scheme. Leave it out for the bundled one |":
    "| `OPENSTACK_EXPORTER_ADDRESS` | 否 | 你自己的匯出器的 `host:port`，不帶協定。使用內建匯出器時省略 |",
  "| `OPENSTACK_QUOTA_CLOUDS` | No | The `clouds.yaml` entries to read each project's quotas from, once an hour. The install script sets it when run with `OPENSTACK_COLLECT_QUOTAS=true` |":
    "| `OPENSTACK_QUOTA_CLOUDS` | 否 | 每小時一次從中讀取每個專案配額的 `clouds.yaml` 項目。以 `OPENSTACK_COLLECT_QUOTAS=true` 執行時，安裝指令碼會設定它 |",
  "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | No | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_QUOTA_EXPORTER_ADDRESS` | 否 | 讀取這些內容的匯出器的 `host:port`。使用內建匯出器時省略 |",
  "| `OPENSTACK_EXPORTER_USER` | No | The `uid:gid` the exporter's container runs as, which must own `clouds.yaml` (default: `65532:65532`) |":
    "| `OPENSTACK_EXPORTER_USER` | 否 | 匯出器容器執行時使用的 `uid:gid`，它必須擁有 `clouds.yaml`（預設：`65532:65532`） |",
  "| `OPENSTACK_CA_FILE` | No | A PEM file with the certificate authority of a cloud that has its own |":
    "| `OPENSTACK_CA_FILE` | 否 | 一個 PEM 檔案，包含擁有自己憑證授權單位之雲端的 CA |",
  "| `COMPOSE_PROFILES` | Bundled exporter | `openstack-exporter` starts the bundled exporter, and `openstack-ai-agent` the OneUptime AI agent |":
    "| `COMPOSE_PROFILES` | 內建匯出器 | `openstack-exporter` 啟動內建匯出器，`openstack-ai-agent` 啟動 OneUptime AI 代理程式 |",
  "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | No | An exporter already running without `--multi-cloud`, such as Kolla-Ansible's: `[10.0.0.254:9198]`. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it |":
    "| `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` | 否 | 已經在不帶 `--multi-cloud` 的情況下執行的匯出器，例如 Kolla-Ansible 的：`[10.0.0.254:9198]`。同時設定 `OPENSTACK_EXPORTER_CLOUDS=[]` |",
  "| `OPENSTACK_RABBITMQ_TARGETS` | No | RabbitMQ's Prometheus plugin on each node: `[10.0.0.11:15692,10.0.0.12:15692]` |":
    "| `OPENSTACK_RABBITMQ_TARGETS` | 否 | 每個節點上 RabbitMQ 的 Prometheus 外掛程式：`[10.0.0.11:15692,10.0.0.12:15692]` |",
  "| `OPENSTACK_MARIADB_TARGETS` | No | mysqld_exporter beside each MariaDB node, usually on `9104` |":
    "| `OPENSTACK_MARIADB_TARGETS` | 否 | 每個 MariaDB 節點旁邊的 mysqld_exporter，通常在 `9104` |",
  "| `OPENSTACK_MEMCACHED_TARGETS` | No | memcached_exporter beside each Memcached, usually on `9150` |":
    "| `OPENSTACK_MEMCACHED_TARGETS` | 否 | 每個 Memcached 旁邊的 memcached_exporter，通常在 `9150` |",
  "| `OPENSTACK_HAPROXY_TARGETS` | No | HAProxy's own Prometheus exporter |":
    "| `OPENSTACK_HAPROXY_TARGETS` | 否 | HAProxy 自己的 Prometheus 匯出器 |",
  "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | No | openstack-network-exporter on each node, for OVN and Open vSwitch, usually on `1981` |":
    "| `OPENSTACK_NETWORK_EXPORTER_TARGETS` | 否 | 每個節點上的 openstack-network-exporter，用於 OVN 與 Open vSwitch，通常在 `1981` |",
  "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | No | prometheus-libvirt-exporter on each compute node, usually on `9177`, for whether libvirt answers and nothing per instance |":
    "| `OPENSTACK_LIBVIRT_HEALTH_TARGETS` | 否 | 每個運算節點上的 prometheus-libvirt-exporter，通常在 `9177`，只看 libvirt 是否回應，不含任何各執行個體的資料 |",
  "| `OPENSTACK_CONTROL_PLANE_REGION` | No | The region of a target above that does not say its own. A target can: `RegionTwo@10.1.0.11:15692` |":
    "| `OPENSTACK_CONTROL_PLANE_REGION` | 否 | 上面那些目標中沒有自帶地區之目標所屬的地區。目標也可以自帶地區：`RegionTwo@10.1.0.11:15692` |",
  "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | No | The same exporter, for what each instance is really doing. Per-instance series multiply fast |":
    "| `OPENSTACK_LIBVIRT_EXPORTER_TARGETS` | 否 | 同一個匯出器，用於了解每個執行個體實際在做什麼。各執行個體的序列增長很快 |",
  "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | No | Ceilometer's exporter on each compute node, usually on `9101`, for the same |":
    "| `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` | 否 | 每個運算節點上 Ceilometer 的匯出器，通常在 `9101`，用途相同 |",
  "`clouds.yaml` alone holds the credential.": "只有 `clouds.yaml` 保存憑證。",
  "Only the largest clouds need these, and none is asked for:":
    "只有最大的雲端才需要這些，而且都不會被詢問：",
  "| Variable | Description |": "| 變數 | 說明 |",
  "| `OPENSTACK_AGENT_SERVICES` | Which services this agent reads, as a pattern: `compute\\|placement` here and the rest on a second agent. Every service by default. No two agents should read one service of one region |":
    "| `OPENSTACK_AGENT_SERVICES` | 此代理程式讀取哪些服務，以模式表示：這裡是 `compute\\|placement`，其餘的放在第二個代理程式上。預設讀取所有服務。不能有兩個代理程式讀取同一地區的同一個服務 |",
  "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | The memory the collector may use, in MiB (default: `512`). It holds a whole scrape, so raise this past tens of thousands of instances |":
    "| `OPENSTACK_AGENT_MEMORY_LIMIT_MIB` | 收集器可使用的記憶體，單位 MiB（預設：`512`）。它要容納一次完整的抓取，因此執行個體超過數萬個時請調高 |",
  "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | Reading each service's database rather than its API, with a read-only account: where that exporter answers. Set `OPENSTACK_EXPORTER_CLOUDS=[]` with it, or every series arrives twice |":
    "| `OPENSTACK_DATABASE_EXPORTER_TARGETS` | 以唯讀帳號讀取每個服務的資料庫而不是它的 API 時，那個匯出器回應的位置。同時設定 `OPENSTACK_EXPORTER_CLOUDS=[]`，否則每個序列都會抵達兩次 |",
  "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | The database of each service it reads, as `mysql+pymysql://oneuptime:secret@db.example:3306/nova`. One left empty is a service it leaves alone. Each holds a password, and `.env` is readable by its owner alone |":
    "| `NOVA_DATABASE_URL`, `NOVA_API_DATABASE_URL`, `PLACEMENT_DATABASE_URL`, `NEUTRON_DATABASE_URL`, `CINDER_DATABASE_URL`, `GLANCE_DATABASE_URL`, `KEYSTONE_DATABASE_URL` | 它讀取的每個服務的資料庫，格式為 `mysql+pymysql://oneuptime:secret@db.example:3306/nova`。留空的就是它不碰的服務。每一項都包含密碼，而 `.env` 只有其擁有者可讀 |",
  "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | What Nova adds to a host's name to make a hypervisor's, such as `.example.org`, so an instance finds the hypervisor it runs on |":
    "| `OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX` | Nova 加在主機名稱後面以構成虛擬化主機名稱的部分，例如 `.example.org`，這樣執行個體才能找到它所執行的虛擬化主機 |",
  "| `OPENSTACK_WORKER_STATE_CLOUDS` | The `clouds.yaml` entries to read from Nova's and Cinder's APIs what their databases cannot say: whether each worker is alive, and how full each pool is |":
    "| `OPENSTACK_WORKER_STATE_CLOUDS` | 用來從 Nova 與 Cinder 的 API 讀取其資料庫無法說明之內容的 `clouds.yaml` 項目：每個 worker 是否存活，以及每個集區有多滿 |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | `host:port` of the exporter that reads those. Leave it out for the bundled one |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS` | 讀取這些內容的匯出器的 `host:port`。使用內建匯出器時省略 |",
  "| `OPENSTACK_QUOTA_CLOUDS` | The `clouds.yaml` entries to read each project's quotas from, once an hour. Empty reads none, and `OPENSTACK_COLLECT_QUOTAS=true` in the install script fills it in |":
    "| `OPENSTACK_QUOTA_CLOUDS` | 每小時一次從中讀取每個專案配額的 `clouds.yaml` 項目。留空則不讀取任何配額，安裝指令碼中的 `OPENSTACK_COLLECT_QUOTAS=true` 會填好它 |",
  "The OneUptime AI agent reads the credential in `clouds.yaml` unless these say otherwise, and none is asked for:":
    "除非下列變數另有指定，OneUptime AI 代理程式會讀取 `clouds.yaml` 中的憑證，而且這些變數都不會被詢問：",
  "| `ONEUPTIME_AI_INVESTIGATION` | `false` stops OneUptime AI investigating this cloud with the agent |":
    "| `ONEUPTIME_AI_INVESTIGATION` | `false` 會阻止 OneUptime AI 透過此代理程式調查這個雲端 |",
  "| `OPENSTACK_AI_CLOUDS_FILE` | The `clouds.yaml` it mounts. `/dev/null` when it has a credential of its own and there is no such file beside it |":
    "| `OPENSTACK_AI_CLOUDS_FILE` | 它掛載的 `clouds.yaml`。當它有自己的憑證、旁邊又沒有這樣的檔案時為 `/dev/null` |",
  "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | The entry of `clouds.yaml` to use, when it is not the first of `OPENSTACK_EXPORTER_CLOUDS` |":
    "| `ONEUPTIME_AI_OPENSTACK_CLOUD` | 要使用的 `clouds.yaml` 項目（當它不是 `OPENSTACK_EXPORTER_CLOUDS` 中的第一個時） |",
  "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | A credential of its own, used instead of `clouds.yaml`'s. Set both, with `OPENSTACK_AUTH_URL` |":
    "| `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_APPLICATION_CREDENTIAL_SECRET` | 它自己的憑證，用來取代 `clouds.yaml` 中的憑證。兩者都要設定，並搭配 `OPENSTACK_AUTH_URL` |",
  "| `OPENSTACK_AUTH_URL` | The Keystone a credential of its own logs in to |":
    "| `OPENSTACK_AUTH_URL` | 它自己的憑證登入的 Keystone |",
  "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | The region a command reads when it names none, which endpoints it uses (`public`, `internal` or `admin`), and a certificate authority. `clouds.yaml` says these unless they do |":
    "| `ONEUPTIME_AI_OPENSTACK_REGION`, `ONEUPTIME_AI_OPENSTACK_INTERFACE`, `ONEUPTIME_AI_OPENSTACK_CA_FILE` | 指令未指定地區時讀取的地區、它使用的端點（`public`、`internal` 或 `admin`），以及憑證授權單位。除非這些變數另有設定，否則由 `clouds.yaml` 決定 |",
  "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | The name it registers under, when it is not `OPENSTACK_CLOUD_NAME` |":
    "| `ONEUPTIME_AI_AGENT_RESOURCE_NAME` | 它註冊時使用的名稱（當它不是 `OPENSTACK_CLOUD_NAME` 時） |",
  "| `LOG_LEVEL` | How much it logs |":
    "| `LOG_LEVEL` | 它記錄日誌的詳細程度 |",
  "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | Off until set: let it make changes, through a credential of their own. The OpenStack guide says how to make it with the least it needs |":
    "| `ONEUPTIME_AI_ALLOW_WRITES`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_ID`, `ONEUPTIME_AI_OPENSTACK_WRITE_APPLICATION_CREDENTIAL_SECRET` | 設定之前保持關閉：透過它們自己的憑證允許它進行變更。OpenStack 指南說明了如何以最小權限建立該憑證 |",
  "| `ONEUPTIME_AI_FIXES` | How AI may apply a fix: off, ask-for-approval, automatic or bypass-approval. Empty: fixes stay off until someone chooses on this page |":
    "| `ONEUPTIME_AI_FIXES` | AI 套用修正的方式：off、ask-for-approval、automatic 或 bypass-approval。留空：在有人於此頁面上做出選擇之前，修正保持關閉 |",
  "| `ONEUPTIME_AI_PROTECTED_TARGETS` | What is never touched, whatever else is set and whoever approves it: `project:ID`, `host:NAME` or `instance:ID`, separated by commas |":
    "| `ONEUPTIME_AI_PROTECTED_TARGETS` | 無論其他設定如何、無論誰核准，都永遠不會被碰的對象：`project:ID`、`host:NAME` 或 `instance:ID`，以逗號分隔 |",
  "| `ONEUPTIME_AI_WRITE_TARGETS` | Where changes may land, written the same way. Empty: anywhere that is not protected |":
    "| `ONEUPTIME_AI_WRITE_TARGETS` | 允許變更落在哪裡，寫法相同。留空：任何未受保護的地方 |",
  "Set `OPENSTACK_EXPORTER_ADDRESS` as you run the install script, such as `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`. The bundled exporter then never starts, and no Keystone URL or credential is asked for.":
    "在執行安裝指令碼時設定 `OPENSTACK_EXPORTER_ADDRESS`，例如 `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180 bash install.sh`。這樣內建匯出器永遠不會啟動，也不會詢問 Keystone URL 或憑證。",
  "Your exporter must run with `--multi-cloud`, and its `clouds.yaml` needs an entry named for each region. Turn off what the bundled one turns off: see **What the agent collects, and what it costs your cloud**. Use an address the agent's container can reach: `localhost` inside the container is the container itself.":
    "你的匯出器必須帶 `--multi-cloud` 執行，其 `clouds.yaml` 需要為每個地區準備一個以該地區命名的項目。關閉內建匯出器所關閉的內容：請參閱 **代理程式收集什麼，以及對您的雲端有何成本**。使用代理程式容器能連到的位址：容器內的 `localhost` 指的是容器本身。",
  "**Started without `--multi-cloud`?** Kolla-Ansible's is, and Canonical's charm. It has no `/probe`, so set `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` instead of the address above, with `OPENSTACK_EXPORTER_CLOUDS=[]` and `OPENSTACK_CONTROL_PLANE_REGION`. It is then asked for everything at once, every 2 minutes.":
    "**未帶 `--multi-cloud` 啟動？** Kolla-Ansible 的匯出器就是這樣，Canonical 的 charm 也是。它沒有 `/probe`，所以請設定 `OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS` 來取代上面的位址，並同時設定 `OPENSTACK_EXPORTER_CLOUDS=[]` 與 `OPENSTACK_CONTROL_PLANE_REGION`。之後每 2 分鐘會向它一次請求所有內容。",
  "**On exporter 1.7.0,** which Kolla-Ansible pins, it answers either way, and the pages go without what it does not say. On five real clouds that was:":
    "**在匯出器 1.7.0 上，** 也就是 Kolla-Ansible 固定的版本，無論哪種方式它都會回應，而頁面上會缺少它沒有提供的內容。在五個真實的雲端上，缺少的是：",
  "Give the install script the file when it asks for a private CA file. It copies it to `ca.pem`, and names it in `clouds.yaml`.":
    "當安裝指令碼詢問私人 CA 檔案時，把該檔案交給它。它會把檔案複製為 `ca.pem`，並在 `clouds.yaml` 中指定它。",
  "On Linux (x86_64 or arm64) with systemd 235 or later and glibc 2.34 or later (not RHEL 8), the install script can run the same collector and exporter releases as systemd services instead:":
    "在裝有 systemd 235 或更新版本、glibc 2.34 或更新版本的 Linux（x86_64 或 arm64，不含 RHEL 8）上，安裝指令碼可以改為把相同版本的收集器與匯出器作為 systemd 服務執行：",
  "Moving off a Docker install? Run `docker compose down` first, or every metric arrives twice. Running the script again stays whichever it was, so `sudo bash install.sh` is the upgrade.":
    "要從 Docker 安裝遷移過來嗎？請先執行 `docker compose down`，否則每個指標都會抵達兩次。再次執行指令碼時會維持原本的方式，因此 `sudo bash install.sh` 就是升級。",
  "The `resource` processor in `otel-collector-config.yaml` stamps every metric with the cloud's name. OneUptime registers the cloud from that attribute, and every page and monitor scopes on it. The two deletes keep OneUptime from registering a Service named after the scrape job, so keep them if you customize the file:":
    "`otel-collector-config.yaml` 中的 `resource` 處理器會為每個指標加上雲端的名稱。OneUptime 根據這個屬性註冊雲端，每個頁面與監測器也都依它限定範圍。那兩處刪除可防止 OneUptime 註冊一個以抓取工作命名的服務，所以自訂該檔案時請保留它們：",
  "The whole file is on this OneUptime:": "完整檔案就在這個 OneUptime 上：",
  "Any resource attribute prefixed with `oneuptime.label.` becomes a project label on the cloud: `oneuptime.label.<dimension>=<value>` is the label `<dimension>:<value>`. Add them to the `resource` processor in `otel-collector-config.yaml`, next to `openstack.cloud.name`:":
    "任何以 `oneuptime.label.` 為前綴的資源屬性都會成為雲端上的專案標籤：`oneuptime.label.<dimension>=<value>` 就是標籤 `<dimension>:<value>`。把它們加到 `otel-collector-config.yaml` 中 `resource` 處理器裡 `openstack.cloud.name` 的旁邊：",
  "Then restart the collector so it reads the new config:":
    "然後重新啟動收集器，讓它讀取新組態：",
  "The cloud shows up tagged `team:platform` and `env:production`. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "雲端會帶著 `team:platform` 與 `env:production` 標籤出現。標籤比對不分大小寫，因此會沿用既有的 `Production` 標籤；在 OneUptime 介面中加入的標籤永遠不會被代理程式移除。",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Run the install script again. It reuses every value in your existing `.env` and `clouds.yaml` (nothing is asked again), downloads the latest files (a file you edited is kept next to the new one as `<file>.bak.<timestamp>`), pulls the images and recreates the agent with them:":
    "**升級。** 映像固定在 `docker-compose.yml` 中，它的設定是旁邊的一個檔案，所以單靠拉取映像無法讓代理程式前進。請重新執行安裝指令碼。它會沿用你現有 `.env` 與 `clouds.yaml` 中的每個值（不會再詢問任何內容），下載最新的檔案（你編輯過的檔案會以 `<file>.bak.<timestamp>` 保留在新檔案旁邊），拉取映像，並用它們重新建立代理程式：",
  "The config reports the collector version it pins as the cloud's **Agent Version**. When this OneUptime pins a newer one, a warning sign beside it opens these commands.":
    "設定會把它固定的收集器版本回報為雲端的 **代理程式版本**。當這個 OneUptime 固定了更新的版本時，旁邊的警告標誌會開啟這些指令。",
  "**Uninstall** the agent:": "**解除安裝**代理程式：",
  "Then delete `/opt/oneuptime-openstack-agent`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "然後刪除保存著憑證的 `/opt/oneuptime-openstack-agent`，以及應用程式憑證本身：`openstack application credential delete oneuptime-agent`。",
  "`troubleshoot.sh` checks the whole chain, from DNS and TLS to Keystone, each service in the catalog and your ingestion key, and says what this credential can read and what each gap costs.":
    "`troubleshoot.sh` 會檢查整條鏈路，從 DNS 與 TLS 到 Keystone、目錄中的每個服務以及你的擷取金鑰，並說明這個憑證能讀取什麼，以及每處缺口的代價。",
  "It needs `sudo` to read `clouds.yaml`, or it skips the credential checks. It ends with a verdict naming the most likely cause.":
    "它需要 `sudo` 才能讀取 `clouds.yaml`，否則會略過憑證檢查。最後它會給出一個結論，指出最可能的原因。",
  "1. Check that the agent is running (in `/opt/oneuptime-openstack-agent`): `docker compose ps`":
    "1. 檢查代理程式是否在執行（在 `/opt/oneuptime-openstack-agent` 中）：`docker compose ps`",
  "2. Check the agent logs for errors: `docker compose logs oneuptime-openstack-agent | grep -i error`":
    "2. 檢查代理程式日誌中的錯誤：`docker compose logs oneuptime-openstack-agent | grep -i error`",
  "3. Verify your OneUptime URL and ingestion key are correct.":
    "3. 確認你的 OneUptime URL 與擷取金鑰正確。",
  "4. Ensure the agent machine can reach the OneUptime instance over the network.":
    "4. 確定代理程式所在的機器能透過網路連到 OneUptime 執行個體。",
  "A **Project view** credential can't read them, and neither can a role without the policy overrides: Nova, Neutron and Placement keep them for admins by default. Use **Full view**, or **Infrastructure only** with the files in `access/policy` merged into the file each service's `[oslo_policy] policy_file` names. `troubleshoot.sh` says which reads were refused.":
    "**專案檢視** 憑證無法讀取它們，沒有原則覆寫的角色也不行：Nova、Neutron 與 Placement 預設只開放給管理員。請使用 **完整檢視**，或使用 **僅基礎架構**，並把 `access/policy` 中的檔案合併到每個服務的 `[oslo_policy] policy_file` 所指向的檔案中。`troubleshoot.sh` 會說明哪些讀取遭到拒絕。",
  "Only **Full view** sees `cinder-volume` and `cinder-scheduler` state and storage pools. Cinder's own code answers anything else with `403 User does not have admin privileges`, after policy has already passed, so no override opens them.":
    "只有 **完整檢視** 看得到 `cinder-volume` 與 `cinder-scheduler` 的狀態以及儲存池。在原則已經放行之後，Cinder 自己的程式碼仍會對其他任何憑證回應 `403 User does not have admin privileges`，所以任何覆寫都打不開它們。",
  "Neutron and Cinder answer anything but an admin with `200` and only its own project, which looks like it worked. Seeing every project takes **Full view**. With **Infrastructure only**, they appear for the projects the role is assigned on, and a role on a real project can also write there on many clouds.":
    "Neutron 與 Cinder 對管理員以外的任何身分都回應 `200`，而且只給出其自己的專案，看起來像是成功了。要看到每個專案，需要 **完整檢視**。使用 **僅基礎架構** 時，它們會顯示指派了該角色的專案，而且在許多雲端上，真實專案上的角色也能在那裡寫入。",
  "A **Project view** credential shows no instances through the agent: the exporter asks Nova for all projects' servers, Nova refuses a plain reader, and that read fails whole. **Full view** and **Infrastructure only** both see every project's instances.":
    "**專案檢視** 憑證透過代理程式看不到任何執行個體：匯出器向 Nova 請求所有專案的伺服器，Nova 拒絕一般讀者，這次讀取就整個失敗。**完整檢視** 與 **僅基礎架構** 都看得到每個專案的執行個體。",
  "That is expected with **Infrastructure only**, and harmless. Neutron tries to create a project's default security group when it lists them, and a project with zero quota cannot hold one. There is nothing to fix.":
    "使用 **僅基礎架構** 時這是預期中的情況，而且無害。Neutron 在列出安全性群組時會嘗試建立專案的預設安全性群組，而配額為零的專案無法擁有安全性群組。不需要修正。",
  "On Flamingo and Epoxy, oslo.policy raises on every check once a policy file it has read is gone, and when the service is Keystone the whole cloud answers `503`. Restart the service. To take the overrides off, empty the file (`{}`) and never delete it.":
    "在 Flamingo 與 Epoxy 上，一旦已讀取過的原則檔案消失，oslo.policy 會在每次檢查時報錯，而當該服務是 Keystone 時，整個雲端都會回應 `503`。請重新啟動該服務。要移除覆寫，請清空檔案（`{}`），永遠不要刪除它。",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in `/opt/oneuptime-openstack-agent`): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "代理程式分別讀取每個服務，因此出問題的服務只會損失它自己的數據。查看匯出器為什麼無法讀取它（在 `/opt/oneuptime-openstack-agent` 中）：`docker compose logs oneuptime-openstack-exporter`。**服務** 頁面會把該 API 顯示為 `down`。以舊版規則副本建立的存取規則憑證，在 Swift 以及路徑後面的 Octavia 上也會如此：請依照 **完整檢視** 中的做法重新建立一個。",
  "The services are refusing a credential limited by access rules. A service behind a path prefix refuses the shipped rules: fit them to this cloud with `access-rules-for-cloud.py`, as **Full view** does. And each service needs `service_type` set for keystonemiddleware, and a restart:":
    "這些服務正在拒絕受存取規則限制的憑證。位於路徑前綴之後的服務會拒絕隨附的規則：請依照 **完整檢視** 中的做法，用 `access-rules-for-cloud.py` 把規則調整成適合這個雲端。此外，每個服務都需要為 keystonemiddleware 設定 `service_type`，並重新啟動：",
  "If you won't change that, create the credential without `--access-rules`, knowing it can write.":
    "如果你不打算改這些，就不帶 `--access-rules` 建立憑證，但要清楚它能夠寫入。",
  "The exporter runs as uid 65532, and `clouds.yaml` is readable by its owner alone. Give the file to that user, or set `OPENSTACK_EXPORTER_USER` in `.env` to the file owner's `uid:gid`, and apply it with `docker compose up -d`.":
    "匯出器以 uid 65532 執行，而 `clouds.yaml` 只有其擁有者可讀。把檔案交給該使用者，或在 `.env` 中把 `OPENSTACK_EXPORTER_USER` 設為檔案擁有者的 `uid:gid`，然後用 `docker compose up -d` 套用。",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "雲端的身分來自 `OPENSTACK_CLOUD_NAME`，它作為 `openstack.cloud.name` 加在每個指標上。在 `.env` 中修正它，然後在 `/opt/oneuptime-openstack-agent` 中用 `docker compose up -d` 套用。新名稱會註冊一個新的雲端。",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in `/opt/oneuptime-openstack-agent`. A new name registers a new cloud.":
    "雲端的身分來自 `OPENSTACK_CLOUD_NAME`，它作為 `openstack.cloud.name` 加在每個指標上。這個雲端是 **`cloud-1`**。在 `.env` 中修正它，然後在 `/opt/oneuptime-openstack-agent` 中用 `docker compose up -d` 套用。新名稱會註冊一個新的雲端。",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin, on the machine that will run the agent":
    "執行代理程式的機器上裝有 Docker Engine 20.10 或更新版本以及 Docker Compose v2 外掛程式",
  "Download `docker-compose.yml` and `otel-collector-config.yaml` from this OneUptime into a new folder:":
    "從這個 OneUptime 把 `docker-compose.yml` 與 `otel-collector-config.yaml` 下載到一個新資料夾中：",
  "Create a `clouds.yaml` file next to them, with the credential from the previous step. It needs one entry per region, each named for its region, because the exporter's series do not say which region they are from:":
    "在它們旁邊建立一個 `clouds.yaml` 檔案，寫入上一步的憑證。由於匯出器的序列本身不說明來自哪個地區，它需要每個地區一個項目，並各自以地區命名：",
  "Create a `.env` file next to them too:":
    "在它們旁邊再建立一個 `.env` 檔案：",
  "- Replace `my-openstack-cloud` with a name for this cloud, such as `prod-eu`. It is how the cloud appears in OneUptime, so keep it stable: a new name registers a new cloud.":
    "- 把 `my-openstack-cloud` 換成這個雲端的名稱，例如 `prod-eu`。這是雲端在 OneUptime 中的顯示方式，所以請保持不變：新名稱會註冊一個新的雲端。",
  "- List every region in `OPENSTACK_EXPORTER_CLOUDS`, in square brackets, such as `[RegionOne,RegionTwo]`.":
    "- 在 `OPENSTACK_EXPORTER_CLOUDS` 中用方括號列出每個地區，例如 `[RegionOne,RegionTwo]`。",
  "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` starts the bundled exporter, which reads the cloud with `clouds.yaml`, and the OneUptime AI agent, which reads it with the same file while OneUptime AI investigates.":
    "- `COMPOSE_PROFILES=openstack-exporter,openstack-ai-agent` 會啟動用 `clouds.yaml` 讀取雲端的內建匯出器，以及在 OneUptime AI 調查時用同一個檔案讀取雲端的 OneUptime AI 代理程式。",
  "Both files hold secrets, so keep them to their owner. The exporter runs as uid 65532, and must be the one account that can read `clouds.yaml`. Then start the agent:":
    "這兩個檔案都含有機密，所以只讓其擁有者存取。匯出器以 uid 65532 執行，並且必須是唯一能讀取 `clouds.yaml` 的帳號。然後啟動代理程式：",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在步驟 1 中選擇擷取金鑰即可填入 `<YOUR_API_KEY>`。",
  "A cloud is one Keystone, however many regions it has, and one agent reads them all. Add one `clouds.yaml` entry per region, and list them all in `OPENSTACK_EXPORTER_CLOUDS`. Each entry must be named for its region: the collector stamps that name on the exporter's series as `openstack.region.name`, because the series do not say which region they are from. Every list in OneUptime then filters by region.":
    "一個雲端就是一個 Keystone，不論它有多少個地區，一個代理程式就能讀取所有地區。每個地區加入一個 `clouds.yaml` 項目，並把它們都列在 `OPENSTACK_EXPORTER_CLOUDS` 中。每個項目都必須以其地區命名：由於序列本身不說明來自哪個地區，收集器會把這個名稱作為 `openstack.region.name` 加到匯出器的序列上。之後 OneUptime 中的每個清單都能依地區篩選。",
  "The agent reads these from the `.env` file next to `docker-compose.yml`. After changing one, apply it with `docker compose up -d` in the folder with `docker-compose.yml`.":
    "代理程式從 `docker-compose.yml` 旁邊的 `.env` 檔案中讀取這些。變更其中任何一項後，在含有 `docker-compose.yml` 的資料夾中用 `docker compose up -d` 套用。",
  "Leave `COMPOSE_PROFILES` out of `.env` and point the agent at your exporter, as `host:port` with no scheme: `OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`. The bundled exporter then never starts.":
    "從 `.env` 中拿掉 `COMPOSE_PROFILES`，並把代理程式指向你的匯出器，寫成不帶協定的 `host:port`：`OPENSTACK_EXPORTER_ADDRESS=10.0.0.5:9180`。這樣內建匯出器永遠不會啟動。",
  "Put the file next to `docker-compose.yml` as `ca.pem`, set `OPENSTACK_CA_FILE=./ca.pem` in `.env`, and add `cacert: /etc/openstack/ca.pem` to each entry of `clouds.yaml`.":
    "把該檔案以 `ca.pem` 的名稱放在 `docker-compose.yml` 旁邊，在 `.env` 中設定 `OPENSTACK_CA_FILE=./ca.pem`，並在 `clouds.yaml` 的每個項目中加入 `cacert: /etc/openstack/ca.pem`。",
  "Run these in the agent's folder, the one with `docker-compose.yml`.":
    "在代理程式資料夾（也就是含有 `docker-compose.yml` 的資料夾）中執行這些指令。",
  "**Upgrade.** The images are pinned in `docker-compose.yml` and its config is a file beside it, so pulling alone does not move the agent forward. Download both files again; your `.env` and `clouds.yaml` stay, and a change you made to either file has to be made again:":
    "**升級。** 映像固定在 `docker-compose.yml` 中，它的設定是旁邊的一個檔案，所以單靠拉取映像無法讓代理程式前進。請重新下載這兩個檔案；你的 `.env` 與 `clouds.yaml` 會保留，但你對這兩個下載檔案中任何一個所做的修改都需要重做一遍：",
  "Then pull the images and recreate the agent, so the collector reads its new config:":
    "然後拉取映像並重新建立代理程式，讓收集器讀取它的新組態：",
  "Then delete the folder with `docker-compose.yml`, which holds the credential, and the application credential itself: `openstack application credential delete oneuptime-agent`.":
    "然後刪除含有 `docker-compose.yml` 的資料夾（其中保存著憑證），以及應用程式憑證本身：`openstack application credential delete oneuptime-agent`。",
  "1. Check that the agent is running (in the agent's folder): `docker compose ps`":
    "1. 檢查代理程式是否在執行（在代理程式資料夾中）：`docker compose ps`",
  "The agent reads each service on its own, so a failing service costs only its own numbers. Look at why the exporter can't read it (in the agent's folder): `docker compose logs oneuptime-openstack-exporter`. The **Services** page shows that API as `down`. An access-rule credential made from an older copy of the rules also does this on Swift, and on Octavia behind a path: make a new one, as **Full view** does.":
    "代理程式分別讀取每個服務，因此出問題的服務只會損失它自己的數據。查看匯出器為什麼無法讀取它（在代理程式資料夾中）：`docker compose logs oneuptime-openstack-exporter`。**服務** 頁面會把該 API 顯示為 `down`。以舊版規則副本建立的存取規則憑證，在 Swift 以及路徑後面的 Octavia 上也會如此：請依照 **完整檢視** 中的做法重新建立一個。",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "雲端的身分來自 `OPENSTACK_CLOUD_NAME`，它作為 `openstack.cloud.name` 加在每個指標上。在 `.env` 中修正它，然後在含有 `docker-compose.yml` 的資料夾中用 `docker compose up -d` 套用。新名稱會註冊一個新的雲端。",
  "- This installs the agent for **`cloud-1`**. Keep `OPENSTACK_CLOUD_NAME` exactly as it is, or the data registers as a new cloud.":
    "- 這會為 **`cloud-1`** 安裝代理程式。請保持 `OPENSTACK_CLOUD_NAME` 原樣不動，否則資料會註冊為一個新的雲端。",
  "The cloud's identity comes from `OPENSTACK_CLOUD_NAME`, stamped on every metric as `openstack.cloud.name`. This cloud is **`cloud-1`**. Fix it in `.env` and apply it with `docker compose up -d` in the folder with `docker-compose.yml`. A new name registers a new cloud.":
    "雲端的身分來自 `OPENSTACK_CLOUD_NAME`，它作為 `openstack.cloud.name` 加在每個指標上。這個雲端是 **`cloud-1`**。在 `.env` 中修正它，然後在含有 `docker-compose.yml` 的資料夾中用 `docker compose up -d` 套用。新名稱會註冊一個新的雲端。",
  "OpenStack-Ansible keeps its services' logs in journald and runs no Prometheus of its own, so the agent is the way in, and the logs have a path of their own.":
    "OpenStack-Ansible 把其服務的日誌保存在 journald 中，也不執行自己的 Prometheus，因此代理程式是接入方式，而日誌另有路徑。",
  "**How far this guide has been tested:** Its paths and variables were read from OpenStack-Ansible's own source and docs. Its commands were then run on a real all-in-one at stable/2026.1, in LXC containers, with a stand-in for OneUptime that kept what the agent sent: the agent on the Full view credential, the agent's exporter on the Infrastructure only credential with its policy overrides, the RabbitMQ and HAProxy settings with the agent reading each, and the logs profile on the journal. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**本指南的測試程度：** 其路徑與變數取自 OpenStack-Ansible 自己的原始碼與文件。之後，它的指令在一台真實的 stable/2026.1 all-in-one（執行於 LXC 容器中）上執行過，並以一個保存代理程式所送內容的 OneUptime 替身作為接收端：使用完整檢視憑證的代理程式、使用僅基礎架構憑證及其原則覆寫的代理程式自帶匯出器、由代理程式逐一讀取的 RabbitMQ 與 HAProxy 設定，以及讀取 journal 的日誌設定檔。代理程式與探測器各自把一個真實的 DevStack 一路接到執行中的 OneUptime，中間經歷 nova-compute 的停止與恢復，但不是透過此工具完成的。",
  "- Log in as an admin from the utility container: `lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`, then `. ~/openrc`. It has no `curl`, which the commands below use, so run `apt-get install -y curl` there first.":
    "- 從 utility 容器以管理員身分登入：`lxc-attach -n $(lxc-ls -1 | grep utility | head -n 1)`，然後 `. ~/openrc`。它沒有下方指令要用的 `curl`，所以請先在那裡執行 `apt-get install -y curl`。",
  "- **Full view** needs one change, to Cinder. OpenStack-Ansible's roles already set `service_type` under `[keystone_authtoken]`, but its Cinder says `volumev3` and its catalog says `block-storage`, and keystonemiddleware refuses a credential limited by access rules with a `401` unless the two agree. Set `service_type: block-storage` under `keystone_authtoken` in `cinder_cinder_conf_overrides` in `/etc/openstack_deploy/user_variables.yml`, then run `openstack-ansible openstack.osa.cinder --tags cinder-config`.":
    "- **完整檢視** 需要對 Cinder 做一處修改。OpenStack-Ansible 的角色已在 `[keystone_authtoken]` 下設定了 `service_type`，但它的 Cinder 寫的是 `volumev3`，目錄寫的是 `block-storage`，兩者不一致時，keystonemiddleware 會以 `401` 拒絕受存取規則限制的憑證。在 `/etc/openstack_deploy/user_variables.yml` 的 `cinder_cinder_conf_overrides` 中，於 `keystone_authtoken` 下設定 `service_type: block-storage`，然後執行 `openstack-ansible openstack.osa.cinder --tags cinder-config`。",
  "- **Infrastructure only** takes its overrides as `nova_policy_overrides`, `neutron_policy_overrides`, `keystone_policy_overrides` and `placement_policy_overrides` in `/etc/openstack_deploy/user_variables.yml`. Apply each with its own playbook and tag, such as `openstack-ansible openstack.osa.nova --tags nova-policy-override`. Taking one out later leaves an empty file behind rather than none, so nothing fails.":
    "- **僅基礎架構** 的覆寫以 `/etc/openstack_deploy/user_variables.yml` 中的 `nova_policy_overrides`、`neutron_policy_overrides`、`keystone_policy_overrides` 與 `placement_policy_overrides` 提供。用各自的 playbook 與標籤分別套用，例如 `openstack-ansible openstack.osa.nova --tags nova-policy-override`。之後拿掉其中一個時，會留下一個空檔案而不是沒有檔案，因此不會有任何東西失敗。",
  "- **RabbitMQ:** turn on its Prometheus plugin, then name each container's address on `15692` as `OPENSTACK_RABBITMQ_TARGETS` in the agent's `.env`:":
    "- **RabbitMQ：** 開啟它的 Prometheus 外掛程式，然後在代理程式的 `.env` 中把每個容器在 `15692` 上的位址寫為 `OPENSTACK_RABBITMQ_TARGETS`：",
  "- **HAProxy:** its exporter is off, and its stats listener is on `127.0.0.1` with TLS, which the agent cannot read. Turn it on where the agent can, then name that address on `1936` as `OPENSTACK_HAPROXY_TARGETS`:":
    "- **HAProxy：** 它的匯出器是關閉的，統計接聽程式位於帶 TLS 的 `127.0.0.1` 上，代理程式無法讀取。在代理程式能讀取的位置開啟它，然後把那個 `1936` 上的位址寫為 `OPENSTACK_HAPROXY_TARGETS`：",
  "- **MariaDB and Memcached:** OpenStack-Ansible ships no exporter for either. Run [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) and [memcached_exporter](https://github.com/prometheus/memcached_exporter) yourself and name them as `OPENSTACK_MARIADB_TARGETS` and `OPENSTACK_MEMCACHED_TARGETS`, or leave them out: the cloud's **Control Plane** card then says they are not watched, rather than that they are fine.":
    "- **MariaDB 與 Memcached：** OpenStack-Ansible 沒有為兩者提供任何匯出器。請自行執行 [mysqld_exporter](https://github.com/prometheus/mysqld_exporter) 與 [memcached_exporter](https://github.com/prometheus/memcached_exporter)，並把它們寫為 `OPENSTACK_MARIADB_TARGETS` 與 `OPENSTACK_MEMCACHED_TARGETS`，或省略它們：這樣雲端的 **控制平面** 卡片會顯示它們未受監控，而不是顯示一切正常。",
  "This runs the agent's logs profile as a systemd service, and reads `/var/log/journal/`, where OpenStack-Ansible's containers' journals arrive.":
    "這會把代理程式的日誌設定檔作為 systemd 服務執行，並讀取 `/var/log/journal/`，OpenStack-Ansible 容器的 journal 就匯集在那裡。",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The agent's logs profile reads both from the journal.":
    "兩者都寫入服務自己的日誌，匯流排上沒有任何取用者。在 **安全事件 → 連線** 中開啟 **在日誌中尋找安全事件** 後，OneUptime 就會從那裡讀取它們。代理程式的日誌設定檔從 journal 讀取這兩者。",
  "This sends a line for each login, which **OpenStack admin credential used from a new address** reads. To send failed logins only, add `identity.authenticate.success` to `notification_opt_out`, and that detection then reads what the audit filter saw. A second value of `notification_opt_out` goes in as a YAML set, as [its config_template](https://docs.openstack.org/ansible-config_template/latest/) writes a repeated key.":
    "這會為每次登入送出一行，由 **OpenStack admin credential used from a new address** 讀取。若只想送出失敗的登入，請把 `identity.authenticate.success` 加到 `notification_opt_out`，這項偵測之後就會讀取稽核篩選器看到的內容。`notification_opt_out` 的第二個值以 YAML 集合的形式寫入，就像 [它的 config_template](https://docs.openstack.org/ansible-config_template/latest/) 寫入重複的鍵那樣。",
  "For who did what through Nova, Neutron, Cinder and Glance, each API takes the filter's setting in its conf overrides, and the filter in its paste overrides, with `audit` right after `authtoken` and the context filter that follows it in each pipeline. Nova's, and the same in `neutron_neutron_conf_overrides` and `neutron_api_paste_ini_overrides`, `cinder_cinder_conf_overrides` and `cinder_api_paste_ini_overrides`, and `glance_glance_api_conf_overrides` and `glance_glance_api_paste_ini_overrides`:":
    "要知道誰透過 Nova、Neutron、Cinder 與 Glance 做了什麼，每個 API 都要在 conf 覆寫中加入篩選器的設定，在 paste 覆寫中加入篩選器本身，並在每個管線中把 `audit` 放在 `authtoken` 及其後的內容篩選器之後。這裡是 Nova 的寫法，`neutron_neutron_conf_overrides` 與 `neutron_api_paste_ini_overrides`、`cinder_cinder_conf_overrides` 與 `cinder_api_paste_ini_overrides`，以及 `glance_glance_api_conf_overrides` 與 `glance_glance_api_paste_ini_overrides` 也一樣：",
  "OpenStack-Helm offers charts for Prometheus, Alertmanager and exporters, and whether they are running is up to you. Its control plane runs in Kubernetes, so a probe reads the APIs and the Kubernetes agent sees the pods.":
    "OpenStack-Helm 提供 Prometheus、Alertmanager 與匯出器的 chart，是否執行它們由你決定。它的控制平面在 Kubernetes 中執行，因此由探測器讀取 API，由 Kubernetes 代理程式查看 Pod。",
  "**How far this guide has been tested:** Its chart values were read from OpenStack-Helm's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**本指南的測試程度：** 其 chart 值取自 OpenStack-Helm 自己的原始碼。尚未在此工具的真實部署上從頭到尾完整走過一遍。代理程式與探測器各自把一個真實的 DevStack 一路接到執行中的 OneUptime，中間經歷 nova-compute 的停止與恢復，但不是透過此工具完成的。探測器與 Kubernetes 代理程式各自單獨測試過，沒有在此工具上一起測試。",
  "Then add the receiver under `conf.alertmanager` in the chart's values, and send your route to it:":
    "然後在 chart 值的 `conf.alertmanager` 下加入接收器，並把你的路由送給它：",
  "Open **OpenStack → All Clouds**, click **Connect Cloud**, and give it Keystone's address, an application credential and the probe to use. A probe only speaks HTTPS to a cloud. [OpenStack Without an Agent](/docs/telemetry/openstack-agentless) says what each level of access reads, and the connection test says what yours can. The agent also works from any machine with a route to the APIs: choose **Not sure, or something else** above for its steps.":
    "開啟 **OpenStack → 所有雲端**，按一下 **連接雲端**，並提供 Keystone 的位址、一個應用程式憑證以及要使用的探測器。探測器與雲端之間只使用 HTTPS 通訊。[無代理程式的 OpenStack](/docs/telemetry/openstack-agentless) 說明了每個存取層級能讀取什麼，連線測試則會告訴你你的層級能讀取什麼。代理程式也可以在任何有路由通往這些 API 的機器上執行：在上方選擇 **不確定，或其他原因** 即可查看它的步驟。",
  "Follow **Kubernetes → Documentation** for this cluster. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "依照此叢集的 **Kubernetes → 文件** 操作。之後它的 Pod、Pod 的日誌與節點都會進入 Kubernetes 頁面，其中的 OpenStack 服務也會在那裡受到監控。",
  "To have those services' logs on this cloud's **Logs** page as well, each stack trace one record, name the cloud in the agent's values, with the namespaces its services run in:":
    "若也想讓這些服務的日誌出現在此雲端的 **日誌** 頁面上，並讓每條堆疊追蹤成為一筆記錄，請在代理程式的值中為雲端命名，並寫上其服務執行所在的命名空間：",
  "Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**. The Kubernetes agent reads both from the pods' logs, with the cloud named in its values.":
    "兩者都寫入服務自己的日誌，匯流排上沒有任何取用者。在 **安全事件 → 連線** 中開啟 **在日誌中尋找安全事件** 後，OneUptime 就會從那裡讀取它們。Kubernetes 代理程式會從 Pod 的日誌中讀取這兩者，並歸入其值中所命名的雲端。",
  "A chart's `logging.conf` keeps the root logger at `WARNING`, and the log driver writes under a logger of its own, so without one for it nothing is written. A list in values replaces the chart's, so `keys` holds what the chart's has, plus this:":
    "chart 的 `logging.conf` 把根記錄器保持在 `WARNING`，而日誌驅動程式使用它自己的記錄器寫入，所以沒有為它設定的記錄器就什麼都不會寫入。值中的清單會取代 chart 中的清單，因此 `keys` 要包含 chart 清單中已有的內容，再加上這個：",
  "For who did what through Nova, Neutron and Cinder, their charts' `conf.paste` already has the audit filter in each pipeline, and it needs telling where to write. Each needs the same logger, in `conf.logging`. Glance's chart has the map, and neither the filter nor a place for it in its pipelines: add both to its `conf.paste`.":
    "要知道誰透過 Nova、Neutron 與 Cinder 做了什麼：它們 chart 中的 `conf.paste` 已在每個管線中帶有稽核篩選器，只需告訴它寫到哪裡。每個服務都需要在 `conf.logging` 中設定同一個記錄器。Glance 的 chart 有對應，卻既沒有篩選器，也沒有在其管線中為它留出位置：請把兩者都加到它的 `conf.paste` 中。",
  "Atmosphere runs kube-prometheus-stack with its own alert rules, and Loki with Vector for logs. Forward its alerts first, then a probe reads the APIs and the Kubernetes agent sees the pods.":
    "Atmosphere 執行帶有自己警示規則的 kube-prometheus-stack，並用 Loki 加 Vector 處理日誌。先轉送它的警示，然後由探測器讀取 API，由 Kubernetes 代理程式查看 Pod。",
  "**How far this guide has been tested:** Its configuration was read from Atmosphere's own docs and source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The probe and the Kubernetes agent were each tested on their own, not together on this tool.":
    "**本指南的測試程度：** 其設定取自 Atmosphere 自己的文件與原始碼。尚未在此工具的真實部署上從頭到尾完整走過一遍。代理程式與探測器各自把一個真實的 DevStack 一路接到執行中的 OneUptime，中間經歷 nova-compute 的停止與恢復，但不是透過此工具完成的。探測器與 Kubernetes 代理程式各自單獨測試過，沒有在此工具上一起測試。",
  "Then add the receiver to your Atmosphere configuration, beside whichever receivers you already have, and deploy it:":
    "然後把接收器加到你的 Atmosphere 設定中，與你已有的接收器放在一起，並部署它：",
  "For who did what through Nova, Neutron and Cinder, the charts Atmosphere deploys already have the audit filter in each pipeline, and it needs telling where to write, in `nova_helm_values`, `neutron_helm_values` and `cinder_helm_values`. Glance's chart has neither the filter nor a place for it in its pipelines: add both to its `conf.paste`, in `glance_helm_values`.":
    "要知道誰透過 Nova、Neutron 與 Cinder 做了什麼：Atmosphere 部署的 chart 已在每個管線中帶有稽核篩選器，只需在 `nova_helm_values`、`neutron_helm_values` 與 `cinder_helm_values` 中告訴它寫到哪裡。Glance 的 chart 既沒有篩選器，也沒有在其管線中為它留出位置：請在 `glance_helm_values` 中把兩者都加到它的 `conf.paste`。",
  "Sunbeam can deploy the Canonical Observability Stack, with `sunbeam enable observability embedded`. Canonical also has an `openstack-exporter` charm, which the agent can read if you run it.":
    "Sunbeam 可以透過 `sunbeam enable observability embedded` 部署 Canonical Observability Stack。Canonical 另外還有一個 `openstack-exporter` charm，如果你執行了它，代理程式就能讀取。",
  "**How far this guide has been tested:** Its commands were read from Canonical's docs and its charms' source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. Nothing here has been run on Sunbeam, and Sunbeam's own docs do not mention the exporter charm.":
    "**本指南的測試程度：** 其指令取自 Canonical 的文件及其 charm 的原始碼。尚未在此工具的真實部署上從頭到尾完整走過一遍。代理程式與探測器各自把一個真實的 DevStack 一路接到執行中的 OneUptime，中間經歷 nova-compute 的停止與恢復，但不是透過此工具完成的。這裡的任何內容都沒有在 Sunbeam 上執行過，Sunbeam 自己的文件也沒有提到匯出器 charm。",
  "Then give the stack's Alertmanager a configuration with the receiver in it:":
    "然後給該堆疊的 Alertmanager 一份包含接收器的設定：",
  "If you run Canonical's `openstack-exporter` charm, the agent can read it with no credential of its own. It answers one cloud on `/metrics`, on port `9180` unless you changed its `port` setting. Find its address with `juju status openstack-exporter`:":
    "如果你執行了 Canonical 的 `openstack-exporter` charm，代理程式不需要自己的憑證就能讀取它。它在 `/metrics` 上為一個雲端提供回應，連接埠為 `9180`，除非你改過它的 `port` 設定。用 `juju status openstack-exporter` 找出它的位址：",
  "Which series it says depends on the exporter release in its snap, which was not recorded here: `bash troubleshoot.sh` says whether it reads the cloud.":
    "它提供哪些序列取決於其 snap 中的匯出器版本，而這裡沒有記錄該版本：`bash troubleshoot.sh` 會說明它是否能讀取這個雲端。",
  "With observability on, the stack's Loki holds the services' logs. OneUptime has no way to read Loki, and the agent's logs profile has not been tried on Sunbeam's charms, so nothing here collects them yet.":
    "開啟可觀測性後，該堆疊的 Loki 會保存這些服務的日誌。OneUptime 無法讀取 Loki，代理程式的日誌設定檔也沒有在 Sunbeam 的 charm 上試過，因此這裡目前還沒有任何東西收集這些日誌。",
  "Sunbeam's charms write each service's configuration from their own templates, and its Keystone charm has no setting for where notifications go. So neither Keystone's audit trail nor the audit filter can be turned on from outside the charm, and nothing here reaches Security Events.":
    "Sunbeam 的 charm 用它們自己的範本寫入每個服務的設定，而它的 Keystone charm 沒有設定通知去向的選項。因此 Keystone 的稽核軌跡與稽核篩選器都無法從 charm 外部開啟，這裡也沒有任何內容進入安全事件。",
  "Its Telemetry Operator runs Ceilometer's Prometheus exporter and a monitoring stack with Alertmanager on OpenShift. The Kubernetes agent's OpenShift preset watches the control plane, and Ceilometer's exporter says what the compute nodes are doing.":
    "它的 Telemetry Operator 在 OpenShift 上執行 Ceilometer 的 Prometheus 匯出器與一個帶 Alertmanager 的監控堆疊。Kubernetes 代理程式的 OpenShift 預設組合負責監控控制平面，而 Ceilometer 的匯出器說明運算節點在做什麼。",
  "**How far this guide has been tested:** Its resources were read from the Telemetry Operator's own source. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool. The OpenShift preset and Ceilometer's exporter were each tested on their own, not together on this tool.":
    "**本指南的測試程度：** 其資源取自 Telemetry Operator 自己的原始碼。尚未在此工具的真實部署上從頭到尾完整走過一遍。代理程式與探測器各自把一個真實的 DevStack 一路接到執行中的 OneUptime，中間經歷 nova-compute 的停止與恢復，但不是透過此工具完成的。OpenShift 預設組合與 Ceilometer 的匯出器各自單獨測試過，沒有在此工具上一起測試。",
  "Then apply a receiver the monitoring stack picks up:":
    "然後套用一個監控堆疊會採用的接收器：",
  "Follow **Kubernetes → Documentation** for this cluster, with **Red Hat OpenShift** picked, which sets `preset=openshift`. Its pods, their logs and their nodes then reach the Kubernetes pages, and the OpenStack services among them are watched there.":
    "選取 **Red Hat OpenShift**（這會設定 `preset=openshift`），依照此叢集的 **Kubernetes → 文件** 操作。之後它的 Pod、Pod 的日誌與節點都會進入 Kubernetes 頁面，其中的 OpenStack 服務也會在那裡受到監控。",
  "A probe says what is allocated, not what is busy. To read real usage, run the agent on a machine that can reach the compute nodes, with `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` naming each node on Ceilometer's port, `9101`.":
    "探測器說明的是已配置了什麼，而不是實際在忙什麼。要讀取實際用量，請在能連到運算節點的機器上執行代理程式，並用 `OPENSTACK_CEILOMETER_EXPORTER_TARGETS` 列出每個節點上 Ceilometer 的連接埠 `9101`。",
  "For who did what through Nova and Neutron, each takes the filter's setting in its `customServiceConfig`, and its paste file in `defaultConfigOverwrite`. Cinder's and Glance's operators take no paste file, so nothing here reaches them.":
    "要知道誰透過 Nova 與 Neutron 做了什麼，每個服務都在自己的 `customServiceConfig` 中加入篩選器的設定，在 `defaultConfigOverwrite` 中加入自己的 paste 檔案。Cinder 與 Glance 的 operator 不接受 paste 檔案，因此這裡的內容無法到達它們。",
  "StackLight already watches OpenStack's services, MariaDB, Memcached, RabbitMQ and libvirt, with its own alert rules. Forward its alerts first, then a probe reads the APIs.":
    "StackLight 已經用它自己的警示規則監控 OpenStack 的服務、MariaDB、Memcached、RabbitMQ 與 libvirt。先轉送它的警示，然後由探測器讀取 API。",
  "**How far this guide has been tested:** Its settings were read from Mirantis's docs, whose examples show other receivers rather than a webhook. It has not been followed end to end on a real deployment of this tool. The agent and a probe have each taken a real DevStack all the way into a running OneUptime, through a stopped nova-compute and back, but not from this tool.":
    "**本指南的測試程度：** 其設定取自 Mirantis 的文件，而文件中的範例展示的是其他接收器，而不是 Webhook。尚未在此工具的真實部署上從頭到尾完整走過一遍。代理程式與探測器各自把一個真實的 DevStack 一路接到執行中的 OneUptime，中間經歷 nova-compute 的停止與恢復，但不是透過此工具完成的。",
  "Then add the receiver and its route to your StackLight values:":
    "然後把接收器及其路由加到你的 StackLight 值中：",
  "For who did what through Nova, Neutron, Cinder and Glance, MOSK has a setting of its own, with the audit filter already in place. With the log driver, each service writes to its standard output, and the Kubernetes agent reads that from the pods' logs, with the cloud named in its values. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "要知道誰透過 Nova、Neutron、Cinder 與 Glance 做了什麼，MOSK 有自己的設定，而且稽核篩選器已經就位。使用日誌驅動程式時，每個服務都寫入自己的標準輸出，Kubernetes 代理程式會從 Pod 的日誌中讀取，並歸入其值中所命名的雲端。兩者都寫入服務自己的日誌，匯流排上沒有任何取用者。在 **安全事件 → 連線** 中開啟 **在日誌中尋找安全事件** 後，OneUptime 就會從那裡讀取它們。",
  "That setting does not cover Keystone. Its own audit trail takes `spec:services`, which Mirantis does not validate and takes no responsibility for, so weigh this with your support contract:":
    "該設定不涵蓋 Keystone。Keystone 自己的稽核軌跡需要透過 `spec:services` 設定，而 Mirantis 不驗證這一項，也不為其承擔任何責任，所以請搭配你的支援合約權衡：",
  "Keystone's audit trail says who signed in and who changed what in Keystone, and the audit filter says who did what through Nova, Neutron, Cinder and Glance. Each writes to the service's own log, with no consumer on the bus. OneUptime reads them from there once **Find security events in your logs** is on, under **Security Events → Connections**.":
    "Keystone 的稽核軌跡說明誰登入了、誰在 Keystone 中改了什麼，稽核篩選器則說明誰透過 Nova、Neutron、Cinder 與 Glance 做了什麼。兩者都寫入服務自己的日誌，匯流排上沒有任何取用者。在 **安全事件 → 連線** 中開啟 **在日誌中尋找安全事件** 後，OneUptime 就會從那裡讀取它們。",
  "The audit filter goes in each API's paste file, right after `authtoken` and the context filter that follows it in each pipeline, with the map file pyCADF ships for that service, in `etc/pycadf` under the Python environment the service runs in. Not at the end of a pipeline: Neutron's `extensions` filter answers its routers and security groups, and the filter would never see them.":
    "稽核篩選器放在每個 API 的 paste 檔案中，位於每個管線裡 `authtoken` 及其後的內容篩選器之後，並搭配 pyCADF 為該服務提供的對應檔，該檔案位於服務執行所在 Python 環境下的 `etc/pycadf` 中。不要放在管線末端：Neutron 的 `extensions` 篩選器會直接回應它的路由器與安全性群組，稽核篩選器將永遠看不到它們。",
  "[Who did what](/docs/telemetry/openstack#who-did-what) says what reaches Security Events, and [each tool's guide](/docs/telemetry/openstack-deployment-tools) says where these go on it.":
    "[誰做了什麼](/docs/telemetry/openstack#who-did-what) 說明了什麼會進入安全事件，[每個工具的指南](/docs/telemetry/openstack-deployment-tools) 說明了這些設定在各工具上放在哪裡。",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs names of its own: the install script names a new agent's containers after its folder unless you set them, and keeps them when you run the script again |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | 否 | 收集器的容器名稱（預設：`oneuptime-openstack-agent`）。同一台機器上第二個雲端的代理程式需要自己的容器名稱：除非你自行設定，否則安裝指令碼會依新代理程式的資料夾為其容器命名，並在你再次執行指令碼時保留這些名稱 |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). The install script names a second cloud's bundled exporter after its collector (`oneuptime-openstack-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | 否 | 內建匯出器的容器名稱（預設：`oneuptime-openstack-exporter`）。除非你自行設定，否則安裝指令碼會依第二個雲端的收集器為其內建匯出器命名（`oneuptime-openstack-exporter-cloud2` 與 `oneuptime-openstack-agent-cloud2` 並列），並在你再次執行指令碼時保留該名稱 |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). The install script names a second cloud's quota exporter after its collector (`oneuptime-openstack-quota-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | 否 | 配額匯出器的容器名稱（預設：`oneuptime-openstack-quota-exporter`）。除非你自行設定，否則安裝指令碼會依第二個雲端的收集器為其配額匯出器命名（`oneuptime-openstack-quota-exporter-cloud2` 與 `oneuptime-openstack-agent-cloud2` 並列），並在你再次執行指令碼時保留該名稱 |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). The install script names a second cloud's database exporter after its collector (`oneuptime-openstack-database-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | 否 | 資料庫匯出器的容器名稱（預設：`oneuptime-openstack-database-exporter`）。除非你自行設定，否則安裝指令碼會依第二個雲端的收集器為其資料庫匯出器命名（`oneuptime-openstack-database-exporter-cloud2` 與 `oneuptime-openstack-agent-cloud2` 並列），並在你再次執行指令碼時保留該名稱 |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). The install script names a second cloud's worker state exporter after its collector (`oneuptime-openstack-worker-state-exporter-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | 否 | 工作程序狀態匯出器的容器名稱（預設：`oneuptime-openstack-worker-state-exporter`）。除非你自行設定，否則安裝指令碼會依第二個雲端的收集器為其工作程序狀態匯出器命名（`oneuptime-openstack-worker-state-exporter-cloud2` 與 `oneuptime-openstack-agent-cloud2` 並列），並在你再次執行指令碼時保留該名稱 |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). The install script names a second cloud's AI agent after its collector (`oneuptime-openstack-ai-agent-cloud2` beside `oneuptime-openstack-agent-cloud2`) unless you set it, and keeps it when you run the script again |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | 否 | AI 代理程式的容器名稱（預設：`oneuptime-openstack-ai-agent`）。除非你自行設定，否則安裝指令碼會依第二個雲端的收集器為其 AI 代理程式命名（`oneuptime-openstack-ai-agent-cloud2` 與 `oneuptime-openstack-agent-cloud2` 並列），並在你再次執行指令碼時保留該名稱 |",
  "One agent reads one cloud. For a second cloud, install a second agent in a folder of its own, with container names of its own — two containers cannot share a name:":
    "一個代理程式讀取一個雲端。若要讀取第二個雲端，請在獨立的資料夾中安裝第二個代理程式，並使用它自己的容器名稱——兩個容器不能共用一個名稱：",
  "The script names the containers after the folder, such as `oneuptime-openstack-agent-cloud2`, unless you set their variables, such as `OPENSTACK_AGENT_CONTAINER_NAME`. It keeps the names in that agent's `.env`, so running the script again with the same `INSTALL_DIR` to upgrade the agent keeps them, and an agent whose `container_name` you once edited in `docker-compose.yml` keeps that name.":
    "除非你設定它們的變數（例如 `OPENSTACK_AGENT_CONTAINER_NAME`），否則指令碼會依資料夾為容器命名，例如 `oneuptime-openstack-agent-cloud2`。它會把名稱保存在該代理程式的 `.env` 中，所以用同一個 `INSTALL_DIR` 再次執行指令碼來升級代理程式時會保留這些名稱；而你曾在 `docker-compose.yml` 中編輯過 `container_name` 的代理程式，也會保留那個名稱。",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so the script refuses a folder named like one that already runs an agent elsewhere. Pass the folder to the diagnostic script with `-d`.":
    "請為每個資料夾取一個獨有的名稱：Docker Compose 只依資料夾為專案命名，因此如果某個資料夾與別處已在執行代理程式的資料夾同名，指令碼會拒絕它。用 `-d` 把資料夾傳給診斷指令碼。",
  "| `OPENSTACK_AGENT_CONTAINER_NAME` | No | The collector's container name (default: `oneuptime-openstack-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AGENT_CONTAINER_NAME` | 否 | 收集器的容器名稱（預設：`oneuptime-openstack-agent`）。同一台機器上第二個雲端的代理程式需要自己的容器名稱 |",
  "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | No | The bundled exporter's container name (default: `oneuptime-openstack-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_EXPORTER_CONTAINER_NAME` | 否 | 內建匯出器的容器名稱（預設：`oneuptime-openstack-exporter`）。同一台機器上第二個雲端的代理程式需要自己的容器名稱 |",
  "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | No | The quota exporter's container name (default: `oneuptime-openstack-quota-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_QUOTA_EXPORTER_CONTAINER_NAME` | 否 | 配額匯出器的容器名稱（預設：`oneuptime-openstack-quota-exporter`）。同一台機器上第二個雲端的代理程式需要自己的容器名稱 |",
  "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | No | The database exporter's container name (default: `oneuptime-openstack-database-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_DATABASE_EXPORTER_CONTAINER_NAME` | 否 | 資料庫匯出器的容器名稱（預設：`oneuptime-openstack-database-exporter`）。同一台機器上第二個雲端的代理程式需要自己的容器名稱 |",
  "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | No | The worker state exporter's container name (default: `oneuptime-openstack-worker-state-exporter`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_WORKER_STATE_EXPORTER_CONTAINER_NAME` | 否 | 工作程序狀態匯出器的容器名稱（預設：`oneuptime-openstack-worker-state-exporter`）。同一台機器上第二個雲端的代理程式需要自己的容器名稱 |",
  "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | No | The AI agent's container name (default: `oneuptime-openstack-ai-agent`). A second cloud's agent on the same machine needs one of its own |":
    "| `OPENSTACK_AI_AGENT_CONTAINER_NAME` | 否 | AI 代理程式的容器名稱（預設：`oneuptime-openstack-ai-agent`）。同一台機器上第二個雲端的代理程式需要自己的容器名稱 |",
  "One agent reads one cloud. For a second cloud, set up a second agent in a folder of its own, with container names of its own — two containers cannot share a name. Set them in that agent's `.env`:":
    "一個代理程式讀取一個雲端。若要讀取第二個雲端，請在獨立的資料夾中設定第二個代理程式，並使用它自己的容器名稱——兩個容器不能共用一個名稱。請在該代理程式的 `.env` 中設定這些名稱：",
  "Give each folder a name of its own: Docker Compose names a project after its folder alone, so a second folder of the same name would replace the first agent's containers. Keep the names out of `docker-compose.yml`, which an upgrade replaces.":
    "請為每個資料夾取一個獨有的名稱：Docker Compose 只依資料夾為專案命名，因此同名的第二個資料夾會取代第一個代理程式的容器。不要把這些名稱寫進 `docker-compose.yml`，升級會取代該檔案。",
};

export default TRANSLATION;
