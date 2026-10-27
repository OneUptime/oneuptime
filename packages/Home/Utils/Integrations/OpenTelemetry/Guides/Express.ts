import { OpenTelemetryGuide, GuideSnippet } from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeySnippet,
} from "../GuideShared";
import {
  MINIMUM_NODE_VERSION,
  nodeDockerfileSnippet,
  nodeInstrumentationFile,
  npmInstallSnippet,
} from "../JavaScriptShared";

const install: GuideSnippet = npmInstallSnippet("install", [
  "@opentelemetry/api",
  "@opentelemetry/sdk-node",
  "@opentelemetry/auto-instrumentations-node",
  "@opentelemetry/instrumentation",
]);

const instrumentation: GuideSnippet = {
  id: "instrumentation",
  language: "javascript",
  title: "instrumentation.mjs",
  code: nodeInstrumentationFile({
    autoInstrumentationLines: [
      "// Express 5 routes through the router package: one set of spans is enough.",
      '"@opentelemetry/instrumentation-router": { enabled: false },',
    ],
  }),
  check: "run",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "node --import ./instrumentation.mjs app.js",
  check: "run",
};

const packageScript: GuideSnippet = {
  id: "package-script",
  language: "json",
  title: "package.json",
  code: [
    "{",
    '  "scripts": {',
    '    "start": "node --import ./instrumentation.mjs app.js"',
    "  }",
    "}",
  ].join("\n"),
  check: "parse",
};

const manualSpan: GuideSnippet = {
  id: "manual-span",
  language: "javascript",
  title: "app.js",
  code: [
    'import { trace, SpanStatusCode } from "@opentelemetry/api";',
    "",
    'const tracer = trace.getTracer("checkout");',
    "",
    'app.post("/orders", async (req, res) => {',
    '  const order = await tracer.startActiveSpan("checkout.charge", async (span) => {',
    "    try {",
    '      span.setAttribute("order.item_count", req.body.items.length);',
    '      span.setAttribute("payment.method", req.body.paymentMethod);',
    "      return await chargeCard(req.body);",
    "    } catch (error) {",
    "      span.recordException(error);",
    "      span.setStatus({ code: SpanStatusCode.ERROR });",
    "      throw error;",
    "    } finally {",
    "      span.end();",
    "    }",
    "  });",
    "  res.status(201).json(order);",
    "});",
  ].join("\n"),
  check: "contained",
};

const logging: GuideSnippet = {
  id: "logging",
  language: "javascript",
  title: "app.js",
  code: [
    'import pino from "pino";',
    "",
    "const logger = pino();",
    "",
    'app.get("/users/:id", (req, res) => {',
    '  logger.info({ userId: req.params.id }, "loading user");',
    '  res.json({ id: req.params.id, name: "Ada" });',
    "});",
    "",
    "// Express calls this for errors thrown in routes: log it, then answer 500.",
    "app.use((error, req, res, _next) => {",
    '  logger.error({ err: error, path: req.path }, "request failed");',
    '  res.status(500).json({ error: "Something went wrong" });',
    "});",
  ].join("\n"),
  check: "contained",
};

