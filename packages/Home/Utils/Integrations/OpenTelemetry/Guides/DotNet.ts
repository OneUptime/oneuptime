import {
  OpenTelemetryGuide,
  GuideSnippet,
  VerificationFile,
} from "../GuideTypes";
import {
  DOCS,
  OTLP_HTTP_PROTOCOL_LINE,
  SCREENS,
  SERVER_KEY_PREREQUISITE,
  kubernetesCronJobSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";
import {
  DOTNET_PREREQUISITE,
  DOTNET_PROTOCOL_NOTE,
  dotnetAddPackageSnippet,
  dotnetConsoleProjectFile,
  dotnetDockerfileSnippet,
} from "../DotNetShared";

/*
 * Any .NET program, framework or not: a console job that copies invoices
 * from a billing API into a ledger, one trace per run. Zero-code with the
 * automatic instrumentation's NuGet package, or the SDK set up in code;
 * both checked with export delays longer than the run, so what arrives is
 * what the job sends as it ends.
 */

const installAuto: GuideSnippet = dotnetAddPackageSnippet("install-auto", [
  "OpenTelemetry.AutoInstrumentation",
]);

const installSdk: GuideSnippet = dotnetAddPackageSnippet("install-sdk", [
  "OpenTelemetry",
  "OpenTelemetry.Exporter.OpenTelemetryProtocol",
  "OpenTelemetry.Instrumentation.Http",
]);

const invoiceJob: GuideSnippet = {
  id: "invoice-job",
  language: "csharp",
  title: "InvoiceJob.cs",
  code: [
    "using System.Diagnostics;",
    "using System.Net.Http.Json;",
    "using Microsoft.Extensions.Logging;",
    "",
    "public static class InvoiceJob",
    "{",
    "    // The name OpenTelemetry is told to listen to.",
    '    public static readonly ActivitySource ActivitySource = new("InvoiceSync");',
    "",
    "    public static async Task RunAsync(HttpClient billing, ILogger logger)",
    "    {",
    "        // Nothing starts a trace in a job: each run is one, and the calls below are its children.",
    '        using var activity = ActivitySource.StartActivity("invoices.sync");',
    '        var invoices = await billing.GetFromJsonAsync<InvoiceList>("/api/invoices");',
    '        activity?.SetTag("invoice.count", invoices!.Items.Length);',
    "        var synced = await Ledger.PostAsync(billing, invoices.Items, logger);",
    '        logger.LogInformation("Synced {Count} invoices", synced);',
    "    }",
    "}",
    "",
    "public record Invoice(string Id, int Total);",
    "public record InvoiceList(Invoice[] Items);",
  ].join("\n"),
  check: "run",
};

const ledger: GuideSnippet = {
  id: "ledger",
  language: "csharp",
  title: "Ledger.cs",
  code: [
    "using System.Diagnostics;",
    "using System.Diagnostics.Metrics;",
    "using System.Net.Http.Json;",
    "using Microsoft.Extensions.Logging;",
    "",
    "public static class Ledger",
    "{",
    "    private static readonly Counter<long> InvoicesSynced =",
    '        new Meter("InvoiceSync").CreateCounter<long>("invoices.synced", description: "Invoices copied to the ledger");',
    "",
    "    public static async Task<int> PostAsync(HttpClient billing, Invoice[] invoices, ILogger logger)",
    "    {",
    "        var synced = 0;",
    "        foreach (var invoice in invoices)",
    "        {",
    "            // A span of its own for each invoice, nested under the run's.",
    '            using var activity = InvoiceJob.ActivitySource.StartActivity("invoice.post");',
    '            activity?.SetTag("invoice.id", invoice.Id);',
    "            try",
    "            {",
    '                using var response = await billing.PostAsJsonAsync("/api/ledger", invoice);',
    "                response.EnsureSuccessStatusCode();",
    '                InvoicesSynced.Add(1, new KeyValuePair<string, object?>("invoice.source", "billing"));',
    "                synced++;",
    "            }",
    "            catch (HttpRequestException error)",
    "            {",
    "                activity?.AddException(error);",
    "                activity?.SetStatus(ActivityStatusCode.Error);",
    '                logger.LogError(error, "Could not post invoice {InvoiceId}", invoice.Id);',
    "            }",
    "        }",
    "        return synced;",
    "    }",
    "}",
  ].join("\n"),
  check: "run",
};

const program: GuideSnippet = {
  id: "program",
  language: "csharp",
  title: "Program.cs",
  code: [
    "using Microsoft.Extensions.Logging;",
    "",
    "using var loggerFactory = LoggerFactory.Create(logging => logging.AddConsole());",
    "using var billing = new HttpClient",
    "{",
    '    BaseAddress = new Uri(Environment.GetEnvironmentVariable("BILLING_API_URL") ?? "http://localhost:9000"),',
    "};",
    "",
    'await InvoiceJob.RunAsync(billing, loggerFactory.CreateLogger("InvoiceSync"));',
  ].join("\n"),
  check: "run",
};

const autoSources: GuideSnippet = {
  id: "auto-sources",
  language: "bash",
  title: "Environment",
  code: [
    "# Your own ActivitySource and Meter, by name: the zero-code SDK listens to no others.",
    'export OTEL_DOTNET_AUTO_TRACES_ADDITIONAL_SOURCES="InvoiceSync"',
    'export OTEL_DOTNET_AUTO_METRICS_ADDITIONAL_SOURCES="InvoiceSync"',
    "# Log bodies as written, with the values in, not the message template.",
    'export OTEL_DOTNET_AUTO_LOGS_INCLUDE_FORMATTED_MESSAGE="true"',
  ].join("\n"),
  check: "run",
};

const publishAuto: GuideSnippet = {
  id: "publish-auto",
  language: "bash",
  code: "dotnet publish -c Release -r linux-x64 -o out",
  check: "run",
};

const runAuto: GuideSnippet = {
  id: "run-auto",
  language: "bash",
  code: "sh out/instrument.sh dotnet out/InvoiceSync.dll",
  check: "run",
};

const programSdk: GuideSnippet = {
  id: "program-sdk",
  language: "csharp",
  title: "Program.cs",
  code: [
    "using Microsoft.Extensions.Logging;",
    "using OpenTelemetry;",
    "using OpenTelemetry.Logs;",
    "using OpenTelemetry.Metrics;",
    "using OpenTelemetry.Trace;",
    "",
    "// Disposed as the program ends, each provider sends what it still holds.",
    "using var tracerProvider = Sdk.CreateTracerProviderBuilder()",
    '    .AddSource("InvoiceSync")',
    "    .AddHttpClientInstrumentation()",
    "    .AddOtlpExporter()",
    "    .Build();",
    "using var meterProvider = Sdk.CreateMeterProviderBuilder()",
    '    .AddMeter("InvoiceSync")',
    "    .AddHttpClientInstrumentation()",
    "    .AddOtlpExporter()",
    "    .Build();",
    "using var loggerFactory = LoggerFactory.Create(logging => logging",
    "    .AddConsole()",
    "    .AddOpenTelemetry(options =>",
    "    {",
    "        options.IncludeFormattedMessage = true;",
    "        options.AddOtlpExporter();",
    "    }));",
    "using var billing = new HttpClient",
    "{",
    '    BaseAddress = new Uri(Environment.GetEnvironmentVariable("BILLING_API_URL") ?? "http://localhost:9000"),',
    "};",
    "",
    'await InvoiceJob.RunAsync(billing, loggerFactory.CreateLogger("InvoiceSync"));',
  ].join("\n"),
  check: "run",
};

const runSdk: GuideSnippet = {
  id: "run-sdk",
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

const disableInstrumentation: GuideSnippet = {
  id: "disable-instrumentation",
  language: "bash",
  code: [
    "# Leave one instrumentation out, by its name...",
    'export OTEL_DOTNET_AUTO_TRACES_HTTPCLIENT_INSTRUMENTATION_ENABLED="false"',
    "# ...or the process's metrics, which every short job repeats.",
    'export OTEL_DOTNET_AUTO_METRICS_PROCESS_INSTRUMENTATION_ENABLED="false"',
  ].join("\n"),
  check: "run",
};

/*
 * Export intervals longer than the job runs: what arrives is what the job
 * sends as it ends, not what a timer sent along the way.
 */
const SENT_AT_EXIT: Record<string, string> = {
  OTEL_BSP_SCHEDULE_DELAY: "30000",
  OTEL_BLRP_SCHEDULE_DELAY: "30000",
  OTEL_METRIC_EXPORT_INTERVAL: "60000",
};

function jobFiles(programSnippet: string): Array<VerificationFile> {
  return [
    { path: "InvoiceSync.csproj", content: dotnetConsoleProjectFile() },
    { path: "InvoiceJob.cs", snippet: "invoice-job" },
    { path: "Ledger.cs", snippet: "ledger" },
    { path: "Program.cs", snippet: programSnippet },
  ];
}

const APP_PACKAGES: string =
  "dotnet add package Microsoft.Extensions.Logging.Console --version 10.0.14";

export const DotNetGuide: OpenTelemetryGuide = {
  slug: "dotnet",
  seo: {
    title: ".NET OpenTelemetry: Zero-Code and SDK Setup | OneUptime",
    description:
      "Send traces, metrics and logs from any .NET app to OneUptime: OpenTelemetry's zero-code instrumentation from NuGet, or the SDK in code for console apps.",
  },
  h1: "OpenTelemetry for .NET",
  lead: "Send traces, metrics and logs from any .NET program to OneUptime: a console app, a scheduled job or a service built on a framework with no guide of its own. Add OpenTelemetry's zero-code instrumentation from NuGet and change no code, or set the SDK up in a few lines where you want the control.",
  cardDescription:
    "Any .NET app: the zero-code instrumentation from NuGet, or the SDK in code for console apps and jobs.",
  searchTerms: [
    "c#",
    "csharp",
    "console app",
    "zero-code",
    "auto-instrumentation",
    "activitysource",
    "ilogger",
  ],
  highlights: ["Zero-code from NuGet", "Or the SDK in code", ".NET 8 to 10"],

  whatYouGet: {
    intro: `A .NET program reports as one service, named by \`OTEL_SERVICE_NAME\`, in ${SCREENS.services} the first time it sends. The example is a console job that copies invoices from a billing API into a ledger; any program you run is set up the same way.`,
    traces:
      "A client span for every `HttpClient` call, and with the zero-code instrumentation spans for SQL Server, Entity Framework Core, gRPC and more, all in one trace per run under the `Activity` you start.",
    metrics:
      "`http.client.request.duration` for every outgoing call, the runtime's garbage collections, heap, thread pool and JIT as `dotnet.*` metrics, and the instruments of your own `Meter`.",
    logs: "Every `ILogger` record, with its structured values as attributes and the trace and span IDs of the `Activity` it was written in.",
    exceptions: `An exception you add to the run's \`Activity\` marks it failed with the stack trace, and \`LogError(error, ...)\` sends the record with the exception's type and message. ${SCREENS.exceptions} groups both.`,
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
      { name: "GET", depth: 1, start: 3, duration: 34, source: "httpclient" },
      {
        name: "invoice.post",
        depth: 1,
        start: 40,
        duration: 27,
        source: "your code",
      },
      { name: "POST", depth: 2, start: 42, duration: 23, source: "httpclient" },
      {
        name: "invoice.post",
        depth: 1,
        start: 70,
        duration: 28,
        source: "your code",
      },
      { name: "POST", depth: 2, start: 72, duration: 24, source: "httpclient" },
    ],
  },

  prerequisites: [
    DOTNET_PREREQUISITE,
    "A program you start with `dotnet`: a console app, a scheduled job, or a service on a framework this site has no guide for. Building with ASP.NET Core or a Worker Service? Their guides cover what is particular to them.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Pick zero-code to change no code, or in code to set the SDK up yourself. Each adds its own packages, at the versions this guide was checked with:",
    snippets: [],
    tabs: {
      group: "setup",
      tabs: [
        {
          label: "Zero-code",
          body: "One package carries the SDK, the exporter and every instrumentation:",
          snippets: [installAuto],
          notes: [
            "It adds `instrument.sh` (and `instrument.cmd` on Windows) to what you publish: the script that starts your app with OpenTelemetry loaded.",
          ],
        },
        {
          label: "In code",
          body: "The SDK, the OTLP exporter, and the `HttpClient` instrumentation:",
          snippets: [installSdk],
        },
      ],
    },
    notes: [
      "Use one way or the other: the zero-code instrumentation sets up its own SDK, and an SDK set up in code beside it would send everything twice.",
    ],
  },

  configure: {
    intro:
      "Both ways read the standard OpenTelemetry variables, so the endpoint and the key stay out of your code and your `appsettings.json`:",
    tabs: otlpEnvironmentTabs({
      serviceName: "invoice-sync",
      extraLines: [OTLP_HTTP_PROTOCOL_LINE],
    }),
    notes: [DOTNET_PROTOCOL_NOTE],
  },

  setup: {
    intro:
      "A request starts a trace by itself; a job does not. Start an `Activity` for each run, then start the program with OpenTelemetry loaded, one way or the other.",
    steps: [
      {
        title: "Start an Activity for each run",
        body: "`ActivitySource` is .NET's own tracing API, and OpenTelemetry sends what it records. Without an `Activity` around the run, each call below would be a trace of its own:",
        snippets: [invoiceJob, program],
        notes: [
          "`Ledger.PostAsync`, in the next section, posts each invoice under a span of its own.",
        ],
      },
      {
        title: "Start it with OpenTelemetry",
        body: "With the zero-code package, publish for the platform you run on and start the app through `instrument.sh`; in code, start it as usual:",
        tabs: {
          group: "setup",
          tabs: [
            {
              label: "Zero-code",
              body: "Name your own sources, then publish and start the app through the script:",
              snippets: [autoSources, publishAuto, runAuto],
              notes: [
                "Publish for the runtime you deploy to: `linux-x64`, `linux-arm64`, `osx-arm64` or `win-x64`. Without `-r`, every platform's native profiler is copied, and the script finds the right one under `runtimes/`.",
                "Without `OTEL_DOTNET_AUTO_TRACES_ADDITIONAL_SOURCES`, the zero-code SDK ignores your `ActivitySource`: each `HttpClient` call becomes a trace of its own, and the log record carries no trace ID.",
              ],
            },
            {
              label: "In code",
              body: "Build a provider for each signal at the top of `Program.cs`, with `using` so they are disposed as the program ends:",
              snippets: [programSdk, runSdk],
              notes: [
                "Disposing a provider sends what it still holds. A console app that ends without disposing them sends nothing at all, not even the spans it finished.",
                "`IncludeFormattedMessage` sends `Synced 2 invoices` as the record's body; without it, the body is the template, `Synced {Count} invoices`.",
              ],
            },
          ],
        },
      },
      {
        title: "Run it and watch the first export",
        body: "A job usually ends before the first five-second batch: both ways send what is left as the program exits, so one run is enough to see its trace.",
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "The zero-code instrumentation traces these libraries with no code; in code, each is an `Add...Instrumentation()` call and a package of its own:",
    rows: [
      {
        library: "`HttpClient`",
        covers:
          "A client span per request (`GET`, `POST`), with the URL and status, `traceparent` sent along, and `http.client.request.duration`.",
      },
      {
        library: "SQL Server, Entity Framework Core",
        covers:
          "A span per command, with the database and the statement, through `Microsoft.Data.SqlClient` or EF Core.",
      },
      {
        library: "ASP.NET Core, gRPC, WCF",
        covers:
          "A server span per request or call when the program serves them, and client spans for gRPC calls.",
      },
      {
        library: "`ILogger`",
        covers:
          "Every record, with its structured values and the trace and span IDs of the code that wrote it.",
      },
      {
        library: "The runtime and the process",
        covers:
          "Garbage collections, heap, thread pool, JIT and exceptions (`dotnet.*`), and the process's CPU, memory and threads (`process.*`).",
      },
    ],
    snippets: [disableInstrumentation],
    notes: [
      "Each instrumentation has a switch of its own, `OTEL_DOTNET_AUTO_<SIGNAL>_<NAME>_INSTRUMENTATION_ENABLED`:",
    ],
  },

  manualSpans: {
    intro:
      "Your own spans are `Activity` objects from an `ActivitySource`, and your own metrics come from a `Meter`, both from `System.Diagnostics`. Here each invoice gets a span of its own, with the call it makes beneath it:",
    snippets: [ledger],
    notes: [
      "`AddException` records the exception on the activity as an `exception` event, with its type, message and stack trace, and `SetStatus` marks the span failed.",
      "Name the source in `AddSource` (in code) or in `OTEL_DOTNET_AUTO_TRACES_ADDITIONAL_SOURCES` (zero-code), and the meter in `AddMeter` or `OTEL_DOTNET_AUTO_METRICS_ADDITIONAL_SOURCES`; a name left out records nothing.",
      "`StartActivity` returns `null` when nothing listens, which is why every call after it uses `activity?.`.",
      "`SetTag` adds attributes as you learn them, such as the invoice count: search them in the **Traces** explorer, as `@invoice.count:2`.",
    ],
  },

  logs: {
    intro:
      "`ILogger` records go to OneUptime through OpenTelemetry's logging provider: zero-code adds it to every logger factory, and in code `AddOpenTelemetry` adds it beside the console.",
    snippets: [],
    notes: [
      "A record's structured values, such as `Count`, become attributes, and the template stays in `{OriginalFormat}`.",
      "A program that logs through Serilog sends its events with Serilog's own OpenTelemetry sink: [Serilog](/docs/telemetry/serilog) sets it up.",
      "Records written outside an `Activity`, such as a startup line, carry no trace ID.",
      'Pass the exception first, as `logger.LogError(error, "Invoice sync failed")`, so the record carries its type, message and stack trace.',
    ],
  },

  metrics: {
    intro: "Exported every 60 seconds, and once more as the program exits:",
    builtIn: [
      {
        name: "http.client.request.duration",
        description:
          "Each outgoing request's duration, by server, method and status code.",
      },
      {
        name: "dotnet.gc.collections",
        description:
          "Garbage collections by generation, beside `dotnet.gc.pause.time` and `dotnet.gc.last_collection.heap.size`: the zero-code SDK sends them by itself.",
      },
      {
        name: "dotnet.thread_pool.queue.length",
        description:
          "Work waiting for a thread-pool thread: a queue that grows means blocking calls are starving the pool.",
      },
      {
        name: "process.memory.usage",
        description:
          "The process's resident memory, beside `process.cpu.time` and `process.thread.count`.",
      },
    ],
    snippets: [],
    notes: [
      "In code, the runtime's metrics come with `AddRuntimeInstrumentation()`, from the `OpenTelemetry.Instrumentation.Runtime` package, as the [ASP.NET Core](/integrations/opentelemetry/aspnet-core) guide shows.",
      "Keep attribute values to a small set, such as `invoice.source` here: each distinct value is a series of its own.",
    ],
  },

  sampling: {
    intro:
      "Every run is traced by default. For a job that runs often, keep a share of the traces:",
    snippets: [sampling],
    notes: [
      "`parentbased_traceidratio` keeps a quarter of new traces, and follows the caller's decision for work that arrives with a `traceparent`.",
      "Metrics and logs are not sampled, so `invoices.synced` still counts every invoice.",
    ],
  },

  deploy: {
    intro:
      "Publish in the SDK image and run in the smaller runtime image, through `instrument.sh` for zero-code; run it on a schedule as a Kubernetes CronJob, with the key in a Secret:",
    snippets: [
      dotnetDockerfileSnippet({
        assembly: "InvoiceSync.dll",
        port: 8080,
        runtimeImage: "runtime",
        zeroCode: true,
      }),
      kubernetesCronJobSnippet({
        name: "invoice-sync",
        image: "registry.example.com/invoice-sync:1.0.0",
        schedule: "*/15 * * * *",
        extraEnv: [
          {
            name: "OTEL_DOTNET_AUTO_TRACES_ADDITIONAL_SOURCES",
            value: "InvoiceSync",
          },
          {
            name: "OTEL_DOTNET_AUTO_METRICS_ADDITIONAL_SOURCES",
            value: "InvoiceSync",
          },
        ],
      }),
    ],
    notes: [
      "Each scheduled run is a short-lived pod, and each run's trace stands alone: `deployment.environment.name` tags them all the same way.",
      "On an Arm node, publish with `-r linux-arm64` instead.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Run the job once",
        body: `Then open ${SCREENS.services}: \`invoice-sync\` is listed within a minute of the run. Nothing? Check that the job ran to its end: what it holds leaves as it exits.`,
      },
      {
        title: "Open one run's trace",
        body: `In ${SCREENS.traces}, search \`invoices.sync\`: the run's \`GET\` sits beneath it, and an \`invoice.post\` with its \`POST\` for each invoice. Separate one-span traces mean the source is not named.`,
      },
      {
        title: "Read the run's log record",
        body: `In ${SCREENS.logs}, \`Synced 2 invoices\` opens the run that wrote it from its trace ID.`,
      },
    ],
  },

  troubleshooting: [
    {
      question: "Only HTTP spans arrive, each a trace of its own",
      answer:
        "OpenTelemetry is not listening to your `ActivitySource`. Name it in `OTEL_DOTNET_AUTO_TRACES_ADDITIONAL_SOURCES` (zero-code) or `AddSource` (in code), exactly as you named it in `new ActivitySource(...)`.",
    },
    {
      question: "The console app runs, and nothing arrives",
      answer:
        "The providers were never disposed, so what they buffered was lost when the program ended. Declare them with `using var`, as above, or call `Dispose()` before the program returns.",
    },
    {
      question: "Log bodies read “Synced {Count} invoices”",
      answer:
        "That is the message template. Set `OTEL_DOTNET_AUTO_LOGS_INCLUDE_FORMATTED_MESSAGE=true` (zero-code) or `IncludeFormattedMessage = true` (in code) to send the message with its values in.",
    },
    {
      question: "instrument.sh says “Unable to locate the native profiler”",
      answer:
        "The app was published without `-r`. The script then looks under `runtimes/` for your platform and says so as it goes on; publish with `-r linux-x64` (or your platform) to skip the search.",
    },
    {
      question: "Nothing arrives, and nothing is logged",
      answer:
        "The .NET exporter fails quietly. Check `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf` first: without it, the SDK speaks gRPC, which the `/otlp` endpoint does not take. Then ask OneUptime about the key with the `curl` above: a `401` names the reason.",
    },
  ],

  faq: [
    {
      question: "Zero-code or in code: which should I use?",
      answer:
        "Zero-code when you cannot or would rather not touch the app: it traces many libraries with no code. In code when you want each instrumentation to be a package you chose, and the setup in the app's own source.",
    },
    {
      question: "Can I instrument an app I cannot rebuild?",
      answer:
        "Yes: the zero-code instrumentation's release also installs on the host itself, with `otel-dotnet-auto-install.sh`, and loads into a `dotnet` command through environment variables, with no NuGet package in the app.",
    },
    {
      question: "Which .NET versions are covered?",
      answer:
        "OpenTelemetry .NET supports .NET 8 and later, and .NET Framework 4.6.2 and later for the SDK. This guide was checked on .NET 10.",
    },
    {
      question: "Do I need an OpenTelemetry Collector?",
      answer:
        "No: both ways send straight to OneUptime. A Collector helps when you want one place to filter or batch what many services send: see [OpenTelemetry](/docs/telemetry/open-telemetry).",
    },
  ],

  related: ["aspnet-core", "dotnet-worker-service", "java", "python"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.metrics],

  verification: {
    runtime: "dotnet",
    framework: { name: ".NET" },
    files: jobFiles("program"),
    stubApiPort: 9000,
    environmentSnippets: ["auto-sources"],
    commands: [
      { command: APP_PACKAGES },
      { snippet: "install-auto" },
      { snippet: "publish-auto" },
      { snippet: "run-auto", environment: SENT_AT_EXIT },
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
        "dotnet.thread_pool.queue.length",
        "process.memory.usage",
      ],
      logs: [{ body: "Synced 2 invoices", hasTraceContext: true }],
      resource: { "service.name": "invoice-sync" },
      absentLogs: ["{Count}"],
    },
    variants: [
      {
        // The automatic instrumentation's switches, as the page names them.
        name: "Instrumentations off",
        files: jobFiles("program"),
        stubApiPort: 9000,
        environmentSnippets: ["auto-sources", "disable-instrumentation"],
        commands: [
          { command: APP_PACKAGES },
          { snippet: "install-auto" },
          { snippet: "publish-auto" },
          { snippet: "run-auto", environment: SENT_AT_EXIT },
        ],
        requests: [],
        expect: {
          spans: [
            { name: "invoices.sync", attributes: { "invoice.count": "2" } },
            { name: "invoice.post", parent: "invoices.sync" },
          ],
          metrics: ["invoices.synced", "dotnet.gc.collections"],
          logs: [{ body: "Synced 2 invoices", hasTraceContext: true }],
          absentSpans: ["GET", "POST"],
          absentMetrics: ["process.memory.usage"],
        },
      },
      {
        // The same job with the SDK set up in Program.cs.
        name: "In code",
        files: jobFiles("program-sdk"),
        stubApiPort: 9000,
        commands: [
          { command: APP_PACKAGES },
          { snippet: "install-sdk" },
          { snippet: "run-sdk", environment: SENT_AT_EXIT },
        ],
        requests: [],
        expect: {
          spans: [
            { name: "invoices.sync", attributes: { "invoice.count": "2" } },
            { name: "GET", parent: "invoices.sync" },
            { name: "invoice.post", parent: "invoices.sync" },
            { name: "POST", parent: "invoice.post" },
          ],
          metrics: ["invoices.synced", "http.client.request.duration"],
          logs: [{ body: "Synced 2 invoices", hasTraceContext: true }],
          resource: { "service.name": "invoice-sync" },
          absentLogs: ["{Count}"],
        },
      },
    ],
  },
};
