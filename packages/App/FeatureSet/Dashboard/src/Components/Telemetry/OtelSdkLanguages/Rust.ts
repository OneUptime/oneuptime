import {
  CodeSnippet,
  OtelLanguageSnippets,
  OtelSignal,
  OtelSignals,
  lines,
  signalsOf,
} from "./Shared";

/*
 * Rust: a whole src/main.rs that `cargo run` runs as it is, on the
 * builder API of opentelemetry-otlp 0.33, and the Cargo.toml lines it
 * needs.
 *
 * Checked end to end with Rust 1.99.1 (rust:1.99.1-trixie) and the
 * versions below: each variant built with no warnings, and its run posted
 * its signals to a stand-in for /otlp/v1/<signal> (200), over http and
 * over https with a certificate the system trusts, and nothing else.
 *
 * - with_endpoint is posted to as written: an endpoint given in code wins
 *   over the environment and is parsed as it is (resolve_http_endpoint,
 *   opentelemetry-otlp 0.33.1, src/exporter/http/mod.rs).
 * - The exporter's default HTTP client is reqwest's blocking one, on the
 *   batch processors' own threads: no async runtime, so no tokio, and a
 *   plain fn main. It is built with reqwest's default features off, so it
 *   has no TLS: the reqwest-rustls feature gives it rustls with the
 *   system's certificates, which an https server (OneUptime Cloud) needs.
 * - The app's tracing spans and events are what most Rust services write,
 *   so they are what is sent: spans through tracing-opentelemetry, events
 *   as log records through opentelemetry-appender-tracing. The SDK and its
 *   HTTP client log through tracing too, and are kept out of what is sent.
 *
 * Before (issue #7928) the code was opentelemetry-otlp 0.26's
 * new_exporter()/new_pipeline(), removed in 0.27; install_batch spawned
 * its exporter on a Tokio runtime the Cargo.toml did not have; and
 * tracing, tracing-opentelemetry, tracing-subscriber and reqwest were
 * pulled but never used.
 */

export const RUST_CRATE_VERSIONS: Readonly<Record<string, string>> = {
  opentelemetry: "0.33.1",
  opentelemetry_sdk: "0.33.1",
  "opentelemetry-otlp": "0.33.1",
  "opentelemetry-appender-tracing": "0.33.1",
  tracing: "0.1.44",
  "tracing-opentelemetry": "0.34.0",
  "tracing-subscriber": "0.3.23",
};

const crate: (name: string, features?: Array<string>) => string = (
  name: string,
  features?: Array<string>,
): string => {
  const version: string | undefined = RUST_CRATE_VERSIONS[name];

  if (!version) {
    throw new Error(`No pinned version for ${name}`);
  }

  return features
    ? `${name} = { version = "${version}", features = [${features
        .map((feature: string): string => {
          return `"${feature}"`;
        })
        .join(", ")}] }`
    : `${name} = "${version}"`;
};

// The app's tracing spans or events go to OpenTelemetry.
const usesTracing: (signals: OtelSignals) => boolean = (
  signals: OtelSignals,
): boolean => {
  return signals.traces || signals.logs;
};

const install: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  return {
    code: lines(
      "# Cargo.toml",
      "[dependencies]",
      // The API's global providers: the tracer's and the meter's.
      (signals.traces || signals.metrics) && crate("opentelemetry"),
      crate("opentelemetry_sdk"),
      "# reqwest-rustls: https, for a server such as OneUptime Cloud",
      crate("opentelemetry-otlp", ["reqwest-rustls"]),
      signals.logs && crate("opentelemetry-appender-tracing"),
      usesTracing(signals) && crate("tracing"),
      signals.traces && crate("tracing-opentelemetry"),
      usesTracing(signals) && crate("tracing-subscriber", ["env-filter"]),
    ),
    language: "bash",
  };
};

// The exporter each signal's provider is built with.
const EXPORTERS: Record<OtelSignal, string> = {
  traces: "SpanExporter",
  metrics: "MetricExporter",
  logs: "LogExporter",
};

// The exporters' import, in rustfmt's order, wrapped as rustfmt wraps it.
const otlpImport: (asked: Array<OtelSignal>) => string = (
  asked: Array<OtelSignal>,
): string => {
  const names: string = [
    ...asked
      .map((signal: OtelSignal): string => {
        return EXPORTERS[signal];
      })
      .sort(),
    "WithExportConfig",
    "WithHttpConfig",
  ].join(", ");
  const oneLine: string = `use opentelemetry_otlp::{${names}};`;

  return oneLine.length <= 100
    ? oneLine
    : `use opentelemetry_otlp::{\n    ${names},\n};`;
};

