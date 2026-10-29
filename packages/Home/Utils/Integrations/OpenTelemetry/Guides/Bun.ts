import { GuideSnippet, OpenTelemetryGuide } from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";
import { bunAddSnippet, pinned } from "../JavaScriptShared";

/*
 * Bun 1.4 runs the OpenTelemetry Node.js SDK, preloaded, and sends over
 * OTLP from the environment as on Node.js. What it does not do is
 * instrument: Bun.serve and Bun's fetch have no instrumentation, and the
 * bundle's instrumentations only patch packages loaded with require(),
 * which an app written with import never does. So the guide gives two small
 * helpers, a server span per route (with the request duration metric) and a
 * fetch that passes the trace on, and logs through the Logs API.
 *
 * The end-to-end check runs the page's files with Bun and type-checks them
 * with TypeScript and @types/bun (scaffolding commands the page does not
 * show).
 */

const BUN_VERSION: string = "1.4";

const install: GuideSnippet = bunAddSnippet("install", [
  "@opentelemetry/api",
  "@opentelemetry/sdk-node",
]);

const instrumentation: GuideSnippet = {
  id: "instrumentation",
  language: "typescript",
  title: "instrumentation.ts",
  code: [
    'import { NodeSDK } from "@opentelemetry/sdk-node";',
    "",
    "// Reads OTEL_SERVICE_NAME and the OTEL_EXPORTER_OTLP_* variables, and sends",
    "// traces, metrics and logs to OneUptime over OTLP/HTTP.",
    "const sdk = new NodeSDK();",
    "",
    "sdk.start();",
    "",
    "// On SIGTERM or Ctrl+C, send what is still buffered, then exit.",
    "let flushing: Promise<void> | undefined;",
    'for (const signal of ["SIGTERM", "SIGINT"]) {',
    "  process.on(signal, async () => {",
    "    await (flushing ??= sdk.shutdown());",
    "    process.exit(0);",
    "  });",
    "}",
  ].join("\n"),
  check: "run",
};

const tracing: GuideSnippet = {
  id: "tracing",
  language: "typescript",
  title: "tracing.ts",
  code: [
    "import {",
    "  context,",
    "  metrics,",
    "  propagation,",
    "  SpanKind,",
    "  SpanStatusCode,",
    "  trace,",
    '} from "@opentelemetry/api";',
    'import { log } from "./log";',
    "",
    'const tracer = trace.getTracer("http");',
    "const requestDuration = metrics",
    '  .getMeter("http")',
    '  .createHistogram("http.server.request.duration", {',
    '    description: "Duration of HTTP server requests",',
    '    unit: "s",',
    "  });",
    "",
    "// A server span per request, named after its route, and the request duration",
    "// metric: what the http instrumentation records on Node.js, for Bun.serve.",
    "export function traced<R extends Request>(",
    "  route: string,",
    "  handler: (request: R) => Response | Promise<Response>,",
    "): (request: R) => Promise<Response> {",
    "  return (request) => {",
    "    const startedAt = performance.now();",
    '    const attributes = { "http.request.method": request.method, "http.route": route };',
    "    // Continues the caller's trace when the request has a traceparent header.",
    "    const parent = propagation.extract(",
    "      context.active(),",
    "      Object.fromEntries(request.headers),",
    "    );",
    "",
    "    return tracer.startActiveSpan(",
    "      `${request.method} ${route}`,",
    "      {",
    "        kind: SpanKind.SERVER,",
    '        attributes: { ...attributes, "url.path": new URL(request.url).pathname },',
    "      },",
    "      parent,",
    "      async (span) => {",
    "        let status = 500;",
    "        try {",
    "          const response = await handler(request);",
    "          status = response.status;",
    "          return response;",
    "        } catch (error) {",
    "          // On the span, the error is listed under Exceptions; the client gets a 500.",
    "          span.recordException(error as Error);",
    '          log.error("request failed", { "error.message": (error as Error).message });',
    '          return Response.json({ error: "Something went wrong" }, { status: 500 });',
    "        } finally {",
    '          span.setAttribute("http.response.status_code", status);',
    "          if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });",
    "          span.end();",
    "          requestDuration.record((performance.now() - startedAt) / 1000, {",
    "            ...attributes,",
    '            "http.response.status_code": status,',
    "          });",
    "        }",
    "      },",
    "    );",
    "  };",
    "}",
    "",
    "// fetch with a client span, passing the trace on in a traceparent header.",
    "export function tracedFetch(url: string, init: RequestInit = {}): Promise<Response> {",
    "  const target = new URL(url);",
    '  const method = init.method ?? "GET";',
    "",
    "  return tracer.startActiveSpan(",
    "    method,",
    "    {",
    "      kind: SpanKind.CLIENT,",
    "      attributes: {",
    '        "http.request.method": method,',
    '        "server.address": target.hostname,',
    '        "url.full": target.href,',
    "      },",
    "    },",
    "    async (span) => {",
    "      const headers = new Headers(init.headers);",
    "      propagation.inject(context.active(), headers, {",
    "        set: (carrier, key, value) => carrier.set(key, value),",
    "      });",
    "      try {",
    "        const response = await fetch(target, { ...init, headers });",
    '        span.setAttribute("http.response.status_code", response.status);',
    "        if (response.status >= 400) span.setStatus({ code: SpanStatusCode.ERROR });",
    "        return response;",
    "      } catch (error) {",
    "        span.recordException(error as Error);",
    "        span.setStatus({ code: SpanStatusCode.ERROR });",
    "        throw error;",
    "      } finally {",
    "        span.end();",
    "      }",
    "    },",
    "  );",
    "}",
  ].join("\n"),
  check: "run",
};

