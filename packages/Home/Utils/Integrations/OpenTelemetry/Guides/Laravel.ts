import {
  OpenTelemetryGuide,
  GuideSnippet,
  GuideVerificationRun,
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
  PHP_PACKAGE_VERSIONS,
  PHP_PREREQUISITE,
  PHP_SDK_PACKAGES,
  composerRequireSnippet,
  peclInstallSnippet,
  phpDockerfileSnippet,
} from "../PhpShared";

/*
 * A Laravel 13 API: a storefront's orders in SQLite through Eloquent, a
 * payment provider called with the Http client, and errors handled by
 * Laravel's own handler. The extension and opentelemetry-auto-laravel
 * trace requests, Eloquent, queries, the Http client and the Log facade
 * with no code; the one setting it cannot do without is Composer's
 * permission to run the SDK's plugin, without which nothing of Laravel's
 * is traced.
 */

const installExtension: GuideSnippet = peclInstallSnippet();

const allowPlugin: GuideSnippet = {
  id: "allow-plugin",
  language: "bash",
  code: "composer config allow-plugins.tbachert/spi true",
  check: "run",
};

const install: GuideSnippet = composerRequireSnippet("install", [
  ...PHP_SDK_PACKAGES,
  "open-telemetry/opentelemetry-auto-laravel",
]);

const routes: GuideSnippet = {
  id: "routes",
  language: "php",
  title: "routes/api.php",
  code: [
    "<?php",
    "",
    "use App\\Http\\Controllers\\OrderController;",
    "use Illuminate\\Support\\Facades\\Route;",
    "",
    "Route::get('/orders/{order}', [OrderController::class, 'show']);",
    "Route::post('/orders', [OrderController::class, 'store']);",
    "Route::get('/orders/{order}/receipt', [OrderController::class, 'receipt']);",
  ].join("\n"),
  check: "run",
};

const controllerFile: string = [
  "<?php",
  "",
  "namespace App\\Http\\Controllers;",
  "",
  "use App\\Models\\Order;",
  "use Illuminate\\Http\\Request;",
  "use Illuminate\\Support\\Facades\\Http;",
  "use Illuminate\\Support\\Facades\\Log;",
  "use OpenTelemetry\\API\\Globals;",
  "use OpenTelemetry\\API\\Trace\\StatusCode;",
  "use RuntimeException;",
  "use Throwable;",
  "",
  "class OrderController extends Controller",
  "{",
  "    public function show(Order $order)",
  "    {",
  "        Log::info('loading order', ['order.id' => $order->id]);",
  "",
  "        return $order;",
  "    }",
  "",
  "    public function store(Request $request)",
  "    {",
  "        $tracer = Globals::tracerProvider()->getTracer('storefront');",
  "        // A span of your own: the HTTP call and the INSERT inside it nest beneath it.",
  "        $span = $tracer->spanBuilder('checkout.charge')",
  "            ->setAttribute('payment.method', $request->input('payment_method'))",
  "            ->setAttribute('order.item_count', count($request->input('items')))",
  "            ->startSpan();",
  "        $scope = $span->activate();",
  "",
  "        try {",
  "            $payments = config('services.payments.url', 'http://localhost:9000');",
  '            Http::post("$payments/api/charges", [',
  "                'payment_method' => $request->input('payment_method'),",
  "            ])->throw();",
  "            $order = Order::create([",
  "                'items' => count($request->input('items')),",
  "                'payment_method' => $request->input('payment_method'),",
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
  "            ->add(1, ['payment.method' => $order->payment_method]);",
  "",
  "        return response()->json($order, 201);",
  "    }",
  "",
  "    public function receipt(Order $order)",
  "    {",
  "        // Laravel answers it with a 500 and logs it: both reach OneUptime.",
  '        $message = "the receipt printer is offline for order {$order->id}";',
  "        throw new RuntimeException($message);",
  "    }",
  "}",
].join("\n");

const controller: GuideSnippet = {
  id: "controller",
  language: "php",
  title: "app/Http/Controllers/OrderController.php",
  code: controllerFile,
  check: "run",
};

const storeOrder: GuideSnippet = {
  id: "store-order",
  language: "php",
  title: "app/Http/Controllers/OrderController.php",
  code: blockOf(controllerFile, "public function store(", "}"),
  check: "contained",
};

const showOrder: GuideSnippet = {
  id: "show-order",
  language: "php",
  title: "app/Http/Controllers/OrderController.php",
  code: blockOf(controllerFile, "public function show(", "}"),
  check: "contained",
};

