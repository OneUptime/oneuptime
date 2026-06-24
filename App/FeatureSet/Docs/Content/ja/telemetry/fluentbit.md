# FluentBitを使用してOneUptimeにテレメトリーデータを送信する

## 概要

[FluentBit](https://docs.fluentbit.io/manual) プラグインを使用して、アプリケーションとサービスからログ・テレメトリーデータを収集できます。プラグインはテレメトリーデータをOneUptime OpenTelemetry HTTPコレクターに送信します。FluentBitのopentelemetryアウトプットプラグインを使用してテレメトリーデータをOneUptime OpenTelemetry HTTPコレクターに送信できます。このプラグインはこちらで確認できます：https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## はじめに

FluentBitは何百ものデータソースをサポートしており、これらのソースのいずれからでもOneUptimeにログとテレメトリーを取り込むことができます。人気のあるソースの一部：

- Docker
- Syslog
- Apache
- Nginx
- MySQL
- PostgreSQL
- MongoDB
- NodeJS
- Ruby
- Python
- Java
- PHP
- Go
- Rust

その他多数。

サポートされているソースの完全なリストは[こちら](https://docs.fluentbit.io/manual)で確認できます。

## 前提条件

- **ステップ1：FluentBitのインストール** — [こちら](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit)の手順に従ってFluentBitをインストールします
- **ステップ2：OneUptimeアカウントへの登録** — [こちら](https://oneuptime.com)から無料アカウントを登録できます。アカウントは無料ですが、ログの取り込みは有料機能です。価格の詳細は[こちら](https://oneuptime.com/pricing)で確認できます。
- **ステップ3：OneUptimeプロジェクトの作成** — アカウントを取得したら、OneUptime ダッシュボードからプロジェクトを作成できます。プロジェクトの作成に関してご不明な点がある場合は、support@oneuptime.com にお問い合わせください
- **ステップ4：テレメトリー取り込みトークンの作成** — OneUptimeアカウントを作成したら、アプリケーションからログ、メトリクス、トレースを取り込むためのテレメトリー取り込みトークンを作成できます

OneUptimeに登録してプロジェクトを作成した後、ナビゲーションバーの「More」をクリックし、「プロジェクト設定」をクリックします。

テレメトリー取り込みキーページで、「取り込みキーの作成」をクリックしてトークンを作成します。

![サービスの作成](/docs/static/images/TelemetryIngestionKeys.png)

トークンを作成したら、「表示」をクリックしてトークンを確認します。

![サービスの表示](/docs/static/images/TelemetryIngestionKeyView.png)

## 設定

以下の設定を使用して、テレメトリーデータをOneUptime OpenTelemetry HTTPコレクターに送信できます。この設定をfluentbitの設定ファイルに追加します。設定ファイルは通常 `/etc/fluent-bit/fluent-bit.yaml` にあります。以下はoutputsセクションの設定例です：

```yaml
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
```

inputセクションにopentelemetry_envelopeを追加してください。以下はinputセクションの例です：

```yaml
pipeline:
  inputs:
    # 入力設定

    processors:
      logs:
        - name: opentelemetry_envelope

        - name: content_modifier
          context: otel_resource_attributes
          action: upsert
          key: service.name
          # YOUR_SERVICE_NAMEをサービス名に置き換えてください
          value: YOUR_SERVICE_NAME
```

完全な設定ファイルの例：

```yaml
service:
  flush: 1
  log_level: info

pipeline:
  inputs:
    - name: http
      listen: 0.0.0.0
      port: 8888

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
```

**OneUptimeをセルフホストしている場合：** セルフホストのOneUptimeをご利用の場合は、`host` をOneUptimeインスタンスのホストに変更できます。HTTPSではなくHTTPサーバーでホスティングしている場合は、`port` をOneUptimeインスタンスのポートに変更できます（おそらくポート80）。

この場合、設定は次のようになります：

```yaml
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
```

## 使用方法

fluentbitの設定ファイルに設定を追加したら、fluentbitサービスを再起動します。サービスを再起動すると、テレメトリーデータがOneUptime HTTPソースに送信されます。OneUptime ダッシュボードでテレメトリーデータを確認できるようになります。設定に関してご不明な点がある場合は、support@oneuptime.com にお問い合わせください。
