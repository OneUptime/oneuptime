import { GuideSnippet, OpenTelemetryGuide } from "../GuideTypes";
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

/*
 * Node.js without a framework: a plain node:http server, a worker, a CLI.
 * The language's own guide, which the Dashboard's telemetry guide opens for
 * "Node.js / TypeScript"; the frameworks' guides build on it.
 */

const install: GuideSnippet = npmInstallSnippet("install", [
  "@opentelemetry/api",
  "@opentelemetry/sdk-node",
  "@opentelemetry/auto-instrumentations-node",
  "@opentelemetry/instrumentation",
]);

const installCore: GuideSnippet = npmInstallSnippet("install-core", [
  "@opentelemetry/core",
]);

const instrumentation: GuideSnippet = {
  id: "instrumentation",
  language: "javascript",
  title: "instrumentation.mjs",
  code: nodeInstrumentationFile(),
  check: "run",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "node --import ./instrumentation.mjs server.mjs",
  check: "run",
};

const runTypeScript: GuideSnippet = {
  id: "run-typescript",
  language: "bash",
  code: "node --import ./instrumentation.mjs src/server.ts",
  check: "parse",
};

const routeName: GuideSnippet = {
  id: "route-name",
  language: "javascript",
  title: "server.mjs",
  code: [
    'import { context } from "@opentelemetry/api";',
    'import { getRPCMetadata, RPCType } from "@opentelemetry/core";',
    "",
    "// Names the request's span and its metrics after the route, as a router does.",
    "function setRoute(route) {",
    "  const rpc = getRPCMetadata(context.active());",
    "  if (rpc?.type === RPCType.HTTP) {",
    "    rpc.route = route;",
    "  }",
    "}",
  ].join("\n"),
  check: "contained",
};

const manualSpan: GuideSnippet = {
  id: "manual-span",
  language: "javascript",
  title: "server.mjs",
  code: [
    'import { trace, SpanStatusCode } from "@opentelemetry/api";',
    "",
    'const tracer = trace.getTracer("invoices");',
    "",
    "async function renderInvoice(invoiceId) {",
    '  return tracer.startActiveSpan("invoice.render", async (span) => {',
    "    try {",
    '      span.setAttribute("invoice.id", invoiceId);',
    "      const pdf = await buildPdf(invoiceId);",
    '      span.setAttribute("invoice.pages", pdf.pages);',
    "      return pdf;",
    "    } catch (error) {",
    "      span.recordException(error);",
    "      span.setStatus({ code: SpanStatusCode.ERROR });",
    "      throw error;",
    "    } finally {",
    "      span.end();",
    "    }",
    "  });",
    "}",
  ].join("\n"),
  check: "contained",
};

const logging: GuideSnippet = {
  id: "logging",
  language: "javascript",
  title: "server.mjs",
  code: [
    'import { logs, SeverityNumber } from "@opentelemetry/api";',
    "",
    'const logger = logs.getLogger("invoices");',
    "",
    "function logInvoice(message, invoiceId) {",
    "  logger.emit({",
    "    severityNumber: SeverityNumber.INFO,",
    '    severityText: "INFO",',
    "    body: message,",
    '    attributes: { "invoice.id": invoiceId },',
    "  });",
    "}",
  ].join("\n"),
  check: "contained",
};

const customMetric: GuideSnippet = {
  id: "custom-metric",
  language: "javascript",
  title: "server.mjs",
  code: [
    'import { metrics } from "@opentelemetry/api";',
    "",
    'const invoicePages = metrics.getMeter("invoices").createHistogram("invoice.pages", {',
    '  description: "Pages per rendered invoice",',
    "});",
    "",
    "function recordPages(pdf) {",
    '  invoicePages.record(pdf.pages, { "invoice.template": pdf.template });',
    "}",
  ].join("\n"),
  check: "contained",
};

