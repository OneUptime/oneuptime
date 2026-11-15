import {
  CodeSnippet,
  OtelLanguageSnippets,
  OtelSignals,
  lines,
} from "./Shared";

/*
 * Elixir: config/runtime.exs for the signals asked for (and, for logs,
 * the line that adds the OpenTelemetry :logger handler as the app
 * starts), and the mix.exs deps of exactly the packages it uses.
 *
 * Checked end to end with Elixir 1.20.4 on OTP 29 (elixir:1.20.4-otp-29)
 * and the versions below: each variant, in a `mix new --sup` app that runs
 * the commented examples, posted its signals to a stand-in for
 * /otlp/v1/<signal> (200) and nothing else.
 *
 * - otlp_traces_endpoint (opentelemetry_exporter's environment) and
 *   otlp_metrics_endpoint / otlp_logs_endpoint (opentelemetry_experimental's)
 *   are posted to as written: "the path of the URL is kept as is"
 *   (otel_exporter_traces_otlp.erl, opentelemetry_exporter 1.11.0, and
 *   merge_with_environment in otel_exporter_otlp.erl). otlp_endpoint, and
 *   an endpoint in an exporter's own options, get /v1/<signal> added.
 * - Metrics and logs come from the experimental API and SDK
 *   (opentelemetry_experimental 0.6.0), as the Erlang/Elixir SDK has them.
 * - The SDK starts a traces exporter (otlp, to localhost:4318) unless told
 *   not to: a snippet without traces says none.
 * - Logs: what Elixir's Logger writes, through otel_log_handler. IO.puts
 *   is not sent.
 *
 * Before (issue #7927) Elixir's snippet set up traces only, on every
 * guide, and listed opentelemetry_phoenix and opentelemetry_ecto as
 * supervision children, which they are not.
 */

export const ELIXIR_PACKAGE_VERSIONS: Readonly<Record<string, string>> = {
  opentelemetry_api: "1.5.0",
  opentelemetry: "1.7.0",
  opentelemetry_exporter: "1.11.0",
  opentelemetry_api_experimental: "0.6.0",
  opentelemetry_experimental: "0.6.0",
};

const dependency: (name: string) => string = (name: string): string => {
  const version: string | undefined = ELIXIR_PACKAGE_VERSIONS[name];

  if (!version) {
    throw new Error(`No pinned version for ${name}`);
  }

  return `{:${name}, "${version}"}`;
};

const install: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  const names: Array<string> = [
    "opentelemetry_api",
    "opentelemetry",
    // The OTLP exporters, the experimental SDK's included (otel_exporter_otlp).
    "opentelemetry_exporter",
    ...(signals.metrics ? ["opentelemetry_api_experimental"] : []),
    ...(signals.metrics || signals.logs ? ["opentelemetry_experimental"] : []),
  ];

  return {
    code: lines(
      "# Add to the deps in mix.exs:",
      "defp deps do",
      "  [",
      names.map((name: string, index: number): string => {
        return `    ${dependency(name)}${index === names.length - 1 ? "" : ","}`;
      }),
      "  ]",
      "end",
      "",
      "# Then run:",
      "mix deps.get",
    ),
    language: "elixir",
  };
};

const config: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  const experimental: boolean = signals.metrics || signals.logs;

  return {
    code: lines(
      "# config/runtime.exs",
      "import Config",
      "",
      "config :opentelemetry,",
      '  resource: %{service: %{name: "my-service"}},',
      signals.traces
        ? ["  span_processor: :batch,", "  traces_exporter: :otlp"]
        : [
            "  # No traces: the SDK would send them to localhost:4318.",
            "  traces_exporter: :none",
          ],
      signals.traces && [
        "",
        "config :opentelemetry_exporter,",
        "  otlp_protocol: :http_protobuf,",
        '  otlp_traces_endpoint: "<YOUR_ONEUPTIME_URL>/v1/traces",',
        '  otlp_headers: [{"x-oneuptime-token", "<YOUR_ONEUPTIME_TOKEN>"}]',
      ],
      experimental && [
        "",
        signals.metrics && signals.logs
          ? "# Metrics and logs, through the experimental API and SDK."
          : signals.metrics
            ? "# Metrics, through the experimental API and SDK."
            : "# Logs, through the experimental SDK.",
        "config :opentelemetry_experimental,",
        signals.metrics && [
          "  readers: [",
          "    %{",
          "      module: :otel_metric_reader,",
          "      config: %{",
          "        exporter: {:otel_exporter_metrics_otlp, %{protocol: :http_protobuf}},",
          "        export_interval_ms: 60_000",
          "      }",
          "    }",
          "  ],",
          '  otlp_metrics_endpoint: "<YOUR_ONEUPTIME_URL>/v1/metrics",',
        ],
        signals.logs && '  otlp_logs_endpoint: "<YOUR_ONEUPTIME_URL>/v1/logs",',
        '  otlp_headers: [{"x-oneuptime-token", "<YOUR_ONEUPTIME_TOKEN>"}]',
      ],
      signals.logs && [
        "",
        "# lib/my_app/application.ex, first in start/2: what Logger writes is sent",
        "# from then on (IO.puts is not).",
        "#   :ok =",
        "#     :logger.add_handler(:opentelemetry, :otel_log_handler, %{",
        "#       exporter: {:otel_exporter_logs_otlp, %{protocol: :http_protobuf}}",
        "#     })",
      ],
      "",
      "# A first item from your app, to see it arrive:",
      signals.traces && [
        "#   require OpenTelemetry.Tracer",
        '#   OpenTelemetry.Tracer.with_span "checkout" do',
        signals.logs
          ? '#     Logger.info("Hello, OneUptime")'
          : "#     # the work the span times",
        "#   end",
      ],
      !signals.traces && signals.logs && '#   Logger.info("Hello, OneUptime")',
      signals.metrics && [
        "#   require OpenTelemetryAPIExperimental.Counter, as: Counter",
        '#   Counter.create(:"orders.placed", %{})',
        '#   Counter.add(:"orders.placed", 1, %{})',
      ],
    ),
    language: "elixir",
  };
};

const ElixirSnippets: OtelLanguageSnippets = {
  install: install,
  config: config,
};

export default ElixirSnippets;
