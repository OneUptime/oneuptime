import {
  CodeSnippet,
  OtelLanguageSnippets,
  OtelSignals,
  lines,
} from "./Shared";

/*
 * Node.js: one file, loaded before the app with `node --import`, that
 * starts the SDK with the exporters of the signals asked for.
 *
 * Checked end to end on Node.js 26.13 with the versions below: each
 * variant, loaded before an ES module app and a CommonJS one, posted its
 * signals to a stand-in for /otlp/v1/<signal> (200) and nothing else.
 *
 * Before (issue #7469) the file was tracing.ts, run with `node --require`,
 * which loads CommonJS and stopped at its first import; and its log
 * processor was given the exporter as its options, as SDK 2.x took it, so
 * with today's 3.x it had no exporter and sent nothing, silently.
 *
 * NodeSDK sends a signal it is given no exporter for to localhost:4318
 * (OTEL_EXPORTER_OTLP_ENDPOINT's default), so a snippet for one signal
 * gives the others none, with an empty list.
 */

// The versions the snippets were checked with: OpenTelemetry JS 3.1.
export const NODE_PACKAGE_VERSIONS: Readonly<Record<string, string>> = {
  "@opentelemetry/api": "1.10.0",
  "@opentelemetry/sdk-node": "0.301.2",
  "@opentelemetry/auto-instrumentations-node": "0.83.1",
  "@opentelemetry/instrumentation": "0.301.2",
  "@opentelemetry/exporter-trace-otlp-proto": "0.301.2",
  "@opentelemetry/exporter-metrics-otlp-proto": "0.301.2",
  "@opentelemetry/exporter-logs-otlp-proto": "0.301.2",
  "@opentelemetry/sdk-metrics": "3.1.1",
  "@opentelemetry/sdk-logs": "3.1.1",
};

const pinned: (name: string) => string = (name: string): string => {
  const version: string | undefined = NODE_PACKAGE_VERSIONS[name];

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
    "@opentelemetry/sdk-node",
    "@opentelemetry/auto-instrumentations-node",
    "@opentelemetry/instrumentation",
    ...(signals.traces ? ["@opentelemetry/exporter-trace-otlp-proto"] : []),
    ...(signals.metrics
      ? [
          "@opentelemetry/exporter-metrics-otlp-proto",
          "@opentelemetry/sdk-metrics",
        ]
      : []),
    ...(signals.logs
      ? ["@opentelemetry/exporter-logs-otlp-proto", "@opentelemetry/sdk-logs"]
      : []),
  ];

  return {
    code: lines(
      "# Node.js 22.15 or later",
      `npm install ${packages.map(pinned).join(" \\\n  ")}`,
    ),
    language: "bash",
  };
};

const config: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  return {
    code: lines(
      "// instrumentation.mjs - load it before your app:",
      "//   node --import ./instrumentation.mjs app.js",
      "import { register } from 'node:module';",
      "import { NodeSDK } from '@opentelemetry/sdk-node';",
      "import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';",
      signals.traces &&
        "import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';",
      signals.metrics && [
        "import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';",
        "import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';",
      ],
      signals.logs && [
        "import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';",
        "import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';",
      ],
      "",
      "// Lets the instrumentations patch the packages your ES modules import",
      "// (Node.js 26 warns that register() is deprecated; it still works).",
      "register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);",
      "",
      "const headers = { 'x-oneuptime-token': '<YOUR_ONEUPTIME_TOKEN>' };",
      "",
      "const sdk = new NodeSDK({",
      "  serviceName: 'my-service',",
      signals.traces
        ? [
            "  traceExporter: new OTLPTraceExporter({",
            "    url: '<YOUR_ONEUPTIME_URL>/v1/traces',",
            "    headers,",
            "  }),",
          ]
        : [
            "  // No traces: NodeSDK would send them to localhost:4318.",
            "  spanProcessors: [],",
          ],
      signals.metrics
        ? [
            "  metricReaders: [",
            "    new PeriodicExportingMetricReader({",
            "      exporter: new OTLPMetricExporter({",
            "        url: '<YOUR_ONEUPTIME_URL>/v1/metrics',",
            "        headers,",
            "      }),",
            "    }),",
            "  ],",
          ]
        : [
            "  // No metrics: NodeSDK would send them to localhost:4318.",
            "  metricReaders: [],",
          ],
      signals.logs
        ? [
            "  logRecordProcessors: [",
            "    new BatchLogRecordProcessor({",
            "      exporter: new OTLPLogExporter({",
            "        url: '<YOUR_ONEUPTIME_URL>/v1/logs',",
            "        headers,",
            "      }),",
            "    }),",
            "  ],",
          ]
        : [
            "  // No logs: NodeSDK would send them to localhost:4318.",
            "  logRecordProcessors: [],",
          ],
      "  instrumentations: [getNodeAutoInstrumentations()],",
      "});",
      "",
      "sdk.start();",
      "",
      "// Send what is still buffered when a script ends, or on Ctrl+C or SIGTERM.",
      "let stopping;",
      "const stop = () => (stopping ??= sdk.shutdown());",
      "process.once('beforeExit', stop);",
      "for (const signal of ['SIGINT', 'SIGTERM']) {",
      "  process.on(signal, async () => {",
      "    await stop();",
      "    // Unless your app handles the signal too: then it decides when to exit.",
      "    if (process.listenerCount(signal) === 1) process.exit(0);",
      "  });",
      "}",
      signals.traces && [
        "",
        "// Requests to and from your app, and its database calls, are traced as",
        "// they are. A span of your own:",
        "//   import { trace } from '@opentelemetry/api';",
        "//   trace.getTracer('my-service').startActiveSpan('checkout', (span) => span.end());",
      ],
      signals.metrics && [
        "",
        "// HTTP request durations are measured as they are, and sent every minute.",
        "// A counter of your own:",
        "//   import { metrics } from '@opentelemetry/api';",
        "//   metrics.getMeter('my-service').createCounter('orders.placed').add(1);",
      ],
      signals.logs && [
        "",
        "// What pino, winston and bunyan write is sent. console.log lines are not:",
        "// write those with a logger, or with the Logs API:",
        "//   import { logs, SeverityNumber } from '@opentelemetry/api';",
        "//   logs.getLogger('my-service').emit({",
        "//     severityNumber: SeverityNumber.INFO,",
        "//     body: 'Hello, OneUptime',",
        "//   });",
      ],
    ),
    language: "javascript",
  };
};

const NodeSnippets: OtelLanguageSnippets = {
  install: install,
  config: config,
};

export default NodeSnippets;
