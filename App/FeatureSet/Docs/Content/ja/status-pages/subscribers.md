# 購読者とお知らせ

ステータスページは人が訪れる場所です。購読者は、できればそこを訪れなくて済ませたい人たちです — メールアドレス、電話番号、Slack の Webhook、あるいは HTTP エンドポイントを一度だけあなたに渡しておけば、あとは更新情報が向こうから届きます。

お知らせはその同じ仕事のもう半分です。チェックアウトが 500 エラーを返していることはモニターが訪問者に伝えられますが、土曜日にデータベースを移行中であること、サードパーティのプロバイダーが不調であること、昨日読んだあのインシデントが完全にクローズしたことは、どのモニターも伝えてくれません。お知らせは、あなたのチェックでは見えないすべてのことのための自由記述チャネルであり、同じ購読者リストに配信されます。

このページでは両方を扱います。5 つの購読チャネルと訪問者の登録方法、購読者が受け取る内容を選べる仕組み、ダブルオプトインと購読解除のフロー、そしてお知らせの書き方・スケジュール設定・テンプレート化です。

## 購読チャネル

ステータスページは 5 つのチャネルに対応しており、それぞれステータスページ上に独自のトグルがあります。**Status Pages → your page → Subscribers → Subscriber Settings** を開いてください。

- **Enable Email Subscribers**（`enableEmailSubscribers`）— デフォルトでオン。オンにするまで、それ以外はすべてオフです。
- **Enable SMS Subscribers**（`enableSmsSubscribers`）— デフォルトでオフ。
- **Enable Slack Subscribers**（`enableSlackSubscribers`）— デフォルトでオフ。
- **Enable Microsoft Teams Subscribers**（`enableMicrosoftTeamsSubscribers`）— デフォルトでオフ。
- **Enable Webhook Subscribers**（`enableWebhookSubscribers`）— デフォルトでオフ。

各チャネルには、ステータスページのサイドメニューの **Subscribers** 配下にそれぞれ専用の一覧もあります。**メール購読者**、**SMS 購読者**、**Slack 購読者**、**MS Teams 購読者**、**Webhook購読者**です。ここで誰が登録しているかを確認したり、手動で追加したり、特定の購読者に対して自分用の **Notes**（`internalNote`）を残したりできます。

**トグル 1 つでは足りません。** ステータスページのナビバーの **Subscribe** 項目は、**Show Subscriber Page**（`showSubscriberPageOnStatusPage`）がオンで、*かつ*少なくとも 1 つのチャネルが有効になっている場合にのみ表示されます。**Enable Email Subscribers** をオンにしても **Show Subscriber Page** をオフのままにしていると、訪問者はフォームにたどり着く方法がありません。

同じ 5 つのトグルは、**Advanced Settings** の **Subscriber Settings** カード内にも **Show Subscriber Page** と並んでもう一度表示されます。裏側では同じカラムなので、どちらか一方の画面を選んで使い続けてください。購読者に関する他の設定もすべてそこにあるため、専用の **Subscriber Settings** ページを使うことをおすすめします。

## 訪問者が Subscribe ページで目にするもの

**Subscribe** ページには、有効になっているチャネルごとに 1 つのタブを持つサブメニューがあります — **Email**、**SMS**、**Slack**、**MS Teams**、**Webhooks** で、それぞれ `/subscribe/email`、`/subscribe/sms`、`/subscribe/slack`、`/subscribe/microsoft-teams`、`/subscribe/webhooks` に対応します。各タブは必要最小限のものだけを尋ねます。

- **Email** — 見出しは **Subscribe by Email**、フィールドは **Your Email** 1 つで、プレースホルダーは `subscriber@company.com`。
- **SMS** — 見出しは **Subscribe by SMS**、フィールドは **Your Phone Number** 1 つで、プレースホルダーは `+11234567890`。
- **Slack** — 見出しは **Subscribe by Slack**、**Slack Workspace Name**（検証に使用）と **Slack Incoming Webhook URL**（プレースホルダー `https://hooks.slack.com/services/...`）があります。
- **MS Teams** — 見出しは **Subscribe by Microsoft Teams**、**Microsoft Teams Workspace Name** と **Microsoft Teams Incoming Webhook URL**（プレースホルダー `https://outlook.office.com/webhook/...`）があります。
- **Webhooks** — 見出しは **Subscribe by Webhook**、フィールドは **Webhook URL** 1 つ。ステータスページのイベントごとに JSON の `POST` リクエストが送信されます。

