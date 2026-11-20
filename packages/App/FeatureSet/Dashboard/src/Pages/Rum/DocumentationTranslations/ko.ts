import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in Korean (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * Korean. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "코드를 변경하고 다시 배포할 수 있는 웹 앱(npm으로 의존성 설치)",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "사이트를 제공하는 출처(예: `https://app.example.com`) — 브라우저 키는 키에 지정한 출처의 요청만 허용합니다",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "그런 다음 앱의 **첫 번째** import로 만들어, 다른 코드가 실행되기 전에 계측이 `fetch`를 패치하도록 합니다:",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "`storefront-web`을 애플리케이션 이름으로 바꾸세요. OneUptime에서 앱이 표시되는 이름이므로 바꾸지 말고 유지하세요. 새 이름은 새 애플리케이션으로 등록됩니다.",
  "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.":
    "> **`service.name`만 설정하는 것으로는 충분하지 않습니다.** OpenTelemetry 브라우저 SDK는 브라우저 리소스 감지기를 켜거나 직접 설정하지 않는 한 `browser.*` 속성을 추가하지 않습니다. 이 속성이 없으면 RUM 애플리케이션이 아니라 백엔드 서비스가 됩니다.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "1단계에서 수집 키를 선택하면 `<YOUR_API_KEY>`가 채워집니다.",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "기존 `connect-src` 지시어에 병합하세요. 사이트에 Content Security Policy가 없나요? 이 단계는 건너뛰세요.",
  '`200` with `"valid": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.':
    '`200`과 `"valid": true`는 OneUptime이 키를 허용한다는 뜻입니다. 브라우저 키라면 메시지에 브라우저에서, 허용된 출처 중 하나에서만 작동한다는 내용이 덧붙습니다. `401`은 키를 알 수 없거나, 취소되었거나, 비활성화되었거나, 만료되었다는 뜻입니다.',
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "그런 다음 사이트의 페이지를 로드하세요. 1분 안에 애플리케이션이 `service.name`을 이름으로 하여 페이지 뷰, 오류율, p95 지속 시간과 함께 **실제 사용자 모니터링**에 표시됩니다.",
  "OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "OneUptime은 리소스에 클라이언트 속성이 있을 때 텔레메트리를 **RUM**으로 분류합니다. 웹의 경우 `browser.platform`, `browser.language` 또는 비어 있지 않은 `browser.brands` 중 하나입니다. 애플리케이션은 `service.name`(대소문자 구분 없음)으로 식별되며, 그 텔레메트리는 이 RUM 애플리케이션에 속하고 백엔드 서비스로 중복 저장되지 않습니다.",
  "| Attribute | Required | What it does |": "| 속성 | 필수 | 하는 일 |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **예** | 애플리케이션의 식별자(예: `storefront-web`). 나중에 이름을 바꾸면 새 애플리케이션이 만들어집니다. |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **이 중 하나** | 텔레메트리를 브라우저 RUM으로 표시합니다. `browser.platform`은 **클라이언트** 탭도 채웁니다. |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | 아니요 | 개요에 표시됨 |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector`는 브라우저에서 이 값들을 설정합니다. Chromium 브라우저에만 있는 UA Client Hints API를 읽으므로 Safari와 Firefox에서는 `browser.language`는 설정하지만 `browser.platform`은 설정하지 않습니다. 감지기 없이, 또는 모든 브라우저에 플랫폼을 지정하려고 속성을 직접 설정하려면 리소스를 다음과 같이 구성하세요:",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "`browser.platform`은 대략적인 값으로 유지하세요. 서로 다른 값마다 **클라이언트** 탭의 한 행이 됩니다.",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "브라우저 스니펫의 모든 내용은 사용자에게 전달됩니다. 그 안의 토큰은 공개된 것입니다. 소스를 보거나 개발자 도구를 열거나 번들을 읽는 누구나 복사할 수 있습니다. 그래서 이 가이드는 **브라우저** 유형의 수집 키만 나열하고 만들며, 각 키에는 사이트를 제공하는 출처가 지정됩니다:",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- 해당 출처에서만 허용되므로, 복사된 키는 다른 사람의 페이지에서 작동하지 않습니다.",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- 트레이스, 로그, 메트릭, 세션 리플레이, Sentry 브라우저 SDK 보고서만 쓸 수 있으며, 프로필, 소스 맵, syslog, Fluent, Pyroscope, 보안 이벤트는 쓸 수 없습니다.",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- 키별 속도 제한이 있고, 한 번의 편집으로 끌 수 있으며, 만료일을 둘 수 있습니다.",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "출처에는 스킴과 포트(있는 경우)가 포함되며, 호스트 와일드카드 `*.` 하나로 시작할 수 있습니다 — `https://app.example.com`, `https://*.example.com`. 키에 **고정된 서비스 이름**도 설정하면 키가 쓰는 모든 것에 `service.name`이 강제 적용되므로, 복사된 키가 자신의 텔레메트리를 백엔드 서비스의 것으로 위장할 수 없습니다. 두 설정 모두 **프로젝트 설정 > 텔레메트리 및 APM > 수집 키**의 키 페이지에 있습니다.",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **서버 수집 키를 절대 브라우저에 배포하지 마세요.** 서버 키는 출처 확인 없이 어디서든 전체 수집 권한을 가집니다. 페이지 소스에 들어가면, 그것을 찾은 누구나 이 프로젝트에 가짜 스팬, 로그, 메트릭을 쓸 수 있습니다. 대시보드가 오염되고, 잘못된 경고가 발생하고, 청구되는 사용량이 늘어나며, 알아차리고 교체할 때까지 계속됩니다.",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls`는 어떤 교차 출처 요청에 W3C `traceparent` 헤더를 붙일지 결정합니다. 이 헤더는 브라우저 스팬을 그것이 일으킨 백엔드 트레이스에 연결합니다. 같은 출처 요청에는 별도 설정 없이 전파됩니다.",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**`/.*/`로 설정하지 마세요.** 헤더를 추가하면 단순 교차 출처 요청이 사전 요청(preflight)이 필요한 요청으로 바뀌고, `Access-Control-Allow-Headers`에 `traceparent`가 없는 서드파티 API는 실패하기 시작합니다. 직접 관리하고 설정한 출처만 나열하세요:",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "`fetch` 대신 `XMLHttpRequest`로 보내는 요청에는 `@opentelemetry/instrumentation-xml-http-request`와 그 `XMLHttpRequestInstrumentation`이 같은 옵션으로 필요합니다.",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "OpenTelemetry 브라우저 SDK는 처리되지 않은 오류를 자동으로 포착하지 않습니다. 명시적으로 보고하면 백엔드 오류와 함께 **예외** 보기에 표시됩니다:",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "개요를 채우는 데는 트레이스로 충분합니다. OneUptime에서 브라우저 로그를 검색하거나 Core Web Vitals를 보려면 로그 및 메트릭 파이프라인을 추가하세요:",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object: a pipeline whose resource lacks `browser.*` is filed as a separate backend Service.":
    "이들의 익스포터는 같은 `x-oneuptime-token` 헤더로 `<YOUR_ONEUPTIME_URL>/otlp/v1/logs`와 `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics`에 보냅니다. 코드는 [브라우저 설정](/docs/rum/browser-setup)에 있습니다. 같은 `resource` 객체로 구성하세요. 리소스에 `browser.*`가 없는 파이프라인은 별도의 백엔드 서비스로 저장됩니다.",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "**Core Web Vitals** 카드(LCP, INP, CLS, FCP, TTFB)는 앱이 `web_vital.lcp` 같은 이름으로 보고하는 메트릭으로만 채워집니다. [Core Web Vitals](/docs/rum/web-vitals)에 OneUptime이 읽는 이름과 `web-vitals` 라이브러리 연결 방법이 나와 있습니다.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "`oneuptime.label.` 접두사가 붙은 리소스 속성은 애플리케이션의 프로젝트 레이블이 됩니다. `oneuptime.label.env`를 `production`으로 설정하면 `env:production` 레이블이 추가됩니다:",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "환경마다가 아니라 앱마다 `service.name` 하나를 사용하고, 환경은 레이블로 구분하세요. 그러면 각 앱이 하나의 애플리케이션과 하나의 기록을 유지합니다.",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "이름으로 애플리케이션에 레이블을 붙이거나 소유자를 지정하려면 **실제 사용자 모니터링 → 설정 → 레이블 규칙**과 **소유자 규칙**을 사용하세요. 규칙은 자동 검색을 포함해 애플리케이션이 만들어질 때 실행되며, 기존 애플리케이션에는 레이블을 다시 붙이지 않습니다.",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **개요** — 선택한 시간 범위의 페이지 뷰, 오류율, p95 지속 시간과 추세 차트. 계측이 내보내는 스팬에서 계산되므로, 페이지 뷰는 계측이 보고하는 것입니다: 문서 로드, 경로 변경, 상호 작용.",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals** — 앱이 메트릭으로 보고하면 LCP, INP, CLS, FCP, TTFB.",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **로그**, **트레이스**, **메트릭** — 이 애플리케이션으로 범위가 지정된 텔레메트리 탐색기.",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **클라이언트** — `browser.platform`에서 가져온, 애플리케이션이 확인된 브라우저 플랫폼. 플랫폼 단위로 대략적이며, 최종 사용자 단위가 아닙니다.",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **세션 리플레이** — 자체 스크립트 태그와 개인정보 보호 설정이 있는 별도의 선택적 녹화기: [세션 리플레이](/docs/telemetry/session-replay).",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "애플리케이션은 텔레메트리가 계속 들어오는 동안 **데이터 수신 중**을 표시하고, 15분 동안 들어오지 않으면 **최근 트래픽 없음**을 표시합니다. 아무도 앱을 사용하지 않는 동안에는 정상입니다.",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "DevTools → **Network**를 열고 `otlp`로 필터링하세요. 찾는 것은 `POST /otlp/v1/traces`입니다. 요청이 전혀 없다면 SDK가 시작되지 않은 것입니다:",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts`를 가장 먼저 import하지 않았습니다. 계측은 `fetch`를 패치하므로 그보다 먼저 import된 것은 추적되지 않으며, 트리 셰이킹으로 import가 제거되면 아무것도 실행되지 않습니다.",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- 배치 프로세서가 아직 플러시하지 않았습니다. `BatchSpanProcessor`는 버퍼링합니다. 아무것도 전송되지 않는다고 판단하기 전에 30초 정도 기다리거나 다른 페이지로 이동하세요.",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- 빌드 시 환경 변수가 `undefined`가 되어 익스포터 URL이 잘못되었습니다. 시작할 때 한 번 출력해 보세요.",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **Content Security Policy에 의해 차단됨** — 콘솔에 표시됩니다. `connect-src 'self' <YOUR_ONEUPTIME_URL>;`를 추가하세요(4단계).",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **CORS에 의해 차단됨** — OneUptime의 OTLP 엔드포인트는 모든 출처와 `x-oneuptime-token` 헤더를 허용하므로, CORS 실패는 거의 항상 요청이 OneUptime에 아예 도달하지 않는다는 뜻입니다: 회사 프록시, 광고 차단기, 호스트 오타.",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`** — **프로젝트 설정 > 텔레메트리 및 APM > 수집 키**에서 키의 **허용된 출처**에 사이트의 정확한 출처(스킴, 호스트, 포트)를 추가하세요.",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`** — 그곳에서 키를 다시 켜거나 1단계에서 다른 키를 선택하세요.",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`** — 키를 알 수 없거나, 취소되었거나, 만료되었습니다. 5단계에서 키 확인을 실행하고 1단계에서 유효한 브라우저 키를 선택하거나 만드세요.",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`** — URL이 잘못되었습니다. 트레이스 익스포터에는 전체 경로 `/otlp/v1/traces`가 필요합니다.",
  "The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable `browserDetector` as in step 3, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "리소스에 브라우저 속성이 없어 텔레메트리가 백엔드 서비스로 저장되었습니다. 3단계처럼 `browserDetector`를 켜거나 `browser.*` 속성을 직접 설정하세요(고급의 **OneUptime이 브라우저 앱을 인식하는 방법**).",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "DevTools → **Network** → OTLP 요청 → **Payload**에서 보내는 내용을 확인하세요. `resourceSpans[0].resource.attributes`가 결정하는 목록입니다.",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "이미 만들어진 서비스는 RUM 애플리케이션으로 바뀌지 않으므로(두 개의 별도 레코드입니다), RUM 텔레메트리가 도착하면 삭제하세요.",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "클라이언트 행은 `browser.platform`에서 옵니다. `browserDetector`는 Chromium 브라우저에만 있는 UA Client Hints API를 읽으므로, Safari와 Firefox에서는 `browser.language`(텔레메트리를 RUM으로 분류하기에 충분)는 설정하지만 `browser.platform`은 설정하지 않습니다. 이 클라이언트들을 나열하려면 `browser.platform`을 직접 설정하세요(고급의 **OneUptime이 브라우저 앱을 인식하는 방법**).",
  "The card is filled only from metrics your app emits. Check, in order:":
    "이 카드는 앱이 내보내는 메트릭으로만 채워집니다. 다음 순서로 확인하세요:",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. **메트릭** 파이프라인이 있는지 — 트레이스만으로는 이 카드가 채워지지 않습니다.",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. 메트릭 이름이 OneUptime이 읽는 이름인지 — [Core Web Vitals](/docs/rum/web-vitals)를 참조하세요.",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. 애플리케이션의 **메트릭** 탭에 메트릭이 표시되는지. 표시된다면 내보내기는 작동하고 있으며, 문제는 이름이나 선택한 범위입니다.",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP와 CLS는 페이지가 숨겨질 때 보고되므로, 짧은 방문은 다음 내보내기 전에 끝날 수 있습니다.",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **시간 범위를 확인하세요.** 개요는 기본적으로 지난 1시간을 표시하므로 오늘 아침의 테스트는 범위를 벗어납니다.",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **1분 기다리세요.** 수집은 대기열을 거치므로 테스트 스팬 하나가 표시되는 데 최대 1분이 걸릴 수 있습니다.",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **프로젝트를 확인하세요.** 텔레메트리가 어느 프로젝트에 들어갈지는 키가 결정합니다.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "텔레메트리 없이 15분이 지나면 상태가 **최근 트래픽 없음**으로 바뀝니다. 아무도 앱을 사용하지 않는 동안에는 예상되는 일입니다. 앱에 트래픽이 있다면:",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- **샘플러**가 모든 것을 버리고 있을 수 있습니다. 항상 꺼져 있거나 비율이 매우 낮은 샘플러를 설정하지 않았는지 확인하세요.",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- 앱이 그 시간대에 아무도 하지 않은 상호 작용에서만 보낼 수 있습니다.",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- 배포 후 키가 취소되었을 수 있습니다. 5단계에서 키 확인을 실행하세요.",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name`은 **`storefront-web`** — 이 애플리케이션의 식별자입니다. 그대로 두세요. 바꾸면 데이터가 새 애플리케이션으로 등록됩니다.",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "OpenTelemetry SDK가 있는 iOS, Android 또는 React Native 앱 — opentelemetry-swift, OpenTelemetry Android 또는 OpenTelemetry JavaScript SDK",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "앱이 보고하는 `service.name` — 1단계의 **모바일** 키가 여기에 고정됩니다",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "이는 표준 OpenTelemetry 설정입니다. 환경에서 이 값을 읽는 SDK는 그대로 사용합니다. 그렇지 않다면 코드에서 SDK의 OTLP 익스포터와 리소스에 같은 엔드포인트, `x-oneuptime-token` 헤더, 리소스 속성을 설정하세요. [모바일 설정](/docs/rum/mobile-setup)에서 Android, iOS, React Native용 방법을 보여 줍니다.",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "대부분의 모바일 SDK는 `device.*` 속성을 대신 설정합니다. `device.model.identifier`는 **클라이언트** 탭을 채우므로, 사용하는 SDK가 설정하지 않는다면 위와 같이 설정하세요.",
  '`200` with `"valid": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.':
    '`200`과 `"valid": true`는 OneUptime이 키를 허용한다는 뜻이며, 모바일 키라면 메시지에 모바일 앱에서만 작동한다는 내용이 덧붙습니다. `401`은 키를 알 수 없거나, 취소되었거나, 비활성화되었거나, 만료되었다는 뜻이며, 어떤 SDK 설정으로도 해결되지 않습니다.',
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "그런 다음 앱을 시작하세요. 첫 번째 텔레메트리 배치와 함께, 키에 고정된 서비스 이름으로 **실제 사용자 모니터링**에 표시됩니다.",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "모바일 키가 보내는 모든 것은 리소스에 무엇이 적혀 있든 키에 고정된 서비스 이름 아래 이 모바일 앱으로 저장됩니다. 키는 리소스 중 앱이 자신에 대해 말하는 것(`service.*`, `device.*`, `os.*`, `telemetry.*` 속성과 `oneuptime.label.*` 레이블 등)만 남기고 나머지는 버리므로, 복사된 키는 자신의 텔레메트리를 호스트, 클러스터 또는 백엔드 서비스의 것으로 위장할 수 없습니다.",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "다른 키를 사용하면 OneUptime은 리소스에 `device.id` 또는 `device.model.identifier`가 있을 때 텔레메트리를 **모바일 RUM**으로 분류합니다. 애플리케이션은 `service.name`(대소문자 구분 없음)으로 식별되며, 그 텔레메트리는 이 RUM 애플리케이션에 속하고 백엔드 서비스로 중복 저장되지 않습니다.",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **이 중 하나** | 텔레메트리를 모바일 RUM으로 표시합니다. `device.model.identifier`는 **클라이언트** 탭도 채웁니다. |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "`device.manufacturer`도 배치를 모바일로 표시하지만, `host.name`이나 `host.id`가 없는 리소스에서만 그렇습니다. 이 속성은 호스트 인벤토리 항목에서 물리 머신의 제조사로도 쓰이기 때문입니다. `device.id`나 `device.model.identifier`도 설정하면 이 구분은 생기지 않습니다.",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id`는 설치별 식별자여야 하며, 광고 ID나 개인을 식별하는 값이어서는 안 됩니다.",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs and metrics, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **앱을 가진 누구나 그 앱의 키를 복사할 수 있습니다.** 그래서 모바일 키를 씁니다. 복사본은 이 앱의 트레이스, 로그, 메트릭만 보낼 수 있고, 모두 키에 고정된 서비스 이름으로 저장되며, 웹 페이지에서는 절대 보낼 수 없습니다. 그래도 키의 한도 안에서 이 앱의 꾸며 낸 데이터를 보낼 수는 있으므로, 만료일을 정하고, 릴리스마다 키를 교체하고, 악용되면 끄세요.",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "모두 **프로젝트 설정 > 텔레메트리 및 APM > 수집 키**의 키 페이지에 있습니다. **고정된 서비스 이름**은 키가 보내는 모든 것이 저장되는 앱이고, **분당 요청 한도**는 앱의 모든 복사본에 걸쳐 키를 제한하며, **만료 시각**은 특정 날짜 이후 키를 더 이상 허용하지 않고, **활성화됨**은 즉시 키를 끕니다.",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "대신 **서버** 키를 앱에 넣어 배포하지 마세요. 서버 키는 어디서든, 어떤 서비스로든 이 프로젝트에 모든 종류의 텔레메트리를 쓸 수 있습니다.",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android** — [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) 에이전트(`io.opentelemetry.android:android-agent`)는 자체 리소스에 `device.model.identifier`, `device.model.name`, `device.manufacturer`를 설정하므로 추가 설정 없이 분류가 작동하며, 크래시, ANR, 느린 프레임과 멈춘 프레임, 앱 시작, 세션을 직접 보고합니다. `service.name`을 설정하지 않으면 런처 레이블로 앱 이름을 정하며, `device.id`는 보내지 않습니다. [Android 설정](/docs/rum/android-setup)에 Gradle 의존성, 코드, 그리고 각각이 OneUptime에서 무엇이 되는지가 나와 있습니다.",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift** — [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift)를 사용하면 리소스에 `device.model.identifier`와 `device.manufacturer`를 직접 설정하세요. SDK 버전이 추가하는 리소스는 릴리스마다 달라졌습니다.",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app.":
    "- **React Native / Expo** — JavaScript SDK를 실행하므로 설정은 [브라우저 설정](/docs/rum/browser-setup)의 브라우저 설정과 같지만 두 가지가 다릅니다. `browserDetector`가 없고, **클라이언트** 탭에 기기가 나열되도록 `device.manufacturer`와 `device.model.identifier`를 직접 설정합니다. 다른 모바일 앱과 마찬가지로 **모바일** 키로 보냅니다.",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **그 밖의 모든 것** — Flutter, Unity, .NET MAUI 또는 직접 작성한 OTLP 전송기도 리소스에 `service.name`과 `device.*` 속성 하나가 있으면 같은 방식으로 작동합니다.",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "OpenTelemetry 모바일 SDK는 릴리스마다 빌더 API가 바뀝니다. [모바일 설정](/docs/rum/mobile-setup)에 각 SDK의 코드가 있으니, 고정한 버전과 메서드 이름을 대조해 확인하세요.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "`oneuptime.label.` 접두사가 붙은 리소스 속성은 애플리케이션의 프로젝트 레이블이 됩니다. `oneuptime.label.env=production`은 `env:production` 레이블을 추가합니다:",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **개요** — 선택한 시간 범위의 이벤트, 오류율, p95 지속 시간과 추세 차트. 계측이 내보내는 스팬에서 계산됩니다.",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **예외** — 앱이 처리되지 않은 예외로 보고하는 크래시와 ANR이 개요와 **예외**에 표시됩니다. OpenTelemetry Android는 둘 다 직접 보고하며, ANR은 `ANR` 유형으로 표시됩니다.",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **클라이언트** — `device.model.identifier`에서 가져온, 애플리케이션이 확인된 기기 모델. 모델 단위로 대략적이며, 최종 사용자 단위가 아닙니다.",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "`401`은 키를 알 수 없거나, 취소되었거나, 비활성화되었거나, 만료되었다는 뜻입니다. 1단계에서 모바일 키를 선택하거나 만들고 그 키로 앱을 다시 빌드하세요.",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and never from a web page: an SDK that exports over gRPC, or a request that carries an `Origin` header, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "`422`는 무엇이 거부되었는지 알려 줍니다. 모바일 키는 앱의 OTLP 트레이스, 로그, 메트릭만 HTTP로 보내며 웹 페이지에서는 절대 보내지 않습니다. gRPC로 내보내는 SDK나 `Origin` 헤더가 있는 요청은 거부됩니다. 브라우저 키는 확인은 통과하지만 모바일 앱에서는 거부됩니다. `Origin` 헤더가 필요한데 모바일 SDK는 이를 보내지 않기 때문입니다.",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "텔레메트리가 서버 키로 전송되었고 리소스에 `device.id`나 `device.model.identifier`가 없어 백엔드 서비스로 저장되었습니다. 보내는 모든 것을 이 앱으로 저장하는 모바일 키(1단계)로 보내거나, 2단계처럼 SDK 리소스에 이 속성을 설정하세요.",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "클라이언트 행은 특히 `device.model.identifier`에서 옵니다. `device.manufacturer`만 설정하는 SDK는 모바일로 분류되지만 클라이언트는 나열되지 않습니다. `device.model.identifier`도 설정하세요.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "텔레메트리 없이 15분이 지나면 상태가 **최근 트래픽 없음**으로 바뀝니다. 아무도 앱을 사용하지 않는 동안에는 예상되는 일입니다. 앱이 사용 중이라면:",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- 릴리스 후 키가 취소되었을 수 있습니다. 3단계에서 키 확인을 실행하세요.",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name`은 **`Storefront Mobile`** — 이 애플리케이션의 식별자입니다. 그대로 두세요. 바꾸면 데이터가 새 애플리케이션으로 등록됩니다. `OTEL_RESOURCE_ATTRIBUTES`에서는 퍼센트 인코딩되며, SDK가 이를 디코딩합니다.",
};

export default TRANSLATION;
