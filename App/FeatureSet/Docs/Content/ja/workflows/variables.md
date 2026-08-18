# 変数

ワークフローとはデータを動かすことです — トリガーから最初のブロックへ、あるブロックから次のブロックへ、そして共有された値を必要などこへでも。変数はそのデータを動かす手段です。

変数には 2 つのスコープがあり、それに加えて実行中に生成されるコンポーネントの出力があります。

## グローバル変数

一度保存して、どこからでも再利用できるプロジェクト全体の値です。API キー、URL、チャンネル名など、10 個のワークフローにコピーして回りたくないものを想定しています。

**Workflows → Global Variables** にあります。それぞれ次を持ちます。

- **Name** — 参照するときの名前。2 文字以上で、スペースは使えず、使えるのは英字・数字・ハイフン・アンダースコアのみです。`UPPER_SNAKE_CASE` にしておくと、ブロックの中で目立つのでおすすめです。
- **Description** — 任意の自由記述で、何のための変数かを思い出す手がかりになります。
- **Secret** — オンにすると、値は実行ログとステップのトレースから取り除かれます。
- **Content** — 実際の値。長文用のフィールドなので、複数行の値も扱えます。

どのワークフローでも、グローバル変数は次のように使えます。

```
{{global.variables.NAME}}
```

たとえば、PagerDuty のキーを `PAGERDUTY_KEY` として保存していれば、どのブロックでも `{{global.variables.PAGERDUTY_KEY}}` として使えます — エディタが保持するのは参照そのものであり、ワークフローのログは解決後のシークレット値を伏せ字にします。

変数は作成と削除だけで、編集はできません。テーブルに編集ボタンはないので、UI で値を変えるには変数を削除してもう一度作成するか、この後で説明する API 経由で更新します。Global Variables と Workflow Variables は Growth プランの機能です。

## ローカルワークフロー変数

1 つのワークフローに閉じたスコープを持つ変数で、そのワークフローの左メニューの **Workflow Variables** で管理します。次のように参照します。

```
{{local.variables.NAME}}
```

## コンポーネントの出力（前のブロックからのデータ）

すべてのトリガーとコンポーネントは、実行中に出力を生成できます。参照は入力するのではなく、エディタのコンポーネント値ピッカーを使って作成してください — ランナーが期待する正確な ID が挿入されます。

