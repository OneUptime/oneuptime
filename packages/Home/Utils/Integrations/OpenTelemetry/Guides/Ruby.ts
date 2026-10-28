import {
  OpenTelemetryGuide,
  GuideSnippet,
  GuideVerificationRun,
  VerificationFile,
} from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesCronJobSnippet,
  otlpEnvironmentTabs,
  postgresService,
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
 * Any Ruby program, framework or not: a job that imports a supplier's
 * prices into PostgreSQL, one trace per run. telemetry.rb starts the SDK,
 * use_all traces Net::HTTP and pg, Ruby's Logger sends its records, and an
 * at_exit hook sends what is left. Checked with export delays longer than
 * the run, so what arrives is what the job sends as it ends.
 */

const gemfile: GuideSnippet = gemfileSnippet(["pg"]);

const telemetry: GuideSnippet = rubyTelemetrySnippet({
  libraries: ["logger", "net/http", "pg"],
});

const importFile: string = [
  'require_relative "telemetry"',
  'require "json"',
  "",
  "MINIMUM_PRICE = 100",
  "",
  "# The record's body is the line the formatter writes: here the message alone,",
  "# since the record carries its own time and severity.",
  "LOGGER = Logger.new($stdout, formatter: proc { |_severity, _time, _progname, message|",
  '  "#{message}\\n"',
  "})",
  'TRACER = OpenTelemetry.tracer_provider.tracer("price-import")',
  'PRICES_IMPORTED = OpenTelemetry.meter_provider.meter("price-import").create_counter(',
  '  "prices.imported", unit: "{price}", description: "Prices imported from the supplier"',
  ")",
  "",
  "def fetch_prices",
  '  supplier = ENV.fetch("SUPPLIER_API_URL", "http://localhost:9000")',
  '  JSON.parse(Net::HTTP.get(URI("#{supplier}/api/prices")))["items"]',
  "end",
  "",
  "def save_price(db, price)",
  '  TRACER.in_span("price.save", attributes: { "price.sku" => price["id"] }) do',
  "    # Raised inside the block, it is recorded on the span, then raised again.",
  '    if price["total"] < MINIMUM_PRICE',
  '      raise ArgumentError, "#{price["id"]} is below the minimum price"',
  "    end",
  "",
  "    db.exec_params(",
  '      "INSERT INTO prices (sku, amount) VALUES ($1, $2) " \\',
  '      "ON CONFLICT (sku) DO UPDATE SET amount = EXCLUDED.amount",',
  '      [price["id"], price["total"]]',
  "    )",
  "  end",
  "  true",
  "rescue ArgumentError => error",
  '  LOGGER.warn("skipped a price: #{error.message}")',
  "  false",
  "end",
  "",
  "# One run, one trace: the call to the supplier and every INSERT beneath it.",
  'TRACER.in_span("prices.import") do |span|',
  '  db = PG.connect(ENV.fetch("DATABASE_URL"))',
  "  prices = fetch_prices",
  '  span.set_attribute("price.count", prices.length)',
  "",
  "  imported = prices.count { |price| save_price(db, price) }",
  '  PRICES_IMPORTED.add(imported, attributes: { "supplier" => "acme" })',
  '  LOGGER.info("imported #{imported} of #{prices.length} prices")',
  "end",
].join("\n");

const importPrices: GuideSnippet = {
  id: "import-prices",
  language: "ruby",
  title: "import_prices.rb",
  code: importFile,
  check: "run",
};

const savePrice: GuideSnippet = {
  id: "save-price",
  language: "ruby",
  title: "import_prices.rb",
  code: blockOf(importFile, "def save_price(", "end"),
  check: "contained",
};

const loggerSetup: GuideSnippet = {
  id: "logger",
  language: "ruby",
  title: "import_prices.rb",
  code: blockOf(importFile, "# The record's body is the line", "})"),
  check: "contained",
};

const counter: GuideSnippet = {
  id: "counter",
  language: "ruby",
  title: "import_prices.rb",
  code: blockOf(importFile, "PRICES_IMPORTED = ", ")"),
  check: "contained",
};

// The table the job writes to; the page leaves its schema to the reader.
const CREATE_TABLE: string = [
  'require "pg"',
  "",
  'PG.connect(ENV.fetch("DATABASE_URL")).exec(',
  '  "CREATE TABLE IF NOT EXISTS prices (sku TEXT PRIMARY KEY, amount INTEGER)"',
  ")",
].join("\n");

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "bundle exec ruby import_prices.rb",
  check: "run",
};

