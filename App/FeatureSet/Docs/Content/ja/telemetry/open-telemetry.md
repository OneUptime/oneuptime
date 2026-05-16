# OpenTelemetry（ログ、メトリクス、トレース）をOneUptimeに統合する。 

### ステップ1 — テレメトリー取り込みトークンの作成

OneUptimeアカウントを作成したら、アプリケーションからログ、メトリクス、トレースを取り込むためのテレメトリー取り込みトークンを作成できます。

OneUptimeに登録してプロジェクトを作成した後、ナビゲーションバーの「More」をクリックし、「プロジェクト設定」をクリックします。

テレメトリー取り込みキーページで、「取り込みキーの作成」をクリックしてトークンを作成します。

![サービスの作成](/docs/static/images/TelemetryIngestionKeys.png)

トークンを作成したら、「表示」をクリックしてトークンを確認します。

![サービスの表示](/docs/static/images/TelemetryIngestionKeyView.png)


### ステップ2 

#### アプリケーションのテレメトリーサービスを設定する

#### アプリケーションログ

OpenTelemetryを使用してアプリケーションログを収集します。OneUptimeは現在以下のOpenTelemetry SDKからのログ取り込みをサポートしています。アプリケーションのテレメトリーサービスを設定するには、以下の手順に従ってください。

- [C++](https://opentelemetry.io/docs/instrumentation/cpp/)
- [Go](https://opentelemetry.io/docs/instrumentation/go/)
- [Java](https://opentelemetry.io/docs/instrumentation/java/)
- [JavaScript / TypeScript / NodeJS / ブラウザ](https://opentelemetry.io/docs/instrumentation/js/)
- [Python](https://opentelemetry.io/docs/instrumentation/python/)
- [Ruby](https://opentelemetry.io/docs/instrumentation/ruby/)
- [PHP](https://opentelemetry.io/docs/instrumentation/php/)
- [Erlang](https://opentelemetry.io/docs/instrumentation/erlang/)
- [Rust](https://opentelemetry.io/docs/instrumentation/rust/)
- [.NET / C#](https://opentelemetry.io/docs/instrumentation/net/)
- [Swift](https://opentelemetry.io/docs/instrumentation/swift/)


**OneUptimeとの統合**

アプリケーションのテレメトリーサービスを設定したら、以下の環境変数を設定することでOneUptimeと統合できます。

| 環境変数 | 値 |
| --- | --- |
| OTEL_EXPORTER_OTLP_HEADERS | x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN |
| OTEL_EXPORTER_OTLP_ENDPOINT | https://oneuptime.com/otlp |
| OTEL_SERVICE_NAME | NAME_OF_YOUR_SERVICE |


**例**

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=9c8806e0-a4aa-11ee-be95-010d5967b068
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```


**セルフホストのOneUptime**

OneUptimeをセルフホストしている場合は、セルフホストのOpenTelemetryコレクターエンドポイントに変更できます（例：`http(s)://YOUR-ONEUPTIME-HOST/otlp`）

アプリケーションを実行すると、OneUptimeのテレメトリーサービスページでログを確認できます。ご不明な点がある場合は、support@oneuptime.com にお問い合わせください。


#### OpenTelemetryコレクターを使用する

アプリケーションから直接テレメトリーデータを送信する代わりに、OpenTelemetryコレクターを使用することもできます。
OpenTelemetryコレクターを使用する場合は、コレクターの設定ファイルでOneUptimeエクスポーターを設定できます。

以下はOpenTelemetryコレクターの設定例です。

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:

  # HTTP経由でエクスポート
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # デフォルトのProto(buf)の代わりにJSONエンコーダーを使用する必要があります
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "ONEUPTIME_TOKEN" # OneUptimeトークン

service:
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [otlphttp]
    metrics:
      receivers: [otlp]
      exporters: [otlphttp]
    logs:
      receivers: [otlp]
      exporters: [otlphttp]
```
