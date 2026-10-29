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
  "opentelemetry-instrumentation-fastapi",
  "opentelemetry-instrumentation-httpx",
  "opentelemetry-instrumentation-logging",
]);

const disableAutomatic: GuideSnippet = {
  id: "disable-automatic",
  language: "bash",
  code: 'export OTEL_PYTHON_DISABLED_INSTRUMENTATIONS="fastapi"',
  check: "run",
};

// The app's opening lines: OpenTelemetry's two FastAPI-specific settings.
const mainHead: GuideSnippet = {
  id: "main-head",
  language: "python",
  title: "main.py",
  code: [
    "import logging",
    "import os",
    "from contextlib import asynccontextmanager",
    "",
    "import httpx",
    "from fastapi import FastAPI, HTTPException",
    "from opentelemetry import metrics, trace",
    "from opentelemetry._logs import get_logger_provider",
    "from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor",
    "from pydantic import BaseModel",
    "",
    'PAYMENTS_API = os.environ.get("PAYMENTS_API_URL", "http://localhost:9000")',
    "",
    "",
    "@asynccontextmanager",
    "async def lifespan(app: FastAPI):",
    "    yield",
    "    # uvicorn ends the process with the signal that stopped it, before Python's",
    "    # exit hooks run: send what OpenTelemetry still holds now.",
    "    for provider in (",
    "        trace.get_tracer_provider(),",
    "        metrics.get_meter_provider(),",
    "        get_logger_provider(),",
    "    ):",
    '        if hasattr(provider, "shutdown"):',
    "            provider.shutdown()",
    "",
    "",
    "app = FastAPI(lifespan=lifespan)",
    "# One span per request, without the two or three ASGI send and receive spans.",
    "FastAPIInstrumentor.instrument_app(",
    '    app, excluded_urls="healthz", exclude_spans=["receive", "send"]',
    ")",
  ].join("\n"),
  check: "contained",
};

const uvicorn: GuideSnippet = {
  id: "uvicorn",
  language: "bash",
  code: "opentelemetry-instrument uvicorn main:app --host 0.0.0.0 --port 8000",
  check: "run",
};

const createOrder: GuideSnippet = {
  id: "create-order",
  language: "python",
  title: "main.py",
  code: [
    "class Order(BaseModel):",
    "    items: list[str]",
    "    payment_method: str",
    "",
    "",
    '@app.post("/orders", status_code=201)',
    "async def create_order(order: Order):",
    '    with tracer.start_as_current_span("checkout.charge") as span:',
    '        span.set_attribute("order.item_count", len(order.items))',
    '        span.set_attribute("payment.method", order.payment_method)',
    "        async with httpx.AsyncClient() as client:",
    '            await client.post(f"{PAYMENTS_API}/api/charges", json=order.model_dump())',
    '    orders_placed.add(1, {"payment.method": order.payment_method})',
    '    return {"status": "placed"}',
  ].join("\n"),
  check: "contained",
};

const logging: GuideSnippet = {
  id: "logging",
  language: "python",
  title: "main.py",
  code: [
    "logging.basicConfig(level=logging.INFO)",
    "# httpx writes a line per request at INFO; its spans already say it all.",
    'logging.getLogger("httpx").setLevel(logging.WARNING)',
    "",
    'logger = logging.getLogger("checkout")',
    'tracer = trace.get_tracer("checkout")',
    'orders_placed = metrics.get_meter("checkout").create_counter(',
    '    "orders.placed", description="Orders placed, by payment method"',
    ")",
  ].join("\n"),
  check: "contained",
};

const sampling: GuideSnippet = {
  id: "sampling",
  language: "bash",
  code: [
    'export OTEL_TRACES_SAMPLER="parentbased_traceidratio"',
    'export OTEL_TRACES_SAMPLER_ARG="0.1"',
  ].join("\n"),
  check: "parse",
};

