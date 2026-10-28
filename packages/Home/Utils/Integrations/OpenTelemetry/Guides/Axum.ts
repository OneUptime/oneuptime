import {
  OpenTelemetryGuide,
  GuideSnippet,
  VerificationCommand,
} from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";
import { blockOf } from "../GuideSnippets";
import {
  RUST_OPENTELEMETRY_CRATES,
  RUST_PREREQUISITE,
  TRACING_SUBSCRIBER,
  cargoAddSnippet,
  pinnedCrate,
  rustDockerfileSnippet,
  rustTelemetrySnippet,
} from "../RustShared";

/*
 * An Axum 0.8 orders API on Tokio, with an in-memory store and a payments
 * API it calls with reqwest. telemetry.rs starts the SDK and bridges the
 * tracing crate into it; axum-tracing-opentelemetry's layer opens a
 * server span per request, named after its route; the call to the
 * payments API is a client span of the app's own, which sends
 * traceparent. Checked with export delays longer than the run, so what
 * arrives is what the shutdown sends after Axum's graceful stop.
 */

const install: GuideSnippet = cargoAddSnippet("install", [
  ...RUST_OPENTELEMETRY_CRATES,
  TRACING_SUBSCRIBER,
  // Its spans at INFO, which the telemetry file's filter lets through.
  { name: "axum-tracing-opentelemetry", features: ["tracing_level_info"] },
]);

const telemetry: GuideSnippet = rustTelemetrySnippet("orders-api");

