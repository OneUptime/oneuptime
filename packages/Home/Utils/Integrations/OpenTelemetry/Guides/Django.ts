import {
  OpenTelemetryGuide,
  GuideSnippet,
  VerificationService,
} from "../GuideTypes";
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
  "opentelemetry-instrumentation-django",
  "opentelemetry-instrumentation-psycopg",
  "opentelemetry-instrumentation-requests",
  "opentelemetry-instrumentation-logging",
]);

const settingsModule: GuideSnippet = {
  id: "settings-module",
  language: "bash",
  code: 'export DJANGO_SETTINGS_MODULE="shop.settings"',
  check: "run",
};

const gunicorn: GuideSnippet = {
  id: "gunicorn",
  language: "bash",
  code: "opentelemetry-instrument gunicorn shop.wsgi --bind 0.0.0.0:8000 --workers 4",
  check: "run",
};

// uWSGI forks below Python: each worker starts the SDK from wsgi.py instead.
const uwsgiWsgi: GuideSnippet = {
  id: "uwsgi-wsgi",
  language: "python",
  title: "shop/wsgi.py",
  code: [
    "import os",
    "",
    'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "shop.settings")',
    "",
    "# uWSGI forks its workers outside Python, where OpenTelemetry cannot follow.",
    "# With lazy-apps every worker loads this file and starts OpenTelemetry itself.",
    "from opentelemetry.instrumentation.auto_instrumentation import initialize  # noqa: E402",
    "",
    "initialize()",
    "",
    "from django.core.wsgi import get_wsgi_application  # noqa: E402",
    "",
    "application = get_wsgi_application()",
  ].join("\n"),
  check: "run",
};

const uwsgiIni: GuideSnippet = {
  id: "uwsgi-ini",
  language: "ini",
  title: "uwsgi.ini",
  code: [
    "[uwsgi]",
    "http = :8000",
    "module = shop.wsgi:application",
    "master = true",
    "processes = 4",
    "lazy-apps = true",
    "die-on-term = true",
  ].join("\n"),
  check: "run",
};

const uwsgiRun: GuideSnippet = {
  id: "uwsgi-run",
  language: "bash",
  code: "uwsgi --ini uwsgi.ini",
  check: "run",
};

const views: GuideSnippet = {
  id: "views",
  language: "python",
  title: "orders/views.py",
  code: [
    "import json",
    "import logging",
    "import os",
    "",
    "import requests",
    "from django.http import JsonResponse",
    "from django.views.decorators.csrf import csrf_exempt",
    "from django.views.decorators.http import require_POST",
    "from opentelemetry import metrics, trace",
    "",
    "from orders.models import Order",
    "",
    'PAYMENTS_API = os.environ.get("PAYMENTS_API_URL", "http://localhost:9000")',
    "",
    "logger = logging.getLogger(__name__)",
    'tracer = trace.get_tracer("orders")',
    'orders_placed = metrics.get_meter("orders").create_counter(',
    '    "orders.placed", description="Orders placed, by payment method"',
    ")",
    "",
    "",
    "# An API other services call, so it takes no CSRF token.",
    "@csrf_exempt",
    "@require_POST",
    "def create_order(request):",
    "    body = json.loads(request.body)",
    '    with tracer.start_as_current_span("checkout.charge") as span:',
    '        span.set_attribute("order.item_count", len(body["items"]))',
    '        span.set_attribute("payment.method", body["payment_method"])',
    '        requests.post(f"{PAYMENTS_API}/api/charges", json=body, timeout=10)',
    "        order = Order.objects.create(",
    '            item_count=len(body["items"]), payment_method=body["payment_method"]',
    "        )",
    '    orders_placed.add(1, {"payment.method": body["payment_method"]})',
    '    logger.info("placed order %s", order.pk)',
    '    return JsonResponse({"id": order.pk}, status=201)',
  ].join("\n"),
  check: "contained",
};

const logging: GuideSnippet = {
  id: "logging",
  language: "python",
  title: "shop/settings.py",
  code: [
    "LOGGING = {",
    '    "version": 1,',
    '    "disable_existing_loggers": False,',
    '    "handlers": {"console": {"class": "logging.StreamHandler"}},',
    '    "root": {"handlers": ["console"], "level": "INFO"},',
    "}",
  ].join("\n"),
  check: "contained",
};

const excludedUrls: GuideSnippet = {
  id: "excluded-urls",
  language: "bash",
  code: 'export OTEL_PYTHON_DJANGO_EXCLUDED_URLS="healthz"',
  check: "run",
};

