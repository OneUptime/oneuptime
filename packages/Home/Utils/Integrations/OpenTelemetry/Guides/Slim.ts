import {
  OpenTelemetryGuide,
  GuideSnippet,
  VerificationCommand,
  VerificationFile,
} from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";
import { blockOf } from "../GuideSnippets";
import {
  PHP_ENVIRONMENT_LINES,
  PHP_PREREQUISITE,
  PHP_SDK_PACKAGES,
  composerRequireSnippet,
  peclInstallSnippet,
  phpDockerfileSnippet,
  pinnedPhpPackage,
} from "../PhpShared";

/*
 * A Slim 4 orders API: routes to plain functions, SQLite through PDO, a
 * payment provider called with Guzzle, and Monolog. The extension and
 * opentelemetry-auto-slim trace each request and its route's handler with
 * no code; PDO's and Guzzle's instrumentations trace what the handlers
 * call.
 */

const installExtension: GuideSnippet = peclInstallSnippet();

const install: GuideSnippet = composerRequireSnippet("install", [
  ...PHP_SDK_PACKAGES,
  "open-telemetry/opentelemetry-auto-slim",
  "open-telemetry/opentelemetry-auto-pdo",
  "open-telemetry/opentelemetry-auto-guzzle",
  "open-telemetry/opentelemetry-logger-monolog",
]);

const frontController: GuideSnippet = {
  id: "index",
  language: "php",
  title: "public/index.php",
  code: [
    "<?php",
    "",
    "use Slim\\Factory\\AppFactory;",
    "",
    "require __DIR__ . '/../vendor/autoload.php';",
    "require __DIR__ . '/../src/orders.php';",
    "",
    "$app = AppFactory::create();",
    "$app->addRoutingMiddleware();",
    "$app->addErrorMiddleware(false, false, false);",
    "",
    "// Each route's pattern names its request's span: GET /orders/{id}.",
    "$app->get('/orders/{id}', 'showOrder');",
    "$app->post('/orders', 'createOrder');",
    "$app->get('/orders/{id}/receipt', 'showReceipt');",
    "",
    "$app->run();",
  ].join("\n"),
  check: "run",
};

const ordersFile: string = [
  "<?php",
  "",
  "use GuzzleHttp\\Client;",
  "use Monolog\\Handler\\StreamHandler;",
  "use Monolog\\Level;",
  "use Monolog\\Logger;",
  "use OpenTelemetry\\API\\Globals;",
  "use OpenTelemetry\\API\\Trace\\StatusCode;",
  "use OpenTelemetry\\Contrib\\Logs\\Monolog\\Handler as OpenTelemetryHandler;",
  "use Psr\\Http\\Message\\ResponseInterface as Response;",
  "use Psr\\Http\\Message\\ServerRequestInterface as Request;",
  "",
  "// Monolog, writing to stderr as before and to OneUptime with each record's trace.",
  "function appLogger(): Logger",
  "{",
  "    static $logger = null;",
  "",
  "    if ($logger === null) {",
  "        $logger = new Logger('orders-api');",
  "        $logger->pushHandler(new StreamHandler('php://stderr'));",
  "        $logger->pushHandler(",
  "            new OpenTelemetryHandler(Globals::loggerProvider(), Level::Info)",
  "        );",
  "    }",
  "",
  "    return $logger;",
  "}",
  "",
  "// Opened inside a request, so its connection's span belongs to the request.",
  "function database(): PDO",
  "{",
  "    static $db = null;",
  "",
  "    return $db ??= new PDO('sqlite:' . __DIR__ . '/../var/shop.db', options: [",
  "        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,",
  "    ]);",
  "}",
  "",
  "function showOrder(Request $request, Response $response, array $args): Response",
  "{",
  "    appLogger()->info('loading order', ['order.id' => $args['id']]);",
  "    $statement = database()->prepare(",
  "        'SELECT id, items, payment_method FROM orders WHERE id = ?'",
  "    );",
  "    $statement->execute([$args['id']]);",
  "    $order = $statement->fetch(PDO::FETCH_ASSOC);",
  "",
  "    $response->getBody()->write(json_encode($order ?: ['error' => 'no such order']));",
  "",
  "    return $response",
  "        ->withHeader('Content-Type', 'application/json')",
  "        ->withStatus($order ? 200 : 404);",
  "}",
  "",
  "function createOrder(Request $request, Response $response): Response",
  "{",
  "    $order = json_decode((string) $request->getBody(), true);",
  "    $tracer = Globals::tracerProvider()->getTracer('orders-api');",
  "",
  "    // A span of your own: the Guzzle and PDO spans inside it nest beneath it.",
  "    $span = $tracer->spanBuilder('checkout.charge')",
  "        ->setAttribute('payment.method', $order['payment_method'])",
  "        ->setAttribute('order.item_count', count($order['items']))",
  "        ->startSpan();",
  "    $scope = $span->activate();",
  "",
  "    try {",
  "        $payments = new Client([",
  "            'base_uri' => getenv('PAYMENTS_API_URL') ?: 'http://localhost:9000',",
  "        ]);",
  "        $payments->post('/api/charges', [",
  "            'json' => ['payment_method' => $order['payment_method']],",
  "        ]);",
  "        database()",
  "            ->prepare('INSERT INTO orders (items, payment_method) VALUES (?, ?)')",
  "            ->execute([count($order['items']), $order['payment_method']]);",
  "    } catch (Throwable $error) {",
  "        $span->recordException($error);",
  "        $span->setStatus(StatusCode::STATUS_ERROR, 'charge failed');",
  "        throw $error;",
  "    } finally {",
  "        $scope->detach();",
  "        $span->end();",
  "    }",
  "",
  "    Globals::meterProvider()->getMeter('orders-api')",
  "        ->createCounter('orders.placed', '{order}', 'Orders placed')",
  "        ->add(1, ['payment.method' => $order['payment_method']]);",
  "    $response->getBody()->write(json_encode(['status' => 'placed']));",
  "",
  "    return $response->withStatus(201);",
  "}",
  "",
  "function showReceipt(Request $request, Response $response, array $args): Response",
  "{",
  "    throw new RuntimeException(\"the receipt printer is offline for order {$args['id']}\");",
  "}",
].join("\n");

