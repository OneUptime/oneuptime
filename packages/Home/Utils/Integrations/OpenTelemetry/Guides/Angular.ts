import { GuideSnippet, OpenTelemetryGuide } from "../GuideTypes";
import {
  BROWSER_KEY_PREREQUISITE,
  DOCS,
  SCREENS,
  validateKeyStep,
} from "../GuideShared";
import {
  WEB_VITALS_FILE,
  browserEndpointTabs,
  browserInstallSnippet,
  browserTelemetryFile,
} from "../BrowserShared";

/*
 * Angular 22, zoneless as new apps are, in the browser: the browser SDK as
 * the browser guide sets it up, an ErrorHandler that records each error
 * Angular handles (provideBrowserGlobalErrorListeners hands it the window's
 * uncaught errors and rejections too), and a span per navigation named
 * after the matched route's pattern. HttpClient with withFetch() goes
 * through fetch, which the bundle traces.
 */

const install: GuideSnippet = browserInstallSnippet(["web-vitals"]);

const telemetry: GuideSnippet = {
  id: "telemetry",
  language: "typescript",
  title: "src/telemetry.ts",
  code: browserTelemetryFile({ serviceName: "storefront-angular" }),
  check: "run",
};

const webVitals: GuideSnippet = {
  id: "web-vitals",
  language: "typescript",
  title: "src/web-vitals.ts",
  code: WEB_VITALS_FILE,
  check: "run",
};

const main: GuideSnippet = {
  id: "main",
  language: "typescript",
  title: "src/main.ts",
  code: [
    "// First, before Angular.",
    'import "./telemetry";',
    'import "./web-vitals";',
    'import { bootstrapApplication } from "@angular/platform-browser";',
    'import { appConfig } from "./app/app.config";',
    'import { App } from "./app/app";',
    "",
    "bootstrapApplication(App, appConfig).catch((error) => console.error(error));",
  ].join("\n"),
  check: "run",
};

const errorHandler: GuideSnippet = {
  id: "error-handler",
  language: "typescript",
  title: "src/app/telemetry-error-handler.ts",
  code: [
    'import { ErrorHandler, Injectable } from "@angular/core";',
    'import { SpanStatusCode, trace } from "@opentelemetry/api";',
    "",
    'const tracer = trace.getTracer("angular");',
    "",
    "// Every error Angular handles, as a span OneUptime lists under Exceptions.",
    "@Injectable()",
    "export class TelemetryErrorHandler implements ErrorHandler {",
    "  handleError(error: unknown): void {",
    '    const span = tracer.startSpan("angular.error");',
    "    span.recordException(error instanceof Error ? error : new Error(String(error)));",
    "    span.setStatus({ code: SpanStatusCode.ERROR });",
    "    span.end();",
    "    console.error(error);",
    "  }",
    "}",
  ].join("\n"),
  check: "run",
};

const navigationSpans: GuideSnippet = {
  id: "navigation-spans",
  language: "typescript",
  title: "src/app/navigation-spans.ts",
  code: [
    'import { inject } from "@angular/core";',
    "import {",
    "  NavigationCancel,",
    "  NavigationEnd,",
    "  NavigationError,",
    "  NavigationStart,",
    "  Router,",
    '} from "@angular/router";',
    'import { Span, SpanStatusCode, trace } from "@opentelemetry/api";',
    "",
    'const tracer = trace.getTracer("angular-router");',
    "",
    '// "/products/:id" for /products/42: the matched routes\' paths, never the URL.',
    "function routePattern(router: Router): string {",
    "  const paths: string[] = [];",
    "  let route = router.routerState.snapshot.root;",
    "  while (route.firstChild) {",
    "    route = route.firstChild;",
    "    if (route.routeConfig?.path) paths.push(route.routeConfig.path);",
    "  }",
    '  return `/${paths.join("/")}`;',
    "}",
    "",
    "// For provideAppInitializer: a span per navigation, from start to end.",
    "export function traceNavigations(): void {",
    "  const router = inject(Router);",
    "  let span: Span | undefined;",
    "",
    "  router.events.subscribe((event) => {",
    "    if (event instanceof NavigationStart) {",
    '      span = tracer.startSpan("navigation");',
    "    } else if (event instanceof NavigationEnd && span) {",
    '      span.setAttribute("app.route", routePattern(router));',
    "      span.end();",
    "      span = undefined;",
    "    } else if (",
    "      (event instanceof NavigationCancel || event instanceof NavigationError) &&",
    "      span",
    "    ) {",
    "      span.setStatus({ code: SpanStatusCode.ERROR });",
    "      span.end();",
    "      span = undefined;",
    "    }",
    "  });",
    "}",
  ].join("\n"),
  check: "run",
};

