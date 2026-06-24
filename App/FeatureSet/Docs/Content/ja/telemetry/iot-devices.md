# OneUptime IoT デバイス

## 概要

OneUptime は、標準の OpenTelemetry (OTLP) メトリクスを取り込むことで、IoT デバイス群 — センサー、ゲートウェイ、コントローラー、エッジボックス — のフリートを監視します。各デバイス (またはそれに代わるゲートウェイ) は、OTLP HTTP 経由で少数の `iot_*` メトリクスをプッシュし、所属する **フリート** と自身の **デバイス id** をタグ付けします。OneUptime はそれらのメトリクスをフリートにグループ化し、ライブのデバイスインベントリを構築して、デバイスごとのバッテリー、接続状態、温度、CPU、メモリ、可用性を追跡します。

デバイス側にインストールするエージェントはありません — OTLP を話せるものなら何でも (デバイス上の OpenTelemetry SDK、または多数のデバイスへファンアウトするゲートウェイ上で動作する OpenTelemetry Collector) 動作します。このページは **取り込みガイド** です。プッシュしたデータの上に IoT モニターとアラートを設定する方法については、[IoT デバイスモニター](/docs/monitor/iot-device-monitor) を参照してください。

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

以下の `iot_*` 名を使用して測定値をメトリクスとして送出します ([メトリクスの規約](#metric-conventions) を参照)。1 分ほどすると、デバイスが OneUptime ダッシュボードの **IoT** セクションに表示されます。

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
    # OneUptime はデフォルトの Proto(buf) の代わりに JSON エンコーダーを必要とします
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

- **`resource`** は、すべてのレコードにフリート属性をスタンプします。各ゲートウェイのデバイスが正しいフリートに入るように、ゲートウェイごとに `iot.fleet.name` (および対応する `service.name=iot/<fleet>`) を設定します。
- OneUptime がフリート内の個々のデバイスを解決できるように、各データポイントに `device.id` (およびオプションで `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) を保持します。
- **`otlphttp`** は、取り込みトークンを付加して HTTPS 経由で OneUptime に送信します。`encoding: json` と `Content-Type: application/json` ヘッダーが必須である点に注意してください。

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
3. コレクターを使用している場合は、`otlphttp` エクスポーターに `encoding: json` と `Content-Type: application/json` が設定されていることを確認します。

### デバイスがインベントリに表示されない

1. 各データポイントに `device.id` ラベルが付いていることを確認します — デバイスはそれをキーとしています。
2. まだ測定値を報告していないデバイスについては、`iot_device_info` (識別情報のみ) を送信して、インベントリに表示されるようにします。
3. `device.id` の値が報告間で安定していることを確認します。id が変わると、重複したデバイス行が作成されます。

### エクスポーターからの HTTP 401 / 403

取り込みトークンが無効、失効、または欠落しています。_Project Settings → Telemetry Ingestion Keys_ から新しいトークンを生成し、`x-oneuptime-token` ヘッダーを更新してください。

### メトリクスがチャート化されない

1. [メトリクスの規約](#metric-conventions) テーブルの正確な `iot_*` メトリクス名を使用していることを確認します — 認識されない名前は汎用メトリクスとして保存され、IoT チャートには反映されません。
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
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

インスタンスが HTTP 専用の場合は、スキームを `http://` に変更し、適切なポートを使用してください。

## 次のステップ

- **IoT デバイスモニター** を設定して、デバイスのオフライン、低バッテリー、弱い信号、高温、高 CPU の状態についてアラートを発生させます — [IoT デバイスモニター](/docs/monitor/iot-device-monitor) を参照してください。
- コンテナ化されていないホスト (Linux / macOS / Windows の VM やベアメタル) には、[ホスト OpenTelemetry Collector](/docs/telemetry/host-otel-collector) を使用してください。
- 基盤となる OTLP 統合を詳しく学ぶには、[OpenTelemetry を OneUptime と統合する](/docs/telemetry/open-telemetry) を参照してください。
