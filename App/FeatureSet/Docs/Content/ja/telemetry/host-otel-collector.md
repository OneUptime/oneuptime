# ホスト OpenTelemetry Collector（Linux、macOS、Windows）

## 概要

**OpenTelemetry Collector** を Linux、macOS、Windows の各ホスト上でサービスとして直接実行し、ホストのテレメトリを OTLP 経由で OneUptime へ送信できます。このページでは、コレクターのインストール、OS ごとの設定、そして収集したい内容に応じた適切なレシーバーの選択について順を追って説明します。

- すべての OS での**ホストメトリクス**（CPU、メモリ、ディスク、ファイルシステム、ネットワーク、ロード、プロセス）
- [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver) による `/var/log/**` 配下の**ファイルベースのログ**（Linux、macOS）
- [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver) による **systemd ジャーナル**（Linux）
- tail した `log stream` の出力をラップする [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) による **Apple Unified Log**（macOS）
- [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver) による **Windows イベントログ**
- [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) による **Windows サービスのステータス**（ホストの **Services** タブを支えます）

> **OneUptime Infrastructure Agent はどうなのか？** そのエージェントは、基本的なメトリクスと *Server / VM Monitor* 機能（ステータス、プロセス、アラート）に特化した、独立した軽量の Go デーモンです。ここで説明している OpenTelemetry Collector はそれとは独立しており、ログ（ファイルログ、journald、Windows イベントログ）やより充実したホストメトリクスを標準的な OTLP として取り込みたい場合に適したツールです。両者は同じホスト上で互いに干渉することなく実行できます。

## 前提条件

- **OneUptime Telemetry Ingestion Token** — *Project Settings → Telemetry Ingestion Keys* から作成し、`x-oneuptime-token` の値をコピーします。
- **OpenTelemetry Collector Contrib** ディストリビューション（`otelcol-contrib`）。デフォルトの `otelcol` ビルドには `windowseventlogreceiver`、`journaldreceiver`、`hostmetrics` の追加機能などのレシーバーは**含まれていません** — 必ず `contrib` ディストリビューションを使用してください。
- コレクターをサービスとしてインストールし、（該当する場合は）権限が必要なログソースを読み取るための、ホスト上の Root / Administrator 権限。

## ステップ 1 — OpenTelemetry Collector のインストール

ご利用の OS のセクションを選んでください。すべての例では、[opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) から最新の `otelcol-contrib` リリースをインストールすることを前提としています。

### Linux（Debian / Ubuntu）

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.107.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Debian パッケージは、バイナリを `/usr/bin/otelcol-contrib` に、デフォルト設定を `/etc/otelcol-contrib/config.yaml` に、systemd ユニットを `/etc/systemd/system/otelcol-contrib.service` にインストールします。

### Linux（RHEL / CentOS / Fedora / Amazon Linux）

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.107.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

パスは Debian パッケージと同じです（`/usr/bin/otelcol-contrib`、`/etc/otelcol-contrib/config.yaml`、systemd ユニット `otelcol-contrib`）。

### macOS

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/')
VERSION=0.107.0

curl -L -o otelcol-contrib.tar.gz \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_darwin_${ARCH}.tar.gz"

sudo mkdir -p /usr/local/otelcol-contrib
sudo tar -xzf otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib
sudo ln -sf /usr/local/otelcol-contrib/otelcol-contrib /usr/local/bin/otelcol-contrib
sudo mkdir -p /etc/otelcol-contrib
```

ステップ 2 で `/etc/otelcol-contrib/config.yaml` を、ステップ 3 で `launchd` plist を作成します。

### Windows

[リリースページ](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) から最新の `otelcol-contrib_*_windows_amd64.zip`（または `arm64`）をダウンロードします。**管理者権限の** PowerShell プロンプトから実行します。

```powershell
$dest = "C:\Program Files\otelcol-contrib"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Path "$env:USERPROFILE\Downloads\otelcol-contrib_*_windows_amd64.zip" -DestinationPath $dest
```

ステップ 2 で `C:\Program Files\otelcol-contrib\config.yaml` を作成し、ステップ 3 で Windows サービスを登録します。

## ステップ 2 — コレクターの設定

設定ファイルは以下の場所に置かれます。

| OS | パス |
|---|---|
| Linux | `/etc/otelcol-contrib/config.yaml` |
| macOS | `/etc/otelcol-contrib/config.yaml` |
| Windows | `C:\Program Files\otelcol-contrib\config.yaml` |

どの設定も同じ形をしています — 必要なレシーバーを選び、`batch` プロセッサと `resource` プロセッサを追加し、OTLP HTTP 経由で OneUptime にエクスポートします。以下の例では、OS ごとに完全でコピー＆ペースト可能な設定を示し、その後に各レシーバーブロックを順に説明するので、自由に組み合わせられます。

`YOUR_TELEMETRY_INGESTION_TOKEN` と `service.name` の値は、ご自身の環境に合わせて置き換えてください。

### 共通部分（すべての OS で使用）

```yaml
processors:
  batch:
    send_batch_size: 512
    timeout: 5s

  resource:
    attributes:
      - key: service.name
        value: host-telemetry
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

