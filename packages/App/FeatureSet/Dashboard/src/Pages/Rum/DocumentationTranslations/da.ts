import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in Danish (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * Danish. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "En webapp, hvis kode du kan ændre og udrulle igen, med afhængigheder installeret via npm",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "De oprindelser, dit websted leveres fra, såsom `https://app.example.com` — en browsernøgle accepterer kun anmodninger fra de oprindelser, du angiver på den",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "Gør den derefter til din apps **første** import, så instrumenteringerne patcher `fetch`, før noget andet kører:",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "Erstat `storefront-web` med din applikations navn. Det er det navn, appen vises under i OneUptime, så hold det stabilt: et nyt navn registrerer en ny applikation.",
  "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.":
    "> **Det er ikke nok at sætte `service.name` alene.** OpenTelemetrys browser-SDK'er tilføjer ikke `browser.*`-attributter, medmindre du slår browserens ressourcedetektor til eller sætter dem selv — uden dem bliver det en backend-tjeneste, ikke en RUM-applikation.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Vælg en indtagelsesnøgle i trin 1 for at udfylde `<YOUR_API_KEY>`.",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "Flet den ind i dit eksisterende `connect-src`-direktiv. Har dit websted ingen Content Security Policy? Så spring dette trin over.",
  "`200` with `\"valid\": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.":
    "`200` med `\"valid\": true` betyder, at OneUptime accepterer nøglen — for en browsernøgle tilføjer beskeden, at den kun virker fra en browser, fra en af dens tilladte oprindelser. `401` betyder, at den er ukendt, tilbagekaldt, deaktiveret eller udløbet.",
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "Indlæs derefter en side på dit websted. Inden for et minut vises applikationen under **Overvågning af reelle brugere**, navngivet efter dens `service.name`, med sidevisninger, fejlrate og p95-varighed.",
  "OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "OneUptime klassificerer telemetri som **RUM**, når dens ressource bærer klientattributter — for web en af `browser.platform`, `browser.language` eller en ikke-tom `browser.brands`. Applikationen genkendes på `service.name` (uden forskel på store og små bogstaver), og dens telemetri tilhører denne RUM-applikation — den gemmes aldrig dobbelt som en backend-tjeneste.",
  "| Attribute | Required | What it does |":
    "| Attribut | Påkrævet | Hvad den gør |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **ja** | Applikationens identitet, f.eks. `storefront-web`. At omdøbe den senere opretter en ny applikation. |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **en af dem** | Markerer telemetrien som browser-RUM. `browser.platform` udfylder også fanen **Klienter**. |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | nej | Vises i oversigten |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector` sætter dem fra browseren. Den læser UA Client Hints-API'et, som kun Chromium-browsere har, så i Safari og Firefox sætter den `browser.language`, men ikke `browser.platform`. For at sætte attributterne selv — uden detektoren, eller for at give hver browser en platform — bygger du ressourcen sådan her:",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "Hold `browser.platform` grov: hver forskellig værdi bliver en række under fanen **Klienter**.",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "Alt i browserens kodestykke sendes til dine brugere. Tokenet i det er offentligt — alle, der ser kildekoden, åbner udviklerværktøjerne eller læser dit bundle, kan kopiere det. Derfor viser og opretter denne guide kun indtagelsesnøgler af typen **Browser**, hver med de oprindelser, dit websted leveres fra:",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- den accepteres kun fra disse oprindelser, så en kopieret nøgle virker ikke på en andens side;",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- den kan kun skrive spor, protokoller, metrikker, sessionsafspilninger og rapporter fra Sentrys browser-SDK — ikke profiler, source maps, syslog, Fluent, Pyroscope eller sikkerhedshændelser;",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- den har en hastighedsgrænse pr. nøgle, kan slås fra med én redigering og kan få en udløbsdato.",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "En oprindelse omfatter skemaet og en eventuel port og må begynde med ét værtsjokertegn `*.` — `https://app.example.com`, `https://*.example.com`. Sætter du også **Fastgjort tjenestenavn** på nøglen, tvinges `service.name` på alt, hvad den skriver, så en kopieret nøgle ikke kan udgive sin telemetri for en af dine backend-tjenester. Begge findes på nøglens side under **Projektindstillinger > Telemetri og APM > Indtagelsesnøgler**.",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **Send aldrig en server-indtagelsesnøgle til en browser.** En servernøgle har fuld indtagelsesadgang fra hvor som helst, uden kontrol af oprindelse. Når den først står i sidens kildekode, kan alle, der finder den, skrive falske spans, protokoller og metrikker i dette projekt — forurene dashboards, udløse falske advarsler og drive dit afregnede forbrug op — indtil du opdager det og udskifter den.",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls` afgør, hvilke anmodninger på tværs af oprindelser der får en W3C-header `traceparent`, som forbinder browserens span med det backend-spor, den udløste. Anmodninger fra samme oprindelse videreføres uden nogen konfiguration.",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**Sæt den ikke til `/.*/`.** En ekstra header gør en simpel anmodning på tværs af oprindelser til en med preflight, og ethvert tredjeparts-API, der ikke angiver `traceparent` i sine `Access-Control-Allow-Headers`, begynder at fejle. Angiv kun oprindelser, du selv styrer og har konfigureret:",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "Anmodninger lavet med `XMLHttpRequest` i stedet for `fetch` kræver `@opentelemetry/instrumentation-xml-http-request` og dens `XMLHttpRequestInstrumentation`, med samme indstilling.",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "OpenTelemetrys browser-SDK fanger ikke automatisk ufangede fejl. Rapportér dem eksplicit, så de havner i visningen **Undtagelser** ved siden af dine backend-fejl:",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "Spor er nok til at udfylde oversigten. Tilføj pipelines til protokoller og metrikker, hvis du vil kunne søge i browserprotokoller i OneUptime, eller til Core Web Vitals:",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object: a pipeline whose resource lacks `browser.*` is filed as a separate backend Service.":
    "Deres eksportører sender til `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` og `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` med samme header `x-oneuptime-token` — koden står i [Opsætning af browser](/docs/rum/browser-setup). Byg dem med samme objekt `resource`: en pipeline, hvis ressource mangler `browser.*`, gemmes som en separat backend-tjeneste.",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "Kortet **Core Web Vitals** — LCP, INP, CLS, FCP og TTFB — udfyldes kun fra metrikker, din app rapporterer, under navne som `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) viser de navne, OneUptime læser, og kobler biblioteket `web-vitals` på.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "Enhver ressourceattribut med præfikset `oneuptime.label.` bliver en projektetiket på applikationen — `oneuptime.label.env` sat til `production` tilføjer etiketten `env:production`:",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "Brug ét `service.name` pr. app, ikke pr. miljø, og skeln mellem miljøer med en etiket, så hver app beholder én applikation og én historik.",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "For at mærke applikationer eller tildele ejere efter navn bruger du **Overvågning af reelle brugere → Indstillinger → Etiketregler** og **Ejerregler**. Regler kører, når en applikation oprettes, også ved automatisk registrering; de mærker ikke eksisterende applikationer om.",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **Oversigt** — sidevisninger, fejlrate og p95-varighed over et valgfrit tidsrum med tendensgrafer. De udledes af de spans, din instrumentering udsender, så en sidevisning er det, den rapporterer: dokumentindlæsninger, ruteskift, interaktioner.",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals** — LCP, INP, CLS, FCP og TTFB, når din app rapporterer dem som metrikker.",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **Protokoller**, **Spor** og **Metrikker** — telemetri-stifinderne, afgrænset til denne applikation.",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **Klienter** — de browserplatforme, applikationen er set på, fra `browser.platform`. Groft pr. platform, aldrig pr. slutbruger.",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **Sessionsafspilning** — en separat, valgfri optager med sit eget script-tag og egne privatlivsindstillinger: [Sessionsafspilning](/docs/telemetry/session-replay).",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "Applikationen viser **Modtager data**, mens telemetrien bliver ved med at komme, og **Ingen nylig trafik** efter 15 minutter uden, hvilket er normalt, mens ingen bruger appen.",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "Åbn DevTools → **Network**, og filtrér på `otlp`: du leder efter `POST /otlp/v1/traces`. Ingen anmodning overhovedet betyder, at SDK'et aldrig startede:",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts` importeres ikke først. Instrumenteringerne patcher `fetch`; alt, der importeres før dem, spores ikke, og hvis importen fjernes ved tree-shaking, kører der slet intet.",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- Batchprocessoren har ikke tømt sin buffer endnu. `BatchSpanProcessor` bufferer — vent omkring 30 sekunder, eller naviger, før du konkluderer, at intet sendes.",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- En miljøvariabel fra bygningen blev til `undefined`, så eksportørens URL er forkert. Skriv den ud én gang ved opstart.",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **Blokeret af Content Security Policy** — konsollen siger det. Tilføj `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (trin 4).",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **Blokeret af CORS** — OneUptimes OTLP-endpoints tillader enhver oprindelse og headeren `x-oneuptime-token`, så en CORS-fejl betyder næsten altid, at anmodningen slet ikke når OneUptime: en firmaproxy, en reklameblokering eller en tastefejl i værten.",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`** — tilføj dit websteds præcise oprindelse (skema, vært og port) til nøglens **Tilladte oprindelser** under **Projektindstillinger > Telemetri og APM > Indtagelsesnøgler**.",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`** — slå nøglen til igen der, eller vælg en anden nøgle i trin 1.",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`** — nøglen er ukendt, tilbagekaldt eller udløbet. Kør nøglekontrollen i trin 5, og vælg eller opret en gyldig browsernøgle i trin 1.",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`** — URL'en er forkert. Sporeksportøren skal have den fulde sti, `/otlp/v1/traces`.",
  "The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable `browserDetector` as in step 3, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "Ressourcen bærer ingen browserattribut, så telemetrien blev gemt som en backend-tjeneste. Slå `browserDetector` til som i trin 3, eller sæt `browser.*`-attributterne selv (**Sådan genkender OneUptime en browserapp** under Avanceret).",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "Kontrollér, hvad du sender, i DevTools → **Network** → OTLP-anmodningen → **Payload**: `resourceSpans[0].resource.attributes` er listen, der afgør det.",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "Den tjeneste, der allerede er oprettet, bliver ikke til en RUM-applikation — de er to separate poster — så slet den, når RUM-telemetrien ankommer.",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "Klientrækker kommer fra `browser.platform`. `browserDetector` læser UA Client Hints-API'et, som kun Chromium-browsere har: i Safari og Firefox sætter den `browser.language` — nok til at klassificere telemetrien som RUM — men ikke `browser.platform`. Sæt `browser.platform` selv for at vise disse klienter (**Sådan genkender OneUptime en browserapp** under Avanceret).",
  "The card is filled only from metrics your app emits. Check, in order:":
    "Kortet udfyldes kun fra metrikker, din app udsender. Kontrollér i denne rækkefølge:",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. Du har overhovedet en pipeline til **metrikker** — spor alene udfylder aldrig dette kort.",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. Metriknavnene er nogle, OneUptime læser — se [Core Web Vitals](/docs/rum/web-vitals).",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. Metrikkerne vises under applikationens fane **Metrikker**. Gør de det, virker eksporten, og problemet er navnet eller det valgte tidsrum.",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP og CLS rapporteres, når siden skjules, så et kort besøg kan slutte før næste eksport.",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **Kontrollér tidsrummet.** Oversigten viser som standard den seneste time, så en test fra i morges ligger uden for.",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **Vent et minut.** Indtagelsen går gennem en kø, og et enkelt test-span kan tage op til et minut om at blive vist.",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **Kontrollér projektet.** Nøglen afgør, hvilket projekt telemetrien lander i.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "Status skifter til **Ingen nylig trafik** efter 15 minutter uden telemetri. Det er forventeligt, mens ingen bruger appen. Hvis din app har trafik:",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- En **sampler** smider måske alt væk — kontrollér, at du ikke har sat en sampler, der altid er slået fra, eller som har en meget lav rate.",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- Appen sender måske kun ved interaktioner, som ingen foretog i det tidsrum.",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- Nøglen er måske blevet tilbagekaldt efter udrulningen — kør nøglekontrollen i trin 5.",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name` er **`storefront-web`**, denne applikations identifikator — behold den, som den er, ellers registreres dataene som en ny applikation.",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "En iOS-, Android- eller React Native-app med et OpenTelemetry-SDK — opentelemetry-swift, OpenTelemetry Android eller OpenTelemetrys JavaScript-SDK",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "Det `service.name`, din app rapporterer — **Mobil**-nøglen fra trin 1 er fastgjort til det",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "Det er OpenTelemetrys standardindstillinger: et SDK, der læser dem fra sit miljø, tager dem, som de er. Ellers sætter du samme endpoint, headeren `x-oneuptime-token` og ressourceattributterne i koden på SDK'ets OTLP-eksportør og ressource — [Opsætning af mobil](/docs/rum/mobile-setup) viser det for Android, iOS og React Native.",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "De fleste mobile SDK'er sætter `device.*`-attributterne for dig. `device.model.identifier` udfylder fanen **Klienter**, så sæt den som ovenfor, hvis dit ikke gør det.",
  "`200` with `\"valid\": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.":
    "`200` med `\"valid\": true` betyder, at OneUptime accepterer nøglen, og for en mobilnøgle tilføjer beskeden, at den kun virker fra en mobilapp. `401` betyder, at den er ukendt, tilbagekaldt, deaktiveret eller udløbet, og ingen SDK-konfiguration hjælper.",
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "Start derefter appen. Den vises under **Overvågning af reelle brugere** med sin første telemetri-batch, navngivet efter det tjenestenavn, nøglen er fastgjort til.",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "Alt, hvad en mobilnøgle sender, gemmes som denne mobilapp, under det tjenestenavn, nøglen er fastgjort til, uanset hvad dens ressource siger. Nøglen beholder kun det af ressourcen, som en app siger om sig selv — såsom dens attributter `service.*`, `device.*`, `os.*` og `telemetry.*` og dens etiketter `oneuptime.label.*` — og smider resten væk, så en kopieret nøgle ikke kan udgive sin telemetri for en vært, en klynge eller en backend-tjeneste.",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "Med enhver anden nøgle klassificerer OneUptime telemetri som **mobil RUM**, når dens ressource bærer `device.id` eller `device.model.identifier`. Applikationen genkendes på `service.name` (uden forskel på store og små bogstaver), og dens telemetri tilhører denne RUM-applikation — den gemmes aldrig dobbelt som en backend-tjeneste.",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **en af dem** | Markerer telemetrien som mobil RUM. `device.model.identifier` udfylder også fanen **Klienter**. |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "`device.manufacturer` markerer også en batch som mobil, men kun på en ressource uden `host.name` eller `host.id` — den angiver også mærket på en fysisk maskine i en værts lagerpost. Sæt også `device.id` eller `device.model.identifier`, så opstår skelnen aldrig.",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id` bør være en identifikator pr. installation, ikke et reklame-id eller noget, der identificerer en person.",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs and metrics, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **Alle, der har din app, kan kopiere dens nøgle.** Derfor er det en mobilnøgle: en kopi kan kun sende denne apps spor, protokoller og metrikker, gemt under det tjenestenavn, nøglen er fastgjort til, og aldrig fra en webside. Den kan stadig sende opdigtede data for denne app, op til nøglens grænse, så giv den en udløbsdato, udskift nøglen med dine udgivelser, og slå den fra, hvis den misbruges.",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "Alt dette findes på nøglens side under **Projektindstillinger > Telemetri og APM > Indtagelsesnøgler**: **Fastgjort tjenestenavn** er den app, alt, hvad nøglen sender, gemmes under, **Grænse for anmodninger pr. minut** begrænser nøglen på tværs af alle kopier af din app, **Udløber den** stopper accepten efter en dato, og **Aktiveret** slår den fra med det samme.",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "Send aldrig i stedet en **Server**-nøgle med i en app: den kan skrive enhver slags telemetri i dette projekt, fra hvor som helst, som en hvilken som helst tjeneste.",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android** — agenten [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) (`io.opentelemetry.android:android-agent`) sætter `device.model.identifier`, `device.model.name` og `device.manufacturer` på sin egen ressource, så klassificeringen virker uden ekstra konfiguration, og den rapporterer selv nedbrud, ANR'er, langsomme og frosne billeder, appstarter og sessioner. Den navngiver appen efter dens launcher-etiket, medmindre du sætter `service.name`, og den sender ingen `device.id`. [Opsætning af Android](/docs/rum/android-setup) har Gradle-afhængigheden, koden og hvad hver af dem bliver til i OneUptime.",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift** — med [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift) sætter du selv `device.model.identifier` og `device.manufacturer` på ressourcen: den ressource, en SDK-version tilføjer, har ændret sig mellem udgivelser.",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app.":
    "- **React Native / Expo** — kører JavaScript-SDK'et, så opsætningen er browserens fra [Opsætning af browser](/docs/rum/browser-setup) med to forskelle: der er ingen `browserDetector`, og du sætter selv `device.manufacturer` og `device.model.identifier`, så fanen **Klienter** viser enhederne. Den sender med en **Mobil**-nøgle, ligesom enhver mobilapp.",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **Alt andet** — Flutter, Unity, .NET MAUI eller en håndskrevet OTLP-skriver virker på samme måde, så længe ressourcen bærer `service.name` plus én `device.*`-attribut.",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "De mobile OpenTelemetry-SDK'er ændrer deres builder-API'er mellem udgivelser. [Opsætning af mobil](/docs/rum/mobile-setup) har kode til hver; kontrollér metodenavnene mod den version, du fastlåser.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "Enhver ressourceattribut med præfikset `oneuptime.label.` bliver en projektetiket på applikationen — `oneuptime.label.env=production` tilføjer etiketten `env:production`:",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **Oversigt** — hændelser, fejlrate og p95-varighed over et valgfrit tidsrum med tendensgrafer, udledt af de spans, din instrumentering udsender.",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **Undtagelser** — de nedbrud og ANR'er, din app rapporterer, som ubehandlede undtagelser, i oversigten og under **Undtagelser**. OpenTelemetry Android rapporterer begge selv; en ANR vises med typen `ANR`.",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **Klienter** — de enhedsmodeller, applikationen er set på, fra `device.model.identifier`. Groft pr. model, aldrig pr. slutbruger.",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "En `401` betyder, at nøglen er ukendt, tilbagekaldt, deaktiveret eller udløbet: vælg eller opret en mobilnøgle i trin 1, og byg appen igen med den.",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and never from a web page: an SDK that exports over gRPC, or a request that carries an `Origin` header, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "En `422` siger, hvad der blev afvist. En mobilnøgle sender kun appens OTLP-spor, -protokoller og -metrikker, over HTTP, og aldrig fra en webside: et SDK, der eksporterer over gRPC, eller en anmodning med en `Origin`-header, afvises. En browsernøgle består kontrollen, men afvises fra en mobilapp, fordi den kræver en `Origin`-header, og mobile SDK'er sender ingen.",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "Telemetrien blev sendt med en servernøgle, og dens ressource bærer ingen `device.id` eller `device.model.identifier`, så den blev gemt som en backend-tjeneste. Send med en mobilnøgle (trin 1), som gemmer alt, hvad den sender, som denne app, eller sæt dem på SDK'ets ressource som i trin 2.",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "Klientrækker kommer specifikt fra `device.model.identifier`. Et SDK, der kun sætter `device.manufacturer`, klassificeres som mobil, men viser ingen klienter — sæt også `device.model.identifier`.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "Status skifter til **Ingen nylig trafik** efter 15 minutter uden telemetri. Det er forventeligt, mens ingen bruger appen. Hvis din app er i brug:",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- Nøglen er måske blevet tilbagekaldt efter udgivelsen — kør nøglekontrollen i trin 3.",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name` er **`Storefront Mobile`**, denne applikations identifikator — behold den, som den er, ellers registreres dataene som en ny applikation. Den er procentkodet i `OTEL_RESOURCE_ATTRIBUTES`, og SDK'et afkoder den.",
};

export default TRANSLATION;
