import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in Arabic (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * Arabic. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "تطبيق ويب يمكنك تغيير شيفرته وإعادة نشره، وتُثبَّت تبعياته عبر npm",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "الأصول التي يُقدَّم منها موقعك، مثل `https://app.example.com` — لا يقبل مفتاح المتصفح إلا الطلبات الآتية من الأصول المدرجة عليه",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "ثم اجعله **أول** عملية import في تطبيقك، كي ترقّع أدوات القياس `fetch` قبل أن يعمل أي شيء آخر:",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "استبدل `storefront-web` باسم تطبيقك. بهذا الاسم يظهر التطبيق في OneUptime، فأبقه ثابتًا: الاسم الجديد يسجّل تطبيقًا جديدًا.",
  "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.":
    "> **لا يكفي ضبط `service.name` وحده.** لا تضيف حزم OpenTelemetry SDK للمتصفح سمات `browser.*` إلا إذا فعّلت كاشف موارد المتصفح أو ضبطتها بنفسك — ومن دونها يصبح هذا خدمة خلفية، لا تطبيق RUM.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "اختر مفتاح استيعاب في الخطوة 1 لملء `<YOUR_API_KEY>`.",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "ادمجه في التوجيه `connect-src` الموجود لديك. ليس لموقعك Content Security Policy؟ تخطَّ هذه الخطوة.",
  '`200` with `"valid": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.':
    '`200` مع `"valid": true` يعني أن OneUptime يقبل المفتاح — وفي مفتاح المتصفح تضيف الرسالة أنه لا يعمل إلا من متصفح، ومن أحد أصوله المسموح بها. و`401` يعني أنه غير معروف أو مُلغى أو معطّل أو منتهي الصلاحية.',
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "ثم حمّل صفحة من موقعك. خلال دقيقة يظهر التطبيق تحت **مراقبة المستخدمين الحقيقيين**، باسم `service.name` الخاص به، مع مشاهدات الصفحات ومعدل الأخطاء ومدة p95.",
  "OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "يصنّف OneUptime القياس عن بُعد على أنه **RUM** عندما يحمل مورده سمات العميل — في الويب أيًّا من `browser.platform` أو `browser.language` أو `browser.brands` غير فارغة. ويُعرَّف التطبيق بـ `service.name` (دون تمييز حالة الأحرف)، والقياس عن بُعد الخاص به ملك لتطبيق RUM هذا — ولا يُكرَّر أبدًا كخدمة خلفية.",
  "| Attribute | Required | What it does |": "| السمة | مطلوبة | ما تفعله |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **نعم** | هوية التطبيق، مثل `storefront-web`. إعادة تسميته لاحقًا تنشئ تطبيقًا جديدًا. |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **واحدة منها** | تُعلِّم القياس عن بُعد على أنه RUM للمتصفح. وتملأ `browser.platform` أيضًا علامة التبويب **العملاء**. |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | لا | تُعرض في النظرة العامة |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "يضبطها `browserDetector` من المتصفح. فهو يقرأ واجهة UA Client Hints API التي لا تملكها إلا متصفحات Chromium، لذلك يضبط في Safari وFirefox `browser.language` دون `browser.platform`. ولتضبط السمات بنفسك — دون الكاشف، أو لتعطي كل متصفح منصة — ابنِ المورد هكذا:",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "أبقِ `browser.platform` عامة: كل قيمة مختلفة تصبح صفًا في علامة التبويب **العملاء**.",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "كل ما في مقتطف المتصفح يصل إلى مستخدميك. الرمز المميز فيه عام — يستطيع نسخه كل من يطّلع على المصدر أو يفتح أدوات المطوّر أو يقرأ حزمتك. لذلك لا يعرض هذا الدليل ولا ينشئ إلا مفاتيح استيعاب من نوع **المتصفح**، لكل منها الأصول التي يُقدَّم منها موقعك:",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- لا يُقبل إلا من تلك الأصول، فلا يعمل المفتاح المنسوخ من صفحة شخص آخر؛",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- لا يكتب إلا التتبعات والسجلات والمقاييس وإعادات تشغيل الجلسات وتقارير Sentry browser SDK — لا الملفات التعريفية ولا source maps ولا syslog ولا Fluent ولا Pyroscope ولا الأحداث الأمنية؛",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- له حد للمعدل لكل مفتاح، ويمكن إيقافه بتعديل واحد، ويمكن أن يُعطى تاريخ انتهاء صلاحية.",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "يتضمن الأصل المخطط وأي منفذ، ويمكن أن يبدأ برمز بدل واحد للمضيف `*.` — `https://app.example.com`، `https://*.example.com`. وضبط **اسم الخدمة المثبت** على المفتاح أيضًا يفرض `service.name` على كل ما يكتبه، فلا يستطيع المفتاح المنسوخ أن ينسب قياسه عن بُعد إلى إحدى خدماتك الخلفية. كلاهما في صفحة المفتاح في **إعدادات المشروع > القياس عن بُعد وAPM > مفاتيح الاستيعاب**.",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **لا تشحن أبدًا مفتاح استيعاب من نوع الخادم إلى متصفح.** لمفتاح الخادم صلاحية استيعاب كاملة من أي مكان، بلا تحقق من الأصل. وما إن يصبح في مصدر الصفحة حتى يستطيع كل من يجده كتابة امتدادات وسجلات ومقاييس مزيفة في هذا المشروع — فيفسد لوحات المعلومات ويطلق تنبيهات كاذبة ويرفع استهلاكك المحسوب — إلى أن تلاحظ ذلك وتبدّله.",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "يحدد `propagateTraceHeaderCorsUrls` أي الطلبات عبر الأصول تحصل على ترويسة W3C `traceparent`، فتربط امتداد المتصفح بالتتبع الخلفي الذي أطلقه. وتُمرَّر الطلبات من الأصل نفسه دون أي إعداد.",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**لا تضبطه على `/.*/`.** إضافة ترويسة تحوّل طلبًا بسيطًا عبر الأصول إلى طلب يسبقه فحص preflight، وكل واجهة API لجهة خارجية لا تدرج `traceparent` في `Access-Control-Allow-Headers` الخاصة بها ستبدأ بالفشل. أدرج فقط الأصول التي تتحكم بها وأعددتها:",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "الطلبات المُرسَلة بـ `XMLHttpRequest` بدلًا من `fetch` تحتاج إلى `@opentelemetry/instrumentation-xml-http-request` و`XMLHttpRequestInstrumentation` الخاص بها، بالخيار نفسه.",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "لا تلتقط حزمة OpenTelemetry SDK للمتصفح الأخطاء غير المعالجة تلقائيًا. أبلغ عنها صراحة كي تصل إلى عرض **الاستثناءات** إلى جانب أخطاء الواجهة الخلفية:",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "تكفي التتبعات لملء النظرة العامة. أضف خطوط معالجة للسجلات والمقاييس إذا أردت البحث في سجلات المتصفح في OneUptime، أو Core Web Vitals:",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object: a pipeline whose resource lacks `browser.*` is filed as a separate backend Service.":
    "تُرسل مُصدِّراتها إلى `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` و`<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` بالترويسة نفسها `x-oneuptime-token` — والشيفرة في [إعداد المتصفح](/docs/rum/browser-setup). ابنِها بالكائن نفسه `resource`: خط المعالجة الذي يفتقر مورده إلى `browser.*` يُحفظ كخدمة خلفية منفصلة.",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "بطاقة **Core Web Vitals** — LCP وINP وCLS وFCP وTTFB — لا تُملأ إلا من المقاييس التي يُبلغ عنها تطبيقك، بأسماء مثل `web_vital.lcp`. وتسرد [Core Web Vitals](/docs/rum/web-vitals) الأسماء التي يقرؤها OneUptime وتربط مكتبة `web-vitals`.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "كل سمة مورد تبدأ بالبادئة `oneuptime.label.` تصبح تسمية مشروع على التطبيق — `oneuptime.label.env` بقيمة `production` تضيف التسمية `env:production`:",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "استخدم `service.name` واحدًا لكل تطبيق، لا لكل بيئة، وميّز البيئات بتسمية، كي يحتفظ كل تطبيق بسجل واحد وتاريخ واحد.",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "لتسمية التطبيقات أو تعيين المالكين بالاسم، استخدم **مراقبة المستخدمين الحقيقيين ← الإعدادات ← قواعد التسميات** و **قواعد المالكين**. تعمل القواعد عند إنشاء التطبيق، بما في ذلك الاكتشاف التلقائي؛ ولا تعيد تسمية التطبيقات الموجودة بالفعل.",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **نظرة عامة** — مشاهدات الصفحات ومعدل الأخطاء ومدة p95 خلال نطاق زمني قابل للاختيار، مع مخططات الاتجاه. وهي مستمدة من الامتدادات التي تصدرها أدوات القياس لديك، فمشاهدة الصفحة هي ما تُبلغ عنه: تحميل المستند، وتغيير المسار، والتفاعلات.",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals** — LCP وINP وCLS وFCP وTTFB، بعد أن يُبلغ عنها تطبيقك كمقاييس.",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **السجلات** و **التتبعات** و **المقاييس** — مستكشفات القياس عن بُعد، مقصورة على هذا التطبيق.",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **العملاء** — منصات المتصفح التي شوهد عليها التطبيق، من `browser.platform`. عامة حسب المنصة، لا لكل مستخدم نهائي.",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **إعادة تشغيل الجلسات** — مسجّل منفصل واختياري بوسم script خاص به وضوابط خصوصية خاصة به: [إعادة تشغيل الجلسات](/docs/telemetry/session-replay).",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "يعرض التطبيق **يستقبل البيانات** ما دام القياس عن بُعد يصل، و **لا توجد حركة مرور حديثة** بعد 15 دقيقة من دونه، وهذا طبيعي ما دام لا أحد يستخدم التطبيق.",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "افتح DevTools وعلامة التبويب **Network** وصفِّ النتائج بـ `otlp`: أنت تبحث عن `POST /otlp/v1/traces`. وغياب أي طلب يعني أن SDK لم يبدأ قط:",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- لم يُستورد `telemetry.ts` أولًا. ترقّع أدوات القياس `fetch`؛ وما يُستورد قبلها لا يُتتبع، وإن أزال tree-shaking الاستيراد فلا يعمل شيء على الإطلاق.",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- لم يُفرغ معالج الدفعات بعد. يخزّن `BatchSpanProcessor` مؤقتًا — انتظر نحو 30 ثانية، أو انتقل إلى صفحة أخرى، قبل أن تستنتج أنه لا يُرسل شيء.",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- آل متغير بيئة وقت البناء إلى `undefined`، فصار عنوان URL للمُصدِّر مشوّهًا. اطبعه مرة واحدة عند البدء.",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **محظور بسياسة Content Security Policy** — تقول وحدة التحكم ذلك. أضف `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (الخطوة 4).",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **محظور بسبب CORS** — نقاط نهاية OTLP في OneUptime تسمح بأي أصل وبالترويسة `x-oneuptime-token`، لذا فإن فشل CORS يعني تقريبًا دائمًا أن الطلب لا يصل إلى OneUptime أصلًا: خادم وكيل للشركة، أو مانع إعلانات، أو خطأ مطبعي في المضيف.",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`** — أضف الأصل الدقيق لموقعك (المخطط والمضيف والمنفذ) إلى **الأصول المسموح بها** للمفتاح في **إعدادات المشروع > القياس عن بُعد وAPM > مفاتيح الاستيعاب**.",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`** — أعد تشغيل المفتاح هناك، أو اختر مفتاحًا آخر في الخطوة 1.",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`** — المفتاح غير معروف أو مُلغى أو منتهي الصلاحية. شغّل التحقق من المفتاح في الخطوة 5، واختر مفتاح متصفح صالحًا أو أنشئه في الخطوة 1.",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`** — عنوان URL خاطئ. يحتاج مُصدِّر التتبعات إلى المسار الكامل `/otlp/v1/traces`.",
  "The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable `browserDetector` as in step 3, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "لا يحمل المورد أي سمة متصفح، فحُفظ القياس عن بُعد كخدمة خلفية. فعّل `browserDetector` كما في الخطوة 3، أو اضبط سمات `browser.*` بنفسك (**كيف يتعرف OneUptime على تطبيق متصفح** ضمن متقدم).",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "تحقّق مما ترسله في DevTools: علامة التبويب **Network**، ثم طلب OTLP، ثم **Payload**. والقائمة التي تحسم الأمر هي `resourceSpans[0].resource.attributes`.",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "الخدمة التي أُنشئت بالفعل لا تتحول إلى تطبيق RUM — فهما سجلان منفصلان — فاحذفها بعد وصول القياس عن بُعد الخاص بـ RUM.",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "صفوف العملاء تأتي من `browser.platform`. يقرأ `browserDetector` واجهة UA Client Hints API التي لا تملكها إلا متصفحات Chromium: ففي Safari وFirefox يضبط `browser.language` — وهذا يكفي لتصنيف القياس عن بُعد على أنه RUM — دون `browser.platform`. اضبط `browser.platform` بنفسك لتُدرج هؤلاء العملاء (**كيف يتعرف OneUptime على تطبيق متصفح** ضمن متقدم).",
  "The card is filled only from metrics your app emits. Check, in order:":
    "لا تُملأ البطاقة إلا من المقاييس التي يصدرها تطبيقك. تحقّق بالترتيب:",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. أن لديك خط معالجة **للمقاييس** أصلًا — التتبعات وحدها لا تملأ هذه البطاقة أبدًا.",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. أن أسماء المقاييس مما يقرؤه OneUptime — راجع [Core Web Vitals](/docs/rum/web-vitals).",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. أن المقاييس تظهر في علامة التبويب **المقاييس** للتطبيق. فإن ظهرت، فالتصدير يعمل والمشكلة في الاسم أو النطاق المحدد.",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. يُبلغ عن INP وCLS عند إخفاء الصفحة، لذا قد تنتهي زيارة قصيرة قبل التصدير التالي.",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **تحقّق من النطاق الزمني.** تعرض النظرة العامة افتراضيًا الساعة الماضية، فيقع اختبار هذا الصباح خارجها.",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **انتظر دقيقة.** الاستيعاب في طابور، وقد يستغرق ظهور امتداد اختبار واحد حتى دقيقة.",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **تحقّق من المشروع.** المفتاح هو الذي يحدد المشروع الذي يصل إليه القياس عن بُعد.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "تتحول الحالة إلى **لا توجد حركة مرور حديثة** بعد 15 دقيقة دون قياس عن بُعد. وهذا متوقع ما دام لا أحد يستخدم التطبيق. وإن كانت لتطبيقك حركة مرور:",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- قد يكون هناك **sampler** يُسقط كل شيء — تحقّق من أنك لم تضبط sampler مطفأً دائمًا أو بنسبة منخفضة جدًا.",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- قد لا يُرسل التطبيق إلا عند تفاعلات لم يقم بها أحد في تلك الفترة.",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- ربما أُلغي المفتاح بعد النشر — شغّل التحقق من المفتاح في الخطوة 5.",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "قيمة `service.name` هي **`storefront-web`**، معرّف هذا التطبيق — أبقها كما هي، وإلا سُجّلت البيانات كتطبيق جديد.",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "تطبيق iOS أو Android أو React Native مع حزمة OpenTelemetry SDK — opentelemetry-swift أو OpenTelemetry Android أو OpenTelemetry JavaScript SDK",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "قيمة `service.name` التي يُبلغ عنها تطبيقك — والمفتاح من نوع **هاتف محمول** في الخطوة 1 مثبّت عليها",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "هذه إعدادات OpenTelemetry القياسية: حزمة SDK التي تقرؤها من بيئتها تأخذها كما هي. وإلا فاضبط نقطة النهاية نفسها والترويسة `x-oneuptime-token` وسمات المورد على مُصدِّر OTLP ومورد SDK في الشيفرة — وتعرض [إعداد الهاتف المحمول](/docs/rum/mobile-setup) ذلك لـ Android وiOS وReact Native.",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "تضبط معظم حزم SDK للهاتف المحمول سمات `device.*` نيابة عنك. وتملأ `device.model.identifier` علامة التبويب **العملاء**، فاضبطها كما في الأعلى إن لم تفعل حزمتك ذلك.",
  '`200` with `"valid": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.':
    '`200` مع `"valid": true` يعني أن OneUptime يقبل المفتاح، وفي مفتاح الهاتف المحمول تضيف الرسالة أنه لا يعمل إلا من تطبيق هاتف محمول. و`401` يعني أنه غير معروف أو مُلغى أو معطّل أو منتهي الصلاحية، ولن يفيد أي إعداد لحزمة SDK.',
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "ثم شغّل التطبيق. يظهر تحت **مراقبة المستخدمين الحقيقيين** مع أول دفعة من القياس عن بُعد، باسم الخدمة الذي ثُبّت عليه المفتاح.",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "كل ما يرسله مفتاح الهاتف المحمول يُحفظ على أنه تطبيق الهاتف المحمول هذا، تحت اسم الخدمة الذي ثُبّت عليه المفتاح، أيًّا كان ما يقوله مورده. ولا يحتفظ المفتاح من المورد إلا بما يقوله التطبيق عن نفسه — مثل سماته `service.*` و`device.*` و`os.*` و`telemetry.*` وتسمياته `oneuptime.label.*` — ويُسقط الباقي، فلا يستطيع المفتاح المنسوخ أن ينسب قياسه عن بُعد إلى مضيف أو مجموعة عنقودية أو خدمة خلفية.",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "مع أي مفتاح آخر، يصنّف OneUptime القياس عن بُعد على أنه **RUM للهاتف المحمول** عندما يحمل مورده `device.id` أو `device.model.identifier`. ويُعرَّف التطبيق بـ `service.name` (دون تمييز حالة الأحرف)، والقياس عن بُعد الخاص به ملك لتطبيق RUM هذا — ولا يُكرَّر أبدًا كخدمة خلفية.",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **واحدة منها** | تُعلِّم القياس عن بُعد على أنه RUM للهاتف المحمول. وتملأ `device.model.identifier` أيضًا علامة التبويب **العملاء**. |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "تُعلِّم `device.manufacturer` الدفعة أيضًا على أنها هاتف محمول، لكن فقط على مورد لا يحمل `host.name` ولا `host.id` — فهي تدل أيضًا على صانع جهاز مادي في عنصر جرد المضيف. اضبط `device.id` أو `device.model.identifier` أيضًا ولن يطرأ هذا التمييز أبدًا.",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "ينبغي أن تكون `device.id` معرّفًا خاصًا بالتثبيت، لا معرّفًا إعلانيًا ولا أي شيء يحدد هوية شخص.",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs and metrics, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **يستطيع أي شخص لديه تطبيقك نسخ مفتاحه.** لهذا هو مفتاح هاتف محمول: لا ترسل النسخة إلا تتبعات هذا التطبيق وسجلاته ومقاييسه، محفوظة تحت اسم الخدمة الذي ثُبّت عليه المفتاح، ولا ترسل أبدًا من صفحة ويب. ومع ذلك تستطيع إرسال بيانات مختلقة لهذا التطبيق حتى حد المفتاح، فضع تاريخ انتهاء صلاحية، وبدّل المفتاح مع إصداراتك، وأوقفه إذا أُسيء استخدامه.",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "كل هذا في صفحة المفتاح في **إعدادات المشروع > القياس عن بُعد وAPM > مفاتيح الاستيعاب**: **اسم الخدمة المثبت** هو التطبيق الذي يُحفظ تحته كل ما يرسله المفتاح، و **حد الطلبات في الدقيقة** يقيّد المفتاح عبر كل نسخ تطبيقك، و **تاريخ انتهاء الصلاحية** يوقف قبوله بعد تاريخ معين، و **مفعّل** يوقفه فورًا.",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "لا تشحن أبدًا بدلًا منه مفتاحًا من نوع **الخادم** داخل تطبيق: فهو يستطيع كتابة كل أنواع القياس عن بُعد في هذا المشروع، من أي مكان، وباسم أي خدمة.",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android** — يضبط وكيل [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) (`io.opentelemetry.android:android-agent`) السمات `device.model.identifier` و`device.model.name` و`device.manufacturer` على مورده الخاص، فيعمل التصنيف دون إعداد إضافي، ويُبلغ بنفسه عن الأعطال وANRs والإطارات البطيئة والمتجمدة وبدء التطبيق والجلسات. ويسمّي التطبيق باسم تسمية المشغّل الخاصة به ما لم تضبط `service.name`، ولا يرسل `device.id`. وفي [إعداد Android](/docs/rum/android-setup) تبعية Gradle والشيفرة وما يصبح عليه كل منها في OneUptime.",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift** — مع [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift)، اضبط `device.model.identifier` و`device.manufacturer` على المورد بنفسك: فالمورد الذي تضيفه كل نسخة من SDK تغيّر بين الإصدارات.",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app.":
    "- **React Native / Expo** — يشغّل JavaScript SDK، فالإعداد هو إعداد المتصفح من [إعداد المتصفح](/docs/rum/browser-setup) مع فرقين: لا يوجد `browserDetector`، وتضبط `device.manufacturer` و`device.model.identifier` بنفسك كي تُدرج علامة التبويب **العملاء** الأجهزة. ويرسل بمفتاح من نوع **هاتف محمول** مثل أي تطبيق هاتف محمول.",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **أي شيء آخر** — يعمل Flutter وUnity و.NET MAUI أو كاتب OTLP مكتوب يدويًا بالطريقة نفسها، ما دام المورد يحمل `service.name` وسمة `device.*` واحدة.",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "تغيّر حزم OpenTelemetry SDK للهاتف المحمول واجهات builder الخاصة بها بين الإصدارات. وفي [إعداد الهاتف المحمول](/docs/rum/mobile-setup) شيفرة لكل منها؛ تحقّق من أسماء الدوال مقابل النسخة التي تثبّتها.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "كل سمة مورد تبدأ بالبادئة `oneuptime.label.` تصبح تسمية مشروع على التطبيق — `oneuptime.label.env=production` تضيف التسمية `env:production`:",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **نظرة عامة** — الأحداث ومعدل الأخطاء ومدة p95 خلال نطاق زمني قابل للاختيار، مع مخططات الاتجاه، مستمدة من الامتدادات التي تصدرها أدوات القياس لديك.",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **الاستثناءات** — الأعطال وANRs التي يُبلغ عنها تطبيقك، كاستثناءات غير معالجة، في النظرة العامة وفي **الاستثناءات**. يُبلغ OpenTelemetry Android عن كليهما بنفسه؛ ويُدرج ANR بالنوع `ANR`.",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **العملاء** — طُرز الأجهزة التي شوهد عليها التطبيق، من `device.model.identifier`. عامة حسب الطراز، لا لكل مستخدم نهائي.",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "يعني `401` أن المفتاح غير معروف أو مُلغى أو معطّل أو منتهي الصلاحية: اختر مفتاح هاتف محمول أو أنشئه في الخطوة 1 وأعد بناء التطبيق به.",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and never from a web page: an SDK that exports over gRPC, or a request that carries an `Origin` header, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "يبيّن `422` ما الذي رُفض. لا يرسل مفتاح الهاتف المحمول إلا تتبعات OTLP وسجلاته ومقاييسه للتطبيق، عبر HTTP، ولا يرسل أبدًا من صفحة ويب: فيُرفض SDK يصدّر عبر gRPC، أو طلب يحمل ترويسة `Origin`. ويجتاز مفتاح المتصفح التحقق لكنه يُرفض من تطبيق هاتف محمول، لأنه يحتاج إلى ترويسة `Origin` ولا ترسلها حزم SDK للهاتف المحمول.",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "أُرسل القياس عن بُعد بمفتاح خادم، ولا يحمل مورده `device.id` ولا `device.model.identifier`، فحُفظ كخدمة خلفية. أرسل بمفتاح هاتف محمول (الخطوة 1)، الذي يحفظ كل ما يرسله على أنه هذا التطبيق، أو اضبطهما على مورد SDK كما في الخطوة 2.",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "صفوف العملاء تأتي تحديدًا من `device.model.identifier`. حزمة SDK التي لا تضبط إلا `device.manufacturer` تُصنَّف هاتفًا محمولًا، لكنها لا تُدرج أي عملاء — اضبط `device.model.identifier` أيضًا.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "تتحول الحالة إلى **لا توجد حركة مرور حديثة** بعد 15 دقيقة دون قياس عن بُعد. وهذا متوقع ما دام لا أحد يستخدم التطبيق. وإن كان تطبيقك قيد الاستخدام:",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- ربما أُلغي المفتاح بعد الإصدار — شغّل التحقق من المفتاح في الخطوة 3.",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "قيمة `service.name` هي **`Storefront Mobile`**، معرّف هذا التطبيق — أبقها كما هي، وإلا سُجّلت البيانات كتطبيق جديد. وهي مرمّزة بالنسبة المئوية في `OTEL_RESOURCE_ATTRIBUTES`، وتفكّ حزمة SDK ترميزها.",
};

export default TRANSLATION;
