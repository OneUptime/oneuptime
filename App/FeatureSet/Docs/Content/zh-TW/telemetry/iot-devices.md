# OneUptime IoT 裝置

## 概觀

OneUptime 透過擷取標準的 OpenTelemetry (OTLP) 指標來監控 IoT 裝置機群 — 感測器、閘道器、控制器與邊緣裝置。每個裝置（或代表它的閘道器）會透過 OTLP HTTP 推送一小組 `iot_*` 指標，並標註它所屬的**機群（fleet）**以及自身的**裝置 id（device id）**。OneUptime 會將這些指標歸入一個機群，建立即時的裝置清單，並追蹤每個裝置的電池、連線狀態、溫度、CPU、記憶體與可用性。

裝置端不需要安裝任何代理程式 — 任何能夠使用 OTLP 的東西都可以運作（裝置上的 OpenTelemetry SDK，或在閘道器上執行、向多個裝置進行扇出的 OpenTelemetry Collector）。本頁是**擷取指南**。若要在你推送的資料之上設定 IoT 監控器與警示，請參閱 [IoT 裝置監控器](/docs/monitor/iot-device-monitor)。

## 先決條件

- 一個能夠將 OTLP/HTTP 傳送到 OneUptime 的裝置、閘道器或 collector
- 從裝置／閘道器到你的 OneUptime 執行個體之間的網路連通性
- 一個 **OneUptime 遙測擷取權杖（Telemetry Ingestion Token）** — 從 _Project Settings → Telemetry Ingestion Keys_ 建立一個，並複製 `x-oneuptime-token` 的值

## OneUptime 如何建模 IoT

OneUptime 使用 OpenTelemetry 資源屬性將你的裝置對應到兩個概念：

- **機群（Fleet）** — 裝置的邏輯群組（例如 `building-a-sensors` 或 `field-gateways`）。機群是從 `iot.fleet.name` 資源屬性衍生而來，並在 OneUptime 中以遙測服務 `iot/<fleet>` 的形式出現。請設定 `service.name=iot/<fleet>`，讓記錄與指標能對齊到同一個服務之下。
- **裝置（Device）** — 機群內的個別裝置，由 `device.id` 屬性識別。OneUptime 會以 `device.id` 為鍵，建立並維護每個機群的裝置清單。

選用屬性可進一步精細化每個裝置在監控器中的分類與範圍界定：

| 屬性                 | 必填     | 說明                                                                             |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `iot.fleet.name`     | 是       | 此裝置所屬的機群。會成為 OneUptime 服務 `iot/<fleet>`                            |
| `device.id`          | 是       | 機群內裝置的穩定、唯一 id                                                        |
| `iot.device.kind`    | 否       | 裝置類別 — 例如 `Device`、`Sensor` 或 `Gateway`。預設為 `Device`                |
| `iot.device.type`    | 否       | 較細緻的裝置類型／型號，用於篩選監控器（例如 `temp-sensor`）                      |
| `iot.device.firmware`| 否       | 裝置回報的韌體版本                                                              |

## 透過 OpenTelemetry SDK 傳送指標

如果你的裝置直接執行 OpenTelemetry SDK，請將它指向 OneUptime，並透過標準的 `OTEL_*` 環境變數標記 IoT 資源屬性。請將權杖、端點、機群名稱與裝置 id 替換為你環境中的值。

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
```

| 環境變數                      | 必填     | 說明                                                                                                 |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 是       | OneUptime OTLP 端點（`https://oneuptime.com/otlp`，或自我託管的 `http(s)://YOUR-ONEUPTIME-HOST/otlp`） |
| `OTEL_EXPORTER_OTLP_HEADERS`  | 是       | `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`                                                    |
| `OTEL_RESOURCE_ATTRIBUTES`    | 是       | 以逗號分隔的資源屬性。必須包含 `iot.fleet.name`、`device.id` 與 `service.name=iot/<fleet>`            |

