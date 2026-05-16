# 受信リクエストイングレス

カスタムプローブはオプションで **インバウンドHTTPリスナー** を実行できます。このリスナーはプライベートネットワーク内からの `heartbeat` および `incoming-request` 呼び出しを受け付け、OneUptimeに転送します。これにより、**アウトバウンドのインターネットアクセスがない** サービスでも、`oneuptime.com` に直接リクエストを送信する代わりにローカルネットワーク上のプローブにリクエストを送信することで、[受信リクエストモニター](/docs/monitor/incoming-request-monitor) に報告できます。

## 概要

`PROBE_INGRESS_PORT` が設定されると、プローブはそのポートに追加のHTTPリスナーをバインドします。リスナーは公開OneUptimeエンドポイントと同じ `secretkey` URLパスを受け付けます。

- `POST /heartbeat/:secretkey`
- `GET /heartbeat/:secretkey`
- `POST /incoming-request/:secretkey`
- `GET /incoming-request/:secretkey`

プローブはリクエストをOneUptimeインスタンスにプロキシし、メソッド、ボディ、リクエストヘッダーを保持します（`Host`、`Connection`、`Content-Length` などのホップバイホップヘッダーを除く）。プローブはリクエストが転送プローブに帰属されるよう、`OneUptime-Probe-Id` ヘッダーを自動的に付加します。

リスナーはプローブの内部ステータス/メトリクスエンドポイントとは別の **専用ポート** で実行されるため、他のものを公開せずにプライベートネットワークに公開できます。

## 使用する場面

以下の場合にイングレスリスナーを使用してください。

- サービスがアウトバウンドHTTPSアクセスのない分離されたネットワークセグメントで実行されている
- すべての監視トラフィックをVPC/オンプレミスネットワーク内に保持する必要がある
- OneUptimeへの到達が許可されている単一のエグレスポイント（プローブ）を必要とする
- [カスタムプローブ](/docs/probe/custom-probe) を既にデプロイしており、インバウンドハートビートにも再利用したい

サービスが `https://oneuptime.com`（またはセルフホストURL）に直接アクセスできる場合は、この機能は不要です。サービスから直接ハートビートURLを呼び出してください。

## イングレスリスナーの有効化

リスナーをバインドするポートを `PROBE_INGRESS_PORT` に設定します。`0` より大きい値を設定するとリスナーが有効になり、未設定（または `0`）にすると無効になります。

### Docker

```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -d oneuptime/probe:release
```

`--network host` を使用しない場合は、イングレスポートを明示的に公開します。

```bash
docker run --name oneuptime-probe \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -p 3875:3875 \
  -d oneuptime/probe:release
```

### Docker Compose

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
      - PROBE_INGRESS_PORT=3875
    ports:
      - "3875:3875"
    restart: always
```

### Kubernetes

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
            - name: PROBE_INGRESS_PORT
              value: "3875"
          ports:
            - name: ingress
              containerPort: 3875
---
apiVersion: v1
kind: Service
metadata:
  name: oneuptime-probe-ingress
spec:
  selector:
    app: oneuptime-probe
  ports:
    - name: ingress
      port: 3875
      targetPort: 3875
  type: ClusterIP
```

内部サービスは `http://oneuptime-probe-ingress.<namespace>.svc.cluster.local:3875/heartbeat/<secret-key>` にハートビートを送信できます。

## プローブへのリクエスト送信

公開ハートビートURLを：

```
https://oneuptime.com/heartbeat/<secret-key>
```

プローブのイングレスURLに置き換えます。

```
http://<probe-host>:<PROBE_INGRESS_PORT>/heartbeat/<secret-key>
```

パス、メソッド、ボディ、ヘッダーは同一なので、既存のクライアントコードはベースURLを変更するだけです。

### 使用例

```bash
# GETハートビート
curl http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY

# JSONボディを使ったPOSTハートビート
curl -X POST http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'

# Cronジョブ
*/5 * * * * curl -s http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY > /dev/null
```

## 転送の動作

