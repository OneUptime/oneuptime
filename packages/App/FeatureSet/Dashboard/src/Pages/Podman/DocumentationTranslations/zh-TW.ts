import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Podman setup guide in Traditional Chinese (#8341): each piece of the English
 * guide's markdown (Pages/Podman/Utils/DocumentationMarkdown.ts) and its
 * Traditional Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Traditional Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "Podman 4.0+": "Podman 4.0 或更新版本",
  "Podman's Docker-compatible API socket at `/run/podman/podman.sock` — turn it on with `sudo systemctl enable --now podman.socket`":
    "Podman 位於 `/run/podman/podman.sock` 的 Docker 相容 API 通訊端——用 `sudo systemctl enable --now podman.socket` 開啟它",
  "Containers whose logs you want must use the `k8s-file` log driver — rootful Podman defaults to `journald`, which the agent cannot read":
    "要收集日誌的容器必須使用 `k8s-file` 日誌驅動程式——rootful 模式的 Podman 預設使用 `journald`，代理程式無法讀取",
  "Then start the OneUptime AI agent beside it, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Skip this command to run the collector without AI investigations.":
    "接著在旁邊用相同的 URL、金鑰和主機名稱啟動 OneUptime AI 代理程式。**AI 調查預設為開啟**：OneUptime AI 調查此主機上的事件或警示時，會透過 AI 代理程式對 Podman 的 Docker 相容通訊端執行唯讀的 `docker` 指令，除非你允許修正，否則不會做任何變更——請參閱 進階 中的 **OneUptime AI 代理程式**。略過此指令即可在沒有 AI 調查的情況下執行收集器。",
  "Replace `my-podman-host` with a name for this host, such as `prod-podman-01`. It is how the host appears in OneUptime, so keep it stable: a new name registers a new host.":
    "將 `my-podman-host` 換成此主機的名稱，例如 `prod-podman-01`。主機在 OneUptime 中就以這個名稱顯示，所以請保持不變：新名稱會註冊為新主機。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步選擇一個擷取金鑰，即可填入 `<YOUR_API_KEY>`。",
  "Look for this line in the logs:": "在日誌中尋找這一行：",
  "Once the agent connects, the host appears automatically in the **Podman** section — usually within a minute or so. The OneUptime AI agent shows as Connected on the host's **AI → AI agent** page, and at the bottom of its **Overview**.":
    "代理程式連線後，主機會自動出現在 **Podman** 區段，通常在一分鐘左右。OneUptime AI 代理程式會在主機的 **人工智慧 → AI 代理程式** 頁面和其 **概覽** 底部顯示為 已連線。",
  "**Metrics but no logs?** Rootful Podman writes container logs to `journald` by default, which the agent cannot read. Run your containers with `--log-driver k8s-file` — see **Collect logs from every container (k8s-file log driver)** under Advanced.":
    "**有指標卻沒有日誌？** rootful 模式的 Podman 預設把容器日誌寫入 `journald`，代理程式無法讀取。請用 `--log-driver k8s-file` 執行你的容器——請參閱 進階 中的 **收集所有容器的日誌（k8s-file 日誌驅動程式）**。",
  "| Variable | Required | Description |": "| 變數 | 必填 | 說明 |",
  "| `ONEUPTIME_URL` | Yes | Your OneUptime instance URL (e.g. `<YOUR_ONEUPTIME_URL>`) |":
    "| `ONEUPTIME_URL` | 是 | 你的 OneUptime 執行個體的 URL（例如 `<YOUR_ONEUPTIME_URL>`） |",
  "| `ONEUPTIME_SERVICE_TOKEN` | Yes | The telemetry ingestion key from step 1 |":
    "| `ONEUPTIME_SERVICE_TOKEN` | 是 | 第 1 步中的遙測擷取金鑰 |",
  "| `PODMAN_HOST_NAME` | No | Friendly name for this host. Defaults to `podman-host` |":
    "| `PODMAN_HOST_NAME` | 否 | 此主機的易記名稱。預設為 `podman-host` |",
  "| `DOCKER_API_VERSION` | No | Docker API version the agent speaks to the Podman socket. Empty by default: the agent negotiates it with the socket. Set it only to pin a version (see Troubleshooting) |":
    "| `DOCKER_API_VERSION` | 否 | 代理程式與 Podman 通訊端溝通時使用的 Docker API 版本。預設為空：代理程式會與通訊端協商版本。只在需要固定版本時設定（請參閱 疑難排解） |",
  "| `ONEUPTIME_LOG_OPERATOR_1` to `ONEUPTIME_LOG_OPERATOR_5` | No | Collector operators of your own, one each as JSON, for a log format the agent does not read |":
    "| `ONEUPTIME_LOG_OPERATOR_1` 到 `ONEUPTIME_LOG_OPERATOR_5` | 否 | 你自己的收集器運算子，每個都以 JSON 形式提供，用於代理程式讀取不了的日誌格式 |",
  "Pass each one to `podman run` as `-e NAME=value`. To change one later, remove the agent with `podman rm -f oneuptime-podman-agent` and run the command again with the new value.":
    "將每個變數以 `-e NAME=value` 的形式傳給 `podman run`。之後要修改某個變數，請用 `podman rm -f oneuptime-podman-agent` 移除代理程式，再用新值重新執行指令。",
  "The agent reads the files Podman's **`k8s-file`** log driver writes — `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log` — so it only sees logs from containers that use it (or `json-file`, which Podman treats as the same file-based driver). Rootful Podman's default is **`journald`**, which it cannot read, and neither can it read a remote driver such as `syslog`.":
    "代理程式讀取 Podman **`k8s-file`** 日誌驅動程式寫入的檔案（`/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`），因此只看得到使用它（或 `json-file`，Podman 把它當作同一個以檔案為基礎的驅動程式）的容器的日誌。rootful 模式的 Podman 預設使用 **`journald`**，代理程式無法讀取，也無法讀取 `syslog` 之類的遠端驅動程式。",
  "Check a container's log driver, and Podman's default:":
    "檢查容器的日誌驅動程式和 Podman 的預設驅動程式：",
  "Run a single container with `k8s-file`:": "用 `k8s-file` 執行單一容器：",
  "Switch a Compose service to `k8s-file`, with rotation:":
    "將 Compose 服務切換為具輪替功能的 `k8s-file`：",
  "Or change the default for every container created afterwards, in `containers.conf` (`/etc/containers/containers.conf` rootful, `~/.config/containers/containers.conf` rootless):":
    "或者在 `containers.conf`（rootful 模式為 `/etc/containers/containers.conf`，rootless 模式為 `~/.config/containers/containers.conf`）中，為之後建立的所有容器變更預設驅動程式：",
  "Then **recreate** (not just restart) the affected containers: a container keeps the log driver it was created with. Must keep `journald`? The agent still collects metrics through the socket; only container logs need the file-based driver.":
    "然後 **重新建立** 受影響的容器（只重新啟動不夠）：容器會保留建立時的日誌驅動程式。必須保留 `journald`？代理程式仍會透過通訊端收集指標；只有容器日誌需要以檔案為基礎的驅動程式。",
  "`oneuptime-podman-ai-agent`, the second container step 2 starts, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, remove it with `podman rm -f oneuptime-podman-ai-agent`.":
    "`oneuptime-podman-ai-agent` 是第 2 步啟動的第二個容器，在 OneUptime AI 調查此主機上的事件或警示時，透過 Podman 的 Docker 相容通訊端執行它要求的 `docker` 指令。**AI 調查預設為開啟**：它一連線，OneUptime AI 就會用它進行調查，主機的 **人工智慧 → AI 代理程式** 頁面和 **概覽** 會顯示它的狀態。要關閉調查，請使用該頁面上的 **AI 可以執行的操作**；要在沒有 AI 代理程式的情況下執行收集器，請用 `podman rm -f oneuptime-podman-ai-agent` 移除它。",
  "- **Read-only by default.** It runs commands such as `docker ps`, `docker logs --tail 200 NAME`, `docker inspect` and `docker stats --no-stream` — never `exec`, `run`, `rm` or `prune`. Environment values in `docker inspect` output are masked before anything leaves the host.":
    "- **預設為唯讀。** 它執行 `docker ps`、`docker logs --tail 200 NAME`、`docker inspect` 和 `docker stats --no-stream` 等指令，絕不執行 `exec`、`run`、`rm` 或 `prune`。`docker inspect` 輸出中的環境變數值會在任何內容離開主機之前被遮蔽。",
  "- **Fixes are opt-in.** Add `-e ONEUPTIME_AI_ALLOW_WRITES=true` to the command to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **修正需要主動開啟。** 在指令中加上 `-e ONEUPTIME_AI_ALLOW_WRITES=true`，即可允許它重新啟動、啟動、停止、暫停、終止指定名稱的容器或變更其限制。旁邊的 `ONEUPTIME_AI_FIXES` 決定每項修正是否需要核准（`ask-for-approval`、`automatic` 或 `bypass-approval`），主機的 **人工智慧 → AI 代理程式** 頁面會顯示這一點。`ONEUPTIME_AI_WRITE_TARGETS`（以逗號分隔的萬用字元，例如 `web-*,api-*`）限定可操作的容器；`ONEUPTIME_AI_PROTECTED_TARGETS` 加入它絕不能變更的容器。它絕不會變更自己或收集器。",
  "- It needs the same socket as the collector, and runs as root because the socket is root-owned. The socket's `:ro` mount does not make the API read-only — the agent's command policy is the limit.":
    "- 它需要與收集器相同的通訊端，並且由於通訊端屬於 root，它以 root 身分執行。以 `:ro` 方式掛載通訊端並不會讓 API 變成唯讀——真正的限制是代理程式的指令政策。",
  "- Its logs: `podman logs -f oneuptime-podman-ai-agent`. What it may run, and how fixes work: [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts).":
    "- 它的日誌：`podman logs -f oneuptime-podman-ai-agent`。它可以執行什麼，以及修正如何運作：[基礎架構 AI 代理程式](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts)。",
  "| Tag | Description |": "| 標籤 | 說明 |",
  "| `oneuptime/podman-agent:release` | Latest stable release (community) |":
    "| `oneuptime/podman-agent:release` | 最新穩定版（community） |",
  "| `oneuptime/podman-agent:enterprise-release` | Latest stable release (enterprise) |":
    "| `oneuptime/podman-agent:enterprise-release` | 最新穩定版（enterprise） |",
  "| `oneuptime/podman-agent:<version>` | A pinned version, e.g. `10.0.31` |":
    "| `oneuptime/podman-agent:<version>` | 固定的版本，例如 `10.0.31` |",
  "| `ghcr.io/oneuptime/podman-agent:release` | The same image, mirrored on GHCR |":
    "| `ghcr.io/oneuptime/podman-agent:release` | 同一個映像檔，鏡像於 GHCR |",
  "Use one in place of `oneuptime/podman-agent:release` at the end of the `podman run` command.":
    "用其中一個取代 `podman run` 指令結尾的 `oneuptime/podman-agent:release`。",
  "**Upgrade** — pull the latest image and remove the running agent:":
    "**升級**：拉取最新的映像檔，並移除正在執行的代理程式：",
  "Then run both `podman run` commands from step 2 again.":
    "然後重新執行第 2 步中的兩個 `podman run` 指令。",
  "**Uninstall:**": "**解除安裝：**",
  "| Category | Data |": "| 類別 | 資料 |",
  "| **CPU Metrics** | Usage total, usage percentage, throttling time (per container) |":
    "| **CPU 指標** | 總使用量、使用率、節流時間（依容器） |",
  "| **Memory Metrics** | Usage, limit, percentage, RSS, cache (per container) |":
    "| **記憶體指標** | 使用量、限制、百分比、RSS、快取（依容器） |",
  "| **Network Metrics** | Bytes and packets received/transmitted (per container) |":
    "| **網路指標** | 接收/傳送的位元組數和封包數（依容器） |",
  "| **Block I/O Metrics** | Read/write bytes and operations (per container) |":
    "| **區塊 I/O 指標** | 讀取/寫入的位元組數和作業數（依容器） |",
  "| **Container Info** | Uptime, restart count, process count |":
    "| **容器資訊** | 執行時間、重新啟動次數、處理程序數 |",
  "| **Container Logs** | stdout/stderr logs from all containers that use the `k8s-file` log driver |":
    "| **容器日誌** | 所有使用 `k8s-file` 日誌驅動程式的容器的 stdout/stderr 日誌 |",
  'The metrics come from the collector\'s `docker_stats` receiver, through Podman\'s Docker-compatible socket, so their names are the same as the Docker agent\'s. Each log line gets a severity from the level it names (`[ERROR]`, `level=warn`, `{"level":"info"}`); a line without one falls back to its stream — stderr is `ERROR`, stdout is `INFO`.':
    '這些指標來自收集器的 `docker_stats` 接收器，經由 Podman 的 Docker 相容通訊端，因此名稱與 Docker 代理程式的相同。每行日誌的嚴重性取自它標示的層級（`[ERROR]`、`level=warn`、`{"level":"info"}`）；沒有層級的行依其輸出串流決定：stderr 為 `ERROR`，stdout 為 `INFO`。',
  "The agent must run as root to read `/run/podman/podman.sock`. Make sure the `--user 0:0` flag is in your `podman run` command, and that the socket is on:":
    "代理程式必須以 root 身分執行才能讀取 `/run/podman/podman.sock`。請確認你的 `podman run` 指令中有 `--user 0:0` 旗標，並且通訊端已開啟：",
  "That is rootful Podman's socket, the one the agent reads. Running Podman rootless? Its socket is `/run/user/<uid>/podman/podman.sock` (turn it on with `systemctl --user enable --now podman.socket`) and its storage `~/.local/share/containers/storage`: mount those at `/run/podman/podman.sock` and `/var/lib/containers/storage` in the agent's container instead — see the Podman agent documentation.":
    "這是 rootful 模式 Podman 的通訊端，也就是代理程式讀取的那一個。以 rootless 模式執行 Podman？它的通訊端是 `/run/user/<uid>/podman/podman.sock`（用 `systemctl --user enable --now podman.socket` 開啟），儲存空間是 `~/.local/share/containers/storage`：請改為把它們掛載到代理程式容器中的 `/run/podman/podman.sock` 和 `/var/lib/containers/storage`——請參閱 Podman 代理程式文件。",
  "The agent's logs show:": "代理程式的日誌顯示：",
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Remove the agent (`podman rm -f oneuptime-podman-agent`), pull the latest image (`podman pull oneuptime/podman-agent:release`) and run the command from step 2 again, without `-e DOCKER_API_VERSION`. The agent then negotiates the version with the socket.":
    "設有最高版本的伺服器會拒絕較新的用戶端，收集器因此結束，容器不斷重新啟動。只有在 `DOCKER_API_VERSION` 指定了版本時，代理程式才會固定 Docker API 版本，而舊的代理程式映像檔固定了 `1.44`。請移除代理程式（`podman rm -f oneuptime-podman-agent`），拉取最新的映像檔（`podman pull oneuptime/podman-agent:release`），然後不加 `-e DOCKER_API_VERSION` 重新執行第 2 步中的指令。之後代理程式會與通訊端協商版本。",
  "To pin a version anyway, use no more than the version the socket reports:":
    "如果仍要固定版本，請不要超過通訊端回報的版本：",
  "Add it to the command, e.g. `-e DOCKER_API_VERSION=1.41`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "將它加到指令中，例如 `-e DOCKER_API_VERSION=1.41`。較新的伺服器仍然支援舊的 API 版本，因此固定的版本在升級後仍可使用。",
  "1. Check that the agent is running: `podman ps --filter name=oneuptime-podman-agent`":
    "1. 檢查代理程式是否正在執行：`podman ps --filter name=oneuptime-podman-agent`",
  "2. Check the agent's logs for errors: `podman logs oneuptime-podman-agent 2>&1 | grep -i error`":
    "2. 檢查代理程式的日誌中是否有錯誤：`podman logs oneuptime-podman-agent 2>&1 | grep -i error`",
  "3. Verify the OneUptime URL and ingestion key in the `podman run` command are correct.":
    "3. 確認 `podman run` 指令中的 OneUptime URL 和擷取金鑰正確。",
  "4. Make sure the host can reach your OneUptime instance over the network.":
    "4. 確認主機能透過網路連到你的 OneUptime 執行個體。",
  "Check that the Podman socket is mounted into the agent. Its image has no shell, so look from a throwaway container that shares its mounts:":
    "檢查 Podman 通訊端是否已掛載到代理程式中。它的映像檔沒有 shell，所以請從一個共用其掛載的臨時容器中查看：",
  "Then look for export errors in the agent's logs — `podman logs oneuptime-podman-agent 2>&1 | grep -i error` — and make sure the ingestion key is valid and has not expired.":
    "然後在代理程式的日誌中尋找匯出錯誤（`podman logs oneuptime-podman-agent 2>&1 | grep -i error`），並確認擷取金鑰有效且尚未過期。",
  "Metrics arrive but the **Logs** tab is empty, or shows only the agent's own logs? Your containers are most likely not using a file-based log driver (`k8s-file` or `json-file`) — rootful Podman defaults to `journald`, which the agent cannot read.":
    "指標有收到，但 **日誌** 分頁是空的，或只顯示代理程式自己的日誌？你的容器很可能沒有使用以檔案為基礎的日誌驅動程式（`k8s-file` 或 `json-file`）——rootful 模式的 Podman 預設使用 `journald`，代理程式無法讀取。",
  "If step 1 shows `no files match the configured criteria`, or step 3 lists no files for your containers, they are not using `k8s-file`. Switch them (see **Collect logs from every container (k8s-file log driver)** under Advanced), then recreate each one — a container keeps the log driver it was created with:":
    "如果第 1 步顯示 `no files match the configured criteria`，或者第 3 步沒有列出你的容器的任何檔案，表示它們沒有使用 `k8s-file`。請切換它們（請參閱 進階 中的 **收集所有容器的日誌（k8s-file 日誌驅動程式）**），然後逐一重新建立：容器會保留建立時的日誌驅動程式：",
  "A host's page shows the data whose host name is that host's identifier, which the agent takes from `PODMAN_HOST_NAME`. Change `PODMAN_HOST_NAME` after the host registered, and OneUptime registers a second host under the new name — the logs are on that one. Check the name the agent reports:":
    "主機頁面顯示主機名稱等於該主機識別碼的資料，代理程式從 `PODMAN_HOST_NAME` 取得這個識別碼。如果在主機註冊後變更 `PODMAN_HOST_NAME`，OneUptime 會以新名稱註冊第二台主機——日誌就在那台主機上。檢查代理程式回報的名稱：",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and recreate the agent — `podman rm -f oneuptime-podman-agent`, then run the command from step 2 with the new name.":
    "主機的名稱來自 `PODMAN_HOST_NAME`。未設定它就啟動的代理程式會回報 `podman-host`，因此這樣設定的所有主機看起來都是同一台主機。請在每台主機上為 `PODMAN_HOST_NAME` 設定一個專屬的名稱，並重新建立代理程式：`podman rm -f oneuptime-podman-agent`，然後用新名稱執行第 2 步中的指令。",
  "This installs the agent for **`web-1`** — keep `PODMAN_HOST_NAME` exactly as it is, or the data registers as a new host.":
    "這會為 **`web-1`** 安裝代理程式——請保持 `PODMAN_HOST_NAME` 原樣不變，否則資料會註冊為一台新主機。",
  "A compose provider for `podman compose`: `podman-compose` or Docker Compose":
    "適用於 `podman compose` 的 Compose 提供者：`podman-compose` 或 Docker Compose",
  "The second service is the OneUptime AI agent, with the same URL, key and host name. **AI investigations are on by default**: while OneUptime AI investigates an incident or alert on this host, it runs read-only `docker` commands through the AI agent, against Podman's Docker-compatible socket, and it changes nothing unless you allow fixes — see **The OneUptime AI agent** under Advanced. Delete the `oneuptime-podman-ai-agent` service to run the collector without AI investigations.":
    "第二個服務是 OneUptime AI 代理程式，使用相同的 URL、金鑰和主機名稱。**AI 調查預設為開啟**：OneUptime AI 調查此主機上的事件或警示時，會透過 AI 代理程式對 Podman 的 Docker 相容通訊端執行唯讀的 `docker` 指令，除非你允許修正，否則不會做任何變更——請參閱 進階 中的 **OneUptime AI 代理程式**。刪除 `oneuptime-podman-ai-agent` 服務即可在沒有 AI 調查的情況下執行收集器。",
  "Set each one in the agent's `environment:` list, then run `podman compose up -d` to recreate it with the new values.":
    "在代理程式的 `environment:` 清單中設定每個變數，然後執行 `podman compose up -d`，用新值重新建立它。",
  "`oneuptime-podman-ai-agent`, the second service in docker-compose.yml, runs the `docker` commands OneUptime AI asks for — through Podman's Docker-compatible socket — while it investigates an incident or alert on this host. **AI investigations are on by default**: once it connects, OneUptime AI investigates with it, and the host's **AI → AI agent** page and **Overview** show its status. To turn investigation off, use **What AI may do** on that page; to run the collector without the AI agent, delete its service and run `podman compose up -d --remove-orphans`.":
    "`oneuptime-podman-ai-agent` 是 docker-compose.yml 中的第二個服務，在 OneUptime AI 調查此主機上的事件或警示時，透過 Podman 的 Docker 相容通訊端執行它要求的 `docker` 指令。**AI 調查預設為開啟**：它一連線，OneUptime AI 就會用它進行調查，主機的 **人工智慧 → AI 代理程式** 頁面和 **概覽** 會顯示它的狀態。要關閉調查，請使用該頁面上的 **AI 可以執行的操作**；要在沒有 AI 代理程式的情況下執行收集器，請刪除它的服務並執行 `podman compose up -d --remove-orphans`。",
  "- **Fixes are opt-in.** Add `- ONEUPTIME_AI_ALLOW_WRITES=true` to its `environment:` list to let it restart, start, stop, pause, kill or change the limits of a named container. `ONEUPTIME_AI_FIXES` beside it says whether each fix needs approval (`ask-for-approval`, `automatic` or `bypass-approval`), and the host's **AI → AI agent** page shows it. `ONEUPTIME_AI_WRITE_TARGETS` (comma-separated globs such as `web-*,api-*`) limits which containers; `ONEUPTIME_AI_PROTECTED_TARGETS` adds containers it must never change. It never changes itself or the collector.":
    "- **修正需要主動開啟。** 在它的 `environment:` 清單中加上 `- ONEUPTIME_AI_ALLOW_WRITES=true`，即可允許它重新啟動、啟動、停止、暫停、終止指定名稱的容器或變更其限制。旁邊的 `ONEUPTIME_AI_FIXES` 決定每項修正是否需要核准（`ask-for-approval`、`automatic` 或 `bypass-approval`），主機的 **人工智慧 → AI 代理程式** 頁面會顯示這一點。`ONEUPTIME_AI_WRITE_TARGETS`（以逗號分隔的萬用字元，例如 `web-*,api-*`）限定可操作的容器；`ONEUPTIME_AI_PROTECTED_TARGETS` 加入它絕不能變更的容器。它絕不會變更自己或收集器。",
  "Use one in place of `oneuptime/podman-agent:release` on the agent's `image:` line.":
    "用其中一個取代代理程式 `image:` 行中的 `oneuptime/podman-agent:release`。",
  "**Upgrade** — in the folder that holds docker-compose.yml, pull the latest images and recreate the containers:":
    "**升級**：在包含 docker-compose.yml 的資料夾中，拉取最新的映像檔並重新建立容器：",
  "**Uninstall** — stop and remove everything the file started:":
    "**解除安裝**：停止並移除該檔案啟動的所有內容：",
  'The agent must run as root to read `/run/podman/podman.sock`. Make sure the agent\'s service has `user: "0:0"` in docker-compose.yml, and that the socket is on:':
    '代理程式必須以 root 身分執行才能讀取 `/run/podman/podman.sock`。請確認 docker-compose.yml 中代理程式的服務設定了 `user: "0:0"`，並且通訊端已開啟：',
  "A server that enforces a maximum refuses a newer client, the collector exits with it, and the container restart-loops. The agent pins a Docker API version only when `DOCKER_API_VERSION` names one, and an older agent image pinned `1.44`. Take `DOCKER_API_VERSION` out of the agent's `environment:` list, then run `podman compose pull` and `podman compose up -d`. The agent then negotiates the version with the socket.":
    "設有最高版本的伺服器會拒絕較新的用戶端，收集器因此結束，容器不斷重新啟動。只有在 `DOCKER_API_VERSION` 指定了版本時，代理程式才會固定 Docker API 版本，而舊的代理程式映像檔固定了 `1.44`。請從代理程式的 `environment:` 清單中拿掉 `DOCKER_API_VERSION`，然後執行 `podman compose pull` 和 `podman compose up -d`。之後代理程式會與通訊端協商版本。",
  "Add it to the agent's `environment:` list, e.g. `- DOCKER_API_VERSION=1.41`, and run `podman compose up -d`. Newer servers still serve older API versions, so a pinned version keeps working after an upgrade.":
    "將它加到代理程式的 `environment:` 清單中，例如 `- DOCKER_API_VERSION=1.41`，然後執行 `podman compose up -d`。較新的伺服器仍然支援舊的 API 版本，因此固定的版本在升級後仍可使用。",
  "3. Verify the OneUptime URL and ingestion key in docker-compose.yml are correct.":
    "3. 確認 docker-compose.yml 中的 OneUptime URL 和擷取金鑰正確。",
  "The host's name comes from `PODMAN_HOST_NAME`. An agent started without it reports `podman-host`, so every host set up that way looks like the same host. Set `PODMAN_HOST_NAME` to a name of its own on each host and run `podman compose up -d` to recreate the agent with it.":
    "主機的名稱來自 `PODMAN_HOST_NAME`。未設定它就啟動的代理程式會回報 `podman-host`，因此這樣設定的所有主機看起來都是同一台主機。請在每台主機上為 `PODMAN_HOST_NAME` 設定一個專屬的名稱，並執行 `podman compose up -d`，用它重新建立代理程式。",
};

export default TRANSLATION;
