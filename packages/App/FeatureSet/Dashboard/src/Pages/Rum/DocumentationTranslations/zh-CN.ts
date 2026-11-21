import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in Simplified Chinese (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * Simplified Chinese. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "一个您可以修改代码并重新部署的 Web 应用，依赖通过 npm 安装",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "您的网站所使用的来源，例如 `https://app.example.com`——浏览器密钥只接受来自您在其上列出的来源的请求",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "然后将它作为应用的**第一个**导入，这样插桩会在其他任何代码运行之前修补 `fetch`：",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "将 `storefront-web` 替换为您的应用名称。应用在 OneUptime 中以此名称显示，因此请保持不变：新名称会注册为新应用。",
  "> **Keep `browserDetector`.** Everything a Browser key sends is filed as this application, but the OpenTelemetry browser SDKs add no `browser.*` attributes unless you enable the browser resource detector or set them yourself — and without `browser.platform` the **Clients** tab lists no platforms.":
    "> **保留 `browserDetector`**。浏览器密钥发送的所有内容都会作为此应用存储，但 OpenTelemetry 浏览器 SDK 不会添加 `browser.*` 属性，除非您启用浏览器资源检测器或自行设置——没有 `browser.platform`，**客户端**标签页不会列出任何平台。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在步骤 1 中选择一个摄取密钥来填入 `<YOUR_API_KEY>`。",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "将其合并到您现有的 `connect-src` 指令中。您的网站没有 Content Security Policy？跳过此步骤。",
  '`200` with `"valid": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.':
    '`200` 加上 `"valid": true` 表示 OneUptime 接受该密钥——对于浏览器密钥，消息还会说明它只能在浏览器中、从其允许的来源之一使用。`401` 表示该密钥未知、已撤销、已停用或已过期。',
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "然后加载您网站的一个页面。一分钟内，该应用会以其 `service.name` 命名出现在**真实用户监控**中，并显示页面浏览量、错误率和 p95 时长。",
  "Everything a Browser key sends is filed as this browser app, whatever its resource says. The key keeps only what a page says about itself on the resource — such as its `service.*`, `browser.*`, `user_agent.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "浏览器密钥发送的所有内容都会作为此浏览器应用存储，无论其资源怎么写。密钥只保留资源中页面对自身的描述——例如其 `service.*`、`browser.*`、`user_agent.*` 和 `telemetry.*` 属性以及 `oneuptime.label.*` 标签——其余全部丢弃，因此复制的密钥无法将其遥测冒充为主机、集群或后端服务。",
  "With any other key, OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "使用其他任何密钥时，当资源带有客户端属性时，OneUptime 会将遥测归类为 **RUM**——对于 Web，即 `browser.platform`、`browser.language` 或非空 `browser.brands` 中的任意一个。应用以 `service.name`（不区分大小写）识别，其遥测属于此 RUM 应用——绝不会再作为后端服务重复存储。",
  "| Attribute | Required | What it does |": "| 属性 | 必需 | 作用 |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **是** | 应用的标识，例如 `storefront-web`。之后重命名会创建新应用。 |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **其中之一** | 将遥测标记为浏览器 RUM。`browser.platform` 还会填充**客户端**标签页。 |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | 否 | 显示在概览中 |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector` 从浏览器设置这些属性。它读取只有 Chromium 浏览器才有的 UA Client Hints API，因此在 Safari 和 Firefox 上它会设置 `browser.language`，但不会设置 `browser.platform`。要自行设置这些属性——不使用检测器，或为每个浏览器都提供平台——请这样构建资源：",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "让 `browser.platform` 保持粗粒度：每个不同的值都会成为**客户端**标签页中的一行。",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "浏览器代码片段中的所有内容都会到达您的用户。其中的令牌是公开的——任何查看源代码、打开开发者工具或阅读您的打包文件的人都能复制它。因此本指南只列出和创建**浏览器**类型的摄取密钥，每个密钥都带有您的网站所使用的来源：",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- 它只接受来自这些来源的请求，因此复制的密钥在别人的页面上无法使用；",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- 它只能写入追踪、日志、指标、会话回放和 Sentry 浏览器 SDK 报告——不能写入性能剖析、source map、syslog、Fluent、Pyroscope 或安全事件；",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- 它有按密钥的速率限制，一次编辑即可关闭，并且可以设置过期时间。",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "来源包括协议和端口（如有），并且可以以一个主机通配符 `*.` 开头——`https://app.example.com`、`https://*.example.com`。如果还在密钥上设置**固定的服务名称**，它写入的所有内容都会被强制使用该 `service.name`，因此复制的密钥无法将其遥测冒充为您的某个后端服务。两者都在**项目设置 > 遥测与 APM > 摄取密钥**中该密钥的页面上。",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **切勿将服务器摄取密钥交给浏览器**。服务器密钥可以从任何地方进行完全的摄取访问，且不检查来源。一旦出现在页面源代码中，任何找到它的人都能向此项目写入伪造的 span、日志和指标——污染仪表板、触发虚假警报并推高您的计费用量——直到您发现并轮换它。",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls` 决定哪些跨源请求会带上 W3C `traceparent` 标头，从而将浏览器 span 与其触发的后端追踪关联起来。同源请求无需任何配置即可传播。",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**不要将其设置为 `/.*/`**。添加标头会把简单的跨源请求变成需要预检（preflight）的请求，任何未在其 `Access-Control-Allow-Headers` 中列出 `traceparent` 的第三方 API 都会开始失败。只列出您控制并已配置的来源：",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "使用 `XMLHttpRequest` 而不是 `fetch` 发出的请求需要 `@opentelemetry/instrumentation-xml-http-request` 及其 `XMLHttpRequestInstrumentation`，并使用相同的选项。",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "OpenTelemetry 浏览器 SDK 不会自动捕获未处理的错误。请显式上报它们，使其与后端错误一起出现在**异常**视图中：",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "追踪足以填充概览。如果您想在 OneUptime 中搜索浏览器日志，或查看核心 Web 指标，请添加日志和指标管道：",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object, so their logs and metrics are filed under this application too.":
    "它们的导出器使用相同的 `x-oneuptime-token` 标头发送到 `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` 和 `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics`——代码见[浏览器设置](/docs/rum/browser-setup)。请使用同一个 `resource` 对象构建它们，这样它们的日志和指标也会归入此应用之下。",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "**核心 Web 指标**卡片（LCP、INP、CLS、FCP 和 TTFB）只由您的应用以 `web_vital.lcp` 等名称上报的指标填充。[Core Web Vitals](/docs/rum/web-vitals) 列出了 OneUptime 读取的名称，并介绍如何接入 `web-vitals` 库。",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "任何带有 `oneuptime.label.` 前缀的资源属性都会成为应用上的项目标签——将 `oneuptime.label.env` 设置为 `production` 会添加标签 `env:production`：",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "每个应用使用一个 `service.name`，而不是每个环境一个，并用标签区分环境，这样每个应用只保留一个应用记录和一段历史。",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "要按名称为应用添加标签或分配所有者，请使用**真实用户监控 → 设置 → 标签规则**和**所有者规则**。规则在应用创建时运行，包括通过自动发现创建时；它们不会为已有的应用重新添加标签。",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **概览**——可选时间范围内的页面浏览量、错误率和 p95 时长，并附趋势图。这些数据由您的插桩发出的 span 得出，因此页面浏览就是插桩所上报的内容：文档加载、路由变化、交互。",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **核心 Web 指标**——LCP、INP、CLS、FCP 和 TTFB，在您的应用将其作为指标上报后显示。",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **日志**、**追踪**和**指标**——遥测探索器，范围限定为此应用。",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **客户端**——见过此应用的浏览器平台，来自 `browser.platform`。按平台粗略统计，绝不按单个终端用户统计。",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **会话回放**——一个独立的可选录制器，有自己的脚本标签和隐私控制：[会话回放](/docs/telemetry/session-replay)。",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "只要遥测持续到达，应用就会显示**正在接收数据**；15 分钟没有遥测后显示**近期无流量**，在无人使用应用时这是正常的。",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "打开 DevTools → **Network**，按 `otlp` 过滤：您要找的是 `POST /otlp/v1/traces`。完全没有请求说明 SDK 从未启动：",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts` 没有最先导入。插桩会修补 `fetch`；在它们之前导入的内容不会被追踪，如果 tree-shaking 移除了这个导入，就什么都不会运行。",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- 批处理器尚未刷新。`BatchSpanProcessor` 会缓冲数据——在断定没有发送任何内容之前，请等待约 30 秒或切换页面。",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- 某个构建时环境变量变成了 `undefined`，因此导出器 URL 格式错误。请在启动时打印一次。",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **被 Content Security Policy 拦截**——控制台会提示。添加 `connect-src 'self' <YOUR_ONEUPTIME_URL>;`（步骤 4）。",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **被 CORS 拦截**——OneUptime 的 OTLP 端点允许任何来源和 `x-oneuptime-token` 标头，因此 CORS 失败几乎总是意味着请求根本没有到达 OneUptime：企业代理、广告拦截器或主机名拼写错误。",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`**——在**项目设置 > 遥测与 APM > 摄取密钥**中，将您网站的确切来源（协议、主机和端口）添加到该密钥的**允许的来源**。",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`**——在那里重新启用该密钥，或在步骤 1 中选择其他密钥。",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`**——该密钥未知、已撤销或已过期。在步骤 5 中运行密钥检查，并在步骤 1 中选择或创建一个有效的浏览器密钥。",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`**——URL 错误。追踪导出器需要完整路径 `/otlp/v1/traces`。",
  "The telemetry was sent with a key other than a Browser key, and its resource carries no browser attribute, so it was filed as a backend Service. Send with a Browser key (step 1), which files everything it sends as this app, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "该遥测是用浏览器密钥以外的密钥发送的，且其资源中没有任何浏览器属性，因此被存储为后端服务。请使用浏览器密钥（步骤 1）发送——它会将发送的所有内容作为此应用存储——或自行设置 `browser.*` 属性（见高级中的**OneUptime 如何识别浏览器应用**）。",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "在 DevTools → **Network** → OTLP 请求 → **Payload** 中检查您发送的内容：决定结果的是 `resourceSpans[0].resource.attributes` 列表。",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "已创建的服务不会变成 RUM 应用——它们是两条独立的记录——因此在 RUM 遥测到达后请将其删除。",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "客户端行来自 `browser.platform`。`browserDetector` 读取只有 Chromium 浏览器才有的 UA Client Hints API：在 Safari 和 Firefox 上它会设置 `browser.language`——足以将遥测归类为 RUM——但不会设置 `browser.platform`。要列出这些客户端，请自行设置 `browser.platform`（见高级中的**OneUptime 如何识别浏览器应用**）。",
  "The card is filled only from metrics your app emits. Check, in order:":
    "此卡片只由您的应用发出的指标填充。请按顺序检查：",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. 您确实有**指标**管道——仅有追踪永远不会填充此卡片。",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. 指标名称是 OneUptime 读取的名称——参见 [Core Web Vitals](/docs/rum/web-vitals)。",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. 指标出现在应用的**指标**标签页中。如果出现了，说明导出正常，问题在于名称或所选的时间范围。",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP 和 CLS 在页面隐藏时上报，因此一次短暂的访问可能在下一次导出前就结束了。",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **检查时间范围**。概览默认显示最近一小时，因此今天早上的测试不在范围内。",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **等待一分钟**。摄取经过队列，单个测试 span 可能需要最多一分钟才会出现。",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **检查项目**。遥测进入哪个项目由密钥决定。",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "15 分钟没有遥测后，状态会变为**近期无流量**。在无人使用应用时这是预期的。如果您的应用有流量：",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- 可能是**采样器**丢弃了所有数据——请检查您没有设置始终关闭或比例极低的采样器。",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- 应用可能只在该时间段内无人进行的交互时才发送数据。",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- 密钥可能在部署后被撤销了——在步骤 5 中运行密钥检查。",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name` 为 **`storefront-web`**，即此应用的标识符——请保持不变，否则数据会注册为新应用。",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "带有 OpenTelemetry SDK 的 iOS、Android 或 React Native 应用——opentelemetry-swift、OpenTelemetry Android 或 OpenTelemetry JavaScript SDK",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "您的应用上报的 `service.name`——步骤 1 中的**移动端**密钥固定到它",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "这些是标准的 OpenTelemetry 设置：从环境中读取它们的 SDK 会原样使用。否则，请在代码中为 SDK 的 OTLP 导出器和资源设置相同的端点、`x-oneuptime-token` 标头和资源属性——[移动端设置](/docs/rum/mobile-setup)展示了 Android、iOS 和 React Native 的做法。",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "大多数移动端 SDK 会替您设置 `device.*` 属性。`device.model.identifier` 会填充**客户端**标签页，因此如果您的 SDK 没有设置它，请按上面的方式设置。",
  '`200` with `"valid": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.':
    '`200` 加上 `"valid": true` 表示 OneUptime 接受该密钥；对于移动端密钥，消息还会说明它只能从移动应用使用。`401` 表示该密钥未知、已撤销、已停用或已过期，任何 SDK 配置都无法解决。',
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "然后启动应用。它会随第一批遥测出现在**真实用户监控**中，并以该密钥所固定的服务名称命名。",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "移动端密钥发送的所有内容都会作为此移动应用存储，归入该密钥所固定的服务名称之下，无论其资源怎么写。密钥只保留资源中应用对自身的描述——例如其 `service.*`、`device.*`、`os.*` 和 `telemetry.*` 属性以及 `oneuptime.label.*` 标签——其余全部丢弃，因此复制的密钥无法将其遥测冒充为主机、集群或后端服务。",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "使用其他任何密钥时，当资源带有 `device.id` 或 `device.model.identifier` 时，OneUptime 会将遥测归类为**移动端 RUM**。应用以 `service.name`（不区分大小写）识别，其遥测属于此 RUM 应用——绝不会再作为后端服务重复存储。",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **其中之一** | 将遥测标记为移动端 RUM。`device.model.identifier` 还会填充**客户端**标签页。 |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "`device.manufacturer` 也会将一批数据标记为移动端，但仅限于没有 `host.name` 或 `host.id` 的资源——它在主机的资产清单条目中也表示物理机器的制造商。同时设置 `device.id` 或 `device.model.identifier`，就永远不会遇到这种区分。",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id` 应是每次安装的标识符，而不是广告 ID 或任何能识别个人的信息。",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs, metrics and session replays, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **任何拥有您应用的人都能复制它的密钥**。这正是它是移动端密钥的原因：副本只能发送此应用的追踪、日志、指标和会话回放，归入该密钥所固定的服务名称之下，且绝不能从网页发送。它仍然可以在密钥的限额内为此应用发送编造的数据，因此请设置过期时间，随版本发布轮换密钥，并在被滥用时将其关闭。",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "这些都在**项目设置 > 遥测与 APM > 摄取密钥**中该密钥的页面上：**固定的服务名称**是该密钥发送的所有内容所归入的应用，**每分钟请求数上限**在您应用的所有副本之间限制该密钥，**过期时间**让它在某个日期之后不再被接受，**已启用**可立即将其关闭。",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "切勿改为在应用中分发**服务器**密钥：它可以从任何地方、以任何服务的身份向此项目写入任何类型的遥测。",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android**——[OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) 代理（`io.opentelemetry.android:android-agent`）会在自己的资源上设置 `device.model.identifier`、`device.model.name` 和 `device.manufacturer`，因此无需额外配置即可完成分类，并且它会自行上报崩溃、ANR、缓慢帧和冻结帧、应用启动以及会话。除非您设置 `service.name`，否则它会以启动器标签为应用命名，并且不发送 `device.id`。[Android 设置](/docs/rum/android-setup)提供了 Gradle 依赖、代码，以及每一项在 OneUptime 中对应什么。",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift**——使用 [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift) 时，请自行在资源上设置 `device.model.identifier` 和 `device.manufacturer`：各 SDK 版本添加的资源在不同版本之间有所变化。",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app, and so do its [session replays](/docs/telemetry/session-replay#install-in-react-native): give the replay SDK the same key, with the key's pinned service name as `appIdentifier`.":
    "- **React Native / Expo**——运行 JavaScript SDK，因此设置与[浏览器设置](/docs/rum/browser-setup)中的浏览器设置相同，但有两点不同：没有 `browserDetector`，并且您需要自行设置 `device.manufacturer` 和 `device.model.identifier`，使**客户端**标签页列出设备。它与任何移动应用一样使用**移动端**密钥发送，其[会话回放](/docs/telemetry/session-replay#install-in-react-native)也是如此：为回放 SDK 提供同一个密钥，并将该密钥固定的服务名称用作 `appIdentifier`。",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **其他任何方式**——Flutter、Unity、.NET MAUI 或手写的 OTLP 写入器都以同样的方式工作，只要资源带有 `service.name` 加一个 `device.*` 属性。",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "OpenTelemetry 移动端 SDK 会在不同版本之间更改其构建器 API。[移动端设置](/docs/rum/mobile-setup)提供了每个 SDK 的代码；请对照您锁定的版本核对方法名称。",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "任何带有 `oneuptime.label.` 前缀的资源属性都会成为应用上的项目标签——`oneuptime.label.env=production` 会添加标签 `env:production`：",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **概览**——可选时间范围内的事件、错误率和 p95 时长，并附趋势图，由您的插桩发出的 span 得出。",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **异常**——您的应用作为未处理异常上报的崩溃和 ANR，显示在概览和**异常**中。OpenTelemetry Android 会自行上报这两者；ANR 以类型 `ANR` 列出。",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **客户端**——见过此应用的设备型号，来自 `device.model.identifier`。按型号粗略统计，绝不按单个终端用户统计。",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "`401` 表示该密钥未知、已撤销、已停用或已过期：请在步骤 1 中选择或创建一个移动端密钥，并用它重新构建应用。",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and its session replays, and never from a web page: an SDK that exports over gRPC, a request that carries an `Origin` header, or another app's recording, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "`422` 会说明被拒绝的内容。移动端密钥只通过 HTTP 发送应用的 OTLP 追踪、日志和指标，以及该应用的会话回放，绝不从网页发送：通过 gRPC 导出的 SDK、带有 `Origin` 标头的请求，或其他应用的录制，都会被拒绝。浏览器密钥能通过检查，但从移动应用发送时会被拒绝，因为它需要 `Origin` 标头，而移动端 SDK 不会发送。",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "该遥测是用服务器密钥发送的，且其资源中既没有 `device.id` 也没有 `device.model.identifier`，因此被存储为后端服务。请使用移动端密钥（步骤 1）发送——它会将发送的所有内容作为此应用存储——或者像步骤 2 那样在 SDK 的资源上设置这些属性。",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "客户端行专门来自 `device.model.identifier`。只设置 `device.manufacturer` 的 SDK 会被归类为移动端，但不会列出任何客户端——请同时设置 `device.model.identifier`。",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "15 分钟没有遥测后，状态会变为**近期无流量**。在无人使用应用时这是预期的。如果您的应用正在使用中：",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- 密钥可能在发布后被撤销了——在步骤 3 中运行密钥检查。",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name` 为 **`Storefront Mobile`**，即此应用的标识符——请保持不变，否则数据会注册为新应用。它在 `OTEL_RESOURCE_ATTRIBUTES` 中经过百分号编码，SDK 会将其解码。",
};

export default TRANSLATION;