送信ボタンには **Subscribe** と表示され、登録に成功すると *You have been subscribed successfully.* と表示されます。このページには **New Subscription** と **Manage Existing Subscription** の切り替えもあり、すでに購読済みの人が古いメールを探し回らずに自分の設定へ戻れるようになっています。

## 購読者にリソースとイベントタイプを選ばせる

デフォルトでは、購読者はページ上のすべてを受け取ります。**Advanced Subscriber Settings** カード内の 2 つのトグルでこれを変更できます。

- **Allow Subscribers to Choose Resources**（`allowSubscribersToChooseResources`）— デフォルトでオフ。オンにすると、購読フォームに **Subscribe to All Resources** トグルが追加されます。これをオフにすると **Select Resources to Subscribe** が表示され、訪問者が個々のリソースを選べるようになります。
- **Allow Subscribers to Choose Event Types**（`allowSubscribersToChooseEventTypes`）— デフォルトでオフ。同じ構造で、**Subscribe to All Event Types** トグルがあり、オフにするとその下に **Select Event Types to Subscribe** が現れます。

イベントタイプは `Incident`、`Announcement`、`Scheduled Event` です。

これらの選択は、購読者レコード上の **Is Subscribed to All Resources**（`isSubscribedToAllResources`、デフォルト true）、**Is Subscribed to All Event Types**（`isSubscribedToAllEventTypes`、デフォルト true）、**Subscribed to Resources**、**Subscribed to Event Types** として保存されます。

こんな用途に向いています: 複数のプロダクトをカバーするページ。API しか使っていない顧客は、マーケティングサイトが少し不安定になるたびに通知を受け取りたくはありません。完全に購読解除されてしまうのを眺めるより、自分でリストを絞り込ませてあげましょう。

同じカードには **Subscriber Timezones** もあります。

## メールのダブルオプトイン

メール購読者は必ず確認を行います。購読者がメールアドレスで作成され、かつ最初から確認済みとして作成されたのでない場合、**Is Subscription Confirmed**（`isSubscriptionConfirmed`）は強制的に `false` になり、6 桁の **Subscription Confirmation Token** が生成されます。その後 OneUptime は、`{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}` という形の確認リンクをメールで送信します。訪問者は **Confirm Subscription** ページに着地し、確認が完了すると *Subscription confirmed successfully* と表示されます。

SMS、Slack、Microsoft Teams、Webhook の購読者はこれをスキップします — これらは最初から `isSubscriptionConfirmed` が `true` に設定された状態で作成されます。

**未確認は無音を意味します。** 通知対象の購読者を取得するクエリは `isUnsubscribed: false` と `isSubscriptionConfirmed: true` でフィルタします。確認リンクを一度もクリックしていないメールアドレスは、**Email Subscribers** の一覧には表示されますが、何も受け取りません。誰かが「確かに購読しているのに何も届かない」と言ったら、まずこの列を確認してください。

メール確認をオフにするトグルは存在しません。ステータスページから登録した人全員に対して無条件です。別の購読者ごとのカラムである **Send You Have Subscribed Message**（`sendYouHaveSubscribedMessage`、デフォルト true）は、購読者が確認済みになった時点で送信される「購読しました」メールを制御します。

## 購読の管理と解除

すべての購読者メールには `{statusPageUrl}/update-subscription/{statusPageSubscriberId}` という形の購読解除リンクが含まれています。このページのタイトルは **Update Subscription** で、訪問者はここで設定を更新するか購読を解除できると案内されます。ここには次のものがあります。

- ページが許可している範囲のリソースとイベントタイプの選択項目。
- **Unsubscribe** トグル。すべてのリソースの購読を解除するものと説明されています。**Is Unsubscribed**（`isUnsubscribed`、デフォルト false）に書き込まれます。
- **Update Subscription** と表示される送信ボタン。保存すると *Your changes have been saved.* と表示されます。

リンクを紛失した人は、**Subscribe** ページの **Manage Existing Subscription** を使い、**Send Management Link** を押します。OneUptime は、リンクを含むメールを送信したこと、届かない場合は迷惑メールフォルダを確認するよう案内する応答を返します。

これらすべての裏にあるエンドポイントは `POST .../subscribe/:statusPageId`、`POST .../manage-subscription/:statusPageId`、`POST .../get-subscription/:statusPageId/:subscriberId`、`PUT .../update-subscription/:statusPageId/:subscriberId` です。

