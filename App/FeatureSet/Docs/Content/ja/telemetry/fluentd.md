# Fluentdを使用してOneUptimeにテレメトリーデータを送信する

## 概要

[Fluentd](https://www.fluentd.org/) プラグインを使用して、アプリケーションとサービスからログ・テレメトリーデータを収集できます。プラグインはテレメトリーデータをOneUptime HTTPソースに送信します。FluentdのHTTPアウトプットプラグインを使用してテレメトリーデータをOneUptime HTTPソースに送信できます。このプラグインはこちらで確認できます：https://docs.fluentd.org/output/http

## はじめに

Fluentdは何百ものデータソースをサポートしており、これらのソースのいずれからでもOneUptimeにログを取り込むことができます。人気のあるソースの一部：

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

サポートされているソースの完全なリストは[こちら](https://www.fluentd.org/datasources)で確認できます。

## 前提条件

- **ステップ1：Fluentdのインストール** — [こちら](https://docs.fluentd.org/installation)の手順に従ってFluentdをインストールします
- **ステップ2：OneUptimeアカウントへの登録** — [こちら](https://oneuptime.com)から無料アカウントを登録できます。アカウントは無料ですが、ログの取り込みは有料機能です。価格の詳細は[こちら](https://oneuptime.com/pricing)で確認できます。
- **ステップ3：OneUptimeプロジェクトの作成** — アカウントを取得したら、OneUptime ダッシュボードからプロジェクトを作成できます。プロジェクトの作成に関してご不明な点がある場合は、support@oneuptime.com にお問い合わせください
- **ステップ4：テレメトリー取り込みトークンの作成** — OneUptimeアカウントを作成したら、アプリケーションからログ、メトリクス、トレースを取り込むためのテレメトリー取り込みトークンを作成できます

OneUptimeに登録してプロジェクトを作成した後、ナビゲーションバーの「More」をクリックし、「プロジェクト設定」をクリックします。

テレメトリー取り込みキーページで、「取り込みキーの作成」をクリックしてトークンを作成します。

![サービスの作成](/docs/static/images/TelemetryIngestionKeys.png)

トークンを作成したら、「表示」をクリックしてトークンを確認します。

![サービスの表示](/docs/static/images/TelemetryIngestionKeyView.png)


## 設定

以下の設定を使用して、テレメトリーデータをOneUptime HTTPソースに送信できます。この設定をfluentdの設定ファイルに追加します。設定ファイルは通常 `/etc/fluentd/fluent.conf` または `/etc/td-agent/td-agent.conf` にあります。

`YOUR_SERVICE_TOKEN` を前のステップで作成したトークンに置き換えてください。また、`YOUR_SERVICE_NAME` をサービスの名前に置き換えてください。サービスの名前は任意の名前で構いません。OneUptimeにサービスが存在しない場合は、自動的に作成されます。

```yaml
# すべてのパターンにマッチ 
<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```


完全な設定ファイルの例：

```yaml
####
## ソースの説明:
##

## 組み込みTCP入力
## @see https://docs.fluentd.org/input/forward
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```

**OneUptimeをセルフホストしている場合：** セルフホストのOneUptimeをご利用の場合は、`endpoint_url` をOneUptimeインスタンスのURLに変更できます。`http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`

## 使用方法

fluentdの設定ファイルに設定を追加したら、fluentdサービスを再起動します。サービスを再起動すると、テレメトリーデータがOneUptime HTTPソースに送信されます。OneUptime ダッシュボードでテレメトリーデータを確認できるようになります。設定に関してご不明な点がある場合は、support@oneuptime.com にお問い合わせください。
