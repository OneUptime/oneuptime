import {
  BROWSER_KEY_PLACEHOLDER,
  CLOUD_OTLP_ENDPOINT,
  INGESTION_KEY_HEADER,
  SELF_HOSTED_OTLP_ENDPOINT,
} from "./GuideShared";
import { GuideSnippet, GuideTabs } from "./GuideTypes";
import { npmInstallSnippet } from "./JavaScriptShared";

/*
 * What the browser guides share: the packages, the telemetry file every
 * browser app imports first, the Core Web Vitals file and the error
 * listeners. Each guide (Browser, React, Angular) writes its framework's
 * words around them.
 *
 * The facts are OneUptime's RUM ones (docs/rum/browser-setup and
 * docs/rum/web-vitals): a Browser ingestion key, which works only from its
 * Allowed Origins; browser.* resource attributes, which file the telemetry
 * under Real User Monitoring; and the web_vital.* histograms the Core Web
 * Vitals card reads. The SDK is OpenTelemetry JS 3.0: TracerProvider from
 * @opentelemetry/sdk-trace (sdk-trace-web stops at 2.x), processors that
 * take an options object, and the Logs API in @opentelemetry/api.
 */

export const BROWSER_PACKAGES: Array<string> = [
  "@opentelemetry/api",
  "@opentelemetry/sdk-trace",
  "@opentelemetry/sdk-logs",
  "@opentelemetry/sdk-metrics",
  "@opentelemetry/core",
  "@opentelemetry/resources",
  "@opentelemetry/exporter-trace-otlp-http",
  "@opentelemetry/exporter-logs-otlp-http",
  "@opentelemetry/exporter-metrics-otlp-http",
  "@opentelemetry/instrumentation",
  "@opentelemetry/auto-instrumentations-web",
  "@opentelemetry/opentelemetry-browser-detector",
];

export function browserInstallSnippet(
  extraPackages: Array<string>,
): GuideSnippet {
  return npmInstallSnippet("install", [...BROWSER_PACKAGES, ...extraPackages]);
}

export interface BrowserTelemetryOptions {
  // The RUM application's name: "storefront-web".
  serviceName: string;
  // Options for getWebAutoInstrumentations, one line each, after the fetch ones.
  autoInstrumentationLines?: Array<string> | undefined;
}

// The origin of the API the example page calls, which gets the traceparent header.
export const EXAMPLE_API_PATTERN: string =
  "/^https:\\/\\/api\\.example\\.com\\//";

/*
 * src/telemetry.ts: traces, logs and metrics to OneUptime with a Browser
 * key, under one resource whose browser.* attributes file it all as RUM.
 *
 * The context manager is the stack one, with no zone.js: zone.js cannot
 * follow a native await either, and it keeps its own promises' rejections
 * from the window's unhandledrejection listeners, so the errors file would
 * miss them. The guides pass a span's context on across an await instead.
 */
export function browserTelemetryFile(options: BrowserTelemetryOptions): string {
  return [
    'import { context, logs, metrics, propagation, trace } from "@opentelemetry/api";',
    'import { W3CTraceContextPropagator } from "@opentelemetry/core";',
    'import { BatchSpanProcessor, StackContextManager, TracerProvider } from "@opentelemetry/sdk-trace";',
    'import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";',
    'import { MeterProvider, PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";',
    'import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";',
    'import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";',
    'import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";',
    'import { registerInstrumentations } from "@opentelemetry/instrumentation";',
    'import { getWebAutoInstrumentations } from "@opentelemetry/auto-instrumentations-web";',
    'import { defaultResource, detectResources, resourceFromAttributes } from "@opentelemetry/resources";',
    'import { browserDetector } from "@opentelemetry/opentelemetry-browser-detector";',
    "",
    `const ONEUPTIME_OTLP_URL = "${CLOUD_OTLP_ENDPOINT}";`,
    "// A Browser key: it ships in your page, so it only works from its Allowed Origins.",
    `const ONEUPTIME_BROWSER_KEY = "${BROWSER_KEY_PLACEHOLDER}";`,
    `const headers = { "${INGESTION_KEY_HEADER}": ONEUPTIME_BROWSER_KEY };`,
    "",
    "// The browser.* attributes file everything below under Real User Monitoring.",
    "const resource = defaultResource()",
    "  .merge(detectResources({ detectors: [browserDetector] }))",
    `  .merge(resourceFromAttributes({ "service.name": "${options.serviceName}" }));`,
    "",
    "trace.setGlobalTracerProvider(",
    "  new TracerProvider({",
    "    resource,",
    "    spanProcessors: [",
    "      new BatchSpanProcessor({",
    "        exporter: new OTLPTraceExporter({ url: `${ONEUPTIME_OTLP_URL}/v1/traces`, headers }),",
    "      }),",
    "    ],",
    "  }),",
    ");",
    "",
    "logs.setGlobalLoggerProvider(",
    "  new LoggerProvider({",
    "    resource,",
    "    processors: [",
    "      new BatchLogRecordProcessor({",
    "        exporter: new OTLPLogExporter({ url: `${ONEUPTIME_OTLP_URL}/v1/logs`, headers }),",
    "      }),",
    "    ],",
    "  }),",
    ");",
    "",
    "const meterProvider = new MeterProvider({",
    "  resource,",
    "  readers: [",
    "    new PeriodicExportingMetricReader({",
    "      exporter: new OTLPMetricExporter({ url: `${ONEUPTIME_OTLP_URL}/v1/metrics`, headers }),",
    "      exportIntervalMillis: 30000,",
    "    }),",
    "  ],",
    "});",
    "metrics.setGlobalMeterProvider(meterProvider);",
    "",
    "// Spans and logs are sent when the page is hidden; metrics need asking.",
    'document.addEventListener("visibilitychange", () => {',
    '  if (document.visibilityState === "hidden") void meterProvider.forceFlush();',
    "});",
    "",
    "// A span is current while its callback runs, up to the first await.",
    "context.setGlobalContextManager(new StackContextManager().enable());",
    "propagation.setGlobalPropagator(new W3CTraceContextPropagator());",
    "",
    "// Page loads, fetch and XMLHttpRequest calls, and clicks.",
    "registerInstrumentations({",
    "  instrumentations: [",
    "    getWebAutoInstrumentations({",
    '      "@opentelemetry/instrumentation-fetch": {',
    "        // Only your own APIs: they must allow the traceparent header.",
    `        propagateTraceHeaderCorsUrls: [${EXAMPLE_API_PATTERN}],`,
    "      },",
    '      "@opentelemetry/instrumentation-xml-http-request": {',
    `        propagateTraceHeaderCorsUrls: [${EXAMPLE_API_PATTERN}],`,
    "      },",
    ...(options.autoInstrumentationLines || []).map((line: string): string => {
      return `      ${line}`;
    }),
    "    }),",
    "  ],",
    "});",
  ].join("\n");
}