const helpers: GuideSnippet = {
  id: "helpers",
  language: "php",
  title: "src/orders.php",
  code: [
    blockOf(ordersFile, "// Monolog, writing to stderr", "}"),
    "",
    blockOf(ordersFile, "// Opened inside a request", "}"),
  ].join("\n"),
  check: "contained",
};

const createOrder: GuideSnippet = {
  id: "create-order",
  language: "php",
  title: "src/orders.php",
  code: blockOf(ordersFile, "function createOrder(", "}"),
  check: "contained",
};

const showOrder: GuideSnippet = {
  id: "show-order",
  language: "php",
  title: "src/orders.php",
  code: blockOf(ordersFile, "function showOrder(", "}"),
  check: "contained",
};

const counter: GuideSnippet = {
  id: "counter",
  language: "php",
  title: "src/orders.php",
  code: [
    "    Globals::meterProvider()->getMeter('orders-api')",
    "        ->createCounter('orders.placed', '{order}', 'Orders placed')",
    "        ->add(1, ['payment.method' => $order['payment_method']]);",
  ].join("\n"),
  check: "contained",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "php -S 0.0.0.0:8080 -t public",
  check: "run",
};

const sampling: GuideSnippet = {
  id: "sampling",
  language: "bash",
  code: [
    'export OTEL_TRACES_SAMPLER="parentbased_traceidratio"',
    'export OTEL_TRACES_SAMPLER_ARG="0.25"',
  ].join("\n"),
  check: "parse",
};

const excludedUrls: GuideSnippet = {
  id: "excluded-urls",
  language: "bash",
  code: [
    "# A request whose path matches one of these patterns loads no OpenTelemetry.",
    'export OTEL_PHP_EXCLUDED_URLS="^/healthz$"',
  ].join("\n"),
  check: "parse",
};

const CREATE_TABLES: string = [
  "<?php",
  "",
  "@mkdir(__DIR__ . '/../var');",
  "$db = new PDO('sqlite:' . __DIR__ . '/../var/shop.db');",
  "$db->exec('CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, items INTEGER, payment_method TEXT)');",
  "$db->exec(\"INSERT OR IGNORE INTO orders VALUES (42, 2, 'card')\");",
].join("\n");

const FILES: Array<VerificationFile> = [
  { path: "public/index.php", snippet: "index" },
  { path: "src/orders.php", content: ordersFile },
  { path: "bin/create-tables.php", content: CREATE_TABLES },
];

