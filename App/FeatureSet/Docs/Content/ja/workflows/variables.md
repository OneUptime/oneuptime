# 変数

ワークフローはデータを動かすことが本質です — トリガーから最初のブロックへ、あるブロックから次のブロックへ、そして共有の値を必要な場所のどこへでも。変数はそのデータを動かす手段です。

変数には 2 種類あり、同じ構文を共有します。

## グローバル変数

一度保存して、どこからでも再利用できるプロジェクト全体の値です。API キー、URL、チャンネル名など、10 個のワークフローにコピペしたくないものに使います。

**Workflows → Global Variables** にあります。各変数は次の情報を持ちます:

- **Name** — 参照に使う名前。ブロック内で目立つように `UPPER_SNAKE_CASE` を使うとよいでしょう。
- **Value** — 実際の値。複数行の値も可能です。
- **Is Secret** — オンにすると、保存後は UI に表示されず、実行ログにも表示されなくなります。

どのワークフローでもグローバル変数を次のように使えます:

```
{{variable.NAME}}
```

たとえば、PagerDuty のキーを `PAGERDUTY_KEY` として保存していれば、どのブロックでも `{{variable.PAGERDUTY_KEY}}` として使えます — 実際のキーがワークフローやログに表示されることはありません。

## ローカル変数 (前のブロックからのデータ)

ローカル変数は、この実行中にすでに実行されたブロックの出力です。すべてのトリガーとコンポーネントは、読み取り可能な何らかの出力を生成します。

前のブロックの出力を次のように参照します:

```
{{BlockName.fieldName}}
```

`BlockName` はキャンバス上のトリガーやコンポーネントの名前です (短くわかりやすい名前にリネームできます)。`fieldName` はそのブロックが生成するものです。

例:

- `LookupUser` という名前の **API** ブロックの実行後、ステータスコードを `{{LookupUser.response-status}}`、ボディを `{{LookupUser.response-body}}` として読み取れます。
- `Incident` という名前の **Incident → On Create** トリガーの後、`{{Incident.title}}`、`{{Incident.description}}` などインシデントの任意のフィールドを読み取れます。
- `Transform` という名前の **Custom Code** ブロックの後、return された値は `{{Transform.value}}` にあります。

ローカル変数は現在の実行中のみ存在します。新しい実行ごとにリセットされます。

## 変数が使える場所

ほぼすべてのテキストフィールドが変数を受け付けます:

- API ブロックの URL。
- Slack、Teams、Discord、Telegram、Email のメッセージテキスト。
- メールの件名と本文。
- ヘッダーやボディフィールド (文字列値の内部)。
- Conditions ブロックの両側。

純粋な JSON フィールドでは、文字列値の内部で変数が使えますが、変数をキーとして使うことはできません。動的に構造を組み立てる必要がある場合は、**Custom Code** ブロックで組み立ててから、出力を次のブロックに渡してください。

**Custom Code** ブロックの変数の読み方は少し異なります — グローバル変数は `args.variables` に入ってきて、前のブロックの出力のうちどれを引数として渡すかは自分で決めます。

## 例

### Webhook からペイロードを組み立てる

`{ "service": "checkout", "status": "failed" }` のようなボディで Webhook が届きます。これを OneUptime のインシデントに変えるには:

1. `CIWebhook` という名前の **Webhook** トリガー。
2. **Conditions** ブロック: 左 `{{CIWebhook.Request Body.status}}`、演算子 `==`、右 `failed`。
3. **Yes** ブランチから、**Create Incident** ブロックを次のように設定:
   - Title: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Description: `See {{CIWebhook.Request Body.url}} for the logs.`

### API 呼び出しでシークレットを使う

PagerDuty を呼び出すワークフロー:

1. `PAGERDUTY_KEY` をシークレットのグローバル変数として保存します。
2. **API** ブロックで `Authorization` ヘッダーを `Token token={{variable.PAGERDUTY_KEY}}` に設定します。

キーはワークフローやログに表示されません。

### 2 つの API 呼び出しをつなぐ

最初の呼び出しが、次の呼び出しが必要とする ID を返します:

1. **API** ブロック `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`。
2. **API** ブロック `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`。

`LookupOrder` が失敗した場合、**success** ではなく **error** 出力が発火します。これを Email や Slack ブロックに接続しておけば、失敗が見過ごされません。

## 注意点

- **ブロックをリネームすると参照が壊れます。** ブロックをリネームしたら、それを使っているすべての場所を更新してください。実行ログでは、解決できなかった参照はリテラルの `{{BlockName.field}}` テキストとして表示されます。
- **変数名は大文字小文字を区別します。** `{{variable.MyKey}}` と `{{variable.mykey}}` は別物です。
- **存在しないフィールドは空文字列になります。** 存在しないフィールドを参照すると、エラーではなく空文字列が返されます。便利ですが、バグを隠す可能性があります。重要なフィールドは **Conditions** ブロックで確認してから続行しましょう。

## 次に読むべきページ

- [コンポーネント](/docs/workflows/components) — 各ブロックが生成する出力の全リスト。
- [実行とログ](/docs/workflows/runs-and-logs) — 実行後にすべての変数の実際の値を確認。
- [構成と安全性](/docs/workflows/configuration) — グローバル変数に保存して安全なもの。
