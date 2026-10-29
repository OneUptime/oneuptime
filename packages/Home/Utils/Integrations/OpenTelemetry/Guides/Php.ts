import { OpenTelemetryGuide, GuideSnippet } from "../GuideTypes";
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
} from "../PhpShared";

/*
 * Any PHP app, framework or not: an orders API behind a front controller,
 * with SQLite through PDO, a payments API called with Guzzle, and Monolog.
 * The extension lets the auto-* packages trace PDO and Guzzle with no
 * code; the request's own span, which a framework's instrumentation would
 * open, is opened by a small function of the app's.
 */

const installExtension: GuideSnippet = peclInstallSnippet();

const install: GuideSnippet = composerRequireSnippet("install", [
  ...PHP_SDK_PACKAGES,
  "open-telemetry/opentelemetry-auto-pdo",
  "open-telemetry/opentelemetry-auto-guzzle",
  "open-telemetry/opentelemetry-logger-monolog",
  "monolog/monolog",
  "guzzlehttp/guzzle",
]);

const telemetry: GuideSnippet = {
  id: "telemetry",
  language: "php",
  title: "src/telemetry.php",
  code: [
    "<?php",
    "",
    "use Monolog\\Handler\\StreamHandler;",
    "use Monolog\\Level;",
    "use Monolog\\Logger;",
    "use OpenTelemetry\\API\\Globals;",
    "use OpenTelemetry\\API\\Trace\\SpanKind;",
    "use OpenTelemetry\\API\\Trace\\StatusCode;",
    "use OpenTelemetry\\Contrib\\Logs\\Monolog\\Handler as OpenTelemetryHandler;",
    "",
    "/*",
    " * The request's server span, named after the route it matched. A framework's",
    " * instrumentation opens it for you; an app without one opens it here.",
    " */",
    "function traceRequest(string $route, callable $handler): void",
    "{",
    "    [$method, $template] = explode(' ', $route, 2);",
    "    $span = Globals::tracerProvider()->getTracer('orders-api')",
    "        ->spanBuilder($route)",
    "        ->setSpanKind(SpanKind::KIND_SERVER)",
    "        // A caller's traceparent header makes the request part of its trace.",
    "        ->setParent(Globals::propagator()->extract(getallheaders()))",
    "        ->setAttribute('http.request.method', $method)",
    "        ->setAttribute('http.route', $template)",
    "        ->setAttribute('url.path', parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH))",
    "        ->startSpan();",
    "    $scope = $span->activate();",
    "",
    "    try {",
    "        $handler();",
    "    } catch (Throwable $error) {",
    "        // Recorded on the span with its stack trace, and answered with a 500.",
    "        $span->recordException($error);",
    "        $span->setStatus(StatusCode::STATUS_ERROR, $error->getMessage());",
    "        appLogger()->error('request failed', ['exception' => $error]);",
    "        http_response_code(500);",
    "    } finally {",
    "        $span->setAttribute('http.response.status_code', http_response_code());",
    "        $scope->detach();",
    "        $span->end();",
    "    }",
    "}",
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
  ].join("\n"),
  check: "run",
};

const frontController: GuideSnippet = {
  id: "index",
  language: "php",
  title: "public/index.php",
  code: [
    "<?php",
    "",
    "require __DIR__ . '/../vendor/autoload.php';",
    "require __DIR__ . '/../src/telemetry.php';",
    "require __DIR__ . '/../src/orders.php';",
    "",
    "$method = $_SERVER['REQUEST_METHOD'];",
    "$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);",
    "",
    "// The health check answers before any span is opened: it is never traced.",
    "if ($path === '/healthz') {",
    "    echo 'ok';",
    "    return;",
    "}",
    "",
    "$routes = [",
    "    'GET /orders/{id}' => ['#^/orders/(\\d+)$#', 'showOrder'],",
    "    'POST /orders' => ['#^/orders$#', 'createOrder'],",
    "    'GET /orders/{id}/receipt' => ['#^/orders/(\\d+)/receipt$#', 'showReceipt'],",
    "];",
    "",
    "foreach ($routes as $route => [$pattern, $handler]) {",
    '    if (str_starts_with($route, "$method ") && preg_match($pattern, $path, $matches)) {',
    "        traceRequest($route, fn () => $handler(...array_slice($matches, 1)));",
    "        return;",
    "    }",
    "}",
    "",
    "http_response_code(404);",
  ].join("\n"),
  check: "run",
};

