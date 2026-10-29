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
 * A Symfony 8.1 app: a storefront's orders in SQLite through Doctrine
 * DBAL, a payment provider called with HttpClient, and Monolog. The
 * extension and opentelemetry-auto-symfony trace the kernel's requests and
 * HttpClient's calls with no code, opentelemetry-auto-pdo traces the SQL
 * DBAL sends through PDO, and a service definition gives Monolog a handler
 * that sends to OneUptime.
 */

const installExtension: GuideSnippet = peclInstallSnippet();

const install: GuideSnippet = composerRequireSnippet("install", [
  ...PHP_SDK_PACKAGES,
  "open-telemetry/opentelemetry-auto-symfony",
  "open-telemetry/opentelemetry-auto-pdo",
  "open-telemetry/opentelemetry-logger-monolog",
]);

const monologConfig: GuideSnippet = {
  id: "monolog-config",
  language: "yaml",
  title: "config/packages/opentelemetry.yaml",
  code: [
    "services:",
    "    # The SDK's logger provider, which OTEL_PHP_AUTOLOAD_ENABLED set up.",
    "    OpenTelemetry\\API\\Logs\\LoggerProviderInterface:",
    "        factory: ['OpenTelemetry\\API\\Globals', 'loggerProvider']",
    "",
    "    # A Monolog handler that sends each record to OneUptime, with the request's trace.",
    "    OpenTelemetry\\Contrib\\Logs\\Monolog\\Handler:",
    "        arguments:",
    "            $loggerProvider: '@OpenTelemetry\\API\\Logs\\LoggerProviderInterface'",
    "            $level: 'info'",
    "",
    "monolog:",
    "    handlers:",
    "        opentelemetry:",
    "            type: service",
    "            id: OpenTelemetry\\Contrib\\Logs\\Monolog\\Handler",
    "            # Your app's own records: Symfony's channels repeat the spans.",
    '            channels: ["app"]',
  ].join("\n"),
  check: "run",
};

const controllerFile: string = [
  "<?php",
  "",
  "namespace App\\Controller;",
  "",
  "use Doctrine\\DBAL\\Connection;",
  "use OpenTelemetry\\API\\Globals;",
  "use OpenTelemetry\\API\\Trace\\StatusCode;",
  "use Psr\\Log\\LoggerInterface;",
  "use RuntimeException;",
  "use Symfony\\Component\\HttpFoundation\\JsonResponse;",
  "use Symfony\\Component\\HttpFoundation\\Request;",
  "use Symfony\\Component\\Routing\\Attribute\\Route;",
  "use Symfony\\Contracts\\HttpClient\\HttpClientInterface;",
  "use Throwable;",
  "",
  "class OrderController",
  "{",
  "    public function __construct(",
  "        private Connection $db,",
  "        private HttpClientInterface $http,",
  "        private LoggerInterface $logger,",
  "    ) {",
  "    }",
  "",
  "    // The route's name names the request's span: GET orders_show.",
  "    #[Route('/orders/{id}', name: 'orders_show', methods: ['GET'])]",
  "    public function show(int $id): JsonResponse",
  "    {",
  "        $this->logger->info('loading order', ['order.id' => $id]);",
  "        $order = $this->db->fetchAssociative(",
  "            'SELECT * FROM orders WHERE id = ?',",
  "            [$id],",
  "        );",
  "",
  "        // A missing order is answered, not thrown: an exception would be recorded.",
  "        return $order",
  "            ? new JsonResponse($order)",
  "            : new JsonResponse(['error' => 'no such order'], 404);",
  "    }",
  "",
  "    #[Route('/orders', name: 'orders_create', methods: ['POST'])]",
  "    public function create(Request $request): JsonResponse",
  "    {",
  "        $order = $request->toArray();",
  "        $tracer = Globals::tracerProvider()->getTracer('storefront');",
  "        // A span of your own: the HTTP call and the INSERT inside it nest beneath it.",
  "        $span = $tracer->spanBuilder('checkout.charge')",
  "            ->setAttribute('payment.method', $order['payment_method'])",
  "            ->setAttribute('order.item_count', count($order['items']))",
  "            ->startSpan();",
  "        $scope = $span->activate();",
  "",
  "        try {",
  "            $payments = $_SERVER['PAYMENTS_API_URL'] ?? 'http://localhost:9000';",
  "            $this->http->request('POST', \"$payments/api/charges\", [",
  "                'json' => ['payment_method' => $order['payment_method']],",
  "            ])->getContent();",
  "            $this->db->insert('orders', [",
  "                'items' => count($order['items']),",
  "                'payment_method' => $order['payment_method'],",
  "            ]);",
  "        } catch (Throwable $error) {",
  "            $span->recordException($error);",
  "            $span->setStatus(StatusCode::STATUS_ERROR, 'charge failed');",
  "            throw $error;",
  "        } finally {",
  "            $scope->detach();",
  "            $span->end();",
  "        }",
  "",
  "        Globals::meterProvider()->getMeter('storefront')",
  "            ->createCounter('orders.placed', '{order}', 'Orders placed')",
  "            ->add(1, ['payment.method' => $order['payment_method']]);",
  "",
  "        return new JsonResponse(['status' => 'placed'], 201);",
  "    }",
  "",
  "    #[Route('/orders/{id}/receipt', name: 'orders_receipt', methods: ['GET'])]",
  "    public function receipt(int $id): JsonResponse",
  "    {",
  '        throw new RuntimeException("the receipt printer is offline for order $id");',
  "    }",
  "}",
].join("\n");

