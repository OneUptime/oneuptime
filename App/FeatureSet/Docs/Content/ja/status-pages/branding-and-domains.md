# ブランディングとカスタムドメイン

ステータスページは、顧客が実際に目にする唯一の OneUptime の画面です。だからこそ、自分たちのものだと分かる見た目で、自分たちのドメイン上で動いているべきです。この 2 つはどちらも、ステータスページのサイドメニューの **Branding** セクションから設定します。加えて、**Advanced Settings** の奥に隠れている設定が 1 つあります。

始める前に知っておくべきこと。ブランディングは 7 つの別々の画面に分かれていて、その分かれ方はあなたの予想通りとは限りません。ロゴとカバー画像は **Essential Branding** にはなく、**Header** にあります。ファビコンは **Essential Branding** にあります。色は **Overview Page** にあります。それ以外の「テーマ」と呼びたくなるものはすべて Custom CSS です。

このページでは各画面を順番に見ていき、そのあとページを `status.yourcompany.com` に載せるための CNAME からSSLまでの一連の流れを説明します。

## 各ブランディング設定の場所

ステータスページを開くと、サイドメニューの **Branding** セクションには 7 つの項目があります。以下がその全体像です。これでもう探し回らなくて済みます。

| 画面                        | そこで設定する内容                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| **Essential Branding**      | ページタイトル、ページの説明、検索エンジンによるインデックス登録、ファビコン。                |
| **Header**                  | ロゴ、カバー画像、それぞれの代替テキスト、ヘッダーリンクバー。                                |
| **Footer**                  | 著作権表示行、フッターリンクバー。                                                            |
| **Overview Page**           | 概要の説明、履歴チャートのバーの色、ダウンタイムとみなすステータス、全体の稼働率。            |
| **HTML, CSS & JavaScript**  | ヘッダー HTML、フッター HTML、カスタム CSS、カスタム JavaScript。                             |
| **Custom Domains**          | 自分自身のドメイン、CNAME 検証、SSL。                                                        |
| **Languages**                | デフォルト言語と、フッターの切り替えメニューで提供する言語。                                  |

## Essential Branding

**Status Pages → your page → Branding → Essential Branding**（`{id}/branding`）には 3 つのカードがあります。

- **Title and Description** — このカードには、これは SEO にも使われると注記があります。**Edit** を開くと **Page Title**（プレースホルダー `Please enter page title here.`）と **Page Description** が表示されます。これは検索エンジンやリンクプレビューに表示される内容なので、自分のチーム向けではなく顧客向けに書いてください。
- **Search Engine Indexing** — 単一のトグル **Allow Search Engines to Index this Status Page** で、Google や Bing がこのページを検索結果に載せてよいかどうかを制御すると製品内で説明されています。デフォルトでオンです。オフにすると、ページは代わりに `noindex, nofollow` 付きで配信されます。
- **Favicon** — **Edit Favicon** を開くと **Favicon** の画像アップロードが表示されます。これはブラウザタブに表示される小さなアイコンです。

こう使う: ページがまだ社内限定だったり、設定の途中だったりするとき。中途半端なページが自社ブランド名で検索順位に乗り始めないよう、**Allow Search Engines to Index this Status Page** をオフにしてください。

## ヘッダー画面

**Status Pages → your page → Branding → Header**（`{id}/header-style`）。サイドメニューの名前に反して、ここには 2 つの最も重要なブランド資産があります。

最初のカードは **Logo, Cover and Favicon** というタイトルで、**Edit Images** ボタンがあります。

- **Logo** — 画像アップロード、プレースホルダー `Upload logo`。
- **Logo Alt Text** — プレースホルダー `Logo of My Company`。空欄のままにすると、代わりにステータスページのタイトルが使われます。
- **Cover** — 画像アップロード、プレースホルダー `Upload cover image`。ヘッダーの背後にある横長のバナーです。
- **Cover Image Alt Text** — カバー画像についても同様の項目です。

