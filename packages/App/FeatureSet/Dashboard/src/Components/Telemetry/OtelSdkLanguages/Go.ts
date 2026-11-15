import {
  CodeSnippet,
  OtelLanguageSnippets,
  OtelSignals,
  lines,
} from "./Shared";

/*
 * Go: a whole main.go that `go run .` runs as it is, with a provider and
 * an OTLP/HTTP exporter for each signal asked for, and the `go get` of
 * exactly the modules it imports.
 *
 * Checked end to end with Go 1.27.3 (golang:1.27.3-trixie) and the
 * versions below: each variant passed go vet, and its run posted its
 * signals to a stand-in for /otlp/v1/<signal> (200) and nothing else.
 *
 * - WithEndpointURL is posted to as written ("The path of the provided URL
 *   is used as-is": otlptracehttp, otlpmetrichttp v1.47.0 and otlploghttp
 *   v0.23.0, options.go), and an https URL gets TLS.
 * - Logs: the log/slog records of the program, through the otelslog
 *   bridge, once it is slog's default. Writes to stdout (fmt.Println) are
 *   not sent.
 * - The deferred Shutdowns send what is still buffered as main returns.
 * - The resource names the service without a semconv import, whose
 *   schema URL would have to match the SDK's own.
 *
 * Before (issue #7927) Go's snippet set up traces only, on every guide,
 * and its install step pulled otlpmetrichttp and otlploghttp, which its
 * code never used.
 */

export const GO_MODULE_VERSIONS: Readonly<Record<string, string>> = {
  "go.opentelemetry.io/otel": "v1.47.0",
  "go.opentelemetry.io/otel/sdk": "v1.47.0",
  "go.opentelemetry.io/otel/sdk/metric": "v1.47.0",
  "go.opentelemetry.io/otel/sdk/log": "v1.47.0",
  "go.opentelemetry.io/otel/log": "v1.47.0",
  "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp": "v1.47.0",
  "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp":
    "v1.47.0",
  "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp": "v0.23.0",
  "go.opentelemetry.io/contrib/bridges/otelslog": "v0.21.0",
};

const pinned: (module: string) => string = (module: string): string => {
  const version: string | undefined = GO_MODULE_VERSIONS[module];

  if (!version) {
    throw new Error(`No pinned version for ${module}`);
  }

  return `${module}@${version}`;
};

const install: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  const modules: Array<string> = [
    "go.opentelemetry.io/otel",
    "go.opentelemetry.io/otel/sdk",
    ...(signals.traces
      ? ["go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"]
      : []),
    ...(signals.metrics
      ? [
          "go.opentelemetry.io/otel/sdk/metric",
          "go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp",
        ]
      : []),
    ...(signals.logs
      ? [
          "go.opentelemetry.io/otel/sdk/log",
          "go.opentelemetry.io/otel/log",
          "go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp",
          "go.opentelemetry.io/contrib/bridges/otelslog",
        ]
      : []),
  ];

  return {
    code: lines(
      "go mod init my-service  # in a new folder; skip it in your own module",
      `go get ${modules.map(pinned).join(" \\\n  ")}`,
    ),
    language: "bash",
  };
};

