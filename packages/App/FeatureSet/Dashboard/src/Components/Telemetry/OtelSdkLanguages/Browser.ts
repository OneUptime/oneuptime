import {
  CodeSnippet,
  OtelLanguageSnippets,
  OtelSignals,
  lines,
} from "./Shared";

/*
 * The browser, for React and Angular: one file, src/telemetry.ts, that the
 * app imports before anything else, with a provider and an OTLP/HTTP
 * protobuf exporter for each signal asked for, and the `npm install` of
 * exactly the packages it imports.
 *
 * Checked end to end in Chromium 153 (Playwright's) with the versions
 * below: each variant, installed by its install step, bundled by esbuild
 * 0.28 with a page that runs its commented examples (and the all variants
 * built in a Vite 8 + React 19 app and in an Angular 22 CLI app, which is
 * zoneless; the Angular ones also with zone.js loaded first), served from
 * another origin, and closed or left half a second after the click, posted
 * its signals to a stand-in for /otlp/v1/<signal> (200, after a CORS
 * preflight) as the page went, and nothing else. Each passed tsc 6.0
 * (strict, DOM lib, moduleResolution bundler, verbatimModuleSyntax).
 *
 * - The url given to an exporter is posted to as written (resolved against
 *   the page's address, so an absolute one stays as it is): otlp-exporter-base
 *   0.301.2, configuration/otlp-http-configuration (validateUserProvidedUrl).
 *   An exporter given no url posts to http://localhost:4318/v1/<signal>; a
 *   signal not asked for has no provider and no exporter at all.
 * - The exporters send with fetch and keepalive (platform/browser/transport/
 *   fetch-transport), so a request started as the page goes away is still
 *   sent. The batch span and log processors send what they hold when the
 *   page is hidden, as it is when it is closed or left (visibilitychange);
 *   the metric reader does not, so the snippet asks it to (without that, a
 *   page closed within the minute sent no metrics).
 * - OpenTelemetry JS 3: TracerProvider and StackContextManager from
 *   @opentelemetry/sdk-trace (sdk-trace-web and sdk-trace-base stop at 2.x,
 *   and nothing here needs them), processors and readers given in the
 *   providers' options, an options object for each processor,
 *   resourceFromAttributes, and the Logs API in @opentelemetry/api.
 * - defaultResource() adds telemetry.sdk.language (webjs), from which
 *   OneUptime tells the service's language; a resource given to a provider
 *   replaces the default one rather than adding to it.
 * - The stack context manager: React apps have no zone.js, nor have new
 *   Angular apps since Angular 21, which are zoneless. ZoneContextManager
 *   would load zone.js into them (Angular then warns, NG0914); in an app
 *   that loads zone.js the stack one works as well.
 * - The traceparent header goes to the page's own origin only, so no other
 *   origin is asked to allow it (the old snippets sent it everywhere).
 * - OneUptime takes a log record's severity from its severityNumber, not its
 *   severityText, so the Logs API example sets the number.
 *
 * Before, these snippets set up traces only, on every guide, with
 * provider.addSpanProcessor and new Resource(), which OpenTelemetry JS 2.0
 * removed, and imported @opentelemetry/instrumentation and
 * @opentelemetry/resources, which the install step left out.
 */

// The versions the snippets were checked with: OpenTelemetry JS 3.1.
export const BROWSER_PACKAGE_VERSIONS: Readonly<Record<string, string>> = {
  "@opentelemetry/api": "1.10.0",
  "@opentelemetry/resources": "3.1.1",
  "@opentelemetry/core": "3.1.1",
  "@opentelemetry/sdk-trace": "3.1.1",
  "@opentelemetry/sdk-metrics": "3.1.1",
  "@opentelemetry/sdk-logs": "3.1.1",
  "@opentelemetry/exporter-trace-otlp-proto": "0.301.2",
  "@opentelemetry/exporter-metrics-otlp-proto": "0.301.2",
  "@opentelemetry/exporter-logs-otlp-proto": "0.301.2",
  "@opentelemetry/instrumentation": "0.301.2",
  "@opentelemetry/instrumentation-document-load": "0.70.1",
  "@opentelemetry/instrumentation-fetch": "0.301.2",
  "@opentelemetry/instrumentation-xml-http-request": "0.301.2",
};

export interface BrowserAppOptions {
  // The service name the guide replaces: "my-react-app".
  serviceName: string;
  // The first lines: the file, and where the app imports it.
  intro: Array<string>;
  // What the instrumentations trace, in the app's words: one comment line.
  traced: string;
}

const pinned: (name: string) => string = (name: string): string => {
  const version: string | undefined = BROWSER_PACKAGE_VERSIONS[name];

  if (!version) {
    throw new Error(`No pinned version for ${name}`);
  }

  return `${name}@${version}`;
};

