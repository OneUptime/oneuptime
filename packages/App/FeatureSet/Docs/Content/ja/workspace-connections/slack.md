# OneUptimeをSlackに接続する

### OneUptimeをSlackに接続する手順

1. **OneUptimeでアカウントを作成する**

   - [OneUptime.com](https://oneuptime.com) にアクセスしてアカウントを作成します。
   - アカウントを作成したら、新しいプロジェクトを作成します。

2. **SlackをOneUptimeプロジェクトに接続する**

   - OneUptimeプロジェクト内で **プロジェクト設定** > **Slack** に移動します。
   - プロンプトに従って、SlackアカウントとOneUptimeプロジェクトを接続します。

3. **インシデント通知の設定**

   - Slackアカウントを接続した後、**インシデントページ** > **Slack** に移動します。
   - Slackにインシデント通知を送信するルールを追加します。たとえば、インシデントが作成されたときに新しいSlackチャンネルを作成してインシデント担当者を招待するルールを作成できます。

4. **アラートとスケジュールされたメンテナンスの通知設定**
   - 同様のルールを、それぞれのページに移動してアラートとスケジュールされたメンテナンスにも適用できます。

## ルールをテストする

ルールの行の **ルールをテスト** は、そのルールのテストメッセージをルールが指定するチャネルに投稿し、届くことを確かめられるようにします。イベントごとにチャネルを作るルールなら、テストでもチャネルを 1 つ作り、ルールの対象者を招待します。

**プロジェクト設定** > **Workspace** > **Slack** のチャネルの横にある **テストを送信** と同じく、通知ルールを作成する権限が必要です。**Project Owner**、**Project Admin**、**Project Member**、**Settings Admin**、**Settings Member**、またはカスタムロールの **Create Workspace Notification Rule** と **Read Workspace Notification Rule** です。ルールを見ることしかできない人（**Viewer** など）には **ルールをテスト** がロックされ、ツールチップに必要なものが表示されます。API はその人のテストを "You do not have permission to send test notifications in this project." で拒否します。OneUptime Cloud では、ルールのテストにはルールの追加と同じく **Growth** プランが必要です。

## セルフホスト環境のネットワークアクセス

送信接続、受信コールバック、プライベート環境については、[Slack統合](/docs/self-hosted/slack-integration)のネットワークアクセスのセクションを参照してください。