const customMetric: GuideSnippet = {
  id: "custom-metric",
  language: "javascript",
  title: "app.js",
  code: [
    'import { metrics } from "@opentelemetry/api";',
    "",
    'const ordersPlaced = metrics.getMeter("checkout").createCounter("orders.placed", {',
    '  description: "Orders placed, by payment method",',
    "});",
    "",
    "// Call it once the card is charged.",
    "function countOrder(order) {",
    '  ordersPlaced.add(1, { "payment.method": order.paymentMethod });',
    "}",
  ].join("\n"),
  check: "contained",
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

const middlewareSpansOff: GuideSnippet = {
  id: "handlers-only",
  language: "javascript",
  title: "instrumentation.mjs",
  code: [
    '"@opentelemetry/instrumentation-express": {',
    "  // A span per route handler only, none per middleware.",
    '  ignoreLayersType: ["middleware"],',
    "},",
  ].join("\n"),
  check: "parse",
};

/*
 * The app the end-to-end check runs: the page's fragments, word for word,
 * with the lines around them a real app has.
 */
const appFile: string = [
  'import express from "express";',
  "",
  "const app = express();",
  "app.use(express.json());",
  "",
  'app.get("/healthz", (_req, res) => {',
  '  res.send("ok");',
  "});",
  "",
  "// A stand-in for the payment provider.",
  "async function chargeCard(order) {",
  "  countOrder(order);",
  '  return { id: "ord_1001" };',
  "}",
  "",
  customMetric.code,
  "",
  manualSpan.code,
  "",
  'app.get("/boom", () => {',
  '  throw new Error("Payment provider timed out");',
  "});",
  "",
  logging.code,
  "",
  "app.listen(3000, () => {",
  '  logger.info("listening on http://localhost:3000");',
  "});",
].join("\n");

export const ExpressGuide: OpenTelemetryGuide = {
  slug: "express",
  seo: {
    title: "Express OpenTelemetry: Tracing, Metrics & Logs | OneUptime",
    description:
      "Instrument Express with OpenTelemetry in minutes: route and middleware spans, per-route latency, pino and winston logs with trace IDs, and errors, sent to OneUptime.",
  },
  h1: "OpenTelemetry for Express",
  lead: "Trace every Express route, middleware and database call, and send the traces, metrics and logs to OneUptime with the OpenTelemetry Node.js SDK. One instrumentation file, three environment variables, and no change to your routes.",
  cardDescription:
    "Routes, middleware, outgoing calls and pino or winston logs, with no change to your handlers.",
  searchTerms: ["expressjs", "express.js", "middleware", "router", "node"],
  highlights: [
    "Automatic instrumentation",
    "Express 4 and 5",
    "ES modules and CommonJS",
  ],

  whatYouGet: {
    intro: `Once the SDK loads before your app, every request to Express becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, and the service appears in ${SCREENS.services} the first time it sends.`,
    traces:
      "A server span per request named after the route that matched, such as `GET /users/:id`, with a child span for each middleware and for the route handler. Queries to PostgreSQL, MySQL, MongoDB or Redis and calls to other HTTP services sit beneath them.",
    metrics:
      "`http.server.request.duration` by `http.route`, method and status code, so every endpoint has its own latency and error rate, plus the Node.js runtime's event loop delay, heap and garbage collection.",
    logs: "Each pino, winston or bunyan record arrives stamped with the trace and span it was written in, so a log line opens the request that wrote it.",
    exceptions: `An error thrown in a route is recorded on the route handler's span and the request's span is marked failed. OneUptime groups each error, with its stack trace, under ${SCREENS.exceptions}.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      { name: "POST /orders", depth: 0, start: 0, duration: 100, source: "http" },
      {
        name: "middleware - jsonParser",
        depth: 1,
        start: 2,
        duration: 4,
        source: "express",
      },
      {
        name: "request handler - /orders",
        depth: 1,
        start: 7,
        duration: 90,
        source: "express",
      },
      {
        name: "checkout.charge",
        depth: 2,
        start: 10,
        duration: 78,
        source: "your code",
      },
      {
        name: "pg.query:INSERT orders",
        depth: 3,
        start: 14,
        duration: 22,
        source: "pg",
      },
      {
        name: "POST",
        depth: 3,
        start: 40,
        duration: 44,
        source: "undici",
      },
    ],
  },

  prerequisites: [
    `Node.js ${MINIMUM_NODE_VERSION} or later: the OpenTelemetry JS SDK 3.0 these steps install needs it. Node.js 24 LTS is a good choice.`,
    "An Express 4 or 5 app, written with `import` (ES modules) or `require` (CommonJS).",
    `A OneUptime ingestion key of the **Server** type, from ${SCREENS.ingestionKeys}: see [Ingestion keys](/docs/telemetry/ingestion-keys).`,
  ],

  install: {
    intro:
      "Install the SDK, the bundle of automatic instrumentations, and the OpenTelemetry API your own spans and metrics use. These are the versions this guide was checked with.",
    snippets: [install],
    notes: [
      "`@opentelemetry/instrumentation` holds the ES module hook the next step registers. npm installs it with the bundle anyway; naming it keeps pnpm and Yarn, which do not hoist packages, working too.",
      "On pnpm, Yarn or Bun, install the same packages with `pnpm add`, `yarn add` or `bun add`.",
    ],
  },

  configure: {
    intro:
      "The SDK reads where to send and which key to send from standard environment variables, so neither appears in your code. Set them wherever your app gets its environment: your shell, a process manager, a container or your platform's settings.",
    tabs: otlpEnvironmentTabs({
      serviceName: "checkout-api",
      cloudNote:
        "OneUptime files everything this app sends under `checkout-api`, and creates the service the first time data arrives.",
    }),
    notes: [
      "The JavaScript SDK sends OTLP over HTTP as protobuf by default, which is what the `/otlp` endpoint takes, so `OTEL_EXPORTER_OTLP_PROTOCOL` can stay unset.",
    ],
  },

  setup: {
    intro:
      "Two steps: a file that starts OpenTelemetry, and a flag that runs it before Express is imported.",
    steps: [
      {
        title: "Create the instrumentation file",
        body: "Save it next to your `package.json`. It registers the hook that lets the instrumentations patch the packages your app imports, starts the SDK, and sends what is still buffered when the process stops.",
        snippets: [instrumentation],
        notes: [
          "Express 5 hands every request to the `router` package, which has an instrumentation of its own. Turning it off keeps one span per middleware and handler instead of two, and records a thrown error once.",
        ],
      },
      {
        title: "Load it before your app",
        body: "Start Node.js with `--import`, which runs the file before the first line of your app:",
        snippets: [run, packageScript],
        notes: [
          "Cannot change the command, as on some platforms? Set `NODE_OPTIONS=\"--import ./instrumentation.mjs\"` instead.",
          "An `import \"./instrumentation.mjs\"` at the top of `app.js` comes too late for an ES module app: every `import` is loaded before any code runs, so Express is loaded before the hook exists.",
        ],
      },
      {
        title: "Send a few requests",
        body: "Start the app and call a few routes. Spans and logs leave in batches every few seconds, and metrics once a minute.",
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "`@opentelemetry/auto-instrumentations-node` patches the libraries your app already uses. In a typical Express app that covers:",
    rows: [
      {
        library: "`express`",
        covers:
          "A span per middleware (`middleware - jsonParser`) and per route handler (`request handler - /users/:id`), and the route's pattern as `http.route` on the request's span and its metrics.",
      },
      {
        library: "`http` and `https`",
        covers:
          "The server span of every incoming request, `http.server.request.duration`, and a client span per outgoing `http.request`.",
      },
      {
        library: "`fetch` (undici)",
        covers:
          "A client span for every `fetch()` your handlers make, and `http.client.request.duration`.",
      },
      {
        library: "`pg`, `mysql2`, `mongodb`, `mongoose`, `ioredis`, `redis`",
        covers:
          "A span per query or command, with the database system, its name and the operation.",
      },
      {
        library: "`pino`, `winston`, `bunyan`",
        covers:
          "The trace and span IDs on every record, and the records sent to OneUptime as logs.",
      },
      {
        library: "`graphql`, `kafkajs`, `amqplib`, `@aws-sdk/*`",
        covers:
          "Spans for GraphQL operations and resolvers, messages produced and consumed, and AWS calls.",
      },
    ],
    snippets: [middlewareSpansOff],
    notes: [
      "For a span per route handler and none per middleware, pass `ignoreLayersType` to the Express instrumentation, beside the other options in `instrumentation.mjs`:",
    ],
  },

  manualSpans: {
    intro:
      "Automatic spans show where time goes between libraries. For the work in between, such as charging a card, add a span of your own with the OpenTelemetry API: it nests under the request's span by itself.",
    snippets: [manualSpan],
    notes: [
      "`startActiveSpan` makes the span current, so the queries and calls made inside it become its children.",
      "Name a span after the operation (`checkout.charge`), not the request: the route is already on the request's span.",
      "Add the attributes your team searches by, such as `span.setAttribute(\"tenant.id\", tenantId)`, then find them in the **Traces** explorer with `@tenant.id:acme`.",
      "A declined card is not a bug. To keep an expected error out of **Exceptions**, record it as an event with `error.class` set to `user-error`: `span.addEvent(\"exception\", { \"exception.type\": \"CardDeclined\", \"error.class\": \"user-error\" })`.",
    ],
  },

  logs: {
    intro:
      "If the app logs with pino, its logs reach OneUptime with no code of their own: the instrumentation stamps each record with its trace and span IDs and sends it through the SDK.",
    snippets: [logging],
    notes: [
      "pino keeps writing to stdout as before, now with `trace_id` and `span_id` fields. The copy OneUptime receives comes through the SDK, not through your log shipper.",
      "With winston, also install `@opentelemetry/winston-transport@0.35.0`: it is what hands winston's records to the SDK. See the [Koa guide](/integrations/opentelemetry/koa) for a winston setup.",
      "An error logged under pino's `err` key arrives with `exception.type`, `exception.message` and `exception.stacktrace`, so it lands in **Exceptions** too, grouped with the same error from the span.",
      "`console.log` is not sent. Use a logger, or write a record with the API's `logs` (see the [Node.js guide](/integrations/opentelemetry/nodejs)).",
    ],
  },

  metrics: {
    intro:
      "The SDK exports metrics every 60 seconds. These arrive without a line of code:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "How long each request took, by `http.route`, method and status code: every endpoint's latency and error rate.",
      },
      {
        name: "http.client.request.duration",
        description: "Outgoing HTTP and `fetch()` calls, by host and status.",
      },
      {
        name: "nodejs.eventloop.delay.p99",
        description:
          "How long the event loop was blocked. When every route slows down at once, look here first.",
      },
      {
        name: "v8js.memory.heap.used",
        description: "The heap in use, by V8 heap space.",
      },
    ],
    snippets: [customMetric],
    notes: [
      "Keep attribute values to a small set, such as a payment method or a plan. A user or order ID makes a new series for every value.",
      "While you test, `OTEL_METRIC_EXPORT_INTERVAL=10000` exports every 10 seconds.",
    ],
  },

  sampling: {
    intro:
      "Every request is traced by default, which is right while you set things up. On a busy service, keep a share of the traces with the standard sampler variables:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps 20% of new traces and follows the caller's decision for a request that arrives with a `traceparent` header, so a trace is never cut in half between services.",
      "Metrics and logs are not sampled: `http.server.request.duration` still counts every request.",
      "The health check filter in `instrumentation.mjs` drops those requests before they are traced. Add other paths the same way, such as `/metrics`.",
      "To drop data once it leaves the app instead, use [drop filters](/docs/telemetry/drop-filters-and-scrub-rules) in OneUptime.",
    ],
  },

  deploy: {
    intro:
      "In a container, put the `--import` flag in the image's command and give the container the three variables at run time. In Kubernetes, keep the key in a Secret.",
    snippets: [
      nodeDockerfileSnippet({
        command: ["node", "--import", "./instrumentation.mjs", "app.js"],
        port: 3000,
      }),
      kubernetesManifestSnippet({
        name: "checkout-api",
        image: "registry.example.com/checkout-api:1.4.0",
        containerPort: 3000,
      }),
    ],
    notes: [
      "Kubernetes sends SIGTERM before it stops a pod. The instrumentation file sends what is still buffered, then lets the process exit.",
      "`deployment.environment.name` tags every span, metric and log with its environment, so production and staging can be told apart in every explorer.",
      "To see the pods and nodes beside the service, install the [Kubernetes agent](/docs/telemetry/kubernetes-agent).",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      {
        title: "Ask OneUptime whether it accepts the key",
        body: "`200` with `\"valid\": true` means it does. `401` says what is wrong with it: unknown, disabled or expired.",
        snippets: [validateKeySnippet()],
      },
      {
        title: "Find the service",
        body: `Start the app, request a route such as \`/users/42\`, and open ${SCREENS.services}. \`checkout-api\` is listed within a minute.`,
      },
      {
        title: "Open a trace",
        body: `In ${SCREENS.traces}, search \`@http.route:/users/:id\`. Each request is a trace, with its middleware and handler spans beneath the request's span.`,
      },
      {
        title: "Follow a log to its request",
        body: `In ${SCREENS.logs}, open a \`loading user\` line: its trace ID links to the request that wrote it.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Spans are named GET or POST, with no route",
      answer:
        "The instrumentation file ran after Express was loaded, or not at all. Start Node.js with `--import ./instrumentation.mjs`. Importing the file from your app is too late for ES modules, and a bundler that inlines Express (esbuild, webpack) leaves nothing to patch: keep `express` external.",
    },
    {
      question: "Every middleware and handler appears twice",
      answer:
        "Express 5 routes requests through the `router` package, and its instrumentation adds a second span per layer, named `middleware - patched` and the like. Turn it off with `\"@opentelemetry/instrumentation-router\": { enabled: false }`, as the instrumentation file above does.",
    },
    {
      question: "The exporter logs 401 and nothing arrives",
      answer:
        "OneUptime does not accept the key. `OTEL_EXPORTER_OTLP_HEADERS` must be `x-oneuptime-token=` followed by the key's **Secret Key**, with no spaces or quotes inside the value, and the key must be a **Server** key of the project you are looking at.",
    },
    {
      question: "Nothing arrives, and nothing is logged",
      answer:
        "Set `OTEL_LOG_LEVEL=debug` and start the app again: the SDK then logs each export and why one failed. Check that `OTEL_EXPORTER_OTLP_ENDPOINT` ends in `/otlp` with no `/v1/traces` after it, since the SDK adds that itself.",
    },
    {
      question: "The container takes 30 seconds to stop",
      answer:
        "The process ignores SIGTERM until it is killed. That happens with `--require @opentelemetry/auto-instrumentations-node/register`: its handler sends the buffered data but never exits while Express is listening. Load the instrumentation file above instead, which exits once the data is sent.",
    },
    {
      question: "Logs arrive without trace IDs",
      answer:
        "The log was written outside a request, such as at startup, or in a callback that lost the request's context. Logs written inside a route handler or a span carry the IDs; for work you start yourself, wrap it in `tracer.startActiveSpan`.",
    },
  ],

  faq: [
    {
      question: "Does OpenTelemetry work with Express 5?",
      answer:
        "Yes. The Express instrumentation covers Express 4 and 5, and this guide was checked end to end with Express 5.3. On Express 5, turn off the `router` instrumentation as shown, or each layer is traced twice.",
    },
    {
      question: "Do I have to change my routes?",
      answer:
        "No. The routes, middleware and libraries are traced as they are. Code changes are only for what no library knows about: your own spans, attributes and metrics.",
    },
    {
      question: "Does it work with TypeScript?",
      answer:
        "Yes. Keep `instrumentation.mjs` as plain JavaScript, so it needs no build step, compile your app as usual, and start the compiled entry point with `node --import ./instrumentation.mjs dist/app.js`.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No. The SDK sends straight to OneUptime. Run a Collector when you want to batch, filter or enrich data in one place, or keep the key out of your apps: see [OpenTelemetry](/docs/telemetry/open-telemetry) for the exporter to add to it.",
    },
    {
      question: "How much does it slow the app down?",
      answer:
        "Each span costs a little CPU and memory, and the exporter sends in the background, in batches. Measure it on your own traffic: if a hot path costs too much, sample traces or turn off instrumentations you do not need, such as `dns` and `net`, with `OTEL_NODE_DISABLED_INSTRUMENTATIONS=dns,net`.",
    },
    {
      question: "What does it cost to send this data to OneUptime?",
      answer:
        "OneUptime is open source, so you can self-host it. On OneUptime Cloud, telemetry is billed per GB ingested: see [pricing](/pricing).",
    },
  ],

  related: ["nodejs", "nestjs", "fastify", "koa"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.exceptions],

  verification: {
    runtime: "node",
    framework: { name: "Express", package: "express" },
    files: [
      {
        path: "package.json",
        content: '{ "name": "checkout-api", "private": true, "type": "module" }',
      },
      { path: "instrumentation.mjs", snippet: "instrumentation" },
      { path: "app.js", content: appFile },
    ],
    commands: [
      { snippet: "install" },
      { command: "npm install express@5.3.0 pino@10.4.0" },
      { snippet: "run", isServer: true },
    ],
    port: 3000,
    requests: [
      { method: "GET", path: "/healthz" },
      { method: "GET", path: "/users/42" },
      {
        method: "POST",
        path: "/orders",
        body: { items: ["kettle", "mug"], paymentMethod: "card" },
      },
      { method: "GET", path: "/boom" },
    ],
    expect: {
      spans: [
        { name: "GET /users/:id", attributes: { "http.route": "/users/:id" } },
        { name: "request handler - /users/:id" },
        { name: "middleware - jsonParser" },
        { name: "POST /orders", attributes: { "http.route": "/orders" } },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
        },
        { name: "request handler - /boom", hasException: true },
      ],
      metrics: [
        "http.server.request.duration",
        "orders.placed",
        "nodejs.eventloop.delay.p99",
        "v8js.memory.heap.used",
      ],
      logs: [
        { body: "loading user", hasTraceContext: true },
        { body: "request failed", hasTraceContext: true },
      ],
      resource: { "service.name": "checkout-api" },
      untracedPaths: ["/healthz"],
    },
  },
};