const mainFile: string = [
  "mod telemetry;",
  "",
  "use std::collections::HashMap;",
  "use std::sync::{Arc, Mutex};",
  "",
  "use axum::extract::{Path, State};",
  "use axum::http::StatusCode;",
  "use axum::response::{IntoResponse, Response};",
  "use axum::routing::{get, post};",
  "use axum::{Json, Router};",
  "use axum_tracing_opentelemetry::middleware::{OtelAxumLayer, OtelInResponseLayer};",
  "use opentelemetry::metrics::Counter;",
  "use opentelemetry::trace::Status;",
  "use opentelemetry::{KeyValue, global};",
  "use opentelemetry_http::HeaderInjector;",
  "use serde::{Deserialize, Serialize};",
  "use tracing::{Instrument, Span, info, info_span, instrument};",
  "use tracing_opentelemetry::OpenTelemetrySpanExt;",
  "",
  "#[derive(Clone, Serialize)]",
  "struct Order {",
  "    id: u64,",
  "    items: usize,",
  "    payment_method: String,",
  "}",
  "",
  "#[derive(Deserialize)]",
  "struct NewOrder {",
  "    items: Vec<String>,",
  "    payment_method: String,",
  "}",
  "",
  "#[derive(Clone)]",
  "struct AppState {",
  "    orders: Arc<Mutex<HashMap<u64, Order>>>,",
  "    payments: reqwest::Client,",
  "    payments_url: String,",
  "    orders_placed: Counter<u64>,",
  "}",
  "",
  "#[tokio::main]",
  "async fn main() -> Result<(), Box<dyn std::error::Error>> {",
  "    let telemetry = telemetry::init()?;",
  "",
  "    let orders = HashMap::from([(",
  "        42,",
  "        Order {",
  "            id: 42,",
  "            items: 2,",
  '            payment_method: "card".into(),',
  "        },",
  "    )]);",
  "    let state = AppState {",
  "        orders: Arc::new(Mutex::new(orders)),",
  "        payments: reqwest::Client::new(),",
  '        payments_url: std::env::var("PAYMENTS_API_URL")',
  '            .unwrap_or("http://localhost:9000".into()),',
  '        orders_placed: global::meter("orders-api")',
  '            .u64_counter("orders.placed")',
  '            .with_description("Orders placed, by payment method")',
  "            .build(),",
  "    };",
  "",
  "    let app = Router::new()",
  '        .route("/orders/{id}", get(get_order))',
  '        .route("/orders", post(create_order))',
  '        .route("/orders/{id}/receipt", get(get_receipt))',
  "        // A server span per request, named after its route, and traceparent read.",
  "        .layer(OtelInResponseLayer)",
  '        .layer(OtelAxumLayer::default().filter(|path| path != "/healthz"))',
  "        // Outside the layers, so the health check is never traced.",
  '        .route("/healthz", get(|| async { "ok" }))',
  "        .with_state(state);",
  "",
  '    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080").await?;',
  '    info!("listening on :8080");',
  "    axum::serve(listener, app)",
  "        .with_graceful_shutdown(shutdown_signal())",
  "        .await?;",
  "",
  "    // After the last request, before main returns: send what is still buffered.",
  "    telemetry.shutdown();",
  "    Ok(())",
  "}",
  "",
  "async fn shutdown_signal() {",
  "    let mut terminate =",
  "        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())",
  '            .expect("a SIGTERM handler");',
  "    tokio::select! {",
  "        _ = tokio::signal::ctrl_c() => {},",
  "        _ = terminate.recv() => {},",
  "    }",
  "}",
  "",
  "async fn get_order(",
  "    State(state): State<AppState>,",
  "    Path(id): Path<u64>,",
  ") -> Result<Json<Order>, AppError> {",
  '    info!(order.id = id, "loading order");',
  "    let order = state.orders.lock().unwrap().get(&id).cloned();",
  "    order.map(Json).ok_or(AppError::NotFound)",
  "}",
  "",
  '#[instrument(name = "checkout.charge", skip_all, fields(',
  "    payment.method = %order.payment_method,",
  "    order.item_count = order.items.len(),",
  "))]",
  "async fn charge(state: &AppState, order: &NewOrder) -> Result<(), AppError> {",
  '    let url = format!("{}/api/charges", state.payments_url);',
  "    // A client span for the call, and traceparent sent so the payments API joins in.",
  "    let span = info_span!(",
  '        "http.client",',
  '        otel.name = "POST",',
  '        otel.kind = "client",',
  '        http.request.method = "POST",',
  "        url.full = %url,",
  "        http.response.status_code = tracing::field::Empty,",
  "    );",
  "    let mut headers = reqwest::header::HeaderMap::new();",
  "    global::get_text_map_propagator(|propagator| {",
  "        propagator.inject_context(&span.context(), &mut HeaderInjector(&mut headers));",
  "    });",
  "    let response = state",
  "        .payments",
  "        .post(&url)",
  "        .headers(headers)",
  "        .send()",
  "        .instrument(span.clone())",
  "        .await",
  "        .map_err(|error| AppError::Payment(error.to_string()))?;",
  '    span.record("http.response.status_code", response.status().as_u16());',
  "    response",
  "        .error_for_status()",
  "        .map_err(|error| AppError::Payment(error.to_string()))?;",
  "    Ok(())",
  "}",
  "",
  "async fn create_order(",
  "    State(state): State<AppState>,",
  "    Json(order): Json<NewOrder>,",
  ") -> Result<(StatusCode, Json<Order>), AppError> {",
  "    charge(&state, &order).await?;",
  "    let mut orders = state.orders.lock().unwrap();",
  "    let id = orders.len() as u64 + 100;",
  "    let placed = Order {",
  "        id,",
  "        items: order.items.len(),",
  "        payment_method: order.payment_method.clone(),",
  "    };",
  "    orders.insert(id, placed.clone());",
  "    state",
  "        .orders_placed",
  '        .add(1, &[KeyValue::new("payment.method", order.payment_method)]);',
  "    Ok((StatusCode::CREATED, Json(placed)))",
  "}",
  "",
  "async fn get_receipt(Path(id): Path<u64>) -> Result<String, AppError> {",
  "    Err(AppError::Internal(format!(",
  '        "the receipt printer is offline for order {id}"',
  "    )))",
  "}",
  "",
  "enum AppError {",
  "    NotFound,",
  "    Payment(String),",
  "    Internal(String),",
  "}",
  "",
  "impl IntoResponse for AppError {",
  "    fn into_response(self) -> Response {",
  "        let (status, message) = match self {",
  "            AppError::NotFound => {",
  '                return (StatusCode::NOT_FOUND, "no such order").into_response();',
  "            }",
  "            AppError::Payment(message) => (StatusCode::BAD_GATEWAY, message),",
  "            AppError::Internal(message) => {",
  "                (StatusCode::INTERNAL_SERVER_ERROR, message)",
  "            }",
  "        };",
  "        // Recorded on the request's span as its exception, which marks it failed.",
  "        let span = Span::current();",
  "        span.add_event(",
  '            "exception",',
  "            vec![",
  '                KeyValue::new("exception.type", "AppError"),',
  '                KeyValue::new("exception.message", message.clone()),',
  "            ],",
  "        );",
  "        span.set_status(Status::error(message.clone()));",
  '        tracing::error!("request failed: {message}");',
  "        (status, message).into_response()",
  "    }",
  "}",
].join("\n");

