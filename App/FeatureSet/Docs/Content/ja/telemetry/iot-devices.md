# OneUptime IoT デバイス

## 概要

OneUptime は、少数の `iot_*` メトリクスを取り込むことで、IoT デバイス群 — センサー、ゲートウェイ、コントローラー、エッジボックス — のフリートを監視します。各測定値には、所属する **フリート** と自身の **デバイス id** がタグ付けされます。OneUptime はそれらのメトリクスをフリートにグループ化し、ライブのデバイスインベントリを構築して、デバイスごとのバッテリー、接続状態、温度、CPU、メモリ、可用性を追跡します。

デバイスが測定値をプッシュする方法は 2 つあり、どちらもまったく同じフリートインベントリ、ダッシュボード、モニターに反映されます。

- **OpenTelemetry (OTLP)** — デバイス上の OTel SDK、または多数のデバイスへファンアウトするゲートウェイ上の OpenTelemetry Collector。
- **MQTT** — OneUptime の組み込み MQTT エンドポイント (WebSocket 経由の MQTT は `wss://<your-host>/mqtt`、セルフホストのデプロイでは生の MQTT TCP) に直接接続し、JSON の測定値を発行します。コレクターは不要で、Last Will のサポートにより即座にオフラインを検知できます。

デバイス側にインストールする独自のエージェントはありません。このページは **取り込みガイド** です。プッシュしたデータの上に IoT モニターとアラートを設定する方法については、[IoT デバイスモニター](/docs/monitor/iot-device-monitor) を参照してください。

## 前提条件

- OneUptime へ OTLP/HTTP を送信できるデバイス、ゲートウェイ、またはコレクター
- デバイス/ゲートウェイから OneUptime インスタンスへのネットワーク到達性
- **OneUptime テレメトリ取り込みトークン** — _Project Settings → Telemetry Ingestion Keys_ から作成し、`x-oneuptime-token` の値をコピーします

## OneUptime が IoT をどのようにモデル化するか

OneUptime は、OpenTelemetry のリソース属性を使用して、デバイスを 2 つの概念にマッピングします。

- **フリート** — デバイスの論理的なグループ (例: `building-a-sensors` や `field-gateways`)。フリートは `iot.fleet.name` リソース属性から導出され、OneUptime ではテレメトリサービス `iot/<fleet>` として表示されます。`service.name=iot/<fleet>` を設定して、ログとメトリクスが同じサービスの下に揃うようにします。
- **デバイス** — フリート内の個々のデバイスで、`device.id` 属性によって識別されます。OneUptime は `device.id` をキーとして、フリートごとのデバイスインベントリを構築・維持します。

オプションの属性により、各デバイスがモニター内でどのように分類・スコープされるかをさらに細かく指定できます。

| 属性                  | 必須   | 説明                                                                              |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `iot.fleet.name`     | はい     | このデバイスが所属するフリート。OneUptime サービス `iot/<fleet>` になります        |
| `device.id`          | はい     | フリート内でデバイスを識別する安定した一意の id                                     |
| `iot.device.kind`    | いいえ   | デバイスのクラス — 例: `Device`、`Sensor`、`Gateway`。デフォルトは `Device`        |
| `iot.device.type`    | いいえ   | モニターのフィルタリングに使用される、より細かいデバイスのタイプ/モデル (例: `temp-sensor`) |
| `iot.device.firmware`| いいえ   | デバイスが報告するファームウェアのバージョン                                        |

## OpenTelemetry SDK 経由でのメトリクス送信

デバイスが OpenTelemetry SDK を直接実行している場合は、それを OneUptime に向け、標準の `OTEL_*` 環境変数を介して IoT リソース属性をスタンプします。トークン、エンドポイント、フリート名、デバイス id を、ご利用の環境の値に置き換えてください。

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
```

| 環境変数                       | 必須   | 説明                                                                                                 |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | はい     | OneUptime OTLP エンドポイント (`https://oneuptime.com/otlp`、またはセルフホストの `http(s)://YOUR-ONEUPTIME-HOST/otlp`) |
| `OTEL_EXPORTER_OTLP_HEADERS`  | はい     | `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`                                                    |
| `OTEL_RESOURCE_ATTRIBUTES`    | はい     | カンマ区切りのリソース属性。`iot.fleet.name`、`device.id`、`service.name=iot/<fleet>` を含める必要があります |