const install: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  const packages: Array<string> = [
    "@opentelemetry/api",
    "@opentelemetry/resources",
    ...(signals.traces
      ? [
          "@opentelemetry/core",
          "@opentelemetry/sdk-trace",
          "@opentelemetry/exporter-trace-otlp-proto",
          "@opentelemetry/instrumentation",
          "@opentelemetry/instrumentation-document-load",
          "@opentelemetry/instrumentation-fetch",
          "@opentelemetry/instrumentation-xml-http-request",
        ]
      : []),
    ...(signals.metrics
      ? [
          "@opentelemetry/sdk-metrics",
          "@opentelemetry/exporter-metrics-otlp-proto",
        ]
      : []),
    ...(signals.logs
      ? ["@opentelemetry/sdk-logs", "@opentelemetry/exporter-logs-otlp-proto"]
      : []),
  ];

  return {
    code: `npm install ${packages.map(pinned).join(" \\\n  ")}`,
    language: "bash",
  };
};

export function browserSnippets(
  options: BrowserAppOptions,
): OtelLanguageSnippets {
  const name: string = options.serviceName;

  const config: (signals: OtelSignals) => CodeSnippet = (
    signals: OtelSignals,
  ): CodeSnippet => {
    const apiNames: Array<string> = [
      ...(signals.traces ? ["context", "propagation", "trace"] : []),
      ...(signals.metrics ? ["metrics"] : []),
      ...(signals.logs ? ["logs"] : []),
    ].sort();

    return {
      code: lines(
        options.intro,
        `import { ${apiNames.join(", ")} } from '@opentelemetry/api';`,
        "import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';",
        signals.traces && [
          "import { W3CTraceContextPropagator } from '@opentelemetry/core';",
          "import { BatchSpanProcessor, StackContextManager, TracerProvider } from '@opentelemetry/sdk-trace';",
          "import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';",
          "import { registerInstrumentations } from '@opentelemetry/instrumentation';",
          "import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';",
          "import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';",
          "import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';",
        ],
        signals.metrics && [
          "import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';",
          "import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';",
        ],
        signals.logs && [
          "import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';",
          "import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';",
        ],
        "",
        "// This file is served to your users, so this token is public.",
        "// It must be a Browser ingestion key, never a Server one.",
        "const headers = { 'x-oneuptime-token': '<YOUR_ONEUPTIME_TOKEN>' };",
        "",
        "const resource = defaultResource().merge(",
        `  resourceFromAttributes({ 'service.name': '${name}' }),`,
        ");",
        signals.traces && [
          "",
          "trace.setGlobalTracerProvider(",
          "  new TracerProvider({",
          "    resource,",
          "    spanProcessors: [",
          "      // Sends every 5 seconds, and when the page is hidden or closed.",
          "      new BatchSpanProcessor({",
          "        exporter: new OTLPTraceExporter({",
          "          url: '<YOUR_ONEUPTIME_URL>/v1/traces',",
          "          headers,",
          "        }),",
          "      }),",
          "    ],",
          "  }),",
          ");",
          "// A span is current while its callback runs, up to its first await, and",
          "// requests to your own origin carry it to your backend (traceparent).",
          "context.setGlobalContextManager(new StackContextManager().enable());",
          "propagation.setGlobalPropagator(new W3CTraceContextPropagator());",
          "",
          `// ${options.traced}`,
          "registerInstrumentations({",
          "  instrumentations: [",
          "    new DocumentLoadInstrumentation(),",
          "    new FetchInstrumentation(),",
          "    new XMLHttpRequestInstrumentation(),",
          "  ],",
          "});",
        ],
        signals.metrics && [
          "",
          "const meterProvider = new MeterProvider({",
          "  resource,",
          "  readers: [",
          "    new PeriodicExportingMetricReader({",
          "      exporter: new OTLPMetricExporter({",
          "        url: '<YOUR_ONEUPTIME_URL>/v1/metrics',",
          "        headers,",
          "      }),",
          "    }),",
          "  ],",
          "});",
          "metrics.setGlobalMeterProvider(meterProvider);",
          "// Metrics are sent every minute: this sends them when the page is hidden",
          "// or closed too.",
          "document.addEventListener('visibilitychange', () => {",
          "  if (document.visibilityState === 'hidden') void meterProvider.forceFlush();",
          "});",
        ],
        signals.logs && [
          "",
          "logs.setGlobalLoggerProvider(",
          "  new LoggerProvider({",
          "    resource,",
          "    processors: [",
          "      // Sends every second, and when the page is hidden or closed.",
          "      new BatchLogRecordProcessor({",
          "        exporter: new OTLPLogExporter({",
          "          url: '<YOUR_ONEUPTIME_URL>/v1/logs',",
          "          headers,",
          "        }),",
          "      }),",
          "    ],",
          "  }),",
          ");",
        ],
        signals.traces && [
          "",
          "// A span of your own:",
          "//   import { trace } from '@opentelemetry/api';",
          `//   trace.getTracer('${name}').startActiveSpan('checkout', (span) => span.end());`,
        ],
        signals.metrics && [
          "",
          "// A counter of your own:",
          "//   import { metrics } from '@opentelemetry/api';",
          `//   metrics.getMeter('${name}').createCounter('orders.placed').add(1);`,
        ],
        signals.logs && [
          "",
          "// console.log lines are not sent: write records with the Logs API:",
          "//   import { logs, SeverityNumber } from '@opentelemetry/api';",
          `//   logs.getLogger('${name}').emit({`,
          "//     severityNumber: SeverityNumber.INFO,",
          "//     body: 'Hello, OneUptime',",
          "//   });",
        ],
      ),
      language: "typescript",
    };
  };

  return {
    install: install,
    config: config,
  };
}
