import { OpenTelemetryGuide, GuideSnippet } from "../GuideTypes";
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
  ELIXIR_EXPERIMENTAL_PACKAGES,
  ELIXIR_OPENTELEMETRY_PACKAGES,
  ELIXIR_PREREQUISITE,
  METRIC_READER_CONFIG_LINES,
  MIX_DEPS_GET_SNIPPET,
  elixirDockerfileSnippet,
  logHandlerLines,
  mixDependency,
  mixDependencyLines,
  releaseLines,
} from "../ElixirShared";

/*
 * A supervised OTP application that imports a supplier's prices into a
 * catalog as it starts and then every minute: one trace per import, the
 * supplier's API called with Req, each price saved in a task of its own.
 * The SDK starts as an application before this one; the application adds
 * a :logger handler for logs, and config/runtime.exs a metric reader.
 * Checked as `mix run --no-halt` runs it, stopped with SIGTERM.
 */

const mixExs: GuideSnippet = {
  id: "mix-exs",
  language: "elixir",
  title: "mix.exs",
  code: [
    "defmodule PriceImport.MixProject do",
    "  use Mix.Project",
    "",
    "  def project do",
    "    [",
    "      app: :price_import,",
    '      version: "0.1.0",',
    '      elixir: "~> 1.15",',
    "      start_permanent: Mix.env() == :prod,",
    "      deps: deps(),",
    ...releaseLines("price_import"),
    "    ]",
    "  end",
    "",
    "  def application do",
    "    [",
    "      extra_applications: [:logger],",
    "      mod: {PriceImport.Application, []}",
    "    ]",
    "  end",
    "",
    "  defp deps do",
    "    [",
    `      ${mixDependency("req")},`,
    "      # OpenTelemetry: the API and SDK, the OTLP exporter, Req's spans, the Task",
    "      # wrapper that carries a span into a process, and the experimental SDK that",
    "      # sends metrics and logs.",
    ...mixDependencyLines(
      [
        ...ELIXIR_OPENTELEMETRY_PACKAGES,
        "opentelemetry_req",
        "opentelemetry_process_propagator",
        ...ELIXIR_EXPERIMENTAL_PACKAGES,
      ],
      { endsTheList: true },
    ),
    "    ]",
    "  end",
    "end",
  ].join("\n"),
  check: "run",
};

const runtimeConfig: GuideSnippet = {
  id: "runtime-config",
  language: "elixir",
  title: "config/runtime.exs",
  code: [
    "import Config",
    "",
    "# Metrics through the experimental SDK, exported every minute unless the",
    "# standard variable says otherwise (the SDK does not read it itself).",
    ...METRIC_READER_CONFIG_LINES,
  ].join("\n"),
  check: "run",
};

const application: GuideSnippet = {
  id: "application",
  language: "elixir",
  title: "lib/price_import/application.ex",
  code: [
    "defmodule PriceImport.Application do",
    "  @moduledoc false",
    "",
    "  use Application",
    "",
    "  @impl true",
    "  def start(_type, _args) do",
    ...logHandlerLines(
      "Logger's events, as OpenTelemetry log records with the current span's IDs.",
    ),
    "",
    "    PriceImport.create_instruments()",
    "",
    "    Supervisor.start_link([PriceImport.Importer],",
    "      strategy: :one_for_one,",
    "      name: PriceImport.Supervisor",
    "    )",
    "  end",
    "end",
  ].join("\n"),
  check: "run",
};

const importer: GuideSnippet = {
  id: "importer",
  language: "elixir",
  title: "lib/price_import/importer.ex",
  code: [
    "defmodule PriceImport.Importer do",
    '  @moduledoc "Imports the supplier\'s prices as it starts, then every minute."',
    "",
    "  use GenServer",
    "",
    "  @every :timer.minutes(1)",
    "",
    "  def start_link(_options), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)",
    "",
    "  @impl true",
    "  def init(nil) do",
    "    send(self(), :import)",
    "    {:ok, nil}",
    "  end",
    "",
    "  @impl true",
    "  def handle_info(:import, state) do",
    "    PriceImport.run()",
    "    Process.send_after(self(), :import, @every)",
    "    {:noreply, state}",
    "  end",
    "end",
  ].join("\n"),
  check: "run",
};

