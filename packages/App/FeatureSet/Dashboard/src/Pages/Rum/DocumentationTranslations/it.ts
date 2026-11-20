import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in Italian (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * Italian. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "Un'app web di cui puoi modificare il codice e rifare il deploy, con le dipendenze installate tramite npm",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "Le origini da cui viene servito il tuo sito, come `https://app.example.com`: una chiave browser accetta solo richieste dalle origini che vi elenchi",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "Poi rendilo il **primo** import della tua app, così le strumentazioni applicano la patch a `fetch` prima che venga eseguito qualsiasi altro codice:",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "Sostituisci `storefront-web` con il nome della tua applicazione. È il nome con cui l'app compare in OneUptime, quindi mantienilo stabile: un nuovo nome registra una nuova applicazione.",
  "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.":
    "> **Impostare solo `service.name` non basta.** Gli SDK OpenTelemetry per il browser non aggiungono attributi `browser.*` a meno che tu non attivi il rilevatore di risorse del browser o li imposti tu: senza di essi diventa un servizio di backend, non un'applicazione RUM.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Scegli una chiave di acquisizione al passaggio 1 per compilare `<YOUR_API_KEY>`.",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "Uniscilo alla tua direttiva `connect-src` esistente. Il tuo sito non ha una Content Security Policy? Salta questo passaggio.",
  '`200` with `"valid": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.':
    '`200` con `"valid": true` significa che OneUptime accetta la chiave: per una chiave browser il messaggio aggiunge che funziona solo da un browser, da una delle sue origini consentite. `401` significa che è sconosciuta, revocata, disattivata o scaduta.',
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "Poi carica una pagina del tuo sito. Entro un minuto l'applicazione compare in **Monitoraggio degli utenti reali**, con il nome del suo `service.name`, con visualizzazioni di pagina, tasso di errore e durata p95.",
  "OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "OneUptime classifica la telemetria come **RUM** quando la sua risorsa ha attributi del client: per il web, uno tra `browser.platform`, `browser.language` o un `browser.brands` non vuoto. L'applicazione è identificata da `service.name` (senza distinzione tra maiuscole e minuscole), e la sua telemetria appartiene a questa applicazione RUM: non viene mai duplicata come servizio di backend.",
  "| Attribute | Required | What it does |":
    "| Attributo | Obbligatorio | Cosa fa |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **sì** | L'identità dell'applicazione, ad es. `storefront-web`. Rinominarlo in seguito crea una nuova applicazione. |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **uno di questi** | Contrassegna la telemetria come RUM del browser. `browser.platform` riempie anche la scheda **Client**. |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Mostrato nella panoramica |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector` li imposta dal browser. Legge l'API UA Client Hints, che hanno solo i browser Chromium, quindi su Safari e Firefox imposta `browser.language` ma non `browser.platform`. Per impostare tu gli attributi (senza il rilevatore, o per dare una piattaforma a ogni browser), costruisci la risorsa così:",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "Mantieni `browser.platform` generico: ogni valore distinto diventa una riga nella scheda **Client**.",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "Tutto ciò che è nello snippet del browser arriva ai tuoi utenti. Il token che contiene è pubblico: chiunque veda il sorgente, apra i devtools o legga il tuo bundle può copiarlo. Per questo questa guida elenca e crea solo chiavi di acquisizione di tipo **Browser**, ciascuna con le origini da cui viene servito il tuo sito:",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- è accettata solo da quelle origini, quindi una chiave copiata non funziona nella pagina di qualcun altro;",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- può scrivere solo tracce, log, metriche, riproduzioni delle sessioni e report dell'SDK browser di Sentry, non profili, source map, syslog, Fluent, Pyroscope o eventi di sicurezza;",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- ha un limite di frequenza per chiave, si può disattivare con una sola modifica e può avere una scadenza.",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "Un'origine include lo schema e l'eventuale porta, e può iniziare con un carattere jolly host `*.`: `https://app.example.com`, `https://*.example.com`. Se imposti anche **Nome del servizio fissato** sulla chiave, `service.name` viene imposto su tutto ciò che scrive, così una chiave copiata non può spacciare la sua telemetria per uno dei tuoi servizi di backend. Entrambi sono nella pagina della chiave in **Impostazioni del progetto > Telemetria e APM > Chiavi di acquisizione**.",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **Non distribuire mai una chiave di acquisizione server in un browser.** Una chiave server ha pieno accesso all'acquisizione da qualsiasi luogo, senza controllo dell'origine. Una volta nel sorgente della pagina, chiunque la trovi può scrivere span, log e metriche falsi in questo progetto (rovinando le dashboard, attivando falsi avvisi e facendo salire il tuo consumo a pagamento) finché non te ne accorgi e la ruoti.",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls` decide quali richieste cross-origin ricevono un header W3C `traceparent`, che collega lo span del browser alla traccia di backend che ha avviato. Le richieste della stessa origine vengono propagate senza alcuna configurazione.",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**Non impostarlo su `/.*/`.** Aggiungere un header trasforma una semplice richiesta cross-origin in una con preflight, e qualsiasi API di terze parti che non elenca `traceparent` nei suoi `Access-Control-Allow-Headers` inizierà a fallire. Elenca solo origini che controlli e hai configurato:",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "Le richieste fatte con `XMLHttpRequest` invece di `fetch` richiedono `@opentelemetry/instrumentation-xml-http-request` e il suo `XMLHttpRequestInstrumentation`, con la stessa opzione.",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "L'SDK OpenTelemetry per il browser non cattura automaticamente gli errori non gestiti. Segnalali in modo esplicito, così confluiscono nella vista **Eccezioni** accanto ai tuoi errori di backend:",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "Le tracce bastano per riempire la panoramica. Aggiungi pipeline di log e metriche se vuoi poter cercare i log del browser in OneUptime, o i Core Web Vitals:",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object: a pipeline whose resource lacks `browser.*` is filed as a separate backend Service.":
    "I loro esportatori inviano a `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` e `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` con lo stesso header `x-oneuptime-token`: il codice è in [Configurazione del browser](/docs/rum/browser-setup). Costruiscili con lo stesso oggetto `resource`: una pipeline la cui risorsa non ha `browser.*` viene archiviata come un servizio di backend separato.",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "La scheda **Core Web Vitals** (LCP, INP, CLS, FCP e TTFB) viene riempita solo dalle metriche che la tua app segnala, con nomi come `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) elenca i nomi che OneUptime legge e collega la libreria `web-vitals`.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "Qualsiasi attributo di risorsa con prefisso `oneuptime.label.` diventa un'etichetta di progetto sull'applicazione: `oneuptime.label.env` impostato su `production` aggiunge l'etichetta `env:production`:",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "Usa un `service.name` per app, non per ambiente, e distingui gli ambienti con un'etichetta, così ogni app mantiene una sola applicazione e una sola cronologia.",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "Per etichettare le applicazioni o assegnare proprietari per nome, usa **Monitoraggio degli utenti reali → Impostazioni → Regole etichette** e **Regole del proprietario**. Le regole vengono eseguite quando viene creata un'applicazione, anche tramite rilevamento automatico; non rietichettano le applicazioni già esistenti.",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **Panoramica**: visualizzazioni di pagina, tasso di errore e durata p95 in un intervallo di tempo selezionabile, con grafici di tendenza. Derivano dagli span che la tua strumentazione emette, quindi una visualizzazione di pagina è ciò che essa segnala: caricamenti del documento, cambi di percorso, interazioni.",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals**: LCP, INP, CLS, FCP e TTFB, una volta che la tua app li segnala come metriche.",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **Log**, **Tracce** e **Metriche**: gli esploratori della telemetria, limitati a questa applicazione.",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **Client**: le piattaforme browser su cui è stata vista l'applicazione, da `browser.platform`. Generico per piattaforma, mai per singolo utente finale.",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **Riproduzione delle sessioni**: un registratore separato e facoltativo, con il suo tag script e i suoi controlli della privacy: [Riproduzione delle sessioni](/docs/telemetry/session-replay).",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "L'applicazione mostra **Riceve dati** finché la telemetria continua ad arrivare, e **Nessun traffico recente** dopo 15 minuti senza telemetria, il che è normale finché nessuno usa l'app.",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "Apri DevTools → **Network** e filtra per `otlp`: stai cercando `POST /otlp/v1/traces`. Nessuna richiesta significa che l'SDK non è mai partito:",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts` non viene importato per primo. Le strumentazioni applicano la patch a `fetch`; ciò che viene importato prima non viene tracciato, e se il tree-shaking elimina l'import, non viene eseguito nulla.",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- Il processore batch non ha ancora svuotato il buffer. `BatchSpanProcessor` accumula: attendi circa 30 secondi, o cambia pagina, prima di concludere che non viene inviato nulla.",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- Una variabile d'ambiente di build è risultata `undefined`, quindi l'URL dell'esportatore non è valido. Stampalo una volta all'avvio.",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **Bloccato dalla Content Security Policy**: la console lo dice. Aggiungi `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (passaggio 4).",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **Bloccato da CORS**: gli endpoint OTLP di OneUptime consentono qualsiasi origine e l'header `x-oneuptime-token`, quindi un errore CORS significa quasi sempre che la richiesta non raggiunge affatto OneUptime: un proxy aziendale, un blocco pubblicità o un errore di battitura nell'host.",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`**: aggiungi l'origine esatta del tuo sito (schema, host e porta) alle **Origini consentite** della chiave in **Impostazioni del progetto > Telemetria e APM > Chiavi di acquisizione**.",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`**: riattiva lì la chiave, o scegline un'altra al passaggio 1.",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`**: la chiave è sconosciuta, revocata o scaduta. Esegui il controllo della chiave al passaggio 5 e scegli o crea una chiave browser valida al passaggio 1.",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`**: l'URL è sbagliato. L'esportatore delle tracce richiede il percorso completo, `/otlp/v1/traces`.",
  "The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable `browserDetector` as in step 3, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "La risorsa non ha alcun attributo del browser, quindi la telemetria è stata archiviata come servizio di backend. Attiva `browserDetector` come al passaggio 3, o imposta tu gli attributi `browser.*` (**Come OneUptime riconosce un'app browser** in Avanzato).",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "Controlla cosa invii in DevTools → **Network** → la richiesta OTLP → **Payload**: `resourceSpans[0].resource.attributes` è l'elenco che lo decide.",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "Il servizio già creato non diventa un'applicazione RUM (sono due record separati), quindi eliminalo quando arriva la telemetria RUM.",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "Le righe dei client vengono da `browser.platform`. `browserDetector` legge l'API UA Client Hints, che hanno solo i browser Chromium: su Safari e Firefox imposta `browser.language` (abbastanza per classificare la telemetria come RUM) ma non `browser.platform`. Imposta tu `browser.platform` per elencare quei client (**Come OneUptime riconosce un'app browser** in Avanzato).",
  "The card is filled only from metrics your app emits. Check, in order:":
    "La scheda viene riempita solo dalle metriche che la tua app emette. Controlla, in ordine:",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. Che tu abbia una pipeline delle **metriche**: le tracce da sole non riempiono mai questa scheda.",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. Che i nomi delle metriche siano quelli che OneUptime legge: vedi [Core Web Vitals](/docs/rum/web-vitals).",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. Che le metriche compaiano nella scheda **Metriche** dell'applicazione. Se compaiono, l'esportazione funziona e il problema è il nome o l'intervallo selezionato.",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP e CLS vengono segnalati quando la pagina viene nascosta, quindi una visita breve può terminare prima della successiva esportazione.",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **Controlla l'intervallo di tempo.** La panoramica mostra per impostazione predefinita l'ultima ora, quindi un test di stamattina ne resta fuori.",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **Attendi un minuto.** L'acquisizione passa da una coda, e un singolo span di prova può impiegare fino a un minuto per comparire.",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **Controlla il progetto.** È la chiave a decidere in quale progetto arriva la telemetria.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "Lo stato passa a **Nessun traffico recente** dopo 15 minuti senza telemetria. È normale finché nessuno usa l'app. Se la tua app ha traffico:",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- Un **sampler** potrebbe scartare tutto: controlla di non aver impostato un sampler sempre spento o con un rapporto molto basso.",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- L'app potrebbe inviare solo in seguito a interazioni che nessuno ha fatto in quell'intervallo.",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- La chiave potrebbe essere stata revocata dopo il deploy: esegui il controllo della chiave al passaggio 5.",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name` è **`storefront-web`**, l'identificatore di questa applicazione: lascialo com'è, altrimenti i dati si registrano come una nuova applicazione.",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "Un'app iOS, Android o React Native con un SDK OpenTelemetry: opentelemetry-swift, OpenTelemetry Android o l'SDK JavaScript di OpenTelemetry",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "Il `service.name` che la tua app segnala: la chiave **Mobile** del passaggio 1 è fissata su di esso",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "Sono le impostazioni standard di OpenTelemetry: un SDK che le legge dal suo ambiente le prende così come sono. Altrimenti imposta lo stesso endpoint, l'header `x-oneuptime-token` e gli attributi di risorsa sull'esportatore OTLP e sulla risorsa dell'SDK nel codice: [Configurazione mobile](/docs/rum/mobile-setup) lo mostra per Android, iOS e React Native.",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "La maggior parte degli SDK mobili imposta per te gli attributi `device.*`. `device.model.identifier` riempie la scheda **Client**, quindi impostalo come sopra se il tuo non lo fa.",
  '`200` with `"valid": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.':
    "`200` con `\"valid\": true` significa che OneUptime accetta la chiave, e per una chiave mobile il messaggio aggiunge che funziona solo da un'app mobile. `401` significa che è sconosciuta, revocata, disattivata o scaduta, e nessuna configurazione dell'SDK risolverà il problema.",
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "Poi avvia l'app. Compare in **Monitoraggio degli utenti reali** con il suo primo batch di telemetria, con il nome del servizio a cui è fissata la chiave.",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "Tutto ciò che una chiave mobile invia viene archiviato come questa app mobile, sotto il nome del servizio a cui è fissata la chiave, qualunque cosa dica la sua risorsa. La chiave conserva della risorsa solo ciò che un'app dice di sé (come i suoi attributi `service.*`, `device.*`, `os.*` e `telemetry.*` e le sue etichette `oneuptime.label.*`) e scarta il resto, così una chiave copiata non può spacciare la sua telemetria per un host, un cluster o un servizio di backend.",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "Con qualsiasi altra chiave, OneUptime classifica la telemetria come **RUM mobile** quando la sua risorsa ha `device.id` o `device.model.identifier`. L'applicazione è identificata da `service.name` (senza distinzione tra maiuscole e minuscole), e la sua telemetria appartiene a questa applicazione RUM: non viene mai duplicata come servizio di backend.",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **uno di questi** | Contrassegna la telemetria come RUM mobile. `device.model.identifier` riempie anche la scheda **Client**. |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "Anche `device.manufacturer` contrassegna un batch come mobile, ma solo su una risorsa senza `host.name` né `host.id`: indica anche il produttore di una macchina fisica nella voce di inventario di un host. Imposta anche `device.id` o `device.model.identifier` e la distinzione non si pone mai.",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id` deve essere un identificatore per installazione, non un ID pubblicitario né nulla che identifichi una persona.",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs and metrics, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **Chiunque abbia la tua app può copiarne la chiave.** Per questo è una chiave mobile: una copia può inviare solo le tracce, i log e le metriche di questa app, archiviati sotto il nome del servizio a cui è fissata la chiave, e mai da una pagina web. Può comunque inviare dati inventati per questa app, fino al limite della chiave, quindi imposta una scadenza, ruota la chiave con i tuoi rilasci e disattivala se viene usata in modo improprio.",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "Tutti si trovano nella pagina della chiave in **Impostazioni del progetto > Telemetria e APM > Chiavi di acquisizione**: **Nome del servizio fissato** è l'app sotto cui viene archiviato tutto ciò che la chiave invia, **Limite di richieste al minuto** limita la chiave su tutte le copie della tua app, **Scade il** ne interrompe l'accettazione dopo una data, e **Abilitato** la disattiva subito.",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "Non distribuire mai al suo posto una chiave **Server** in un'app: può scrivere ogni tipo di telemetria in questo progetto, da qualsiasi luogo, come qualsiasi servizio.",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android**: l'agente [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) (`io.opentelemetry.android:android-agent`) imposta `device.model.identifier`, `device.model.name` e `device.manufacturer` sulla propria risorsa, quindi la classificazione funziona senza configurazione aggiuntiva, e segnala da solo crash, ANR, frame lenti e bloccati, avvii dell'app e sessioni. Dà all'app il nome della sua etichetta del launcher a meno che tu non imposti `service.name`, e non invia `device.id`. [Configurazione Android](/docs/rum/android-setup) ha la dipendenza Gradle, il codice e cosa diventa ciascuno in OneUptime.",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift**: con [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), imposta tu `device.model.identifier` e `device.manufacturer` sulla risorsa: la risorsa che aggiunge ogni versione dell'SDK è cambiata tra un rilascio e l'altro.",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app.":
    "- **React Native / Expo**: esegue l'SDK JavaScript, quindi la configurazione è quella del browser in [Configurazione del browser](/docs/rum/browser-setup) con due differenze: non c'è `browserDetector`, e imposti tu `device.manufacturer` e `device.model.identifier` perché la scheda **Client** elenchi i dispositivi. Invia con una chiave **Mobile**, come qualsiasi app mobile.",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **Qualsiasi altra cosa**: Flutter, Unity, .NET MAUI o uno scrittore OTLP fatto a mano funzionano allo stesso modo, purché la risorsa abbia `service.name` più un attributo `device.*`.",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "Gli SDK mobili di OpenTelemetry cambiano le loro API di builder tra un rilascio e l'altro. [Configurazione mobile](/docs/rum/mobile-setup) ha il codice per ciascuno; verifica i nomi dei metodi con la versione che fissi.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "Qualsiasi attributo di risorsa con prefisso `oneuptime.label.` diventa un'etichetta di progetto sull'applicazione: `oneuptime.label.env=production` aggiunge l'etichetta `env:production`:",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **Panoramica**: eventi, tasso di errore e durata p95 in un intervallo di tempo selezionabile, con grafici di tendenza, derivati dagli span che la tua strumentazione emette.",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **Eccezioni**: i crash e gli ANR che la tua app segnala, come eccezioni non gestite, nella panoramica e in **Eccezioni**. OpenTelemetry Android li segnala entrambi da solo; un ANR compare con il tipo `ANR`.",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **Client**: i modelli di dispositivo su cui è stata vista l'applicazione, da `device.model.identifier`. Generico per modello, mai per singolo utente finale.",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "Un `401` significa che la chiave è sconosciuta, revocata, disattivata o scaduta: scegli o crea una chiave mobile al passaggio 1 e ricompila l'app con essa.",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and never from a web page: an SDK that exports over gRPC, or a request that carries an `Origin` header, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "Un `422` dice cosa è stato rifiutato. Una chiave mobile invia solo le tracce, i log e le metriche OTLP dell'app, via HTTP, e mai da una pagina web: un SDK che esporta via gRPC, o una richiesta con un header `Origin`, viene rifiutato. Una chiave browser supera il controllo ma viene rifiutata da un'app mobile, perché richiede un header `Origin` e gli SDK mobili non ne inviano.",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "La telemetria è stata inviata con una chiave server, e la sua risorsa non ha `device.id` né `device.model.identifier`, quindi è stata archiviata come servizio di backend. Invia con una chiave mobile (passaggio 1), che archivia tutto ciò che invia come questa app, o impostali sulla risorsa dell'SDK, come al passaggio 2.",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "Le righe dei client vengono proprio da `device.model.identifier`. Un SDK che imposta solo `device.manufacturer` viene classificato come mobile, ma non elenca alcun client: imposta anche `device.model.identifier`.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "Lo stato passa a **Nessun traffico recente** dopo 15 minuti senza telemetria. È normale finché nessuno usa l'app. Se la tua app è in uso:",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- La chiave potrebbe essere stata revocata dopo il rilascio: esegui il controllo della chiave al passaggio 3.",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name` è **`Storefront Mobile`**, l'identificatore di questa applicazione: lascialo com'è, altrimenti i dati si registrano come una nuova applicazione. È codificato in percentuale in `OTEL_RESOURCE_ATTRIBUTES`, e l'SDK lo decodifica.",
};

export default TRANSLATION;