const appConfig: GuideSnippet = {
  id: "app-config",
  language: "typescript",
  title: "src/app/app.config.ts",
  code: [
    "import {",
    "  ApplicationConfig,",
    "  ErrorHandler,",
    "  provideAppInitializer,",
    "  provideBrowserGlobalErrorListeners,",
    '} from "@angular/core";',
    'import { provideHttpClient, withFetch } from "@angular/common/http";',
    'import { provideRouter } from "@angular/router";',
    'import { routes } from "./app.routes";',
    'import { traceNavigations } from "./navigation-spans";',
    'import { TelemetryErrorHandler } from "./telemetry-error-handler";',
    "",
    "export const appConfig: ApplicationConfig = {",
    "  providers: [",
    "    // Hands the window's uncaught errors and rejections to the ErrorHandler.",
    "    provideBrowserGlobalErrorListeners(),",
    "    { provide: ErrorHandler, useClass: TelemetryErrorHandler },",
    "    provideRouter(routes),",
    "    provideAppInitializer(traceNavigations),",
    "    // HttpClient through fetch, which the fetch instrumentation traces.",
    "    provideHttpClient(withFetch()),",
    "  ],",
    "};",
  ].join("\n"),
  check: "run",
};

const manualSpan: GuideSnippet = {
  id: "manual-span",
  language: "typescript",
  title: "src/app/add-to-cart.ts",
  code: [
    'import { Component, inject, input, signal } from "@angular/core";',
    'import { HttpClient } from "@angular/common/http";',
    'import { context, logs, SeverityNumber, trace } from "@opentelemetry/api";',
    "",
    'const tracer = trace.getTracer("storefront-angular");',
    'const logger = logs.getLogger("storefront-angular");',
    "",
    "@Component({",
    '  selector: "app-add-to-cart",',
    "  template: `",
    '    <button id="add-to-cart" (click)="add()" [disabled]="added()">',
    "      Add to cart",
    "    </button>",
    "  `,",
    "})",
    "export class AddToCart {",
    "  private readonly http = inject(HttpClient);",
    "  readonly productId = input.required<string>();",
    "  readonly added = signal(false);",
    "",
    "  add(): void {",
    '    tracer.startActiveSpan("cart.add", (span) => {',
    "      // The request starts here, under the span; its answer comes later, outside it.",
    "      const spanContext = context.active();",
    '      span.setAttribute("product.id", this.productId());',
    "      this.http.post(`/api/cart/${this.productId()}`, {}).subscribe({",
    "        next: () => {",
    "          this.added.set(true);",
    "          logger.emit({",
    "            severityNumber: SeverityNumber.INFO,",
    '            severityText: "INFO",',
    '            body: "added to cart",',
    '            attributes: { "product.id": this.productId() },',
    "            context: spanContext,",
    "          });",
    "        },",
    "        error: () => span.end(),",
    "        complete: () => span.end(),",
    "      });",
    "    });",
    "  }",
    "}",
  ].join("\n"),
  check: "run",
};

const csp: GuideSnippet = {
  id: "csp",
  language: "text",
  title: "Content-Security-Policy",
  code: "connect-src 'self' https://oneuptime.com;",
  check: "parse",
};