const sampling: GuideSnippet = {
  id: "sampling",
  language: "bash",
  code: [
    'export OTEL_TRACES_SAMPLER="parentbased_traceidratio"',
    'export OTEL_TRACES_SAMPLER_ARG="0.2"',
  ].join("\n"),
  check: "parse",
};

const requirements: GuideSnippet = {
  id: "requirements",
  language: "text",
  title: "requirements.txt",
  code: [
    "django==6.1.2",
    "gunicorn==26.2.0",
    "psycopg[binary]==3.3.6",
    "requests==2.34.2",
    "opentelemetry-distro==0.66b1",
    "opentelemetry-exporter-otlp-proto-http==1.45.1",
    "opentelemetry-instrumentation-django==0.66b1",
    "opentelemetry-instrumentation-psycopg==0.66b1",
    "opentelemetry-instrumentation-requests==0.66b1",
    "opentelemetry-instrumentation-logging==0.66b1",
  ].join("\n"),
  check: "parse",
};

/*
 * The project the end-to-end check runs: a Django project with one app,
 * on PostgreSQL, with the page's fragments word for word.
 */
const settingsFile: string = [
  "import os",
  "from pathlib import Path",
  "",
  "BASE_DIR = Path(__file__).resolve().parent.parent",
  'SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "change-me")',
  "DEBUG = False",
  'ALLOWED_HOSTS = ["*"]',
  'INSTALLED_APPS = ["django.contrib.contenttypes", "orders"]',
  "MIDDLEWARE = [",
  '    "django.middleware.security.SecurityMiddleware",',
  '    "django.middleware.common.CommonMiddleware",',
  '    "django.middleware.csrf.CsrfViewMiddleware",',
  "]",
  'ROOT_URLCONF = "shop.urls"',
  'WSGI_APPLICATION = "shop.wsgi.application"',
  "DATABASES = {",
  '    "default": {',
  '        "ENGINE": "django.db.backends.postgresql",',
  '        "NAME": os.environ.get("POSTGRES_DB", "shop"),',
  '        "USER": os.environ.get("POSTGRES_USER", "shop"),',
  '        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""),',
  '        "HOST": os.environ.get("POSTGRES_HOST", "localhost"),',
  '        "PORT": os.environ.get("POSTGRES_PORT", "5432"),',
  "    }",
  "}",
  'DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"',
  "USE_TZ = True",
  "",
  logging.code,
].join("\n");

const viewsFile: string = [
  views.code,
  "",
  "",
  "def healthz(request):",
  '    return JsonResponse({"ok": True})',
  "",
  "",
  "def order_detail(request, order_id):",
  '    logger.info("loading order %s", order_id)',
  "    order = Order.objects.filter(pk=order_id).first()",
  '    return JsonResponse({"id": order_id, "found": order is not None})',
  "",
  "",
  "def boom(request):",
  '    raise RuntimeError("Payment provider timed out")',
].join("\n");

const projectFiles: Array<{ path: string; content: string }> = [
  {
    path: "manage.py",
    content: [
      "import os",
      "import sys",
      "",
      'if __name__ == "__main__":',
      '    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "shop.settings")',
      "    from django.core.management import execute_from_command_line",
      "",
      "    execute_from_command_line(sys.argv)",
    ].join("\n"),
  },
  { path: "shop/__init__.py", content: "" },
  { path: "shop/settings.py", content: settingsFile },
  {
    path: "shop/urls.py",
    content: [
      "from django.urls import path",
      "",
      "from orders import views",
      "",
      "urlpatterns = [",
      '    path("healthz/", views.healthz),',
      '    path("orders/", views.create_order),',
      '    path("orders/<int:order_id>/", views.order_detail),',
      '    path("boom/", views.boom),',
      "]",
    ].join("\n"),
  },
  { path: "orders/__init__.py", content: "" },
  {
    path: "orders/models.py",
    content: [
      "from django.db import models",
      "",
      "",
      "class Order(models.Model):",
      "    item_count = models.IntegerField()",
      "    payment_method = models.CharField(max_length=20)",
    ].join("\n"),
  },
  { path: "orders/views.py", content: viewsFile },
];

const standardWsgi: string = [
  "import os",
  "",
  "from django.core.wsgi import get_wsgi_application",
  "",
  'os.environ.setdefault("DJANGO_SETTINGS_MODULE", "shop.settings")',
  "",
  "application = get_wsgi_application()",
].join("\n");