const zeroCode: GuideSnippet = {
  id: "zero-code",
  language: "bash",
  code: [
    "node --require @opentelemetry/auto-instrumentations-node/register server.cjs",
  ].join("\n"),
  check: "parse",
};

const detectors: GuideSnippet = {
  id: "detectors",
  language: "bash",
  code: 'export OTEL_NODE_RESOURCE_DETECTORS="env,host,os,process,serviceinstance,container"',
  check: "parse",
};

const sampling: GuideSnippet = {
  id: "sampling",
  language: "bash",
  code: [
    'export OTEL_TRACES_SAMPLER="parentbased_traceidratio"',
    'export OTEL_TRACES_SAMPLER_ARG="0.1"',
    'export OTEL_NODE_DISABLED_INSTRUMENTATIONS="dns,net,fs"',
  ].join("\n"),
  check: "parse",
};

/*
 * The app the end-to-end check runs: a plain node:http server with the
 * page's fragments, word for word, and a stand-in for the PDF builder.
 */
const serverFile: string = [
  'import http from "node:http";',
  "",
  routeName.code,
  "",
  logging.code,
  "",
  customMetric.code,
  "",
  "// A stand-in for the real PDF builder.",
  "async function buildPdf(invoiceId) {",
  '  if (invoiceId === "broken") {',
  '    throw new Error("Template invoice-v2 is missing");',
  "  }",
  '  return { pages: 3, template: "invoice-v2" };',
  "}",
  "",
  manualSpan.code,
  "",
  "const invoicePath = /^\\/invoices\\/([^/]+)$/;",
  "",
  "const server = http.createServer(async (req, res) => {",
  "  const match = invoicePath.exec(req.url);",
  "  if (!match) {",
  '    res.end("ok");',
  "    return;",
  "  }",
  '  setRoute("/invoices/:id");',
  "  try {",
  '    logInvoice("rendering invoice", match[1]);',
  "    const pdf = await renderInvoice(match[1]);",
  "    recordPages(pdf);",
  '    res.end("rendered");',
  "  } catch {",
  "    res.statusCode = 500;",
  '    res.end("failed");',
  "  }",
  "});",
  "",
  "server.listen(3000);",
].join("\n");

