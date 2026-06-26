## カスタムプローブの設定

プライベートネットワーク内のリソースやファイアウォールの内側にあるリソースを監視するために、ネットワーク内にカスタムプローブを設定できます。

まず、OneUptime ダッシュボードのプロジェクト設定 > プローブでカスタムプローブを作成します。OneUptime ダッシュボードでカスタムプローブを作成すると、`PROBE_ID` と `PROBE_KEY` が取得できます。

### プローブのデプロイ

#### Docker

プローブを実行するには、Dockerがインストールされていることを確認してください。以下のコマンドでカスタムプローブを実行できます。

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

OneUptimeをセルフホストしている場合は、`ONEUPTIME_URL` をカスタムセルフホストインスタンスに変更できます。

##### プロキシ設定

プローブがOneUptimeや外部リソースへのアクセスにプロキシサーバーを経由する必要がある場合、以下の環境変数を使用してプロキシ設定ができます。

```
# HTTPプロキシの場合
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# HTTPSプロキシの場合
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# 認証付きプロキシの場合
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```

#### Docker Compose

docker-composeを使用してプローブを実行することもできます。以下の内容で `docker-compose.yml` ファイルを作成してください。

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

##### プロキシ設定を使用する場合

プロキシサーバーを使用する必要がある場合は、プロキシの環境変数を追加できます。

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      # プロキシ設定（オプション）
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # 認証付きプロキシの場合:
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

次に以下のコマンドを実行してください。

```
docker compose up -d
```

OneUptimeをセルフホストしている場合は、`ONEUPTIME_URL` をカスタムセルフホストインスタンスに変更できます。

#### Kubernetes

Kubernetesを使用してプローブを実行することもできます。以下の内容で `oneuptime-probe.yaml` ファイルを作成してください。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

##### プロキシ設定を使用する場合

プロキシサーバーを使用する必要がある場合は、プロキシの環境変数を追加できます。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            # プロキシ設定（オプション）
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
            # 認証付きプロキシの場合:
            # - name: HTTP_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: HTTPS_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: NO_PROXY
            #   value: "localhost,.internal.example.com"
```

次に以下のコマンドを実行してください。

```bash
kubectl apply -f oneuptime-probe.yaml
```

OneUptimeをセルフホストしている場合は、`ONEUPTIME_URL` をカスタムセルフホストインスタンスに変更できます。

### 環境変数

プローブは以下の環境変数をサポートしています。

#### 必須変数

- `PROBE_KEY` - OneUptime ダッシュボードのプローブキー
- `PROBE_ID` - OneUptime ダッシュボードのプローブID
- `ONEUPTIME_URL` - OneUptimeインスタンスのURL（デフォルト：https://oneuptime.com）

#### オプション変数

- `HTTP_PROXY_URL` - HTTPリクエスト用のHTTPプロキシサーバーURL
- `HTTPS_PROXY_URL` - HTTPSリクエスト用のHTTPプロキシサーバーURL
- `NO_PROXY` - プロキシをバイパスするホストまたはドメインのカンマ区切りリスト
- `PROBE_NAME` - プローブのカスタム名
- `PROBE_DESCRIPTION` - プローブの説明
- `PROBE_MONITORING_WORKERS` - 監視ワーカーの数（デフォルト：1）
- `PROBE_MONITOR_FETCH_LIMIT` - 一度に取得するモニター数（デフォルト：10）
- `PROBE_MONITOR_RETRY_LIMIT` - 失敗したモニターの再試行回数（デフォルト：3）
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` - 合成モニタースクリプトのタイムアウト（ミリ秒、デフォルト：60000）
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` - カスタムコードモニタースクリプトのタイムアウト（ミリ秒、デフォルト：60000）

#### プロキシ設定

プローブはHTTPとHTTPSの両方のプロキシサーバーをサポートしています。設定すると、プローブはすべての監視トラフィックを指定されたプロキシサーバー経由でルーティングします。カンマ区切りの `NO_PROXY` リストを指定して、内部ホストやネットワークのプロキシをバイパスすることもできます。

**プロキシURLの形式：**

```
http://[username:password@]proxy.server.com:port
```

**例：**

- 基本プロキシ：`http://proxy.example.com:8080`
- 認証付き：`http://username:password@proxy.example.com:8080`

**サポートされる機能：**

- HTTPおよびHTTPSプロキシサポート
- プロキシ認証（ユーザー名/パスワード）
- HTTPとHTTPSプロキシ間の自動フォールバック
- `NO_PROXY` を使用した選択的プロキシバイパス
- すべての監視タイプで機能（ウェブサイト、API、SSL、合成など）

**注意：** 標準環境変数（`HTTP_PROXY_URL`、`HTTPS_PROXY_URL`、`NO_PROXY`）と小文字バリアント（`http_proxy`、`https_proxy`、`no_proxy`）の両方が互換性のためにサポートされています。

### 確認

プローブが正常に実行されている場合、OneUptime ダッシュボードに `接続済み` として表示されます。接続されていない場合は、コンテナのログを確認してください。それでも問題が解決しない場合は、[GitHub](https://github.com/oneuptime/oneuptime) でissueを作成するか、[サポートにお問い合わせください](https://oneuptime.com/support)。
