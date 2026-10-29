import { GuideSnippet, InlineText } from "./GuideTypes";

/*
 * The Rust guides' shared facts: the crates they add, at the versions the
 * end-to-end check ran (Verifications.json records the versions Cargo.lock
 * resolved, and Tests/OpenTelemetryGuides holds every `cargo add` to
 * them), the file that starts the SDK and bridges the tracing crate into
 * it, and the image the guides build.
 *
 * OpenTelemetry Rust, October 2026: every crate is at 0.33, released
 * together, and tracing-opentelemetry 0.34 bridges the tracing crate's
 * spans into it. Crates built for an older 0.x of the API, such as
 * reqwest-tracing's or tracing-actix-web's OpenTelemetry features, do not
 * mix with it, so the guides propagate context with opentelemetry-http.
 */
export const RUST_CRATE_VERSIONS: Record<string, string> = {
  opentelemetry: "0.33.1",
  opentelemetry_sdk: "0.33.1",
  "opentelemetry-otlp": "0.33.1",
  "opentelemetry-appender-tracing": "0.33.1",
  "opentelemetry-http": "0.33.1",
  tracing: "0.1.44",
  "tracing-opentelemetry": "0.34.0",
  "tracing-subscriber": "0.3.23",
  "axum-tracing-opentelemetry": "0.42.1",
  "tracing-actix-web": "0.7.25",
  // The apps' own crates, as the checks ran them.
  reqwest: "0.13.5",
  serde: "1.0.229",
  serde_json: "1.0.154",
  tokio: "1.54.1",
  axum: "0.8.9",
  "actix-web": "4.18.1",
};

export const RUST_VERSION: string = "1.99";

// Every Rust guide's first prerequisite.
export const RUST_PREREQUISITE: InlineText = `Rust 1.85 or later with Cargo, the oldest that builds the edition-2024 crates below. These steps were checked with Rust ${RUST_VERSION}.`;

// A crate at its pinned version, as Cargo adds it: opentelemetry@0.33.1.
export function pinnedCrate(name: string): string {
  const version: string | undefined = RUST_CRATE_VERSIONS[name];

  if (!version) {
    throw new Error(`No pinned version for ${name}`);
  }

  return `${name}@${version}`;
}

// A crate and the features it is added with, for cargo add's --features.
export interface CrateWithFeatures {
  name: string;
  features: Array<string>;
}

/*
 * `cargo add` of the given crates at their pinned versions: those with no
 * features on one command, then one command for each crate that takes
 * features, since --features applies to one crate at a time.
 */
export function cargoAddSnippet(
  id: string,
  crates: ReadonlyArray<string | CrateWithFeatures>,
): GuideSnippet {
  const plain: Array<string> = crates.filter(
    (crate: string | CrateWithFeatures): crate is string => {
      return typeof crate === "string";
    },
  );
  const featured: Array<CrateWithFeatures> = crates.filter(
    (crate: string | CrateWithFeatures): crate is CrateWithFeatures => {
      return typeof crate !== "string";
    },
  );

  return {
    id: id,
    language: "bash",
    code: [
      ...(plain.length > 0
        ? [`cargo add ${plain.map(pinnedCrate).join(" \\\n  ")}`]
        : []),
      ...featured.map((crate: CrateWithFeatures): string => {
        return `cargo add ${pinnedCrate(crate.name)} --features ${crate.features.join(",")}`;
      }),
    ].join("\n"),
    check: "run",
  };
}

// The crates every Rust guide adds: the SDK, its exporter, and the bridges.
export const RUST_OPENTELEMETRY_CRATES: ReadonlyArray<string> = [
  "opentelemetry",
  "opentelemetry_sdk",
  "opentelemetry-otlp",
  "opentelemetry-appender-tracing",
  "opentelemetry-http",
  "tracing",
  "tracing-opentelemetry",
];

// tracing-subscriber, with the filter the telemetry file needs.
export const TRACING_SUBSCRIBER: CrateWithFeatures = {
  name: "tracing-subscriber",
  features: ["env-filter"],
};

/*
 * The file that starts OpenTelemetry in a Rust program: a provider and an
 * OTLP exporter for each signal, the W3C propagator, and the tracing
 * crate's spans and events sent through them, with what the SDK and its
 * HTTP client log about themselves kept out. The exporters read the
 * standard variables, so the code holds no endpoint, key or service name.
 */