export const NodeJsGuide: OpenTelemetryGuide = {
  slug: "nodejs",
  seo: {
    title: "Node.js OpenTelemetry: Traces, Metrics & Logs | OneUptime",
    description:
      "Add OpenTelemetry to any Node.js app: one instrumentation file for ES modules and CommonJS, automatic HTTP and database spans, runtime metrics and logs in OneUptime.",
  },
  h1: "OpenTelemetry for Node.js",
  lead: "Send traces, metrics and logs from any Node.js app to OneUptime: an HTTP server without a framework, a queue worker, a cron job or a CLI. One instrumentation file loads before your code, works for ES modules and CommonJS, and traces the libraries you already use.",
  cardDescription:
    "Any Node.js app, framework or not: ES modules, CommonJS and TypeScript, workers and HTTP servers.",
  searchTerms: [
    "node",
    "nodejs",
    "javascript",
    "typescript",
    "esm",
    "commonjs",
    "worker",
    "sdk-node",
  ],
  highlights: [
    "Automatic instrumentation",
    "ES modules and CommonJS",
    "TypeScript",
  ],

  whatYouGet: {
    intro: `Every Node.js process that loads the SDK reports as one service, named by \`OTEL_SERVICE_NAME\` and listed under ${SCREENS.services}. The same SDK covers a web server and a worker, so a request and the job it queues can share one trace.`,
    traces:
      "A server span per incoming HTTP request, client spans for `fetch()`, `http.request` and gRPC calls, and a span per query to PostgreSQL, MySQL, MongoDB or Redis: about 40 libraries in all. Your own spans wrap the work no library knows about.",
    metrics:
      "Request duration for every incoming and outgoing HTTP call, and the runtime's health: event loop utilization and delay, heap by V8 space, garbage collection pauses and active handles. Custom counters and histograms sit beside them.",
    logs: "pino, winston and bunyan records with the trace and span IDs of the code that wrote them, or records you write yourself with the API's `logs` when the app has no logger.",
    exceptions: `\`span.recordException\` and errors the instrumentations catch become exception events on their spans. OneUptime groups them under ${SCREENS.exceptions}, one issue per error, with the stack trace and every request it happened in.`,
  },

  exampleTrace: {
    caption: "A GET /invoices/:id request, as its trace shows it",
    spans: [
      {
        name: "GET /invoices/:id",
        depth: 0,
        start: 0,
        duration: 100,
        source: "http",
      },
      {
        name: "pg.query:SELECT invoices",
        depth: 1,
        start: 4,
        duration: 14,
        source: "pg",
      },
      {
        name: "invoice.render",
        depth: 1,
        start: 21,
        duration: 74,
        source: "your code",
      },
      {
        name: "GET",
        depth: 2,
        start: 28,
        duration: 30,
        source: "undici",
      },
      {
        name: "s3.PutObject",
        depth: 2,
        start: 63,
        duration: 26,
        source: "aws-sdk",
      },
    ],
  },

  prerequisites: [
    `Node.js ${MINIMUM_NODE_VERSION} or later, the oldest the OpenTelemetry JS SDK 3.0 supports. These steps were checked on Node.js 24 LTS.`,
    "An app started with `node`: a server, a worker or a script, written as ES modules or CommonJS, in JavaScript or TypeScript.",
    `A OneUptime ingestion key of the **Server** type, from ${SCREENS.ingestionKeys}: see [Ingestion keys](/docs/telemetry/ingestion-keys).`,
  ],

  install: {
    intro:
      "Install the SDK, the bundle of automatic instrumentations and the API. These are the versions this guide was checked with.",
    snippets: [install],
    notes: [
      "`@opentelemetry/auto-instrumentations-node` holds every instrumentation the OpenTelemetry project maintains for Node.js. Each one patches its library only when your app loads it, and leaves the others alone.",
      "`@opentelemetry/instrumentation` holds the ES module hook. Naming it keeps pnpm and Yarn, which do not hoist dependencies, working.",
    ],
  },

  configure: {
    intro:
      "Where to send and which key to send are read from standard environment variables, which every OpenTelemetry SDK understands, so they never appear in your code:",
    tabs: otlpEnvironmentTabs({
      serviceName: "invoice-service",
      cloudNote:
        "Run several processes from one codebase, such as a web server and a worker? Give each its own `OTEL_SERVICE_NAME`, so OneUptime lists them as separate services.",
    }),
    notes: [
      "To tag everything with its environment, add `OTEL_RESOURCE_ATTRIBUTES=\"deployment.environment.name=production\"`.",
    ],
  },

  setup: {
    intro:
      "The SDK has to start before your app loads the libraries it traces. A file loaded with `--import` does exactly that, for ES modules and CommonJS alike.",
    steps: [
      {
        title: "Create the instrumentation file",
        body: "Save it next to your `package.json`. It registers the hook that lets the instrumentations patch packages imported as ES modules, starts the SDK with every automatic instrumentation, and sends what is still buffered when the process stops or a script ends.",
        snippets: [instrumentation],
        notes: [
          "The `.mjs` extension makes it an ES module whatever your `package.json` says, so the same file works in a CommonJS app.",
          "The health check path is left out of tracing: change `/healthz` to yours, or delete the option if you have none.",
        ],
      },
      {
        title: "Start Node.js with it",
        body: "Put `--import ./instrumentation.mjs` before your entry point, wherever the app is started:",
        snippets: [run],
        notes: [
          "In `package.json`, the same goes in the `start` script: `\"start\": \"node --import ./instrumentation.mjs server.mjs\"`.",
          "Where you cannot change the command, set `NODE_OPTIONS=\"--import ./instrumentation.mjs\"` instead. Every Node.js process started with it loads the file, child processes included.",
        ],
      },
      {
        title: "Run TypeScript as it is, or compiled",
        body: "Node.js 24 runs TypeScript files directly when they use only erasable syntax, and the instrumentation file loads the same way. For a compiled app, start the compiled entry point instead, such as `dist/server.js`.",
        snippets: [runTypeScript],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "Every library below is traced as soon as the app loads it, with nothing to configure. The ones most Node.js apps meet:",
    rows: [
      {
        library: "`node:http`, `node:https`",
        covers:
          "A server span per incoming request with its method, path and status code, and a client span per outgoing request. Without a router, the span is named after the method alone: see below.",
      },
      {
        library: "`fetch` (undici)",
        covers:
          "A client span and a `http.client.request.duration` measurement for every `fetch()`, Node.js's built-in HTTP client.",
      },
      {
        library: "`pg`, `mysql2`, `mongodb`, `ioredis`, `redis`, `knex`, `tedious`, `oracledb`",
        covers:
          "A span per query or command, named after the operation, with the database system and name.",
      },
      {
        library: "`amqplib`, `kafkajs`, `@aws-sdk/*`",
        covers:
          "A span per message published and consumed, with the trace carried from producer to consumer, and a span per AWS call.",
      },
      {
        library: "`@grpc/grpc-js`, `graphql`, `socket.io`",
        covers:
          "Client and server spans for gRPC, spans for GraphQL parsing, validation and resolvers, and Socket.IO events.",
      },
      {
        library: "`pino`, `winston`, `bunyan`",
        covers:
          "Trace and span IDs on each record, and the records sent to OneUptime as logs (winston also needs `@opentelemetry/winston-transport`).",
      },
    ],
    snippets: [installCore, routeName],
    notes: [
      "A server with no router has no route to name its spans after, so they are all `GET` or `POST`. Tell the HTTP instrumentation the route yourself, and the span becomes `GET /invoices/:id` and `http.server.request.duration` gains `http.route`. It takes `@opentelemetry/core`:",
    ],
  },

  manualSpans: {
    intro:
      "Wrap the work your process does in spans of its own: rendering a PDF, handling a queue message, a step of a cron job. Inside a request they nest under its span; in a worker each becomes its own trace.",
    snippets: [manualSpan],
    notes: [
      "`startActiveSpan` makes the span current until its callback returns, so the queries and HTTP calls made inside it become its children, across `await`s.",
      "In a worker, start one span per job: a trace that lasts as long as the process says nothing useful.",
      "A message that arrived with a `traceparent`, from a queue or a webhook, can continue the sender's trace: pass the result of `propagation.extract(context.active(), headers)` as the context of `startActiveSpan`.",
    ],
  },

  logs: {
    intro:
      "With pino, winston or bunyan the logs arrive by themselves, stamped with their trace. An app with no logger can write records straight to the API: each one carries the trace and span that were active when it was written.",
    snippets: [logging],
    notes: [
      "`console.log` is not sent: it writes to stdout and nothing else. Swap it for a logger, or for the API as above.",
      "`severityNumber` is what OneUptime filters on: `SeverityNumber.WARN` and `SeverityNumber.ERROR` make warnings and errors.",
      "With pino, nothing changes in your code: see the [Express guide](/integrations/opentelemetry/express) for a pino setup.",
    ],
  },

  metrics: {
    intro:
      "The SDK exports metrics every 60 seconds. The runtime instrumentation reports the process's health with no code:",
    builtIn: [
      {
        name: "nodejs.eventloop.utilization",
        description:
          "The share of time the event loop was busy. Near 1 means the process is CPU-bound.",
      },
      {
        name: "nodejs.eventloop.delay.p99",
        description:
          "How long a callback waited for the event loop, at the 99th percentile. Synchronous work in a request shows here first.",
      },
      {
        name: "v8js.memory.heap.used",
        description:
          "Heap in use per V8 space: a steady climb across restarts points at a leak.",
      },
      {
        name: "v8js.gc.duration",
        description: "Garbage collection pauses, by kind.",
      },
      {
        name: "http.server.request.duration",
        description:
          "Incoming requests by method, status code and, once the route is known, `http.route`.",
      },
    ],
    snippets: [customMetric],
    notes: [
      "A histogram keeps the spread of values, so OneUptime can chart percentiles; a counter keeps a running total.",
      "Keep attribute values to a small set: a template name, not an invoice ID.",
    ],
  },

  sampling: {
    intro:
      "Each process decides which traces to keep. Keep a share of new traces, follow the caller's decision for the rest, and turn off instrumentations that only add noise:",
    snippets: [sampling],
    notes: [
      "`OTEL_TRACES_SAMPLER_ARG=\"0.1\"` keeps one new trace in ten. A request that arrives with a sampled `traceparent` is always kept, so traces across services stay whole.",
      "`dns` and `net` add a span per lookup and per socket; `fs` (off by default) a span per file read. Most teams leave them off.",
      "Metrics and logs are never sampled.",
    ],
  },

  deploy: {
    intro:
      "In a container, the image's command loads the instrumentation file, and the environment comes from the platform. Keep the key out of the image.",
    snippets: [
      nodeDockerfileSnippet({
        command: ["node", "--import", "./instrumentation.mjs", "server.mjs"],
        port: 3000,
      }),
      kubernetesManifestSnippet({
        name: "invoice-service",
        image: "registry.example.com/invoice-service:2.3.1",
        containerPort: 3000,
      }),
    ],
    notes: [
      "Use the exec form of `CMD`, as above, so Node.js is the container's first process and receives SIGTERM itself. The instrumentation file then sends what is buffered before the process exits.",
      "Several replicas share one service name. Each reports its own `host.name`, the pod's name in Kubernetes, so you can still tell them apart.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      {
        title: "Ask OneUptime whether it accepts the key",
        body: "`200` with `\"valid\": true` means it does; `401` says why it does not.",
        snippets: [validateKeySnippet()],
      },
      {
        title: "Find the service",
        body: `Start the app, send it a request or a job, and open ${SCREENS.services}. \`invoice-service\` appears within a minute.`,
      },
      {
        title: "Open a trace",
        body: `In ${SCREENS.traces}, search for \`invoice.render\`: the span sits inside its request's trace, with the queries and calls it made beneath it.`,
      },
      {
        title: "Chart the runtime",
        body: `In ${SCREENS.metrics}, chart \`nodejs.eventloop.delay.p99\` to see how loaded the process is.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Nothing arrives from an ES module app",
      answer:
        "The packages were loaded before the hook was registered. Load the instrumentation file with `--import` on the command line: importing it from your entry point is too late, because Node.js loads every `import` of a module before running any of it. `--require @opentelemetry/auto-instrumentations-node/register` alone has the same problem, since it registers no ES module hook.",
    },
    {
      question: "MetadataLookupWarning: received unexpected error",
      answer:
        "`@opentelemetry/auto-instrumentations-node/register` runs every resource detector, the clouds' included, and the Google Cloud one tries a metadata server that does not exist outside Google Cloud. The instrumentation file above runs the default detectors only. With `register`, list the detectors you want:",
      snippets: [detectors],
    },
    {
      question: "The process ignores SIGTERM",
      answer:
        "Something registered a SIGTERM handler that never exits. `@opentelemetry/auto-instrumentations-node/register` does: it sends the buffered data and leaves the server running until it is killed. The instrumentation file above exits once the data is sent, unless your app handles SIGTERM too.",
    },
    {
      question: "Spans are all named GET or POST",
      answer:
        "Nothing told the HTTP instrumentation the route: a router does that, a bare `node:http` server cannot. Name the route with `getRPCMetadata` as shown above, or use a framework's guide: Express, Fastify, Koa and Hapi name their spans by themselves.",
    },
    {
      question: "Cannot find package '@opentelemetry/instrumentation'",
      answer:
        "The hook's package is not where Node.js resolves it from, which happens with pnpm's strict layout. Install `@opentelemetry/instrumentation` as a direct dependency, as the install command above does.",
    },
    {
      question: "A bundled app sends HTTP spans but no database spans",
      answer:
        "A bundler (esbuild, webpack, Rollup) copied the driver into the bundle, where the instrumentations cannot patch it. Mark the instrumented packages as external, such as `--external:pg` for esbuild, so they load from `node_modules` at run time.",
    },
  ],

  faq: [
    {
      question: "Can I set it up without a file?",
      answer:
        "For a CommonJS app, yes: `node --require @opentelemetry/auto-instrumentations-node/register server.cjs` with the same environment variables. It cannot patch packages an ES module imports, leaves the process running on SIGTERM, and runs the cloud resource detectors, which is why this guide uses a file.",
      snippets: [zeroCode],
    },
    {
      question: "Which Node.js versions does it support?",
      answer: `OpenTelemetry JS 3.0, which this guide installs, supports Node.js ${MINIMUM_NODE_VERSION} and later. On Node.js 20 or older, stay on the 2.x SDK (\`@opentelemetry/sdk-node\` 0.223 and earlier) or, better, upgrade Node.js: version 20 is past its end of life.`,
    },
    {
      question: "How do I add the app's version to everything it sends?",
      answer:
        "Add it to the resource with `OTEL_RESOURCE_ATTRIBUTES`, for example `service.version=2.3.1,deployment.environment.name=production`. Every span, metric and log of the process carries it, so you can compare one release with the next.",
    },
    {
      question: "Does it work for a script or a cron job?",
      answer:
        "Yes. The instrumentation file sends what is still buffered when the event loop empties, so a job that ends on its own loses nothing. A script that calls `process.exit()` skips that step: let it end on its own instead.",
    },
    {
      question: "Do I need the OpenTelemetry Collector?",
      answer:
        "No: the SDK sends to OneUptime directly. Add a Collector when you want to batch, filter or route data in one place: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["express", "nestjs", "fastify", "bun"],
  docs: [DOCS.openTelemetry, DOCS.services, DOCS.metrics, DOCS.searchSyntax],

  verification: {
    runtime: "node",
    framework: { name: "Node.js" },
    files: [
      {
        path: "package.json",
        content:
          '{ "name": "invoice-service", "private": true, "type": "module" }',
      },
      { path: "instrumentation.mjs", snippet: "instrumentation" },
      { path: "server.mjs", content: serverFile },
    ],
    commands: [
      { snippet: "install" },
      { snippet: "install-core" },
      { snippet: "run", isServer: true },
    ],
    port: 3000,
    requests: [
      { method: "GET", path: "/healthz" },
      { method: "GET", path: "/invoices/inv_1042" },
      { method: "GET", path: "/invoices/broken" },
    ],
    expect: {
      spans: [
        {
          name: "GET /invoices/:id",
          attributes: { "http.route": "/invoices/:id" },
        },
        {
          name: "invoice.render",
          attributes: { "invoice.id": "inv_1042", "invoice.pages": "3" },
        },
        { name: "invoice.render", hasException: true },
      ],
      metrics: [
        "http.server.request.duration",
        "invoice.pages",
        "nodejs.eventloop.utilization",
        "nodejs.eventloop.delay.p99",
        "v8js.memory.heap.used",
      ],
      logs: [{ body: "rendering invoice", hasTraceContext: true }],
      resource: { "service.name": "invoice-service" },
      untracedPaths: ["/healthz"],
    },
  },
};