// The counter createOrder adds to, as orders.php holds it.
const COUNTER_LINES: Array<string> = [
  "    Globals::meterProvider()->getMeter('orders-api')",
  "        ->createCounter('orders.placed', '{order}', 'Orders placed, by payment method')",
  "        ->add(1, ['payment.method' => $order['payment_method']]);",
];

const ordersFile: string = [
  "<?php",
  "",
  "use GuzzleHttp\\Client;",
  "use OpenTelemetry\\API\\Globals;",
  "use OpenTelemetry\\API\\Trace\\StatusCode;",
  "",
  "function database(): PDO",
  "{",
  "    return new PDO('sqlite:' . __DIR__ . '/../var/shop.db', options: [",
  "        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,",
  "    ]);",
  "}",
  "",
  "function showOrder(string $id): void",
  "{",
  "    appLogger()->info('loading order', ['order.id' => $id]);",
  "    $statement = database()->prepare(",
  "        'SELECT id, items, payment_method FROM orders WHERE id = ?'",
  "    );",
  "    $statement->execute([$id]);",
  "    $order = $statement->fetch(PDO::FETCH_ASSOC);",
  "",
  "    if (!$order) {",
  "        http_response_code(404);",
  "        echo json_encode(['error' => 'no such order']);",
  "        return;",
  "    }",
  "",
  "    header('Content-Type: application/json');",
  "    echo json_encode($order);",
  "}",
  "",
  "function createOrder(): void",
  "{",
  "    $order = json_decode(file_get_contents('php://input'), true);",
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
  ...COUNTER_LINES,
  "    http_response_code(201);",
  "    echo json_encode(['status' => 'placed']);",
  "}",
  "",
  "function showReceipt(string $id): void",
  "{",
  '    throw new RuntimeException("the receipt printer is offline for order $id");',
  "}",
].join("\n");

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
  code: COUNTER_LINES.join("\n"),
  check: "contained",
};

// The table the app reads and writes, with one order in it.
const CREATE_TABLES: string = [
  "<?php",
  "",
  "@mkdir(__DIR__ . '/../var');",
  "$db = new PDO('sqlite:' . __DIR__ . '/../var/shop.db');",
  "$db->exec('CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, items INTEGER, payment_method TEXT)');",
  "$db->exec(\"INSERT OR IGNORE INTO orders VALUES (42, 2, 'card')\");",
].join("\n");

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "php -S 0.0.0.0:8080 -t public",
  check: "run",
};