export function rustTelemetrySnippet(
  tracerName: string,
  // More of the filter's directives, for crates that say too much: "actix_server=warn".
  quieter: Array<string> = [],
): GuideSnippet {
  const directives: string = [
    "info",
    "opentelemetry=off",
    "hyper=off",
    "reqwest=off",
    ...quieter,
  ].join(",");

  return {
    id: "telemetry",
    language: "rust",
    title: "src/telemetry.rs",
    code: [
      "use opentelemetry::global;",
      "use opentelemetry::trace::TracerProvider as _;",
      "use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;",
      "use opentelemetry_otlp::{LogExporter, MetricExporter, SpanExporter};",
      "use opentelemetry_sdk::Resource;",
      "use opentelemetry_sdk::logs::SdkLoggerProvider;",
      "use opentelemetry_sdk::metrics::SdkMeterProvider;",
      "use opentelemetry_sdk::propagation::TraceContextPropagator;",
      "use opentelemetry_sdk::trace::SdkTracerProvider;",
      "use tracing_subscriber::layer::SubscriberExt;",
      "use tracing_subscriber::util::SubscriberInitExt;",
      "use tracing_subscriber::{EnvFilter, Layer};",
      "",
      "/// The SDK's providers. Shut them down before the program ends: what they",
      "/// still hold is lost otherwise.",
      "pub struct Telemetry {",
      "    tracer_provider: SdkTracerProvider,",
      "    meter_provider: SdkMeterProvider,",
      "    logger_provider: SdkLoggerProvider,",
      "}",
      "",
      "/// Traces, metrics and logs to the endpoint the OTEL_* variables name, with",
      "/// the tracing crate's spans and events sent through them.",
      "pub fn init() -> Result<Telemetry, Box<dyn std::error::Error>> {",
      "    // service.name and the other resource attributes, from OTEL_SERVICE_NAME.",
      "    let resource = Resource::builder().build();",
      "",
      "    let tracer_provider = SdkTracerProvider::builder()",
      "        .with_resource(resource.clone())",
      "        .with_batch_exporter(SpanExporter::builder().with_http().build()?)",
      "        .build();",
      "    let meter_provider = SdkMeterProvider::builder()",
      "        .with_resource(resource.clone())",
      "        .with_periodic_exporter(MetricExporter::builder().with_http().build()?)",
      "        .build();",
      "    let logger_provider = SdkLoggerProvider::builder()",
      "        .with_resource(resource)",
      "        .with_batch_exporter(LogExporter::builder().with_http().build()?)",
      "        .build();",
      "",
      "    global::set_text_map_propagator(TraceContextPropagator::new());",
      "    global::set_tracer_provider(tracer_provider.clone());",
      "    global::set_meter_provider(meter_provider.clone());",
      "",
      `    let tracer = tracer_provider.tracer("${tracerName}");`,
      "    tracing_subscriber::registry()",
      '        .with(tracing_subscriber::fmt::layer().with_filter(EnvFilter::new("info")))',
      "        // tracing's spans, as OpenTelemetry spans...",
      "        .with(",
      "            tracing_opentelemetry::layer()",
      "                .with_tracer(tracer)",
      "                .with_filter(app_only()),",
      "        )",
      "        // ...and its events, as log records with the trace of the span they are in.",
      "        .with(",
      "            OpenTelemetryTracingBridge::new(&logger_provider).with_filter(app_only()),",
      "        )",
      "        .init();",
      "",
      "    Ok(Telemetry {",
      "        tracer_provider,",
      "        meter_provider,",
      "        logger_provider,",
      "    })",
      "}",
      "",
      "// The SDK and its HTTP client log through tracing too: what they say is kept",
      "// out of what they send, or each export would have more to export.",
      "fn app_only() -> EnvFilter {",
      `    EnvFilter::new("${directives}")`,
      "}",
      "",
      "impl Telemetry {",
      "    /// Sends what is still buffered, then stops each exporter.",
      "    pub fn shutdown(self) {",
      "        let results = [",
      "            self.tracer_provider.shutdown(),",
      "            self.meter_provider.shutdown(),",
      "            self.logger_provider.shutdown(),",
      "        ];",
      "        for result in results {",
      "            if let Err(error) = result {",
      '                eprintln!("OpenTelemetry shutdown failed: {error}");',
      "            }",
      "        }",
      "    }",
      "}",
    ].join("\n"),
    check: "run",
  };
}

export interface RustDockerfileOptions {
  // The binary cargo builds, as Cargo.toml names the package.
  binary: string;
  // The port it listens on; none for a job.
  port?: number | undefined;
}

/*
 * A two-stage image: the Rust image builds the release binary, and
 * distroless' cc image runs it, with the C library it links and the CA
 * certificates HTTPS to OneUptime needs, as a user without privileges.
 */
export function rustDockerfileSnippet(
  options: RustDockerfileOptions,
): GuideSnippet {
  return {
    id: "dockerfile",
    language: "dockerfile",
    title: "Dockerfile",
    code: [
      `FROM rust:${RUST_VERSION} AS build`,
      "WORKDIR /src",
      "COPY . .",
      "RUN cargo build --release",
      "",
      "FROM gcr.io/distroless/cc-debian13:nonroot",
      `COPY --from=build /src/target/release/${options.binary} /${options.binary}`,
      ...(options.port === undefined ? [] : [`EXPOSE ${options.port}`]),
      `ENTRYPOINT ["/${options.binary}"]`,
    ].join("\n"),
    check: "parse",
  };
}
