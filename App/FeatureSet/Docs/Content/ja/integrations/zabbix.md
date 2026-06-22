# Zabbix 連携

[Zabbix](https://www.zabbix.com) はサーバーとネットワークを監視し、OneUptime はインシデント対応、オンコール、ステータスページを管理します。この 2 つを接続すれば、Zabbix の問題がすべて自動で OneUptime のインシデントになります — 担当者に適切に通知が届き、ステータスページも常に正確な状態を保ちます。

この連携は**インバウンド**です: Zabbix が問題を OneUptime に送ります。一方には Zabbix の **Webhook メディアタイプ**、もう一方には OneUptime の **[ワークフロー](/docs/workflows/index)** を使います。プラグインも追加サービスも不要です。

```text
Zabbix trigger fires  ──►  Webhook media type  ──►  OneUptime Workflow (Webhook trigger)  ──►  Create Incident
```

## 仕組み

1. Zabbix のトリガーが **PROBLEM** に変わります。
2. Zabbix の**アクション**が **OneUptime** メディアタイプにイベントを送るよう指示します。
3. メディアタイプのスクリプトが小さな JSON ペイロードを OneUptime のワークフロー URL に POST します。
4. ワークフローがペイロードを読み取り、インシデントを作成します (Zabbix が回復したときに自動解決することもできます)。

## 前提条件

- 管理権限のある Zabbix サーバー (このガイドは **Zabbix 6.0 LTS / 7.0 LTS** 向けですが、Webhook メディアタイプは 5.0+ でも同様に動作します)。
- Zabbix サーバーが HTTPS で OneUptime インスタンスに到達できること。
- ワークフローを作成できる OneUptime プロジェクト。

## Part 1 — OneUptime ワークフローを作成する

Webhook URL が必要なので、先にこちらを行ってください。

1. **Workflows → Create Workflow** を開きます。`Zabbix → Incidents` という名前にして **Builder** タブを開きます。
2. **Webhook** トリガーをキャンバスにドラッグします。クリックして**固有の URL をコピー**します。この URL はパスワードのように扱ってください — URL を持っている人なら誰でもワークフローを開始できます。変数が見やすくなるよう、ブロックを `Zabbix` にリネームします。
3. **Conditions** ブロックをキャンバスにドラッグし、トリガーの出力に接続します。次のように設定します:
   - **Left value**: `{{Zabbix.Request Body.status}}`
   - **Operator**: `==`
   - **Right value**: `1` _(Zabbix は問題のとき `1`、回復のとき `0` を送ります)_
4. **Create Incident** ブロックをドラッグして Conditions ブロックの **Yes** 出力に接続します。次のように入力します:
   - **Title**: `Zabbix: {{Zabbix.Request Body.name}}`
   - **Description**: `Host: {{Zabbix.Request Body.host}}\nSeverity: {{Zabbix.Request Body.severity}}\nZabbix event: {{Zabbix.Request Body.event_id}}`
   - **Severity**: 希望する OneUptime のインシデント重大度を選びます (後で Conditions ブランチを追加して Zabbix の重大度をマッピングできます)。
5. 保存します。テストが完了するまで **Enabled** は*オフ*のままにしておきます。

> **ヒント:** 説明 (またはインシデントラベル) に Zabbix の `event_id` を入れておくと、回復時に自動解決したい場合に後でそのインシデントを見つけやすくなります。[自動解決 (オプション)](#自動解決オプション) を参照してください。

## Part 2 — Zabbix を設定する

### ステップ 1: OneUptime メディアタイプを作成する

1. Zabbix で **Alerts → Media types** (古いバージョンでは **Administration → Media types**) に移動します。
2. **Create media type** をクリックして **Type** を **Webhook** に設定します。
3. **Name**: `OneUptime`。
4. 以下の **Parameters** を追加します (_Add_ をクリックして 1 つずつ追加)。これらは Zabbix の[マクロ](https://www.zabbix.com/documentation/current/en/manual/appendix/macros/supported_by_location)をきれいなペイロードにマッピングします:

   | Name             | Value              |
   | ---------------- | ------------------ |
   | `url`            | `{ALERT.SENDTO}`   |
   | `event_id`       | `{EVENT.ID}`       |
   | `event_name`     | `{EVENT.NAME}`     |
   | `event_value`    | `{EVENT.VALUE}`    |
   | `event_severity` | `{EVENT.SEVERITY}` |
   | `host`           | `{HOST.NAME}`      |
   | `event_date`     | `{EVENT.DATE}`     |
   | `event_time`     | `{EVENT.TIME}`     |

5. **Script** フィールドに以下を貼り付けます:

   ```javascript
   var params = JSON.parse(value);
   var request = new HttpRequest();
   request.addHeader("Content-Type: application/json");

   var payload = {
     source: "zabbix",
     event_id: params.event_id,
     name: params.event_name,
     host: params.host,
     severity: params.event_severity,
     // "1" = problem, "0" = recovered. OneUptime reads this in a Conditions block.
     status: params.event_value,
     date: params.event_date,
     time: params.event_time,
   };

   var response = request.post(params.url, JSON.stringify(payload));

   if (request.getStatus() < 200 || request.getStatus() >= 300) {
     throw (
       "OneUptime responded with HTTP " + request.getStatus() + ": " + response
     );
   }

   return "OK";
   ```

6. **Message templates** タブをクリックして **Problem** と **Problem recovery** のテンプレートを追加します (本文は空でかまいません — ペイロードはスクリプト内で作成されます)。これはそれらのイベントタイプに対してメディアタイプを使用するために Zabbix に必要です。
7. **Add** をクリックしてメディアタイプを保存します。

### ステップ 2: Webhook を担うユーザーを作成する

Zabbix は*ユーザー宛て*に通知を送ります。専用のユーザーを作ることで、連携の確認や無効化が簡単になります。

1. **Users → Users → Create user** に移動します。名前を `OneUptime Webhook` とし、通知を受け取れるロール (例: **User role**) を付与して、ユーザーグループに追加します。
2. **Media** タブで **Add** をクリックします:
   - **Type**: `OneUptime`
   - **Send to**: Part 1 でコピーした**ワークフロー Webhook URL** を貼り付けます。
   - **When active** / 重大度: デフォルトのままにするか、必要な重大度に絞ります。
3. **Add** して **Update** します。

### ステップ 3: アクションで問題を OneUptime に送る

1. **Alerts → Actions → Trigger actions → Create action** に移動します。
2. **Name**: `Notify OneUptime`。
3. **Conditions** (オプション): 絞り込みを行います。たとえば _Trigger severity >= Warning_ など。すべて送る場合は空のままにします。
4. **Operations** タブで、**OneUptime** メディアタイプを使って **User: OneUptime Webhook** に送るオペレーションを追加します。
5. 後で回復時にインシデントを解決するには、**Recovery operations** にも同じユーザー/メディアを設定します。
6. **Add** をクリックして保存し、アクションが **Enabled** になっていることを確認します。

## Part 3 — テストする

1. OneUptime ワークフローに戻り、**Enabled** をオンにします。
2. Zabbix でテスト問題を発生させます。たとえば、一時的にトリガーのしきい値を下げるか、問題状態に変わるテストアイテムを使います。
3. ワークフローの **Logs** タブを開きます。Zabbix ペイロードを含む実行が表示され、Conditions ブロックが **Yes** のパスを通り、インシデントが作成されているはずです。
4. OneUptime の **Incidents** を確認します — Zabbix の問題がインシデントになっています。

何も届かない場合は [トラブルシューティング](#トラブルシューティング) を参照してください。

## 自動解決 (オプション)

上記のコアワークフローはインシデントを*開く*だけです。Zabbix が回復したときに*クローズ*するには:

1. Zabbix アクションに **Recovery operations** が設定されていることを確認します (ステップ 3)。回復イベントも送られるようにするためです。回復時には `status` が `0` として届きます。
2. ワークフローに 2 つ目の **Conditions** ブランチを追加します: left `{{Zabbix.Request Body.status}}`、operator `==`、right `0`。
3. **Yes** 出力から **Find Incident** ブロックを追加して、先ほど作成したオープン状態のインシデントを検索します — 説明またはラベルに保存した Zabbix `event_id` でマッチングします。
4. **Update Incident** ブロックに接続して、インシデントを*解決済み*状態に変更します。

解決は自プロジェクトのインシデント状態の定義に依存するため、まず**作成**パスが確実に動くことを確認してから解決パスを追加してください。[コンポーネント → OneUptime データコンポーネント](/docs/workflows/components#oneuptime-data-components) を参照してください。

## Zabbix 重大度のマッピング (オプション)

Zabbix の重大度 (`Not classified`、`Information`、`Warning`、`Average`、`High`、`Disaster`) は `{{Zabbix.Request Body.severity}}` として届きます。OneUptime のインシデント重大度にマッピングするには、**Create Incident** の前に **Conditions** ブランチを追加します。たとえば、`Disaster` と `High` を「Critical」インシデントに、それ以外を「Major」にルーティングします。ブランチごとに **Create Incident** ブロックを 1 つ作成します。

## トラブルシューティング

**ワークフローが一切実行されない。**

- ワークフローの **Enabled** スイッチがオンになっているか確認します。
- Zabbix サーバーから URL に到達できるか確認します: `curl -i -X POST <workflow-url> -d '{}' -H 'Content-Type: application/json'`。すぐに確認応答が返るはずです。
- Zabbix の **Reports → Action log** で配信エラーを確認します。

**Zabbix がスクリプトエラーを報告する。**

- メディアタイプを開いて **Test** でサンプルペイロードを送ります。Zabbix がスクリプトの出力またはスローされたエラーを表示します。
- OneUptime からの 2xx 以外のレスポンスはスクリプト内の `throw` によって表面化されます — ワークフロー URL が正確かどうかを確認します。

**インシデントが作成されたがフィールドが空。**

- ワークフローの **Logs** タブを開いてトリガーの出力を確認します。**Request Body** 以下のフィールド名が参照しているもの (`name`、`host`、`severity`、`status`、`event_id`) と一致しているか確認します。
- フィールドが存在しない場合はエラーにならず空文字列になります — [変数 → 注意点](/docs/workflows/variables#gotchas) を参照してください。

**すべてが 2 回発火する。**

- 問題オペレーションとエスカレーションステップの両方が同じメディアに送信されている可能性があります。アクションの **Operations** ステップを確認してください。

## セキュリティに関する注意

- ワークフローの Webhook URL はパスワードのように扱ってください。漏洩した場合は、トリガーを削除して新しいものを作成し URL をローテーションします。
- Zabbix アクションの条件を絞り込み、インシデントに値する重大度のみを転送するようにします。
- ファイアウォールの内側で OneUptime をセルフホストしている場合は、Zabbix サーバーのアウトバウンド IP が HTTPS で到達できるよう許可します。

## 次に読むべきページ

- [連携 概要](/docs/integrations/index) — インバウンド/アウトバウンドのパターン。
- [Webhook トリガー](/docs/workflows/triggers#webhook) — 受信 URL の仕組み。
- [コンポーネント](/docs/workflows/components) — Conditions、Create Incident など。
- [変数](/docs/workflows/variables) — 後続ブロックでの Zabbix ペイロードの読み取り。
