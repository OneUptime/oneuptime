import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The DockerSwarm setup guide in Traditional Chinese (#8341): each piece of the English
 * guide's markdown (Pages/DockerSwarm/Utils/DocumentationMarkdown.ts) and its
 * Traditional Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Traditional Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Docker Swarm **manager** node to run it on — the inventory poller calls manager-only API endpoints (`/nodes`, `/services`, `/tasks`)":
    "用來執行它的一個 Docker Swarm **manager** 節點——清單輪詢器會呼叫只有 manager 才有的 API 端點（`/nodes`、`/services`、`/tasks`）",
  "Docker Engine 20.10+ with the Docker Compose v2 plugin":
    "附 Docker Compose v2 外掛程式的 Docker Engine 20.10 或更新版本",
  "When it asks, enter the OneUptime URL and the ingestion key shown in step 1, and a name for the cluster, such as `prod-swarm`. The name is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "詢問時，輸入第 1 步中顯示的 OneUptime URL 和擷取金鑰，以及叢集名稱，例如 `prod-swarm`。叢集在 OneUptime 中就以這個名稱顯示，所以請保持不變：新名稱會註冊為新叢集。",
  "The script puts the agent in `/opt/oneuptime-docker-swarm-agent` and starts it with Docker Compose.":
    "指令碼會把代理程式放到 `/opt/oneuptime-docker-swarm-agent`，並用 Docker Compose 啟動它。",
  "`docker compose ps` lists three containers: the collector (`oneuptime-docker-swarm-agent`), the inventory poller (`oneuptime-docker-swarm-inventory`) and the OneUptime AI agent (`oneuptime-docker-swarm-ai-agent`). The cluster appears in the **Docker Swarm** section within a few minutes, and its Nodes, Services, Tasks, Stacks, Networks, Secrets, Configs and Volumes pages fill in after the first inventory snapshot (≤ 5 minutes).":
    "`docker compose ps` 會列出三個容器：收集器（`oneuptime-docker-swarm-agent`）、清單輪詢器（`oneuptime-docker-swarm-inventory`）和 OneUptime AI 代理程式（`oneuptime-docker-swarm-ai-agent`）。叢集會在幾分鐘內出現在 **Docker Swarm** 區段，其節點、服務、任務、堆疊、網路、密鑰、組態和磁碟區頁面會在第一次清單快照（≤ 5 分鐘）後填入資料。",
  "**OneUptime AI agent (on by default, read-only).** AI investigations are on: it lets OneUptime AI investigate incidents and alerts on this cluster with read-only docker commands such as `docker node ls` and `docker service ps`, and changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced.":
    "**OneUptime AI 代理程式（預設開啟，唯讀）。** AI 調查已開啟：它讓 OneUptime AI 用 `docker node ls` 和 `docker service ps` 等唯讀 docker 指令調查此叢集上的事件和警示，除非你允許修正，否則不會做任何變更——請參閱 進階 中的 **OneUptime AI 代理程式**。",
  "Run the agent on a **manager** node: the inventory poller and the OneUptime AI agent call manager-only API endpoints. The collector reports the containers of the node it runs on, so for per-node container metrics run the collector on every node, all with the same `DOCKER_SWARM_CLUSTER_NAME`; the inventory poller only needs to run on one manager. Run the install script on a node that is not a manager, and it leaves the OneUptime AI agent out there.":
    "請在 **manager** 節點上執行代理程式：清單輪詢器和 OneUptime AI 代理程式會呼叫只有 manager 才有的 API 端點。收集器只回報它所在節點的容器，因此要取得每個節點的容器指標，請在每個節點上執行收集器，並都使用相同的 `DOCKER_SWARM_CLUSTER_NAME`；清單輪詢器只需在一個 manager 上執行。如果在不是 manager 的節點上執行安裝指令碼，它會在那裡省略 OneUptime AI 代理程式。",
  "Deploying the agent as a swarm stack rather than with Compose? Pin the inventory poller and the AI agent to managers — docker-compose.yml carries this block, commented out, on both services:":
    "以 swarm 堆疊而不是 Compose 部署代理程式？請把清單輪詢器和 AI 代理程式固定到 manager 上——docker-compose.yml 在兩個服務中都帶有這個已註解掉的區塊：",
  "| Variable | Required | Description |": "| 變數 | 必填 | 說明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 執行個體的 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | 是 | 第 1 步中的遙測擷取金鑰 |",
  "| `DOCKER_SWARM_CLUSTER_NAME` | Yes | The cluster's name in OneUptime, and its join key: stamped on every signal as the `docker.swarm.cluster.name` resource attribute. Defaults to `docker-swarm` |":
    "| `DOCKER_SWARM_CLUSTER_NAME` | 是 | 叢集在 OneUptime 中的名稱，也是它的關聯鍵：以資源屬性 `docker.swarm.cluster.name` 標記在每個訊號上。預設為 `docker-swarm` |",
  "| `DOCKER_SWARM_NODE_NAME` | No | This node's name, stamped on its containers' metrics and logs as `docker.swarm.node.name` — what a Docker Swarm monitor's **Node Name** filter matches. The install script sets it to the node's hostname, the name `docker node ls` shows. Empty: no node name is stamped |":
    "| `DOCKER_SWARM_NODE_NAME` | 否 | 此節點的名稱，以 `docker.swarm.node.name` 標記在其容器的指標和日誌上——Docker Swarm 監控器的 **節點名稱** 篩選器比對的就是它。安裝指令碼會把它設為節點的主機名稱，也就是 `docker node ls` 顯示的名稱。空白：不標記節點名稱 |",
  "| `DOCKER_INVENTORY_INTERVAL_SECONDS` | No | How often the poller refreshes the inventory snapshot (default `300`) |":
    "| `DOCKER_INVENTORY_INTERVAL_SECONDS` | 否 | 輪詢器重新整理清單快照的頻率（預設 `300`） |",
  "| `DOCKER_API_VERSION` | No | Docker Engine API version the collector and the inventory poller speak. Empty by default: they use the daemon's own, so any Docker Engine from 20.10 on works. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | 否 | 收集器和清單輪詢器使用的 Docker Engine API 版本。預設為空：它們使用常駐程式自己的版本，因此 20.10 以後的任何 Docker Engine 都能使用。只在需要固定版本時設定（請參閱 疑難排解） |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` 到 `ONEUPTIME_LOG_OPERATOR_5` | 否 | 你自己的收集器運算子，每個都以 JSON 形式提供，用於代理程式讀取不了的日誌格式 |",
  "The install script writes the first four to `/opt/oneuptime-docker-swarm-agent/.env`. Add or change any of them there, then run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent` to recreate the containers with the new values.":
    "安裝指令碼會把前四個寫入 `/opt/oneuptime-docker-swarm-agent/.env`。在那裡新增或修改任何一個，然後在 `/opt/oneuptime-docker-swarm-agent` 中執行 `docker compose up -d`，用新值重新建立容器。",
  "The agent's docker-compose.yml also runs the OneUptime AI agent, `oneuptime-docker-swarm-ai-agent`. It runs the `docker` commands OneUptime AI asks for while it investigates an incident or alert on this cluster, and it appears on the cluster's **AI → AI agent** page. Like the inventory poller it must run on a manager node — on a worker it runs nothing.":
    "代理程式的 docker-compose.yml 也會執行 OneUptime AI 代理程式 `oneuptime-docker-swarm-ai-agent`。它在 OneUptime AI 調查此叢集上的事件或警示時，執行它要求的 `docker` 指令，並顯示在叢集的 **人工智慧 → AI 代理程式** 頁面上。和清單輪詢器一樣，它必須在 manager 節點上執行——在 worker 上它什麼都不執行。",
  "- **Read-only by default.** It runs commands such as `docker node ls`, `docker service ls`, `docker service ps NAME` and `docker service logs --tail 200 NAME` — never `service create`/`rm`, `stack deploy`/`rm`, secrets, configs or `exec`. Environment values in `docker service inspect` output are masked before anything leaves the node.":
    "- **預設為唯讀。** 它執行 `docker node ls`、`docker service ls`、`docker service ps NAME` 和 `docker service logs --tail 200 NAME` 等指令，絕不執行 `service create`/`rm`、`stack deploy`/`rm`、密鑰、組態或 `exec`。`docker service inspect` 輸出中的環境變數值會在任何內容離開節點之前被遮蔽。",
  "- **Fixes are opt-in.** Set `ONEUPTIME_AI_ALLOW_WRITES=true` in `/opt/oneuptime-docker-swarm-agent/.env` and run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent` to let it roll a named service (`docker service update --force`), roll it back or scale it. `ONEUPTIME_AI_FIXES` in the same file says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the cluster's **AI → AI agent** page shows it. Draining a node always needs a person's approval. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs of service and node names) limits what fixes may touch; `ONEUPTIME_AI_PROTECTED_TARGETS` adds services it must never change. It never changes itself, the collector or the inventory poller.":
    "- **修正需要主動開啟。** 在 `/opt/oneuptime-docker-swarm-agent/.env` 中設定 `ONEUPTIME_AI_ALLOW_WRITES=true`，並在 `/opt/oneuptime-docker-swarm-agent` 中執行 `docker compose up -d`，即可允許它重新部署指定名稱的服務（`docker service update --force`）、回復或調整規模。同一檔案中的 `ONEUPTIME_AI_FIXES` 決定每項修正是否需要核准（`ask-for-approval`、`automatic` 或 `bypass-approval`），叢集的 **人工智慧 → AI 代理程式** 頁面會顯示這一點。清空節點一律需要人工核准。`ONEUPTIME_AI_WRITE_TARGETS`（服務名稱和節點名稱的逗號分隔萬用字元）限定修正可以觸及的對象；`ONEUPTIME_AI_PROTECTED_TARGETS` 加入它絕不能變更的服務。它絕不會變更自己、收集器或清單輪詢器。",
  "- It runs as root because the Docker socket is root-owned. The socket's `:ro` mount does not make the Docker API read-only — the agent's command policy is the limit.":
    "- 由於 Docker 通訊端屬於 root，它以 root 身分執行。以 `:ro` 方式掛載通訊端並不會讓 Docker API 變成唯讀——真正的限制是代理程式的指令政策。",
  "- To leave it out, run the install script with `--no-ai-agent`: `sh install.sh --no-ai-agent`.":
    "- 要省略它，請用 `--no-ai-agent` 執行安裝指令碼：`sh install.sh --no-ai-agent`。",
  "- Its logs: `docker compose logs -f oneuptime-docker-swarm-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-swarm-clusters).":
    "- 它的日誌：`docker compose logs -f oneuptime-docker-swarm-ai-agent`。它可以執行什麼，以及修正如何運作：[基礎架構 AI 代理程式](/docs/ai/infrastructure-ai-agents#docker-swarm-clusters)。",
  "The agent is three containers, all defined in its docker-compose.yml:":
    "代理程式由三個容器組成，都定義在它的 docker-compose.yml 中：",
  "1. **Collector** (`oneuptime-docker-swarm-agent`) — the stock `otel/opentelemetry-collector-contrib` image with a tuned config. It scrapes `docker_stats` for per-container CPU and memory, tails container logs, and tails the inventory snapshot file — stamping everything with `docker.swarm.cluster.name`, and each task's metrics with its service and node, before shipping it to OneUptime over OTLP.":
    "1. **收集器**（`oneuptime-docker-swarm-agent`）——附調校組態的原版 `otel/opentelemetry-collector-contrib` 映像檔。它讀取 `docker_stats` 取得每個容器的 CPU 和記憶體，追蹤容器日誌和清單快照檔案——在所有資料上標記 `docker.swarm.cluster.name`，並在每個任務的指標上標記其服務和節點，然後透過 OTLP 傳送到 OneUptime。",
  "2. **Inventory poller** (`oneuptime-docker-swarm-inventory`) — a small `alpine` + `curl` + `jq` sidecar that every 5 minutes walks the Swarm manager API (`/nodes`, `/services`, `/tasks`, `/networks`, `/secrets`, `/configs`, `/volumes`) and derives stacks from the `com.docker.stack.namespace` service label, writing one JSON line per object for the collector to forward.":
    "2. **清單輪詢器**（`oneuptime-docker-swarm-inventory`）——一個由 `alpine` + `curl` + `jq` 組成的小型輔助容器，每 5 分鐘走訪一次 Swarm manager API（`/nodes`、`/services`、`/tasks`、`/networks`、`/secrets`、`/configs`、`/volumes`），並從服務標籤 `com.docker.stack.namespace` 推導出堆疊，每個物件寫一行 JSON，由收集器轉送。",
  "3. **OneUptime AI agent** (`oneuptime-docker-swarm-ai-agent`) — runs the commands OneUptime AI asks for; see **The OneUptime AI agent** above.":
    "3. **OneUptime AI 代理程式**（`oneuptime-docker-swarm-ai-agent`）——執行 OneUptime AI 要求的指令；請參閱上文的 **OneUptime AI 代理程式**。",
  "**Upgrade** — run the install script again. It downloads the latest docker-compose.yml, collector config and inventory poller into `/opt/oneuptime-docker-swarm-agent`, pulls the images and restarts the agent; answer its questions with the same URL, key and cluster name:":
    "**升級**——再次執行安裝指令碼。它會把最新的 docker-compose.yml、收集器組態和清單輪詢器下載到 `/opt/oneuptime-docker-swarm-agent`，拉取映像檔並重新啟動代理程式；用相同的 URL、金鑰和叢集名稱回答它的問題：",
  "It rewrites `.env` from your answers and keeps only the AI agent's target lists and what AI may do (`ONEUPTIME_AI_INVESTIGATION`, `ONEUPTIME_AI_FIXES`): add back any variable you set yourself, such as `DOCKER_API_VERSION`. Turned on AI fixes? Run it as `ONEUPTIME_AI_ALLOW_WRITES=true sh install.sh` to keep them on. Left the AI agent out? Pass `--no-ai-agent` again.":
    "它會依據你的回答重寫 `.env`，只保留 AI 代理程式的目標清單和 AI 可以執行的操作（`ONEUPTIME_AI_INVESTIGATION`、`ONEUPTIME_AI_FIXES`）：請把你自己設定過的變數加回去，例如 `DOCKER_API_VERSION`。開啟了 AI 修正？請以 `ONEUPTIME_AI_ALLOW_WRITES=true sh install.sh` 的形式執行它來保留。省略了 AI 代理程式？請再次傳入 `--no-ai-agent`。",
  "**Uninstall:**": "**解除安裝：**",
  "| Signal | Source | Powers |": "| 訊號 | 來源 | 用於 |",
  "| Node / Service / Task / Stack / Network / Secret / Config / Volume inventory | inventory poller → Swarm manager API | the cluster's resource list + detail pages |":
    "| 節點 / 服務 / 任務 / 堆疊 / 網路 / 密鑰 / 組態 / 磁碟區的清單 | 清單輪詢器 → Swarm manager API | 叢集的資源清單和詳細資料頁面 |",
  "| Cluster counts (nodes ready, tasks running, services, stacks, …) | derived from the same snapshot | the overview cards + sidebar badges |":
    "| 叢集計數（就緒節點、執行中的任務、服務、堆疊等…） | 從同一份快照推導 | 概覽卡片和側邊欄徽章 |",
  "| Container CPU / memory / pids / uptime | `docker_stats` receiver | the Metrics tab |":
    "| 容器的 CPU / 記憶體 / PID / 執行時間 | `docker_stats` 接收器 | 指標 分頁 |",
  "| Container stdout/stderr logs | `filelog` receiver | the Logs tab |":
    "| 容器的 stdout/stderr 日誌 | `filelog` 接收器 | 日誌 分頁 |",
  "Each task's metrics carry its container (`container.name`, `container.image.name`, and `container.runtime=docker`, which the `docker_stats` receiver adds), its service (`docker.swarm.service.name`) and its node (`docker.swarm.node.id`, and `docker.swarm.node.name` from `DOCKER_SWARM_NODE_NAME`). The agent stamps `docker.swarm.cluster.name` on everything and never `host.name`, so OneUptime attributes the telemetry to this swarm cluster rather than registering each node as a standalone Host or Docker Host.":
    "每個任務的指標都帶有它的容器（`container.name`、`container.image.name`，以及 `docker_stats` 接收器加入的 `container.runtime=docker`）、它的服務（`docker.swarm.service.name`）和它的節點（`docker.swarm.node.id`，以及來自 `DOCKER_SWARM_NODE_NAME` 的 `docker.swarm.node.name`）。代理程式會在所有資料上標記 `docker.swarm.cluster.name`，但絕不標記 `host.name`，因此 OneUptime 會把遙測歸到這個 swarm 叢集，而不是把每個節點註冊為獨立的主機或 Docker 主機。",
  "Run the diagnostic script on the manager node. It checks the containers, that the inventory poller is on a manager, the snapshot file, the cluster name and the key — and asks OneUptime directly whether it accepts the ingestion key. A rejected key (`401` or `422`) otherwise shows only as an easy-to-miss `Exporting failed` line in the collector's logs.":
    "在 manager 節點上執行診斷指令碼。它會檢查容器、清單輪詢器是否在 manager 上、快照檔案、叢集名稱和金鑰——並直接詢問 OneUptime 是否接受該擷取金鑰。否則，遭拒的金鑰（`401` 或 `422`）只會在收集器日誌中顯示為一行容易忽略的 `Exporting failed`。",
  "Otherwise, check the collector's logs (`docker compose logs oneuptime-docker-swarm-agent` in `/opt/oneuptime-docker-swarm-agent`), that `ONEUPTIME_SERVICE_TOKEN` and `ONEUPTIME_URL` in `/opt/oneuptime-docker-swarm-agent/.env` are correct, and that the manager can reach your OneUptime instance.":
    "否則，請檢查收集器的日誌（在 `/opt/oneuptime-docker-swarm-agent` 中執行 `docker compose logs oneuptime-docker-swarm-agent`），確認 `/opt/oneuptime-docker-swarm-agent/.env` 中的 `ONEUPTIME_SERVICE_TOKEN` 和 `ONEUPTIME_URL` 正確，並確認 manager 能連到你的 OneUptime 執行個體。",
  "Confirm the poller runs on a manager: `docker node ls` must succeed there. Then look for `failed to emit ...` lines in its logs:":
    "確認輪詢器在 manager 上執行：`docker node ls` 必須能在那裡成功執行。然後在它的日誌中尋找 `failed to emit ...` 行：",
  "The cluster is marked disconnected after 15 minutes without telemetry. Make sure the collector container (`oneuptime-docker-swarm-agent`) stays running — `docker compose ps` in `/opt/oneuptime-docker-swarm-agent` shows it.":
    "叢集在 15 分鐘沒有遙測後會被標記為已中斷。請確保收集器容器（`oneuptime-docker-swarm-agent`）保持執行——在 `/opt/oneuptime-docker-swarm-agent` 中執行 `docker compose ps` 可以看到它。",
  "The collector's logs show:": "收集器的日誌顯示：",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The collector pins a version only when `DOCKER_API_VERSION` names one, and older agent files pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Run the install script again: it downloads the current files, which leave the version empty. Then take any `DOCKER_API_VERSION=` line with a version out of `/opt/oneuptime-docker-swarm-agent/.env`, or set it empty — `DOCKER_API_VERSION=` — and run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent`, on every node the collector runs on. The collector then negotiates the version with the daemon.":
    "常駐程式會拒絕比自身最高版本更新的用戶端，收集器因此結束，容器不斷重新啟動。只有在 `DOCKER_API_VERSION` 指定了版本時，收集器才會固定版本，而舊的代理程式檔案固定了 `1.44`，Docker Engine 20.10 到 24 會拒絕它。請再次執行安裝指令碼：它會下載目前的檔案，其中版本為空。然後從 `/opt/oneuptime-docker-swarm-agent/.env` 中拿掉任何帶版本的 `DOCKER_API_VERSION=` 行，或把它設為空——`DOCKER_API_VERSION=`——並在執行收集器的每個節點上，於 `/opt/oneuptime-docker-swarm-agent` 中執行 `docker compose up -d`。之後收集器會與常駐程式協商版本。",
  "To pin a version anyway, use no more than the daemon's maximum, such as `DOCKER_API_VERSION=1.41`:":
    "如果仍要固定版本，請不要超過常駐程式的最高版本，例如 `DOCKER_API_VERSION=1.41`：",
  "Newer daemons still serve older API versions, so a pinned version keeps working after you upgrade Docker.":
    "較新的常駐程式仍然支援舊的 API 版本，因此固定的版本在升級 Docker 後仍可使用。",
  "The cluster's name comes from `DOCKER_SWARM_CLUSTER_NAME`. Change it in `/opt/oneuptime-docker-swarm-agent/.env` and run `docker compose up -d` in `/opt/oneuptime-docker-swarm-agent` — note that a new name registers a new cluster.":
    "叢集的名稱來自 `DOCKER_SWARM_CLUSTER_NAME`。在 `/opt/oneuptime-docker-swarm-agent/.env` 中修改它，並在 `/opt/oneuptime-docker-swarm-agent` 中執行 `docker compose up -d`——注意，新名稱會註冊為新叢集。",
  "When it asks, enter the OneUptime URL and the ingestion key shown in step 1, and **`swarm-1`** as the cluster name — exactly, or the data registers as a new cluster.":
    "詢問時，輸入第 1 步中顯示的 OneUptime URL 和擷取金鑰，並把叢集名稱原樣輸入為 **`swarm-1`**，否則資料會註冊為一個新叢集。",
  "Replace `my-swarm` with a name for this cluster, such as `prod-swarm`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "將 `my-swarm` 換成此叢集的名稱，例如 `prod-swarm`。叢集在 OneUptime 中就以這個名稱顯示，所以請保持不變：新名稱會註冊為新叢集。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步選擇一個擷取金鑰，即可填入 `<YOUR_API_KEY>`。",
  "Add this node's name to it. The collector puts it on the node's container metrics, and a Docker Swarm monitor's **Node Name** filter matches it:":
    "在其中加上此節點的名稱。收集器會把它標記在該節點的容器指標上，Docker Swarm 監控器的 **節點名稱** 篩選器會比對它：",
  "Then start it:": "然後啟動它：",
  "Run the agent on a **manager** node: the inventory poller and the OneUptime AI agent call manager-only API endpoints. The collector reports the containers of the node it runs on, so for per-node container metrics run the collector on every node, all with the same `DOCKER_SWARM_CLUSTER_NAME`; the inventory poller only needs to run on one manager.":
    "請在 **manager** 節點上執行代理程式：清單輪詢器和 OneUptime AI 代理程式會呼叫只有 manager 才有的 API 端點。收集器只回報它所在節點的容器，因此要取得每個節點的容器指標，請在每個節點上執行收集器，並都使用相同的 `DOCKER_SWARM_CLUSTER_NAME`；清單輪詢器只需在一個 manager 上執行。",
  "| `DOCKER_SWARM_NODE_NAME` | No | This node's name, stamped on its containers' metrics and logs as `docker.swarm.node.name` — what a Docker Swarm monitor's **Node Name** filter matches. Set it to the node's hostname, the name `docker node ls` shows: `echo \"DOCKER_SWARM_NODE_NAME=$(docker info --format '{{.Name}}')\" >> .env`. Empty: no node name is stamped |":
    "| `DOCKER_SWARM_NODE_NAME` | 否 | 此節點的名稱，以 `docker.swarm.node.name` 標記在其容器的指標和日誌上——Docker Swarm 監控器的 **節點名稱** 篩選器比對的就是它。請把它設為節點的主機名稱，也就是 `docker node ls` 顯示的名稱：`echo \"DOCKER_SWARM_NODE_NAME=$(docker info --format '{{.Name}}')\" >> .env`。空白：不標記節點名稱 |",
  "Set them in the `.env` next to docker-compose.yml, then run `docker compose up -d` to recreate the containers with the new values.":
    "在 docker-compose.yml 旁邊的 `.env` 中設定它們，然後執行 `docker compose up -d`，用新值重新建立容器。",
  "- **Fixes are opt-in.** Set `ONEUPTIME_AI_ALLOW_WRITES=true` in the `.env` next to docker-compose.yml and run `docker compose up -d` in the agent's folder to let it roll a named service (`docker service update --force`), roll it back or scale it. `ONEUPTIME_AI_FIXES` in the same file says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the cluster's **AI → AI agent** page shows it. Draining a node always needs a person's approval. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs of service and node names) limits what fixes may touch; `ONEUPTIME_AI_PROTECTED_TARGETS` adds services it must never change. It never changes itself, the collector or the inventory poller.":
    "- **修正需要主動開啟。** 在 docker-compose.yml 旁邊的 `.env` 中設定 `ONEUPTIME_AI_ALLOW_WRITES=true`，並在代理程式的資料夾中執行 `docker compose up -d`，即可允許它重新部署指定名稱的服務（`docker service update --force`）、回復或調整規模。同一檔案中的 `ONEUPTIME_AI_FIXES` 決定每項修正是否需要核准（`ask-for-approval`、`automatic` 或 `bypass-approval`），叢集的 **人工智慧 → AI 代理程式** 頁面會顯示這一點。清空節點一律需要人工核准。`ONEUPTIME_AI_WRITE_TARGETS`（服務名稱和節點名稱的逗號分隔萬用字元）限定修正可以觸及的對象；`ONEUPTIME_AI_PROTECTED_TARGETS` 加入它絕不能變更的服務。它絕不會變更自己、收集器或清單輪詢器。",
  "- To leave it out, delete the `oneuptime-docker-swarm-ai-agent` service from docker-compose.yml.":
    "- 要省略它，請從 docker-compose.yml 中刪除 `oneuptime-docker-swarm-ai-agent` 服務。",
  "**Upgrade** — the collector image is pinned in docker-compose.yml and its config is a file next to it, so pulling alone does not move the agent forward. Download the three files again (the commands in step 2 — then re-apply any change you made to docker-compose.yml), and in the agent's folder:":
    "**升級**——收集器映像檔固定在 docker-compose.yml 中，其組態是旁邊的一個檔案，因此只拉取映像檔並不能讓代理程式更新。請重新下載這三個檔案（第 2 步中的指令——然後重新套用你對 docker-compose.yml 做過的任何修改），並在代理程式的資料夾中：",
  "**Uninstall** — in the agent's folder:":
    "**解除安裝**——在代理程式的資料夾中：",
  "Otherwise, check the collector's logs (`docker compose logs oneuptime-docker-swarm-agent` in the agent's folder), that `ONEUPTIME_SERVICE_TOKEN` and `ONEUPTIME_URL` in the `.env` next to docker-compose.yml are correct, and that the manager can reach your OneUptime instance.":
    "否則，請檢查收集器的日誌（在代理程式的資料夾中執行 `docker compose logs oneuptime-docker-swarm-agent`），確認 docker-compose.yml 旁邊的 `.env` 中的 `ONEUPTIME_SERVICE_TOKEN` 和 `ONEUPTIME_URL` 正確，並確認 manager 能連到你的 OneUptime 執行個體。",
  "The cluster is marked disconnected after 15 minutes without telemetry. Make sure the collector container (`oneuptime-docker-swarm-agent`) stays running — `docker compose ps` in the agent's folder shows it.":
    "叢集在 15 分鐘沒有遙測後會被標記為已中斷。請確保收集器容器（`oneuptime-docker-swarm-agent`）保持執行——在代理程式的資料夾中執行 `docker compose ps` 可以看到它。",
  "The daemon refuses a client newer than its own maximum, the collector exits with it, and the container restart-loops. The collector pins a version only when `DOCKER_API_VERSION` names one, and older agent files pinned `1.44`, which Docker Engine 20.10 to 24 refuse. Download the agent's files again (step 2), which leave the version empty. Then take any `DOCKER_API_VERSION=` line with a version out of the `.env` next to docker-compose.yml, or set it empty — `DOCKER_API_VERSION=` — and run `docker compose up -d` in the agent's folder, on every node the collector runs on. The collector then negotiates the version with the daemon.":
    "常駐程式會拒絕比自身最高版本更新的用戶端，收集器因此結束，容器不斷重新啟動。只有在 `DOCKER_API_VERSION` 指定了版本時，收集器才會固定版本，而舊的代理程式檔案固定了 `1.44`，Docker Engine 20.10 到 24 會拒絕它。請重新下載代理程式的檔案（第 2 步），其中版本為空。然後從 docker-compose.yml 旁邊的 `.env` 中拿掉任何帶版本的 `DOCKER_API_VERSION=` 行，或把它設為空——`DOCKER_API_VERSION=`——並在執行收集器的每個節點上，於代理程式的資料夾中執行 `docker compose up -d`。之後收集器會與常駐程式協商版本。",
  "The cluster's name comes from `DOCKER_SWARM_CLUSTER_NAME`. Change it in the `.env` next to docker-compose.yml and run `docker compose up -d` in the agent's folder — note that a new name registers a new cluster.":
    "叢集的名稱來自 `DOCKER_SWARM_CLUSTER_NAME`。在 docker-compose.yml 旁邊的 `.env` 中修改它，並在代理程式的資料夾中執行 `docker compose up -d`——注意，新名稱會註冊為新叢集。",
  "This installs the agent for **`swarm-1`** — keep `DOCKER_SWARM_CLUSTER_NAME` exactly as it is, or the data registers as a new cluster.":
    "這會為 **`swarm-1`** 安裝代理程式——請保持 `DOCKER_SWARM_CLUSTER_NAME` 原樣不變，否則資料會註冊為一個新叢集。",
};

export default TRANSLATION;
