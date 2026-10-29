import {
  OpenTelemetryGuide,
  GuideSnippet,
  GuideVerificationRun,
  VerificationRequest,
} from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  redisService,
  validateKeyStep,
} from "../GuideShared";
import { blockOf } from "../GuideSnippets";
import {
  BUNDLE_INSTALL_SNIPPET,
  RUBY_PREREQUISITE,
  gemfileSnippet,
  rubyDockerfileSnippet,
  rubyTelemetrySnippet,
} from "../RubyShared";

/*
 * A Sinatra app under Puma: a catalog API that caches products in Redis
 * and fetches the ones it misses from another service. telemetry.rb starts
 * the SDK before config.ru loads the app, Sinatra's instrumentation adds
 * Rack's tracing middleware and names each span after its route, and a
 * Rack middleware of the app's own records the request durations Ruby's
 * instrumentations leave out. Checked under Puma alone and with forked
 * workers, the second with export delays longer than the run, so what
 * arrives is what each worker sends as Puma stops it.
 */

const gemfile: GuideSnippet = gemfileSnippet(["sinatra", "puma", "redis"]);

const telemetry: GuideSnippet = rubyTelemetrySnippet({
  libraries: ["logger", "net/http", "redis", "sinatra/base"],
  configure: [
    "  # Every instrumentation, with the health check left out of the traces.",
    "  c.use_all(",
    '    "OpenTelemetry::Instrumentation::Rack" => { untraced_endpoints: ["/healthz"] }',
    "  )",
  ],
});

const configRu: GuideSnippet = {
  id: "config-ru",
  language: "ruby",
  title: "config.ru",
  code: [
    'require_relative "telemetry"',
    'require_relative "request_duration"',
    'require_relative "app"',
    "",
    "use RequestDuration",
    "run CatalogApp",
  ].join("\n"),
  check: "run",
};

const appFile: string = [
  'require "json"',
  "",
  "class CatalogApp < Sinatra::Base",
  '  TRACER = OpenTelemetry.tracer_provider.tracer("catalog-api")',
  '  CACHE_MISSES = OpenTelemetry.meter_provider.meter("catalog-api").create_counter(',
  '    "catalog.cache_misses", unit: "{miss}", description: "Products not found in Redis"',
  "  )",
  "",
  "  configure do",
  '    set :redis, Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379"))',
  "    # The record's body is the line the formatter writes: the message alone.",
  "    logger = Logger.new($stdout)",
  '    logger.formatter = proc { |_severity, _time, _progname, message| "#{message}\\n" }',
  "    set :logger, logger",
  "  end",
  "",
  '  get "/healthz" do',
  '    "ok"',
  "  end",
  "",
  '  get "/products/:sku" do',
  "    sku = params[:sku]",
  '    settings.logger.info("loading product #{sku}")',
  '    cached = settings.redis.get("product:#{sku}")',
  "    return cached if cached",
  "",
  "    product = fetch_product(sku)",
  '    settings.redis.set("product:#{sku}", product, ex: 60)',
  "    content_type :json",
  "    product",
  "  end",
  "",
  '  get "/products/:sku/stock" do',
  "    # Recorded on the request's span; Sinatra answers it with a 500.",
  '    raise IOError, "the stock service did not answer for #{params[:sku]}"',
  "  end",
  "",
  "  helpers do",
  "    def fetch_product(sku)",
  '      TRACER.in_span("catalog.fetch", attributes: { "product.sku" => sku }) do',
  '        CACHE_MISSES.add(1, attributes: { "cache.name" => "products" })',
  '        catalog = ENV.fetch("CATALOG_API_URL", "http://localhost:9000")',
  '        Net::HTTP.get(URI("#{catalog}/api/products/#{sku}"))',
  "      end",
  "    end",
  "  end",
  "end",
].join("\n");

const app: GuideSnippet = {
  id: "app",
  language: "ruby",
  title: "app.rb",
  code: appFile,
  check: "run",
};

const fetchProduct: GuideSnippet = {
  id: "fetch-product",
  language: "ruby",
  title: "app.rb",
  code: blockOf(appFile, "def fetch_product(", "end"),
  check: "contained",
};

const loggerSetup: GuideSnippet = {
  id: "logger",
  language: "ruby",
  title: "app.rb",
  code: blockOf(appFile, "configure do", "end"),
  check: "contained",
};

