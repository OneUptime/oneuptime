import { GuideSnippet, OpenTelemetryGuide } from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";
import { NODE_PREREQUISITE, npmInstallSnippet } from "../JavaScriptShared";

/*
 * Next.js 16 with the App Router, on its own server (next start or the
 * standalone output). Next.js traces itself through the OpenTelemetry API;
 * the SDK registered in instrumentation.ts collects those spans and adds the
 * libraries' own.
 */

const install: GuideSnippet = npmInstallSnippet("install", [
  "@opentelemetry/api",
  "@opentelemetry/sdk-node",
  "@opentelemetry/auto-instrumentations-node",
]);

const instrumentationEntry: GuideSnippet = {
  id: "instrumentation",
  language: "typescript",
  title: "instrumentation.ts",
  code: [
    "export async function register() {",
    "  // The Node.js server only: the SDK does not run in the Edge runtime.",
    '  if (process.env.NEXT_RUNTIME === "nodejs") {',
    '    await import("./instrumentation.node");',
    "  }",
    "}",
  ].join("\n"),
  check: "run",
};

const instrumentationNode: GuideSnippet = {
  id: "instrumentation-node",
  language: "typescript",
  title: "instrumentation.node.ts",
  code: [
    'import { NodeSDK } from "@opentelemetry/sdk-node";',
    'import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";',
    "",
    "// Reads OTEL_SERVICE_NAME and the OTEL_EXPORTER_OTLP_* variables, and sends",
    "// Next.js's spans, your libraries' and your own to OneUptime over OTLP/HTTP.",
    "const sdk = new NodeSDK({",
    "  instrumentations: [getNodeAutoInstrumentations()],",
    "});",
    "",
    "sdk.start();",
  ].join("\n"),
  check: "run",
};

const nextConfig: GuideSnippet = {
  id: "next-config",
  language: "typescript",
  title: "next.config.ts",
  code: [
    'import type { NextConfig } from "next";',
    "",
    "const nextConfig: NextConfig = {",
    "  // Loaded from node_modules at run time, so OpenTelemetry can patch them.",
    '  serverExternalPackages: ["mysql2", "ioredis", "graphql"],',
    "};",
    "",
    "export default nextConfig;",
  ].join("\n"),
  check: "run",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "npm run build && npm run start",
  check: "run",
};

const pageSpan: GuideSnippet = {
  id: "page-span",
  language: "tsx",
  title: "app/products/[id]/page.tsx",
  code: [
    'import { trace } from "@opentelemetry/api";',
    "",
    'const tracer = trace.getTracer("storefront");',
    "",
    "export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {",
    "  const { id } = await params;",
    '  const product = await tracer.startActiveSpan("load product", async (span) => {',
    "    try {",
    '      span.setAttribute("product.id", id);',
    "      return await getProduct(id);",
    "    } finally {",
    "      span.end();",
    "    }",
    "  });",
    "  return <h1>{product.name}</h1>;",
    "}",
  ].join("\n"),
  check: "contained",
};