const logHelper: GuideSnippet = {
  id: "log",
  language: "typescript",
  title: "log.ts",
  code: [
    'import { logs, SeverityNumber } from "@opentelemetry/api";',
    "",
    'const logger = logs.getLogger("orders-api");',
    "",
    "type Fields = Record<string, string | number | boolean>;",
    "",
    "// Prints each line and sends it to OneUptime with the trace of the request",
    "// it is written in.",
    "export const log = {",
    "  info(message: string, fields: Fields = {}): void {",
    "    console.log(message, fields);",
    "    logger.emit({",
    "      severityNumber: SeverityNumber.INFO,",
    '      severityText: "INFO",',
    "      body: message,",
    "      attributes: fields,",
    "    });",
    "  },",
    "  error(message: string, fields: Fields = {}): void {",
    "    console.error(message, fields);",
    "    logger.emit({",
    "      severityNumber: SeverityNumber.ERROR,",
    '      severityText: "ERROR",',
    "      body: message,",
    "      attributes: fields,",
    "    });",
    "  },",
    "};",
  ].join("\n"),
  check: "run",
};

const server: GuideSnippet = {
  id: "server",
  language: "typescript",
  title: "server.ts",
  code: [
    'import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";',
    'import { log } from "./log";',
    'import { traced, tracedFetch } from "./tracing";',
    "",
    "// The catalog service the orders route asks about each product.",
    'const catalogUrl = Bun.env.CATALOG_URL ?? "http://localhost:3000";',
    "",
    "Bun.serve({",
    "  port: 3000,",
    "  routes: {",
    "    // A static response: Bun answers it without running code, so it is not traced.",
    '    "/healthz": new Response("ok"),',
    '    "/products/:id": {',
    '      GET: traced("/products/:id", (request) => {',
    '        log.info("loading product", { "product.id": request.params.id });',
    '        return Response.json({ id: request.params.id, name: "Kettle" });',
    "      }),",
    "    },",
    '    "/orders": {',
    '      POST: traced("/orders", placeOrder),',
    "    },",
    "  },",
    "});",
  ].join("\n"),
  check: "contained",
};

