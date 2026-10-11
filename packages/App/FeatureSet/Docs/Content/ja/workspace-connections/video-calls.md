# ビデオ通話

すべてのインシデントとアラートに専用の通話を用意します。新しいインシデントやアラートで Slack または Microsoft Teams の通知ルールが発動すると、OneUptime は専用の会議 (Zoom の会議、Google Meet、Microsoft Teams の会議、またはインシデントの Slack チャネルのハドル) を開始し、インシデントの更新が届くすべての場所に **通話に参加** ボタンを投稿します。対応者はワンクリックで参加でき、午前 3 時に誰かが会議を作ってリンクを配って回る必要はありません。

:::cards
- [しくみ](#しくみ): ルールが通話を開始し、対応者はどこからでも参加します。
- [ワンクリックで接続する](#ワンクリックで接続する): Zoom、Google Meet、Microsoft Teams に、サインインするだけで接続します。
- [プロバイダー](#プロバイダー): 自分のアプリのサービス ID、常設の会議リンク、Slack のハドル。
- [手動で通話を開始する](#手動で通話を開始する): インシデントやアラートのページから開始します。
:::

## しくみ

```mermaid title="通知ルールから Join call ボタンまで"
flowchart TB
    declared["インシデントまたはアラートが<br/>宣言される"] --> rule{"ビデオ通話付きの Slack または<br/>Teams のルールが一致する"}
    rule --> start["OneUptime がルールの接続で<br/>通話を 1 つ開始する"]
    start --> posted["Join call がチャネル、<br/>フィード、ページに投稿される"]
    start -.->|"プロバイダーが拒否する"| failed["フィードに理由が表示され、<br/>インシデントは続く"]
```

:::steps
### プロバイダーを接続する

**プロジェクト設定** > **ワークスペース** > **ビデオ通話** に移動し、Zoom、Google Meet、Microsoft Teams のいずれかを接続するか、常設の会議リンクを追加します。OneUptime Cloud では、Zoom、Google Meet、Microsoft Teams の接続はワンクリックです。サインインして、OneUptime に会議の作成を許可します ([ワンクリックで接続する](#ワンクリックで接続する) を参照)。Slack のハドルには、プロジェクトの Slack 接続以外に何も必要ありません。

### ルールでオンにする

インシデントまたはアラートの Slack や Microsoft Teams の通知ルールを開きます (たとえば **インシデント** > **ワークスペース** > **Slack** )。ルールの **ビデオ通話** ステップで **インシデントのビデオ通話を開始** をオンにし、通話を行う場所を選びます。

### ワンクリックで参加する

ルールが発動すると、OneUptime はインシデントの通話を 1 つ開始し、インシデントの更新が届くチャネルとインシデントのフィードに **通話に参加** ボタン付きで投稿します。インシデントのページでは、 **ビデオ通話** カードに通話が表示され、ヘッダーに **通話に参加** ボタンが表示されます。
:::

どのインシデントに通話を用意するかは、ルールの条件で決まります。Sev1 のインシデントだけでブリッジを開くには、ルールに **重大度** の条件を付けます。通話は、進行中として宣言されたインシデントとアラートで開始されます。すでに解決済みとして作成されたインシデントには通話は用意されません。

### インシデントごとに 1 つの通話

通話は、通話を行う場所ごとに、インシデントにつき 1 回だけ開始されます。同じ接続を選ぶルールは 1 つの通話を共有し、その接続の通話がすでにあるインシデントに対して、ルールが 2 つ目の通話を開始することはありません。異なる場所を選ぶルールは、それぞれ自分の通話を開始します。たとえば、対応者向けの Zoom の会議と、インシデントの Slack チャネルのハドルです。

### 通話を開始できない場合

インシデントの宣言が、ビデオ通話のプロバイダーを待つことはありません。通話はインシデントの作成後に開始されるので、プロバイダーが遅くても失敗しても、インシデントやそのオンコールの呼び出しが遅れることはありません。

プロバイダーが拒否した場合 (シークレットの期限切れ、権限の不足、ホストの削除など)、インシデントのフィードには、ルールの通話を開始できなかったことがプロバイダーの理由とともに表示されるので、対応者はインシデントのページから通話を開始すればよいとわかります。ルールの実行はワークスペースの通知ログに **ビデオ通話を開始する** として記録され、 **プロジェクト設定** > **ワークスペース** > **ビデオ通話** の接続の行には、通話が再び開始されるまでエラーが表示されます。

### 非公開のインシデント

会議の名前は対象のインシデントの番号とタイトルから付けられ、会議の説明にはインシデントへのリンクが含まれます。非公開のインシデントでは、会議に招待された全員が会議の名前を読めるので、タイトルは含まれません。

## ワンクリックで接続する

OneUptime Cloud では、Zoom、Google Meet、Microsoft Teams の接続はワンクリックで済み、プロバイダー側での設定は不要です。

:::steps
1. **プロジェクト設定** > **ワークスペース** > **ビデオ通話** に移動し、Zoom、Google Meet、Microsoft Teams のいずれかで **接続** をクリックします。
2. **Continue to Zoom** (または Google、Microsoft) をクリックしてサインインし、OneUptime に会議の作成を許可します。
3. 接続が完了した状態でビデオ通話のページに戻ります。 **テスト会議を開始** で端から端まで確認してから、Slack または Microsoft Teams の通知ルールでその接続を選びます。
:::

すべての会議は、サインインしたアカウントとして作成され、そのアカウントがホストになります。メンバーが退職しても通話が開始され続けるように、自分のアカウントではなく、incidents@example.com のような共有アカウントでサインインしてください。接続の行には、どのアカウントとしてサインインしているかが表示されます。

| プロバイダー | サインインに使うもの | OneUptime ができること |
| --- | --- | --- |
| Zoom | Zoom ユーザー。Basic (無料) ユーザーがホストの会議は 40 分で終了します。 | そのユーザーの会議の作成 (`meeting:write:meeting`) と、そのユーザーが誰かの読み取り (`user:read:user`)。 |
| Google Meet | Google Meet を使える Google アカウント。 | そのアカウントとしての Meet スペースの作成 (`meetings.space.created`) と、そのメールアドレスの読み取り。 |
| Microsoft Teams | Microsoft Teams を使える職場または学校のアカウント。個人の Microsoft アカウントでは Teams の会議を作成できません。 | そのアカウントとしてのオンライン会議の作成 (委任されたアクセス許可 `OnlineMeetings.ReadWrite`) と、サインイン状態の維持 (`offline_access`)。 |

サインインで作成した接続にも、誰が待つかを決める設定があります。Google Meet では **Who can join**、Microsoft Teams では **Who skips the lobby** です。接続の行の **編集** で変更します。

### サインイン状態を保つ

OneUptime はサインインのリフレッシュトークンを暗号化して保持し、少なくとも週に 1 回更新するので、プロジェクトでインシデントがどれだけ長く起きなくても、使われないことでトークンが期限切れになることはありません。サインインが機能しなくなった場合 (アカウントが OneUptime を削除した、アカウントが削除または停止された、組織のポリシーで再サインインが求められた)、接続の行には、次のインシデントのときではなく、OneUptime が気付いたその日に、理由とともに **Not working** と表示されます。行の **Reconnect** で再びサインインします。

同じアカウントとしてサインインした接続は、すべてのプロジェクトで 1 つのサインインを共有します。Zoom はアカウントごとに 1 つのサインインしか保持しないので、同じ Zoom ユーザーをもう一度接続すると、それらすべてのサインインが置き換わります。

### 再接続と削除

接続の行の **Reconnect** は、同じアカウントまたは別のアカウントで再びサインインします。アカウントが OneUptime を削除した後や、インシデントの会議を別のアカウントに移すときに使います。

接続を削除すると、そのサインインを使うほかの接続がなくなった時点で、Zoom と Google での OneUptime のアクセスが取り消されます。Microsoft では、アカウントの **My Apps** (myapps.microsoft.com) で OneUptime を削除します。Zoom App Marketplace で Zoom アカウントから OneUptime を削除すると、そのアカウントとしてサインインしたすべての接続からサインインが削除され、それらの接続には再接続するまで **Not working** と表示されます。

### Microsoft が管理者を求める場合

Microsoft 365 の組織によっては、アプリを承認できるのは管理者だけです。Microsoft に管理者の承認が必要だと言われたら、Microsoft 365 の管理者に Microsoft Teams を接続してもらうか、[Microsoft Entra 管理センター](https://entra.microsoft.com/) の **Enterprise applications** > **Admin consent requests** で OneUptime を承認してもらいます。

### 代わりに自分のアプリを使う

人のサインインではなくサービス ID で接続するには (Zoom の Server-to-Server OAuth アプリ、ドメイン全体の委任を設定した Google のサービスアカウント、Microsoft Entra のアプリ登録)、接続ダイアログで **Use your own Zoom app** (または Google、Microsoft) をクリックします。それぞれについては [プロバイダー](#プロバイダー) で説明しています。ワンクリック用のアプリを設定していないセルフホストのサーバーでは、 **接続** でこのフォームが直接開きます。設定方法は [セルフホストのサーバーでのワンクリック接続](#セルフホストのサーバーでのワンクリック接続) を参照してください。

## 手動で通話を開始する

インシデントやアラートのページの **ビデオ通話** カードには **通話を開始** があります (すでに通話がある場合は **別の通話を開始** )。プロジェクトの接続のいずれか、インシデントの Slack チャネルのハドルを選ぶか、自分の会議リンクを貼り付けます。通話は、ルールが開始した通話と同じく、インシデントのチャネルとフィードに投稿されます。

カードの **削除** は、インシデントのページから通話を外します。会議自体は削除されず、リンクを知っている人は引き続き参加できます。

通話の開始と削除には、インシデント (またはアラート) を操作する権限が必要です。 **Project Owner**、 **Project Admin**、 **Project Member**、 **Incident Admin**、 **Incident Member**、またはカスタムロールの **Create Incident Video Call** と **Delete Incident Video Call** です。インシデントを読める人は全員、その通話を見られます。

## プロバイダー

このセクションでは、自分のアプリのサービス ID でプロバイダーを接続する方法を説明します。Zoom の Server-to-Server OAuth アプリ、Google のサービスアカウント、Microsoft Entra のアプリ登録です。サービス ID は人に依存しないので、誰が退職しても動作し続けます。代わりにサインインで接続するには、[ワンクリックで接続する](#ワンクリックで接続する) を参照してください。

認証情報は保存時に暗号化され、API から返されることはありません。接続を編集するとき、空欄のままにした認証情報は保存済みの値が保持されます。

接続フォームの **テスト会議を開始** と、接続の行の **テスト** は、接続の設定で実際の会議を作成し、そのリンクを表示します。認証情報、プロバイダー側の権限、ホストがすべて連携して動作することを確かめられる唯一のチェックです。どこにも何も投稿されません。

プロバイダーの接続には、 **Project Owner**、 **Project Admin**、 **Settings Admin**、またはカスタムロールの **Create Video Call Connection** と **Edit Video Call Connection** が必要です。

### Zoom

OneUptime は、Zoom の **Server-to-Server OAuth** アプリを通じてインシデントごとに Zoom の会議を作成し、選んだライセンス付きの Zoom ユーザーがホストになります。

:::steps
1. [Zoom App Marketplace](https://marketplace.zoom.us/) で **Develop** > **Build App** を選び、 **Server-to-Server OAuth** アプリを作成します。作成には、Zoom アカウントの管理者、または Server-to-Server OAuth アプリを許可するロールが必要です。
2. アプリの **Scopes** ページで **meeting:write:meeting:admin** (ユーザーの会議を作成する) を追加します。詳細なスコープが導入される前に作成したアプリでは、代わりに **meeting:write:admin** を使えます。
3. **Activate** をクリックしてアプリを有効にし、 **App Credentials** ページの **Account ID**、 **Client ID**、 **Client secret** を接続フォームにコピーします。
4. **Meeting host** を入力します。ライセンス付きの Zoom ユーザーのメールアドレスで、メンバーが退職しても会議が動作し続けるように、incidents@example.com のようなサービスアカウントが理想的です。Basic (無料) ユーザーがホストの会議は 40 分で終了します。
5. ホストは参加することのないサービスアカウントなので、対応者はホストを待たずに参加します。Zoom アカウントの **Waiting room** の設定がオンでロックされていないことを確認してください。ロックされていると誰も入室できません。
:::

| フィールド | 入手場所 |
| --- | --- |
| Account ID | アプリの **App Credentials** ページ |
| Client ID | アプリの **App Credentials** ページ |
| Client secret | アプリの **App Credentials** ページ |
| Meeting host | すべての会議のホストになる、ライセンス付きの Zoom ユーザーのメールアドレス |

### Google Meet

OneUptime は、ドメイン全体の委任によって Google Workspace ユーザーとして動作する Google Cloud のサービスアカウントを通じて、Google Meet REST API でインシデントごとに Google Meet を作成します。

:::steps
1. [Google Cloud コンソール](https://console.cloud.google.com/) でプロジェクトを選ぶか作成し、そのプロジェクトで **Google Meet REST API** を有効にします。
2. **IAM & Admin** > **Service accounts** でサービスアカウントを作成します。それを開き、 **Keys** > **Add key** > **Create new key** に移動して **JSON** を選び、ダウンロードしたファイルを接続フォームの **Service account JSON key** に貼り付けます。
3. [Google 管理コンソール](https://admin.google.com/) で **Security** > **Access and data control** > **API controls** > **Manage Domain Wide Delegation** を開き、 **Add new** をクリックします。サービスアカウントの数値の **Client ID** と、スコープ `https://www.googleapis.com/auth/meetings.space.created` を入力します。
4. サービスアカウントが代理で動作する Google Workspace ユーザーを **Create meetings as** に入力します。incidents@example.com のような専用のアカウントです。すべての会議はこのユーザーが所有します。
:::

**Who can join** は、誰が承認なしで参加できるかを決めます。 **People in your organization join directly, others ask to join** (デフォルト) では、Google Workspace の外部の人は参加をリクエストし、通話の参加者がそれを承認します。 **Anyone with the link joins directly** では誰も待ちません。

ドメイン全体の委任が機能し始めるまでには数分かかることがあります。委任を追加した直後に、Google がサービスアカウントにユーザーとしての動作を許可しなかったとテストで報告された場合は、数分待ってからもう一度テストしてください。

### Microsoft Teams

OneUptime は、ライセンス付きの Teams ユーザーの代理で会議を開催する Microsoft Entra のアプリ登録を通じて、Microsoft Graph でインシデントごとに Microsoft Teams の会議を作成します。

:::steps
1. [Microsoft Entra 管理センター](https://entra.microsoft.com/) で **App registrations** > **New registration** を開き、シングルテナントのアプリを登録します。その **Directory (tenant) ID** と **Application (client) ID** をコピーします。
2. **API permissions** で、Microsoft Graph の **application** のアクセス許可 **OnlineMeetings.ReadWrite.All** を追加し、 **Grant admin consent** をクリックします。
3. **Certificates & secrets** でクライアントシークレットを作成し、Secret ID ではなく **Value** を、接続フォームの **クライアントシークレット** に貼り付けます。
4. 開催者を選びます。ライセンス付きの Teams ユーザーで、サービスアカウントが理想的です。Entra 管理センターの **Users** からその **Object ID** をコピーし、 **Organizer object ID** に入力します。
5. アプリケーションアクセスポリシーで、アプリが開催者の会議を作成できるようにします。Teams PowerShell で `Connect-MicrosoftTeams` の後に、次の 2 つのコマンドを実行します。
:::

```powershell
New-CsApplicationAccessPolicy -Identity OneUptime-Meetings -AppIds "<application-client-id>"
Grant-CsApplicationAccessPolicy -PolicyName OneUptime-Meetings -Identity "<organizer-object-id>"
```

ポリシーが適用されるまでに最大 30 分かかることがあります。それまでは、アプリが開催者の会議を作成することを許可されていないとテストで報告されます。

**Who skips the lobby** は、誰が待たずに参加できるかを決めます。 **People in your organization skip the lobby** (デフォルト) では、ほかの人は会議の参加者が承認するまでロビーで待ちます。 **Everyone skips the lobby** では誰も待ちません。

### 会議リンク

常設の会議リンクは、すべてのインシデントで同じ部屋です。Zoom の個人ミーティングルーム、Microsoft Teams や Google Meet の定期的な会議、Webex の個人用ルーム、Jitsi のルームなどです。インシデントごとに何も作成されないので、承認するものはありません。

:::steps
1. チームがすでに使っているツールで、期限切れにならない会議を作成します。
2. その https の参加リンクを、接続フォームの **会議リンク** に貼り付けます。
:::

この接続で開始されたすべてのインシデントとアラートが部屋を共有するので、同時に起きた 2 つのインシデントも部屋を共有します。ホストなしで参加できる会議にしてください。

### Slack のハドル

Slack のルールでは、代わりにインシデントの Slack チャネルのハドルを開始できます。接続するものはありません。ルールの **ビデオ通話** ステップで **Slack ハドル** を選びます。

ハドルは、ルールがインシデント用に作成するチャネルで行われます。ルールが既存のチャネルに投稿する場合は、その最初のチャネルで行われます。そのため、ルールはチャネルを作成するか、既存のチャネルに投稿する必要があります。 **ハドルに参加** ボタンは、Slack でチャネルのハドルを開きます。最初に開いた対応者がハドルを開始し、その後の人はそれに参加します。Slack にはアプリがハドルを開始する方法がないので、誰かが開くまでハドルには誰もいません。

Slack のハドルは Slack のルール専用です。Microsoft Teams のルールは、プロジェクトのビデオ通話の接続のいずれかで通話を開始します。

## API を使う

通話は、インシデント (`IncidentVideoCall`) またはアラート (`AlertVideoCall`) に付くレコードです。インシデントの `_id` と、次のいずれかを指定して作成します。

- `videoCallConnectionId`: その接続で新しい会議を開始します。
- `SlackHuddle` に設定した `provider`: インシデントの Slack チャネルのハドルです。
- `joinUrl` (必要に応じて `title`): 自分の会議リンクです。

```json
{
  "data": {
    "projectId": "<project-id>",
    "incidentId": "<incident-id>",
    "videoCallConnectionId": "<connection-id>"
  }
}
```

`POST /api/video-call-connection/test` は、保存済みの接続 (`{ "connectionId": "..." }`) または未保存の設定 (`{ "provider": "Zoom", "config": { ... }, "secrets": { ... } }`) でテスト会議を開始し、その `joinUrl` を返します。

接続の `authMethod` は、その接続のサインイン方法を示します。サインインで作成した接続は `OAuth`、自分のアプリの認証情報を使う接続は `AppCredentials`、会議リンクでは何も入りません。サインインで作成する接続は、ダッシュボードでサインインすることでしか作成できません。API では名前の変更と `config` の変更ができ、その `connectedAccount` はどのアカウントとしてサインインしているかを示します。

## セルフホストのサーバーでのワンクリック接続

OneUptime Cloud には、ワンクリック接続用の独自の Zoom、Google、Microsoft のアプリがあります。セルフホストのサーバーでは、アプリを設定したプロバイダーごとにワンクリック接続が使えます。設定していない場合、 **接続** は自分のアプリ用のフォームを開きます。

プロバイダーごとに OAuth アプリを 1 つ作成し、サーバーのホストを使って次のリダイレクト URI を登録します。

| プロバイダー | リダイレクト URI | 環境変数 | Helm の値 |
| --- | --- | --- | --- |
| Zoom | `https://<host>/api/video-call-oauth/zoom/callback` | `ZOOM_APP_CLIENT_ID`, `ZOOM_APP_CLIENT_SECRET`, `ZOOM_APP_WEBHOOK_SECRET_TOKEN` | `zoomApp.clientId`, `zoomApp.clientSecret`, `zoomApp.webhookSecretToken` |
| Google Meet | `https://<host>/api/video-call-oauth/google-meet/callback` | `GOOGLE_MEET_APP_CLIENT_ID`, `GOOGLE_MEET_APP_CLIENT_SECRET` | `googleMeetApp.clientId`, `googleMeetApp.clientSecret` |
| Microsoft Teams | `https://<host>/api/video-call-oauth/microsoft-teams/callback` | `MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_ID`, `MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_SECRET` | `microsoftTeamsMeetingsApp.clientId`, `microsoftTeamsMeetingsApp.clientSecret` |

- **Zoom**: [Zoom App Marketplace](https://marketplace.zoom.us/) で **Develop** > **Build App** を選び、ユーザーが管理する **General App** を作成します。 **Basic Information** で、 **Development** と **Production** の両方のタブと OAuth の許可リストにリダイレクト URI を OAuth Redirect URL として追加し、 **Production** タブで **Deauthorization Notification** のエンドポイント URL を `https://<host>/api/video-call-oauth/zoom/events` に設定します。 **Scopes** で `meeting:write:meeting` と `user:read:user` を追加します。 **Features** > **Access** の **Secret Token** が `ZOOM_APP_WEBHOOK_SECRET_TOKEN` です。 **Development** の認証情報は自分の Zoom アカウントのユーザーにしか使えません。 **Production** の認証情報は、Zoom がアプリを審査して公開すると、誰でも使えるようになります。
- **Google Meet**: [Google Cloud コンソール](https://console.cloud.google.com/) で **Google Meet REST API** を有効にし、OAuth の同意画面 ( **Google Auth Platform** ) をスコープ `openid`、 `email`、 `https://www.googleapis.com/auth/meetings.space.created` で設定し、リダイレクト URI を指定して **Web application** タイプの OAuth クライアントを作成します。アプリは本番環境に公開してください。テストのままのアプリは 7 日後にサインインを失います。Google は Meet のスコープを求めるアプリを審査します。審査が終わるまで、サインインの前に警告が表示されます。
- **Microsoft Teams**: [Microsoft Entra 管理センター](https://entra.microsoft.com/) で **Accounts in any organizational directory** 向けのアプリを登録し、リダイレクト URI を **Web** のリダイレクト URI として追加し、Microsoft Graph の委任されたアクセス許可 `openid`、 `profile`、 `email`、 `offline_access`、 `OnlineMeetings.ReadWrite` を追加して、クライアントシークレットを作成します。Microsoft Teams ボットの登録 (`MICROSOFT_TEAMS_APP_CLIENT_ID`) ではなく、専用の登録を使ってください。アプリに確認済みの発行元がない間は、ほとんどの組織で管理者の同意が必要です。

クライアント ID は公開情報です。どのプロバイダーがワンクリックで接続できるかを知るために、ダッシュボードに送られます。シークレットと Webhook のシークレットトークンは秘密にしてください。ワーカーは毎日すべてのサインインを更新するので、アプリと同じ値が必要です。

## トラブルシューティング

:::details インシデントで通話が開始されなかった
ルールがインシデントに一致したこと ( **ルールをテスト** )、その **ビデオ通話** ステップがオンであること、インシデントが進行中として宣言されたことを確認します。すでに解決済みとして作成されたインシデントには通話は用意されません。その接続でインシデントの通話をすでに開始したルールは、別の通話を開始しません。
:::

:::details フィードに通話を開始できなかったと表示される
プロバイダーが拒否し、フィードにその理由が表示されています。その間はインシデントのページから通話を開始してください。その後、接続の行で **テスト** を実行します。クライアントシークレットの期限切れや権限の不足など、プロバイダー側の設定を直している間、同じ理由が表示されます。
:::

:::details 接続に Not working と表示される
その接続のサインインが機能しなくなりました。アカウントが OneUptime を削除した、アカウントが削除または停止された、または再サインインが必要です。その行の **Reconnect** をクリックします。それまでは、その接続が開始するはずの通話は開始されません。
:::

:::details 参加者がロビーや待機室で待たされる
接続の行の **編集** で **Who can join** (Google Meet) または **Who skips the lobby** (Microsoft Teams) を変更します。Zoom では、アカウントの **Waiting room** の設定がオンでロックされていないことを確認してください。
:::

## 次のステップ

:::cards
- [Slack](/docs/workspace-connections/slack): 通話を開始するルールと、その投稿先のチャネル。
- [Microsoft Teams](/docs/workspace-connections/microsoft-teams): Microsoft Teams での同じルールと通話。
- [Microsoft Teams 統合](/docs/self-hosted/microsoft-teams-integration): セルフホストのサーバーで Teams ボットを設定します。
- [インシデントの宣言](/docs/incidents/declaring-incidents): インシデントが始まったときに起きること。
:::
