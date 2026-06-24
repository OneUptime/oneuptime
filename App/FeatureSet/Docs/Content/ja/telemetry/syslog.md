# OneUptimeにSyslogデータを送信する

## 概要

OpenTelemetry IngestサービスはネイティブのSyslogペイロードを受け付けるようになりました。RFC3164またはRFC5424互換のソースからHTTPS経由で直接OneUptimeにメッセージを転送できます。OneUptimeはsyslogの優先度、ファシリティ、重大度、構造化データ、メッセージ本文を解析してから、すべてを検索可能なログとして保存します。

## 前提条件

- **テレメトリー取り込みトークン** — _プロジェクト設定 → テレメトリー取り込みキー_ から作成し、`x-oneuptime-token` の値をコピーします。
- **Syslogフォワーダー** — HTTPのPOSTリクエストを送信できる任意のツール（例：`curl`、`omhttp` 経由の `rsyslog`、HTTP宛先プラグインを使った `syslog-ng`）。
- **サービス名（オプション）** — `x-oneuptime-service-name` ヘッダーを設定して受信ログを特定のテレメトリーサービスにグループ化します。省略するとOneUptimeはsyslogの `APP-NAME`、ホスト名、または `Syslog` にフォールバックします。

## エンドポイント

```
POST https://oneuptime.com/syslog/v1/logs
```

- OneUptimeをセルフホストしている場合は、`oneuptime.com` を自分のホストに置き換えてください。
- リクエストには必ず `x-oneuptime-token` ヘッダーを含めてください。

## リクエストボディ

改行区切りのSyslog文字列または `messages` 配列を持つJSONペイロードを送信します。RFC3164（BSD）とRFC5424の両方の形式がサポートされています。

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### サポートされるコンテンツタイプ

- `application/json` — 推奨
- `text/plain` — 改行区切りのメッセージ
- `application/octet-stream` — 生ペイロード。Gzip圧縮（`Content-Encoding: gzip`）も受け付けます。

## curlを使ったクイックテスト

```bash
curl \
  -X POST https://oneuptime.com/syslog/v1/logs \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: YOUR_TELEMETRY_KEY" \
  -H "x-oneuptime-service-name: production-web" \
  -d '{
    "messages": [
      "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login"
    ]
  }'
```

## rsyslogからの転送

1. HTTPアウトプットモジュールをインストールします：
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. 宛先を `/etc/rsyslog.d/oneuptime.conf` に追加します：

   ```
   module(load="omhttp")

   template(name="OneUptimeJson" type="list") {
     constant(value="{\"messages\":[\"")
     property(name="rawmsg")
     constant(value="\"]}")
   }

   action(
     type="omhttp"
     server="oneuptime.com"
     serverport="443"
     usehttps="on"
     endpoint="/syslog/v1/logs"
     header="Content-Type: application/json"
     header="x-oneuptime-token: YOUR_TELEMETRY_KEY"
     header="x-oneuptime-service-name: rsyslog-demo"
     template="OneUptimeJson"
   )
   ```

3. rsyslogを再起動します：
   ```bash
   sudo systemctl restart rsyslog
   ```

## すでに見られている一般的なユースケース

### 1. ネットワーク・セキュリティ機器

ほとんどのネットワーク機器は、設定の変更、ACLのヒット、脅威の検出を依然としてsyslog経由でのみ公開しています。既存のリレー（Palo Alto、Fortinet、Cisco ASA、Juniper、pfSenseなど）を直接OneUptimeに向けるか、内部リレーを維持してHTTPS経由で転送します：

```bash
# メッセージをJSONにバッチ処理してOneUptimeにPOSTするrsyslogスニペット
module(load="omhttp")

template(name="OneUptimeJSON" type="list") {
  constant(value="{\"messages\":[\"")
  property(name="rawmsg")
  constant(value="\"]}")
}

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: perimeter-firewall"
  template="OneUptimeJSON"
)
```

### 2. Linuxサーバーとcronジョブ

多くのcronジョブやレガシーデーモンはカーネル/syslogファシリティ経由でのみログを記録します。`/var/log/syslog` やjournaldエントリを転送することで、運用上のブレッドクラムを一か所に保持できます。SystemdホストはjournaldとsyslogブリッジN:

```bash
# /etc/rsyslog.d/oneuptime.conf
module(load="imjournal" StateFile="imjournal.state")
module(load="omhttp")

action(
  type="omhttp"
  server="oneuptime.com"
  serverport="443"
  usehttps="on"
  endpoint="/syslog/v1/logs"
  header="Content-Type: application/json"
  header="x-oneuptime-token: <TOKEN>"
  header="x-oneuptime-service-name: linux-fleet"
  template="OneUptimeJSON"
)
```

重大度コードのマッピングを行うため、`syslog.severity.name = "error"` でアラートを設定したり、`syslog.hostname` でスライスして騒がしいボックスを素早く特定したりできます。

### 3. KubernetesのイングレスコントローラーとエッジノードN

Fluent BitやFluentdを既に実行している場合は、コンテナログはそのまま使用し、エッジのホストや機器用に軽量なsyslogシンクを追加します。Fluent Bitの `syslog` 入力はHTTP出力と組み合わせます：

```ini
[INPUT]
    Name              syslog
    Mode              tcp
    Listen            0.0.0.0
    Port              5140

[OUTPUT]
    Name              http
    Match             *
    Host              oneuptime.com
    Port              443
    URI               /syslog/v1/logs
    Format            json
    json_date_key     time
    Header            Content-Type application/json
    Header            x-oneuptime-token <TOKEN>
    Header            x-oneuptime-service-name edge-ingress
    tls               On
```

このセットアップにより、別のロギングスタックを作ることなく、ベアメタルワーカーやハードウェアロードバランサーからsyslogを取り込むことができます。

### 4. 待ち時間のないコンプライアンスアーカイブ

PCIやSOXのためにファイアウォールのログを保持する必要がありますか？OneUptimeに直接送信し、テレメトリーサービスに長期保持ポリシーを適用し、単一の場所からコールドストレージにエクスポートします。複数のsyslogリレーからエクスポートする必要はありません。

## 解析される属性

OneUptimeは各ログエントリに以下の属性を自動的に付加します：

- `syslog.priority`、`syslog.facility.code`、`syslog.facility.name`
- `syslog.severity.code`、`syslog.severity.name`
- `syslog.hostname`、`syslog.appName`、`syslog.processId`、`syslog.messageId`
- `syslog.structured.*`（フラット化されたRFC5424の構造化データ）
- `syslog.raw`（トレーサビリティのための元のメッセージ）

これらの属性はテレメトリー → ログエクスプローラー内で検索可能になります。

## トラブルシューティング

- **HTTP 401または空の結果** — `x-oneuptime-token` ヘッダーがログを受信するプロジェクトに属していることを確認してください。
- **ログが表示されない** — リクエストボディに実際にsyslog行が含まれているか確認してください。空のボディはHTTP 400で拒否されます。
- **予期しないサービス名** — `x-oneuptime-service-name` を設定してデフォルトの検出ロジックを上書きしてください。
- **大量のバースト** — リクエストあたり最大1,000行のバッチ処理がサポートされています。それより大きいバーストはキューに入れられて非同期で処理されます。
