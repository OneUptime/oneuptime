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
  "opentelemetry-instrumentation-flask",
  "opentelemetry-instrumentation-sqlalchemy",
  "opentelemetry-instrumentation-requests",
  "opentelemetry-instrumentation-logging",
]);

const gunicorn: GuideSnippet = {
  id: "gunicorn",
  language: "bash",
  code: "opentelemetry-instrument gunicorn app:app --bind 0.0.0.0:8000 --workers 4",
  check: "run",
};

const devServer: GuideSnippet = {
  id: "dev-server",
  language: "bash",
  code: "opentelemetry-instrument flask --app app run --debug",
  check: "parse",
};

// The app's opening lines: its logger, tracer, counter and database.
const appHead: GuideSnippet = {
  id: "app-head",
  language: "python",
  title: "app.py",
  code: [
    "import logging",
    "import os",
    "",
    "import requests",
    "from flask import Flask, jsonify, request",
    "from opentelemetry import metrics, trace",
    "from sqlalchemy import create_engine, text",
    "",
    'PAYMENTS_API = os.environ.get("PAYMENTS_API_URL", "http://localhost:9000")',
    "",
    "logging.basicConfig(level=logging.INFO)",
    'logger = logging.getLogger("checkout")',
    'tracer = trace.get_tracer("checkout")',
    'orders_placed = metrics.get_meter("checkout").create_counter(',
    '    "orders.placed", description="Orders placed, by payment method"',
    ")",
    "",
    'engine = create_engine(os.environ.get("DATABASE_URL", "sqlite:///shop.db"))',
    "app = Flask(__name__)",
  ].join("\n"),
  check: "contained",
};

const errorHandler: GuideSnippet = {
  id: "error-handler",
  language: "python",
  title: "app.py",
  code: [
    "@app.errorhandler(Exception)",
    "def handle_error(error):",
    "    # The handler takes the exception from Flask, and from OpenTelemetry with it:",
    "    # record it on the request's span, or it never reaches Exceptions.",
    "    trace.get_current_span().record_exception(error)",
    '    logger.exception("request failed")',
    '    return jsonify(error="Something went wrong"), 500',
  ].join("\n"),
  check: "contained",
};

const createOrder: GuideSnippet = {
  id: "create-order",
  language: "python",
  title: "app.py",
  code: [
    '@app.post("/orders")',
    "def create_order():",
    "    order = request.get_json()",
    '    with tracer.start_as_current_span("checkout.charge") as span:',
    '        span.set_attribute("order.item_count", len(order["items"]))',
    '        span.set_attribute("payment.method", order["payment_method"])',
    '        requests.post(f"{PAYMENTS_API}/api/charges", json=order, timeout=10)',
    "        with engine.begin() as connection:",
    "            connection.execute(",
    '                text("INSERT INTO orders (items, payment_method) VALUES (:items, :method)"),',
    '                {"items": len(order["items"]), "method": order["payment_method"]},',
    "            )",
    '    orders_placed.add(1, {"payment.method": order["payment_method"]})',
    '    return jsonify(status="placed"), 201',
  ].join("\n"),
  check: "contained",
};

const excludedUrls: GuideSnippet = {
  id: "excluded-urls",
  language: "bash",
  code: 'export OTEL_PYTHON_FLASK_EXCLUDED_URLS="healthz"',
  check: "run",
};

const sampling: GuideSnippet = {
  id: "sampling",
  language: "bash",
  code: [
    'export OTEL_TRACES_SAMPLER="parentbased_traceidratio"',
    'export OTEL_TRACES_SAMPLER_ARG="0.3"',
  ].join("\n"),
  check: "parse",
};

const sqlalchemyPin: GuideSnippet = {
  id: "sqlalchemy-pin",
  language: "bash",
  code: "pip install sqlalchemy==2.0.55",
  check: "run",
};

