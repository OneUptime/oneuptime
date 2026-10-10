# OneUptime による AI / LLM オブザーバビリティ

AI が交わしたすべての会話を読み、起きたとおりに再生し、AI の回答がまずいときには知らせを受けられます。すべて標準の OpenTelemetry で動き、独自の SDK はありません。アプリが OpenTelemetry の **GenAI セマンティック規約** (`gen_ai.*`) に沿ったスパンを送信していれば、OneUptime がそれを会話、アラート、使用量、コストに変えます。

## できること

ナビゲーションバーの Observability の下にある **AI / LLM** を開きます。

- **会話** — AI が交わしたすべての会話です。人が何を尋ね、AI が何と答え、どのツールを使い、何がうまくいかなかったかがわかります。一覧の上には 5 つの数値が並びます。会話数、AI の回答数、対応が必要な数、コスト、そして回答にかかる典型的な時間です。会話を開くと、読むことも再生することもできます。
- **呼び出し** — LLM、埋め込み、エージェント、ツールのすべての呼び出しです。サービス、プロバイダー、モデル、オペレーション、人、チームで絞り込めます。呼び出しをクリックするとトレースビューアーで開きます。
- **使用量** — ある期間の呼び出し、トークン、コストと、誰が何に費やしているかです。従業員、チーム、モデル、プロバイダー、アプリを支出順に並べます。
- **アラート** — AI の回答がまずいときのための既製のアラートと、AI / LLM モニターです。
- **予算** — 1 日あたりのコスト上限です。アラートを設定できるメトリクスとして公開されます。
- **料金** — 組み込みのカタログにないモデル向けの、モデルごとの独自価格です。
- **セットアップ** — 以下の 5 つのステップと、プロジェクトのエンドポイントです。

トレースビューアーでは、各 AI 呼び出しのスパンに **AI / LLM** パネルもあり、モデル、トークン数、コスト、リクエストパラメーター、プロンプトと応答が表示されます。

## ステップ 1 — AI の呼び出しを送信する

テレメトリの取り込みキーを作成します。**プロジェクト設定 → テレメトリと APM → 取り込みキー** を開き、**取り込みキーを作成** をクリックします。アプリはこのキーを OTLP ヘッダーとして渡します。(スクリーンショットは [OpenTelemetry ガイド](/docs/telemetry/open-telemetry) を参照してください。)

次に、任意の OpenTelemetry GenAI ライブラリでアプリを計装します。

- **OpenLLMetry** (Traceloop) — OpenAI、Anthropic、Cohere、Bedrock、LangChain、LlamaIndex、CrewAI など。
- **OpenInference** (Arize) — OpenAI、LangChain、LlamaIndex、DSPy など。
- **Vercel AI SDK**、または OpenAI、Anthropic、Gemini 向けの **OpenTelemetry 計装**。

LLM のトラフィックを **LiteLLM** や **Portkey** のようなゲートウェイ経由で流していますか? アプリごとに計装する代わりに、ゲートウェイからトレースをエクスポートしてください。[AI ゲートウェイの観測](/docs/telemetry/ai-gateways) を参照してください。エンジニアが使うコーディングアシスタント (Claude Code、Cursor、Codex、Gemini CLI、Copilot) をお探しですか? これらは独自に OpenTelemetry をエクスポートするので、あなたの側では何も必要ありません。[AI コーディングアシスタントのオブザーバビリティ](/docs/telemetry/ai-coding-assistants) を参照してください。

### Python (OpenLLMetry)

```bash
pip install traceloop-sdk opentelemetry-exporter-otlp
```

```python
from traceloop.sdk import Traceloop

Traceloop.init(
    app_name="my-ai-agent",
    api_endpoint="https://oneuptime.com/otlp",   # or your self-hosted host + /otlp
    headers={"x-oneuptime-token": "YOUR_INGESTION_TOKEN"},
)

# Your normal OpenAI / Anthropic / LangChain calls are now traced automatically.
```

### Node.js / TypeScript (OpenLLMetry)

```bash
npm install @traceloop/node-server-sdk
```

