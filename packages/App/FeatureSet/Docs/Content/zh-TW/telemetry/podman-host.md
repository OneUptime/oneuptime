# Podman 代理程式

OneUptime Podman 代理程式是你在 Podman 主機上執行的一個容器。它會讀取主機上每個容器的統計資料和日誌檔案，並將其傳送到 OneUptime，主機會連同其容器、指標和日誌一起出現在那裡。第二個容器 Podman AI 代理程式讓 OneUptime AI 能夠調查該主機。[Podman 監控](/docs/monitor/podman-monitor) 會根據代理程式傳送的資料發出警示。

:::cards
- [安裝代理程式](#安裝代理程式): 兩個容器，使用 `podman run` 或 Podman Compose。
- [代理程式收集的內容](#代理程式收集的內容): 每個容器的指標、日誌和清單。
- [容器日誌需要 k8s-file](#容器日誌需要-k8s-file-日誌驅動程式): 除非你切換，否則 Podman 會將日誌寫入 journald。
- [疑難排解](#疑難排解): 重新啟動迴圈、缺少指標、缺少日誌。
:::

## 運作方式

該代理程式是一個內建 OneUptime 設定的 OpenTelemetry Collector。它會透過 Podman 與 Docker 相容的 API 通訊端每 30 秒讀取一次每個容器的統計資料，並每 5 分鐘列出一次所有容器、映像檔、網路和磁碟區。它會追蹤容器的日誌檔案，並使用你提供的擷取金鑰，透過 OTLP 將所有內容傳送到你的 OneUptime URL。

```mermaid title="Podman 主機上的兩個容器"
flowchart TB
    containers["你的容器"] -->|"統計、日誌檔案、<br/>清單"| agent["Podman 代理程式"]
    agent -->|"透過 HTTPS 的 OTLP"| oneuptime["OneUptime"]
    oneuptime -->|"調查事件<br/>或警示"| ai["Podman AI 代理程式"]
    ai -->|"唯讀<br/>docker 指令"| containers
```

主機會隨其第一批資料，以你在 `PODMAN_HOST_NAME` 中指定的名稱自行註冊。AI 代理程式是選用的：不安裝它，Collector 也照常運作。

## 開始之前

- Podman 4.0 或更新版本，以及主機上的 root 權限。
- 位於 `/run/podman/podman.sock` 的 Podman API 通訊端。使用 `sudo systemctl enable --now podman.socket` 開啟它。
- 一把擷取金鑰。在 **專案設定 → 遙測與 APM → 擷取金鑰** 下建立一把並複製其值。
- 從主機到你的 OneUptime URL 的輸出 HTTPS。
- 對於容器日誌，需要容器使用 `k8s-file` 日誌驅動程式。以 root 執行的 Podman 預設會將日誌寫入 `journald`，而代理程式無法讀取它。請參閱 [容器日誌需要 k8s-file 日誌驅動程式](#容器日誌需要-k8s-file-日誌驅動程式)。

## 安裝代理程式

:::steps
### 啟動代理程式

將 `YOUR_ONEUPTIME_URL` 替換為你的 OneUptime URL，將 `YOUR_TELEMETRY_INGESTION_TOKEN` 替換為擷取金鑰，將 `my-podman-host` 替換為此主機的名稱，例如 `prod-podman-01`。主機會以這個名稱出現在 OneUptime 中，所以請保持不變：新名稱會註冊一台新主機。

:::tabs
@tab Podman CLI
```bash
podman run -d \
  --name oneuptime-podman-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /run/podman/podman.sock:/run/podman/podman.sock:ro \
  -v /var/lib/containers/storage:/var/lib/containers/storage:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e PODMAN_HOST_NAME="my-podman-host" \
  oneuptime/podman-agent:release
```

然後使用相同的值在它旁邊啟動 [AI 代理程式](#ai-代理程式)。**AI 調查預設為開啟。** 當 OneUptime AI 調查此主機上的事件或警示時，它會透過 AI 代理程式、針對 Podman 與 Docker 相容的 API 執行唯讀的 `docker` 指令，而且除非你允許修正，否則不會變更任何東西。若要在不啟用 AI 調查的情況下安裝，請略過這個指令。

```bash
podman run -d \
  --name oneuptime-podman-ai-agent \
  --user 0:0 \
  --restart unless-stopped \
  --read-only --tmpfs /tmp \
  -v /run/podman/podman.sock:/run/podman/podman.sock:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e ONEUPTIME_AI_AGENT_RESOURCE_TYPE=podman \
  -e PODMAN_HOST_NAME="my-podman-host" \
  oneuptime/resource-ai-agent:release
```
@tab Podman Compose
將以下內容儲存為主機上某個資料夾中的 `docker-compose.yml`。第二個服務是 [AI 代理程式](#ai-代理程式)：移除它即可在不啟用 AI 調查的情況下執行 Collector。

```yaml title="docker-compose.yml"
services:
  oneuptime-podman-agent:
    image: oneuptime/podman-agent:release
    container_name: oneuptime-podman-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /run/podman/podman.sock:/run/podman/podman.sock:ro
      - /var/lib/containers/storage:/var/lib/containers/storage:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - PODMAN_HOST_NAME=my-podman-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
  oneuptime-podman-ai-agent:
    image: oneuptime/resource-ai-agent:release
    container_name: oneuptime-podman-ai-agent
    user: "0:0"
    restart: unless-stopped
    read_only: true
    tmpfs:
      - /tmp
    volumes:
      - /run/podman/podman.sock:/run/podman/podman.sock:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - ONEUPTIME_AI_AGENT_RESOURCE_TYPE=podman
      - PODMAN_HOST_NAME=my-podman-host
```

在該資料夾中啟動它：

```bash
podman compose up -d
```
:::

### 檢查代理程式是否正在執行

```bash
podman ps --filter name=oneuptime-podman-agent
podman logs -f oneuptime-podman-agent
```

Collector 啟動後，日誌中應出現這一行：

```text
Everything is ready. Begin running and processing data.
```

### 在 OneUptime 中找到主機

開啟 **產品 → 基礎設施 → Podman → 所有主機**。大約一分鐘內，主機會以其 `PODMAN_HOST_NAME` 出現，並帶有其容器、指標和日誌。AI 代理程式會在主機的 **AI 代理程式** 頁面上以及其 **概覽** 底部顯示為已連線。
:::

## 環境變數

| 變數 | 必要 | 說明 |
| --- | --- | --- |
| `ONEUPTIME_URL` | 是 | 你的 OneUptime URL，例如 `https://oneuptime.com` 或你的自行託管執行個體。如果執行個體只支援 HTTP，請使用 `http://` 及其連接埠。 |
| `ONEUPTIME_SERVICE_TOKEN` | 是 | 來自 **專案設定 → 遙測與 APM → 擷取金鑰** 的擷取金鑰。 |
| `PODMAN_HOST_NAME` | 否 | 主機在 OneUptime 中的名稱。預設為 `podman-host`，因此請為每台主機設定自己的名稱。 |
| `DOCKER_API_VERSION` | 否 | 代理程式與 Podman 通訊端溝通時使用的 Docker API 版本。預設為 `1.44`。如果通訊端回報的上限較舊，請調低它，或將其設為空值以進行協商（請參閱 [疑難排解](#疑難排解)）。 |

若要變更某個值，請移除代理程式並重新執行其指令（Podman CLI），或編輯 `docker-compose.yml` 並執行 `podman compose up -d`（Podman Compose）。

## 代理程式收集的內容

| 資料 | 內容 |
| --- | --- |
| 容器指標 | 每個容器每 30 秒一次：CPU（用量、百分比、節流）、記憶體（用量、限制、百分比）、網路和區塊 I/O、執行時間、重新啟動次數和處理程序數。 |
| 容器日誌 | 每個容器的 stdout 和 stderr，來自 `k8s-file` 日誌驅動程式寫入的 `ctr.log` 檔案。 |
| 清單 | 處於任何狀態的每個容器，以及每個映像檔、網路和磁碟區，每 5 分鐘一次。 |

每個容器的指標和日誌都會歸入一個以該容器命名的服務下。每一行日誌的嚴重性取自它所寫明的等級，例如 `[ERROR]`、`level=warn` 或 `{"level":"info"}`；沒有寫明等級的行則採用其所在串流的嚴重性：stderr 為 `ERROR`，stdout 為 `INFO`。以空白或右括號開頭的行會併入前一行，因此堆疊追蹤會以單一記錄送達。代理程式自身的日誌不會被收集。

[Podman 監控](/docs/monitor/podman-monitor#收集的指標) 列出了每個指標及其意義。

## 容器日誌需要 k8s-file 日誌驅動程式

代理程式會追蹤 `/var/lib/containers/storage/overlay-containers/*/userdata/ctr.log`，也就是 Podman 的 `k8s-file` 日誌驅動程式寫入的檔案（在 Podman 中，`json-file` 是同一個驅動程式）。以 root 執行的 Podman 預設驅動程式是 `journald`，它不會留下可讀取的檔案，`syslog` 這類遠端驅動程式也是如此。這類容器的指標仍會送達，但日誌不會。

檢查某個容器的日誌驅動程式，以及 Podman 的預設驅動程式：

```bash
podman inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
podman info --format '{{.Host.LogDriver}}'
```

使用 `k8s-file` 執行容器，或將某個 Compose 服務切換為它：

```bash
podman run --log-driver k8s-file --log-opt max-size=100m ... <image>
```

```yaml
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "k8s-file"
      options:
        max-size: "100m"
```

或在 `containers.conf` 中將其設為之後建立的所有容器的預設驅動程式（以 root 執行時為 `/etc/containers/containers.conf`，無 root 執行時為 `~/.config/containers/containers.conf`）：

```toml title="containers.conf"
[containers]
log_driver = "k8s-file"
log_size_max = 104857600
```

然後重新建立容器。容器會一直使用建立時的日誌驅動程式，因此只重新啟動它是不夠的。

## 升級代理程式

當代理程式比你的 OneUptime 舊時，主機 **概覽** 上的 **代理程式版本** 旁邊會出現警告標誌。選取該標誌即可看到這些指令。

:::tabs
@tab Podman CLI
```bash
podman pull oneuptime/podman-agent:release
podman pull oneuptime/resource-ai-agent:release
podman rm -f oneuptime-podman-agent oneuptime-podman-ai-agent
```

然後再次執行 [啟動代理程式](#啟動代理程式) 中的兩個 `podman run` 指令。
@tab Podman Compose
```bash
podman compose pull
podman compose up -d
```
:::

`release` 標籤一律指向最新的發行版本。若要固定版本，請使用 `oneuptime/podman-agent:<version>`，例如 `oneuptime/podman-agent:10.0.31`。同一個映像檔也以 `ghcr.io/oneuptime/podman-agent:release` 發布在 GitHub Container Registry 上。

## 解除安裝代理程式

:::tabs
@tab Podman CLI
```bash
podman rm -f oneuptime-podman-agent
podman rm -f oneuptime-podman-ai-agent
```
@tab Podman Compose
```bash
podman compose down
```
:::

主機會連同它傳送過的資料一起保留在 OneUptime 中。如果不再需要，請透過其選單中的 **刪除主機** 將其刪除。

## AI 代理程式

上面的指令和 Compose 檔案、Podman 代理程式的 `install.sh`，以及其 [PodmanAgent 目錄](https://github.com/OneUptime/oneuptime/tree/master/agents/PodmanAgent) 中的 `docker-compose.yml`，都會執行 **Podman AI 代理程式**：第二個容器 `oneuptime-podman-ai-agent`（映像檔 `oneuptime/resource-ai-agent:release`），它會在 OneUptime AI 調查此主機上的事件或警示時，執行 OneUptime AI 要求的唯讀指令——透過 Podman 與 Docker 相容的 API，使用 `docker` CLI：`docker ps -a`、`docker logs --tail 200 web`、`docker container inspect web`——而且只有在你允許時才會套用修正，例如重新啟動指定的容器。它會讀取與 Collector 相同的 `ONEUPTIME_URL`、`ONEUPTIME_SERVICE_TOKEN` 和 `PODMAN_HOST_NAME`，因此它服務的正是這台主機，並會出現在 OneUptime 中該主機的 **AI 代理程式** 頁面上。

- **AI 調查預設為開啟。** 代理程式連線後，OneUptime AI 會用它來調查該主機上的事件和警示，主機的 **概覽** 會顯示代理程式的狀態。若要停止，請在代理程式執行的位置設定 `ONEUPTIME_AI_INVESTIGATION=false`（AI 代理程式頁面上 **AI 可以執行的操作** 下的 **變更** 會顯示方法），或不安裝代理程式。
- 除非你以 `ONEUPTIME_AI_ALLOW_WRITES=true` 啟動它，否則它是唯讀的；`ONEUPTIME_AI_WRITE_TARGETS`（例如 `web-*,api-*`）會限制修正可以觸及哪些容器。啟動時也要帶上 `ONEUPTIME_AI_FIXES`，以指定修正的執行方式——`ask-for-approval`（由人逐一核准）、`automatic` 或 `bypass-approval`——AI 代理程式頁面會以唯讀方式顯示它（[由代理程式設定的 AI 可以執行的操作](/docs/ai/infrastructure-ai-agents#what-ai-may-do-set-by-the-agent)）。
- 它需要與 Collector 相同的通訊端，並以 root 身分執行、掛載該通訊端，因為該通訊端屬於 root——而對於以 root 執行的 Podman，無論是否為 `:ro`，能夠使用該通訊端的人就等同這台主機上的 root。代理程式的指令原則就是界限：它從不執行 `exec`、`run`、`rm` 或 `prune`，也從不變更它自己、Collector 或 `ONEUPTIME_AI_PROTECTED_TARGETS`（容器名稱萬用字元）中的任何內容。
- `install.sh --no-ai-agent` 會略過它；`podman rm -f oneuptime-podman-ai-agent` 會移除它。升級方式與 Collector 相同：`podman pull oneuptime/resource-ai-agent:release`，移除它，然後再次啟動。

它可以執行什麼、修正如何運作以及如何疑難排解，請參閱 [Infrastructure AI Agents](/docs/ai/infrastructure-ai-agents#docker-and-podman-hosts)。

## 疑難排解

:::details 代理程式因 "client version is too new" 而不斷重新啟動
代理程式的日誌顯示：

```text
Error: cannot start pipelines: failed to start "docker_stats" receiver:
Error response from daemon: client version 1.44 is too new.
Maximum supported API version is 1.41
```

強制限定用戶端最高版本的 Docker API 伺服器會拒絕較新的用戶端，因此接收器永遠無法啟動，Collector 也隨之結束。檢查 Podman 通訊端回報的 API 版本：

```bash
curl -s -o /dev/null -D - --unix-socket /run/podman/podman.sock http://localhost/_ping | grep -i '^api-version'
```

然後在 `podman run` 中加入 `-e DOCKER_API_VERSION=1.41`（或你得到的值），或在 Compose 中設定 `DOCKER_API_VERSION`。較新的伺服器仍然支援較舊的 API 版本，因此該設定在升級後依然有效。

不想查這個數字？將 `DOCKER_API_VERSION` 設為空字串。代理程式接著會與通訊端協商版本（一次 `HEAD /_ping`，然後使用通訊端回報的上限），而不是固定某個版本：

```bash
podman run -d ... -e DOCKER_API_VERSION= ...
```
:::

:::details Podman 通訊端權限遭拒，或沒有通訊端
代理程式必須以 root 身分執行才能讀取 `/run/podman/podman.sock`。請檢查你的 `podman run` 指令中是否有 `--user 0:0`，或 Compose 中是否有 `user: "0:0"`，以及通訊端是否已開啟：`sudo systemctl enable --now podman.socket`。無 root 的 Podman 的通訊端則位於 `/run/user/<uid>/podman/podman.sock`（`systemctl --user enable --now podman.socket`）：請改為掛載該路徑來取代 `/run/podman/podman.sock`。
:::

:::details 主機顯示為已中斷
1. 檢查代理程式是否正在執行：`podman ps --filter name=oneuptime-podman-agent`
2. 在它的日誌中尋找錯誤：`podman logs oneuptime-podman-agent 2>&1 | grep -i error`
3. 檢查 `ONEUPTIME_URL` 和 `ONEUPTIME_SERVICE_TOKEN`：金鑰必須是有效且未被停用的擷取金鑰。
4. 檢查主機能否透過網路連線到你的 OneUptime URL。
:::

:::details 沒有出現指標
1. 檢查 Podman 通訊端是否已掛載到代理程式中。它的映像檔沒有 shell，因此請從一個共用其掛載的暫用容器中查看：`podman run --rm --volumes-from oneuptime-podman-agent alpine:3.19 ls -la /run/podman/podman.sock`
2. 在它的日誌中尋找匯出錯誤：`podman logs oneuptime-podman-agent 2>&1 | tail -100`
3. 檢查擷取金鑰是否有效且未過期。
:::

:::details 指標有送達，但沒有容器日誌
你的容器很可能使用的是 Podman 的預設日誌驅動程式 `journald`。檢查代理程式監看的是哪些檔案，以及某個容器使用的是哪個驅動程式：

```bash
podman logs oneuptime-podman-agent 2>&1 | grep -E "Started watching file|no files match"
podman inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

如果代理程式回報 `no files match the configured criteria`，請依照 [容器日誌需要 k8s-file 日誌驅動程式](#容器日誌需要-k8s-file-日誌驅動程式) 中所示，將容器切換為 `k8s-file` 並重新建立它們。
:::

:::details 日誌出現在另一台主機下，或主機名稱為 podman-host
主機的名稱來自 `PODMAN_HOST_NAME`。不帶它啟動的代理程式會回報 `podman-host`，因此以這種方式設定的每台主機看起來都像同一台；之後再變更名稱，OneUptime 會註冊第二台主機，新資料接著會歸入它。請在每台主機上將 `PODMAN_HOST_NAME` 設定為它自己的名稱，並重新建立代理程式。若要檢查代理程式回報的名稱：

```bash
podman inspect oneuptime-podman-agent --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PODMAN_HOST_NAME
```
:::

## 後續步驟

:::cards
- [Podman 監控](/docs/monitor/podman-monitor): 針對容器的 CPU、記憶體和重新啟動發出警示。
- [資料庫](/docs/telemetry/databases): 主機上的資料庫容器會被探索到，並擁有自己的頁面。
- [Kubernetes 代理程式](/docs/telemetry/kubernetes-agent): 改為監控 Kubernetes 叢集。
- [主機 OpenTelemetry Collector](/docs/telemetry/host-otel-collector): 監控機器本身：CPU、磁碟、處理程序和日誌。
:::