const disableInstrumentation: GuideSnippet = {
  id: "disable-instrumentation",
  language: "bash",
  code: [
    "# The instrumentations to leave out, by name, separated by commas.",
    'export OTEL_PHP_DISABLED_INSTRUMENTATIONS="pdo"',
  ].join("\n"),
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

const autoRootSpanError: GuideSnippet = {
  id: "auto-root-span-error",
  language: "text",
  title: "What every request answers",
  code: [
    "Uncaught TypeError: GuzzleHttp\\Psr7\\Uri::withPort(): Argument #1 ($port) must be",
    "  of type ?int, string given",
  ].join("\n"),
  check: "illustrative",
};

const COMMANDS_BEFORE_INSTALL: Array<{ snippet?: string; command?: string }> = [
  { snippet: "install-extension" },
  { command: "composer init --name=example/orders-api --no-interaction" },
];

export const PhpGuide: OpenTelemetryGuide = {
  slug: "php",
  seo: {
    title: "PHP OpenTelemetry: Auto-Instrumentation Setup | OneUptime",
    description:
      "Instrument any PHP app with OpenTelemetry: the PECL extension, PDO and Guzzle traced with no code, Monolog logs with trace IDs and a span per request.",
  },
  h1: "OpenTelemetry for PHP",
  lead: "Send traces, metrics and logs from any PHP app to OneUptime, framework or not. The OpenTelemetry extension, built from PECL, lets Composer packages trace PDO and Guzzle with no change to your code, Monolog sends its records, and the SDK sets itself up from environment variables as Composer's autoloader loads.",
  cardDescription:
    "Any PHP app: the PECL extension, PDO and Guzzle traced with no code, Monolog records with trace IDs, a span per request.",
  searchTerms: [
    "pecl",
    "extension",
    "auto-instrumentation",
    "pdo",
    "guzzle",
    "monolog",
  ],
  highlights: [
    "Automatic instrumentation",
    "Monolog with trace IDs",
    "PHP 8.2 and later",
  ],

  whatYouGet: {
    intro: `A PHP app reports as one service, named by \`OTEL_SERVICE_NAME\`, in ${SCREENS.services} as its first request ends. The example is an orders API behind a plain front controller, with SQLite through PDO and a payments API it calls with Guzzle; an app on Laravel, Symfony or Slim gets its request spans from its framework's instrumentation instead.`,
    traces:
      "A server span per request, named after its route, with a span for each PDO call and each Guzzle request beneath it, and `traceparent` sent on to the services it calls.",
    metrics:
      "The instruments you create, such as a counter of orders by payment method. PHP's instrumentations record spans only, and each PHP-FPM request counts on its own: the variables below export what each request counted.",
    logs: "Each Monolog record at INFO or above, with the trace and span IDs of the request that wrote it, and its context as attributes.",
    exceptions: `An exception the front controller catches is recorded on the request's span with its stack trace, and logged with Monolog as \`exception.type\` and \`exception.message\`: ${SCREENS.exceptions} groups both.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "your code",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 5,
        duration: 88,
        source: "your code",
      },
      { name: "POST", depth: 2, start: 9, duration: 52, source: "guzzle" },
      {
        name: "PDO::prepare",
        depth: 2,
        start: 66,
        duration: 6,
        source: "pdo",
      },
      {
        name: "PDOStatement::execute",
        depth: 2,
        start: 74,
        duration: 16,
        source: "pdo",
      },
    ],
  },

  prerequisites: [
    PHP_PREREQUISITE,
    "A PHP app whose packages Composer installs, served by PHP-FPM, Apache or PHP's own server. Building with Laravel, Symfony or Slim? Their guides cover what is particular to them.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Build the extension from PECL and load it, then add the SDK, the OTLP exporter, and the instrumentations for PDO, Guzzle and Monolog with Composer, at the versions this guide was checked with:",
    snippets: [installExtension, install],
    notes: [
      "`php --ri opentelemetry` prints the extension's version once PHP loads it. Without it, the instrumentation packages install but trace nothing: their hooks are the extension's.",
      "`monolog/monolog` and `guzzlehttp/guzzle` are the app's own; keep yours, and add the OpenTelemetry packages beside them. The exporter sends through Guzzle, or another PSR-18 client the app has.",
    ],
  },

  configure: {
    intro:
      "The SDK sets itself up from the standard OpenTelemetry variables when `OTEL_PHP_AUTOLOAD_ENABLED` is on, as Composer's autoloader loads:",
    tabs: otlpEnvironmentTabs({
      serviceName: "orders-api",
      extraLines: PHP_ENVIRONMENT_LINES,
    }),
    notes: [
      "A PHP-FPM or Apache worker starts each request from nothing, its counters included: `delta` exports what each request counted, which OneUptime adds up, rather than totals that start again every time.",
      "PHP-FPM gives workers only the variables its pool names: list each with `env[OTEL_SERVICE_NAME] = $OTEL_SERVICE_NAME` in the pool's configuration, or set `clear_env = no`.",
    ],
  },

  setup: {
    intro:
      "Nothing calls the SDK to start it: Composer's autoloader does, with the variables above. The one piece of code is the request's own span, which no instrumentation opens for an app without a framework.",
    steps: [
      {
        title: "Open a span for each request",
        body: "A function that wraps a request's handler in a server span, named after its route, and records an exception that leaves it; beside it, a Monolog logger that also sends to OneUptime:",
        snippets: [telemetry],
      },
      {
        title: "Route each request through it",
        body: "The front controller matches the route, then calls its handler through `traceRequest`. PDO and Guzzle, called inside, are traced by the extension's hooks:",
        snippets: [frontController],
      },
      {
        title: "Run it",
        body: "With the variables above exported, serve it with PHP's own server to try it:",
        snippets: [run],
        notes: [
          "In production, PHP-FPM or Apache's `mod_php` load the extension the same way, from the `.ini` file above, and the SDK sends each request's telemetry as the request ends.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "Each `opentelemetry-auto-*` package hooks one library through the extension, as Composer's autoloader loads it. With the packages above, a request's trace holds:",
    rows: [
      {
        library: "PDO (`opentelemetry-auto-pdo`)",
        covers:
          "A span per call, named after the method (`PDO::prepare`, `PDOStatement::execute`), with the SQL in `db.query.text` and the database's system and name.",
      },
      {
        library: "Guzzle (`opentelemetry-auto-guzzle`)",
        covers:
          "A client span per request, named after its method (`POST`), with `url.full` and the status code, and `traceparent` added to the request so the service called joins the trace.",
      },
      {
        library: "Monolog (`opentelemetry-logger-monolog`)",
        covers:
          "A handler that sends each record as a log, with the IDs of the span that was current.",
      },
      {
        library: "More on Packagist",
        covers:
          "`opentelemetry-auto-curl`, `-psr18`, `-psr15` and more, and the frameworks' own: Laravel, Symfony, Slim, WordPress. Each adds its spans once installed.",
      },
    ],
    snippets: [disableInstrumentation],
    notes: [
      "One variable turns instrumentations off by their names, `pdo` and `guzzle` here, without removing their packages:",
    ],
  },

  manualSpans: {
    intro:
      "Open a span of your own with the API's tracer, make it current with `activate()`, and every span started inside nests beneath it until you detach and end it:",
    snippets: [createOrder],
    notes: [
      "Always detach the scope and end the span in `finally`: a span never ended is never sent, and a scope left attached makes later spans its children.",
      "`recordException` adds an `exception` event with the stack trace, and `setStatus` marks the span failed; rethrowing hands the error on to `traceRequest`, which marks the request failed too.",
      "Search the attributes you set in the **Traces** explorer, such as `@payment.method:card`.",
    ],
  },

  logs: {
    intro:
      "Log with Monolog as you do. Through the OpenTelemetry handler, each record carries the IDs of the request's span, and its context goes along as attributes:",
    snippets: [showOrder],
    notes: [
      "The context's keys become attributes under `context.`, as `context.order.id`: search a request's records by them.",
      "An exception passed as `['exception' => $error]`, as `traceRequest` does, is sent as `exception.type`, `exception.message` and `exception.stacktrace`: OneUptime files the record under **Exceptions**.",
      "`Level::Info` keeps debug records out of OneUptime while the other handlers still write them.",
    ],
  },

  metrics: {
    intro:
      "No PHP instrumentation sends metrics of its own, so a PHP app's metrics are the instruments it creates and adds to, as `createOrder` does once an order is placed:",
    builtIn: [],
    snippets: [counter],
    notes: [
      "With `delta` temporality, as set above, each request exports what it counted, and OneUptime adds the requests up.",
      "Attributes such as the payment method make a series for each value: keep them to a few known ones.",
    ],
  },

  sampling: {
    intro:
      "The health check is never traced, since it answers before `traceRequest`. Keep a share of the other requests' traces with the standard variables:",
    snippets: [sampling],
    notes: [
      "A request with a caller's `traceparent` follows the caller's choice; of the rest, `parentbased_traceidratio` keeps one in four.",
      "Logs and metrics are not sampled: `orders.placed` still counts every order.",
    ],
  },

  deploy: {
    intro:
      "Build the extension into the PHP image with its installer of PECL extensions, serve the app with Apache, and give the Deployment the key from a Secret:",
    snippets: [
      phpDockerfileSnippet({ documentRoot: "public" }),
      kubernetesManifestSnippet({
        name: "orders-api",
        image: "registry.example.com/orders-api:1.8.0",
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
      "`install-php-extensions` builds the extension from PECL with the build tools it needs, then removes them, so the image carries no compiler.",
      "Each request sends its telemetry as it ends, so a pod that stops loses nothing a finished request recorded.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Check that PHP loads the extension",
        body: "`php --ri opentelemetry` prints the extension's version. If it says the extension is not present, PHP read no `.ini` file that loads it: `php --ini` lists the files it reads.",
      },
      {
        title: "Open a request's trace",
        body: `Request \`/orders/42\`, then open ${SCREENS.services}: \`orders-api\` is listed. In ${SCREENS.traces}, \`GET /orders/{id}\` holds the \`PDO::prepare\` and \`PDOStatement::execute\` of its query.`,
      },
      {
        title: "Find the exception and its record",
        body: `Request \`/orders/42/receipt\`: ${SCREENS.exceptions} lists the \`RuntimeException\`, and in ${SCREENS.logs} the \`request failed\` record opens the same trace.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Nothing is traced, and nothing is logged",
      answer:
        "The SDK did not start. `OTEL_PHP_AUTOLOAD_ENABLED=true` must reach PHP itself: under PHP-FPM, add each variable to the pool's configuration, as above, since FPM clears its workers' environment by default.",
    },
    {
      question: "Requests are traced, but not the queries or the HTTP calls",
      answer:
        "The extension is not loaded where the app runs, so the instrumentation packages have no hooks to use. `php --ri opentelemetry` tests the command line; the web server's PHP reads its own `.ini` files, which `phpinfo()` lists.",
    },
    {
      question:
        "Every request fails with “Uri::withPort(): Argument #1 ($port) must be of type ?int”",
      answer:
        "`OTEL_PHP_EXPERIMENTAL_AUTO_ROOT_SPAN=true` is set. That experimental span, which the SDK opens for each request by itself, fails with Guzzle's PSR-7 classes as of SDK 1.15: unset it, and open the request's span in code, as `traceRequest` does.",
      snippets: [autoRootSpanError],
    },
    {
      question:
        "A POST span to /v1/metrics arrives with each request that counts",
      answer:
        "That is the SDK's own export, at the end of the request: it goes through Guzzle, which `opentelemetry-auto-guzzle` traces like any other call. Drop it as it arrives with a [drop filter](/docs/telemetry/drop-filters-and-scrub-rules) on its `url.path`.",
    },
    {
      question: "Records arrive without a trace ID",
      answer:
        "They were written outside `traceRequest`, before or after the request's span: at start-up, or in a shutdown function. Records written inside the handler carry the request's IDs.",
    },
  ],

  faq: [
    {
      question: "Do I need the extension?",
      answer:
        "For automatic instrumentation, yes: the `opentelemetry-auto-*` packages hook into libraries through it. The SDK and the API run without it, so spans you open in code still work; PDO, Guzzle and the frameworks then go untraced.",
    },
    {
      question: "Which PHP versions are supported?",
      answer:
        "The SDK supports PHP 8.1 and later, and the PDO instrumentation 8.2 and later. This guide was checked with PHP 8.5 and the extension 1.4.",
    },
    {
      question: "Does it work with WordPress?",
      answer:
        "Yes, with `open-telemetry/opentelemetry-auto-wordpress` beside the SDK and the extension: it spans each request, WordPress' main steps and every `wpdb` query, with the same variables as here.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: each request sends straight to OneUptime. With many PHP hosts, a Collector on each lets requests hand their telemetry off locally and fast, and holds the key in one place: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["laravel", "symfony", "slim", "python"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.dropFilters],

  verification: {
    runtime: "php",
    framework: { name: "PHP" },
    files: [
      { path: "src/telemetry.php", snippet: "telemetry" },
      { path: "src/orders.php", content: ordersFile },
      { path: "public/index.php", snippet: "index" },
      { path: "bin/create-tables.php", content: CREATE_TABLES },
    ],
    stubApiPort: 9000,
    commands: [
      ...COMMANDS_BEFORE_INSTALL,
      { snippet: "install" },
      { command: "php bin/create-tables.php" },
      { snippet: "run", isServer: true },
    ],
    port: 8080,
    requests: [
      { method: "GET", path: "/healthz" },
      { method: "GET", path: "/orders/42" },
      { method: "GET", path: "/orders/7" },
      {
        method: "POST",
        path: "/orders",
        body: { items: ["kettle", "mug"], payment_method: "card" },
      },
      { method: "GET", path: "/orders/42/receipt" },
    ],
    expect: {
      spans: [
        {
          name: "GET /orders/{id}",
          attributes: {
            "http.route": "/orders/{id}",
            "http.response.status_code": "200",
          },
        },
        { name: "PDOStatement::execute", parent: "GET /orders/{id}" },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
          parent: "POST /orders",
        },
        {
          name: "POST",
          attributes: { "url.path": "/api/charges" },
          parent: "checkout.charge",
        },
        { name: "PDO::prepare", parent: "checkout.charge" },
        {
          name: "GET /orders/{id}/receipt",
          attributes: { "http.response.status_code": "500" },
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
        { body: "request failed", hasTraceContext: true, hasException: true },
      ],
      resource: { "service.name": "orders-api" },
      untracedPaths: ["/healthz"],
    },
    variants: [
      {
        // The instrumentations' switch, as the page names it.
        name: "Instrumentations off",
        files: [
          { path: "src/telemetry.php", snippet: "telemetry" },
          { path: "src/orders.php", content: ordersFile },
          { path: "public/index.php", snippet: "index" },
          { path: "bin/create-tables.php", content: CREATE_TABLES },
        ],
        stubApiPort: 9000,
        environmentSnippets: ["disable-instrumentation"],
        commands: [
          ...COMMANDS_BEFORE_INSTALL,
          { snippet: "install" },
          { command: "php bin/create-tables.php" },
          { snippet: "run", isServer: true },
        ],
        port: 8080,
        requests: [
          { method: "GET", path: "/orders/42" },
          {
            method: "POST",
            path: "/orders",
            body: { items: ["kettle"], payment_method: "card" },
          },
        ],
        expect: {
          spans: [
            { name: "GET /orders/{id}" },
            { name: "POST", parent: "checkout.charge" },
          ],
          metrics: ["orders.placed"],
          logs: [{ body: "loading order", hasTraceContext: true }],
          absentSpans: ["PDO::prepare", "PDOStatement::execute"],
        },
      },
    ],
  },
};
