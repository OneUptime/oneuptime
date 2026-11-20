import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in Norwegian (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * Norwegian. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "En nettapp der du kan endre koden og rulle ut på nytt, med avhengigheter installert via npm",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "Opprinnelsene nettstedet ditt leveres fra, for eksempel `https://app.example.com` — en nettlesernøkkel godtar bare forespørsler fra opprinnelsene du oppgir på den",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "Gjør den deretter til appens **første** import, slik at instrumenteringene patcher `fetch` før noe annet kjører:",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "Erstatt `storefront-web` med applikasjonens navn. Det er navnet appen vises under i OneUptime, så hold det stabilt: et nytt navn registrerer en ny applikasjon.",
  "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.":
    "> **Det holder ikke å sette `service.name` alene.** OpenTelemetrys nettleser-SDK-er legger ikke til `browser.*`-attributter med mindre du slår på nettleserens ressursdetektor eller setter dem selv — uten dem blir dette en backend-tjeneste, ikke en RUM-applikasjon.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Velg en inntaksnøkkel i trinn 1 for å fylle ut `<YOUR_API_KEY>`.",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "Slå den sammen med det eksisterende `connect-src`-direktivet ditt. Har ikke nettstedet ditt noen Content Security Policy? Hopp over dette trinnet.",
  "`200` with `\"valid\": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.":
    "`200` med `\"valid\": true` betyr at OneUptime godtar nøkkelen — for en nettlesernøkkel legger meldingen til at den bare virker fra en nettleser, fra en av de tillatte opprinnelsene. `401` betyr at den er ukjent, tilbakekalt, deaktivert eller utløpt.",
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "Last deretter inn en side på nettstedet ditt. I løpet av et minutt vises applikasjonen under **Overvåking av reelle brukere**, oppkalt etter sitt `service.name`, med sidevisninger, feilrate og p95-varighet.",
  "OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "OneUptime klassifiserer telemetri som **RUM** når ressursen har klientattributter — for nett ett av `browser.platform`, `browser.language` eller en ikke-tom `browser.brands`. Applikasjonen kjennes igjen på `service.name` (uten forskjell på store og små bokstaver), og telemetrien hører til denne RUM-applikasjonen — den lagres aldri i tillegg som en backend-tjeneste.",
  "| Attribute | Required | What it does |":
    "| Attributt | Påkrevd | Hva det gjør |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **ja** | Applikasjonens identitet, f.eks. `storefront-web`. Å gi det nytt navn senere oppretter en ny applikasjon. |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **ett av dem** | Merker telemetrien som nettleser-RUM. `browser.platform` fyller også fanen **Klienter**. |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | nei | Vises i oversikten |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector` setter dem fra nettleseren. Den leser UA Client Hints-API-et, som bare Chromium-nettlesere har, så i Safari og Firefox setter den `browser.language`, men ikke `browser.platform`. For å sette attributtene selv — uten detektoren, eller for å gi hver nettleser en plattform — bygger du ressursen slik:",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "Hold `browser.platform` grov: hver forskjellige verdi blir en rad i fanen **Klienter**.",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "Alt i nettleserens kodebit havner hos brukerne dine. Tokenet i den er offentlig — alle som ser kildekoden, åpner utviklerverktøyene eller leser bundle-en din, kan kopiere det. Derfor viser og oppretter denne veiledningen bare inntaksnøkler av typen **Nettleser**, hver med opprinnelsene nettstedet ditt leveres fra:",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- den godtas bare fra disse opprinnelsene, så en kopiert nøkkel virker ikke på noen andres side;",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- den kan bare skrive spor, logger, målinger, øktavspillinger og rapporter fra Sentrys nettleser-SDK — ikke profiler, source maps, syslog, Fluent, Pyroscope eller sikkerhetshendelser;",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- den har en hastighetsgrense per nøkkel, kan slås av med én redigering og kan få en utløpsdato.",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "En opprinnelse omfatter skjemaet og eventuell port, og kan begynne med ett vertsjokertegn `*.` — `https://app.example.com`, `https://*.example.com`. Setter du også **Festet tjenestenavn** på nøkkelen, tvinges `service.name` på alt den skriver, slik at en kopiert nøkkel ikke kan utgi telemetrien sin for en av backend-tjenestene dine. Begge finnes på nøkkelens side under **Prosjektinnstillinger > Telemetri og APM > Inntaksnøkler**.",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **Send aldri en server-inntaksnøkkel til en nettleser.** En servernøkkel har full inntakstilgang fra hvor som helst, uten kontroll av opprinnelse. Når den først står i sidens kildekode, kan alle som finner den, skrive falske spans, logger og målinger til dette prosjektet — forurense dashbord, utløse falske varsler og drive opp det fakturerte forbruket ditt — til du oppdager det og roterer den.",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls` avgjør hvilke forespørsler på tvers av opprinnelser som får en W3C-header `traceparent`, som kobler nettleserens span til backend-sporet den utløste. Forespørsler fra samme opprinnelse videreføres uten noen konfigurasjon.",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**Ikke sett den til `/.*/`.** En ekstra header gjør en enkel forespørsel på tvers av opprinnelser til en med preflight, og ethvert tredjeparts-API som ikke oppgir `traceparent` i sine `Access-Control-Allow-Headers`, begynner å feile. Oppgi bare opprinnelser du selv kontrollerer og har konfigurert:",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "Forespørsler laget med `XMLHttpRequest` i stedet for `fetch` trenger `@opentelemetry/instrumentation-xml-http-request` og dens `XMLHttpRequestInstrumentation`, med samme innstilling.",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "OpenTelemetrys nettleser-SDK fanger ikke automatisk opp ubehandlede feil. Rapporter dem eksplisitt, slik at de havner i visningen **Unntak** ved siden av backend-feilene dine:",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "Spor er nok til å fylle oversikten. Legg til pipelines for logger og målinger hvis du vil kunne søke i nettleserlogger i OneUptime, eller for Core Web Vitals:",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object: a pipeline whose resource lacks `browser.*` is filed as a separate backend Service.":
    "Eksportørene deres sender til `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` og `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` med samme header `x-oneuptime-token` — koden står i [Oppsett av nettleser](/docs/rum/browser-setup). Bygg dem med samme objekt `resource`: en pipeline der ressursen mangler `browser.*`, lagres som en separat backend-tjeneste.",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "Kortet **Core Web Vitals** — LCP, INP, CLS, FCP og TTFB — fylles bare fra målinger appen din rapporterer, under navn som `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) viser navnene OneUptime leser, og kobler på biblioteket `web-vitals`.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "Ethvert ressursattributt med prefikset `oneuptime.label.` blir en prosjektetikett på applikasjonen — `oneuptime.label.env` satt til `production` legger til etiketten `env:production`:",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "Bruk ett `service.name` per app, ikke per miljø, og skill miljøer med en etikett, slik at hver app beholder én applikasjon og én historikk.",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "For å merke applikasjoner eller tildele eiere etter navn bruker du **Overvåking av reelle brukere → Innstillinger → Etikettregler** og **Eierregler**. Regler kjører når en applikasjon opprettes, også ved automatisk oppdagelse; de merker ikke eksisterende applikasjoner på nytt.",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **Oversikt** — sidevisninger, feilrate og p95-varighet over et valgfritt tidsrom, med trendgrafer. De utledes fra spansene instrumenteringen din sender ut, så en sidevisning er det den rapporterer: dokumentinnlastinger, ruteendringer, interaksjoner.",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals** — LCP, INP, CLS, FCP og TTFB, når appen din rapporterer dem som målinger.",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **Logger**, **Spor** og **Målinger** — telemetriutforskerne, avgrenset til denne applikasjonen.",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **Klienter** — nettleserplattformene applikasjonen er sett på, fra `browser.platform`. Grovt per plattform, aldri per sluttbruker.",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **Øktavspilling** — en separat, valgfri opptaker med egen script-tag og egne personverninnstillinger: [Øktavspilling](/docs/telemetry/session-replay).",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "Applikasjonen viser **Mottar data** så lenge telemetrien fortsetter å komme, og **Ingen nylig trafikk** etter 15 minutter uten, noe som er normalt mens ingen bruker appen.",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "Åpne DevTools → **Network** og filtrer på `otlp`: du ser etter `POST /otlp/v1/traces`. Ingen forespørsel i det hele tatt betyr at SDK-en aldri startet:",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts` importeres ikke først. Instrumenteringene patcher `fetch`; det som importeres før dem, spores ikke, og hvis importen fjernes ved tree-shaking, kjører ingenting i det hele tatt.",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- Batchprosessoren har ikke tømt bufferen ennå. `BatchSpanProcessor` bufrer — vent omtrent 30 sekunder, eller naviger, før du konkluderer med at ingenting sendes.",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- En miljøvariabel fra byggingen ble `undefined`, så eksportørens URL er feil. Skriv den ut én gang ved oppstart.",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **Blokkert av Content Security Policy** — konsollen sier det. Legg til `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (trinn 4).",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **Blokkert av CORS** — OneUptimes OTLP-endepunkter tillater enhver opprinnelse og headeren `x-oneuptime-token`, så en CORS-feil betyr nesten alltid at forespørselen ikke når OneUptime i det hele tatt: en bedriftsproxy, en reklameblokkering eller en skrivefeil i verten.",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`** — legg til nettstedets nøyaktige opprinnelse (skjema, vert og port) i nøkkelens **Tillatte opprinnelser** under **Prosjektinnstillinger > Telemetri og APM > Inntaksnøkler**.",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`** — slå på nøkkelen igjen der, eller velg en annen nøkkel i trinn 1.",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`** — nøkkelen er ukjent, tilbakekalt eller utløpt. Kjør nøkkelkontrollen i trinn 5, og velg eller opprett en gyldig nettlesernøkkel i trinn 1.",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`** — URL-en er feil. Sporeksportøren trenger hele banen, `/otlp/v1/traces`.",
  "The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable `browserDetector` as in step 3, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "Ressursen har ikke noe nettleserattributt, så telemetrien ble lagret som en backend-tjeneste. Slå på `browserDetector` som i trinn 3, eller sett `browser.*`-attributtene selv (**Slik gjenkjenner OneUptime en nettleserapp** under Avansert).",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "Kontroller hva du sender, i DevTools → **Network** → OTLP-forespørselen → **Payload**: `resourceSpans[0].resource.attributes` er listen som avgjør det.",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "Tjenesten som allerede er opprettet, blir ikke til en RUM-applikasjon — de er to separate poster — så slett den når RUM-telemetrien kommer.",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "Klientrader kommer fra `browser.platform`. `browserDetector` leser UA Client Hints-API-et, som bare Chromium-nettlesere har: i Safari og Firefox setter den `browser.language` — nok til å klassifisere telemetrien som RUM — men ikke `browser.platform`. Sett `browser.platform` selv for å vise disse klientene (**Slik gjenkjenner OneUptime en nettleserapp** under Avansert).",
  "The card is filled only from metrics your app emits. Check, in order:":
    "Kortet fylles bare fra målinger appen din sender ut. Kontroller, i denne rekkefølgen:",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. At du i det hele tatt har en pipeline for **målinger** — spor alene fyller aldri dette kortet.",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. At målingsnavnene er navn OneUptime leser — se [Core Web Vitals](/docs/rum/web-vitals).",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. At målingene vises i applikasjonens fane **Målinger**. Gjør de det, virker eksporten, og problemet er navnet eller det valgte tidsrommet.",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP og CLS rapporteres når siden skjules, så et kort besøk kan ende før neste eksport.",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **Kontroller tidsrommet.** Oversikten viser som standard den siste timen, så en test fra i morges faller utenfor.",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **Vent et minutt.** Inntaket går gjennom en kø, og ett enkelt test-span kan bruke opptil et minutt på å dukke opp.",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **Kontroller prosjektet.** Nøkkelen avgjør hvilket prosjekt telemetrien havner i.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "Statusen endres til **Ingen nylig trafikk** etter 15 minutter uten telemetri. Det er forventet mens ingen bruker appen. Hvis appen din har trafikk:",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- En **sampler** forkaster kanskje alt — kontroller at du ikke har satt en sampler som alltid er av, eller som har en svært lav andel.",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- Appen sender kanskje bare ved interaksjoner ingen gjorde i det tidsrommet.",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- Nøkkelen kan ha blitt tilbakekalt etter utrullingen — kjør nøkkelkontrollen i trinn 5.",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name` er **`storefront-web`**, denne applikasjonens identifikator — behold den som den er, ellers registreres dataene som en ny applikasjon.",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "En iOS-, Android- eller React Native-app med en OpenTelemetry-SDK — opentelemetry-swift, OpenTelemetry Android eller OpenTelemetrys JavaScript-SDK",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "`service.name` som appen din rapporterer — **Mobil**-nøkkelen fra trinn 1 er festet til det",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "Dette er OpenTelemetrys standardinnstillinger: en SDK som leser dem fra miljøet sitt, tar dem som de er. Ellers setter du samme endepunkt, headeren `x-oneuptime-token` og ressursattributtene i koden på SDK-ens OTLP-eksportør og ressurs — [Oppsett av mobil](/docs/rum/mobile-setup) viser det for Android, iOS og React Native.",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "De fleste mobile SDK-er setter `device.*`-attributtene for deg. `device.model.identifier` fyller fanen **Klienter**, så sett den som ovenfor hvis din ikke gjør det.",
  "`200` with `\"valid\": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.":
    "`200` med `\"valid\": true` betyr at OneUptime godtar nøkkelen, og for en mobilnøkkel legger meldingen til at den bare virker fra en mobilapp. `401` betyr at den er ukjent, tilbakekalt, deaktivert eller utløpt, og ingen SDK-konfigurasjon hjelper.",
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "Start deretter appen. Den vises under **Overvåking av reelle brukere** med sin første telemetribatch, oppkalt etter tjenestenavnet nøkkelen er festet til.",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "Alt en mobilnøkkel sender, lagres som denne mobilappen, under tjenestenavnet nøkkelen er festet til, uansett hva ressursen sier. Nøkkelen beholder bare det av ressursen som en app sier om seg selv — som attributtene `service.*`, `device.*`, `os.*` og `telemetry.*` og etikettene `oneuptime.label.*` — og forkaster resten, slik at en kopiert nøkkel ikke kan utgi telemetrien sin for en vert, en klynge eller en backend-tjeneste.",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "Med enhver annen nøkkel klassifiserer OneUptime telemetri som **mobil RUM** når ressursen har `device.id` eller `device.model.identifier`. Applikasjonen kjennes igjen på `service.name` (uten forskjell på store og små bokstaver), og telemetrien hører til denne RUM-applikasjonen — den lagres aldri i tillegg som en backend-tjeneste.",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **ett av dem** | Merker telemetrien som mobil RUM. `device.model.identifier` fyller også fanen **Klienter**. |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "`device.manufacturer` merker også en batch som mobil, men bare på en ressurs uten `host.name` eller `host.id` — det angir også merket på en fysisk maskin i en verts inventaroppføring. Sett også `device.id` eller `device.model.identifier`, så oppstår skillet aldri.",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id` bør være en identifikator per installasjon, ikke en annonse-ID eller noe som identifiserer en person.",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs and metrics, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **Alle som har appen din, kan kopiere nøkkelen.** Derfor er det en mobilnøkkel: en kopi kan bare sende denne appens spor, logger og målinger, lagret under tjenestenavnet nøkkelen er festet til, og aldri fra en nettside. Den kan fortsatt sende oppdiktede data for denne appen, opp til nøkkelens grense, så gi den en utløpsdato, roter nøkkelen med utgivelsene dine og slå den av hvis den misbrukes.",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "Alt dette finnes på nøkkelens side under **Prosjektinnstillinger > Telemetri og APM > Inntaksnøkler**: **Festet tjenestenavn** er appen alt nøkkelen sender, lagres under, **Grense for forespørsler per minutt** begrenser nøkkelen på tvers av alle kopier av appen din, **Utløper** stopper godtakingen etter en dato, og **Aktivert** slår den av med en gang.",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "Send aldri med en **Server**-nøkkel i en app i stedet: den kan skrive all slags telemetri til dette prosjektet, fra hvor som helst, som en hvilken som helst tjeneste.",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android** — agenten [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) (`io.opentelemetry.android:android-agent`) setter `device.model.identifier`, `device.model.name` og `device.manufacturer` på sin egen ressurs, så klassifiseringen virker uten ekstra konfigurasjon, og den rapporterer selv krasj, ANR-er, trege og frosne bilder, appoppstarter og økter. Den gir appen navn etter launcher-etiketten med mindre du setter `service.name`, og den sender ingen `device.id`. [Oppsett av Android](/docs/rum/android-setup) har Gradle-avhengigheten, koden og hva hver av dem blir i OneUptime.",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift** — med [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift) setter du selv `device.model.identifier` og `device.manufacturer` på ressursen: ressursen en SDK-versjon legger til, har endret seg mellom utgivelser.",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app.":
    "- **React Native / Expo** — kjører JavaScript-SDK-en, så oppsettet er nettleserens fra [Oppsett av nettleser](/docs/rum/browser-setup) med to forskjeller: det finnes ingen `browserDetector`, og du setter selv `device.manufacturer` og `device.model.identifier`, slik at fanen **Klienter** viser enhetene. Den sender med en **Mobil**-nøkkel, som enhver mobilapp.",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **Alt annet** — Flutter, Unity, .NET MAUI eller en håndskrevet OTLP-skriver virker på samme måte, så lenge ressursen har `service.name` pluss ett `device.*`-attributt.",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "De mobile OpenTelemetry-SDK-ene endrer builder-API-ene sine mellom utgivelser. [Oppsett av mobil](/docs/rum/mobile-setup) har kode for hver; kontroller metodenavnene mot versjonen du låser.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "Ethvert ressursattributt med prefikset `oneuptime.label.` blir en prosjektetikett på applikasjonen — `oneuptime.label.env=production` legger til etiketten `env:production`:",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **Oversikt** — hendelser, feilrate og p95-varighet over et valgfritt tidsrom, med trendgrafer, utledet fra spansene instrumenteringen din sender ut.",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **Unntak** — krasjene og ANR-ene appen din rapporterer, som ubehandlede unntak, i oversikten og under **Unntak**. OpenTelemetry Android rapporterer begge selv; en ANR vises med typen `ANR`.",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **Klienter** — enhetsmodellene applikasjonen er sett på, fra `device.model.identifier`. Grovt per modell, aldri per sluttbruker.",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "En `401` betyr at nøkkelen er ukjent, tilbakekalt, deaktivert eller utløpt: velg eller opprett en mobilnøkkel i trinn 1 og bygg appen på nytt med den.",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and never from a web page: an SDK that exports over gRPC, or a request that carries an `Origin` header, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "En `422` sier hva som ble avvist. En mobilnøkkel sender bare appens OTLP-spor, -logger og -målinger, over HTTP, og aldri fra en nettside: en SDK som eksporterer over gRPC, eller en forespørsel med en `Origin`-header, avvises. En nettlesernøkkel består kontrollen, men avvises fra en mobilapp, fordi den krever en `Origin`-header og mobile SDK-er ikke sender noen.",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "Telemetrien ble sendt med en servernøkkel, og ressursen har verken `device.id` eller `device.model.identifier`, så den ble lagret som en backend-tjeneste. Send med en mobilnøkkel (trinn 1), som lagrer alt den sender som denne appen, eller sett dem på SDK-ens ressurs, som i trinn 2.",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "Klientrader kommer spesifikt fra `device.model.identifier`. En SDK som bare setter `device.manufacturer`, klassifiseres som mobil, men viser ingen klienter — sett også `device.model.identifier`.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "Statusen endres til **Ingen nylig trafikk** etter 15 minutter uten telemetri. Det er forventet mens ingen bruker appen. Hvis appen din er i bruk:",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- Nøkkelen kan ha blitt tilbakekalt etter utgivelsen — kjør nøkkelkontrollen i trinn 3.",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name` er **`Storefront Mobile`**, denne applikasjonens identifikator — behold den som den er, ellers registreres dataene som en ny applikasjon. Den er prosentkodet i `OTEL_RESOURCE_ATTRIBUTES`, og SDK-en dekoder den.",
};

export default TRANSLATION;
