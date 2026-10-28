import { OpenTelemetryGuide, GuideSnippet } from "../GuideTypes";
import {
  DOCS,
  OTLP_HTTP_PROTOCOL_LINE,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";
import {
  PYTHON_PREREQUISITE,
  PYTHON_PROTOCOL_NOTE,
  PYTHON_STABLE_HTTP_LINE,
  PYTHON_STABLE_HTTP_NOTE,
  pipInstallSnippet,
  pythonDockerfileSnippet,
} from "../PythonShared";

const install: GuideSnippet = pipInstallSnippet("install", [
  "opentelemetry-distro",
  "opentelemetry-exporter-otlp-proto-http",
  "opentelemetry-instrumentation-logging",
  "opentelemetry-instrumentation-requests",
  "opentelemetry-instrumentation-system-metrics",
]);

const bootstrap: GuideSnippet = {
  id: "bootstrap",
  language: "bash",
  code: "opentelemetry-bootstrap -a install",
  check: "parse",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "opentelemetry-instrument python sync_invoices.py",
  check: "run",
};

/*
 * The worker the page sets up: every 30 seconds it copies new invoices
 * from a billing API into a ledger, one trace per run.
 */
const worker: GuideSnippet = {
  id: "worker",
  language: "python",
  title: "sync_invoices.py",
  code: [
    "import logging",
    "import os",
    "import signal",
    "import sys",
    "import time",
    "",
    "import requests",
    "from opentelemetry import trace",
    "",
    "from ledger import post_invoices",
    "",
    'BILLING_API = os.environ.get("BILLING_API_URL", "http://localhost:9000")',
    "",
    'logger = logging.getLogger("invoices")',
    'tracer = trace.get_tracer("invoices")',
    "",
    "",
    "def sync_invoices():",
    "    # One trace per run: without it, every request below is a trace of its own.",
    '    with tracer.start_as_current_span("invoices.sync") as span:',
    '        invoices = requests.get(f"{BILLING_API}/api/invoices", timeout=10).json()["items"]',
    '        span.set_attribute("invoice.count", len(invoices))',
    "        synced = post_invoices(invoices)",
    '        logger.info("synced %d of %d invoices", synced, len(invoices))',
    "",
    "",
    'if __name__ == "__main__":',
    "    # Docker and Kubernetes stop a program with SIGTERM, which ends Python at once:",
    "    # leaving through sys.exit lets OpenTelemetry send what it still holds.",
    "    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(0))",
    "    logging.basicConfig(level=logging.INFO)",
    "    while True:",
    "        sync_invoices()",
    "        time.sleep(30)",
  ].join("\n"),
  check: "run",
};

// The worker's own steps: a span per check, a counter, a logged exception.
const ledger: GuideSnippet = {
  id: "ledger",
  language: "python",
  title: "ledger.py",
  code: [
    "import logging",
    "import os",
    "",
    "import requests",
    "from opentelemetry import metrics, trace",
    "",
    'BILLING_API = os.environ.get("BILLING_API_URL", "http://localhost:9000")',
    "MINIMUM_TOTAL = 100",
    "",
    'logger = logging.getLogger("invoices.ledger")',
    'tracer = trace.get_tracer("invoices.ledger")',
    'invoices_synced = metrics.get_meter("invoices.ledger").create_counter(',
    '    "invoices.synced", description="Invoices copied to the ledger"',
    ")",
    "",
    "",
    '@tracer.start_as_current_span("invoice.validate")',
    "def validate(invoice):",
    '    trace.get_current_span().set_attribute("invoice.id", invoice["id"])',
    '    if invoice["total"] < MINIMUM_TOTAL:',
    "        raise ValueError(f\"Invoice {invoice['id']} is below the ledger's minimum\")",
    "",
    "",
    "def post_invoices(invoices):",
    "    synced = 0",
    "    for invoice in invoices:",
    "        try:",
    "            validate(invoice)",
    "        except ValueError:",
    '            logger.exception("skipped invoice %s", invoice["id"])',
    "            continue",
    '        requests.post(f"{BILLING_API}/api/ledger", json=invoice, timeout=10)',
    '        invoices_synced.add(1, {"invoice.source": "billing"})',
    "        synced += 1",
    "    return synced",
  ].join("\n"),
  check: "run",
};

/*
 * The same program set up in code: a module imported before anything
 * else, for apps that cannot be started through opentelemetry-instrument.
 */
const inCode: GuideSnippet = {
  id: "in-code",
  language: "python",
  title: "telemetry.py",
  code: [
    "from opentelemetry import metrics, trace",
    "from opentelemetry._logs import set_logger_provider",
    "from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter",
    "from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter",
    "from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter",
    "from opentelemetry.instrumentation.logging import LoggingInstrumentor",
    "from opentelemetry.instrumentation.requests import RequestsInstrumentor",
    "from opentelemetry.sdk._logs import LoggerProvider",
    "from opentelemetry.sdk._logs.export import BatchLogRecordProcessor",
    "from opentelemetry.sdk.metrics import MeterProvider",
    "from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader",
    "from opentelemetry.sdk.resources import Resource",
    "from opentelemetry.sdk.trace import TracerProvider",
    "from opentelemetry.sdk.trace.export import BatchSpanProcessor",
    "",
    "# OTEL_SERVICE_NAME names the service; the exporters read the",
    "# OTEL_EXPORTER_OTLP_* variables and always send over HTTP.",
    "resource = Resource.create()",
    "",
    "tracer_provider = TracerProvider(resource=resource)",
    "tracer_provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))",
    "trace.set_tracer_provider(tracer_provider)",
    "",
    "metrics.set_meter_provider(",
    "    MeterProvider(",
    "        resource=resource,",
    "        metric_readers=[PeriodicExportingMetricReader(OTLPMetricExporter())],",
    "    )",
    ")",
    "",
    "logger_provider = LoggerProvider(resource=resource)",
    "logger_provider.add_log_record_processor(BatchLogRecordProcessor(OTLPLogExporter()))",
    "set_logger_provider(logger_provider)",
    "",
    "# Python's logging records to OneUptime, and a span for every requests call.",
    "LoggingInstrumentor().instrument()",
    "RequestsInstrumentor().instrument()",
  ].join("\n"),
  check: "run",
};

const inCodeImport: GuideSnippet = {
  id: "in-code-import",
  language: "python",
  title: "sync_invoices.py",
  code: "import telemetry  # noqa: F401  first, so OpenTelemetry starts before the rest",
  check: "contained",
};

const runInCode: GuideSnippet = {
  id: "run-in-code",
  language: "bash",
  code: "python sync_invoices.py",
  check: "run",
};

const processMetrics: GuideSnippet = {
  id: "process-metrics",
  language: "bash",
  title: "Environment",
  code: 'export OTEL_PYTHON_SYSTEM_METRICS_EXCLUDED_METRICS="system.*,process.runtime.*"',
  check: "run",
};

const sampling: GuideSnippet = {
  id: "sampling",
  language: "bash",
  code: [
    'export OTEL_TRACES_SAMPLER="parentbased_traceidratio"',
    'export OTEL_TRACES_SAMPLER_ARG="0.25"',
    'export OTEL_PYTHON_DISABLED_INSTRUMENTATIONS="urllib3"',
  ].join("\n"),
  check: "parse",
};

const requirements: GuideSnippet = {
  id: "requirements",
  language: "text",
  title: "requirements.txt",
  code: [
    "requests==2.34.2",
    "opentelemetry-distro==0.66b1",
    "opentelemetry-exporter-otlp-proto-http==1.45.1",
    "opentelemetry-instrumentation-logging==0.66b1",
    "opentelemetry-instrumentation-requests==0.66b1",
    "opentelemetry-instrumentation-system-metrics==0.66b1",
  ].join("\n"),
  check: "parse",
};

// The in-code variant: the same worker, with telemetry.py imported first.
const inCodeWorkerFile: string = [inCodeImport.code, "", worker.code].join(
  "\n",
);

export const PythonGuide: OpenTelemetryGuide = {
  slug: "python",
  seo: {
    title: "Python OpenTelemetry: Traces, Metrics & Logs | OneUptime",
    description:
      "Add OpenTelemetry to any Python app with opentelemetry-instrument or in code: HTTP spans, logging with trace IDs, process metrics, all sent to OneUptime.",
  },
  h1: "OpenTelemetry for Python",
  lead: "Send traces, metrics and logs from any Python program to OneUptime: a worker, a script, a CLI or a service on a framework with no guide of its own. Start it with `opentelemetry-instrument` and change no code, or set the SDK up in code where you need the control.",
  cardDescription:
    "Any Python program, framework or not: opentelemetry-instrument or the SDK in code, logging, process metrics.",
  searchTerms: [
    "opentelemetry-instrument",
    "opentelemetry-distro",
    "zero-code",
    "script",
    "worker",
    "requests",
    "logging",
  ],
  highlights: [
    "Zero-code with opentelemetry-instrument",
    "Or the SDK in code",
    "Python 3.10 to 3.14",
  ],

  whatYouGet: {
    intro: `A Python program started under OpenTelemetry reports as one service, named by \`OTEL_SERVICE_NAME\`, and appears in ${SCREENS.services} the first time it sends. The worker below copies invoices from a billing API into a ledger; any program you run is set up the same way.`,
    traces:
      "A client span for every call made with `requests`, `urllib3`, `httpx` or `aiohttp`, a span per query to PostgreSQL, MySQL, SQLite or Redis, and the spans you open around your own work, all in one trace per run of the job.",
    metrics:
      "`http.client.request.duration` for every outgoing call, the process's CPU time, memory and garbage collections, and counters and histograms of your own, exported once a minute.",
    logs: "Records written with Python's `logging` module, each carrying the trace and span it was written in, with the arguments you pass in `extra` as attributes.",
    exceptions: `An exception raised inside a span is recorded on it and marks it failed, and \`logger.exception\` sends the record with its type, message and traceback. OneUptime groups both under ${SCREENS.exceptions}.`,
  },

  exampleTrace: {
    caption: "One run of the invoice sync, as its trace shows it",
    spans: [
      {
        name: "invoices.sync",
        depth: 0,
        start: 0,
        duration: 100,
        source: "your code",
      },
      {
        name: "GET",
        depth: 1,
        start: 3,
        duration: 24,
        source: "requests",
      },
      {
        name: "invoice.validate",
        depth: 1,
        start: 30,
        duration: 3,
        source: "your code",
      },
      {
        name: "POST",
        depth: 1,
        start: 36,
        duration: 38,
        source: "requests",
      },
      {
        name: "invoice.validate",
        depth: 1,
        start: 78,
        duration: 4,
        source: "your code",
        isError: true,
      },
    ],
  },

  prerequisites: [
    PYTHON_PREREQUISITE,
    "A program you start with `python`: a worker, a script, a scheduled job, or a web app on a framework this site has no guide for. Using Django, Flask, FastAPI or Celery? Their guides cover what is particular to them.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Install the distro (the SDK and the `opentelemetry-instrument` command), the OTLP exporter over HTTP, and an instrumentation for each library to trace. These are the versions this guide was checked with:",
    snippets: [install, bootstrap],
    notes: [
      "`opentelemetry-instrumentation-logging` is what sends Python's logging records. Since SDK 1.45 it attaches the handler by itself; the older `OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED` switch still works but prints a deprecation warning.",
      "`opentelemetry-bootstrap -a install` looks through your environment and installs the matching instrumentation for every library it finds. Run it after your app's own packages are installed, then pin what it added in `requirements.txt`.",
      "Install `opentelemetry-exporter-otlp-proto-http` rather than `opentelemetry-exporter-otlp`: the latter adds the gRPC exporter and its `grpcio` dependency, which OneUptime's HTTP endpoint does not need.",
    ],
  },

  configure: {
    intro:
      "The SDK reads its endpoint, key and service name from the standard OpenTelemetry variables, so none of them is written in your code. Set them where your program gets its environment:",
    tabs: otlpEnvironmentTabs({
      serviceName: "invoice-sync",
      extraLines: [OTLP_HTTP_PROTOCOL_LINE, PYTHON_STABLE_HTTP_LINE],
      cloudNote:
        "Every process started with these variables reports as `invoice-sync`; run a second program with its own `OTEL_SERVICE_NAME`.",
    }),
    notes: [PYTHON_PROTOCOL_NOTE, PYTHON_STABLE_HTTP_NOTE],
  },

  setup: {
    intro:
      "Start the program under `opentelemetry-instrument`, which loads the SDK and every installed instrumentation before your first import, or set the SDK up yourself in a module your program imports first.",
    steps: [
      {
        title: "Open a span for each run",
        body: "A web request starts a trace by itself; a worker's loop does not. Wrap each run in a span of your own, so the calls it makes sit in one trace instead of a trace each:",
        snippets: [worker],
        notes: [
          "The SIGTERM handler matters in containers: Python's default reaction to SIGTERM ends the process before its exit hooks run, and with them OpenTelemetry's last export.",
        ],
      },
      {
        title: "Start it with OpenTelemetry",
        body: "Pick zero-code to change nothing but the command, or in code when a launcher you do not control starts your program:",
        tabs: {
          group: "setup",
          tabs: [
            {
              label: "Zero-code",
              body: "Put `opentelemetry-instrument` in front of the command that starts your program:",
              snippets: [run],
              notes: [
                "It works the same in front of any Python entry point: `opentelemetry-instrument python -m mypackage`, `opentelemetry-instrument my-cli-command`.",
              ],
            },
            {
              label: "In code",
              body: "Create `telemetry.py`, import it on the first line of your entry point, and start the program as usual:",
              snippets: [inCode, inCodeImport, runInCode],
              notes: [
                "The exporters here are the HTTP ones by import, so `OTEL_EXPORTER_OTLP_PROTOCOL` is not needed; `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_SERVICE_NAME` are.",
                "Instrument a library before anything imports it: an instrumentation patches the module, so a client created earlier may not be traced.",
              ],
            },
          ],
        },
      },
      {
        title: "Run it and watch the first export",
        body: "Spans and log records leave in batches every few seconds; metrics once a minute, and once more as the program exits.",
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "Each instrumentation patches one library, and only when it is installed. The ones a typical Python service uses:",
    rows: [
      {
        library: "`requests`, `urllib3`, `urllib`",
        covers:
          "A client span per call, named after the method (`GET`, `POST`), with the URL and status, and `http.client.request.duration`.",
      },
      {
        library: "`httpx`, `aiohttp`",
        covers:
          "The same for async clients, carried across `await` so the call nests under the span that made it.",
      },
      {
        library: "`psycopg`, `psycopg2`, `pymysql`, `sqlite3`, `sqlalchemy`",
        covers:
          "A span per query, with the database system, its name and the statement.",
      },
      {
        library: "`redis`, `pymongo`, `elasticsearch`",
        covers: "A client span per command or operation.",
      },
      {
        library: "`logging`",
        covers:
          "The records, with the trace and span IDs of the code that wrote them, sent to OneUptime as logs.",
      },
      {
        library: "`grpc`, `aiohttp-server`, `starlette`, `falcon`, `pyramid`, `tornado`",
        covers:
          "Server spans for frameworks without a guide of their own here, named after the route where the framework knows it.",
      },
    ],
    snippets: [],
    notes: [
      "`OTEL_PYTHON_DISABLED_INSTRUMENTATIONS` turns instrumentations off by name, comma-separated: `urllib3` when `requests` already covers your calls, for example, so each call is one span and not two.",
    ],
  },

  manualSpans: {
    intro:
      "The libraries' spans show where the time goes between them. For your own steps, open a span with `tracer.start_as_current_span`: as a `with` block around the work, as in the worker, or as a decorator on a function, as on `validate` here:",
    snippets: [ledger],
    notes: [
      "A span opened in a `with` block becomes the current one, so the queries and calls made inside it nest beneath it, and it ends when the block does.",
      "An exception that leaves the block is recorded on the span with its traceback and marks the span failed. Catch it inside the block instead if it is not a failure.",
      'Add the attributes your team searches by: `span.set_attribute("tenant.id", tenant_id)`, then find them in the **Traces** explorer with `@tenant.id:acme`.',
      "Name a span after the work, such as `invoice.validate`, rather than after a value that changes, so OneUptime can group them.",
    ],
  },

  logs: {
    intro:
      "Keep logging with the `logging` module as before. With `opentelemetry-instrumentation-logging` installed, every record also goes to OneUptime, stamped with the trace and span it was written in.",
    snippets: [],
    notes: [
      "The handler sits on the root logger, so the level that counts is the root's: `logging.basicConfig(level=logging.INFO)` sends INFO and above, and without it Python keeps only WARNING and above.",
      'Arguments in `extra` arrive as attributes of the record: `logger.info("synced", extra={"invoice.source": "billing"})` is searchable as `@invoice.source:billing`.',
      "`logger.exception` inside an `except` block sends the exception's type, message and traceback with the record, which files it under **Exceptions**.",
      "`print` is not sent. Write to a logger instead, or capture the container's output with the [Kubernetes agent](/docs/telemetry/kubernetes-agent).",
    ],
  },

  metrics: {
    intro:
      "Metrics are exported every 60 seconds. With the packages above, a Python program reports:",
    builtIn: [
      {
        name: "http.client.request.duration",
        description:
          "Every outgoing `requests` call, by method, server and status code.",
      },
      {
        name: "process.cpu.time",
        description: "CPU seconds the process has used, user and system.",
      },
      {
        name: "process.memory.usage",
        description: "The resident memory of the process.",
      },
      {
        name: "cpython.gc.collections",
        description:
          "Garbage collections by generation: a rising count of the oldest generation points at memory held too long.",
      },
    ],
    snippets: [processMetrics],
    notes: [
      "The system-metrics instrumentation also reports the whole machine: CPU per core, memory, disk and network per device. On a large host that is hundreds of series. The variable above keeps the process's own metrics and drops the rest.",
      'Your own metrics take two lines: `counter = metrics.get_meter("invoices").create_counter("invoices.synced")`, then `counter.add(1, {"invoice.source": "billing"})`.',
      "Keep attribute values to a small set. An ID per value creates a series per value.",
    ],
  },

  sampling: {
    intro:
      "Everything is traced by default, which is right while you set things up. For a busy program, keep a share of new traces with the standard variables, and turn off instrumentations that add spans you do not need:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps a quarter of new traces, and follows the caller's decision when a trace arrives with a `traceparent` header, so a trace is never cut in two.",
      "Logs and metrics are not sampled: every run is still counted and every record still sent.",
      "To drop data once it leaves the program instead, use [drop filters](/docs/telemetry/drop-filters-and-scrub-rules) in OneUptime.",
    ],
  },

  deploy: {
    intro:
      "In an image, pin the packages in `requirements.txt` and put `opentelemetry-instrument` in the command; the key arrives at run time, from a Kubernetes Secret.",
    snippets: [
      requirements,
      pythonDockerfileSnippet({
        command: ["opentelemetry-instrument", "python", "sync_invoices.py"],
      }),
      kubernetesManifestSnippet({
        name: "invoice-sync",
        image: "registry.example.com/invoice-sync:2.0.1",
        extraEnv: [
          { name: "OTEL_EXPORTER_OTLP_PROTOCOL", value: "http/protobuf" },
          { name: "OTEL_SEMCONV_STABILITY_OPT_IN", value: "http" },
        ],
      }),
    ],
    notes: [
      "`PYTHONUNBUFFERED=1` makes the container's own output appear as it is written, which matters when you read a crash from `kubectl logs`.",
      "Kubernetes sends SIGTERM and waits 30 seconds. With the handler above, the worker exits at once and OpenTelemetry sends its last batch on the way out.",
      "A Kubernetes CronJob runs the same image: drop the loop, and OpenTelemetry sends what it holds when the script returns.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Start the worker and open ${SCREENS.services}: \`invoice-sync\` appears within a minute of its first run.`,
      },
      {
        title: "Open a run's trace",
        body: `In ${SCREENS.traces}, search \`invoices.sync\`. Each run is one trace: the calls to the billing API and every \`invoice.validate\` beneath it, the failed one in red.`,
      },
      {
        title: "Read the skipped invoice",
        body: `${SCREENS.logs} has the \`skipped invoice\` record with its traceback, and ${SCREENS.exceptions} groups the \`ValueError\` behind it.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Nothing arrives, and the program prints “Failed to auto initialize OpenTelemetry”",
      answer:
        "Read the line above it. `Requested component 'otlp_proto_grpc' not found` means `OTEL_EXPORTER_OTLP_PROTOCOL` is unset, so the distro looked for the gRPC exporter: set it to `http/protobuf`. The program itself carries on without telemetry, which is why nothing else complains.",
    },
    {
      question: "Each HTTP call is a trace of its own",
      answer:
        "Nothing started a span around the work: a worker's loop, a script or a CLI has no incoming request to begin a trace. Wrap each run in `tracer.start_as_current_span`, as the worker above does.",
    },
    {
      question: "The last runs before a deploy never arrive",
      answer:
        "Python's default action on SIGTERM ends the process before `atexit` runs, and OpenTelemetry sends its last batch from `atexit`. Install the handler shown above, `signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(0))`, so the process leaves the normal way.",
    },
    {
      question: "Logs arrive in the console but not in OneUptime",
      answer:
        "Check that `opentelemetry-instrumentation-logging` is installed and that the root logger lets the level through: without `logging.basicConfig(level=logging.INFO)` or an equivalent `dictConfig`, Python drops everything below WARNING before any handler sees it.",
    },
    {
      question: "A library I use is not traced",
      answer:
        "Set `OTEL_LOG_LEVEL=debug` and start the program again: the agent says why it skipped each instrumentation, such as `falls outside of that range, so nothing can be instrumented` when your library's version is newer than the instrumentation supports. Install the instrumentation if it is missing, or pin the library to a version it supports.",
    },
    {
      question: "The exporter logs a 401",
      answer:
        "OneUptime refused the key. `OTEL_EXPORTER_OTLP_HEADERS` must be `x-oneuptime-token=` followed by the key's **Secret Key**, of a **Server** key in the project you are looking at. Ask OneUptime directly with the `curl` command above.",
    },
  ],

  faq: [
    {
      question: "Which Python versions does OpenTelemetry support?",
      answer:
        "OpenTelemetry Python 1.45 supports Python 3.10 to 3.14, and this guide was checked on Python 3.14. Each instrumentation also names the versions of its library it supports.",
    },
    {
      question: "Should I use opentelemetry-instrument or set it up in code?",
      answer:
        "Start with `opentelemetry-instrument`: it changes nothing in your code and picks up every instrumentation installed. Set it up in code when something else launches your program, or when you need a custom sampler or processor.",
    },
    {
      question: "Does it work with asyncio?",
      answer:
        "Yes. The context that tells a span its parent follows `await` and asyncio tasks, so spans opened in coroutines nest correctly, and `httpx` and `aiohttp` calls sit under the span that made them.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No. The SDK sends straight to OneUptime. Run a Collector when you want to batch, filter or enrich data in one place before it leaves your network: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
    {
      question: "How much does it slow the program down?",
      answer:
        "Little for most programs: a span takes microseconds to open and end, and the exporter sends from a background thread, in batches. A span for each item of a loop over millions adds up, though: open one per batch of work instead, or sample.",
    },
  ],

  related: ["django", "flask", "fastapi", "celery"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.metrics],

  verification: {
    runtime: "python",
    framework: { name: "Python" },
    files: [
      { path: "sync_invoices.py", snippet: "worker" },
      { path: "ledger.py", snippet: "ledger" },
    ],
    commands: [
      { snippet: "install" },
      { command: "pip install requests==2.34.2" },
      { snippet: "run", isServer: true, readyText: "synced 1 of 2 invoices" },
    ],
    stubApiPort: 9000,
    requests: [],
    environmentSnippets: ["process-metrics"],
    expect: {
      spans: [
        { name: "invoices.sync", attributes: { "invoice.count": "2" } },
        { name: "GET", attributes: { "http.request.method": "GET" } },
        { name: "POST", attributes: { "http.response.status_code": "200" } },
        {
          name: "invoice.validate",
          attributes: { "invoice.id": "inv_2" },
          hasException: true,
          exceptionMessage: "below the ledger's minimum",
        },
      ],
      metrics: [
        "invoices.synced",
        "http.client.request.duration",
        "process.cpu.time",
        "process.memory.usage",
        "cpython.gc.collections",
      ],
      logs: [
        { body: "synced 1 of 2 invoices", hasTraceContext: true },
        {
          body: "skipped invoice inv_2",
          hasTraceContext: true,
          hasException: true,
        },
      ],
      resource: { "service.name": "invoice-sync" },
      absentMetrics: ["system.cpu.time", "system.network.io"],
    },
    variants: [
      {
        name: "In code",
        files: [
          { path: "telemetry.py", snippet: "in-code" },
          { path: "sync_invoices.py", content: inCodeWorkerFile },
          { path: "ledger.py", snippet: "ledger" },
        ],
        commands: [
          { snippet: "install" },
          { command: "pip install requests==2.34.2" },
          {
            snippet: "run-in-code",
            isServer: true,
            readyText: "synced 1 of 2 invoices",
          },
        ],
        stubApiPort: 9000,
        requests: [],
        expect: {
          spans: [
            { name: "invoices.sync", attributes: { "invoice.count": "2" } },
            { name: "GET" },
            { name: "invoice.validate", hasException: true },
          ],
          metrics: ["invoices.synced", "http.client.request.duration"],
          logs: [
            { body: "synced 1 of 2 invoices", hasTraceContext: true },
            { body: "skipped invoice inv_2", hasException: true, hasTraceContext: true },
          ],
          resource: { "service.name": "invoice-sync" },
        },
      },
    ],
  },
};
