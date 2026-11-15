import {
  CodeSnippet,
  OtelLanguageSnippets,
  OtelSignals,
  lines,
} from "./Shared";

/*
 * Swift: a whole main.swift with a provider and an OTLP/HTTP exporter for
 * each signal asked for, and the Package.swift lines it needs.
 *
 * Checked end to end with Swift 6.3 on Linux (swift:6.3) and the versions
 * below: each variant built, and its run posted its signals to a stand-in
 * for /otlp/v1/<signal> (200) and nothing else.
 *
 * - Since 2.x the API and the SDK are their own package,
 *   opentelemetry-swift-core; opentelemetry-swift has the exporters, all
 *   three OTLP/HTTP ones in the product OpenTelemetryProtocolExporterHTTP
 *   (module OpenTelemetryProtocolExporterHttp). The product the snippet
 *   named before, OtlpHttpSpanExporting, does not exist, and its
 *   OtlpHttpSpanExporter is now OtlpHttpTraceExporter.
 * - An exporter's endpoint is the signal's whole URL, posted to as
 *   written (OtlpHttpExporterBase.createRequest, opentelemetry-swift 2.6.0).
 * - The metric reader exports every second unless told otherwise; the
 *   snippet makes it a minute. And the SDK keeps no measurement that no
 *   registered view selects: the default views it makes are never looked
 *   up (ViewRegistry.findViews, opentelemetry-swift-core 2.6.0), so
 *   without the catch-all view nothing is ever sent.
 * - Logs: records written with the Logs API's logger; print is not sent.
 * - Each exporter waits for its request to finish, so shutting the
 *   providers down at the end of main sends what is still buffered (the
 *   logger provider has no shutdown in 2.6.0: its processor's does it; the
 *   meter provider's shutdown stops its reader without a last export
 *   (PeriodicMetricReaderSdk.shutdown), so a forceFlush comes first).
 *
 * Before (issue #7927) Swift's snippet set up traces only, on every guide.
 */

export const OPENTELEMETRY_SWIFT_VERSION: string = "2.6.0";

const install: (signals: OtelSignals) => CodeSnippet = (): CodeSnippet => {
  return {
    code: lines(
      "// Package.swift, in the package's dependencies:",
      `.package(url: "https://github.com/open-telemetry/opentelemetry-swift-core.git", from: "${OPENTELEMETRY_SWIFT_VERSION}"),`,
      `.package(url: "https://github.com/open-telemetry/opentelemetry-swift.git", from: "${OPENTELEMETRY_SWIFT_VERSION}"),`,
      "",
      "// And in your target's dependencies:",
      '.product(name: "OpenTelemetryApi", package: "opentelemetry-swift-core"),',
      '.product(name: "OpenTelemetrySdk", package: "opentelemetry-swift-core"),',
      '.product(name: "OpenTelemetryProtocolExporterHTTP", package: "opentelemetry-swift"),',
    ),
    language: "swift",
  };
};

const config: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  return {
    code: lines(
      "// Sources/MyService/main.swift, in place of the @main file - swift run",
      "import Foundation",
      "import OpenTelemetryApi",
      "import OpenTelemetryProtocolExporterCommon",
      "import OpenTelemetryProtocolExporterHttp",
      "import OpenTelemetrySdk",
      "",
      'let headers = [("x-oneuptime-token", "<YOUR_ONEUPTIME_TOKEN>")]',
      'let resource = Resource(attributes: ["service.name": .string("my-service")])',
      signals.traces && [
        "",
        "let tracerProvider = TracerProviderBuilder()",
        "  .add(spanProcessor: BatchSpanProcessor(spanExporter: OtlpHttpTraceExporter(",
        '    endpoint: URL(string: "<YOUR_ONEUPTIME_URL>/v1/traces")!,',
        "    config: OtlpConfiguration(headers: headers))))",
        "  .with(resource: resource)",
        "  .build()",
        "OpenTelemetry.registerTracerProvider(tracerProvider: tracerProvider)",
      ],
      signals.metrics && [
        "",
        "let meterProvider = MeterProviderSdk.builder()",
        "  .setResource(resource: resource)",
        "  .registerMetricReader(reader: PeriodicMetricReaderBuilder(exporter: OtlpHttpMetricExporter(",
        '    endpoint: URL(string: "<YOUR_ONEUPTIME_URL>/v1/metrics")!,',
        "    config: OtlpConfiguration(headers: headers)))",
        "    .setInterval(timeInterval: 60)",
        "    .build())",
        "  // Every instrument: the SDK keeps only what a view selects.",
        "  .registerView(",
        '    selector: InstrumentSelector.builder().setInstrument(name: ".*").build(),',
        "    view: View.builder().build())",
        "  .build()",
        "OpenTelemetry.registerMeterProvider(meterProvider: meterProvider)",
      ],
      signals.logs && [
        "",
        "let logProcessor = BatchLogRecordProcessor(logRecordExporter: OtlpHttpLogExporter(",
        '  endpoint: URL(string: "<YOUR_ONEUPTIME_URL>/v1/logs")!,',
        "  config: OtlpConfiguration(headers: headers)))",
        "OpenTelemetry.registerLoggerProvider(loggerProvider: LoggerProviderBuilder()",
        "  .with(processors: [logProcessor])",
        "  .with(resource: resource)",
        "  .build())",
      ],
      "",
      "// Your app. A first item to see it arrive:",
      signals.traces && [
        "let span = OpenTelemetry.instance.tracerProvider",
        '  .get(instrumentationName: "my-service", instrumentationVersion: nil)',
        '  .spanBuilder(spanName: "checkout")',
        "  .startSpan()",
        "span.end()",
      ],
      signals.metrics && [
        "var orders = OpenTelemetry.instance.meterProvider",
        '  .get(name: "my-service")',
        '  .counterBuilder(name: "orders.placed")',
        "  .build()",
        "orders.add(value: 1)",
      ],
      signals.logs && [
        "// What the logger writes is sent; print is not.",
        'OpenTelemetry.instance.loggerProvider.get(instrumentationScopeName: "my-service")',
        "  .logRecordBuilder()",
        "  .setSeverity(.info)",
        '  .setBody(.string("Hello, OneUptime"))',
        "  .emit()",
      ],
      "",
      "// Before the program ends: send what is still buffered.",
      signals.traces && "tracerProvider.shutdown()",
      // The meter provider's shutdown does not export what it measured: flush first.
      signals.metrics && [
        "_ = meterProvider.forceFlush()",
        "_ = meterProvider.shutdown()",
      ],
      // The logger provider has no shutdown of its own: its processor does.
      signals.logs && "_ = logProcessor.shutdown()",
    ),
    language: "swift",
  };
};

const SwiftSnippets: OtelLanguageSnippets = {
  install: install,
  config: config,
};

export default SwiftSnippets;
