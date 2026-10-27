import { GuideSnippet, OpenTelemetryGuide } from "../GuideTypes";
import { DOCS, SCREENS, validateKeyStep } from "../GuideShared";
import {
  BROWSER_TSCONFIG,
  ERROR_LISTENERS,
  WEB_VITALS_FILE,
  browserEndpointTabs,
  browserInstallSnippet,
  browserTelemetryFile,
} from "../BrowserShared";

/*
 * Any web page, bundled with any bundler: the OpenTelemetry browser SDK
 * with a Browser key, so OneUptime files what arrives as a Real User
 * Monitoring application. The check builds the page's files with esbuild,
 * opens them in Chromium, clicks, and hides the page.
 */

const install: GuideSnippet = browserInstallSnippet(["web-vitals"]);

const telemetry: GuideSnippet = {
  id: "telemetry",
  language: "typescript",
  title: "src/telemetry.ts",
  code: browserTelemetryFile({ serviceName: "storefront-web" }),
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

const imports: GuideSnippet = {
  id: "imports",
  language: "typescript",
  title: "src/main.ts",
  code: [
    "// First, before the code that makes requests.",
    'import "./telemetry";',
    'import "./web-vitals";',
    'import "./errors";',
  ].join("\n"),
  check: "contained",
};

const manualSpan: GuideSnippet = {
  id: "manual-span",
  language: "typescript",
  title: "src/main.ts",
  code: [
    'import { context, logs, SeverityNumber, trace } from "@opentelemetry/api";',
    "",
    'const tracer = trace.getTracer("storefront-web");',
    'const logger = logs.getLogger("storefront-web");',
    "",
    'document.querySelector("#refresh")?.addEventListener("click", () => {',
    '  tracer.startActiveSpan("cart.refresh", async (span) => {',
    "    // The span stops being current at the first await: keep its context.",
    "    const spanContext = context.active();",
    "    try {",
    '      const response = await fetch("/api/cart");',
    "      const cart = await response.json();",
    '      span.setAttribute("cart.items", cart.items);',
    "      logger.emit({",
    "        severityNumber: SeverityNumber.INFO,",
    '        severityText: "INFO",',
    '        body: "cart refreshed",',
    '        attributes: { "cart.items": cart.items },',
    "        context: spanContext,",
    "      });",
    "    } finally {",
    "      span.end();",
    "    }",
    "  });",
    "});",
  ].join("\n"),
  check: "contained",
};

const csp: GuideSnippet = {
  id: "csp",
  language: "text",
  title: "Content-Security-Policy",
  code: "connect-src 'self' https://oneuptime.com;",
  check: "parse",
};

const corsHeaders: GuideSnippet = {
  id: "cors",
  language: "text",
  title: "Your API's CORS response",
  code: "Access-Control-Allow-Headers: content-type, traceparent",
  check: "parse",
};

const routeChange: GuideSnippet = {
  id: "route-change",
  language: "typescript",
  title: "src/main.ts",
  code: [
    "// For a page that changes its URL itself: a span per view.",
    "function viewChanged(route: string): void {",
    '  const span = tracer.startSpan("route change", { attributes: { "app.route": route } });',
    "  requestAnimationFrame(() => span.end());",
    "}",
  ].join("\n"),
  check: "contained",
};

// The page the check opens, and its script: scaffolding, then the page's fragments.
const indexHtml: string = [
  "<!doctype html>",
  '<html lang="en">',
  "  <head>",
  '    <meta charset="utf-8" />',
  "    <title>Storefront</title>",
  "  </head>",
  "  <body>",
  "    <h1>Storefront</h1>",
  '    <button id="refresh">Refresh cart</button>',
  '    <button id="checkout">Checkout</button>',
  '    <button id="coupon">Apply coupon</button>',
  '    <script type="module" src="/main.js"></script>',
  "  </body>",
  "</html>",
].join("\n");

const mainFile: string = [
  imports.code,
  "",
  manualSpan.code,
  "",
  routeChange.code,
  "",
  "// Scaffolding: a view change, and two failures nothing catches.",
  'viewChanged("/");',
  'document.querySelector("#checkout")?.addEventListener("click", () => {',
  "  setTimeout(() => {",
  '    throw new Error("Checkout widget failed to render");',
  "  });",
  "});",
  'document.querySelector("#coupon")?.addEventListener("click", () => {',
  '  void Promise.reject(new Error("Coupon service unavailable"));',
  "});",
].join("\n");

export const BrowserGuide: OpenTelemetryGuide = {
  slug: "browser",
  seo: {
    title: "Browser OpenTelemetry: Real User Monitoring | OneUptime",
    description:
      "Instrument any web app with the OpenTelemetry browser SDK: page loads, fetch calls, clicks, errors, logs and Core Web Vitals, as RUM in OneUptime.",
  },
  h1: "OpenTelemetry for JavaScript in the browser",
  lead: "The OpenTelemetry browser SDK runs in your visitors' browsers and sends what it records straight to OneUptime, with a Browser key that only works from your own origins. This guide sets up page loads, requests, clicks, uncaught errors, logs and Core Web Vitals for any web page, whatever its bundler.",
  cardDescription:
    "Page loads, fetch and XHR calls, clicks, uncaught errors and Core Web Vitals, as a RUM application.",
  searchTerms: ["browser", "rum", "real user monitoring", "web vitals", "frontend", "javascript", "vite"],
  highlights: ["Real User Monitoring", "Core Web Vitals", "Any bundler"],

  whatYouGet: {
    intro: `Everything arrives as one RUM application, named by its \`service.name\`, under ${SCREENS.rum}.`,
    traces:
      "A `documentLoad` trace per page load, with the page's and each resource's timings, a span per `fetch` and `XMLHttpRequest` call and per click, and your own spans around what the visitor does.",
    metrics:
      "LCP, INP, CLS, FCP and TTFB from Google's `web-vitals` library, as the `web_vital.*` histograms the **Core Web Vitals** card reads.",
    logs: "The records you emit, with the trace of what the visitor was doing when you wrote them.",
    exceptions: `Uncaught errors and unhandled promise rejections, each recorded on a span of its own, under ${SCREENS.exceptions} beside your backend's errors.`,
  },

  exampleTrace: {
    caption: "A click that refreshes the cart, as its trace shows it",
    spans: [
      { name: "click", depth: 0, start: 0, duration: 100, source: "user-interaction" },
      {
        name: "cart.refresh",
        depth: 1,
        start: 1,
        duration: 97,
        source: "your code",
      },
      { name: "GET", depth: 2, start: 3, duration: 82, source: "fetch" },
      {
        name: "GET /api/cart",
        depth: 3,
        start: 10,
        duration: 66,
        source: "your API",
      },
    ],
  },

  prerequisites: [
    "A web app whose JavaScript you build with npm packages: Vite, webpack, esbuild or another bundler.",
    `A OneUptime ingestion key of the **Browser** type, from ${SCREENS.ingestionKeys}, with your site's origins, such as \`https://shop.example.com\`, in its **Allowed Origins**: see [Ingestion keys](/docs/telemetry/ingestion-keys).`,
  ],

  install: {
    intro:
      "Install the SDK, its exporters, the bundle of browser instrumentations and the `web-vitals` library:",
    snippets: [install],
    notes: [
      "Never use a **Server** key in a page: anyone can read it there, and a Server key writes from anywhere.",
    ],
  },

  configure: {
    intro:
      "A page has no environment variables, so the endpoint and the Browser key are constants in the telemetry file. The key is public by design: OneUptime accepts it only from its Allowed Origins.",
    tabs: browserEndpointTabs(),
    notes: [
      "Behind a build-time variable instead, such as `import.meta.env.VITE_ONEUPTIME_BROWSER_KEY`, check it is set in the production build: an `undefined` key sends nothing.",
    ],
  },

  setup: {
    intro:
      "Three files and one import: the SDK, the Core Web Vitals, and the errors nothing catches.",
    steps: [
      {
        title: "Create the telemetry file",
        body: "It sends traces, logs and metrics to OneUptime under one resource. `browserDetector` adds the `browser.*` attributes that make OneUptime file it all as Real User Monitoring:",
        snippets: [telemetry],
        notes: [
          "`propagateTraceHeaderCorsUrls` lists the other origins whose requests carry the `traceparent` header, so their backend spans join the browser's trace. Requests to the page's own origin carry it already.",
        ],
      },
      {
        title: "Record the Core Web Vitals",
        body: "Each vital goes on a `web_vital.*` histogram, the names OneUptime's **Core Web Vitals** card reads:",
        snippets: [webVitals],
      },
      {
        title: "Report the errors nothing catches",
        body: "The browser SDK does not capture uncaught errors. Two listeners record each one on a span, which OneUptime lists under Exceptions:",
        snippets: [errors],
      },
      {
        title: "Import them first",
        body: "Make them the first imports of your entry file, so the instrumentations patch `fetch` before your code calls it:",
        snippets: [imports],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "`getWebAutoInstrumentations()` loads these four, which need no code of yours:",
    rows: [
      {
        library: "Document load",
        covers:
          "A `documentLoad` span per page load, with `documentFetch` and a `resourceFetch` span per script, style sheet and image.",
      },
      {
        library: "`fetch`",
        covers:
          "A client span per call, with the URL and status code, and the `traceparent` header for your own origins.",
      },
      {
        library: "`XMLHttpRequest`",
        covers: "The same for libraries built on XHR, such as older Axios versions.",
      },
      {
        library: "User interaction",
        covers:
          "A `click` span per click, with the element's XPath, so the requests a click starts nest under it.",
      },
    ],
    snippets: [corsHeaders],
    notes: [
      "An API on another origin gets the `traceparent` header only if it is in `propagateTraceHeaderCorsUrls`, and must then allow it in its CORS response, as above: a third-party API that does not would start failing.",
    ],
  },

  manualSpans: {
    intro:
      "Wrap what the visitor does in spans of your own. The requests a span's callback starts nest under it:",
    snippets: [manualSpan],
    notes: [
      "A browser has no way to carry the current span across an `await`, so it is current only until the first one. Keep `context.active()` from the start of the callback, and pass it on to what runs later: `context: spanContext` for a log, `context.with(spanContext, () => fetch(url))` for a request.",
      "Keep attributes free of personal data: they ship from every visitor's browser.",
    ],
  },

  logs: {
    intro:
      "Emit records through the Logs API, as the example above does: each carries the trace of the span that was current when you wrote it.",
    snippets: [],
    notes: [
      "`console.log` is not sent: the browser SDK records only what you emit.",
      "Logs leave in batches, and when the visitor hides or leaves the page.",
    ],
  },

  metrics: {
    intro:
      "The Core Web Vitals arrive on their own histograms. Add counters and histograms of your own beside them:",
    builtIn: [
      {
        name: "web_vital.lcp",
        description:
          "Largest Contentful Paint, in milliseconds, with `web_vital.rating`.",
      },
      {
        name: "web_vital.inp",
        description:
          "Interaction to Next Paint, reported when the page is hidden.",
      },
      {
        name: "web_vital.cls",
        description: "Cumulative Layout Shift, a score, reported when the page is hidden.",
      },
      {
        name: "web_vital.fcp",
        description: "First Contentful Paint, in milliseconds.",
      },
      {
        name: "web_vital.ttfb",
        description: "Time to First Byte, in milliseconds.",
      },
    ],
    snippets: [],
    notes: [
      "INP and CLS are reported when the page is hidden. The telemetry file sends metrics at that moment too, so a visitor who closes the tab still counts.",
      "Keep metric attributes to a few values each: a route pattern is fine, a full URL or a user ID is not.",
    ],
  },

  sampling: {
    intro:
      "Every page load is traced. To keep a share of visits, pass a sampler to the `TracerProvider`:",
    snippets: [
      {
        id: "sampling",
        language: "typescript",
        title: "src/telemetry.ts",
        code: [
          'import { ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace";',
          "",
          "// One visit in four.",
          "const sampler = new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.25) });",
        ].join("\n"),
        check: "parse",
      },
    ],
    notes: [
      "Then add `sampler` beside `resource` in the provider's options.",
      "The Core Web Vitals and logs are not sampled: every visit still counts in them.",
      "The spans of uncaught errors are, so with one visit in four kept, Exceptions lists about a quarter of them.",
    ],
  },

  deploy: {
    intro:
      "Nothing runs on a server: the SDK ships in your bundle. Two things to check before the release:",
    snippets: [csp],
    notes: [
      "A Content Security Policy blocks the exporter until `connect-src` allows OneUptime, and the page then reports nothing, with only a console error.",
      "Every origin your pages are served from, staging included, must be in the Browser key's **Allowed Origins**: a request from any other is refused with a `422`.",
      "Minified stack traces are hard to read: see [Source maps](/docs/telemetry/source-maps) for readable ones.",
    ],
  },

  verify: {
    intro: "Each step rules out one cause.",
    steps: [
      validateKeyStep("browser"),
      {
        title: "Watch the requests leave",
        body: "In the browser's developer tools, filter the Network tab for `otlp`: a `POST /otlp/v1/traces` leaves a few seconds after the page loads, and when you hide the tab.",
      },
      {
        title: "Find the application",
        body: `Open ${SCREENS.rum}: \`storefront-web\` is listed within a minute, with its page loads.`,
      },
      {
        title: "Check the Core Web Vitals",
        body: "On the application's overview, the **Core Web Vitals** card fills once a few visits have sent their vitals.",
      },
    ],
  },

  troubleshooting: [
    {
      question: "No request to /otlp in the Network tab",
      answer:
        "The telemetry file did not run before your code: make it the first import of the entry file. If it did, a Content Security Policy error in the console means `connect-src` does not allow OneUptime yet.",
    },
    {
      question: "OneUptime answers 422",
      answer:
        "The page's exact origin, with its scheme and port, is not in the Browser key's **Allowed Origins**, or the key is switched off. Add the origin on the key's page.",
    },
    {
      question: "The app is listed under Services, not Real User Monitoring",
      answer:
        "Its resource has no `browser.*` attribute. Keep `browserDetector` in the resource, and build the log and metric providers with the same `resource` as the traces.",
    },
    {
      question: "A third-party API started failing with CORS errors",
      answer:
        "Its origin is in `propagateTraceHeaderCorsUrls`, so its requests carry `traceparent`, which it does not allow. List only APIs you control and have configured.",
    },
    {
      question: "INP and CLS never arrive",
      answer:
        "They are reported when the page is hidden. Keep the `visibilitychange` listener of the telemetry file, which sends metrics at that moment.",
    },
  ],

  faq: [
    {
      question: "Is it safe to put the ingestion key in the page?",
      answer:
        "A **Browser** key is made for it: OneUptime accepts it only from its Allowed Origins, within its request limit, and you can pin its service name or switch it off at once. A **Server** key never belongs in a page.",
    },
    {
      question: "Does it work with Vue, Svelte or plain HTML?",
      answer:
        "Yes. Any page whose JavaScript is bundled can import the telemetry file first. For React and Angular, which need a few more lines for errors and route changes, see their own guides.",
    },
    {
      question: "How do I trace route changes in a single-page app?",
      answer:
        "The document load covers the first page only. Start a span each time your router changes the view, with the route's pattern as `app.route`, as `viewChanged` above does.",
    },
    {
      question: "How much does the SDK add to my bundle?",
      answer:
        "It depends on the instrumentations you keep. Measure it with your bundler's analyzer, and drop the ones you do not need from `getWebAutoInstrumentations`.",
    },
  ],

  related: ["react", "angular", "nextjs", "nodejs"],
  docs: [DOCS.browserSetup, DOCS.webVitals, DOCS.sessionReplay, DOCS.sourceMaps],

  verification: {
    runtime: "browser",
    framework: { name: "Chromium" },
    files: [
      {
        path: "package.json",
        content: '{ "name": "storefront-web", "private": true, "type": "module" }',
      },
      { path: "src/telemetry.ts", snippet: "telemetry" },
      { path: "src/web-vitals.ts", snippet: "web-vitals" },
      { path: "src/errors.ts", snippet: "errors" },
      { path: "src/main.ts", content: mainFile },
      { path: "public/index.html", content: indexHtml },
      { path: "tsconfig.json", content: BROWSER_TSCONFIG },
    ],
    commands: [
      { snippet: "install" },
      { command: "npm install esbuild@0.28.2 typescript@7.0.2" },
      { command: "npx tsc --noEmit -p ." },
      {
        command:
          "npx esbuild src/main.ts --bundle --format=esm --outfile=public/main.js",
      },
    ],
    serve: "public",
    port: 3100,
    requests: [],
    clicks: ["#refresh", "#checkout", "#coupon"],
    expect: {
      spans: [
        { name: "documentLoad" },
        { name: "documentFetch" },
        { name: "click" },
        { name: "cart.refresh", attributes: { "cart.items": "2" } },
        { name: "GET", attributes: { "http.response.status_code": "200" } },
        { name: "route change", attributes: { "app.route": "/" } },
        {
          name: "window.error",
          exceptionMessage: "Checkout widget failed to render",
        },
        {
          name: "unhandledrejection",
          exceptionMessage: "Coupon service unavailable",
        },
      ],
      metrics: [
        "web_vital.lcp",
        "web_vital.fcp",
        "web_vital.ttfb",
        "web_vital.inp",
        "web_vital.cls",
      ],
      logs: [{ body: "cart refreshed", hasTraceContext: true }],
      resource: { "service.name": "storefront-web", "browser.language": "en-US" },
    },
  },
};
