import {
  CodeSnippet,
  OtelLanguageSnippets,
  OtelSignal,
  OtelSignals,
  lines,
  signalsOf,
} from "./Shared";

/*
 * C++: a whole main.cpp with a provider and an OTLP/HTTP exporter for
 * each signal asked for, and how to get opentelemetry-cpp (vcpkg, or
 * CMake's FetchContent at a pinned tag) with the CMake lines that link
 * exactly the exporters it uses.
 *
 * Checked end to end with opentelemetry-cpp 1.30.0 (Alpine edge's
 * opentelemetry-cpp-dev, g++ and CMake): each variant built with -Wall
 * -Wextra and no warnings, and its run posted its signals to a stand-in
 * for /otlp/v1/<signal> (200) and nothing else.
 *
 * - The url of OtlpHttpExporterOptions, OtlpHttpMetricExporterOptions and
 *   OtlpHttpLogRecordExporterOptions is the signal's whole URL, posted to
 *   as written (it is the environment's default that is built from
 *   OTEL_EXPORTER_OTLP_ENDPOINT with v1/<signal>).
 * - The global providers are set through the SDK's Provider, as the
 *   project's own examples/otlp do in 1.30.0.
 * - Logs: records written with the Logs API's logger; std::cout is not
 *   sent.
 * - Shutdown before main returns sends what is still buffered.
 *
 * Before (issue #7927) C++'s snippet set up traces only, on every guide,
 * and its FetchContent tag was v1.14.0.
 */

export const OPENTELEMETRY_CPP_VERSION: string = "1.30.0";

// The CMake target of each signal's OTLP/HTTP exporter.
const EXPORTER_TARGETS: Record<OtelSignal, string> = {
  traces: "opentelemetry-cpp::otlp_http_exporter",
  metrics: "opentelemetry-cpp::otlp_http_metric_exporter",
  logs: "opentelemetry-cpp::otlp_http_log_record_exporter",
};

const install: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  return {
    code: lines(
      `# opentelemetry-cpp ${OPENTELEMETRY_CPP_VERSION} with its OTLP/HTTP exporters, from vcpkg:`,
      "vcpkg install opentelemetry-cpp[otlp-http]",
      "",
      "# Or in CMakeLists.txt, built with your app:",
      "# include(FetchContent)",
      "# set(WITH_OTLP_HTTP ON)",
      "# FetchContent_Declare(opentelemetry-cpp",
      "#   GIT_REPOSITORY https://github.com/open-telemetry/opentelemetry-cpp.git",
      `#   GIT_TAG v${OPENTELEMETRY_CPP_VERSION})`,
      "# FetchContent_MakeAvailable(opentelemetry-cpp)",
      "",
      "# Then, in CMakeLists.txt:",
      "# find_package(opentelemetry-cpp CONFIG REQUIRED)  # with vcpkg",
      "# add_executable(my-service main.cpp)",
      `# target_link_libraries(my-service PRIVATE ${signalsOf(signals)
        .map((signal: OtelSignal): string => {
          return EXPORTER_TARGETS[signal];
        })
        .join(" ")})`,
    ),
    language: "bash",
  };
};

