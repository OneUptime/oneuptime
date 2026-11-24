# Fluent Bit

[Fluent Bit](https://docs.fluentbit.io/manual) は、ファイル、systemd、コンテナー、syslog、HTTP など多くのソースからログを集める軽量なエージェントです。その [OpenTelemetry 出力](https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry) が集めたデータを OneUptime の OpenTelemetry (OTLP) エンドポイントに送り、ログは **製品 → ログ** で検索できるようになります。

:::cards
- [Fluent Bit を構成する](#fluent-bit-を構成する): OpenTelemetry 出力を追加し、サービスに名前を付けます。
- [完全な例](#完全な例): そのまま使い始められる構成ファイル全体。
- [セルフホストの OneUptime](#セルフホストの-oneuptime): Fluent Bit を自分のインスタンスに向けます。
:::

## 仕組み

```mermaid title="Fluent Bit から OneUptime へ"
flowchart TB
    sources["ファイル、コンテナー、syslog、HTTP"] --> inputs["Fluent Bit の入力"]
    inputs --> envelope["opentelemetry_envelope プロセッサー"]
    envelope --> name["content_modifier が service.name を設定"]
    name --> output["opentelemetry 出力"]
    output -->|"OTLP/HTTP + 取り込みキー"| oneuptime["OneUptime /otlp/v1/logs"]
    oneuptime --> logs["ログ"]
```

Fluent Bit は各レコードを OpenTelemetry のエンベロープで包み、`service.name` のようなリソース属性を持てるようにします。次に OpenTelemetry 出力が、`x-oneuptime-token` ヘッダーに取り込みキーを入れて、レコードを OneUptime に送ります。OneUptime はそれらを `service.name` が示すサービスに保存し、最初に送信されたときにそのサービスを作成します。

## 始める前に

- **Fluent Bit をインストールする**: [インストールガイド](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit) を参照してください。このページの構成は Fluent Bit の YAML 形式と `opentelemetry_envelope` プロセッサーを使うので、最新のリリースを使ってください。
- **OneUptime プロジェクト。** OneUptime Cloud では、テレメトリは取り込んだ GB 単位で課金されます ([料金](https://oneuptime.com/pricing) を参照)。また Free プランのプロジェクトは、テレメトリを送る前に支払い方法を登録する必要があります。
- **テレメトリ取り込みキー。** まだない場合は次の手順で作成します。

:::steps
### 取り込みキーを開く

**製品 → プロジェクト設定** に移動し、サイドメニューで **テレメトリと APM** を開いて **取り込みキー** を選びます。

![「取り込みキー」の一覧。「取り込みキーを作成」を枠で囲んでいます](screen:ingestion-keys)

### キーを作成する

**取り込みキーを作成** をクリックします。ダイアログにはキーの名前が入力済みで、**サーバー** (アプリケーションや Collector が送信に使う種類のキー) が選ばれているので、そのまま **取り込みキーを作成** をクリックして作成するか、先に名前を変更します。

### シークレットをコピーする

新しいキーは専用のページで開きます。その **シークレットキー** をコピーしてください。これが下の構成の `YOUR_TELEMETRY_INGESTION_TOKEN` です。

![シークレットキーが表示されたテレメトリ取り込みキーのページ](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## Fluent Bit を構成する

Fluent Bit は、`/etc/fluent-bit/fluent-bit.yaml` などのファイルから YAML の構成を読み込みます。

:::steps
### OpenTelemetry 出力を追加する

OneUptime に送る `opentelemetry` 出力を追加します。レコードを手元で確認したい場合は、テストの間 `stdout` 出力を残しておきます。

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

`retry_limit: 8640` は、OneUptime が混み合っているとき (`429`) や再起動中のとき (`502`、`503`、`504`) にチャンクを約 30 秒ごと (`scheduler.base` と `scheduler.cap`) に、約 72 時間送り直します。Fluent Bit の既定では、もう 1 回だけ試して破棄します。`storage.path` は、まだ送っていないチャンクをディスクに保持するので、Fluent Bit を再起動してもどれも失われません。これは次の手順のように `storage.type: filesystem` を設定した入力に効きます。Fluent Bit はそのフォルダーに書き込める必要があります。パッケージのサービスは root で動くので、手動で動かすときは `sudo` を付けてください。`storage.total_limit_size: 512M` は出力ごとに最大 512 MB まで保持し、いっぱいになると古いチャンクから破棄します。

### ログを OpenTelemetry のエンベロープで包み、サービスに名前を付ける

各入力に `opentelemetry_envelope` プロセッサーを追加し、その後に `service.name` を設定する `content_modifier` を続けます。`YOUR_SERVICE_NAME` は、OneUptime でログを表示したい名前に置き換えます。

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

`db` は各ファイルでの tail の位置を保持するので、再起動してもそこから読み続けます。これがないと、Fluent Bit は各ファイルの末尾から読み直し、停止中に書かれた行は送られません。`storage.type: filesystem` は入力のチャンクを `storage.path` に保持します。

### Fluent Bit を再起動する

`fluent-bit` パッケージのサービスが読むのは、このファイルではなく、パッケージ自身の例である `/etc/fluent-bit/fluent-bit.conf` です。drop-in でサービスを `/etc/fluent-bit/fluent-bit.yaml` に向け、今すぐ、そして起動のたびに動くようにします。

```bash
sudo mkdir -p /etc/systemd/system/fluent-bit.service.d
printf '[Service]\nExecStart=\nExecStart=/opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml\n' | sudo tee /etc/systemd/system/fluent-bit.service.d/fluent-bit-yaml.conf
sudo systemctl daemon-reload
sudo systemctl enable fluent-bit
sudo systemctl restart fluent-bit
```

空の `ExecStart=` は、パッケージ自身の起動行を消します。先にフォアグラウンドでファイルを試すには、`sudo /opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml` を実行します。パッケージはプログラムを `/opt/fluent-bit/bin` に置きますが、ここは `PATH` に入っていません。数秒後にはログが **製品 → ログ** に表示され、サービスが **製品 → サービス** に並びます。
:::

## 完全な例

この構成は、ポート `8888` で HTTP 経由のログをこのホストからだけ受け取り、OneUptime に転送します。

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

`listen: 127.0.0.1` はこのホストからだけログを受け取ります。`http` 入力はキーを求めないので、`listen: 0.0.0.0` にするとポートに届く人は誰でも、あなたの取り込みキーで OneUptime にログを送れます。`http` 入力は必要な入力に置き換えてください (たとえばログファイルなら `tail`、ジャーナルなら `systemd`)。どの入力にも 2 つのプロセッサーと `storage.type: filesystem` を残します。

## HTTP 出力で送る

Fluent Bit の [HTTP 出力](https://docs.fluentbit.io/manual/pipeline/outputs/http) は、OneUptime の Fluentd エンドポイントに送ることもできます。各レコードは [Fluentd のページ](/docs/telemetry/fluentd) の説明どおりに読み取られます。`format` を、下の例のように `json_lines` に、または `json` に設定してください。OneUptime はどちらも読み取り、`compress: gzip` で圧縮していてもいなくても構いません。Fluent Bit の既定の形式である `msgpack` は拒否されます。

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

## セルフホストの OneUptime

`host` を OneUptime インスタンスのホストに設定します。HTTPS ではなく通常の HTTP で提供している場合は、`port` も待ち受けポート (通常は `80`) に設定し、`tls` を削除します。

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

## トラブルシューティング

:::details Fluent Bit が OpenTelemetry 出力から `401` を記録する
取り込みキーがない、不明、または期限切れです。`header` の行を確認してください。`x-oneuptime-token`、空白 1 つ、そしてキーの **シークレットキー** の順です。
:::

:::details Fluent Bit が `402` または `422` を記録する
`402`: OneUptime Cloud で、プロジェクトが Free プランで支払い方法がありません。**プロジェクト設定 → 請求と請求書 → 請求** で追加してください。`422`: キーが無効化されているか、ブラウザーキーです。キーの設定で **有効** をオンに戻すか、**サーバー** キーを作成してください。
:::

:::details ログが想定外のサービスで届く
サービスは `service.name` で決まります。すべての入力に `opentelemetry_envelope` プロセッサーがあり、その後にそれを設定する `content_modifier` が続いていることを確認してください。
:::

:::details 何も届かず、Fluent Bit が接続エラーを記録する
HTTPS エンドポイントに対して `tls: On` と `port: 443` が設定されていること、そして Fluent Bit を実行しているホストからそのポートで OneUptime のホストに到達できることを確認してください。
:::

:::details Fluent Bit が `cannot be retried` を記録する
Fluent Bit が送れなかったチャンクを破棄しました。上の設定のように `retry_limit: 8640` があれば、OneUptime が `429`、`502`、`503`、`504` を返したチャンクを約 30 秒ごとに約 72 時間送り直します。Fluent Bit の既定では、もう 1 回だけ試します。`400`、`401`、`402`、`413`、`422`、`500` は毎回同じ応答になるので、すぐに破棄されます。キー、プラン、リクエストのサイズを確認してください。
:::

構成についてご質問やサポートが必要な場合は、support@oneuptime.com までご連絡ください。

## 次のステップ

:::cards
- [ログパイプライン](/docs/telemetry/log-pipelines): Fluent Bit が送るログを解析し、情報を付け加えます。
- [検索構文](/docs/telemetry/search-syntax): ログのエクスプローラーでログを探します。
- [OpenTelemetry](/docs/telemetry/open-telemetry): すべてのテレメトリのエンドポイント、キー、制限。
- [Fluentd](/docs/telemetry/fluentd): 代わりに Fluentd を使います。
:::
