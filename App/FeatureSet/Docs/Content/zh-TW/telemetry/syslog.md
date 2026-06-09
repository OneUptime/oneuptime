# 將 Syslog 資料傳送至 OneUptime

## 概觀

OpenTelemetry Ingest 服務現在可接受原生 Syslog 酬載。您可以將任何相容於 RFC3164 或 RFC5424 的來源所產生的訊息，透過 HTTPS 直接轉送至 OneUptime。OneUptime 會先解析 syslog 的優先順序（priority）、設施（facility）、嚴重性（severity）、結構化資料以及訊息主體，然後將所有內容儲存為可搜尋的日誌。

## 先決條件

- **遙測擷取權杖（Telemetry Ingestion Token）** – 從 *Project Settings → Telemetry Ingestion Keys* 建立一個，並複製 `x-oneuptime-token` 的值。
- **Syslog 轉送器** – 任何能夠傳送 HTTP POST 請求的工具（例如 `curl`、透過 `omhttp` 的 `rsyslog`，或搭配 HTTP 目的地外掛的 `syslog-ng`）。
- **服務名稱（選填）** – 設定 `x-oneuptime-service-name` 標頭，可將傳入的日誌歸入特定的遙測服務。若省略此項，OneUptime 會改用 syslog 的 `APP-NAME`、主機名稱，或 `Syslog`。

## 端點

```
POST https://oneuptime.com/syslog/v1/logs
```

- 如果您是自行託管 OneUptime，請將 `oneuptime.com` 替換為您的主機。
- 請務必在請求中加入 `x-oneuptime-token` 標頭。

## 請求主體

傳送以換行分隔的 Syslog 字串，或包含 `messages` 陣列的 JSON 酬載。RFC3164（BSD）與 RFC5424 兩種格式皆支援。

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### 支援的內容類型

- `application/json` – 建議使用。
- `text/plain` – 以換行分隔的訊息。
- `application/octet-stream` – 原始酬載。也接受 Gzip 壓縮（`Content-Encoding: gzip`）。

## 使用 curl 快速測試

```bash
curl \
  -X POST https://oneuptime.com/syslog/v1/logs \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: YOUR_TELEMETRY_KEY" \
  -H "x-oneuptime-service-name: production-web" \
  -d '{
    "messages": [
      "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login"
    ]
  }'
```

## 從 rsyslog 轉送

1. 安裝 HTTP 輸出模組：
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. 將目的地附加至 `/etc/rsyslog.d/oneuptime.conf`：
   ```
   module(load="omhttp")

   template(name="OneUptimeJson" type="list") {
     constant(value="{\"messages\":[\"")
     property(name="rawmsg")
     constant(value="\"]}")
   }

   action(
     type="omhttp"
     server="oneuptime.com"
     serverport="443"
     usehttps="on"
     endpoint="/syslog/v1/logs"
     header="Content-Type: application/json"
     header="x-oneuptime-token: YOUR_TELEMETRY_KEY"
     header="x-oneuptime-service-name: rsyslog-demo"
     template="OneUptimeJson"
   )
   ```
3. 重新啟動 rsyslog：
   ```bash
   sudo systemctl restart rsyslog
   ```

## 我們已經看到的常見使用情境

### 1. 網路與安全設備

大多數網路設備仍然只透過 syslog 公開組態變更、ACL 命中與威脅偵測。將您現有的轉送器（Palo Alto、Fortinet、Cisco ASA、Juniper、pfSense 等）直接指向 OneUptime，或保留一個內部轉送器並透過 HTTPS 轉送：

```bash
# rsyslog snippet that batches messages into JSON and posts to OneUptime
module(load="omhttp")

template(name="OneUptimeJSON" type="list") {
  constant(value="{\"messages\":[\"")
  property(name="rawmsg")
  constant(value="\"]}")
}

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: perimeter-firewall"
  template="OneUptimeJSON"
)
```

### 2. Linux 伺服器與 cron 工作

許多 cron 工作與舊版常駐程式仍然僅透過 kernel/syslog 設施記錄日誌。轉送 `/var/log/syslog` 或 journald 項目，可將營運的線索集中保存在同一處。Systemd 主機可以依賴 journald → syslog 橋接：

```bash
# /etc/rsyslog.d/oneuptime.conf
module(load="imjournal" StateFile="imjournal.state")
module(load="omhttp")

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: linux-fleet"
  template="OneUptimeJSON"
)
```

由於我們會對應嚴重性代碼，您可以針對 `syslog.severity.name = "error"` 發出警示，或依 `syslog.hostname` 切分，以快速隔離產生大量訊息的主機。

### 3. Kubernetes ingress 控制器與邊緣節點

如果您已經在執行 Fluent Bit 或 Fluentd，請保留它們用於容器日誌，並為邊緣的主機或設備新增一個輕量的 syslog 接收端。Fluent Bit 的 `syslog` 輸入可與 HTTP 輸出搭配使用：

```ini
[INPUT]
    Name              syslog
    Mode              tcp
    Listen            0.0.0.0
    Port              5140

[OUTPUT]
    Name              http
    Match             *
    Host              oneuptime.com
    Port              443
    URI               /syslog/v1/logs
    Format            json
    json_date_key     time
    Header            Content-Type application/json
    Header            x-oneuptime-token <TOKEN>
    Header            x-oneuptime-service-name edge-ingress
    tls               On
```

這樣的設定讓您可以從裸機工作節點或硬體負載平衡器擷取 syslog，而不必另外建立一套日誌堆疊。

### 4. 無需等待的合規封存

需要為 PCI 或 SOX 保留防火牆日誌嗎？將它們直接傳送至 OneUptime，對該遙測服務套用長期保留政策，並從單一處匯出至冷儲存。不必再從多個 syslog 轉送器分別匯出。

## 已解析的屬性

OneUptime 會自動為每一筆日誌項目加入下列屬性：

- `syslog.priority`、`syslog.facility.code`、`syslog.facility.name`
- `syslog.severity.code`、`syslog.severity.name`
- `syslog.hostname`、`syslog.appName`、`syslog.processId`、`syslog.messageId`
- `syslog.structured.*`（攤平後的 RFC5424 結構化資料）
- `syslog.raw`（原始訊息，用於可追溯性）

這些屬性會在 Telemetry → Logs explorer 中變為可搜尋。

## 疑難排解

- **HTTP 401 或結果為空** – 請確認 `x-oneuptime-token` 標頭屬於正在接收日誌的專案。
- **沒有日誌出現** – 請確認請求主體確實包含 syslog 行。空白主體會以 HTTP 400 拒絕。
- **服務名稱不如預期** – 設定 `x-oneuptime-service-name` 以覆寫預設的偵測邏輯。
- **大量爆發** – 支援每個請求批次處理最多 1,000 行。更大量的爆發會排入佇列並以非同步方式處理。
