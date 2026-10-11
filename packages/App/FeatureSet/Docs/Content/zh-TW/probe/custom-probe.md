# 自訂探針

自訂探測器是在你自己的網路中執行的小型代理程式。它會檢查你加入它的監測器（例如內部網站、API 和防火牆後的伺服器），並把結果傳送到 OneUptime。它只透過 HTTPS 建立對外連線，因此你的網路中不需要有任何東西接受來自網際網路的連線。

:::cards
- [運作方式](#運作方式): 探測器做什麼，以及 OneUptime 如何知道它正在執行。
- [安裝探測器](#安裝探測器): 在 OneUptime 中建立，用 Docker、Docker Compose 或 Kubernetes 執行，並把它加入監測器。
- [環境變數](#環境變數): 探測器讀取的每個設定及其預設值。
- [診斷已中斷的探測器](#診斷已中斷的探測器): 找出探測器送往 OneUptime 的請求卡在哪裡。
:::

## 運作方式

```mermaid title="自訂探測器做什麼"
sequenceDiagram
    participant P as 自訂探測器
    participant S as 你的服務
    participant O as OneUptime
    P->>O: 我正在執行（每分鐘）
    P->>O: 我的哪些監測器到期了?
    O-->>P: 要檢查的監測器
    P->>S: 逐一檢查
    P->>O: 傳送結果
    O->>O: 更新狀態，開啟事件或警示
```

- **探測器向外連線。** 每個請求都從探測器透過 HTTPS 送往 `ONEUPTIME_URL`。網路外部不需要連到探測器。
- **它只檢查自己的監測器。** 探測器向 OneUptime 詢問加入了它的監測器，在每個監測器到期時進行檢查，並把結果傳回。監測器的狀態是否改變，由 OneUptime 根據結果決定。
- **OneUptime 會留意它是否在執行。** 探測器的每個請求都算作存活訊號，探測器至少每分鐘傳送一次。大約三分鐘內沒有任何請求時，探測器會顯示 **已中斷** ，並通知它的擁有者。沒有擁有者的探測器會通知專案的擁有者。

## 開始之前

- **在 OneUptime Cloud 上需要 Growth 方案。** 建立探測器需要它。自行託管的安裝沒有方案限制。
- **建立探測器的權限。** 專案擁有者和管理員擁有此權限，角色允許建立探測器的成員也有。
- **要監控的網路中的一台機器。** 它需要 Docker、Docker Compose 或 Kubernetes，一條通往探測器要檢查之服務的路由，以及到 `ONEUPTIME_URL` 的對外 HTTPS。

## 安裝探測器

:::steps
### 建立探測器

開啟 **監測 → 設定 → 探測器** ，按一下 **建立探測器** 。填寫 **名稱** 和 **描述** ：兩者都是必填。 **更多欄位** 中有 **探測器標誌** 、 **在新監測器上自動啟用監測** （為你建立的每個新監測器選擇此探測器）以及 **標籤** 。

### 複製它的 ID 和金鑰

探測器需要 ID 和金鑰才能連線。若要複製，請在 **自訂探針** 表格中開啟探測器的選單，選擇 **顯示 ID 和金鑰** 。能看到該表格的人都能複製探測器的 ID；只有專案擁有者和管理員能看到金鑰，他們看到的是 **顯示 ID 和金鑰** ，其他人看到的是 **顯示 ID** 。

專案擁有者和管理員也可以按一下探測器：其頁面上的 **Set up your Custom Probe** 卡片會顯示已填好 ID 和金鑰的 Docker 指令。

### 執行探測器

在選好的機器上，用探測器的 ID 和金鑰執行它。如果你自行託管 OneUptime，請把 `ONEUPTIME_URL` 設為你的安裝網址，而不是 `https://oneuptime.com`。

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

接著用 `docker compose up -d` 啟動它。
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

接著用 `kubectl apply -f oneuptime-probe.yaml` 套用它。
:::

主機網路（`--network host`、`network_mode: host`）讓探測器使用主機本身的網路，包括 IPv6。在不使用主機網路執行之前，請先閱讀 [監控 IPv6 目標](#監控-ipv6-目標)。

### 確認它已連線

一兩分鐘內， **自訂探針** 表格中探測器的 **狀態** 會變成 **已連線** 。如果仍是 **已中斷** ，原因寫在探測器的記錄中：請參閱 [診斷已中斷的探測器](#診斷已中斷的探測器)。

### 讓探測器檢查監測器

探測器只檢查加入了它的監測器。新監測器在 **建立監測器** 的 **探測器與間隔** 步驟中選擇探測器。對於既有的監測器，開啟它並前往 **設定 → 探測器與間隔** 。該頁面有三張卡片：

- **監測間隔** ：監測器的每個探測器檢查它的頻率。選擇間隔後會立即儲存。合成、Custom Code 和 SSL 憑證監測器提供 5 分鐘或更長的間隔；已經使用更短間隔或透過 API 設定排程的監測器會保留原設定，並顯示在清單中。
- **探測器** ：按一下 **新增探測器** ，選擇你的自訂探測器。若要讓某個探測器不再檢查此監測器，可在該列選單中用 **編輯** 關閉它，或刪除該列。
- **探測器一致性** ：監測器狀態改變前，需要有多少個探測器看到相同的結果，填入句子「一致的探測器達到 ... 時變更此監測器的狀態」中。留空表示全部。只有已啟用且已連線的探測器參與，因此比它們更大的數字也表示全部。離開輸入方塊或按 **Enter** 時會儲存該數字。

探測器不檢查的監測器（手動、傳入請求、傳入郵件、伺服器、網路設備和遙測監測器）沒有探測器與間隔頁面。
:::

> [!TIP]
> 需要檢查私有位址（例如 `http://10.0.0.5/health`）的探測器需要 `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true`。在你允許之前，探測器會拒絕私有位址：請參閱 [私有網路存取](/docs/self-hosted/private-network-access)。

## 透過 Proxy 連線

如果探測器必須經過 Proxy 才能連到 OneUptime 或它檢查的網站，請把 Proxy 的位址告訴它：

| 變數 | 作用 |
| --- | --- |
| `HTTPS_PROXY_URL` | HTTPS 位址使用的 Proxy，包括 OneUptime 本身和大多數網站。 |
| `HTTP_PROXY_URL` | 一般 HTTP 位址使用的 Proxy。 |
| `NO_PROXY` | 探測器直接連線的主機，以逗號分隔。 |

Proxy 位址寫成 `http://proxy.example.com:8080`；如果 Proxy 需要使用者名稱和密碼，則寫成 `http://username:password@proxy.example.com:8080`。大多數 Proxy 兩種位址都能處理，所以請把兩個變數設為同一個 URL。

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
```
:::

會經過 Proxy 的內容：

- **探測器本身送往 OneUptime 的請求。**
- **監測器的 HTTP 檢查** ：Website、API、External Status Page、Custom Code、SSL 憑證、合成和網域監測器。SSL 憑證和合成監測器使用 `HTTPS_PROXY_URL`，只設定了 `HTTP_PROXY_URL` 時則使用它。
- **不包括其他檢查。** Ping、Port、DNS、SNMP 等非 HTTP 的檢查會直接連線。

`NO_PROXY` 的項目可以是主機名稱（`api.internal`）、以點或 `*.` 開頭表示其下所有名稱的網域（`.internal.example.com`）、它們加上 `:port` 的形式，或表示全部的 `*`。不會讀取 IP 範圍：請逐一列出位址。小寫的 `http_proxy`、`https_proxy` 和 `no_proxy`，以及 `HTTP_PROXY` 和 `HTTPS_PROXY`，同樣有效。

## 監控 IPv6 目標

只有探測器本身的網路有 IPv6 時，它才能監控 IPv6 目標：

- **使用 `--network host` 的 Docker，或使用 `network_mode: host` 的 Compose** （上面的設定）：探測器共用主機的網路，因此只有主機有 IPv6 時它才有。
- **Docker 橋接網路** （不使用主機網路時得到的網路）：沒有 IPv6，除非為該網路開啟了 IPv6（見下文）。
- **Kubernetes** ：只有在雙重堆疊或純 IPv6 叢集上，Pod 才有 IPv6。

若要檢查，可在探測器內部 ping 一個公開的 IPv6 位址：

:::tabs
@tab Docker
```bash
docker exec oneuptime-probe ping -6 -c 1 2001:4860:4860::8888
```
@tab Kubernetes
```bash
kubectl exec deploy/oneuptime-probe -- ping -6 -c 1 2001:4860:4860::8888
```
:::

`1 received` 表示探測器可以連到 IPv6 目標。如果探測器沒有可用的 IPv6，`ping` 會立即失敗，錯誤會說明原因：

| 錯誤 | 意義 |
| --- | --- |
| `Network is unreachable` | 探測器的網路沒有 IPv6 路由：沒有 IPv6 的 Docker 橋接網路、僅 IPv4 的 Kubernetes 叢集，或沒有 IPv6 連線的主機。 |
| `Cannot assign requested address` | 探測器的網路命名空間中關閉了 IPv6。請檢查 `net.ipv6.conf.all.disable_ipv6` 和 `net.ipv6.conf.lo.disable_ipv6`：在探測器內執行 `cat /proc/sys/net/ipv6/conf/all/disable_ipv6`，關閉時會輸出 `1`。使用主機網路時，這些是主機的設定。 |
| `Address family not supported by protocol` | 核心以 `ipv6.disable=1` 開機，因此這台機器完全沒有 IPv6。請從核心命令列中移除它並重新開機，或在另一台機器上執行探測器。 |

在每種情況下都沒有傳送任何內容到目標，因此探測器無法判斷它是否正常。檢查仍會失敗，但 Ping 監測器的失敗原因會指出是探測器的問題，而不是說目標沒有回應：

```text
This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.
```

隨失敗一起記錄的網路路徑會顯示 `Traceroute could not run: this probe cannot send IPv6 traffic (...)`。請修好探測器的網路，或把監測器移到有 IPv6 的探測器上。

### 不使用主機網路時的 IPv6

如果無法使用主機網路，請把探測器接到開啟了 IPv6 的 Docker 網路。主機本身仍然需要 IPv6。

```bash
docker network create --ipv6 oneuptime-probe-ipv6
docker run --name oneuptime-probe --network oneuptime-probe-ipv6 -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Docker Engine 27 及更新版本會為該網路選擇一個 IPv6 子網路，並把探測器的對外 IPv6 偽裝在主機位址之後。較舊的版本需要明確的 IPv6 子網路（例如 `docker network create --ipv6 --subnet fd00:0:0:1::/64 oneuptime-probe-ipv6`），以及 `/etc/docker/daemon.json` 中的 `"ip6tables": true` 和 `"experimental": true`。使用 Docker Compose 時，請移除 `network_mode: host`，並在探測器的網路上設定 `enable_ipv6: true`。

## 探索掃描中的 NetBIOS 名稱查詢

開啟了 **查詢 Windows 名稱（NetBIOS）** 的 [網路探索掃描](/docs/monitor/network-device-monitor) 會從探測器向每台沒有 SNMP 系統名稱的主機傳送 NetBIOS 名稱查詢（NBSTAT）。對於使用它的掃描，請允許以下流量：

- **查詢哪些主機：** 既沒有 SNMP 系統名稱也沒有反向 DNS 名稱（PTR）的已探索主機，且只查詢私有位址（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`）或電信級 NAT 位址（`100.64.0.0/10`）。永遠不會查詢公開位址；如果從探測器進行的反向 DNS 查詢傳回了名稱，也不會向該主機傳送查詢。反向查詢失敗、逾時，或因查詢時間預算用完而被略過的主機，即使有 PTR 記錄，仍可能被查詢。
- **對外：** 從探測器上一個臨時（隨機、高編號）來源連接埠送往這些主機 UDP 連接埠 137 的 UDP。上面的 Proxy 設定不適用於它。
- **對內：** 從每台主機的 UDP 連接埠 137 回到該臨時連接埠的回應。具狀態的防火牆會自動放行。沒有回應時，這些主機仍以 IP 位址命名。

此查詢不需要額外的容器 capability，在 Kubernetes Pod 網路中也能運作。每次掃描最多查詢 2,000 台主機（`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` 可提高到 4,000），對未回應的主機再傳送一次查詢，以每秒約 100 個的速度傳送查詢，並在依此工作量決定的時間限制處停止 - 完整查詢 2,000 台主機約需 54 秒，任何情況下都不超過兩分鐘。無論掃描如何設定，全域探測器都不會傳送 NetBIOS 查詢，所以需要 NetBIOS 名稱的掃描請從自訂探測器執行。新掃描預設開啟此選項。對大量主機傳送 NBSTAT 查詢可能觸發入侵偵測規則，因此在意這一點的網路上請關閉它，或事先告知你的資安團隊。

## 環境變數

探測器在啟動時從環境中讀取設定：修改後請重新啟動探測器。探測器無法讀取的數字，或超出變數允許範圍的數字，會被忽略並改用預設值；封包擷取的上限則會被調整到其範圍之內。

### 必填

| 變數 | 說明 |
| --- | --- |
| `PROBE_KEY` | 探測器的金鑰，來自 **顯示 ID 和金鑰** 。沒有它，探測器在啟動時就會停止。 |
| `PROBE_ID` | 探測器的 ID，來自 **顯示 ID 和金鑰** 。沒有它，探測器在啟動時就會停止。 |
| `ONEUPTIME_URL` | OneUptime 的位置：`https://oneuptime.com`，或你自己安裝的網址。沒有它，探測器在啟動時就會停止。 |

### 檢查監測器

| 變數 | 預設值 | 作用 |
| --- | --- | --- |
| `PROBE_MONITORING_WORKERS` | `1` | 探測器同時檢查的監測器批次數。 |
| `PROBE_MONITOR_FETCH_LIMIT` | `10` | 一個批次中的監測器數量。 |
| `PROBE_MONITOR_RETRY_LIMIT` | `3` | 監測器檢查首次失敗後的重試次數，在步驟沒有設定自己的重試次數時使用，因此最多嘗試 4 次。`0` 會關閉重試。 |
| `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` | `900000` | 檢查一個監測器的期限，超過後放棄本次檢查並在下一個週期重試。提高合成指令碼逾時時，預設值也會隨之增加，因此指令碼永遠不會被中途截斷。 |
| `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | 合成監測器指令碼的逾時時間，單位為毫秒。 |
| `PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED` | `false` | 設為 `true` 後，合成監測器中的 Chromium 會在它自己的沙箱中執行。只有在探測器的容器使用允許沙箱的 seccomp 設定檔（例如 Playwright 的設定檔）執行時才開啟它：沒有這樣的設定檔，Chromium 無法啟動。關閉時，探測器會在啟動時記錄一則警告。 |
| `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Custom Code 監測器指令碼的逾時時間，單位為毫秒。 |
| `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` | `false` | 設為 `true` 後，此探測器上的 Website、API、External Status Page 和 Custom Code 監測器可以連到私有位址。請參閱 [私有網路存取](/docs/self-hosted/private-network-access)。 |
| `PROBE_NETWORK_DEVICE_POLL_CONCURRENCY` | `25` | 探測器同時輪詢的網路裝置數量。輪詢裝置很多的探測器可以調高它。 |

合成監測器執行時的限制（同時執行的數量、記憶體和磁碟）請見 [合成監控](/docs/monitor/synthetic-monitor) 頁面。

### 與 OneUptime 通訊

| 變數 | 預設值 | 作用 |
| --- | --- | --- |
| `HTTP_PROXY_URL`、`HTTPS_PROXY_URL`、`NO_PROXY` | 無 | Proxy 設定：請參閱 [透過 Proxy 連線](#透過-proxy-連線)。 |
| `PROBE_API_REQUEST_TIMEOUT_IN_MS` | `45000` | 探測器送往 OneUptime 的每個請求的期限。 |
| `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` | `10000` | 送往 OneUptime 的請求慢於此值時記錄警告。 |

### 網路探索

| 變數 | 預設值 | 作用 |
| --- | --- | --- |
| `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` | `5400000`（90 分鐘） | 一輪網路探索掃描的期限，超過後放棄，並將掃描回報為失敗。 |
| `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` | `30000` | 進行中的探索掃描上傳已找到主機的頻率，讓長時間的掃描也能顯示進度，其設備也能在掃描完成前匯入。最小值 `5000`。 |
| `PROBE_DISCOVERY_SCAN_CONCURRENCY` | `0` | 一輪探索掃描同時探測的位址數量（固定值）。不設定（或設為 `0`）時，會依掃描目標自動決定；除非探測器容器特別小或特別大，這正是你需要的。 |
| `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` | `0` | 為掃描找到的主機查詢反向 DNS 名稱（PTR）的時間限制，單位為毫秒。見下文。 |
| `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` | `0` | 一次掃描的 NetBIOS 查詢最多可詢問的主機數。見下文。 |
| `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` | `4` | 此探測器上同時執行的獨立探索掃描的最大數量，範圍 1 到 16。見下文。 |

`PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS`：不設定（或設為 `0`）時，依主機數量決定限制：約 860 台主機以內為 60 秒，隨主機數增加，最多 10 分鐘。可設為 1000 到 1200000。查詢未能及時涵蓋的主機不會取得反向 DNS 名稱（除非 SNMP 或 NetBIOS 為其命名，否則依 IP 位址列出），掃描的狀態訊息會說明遺漏了多少。逾時或失敗的查詢會在限制內重試一次，並依序詢問探測器的每個名稱伺服器。對於位在慢速 DNS 伺服器後的大型網路，請調高此值。

`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS`：對於開啟了 NetBIOS 名稱的掃描，查詢會詢問每台沒有 SNMP 系統名稱的主機，沒有反向 DNS 名稱的主機優先。不設定（或設為 `0`）時維持內建上限 2,000；可設為 1 到 4000。超出上限的主機不會被詢問，掃描的狀態訊息會說明數量。調高它也會延長查詢時間（時間限制據此決定：4,000 台主機約 104 秒），並在網路上傳送更多 NBSTAT 資料包，而入侵偵測規則會留意這些資料包。

`PROBE_DISCOVERY_MAX_CONCURRENT_SCANS`：只要還有容量，探測器每分鐘會檢查是否有其他待處理的掃描，因此一個長時間的掃描不會阻塞其他所有掃描。所有位置都被佔用時，其他掃描會保持待處理，直到有位置空出。每個掃描都有自己的主機並行數，因此資源用量會隨這兩個設定成長；對於小型容器，請降低其中任一限制。設為 1 時掃描會依序逐一執行。

在把自訂探測器升級為使用並行探索之前，請先升級 OneUptime 伺服器。伺服器必須能排除探測器仍在執行的掃描，這樣編輯執行中的掃描時，其新設定才能安全地排入佇列。將升級後的探測器連線到舊伺服器時，請在伺服器升級之前設定 `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1`。

### 封包擷取

| 變數 | 預設值 | 作用 |
| --- | --- | --- |
| `PROBE_PACKET_CAPTURE_ENABLED` | 關閉 | 設為 `true` 後，擁有權限的人可以從儀表板在此探測器上啟動封包擷取。擷取還需要主機網路和 `NET_RAW` capability。請參閱 [封包擷取](/docs/probe/packet-capture)。 |
| `PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS` | `1800` | 此探測器執行的最長封包擷取，範圍 5 到 1800。 |
| `PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB` | `25` | 此探測器產生的最大擷取檔案，範圍 1 到 25。 |

### 探測器監聽的內容

除非你開啟某個監聽器，或保留預設開啟的監聽器，否則探測器只會建立對外連線：

| 監聽器 | 設定 | 預設值 | 了解更多 |
| --- | --- | --- | --- |
| 傳入請求和心跳 | `PROBE_INGRESS_PORT` | 關閉 | [傳入請求 Ingress](/docs/probe/incoming-request-ingress) |
| SNMP Trap | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | 開啟，UDP 162 | [網路設備監控](/docs/monitor/network-device-monitor) |
| Syslog | `PROBE_SYSLOG_RECEIVER_ENABLED` | 關閉，UDP 5140 | [網路設備廠商指南](/docs/monitor/network-vendor-guides) |
| NetFlow、IPFIX 和 sFlow | `PROBE_NETFLOW_RECEIVER_ENABLED` | 開啟，UDP 2055、4739 和 6343 | [網路流量](/docs/monitor/network-traffic) |
| 健康檢查 | `PORT` | 開啟，TCP 3874 | `/status/live` 和 `/status/ready` |

在容器中，只有使用主機網路或發佈連接埠時，其他機器才能連到該連接埠。

Syslog 接收器每分鐘最多轉送 `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` 則訊息，預設 `600` 則，捨棄其餘的訊息，並記錄捨棄了多少則。

`PROBE_NAME` 和 `PROBE_DESCRIPTION` 只由使用 `REGISTER_PROBE_KEY` 自行註冊的探測器讀取，例如自行託管的安裝為所有專案執行的探測器。自訂探測器的名稱和描述取自儀表板。

## 疑難排解

### 診斷已中斷的探測器

當探測器送往 OneUptime 的請求不再成功時，探測器會被標記為 `Disconnected`。探測器的記錄會說明每個失敗請求卡在哪裡，因此很少需要猜測。

:::steps
#### 閱讀啟動時印出的環境資訊區塊

每個探測器啟動時都會印出一個 JSON 區塊，包含它使用的 OneUptime 網址、請求期限、Proxy 設定、繼承的 DNS 解析器、Node 和作業系統版本，以及是否關閉了 TLS 驗證。回報問題時請附上這個區塊。

#### 找到失敗報告

每個送往 OneUptime 的失敗請求都會記錄一個包含 `stalledAt` 和 `whatThisMeans` 的區塊。`stalledAt` 是請求始終沒能通過的階段：

| `stalledAt` | 意義 |
| --- | --- |
| `SocketAssignment` | 沒有任何東西離開這台機器。通訊端集區已滿，或設定的 Proxy 始終沒有建立 CONNECT 通道。 |
| `TcpConnect` | 機器送出了 SYN，卻沒有收到任何回應：防火牆或資安設備正在丟棄封包，或主機無法連線。 |
| `TlsHandshake` | TCP 已連線，TLS 始終沒有完成。通常是檢查 TLS 的中間設備所致。 |
| `RequestSend` | 已連線，但請求始終沒有完整寫出：對方停止了讀取。 |
| `WaitingForServerResponse` | 請求已送達，伺服器卻沒有傳回任何內容。 **探測器的網路沒有問題** ：請檢查 OneUptime 伺服器、它的負載平衡器和反向 Proxy。 |
| `ResponseBody` | 伺服器開始回應，卻在中途停住了。 |

同一個區塊也會回報 `deadlineOverrunInMs`。如果 45000ms 的期限在實際時間上用了遠超過 45000ms，表示是探測器處理程序本身被阻塞了：在排查網路之前，請先檢查區塊中的 `probeProcess.eventLoopMaxDriftInMs`。

#### 閱讀連線自我測試

連續失敗三次後，探測器會逐層測試同一台伺服器（依序為 DNS、TCP、TLS，然後是一次真實的 HTTP 往返），並記錄每個階段及其耗時。第一個失敗的階段就是答案。設定了 Proxy 時，探測器測試的是到 Proxy 的那一段，因為那是它實際經過的唯一一段。此測試最多每五分鐘執行一次。

#### 在請求失敗之前留意慢速請求

成功但耗時超過 `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` 的請求會連同耗時一起記錄。開始記錄 20 秒請求的探測器，正在逼近 45 秒的期限。
:::

在 OneUptime 伺服器端，回應緩慢的探測器請求，或在傳送回應前探測器已放棄的請求，也會連同探測器的 id 一起被記錄。把這兩份記錄放在一起，就能看出問題出在連線的哪一端。

### 其他問題

:::details 探測器啟動後立即停止
它的記錄會說明缺少什麼：`PROBE_KEY is not set`、`PROBE_INGEST_URL or ONEUPTIME_URL is not set` 或 `PROBE_ID or REGISTER_PROBE_KEY should be set`。如果三者都已設定，但 ID 和金鑰與任何探測器都不符合，探測器會每隔 30 秒嘗試一次，共 10 次，然後以 `Unable to register probe after 10 attempts` 停止。請用 **顯示 ID 和金鑰** 重新複製 ID 和金鑰。
:::

:::details 探測器一直正常，直到有人重設了它的金鑰
探測器頁面上的 **重設探測器金鑰** 會產生新金鑰，舊金鑰立即失效。用 **顯示 ID 和金鑰** 複製新金鑰，把它設為 `PROBE_KEY`，然後重新啟動探測器。
:::

:::details 監測器提示無法連到私有位址
在你允許之前，探測器會拒絕私有位址。在探測器上設定 `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` 並重新啟動它：請參閱 [私有網路存取](/docs/self-hosted/private-network-access)。
:::

如果問題仍未解決，請在 [GitHub](https://github.com/oneuptime/oneuptime) 上建立 issue，或 [聯絡支援](https://oneuptime.com/support)。

## 後續步驟

:::cards
- [建立監測器](/docs/monitor/create-monitor): 選擇要檢查的內容，以及由哪些探測器檢查。
- [傳入請求 Ingress](/docs/probe/incoming-request-ingress): 讓無法連上網際網路的服務透過探測器傳送心跳。
- [封包擷取](/docs/probe/packet-capture): 從儀表板擷取探測器看到的流量。
- [私有網路存取](/docs/self-hosted/private-network-access): 讓探測器檢查私有位址。
:::