const priceImportFile: string = [
  "defmodule PriceImport do",
  '  @moduledoc "Imports a supplier\'s prices into the catalog: one trace per run."',
  "",
  "  require Logger",
  "  require OpenTelemetry.Tracer, as: Tracer",
  "  require OpenTelemetryAPIExperimental.Counter, as: Counter",
  "",
  "  @minimum_price 100",
  "",
  "  def create_instruments do",
  '    Counter.create(:"prices.imported", %{',
  '      description: "Prices imported from the supplier",',
  '      unit: "{price}"',
  "    })",
  "  end",
  "",
  "  def run do",
  '    Tracer.with_span "prices.import" do',
  "      # Req's span for each call, and traceparent sent so the supplier's API joins in.",
  "      client =",
  '        Req.new(base_url: System.get_env("SUPPLIER_API_URL", "http://localhost:9000"))',
  "        |> OpentelemetryReq.attach(propagate_trace_headers: true)",
  "",
  '      prices = Req.get!(client, url: "/api/prices").body["items"]',
  '      Tracer.set_attribute(:"price.count", length(prices))',
  "",
  "      # Saved in parallel: the wrapper hands this span to each task it starts,",
  "      # so their spans nest beneath it.",
  "      imported =",
  "        prices",
  "        |> OpentelemetryProcessPropagator.Task.async_stream(&save_price(client, &1))",
  "        |> Enum.count(fn {:ok, saved?} -> saved? end)",
  "",
  '      Counter.add(:"prices.imported", imported, %{"supplier" => "acme"})',
  '      Logger.info("imported #{imported} of #{length(prices)} prices")',
  "    end",
  "  end",
  "",
  '  defp save_price(client, %{"id" => id, "total" => total} = price) do',
  '    Tracer.with_span "price.save", %{attributes: %{"price.sku": id}} do',
  "      if total < @minimum_price do",
  '        error = %ArgumentError{message: "#{id} is below the minimum price"}',
  "        Tracer.record_exception(error)",
  "        Tracer.set_status(:error, error.message)",
  '        Logger.warning("skipped a price: #{error.message}", price_sku: id)',
  "        false",
  "      else",
  '        Req.post!(client, url: "/api/catalog", json: price)',
  "        true",
  "      end",
  "    end",
  "  end",
  "end",
].join("\n");

const priceImport: GuideSnippet = {
  id: "price-import",
  language: "elixir",
  title: "lib/price_import.ex",
  code: priceImportFile,
  check: "run",
};

const savePrice: GuideSnippet = {
  id: "save-price",
  language: "elixir",
  title: "lib/price_import.ex",
  code: blockOf(priceImportFile, "defp save_price(", "end"),
  check: "contained",
};

const counter: GuideSnippet = {
  id: "counter",
  language: "elixir",
  title: "lib/price_import.ex",
  code: blockOf(priceImportFile, "def create_instruments do", "end"),
  check: "contained",
};

const tasks: GuideSnippet = {
  id: "tasks",
  language: "elixir",
  title: "lib/price_import.ex",
  code: [
    "      # Saved in parallel: the wrapper hands this span to each task it starts,",
    "      # so their spans nest beneath it.",
    "      imported =",
    "        prices",
    "        |> OpentelemetryProcessPropagator.Task.async_stream(&save_price(client, &1))",
    "        |> Enum.count(fn {:ok, saved?} -> saved? end)",
  ].join("\n"),
  check: "contained",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "mix run --no-halt",
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
  title: "What the console shows",
  code: [
    "[info] client error exporting {:failed_connect,",
    " [",
    '   {:to_address, {~c"localhost", 4318}},',
    "   {:inet6, [:inet6], :econnrefused},",
    "   {:inet, [:inet], :econnrefused}",
    " ]}",
  ].join("\n"),
  check: "illustrative",
};

const keyRefused: GuideSnippet = {
  id: "key-refused",
  language: "text",
  title: "What the console shows",
  code: [
    "[info] error response from service exported to status=401",
    '  {"message":"Invalid or missing x-oneuptime-token"}',
  ].join("\n"),
  check: "illustrative",
};

