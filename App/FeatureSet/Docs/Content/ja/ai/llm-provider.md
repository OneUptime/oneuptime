# LLM プロバイダー

OneUptime は、プラットフォーム全体で AI 機能を有効にするため、さまざまな大規模言語モデル（LLM）プロバイダーとの統合をサポートしています。このガイドでは、独自の LLM プロバイダーの設定方法について説明します。

## LLM プロバイダーでできること

OneUptime の LLM プロバイダーは、インシデント管理ワークフローの自動化と強化を支援します。

- **インシデントノート**: 詳細なインシデントノートと更新を自動生成します
- **アラートノート**: 意味のあるアラートの説明とコンテキストを作成します
- **定期メンテナンスノート**: メンテナンスイベントのノートを自動生成します
- **インシデントポストモーテム**: 包括的なインシデントポストモーテムレポートを自動的に下書きします
- **コード改善**: コードリポジトリを OneUptime に接続すると、LLM プロバイダーを使用してテレメトリデータ（ログ、トレース、メトリクス、例外）を分析し、コード改善の提案を行います

## OneUptime SaaS ユーザー

**OneUptime SaaS**（クラウドホスト版）をご利用の場合、追加設定なしにデフォルトで **グローバル LLM プロバイダー** を使用できます。グローバル LLM プロバイダーはすべての AI 機能に対して事前設定済みですぐにご利用いただけます。

独自の API キーや特定のプロバイダーをご利用の場合は、以下の手順に従ってカスタム LLM プロバイダーを設定することもできます。

## サポートされているプロバイダー

OneUptime は現在、以下の LLM プロバイダーをサポートしています。

| プロバイダー  | 説明                                                                   | API キー必須 | ベース URL 必須          |
| ------------- | ---------------------------------------------------------------------- | ------------ | ------------------------ |
| **OpenAI**    | GPT-4、GPT-4o、GPT-3.5 Turbo、その他の OpenAI モデル                   | はい         | いいえ（デフォルト使用） |
| **Anthropic** | Claude 3 Opus、Claude 3 Sonnet、Claude 3 Haiku、その他の Claude モデル | はい         | いいえ（デフォルト使用） |
| **Ollama**    | Llama 2、Mistral、CodeLlama などのセルフホストオープンソースモデル     | いいえ       | はい                     |

## LLM プロバイダーのセットアップ

### ステップ 1: LLM プロバイダー設定に移動する

1. OneUptime ダッシュボードにログインします
2. **AIエージェント** > **LLM プロバイダー** に移動します
3. **LLM プロバイダーを作成** をクリックして新しいプロバイダーを追加します

### ステップ 2: プロバイダーを設定する

以下のフィールドを入力します。

- **名前**: この LLM 設定のわかりやすい名前（例: "本番 OpenAI"、"ローカル Ollama"）
- **説明**（任意）: このプロバイダーの目的を識別するための説明
- **LLM タイプ**: プロバイダーの種類を選択（OpenAI、Anthropic、または Ollama）
- **API キー**: API キー（OpenAI と Anthropic では必須）
- **モデル名**: 使用する特定のモデル（例: `gpt-4o`、`claude-3-opus-20240229`、`llama2`）
- **ベース URL**（任意）: カスタム API エンドポイント URL（Ollama では必須、その他では任意）

## プロバイダー別の設定

### OpenAI

1. [OpenAI Platform](https://platform.openai.com/api-keys) から API キーを取得します
2. **LLM タイプ** として **OpenAI** を選択します
3. API キーを入力します
4. モデル名を選択します:
   - `gpt-4o` - 最も高性能なモデル、複雑なタスクに最適
   - `gpt-4o-mini` - より高速でコスト効率が高い
   - `gpt-4-turbo` - 性能と速度のバランスが良い
   - `gpt-3.5-turbo` - 高速で経済的

**設定例:**

```
Name: Production OpenAI
LLM Type: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-4o
```

### Anthropic

1. [Anthropic Console](https://console.anthropic.com/) から API キーを取得します
2. **LLM タイプ** として **Anthropic** を選択します
3. API キーを入力します
4. モデル名を選択します:
   - `claude-3-opus-20240229` - 最も高性能なモデル
   - `claude-3-sonnet-20240229` - 知性と速度のバランスが良い
   - `claude-3-haiku-20240307` - 最速でコンパクト
   - `claude-3-5-sonnet-20241022` - 最新の Sonnet モデル

**設定例:**

```
Name: Production Anthropic
LLM Type: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-3-5-sonnet-20241022
```

### Ollama（セルフホスト）

Ollama を使用すると、オープンソースの LLM をローカルまたは独自のインフラストラクチャで実行できます。

1. [ollama.ai](https://ollama.ai) から Ollama をインストールします
2. 希望するモデルをプルします: `ollama pull llama2`
3. Ollama が実行中でアクセス可能であることを確認します
4. **LLM タイプ** として **Ollama** を選択します
5. ベース URL を入力します（例: `http://localhost:11434`）
6. プルしたモデル名を入力します

**設定例:**

```
Name: Local Ollama
LLM Type: Ollama
Base URL: http://localhost:11434
Model Name: llama2
```

**人気の Ollama モデル:**

- `llama2` - Meta の Llama 2 モデル
- `llama3` - Meta の Llama 3 モデル
- `mistral` - Mistral AI のモデル
- `codellama` - コード特化の Llama モデル
- `mixtral` - Mistral の Mixture of Experts モデル

## カスタムベース URL の使用

エンタープライズ環境やプロキシサービスを使用する場合、カスタムベース URL を指定できます。

- **Azure OpenAI**: Azure エンドポイント URL を使用します
- **OpenAI 互換 API**: OpenAI の API 仕様に準拠するあらゆる API
- **プライベート Ollama インスタンス**: 社内 Ollama サーバーの URL

## ベストプラクティス

1. **わかりやすい名前を使用する**: プロバイダーを明確に命名します（例: "本番 GPT-4"、"開発 Ollama"）
2. **API キーを安全に管理する**: API キーは保存時に暗号化されますが、共有しないようにしてください
3. **設定をテストする**: セットアップ後、AI 機能でプロバイダーが正常に動作することを確認します
4. **使用状況を監視する**: コストを管理するために API の使用状況を追跡します

## トラブルシューティング

### 接続の問題

- **OpenAI/Anthropic**: API キーが有効で十分なクレジットがあることを確認します
- **Ollama**: Ollama サーバーが稼働しており、ベース URL が正しいことを確認します
- **ファイアウォール**: ネットワークがプロバイダーの API へのアウトバウンド接続を許可していることを確認します

### モデルが見つからない場合

- モデル名のスペルが正しいことを確認します
- Ollama の場合は、`ollama pull <model-name>` でモデルをプルしていることを確認します
- モデルがご利用のリージョンで利用可能かどうか確認します（一部のモデルには地域制限があります）

## サポートが必要ですか？

LLM プロバイダーの設定で問題が発生した場合は:

1. 既知の問題を確認するために [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) をご確認ください
2. エンタープライズプランをご利用の場合はサポートにお問い合わせください