// The rest of the app the check builds: scaffolding, not shown on the page.
const appTs: string = [
  'import { Component } from "@angular/core";',
  'import { RouterOutlet } from "@angular/router";',
  "",
  "@Component({",
  '  selector: "app-root",',
  "  imports: [RouterOutlet],",
  "  template: `<router-outlet />`,",
  "})",
  "export class App {}",
].join("\n");

const routesTs: string = [
  'import { Component, inject } from "@angular/core";',
  'import { ActivatedRoute, RouterLink, Routes } from "@angular/router";',
  'import { AddToCart } from "./add-to-cart";',
  "",
  "@Component({",
  '  selector: "app-home",',
  "  imports: [RouterLink],",
  '  template: `<h1>Storefront</h1><a id="to-product" routerLink="/products/42">Kettle</a>`,',
  "})",
  "export class Home {}",
  "",
  "@Component({",
  '  selector: "app-product",',
  "  imports: [AddToCart],",
  "  template: `",
  "    <h1>Product {{ id }}</h1>",
  '    <app-add-to-cart [productId]="id" />',
  '    <button id="break" (click)="breakIt()">Break</button>',
  '    <button id="reject" (click)="reject()">Reject</button>',
  "  `,",
  "})",
  "export class Product {",
  '  readonly id = inject(ActivatedRoute).snapshot.paramMap.get("id") ?? "";',
  "  breakIt(): void {",
  '    throw new Error("Cart total could not be computed");',
  "  }",
  "  reject(): void {",
  '    void Promise.reject(new Error("Coupon service unavailable"));',
  "  }",
  "}",
  "",
  "export const routes: Routes = [",
  '  { path: "", component: Home },',
  '  { path: "products/:id", component: Product },',
  "];",
].join("\n");

const indexHtml: string = [
  "<!doctype html>",
  '<html lang="en">',
  "  <head>",
  '    <meta charset="utf-8" />',
  "    <title>Storefront</title>",
  '    <base href="/" />',
  "  </head>",
  "  <body>",
  "    <app-root></app-root>",
  "  </body>",
  "</html>",
].join("\n");

const angularJson: string = JSON.stringify(
  {
    $schema: "./node_modules/@angular/cli/lib/config/schema.json",
    version: 1,
    newProjectRoot: "projects",
    cli: { analytics: false },
    projects: {
      storefront: {
        projectType: "application",
        root: "",
        sourceRoot: "src",
        prefix: "app",
        architect: {
          build: {
            builder: "@angular/build:application",
            options: {
              browser: "src/main.ts",
              tsConfig: "tsconfig.app.json",
              assets: [],
              styles: [],
            },
            configurations: {
              production: { outputHashing: "none", optimization: true },
            },
            defaultConfiguration: "production",
          },
        },
      },
    },
  },
  null,
  2,
);

const tsconfig: string = JSON.stringify(
  {
    compileOnSave: false,
    compilerOptions: {
      strict: true,
      skipLibCheck: true,
      isolatedModules: true,
      experimentalDecorators: true,
      importHelpers: true,
      target: "ES2022",
      module: "preserve",
    },
    angularCompilerOptions: { strictTemplates: true },
    files: [],
  },
  null,
  2,
);

const tsconfigApp: string = JSON.stringify(
  {
    extends: "./tsconfig.json",
    compilerOptions: { types: [] },
    include: ["src/**/*.ts"],
  },
  null,
  2,
);