const requirements: GuideSnippet = {
  id: "requirements",
  language: "text",
  title: "requirements.txt",
  code: [
    "fastapi==0.162.0",
    "uvicorn==0.54.0",
    "httpx==0.28.1",
    "opentelemetry-distro==0.66b1",
    "opentelemetry-exporter-otlp-proto-http==1.45.1",
    "opentelemetry-instrumentation-fastapi==0.66b1",
    "opentelemetry-instrumentation-httpx==0.66b1",
    "opentelemetry-instrumentation-logging==0.66b1",
  ].join("\n"),
  check: "parse",
};

/*
 * The app the end-to-end check runs: the page's fragments word for word,
 * and the routes around them.
 */
const mainFile: string = [
  mainHead.code,
  "",
  logging.code,
  "",
  "",
  '@app.get("/healthz")',
  "async def healthz():",
  '    return {"ok": True}',
  "",
  "",
  '@app.get("/users/{user_id}")',
  "async def get_user(user_id: int):",
  '    logger.info("loading user %s", user_id)',
  "    if user_id == 404:",
  '        raise HTTPException(status_code=404, detail="No such user")',
  '    return {"id": user_id, "name": "Ada"}',
  "",
  "",
  createOrder.code,
  "",
  "",
  '@app.get("/boom")',
  "async def boom():",
  '    raise RuntimeError("Payment provider timed out")',
].join("\n");

const appPackages: string =
  "pip install fastapi==0.162.0 uvicorn==0.54.0 httpx==0.28.1";

const requests: Array<{
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}> = [
  { method: "GET", path: "/healthz" },
  { method: "GET", path: "/users/42" },
  { method: "GET", path: "/users/404" },
  {
    method: "POST",
    path: "/orders",
    body: { items: ["kettle", "mug"], payment_method: "card" },
  },
  { method: "GET", path: "/boom" },
];

