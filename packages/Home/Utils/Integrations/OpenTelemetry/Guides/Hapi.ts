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
 * hapi 21, traced by the bundle's hapi instrumentation, with hapi-pino for
 * logs: hapi-pino logs through pino, which the bundle instruments, so every
 * response line and every failed request reaches OneUptime with its trace.
 */

const install: GuideSnippet = npmInstallSnippet("install", [
  "@opentelemetry/api",
  "@opentelemetry/sdk-node",
  "@opentelemetry/auto-instrumentations-node",
  "@opentelemetry/instrumentation",
  "hapi-pino",
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
  code: "node --import ./instrumentation.mjs server.js",
  check: "run",
};

const serverSetup: GuideSnippet = {
  id: "server-setup",
  language: "javascript",
  title: "server.js",
  code: [
    'import Hapi from "@hapi/hapi";',
    'import HapiPino from "hapi-pino";',
    "",
    'const server = Hapi.server({ port: 3000, host: "0.0.0.0" });',
    "",
    "// A line per response and per failed request, sent to OneUptime with the",
    "// request's trace ID. Health checks are left out, as they are of the traces.",
    "await server.register({",
    "  plugin: HapiPino,",
    '  options: { ignorePaths: ["/healthz"] },',
    "});",
  ].join("\n"),
  check: "contained",
};

const roomRoute: GuideSnippet = {
  id: "room-route",
  language: "javascript",
  title: "server.js",
  code: [
    "server.route({",
    '  method: "GET",',
    '  path: "/rooms/{id}",',
    "  handler: (request) => {",
    '    request.logger.info({ roomId: request.params.id }, "loading room");',
    "    return { id: request.params.id, beds: 2 };",
    "  },",
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
    'const tracer = trace.getTracer("bookings");',
    "",
    "server.route({",
    '  method: "POST",',
    '  path: "/bookings",',
    "  handler: (request, h) => {",
    '    return tracer.startActiveSpan("bookings.reserve", async (span) => {',
    "      try {",
    '        span.setAttribute("booking.nights", request.payload.nights);',
    "        const booking = await reserveRoom(request.payload);",
    "        return h.response(booking).code(201);",
    "      } catch (error) {",
    "        span.recordException(error);",
    "        span.setStatus({ code: SpanStatusCode.ERROR });",
    "        throw error;",
    "      } finally {",
    "        span.end();",
    "      }",
    "    });",
    "  },",
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
    'const bookingsCreated = metrics.getMeter("bookings").createCounter("bookings.created", {',
    '  description: "Bookings made, by channel",',
    "});",
    "",
    "// Call it once a booking is confirmed.",
    "function countBooking(channel) {",
    '  bookingsCreated.add(1, { "booking.channel": channel });',
    "}",
  ].join("\n"),
  check: "contained",
};

const start: GuideSnippet = {
  id: "start",
  language: "javascript",
  title: "server.js",
  code: "await server.start();",
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

// The app the end-to-end check runs: the page's fragments, word for word.
const serverFile: string = [
  serverSetup.code,
  "",
  customMetric.code,
  "",
  "// A stand-in for the reservations system.",
  "async function reserveRoom(payload) {",
  "  if (payload.nights > 30) {",
  '    throw new Error("Room inventory unavailable");',
  "  }",
  '  countBooking("web");',
  '  return { id: "bk_1001", nights: payload.nights };',
  "}",
  "",
  "server.route({",
  '  method: "GET",',
  '  path: "/healthz",',
  '  handler: () => "ok",',
  "});",
  "",
  roomRoute.code,
  "",
  manualSpan.code,
  "",
  start.code,
].join("\n");

export const HapiGuide: OpenTelemetryGuide = {
  slug: "hapi",
  seo: {
    title: "hapi OpenTelemetry: Tracing and hapi-pino Logs | OneUptime",
    description:
      "Trace hapi 21 with OpenTelemetry: route, plugin and extension spans, hapi-pino logs with trace IDs, metrics and failed requests in OneUptime.",
  },
  h1: "OpenTelemetry for hapi",
  lead: "The OpenTelemetry Node.js SDK traces hapi's routes, plugins and extension points as they are. Add hapi-pino and every response and failed request is logged with its trace ID, so OneUptime holds the traces, logs, metrics and errors of your hapi server in one place.",
  cardDescription:
    "Route, plugin and extension spans, and hapi-pino logs of every response with its trace ID.",
  searchTerms: ["hapi", "@hapi/hapi", "hapi.js", "hapi-pino", "plugins"],
  highlights: ["hapi 21", "Plugins and extensions", "hapi-pino logs"],

  whatYouGet: {
    intro: `Each request the hapi server handles is one trace, under the service called \`OTEL_SERVICE_NAME\` in ${SCREENS.services}.`,
    traces:
      "A server span per request, named after its route, such as `GET /rooms/{id}`, with the route's span beneath it and a span for each extension a plugin runs, such as `hapi-pino: ext - onRequest`. Queries and outgoing calls nest under the route.",
    metrics:
      "`http.server.request.duration` by `http.route` and status code, so each route has its own latency and error rate, plus the Node.js runtime's event loop, heap and garbage collection.",
    logs: "hapi-pino's `[response]` line for every request, your `request.logger` lines and a line for every failed request, each with the trace ID of its request.",
    exceptions: `A handler that throws is recorded on its route's span, and hapi-pino logs the failed request with the error. ${SCREENS.exceptions} groups the two as one issue, with the stack trace.`,
  },

  exampleTrace: {
    caption: "A POST /bookings request, as its trace shows it",
    spans: [
      {
        name: "POST /bookings",
        depth: 0,
        start: 0,
        duration: 100,
        source: "http",
      },
      {
        name: "hapi-pino: ext - onRequest",
        depth: 1,
        start: 1,
        duration: 3,
        source: "hapi",
      },
      {
        name: "route - /bookings",
        depth: 1,
        start: 8,
        duration: 88,
        source: "hapi",
      },
      {
        name: "bookings.reserve",
        depth: 2,
        start: 10,
        duration: 84,
        source: "your code",
      },
      {
        name: "pg.query:INSERT bookings",
        depth: 3,
        start: 18,
        duration: 30,
        source: "pg",
      },
      {
        name: "POST",
        depth: 3,
        start: 52,
        duration: 38,
        source: "undici",
      },
    ],
  },

  prerequisites: [
    NODE_PREREQUISITE,
    "A hapi app on `@hapi/hapi` 17 to 21.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Install the SDK, the bundle of instrumentations, which covers hapi and pino, and hapi-pino:",
    snippets: [install],
    notes: [
      "hapi-pino brings pino with it. Already have a logging plugin? Keep it if it logs through pino; otherwise see the FAQ.",
    ],
  },

  configure: {
    intro:
      "The SDK finds where to send, the key and the service's name in three environment variables:",
    tabs: otlpEnvironmentTabs({
      serviceName: "bookings-api",
      cloudNote:
        "OneUptime creates `bookings-api` in its service catalog when the first data arrives.",
    }),
    notes: [
      "Protobuf over HTTP is the SDK's default OTLP protocol and the one the `/otlp` endpoint reads.",
    ],
  },

  setup: {
    intro:
      "Start OpenTelemetry before hapi is loaded, then register hapi-pino for the logs.",
    steps: [
      {
        title: "Create the instrumentation file",
        body: "Save it next to `package.json`. It starts the SDK with the bundle, leaves the health check out, and sends what is buffered when the server stops:",
        snippets: [instrumentation],
      },
      {
        title: "Start the server with it",
        body: "`--import` loads the file before hapi, so the instrumentation can patch it:",
        snippets: [run],
        notes: [
          'On a platform with a fixed start command, set `NODE_OPTIONS="--import ./instrumentation.mjs"`.',
        ],
      },
      {
        title: "Register hapi-pino",
        body: "Register it before your routes. It logs every response and every failed request through pino, which the SDK sends to OneUptime:",
        snippets: [serverSetup],
        notes: [
          '`host: "0.0.0.0"` listens on every interface, as a container needs. hapi\'s own examples use `host: "localhost"`, which nothing outside the container reaches.',
          "`ignorePaths` keeps the health check out of the logs too: the instrumentation file only leaves it out of the traces.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro: "The bundle traces these in a hapi server with no code:",
    rows: [
      {
        library: "`@hapi/hapi`",
        covers:
          "A span per route, `route - /rooms/{id}`, and one per extension point a plugin or your code adds. Routes a plugin adds are named after it: `bookings: route - /bookings`.",
      },
      {
        library: "`http`",
        covers:
          "The server span, named `GET /rooms/{id}` with hapi's route syntax, and `http.server.request.duration`.",
      },
      {
        library: "`fetch` (undici), `http.request`",
        covers:
          "A client span for each call a handler makes, including those of `@hapi/wreck`, which uses `http.request`.",
      },
      {
        library: "`pg`, `mysql2`, `mongodb`, `ioredis`",
        covers: "Query and command spans under the route that ran them.",
      },
      {
        library: "`pino`",
        covers:
          "Trace and span IDs on hapi-pino's lines and yours, and the lines sent to OneUptime.",
      },
    ],
    snippets: [],
    notes: [
      "hapi is patched as it loads, which is why the server starts with `--import`: a server created before the instrumentation loaded has no route spans.",
      "The instrumentation covers `@hapi/hapi` 17 to 21; this guide was checked with 21.4.",
    ],
  },

  manualSpans: {
    intro:
      "For work inside a handler, start a span of your own. It nests under the route's span:",
    snippets: [manualSpan],
    notes: [
      "Return the span's promise from the handler, as above: hapi waits for it, and the span ends when the work does.",
      "An error you rethrow becomes hapi's 500 answer, `An internal server error occurred`, and is logged by hapi-pino with its stack trace.",
    ],
  },

  logs: {
    intro:
      "Log through `request.logger`, hapi-pino's logger bound to the request: each line carries the request's trace ID, and its fields become attributes.",
    snippets: [roomRoute],
    notes: [
      "hapi-pino writes `[response] get /rooms/42 200 (2ms)` for every request it does not ignore, with the status code and response time as attributes.",
      "`server.logger` is the same logger outside a request, for startup and background work: its lines carry no trace.",
      "A failed request's line carries the error, which OneUptime groups with the route span's exception as one issue.",
    ],
  },

  metrics: {
    intro:
      "Request and runtime metrics leave every 60 seconds with no code. Count what matters to you beside them:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "The duration of every request, by `http.route`, method and status code.",
      },
      {
        name: "http.client.request.duration",
        description: "The calls your handlers make, by host and status code.",
      },
      {
        name: "v8js.memory.heap.used",
        description:
          "The heap in use, by space: a server that only grows has a leak to find.",
      },
    ],
    snippets: [customMetric],
    notes: [
      "Create instruments once, when the module loads, and add to them in handlers.",
    ],
  },

  sampling: {
    intro:
      "Each request is traced until you set a sampler. To keep a fifth of new traces, and every trace a caller already kept:",
    snippets: [sampling],
    notes: [
      "Requests that arrive with a sampled `traceparent` keep their caller's decision, so traces across services stay whole.",
      "hapi-pino still logs every request, and metrics still count each one.",
    ],
  },

  deploy: {
    intro:
      "The container starts Node.js with the same `--import` flag, and gets the variables from its environment:",
    snippets: [
      nodeDockerfileSnippet({
        command: ["node", "--import", "./instrumentation.mjs", "server.js"],
        port: 3000,
      }),
      kubernetesManifestSnippet({
        name: "bookings-api",
        image: "registry.example.com/bookings-api:2.7.0",
        containerPort: 3000,
      }),
    ],
    notes: [
      "On SIGTERM, the instrumentation file sends what is buffered, then ends the process.",
      "To see the pods and nodes the server runs on beside it, install the [Kubernetes agent](/docs/telemetry/kubernetes-agent).",
    ],
  },

  verify: {
    intro: "Each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Start the server, request \`/rooms/42\`, and open ${SCREENS.services}: \`bookings-api\` shows within a minute.`,
      },
      {
        title: "Open a trace",
        body: `In ${SCREENS.traces}, search \`@http.route:/rooms/{id}\`: the request holds the route's span and hapi-pino's extension.`,
      },
      {
        title: "Read the request's log lines",
        body: `In ${SCREENS.logs}, search \`[response]\`: each line opens the trace of the request it describes.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Requests are traced, but no route spans",
      answer:
        "The routes were added before the instrumentation loaded. Start the server with `node --import ./instrumentation.mjs server.js`, not by importing the file from `server.js`.",
    },
    {
      question: "A Boom 404 is listed under Exceptions",
      answer:
        'The route\'s span records every error its handler throws, `Boom.notFound()` included. Return the response instead, `h.response({ error: "Not found" }).code(404)`, or archive the issue: an archived issue stops notifying.',
    },
    {
      question: "Health checks still fill the logs",
      answer:
        "hapi-pino logs every response unless told otherwise: add the path to its `ignorePaths`, as in step 3.",
    },
    {
      question: "Logs arrive without trace IDs",
      answer:
        "They were written with `server.logger` outside a request, or before the instrumentation loaded. Log with `request.logger` in handlers and extensions.",
    },
    {
      question: "The server stops slowly in Kubernetes",
      answer:
        "Something handles SIGTERM without exiting, such as `@opentelemetry/auto-instrumentations-node/register`, which flushes but leaves the server running. Load the instrumentation file above instead: it exits once the data is sent.",
    },
  ],

  faq: [
    {
      question: "Which versions of hapi are supported?",
      answer:
        "The hapi instrumentation covers `@hapi/hapi` 17 to 21. This guide was checked end to end with hapi 21.4 and hapi-pino 13.",
    },
    {
      question: "Do my plugins need changes?",
      answer:
        "No. Routes and extensions a plugin adds are traced and named after the plugin, so a slow plugin is easy to tell apart.",
    },
    {
      question: "Can I keep my own logging plugin?",
      answer:
        "If it logs through pino, yes. The SDK sends the lines of the loggers it instruments, such as pino and winston, not what is written to the console.",
    },
    {
      question: "Can the server be written in TypeScript?",
      answer:
        "Yes. Compile it, keep `instrumentation.mjs` as JavaScript, and start the compiled file: `node --import ./instrumentation.mjs dist/server.js`.",
    },
  ],

  related: ["express", "fastify", "koa", "nodejs"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.exceptions],

  verification: {
    runtime: "node",
    framework: { name: "hapi", package: "@hapi/hapi" },
    files: [
      {
        path: "package.json",
        content:
          '{ "name": "bookings-api", "private": true, "type": "module" }',
      },
      { path: "instrumentation.mjs", snippet: "instrumentation" },
      { path: "server.js", content: serverFile },
    ],
    commands: [
      { snippet: "install" },
      { command: "npm install @hapi/hapi@21.4.11" },
      { snippet: "run", isServer: true },
    ],
    port: 3000,
    requests: [
      { method: "GET", path: "/healthz" },
      { method: "GET", path: "/rooms/42" },
      { method: "POST", path: "/bookings", body: { nights: 3 } },
      { method: "POST", path: "/bookings", body: { nights: 45 } },
    ],
    expect: {
      spans: [
        {
          name: "GET /rooms/{id}",
          attributes: { "http.route": "/rooms/{id}" },
        },
        {
          name: "route - /rooms/{id}",
          attributes: { "hapi.type": "router" },
        },
        { name: "hapi-pino: ext - onRequest" },
        {
          name: "bookings.reserve",
          attributes: { "booking.nights": "3" },
        },
        { name: "bookings.reserve", hasException: true },
        { name: "route - /bookings", hasException: true },
      ],
      metrics: ["http.server.request.duration", "bookings.created"],
      logs: [
        { body: "loading room", hasTraceContext: true },
        { body: "[response] get /rooms/42 200", hasTraceContext: true },
        {
          body: "Room inventory unavailable",
          hasTraceContext: true,
          hasException: true,
        },
      ],
      resource: { "service.name": "bookings-api" },
      untracedPaths: ["/healthz"],
      absentLogs: ["/healthz"],
    },
  },
};