その下には **Header Links** テーブル（「Header Links for your status page」）があります。各リンクには **Title** と **Link**（URL、プレースホルダー `https://link.com`）があり、行はドラッグで並べ替えます。何も設定していない場合、テーブルには「No status header link for this status page.」と表示されます。

こんな用途に向いています: 訪問者を、URLを推測させることなく自社のマーケティングサイトやドキュメント、サポートポータルに戻す。

## フッター画面

**Status Pages → your page → Branding → Footer**（`{id}/footer-style`）は **Header** と同じ構成で、カードが 1 つとテーブルが 1 つです。

- **Copyright Info** — **Edit Copyright** を開くと、単一のフィールド **Copyright Info** が表示され、プレースホルダーは `Acme, Inc.` です。
- **Footer Links** — 同じ **Title** と **Link** のペアで、ドラッグで並べ替え、空のときのメッセージは「No status footer link for this status page.」です。

法務、プライバシー、利用規約へのリンクはここに置きます。ヘッダーリンクはナビゲーション用、フッターリンクは細かい注記用です。

## Overview Page のブランディング

**Status Pages → your page → Branding → Overview Page**（`{id}/overview-page-branding`）は色を設定できる唯一の画面であり、チャート上で「down」が何を意味するかもここで決まります。

- **Overview Page** — **Edit Branding** を開くと、リソース一覧の上に表示される Markdown フィールド **Overview Page Description.** が現れます。このページが何をカバーしているか、サポートへの連絡先はどこかといった、1 文程度の説明に使います。
- **Rules for Bar Colors of History Chart** — 順序があり、ドラッグで並べ替え可能なルールのテーブルです。各ルールには **When uptime % is greater than or equal to** と **Then, use this bar color** があり、テーブルの列名は `When Uptime Percent >=` と `Then, Bar Color is` です。順序が意味を持つので、評価してほしい順に並べてください。
- **Downtime Monitor Statuses** — **Edit Statuses** を開くと、「これらのモニターステータスはダウンとみなされます」と説明されたマルチセレクトが表示されます。たとえば degraded ステータスをこのページの稼働率に対してダウンとしてカウントするかどうかは、これで決まります。
- **Default Bar Color of the History Chart** — **Edit Default Bar Color** を開くと **Default Bar Color** のカラーピッカーが表示されます。どのルールにも一致しないときに使われる色です。
- **Overall Uptime Percent** — **Edit Settings** を開くと **Show Overall Uptime Percent** のトグルと **Select Uptime Precision** ドロップダウンが表示され、デフォルトは小数点以下 2 桁（`99.99% (Two Decimal)`）です。

**チャートが何日分をカバーするかは、ここでは設定しません。** それは **Status Pages → your page → Advanced → Advanced Settings**（`{id}/settings`）の **Show Uptime History (in days)** で、1 から 90 の間で有効です。

## カスタム HTML、CSS、JavaScript

**Status Pages → your page → Branding → HTML, CSS & JavaScript**（`{id}/custom-code`）には、ステータスページの `headerHTML`、`footerHTML`、`customCSS`、`customJavaScript` の各カラムに対応する、独立して編集できる 4 つのカードがあります。

- **Header HTML** — プレースホルダー `Insert Custom HTML here.`、ページヘッダーに挿入されます。
- **Footer HTML** — 同様に、フッターに挿入されます。
- **Custom CSS** — プレースホルダー `Insert Custom CSS here.`
- **Custom JavaScript** — プレースホルダー `Insert Custom JavaScript here.`

**テーマピッカーはありません。** OneUptime のステータスページにはテーマやブランドカラーの設定はなく、どこにあってもよい組み込みの色コントロールは **Overview Page** 画面の **Default Bar Color** と履歴チャートのバーカラールールだけです。フォント、背景色、アクセントカラー、レイアウトの調整はすべて、ここの **Custom CSS** を通して行います。「ブランドカラー」フィールドを探していたなら、これが答えです — そんなものは存在せず、このボックスが逃げ道になります。

