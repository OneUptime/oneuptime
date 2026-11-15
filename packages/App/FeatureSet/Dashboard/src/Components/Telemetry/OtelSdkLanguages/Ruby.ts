import {
  CodeSnippet,
  OtelLanguageSnippets,
  OtelSignals,
  lines,
} from "./Shared";

/*
 * Ruby: telemetry.rb, required before the app's code (a Rails app keeps
 * it as config/initializers/opentelemetry.rb), with an OTLP/HTTP exporter
 * for each signal asked for, and the Gemfile lines of exactly the gems it
 * requires.
 *
 * Checked end to end with Ruby 4.0.9 (ruby:4.0.9-trixie) and the versions
 * below: each variant, required by a script that runs the commented
 * examples, posted its signals to a stand-in for /otlp/v1/<signal> (200)
 * and nothing else, the at_exit hook sending what was buffered.
 *
 * - An endpoint given to an exporter in code is posted to as written
 *   (build_uri: URI(endpoint); opentelemetry-exporter-otlp-common 0.4.0).
 * - A processor or reader added in the configure block replaces the one
 *   the SDK would make from OTEL_*_EXPORTER (otlp, to localhost:4318). The
 *   SDK always sets up traces, so a snippet without them says none.
 * - Logs: what Ruby's Logger writes (Rails.logger too), through the Logger
 *   instrumentation; puts is not sent. use_all installs it with the rest.
 * - The metrics and logs SDKs are 0.x, as Ruby's OpenTelemetry has them.
 * - The SDK has no exit hook of its own: at_exit shuts each provider down,
 *   which sends what it still holds.
 *
 * Before (issue #7927) Ruby's snippet set up traces only, on every guide.
 */

export const RUBY_GEM_VERSIONS: Readonly<Record<string, string>> = {
  "opentelemetry-sdk": "1.13.1",
  "opentelemetry-exporter-otlp": "0.37.0",
  "opentelemetry-instrumentation-all": "0.99.0",
  "opentelemetry-metrics-sdk": "0.22.0",
  "opentelemetry-exporter-otlp-metrics": "0.15.0",
  "opentelemetry-logs-sdk": "0.8.1",
  "opentelemetry-exporter-otlp-logs": "0.7.0",
  "opentelemetry-instrumentation-logger": "0.5.0",
};

const gem: (name: string) => string = (name: string): string => {
  const version: string | undefined = RUBY_GEM_VERSIONS[name];

  if (!version) {
    throw new Error(`No pinned version for ${name}`);
  }

  return `gem "${name}", "${version}"`;
};

const install: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  return {
    code: lines(
      "# Add to your Gemfile:",
      gem("opentelemetry-sdk"),
      signals.traces && [
        gem("opentelemetry-exporter-otlp"),
        gem("opentelemetry-instrumentation-all"),
      ],
      signals.metrics && [
        gem("opentelemetry-metrics-sdk"),
        gem("opentelemetry-exporter-otlp-metrics"),
      ],
      signals.logs && [
        gem("opentelemetry-logs-sdk"),
        gem("opentelemetry-exporter-otlp-logs"),
        gem("opentelemetry-instrumentation-logger"),
      ],
      "",
      "# Then run:",
      "bundle install",
    ),
    language: "bash",
  };
};

const config: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  const providers: Array<string> = [
    ...(signals.traces ? ["OpenTelemetry.tracer_provider"] : []),
    ...(signals.metrics ? ["OpenTelemetry.meter_provider"] : []),
    ...(signals.logs ? ["OpenTelemetry.logger_provider"] : []),
  ];

  return {
    code: lines(
      "# telemetry.rb - require it before your app's code",
      "# (in a Rails app, save it as config/initializers/opentelemetry.rb).",
      'require "opentelemetry/sdk"',
      signals.traces && [
        'require "opentelemetry/exporter/otlp"',
        'require "opentelemetry/instrumentation/all"',
      ],
      signals.metrics && [
        'require "opentelemetry-metrics-sdk"',
        'require "opentelemetry/exporter/otlp_metrics"',
      ],
      signals.logs && [
        'require "opentelemetry-logs-sdk"',
        'require "opentelemetry/exporter/otlp_logs"',
        'require "opentelemetry/instrumentation/logger"',
      ],
      "",
      !signals.traces && [
        "# No traces: the SDK would look for a traces exporter otherwise.",
        'ENV["OTEL_TRACES_EXPORTER"] ||= "none"',
        "",
      ],
      'headers = { "x-oneuptime-token" => "<YOUR_ONEUPTIME_TOKEN>" }',
      "",
      "OpenTelemetry::SDK.configure do |c|",
      '  c.service_name = "my-service"',
      signals.traces && [
        "",
        "  c.add_span_processor(",
        "    OpenTelemetry::SDK::Trace::Export::BatchSpanProcessor.new(",
        "      OpenTelemetry::Exporter::OTLP::Exporter.new(",
        '        endpoint: "<YOUR_ONEUPTIME_URL>/v1/traces",',
        "        headers: headers",
        "      )",
        "    )",
        "  )",
      ],
      signals.metrics && [
        "",
        "  c.add_metric_reader(",
        "    OpenTelemetry::SDK::Metrics::Export::PeriodicMetricReader.new(",
        "      exporter: OpenTelemetry::Exporter::OTLP::Metrics::MetricsExporter.new(",
        '        endpoint: "<YOUR_ONEUPTIME_URL>/v1/metrics",',
        "        headers: headers",
        "      )",
        "    )",
        "  )",
      ],
      signals.logs && [
        "",
        "  c.add_log_record_processor(",
        "    OpenTelemetry::SDK::Logs::Export::BatchLogRecordProcessor.new(",
        "      OpenTelemetry::Exporter::OTLP::Logs::LogsExporter.new(",
        '        endpoint: "<YOUR_ONEUPTIME_URL>/v1/logs",',
        "        headers: headers",
        "      )",
        "    )",
        "  )",
      ],
      signals.traces && [
        "",
        "  # Traces the libraries your app uses (Rails, Net::HTTP, pg, ...),",
        signals.logs
          ? "  # and sends what Ruby's Logger writes (Rails.logger too). puts is not sent."
          : "  # as they are.",
        "  c.use_all",
      ],
      !signals.traces &&
        signals.logs && [
          "",
          "  # What Ruby's Logger writes is sent (Rails.logger too). puts is not.",
          '  c.use "OpenTelemetry::Instrumentation::Logger"',
        ],
      "end",
      "",
      "# The SDK sends in batches: send what is left as Ruby exits.",
      providers.length === 1
        ? `at_exit { ${providers[0]}.shutdown }`
        : [
            "at_exit do",
            ...providers.map((provider: string): string => {
              return `  ${provider}.shutdown`;
            }),
            "end",
          ],
      "",
      "# A first item from your app, to see it arrive:",
      signals.traces &&
        '#   OpenTelemetry.tracer_provider.tracer("my-service").in_span("checkout") { }',
      signals.metrics &&
        '#   OpenTelemetry.meter_provider.meter("my-service").create_counter("orders.placed").add(1)',
      signals.logs && '#   Logger.new($stdout).info("Hello, OneUptime")',
    ),
    language: "ruby",
  };
};

const RubySnippets: OtelLanguageSnippets = {
  install: install,
  config: config,
};

export default RubySnippets;
