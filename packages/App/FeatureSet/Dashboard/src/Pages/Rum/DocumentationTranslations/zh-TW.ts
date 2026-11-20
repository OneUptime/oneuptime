import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in Traditional Chinese (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * Traditional Chinese. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "一個您可以修改程式碼並重新部署的網頁應用程式，相依套件透過 npm 安裝",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "您的網站所使用的來源，例如 `https://app.example.com`——瀏覽器金鑰只接受來自您在其上列出的來源的請求",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "然後將它設為應用程式的**第一個**匯入，這樣檢測會在其他任何程式碼執行之前修補 `fetch`：",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "將 `storefront-web` 替換為您的應用程式名稱。應用程式在 OneUptime 中以此名稱顯示，因此請保持不變：新名稱會註冊為新的應用程式。",
  "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.":
    "> **僅設定 `service.name` 是不夠的**。OpenTelemetry 瀏覽器 SDK 不會加入 `browser.*` 屬性，除非您啟用瀏覽器資源偵測器或自行設定——沒有這些屬性，它會成為後端服務，而不是 RUM 應用程式。",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "在步驟 1 中選擇一個擷取金鑰來填入 `<YOUR_API_KEY>`。",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "將它合併到您現有的 `connect-src` 指令中。您的網站沒有 Content Security Policy？請略過此步驟。",
  "`200` with `\"valid\": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.":
    "`200` 加上 `\"valid\": true` 表示 OneUptime 接受該金鑰——對於瀏覽器金鑰，訊息還會說明它只能在瀏覽器中、從其允許的來源之一使用。`401` 表示該金鑰不明、已撤銷、已停用或已到期。",
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "然後載入您網站的一個頁面。一分鐘內，該應用程式會以其 `service.name` 命名出現在**真實使用者監測**中，並顯示頁面瀏覽量、錯誤率和 p95 持續時間。",
  "OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "當資源帶有用戶端屬性時，OneUptime 會將遙測歸類為 **RUM**——對於網頁，即 `browser.platform`、`browser.language` 或非空的 `browser.brands` 中的任一個。應用程式以 `service.name`（不區分大小寫）識別，其遙測屬於此 RUM 應用程式——絕不會再以後端服務的形式重複儲存。",
  "| Attribute | Required | What it does |":
    "| 屬性 | 必要 | 作用 |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **是** | 應用程式的識別，例如 `storefront-web`。之後重新命名會建立新的應用程式。 |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **其中之一** | 將遙測標記為瀏覽器 RUM。`browser.platform` 也會填入**用戶端**分頁。 |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | 否 | 顯示於概覽中 |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector` 會從瀏覽器設定這些屬性。它讀取只有 Chromium 瀏覽器才有的 UA Client Hints API，因此在 Safari 和 Firefox 上它會設定 `browser.language`，但不會設定 `browser.platform`。若要自行設定這些屬性——不使用偵測器，或為每個瀏覽器都提供平台——請這樣建構資源：",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "讓 `browser.platform` 保持粗略：每個不同的值都會成為**用戶端**分頁中的一列。",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "瀏覽器程式碼片段中的所有內容都會送到您的使用者。其中的權杖是公開的——任何檢視原始碼、開啟開發人員工具或閱讀您的打包檔案的人都能複製它。因此本指南只列出和建立**瀏覽器**類型的擷取金鑰，每個金鑰都帶有您的網站所使用的來源：",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- 它只接受來自這些來源的請求，因此複製的金鑰在別人的頁面上無法使用；",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- 它只能寫入追蹤、日誌、指標、工作階段重播和 Sentry 瀏覽器 SDK 報告——不能寫入效能剖析、source map、syslog、Fluent、Pyroscope 或安全性事件；",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- 它有個別金鑰的速率限制，一次編輯即可關閉，並且可以設定到期時間。",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "來源包含協定和連接埠（如有），並且可以用一個主機萬用字元 `*.` 開頭——`https://app.example.com`、`https://*.example.com`。如果也在金鑰上設定**固定的服務名稱**，它寫入的所有內容都會被強制使用該 `service.name`，因此複製的金鑰無法將其遙測冒充為您的某個後端服務。兩者都在**專案設定 > 遙測與 APM > 擷取金鑰**中該金鑰的頁面上。",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **切勿將伺服器擷取金鑰交給瀏覽器**。伺服器金鑰可以從任何地方取得完整的擷取存取權，且不檢查來源。一旦出現在頁面原始碼中，任何找到它的人都能向此專案寫入偽造的 span、日誌和指標——汙染儀表板、觸發虛假警示並推高您的計費用量——直到您發現並輪替它。",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls` 決定哪些跨來源請求會帶上 W3C `traceparent` 標頭，從而將瀏覽器 span 與它所觸發的後端追蹤連結起來。同源請求無需任何設定即可傳播。",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**不要將它設為 `/.*/`**。加入標頭會把簡單的跨來源請求變成需要預檢（preflight）的請求，任何未在其 `Access-Control-Allow-Headers` 中列出 `traceparent` 的第三方 API 都會開始失敗。只列出您控制並已設定的來源：",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "使用 `XMLHttpRequest` 而非 `fetch` 發出的請求需要 `@opentelemetry/instrumentation-xml-http-request` 及其 `XMLHttpRequestInstrumentation`，並使用相同的選項。",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "OpenTelemetry 瀏覽器 SDK 不會自動攔截未處理的錯誤。請明確回報它們，讓它們與後端錯誤一起出現在**例外**檢視中：",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "追蹤足以填滿概覽。如果您想在 OneUptime 中搜尋瀏覽器日誌，或查看 Core Web Vitals，請加入日誌和指標管線：",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object: a pipeline whose resource lacks `browser.*` is filed as a separate backend Service.":
    "它們的匯出器使用相同的 `x-oneuptime-token` 標頭傳送到 `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` 和 `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics`——程式碼請見[瀏覽器設定](/docs/rum/browser-setup)。請使用同一個 `resource` 物件建構它們：資源中沒有 `browser.*` 的管線會被儲存為獨立的後端服務。",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "**Core Web Vitals** 卡片（LCP、INP、CLS、FCP 和 TTFB）只由您的應用程式以 `web_vital.lcp` 等名稱回報的指標填入。[Core Web Vitals](/docs/rum/web-vitals) 列出了 OneUptime 讀取的名稱，並說明如何接上 `web-vitals` 程式庫。",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "任何帶有 `oneuptime.label.` 前綴的資源屬性都會成為應用程式上的專案標籤——將 `oneuptime.label.env` 設為 `production` 會加上標籤 `env:production`：",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "每個應用程式使用一個 `service.name`，而不是每個環境一個，並用標籤區分環境，這樣每個應用程式只保留一筆應用程式紀錄和一段歷史。",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "若要依名稱為應用程式加上標籤或指派擁有者，請使用**真實使用者監測 → 設定 → 標籤規則**和**擁有者規則**。規則會在應用程式建立時執行，包括透過自動探索建立時；它們不會為既有的應用程式重新加上標籤。",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **概覽**——可選時間範圍內的頁面瀏覽量、錯誤率和 p95 持續時間，並附趨勢圖。這些資料由您的檢測發出的 span 得出，因此頁面瀏覽就是檢測所回報的內容：文件載入、路由變更、互動。",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals**——LCP、INP、CLS、FCP 和 TTFB，在您的應用程式將它們以指標回報後顯示。",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **日誌**、**追蹤**和**指標**——遙測探索器，範圍限定為此應用程式。",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **用戶端**——曾出現此應用程式的瀏覽器平台，來自 `browser.platform`。依平台粗略統計，絕不依個別終端使用者統計。",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **工作階段重播**——一個獨立的選用錄製器，有自己的指令碼標籤和隱私權控制：[工作階段重播](/docs/telemetry/session-replay)。",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "只要遙測持續到達，應用程式就會顯示**正在接收資料**；15 分鐘沒有遙測後顯示**近期無流量**，在沒有人使用應用程式時這是正常的。",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "開啟 DevTools → **Network**，以 `otlp` 篩選：您要找的是 `POST /otlp/v1/traces`。完全沒有請求表示 SDK 從未啟動：",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts` 沒有最先匯入。檢測會修補 `fetch`；在它們之前匯入的內容不會被追蹤，如果 tree-shaking 移除了這個匯入，就什麼都不會執行。",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- 批次處理器尚未清空緩衝。`BatchSpanProcessor` 會緩衝資料——在斷定沒有傳送任何內容之前，請等待約 30 秒或切換頁面。",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- 某個建置時的環境變數變成了 `undefined`，因此匯出器 URL 格式錯誤。請在啟動時輸出一次。",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **遭 Content Security Policy 封鎖**——主控台會顯示。加入 `connect-src 'self' <YOUR_ONEUPTIME_URL>;`（步驟 4）。",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **遭 CORS 封鎖**——OneUptime 的 OTLP 端點允許任何來源和 `x-oneuptime-token` 標頭，因此 CORS 失敗幾乎總是表示請求根本沒有到達 OneUptime：企業 Proxy、廣告封鎖程式或主機名稱打錯。",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`**——在**專案設定 > 遙測與 APM > 擷取金鑰**中，將您網站的確切來源（協定、主機和連接埠）加入該金鑰的**允許的來源**。",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`**——在那裡重新啟用該金鑰，或在步驟 1 中選擇其他金鑰。",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`**——該金鑰不明、已撤銷或已到期。在步驟 5 中執行金鑰檢查，並在步驟 1 中選擇或建立有效的瀏覽器金鑰。",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`**——URL 錯誤。追蹤匯出器需要完整路徑 `/otlp/v1/traces`。",
  "The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable `browserDetector` as in step 3, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "資源中沒有任何瀏覽器屬性，因此遙測被儲存為後端服務。請像步驟 3 那樣啟用 `browserDetector`，或自行設定 `browser.*` 屬性（請見進階中的**OneUptime 如何識別瀏覽器應用程式**）。",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "在 DevTools → **Network** → OTLP 請求 → **Payload** 中檢查您傳送的內容：決定結果的是 `resourceSpans[0].resource.attributes` 清單。",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "已建立的服務不會變成 RUM 應用程式——它們是兩筆獨立的紀錄——因此在 RUM 遙測到達後請將它刪除。",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "用戶端列來自 `browser.platform`。`browserDetector` 讀取只有 Chromium 瀏覽器才有的 UA Client Hints API：在 Safari 和 Firefox 上它會設定 `browser.language`——足以將遙測歸類為 RUM——但不會設定 `browser.platform`。若要列出這些用戶端，請自行設定 `browser.platform`（請見進階中的**OneUptime 如何識別瀏覽器應用程式**）。",
  "The card is filled only from metrics your app emits. Check, in order:":
    "此卡片只由您的應用程式發出的指標填入。請依序檢查：",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. 您確實有**指標**管線——只有追蹤永遠不會填入此卡片。",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. 指標名稱是 OneUptime 讀取的名稱——請參閱 [Core Web Vitals](/docs/rum/web-vitals)。",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. 指標出現在應用程式的**指標**分頁中。如果有，表示匯出正常，問題在於名稱或所選的時間範圍。",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP 和 CLS 會在頁面隱藏時回報，因此短暫的造訪可能在下一次匯出前就結束了。",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **檢查時間範圍**。概覽預設顯示最近一小時，因此今天早上的測試不在範圍內。",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **等待一分鐘**。擷取會經過佇列，單一測試 span 可能需要最多一分鐘才會出現。",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **檢查專案**。遙測進入哪個專案由金鑰決定。",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "15 分鐘沒有遙測後，狀態會變為**近期無流量**。在沒有人使用應用程式時這是預期的。如果您的應用程式有流量：",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- 可能是**取樣器**丟棄了所有資料——請檢查您沒有設定一律關閉或比例極低的取樣器。",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- 應用程式可能只在該時段內沒有人進行的互動時才傳送資料。",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- 金鑰可能在部署後遭到撤銷——在步驟 5 中執行金鑰檢查。",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name` 為 **`storefront-web`**，即此應用程式的識別碼——請保持不變，否則資料會註冊為新的應用程式。",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "帶有 OpenTelemetry SDK 的 iOS、Android 或 React Native 應用程式——opentelemetry-swift、OpenTelemetry Android 或 OpenTelemetry JavaScript SDK",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "您的應用程式回報的 `service.name`——步驟 1 中的**行動裝置**金鑰固定於它",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "這些是標準的 OpenTelemetry 設定：從環境中讀取它們的 SDK 會照原樣使用。否則，請在程式碼中為 SDK 的 OTLP 匯出器和資源設定相同的端點、`x-oneuptime-token` 標頭和資源屬性——[行動裝置設定](/docs/rum/mobile-setup)示範了 Android、iOS 和 React Native 的做法。",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "大多數行動裝置 SDK 會替您設定 `device.*` 屬性。`device.model.identifier` 會填入**用戶端**分頁，因此如果您的 SDK 沒有設定它，請依上面的方式設定。",
  "`200` with `\"valid\": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.":
    "`200` 加上 `\"valid\": true` 表示 OneUptime 接受該金鑰；對於行動裝置金鑰，訊息還會說明它只能從行動應用程式使用。`401` 表示該金鑰不明、已撤銷、已停用或已到期，任何 SDK 設定都無法解決。",
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "然後啟動應用程式。它會隨第一批遙測出現在**真實使用者監測**中，並以該金鑰所固定的服務名稱命名。",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "行動裝置金鑰傳送的所有內容都會以此行動應用程式的形式儲存，歸入該金鑰所固定的服務名稱之下，無論其資源怎麼寫。金鑰只保留資源中應用程式對自身的描述——例如其 `service.*`、`device.*`、`os.*` 和 `telemetry.*` 屬性以及 `oneuptime.label.*` 標籤——其餘全部丟棄，因此複製的金鑰無法將其遙測冒充為主機、叢集或後端服務。",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "使用其他任何金鑰時，當資源帶有 `device.id` 或 `device.model.identifier` 時，OneUptime 會將遙測歸類為**行動裝置 RUM**。應用程式以 `service.name`（不區分大小寫）識別，其遙測屬於此 RUM 應用程式——絕不會再以後端服務的形式重複儲存。",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **其中之一** | 將遙測標記為行動裝置 RUM。`device.model.identifier` 也會填入**用戶端**分頁。 |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "`device.manufacturer` 也會將一批資料標記為行動裝置，但僅限於沒有 `host.name` 或 `host.id` 的資源——它在主機的資產清單項目中也代表實體機器的製造商。同時設定 `device.id` 或 `device.model.identifier`，就永遠不會遇到這種區分。",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id` 應是每次安裝的識別碼，而不是廣告 ID 或任何能識別個人的資訊。",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs and metrics, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **任何擁有您應用程式的人都能複製它的金鑰**。這正是它是行動裝置金鑰的原因：複本只能傳送此應用程式的追蹤、日誌和指標，歸入該金鑰所固定的服務名稱之下，且絕不能從網頁傳送。它仍然可以在金鑰的限額內為此應用程式傳送捏造的資料，因此請設定到期時間、隨版本發布輪替金鑰，並在遭到濫用時將它關閉。",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "這些都在**專案設定 > 遙測與 APM > 擷取金鑰**中該金鑰的頁面上：**固定的服務名稱**是該金鑰傳送的所有內容所歸入的應用程式，**每分鐘請求數上限**在您應用程式的所有複本之間限制該金鑰，**到期於**讓它在某個日期之後不再被接受，**已啟用**可立即將它關閉。",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "切勿改為在應用程式中發布**伺服器**金鑰：它可以從任何地方、以任何服務的身分向此專案寫入任何類型的遙測。",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android**——[OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) 代理程式（`io.opentelemetry.android:android-agent`）會在自己的資源上設定 `device.model.identifier`、`device.model.name` 和 `device.manufacturer`，因此無需額外設定即可完成歸類，而且它會自行回報當機、ANR、緩慢與凍結的影格、應用程式啟動以及工作階段。除非您設定 `service.name`，否則它會以啟動器標籤為應用程式命名，而且不會傳送 `device.id`。[Android 設定](/docs/rum/android-setup)提供了 Gradle 相依項目、程式碼，以及每一項在 OneUptime 中對應什麼。",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift**——使用 [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift) 時，請自行在資源上設定 `device.model.identifier` 和 `device.manufacturer`：各 SDK 版本加入的資源在不同版本之間有所變化。",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app.":
    "- **React Native / Expo**——執行 JavaScript SDK，因此設定與[瀏覽器設定](/docs/rum/browser-setup)中的瀏覽器設定相同，但有兩點不同：沒有 `browserDetector`，而且您需要自行設定 `device.manufacturer` 和 `device.model.identifier`，讓**用戶端**分頁列出裝置。它與任何行動應用程式一樣使用**行動裝置**金鑰傳送。",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **其他任何方式**——Flutter、Unity、.NET MAUI 或手寫的 OTLP 寫入器都以同樣的方式運作，只要資源帶有 `service.name` 加上一個 `device.*` 屬性。",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "OpenTelemetry 行動裝置 SDK 會在不同版本之間變更其建構器 API。[行動裝置設定](/docs/rum/mobile-setup)提供了每個 SDK 的程式碼；請對照您鎖定的版本核對方法名稱。",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "任何帶有 `oneuptime.label.` 前綴的資源屬性都會成為應用程式上的專案標籤——`oneuptime.label.env=production` 會加上標籤 `env:production`：",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **概覽**——可選時間範圍內的事件、錯誤率和 p95 持續時間，並附趨勢圖，由您的檢測發出的 span 得出。",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **例外**——您的應用程式以未處理例外回報的當機和 ANR，顯示在概覽和**例外**中。OpenTelemetry Android 會自行回報這兩者；ANR 以類型 `ANR` 列出。",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **用戶端**——曾出現此應用程式的裝置型號，來自 `device.model.identifier`。依型號粗略統計，絕不依個別終端使用者統計。",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "`401` 表示該金鑰不明、已撤銷、已停用或已到期：請在步驟 1 中選擇或建立行動裝置金鑰，並用它重新建置應用程式。",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and never from a web page: an SDK that exports over gRPC, or a request that carries an `Origin` header, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "`422` 會說明遭到拒絕的內容。行動裝置金鑰只透過 HTTP 傳送應用程式的 OTLP 追蹤、日誌和指標，絕不從網頁傳送：透過 gRPC 匯出的 SDK，或帶有 `Origin` 標頭的請求，都會遭到拒絕。瀏覽器金鑰能通過檢查，但從行動應用程式傳送時會遭到拒絕，因為它需要 `Origin` 標頭，而行動裝置 SDK 不會傳送。",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "該遙測是用伺服器金鑰傳送的，且其資源中既沒有 `device.id` 也沒有 `device.model.identifier`，因此被儲存為後端服務。請使用行動裝置金鑰（步驟 1）傳送——它會將傳送的所有內容以此應用程式的形式儲存——或者像步驟 2 那樣在 SDK 的資源上設定這些屬性。",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "用戶端列專門來自 `device.model.identifier`。只設定 `device.manufacturer` 的 SDK 會被歸類為行動裝置，但不會列出任何用戶端——請同時設定 `device.model.identifier`。",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "15 分鐘沒有遙測後，狀態會變為**近期無流量**。在沒有人使用應用程式時這是預期的。如果您的應用程式正在使用中：",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- 金鑰可能在發布後遭到撤銷——在步驟 3 中執行金鑰檢查。",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name` 為 **`Storefront Mobile`**，即此應用程式的識別碼——請保持不變，否則資料會註冊為新的應用程式。它在 `OTEL_RESOURCE_ATTRIBUTES` 中經過百分比編碼，SDK 會將它解碼。",
};

export default TRANSLATION;