以下の `iot_*` 名を使用して測定値をメトリクスとして送出します ([メトリクスの規約](#メトリクスの規約) を参照)。1 分ほどすると、デバイスが OneUptime ダッシュボードの **IoT** セクションに表示されます。

## OpenTelemetry Collector 経由でのメトリクス送信

多数のデバイスがゲートウェイを通じて報告する場合は、ゲートウェイ上で OpenTelemetry Collector を実行し、OneUptime にエクスポートします。`resource` プロセッサーがフリート属性をスタンプします。デバイスから測定値 (OTLP、MQTT ブリッジ、ファイルログなど) を受信し、転送します。

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
    headers:
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp]
```

- **`resource`** は、すべてのレコードにフリート属性をスタンプします。各ゲートウェイのデバイスが正しいフリートに入るように、ゲートウェイごとに `iot.fleet.name` (および対応する `service.name=iot/<fleet>`) を設定します。
- OneUptime がフリート内の個々のデバイスを解決できるように、各データポイントに `device.id` (およびオプションで `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) を保持します。
- **`otlphttp`** は、取り込みトークンを付加して HTTPS 経由で OneUptime に送信します。デフォルトの protobuf エンコーディングと `encoding: json` のどちらも受け付けられます。

## MQTT 経由でのメトリクス送信

OneUptime には MQTT エンドポイントが組み込まれているため、すでに MQTT を話せるデバイスは測定値を直接プッシュできます — OpenTelemetry SDK、コレクター、ブリッジは不要です。MQTT 経由で発行されたものはすべて OTLP と同じパイプラインに入ります。フリートは自動的に作成され、デバイスインベントリが更新され、すべての IoT モニターとアラートテンプレートがそのまま動作します。

**エンドポイント**

| トランスポート          | アドレス                                | 備考                                                                                      |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| WebSocket 経由の MQTT | `wss://<your-host>/mqtt`               | すべてのデプロイで動作します — OneUptime のイングレスを通じて通常の HTTPS ポートを使用します |
| TCP 経由の MQTT       | `<app-host>:1883` (`MQTT_INGEST_PORT`) | セルフホスト: デフォルトではクラスター/compose ネットワークの内部に閉じています。必要であれば公開してください |

**認証** — 2 つの選択肢があります。

- **プロジェクト全体**: **テレメトリ取り込みトークン** を MQTT のパスワードとして送信します (ユーザー名は無視されます。クライアントがユーザー名フィールドしか公開していない場合は、代わりにそこにトークンを入れてください)。多数のデバイスに代わって発行するゲートウェイに適しています。
- **デバイスごと** (デバイスが直接接続する場合に推奨): ダッシュボードのフリートの **Device Registry** タブでデバイスを登録します。登録によってデバイスごとの資格情報が発行されます — 資格情報 ID が MQTT の **ユーザー名**、シークレットが **パスワード** です。デバイス認証されたクライアントは自身の `oneuptime/<fleet>/<device>/…` トピックの下にのみ発行でき、侵害された 1 台のデバイスはフリートの残りに触れることなくダッシュボードから失効させられます (失効は接続中のセッションであっても 1 分ほどで有効になります)。また、登録されたデバイスは **サイレントデス時のオフライン検知** の対象になります。報告が止まってもインベントリから消えることなく Offline として残り、Last Will なしで停止した場合でもデバイスオフラインのアラートテンプレートが発火します。

無効な資格情報は CONNECT の時点でリターンコード 4 (ユーザー名またはパスワードが不正) で拒否されるため、設定を誤ったデバイスは明確に失敗します。

**トピック** — 固定の `oneuptime/` プレフィックスの下に発行します。フリートとデバイスのセグメントには `/`、`+`、`#` を含めることはできず、100 文字までに制限されます。

| トピック                                          | ペイロード                                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `oneuptime/<fleet>/<device>/telemetry`           | 測定値の JSON オブジェクト — `{ "metrics": { "iot_temperature_celsius": 21.5 } }`、または数値フィールドがそのままメトリクスとなるフラットなオブジェクト |
| `oneuptime/<fleet>/<device>/metrics/<metricName>`| 単一の値 — 素の数値 (`23.4`) または `{ "value": 23.4 }`                                                |
| `oneuptime/<fleet>/<device>/status`              | `"online"` または `"offline"` (`1`/`0`、`true`/`false`、`up`/`down` も可) — `iot_device_up` にマッピングされます |

