import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in Russian (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * Russian. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "Веб-приложение, код которого вы можете изменить и развернуть заново, с зависимостями, установленными через npm",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "Источники, с которых обслуживается ваш сайт, например `https://app.example.com` — ключ браузера принимает запросы только из источников, которые вы в нём укажете",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "Затем сделайте его **первым** импортом приложения, чтобы инструментирование подменило `fetch` до того, как запустится что-либо ещё:",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "Замените `storefront-web` на имя вашего приложения. Под этим именем приложение появляется в OneUptime, поэтому не меняйте его: новое имя регистрирует новое приложение.",
  "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.":
    "> **Одного `service.name` недостаточно.** Браузерные SDK OpenTelemetry не добавляют атрибуты `browser.*`, если вы не включите детектор ресурсов браузера или не зададите их сами — без них это станет бэкенд-сервисом, а не приложением RUM.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Выберите ключ приёма на шаге 1, чтобы заполнить `<YOUR_API_KEY>`.",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "Объедините его с существующей директивой `connect-src`. У вашего сайта нет Content Security Policy? Пропустите этот шаг.",
  "`200` with `\"valid\": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.":
    "`200` с `\"valid\": true` означает, что OneUptime принимает ключ — для ключа браузера сообщение добавляет, что он работает только из браузера, с одного из разрешённых источников. `401` означает, что ключ неизвестен, отозван, отключён или истёк.",
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "Затем загрузите страницу своего сайта. В течение минуты приложение появится в разделе **Мониторинг реальных пользователей** под именем из своего `service.name`, с просмотрами страниц, долей ошибок и длительностью p95.",
  "OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "OneUptime относит телеметрию к **RUM**, когда её ресурс содержит атрибуты клиента — для веба любой из `browser.platform`, `browser.language` или непустой `browser.brands`. Приложение определяется по `service.name` (без учёта регистра), и его телеметрия принадлежит этому приложению RUM — она никогда не дублируется как бэкенд-сервис.",
  "| Attribute | Required | What it does |":
    "| Атрибут | Обязателен | Что делает |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **да** | Идентификатор приложения, например `storefront-web`. Переименование позже создаёт новое приложение. |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **один из них** | Помечает телеметрию как браузерный RUM. `browser.platform` также заполняет вкладку **Клиенты**. |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | нет | Показывается в обзоре |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector` задаёт их по данным браузера. Он читает API UA Client Hints, который есть только в браузерах на Chromium, поэтому в Safari и Firefox он задаёт `browser.language`, но не `browser.platform`. Чтобы задать атрибуты самостоятельно — без детектора или чтобы у каждого браузера была платформа, — постройте ресурс так:",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "Делайте `browser.platform` обобщённым: каждое отдельное значение становится строкой на вкладке **Клиенты**.",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "Всё во фрагменте для браузера попадает к вашим пользователям. Токен в нём публичен — его может скопировать любой, кто посмотрит исходный код, откроет инструменты разработчика или прочитает ваш бандл. Поэтому это руководство показывает и создаёт только ключи приёма типа **Браузер**, каждый с источниками, с которых обслуживается ваш сайт:",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- он принимается только из этих источников, поэтому скопированный ключ не работает на чужой странице;",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- он может записывать только трассировки, журналы, метрики, воспроизведения сеансов и отчёты браузерного SDK Sentry — не профили, source maps, syslog, Fluent, Pyroscope или события безопасности;",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- у него есть ограничение частоты для каждого ключа, его можно отключить одной правкой и задать ему срок действия.",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "Источник включает схему и порт, если он есть, и может начинаться с одного подстановочного знака хоста `*.` — `https://app.example.com`, `https://*.example.com`. Если задать на ключе ещё и **Закреплённое имя сервиса**, `service.name` принудительно устанавливается для всего, что он пишет, поэтому скопированный ключ не может выдать свою телеметрию за один из ваших бэкенд-сервисов. Оба параметра находятся на странице ключа в разделе **Настройки проекта > Телеметрия и APM > Ключи приёма**.",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **Никогда не отдавайте браузеру серверный ключ приёма.** У ключа сервера полный доступ к приёму откуда угодно, без проверки источника. Попав в исходный код страницы, он позволяет любому, кто его найдёт, записывать в этот проект поддельные спаны, журналы и метрики — засоряя дашборды, вызывая ложные оповещения и увеличивая ваше оплачиваемое потребление, — пока вы не заметите это и не замените его.",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls` определяет, какие запросы к другим источникам получают заголовок W3C `traceparent`, связывающий спан браузера с трассировкой бэкенда, которую он вызвал. Запросы к тому же источнику передают его без какой-либо настройки.",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**Не задавайте `/.*/`.** Дополнительный заголовок превращает простой запрос к другому источнику в запрос с предварительной проверкой (preflight), и любой сторонний API, у которого `traceparent` нет в `Access-Control-Allow-Headers`, начнёт отвечать ошибкой. Указывайте только источники, которые вы контролируете и настроили:",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "Запросам через `XMLHttpRequest` вместо `fetch` нужны `@opentelemetry/instrumentation-xml-http-request` и его `XMLHttpRequestInstrumentation` с тем же параметром.",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "Браузерный SDK OpenTelemetry не перехватывает необработанные ошибки автоматически. Сообщайте о них явно, чтобы они попадали в представление **Исключения** рядом с ошибками бэкенда:",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "Трассировок достаточно, чтобы заполнить обзор. Добавьте конвейеры журналов и метрик, если вам нужны журналы браузера с поиском в OneUptime или Core Web Vitals:",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object: a pipeline whose resource lacks `browser.*` is filed as a separate backend Service.":
    "Их экспортёры отправляют данные на `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` и `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` с тем же заголовком `x-oneuptime-token` — код приведён на странице [Настройка браузера](/docs/rum/browser-setup). Стройте их с тем же объектом `resource`: конвейер, у ресурса которого нет `browser.*`, сохраняется как отдельный бэкенд-сервис.",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "Карточка **Core Web Vitals** — LCP, INP, CLS, FCP и TTFB — заполняется только метриками, которые передаёт ваше приложение, с именами вроде `web_vital.lcp`. На странице [Core Web Vitals](/docs/rum/web-vitals) перечислены имена, которые читает OneUptime, и показано подключение библиотеки `web-vitals`.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "Любой атрибут ресурса с префиксом `oneuptime.label.` становится меткой проекта на приложении — `oneuptime.label.env` со значением `production` добавляет метку `env:production`:",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "Используйте один `service.name` на приложение, а не на окружение, и различайте окружения меткой, чтобы каждое приложение оставалось одним приложением с одной историей.",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "Чтобы помечать приложения или назначать владельцев по имени, используйте **Мониторинг реальных пользователей → Настройки → Правила меток** и **Правила владельца**. Правила выполняются при создании приложения, в том числе при автоматическом обнаружении; существующие приложения они заново не помечают.",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **Обзор** — просмотры страниц, доля ошибок и длительность p95 за выбираемый период, с графиками трендов. Они выводятся из спанов, которые генерирует ваше инструментирование, поэтому просмотр страницы — это то, что оно передаёт: загрузки документа, смены маршрута, взаимодействия.",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals** — LCP, INP, CLS, FCP и TTFB, когда ваше приложение передаёт их как метрики.",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **Журналы**, **Трассировки** и **Метрики** — обозреватели телеметрии, ограниченные этим приложением.",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **Клиенты** — браузерные платформы, на которых было замечено приложение, из `browser.platform`. Обобщённо по платформе, никогда по отдельному пользователю.",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **Воспроизведение сеансов** — отдельный необязательный рекордер со своим тегом скрипта и своими настройками конфиденциальности: [Воспроизведение сеансов](/docs/telemetry/session-replay).",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "Приложение показывает **Данные поступают**, пока телеметрия продолжает приходить, и **Нет недавнего трафика** после 15 минут без неё, что нормально, пока приложением никто не пользуется.",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "Откройте DevTools → **Network** и отфильтруйте по `otlp`: вы ищете `POST /otlp/v1/traces`. Если запросов нет вообще, SDK так и не запустился:",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts` импортируется не первым. Инструментирование подменяет `fetch`; то, что импортировано раньше, не трассируется, а если tree-shaking удалит импорт, не запустится вообще ничего.",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- Пакетный процессор ещё не сбросил буфер. `BatchSpanProcessor` буферизует данные — подождите около 30 секунд или перейдите на другую страницу, прежде чем решить, что ничего не отправляется.",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- Переменная окружения при сборке оказалась `undefined`, поэтому URL экспортёра неверен. Выведите его один раз при запуске.",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **Заблокировано Content Security Policy** — об этом сообщает консоль. Добавьте `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (шаг 4).",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **Заблокировано CORS** — конечные точки OTLP в OneUptime разрешают любой источник и заголовок `x-oneuptime-token`, поэтому ошибка CORS почти всегда означает, что запрос вообще не доходит до OneUptime: корпоративный прокси, блокировщик рекламы или опечатка в имени хоста.",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`** — добавьте точный источник вашего сайта (схему, хост и порт) в **Разрешённые источники** ключа в разделе **Настройки проекта > Телеметрия и APM > Ключи приёма**.",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`** — снова включите там ключ или выберите другой ключ на шаге 1.",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`** — ключ неизвестен, отозван или истёк. Выполните проверку ключа на шаге 5 и выберите или создайте действующий ключ браузера на шаге 1.",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`** — неверный URL. Экспортёру трассировок нужен полный путь, `/otlp/v1/traces`.",
  "The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable `browserDetector` as in step 3, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "У ресурса нет ни одного атрибута браузера, поэтому телеметрия сохранена как бэкенд-сервис. Включите `browserDetector`, как на шаге 3, или задайте атрибуты `browser.*` сами (**Как OneUptime распознаёт браузерное приложение** в разделе «Расширенный»).",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "Проверьте, что вы отправляете, в DevTools → **Network** → запрос OTLP → **Payload**: решает список `resourceSpans[0].resource.attributes`.",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "Уже созданный сервис не превратится в приложение RUM — это две отдельные записи, — поэтому удалите его, когда начнёт поступать телеметрия RUM.",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "Строки клиентов берутся из `browser.platform`. `browserDetector` читает API UA Client Hints, который есть только в браузерах на Chromium: в Safari и Firefox он задаёт `browser.language` — этого достаточно, чтобы отнести телеметрию к RUM, — но не `browser.platform`. Задайте `browser.platform` сами, чтобы эти клиенты появились в списке (**Как OneUptime распознаёт браузерное приложение** в разделе «Расширенный»).",
  "The card is filled only from metrics your app emits. Check, in order:":
    "Карточка заполняется только метриками, которые генерирует ваше приложение. Проверьте по порядку:",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. У вас вообще есть конвейер **метрик** — одни трассировки никогда не заполняют эту карточку.",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. Имена метрик — из тех, что читает OneUptime, см. [Core Web Vitals](/docs/rum/web-vitals).",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. Метрики появляются на вкладке **Метрики** приложения. Если появляются, экспорт работает, и проблема в имени или в выбранном периоде.",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP и CLS передаются, когда страница скрывается, поэтому короткий визит может закончиться до следующего экспорта.",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **Проверьте период.** Обзор по умолчанию показывает последний час, поэтому утренний тест в него не попадает.",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **Подождите минуту.** Приём идёт через очередь, и одиночному тестовому спану может понадобиться до минуты, чтобы появиться.",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **Проверьте проект.** Ключ определяет, в какой проект попадёт телеметрия.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "Статус меняется на **Нет недавнего трафика** после 15 минут без телеметрии. Это ожидаемо, пока приложением никто не пользуется. Если у вашего приложения есть трафик:",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- **Сэмплер** может отбрасывать всё — проверьте, что вы не задали сэмплер, который всегда выключен или имеет очень низкую долю.",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- Приложение может отправлять данные только при взаимодействиях, которых в этот промежуток никто не совершал.",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- Ключ могли отозвать после развёртывания — выполните проверку ключа на шаге 5.",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name` — **`storefront-web`**, идентификатор этого приложения: оставьте его как есть, иначе данные зарегистрируются как новое приложение.",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "Приложение iOS, Android или React Native с SDK OpenTelemetry — opentelemetry-swift, OpenTelemetry Android или JavaScript SDK OpenTelemetry",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "`service.name`, который передаёт ваше приложение, — ключ типа **Мобильный** из шага 1 закреплён за ним",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "Это стандартные настройки OpenTelemetry: SDK, который читает их из своего окружения, принимает их как есть. Иначе задайте в коде ту же конечную точку, заголовок `x-oneuptime-token` и атрибуты ресурса для экспортёра OTLP и ресурса SDK — на странице [Настройка мобильного приложения](/docs/rum/mobile-setup) это показано для Android, iOS и React Native.",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "Большинство мобильных SDK задают атрибуты `device.*` за вас. `device.model.identifier` заполняет вкладку **Клиенты**, поэтому задайте его, как показано выше, если ваш SDK этого не делает.",
  "`200` with `\"valid\": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.":
    "`200` с `\"valid\": true` означает, что OneUptime принимает ключ, а для мобильного ключа сообщение добавляет, что он работает только из мобильного приложения. `401` означает, что ключ неизвестен, отозван, отключён или истёк, и никакая настройка SDK этого не исправит.",
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "Затем запустите приложение. Оно появится в разделе **Мониторинг реальных пользователей** с первым пакетом телеметрии, под именем сервиса, за которым закреплён ключ.",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "Всё, что отправляет мобильный ключ, сохраняется как это мобильное приложение, под именем сервиса, за которым закреплён ключ, что бы ни говорил его ресурс. Из ресурса ключ сохраняет только то, что приложение сообщает о себе, — например, его атрибуты `service.*`, `device.*`, `os.*` и `telemetry.*` и метки `oneuptime.label.*` — и отбрасывает остальное, поэтому скопированный ключ не может выдать свою телеметрию за хост, кластер или бэкенд-сервис.",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "С любым другим ключом OneUptime относит телеметрию к **мобильному RUM**, когда её ресурс содержит `device.id` или `device.model.identifier`. Приложение определяется по `service.name` (без учёта регистра), и его телеметрия принадлежит этому приложению RUM — она никогда не дублируется как бэкенд-сервис.",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **один из них** | Помечает телеметрию как мобильный RUM. `device.model.identifier` также заполняет вкладку **Клиенты**. |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "`device.manufacturer` тоже помечает пакет как мобильный, но только на ресурсе без `host.name` и `host.id` — он также указывает производителя физической машины в записи инвентаря хоста. Задайте ещё `device.id` или `device.model.identifier`, и этот вопрос никогда не возникнет.",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id` должен быть идентификатором установки, а не рекламным ID и не чем-либо, что идентифицирует человека.",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs and metrics, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **Любой, у кого есть ваше приложение, может скопировать его ключ.** Поэтому это мобильный ключ: копия может отправлять только трассировки, журналы и метрики этого приложения, сохраняемые под именем сервиса, за которым закреплён ключ, и никогда — с веб-страницы. Она всё ещё может отправлять выдуманные данные для этого приложения в пределах лимита ключа, поэтому задайте срок действия, меняйте ключ с каждым релизом и отключите его при злоупотреблении.",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "Всё это находится на странице ключа в разделе **Настройки проекта > Телеметрия и APM > Ключи приёма**: **Закреплённое имя сервиса** — это приложение, под которым сохраняется всё, что отправляет ключ, **Лимит запросов в минуту** ограничивает ключ по всем копиям вашего приложения, **Истекает в** прекращает его приём после указанной даты, а **Включено** сразу его отключает.",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "Никогда не поставляйте в приложении вместо него ключ типа **Сервер**: он может записывать в этот проект телеметрию любого вида, откуда угодно, от имени любого сервиса.",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android** — агент [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) (`io.opentelemetry.android:android-agent`) задаёт `device.model.identifier`, `device.model.name` и `device.manufacturer` в собственном ресурсе, поэтому классификация работает без дополнительной настройки, и сам сообщает о сбоях, ANR, медленных и зависших кадрах, запусках приложения и сеансах. Он называет приложение по его метке в лаунчере, если вы не задали `service.name`, и не отправляет `device.id`. На странице [Настройка Android](/docs/rum/android-setup) есть зависимость Gradle, код и то, чем каждое из них становится в OneUptime.",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift** — с [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift) задайте `device.model.identifier` и `device.manufacturer` в ресурсе сами: набор атрибутов ресурса, который добавляет версия SDK, менялся от релиза к релизу.",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app.":
    "- **React Native / Expo** — использует JavaScript SDK, поэтому настройка та же, что для браузера на странице [Настройка браузера](/docs/rum/browser-setup), с двумя отличиями: `browserDetector` нет, а `device.manufacturer` и `device.model.identifier` вы задаёте сами, чтобы на вкладке **Клиенты** появились устройства. Он отправляет данные с ключом типа **Мобильный**, как любое мобильное приложение.",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **Всё остальное** — Flutter, Unity, .NET MAUI или написанный вручную отправитель OTLP работают так же, если в ресурсе есть `service.name` и один атрибут `device.*`.",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "Мобильные SDK OpenTelemetry меняют свои API построителей от релиза к релизу. На странице [Настройка мобильного приложения](/docs/rum/mobile-setup) есть код для каждого; сверяйте имена методов с версией, которую вы закрепили.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "Любой атрибут ресурса с префиксом `oneuptime.label.` становится меткой проекта на приложении — `oneuptime.label.env=production` добавляет метку `env:production`:",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **Обзор** — события, доля ошибок и длительность p95 за выбираемый период, с графиками трендов, выведенные из спанов, которые генерирует ваше инструментирование.",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **Исключения** — сбои и ANR, о которых сообщает ваше приложение, как необработанные исключения, в обзоре и в разделе **Исключения**. OpenTelemetry Android сообщает и о том, и о другом сам; ANR отображается с типом `ANR`.",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **Клиенты** — модели устройств, на которых было замечено приложение, из `device.model.identifier`. Обобщённо по модели, никогда по отдельному пользователю.",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "`401` означает, что ключ неизвестен, отозван, отключён или истёк: выберите или создайте мобильный ключ на шаге 1 и пересоберите приложение с ним.",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and never from a web page: an SDK that exports over gRPC, or a request that carries an `Origin` header, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "`422` сообщает, что было отклонено. Мобильный ключ отправляет только трассировки, журналы и метрики OTLP приложения, по HTTP, и никогда — с веб-страницы: SDK, экспортирующий по gRPC, или запрос с заголовком `Origin` отклоняются. Ключ браузера проходит проверку, но отклоняется из мобильного приложения, потому что требует заголовок `Origin`, а мобильные SDK его не отправляют.",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "Телеметрия отправлена с ключом сервера, и в её ресурсе нет ни `device.id`, ни `device.model.identifier`, поэтому она сохранена как бэкенд-сервис. Отправляйте с мобильным ключом (шаг 1), который сохраняет всё отправленное как это приложение, или задайте их в ресурсе SDK, как на шаге 2.",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "Строки клиентов берутся именно из `device.model.identifier`. SDK, который задаёт только `device.manufacturer`, классифицируется как мобильный, но клиентов не показывает — задайте также `device.model.identifier`.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "Статус меняется на **Нет недавнего трафика** после 15 минут без телеметрии. Это ожидаемо, пока приложением никто не пользуется. Если приложение используется:",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- Ключ могли отозвать после релиза — выполните проверку ключа на шаге 3.",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name` — **`Storefront Mobile`**, идентификатор этого приложения: оставьте его как есть, иначе данные зарегистрируются как новое приложение. В `OTEL_RESOURCE_ATTRIBUTES` он закодирован в процентной кодировке, и SDK его декодирует.",
};

export default TRANSLATION;
