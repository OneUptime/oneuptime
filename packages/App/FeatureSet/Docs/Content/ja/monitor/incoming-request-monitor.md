# 受信リクエストモニター

受信リクエストモニターは、他のシステムが HTTP リクエストを送るための URL を提供します。OneUptime はすべてのリクエストを条件に照らして評価し、モニターのステータス変更、インシデントの作成、オンコール当番の呼び出しを行えます。

このモニターは 2 つの異なる役割をこなします。

- **ハートビート監視** — cron ジョブ、ワーカー、デバイスがスケジュールに従って URL を呼び出し、ハートビートが届かなくなると OneUptime がインシデントを作成します。
- **他システムからのアラート受信** — Prometheus Alertmanager、Grafana、そのほか JSON を POST できるものがアラートを送り込み、OneUptime がそれぞれをインシデントに変換して、オンコールへエスカレーションし、復旧時に自動で解決します。

どちらも同じモニタータイプを使います。両者を分けるのは、設定する条件です。

## 概要

受信リクエストモニターは、サービスから呼び出すための固有の URL を提供します。これにより次のことが可能になります。

- cron ジョブやスケジュールされたタスクの監視
- バックグラウンドワーカーが動作していることの確認
- 外部から到達できないファイアウォール内のサービスの監視
- Prometheus Alertmanager、Grafana、その他のアラートシステムからのアラート受信
- HTTP を扱えるあらゆるシステムからのハートビート信号の追跡

## 受信リクエストモニターの作成

1. OneUptime ダッシュボードで **モニター** に移動します
2. **モニターを作成** をクリックします
3. モニタータイプとして **受信リクエスト** を選択します
4. このモニター用に **シークレットキー** と URL が生成されます
5. モニターを開き、左メニューの **Documentation** をクリックして URL をコピーします
6. そのURLへリクエストを送るようサービスを設定します
7. 以下で説明する監視条件を設定します

## リクエスト URL

モニターには次の形式の固有 URL があります。

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

セルフホストの場合は `https://oneuptime.com` を自分の OneUptime インスタンスの URL に置き換えてください。

この URL には **GET** または **POST** リクエストを送信します。HEAD は受け付けられ、GET として扱われます。それ以外のメソッドは 404 を返します。パスに含まれるシークレットキーが唯一の認証情報であり、ヘッダーやトークンは不要です。

> **Warning:** この URL を知っている人は誰でもモニターを正常としてマークできるため、秘密情報として扱ってください。送信したヘッダーはすべてモニターに保存され、モニターを閲覧できる人には見えます。このエンドポイントへ API キーやトークンをヘッダーで送らないでください。

OneUptime は空の `200` を即座に返し、リクエストはキューで処理します。この応答は検証が行われる前に書き込まれるため、`200` はリクエストが受理されたことの確認には**なりません**。シークレットキーの誤り、削除済みのモニター、無効化されたモニターでも同じく `200` が返ります。リクエストが届いているかはモニター自身のタイムラインで確認してください。

### リクエストボディの送信

ボディ内のフィールドを参照したい場合 — インシデントタイトルの `{{requestBody.status}}`、インシデントグルーピングの JSON パス、JavaScript Expression の条件など — には `Content-Type: application/json` を送ってください。本ドキュメントは全体を通してこの形式を前提にしています。`application/x-www-form-urlencoded` のボディも解析されますが、トップレベルのフラットなフィールドに限られます。それ以外の content type、あるいは content type なしの場合は解析されず、`requestBody` への参照はすべて何も解決しません。

ボディは 50 MB まで受け付けます。`Content-Encoding: gzip` でボディを圧縮しないでください。未解析のまま保存され、その中へのパスは解決されません。

### ハートビートの送信

#### curlを使用する場合

```bash
# シンプルなGETリクエスト
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# カスタムボディを使ったPOSTリクエスト
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### Cronジョブから実行する場合

```bash
# cronジョブに追加して5分ごとにハートビートを送信
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### アプリケーションコードから実行する場合

```javascript
// Node.js example
const https = require("https");
https.get("https://oneuptime.com/heartbeat/YOUR_SECRET_KEY");
```

