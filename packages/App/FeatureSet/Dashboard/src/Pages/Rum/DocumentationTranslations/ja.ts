import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in Japanese (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * Japanese. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "コードを変更して再デプロイでき、依存関係を npm でインストールしているウェブアプリ",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "サイトの配信元オリジン (例: `https://app.example.com`) — ブラウザーキーは、キーに登録したオリジンからのリクエストだけを受け付けます",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "次に、それをアプリの **最初の** import にして、ほかのものが動く前にインストルメンテーションが `fetch` にパッチを当てるようにします:",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "`storefront-web` をアプリケーションの名前に置き換えてください。この名前で OneUptime にアプリが表示されるので、変えないでください: 新しい名前は新しいアプリケーションとして登録されます。",
  "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.":
    "> **`service.name` を設定するだけでは不十分です。** OpenTelemetry のブラウザー SDK は、ブラウザーのリソース検出器を有効にするか自分で設定しない限り `browser.*` 属性を追加しません — それがないと、RUM アプリケーションではなくバックエンドのサービスになります。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "ステップ 1 で取り込みキーを選ぶと、`<YOUR_API_KEY>` が埋められます。",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "既存の `connect-src` ディレクティブにマージしてください。サイトに Content Security Policy がありませんか？ それならこのステップは飛ばしてください。",
  '`200` with `"valid": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.':
    '`200` と `"valid": true` は OneUptime がキーを受け付けることを意味します — ブラウザーキーの場合、メッセージには、ブラウザーから、許可されたオリジンのいずれかからしか動かないことが付け加えられます。`401` はキーが不明、取り消し済み、無効、または期限切れであることを意味します。',
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "次に、サイトのページを読み込みます。1 分以内に、アプリケーションが `service.name` の名前で **リアルユーザーモニタリング** の下に表示され、ページビュー、エラー率、p95 の所要時間が表示されます。",
  "OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "OneUptime は、リソースがクライアント属性 — ウェブなら `browser.platform`、`browser.language`、空でない `browser.brands` のいずれか — を持つとき、テレメトリを **RUM** に分類します。アプリケーションは `service.name` で識別され (大文字と小文字は区別しません)、そのテレメトリはこの RUM アプリケーションのものになります — バックエンドのサービスとして重複して記録されることはありません。",
  "| Attribute | Required | What it does |": "| 属性 | 必須 | 役割 |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **はい** | アプリケーションの ID。例: `storefront-web`。後から名前を変えると新しいアプリケーションが作られます。 |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **いずれか 1 つ** | テレメトリをブラウザーの RUM としてマークします。`browser.platform` は **クライアント** タブにも表示されます。 |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | いいえ | 概要に表示されます |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector` はブラウザーからそれらを設定します。Chromium 系ブラウザーにしかない UA Client Hints API を読むため、Safari と Firefox では `browser.language` は設定しますが `browser.platform` は設定しません。属性を自分で設定するには — 検出器を使わない場合や、すべてのブラウザーにプラットフォームを持たせたい場合 — 次のようにリソースを作成します:",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "`browser.platform` は大まかな値にしてください: 異なる値ごとに **クライアント** タブの行が増えます。",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "ブラウザーのスニペットに含まれるものはすべてユーザーに配信されます。その中のトークンは公開されたものです — ソースを見たり、devtools を開いたり、バンドルを読んだりすれば誰でもコピーできます。だからこのガイドは **ブラウザー** の取り込みキーだけを一覧・作成し、それぞれにサイトの配信元オリジンを設定します:",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- それらのオリジンからしか受け付けられないため、コピーされたキーは他人のページでは動きません。",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- 書き込めるのはトレース、ログ、メトリクス、セッションリプレイ、Sentry ブラウザー SDK のレポートだけで、プロファイル、source map、syslog、Fluent、Pyroscope、セキュリティイベントは書き込めません。",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- キーごとにレート制限があり、1 回の編集で無効にでき、有効期限も設定できます。",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "オリジンにはスキームと (あれば) ポートが含まれ、先頭にホストのワイルドカード `*.` を 1 つ付けられます — `https://app.example.com`、`https://*.example.com`。キーに **固定されたサービス名** も設定すると、書き込むすべてのデータで `service.name` が強制されるため、コピーされたキーがテレメトリをバックエンドのサービスのものに見せかけることはできません。どちらもキーのページ (**プロジェクト設定 > テレメトリと APM > 取り込みキー**) にあります。",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **サーバーの取り込みキーは決してブラウザーに配信しないでください。** サーバーキーにはオリジンのチェックがなく、どこからでも完全な取り込み権限があります。ページのソースに入ってしまえば、見つけた誰もがこのプロジェクトに偽の span、ログ、メトリクスを書き込めます — ダッシュボードを汚し、誤った警報を出し、従量制の使用量を増やします — あなたが気づいてローテーションするまで。",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls` は、どのクロスオリジンリクエストに W3C の `traceparent` ヘッダーを付けるかを決め、ブラウザーの span を、それが引き起こしたバックエンドのトレースにつなげます。同一オリジンのリクエストは設定なしで伝播されます。",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**`/.*/` に設定しないでください。** ヘッダーを追加すると単純なクロスオリジンリクエストがプリフライト付きのリクエストになり、`Access-Control-Allow-Headers` に `traceparent` を含めていないサードパーティの API は失敗し始めます。自分で管理し、設定済みのオリジンだけを指定してください:",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "`fetch` ではなく `XMLHttpRequest` で行うリクエストには、`@opentelemetry/instrumentation-xml-http-request` とその `XMLHttpRequestInstrumentation` が同じオプションで必要です。",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "OpenTelemetry のブラウザー SDK は、捕捉されなかったエラーを自動では記録しません。明示的に報告して、バックエンドのエラーと一緒に **例外** ビューに集まるようにしてください:",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "概要を埋めるにはトレースだけで十分です。ブラウザーのログを OneUptime で検索したい場合や Core Web Vitals がほしい場合は、ログとメトリクスのパイプラインを追加してください:",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object: a pipeline whose resource lacks `browser.*` is filed as a separate backend Service.":
    "それらのエクスポーターは、同じ `x-oneuptime-token` ヘッダーを付けて `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` と `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` に送信します — コードは [ブラウザーのセットアップ](/docs/rum/browser-setup) にあります。同じ `resource` オブジェクトで作成してください: リソースに `browser.*` がないパイプラインは、別のバックエンドのサービスとして記録されます。",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "**Core Web Vitals** カード — LCP、INP、CLS、FCP、TTFB — は、アプリが `web_vital.lcp` などの名前で報告するメトリクスからだけ埋められます。[Core Web Vitals](/docs/rum/web-vitals) に、OneUptime が読む名前と `web-vitals` ライブラリの組み込み方があります。",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "接頭辞 `oneuptime.label.` を持つリソース属性は、アプリケーションのプロジェクトラベルになります — `oneuptime.label.env` を `production` にすると、ラベル `env:production` が追加されます:",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "`service.name` は環境ごとではなくアプリごとに 1 つ使い、環境はラベルで区別してください。そうすれば各アプリのアプリケーションと履歴は 1 つのままです。",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "名前でアプリケーションにラベルを付けたり所有者を割り当てたりするには、**リアルユーザーモニタリング → 設定 → ラベルルール** と **所有者ルール** を使います。ルールはアプリケーションが作成されたとき (自動検出によるものを含む) に実行され、既存のアプリケーションのラベルは付け直しません。",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **概要** — 選択できる期間のページビュー、エラー率、p95 の所要時間とトレンドグラフ。インストルメンテーションが出す span から算出されるため、ページビューはそれが報告するもの (ドキュメントの読み込み、ルートの変更、操作) です。",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals** — アプリがメトリクスとして報告すると、LCP、INP、CLS、FCP、TTFB が表示されます。",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **ログ**、**トレース**、**メトリクス** — このアプリケーションに絞り込んだテレメトリのエクスプローラー。",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **クライアント** — `browser.platform` から得た、アプリケーションが確認されたブラウザーのプラットフォーム。プラットフォーム単位の大まかなもので、エンドユーザー単位ではありません。",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **セッションリプレイ** — 独自のスクリプトタグとプライバシー設定を持つ、別のオプションのレコーダー: [セッションリプレイ](/docs/telemetry/session-replay)。",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "アプリケーションは、テレメトリが届き続けている間は **データ受信中** を、15 分間何も届かないと **最近のトラフィックなし** を表示します。誰もアプリを使っていない間はこれが普通です。",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "DevTools → **Network** を開いて `otlp` で絞り込み、`POST /otlp/v1/traces` を探します。リクエストがまったくない場合、SDK は起動していません:",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts` が最初に import されていません。インストルメンテーションは `fetch` にパッチを当てます。それより前に import されたものはトレースされず、tree-shaking で import が削られると何も動きません。",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- バッチプロセッサーがまだフラッシュしていません。`BatchSpanProcessor` はバッファーします — 何も送られていないと判断する前に 30 秒ほど待つか、ページを移動してください。",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- ビルド時の環境変数が `undefined` になり、エクスポーターの URL が不正になっています。起動時に一度出力してください。",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **Content Security Policy によるブロック** — コンソールにそう表示されます。`connect-src 'self' <YOUR_ONEUPTIME_URL>;` を追加してください (ステップ 4)。",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **CORS によるブロック** — OneUptime の OTLP エンドポイントはすべてのオリジンと `x-oneuptime-token` ヘッダーを許可しているため、CORS の失敗はほぼ常に、リクエストがそもそも OneUptime に届いていないことを意味します: 社内プロキシ、広告ブロッカー、ホスト名の打ち間違いなどです。",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`** — サイトの正確なオリジン (スキーム、ホスト、ポート) を、**プロジェクト設定 > テレメトリと APM > 取り込みキー** にあるキーの **許可されたオリジン** に追加してください。",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`** — そこでキーを再び有効にするか、ステップ 1 で別のキーを選んでください。",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`** — キーが不明、取り消し済み、または期限切れです。ステップ 5 のキーの確認を実行し、ステップ 1 で有効なブラウザーキーを選ぶか作成してください。",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`** — URL が間違っています。トレースのエクスポーターには完全なパス `/otlp/v1/traces` が必要です。",
  "The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable `browserDetector` as in step 3, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "リソースにブラウザーの属性がないため、テレメトリはバックエンドのサービスとして記録されました。ステップ 3 のように `browserDetector` を有効にするか、`browser.*` 属性を自分で設定してください (詳細 の **OneUptime がブラウザーアプリを認識する方法**)。",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "送信内容は DevTools → **Network** → OTLP リクエスト → **Payload** で確認できます: 判定に使われるのは `resourceSpans[0].resource.attributes` のリストです。",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "すでに作成されたサービスは RUM アプリケーションにはなりません — 2 つは別のレコードです — RUM のテレメトリが届いたら削除してください。",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "クライアントの行は `browser.platform` から作られます。`browserDetector` は Chromium 系ブラウザーにしかない UA Client Hints API を読むため、Safari と Firefox では `browser.language` は設定します — テレメトリを RUM に分類するにはそれで十分です — が、`browser.platform` は設定しません。それらのクライアントを一覧に出すには `browser.platform` を自分で設定してください (詳細 の **OneUptime がブラウザーアプリを認識する方法**)。",
  "The card is filled only from metrics your app emits. Check, in order:":
    "このカードは、アプリが出すメトリクスからだけ埋められます。次の順に確認してください:",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. そもそも **メトリクス** のパイプラインがあること — トレースだけではこのカードは埋まりません。",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. メトリクスの名前が OneUptime の読むものであること — [Core Web Vitals](/docs/rum/web-vitals) を参照してください。",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. メトリクスがアプリケーションの **メトリクス** タブに表示されること。表示されていればエクスポートは動いており、問題は名前か選択した期間です。",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP と CLS はページが非表示になったときに報告されるため、短い訪問は次のエクスポートの前に終わることがあります。",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **期間を確認してください。** 概要の既定は過去 1 時間なので、今朝のテストは範囲外です。",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **1 分待ってください。** 取り込みはキューを通るため、テスト用の span 1 つが表示されるまでに最大 1 分かかることがあります。",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **プロジェクトを確認してください。** テレメトリがどのプロジェクトに入るかはキーで決まります。",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "テレメトリが 15 分間届かないと、ステータスは **最近のトラフィックなし** になります。誰もアプリを使っていない間はこれが想定どおりです。アプリにトラフィックがある場合:",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- **sampler** がすべてを破棄している可能性があります — 常にオフ、または比率が非常に低い sampler を設定していないか確認してください。",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- その時間帯に誰も行わなかった操作でしかアプリが送信しない可能性があります。",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- デプロイ後にキーが取り消された可能性があります — ステップ 5 のキーの確認を実行してください。",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name` は **`storefront-web`** で、このアプリケーションの識別子です — そのままにしてください。変えるとデータは新しいアプリケーションとして登録されます。",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "OpenTelemetry SDK を組み込んだ iOS、Android、React Native のアプリ — opentelemetry-swift、OpenTelemetry Android、または OpenTelemetry JavaScript SDK",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "アプリが報告する `service.name` — ステップ 1 の **モバイル** キーはこれに固定されます",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "これらは OpenTelemetry の標準設定です: 環境からこれらを読む SDK はそのまま受け取ります。そうでない場合は、同じエンドポイント、`x-oneuptime-token` ヘッダー、リソース属性を、コードで SDK の OTLP エクスポーターとリソースに設定してください — [モバイルのセットアップ](/docs/rum/mobile-setup) に Android、iOS、React Native での方法があります。",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "ほとんどのモバイル SDK は `device.*` 属性を設定してくれます。`device.model.identifier` は **クライアント** タブに表示されるので、お使いの SDK が設定しない場合は上のように設定してください。",
  '`200` with `"valid": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.':
    '`200` と `"valid": true` は OneUptime がキーを受け付けることを意味し、モバイルキーの場合、メッセージにはモバイルアプリからしか動かないことが付け加えられます。`401` はキーが不明、取り消し済み、無効、または期限切れであることを意味し、SDK をどう設定しても解決しません。',
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "次に、アプリを起動します。最初のテレメトリのバッチで、キーに固定されたサービス名で **リアルユーザーモニタリング** の下に表示されます。",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "モバイルキーが送るものはすべて、リソースの内容にかかわらず、キーに固定されたサービス名の下で、このモバイルアプリとして記録されます。キーはリソースのうち、アプリが自分自身について述べること — `service.*`、`device.*`、`os.*`、`telemetry.*` の属性や `oneuptime.label.*` のラベルなど — だけを残し、残りは破棄するため、コピーされたキーがテレメトリをホスト、クラスター、バックエンドのサービスのものに見せかけることはできません。",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "ほかのキーでは、OneUptime はリソースに `device.id` または `device.model.identifier` があるとき、テレメトリを **モバイル RUM** に分類します。アプリケーションは `service.name` で識別され (大文字と小文字は区別しません)、そのテレメトリはこの RUM アプリケーションのものになります — バックエンドのサービスとして重複して記録されることはありません。",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **いずれか 1 つ** | テレメトリをモバイル RUM としてマークします。`device.model.identifier` は **クライアント** タブにも表示されます。 |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "`device.manufacturer` もバッチをモバイルとしてマークしますが、`host.name` も `host.id` も持たないリソースの場合だけです — ホストのインベントリ項目では物理マシンのメーカーも表すからです。`device.id` か `device.model.identifier` も設定すれば、この区別が問題になることはありません。",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id` はインストールごとの識別子にしてください。広告 ID や、人を特定できるものにはしないでください。",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs and metrics, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **アプリを持っている人なら誰でも、そのキーをコピーできます。** だからモバイルキーなのです: コピーが送れるのはこのアプリのトレース、ログ、メトリクスだけで、キーに固定されたサービス名の下に記録され、ウェブページからは送れません。それでも、キーの上限までこのアプリの偽のデータを送ることはできるので、有効期限を設定し、リリースごとにキーをローテーションし、悪用されたら無効にしてください。",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "いずれもキーのページ (**プロジェクト設定 > テレメトリと APM > 取り込みキー**) にあります: **固定されたサービス名** はキーが送るすべてのデータを記録するアプリ、**1 分あたりのリクエスト数の上限** はアプリのすべてのコピーを合わせたキーの上限、**有効期限** は指定日以降の受け付けの停止、**有効** は即時の無効化です。",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "代わりに **サーバー** キーをアプリに同梱することは絶対にしないでください: それはどこからでも、どのサービスとしても、このプロジェクトにあらゆる種類のテレメトリを書き込めます。",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android** — [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) エージェント (`io.opentelemetry.android:android-agent`) は自身のリソースに `device.model.identifier`、`device.model.name`、`device.manufacturer` を設定するため、追加の設定なしで分類が働き、クラッシュ、ANR、遅いフレームと停止したフレーム、アプリの起動、セッションを自分で報告します。`service.name` を設定しない限りランチャーのラベルでアプリに名前を付け、`device.id` は送りません。[Android のセットアップ](/docs/rum/android-setup) に、Gradle の依存関係、コード、それぞれが OneUptime で何になるかがあります。",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift** — [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift) では、`device.model.identifier` と `device.manufacturer` を自分でリソースに設定してください: SDK のバージョンが加えるリソースはリリースごとに変わってきました。",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app.":
    "- **React Native / Expo** — JavaScript SDK で動くため、セットアップは [ブラウザーのセットアップ](/docs/rum/browser-setup) のブラウザー向けのものと同じで、違いは 2 つです: `browserDetector` はなく、**クライアント** タブにデバイスが表示されるよう `device.manufacturer` と `device.model.identifier` を自分で設定します。ほかのモバイルアプリと同じく **モバイル** キーで送信します。",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **そのほか** — Flutter、Unity、.NET MAUI や自作の OTLP ライターも、リソースに `service.name` と `device.*` 属性を 1 つ持たせれば同じように動きます。",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "モバイル向けの OpenTelemetry SDK は、リリースごとにビルダーの API を変えます。[モバイルのセットアップ](/docs/rum/mobile-setup) にそれぞれのコードがあります。メソッド名は固定するバージョンで確認してください。",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "接頭辞 `oneuptime.label.` を持つリソース属性は、アプリケーションのプロジェクトラベルになります — `oneuptime.label.env=production` はラベル `env:production` を追加します:",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **概要** — 選択できる期間のイベント、エラー率、p95 の所要時間とトレンドグラフ。インストルメンテーションが出す span から算出されます。",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **例外** — アプリが報告するクラッシュと ANR を、未処理の例外として、概要と **例外** に表示します。OpenTelemetry Android はどちらも自分で報告します。ANR は `ANR` という種類で表示されます。",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **クライアント** — `device.model.identifier` から得た、アプリケーションが確認されたデバイスのモデル。モデル単位の大まかなもので、エンドユーザー単位ではありません。",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "`401` は、キーが不明、取り消し済み、無効、または期限切れであることを意味します: ステップ 1 でモバイルキーを選ぶか作成し、そのキーでアプリをビルドし直してください。",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and never from a web page: an SDK that exports over gRPC, or a request that carries an `Origin` header, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "`422` は何が拒否されたかを示します。モバイルキーが送るのはアプリの OTLP のトレース、ログ、メトリクスを HTTP でだけで、ウェブページからは送りません: gRPC でエクスポートする SDK や、`Origin` ヘッダーを持つリクエストは拒否されます。ブラウザーキーは確認には通りますが、`Origin` ヘッダーが必要でモバイル SDK はそれを送らないため、モバイルアプリからは拒否されます。",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "テレメトリはサーバーキーで送られ、リソースに `device.id` も `device.model.identifier` もないため、バックエンドのサービスとして記録されました。送るものすべてをこのアプリとして記録するモバイルキー (ステップ 1) で送信するか、ステップ 2 のように SDK のリソースにそれらを設定してください。",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "クライアントの行は特に `device.model.identifier` から作られます。`device.manufacturer` だけを設定する SDK はモバイルに分類されますが、クライアントは一覧に出ません — `device.model.identifier` も設定してください。",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "テレメトリが 15 分間届かないと、ステータスは **最近のトラフィックなし** になります。誰もアプリを使っていない間はこれが想定どおりです。アプリが使われている場合:",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- リリース後にキーが取り消された可能性があります — ステップ 3 のキーの確認を実行してください。",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name` は **`Storefront Mobile`** で、このアプリケーションの識別子です — そのままにしてください。変えるとデータは新しいアプリケーションとして登録されます。`OTEL_RESOURCE_ATTRIBUTES` ではパーセントエンコードされ、SDK がデコードします。",
};

export default TRANSLATION;
