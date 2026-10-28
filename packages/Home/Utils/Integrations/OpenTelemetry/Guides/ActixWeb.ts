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
 * An Actix Web 4 orders API, with an in-memory store and a payments API it
 * calls with reqwest. telemetry.rs starts the SDK and bridges the tracing
 * crate into it; tracing-actix-web's TracingLogger opens a span per
 * request, and a root span builder of the app's own reads traceparent and
 * records server errors as exceptions, since tracing-actix-web's own
 * OpenTelemetry features stop at OpenTelemetry 0.32. Checked with export
 * delays longer than the run, so what arrives is what the shutdown sends
 * after Actix's graceful stop.
 */

const install: GuideSnippet = cargoAddSnippet("install", [
  ...RUST_OPENTELEMETRY_CRATES,
  "tracing-actix-web",
  TRACING_SUBSCRIBER,
]);

// Actix's server logs each worker it starts and stops: kept to its warnings.
const telemetry: GuideSnippet = rustTelemetrySnippet("orders-api", [
  "actix_server=warn",
]);

const mainFile: string = [
  "mod telemetry;",
  "",
  "use std::collections::HashMap;",
  "use std::sync::Mutex;",
  "",
  "use actix_web::body::MessageBody;",
  "use actix_web::dev::{ServiceRequest, ServiceResponse};",
  "use actix_web::http::header::HeaderMap;",
  "use actix_web::{App, Error, HttpResponse, HttpServer, ResponseError, get, post, web};",
  "use opentelemetry::metrics::Counter;",
  "use opentelemetry::propagation::Extractor;",
  "use opentelemetry::{KeyValue, global};",
  "use opentelemetry_http::HeaderInjector;",
  "use serde::{Deserialize, Serialize};",
  "use tracing::{Instrument, Span, info, info_span, instrument};",
  "use tracing_actix_web::{DefaultRootSpanBuilder, RootSpanBuilder, TracingLogger};",
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
  "struct AppState {",
  "    orders: Mutex<HashMap<u64, Order>>,",
  "    payments: reqwest::Client,",
  "    payments_url: String,",
  "    orders_placed: Counter<u64>,",
  "}",
  "",
  "/// The request's span, from tracing-actix-web, with its parent read from",
  "/// traceparent and its server errors recorded as exceptions.",
  "struct TracedRequests;",
  "",
  "impl RootSpanBuilder for TracedRequests {",
  "    fn on_request_start(request: &ServiceRequest) -> Span {",
  "        // The health check gets no span, so it is never traced.",
  '        if request.path() == "/healthz" {',
  "            return Span::none();",
  "        }",
  "        let span = tracing_actix_web::root_span!(request);",
  "        // A caller's traceparent makes this request part of the caller's trace.",
  "        let parent = global::get_text_map_propagator(|propagator| {",
  "            propagator.extract(&RequestHeaders(request.headers()))",
  "        });",
  "        let _ = span.set_parent(parent);",
  "        span",
  "    }",
  "",
  "    fn on_request_end<B: MessageBody>(",
  "        span: Span,",
  "        outcome: &Result<ServiceResponse<B>, Error>,",
  "    ) {",
  "        if let Ok(response) = outcome {",
  "            if let Some(error) = response.response().error() {",
  "                if response.status().is_server_error() {",
  "                    span.add_event(",
  '                        "exception",',
  "                        vec![",
  '                            KeyValue::new("exception.type", "AppError"),',
  '                            KeyValue::new("exception.message", error.to_string()),',
  "                        ],",
  "                    );",
  "                }",
  "            }",
  "        }",
  "        DefaultRootSpanBuilder::on_request_end(span, outcome);",
  "    }",
  "}",
  "",
  "/// Actix Web's headers, read by OpenTelemetry's propagator.",
  "struct RequestHeaders<'a>(&'a HeaderMap);",
  "",
  "impl Extractor for RequestHeaders<'_> {",
  "    fn get(&self, key: &str) -> Option<&str> {",
  "        self.0.get(key).and_then(|value| value.to_str().ok())",
  "    }",
  "",
  "    fn keys(&self) -> Vec<&str> {",
  "        self.0.keys().map(|name| name.as_str()).collect()",
  "    }",
  "}",
  "",
  "#[actix_web::main]",
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
  "    let state = web::Data::new(AppState {",
  "        orders: Mutex::new(orders),",
  "        payments: reqwest::Client::new(),",
  '        payments_url: std::env::var("PAYMENTS_API_URL")',
  '            .unwrap_or("http://localhost:9000".into()),',
  '        orders_placed: global::meter("orders-api")',
  '            .u64_counter("orders.placed")',
  '            .with_description("Orders placed, by payment method")',
  "            .build(),",
  "    });",
  "",
  '    info!("listening on :8080");',
  "    HttpServer::new(move || {",
  "        App::new()",
  "            .wrap(TracingLogger::<TracedRequests>::new())",
  "            .app_data(state.clone())",
  "            .service(healthz)",
  "            .service(get_order)",
  "            .service(create_order)",
  "            .service(get_receipt)",
  "    })",
  '    .bind(("0.0.0.0", 8080))?',
  "    .run()",
  "    .await?;",
  "",
  "    // Actix stops gracefully on SIGTERM; then send what is still buffered.",
  "    telemetry.shutdown();",
  "    Ok(())",
  "}",
  "",
  '#[get("/healthz")]',
  "async fn healthz() -> &'static str {",
  '    "ok"',
  "}",
  "",
  '#[get("/orders/{id}")]',
  "async fn get_order(",
  "    state: web::Data<AppState>,",
  "    id: web::Path<u64>,",
  ") -> Result<web::Json<Order>, AppError> {",
  "    let id = id.into_inner();",
  '    info!(order.id = id, "loading order");',
  "    let order = state.orders.lock().unwrap().get(&id).cloned();",
  "    order.map(web::Json).ok_or(AppError::NotFound)",
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
  '#[post("/orders")]',
  "async fn create_order(",
  "    state: web::Data<AppState>,",
  "    order: web::Json<NewOrder>,",
  ") -> Result<HttpResponse, AppError> {",
  "    charge(&state, &order).await?;",
  "    let mut orders = state.orders.lock().unwrap();",
  "    let id = orders.len() as u64 + 100;",
  "    let placed = Order {",
  "        id,",
  "        items: order.items.len(),",
  "        payment_method: order.payment_method.clone(),",
  "    };",
  "    orders.insert(id, placed.clone());",
  "    state.orders_placed.add(",
  "        1,",
  "        &[KeyValue::new(",
  '            "payment.method",',
  "            order.payment_method.clone(),",
  "        )],",
  "    );",
  "    Ok(HttpResponse::Created().json(placed))",
  "}",
  "",
  '#[get("/orders/{id}/receipt")]',
  "async fn get_receipt(id: web::Path<u64>) -> Result<String, AppError> {",
  "    Err(AppError::Internal(format!(",
  '        "the receipt printer is offline for order {id}"',
  "    )))",
  "}",
  "",
  "#[derive(Debug)]",
  "enum AppError {",
  "    NotFound,",
  "    Payment(String),",
  "    Internal(String),",
  "}",
  "",
  "impl std::fmt::Display for AppError {",
  "    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {",
  "        match self {",
  '            AppError::NotFound => write!(f, "no such order"),',
  "            AppError::Payment(message) | AppError::Internal(message) => {",
  '                write!(f, "{message}")',
  "            }",
  "        }",
  "    }",
  "}",
  "",
  "impl ResponseError for AppError {",
  "    fn status_code(&self) -> actix_web::http::StatusCode {",
  "        match self {",
  "            AppError::NotFound => actix_web::http::StatusCode::NOT_FOUND,",
  "            AppError::Payment(_) => actix_web::http::StatusCode::BAD_GATEWAY,",
  "            AppError::Internal(_) => {",
  "                actix_web::http::StatusCode::INTERNAL_SERVER_ERROR",
  "            }",
  "        }",
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

const rootSpanBuilder: GuideSnippet = {
  id: "root-span-builder",
  language: "rust",
  title: "src/main.rs",
  code: [
    blockOf(mainFile, "/// The request's span, from tracing-actix-web", "}"),
    "",
    blockOf(mainFile, "/// Actix Web's headers, read by", "}"),
  ].join("\n"),
  check: "contained",
};

const charge: GuideSnippet = {
  id: "charge",
  language: "rust",
  title: "src/main.rs",
  code: blockOf(mainFile, '#[instrument(name = "checkout.charge"', "}"),
  check: "contained",
};

const getOrder: GuideSnippet = {
  id: "get-order",
  language: "rust",
  title: "src/main.rs",
  code: blockOf(mainFile, '#[get("/orders/{id}")]', "}"),
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
 * sends once Actix's graceful stop has let the last request finish.
 */
const SENT_AT_EXIT: Record<string, string> = {
  OTEL_BSP_SCHEDULE_DELAY: "30000",
  OTEL_BLRP_SCHEDULE_DELAY: "30000",
  OTEL_METRIC_EXPORT_INTERVAL: "60000",
};

// The caller's span a request continues: its traceparent, and its span's ID.
const CALLER_TRACEPARENT: string =
  "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";
const CALLER_SPAN_ID: string = "00f067aa0ba902b7";

// A Cargo project with the app's own crates, then the page's steps.
const COMMANDS: Array<VerificationCommand> = [
  { command: "cargo init --name orders-api --vcs none" },
  {
    command: [
      `cargo add ${pinnedCrate("actix-web")}`,
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

export const ActixWebGuide: OpenTelemetryGuide = {
  slug: "actix-web",
  seo: {
    title: "Actix Web OpenTelemetry: Tracing and Logs | OneUptime",
    description:
      "Add OpenTelemetry to Actix Web: a span per request from tracing-actix-web, traceparent read and sent, 5xx errors as exceptions, and logs with trace IDs.",
  },
  h1: "OpenTelemetry for Actix Web",
  lead: "Trace every request your Actix Web app serves, named after its route, with the calls it makes beneath it, and send traces, metrics and the tracing crate's events to OneUptime. `tracing-actix-web` opens each request's span, a few lines of your own connect it to the caller's trace and record its errors, and Actix's graceful stop lets the last batches leave.",
  cardDescription:
    "Actix Web 4: a span per request from tracing-actix-web, traceparent in and out, 5xx errors as exceptions, logs with trace IDs.",
  searchTerms: [
    "actix",
    "tracing-actix-web",
    "tracinglogger",
    "rootspanbuilder",
    "httpserver",
  ],
  highlights: [
    "Spans named after routes",
    "Callers' traces continued",
    "Actix Web 4",
  ],

  whatYouGet: {
    intro: `Each request becomes a trace, or joins its caller's, under the service named by \`OTEL_SERVICE_NAME\`, which ${SCREENS.services} lists after the first request. The example is an orders API on Actix Web 4, with its orders in memory and a payments API it calls with reqwest.`,
    traces:
      "A server span per request, named after its route, such as `GET /orders/{id}`, continuing the caller's trace when the request carries `traceparent`, and beneath it your own spans and a client span for each call, which sends `traceparent` on.",
    metrics:
      "The instruments you create, such as orders placed by payment method: neither Actix's middleware nor the OpenTelemetry crates record metrics of their own.",
    logs: "Each tracing event at INFO or above, from the handlers and from `tracing-actix-web`, with the trace and span IDs of the request it was written in.",
    exceptions: `A handler's error that Actix answers with a 5xx marks the request's span failed, and the root span builder below records it as an \`exception\` event, so ${SCREENS.exceptions} lists it.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "tracing-actix-web",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 5,
        duration: 88,
        source: "your code",
      },
      { name: "POST", depth: 2, start: 8, duration: 82, source: "your code" },
    ],
  },

  prerequisites: [
    RUST_PREREQUISITE,
    "An Actix Web 4 app; Actix Web 4.18 needs Rust 1.89 or later. Not a web service? The [Rust](/integrations/opentelemetry/rust) guide covers any program.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add the OpenTelemetry crates, the tracing bridges, `tracing-subscriber` and `tracing-actix-web`, at the versions this guide was checked with:",
    snippets: [install],
    notes: [
      "Add `tracing-actix-web` without its `opentelemetry_0_*` features: they stop at OpenTelemetry 0.32, whose types do not mix with 0.33's. The root span builder below does their work.",
    ],
  },

  configure: {
    intro:
      "Give the server the standard OpenTelemetry variables, which the exporters and the resource read, so no endpoint or key is compiled in:",
    tabs: otlpEnvironmentTabs({ serviceName: "orders-api" }),
    notes: [
      "Actix starts a worker per CPU core; the SDK's exporters run on threads of their own, shared by every worker.",
    ],
  },

  setup: {
    intro:
      "One file starts the SDK; `main` wraps the app in `TracingLogger` with a root span builder of its own, and shuts the SDK down after Actix stops. The handlers stay as they are.",
    steps: [
      {
        title: "Add a file that starts OpenTelemetry",
        body: "A provider and an OTLP exporter for each signal, the W3C propagator, and the tracing crate's spans and events sent through them; Actix's server is kept to its warnings, or its workers' starts and stops would arrive as logs:",
        snippets: [telemetry],
      },
      {
        title: "Wrap the app, and shut the SDK down after the server stops",
        body: "`TracingLogger::<TracedRequests>` opens a span per request through the builder defined beside it, and `run().await` returns once Actix has stopped:",
        snippets: [main],
        notes: [
          "Actix stops gracefully on SIGTERM, finishing the requests in flight, so the line after `run().await` is where the SDK sends what it still holds.",
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
      "`tracing-actix-web` opens each request's span; the builder connects it to OpenTelemetry. With this app, a request's trace holds:",
    rows: [
      {
        library: "`TracingLogger`",
        covers:
          "A server span per request, named after its route (`GET /orders/{id}`), with `http.route`, a request ID and, under OpenTelemetry's older HTTP names, `http.method` and `http.status_code`. A 5xx marks it failed; a request no route matched is named after Actix's default service, `GET default`.",
      },
      {
        library: "`TracedRequests`, the builder",
        covers:
          "The span's parent, read from the request's `traceparent`, and an `exception` event for each server error; the health check gets no span at all.",
      },
      {
        library: "`#[instrument]`, `info_span!`",
        covers:
          'The spans your handlers open, nested in the request\'s span, each field an attribute; a span with `otel.kind = "client"` is a client span.',
      },
      {
        library: "`info!` to `error!`",
        covers:
          "A log record for each event at INFO or above, with the request's trace and span IDs; `tracing-actix-web` adds one at WARN or ERROR for each request that failed.",
      },
    ],
    snippets: [rootSpanBuilder],
    notes: [
      "The builder starts from `tracing-actix-web`'s own `root_span!`, sets the parent the propagator read through `RequestHeaders`, and leaves the rest to `DefaultRootSpanBuilder`:",
    ],
  },

  manualSpans: {
    intro:
      "Inside a handler, open spans with the tracing crate: `#[instrument]` on a function, `info_span!` around a call, and `.instrument()` on a future that should run under one:",
    snippets: [charge],
    notes: [
      "The client span injects `traceparent` with `opentelemetry-http`'s `HeaderInjector`, so the payments API's spans join the request's trace.",
      "`skip_all` keeps the arguments out of the span, and the `fields` listed become its attributes, such as `order.item_count`.",
      "In the **Traces** explorer, `@order.item_count:2` lists the orders of two items.",
    ],
  },

  logs: {
    intro:
      "Log with tracing's macros inside handlers. Each event is sent as a record that carries the IDs of the request's span, with its fields as attributes:",
    snippets: [getOrder],
    notes: [
      "A missing order is a 404: `tracing-actix-web` logs it at WARN and leaves the span unfailed, as OpenTelemetry's conventions have it for a client error.",
      "An event written before the server starts, `listening on :8080` here, belongs to no request: it arrives without a trace ID.",
    ],
  },

  metrics: {
    intro:
      "Nothing records a metric for Actix, so the app's metrics are the instruments it creates. Create each once, in the app's state, and add to it where the work is done:",
    builtIn: [],
    snippets: [counter],
    notes: [
      "`web::Data` shares the state, and the counter in it, between Actix's workers.",
      "Metrics leave every 60 seconds, from the SDK's periodic reader, and a last time when `telemetry.shutdown()` runs.",
    ],
  },

  sampling: {
    intro:
      "The health check gets no span. To keep a share of the other requests' traces, set the standard sampler variables:",
    snippets: [sampling],
    notes: [
      "A request that continues a caller's trace keeps the caller's decision; of the rest, `parentbased_traceidratio` keeps one in four.",
      "Every order is still counted and every event still sent: sampling only drops spans.",
    ],
  },

  deploy: {
    intro:
      "Compile in the Rust image, ship the binary alone in distroless' `cc` image, and give the Deployment the key from a Secret:",
    snippets: [
      rustDockerfileSnippet({ binary: "orders-api", port: 8080 }),
      kubernetesManifestSnippet({
        name: "orders-api",
        image: "registry.example.com/orders-api:1.2.0",
        containerPort: 8080,
      }),
    ],
    notes: [
      "On SIGTERM, Actix waits up to 30 seconds for requests in flight, as long as Kubernetes waits before it kills the pod: shorten Actix's with `.shutdown_timeout(20)`, so the SDK's shutdown has time to send.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Request \`curl localhost:8080/orders/42\`, then open ${SCREENS.services}: \`orders-api\` is listed within a minute.`,
      },
      {
        title: "Open an order's trace",
        body: `Send a \`POST\` to \`/orders\`, then search ${SCREENS.traces} for \`POST /orders\`: \`checkout.charge\` is beneath it, and the payments API's \`POST\` beneath that.`,
      },
      {
        title: "Find the exception",
        body: `Request \`/orders/42/receipt\`: ${SCREENS.exceptions} lists the \`AppError\` its handler returned. No exception, but a failed span? The root span builder is not the one \`TracingLogger\` was given.`,
      },
    ],
  },

  troubleshooting: [
    {
      question:
        "Each request starts a trace, though its caller sent traceparent",
      answer:
        "`TracingLogger` uses `DefaultRootSpanBuilder`, which reads no `traceparent` without the OpenTelemetry features 0.33 cannot use. Give it `TracedRequests`, as above, which sets the parent from the propagator.",
    },
    {
      question:
        "Failed requests carry exception.message, but nothing is under Exceptions",
      answer:
        "`tracing-actix-web` records the error as attributes of the span, not as an event. OneUptime files `exception` events, which `TracedRequests` adds for every 5xx.",
    },
    {
      question: "Every start and stop logs a line per worker",
      answer:
        "Those are Actix's server lines at INFO, one per worker, such as `shutting down idle worker`. The `actix_server=warn` directive in `app_only()` keeps them out of what is sent.",
    },
    {
      question: "The last requests before a deploy never arrive",
      answer:
        "The pod was killed before `run().await` returned, so `telemetry.shutdown()` never ran: Actix's 30-second shutdown timeout and Kubernetes' grace period end together. Shorten Actix's, or lengthen the pod's.",
    },
    {
      question: "Some spans are named GET default",
      answer:
        "No route matched those requests, so Actix's default service answered them with a 404, and the span is named after it.",
    },
  ],

  faq: [
    {
      question: "Why not tracing-actix-web's OpenTelemetry features?",
      answer:
        "They are built for OpenTelemetry releases up to 0.32, and the crates here are 0.33: types from two releases do not mix. The builder's few lines do what the features would, with the 0.33 API.",
    },
    {
      question: "Are the attribute names OpenTelemetry's?",
      answer:
        "Mostly the older ones: `tracing-actix-web` writes `http.method`, `http.status_code` and `http.target` rather than `http.request.method`, `http.response.status_code` and `url.path`. Search by the names it writes.",
    },
    {
      question: "Which versions were checked?",
      answer:
        "Actix Web 4.18.1 with `tracing-actix-web` 0.7.25, OpenTelemetry 0.33.1 and `tracing-opentelemetry` 0.34, built with Rust 1.99.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: the server sends straight to OneUptime. Put a Collector in front of OneUptime when a fleet of services should hand off to one place that keeps the key and batches for all: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["rust", "axum", "gin", "spring-boot"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.exceptions],

  verification: {
    runtime: "rust",
    framework: { name: "Actix Web", package: "actix-web" },
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
        headers: { traceparent: CALLER_TRACEPARENT },
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
            "http.status_code": "200",
          },
        },
        { name: "GET /orders/{id}", parentSpanId: CALLER_SPAN_ID },
        {
          name: "GET /orders/{id}",
          attributes: { "http.status_code": "404" },
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
        { name: "GET default", attributes: { "http.status_code": "404" } },
      ],
      metrics: ["orders.placed"],
      logs: [
        {
          body: "loading order",
          hasTraceContext: true,
          attributes: { "order.id": "42" },
        },
        {
          body: "Error encountered while processing the incoming HTTP request",
          hasTraceContext: true,
        },
      ],
      resource: { "service.name": "orders-api" },
      untracedPaths: ["/healthz"],
      absentLogs: ["shutting down idle worker"],
    },
  },
};