```python
# Pythonの例
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

## 監視条件

サービスをオンライン、パフォーマンス低下、オフラインのいずれと見なすかを条件で設定できます。各条件フィルターには **Filter Type** (何を見るか)、**Filter Condition** (どう比較するか)、**Value** があります。

### 利用可能な Filter Type

| Filter Type           | チェック対象                                       | 備考                                                                           |
| --------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Incoming Request      | 一定時間内にリクエストを受信したかどうか           | 何も届かないときに発動できる唯一のチェック                                     |
| Request Body          | リクエストボディ                                   | 部分一致。オブジェクトのボディはコンパクトな JSON として比較されます           |
| Request Header        | リクエストヘッダーの名前                           | 小文字化したヘッダー名との完全一致                                             |
| Request Header Value  | リクエストヘッダーの値                             | 小文字化したヘッダー値との完全一致                                             |
| JavaScript Expression | `requestBody` と `requestHeaders` に対する任意の式 | 最も柔軟な選択肢 — [JavaScript 式](/docs/monitor/javascript-expression) を参照 |

### Filter Condition

Filter Type ごとに独自の条件が用意されています。

**Incoming Request** の場合 (ダッシュボードの表記のまま記載します):

- **Recieved In Minutes** — 指定した分数以内にリクエストを受信した
- **Not Recieved In Minutes** — 指定した分数以内にリクエストを受信しなかった

**Request Body**、**Request Header**、**Request Header Value** の場合: **Contains** と **Not Contains**。

**JavaScript Expression** の場合: **Evaluates To True**。

> **Note:** ヘッダー名とヘッダー値は比較前に小文字化され、部分一致ではなく名前や値の全体に対して照合されます。`Content-Type` ではなく `content-type` を、`application/JSON` ではなく `application/json` と書いてください。真の部分一致を行うのは **Request Body** だけです。

オブジェクトのボディは空白のないコンパクトな JSON として比較されるため、**Request Body** / **Contains** フィルターは `"status":"firing"` と書く必要があります。整形されたペイロードから `"status": "firing"` をコピーしても一致することはありません。

### 条件の例

#### 10分間ハートビートがない場合にオフラインとしてマークする

- **Filter Type**: Incoming Request
- **Filter Condition**: Not Recieved In Minutes
- **Value**: 10

#### リクエスト本文の内容に基づいてパフォーマンス低下とマークする

- **Filter Type**: Request Body
- **Filter Condition**: Contains
- **Value**: `"status":"degraded"`

> **Warning:** モニターがバックグラウンドで再評価されるのは、少なくとも 1 つの条件が **Incoming Request** をチェックしている場合だけです。条件が Request Body、Request Header、JavaScript Expression しかチェックしていないモニターは、リクエストが到着したときにのみ評価され、それ以外のタイミングでは評価されません。つまり自らオフラインになることはありません。ハートビート欠落のアラームが必要な場合は **Incoming Request** の条件が必要です。

また、一度もリクエストを受信していないモニターは、作成時刻が最後のリクエストであるかのように扱われます。作成したばかりのモニターに「Not Recieved In Minutes: 10」の条件があると、送信側を接続していなくても作成の 10 分後に発動します。

## 他システムからのアラート受信

Alertmanager や Grafana などのツールは、1 件以上のアラートを記述した JSON ドキュメントを POST します。既定では 1 つの条件が開くインシデントは **1 件** なので、5 件のアラートを含むペイロードでもインシデントは 1 件になります。インシデントグルーピングはこれを変えます。ペイロードから値を抽出し、**異なる値ごとに個別のインシデント**を開き、それらを同時にオープンにできます。

### インシデントグルーピングを有効にする

条件を開き、**Settings** を展開して **Group incidents and alerts by a payload field** を有効にします。4 つのフィールドが表示されます。

| フィールド                         | 例                                       | 役割                                                                           |
| ---------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| Open a separate incident for each… | `requestBody.alerts[*].labels.alertname` | 異なる値によってインシデントを分けるパス                                       |
| Field that signals recovery        | `requestBody.alerts[*].status`           | アラートが復旧したと判断するために参照されるパス                               |
| Value that means recovered         | `resolved`                               | 復旧を示す厳密な値                                                             |
| Max incidents per request          | `100` (既定値)                           | カーディナリティの高いフィールドが無制限にインシデントを開かないための安全上限 |

### パスの構文

パスはリテラルのプレフィックス `requestBody.` で始まる必要があります。これがないパス — `alerts[*].labels.alertname` — は何にも一致せず、しかも警告は出ません。`{{ }}` で囲むかどうかは任意で、`requestBody.status` と `{{requestBody.status}}` は同じ動作になります。

- `[*]` は配列に展開され、**異なる**値ごとに 1 件のインシデントを開きます。同じ値になる 2 つの要素は 1 件のインシデントにまとまり、そのインシデントの firing/resolved 状態は**最初に**一致した要素から取られます。**ワイルドカードとして働くのはパス中の最初の `[*]` だけです**。`requestBody.groups[*].alerts[*].name` は何にも一致しません。
- `[0]` と `[last]` は単一の要素を選択し、`[*]` の後ろに続けられます。
- オブジェクトや配列の値、空文字列、null はスキップされます。`0` と `false` は有効なキーです。

### 解決はイベント駆動

Webhook はそのペイロードに含まれる内容しか記述しないため、OneUptime はキーが現れなくなったという理由でインシデントを解決することはありません。インシデントが解決されるのは、そのキーが復旧したとペイロードが明示的に伝えた場合だけです。次の 2 つがどちらも満たされている必要があります。

1. **Field that signals recovery** と **Value that means recovered** が設定され、ペイロードと一致していること。比較は厳密で大文字と小文字を区別します。`Resolved` は `resolved` に一致しません。
2. 条件のインシデントで **Auto Resolve Incident** が有効になっていること (インシデントフォームの **Advanced Options** 内)。これがないと、一致する復旧イベントは無視され、インシデントは開いたままになります。(アラートと **Auto Resolve Alert** についても同様です。)

**Max incidents per request** は作成だけでなく抽出も制限します。上限を超えたキーは復旧処理からも見えないため、上限より多くの異なるキーを含むペイロードでは、上限を超えた位置で `resolved` を報告するアラートはインシデントを閉じません。

> **Warning:** **Field that signals recovery** に `[*]` が含まれ、**Open a separate incident for each…** には含まれていない場合、何も解決されません。`[*]` は両方に使うか、どちらにも使わないかにしてください。`[*]` のない復旧パスはペイロード全体に対して評価されるため、ペイロードレベルの `status: resolved` はそのペイロードのすべてのキーを解決します。個々のステータスがまだ firing のアラートも含まれます。

### インシデントの名前付け

グルーピングキーは、**パスの最後のセグメント**にちなんだ名前の変数として、インシデントとアラートのテンプレートに公開されます。

| パス                                     | 変数              |
| ---------------------------------------- | ----------------- |
| `requestBody.alerts[*].labels.alertname` | `{{alertname}}`   |
| `requestBody.alerts[*].fingerprint`      | `{{fingerprint}}` |
| `requestBody.commonLabels.severity`      | `{{severity}}`    |

ペイロード全体も併用できるため、インシデントタイトルに `{{alertname}}`、説明に `{{requestBody.commonAnnotations.summary}}` を使うことができます。[インシデント & アラートの動的テンプレート](/docs/monitor/incident-alert-templating) を参照してください。

> **Warning:** 変数名は、OneUptime が復旧イベントとオープン中のインシデントを対応付けるための識別情報の一部です。グルーピングパスを最後のセグメントが異なるものに変更すると、旧パスの下で現在オープンのインシデントはすべて孤立します。自動的に解決できなくなり、手作業でクローズする必要があります。

なお `[*]` が機能するのは 2 つのグルーピングパス欄**だけ**です。それ以外の場所では解決されず、未解決のプレースホルダーは空にされるのではなく**そのまま**出力されます。タイトルに `{{requestBody.alerts[*].labels.alertname}}` を使うと、波括弧を含んだまま表示されます。`{{requestBody.alerts[0].annotations.summary}}` は解決されますが、常にペイロードの最初のアラートを読み取り、このインシデントが開かれた対象のアラートではありません。グルーピング変数と、ペイロードの共通フィールド `commonAnnotations` を組み合わせて使ってください。

### 実例

Alertmanager の完全な設定は [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) を、Grafana については [Grafana](/docs/integrations/grafana) を参照してください。

## ベストプラクティス

1. **時間枠を適切に設定する** — cron ジョブが 5 分ごとに実行されるなら、「Not Recieved In Minutes」のしきい値を 10〜15 分にして、時折の遅延を許容します
2. **意味のあるデータを含める** — リクエストボディにステータス情報を送り、きめ細かい条件を設定できるようにします
3. **POST と `Content-Type: application/json` を使う** — ボディ内を読み取る機能はすべてこれに依存します
4. **1 つのモニターで 2 つの役割を混在させない** — イベント駆動のアラートを受け取るモニターには一定の周期がないため、「Not Recieved In Minutes」条件はばたつきます。デッドマンスイッチには別のモニターを使ってください
5. **モニターを監視する** — リクエストを送るサービスに適切なエラーハンドリングを実装し、失敗したリクエストが見過ごされないようにします

## 次に読むべきページ

- [Prometheus Alertmanager](/docs/integrations/prometheus-alertmanager) — インバウンドアラートの完全な構成
- [Grafana](/docs/integrations/grafana) — Grafana アラートでの同じ構成
- [インシデント & アラートの動的テンプレート](/docs/monitor/incident-alert-templating) — タイトルと説明で使えるすべての変数
- [JavaScript 式](/docs/monitor/javascript-expression) — 式の構文とクォートの規則