const routeHandler: GuideSnippet = {
  id: "route-handler",
  language: "typescript",
  title: "app/api/orders/route.ts",
  code: [
    'import { metrics } from "@opentelemetry/api";',
    'import pino from "pino";',
    "",
    "const logger = pino();",
    'const ordersPlaced = metrics.getMeter("storefront").createCounter("orders.placed");',
    "",
    "export async function POST(request: Request) {",
    "  const order = await request.json();",
    '  ordersPlaced.add(1, { "payment.method": order.paymentMethod });',
    '  logger.info({ items: order.items.length }, "order placed");',
    '  return Response.json({ id: "ord_1001" }, { status: 201 });',
    "}",
  ].join("\n"),
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

const standaloneConfig: GuideSnippet = {
  id: "standalone-config",
  language: "typescript",
  title: "next.config.ts",
  code: [
    "const nextConfig: NextConfig = {",
    '  output: "standalone",',
    '  serverExternalPackages: ["mysql2", "ioredis", "graphql"],',
    "};",
  ].join("\n"),
  check: "parse",
};

const dockerfile: GuideSnippet = {
  id: "dockerfile",
  language: "dockerfile",
  title: "Dockerfile",
  code: [
    "FROM node:24-alpine AS build",
    "WORKDIR /app",
    "COPY package*.json ./",
    "RUN npm ci",
    "COPY . .",
    "RUN npm run build",
    "",
    "FROM node:24-alpine",
    "WORKDIR /app",
    "ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0",
    "COPY --from=build /app/.next/standalone ./",
    "COPY --from=build /app/.next/static ./.next/static",
    "COPY --from=build /app/public ./public",
    "EXPOSE 3000",
    'CMD ["node", "server.js"]',
  ].join("\n"),
  check: "parse",
};

const verbose: GuideSnippet = {
  id: "verbose",
  language: "bash",
  code: 'export NEXT_OTEL_VERBOSE="1"',
  check: "parse",
};

// The app the end-to-end check builds and starts, around the page's files.
const layout: string = [
  "export default function RootLayout({ children }: { children: React.ReactNode }) {",
  "  return (",
  '    <html lang="en">',
  "      <body>{children}</body>",
  "    </html>",
  "  );",
  "}",
].join("\n");

const productPage: string = [
  'export const dynamic = "force-dynamic";',
  "",
  "// A stand-in for the product API, called with fetch as a real one would be.",
  "async function getProduct(id: string) {",
  "  await fetch(`http://127.0.0.1:3000/api/stock/${id}`);",
  '  return { id: id, name: "Mechanical keyboard" };',
  "}",
  "",
  pageSpan.code,
].join("\n");

const stockRoute: string = [
  "export async function GET() {",
  "  return Response.json({ inStock: 12 });",
  "}",
].join("\n");

const failingRoute: string = [
  'export const dynamic = "force-dynamic";',
  "",
  "export default async function BrokenPage() {",
  '  throw new Error("Inventory service unavailable");',
  "}",
].join("\n");

const packageFile: string = JSON.stringify(
  {
    name: "storefront",
    private: true,
    scripts: { build: "next build", start: "next start -p 3000" },
  },
  null,
  2,
);

export const NextJsGuide: OpenTelemetryGuide = {
  slug: "nextjs",
  seo: {
    title: "Next.js OpenTelemetry: Tracing & Monitoring | OneUptime",
    description:
      "Set up OpenTelemetry in Next.js 16 with instrumentation.ts: route and render spans, fetch and database calls, server errors and logs, sent to OneUptime.",
  },
  h1: "OpenTelemetry for Next.js",
  lead: "Next.js traces its own server: every route, render, route handler and `fetch` is a span. Register the OpenTelemetry SDK in `instrumentation.ts` to collect those spans with your libraries' own, and send them, your logs and your metrics to OneUptime.",
  cardDescription:
    "App Router routes, renders and route handlers, fetch and database calls, from instrumentation.ts.",
  searchTerms: [
    "next",
    "next.js",
    "nextjs",
    "app router",
    "vercel",
    "react server components",
    "ssr",
  ],
  highlights: [
    "Next.js 16, App Router",
    "instrumentation.ts",
    "next start and standalone",
  ],

  whatYouGet: {
    intro: `Next.js calls the OpenTelemetry API itself; registering the SDK is what turns those calls into data. Everything arrives under the service named by \`OTEL_SERVICE_NAME\`, listed under ${SCREENS.services}.`,
    traces:
      "A span per request named after its route, such as `GET /products/[id]`, with Next.js's own spans beneath it: `render route (app) /products/[id]`, `executing api route (app) /api/orders`, and a span per `fetch`. Database calls made through packages Next.js loads from `node_modules` join them.",
    metrics:
      "The Node.js runtime's event loop, heap and garbage collection, `http.client.request.duration` for every `fetch`, and your own counters. Next.js reports no request-duration metric of its own: chart latency from the spans in the **Traces** explorer.",
    logs: "pino records, which Next.js loads from `node_modules` by default, arrive stamped with the trace and span of the request that wrote them.",
    exceptions: `An error thrown while a route renders is recorded on its \`render route\` span, and the request's span is marked failed. OneUptime groups the errors, with their stack traces, under ${SCREENS.exceptions}.`,
  },

  exampleTrace: {
    caption: "A GET /products/[id] request, as its trace shows it",
    spans: [
      {
        name: "GET /products/[id]",
        depth: 0,
        start: 0,
        duration: 100,
        source: "next.js",
      },
      {
        name: "resolve page components",
        depth: 1,
        start: 2,
        duration: 6,
        source: "next.js",
      },
      {
        name: "render route (app) /products/[id]",
        depth: 1,
        start: 9,
        duration: 84,
        source: "next.js",
      },
      {
        name: "load product",
        depth: 2,
        start: 14,
        duration: 52,
        source: "your code",
      },
      {
        name: "GET",
        depth: 3,
        start: 19,
        duration: 40,
        source: "undici",
      },
    ],
  },

  prerequisites: [
    NODE_PREREQUISITE,
    "A Next.js 15 or 16 app run by `next start` or its standalone output, on your server, in a container or on a platform that runs Node.js.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Install the Node.js SDK, the automatic instrumentations and the API. Next.js uses `@opentelemetry/api` when the app has it installed, so its spans and yours go through the same copy:",
    snippets: [install],
    notes: [
      "This guide uses the OpenTelemetry SDK directly. `@vercel/otel` wraps the same SDK for Vercel, but version 2.1 still requires the 2.x SDK packages.",
    ],
  },

  configure: {
    intro:
      "The SDK reads its settings from the environment of the server process. Set them where `next start` or `node server.js` runs, not in `NEXT_PUBLIC_` variables, which end up in the browser:",
    tabs: otlpEnvironmentTabs({
      serviceName: "storefront",
      extraLines: ['export NEXT_OTEL_FETCH_DISABLED="1"'],
      cloudNote:
        "`NEXT_OTEL_FETCH_DISABLED` turns off Next.js's own `fetch` spans. The `fetch` instrumentation makes one for every call already, with the standard attributes and a duration metric, so each call shows once instead of twice.",
    }),
    notes: [
      "Next.js loads its `.env` files before it calls `register()`, for `next dev` and `next start` alike, so the variables can live in `.env.local`. That file stays out of git, so a container gets them from its environment instead.",
    ],
  },

  setup: {
    intro:
      "Next.js calls the `register()` function of `instrumentation.ts` once, when the server starts and before it handles a request. Load the SDK from there.",
    steps: [
      {
        title: "Create instrumentation.ts",
        body: "Put it in the project's root, or in `src/` if your app lives there. It loads the SDK on the Node.js server only:",
        snippets: [instrumentationEntry],
      },
      {
        title: "Start the SDK in instrumentation.node.ts",
        body: "Next to it, the file that starts the SDK with every automatic instrumentation:",
        snippets: [instrumentationNode],
        notes: [
          "Keeping the SDK in a file of its own, imported only for the Node.js runtime, keeps Node.js-only packages out of the Edge bundle.",
        ],
      },
      {
        title: "Keep the libraries you want traced external",
        body: "Next.js bundles the server's dependencies, and a bundled library cannot be patched. It already loads common ones from `node_modules`, such as `pg`, `mongodb`, `mongoose`, `@prisma/client` and `pino`; list the others your server uses:",
        snippets: [nextConfig],
      },
      {
        title: "Build and start",
        body: "`register()` runs when the server starts, for `next start`, the standalone `server.js` and `next dev` alike:",
        snippets: [run],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "Next.js traces its own work; the SDK's instrumentations add what your code calls:",
    rows: [
      {
        library: "Next.js itself",
        covers:
          "The request's span by route (`GET /products/[id]`, with `http.route` and `next.route`), `render route (app)`, `executing api route (app)`, `fetch` spans (unless turned off as above), and the loading of route modules and components.",
      },
      {
        library: "`fetch` (undici)",
        covers:
          "A client span and a `http.client.request.duration` measurement for every `fetch` the server makes.",
      },
      {
        library: "`pg`, `mongodb`, `mongoose`, `@prisma/client`",
        covers:
          "Query spans, with no configuration: Next.js loads these from `node_modules` already.",
      },
      {
        library:
          "`mysql2`, `ioredis`, `redis`, `graphql`, `kafkajs`, `amqplib`",
        covers:
          "Query, command, operation and message spans, once the package is in `serverExternalPackages`.",
      },
      {
        library: "`pino`, `winston`",
        covers:
          "Trace IDs on every record and the records sent as logs. pino is external by default; add `winston` to `serverExternalPackages`.",
      },
    ],
    snippets: [verbose],
    notes: [
      "For every span Next.js can make, including the internals of each render, set `NEXT_OTEL_VERBOSE` on the server:",
    ],
  },

  manualSpans: {
    intro:
      "Server components, route handlers and server actions run inside the request's span, so a span you start there becomes its child:",
    snippets: [pageSpan],
    notes: [
      'A span started in a client component (`"use client"`) is browser code: see the [React guide](/integrations/opentelemetry/react) to send those.',
      "End every span in `finally`, as above: a page that throws still closes its spans, and the error shows on the render's span.",
    ],
  },

  logs: {
    intro:
      "Log with pino in route handlers, server components and server actions. Each record carries its request's trace, and the pino instrumentation sends it to OneUptime:",
    snippets: [routeHandler],
    notes: [
      "`console.log` on the server writes to stdout only: OneUptime does not receive it through the SDK.",
      "Log from server code only. A logger in a client component runs in the visitor's browser.",
    ],
  },

  metrics: {
    intro:
      "The SDK exports metrics every 60 seconds. With the route handler above, `orders.placed` arrives beside these:",
    builtIn: [
      {
        name: "http.client.request.duration",
        description:
          "Every `fetch` the server makes, by host and status: slow upstream APIs show here first.",
      },
      {
        name: "nodejs.eventloop.delay.p99",
        description:
          "How long renders waited for the event loop: heavy synchronous rendering shows here.",
      },
      {
        name: "v8js.memory.heap.used",
        description: "The server's heap, by V8 space.",
      },
      {
        name: "orders.placed",
        description: "The counter from the route handler, by `payment.method`.",
      },
    ],
    snippets: [],
    notes: [
      "Request latency per route comes from the spans: chart `GET /products/[id]`'s duration in the **Traces** explorer, or alert on it with a trace monitor.",
    ],
  },

  sampling: {
    intro:
      "Every request is traced by default. A busy storefront can keep a share of new traces:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps one new trace in five, and keeps every request that arrives with a sampled `traceparent`, so a trace the browser or another service started is never cut in half.",
      "Logs and metrics are not sampled.",
    ],
  },

  deploy: {
    intro:
      "The standalone output keeps the image small, and carries the instrumentation with it: Next.js compiles `instrumentation.ts` into the build, and copies the external packages into `.next/standalone/node_modules`.",
    snippets: [
      standaloneConfig,
      dockerfile,
      kubernetesManifestSnippet({
        name: "storefront",
        image: "registry.example.com/storefront:5.2.0",
        containerPort: 3000,
        extraEnv: [{ name: "NEXT_OTEL_FETCH_DISABLED", value: "1" }],
      }),
    ],
    notes: [
      "Next.js handles SIGTERM itself: it finishes the requests in flight, then exits without waiting for the SDK. To lose at most a second of spans when a pod stops, set `OTEL_BSP_SCHEDULE_DELAY=1000`.",
      "On Vercel, functions freeze between requests and can stop before the SDK sends: Vercel's `@vercel/otel` waits for the export there.",
    ],
  },

  verify: {
    intro: "Each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Start the server, open a few pages, and look in ${SCREENS.services}: \`storefront\` appears within a minute.`,
      },
      {
        title: "Open a page's trace",
        body: `In ${SCREENS.traces}, search \`@next.route:/products/[id]\`. The request holds the render, your \`load product\` span and its \`fetch\`.`,
      },
      {
        title: "Find a log line",
        body: `Place an order, then open ${SCREENS.logs}: the \`order placed\` line links to its request's trace.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Only Next.js's own spans arrive, no database spans",
      answer:
        "Next.js bundled the driver, and a bundled library cannot be patched. Add it to `serverExternalPackages` in `next.config.ts` and build again. `pg`, `mongodb`, `mongoose`, `@prisma/client` and `pino` are external already.",
    },
    {
      question: "Every fetch appears twice",
      answer:
        "Next.js makes a `fetch GET ...` span of its own, and the `fetch` instrumentation another. Set `NEXT_OTEL_FETCH_DISABLED=1` to keep one: the instrumentation's, with the standard attributes and a duration metric.",
    },
    {
      question: "register() never seems to run",
      answer:
        "Check where the file is: `instrumentation.ts` belongs in the project's root, or in `src/` when the app uses a `src` folder, never inside `app/`. A typo in the name, such as `instrumentations.ts`, is ignored without a word.",
    },
    {
      question: "The build fails on Node.js modules such as fs or net",
      answer:
        'The SDK was imported where the Edge runtime builds it, often from `instrumentation.ts` directly. Import it from `instrumentation.node.ts` behind the `NEXT_RUNTIME === "nodejs"` check, as above.',
    },
    {
      question: "Nothing arrives from production, but development works",
      answer:
        "The variables were only in `.env.local`, which stays out of git and so out of your image. Give `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_SERVICE_NAME` to the server process itself.",
    },
    {
      question: "Spans of the browser are missing",
      answer:
        "Client components run in the browser, which this SDK does not reach. Add the browser SDK with a Browser key: see the [React guide](/integrations/opentelemetry/react).",
    },
  ],

  faq: [
    {
      question: "Does it work with the Pages Router?",
      answer:
        "Yes. Next.js traces `getServerSideProps`, API routes and renders of the Pages Router too, under the same request spans; the setup is the same `instrumentation.ts`.",
    },
    {
      question: "Do I need @vercel/otel?",
      answer:
        "Not to run Next.js on your own server or in a container: the OpenTelemetry SDK does everything shown here. On Vercel, `@vercel/otel` flushes before a function freezes; at version 2.1 it requires the OpenTelemetry JS 2.x packages, not the 3.0 ones this guide installs.",
    },
    {
      question: "Are server actions traced?",
      answer:
        "Yes: a server action runs in a POST request to its page, so it gets the request's span, and your spans inside it nest beneath.",
    },
    {
      question: "What about the Edge runtime?",
      answer:
        'This SDK does not run there: routes with `export const runtime = "edge"` are not traced. Next.js 16 always runs `proxy.ts` on Node.js, so it is traced with the rest; a `middleware.ts` left on the Edge runtime is not.',
    },
    {
      question: "How do I tell environments apart?",
      answer:
        'Set `OTEL_RESOURCE_ATTRIBUTES="deployment.environment.name=production"` on each deployment: every span, metric and log carries it, and each explorer filters by it.',
    },
  ],

  related: ["react", "nodejs", "express", "browser"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.exceptions, DOCS.rum],

  verification: {
    runtime: "node",
    framework: { name: "Next.js", package: "next" },
    files: [
      { path: "package.json", content: packageFile },
      { path: "next.config.ts", snippet: "next-config" },
      { path: "instrumentation.ts", snippet: "instrumentation" },
      { path: "instrumentation.node.ts", snippet: "instrumentation-node" },
      { path: "app/layout.tsx", content: layout },
      { path: "app/products/[id]/page.tsx", content: productPage },
      { path: "app/api/stock/[id]/route.ts", content: stockRoute },
      { path: "app/api/orders/route.ts", snippet: "route-handler" },
      { path: "app/broken/page.tsx", content: failingRoute },
    ],
    commands: [
      { snippet: "install" },
      {
        command:
          "npm install next@16.4.3 react@19.3.1 react-dom@19.3.1 pino@10.4.0 typescript@6.0.3 @types/react@19.3.0 @types/node@24.19.2",
      },
      { snippet: "run", isServer: true },
    ],
    port: 3000,
    requests: [
      { method: "GET", path: "/products/42" },
      {
        method: "POST",
        path: "/api/orders",
        body: { items: ["keyboard"], paymentMethod: "card" },
      },
      { method: "GET", path: "/broken" },
    ],
    expect: {
      spans: [
        {
          name: "GET /products/[id]",
          attributes: { "http.route": "/products/[id]" },
        },
        { name: "render route (app) /products/[id]" },
        { name: "load product", attributes: { "product.id": "42" } },
        { name: "POST /api/orders" },
        { name: "executing api route (app) /api/orders" },
        { name: "render route (app) /broken", hasException: true },
      ],
      metrics: [
        "http.client.request.duration",
        "orders.placed",
        "nodejs.eventloop.delay.p99",
      ],
      logs: [{ body: "order placed", hasTraceContext: true }],
      resource: { "service.name": "storefront" },
    },
  },
};