請使用下方的 `iot_*` 名稱將你的讀數作為指標發送（參閱[指標慣例](#指標慣例)）。大約一分鐘內，裝置就會出現在 OneUptime 儀表板的 **IoT** 區段下。

## 透過 OpenTelemetry Collector 傳送指標

當許多裝置透過閘道器回報時，請在閘道器上執行一個 OpenTelemetry Collector 並匯出到 OneUptime。`resource` 處理器會標記機群屬性；從你的裝置接收讀數（OTLP、MQTT 橋接、檔案記錄等）並將它們轉送出去：

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: iot.fleet.name
        value: field-gateways
        action: upsert
      - key: service.name
        value: iot/field-gateways
        action: upsert

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # OneUptime 需要 JSON 編碼器，而非預設的 Proto(buf)
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp]
```

- **`resource`** 會為每筆記錄標記機群屬性。請為每個閘道器設定 `iot.fleet.name`（以及相符的 `service.name=iot/<fleet>`），讓每個閘道器的裝置落入正確的機群。
- 請在每個資料點上保留 `device.id`（以及選用的 `iot.device.kind` / `iot.device.type` / `iot.device.firmware`），讓 OneUptime 能解析出機群內的個別裝置。
- **`otlphttp`** 會透過 HTTPS 並附帶擷取權杖傳送到 OneUptime。請注意 `encoding: json` 與 `Content-Type: application/json` 標頭為必填。

## 透過 MQTT 傳送指標

OneUptime 內建了 MQTT 端點，因此已經會使用 MQTT 的裝置可以直接推送讀數 — 不需要 OpenTelemetry SDK、collector 或橋接。透過 MQTT 發布的一切都會進入與 OTLP 相同的管線：機群會自動建立、裝置清單會更新，而且每個 IoT 監控器與警示範本都能原封不動地運作。

**端點**

| 傳輸方式              | 位址                                    | 備註                                                                                     |
| --------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------- |
| MQTT over WebSocket   | `wss://<your-host>/mqtt`                | 適用於所有部署 — 透過 OneUptime ingress 走一般的 HTTPS 連接埠                            |
| MQTT over TCP         | `<app-host>:1883`（`MQTT_INGEST_PORT`） | 自我託管：預設僅限叢集／compose 網路內部；若有需要請自行對外開放                          |

**驗證** — 有兩種選項：

- **專案層級**：將你的**遙測擷取權杖**作為 MQTT 密碼傳送（使用者名稱會被忽略；如果你的用戶端只提供使用者名稱欄位，請改將權杖放在那裡）。適合代表多個裝置發布的閘道器。
- **個別裝置層級**（建議直接連線的裝置採用）：在儀表板中該機群的 **Device Registry** 分頁下註冊裝置。註冊會發給每個裝置一組憑證 — 憑證 ID 即 MQTT **使用者名稱**，密鑰即**密碼**。以裝置身分驗證的用戶端只能在自己的 `oneuptime/<fleet>/<device>/…` 主題下發布；單一遭入侵的裝置可從儀表板撤銷，而不影響機群的其餘部分（撤銷大約在一分鐘內生效，即使是已連線的工作階段也一樣）；而且已註冊的裝置具備**無聲死亡離線偵測（silent-death offline detection）**：當它們停止回報時，會以 Offline 狀態留在清單中而不會消失，且即使裝置在沒有 Last Will 的情況下死亡，**Device Offline** 警示範本仍會為它們觸發。

無效的憑證會在 CONNECT 時以回應碼 4（使用者名稱或密碼錯誤）被拒絕，因此設定錯誤的裝置會明確地失敗。

**主題** — 請在固定的 `oneuptime/` 前綴下發布。機群與裝置區段不得包含 `/`、`+` 或 `#`，且長度限制為 100 個字元：

| 主題                                             | 酬載                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `oneuptime/<fleet>/<device>/telemetry`           | 讀數的 JSON 物件 — `{ "metrics": { "iot_temperature_celsius": 21.5 } }`，或一個以數值欄位作為指標的扁平物件 |
| `oneuptime/<fleet>/<device>/metrics/<metricName>`| 單一值 — 一個裸數字（`23.4`）或 `{ "value": 23.4 }`                                                   |
| `oneuptime/<fleet>/<device>/status`              | `"online"` 或 `"offline"`（也接受 `1`/`0`、`true`/`false`、`up`/`down`） — 對應到 `iot_device_up`     |

遙測酬載也可以攜帶 `"attributes"`（一個會標記在每個資料點上的字串對應表 — 可用於 `iot.device.kind`、`iot.device.type`、`iot.device.firmware` 或你自己的標籤）與 `"timestamp"`（ISO-8601，或 unix 秒／毫秒）。兩者皆為選用；當 `timestamp` 不存在時，會使用擷取時間。

