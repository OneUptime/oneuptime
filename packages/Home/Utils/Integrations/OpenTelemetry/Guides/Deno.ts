import { GuideSnippet, OpenTelemetryGuide } from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";
import { pinned } from "../JavaScriptShared";

/*
 * Deno 2 has OpenTelemetry built in: with OTEL_DENO=true it traces
 * Deno.serve and fetch, sends console output as logs and records HTTP and
 * V8 metrics, all over OTLP from the standard variables. What it leaves to
 * you: naming a request's span after its route, and recording a route's
 * error on it (an uncaught error marks the span failed, with no exception
 * event, and its log line has no trace). A small route helper does both.
 *
 * Checked end to end with Deno 2.9: SIGTERM flushes what is buffered, the
 * sampler variables apply, and the route set on the span reaches
 * http.server.request.duration.
 */

const DENO_VERSION: string = "2.9";

const install: GuideSnippet = {
  id: "install",
  language: "bash",
  code: `deno add npm:${pinned("@opentelemetry/api")}`,
  check: "run",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "deno run --allow-net server.ts",
  check: "run",
};

const routes: GuideSnippet = {
  id: "routes",
  language: "typescript",
  title: "routes.ts",
  code: [
    'import { SpanStatusCode, trace } from "@opentelemetry/api";',
    "",
    "type Params = Record<string, string | undefined>;",
    "type Handler = (request: Request, params: Params) => Response | Promise<Response>;",
    "",
    "// A route for Deno.serve. It names Deno's span for the request after the",
    "// route, and records a route's error on it before answering 500.",
    "export function route(method: string, pathname: string, handler: Handler) {",
    "  const pattern = new URLPattern({ pathname });",
    "",
    "  return async (request: Request): Promise<Response | undefined> => {",
    "    const match = request.method === method ? pattern.exec(request.url) : null;",
    "    if (!match) return undefined;",
    "",
    "    const span = trace.getActiveSpan();",
    "    span?.updateName(`${method} ${pathname}`);",
    '    span?.setAttribute("http.route", pathname);',
    "",
    "    try {",
    "      return await handler(request, match.pathname.groups);",
    "    } catch (error) {",
    "      span?.recordException(error as Error);",
    "      span?.setStatus({ code: SpanStatusCode.ERROR });",
    '      console.error("request failed:", (error as Error).message);',
    '      return Response.json({ error: "Something went wrong" }, { status: 500 });',
    "    }",
    "  };",
    "}",
  ].join("\n"),
  check: "run",
};

