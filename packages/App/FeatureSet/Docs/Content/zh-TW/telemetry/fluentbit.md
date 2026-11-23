# Fluent Bit

[Fluent Bit](https://docs.fluentbit.io/manual) 是一個輕量級代理程式，可以從檔案、systemd、容器、syslog、HTTP 以及許多其他來源收集日誌。它的 [OpenTelemetry 輸出](https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry)會把收集到的資料傳送到 OneUptime 的 OpenTelemetry（OTLP）端點，之後就能在 **產品 → 日誌** 中搜尋這些日誌。

:::cards
- [設定 Fluent Bit](#設定-fluent-bit): 加入 OpenTelemetry 輸出並為服務命名。
- [完整範例](#完整範例): 一份可以直接上手的完整設定檔。
- [自行託管的 OneUptime](#自行託管的-oneuptime): 讓 Fluent Bit 傳送到你自己的執行個體。
:::

## 運作方式

```mermaid title="從 Fluent Bit 到 OneUptime"
flowchart TB
    sources["檔案、容器、syslog、HTTP"] --> inputs["Fluent Bit 輸入"]
    inputs --> envelope["opentelemetry_envelope 處理器"]
    envelope --> name["content_modifier 設定 service.name"]
    name --> output["opentelemetry 輸出"]
    output -->|"OTLP/HTTP + 擷取金鑰"| oneuptime["OneUptime /otlp/v1/logs"]
    oneuptime --> logs["日誌"]
```

Fluent Bit 會把每筆記錄包進一個 OpenTelemetry 信封，使其能夠攜帶 `service.name` 這類資源屬性。接著 OpenTelemetry 輸出會把記錄傳送到 OneUptime，並在 `x-oneuptime-token` 標頭中帶上你的擷取金鑰。OneUptime 會把它們歸到 `service.name` 指定的服務下，並在第一次傳送時建立該服務。

## 開始之前

- **安裝 Fluent Bit**：請參閱[安裝指南](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)。本頁的設定使用 Fluent Bit 的 YAML 格式與 `opentelemetry_envelope` 處理器，因此請使用較新的版本。
- **一個 OneUptime 專案。** 在 OneUptime Cloud 上，遙測資料依擷取的 GB 計費（請參閱[價格](https://oneuptime.com/pricing)），而且 Free 方案的專案必須先新增付款方式才能傳送遙測資料。
- **一個遙測擷取金鑰。** 如果還沒有，請依下列步驟建立：

:::steps
### 開啟擷取金鑰

前往 **產品 → 專案設定**，在側邊選單中展開 **遙測與 APM**，然後選擇 **擷取金鑰**。

![「擷取金鑰」清單，「建立擷取金鑰」已框出](screen:ingestion-keys)

### 建立金鑰

點選 **建立擷取金鑰**。對話框已經填好金鑰名稱，並選好 **伺服器**（應用程式或 Collector 傳送資料時使用的金鑰類型），因此直接點選 **建立擷取金鑰** 即可建立，也可以先重新命名。

### 複製機密

新金鑰會在自己的頁面中開啟。複製它的 **密鑰金鑰**：這就是下方設定中的 `YOUR_TELEMETRY_INGESTION_TOKEN`。

![顯示密鑰金鑰的遙測擷取金鑰頁面](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## 設定 Fluent Bit

Fluent Bit 會從 `/etc/fluent-bit/fluent-bit.yaml` 這類檔案讀取 YAML 設定。

:::steps
### 加入 OpenTelemetry 輸出

加入一個傳送到 OneUptime 的 `opentelemetry` 輸出。如果想在本機查看記錄，測試期間可以保留 `stdout` 輸出：

```yaml title="fluent-bit.yaml"
service:
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`retry_limit: 8640` 會在 OneUptime 忙碌（`429`）或正在重新啟動（`502`、`503`、`504`）時重新傳送一個區塊，大約每 30 秒一次（`scheduler.base` 和 `scheduler.cap`），持續約 72 小時；Fluent Bit 預設只再試一次，然後丟棄它。`storage.path` 把尚未傳送的區塊保存在磁碟上，因此重新啟動 Fluent Bit 不會遺失其中任何一個，這適用於每個設定了 `storage.type: filesystem` 的輸入，如下一步所示。Fluent Bit 必須能寫入該資料夾：套件的服務以 root 身分執行，手動執行時請用 `sudo`。`storage.total_limit_size: 512M` 為該輸出最多保存 512 MB；滿了之後，最早的區塊會被丟棄。

### 把日誌包進 OpenTelemetry 信封並為服務命名

為每個輸入加入 `opentelemetry_envelope` 處理器，後面再接一個設定 `service.name` 的 `content_modifier`。把 `YOUR_SERVICE_NAME` 換成日誌在 OneUptime 中要顯示的名稱：

```yaml title="fluent-bit.yaml"
pipeline:
  inputs:
    - name: tail # or any other input
      path: /var/log/my-app/*.log
      # Keep its place in each file, so a restart reads on from there
      db: /var/lib/fluent-bit/tail.db
      # Keep its chunks on disk until OneUptime takes them
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME
```

`db` 記住 tail 在每個檔案中的位置，因此重新啟動後會從那裡接著讀；沒有它，Fluent Bit 會從每個檔案的結尾重新開始，停機期間寫入的行永遠不會傳送。`storage.type: filesystem` 把輸入的區塊保存在 `storage.path` 中。

### 重新啟動 Fluent Bit

`fluent-bit` 套件的服務讀取的是套件內附的範例 `/etc/fluent-bit/fluent-bit.conf`，而不是這個檔案。用一個 drop-in 讓它改讀 `/etc/fluent-bit/fluent-bit.yaml`，然後讓它現在啟動，並在每次開機時啟動：

```bash
sudo mkdir -p /etc/systemd/system/fluent-bit.service.d
printf '[Service]\nExecStart=\nExecStart=/opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml\n' | sudo tee /etc/systemd/system/fluent-bit.service.d/fluent-bit-yaml.conf
sudo systemctl daemon-reload
sudo systemctl enable fluent-bit
sudo systemctl restart fluent-bit
```

空的 `ExecStart=` 會清掉套件內附的啟動行。若要先在前景試一試這個檔案，請執行 `sudo /opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml`：套件把程式放在 `/opt/fluent-bit/bin`，它不在 `PATH` 中。幾秒內，日誌就會出現在 **產品 → 日誌** 中，服務也會列在 **產品 → 服務** 下。
:::

## 完整範例

這份設定在連接埠 `8888` 上透過 HTTP 只接收來自本主機的日誌，並轉送到 OneUptime：

```yaml title="fluent-bit.yaml"
service:
  flush: 1
  log_level: info
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  inputs:
    - name: http
      # This host alone may send here
      listen: 127.0.0.1
      port: 8888
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME

  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`listen: 127.0.0.1` 只接收來自本主機的日誌：`http` 輸入不要求任何金鑰，所以使用 `listen: 0.0.0.0` 時，任何能連到該連接埠的人都可以用你的擷取金鑰向 OneUptime 傳送日誌。把 `http` 輸入換成你需要的輸入，例如日誌檔案用 `tail`、journal 用 `systemd`，並在每個輸入上保留這兩個處理器和 `storage.type: filesystem`。

## 用 HTTP 輸出傳送

Fluent Bit 的 [HTTP 輸出](https://docs.fluentbit.io/manual/pipeline/outputs/http)也可以傳送到 OneUptime 的 Fluentd 端點，它會依照 [Fluentd 頁面](/docs/telemetry/fluentd)說明的方式讀取每筆記錄。把 `format` 設為 `json_lines`（如下所示）或 `json`：OneUptime 兩者都能讀取，無論是否用 `compress: gzip` 壓縮。Fluent Bit 的預設格式 `msgpack` 會被拒絕。

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: http
      match: "*"
      host: "oneuptime.com"
      port: 443
      uri: "/fluentd/logs"
      format: json_lines
      # Send each record's time where OneUptime reads it
      json_date_key: timestamp
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
        - x-oneuptime-service-name YOUR_SERVICE_NAME
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## 自行託管的 OneUptime

把 `host` 設為你的 OneUptime 執行個體的主機。如果它透過一般 HTTP 而非 HTTPS 提供服務，也要把 `port` 設為它所監聽的連接埠（通常是 `80`），並移除 `tls`：

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "your-oneuptime-instance.com"
      port: 80
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## 疑難排解

:::details Fluent Bit 記錄了來自 OpenTelemetry 輸出的 `401`
擷取金鑰缺少、未知或已過期。檢查 `header` 這一行：它是 `x-oneuptime-token`、一個空格，接著是該金鑰的 **密鑰金鑰**。
:::

:::details Fluent Bit 記錄了 `402` 或 `422`
`402`：在 OneUptime Cloud 上，專案使用 Free 方案且沒有付款方式。請在 **專案設定 → 帳單與發票 → 帳單** 中新增。`422`：金鑰已停用，或是瀏覽器金鑰。請在金鑰的設定中重新開啟 **已啟用**，或建立一個 **伺服器** 金鑰。
:::

:::details 日誌歸到了意料之外的服務下
服務來自 `service.name`。檢查每個輸入是否都有 `opentelemetry_envelope` 處理器，並且後面接著設定它的 `content_modifier`。
:::

:::details 什麼都沒有收到，Fluent Bit 記錄了連線錯誤
檢查 HTTPS 端點是否設定了 `tls: On` 與 `port: 443`，以及執行 Fluent Bit 的主機能否透過該連接埠連到你的 OneUptime 主機。
:::

:::details Fluent Bit 記錄了 `cannot be retried`
Fluent Bit 丟棄了一個無法傳送的區塊。像上面的設定那樣設定 `retry_limit: 8640` 後，OneUptime 以 `429`、`502`、`503` 或 `504` 回應的區塊，會大約每 30 秒重新傳送一次，持續約 72 小時；使用 Fluent Bit 的預設值時，它只再試一次。`400`、`401`、`402`、`413`、`422` 或 `500` 會被立即丟棄，因為每次的回應都一樣：請檢查金鑰、方案和請求大小。
:::

如果對設定有任何問題或需要協助，請寄信至 support@oneuptime.com。

## 後續步驟

:::cards
- [日誌管道](/docs/telemetry/log-pipelines): 剖析並豐富 Fluent Bit 傳送的日誌。
- [搜尋語法](/docs/telemetry/search-syntax): 在日誌瀏覽器中尋找日誌。
- [OpenTelemetry](/docs/telemetry/open-telemetry): 所有遙測資料的端點、金鑰與限制。
- [Fluentd](/docs/telemetry/fluentd): 改用 Fluentd。
:::