- **同期レスポンス、非同期転送。** プローブはインバウンドリクエストを即座に `200` で確認し、バックグラウンドでOneUptimeに転送します。サービスは転送の完了を待つ必要はありません。
- **ヘッダーが保持されます。** ホップバイホップヘッダー（`Host`、`Connection`、`Content-Length`、`Transfer-Encoding`、`Keep-Alive`、`Proxy-Authenticate`、`Proxy-Authorization`、`TE`、`Trailer`、`Upgrade`）を除くすべてのヘッダーが通過します。プローブはプローブ自身を識別する `OneUptime-Probe-Id` ヘッダーを追加します。
- **ボディが保持されます。** JSON、URLエンコード、生の `application/octet-stream` ペイロード（最大 **50 MB**）が受け付けられます。
- **指数バックオフによる再試行。** 転送が失敗した場合、プローブは `PROBE_INGRESS_FORWARD_RETRY_LIMIT` 回まで指数バックオフ（2秒、4秒、8秒、最大15秒）で再試行します。
- **プロキシ対応。** プローブ自体が `HTTP_PROXY_URL` / `HTTPS_PROXY_URL` で設定されている場合、転送リクエストはプロキシを経由します。

## 環境変数

| 変数 | デフォルト | 説明 |
|---|---|---|
| `PROBE_INGRESS_PORT` | _未設定_（無効） | インバウンドリスナーがバインドするポート。`0` より大きい値でイングレスが有効になります。 |
| `PROBE_INGRESS_FORWARD_TIMEOUT_MS` | `10000` | OneUptimeへの各転送試行のタイムアウト（ミリ秒）。最小 `1000`。 |
| `PROBE_INGRESS_FORWARD_RETRY_LIMIT` | `3` | プローブが転送を諦めるまでの再試行回数。`0` に設定すると再試行を無効化。 |

標準プローブ変数（`PROBE_KEY`、`PROBE_ID`、`ONEUPTIME_URL`、プロキシ変数）はすべて適用されます。完全なリストは[カスタムプローブ](/docs/probe/custom-probe)を参照してください。

## セキュリティに関する考慮事項

- **エンドポイントは設計上認証なしです** — URLパス内のシークレットキーが認証手段であり、公開 `oneuptime.com` エンドポイントと同様です。シークレットキーは認証情報として扱ってください。
- **プライベートインターフェースのみにバインドしてください。** イングレスリスナーはパブリックインターネットから到達できてはなりません。ネットワークポリシー、ファイアウォールルール、または `ClusterIP` サービスを使用してアクセスを制限してください。
- **転送中の暗号化が必要な場合はHTTPS終端を使用してください。** プローブのリスナーはプレーンHTTPで通信します。インバウンドホップにTLSが必要な場合は、内部ロードバランサー/イングレスコントローラーの背後に置いてください。プローブからOneUptimeへの転送レッグは常にHTTPSを使用します（`ONEUPTIME_URL` が `https://` の場合）。
- **リソース制限。** リスナーは最大50MBのリクエストボディを受け付けます。より厳しい制限が必要な場合は、前段にリバースプロキシを置いてください。

## トラブルシューティング

- **起動時にプローブが `Probe ingress listener started on port <port>` をログに記録する** — リスナーが起動していることを確認します。この行が見えない場合、`PROBE_INGRESS_PORT` が未設定、`0`、または無効です。
- **`Probe ingress: failed to forward to <url> after N attempts`** — プローブがOneUptimeに到達できませんでした。プローブのアウトバウンド接続、プロキシ設定、`ONEUPTIME_URL` の値を確認してください。
- **`Probe ingress: probe ID not available, forwarding without it`** — プローブがまだ登録されていません。転送は成功しますが、ハートビートはプローブに帰属されません。
- **ハートビートがOneUptimeに表示されるがプローブ経由でない** — サービスが公開URLではなく `http://<probe-host>:<port>/...` にアクセスしていることを確認してください。設定ミスのDNSや `/etc/hosts` エントリが通常の原因です。

## 関連項目

- [カスタムプローブ](/docs/probe/custom-probe)
- [受信リクエストモニター](/docs/monitor/incoming-request-monitor)
