import { OpenTelemetryGuide, GuideSnippet } from "../GuideTypes";
import {
  DOCS,
  OTLP_HTTP_PROTOCOL_LINE,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";
import {
  DOTNET_PREREQUISITE,
  DOTNET_PROTOCOL_NOTE,
  dotnetAddPackageSnippet,
  dotnetDockerfileSnippet,
  dotnetWorkerProjectFile,
} from "../DotNetShared";

/*
 * A Worker Service, as `dotnet new worker` makes it, with two
 * BackgroundServices: one fetches new invoices from a billing API once a
 * minute and queues them, the other posts each to a ledger, continuing the
 * trace of the run that queued it. Checked with export delays longer than
 * the run, so what arrives is what the host sends as it stops on SIGTERM.
 */

const install: GuideSnippet = dotnetAddPackageSnippet("install", [
  "OpenTelemetry.Extensions.Hosting",
  "OpenTelemetry.Exporter.OpenTelemetryProtocol",
  "OpenTelemetry.Instrumentation.Http",
  "OpenTelemetry.Instrumentation.Runtime",
]);

const installHttp: GuideSnippet = dotnetAddPackageSnippet("install-http", [
  "Microsoft.Extensions.Http",
]);

const program: GuideSnippet = {
  id: "program",
  language: "csharp",
  title: "Program.cs",
  code: [
    "using System.Threading.Channels;",
    "using InvoiceWorker;",
    "using OpenTelemetry;",
    "using OpenTelemetry.Logs;",
    "using OpenTelemetry.Metrics;",
    "using OpenTelemetry.Trace;",
    "",
    "var builder = Host.CreateApplicationBuilder(args);",
    "",
    "builder.Services.AddOpenTelemetry()",
    "    .WithTracing(tracing => tracing",
    "        .AddSource(Worker.TelemetryName)",
    "        .AddHttpClientInstrumentation())",
    "    .WithMetrics(metrics => metrics",
    "        .AddMeter(Worker.TelemetryName)",
    "        .AddHttpClientInstrumentation()",
    "        .AddRuntimeInstrumentation())",
    "    .WithLogging(logging => { }, options => options.IncludeFormattedMessage = true)",
    "    .UseOtlpExporter();",
    "",
    'builder.Services.AddHttpClient("billing", client =>',
    "    client.BaseAddress = new Uri(",
    '        builder.Configuration["BILLING_API_URL"] ?? "http://localhost:9000"));',
    "builder.Services.AddSingleton(Channel.CreateUnbounded<LedgerEntry>());",
    "builder.Services.AddHostedService<Worker>();",
    "builder.Services.AddHostedService<LedgerWriter>();",
    "",
    "builder.Build().Run();",
  ].join("\n"),
  check: "run",
};

const worker: GuideSnippet = {
  id: "worker",
  language: "csharp",
  title: "Worker.cs",
  code: [
    "using System.Diagnostics;",
    "using System.Net.Http.Json;",
    "using System.Threading.Channels;",
    "",
    "namespace InvoiceWorker;",
    "",
    "public class Worker(",
    "    ILogger<Worker> logger,",
    "    IHttpClientFactory httpClients,",
    "    Channel<LedgerEntry> queue) : BackgroundService",
    "{",
    "    // The name Program.cs gives AddSource and AddMeter.",
    '    public const string TelemetryName = "InvoiceWorker";',
    "    public static readonly ActivitySource ActivitySource = new(TelemetryName);",
    "",
    "    protected override async Task ExecuteAsync(CancellationToken stoppingToken)",
    "    {",
    '        logger.LogInformation("Invoice worker started");',
    "        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));",
    "        do",
    "        {",
    "            await SyncAsync(stoppingToken);",
    "        }",
    "        while (await timer.WaitForNextTickAsync(stoppingToken));",
    "    }",
    "",
    "    private async Task SyncAsync(CancellationToken stoppingToken)",
    "    {",
    "        // No request starts a trace in a worker: each run of the job is one.",
    '        using var activity = ActivitySource.StartActivity("invoices.sync");',
    "        try",
    "        {",
    '            var billing = httpClients.CreateClient("billing");',
    "            var invoices = await billing.GetFromJsonAsync<InvoiceList>(",
    '                "/api/invoices", stoppingToken);',
    '            activity?.SetTag("invoice.count", invoices!.Items.Length);',
    "            foreach (var invoice in invoices.Items)",
    "            {",
    "                // Each entry carries the run's trace, as a W3C traceparent.",
    "                await queue.Writer.WriteAsync(",
    "                    new LedgerEntry(invoice, Activity.Current?.Id), stoppingToken);",
    "            }",
    '            logger.LogInformation("Queued {Count} invoices", invoices.Items.Length);',
    "        }",
    "        catch (HttpRequestException error)",
    "        {",
    "            // One failed run is recorded, and the worker carries on to the next.",
    "            activity?.AddException(error);",
    "            activity?.SetStatus(ActivityStatusCode.Error);",
    '            logger.LogError(error, "Invoice sync failed");',
    "        }",
    "    }",
    "}",
    "",
    "public record Invoice(string Id, int Total);",
    "public record InvoiceList(Invoice[] Items);",
  ].join("\n"),
  check: "run",
};

const ledgerWriter: GuideSnippet = {
  id: "ledger-writer",
  language: "csharp",
  title: "LedgerWriter.cs",
  code: [
    "using System.Diagnostics;",
    "using System.Diagnostics.Metrics;",
    "using System.Net.Http.Json;",
    "using System.Threading.Channels;",
    "",
    "namespace InvoiceWorker;",
    "",
    "// An invoice waiting to be posted, with the trace of the run that queued it.",
    "public record LedgerEntry(Invoice Invoice, string? TraceParent);",
    "",
    "public class LedgerWriter(",
    "    ILogger<LedgerWriter> logger,",
    "    IHttpClientFactory httpClients,",
    "    Channel<LedgerEntry> queue) : BackgroundService",
    "{",
    "    private static readonly Counter<long> InvoicesSynced =",
    "        new Meter(Worker.TelemetryName).CreateCounter<long>(",
    '            "invoices.synced", description: "Invoices copied to the ledger");',
    "",
    "    protected override async Task ExecuteAsync(CancellationToken stoppingToken)",
    "    {",
    '        var ledger = httpClients.CreateClient("billing");',
    "        await foreach (var entry in queue.Reader.ReadAllAsync(stoppingToken))",
    "        {",
    "            // Continue the run's trace: this span is a child of the one that",
    "            // queued the entry.",
    "            ActivityContext.TryParse(entry.TraceParent, null, out var queuedBy);",
    "            using var activity = Worker.ActivitySource.StartActivity(",
    '                "invoice.post", ActivityKind.Consumer, queuedBy);',
    '            activity?.SetTag("invoice.id", entry.Invoice.Id);',
    "            try",
    "            {",
    "                using var response = await ledger.PostAsJsonAsync(",
    '                    "/api/ledger", entry.Invoice, stoppingToken);',
    "                response.EnsureSuccessStatusCode();",
    "                InvoicesSynced.Add(",
    '                    1, new KeyValuePair<string, object?>("invoice.source", "billing"));',
    '                logger.LogInformation("Posted invoice {InvoiceId}", entry.Invoice.Id);',
    "            }",
    "            catch (HttpRequestException error)",
    "            {",
    "                activity?.AddException(error);",
    "                activity?.SetStatus(ActivityStatusCode.Error);",
    "                logger.LogError(",
    '                    error, "Could not post invoice {InvoiceId}", entry.Invoice.Id);',
    "            }",
    "        }",
    "    }",
    "}",
  ].join("\n"),
  check: "run",
};

const appSettings: GuideSnippet = {
  id: "appsettings",
  language: "json",
  title: "appsettings.json",
  code: [
    "{",
    '  "Logging": {',
    '    "LogLevel": {',
    '      "Default": "Information",',
    '      "Microsoft.Hosting.Lifetime": "Information",',
    '      "System.Net.Http.HttpClient": "Warning"',
    "    }",
    "  }",
    "}",
  ].join("\n"),
  check: "run",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "dotnet run",
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

export const DotNetWorkerServiceGuide: OpenTelemetryGuide = {
  slug: "dotnet-worker-service",
  seo: {
    title: ".NET Worker Service OpenTelemetry: Traces & Logs | OneUptime",
    description:
      "Trace a .NET Worker Service with OpenTelemetry: a trace per run of each BackgroundService, kept across queues, HttpClient calls, ILogger logs and metrics.",
  },
  h1: "OpenTelemetry for .NET Worker Services",
  lead: "Give each run of a `BackgroundService` its own trace, keep that trace when the work moves to another worker through a queue, and send the traces, metrics and `ILogger` logs to OneUptime. The host that runs your workers starts OpenTelemetry with them, and sends what is left when it stops.",
  cardDescription:
    "Background services on the .NET Generic Host: a trace per run, carried across queues, with logs and metrics.",
  searchTerms: [
    "backgroundservice",
    "hosted service",
    "generic host",
    "dotnet new worker",
    "channels",
    "queue consumer",
  ],
  highlights: ["BackgroundService", "A trace per run", "Across queues"],

  whatYouGet: {
    intro: `A Worker Service reports as one service, \`invoice-worker\` here, in ${SCREENS.services} after its first run. Its two workers fetch new invoices from a billing API once a minute and post each one to a ledger.`,
    traces:
      "A trace per run of the job, rooted at the `Activity` your `BackgroundService` starts, with a client span for every `HttpClient` call and the work other workers do for that run nested beneath it.",
    metrics:
      "`http.client.request.duration` for the calls the workers make, the runtime's garbage collections, heap and thread pool, and your own counters, such as invoices synced.",
    logs: "Every `ILogger` record the workers write, with its structured values as attributes; a record written during a run carries that run's trace ID.",
    exceptions: `A run or an entry that fails records its exception on its span and marks it failed, and \`LogError(error, ...)\` sends the record with the stack trace. ${SCREENS.exceptions} groups them.`,
  },

  exampleTrace: {
    caption: "One run of the invoice worker, as its trace shows it",
    spans: [
      {
        name: "invoices.sync",
        depth: 0,
        start: 0,
        duration: 100,
        source: "your code",
      },
      { name: "GET", depth: 1, start: 2, duration: 30, source: "httpclient" },
      {
        name: "invoice.post",
        depth: 1,
        start: 36,
        duration: 29,
        source: "your code",
      },
      { name: "POST", depth: 2, start: 38, duration: 25, source: "httpclient" },
      {
        name: "invoice.post",
        depth: 1,
        start: 68,
        duration: 30,
        source: "your code",
      },
      { name: "POST", depth: 2, start: 70, duration: 26, source: "httpclient" },
    ],
  },

  prerequisites: [
    DOTNET_PREREQUISITE,
    "A Worker Service, as `dotnet new worker` creates it, or any app that runs `BackgroundService` classes on `Host.CreateApplicationBuilder`.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add the SDK's hosting extensions, the OTLP exporter, and the instrumentations for `HttpClient` and the runtime:",
    snippets: [install, installHttp],
    notes: [
      "The second line adds `IHttpClientFactory`, which the workers below take their clients from; the worker template does not include it.",
    ],
  },

  configure: {
    intro:
      "`UseOtlpExporter()` reads the standard OpenTelemetry variables when the host starts:",
    tabs: otlpEnvironmentTabs({
      serviceName: "invoice-worker",
      extraLines: [OTLP_HTTP_PROTOCOL_LINE],
    }),
    notes: [DOTNET_PROTOCOL_NOTE],
  },

  setup: {
    intro:
      "Register OpenTelemetry on the host, and start an `Activity` in your worker for each run of its job.",
    steps: [
      {
        title: "Register OpenTelemetry on the host",
        body: "In `Program.cs`, before the workers, register the three signals and name the workers' source and meter:",
        snippets: [program],
        notes: [
          "The host starts OpenTelemetry before your workers, and disposes it after they stop.",
        ],
      },
      {
        title: "Start an Activity for each run",
        body: "A worker's loop starts no trace by itself: without one, each `HttpClient` call would be a trace of its own. Wrap every run in an `Activity`:",
        snippets: [worker],
        notes: [
          "`PeriodicTimer` runs the job once at start and then every minute; `WaitForNextTickAsync` returns `false` when the host stops, and the loop ends.",
          "Catch a failed run inside the loop: an exception that escapes `ExecuteAsync` stops the whole host.",
        ],
      },
      {
        title: "Run it",
        body: "Start the worker with the variables above. The first run's trace leaves within seconds:",
        snippets: [run],
      },
    ],
  },

  autoInstrumentation: {
    intro: "With the host registration above, these are traced and measured:",
    rows: [
      {
        library: "`HttpClient`",
        covers:
          "A client span per call (`GET`, `POST`), nested under the span that made it, with `traceparent` sent to the service called.",
      },
      {
        library: "`ILogger`",
        covers:
          "Every record, with its structured values, and the trace ID of the span it was written in.",
      },
      {
        library: "The runtime",
        covers:
          "Garbage collections, heap, thread pool, JIT and exceptions, as `dotnet.*` metrics.",
      },
      {
        library: "SQL Server, EF Core, Redis, message brokers",
        covers:
          "With their instrumentation package and its `Add...Instrumentation()` call, or through the library's own `ActivitySource`, named in `AddSource`.",
      },
    ],
    snippets: [],
    notes: [
      "Many .NET clients, Azure's SDK and `Npgsql` among them, publish their own `ActivitySource`: add its name with `AddSource` to see their spans.",
    ],
  },

  manualSpans: {
    intro:
      "When a run hands work to another worker, through a `Channel` here or a message broker, send the run's trace along and continue it on the other side. `LedgerWriter` posts each queued invoice in a span of its own, a child of the run that queued it:",
    snippets: [ledgerWriter],
    notes: [
      "`Activity.Current?.Id` is the W3C `traceparent` of the current span, and `ActivityContext.TryParse` reads it back: the same header a broker's message can carry between processes.",
      "`ActivityKind.Consumer` marks the span as work taken from a queue: its kind is `consumer`, where a run's own span is `internal`.",
      "`SetTag` adds attributes as you learn them: find an invoice's span in the **Traces** explorer with `@invoice.id:inv_1`.",
    ],
  },

  logs: {
    intro:
      "`WithLogging` sends every `ILogger` record to OneUptime beside the console. `IHttpClientFactory` writes four records per call at `Information`; keep it at `Warning`:",
    snippets: [appSettings],
    notes: [
      "`Invoice worker started` carries no trace ID: it is written before the first run's activity starts.",
      "`Posted invoice inv_1` carries the trace of the run that queued the invoice, though another worker wrote it.",
      'Pass the exception first, as `logger.LogError(error, "Invoice sync failed")`, to send its type, message and stack trace.',
    ],
  },

  metrics: {
    intro: "Exported every 60 seconds, and once more as the host stops:",
    builtIn: [
      {
        name: "http.client.request.duration",
        description:
          "Each call the workers make, by server, method and status code: a slow billing API shows here before the runs fall behind.",
      },
      {
        name: "dotnet.gc.collections",
        description:
          "Garbage collections by generation, beside `dotnet.process.memory.working_set`: a worker that leaks shows a heap that only grows.",
      },
      {
        name: "dotnet.thread_pool.thread.count",
        description:
          "Thread-pool threads, beside `dotnet.thread_pool.queue.length` for the work waiting for one.",
      },
    ],
    snippets: [],
    notes: [
      "Count what each run does with your own `Meter`, as `invoices.synced` above: a run that found nothing to post shows as a flat line, not a missing one.",
    ],
  },

  sampling: {
    intro:
      "A worker that runs once a minute sends little; one that handles thousands of messages can send a lot. Keep a share of new traces with the standard variables:",
    snippets: [sampling],
    notes: [
      "A span started with a parsed parent, as `LedgerWriter`'s, follows its parent's decision: a run that was not kept keeps none of its entries.",
      "Metrics and logs are not sampled: `invoices.synced` still counts every invoice.",
    ],
  },

  deploy: {
    intro:
      "Publish in the SDK image and run in the smaller runtime image: a worker listens on no port. Run it as a Deployment, with the key in a Secret:",
    snippets: [
      dotnetDockerfileSnippet({
        assembly: "InvoiceWorker.dll",
        port: 8080,
        runtimeImage: "runtime",
      }),
      kubernetesManifestSnippet({
        name: "invoice-worker",
        image: "registry.example.com/invoice-worker:1.0.0",
      }),
    ],
    notes: [
      "On SIGTERM, the host cancels `stoppingToken`, waits for the workers to stop, then disposes OpenTelemetry's providers, which send what they still hold.",
      "Kubernetes waits 30 seconds after SIGTERM before it kills the pod: a run longer than that needs a larger `terminationGracePeriodSeconds`.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Start the worker, then open ${SCREENS.services}: \`invoice-worker\` appears after its first run.`,
      },
      {
        title: "Open a run's trace",
        body: `Search ${SCREENS.traces} for \`invoices.sync\`: the run's \`GET\`, then an \`invoice.post\` with its \`POST\` for each invoice, though another worker posted them.`,
      },
      {
        title: "Read a run's log records",
        body: `In ${SCREENS.logs}, \`Queued 2 invoices\` and each \`Posted invoice\` record open the same trace.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Each HttpClient call is a trace of its own",
      answer:
        "The run has no `Activity` around it, or its `ActivitySource` is not named in `AddSource`. Start one per run, as `SyncAsync` does, under the name `AddSource` is given.",
    },
    {
      question:
        "The worker stops after one failed run, logging “BackgroundService failed”",
      answer:
        "An exception escaped `ExecuteAsync`, and the host stops when a `BackgroundService` fails: `BackgroundServiceExceptionBehavior` is `StopHost` by default. Catch it per run, record it on the run's activity, and let the loop go on.",
    },
    {
      question: "Queued work shows up as traces of their own",
      answer:
        "The entry left without the run's context, or the consumer started its activity without it. Write `Activity.Current?.Id` into the entry while the run's activity is current, and pass the parsed context to `StartActivity`.",
    },
    {
      question: "The last run before a deploy is missing",
      answer:
        "The process was killed before the host could stop. Stop it with SIGTERM, not SIGKILL, and give Kubernetes' `terminationGracePeriodSeconds` time for a run to finish.",
    },
    {
      question: "Nothing arrives, and nothing is logged",
      answer:
        "Set `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`: the exporter speaks gRPC by default and fails without a word. Then check the key with the `curl` above.",
    },
  ],

  faq: [
    {
      question: "Does this work for hosted services in an ASP.NET Core app?",
      answer:
        "Yes: an `IHostedService` in a web app runs on the same host. Register OpenTelemetry once, as the [ASP.NET Core](/integrations/opentelemetry/aspnet-core) guide shows, and add the worker's source with `AddSource`.",
    },
    {
      question: "Can I use the zero-code instrumentation instead?",
      answer:
        "Yes, with your workers' source named in `OTEL_DOTNET_AUTO_TRACES_ADDITIONAL_SOURCES`: see the [.NET](/integrations/opentelemetry/dotnet) guide. Use it or the code above, not both.",
    },
    {
      question:
        "How do I continue a trace from RabbitMQ, Kafka or Azure Service Bus?",
      answer:
        "The same way as from the `Channel` here: the producer puts `Activity.Current?.Id` in a `traceparent` header of the message, and the consumer parses it and starts its activity with it. Some clients, such as Azure Service Bus's, do this for you through their own `ActivitySource`.",
    },
    {
      question: "Which .NET versions does this cover?",
      answer:
        "The Generic Host of .NET 8 and later; this guide was checked on .NET 10.",
    },
  ],

  related: ["dotnet", "aspnet-core", "celery", "java"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.metrics],

  verification: {
    runtime: "dotnet",
    framework: {
      name: "Microsoft.Extensions.Hosting",
      package: "Microsoft.Extensions.Hosting",
    },
    files: [
      { path: "InvoiceWorker.csproj", content: dotnetWorkerProjectFile() },
      { path: "Program.cs", snippet: "program" },
      { path: "Worker.cs", snippet: "worker" },
      { path: "LedgerWriter.cs", snippet: "ledger-writer" },
      { path: "appsettings.json", snippet: "appsettings" },
    ],
    stubApiPort: 9000,
    commands: [
      {
        command:
          "dotnet add package Microsoft.Extensions.Hosting --version 10.0.14",
      },
      { snippet: "install" },
      { snippet: "install-http" },
      {
        snippet: "run",
        isServer: true,
        readyText: "Posted invoice inv_2",
        /*
         * Export delays longer than the run: what arrives is what the
         * host sends as it stops on SIGTERM.
         */
        environment: {
          OTEL_BSP_SCHEDULE_DELAY: "30000",
          OTEL_BLRP_SCHEDULE_DELAY: "30000",
          OTEL_METRIC_EXPORT_INTERVAL: "60000",
        },
      },
    ],
    requests: [],
    expect: {
      spans: [
        { name: "invoices.sync", attributes: { "invoice.count": "2" } },
        { name: "GET", parent: "invoices.sync" },
        {
          name: "invoice.post",
          attributes: { "invoice.id": "inv_1" },
          parent: "invoices.sync",
        },
        {
          name: "POST",
          attributes: { "http.request.method": "POST" },
          parent: "invoice.post",
        },
      ],
      metrics: [
        "invoices.synced",
        "http.client.request.duration",
        "dotnet.gc.collections",
        "dotnet.thread_pool.thread.count",
      ],
      logs: [
        { body: "Queued 2 invoices", hasTraceContext: true },
        { body: "Posted invoice inv_1", hasTraceContext: true },
        { body: "Invoice worker started", hasTraceContext: false },
      ],
      resource: { "service.name": "invoice-worker" },
      absentLogs: ["Start processing HTTP request", "{Count}"],
    },
  },
};
