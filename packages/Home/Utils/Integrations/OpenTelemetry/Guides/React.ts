import { GuideSnippet, OpenTelemetryGuide } from "../GuideTypes";
import {
  BROWSER_KEY_PREREQUISITE,
  DOCS,
  SCREENS,
  validateKeyStep,
} from "../GuideShared";
import {
  BROWSER_TSCONFIG,
  ERROR_LISTENERS,
  WEB_VITALS_FILE,
  browserEndpointTabs,
  browserInstallSnippet,
  browserTelemetryFile,
} from "../BrowserShared";

/*
 * React 19 with React Router, in the browser: the browser SDK as the
 * browser guide sets it up, plus what React needs of its own. React 19's
 * root error callbacks report what React catches, with the component
 * stack; a component in the router makes a span per route change, named
 * after the matched route's pattern. The click instrumentation is off:
 * React's delegated listeners gave it several spans for one click.
 */

const install: GuideSnippet = browserInstallSnippet(["web-vitals"]);

const telemetry: GuideSnippet = {
  id: "telemetry",
  language: "typescript",
  title: "src/telemetry.ts",
  code: browserTelemetryFile({
    serviceName: "storefront-react",
    autoInstrumentationLines: [
      "// React listens for every click at its root: one click made several spans.",
      '"@opentelemetry/instrumentation-user-interaction": { enabled: false },',
    ],
  }),
  check: "run",
};

const webVitals: GuideSnippet = {
  id: "web-vitals",
  language: "typescript",
  title: "src/web-vitals.ts",
  code: WEB_VITALS_FILE,
  check: "run",
};

const errors: GuideSnippet = {
  id: "errors",
  language: "typescript",
  title: "src/errors.ts",
  code: ERROR_LISTENERS,
  check: "run",
};

const reactErrors: GuideSnippet = {
  id: "react-errors",
  language: "typescript",
  title: "src/react-errors.ts",
  code: [
    'import { SpanStatusCode, trace } from "@opentelemetry/api";',
    'import type { ErrorInfo } from "react";',
    "",
    'const tracer = trace.getTracer("react");',
    "",
    "// For createRoot: each error React catches, as a span with the component stack.",
    "export function reportReactError(kind: string) {",
    "  return (error: unknown, errorInfo: ErrorInfo): void => {",
    "    const span = tracer.startSpan(`react.${kind}`);",
    "    span.recordException(error instanceof Error ? error : new Error(String(error)));",
    '    span.setAttribute("react.component_stack", errorInfo.componentStack ?? "");',
    "    span.setStatus({ code: SpanStatusCode.ERROR });",
    "    span.end();",
    "  };",
    "}",
  ].join("\n"),
  check: "run",
};

const routeSpans: GuideSnippet = {
  id: "route-spans",
  language: "tsx",
  title: "src/RouteSpans.tsx",
  code: [
    'import { useEffect } from "react";',
    'import { matchRoutes, useLocation, type RouteObject } from "react-router";',
    'import { trace } from "@opentelemetry/api";',
    "",
    'const tracer = trace.getTracer("react-router");',
    "",
    "// A span per route change, named after the route's pattern, never the URL:",
    '// "/products/:id" for /products/42 and /products/43 alike.',
    "export function RouteSpans({ routes }: { routes: RouteObject[] }) {",
    "  const location = useLocation();",
    "",
    "  useEffect(() => {",
    "    const matches = matchRoutes(routes, location) ?? [];",
    '    const pattern = matches.map((match) => match.route.path ?? "").join("/");',
    '    const route = `/${pattern}`.replace(/\\/+/g, "/").replace(/(.)\\/$/, "$1");',
    '    const span = tracer.startSpan("route change", { attributes: { "app.route": route } });',
    "    // It ends once the new route has painted.",
    "    requestAnimationFrame(() => span.end());",
    "  }, [location.pathname]);",
    "",
    "  return null;",
    "}",
  ].join("\n"),
  check: "run",
};

