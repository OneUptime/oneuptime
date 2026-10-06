# OneUptimeをMicrosoft Teamsに接続する

### OneUptimeをMicrosoft Teamsに接続する手順

1. **OneUptimeでアカウントを作成する**

   - [OneUptime.com](https://oneuptime.com) にアクセスしてアカウントを作成します。
   - アカウントを作成したら、新しいプロジェクトを作成します。

2. **Microsoft TeamsをOneUptimeプロジェクトに接続する**

   - OneUptimeプロジェクト内で **プロジェクト設定** > **Microsoft Teams** に移動します。
   - プロンプトに従って、Microsoft TeamsアカウントとOneUptimeプロジェクトを接続します。

3. **インシデント通知の設定**

   - Microsoft Teamsアカウントを接続した後、**インシデントページ** > **Microsoft Teams** に移動します。
   - Microsoft Teamsにインシデント通知を送信するルールを追加します。たとえば、インシデントが作成されたときにTeamsチャンネルにメッセージを投稿するルールを作成できます。

4. **アラートとスケジュールされたメンテナンスの通知設定**
   - 同様のルールを、それぞれのページに移動してアラートとスケジュールされたメンテナンスにも適用できます。

## ルールをテストする

ルールの行の **ルールをテスト** は、そのルールのテストメッセージをルールが指定するチャネルに投稿し、届くことを確かめられるようにします。イベントごとにチャネルを作るルールなら、テストでもチャネルを 1 つ作り、ルールの対象者を招待します。

**プロジェクト設定** > **Workspace** > **Microsoft Teams** のチャネルの横にある **テストを送信** と同じく、通知ルールを作成する権限が必要です。**Project Owner**、**Project Admin**、**Project Member**、**Settings Admin**、**Settings Member**、またはカスタムロールの **Create Workspace Notification Rule** と **Read Workspace Notification Rule** です。ルールを見ることしかできない人（**Viewer** など）には **ルールをテスト** がロックされ、ツールチップに必要なものが表示されます。API はその人のテストを "You do not have permission to send test notifications in this project." で拒否します。OneUptime Cloud では、ルールのテストにはルールの追加と同じく **Growth** プランが必要です。

## セルフホスト環境のネットワークアクセス

送信接続、受信コールバック、プライベート環境については、[Microsoft Teams統合](/docs/self-hosted/microsoft-teams-integration)のネットワークアクセスのセクションを参照してください。