- **`batch`** はエクスポート前にレコードをまとめるので、レコードごとに 1 回の HTTP ラウンドトリップを発生させずに済みます。
- **`resource`** はすべてのレコードに `service.name` を付与します。各マシンを OneUptime 上で独自のテレメトリサービスとして表示したい場合は、ホストごとに異なる値（例: `prod-web-01`）を使用してください。
- **`otlphttp`** は、取り込みトークンを付与して HTTPS 経由で OneUptime に送信します。

### ホストメトリクス（Linux、macOS、Windows）

すべての OS で動作します。ホストカーネルから CPU、メモリ、ディスク、ファイルシステム、ネットワーク、ロード、ページング、プロセスのメトリクスを取得します。

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:
      process:
        mute_process_name_error: true
```

> Linux では、コレクターは `/proc` と `/sys` を読み取ります。コレクターをコンテナ内で実行する場合は、ホストの `/proc` と `/sys` をマウントし、`HOST_PROC` / `HOST_SYS` 環境変数を設定してください。上記のように systemd サービスとして直接実行する場合は、追加の設定は不要です。

### ファイルログ（Linux、macOS）

ディスク上の任意のログファイルを tail します。以下は一般的な開始セットです。

```yaml
receivers:
  filelog/syslog:
    include:
      - /var/log/syslog
      - /var/log/messages
    start_at: end

  filelog/auth:
    include:
      - /var/log/auth.log
      - /var/log/secure
    start_at: end