**使用 Last Will 進行離線偵測** — 在 `oneuptime/<fleet>/<device>/status` 上註冊一個酬載為 `offline` 的 MQTT Last Will。如果裝置死亡或從網路上掉線，broker 會在工作階段結束的當下代替它發布 `iot_device_up = 0` — 這會觸發內建的 **Device Offline** 警示範本，並將裝置在清單中翻轉為下線，不需要輪詢，也不必等待錯過的抓取。連線之後請向同一個主題發布 `online`，讓裝置再次顯示為上線。

使用 `mosquitto_pub` 的範例（原始 TCP，自我託管）：

```bash
mosquitto_pub -h YOUR-ONEUPTIME-APP-HOST -p 1883 \
  -u oneuptime -P "YOUR_TELEMETRY_INGESTION_TOKEN" \
  -t "oneuptime/building-a-sensors/sensor-001/telemetry" \
  -m '{"metrics":{"iot_device_up":1,"iot_battery_percent":87,"iot_temperature_celsius":21.5},"attributes":{"iot.device.type":"temp-sensor","iot.device.firmware":"1.4.2"}}'
```

使用 Node.js `mqtt` 透過 WebSocket 的範例（可對 oneuptime.com 以及任何自我託管的執行個體運作）：

```javascript
const mqtt = require("mqtt");

const client = mqtt.connect("wss://oneuptime.com/mqtt", {
  username: "oneuptime", // 會被忽略 — 進行驗證的是下方的權杖
  password: "YOUR_TELEMETRY_INGESTION_TOKEN",
  will: {
    topic: "oneuptime/building-a-sensors/sensor-001/status",
    payload: "offline",
  },
});

client.on("connect", () => {
  client.publish("oneuptime/building-a-sensors/sensor-001/status", "online");
  setInterval(() => {
    client.publish(
      "oneuptime/building-a-sensors/sensor-001/telemetry",
      JSON.stringify({
        metrics: {
          iot_device_up: 1,
          iot_battery_percent: readBattery(),
          iot_temperature_celsius: readTemperature(),
        },
      }),
    );
  }, 60 * 1000);
});
```

使用 Python `paho-mqtt` 透過 WebSocket 的範例：

```python
import json
import paho.mqtt.client as mqtt

client = mqtt.Client(transport="websockets")
client.username_pw_set("oneuptime", "YOUR_TELEMETRY_INGESTION_TOKEN")
client.tls_set()
client.will_set("oneuptime/building-a-sensors/sensor-001/status", "offline")
client.ws_set_options(path="/mqtt")
client.connect("oneuptime.com", 443)

client.publish("oneuptime/building-a-sensors/sensor-001/status", "online")
client.publish(
    "oneuptime/building-a-sensors/sensor-001/telemetry",
    json.dumps({"metrics": {"iot_device_up": 1, "iot_temperature_celsius": 21.5}}),
)
```

注意事項：

- 此端點**僅供擷取**：訂閱會被拒絕（SUBACK 失敗）。如果你希望 broker 確認收到，請使用 QoS 1。擷取為**至少一次（at-least-once）** — 在確認遺失之後的 QoS 1/2 重傳可能會產生重複的資料點。
- 在主題約定之外發布，或是酬載格式錯誤的發布，會被接受並**丟棄**（MQTT 3.1.1 沒有針對單一訊息的錯誤回覆） — 伺服器會記錄一則含有原因的警告，因此若資料未送達，請檢查 OneUptime 應用程式記錄。
- 在 WebSocket 端點上，請將 MQTT keepalive 保持在 **5 分鐘以內** — OneUptime ingress 會在 300 秒後關閉閒置的 WebSocket 連線，這會觸發你的 Last Will 以及一則錯誤的 Device Offline 警示。用戶端函式庫的預設值（`mqtt` 與 `paho-mqtt` 皆為 60 秒）沒有問題。原始 TCP 端點則沒有這樣的上限。
- 酬載上限為每次發布 128 KB 與 100 個指標；過大的封包會中斷連線。

## 指標慣例

OneUptime 可辨識下列 `iot_*` 指標名稱。每個資料點都應帶有 `device.id` 標籤，讓讀數歸屬於正確的裝置。你只需要傳送對你的裝置有意義的指標 — 缺少的指標單純不會繪製成圖表。