const postgres: VerificationService = {
  name: "postgres",
  image: "postgres:15",
  containerPort: 5432,
  environment: {
    POSTGRES_USER: "shop",
    POSTGRES_PASSWORD: "shop",
    POSTGRES_DB: "shop",
  },
  appEnvironment: {
    POSTGRES_HOST: "127.0.0.1",
    POSTGRES_PORT: "{port}",
    POSTGRES_USER: "shop",
    POSTGRES_PASSWORD: "shop",
    POSTGRES_DB: "shop",
  },
  readyLog: { text: "database system is ready to accept connections", times: 2 },
};

const appPackages: string =
  'pip install django==6.1.2 gunicorn==26.2.0 "psycopg[binary]==3.3.6" requests==2.34.2';

const prepareDatabase: Array<{ command: string }> = [
  { command: "python manage.py makemigrations orders" },
  { command: "python manage.py migrate" },
];

const requests: Array<{
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
}> = [
  { method: "GET", path: "/healthz/" },
  { method: "GET", path: "/orders/42/" },
  {
    method: "POST",
    path: "/orders/",
    body: { items: ["kettle", "mug"], payment_method: "card" },
  },
  { method: "GET", path: "/boom/" },
];

export const DjangoGuide: OpenTelemetryGuide = {
  slug: "django",
  seo: {
    title: "Django OpenTelemetry: Tracing, Metrics & Logs | OneUptime",
    description:
      "Instrument Django with OpenTelemetry: views traced by URL pattern, ORM queries, logging with trace IDs, under gunicorn or uWSGI, sent to OneUptime.",
  },
  h1: "OpenTelemetry for Django",
  lead: "Trace every Django request by its URL pattern, with the ORM's queries and the calls your views make beneath it, and send the traces, metrics and logs to OneUptime. One environment variable, one command in front of gunicorn, and no change to your views.",
  cardDescription:
    "Views traced by URL pattern, ORM queries and logging with trace IDs, under gunicorn or uWSGI.",
  searchTerms: [
    "django orm",
    "gunicorn",
    "uwsgi",
    "wsgi",
    "postgresql",
    "psycopg",
    "python",
  ],
  highlights: [
    "Zero-code under gunicorn",
    "uWSGI with lazy-apps",
    "Django 6.1",
  ],

  whatYouGet: {
    intro: `Run Django under \`opentelemetry-instrument\` and every request becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, listed in ${SCREENS.services} as soon as it sends.`,
    traces:
      "A server span per request named after the method and the URL pattern that matched, such as `GET orders/<int:order_id>/`, with each ORM query and each outgoing HTTP call as a child span.",
    metrics:
      "`http.server.request.duration` and `http.server.active_requests` by `http.route`, method and status, so each URL pattern has its own latency and error rate, beside the counters you add.",
    logs: "Every record your code and Django write through `logging`, stamped with the trace and span of the request it belongs to, including Django's own `Internal Server Error` lines.",
    exceptions: `An exception a view raises is recorded on the request's span, which is marked failed, and Django's error log arrives with the traceback. ${SCREENS.exceptions} groups both under one issue.`,
  },

  exampleTrace: {
    caption: "A POST /orders/ request, as its trace shows it",
    spans: [
      {
        name: "POST orders/",
        depth: 0,
        start: 0,
        duration: 100,
        source: "django",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 6,
        duration: 86,
        source: "your code",
      },
      {
        name: "POST",
        depth: 2,
        start: 10,
        duration: 52,
        source: "requests",
      },
      {
        name: "INSERT",
        depth: 2,
        start: 66,
        duration: 21,
        source: "psycopg",
      },
    ],
  },

  prerequisites: [
    PYTHON_PREREQUISITE,
    "A Django project served by gunicorn or uWSGI. These steps were checked with Django 6.1 on PostgreSQL.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Install the distro, the OTLP exporter over HTTP, and the instrumentations for Django, your database driver, your HTTP client and logging. These are the versions this guide was checked with:",
    snippets: [install],
    notes: [
      "The database instrumentation follows your driver: `opentelemetry-instrumentation-psycopg` for psycopg 3, `opentelemetry-instrumentation-psycopg2` for psycopg2, `opentelemetry-instrumentation-mysqlclient` for MySQL, `opentelemetry-instrumentation-sqlite3` for SQLite.",
      "Not sure which your project needs? `opentelemetry-bootstrap -a requirements` prints one instrumentation per library installed in your environment.",
    ],
  },

  configure: {
    intro:
      "Where to send and which key to send come from the standard OpenTelemetry variables, set wherever gunicorn gets its environment:",
    tabs: otlpEnvironmentTabs({
      serviceName: "shop-web",
      extraLines: [OTLP_HTTP_PROTOCOL_LINE, PYTHON_STABLE_HTTP_LINE],
      cloudNote:
        "Run Celery workers from the same project? Give them their own `OTEL_SERVICE_NAME`, such as `shop-worker`, so OneUptime lists the web app and the workers apart.",
    }),
    notes: [PYTHON_PROTOCOL_NOTE, PYTHON_STABLE_HTTP_NOTE],
  },

  setup: {
    intro:
      "Two steps: name your settings module in the environment, then start your server under OpenTelemetry. gunicorn needs nothing else; uWSGI needs its workers to start OpenTelemetry themselves.",
    steps: [
      {
        title: "Name your settings module in the environment",
        body: "The Django instrumentation reads your `MIDDLEWARE` setting as it loads, before `wsgi.py` runs, so `DJANGO_SETTINGS_MODULE` has to be in the environment, not only set by `manage.py` or `wsgi.py`:",
        snippets: [settingsModule],
        notes: [
          "Without it, the instrumentation configures empty settings, and every request then fails with `AttributeError: module 'django.conf.global_settings' has no attribute 'ROOT_URLCONF'`.",
        ],
      },
      {
        title: "Start the server under OpenTelemetry",
        body: "Pick your server:",
        tabs: {
          group: "setup",
          tabs: [
            {
              label: "gunicorn",
              body: "Put `opentelemetry-instrument` in front of the command that starts gunicorn:",
              snippets: [gunicorn],
              notes: [
                "Each worker gunicorn forks starts its own exporter after the fork, so any number of workers works, with `--preload` too.",
                "In development, `opentelemetry-instrument python manage.py runserver` works as well, autoreloader included.",
              ],
            },
            {
              label: "uWSGI",
              body: "Do not wrap uWSGI in `opentelemetry-instrument`: it forks its workers below Python, so the exporters started before the fork stop sending metrics. Start OpenTelemetry in `wsgi.py`, and let each worker load it with `lazy-apps`:",
              snippets: [uwsgiWsgi, uwsgiIni, uwsgiRun],
              notes: [
                "`lazy-apps = true` is what makes each worker run `wsgi.py` itself, after the fork. Without it, uWSGI loads the app once in its master and copies it into the workers.",
                "`die-on-term` makes SIGTERM stop uWSGI, as Docker and Kubernetes expect, so the workers send their last batch on the way out.",
              ],
            },
          ],
        },
      },
      {
        title: "Send a few requests",
        body: "Call a view or two. Spans and logs leave in batches every few seconds, metrics once a minute.",
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "The Django instrumentation adds a middleware of its own at the top of `MIDDLEWARE`; the others patch the libraries your views use:",
    rows: [
      {
        library: "`django`",
        covers:
          "A server span per request named after its URL pattern (`GET orders/<int:order_id>/`), with `http.route`, the status code and the client's address, and the exception of a view that raised one.",
      },
      {
        library: "`psycopg`, `psycopg2`, `mysqlclient`, `sqlite3`",
        covers:
          "A span per SQL statement the ORM sends, with the database system and the query, under the request that ran it.",
      },
      {
        library: "`requests`, `httpx`, `urllib3`",
        covers:
          "A client span per outgoing call, carrying `traceparent` so the service you call joins the same trace.",
      },
      {
        library: "`redis`, `pymemcache`",
        covers: "A span per cache command, such as those Django's cache backends send.",
      },
      {
        library: "`logging`",
        covers:
          "Your records and Django's, with trace and span IDs, sent as logs.",
      },
    ],
    snippets: [],
    notes: [
      "Celery tasks queued from a view continue the view's trace in the worker: see the [Celery guide](/integrations/opentelemetry/celery).",
    ],
  },

  manualSpans: {
    intro:
      "The request's span and the queries beneath it come for free. For the work in between, such as charging a card, open a span of your own around it:",
    snippets: [views],
    notes: [
      "The span opened in the view nests under the request's span, and the payment call and the `INSERT` the ORM sends nest under it.",
      'Set attributes your team will search by, then find them in the **Traces** explorer, such as `@payment.method:card`.',
      "An exception raised inside the `with` block is recorded on `checkout.charge` with its traceback, and on the request's span too if the view lets it through.",
    ],
  },

  logs: {
    intro:
      "Keep your logging configuration. Django applies `LOGGING` when it starts, and the OpenTelemetry handler on the root logger survives it; the root logger's level decides what reaches OneUptime:",
    snippets: [logging],
    notes: [
      "With this configuration, records at INFO and above go to the console and to OneUptime, each with the trace and span IDs of its request.",
      "Django logs a view's unhandled exception on `django.request` as `Internal Server Error: /path/`, with the traceback, which files it under **Exceptions** beside the span's.",
      "As it sends that record, OpenTelemetry may print `Invalid type <class 'django.core.handlers.wsgi.WSGIRequest'> for attribute value`: Django attaches the request object, which is sent as text. It is harmless.",
    ],
  },

  metrics: {
    intro: "The Django instrumentation records, without a line of code:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "How long each request took, by `http.route`, method and status code: the latency and error rate of every URL pattern.",
      },
      {
        name: "http.server.active_requests",
        description:
          "Requests in flight per worker. Rising with flat traffic means a view is waiting on something.",
      },
      {
        name: "http.client.request.duration",
        description:
          "The outgoing calls your views make with `requests`, by server and status.",
      },
    ],
    snippets: [],
    notes: [
      'Your own metrics, as `orders_placed` in the view above: create the instrument once at import, then call `orders_placed.add(1, {"payment.method": "card"})`.',
      "Each gunicorn worker exports its own series, told apart by `service.instance.id`, and OneUptime adds them up in charts.",
      "Keep attribute values to a small set. A user or order ID makes a new series for every value.",
    ],
  },

  sampling: {
    intro:
      "Leave load balancer health checks out of your traces, then sample the rest once traffic grows:",
    snippets: [excludedUrls, sampling],
    notes: [
      "`OTEL_PYTHON_DJANGO_EXCLUDED_URLS` takes comma-separated regular expressions matched against the path, such as `healthz,static/`.",
      "`parentbased_traceidratio` keeps a fifth of new traces and follows the caller's decision when a request arrives with a `traceparent` header.",
      "Metrics and logs are not sampled: `http.server.request.duration` still counts every request.",
    ],
  },

  deploy: {
    intro:
      "Bake `DJANGO_SETTINGS_MODULE` and the `opentelemetry-instrument` command into the image, and pass the key at run time:",
    snippets: [
      requirements,
      pythonDockerfileSnippet({
        command: [
          "opentelemetry-instrument",
          "gunicorn",
          "shop.wsgi",
          "--bind",
          "0.0.0.0:8000",
          "--workers",
          "4",
        ],
        port: 8000,
        environment: { DJANGO_SETTINGS_MODULE: "shop.settings" },
      }),
      kubernetesManifestSnippet({
        name: "shop-web",
        image: "registry.example.com/shop-web:5.2.0",
        containerPort: 8000,
        extraEnv: [
          { name: "OTEL_EXPORTER_OTLP_PROTOCOL", value: "http/protobuf" },
          { name: "OTEL_SEMCONV_STABILITY_OPT_IN", value: "http" },
          { name: "OTEL_PYTHON_DJANGO_EXCLUDED_URLS", value: "healthz" },
        ],
      }),
    ],
    notes: [
      "gunicorn handles SIGTERM itself: it stops taking requests, lets the workers finish, and each worker sends its last batch as it exits.",
      "Run `migrate` and `collectstatic` without `opentelemetry-instrument`, or give them their own service name, so their queries do not land in the web app's traces.",
      "To see the pods and nodes beside the service, install the [Kubernetes agent](/docs/telemetry/kubernetes-agent).",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Request a page, then open ${SCREENS.services}: \`shop-web\` appears within a minute.`,
      },
      {
        title: "Open a request's trace",
        body: `In ${SCREENS.traces}, search \`@http.route:orders/\`. Each request is a trace, with \`checkout.charge\`, the payment call and the \`INSERT\` beneath it.`,
      },
      {
        title: "Follow a log line to its request",
        body: `In ${SCREENS.logs}, open a \`placed order\` line: its trace ID opens the request that wrote it.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Every request fails with “no attribute 'ROOT_URLCONF'”",
      answer:
        "`DJANGO_SETTINGS_MODULE` is not in the environment, so the instrumentation set up empty settings before `wsgi.py` could name yours. Export it before starting the server, in the shell, the Dockerfile or the Deployment.",
    },
    {
      question: "Under uWSGI, traces arrive but metrics never do",
      answer:
        "uWSGI forked its workers after `opentelemetry-instrument` started the exporters in the master. Start OpenTelemetry in `wsgi.py` with `initialize()` and set `lazy-apps = true`, as the uWSGI tab shows, and stop wrapping uWSGI in `opentelemetry-instrument`.",
    },
    {
      question: "Requests are traced but their queries are not",
      answer:
        "The instrumentation for your database driver is missing, or is the wrong one: psycopg 3 needs `opentelemetry-instrumentation-psycopg`, psycopg2 the `-psycopg2` one. `OTEL_LOG_LEVEL=debug` prints which instrumentations loaded.",
    },
    {
      question: "Spans are named GET or POST, with no URL pattern",
      answer:
        "The request did not reach a URL pattern: a middleware answered it first, or no pattern matched, as for a 404. Requests that reach a view carry their pattern.",
    },
    {
      question: "Nothing arrives, and the server prints “Failed to auto initialize OpenTelemetry”",
      answer:
        "`OTEL_EXPORTER_OTLP_PROTOCOL` is unset, so the distro looked for the gRPC exporter: set it to `http/protobuf`. Django keeps serving requests without telemetry, which is why nothing else complains.",
    },
  ],

  faq: [
    {
      question: "Which Django versions does the instrumentation support?",
      answer:
        "`opentelemetry-instrumentation-django` supports Django 2.0 and later, and this guide was checked with Django 6.1 on Python 3.14.",
    },
    {
      question: "Do I have to change my views?",
      answer:
        "No. Views, middleware and the ORM are traced as they are. Code is only for what no library knows about, such as `checkout.charge` above.",
    },
    {
      question: "Can I run it with runserver?",
      answer:
        "Yes, for development: `opentelemetry-instrument python manage.py runserver`, with the same variables. The autoreloader's new process is instrumented too.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No. Each gunicorn worker sends straight to OneUptime. A Collector helps when many services should send through one place, or to filter data before it leaves your network: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["python", "celery", "flask", "fastapi"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.exceptions],

  verification: {
    runtime: "python",
    framework: { name: "Django", package: "django" },
    files: [...projectFiles, { path: "shop/wsgi.py", content: standardWsgi }],
    services: [postgres],
    stubApiPort: 9000,
    environmentSnippets: ["settings-module", "excluded-urls"],
    commands: [
      { snippet: "install" },
      { command: appPackages },
      ...prepareDatabase,
      { snippet: "gunicorn", isServer: true },
    ],
    port: 8000,
    requests: requests,
    expect: {
      spans: [
        {
          name: "GET orders/<int:order_id>/",
          attributes: { "http.route": "orders/<int:order_id>/" },
        },
        {
          name: "POST orders/",
          attributes: { "http.response.status_code": "201" },
        },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
        },
        { name: "POST", attributes: { "http.request.method": "POST" } },
        {
          name: "GET boom/",
          hasException: true,
          exceptionMessage: "Payment provider timed out",
        },
      ],
      metrics: [
        "http.server.request.duration",
        "http.server.active_requests",
        "orders.placed",
      ],
      logs: [
        { body: "loading order 42", hasTraceContext: true },
        { body: "placed order", hasTraceContext: true },
        {
          body: "Internal Server Error: /boom/",
          hasTraceContext: true,
          hasException: true,
        },
      ],
      resource: { "service.name": "shop-web" },
      untracedPaths: ["/healthz/"],
    },
    variants: [
      {
        name: "uWSGI",
        files: [
          ...projectFiles,
          { path: "shop/wsgi.py", snippet: "uwsgi-wsgi" },
          { path: "uwsgi.ini", snippet: "uwsgi-ini" },
        ],
        services: [postgres],
        stubApiPort: 9000,
        environmentSnippets: ["settings-module", "excluded-urls"],
        commands: [
          { snippet: "install" },
          { command: appPackages },
          // uWSGI as a wheel: the source package needs a C compiler to install.
          { command: "pip install pyuwsgi==2.0.30.post1" },
          ...prepareDatabase,
          { snippet: "uwsgi-run", isServer: true },
        ],
        port: 8000,
        requests: requests,
        expect: {
          spans: [
            {
              name: "GET orders/<int:order_id>/",
              attributes: { "http.route": "orders/<int:order_id>/" },
            },
            { name: "checkout.charge" },
          ],
          // The metrics a wrapped uWSGI never sends: the reason for this setup.
          metrics: ["http.server.request.duration", "orders.placed"],
          logs: [{ body: "loading order 42", hasTraceContext: true }],
          resource: { "service.name": "shop-web" },
        },
      },
    ],
  },
};
