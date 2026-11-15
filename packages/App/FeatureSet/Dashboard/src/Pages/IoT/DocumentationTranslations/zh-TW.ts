import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in Traditional Chinese (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * Traditional Chinese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Traditional Chinese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "執行 OpenTelemetry SDK 並透過 HTTP 匯出 OTLP 的裝置",
  "Network access from the device to your OneUptime instance":
    "裝置到你的 OneUptime 執行個體的網路存取",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "將 `building-a-sensors` 和 `sensor-001` 換成你的裝置群名稱和裝置 id。請保持 `iot.fleet.name` 不變：變更它會註冊一個全新的裝置群。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在第 1 步中選擇一個擷取金鑰，以填入 `<YOUR_API_KEY>`。",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "將讀數以依照 `iot_*` 慣例命名的指標送出，並為每個資料點加上 `device.id` 屬性，例如：",
  "| Metric | Value | Datapoint attribute |": "| 指標 | 值 | 資料點屬性 |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "裝置清單以資料點的 `device.id` 為鍵，而不是資源的，所以除了在 `OTEL_RESOURCE_ATTRIBUTES` 中設定，也要在每次量測上設定它。所有可辨識的名稱都在「進階」中的 **指標慣例** 裡。",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. 確認裝置匯出時沒有錯誤：檢查 SDK 日誌中的匯出失敗以及 HTTP `401` 或 `422` 回應。",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. 在 OneUptime 儀表板中開啟 **IoT** 區段：你的裝置群應會在一分鐘左右出現。",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. 開啟裝置群的 **裝置** 索引標籤：你傳送的每個 `device.id` 都應會列出，並附上最新的電池、訊號、溫度、CPU、記憶體以及上線/離線狀態。",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. 開啟裝置群底下的 **指標**，為任一 `iot_*` 序列繪製圖表。",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "裝置上不需要安裝任何代理程式。OneUptime 使用 OpenTelemetry 屬性把你的裝置對應到兩個概念：",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **裝置群**：一組邏輯上的裝置（例如 `building-a-sensors` 或 `field-gateways`）。裝置群由資源屬性 `iot.fleet.name` 得出，並在 OneUptime 中顯示為遙測服務 `iot/<fleet>`。請設定 `service.name=iot/<fleet>`，讓日誌和指標歸在同一個服務底下。",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **裝置**：裝置群中的單一裝置，由每個資料點上的 `device.id` 屬性識別。OneUptime 會以 `device.id` 為鍵，為每個裝置群建立並維護裝置清單。",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "OneUptime 讀取的屬性；選用屬性用來細分每個裝置的分類以及在監視器中的範圍：",
  "| Attribute | Set on | Required | Description |":
    "| 屬性 | 設定位置 | 必填 | 說明 |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | 資源 | 是 | 此裝置所屬的裝置群。會成為 OneUptime 服務 `iot/<fleet>` |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | 每個資料點 | 是 | 裝置在裝置群內穩定且唯一的 id |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | 每個資料點 | 否 | 裝置類別，例如 `Device`、`Sensor` 或 `Gateway`。預設為 `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | 每個資料點 | 否 | 更細的裝置類型或型號，用來篩選監視器（例如 `temp-sensor`） |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | 每個資料點 | 否 | 裝置回報的韌體版本 |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime 可辨識下列 `iot_*` 指標名稱。每個資料點都應帶有 `device.id` 標籤，讀數才會歸到正確的裝置。你只需要傳送對你的裝置有意義的指標，缺少的指標只是不會繪製出來。",
  "| Metric Name | Meaning |": "| 指標名稱 | 意義 |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | 裝置可用性。`1` = 上線/可連線，`0` = 離線。驅動 IoT 裝置監視器 |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | 只含身分資訊的訊號。帶有 `device.id` / 類別 / 類型 / 韌體，讓裝置在回報讀數之前就出現在清單中 |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | 電池電量，`0`–`100`（%） |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | 無線訊號強度，單位 dBm（例如 Wi-Fi / LoRa / 行動網路 RSSI） |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | 裝置或感測器溫度，單位 °C |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | CPU 使用率，比例為 `0`–`1`（裝置清單以百分比顯示） |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | 目前已使用的記憶體，單位位元組 |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | 裝置上可用的記憶體總量，單位位元組 |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | 裝置自上次開機以來的秒數 |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. 確認 `iot.fleet.name` 是以 **資源** 屬性（而不是資料點標籤）設定，並且 `service.name` 為 `iot/<fleet>`。",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. 確認匯出工具的端點為 `<YOUR_ONEUPTIME_URL>/otlp`，並且 `x-oneuptime-token` 標頭帶有有效的擷取金鑰。",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. 確定每個資料點都帶有 `device.id` 標籤：裝置以它為鍵。",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. 對尚未回報讀數的裝置，傳送 `iot_device_info`（只含身分資訊），讓它們仍會出現在清單中。",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. 檢查 `device.id` 的值在各次回報之間保持不變；id 變動會產生重複的裝置列。",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401` 表示擷取金鑰缺少、錯誤或已過期；`422` 表示它已停用，或是無法傳送裝置遙測的瀏覽器金鑰。請在上方選擇其他金鑰（或建立新的），並更新你的裝置或收集器傳送的 `x-oneuptime-token` 標頭。",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. 使用「進階」中 **指標慣例** 裡的確切 `iot_*` 指標名稱：其他名稱會以一般指標儲存，不會填入 IoT 圖表。",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` 是 `0`–`1` 的比例；直接傳送原始比例，OneUptime 會以百分比顯示。",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. 裝置開始回報後，最多等候一分鐘，第一批資料點才會出現。",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "這會將讀數傳送到裝置群 **`fleet-1`**。將 `sensor-001` 換成裝置的 id，並讓 `iot.fleet.name` 保持原樣：其他名稱會註冊一個新的裝置群。",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "能執行 OpenTelemetry Collector 的閘道（使用 Docker 或 `otelcol-contrib` 二進位檔）",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "向閘道傳送 OTLP 的裝置，以及閘道到你的 OneUptime 執行個體的網路存取",
  "Save this as `config.yaml` on the gateway:":
    "將以下內容另存為閘道上的 `config.yaml`：",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- 為每個閘道設定 `iot.fleet.name`（以及對應的 `service.name=iot/<fleet>`），讓每個閘道的裝置進入正確的裝置群。",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- 在每個資料點上保留 `device.id`（以及選用的 `iot.device.kind` / `iot.device.type` / `iot.device.firmware`），讓 OneUptime 能在裝置群中辨識出單一裝置。",
  "Run it from the directory that holds `config.yaml`:":
    "在包含 `config.yaml` 的目錄中執行它：",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "之後裝置會向閘道傳送 OTLP（gRPC 使用連接埠 `4317`，HTTP 使用連接埠 `4318`），例如在每個裝置的 SDK 中設定 `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318`。",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "閘道上已經有 `otelcol-contrib`？將它指向該檔案：",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. 確認閘道的收集器匯出時沒有錯誤：檢查它的日誌中的匯出失敗以及 HTTP `401` 或 `422` 回應（在 Docker 中執行時使用 `docker logs -f otel-collector`）。",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** 透過 gRPC（`4317`）和 HTTP（`4318`）接收來自裝置的資料。也可以用收集器支援的其他任何方式（MQTT 橋接、檔案日誌……）接收讀數，再經由同一條管線轉送。",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** 為每筆記錄加上裝置群屬性。為每個閘道設定 `iot.fleet.name`（以及對應的 `service.name=iot/<fleet>`），讓每個閘道的裝置進入正確的裝置群。",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** 在匯出前將記錄分批，讓閘道不必為每個讀數各做一次 HTTP 往返。",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** 透過 HTTPS 傳送到 OneUptime，並附上擷取權杖。預設的 protobuf 編碼和 `encoding: json` 都可接受。",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- 此閘道轉送的每個讀數都會進入裝置群 **`fleet-1`**：請讓 `iot.fleet.name` 和 `service.name` 保持原樣，否則讀數會註冊一個新的裝置群。其他裝置群的閘道設定自己的值。",
  "Any MQTT client that can connect over WebSocket":
    "任何能透過 WebSocket 連線的 MQTT 用戶端",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "例如，使用 Node.js 的 `mqtt` 用戶端（`npm install mqtt`）：",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "將 `building-a-sensors` 和 `sensor-001` 換成你的裝置群名稱和裝置 id：OneUptime 會依據主題建立裝置群和裝置。連線一中斷，Last Will 就會回報裝置離線；直接連線的裝置最好使用自己的認證資訊（兩者都在「進階」中）。",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. 確認用戶端連線和發布時沒有錯誤：連線遭拒且傳回碼為 4（使用者名稱或密碼錯誤）表示金鑰錯誤。",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. 開啟裝置群的 **裝置** 索引標籤：你為其發布過的每個裝置都應會列出，並附上最新的電池、訊號、溫度、CPU、記憶體以及上線/離線狀態。",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "裝置上不需要安裝任何代理程式。OneUptime 把你的裝置對應到兩個概念，而使用 MQTT 時，主題決定了這兩者：",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **裝置群**：`oneuptime/<fleet>/…` 中的 `<fleet>`，也就是一組邏輯上的裝置（例如 `building-a-sensors`）。它會成為讀數的 `iot.fleet.name`，並在 OneUptime 中顯示為遙測服務 `iot/<fleet>`。",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **裝置**：`oneuptime/<fleet>/<device>/…` 中的 `<device>`，也就是裝置群中的單一裝置。它會成為每個讀數的 `device.id`，OneUptime 會以它為鍵，為每個裝置群建立並維護裝置清單。",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    '選用屬性用來細分每個裝置的分類以及在監視器中的範圍。把它們放進遙測發布的 `"attributes"` 對應中：它們會加到該次發布的每個資料點上：',
  "| Attribute | Description |": "| 屬性 | 說明 |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | 裝置類別，例如 `Device`、`Sensor` 或 `Gateway`。預設為 `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | 更細的裝置類型或型號，用來篩選監視器（例如 `temp-sensor`） |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | 裝置回報的韌體版本 |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime 可辨識下列 `iot_*` 指標名稱。透過 MQTT 時，主題會指出裝置，因此每個讀數都歸到該裝置。你只需要傳送對你的裝置有意義的指標，缺少的指標只是不會繪製出來。",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "專案層級的擷取金鑰適合代表眾多裝置發布的閘道。對於直接連線的裝置，請在裝置群的 **裝置註冊表** 索引標籤中逐一註冊：它會為每個裝置核發認證資訊，認證資訊 ID 是 MQTT **使用者名稱**，祕密是 **密碼**。裝置群會隨第一個讀數出現，所以請先用專案層級金鑰傳送一個讀數，如第 2 步所示。",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **主題隔離**：裝置的認證資訊只能在它自己的 `oneuptime/<fleet>/<device>/…` 主題下發布；其他一切都會被捨棄。",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **個別撤銷**：停用或刪除某個裝置的認證資訊，不影響裝置群中的其他裝置；已連線的裝置會在幾秒內被中斷。",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **無聲故障離線偵測**：已註冊的裝置停止回報後，會以離線狀態留在清單中，而不會消失，即使它在沒有 Last Will 的情況下停止運作也一樣。",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "在 `oneuptime/<fleet>/<device>/status` 上註冊一個 MQTT **Last Will**，承載為 `offline`：如果裝置停止運作，OneUptime 會在工作階段中斷的那一刻代它發布 `iot_device_up = 0`，因此不需輪詢就會觸發內建的 Device Offline 警示範本。連線後向同一個主題發布 `online`，裝置就會重新顯示為上線；第 2 步中的範例兩者都做了。裝置發布的任何讀數也都算作上線，所以持續傳送讀數的裝置不需再次發布狀態就會保持上線。狀態主題也接受 `1`/`0`、`true`/`false` 以及 `up`/`down`。",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "在 WebSocket 端點上，請將 MQTT keepalive 保持在 **5 分鐘以內**（用戶端程式庫預設的 60 秒即可）：閒置的 WebSocket 連線會在 300 秒後關閉，這會觸發 Last Will 以及錯誤的離線警示。",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "在固定前置詞 `oneuptime/` 下發布。裝置群和裝置區段不能包含 `/`、`+` 或 `#`，也不能以 `$` 開頭，並且限制為 100 個字元。",
  "| Topic | Payload |": "| 主題 | 承載 |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | 讀數的 JSON 物件（`{"metrics":{"iot_temperature_celsius":21.5}}`），或數值欄位即為指標的扁平物件 |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | 單一值：純數字（`23.4`）或 `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` 或 `offline`，對應到 `iot_device_up` |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    '遙測承載也可以帶有 `"attributes"`（加到每個資料點上的字串對應；可用於 `iot.device.kind`、`iot.device.type`、`iot.device.firmware` 或你自己的標籤）和 `"timestamp"`（ISO-8601，或 Unix 秒/毫秒）。兩者都是選用的；缺少 `timestamp` 時會使用擷取時間。',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "此端點只用於擷取：訂閱會遭到拒絕。每次發布限制為 128 KB 和 100 個指標。超出此約定或承載格式錯誤的發布會被接受後捨棄（MQTT 3.1.1 沒有逐則訊息的錯誤回覆），OneUptime 會記錄一則附上原因的警告。",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "自行託管的部署還可以另外開放原始 MQTT over TCP（`MQTT_INGEST_PORT`，預設 `1883`）。接聽程式預設只在叢集或 Compose 網路內部可用：如果你的裝置無法使用 WebSocket，請將它開放。WebSocket 的 keepalive 上限在那裡不適用。",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "在應用程式服務上設定 `MQTT_INGEST_ENABLED=false` 可關閉 MQTT 接聽程式。",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. 確認主題完全遵循 `oneuptime/<fleet>/<device>/…`：建立裝置群的是主題中的裝置群區段。",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. 超出主題約定或承載格式錯誤的發布會被接受後捨棄（MQTT 3.1.1 沒有逐則訊息的錯誤回覆）。請將你的發布與「進階」中的 **MQTT 主題與承載** 對照；在自行託管的執行個體上，應用程式日誌會寫明原因（`MQTT: dropped publish to …`）。",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "OneUptime 會在 CONNECT 時以傳回碼 4 拒絕錯誤的認證資訊。請檢查：",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- 密碼是有效的擷取金鑰，或者對於已註冊的裝置，是認證資訊的祕密，並以認證資訊 ID 作為使用者名稱；",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- 該金鑰是伺服器金鑰（瀏覽器金鑰會被 MQTT 拒絕），而且沒有停用或過期。",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. 裝置 id 是主題中的 `<device>` 區段：在各次發布之間保持它不變；id 變動會產生重複的裝置列。",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. 對尚未回報讀數的裝置，發布 `iot_device_info`（只含身分資訊）或一則 `status` 訊息，讓它們仍會出現在清單中。",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "在 WebSocket 端點上，閒置連線會在 300 秒後關閉，這會觸發 Last Will 以及錯誤的 Device Offline 警示。請將 MQTT keepalive 保持在 5 分鐘以內；用戶端程式庫預設的 60 秒即可。",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "將 `sensor-001` 換成裝置的 id：OneUptime 會依據主題把裝置加入裝置群 **`fleet-1`**。連線一中斷，Last Will 就會回報裝置離線；直接連線的裝置最好使用自己的認證資訊（兩者都在「進階」中）。",
};

export default TRANSLATION;
