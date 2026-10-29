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
  "opentelemetry-instrumentation-celery",
  "opentelemetry-instrumentation-requests",
  "opentelemetry-instrumentation-logging",
]);

const quietBroker: GuideSnippet = {
  id: "quiet-broker",
  language: "bash",
  code: 'export OTEL_PYTHON_DISABLED_INSTRUMENTATIONS="redis"',
  check: "run",
};

const tasksHead: GuideSnippet = {
  id: "tasks-head",
  language: "python",
  title: "tasks.py",
  code: [
    "import logging",
    "import os",
    "",
    "import requests",
    "from celery import Celery",
    "from celery.signals import after_setup_logger",
    "from opentelemetry import metrics, trace",
    "from opentelemetry._logs import get_logger_provider",
    "from opentelemetry.instrumentation.logging.handler import LoggingHandler",
    "",
    'PAYMENTS_API = os.environ.get("PAYMENTS_API_URL", "http://localhost:9000")',
    "",
    "app = Celery(",
    '    "shop", broker=os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")',
    ")",
    "",
    "logger = logging.getLogger(__name__)",
    'tracer = trace.get_tracer("shop.tasks")',
    'charges = metrics.get_meter("shop.tasks").create_counter(',
    '    "payments.charged", description="Cards charged, by result"',
    ")",
    "",
    "",
    "# The worker replaces the root logger's handlers with its own as it starts:",
    "# give OpenTelemetry's back, so task logs reach OneUptime.",
    "@after_setup_logger.connect",
    "def send_logs_to_opentelemetry(**kwargs):",
    '    kwargs["logger"].addHandler(LoggingHandler(logger_provider=get_logger_provider()))',
  ].join("\n"),
  check: "contained",
};

const tasksBody: GuideSnippet = {
  id: "tasks-body",
  language: "python",
  title: "tasks.py",
  code: [
    "@app.task",
    "def charge_card(order_id, amount):",
    '    with tracer.start_as_current_span("payments.authorize") as span:',
    '        span.set_attribute("order.id", order_id)',
    '        span.set_attribute("payment.amount", amount)',
    '        requests.post(f"{PAYMENTS_API}/api/charges", json={"order": order_id}, timeout=10)',
    '    charges.add(1, {"payment.result": "approved"})',
    '    logger.info("charged order %s", order_id)',
    "",
    "",
    "@app.task",
    "def refund(order_id):",
    '    raise RuntimeError(f"Refund for {order_id} was declined")',
  ].join("\n"),
  check: "contained",
};

/*
 * The worker the check runs: the page's two fragments, and a task that
 * fails once and is retried, for what the FAQ says about retries.
 */
const tasksFile: string = [
  tasksHead.code,
  "",
  "",
  tasksBody.code,
  "",
  "",
  "@app.task(bind=True, max_retries=1, default_retry_delay=0)",
  "def send_receipt(self, order_id):",
  "    if self.request.retries == 0:",
  '        raise self.retry(exc=ConnectionError("Mail server busy"))',
  '    logger.info("sent receipt for %s", order_id)',
].join("\n");

const producerFile: string = [
  "from opentelemetry import trace",
  "",
  "from tasks import charge_card, refund, send_receipt",
  "",
  'tracer = trace.get_tracer("shop.checkout")',
  "",
  'with tracer.start_as_current_span("checkout.place-order"):',
  '    charge_card.delay("ord_1001", 120)',
  '    refund.delay("ord_0999")',
  '    send_receipt.delay("ord_1001")',
].join("\n");

const worker: GuideSnippet = {
  id: "worker",
  language: "bash",
  code: "opentelemetry-instrument celery -A tasks worker --loglevel=INFO",
  check: "run",
};

const producer: GuideSnippet = {
  id: "producer",
  language: "python",
  title: "checkout.py",
  code: [
    'tracer = trace.get_tracer("shop.checkout")',
    "",
    'with tracer.start_as_current_span("checkout.place-order"):',
    '    charge_card.delay("ord_1001", 120)',
    '    refund.delay("ord_0999")',
  ].join("\n"),
  check: "contained",
};