const controller: GuideSnippet = {
  id: "controller",
  language: "php",
  title: "src/Controller/OrderController.php",
  code: controllerFile,
  check: "run",
};

const createOrder: GuideSnippet = {
  id: "create-order",
  language: "php",
  title: "src/Controller/OrderController.php",
  code: blockOf(controllerFile, "public function create(", "}"),
  check: "contained",
};

const counter: GuideSnippet = {
  id: "counter",
  language: "php",
  title: "src/Controller/OrderController.php",
  code: [
    "        Globals::meterProvider()->getMeter('storefront')",
    "            ->createCounter('orders.placed', '{order}', 'Orders placed')",
    "            ->add(1, ['payment.method' => $order['payment_method']]);",
  ].join("\n"),
  check: "contained",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "php -S 0.0.0.0:8000 -t public",
  check: "run",
};

const sampling: GuideSnippet = {
  id: "sampling",
  language: "bash",
  code: [
    'export OTEL_TRACES_SAMPLER="parentbased_traceidratio"',
    'export OTEL_TRACES_SAMPLER_ARG="0.25"',
    "# A health check's path, which then loads no OpenTelemetry at all.",
    'export OTEL_PHP_EXCLUDED_URLS="^/healthz$"',
  ].join("\n"),
  check: "parse",
};

// DoctrineBundle's DBAL alone, on the SQLite file .env.local names.
const DOCTRINE_CONFIG: string = [
  "doctrine:",
  "    dbal:",
  "        url: '%env(resolve:DATABASE_URL)%'",
].join("\n");

const CREATE_TABLES: string = [
  "<?php",
  "",
  "@mkdir(__DIR__ . '/../var');",
  "$db = new PDO('sqlite:' . __DIR__ . '/../var/data.db');",
  "$db->exec('CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, items INTEGER, payment_method TEXT)');",
  "$db->exec(\"INSERT OR IGNORE INTO orders VALUES (42, 2, 'card')\");",
].join("\n");

const FILES: Array<VerificationFile> = [
  { path: "src/Controller/OrderController.php", snippet: "controller" },
  { path: "config/packages/opentelemetry.yaml", snippet: "monolog-config" },
  { path: "config/packages/doctrine.yaml", content: DOCTRINE_CONFIG },
  {
    path: ".env.local",
    content: 'DATABASE_URL="sqlite:///%kernel.project_dir%/var/data.db"',
  },
  { path: "bin/create-tables.php", content: CREATE_TABLES },
];

/*
 * Symfony's skeleton, created beside the page's files and copied in
 * without replacing them, with the app's own bundles; then the steps.
 */
const COMMANDS: Array<VerificationCommand> = [
  { snippet: "install-extension" },
  {
    command: `composer create-project ${pinnedPhpPackage("symfony/skeleton")} /tmp/storefront --no-interaction && cp -r --update=none /tmp/storefront/. . && rm -rf /tmp/storefront`,
  },
  {
    // Without its scripts: the cache is built once the page's packages are in.
    command: `composer require --no-scripts ${["symfony/http-client", "symfony/monolog-bundle", "doctrine/doctrine-bundle", "doctrine/dbal"].map(pinnedPhpPackage).join(" ")}`,
  },
  { snippet: "install" },
  { command: "php bin/create-tables.php" },
  { snippet: "run", isServer: true },
];

