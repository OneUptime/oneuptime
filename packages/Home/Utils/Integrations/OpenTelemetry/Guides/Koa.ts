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
 * Koa 3 with @koa/router, traced by the bundle's Koa instrumentation, and
 * winston for logs: the bundle's winston instrumentation sends each record
 * once @opentelemetry/winston-transport is installed.
 *
 * The Koa instrumentation wraps every middleware in a span that records
 * any error thrown through it, so an error would be recorded once for each
 * layer it passes on its way out. The instrumentation file traces routes
 * only, which records it once, on its route's span.
 */

const install: GuideSnippet = npmInstallSnippet("install", [
  "@opentelemetry/api",
  "@opentelemetry/sdk-node",
  "@opentelemetry/auto-instrumentations-node",
  "@opentelemetry/instrumentation",
  "@opentelemetry/winston-transport",
]);

const instrumentation: GuideSnippet = {
  id: "instrumentation",
  language: "javascript",
  title: "instrumentation.mjs",
  code: nodeInstrumentationFile({
    autoInstrumentationLines: [
      '"@opentelemetry/instrumentation-koa": {',
      "  // A span per route, not per middleware: a thrown error is then",
      "  // recorded once, not on every layer it passes on the way out.",
      '  ignoreLayersType: ["middleware"],',
      "},",
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

const logger: GuideSnippet = {
  id: "logger",
  language: "javascript",
  title: "app.js",
  code: [
    'import winston from "winston";',
    "",
    "// Each record also goes to OneUptime, with its request's trace ID.",
    "const logger = winston.createLogger({",
    '  level: "info",',
    "  format: winston.format.json(),",
    "  transports: [new winston.transports.Console()],",
    "});",
  ].join("\n"),
  check: "contained",
};

const errorMiddleware: GuideSnippet = {
  id: "error-middleware",
  language: "javascript",
  title: "app.js",
  code: [
    'import Koa from "koa";',
    'import Router from "@koa/router";',
    'import { bodyParser } from "@koa/bodyparser";',
    "",
    "const app = new Koa();",
    "const router = new Router();",
    "",
    "// The first middleware: it answers every error thrown below it.",
    "app.use(async (ctx, next) => {",
    "  try {",
    "    await next();",
    "  } catch (error) {",
    "    ctx.status = error.status || 500;",
    '    ctx.body = { error: ctx.status < 500 ? error.message : "Something went wrong" };',
    "    if (ctx.status >= 500) {",
    '      logger.error("request failed", { err: error, path: ctx.path });',
    "    }",
    "  }",
    "});",
    "app.use(bodyParser());",
  ].join("\n"),
  check: "contained",
};

const productRoute: GuideSnippet = {
  id: "product-route",
  language: "javascript",
  title: "app.js",
  code: [
    'router.get("/products/:id", (ctx) => {',
    '  logger.info("loading product", { productId: ctx.params.id });',
    '  ctx.body = { id: ctx.params.id, name: "Kettle" };',
    "});",
  ].join("\n"),
  check: "contained",
};

const manualSpan: GuideSnippet = {
  id: "manual-span",
  language: "javascript",
  title: "app.js",
  code: [
    'import { SpanStatusCode, trace } from "@opentelemetry/api";',
    "",
    'const tracer = trace.getTracer("catalog");',
    "",
    'router.post("/search", async (ctx) => {',
    '  ctx.body = await tracer.startActiveSpan("catalog.search", async (span) => {',
    "    try {",
    '      span.setAttribute("search.query", ctx.request.body.query);',
    "      const results = await searchIndex(ctx.request.body.query);",
    '      span.setAttribute("search.result_count", results.length);',
    "      return { results };",
    "    } catch (error) {",
    "      span.recordException(error);",
    "      span.setStatus({ code: SpanStatusCode.ERROR });",
    "      throw error;",
    "    } finally {",
    "      span.end();",
    "    }",
    "  });",
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
    'const searchResults = metrics.getMeter("catalog").createHistogram("catalog.search.results", {',
    '  description: "Products returned per search",',
    "});",
    "",
    "// Call it once a search has answered.",
    "function recordSearch(results) {",
    '  searchResults.record(results.length, { "search.kind": "keyword" });',
    "}",
  ].join("\n"),
  check: "contained",
};

const routerUse: GuideSnippet = {
  id: "router-use",
  language: "javascript",
  title: "app.js",
  code: [
    "// After every router.get and router.post: routes added later are not traced.",
    "app.use(router.routes()).use(router.allowedMethods());",
  ].join("\n"),
  check: "contained",
};

const namedRoute: GuideSnippet = {
  id: "named-route",
  language: "javascript",
  title: "app.js",
  code: [
    '// Its span is named "stock" instead of "router - /stock/:sku".',
    'router.get("stock", "/stock/:sku", getStock);',
  ].join("\n"),
  check: "parse",
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

// The app the end-to-end check runs: the page's fragments, word for word.
const appFile: string = [
  logger.code,
  "",
  errorMiddleware.code,
  "",
  customMetric.code,
  "",
  "// A stand-in for the search index.",
  "async function searchIndex(query) {",
  '  if (query === "") {',
  '    throw new Error("Search index unavailable");',
  "  }",
  '  const results = [{ id: "p1" }, { id: "p2" }];',
  "  recordSearch(results);",
  "  return results;",
  "}",
  "",
  'router.get("/healthz", (ctx) => {',
  '  ctx.body = "ok";',
  "});",
  "",
  'router.get("stock", "/stock/:sku", (ctx) => {',
  "  ctx.body = { sku: ctx.params.sku, available: 3 };",
  "});",
  "",
  productRoute.code,
  "",
  manualSpan.code,
  "",
  routerUse.code,
  "",
  "app.listen(3000);",
].join("\n");

export const KoaGuide: OpenTelemetryGuide = {
  slug: "koa",
  seo: {
    title: "Koa OpenTelemetry: Tracing and winston Logs | OneUptime",
    description:
      "Trace Koa 3 and @koa/router with OpenTelemetry: a span per route, winston logs with trace IDs, metrics and each error recorded once, in OneUptime.",
  },
  h1: "OpenTelemetry for Koa",
  lead: "The OpenTelemetry Node.js SDK traces Koa and `@koa/router` with no change to your middleware. This guide sets it up to record each error once, on its route's span, and sends your winston logs, with their trace IDs, to OneUptime beside the traces and metrics.",
  cardDescription:
    "A span per @koa/router route, winston logs with trace IDs, and route errors grouped under Exceptions.",
  searchTerms: ["koa", "koa.js", "koa-router", "winston", "middleware"],
  highlights: ["Koa 3 and @koa/router", "winston logs", "ES modules"],

  whatYouGet: {
    intro: `Every request your Koa app answers becomes a trace, filed under the service \`OTEL_SERVICE_NAME\` names in ${SCREENS.services}.`,
    traces:
      "A server span per request, named after the route `@koa/router` matched, such as `GET /products/:id`, with a span for the route beneath it. Queries, outgoing calls and your own spans nest under the route's span.",
    metrics:
      "`http.server.request.duration` by `http.route` and status code: each route's latency and error rate. The Node.js runtime's event loop, heap and garbage collection come with it.",
    logs: "Every winston record, with its fields as attributes and the trace ID of the request it was written in, so a log line opens its trace.",
    exceptions: `An error thrown in a route is recorded on the route's span, and the error middleware logs it with its stack trace. ${SCREENS.exceptions} groups the two as one issue.`,
  },

  exampleTrace: {
    caption: "A POST /search request, as its trace shows it",
    spans: [
      {
        name: "POST /search",
        depth: 0,
        start: 0,
        duration: 100,
        source: "http",
      },
      {
        name: "router - /search",
        depth: 1,
        start: 4,
        duration: 92,
        source: "koa",
      },
      {
        name: "catalog.search",
        depth: 2,
        start: 6,
        duration: 86,
        source: "your code",
      },
      {
        name: "mongodb.find",
        depth: 3,
        start: 10,
        duration: 40,
        source: "mongodb",
      },
      {
        name: "GET",
        depth: 3,
        start: 54,
        duration: 30,
        source: "undici",
      },
    ],
  },

  prerequisites: [
    NODE_PREREQUISITE,
    "A Koa 2 or 3 app, routed with `@koa/router`.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Install the SDK, the bundle of instrumentations, which covers Koa, and the winston transport the bundle sends logs with:",
    snippets: [install],
    notes: [
      "Without `@opentelemetry/winston-transport`, the winston instrumentation only adds trace IDs to the lines your transports write: nothing reaches OneUptime's Logs.",
    ],
  },

  configure: {
    intro:
      "Three environment variables tell the SDK where to send, with which key, and under which service name:",
    tabs: otlpEnvironmentTabs({
      serviceName: "catalog-api",
      cloudNote:
        "`catalog-api` is what OneUptime lists the service as; it is created when its first data arrives.",
    }),
    notes: [
      "The SDK sends OTLP as protobuf over HTTP unless told otherwise, which is what OneUptime's `/otlp` endpoint expects.",
    ],
  },

  setup: {
    intro:
      "A file that starts OpenTelemetry before Koa is loaded, the flag that loads it, and one middleware for errors.",
    steps: [
      {
        title: "Create the instrumentation file",
        body: "Save it next to `package.json`. It starts the SDK with the bundle, traced by route:",
        snippets: [instrumentation],
        notes: [
          'Koa runs each middleware inside the ones before it, and the instrumentation records an error on every traced layer it leaves. `ignoreLayersType: ["middleware"]` traces the routes only, so an error is recorded once.',
        ],
      },
      {
        title: "Start the app with it",
        body: "`--import` runs the file before the first line of your app:",
        snippets: [run],
        notes: [
          'Or, where the start command is fixed: `NODE_OPTIONS="--import ./instrumentation.mjs"`.',
        ],
      },
      {
        title: "Answer errors in one middleware",
        body: "Make it the first `app.use`, so every error thrown below it ends there. It logs a 5xx through winston, with the error, and answers the client:",
        snippets: [errorMiddleware],
        notes: [
          "Without it, Koa prints errors with `console.error`, which the SDK does not send.",
        ],
      },
      {
        title: "Register the router last",
        body: "The instrumentation wraps the routes the router has when `app.use(router.routes())` runs:",
        snippets: [routerUse],
      },
    ],
  },

  autoInstrumentation: {
    intro: "Loaded by the bundle, these trace a Koa app as it is:",
    rows: [
      {
        library: "`koa`, `@koa/router`",
        covers:
          "A span per matched route, `router - /products/:id`, with `http.route` and `koa.type`; and, without `ignoreLayersType`, one per middleware, such as `middleware - bodyParser`.",
      },
      {
        library: "`http`",
        covers:
          "The server span, named after the route once the router has matched it, and `http.server.request.duration`.",
      },
      {
        library: "`fetch` (undici), `http.request`",
        covers: "A client span for every call your routes make.",
      },
      {
        library: "`pg`, `mysql2`, `mongodb`, `mongoose`, `ioredis`",
        covers: "Query and command spans under the route that ran them.",
      },
      {
        library: "`winston`",
        covers:
          "Trace and span IDs on every record, and, with the transport installed, the records sent to OneUptime.",
      },
    ],
    snippets: [namedRoute],
    notes: [
      "A named route's span takes its name: `stock` instead of `router - /stock/:sku`.",
      "Koa 2 and 3 are both covered. Generator middleware, from Koa 1, is passed through without a span.",
      "Remove `ignoreLayersType` to see a span per middleware, at the cost of an error recorded once for every layer it passes.",
    ],
  },

  manualSpans: {
    intro:
      "Wrap work no library knows about in a span of your own. Started in a route, it nests under the route's span:",
    snippets: [manualSpan],
    notes: [
      "`startActiveSpan` makes the span current, so the queries and calls made inside it nest under it.",
      "Set as attributes what you will search by, such as `search.query`, and keep personal data out of them.",
      "The error recorded on your span shows where it happened. Under Exceptions it is the same issue as the route span's.",
    ],
  },

  logs: {
    intro:
      "Create the logger as usual. The winston instrumentation adds a transport to it that sends each record to OneUptime, and stamps it with the trace and span of the request it was written in:",
    snippets: [logger, productRoute],
    notes: [
      "The fields you pass, such as `productId`, become attributes of the record: search them in the Logs explorer.",
      "An `err` field holding an error becomes the record's exception, which OneUptime groups with the same error on the route's span.",
      "Records written outside a request, at startup or in a timer, carry no trace.",
    ],
  },

  metrics: {
    intro:
      "Request and runtime metrics are sent once a minute without code. Record your own beside them:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Each request's duration by `http.route`, method and status code.",
      },
      {
        name: "http.client.request.duration",
        description: "The duration of every call your routes make, by host.",
      },
      {
        name: "nodejs.eventloop.delay.p99",
        description:
          "How long callbacks waited for the event loop. A route that blocks it slows every other request.",
      },
    ],
    snippets: [customMetric],
    notes: [
      "A histogram keeps the spread of what it records, here the number of products per search, by `search.kind`.",
    ],
  },

  sampling: {
    intro:
      "Every request is traced until you sample. To keep a quarter of new traces, and every trace whose caller kept it:",
    snippets: [sampling],
    notes: [
      "A request that arrives with a sampled `traceparent` header is always kept, so a trace that started in another service stays whole.",
      "Logs and metrics are sent for every request whatever the sampler decides.",
    ],
  },

  deploy: {
    intro:
      "The image runs the same command as your terminal, and the container gets the three variables when it starts:",
    snippets: [
      nodeDockerfileSnippet({
        command: ["node", "--import", "./instrumentation.mjs", "app.js"],
        port: 3000,
      }),
      kubernetesManifestSnippet({
        name: "catalog-api",
        image: "registry.example.com/catalog-api:3.2.0",
        containerPort: 3000,
      }),
    ],
    notes: [
      "`app.listen(3000)` listens on every interface, so the container's port is reachable as it is.",
      "When the pod stops, the instrumentation file sends what is still buffered before the process exits.",
    ],
  },

  verify: {
    intro: "Go through these in order: each one rules out a cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Start the app, open \`/products/42\`, then ${SCREENS.services}: \`catalog-api\` appears within a minute.`,
      },
      {
        title: "Open a trace",
        body: `In ${SCREENS.traces}, search \`@http.route:/products/:id\`: each request holds its route's span.`,
      },
      {
        title: "Follow a log line to its trace",
        body: `In ${SCREENS.logs}, open a \`loading product\` record: its trace ID leads to the request that wrote it.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Some routes have no span, and their server span is only GET",
      answer:
        "They were added to the router after `app.use(router.routes())`. The instrumentation wraps the routes the router has at that moment: register the router after the last route.",
    },
    {
      question: "The same error appears several times in one trace",
      answer:
        'Every traced layer records an error thrown through it. Keep `ignoreLayersType: ["middleware"]` in the instrumentation file, so only the route\'s span records it.',
    },
    {
      question: "401s and 404s are listed under Exceptions",
      answer:
        "`ctx.throw` and `ctx.assert` throw, and the route's span records every thrown error, whatever its status. Answer a client error with `ctx.status` and `ctx.body` instead, or archive its issue: an archived issue stops notifying.",
    },
    {
      question: "Logs appear in the terminal but not in OneUptime",
      answer:
        "Install `@opentelemetry/winston-transport`: without it, the winston instrumentation only adds trace IDs to the lines your own transports write.",
    },
    {
      question: "Health checks fill the trace list",
      answer:
        "Name their path in the HTTP instrumentation's `ignoreIncomingRequestHook`, as the instrumentation file does for `/healthz`: those requests are then not traced at all.",
    },
    {
      question: "It works locally, but nothing arrives from Kubernetes",
      answer:
        "Make sure the pod has the Secret's `OTEL_EXPORTER_OTLP_HEADERS` and can reach the endpoint, and set `OTEL_LOG_LEVEL=debug` to log each export's result.",
    },
  ],

  faq: [
    {
      question: "Does OpenTelemetry support Koa 3?",
      answer:
        "Yes. The Koa instrumentation covers Koa 2 and 3, and this guide was checked end to end with Koa 3.2 and `@koa/router` 15.7.",
    },
    {
      question: "Do I have to change my middleware?",
      answer:
        "No. Routes and middleware are traced as they are; the error middleware in step 3 is the only code to add, and most Koa apps have one already.",
    },
    {
      question: "Can I log with pino instead of winston?",
      answer:
        "Yes: the bundle instruments pino too, and sends its records with no extra package. Keep the error middleware, logging the error as `err`.",
    },
    {
      question: "Can I write the app in TypeScript?",
      answer:
        "Yes. Compile it as usual and keep `instrumentation.mjs` as JavaScript: `node --import ./instrumentation.mjs dist/app.js`.",
    },
  ],

  related: ["express", "fastify", "hapi", "nodejs"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.metrics],

  verification: {
    runtime: "node",
    framework: { name: "Koa", package: "koa" },
    files: [
      {
        path: "package.json",
        content: '{ "name": "catalog-api", "private": true, "type": "module" }',
      },
      { path: "instrumentation.mjs", snippet: "instrumentation" },
      { path: "app.js", content: appFile },
    ],
    commands: [
      { snippet: "install" },
      {
        command:
          "npm install koa@3.2.1 @koa/router@15.7.0 @koa/bodyparser@6.1.0 winston@3.19.0",
      },
      { snippet: "run", isServer: true },
    ],
    port: 3000,
    requests: [
      { method: "GET", path: "/healthz" },
      { method: "GET", path: "/products/42" },
      { method: "GET", path: "/stock/sku-9" },
      { method: "POST", path: "/search", body: { query: "kettle" } },
      { method: "POST", path: "/search", body: { query: "" } },
    ],
    expect: {
      spans: [
        {
          name: "GET /products/:id",
          attributes: { "http.route": "/products/:id" },
        },
        {
          name: "router - /products/:id",
          attributes: { "koa.type": "router" },
        },
        { name: "stock", attributes: { "http.route": "/stock/:sku" } },
        {
          name: "catalog.search",
          attributes: { "search.query": "kettle", "search.result_count": "2" },
        },
        { name: "catalog.search", hasException: true },
        { name: "router - /search", hasException: true },
      ],
      metrics: ["http.server.request.duration", "catalog.search.results"],
      logs: [
        { body: "loading product", hasTraceContext: true },
        {
          body: "request failed",
          hasTraceContext: true,
          hasException: true,
        },
      ],
      resource: { "service.name": "catalog-api" },
      untracedPaths: ["/healthz"],
      absentSpans: ["middleware - bodyParser", "middleware - anonymous"],
    },
  },
};