const runProducer: GuideSnippet = {
  id: "run-producer",
  language: "bash",
  code: "OTEL_SERVICE_NAME=shop-web opentelemetry-instrument python checkout.py",
  check: "run",
};

const beat: GuideSnippet = {
  id: "beat",
  language: "bash",
  code: "OTEL_SERVICE_NAME=shop-beat opentelemetry-instrument celery -A tasks beat",
  check: "parse",
};

const sampling: GuideSnippet = {
  id: "sampling",
  language: "bash",
  code: [
    'export OTEL_TRACES_SAMPLER="parentbased_traceidratio"',
    'export OTEL_TRACES_SAMPLER_ARG="0.5"',
  ].join("\n"),
  check: "parse",
};

const requirements: GuideSnippet = {
  id: "requirements",
  language: "text",
  title: "requirements.txt",
  code: [
    "celery[redis]==5.6.3",
    "redis==6.4.0",
    "requests==2.34.2",
    "opentelemetry-distro==0.66b1",
    "opentelemetry-exporter-otlp-proto-http==1.45.1",
    "opentelemetry-instrumentation-celery==0.66b1",
    "opentelemetry-instrumentation-requests==0.66b1",
    "opentelemetry-instrumentation-logging==0.66b1",
  ].join("\n"),
  check: "parse",
};

