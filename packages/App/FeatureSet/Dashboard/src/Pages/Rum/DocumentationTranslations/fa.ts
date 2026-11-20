import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in Persian (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * Persian. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "یک اپ وب که بتوانید کدش را تغییر دهید و دوباره مستقر کنید، با وابستگی‌هایی که از npm نصب شده‌اند",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "مبداهایی که سایت شما از آن‌ها ارائه می‌شود، مثلاً `https://app.example.com` — کلید مرورگر فقط درخواست‌هایی را می‌پذیرد که از مبداهای فهرست‌شده روی آن بیایند",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "سپس آن را **اولین** import اپ خود کنید تا ابزارگذاری‌ها پیش از اجرای هر چیز دیگری `fetch` را وصله کنند:",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "`storefront-web` را با نام برنامهٔ خود جایگزین کنید. برنامه با همین نام در OneUptime نمایش داده می‌شود، پس آن را ثابت نگه دارید: نام تازه، برنامهٔ تازه‌ای ثبت می‌کند.",
  "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.":
    "> **فقط تنظیم `service.name` کافی نیست.** SDKهای مرورگر OpenTelemetry ویژگی‌های `browser.*` را اضافه نمی‌کنند مگر اینکه آشکارساز منبع مرورگر را فعال کنید یا خودتان آن‌ها را بگذارید — بدون آن‌ها این یک سرویس بک‌اند می‌شود، نه یک برنامهٔ RUM.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "برای پر شدن `<YOUR_API_KEY>`، در گام 1 یک کلید دریافت داده انتخاب کنید.",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "آن را با دستور `connect-src` موجود خود ادغام کنید. سایت شما Content Security Policy ندارد؟ از این گام بگذرید.",
  '`200` with `"valid": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.':
    '`200` همراه با `"valid": true` یعنی OneUptime کلید را می‌پذیرد — برای کلید مرورگر، پیام اضافه می‌کند که فقط از یک مرورگر و از یکی از مبداهای مجازش کار می‌کند. `401` یعنی کلید ناشناخته، باطل‌شده، غیرفعال یا منقضی است.',
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "سپس یک صفحه از سایت خود را باز کنید. ظرف یک دقیقه برنامه زیر **پایش کاربر واقعی** ظاهر می‌شود، با نام `service.name` خودش، همراه با بازدید صفحه، نرخ خطا و مدت p95.",
  "OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "OneUptime تله‌متری را وقتی **RUM** طبقه‌بندی می‌کند که منبعش ویژگی‌های کلاینت داشته باشد — برای وب، یکی از `browser.platform`، `browser.language` یا یک `browser.brands` غیرخالی. برنامه با `service.name` شناخته می‌شود (بدون حساسیت به بزرگی و کوچکی حروف)، و تله‌متری‌اش متعلق به همین برنامهٔ RUM است — هرگز به‌عنوان یک سرویس بک‌اند تکرار نمی‌شود.",
  "| Attribute | Required | What it does |": "| ویژگی | الزامی | چه می‌کند |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **بله** | هویت برنامه، مثلاً `storefront-web`. تغییر نام بعدی آن یک برنامهٔ تازه می‌سازد. |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **یکی از آن‌ها** | تله‌متری را RUM مرورگر علامت می‌زند. `browser.platform` برگهٔ **کلاینت‌ها** را هم پر می‌کند. |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | خیر | در نمای کلی نشان داده می‌شود |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector` آن‌ها را از مرورگر می‌گذارد. این آشکارساز UA Client Hints API را می‌خواند که فقط مرورگرهای Chromium دارند، پس در Safari و Firefox `browser.language` را می‌گذارد اما `browser.platform` را نه. برای اینکه ویژگی‌ها را خودتان بگذارید — بدون آشکارساز، یا برای اینکه به هر مرورگر یک پلتفرم بدهید — منبع را این‌طور بسازید:",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "`browser.platform` را کلی نگه دارید: هر مقدار متمایز یک ردیف در برگهٔ **کلاینت‌ها** می‌شود.",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "هر چه در قطعه‌کد مرورگر است به دست کاربران شما می‌رسد. توکنِ داخل آن عمومی است — هر کسی که منبع صفحه را ببیند، ابزار توسعه‌دهنده را باز کند یا بستهٔ شما را بخواند می‌تواند آن را کپی کند. برای همین این راهنما فقط کلیدهای دریافت داده از نوع **مرورگر** را فهرست می‌کند و می‌سازد، هر کدام با مبداهایی که سایت شما از آن‌ها ارائه می‌شود:",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- فقط از همان مبداها پذیرفته می‌شود، پس کلید کپی‌شده در صفحهٔ دیگران کار نمی‌کند؛",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- فقط می‌تواند ترِیس‌ها، لاگ‌ها، متریک‌ها، بازپخش‌های نشست و گزارش‌های SDK مرورگر Sentry را بنویسد — نه پروفایل‌ها، source mapها، syslog، Fluent، Pyroscope یا رویدادهای امنیتی؛",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- برای هر کلید محدودیت نرخ دارد، با یک ویرایش خاموش می‌شود و می‌تواند تاریخ انقضا داشته باشد.",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "هر مبدأ شامل طرح و هر پورتی است و می‌تواند با یک wildcard میزبانِ `*.` شروع شود — `https://app.example.com`، `https://*.example.com`. اگر **نام سرویس سنجاق‌شده** را هم روی کلید بگذارید، `service.name` روی هر چه می‌نویسد تحمیل می‌شود، پس کلیدِ کپی‌شده نمی‌تواند تله‌متری‌اش را به نام یکی از سرویس‌های بک‌اند شما جا بزند. هر دو در صفحهٔ کلید در **تنظیمات پروژه > تله‌متری و APM > کلیدهای دریافت داده** هستند.",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **هرگز کلید دریافت دادهٔ سرور را به مرورگر نفرستید.** کلید سرور از هر جایی دسترسی کامل به دریافت داده دارد، بدون بررسی مبدأ. وقتی در منبع صفحه باشد، هر کسی که آن را پیدا کند می‌تواند span، لاگ و متریک جعلی در این پروژه بنویسد — داشبوردها را خراب کند، هشدارهای نادرست بفرستد و مصرف محاسبه‌شدهٔ شما را بالا ببرد — تا وقتی که متوجه شوید و آن را عوض کنید.",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls` تعیین می‌کند کدام درخواست‌های cross-origin سرآیند W3C `traceparent` بگیرند تا span مرورگر به ترِیس بک‌اندی که آغاز کرده وصل شود. درخواست‌های same-origin بدون هیچ پیکربندی منتشر می‌شوند.",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**آن را `/.*/` نگذارید.** افزودن یک سرآیند، درخواست cross-origin سادهٔ را به درخواستی با preflight تبدیل می‌کند، و هر API شخص ثالثی که `traceparent` را در `Access-Control-Allow-Headers` خود فهرست نکرده باشد شروع به شکست می‌کند. فقط مبداهایی را فهرست کنید که در اختیار شماست و پیکربندی کرده‌اید:",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "درخواست‌هایی که با `XMLHttpRequest` به جای `fetch` فرستاده می‌شوند به `@opentelemetry/instrumentation-xml-http-request` و `XMLHttpRequestInstrumentation` آن نیاز دارند، با همان گزینه.",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "SDK مرورگر OpenTelemetry خطاهای مدیریت‌نشده را خودکار ثبت نمی‌کند. آن‌ها را صریحاً گزارش دهید تا کنار خطاهای بک‌اند شما در نمای **استثناها** جمع شوند:",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "ترِیس‌ها برای پر کردن نمای کلی کافی‌اند. اگر می‌خواهید لاگ‌های مرورگر در OneUptime جست‌وجوپذیر باشند، یا Core Web Vitals داشته باشید، پایپ‌لاین لاگ و متریک اضافه کنید:",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object: a pipeline whose resource lacks `browser.*` is filed as a separate backend Service.":
    "اکسپورترهای آن‌ها با همان سرآیند `x-oneuptime-token` به `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` و `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` می‌فرستند — کدش در [راه‌اندازی مرورگر](/docs/rum/browser-setup) است. آن‌ها را با همان شیء `resource` بسازید: پایپ‌لاینی که منبعش `browser.*` ندارد، به‌عنوان یک سرویس بک‌اند جدا ثبت می‌شود.",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "کارت **Core Web Vitals** — LCP، INP، CLS، FCP و TTFB — فقط از متریک‌هایی پر می‌شود که اپ شما گزارش می‌کند، با نام‌هایی مانند `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) نام‌هایی را که OneUptime می‌خواند فهرست می‌کند و کتابخانهٔ `web-vitals` را وصل می‌کند.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "هر ویژگی منبع با پیشوند `oneuptime.label.` به یک برچسب پروژه روی برنامه تبدیل می‌شود — `oneuptime.label.env` با مقدار `production` برچسب `env:production` را اضافه می‌کند:",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "برای هر اپ یک `service.name` به کار ببرید، نه برای هر محیط، و محیط‌ها را با یک برچسب از هم جدا کنید، تا هر اپ یک برنامه و یک تاریخچه داشته باشد.",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "برای برچسب زدن به برنامه‌ها یا تعیین مالک بر اساس نام، از **پایش کاربر واقعی ← تنظیمات ← قواعد برچسب** و **قواعد مالکیت** استفاده کنید. قواعد وقتی برنامه ساخته می‌شود اجرا می‌شوند، از جمله با کشف خودکار؛ برنامه‌هایی را که از قبل وجود دارند دوباره برچسب نمی‌زنند.",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **نمای کلی** — بازدید صفحه، نرخ خطا و مدت p95 در یک بازهٔ زمانی قابل انتخاب، با نمودارهای روند. این‌ها از spanهایی به دست می‌آیند که ابزارگذاری شما می‌فرستد، پس بازدید صفحه همان چیزی است که گزارش می‌کند: بارگذاری سند، تغییر مسیر، تعامل.",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals** — LCP، INP، CLS، FCP و TTFB، وقتی اپ شما آن‌ها را به‌صورت متریک گزارش کند.",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **لاگ‌ها**، **ترِیس‌ها** و **متریک‌ها** — کاوشگرهای تله‌متری، محدود به همین برنامه.",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **کلاینت‌ها** — پلتفرم‌های مرورگری که برنامه روی آن‌ها دیده شده است، از `browser.platform`. کلی بر اساس پلتفرم، هرگز برای هر کاربر نهایی.",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **بازپخش نشست** — یک ضبط‌کنندهٔ جدا و اختیاری با تگ اسکریپت و کنترل‌های حریم خصوصی خودش: [بازپخش نشست](/docs/telemetry/session-replay).",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "برنامه تا وقتی تله‌متری می‌رسد **در حال دریافت داده** را نشان می‌دهد، و پس از 15 دقیقه بدون تله‌متری **بدون ترافیک اخیر** را، که تا وقتی کسی از اپ استفاده نمی‌کند عادی است.",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "DevTools را باز کنید، به برگهٔ **Network** بروید و `otlp` را فیلتر کنید: دنبال `POST /otlp/v1/traces` هستید. نبودِ هیچ درخواستی یعنی SDK هرگز شروع نشده است:",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts` اول import نشده است. ابزارگذاری‌ها `fetch` را وصله می‌کنند؛ هر چه پیش از آن‌ها import شود ترِیس نمی‌شود، و اگر import با tree-shaking حذف شود، اصلاً چیزی اجرا نمی‌شود.",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- پردازشگر دسته‌ای هنوز خالی نشده است. `BatchSpanProcessor` بافر می‌کند — پیش از اینکه نتیجه بگیرید چیزی فرستاده نمی‌شود، حدود 30 ثانیه صبر کنید یا به صفحهٔ دیگری بروید.",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- یک متغیر محیطیِ زمان ساخت به `undefined` تبدیل شده، پس نشانی اکسپورتر نادرست است. آن را یک بار هنگام شروع چاپ کنید.",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **مسدودشده با Content Security Policy** — کنسول همین را می‌گوید. `connect-src 'self' <YOUR_ONEUPTIME_URL>;` را اضافه کنید (گام 4).",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **مسدودشده با CORS** — نقطه‌های پایانی OTLP در OneUptime هر مبدأ و سرآیند `x-oneuptime-token` را مجاز می‌دانند، پس خطای CORS تقریباً همیشه یعنی درخواست اصلاً به OneUptime نمی‌رسد: یک پروکسی سازمانی، یک مسدودکنندهٔ تبلیغات یا یک غلط تایپی در میزبان.",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`** — مبدأ دقیق سایت خود (طرح، میزبان و پورت) را به **مبداهای مجاز** کلید در **تنظیمات پروژه > تله‌متری و APM > کلیدهای دریافت داده** اضافه کنید.",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`** — کلید را همان‌جا دوباره روشن کنید، یا در گام 1 کلید دیگری انتخاب کنید.",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`** — کلید ناشناخته، باطل‌شده یا منقضی است. بررسی کلید را در گام 5 اجرا کنید، و در گام 1 یک کلید مرورگر معتبر انتخاب کنید یا بسازید.",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`** — نشانی نادرست است. اکسپورتر ترِیس مسیر کامل `/otlp/v1/traces` را لازم دارد.",
  "The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable `browserDetector` as in step 3, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "منبع هیچ ویژگی مرورگری ندارد، پس تله‌متری به‌عنوان یک سرویس بک‌اند ثبت شد. `browserDetector` را مانند گام 3 فعال کنید، یا ویژگی‌های `browser.*` را خودتان بگذارید (**OneUptime چگونه یک برنامه مرورگری را تشخیص می‌دهد** در پیشرفته).",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "آنچه می‌فرستید را در DevTools بررسی کنید: برگهٔ **Network**، درخواست OTLP و سپس **Payload**. `resourceSpans[0].resource.attributes` همان فهرستی است که تصمیم را می‌گیرد.",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "سرویسی که از قبل ساخته شده به برنامهٔ RUM تبدیل نمی‌شود — این دو رکوردهای جدا هستند — پس وقتی تله‌متری RUM رسید آن را حذف کنید.",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "ردیف‌های کلاینت از `browser.platform` می‌آیند. `browserDetector` UA Client Hints API را می‌خواند که فقط مرورگرهای Chromium دارند: در Safari و Firefox `browser.language` را می‌گذارد — که برای طبقه‌بندی تله‌متری به‌عنوان RUM کافی است — اما `browser.platform` را نه. برای فهرست شدن آن کلاینت‌ها `browser.platform` را خودتان بگذارید (**OneUptime چگونه یک برنامه مرورگری را تشخیص می‌دهد** در پیشرفته).",
  "The card is filled only from metrics your app emits. Check, in order:":
    "کارت فقط از متریک‌هایی پر می‌شود که اپ شما می‌فرستد. به ترتیب بررسی کنید:",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. اصلاً یک پایپ‌لاین **متریک** دارید — ترِیس‌ها به‌تنهایی هرگز این کارت را پر نمی‌کنند.",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. نام متریک‌ها همان‌هایی است که OneUptime می‌خواند — [Core Web Vitals](/docs/rum/web-vitals) را ببینید.",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. متریک‌ها در برگهٔ **متریک‌ها** برنامه دیده می‌شوند. اگر دیده شوند، اکسپورت کار می‌کند و مشکل از نام یا بازهٔ انتخاب‌شده است.",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP و CLS وقتی گزارش می‌شوند که صفحه پنهان شود، پس یک بازدید کوتاه ممکن است پیش از اکسپورت بعدی تمام شود.",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **بازهٔ زمانی را بررسی کنید.** نمای کلی به‌طور پیش‌فرض یک ساعت گذشته را نشان می‌دهد، پس آزمایش امروز صبح بیرون از آن است.",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **یک دقیقه صبر کنید.** دریافت داده در صف است و نمایش یک span آزمایشی ممکن است تا یک دقیقه طول بکشد.",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **پروژه را بررسی کنید.** کلید تعیین می‌کند تله‌متری در کدام پروژه ثبت شود.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "وضعیت پس از 15 دقیقه بدون تله‌متری به **بدون ترافیک اخیر** تغییر می‌کند. تا وقتی کسی از اپ استفاده نمی‌کند این طبیعی است. اگر اپ شما ترافیک دارد:",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- شاید یک **sampler** همه چیز را دور بریزد — بررسی کنید که sampler همیشه‌خاموش یا با نسبت بسیار پایین تنظیم نکرده باشید.",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- شاید اپ فقط با تعامل‌هایی بفرستد که در آن بازه کسی انجام نداده است.",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- شاید کلید پس از استقرار باطل شده باشد — بررسی کلید را در گام 5 اجرا کنید.",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name` برابر **`storefront-web`** است، شناسهٔ همین برنامه — آن را همان‌طور نگه دارید، وگرنه داده‌ها به‌عنوان برنامهٔ تازه‌ای ثبت می‌شوند.",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "یک اپ iOS، Android یا React Native با یک SDK اوپن‌تلمتری — opentelemetry-swift، OpenTelemetry Android یا SDK جاوااسکریپت OpenTelemetry",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "`service.name`‌ای که اپ شما گزارش می‌کند — کلید **موبایل** گام 1 به آن سنجاق شده است",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "این‌ها تنظیمات استاندارد OpenTelemetry هستند: SDKای که آن‌ها را از محیطش می‌خواند همان‌طور که هستند می‌پذیرد. در غیر این صورت همان نقطه پایانی، سرآیند `x-oneuptime-token` و ویژگی‌های منبع را در کد روی اکسپورتر OTLP و منبع SDK بگذارید — [راه‌اندازی موبایل](/docs/rum/mobile-setup) این کار را برای Android، iOS و React Native نشان می‌دهد.",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "بیشتر SDKهای موبایل ویژگی‌های `device.*` را برای شما می‌گذارند. `device.model.identifier` برگهٔ **کلاینت‌ها** را پر می‌کند، پس اگر SDK شما این کار را نمی‌کند آن را مانند بالا بگذارید.",
  '`200` with `"valid": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.':
    '`200` همراه با `"valid": true` یعنی OneUptime کلید را می‌پذیرد، و برای کلید موبایل، پیام اضافه می‌کند که فقط از یک اپ موبایل کار می‌کند. `401` یعنی کلید ناشناخته، باطل‌شده، غیرفعال یا منقضی است و هیچ پیکربندی SDK مشکل را حل نمی‌کند.',
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "سپس اپ را اجرا کنید. با اولین دستهٔ تله‌متری زیر **پایش کاربر واقعی** ظاهر می‌شود، با نام سرویسی که کلید به آن سنجاق شده است.",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "هر چه کلید موبایل بفرستد، به‌عنوان همین اپ موبایل و زیر نام سرویسی که کلید به آن سنجاق شده ثبت می‌شود، هر چه منبعش بگوید. کلید از منبع فقط آنچه را نگه می‌دارد که اپ دربارهٔ خودش می‌گوید — مانند ویژگی‌های `service.*`، `device.*`، `os.*` و `telemetry.*` و برچسب‌های `oneuptime.label.*` آن — و بقیه را دور می‌ریزد، پس کلیدِ کپی‌شده نمی‌تواند تله‌متری‌اش را به نام یک میزبان، یک خوشه یا یک سرویس بک‌اند جا بزند.",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "با هر کلید دیگری، OneUptime تله‌متری را وقتی **RUM موبایل** طبقه‌بندی می‌کند که منبعش `device.id` یا `device.model.identifier` داشته باشد. برنامه با `service.name` شناخته می‌شود (بدون حساسیت به بزرگی و کوچکی حروف)، و تله‌متری‌اش متعلق به همین برنامهٔ RUM است — هرگز به‌عنوان یک سرویس بک‌اند تکرار نمی‌شود.",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **یکی از آن‌ها** | تله‌متری را RUM موبایل علامت می‌زند. `device.model.identifier` برگهٔ **کلاینت‌ها** را هم پر می‌کند. |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "`device.manufacturer` هم یک دسته را موبایل علامت می‌زند، اما فقط روی منبعی که `host.name` یا `host.id` ندارد — چون در مورد موجودی یک میزبان، سازندهٔ یک ماشین فیزیکی هم هست. `device.id` یا `device.model.identifier` را هم بگذارید تا این تمایز هرگز پیش نیاید.",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id` باید شناسه‌ای در حد یک نصب باشد، نه شناسهٔ تبلیغاتی یا هر چیزی که یک شخص را شناسایی کند.",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs and metrics, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **هر کسی که اپ شما را دارد می‌تواند کلیدش را کپی کند.** برای همین کلید موبایل است: یک کپی فقط می‌تواند ترِیس‌ها، لاگ‌ها و متریک‌های همین اپ را بفرستد، زیر نام سرویسی که کلید به آن سنجاق شده، و هرگز از یک صفحه وب. با این حال می‌تواند تا سقف محدودیت کلید دادهٔ ساختگی برای این اپ بفرستد، پس تاریخ انقضا بگذارید، کلید را با هر انتشار عوض کنید و اگر سوءاستفاده شد خاموشش کنید.",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "هر کدام از این‌ها در صفحهٔ کلید در **تنظیمات پروژه > تله‌متری و APM > کلیدهای دریافت داده** است: **نام سرویس سنجاق‌شده** اپی است که هر چه کلید می‌فرستد زیر آن ثبت می‌شود، **محدودیت درخواست در دقیقه** سقف کلید در همهٔ نسخه‌های اپ شماست، **تاریخ انقضا** پذیرش آن را پس از یک تاریخ متوقف می‌کند، و **فعال** آن را فوراً خاموش می‌کند.",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "هرگز به جایش کلید **سرور** را در یک اپ منتشر نکنید: می‌تواند هر نوع تله‌متری را از هر جا و به نام هر سرویسی در این پروژه بنویسد.",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android** — عامل [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) (`io.opentelemetry.android:android-agent`) ویژگی‌های `device.model.identifier`، `device.model.name` و `device.manufacturer` را روی منبع خودش می‌گذارد، پس طبقه‌بندی بدون پیکربندی اضافه کار می‌کند، و خودش crashها، ANRها، فریم‌های کند و یخ‌زده، شروع اپ و نشست‌ها را گزارش می‌کند. اگر `service.name` را نگذارید، اپ را با برچسب لانچرش نام‌گذاری می‌کند و هیچ `device.id` نمی‌فرستد. [راه‌اندازی Android](/docs/rum/android-setup) وابستگی Gradle، کد و اینکه هر کدام در OneUptime چه می‌شود را دارد.",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift** — با [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift)، `device.model.identifier` و `device.manufacturer` را خودتان روی منبع بگذارید: منبعی که هر نسخهٔ SDK اضافه می‌کند بین نسخه‌ها تغییر کرده است.",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app.":
    "- **React Native / Expo** — SDK جاوااسکریپت را اجرا می‌کند، پس راه‌اندازی همان راه‌اندازی مرورگر در [راه‌اندازی مرورگر](/docs/rum/browser-setup) است با دو تفاوت: `browserDetector` در کار نیست، و `device.manufacturer` و `device.model.identifier` را خودتان می‌گذارید تا برگهٔ **کلاینت‌ها** دستگاه‌ها را فهرست کند. مانند هر اپ موبایلی با کلید **موبایل** می‌فرستد.",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **هر چیز دیگر** — Flutter، Unity، .NET MAUI یا یک نویسندهٔ OTLP دست‌ساز به همین شکل کار می‌کنند، به شرط اینکه منبع `service.name` به‌علاوهٔ یک ویژگی `device.*` داشته باشد.",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "SDKهای موبایل OpenTelemetry APIهای سازندهٔ خود را بین نسخه‌ها تغییر می‌دهند. [راه‌اندازی موبایل](/docs/rum/mobile-setup) برای هر کدام کد دارد؛ نام متدها را با نسخه‌ای که ثابت می‌کنید مقایسه کنید.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "هر ویژگی منبع با پیشوند `oneuptime.label.` به یک برچسب پروژه روی برنامه تبدیل می‌شود — `oneuptime.label.env=production` برچسب `env:production` را اضافه می‌کند:",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **نمای کلی** — رویدادها، نرخ خطا و مدت p95 در یک بازهٔ زمانی قابل انتخاب، با نمودارهای روند، برگرفته از spanهایی که ابزارگذاری شما می‌فرستد.",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **استثناها** — crashها و ANRهایی که اپ شما گزارش می‌کند، به‌صورت استثناهای مدیریت‌نشده، در نمای کلی و در **استثناها**. OpenTelemetry Android هر دو را خودش گزارش می‌کند؛ ANR با نوع `ANR` فهرست می‌شود.",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **کلاینت‌ها** — مدل‌های دستگاهی که برنامه روی آن‌ها دیده شده است، از `device.model.identifier`. کلی بر اساس مدل، هرگز برای هر کاربر نهایی.",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "`401` یعنی کلید ناشناخته، باطل‌شده، غیرفعال یا منقضی است: در گام 1 یک کلید موبایل انتخاب کنید یا بسازید و اپ را با آن دوباره بسازید.",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and never from a web page: an SDK that exports over gRPC, or a request that carries an `Origin` header, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "`422` می‌گوید چه چیزی رد شد. کلید موبایل فقط ترِیس‌ها، لاگ‌ها و متریک‌های OTLP اپ را روی HTTP می‌فرستد، و هرگز از یک صفحه وب: SDKای که روی gRPC اکسپورت می‌کند، یا درخواستی که سرآیند `Origin` دارد، رد می‌شود. کلید مرورگر از بررسی می‌گذرد اما از اپ موبایل رد می‌شود، چون به سرآیند `Origin` نیاز دارد و SDKهای موبایل آن را نمی‌فرستند.",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "تله‌متری با کلید سرور فرستاده شده و منبعش `device.id` یا `device.model.identifier` ندارد، پس به‌عنوان یک سرویس بک‌اند ثبت شد. با کلید موبایل (گام 1) بفرستید که هر چه می‌فرستد به‌عنوان همین اپ ثبت می‌کند، یا آن‌ها را مانند گام 2 روی منبع SDK بگذارید.",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "ردیف‌های کلاینت مشخصاً از `device.model.identifier` می‌آیند. SDKای که فقط `device.manufacturer` را می‌گذارد موبایل طبقه‌بندی می‌شود، اما هیچ کلاینتی فهرست نمی‌کند — `device.model.identifier` را هم بگذارید.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "وضعیت پس از 15 دقیقه بدون تله‌متری به **بدون ترافیک اخیر** تغییر می‌کند. تا وقتی کسی از اپ استفاده نمی‌کند این طبیعی است. اگر اپ شما در حال استفاده است:",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- شاید کلید پس از انتشار باطل شده باشد — بررسی کلید را در گام 3 اجرا کنید.",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name` برابر **`Storefront Mobile`** است، شناسهٔ همین برنامه — آن را همان‌طور نگه دارید، وگرنه داده‌ها به‌عنوان برنامهٔ تازه‌ای ثبت می‌شوند. این مقدار در `OTEL_RESOURCE_ATTRIBUTES` درصدکدگذاری شده است و SDK آن را رمزگشایی می‌کند.",
};

export default TRANSLATION;
