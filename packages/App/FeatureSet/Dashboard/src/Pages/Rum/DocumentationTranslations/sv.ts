import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in Swedish (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * Swedish. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "En webbapp vars kod du kan ändra och driftsätta på nytt, med beroenden installerade via npm",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "De ursprung som din webbplats levereras från, som `https://app.example.com` — en webbläsarnyckel godtar bara förfrågningar från de ursprung du anger på den",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "Gör den sedan till appens **första** import, så att instrumenteringarna patchar `fetch` innan något annat körs:",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "Ersätt `storefront-web` med din applikations namn. Det är namnet som appen visas under i OneUptime, så håll det stabilt: ett nytt namn registrerar en ny applikation.",
  "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.":
    "> **Det räcker inte att bara sätta `service.name`.** OpenTelemetrys webbläsar-SDK:er lägger inte till `browser.*`-attribut om du inte aktiverar webbläsarens resursdetektor eller sätter dem själv — utan dem blir det här en backend-tjänst, inte en RUM-applikation.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Välj en intagningsnyckel i steg 1 för att fylla i `<YOUR_API_KEY>`.",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "Slå ihop den med ditt befintliga `connect-src`-direktiv. Har din webbplats ingen Content Security Policy? Hoppa då över det här steget.",
  '`200` with `"valid": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.':
    '`200` med `"valid": true` betyder att OneUptime godtar nyckeln — för en webbläsarnyckel lägger meddelandet till att den bara fungerar från en webbläsare, från ett av dess tillåtna ursprung. `401` betyder att den är okänd, återkallad, inaktiverad eller har gått ut.',
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "Ladda sedan en sida på din webbplats. Inom en minut visas applikationen under **Övervakning av verkliga användare**, uppkallad efter sitt `service.name`, med sidvisningar, felfrekvens och p95-varaktighet.",
  "OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "OneUptime klassificerar telemetri som **RUM** när dess resurs har klientattribut — för webben något av `browser.platform`, `browser.language` eller ett icke-tomt `browser.brands`. Applikationen känns igen på `service.name` (skiftlägesokänsligt), och dess telemetri hör till den här RUM-applikationen — den lagras aldrig dubbelt som en backend-tjänst.",
  "| Attribute | Required | What it does |":
    "| Attribut | Krävs | Vad det gör |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **ja** | Applikationens identitet, t.ex. `storefront-web`. Att byta namn på det senare skapar en ny applikation. |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **ett av dem** | Markerar telemetrin som webbläsar-RUM. `browser.platform` fyller också fliken **Klienter**. |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | nej | Visas i översikten |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector` sätter dem från webbläsaren. Den läser UA Client Hints-API:t, som bara Chromium-webbläsare har, så i Safari och Firefox sätter den `browser.language` men inte `browser.platform`. För att sätta attributen själv — utan detektorn, eller för att ge varje webbläsare en plattform — bygger du resursen så här:",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "Håll `browser.platform` grovt: varje distinkt värde blir en rad på fliken **Klienter**.",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "Allt i webbläsarens kodavsnitt hamnar hos dina användare. Token i det är offentlig — alla som visar källkoden, öppnar utvecklarverktygen eller läser ditt paket kan kopiera den. Därför listar och skapar den här guiden bara intagningsnycklar av typen **Webbläsare**, var och en med de ursprung som din webbplats levereras från:",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- den godtas bara från de ursprungen, så en kopierad nyckel fungerar inte på någon annans sida;",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- den kan bara skriva spår, loggar, mätvärden, sessionsuppspelningar och rapporter från Sentrys webbläsar-SDK — inte profiler, source maps, syslog, Fluent, Pyroscope eller säkerhetshändelser;",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- den har en hastighetsgräns per nyckel, kan stängas av med en enda redigering och kan få ett utgångsdatum.",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "Ett ursprung omfattar schemat och eventuell port och får börja med ett värdjokertecken `*.` — `https://app.example.com`, `https://*.example.com`. Om du också sätter **Fäst tjänstnamn** på nyckeln tvingas `service.name` på allt den skriver, så att en kopierad nyckel inte kan utge sin telemetri för någon av dina backend-tjänster. Båda finns på nyckelns sida under **Projektinställningar > Telemetri och APM > Intagningsnycklar**.",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **Skicka aldrig en serverintagningsnyckel till en webbläsare.** En servernyckel har full intagningsåtkomst var som helst ifrån, utan kontroll av ursprung. När den väl finns i sidans källkod kan alla som hittar den skriva falska spans, loggar och mätvärden till det här projektet — förorena instrumentpaneler, utlösa falska larm och driva upp din fakturerade användning — tills du märker det och roterar den.",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls` avgör vilka förfrågningar mellan ursprung som får en W3C-header `traceparent`, som kopplar webbläsarens span till det backend-spår den utlöste. Förfrågningar från samma ursprung vidarebefordras utan någon konfiguration.",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**Sätt den inte till `/.*/`.** En extra header gör en enkel förfrågan mellan ursprung till en med preflight, och varje tredjeparts-API som inte listar `traceparent` i sina `Access-Control-Allow-Headers` börjar misslyckas. Lista bara ursprung som du själv styr och har konfigurerat:",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "Förfrågningar som görs med `XMLHttpRequest` i stället för `fetch` behöver `@opentelemetry/instrumentation-xml-http-request` och dess `XMLHttpRequestInstrumentation`, med samma alternativ.",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "OpenTelemetrys webbläsar-SDK fångar inte automatiskt ohanterade fel. Rapportera dem uttryckligen, så att de hamnar i vyn **Undantag** bredvid dina backend-fel:",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "Spår räcker för att fylla översikten. Lägg till pipelines för loggar och mätvärden om du vill kunna söka i webbläsarloggar i OneUptime, eller för Core Web Vitals:",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object: a pipeline whose resource lacks `browser.*` is filed as a separate backend Service.":
    "Deras exportörer skickar till `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` och `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` med samma header `x-oneuptime-token` — koden finns i [Konfigurera webbläsare](/docs/rum/browser-setup). Bygg dem med samma objekt `resource`: en pipeline vars resurs saknar `browser.*` lagras som en separat backend-tjänst.",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "Kortet **Core Web Vitals** — LCP, INP, CLS, FCP och TTFB — fylls bara från mätvärden som din app rapporterar, under namn som `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) listar de namn som OneUptime läser och kopplar in biblioteket `web-vitals`.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "Varje resursattribut med prefixet `oneuptime.label.` blir en projektetikett på applikationen — `oneuptime.label.env` satt till `production` lägger till etiketten `env:production`:",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "Använd ett `service.name` per app, inte per miljö, och skilj miljöer åt med en etikett, så att varje app behåller en applikation och en historik.",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "För att etikettera applikationer eller tilldela ägare efter namn använder du **Övervakning av verkliga användare → Inställningar → Etikettregler** och **Ägarregler**. Regler körs när en applikation skapas, även genom automatisk identifiering; de etiketterar inte om befintliga applikationer.",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **Översikt** — sidvisningar, felfrekvens och p95-varaktighet över ett valbart tidsintervall, med trenddiagram. De härleds från de spans som din instrumentering skickar ut, så en sidvisning är vad den rapporterar: dokumentladdningar, ruttändringar, interaktioner.",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals** — LCP, INP, CLS, FCP och TTFB, när din app rapporterar dem som mätvärden.",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **Loggar**, **Spår** och **Mätvärden** — telemetriutforskarna, avgränsade till den här applikationen.",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **Klienter** — de webbläsarplattformar som applikationen har setts på, från `browser.platform`. Grovt per plattform, aldrig per slutanvändare.",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **Sessionsuppspelning** — en separat, valfri inspelare med egen skripttagg och egna integritetsinställningar: [Sessionsuppspelning](/docs/telemetry/session-replay).",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "Applikationen visar **Tar emot data** så länge telemetrin fortsätter att komma, och **Ingen trafik nyligen** efter 15 minuter utan, vilket är normalt medan ingen använder appen.",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "Öppna DevTools → **Network** och filtrera på `otlp`: du letar efter `POST /otlp/v1/traces`. Ingen förfrågan alls betyder att SDK:t aldrig startade:",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts` importeras inte först. Instrumenteringarna patchar `fetch`; det som importeras före dem spåras inte, och om tree-shaking tar bort importen körs ingenting alls.",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- Batchprocessorn har inte tömt sin buffert än. `BatchSpanProcessor` buffrar — vänta ungefär 30 sekunder, eller navigera, innan du drar slutsatsen att ingenting skickas.",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- En miljövariabel från bygget blev `undefined`, så exportörens URL är felaktig. Skriv ut den en gång vid start.",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **Blockerad av Content Security Policy** — konsolen säger det. Lägg till `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (steg 4).",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **Blockerad av CORS** — OneUptimes OTLP-slutpunkter tillåter alla ursprung och headern `x-oneuptime-token`, så ett CORS-fel betyder nästan alltid att förfrågan inte når OneUptime alls: en företagsproxy, en annonsblockerare eller ett stavfel i värden.",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`** — lägg till din webbplats exakta ursprung (schema, värd och port) i nyckelns **Tillåtna ursprung** under **Projektinställningar > Telemetri och APM > Intagningsnycklar**.",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`** — aktivera nyckeln igen där, eller välj en annan nyckel i steg 1.",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`** — nyckeln är okänd, återkallad eller har gått ut. Kör nyckelkontrollen i steg 5 och välj eller skapa en giltig webbläsarnyckel i steg 1.",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`** — URL:en är fel. Spårexportören behöver hela sökvägen, `/otlp/v1/traces`.",
  "The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable `browserDetector` as in step 3, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "Resursen har inget webbläsarattribut, så telemetrin lagrades som en backend-tjänst. Aktivera `browserDetector` som i steg 3, eller sätt `browser.*`-attributen själv (**Så känner OneUptime igen en webbläsarapp** under Avancerad).",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "Kontrollera vad du skickar i DevTools → **Network** → OTLP-förfrågan → **Payload**: `resourceSpans[0].resource.attributes` är listan som avgör det.",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "Tjänsten som redan har skapats blir inte en RUM-applikation — de är två separata poster — så ta bort den när RUM-telemetrin kommer.",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "Klientrader kommer från `browser.platform`. `browserDetector` läser UA Client Hints-API:t, som bara Chromium-webbläsare har: i Safari och Firefox sätter den `browser.language` — tillräckligt för att klassificera telemetrin som RUM — men inte `browser.platform`. Sätt `browser.platform` själv för att lista de klienterna (**Så känner OneUptime igen en webbläsarapp** under Avancerad).",
  "The card is filled only from metrics your app emits. Check, in order:":
    "Kortet fylls bara från mätvärden som din app skickar ut. Kontrollera, i den här ordningen:",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. Att du över huvud taget har en pipeline för **mätvärden** — spår ensamma fyller aldrig det här kortet.",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. Att mätvärdenas namn är sådana som OneUptime läser — se [Core Web Vitals](/docs/rum/web-vitals).",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. Att mätvärdena visas på applikationens flik **Mätvärden**. Gör de det fungerar exporten, och problemet är namnet eller det valda tidsintervallet.",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP och CLS rapporteras när sidan döljs, så ett kort besök kan ta slut före nästa export.",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **Kontrollera tidsintervallet.** Översikten visar som standard den senaste timmen, så ett test från i morse hamnar utanför.",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **Vänta en minut.** Intagningen går via en kö, och ett enskilt test-span kan ta upp till en minut att dyka upp.",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **Kontrollera projektet.** Nyckeln avgör vilket projekt telemetrin hamnar i.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "Statusen ändras till **Ingen trafik nyligen** efter 15 minuter utan telemetri. Det är väntat medan ingen använder appen. Om din app har trafik:",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- En **sampler** kanske slänger allt — kontrollera att du inte har satt en sampler som alltid är avstängd eller har en mycket låg andel.",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- Appen kanske bara skickar vid interaktioner som ingen gjorde under det intervallet.",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- Nyckeln kan ha återkallats efter driftsättningen — kör nyckelkontrollen i steg 5.",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name` är **`storefront-web`**, den här applikationens identifierare — behåll den som den är, annars registreras data som en ny applikation.",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "En iOS-, Android- eller React Native-app med ett OpenTelemetry-SDK — opentelemetry-swift, OpenTelemetry Android eller OpenTelemetrys JavaScript-SDK",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "Det `service.name` som din app rapporterar — **Mobil**-nyckeln från steg 1 är fäst vid det",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "Det här är OpenTelemetrys standardinställningar: ett SDK som läser dem från sin miljö tar dem som de är. Annars sätter du samma slutpunkt, headern `x-oneuptime-token` och resursattributen i koden på SDK:ts OTLP-exportör och resurs — [Konfigurera mobil](/docs/rum/mobile-setup) visar det för Android, iOS och React Native.",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "De flesta mobila SDK:er sätter `device.*`-attributen åt dig. `device.model.identifier` fyller fliken **Klienter**, så sätt det som ovan om ditt inte gör det.",
  '`200` with `"valid": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.':
    '`200` med `"valid": true` betyder att OneUptime godtar nyckeln, och för en mobilnyckel lägger meddelandet till att den bara fungerar från en mobilapp. `401` betyder att den är okänd, återkallad, inaktiverad eller har gått ut, och ingen SDK-konfiguration hjälper.',
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "Starta sedan appen. Den visas under **Övervakning av verkliga användare** med sin första telemetribatch, uppkallad efter det tjänstnamn som nyckeln är fäst vid.",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "Allt som en mobilnyckel skickar lagras som den här mobilappen, under det tjänstnamn som nyckeln är fäst vid, oavsett vad dess resurs säger. Nyckeln behåller bara det av resursen som en app säger om sig själv — som dess attribut `service.*`, `device.*`, `os.*` och `telemetry.*` och dess etiketter `oneuptime.label.*` — och slänger resten, så att en kopierad nyckel inte kan utge sin telemetri för en värd, ett kluster eller en backend-tjänst.",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "Med vilken annan nyckel som helst klassificerar OneUptime telemetri som **mobil RUM** när dess resurs har `device.id` eller `device.model.identifier`. Applikationen känns igen på `service.name` (skiftlägesokänsligt), och dess telemetri hör till den här RUM-applikationen — den lagras aldrig dubbelt som en backend-tjänst.",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **ett av dem** | Markerar telemetrin som mobil RUM. `device.model.identifier` fyller också fliken **Klienter**. |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "`device.manufacturer` markerar också en batch som mobil, men bara på en resurs utan `host.name` eller `host.id` — det anger också märket på en fysisk maskin i en värds inventariepost. Sätt också `device.id` eller `device.model.identifier`, så uppstår skillnaden aldrig.",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id` bör vara en identifierare per installation, inte ett annons-ID eller något som identifierar en person.",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs and metrics, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **Alla som har din app kan kopiera dess nyckel.** Därför är det en mobilnyckel: en kopia kan bara skicka den här appens spår, loggar och mätvärden, lagrade under det tjänstnamn som nyckeln är fäst vid, och aldrig från en webbsida. Den kan fortfarande skicka påhittade data för den här appen, upp till nyckelns gräns, så ge den ett utgångsdatum, rotera nyckeln med dina releaser och stäng av den om den missbrukas.",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "Allt detta finns på nyckelns sida under **Projektinställningar > Telemetri och APM > Intagningsnycklar**: **Fäst tjänstnamn** är appen som allt nyckeln skickar lagras under, **Gräns för förfrågningar per minut** begränsar nyckeln över alla kopior av din app, **Upphör** gör att den slutar godtas efter ett datum, och **Aktiverad** stänger av den direkt.",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "Skicka aldrig med en **Server**-nyckel i en app i stället: den kan skriva alla typer av telemetri till det här projektet, var som helst ifrån, som vilken tjänst som helst.",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android** — agenten [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) (`io.opentelemetry.android:android-agent`) sätter `device.model.identifier`, `device.model.name` och `device.manufacturer` på sin egen resurs, så klassificeringen fungerar utan extra konfiguration, och den rapporterar själv krascher, ANR:er, långsamma och frysta bildrutor, appstarter och sessioner. Den namnger appen efter dess startetikett om du inte sätter `service.name`, och den skickar inget `device.id`. [Konfigurera Android](/docs/rum/android-setup) har Gradle-beroendet, koden och vad var och en blir i OneUptime.",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift** — med [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift) sätter du själv `device.model.identifier` och `device.manufacturer` på resursen: den resurs som en SDK-version lägger till har ändrats mellan releaser.",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app.":
    "- **React Native / Expo** — kör JavaScript-SDK:t, så konfigurationen är webbläsarens från [Konfigurera webbläsare](/docs/rum/browser-setup) med två skillnader: det finns ingen `browserDetector`, och du sätter själv `device.manufacturer` och `device.model.identifier` så att fliken **Klienter** listar enheterna. Den skickar med en **Mobil**-nyckel, som vilken mobilapp som helst.",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **Allt annat** — Flutter, Unity, .NET MAUI eller en handskriven OTLP-skrivare fungerar på samma sätt, så länge resursen har `service.name` plus ett `device.*`-attribut.",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "De mobila OpenTelemetry-SDK:erna ändrar sina builder-API:er mellan releaser. [Konfigurera mobil](/docs/rum/mobile-setup) har kod för var och en; kontrollera metodnamnen mot den version du låser.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "Varje resursattribut med prefixet `oneuptime.label.` blir en projektetikett på applikationen — `oneuptime.label.env=production` lägger till etiketten `env:production`:",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **Översikt** — händelser, felfrekvens och p95-varaktighet över ett valbart tidsintervall, med trenddiagram, härledda från de spans som din instrumentering skickar ut.",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **Undantag** — de krascher och ANR:er som din app rapporterar, som ohanterade undantag, i översikten och under **Undantag**. OpenTelemetry Android rapporterar båda själv; en ANR listas med typen `ANR`.",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **Klienter** — de enhetsmodeller som applikationen har setts på, från `device.model.identifier`. Grovt per modell, aldrig per slutanvändare.",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "En `401` betyder att nyckeln är okänd, återkallad, inaktiverad eller har gått ut: välj eller skapa en mobilnyckel i steg 1 och bygg om appen med den.",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and never from a web page: an SDK that exports over gRPC, or a request that carries an `Origin` header, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "En `422` säger vad som avvisades. En mobilnyckel skickar bara appens OTLP-spår, -loggar och -mätvärden, över HTTP, och aldrig från en webbsida: ett SDK som exporterar över gRPC, eller en förfrågan med en `Origin`-header, avvisas. En webbläsarnyckel klarar kontrollen men avvisas från en mobilapp, eftersom den kräver en `Origin`-header och mobila SDK:er inte skickar någon.",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "Telemetrin skickades med en servernyckel, och dess resurs har varken `device.id` eller `device.model.identifier`, så den lagrades som en backend-tjänst. Skicka med en mobilnyckel (steg 1), som lagrar allt den skickar som den här appen, eller sätt dem på SDK:ts resurs, som i steg 2.",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "Klientrader kommer specifikt från `device.model.identifier`. Ett SDK som bara sätter `device.manufacturer` klassificeras som mobilt men listar inga klienter — sätt också `device.model.identifier`.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "Statusen ändras till **Ingen trafik nyligen** efter 15 minuter utan telemetri. Det är väntat medan ingen använder appen. Om din app används:",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- Nyckeln kan ha återkallats efter releasen — kör nyckelkontrollen i steg 3.",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name` är **`Storefront Mobile`**, den här applikationens identifierare — behåll den som den är, annars registreras data som en ny applikation. Den är procentkodad i `OTEL_RESOURCE_ATTRIBUTES`, och SDK:t avkodar den.",
};

export default TRANSLATION;
