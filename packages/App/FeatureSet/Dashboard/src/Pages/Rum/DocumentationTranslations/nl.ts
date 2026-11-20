import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in Dutch (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * Dutch. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "Een webapp waarvan je de code kunt wijzigen en opnieuw uitrollen, met afhankelijkheden die via npm zijn geïnstalleerd",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "De origins van waaruit je site wordt geleverd, zoals `https://app.example.com` — een browsersleutel accepteert alleen verzoeken vanaf de origins die je erop opgeeft",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "Maak het daarna de **eerste** import van je app, zodat de instrumentaties `fetch` patchen voordat er iets anders draait:",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "Vervang `storefront-web` door de naam van je applicatie. Onder die naam verschijnt de app in OneUptime, dus houd hem stabiel: een nieuwe naam registreert een nieuwe applicatie.",
  "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.":
    "> **Alleen `service.name` instellen is niet genoeg.** De OpenTelemetry-SDK's voor de browser voegen geen `browser.*`-attributen toe, tenzij je de resourcedetector voor de browser inschakelt of ze zelf instelt — zonder die attributen wordt dit een backendservice, geen RUM-applicatie.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Kies in stap 1 een ingestiesleutel om `<YOUR_API_KEY>` in te vullen.",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "Voeg het samen met je bestaande `connect-src`-directive. Heeft je site geen Content Security Policy? Sla deze stap dan over.",
  "`200` with `\"valid\": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.":
    "`200` met `\"valid\": true` betekent dat OneUptime de sleutel accepteert — bij een browsersleutel voegt het bericht toe dat hij alleen werkt vanuit een browser, vanaf een van zijn toegestane origins. `401` betekent dat hij onbekend, ingetrokken, uitgeschakeld of verlopen is.",
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "Laad daarna een pagina van je site. Binnen een minuut verschijnt de applicatie onder **Real User Monitoring**, genoemd naar haar `service.name`, met paginaweergaven, foutpercentage en p95-duur.",
  "OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "OneUptime classificeert telemetrie als **RUM** wanneer de resource clientattributen draagt — voor het web een van `browser.platform`, `browser.language` of een niet-lege `browser.brands`. De applicatie wordt herkend aan `service.name` (hoofdletterongevoelig), en haar telemetrie hoort bij deze RUM-applicatie — die wordt nooit nog eens als backendservice opgeslagen.",
  "| Attribute | Required | What it does |":
    "| Attribuut | Verplicht | Wat het doet |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **ja** | De identiteit van de applicatie, bijv. `storefront-web`. Later hernoemen maakt een nieuwe applicatie aan. |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **een ervan** | Markeert de telemetrie als browser-RUM. `browser.platform` vult ook het tabblad **Clients**. |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | nee | Getoond in het overzicht |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector` stelt ze in vanuit de browser. Hij leest de UA Client Hints-API, die alleen Chromium-browsers hebben, dus in Safari en Firefox stelt hij `browser.language` in, maar niet `browser.platform`. Om de attributen zelf in te stellen — zonder de detector, of om elke browser een platform te geven — bouw je de resource zo:",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "Houd `browser.platform` grof: elke afzonderlijke waarde wordt een rij op het tabblad **Clients**.",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "Alles in het browserfragment gaat naar je gebruikers. Het token erin is openbaar — iedereen die de broncode bekijkt, de devtools opent of je bundle leest, kan het kopiëren. Daarom toont en maakt deze gids alleen ingestiesleutels van het type **Browser**, elk met de origins van waaruit je site wordt geleverd:",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- hij wordt alleen vanaf die origins geaccepteerd, dus een gekopieerde sleutel werkt niet op de pagina van iemand anders;",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- hij kan alleen traces, logboeken, metrieken, sessieherhalingen en rapporten van de Sentry-browser-SDK schrijven — geen profielen, source maps, syslog, Fluent, Pyroscope of beveiligingsgebeurtenissen;",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- hij heeft per sleutel een snelheidslimiet, kan met één bewerking worden uitgeschakeld en kan een vervaldatum krijgen.",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "Een origin bevat het schema en een eventuele poort, en mag beginnen met één host-wildcard `*.` — `https://app.example.com`, `https://*.example.com`. Als je ook **Vastgezette servicenaam** op de sleutel instelt, wordt `service.name` afgedwongen op alles wat hij schrijft, zodat een gekopieerde sleutel zijn telemetrie niet kan laten doorgaan voor een van je backendservices. Beide staan op de pagina van de sleutel onder **Projectinstellingen > Telemetrie & APM > Ingestiesleutels**.",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **Lever nooit een server-ingestiesleutel aan een browser.** Een serversleutel heeft volledige ingestietoegang vanaf overal, zonder controle van de origin. Staat hij eenmaal in de broncode van de pagina, dan kan iedereen die hem vindt valse spans, logboeken en metrieken in dit project schrijven — dashboards vervuilen, valse waarschuwingen afvuren en je gefactureerde gebruik opdrijven — totdat je het merkt en hem roteert.",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls` bepaalt welke cross-originverzoeken een W3C-header `traceparent` krijgen, die de browserspan koppelt aan de backendtrace die hij heeft veroorzaakt. Same-originverzoeken worden zonder configuratie doorgegeven.",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**Zet het niet op `/.*/`.** Een extra header maakt van een eenvoudig cross-originverzoek een verzoek met preflight, en elke API van derden die `traceparent` niet in zijn `Access-Control-Allow-Headers` vermeldt, gaat dan falen. Geef alleen origins op die je zelf beheert en hebt geconfigureerd:",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "Verzoeken met `XMLHttpRequest` in plaats van `fetch` hebben `@opentelemetry/instrumentation-xml-http-request` en zijn `XMLHttpRequestInstrumentation` nodig, met dezelfde optie.",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "De OpenTelemetry-SDK voor de browser vangt niet-opgevangen fouten niet automatisch op. Rapporteer ze expliciet, zodat ze naast je backendfouten in de weergave **Uitzonderingen** terechtkomen:",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "Traces zijn genoeg om het overzicht te vullen. Voeg pipelines voor logboeken en metrieken toe als je browserlogboeken in OneUptime wilt doorzoeken, of voor Core Web Vitals:",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object: a pipeline whose resource lacks `browser.*` is filed as a separate backend Service.":
    "Hun exporters versturen naar `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` en `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` met dezelfde header `x-oneuptime-token` — de code staat in [Browser instellen](/docs/rum/browser-setup). Bouw ze met hetzelfde object `resource`: een pipeline waarvan de resource geen `browser.*` heeft, wordt opgeslagen als een aparte backendservice.",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "De kaart **Core Web Vitals** — LCP, INP, CLS, FCP en TTFB — wordt alleen gevuld met metrieken die je app rapporteert, onder namen zoals `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) somt de namen op die OneUptime leest en koppelt de bibliotheek `web-vitals`.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "Elk resourceattribuut met het voorvoegsel `oneuptime.label.` wordt een projectlabel op de applicatie — `oneuptime.label.env` ingesteld op `production` voegt het label `env:production` toe:",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "Gebruik één `service.name` per app, niet per omgeving, en onderscheid omgevingen met een label, zodat elke app één applicatie en één geschiedenis houdt.",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "Om applicaties te labelen of eigenaars op naam toe te wijzen, gebruik je **Real User Monitoring → Instellingen → Labelregels** en **Eigenaarsregels**. Regels draaien wanneer een applicatie wordt aangemaakt, ook via automatische detectie; ze labelen bestaande applicaties niet opnieuw.",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **Overzicht** — paginaweergaven, foutpercentage en p95-duur over een te kiezen tijdsbereik, met trendgrafieken. Ze worden afgeleid van de spans die je instrumentatie uitstuurt, dus een paginaweergave is wat die rapporteert: documentladingen, routewijzigingen, interacties.",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals** — LCP, INP, CLS, FCP en TTFB, zodra je app ze als metrieken rapporteert.",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **Logboeken**, **Traces** en **Metrieken** — de telemetrieverkenners, beperkt tot deze applicatie.",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **Clients** — de browserplatforms waarop de applicatie is gezien, uit `browser.platform`. Grof per platform, nooit per eindgebruiker.",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **Sessieherhaling** — een aparte, optionele recorder met een eigen scripttag en eigen privacyinstellingen: [Sessieherhaling](/docs/telemetry/session-replay).",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "De applicatie toont **Ontvangt gegevens** zolang er telemetrie binnenkomt, en **Geen recent verkeer** na 15 minuten zonder, wat normaal is zolang niemand de app gebruikt.",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "Open DevTools → **Network** en filter op `otlp`: je zoekt `POST /otlp/v1/traces`. Helemaal geen verzoek betekent dat de SDK nooit is gestart:",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts` wordt niet als eerste geïmporteerd. De instrumentaties patchen `fetch`; wat vóór hen wordt geïmporteerd, wordt niet getraced, en als tree-shaking de import verwijdert, draait er helemaal niets.",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- De batchprocessor heeft nog niet geleegd. `BatchSpanProcessor` buffert — wacht ongeveer 30 seconden, of navigeer, voordat je concludeert dat er niets wordt verstuurd.",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- Een omgevingsvariabele uit de build werd `undefined`, dus de URL van de exporter klopt niet. Schrijf hem bij het starten één keer weg.",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **Geblokkeerd door de Content Security Policy** — de console meldt het. Voeg `connect-src 'self' <YOUR_ONEUPTIME_URL>;` toe (stap 4).",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **Geblokkeerd door CORS** — de OTLP-endpoints van OneUptime staan elke origin en de header `x-oneuptime-token` toe, dus een CORS-fout betekent bijna altijd dat het verzoek OneUptime helemaal niet bereikt: een bedrijfsproxy, een adblocker of een typfout in de host.",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`** — voeg de exacte origin van je site (schema, host en poort) toe aan de **Toegestane origins** van de sleutel onder **Projectinstellingen > Telemetrie & APM > Ingestiesleutels**.",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`** — schakel de sleutel daar weer in, of kies in stap 1 een andere sleutel.",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`** — de sleutel is onbekend, ingetrokken of verlopen. Voer de sleutelcontrole uit in stap 5, en kies of maak in stap 1 een geldige browsersleutel.",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`** — de URL klopt niet. De trace-exporter heeft het volledige pad `/otlp/v1/traces` nodig.",
  "The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable `browserDetector` as in step 3, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "De resource draagt geen browserattribuut, dus de telemetrie is opgeslagen als een backendservice. Schakel `browserDetector` in zoals in stap 3, of stel de `browser.*`-attributen zelf in (**Hoe OneUptime een browser-app herkent** onder Geavanceerd).",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "Controleer wat je verstuurt in DevTools → **Network** → het OTLP-verzoek → **Payload**: `resourceSpans[0].resource.attributes` is de lijst die het bepaalt.",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "De service die al is aangemaakt, wordt geen RUM-applicatie — het zijn twee aparte records — dus verwijder hem zodra er RUM-telemetrie binnenkomt.",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "Clientrijen komen uit `browser.platform`. `browserDetector` leest de UA Client Hints-API, die alleen Chromium-browsers hebben: in Safari en Firefox stelt hij `browser.language` in — genoeg om de telemetrie als RUM te classificeren — maar niet `browser.platform`. Stel `browser.platform` zelf in om die clients te tonen (**Hoe OneUptime een browser-app herkent** onder Geavanceerd).",
  "The card is filled only from metrics your app emits. Check, in order:":
    "De kaart wordt alleen gevuld met metrieken die je app uitstuurt. Controleer, in deze volgorde:",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. Je hebt überhaupt een pipeline voor **metrieken** — traces alleen vullen deze kaart nooit.",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. De metrieknamen zijn namen die OneUptime leest — zie [Core Web Vitals](/docs/rum/web-vitals).",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. De metrieken verschijnen op het tabblad **Metrieken** van de applicatie. Zo ja, dan werkt de export en ligt het probleem bij de naam of het gekozen tijdsbereik.",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP en CLS worden gerapporteerd wanneer de pagina wordt verborgen, dus een kort bezoek kan eindigen vóór de volgende export.",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **Controleer het tijdsbereik.** Het overzicht toont standaard het afgelopen uur, dus een test van vanochtend valt erbuiten.",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **Wacht een minuut.** Ingestie loopt via een wachtrij, en een enkele testspan kan tot een minuut nodig hebben om te verschijnen.",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **Controleer het project.** De sleutel bepaalt in welk project de telemetrie terechtkomt.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "De status wordt **Geen recent verkeer** na 15 minuten zonder telemetrie. Dat is te verwachten zolang niemand de app gebruikt. Als je app verkeer heeft:",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- Een **sampler** gooit misschien alles weg — controleer of je geen sampler hebt ingesteld die altijd uit staat of een heel lage ratio heeft.",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- De app verstuurt misschien alleen bij interacties die niemand in dat tijdvak heeft gedaan.",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- De sleutel is na de uitrol misschien ingetrokken — voer de sleutelcontrole uit in stap 5.",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name` is **`storefront-web`**, de identificatie van deze applicatie — laat hem zoals hij is, anders registreren de gegevens zich als een nieuwe applicatie.",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "Een iOS-, Android- of React Native-app met een OpenTelemetry-SDK — opentelemetry-swift, OpenTelemetry Android of de OpenTelemetry-JavaScript-SDK",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "De `service.name` die je app rapporteert — de **Mobiel**-sleutel uit stap 1 is eraan vastgezet",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "Dit zijn de standaardinstellingen van OpenTelemetry: een SDK die ze uit zijn omgeving leest, neemt ze zoals ze zijn. Stel anders hetzelfde endpoint, de header `x-oneuptime-token` en de resourceattributen in code in op de OTLP-exporter en de resource van de SDK — [Mobiel instellen](/docs/rum/mobile-setup) laat het zien voor Android, iOS en React Native.",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "De meeste mobiele SDK's stellen de `device.*`-attributen voor je in. `device.model.identifier` vult het tabblad **Clients**, dus stel het in zoals hierboven als de jouwe dat niet doet.",
  "`200` with `\"valid\": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.":
    "`200` met `\"valid\": true` betekent dat OneUptime de sleutel accepteert, en bij een mobiele sleutel voegt het bericht toe dat hij alleen werkt vanuit een mobiele app. `401` betekent dat hij onbekend, ingetrokken, uitgeschakeld of verlopen is, en geen enkele SDK-configuratie helpt dan.",
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "Start daarna de app. Hij verschijnt met zijn eerste telemetriebatch onder **Real User Monitoring**, genoemd naar de servicenaam waaraan de sleutel is vastgezet.",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "Alles wat een mobiele sleutel verstuurt, wordt opgeslagen als deze mobiele app, onder de servicenaam waaraan de sleutel is vastgezet, wat de resource ook zegt. De sleutel houdt van de resource alleen over wat een app over zichzelf zegt — zoals de attributen `service.*`, `device.*`, `os.*` en `telemetry.*` en de labels `oneuptime.label.*` — en gooit de rest weg, zodat een gekopieerde sleutel zijn telemetrie niet kan laten doorgaan voor een host, een cluster of een backendservice.",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "Met elke andere sleutel classificeert OneUptime telemetrie als **mobiele RUM** wanneer de resource `device.id` of `device.model.identifier` draagt. De applicatie wordt herkend aan `service.name` (hoofdletterongevoelig), en haar telemetrie hoort bij deze RUM-applicatie — die wordt nooit nog eens als backendservice opgeslagen.",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **een ervan** | Markeert de telemetrie als mobiele RUM. `device.model.identifier` vult ook het tabblad **Clients**. |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "`device.manufacturer` markeert een batch ook als mobiel, maar alleen op een resource zonder `host.name` of `host.id` — het geeft ook het merk van een fysieke machine aan in het inventarisitem van een host. Stel ook `device.id` of `device.model.identifier` in, dan speelt het onderscheid nooit.",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id` moet een identificatie per installatie zijn, geen advertentie-ID en niets wat een persoon identificeert.",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs and metrics, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **Iedereen die je app heeft, kan de sleutel ervan kopiëren.** Daarom is het een mobiele sleutel: een kopie kan alleen de traces, logboeken en metrieken van deze app versturen, opgeslagen onder de servicenaam waaraan de sleutel is vastgezet, en nooit vanaf een webpagina. Hij kan nog steeds verzonnen gegevens voor deze app versturen, tot de limiet van de sleutel, dus geef hem een vervaldatum, roteer de sleutel met je releases en schakel hem uit als hij wordt misbruikt.",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "Dit staat allemaal op de pagina van de sleutel onder **Projectinstellingen > Telemetrie & APM > Ingestiesleutels**: **Vastgezette servicenaam** is de app waaronder alles wordt opgeslagen wat de sleutel verstuurt, **Limiet voor verzoeken per minuut** begrenst de sleutel over alle kopieën van je app, **Verloopt om** laat hem na een datum niet meer accepteren, en **Ingeschakeld** schakelt hem meteen uit.",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "Lever in plaats daarvan nooit een **Server**-sleutel mee in een app: die kan elk soort telemetrie in dit project schrijven, vanaf overal, als elke service.",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android** — de agent [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) (`io.opentelemetry.android:android-agent`) stelt `device.model.identifier`, `device.model.name` en `device.manufacturer` in op zijn eigen resource, dus de classificatie werkt zonder extra configuratie, en hij rapporteert zelf crashes, ANR's, trage en bevroren frames, app-starts en sessies. Hij noemt de app naar het label in de launcher, tenzij je `service.name` instelt, en hij verstuurt geen `device.id`. [Android instellen](/docs/rum/android-setup) heeft de Gradle-afhankelijkheid, de code en wat elk ervan in OneUptime wordt.",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift** — stel met [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift) `device.model.identifier` en `device.manufacturer` zelf in op de resource: de resource die een SDK-versie bijdraagt, is tussen releases veranderd.",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app.":
    "- **React Native / Expo** — draait de JavaScript-SDK, dus de instelling is die voor de browser uit [Browser instellen](/docs/rum/browser-setup), met twee verschillen: er is geen `browserDetector`, en je stelt `device.manufacturer` en `device.model.identifier` zelf in, zodat het tabblad **Clients** de apparaten toont. Hij verstuurt met een **Mobiel**-sleutel, zoals elke mobiele app.",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **Al het andere** — Flutter, Unity, .NET MAUI of een zelfgeschreven OTLP-writer werken op dezelfde manier, zolang de resource `service.name` plus één `device.*`-attribuut draagt.",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "De mobiele OpenTelemetry-SDK's veranderen hun builder-API's tussen releases. [Mobiel instellen](/docs/rum/mobile-setup) heeft code voor elk ervan; controleer de methodenamen met de versie die je vastzet.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "Elk resourceattribuut met het voorvoegsel `oneuptime.label.` wordt een projectlabel op de applicatie — `oneuptime.label.env=production` voegt het label `env:production` toe:",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **Overzicht** — gebeurtenissen, foutpercentage en p95-duur over een te kiezen tijdsbereik, met trendgrafieken, afgeleid van de spans die je instrumentatie uitstuurt.",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **Uitzonderingen** — de crashes en ANR's die je app rapporteert, als onafgehandelde uitzonderingen, in het overzicht en onder **Uitzonderingen**. OpenTelemetry Android rapporteert beide zelf; een ANR staat vermeld met het type `ANR`.",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **Clients** — de apparaatmodellen waarop de applicatie is gezien, uit `device.model.identifier`. Grof per model, nooit per eindgebruiker.",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "Een `401` betekent dat de sleutel onbekend, ingetrokken, uitgeschakeld of verlopen is: kies of maak in stap 1 een mobiele sleutel en bouw de app er opnieuw mee.",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and never from a web page: an SDK that exports over gRPC, or a request that carries an `Origin` header, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "Een `422` zegt wat er is geweigerd. Een mobiele sleutel verstuurt alleen de OTLP-traces, -logboeken en -metrieken van de app, via HTTP, en nooit vanaf een webpagina: een SDK die via gRPC exporteert, of een verzoek met een `Origin`-header, wordt geweigerd. Een browsersleutel doorstaat de controle, maar wordt vanuit een mobiele app geweigerd, omdat hij een `Origin`-header nodig heeft en mobiele SDK's die niet versturen.",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "De telemetrie is verstuurd met een serversleutel, en de resource draagt geen `device.id` of `device.model.identifier`, dus is hij opgeslagen als een backendservice. Verstuur met een mobiele sleutel (stap 1), die alles wat hij verstuurt als deze app opslaat, of stel ze in op de resource van de SDK, zoals in stap 2.",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "Clientrijen komen specifiek uit `device.model.identifier`. Een SDK die alleen `device.manufacturer` instelt, wordt als mobiel geclassificeerd, maar toont geen clients — stel ook `device.model.identifier` in.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "De status wordt **Geen recent verkeer** na 15 minuten zonder telemetrie. Dat is te verwachten zolang niemand de app gebruikt. Als je app in gebruik is:",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- De sleutel is na de release misschien ingetrokken — voer de sleutelcontrole uit in stap 3.",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name` is **`Storefront Mobile`**, de identificatie van deze applicatie — laat hem zoals hij is, anders registreren de gegevens zich als een nieuwe applicatie. In `OTEL_RESOURCE_ATTRIBUTES` is hij procentgecodeerd, en de SDK decodeert hem.",
};

export default TRANSLATION;
