import { GuideSnippet, OpenTelemetryGuide } from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";
import {
  NODE_PREREQUISITE,
  nodeDockerfileSnippet,
  nodeInstrumentationFile,
  npmInstallSnippet,
} from "../JavaScriptShared";

/*
 * Fastify 5 with @fastify/otel, the instrumentation the Fastify team keeps
 * (the OpenTelemetry project's own left the bundle in March 2026), beside
 * the SDK's bundle for everything around it.
 *
 * Errors reach OneUptime from Fastify's error log rather than from
 * @fastify/otel: it records every error a schema, hook or handler throws,
 * a 400 or a 401 included, and Fastify logs a 4xx with its error object
 * too. The log controller in server.js keeps the error object for 5xx, so
 * Exceptions lists what is broken. The end-to-end check holds both halves:
 * a request its schema rejects arrives with no exception, a 500 with one.
 */

const install: GuideSnippet = npmInstallSnippet("install", [
  "@opentelemetry/api",
  "@opentelemetry/sdk-node",
  "@opentelemetry/auto-instrumentations-node",
  "@opentelemetry/instrumentation",
  "@fastify/otel",
]);

const instrumentation: GuideSnippet = {
  id: "instrumentation",
  language: "javascript",
  title: "instrumentation.mjs",
  code: nodeInstrumentationFile({
    extraImports: ['import FastifyOtelInstrumentation from "@fastify/otel";'],
    extraInstrumentationLines: [
      "// Fastify's own instrumentation: a span per request, hook and handler.",
      "new FastifyOtelInstrumentation({",
      "  registerOnInitialization: true,",
      "  // Errors reach OneUptime from Fastify's error log instead, which tells",
      "  // a 500 from a 400 (see server.js).",
      "  recordExceptions: false,",
      "}),",
    ],
  }),
  check: "run",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "node --import ./instrumentation.mjs server.js",
  check: "run",
};

const logger: GuideSnippet = {
  id: "logger",
  language: "javascript",
  title: "server.js",
  code: [
    'import Fastify, { LogController } from "fastify";',
    "",
    "// Fastify logs the errors it answers with, a 4xx too, with the error",
    "// object, which OneUptime files under Exceptions. Keep that for 5xx: a",
    "// client error is logged by its message alone.",
    "class TelemetryLogController extends LogController {",
    "  defaultErrorLog(error, request, reply) {",
    "    if (reply.statusCode >= 500) {",
    "      return super.defaultErrorLog(error, request, reply);",
    "    }",
    "    if (!this.isLogDisabled(request)) {",
    "      reply.log.info({ res: reply }, error.message);",
    "    }",
    "  }",
    "}",
    "",
    "const app = Fastify({",
    "  logger: true,",
    "  logController: new TelemetryLogController(),",
    "});",
  ].join("\n"),
  check: "contained",
};

const manualSpan: GuideSnippet = {
  id: "manual-span",
  language: "javascript",
  title: "server.js",
  code: [
    'import { SpanStatusCode, trace } from "@opentelemetry/api";',
    "",
    'const tracer = trace.getTracer("inventory");',
    "",
    'app.post("/reservations", async (request, reply) => {',
    '  const reservation = await tracer.startActiveSpan("inventory.reserve", async (span) => {',
    "    try {",
    '      span.setAttribute("inventory.sku", request.body.sku);',
    '      span.setAttribute("inventory.quantity", request.body.quantity);',
    "      return await reserveStock(request.body);",
    "    } catch (error) {",
    "      span.recordException(error);",
    "      span.setStatus({ code: SpanStatusCode.ERROR });",
    "      throw error;",
    "    } finally {",
    "      span.end();",
    "    }",
    "  });",
    "  return reply.code(201).send(reservation);",
    "});",
  ].join("\n"),
  check: "contained",
};

const requestContext: GuideSnippet = {
  id: "request-context",
  language: "javascript",
  title: "server.js",
  code: [
    'app.get("/stock/:sku", async (request) => {',
    "  // The request's own span, from @fastify/otel.",
    "  const { span } = request.opentelemetry();",
    '  span?.setAttribute("inventory.sku", request.params.sku);',
    '  request.log.info({ sku: request.params.sku }, "checking stock");',
    "  return { sku: request.params.sku, available: 12 };",
    "});",
  ].join("\n"),
  check: "contained",
};