export const SymfonyGuide: OpenTelemetryGuide = {
  slug: "symfony",
  seo: {
    title: "Symfony OpenTelemetry: Kernel, HttpClient, Logs | OneUptime",
    description:
      "Trace Symfony with OpenTelemetry and no code: every request through the kernel, HttpClient calls, SQL through PDO, and Monolog records with trace IDs.",
  },
  h1: "OpenTelemetry for Symfony",
  lead: "Trace every request your Symfony app handles, named after its route, with the HttpClient calls and the SQL beneath it, and send traces, metrics and Monolog's records to OneUptime. The OpenTelemetry extension and Composer packages trace the kernel with no code, and one configuration file gives Monolog a handler that sends to OneUptime.",
  cardDescription:
    "Symfony 6 to 8: the kernel's requests, HttpClient calls and SQL traced with no code, Monolog records with trace IDs.",
  searchTerms: [
    "httpkernel",
    "httpclient",
    "doctrine",
    "dbal",
    "monolog-bundle",
    "opentelemetry-auto-symfony",
  ],
  highlights: [
    "Kernel and HttpClient traced",
    "Monolog with trace IDs",
    "Symfony 8.1",
  ],

  whatYouGet: {
    intro: `Each request becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, listed in ${SCREENS.services} as the first one ends. The example is a storefront's orders API on Symfony 8.1, with its orders in SQLite through Doctrine DBAL and a payment provider it calls with HttpClient.`,
    traces:
      "A server span per request, named after the method and the route's name, such as `GET orders_show`, with the SQL sent through PDO and each HttpClient call beneath it, and `traceparent` sent along.",
    metrics:
      "The instruments you create, such as orders placed by payment method. Symfony's instrumentation records spans only.",
    logs: "Each record your app's channel writes, at INFO or above, with the trace and span IDs of the request that wrote it and its context as attributes.",
    exceptions: `An exception that leaves a controller is recorded on the request's span, which is marked failed, and ${SCREENS.exceptions} lists it. Symfony's own HTTP exceptions count too: a \`NotFoundHttpException\` you throw is recorded like any other.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST orders_create",
        depth: 0,
        start: 0,
        duration: 100,
        source: "symfony",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 5,
        duration: 87,
        source: "your code",
      },
      { name: "POST", depth: 2, start: 8, duration: 55, source: "httpclient" },
      {
        name: "PDO::prepare",
        depth: 2,
        start: 68,
        duration: 6,
        source: "pdo",
      },
      {
        name: "PDOStatement::execute",
        depth: 2,
        start: 76,
        duration: 13,
        source: "pdo",
      },
    ],
  },

  prerequisites: [
    PHP_PREREQUISITE,
    "A Symfony app with `symfony/monolog-bundle`; Symfony 8.1 needs PHP 8.4 or later. Not on Symfony? Follow the [PHP](/integrations/opentelemetry/php) guide for any other app.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Build the extension from PECL and load it, then add the SDK, the OTLP exporter, the instrumentations for Symfony and PDO, and Monolog's handler, at the versions this guide was checked with:",
    snippets: [installExtension, install],
    notes: [
      "`opentelemetry-auto-symfony` traces the kernel and HttpClient through the extension's hooks: once PHP loads the extension, `php --ri opentelemetry` shows its version.",
      "Doctrine DBAL sends its SQL through PDO, which `opentelemetry-auto-pdo` traces once per call. `opentelemetry-auto-doctrine` 0.5 traces DBAL's driver instead, once for each middleware DoctrineBundle wraps it in, so each query arrives as a stack of copies.",
    ],
  },

  configure: {
    intro:
      "The SDK sets itself up from the standard OpenTelemetry variables when `OTEL_PHP_AUTOLOAD_ENABLED` is on:",
    tabs: otlpEnvironmentTabs({
      serviceName: "storefront",
      extraLines: PHP_ENVIRONMENT_LINES,
    }),
    notes: [
      "Set them in the environment PHP runs in, not in `.env`: the SDK starts as `public/index.php` loads Composer's autoloader, before Symfony reads `.env`.",
    ],
  },

  setup: {
    intro:
      "Symfony's requests and HttpClient calls are traced by the instrumentation as the autoloader loads, and the SQL by PDO's. What is left to set up is Monolog's handler, in one configuration file.",
    steps: [
      {
        title: "Give Monolog a handler that sends to OneUptime",
        body: "Define the handler as a service, with the SDK's logger provider, and add it to Monolog's handlers:",
        snippets: [monologConfig],
        notes: [
          '`channels: ["app"]` sends the records of your own services. Symfony\'s channels, such as `request` and `http_client`, write a line for each request and call, which the spans already show.',
        ],
      },
      {
        title: "Write the controllers as usual",
        body: "Give each route a name: the instrumentation names the request's span after it. Only `create` here holds OpenTelemetry code, a span of its own and a counter:",
        snippets: [controller],
      },
      {
        title: "Serve it",
        body: "With the variables above exported, serve `public/` with PHP's own server to try it:",
        snippets: [run],
        notes: [
          "PHP's own server is for trying it out: PHP-FPM or Apache in production read the same `.ini` file, so the extension loads there too.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "`opentelemetry-auto-symfony` hooks the kernel and HttpClient through the extension, and `opentelemetry-auto-pdo` the SQL beneath them. With this app, a request's trace holds:",
    rows: [
      {
        library: "HttpKernel",
        covers:
          "A server span per request, named after the method and the route's name (`GET orders_show`), with the name in `http.route`, the status code, and the exception that left a controller; a `GET error_controller` span when Symfony renders an error.",
      },
      {
        library: "HttpClient",
        covers:
          "A client span per request, named after its method, with the URL, and `traceparent` added so the service called joins the trace.",
      },
      {
        library: "PDO",
        covers:
          "A span per call DBAL makes, `PDO::connect`, `PDO::prepare` and `PDOStatement::execute`, with the SQL in `db.query.text`.",
      },
    ],
    snippets: [],
    notes: [
      "A route without a name gets one Symfony generates from the controller, such as `app_order_show`: name your routes to keep span names short and stable.",
    ],
  },

  manualSpans: {
    intro:
      "Open a span of your own with the API's tracer around work Symfony does not name, make it current with `activate()`, and the HttpClient and PDO spans inside nest beneath it:",
    snippets: [createOrder],
    notes: [
      "`finally` detaches the scope and ends the span on every path out of the block: an unended span is never exported.",
      "`getContent()` throws on a 4xx or 5xx answer, so a failed charge is recorded on the span before Symfony answers with a 500.",
      "Search the attributes you set in the **Traces** explorer: `@payment.method:card` finds the card orders.",
    ],
  },

  logs: {
    intro:
      "Log through the `LoggerInterface` Symfony injects, as you do. The handler above sends each record of the `app` channel, with the IDs of the request's span and its context as attributes:",
    snippets: [],
    notes: [
      "The context's keys arrive under `context.`, as `context.order.id`, beside a `context` map holding them all.",
      "The handler's `$level` keeps records under INFO out of OneUptime, while the other handlers still write them where they did.",
      "An exception passed in the context, as `['exception' => $error]`, is sent as `exception.type`, `exception.message` and `exception.stacktrace`.",
    ],
  },

  metrics: {
    intro:
      "Symfony's instrumentation sends no metrics, so the app's metrics are the instruments it creates, as `create` does once the order is saved:",
    builtIn: [],
    snippets: [counter],
    notes: [
      "Each PHP request counts on its own: with the `delta` temporality set above, each exports its own count, and OneUptime sums them.",
      "A payment method has few values, so the counter has few series; an attribute with an ID in it would make one series per order.",
    ],
  },

  sampling: {
    intro:
      "Keep a share of the traces with the standard variables, and keep a health check out altogether with `OTEL_PHP_EXCLUDED_URLS`:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps one in four of the traces that start at the app, and follows the caller's choice for a request that arrives with `traceparent`.",
      "A request whose path matches a pattern in `OTEL_PHP_EXCLUDED_URLS` loads no OpenTelemetry: no span, no record, no measurement.",
    ],
  },

  deploy: {
    intro:
      "Serve `public/` with Apache in the PHP image, with the extension built in by its installer of PECL extensions, and give the Deployment the key from a Secret:",
    snippets: [
      phpDockerfileSnippet({
        documentRoot: "public",
        extraLines: [
          "ENV APP_ENV=prod",
          "RUN mkdir -p var && chown -R www-data var",
        ],
      }),
      kubernetesManifestSnippet({
        name: "storefront",
        image: "registry.example.com/storefront:5.2.0",
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
      "Give the container its `APP_SECRET` and `DATABASE_URL` the way your other settings reach it, from a Secret of their own.",
      "The image runs Symfony with `APP_ENV=prod`; it builds its cache in `var/` on the first request, which Apache's user can write to.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Open a request's trace",
        body: `Request \`/orders/42\`, then open ${SCREENS.traces}: \`GET orders_show\` holds the \`PDO::prepare\` and \`PDOStatement::execute\` of its query. A span named after a generated route, such as \`GET app_order_show\`, means the route has no name.`,
      },
      {
        title: "Find the order's trace",
        body: `Place an order with a \`POST\` to \`/orders\`: \`POST orders_create\` holds \`checkout.charge\`, with HttpClient's \`POST\` and the \`INSERT\`'s PDO spans beneath it.`,
      },
      {
        title: "Find the exception and the logs",
        body: `Request \`/orders/42/receipt\`: ${SCREENS.exceptions} lists the \`RuntimeException\`. In ${SCREENS.logs}, the \`loading order\` records open the traces that wrote them.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Every 404 shows up under Exceptions",
      answer:
        "The controller throws `NotFoundHttpException`, and the instrumentation records every exception that leaves a controller. Return a 404 response instead, as `show` does, for what is the caller's mistake.",
    },
    {
      question: "Each query arrives as a stack of nested copies",
      answer:
        "`opentelemetry-auto-doctrine` is installed: it traces DBAL's driver once for each middleware DoctrineBundle adds. Remove it, and let `opentelemetry-auto-pdo` trace the SQL once, where DBAL hands it to PDO.",
    },
    {
      question:
        "A POST span to /v1/metrics arrives with each request that counts",
      answer:
        "That is the SDK's own export, at the end of the request: it goes through Symfony's HttpClient, which the instrumentation traces like any other call. Drop it as it arrives with a [drop filter](/docs/telemetry/drop-filters-and-scrub-rules) on its `url.full`.",
    },
    {
      question: "No records arrive, though spans do",
      answer:
        "The handler is not among Monolog's handlers in this environment, or the records go to another channel than `app`, the one a service's injected logger writes to unless its channel is set otherwise. Add that channel to the handler's `channels`.",
    },
    {
      question: "Nothing arrives at all",
      answer:
        "The SDK never started: PHP's environment has no `OTEL_PHP_AUTOLOAD_ENABLED=true`. Set in `.env`, it is read too late; under PHP-FPM, list each variable in the pool's configuration too.",
    },
  ],

  faq: [
    {
      question: "Do I need to change my code?",
      answer:
        "No: the kernel, HttpClient and the SQL are traced as they are. Code is needed only for spans and metrics of your own, and configuration for Monolog's handler.",
    },
    {
      question: "Which versions is this checked with?",
      answer:
        "Symfony 8.1 on PHP 8.5, with Doctrine DBAL 4.5, the extension 1.4, the SDK 1.15 and `opentelemetry-auto-symfony` 1.7.",
    },
    {
      question: "Why are spans named after routes' names, not their paths?",
      answer:
        "The instrumentation reads the route Symfony matched from the request's `_route` attribute, which holds its name: `orders_show` rather than `/orders/{id}`. The path is in `url.path` on the same span.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: each request sends straight to OneUptime as it ends. A Collector on each host lets requests hand off their telemetry locally and fast, and keeps the key in one place: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["php", "laravel", "slim", "spring-boot"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.dropFilters],

  verification: {
    runtime: "php",
    framework: { name: "Symfony", package: "symfony/framework-bundle" },
    files: FILES,
    stubApiPort: 9000,
    commands: COMMANDS,
    port: 8000,
    requests: [
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
          name: "GET orders_show",
          attributes: {
            "http.route": "orders_show",
            "http.response.status_code": "200",
          },
        },
        {
          name: "GET orders_show",
          attributes: { "http.response.status_code": "404" },
          hasException: false,
        },
        { name: "PDOStatement::execute", parent: "GET orders_show" },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
          parent: "POST orders_create",
        },
        {
          name: "POST",
          attributes: { "http.request.method": "POST" },
          parent: "checkout.charge",
        },
        { name: "PDO::prepare", parent: "checkout.charge" },
        {
          name: "GET orders_receipt",
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
      resource: { "service.name": "storefront" },
      absentLogs: ["Matched route"],
    },
  },
};
