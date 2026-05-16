# AIエージェント

OneUptime の AI エージェントは、コード内のエラー、パフォーマンスの問題、データベースクエリを自動的に修正します。OpenTelemetry の観測データを活用し、AI エージェントはアラートを送るだけでなく、修正を含むプルリクエストを作成します。

## AI エージェントでできること

AI エージェントは、観測データ（トレース、ログ、メトリクス）を分析し、コードベースの問題を検出して自動的に修正します。

- **エラーの自動修正**: AI エージェントがトレースやログ内の例外を検出すると、問題を自動的に修正してプルリクエストを作成します。
- **パフォーマンス問題の修正**: 実行に最も時間がかかるトレースを分析し、パフォーマンス最適化を含むプルリクエストを作成します。
- **データベースクエリの修正**: 遅いまたは非効率なデータベースクエリを特定し、適切なインデックス設定やクエリの書き直しで最適化します。
- **フロントエンド問題の修正**: フロントエンド固有のパフォーマンス問題、レンダリングの問題、JavaScript エラーを自動的に対処します。
- **テレメトリの自動追加**: ワンクリックでトレース、メトリクス、ログをコードベースに追加します。手動のインストルメンテーションは不要です。
- **GitHub & GitLab 連携**: 既存のリポジトリとシームレスに統合します。PR はワークフロー内で直接作成されます。
- **CI/CD 連携**: 既存の CI/CD パイプラインと統合します。修正は PR 作成前にテストおよび検証されます。
- **Terraform サポート**: インフラの問題を自動的に修正します。インフラストラクチャ・アズ・コードの Terraform および OpenTofu をサポートします。
- **イシュートラッカー連携**: Jira、Linear、その他のイシュートラッカーと連携します。修正を関連するイシューに自動的にリンクします。

## 仕組み

1. **データ収集**: OpenTelemetry がアプリケーションからトレース、ログ、メトリクスを収集します
2. **問題の検出**: AI がエラー、パフォーマンスのボトルネック、遅いクエリを特定します
3. **修正の生成**: AI がコードベースを分析し、修正を自動的に作成します
4. **PR の作成**: 修正と詳細なレポートを含むプルリクエストがレビューのために準備されます

## LLM プロバイダーの柔軟性

OneUptime はあらゆる LLM プロバイダーに対応しています。以下をご利用いただけます。

- **OpenAI GPT** モデル
- **Anthropic Claude** モデル
- **Meta Llama**（Ollama やその他のプロバイダー経由）
- **カスタムセルフホスト**モデル

AI モデルをセルフホストして、コードを完全にプライベートに保ちます。

## プライバシー

プランに関わらず、OneUptime はお客様のコードを閲覧、保存、またはトレーニングに使用することは一切ありません。

- **コードへのアクセスなし**: コードはお客様のインフラストラクチャ内に留まります
- **データ保存なし**: データ保持ゼロポリシー
- **トレーニングなし**: コードが AI のトレーニングに使用されることはありません

## グローバル AI エージェントとセルフホスト AI エージェント

### グローバル AI エージェント

**OneUptime SaaS**（クラウドホスト版）をご利用の場合、グローバル AI エージェントは OneUptime によって提供され、事前設定済みですぐにご利用いただけます。これらのエージェントは OneUptime によって管理されており、追加のセットアップは不要です。

グローバル AI エージェントは、プロジェクト設定で無効にしない限り、すべてのプロジェクトで自動的に利用可能です。

### セルフホスト AI エージェント

セキュリティ、コンプライアンス、またはネットワークアクセス要件のため、独自のインフラストラクチャ内で AI エージェントを実行する必要がある組織向けに、OneUptime はセルフホスト AI エージェントをサポートしています。

セルフホスト AI エージェントの特徴:
- プライベートネットワーク内で動作します
- 内部リソースとシステムにアクセスできます
- エージェントの環境を完全に制御できます
- 特定のニーズに合わせてカスタマイズできます

## セルフホスト AI エージェントのセットアップ

### ステップ 1: OneUptime で AI エージェントを作成する