テレメトリのペイロードには、`"attributes"` (すべてのデータポイントにスタンプされる文字列マップ — `iot.device.kind`、`iot.device.type`、`iot.device.firmware`、または独自のラベルに使用します) と `"timestamp"` (ISO-8601、または unix 秒/ミリ秒) を含めることもできます。どちらもオプションで、`timestamp` がない場合は取り込み時刻が使用されます。

**Last Will によるオフライン検知** — `oneuptime/<fleet>/<device>/status` トピックにペイロード `offline` の MQTT Last Will を登録します。デバイスが停止したりネットワークから脱落したりすると、セッションが終了した瞬間にブローカーがデバイスに代わって `iot_device_up = 0` を発行します — これにより標準の **Device Offline** アラートテンプレートが作動し、インベントリ上でデバイスが Down に切り替わります。ポーリングも、スクレイプの取りこぼしを待つ必要もありません。接続後に同じトピックへ `online` を発行すれば、デバイスは再び Up として表示されます。

`mosquitto_pub` の例 (生の TCP、セルフホスト):

```bash
mosquitto_pub -h YOUR-ONEUPTIME-APP-HOST -p 1883 \
  -u oneuptime -P "YOUR_TELEMETRY_INGESTION_TOKEN" \
  -t "oneuptime/building-a-sensors/sensor-001/telemetry" \
  -m '{"metrics":{"iot_device_up":1,"iot_battery_percent":87,"iot_temperature_celsius":21.5},"attributes":{"iot.device.type":"temp-sensor","iot.device.firmware":"1.4.2"}}'
```

WebSocket 経由の Node.js `mqtt` の例 (oneuptime.com および任意のセルフホストインスタンスで動作します):

```javascript
const mqtt = require("mqtt");

const client = mqtt.connect("wss://oneuptime.com/mqtt", {
  username: "oneuptime", // ignored — the token below is what authenticates
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

WebSocket 経由の Python `paho-mqtt` の例:

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

注意点:

- このエンドポイントは **取り込み専用** です。サブスクリプションは拒否されます (SUBACK は失敗)。ブローカーに受信を確認させたい場合は QoS 1 を使用してください。取り込みは **at-least-once** です — 確認応答が失われた後の QoS 1/2 の再送により、データポイントが重複する可能性があります。
- トピックの取り決めから外れた発行や、不正な形式のペイロードは受理された上で **破棄** されます (MQTT 3.1.1 にはメッセージごとのエラー応答がありません) — サーバーは理由とともに警告をログに記録するので、データが届かない場合は OneUptime アプリのログを確認してください。
- WebSocket エンドポイントでは、MQTT の keepalive を **5 分未満** に保ってください — OneUptime のイングレスはアイドル状態の WebSocket 接続を 300 秒後に切断するため、Last Will が発火して誤った Device Offline アラートが発生します。クライアントライブラリのデフォルト (`mqtt` と `paho-mqtt` はいずれも 60 秒) であれば問題ありません。生の TCP エンドポイントにはこのような上限はありません。
- ペイロードは 1 回の発行あたり 128 KB およびメトリクス 100 個までに制限されます。サイズを超えたパケットは接続を切断します。

## メトリクスの規約

OneUptime は、以下の `iot_*` メトリクス名を認識します。各データポイントには `device.id` ラベルを付けて、測定値が正しいデバイスに帰属するようにしてください。デバイスにとって意味のあるメトリクスのみを送信すればよく、欠けているものは単にチャート化されないだけです。

| メトリクス名                 | 意味                                                                            |
| --------------------------- | ------------------------------------------------------------------------------ |
| `iot_device_up`             | デバイスの可用性。`1` = 稼働中/到達可能、`0` = ダウン。IoT デバイスモニターを駆動します |
| `iot_device_info`           | 識別情報のみのシグナル。`device.id` / kind / type / firmware を保持し、測定値の報告前でもデバイスがインベントリに表示されるようにします |
| `iot_battery_percent`       | バッテリーの充電レベル、`0`–`100` (%)                                            |
| `iot_signal_strength_dbm`   | dBm 単位の無線信号強度 (例: Wi-Fi / LoRa / セルラーの RSSI)                       |
| `iot_temperature_celsius`   | °C 単位のデバイスまたはセンサーの温度                                            |
| `iot_cpu_usage_ratio`       | `0`–`1` の比率としての CPU 使用率 (OneUptime はパーセンテージとして保存します)    |
| `iot_memory_usage_bytes`    | 現在使用中のメモリ (bytes 単位)                                                  |
| `iot_memory_size_bytes`     | デバイスで利用可能な合計メモリ (bytes 単位)                                       |
| `iot_uptime_seconds`        | デバイスが最後に起動してからの秒数                                                |

## インストールの確認

1. デバイスまたはゲートウェイがエラーなくエクスポートしていることを確認します (SDK/コレクターのログでエクスポートの失敗や HTTP `401`/`403` 応答を確認してください)。
2. OneUptime ダッシュボードで **IoT** セクションを開きます — フリートが 1 分ほどで `iot/<fleet>` として表示されるはずです。
3. フリートの **Devices** タブを開きます — 送信した各 `device.id` が、最新のバッテリー、信号、温度、CPU、メモリ、稼働/ダウンの状態とともに一覧表示されるはずです。
4. フリートの下の **Metrics** を開いて、上記の任意の `iot_*` 系列をチャート化します。

## トラブルシューティング

### フリートが表示されない

1. `iot.fleet.name` が **リソース** 属性として設定されていること (データポイントのラベルではないこと)、および `service.name` が `iot/<fleet>` であることを確認します。
2. エクスポーターのエンドポイントが `https://oneuptime.com/otlp` (またはセルフホストの `…/otlp`) であり、`x-oneuptime-token` ヘッダーが有効なトークンを保持していることを確認します。
3. MQTT を使用している場合は、トピックが `oneuptime/<fleet>/<device>/…` に正確に従っていることを確認します — フリートを作成するのはトピックのフリートセグメントです。

