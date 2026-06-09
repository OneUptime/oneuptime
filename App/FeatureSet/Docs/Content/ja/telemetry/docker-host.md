# OneUptime Docker エージェント

## 概要

OneUptime Docker エージェントは、チューニング済みの OpenTelemetry Collector 構成を同梱した、ビルド済みのコンテナイメージです。既存のコンテナの隣で実行すると、ホスト上のすべてのコンテナを自動検出し、CPU / メモリ / ネットワーク / ブロック I/O のメトリクスに加えてコンテナログを収集し、すべてを OTLP 経由で OneUptime に転送します。イメージは 1 つ、コマンドも 1 つだけです。

このページは**インストールガイド**です。エージェントが収集したデータの上に Docker モニターやアラートを構成する方法については、[Docker モニター](/docs/monitor/docker-monitor)を参照してください。

## 前提条件

- Docker Engine 20.10 以上
- ホスト上の `/var/run/docker.sock` へのアクセス
- **OneUptime Telemetry Ingestion Token** — *Project Settings → Telemetry Ingestion Keys* から作成し、その値をコピーしてください

## クイックスタート（1 コマンド）

`YOUR_ONEUPTIME_URL`、`YOUR_TELEMETRY_INGESTION_TOKEN`、およびホスト名を、ご自身の環境の値に置き換えてください。ホスト名は、この Docker ホストが OneUptime 上でどのように表示されるかを決めるものです。`prod-docker-01` のような名前を選んでください。

```bash
docker run -d \
  --name oneuptime-docker-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /var/lib/docker/containers:/var/lib/docker/containers:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/docker-agent:release
```

これだけです。エージェントが接続すると、お使いの Docker ホストが OneUptime ダッシュボードの **Docker** セクションに自動的に表示されます。

## 代替手段 — Docker Compose

Docker Compose を使いたい場合は、以下を `docker-compose.yml` に記述してください。

```yaml
services:
  oneuptime-docker-agent:
    image: oneuptime/docker-agent:release
    container_name: oneuptime-docker-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - DOCKER_HOST_NAME=my-docker-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

起動します。

```bash
docker compose up -d
```

## 環境変数

| 変数 | 必須 | 説明 |
|----------|----------|-------------|
| `ONEUPTIME_URL` | はい | お使いの OneUptime インスタンスの URL（例: `https://oneuptime.com` またはセルフホストのホスト） |
| `ONEUPTIME_SERVICE_TOKEN` | はい | *Project Settings → Telemetry Ingestion Keys* から取得したテレメトリ取り込みトークン |
| `DOCKER_HOST_NAME` | いいえ | このホストのわかりやすい名前。デフォルトは `docker-host` です。ホストごとに安定した値（例: `prod-docker-01`）を設定してください |

## インストールの確認

エージェントが実行中であることを確認します。

```bash
docker ps --filter name=oneuptime-docker-agent
```

エージェントのログを確認します。

```bash
docker logs -f oneuptime-docker-agent
```

次の行を探してください: `"Everything is ready. Begin running and processing data."`

1 分ほどで、ホストがメトリクスとログを送信しながら OneUptime ダッシュボードに表示されるはずです。

## エージェントのアップグレード

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# 上記の `docker run` コマンドを再実行します
```

または Docker Compose を使う場合:

```bash
docker compose pull
docker compose up -d
```

## エージェントのアンインストール

```bash
docker rm -f oneuptime-docker-agent
```

Docker Compose を使用した場合:

```bash
docker compose down
```

## 収集される内容

| カテゴリ | データ |
|----------|------|
| **CPU メトリクス** | 使用量合計、使用率、スロットリング時間（コンテナごと） |
| **メモリメトリクス** | 使用量、上限、使用率、RSS、キャッシュ（コンテナごと） |
| **ネットワークメトリクス** | 受信 / 送信のバイト数とパケット数（コンテナごと） |
| **ブロック I/O メトリクス** | 読み取り / 書き込みのバイト数と操作数（コンテナごと） |
| **コンテナ情報** | 稼働時間、再起動回数、プロセス数 |
| **コンテナログ** | すべてのコンテナの stdout / stderr ログ |

## セルフホストの OneUptime

OneUptime をセルフホストしている場合は、`ONEUPTIME_URL` をご自身のインスタンスに設定してください。

```bash
-e ONEUPTIME_URL="https://your-oneuptime-host.example.com"
```

インスタンスが HTTP のみの場合は、`http://` と適切なポートを使用してください。

## トラブルシューティング

### Docker ソケットのアクセス許可が拒否される

エージェントコンテナは、`/var/run/docker.sock` にアクセスするために root（`--user 0:0`）として実行する必要があります。`--user 0:0` フラグ（または Compose では `user: "0:0"`）が存在することを確認してください。

### エージェントが切断状態として表示される

1. エージェントが実行中であることを確認します: `docker ps --filter name=oneuptime-docker-agent`
2. エージェントのログを確認します: `docker logs oneuptime-docker-agent | grep -i error`
3. OneUptime URL とサービストークンが正しいことを確認します
4. Docker ホストがネットワーク経由で OneUptime インスタンスに到達できることを確認します

### メトリクスが表示されない

1. エージェント内で Docker ソケットにアクセスできることを確認します: `docker exec oneuptime-docker-agent ls -la /var/run/docker.sock`
2. エクスポートエラーがないか Collector のログを確認します: `docker logs oneuptime-docker-agent | tail -100`
3. サービストークンが有効で、有効期限が切れていないことを確認します

### ホスト名がコンテナ ID として表示される

`DOCKER_HOST_NAME` 環境変数にわかりやすい名前を設定し、コンテナを再作成してください。

## 次のステップ

- コンテナの CPU / メモリ / 再起動の条件でアラートを出すために **Docker モニター**を構成します — [Docker モニター](/docs/monitor/docker-monitor)を参照してください。
- スタンドアロンの Docker ホストではなく Kubernetes クラスターの場合は、[OneUptime Kubernetes エージェント](/docs/telemetry/kubernetes-agent)を使用してください。
- コンテナ化されていないホスト（Linux / macOS / Windows の VM やベアメタル）の場合は、[Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector)を使用してください。