const main: GuideSnippet = {
  id: "main",
  language: "tsx",
  title: "src/main.tsx",
  code: [
    "// First, before React and your components.",
    'import "./telemetry";',
    'import "./web-vitals";',
    'import "./errors";',
    'import { createRoot } from "react-dom/client";',
    'import { RouterProvider, createBrowserRouter } from "react-router";',
    'import { reportReactError } from "./react-errors";',
    'import { routes } from "./routes";',
    "",
    'createRoot(document.getElementById("root")!, {',
    "  // An error an error boundary caught, and one nothing caught.",
    '  onCaughtError: reportReactError("caught_error"),',
    '  onUncaughtError: reportReactError("uncaught_error"),',
    "}).render(<RouterProvider router={createBrowserRouter(routes)} />);",
  ].join("\n"),
  check: "run",
};

const layout: GuideSnippet = {
  id: "layout",
  language: "tsx",
  title: "src/routes.tsx",
  code: [
    "function Layout() {",
    "  return (",
    "    <>",
    "      <RouteSpans routes={routes} />",
    "      <Outlet />",
    "    </>",
    "  );",
    "}",
  ].join("\n"),
  check: "contained",
};

const manualSpan: GuideSnippet = {
  id: "manual-span",
  language: "tsx",
  title: "src/routes.tsx",
  code: [
    'const tracer = trace.getTracer("storefront-react");',
    'const logger = logs.getLogger("storefront-react");',
    "",
    "function AddToCart({ productId }: { productId: string }) {",
    "  const [added, setAdded] = useState(false);",
    "",
    "  function add(): void {",
    '    tracer.startActiveSpan("cart.add", async (span) => {',
    "      // The span stops being current at the first await: keep its context.",
    "      const spanContext = context.active();",
    "      try {",
    '        span.setAttribute("product.id", productId);',
    '        await fetch(`/api/cart/${productId}`, { method: "POST" });',
    "        setAdded(true);",
    "        logger.emit({",
    "          severityNumber: SeverityNumber.INFO,",
    '          severityText: "INFO",',
    '          body: "added to cart",',
    '          attributes: { "product.id": productId },',
    "          context: spanContext,",
    "        });",
    "      } finally {",
    "        span.end();",
    "      }",
    "    });",
    "  }",
    "",
    "  return (",
    '    <button id="add-to-cart" onClick={add} disabled={added}>',
    '      {added ? "Added" : "Add to cart"}',
    "    </button>",
    "  );",
    "}",
  ].join("\n"),
  check: "contained",
};

const indexHtml: string = [
  "<!doctype html>",
  '<html lang="en">',
  "  <head>",
  '    <meta charset="utf-8" />',
  "    <title>Storefront</title>",
  "  </head>",
  "  <body>",
  '    <div id="root"></div>',
  '    <script type="module" src="/main.js"></script>',
  "  </body>",
  "</html>",
].join("\n");

// src/routes.tsx as the check builds it: scaffolding around the page's fragments.
const routesFile: string = [
  'import { Component, useState, type ReactNode } from "react";',
  'import { Link, Outlet, useParams, type RouteObject } from "react-router";',
  'import { context, logs, SeverityNumber, trace } from "@opentelemetry/api";',
  'import { RouteSpans } from "./RouteSpans";',
  "",
  layout.code,
  "",
  manualSpan.code,
  "",
  "function Home() {",
  "  return (",
  "    <main>",
  "      <h1>Storefront</h1>",
  '      <Link id="to-product" to="/products/42">Kettle</Link>',
  "    </main>",
  "  );",
  "}",
  "",
  "function Product() {",
  "  const { id } = useParams();",
  "  const [broken, setBroken] = useState(false);",
  "  if (broken) {",
  '    throw new Error("Product page failed to render");',
  "  }",
  "  return (",
  "    <main>",
  "      <h1>Product {id}</h1>",
  '      <AddToCart productId={id ?? ""} />',
  '      <button id="break" onClick={() => setBroken(true)}>Break</button>',
  "    </main>",
  "  );",
  "}",
  "",
  "class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {",
  "  state = { failed: false };",
  "  static getDerivedStateFromError() {",
  "    return { failed: true };",
  "  }",
  "  render() {",
  "    return this.state.failed ? <p>Something went wrong.</p> : this.props.children;",
  "  }",
  "}",
  "",
  "export const routes: RouteObject[] = [",
  "  {",
  '    path: "/",',
  "    element: <Layout />,",
  "    children: [",
  "      { index: true, element: <Home /> },",
  "      {",
  '        path: "products/:id",',
  "        element: (",
  "          <ErrorBoundary>",
  "            <Product />",
  "          </ErrorBoundary>",
  "        ),",
  "      },",
  "    ],",
  "  },",
  "];",
].join("\n");

