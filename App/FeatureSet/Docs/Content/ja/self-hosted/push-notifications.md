# プッシュ通知

ネイティブのプッシュ通知（iOS/Android）は **Expo Push** を使用します。セルフホスト環境では既定で OneUptime のプッシュリレーを使用し、リレーへのアウトバウンドアクセスが必要です。

## 仕組み

OneUptime モバイルアプリは Expo Push Token をバックエンドに登録します。バックエンドは OneUptime リレー経由で通知を送信し、`EXPO_ACCESS_TOKEN` を設定した場合は Expo に直接送信します。Expo が Apple APNs または Google FCM に転送し、デバイスに配信します。

ウェブプッシュ通知はVAPIDキーとウェブプッシュプロトコルを使用し続けます。

## セルフホストのセットアップ

公式モバイルアプリと既定のリレーを使う場合、サーバーに Expo 認証情報は不要です。直接配信する場合は、アプリの Expo プロジェクトに適した認証情報を `EXPO_ACCESS_TOKEN` に設定します。Web Push には `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT` が必要です。

## ネットワークアクセス

| 方向 | 宛先 | プロトコル / ポート | 必要な場合 |
| --- | --- | --- | --- |
| OneUptime → 既定のリレー | `https://oneuptime.com/api/notification/push-relay/send` | HTTPS / TCP 443 | `EXPO_ACCESS_TOKEN` 未設定のモバイルプッシュ。 |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send` | HTTPS / TCP 443 | `EXPO_ACCESS_TOKEN` 設定済みの直接モバイルプッシュ。 |
| OneUptime → ブラウザーのプッシュサービス | プッシュ購読内の HTTPS エンドポイント | HTTPS / 通常 TCP 443 | Web Push。 |
| モバイルアプリまたはブラウザー → OneUptime | OneUptime のホスト名 | HTTPS / TCP 443 | ログイン、デバイス登録、通知リンクを開く操作。 |

`PUSH_NOTIFICATION_RELAY_URL` を変更した場合は、その宛先ホストと設定ポートを許可します。独自リレーは OneUptime のリレー API を実装する必要があります。既定値と配信方式の切り替えは [OneUptime の設定](https://github.com/OneUptime/oneuptime/blob/master/config.example.env)と[プッシュサービス](https://github.com/OneUptime/oneuptime/blob/master/Common/Server/Services/PushNotificationService.ts)、直接接続先は [Expo の送信手順](https://docs.expo.dev/push-notifications/sending-notifications/)を参照してください。

Web Push では使用するブラウザーの実際の購読先ホストを許可します。OneUptime は `fcm.googleapis.com`、`android.googleapis.com`、`push.services.mozilla.com`、`notify.windows.com`、`push.apple.com` とそのサブドメインを受け付けます。例は `updates.push.services.mozilla.com` と `web.push.apple.com` です。[ブラウザーの購読](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription)が宛先を指定するため、Expo やリレーだけの許可では Web Push は動作しません。

通知を送信する OneUptime プロセスからの DNS とアウトバウンド TLS を許可してください。信頼ストアで宛先証明書を検証でき、プロキシが対話的認証なしで API 要求を転送する必要があります。プッシュ提供元が OneUptime の Webhook を呼ぶことはありません。デバイスから VPN などのプライベート接続で到達できれば、サーバーは非公開のまま運用できます。リレーや外部プッシュサービスに接続できないサーバーは配信できません。

デバイス側の接続も必要です。iOS は通常 TCP 5223、フォールバックで TCP 443 を使って APNs に接続します。最新の宛先範囲は [Apple](https://support.apple.com/en-us/102266)を参照してください。Android は TCP 5228–5230 と 443 で FCM に接続します。最新ホストと規則は [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration)を参照してください。これらのデバイスポートを OneUptime のインバウンドで開く必要はありません。サーバーのモバイル配信は APNs/FCM への直接接続ではなく、リレーまたは Expo を使用します。

送信元のコンテナまたは Pod から、選択した配信方式の宛先への DNS と HTTPS を確認します。**User Settings > Notification Methods > Push** からテスト送信し、登録済みデバイスで受信を確認してください。Web Push はブラウザーごとにテストします。OneUptime ログでリレー、Expo、web-push のエラーを確認してください。API での受付成功だけではデバイスへの配信を確認できません。

## トラブルシューティング

### プッシュ通知が届かない場合

- モバイルアプリがEAS Build（Expo Go）でビルドされていることを確認してください（Expo GoはプッシュBENachrichtigungen通知をサポートしていません）
- デバイスがデータベースの `UserPush` テーブルに登録されているか確認してください
- Expo Push APIのエラーについてOneUptimeサーバーログを確認してください
- デバイスがアクティブなインターネット接続を持ち、通知権限が有効になっていることを確認してください

### ログに「DeviceNotRegistered」エラーが表示される場合

Expo Push Tokenが無効になっています。通常、Appがアンインストールされたか、ユーザーが通知権限を取り消したことを意味します。トークンは自動的にクリーンアップされます。

## サポート

プッシュ通知に関する問題は、以下の手順で対応してください：

1. 上記のトラブルシューティングセクションを確認する
2. OneUptimeのログで詳細なエラーメッセージを確認する
3. [hello@oneuptime.com](mailto:hello@oneuptime.com) に連絡する