### デバイスがインベントリに表示されない

1. 各データポイントに `device.id` ラベルが付いていることを確認します — デバイスはそれをキーとしています。
2. まだ測定値を報告していないデバイスについては、`iot_device_info` (識別情報のみ) を送信して、インベントリに表示されるようにします。
3. `device.id` の値が報告間で安定していることを確認します。id が変わると、重複したデバイス行が作成されます。

### エクスポーターからの HTTP 401 / 403

取り込みトークンが無効、失効、または欠落しています。_Project Settings → Telemetry Ingestion Keys_ から新しいトークンを生成し、`x-oneuptime-token` ヘッダーを更新してください。

### メトリクスがチャート化されない

1. [メトリクスの規約](#メトリクスの規約) テーブルの正確な `iot_*` メトリクス名を使用していることを確認します — 認識されない名前は汎用メトリクスとして保存され、IoT チャートには反映されません。
2. `iot_cpu_usage_ratio` は `0`–`1` の比率であることを覚えておいてください。生の比率を送信すれば、OneUptime がそれをパーセンテージとして表示します。
3. デバイスが報告を開始してから最初のデータポイントが表示されるまで、最大 1 分ほどかかることがあります。

## セルフホストの OneUptime

OneUptime をセルフホストしている場合は、エンドポイントを自分のインスタンスに向けます。

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://your-oneuptime-host.example.com/otlp
```

または、コレクターでは次のようにします。

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

MQTT の場合は `wss://your-oneuptime-host.example.com/mqtt` に接続します。デバイスが WebSocket を話せない場合は、app サービスの生の MQTT TCP ポート (`MQTT_INGEST_PORT`、デフォルトは `1883`) を公開してください。app サービスで `MQTT_INGEST_ENABLED=false` を設定すると、MQTT のリスナーを完全に無効化できます。

インスタンスが HTTP 専用の場合は、スキームを `http://` (MQTT の場合は `ws://`) に変更し、適切なポートを使用してください。

## 次のステップ

- **IoT デバイスモニター** を設定して、デバイスのオフライン、低バッテリー、弱い信号、高温、高 CPU の状態についてアラートを発生させます — [IoT デバイスモニター](/docs/monitor/iot-device-monitor) を参照してください。
- コンテナ化されていないホスト (Linux / macOS / Windows の VM やベアメタル) には、[ホスト OpenTelemetry Collector](/docs/telemetry/host-otel-collector) を使用してください。
- 基盤となる OTLP 統合を詳しく学ぶには、[OpenTelemetry を OneUptime と統合する](/docs/telemetry/open-telemetry) を参照してください。
