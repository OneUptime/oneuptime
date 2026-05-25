# 向 OneUptime 發送 Syslog 數據

## 概述

OpenTelemetry 數據攝取服務現在接受原生 Syslog 負載。您可以將來自任何兼容 RFC3164 或 RFC5424 的數據源的消息直接通過 HTTPS 轉發到 OneUptime。OneUptime 在儲存所有內容之前會解析 Syslog 優先級、設施、嚴重程度、結構化數據和消息正文，使其成爲可搜索的日誌。

## 前提條件

- **遙測攝取令牌** – 從 *項目設置 → 遙測攝取密鑰* 創建一個，並複製 `x-oneuptime-token` 值。
- **Syslog 轉發器** – 任何能夠發送 HTTP POST 請求的工具（例如 `curl`、通過 `omhttp` 的 `rsyslog`，或使用 HTTP 目標插件的 `syslog-ng`）。
- **服務名稱（可選）** – 設置 `x-oneuptime-service-name` 請求頭，將傳入日誌歸類到特定遙測服務下。省略時，OneUptime 回退到 Syslog `APP-NAME`、主機名或 `Syslog`。

## 端點

```
POST https://oneuptime.com/syslog/v1/logs
```

- 如果您是自託管 OneUptime，請將 `oneuptime.com` 替換爲您的主機。
- 請求中始終包含 `x-oneuptime-token` 請求頭。

## 請求體

發送以換行符分隔的 Syslog 字符串或包含 `messages` 數組的 JSON 負載。RFC3164（BSD）和 RFC5424 格式均受支持。

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### 支持的內容類型

- `application/json` – 推薦。
- `text/plain` – 換行符分隔的消息。
- `application/octet-stream` – 原始負載。也接受 Gzip 壓縮（`Content-Encoding: gzip`）。

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

## 從 rsyslog 轉發

1. 安裝 HTTP 輸出模塊：
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. 將目標配置追加到 `/etc/rsyslog.d/oneuptime.conf`：
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
3. 重啓 rsyslog：
   ```bash
   sudo systemctl restart rsyslog
   ```

## 我們已經看到的常見使用場景

### 1. 網絡和安全設備

大多數網絡設備仍然僅通過 Syslog 暴露配置更改、ACL 命中和威脅檢測信息。將您現有的中繼（Palo Alto、Fortinet、Cisco ASA、Juniper、pfSense 等）直接指向 OneUptime，或保持內部中繼並通過 HTTPS 轉發：

```bash
# rsyslog 片段，將消息批量打包成 JSON 並 POST 到 OneUptime
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

### 2. Linux 服務器和 Cron 作業

許多 Cron 作業和舊版守護進程仍然僅通過內核/syslog 設施記錄日誌。轉發 `/var/log/syslog` 或 journald 條目可以將操作記錄保存在一個地方。基於 Systemd 的主機可以依賴 journald → syslog 橋接：

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

由於我們映射了嚴重程度代碼，您可以對 `syslog.severity.name = "error"` 發出警報，或通過 `syslog.hostname` 切片以快速隔離噪聲較多的主機。

### 3. Kubernetes 入口控制器和邊緣節點

如果您已經運行 Fluent Bit 或 Fluentd，請保留它們用於容器日誌，併爲邊緣主機或設備添加輕量級 Syslog 接收器。Fluent Bit 的 `syslog` 輸入與 HTTP 輸出配合使用：

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

此設置允許您從裸金屬 Worker 或硬件負載均衡器攝取 Syslog，而無需創建另一個日誌記錄棧。

### 4. 無需等待的合規歸檔

需要爲 PCI 或 SOX 保留防火牆日誌？直接將它們發送到 OneUptime，對遙測服務應用長保留策略，並從一個地方導出到冷儲存。無需再從多個 Syslog 中繼導出。

## 解析的屬性

OneUptime 自動爲每條日誌條目添加以下屬性：

- `syslog.priority`、`syslog.facility.code`、`syslog.facility.name`
- `syslog.severity.code`、`syslog.severity.name`
- `syslog.hostname`、`syslog.appName`、`syslog.processId`、`syslog.messageId`
- `syslog.structured.*`（扁平化的 RFC5424 結構化數據）
- `syslog.raw`（原始消息，用於追溯）

這些屬性在遙測 → 日誌瀏覽器中變爲可搜索的內容。

## 故障排查

- **HTTP 401 或空結果** – 驗證 `x-oneuptime-token` 請求頭是否屬於接收日誌的項目。
- **日誌未出現** – 確認請求體實際包含 Syslog 行。空請求體將以 HTTP 400 被拒絕。
- **意外的服務名稱** – 設置 `x-oneuptime-service-name` 以覆蓋默認檢測邏輯。
- **大量突發請求** – 每個請求支持批量處理最多 1,000 行。更大的突發請求會排隊並異步處理。