// A Slim app of the packages it is built on, then the page's steps.
const COMMANDS: Array<VerificationCommand> = [
  { snippet: "install-extension" },
  { command: "composer init --name=example/orders-api --no-interaction" },
  {
    command: `composer require ${["slim/slim", "slim/psr7", "monolog/monolog", "guzzlehttp/guzzle"].map(pinnedPhpPackage).join(" ")}`,
  },
  { snippet: "install" },
  { command: "php bin/create-tables.php" },
  { snippet: "run", isServer: true },
];

export const SlimGuide: OpenTelemetryGuide = {
  slug: "slim",
  seo: {
    title: "Slim Framework OpenTelemetry: Routes, Handlers | OneUptime",
    description:
      "Trace a Slim 4 app with OpenTelemetry and no code: a span per route and per handler, PDO and Guzzle calls beneath them, and Monolog records with trace IDs.",
  },
  h1: "OpenTelemetry for Slim",
  lead: "Trace every request your Slim app routes, named after the route's pattern, with its handler, the SQL and the Guzzle calls beneath it, and send traces, metrics and Monolog's records to OneUptime. The OpenTelemetry extension and four Composer packages do it with no change to your routes or handlers.",
  cardDescription:
    "Slim 4: a span per route and per handler, PDO and Guzzle beneath them, and Monolog records with trace IDs, with no code.",
  searchTerms: [
    "slim framework",
    "psr-7",
    "psr-15",
    "route handler",
    "opentelemetry-auto-slim",
  ],
  highlights: [
    "Routes and handlers traced",
    "Monolog with trace IDs",
    "Slim 4",
  ],

  whatYouGet: {
    intro: `Each request becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, which ${SCREENS.services} lists once the first request has ended. The example is an orders API on Slim 4, its routes mapped to plain functions, with SQLite through PDO and a payment provider called with Guzzle.`,
    traces:
      "A server span per request, named after the route's pattern, such as `GET /orders/{id}`, a span for the handler that served it, named after the function, and beneath them a span for each PDO call and each Guzzle request.",
    metrics:
      "The instruments you create, such as a counter of orders by payment method. Slim's instrumentation records spans only.",
    logs: "Each Monolog record at INFO or above, carrying the trace and span IDs of the request that wrote it, with its context as attributes.",
    exceptions: `An exception a handler throws is recorded on the handler's span with its type, message and stack trace, and both spans are marked failed; ${SCREENS.exceptions} lists it.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "slim",
      },
      {
        name: "createOrder",
        depth: 1,
        start: 3,
        duration: 94,
        source: "slim",
      },
      {
        name: "checkout.charge",
        depth: 2,
        start: 6,
        duration: 84,
        source: "your code",
      },
      { name: "POST", depth: 3, start: 9, duration: 50, source: "guzzle" },
      {
        name: "PDOStatement::execute",
        depth: 3,
        start: 70,
        duration: 15,
        source: "pdo",
      },
    ],
  },

  prerequisites: [
    PHP_PREREQUISITE,
    "A Slim 4 app, with a PSR-7 implementation such as `slim/psr7`. Without a framework? The [PHP](/integrations/opentelemetry/php) guide covers an app of your own.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Build the extension from PECL and load it, then add the SDK, the OTLP exporter, the instrumentations for Slim, PDO and Guzzle, and Monolog's handler, at the versions this guide was checked with:",
    snippets: [installExtension, install],
    notes: [
      "Each `opentelemetry-auto-*` package does its tracing through the extension's hooks: `php --ri opentelemetry` shows whether PHP loads it.",
      "`opentelemetry-auto-guzzle` stands for the HTTP client this app uses; with another PSR-18 client, add `opentelemetry-auto-psr18` instead.",
    ],
  },

  configure: {
    intro:
      "Composer's autoloader starts the SDK when `OTEL_PHP_AUTOLOAD_ENABLED` is on, and the SDK reads the rest from the standard OpenTelemetry variables:",
    tabs: otlpEnvironmentTabs({
      serviceName: "orders-api",
      extraLines: PHP_ENVIRONMENT_LINES,
    }),
    notes: [
      "PHP-FPM clears its workers' environment unless told otherwise: name each of these variables in the pool's configuration, or the SDK never starts.",
    ],
  },

  setup: {
    intro:
      "The routes and handlers stay as they are: Slim's instrumentation opens the request's span and the handler's as the app runs. What the app adds is a logger that also sends to OneUptime.",
    steps: [
      {
        title: "Route each request to its handler",
        body: "An ordinary Slim front controller. Error middleware renders an exception as a 500; the instrumentation has recorded it by then:",
        snippets: [frontController],
      },
      {
        title: "Give the handlers a logger and a database",
        body: "Monolog with OpenTelemetry's handler beside the one you had, and a PDO connection opened on first use, inside the request:",
        snippets: [helpers],
        notes: [
          "A connection opened as the app boots, before Slim handles the request, is traced as a `PDO::__construct` span of its own, outside every request's trace.",
        ],
      },
      {
        title: "Serve it",
        body: "With the variables above exported, try it on PHP's built-in server, `public/` as its document root:",
        snippets: [run],
        notes: [
          "PHP-FPM or Apache in production load the extension from the same `.ini` file as PHP's own server, and each request still sends its telemetry as it ends.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "Slim's instrumentation follows a request through the app; PDO's and Guzzle's follow what the handlers call. With this app, a request's trace holds:",
    rows: [
      {
        library: "Slim (`opentelemetry-auto-slim`)",
        covers:
          "A server span per request, named after its route, its name if it has one, else its pattern (`GET /orders/{id}`), and a span for the handler, named after the function or method that served it.",
      },
      {
        library: "PDO (`opentelemetry-auto-pdo`)",
        covers:
          "A span per call, from `PDO::__construct` to `PDOStatement::execute`, with the SQL in `db.query.text`.",
      },
      {
        library: "Guzzle (`opentelemetry-auto-guzzle`)",
        covers:
          "A client span per request, named after its method, with `traceparent` added so the service called joins the trace.",
      },
      {
        library: "Monolog (`opentelemetry-logger-monolog`)",
        covers:
          "A handler that sends each record with the IDs of the span that was current.",
      },
    ],
    snippets: [],
    notes: [
      "The instrumentation marks a request failed whenever its response is 400 or more, a 404 your handler returns included: filter the failures by `http.response.status_code` to tell them apart.",
    ],
  },

  manualSpans: {
    intro:
      "Inside a handler, the handler's span is current: open one of your own with the API's tracer and `activate()` it, and the calls made inside nest beneath it:",
    snippets: [createOrder],
    notes: [
      "Ending the span and detaching its scope belong in `finally`, so that they happen however the block is left.",
      "Rethrowing after `recordException` leaves the exception to Slim's error middleware, which answers 500.",
      "In the **Traces** explorer, `@order.item_count:2` finds the orders of two items by the attribute set above.",
    ],
  },

  logs: {
    intro:
      "Write through the Monolog logger as you do. Through the OpenTelemetry handler, every record a handler writes carries the IDs of the request's spans:",
    snippets: [showOrder],
    notes: [
      "A record's context arrives as attributes under `context.`, as `context.order.id`.",
      "Slim's error middleware can log every error too, as text without the exception's attributes and with each 404 among them; the exception on the handler's span is the one OneUptime files.",
    ],
  },

  metrics: {
    intro:
      "Slim's instrumentation sends no metrics, so the app's metrics are the instruments it creates, as `createOrder` does once an order is saved:",
    builtIn: [],
    snippets: [counter],
    notes: [
      "`delta` temporality, set above, makes each request export only what it counted, as PHP starts every request afresh.",
      "Each payment method makes one series of the counter, which keeps the series few.",
    ],
  },

  sampling: {
    intro:
      "Keep a share of the traces with the standard variables, and leave health checks out with `OTEL_PHP_EXCLUDED_URLS`:",
    snippets: [sampling, excludedUrls],
    notes: [
      "`parentbased_traceidratio` keeps a quarter of the traces that start at the app; a request with a caller's `traceparent` follows the caller.",
      "An excluded request loads no OpenTelemetry at all: no span, no log record, no measurement.",
    ],
  },

  deploy: {
    intro:
      "Serve the app's `public/` folder with Apache from the PHP image, with the extension built in, and give the Deployment the key from a Secret:",
    snippets: [
      phpDockerfileSnippet({
        documentRoot: "public",
        extraLines: ["RUN mkdir -p var && chown www-data var"],
      }),
      kubernetesManifestSnippet({
        name: "orders-api",
        image: "registry.example.com/orders-api:2.4.0",
        containerPort: 80,
        extraEnv: [
          { name: "OTEL_PHP_AUTOLOAD_ENABLED", value: "true" },
          {
            name: "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE",
            value: "delta",
          },
        ],
      }),
    ],
    notes: [
      "Apache hands every path that is not a file to `index.php` through `FallbackResource`, so Slim routes them all, with no `.htaccess` and no `mod_rewrite`.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Open a request's trace",
        body: `Request \`/orders/42\`, then open ${SCREENS.traces}: \`GET /orders/{id}\` holds \`showOrder\`, with the query's \`PDO::prepare\` and \`PDOStatement::execute\` beneath it.`,
      },
      {
        title: "Follow an order",
        body: `Send a \`POST\` to \`/orders\`: \`createOrder\` holds \`checkout.charge\`, which holds Guzzle's \`POST\` and the \`INSERT\`'s PDO spans.`,
      },
      {
        title: "Find the exception",
        body: `Request \`/orders/42/receipt\`: ${SCREENS.exceptions} lists the \`RuntimeException\` that \`showReceipt\` threw, from the handler's span.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Requests are traced, but not the queries or the calls",
      answer:
        "Their instrumentation packages are missing, or the extension is not loaded where the app runs. Each library has its own package: PDO's and Guzzle's are not part of Slim's.",
    },
    {
      question: "A PDO::__construct span arrives on its own with every request",
      answer:
        "The connection is opened as the app boots, before Slim handles the request, so no request span is open yet. Open it on first use inside the handlers, as `database()` does.",
    },
    {
      question: "404s show as failed requests",
      answer:
        "Slim's instrumentation marks every response of 400 or more as failed, whether your handler returned it or no route matched. Errors you would page on are the 5xx ones: filter by `http.response.status_code`.",
    },
    {
      question:
        "A POST span to /v1/metrics arrives with each request that counts",
      answer:
        "That is the SDK's own export at the end of the request, sent through Guzzle, which `opentelemetry-auto-guzzle` traces like the app's calls. Drop it with a [drop filter](/docs/telemetry/drop-filters-and-scrub-rules) on its `url.path`.",
    },
    {
      question: "Nothing arrives at all",
      answer:
        "`OTEL_PHP_AUTOLOAD_ENABLED=true` never reached PHP, so the SDK did not start. Under PHP-FPM, each variable must also be named in the pool's configuration.",
    },
  ],

  faq: [
    {
      question: "Do I need to change my routes or handlers?",
      answer:
        "No: the request's span and the handler's are opened by the instrumentation, as the route is matched and the handler called. Code is needed only for spans and metrics of your own.",
    },
    {
      question: "What names the spans?",
      answer:
        "The request's span takes the route's name, if you gave it one with `->setName()`, and its pattern if not. The handler's span takes the name of the function that served the request, such as `showOrder`.",
    },
    {
      question: "Which versions is this checked with?",
      answer:
        "Slim 4.15 with `slim/psr7` on PHP 8.5, the extension 1.4, the SDK 1.15 and `opentelemetry-auto-slim` 1.5.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: the app sends straight to OneUptime as each request ends. A Collector on the host takes each request's telemetry over the local network and holds the key for every app there: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["php", "laravel", "symfony", "flask"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.dropFilters],

  verification: {
    runtime: "php",
    framework: { name: "Slim", package: "slim/slim" },
    files: FILES,
    stubApiPort: 9000,
    commands: COMMANDS,
    port: 8080,
    requests: [
      { method: "GET", path: "/orders/42" },
      { method: "GET", path: "/orders/7" },
      {
        method: "POST",
        path: "/orders",
        body: { items: ["kettle", "mug"], payment_method: "card" },
      },
      { method: "GET", path: "/orders/42/receipt" },
      { method: "GET", path: "/nowhere" },
    ],
    expect: {
      spans: [
        {
          name: "GET /orders/{id}",
          attributes: { "http.response.status_code": "200" },
        },
        { name: "showOrder", parent: "GET /orders/{id}" },
        { name: "PDOStatement::execute", parent: "showOrder" },
        { name: "PDO::__construct", parent: "showOrder" },
        { name: "createOrder", parent: "POST /orders" },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
          parent: "createOrder",
        },
        {
          name: "POST",
          attributes: { "url.path": "/api/charges" },
          parent: "checkout.charge",
        },
        {
          name: "showReceipt",
          hasException: true,
          exceptionMessage: "the receipt printer is offline for order 42",
        },
      ],
      metrics: ["orders.placed"],
      logs: [
        {
          body: "loading order",
          hasTraceContext: true,
          attributes: { "context.order.id": "42" },
        },
      ],
      resource: { "service.name": "orders-api" },
    },
  },
};