const manualSpan: GuideSnippet = {
  id: "manual-span",
  language: "typescript",
  title: "server.ts",
  code: [
    'const tracer = trace.getTracer("orders");',
    "",
    "interface Order {",
    "  productId: string;",
    "  quantity: number;",
    "  paymentMethod: string;",
    "}",
    "",
    "async function placeOrder(request: Request): Promise<Response> {",
    "  const order = (await request.json()) as Order;",
    "",
    '  return tracer.startActiveSpan("orders.place", async (span) => {',
    "    try {",
    '      span.setAttribute("order.product_id", order.productId);',
    "      const product = await tracedFetch(`${catalogUrl}/products/${order.productId}`);",
    "      await chargeCard(order);",
    "      countOrder(order.paymentMethod);",
    "      return Response.json(",
    '        { id: "ord_1001", product: await product.json() },',
    "        { status: 201 },",
    "      );",
    "    } catch (error) {",
    "      span.recordException(error as Error);",
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

const customMetric: GuideSnippet = {
  id: "custom-metric",
  language: "typescript",
  title: "server.ts",
  code: [
    'const ordersPlaced = metrics.getMeter("orders").createCounter("orders.placed", {',
    '  description: "Orders placed, by payment method",',
    "});",
    "",
    "function countOrder(paymentMethod: string): void {",
    '  ordersPlaced.add(1, { "payment.method": paymentMethod });',
    "}",
  ].join("\n"),
  check: "contained",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "bun --preload ./instrumentation.ts server.ts",
  check: "run",
};

const bunfig: GuideSnippet = {
  id: "bunfig",
  language: "text",
  title: "bunfig.toml",
  code: 'preload = ["./instrumentation.ts"]',
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

const dockerfile: GuideSnippet = {
  id: "dockerfile",
  language: "dockerfile",
  title: "Dockerfile",
  code: [
    "FROM oven/bun:1.4",
    "WORKDIR /app",
    "COPY package.json bun.lock ./",
    "RUN bun install --production --frozen-lockfile",
    "COPY . .",
    "EXPOSE 3000",
    'CMD ["bun", "--preload", "./instrumentation.ts", "server.ts"]',
  ].join("\n"),
  check: "parse",
};

// server.ts as the end-to-end check runs it: the page's fragments, word for word.
const serverFile: string = [
  server.code,
  "",
  customMetric.code,
  "",
  manualSpan.code,
  "",
  "// A stand-in for the payment provider.",
  "async function chargeCard(order: Order): Promise<void> {",
  "  if (order.quantity > 10) {",
  '    throw new Error("Payment provider timed out");',
  "  }",
  "}",
].join("\n");

// What `bun init` writes, for the type check the end-to-end check runs.
const tsconfig: string = JSON.stringify(
  {
    compilerOptions: {
      lib: ["ESNext"],
      target: "ESNext",
      module: "Preserve",
      moduleDetection: "force",
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      verbatimModuleSyntax: true,
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      types: ["bun"],
    },
  },
  null,
  2,
);

export const BunGuide: OpenTelemetryGuide = {
  slug: "bun",
  seo: {
    title: "Bun OpenTelemetry: Tracing Bun.serve Apps | OneUptime",
    description:
      "Send traces, metrics and logs from Bun to OneUptime with OpenTelemetry: the SDK preloaded, a server span per Bun.serve route, traced fetch and logs.",
  },
  h1: "OpenTelemetry for Bun",
  lead: "Bun runs the OpenTelemetry Node.js SDK, but nothing in a Bun app is instrumented for you: `Bun.serve` and Bun's `fetch` have no instrumentation. This guide preloads the SDK and adds two small files, one that traces each route and one that logs, so OneUptime gets the same requests, errors, metrics and logs as from a Node.js service.",
  cardDescription:
    "The SDK preloaded, a span and a duration metric per Bun.serve route, traced fetch, and logs with trace IDs.",
  searchTerms: ["bun", "bun.sh", "bun.serve", "typescript", "runtime"],
  highlights: [`Bun ${BUN_VERSION}`, "Bun.serve routes", "TypeScript"],

  whatYouGet: {
    intro: `Each request to a traced route becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, listed under ${SCREENS.services}.`,
    traces:
      "A server span per request, named after its route, such as `GET /products/:id`, which continues the caller's trace. Calls made with `tracedFetch` are client spans beneath it, and pass the trace on to the service they call.",
    metrics:
      "`http.server.request.duration` by `http.route` and status code, recorded by the route wrapper, and the counters and histograms you add.",
    logs: "Every line written with the `log` helper, with the trace ID of the request it was written in.",
    exceptions: `An error a route throws is recorded on its server span and answered with a 500. ${SCREENS.exceptions} lists it with its stack trace.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "traced",
      },
      {
        name: "orders.place",
        depth: 1,
        start: 3,
        duration: 94,
        source: "your code",
      },
      { name: "GET", depth: 2, start: 6, duration: 40, source: "tracedFetch" },
      {
        name: "GET /products/:id",
        depth: 3,
        start: 10,
        duration: 32,
        source: "catalog",
      },
    ],
  },

  prerequisites: [
    `Bun ${BUN_VERSION} or later. Check with \`bun --version\`.`,
    "An app that serves with `Bun.serve` and its `routes`.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro: "Install the API and the Node.js SDK, which Bun runs as it is:",
    snippets: [install],
    notes: [
      `The bundle of instrumentations, \`${pinned("@opentelemetry/auto-instrumentations-node")}\`, is left out: under Bun it only patches packages loaded with \`require()\`, which an app written with \`import\` never does.`,
    ],
  },

  configure: {
    intro:
      "The SDK reads where to send, the key and the service name from the environment, under Bun as under Node.js:",
    tabs: otlpEnvironmentTabs({
      serviceName: "orders-api",
      cloudNote:
        "Bun loads `.env` before it runs any code, the preloaded file included, so the three variables can live there.",
    }),
    notes: [
      "The SDK sends OTLP over HTTP as protobuf, the default and what OneUptime's `/otlp` endpoint reads.",
    ],
  },

  setup: {
    intro:
      "Four files: one starts the SDK before your code, one traces routes and outgoing calls, one logs, and your server uses them.",
    steps: [
      {
        title: "Start the SDK in a preloaded file",
        body: "It starts the SDK, which sends traces, metrics and logs, and sends what is buffered when the process stops:",
        snippets: [instrumentation],
      },
      {
        title: "Add the tracing helpers",
        body: "`traced` gives each route a server span and records its duration; `tracedFetch` makes a client span for a call and passes the trace on:",
        snippets: [tracing],
        notes: [
          "`traced` names the span after the route pattern, not the URL, so `/products/42` and `/products/43` are one route under Traces and in the duration metric.",
        ],
      },
      {
        title: "Add the logger",
        body: "It writes each line to the console as before, and sends it through the OpenTelemetry Logs API:",
        snippets: [logHelper],
      },
      {
        title: "Wrap your routes",
        body: "Pass each route's handler to `traced` with its pattern. TypeScript still knows each route's `request.params`:",
        snippets: [server],
      },
      {
        title: "Start the server with the SDK preloaded",
        body: "`--preload` runs the file before your server. To have Bun preload it whenever it runs a file in the folder, so `bun server.ts` is enough, add it to `bunfig.toml` instead:",
        snippets: [run, bunfig],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "What is traced for you under Bun, and what the helpers above stand in for:",
    rows: [
      {
        library: "`Bun.serve`",
        covers:
          "Not instrumented: `traced` makes the server span and records `http.server.request.duration`.",
      },
      {
        library: "`fetch`",
        covers:
          "Not instrumented: `tracedFetch` makes the client span and sends the `traceparent` header.",
      },
      {
        library: "Packages loaded with `require()`",
        covers:
          "Instrumented if you add the bundle to the SDK, as on Node.js. Packages loaded with `import` are not.",
      },
      {
        library: "`@opentelemetry/api`",
        covers:
          "Spans, metrics and logs you create yourself are sent, with the right parent and trace.",
      },
    ],
    snippets: [],
    notes: [
      "Static responses in `routes`, such as `/healthz` above, are answered by Bun without running code: they are never traced, which keeps health checks out of Traces.",
    ],
  },

  manualSpans: {
    intro:
      "Inside a traced route, start spans of your own as on Node.js. They nest under the route's span:",
    snippets: [manualSpan],
    notes: [
      "The span is current inside the callback, so `tracedFetch` makes its client span beneath it.",
      "The error you rethrow reaches `traced`, which records it on the route's span too and answers 500: Exceptions groups the two as one issue.",
    ],
  },

  logs: {
    intro:
      "Log with the helper from step 3. Each line carries the trace and span of the request it was written in, and its fields become attributes:",
    snippets: [],
    notes: [
      '`log.info("loading product", { "product.id": id })` arrives as a record with the body `loading product` and the attribute `product.id`.',
      "Lines written outside a request, at startup or in a timer, carry no trace.",
      "`console.log` alone sends nothing: under Bun, no logger is instrumented for you.",
    ],
  },

  metrics: {
    intro:
      "The route wrapper records the request duration. Count what matters to you beside it:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Each request's duration, by `http.route`, method and status code, recorded by `traced`.",
      },
    ],
    snippets: [customMetric],
    notes: [
      "The SDK sends metrics every 60 seconds. Bun's own runtime metrics, such as the event loop's, are not sent.",
    ],
  },

  sampling: {
    intro:
      "Each request is traced until you set a sampler. To keep a quarter of new traces, and every trace a caller kept:",
    snippets: [sampling],
    notes: [
      "`traced` continues a caller's trace from its `traceparent` header, so a sampled trace stays whole across services.",
      "The duration metric and the logs are recorded for every request, sampled or not.",
    ],
  },

  deploy: {
    intro:
      "The official image runs the same command; the container gets the variables from its environment:",
    snippets: [
      dockerfile,
      kubernetesManifestSnippet({
        name: "orders-api",
        image: "registry.example.com/orders-api:1.2.0",
        containerPort: 3000,
      }),
    ],
    notes: [
      "`Bun.serve` listens on every interface by default, so the container's port is reachable as it is.",
      "When the container is stopped, `instrumentation.ts` sends what the SDK still holds before Bun exits.",
    ],
  },

  verify: {
    intro: "Each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Start the server, open \`/products/42\`, and look in ${SCREENS.services}: \`orders-api\` is there within a minute.`,
      },
      {
        title: "Open a trace",
        body: `In ${SCREENS.traces}, search \`@http.route:/orders\`: an order's trace holds \`orders.place\`, the call to the catalog and the catalog's own span.`,
      },
      {
        title: "Find a log line",
        body: `In ${SCREENS.logs}, search \`loading product\`: each line links to its request's trace.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Nothing arrives at all",
      answer:
        "The SDK did not start: start with `bun --preload ./instrumentation.ts server.ts`, or add the file to `bunfig.toml`. Set `OTEL_LOG_LEVEL=debug` to see each export's result.",
    },
    {
      question: "Logs and spans arrive, but no request spans",
      answer:
        'The route\'s handler is not wrapped in `traced`. Every route that runs code needs it, `traced("/orders", placeOrder)`.',
    },
    {
      question:
        "Outgoing calls have no spans, and the next service starts a new trace",
      answer:
        "They were made with `fetch`, which Bun does not instrument. Call `tracedFetch` instead: it makes the client span and sends the `traceparent` header.",
    },
    {
      question: "I added the bundle, and pino or pg are still not traced",
      answer:
        "Under Bun, the bundle only patches packages loaded with `require()`. Imported with `import`, they are not instrumented: wrap their calls in spans of your own.",
    },
    {
      question: "Logs written in the error handler have no trace",
      answer:
        "`Bun.serve`'s `error` handler runs after the request's span has ended. `traced` catches a route's errors itself, inside the span, so its log line keeps the trace.",
    },
  ],

  faq: [
    {
      question: "Does the OpenTelemetry SDK work on Bun?",
      answer: `Yes. Bun runs \`${pinned("@opentelemetry/sdk-node")}\`, which exports traces, metrics and logs over OTLP. This guide was checked end to end with Bun ${BUN_VERSION}.4.`,
    },
    {
      question: "Why are the helpers needed?",
      answer:
        "OpenTelemetry's JavaScript instrumentations patch Node.js modules as they load. `Bun.serve` and Bun's `fetch` are Bun's own, so there is nothing to patch: the helpers record what an instrumentation would.",
    },
    {
      question: "Can I use Node.js's http module under Bun?",
      answer:
        "Yes, and loaded with `require()` it is instrumented once the bundle is added to the SDK. An app written with `import` gets no spans from it: wrap its handlers as `traced` does.",
    },
  ],

  related: ["nodejs", "deno", "express", "browser"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.metrics],

  verification: {
    runtime: "bun",
    framework: { name: "Bun" },
    files: [
      {
        path: "package.json",
        content: '{ "name": "orders-api", "private": true, "type": "module" }',
      },
      { path: "tsconfig.json", content: tsconfig },
      { path: "instrumentation.ts", snippet: "instrumentation" },
      { path: "tracing.ts", snippet: "tracing" },
      { path: "log.ts", snippet: "log" },
      { path: "server.ts", content: serverFile },
    ],
    commands: [
      { snippet: "install" },
      { command: "bun add -d typescript@7.0.2 @types/bun@1.4.4" },
      { command: "bun x tsc --noEmit -p ." },
      { snippet: "run", isServer: true },
    ],
    port: 3000,
    requests: [
      { method: "GET", path: "/healthz" },
      { method: "GET", path: "/products/42" },
      {
        method: "POST",
        path: "/orders",
        body: { productId: "42", quantity: 1, paymentMethod: "card" },
      },
      {
        method: "POST",
        path: "/orders",
        body: { productId: "42", quantity: 50, paymentMethod: "card" },
      },
    ],
    expect: {
      spans: [
        {
          name: "GET /products/:id",
          attributes: { "http.route": "/products/:id" },
        },
        { name: "POST /orders", attributes: { "http.route": "/orders" } },
        { name: "GET", attributes: { "server.address": "localhost" } },
        { name: "orders.place", attributes: { "order.product_id": "42" } },
        { name: "orders.place", hasException: true },
        { name: "POST /orders", hasException: true },
      ],
      metrics: ["http.server.request.duration", "orders.placed"],
      logs: [
        { body: "loading product", hasTraceContext: true },
        { body: "request failed", hasTraceContext: true },
      ],
      resource: { "service.name": "orders-api" },
      untracedPaths: ["/healthz"],
    },
  },
};