前のブロックの出力は次のように参照します。

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` はブロックの **Identifier** です — ブロックに表示されている短い ID であり、そのブロックに表示されている名前ではありません。新しいブロックには `api-get-1` のような ID が自動的に付き、ブロックの **ID** セクションでリネームできます。リネームすると、すでにそれを指しているすべての参照が壊れます。これは変数をリネームする場合と同じです。`FIELD_ID` は選択した返り値の ID です。

例:

- ID が `lookup-user` の **API** コンポーネントが実行された後、そのステータスコードは `{{local.components.lookup-user.returnValues.response-status}}`、ボディは `{{local.components.lookup-user.returnValues.response-body}}` です。
- ID が `transform` の **Run Custom JavaScript** コンポーネントが実行された後、その返り値は `{{local.components.transform.returnValues.returnValue}}` です。
- レコードタイプ向けのトリガー — **On Create Incident** など — はちょうど 1 つの値 `model` を返し、そこから掘り下げていきます。ID が `incident-on-create-1` のトリガーであれば、インシデントのタイトルは `{{local.components.incident-on-create-1.returnValues.model.title}}` です。

ローカル変数は現在の実行中にのみ存在します。新しい実行のたびにリセットされます。

## 変数が使える場所

ほぼすべてのテキストフィールドが変数を受け付けます。

- API ブロックの URL。
- Slack、Teams、Discord、Telegram、Email のメッセージテキスト。
- メールの件名と本文。
- ヘッダーとボディのフィールド（文字列値の内部）。
- **If / Else** ブロック（Conditions カテゴリに分類）の両側。

JSON フィールドでは、文字列値の内部で変数を使えますが、キーとしては使えません。値全体をまるごと占める参照はそのまま置き換えられるので、オブジェクトをまるごと JSON フィールドに差し込むこともできます。動的に構造を組み立てる必要がある場合は、**Run Custom JavaScript** ブロックでそれを組み立ててから、出力を次のブロックに渡してください。

**Run Custom JavaScript** ブロックには変数が自動的には渡りません — サンドボックスには何も自動注入されません。`{{global.variables.NAME}}`（や任意のコンポーネント参照）をブロックの **Arguments** の JSON フィールドに入れてください。それらの値はスクリプトが実行される前に置換され、`args` として渡ってきます。

## 配列をループする

テキストフィールドの中では、`{{#each path}}…{{/each}}` で配列を反復処理できます。ブロック内では、`{{property}}` は現在の要素から読み取り、`{{@index}}` は 0 始まりの位置、`{{this}}` は単純な値の配列における要素そのものです。`{{#each}}` ブロックの中の名前はトリムされるので、そこでは余分なスペースがあっても問題ありません — ほかの場所とは違います。

## 例

### Webhook からペイロードを組み立てる

`{ "service": "checkout", "status": "failed" }` のようなボディで Webhook が届きます。これを OneUptime のインシデントに変えるには:

1. ID が `ci-webhook` の **Webhook** トリガー。
2. **If / Else** ブロック: Webhook の Request Body 出力を選び、その `status` プロパティ、演算子 `==`、右辺 `failed` を使います。
3. **Yes** 分岐から、**Create One Incident** ブロックを次のように設定します。
   - Title: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### API 呼び出しでシークレットを使う

PagerDuty を呼び出すワークフロー:

1. `PAGERDUTY_KEY` をシークレットのグローバル変数として保存します。
2. **API** ブロックで、`Authorization` ヘッダーを `Token token={{global.variables.PAGERDUTY_KEY}}` に設定します。

キーはワークフローにもログにも表れません。

### 2 つの API 呼び出しをつなぐ

最初の呼び出しが、次の呼び出しに必要な ID を返します。

1. **API** コンポーネント `lookup-order`: ピッカーを使って、手動トリガーの JSON の email フィールドを `GET /orders?email=...` に挿入します。
2. **API** コンポーネント `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`。

`lookup-order` が失敗すると、**Success** の代わりに **Error** 出力が発火します。これを Email や Slack ブロックにつないでおけば、失敗が見過ごされません。

## ワークフローから変数を更新する

よくあるパターンは、資格情報をスケジュールに沿ってローテーションすることです — サードパーティから新しいトークンを取得し、それを変数に書き戻して、次の実行がそれを使えるようにします。これには OneUptime の API を呼び出す **API** ブロックを使います。

`PUT /api/workflow-variable/<variable-id>` に `ApiKey` ヘッダーを付け、変更したいフィールドを **`data` オブジェクトで包んで** 送ります — ここがつまずきやすいポイントです。

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

`data` ラッパーのないフラットなボディは 400 で拒否されます。実際に変更したいフィールドだけを送ってください。`name` と `description` はペイロードに含めなくて構いません。

API キーには **Edit Workflow Variables** が必要です。読み取り権限は不要です — この更新はその行を読み戻すことをしません。

注意すべき点が 2 つあります。

- **参照している変数をリネームしないこと。** `name` は `{{local.variables.NAME}}` の一部です。これを変更すると、既存のすべての参照が解決できなくなり、解決できない参照はリテラルテキストとしてそのまま通過します — 詳しくは下の「落とし穴」を参照してください。
- **変数はこの方法で書き込めますが、読み戻すことはできません。** `content` は、シークレットかどうかを問わず、すべての変数について API 上では書き込み専用です。これが、変数をローテーションするトークンの安全な置き場所にしている理由です。さらに Secret に設定しておけば、値は実行ログとステップのトレースからも取り除かれます。

## 落とし穴

- **ピッカーを使ってください。** ピッカーは、ランナーが期待する正確なコンポーネント ID・返り値 ID・変数 ID を挿入し、参照を表示ラベルから独立させます。
- **変数名は大文字小文字を区別します。** `{{global.variables.MyKey}}` と `{{global.variables.mykey}}` は別物です。
- **解決できない参照は空にはならず、そのまま残ります。** 存在しないものを参照してもエラーにはなりませんし、空文字列にもなりません。中括弧はそのまま素通りするので、`{{local.components.api-get-1.returnValues.body}}` のようにステップ ID を打ち間違えると、それがそのまま Slack メッセージ、URL、リクエストボディに残り、それでも実行は **Executed** と報告されます。実行ログには、素通りした参照名を示す警告行があります。
- **ビルダーは変数名までは検証できません。** 保存前に、解決できないコンポーネント参照 — 不明なステップ ID、不明な返り値、不正なルート — にはフラグを立てます。ただし変数が存在するかどうかまでは分からないので、リネームされた変数は実行ログでしか気づけません。
- **中括弧の中のスペースはトリムされません。** `{{ local.variables.NAME }}` は `{{local.variables.NAME}}` とは別のルックアップになり、決して解決されません。唯一の例外は `{{#each}}` ブロックの中で、そこでは名前がトリムされます。

## 次に読むべきページ

- [コンポーネント](/docs/workflows/components) — 各ブロックが生成する出力の全リスト。
- [実行とログ](/docs/workflows/runs-and-logs) — 実行後にすべての変数の実際の値を確認する。
- [構成と安全性](/docs/workflows/configuration) — グローバル変数に入れても安全なもの。