購読解除は行を削除するのではなくフラグを立てるだけなので、レコードは **Is Unsubscribed** が設定された状態でそのままチャネルの一覧に残ります。特定のアドレスがなぜメールを受け取らなくなったのかを後から説明する必要があるときに役立ちます。

## 購読者が通知される内容

購読者は上記の 3 つのイベントタイプについて通知を受けますが、それぞれの発信元には独自のスイッチがあるため、意図せず送信されることはありません。

### お知らせの通知

お知らせ自体には **Should subscribers be notified?**（`shouldStatusPageSubscribersBeNotified`）があり、作成フォーム上では **Notify Status Page Subscribers** チェックボックスとして表示され、デフォルトでオンです。お知らせが **Monitors affected (Optional)** の下でモニターを指定している場合、通知はそれらのモニターに限定されます。空のままにすると、全購読者に通知されます。

### 予定されたメンテナンスイベント

予定されたメンテナンスイベントには、それ専用の購読者向けカラム群があります。**Should subscribers be notified when event is created?**、**Should subscribers be notified when event is changed to ongoing?**、**Should subscribers be notified when event is changed to ended?**、そして事前通知のための **Subscriber notifications before the event** と **Next subscriber notification before the event at?** です。イベント上の **Status Pages** はどのページに表示するかを決め、**Should be visible on status page?** はそもそも表示するかどうかを決めます。

### インシデント

`Incident` は 3 つ目のイベントタイプです。何が最初にインシデントをステータスページに到達させるのか — どのリソースに関わり、どの状態のときに表示され続けるのか — については、[インシデントの状態と重大度](/docs/incidents/states-and-severities) で扱っています。

ステータスページのサイドメニューにある **Notification Logs** セクション（`{id}/notification-logs`）は、ページが実際に何を送信したかを確認したいときに見る場所です。

## 通知テンプレートをカスタマイズする

**Subscriber Settings** の **Notification Templates** カードには、このステータスページが使用するテンプレートが一覧表示され、**Template Name**、**Event Type**、**Notification Method** の列があります。これにより、すべてに 1 つの定型文を受け入れるのではなく、イベントタイプごと、チャネルごとに文面を変えられます。

プロジェクト全体のテンプレートは 1 階層上の **Status Pages → Settings → Subscriber Templates** にあり、**Announcement Templates** の隣にあります。

## メールフッター、カスタム SMTP、Twilio

**Subscriber Settings** にはさらに 3 つのカードがあり、購読者向けメッセージがプロジェクトからどう出ていくかを制御します。

- **Email Footer Settings** — **Enable Custom Email Footer Text** と **Subscriber Email Notification Footer Text** で、購読者向けメールに自分のフッターを付けられます。
- **Custom SMTP** — **Custom SMTP Config** により、デフォルトの代わりに自分のメールサーバー経由で購読者向けメールを送信します。
- **Twilio Config** — **Twilio Config** は、SMS 購読者に使われる Twilio アカウントです。

メール購読者がいるなら、カスタム SMTP は早めにやっておく価値があります。自分自身のドメインから届くメールは、フィルタされにくく、午前 2 時にそれを読んでいる顧客にも信頼されやすくなります。

## お知らせ

お知らせはプロジェクトレベルのレコード（`StatusPageAnnouncement` モデル）で、1 つ以上のステータスページに配信し、任意で特定のモニターに絞り込み、表示される期間を持たせることができます。

作成は **Status Pages → More → Announcements** から、または個々のステータスページのサイドメニューの **Announcements** から行います。作成フォームは 4 ステップのウィザードです。

1. **Basic Information** — **Announcement Title**（必須、2 文字以上）、**Description**（Markdown、任意）、そしてお知らせと一緒にステータスページで公開したいファイル用の **Attachments**。
2. **Status Pages** — **Show announcement on these status pages**、必須のマルチセレクト。1 つのお知らせを一度に複数のページに向けて発信できます。
3. **Resources Affected** — **Monitors affected (Optional)**。何も選択しない場合、全購読者に通知されます。
4. **Schedule & Settings** — **Start Showing Announcement At**（必須、デフォルトは現在時刻）、**End Showing Announcement At**（任意）、**Notify Status Page Subscribers**（デフォルトでオン）。