| 指標名稱                    | 意義                                                                           |
| --------------------------- | ------------------------------------------------------------------------------ |
| `iot_device_up`             | 裝置可用性。`1` = 上線／可達，`0` = 下線。驅動 IoT 裝置監控器                  |
| `iot_device_info`           | 僅作識別用的訊號。攜帶 `device.id` / kind / type / firmware，讓裝置即使在尚未回報讀數之前也能出現在清單中 |
| `iot_battery_percent`       | 電池充電量，`0`–`100`（%）                                                     |
| `iot_signal_strength_dbm`   | 以 dBm 表示的無線訊號強度（例如 Wi-Fi / LoRa / 行動網路 RSSI）                  |
| `iot_temperature_celsius`   | 裝置或感測器溫度，以 °C 表示                                                   |
| `iot_cpu_usage_ratio`       | CPU 使用率，以 `0`–`1` 的比值表示（OneUptime 會以百分比儲存）                   |
| `iot_memory_usage_bytes`    | 目前已使用的記憶體，以 bytes 表示                                              |
| `iot_memory_size_bytes`     | 裝置上可用的記憶體總量，以 bytes 表示                                          |
| `iot_uptime_seconds`        | 裝置上次開機以來的秒數                                                         |

## 驗證安裝

1. 確認你的裝置或閘道器在匯出時沒有錯誤（檢查 SDK／collector 記錄是否有匯出失敗以及 HTTP `401`/`403` 回應）。
2. 在 OneUptime 儀表板中，開啟 **IoT** 區段 — 你的機群應在大約一分鐘內以 `iot/<fleet>` 的形式出現。
3. 開啟該機群的 **Devices** 分頁 — 你傳送的每個 `device.id` 都應列出，並顯示其最新的電池、訊號、溫度、CPU、記憶體與上線／下線狀態。
4. 開啟該機群下的 **Metrics**，以繪製上述任何 `iot_*` 序列的圖表。

## 疑難排解

### 機群未出現

1. 確認 `iot.fleet.name` 是設定為**資源（resource）**屬性（而非資料點標籤），並且 `service.name` 為 `iot/<fleet>`。
2. 確認匯出器端點為 `https://oneuptime.com/otlp`（或你自我託管的 `…/otlp`），且 `x-oneuptime-token` 標頭攜帶有效的權杖。
3. 如果使用 collector，請確保 `otlphttp` 匯出器上有設定 `encoding: json` 與 `Content-Type: application/json`。

### 裝置從清單中遺漏

1. 確認每個資料點都帶有 `device.id` 標籤 — 裝置是以它為鍵。
2. 對於尚未回報讀數的裝置，傳送 `iot_device_info`（僅作識別用），讓它們仍能出現在清單中。
3. 檢查 `device.id` 的值在各次回報之間是否穩定；變動的 id 會產生重複的裝置列。

### 匯出器傳回 HTTP 401 / 403

擷取權杖無效、已撤銷或遺漏。請從 _Project Settings → Telemetry Ingestion Keys_ 產生一個新的，並更新 `x-oneuptime-token` 標頭。

### 指標未繪製成圖表

1. 確認你使用的是[指標慣例](#指標慣例)表格中完全一致的 `iot_*` 指標名稱 — 無法辨識的名稱會被儲存為一般指標，且不會填入 IoT 圖表。
2. 請記得 `iot_cpu_usage_ratio` 是 `0`–`1` 的比值；傳送原始比值，OneUptime 會將它以百分比呈現。
3. 裝置開始回報後，請預留最多一分鐘讓第一批資料點浮現。

## 自我託管的 OneUptime

如果你正在自我託管 OneUptime，請將端點指向你自己的執行個體：

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://your-oneuptime-host.example.com/otlp
```

或者，在 collector 中：

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

如果你的執行個體僅支援 HTTP，請將協定改為 `http://` 並使用適當的連接埠。

## 後續步驟

- 設定一個 **IoT 裝置監控器**，以在裝置離線、電池電量低、訊號微弱、溫度過高與 CPU 過高等情況下發出警示 — 請參閱 [IoT 裝置監控器](/docs/monitor/iot-device-monitor)。
- 對於非容器化的主機（Linux / macOS / Windows VM 與裸機），請使用[主機 OpenTelemetry Collector](/docs/telemetry/host-otel-collector)。
- 若要深入了解底層的 OTLP 整合，請參閱[將 OpenTelemetry 與 OneUptime 整合](/docs/telemetry/open-telemetry)。