const disableInstrumentation: GuideSnippet = {
  id: "disable-instrumentation",
  language: "bash",
  code: [
    "# Leave one instrumentation out, by its name...",
    'export OTEL_RUBY_INSTRUMENTATION_NET_HTTP_ENABLED="false"',
    "# ...or set its options, name=value pairs separated by semicolons.",
    'export OTEL_RUBY_INSTRUMENTATION_PG_CONFIG_OPTS="db_statement=omit"',
  ].join("\n"),
  check: "run",
};

const sdkLogLevel: GuideSnippet = {
  id: "sdk-log-level",
  language: "bash",
  title: "Environment",
  code: 'export OTEL_LOG_LEVEL="warn"',
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

const connectionRefused: GuideSnippet = {
  id: "connection-refused",
  language: "text",
  title: "What the job logs",
  code: [
    "OpenTelemetry error: Unable to export 7 spans",
    "OpenTelemetry error: Failed to open TCP connection to localhost:4318",
    '  (Connection refused - connect(2) for "localhost" port 4318)',
  ].join("\n"),
  check: "illustrative",
};

const keyRefused: GuideSnippet = {
  id: "key-refused",
  language: "text",
  title: "What the job logs",
  code: [
    "OpenTelemetry error: unexpected error decoding rpc.Status in",
    "  OTLP::Exporter#log_status - Error occurred during parsing",
    "OpenTelemetry error: Unable to export 7 spans",
  ].join("\n"),
  check: "illustrative",
};

/*
 * Export intervals longer than the job runs: what arrives is what the
 * at_exit hook sends as the job ends, not what a timer sent along the way.
 */
const SENT_AT_EXIT: Record<string, string> = {
  OTEL_BSP_SCHEDULE_DELAY: "30000",
  OTEL_BLRP_SCHEDULE_DELAY: "30000",
  OTEL_METRIC_EXPORT_INTERVAL: "60000",
};

const JOB_FILES: Array<VerificationFile> = [
  { path: "Gemfile", snippet: "gemfile" },
  { path: "telemetry.rb", snippet: "telemetry" },
  { path: "import_prices.rb", snippet: "import-prices" },
  { path: "create_table.rb", content: CREATE_TABLE },
];

function jobRun(): Pick<
  GuideVerificationRun,
  "files" | "commands" | "requests" | "stubApiPort" | "services"
> {
  return {
    files: JOB_FILES,
    stubApiPort: 9000,
    services: [
      postgresService({
        DATABASE_URL:
          "postgres://shop:shop@127.0.0.1:{port}/shop?sslmode=disable",
      }),
    ],
    commands: [
      { snippet: "bundle-install" },
      { command: "bundle exec ruby create_table.rb" },
      { snippet: "run", environment: SENT_AT_EXIT },
    ],
    requests: [],
  };
}

export const RubyGuide: OpenTelemetryGuide = {
  slug: "ruby",
  seo: {
    title: "Ruby OpenTelemetry: Traces, Metrics and Logs | OneUptime",
    description:
      "Instrument any Ruby program with OpenTelemetry: the SDK and use_all in one file, Net::HTTP and pg spans, Logger records with trace IDs, sent to OneUptime.",
  },
  h1: "OpenTelemetry for Ruby",
  lead: "Send traces, metrics and logs from any Ruby program to OneUptime: a script, a scheduled job, a worker, or a service on a framework with no guide of its own. One file starts the SDK, `use_all` traces the libraries the program loads, and an `at_exit` hook sends what is left as Ruby exits.",
  cardDescription:
    "Any Ruby script, job or service: one file starts the SDK, use_all traces its libraries, and Logger sends its records.",
  searchTerms: ["script", "cron", "use_all", "net::http", "logger", "bundler"],
  highlights: [
    "One file starts the SDK",
    "Logger with trace IDs",
    "Ruby 3.3 and later",
  ],

  whatYouGet: {
    intro: `A Ruby program reports as one service, named by \`OTEL_SERVICE_NAME\`, in ${SCREENS.services} once it first sends. The example is a scheduled job that imports a supplier's prices into PostgreSQL; a script, a worker or a service on a framework with no guide of its own is set up the same way.`,
    traces:
      "A span for each call made with `Net::HTTP`, Faraday or another client `use_all` knows, and for each statement sent through `pg` or `mysql2`, all in one trace per run under the span the job starts.",
    metrics:
      "The instruments you create from a meter, such as a counter of the prices imported. Ruby's instrumentations record spans only: none of them sends a metric of its own yet.",
    logs: "Every record written through Ruby's `Logger`, at its severity, with the trace and span IDs of the span it was written in. Its body is the line the logger's formatter writes.",
    exceptions: `An exception raised inside an \`in_span\` block is recorded on its span with the message, type and stack trace, marks the span failed, and is raised again. ${SCREENS.exceptions} lists each with its stack trace.`,
  },

  exampleTrace: {
    caption: "One run of the price import, as its trace shows it",
    spans: [
      {
        name: "prices.import",
        depth: 0,
        start: 0,
        duration: 100,
        source: "your code",
      },
      { name: "connect", depth: 1, start: 2, duration: 9, source: "pg" },
      { name: "GET", depth: 1, start: 13, duration: 31, source: "net_http" },
      {
        name: "price.save",
        depth: 1,
        start: 47,
        duration: 26,
        source: "your code",
      },
      {
        name: "INSERT shop",
        depth: 2,
        start: 49,
        duration: 22,
        source: "pg",
      },
      {
        name: "price.save",
        depth: 1,
        start: 76,
        duration: 7,
        source: "your code",
        isError: true,
      },
    ],
  },

  prerequisites: [
    RUBY_PREREQUISITE,
    "A Ruby program whose gems Bundler installs: a script, a scheduled job, a worker, or a service on a framework this site has no guide for. Building with Rails or Sinatra? Their guides cover what is particular to them.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add the SDK and its OTLP exporter, every instrumentation in one gem, the metrics and logs SDKs with their exporters, and the bridge for `Logger` to your `Gemfile`, at the versions this guide was checked with, then install them:",
    snippets: [gemfile, BUNDLE_INSTALL_SNIPPET],
    notes: [
      "`pg` is the job's own gem: keep yours, and add the OpenTelemetry lines beneath them.",
      "Tracing is stable in OpenTelemetry Ruby; the metrics and logs SDKs are still 0.x releases, each with an exporter gem of its own, so upgrade the whole set together.",
      "`opentelemetry-instrumentation-all` depends on every instrumentation gem, and installs each only for a library your program loads. `Logger`'s is not among them, hence the gem of its own.",
    ],
  },

  configure: {
    intro:
      "The SDK reads the endpoint, the key and the service's name from the standard OpenTelemetry variables, so none of them is written into the program:",
    tabs: otlpEnvironmentTabs({ serviceName: "price-import" }),
    notes: [
      "The OTLP exporter gems send protobuf over HTTP, which is what the `/otlp` endpoint takes, and add each signal's path, such as `/v1/traces`, to the endpoint themselves.",
    ],
  },

  setup: {
    intro:
      "Ruby has no agent to start with: one file sets the SDK up before the rest of the program loads, and a hook sends what is left as the program exits.",
    steps: [
      {
        title: "Add a file that starts OpenTelemetry",
        body: "Require the libraries you trace, then the SDK and its exporters, and call `OpenTelemetry::SDK.configure` with `use_all`. The `at_exit` hook shuts each provider down, which sends what it still holds:",
        snippets: [telemetry],
        notes: [
          "The order matters: `use_all` installs an instrumentation only for a library that is already loaded, so `pg` and `net/http` are required above it. A gem first required further down the program is not traced.",
          "A program that leaves through `exit!`, or is killed with SIGKILL, skips `at_exit`: what the SDK held is lost.",
        ],
      },
      {
        title: "Load it first, and start a span for each run",
        body: "Require it before anything else. Nothing starts a trace in a job, so the run is wrapped in a span of its own, and every call made inside becomes its child:",
        snippets: [importPrices],
        notes: [
          "`save_price`, in the next section, gives each price a span of its own beneath the run's.",
        ],
      },
      {
        title: "Run it",
        body: "With the variables above exported, run the job through Bundler:",
        snippets: [run],
        notes: [
          "A run's spans, metrics and log records leave as it ends, in the `at_exit` hook, so a job that lasts a second is seen whole.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "`use_all` installs the instrumentation of each library your program has loaded, and leaves the rest. With the job above, a run's trace holds:",
    rows: [
      {
        library: "`Net::HTTP`",
        covers:
          "A client span per request, named after its method (`GET`), with `url.path` and the status code, and `traceparent` sent along so the service called joins the trace; a `connect` span when a connection opens.",
      },
      {
        library: "`pg`",
        covers:
          "A span per statement, named after its operation and database (`INSERT shop`), with the SQL in `db.statement`, its values replaced by `?`, and a `connect` span for each new connection.",
      },
      {
        library: "`Logger`",
        covers:
          "Each record as a log, at its severity, with the trace and span IDs of the span it was written in.",
      },
      {
        library: "Faraday, HTTP.rb, `mysql2`, Redis, Sidekiq and 30 more",
        covers:
          "The same for each library loaded: spans for the requests sent, the queries run and the jobs worked. As the SDK starts, it prints a line for each instrumentation it installs.",
      },
    ],
    snippets: [disableInstrumentation],
    notes: [
      "Each instrumentation reads two variables named after it: `OTEL_RUBY_INSTRUMENTATION_<NAME>_ENABLED=false` leaves it out, and `OTEL_RUBY_INSTRUMENTATION_<NAME>_CONFIG_OPTS` sets its options, such as the SQL left off `pg`'s spans:",
    ],
  },

  manualSpans: {
    intro:
      "Wrap work no library knows about in `in_span`, from a tracer you create once. Code inside the block, and each call it makes, nests beneath the span:",
    snippets: [savePrice],
    notes: [
      "An exception that leaves the block is recorded as an `exception` event, with its type, message and stack trace, and marks the span failed. One you rescue inside the block is not: call `span.record_exception(error)`, and set `span.status = OpenTelemetry::Trace::Status.error(error.message)`.",
      "`attributes:` sets them as the span starts, and `span.set_attribute` adds one later, as the run's `price.count` is added. Search them in the **Traces** explorer, such as `@price.sku:inv_2`.",
      "Each tracer carries a name, shown as its spans' scope: name it after the program, and create it once, at load time, rather than for each call.",
    ],
  },

  logs: {
    intro:
      "Log with Ruby's `Logger` as you already do. The instrumentation sends each record a logger writes, with the trace and span IDs of the span that is current:",
    snippets: [loggerSetup, sdkLogLevel],
    notes: [
      "The record's body is the whole line the formatter writes. Ruby's default formatter starts it with the time, the severity and the process ID, which the record already carries: a formatter that writes the message alone keeps the body to what was said.",
      "A record written outside any span, such as one at start-up, carries no trace ID.",
      "The SDK writes its own lines through a `Logger` too, so some of them arrive as records: the line for each instrumentation installed after `Logger`'s, and any export error. `OTEL_LOG_LEVEL=warn`, set as above, keeps its warnings and errors only.",
    ],
  },

  metrics: {
    intro:
      "Ruby's instrumentations record spans and no metrics, so what a Ruby program sends is what it records itself. Create an instrument once, from a meter, then add to it where the work happens, as the run's block does with the count it imported:",
    builtIn: [],
    snippets: [counter],
    notes: [
      "`create_counter`, `create_histogram`, `create_up_down_counter` and `create_gauge` make the four kinds; the SDK exports them every 60 seconds, and once more in the `at_exit` hook.",
      "Attributes split a metric into series, one for each distinct value: keep them to a few known values, such as the supplier, and never an ID.",
    ],
  },

  sampling: {
    intro:
      "A job that runs every few minutes sends a trace each time. To keep only a share of them, set the standard sampler variables:",
    snippets: [sampling],
    notes: [
      "With `parentbased_traceidratio`, a quarter of the runs are kept, picked by trace ID, and work started by a traced caller follows that caller's choice.",
      "Sampling drops spans only: `prices.imported` still counts every run's prices, and every log record is still sent.",
    ],
  },

  deploy: {
    intro:
      "Install the gems in the Ruby image and run the job as its command; schedule it as a Kubernetes CronJob, with the key in a Secret:",
    snippets: [
      rubyDockerfileSnippet({
        command: ["bundle", "exec", "ruby", "import_prices.rb"],
      }),
      kubernetesCronJobSnippet({
        name: "price-import",
        image: "registry.example.com/price-import:1.0.0",
        schedule: "0 * * * *",
      }),
    ],
    notes: [
      "Give the job its `DATABASE_URL` the way your other workloads get theirs, from a Secret of its own.",
      "Each scheduled run is a pod that starts, sends its telemetry from the `at_exit` hook as the job ends, and is gone: nothing is lost between runs.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Run the job once",
        body: `Then open ${SCREENS.services}: \`price-import\` is listed within a minute of the run's end. Nothing there? Read what the job printed as it started: a line for each instrumentation installed, and any export error after it.`,
      },
      {
        title: "Open the run's trace",
        body: `In ${SCREENS.traces}, search for \`prices.import\`: the supplier's \`GET\` sits beneath it, then a \`price.save\` for each price, the first with its \`INSERT shop\`, the second failed by the exception it raised.`,
      },
      {
        title: "Find the exception and the log line",
        body: `${SCREENS.exceptions} lists the \`ArgumentError\`, \`inv_2 is below the minimum price\`; in ${SCREENS.logs}, the record \`imported 1 of 2 prices\` opens the run that wrote it.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "A library's spans never arrive",
      answer:
        "It was loaded after `OpenTelemetry::SDK.configure` ran, and `use_all` installs only for what is already loaded. The SDK prints `Instrumentation: OpenTelemetry::Instrumentation::PG was successfully installed` for each one it installed: require a gem missing from those lines above the configure block.",
    },
    {
      question: "The job ends, and nothing arrives",
      answer:
        "Nothing sent what the SDK still held: the program has no `at_exit` hook, or left without running it, through `exit!` or a SIGKILL. The batches go every few seconds, so a short job ends before its first one.",
    },
    {
      question: "The program logs “unexpected configuration error”",
      answer:
        "The configure block raised, and the program carried on with no SDK, sending nothing. The rest of the line says why: `Use either use_all or use, but not both`, say, when the block calls both.",
    },
    {
      question:
        "The job takes a minute longer to end, and logs “Unable to export”",
      answer:
        "Nothing answers at the endpoint. With `OTEL_EXPORTER_OTLP_ENDPOINT` missing from the job's environment, the exporters send to `localhost:4318`, retry each batch before they give up, and the `at_exit` hook waits for them:",
      snippets: [connectionRefused],
    },
    {
      question: "The program logs “unexpected error decoding rpc.Status”",
      answer:
        "OneUptime refused the key. Its `401` answer is JSON, which the exporter tries to read as protobuf, so it reports the decoding error and then `Unable to export`. `OTEL_EXPORTER_OTLP_HEADERS` must be `x-oneuptime-token=` and a **Server** key's **Secret Key**:",
      snippets: [keyRefused],
    },
    {
      question: "Log bodies start with the time and “INFO -- :”",
      answer:
        "That is Ruby's default formatter: the instrumentation sends the line as the formatter writes it. Give the logger a formatter that writes the message alone, as `LOGGER` is given above.",
    },
  ],

  faq: [
    {
      question: "Can I trace only some libraries?",
      answer:
        "Yes. To leave a few out of `use_all`, set their `_ENABLED` variables to `false`, as above. To start from none, add the gem of each instrumentation you want, such as `opentelemetry-instrumentation-pg`, in place of `-all`, and name each in the configure block with `c.use` instead of `c.use_all`.",
    },
    {
      question: "Does this work for Rails or Sinatra?",
      answer:
        "The SDK and the gems are the same; where they start differs. Rails starts the SDK in an initializer, and Sinatra in its Rack app, as the [Rails](/integrations/opentelemetry/rails) and [Sinatra](/integrations/opentelemetry/sinatra) guides show.",
    },
    {
      question: "Which Ruby versions are supported?",
      answer:
        "Ruby 3.3 and later: every OpenTelemetry gem above requires it. This guide was checked with Ruby 4.0.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No. Each run sends straight to OneUptime over HTTPS. A Collector earns its place when you would rather keep the key in one spot, or batch and filter what many programs send: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["rails", "sinatra", "python", "go"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.exceptions],

  verification: {
    runtime: "ruby",
    framework: { name: "Ruby" },
    ...jobRun(),
    expect: {
      spans: [
        { name: "prices.import", attributes: { "price.count": "2" } },
        {
          name: "GET",
          attributes: {
            "http.request.method": "GET",
            "url.path": "/api/prices",
          },
          parent: "prices.import",
        },
        {
          name: "price.save",
          attributes: { "price.sku": "inv_1" },
          hasException: false,
          parent: "prices.import",
        },
        {
          name: "price.save",
          attributes: { "price.sku": "inv_2" },
          hasException: true,
          exceptionMessage: "inv_2 is below the minimum price",
        },
        {
          name: "INSERT shop",
          attributes: { "db.operation": "INSERT" },
          parent: "price.save",
        },
      ],
      metrics: ["prices.imported"],
      logs: [
        { body: "imported 1 of 2 prices", hasTraceContext: true },
        {
          body: "skipped a price: inv_2 is below the minimum price",
          hasTraceContext: true,
        },
      ],
      resource: { "service.name": "price-import" },
    },
    variants: [
      {
        // The instrumentations' own variables, and the SDK's quieter logger.
        name: "Instrumentations off",
        ...jobRun(),
        environmentSnippets: ["disable-instrumentation", "sdk-log-level"],
        expect: {
          spans: [
            { name: "prices.import", attributes: { "price.count": "2" } },
            {
              name: "INSERT shop",
              parent: "price.save",
              absentAttributes: ["db.statement"],
            },
          ],
          metrics: ["prices.imported"],
          logs: [{ body: "imported 1 of 2 prices", hasTraceContext: true }],
          absentSpans: ["GET"],
          absentLogs: ["successfully installed"],
        },
      },
    ],
  },
};