const requirements: GuideSnippet = {
  id: "requirements",
  language: "text",
  title: "requirements.txt",
  code: [
    "flask==3.1.3",
    "gunicorn==26.2.0",
    "sqlalchemy==2.0.55",
    "requests==2.34.2",
    "opentelemetry-distro==0.66b1",
    "opentelemetry-exporter-otlp-proto-http==1.45.1",
    "opentelemetry-instrumentation-flask==0.66b1",
    "opentelemetry-instrumentation-sqlalchemy==0.66b1",
    "opentelemetry-instrumentation-requests==0.66b1",
    "opentelemetry-instrumentation-logging==0.66b1",
  ].join("\n"),
  check: "parse",
};

/*
 * The app the end-to-end check runs: the page's fragments word for word,
 * and the routes around them.
 */
const appFile: string = [
  appHead.code,
  "",
  "",
  '@app.get("/healthz")',
  "def healthz():",
  '    return "ok"',
  "",
  "",
  '@app.get("/users/<int:user_id>")',
  "def get_user(user_id):",
  '    logger.info("loading user %s", user_id)',
  "    with engine.connect() as connection:",
  "        row = connection.execute(",
  '            text("SELECT name FROM users WHERE id = :id"), {"id": user_id}',
  "        ).first()",
  "    return jsonify(id=user_id, name=row.name if row else None)",
  "",
  "",
  createOrder.code,
  "",
  "",
  '@app.get("/boom")',
  "def boom():",
  '    raise RuntimeError("Payment provider timed out")',
  "",
  "",
  errorHandler.code,
].join("\n");

const initDatabase: string = [
  "from sqlalchemy import create_engine, text",
  "",
  'engine = create_engine("sqlite:///shop.db")',
  "with engine.begin() as connection:",
  '    connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)"))',
  "    connection.execute(text(\"INSERT INTO users VALUES (42, 'Ada')\"))",
  "    connection.execute(",
  '        text("CREATE TABLE orders (id INTEGER PRIMARY KEY, items INTEGER, payment_method TEXT)")',
  "    )",
].join("\n");