const main: GuideSnippet = {
  id: "main",
  language: "rust",
  title: "src/main.rs",
  code: mainFile,
  check: "run",
};

const charge: GuideSnippet = {
  id: "charge",
  language: "rust",
  title: "src/main.rs",
  code: blockOf(mainFile, '#[instrument(name = "checkout.charge"', "}"),
  check: "contained",
};

const appError: GuideSnippet = {
  id: "app-error",
  language: "rust",
  title: "src/main.rs",
  code: blockOf(mainFile, "impl IntoResponse for AppError {", "}"),
  check: "contained",
};

const getOrder: GuideSnippet = {
  id: "get-order",
  language: "rust",
  title: "src/main.rs",
  code: blockOf(mainFile, "async fn get_order(", "}"),
  check: "contained",
};

const counter: GuideSnippet = {
  id: "counter",
  language: "rust",
  title: "src/main.rs",
  code: [
    '        orders_placed: global::meter("orders-api")',
    '            .u64_counter("orders.placed")',
    '            .with_description("Orders placed, by payment method")',
    "            .build(),",
  ].join("\n"),
  check: "contained",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "cargo run --release",
  check: "run",
};

const sampling: GuideSnippet = {
  id: "sampling",
  language: "bash",
  code: [
    'export OTEL_TRACES_SAMPLER="parentbased_traceidratio"',
    'export OTEL_TRACES_SAMPLER_ARG="0.25"',
  ].join("\n"),
  check: "parse",
};

/*
 * Export intervals longer than the run: what arrives is what shutdown()
 * sends once Axum's graceful stop has let the last request finish.
 */
const SENT_AT_EXIT: Record<string, string> = {
  OTEL_BSP_SCHEDULE_DELAY: "30000",
  OTEL_BLRP_SCHEDULE_DELAY: "30000",
  OTEL_METRIC_EXPORT_INTERVAL: "60000",
};

// A Cargo project with the app's own crates, then the page's steps.
const COMMANDS: Array<VerificationCommand> = [
  { command: "cargo init --name orders-api --vcs none" },
  {
    command: [
      `cargo add ${pinnedCrate("axum")}`,
      `cargo add ${pinnedCrate("tokio")} --features macros,rt-multi-thread,signal`,
      `cargo add ${pinnedCrate("reqwest")} --features json`,
      `cargo add ${pinnedCrate("serde")} --features derive`,
    ].join(" && "),
  },
  { snippet: "install" },
  // The code is as rustfmt writes it, and builds without a warning.
  { command: "rustup component add rustfmt && cargo fmt --check" },
  {
    command:
      'set -o pipefail; cargo build --release 2>&1 | tee build.log && ! grep -q "^warning" build.log',
  },
  { snippet: "run", isServer: true, environment: SENT_AT_EXIT },
];