export const CeleryGuide: OpenTelemetryGuide = {
  slug: "celery",
  seo: {
    title: "Celery OpenTelemetry: Task Tracing & Worker Logs | OneUptime",
    description:
      "Trace Celery tasks with OpenTelemetry: one trace from the code that queues a task to the worker that runs it, failed tasks, task logs, sent to OneUptime.",
  },
  h1: "OpenTelemetry for Celery",
  lead: "Follow a Celery task from the request that queued it to the worker process that ran it, in one trace, and send the workers' traces, metrics and logs to OneUptime. One command for the worker, one signal handler for its logs, and one switch that keeps the broker's polling out of your traces.",
  cardDescription:
    "One trace from the code that queues a task to the worker that runs it, with failures and task logs.",
  searchTerms: [
    "task queue",
    "worker",
    "redis",
    "rabbitmq",
    "celery beat",
    "background jobs",
    "python",
  ],
  highlights: ["Queue to worker in one trace", "Prefork workers", "Celery 5"],

  whatYouGet: {
    intro: `The worker and the code that queues its tasks each report as a service of their own, \`shop-worker\` and \`shop-web\` below, both in ${SCREENS.services}, and a task's trace runs through both.`,
    traces:
      "A producer span where a task is queued, `apply_async/tasks.charge_card`, and a consumer span where a worker runs it, `run/tasks.charge_card`, in the same trace, with the task's own spans and calls beneath it.",
    metrics:
      "How long each task ran, as `flower.task.runtime.seconds` by task name, plus the counters your tasks record and the duration of the calls they make.",
    logs: "Your tasks' records, and Celery's own `Task ... succeeded` and `raised unexpected` lines, each with the trace and span of the task run it belongs to.",
    exceptions: `A task that raises is recorded on its run span, marked failed with \`celery.state\` set to \`FAILURE\`, and its traceback arrives with Celery's error log. ${SCREENS.exceptions} groups them by error.`,
  },

  exampleTrace: {
    caption: "An order's payment, queued by the web app and run by a worker",
    spans: [
      {
        name: "checkout.place-order",
        depth: 0,
        start: 0,
        duration: 100,
        source: "shop-web",
      },
      {
        name: "apply_async/tasks.charge_card",
        depth: 1,
        start: 3,
        duration: 6,
        source: "celery",
      },
      {
        name: "run/tasks.charge_card",
        depth: 2,
        start: 18,
        duration: 78,
        source: "worker",
      },
      {
        name: "payments.authorize",
        depth: 3,
        start: 21,
        duration: 66,
        source: "your code",
      },
      {
        name: "POST",
        depth: 4,
        start: 25,
        duration: 58,
        source: "requests",
      },
    ],
  },

  prerequisites: [
    PYTHON_PREREQUISITE,
    "A Celery 5 app with Redis or RabbitMQ as its broker. These steps were checked with Celery 5.6 on Redis 8.2, with the default prefork pool.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Install the distro, the OTLP exporter over HTTP, and the instrumentations for Celery, your HTTP client and logging, in the environment of both the worker and the code that queues tasks:",
    snippets: [install],
    notes: [
      "The Celery instrumentation traces both sides: queuing a task where `.delay()` or `.apply_async()` is called, and running it in the worker.",
      "Running Celery beside Django or Flask? Install their instrumentations too, from the [Django guide](/integrations/opentelemetry/django) or the [Flask guide](/integrations/opentelemetry/flask): the web app is the side that queues.",
    ],
  },

  configure: {
    intro:
      "Give the worker its own service name, so its spans and the web app's are told apart:",
    tabs: otlpEnvironmentTabs({
      serviceName: "shop-worker",
      extraLines: [OTLP_HTTP_PROTOCOL_LINE, PYTHON_STABLE_HTTP_LINE],
      cloudNote:
        "Start the web app or script that queues tasks with the same variables and its own `OTEL_SERVICE_NAME`, such as `shop-web`.",
    }),
    notes: [PYTHON_PROTOCOL_NOTE, PYTHON_STABLE_HTTP_NOTE],
  },

  setup: {
    intro:
      "Three steps for the worker: keep the broker's polling out of your traces, give the logs their handler back, and start it under `opentelemetry-instrument`.",
    steps: [
      {
        title: "Keep the broker's polling out of your traces",
        body: "With Redis as the broker, the Redis instrumentation traces the worker's own polling: `PING`, `LLEN`, `SADD` and more, dozens of traces a minute that are not your work. Turn it off for the worker:",
        snippets: [quietBroker],
        notes: [
          "This also leaves untraced any Redis commands your tasks send themselves. If those matter more than a quiet trace list, keep it on and filter the broker's spans out with a [drop filter](/docs/telemetry/drop-filters-and-scrub-rules).",
        ],
      },
      {
        title: "Give the logs their handler back",
        body: "As it starts, the worker replaces the root logger's handlers with its own, and with them the one that sends records to OneUptime. Add it back once Celery has set up its logging, in the module that defines your app:",
        snippets: [tasksHead],
      },
      {
        title: "Start the worker under opentelemetry-instrument",
        body: "Put `opentelemetry-instrument` in front of the worker command. Each process of the prefork pool sets its exporters up again after the fork:",
        snippets: [worker],
        notes: [
          "With these packages there is no need for a `worker_process_init` handler: the instrumentation already runs in every pool process.",
        ],
      },
      {
        title: "Queue tasks from instrumented code",
        body: "The side that queues tasks starts the trace. Run it under `opentelemetry-instrument` with its own name, and every `.delay()` carries the trace to the worker in the message's headers:",
        snippets: [producer, runProducer],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "The Celery instrumentation covers both ends of the queue; the others, the work inside your tasks:",
    rows: [
      {
        library: "`celery` (queuing)",
        covers:
          "A producer span named `apply_async/<task>` where `.delay()` or `.apply_async()` is called, with `celery.task_name`, the message ID and the queue, and the trace context written into the message.",
      },
      {
        library: "`celery` (running)",
        covers:
          "A consumer span named `run/<task>` in the worker, a child of the producer span, with `celery.state` (`SUCCESS`, `FAILURE`, `RETRY`) and the exception of a failed run.",
      },
      {
        library: "`requests`, `httpx`",
        covers: "A client span per call your tasks make.",
      },
      {
        library: "`psycopg`, `sqlalchemy`, `pymongo`",
        covers:
          "A span per query, with their instrumentations installed: `opentelemetry-bootstrap -a requirements` lists what your environment needs.",
      },
      {
        library: "`logging`",
        covers:
          "Task records with trace and span IDs, once the handler is back as shown above.",
      },
    ],
    snippets: [],
    notes: [
      "A task queued from inside another task joins the same trace: the chain of a canvas or a retry reads as one story.",
    ],
  },

  manualSpans: {
    intro:
      "A task's run span is there already. Open spans inside it for its steps, such as `payments.authorize` here, with the attributes you will search by:",
    snippets: [tasksBody],
    notes: [
      "Spans opened in a task nest under its `run/` span, and the calls made inside them nest under them.",
      "An exception that leaves the task fails its run span; one caught inside a span you opened is recorded on that span only if you let it through.",
      "Find the runs of one order in the **Traces** explorer with `@order.id:ord_1001`.",
    ],
  },

  logs: {
    intro:
      "With the handler back, task records reach OneUptime with the trace and span of the run that wrote them, beside Celery's own lines about every task:",
    snippets: [],
    notes: [
      "`--loglevel=INFO` sets what the worker logs at all, and so what reaches OneUptime.",
      "Celery logs every failed task as `Task tasks.refund[...] raised unexpected: RuntimeError(...)` with the traceback, which files it under **Exceptions**.",
      "Celery's `Task ... received` lines are written outside any task, so they arrive without a trace ID; `succeeded` and `raised unexpected` carry the run's.",
    ],
  },

  metrics: {
    intro: "Exported every 60 seconds from each pool process:",
    builtIn: [
      {
        name: "flower.task.runtime.seconds",
        description:
          "How long each task took, by `task`: Celery's name for it, kept from Flower, the dashboard it comes from.",
      },
      {
        name: "http.client.request.duration",
        description:
          "The calls your tasks make with `requests`, by server and status.",
      },
    ],
    snippets: [],
    notes: [
      "Count outcomes your team cares about, as `payments.charged` does above, with a small set of attribute values such as the result.",
      "Each pool process exports its own series, told apart by `service.instance.id`; OneUptime adds them up in charts.",
    ],
  },

  sampling: {
    intro:
      "A task's run follows the sampling decision made where it was queued, so a trace is never cut in half between the web app and the worker. Set the sampler where traces start:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps half of new traces. On the worker, a run follows the decision carried in its message.",
      "Logs and metrics are not sampled: every task's duration is still counted.",
    ],
  },

  deploy: {
    intro:
      "A worker takes no requests, so its Deployment has no port. Start it under `opentelemetry-instrument`, and run beat, if you use it, as a single replica of its own:",
    snippets: [
      requirements,
      pythonDockerfileSnippet({
        command: [
          "opentelemetry-instrument",
          "celery",
          "-A",
          "tasks",
          "worker",
          "--loglevel=INFO",
        ],
      }),
      kubernetesManifestSnippet({
        name: "shop-worker",
        image: "registry.example.com/shop-worker:5.6.0",
        extraEnv: [
          { name: "OTEL_EXPORTER_OTLP_PROTOCOL", value: "http/protobuf" },
          { name: "OTEL_PYTHON_DISABLED_INSTRUMENTATIONS", value: "redis" },
          { name: "CELERY_BROKER_URL", value: "redis://redis:6379/0" },
        ],
      }),
      beat,
    ],
    notes: [
      "On SIGTERM, the worker stops taking tasks, finishes the ones running, and each pool process sends what it holds as it exits: give the pod a grace period longer than your longest task.",
      "Run beat under `opentelemetry-instrument` too, as above, with its own name: each periodic task it queues starts a trace.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find both services",
        body: `Start the worker and queue a task: ${SCREENS.services} lists \`shop-worker\` and \`shop-web\`.`,
      },
      {
        title: "Follow a task through the queue",
        body: `In ${SCREENS.traces}, search \`checkout.place-order\`: the trace holds the queuing span, the worker's \`run/tasks.charge_card\` and the payment call.`,
      },
      {
        title: "Read the failed task",
        body: `The \`run/tasks.refund\` span is red, and ${SCREENS.logs} has Celery's \`raised unexpected\` line with its traceback.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "The worker's spans arrive, but none of its logs",
      answer:
        "The worker removed OpenTelemetry's handler when it set up its own logging. Add it back in `after_setup_logger`, as shown above, or set `worker_hijack_root_logger = False` and configure logging yourself.",
    },
    {
      question: "My traces fill with PING, LLEN and SADD",
      answer:
        "That is the worker polling Redis, its broker, traced by the Redis instrumentation. Set `OTEL_PYTHON_DISABLED_INSTRUMENTATIONS=redis` on the worker.",
    },
    {
      question: "The worker's spans are separate traces from the web app's",
      answer:
        "The code that queued the task ran without OpenTelemetry, so there was no trace to carry. Start it under `opentelemetry-instrument` with the Celery instrumentation installed: it writes the trace context into each message.",
    },
    {
      question:
        "Nothing arrives, and the worker prints “Failed to auto initialize OpenTelemetry”",
      answer:
        "`OTEL_EXPORTER_OTLP_PROTOCOL` is missing, and without it the distro loads its gRPC exporter: set it to `http/protobuf`. The worker runs tasks anyway, without telemetry.",
    },
    {
      question: "pip cannot install redis 8 with Celery",
      answer:
        "Celery 5.6's Redis support pins the `redis` client below 7: install `celery[redis]==5.6.3` and let it choose, or pin `redis==6.4.0` as above.",
    },
  ],

  faq: [
    {
      question: "Do I need worker_process_init to set OpenTelemetry up?",
      answer:
        "Not under `opentelemetry-instrument`: with these packages, every process of the prefork pool exports by itself, as this guide's check shows. Set it up in `worker_process_init` only when you configure the SDK in code.",
    },
    {
      question: "Does it work with RabbitMQ?",
      answer:
        "Yes. The trace context travels in the message's headers whatever the broker. With RabbitMQ there is no Redis polling to turn off.",
    },
    {
      question: "Are retries traced?",
      answer:
        "Yes: each attempt is a run span of its own, the retried ones with `celery.state` set to `RETRY`, all in the trace of the task's first queuing.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: each pool process sends straight to OneUptime. A Collector helps when you want one place to filter or batch what many workers send: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["python", "django", "flask", "fastapi"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.dropFilters],

  verification: {
    runtime: "python",
    framework: { name: "Celery", package: "celery" },
    files: [
      { path: "tasks.py", content: tasksFile },
      { path: "checkout.py", content: producerFile },
    ],
    services: [
      {
        name: "redis",
        image: "redis:8.2-alpine",
        containerPort: 6379,
        appEnvironment: { CELERY_BROKER_URL: "redis://127.0.0.1:{port}/0" },
      },
    ],
    stubApiPort: 9000,
    environmentSnippets: ["quiet-broker"],
    commands: [
      { snippet: "install" },
      {
        command:
          'pip install "celery[redis]==5.6.3" redis==6.4.0 requests==2.34.2',
      },
      { snippet: "worker", isServer: true, readyText: " ready." },
      { snippet: "run-producer" },
    ],
    requests: [],
    expect: {
      spans: [
        { name: "checkout.place-order" },
        {
          name: "apply_async/tasks.charge_card",
          attributes: {
            "celery.action": "apply_async",
            "celery.task_name": "tasks.charge_card",
          },
        },
        {
          name: "run/tasks.charge_card",
          attributes: { "celery.state": "SUCCESS" },
        },
        {
          name: "payments.authorize",
          attributes: { "order.id": "ord_1001", "payment.amount": "120" },
        },
        { name: "POST", attributes: { "http.request.method": "POST" } },
        {
          name: "run/tasks.refund",
          attributes: { "celery.state": "FAILURE" },
          hasException: true,
          exceptionMessage: "Refund for ord_0999 was declined",
        },
        {
          name: "run/tasks.send_receipt",
          attributes: { "celery.state": "RETRY" },
        },
        {
          name: "run/tasks.send_receipt",
          attributes: { "celery.state": "SUCCESS" },
        },
      ],
      metrics: [
        "flower.task.runtime.seconds",
        "payments.charged",
        "http.client.request.duration",
      ],
      logs: [
        { body: "charged order ord_1001", hasTraceContext: true },
        {
          body: "raised unexpected",
          hasTraceContext: true,
          hasException: true,
        },
      ],
      resource: { "service.name": "shop-worker" },
      absentSpans: ["PING", "LLEN LLEN LLEN LLEN", "SADD", "PUBLISH"],
    },
  },
};