```ts
import * as traceloop from "@traceloop/node-server-sdk";

traceloop.initialize({
  appName: "my-ai-agent",
  baseUrl: "https://oneuptime.com/otlp", // or your self-hosted host + /otlp
  headers: { "x-oneuptime-token": "YOUR_INGESTION_TOKEN" },
});
```

### OpenTelemetry の環境変数だけで設定する

ネイティブの OpenTelemetry SDK で計装している場合は、OTLP エクスポーターの送信先を OneUptime にします。

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
export OTEL_SERVICE_NAME="my-ai-agent"
```

OneUptime をセルフホストしていますか? `https://oneuptime.com/otlp` を `https://YOUR-ONEUPTIME-HOST/otlp` に置き換えてください。

## ステップ 2 — やり取りの内容を記録する

計装が内容を記録していれば、会話には人が何を尋ね、AI が何と答えたかが表示されます。OpenLLMetry はオフにしない限り (`TRACELOOP_TRACE_CONTENT=false`) プロンプトと応答を記録します。OpenTelemetry の計装は、指定したときだけ記録します。

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

内容がなくても、会話にはタイミング、コスト、問題が表示され、内容が記録されていないことが示されます。プロンプトには機密データが含まれることがあります。保存前にマスクする方法は [プライバシーとマスキング](#プライバシーとマスキング) を参照してください。

## ステップ 3 — 呼び出しを会話にまとめる

チャットアプリは 1 ターンごとにモデルを 1 回呼び出します。すべての AI 呼び出しで `gen_ai.conversation.id` (または `session.id`) にチャットの ID を設定すると、呼び出しやトレースがいくつあっても、各チャットが 1 つの会話として表示されます。OpenLLMetry では、リクエストごとに 1 回、関連付けプロパティとして設定します。

```python
from traceloop.sdk import Traceloop

Traceloop.set_association_properties({
    "session_id": chat.id,
    "user_email": user.email,
})
```

会話 ID のない呼び出しも、1 リクエスト (1 トレース) ずつ表示されます。

## ステップ 4 — 誰が尋ねたかを伝える

`user.id` または `user.email` を設定すると (上の関連付けプロパティはメールアドレスを設定します)、各会話の相手がわかり、一覧を人で検索でき、使用量タブで従業員ごとの支出を並べられます。OneUptime が読み取るすべてのキーは [従業員とチームへの帰属](#従業員とチームへの帰属) に一覧があります。

## ステップ 5 — まずい回答にフラグを付ける

OneUptime は回答が届くたびにチェックし、何が問題だったかを記録します。

| 問題       | 意味                                                         | 判定の根拠                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 失敗       | 呼び出しがエラーで終わり、回答が届かなかった                 | スパンのステータス Error、`error.type`、または終了理由 `error`                                                                                                             |
| 拒否       | AI が断った、または安全フィルターがブロックした              | 拒否や安全性による終了理由 (`content_filter`、`refusal`、`SAFETY` など)、回答内の拒否、または英語の定型的な拒否文で始まる回答                                              |
| 途切れ     | 回答がトークン上限で止まった                                 | 終了理由 `length`、`max_tokens`、または `MAX_TOKENS`                                                                                                                        |
| 空         | AI がテキストもツール呼び出しもなしに回答した                | 何も含まない記録済みの内容、または出力トークン 0                                                                                                                           |
| フラグ付き | アプリが送った評価が、その回答をまずいと判定した             | `gen_ai.evaluation.result` イベント                                                                                                                                        |

最初の 4 つは何もしなくても検出されます。残り (ガードレール、eval、または独自の LLM ジャッジが却下する回答) にフラグを付けるには、回答のスパンに `gen_ai.evaluation.result` イベントを追加し、`gen_ai.evaluation.score.label` を `fail` に設定します。

```python
from opentelemetry import trace

trace.get_current_span().add_event(
    "gen_ai.evaluation.result",
    {
        "gen_ai.evaluation.name": "relevance",
        "gen_ai.evaluation.score.label": "fail",
        "gen_ai.evaluation.explanation": "The answer is about another product.",
    },
)
```

`incorrect`、`wrong`、`unhelpful`、`toxic`、`unsafe`、`hallucination` などのラベルも不合格として扱われます。イベントは、評価対象の回答のスパンに、そのスパンが開いている間に付ける必要があります。

OneUptime が会話を別の AI に送って評価させることはありません。どのチェックも、呼び出し自体が運ぶ情報だけを読み取ります。

## 会話を読む・再生する

会話は、チャットアプリが履歴を表示するように全体が開きます。相手の発言が右側、AI の回答が左側に、モデル、時刻、トークン、コストとともに表示され、その間にツール呼び出しが並び、問題が起きた箇所にはその場で印が付きます。回答の下の **詳細** には終了理由と評価が表示され、トレース内のその呼び出しへのリンクもあります。

下部のバーは、相手が体験したとおりに会話を再生します。

- **もう一度再生** は最初のメッセージから、実際に起きたペースで再生します。回答を待っている間は「AI が回答中…」がカウントアップします。任意のメッセージの時刻をクリックすると、そこから再生します。
- **待ち時間をスキップ** はデフォルトでオンで、3 秒を超える沈黙を短縮します。速度ボタンで 1×、2×、4×、8× の速さで再生できます。
- **K** で再生または一時停止、**J** または **←** で 1 メッセージ戻り、**L** または **→** で 1 メッセージ進みます。
- 再生が止まったメッセージはアドレスに保持される (`?step=`) ので、リンクを開くとその時点から表示されます。

## AI の回答がまずいときに知らせを受ける

**アラート** タブには、多くの AI アプリが必要とするアラートが用意されています。1 つ選ぶと入力済みの「モニターを作成」が開き、保存前に何でも変更できます。

| アラート                 | 知らせるタイミング                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| 回答に問題がある         | 15 分間の回答の 5% 超が失敗、拒否、途切れ、空、またはフラグ付きになったとき                        |
| AI の呼び出しが失敗する  | 5 分間のモデル呼び出しの 10% 超がエラーで終わったとき                                              |
| AI が回答を拒否する      | 30 分間の回答の 5% 超が拒否だったとき                                                              |
| 回答が途切れる           | 30 分間に 3 件以上の回答がトークン上限で止まったとき                                               |
| 回答にフラグが付く       | 評価が回答をまずいと判定したとき                                                                   |
| 回答が遅い               | 15 分間の回答の 10% 超が 30 秒より長くかかったとき                                                 |
| AI が回答しなくなる      | AI が 30 分間まったく回答しないとき                                                                 |

割合に基づくアラートは、少なくとも 3 件のまずい回答も待つので、2 件中 1 件がまずかっただけで誰かが呼び出されることはありません。

それぞれのアラートは **AI / LLM** モニターです。設定では、何をまずい回答とみなすか (上記の問題、設定した上限より遅い回答、またはその両方)、どのアプリとどのモデルを監視するか、各チェックがどこまでさかのぼるかを指定します。その下のプレビューには、モニターが今この瞬間に何を数えるかが表示されます。条件では 3 つの数値を比較します。**まずい回答の割合** (%)、**まずい回答の数**、**回答の数** です。既製のアラートは自動で解決するアラートを発生させ、回答がまずい間はモニターを「機能低下」と表示します。誰かを呼び出したい場合は、代わりにインシデントをオンにしてください。

支出は [1 日あたりのコスト予算](#1-日あたりのコスト予算) で監視します。

## OneUptime が認識する属性

OneUptime はまず OpenTelemetry の GenAI 規約を読み取り、人気のあるライブラリがそのまま動くように OpenLLMetry と OpenInference の表記にもフォールバックします。

| 項目                         | 主な属性                     | ほかに受け付ける属性                                                                                                                                                                                                                                                      |
| ---------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| プロバイダー / システム      | `gen_ai.provider.name`       | `gen_ai.system` (規約では非推奨だが今も広く送信されている)、`llm.system`、`llm.provider`                                                                                                                                                                                 |
| オペレーション               | `gen_ai.operation.name`      | `llm.request.type`、`openinference.span.kind`                                                                                                                                                                                                                             |
| リクエストしたモデル         | `gen_ai.request.model`       | `llm.model_name`、`llm.request.model`                                                                                                                                                                                                                                     |
| 応答したモデル               | `gen_ai.response.model`      | `llm.response.model`                                                                                                                                                                                                                                                      |
| 入力トークン                 | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`、`llm.token_count.prompt`、`llm.usage.prompt_tokens`                                                                                                                                                                                         |
| 出力トークン                 | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`、`llm.token_count.completion`、`llm.usage.completion_tokens`                                                                                                                                                                             |
| 合計トークン                 | `gen_ai.usage.total_tokens`  | `llm.token_count.total`、`llm.usage.total_tokens`。どれも報告されない場合は入力 + 出力から算出                                                                                                                                                                           |
| コスト (USD)                 | `gen_ai.usage.cost`          | `gen_ai.usage.cost_usd`、`gen_ai.usage.total_cost`、`llm.usage.total_cost`、`gen_ai.cost.total_cost` (LiteLLM)、`litellm.cost.total`                                                                                                                                      |
| エージェント名               | `gen_ai.agent.name`          | `agent.name`                                                                                                                                                                                                                                                              |
| ツール名                     | `gen_ai.tool.name`           | `tool.name`                                                                                                                                                                                                                                                               |
| 会話 / セッション ID         | `gen_ai.conversation.id`     | `session.id`、`langfuse.session.id`、`traceloop.association.properties.session_id`                                                                                                                                                                                        |
| 従業員 (呼び出しを行った人)  | `user.id`                    | `enduser.id`、`litellm.metadata.user_api_key_user_id` と `metadata.user_api_key_user_id` (LiteLLM OTel v2 と v1 の表記。どちらも読み取る)、`traceloop.association.properties.user_id`、`langfuse.user.id`、`user.account_uuid`、`user.account_id`、`cursor.user.id` |
| 従業員のメールアドレス       | `user.email`                 | `traceloop.association.properties.user_email`、`enduser.email`                                                                                                                                                                                                            |
| チーム / コストセンター      | `team.id`                    | `team`、`cost_center`、`department`、`litellm.metadata.user_api_key_team_id` と `litellm.team.id` (LiteLLM OTel v2)、`metadata.user_api_key_team_id` (LiteLLM OTel v1)、`cursor.team.id`                                                                                 |

`traceloop.association.properties.*` のサブキーは **呼び出し側が指定する** ものです。Traceloop がプレフィックスを定義し、その下に何を入れるかはあなたのコードが決めます。`gen_ai.usage.total_tokens` と `gen_ai.usage.cost` は **事実上の標準** のキーであり、GenAI セマンティック規約ではありません (規約には合計トークンの属性もコストの属性もありません)。一般的な計装が送信するので OneUptime はこれらを読み取ります。`gen_ai.system` は規約自身が定めた `gen_ai.provider.name` の非推奨の前身で、どちらも読み取ります。

**3 つの ID 行は `resource.` プレフィックス付きでも照合されます。** OTLP の取り込みでは、すべての _リソース_ 属性が `resource.` プレフィックスの下でスパンの属性マップに展開されるため、`OTEL_RESOURCE_ATTRIBUTES=team.id=platform` は `resource.team.id` として届きます。OneUptime はまずプレフィックスなしのリスト全体を、次に `resource.` のリスト全体を探すので、スパン属性 (1 回の呼び出しを表す) がリソース属性 (プロセス全体を表す) より優先されます。そのほかの行はプレフィックスなしのキーだけで照合します。これらは呼び出しごとの値だからです。

**プロンプトと応答の内容** は、次の場所から読み取ります。`gen_ai.client.inference.operation.details` イベント、スパン属性 `gen_ai.input.messages`、`gen_ai.output.messages`、`gen_ai.system_instructions`、古い計装がまだ送信している **非推奨** のロールごとのイベント (`gen_ai.system.message`、`gen_ai.user.message`、`gen_ai.tool.message`、`gen_ai.assistant.message`、`gen_ai.choice`)、インデックス付き属性 (`gen_ai.prompt.N.content` と `gen_ai.completion.N.content`、OpenInference の `llm.input_messages.N.message.content` と `llm.output_messages.N.message.content`)、そして JSON のメッセージ配列 (`gen_ai.prompt`、`gen_ai.completion`、`input.value`、`output.value`) です。

### コストの計算方法

計装がコスト (`gen_ai.usage.cost`) を報告している場合、OneUptime はそれをそのまま使います。報告された値が常に優先されます。コストが報告されない場合、OneUptime はスパンのトークン数と、OpenAI、Anthropic、Google Gemini、Mistral、DeepSeek、xAI、Cohere、Amazon Nova、Meta Llama の一般的なモデルの定価を収めた組み込みカタログから、**取り込み時の推定コスト** を計算します。モデルは名前のプレフィックスで照合されるため、`gpt-4o-2024-08-06` のような日付付きスナップショットや `us.anthropic.claude-3-5-sonnet-20241022-v2:0` のようなベンダー装飾付き ID も正しく解決されます。不明なモデルやカスタムモデルを推測することはありません。**料金** タブで価格を設定するまで、そのコストは `0` のままです。推定には定価を使い、キャッシュやバッチの割引は考慮しません。

OneUptime をセルフホストしていますか? カタログは `packages/Common/Types/Telemetry/LlmCostCatalog.ts` にあります。

## 従業員とチームへの帰属

「先月、Opus に 4,000 ドル使ったのはどのエンジニアか」は人についての質問であり、スパン上に誰かを示すものがない限り、LLM のスパンはそれに答えられません。OneUptime は取り込み時に人間の行為者をクエリ可能な列にコピーするので、属性を検索する式を書く代わりに、列でグループ化や絞り込みができます。

上の表にある 3 つの ID 行が仕組みのすべてです。記載順で最初に見つかったキーが採用されます。`user.id` が先頭にあるのは、人間の行為者を表す OpenTelemetry の正規のキーであり、自分で ID を設定するなら標準にすべきキーだからです。**例外が 1 つあります。Claude Code** は `user.id` を、`~/.claude.json` に保存されたランダムな匿名識別子として送信し、人を表しません。メールアドレスを先頭に置くリストを使うメトリクスのデータポイントでは問題ありませんが、Claude Code のトレースのベータ版を有効にすると、スパン上では匿名の `user.id` が `user.email` より優先されます。そのフリートでは、コレクターのプロセッサーで `user.id` を削除するか付け替えてください。`enduser.id` は現在も有効なセマンティック規約の属性で、同等の別名として受け付けます。`cursor.user.id` が最後なのは、チーム単位の不透明な整数で、人に対応付けるには Cursor の管理 API が必要だからです。

ID は、すでに LLM 呼び出しと認識されたスパンでのみ読み取ります。`user.id`、`user.email`、`team.id` は、ブラウザーや通常のバックエンドのスパンも持つ汎用的なキーだからです。**メトリクスのデータポイント** はメールアドレスを先頭にした短いリストを持ちます。`user.email`、`user.id`、`user.account_uuid`、`user.account_id`、`cursor.user.id` と、チームは `team.id`、`team`、`cost_center`、`department`、`cursor.team.id` から読み取り、いずれも `resource.` プレフィックス付きでも照合します。スパンなしでメトリクスを送信するコーディングエージェントの CLI は `user.email` をネイティブに送信するためです。現在、**ログレコード** から ID を読み取るものはありません。

### チームとコストセンターを設定する

`team.id`、`team`、`cost_center`、`department` を送信する計装はありません。組織で設定するもので、通常はプロセスの `OTEL_RESOURCE_ATTRIBUTES` で設定します。

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

これらは `resource.team.id`、`resource.team`、`resource.cost_center`、`resource.department` として OneUptime に届きます。エクスポーターがキーを OTLP のリソースブロックに残す場合も、各スパンにコピーする場合 (Claude Code は後者) も、両方の階層がスパンとメトリクスのデータポイントで認識されます。スパンに直接設定したプレフィックスなしの `team.id` が引き続き優先されます。

ゲートウェイの表記は、何も設定しなくても届きます。LiteLLM は 2 つの OpenTelemetry モードで属性名が異なります。デフォルトの v1 の `otel` コールバックは素の `metadata.` プレフィックス (`metadata.user_api_key_user_id`、`metadata.user_api_key_user_email`、`metadata.user_api_key_team_id`) を使い、オプトインの v2 モード (`LITELLM_OTEL_V2=true`) は `litellm.` 名前空間を使います。**OneUptime はどちらも読み取ります**。

### 顧客のキーは意図的に除外しています

LLM のスパンは **2 人** の異なる人物を運ぶことがあります。呼び出しを行った従業員と、その呼び出しの対象である下流の **顧客** です。次のキーは顧客を表すため、OneUptime はあえてどれも ID 列に読み込み **ません**。

- `gen_ai.user` と `llm.user` — 計装が OpenAI のリクエストパラメーター `user` を反映したものです。OpenAI はこれを "a stable identifier for your end-users" と説明しています (現在は非推奨で、`safety_identifier` と `prompt_cache_key` に置き換えられています)。
- `litellm.metadata.user_api_key_end_user_id`、`metadata.user_api_key_end_user_id`、`litellm.end_user.id` — 3 つの表記すべてにおける LiteLLM の明示的なエンドユーザー ID です。キー所有者の ID とは別物で、キー所有者の ID は従業員 **そのもの** であり、**読み取ります**。

理由はコスト配賦の正しさです。顧客 ID を従業員列に読み込むと、40,000 人の顧客に対応するサポートボットが 40,000 人の架空の「従業員」を生み出し、その支出の持ち主であるエンジニアは何も使っていないように見えてしまいます。これらの属性は生の属性マップに残るので、直接クエリできます。

### ID 列はスクラブされます

従業員のメールアドレス列には実際の個人データが入ります。**属性** スコープのテレメトリ **スクラブルール** は、読み取り元の属性と同じようにこの列にも適用されるため、メールアドレスを伏せるルールは列にも効きます。スクラブルールと破棄フィルターは **トレース → 設定** で設定します。

## スパンとメトリクスは合算ではなくフォールバック

**GenAI スパンが正です。メトリクスのストリームはスパンのストリームが何も報告しなかったときだけ参照され、両者が足し合わされることはありません。** スパンはモデル、トークン、コストを 1 行で持つので、スパンがあればどんな質問にも答えられます。スパンがない場合 (コーディングエージェントの CLI はトークンとコストの _メトリクス_ を公開し、GenAI スパンを送信しません) は、メトリクスのストリームが代わりを務めます。多くの計装は同じ呼び出しについて両方のシグナルを送信するため (OpenLLMetry がよくある例です)、足し合わせるとすべてのドルを二重に数えてしまいます。だから合算しません。

想定しておくべき結果: **GenAI スパンが 0 以外の値を報告すると、メトリクスだけを送るソースのその値への寄与は表示されません。** フォールバックは送信元ごとではなく、値ごと・内訳ごとに働きます。

| 場所                                   | メトリクスにフォールバックするもの                       | 条件                                      |
| -------------------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| 使用量 → 入力トークン / 出力トークン   | 入力トークンと出力トークンの合計                         | スパンのトークン合計がどちらも 0          |
| 使用量 → コスト（USD）                 | コスト (USD とマイクロ USD をスケールして合算)           | スパンのコスト合計が 0                    |
| 使用量 → LLM 呼び出し                  | なし — スパンのみ                                        | —                                         |
| 使用量 → 従業員、チーム、モデル        | コストのみ。呼び出しとトークンの列は `—` と表示          | その内訳でスパンの行が 1 つも返らなかった |
| 使用量 → プロバイダー、アプリケーション / サービス | なし — スパンのみ                            | —                                         |
| 会話                                   | なし — 会話はスパンから組み立てる                        | —                                         |

プロバイダーとアプリケーション / サービスにメトリクスのフォールバックがないのは、コーディングエージェントのカウンターが GenAI のプロバイダー属性を持たず、OneUptime のテレメトリサービスにも紐付いていないからです。値がメトリクスから来た場合、ページはそれに **GenAI メトリクスから** というラベルを付けます。メトリクス由来の値には、呼び出し一覧に対応する行がないからです。

**メトリクスだけを送るツールの支出を単独で見たい場合は、そのツール専用のプロジェクトを用意してください。** そうすればスパンのストリームが本当に空になり、フォールバックが働きます。予算も同様です。スパンを送るサービスとメトリクスだけのサービスを混在させず、サービスごとに 1 つの予算を設定してください。

## ダッシュボードとメトリクスのアラート

GenAI のメトリクスは通常の OpenTelemetry メトリクスとして届くので、`gen_ai.client.token.usage`、`gen_ai.client.operation.duration` などをグラフにする **ダッシュボード** を作成したり、それらに対する **メトリクスモニター** を作成したりできます。たとえば、`gen_ai.client.operation.duration` の p95 がモデル別にしきい値を超えたときなどです。[メトリクス モニター](/docs/monitor/metrics-monitor) を参照してください。

## 1 日あたりのコスト予算

**予算** タブでは 1 日あたりの上限を USD で設定し、UTC の 1 日単位で評価します。15 分ごとにバックグラウンドワーカーがその日の LLM スパンのコスト (報告値または計算値) を合計し、予算に記録して、2 つのゲージメトリクスを公開します。

| メトリクス                          | 意味                                     |
| ----------------------------------- | ---------------------------------------- |
| `oneuptime.llm.budget.spend.usd`    | その日のこれまでの支出 (USD)             |
| `oneuptime.llm.budget.percent.used` | 1 日の上限に対する支出の割合 (%)         |

どちらも `oneuptime.llm.budget.id` と `oneuptime.llm.budget.name` の属性を持ち、予算のサービス、プロバイダー、モデルのスコープが設定されていればそれも持ちます。モニターは安定した **`oneuptime.llm.budget.id`** で絞り込んでください。名前は予算の名前を変えると変わります。

**アラートは、これらのメトリクスに対する [メトリクス モニター](/docs/monitor/metrics-monitor) で行います。** 定番の 80% / 100% のパターンなら、`oneuptime.llm.budget.percent.used` に対するモニターを作成し、`oneuptime.llm.budget.id` で絞り込み、2 つの条件を追加します。`>= 80` で警告のアラートを、`>= 100` で重大なアラートを作成します。**モニターのローリング時間は 30 分に設定してください。** 予算は 15 分ごとに 1 点しか公開しないので、デフォルトの 1 分のウィンドウでは集計の合間に空の系列しか見つかりません。

予算はテレメトリサービス、LLM プロバイダー、特定のモデルに絞ることも、プロジェクト全体に適用することもでき、複数の予算を併用できます。予算のモニターから、暴走したエージェントを止めるワークフローを呼び出すこともできます。[暴走する AI エージェントのサーキットブレーカー](/docs/telemetry/ai-agent-circuit-breaker) を参照してください。

## プライバシーとマスキング

プロンプトと応答には機密データが含まれることがあります。OneUptime は他のトレースと同じように、テレメトリの **スクラブルール** と **破棄フィルター** を LLM のスパンに適用するので、保存前に属性をマスクしたりスパンを破棄したりできます。これらは **トレース → 設定** で設定します。従業員のメールアドレス列にも同じルールが適用されます。[ID 列はスクラブされます](#id-列はスクラブされます) を参照してください。

会話の閲覧にはトレースと同じ権限が必要です。プロジェクトのトレースを閲覧できる人は会話も閲覧でき、それ以外の人は閲覧できません。

## 関連情報

- [AI コーディングアシスタントのオブザーバビリティ](/docs/telemetry/ai-coding-assistants) — Claude Code、Cursor、Codex、Gemini CLI、Copilot、Cline などのサポート状況と、それらをまたいだ従業員ごとの支出の扱い。
- [Claude Code の監視](/docs/telemetry/claude-code)
- [Cursor の監視](/docs/telemetry/cursor)
- [OpenAI Codex CLI の監視](/docs/telemetry/openai-codex)
- [Gemini CLI と GitHub Copilot の監視](/docs/telemetry/gemini-cli-and-copilot)
- [AI ゲートウェイの観測 (LiteLLM と Portkey)](/docs/telemetry/ai-gateways)
- [暴走する AI エージェントのサーキットブレーカー](/docs/telemetry/ai-agent-circuit-breaker)
