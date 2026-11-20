import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in French (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * French. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "Une application web dont vous pouvez modifier le code et le redéployer, avec ses dépendances installées via npm",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "Les origines depuis lesquelles votre site est servi, comme `https://app.example.com` — une clé navigateur n'accepte que les requêtes des origines que vous y indiquez",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "Faites-en ensuite le **premier** import de votre application, pour que les instrumentations patchent `fetch` avant que quoi que ce soit d'autre ne s'exécute :",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "Remplacez `storefront-web` par le nom de votre application. C'est sous ce nom que l'application apparaît dans OneUptime, alors gardez-le stable : un nouveau nom enregistre une nouvelle application.",
  "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.":
    "> **Définir `service.name` seul ne suffit pas.** Les SDK navigateur d'OpenTelemetry n'ajoutent pas d'attributs `browser.*` sauf si vous activez le détecteur de ressources du navigateur ou les définissez vous-même — sans eux, cela devient un service backend, pas une application RUM.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Choisissez une clé d'ingestion à l'étape 1 pour remplir `<YOUR_API_KEY>`.",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "Fusionnez-la avec votre directive `connect-src` existante. Pas de Content Security Policy sur votre site ? Passez cette étape.",
  '`200` with `"valid": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.':
    "`200` avec `\"valid\": true` signifie que OneUptime accepte la clé — pour une clé navigateur, le message ajoute qu'elle ne fonctionne que depuis un navigateur, depuis une de ses origines autorisées. `401` signifie qu'elle est inconnue, révoquée, désactivée ou expirée.",
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "Chargez ensuite une page de votre site. En une minute, l'application apparaît sous **Surveillance des utilisateurs réels**, nommée d'après son `service.name`, avec les pages vues, le taux d'erreur et la durée p95.",
  "OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "OneUptime classe la télémétrie comme **RUM** quand sa ressource porte des attributs client — pour le web, l'un de `browser.platform`, `browser.language` ou un `browser.brands` non vide. L'application est identifiée par `service.name` (sans tenir compte de la casse), et sa télémétrie appartient à cette application RUM — elle n'est jamais dupliquée en service backend.",
  "| Attribute | Required | What it does |":
    "| Attribut | Obligatoire | Ce qu'il fait |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **oui** | L'identité de l'application, par ex. `storefront-web`. Le renommer plus tard crée une nouvelle application. |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **l'un d'eux** | Marque la télémétrie comme RUM navigateur. `browser.platform` remplit aussi l'onglet **Clients**. |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | non | Affiché dans la vue d'ensemble |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector` les définit depuis le navigateur. Il lit l'API UA Client Hints, que seuls les navigateurs Chromium possèdent : sur Safari et Firefox, il définit donc `browser.language` mais pas `browser.platform`. Pour définir les attributs vous-même — sans le détecteur, ou pour donner une plateforme à chaque navigateur — construisez la ressource ainsi :",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "Gardez `browser.platform` sommaire : chaque valeur distincte devient une ligne de l'onglet **Clients**.",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "Tout ce que contient l'extrait navigateur est livré à vos utilisateurs. Le jeton qu'il contient est public — quiconque affiche la source, ouvre les outils de développement ou lit votre bundle peut le copier. C'est pourquoi ce guide ne liste et ne crée que des clés d'ingestion de type **Navigateur**, chacune avec les origines depuis lesquelles votre site est servi :",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- elle n'est acceptée que depuis ces origines, donc une clé copiée ne fonctionne pas sur la page de quelqu'un d'autre ;",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- elle ne peut écrire que des traces, des journaux, des métriques, des relectures de session et des rapports du SDK navigateur de Sentry — pas de profils, de source maps, de syslog, de Fluent, de Pyroscope ni d'événements de sécurité ;",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- son débit est limité par clé, elle se désactive en une modification, et elle peut recevoir une date d'expiration.",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "Une origine comprend le schéma et un éventuel port, et peut commencer par un joker d'hôte `*.` — `https://app.example.com`, `https://*.example.com`. Définir aussi **Nom du service épinglé** sur la clé impose `service.name` à tout ce qu'elle écrit, si bien qu'une clé copiée ne peut pas faire passer sa télémétrie pour un de vos services backend. Les deux se trouvent sur la page de la clé, dans **Paramètres du projet > Télémétrie & APM > Clés d'ingestion**.",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **Ne livrez jamais une clé d'ingestion serveur dans un navigateur.** Une clé serveur a un accès d'ingestion complet depuis n'importe où, sans vérification d'origine. Une fois dans la source de la page, quiconque la trouve peut écrire de faux spans, journaux et métriques dans ce projet — fausser les tableaux de bord, déclencher de fausses alertes et faire grimper votre consommation facturée — jusqu'à ce que vous le remarquiez et la renouveliez.",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls` décide quelles requêtes cross-origin reçoivent un en-tête W3C `traceparent`, qui relie le span du navigateur à la trace backend qu'il a déclenchée. Les requêtes de même origine sont propagées sans aucune configuration.",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**Ne le réglez pas sur `/.*/`.** Ajouter un en-tête transforme une requête cross-origin simple en requête avec preflight, et toute API tierce qui ne liste pas `traceparent` dans ses `Access-Control-Allow-Headers` se mettra à échouer. N'indiquez que des origines que vous contrôlez et avez configurées :",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "Les requêtes faites avec `XMLHttpRequest` au lieu de `fetch` ont besoin de `@opentelemetry/instrumentation-xml-http-request` et de son `XMLHttpRequestInstrumentation`, avec la même option.",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "Le SDK navigateur d'OpenTelemetry ne capture pas automatiquement les erreurs non interceptées. Signalez-les explicitement pour qu'elles rejoignent la vue **Exceptions** à côté de vos erreurs backend :",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "Les traces suffisent pour remplir la vue d'ensemble. Ajoutez des pipelines de journaux et de métriques si vous voulez pouvoir rechercher les journaux du navigateur dans OneUptime, ou les Core Web Vitals :",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object: a pipeline whose resource lacks `browser.*` is filed as a separate backend Service.":
    "Leurs exportateurs envoient vers `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` et `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` avec le même en-tête `x-oneuptime-token` — le code se trouve dans [Configuration du navigateur](/docs/rum/browser-setup). Construisez-les avec le même objet `resource` : un pipeline dont la ressource n'a pas de `browser.*` est classé comme un service backend distinct.",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "La carte **Core Web Vitals** — LCP, INP, CLS, FCP et TTFB — n'est remplie qu'à partir des métriques que votre application signale, sous des noms comme `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) liste les noms que lit OneUptime et branche la bibliothèque `web-vitals`.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "Tout attribut de ressource préfixé par `oneuptime.label.` devient une étiquette de projet sur l'application — `oneuptime.label.env` défini à `production` ajoute l'étiquette `env:production` :",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "Utilisez un `service.name` par application, pas par environnement, et distinguez les environnements avec une étiquette, pour que chaque application garde une seule application et un seul historique.",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "Pour étiqueter des applications ou attribuer des propriétaires par nom, utilisez **Surveillance des utilisateurs réels → Paramètres → Règles d'étiquettes** et **Règles de propriétaire**. Les règles s'exécutent quand une application est créée, y compris par la découverte automatique ; elles ne réétiquettent pas les applications qui existent déjà.",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **Vue d'ensemble** — pages vues, taux d'erreur et durée p95 sur une période au choix, avec des graphiques de tendance. Elles sont dérivées des spans qu'émet votre instrumentation : une page vue est donc ce qu'elle signale — chargements de document, changements de route, interactions.",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals** — LCP, INP, CLS, FCP et TTFB, dès que votre application les signale comme métriques.",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **Journaux**, **Traces** et **Métriques** — les explorateurs de télémétrie, limités à cette application.",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **Clients** — les plateformes de navigateur sur lesquelles l'application a été vue, d'après `browser.platform`. Sommaire par plateforme, jamais par utilisateur final.",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **Relecture de session** — un enregistreur distinct et facultatif, avec sa propre balise script et ses propres réglages de confidentialité : [Relecture de session](/docs/telemetry/session-replay).",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "L'application affiche **Reçoit des données** tant que la télémétrie continue d'arriver, et **Aucun trafic récent** après 15 minutes sans télémétrie, ce qui est normal tant que personne n'utilise l'application.",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "Ouvrez les DevTools → **Network** et filtrez sur `otlp` : vous cherchez `POST /otlp/v1/traces`. Aucune requête du tout signifie que le SDK n'a jamais démarré :",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts` n'est pas importé en premier. Les instrumentations patchent `fetch` ; ce qui est importé avant elles n'est pas tracé, et si le tree-shaking retire l'import, rien ne s'exécute du tout.",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- Le processeur par lots n'a pas encore vidé sa file. `BatchSpanProcessor` met en mémoire tampon — attendez environ 30 secondes, ou naviguez, avant de conclure que rien n'est envoyé.",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- Une variable d'environnement de build a donné `undefined`, l'URL de l'exportateur est donc mal formée. Affichez-la une fois au démarrage.",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **Bloqué par la Content Security Policy** — la console le dit. Ajoutez `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (étape 4).",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **Bloqué par CORS** — les endpoints OTLP de OneUptime autorisent n'importe quelle origine et l'en-tête `x-oneuptime-token`, donc un échec CORS signifie presque toujours que la requête n'atteint pas du tout OneUptime : un proxy d'entreprise, un bloqueur de publicités ou une faute de frappe dans l'hôte.",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`** — ajoutez l'origine exacte de votre site (schéma, hôte et port) aux **Origines autorisées** de la clé, dans **Paramètres du projet > Télémétrie & APM > Clés d'ingestion**.",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`** — réactivez la clé à cet endroit, ou choisissez une autre clé à l'étape 1.",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`** — la clé est inconnue, révoquée ou expirée. Lancez la vérification de la clé à l'étape 5, et choisissez ou créez une clé navigateur valide à l'étape 1.",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`** — l'URL est fausse. L'exportateur de traces a besoin du chemin complet, `/otlp/v1/traces`.",
  "The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable `browserDetector` as in step 3, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "La ressource ne porte aucun attribut de navigateur : la télémétrie a donc été classée comme un service backend. Activez `browserDetector` comme à l'étape 3, ou définissez vous-même les attributs `browser.*` (**Comment OneUptime reconnaît une application navigateur** sous Avancé).",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "Vérifiez ce que vous envoyez dans les DevTools → **Network** → la requête OTLP → **Payload** : `resourceSpans[0].resource.attributes` est la liste qui en décide.",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "Le service déjà créé ne se transforme pas en application RUM — ce sont deux enregistrements distincts — alors supprimez-le une fois que la télémétrie RUM arrive.",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "Les lignes de clients viennent de `browser.platform`. `browserDetector` lit l'API UA Client Hints, que seuls les navigateurs Chromium possèdent : sur Safari et Firefox, il définit `browser.language` — assez pour classer la télémétrie comme RUM — mais pas `browser.platform`. Définissez vous-même `browser.platform` pour lister ces clients (**Comment OneUptime reconnaît une application navigateur** sous Avancé).",
  "The card is filled only from metrics your app emits. Check, in order:":
    "La carte n'est remplie qu'à partir des métriques qu'émet votre application. Vérifiez, dans l'ordre :",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. Vous avez bien un pipeline de **métriques** — les traces seules ne remplissent jamais cette carte.",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. Les noms des métriques sont ceux que lit OneUptime — voir [Core Web Vitals](/docs/rum/web-vitals).",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. Les métriques apparaissent dans l'onglet **Métriques** de l'application. Si c'est le cas, l'export fonctionne et le problème est le nom ou la période choisie.",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP et CLS sont signalés quand la page est masquée, donc une visite courte peut se terminer avant l'export suivant.",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **Vérifiez la période.** La vue d'ensemble affiche par défaut la dernière heure : un test de ce matin est donc en dehors.",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **Attendez une minute.** L'ingestion passe par une file d'attente, et un seul span de test peut mettre jusqu'à une minute à s'afficher.",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **Vérifiez le projet.** La clé décide dans quel projet la télémétrie arrive.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "Le statut passe à **Aucun trafic récent** après 15 minutes sans télémétrie. C'est attendu tant que personne n'utilise l'application. Si votre application a du trafic :",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- Un **sampler** rejette peut-être tout — vérifiez que vous n'avez pas défini de sampler toujours désactivé ou à très faible ratio.",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- L'application n'émet peut-être que lors d'interactions que personne n'a déclenchées sur cette période.",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- La clé a peut-être été révoquée après le déploiement — lancez la vérification de la clé à l'étape 5.",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name` vaut **`storefront-web`**, l'identifiant de cette application — gardez-le tel quel, sinon les données s'enregistrent comme une nouvelle application.",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "Une application iOS, Android ou React Native avec un SDK OpenTelemetry — opentelemetry-swift, OpenTelemetry Android ou le SDK JavaScript d'OpenTelemetry",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "Le `service.name` que signale votre application — la clé **Mobile** de l'étape 1 y est épinglée",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "Ce sont les paramètres standard d'OpenTelemetry : un SDK qui les lit dans son environnement les prend tels quels. Sinon, définissez le même endpoint, l'en-tête `x-oneuptime-token` et les attributs de ressource sur l'exportateur OTLP et la ressource du SDK dans le code — [Configuration mobile](/docs/rum/mobile-setup) le montre pour Android, iOS et React Native.",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "La plupart des SDK mobiles définissent les attributs `device.*` pour vous. `device.model.identifier` remplit l'onglet **Clients** : définissez-le comme ci-dessus si le vôtre ne le fait pas.",
  '`200` with `"valid": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.':
    "`200` avec `\"valid\": true` signifie que OneUptime accepte la clé, et pour une clé mobile le message ajoute qu'elle ne fonctionne que depuis une application mobile. `401` signifie qu'elle est inconnue, révoquée, désactivée ou expirée, et aucune configuration du SDK n'y changera rien.",
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "Lancez ensuite l'application. Elle apparaît sous **Surveillance des utilisateurs réels** dès son premier lot de télémétrie, nommée d'après le nom de service auquel la clé est épinglée.",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "Tout ce qu'envoie une clé mobile est classé comme cette application mobile, sous le nom de service auquel la clé est épinglée, quoi que dise sa ressource. La clé ne garde de la ressource que ce que l'application dit d'elle-même — comme ses attributs `service.*`, `device.*`, `os.*` et `telemetry.*` et ses étiquettes `oneuptime.label.*` — et rejette le reste : une clé copiée ne peut donc pas faire passer sa télémétrie pour un hôte, un cluster ou un service backend.",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "Avec toute autre clé, OneUptime classe la télémétrie comme **RUM mobile** quand sa ressource porte `device.id` ou `device.model.identifier`. L'application est identifiée par `service.name` (sans tenir compte de la casse), et sa télémétrie appartient à cette application RUM — elle n'est jamais dupliquée en service backend.",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **l'un d'eux** | Marque la télémétrie comme RUM mobile. `device.model.identifier` remplit aussi l'onglet **Clients**. |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "`device.manufacturer` marque aussi un lot comme mobile, mais seulement sur une ressource qui ne porte ni `host.name` ni `host.id` — il sert aussi de fabricant d'une machine physique dans l'élément d'inventaire d'un hôte. Définissez aussi `device.id` ou `device.model.identifier`, et la distinction ne se pose jamais.",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id` doit être un identifiant propre à l'installation, pas un identifiant publicitaire ni quoi que ce soit qui identifie une personne.",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs and metrics, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **Toute personne qui a votre application peut copier sa clé.** C'est pourquoi c'est une clé mobile : une copie ne peut envoyer que les traces, journaux et métriques de cette application, classés sous le nom de service auquel la clé est épinglée, et jamais depuis une page web. Elle peut tout de même envoyer des données inventées pour cette application, jusqu'à la limite de la clé : donnez-lui donc une date d'expiration, renouvelez la clé à chaque version et désactivez-la en cas d'abus.",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "Tout cela se trouve sur la page de la clé, dans **Paramètres du projet > Télémétrie & APM > Clés d'ingestion** : **Nom du service épinglé** est l'application sous laquelle est classé tout ce qu'envoie la clé, **Limite de requêtes par minute** plafonne la clé sur toutes les copies de votre application, **Expire le** arrête son acceptation après une date, et **Activé** la désactive immédiatement.",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "Ne livrez jamais une clé **Serveur** dans une application à la place : elle peut écrire tout type de télémétrie dans ce projet, depuis n'importe où, au nom de n'importe quel service.",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android** — l'agent [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) (`io.opentelemetry.android:android-agent`) définit `device.model.identifier`, `device.model.name` et `device.manufacturer` sur sa propre ressource : la classification fonctionne donc sans configuration supplémentaire, et il signale lui-même les plantages, les ANR, les images lentes et figées, les démarrages de l'application et les sessions. Il nomme l'application d'après son libellé de lanceur sauf si vous définissez `service.name`, et il n'envoie pas de `device.id`. [Configuration Android](/docs/rum/android-setup) donne la dépendance Gradle, le code et ce que devient chacun d'eux dans OneUptime.",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift** — avec [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), définissez vous-même `device.model.identifier` et `device.manufacturer` sur la ressource : la ressource qu'apporte une version du SDK a changé d'une version à l'autre.",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app.":
    "- **React Native / Expo** — exécute le SDK JavaScript, donc la configuration est celle du navigateur dans [Configuration du navigateur](/docs/rum/browser-setup), avec deux différences : il n'y a pas de `browserDetector`, et vous définissez vous-même `device.manufacturer` et `device.model.identifier` pour que l'onglet **Clients** liste les appareils. Elle envoie avec une clé **Mobile**, comme toute application mobile.",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **Tout le reste** — Flutter, Unity, .NET MAUI ou un écrivain OTLP fait main fonctionnent de la même façon, tant que la ressource porte `service.name` plus un attribut `device.*`.",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "Les SDK OpenTelemetry mobiles changent leurs API de builder d'une version à l'autre. [Configuration mobile](/docs/rum/mobile-setup) a du code pour chacun ; vérifiez les noms des méthodes avec la version que vous fixez.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "Tout attribut de ressource préfixé par `oneuptime.label.` devient une étiquette de projet sur l'application — `oneuptime.label.env=production` ajoute l'étiquette `env:production` :",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **Vue d'ensemble** — événements, taux d'erreur et durée p95 sur une période au choix, avec des graphiques de tendance, dérivés des spans qu'émet votre instrumentation.",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **Exceptions** — les plantages et ANR que signale votre application, comme exceptions non gérées, dans la vue d'ensemble et dans **Exceptions**. OpenTelemetry Android signale les deux lui-même ; un ANR est listé avec le type `ANR`.",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **Clients** — les modèles d'appareils sur lesquels l'application a été vue, d'après `device.model.identifier`. Sommaire par modèle, jamais par utilisateur final.",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "Un `401` signifie que la clé est inconnue, révoquée, désactivée ou expirée : choisissez ou créez une clé mobile à l'étape 1 et recompilez l'application avec elle.",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and never from a web page: an SDK that exports over gRPC, or a request that carries an `Origin` header, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "Un `422` indique ce qui a été refusé. Une clé mobile n'envoie que les traces, journaux et métriques OTLP de l'application, en HTTP, et jamais depuis une page web : un SDK qui exporte en gRPC, ou une requête qui porte un en-tête `Origin`, est refusé. Une clé navigateur passe la vérification mais est refusée depuis une application mobile, car elle a besoin d'un en-tête `Origin` et les SDK mobiles n'en envoient pas.",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "La télémétrie a été envoyée avec une clé serveur, et sa ressource ne porte ni `device.id` ni `device.model.identifier` : elle a donc été classée comme un service backend. Envoyez avec une clé mobile (étape 1), qui classe tout ce qu'elle envoie comme cette application, ou définissez-les sur la ressource du SDK, comme à l'étape 2.",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "Les lignes de clients viennent précisément de `device.model.identifier`. Un SDK qui ne définit que `device.manufacturer` est classé comme mobile, mais ne liste aucun client — définissez aussi `device.model.identifier`.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "Le statut passe à **Aucun trafic récent** après 15 minutes sans télémétrie. C'est attendu tant que personne n'utilise l'application. Si votre application est utilisée :",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- La clé a peut-être été révoquée après la publication — lancez la vérification de la clé à l'étape 3.",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name` vaut **`Storefront Mobile`**, l'identifiant de cette application — gardez-le tel quel, sinon les données s'enregistrent comme une nouvelle application. Il est encodé en pourcentage dans `OTEL_RESOURCE_ATTRIBUTES`, et le SDK le décode.",
};

export default TRANSLATION;
