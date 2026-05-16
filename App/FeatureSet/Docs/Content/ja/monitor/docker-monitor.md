# Dockerモニター

Dockerモニタリングを使用すると、Dockerホストおよびその上で実行されているコンテナの正常性とパフォーマンスを監視できます。OneUptimeは事前設定済みのOpenTelemetryコレクター（**OneUptime Dockerエージェント**）を介してメトリクスとコンテナログを収集し、設定した条件に基づいてそれらを評価します。

## 概要

Dockerモニターはホストのメトリクスとログを使用して、コンテナワークロードの可視性を提供します。これにより、以下のことが可能になります。

- DockerホストおよびコンテナごとのOSの正常性監視
- コンテナ全体のCPU、メモリ、ネットワーク、ブロックI/O、プロセス数の追跡
- コンテナの再起動、クラッシュ、CPUスロットリングの検出
- ネイティブなOpenTelemetry形式での構造化コンテナログのストリーミング
- 高CPU使用率、高メモリ使用率、再起動ループなどに関するアラート

## Dockerモニターの作成

1. OneUptime ダッシュボードで **モニター** を開きます
2. **モニターの作成** をクリックします
3. モニタータイプとして **Docker** を選択します
4. 監視するDockerホストとリソーススコープを選択します
5. メトリクスクエリと集計を設定します
6. 必要に応じて監視条件を設定します

## 設定オプション

### Dockerホスト

監視するDockerホストを選択します。ホストはOneUptime Dockerエージェントが最初にテレメトリーを送信した際に自動登録されるため、手動で作成する必要はありません。

### リソーススコープ

リソースを監視するレベルを選択します。

| スコープ | 説明 |
|-------|-------------|
| ホスト | すべてのコンテナを集計してDockerホスト全体を監視 |
| コンテナ | 名前またはイメージで特定のコンテナを監視 |

### メトリクスクエリ

評価する1つ以上のメトリクスクエリを設定します。各クエリは以下を指定します。

- **メトリクス名** — 照会するコンテナメトリクス
- **集計** — メトリクス値の集計方法（平均、合計、最大、最小）
- **フィルター** — 追加の属性ベースのフィルタリング（コンテナ名、イメージ、ホストなど）
- **グループ化** — `resource.container.name` でグループ化して各コンテナを個別に評価することも可能

複数のメトリクスクエリを数式で組み合わせた**フォーミュラ**も作成できます。

### ローリング時間ウィンドウ

メトリクス評価の時間ウィンドウを選択します。

- 過去1分
- 過去5分
- 過去10分
- 過去15分
- 過去30分
- 過去60分

## 収集されるメトリクス

DockerエージェントはOpenTelemetryの `docker_stats` レシーバーを使用し、Docker Engine APIを設定可能な間隔（デフォルトは30秒ごと）でスクレイピングします。

### CPU

| メトリクス | 説明 |
|--------|-------------|
| `container.cpu.utilization` | ホストCPUに対するCPU使用率（パーセント） |
| `container.cpu.usage.total` | コンテナが消費した累積CPU時間 |
| `container.cpu.throttling_data.throttled_time` | cgroupsによってスロットリングされた時間 |
| `container.cpu.throttling_data.throttled_periods` | スロットリング期間の数 |

### メモリ

| メトリクス | 説明 |
|--------|-------------|
| `container.memory.usage.total` | 現在のメモリ使用量（バイト） |
| `container.memory.usage.limit` | メモリ制限（バイト） |
| `container.memory.percent` | 制限に対するメモリ使用率（パーセント） |

### ネットワーク

| メトリクス | 説明 |
|--------|-------------|
| `container.network.io.usage.rx_bytes` | 受信バイト数の合計 |
| `container.network.io.usage.tx_bytes` | 送信バイト数の合計 |

### ブロックI/O

| メトリクス | 説明 |
|--------|-------------|
| `container.blockio.io_service_bytes_recursive.read` | ブロックデバイスから読み取ったバイト数 |
| `container.blockio.io_service_bytes_recursive.write` | ブロックデバイスに書き込んだバイト数 |

### コンテナ情報

| メトリクス | 説明 |
|--------|-------------|
| `container.uptime` | コンテナの稼働時間（秒） |
| `container.restarts` | コンテナが再起動した回数 |
| `container.pids.count` | コンテナ内のプロセス数 |

## 監視条件

### 利用可能なチェックタイプ

| チェックタイプ | 説明 |
|------------|-------------|
| メトリクス値 | 設定したメトリクスクエリまたはフォーミュラの値 |

### 集計タイプ

| 集計 | 説明 |
|-------------|-------------|
| 平均 | 時間ウィンドウ内の平均値 |
| 合計 | すべての値の合計 |
| 最大値 | 時間ウィンドウ内の最大値 |
| 最小値 | 時間ウィンドウ内の最小値 |
| すべての値 | すべての値が条件を満たす必要がある |
| いずれかの値 | 少なくとも1つの値が条件を満たす |

### フィルタータイプ

- **より大きい**、**より小さい**、**以上**、**以下**、**等しい**、**等しくない**

## 事前定義されたアラートテンプレート

OneUptimeは一般的なDockerモニタリングシナリオのテンプレートを提供しています。

