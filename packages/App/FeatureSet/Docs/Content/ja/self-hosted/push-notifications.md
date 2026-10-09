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
| OneUptime → 既定のリレー | `https://oneuptime.com/api/notification/push-relay/send`, `https://oneuptime.com/api/notification/push-relay/receipts` | HTTPS / TCP 443 | `EXPO_ACCESS_TOKEN` 未設定のモバイルプッシュ。 |
| OneUptime → Expo | `https://exp.host/--/api/v2/push/send`, `https://exp.host/--/api/v2/push/getReceipts` | HTTPS / TCP 443 | `EXPO_ACCESS_TOKEN` 設定済みの直接モバイルプッシュ。 |
| OneUptime → ブラウザーのプッシュサービス | プッシュ購読内の HTTPS エンドポイント | HTTPS / 通常 TCP 443 | Web Push。 |
| モバイルアプリまたはブラウザー → OneUptime | OneUptime のホスト名 | HTTPS / TCP 443 | ログイン、デバイス登録、通知リンクを開く操作。 |

`PUSH_NOTIFICATION_RELAY_URL` を変更した場合は、その宛先ホストと設定ポートを許可します。独自リレーは OneUptime のリレー API を実装する必要があります。既定値と配信方式の切り替えは [OneUptime の設定](https://github.com/OneUptime/oneuptime/blob/master/config.example.env)と[プッシュサービス](https://github.com/OneUptime/oneuptime/blob/master/packages/Common/Server/Services/PushNotificationService.ts)、直接接続先は [Expo の送信手順](https://docs.expo.dev/push-notifications/sending-notifications/)を参照してください。OneUptime は、`/send` を `/receipts` に置き換えた同じアドレスでリレーから配信レシートを読み取ります。このルートがないリレーでもプッシュは配信されますが、その場合、アプリが削除されたデバイスは、そのデバイスへの後続のプッシュが拒否されたときに初めて検出されます。

Web Push では使用するブラウザーの実際の購読先ホストを許可します。OneUptime は `fcm.googleapis.com`、`android.googleapis.com`、`push.services.mozilla.com`、`notify.windows.com`、`push.apple.com` とそのサブドメインを受け付けます。例は `updates.push.services.mozilla.com` と `web.push.apple.com` です。[ブラウザーの購読](https://developer.mozilla.org/en-US/docs/Web/API/PushSubscription)が宛先を指定するため、Expo やリレーだけの許可では Web Push は動作しません。

通知を送信する OneUptime プロセスからの DNS とアウトバウンド TLS を許可してください。信頼ストアで宛先証明書を検証でき、プロキシが対話的認証なしで API 要求を転送する必要があります。プッシュ提供元が OneUptime の Webhook を呼ぶことはありません。デバイスから VPN などのプライベート接続で到達できれば、サーバーは非公開のまま運用できます。リレーや外部プッシュサービスに接続できないサーバーは配信できません。

デバイス側の接続も必要です。iOS は通常 TCP 5223、フォールバックで TCP 443 を使って APNs に接続します。最新の宛先範囲は [Apple](https://support.apple.com/en-us/102266)を参照してください。Android は TCP 5228–5230 と 443 で FCM に接続します。最新ホストと規則は [Google](https://firebase.google.com/docs/cloud-messaging/network-configuration)を参照してください。これらのデバイスポートを OneUptime のインバウンドで開く必要はありません。サーバーのモバイル配信は APNs/FCM への直接接続ではなく、リレーまたは Expo を使用します。

送信元のコンテナまたは Pod から、選択した配信方式の宛先への DNS と HTTPS を確認します。**User Settings > Notification Methods > Push** からテスト送信し、登録済みデバイスで受信を確認してください。Web Push はブラウザーごとにテストします。OneUptime ログでリレー、Expo、web-push のエラーを確認してください。API での受付成功だけではデバイスへの配信を確認できません。モバイルプッシュについては、OneUptime は各プッシュの約 15 分後に Expo の配信レシートも読み取ります。デバイスに届かなかったプッシュは、プッシュログと、オンコール通知の場合はオンコールのタイムラインに、未配信として表示されます。

## トラブルシューティング

### プッシュ通知が届かない場合

- モバイルアプリがEAS Build（Expo Go）でビルドされていることを確認してください（Expo GoはプッシュBENachrichtigungen通知をサポートしていません）
- デバイスがデータベースの `UserPush` テーブルに登録されているか確認してください
- Expo Push APIのエラーについてOneUptimeサーバーログを確認してください
- デバイスがアクティブなインターネット接続を持ち、通知権限が有効になっていることを確認してください
- **User Settings > Notification Methods > Push** を確認してください。**通知を受信していません** と表示されているデバイスは通知を受信しなくなっており、もう一度登録する必要があります(下記を参照)

### 「未配信」と表示されたプッシュ

Expo がプッシュを受け付けても、デバイスに届いたとは限りません。Apple や Google が拒否することもあります。OneUptime は各モバイルプッシュの配信レシートを送信の約 15 分後に読み取ります。`EXPO_ACCESS_TOKEN` が設定されていない場合はプッシュリレー経由で読み取ります。レシートがエラーを報告すると、その通知のプッシュログとオンコールのタイムラインは送信済みから **Push notification not delivered** に変わり、Expo のエラーコードが表示されます。

- `DeviceNotRegistered`: モバイルアプリがデバイスから削除されたか、プッシュトークンが無効になっています。次のセクションを参照してください。
- `MessageRateExceeded`: 短時間にデバイスへ送信された通知が多すぎます。そのデバイスへの以降のプッシュは通常どおり送信されます。
- `MessageTooBig`: 通知がプッシュサービスの受け付けるサイズを超えていました。OneUptime は通知を収まるように短縮するため、通常は発生しません。発生した場合はご報告ください。
- `InvalidCredentials` または `MismatchSenderId`: プッシュを送信した Expo プロジェクトのプッシュ認証情報が無効です。`EXPO_ACCESS_TOKEN` を使用している場合は Expo プロジェクトのプッシュ認証情報を確認し、デフォルトのリレーを使用している場合は OneUptime サポートにお問い合わせください。

Expo がプッシュをその場で拒否した場合、プッシュログにはその理由がすぐに表示されます。プッシュリレー経由でも同様です。リレーはサーバーエラーを返す代わりに Expo のエラーコードを伝えます。

### ログに「DeviceNotRegistered」エラーが表示される場合

モバイルアプリがデバイスから削除されたか、デバイスのプッシュトークンが無効になった場合、Expo は `DeviceNotRegistered` を報告します。通常は、OneUptime が送信の約 15 分後に読み取るプッシュの配信レシートで報告され、プッシュがその場で拒否されることもあります。いずれの場合も、OneUptime はそのデバイスへの送信を停止します。デバイスは削除されず、通知を受信していないものとしてマークされるため、通知ルールはそのまま残ります。理由は、届かなかった通知のプッシュログとオンコールのタイムラインに表示されます。**User Settings > Notification Methods > Push** では **通知を受信していません** と表示されます。所有者のほかのデバイスや通知方法には引き続き通知されます。

デバイスを復旧するには、サインインした状態でそのデバイスのモバイルアプリを開いてください。アプリがもう一度登録され、Expo でプッシュトークンが更新されて、デバイスはルールを保ったまま再び通知を受信します。アプリを削除した場合は、もう一度インストールしてサインインしてください。アプリが再登録される前に送信されたプッシュのレシートでは、デバイスはマークされません。最新のモバイルアプリを古いスマートフォンのバックアップから新しいスマートフォンにセットアップすると、アプリは以前のプッシュトークンを OneUptime に伝え、古いスマートフォンのデバイスはルールを保ったまま新しいスマートフォンに引き継がれます。

プッシュリレー経由(`EXPO_ACCESS_TOKEN` なし)でも同じように動作します。リレーはプッシュの送信時に `DeviceNotRegistered` を伝え、インスタンスから問い合わせのあった配信レシートを読み取ります。

## サポート

プッシュ通知に関する問題は、以下の手順で対応してください：

1. 上記のトラブルシューティングセクションを確認する
2. OneUptimeのログで詳細なエラーメッセージを確認する
3. [hello@oneuptime.com](mailto:hello@oneuptime.com) に連絡する