export const AngularGuide: OpenTelemetryGuide = {
  slug: "angular",
  seo: {
    title: "Angular OpenTelemetry: RUM and Error Tracking | OneUptime",
    description:
      "Trace an Angular 22 app with OpenTelemetry: page loads, HttpClient calls, a span per navigation, every error Angular handles and Core Web Vitals.",
  },
  h1: "OpenTelemetry for Angular",
  lead: "An Angular app runs in your visitors' browsers, so it is traced with the OpenTelemetry browser SDK. This guide adds what Angular needs on top: an `ErrorHandler` that records every error Angular handles, and a span for each navigation, named after its route, so OneUptime shows a single-page app as the pages your visitors see.",
  cardDescription:
    "Every error Angular handles, a span per navigation, HttpClient calls and Core Web Vitals.",
  searchTerms: [
    "angular",
    "angularjs",
    "httpclient",
    "zoneless",
    "spa",
    "rum",
    "frontend",
  ],
  highlights: ["Angular 22, zoneless", "ErrorHandler", "Router navigations"],

  whatYouGet: {
    intro: `Your Angular app, as one RUM application under ${SCREENS.rum}, named after the \`service.name\` in the telemetry file.`,
    traces:
      "The first page load, a `navigation` span per route change with the route's pattern as `app.route`, each `HttpClient` call, and your own spans around what the visitor does.",
    metrics:
      "LCP, INP, CLS, FCP and TTFB, on the `web_vital.*` histograms OneUptime's **Core Web Vitals** card reads.",
    logs: "The records your components emit, with the trace of the action they belong to.",
    exceptions: `Every error Angular hands its \`ErrorHandler\`: from templates, event handlers and, with the global listeners, the window's uncaught errors and rejections, under ${SCREENS.exceptions}.`,
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
      { name: "POST", depth: 1, start: 2, duration: 90, source: "fetch" },
      {
        name: "POST /api/cart/:id",
        depth: 2,
        start: 8,
        duration: 76,
        source: "your API",
      },
    ],
  },

  prerequisites: [
    "An Angular app on Angular 20 or later, built with the Angular CLI. This guide is for zoneless apps, which new Angular apps are.",
    BROWSER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add the OpenTelemetry browser packages, with the `web-vitals` library, to the Angular app:",
    snippets: [install],
    notes: [
      "The guide does not use `@opentelemetry/context-zone`: a zoneless app has no zone.js, and the stack context manager is enough.",
    ],
  },

  configure: {
    intro:
      "The app sends from the browser, so the endpoint and a Browser key are constants in the telemetry file. The key is safe in the bundle: it only works from its Allowed Origins.",
    tabs: browserEndpointTabs(),
    notes: [
      "For a key per environment, keep it in `src/environments/` and import it, as Angular's environment files do for other settings.",
    ],
  },

  setup: {
    intro:
      "The browser SDK first, then Angular's errors and navigations, all registered in `app.config.ts`.",
    steps: [
      {
        title: "Create the telemetry file",
        body: "Put it in `src/`, beside `main.ts`. Its resource's `browser.*` attributes make OneUptime file the app's traces, logs and metrics as Real User Monitoring:",
        snippets: [telemetry],
      },
      {
        title: "Record the Core Web Vitals",
        body: "The `web-vitals` library measures them, and this records each on the histogram the **Core Web Vitals** card looks for:",
        snippets: [webVitals],
      },
      {
        title: "Import them before Angular",
        body: "In `main.ts`, the two imports come before `bootstrapApplication`, so `fetch` is instrumented before Angular calls it:",
        snippets: [main],
      },
      {
        title: "Record the errors Angular handles",
        body: "Angular hands every error from a template, a lifecycle hook or an event handler to its `ErrorHandler`. This one records each on a span:",
        snippets: [errorHandler],
      },
      {
        title: "Trace navigations",
        body: "The router changes the view without loading a page. This makes a span for each navigation, named after the route that matched:",
        snippets: [navigationSpans],
      },
      {
        title: "Register them in the app config",
        body: "Provide the error handler, the navigation spans, and `HttpClient` through `fetch`:",
        snippets: [appConfig],
        notes: [
          "`provideBrowserGlobalErrorListeners()` is in new apps' config already. It sends the window's uncaught errors and unhandled rejections to the `ErrorHandler`, so no window listeners of your own are needed.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro: "`getWebAutoInstrumentations()` records these with no code:",
    rows: [
      {
        library: "Document load",
        covers:
          "The first page load, with the document's and each script's timings.",
      },
      {
        library: "`fetch`",
        covers:
          "Every `HttpClient` call made with `withFetch()`, as a client span with its URL and status code.",
      },
      {
        library: "`XMLHttpRequest`",
        covers:
          "`HttpClient` calls without `withFetch()`, which go through XHR.",
      },
      {
        library: "User interaction",
        covers: "A `click` span per click, with the element's XPath.",
      },
    ],
    snippets: [],
    notes: [
      "A call to another origin carries the `traceparent` header only if it is in `propagateTraceHeaderCorsUrls`, and the API there must allow the header.",
    ],
  },

  manualSpans: {
    intro:
      "Start a span where the visitor acts. `HttpClient` sends when you subscribe, so a request subscribed to inside the span nests under it:",
    snippets: [manualSpan],
    notes: [
      "The response arrives after the span's callback has returned, when the span is no longer current: keep `context.active()` from the callback, and pass it to what runs then.",
      "End the span in both `error` and `complete`, so a failed request does not leave it open.",
    ],
  },

  logs: {
    intro:
      "Emit records through the Logs API, as `AddToCart` does: each carries the trace of the context you pass.",
    snippets: [],
    notes: [
      "`console.error` and Angular's own console output are not sent: only what you emit is.",
      "The SDK sends records in batches, and sends what it holds when the tab is hidden.",
    ],
  },

  metrics: {
    intro:
      "Five histograms carry the Core Web Vitals. Your own counters and histograms go beside them:",
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
      "For INP per route in a single-page app, see [Single-page apps](/docs/rum/web-vitals#single-page-apps).",
    ],
  },

  sampling: {
    intro:
      "By default every visit is traced. A sampler on the `TracerProvider` keeps a share:",
    snippets: [
      {
        id: "sampling",
        language: "typescript",
        title: "src/telemetry.ts",
        code: [
          'import { ParentBasedSampler, TraceIdRatioBasedSampler } from "@opentelemetry/sdk-trace";',
          "",
          "// One visit in ten, beside `resource` in the provider's options.",
          "const sampler = new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.1) });",
        ].join("\n"),
        check: "parse",
      },
    ],
    notes: [
      "The `angular.error` spans are sampled like the rest: with one visit in ten kept, Exceptions sees about one error in ten.",
    ],
  },

  deploy: {
    intro:
      "The SDK ships in the bundle `ng build` makes. Before the release, allow OneUptime in your Content Security Policy:",
    snippets: [csp],
    notes: [
      "Every origin the app is served from, staging included, must be in the Browser key's **Allowed Origins**.",
      "Production builds are minified: see [Source maps](/docs/telemetry/source-maps) for readable stack traces.",
    ],
  },

  verify: {
    intro: "Each step rules out one cause.",
    steps: [
      validateKeyStep("browser"),
      {
        title: "Find the application",
        body: `Open the app, navigate once, and open ${SCREENS.rum}: \`storefront-angular\` is listed within a minute.`,
      },
      {
        title: "See the navigations",
        body: `In ${SCREENS.traces}, search \`@app.route:/products/:id\`: each visit to a product page is a \`navigation\` span.`,
      },
      {
        title: "Throw on purpose",
        body: `Throw from a click handler: ${SCREENS.exceptions} lists it as an \`angular.error\` span's exception.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Errors show in the console, but not under Exceptions",
      answer:
        "The `ErrorHandler` is not the one in the app config, or a library's provider replaced it. Provide `TelemetryErrorHandler` in `appConfig`, after anything else that provides `ErrorHandler`.",
    },
    {
      question: "HttpClient calls have no spans",
      answer:
        'The telemetry file was imported after Angular, which then called the unpatched `fetch`. Keep `import "./telemetry"` the first line of `main.ts`.',
    },
    {
      question: "Every product page has its own route",
      answer:
        "The span was named with the URL. `routePattern` joins the matched routes' paths, so `/products/42` and `/products/43` are both `/products/:id`.",
    },
    {
      question: "Logs arrive without a trace",
      answer:
        "They were emitted after the span's callback had returned, with no context: keep `context.active()` inside the callback and pass it as the record's `context`, as `AddToCart` does.",
    },
    {
      question: "OneUptime answers 422",
      answer:
        "OneUptime refused the origin the app was served from. Add it, exactly, with its scheme and any port, to the Browser key's **Allowed Origins**.",
    },
  ],

  faq: [
    {
      question: "Does it work with server-side rendering?",
      answer:
        "This guide covers the browser. The telemetry file uses the browser's `document` and `window`, so import it only in the browser build, not in `server.ts`.",
    },
    {
      question: "Why an ErrorHandler and not window listeners?",
      answer:
        "Angular catches the errors in templates and event handlers itself and hands them to the `ErrorHandler`; they never reach the window. With the global listeners provided, the window's errors go there too, so each error is recorded once.",
    },
    {
      question: "Does it work with NgRx or signals?",
      answer:
        "Yes. Spans and logs go through the OpenTelemetry API, whatever manages your state: start a span in an effect or a method, as `AddToCart` does.",
    },
    {
      question: "Is the key safe in my bundle?",
      answer:
        "A **Browser** key is made for it: OneUptime accepts it only from its Allowed Origins, and you can switch it off at once. A **Server** key never belongs in a bundle.",
    },
  ],

  related: ["browser", "react", "nodejs", "express"],
  docs: [
    DOCS.browserSetup,
    DOCS.webVitals,
    DOCS.sessionReplay,
    DOCS.sourceMaps,
  ],

  verification: {
    runtime: "browser",
    framework: { name: "Angular", package: "@angular/core" },
    files: [
      {
        path: "package.json",
        content:
          '{ "name": "storefront-angular", "private": true, "type": "module" }',
      },
      { path: "angular.json", content: angularJson },
      { path: "tsconfig.json", content: tsconfig },
      { path: "tsconfig.app.json", content: tsconfigApp },
      { path: "src/index.html", content: indexHtml },
      { path: "src/telemetry.ts", snippet: "telemetry" },
      { path: "src/web-vitals.ts", snippet: "web-vitals" },
      { path: "src/main.ts", snippet: "main" },
      { path: "src/app/telemetry-error-handler.ts", snippet: "error-handler" },
      { path: "src/app/navigation-spans.ts", snippet: "navigation-spans" },
      { path: "src/app/app.config.ts", snippet: "app-config" },
      { path: "src/app/add-to-cart.ts", snippet: "manual-span" },
      { path: "src/app/app.ts", content: appTs },
      { path: "src/app/app.routes.ts", content: routesTs },
    ],
    commands: [
      { snippet: "install" },
      {
        command:
          "npm install @angular/core@22.2.3 @angular/common@22.2.3 @angular/compiler@22.2.3 @angular/platform-browser@22.2.3 @angular/router@22.2.3 rxjs@7.8.2 tslib@2.8.1 @angular/build@22.2.4 @angular/cli@22.2.4 @angular/compiler-cli@22.2.3 typescript@6.0.3",
      },
      { command: "NG_CLI_ANALYTICS=false npx ng build" },
    ],
    serve: "dist/storefront/browser",
    port: 3100,
    requests: [],
    clicks: ["#to-product", "#add-to-cart", "#break", "#reject"],
    expect: {
      spans: [
        { name: "documentLoad" },
        { name: "navigation", attributes: { "app.route": "/" } },
        { name: "navigation", attributes: { "app.route": "/products/:id" } },
        { name: "cart.add", attributes: { "product.id": "42" } },
        { name: "POST", attributes: { "http.response.status_code": "200" } },
        {
          name: "angular.error",
          exceptionMessage: "Cart total could not be computed",
        },
        // An unhandled rejection, through provideBrowserGlobalErrorListeners.
        {
          name: "angular.error",
          exceptionMessage: "Coupon service unavailable",
        },
      ],
      metrics: ["web_vital.lcp", "web_vital.fcp", "web_vital.ttfb"],
      logs: [{ body: "added to cart", hasTraceContext: true }],
      resource: { "service.name": "storefront-angular" },
    },
  },
};