export const FastApiGuide: OpenTelemetryGuide = {
  slug: "fastapi",
  seo: {
    title: "FastAPI OpenTelemetry: Tracing, Metrics & Logs | OneUptime",
    description:
      "Instrument FastAPI with OpenTelemetry under uvicorn: one clean span per request, async httpx calls, logging with trace IDs, nothing lost on shutdown.",
  },
  h1: "OpenTelemetry for FastAPI",
  lead: "Trace every FastAPI endpoint with the async calls it awaits, and send the traces, metrics and logs to OneUptime. Three lines in `main.py` keep each request to one clean span and send what is buffered when uvicorn stops, and `opentelemetry-instrument` does the rest.",
  cardDescription:
    "Async endpoints under uvicorn: one span per request, httpx calls, logs, nothing lost on shutdown.",
  searchTerms: [
    "uvicorn",
    "asgi",
    "starlette",
    "httpx",
    "async",
    "pydantic",
    "python",
  ],
  highlights: ["One span per request", "async and await", "uvicorn"],

  whatYouGet: {
    intro: `Run uvicorn under \`opentelemetry-instrument\` and every request to your FastAPI app becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, in ${SCREENS.services} from its first request.`,
    traces:
      "A server span per request named after the path operation, such as `GET /users/{user_id}`, with the `httpx` and database calls it awaits nested beneath it, across every `await`.",
    metrics:
      "Request duration, requests in flight and request and response body sizes by route, plus `http.client.request.duration` for the calls your endpoints make.",
    logs: "Records written through Python's `logging`, carrying the trace and span IDs of the request whose coroutine wrote them.",
    exceptions: `An exception that escapes an endpoint is recorded on its request's span and marks it failed, and ${SCREENS.exceptions} groups it with its traceback. An \`HTTPException\` is an answer, not a failure, and is left out.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "fastapi",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 4,
        duration: 90,
        source: "your code",
      },
      {
        name: "POST",
        depth: 2,
        start: 12,
        duration: 76,
        source: "httpx",
      },
    ],
  },

  prerequisites: [
    PYTHON_PREREQUISITE,
    "A FastAPI app served by uvicorn. These steps were checked with FastAPI 0.162 and uvicorn 0.54.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Install the distro, the OTLP exporter over HTTP, and the instrumentations for FastAPI, httpx and logging, at the versions this guide was checked with:",
    snippets: [install],
    notes: [
      "The FastAPI instrumentation brings the ASGI one it is built on.",
      "Calling services with `requests` or `aiohttp` instead of httpx? Add `opentelemetry-instrumentation-requests` or `opentelemetry-instrumentation-aiohttp-client` at the same version.",
    ],
  },

  configure: {
    intro:
      "The standard OpenTelemetry variables tell the SDK where to send, with which key, under which name:",
    tabs: otlpEnvironmentTabs({
      serviceName: "checkout-api",
      extraLines: [OTLP_HTTP_PROTOCOL_LINE, PYTHON_STABLE_HTTP_LINE],
      cloudNote:
        "With `--workers`, every uvicorn worker sends as `checkout-api`, each with its own `service.instance.id`.",
    }),
    notes: [PYTHON_PROTOCOL_NOTE, PYTHON_STABLE_HTTP_NOTE],
  },

  setup: {
    intro:
      "FastAPI works under `opentelemetry-instrument` as it is. Two changes make it better: one span per request instead of three or four, and nothing lost when uvicorn stops.",
    steps: [
      {
        title: "Instrument the app yourself, without the ASGI spans",
        body: "The automatic FastAPI instrumentation adds a span for every ASGI message, two or three per request, named like `GET /users/{user_id} http send`. Turn it off, and instrument the app in `main.py` with those spans left out:",
        snippets: [disableAutomatic, mainHead],
        notes: [
          "`excluded_urls` takes comma-separated regular expressions: load balancer health checks are the first to leave out.",
        ],
      },
      {
        title: "Keep the shutdown hook",
        body: "The `lifespan` above matters as much. uvicorn stops gracefully on SIGTERM, then ends the process with that same signal, which skips the exit hooks OpenTelemetry sends its last batch from: every span, metric and log still buffered is lost on each deploy. Shutting the providers down in the lifespan sends them first.",
      },
      {
        title: "Start uvicorn under opentelemetry-instrument",
        body: "It loads the SDK, the exporters and the other instrumentations before uvicorn imports your app:",
        snippets: [uvicorn],
        notes: [
          "`--reload` and `--workers` both work: each process uvicorn starts runs the same setup.",
          "`fastapi run`, FastAPI's own command, starts uvicorn too: `opentelemetry-instrument fastapi run main.py` works the same way.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "Once the app is instrumented and uvicorn runs under `opentelemetry-instrument`, these are traced:",
    rows: [
      {
        library: "`fastapi`",
        covers:
          "A server span per request named after the path operation (`POST /orders`), with `http.route`, the status code and the client, and an exception that escaped.",
      },
      {
        library: "`httpx`",
        covers:
          "A client span per request made with `AsyncClient` or `Client`, nested under the span that awaited it, with `traceparent` sent along.",
      },
      {
        library: "`asyncpg`, `aiopg`, `sqlalchemy`, `redis`",
        covers:
          "A span per query or command, when their instrumentations are installed: `opentelemetry-bootstrap -a requirements` lists them.",
      },
      {
        library: "`logging`",
        covers:
          "Records with the trace and span IDs of the request they belong to, sent as logs.",
      },
    ],
    snippets: [],
    notes: [
      "Path operations defined on an `APIRouter` and included in the app are traced the same way, by their full path.",
    ],
  },

  manualSpans: {
    intro:
      "Open your own span around the work no library knows about. It follows `await`, so the async calls inside it nest beneath it:",
    snippets: [createOrder],
    notes: [
      "`start_as_current_span` is safe in coroutines: the context it sets travels with the task, not the thread.",
      "For work that keeps running after the response, such as a `BackgroundTasks` function, open a span inside it: it joins the request's trace.",
      "Find a span by its attributes in the **Traces** explorer: `@payment.method:card`.",
    ],
  },

  logs: {
    intro:
      "Configure logging once in `main.py`. With the logging instrumentation installed, records at the root logger's level and above also go to OneUptime, with the trace and span IDs of their request:",
    snippets: [logging],
    notes: [
      "uvicorn's own loggers, `uvicorn.access` and `uvicorn.error`, do not pass records to the root logger, so its access lines and its `Exception in ASGI application` tracebacks stay on the console. The exception itself still reaches OneUptime on the request's span.",
      "Without `logging.basicConfig(level=logging.INFO)`, Python drops INFO records before any handler sees them.",
    ],
  },

  metrics: {
    intro:
      "The FastAPI and httpx instrumentations record, without a line of code:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Every request's duration by `http.route`, method and status code.",
      },
      {
        name: "http.server.active_requests",
        description: "Requests in flight in each worker.",
      },
      {
        name: "http.server.request.body.size",
        description:
          "Request and response body sizes, `http.server.response.body.size` beside it: big payloads behind a slow route show here.",
      },
      {
        name: "http.client.request.duration",
        description: "Every httpx call your endpoints make.",
      },
    ],
    snippets: [],
    notes: [
      "`orders_placed` above shows your own counters: created once at import, incremented where the event happens.",
      "Each uvicorn worker exports its own series; OneUptime adds them up.",
    ],
  },

  sampling: {
    intro:
      "Every request is traced by default. On a busy API, keep a share of the traces:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps one new trace in ten, and follows the caller's decision when a request carries a `traceparent` header.",
      "Health checks are already out, through `excluded_urls`.",
      "Sampling thins out traces, never metrics or logs: request counts and latency percentiles stay exact.",
    ],
  },

  deploy: {
    intro:
      "Put `opentelemetry-instrument` in the image's command, and the key in a Kubernetes Secret:",
    snippets: [
      requirements,
      pythonDockerfileSnippet({
        command: [
          "opentelemetry-instrument",
          "uvicorn",
          "main:app",
          "--host",
          "0.0.0.0",
          "--port",
          "8000",
        ],
        port: 8000,
      }),
      kubernetesManifestSnippet({
        name: "checkout-api",
        image: "registry.example.com/checkout-api:0.9.0",
        containerPort: 8000,
        extraEnv: [
          { name: "OTEL_EXPORTER_OTLP_PROTOCOL", value: "http/protobuf" },
          { name: "OTEL_SEMCONV_STABILITY_OPT_IN", value: "http" },
          { name: "OTEL_PYTHON_DISABLED_INSTRUMENTATIONS", value: "fastapi" },
        ],
      }),
    ],
    notes: [
      "In Kubernetes, run one uvicorn process per pod and scale with replicas. `--workers 4` puts four processes in one container instead, each with its own exporter.",
      "Kubernetes stops a pod with SIGTERM: uvicorn finishes its requests, the lifespan sends what OpenTelemetry holds, and the process ends.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Call an endpoint, then open ${SCREENS.services}: \`checkout-api\` is listed within a minute.`,
      },
      {
        title: "Open a request's trace",
        body: `Filter ${SCREENS.traces} by \`@http.route:/orders\`: each request is one span with \`checkout.charge\` and the httpx call beneath it, and no \`http send\` spans.`,
      },
      {
        title: "Stop the app and check nothing is missing",
        body: `Stop uvicorn with Ctrl+C right after a request. Its spans still arrive in ${SCREENS.traces}: the lifespan sent them on the way out.`,
      },
    ],
  },

  troubleshooting: [
    {
      question:
        "Every request has extra spans named “http send” and “http receive”",
      answer:
        "The automatic FastAPI instrumentation is still on, beside yours or instead of it. Set `OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=fastapi` and keep `FastAPIInstrumentor.instrument_app` with `exclude_spans` in `main.py`.",
    },
    {
      question: "The last requests before a deploy never arrive",
      answer:
        "uvicorn ends the process with the signal that stopped it, so Python's exit hooks never run. Shut the providers down in the app's `lifespan`, as shown above. A handler for SIGTERM in `main.py` does not help: uvicorn puts back the handler it found before importing your app.",
    },
    {
      question: "Logs from my endpoints do not arrive",
      answer:
        "The root logger is still at its default level, WARNING. Call `logging.basicConfig(level=logging.INFO)`, or set the level in your logging config, and check that `opentelemetry-instrumentation-logging` is installed.",
    },
    {
      question: "An httpx call is a separate trace",
      answer:
        "The client was made before the httpx instrumentation was loaded, or the call ran in a thread with no context. Create clients inside the app, as above, and start uvicorn under `opentelemetry-instrument`.",
    },
    {
      question:
        "Nothing arrives, and uvicorn prints “Failed to auto initialize OpenTelemetry”",
      answer:
        "The distro falls back to gRPC when `OTEL_EXPORTER_OTLP_PROTOCOL` is unset: set it to `http/protobuf`.",
    },
  ],

  faq: [
    {
      question: "Does OpenTelemetry work with async FastAPI endpoints?",
      answer:
        "Yes. The context that links a span to its parent follows `await` and asyncio tasks, so spans opened in coroutines, and the httpx calls they await, nest under the right request.",
    },
    {
      question: "Why are 404s not in Exceptions?",
      answer:
        "An `HTTPException` is an answer your API chose to give, so it is not recorded as an exception; the span keeps its status code. Only exceptions that escape an endpoint are.",
    },
    {
      question: "Does it work with gunicorn and uvicorn workers?",
      answer:
        "Yes, the same way: put `opentelemetry-instrument` in front of the gunicorn command, and keep the `lifespan` and `instrument_app` lines in `main.py`.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: the SDK sends straight to OneUptime from each worker. A Collector helps when you want one place to filter, batch or enrich data: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["python", "flask", "django", "celery"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.metrics],

  verification: {
    runtime: "python",
    framework: { name: "FastAPI", package: "fastapi" },
    files: [{ path: "main.py", content: mainFile }],
    stubApiPort: 9000,
    environmentSnippets: ["disable-automatic"],
    commands: [
      { snippet: "install" },
      { command: appPackages },
      { snippet: "uvicorn", isServer: true },
    ],
    port: 8000,
    requests: requests,
    expect: {
      spans: [
        {
          name: "GET /users/{user_id}",
          attributes: { "http.route": "/users/{user_id}" },
        },
        {
          name: "POST /orders",
          attributes: { "http.response.status_code": "201" },
        },
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
        "orders.placed",
      ],
      logs: [{ body: "loading user 42", hasTraceContext: true }],
      resource: { "service.name": "checkout-api" },
      untracedPaths: ["/healthz"],
      absentSpans: [
        "GET /users/{user_id} http send",
        "POST /orders http receive",
        "POST /orders http send",
      ],
      absentLogs: ["HTTP Request: POST"],
    },
    variants: [
      {
        /*
         * Export intervals of 30 seconds and more: everything this run
         * expects can only arrive through the lifespan's shutdown.
         */
        name: "Flush on shutdown",
        files: [{ path: "main.py", content: mainFile }],
        stubApiPort: 9000,
        environmentSnippets: ["disable-automatic"],
        commands: [
          { snippet: "install" },
          { command: appPackages },
          {
            snippet: "uvicorn",
            isServer: true,
            environment: {
              OTEL_BSP_SCHEDULE_DELAY: "30000",
              OTEL_BLRP_SCHEDULE_DELAY: "30000",
              OTEL_METRIC_EXPORT_INTERVAL: "60000",
            },
          },
        ],
        port: 8000,
        requests: requests,
        expect: {
          spans: [
            { name: "GET /users/{user_id}" },
            { name: "checkout.charge" },
          ],
          metrics: ["http.server.request.duration", "orders.placed"],
          logs: [{ body: "loading user 42", hasTraceContext: true }],
        },
      },
    ],
  },
};