const config: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  return {
    code: lines(
      "// main.cpp - build it with the install step's CMake lines, then run it",
      "#include <memory>",
      "",
      signals.traces && [
        '#include "opentelemetry/exporters/otlp/otlp_http_exporter_factory.h"',
        '#include "opentelemetry/exporters/otlp/otlp_http_exporter_options.h"',
      ],
      signals.logs && [
        '#include "opentelemetry/exporters/otlp/otlp_http_log_record_exporter_factory.h"',
        '#include "opentelemetry/exporters/otlp/otlp_http_log_record_exporter_options.h"',
      ],
      signals.metrics && [
        '#include "opentelemetry/exporters/otlp/otlp_http_metric_exporter_factory.h"',
        '#include "opentelemetry/exporters/otlp/otlp_http_metric_exporter_options.h"',
      ],
      signals.logs && '#include "opentelemetry/logs/provider.h"',
      signals.metrics && '#include "opentelemetry/metrics/provider.h"',
      signals.logs && [
        '#include "opentelemetry/sdk/logs/batch_log_record_processor_factory.h"',
        '#include "opentelemetry/sdk/logs/batch_log_record_processor_options.h"',
        '#include "opentelemetry/sdk/logs/logger_provider.h"',
        '#include "opentelemetry/sdk/logs/logger_provider_factory.h"',
        '#include "opentelemetry/sdk/logs/provider.h"',
      ],
      signals.metrics && [
        '#include "opentelemetry/sdk/metrics/export/periodic_exporting_metric_reader_factory.h"',
        '#include "opentelemetry/sdk/metrics/export/periodic_exporting_metric_reader_options.h"',
        '#include "opentelemetry/sdk/metrics/meter_provider.h"',
        '#include "opentelemetry/sdk/metrics/meter_provider_factory.h"',
        '#include "opentelemetry/sdk/metrics/provider.h"',
        '#include "opentelemetry/sdk/metrics/view/view_registry_factory.h"',
      ],
      '#include "opentelemetry/sdk/resource/resource.h"',
      signals.traces && [
        '#include "opentelemetry/sdk/trace/batch_span_processor_factory.h"',
        '#include "opentelemetry/sdk/trace/batch_span_processor_options.h"',
        '#include "opentelemetry/sdk/trace/provider.h"',
        '#include "opentelemetry/sdk/trace/tracer_provider.h"',
        '#include "opentelemetry/sdk/trace/tracer_provider_factory.h"',
        '#include "opentelemetry/trace/provider.h"',
      ],
      "",
      "namespace otlp = opentelemetry::exporter::otlp;",
      signals.logs && "namespace logs_sdk = opentelemetry::sdk::logs;",
      signals.metrics && "namespace metrics_sdk = opentelemetry::sdk::metrics;",
      signals.traces && "namespace trace_sdk = opentelemetry::sdk::trace;",
      "",
      "int main()",
      "{",
      '  const otlp::OtlpHeaders headers = {{"x-oneuptime-token", "<YOUR_ONEUPTIME_TOKEN>"}};',
      "  const auto resource =",
      '      opentelemetry::sdk::resource::Resource::Create({{"service.name", "my-service"}});',
      signals.traces && [
        "",
        "  otlp::OtlpHttpExporterOptions traceOptions;",
        '  traceOptions.url = "<YOUR_ONEUPTIME_URL>/v1/traces";',
        "  traceOptions.http_headers = headers;",
        "  std::shared_ptr<trace_sdk::TracerProvider> tracerProvider =",
        "      trace_sdk::TracerProviderFactory::Create(",
        "          trace_sdk::BatchSpanProcessorFactory::Create(",
        "              otlp::OtlpHttpExporterFactory::Create(traceOptions),",
        "              trace_sdk::BatchSpanProcessorOptions{}),",
        "          resource);",
        "  std::shared_ptr<opentelemetry::trace::TracerProvider> globalTracerProvider = tracerProvider;",
        "  trace_sdk::Provider::SetTracerProvider(globalTracerProvider);",
      ],
      signals.metrics && [
        "",
        "  otlp::OtlpHttpMetricExporterOptions metricOptions;",
        '  metricOptions.url = "<YOUR_ONEUPTIME_URL>/v1/metrics";',
        "  metricOptions.http_headers = headers;",
        "  std::shared_ptr<metrics_sdk::MeterProvider> meterProvider =",
        "      metrics_sdk::MeterProviderFactory::Create(metrics_sdk::ViewRegistryFactory::Create(),",
        "                                                resource);",
        "  meterProvider->AddMetricReader(metrics_sdk::PeriodicExportingMetricReaderFactory::Create(",
        "      otlp::OtlpHttpMetricExporterFactory::Create(metricOptions),",
        "      metrics_sdk::PeriodicExportingMetricReaderOptions{}));",
        "  std::shared_ptr<opentelemetry::metrics::MeterProvider> globalMeterProvider = meterProvider;",
        "  metrics_sdk::Provider::SetMeterProvider(globalMeterProvider);",
      ],
      signals.logs && [
        "",
        "  otlp::OtlpHttpLogRecordExporterOptions logOptions;",
        '  logOptions.url = "<YOUR_ONEUPTIME_URL>/v1/logs";',
        "  logOptions.http_headers = headers;",
        "  std::shared_ptr<logs_sdk::LoggerProvider> loggerProvider =",
        "      logs_sdk::LoggerProviderFactory::Create(",
        "          logs_sdk::BatchLogRecordProcessorFactory::Create(",
        "              otlp::OtlpHttpLogRecordExporterFactory::Create(logOptions),",
        "              logs_sdk::BatchLogRecordProcessorOptions{}),",
        "          resource);",
        "  std::shared_ptr<opentelemetry::logs::LoggerProvider> globalLoggerProvider = loggerProvider;",
        "  logs_sdk::Provider::SetLoggerProvider(globalLoggerProvider);",
      ],
      "",
      "  // Your app. A first item to see it arrive:",
      signals.traces && [
        "  auto span = opentelemetry::trace::Provider::GetTracerProvider()",
        '                  ->GetTracer("my-service")',
        '                  ->StartSpan("checkout");',
        "  span->End();",
      ],
      signals.metrics && [
        "  opentelemetry::metrics::Provider::GetMeterProvider()",
        '      ->GetMeter("my-service")',
        '      ->CreateUInt64Counter("orders.placed")',
        "      ->Add(1);",
      ],
      signals.logs && [
        "  // What the logger writes is sent; std::cout is not.",
        '  opentelemetry::logs::Provider::GetLoggerProvider()->GetLogger("my-service")->Info(',
        '      "Hello, OneUptime");',
      ],
      "",
      "  // Before main returns: send what is still buffered.",
      signals.traces && "  tracerProvider->Shutdown();",
      signals.metrics && "  meterProvider->Shutdown();",
      signals.logs && "  loggerProvider->Shutdown();",
      "  return 0;",
      "}",
    ),
    language: "cpp",
  };
};

const CppSnippets: OtelLanguageSnippets = {
  install: install,
  config: config,
};

export default CppSnippets;