// src/web-vitals.ts: the histograms OneUptime's Core Web Vitals card reads.
export const WEB_VITALS_FILE: string = [
  'import { metrics } from "@opentelemetry/api";',
  'import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";',
  "",
  'const meter = metrics.getMeter("web-vitals");',
  "",
  "// Bucket edges on Google's good and poor limits, so percentiles read true.",
  "const buckets = (...edges: number[]) => ({ advice: { explicitBucketBoundaries: edges } });",
  "",
  "const histograms = {",
  '  LCP: meter.createHistogram("web_vital.lcp", { unit: "ms", ...buckets(0, 1000, 2000, 2500, 3000, 4000, 6000, 10000) }),',
  '  INP: meter.createHistogram("web_vital.inp", { unit: "ms", ...buckets(0, 50, 100, 200, 300, 500, 1000, 2000) }),',
  '  CLS: meter.createHistogram("web_vital.cls", { unit: "1", ...buckets(0, 0.025, 0.05, 0.1, 0.15, 0.25, 0.4, 1) }),',
  '  FCP: meter.createHistogram("web_vital.fcp", { unit: "ms", ...buckets(0, 600, 1200, 1800, 2400, 3000, 6000) }),',
  '  TTFB: meter.createHistogram("web_vital.ttfb", { unit: "ms", ...buckets(0, 200, 400, 800, 1200, 1800, 4000) }),',
  "};",
  "",
  "function record(metric: Metric): void {",
  '  histograms[metric.name].record(metric.value, { "web_vital.rating": metric.rating });',
  "}",
  "",
  "onLCP(record);",
  "onINP(record);",
  "onCLS(record);",
  "onFCP(record);",
  "onTTFB(record);",
].join("\n");

// The uncaught errors the browser SDK does not capture, as spans OneUptime lists under Exceptions.
export const ERROR_LISTENERS: string = [
  'import { SpanStatusCode, trace } from "@opentelemetry/api";',
  "",
  'const tracer = trace.getTracer("errors");',
  "",
  "function report(name: string, error: unknown): void {",
  "  const span = tracer.startSpan(name);",
  "  span.recordException(error instanceof Error ? error : new Error(String(error)));",
  "  span.setStatus({ code: SpanStatusCode.ERROR });",
  "  span.end();",
  "}",
  "",
  'window.addEventListener("error", (event) => report("window.error", event.error ?? event.message));',
  'window.addEventListener("unhandledrejection", (event) => report("unhandledrejection", event.reason));',
].join("\n");

/*
 * Where the page sends: OneUptime Cloud or a self-hosted host. The browser
 * has no environment, so the URL is a constant in the telemetry file.
 */
export function browserEndpointTabs(): GuideTabs {
  return {
    group: "deployment",
    tabs: [
      {
        label: "OneUptime Cloud",
        snippets: [
          {
            id: "endpoint-cloud",
            language: "typescript",
            title: "src/telemetry.ts",
            code: `const ONEUPTIME_OTLP_URL = "${CLOUD_OTLP_ENDPOINT}";`,
            check: "contained",
          },
        ],
        notes: [
          "Your Content Security Policy must allow it: `connect-src 'self' https://oneuptime.com`.",
        ],
      },
      {
        label: "Self-hosted",
        snippets: [
          {
            id: "endpoint-self-hosted",
            language: "typescript",
            title: "src/telemetry.ts",
            code: `const ONEUPTIME_OTLP_URL = "${SELF_HOSTED_OTLP_ENDPOINT}";`,
            check: "parse",
          },
        ],
        notes: [
          "Use your own OneUptime host, and allow it in your Content Security Policy's `connect-src`.",
        ],
      },
    ],
  };
}

// The type check the end-to-end check runs over a browser app's files.
export const BROWSER_TSCONFIG: string = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      jsx: "react-jsx",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ["src"],
  },
  null,
  2,
);
