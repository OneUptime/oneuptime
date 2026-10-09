# LLM プロバイダー

OneUptime は、プラットフォーム全体で AI 機能を有効にするため、さまざまな大規模言語モデル（LLM）プロバイダーとの統合をサポートしています。このガイドでは、独自の LLM プロバイダーの設定方法について説明します。

## LLM プロバイダーでできること

OneUptime の LLM プロバイダーは、インシデント管理ワークフローの自動化と強化を支援します。

- **自律調査**: 新しいインシデントとアラートを自動的に調査し、根拠を示した根本原因分析をタイムラインに投稿します。詳しくは [AI SRE](/docs/ai/ai-sre) をご覧ください
- **インシデントノート**: 詳細なインシデントノートと更新を自動生成します
- **アラートノート**: 意味のあるアラートの説明とコンテキストを作成します
- **定期メンテナンスノート**: メンテナンスイベントのノートを自動生成します
- **インシデントポストモーテム**: 包括的なインシデントポストモーテムレポートを自動的に下書きします
- **コード改善**: コードリポジトリを OneUptime に接続すると、LLM プロバイダーを使用してテレメトリデータ（ログ、トレース、メトリクス、例外）を分析し、コード改善の提案を行います

## OneUptime SaaS ユーザー

**OneUptime SaaS**（クラウドホスト版）をご利用の場合、追加設定なしにデフォルトで **グローバル LLM プロバイダー** を使用できます。グローバル LLM プロバイダーはすべての AI 機能に対して事前設定済みですぐにご利用いただけます。

独自の API キーや特定のプロバイダーをご利用の場合は、以下の手順に従ってカスタム LLM プロバイダーを設定することもできます。

