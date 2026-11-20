import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Rum setup guide in Portuguese (#6434): each piece of the English
 * guide's markdown (Components/Rum/RumSetupGuide.ts) and its
 * Portuguese. Code, field names and product names are as the English
 * writes them, and what the Dashboard draws is named as its locale words
 * it. Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A web app whose code you can change and redeploy, with its dependencies installed through npm":
    "Um app web cujo código você possa alterar e implantar de novo, com as dependências instaladas pelo npm",
  "The origins your site is served from, such as `https://app.example.com` — a Browser key only accepts requests from the origins you list on it":
    "As origens das quais seu site é servido, como `https://app.example.com` — uma chave de navegador só aceita requisições das origens que você listar nela",
  "Then make it the **first** import of your app, so the instrumentations patch `fetch` before anything else runs:":
    "Depois faça dele o **primeiro** import do seu app, para que as instrumentações apliquem o patch em `fetch` antes de qualquer outra coisa rodar:",
  "Replace `storefront-web` with your application's name. It is how the app appears in OneUptime, so keep it stable: a new name registers a new application.":
    "Substitua `storefront-web` pelo nome do seu aplicativo. É assim que o app aparece no OneUptime, então mantenha-o estável: um nome novo registra um aplicativo novo.",
  "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.":
    "> **Definir apenas `service.name` não basta.** Os SDKs de navegador do OpenTelemetry não adicionam atributos `browser.*` a menos que você ative o detector de recursos do navegador ou os defina você mesmo — sem eles, isto vira um serviço de backend, não um aplicativo RUM.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Escolha uma chave de ingestão na etapa 1 para preencher `<YOUR_API_KEY>`.",
  "Merge it into your existing `connect-src` directive. No Content Security Policy on your site? Skip this step.":
    "Mescle-o à sua diretiva `connect-src` existente. Seu site não tem Content Security Policy? Pule esta etapa.",
  '`200` with `"valid": true` means OneUptime accepts the key — for a Browser key the message adds that it only works from a browser, from one of its allowed origins. `401` means it is unknown, revoked, disabled or expired.':
    '`200` com `"valid": true` significa que o OneUptime aceita a chave — para uma chave de navegador, a mensagem acrescenta que ela só funciona a partir de um navegador, de uma das origens permitidas. `401` significa que ela é desconhecida, revogada, desativada ou expirada.',
  "Then load a page of your site. Within a minute the application appears under **Real User Monitoring**, named after its `service.name`, with page views, error rate and p95 duration.":
    "Depois carregue uma página do seu site. Em um minuto o aplicativo aparece em **Monitoramento de Usuários Reais**, com o nome do seu `service.name`, com visualizações de página, taxa de erros e duração p95.",
  "OneUptime classifies telemetry as **RUM** when its resource carries client attributes — for web, any of `browser.platform`, `browser.language` or a non-empty `browser.brands`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "O OneUptime classifica a telemetria como **RUM** quando o recurso dela traz atributos de cliente — na web, qualquer um de `browser.platform`, `browser.language` ou um `browser.brands` não vazio. O aplicativo é identificado por `service.name` (sem diferenciar maiúsculas e minúsculas), e a telemetria dele pertence a este aplicativo RUM — ela nunca é duplicada como um serviço de backend.",
  "| Attribute | Required | What it does |":
    "| Atributo | Obrigatório | O que faz |",
  "| `service.name` | **yes** | The application's identity, e.g. `storefront-web`. Renaming it later creates a new application. |":
    "| `service.name` | **sim** | A identidade do aplicativo, por exemplo `storefront-web`. Renomeá-lo depois cria um aplicativo novo. |",
  "| `browser.platform` / `browser.language` / `browser.brands` | **one of them** | Marks the telemetry as browser RUM. `browser.platform` also fills the **Clients** tab. |":
    "| `browser.platform` / `browser.language` / `browser.brands` | **um deles** | Marca a telemetria como RUM de navegador. `browser.platform` também preenche a aba **Clientes**. |",
  "| `telemetry.sdk.language` / `telemetry.sdk.version` | no | Shown on the overview |":
    "| `telemetry.sdk.language` / `telemetry.sdk.version` | não | Exibido na visão geral |",
  "`browserDetector` sets them from the browser. It reads the UA Client Hints API, which only Chromium browsers have, so on Safari and Firefox it sets `browser.language` but not `browser.platform`. To set the attributes yourself — without the detector, or to give every browser a platform — build the resource like this:":
    "`browserDetector` os define a partir do navegador. Ele lê a API UA Client Hints, que só os navegadores Chromium têm, então no Safari e no Firefox ele define `browser.language`, mas não `browser.platform`. Para definir os atributos você mesmo — sem o detector, ou para dar uma plataforma a todo navegador — monte o recurso assim:",
  "Keep `browser.platform` coarse: every distinct value becomes a row on the **Clients** tab.":
    "Mantenha `browser.platform` genérico: cada valor distinto vira uma linha na aba **Clientes**.",
  "Everything in the browser snippet ships to your users. The token in it is public — anyone who views source, opens devtools or reads your bundle can copy it. That is why this guide only lists and creates **Browser** ingestion keys, each with the origins your site is served from:":
    "Tudo no snippet do navegador chega aos seus usuários. O token nele é público — qualquer pessoa que veja o código-fonte, abra as devtools ou leia seu bundle pode copiá-lo. Por isso este guia só lista e cria chaves de ingestão do tipo **Navegador**, cada uma com as origens das quais seu site é servido:",
  "- it is accepted only from those origins, so a copied key does not work from anyone else's page;":
    "- ela só é aceita dessas origens, então uma chave copiada não funciona na página de outra pessoa;",
  "- it can only write traces, logs, metrics, session replays and Sentry browser SDK reports — not profiles, source maps, syslog, Fluent, Pyroscope or security events;":
    "- ela só pode escrever traços, registros, métricas, reproduções de sessões e relatórios do SDK de navegador do Sentry — não perfis, source maps, syslog, Fluent, Pyroscope ou eventos de segurança;",
  "- it is rate limited per key, can be switched off in one edit, and can be given an expiry.":
    "- ela tem limite de taxa por chave, pode ser desativada com uma única edição e pode ter uma validade.",
  "An origin includes the scheme and any port, and may start with one `*.` host wildcard — `https://app.example.com`, `https://*.example.com`. Setting **Pinned Service Name** on the key as well forces `service.name` on everything it writes, so a copied key cannot pass its telemetry off as one of your backend services. Both are on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "Uma origem inclui o esquema e a porta, se houver, e pode começar com um curinga de host `*.` — `https://app.example.com`, `https://*.example.com`. Definir também **Nome do serviço fixado** na chave força `service.name` em tudo o que ela escreve, para que uma chave copiada não possa fazer sua telemetria passar por um dos seus serviços de backend. Os dois ficam na página da chave, em **Configurações do projeto > Telemetria e APM > Chaves de ingestão**.",
  "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check. Once it is in page source, anyone who finds it can write forged spans, logs and metrics into this project — poisoning dashboards, firing false alerts and running up your metered usage — until you notice and rotate it.":
    "> **Nunca envie uma chave de ingestão de servidor para um navegador.** Uma chave de servidor tem acesso total de ingestão de qualquer lugar, sem verificação de origem. Uma vez no código-fonte da página, qualquer pessoa que a encontre pode escrever spans, registros e métricas falsos neste projeto — estragando painéis, disparando alertas falsos e aumentando seu uso cobrado — até você perceber e trocá-la.",
  "`propagateTraceHeaderCorsUrls` decides which cross-origin requests get a W3C `traceparent` header, joining the browser span to the backend trace it triggered. Same-origin requests are propagated without any configuration.":
    "`propagateTraceHeaderCorsUrls` decide quais requisições entre origens recebem um cabeçalho W3C `traceparent`, ligando o span do navegador ao traço de backend que ele disparou. Requisições da mesma origem são propagadas sem nenhuma configuração.",
  "**Do not set it to `/.*/`.** Adding a header turns a simple cross-origin request into a preflighted one, and any third-party API that does not list `traceparent` in its `Access-Control-Allow-Headers` will start failing. List only origins you control and have configured:":
    "**Não o defina como `/.*/`.** Adicionar um cabeçalho transforma uma requisição simples entre origens em uma com preflight, e qualquer API de terceiros que não liste `traceparent` em seu `Access-Control-Allow-Headers` vai começar a falhar. Liste apenas origens que você controla e configurou:",
  "Requests made with `XMLHttpRequest` instead of `fetch` need `@opentelemetry/instrumentation-xml-http-request` and its `XMLHttpRequestInstrumentation`, with the same option.":
    "Requisições feitas com `XMLHttpRequest` em vez de `fetch` precisam de `@opentelemetry/instrumentation-xml-http-request` e do `XMLHttpRequestInstrumentation` dele, com a mesma opção.",
  "Uncaught errors are not captured automatically by the OpenTelemetry browser SDK. Report them explicitly so they roll into the **Exceptions** view alongside your backend errors:":
    "O SDK de navegador do OpenTelemetry não captura automaticamente erros não tratados. Relate-os de forma explícita para que entrem na visualização **Exceções** ao lado dos seus erros de backend:",
  "Traces are enough to fill the overview. Add log and metric pipelines if you want browser logs searchable in OneUptime, or Core Web Vitals:":
    "Traços bastam para preencher a visão geral. Adicione pipelines de registros e de métricas se quiser registros do navegador pesquisáveis no OneUptime, ou Core Web Vitals:",
  "Their exporters send to `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` and `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` with the same `x-oneuptime-token` header — [Browser Setup](/docs/rum/browser-setup) has the code. Build them with the same `resource` object: a pipeline whose resource lacks `browser.*` is filed as a separate backend Service.":
    "Os exportadores deles enviam para `<YOUR_ONEUPTIME_URL>/otlp/v1/logs` e `<YOUR_ONEUPTIME_URL>/otlp/v1/metrics` com o mesmo cabeçalho `x-oneuptime-token` — o código está em [Configuração do navegador](/docs/rum/browser-setup). Monte-os com o mesmo objeto `resource`: um pipeline cujo recurso não tem `browser.*` é arquivado como um serviço de backend separado.",
  "The **Core Web Vitals** card — LCP, INP, CLS, FCP and TTFB — is filled only from metrics your app reports, under names such as `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lists the names OneUptime reads and wires up the `web-vitals` library.":
    "O cartão **Core Web Vitals** — LCP, INP, CLS, FCP e TTFB — só é preenchido com métricas que seu app relata, com nomes como `web_vital.lcp`. [Core Web Vitals](/docs/rum/web-vitals) lista os nomes que o OneUptime lê e conecta a biblioteca `web-vitals`.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env` set to `production` adds the label `env:production`:":
    "Qualquer atributo de recurso com o prefixo `oneuptime.label.` vira um rótulo de projeto no aplicativo — `oneuptime.label.env` definido como `production` adiciona o rótulo `env:production`:",
  "Use one `service.name` per app, not per environment, and tell environments apart with a label, so each app keeps one application and one history.":
    "Use um `service.name` por app, não por ambiente, e diferencie os ambientes com um rótulo, para que cada app mantenha um aplicativo e um histórico.",
  "To label applications or assign owners by name, use **Real User Monitoring → Settings → Label Rules** and **Owner Rules**. Rules run when an application is created, including by auto-discovery; they do not relabel applications that already exist.":
    "Para rotular aplicativos ou atribuir proprietários pelo nome, use **Monitoramento de Usuários Reais → Configurações → Regras de Rótulos** e **Regras de proprietário**. As regras rodam quando um aplicativo é criado, inclusive pela descoberta automática; elas não rotulam de novo aplicativos que já existem.",
  "- **Overview** — page views, error rate and p95 duration over a selectable time range, with trend charts. They are derived from the spans your instrumentation emits, so a page view is whatever it reports: document loads, route changes, interactions.":
    "- **Visão geral** — visualizações de página, taxa de erros e duração p95 em um intervalo de tempo selecionável, com gráficos de tendência. Elas são derivadas dos spans que sua instrumentação emite, então uma visualização de página é o que ela relatar: carregamentos de documento, mudanças de rota, interações.",
  "- **Core Web Vitals** — LCP, INP, CLS, FCP and TTFB, once your app reports them as metrics.":
    "- **Core Web Vitals** — LCP, INP, CLS, FCP e TTFB, quando seu app os relata como métricas.",
  "- **Logs**, **Traces** and **Metrics** — the telemetry explorers, scoped to this application.":
    "- **Registros**, **Traços** e **Métricas** — os exploradores de telemetria, restritos a este aplicativo.",
  "- **Clients** — the browser platforms the application has been seen on, from `browser.platform`. Coarse by platform, never per end user.":
    "- **Clientes** — as plataformas de navegador em que o aplicativo foi visto, a partir de `browser.platform`. Genérico por plataforma, nunca por usuário final.",
  "- **Session Replay** — a separate, optional recorder with its own script tag and privacy controls: [Session Replay](/docs/telemetry/session-replay).":
    "- **Reprodução de sessões** — um gravador separado e opcional, com sua própria tag de script e seus controles de privacidade: [Reprodução de sessões](/docs/telemetry/session-replay).",
  "The application shows **Receiving data** while telemetry keeps arriving, and **No recent traffic** after 15 minutes without any, which is normal while nobody is using the app.":
    "O aplicativo mostra **Recebendo dados** enquanto a telemetria continua chegando, e **Sem tráfego recente** depois de 15 minutos sem nenhuma, o que é normal enquanto ninguém usa o app.",
  "Open DevTools → **Network** and filter for `otlp`: you are looking for `POST /otlp/v1/traces`. No request at all means the SDK never started:":
    "Abra as DevTools → **Network** e filtre por `otlp`: você procura `POST /otlp/v1/traces`. Nenhuma requisição significa que o SDK nunca iniciou:",
  "- `telemetry.ts` is not imported first. The instrumentations patch `fetch`; anything imported before them is not traced, and if the import is tree-shaken out, nothing runs at all.":
    "- `telemetry.ts` não é importado primeiro. As instrumentações aplicam o patch em `fetch`; o que for importado antes delas não é rastreado, e se o tree-shaking remover o import, nada roda.",
  "- The batch processor has not flushed yet. `BatchSpanProcessor` buffers — wait about 30 seconds, or navigate, before concluding nothing is sent.":
    "- O processador em lote ainda não esvaziou o buffer. `BatchSpanProcessor` acumula — espere uns 30 segundos, ou navegue, antes de concluir que nada é enviado.",
  "- A build-time environment variable resolved to `undefined`, so the exporter URL is malformed. Log it once at startup.":
    "- Uma variável de ambiente de build virou `undefined`, então a URL do exportador está malformada. Imprima-a uma vez na inicialização.",
  "- **Blocked by the Content Security Policy** — the console says so. Add `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (step 4).":
    "- **Bloqueado pela Content Security Policy** — o console avisa. Adicione `connect-src 'self' <YOUR_ONEUPTIME_URL>;` (etapa 4).",
  "- **Blocked by CORS** — the OneUptime OTLP endpoints allow any origin and the `x-oneuptime-token` header, so a CORS failure almost always means the request is not reaching OneUptime at all: a corporate proxy, an ad blocker, or a typo in the host.":
    "- **Bloqueado por CORS** — os endpoints OTLP do OneUptime permitem qualquer origem e o cabeçalho `x-oneuptime-token`, então uma falha de CORS quase sempre significa que a requisição nem chega ao OneUptime: um proxy corporativo, um bloqueador de anúncios ou um erro de digitação no host.",
  "- **`Origin … is not allowed for this browser ingestion key`** — add your site's exact origin (scheme, host and port) to the key's **Allowed Origins** in **Project Settings > Telemetry & APM > Ingestion Keys**.":
    "- **`Origin … is not allowed for this browser ingestion key`** — adicione a origem exata do seu site (esquema, host e porta) às **Origens permitidas** da chave em **Configurações do projeto > Telemetria e APM > Chaves de ingestão**.",
  "- **`This telemetry ingestion key has been disabled`** — switch the key back on there, or pick another key in step 1.":
    "- **`This telemetry ingestion key has been disabled`** — reative a chave ali, ou escolha outra chave na etapa 1.",
  "- **`401`** — the key is unknown, revoked or expired. Run the key check in step 5, and pick or create a live Browser key in step 1.":
    "- **`401`** — a chave é desconhecida, revogada ou expirada. Execute a verificação da chave na etapa 5 e escolha ou crie uma chave de navegador válida na etapa 1.",
  "- **`404`** — the URL is wrong. The trace exporter needs the full path, `/otlp/v1/traces`.":
    "- **`404`** — a URL está errada. O exportador de traços precisa do caminho completo, `/otlp/v1/traces`.",
  "The resource carries no browser attribute, so the telemetry was filed as a backend Service. Enable `browserDetector` as in step 3, or set the `browser.*` attributes yourself (**How OneUptime recognises a browser app** under Advanced).":
    "O recurso não traz nenhum atributo de navegador, então a telemetria foi arquivada como um serviço de backend. Ative o `browserDetector` como na etapa 3, ou defina os atributos `browser.*` você mesmo (**Como o OneUptime reconhece um app de navegador** em Avançado).",
  "Confirm what you send in DevTools → **Network** → the OTLP request → **Payload**: `resourceSpans[0].resource.attributes` is the list that decides it.":
    "Confira o que você envia em DevTools → **Network** → a requisição OTLP → **Payload**: `resourceSpans[0].resource.attributes` é a lista que decide.",
  "The Service that was already created does not turn into a RUM application — the two are separate records — so delete it once RUM telemetry arrives.":
    "O serviço que já foi criado não se transforma em um aplicativo RUM — os dois são registros separados — então exclua-o quando a telemetria RUM chegar.",
  "Client rows come from `browser.platform`. `browserDetector` reads the UA Client Hints API, which only Chromium browsers have: on Safari and Firefox it sets `browser.language` — enough to classify the telemetry as RUM — but not `browser.platform`. Set `browser.platform` yourself to list those clients (**How OneUptime recognises a browser app** under Advanced).":
    "As linhas de clientes vêm de `browser.platform`. `browserDetector` lê a API UA Client Hints, que só os navegadores Chromium têm: no Safari e no Firefox ele define `browser.language` — o bastante para classificar a telemetria como RUM — mas não `browser.platform`. Defina `browser.platform` você mesmo para listar esses clientes (**Como o OneUptime reconhece um app de navegador** em Avançado).",
  "The card is filled only from metrics your app emits. Check, in order:":
    "O cartão só é preenchido com métricas que seu app emite. Verifique, nesta ordem:",
  "1. You have a **metrics** pipeline at all — traces alone never fill this card.":
    "1. Você tem um pipeline de **métricas** — traços sozinhos nunca preenchem este cartão.",
  "2. The metric names are ones OneUptime reads — see [Core Web Vitals](/docs/rum/web-vitals).":
    "2. Os nomes das métricas são os que o OneUptime lê — veja [Core Web Vitals](/docs/rum/web-vitals).",
  "3. The metrics appear on the application's **Metrics** tab. If they do, the export works and the issue is the name or the selected range.":
    "3. As métricas aparecem na aba **Métricas** do aplicativo. Se aparecem, a exportação funciona e o problema é o nome ou o intervalo selecionado.",
  "4. INP and CLS are reported when the page is hidden, so a short visit can end before the next export.":
    "4. INP e CLS são relatados quando a página fica oculta, então uma visita curta pode terminar antes da próxima exportação.",
  "- **Check the time range.** The overview defaults to the past hour, so a test from this morning is outside it.":
    "- **Confira o intervalo de tempo.** A visão geral mostra por padrão a última hora, então um teste de hoje de manhã fica de fora.",
  "- **Wait a minute.** Ingest is queued, and a single test span can take up to a minute to show.":
    "- **Espere um minuto.** A ingestão passa por uma fila, e um único span de teste pode levar até um minuto para aparecer.",
  "- **Check the project.** The key decides which project the telemetry lands in.":
    "- **Confira o projeto.** A chave decide em qual projeto a telemetria cai.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app has traffic:":
    "O status muda para **Sem tráfego recente** depois de 15 minutos sem telemetria. Isso é esperado enquanto ninguém usa o app. Se o seu app tem tráfego:",
  "- A **sampler** may be dropping everything — check you have not set an always-off or very low ratio sampler.":
    "- Um **sampler** pode estar descartando tudo — confira se você não definiu um sampler sempre desligado ou com proporção muito baixa.",
  "- The app may only emit on interactions nobody triggered in that window.":
    "- O app pode só emitir em interações que ninguém fez nesse intervalo.",
  "- The key may have been revoked after the deploy — run the key check in step 5.":
    "- A chave pode ter sido revogada depois da implantação — execute a verificação da chave na etapa 5.",
  "`service.name` is **`storefront-web`**, this application's identifier — keep it as it is, or the data registers as a new application.":
    "`service.name` é **`storefront-web`**, o identificador deste aplicativo — mantenha-o como está, ou os dados se registram como um aplicativo novo.",
  "An iOS, Android or React Native app with an OpenTelemetry SDK — opentelemetry-swift, OpenTelemetry Android, or the OpenTelemetry JavaScript SDK":
    "Um app iOS, Android ou React Native com um SDK do OpenTelemetry — opentelemetry-swift, OpenTelemetry Android ou o SDK JavaScript do OpenTelemetry",
  "The `service.name` your app reports — the **Mobile** key in step 1 is pinned to it":
    "O `service.name` que seu app relata — a chave de **Celular** da etapa 1 é fixada nele",
  "These are the standard OpenTelemetry settings: an SDK that reads them from its environment takes them as they are. Otherwise set the same endpoint, `x-oneuptime-token` header and resource attributes on the SDK's OTLP exporter and resource in code — [Mobile Setup](/docs/rum/mobile-setup) shows it for Android, iOS and React Native.":
    "Estas são as configurações padrão do OpenTelemetry: um SDK que as lê do ambiente as usa como estão. Caso contrário, defina o mesmo endpoint, o cabeçalho `x-oneuptime-token` e os atributos de recurso no exportador OTLP e no recurso do SDK, no código — [Configuração móvel](/docs/rum/mobile-setup) mostra como para Android, iOS e React Native.",
  "Most mobile SDKs set the `device.*` attributes for you. `device.model.identifier` fills the **Clients** tab, so set it as above if yours does not.":
    "A maioria dos SDKs móveis define os atributos `device.*` por você. `device.model.identifier` preenche a aba **Clientes**, então defina-o como acima se o seu não fizer isso.",
  '`200` with `"valid": true` means OneUptime accepts the key, and for a Mobile key the message adds that it works only from a mobile app. `401` means it is unknown, revoked, disabled or expired, and no amount of SDK configuration will help.':
    '`200` com `"valid": true` significa que o OneUptime aceita a chave, e para uma chave de celular a mensagem acrescenta que ela só funciona a partir de um app móvel. `401` significa que ela é desconhecida, revogada, desativada ou expirada, e nenhuma configuração do SDK vai resolver.',
  "Then launch the app. It appears under **Real User Monitoring** on its first batch of telemetry, named after the service name the key is pinned to.":
    "Depois inicie o app. Ele aparece em **Monitoramento de Usuários Reais** com o primeiro lote de telemetria, com o nome de serviço ao qual a chave está fixada.",
  "Everything a Mobile key sends is filed as this mobile app, under the service name the key is pinned to, whatever its resource says. The key keeps only what an app says about itself on the resource — such as its `service.*`, `device.*`, `os.*` and `telemetry.*` attributes and its `oneuptime.label.*` labels — and drops the rest, so a copied key cannot pass its telemetry off as a host, a cluster or a backend service.":
    "Tudo o que uma chave de celular envia é arquivado como este app móvel, sob o nome de serviço ao qual a chave está fixada, seja o que for que o recurso diga. A chave mantém do recurso apenas o que um app diz sobre si mesmo — como os atributos `service.*`, `device.*`, `os.*` e `telemetry.*` e os rótulos `oneuptime.label.*` dele — e descarta o resto, então uma chave copiada não pode fazer sua telemetria passar por um host, um cluster ou um serviço de backend.",
  "With any other key, OneUptime classifies telemetry as **mobile RUM** when its resource carries `device.id` or `device.model.identifier`. The application is identified by `service.name` (matched case-insensitively), and its telemetry is owned by this RUM application — it is never duplicated as a backend Service.":
    "Com qualquer outra chave, o OneUptime classifica a telemetria como **RUM móvel** quando o recurso dela traz `device.id` ou `device.model.identifier`. O aplicativo é identificado por `service.name` (sem diferenciar maiúsculas e minúsculas), e a telemetria dele pertence a este aplicativo RUM — ela nunca é duplicada como um serviço de backend.",
  "| `device.id` / `device.model.identifier` | **one of them** | Marks the telemetry as mobile RUM. `device.model.identifier` also fills the **Clients** tab. |":
    "| `device.id` / `device.model.identifier` | **um deles** | Marca a telemetria como RUM móvel. `device.model.identifier` também preenche a aba **Clientes**. |",
  "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id` — it doubles as the make of a physical machine on a host's inventory item. Set `device.id` or `device.model.identifier` as well and the distinction never comes up.":
    "`device.manufacturer` também marca um lote como móvel, mas só em um recurso que não traz `host.name` nem `host.id` — ele também serve de fabricante de uma máquina física no item de inventário de um host. Defina também `device.id` ou `device.model.identifier` e a distinção nunca aparece.",
  "`device.id` should be an install-scoped identifier, not an advertising ID or anything that identifies a person.":
    "`device.id` deve ser um identificador por instalação, não um ID de publicidade nem nada que identifique uma pessoa.",
  "> **Anyone who has your app can copy its key.** That is why it is a Mobile key: a copy can only send this app's traces, logs and metrics, filed under the service name the key is pinned to, and never from a web page. It can still send made-up data for this app, up to the key's limit, so set an expiry, rotate the key with your releases, and turn it off if it is misused.":
    "> **Qualquer pessoa que tenha seu app pode copiar a chave dele.** É por isso que ela é uma chave de celular: uma cópia só pode enviar os traços, registros e métricas deste app, arquivados sob o nome de serviço ao qual a chave está fixada, e nunca de uma página web. Ela ainda pode enviar dados inventados para este app, até o limite da chave, então defina uma validade, troque a chave a cada versão e desative-a se for mal utilizada.",
  "Each of these is on the key's page in **Project Settings > Telemetry & APM > Ingestion Keys**: **Pinned Service Name** is the app everything the key sends is filed under, **Requests Per Minute Limit** caps the key across every copy of your app, **Expires At** stops it being accepted after a date, and **Enabled** turns it off at once.":
    "Tudo isso fica na página da chave, em **Configurações do projeto > Telemetria e APM > Chaves de ingestão**: **Nome do serviço fixado** é o app sob o qual é arquivado tudo o que a chave envia, **Limite de solicitações por minuto** limita a chave em todas as cópias do seu app, **Expira em** faz com que ela deixe de ser aceita depois de uma data, e **Habilitado** a desativa na hora.",
  "Never ship a **Server** key in an app instead: it can write every kind of telemetry into this project, from anywhere, as any service.":
    "Nunca coloque uma chave de **Servidor** em um app no lugar dela: ela pode escrever qualquer tipo de telemetria neste projeto, de qualquer lugar, como qualquer serviço.",
  "- **Android** — the [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) agent (`io.opentelemetry.android:android-agent`) sets `device.model.identifier`, `device.model.name` and `device.manufacturer` on its own resource, so classification works without extra configuration, and it reports crashes, ANRs, slow and frozen frames, app starts and sessions by itself. It names the app after its launcher label unless you set `service.name`, and it sends no `device.id`. [Android Setup](/docs/rum/android-setup) has the Gradle dependency, the code and what each of those becomes in OneUptime.":
    "- **Android** — o agente [OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) (`io.opentelemetry.android:android-agent`) define `device.model.identifier`, `device.model.name` e `device.manufacturer` no próprio recurso, então a classificação funciona sem configuração extra, e ele relata sozinho falhas, ANRs, quadros lentos e congelados, inicializações do app e sessões. Ele nomeia o app pelo rótulo do inicializador, a menos que você defina `service.name`, e não envia `device.id`. [Configuração do Android](/docs/rum/android-setup) tem a dependência do Gradle, o código e o que cada um vira no OneUptime.",
  "- **iOS / Swift** — with [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), set `device.model.identifier` and `device.manufacturer` on the resource yourself: the resource an SDK version contributes has changed between releases.":
    "- **iOS / Swift** — com o [opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift), defina você mesmo `device.model.identifier` e `device.manufacturer` no recurso: o recurso que cada versão do SDK adiciona mudou entre as versões.",
  "- **React Native / Expo** — runs the JavaScript SDK, so the setup is the browser one from [Browser Setup](/docs/rum/browser-setup) with two differences: there is no `browserDetector`, and you set `device.manufacturer` and `device.model.identifier` yourself so the **Clients** tab lists the devices. It sends with a **Mobile** key, like any mobile app.":
    "- **React Native / Expo** — roda o SDK JavaScript, então a configuração é a do navegador em [Configuração do navegador](/docs/rum/browser-setup), com duas diferenças: não há `browserDetector`, e você define `device.manufacturer` e `device.model.identifier` para que a aba **Clientes** liste os dispositivos. Ele envia com uma chave de **Celular**, como qualquer app móvel.",
  "- **Anything else** — Flutter, Unity, .NET MAUI or a hand-rolled OTLP writer work the same way, as long as the resource carries `service.name` plus one `device.*` attribute.":
    "- **Qualquer outra coisa** — Flutter, Unity, .NET MAUI ou um escritor OTLP feito à mão funcionam do mesmo jeito, desde que o recurso traga `service.name` mais um atributo `device.*`.",
  "The mobile OpenTelemetry SDKs change their builder APIs between releases. [Mobile Setup](/docs/rum/mobile-setup) has code for each; check the method names against the version you pin.":
    "Os SDKs móveis do OpenTelemetry mudam suas APIs de builder entre as versões. [Configuração móvel](/docs/rum/mobile-setup) tem código para cada um; confira os nomes dos métodos com a versão que você fixar.",
  "Any resource attribute prefixed `oneuptime.label.` becomes a project label on the application — `oneuptime.label.env=production` adds the label `env:production`:":
    "Qualquer atributo de recurso com o prefixo `oneuptime.label.` vira um rótulo de projeto no aplicativo — `oneuptime.label.env=production` adiciona o rótulo `env:production`:",
  "- **Overview** — events, error rate and p95 duration over a selectable time range, with trend charts, derived from the spans your instrumentation emits.":
    "- **Visão geral** — eventos, taxa de erros e duração p95 em um intervalo de tempo selecionável, com gráficos de tendência, derivados dos spans que sua instrumentação emite.",
  "- **Exceptions** — the crashes and ANRs your app reports, as unhandled exceptions, on the Overview and in **Exceptions**. OpenTelemetry Android reports both on its own; an ANR is listed as the type `ANR`.":
    "- **Exceções** — as falhas e ANRs que seu app relata, como exceções não tratadas, na visão geral e em **Exceções**. O OpenTelemetry Android relata os dois sozinho; um ANR aparece com o tipo `ANR`.",
  "- **Clients** — the device models the application has been seen on, from `device.model.identifier`. Coarse by model, never per end user.":
    "- **Clientes** — os modelos de dispositivo em que o aplicativo foi visto, a partir de `device.model.identifier`. Genérico por modelo, nunca por usuário final.",
  "A `401` means the key is unknown, revoked, disabled or expired: pick or create a Mobile key in step 1 and rebuild the app with it.":
    "Um `401` significa que a chave é desconhecida, revogada, desativada ou expirada: escolha ou crie uma chave de celular na etapa 1 e recompile o app com ela.",
  "A `422` says what was refused. A Mobile key sends only the app's OTLP traces, logs and metrics, over HTTP, and never from a web page: an SDK that exports over gRPC, or a request that carries an `Origin` header, is refused. A Browser key passes the check but is refused from a mobile app, because it needs an `Origin` header and mobile SDKs send none.":
    "Um `422` diz o que foi recusado. Uma chave de celular só envia os traços, registros e métricas OTLP do app, por HTTP, e nunca de uma página web: um SDK que exporta por gRPC, ou uma requisição com um cabeçalho `Origin`, é recusado. Uma chave de navegador passa na verificação, mas é recusada a partir de um app móvel, porque precisa de um cabeçalho `Origin` e os SDKs móveis não enviam nenhum.",
  "The telemetry was sent with a Server key, and its resource carries no `device.id` or `device.model.identifier`, so it was filed as a backend Service. Send with a Mobile key (step 1), which files everything it sends as this app, or set them on the SDK's resource, as in step 2.":
    "A telemetria foi enviada com uma chave de servidor, e o recurso dela não traz `device.id` nem `device.model.identifier`, então ela foi arquivada como um serviço de backend. Envie com uma chave de celular (etapa 1), que arquiva tudo o que envia como este app, ou defina-os no recurso do SDK, como na etapa 2.",
  "Client rows come from `device.model.identifier` specifically. An SDK that only sets `device.manufacturer` classifies as mobile, but lists no clients — set `device.model.identifier` as well.":
    "As linhas de clientes vêm especificamente de `device.model.identifier`. Um SDK que só define `device.manufacturer` é classificado como móvel, mas não lista clientes — defina também `device.model.identifier`.",
  "Status turns to **No recent traffic** after 15 minutes without telemetry. That is expected while nobody uses the app. If your app is in use:":
    "O status muda para **Sem tráfego recente** depois de 15 minutos sem telemetria. Isso é esperado enquanto ninguém usa o app. Se o seu app está em uso:",
  "- The key may have been revoked after the release — run the key check in step 3.":
    "- A chave pode ter sido revogada depois da versão — execute a verificação da chave na etapa 3.",
  "`service.name` is **`Storefront Mobile`**, this application's identifier — keep it as it is, or the data registers as a new application. It is percent-encoded in `OTEL_RESOURCE_ATTRIBUTES`, and the SDK decodes it.":
    "`service.name` é **`Storefront Mobile`**, o identificador deste aplicativo — mantenha-o como está, ou os dados se registram como um aplicativo novo. Ele é codificado em porcentagem em `OTEL_RESOURCE_ATTRIBUTES`, e o SDK o decodifica.",
};

export default TRANSLATION;