const customMetric: GuideSnippet = {
  id: "custom-metric",
  language: "javascript",
  title: "server.js",
  code: [
    'import { metrics } from "@opentelemetry/api";',
    "",
    'const reservations = metrics.getMeter("inventory").createCounter("inventory.reservations", {',
    '  description: "Stock reservations, by warehouse",',
    "});",
    "",
    "function countReservation(warehouse) {",
    '  reservations.add(1, { "inventory.warehouse": warehouse });',
    "}",
  ].join("\n"),
  check: "contained",
};

const routeConfig: GuideSnippet = {
  id: "route-config",
  language: "javascript",
  title: "server.js",
  code: [
    "// No spans from @fastify/otel for this route.",
    'app.get("/metrics", { config: { otel: false } }, metricsHandler);',
  ].join("\n"),
  check: "parse",
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

// The app the end-to-end check runs: the page's fragments, word for word.
const serverFile: string = [
  logger.code,
  "",
  customMetric.code,
  "",
  "// A stand-in for the warehouse API.",
  "async function reserveStock(body) {",
  "  if (body.quantity > 100) {",
  '    throw new Error("Warehouse ams-1 timed out");',
  "  }",
  '  countReservation("ams-1");',
  '  return { id: "res_77", warehouse: "ams-1" };',
  "}",
  "",
  'app.get("/healthz", async () => "ok");',
  "",
  "// A route with a schema: Fastify answers a body without a sku with a 400.",
  'const holdSchema = { body: { type: "object", required: ["sku"] } };',
  'app.post("/holds", { schema: holdSchema }, async () => ({ held: true }));',
  "",
  requestContext.code,
  "",
  manualSpan.code,
  "",
  'await app.listen({ port: 3000, host: "0.0.0.0" });',
].join("\n");

export const FastifyGuide: OpenTelemetryGuide = {
  slug: "fastify",
  seo: {
    title: "Fastify OpenTelemetry with @fastify/otel | OneUptime",
    description:
      "Trace Fastify 5 with OpenTelemetry and @fastify/otel: request, hook and handler spans, pino logs with trace IDs, metrics, and 5xx errors in OneUptime.",
  },
  h1: "OpenTelemetry for Fastify",
  lead: "Fastify keeps its own OpenTelemetry instrumentation, `@fastify/otel`, which traces each request through its hooks and handler. Load it with the Node.js SDK to send those spans, Fastify's logs, your metrics and every server error to OneUptime.",
  cardDescription:
    "Request, hook and handler spans from @fastify/otel, pino logs with trace IDs, and only 5xx errors under Exceptions.",
  searchTerms: ["fastify", "fastify/otel", "hooks", "pino", "schema"],
  highlights: ["Fastify 5", "@fastify/otel", "Only 5xx under Exceptions"],

  whatYouGet: {
    intro: `Each request becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, listed under ${SCREENS.services}, with every step Fastify ran for it.`,
    traces:
      "A server span per request, named after its route, such as `POST /reservations`. Beneath it, `@fastify/otel`'s `request` span, a span for each hook your app and its plugins add, such as `onRequest` or `preHandler`, and one for the route's handler. Queries and outgoing calls nest under the handler.",
    metrics:
      "`http.server.request.duration` by `http.route` and status code, so each route has its own latency and error rate, and the event loop, heap and garbage collection of the Node.js runtime.",
    logs: "Fastify logs through pino, so every `request.log` line, and the `incoming request` and `request completed` lines Fastify writes itself, arrive with their request's trace ID.",
    exceptions: `A 5xx reaches ${SCREENS.exceptions} from Fastify's error log, with its stack trace and a link to the request's trace. A 400 from a schema, or a 401 or a 404 your code throws, stays an ordinary log line: Exceptions lists what is broken, not what callers got wrong.`,
  },

  exampleTrace: {
    caption: "A POST /reservations request, as its trace shows it",
    spans: [
      {
        name: "POST /reservations",
        depth: 0,
        start: 0,
        duration: 100,
        source: "http",
      },
      {
        name: "request",
        depth: 1,
        start: 2,
        duration: 96,
        source: "@fastify/otel",
      },
      {
        name: "preHandler - authenticate",
        depth: 2,
        start: 4,
        duration: 6,
        source: "@fastify/otel",
      },
      {
        name: "handler - fastify -> @fastify/otel",
        depth: 2,
        start: 12,
        duration: 82,
        source: "@fastify/otel",
      },
      {
        name: "inventory.reserve",
        depth: 3,
        start: 15,
        duration: 76,
        source: "your code",
      },
      {
        name: "pg.query:UPDATE inventory",
        depth: 4,
        start: 20,
        duration: 34,
        source: "pg",
      },
    ],
  },

  prerequisites: [
    NODE_PREREQUISITE,
    "A Fastify 5 app, on Fastify 5.10 or later: step 3 uses the log controller it added.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Install the SDK, its bundle of instrumentations, and `@fastify/otel` for Fastify itself:",
    snippets: [install],
    notes: [
      "The bundle has had no Fastify instrumentation since March 2026: the OpenTelemetry project retired its own in favour of `@fastify/otel`, which the Fastify team maintains.",
    ],
  },

  configure: {
    intro:
      "The SDK reads the endpoint, the key and the service name from the environment as the process starts:",
    tabs: otlpEnvironmentTabs({
      serviceName: "inventory-api",
      cloudNote:
        "Keep them out of a `.env` file that `@fastify/env` loads: the SDK has started by then. `node --env-file=.env --import ./instrumentation.mjs server.js` loads one in time.",
    }),
    notes: [
      "OTLP over HTTP, as protobuf, is the SDK's default and what OneUptime's `/otlp` endpoint takes.",
    ],
  },

  setup: {
    intro:
      "`@fastify/otel` has to be part of the Fastify instance before a route is added. Loaded from the instrumentation file with `registerOnInitialization`, it joins each instance as it is created, with no change to your plugins.",
    steps: [
      {
        title: "Create the instrumentation file",
        body: "Save it next to `package.json`. Besides the SDK's bundle, it loads `@fastify/otel`, which adds itself to the app's Fastify instance the moment it is created:",
        snippets: [instrumentation],
        notes: [
          "Without `registerOnInitialization`, you would export the instrumentation and `await app.register(instrumentation.plugin())` before any route.",
          "`recordExceptions: false` leaves errors to Fastify's error log, set up in step 3. Left on, every request a schema rejects is filed as an exception.",
        ],
      },
      {
        title: "Start the app with it",
        body: "Load the file before your server with `--import`:",
        snippets: [run],
        notes: [
          "In `package.json`: `\"start\": \"node --import ./instrumentation.mjs server.js\"`. Where the command is fixed, set `NODE_OPTIONS=\"--import ./instrumentation.mjs\"` instead.",
        ],
      },
      {
        title: "Turn on the logger, and keep 4xx out of Exceptions",
        body: "Fastify's logger is pino, which the SDK instruments. Create the app with it, and with a log controller that logs a client error by its message alone:",
        snippets: [logger],
        notes: [
          "The SDK turns the error object on a pino line into `exception.*` attributes, and OneUptime files any line that has them under Exceptions, whatever its level. Fastify's default error handler logs a 4xx at the info level with its error object: the controller keeps that for 5xx.",
          "With your own `setErrorHandler`, log a 5xx with `request.log.error({ err: error }, error.message)`: that line is what reaches Exceptions.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "In a Fastify app, these produce spans, metrics and logs with no code:",
    rows: [
      {
        library: "`fastify` (`@fastify/otel`)",
        covers:
          "The `request` span, with `http.route` and the status code, and a span for each hook, for the route's handler and for your 404 handler. A hook or handler that throws marks its span as failed.",
      },
      {
        library: "`http`",
        covers:
          "The server span the others nest under, named after the route `@fastify/otel` reports, and `http.server.request.duration`.",
      },
      {
        library: "`fetch` (undici), `http.request`",
        covers:
          "Client spans for the calls your handlers make, and `http.client.request.duration`.",
      },
      {
        library: "`pg`, `mysql2`, `mongodb`, `ioredis`, `redis`",
        covers:
          "Query and command spans, including those of `@fastify/postgres`, `@fastify/mysql`, `@fastify/mongodb` and `@fastify/redis`, which use these drivers.",
      },
      {
        library: "`pino`",
        covers:
          "Trace and span IDs on the lines Fastify's logger writes, and the lines sent to OneUptime.",
      },
    ],
    snippets: [routeConfig],
    notes: [
      "Name your handlers and hooks: `async function reserve(request, reply)` makes the span `handler - reserve`. An anonymous one is named after its plugin, `handler - fastify -> @fastify/otel` at the root.",
      "To leave a route out of `@fastify/otel`, set `otel: false` in its config, as above. The server span stays, named only `GET`: to drop the request entirely, add it to `ignoreIncomingRequestHook`, as the instrumentation file does for `/healthz`.",
      "`instrumentHooks: false` keeps the `request` and handler spans and drops the hook spans, for an app with many hooks.",
    ],
  },

  manualSpans: {
    intro:
      "For work inside a handler, start a span of your own: it nests under the handler's span.",
    snippets: [manualSpan, requestContext],
    notes: [
      "`request.opentelemetry()` returns `@fastify/otel`'s span for the request, with its context and tracer: set an attribute on the request's span without starting a new one.",
      "An error you rethrow reaches Fastify's error handler, which answers 500 and logs it. For an error you throw on purpose with a 4xx `statusCode`, skip `recordException`: it is not a bug to look into.",
    ],
  },

  logs: {
    intro:
      "Log with `request.log` in handlers and hooks. It is the app's pino logger, bound to the request: each line carries the request's ID and trace, and its fields become attributes you can search, such as `sku` above.",
    snippets: [],
    notes: [
      "Fastify adds an `incoming request` and a `request completed` line, with its `responseTime`, for every request. The controller's `disableRequestLogging` option drops them, and the error lines with them: use it only if your own error handler logs 5xx errors.",
      "Lines written outside a request, such as `Server listening at`, carry no trace.",
    ],
  },

  metrics: {
    intro:
      "Request and runtime metrics are sent every 60 seconds with no code. Add your own beside them:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Each request's duration by `http.route`, method and status code: every route's latency and error rate.",
      },
      {
        name: "http.client.request.duration",
        description: "The calls your handlers make, by host and status.",
      },
      {
        name: "nodejs.eventloop.utilization",
        description:
          "How busy the event loop is. Fastify serves many requests per core, so a saturated process shows here first.",
      },
    ],
    snippets: [customMetric],
    notes: [
      "Name a metric after what it counts, with a dot between levels: `inventory.reservations`. Its attributes, such as `inventory.warehouse`, are what you chart it by.",
    ],
  },

  sampling: {
    intro:
      "Fastify apps often serve thousands of requests a second. Keep a share of new traces, and every trace a caller already decided to keep:",
    snippets: [sampling],
    notes: [
      "`OTEL_TRACES_SAMPLER_ARG=\"0.1\"` keeps one new trace in ten.",
      "`http.server.request.duration` is recorded for every request, sampled or not, so latency charts stay exact.",
      "Health checks dropped with `ignoreIncomingRequestHook` are never traced at all, which saves more than sampling them.",
    ],
  },

  deploy: {
    intro:
      "In a container, start Node.js with the instrumentation file, and have Fastify listen on every interface:",
    snippets: [
      nodeDockerfileSnippet({
        command: ["node", "--import", "./instrumentation.mjs", "server.js"],
        port: 3000,
      }),
      kubernetesManifestSnippet({
        name: "inventory-api",
        image: "registry.example.com/inventory-api:1.9.0",
        containerPort: 3000,
      }),
    ],
    notes: [
      "`app.listen({ port: 3000, host: \"0.0.0.0\" })`: Fastify listens on `localhost` by default, which nothing outside the container reaches.",
      "On SIGTERM, the instrumentation file sends what is still buffered, then exits.",
    ],
  },

  verify: {
    intro: "Each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Start the app, call a route, and open ${SCREENS.services}: \`inventory-api\` is listed within a minute.`,
      },
      {
        title: "Open a trace",
        body: `In ${SCREENS.traces}, search \`@http.route:/reservations\`: the request's span holds \`request\`, the handler and your \`inventory.reserve\` span.`,
      },
      {
        title: "Check what reaches Exceptions",
        body: `Send a request your schema rejects, and one that fails with a 500. Under ${SCREENS.exceptions}, only the 500 is listed, with the line it was thrown from.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Only GET and POST spans, nothing from Fastify",
      answer:
        "`@fastify/otel` was not part of the instance when the routes were added. Load it from the instrumentation file with `registerOnInitialization: true`, and start the app with `--import ./instrumentation.mjs`, not by importing the file from `server.js`.",
    },
    {
      question: "Every 400 is listed under Exceptions",
      answer:
        "Two things file them: `@fastify/otel` records every error a schema, hook or handler throws, and Fastify logs a 4xx with its error object. Set `recordExceptions: false` in the instrumentation file, and create the app with the log controller from step 3.",
    },
    {
      question: "SyntaxError: Named export 'LogController' not found",
      answer:
        "Fastify is older than 5.10, which added the log controller. Update Fastify: `npm install fastify@5`.",
    },
    {
      question: "Health checks still appear in Traces",
      answer:
        "`ignorePaths` and `otel: false` only skip `@fastify/otel`'s spans: the HTTP server span stays. Add the path to the HTTP instrumentation's `ignoreIncomingRequestHook`, as the instrumentation file does for `/healthz`.",
    },
    {
      question: "A dns.lookup trace at every start",
      answer:
        "Fastify resolves the host it listens on, and the `dns` instrumentation traces the lookup. Turn it off with `OTEL_NODE_DISABLED_INSTRUMENTATIONS=dns` if you do not need DNS spans.",
    },
    {
      question: "Logs arrive without trace IDs",
      answer:
        "They were written with `app.log` outside a request, or before the instrumentation loaded. Log with `request.log` in handlers and hooks, and start the app with `--import`.",
    },
    {
      question: "Nothing arrives from the container",
      answer:
        "Check the container's environment for the three variables, and set `OTEL_LOG_LEVEL=debug` to see each export's result in the container's log.",
    },
  ],

  faq: [
    {
      question: "Which instrumentation should I use for Fastify?",
      answer:
        "`@fastify/otel`, maintained by the Fastify team. The OpenTelemetry project's `@opentelemetry/instrumentation-fastify` was deprecated in its favour in January 2025 and left the bundle in March 2026.",
    },
    {
      question: "Does it trace encapsulated plugins?",
      answer:
        "Yes. Loaded with `registerOnInitialization`, it is part of the root instance before your first plugin, so the routes and hooks of every plugin are traced. A plugin's anonymous handlers are named after it: `handler - routes` for a plugin function named `routes`.",
    },
    {
      question: "Does @fastify/otel work with the 3.0 SDK?",
      answer:
        "Yes. It depends on the 2.x instrumentation packages, so npm installs a copy of them for it alone, and it reports through the API the 3.0 SDK registers. This guide's app ran with `@fastify/otel` 0.21.4 and SDK 3.0.",
    },
    {
      question: "What about Fastify 4?",
      answer:
        "`@fastify/otel` instruments Fastify 4 too, but Fastify 4's support ended in June 2025, and it has no log controller. This guide was checked with Fastify 5.12.",
    },
    {
      question: "Can I write the app in TypeScript?",
      answer:
        "Yes, and `LogController` has its types in Fastify's own. Leave `instrumentation.mjs` as JavaScript and point `--import` at it when you start the compiled server: `node --import ./instrumentation.mjs dist/server.js`.",
    },
  ],

  related: ["express", "nestjs", "koa", "nodejs"],
  docs: [DOCS.openTelemetry, DOCS.exceptions, DOCS.traces, DOCS.logs],

  verification: {
    runtime: "node",
    framework: { name: "Fastify", package: "fastify" },
    files: [
      {
        path: "package.json",
        content:
          '{ "name": "inventory-api", "private": true, "type": "module" }',
      },
      { path: "instrumentation.mjs", snippet: "instrumentation" },
      { path: "server.js", content: serverFile },
    ],
    commands: [
      { snippet: "install" },
      { command: "npm install fastify@5.12.7" },
      { snippet: "run", isServer: true },
    ],
    port: 3000,
    requests: [
      { method: "GET", path: "/healthz" },
      { method: "GET", path: "/stock/sku-42" },
      {
        method: "POST",
        path: "/reservations",
        body: { sku: "sku-42", quantity: 2 },
      },
      { method: "POST", path: "/holds", body: { quantity: 2 } },
      {
        method: "POST",
        path: "/reservations",
        body: { sku: "sku-42", quantity: 500 },
      },
    ],
    expect: {
      spans: [
        {
          name: "POST /reservations",
          attributes: { "http.route": "/reservations" },
        },
        { name: "request", attributes: { "http.route": "/reservations" } },
        {
          name: "handler - fastify -> @fastify/otel",
          attributes: { "http.route": "/reservations" },
        },
        {
          name: "inventory.reserve",
          attributes: { "inventory.sku": "sku-42", "inventory.quantity": "2" },
        },
        { name: "inventory.reserve", hasException: true },
        { name: "request", attributes: { "inventory.sku": "sku-42" } },
        {
          name: "request",
          attributes: {
            "http.route": "/holds",
            "http.response.status_code": "400",
          },
          hasException: false,
        },
      ],
      metrics: ["http.server.request.duration", "inventory.reservations"],
      logs: [
        { body: "checking stock", hasTraceContext: true },
        { body: "request completed", hasTraceContext: true },
        {
          body: "Warehouse ams-1 timed out",
          hasTraceContext: true,
          hasException: true,
        },
        {
          body: "must have required property 'sku'",
          hasTraceContext: true,
          hasException: false,
        },
      ],
      resource: { "service.name": "inventory-api" },
      untracedPaths: ["/healthz"],
    },
  },
};
