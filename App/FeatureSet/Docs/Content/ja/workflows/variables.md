# ワークフロー 変数

ワークフローはデータが流れて初めて意味を持ちます。変数はそのデータが移動する手段です — トリガーから最初のコンポーネントへ、あるコンポーネントの出力から次のコンポーネントの入力へ、そしてプロジェクトレベルのシークレットから参照される任意の場所へ。

OneUptime には 2 種類の変数と、両方に対して動く 1 つの補間構文があります。

## グローバル変数

**Workflows → Global Variables** で一度定義するプロジェクト全体の値です。API キー、ベース URL、チャンネル名、10 個のワークフローにハードコードしたくないものなら何でも。

グローバル変数には次があります:

- **Name** — 参照に使う識別子。テンプレートで分かりやすいよう `UPPER_SNAKE_CASE` を使ってください。
- **Value** — 文字列の値。複数行の値もサポートされます。
- **Is Secret** — オンにすると、保存後に値は UI 上で書き込み専用となり、実行ログから秘匿されます。

任意のワークフローのどこからでも、次のようにグローバル変数を参照します:

```
{{variable.NAME}}
```

たとえば、`PAGERDUTY_KEY` をシークレット変数として定義していれば、PagerDuty を呼ぶ各 API コンポーネントは `{{variable.PAGERDUTY_KEY}}` として読めて、誰もワークフロー JSON で実際のキーを目にすることはありません。

## ローカル変数

ローカル変数は、この実行中にすでに動いたノードの戻り値です。すべてのトリガーとすべてのコンポーネントが 1 つを公開します — ノードごとのリストは[トリガー](/docs/workflows/triggers) と[コンポーネント](/docs/workflows/components) を参照してください。

ローカル変数は次のように参照します:

```
{{NodeId.fieldName}}
```

`NodeId` はキャンバス上のトリガーまたはコンポーネントの名前です (読みやすさのためにリネーム可能 — 短く、`PascalCase` にして参照をきれいに保ってください)。`fieldName` はそのノードが公開する任意のものです。

例:

- `LookupUser` という名前の **API** コンポーネントが正常に返ったあと、下流のノードはステータスコードを `{{LookupUser.response-status}}` として、パースされたボディを `{{LookupUser.response-body}}` として読めます。
- `Incident` という名前の **Incident → On Create** トリガーの後では、`{{Incident.title}}`、`{{Incident.description}}`、`{{Incident.incidentSeverityId}}`、その他インシデントの任意のカラムを読めます。
- `Transform` という名前の **Custom Code** コンポーネントの後では、返された値は `{{Transform.value}}` として公開されます。

ローカル変数は単一の実行にスコープされます。次の実行は真っ新な状態から始まります。

## 補間が効く場所

ほぼすべてのテキスト形式の引数が補間をサポートします:

- API コンポーネントの URL フィールド
- Slack / Teams / Discord / Telegram / Email のメッセージテキスト
- Email の件名と本文
- ヘッダーとボディフィールド (JSON 値の中で使う)
- Conditions の左右オペランド

純粋な JSON 引数は文字列値の中で補間を受け付けます。キーは補間できません。動的な構造を構築する必要があれば、**Custom Code** でペイロードを組み立て、その戻り値を次のノードにパイプしてください。

**Custom Code** コンポーネントは変数を異なる方法で読みます — グローバル変数は `args.variables` 上に公開され、上流の戻り値はコンポーネントで設定した名前付き引数として渡されます。

## 例

### トリガーからペイロードを構築する

Webhook が CI ビルドの結果を受け取ります。ボディは `{ "service": "checkout", "status": "failed" }` のような JSON です。これを OneUptime インシデントに変えるには:

1. `CIWebhook` という名前の **Webhook** トリガー。
2. **Conditions** コンポーネント: left `{{CIWebhook.Request Body.status}}`、operator `==`、right `failed`。
3. `yes` ポートから **Create Incident** コンポーネント:
   - Title: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Description: `See {{CIWebhook.Request Body.url}} for the build logs.`

### アウトバウンド API コールでシークレットを使う

PagerDuty を呼ぶワークフロー:

1. `PAGERDUTY_KEY` をシークレットグローバル変数として定義。
2. **API** コンポーネントで `Authorization` ヘッダーを `Token token={{variable.PAGERDUTY_KEY}}` に設定。

キーがワークフロー JSON や実行ログに現れることはありません。

### 2 つの API コールをチェーンする

最初のコールが返す ID を 2 つ目のコールが必要とします:

1. **API** コンポーネント `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`。
2. **API** コンポーネント `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`。

`LookupOrder` が非 2xx レスポンスを返した場合、`success` ではなく `error` ポートが発火します — そのブランチを Email または Slack コンポーネントに配線して、失敗が無音にならないようにしてください。

## 落とし穴いくつか

- **ノード名のタイポは参照を黙って壊します。** 下流で `{{OldName.field}}` を配線したあとにノードをリネームしたら、すべての参照を更新してください。実行ログを見て、キャプチャされた引数にリテラルの `{{OldName.field}}` が見えたら、解決できていません。
- **シークレットは大文字小文字を区別します。** `{{variable.MyKey}}` と `{{variable.mykey}}` は別の変数です。
- **欠落フィールドは空になります。** `{{Foo.nonexistent}}` を参照すると空文字列が生成され、エラーにはなりません。便利ですが、バグを覆い隠すこともあります — フィールドが次のステップで必須なら、**Conditions** ノードで存在を表明してください。

## 次に読むもの

- [コンポーネント](/docs/workflows/components) — 戻り値名の完全なカタログ。
- [実行とログ](/docs/workflows/runs-and-logs) — 実行後にすべての補間された引数のリテラル値を検査する方法。
- [設定と安全性](/docs/workflows/configuration) — グローバル変数に入れて安全なもの。