export const ReactGuide: OpenTelemetryGuide = {
  slug: "react",
  seo: {
    title: "React OpenTelemetry: RUM, Errors and Web Vitals | OneUptime",
    description:
      "Trace a React 19 app with OpenTelemetry: page loads, fetch calls, a span per route change, React's caught errors and Core Web Vitals, in OneUptime.",
  },
  h1: "OpenTelemetry for React",
  lead: "React runs in your visitors' browsers, so it is traced with the OpenTelemetry browser SDK. This guide adds what React needs on top: React 19's error callbacks, which report each error with its component stack, and a span for every route change, so OneUptime shows a single-page app as the pages your visitors see.",
  cardDescription:
    "React 19 errors with their component stack, a span per route change, fetch calls and Core Web Vitals.",
  searchTerms: [
    "react",
    "react router",
    "spa",
    "rum",
    "web vitals",
    "frontend",
    "vite",
  ],
  highlights: ["React 19", "React Router", "Core Web Vitals"],

  whatYouGet: {
    intro: `A RUM application, named by its \`service.name\`, under ${SCREENS.rum}.`,
    traces:
      "The first page load, a `route change` span for every view after it, named with the route's pattern as `app.route`, each `fetch` call, and your own spans around what the visitor does.",
    metrics:
      "LCP, INP, CLS, FCP and TTFB on the `web_vital.*` histograms the **Core Web Vitals** card reads.",
    logs: "The records your components emit, with the trace of what the visitor was doing.",
    exceptions: `Each error React catches, with the component stack that threw it, and the errors outside React, such as in an event handler, under ${SCREENS.exceptions}.`,
  },

  exampleTrace: {
    caption: "Adding a product to the cart, as its trace shows it",
    spans: [
      {
        name: "cart.add",
        depth: 0,
        start: 0,
        duration: 100,
        source: "your code",
      },
      { name: "POST", depth: 1, start: 3, duration: 84, source: "fetch" },
      {
        name: "POST /api/cart/:id",
        depth: 2,
        start: 9,
        duration: 70,
        source: "your API",
      },
    ],
  },

  prerequisites: [
    "A React 19 app, built with npm packages by Vite or another bundler. React 18 apps work too, without the root error callbacks.",
    "React Router 7 or later, for the route change spans.",
    BROWSER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Install the browser SDK, its exporters and instrumentations, and the `web-vitals` library:",
    snippets: [install],
    notes: [
      "Nothing React-specific to install: React's errors and route changes go through the OpenTelemetry API.",
    ],
  },

  configure: {
    intro:
      "The app sends straight from the browser, so the endpoint and a Browser key sit in the telemetry file. The key only works from its Allowed Origins, which is why it can ship in your bundle:",
    tabs: browserEndpointTabs(),
    notes: [
      "With Vite, the key can come from `import.meta.env.VITE_ONEUPTIME_BROWSER_KEY` instead. Check the production build has it: an `undefined` key sends nothing.",
    ],
  },

  setup: {
    intro: "The browser SDK first, then React's errors and route changes.",
    steps: [
      {
        title: "Create the telemetry file",
        body: "It sends traces, logs and metrics to OneUptime under one resource, whose `browser.*` attributes file them as Real User Monitoring:",
        snippets: [telemetry],
        notes: [
          "Add the origin of each API you call on another domain to `propagateTraceHeaderCorsUrls`, so its backend trace joins the browser's. The API must allow the `traceparent` header.",
        ],
      },
      {
        title: "Record the Core Web Vitals",
        body: "Each vital goes on the `web_vital.*` histogram OneUptime's **Core Web Vitals** card reads:",
        snippets: [webVitals],
      },
      {
        title: "Report errors React does not see",
        body: "An error in an event handler or a timer never reaches React. Two listeners record those:",
        snippets: [errors],
      },
      {
        title: "Report the errors React catches",
        body: "React 19 hands every error it catches to the root's callbacks, with the component stack:",
        snippets: [reactErrors],
      },
      {
        title: "Trace route changes",
        body: "React Router changes the view without loading a page, which the document load instrumentation cannot see. This component makes a span for each change:",
        snippets: [routeSpans],
      },
      {
        title: "Wire it into your entry file",
        body: "Import the telemetry first, pass the error callbacks to `createRoot`, and render `RouteSpans` in your root layout:",
        snippets: [main, layout],
        notes: [
          "Without the callbacks, React reports a caught error with `console.error` only, which is not sent.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "`getWebAutoInstrumentations()` records these with no code; the click instrumentation is turned off for React:",
    rows: [
      {
        library: "Document load",
        covers:
          "The first page load, with the document's and each script's and image's timings.",
      },
      {
        library: "`fetch`",
        covers:
          "A client span per call, with its URL and status code, under the span that was current when it started.",
      },
      {
        library: "`XMLHttpRequest`",
        covers: "The same for libraries built on XHR.",
      },
      {
        library: "React",
        covers:
          "Nothing on its own: renders and state are React's, so the route and error code above stands in.",
      },
    ],
    snippets: [],
    notes: [
      "React's own `<Profiler>` measures render times: record its `actualDuration` on a histogram if you need them.",
    ],
  },

  manualSpans: {
    intro:
      "Wrap what the visitor does in a span: a request it starts nests under it.",
    snippets: [manualSpan],
    notes: [
      "The span is current until the first `await`. Keep `context.active()` from before it, and pass it on to what runs after, as the log line does.",
      "Start spans in event handlers and effects, not while rendering: React may render a component several times for one update.",
    ],
  },

  logs: {
    intro:
      "Emit records through the Logs API, as `AddToCart` does: each carries the trace of the span whose context you pass.",
    snippets: [],
    notes: [
      "`console.log` is not sent: only what you emit is.",
      "Records leave in batches, and when the visitor hides or leaves the page.",
    ],
  },

  metrics: {
    intro:
      "The Core Web Vitals arrive on their histograms. Count what matters to you beside them:",
    builtIn: [
      {
        name: "web_vital.lcp",
        description: "Largest Contentful Paint of the first page load.",
      },
      {
        name: "web_vital.inp",
        description:
          "Interaction to Next Paint, one value per visit, reported when the page is hidden.",
      },
      {
        name: "web_vital.cls",
        description:
          "Cumulative Layout Shift, reported when the page is hidden.",
      },
    ],
    snippets: [],
    notes: [
      "In a single-page app, INP is one value for the whole visit, whatever route was slow. For INP per route, see [Single-page apps](/docs/rum/web-vitals#single-page-apps).",
    ],
  },

  sampling: {
    intro:
      "Every visit is traced. To keep a share of them, give the `TracerProvider` a sampler in the telemetry file:",
    snippets: [
      {
        id: "sampling",
        language: "typescript",
        title: "src/telemetry.ts",
        code: [
          'import { ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace";',
          "",
          "// One visit in five, beside `resource` in the provider's options.",
          "const sampler = new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.2) });",
        ].join("\n"),
        check: "parse",
      },
    ],
    notes: [
      "The Core Web Vitals and the logs are recorded for every visit, sampled or not.",
      "The error spans are sampled too, so a sampler of one in five shows about a fifth of React's errors under Exceptions.",
    ],
  },

  deploy: {
    intro:
      "The SDK ships in your bundle. Before the release, allow OneUptime in your Content Security Policy, and every origin you serve from on the key:",
    snippets: [
      {
        id: "csp",
        language: "text",
        title: "Content-Security-Policy",
        code: "connect-src 'self' https://oneuptime.com;",
        check: "parse",
      },
    ],
    notes: [
      "A blocked exporter fails silently, with one console error: the app keeps working and reports nothing.",
      "Upload your source maps to read minified stack traces: see [Source maps](/docs/telemetry/source-maps).",
    ],
  },

  verify: {
    intro: "Each step rules out one cause.",
    steps: [
      validateKeyStep("browser"),
      {
        title: "Find the application",
        body: `Open the app, click to another route, and open ${SCREENS.rum}: \`storefront-react\` is listed within a minute.`,
      },
      {
        title: "See the route changes",
        body: `In ${SCREENS.traces}, search \`@app.route:/products/:id\`: each visit to a product page is a \`route change\` span.`,
      },
      {
        title: "Break something on purpose",
        body: `Throw in a component under an error boundary: ${SCREENS.exceptions} lists it, with the component stack as \`react.component_stack\`.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Only the first page load arrives",
      answer:
        "Route changes need `RouteSpans` inside the router, in a layout every route renders. A route outside that layout has no spans.",
    },
    {
      question: "Every product has its own route",
      answer:
        "The span was named with the URL. `RouteSpans` takes the pattern from `matchRoutes`, so pass it the same `routes` array the router uses.",
    },
    {
      question: "Errors show in the console, but not under Exceptions",
      answer:
        "The root's error callbacks are missing: React then reports a caught error with `console.error` only. Pass `onCaughtError` and `onUncaughtError` to `createRoot`.",
    },
    {
      question: "Nothing arrives from production",
      answer:
        "Check the Network tab for `POST /otlp/v1/traces`. No request means the telemetry file was not imported first, or the key's build variable was empty; a CSP error means `connect-src` does not allow OneUptime.",
    },
    {
      question: "OneUptime answers 422",
      answer:
        "The page's origin, with its scheme and port, is not in the Browser key's **Allowed Origins**. Add it on the key's page.",
    },
  ],

  faq: [
    {
      question: "Does it work with Next.js?",
      answer:
        "A Next.js app runs on the server too: see the [Next.js guide](/integrations/opentelemetry/nextjs) for its server side. Its client components can use the files on this page, imported from a client component.",
    },
    {
      question: "Does it work with React 18?",
      answer:
        "Yes, except the root's `onCaughtError` and `onUncaughtError`, which came with React 19. On React 18, report errors from an error boundary's `componentDidCatch`.",
    },
    {
      question: "Why not trace every render?",
      answer:
        "Renders are frequent and cheap, and React may render a component several times for one update: spans for them would bury the requests and route changes that matter.",
    },
    {
      question: "Is the key safe in my bundle?",
      answer:
        "A **Browser** key is made for it: OneUptime accepts it only from its Allowed Origins, and you can switch it off at once. Never put a **Server** key in a bundle.",
    },
  ],

  related: ["browser", "nextjs", "angular", "nodejs"],
  docs: [
    DOCS.browserSetup,
    DOCS.webVitals,
    DOCS.sessionReplay,
    DOCS.sourceMaps,
  ],

  verification: {
    runtime: "browser",
    framework: { name: "React", package: "react" },
    files: [
      {
        path: "package.json",
        content:
          '{ "name": "storefront-react", "private": true, "type": "module" }',
      },
      { path: "tsconfig.json", content: BROWSER_TSCONFIG },
      { path: "src/telemetry.ts", snippet: "telemetry" },
      { path: "src/web-vitals.ts", snippet: "web-vitals" },
      { path: "src/errors.ts", snippet: "errors" },
      { path: "src/react-errors.ts", snippet: "react-errors" },
      { path: "src/RouteSpans.tsx", snippet: "route-spans" },
      { path: "src/main.tsx", snippet: "main" },
      { path: "src/routes.tsx", content: routesFile },
      { path: "public/index.html", content: indexHtml },
    ],
    commands: [
      { snippet: "install" },
      {
        command:
          "npm install react@19.3.1 react-dom@19.3.1 react-router@8.5.1 @types/react@19.3.0 @types/react-dom@19.3.0 esbuild@0.28.2 typescript@7.0.2",
      },
      { command: "npx tsc --noEmit -p ." },
      {
        command:
          "npx esbuild src/main.tsx --bundle --format=esm --jsx=automatic --outfile=public/main.js",
      },
    ],
    serve: "public",
    port: 3100,
    requests: [],
    clicks: ["#to-product", "#add-to-cart", "#break"],
    expect: {
      spans: [
        { name: "documentLoad" },
        { name: "route change", attributes: { "app.route": "/" } },
        { name: "route change", attributes: { "app.route": "/products/:id" } },
        { name: "cart.add", attributes: { "product.id": "42" } },
        { name: "POST", attributes: { "http.response.status_code": "200" } },
        {
          name: "react.caught_error",
          exceptionMessage: "Product page failed to render",
        },
      ],
      metrics: ["web_vital.lcp", "web_vital.fcp", "web_vital.ttfb"],
      logs: [{ body: "added to cart", hasTraceContext: true }],
      resource: { "service.name": "storefront-react" },
      absentSpans: ["click"],
    },
  },
};