const server: GuideSnippet = {
  id: "server",
  language: "typescript",
  title: "server.ts",
  code: [
    'import { metrics, SpanStatusCode, trace } from "@opentelemetry/api";',
    'import { route } from "./routes.ts";',
    "",
    "// The catalog service the orders route asks about each product.",
    'const CATALOG_URL = "http://localhost:3000";',
    "",
    "const routes = [",
    '  route("GET", "/products/:id", (_request, params) => {',
    '    console.log("loading product", params.id);',
    '    return Response.json({ id: params.id, name: "Kettle" });',
    "  }),",
    '  route("POST", "/orders", placeOrder),',
    "];",
    "",
    "Deno.serve({ port: 3000 }, async (request) => {",
    "  for (const handle of routes) {",
    "    const response = await handle(request);",
    "    if (response) return response;",
    "  }",
    '  return new Response("Not found", { status: 404 });',
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
    '  return await tracer.startActiveSpan("orders.place", async (span) => {',
    "    try {",
    '      span.setAttribute("order.product_id", order.productId);',
    "      const product = await fetch(`${CATALOG_URL}/products/${order.productId}`);",
    "      await chargeCard(order);",
    "      countOrder(order.paymentMethod);",
    '      return Response.json({ id: "ord_1001", product: await product.json() }, { status: 201 });',
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
    "FROM denoland/deno:2.9.8",
    "WORKDIR /app",
    "COPY . .",
    "RUN deno cache server.ts",
    "ENV OTEL_DENO=true",
    "EXPOSE 3000",
    'CMD ["deno", "run", "--allow-net", "server.ts"]',
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

export const DenoGuide: OpenTelemetryGuide = {
  slug: "deno",
  seo: {
    title: "Deno OpenTelemetry: Built-in Tracing and Logs | OneUptime",
    description:
      "Turn on Deno 2's built-in OpenTelemetry and send Deno.serve traces, fetch spans, console logs and metrics to OneUptime, with spans named per route.",
  },
  h1: "OpenTelemetry for Deno",
  lead: "Deno 2 has OpenTelemetry built in. One environment variable turns it on: Deno then traces `Deno.serve` and `fetch`, sends `console` output as logs, and records HTTP and V8 metrics. This guide points it at OneUptime and adds a small route helper, so each request's span carries its route and its errors.",
  cardDescription:
    "Deno's built-in OpenTelemetry: Deno.serve and fetch spans, console logs and metrics, with spans named per route.",
  searchTerms: ["deno", "deno.serve", "deno deploy", "typescript", "runtime"],
  highlights: [`Deno ${DENO_VERSION}`, "Built-in OpenTelemetry", "No SDK to install"],

  whatYouGet: {
    intro: `Every request \`Deno.serve\` answers becomes a trace, under the service whose name \`OTEL_SERVICE_NAME\` gives, in ${SCREENS.services}.`,
    traces:
      "A server span per request, which the route helper names after its route, such as `GET /products/:id`. Each `fetch` is a client span beneath it, and passes the trace on to the service it calls.",
    metrics:
      "`http.server.request.duration`, with the route the helper sets, `http.server.active_requests` and the request and response body sizes, beside V8's heap and garbage collection metrics.",
    logs: "Everything written with `console.log` or `console.error`, at the info or error level, with the trace ID of the request it was written in.",
    exceptions: `An error a route throws is recorded on its request's span by the helper, and answered with a 500. ${SCREENS.exceptions} lists it with its stack trace.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      { name: "POST /orders", depth: 0, start: 0, duration: 100, source: "deno" },
      {
        name: "orders.place",
        depth: 1,
        start: 4,
        duration: 92,
        source: "your code",
      },
      { name: "GET", depth: 2, start: 8, duration: 40, source: "fetch" },
      {
        name: "GET /products/:id",
        depth: 3,
        start: 12,
        duration: 32,
        source: "catalog",
      },
    ],
  },

  prerequisites: [
    `Deno ${DENO_VERSION} or later. Check with \`deno --version\`.`,
    "A server built on `Deno.serve`.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "There is no SDK to install: it is part of Deno. Add the OpenTelemetry API, which your code uses for its own spans and metrics:",
    snippets: [install],
    notes: [
      "`deno add` writes the import to `deno.json`, so the code imports `@opentelemetry/api` by name, at that version.",
    ],
  },

  configure: {
    intro:
      "`OTEL_DENO=true` turns the built-in OpenTelemetry on; the standard variables say where to send it:",
    tabs: otlpEnvironmentTabs({
      serviceName: "orders-api",
      extraLines: ['export OTEL_DENO="true"'],
      cloudNote:
        "Deno reads them itself as it starts, before your code runs.",
    }),
    notes: [
      "Deno sends OTLP over HTTP as protobuf, which OneUptime's `/otlp` endpoint reads.",
    ],
  },

  setup: {
    intro:
      "Deno traces every request already. Two files make the traces useful: a route helper, and your server using it.",
    steps: [
      {
        title: "Add the route helper",
        body: "Deno names a request's span after its method alone, such as `GET`. The helper renames it after the route, sets `http.route`, and records an error the route throws:",
        snippets: [routes],
        notes: [
          "An error that escapes `Deno.serve`'s handler marks the span as failed, but Deno logs it without a trace and records no exception event on the span: the helper catches it first.",
        ],
      },
      {
        title: "Route your requests through it",
        body: "Each route is a method, a `URLPattern` path and a handler:",
        snippets: [server],
      },
      {
        title: "Run with OpenTelemetry on",
        body: "With the variables from the previous step set, run the server as usual:",
        snippets: [run],
        notes: [
          "`--allow-net` is for the server and its `fetch` calls. The `OTEL_*` variables need no `--allow-env`: Deno reads them before your code runs.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro: "With `OTEL_DENO=true`, Deno records these with no code:",
    rows: [
      {
        library: "`Deno.serve`",
        covers:
          "A server span per request, which continues the caller's trace, and `http.server.request.duration`, `http.server.active_requests` and the body size histograms.",
      },
      {
        library: "`fetch`",
        covers:
          "A client span per call, which sends the `traceparent` header on, so the next service continues the trace.",
      },
      {
        library: "`console`",
        covers:
          "Each line written with `console` as a log record with its trace: `console.log` at the info level, `console.error` at the error level.",
      },
      {
        library: "V8",
        covers: "Heap, heap space and garbage collection metrics.",
      },
      {
        library: "`@opentelemetry/api`",
        covers:
          "The spans and metrics your code creates, in the same traces as Deno's.",
      },
    ],
    snippets: [],
    notes: [
      "Health checks are traced like every other request. Drop them as they arrive with a [drop filter](/docs/telemetry/drop-filters-and-scrub-rules).",
    ],
  },

  manualSpans: {
    intro:
      "Start spans of your own with the API. Inside a route, they nest under the request's span, and Deno's `fetch` spans nest under them:",
    snippets: [manualSpan],
    notes: [
      "The error you rethrow reaches the route helper, which records it on the request's span as well and answers 500: Exceptions groups the two as one issue.",
    ],
  },

  logs: {
    intro:
      "Use `console` as you do already: each line is sent, with the trace and span of the request it was written in.",
    snippets: [],
    notes: [
      "The arguments are formatted into one line: `console.log(\"loading product\", id)` arrives as `loading product 42`.",
      "`console.error` lines arrive at the error level, and the `log.iostream` attribute says whether a line went to stdout or stderr.",
      "Lines written outside a request, such as Deno's `Listening on` line, carry no trace.",
    ],
  },

  metrics: {
    intro:
      "HTTP and V8 metrics are sent with no code. Count what matters to you beside them:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Each request's duration by method and status code, and by `http.route` once the helper has set it.",
      },
      {
        name: "http.server.active_requests",
        description: "Requests in progress: a server that falls behind shows it here first.",
      },
      {
        name: "v8js.memory.heap.size",
        description: "The heap, by space: a process that only grows has a leak.",
      },
    ],
    snippets: [customMetric],
    notes: [
      "Name metrics after what they count, with dots between levels, and keep their attributes to a few values each.",
    ],
  },

  sampling: {
    intro:
      "Deno applies the standard sampler variables. To keep a quarter of new traces, and every trace a caller kept:",
    snippets: [sampling],
    notes: [
      "A request that arrives with a sampled `traceparent` is always traced, so a trace across services stays whole.",
      "Logs and metrics are sent for every request, sampled or not.",
    ],
  },

  deploy: {
    intro:
      "The official image runs the same command; `OTEL_DENO` can live in the image, and the rest comes from the environment:",
    snippets: [
      dockerfile,
      kubernetesManifestSnippet({
        name: "orders-api",
        image: "registry.example.com/orders-api:1.2.0",
        containerPort: 3000,
      }),
    ],
    notes: [
      "`Deno.serve` listens on every interface by default, so the container's port is reachable as it is.",
      "When the container is stopped, Deno sends what is still buffered before it exits.",
    ],
  },

  verify: {
    intro: "Each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Start the server, open \`/products/42\`, and look in ${SCREENS.services}: \`orders-api\` appears within a minute.`,
      },
      {
        title: "Open a trace",
        body: `In ${SCREENS.traces}, search \`@http.route:/orders\`: an order's trace holds \`orders.place\`, its \`fetch\` and the catalog's own span.`,
      },
      {
        title: "Follow a log line",
        body: `In ${SCREENS.logs}, search \`loading product\`: each line opens the trace of its request.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Nothing arrives",
      answer:
        "`OTEL_DENO` is not `true` in the process's environment, so the built-in OpenTelemetry is off. Set it beside the other variables, in the same shell or container.",
    },
    {
      question: "Every span is named GET or POST",
      answer:
        "The request did not go through the route helper, which renames the span after the route. Route every handler through `route()`.",
    },
    {
      question: "An error is in the logs, but not under Exceptions",
      answer:
        "It escaped `Deno.serve`'s handler: Deno answers 500 and prints it, but records no exception on the span. Let the route helper catch it, or record it with `span.recordException`.",
    },
    {
      question: "Health checks fill the trace list",
      answer:
        "Deno traces every request it serves. Drop the health check's spans as they arrive with a [drop filter](/docs/telemetry/drop-filters-and-scrub-rules) on `url.path`.",
    },
  ],

  faq: [
    {
      question: "Do I need the OpenTelemetry SDK for Deno?",
      answer:
        "No. Deno 2 ships its own: `OTEL_DENO=true` turns it on. Install only `@opentelemetry/api`, for spans and metrics of your own. This guide was checked end to end with Deno 2.9.8.",
    },
    {
      question: "Can I use the Node.js SDK in Deno instead?",
      answer:
        "There is no need: Deno's built-in OpenTelemetry already exports traces, metrics and logs over OTLP, and traces `Deno.serve` and `fetch`, which the Node.js instrumentations do not know.",
    },
    {
      question: "Does it work with Hono?",
      answer:
        "Yes. Hono serves through `Deno.serve(app.fetch)`, so each request has its span and `fetch` is traced. Name the span after the route in a middleware, as the helper does with `trace.getActiveSpan()`.",
    },
  ],

  related: ["nodejs", "bun", "browser", "express"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.dropFilters],

  verification: {
    runtime: "deno",
    framework: { name: "Deno" },
    files: [
      { path: "routes.ts", snippet: "routes" },
      { path: "server.ts", content: serverFile },
    ],
    commands: [
      { snippet: "install" },
      { command: "deno check server.ts" },
      { snippet: "run", isServer: true },
    ],
    port: 3000,
    requests: [
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
        { name: "GET", attributes: { "url.path": "/products/42" } },
        { name: "orders.place", attributes: { "order.product_id": "42" } },
        { name: "orders.place", hasException: true },
        { name: "POST /orders", hasException: true },
      ],
      metrics: [
        "http.server.request.duration",
        "http.server.active_requests",
        "orders.placed",
      ],
      logs: [
        { body: "loading product 42", hasTraceContext: true },
        {
          body: "request failed: Payment provider timed out",
          hasTraceContext: true,
        },
      ],
      resource: { "service.name": "orders-api" },
    },
  },
};