export const FlaskGuide: OpenTelemetryGuide = {
  slug: "flask",
  seo: {
    title: "Flask OpenTelemetry: Tracing, Metrics & Logs | OneUptime",
    description:
      "Instrument Flask with OpenTelemetry under gunicorn: routes, SQLAlchemy queries, outgoing calls, error handlers and logging with trace IDs, sent to OneUptime.",
  },
  h1: "OpenTelemetry for Flask",
  lead: "Trace every Flask route with the SQLAlchemy queries and HTTP calls it makes, and send the traces, metrics and logs to OneUptime. Start gunicorn under `opentelemetry-instrument`, add one line to your error handler, and keep your routes as they are.",
  cardDescription:
    "Routes, SQLAlchemy queries and outgoing calls under gunicorn, with exceptions your error handlers catch.",
  searchTerms: [
    "werkzeug",
    "gunicorn",
    "sqlalchemy",
    "flask-sqlalchemy",
    "wsgi",
    "python",
  ],
  highlights: ["Zero-code under gunicorn", "SQLAlchemy 2.0", "Flask 3"],

  whatYouGet: {
    intro: `Under \`opentelemetry-instrument\`, every request to your Flask app becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, which ${SCREENS.services} lists from its first request.`,
    traces:
      "A server span per request named after the route's rule, such as `GET /users/<int:user_id>`, with a span for each SQLAlchemy connection and statement and each call made with `requests` beneath it.",
    metrics:
      "Request duration and requests in flight by route, method and status, outgoing call duration, and the connections SQLAlchemy's pool holds, beside the counters you add.",
    logs: "The records your code and Flask's `app.logger` write, each carrying the trace and span of the request it was written in.",
    exceptions: `An exception a route raises marks the request's span failed. Recorded on the span, it lands in ${SCREENS.exceptions} with its traceback, grouped with every other request it broke.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "flask",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 5,
        duration: 88,
        source: "your code",
      },
      {
        name: "POST",
        depth: 2,
        start: 9,
        duration: 46,
        source: "requests",
      },
      {
        name: "connect",
        depth: 2,
        start: 58,
        duration: 6,
        source: "sqlalchemy",
      },
      {
        name: "INSERT shop.db",
        depth: 2,
        start: 66,
        duration: 22,
        source: "sqlalchemy",
      },
    ],
  },

  prerequisites: [
    PYTHON_PREREQUISITE,
    "A Flask 2 or 3 app, served by gunicorn in production. These steps were checked with Flask 3.1 and SQLAlchemy 2.0.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Install the distro, the OTLP exporter over HTTP, and the instrumentations for Flask, SQLAlchemy, `requests` and logging, at the versions this guide was checked with:",
    snippets: [install],
    notes: [
      "The Flask instrumentation brings the WSGI one it builds on; there is nothing else to add for gunicorn.",
      "Flask-SQLAlchemy runs on SQLAlchemy, so its queries are traced by the same instrumentation.",
    ],
  },

  configure: {
    intro:
      "The endpoint, the key and the service's name come from environment variables, so your code never holds them:",
    tabs: otlpEnvironmentTabs({
      serviceName: "checkout-api",
      extraLines: [OTLP_HTTP_PROTOCOL_LINE, PYTHON_STABLE_HTTP_LINE],
      cloudNote:
        "gunicorn passes its environment to every worker, so each one sends as `checkout-api`.",
    }),
    notes: [PYTHON_PROTOCOL_NOTE, PYTHON_STABLE_HTTP_NOTE],
  },

  setup: {
    intro:
      "Start gunicorn under OpenTelemetry, then make sure the exceptions your error handlers catch still reach OneUptime.",
    steps: [
      {
        title: "Start gunicorn under opentelemetry-instrument",
        body: "Put `opentelemetry-instrument` in front of your gunicorn command. It loads the SDK and patches Flask before gunicorn imports your app, so the app factory pattern works as it is:",
        snippets: [gunicorn],
        notes: [
          "Each worker gunicorn forks starts its own exporter after the fork, so `--workers` and `--preload` need nothing else.",
        ],
      },
      {
        title: "Record what your error handlers catch",
        body: "An error handler takes a route's exception from Flask, and the instrumentation never sees it: the span is marked failed by its 500, but carries no exception. Record it yourself, in one line:",
        snippets: [errorHandler],
        notes: [
          "A route without an error handler needs nothing: the instrumentation records the exception it raises.",
        ],
      },
      {
        title: "Try it with the development server",
        body: "In development, the same variables and command work with Flask's own server, reloader included:",
        snippets: [devServer],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "With the packages above, a Flask app's work is traced at each layer it passes through:",
    rows: [
      {
        library: "`flask`",
        covers:
          "A server span per request named after its rule (`GET /users/<int:user_id>`), with `http.route` and the status code, and `http.server.request.duration`.",
      },
      {
        library: "`sqlalchemy`",
        covers:
          "A span for each connection taken from the pool and each statement, such as `SELECT shop.db`, with the statement, and pool usage metrics.",
      },
      {
        library: "`requests`",
        covers:
          "A client span per outgoing call, which passes `traceparent` along so the service you call joins the trace.",
      },
      {
        library: "`logging`",
        covers:
          "Records from your loggers and `app.logger`, with the trace and span IDs, sent as logs.",
      },
      {
        library: "`redis`, `psycopg`, `pymongo`",
        covers:
          "A span per command or query when your app talks to them directly, beside SQLAlchemy.",
      },
    ],
    snippets: [sqlalchemyPin],
    notes: [
      "The SQLAlchemy instrumentation 0.66b1 supports SQLAlchemy up to 2.0. With SQLAlchemy 2.1 it is skipped without a word, and set up by hand it fails to import, so pin 2.0 until it supports 2.1:",
    ],
  },

  manualSpans: {
    intro:
      "Open a span of your own around work no library knows about, such as charging a card; the call and the `INSERT` inside it nest beneath it:",
    snippets: [createOrder],
    notes: [
      "Set attributes your team searches by and find them in the **Traces** explorer, such as `@payment.method:card`.",
      "An exception raised inside the `with` block is recorded on `checkout.charge` with its traceback, then reaches your error handler as before.",
    ],
  },

  logs: {
    intro:
      "Log as you already do. With the logging instrumentation, every record through Python's `logging` also goes to OneUptime with the trace and span IDs of its request:",
    snippets: [appHead],
    notes: [
      "`logging.basicConfig(level=logging.INFO)` sets the root logger's level, which is what decides whether a record reaches OneUptime: Python keeps only WARNING and above until something sets it.",
      "`app.logger` writes through `logging` too, so Flask's own records arrive the same way.",
      "Under `flask run`, Werkzeug's request lines are records too and arrive as logs, coloured codes and all: run gunicorn in production.",
    ],
  },

  metrics: {
    intro: "Exported every 60 seconds, without a line of code:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Each request's duration by `http.route`, method and status: the latency and error rate of every route.",
      },
      {
        name: "http.server.active_requests",
        description: "Requests in flight in each worker.",
      },
      {
        name: "http.client.request.duration",
        description:
          "Calls your routes make with `requests`, by server and status.",
      },
      {
        name: "db.client.connections.usage",
        description:
          "SQLAlchemy's pool, idle and used: a pool that stays used while requests wait is a pool too small.",
      },
    ],
    snippets: [],
    notes: [
      'Count what matters to the business, as `orders_placed` does: create it once at import, then `orders_placed.add(1, {"payment.method": "card"})` where it happens.',
      "Every gunicorn worker exports its own series, and OneUptime adds them up in charts.",
    ],
  },

  sampling: {
    intro:
      "Leave health checks out, then keep a share of the rest once traffic grows:",
    snippets: [excludedUrls, sampling],
    notes: [
      "`OTEL_PYTHON_FLASK_EXCLUDED_URLS` takes comma-separated regular expressions matched against the URL.",
      "`parentbased_traceidratio` keeps three new traces in ten and follows the caller's decision for a request that arrives with a `traceparent` header.",
      "Metrics and logs are not sampled.",
    ],
  },

  deploy: {
    intro:
      "Put `opentelemetry-instrument` in the image's command and the key in a Kubernetes Secret:",
    snippets: [
      requirements,
      pythonDockerfileSnippet({
        command: [
          "opentelemetry-instrument",
          "gunicorn",
          "app:app",
          "--bind",
          "0.0.0.0:8000",
          "--workers",
          "4",
        ],
        port: 8000,
      }),
      kubernetesManifestSnippet({
        name: "checkout-api",
        image: "registry.example.com/checkout-api:3.1.0",
        containerPort: 8000,
        extraEnv: [
          { name: "OTEL_EXPORTER_OTLP_PROTOCOL", value: "http/protobuf" },
          { name: "OTEL_SEMCONV_STABILITY_OPT_IN", value: "http" },
          { name: "OTEL_PYTHON_FLASK_EXCLUDED_URLS", value: "healthz" },
        ],
      }),
    ],
    notes: [
      "On SIGTERM, gunicorn stops taking requests and lets its workers finish; each sends what it holds as it exits.",
      "With the [Kubernetes agent](/docs/telemetry/kubernetes-agent) installed, the pods behind `checkout-api` show beside its traces, with their restarts and resource use.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Call a route, then open ${SCREENS.services}: \`checkout-api\` is listed within a minute.`,
      },
      {
        title: "Open a request's trace",
        body: `With \`@http.route:/orders\` searched in ${SCREENS.traces}, each request's trace holds \`checkout.charge\`, the payment call and the SQLAlchemy spans.`,
      },
      {
        title: "Find the exception",
        body: `${SCREENS.exceptions} lists the \`RuntimeError\` your error handler recorded, with the request it happened in.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Requests are traced, but no SQLAlchemy queries",
      answer:
        "Check your SQLAlchemy version: the instrumentation supports up to 2.0, and `opentelemetry-instrument` skips it for 2.1 without an error. `OTEL_LOG_LEVEL=debug` shows the reason, `falls outside of that range, so nothing can be instrumented`. Pin `sqlalchemy==2.0.55`, as above.",
    },
    {
      question: "Failed requests have no exception in OneUptime",
      answer:
        "An error handler caught it. Add `trace.get_current_span().record_exception(error)` to the handler, as shown above, or log it with `logger.exception`, which sends the traceback with the record.",
    },
    {
      question: "Spans are named GET or POST, with no route",
      answer:
        "No route matched, as for a 404, or the request was answered before routing. Requests that reach one of your routes carry its rule.",
    },
    {
      question:
        "Nothing arrives, and gunicorn prints “Failed to auto initialize OpenTelemetry”",
      answer:
        "With `OTEL_EXPORTER_OTLP_PROTOCOL` unset, the distro reached for its gRPC exporter: set the variable to `http/protobuf`. The app serves requests anyway, without telemetry.",
    },
    {
      question: "The exporter logs a 401",
      answer:
        "OneUptime refused the key: `OTEL_EXPORTER_OTLP_HEADERS` must be `x-oneuptime-token=` and a **Server** key's **Secret Key**, from the project you are looking at.",
    },
  ],

  faq: [
    {
      question: "Does it work with the app factory pattern?",
      answer:
        "Yes. `opentelemetry-instrument` patches the `Flask` class before your factory runs, so every app it creates is instrumented, whatever its name.",
    },
    {
      question: "Can I instrument the app in code instead?",
      answer:
        "Yes: set the SDK up in code as in the [Python guide](/integrations/opentelemetry/python), then call `FlaskInstrumentor().instrument_app(app)`. Do not also start the app under `opentelemetry-instrument`, or it is instrumented twice.",
    },
    {
      question: "Which Flask versions are supported?",
      answer:
        "`opentelemetry-instrumentation-flask` supports Flask 1.0 and later, and this guide was checked with Flask 3.1 on Python 3.14.",
    },
    {
      question: "Do I need a Collector?",
      answer:
        "No: each worker sends straight to OneUptime. A Collector is worth it when you want one place to batch, filter or enrich telemetry from many services: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["python", "fastapi", "django", "celery"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.exceptions, DOCS.logs],

  verification: {
    runtime: "python",
    framework: { name: "Flask", package: "flask" },
    files: [
      { path: "app.py", content: appFile },
      { path: "init_db.py", content: initDatabase },
    ],
    stubApiPort: 9000,
    environmentSnippets: ["excluded-urls"],
    commands: [
      { snippet: "install" },
      {
        command: "pip install flask==3.1.3 gunicorn==26.2.0 requests==2.34.2",
      },
      { snippet: "sqlalchemy-pin" },
      { command: "python init_db.py" },
      { snippet: "gunicorn", isServer: true },
    ],
    port: 8000,
    requests: [
      { method: "GET", path: "/healthz" },
      { method: "GET", path: "/users/42" },
      {
        method: "POST",
        path: "/orders",
        body: { items: ["kettle", "mug"], payment_method: "card" },
      },
      { method: "GET", path: "/boom" },
    ],
    expect: {
      spans: [
        {
          name: "GET /users/<int:user_id>",
          attributes: { "http.route": "/users/<int:user_id>" },
        },
        { name: "SELECT shop.db" },
        { name: "INSERT shop.db" },
        { name: "connect" },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
        },
        { name: "POST", attributes: { "http.request.method": "POST" } },
        {
          name: "GET /boom",
          hasException: true,
          exceptionMessage: "Payment provider timed out",
        },
      ],
      metrics: [
        "http.server.request.duration",
        "http.server.active_requests",
        "http.client.request.duration",
        "db.client.connections.usage",
        "orders.placed",
      ],
      logs: [
        { body: "loading user 42", hasTraceContext: true },
        { body: "request failed", hasTraceContext: true, hasException: true },
      ],
      resource: { "service.name": "checkout-api" },
      untracedPaths: ["/healthz"],
    },
  },
};