1. OneUptime ダッシュボードにログインします
2. **プロジェクト設定** > **AI エージェント** に移動します
3. **AI エージェントを作成** をクリックして新しいエージェントを追加します
4. 必須フィールドを入力します:
   - **名前**: AI エージェントのわかりやすい名前
   - **説明**（任意）: エージェントの目的の説明
5. 作成後、`AI_AGENT_ID` と `AI_AGENT_KEY` が発行されます

**重要**: `AI_AGENT_KEY` を安全な場所に保存してください。一度しか表示されず、後から取得することはできません。

### ステップ 2: AI エージェントをデプロイする

#### Docker

AI エージェントを実行するには、Docker がインストールされていることを確認してください。以下のコマンドでエージェントを実行します。

```bash
docker run --name oneuptime-ai-agent --network host \
  -e AI_AGENT_KEY=<ai-agent-key> \
  -e AI_AGENT_ID=<ai-agent-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/ai-agent:release
```

OneUptime をセルフホストしている場合は、`ONEUPTIME_URL` をカスタムセルフホストインスタンスの URL に変更してください。

#### Docker Compose

docker-compose を使用して AI エージェントを実行することもできます。`docker-compose.yml` ファイルを作成します。

```yaml
version: "3"

services:
  oneuptime-ai-agent:
    image: oneuptime/ai-agent:release
    container_name: oneuptime-ai-agent
    environment:
      - AI_AGENT_KEY=<ai-agent-key>
      - AI_AGENT_ID=<ai-agent-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

次に実行します。

```bash
docker compose up -d
```

#### Kubernetes

`oneuptime-ai-agent.yaml` ファイルを作成します。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-ai-agent
spec:
  selector:
    matchLabels:
      app: oneuptime-ai-agent
  template:
    metadata:
      labels:
        app: oneuptime-ai-agent
    spec:
      containers:
      - name: oneuptime-ai-agent
        image: oneuptime/ai-agent:release
        env:
          - name: AI_AGENT_KEY
            value: "<ai-agent-key>"
          - name: AI_AGENT_ID
            value: "<ai-agent-id>"
          - name: ONEUPTIME_URL
            value: "https://oneuptime.com"
```

設定を適用します。

```bash
kubectl apply -f oneuptime-ai-agent.yaml
```

### 環境変数

AI エージェントは以下の環境変数をサポートしています。

#### 必須変数

| 変数 | 説明 |
|----------|-------------|
| `AI_AGENT_KEY` | OneUptime ダッシュボードからの AI エージェントキー |
| `AI_AGENT_ID` | OneUptime ダッシュボードからの AI エージェント ID |
| `ONEUPTIME_URL` | OneUptime インスタンスの URL（デフォルト: https://oneuptime.com） |


## AI エージェントの確認

AI エージェントをデプロイした後:

1. OneUptime ダッシュボードの **プロジェクト設定** > **AI エージェント** に移動します
2. 数分以内にエージェントが **接続済み** と表示されます
3. ステータスが **切断済み** と表示される場合は、コンテナログでエラーを確認してください

コンテナログを確認するには:

```bash
# Docker
docker logs oneuptime-ai-agent

# Kubernetes
kubectl logs deployment/oneuptime-ai-agent
```

## トラブルシューティング

### エージェントが接続できない場合

1. **認証情報の確認**: `AI_AGENT_KEY` と `AI_AGENT_ID` が正しいことを確認します
2. **ネットワークの確認**: エージェントが OneUptime インスタンスに到達できることを確認します
3. **ログの確認**: コンテナログでエラーメッセージを確認します
4. **ファイアウォールルール**: アウトバウンド HTTPS（ポート 443）が許可されていることを確認します

### エージェントが頻繁に切断される場合

1. **リソース制限の確認**: コンテナに十分なメモリと CPU があることを確認します
2. **ネットワークの安定性**: ネットワーク接続が安定していることを確認します
3. **ログの確認**: ログ内のタイムアウトや接続エラーを確認します

## サポートが必要ですか？

AI エージェントで問題が発生した場合:

1. 既知の問題を確認するために [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues) をご確認ください
2. 問題がまだ報告されていない場合は、新しいイシューを作成してください
3. エンタープライズプランをご利用の場合は、[サポート](https://oneuptime.com/support) にお問い合わせください
