# Microsoft Teams統合

セルフホストのOneUptimeインスタンスとMicrosoft Teamsを統合するには、AzureアプリのregistrationN（アプリ登録）を設定して必要な環境変数を構成する必要があります。

## 前提条件

- Azureアカウント — [https://azure.com](https://azure.com) でアカウントを作成できます
- OneUptimeサーバー設定へのアクセス

### プライベートネットワークへのデプロイ

OneUptimeのTeams統合はAzure Botを使用します。Incoming WebhookやTeams WorkflowのURLは、このボットのメッセージングエンドポイントの代わりにはなりません。Microsoftは、[セルフホスト型ボットに公開アクセス可能なHTTPSエンドポイント](https://learn.microsoft.com/en-us/azure/bot-service/bot-service-resources-faq-security?view=azure-bot-service-4.0)を要求しています。プライベートIPアドレス、内部DNS名、従業員のVPN接続では、Azure Bot ServiceからOneUptimeにアクセスできません。

設定を続ける前に、[統合のプライベートネットワークアクセス](/docs/self-hosted/integration-network-access)に従ってください。このガイドでは、公開DNS、信頼されたTLS、プライベート環境に転送するリバースプロキシ、ファイアウォールルール、検証を説明しています。Teamsでは`/api/microsoft-bot/messages`を公開し、ステップ4のAzure Botの**メッセージングエンドポイント**に、その完全な公開HTTPS URLを設定します。`/api`プレフィックス、リクエスト本文、`Authorization`ヘッダーを維持してください。リクエストの検証はボットの認証に任せます。プロキシへの対話型ログインやブラウザーチャレンジがあると、Microsoftからリクエストを配信できません。

アプリ登録のリダイレクト先`/api/microsoft-teams/auth`と`/api/microsoft-teams/admin-consent/callback`へのアクセスは、ユーザーのブラウザーを経由します。そのブラウザーは、社内ネットワークやVPNなどを通じてOneUptimeに到達する必要があります。ボットメッセージやカードの操作はMicrosoftのサーバーから届くため、別途到達可能なイングレスが必要です。アウトバウンドアラートの配信だけではインバウンド接続は検証できません。

開発向けには、Microsoftの[Teamsテストガイド](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/debug)で、トンネルによるローカルサービスの公開を説明しています。OneUptimeのイングレスに転送し、Microsoftの例の`/api/messages`パスを`/api/microsoft-bot/messages`に置き換えてください。公開トンネルのURLが変わるたびにAzure Botのエンドポイントを更新し、本番環境では安定したイングレスを使用します。

Azure Bot Private Endpointは、このTeamsイングレスの代わりにはなりません。Microsoftの[ネットワーク分離手順](https://learn.microsoft.com/en-us/azure/bot-service/dl-network-isolation-how-to?view=azure-bot-service-4.0)はDirect Lineの分離について説明しており、公開ネットワークアクセスを無効にするとTeamsチャネルの設定が解除されると明記しています。

## セットアップ手順

### ステップ1：Azureアプリの登録を作成

1. [Azureポータル](https://portal.azure.com) にアクセスします
2. 「アプリの登録」に移動し、「新規登録」をクリックします
3. 登録フォームを入力します：
   - **名前：** oneuptime
   - **サポートされるアカウントタイプ：** 任意の組織ディレクトリのアカウント（任意のMicrosoft Entra IDテナント - マルチテナント）
   - **リダイレクトURI：** Web - `https://your-oneuptime-domain.com/api/microsoft-teams/auth`
   - 以下も追加してください：`https://your-oneuptime-domain.com/api/microsoft-teams/admin-consent/callback`
4. 「登録」をクリックします
5. 「アプリケーション（クライアント）ID」をメモしてください。後で必要になります

### ステップ2：Appの権限設定

1. アプリの登録で「APIのアクセス許可」に移動します
2. 「アクセス許可の追加」をクリックし、「Microsoft Graph」を選択します

**委任されたアクセス許可の追加**（サインイン済みユーザーに代わって動作する場合）：

- **User.Read** — OAuthフロー中に認証ユーザーのプロフィール情報（表示名、メール）を取得するために必要
- **Team.ReadBasic.All** — 通知先のTeamsチームを選択する際に、ユーザーが参加しているチームの一覧を取得するために必要
- **Channel.ReadBasic.All** — 通知配信のためにTeamsチーム内のチャンネル情報を読み取り、チャンネルを一覧表示するために必要
- **ChannelMessage.Send** — Teamsチャンネルにアラートとインシデントの通知を送信するために必要

**アプリケーションアクセス許可の追加**（サインインユーザーなしにApp自体として動作する場合）：

- **Team.ReadBasic.All** — 管理者の同意が付与された後、組織内のすべてのチームを一覧表示するために必要
- **Channel.ReadBasic.All** — チャンネルの存在を確認し、チャンネルの詳細を取得するために必要

`ChannelMessage.Send`は委任されたアクセス許可のみです。[Microsoft Graphアクセス許可リファレンス](https://learn.microsoft.com/en-us/graph/permissions-reference#channelmessagesend)にアプリケーションアクセス許可の種類はありません。上記の委任されたアクセス許可の一覧に残してください。

**注意：** ボットフレームワークは、TeamsアプリのマニフェストにあるResource-Specific Consent（RSC）権限を使用してメッセージ配信を処理します。これらの権限は：

- **ChannelMessage.Send.Group** — ボットがTeamsチャンネルにメッセージを送信できるようにする
- **ChannelMessage.Read.Group** — ボットがインタラクティブなコマンドのためにチャンネルメッセージを読み取れるようにする
- **Channel.Create.Group** — ボットが必要に応じてチャンネルを作成できるようにする

3. 「管理者の同意を与える」をクリックします

### ステップ3：クライアントシークレットの作成

1. アプリの登録で「証明書とシークレット」に移動します
2. 「新しいクライアントシークレット」をクリックします
3. 説明を追加し、有効期限を設定します（24ヶ月を推奨）
4. 「追加」をクリックしてシークレット値を即座にコピーしてください。再表示されません

**重要：** シークレットIDではなく、シークレットの値をコピーしてください。通常、値の方が長く、より多くの文字を含んでいます。

### ステップ4：ボットサービスの作成

1. Azureポータルで「Azure Bot」に移動し、「作成」をクリックします
2. ボット作成フォームを入力します：

   - **ボットのハンドル：** oneuptime-bot
   - **サブスクリプション：** Azureサブスクリプション
   - **リソースグループ：** 新規作成または既存のものを使用
   - **場所：** ユーザーに近い場所を選択
   - **価格レベル：** F0（無料）はテスト用には十分
   - 以前に作成したアプリ登録のApp（クライアント）IDとテナントIDを使用してください

3. 「確認と作成」をクリックし、「作成」をクリックします

4. デプロイ後、ボットリソースに移動し、「設定」に移動します
5. 「メッセージングエンドポイント」を `https://your-oneuptime-domain.com/api/microsoft-bot/messages` に設定します
6. 設定を保存します

### ステップ5：ボットにMicrosoft Teamsチャンネルを追加

1. Azure Botリソースで「チャンネル」に移動します
2. 「Microsoft Teams」を探し、「開く」または「追加」をクリックします
3. 設定を確認します（Teamsを有効にし、特定のニーズがない場合はデフォルトのメッセージングオプションを維持する）
4. 「保存」をクリックします（プロンプトが表示された場合は「完了」/「発行」もクリックする）

### ステップ6：OneUptime環境変数の設定

#### Docker Compose

Docker Composeを使用している場合、設定にこれらの環境変数を追加します：

```bash
MICROSOFT_TEAMS_APP_CLIENT_ID=YOUR_TEAMS_APP_CLIENT_ID
MICROSOFT_TEAMS_APP_CLIENT_SECRET=YOUR_TEAMS_APP_CLIENT_SECRET
MICROSOFT_TEAMS_APP_TENANT_ID=YOUR_MICROSOFT_TENANT_ID
```

#### KubernetesとHelm

KubernetesとHelmを使用している場合、`values.yaml` ファイルにこれらを追加します：

```yaml
microsoftTeamsApp:
  clientId: YOUR_TEAMS_APP_CLIENT_ID
  clientSecret: YOUR_TEAMS_APP_CLIENT_SECRET
   tenantId: YOUR_MICROSOFT_TENANT_ID
```

**重要：** これらの環境変数を追加した後、OneUptimeサーバーを再起動して反映させてください。

### ステップ7：TeamsアプリのマニフェストをアップロードN

1. **プロジェクト設定** > **ワークスペース** > **Microsoft Teams** に移動します
2. そこからTeamsアプリのマニフェストをダウンロードします
3. Microsoft Teamsを開き、サイドバーの「アプリ」をクリックします
4. 下部の「アプリを管理」をクリックします
5. 「カスタムアプリをアップロード」をクリックします
6. 「自分またはチームにアップロード」を選択します
7. 先ほどダウンロードしたマニフェストのzipファイルをアップロードします

## トラブルシューティング

問題が発生した場合：

- Appに正しい権限が付与されていることを確認します
- リダイレクトURIが完全一致していることを確認します（`your-oneuptime-domain.com` を実際のドメインに置き換える）
- 環境変数が正しく設定されていることを確認します
- ボットのメッセージングエンドポイントがインターネットからアクセス可能であることを確認します
- ボットがTeamsチャンネルで正しく設定されていることを確認します
- Teamsアプリのマニフェストが正常にアップロードされていることを確認します

## サポート

この統合の改善のためのフィードバックをお待ちしています。[hello@oneuptime.com](mailto:hello@oneuptime.com) までお送りください。
