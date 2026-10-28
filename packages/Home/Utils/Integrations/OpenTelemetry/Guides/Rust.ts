import { OpenTelemetryGuide, GuideSnippet } from "../GuideTypes";
import {
  DOCS,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesCronJobSnippet,
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
 * Any Rust program: a job that copies invoices from a billing API into a
 * ledger, one trace per run. telemetry.rs starts the SDK and bridges the
 * tracing crate's spans and events into it; each HTTP call is a client
 * span that sends traceparent along; the job shuts the SDK down before
 * main returns. Checked with export delays longer than the run, so what
 * arrives is what the shutdown sends.
 */

const install: GuideSnippet = cargoAddSnippet("install", [
  ...RUST_OPENTELEMETRY_CRATES,
  TRACING_SUBSCRIBER,
]);

const telemetry: GuideSnippet = rustTelemetrySnippet("invoice-sync");

const mainFile: string = [
  "mod telemetry;",
  "",
  "use opentelemetry::trace::Status;",
  "use opentelemetry::{KeyValue, global};",
  "use opentelemetry_http::HeaderInjector;",
  "use reqwest::blocking::{Client, Response};",
  "use serde::Deserialize;",
  "use tracing::{Span, error, info, info_span, instrument};",
  "use tracing_opentelemetry::OpenTelemetrySpanExt;",
  "",
  "#[derive(Deserialize)]",
  "struct Invoice {",
  "    id: String,",
  "    total: u64,",
  "}",
  "",
  "#[derive(Deserialize)]",
  "struct InvoiceList {",
  "    items: Vec<Invoice>,",
  "}",
  "",
  "fn main() -> Result<(), Box<dyn std::error::Error>> {",
  "    let telemetry = telemetry::init()?;",
  "    let result = sync_invoices();",
  "    // Before main returns: the run's spans, metrics and log records leave here.",
  "    telemetry.shutdown();",
  "    result",
  "}",
  "",
  "// One run, one trace: the GET, then a span for each invoice, its POST beneath it.",
  '#[instrument(name = "invoices.sync", fields(invoice.count))]',
  "fn sync_invoices() -> Result<(), Box<dyn std::error::Error>> {",
  "    let billing =",
  '        std::env::var("BILLING_API_URL").unwrap_or("http://localhost:9000".into());',
  "    let client = Client::new();",
  '    let synced = global::meter("invoice-sync")',
  '        .u64_counter("invoices.synced")',
  '        .with_description("Invoices copied to the ledger")',
  "        .build();",
  "",
  "    let invoices: InvoiceList =",
  '        send(&client, "GET", &format!("{billing}/api/invoices"))?.json()?;',
  '    Span::current().record("invoice.count", invoices.items.len());',
  "",
  "    for invoice in &invoices.items {",
  '        let span = info_span!("invoice.post", invoice.id = %invoice.id);',
  "        let _entered = span.enter();",
  "",
  "        if invoice.total < 100 {",
  '            let message = format!("{} is below the minimum total", invoice.id);',
  "            // The span records it as an exception, and is marked failed.",
  "            span.add_event(",
  '                "exception",',
  "                vec![",
  '                    KeyValue::new("exception.type", "InvoiceRejected"),',
  '                    KeyValue::new("exception.message", message.clone()),',
  "                ],",
  "            );",
  "            span.set_status(Status::error(message.clone()));",
  '            error!(invoice.id = %invoice.id, "skipped an invoice: {message}");',
  "            continue;",
  "        }",
  "",
  '        send(&client, "POST", &format!("{billing}/api/ledger"))?;',
  '        synced.add(1, &[KeyValue::new("invoice.source", "billing")]);',
  "    }",
  "",
  '    info!("synced {} invoices", invoices.items.len());',
  "    Ok(())",
  "}",
  "",
  "// Each call as a client span, traceparent sent so the service called joins the trace.",
  "fn send(client: &Client, method: &str, url: &str) -> reqwest::Result<Response> {",
  "    let span = info_span!(",
  '        "http.client",',
  "        otel.name = method,",
  '        otel.kind = "client",',
  "        http.request.method = method,",
  "        url.full = url,",
  "        http.response.status_code = tracing::field::Empty,",
  "    );",
  "    let _entered = span.enter();",
  "",
  "    let mut headers = reqwest::header::HeaderMap::new();",
  "    global::get_text_map_propagator(|propagator| {",
  "        propagator.inject_context(&span.context(), &mut HeaderInjector(&mut headers));",
  "    });",
  "    let method =",
  '        reqwest::Method::from_bytes(method.as_bytes()).expect("an HTTP method");',
  "    let response = client.request(method, url).headers(headers).send()?;",
  '    span.record("http.response.status_code", response.status().as_u16());',
  "    response.error_for_status()",
  "}",
].join("\n");

const main: GuideSnippet = {
  id: "main",
  language: "rust",
  title: "src/main.rs",
  code: mainFile,
  check: "run",
};

const invoiceLoop: GuideSnippet = {
  id: "invoice-loop",
  language: "rust",
  title: "src/main.rs",
  code: blockOf(mainFile, "for invoice in &invoices.items {", "}"),
  check: "contained",
};

const clientSpan: GuideSnippet = {
  id: "client-span",
  language: "rust",
  title: "src/main.rs",
  code: blockOf(mainFile, "fn send(", "}"),
  check: "contained",
};

const counter: GuideSnippet = {
  id: "counter",
  language: "rust",
  title: "src/main.rs",
  code: [
    '    let synced = global::meter("invoice-sync")',
    '        .u64_counter("invoices.synced")',
    '        .with_description("Invoices copied to the ledger")',
    "        .build();",
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

const networkError: GuideSnippet = {
  id: "network-error",
  language: "text",
  title: "What the job prints",
  code: [
    'WARN opentelemetry-otlp: name="Export.Failed.Exhausted" retries=3 OTLP export',
    "  exhausted retries - telemetry data will be lost",
    'ERROR opentelemetry_sdk: name="BatchSpanProcessor.ExportError"',
    '  error="Operation failed: HTTP export failed: network error"',
  ].join("\n"),
  check: "illustrative",
};

const keyRefused: GuideSnippet = {
  id: "key-refused",
  language: "text",
  title: "What the job prints",
  code: [
    'ERROR opentelemetry_sdk: name="BatchSpanProcessor.ExportError"',
    '  error="Operation failed: HTTP export failed with status code: 401"',
  ].join("\n"),
  check: "illustrative",
};

/*
 * Export intervals longer than the job runs: what arrives is what
 * shutdown() sends as the job ends, not what a timer sent along the way.
 */
const SENT_AT_EXIT: Record<string, string> = {
  OTEL_BSP_SCHEDULE_DELAY: "30000",
  OTEL_BLRP_SCHEDULE_DELAY: "30000",
  OTEL_METRIC_EXPORT_INTERVAL: "60000",
};

export const RustGuide: OpenTelemetryGuide = {
  slug: "rust",
  seo: {
    title: "Rust OpenTelemetry with the tracing Crate | OneUptime",
    description:
      "Send traces, metrics and logs from Rust to OneUptime: the OpenTelemetry SDK, the tracing crate's spans and events through its bridges, and a flush before exit.",
  },
  h1: "OpenTelemetry for Rust",
  lead: "Send traces, metrics and logs from any Rust program to OneUptime through the `tracing` crate you already use. One file starts the OpenTelemetry SDK and bridges tracing's spans and events into it, your own spans are `#[instrument]` and `info_span!`, and a shutdown before `main` returns sends what is left.",
  cardDescription:
    "Any Rust program: the SDK in one file, the tracing crate's spans and events bridged into it, and a flush before exit.",
  searchTerms: [
    "tracing",
    "tracing-opentelemetry",
    "instrument",
    "cargo",
    "reqwest",
    "opentelemetry-otlp",
  ],
  highlights: [
    "The tracing crate, bridged",
    "Logs with trace IDs",
    "Rust 1.85 and later",
  ],

  whatYouGet: {
    intro: `A Rust program reports as one service, named by \`OTEL_SERVICE_NAME\`, in ${SCREENS.services} after it first sends. The example is a job that copies invoices from a billing API into a ledger, one trace per run; a web service on Axum or Actix Web gets its request spans from those frameworks' guides.`,
    traces:
      "The spans your code opens with the tracing crate, `#[instrument]` and `info_span!`, nested as the code nests them, with their fields as attributes, and a client span for each HTTP call, which sends `traceparent` along.",
    metrics:
      "The instruments you create from a meter, such as a count of invoices synced: none of Rust's OpenTelemetry crates records a metric by itself.",
    logs: "Every tracing event at INFO or above, from `info!` to `error!`, as a log record with the IDs of the span it was written in and its fields as attributes.",
    exceptions: `An error you record on a span, as an \`exception\` event with its type and message, marks the span failed, and ${SCREENS.exceptions} lists it.`,
  },

  exampleTrace: {
    caption: "One run of the invoice job, as its trace shows it",
    spans: [
      {
        name: "invoices.sync",
        depth: 0,
        start: 0,
        duration: 100,
        source: "your code",
      },
      { name: "GET", depth: 1, start: 3, duration: 31, source: "your code" },
      {
        name: "invoice.post",
        depth: 1,
        start: 38,
        duration: 30,
        source: "your code",
      },
      { name: "POST", depth: 2, start: 40, duration: 26, source: "your code" },
      {
        name: "invoice.post",
        depth: 1,
        start: 72,
        duration: 6,
        source: "your code",
        isError: true,
      },
    ],
  },

  prerequisites: [
    RUST_PREREQUISITE,
    "A Rust program built with Cargo, which records with the `tracing` crate or can: a job, a command-line tool, a worker. A web service on Axum or Actix Web? Their guides add the request spans.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add the OpenTelemetry crates, the two tracing bridges and `tracing-subscriber`, at the versions this guide was checked with:",
    snippets: [install],
    notes: [
      "The OpenTelemetry crates are released together, at 0.33.1 here: keep them on the same version, since the types of two 0.x releases do not mix, and pick `tracing-opentelemetry` for that release.",
      "`opentelemetry-otlp` sends protobuf over HTTP by default, through a blocking `reqwest` client on the SDK's own threads, so the program needs no async runtime for it.",
    ],
  },

  configure: {
    intro:
      "The exporters and the resource take their settings from the standard OpenTelemetry variables, so the program holds no endpoint, key or service name:",
    tabs: otlpEnvironmentTabs({ serviceName: "invoice-sync" }),
    notes: [
      "Each exporter adds its signal's path, `/v1/traces`, `/v1/metrics` or `/v1/logs`, to `OTEL_EXPORTER_OTLP_ENDPOINT`, and sends `OTEL_EXPORTER_OTLP_HEADERS` with every request.",
    ],
  },

  setup: {
    intro:
      "Rust has no agent and no automatic instrumentation: the program starts the SDK itself, records its spans with the tracing crate, and shuts the SDK down before it exits.",
    steps: [
      {
        title: "Add a file that starts OpenTelemetry",
        body: "A provider and an OTLP exporter for each signal, the W3C propagator, and two layers that send tracing's spans and events through them:",
        snippets: [telemetry],
        notes: [
          "`app_only()` keeps the SDK's and its HTTP client's own events out of what is sent: without it, an export error, say, would come back as a log record and a span event to export.",
        ],
      },
      {
        title: "Start it in main, and shut it down before main returns",
        body: "`init()` first, then the work, then `shutdown()`, which sends what the providers still hold. Nothing starts a trace in a job, so the run is a span of its own:",
        snippets: [main],
        notes: [
          "`std::process::exit` skips everything after it, the shutdown included: return from `main` instead, as the error here does.",
        ],
      },
      {
        title: "Run it",
        body: "With the variables above exported, build and run it:",
        snippets: [run],
        notes: [
          "The batches leave every few seconds, and the shutdown sends what is left as the job ends, so one short run is seen whole.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "Nothing in Rust is traced without code: what arrives is what your code, and the crates it calls, record with the tracing crate. The two layers turn it into OpenTelemetry:",
    rows: [
      {
        library: "`#[instrument]`, `info_span!`",
        covers:
          "A span for each, named after the function or the name you give, with its fields as attributes, nested as the code nests them. `otel.name` and `otel.kind` set a span's name and kind.",
      },
      {
        library: "`info!`, `warn!`, `error!`",
        covers:
          "A log record for each event at INFO or above, through `OpenTelemetryTracingBridge`, with the IDs of the span it was written in; the event is also added to that span.",
      },
      {
        library: "Each span's place and time",
        covers:
          "The file and line that opened it, its thread, and `busy_ns` and `idle_ns`: how long it was entered, and how long it stood open but idle.",
      },
      {
        library: "Crates that record with tracing",
        covers:
          "Their spans and events join yours, beneath the span that called them, as far as the filter in `app_only()` lets them through.",
      },
    ],
    snippets: [clientSpan],
    notes: [
      'An HTTP client records no span of its own here, so `send` opens one with `otel.kind = "client"` and injects `traceparent` with `opentelemetry-http`\'s `HeaderInjector`:',
    ],
  },

  manualSpans: {
    intro:
      "Open spans with the tracing crate, as for logging: `#[instrument]` on a function, `info_span!` around a block. Whatever runs while a span is entered nests beneath it:",
    snippets: [invoiceLoop],
    notes: [
      '`add_event("exception", ...)` and `set_status`, from `OpenTelemetrySpanExt`, record the error under the names OpenTelemetry\'s conventions give it, so OneUptime files it under **Exceptions**.',
      "A field declared empty as the span opens, such as `invoice.count`, is filled later with `Span::current().record(...)`: tracing records no field it was not told of up front.",
      "Search fields in the **Traces** explorer as attributes, such as `@invoice.id:inv_2`.",
    ],
  },

  logs: {
    intro:
      "Log with tracing's macros as you do. Each event the filter lets through becomes a log record that carries the IDs of the span it was written in:",
    snippets: [],
    notes: [
      "The event's message is the record's body, and its fields, such as `invoice.id`, are its attributes.",
      "An event outside every span, such as one before the run's span opens, carries no trace ID.",
      "`tracing-subscriber`'s `fmt` layer still prints each event to the console: each layer has a filter of its own.",
    ],
  },

  metrics: {
    intro:
      "The program's metrics are the instruments it records. Create one from the global meter, once, and add to it where the work is done:",
    builtIn: [],
    snippets: [counter],
    notes: [
      "The periodic reader exports every 60 seconds, and once more in `shutdown()`.",
      "`invoice.source` has a few values, so the counter has a few series: an attribute with an ID in it would make one per invoice.",
    ],
  },

  sampling: {
    intro:
      "Every run is traced in full. For a job that runs often, the standard variables keep a share of its traces:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps one run in four, picked by trace ID, and follows the decision of a caller whose `traceparent` the program continues.",
      "Records and the counter are not sampled: `invoices.synced` still counts every invoice.",
    ],
  },

  deploy: {
    intro:
      "Build the release binary in the Rust image and run it from a distroless one; a Kubernetes CronJob starts it on its schedule, the key read from a Secret:",
    snippets: [
      rustDockerfileSnippet({ binary: "invoice-sync" }),
      kubernetesCronJobSnippet({
        name: "invoice-sync",
        image: "registry.example.com/invoice-sync:0.4.0",
        schedule: "*/15 * * * *",
      }),
    ],
    notes: [
      "distroless' `cc` image holds the C library the binary links and the CA certificates its HTTPS calls need, and nothing more.",
      "Each scheduled run is a pod that starts, sends its telemetry from `shutdown()` as it ends, and is gone.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Run the job once",
        body: `Then open ${SCREENS.services}: \`invoice-sync\` is listed within a minute. Nothing there? The job's console shows any export error the SDK met.`,
      },
      {
        title: "Open the run's trace",
        body: `In ${SCREENS.traces}, search for \`invoices.sync\`: the billing API's \`GET\` sits beneath it, then an \`invoice.post\` for each invoice, the first with its \`POST\`.`,
      },
      {
        title: "Find the rejected invoice",
        body: `${SCREENS.exceptions} lists \`InvoiceRejected\`, \`inv_2 is below the minimum total\`; in ${SCREENS.logs}, the \`skipped an invoice\` record opens the same trace.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "The job ends, and nothing arrives",
      answer:
        "The providers were never shut down, so what their batches held was lost as the program ended. Call `shutdown()` before `main` returns, on the error path too, and avoid `std::process::exit`.",
    },
    {
      question: "The called service's spans start a trace of their own",
      answer:
        "The call went out without `traceparent`. An HTTP client sends none by itself: inject it from the current span's context, as `send` does with `HeaderInjector`.",
    },
    {
      question: "Log records arrive without a trace ID",
      answer:
        "They were written outside any span, or by a thread the span was not entered on. A span entered with `enter()`, or a function under `#[instrument]`, makes its context current for the events inside.",
    },
    {
      question: "The job prints “HTTP export failed: network error”",
      answer:
        "Nothing answers at the endpoint. With `OTEL_EXPORTER_OTLP_ENDPOINT` missing from the job's environment, the exporters send to `localhost:4318`, retry three times, and give up:",
      snippets: [networkError],
    },
    {
      question: "The job prints “HTTP export failed with status code: 401”",
      answer:
        "OneUptime refused the key, and the exporter does not retry. `OTEL_EXPORTER_OTLP_HEADERS` must be `x-oneuptime-token=` and the **Secret Key** of a **Server** key:",
      snippets: [keyRefused],
    },
  ],

  faq: [
    {
      question: "Do I have to use the tracing crate?",
      answer:
        "No: the `opentelemetry` crate's own API, a tracer from `global::tracer` and its spans, works without it. The tracing crate is how most Rust code, and the crates it depends on, already record, so bridging it brings theirs along.",
    },
    {
      question: "Is there automatic instrumentation for Rust?",
      answer:
        "No: a Rust program is one compiled binary, with nothing to hook into as it runs. What comes closest are crates that record with tracing, and the middleware of web frameworks, as the [Axum](/integrations/opentelemetry/axum) and [Actix Web](/integrations/opentelemetry/actix-web) guides show.",
    },
    {
      question: "Which versions go together?",
      answer:
        "The OpenTelemetry crates on one 0.x release, 0.33.1 here, with `tracing-opentelemetry` 0.34, which is built for it. This guide was checked with Rust 1.99.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: the job sends straight to OneUptime as it ends. A Collector is useful where many programs should hand their telemetry to one place, which holds the key and batches for them: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["axum", "actix-web", "go", "python"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.exceptions],

  verification: {
    runtime: "rust",
    framework: { name: "Rust" },
    files: [
      { path: "src/telemetry.rs", snippet: "telemetry" },
      { path: "src/main.rs", snippet: "main" },
      // rustfmt at the page's width: the code shown is as rustfmt writes it.
      { path: "rustfmt.toml", content: "max_width = 87" },
    ],
    stubApiPort: 9000,
    commands: [
      { command: "cargo init --name invoice-sync --vcs none" },
      { snippet: "install" },
      {
        command: `cargo add ${pinnedCrate("reqwest")} --features blocking,json && cargo add ${pinnedCrate("serde")} --features derive`,
      },
      // The code is as rustfmt writes it, and builds without a warning.
      { command: "rustup component add rustfmt && cargo fmt --check" },
      {
        command:
          'set -o pipefail; cargo build --release 2>&1 | tee build.log && ! grep -q "^warning" build.log',
      },
      { snippet: "run", environment: SENT_AT_EXIT },
    ],
    requests: [],
    expect: {
      spans: [
        { name: "invoices.sync", attributes: { "invoice.count": "2" } },
        {
          name: "GET",
          attributes: {
            "http.request.method": "GET",
            "http.response.status_code": "200",
          },
          parent: "invoices.sync",
        },
        {
          name: "invoice.post",
          attributes: { "invoice.id": "inv_1" },
          hasException: false,
          parent: "invoices.sync",
        },
        {
          name: "POST",
          attributes: { "url.full": "http://localhost:9000/api/ledger" },
          parent: "invoice.post",
        },
        {
          name: "invoice.post",
          attributes: { "invoice.id": "inv_2" },
          hasException: true,
          exceptionMessage: "inv_2 is below the minimum total",
        },
      ],
      metrics: ["invoices.synced"],
      logs: [
        {
          body: "skipped an invoice: inv_2 is below the minimum total",
          hasTraceContext: true,
          attributes: { "invoice.id": "inv_2" },
        },
        { body: "synced 2 invoices", hasTraceContext: true },
      ],
      resource: { "service.name": "invoice-sync" },
    },
  },
};