const config: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  const asked: Array<OtelSignal> = signalsOf(signals);
  // The last provider takes the resource and the headers; the others clone them.
  const last: OtelSignal = asked[asked.length - 1]!;
  const shared: (signal: OtelSignal, name: string) => string = (
    signal: OtelSignal,
    name: string,
  ): string => {
    return signal === last ? name : `${name}.clone()`;
  };
  const exporter: (signal: OtelSignal) => Array<string> = (
    signal: OtelSignal,
  ): Array<string> => {
    return [
      `            ${EXPORTERS[signal]}::builder()`,
      "                .with_http()",
      `                .with_endpoint("<YOUR_ONEUPTIME_URL>/v1/${signal}")`,
      `                .with_headers(${shared(signal, "headers")})`,
      "                .build()?,",
    ];
  };

  return {
    code: lines(
      "// src/main.rs - cargo run",
      (signals.traces || signals.metrics) && "use opentelemetry::global;",
      signals.traces && "use opentelemetry::trace::TracerProvider as _;",
      signals.logs &&
        "use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;",
      otlpImport(asked),
      "use opentelemetry_sdk::Resource;",
      signals.logs && "use opentelemetry_sdk::logs::SdkLoggerProvider;",
      signals.metrics && "use opentelemetry_sdk::metrics::SdkMeterProvider;",
      signals.traces && "use opentelemetry_sdk::trace::SdkTracerProvider;",
      "use std::collections::HashMap;",
      usesTracing(signals) && [
        "use tracing_subscriber::layer::SubscriberExt;",
        "use tracing_subscriber::util::SubscriberInitExt;",
        "use tracing_subscriber::{EnvFilter, Layer};",
      ],
      "",
      "fn main() -> Result<(), Box<dyn std::error::Error>> {",
      "    let headers = HashMap::from([(",
      '        "x-oneuptime-token".to_string(),',
      '        "<YOUR_ONEUPTIME_TOKEN>".to_string(),',
      "    )]);",
      '    let resource = Resource::builder().with_service_name("my-service").build();',
      signals.traces && [
        "",
        "    let tracer_provider = SdkTracerProvider::builder()",
        `        .with_resource(${shared("traces", "resource")})`,
        "        .with_batch_exporter(",
        ...exporter("traces"),
        "        )",
        "        .build();",
        "    global::set_tracer_provider(tracer_provider.clone());",
      ],
      signals.metrics && [
        "",
        "    let meter_provider = SdkMeterProvider::builder()",
        `        .with_resource(${shared("metrics", "resource")})`,
        "        .with_periodic_exporter(",
        ...exporter("metrics"),
        "        )",
        "        .build();",
        "    global::set_meter_provider(meter_provider.clone());",
      ],
      signals.logs && [
        "",
        "    let logger_provider = SdkLoggerProvider::builder()",
        `        .with_resource(${shared("logs", "resource")})`,
        "        .with_batch_exporter(",
        ...exporter("logs"),
        "        )",
        "        .build();",
      ],
      usesTracing(signals) && [
        "",
        signals.traces && signals.logs
          ? "    // Your tracing spans and events, sent as spans and log records."
          : signals.traces
            ? "    // Your tracing spans, sent as spans."
            : "    // Your tracing events (info!, warn!, ...), sent as log records.",
        "    tracing_subscriber::registry()",
        '        .with(tracing_subscriber::fmt::layer().with_filter(EnvFilter::new("info")))',
        signals.traces && [
          "        .with(",
          "            tracing_opentelemetry::layer()",
          '                .with_tracer(tracer_provider.tracer("my-service"))',
          "                .with_filter(app_only()),",
          "        )",
        ],
        signals.logs &&
          "        .with(OpenTelemetryTracingBridge::new(&logger_provider).with_filter(app_only()))",
        "        .init();",
      ],
      "",
      "    // Your app. A first item to see it arrive:",
      signals.traces
        ? [
            '    tracing::info_span!("checkout").in_scope(|| {',
            signals.logs
              ? '        tracing::info!("Hello, OneUptime");'
              : "        // The work the span times.",
            "    });",
          ]
        : signals.logs && '    tracing::info!("Hello, OneUptime");',
      signals.logs &&
        "    // println! is not sent: log with tracing's info!, warn! and error!.",
      signals.metrics && [
        '    global::meter("my-service")',
        '        .u64_counter("orders.placed")',
        "        .build()",
        "        .add(1, &[]);",
      ],
      "",
      "    // Before main returns: send what is still buffered.",
      signals.traces && "    tracer_provider.shutdown()?;",
      signals.metrics && "    meter_provider.shutdown()?;",
      signals.logs && "    logger_provider.shutdown()?;",
      "    Ok(())",
      "}",
      usesTracing(signals) && [
        "",
        "// What the SDK and its HTTP client say about themselves stays out of what is sent.",
        "fn app_only() -> EnvFilter {",
        '    EnvFilter::new("info,opentelemetry=off,hyper=off,reqwest=off")',
        "}",
      ],
    ),
    language: "rust",
  };
};

const RustSnippets: OtelLanguageSnippets = {
  install: install,
  config: config,
};

export default RustSnippets;