export const ElixirGuide: OpenTelemetryGuide = {
  slug: "elixir",
  seo: {
    title: "Elixir OpenTelemetry: Spans, Metrics, Logger | OneUptime",
    description:
      "Send traces, metrics and Logger records from an Elixir app to OneUptime: the OpenTelemetry SDK in an OTP release, Req client spans, and spans that follow tasks.",
  },
  h1: "OpenTelemetry for Elixir",
  lead: "Send traces, metrics and logs from any Elixir application to OneUptime. The SDK starts as an OTP application before yours and reads the standard variables, `Tracer.with_span` opens your own spans, Req's calls carry `traceparent`, and a `:logger` handler sends Logger's events with the IDs of the span they were written in.",
  cardDescription:
    "Any OTP application: the SDK in the release, your own spans with Tracer, Req client spans, and Logger records with trace IDs.",
  searchTerms: [
    "erlang",
    "beam",
    "otp",
    "mix release",
    "genserver",
    "logger",
    "req",
  ],
  highlights: [
    "An OTP application of its own",
    "Spans that follow tasks",
    "Elixir 1.15 and later",
  ],

  whatYouGet: {
    intro: `An Elixir application reports as one service, named by \`OTEL_SERVICE_NAME\`, which ${SCREENS.services} lists once it first sends. The example is a supervised worker that imports a supplier's prices into a catalog every minute, one trace per import; a Phoenix app gets its request spans from the [Phoenix](/integrations/opentelemetry/phoenix) guide.`,
    traces:
      "The spans your code opens with `Tracer.with_span`, nested as the calls nest, in a task too when the task is started through the wrapper, with their attributes; and a client span for each request Req makes, which sends `traceparent` along.",
    metrics:
      "The instruments you create with the experimental metrics API, such as a count of prices imported: the libraries' instrumentation records spans only.",
    logs: "Every event Logger lets through, as a log record with the IDs of the span it was written in, and Logger's metadata as its attributes.",
    exceptions: `An exception recorded on a span with \`Tracer.record_exception\` marks the span failed, with the exception's module and message, and ${SCREENS.exceptions} lists it.`,
  },

  exampleTrace: {
    caption: "One import of the supplier's prices, as its trace shows it",
    spans: [
      {
        name: "prices.import",
        depth: 0,
        start: 0,
        duration: 100,
        source: "your code",
      },
      { name: "GET", depth: 1, start: 3, duration: 34, source: "Req" },
      {
        name: "price.save",
        depth: 1,
        start: 40,
        duration: 52,
        source: "your code",
      },
      { name: "POST", depth: 2, start: 43, duration: 46, source: "Req" },
      {
        name: "price.save",
        depth: 1,
        start: 40,
        duration: 4,
        source: "your code",
        isError: true,
      },
    ],
  },

  prerequisites: [
    ELIXIR_PREREQUISITE,
    "An OTP application built with Mix, with a supervision tree such as `mix new --sup` creates: a worker, a queue's consumer, a service. A Phoenix app? The [Phoenix](/integrations/opentelemetry/phoenix) guide adds its request spans.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add the OpenTelemetry packages to `mix.exs`, at the versions this guide was checked with, and in the release, start the exporter before the SDK:",
    snippets: [mixExs, MIX_DEPS_GET_SNIPPET],
    notes: [
      "`opentelemetry_api` is what your code and the libraries call, `opentelemetry` is the SDK that records and batches, and `opentelemetry_exporter` sends OTLP. The `_experimental` pair adds metrics and logs, which the stable SDK leaves out.",
      "The SDK is an application of its own, started before yours, so a span opened in `start/2` already goes somewhere. In a release, `applications` starts the exporter's application first and makes the SDK's `:temporary`, so that its crash stops nothing else.",
    ],
  },

  configure: {
    intro:
      "The SDK, the exporters and the resource read the standard OpenTelemetry variables, so nothing of OneUptime's is in the code or in `config/`:",
    tabs: otlpEnvironmentTabs({ serviceName: "price-import" }),
    notes: [
      "A variable takes precedence over the same setting in `config/`, such as the exporter's `otlp_endpoint`, so one release runs wherever the variables are set.",
    ],
  },

  setup: {
    intro:
      "Traces need no code beyond your spans: the SDK sends them as it starts. Metrics and logs come from the experimental SDK, which a reader in `config/runtime.exs` and a `:logger` handler set up.",
    steps: [
      {
        title: "Add the metric reader to config/runtime.exs",
        body: "A reader that exports through OTLP over HTTP. The experimental SDK takes its interval from the configuration alone, so the file reads the standard variable:",
        snippets: [runtimeConfig],
      },
      {
        title:
          "Add the log handler, and create the instruments, as the application starts",
        body: "A `:logger` handler turns each event into a log record; the counter is created once, before the supervisor starts the worker:",
        snippets: [application],
        notes: [
          "The handler sends what it holds every second and sends nothing at shutdown: a second's records at most are lost as the node stops.",
        ],
      },
      {
        title: "Run the work under the supervisor",
        body: "The worker imports as it starts, then once a minute. Nothing starts a trace in a worker, so each import opens one of its own:",
        snippets: [importer, priceImport],
      },
      {
        title: "Run it",
        body: "With the variables above exported:",
        snippets: [run],
        notes: [
          "`--no-halt` keeps the node running after the application starts. A plain `mix run` stops it at once, before the first batch leaves.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "No Elixir library is traced by itself: each one's instrumentation package listens to the `:telemetry` events it sends. With this app, a trace holds:",
    rows: [
      {
        library: "`Tracer.with_span`",
        covers:
          "A span for each block, named as you name it and current for the code inside, so what that code records nests beneath it.",
      },
      {
        library: "`opentelemetry_req`",
        covers:
          "A client span for each request of a Req client it is attached to, named after the method, with `url.full` and the status code; `propagate_trace_headers: true` sends `traceparent`.",
      },
      {
        library: "`opentelemetry_process_propagator`",
        covers:
          "Task's functions, such as `async_stream`, that hand the current span to each process they start: without them, a task's spans start traces of their own.",
      },
      {
        library: "`otel_log_handler`",
        covers:
          "A log record for each Logger event, with the trace and span IDs of the process it was written in and Logger's metadata, such as `price_sku`, as attributes.",
      },
    ],
    snippets: [tasks],
    notes: [
      "A span is current only in the process that opened it. The wrapper passes it to each task, as here, where every price is saved in a task of its own:",
    ],
  },

  manualSpans: {
    intro:
      "Open a span with `Tracer.with_span` around a block, with its attributes. An error you handle is recorded on the span with `record_exception` and `set_status`:",
    snippets: [savePrice],
    notes: [
      "`with_span` ends its span when the block ends, an exception included, but records nothing about the exception: rescue it and record it as above.",
      "`record_exception` adds an `exception` event with the exception's module, `Elixir.ArgumentError`, and its message, which OneUptime files under **Exceptions**.",
      "Search attributes in the **Traces** explorer, such as `@price.sku:inv_2`.",
    ],
  },

  logs: {
    intro:
      "Log with Logger as you do. Each event becomes a log record that carries the IDs of the span current in its process, and its metadata go along as attributes:",
    snippets: [],
    notes: [
      "`Logger.warning(..., price_sku: id)` makes `price_sku` an attribute of the record, beside its body.",
      "Logger's own metadata go along too: the module, function and line the event was written in, and the process.",
      "The console still prints every event: the handler is added beside Logger's default one, and the level Logger is set to applies to both.",
      "The SDK's own reports are events too, so they are sent as well, such as `Exporter otel_exporter_logs_otlp successfully initialized` as the node starts.",
    ],
  },

  metrics: {
    intro:
      "The app's metrics are the instruments it creates with the experimental API. Create each once as the application starts, then add to it by name:",
    builtIn: [],
    snippets: [counter],
    notes: [
      '`Counter.add(:"prices.imported", imported, %{"supplier" => "acme"})` adds to it, with an attribute that has a handful of values.',
      "The reader exports every 60 seconds and sends nothing at shutdown: keep `OTEL_METRIC_EXPORT_INTERVAL` short where a node stops often.",
    ],
  },

  sampling: {
    intro:
      "Every import is traced in full. For work that runs often, the SDK reads the standard sampler variables:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps one trace in four, picked by trace ID, and follows the caller's decision for a trace it continues.",
      "The variables take the place of a `sampler` set in `config/`. Records and the counter are not sampled: `prices.imported` still counts every price.",
    ],
  },

  deploy: {
    intro:
      "Build the release in the Elixir image and run it from Debian's slim one, which holds the libraries the runtime links; one pod runs the importer, with the key in a Secret:",
    snippets: [
      elixirDockerfileSnippet("price_import"),
      kubernetesManifestSnippet({
        name: "price-import",
        image: "registry.example.com/price-import:0.3.0",
        replicas: 1,
      }),
    ],
    notes: [
      "The release holds the Erlang runtime it was built with, so the image needs no Elixir: build it on the Debian release the runtime image uses, trixie here.",
      "On SIGTERM the node stops its applications in turn, and the SDK's batch processor sends its spans as it stops: give the pod the 30 seconds Kubernetes waits by default.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Start the worker",
        body: `Then open ${SCREENS.services}: \`price-import\` is listed within a minute. Nothing there? The console shows any export error.`,
      },
      {
        title: "Open an import's trace",
        body: `In ${SCREENS.traces}, search for \`prices.import\`: the supplier's \`GET\` sits beneath it, then a \`price.save\` for each price, though each ran in a task, the first with its \`POST\`.`,
      },
      {
        title: "Find the skipped price",
        body: `${SCREENS.exceptions} lists the \`ArgumentError\`, \`inv_2 is below the minimum price\`; in ${SCREENS.logs}, the \`skipped a price\` record opens the same trace.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "A task's spans start traces of their own",
      answer:
        "The task was started with Elixir's `Task`, which hands it no context. Start it with `OpentelemetryProcessPropagator.Task`, whose functions match `Task`'s, or attach the context yourself with `OpenTelemetry.Ctx.attach/1` in the new process.",
    },
    {
      question: "Spans arrive, metrics and logs do not",
      answer:
        "Metrics need the reader in `config/runtime.exs`, and logs the handler added in `start/2`: the stable SDK sends traces only. Give the handler its `exporter`, as above: without one, it sends over gRPC.",
    },
    {
      question:
        "The console shows “client error exporting {:failed_connect, ...}”",
      answer:
        "Nothing answers at the endpoint. With `OTEL_EXPORTER_OTLP_ENDPOINT` missing from the node's environment, the exporters send to `localhost:4318`:",
      snippets: [networkError],
    },
    {
      question:
        "The console repeats “error response from service exported to status=401”",
      answer:
        "OneUptime refused the key. `OTEL_EXPORTER_OTLP_HEADERS` must be `x-oneuptime-token=` and the **Secret Key** of a **Server** key. The line repeats because each refused export is logged, and that record is sent in turn:",
      snippets: [keyRefused],
    },
    {
      question: "The last minute's metrics never arrive after a deploy",
      answer:
        "The experimental metrics SDK sends nothing at shutdown, so what it counted since its last export is lost when the node stops. A shorter `OTEL_METRIC_EXPORT_INTERVAL` loses less.",
    },
  ],

  faq: [
    {
      question: "Does this work for an Erlang application?",
      answer:
        "Yes: the SDK, the exporter and the experimental packages are written in Erlang, and an Erlang release sets them up in `sys.config` with the same keys as `config/runtime.exs` here. The macros are `?with_span` and `?set_attribute` from `opentelemetry_api`'s header.",
    },
    {
      question: "Is there automatic instrumentation for Elixir?",
      answer:
        "Not as an agent: each library has an instrumentation package that turns its `:telemetry` events into spans, such as Req's here, and Phoenix's, Bandit's and Ecto's in the [Phoenix](/integrations/opentelemetry/phoenix) guide.",
    },
    {
      question: "Which versions were checked?",
      answer:
        "Elixir 1.20 on Erlang/OTP 29, with the API 1.5.0, the SDK 1.7.0, the exporter 1.11.0 and the experimental packages 0.6.0, `opentelemetry_req` 1.0.0 and Req 0.7.5.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: the node sends straight to OneUptime from the SDK's own processes. A Collector helps when many services should hand their telemetry to one place that holds the key: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["phoenix", "rust", "go", "python"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.exceptions],

  verification: {
    runtime: "elixir",
    framework: { name: "Elixir" },
    files: [
      { path: "mix.exs", snippet: "mix-exs" },
      // mix format at the page's width: the code shown is as it writes it.
      {
        path: ".formatter.exs",
        content: [
          "[",
          '  inputs: ["{mix,.formatter}.exs", "{config,lib,test}/**/*.{ex,exs}"],',
          "  line_length: 87",
          "]",
        ].join("\n"),
      },
      { path: "config/runtime.exs", snippet: "runtime-config" },
      { path: "lib/price_import.ex", snippet: "price-import" },
      { path: "lib/price_import/application.ex", snippet: "application" },
      { path: "lib/price_import/importer.ex", snippet: "importer" },
    ],
    stubApiPort: 9000,
    commands: [
      { snippet: "deps-get" },
      // The code is as mix format writes it, and compiles without a warning.
      { command: "mix format --check-formatted" },
      { command: "mix compile --warnings-as-errors" },
      { snippet: "run", isServer: true, readyText: "imported 1 of 2 prices" },
    ],
    requests: [],
    expect: {
      spans: [
        { name: "prices.import", attributes: { "price.count": "2" } },
        {
          name: "GET",
          attributes: {
            "url.full": "http://localhost:9000/api/prices",
            "http.response.status_code": "200",
          },
          parent: "prices.import",
        },
        {
          name: "price.save",
          attributes: { "price.sku": "inv_1" },
          hasException: false,
          parent: "prices.import",
        },
        {
          name: "POST",
          attributes: { "url.full": "http://localhost:9000/api/catalog" },
          parent: "price.save",
        },
        {
          name: "price.save",
          attributes: { "price.sku": "inv_2" },
          hasException: true,
          exceptionMessage: "inv_2 is below the minimum price",
          parent: "prices.import",
        },
      ],
      metrics: ["prices.imported"],
      logs: [
        {
          body: "skipped a price: inv_2 is below the minimum price",
          hasTraceContext: true,
          attributes: { price_sku: "inv_2" },
        },
        { body: "imported 1 of 2 prices", hasTraceContext: true },
      ],
      resource: { "service.name": "price-import" },
    },
  },
};