| テンプレート | 説明 | しきい値 | 集計 |
|----------|-------------|-----------|-------------|
| コンテナのCPU高使用率 | コンテナごとのCPU使用率 | > 90% | 最大（コンテナごと） |
| コンテナのメモリ高使用率 | 制限に対するメモリ使用率 | > 85% | 最大（コンテナごと） |
| CPUスロットリング高頻度 | CPUスロットリング期間数 | > 0 | 最大（コンテナごと） |
| コンテナ再起動ループ | コンテナの再起動回数 | > 3 | 合計 |
| コンテナ停止 | コンテナ稼働時間が0にリセット | = 0 | 最小 |

> 注意：CPU、メモリ、スロットリングのテンプレートは `resource.container.name` でグループ化した **最大** 集計を使用します。これにより、1つのホット（高負荷）コンテナのシグナルが同一ホスト上の多数のアイドルコンテナによって希釈されるのを防ぎます。

## 収集されるログ

メトリクスに加えて、DockerエージェントはOpenTelemetryのfilelogレシーバーを介してすべてのコンテナの `*-json.log` ファイルを追跡し、ネイティブなOTLPログ形式でログレコードを送信します。各ログレコードには以下の情報が付与されます。

- `resource.host.name` — Dockerホスト識別子
- `resource.container.id` — 完全なコンテナID
- `resource.container.runtime` — 常に `docker`
- `attributes["log.iostream"]` — `stdout` または `stderr`
- `severityText` / `severityNumber` — ストリームから導出：`stderr` → `ERROR`、`stdout` → `INFO`
- `body` — コンテナプロセスが出力した生のログ行
- `time` — Dockerデーモンがその行に記録したタイムスタンプ

ログはDockerホストの **ログ** タブおよび各コンテナの詳細ページに表示されます。

### ログドライバーの要件

**DockerエージェントはDockerの `json-file` ログドライバーを使用するコンテナのログのみを取り込みます。** これはDockerのデフォルトですが、コンテナごとまたはグローバルに上書きできます。

- **`local`** ドライバー — バイナリprotobufチャンクを `/var/lib/docker/containers/<id>/local-logs/container.log` に書き込みます。filelogレシーバーはこの形式を解析できません。
- **`journald`**、**`syslog`**、**`fluentd`**、**`gelf`**、**`awslogs`**、**`splunk`** など — ログをリモート先に送信するため、追跡できるファイルがありません。
- **`none`** — ログを完全に破棄します。

上記のいずれかが使用されている場合、Dockerホストページにはメトリクスのみが表示され、**ログ** タブは空になります（またはDockerエージェント自身のログのみが含まれます）。

**特定のコンテナのログドライバーを確認する：**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**デーモンのデフォルトを確認する：**

```bash
docker info --format '{{.LoggingDriver}}'
```

**Docker Composeサービスを適切なローテーション設定で `json-file` に切り替える：**

```yaml
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
```

**デーモンのデフォルトを切り替える**（以降に作成されるすべてのコンテナに適用される）には `/etc/docker/daemon.json` を編集します：

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

その後、Dockerデーモンを再起動し、影響を受けるコンテナを**再作成**します。Dockerはコンテナ作成時にログドライバーをバインドするため、既存のコンテナは削除して再作成するまで古いドライバーを使い続けます。

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# 通常のdocker
docker rm -f <container>
docker run ... <image>
```

## セットアップ要件

Dockerモニタリングを使用するには、以下が必要です。

1. 監視する各DockerホストにOneUptime Dockerエージェントをインストール
2. `ONEUPTIME_URL`、`ONEUPTIME_SERVICE_TOKEN`、`DOCKER_HOST_NAME` を環境変数として渡す
3. 観察したいコンテナが `json-file` ログドライバーを使用していることを確認（上記参照）

エージェントは Docker Hub の `oneuptime/docker-agent:release` として公開されています。完全な `docker run` および `docker compose` の例については、[Dockerエージェントのインストールガイド](https://github.com/OneUptime/oneuptime/tree/master/DockerAgent)を参照してください。

## トラブルシューティング

### メトリクスは表示されるがログタブが空の場合

コンテナがほぼ確実に `json-file` ログドライバーを使用していません。上記の[ログドライバーの要件](#ログドライバーの要件)セクションの診断コマンドを実行し、ログを送信する必要があるコンテナを切り替えてください。

### filelogレシーバーが `no files match the configured criteria` をログに記録する場合

これは、エージェント起動時にインクルードグロブ `/var/lib/docker/containers/*/*-json.log` がどのファイルにもマッチしなかったことを意味します。原因は以下のいずれかです。

1. このホスト上のどのコンテナも `json-file` を使用していない
2. バインドマウント `-v /var/lib/docker/containers:/var/lib/docker/containers:ro` が欠落しているか、空のディレクトリを指している
3. エージェントがmacOS上のDocker Desktopで実行されており、LinuxVMのコンテナディレクトリが公開されていない

### ログが間違ったホスト名でグループ化される場合

OneUptimeは `resource.host.name` によってDockerホストを自動登録します。この値は `DOCKER_HOST_NAME` 環境変数から取得されます。最初のテレメトリーバッチ送信後に `DOCKER_HOST_NAME` を変更すると、既存のホストの名前が変更されるのではなく、2つ目のホスト行が作成されます。

### 「CPUが高い」インシデントが発生しない場合

メトリクスクエリの集計が**最大**（平均ではなく）であり、`resource.container.name` でグループ化されていることを確認してください。多数のアイドルコンテナが存在する多忙なホストでの全コンテナの平均値は希釈されるため、しきい値を超えることはほとんどありません。