const requestDuration: GuideSnippet = {
  id: "request-duration",
  language: "ruby",
  title: "request_duration.rb",
  code: [
    "# Ruby's instrumentations send no metrics: this middleware records each",
    "# request's duration, by route, under the name other OpenTelemetry SDKs use.",
    "OpenTelemetry.meter_provider.add_view(",
    '  "http.server.request.duration",',
    "  aggregation: OpenTelemetry::SDK::Metrics::Aggregation::ExplicitBucketHistogram.new(",
    "    boundaries: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]",
    "  )",
    ")",
    "",
    "class RequestDuration",
    '  DURATION = OpenTelemetry.meter_provider.meter("catalog-api").create_histogram(',
    '    "http.server.request.duration", unit: "s", description: "Duration of HTTP server requests"',
    "  )",
    "",
    "  def initialize(app)",
    "    @app = app",
    "  end",
    "",
    "  def call(env)",
    "    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)",
    "    status, headers, body = @app.call(env)",
    '    attributes = { "http.request.method" => env["REQUEST_METHOD"],',
    '                   "http.response.status_code" => status }',
    '    # Sinatra names the route that matched: "GET /products/:sku".',
    '    attributes["http.route"] = env["sinatra.route"].split(" ", 2).last if env["sinatra.route"]',
    "    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started",
    "    DURATION.record(elapsed, attributes: attributes)",
    "    [status, headers, body]",
    "  end",
    "end",
  ].join("\n"),
  check: "run",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "bundle exec puma",
  check: "run",
};