OneUptime SaaS から接続できるのは、パブリックインターネット上の LLM エンドポイントだけです。セルフホストの Ollama や vLLM サーバーなど、プライベートネットワーク上のモデルには接続できません。自分で運用しているモデルを使うには、そのモデルに到達できるネットワーク上で OneUptime をセルフホストするか、モデルをパブリックなエンドポイントで公開してください。詳しくは [セルフホストモデルのベース URL の選び方](#セルフホストモデルのベース-url-の選び方) をご覧ください。

## セルフホスト: 環境変数だけでセットアップ

セルフホストのインスタンスで **すべてのプロジェクトに一度に** AI 機能を有効にする最も手早い方法は、OneUptime サーバーに `GLOBAL_LLM_PROVIDER_*` 環境変数を設定することです。Docker Compose なら `config.env` に、Helm なら values で設定します。起動時に OneUptime はこれらの変数からグローバル LLM プロバイダーを登録し、以後も同期を保ちます。プロジェクトごとにダッシュボードで設定する必要はなく、プロジェクトに独自のプロバイダーがない場合は AI 修正タスクもこのプロバイダーを使います。

| 変数 | 説明 |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | 有効にするには必須。`OpenAI`、`AzureOpenAI`、`Anthropic`、`Groq`、`Mistral`、`Ollama`、`OpenAICompatible` のいずれか |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API キー。OpenAI、Azure OpenAI、Anthropic、Groq、Mistral では必須。Ollama やキー不要の OpenAI 互換サーバーでは不要 |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | API エンドポイント。Azure OpenAI、Ollama、OpenAI 互換サーバーでは必須 |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | 使用するモデル（OpenAI 互換サーバーでは必須、それ以外では推奨） |
| `GLOBAL_LLM_PROVIDER_NAME` | ダッシュボードに表示される、任意のわかりやすい名前 |

**例: セルフホストの Ollama**

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# OneUptime サーバーから到達できるアドレス。localhost は不可:
# 後述の "セルフホストモデルのベース URL の選び方" を参照。
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# API キーは不要 — Ollama はキーなしで動作します。
```

**例: OpenAI**

```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```

同期は宣言的です。変数を変更すると次回の再起動時にプロバイダーが更新され、`GLOBAL_LLM_PROVIDER_TYPE` を削除するとプロバイダーも削除されます。管理ダッシュボードで手動作成したグローバルプロバイダーには一切手を加えません。各プロジェクトは引き続き **プロジェクト設定** > **AI** > **LLM プロバイダー** で独自のプロバイダーを追加でき、プロジェクトが所有するプロバイダーは常にグローバルプロバイダーより優先されます。

## サポートされているプロバイダー

OneUptime は現在、以下の LLM プロバイダーをサポートしています。

| プロバイダー          | 説明                                                                     | API キー必須   | ベース URL 必須          |
| --------------------- | ------------------------------------------------------------------------ | -------------- | ------------------------ |
| **OpenAI**            | GPT-5.1、その他の OpenAI モデル                                          | はい           | いいえ（デフォルト使用） |
| **Azure OpenAI**      | Azure デプロイメント上でホストされる OpenAI モデル                       | はい           | はい                     |
| **Anthropic**         | Claude Sonnet 5.5、Claude Opus 5.5、Claude Haiku 5.5、その他の Claude モデル | はい           | いいえ（デフォルト使用） |
| **Groq**              | Llama、Mixtral、その他のオープンモデル向けの高速推論                     | はい           | いいえ（デフォルト使用） |
| **Mistral**           | Mistral のホスト型モデル                                                 | はい           | いいえ（デフォルト使用） |
| **Ollama**            | Llama 3.1、Mistral、Qwen などのセルフホストオープンソースモデル          | いいえ         | はい                     |
| **OpenAI Compatible** | OpenAI 互換サーバー全般（vLLM、LocalAI、LM Studio など）                 | いいえ（任意） | はい                     |

## LLM プロバイダーのセットアップ

### ステップ 1: LLM プロバイダー設定に移動する

1. OneUptime ダッシュボードにログインします
2. **プロジェクト設定** > **AI** > **LLM プロバイダー** に移動します
3. **LLM プロバイダーを作成** をクリックして新しいプロバイダーを追加します

### ステップ 2: プロバイダーを設定する

以下のフィールドを入力します。

- **名前**: この LLM 設定のわかりやすい名前（例: "本番 OpenAI"、"ローカル Ollama"）
- **説明**（任意）: このプロバイダーの目的を識別するための説明
- **LLM プロバイダー**: プロバイダーの種類を選択（OpenAI、Azure OpenAI、Anthropic、Groq、Mistral、Ollama、または OpenAI Compatible）
- **API キー**: API キー（OpenAI、Azure OpenAI、Anthropic、Groq、Mistral では必須。Ollama と OpenAI 互換サーバーでは任意）
- **モデル名**: 使用する特定のモデル（例: `gpt-5.1`、`claude-sonnet-5-5`、`llama3.1`）
- **ベース URL**（任意）: カスタム API エンドポイント URL（Azure OpenAI、Ollama、OpenAI Compatible では必須、その他では任意）
- **その他の項目**（上記の項目の下に折りたたまれています）: **デフォルトに設定** は、AI 機能がプロジェクトのデフォルトプロバイダーしか使わないため、新しいプロバイダーではオンになっています。**追加パラメーター** は、すべてのリクエストでプロバイダーに送る追加パラメーターを指定する任意の JSON オブジェクトです（例: `{"temperature": 0.2}`）

## プロバイダー別の設定

### OpenAI

1. [OpenAI Platform](https://platform.openai.com/api-keys) から API キーを取得します
2. **LLM プロバイダー** として **OpenAI** を選択します
3. API キーを入力します
4. モデル名を選択します:
   - `gpt-5.1` - 推奨のデフォルト。ツール呼び出しと複雑な調査に強い
   - `gpt-5.1-mini` - より高速でコスト効率が高い

**設定例:**

```
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. [Anthropic Console](https://console.anthropic.com/) から API キーを取得します
2. **LLM プロバイダー** として **Anthropic** を選択します
3. API キーを入力します
4. モデル名を選択します:
   - `claude-sonnet-5-5` - 推奨のデフォルト。知性、速度、コストのバランスが最も良い
   - `claude-opus-5-5` - より高性能。最も難しい調査向け
   - `claude-haiku-5-5` - 最速でコスト効率が最も高い

**設定例:**

```
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7 以降のすべての Claude モデルはサンプリングを自ら決めるため、`temperature`、`top_p`、`top_k` を指定したリクエストを拒否します。OneUptime はこれらのモデルにはこれらの設定を送りません。それでもモデルがいずれかを拒否した場合、OneUptime はその設定を外してリクエストを送り直し、そのプロバイダーについて記憶します。

Claude 5 のモデルは回答の前に思考し、その思考は回答のトークン上限に含まれるため、OneUptime は思考のための余裕を確保します。思考を減らして、より速く、より安く回答させるには、プロバイダーの **追加パラメーター** に `{"output_config": {"effort": "low"}}` を設定します。そこに追加した設定は、OneUptime がリクエストごとに Anthropic へ送ります。ただし `model`、`messages`、`system`、`tools`、`tool_choice`、`stream` は OneUptime 自身が設定します。

### Ollama（セルフホスト）

Ollama を使用すると、オープンソースの LLM をローカルまたは独自のインフラストラクチャで実行できます。

1. [ollama.ai](https://ollama.ai) から Ollama をインストールします
2. 希望するモデルをプルします: `ollama pull llama3.1`
3. Ollama が実行中で、OneUptime サーバーから到達できることを確認します。ネイティブインストールは `127.0.0.1` でしか待ち受けないため、他のマシンやコンテナーからの接続を受け付けるには `OLLAMA_HOST=0.0.0.0:11434` を指定して起動します（公式の Docker イメージ `ollama/ollama` は最初からそうなっています）
4. **LLM プロバイダー** として **Ollama** を選択します
5. ベース URL を入力します。OneUptime サーバーから見た Ollama サーバーのアドレスで、例えば `http://ollama:11434` です（`/api/chat` は OneUptime が付け足します）。`localhost` は使えません。[セルフホストモデルのベース URL の選び方](#セルフホストモデルのベース-url-の選び方) をご覧ください
6. プルしたモデル名を入力します

**設定例（OneUptime の Docker Compose ネットワーク上で `ollama` という名前のサービスとして動く Ollama）:**

```
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**コンテキストウィンドウを広げる。** 特に指定しない限り、Ollama は検出した GPU メモリーに応じてモデルのコンテキストウィンドウのサイズを決めます。24 GiB 未満では 4k トークン、48 GiB までは 32k、それを超えると 256k です（古いリリースでは 2048 または 4096 トークン）。OneUptime の AI 機能はエージェントです。すべてのリクエストにはシステムプロンプトとツール定義が含まれ、質問を含める前の時点ですでに 10,000 トークンを超えます。さらに AI 調査では、クエリの結果が出るたびに会話に追加されていきます。リクエストが収まらなくなると、Ollama は最も古いメッセージから切り捨て、質問も一緒に失われます。モデルと Ollama のリリースによっては、その後モデルが質問なし、またはツールなしで回答するか、リクエストが "no user query found in messages"（Qwen 3.8 以降）または "the prompt is longer than the context length currently available to the model" で失敗します。OneUptime はこれらの失敗を "…the request is larger than the model's context window" として報告し、調査を再実行しません。プロバイダーの **追加パラメーター** で、より大きな `num_ctx` を設定してください:

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime はこの `options` オブジェクトを Ollama に送るオプションにマージするため、変更したい設定だけを書けば十分です。Ollama はエージェント向けに 65,536 トークンを推奨しており、ほとんどの調査はこれで収まります。長い調査ではそれ以上を使うことがあります。OneUptime が古いクエリ結果の短縮を始めるのは、会話がおよそ 75,000 トークンを超えてからだからです。モデルが対応し、GPU に収まるなら 131,072 を使ってください。コンテキストウィンドウを大きくするほどメモリーを多く使います。読み込まれた各モデルに割り当てられたコンテキストは `ollama ps` で確認できます。代わりにすべてのクライアントの既定値を引き上げるには、Ollama サーバーで `OLLAMA_CONTEXT_LENGTH` を設定します。OneUptime が Ollama の OpenAI 互換 `/v1` API（**OpenAI Compatible** プロバイダー）経由で接続する場合は、この API が `num_ctx` を無視するため、これが唯一の方法です。`GLOBAL_LLM_PROVIDER_*` 変数から登録されたグローバルプロバイダーの場合は、管理ダッシュボードの **設定** > **グローバルLLMプロバイダー** で **追加パラメーター** を設定してください。起動時の同期はこの項目を変更しません。

**人気の Ollama モデル:**

- `llama3.1` - Meta の Llama 3.1 モデル。ツール呼び出しに対応した最も古い Llama
- `llama3.3` - Meta の Llama 3.3 モデル
- `qwen2.5` - Alibaba の Qwen 2.5 モデル
- `mistral-nemo` - Mistral AI の Nemo モデル

> 注: OneUptime の AI 機能はエージェント型で、ツール呼び出しに大きく依存しています。`llama3.1` 以降（またはツール呼び出しに対応した別のモデル）を使用してください。小さなモデルやツール呼び出しに対応していないモデル（例: `llama2`、初代の `llama3`）では良い結果が得られません。モニター、インシデント、テレメトリーを照会できないため、調査結果が空になったり、事実に基づかない内容になったりします。

### セルフホストモデルのベース URL の選び方

セルフホストモデル（Ollama、vLLM、LM Studio、その他の OpenAI 互換サーバー）のベース URL は、**OneUptime サーバー** から到達できるアドレスでなければなりません。ブラウザーがこのアドレスに接続することはありません。

**ループバックアドレスは常に拒否されます。** OneUptime は接続の前に、ベース URL のホスト名が解決されるすべてのアドレスを確認します。`localhost`、`127.0.0.1`、`[::1]`、`0.0.0.0`、およびリンクローカルアドレスや `169.254.169.254` のようなクラウドのメタデータのアドレスは、セルフホストを含むすべてのデプロイで拒否されます。これは意図的な設計です。プロバイダーのベース URL を使って OneUptime サーバー自身のサービスに到達できてはならないからです。そもそも Docker Compose や Kubernetes の中では、`localhost` はモデルを動かしているマシンではなく OneUptime のコンテナーを指します。

代わりにプライベートアドレスか内部ホスト名を使用してください:

| モデルサーバーの実行場所 | ベース URL |
| --- | --- |
| OneUptime の Docker Compose ネットワーク（`oneuptime`）上のサービス | サービス名。例: `http://ollama:11434` |
| OneUptime と同じ Kubernetes クラスター | Service の DNS 名。例: `http://ollama.<namespace>.svc.cluster.local:11434`（[同梱の vLLM](#kubernetes-上のセルフホスト-vllmhelm) と同じパターン） |
| ホストマシン上で直接（コンテナーの外） | ホストの LAN IP。例: `http://192.168.1.20:11434`。Docker Desktop では `http://host.docker.internal:11434` も使えます |
| ネットワーク内の別のマシン | そのマシンのプライベート IP または内部ホスト名。例: `http://10.0.0.12:11434` |

OpenAI 互換サーバーにも、それぞれのポートと `/v1` パスで同じルールが当てはまります。例えば `http://vllm:8000/v1`、LM Studio なら `http://192.168.1.20:1234/v1` です。LM Studio もネイティブインストールの Ollama と同じく、サーバー設定で **Serve on Local Network** をオンにするまでは `127.0.0.1` でしか待ち受けません。

**セルフホスト環境ではプライベートアドレスを使えます。** セルフホストの OneUptime は、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`、`100.64.0.0/10`、IPv6 の `fc00::/7` などのプライベートネットワークのアドレスに到達できます。ただし `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` を設定すると、OneUptime Cloud と同じようにこれらも拒否されます。この設定はグローバル LLM プロバイダーには適用されません。グローバル LLM プロバイダーはプロジェクトではなく管理者が（`GLOBAL_LLM_PROVIDER_*` 変数または管理ダッシュボードで）設定するため、引き続きプライベートアドレスに到達できます。ループバックアドレスとリンクローカルアドレスは、どのプロバイダーでも拒否されたままです。

**OneUptime Cloud（SaaS）はプライベートネットワークに到達できません。** すべての LLM プロバイダーについて、プライベートネットワークのアドレスと、そのアドレスに解決されるホスト名を拒否します。自分のインフラストラクチャで動くモデルを使うには、そのモデルに到達できるネットワーク上で OneUptime をセルフホストするか、モデルをパブリックに到達可能なエンドポイントで公開してください。公開エンドポイントは API キーで保護してください。**Ollama** プロバイダーは認証情報を送信しませんが、**OpenAI Compatible** は API キーを Bearer トークンとして送信します（Ollama は `/v1` で OpenAI 互換 API も提供しているため、キーを検証するリバースプロキシの背後に置くことができます）。

### OpenAI Compatible（vLLM、LocalAI、LM Studio など）

OpenAI の `/chat/completions` API を実装しているものの OpenAI 自体ではないサーバー、例えば [vLLM](https://docs.vllm.ai)、[LocalAI](https://localai.io)、[LM Studio](https://lmstudio.ai)、text-generation-webui などには **OpenAI Compatible** プロバイダーを使用します。これらは通常、独自の URL でセルフホストされ、認証なしで動作することも多いです。

1. OpenAI 互換サーバーを起動し、そのベース URL を確認します（通常は `/v1` で終わります）
2. **LLM プロバイダー** として **OpenAI Compatible** を選択します
3. **ベース URL**（必須）を入力します。例: `http://your-server:8000/v1`。OneUptime サーバーから到達できる必要があるため、`localhost` は使えません。[セルフホストモデルのベース URL の選び方](#セルフホストモデルのベース-url-の選び方) をご覧ください
4. **モデル名**（必須）を入力します。サーバーが公開しているモデルと一致している必要があります
5. サーバーが認証を必要とする場合のみ **API キー** を入力します。キー不要のサーバーの場合は空欄のままにします

**設定例（キー不要の vLLM）:**

```
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> ヒント: 保存後、プロバイダーの **テスト** ボタンを使用して、接続、モデル名、ベース URL が正しいことを確認してください。

### Kubernetes 上のセルフホスト vLLM（Helm）

Helm チャートで OneUptime をセルフホストしている場合、OpenAI 互換の推論サーバーである [vLLM](https://docs.vllm.ai) をクラスター内で実行し、独自の GPU 上でローカルモデルを提供できます。データがインフラストラクチャの外に出ることはありません。

1. Helm の値で有効化します（NVIDIA GPU ノードが必要です）:

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. `helm upgrade` を実行し、vLLM ポッドが Ready になるまで待ちます（初回起動時にモデルがダウンロードされます）
3. これで完了です。vLLM は起動時にグローバル LLM プロバイダーとして自動的に登録される（`vllm.globalProvider.enabled`、デフォルト `true`）ため、AI 修正タスクを含め、AI 機能はすべてのプロジェクトで動作します。（クラウドでもセルフホストでも、プロジェクトが独自のプロバイダーを持たない場合、エージェントの修正タスクはグローバルプロバイダーを使います。クラウドではその利用分が従量制の AI トークンとして課金されます。プロジェクトが所有するプロバイダーが常に優先されます。）

自動登録を無効化した場合（`vllm.globalProvider.enabled: false`）は、プロバイダーを手動で作成します:

1. **LLM プロバイダー** として **OpenAI Compatible** を選択します（vLLM は OpenAI API に対応しています）
2. クラスター内のベース URL を入力します: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1`（`global.clusterDomain` を変更した場合は `cluster.local` を置き換えてください）
3. モデル名を入力します: HuggingFace のモデル ID 全体（設定した場合は `vllm.servedModelName`）
4. `vllm.apiKey` を設定した場合のみ API キーを入力します。キー不要の vLLM の場合は空欄のままにします

**設定例:**

```
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

課金が有効な場合や、`DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`（Helm の values では `outboundConnections.blockPrivateNetwork: true`）を設定した場合、プロジェクトが所有するプロバイダーはこのクラスター内のアドレスに到達できません。このアドレスはクラスターのプライベート IP に解決されるためです。代わりに、管理ダッシュボードの **設定** > **グローバルLLMプロバイダー** で、同じ項目を入力してプロバイダーを作成してください。グローバル LLM プロバイダーならこのアドレスに到達できます。

GPU スケジューリング、ゲート付きモデル、チューニングオプションについては、[Helm チャートの vLLM ガイド](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md) をご覧ください。

## カスタムベース URL の使用

エンタープライズ環境やプロキシサービスを使用する場合、カスタムベース URL を指定できます。

- **Azure OpenAI**: Azure エンドポイント URL を使用します
- **OpenAI 互換 API**: OpenAI の API 仕様に準拠するあらゆる API
- **プライベート Ollama インスタンス**: 社内 Ollama サーバーの URL

## ベストプラクティス

1. **わかりやすい名前を使用する**: プロバイダーを明確に命名します（例: "本番 OpenAI"、"開発 Ollama"）
2. **API キーを安全に管理する**: API キーは保存時に暗号化されますが、共有しないようにしてください
3. **設定をテストする**: セットアップ後、AI 機能でプロバイダーが正常に動作することを確認します
4. **使用状況を監視する**: コストを管理するために API の使用状況を追跡します

## トラブルシューティング

### 接続の問題

- **OpenAI/Anthropic**: API キーが有効で十分なクレジットがあることを確認します
- **Ollama**: Ollama サーバーが稼働しており、OneUptime サーバーから到達できるアドレスで待ち受けていること（ネイティブインストールでは `OLLAMA_HOST=0.0.0.0:11434`）、そしてベース URL がそのアドレスを指していることを確認します
- **OpenAI Compatible**: ベース URL が `/v1` で終わっている（またはサーバーに合っている）こと、モデル名がサーバーが公開しているモデルと一致していること、サーバーが認証を必要とする場合のみ API キーを設定していることを確認します
- **"…points to an address OneUptime is not allowed to connect to"**: ベース URL が拒否対象のアドレスに解決されています。`localhost` などのループバックアドレス、または OneUptime Cloud ではプライベートネットワークのアドレスです（OneUptime Cloud では、拒否されたホスト名は代わりに "…could not be reached" と報告されます）。[セルフホストモデルのベース URL の選び方](#セルフホストモデルのベース-url-の選び方) をご覧ください
- **ファイアウォール**: ネットワークがプロバイダーの API へのアウトバウンド接続を許可していることを確認します

### モデルが見つからない場合

- モデル名のスペルが正しいことを確認します
- Ollama の場合は、`ollama pull <model-name>` でモデルをプルしていることを確認します
- モデルがご利用のリージョンで利用可能かどうか確認します（一部のモデルには地域制限があります）

### コンテキストウィンドウが小さすぎる場合

- **"…the request is larger than the model's context window"**: リクエストがモデルのコンテキストウィンドウに収まりませんでした。通常は、AI 調査が多くの証拠を集めたことが原因です。プロバイダーの **追加パラメーター** で `num_ctx` を、または Ollama サーバーで `OLLAMA_CONTEXT_LENGTH` を引き上げてください。[Ollama（セルフホスト）](#ollamaセルフホスト) をご覧ください
- **"no user query found in messages"**: 同じ問題を Qwen が報告するときのメッセージです。OneUptime は必ず質問を送信しており、リクエストの残りを収めるために Ollama が質問を切り捨てています

## サポートが必要ですか？

LLM プロバイダーの設定で問題が発生した場合は:

1. 既知の問題を確認するために [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) をご確認ください
2. エンタープライズプランをご利用の場合はサポートにお問い合わせください