export const AxumGuide: OpenTelemetryGuide = {
  slug: "axum",
  seo: {
    title: "Axum OpenTelemetry: Request Spans and Logs | OneUptime",
    description:
      "Trace an Axum app with OpenTelemetry: a span per request named after its route, client spans with traceparent, tracing's events as logs, and a graceful flush.",
  },
  h1: "OpenTelemetry for Axum",
  lead: "Trace every request your Axum app serves, named after its route, with the calls it makes to other services beneath it, and send traces, metrics and the tracing crate's events to OneUptime. A Tower layer opens each request's span, one file starts the SDK, and Axum's graceful shutdown lets the last batches leave.",
  cardDescription:
    "Axum 0.8 on Tokio: a span per request named after its route, client spans with traceparent, tracing events as logs.",
  searchTerms: [
    "tokio",
    "tower",
    "axum-tracing-opentelemetry",
    "otelaxumlayer",
    "graceful shutdown",
  ],
  highlights: [
    "Spans named after routes",
    "Graceful shutdown flush",
    "Axum 0.8",
  ],

  whatYouGet: {
    intro: `Each request becomes a trace under the service named by \`OTEL_SERVICE_NAME\`, listed in ${SCREENS.services} from the first request on. The example is an orders API on Axum 0.8 and Tokio, keeping its orders in memory and charging them through a payments API it calls with reqwest.`,
    traces:
      "A server span per request, named after its route, such as `GET /orders/{id}`, with the status code, and beneath it the spans your handlers open, a call to another service among them, which sends `traceparent` along.",
    metrics:
      "The instruments you create, such as orders placed by payment method; Axum's layer and the OpenTelemetry crates record spans only.",
    logs: "Every tracing event at INFO or above, from the handlers and from Axum's runtime, with the trace and span IDs of the request it was written in.",
    exceptions: `An error a handler returns as a 5xx marks the request's span failed; recorded on it as an \`exception\` event, as the app's error type does, it is listed in ${SCREENS.exceptions}.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "axum layer",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 4,
        duration: 90,
        source: "your code",
      },
      { name: "POST", depth: 2, start: 7, duration: 84, source: "your code" },
    ],
  },

  prerequisites: [
    RUST_PREREQUISITE,
    "An Axum 0.8 app on Tokio; `axum-tracing-opentelemetry` 0.42 needs Rust 1.91 or later. Not a web service? The [Rust](/integrations/opentelemetry/rust) guide covers any program.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add the OpenTelemetry crates, the tracing bridges and `tracing-subscriber`, and Axum's layer, at the versions this guide was checked with:",
    snippets: [install],
    notes: [
      "`axum-tracing-opentelemetry` opens its spans at TRACE by default. Its `tracing_level_info` feature opens them at INFO, which the filter in `telemetry.rs` lets through; without it, no request is traced.",
      "Every crate here is built for OpenTelemetry 0.33: a crate built for another 0.x, such as `reqwest-tracing` for 0.32, does not mix with them.",
    ],
  },

  configure: {
    intro:
      "Set the standard OpenTelemetry variables where the server starts: the exporters and the resource read them, so nothing of OneUptime's is in the code:",
    tabs: otlpEnvironmentTabs({ serviceName: "orders-api" }),
    notes: [
      "The exporters send protobuf over HTTP from the SDK's own threads, so they run beside Tokio's without sharing its runtime.",
    ],
  },

  setup: {
    intro:
      "One file starts the SDK, and `main` adds two layers to the router and shuts the SDK down after Axum's graceful stop. The handlers stay as they are.",
    steps: [
      {
        title: "Add a file that starts OpenTelemetry",
        body: "A provider and an OTLP exporter for each signal, the W3C propagator, and the tracing crate's spans and events sent through them:",
        snippets: [telemetry],
      },
      {
        title: "Layer the router, and shut the SDK down after the server stops",
        body: "`OtelAxumLayer` opens a span per request and reads `traceparent`; `OtelInResponseLayer` returns the trace's context in each response. Routes added after the layers, as the health check is, are left out:",
        snippets: [main],
        notes: [
          "`with_graceful_shutdown` stops taking connections on SIGTERM and finishes the requests in flight; `telemetry.shutdown()` then sends what the providers still hold.",
          "The filter passed to `OtelAxumLayer` is another way to leave a path untraced, for routes that must stay inside the layers.",
        ],
      },
      {
        title: "Run it",
        body: "With the variables above exported:",
        snippets: [run],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "Rust traces nothing by itself; Axum's layer and the tracing bridges cover the request, and your code adds the rest. With this app, a request's trace holds:",
    rows: [
      {
        library: "`OtelAxumLayer`",
        covers:
          "A server span per request, named after the matched route (`GET /orders/{id}`), with `http.route`, the method and the status code, its parent read from `traceparent`; a 5xx marks it failed. A request no route matched keeps the method alone.",
      },
      {
        library: "`OtelInResponseLayer`",
        covers:
          "The trace's `traceparent` added to each response, so a caller can find the trace its request made.",
      },
      {
        library: "`#[instrument]`, `info_span!`",
        covers:
          'Your own spans, under the request\'s, with their fields as attributes; `otel.kind = "client"` makes one a client span.',
      },
      {
        library: "`info!` to `error!`",
        covers:
          "A log record for each event at INFO or above, with the request's trace and span IDs, also kept as an event of the span it was written in.",
      },
    ],
    snippets: [],
    notes: [
      "reqwest records no span of its own: `charge`, in the next section, opens one around the call and injects `traceparent` into its headers.",
    ],
  },

  manualSpans: {
    intro:
      "Open spans with the tracing crate inside a handler: `#[instrument]` on a function, `info_span!` around a call. A future runs under a span once you `.instrument()` it:",
    snippets: [charge],
    notes: [
      "`skip_all` keeps the function's arguments out of the span; the `fields` named instead become attributes, such as `payment.method`.",
      "`.instrument(span.clone())` enters the span each time the future is polled, so what the call does nests beneath it, on whichever thread Tokio runs it.",
      "Each field is searchable in the **Traces** explorer as an attribute: `@payment.method:card` lists the card charges.",
    ],
  },

  logs: {
    intro:
      "Log with tracing's macros inside handlers. Each event becomes a log record that carries the IDs of the request's span, and its fields go along as attributes:",
    snippets: [getOrder],
    notes: [
      "`order.id = id` is an attribute of the record, beside its body, `loading order`.",
      "An event written before the server starts, such as `listening on :8080`, belongs to no request and carries no trace ID.",
    ],
  },

  metrics: {
    intro:
      "Axum's layer records spans only, so the app's metrics are the instruments it creates. Create each once, here in the router's state, and add to it in the handler:",
    builtIn: [],
    snippets: [counter],
    notes: [
      "The periodic reader exports every 60 seconds, and once more in `telemetry.shutdown()`.",
      "A payment method has a handful of values, so `orders.placed` makes a handful of series.",
    ],
  },

  sampling: {
    intro:
      "The health check stays untraced, outside the layers. To keep a share of the other requests' traces, set the standard sampler variables:",
    snippets: [sampling],
    notes: [
      "A request whose caller sent `traceparent` follows the caller's choice; of those that start a trace, `parentbased_traceidratio` keeps one in four.",
      "The counter still counts every order, and every event is still sent: sampling drops spans.",
    ],
  },

  deploy: {
    intro:
      "Build the release binary in the Rust image, run it from a distroless one, and give the Deployment the key from a Secret:",
    snippets: [
      rustDockerfileSnippet({ binary: "orders-api", port: 8080 }),
      kubernetesManifestSnippet({
        name: "orders-api",
        image: "registry.example.com/orders-api:0.9.0",
        containerPort: 8080,
      }),
    ],
    notes: [
      "Kubernetes sends SIGTERM before it stops a pod: `shutdown_signal` turns it into Axum's graceful stop, then the SDK's shutdown, well inside the 30 seconds Kubernetes waits.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Request \`curl localhost:8080/orders/42\`, then open ${SCREENS.services}: \`orders-api\` is listed within a minute. No requests traced? Check the \`tracing_level_info\` feature first.`,
      },
      {
        title: "Open an order's trace",
        body: `Place an order with a \`POST\` to \`/orders\`, then search ${SCREENS.traces} for \`POST /orders\`: \`checkout.charge\` sits beneath it, and the payments API's \`POST\` beneath that.`,
      },
      {
        title: "Find the exception",
        body: `Request \`/orders/42/receipt\`: ${SCREENS.exceptions} lists the \`AppError\` its handler returned, and the request's span is marked failed.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Requests are not traced, though events arrive as logs",
      answer:
        "The layer's spans are at TRACE, and the filter drops them: add `axum-tracing-opentelemetry` with its `tracing_level_info` feature, as above, or add `otel::tracing=trace` to the filter in `app_only()`.",
    },
    {
      question: "The last requests before a deploy never arrive",
      answer:
        "The process ended before `telemetry.shutdown()` ran: a SIGKILL, or a `main` that returned another way. Serve with `with_graceful_shutdown`, call the shutdown after it, and give the pod time to stop.",
    },
    {
      question: "An error response arrives with no exception",
      answer:
        "A 5xx marks the span failed, but only an `exception` event names the error. Record one where the error turns into a response, as `AppError`'s `into_response` does.",
    },
    {
      question: "The payments API's spans are in traces of their own",
      answer:
        "The call went out without `traceparent`: reqwest sends none by itself. Inject it from the client span's context, as `charge` does with `HeaderInjector`.",
    },
    {
      question: "Some spans are named GET, with no route",
      answer:
        "No route matched those requests, as for a 404 on an unknown path, so the layer had no route to name them after.",
    },
  ],

  faq: [
    {
      question: "Can reqwest-tracing make the client spans?",
      answer:
        "Not with OpenTelemetry 0.33 yet: `reqwest-tracing` 0.7 supports OpenTelemetry releases up to 0.32, and the types of two releases do not mix. A span of your own and `HeaderInjector`, as in `charge`, need no other crate.",
    },
    {
      question: "Can a caller find the trace its request made?",
      answer:
        "Yes: `OtelInResponseLayer` adds the trace's `traceparent` header to every response, so the caller, or a browser's network tab, shows the trace ID to search for.",
    },
    {
      question: "Which versions were checked?",
      answer:
        "Axum 0.8.9 on Tokio 1.54, with OpenTelemetry 0.33.1, `tracing-opentelemetry` 0.34 and `axum-tracing-opentelemetry` 0.42.1, built with Rust 1.99.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: the app sends straight to OneUptime from the SDK's threads. A Collector helps when many services should share one exporter that holds the key and batches for them: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["rust", "actix-web", "gin", "fastapi"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.exceptions],

  verification: {
    runtime: "rust",
    framework: { name: "Axum", package: "axum" },
    files: [
      { path: "src/telemetry.rs", snippet: "telemetry" },
      { path: "src/main.rs", snippet: "main" },
      { path: "rustfmt.toml", content: "max_width = 87" },
    ],
    stubApiPort: 9000,
    commands: COMMANDS,
    port: 8080,
    requests: [
      { method: "GET", path: "/healthz" },
      { method: "GET", path: "/orders/42" },
      // A caller's request, whose trace the span continues.
      {
        method: "GET",
        path: "/orders/42",
        headers: {
          traceparent:
            "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        },
      },
      { method: "GET", path: "/orders/7" },
      {
        method: "POST",
        path: "/orders",
        body: { items: ["kettle", "mug"], payment_method: "card" },
      },
      { method: "GET", path: "/orders/42/receipt" },
      { method: "GET", path: "/nowhere" },
    ],
    expect: {
      spans: [
        {
          name: "GET /orders/{id}",
          attributes: {
            "http.route": "/orders/{id}",
            "http.response.status_code": "200",
          },
        },
        { name: "GET /orders/{id}", parentSpanId: "00f067aa0ba902b7" },
        {
          name: "GET /orders/{id}",
          attributes: { "http.response.status_code": "404" },
          hasException: false,
        },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
          parent: "POST /orders",
        },
        {
          name: "POST",
          attributes: { "http.response.status_code": "200" },
          parent: "checkout.charge",
        },
        {
          name: "GET /orders/{id}/receipt",
          hasException: true,
          exceptionMessage: "the receipt printer is offline for order 42",
        },
      ],
      metrics: ["orders.placed"],
      logs: [
        {
          body: "loading order",
          hasTraceContext: true,
          attributes: { "order.id": "42" },
        },
        {
          body: "request failed: the receipt printer is offline for order 42",
          hasTraceContext: true,
        },
      ],
      resource: { "service.name": "orders-api" },
      untracedPaths: ["/healthz"],
    },
  },
};