> Custom JavaScript は、何かが壊れていないか心配になったまさにそのタイミングで訪問者が読み込んでいるページ上で、彼らのブラウザで実行されます。小さく保ち、可能な限り自前でホストし、頼りにする前にテストしてください。

## 言語設定

**Status Pages → your page → Branding → Languages**（`{id}/languages`）には 2 つのカードがあり、どちらもページフッターに表示される訪問者向けの言語切り替えについてのものです。

- **Default Language** — **Edit Default Language** を開くと、対応する各言語をネイティブ名と英語名（`Deutsch (German)`）で一覧表示するドロップダウンが現れます。カードの説明によれば、これは初めて訪れた訪問者が最初に目にする言語で、訪問者はいつでもフッターから切り替えられます。デフォルトは英語です。
- **Enabled Languages** — **Edit Enabled Languages** を開くとマルチセレクトが表示され、プレースホルダーは `All languages` です。空のままにすると、対応するすべての言語が提供されます。いくつか選ぶと、フッターの切り替えメニューにはそれらだけが表示されます。

OneUptime には 16 の言語が標準で付属しています。英語、ドイツ語、フランス語、スペイン語、イタリア語、ポルトガル語、オランダ語、デンマーク語、ノルウェー語、スウェーデン語、ロシア語、日本語、韓国語、中国語（簡体字）、中国語（繁体字）、ヒンディー語です。

## カスタムドメイン

デフォルトでは、ステータスページは **Overview** 画面に表示されるプレビュー URL でアクセスできます。自分のホスト名にページを載せるには、**Status Pages → your page → Branding → Custom Domains** に移動します。

このカードのタイトルは **Custom Domains** で、その説明には要件が直接書かれています。これを機能させるには、自分の導入環境のステータスページ用 CNAME レコードを、対象ドメインの CNAME として追加する必要があります。何も設定されていない状態では、テーブルには「No custom domains found.」と表示されます。テーブルには **Domain** と **Status** の 2 つの列があり、**Domain**、**CNAME Valid**、**SSL Provisioned** でフィルタできます。

### 始める前に

前提条件が 2 つあり、どちらか一方でも飛ばすとたいてい動かなくなります。

- **親ドメインが事前に検証済みであること。** **Domain** ドロップダウンには、プロジェクト設定で検証済みのドメインしか表示されません。フィールド自体のヘルプテキストが、まず **More → Project Settings → Custom Domains** で 1 つ追加するよう案内しています。
- **導入環境にステータスページ用 CNAME レコードが設定されていること。** セルフホスト環境では、それは Docker Compose の `STATUS_PAGE_CNAME_RECORD` 環境変数、または Helm の `values.yaml` の `statusPage.cnameRecord` です。これが設定されていないと、**Add CNAME** モーダルと **Order Free SSL** モーダルの両方が、手順の代わりに「Custom Domains not enabled for this OneUptime installation」というメッセージを表示します。

### ドメインを追加する

**Create Status Page Domain** をクリックします。モーダル（**Create New Status Page Domain**）には 2 つのステップがあります。

**Basic**

- **Subdomain** — ラベル部分だけです。プレースホルダーは `status (leave blank for root)`。ホスト名全体ではなく `status` だけを入力してください。ルート（apex）ドメインを使う場合は空欄のままにするか `@` を入力します。
- **Domain** — 検証済みドメインのドロップダウン、プレースホルダーは `Select domain`。

**More**

- **Upload Custom Certificate** — トグル、デフォルトはオフです。オフのままにしておくと、OneUptime が無料の証明書を代わりに発行します。オンにすると、自分の PEM データ用に **Certificate** と **Certificate Private Key** のフィールドが表示されます。

## CNAME を検証する