const counter: GuideSnippet = {
  id: "counter",
  language: "php",
  title: "app/Http/Controllers/OrderController.php",
  code: [
    "        Globals::meterProvider()->getMeter('storefront')",
    "            ->createCounter('orders.placed', '{order}', 'Orders placed')",
    "            ->add(1, ['payment.method' => $order->payment_method]);",
  ].join("\n"),
  check: "contained",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "php artisan serve",
  check: "run",
};

const flattenLogs: GuideSnippet = {
  id: "flatten-logs",
  language: "bash",
  title: "Environment",
  code: [
    "# Each key of a record's context as an attribute of its own: order.id.",
    'export OTEL_PHP_LARAVEL_LOG_ATTRIBUTES_FLATTEN="true"',
  ].join("\n"),
  check: "run",
};

const excludedUrls: GuideSnippet = {
  id: "excluded-urls",
  language: "bash",
  code: [
    "# Requests whose path matches one of these patterns load no OpenTelemetry at all.",
    'export OTEL_PHP_EXCLUDED_URLS="^/up$"',
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

// The skeleton's bootstrap/app.php, with the API's routes added.
const BOOTSTRAP_APP: string = [
  "<?php",
  "",
  "use Illuminate\\Foundation\\Application;",
  "use Illuminate\\Foundation\\Configuration\\Exceptions;",
  "use Illuminate\\Foundation\\Configuration\\Middleware;",
  "",
  "return Application::configure(basePath: dirname(__DIR__))",
  "    ->withRouting(",
  "        web: __DIR__.'/../routes/web.php',",
  "        api: __DIR__.'/../routes/api.php',",
  "        commands: __DIR__.'/../routes/console.php',",
  "        health: '/up',",
  "    )",
  "    ->withMiddleware(function (Middleware $middleware): void {",
  "        //",
  "    })",
  "    ->withExceptions(function (Exceptions $exceptions): void {",
  "        //",
  "    })->create();",
].join("\n");

const ORDER_MODEL: string = [
  "<?php",
  "",
  "namespace App\\Models;",
  "",
  "use Illuminate\\Database\\Eloquent\\Model;",
  "",
  "class Order extends Model",
  "{",
  "    protected $fillable = ['items', 'payment_method'];",
  "}",
].join("\n");

const MIGRATION: string = [
  "<?php",
  "",
  "use Illuminate\\Database\\Migrations\\Migration;",
  "use Illuminate\\Database\\Schema\\Blueprint;",
  "use Illuminate\\Support\\Facades\\Schema;",
  "",
  "return new class extends Migration",
  "{",
  "    public function up(): void",
  "    {",
  "        Schema::create('orders', function (Blueprint $table) {",
  "            $table->id();",
  "            $table->integer('items');",
  "            $table->string('payment_method');",
  "            $table->timestamps();",
  "        });",
  "    }",
  "};",
].join("\n");

const FILES: Array<VerificationFile> = [
  { path: "routes/api.php", snippet: "routes" },
  { path: "bootstrap/app.php", content: BOOTSTRAP_APP },
  { path: "app/Http/Controllers/OrderController.php", snippet: "controller" },
  { path: "app/Models/Order.php", content: ORDER_MODEL },
  {
    path: "database/migrations/2026_10_28_000000_create_orders_table.php",
    content: MIGRATION,
  },
];

/*
 * The app the check builds: Laravel's skeleton, created beside the page's
 * files and copied in without replacing them, then the page's steps.
 */
const COMMANDS: Array<VerificationCommand> = [
  { snippet: "install-extension" },
  {
    command: `composer create-project laravel/laravel:${PHP_PACKAGE_VERSIONS["laravel/laravel"]} /tmp/storefront --no-interaction && cp -r --update=none /tmp/storefront/. . && rm -rf /tmp/storefront`,
  },
  { snippet: "allow-plugin" },
  { snippet: "install" },
  { command: "php artisan migrate --force" },
  {
    command:
      'php artisan tinker --execute=\'App\\Models\\Order::forceCreate(["id" => 42, "items" => 2, "payment_method" => "card"]);\'',
  },
  { snippet: "run", isServer: true },
];

function appRun(): Pick<
  GuideVerificationRun,
  "files" | "commands" | "port" | "requests" | "stubApiPort"
> {
  return {
    files: FILES,
    stubApiPort: 9000,
    commands: COMMANDS,
    port: 8000,
    requests: [
      { method: "GET", path: "/up" },
      { method: "GET", path: "/api/orders/42" },
      { method: "GET", path: "/api/orders/7" },
      {
        method: "POST",
        path: "/api/orders",
        body: { items: ["kettle", "mug"], payment_method: "card" },
      },
      { method: "GET", path: "/api/orders/42/receipt" },
    ],
  };
}

export const LaravelGuide: OpenTelemetryGuide = {
  slug: "laravel",
  seo: {
    title: "Laravel OpenTelemetry: Automatic Tracing | OneUptime",
    description:
      "Add OpenTelemetry to Laravel with no code: requests, Eloquent and queries, the Http client and the Log facade with trace IDs, through the PHP extension.",
  },
  h1: "OpenTelemetry for Laravel",
  lead: "Trace every request your Laravel app serves, named after its route, with the Eloquent operations, the SQL and the Http client calls beneath it, and send traces, metrics and the Log facade's records to OneUptime. The OpenTelemetry extension and one Composer package do it with no code; your own spans and metrics are a few lines where you want them.",
  cardDescription:
    "Laravel 10 to 13: requests, Eloquent, queries, the Http client and Log records traced with no code, through the extension.",
  searchTerms: [
    "eloquent",
    "artisan",
    "log facade",
    "http client",
    "opentelemetry-auto-laravel",
  ],
  highlights: [
    "No code to change",
    "Eloquent and the Log facade",
    "Laravel 10 to 13",
  ],

  whatYouGet: {
    intro: `Each request becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, which ${SCREENS.services} lists from the end of the first one. The example is a storefront's orders API on Laravel 13, with its orders in SQLite through Eloquent and a payment provider it calls with the Http client.`,
    traces:
      "A server span per request, named after its route, such as `GET /api/orders/{order}`; beneath it, a span per Eloquent operation, one per SQL query with its statement, and one per Http client call, with `traceparent` sent along.",
    metrics:
      "Laravel's instrumentation records spans and logs only, so the metrics are the instruments you create: orders by payment method, here.",
    logs: "Every record written through the Log facade, at its severity, with the trace and span IDs of the request that wrote it and its context as attributes.",
    exceptions: `An exception an action raises is recorded on the request's span, which is marked failed, and Laravel's handler logs it with \`exception.type\` and \`exception.message\`: ${SCREENS.exceptions} lists it. A missing model, answered with a 404, is neither.`,
  },

  exampleTrace: {
    caption: "A POST /api/orders request, as its trace shows it",
    spans: [
      {
        name: "POST /api/orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "laravel",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 6,
        duration: 84,
        source: "your code",
      },
      { name: "POST", depth: 2, start: 9, duration: 48, source: "http client" },
      {
        name: "App\\Models\\Order::create",
        depth: 2,
        start: 62,
        duration: 24,
        source: "eloquent",
      },
      {
        name: "sql INSERT",
        depth: 3,
        start: 65,
        duration: 16,
        source: "laravel",
      },
    ],
  },

  prerequisites: [
    PHP_PREREQUISITE,
    "A Laravel app on Laravel 10 to 13, which the instrumentation supports; Laravel 13 needs PHP 8.3 or later. Not on Laravel? The [PHP](/integrations/opentelemetry/php) guide covers an app of your own.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Build the extension from PECL and load it, let Composer run the SDK's plugin, then add the SDK, the OTLP exporter and Laravel's instrumentation, at the versions this guide was checked with:",
    snippets: [installExtension, allowPlugin, install],
    notes: [
      "The plugin, `tbachert/spi`, writes the list of installed instrumentations into Composer's autoloader. Without it, the SDK starts before Laravel's instrumentation has registered: the app runs, your own spans arrive, and nothing of Laravel's is traced.",
      "`opentelemetry-auto-laravel` traces through the extension's hooks, so check that PHP loads it: `php --ri opentelemetry` prints its version.",
    ],
  },

  configure: {
    intro:
      "The SDK reads the standard OpenTelemetry variables, and sets itself up from them when `OTEL_PHP_AUTOLOAD_ENABLED` is on:",
    tabs: otlpEnvironmentTabs({
      serviceName: "storefront",
      extraLines: PHP_ENVIRONMENT_LINES,
    }),
    notes: [
      "Set them in the environment PHP runs in, not in `.env`: the SDK starts as `public/index.php` loads Composer's autoloader, before Laravel reads `.env`.",
      "`php artisan serve` passes every `OTEL_` variable on to the server it starts: the instrumentation adds them to the ones it passes through.",
    ],
  },

  setup: {
    intro:
      "Laravel needs no code for its own spans: the instrumentation hooks its HTTP kernel, Eloquent, the database, the Http client and the Log facade as Composer's autoloader loads. The app below is an ordinary one.",
    steps: [
      {
        title: "Write the routes and the controller as usual",
        body: "This API's routes, in `routes/api.php`, which `php artisan install:api` sets up:",
        snippets: [routes, controller],
        notes: [
          "Only `store` holds OpenTelemetry code: a span of its own around the charge, and a counter.",
        ],
      },
      {
        title: "Serve it",
        body: "With the variables above exported, serve it as usual:",
        snippets: [run],
        notes: [
          "In production, PHP-FPM or Apache load the extension from the same `.ini` file, and each request sends its telemetry as it ends.",
        ],
      },
      {
        title: "Leave the health check out",
        body: "Laravel answers its health check at `/up`, which a load balancer calls every few seconds. A pattern in `OTEL_PHP_EXCLUDED_URLS` keeps OpenTelemetry out of such requests:",
        snippets: [excludedUrls],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "`opentelemetry-auto-laravel` hooks Laravel through the extension, with nothing to register. With this app, a request's trace holds:",
    rows: [
      {
        library: "HTTP kernel",
        covers:
          "A server span per request, named after its route (`GET /api/orders/{order}`), with `http.route`, the status code, and the exception of an action that raised.",
      },
      {
        library: "Eloquent",
        covers:
          "A span per model operation, such as `App\\Models\\Order::create`, with the model, its table and the operation.",
      },
      {
        library: "Database",
        covers:
          "A span per query, `sql SELECT` or `sql INSERT`, with the statement in `db.query.text`, its values as `?`.",
      },
      {
        library: "Http client",
        covers:
          "A client span per call made with the `Http` facade, named after its method, with the URL and status, and `traceparent` sent along.",
      },
      {
        library: "Log facade",
        covers:
          "Every record, with the trace and span IDs of the request that wrote it, and an exception in its context as `exception.*` attributes.",
      },
    ],
    snippets: [],
    notes: [
      "Queued jobs are traced too: a job dispatched in a request runs as a `process` span in that request's trace under `queue:work`. The worker also sends a `receive` span each time it polls an empty queue.",
    ],
  },

  manualSpans: {
    intro:
      "Open a span of your own with the API's tracer around work Laravel does not name, make it current with `activate()`, and the Eloquent and Http spans inside nest beneath it:",
    snippets: [storeOrder],
    notes: [
      "Detach the scope and end the span in `finally`, whatever happens: a span never ended is never sent.",
      "`->throw()` turns a failed charge into an exception, which the span records before Laravel answers with a 500.",
      "The attributes you set are searchable: `@order.item_count:2` in the **Traces** explorer finds the orders of two items.",
    ],
  },

  logs: {
    intro:
      "Log through the facade as you do. Each record carries the IDs of the request's span; with the variable below, each key of its context becomes an attribute of its own:",
    snippets: [showOrder, flattenLogs],
    notes: [
      "Without `OTEL_PHP_LARAVEL_LOG_ATTRIBUTES_FLATTEN`, the context is sent as one `context` attribute holding a map.",
      "The instrumentation sends a record only at a level the channel would write, so `LOG_LEVEL` in `.env` still decides what is kept.",
      "Laravel's handler logs an exception it reports with the exception in the context: the record arrives with `exception.type`, `exception.message` and `exception.stacktrace`.",
    ],
  },

  metrics: {
    intro:
      "Laravel's instrumentation sends no metrics, so a Laravel app's metrics are the instruments it creates, as `store` does once the order is saved:",
    builtIn: [],
    snippets: [counter],
    notes: [
      "Each request counts on its own: `delta` temporality, set above, exports what each counted, and OneUptime adds the requests up.",
      "A payment method has a few values, so the counter has a few series; an ID would make one per order.",
    ],
  },

  sampling: {
    intro:
      "With the health check left out, keep a share of the other traces with the standard variables:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps one in four of the traces that start at the app, and follows the caller's choice for a request with `traceparent`, and a queued job follows the request that dispatched it.",
      "Logs and the counter are not sampled.",
    ],
  },

  deploy: {
    intro:
      "Serve Laravel's `public/` folder with Apache in the PHP image, the extension built in, and give the Deployment the key from a Secret:",
    snippets: [
      phpDockerfileSnippet({
        documentRoot: "public",
        extraLines: ["RUN chown -R www-data storage bootstrap/cache database"],
      }),
      kubernetesManifestSnippet({
        name: "storefront",
        image: "registry.example.com/storefront:4.0.0",
        containerPort: 80,
        extraEnv: [
          { name: "OTEL_PHP_AUTOLOAD_ENABLED", value: "true" },
          {
            name: "OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE",
            value: "delta",
          },
          { name: "OTEL_PHP_EXCLUDED_URLS", value: "^/up$" },
        ],
      }),
    ],
    notes: [
      "Give the container its `APP_KEY` and database settings the way your other settings reach it; the OpenTelemetry variables stay in its environment, where the SDK reads them before Laravel loads anything.",
      "Run `queue:work` from the same image, with the same variables and a service name of its own, so jobs join the traces of the requests that dispatched them.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Open a request's trace",
        body: `Request \`/api/orders/42\`, then open ${SCREENS.traces}: \`GET /api/orders/{order}\` holds \`App\\Models\\Order::get\` with its \`sql SELECT\`. No Eloquent or SQL spans? Check the plugin step above.`,
      },
      {
        title: "Find the order's trace",
        body: `Place an order with a \`POST\` to \`/api/orders\`: its trace holds \`checkout.charge\`, with the payment provider's \`POST\` and \`App\\Models\\Order::create\` beneath it.`,
      },
      {
        title: "Find the exception",
        body: `Request \`/api/orders/42/receipt\`: ${SCREENS.exceptions} lists the \`RuntimeException\`, and in ${SCREENS.logs} its \`error\` record opens the same trace.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Your own spans arrive, but nothing of Laravel's",
      answer:
        "Composer did not run the SDK's `tbachert/spi` plugin, so the SDK started before Laravel's instrumentation registered. Allow it with `composer config allow-plugins.tbachert/spi true`, then run `composer dump-autoload`.",
    },
    {
      question: "Nothing arrives at all",
      answer:
        "The SDK never started: `OTEL_PHP_AUTOLOAD_ENABLED=true` is missing from PHP's environment. Set in `.env` alone, it is read too late; under PHP-FPM, each variable must also be listed in the pool's configuration, which clears the environment by default.",
    },
    {
      question: "The health check fills the traces",
      answer:
        "Laravel's `/up` is traced like any other route. List it in `OTEL_PHP_EXCLUDED_URLS`, as above: a request whose path matches loads no OpenTelemetry at all.",
    },
    {
      question: "`queue:work` sends a receive span every few seconds",
      answer:
        "Those are its polls of the queue: the instrumentation sends one for each poll, including those that find no job. Busy queues are dominated by the `process` spans of their jobs; for quiet ones, drop the `receive` spans with a [drop filter](/docs/telemetry/drop-filters-and-scrub-rules).",
    },
    {
      question: "Every query of a request shows the session's table",
      answer:
        "Routes in `routes/web.php` start a session, and with `SESSION_DRIVER=database` each request reads and writes the `sessions` table. An API's routes in `routes/api.php` start none.",
    },
  ],

  faq: [
    {
      question: "Do I need to change my code?",
      answer:
        "No: requests, Eloquent, queries, the Http client and the Log facade are traced as they are. Code is needed only for spans and metrics of your own.",
    },
    {
      question: "Are Artisan commands traced?",
      answer:
        "Yes, when they run with the variables set: each is a span of its own, such as `Command migrate`, with the queries it ran beneath it. Leave the variables out of a deploy step's environment if its migrations should not be traced.",
    },
    {
      question: "Which versions is this checked with?",
      answer:
        "Laravel 13.39 on PHP 8.5, with the extension 1.4, the SDK 1.15 and `opentelemetry-auto-laravel` 1.10, which supports Laravel 10 to 13.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: every request sends straight to OneUptime as it ends. A Collector beside each web server lets requests hand off their telemetry over the local network, and keeps the key in one place: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["php", "symfony", "slim", "rails"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.exceptions],

  verification: {
    runtime: "php",
    framework: { name: "Laravel", package: "laravel/framework" },
    ...appRun(),
    environmentSnippets: ["flatten-logs", "excluded-urls"],
    expect: {
      spans: [
        {
          name: "GET /api/orders/{order}",
          attributes: { "http.response.status_code": "200" },
        },
        {
          name: "GET /api/orders/{order}",
          attributes: { "http.response.status_code": "404" },
          hasException: false,
        },
        { name: "App\\Models\\Order::get", parent: "GET /api/orders/{order}" },
        { name: "sql SELECT", parent: "App\\Models\\Order::get" },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
          parent: "POST /api/orders",
        },
        {
          name: "POST",
          attributes: { "url.path": "/api/charges" },
          parent: "checkout.charge",
        },
        { name: "App\\Models\\Order::create", parent: "checkout.charge" },
        { name: "sql INSERT", parent: "App\\Models\\Order::create" },
        {
          name: "GET /api/orders/{order}/receipt",
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
          attributes: { "order.id": "42" },
        },
        {
          body: "the receipt printer is offline for order 42",
          hasTraceContext: true,
          hasException: true,
        },
      ],
      resource: { "service.name": "storefront" },
      untracedPaths: ["/up"],
    },
  },
};