訪問者は `/announcements` でお知らせを読み、**Active Announcements** と **Past Announcements** に分かれ、それぞれ **Announced at** のスタンプが付きます。現在配信中のお知らせは概要ページの上部にも固定表示されます。表示するものが何もない場合、ページには *No Announcement* と、これまで投稿されたものがない旨の注記が表示されます。

添付ファイルは `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId` から配信され、ステータスページ自体と同じ読み取りチェックの対象になります。そのため、非公開ページの添付ファイルは非公開のままです。

## お知らせのスケジュールの仕組み

**Show At**（`showAnnouncementAt`）と **End At**（`endAnnouncementAt`）がすべてを動かしていますが、概要ページとお知らせ一覧では問いかけている内容が異なり、この違いが混乱の元になります。

- **概要ページ** は、`showAnnouncementAt` が過去であり、かつ `endAnnouncementAt` が未来か空である場合にお知らせを表示します。
- **`/announcements` の一覧** は、`showAnnouncementAt` が **Show Announcement History (in days)**（`showAnnouncementHistoryInDays`、デフォルト 14）の範囲内に収まるお知らせを表示し、そのあとクライアント側で active と past に振り分けます。

計画しておく価値のある結果が 2 つあります。

- **終了日のないお知らせは決して期限切れになりません。** **End Showing Announcement At** を空欄のままにすると、そのお知らせは無期限に概要ページに固定され続けます。期間限定のものには必ず終了日を設定してください。
- **古くてもまだアクティブなお知らせが一覧から消えることがあります。** `showAnnouncementHistoryInDays` より前に開始したお知らせは、概要ページには残ったまま `/announcements` からは外れます。長期間続くお知らせを扱うなら、履歴の日数を増やしてください。

お知らせがそもそも表示されるかどうかは、**Advanced Settings** の **Announcement Settings** カードで制御されます。**Show Announcements**（`showAnnouncementsOnStatusPage`、デフォルト true）と **Show Announcement History (in days)**（デフォルト 14）です。**Show Announcements** がオフの場合、お知らせ用のエンドポイントはリクエストそのものを拒否します。

## お知らせテンプレート

同じ種類の通知を繰り返し投稿するなら — 毎月のメンテナンス予告や、繰り返し起きるサードパーティの性能低下など — あらかじめテンプレート化しておきましょう。**Status Pages → Settings → Announcement Templates** は `StatusPageAnnouncementTemplate` モデルを保存し、そのフォームでは **Template Name**、**Template Description**、**Announcement Title**、**Description**、**Show announcement on these status pages**、**Monitors affected (Optional)**、**Notify Subscribers** を尋ねます。これにより、配信先の選択と通知するかどうかの判断を、毎回ではなく一度で済ませられます。

## Webhook 購読者と SSRF 対策

Webhook 購読者は、ステータスページのイベントごとに JSON の `POST` リクエストを受け取ります。そのため、チャットボットや社内ダッシュボード、チケット管理キューなど、自分自身のシステムにステータスページの更新を流し込む最も簡単な方法になります。

購読は公開ページ上の公開操作であるため、OneUptime は宛先を保護します。

- 汎用の **Webhook URL** は受け付けられる前に検証され、プライベートアドレス、ループバックアドレス、リンクローカルアドレス、クラウドメタデータアドレスは拒否されます。OneUptime の導入環境自身のネットワーク内にある何かを購読先に指定することはできません。
- **Slack Incoming Webhook URL** は `https://hooks.slack.com/services/` で始まっている必要があります。

Webhook の購読登録が拒否された場合、まず疑うべきは内部向けの URL や不正な形式の URL です。

## 次に読むべきページ

- [ステータス ページ 概要](/docs/status-pages/index) — ステータスページとは何か、どう組み立てられているか。
- [ステータス ページのリソースとグループ](/docs/status-pages/resources-and-groups) — 購読者が選択できるモニターとグループ。
- [ステータス ページのブランディングとドメイン](/docs/status-pages/branding-and-domains) — カスタムドメイン、ロゴ、そしてメールがリンクするページの見た目。
- [公開 API](/docs/status-pages/public-api) — ステータスページのデータをプログラムから読み取る。
- [インシデントの状態と重大度](/docs/incidents/states-and-severities) — 何がインシデントをステータスページに載せ、何がそれを取り除くのか。
- [インシデントの設定と自動化](/docs/incidents/settings) — インシデントのコミュニケーションを支えるプロジェクトレベルのルール。
