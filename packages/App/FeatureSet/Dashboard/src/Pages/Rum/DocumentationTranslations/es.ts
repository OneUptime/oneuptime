import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in Spanish (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * Spanish. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "Una app web cuyo código puedas cambiar y volver a desplegar, con sus dependencias instaladas mediante npm",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "Los orígenes desde los que se sirve tu sitio, como `https://app.example.com`: una clave de navegador solo acepta solicitudes de los orígenes que figuran en ella",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "Después hazlo el **primer** import de tu app, para que las instrumentaciones parcheen `fetch` antes de que se ejecute cualquier otra cosa:",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "Sustituye `storefront-web` por el nombre de tu aplicación. Así aparece la app en OneUptime, así que mantenlo estable: un nombre nuevo registra una aplicación nueva.",
  "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.":
    "> **Definir solo `service.name` no basta.** Los SDK de navegador de OpenTelemetry no añaden atributos `browser.*` a menos que actives el detector de recursos del navegador o los definas tú: sin ellos esto se convierte en un servicio de backend, no en una aplicación RUM.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Elige una clave de ingesta en el paso 1 para rellenar `<YOUR_API_KEY>`.",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "Combínalo con tu directiva `connect-src` existente. ¿Tu sitio no tiene Content Security Policy? Sáltate este paso.",
  '`200` with `"valid": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.':
    '`200` con `"valid": true` significa que OneUptime acepta la clave; para una clave de navegador, el mensaje añade que solo funciona desde un navegador, desde uno de sus orígenes permitidos. `401` significa que es desconocida, está revocada, desactivada o caducada.',
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "Después carga una página de tu sitio. En un minuto la aplicación aparece en **Monitoreo de usuarios reales**, con el nombre de su `service.name`, con vistas de página, tasa de errores y duración p95.",
  "OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "OneUptime clasifica la telemetría como **RUM** cuando su recurso lleva atributos de cliente: para la web, cualquiera de `browser.platform`, `browser.language` o un `browser.brands` no vacío. La aplicación se identifica por `service.name` (sin distinguir mayúsculas), y su telemetría pertenece a esta aplicación RUM: nunca se duplica como un servicio de backend.",
  "| Attribute | Required | What it does |":
    "| Atributo | Obligatorio | Qué hace |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **sí** | La identidad de la aplicación, p. ej. `storefront-web`. Cambiarle el nombre después crea una aplicación nueva. |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **uno de ellos** | Marca la telemetría como RUM de navegador. `browser.platform` también llena la pestaña **Clientes**. |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Se muestra en la vista general |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector` los define desde el navegador. Lee la API UA Client Hints, que solo tienen los navegadores Chromium, así que en Safari y Firefox define `browser.language` pero no `browser.platform`. Para definir los atributos tú mismo (sin el detector, o para dar a cada navegador una plataforma), construye el recurso así:",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "Mantén `browser.platform` genérico: cada valor distinto se convierte en una fila de la pestaña **Clientes**.",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "Todo lo que hay en el fragmento del navegador llega a tus usuarios. El token que contiene es público: cualquiera que vea el código fuente, abra las devtools o lea tu bundle puede copiarlo. Por eso esta guía solo lista y crea claves de ingesta de tipo **Navegador**, cada una con los orígenes desde los que se sirve tu sitio:",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- solo se acepta desde esos orígenes, así que una clave copiada no funciona en la página de otra persona;",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- solo puede escribir trazas, registros, métricas, reproducciones de sesiones e informes del SDK de navegador de Sentry, no perfiles, source maps, syslog, Fluent, Pyroscope ni eventos de seguridad;",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- tiene límite de frecuencia por clave, se puede desactivar con una sola edición y puede tener una caducidad.",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "Un origen incluye el esquema y el puerto si lo hay, y puede empezar con un comodín de host `*.`: `https://app.example.com`, `https://*.example.com`. Si además defines **Nombre de servicio fijado** en la clave, se fuerza `service.name` en todo lo que escribe, de modo que una clave copiada no puede hacer pasar su telemetría por uno de tus servicios de backend. Ambos están en la página de la clave, en **Ajustes del proyecto > Telemetría y APM > Claves de ingesta**.",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **Nunca incluyas una clave de ingesta de servidor en un navegador.** Una clave de servidor tiene acceso completo de ingesta desde cualquier lugar, sin comprobar el origen. Una vez en el código de la página, quien la encuentre puede escribir spans, registros y métricas falsos en este proyecto (estropeando paneles, disparando alertas falsas y aumentando tu uso facturado) hasta que lo notes y la rotes.",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls` decide qué solicitudes entre orígenes reciben una cabecera W3C `traceparent`, que une el span del navegador con la traza de backend que provocó. Las solicitudes del mismo origen se propagan sin ninguna configuración.",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**No lo pongas en `/.*/`.** Añadir una cabecera convierte una solicitud simple entre orígenes en una con preflight, y cualquier API de terceros que no incluya `traceparent` en su `Access-Control-Allow-Headers` empezará a fallar. Incluye solo orígenes que controles y hayas configurado:",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "Las solicitudes hechas con `XMLHttpRequest` en lugar de `fetch` necesitan `@opentelemetry/instrumentation-xml-http-request` y su `XMLHttpRequestInstrumentation`, con la misma opción.",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "El SDK de navegador de OpenTelemetry no captura automáticamente los errores no detectados. Infórmalos de forma explícita para que lleguen a la vista **Excepciones** junto a tus errores de backend:",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "Las trazas bastan para llenar la vista general. Añade pipelines de registros y métricas si quieres buscar los registros del navegador en OneUptime, o las Core Web Vitals:",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object: a pipeline whose resource lacks `browser.*` is filed as a separate backend Service.":
    "Sus exportadores envían a `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` y `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` con la misma cabecera `x-oneuptime-token`; el código está en [Configuración del navegador](/docs/rum/browser-setup). Constrúyelos con el mismo objeto `resource`: un pipeline cuyo recurso no tenga `browser.*` se archiva como un servicio de backend aparte.",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "La tarjeta **Core Web Vitals** (LCP, INP, CLS, FCP y TTFB) solo se llena con métricas que informa tu app, con nombres como `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lista los nombres que lee OneUptime y conecta la biblioteca `web-vitals`.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "Cualquier atributo de recurso con el prefijo `oneuptime.label.` se convierte en una etiqueta del proyecto en la aplicación: `oneuptime.label.env` con el valor `production` añade la etiqueta `env:production`:",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "Usa un `service.name` por app, no por entorno, y distingue los entornos con una etiqueta, para que cada app conserve una aplicación y un historial.",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "Para etiquetar aplicaciones o asignar propietarios por nombre, usa **Monitoreo de usuarios reales → Ajustes → Reglas de etiquetas** y **Reglas del propietario**. Las reglas se ejecutan cuando se crea una aplicación, también por descubrimiento automático; no vuelven a etiquetar aplicaciones que ya existen.",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **Vista general**: vistas de página, tasa de errores y duración p95 en un intervalo de tiempo seleccionable, con gráficos de tendencia. Se derivan de los spans que emite tu instrumentación, así que una vista de página es lo que esta informe: cargas de documento, cambios de ruta, interacciones.",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals**: LCP, INP, CLS, FCP y TTFB, cuando tu app los informa como métricas.",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **Registros**, **Trazas** y **Métricas**: los exploradores de telemetría, limitados a esta aplicación.",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **Clientes**: las plataformas de navegador en las que se ha visto la aplicación, a partir de `browser.platform`. Genérico por plataforma, nunca por usuario final.",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **Reproducción de sesiones**: un grabador aparte y opcional, con su propia etiqueta de script y sus controles de privacidad: [Reproducción de sesiones](/docs/telemetry/session-replay).",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "La aplicación muestra **Recibiendo datos** mientras sigue llegando telemetría, y **Sin tráfico reciente** tras 15 minutos sin ella, lo que es normal mientras nadie usa la app.",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "Abre las DevTools → **Network** y filtra por `otlp`: buscas `POST /otlp/v1/traces`. Si no hay ninguna solicitud, el SDK nunca se inició:",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts` no se importa primero. Las instrumentaciones parchean `fetch`; lo que se importe antes no se traza, y si el tree-shaking elimina el import, no se ejecuta nada.",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- El procesador por lotes aún no ha vaciado su búfer. `BatchSpanProcessor` acumula: espera unos 30 segundos, o navega, antes de concluir que no se envía nada.",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- Una variable de entorno de compilación se resolvió como `undefined`, así que la URL del exportador está mal formada. Escríbela una vez al iniciar.",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **Bloqueado por la Content Security Policy**: la consola lo indica. Añade `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (paso 4).",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **Bloqueado por CORS**: los endpoints OTLP de OneUptime permiten cualquier origen y la cabecera `x-oneuptime-token`, así que un fallo de CORS casi siempre significa que la solicitud ni siquiera llega a OneUptime: un proxy corporativo, un bloqueador de anuncios o una errata en el host.",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`**: añade el origen exacto de tu sitio (esquema, host y puerto) a los **Orígenes permitidos** de la clave en **Ajustes del proyecto > Telemetría y APM > Claves de ingesta**.",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`**: vuelve a activar la clave allí o elige otra clave en el paso 1.",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`**: la clave es desconocida, está revocada o caducada. Ejecuta la comprobación de la clave en el paso 5 y elige o crea una clave de navegador válida en el paso 1.",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`**: la URL es incorrecta. El exportador de trazas necesita la ruta completa, `/otlp/v1/traces`.",
  "The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable `browserDetector` as in step 3, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "El recurso no lleva ningún atributo de navegador, así que la telemetría se archivó como un servicio de backend. Activa `browserDetector` como en el paso 3, o define tú los atributos `browser.*` (**Cómo reconoce OneUptime una aplicación de navegador** en Avanzado).",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "Comprueba lo que envías en DevTools → **Network** → la solicitud OTLP → **Payload**: `resourceSpans[0].resource.attributes` es la lista que lo decide.",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "El servicio que ya se creó no se convierte en una aplicación RUM (son registros distintos), así que elimínalo cuando llegue la telemetría RUM.",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "Las filas de clientes salen de `browser.platform`. `browserDetector` lee la API UA Client Hints, que solo tienen los navegadores Chromium: en Safari y Firefox define `browser.language` (suficiente para clasificar la telemetría como RUM), pero no `browser.platform`. Define tú `browser.platform` para listar esos clientes (**Cómo reconoce OneUptime una aplicación de navegador** en Avanzado).",
  "The card is filled only from metrics your app emits. Check, in order:":
    "La tarjeta solo se llena con métricas que emite tu app. Comprueba, por orden:",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. Que tienes un pipeline de **métricas**: las trazas solas nunca llenan esta tarjeta.",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. Que los nombres de las métricas son los que lee OneUptime: consulta [Core Web Vitals](/docs/rum/web-vitals).",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. Que las métricas aparecen en la pestaña **Métricas** de la aplicación. Si aparecen, la exportación funciona y el problema es el nombre o el intervalo seleccionado.",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP y CLS se informan cuando la página se oculta, así que una visita corta puede terminar antes de la siguiente exportación.",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **Comprueba el intervalo de tiempo.** La vista general muestra por defecto la última hora, así que una prueba de esta mañana queda fuera.",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **Espera un minuto.** La ingesta va en cola, y un solo span de prueba puede tardar hasta un minuto en aparecer.",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **Comprueba el proyecto.** La clave decide en qué proyecto acaba la telemetría.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "El estado pasa a **Sin tráfico reciente** tras 15 minutos sin telemetría. Es lo esperado mientras nadie usa la app. Si tu app tiene tráfico:",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- Puede que un **sampler** esté descartándolo todo: comprueba que no hayas configurado un sampler siempre apagado o con una proporción muy baja.",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- Puede que la app solo emita con interacciones que nadie hizo en ese intervalo.",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- Puede que la clave se revocara después del despliegue: ejecuta la comprobación de la clave en el paso 5.",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name` es **`storefront-web`**, el identificador de esta aplicación: déjalo como está, o los datos se registran como una aplicación nueva.",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "Una app de iOS, Android o React Native con un SDK de OpenTelemetry: opentelemetry-swift, OpenTelemetry Android o el SDK de JavaScript de OpenTelemetry",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "El `service.name` que informa tu app: la clave **Móvil** del paso 1 está fijada a él",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "Son los ajustes estándar de OpenTelemetry: un SDK que los lee de su entorno los toma tal cual. Si no, define el mismo endpoint, la cabecera `x-oneuptime-token` y los atributos de recurso en el exportador OTLP y el recurso del SDK en el código: [Configuración móvil](/docs/rum/mobile-setup) lo muestra para Android, iOS y React Native.",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "La mayoría de los SDK móviles definen los atributos `device.*` por ti. `device.model.identifier` llena la pestaña **Clientes**, así que defínelo como arriba si el tuyo no lo hace.",
  '`200` with `"valid": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.':
    '`200` con `"valid": true` significa que OneUptime acepta la clave, y para una clave móvil el mensaje añade que solo funciona desde una app móvil. `401` significa que es desconocida, está revocada, desactivada o caducada, y ninguna configuración del SDK lo arreglará.',
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "Después inicia la app. Aparece en **Monitoreo de usuarios reales** con su primer lote de telemetría, con el nombre de servicio al que está fijada la clave.",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "Todo lo que envía una clave móvil se archiva como esta app móvil, bajo el nombre de servicio al que está fijada la clave, diga lo que diga su recurso. La clave conserva del recurso solo lo que una app dice de sí misma (como sus atributos `service.*`, `device.*`, `os.*` y `telemetry.*` y sus etiquetas `oneuptime.label.*`) y descarta el resto, así que una clave copiada no puede hacer pasar su telemetría por un host, un clúster o un servicio de backend.",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "Con cualquier otra clave, OneUptime clasifica la telemetría como **RUM móvil** cuando su recurso lleva `device.id` o `device.model.identifier`. La aplicación se identifica por `service.name` (sin distinguir mayúsculas), y su telemetría pertenece a esta aplicación RUM: nunca se duplica como un servicio de backend.",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **uno de ellos** | Marca la telemetría como RUM móvil. `device.model.identifier` también llena la pestaña **Clientes**. |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "`device.manufacturer` también marca un lote como móvil, pero solo en un recurso que no lleva `host.name` ni `host.id`: también sirve como fabricante de una máquina física en el elemento de inventario de un host. Define además `device.id` o `device.model.identifier` y la distinción nunca importa.",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id` debe ser un identificador por instalación, no un ID de publicidad ni nada que identifique a una persona.",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs and metrics, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **Quien tenga tu app puede copiar su clave.** Por eso es una clave móvil: una copia solo puede enviar las trazas, registros y métricas de esta app, archivados bajo el nombre de servicio al que está fijada la clave, y nunca desde una página web. Aun así puede enviar datos inventados para esta app, hasta el límite de la clave, así que ponle una caducidad, rota la clave con tus versiones y desactívala si se usa indebidamente.",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "Todo esto está en la página de la clave, en **Ajustes del proyecto > Telemetría y APM > Claves de ingesta**: **Nombre de servicio fijado** es la app bajo la que se archiva todo lo que envía la clave, **Límite de solicitudes por minuto** limita la clave en todas las copias de tu app, **Caduca el** hace que deje de aceptarse después de una fecha, y **Habilitado** la desactiva al instante.",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "Nunca incluyas en su lugar una clave de **Servidor** en una app: puede escribir cualquier tipo de telemetría en este proyecto, desde cualquier lugar y como cualquier servicio.",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android**: el agente [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) (`io.opentelemetry.android:android-agent`) define `device.model.identifier`, `device.model.name` y `device.manufacturer` en su propio recurso, así que la clasificación funciona sin configuración adicional, e informa por sí solo de fallos, ANR, fotogramas lentos y congelados, arranques de la app y sesiones. Nombra la app según la etiqueta de su lanzador si no defines `service.name`, y no envía `device.id`. [Configuración de Android](/docs/rum/android-setup) tiene la dependencia de Gradle, el código y en qué se convierte cada uno en OneUptime.",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift**: con [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), define tú `device.model.identifier` y `device.manufacturer` en el recurso: el recurso que aporta cada versión del SDK ha cambiado entre versiones.",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app.":
    "- **React Native / Expo**: ejecuta el SDK de JavaScript, así que la configuración es la del navegador de [Configuración del navegador](/docs/rum/browser-setup) con dos diferencias: no hay `browserDetector`, y defines tú `device.manufacturer` y `device.model.identifier` para que la pestaña **Clientes** liste los dispositivos. Envía con una clave **Móvil**, como cualquier app móvil.",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **Cualquier otra cosa**: Flutter, Unity, .NET MAUI o un escritor OTLP hecho a mano funcionan igual, siempre que el recurso lleve `service.name` y un atributo `device.*`.",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "Los SDK móviles de OpenTelemetry cambian sus API de builder entre versiones. [Configuración móvil](/docs/rum/mobile-setup) tiene código para cada uno; comprueba los nombres de los métodos con la versión que fijes.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "Cualquier atributo de recurso con el prefijo `oneuptime.label.` se convierte en una etiqueta del proyecto en la aplicación: `oneuptime.label.env=production` añade la etiqueta `env:production`:",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **Vista general**: eventos, tasa de errores y duración p95 en un intervalo de tiempo seleccionable, con gráficos de tendencia, derivados de los spans que emite tu instrumentación.",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **Excepciones**: los fallos y ANR que informa tu app, como excepciones no gestionadas, en la vista general y en **Excepciones**. OpenTelemetry Android informa de ambos por sí solo; un ANR aparece con el tipo `ANR`.",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **Clientes**: los modelos de dispositivo en los que se ha visto la aplicación, a partir de `device.model.identifier`. Genérico por modelo, nunca por usuario final.",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "Un `401` significa que la clave es desconocida, está revocada, desactivada o caducada: elige o crea una clave móvil en el paso 1 y vuelve a compilar la app con ella.",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and never from a web page: an SDK that exports over gRPC, or a request that carries an `Origin` header, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "Un `422` indica qué se rechazó. Una clave móvil solo envía las trazas, registros y métricas OTLP de la app, por HTTP, y nunca desde una página web: se rechaza un SDK que exporta por gRPC o una solicitud que lleva una cabecera `Origin`. Una clave de navegador pasa la comprobación, pero se rechaza desde una app móvil, porque necesita una cabecera `Origin` y los SDK móviles no envían ninguna.",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "La telemetría se envió con una clave de servidor, y su recurso no lleva `device.id` ni `device.model.identifier`, así que se archivó como un servicio de backend. Envía con una clave móvil (paso 1), que archiva todo lo que envía como esta app, o defínelos en el recurso del SDK, como en el paso 2.",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "Las filas de clientes salen concretamente de `device.model.identifier`. Un SDK que solo define `device.manufacturer` se clasifica como móvil, pero no lista clientes: define también `device.model.identifier`.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "El estado pasa a **Sin tráfico reciente** tras 15 minutos sin telemetría. Es lo esperado mientras nadie usa la app. Si tu app se está usando:",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- Puede que la clave se revocara después de la versión: ejecuta la comprobación de la clave en el paso 3.",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name` es **`Storefront Mobile`**, el identificador de esta aplicación: déjalo como está, o los datos se registran como una aplicación nueva. Está codificado con porcentajes en `OTEL_RESOURCE_ATTRIBUTES`, y el SDK lo decodifica.",
};

export default TRANSLATION;