const config: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  // The span's context goes on to what the example does inside it.
  const inSpan: boolean = signals.traces && (signals.metrics || signals.logs);

  return {
    code: lines(
      "// main.go - go run .",
      "package main",
      "",
      "import (",
      '\t"context"',
      '\t"log"',
      signals.logs && '\t"log/slog"',
      "",
      signals.logs && '\t"go.opentelemetry.io/contrib/bridges/otelslog"',
      (signals.traces || signals.metrics) && '\t"go.opentelemetry.io/otel"',
      '\t"go.opentelemetry.io/otel/attribute"',
      signals.logs &&
        '\t"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"',
      signals.metrics &&
        '\t"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"',
      signals.traces &&
        '\t"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"',
      signals.logs && '\t"go.opentelemetry.io/otel/log/global"',
      signals.logs && '\tsdklog "go.opentelemetry.io/otel/sdk/log"',
      signals.metrics && '\tsdkmetric "go.opentelemetry.io/otel/sdk/metric"',
      '\t"go.opentelemetry.io/otel/sdk/resource"',
      signals.traces && '\tsdktrace "go.opentelemetry.io/otel/sdk/trace"',
      ")",
      "",
      "func main() {",
      "\tctx := context.Background()",
      '\theaders := map[string]string{"x-oneuptime-token": "<YOUR_ONEUPTIME_TOKEN>"}',
      '\tres := resource.NewSchemaless(attribute.String("service.name", "my-service"))',
      signals.traces && [
        "",
        "\ttraceExporter, err := otlptracehttp.New(ctx,",
        '\t\totlptracehttp.WithEndpointURL("<YOUR_ONEUPTIME_URL>/v1/traces"),',
        "\t\totlptracehttp.WithHeaders(headers),",
        "\t)",
        "\tif err != nil {",
        "\t\tlog.Fatal(err)",
        "\t}",
        "\ttracerProvider := sdktrace.NewTracerProvider(",
        "\t\tsdktrace.WithBatcher(traceExporter),",
        "\t\tsdktrace.WithResource(res),",
        "\t)",
        "\tdefer tracerProvider.Shutdown(ctx)",
        "\totel.SetTracerProvider(tracerProvider)",
      ],
      signals.metrics && [
        "",
        "\tmetricExporter, err := otlpmetrichttp.New(ctx,",
        '\t\totlpmetrichttp.WithEndpointURL("<YOUR_ONEUPTIME_URL>/v1/metrics"),',
        "\t\totlpmetrichttp.WithHeaders(headers),",
        "\t)",
        "\tif err != nil {",
        "\t\tlog.Fatal(err)",
        "\t}",
        "\tmeterProvider := sdkmetric.NewMeterProvider(",
        "\t\tsdkmetric.WithReader(sdkmetric.NewPeriodicReader(metricExporter)),",
        "\t\tsdkmetric.WithResource(res),",
        "\t)",
        "\tdefer meterProvider.Shutdown(ctx)",
        "\totel.SetMeterProvider(meterProvider)",
      ],
      signals.logs && [
        "",
        "\tlogExporter, err := otlploghttp.New(ctx,",
        '\t\totlploghttp.WithEndpointURL("<YOUR_ONEUPTIME_URL>/v1/logs"),',
        "\t\totlploghttp.WithHeaders(headers),",
        "\t)",
        "\tif err != nil {",
        "\t\tlog.Fatal(err)",
        "\t}",
        "\tloggerProvider := sdklog.NewLoggerProvider(",
        "\t\tsdklog.WithProcessor(sdklog.NewBatchProcessor(logExporter)),",
        "\t\tsdklog.WithResource(res),",
        "\t)",
        "\tdefer loggerProvider.Shutdown(ctx)",
        "\tglobal.SetLoggerProvider(loggerProvider)",
        "\t// slog's records are sent from here on; fmt.Println output is not.",
        '\tslog.SetDefault(otelslog.NewLogger("my-service"))',
      ],
      "",
      "\t// Your app. A first item to see it arrive:",
      signals.traces &&
        (inSpan
          ? '\tctx, span := otel.Tracer("my-service").Start(ctx, "checkout")'
          : '\t_, span := otel.Tracer("my-service").Start(ctx, "checkout")'),
      signals.logs && '\tslog.InfoContext(ctx, "Hello, OneUptime")',
      signals.metrics && [
        '\torders, err := otel.Meter("my-service").Int64Counter("orders.placed")',
        "\tif err != nil {",
        "\t\tlog.Fatal(err)",
        "\t}",
        "\torders.Add(ctx, 1)",
      ],
      signals.traces && "\tspan.End()",
      "",
      "\t// The deferred Shutdowns send what is still buffered as main returns.",
      "}",
    ),
    language: "go",
  };
};

const GoSnippets: OtelLanguageSnippets = {
  install: install,
  config: config,
};

export default GoSnippets;
