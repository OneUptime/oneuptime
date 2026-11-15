import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in Japanese (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * Japanese. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Japanese words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "OTLP を HTTP でエクスポートする OpenTelemetry SDK を実行しているデバイス",
  "Network access from the device to your OneUptime instance":
    "デバイスから OneUptime インスタンスへのネットワークアクセス",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "`building-a-sensors` と `sensor-001` を、フリート名とデバイス ID に置き換えます。`iot.fleet.name` は変えないでください。変更すると、まったく新しいフリートとして登録されます。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "ステップ 1 で取り込みキーを選ぶと、`<YOUR_API_KEY>` に入ります。",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "読み取り値を `iot_*` の規約に沿った名前のメトリクスとして送信し、すべてのデータポイントに `device.id` 属性を付けます。例:",
  "| Metric | Value | Datapoint attribute |":
    "| メトリクス | 値 | データポイントの属性 |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "デバイスインベントリは、リソースではなくデータポイントの `device.id` をキーにしているため、`OTEL_RESOURCE_ATTRIBUTES` に加えて各測定値にも設定してください。認識されるすべての名前は、「詳細」の **メトリクスの規約** にあります。",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. デバイスがエラーなくエクスポートしていることを確認します。SDK のログで、エクスポートの失敗と HTTP `401` または `422` の応答を確認してください。",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. OneUptime のダッシュボードで **IoT** セクションを開きます。通常 1 分ほどでフリートが表示されます。",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. フリートの **デバイス** タブを開きます。送信した各 `device.id` が、最新のバッテリー、信号、温度、CPU、メモリ、稼働状態とともに一覧に表示されます。",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. フリートの **メトリクス** を開いて、`iot_*` のいずれかの系列をグラフにします。",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "デバイスにインストールするエージェントはありません。OneUptime は OpenTelemetry の属性を使って、デバイスを 2 つの概念に対応付けます:",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **フリート**: デバイスの論理的なグループ (例: `building-a-sensors` や `field-gateways`)。フリートはリソース属性 `iot.fleet.name` から決まり、OneUptime ではテレメトリサービス `iot/<fleet>` として表示されます。ログとメトリクスが同じサービスにまとまるよう、`service.name=iot/<fleet>` を設定してください。",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **デバイス**: フリート内の個々のデバイス。各データポイントの `device.id` 属性で識別されます。OneUptime は `device.id` をキーにしたフリートごとのデバイスインベントリを作成し、維持します。",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "OneUptime が読み取る属性です。任意の属性は、各デバイスの分類とモニターでの絞り込みを細かくします:",
  "| Attribute | Set on | Required | Description |":
    "| 属性 | 設定先 | 必須 | 説明 |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | リソース | はい | このデバイスが属するフリート。OneUptime のサービス `iot/<fleet>` になります |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | 各データポイント | はい | フリート内で一意かつ変わらないデバイス ID |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | 各データポイント | いいえ | デバイスの種類 (例: `Device`、`Sensor`、`Gateway`)。既定値は `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | 各データポイント | いいえ | モニターの絞り込みに使う、より細かいデバイスの型やモデル (例: `temp-sensor`) |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | 各データポイント | いいえ | デバイスが報告するファームウェアのバージョン |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime は次の `iot_*` メトリクス名を認識します。読み取り値が正しいデバイスに割り当てられるよう、各データポイントには `device.id` ラベルを付けてください。送るのはデバイスに意味のあるメトリクスだけで構いません。ないものはグラフに表示されないだけです。",
  "| Metric Name | Meaning |": "| メトリクス名 | 意味 |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | デバイスの可用性。`1` = 稼働中/到達可能、`0` = 停止。IoT デバイスモニターを動かします |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | 識別情報のみのシグナル。`device.id` / 種類 / 型 / ファームウェアを持つため、読み取り値を報告する前からデバイスがインベントリに表示されます |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | バッテリーの充電量、`0`–`100` (%) |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | 無線信号の強さ (dBm) (例: Wi-Fi / LoRa / セルラーの RSSI) |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | デバイスまたはセンサーの温度 (°C) |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | CPU 使用率 (比率 `0`–`1`、デバイスインベントリではパーセントで表示) |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | 現在使用中のメモリ (バイト) |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | デバイスで利用できるメモリの合計 (バイト) |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | デバイスが最後に起動してからの秒数 |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. `iot.fleet.name` が **リソース** 属性として (データポイントのラベルではなく) 設定され、`service.name` が `iot/<fleet>` になっていることを確認します。",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. エクスポーターのエンドポイントが `<YOUR_ONEUPTIME_URL>/otlp` で、`x-oneuptime-token` ヘッダーに有効な取り込みキーが入っていることを確認します。",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. 各データポイントに `device.id` ラベルがあることを確認します。デバイスはこれをキーにしています。",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. まだ読み取り値を報告していないデバイスには `iot_device_info` (識別情報のみ) を送り、インベントリに表示されるようにします。",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. `device.id` の値が送信ごとに変わらないことを確認します。ID が変わると、デバイスの行が重複します。",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401` は取り込みキーがない、誤っている、または期限切れであることを意味します。`422` はキーが無効化されているか、デバイスのテレメトリを送れないブラウザーキーであることを意味します。上で別のキーを選択し (または新しく作成し)、デバイスやコレクターが送る `x-oneuptime-token` ヘッダーを更新してください。",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. 「詳細」の **メトリクスの規約** にある `iot_*` メトリクス名をそのまま使います。ほかの名前は一般のメトリクスとして保存され、IoT のグラフには反映されません。",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` は `0`–`1` の比率です。比率をそのまま送れば、OneUptime がパーセントで表示します。",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. デバイスが報告を始めてから最初のデータポイントが表示されるまで、最大 1 分ほどかかります。",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "これにより、読み取り値はフリート **`fleet-1`** に送られます。`sensor-001` をデバイスの ID に置き換え、`iot.fleet.name` は正確にそのままにしてください。別の名前は新しいフリートとして登録されます。",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "OpenTelemetry Collector を実行できるゲートウェイ (Docker または `otelcol-contrib` バイナリ)",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "ゲートウェイに OTLP を送るデバイスと、ゲートウェイから OneUptime インスタンスへのネットワークアクセス",
  "Save this as `config.yaml` on the gateway:":
    "これをゲートウェイに `config.yaml` として保存します:",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- ゲートウェイごとに `iot.fleet.name` (と対応する `service.name=iot/<fleet>`) を設定し、各ゲートウェイのデバイスが正しいフリートに入るようにします。",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- 各データポイントに `device.id` (必要に応じて `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) を残し、OneUptime がフリート内の個々のデバイスを特定できるようにします。",
  "Run it from the directory that holds `config.yaml`:":
    "`config.yaml` があるディレクトリで実行します:",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "デバイスはその後、ゲートウェイに OTLP を送ります (gRPC はポート `4317`、HTTP はポート `4318`)。たとえば、各デバイスの SDK に `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` を設定します。",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "ゲートウェイにすでに `otelcol-contrib` がありますか？ そのファイルを指定します:",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. ゲートウェイのコレクターがエラーなくエクスポートしていることを確認します。ログで、エクスポートの失敗と HTTP `401` または `422` の応答を確認してください (Docker で実行している場合は `docker logs -f otel-collector`)。",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** は gRPC (`4317`) と HTTP (`4318`) でデバイスから受信します。コレクターが対応するほかの方法 (MQTT ブリッジ、ファイルのログなど…) で読み取り値を受け取り、同じパイプラインで転送することもできます。",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** はすべてのレコードにフリートの属性を付けます。ゲートウェイごとに `iot.fleet.name` (と対応する `service.name=iot/<fleet>`) を設定し、各ゲートウェイのデバイスが正しいフリートに入るようにします。",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** はエクスポート前にレコードをまとめるため、ゲートウェイが読み取り値ごとに HTTP の往復をする必要がありません。",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** は取り込みトークンを付けて HTTPS で OneUptime に送信します。既定の protobuf エンコードと `encoding: json` のどちらも受け付けます。",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- このゲートウェイが転送する読み取り値はすべてフリート **`fleet-1`** に送られます。`iot.fleet.name` と `service.name` は正確にそのままにしてください。変えると、読み取り値は新しいフリートとして登録されます。別のフリートのゲートウェイには、それぞれの値を設定します。",
  "Any MQTT client that can connect over WebSocket":
    "WebSocket で接続できる任意の MQTT クライアント",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "たとえば、Node.js の `mqtt` クライアント (`npm install mqtt`) を使う場合:",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "`building-a-sensors` と `sensor-001` を、フリート名とデバイス ID に置き換えます。OneUptime はトピックからフリートとデバイスを作成します。Last Will は接続が切れた瞬間にデバイスをオフラインとして報告します。直接接続するデバイスには、専用の資格情報を使うほうが適しています (どちらも「詳細」にあります)。",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. クライアントがエラーなく接続して発行できることを確認します。戻りコード 4 (ユーザー名またはパスワードが正しくない) で接続が拒否される場合は、キーが誤っています。",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. フリートの **デバイス** タブを開きます。発行した各デバイスが、最新のバッテリー、信号、温度、CPU、メモリ、稼働状態とともに一覧に表示されます。",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "デバイスにインストールするエージェントはありません。OneUptime はデバイスを 2 つの概念に対応付け、MQTT ではトピックが両方を決めます:",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **フリート**: `oneuptime/<fleet>/…` の `<fleet>`。デバイスの論理的なグループ (例: `building-a-sensors`) です。読み取り値の `iot.fleet.name` になり、OneUptime ではテレメトリサービス `iot/<fleet>` として表示されます。",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **デバイス**: `oneuptime/<fleet>/<device>/…` の `<device>`。フリート内の個々のデバイスです。すべての読み取り値の `device.id` になり、OneUptime はこれをキーにしたフリートごとのデバイスインベントリを作成し、維持します。",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    '任意の属性は、各デバイスの分類とモニターでの絞り込みを細かくします。テレメトリの発行の `"attributes"` マップに入れると、その発行のすべてのデータポイントに付きます:',
  "| Attribute | Description |": "| 属性 | 説明 |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | デバイスの種類 (例: `Device`、`Sensor`、`Gateway`)。既定値は `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | モニターの絞り込みに使う、より細かいデバイスの型やモデル (例: `temp-sensor`) |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | デバイスが報告するファームウェアのバージョン |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime は次の `iot_*` メトリクス名を認識します。MQTT ではトピックがデバイスを示すため、すべての読み取り値はそのデバイスに割り当てられます。送るのはデバイスに意味のあるメトリクスだけで構いません。ないものはグラフに表示されないだけです。",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "プロジェクト全体の取り込みキーは、多数のデバイスに代わって発行するゲートウェイに向いています。直接接続するデバイスは、フリートの **デバイスレジストリ** タブで 1 台ずつ登録します。デバイスごとの資格情報が発行され、資格情報 ID が MQTT の **ユーザー名**、シークレットが **パスワード** になります。フリートは最初の読み取り値で表示されるので、ステップ 2 のように、まずプロジェクト全体のキーで 1 つ送ってください。",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **トピックの分離**: デバイスの資格情報では、そのデバイス自身の `oneuptime/<fleet>/<device>/…` トピックにしか発行できません。それ以外は破棄されます。",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **個別の取り消し**: フリートのほかのデバイスに影響を与えずに、1 台のデバイスの資格情報を無効化または削除できます。接続中のデバイスは数秒以内に切断されます。",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **サイレント障害のオフライン検出**: 登録済みのデバイスは、報告が止まると消えずにオフラインとしてインベントリに残ります。Last Will なしで停止した場合も同じです。",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "`oneuptime/<fleet>/<device>/status` に、ペイロード `offline` の MQTT **Last Will** を登録します。デバイスが停止すると、セッションが切れた瞬間に OneUptime がデバイスに代わって `iot_device_up = 0` を発行し、ポーリングなしで標準の Device Offline アラートテンプレートが発動します。接続後に同じトピックへ `online` を発行すると、デバイスは再び稼働中として表示されます。ステップ 2 の例は両方を行います。デバイスが発行する読み取り値も稼働中として扱われるため、読み取り値を送り続けるデバイスは状態を発行し直さなくても稼働中のままです。状態トピックは `1`/`0`、`true`/`false`、`up`/`down` も受け付けます。",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "WebSocket エンドポイントでは、MQTT の keepalive を **5 分未満** にしてください (クライアントライブラリの既定値 60 秒で問題ありません)。アイドル状態の WebSocket 接続は 300 秒後に閉じられ、Last Will と誤ったオフラインアラートが発生してしまいます。",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "固定のプレフィックス `oneuptime/` の下に発行します。フリートとデバイスのセグメントには `/`、`+`、`#` を含めたり、`$` で始めたりできず、100 文字までです。",
  "| Topic | Payload |": "| トピック | ペイロード |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | 読み取り値の JSON オブジェクト (`{"metrics":{"iot_temperature_celsius":21.5}}`)、または数値フィールドがメトリクスになるフラットなオブジェクト |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | 単一の値。数値のみ (`23.4`) または `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` または `offline`。`iot_device_up` に対応します |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    'テレメトリのペイロードには、`"attributes"` (すべてのデータポイントに付く文字列マップ。`iot.device.kind`、`iot.device.type`、`iot.device.firmware`、独自のラベルに使います) と `"timestamp"` (ISO-8601、または Unix の秒/ミリ秒) も含められます。どちらも任意です。`timestamp` がない場合は取り込み時刻が使われます。',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "このエンドポイントは取り込み専用で、サブスクライブは拒否されます。1 回の発行は 128 KB、100 メトリクスまでです。この取り決めから外れた発行や、形式が正しくないペイロードは受け付けたうえで破棄され (MQTT 3.1.1 にはメッセージごとのエラー応答がありません)、OneUptime が理由を付けて警告をログに記録します。",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "セルフホストの環境では、生の MQTT over TCP (`MQTT_INGEST_PORT`、既定値 `1883`) も公開できます。リスナーは既定ではクラスターまたは Compose のネットワーク内だけで使えます。デバイスが WebSocket を使えない場合は公開してください。そこでは WebSocket の keepalive の上限は適用されません。",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "MQTT リスナーを無効にするには、アプリのサービスに `MQTT_INGEST_ENABLED=false` を設定します。",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. トピックが `oneuptime/<fleet>/<device>/…` に正確に従っていることを確認します。フリートを作成するのは、トピックのフリートのセグメントです。",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. トピックの取り決めから外れた発行や、形式が正しくないペイロードは、受け付けたうえで破棄されます (MQTT 3.1.1 にはメッセージごとのエラー応答がありません)。「詳細」の **MQTT のトピックとペイロード** と比べてください。セルフホストのインスタンスでは、アプリのログに理由が記録されます (`MQTT: dropped publish to …`)。",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "OneUptime は、正しくない資格情報を CONNECT 時に戻りコード 4 で拒否します。次の点を確認してください:",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- パスワードが有効な取り込みキーであること。登録済みのデバイスでは、資格情報のシークレットで、資格情報 ID をユーザー名にしていること。",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- キーがサーバーキーで (ブラウザーキーは MQTT では拒否されます)、無効化も期限切れもしていないこと。",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. デバイス ID はトピックの `<device>` セグメントです。発行ごとに変えないでください。ID が変わると、デバイスの行が重複します。",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. まだ読み取り値を報告していないデバイスには、`iot_device_info` (識別情報のみ) または `status` メッセージを発行して、インベントリに表示されるようにします。",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "WebSocket エンドポイントでは、アイドル状態の接続は 300 秒後に閉じられ、Last Will と誤った Device Offline アラートが発生します。MQTT の keepalive は 5 分未満にしてください。クライアントライブラリの既定値 60 秒で問題ありません。",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "`sensor-001` をデバイスの ID に置き換えます。OneUptime はトピックから、デバイスをフリート **`fleet-1`** に追加します。Last Will は接続が切れた瞬間にデバイスをオフラインとして報告します。直接接続するデバイスには、専用の資格情報を使うほうが適しています (どちらも「詳細」にあります)。",
};

export default TRANSLATION;