ドメインが未検証の間、行には **Add CNAME** アクションが表示されます。これをクリックすると **Add CNAME** というタイトルのモーダルが開き、DNS プロバイダーに貼り付けるべき内容がそのまま示されます。

- **Record Type** — `CNAME`
- **Name** — たった今作成したドメイン全体、たとえば `status.yourcompany.com`
- **Content** — 自分の導入環境のステータスページ用 CNAME レコード

このモーダルには、レコードを設定すれば自動検証が最大 24 時間かかる場合があると注記があります。そこまで待つ必要はありません。モーダルの送信ボタンは **Verify CNAME** で、これを押すとその場でレコードを確認します。

先に DNS レコードを作成してから **Verify CNAME** をクリックしてください。レコードが存在する前にクリックしても、単に失敗するだけです。

## SSL 証明書を注文する

CNAME が検証済みになり、かつ自分で証明書をアップロードしていない場合に限り、その行に **Order Free SSL** アクションが表示されます。そのモーダル **Order Free SSL Certificate for this Status Page** には、OneUptime が LetsEncrypt を使っていること、このプロセスが安全かつ無料であること、注文後の発行には数時間かかることが説明されています。送信ボタンは **Order Free SSL** です。

**画面ごとに表示される所要時間が食い違っている**ので、個々の数字を鵜呑みにしすぎないでください。注文モーダルは 3 時間、**Status** 列は 1 時間、カスタム証明書の場合は 30 分と書かれています。どれも「今日中にまた確認しに来る」くらいに捉え、それまでに何も起きなければサポートに連絡してください。

発行が完了すれば、更新は自動です。あなたが定期的に何かをする必要はありません。

## Status 列の読み方

**Status** 列には、セットアップの状態遷移がまるごと 1 つのセルに詰め込まれています。それぞれのメッセージは、次に何をすべきか、あるいはもう完了しているかのどちらかを教えてくれます。

| Status 列に表示される内容                              | 意味                                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.          | CNAME がまだ検証されていません。レコードを追加し、**Verify CNAME** を実行してください。 |
| Action Required: Please order SSL certificate.           | CNAME は検証済みですが、証明書が注文されていません。**Order Free SSL** をクリックしてください。 |
| No action is required, allow 30 minutes to provision.    | カスタム証明書をアップロード済みで、インストール中です。                            |
| No action is required, this will be provisioned soon.    | 無料証明書が注文され、発行手続き中です。いつまでも反映されない場合はサポートに連絡してください。 |
| Certificate Provisioned. No action required.             | 完了です。OneUptime が証明書を自動的に更新します。                                   |

DNS エントリを作成してからかなり経っても行が「Action Required: Please add your CNAME record.」のままなら、レコードの名前がドメイン全体になっているか、内容が自分の導入環境の CNAME レコードと正確に一致しているかを確認してください。

## Powered by OneUptime

「Powered by OneUptime」の表示は、Branding セクションの設定ではありません。これは **Status Pages → your page → Advanced → Advanced Settings**（`{id}/settings`）の **Powered By OneUptime Branding** カードにあり、単一のトグル **Hide Powered By OneUptime Branding** です。そのページの他のカードと同様、**Edit Settings** で開きます。

## 次に読むべきページ

- [ステータス ページ 概要](/docs/status-pages/index) — ステータスページとは何か、各パーツがどう組み合わさっているか。
- [ステータス ページのリソースとグループ](/docs/status-pages/resources-and-groups) — 訪問者に実際に見せる内容を選ぶ。
- [購読者とお知らせ](/docs/status-pages/subscribers) — メール、SMS、Slack、Webhook の購読者、そしてお知らせ。
- [公開 API](/docs/status-pages/public-api) — ステータスページのデータをプログラムから読み取る。
- [インシデントの状態と重大度](/docs/incidents/states-and-severities) — 何がインシデントをページに表示させ、消すのか。