const runWorkers: GuideSnippet = {
  id: "run-workers",
  language: "bash",
  title: "Two workers, forked once the app has loaded",
  code: "bundle exec puma --workers 2 --preload",
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

const exportFailed: GuideSnippet = {
  id: "export-failed",
  language: "text",
  title: "What Puma's output shows",
  code: [
    "OpenTelemetry error: Unable to export 12 spans",
    "OpenTelemetry error: Failed to open TCP connection to localhost:4318",
  ].join("\n"),
  check: "illustrative",
};

/*
 * Export intervals longer than the run: what arrives from the workers is
 * what each sends from its at_exit hook as Puma stops it.
 */
const SENT_AT_EXIT: Record<string, string> = {
  OTEL_BSP_SCHEDULE_DELAY: "30000",
  OTEL_BLRP_SCHEDULE_DELAY: "30000",
  OTEL_METRIC_EXPORT_INTERVAL: "60000",
};

const REQUESTS: Array<VerificationRequest> = [
  { method: "GET", path: "/healthz" },
  // A cache miss, then a hit.
  { method: "GET", path: "/products/KETTLE-3" },
  { method: "GET", path: "/products/KETTLE-3" },
  { method: "GET", path: "/products/KETTLE-3/stock" },
  { method: "GET", path: "/nowhere" },
];

function appRun(
  runSnippet: string,
  environment: Record<string, string> | undefined,
): Pick<
  GuideVerificationRun,
  "files" | "commands" | "port" | "requests" | "stubApiPort" | "services"
> {
  return {
    files: [
      { path: "Gemfile", snippet: "gemfile" },
      { path: "telemetry.rb", snippet: "telemetry" },
      { path: "request_duration.rb", snippet: "request-duration" },
      { path: "app.rb", snippet: "app" },
      { path: "config.ru", snippet: "config-ru" },
    ],
    stubApiPort: 9000,
    services: [redisService({ REDIS_URL: "redis://127.0.0.1:{port}/0" })],
    commands: [
      { snippet: "bundle-install" },
      { snippet: runSnippet, isServer: true, environment: environment },
    ],
    port: 9292,
    requests: REQUESTS,
  };
}

export const SinatraGuide: OpenTelemetryGuide = {
  slug: "sinatra",
  seo: {
    title: "Sinatra OpenTelemetry: Tracing, Redis and Puma | OneUptime",
    description:
      "Add OpenTelemetry to a Sinatra app: a span per route with Redis and HTTP calls beneath, request duration by route, and Logger records with trace IDs, on Puma.",
  },
  h1: "OpenTelemetry for Sinatra",
  lead: "Trace every request your Sinatra app serves, named after the route that matched, with the Redis commands and HTTP calls it makes beneath, and send traces, metrics and logs to OneUptime. One file starts the SDK before `config.ru` loads the app, and a small Rack middleware records the request durations Ruby's instrumentations leave out.",
  cardDescription:
    "Sinatra on Puma: a span named after each route, Redis and Net::HTTP beneath it, request duration by route, Logger records.",
  searchTerms: ["rack", "puma", "config.ru", "redis", "modular"],
  highlights: [
    "Spans named after routes",
    "Request duration by route",
    "Puma workers",
  ],

  whatYouGet: {
    intro: `Each request becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, listed in ${SCREENS.services} from its first request. The example is a catalog API on Sinatra and Puma that caches products in Redis and reads the ones it misses from another service.`,
    traces:
      "A server span per request, named after the route that matched, such as `GET /products/:sku`, with a span for each Redis command and each `Net::HTTP` call beneath it, and `traceparent` sent on to the service called.",
    metrics:
      "`http.server.request.duration` by route, method and status, from the middleware below, and instruments of your own, such as a count of cache misses. Ruby's instrumentations send no metrics themselves.",
    logs: "Each `Logger` record written while a request is served, at its severity, carrying that request's trace and span IDs.",
    exceptions: `An exception a route raises is answered with a 500 by Sinatra and recorded on the request's span with its type, message and stack trace; the span is marked failed, and ${SCREENS.exceptions} lists the exception.`,
  },

  exampleTrace: {
    caption:
      "A request for a product Redis did not hold, as its trace shows it",
    spans: [
      {
        name: "GET /products/:sku",
        depth: 0,
        start: 0,
        duration: 100,
        source: "rack",
      },
      { name: "GET", depth: 1, start: 4, duration: 6, source: "redis" },
      {
        name: "catalog.fetch",
        depth: 1,
        start: 13,
        duration: 62,
        source: "your code",
      },
      { name: "GET", depth: 2, start: 17, duration: 54, source: "net_http" },
      { name: "SET", depth: 1, start: 79, duration: 7, source: "redis" },
    ],
  },

  prerequisites: [
    RUBY_PREREQUISITE,
    "A Sinatra 4 app built on `Sinatra::Base`, served by Puma through `config.ru`. Building with Rails? Its guide covers what is particular to it.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add OpenTelemetry's gems beside Sinatra's in your `Gemfile`, at the versions this guide was checked with, then install them:",
    snippets: [gemfile, BUNDLE_INSTALL_SNIPPET],
    notes: [
      "`opentelemetry-instrumentation-all` brings the Sinatra and Rack instrumentations, and those for Redis and `Net::HTTP`; the one for `Logger` comes in a gem of its own.",
    ],
  },

  configure: {
    intro:
      "Set the endpoint, the key and the service's name as the standard OpenTelemetry variables, in the environment Puma starts in:",
    tabs: otlpEnvironmentTabs({ serviceName: "catalog-api" }),
    notes: [
      "Puma's workers are forked from it, so they inherit the same variables: one set covers every worker.",
    ],
  },

  setup: {
    intro:
      "Start the SDK in a file of its own and require it first in `config.ru`. Sinatra's instrumentation then adds the tracing middleware to the app by itself: the routes need no change.",
    steps: [
      {
        title: "Add a file that starts OpenTelemetry",
        body: "Require the libraries the app uses, Sinatra among them, then the SDK. `use_all` takes options for each instrumentation by its name, here the health check Rack's leaves untraced:",
        snippets: [telemetry],
        notes: [
          "Sinatra has to be loaded before the configure block runs: its instrumentation, and the Rack one it installs with it, are set up only for a library that is already there.",
        ],
      },
      {
        title: "Require it first in config.ru",
        body: "Above the app, so every library is traced from its first call. `RequestDuration`, from the metrics section, wraps the app to time each request:",
        snippets: [configRu],
      },
      {
        title: "Write the routes as usual",
        body: "The request's span is opened and named for you. This app caches products in Redis, and fetches one Redis does not hold in a span of its own:",
        snippets: [app],
      },
      {
        title: "Run it with Puma",
        body: "With the variables above exported, start Puma, which serves `config.ru` on port 9292:",
        snippets: [run],
        notes: [
          "On SIGTERM or Ctrl-C, Puma finishes the requests in flight and exits through the `at_exit` hook, which sends what the SDK still holds.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "Sinatra's instrumentation installs Rack's, which opens a span per request, and renames that span after the route. With the gems above, a request's trace holds:",
    rows: [
      {
        library: "Sinatra and Rack",
        covers:
          "A server span per request, named after the route that matched (`GET /products/:sku`), with `http.route` and the status code, and the exception of a route that raised. A request no route matched keeps the method alone, `GET`.",
      },
      {
        library: "`redis`",
        covers:
          "A span per command, named after it (`GET`, `SET`), with the command in `db.statement`, keys and values replaced by `?`; a `PIPELINED` span as each connection opens.",
      },
      {
        library: "`Net::HTTP`",
        covers:
          "A client span per call, named after its method, with `url.path` and the status code, and `traceparent` sent along so the service called joins the trace.",
      },
      {
        library: "`Logger`",
        covers:
          "Each record, with the trace and span IDs of the request it was written in.",
      },
    ],
    snippets: [],
    notes: [
      "Rack's options go in `use_all`'s map under its name, as `untraced_endpoints` does in `telemetry.rb`: the paths it lists, matched exactly, get no span.",
    ],
  },

  manualSpans: {
    intro:
      "Wrap work of your own in `in_span`, from a tracer created once in the class. A span opened inside a route nests under the request's, and the calls inside it nest under it:",
    snippets: [fetchProduct],
    notes: [
      "`in_span` returns what its block returns, so `fetch_product` hands back the product, and the span ends with the block.",
      "An exception raised in the block marks the span failed and is recorded on it, then goes on up to the route, which Sinatra answers with a 500.",
      "Search the span's attributes in the **Traces** explorer, such as `@product.sku:KETTLE-3`.",
    ],
  },

  logs: {
    intro:
      "Give the app a `Logger` in `configure`, and write through `settings.logger`. Each record a request writes carries its trace and span IDs:",
    snippets: [loggerSetup],
    notes: [
      "The formatter writes the message alone, because the record's body is the line it writes, and the record holds the time and the severity already.",
      "Sinatra prints a route's exception and its backtrace to Puma's error stream, which is no `Logger`: that exception reaches OneUptime on the request's span instead.",
    ],
  },

  metrics: {
    intro:
      "Ruby's instrumentations send no metrics, so the request durations other SDKs send come from a Rack middleware of your own. This one records each request under the name and attributes OpenTelemetry's conventions give it:",
    builtIn: [],
    snippets: [requestDuration],
    notes: [
      "The view sets the histogram's buckets in seconds. Without it, the Ruby SDK's default buckets run from 0 to 1000, sized for milliseconds, and every request would land in the first.",
      '`env["sinatra.route"]` is set once a route matched, so a request no route matched is recorded without `http.route`.',
      "`CACHE_MISSES`, in `app.rb`, counts the products fetched from the catalog. Its `cache.name` attribute makes a series per value: keep such values to a few.",
    ],
  },

  sampling: {
    intro:
      "The health check is already left out, by `untraced_endpoints`. To keep a share of the other requests' traces, set the standard sampler variables:",
    snippets: [sampling],
    notes: [
      "A request that arrives with `traceparent` is kept or dropped as its caller decided; of the rest, `parentbased_traceidratio` keeps one in four.",
      "The duration histogram and the cache counter still count every request: sampling drops spans, not measurements.",
    ],
  },

  deploy: {
    intro:
      "In production, run Puma with workers, forked once the app has loaded; make that the image's command, and give the Deployment the key from a Secret:",
    snippets: [
      runWorkers,
      rubyDockerfileSnippet({
        command: ["bundle", "exec", "puma", "--workers", "2", "--preload"],
        port: 9292,
        environment: { RACK_ENV: "production" },
      }),
      kubernetesManifestSnippet({
        name: "catalog-api",
        image: "registry.example.com/catalog-api:2.1.0",
        containerPort: 9292,
        extraEnv: [{ name: "REDIS_URL", value: "redis://redis:6379/0" }],
      }),
    ],
    notes: [
      "With `--preload`, Puma loads `config.ru`, and the SDK with it, once, then forks the workers: the SDK carries on in each, and each sends what it holds as Puma stops it.",
      "Kubernetes sends SIGTERM before it stops a pod: Puma stops its workers gracefully, so their `at_exit` hooks run well within the 30 seconds it waits.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Ask for a product, with \`curl localhost:9292/products/KETTLE-3\`, then open ${SCREENS.services}: \`catalog-api\` appears within a minute of the request.`,
      },
      {
        title: "Open a request's trace",
        body: `In ${SCREENS.traces}, search for \`GET /products/:sku\`: the first request's trace holds Redis' \`GET\`, then \`catalog.fetch\` with its HTTP call, then the \`SET\` that caches the product; the second, a cache hit, holds the \`GET\` alone.`,
      },
      {
        title: "Find the exception",
        body: `Request \`/products/KETTLE-3/stock\`: ${SCREENS.exceptions} lists the \`IOError\` its route raised, and the request's span is marked failed.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Some spans are named GET, with no route",
      answer:
        "No route matched those requests, as for a 404, so Sinatra had no route to name them after. They keep the method alone, and `http.route` is left out of the span and of the duration recorded for them.",
    },
    {
      question: "Sinatra's spans never arrive, though Redis' do",
      answer:
        "Sinatra was loaded after `OpenTelemetry::SDK.configure`. As Puma starts, the SDK prints a line for each instrumentation it installs: with `OpenTelemetry::Instrumentation::Sinatra` missing from them, require `sinatra/base` in `telemetry.rb`, above the configure block.",
    },
    {
      question: "The last requests before a deploy never arrive",
      answer:
        "Puma was killed before its workers stopped, so their `at_exit` hooks never ran: a SIGKILL, or a pod stopped with no grace period. Let Puma shut down on SIGTERM, and keep `terminationGracePeriodSeconds` above the time your slowest request takes.",
    },
    {
      question: "Nothing arrives, and Puma prints “Unable to export”",
      answer:
        "The exporters reach nothing at the endpoint: with `OTEL_EXPORTER_OTLP_ENDPOINT` missing from Puma's environment, they try `localhost:4318`:",
      snippets: [exportFailed],
    },
    {
      question: "Puma prints “unexpected error decoding rpc.Status”",
      answer:
        "OneUptime refused the key, and the exporter cannot read its JSON answer as protobuf. `OTEL_EXPORTER_OTLP_HEADERS` must read `x-oneuptime-token=` and the **Secret Key** of a **Server** key from the project you look at.",
    },
  ],

  faq: [
    {
      question: "Does it work with Puma's workers?",
      answer:
        "Yes. With `--workers` and `--preload`, Puma loads the app, and the SDK with it, in its master, then forks; the SDK carries on in each worker, and each sends what it holds as it stops. This guide was checked with a single Puma and with two workers.",
    },
    {
      question: "Are the values I cache in Redis recorded?",
      answer:
        "No. Redis' instrumentation replaces each key and value in `db.statement` with `?`, as in `SET ? ? ? ?`. Setting `OTEL_RUBY_INSTRUMENTATION_REDIS_CONFIG_OPTS` to `db_statement=omit` leaves the statement out altogether.",
    },
    {
      question: "Which versions was this checked with?",
      answer:
        "Sinatra 4.2, Puma 8 and Ruby 4.0, with OpenTelemetry Ruby 1.13 and `opentelemetry-instrumentation-all` 0.99.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: Puma's workers send straight to OneUptime. A Collector is worth running when many apps should send through one place that holds the key and batches or filters for all of them: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["ruby", "rails", "flask", "express"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.metrics, DOCS.exceptions],

  verification: {
    runtime: "ruby",
    framework: { name: "Sinatra", package: "sinatra" },
    ...appRun("run", undefined),
    expect: {
      spans: [
        {
          name: "GET /products/:sku",
          attributes: {
            "http.route": "/products/:sku",
            "http.response.status_code": "200",
          },
        },
        { name: "GET", parent: "GET /products/:sku" },
        { name: "SET", parent: "GET /products/:sku" },
        {
          name: "catalog.fetch",
          attributes: { "product.sku": "KETTLE-3" },
          parent: "GET /products/:sku",
        },
        {
          name: "GET",
          attributes: { "url.path": "/api/products/KETTLE-3" },
          parent: "catalog.fetch",
        },
        {
          name: "GET /products/:sku/stock",
          hasException: true,
          exceptionMessage: "the stock service did not answer for KETTLE-3",
        },
      ],
      metrics: ["http.server.request.duration", "catalog.cache_misses"],
      logs: [{ body: "loading product KETTLE-3", hasTraceContext: true }],
      resource: { "service.name": "catalog-api" },
      untracedPaths: ["/healthz"],
    },
    variants: [
      {
        // Two forked workers, each sending what it holds as Puma stops it.
        name: "Puma workers",
        ...appRun("run-workers", SENT_AT_EXIT),
        expect: {
          spans: [
            {
              name: "GET /products/:sku",
              attributes: { "http.route": "/products/:sku" },
            },
            { name: "catalog.fetch", parent: "GET /products/:sku" },
            { name: "GET /products/:sku/stock", hasException: true },
          ],
          metrics: ["http.server.request.duration", "catalog.cache_misses"],
          logs: [{ body: "loading product KETTLE-3", hasTraceContext: true }],
          untracedPaths: ["/healthz"],
        },
      },
    ],
  },
};
