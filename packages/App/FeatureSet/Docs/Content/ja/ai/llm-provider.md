# LLM プロバイダー

LLM プロバイダーは、OneUptime のすべての AI 機能を支えるモデルです。調査、AI に質問、下書き、修正のプルリクエストがこれを使います。このページでは、機能がどのプロバイダーを使うか、独自のプロバイダー(OpenAI、Azure OpenAI と Microsoft Foundry、Anthropic、Groq、Mistral、Ollama、または任意の OpenAI 互換サーバー)を追加する方法、そして自分で動かしているモデルを OneUptime から使う方法を説明します。

:::cards
- [AI が使うプロバイダー](#ai-が使うプロバイダー): プロジェクトのデフォルトのプロバイダー、なければグローバルのプロバイダーです。
- [セルフホスト: 環境変数による設定不要の構成](#セルフホスト-環境変数による設定不要の構成): サーバーの設定から、すべてのプロジェクトに一つのプロバイダーを用意します。
- [LLM プロバイダーの設定](#llm-プロバイダーの設定): プロジェクトにプロバイダーを追加し、テストします。
- [セルフホストのモデルのベース URL を選ぶ](#セルフホストのモデルのベース-url-を選ぶ): OneUptime サーバーから到達できるアドレスです。
:::

## プロバイダーが支えるもの

- **調査**: OneUptime AI は新しいインシデントやアラートを調査し、出典付きの根本原因分析をタイムラインに投稿します。[AI SRE](/docs/ai/ai-sre) を参照してください。
- **質問**: **AI に質問** は、プロジェクトのデータからすべての主張に出典を付けて回答します。[AI に質問](/docs/ai/ask-ai) を参照してください。
- **下書き**: インシデント、アラート、計画メンテナンスのメモでの **AI で下書き** と、依頼時またはインシデントの解決時に作成されるポストモーテムです。
- **コード**: 例外、遅いトレース、調査で見つかった原因を修正するプルリクエストで、OneUptime からも GitHub からも作成されます。[コード](/docs/ai/ai-agent) を参照してください。
- **その他すべて**: AI Insights のトリアージ、ワークフローと Runbook の AI ステップ、Slack と Microsoft Teams での回答です。

## AI が使うプロバイダー

AI 機能はプロジェクトのデフォルトのプロバイダーを使います。デフォルトのプロバイダーがないプロジェクトは、グローバルのプロバイダーがあればそれを使います。AI に質問では、会話をプロジェクトの別のプロバイダーやグローバルのプロバイダーに切り替えることもできます。

```mermaid title="AI 機能が使うプロバイダー"
flowchart TB
    F["AI 機能に<br/>モデルが必要"] --> D{"プロジェクトに<br/>デフォルトの<br/>プロバイダーがあるか"}
    D -->|"はい"| P["プロジェクトの<br/>デフォルトの<br/>プロバイダー"]
    D -->|"いいえ"| G{"グローバルの<br/>プロバイダーがあるか"}
    G -->|"はい"| GP["グローバルの<br/>プロバイダー:<br/>OneUptime Cloud<br/>では AI クレジット"]
    G -->|"いいえ"| N["何も実行されず、<br/>AI のページに<br/>プロバイダーがない<br/>と表示される"]
```

プロバイダーは、**デフォルトに設定** がオンのときにプロジェクトのデフォルトになり、新しいプロバイダーではすべてオンになっています。すべてのプロバイダーでこれがオフになっているプロジェクトは、プロバイダーがない場合と同じく、グローバルのプロバイダーを使います。

OneUptime AI のすべてのルール(AI ルールとポストモーテムルール)は、代わりに **その他の項目** で独自のプロバイダーを選べます。プロジェクトのプロバイダーのいずれか、またはグローバルプロバイダーで、そのルールが開始するすべてのものに使われます。何も選ばないルールはデフォルトのプロバイダーを使い、選んだプロバイダーが使えなくなった場合もデフォルトに戻ります。[ルールが使う LLM プロバイダー](/docs/ai/ai-sre#ルールが使う-llm-プロバイダー) を参照してください。

## OneUptime Cloud

**OneUptime Cloud** では、どのプロジェクトも設定なしでグローバルのプロバイダーを使えます。すべての AI 機能に対応しており、料金はプロジェクトの AI クレジットから支払われます。

代わりに独自の API キーや特定のモデルを使うには、以下の手順で独自のプロバイダーを追加します。独自のプロバイダーで動く AI には料金はかかりません。

グローバルの LLM プロバイダーの料金は、プロジェクトの AI クレジットから支払われます。AI が 1 日に使える金額に上限を設けるには、**プロジェクト設定 → AI → AI 機能 → その他の設定** で **1 日あたりの AI の支出上限 (USD)** を設定します。同じ場所の **1 日あたりの AI トークンの上限** は、独自のプロバイダーも含むすべてのプロバイダーのトークンを制限します。[プロジェクト独自の 1 日あたりの上限](/docs/ai/ai-sre#プロジェクト自身の-1-日あたりの上限) を参照してください。

OneUptime Cloud が到達できるのは、公開インターネット上の LLM エンドポイントだけです。セルフホストの Ollama や vLLM サーバーなど、プライベートネットワーク上のモデルには接続できません。自分で動かしているモデルを使うには、そのモデルに到達できるネットワークで OneUptime をセルフホストするか、モデルを公開エンドポイントで提供してください。[セルフホストのモデルのベース URL を選ぶ](#セルフホストのモデルのベース-url-を選ぶ) を参照してください。

## セルフホスト: 環境変数による設定不要の構成

セルフホストのインスタンスで **すべてのプロジェクトに一度に** AI を有効にする最も早い方法は、OneUptime サーバーで `GLOBAL_LLM_PROVIDER_*` 環境変数を設定することです。Docker Compose なら `config.env` に、Helm なら values で設定します。起動時に OneUptime はこれらからグローバルの LLM プロバイダーを登録し、同期を保ちます。プロジェクト側で設定する必要はなく、独自のプロバイダーがないプロジェクトでは AI 修正タスクもこれを使います。

| 変数 | 説明 |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | 有効にするのに必要です。`OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` のいずれか |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API キー: OpenAI、Azure OpenAI、Anthropic、Groq、Mistral では必須、Ollama やキーのない OpenAI 互換サーバーでは不要 |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | エンドポイント: Azure OpenAI、Ollama、OpenAI 互換サーバーでは必須 |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | 使うモデル: OpenAI 互換サーバーでは必須、それ以外では推奨 |
| `GLOBAL_LLM_PROVIDER_NAME` | ダッシュボードに表示される任意のわかりやすい名前 |

:::tabs
@tab Ollama
```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# An address the OneUptime server can reach. Never localhost: see
# "Choosing a Base URL for a Self-Hosted Model" below.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# No API key needed — Ollama is keyless.
```
@tab OpenAI
```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```
:::

同期は宣言的です。変数を変えると次の再起動でプロバイダーがそれに従い、`GLOBAL_LLM_PROVIDER_TYPE` を外すとプロバイダーは削除されます。Admin Dashboard で手動作成したグローバルのプロバイダーには一切触れません。プロジェクトは引き続き **プロジェクト設定 → AI → LLM プロバイダー** で独自のプロバイダーを追加でき、プロジェクトが所有するプロバイダーが常に優先されます。

## 対応しているプロバイダー

| プロバイダー | 用途 | API キーが必要 | ベース URL が必要 |
| --- | --- | --- | --- |
| **OpenAI** | GPT-5.1 とその他の OpenAI モデル | はい | いいえ(デフォルトを使用) |
| **Azure OpenAI / Microsoft Foundry** | Microsoft Foundry または Azure OpenAI にデプロイしたモデル: OpenAI モデル、Foundry Models、Claude | はい | はい |
| **Anthropic** | Claude Sonnet 5.5、Claude Opus 5.5、Claude Haiku 5.5 とその他の Claude モデル | はい | いいえ(デフォルトを使用) |
| **Groq** | Llama、Mixtral などのオープンモデルの高速推論 | はい | いいえ(デフォルトを使用) |
| **Mistral** | Mistral のホステッドモデル | はい | いいえ(デフォルトを使用) |
| **Ollama** | Llama 3.1、Mistral、Qwen など、自分で動かすオープンソースのモデル | いいえ | はい |
| **OpenAI Compatible** | 任意の OpenAI 互換サーバー: vLLM、LocalAI、LM Studio など | いいえ(任意) | はい |

## LLM プロバイダーの設定

:::steps
### LLM プロバイダーを開く

**プロジェクト設定 → AI → LLM プロバイダー** に移動し(サイドメニューの **AI** セクションは最初は折りたたまれています)、**LLM プロバイダーを作成** をクリックします。

### プロバイダーを選ぶ

**プロバイダー** で **LLM プロバイダー** を選びます。OpenAI、Anthropic、Azure OpenAI / Microsoft Foundry、Groq、Mistral、Ollama、OpenAI 互換サーバーのカードがあり、それぞれ 1 行で何かを説明しています。

### 接続する

**接続** では、そのプロバイダーが使う項目だけを、項目ごとの説明付きで入力します:

- **API キー**: API キー。OpenAI、Azure OpenAI、Anthropic、Groq、Mistral では必須、OpenAI 互換サーバーでは任意で、Ollama では入力しません
- **ベース URL**: エンドポイント。Azure OpenAI、Ollama、OpenAI Compatible では必須で、その他ではプロキシやゲートウェイを経由する場合だけ指定します
- **モデル名**: 使うモデル。`gpt-5.1`、`claude-sonnet-5-5`、`llama3.1` など。空欄にすると OneUptime はプロバイダーのデフォルトのモデルを使います(OpenAI 互換サーバーは除きます。こちらは必須です)
- **名前**: 独自の名前を入力するまではプロバイダー名になります。"Production OpenAI" や "Local Ollama" など
- **その他の項目**: 上の項目の下に折りたたまれています。**説明**、AI 機能がプロジェクトのデフォルトのプロバイダーしか使わないため新しいプロバイダーではオンになっている **デフォルトに設定**、リクエストのたびにプロバイダーへ送られる追加パラメーターの任意の JSON オブジェクトである **追加パラメーター** があります(例: `{"temperature": 0.2}`)

**プロバイダーを見られる人。** プロジェクトの LLM プロバイダーを読めるのは、プロジェクトの設定を読めるメンバーだけです: **プロジェクト所有者**、**プロジェクト管理者**、**プロジェクトメンバー**、**閲覧者**、**設定管理者**、**設定メンバー**、**設定閲覧者**、**Read LLM**。プロバイダーの **API キー** と **追加パラメーター** を読めるのはプロジェクトのオーナーと管理者だけです。パラメーターはリクエストのたびにプロバイダーへ送られ、キーと同じようにトークンやヘッダーを含みうるからです。ほかのメンバーには、パラメーターが保存されているかどうかだけが見え、その中身は見えません。プロバイダーを編集できるメンバーは、API キーやパラメーターを読まずに置き換えることができます。編集フォームではこれらの欄は空の状態で始まり、空のままにすると保存済みの値が保たれます。パラメーターを削除するには `{}` を保存します。プロバイダーの **ベース URL** を変更できるのはプロジェクトのオーナーと管理者だけです。API キーと追加パラメーターはそのアドレスに送られるからです。プロバイダーを編集できるほかのメンバーは、それ以外をすべて変更できます。プロバイダーを読める人は誰でもその **ベース URL** を読めるため、キー、トークン、パスワードは絶対に入れず、**API キー** を使ってください。同じページの **グローバル LLM プロバイダー** の一覧(プロジェクトが代わりに使う共有のプロバイダー)は、サインインしている人なら誰にでも名前、説明、価格を表示し、それ以外は表示しません。

### テストする

**プロバイダーのテスト。** プロバイダーのページまたは行のメニューにある **テスト** は、プロバイダーの **API キー**、**モデル名**、**ベース URL**、**追加パラメーター** を使って短いプロンプトを送り、応答があったか、OneUptime の AI 機能に必要なツールの呼び出しができたかを伝えます。テストに失敗すると、まず何を確認すべきかを示し、次にプロバイダーの応答を示します。プロバイダーを変更できる人はテストもできます: **プロジェクト所有者**、**プロジェクト管理者**、**プロジェクトメンバー**、**設定管理者**、**設定メンバー**、**Edit LLM**。プロバイダーを見られるほかの人には、**テスト** がロックされて表示されます。グローバルの LLM プロバイダーは、サーバー管理者が Admin Dashboard の **設定 → グローバルLLMプロバイダー** でテストします。
:::

## プロバイダーごとの設定

### OpenAI

1. [OpenAI Platform](https://platform.openai.com/api-keys) で API キーを取得します
2. LLM プロバイダーとして **OpenAI** を選びます
3. API キーを入力します
4. モデル名を選びます:
   - `gpt-5.1` - 推奨のデフォルト。ツール呼び出しと複雑な調査に強いモデルです
   - `gpt-5.1-mini` - より高速で低コストです

```text title="Example configuration"
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. [Anthropic Console](https://console.anthropic.com/) で API キーを取得します
2. LLM プロバイダーとして **Anthropic** を選びます
3. API キーを入力します
4. モデル名を選びます:
   - `claude-sonnet-5-5` - 推奨のデフォルト。知能、速度、コストのバランスが最もよいモデルです
   - `claude-opus-5-5` - より高性能で、最も難しい調査に向いています
   - `claude-haiku-5-5` - 最も高速で低コストです

```text title="Example configuration"
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7 以降のすべての Claude モデルは、サンプリングを自分で選び、`temperature`、`top_p`、`top_k` を指定したリクエストを拒否します。OneUptime はこれらのモデルにはそれらの設定を送りません。それでもモデルがいずれかを拒否した場合、OneUptime はその設定を外してリクエストを送り直し、そのプロバイダーについて記憶します。

Claude 5 のモデルは回答の前に思考し、その思考は回答のトークン上限に数えられるため、OneUptime はその分の余裕を残します。思考を減らして、より速く安く回答させるには、プロバイダーの **追加パラメーター** に `{"output_config": {"effort": "low"}}` を設定します。OneUptime はそこに追加した設定をリクエストのたびに Anthropic へ送りますが、`model`、`messages`、`system`、`tools`、`tool_choice`、`stream` は OneUptime 自身が設定するため除きます。

OneUptime は Anthropic のプロンプトキャッシュを使います。調査や AI に質問の回答の各呼び出しは、システムプロンプト、ツール、それまでの会話を送り直し、OneUptime はそれらをキャッシュの対象として示します: 呼び出しは、それより前の呼び出しが送った部分には 10 分の 1 以下の料金を、新しい部分には料金の 4 分の 1 増しを支払い、新しい部分はキャッシュに書き込まれます。 Claude の前にあるゲートウェイがキャッシュの印を拒否した場合、OneUptime は印を付けずにリクエストを送り直し、そのことをプロバイダーごとに記憶します。[トークンの数え方](/docs/ai/ai-sre#トークンの数え方) では、キャッシュされたトークンが上限にどう数えられるかを説明しています。

### Azure OpenAI と Microsoft Foundry

Microsoft Foundry または Azure OpenAI にデプロイしたモデル(OpenAI モデル、その他の Foundry Models、Claude)には **Azure OpenAI / Microsoft Foundry** を使います。リソースのキーの一つを **API キー** に、デプロイの名前を **モデル名** に、リソースのエンドポイントを **ベース URL** に入力します。たとえば `https://contoso-ai.openai.azure.com/openai/v1` です。[Microsoft Foundry と Azure OpenAI](/docs/ai/microsoft-foundry) では、リソース、権限、モデルのデプロイ、ネットワーク要件、トラブルシューティングなど、Azure 側の手順を説明しています。

### Ollama(セルフホスト)

Ollama は、オープンソースのモデルを自分のマシンで動かします。

1. [ollama.ai](https://ollama.ai) から Ollama をインストールします
2. モデルを取得します: `ollama pull llama3.1`
3. Ollama が動いていて、OneUptime サーバーから到達できることを確認します。ネイティブインストールは `127.0.0.1` でしか待ち受けないため、ほかのマシンやコンテナからの接続を受け付けるには `OLLAMA_HOST=0.0.0.0:11434` を付けて起動します(公式の `ollama/ollama` Docker イメージはすでにそうしています)
4. LLM プロバイダーとして **Ollama** を選びます
5. ベース URL を入力します。OneUptime サーバーから見た Ollama サーバーのアドレスで、たとえば `http://ollama:11434` です(`/api/chat` は OneUptime が付け足します)。`localhost` は使えません。[セルフホストのモデルのベース URL を選ぶ](#セルフホストのモデルのベース-url-を選ぶ) を参照してください
6. 取得したモデルの名前を入力します

```text title="Ollama as a service named ollama on OneUptime's Docker Compose network"
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**コンテキストウィンドウを広げる。** 特に指定がない場合、Ollama は見つかった GPU メモリに応じてモデルのコンテキストウィンドウの大きさを決めます。24 GiB 未満では 4k トークン、48 GiB までは 32k、それを超えると 256k です(古いリリースは 2,048 または 4,096 トークンを使います)。OneUptime の AI 機能はエージェントです。すべてのリクエストにはシステムプロンプトとツールの定義が含まれ、質問の前だけで 10,000 トークンを超えます。さらに AI 調査は、進むにつれてクエリの結果を一つずつ会話に加えます。リクエストが収まらなくなると、Ollama は最も古いメッセージを捨て、質問も一緒に失われます。モデルと Ollama のリリースによっては、モデルが質問なしやツールなしで回答するか、リクエストが "no user query found in messages"(Qwen 3.8 以降)または "the prompt is longer than the context length currently available to the model" で失敗します。OneUptime はこれらの失敗を "…the request is larger than the model's context window" として報告し、調査を再実行しません。プロバイダーの **追加パラメーター** で、より大きな `num_ctx` を設定してください:

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime はこの `options` オブジェクトを Ollama に送るオプションにマージするため、変更したい設定だけを書いてください。65,536 トークンは Ollama がエージェント向けに推奨する値で、ほとんどの調査をまかなえます。OneUptime は会話がおよそ 75,000 トークンを超えてから古いクエリ結果を短くし始めるため、長い調査ではそれ以上を使うことがあります。モデルが対応し GPU に余裕があれば 131,072 を使ってください。コンテキストウィンドウを大きくするとメモリが多く必要になり、`ollama ps` で読み込まれた各モデルのコンテキストを確認できます。代わりにすべてのクライアントのデフォルトを上げるには、Ollama サーバーで `OLLAMA_CONTEXT_LENGTH` を設定します。OneUptime が OpenAI 互換の `/v1` API(**OpenAI Compatible** プロバイダー)経由で Ollama に接続する場合は、`num_ctx` が無視されるため、これが唯一の方法です。`GLOBAL_LLM_PROVIDER_*` 変数から登録したグローバルのプロバイダーでは、Admin Dashboard の **設定 → グローバルLLMプロバイダー** で **追加パラメーター** を設定します。起動時の同期はこの欄に触れません。

**よく使われる Ollama モデル:**

- `llama3.1` - Meta の Llama 3.1 モデル。ツール呼び出しに対応した最も古い Llama です
- `llama3.3` - Meta の Llama 3.3 モデル
- `qwen2.5` - Alibaba の Qwen 2.5 モデル
- `mistral-nemo` - Mistral AI の Nemo モデル

> [!NOTE]
> OneUptime の AI 機能はエージェントで、ツール呼び出しに大きく依存しています。`llama3.1` 以降、またはツールを呼び出せる別のモデルを使ってください。小さなモデルやツール呼び出しのないモデル(`llama2` や初期の `llama3` など)はうまく回答できません。モニター、インシデント、テレメトリを照会できないため、調査は空のまま、または作り話で返ってきます。

### セルフホストのモデルのベース URL を選ぶ

セルフホストのモデルのベース URL は、Ollama、vLLM、LM Studio、その他の OpenAI 互換サーバーのいずれでも、**OneUptime サーバー** から到達できるアドレスでなければなりません。ブラウザーがそこに接続することはありません。

**ループバックアドレスは常に拒否されます。** 接続の前に、OneUptime はベース URL のホスト名が解決されるすべてのアドレスを確認します。`localhost`、`127.0.0.1`、`[::1]`、`0.0.0.0`、さらに `169.254.169.254` のようなリンクローカルやクラウドメタデータのアドレスは、セルフホストも含むすべてのデプロイで拒否されます。これは意図的なもので、プロバイダーのベース URL を使って OneUptime サーバー自身のサービスに到達できてはならないからです。Docker Compose や Kubernetes の中では、`localhost` はいずれにしてもモデルを動かすマシンではなく OneUptime のコンテナを指します。

代わりにプライベートアドレスか内部のホスト名を使います:

| モデルサーバーが動いている場所 | ベース URL |
| --- | --- |
| OneUptime の Docker Compose ネットワーク(`oneuptime`)上のサービス | サービス名。例: `http://ollama:11434` |
| OneUptime と同じ Kubernetes クラスター | Service の DNS 名。例: `http://ollama.<namespace>.svc.cluster.local:11434`。[同梱の vLLM](#kubernetes-上のセルフホストの-vllmhelm) と同じパターンです |
| コンテナの外のホストマシン自体 | ホストの LAN IP。例: `http://192.168.1.20:11434`、Docker Desktop では `http://host.docker.internal:11434` |
| ネットワーク上の別のマシン | そのマシンのプライベート IP または内部ホスト名。例: `http://10.0.0.12:11434` |

OpenAI 互換サーバーも同じ規則に従い、それぞれのポートと `/v1` パスを使います。例: `http://vllm:8000/v1`、LM Studio なら `http://192.168.1.20:1234/v1`。ネイティブインストールの Ollama と同じく、LM Studio もサーバー設定で **Serve on Local Network** をオンにするまでは `127.0.0.1` でしか待ち受けません。

**セルフホストのインストールではプライベートアドレスが使えます。** セルフホストの OneUptime は `10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`100.64.0.0/10`、IPv6 の `fc00::/7` などのプライベートネットワークのアドレスに到達できます。ただし `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` を設定すると、OneUptime Cloud と同じようにこれらを拒否します。この設定は、プロジェクトではなく管理者が(`GLOBAL_LLM_PROVIDER_*` 変数または Admin Dashboard で)構成するグローバルの LLM プロバイダーには適用されず、そのプロバイダーは引き続きプライベートアドレスに到達できます。ループバックとリンクローカルのアドレスは、どのプロバイダーでも拒否されたままです。

**OneUptime Cloud(SaaS)はプライベートネットワークに到達できません。** すべての LLM プロバイダーについて、プライベートネットワークのアドレスと、それに解決されるホスト名を拒否します。自分のインフラで動くモデルを使うには、そのモデルに到達できるネットワークで OneUptime をセルフホストするか、モデルを公開到達可能なエンドポイントで提供してください。公開エンドポイントは API キーで保護します。**Ollama** プロバイダーは認証情報を送りませんが、**OpenAI Compatible** は API キーを bearer トークンとして送ります(Ollama は `/v1` で OpenAI 互換の API も提供するため、キーを確認するリバースプロキシの背後に置けます)。

### OpenAI Compatible(vLLM、LocalAI、LM Studio など)

OpenAI の `/chat/completions` API を実装しているが OpenAI 自体ではないサーバーには、**OpenAI Compatible** プロバイダーを使います。たとえば [vLLM](https://docs.vllm.ai)、[LocalAI](https://localai.io)、[LM Studio](https://lmstudio.ai)、text-generation-webui です。これらは通常、自分のアドレスで、多くの場合は認証なしで動いています。

1. OpenAI 互換サーバーを起動し、ベース URL を控えます(通常は `/v1` で終わります)
2. LLM プロバイダーとして **OpenAI Compatible** を選びます
3. **ベース URL** を入力します(必須)。例: `http://your-server:8000/v1`。OneUptime サーバーから到達できる必要があるため、`localhost` は使えません。[セルフホストのモデルのベース URL を選ぶ](#セルフホストのモデルのベース-url-を選ぶ) を参照してください
4. **モデル名** を入力します(必須)。サーバーが提供しているモデルと一致している必要があります
5. **API キー** は、サーバーが求める場合だけ入力します。キーのないサーバーでは空のままにします

```text title="A keyless vLLM"
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> [!TIP]
> 保存後、プロバイダーの **テスト** で接続、モデル名、ベース URL を確認してください。

### Kubernetes 上のセルフホストの vLLM(Helm)

Helm チャートで OneUptime をセルフホストしている場合、OpenAI 互換の推論サーバーである [vLLM](https://docs.vllm.ai) をクラスター内で動かし、自分の GPU でローカルモデルを提供できます。データがインフラの外に出ることはありません。

1. Helm の values で有効にします(NVIDIA の GPU ノードが必要です):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. `helm upgrade` を実行し、vLLM の Pod が Ready になるまで待ちます(初回の起動でモデルがダウンロードされます)
3. これで完了です。vLLM は起動時にグローバルの LLM プロバイダーとして自動登録される(`vllm.globalProvider.enabled`、デフォルトは `true`)ため、AI 修正タスクを含め、すべてのプロジェクトで AI 機能が動きます。(Cloud でもセルフホストでも、プロジェクトが独自のプロバイダーを持たない場合、エージェントの修正タスクはグローバルのプロバイダーを使います。Cloud ではその利用分が従量制の AI トークンとして請求されます。プロジェクトが所有するプロバイダーが常に優先されます。)

自動登録をオフにした場合(`vllm.globalProvider.enabled: false`)は、プロバイダーを手動で作成します:

1. LLM プロバイダーとして **OpenAI Compatible** を選びます(vLLM は OpenAI API を話します)
2. クラスター内のベース URL を入力します: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1`(`global.clusterDomain` を変更した場合は `cluster.local` を置き換えます)
3. モデル名を入力します: Hugging Face のモデル ID の全体です(`vllm.servedModelName` を設定した場合はその値)
4. API キーは `vllm.apiKey` を設定した場合だけ入力します。キーのない vLLM では空のままにします

```text title="The in-cluster vLLM"
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

課金が有効な場合、または `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`(Helm の values では `outboundConnections.blockPrivateNetwork: true`)の場合、プロジェクト独自のプロバイダーはこのクラスター内アドレスに到達できません。このアドレスはクラスターのプライベート IP に解決されるからです。代わりに、Admin Dashboard の **設定 → グローバルLLMプロバイダー** で同じ項目を使ってプロバイダーを作成します。グローバルの LLM プロバイダーならこのアドレスに到達できます。

GPU のスケジューリング、アクセス制限のあるモデル、チューニングのオプションについては、[Helm チャートの vLLM ガイド](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) を参照してください。

## よい運用

- **プロバイダーにわかりやすい名前を付けます**。"Production OpenAI" や "Development Ollama" のようにすると、チームメンバーがどれがどれかわかります。
- **キーは API キーの欄に入れます。** API キーは保存時に暗号化され、読めるのはプロジェクトのオーナーと管理者だけです。
- **変更のたびにテストします**。プロバイダーの **テスト** を使います。
- **AI のコストを把握します。** すべての呼び出しが、トークンとコストとともに **プロジェクト設定 → AI → AI ログ** に一覧表示されます。

## トラブルシューティング

:::details プロバイダーに到達できない
- **OpenAI または Anthropic**: API キーが有効で、クレジットが残っていることを確認します
- **Azure OpenAI / Microsoft Foundry**: エラーは変更すべき点から始まります。[Microsoft Foundry と Azure OpenAI](/docs/ai/microsoft-foundry) で Azure が返す各エラーを説明しています
- **Ollama**: Ollama サーバーが動いていて、OneUptime サーバーから到達できるアドレスで待ち受けていること(ネイティブインストールでは `OLLAMA_HOST=0.0.0.0:11434`)、ベース URL がそのアドレスを指していることを確認します
- **OpenAI Compatible**: ベース URL が `/v1` で終わっている(またはサーバーに合っている)こと、モデル名がサーバーの提供するモデルと一致していること、API キーはサーバーが求める場合だけ設定していることを確認します
- **"…points to an address OneUptime is not allowed to connect to"**: ベース URL が拒否されるアドレスに解決されています。`localhost` やその他のループバックアドレス、または OneUptime Cloud ではプライベートネットワークのアドレスです。(OneUptime Cloud では、拒否されたホスト名は代わりに "…could not be reached" と報告されます。)[セルフホストのモデルのベース URL を選ぶ](#セルフホストのモデルのベース-url-を選ぶ) を参照してください
- **ファイアウォール**: ネットワークがプロバイダーの API への外向きの接続を許可していることを確認します
:::

:::details モデルが見つからない
モデル名の綴りを確認します。Ollama では、先に `ollama pull <model-name>` でモデルを取得します。一部のリージョンでしか使えないモデルもあります。
:::

:::details コンテキストウィンドウが小さすぎる
- **"…the request is larger than the model's context window"**: リクエストがモデルのコンテキストウィンドウに収まりませんでした。多くの場合、AI 調査が多くの証拠を集めたためです。プロバイダーの **追加パラメーター** で `num_ctx` を上げるか、Ollama サーバーで `OLLAMA_CONTEXT_LENGTH` を上げます。[Ollama(セルフホスト)](#ollamaセルフホスト) を参照してください
- **"no user query found in messages"**: 同じ問題を Qwen が報告したものです。OneUptime は常に質問を送っていますが、残りのリクエストを収めるために Ollama が質問を捨てました
:::

まだ解決しない場合は、[OneUptime の GitHub の issue](https://github.com/OneUptime/oneuptime/issues) でエラーを探すか、プランにサポートが含まれていればサポートにお問い合わせください。

## 次のステップ

:::cards
- [コード](/docs/ai/ai-agent): プロバイダーが書くプルリクエストと、その開始場所です。
- [AI SRE](/docs/ai/ai-sre): プロバイダーを得た OneUptime AI が何をするかです。
- [AI に質問](/docs/ai/ask-ai): プロジェクトに質問し、会話のプロバイダーを切り替えます。
:::
