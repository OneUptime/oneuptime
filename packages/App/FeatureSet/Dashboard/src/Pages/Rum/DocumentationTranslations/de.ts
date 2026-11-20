import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in German (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * German. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "Eine Web-App, deren Code Sie ändern und neu bereitstellen können und deren Abhängigkeiten über npm installiert werden",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "Die Ursprünge, von denen Ihre Website ausgeliefert wird, etwa `https://app.example.com` — ein Browser-Schlüssel nimmt nur Anfragen von den Ursprüngen an, die Sie bei ihm eintragen",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "Machen Sie sie dann zum **ersten** Import Ihrer App, damit die Instrumentierungen `fetch` patchen, bevor irgendetwas anderes läuft:",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "Ersetzen Sie `storefront-web` durch den Namen Ihrer Anwendung. Unter diesem Namen erscheint die App in OneUptime, halten Sie ihn also stabil: Ein neuer Name registriert eine neue Anwendung.",
  "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.":
    "> **`service.name` allein zu setzen genügt nicht.** Die OpenTelemetry-Browser-SDKs fügen keine `browser.*`-Attribute hinzu, sofern Sie nicht den Browser-Ressourcendetektor aktivieren oder sie selbst setzen — ohne sie wird daraus ein Backend-Dienst, keine RUM-Anwendung.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Wählen Sie in Schritt 1 einen Ingestion-Schlüssel aus, um `<YOUR_API_KEY>` auszufüllen.",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "Führen Sie ihn mit Ihrer bestehenden `connect-src`-Direktive zusammen. Ihre Website hat keine Content Security Policy? Dann überspringen Sie diesen Schritt.",
  "`200` with `\"valid\": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.":
    "`200` mit `\"valid\": true` bedeutet, dass OneUptime den Schlüssel annimmt — bei einem Browser-Schlüssel ergänzt die Meldung, dass er nur aus einem Browser funktioniert, von einem seiner zulässigen Ursprünge. `401` bedeutet, dass er unbekannt, widerrufen, deaktiviert oder abgelaufen ist.",
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "Laden Sie dann eine Seite Ihrer Website. Innerhalb einer Minute erscheint die Anwendung unter **Real User Monitoring**, benannt nach ihrem `service.name`, mit Seitenaufrufen, Fehlerrate und p95-Dauer.",
  "OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "OneUptime ordnet Telemetrie als **RUM** ein, wenn ihre Ressource Client-Attribute trägt — im Web eines von `browser.platform`, `browser.language` oder ein nicht leeres `browser.brands`. Die Anwendung wird über `service.name` erkannt (ohne Beachtung der Groß- und Kleinschreibung), und ihre Telemetrie gehört dieser RUM-Anwendung — sie wird nie zusätzlich als Backend-Dienst abgelegt.",
  "| Attribute | Required | What it does |":
    "| Attribut | Erforderlich | Was es bewirkt |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **ja** | Die Identität der Anwendung, z. B. `storefront-web`. Eine spätere Umbenennung erzeugt eine neue Anwendung. |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **eines davon** | Kennzeichnet die Telemetrie als Browser-RUM. `browser.platform` füllt außerdem den Tab **Clients**. |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | nein | Wird in der Übersicht angezeigt |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector` setzt sie aus dem Browser. Er liest die UA-Client-Hints-API, die nur Chromium-Browser haben, daher setzt er in Safari und Firefox `browser.language`, aber nicht `browser.platform`. Um die Attribute selbst zu setzen — ohne den Detektor oder um jedem Browser eine Plattform zu geben —, bauen Sie die Ressource so:",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "Halten Sie `browser.platform` grob: Jeder eigene Wert wird zu einer Zeile im Tab **Clients**.",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "Alles im Browser-Snippet wird an Ihre Nutzer ausgeliefert. Das Token darin ist öffentlich — wer den Quelltext ansieht, die Entwicklertools öffnet oder Ihr Bundle liest, kann es kopieren. Deshalb listet und erstellt diese Anleitung nur **Browser**-Ingestion-Schlüssel, jeweils mit den Ursprüngen, von denen Ihre Website ausgeliefert wird:",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- er wird nur von diesen Ursprüngen angenommen, daher funktioniert ein kopierter Schlüssel nicht auf der Seite eines anderen;",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- er kann nur Traces, Protokolle, Metriken, Sitzungswiedergaben und Berichte des Sentry-Browser-SDK schreiben — keine Profile, Source Maps, Syslog, Fluent, Pyroscope oder Sicherheitsereignisse;",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- er ist pro Schlüssel ratenbegrenzt, lässt sich mit einer einzigen Änderung abschalten und kann ein Ablaufdatum erhalten.",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "Ein Ursprung umfasst das Schema und einen etwaigen Port und darf mit einem `*.`-Host-Platzhalter beginnen — `https://app.example.com`, `https://*.example.com`. Wenn Sie zusätzlich **Festgelegter Dienstname** am Schlüssel setzen, wird `service.name` bei allem erzwungen, was er schreibt, sodass ein kopierter Schlüssel seine Telemetrie nicht als einen Ihrer Backend-Dienste ausgeben kann. Beides finden Sie auf der Seite des Schlüssels unter **Projekteinstellungen > Telemetrie & APM > Ingestion-Schlüssel**.",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **Liefern Sie niemals einen Server-Ingestion-Schlüssel an einen Browser aus.** Ein Server-Schlüssel hat vollen Ingest-Zugriff von überall, ohne Ursprungsprüfung. Steht er einmal im Seitenquelltext, kann jeder, der ihn findet, gefälschte Spans, Protokolle und Metriken in dieses Projekt schreiben — Dashboards verfälschen, falsche Warnungen auslösen und Ihre abgerechnete Nutzung in die Höhe treiben —, bis Sie es bemerken und ihn rotieren.",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls` legt fest, welche Cross-Origin-Anfragen einen W3C-Header `traceparent` erhalten, der den Browser-Span mit dem Backend-Trace verbindet, den er ausgelöst hat. Same-Origin-Anfragen werden ohne jede Konfiguration weitergegeben.",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**Setzen Sie es nicht auf `/.*/`.** Ein zusätzlicher Header macht aus einer einfachen Cross-Origin-Anfrage eine mit Preflight, und jede Drittanbieter-API, die `traceparent` nicht in ihren `Access-Control-Allow-Headers` aufführt, beginnt zu scheitern. Tragen Sie nur Ursprünge ein, die Sie kontrollieren und konfiguriert haben:",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "Anfragen mit `XMLHttpRequest` statt `fetch` brauchen `@opentelemetry/instrumentation-xml-http-request` und dessen `XMLHttpRequestInstrumentation`, mit derselben Option.",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "Nicht abgefangene Fehler erfasst das OpenTelemetry-Browser-SDK nicht von selbst. Melden Sie sie ausdrücklich, damit sie neben Ihren Backend-Fehlern in der Ansicht **Ausnahmen** landen:",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "Traces genügen, um die Übersicht zu füllen. Fügen Sie Protokoll- und Metrik-Pipelines hinzu, wenn Sie Browser-Protokolle in OneUptime durchsuchen möchten, oder Core Web Vitals:",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object: a pipeline whose resource lacks `browser.*` is filed as a separate backend Service.":
    "Ihre Exporter senden an `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` und `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` mit demselben Header `x-oneuptime-token` — [Browser-Einrichtung](/docs/rum/browser-setup) enthält den Code. Bauen Sie sie mit demselben Objekt `resource`: Eine Pipeline, deren Ressource kein `browser.*` hat, wird als eigener Backend-Dienst abgelegt.",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "Die Karte **Core Web Vitals** — LCP, INP, CLS, FCP und TTFB — wird nur aus Metriken gefüllt, die Ihre App meldet, unter Namen wie `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) listet die Namen, die OneUptime liest, und bindet die Bibliothek `web-vitals` ein.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "Jedes Ressourcenattribut mit dem Präfix `oneuptime.label.` wird zu einer Projekt-Beschriftung der Anwendung — `oneuptime.label.env` mit dem Wert `production` fügt die Beschriftung `env:production` hinzu:",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "Verwenden Sie ein `service.name` pro App, nicht pro Umgebung, und unterscheiden Sie Umgebungen mit einer Beschriftung, damit jede App eine Anwendung und einen Verlauf behält.",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "Um Anwendungen nach Namen zu beschriften oder Eigentümer zuzuweisen, verwenden Sie **Real User Monitoring → Einstellungen → Beschriftungsregeln** und **Eigentümerregeln**. Regeln laufen, wenn eine Anwendung erstellt wird, auch durch die automatische Erkennung; bereits vorhandene Anwendungen beschriften sie nicht neu.",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **Übersicht** — Seitenaufrufe, Fehlerrate und p95-Dauer über einen wählbaren Zeitraum, mit Trenddiagrammen. Sie werden aus den Spans abgeleitet, die Ihre Instrumentierung ausgibt, daher ist ein Seitenaufruf das, was sie meldet: Dokumentladevorgänge, Routenwechsel, Interaktionen.",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals** — LCP, INP, CLS, FCP und TTFB, sobald Ihre App sie als Metriken meldet.",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **Protokolle**, **Traces** und **Metriken** — die Telemetrie-Explorer, auf diese Anwendung eingeschränkt.",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **Clients** — die Browser-Plattformen, auf denen die Anwendung gesehen wurde, aus `browser.platform`. Grob nach Plattform, nie pro Endnutzer.",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **Sitzungswiedergabe** — ein eigener, optionaler Rekorder mit eigenem Script-Tag und eigenen Datenschutzeinstellungen: [Sitzungswiedergabe](/docs/telemetry/session-replay).",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "Die Anwendung zeigt **Empfängt Daten**, solange Telemetrie eintrifft, und **Kein aktueller Datenverkehr** nach 15 Minuten ohne Telemetrie, was normal ist, solange niemand die App nutzt.",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "Öffnen Sie die DevTools → **Netzwerk** und filtern Sie nach `otlp`: Sie suchen `POST /otlp/v1/traces`. Gar keine Anfrage bedeutet, dass das SDK nie gestartet ist:",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts` wird nicht als Erstes importiert. Die Instrumentierungen patchen `fetch`; alles, was vor ihnen importiert wird, wird nicht erfasst, und wenn der Import durch Tree-Shaking wegfällt, läuft gar nichts.",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- Der Batch-Prozessor hat noch nicht geleert. `BatchSpanProcessor` puffert — warten Sie etwa 30 Sekunden oder navigieren Sie, bevor Sie schließen, dass nichts gesendet wird.",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- Eine Umgebungsvariable zur Build-Zeit wurde zu `undefined` aufgelöst, daher ist die Exporter-URL fehlerhaft. Geben Sie sie beim Start einmal aus.",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **Von der Content Security Policy blockiert** — die Konsole sagt es. Fügen Sie `connect-src 'self' <YOUR_ONEUPTIME_URL>;` hinzu (Schritt 4).",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **Von CORS blockiert** — die OTLP-Endpunkte von OneUptime erlauben jeden Ursprung und den Header `x-oneuptime-token`, daher bedeutet ein CORS-Fehler fast immer, dass die Anfrage OneUptime gar nicht erreicht: ein Firmenproxy, ein Werbeblocker oder ein Tippfehler im Host.",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`** — tragen Sie den genauen Ursprung Ihrer Website (Schema, Host und Port) unter **Zulässige Ursprünge** des Schlüssels in **Projekteinstellungen > Telemetrie & APM > Ingestion-Schlüssel** ein.",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`** — schalten Sie den Schlüssel dort wieder ein oder wählen Sie in Schritt 1 einen anderen Schlüssel.",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`** — der Schlüssel ist unbekannt, widerrufen oder abgelaufen. Führen Sie die Schlüsselprüfung in Schritt 5 aus und wählen oder erstellen Sie in Schritt 1 einen gültigen Browser-Schlüssel.",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`** — die URL ist falsch. Der Trace-Exporter braucht den vollständigen Pfad, `/otlp/v1/traces`.",
  "The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable `browserDetector` as in step 3, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "Die Ressource trägt kein Browser-Attribut, daher wurde die Telemetrie als Backend-Dienst abgelegt. Aktivieren Sie `browserDetector` wie in Schritt 3 oder setzen Sie die `browser.*`-Attribute selbst (**Wie OneUptime eine Browser-App erkennt** unter Erweitert).",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "Prüfen Sie in den DevTools → **Netzwerk** → der OTLP-Anfrage → **Payload**, was Sie senden: `resourceSpans[0].resource.attributes` ist die Liste, die es entscheidet.",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "Der bereits erstellte Dienst wird nicht zu einer RUM-Anwendung — die beiden sind getrennte Datensätze —, löschen Sie ihn also, sobald RUM-Telemetrie eintrifft.",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "Client-Zeilen stammen aus `browser.platform`. `browserDetector` liest die UA-Client-Hints-API, die nur Chromium-Browser haben: In Safari und Firefox setzt er `browser.language` — genug, um die Telemetrie als RUM einzuordnen —, aber nicht `browser.platform`. Setzen Sie `browser.platform` selbst, um diese Clients aufzulisten (**Wie OneUptime eine Browser-App erkennt** unter Erweitert).",
  "The card is filled only from metrics your app emits. Check, in order:":
    "Die Karte wird nur aus Metriken gefüllt, die Ihre App ausgibt. Prüfen Sie der Reihe nach:",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. Sie haben überhaupt eine **Metrik**-Pipeline — Traces allein füllen diese Karte nie.",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. Die Metriknamen sind solche, die OneUptime liest — siehe [Core Web Vitals](/docs/rum/web-vitals).",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. Die Metriken erscheinen im Tab **Metriken** der Anwendung. Wenn ja, funktioniert der Export, und das Problem ist der Name oder der gewählte Zeitraum.",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP und CLS werden gemeldet, wenn die Seite ausgeblendet wird, daher kann ein kurzer Besuch vor dem nächsten Export enden.",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **Prüfen Sie den Zeitraum.** Die Übersicht zeigt standardmäßig die letzte Stunde, ein Test von heute Morgen liegt also außerhalb.",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **Warten Sie eine Minute.** Der Ingest läuft über eine Warteschlange, und ein einzelner Test-Span kann bis zu einer Minute brauchen, bis er erscheint.",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **Prüfen Sie das Projekt.** Der Schlüssel entscheidet, in welchem Projekt die Telemetrie landet.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "Der Status wechselt nach 15 Minuten ohne Telemetrie zu **Kein aktueller Datenverkehr**. Das ist zu erwarten, solange niemand die App nutzt. Wenn Ihre App Verkehr hat:",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- Ein **Sampler** verwirft möglicherweise alles — prüfen Sie, dass Sie keinen Always-off-Sampler oder einen mit sehr niedriger Rate gesetzt haben.",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- Die App sendet vielleicht nur bei Interaktionen, die in diesem Zeitfenster niemand ausgelöst hat.",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- Der Schlüssel wurde nach der Bereitstellung vielleicht widerrufen — führen Sie die Schlüsselprüfung in Schritt 5 aus.",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name` ist **`storefront-web`**, die Kennung dieser Anwendung — lassen Sie ihn unverändert, sonst registrieren sich die Daten als neue Anwendung.",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "Eine iOS-, Android- oder React-Native-App mit einem OpenTelemetry-SDK — opentelemetry-swift, OpenTelemetry Android oder dem OpenTelemetry-JavaScript-SDK",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "Der `service.name`, den Ihre App meldet — der **Mobil**-Schlüssel aus Schritt 1 ist darauf festgelegt",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "Das sind die Standardeinstellungen von OpenTelemetry: Ein SDK, das sie aus seiner Umgebung liest, übernimmt sie so, wie sie sind. Andernfalls setzen Sie denselben Endpunkt, den Header `x-oneuptime-token` und die Ressourcenattribute im Code am OTLP-Exporter und an der Ressource des SDK — [Mobile Einrichtung](/docs/rum/mobile-setup) zeigt es für Android, iOS und React Native.",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "Die meisten mobilen SDKs setzen die `device.*`-Attribute für Sie. `device.model.identifier` füllt den Tab **Clients**, setzen Sie es also wie oben, falls Ihres das nicht tut.",
  "`200` with `\"valid\": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.":
    "`200` mit `\"valid\": true` bedeutet, dass OneUptime den Schlüssel annimmt, und bei einem Mobil-Schlüssel ergänzt die Meldung, dass er nur aus einer mobilen App funktioniert. `401` bedeutet, dass er unbekannt, widerrufen, deaktiviert oder abgelaufen ist, und daran ändert keine SDK-Konfiguration etwas.",
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "Starten Sie dann die App. Sie erscheint mit ihrem ersten Telemetrie-Batch unter **Real User Monitoring**, benannt nach dem Dienstnamen, auf den der Schlüssel festgelegt ist.",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "Alles, was ein Mobil-Schlüssel sendet, wird als diese mobile App abgelegt, unter dem Dienstnamen, auf den der Schlüssel festgelegt ist, egal was seine Ressource sagt. Der Schlüssel behält von der Ressource nur, was eine App über sich selbst sagt — etwa ihre Attribute `service.*`, `device.*`, `os.*` und `telemetry.*` und ihre Beschriftungen `oneuptime.label.*` — und verwirft den Rest, sodass ein kopierter Schlüssel seine Telemetrie nicht als Host, Cluster oder Backend-Dienst ausgeben kann.",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "Mit jedem anderen Schlüssel ordnet OneUptime Telemetrie als **mobiles RUM** ein, wenn ihre Ressource `device.id` oder `device.model.identifier` trägt. Die Anwendung wird über `service.name` erkannt (ohne Beachtung der Groß- und Kleinschreibung), und ihre Telemetrie gehört dieser RUM-Anwendung — sie wird nie zusätzlich als Backend-Dienst abgelegt.",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **eines davon** | Kennzeichnet die Telemetrie als mobiles RUM. `device.model.identifier` füllt außerdem den Tab **Clients**. |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "`device.manufacturer` kennzeichnet einen Batch ebenfalls als mobil, aber nur auf einer Ressource ohne `host.name` oder `host.id` — es dient auch als Hersteller einer physischen Maschine im Inventareintrag eines Hosts. Setzen Sie zusätzlich `device.id` oder `device.model.identifier`, dann spielt die Unterscheidung nie eine Rolle.",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id` sollte eine Kennung pro Installation sein, keine Werbe-ID und nichts, was eine Person identifiziert.",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs and metrics, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **Wer Ihre App hat, kann ihren Schlüssel kopieren.** Deshalb ist es ein Mobil-Schlüssel: Eine Kopie kann nur die Traces, Protokolle und Metriken dieser App senden, abgelegt unter dem Dienstnamen, auf den der Schlüssel festgelegt ist, und nie von einer Webseite aus. Sie kann trotzdem erfundene Daten für diese App senden, bis zum Limit des Schlüssels, setzen Sie also ein Ablaufdatum, rotieren Sie den Schlüssel mit Ihren Releases und schalten Sie ihn ab, wenn er missbraucht wird.",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "All das finden Sie auf der Seite des Schlüssels unter **Projekteinstellungen > Telemetrie & APM > Ingestion-Schlüssel**: **Festgelegter Dienstname** ist die App, unter der alles abgelegt wird, was der Schlüssel sendet, **Limit für Anfragen pro Minute** begrenzt den Schlüssel über alle Kopien Ihrer App hinweg, **Läuft ab am** beendet seine Annahme nach einem Datum, und **Aktiviert** schaltet ihn sofort ab.",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "Liefern Sie stattdessen niemals einen **Server**-Schlüssel in einer App aus: Er kann jede Art von Telemetrie in dieses Projekt schreiben, von überall und als jeder beliebige Dienst.",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android** — der Agent [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) (`io.opentelemetry.android:android-agent`) setzt `device.model.identifier`, `device.model.name` und `device.manufacturer` auf seiner eigenen Ressource, daher funktioniert die Einordnung ohne zusätzliche Konfiguration, und er meldet Abstürze, ANRs, langsame und eingefrorene Frames, App-Starts und Sitzungen von selbst. Er benennt die App nach ihrer Launcher-Beschriftung, sofern Sie `service.name` nicht setzen, und er sendet kein `device.id`. [Android-Einrichtung](/docs/rum/android-setup) enthält die Gradle-Abhängigkeit, den Code und was aus jedem davon in OneUptime wird.",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift** — setzen Sie mit [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift) `device.model.identifier` und `device.manufacturer` selbst auf der Ressource: Die Ressource, die eine SDK-Version beisteuert, hat sich zwischen Releases geändert.",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app.":
    "- **React Native / Expo** — nutzt das JavaScript-SDK, daher ist die Einrichtung die aus [Browser-Einrichtung](/docs/rum/browser-setup) mit zwei Unterschieden: Es gibt kein `browserDetector`, und Sie setzen `device.manufacturer` und `device.model.identifier` selbst, damit der Tab **Clients** die Geräte auflistet. Es sendet mit einem **Mobil**-Schlüssel, wie jede mobile App.",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **Alles andere** — Flutter, Unity, .NET MAUI oder ein selbst geschriebener OTLP-Writer funktionieren genauso, solange die Ressource `service.name` und ein `device.*`-Attribut trägt.",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "Die mobilen OpenTelemetry-SDKs ändern ihre Builder-APIs zwischen Releases. [Mobile Einrichtung](/docs/rum/mobile-setup) hat Code für jedes; prüfen Sie die Methodennamen an der Version, die Sie festlegen.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "Jedes Ressourcenattribut mit dem Präfix `oneuptime.label.` wird zu einer Projekt-Beschriftung der Anwendung — `oneuptime.label.env=production` fügt die Beschriftung `env:production` hinzu:",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **Übersicht** — Ereignisse, Fehlerrate und p95-Dauer über einen wählbaren Zeitraum, mit Trenddiagrammen, abgeleitet aus den Spans, die Ihre Instrumentierung ausgibt.",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **Ausnahmen** — die Abstürze und ANRs, die Ihre App meldet, als nicht behandelte Ausnahmen, in der Übersicht und unter **Ausnahmen**. OpenTelemetry Android meldet beides von selbst; ein ANR erscheint mit dem Typ `ANR`.",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **Clients** — die Gerätemodelle, auf denen die Anwendung gesehen wurde, aus `device.model.identifier`. Grob nach Modell, nie pro Endnutzer.",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "Ein `401` bedeutet, dass der Schlüssel unbekannt, widerrufen, deaktiviert oder abgelaufen ist: Wählen oder erstellen Sie in Schritt 1 einen Mobil-Schlüssel und bauen Sie die App damit neu.",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and never from a web page: an SDK that exports over gRPC, or a request that carries an `Origin` header, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "Ein `422` sagt, was abgelehnt wurde. Ein Mobil-Schlüssel sendet nur die OTLP-Traces, -Protokolle und -Metriken der App, über HTTP, und nie von einer Webseite aus: Ein SDK, das über gRPC exportiert, oder eine Anfrage mit einem `Origin`-Header wird abgelehnt. Ein Browser-Schlüssel besteht die Prüfung, wird aber aus einer mobilen App abgelehnt, weil er einen `Origin`-Header braucht und mobile SDKs keinen senden.",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "Die Telemetrie wurde mit einem Server-Schlüssel gesendet, und ihre Ressource trägt kein `device.id` oder `device.model.identifier`, daher wurde sie als Backend-Dienst abgelegt. Senden Sie mit einem Mobil-Schlüssel (Schritt 1), der alles, was er sendet, als diese App ablegt, oder setzen Sie sie auf der Ressource des SDK, wie in Schritt 2.",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "Client-Zeilen stammen gezielt aus `device.model.identifier`. Ein SDK, das nur `device.manufacturer` setzt, wird als mobil eingeordnet, listet aber keine Clients — setzen Sie zusätzlich `device.model.identifier`.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "Der Status wechselt nach 15 Minuten ohne Telemetrie zu **Kein aktueller Datenverkehr**. Das ist zu erwarten, solange niemand die App nutzt. Wenn Ihre App genutzt wird:",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- Der Schlüssel wurde nach dem Release vielleicht widerrufen — führen Sie die Schlüsselprüfung in Schritt 3 aus.",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name` ist **`Storefront Mobile`**, die Kennung dieser Anwendung — lassen Sie ihn unverändert, sonst registrieren sich die Daten als neue Anwendung. In `OTEL_RESOURCE_ATTRIBUTES` ist er prozentkodiert, und das SDK dekodiert ihn.",
};

export default TRANSLATION;