```

`start_at: end` は、コレクターが起動した時点からの新しい行を意味します。初回実行時に過去分を取り込むには `beginning` に変更してください。コレクターはファイルオフセットを追跡するため、再起動をまたいでも正しく再開します。

**ホストログのスタックトレースを Exceptions に変換する。** OneUptime はエラーおよび致命的（fatal）なログ行を自動的にスキャンしてスタックトレースを検出し、このホストに紐づけて **Exceptions**（Issues）ビューにまとめます — 追加の設定は不要です。これがうまくグループ化されるためには、複数行のスタックトレース（Java、Python、.NET、Ruby）が 1 行ごとに 1 レコードではなく、**1 つの**ログレコードとして到達する必要があります。トレースとそのフレームがまとまったままになるよう、`filelog` レシーバーで複数行の再結合を有効にしてください。

```yaml
receivers:
  filelog/app:
    include:
      - /var/log/myapp/*.log
    start_at: end
    multiline:
      # A new log entry starts with a timestamp; continuation lines (the
      # "at ...", "File ...", "Caused by: ..." frames) are folded into it.
      line_start_pattern: '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}'
```

再結合を行わないと、各フレームが個別のログとして取り込まれ、例外は 1 行のみのグループ化が不十分な Issue として表示されます。アプリケーションが OpenTelemetry の `exception.type` / `exception.message` / `exception.stacktrace` ログ属性を直接出力できる場合は、代わりにそれを行ってください — それが最も信頼性の高い方法であり、複数行のパースに依存しません。

### systemd ジャーナル（Linux）

ホストが systemd を使用している場合、`journald` レシーバーは `/var/log/*` を tail するよりも適していることが多いです — すべてを 1 か所で取得し、構造化されたフィールドを保持します。

```yaml
receivers:
  journald:
    directory: /var/log/journal
    units:
      # Drop this list to ingest everything; restrict it to limit volume.
      - ssh.service
      - cron.service
      - nginx.service
    priority: info
```

コレクターのバイナリは `journalctl` を実行できる必要があります（Debian / RPM パッケージには依存関係としてすでに含まれています）。

### Apple Unified Log（macOS）

macOS は `/var/log/system.log` を非推奨とし、`log show` / `log stream` で照会する Apple Unified Log を採用しました。これを取り込む最も簡単な方法は、小さなラッパーを使って `log` の出力を `filelog` レシーバー経由でストリーミングすることです。`/usr/local/otelcol-contrib/log-stream.sh` を作成します。

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

これを実行可能にし、launchd の下で（または手早くテストするなら `nohup` で）実行してから、コレクターをそのファイルに向けます。

```yaml
receivers:
  filelog/apple-unified:
    include:
      - /var/log/apple-unified.log
    start_at: end
    operators:
      - type: json_parser
        timestamp:
          parse_from: attributes.timestamp
          layout: '%Y-%m-%d %H:%M:%S.%f%j'
```

（Unified Log が不要な場合はこれをスキップしてください — Mac のフリートは、ホストメトリクスといくつかのファイルログだけで問題なく動作することがよくあります。）

### Windows イベントログ

ネイティブの `wevtapi` を介して、関心のあるチャンネルをサブスクライブします。

```yaml
receivers:
  windowseventlog/system:
    channel: System
    start_at: end

  windowseventlog/application:
    channel: Application
    start_at: end

  windowseventlog/security:
    channel: Security
    start_at: end
```

大量のイベントが発生する `Security` チャンネルを特定のイベント ID に絞り込むには次のようにします。

```yaml
  windowseventlog/security:
    channel: Security
    start_at: end
    query: "*[System[(EventID=4625 or EventID=4740)]]"
```

カスタムまたはアプリケーション固有のチャンネル（*Event Viewer → Applications and Services Logs* 配下に表示されるもの）を読み取るには、その正確な表示名を使用します。

```yaml
  windowseventlog/iis:
    channel: Microsoft-IIS-Logging/Logs
    start_at: end
```

### Windows サービス（メトリクス）

[`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) を介して、Windows サービスの実行状態と起動タイプを報告します。これが OneUptime のホスト上の **Services** タブを構成するものです。これは*メトリクス*レシーバーなので、（ログではなく）メトリクスパイプラインに属します。

```yaml
receivers:
  windows_service:
    collection_interval: 30s
    # Collect every service by default. To cut volume — and avoid the
    # "access denied" noise from services the collector can't open —
    # list just the ones you care about:
    # include_services: [Spooler, W3SVC, MSSQLSERVER]
    # Or collect everything except a few:
    # exclude_services: [TrustedInstaller]
```

このレシーバーは、サービスごとに 1 つの `windows.service.status` ゲージを出力します — 整数値は Win32 サービス状態です（`4` = 実行中、`1` = 停止）— `name` と `startup_mode` の属性が付きます。これは **Windows 専用**であり（Linux や macOS で有効にするとコレクターは起動に失敗します）、現在は **alpha** なので、最近の `otelcol-contrib` リリースに固定してください。サービスを `LocalSystem`（`sc.exe create` のデフォルト）として実行すると、すべてのサービスを読み取れます。

### 完全な例 — Linux ホスト

`/etc/otelcol-contrib/config.yaml`:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

  filelog/syslog:
    include:
      - /var/log/syslog
      - /var/log/messages
      - /var/log/auth.log
    start_at: end

  journald:
    directory: /var/log/journal
    priority: info

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: linux-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog/syslog, journald]
      processors: [resource, batch]
      exporters: [otlphttp]
```

### 完全な例 — macOS ホスト

`/etc/otelcol-contrib/config.yaml`:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

  filelog/system:
    include:
      - /var/log/install.log
      - /var/log/wifi.log
    start_at: end

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: macos-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog/system]
      processors: [resource, batch]
      exporters: [otlphttp]
```

### 完全な例 — Windows ホスト

`C:\Program Files\otelcol-contrib\config.yaml`:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      # 'load' is not supported on Windows — omit it or the scraper errors.
      paging:
      processes:

  windowseventlog/system:
    channel: System
    start_at: end

  windowseventlog/application:
    channel: Application
    start_at: end

  windowseventlog/security:
    channel: Security
    start_at: end

  windows_service:
    collection_interval: 30s

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: windows-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, windows_service]
      processors: [resource, batch]
      exporters: [otlphttp]
    logs:
      receivers:
        - windowseventlog/system
        - windowseventlog/application
        - windowseventlog/security
      processors: [resource, batch]
      exporters: [otlphttp]
```

## ステップ 3 — コレクターをサービスとして実行する

### Linux（systemd）

Debian / RPM パッケージは systemd ユニットをすでにインストールしています。有効化して開始するだけです。

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

コレクター自身のログを追跡するには次のようにします。

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS（launchd）

`/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist` を作成します。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.oneuptime.otelcol-contrib</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/otelcol-contrib</string>
    <string>--config=/etc/otelcol-contrib/config.yaml</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/var/log/otelcol-contrib.out.log</string>
  <key>StandardErrorPath</key><string>/var/log/otelcol-contrib.err.log</string>
</dict>
</plist>
```

読み込みます。

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows（Services）

**管理者権限の** PowerShell プロンプトから実行します。

```powershell
sc.exe create "otelcol-contrib" `
  binPath= "\"C:\Program Files\otelcol-contrib\otelcol-contrib.exe\" --config=\"C:\Program Files\otelcol-contrib\config.yaml\"" `
  start= auto `
  DisplayName= "OpenTelemetry Collector"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

サービスはデフォルトで `LocalSystem` の下で実行され、これは `Security` の Windows イベントログチャンネルを読み取るために必要な権限を持っています。

## ステップ 4 — OneUptime で確認する

1. ホスト上で何らかのシグナルを生成します。
   - **Linux / macOS:** `logger "hello from oneuptime"`（syslog / journald に書き込みます）。
   - **Windows:** 管理者権限のプロンプトから `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"`。
2. OneUptime ダッシュボードで **Telemetry → Services** を開き、設定した `service.name` を選択します。
3. **Metrics** を開きます — ホストメトリクス（CPU、メモリ、ファイルシステムなど）が 1 分以内に表示されるはずです。
4. **Logs** を開きます — ファイルログ / journald のエントリ / Windows イベントログがストリーミングされてくるはずです。検索に役立つ属性には、`log.file.name`、`systemd.unit`、`winlog.channel`、`winlog.event_id`、`winlog.provider.name` などがあります。

## セルフホストの OneUptime

OneUptime をセルフホストしている場合は、エクスポーターを自分のホストに向けます。

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

インスタンスが HTTP のみの場合は、スキームを `http://` に変更し、適切なポートを使用してください。

## プロキシ経由

OpenTelemetry Collector は、標準の `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` 環境変数を尊重します。サービスに対してこれらを設定してください。

- **systemd（Linux）:** `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf` に `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"` を追加し、その後 `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib` を実行します。
- **launchd（macOS）:** plist に `<EnvironmentVariables>` の dict を追加します。
- **Windows サービス:** `sc.exe config` 経由、またはレジストリの `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment` で、サービスに環境変数を設定します。

## トラブルシューティング

- **OneUptime にテレメトリが表示されない**
  - 詳細な出力を得るために、設定に `service.telemetry.logs.level: debug` を追加してコレクターを再起動します。
  - **Linux / macOS:** `journalctl -u otelcol-contrib -f`（Linux）または `tail -f /var/log/otelcol-contrib.err.log`（macOS）。
  - **Windows:** *Event Viewer → Windows Logs → Application* でソース `otelcol-contrib` を確認します。
  - ホストが `https://oneuptime.com/otlp`（またはセルフホストのエンドポイント）に到達できることを確認します。同じマシンから `curl -v https://oneuptime.com/otlp` を実行します。
- **エクスポーターから HTTP 401 が返る** — 取り込みトークンが無効か失効しています。*Project Settings → Telemetry Ingestion Keys* から新しいものを生成してください。
- **`Security` の Windows イベントログでアクセス拒否が返る** — サービスが十分な権限で実行されていません。`LocalSystem`（`sc.exe create` のデフォルト）の下で再作成するか、サービスアカウントに *Manage auditing and security log*（監査とセキュリティログの管理）ユーザー権利を付与してください。
- **`journald` レシーバーが起動に失敗する** — `journalctl` がコレクターの `PATH` 上にあること、および `/var/log/journal` が存在することを確認してください（存在しない場合は `sudo systemd-tmpfiles --create --prefix /var/log/journal` を実行）。
- **大量データ / コスト** — レシーバーを絞り込むか（特定の Windows チャンネル、特定の systemd ユニット、特定のログファイル）、Windows イベントログレシーバーに `query:` フィルターを追加するか、エクスポート前に低重要度のイベントを破棄する `filter` プロセッサを追加します。

## 次のステップ

- 特定のログパターンでアラートを出すために **Logs Monitors** を追加します（例: 5 分間に 5 件を超える `winlog.event_id = 4625` のログオン失敗が発生したらアラートを出す）。
- ホストメトリクスに対する **Metrics Monitors** を追加します（CPU の飽和、ディスク空き容量の不足、スワップ使用量）。
- これを [Server / VM Monitor](/docs/monitor/server-monitor) および [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) と組み合わせて、エンドツーエンドのホスト可視性を実現します。
- 同じ設定を Ansible / Chef / Puppet / Group Policy / Intune / 既存の構成管理ツールを介して、すべてのホストに展開します。
