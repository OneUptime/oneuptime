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
  kubernetesManifestSnippet,
  otlpEnvironmentTabs,
  validateKeyStep,
} from "../GuideShared";
import {
  DOTNET_PREREQUISITE,
  DOTNET_PROTOCOL_NOTE,
  dotnetAddPackageSnippet,
  dotnetDockerfileSnippet,
  dotnetWebProjectFile,
} from "../DotNetShared";

/*
 * ASP.NET Core with the SDK set up in Program.cs: a minimal API with
 * Entity Framework Core on SQLite and a typed HttpClient, traced, measured
 * and logged through ILogger, run with `dotnet run`.
 */

const install: GuideSnippet = dotnetAddPackageSnippet("install", [
  "OpenTelemetry.Extensions.Hosting",
  "OpenTelemetry.Exporter.OpenTelemetryProtocol",
  "OpenTelemetry.Instrumentation.AspNetCore",
  "OpenTelemetry.Instrumentation.Http",
  "OpenTelemetry.Instrumentation.Runtime",
]);

const installEfCore: GuideSnippet = dotnetAddPackageSnippet("install-efcore", [
  "OpenTelemetry.Instrumentation.EntityFrameworkCore",
]);

const openTelemetry: GuideSnippet = {
  id: "opentelemetry",
  language: "csharp",
  title: "Program.cs",
  code: [
    "builder.Services.AddOpenTelemetry()",
    "    .WithTracing(tracing => tracing",
    "        .AddAspNetCoreInstrumentation(options =>",
    "        {",
    "            // Health checks stay out of your traces; a failed request keeps",
    "            // its exception.",
    '            options.Filter = context => context.Request.Path != "/healthz";',
    "            options.RecordException = true;",
    "        })",
    "        .AddHttpClientInstrumentation()",
    "        .AddEntityFrameworkCoreInstrumentation()",
    "        .AddSource(PaymentService.ActivitySourceName))",
    "    .WithMetrics(metrics => metrics",
    "        .AddAspNetCoreInstrumentation()",
    "        .AddHttpClientInstrumentation()",
    "        .AddRuntimeInstrumentation()",
    "        .AddMeter(PaymentService.MeterName))",
    "    .WithLogging(logging => { }, options => options.IncludeFormattedMessage = true)",
    "    .UseOtlpExporter();",
  ].join("\n"),
  check: "contained",
};

const usings: GuideSnippet = {
  id: "usings",
  language: "csharp",
  title: "Program.cs",
  code: [
    "using OpenTelemetry;",
    "using OpenTelemetry.Logs;",
    "using OpenTelemetry.Metrics;",
    "using OpenTelemetry.Trace;",
  ].join("\n"),
  check: "contained",
};

const typedClient: GuideSnippet = {
  id: "typed-client",
  language: "csharp",
  title: "Program.cs",
  code: [
    "builder.Services.AddHttpClient<PaymentService>(client =>",
    "    client.BaseAddress = new Uri(",
    '        builder.Configuration["PAYMENTS_API_URL"] ?? "http://localhost:9000"));',
  ].join("\n"),
  check: "contained",
};

const run: GuideSnippet = {
  id: "run",
  language: "bash",
  code: "dotnet run",
  check: "run",
};

const paymentService: GuideSnippet = {
  id: "payment-service",
  language: "csharp",
  title: "PaymentService.cs",
  code: [
    "using System.Diagnostics;",
    "using System.Diagnostics.Metrics;",
    "",
    "public class PaymentService(HttpClient http)",
    "{",
    "    // The names Program.cs gives AddSource and AddMeter.",
    '    public const string ActivitySourceName = "Checkout";',
    '    public const string MeterName = "Checkout";',
    "",
    "    private static readonly ActivitySource ActivitySource = new(ActivitySourceName);",
    "    private static readonly Counter<long> OrdersPlaced =",
    "        new Meter(MeterName).CreateCounter<long>(",
    '            "orders.placed", description: "Orders placed, by payment method");',
    "",
    "    public async Task ChargeAsync(string paymentMethod, int itemCount)",
    "    {",
    '        using var activity = ActivitySource.StartActivity("checkout.charge");',
    '        activity?.SetTag("payment.method", paymentMethod);',
    '        activity?.SetTag("order.item_count", itemCount);',
    "        try",
    "        {",
    "            using var response =",
    '                await http.PostAsJsonAsync("/api/charges", new { items = itemCount });',
    "            response.EnsureSuccessStatusCode();",
    "            OrdersPlaced.Add(",
    '                1, new KeyValuePair<string, object?>("payment.method", paymentMethod));',
    "        }",
    "        catch (HttpRequestException error)",
    "        {",
    "            activity?.AddException(error);",
    "            activity?.SetStatus(ActivityStatusCode.Error);",
    "            throw;",
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
    '      "Microsoft.AspNetCore": "Warning",',
    '      "Microsoft.EntityFrameworkCore.Database.Command": "Warning",',
    '      "System.Net.Http.HttpClient": "Warning"',
    "    }",
    "  },",
    '  "AllowedHosts": "*"',
    "}",
  ].join("\n"),
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

// The minimal API the end-to-end check runs, the page's fragments word for word.
const programFile: string = [
  "using Microsoft.EntityFrameworkCore;",
  usings.code,
  "",
  "var builder = WebApplication.CreateBuilder(args);",
  "",
  openTelemetry.code,
  "",
  typedClient.code,
  'builder.Services.AddDbContext<ShopDb>(options => options.UseSqlite("Data Source=shop.db"));',
  "",
  "var app = builder.Build();",
  "",
  "using (var scope = app.Services.CreateScope())",
  "{",
  "    scope.ServiceProvider.GetRequiredService<ShopDb>().Database.EnsureCreated();",
  "}",
  "",
  'app.MapGet("/healthz", () => "ok");',
  "",
  'app.MapGet("/orders/{id:int}", async (int id, ShopDb db, ILogger<Program> logger) =>',
  "{",
  '    logger.LogInformation("Loading order {OrderId}", id);',
  "    var order = await db.Orders.FindAsync(id);",
  "    return Results.Ok(new { id, found = order is not null });",
  "});",
  "",
  'app.MapPost("/orders", async (NewOrder order, PaymentService payments, ShopDb db) =>',
  "{",
  "    await payments.ChargeAsync(order.PaymentMethod, order.Items.Length);",
  "    var placed = new PlacedOrder { ItemCount = order.Items.Length };",
  "    db.Orders.Add(placed);",
  "    await db.SaveChangesAsync();",
  '    return Results.Created($"/orders/{placed.Id}", new { id = placed.Id });',
  "});",
  "",
  'app.MapGet("/boom", string () => throw new InvalidOperationException("Payment provider timed out"));',
  "",
  "app.Run();",
  "",
  "record NewOrder(string[] Items, string PaymentMethod);",
  "",
  "class PlacedOrder",
  "{",
  "    public int Id { get; set; }",
  "    public int ItemCount { get; set; }",
  "}",
  "",
  "class ShopDb(DbContextOptions<ShopDb> options) : DbContext(options)",
  "{",
  "    public DbSet<PlacedOrder> Orders => Set<PlacedOrder>();",
  "}",
].join("\n");

const files: Array<VerificationFile> = [
  { path: "Checkout.csproj", content: dotnetWebProjectFile() },
  { path: "Program.cs", content: programFile },
  { path: "PaymentService.cs", snippet: "payment-service" },
  { path: "appsettings.json", snippet: "appsettings" },
];

export const AspNetCoreGuide: OpenTelemetryGuide = {
  slug: "aspnet-core",
  seo: {
    title: "ASP.NET Core OpenTelemetry: Tracing & Metrics | OneUptime",
    description:
      "Add OpenTelemetry to ASP.NET Core for OneUptime: routes, HttpClient, Entity Framework Core, Kestrel and runtime metrics, and ILogger logs with trace IDs.",
  },
  h1: "OpenTelemetry for ASP.NET Core",
  lead: "Trace every ASP.NET Core request with the `HttpClient` calls and the Entity Framework Core queries it makes, and send traces, metrics and logs to OneUptime from one block in `Program.cs`. The `ILogger` you already write to becomes your logs, each with the trace of its request.",
  cardDescription:
    "ASP.NET Core with the SDK in Program.cs: routes, HttpClient, EF Core, Kestrel metrics and ILogger logs.",
  searchTerms: [
    "minimal api",
    "mvc",
    "web api",
    "kestrel",
    "entity framework",
    "ilogger",
  ],
  highlights: ["Minimal APIs and MVC", "ILogger to logs", ".NET 8 to 10"],

  whatYouGet: {
    intro: `With OpenTelemetry registered in \`Program.cs\`, an ASP.NET Core app reports as one service, \`checkout-api\` here, in ${SCREENS.services} from its first request.`,
    traces:
      "A server span per request named after its route template, such as `GET /orders/{id:int}`, a client span per `HttpClient` call, a span per Entity Framework Core command, and the spans of your own `ActivitySource`.",
    metrics:
      "`http.server.request.duration` by route, Kestrel's connections, the runtime's garbage collections, heap and thread pool, and your own `Meter`'s instruments.",
    logs: "Every `ILogger` record, with its structured values as attributes and the trace and span IDs of the request that wrote it.",
    exceptions: `An unhandled exception marks its request's span failed, and with \`RecordException\` the span keeps the exception and its stack trace; Kestrel's error record carries it too. ${SCREENS.exceptions} groups them.`,
  },

  exampleTrace: {
    caption: "A POST /orders request, as its trace shows it",
    spans: [
      {
        name: "POST /orders",
        depth: 0,
        start: 0,
        duration: 100,
        source: "aspnetcore",
      },
      {
        name: "checkout.charge",
        depth: 1,
        start: 4,
        duration: 66,
        source: "your code",
      },
      {
        name: "POST",
        depth: 2,
        start: 8,
        duration: 58,
        source: "httpclient",
      },
      {
        name: "main",
        depth: 1,
        start: 74,
        duration: 21,
        source: "ef-core",
      },
    ],
  },

  prerequisites: [
    DOTNET_PREREQUISITE,
    "An ASP.NET Core app with a `Program.cs` that builds it with `WebApplication.CreateBuilder`: minimal APIs, controllers or Razor Pages.",
    SERVER_KEY_PREREQUISITE,
  ],

  install: {
    intro:
      "Add the SDK's hosting extensions, the OTLP exporter and the instrumentations for ASP.NET Core, `HttpClient` and the runtime, at the versions this guide was checked with:",
    snippets: [install, installEfCore],
    notes: [
      "The second line is for Entity Framework Core, whose instrumentation is still a beta: leave it out if you do not use EF Core.",
    ],
  },

  configure: {
    intro:
      "`UseOtlpExporter()` reads the standard OpenTelemetry variables, so the endpoint and the key stay out of `appsettings.json`:",
    tabs: otlpEnvironmentTabs({
      serviceName: "checkout-api",
      extraLines: [OTLP_HTTP_PROTOCOL_LINE],
    }),
    notes: [DOTNET_PROTOCOL_NOTE],
  },

  setup: {
    intro:
      "One block in `Program.cs` registers OpenTelemetry for all three signals; the host starts it with the app and stops it with the app.",
    steps: [
      {
        title: "Register OpenTelemetry",
        body: "Add the usings at the top of `Program.cs`, and the block after `WebApplication.CreateBuilder`:",
        snippets: [usings, openTelemetry],
        notes: [
          "`UseOtlpExporter()` sends traces, metrics and logs through one exporter. Use it alone: calling a signal's `AddOtlpExporter()` beside it stops the app from starting.",
          "Controllers and Razor Pages are traced the same way, by their route templates.",
        ],
      },
      {
        title: "Register your HttpClient",
        body: "Clients from `IHttpClientFactory`, typed or named, are traced by `AddHttpClientInstrumentation()`; so is any `new HttpClient()`:",
        snippets: [typedClient],
      },
      {
        title: "Run it",
        body: "Start the app with the variables above in its environment:",
        snippets: [run],
        notes: [
          "Spans and logs leave in batches every five seconds, metrics once a minute; the host sends what is left when the app stops.",
        ],
      },
    ],
  },

  autoInstrumentation: {
    intro:
      "With the block above, these are traced and measured with no more code:",
    rows: [
      {
        library: "ASP.NET Core",
        covers:
          "A server span per request named after its route template (`GET /orders/{id:int}`), with `http.route`, the status, and the exception that escaped it.",
      },
      {
        library: "`HttpClient`",
        covers:
          "A client span per call (`POST`), with the URL and status, and `traceparent` sent along to the service called.",
      },
      {
        library: "Entity Framework Core",
        covers:
          "A span per command, named after the database (`main` for SQLite), with the SQL in `db.statement`.",
      },
      {
        library: "Kestrel, routing, the runtime",
        covers:
          "ASP.NET Core's own meters (`kestrel.active_connections`, `aspnetcore.routing.match_attempts`) and the runtime's `dotnet.*` metrics.",
      },
      {
        library: "`ILogger`",
        covers:
          "Every record, with its structured values and the IDs of the request's trace and span.",
      },
    ],
    snippets: [],
    notes: [
      "`options.Filter` decides which requests are traced: return `false` for the paths to leave out, such as `/healthz` here.",
      "Without `RecordException = true`, a failed request's span is marked failed with `error.type`, but holds no exception or stack trace.",
    ],
  },

  manualSpans: {
    intro:
      "Your own spans come from an `ActivitySource` and your metrics from a `Meter`, both from `System.Diagnostics`, under the names `Program.cs` gives `AddSource` and `AddMeter`:",
    snippets: [paymentService],
    notes: [
      "The `HttpClient` call nests under `checkout.charge`, which nests under the request's span: `Activity.Current` follows the request across `await`.",
      "`StartActivity` returns `null` when nothing listens, so the calls after it use `activity?.`.",
      "In the **Traces** explorer, `@payment.method:card` finds the charges by card, each with its call to the payment provider.",
    ],
  },

  logs: {
    intro:
      "`WithLogging` adds OpenTelemetry beside the console logger, so every `ILogger` record goes to OneUptime. Entity Framework Core and `IHttpClientFactory` log every command and request at `Information`; keep them at `Warning` in `appsettings.json`:",
    snippets: [appSettings],
    notes: [
      "`IncludeFormattedMessage` sends `Loading order 42` as the body; without it, the body is the template, `Loading order {OrderId}`, and the value only an attribute.",
      "A request's unhandled exception is also logged by Kestrel, as `An unhandled exception was thrown by the application`, with the request's trace ID and the exception's stack trace.",
      "`IncludeScopes = true` adds what `BeginScope` holds as attributes, beside request IDs every record already carries.",
      "Logging with Serilog instead? Its OpenTelemetry sink sends to the same endpoint, with the same trace IDs: see [Serilog](/docs/telemetry/serilog).",
    ],
  },

  metrics: {
    intro: "Exported every 60 seconds:",
    builtIn: [
      {
        name: "http.server.request.duration",
        description:
          "Each request's duration by route template, method and status code: a route's latency and error rate.",
      },
      {
        name: "kestrel.active_connections",
        description:
          "Open connections, beside `kestrel.queued_connections`: connections that wait mean the server is saturated.",
      },
      {
        name: "dotnet.gc.collections",
        description:
          "Garbage collections by generation, beside `dotnet.gc.pause.time` and `dotnet.process.memory.working_set`.",
      },
      {
        name: "dotnet.thread_pool.queue.length",
        description:
          "Work waiting for a thread: a growing queue means blocking calls are starving the pool.",
      },
      {
        name: "http.client.request.duration",
        description: "Each outgoing call's duration, by server and status.",
      },
    ],
    snippets: [],
    notes: [
      "`http.client.request.duration` also counts the exporter's own sends to OneUptime: tell them apart by `server.address`.",
      "Keep attribute values to a small set, such as `payment.method` here: each value is a series of its own.",
    ],
  },

  sampling: {
    intro:
      "Every request is traced by default, health checks aside. On a busy app, keep a share of new traces with the standard variables, which the SDK reads as it starts:",
    snippets: [sampling],
    notes: [
      "With `parentbased_traceidratio`, one new trace in four is kept, and a request that arrives with a `traceparent` header keeps or drops its trace as the caller did.",
      "Metrics and logs are not sampled: request counts and latencies stay exact.",
    ],
  },

  deploy: {
    intro:
      "Publish in the SDK image and run in the ASP.NET Core runtime image, which listens on port 8080; keep the key in a Kubernetes Secret:",
    snippets: [
      dotnetDockerfileSnippet({
        assembly: "Checkout.dll",
        port: 8080,
        runtimeImage: "aspnet",
      }),
      kubernetesManifestSnippet({
        name: "checkout-api",
        image: "registry.example.com/checkout-api:10.0.0",
        containerPort: 8080,
      }),
    ],
    notes: [
      "On SIGTERM, the host stops the app gracefully and disposes OpenTelemetry's providers, which send what they still hold.",
      "Point the Deployment's liveness and readiness probes at `/healthz`: the filter keeps them out of your traces.",
    ],
  },

  verify: {
    intro: "Check in this order: each step rules out one cause.",
    steps: [
      validateKeyStep("server"),
      {
        title: "Find the service",
        body: `Send a request, then open ${SCREENS.services}: \`checkout-api\` is listed within a minute. Nothing? \`OTEL_EXPORTER_OTLP_PROTOCOL\` must be \`http/protobuf\`.`,
      },
      {
        title: "Open a request's trace",
        body: `In ${SCREENS.traces}, search \`@http.route:/orders/{id:int}\`: each request's span holds its Entity Framework command.`,
      },
      {
        title: "Read a request's logs",
        body: `In ${SCREENS.logs}, \`Loading order 42\` opens the request that wrote it, and carries \`OrderId\` as an attribute.`,
      },
    ],
  },

  troubleshooting: [
    {
      question:
        "The app will not start: “Signal-specific AddOtlpExporter methods and the cross-cutting UseOtlpExporter method …”",
      answer:
        "`UseOtlpExporter()` and a signal's `AddOtlpExporter()` are both registered. Keep `UseOtlpExporter()` alone, as above.",
    },
    {
      question: "Failed requests show no exception in their trace",
      answer:
        "Set `RecordException = true` in `AddAspNetCoreInstrumentation`. Without it, the span is marked failed with `error.type`, and the exception is only in Kestrel's log record.",
    },
    {
      question: "Nothing arrives, and nothing is logged",
      answer:
        "The exporter is speaking gRPC to the HTTP endpoint and fails quietly. Set `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, and check the key with the `curl` above.",
    },
    {
      question: "My own spans and metrics are missing",
      answer:
        'Their names must be the ones given to `AddSource` and `AddMeter`, exactly: `new ActivitySource("Checkout")` needs `AddSource("Checkout")`.',
    },
    {
      question: "Logs read “Loading order {OrderId}”",
      answer:
        "That is the message template. Pass `options => options.IncludeFormattedMessage = true` to `WithLogging`, as above.",
    },
  ],

  faq: [
    {
      question: "Can I instrument ASP.NET Core without changing code?",
      answer:
        "Yes, with OpenTelemetry's zero-code instrumentation for .NET, which traces ASP.NET Core with nothing in `Program.cs`: see the [.NET](/integrations/opentelemetry/dotnet) guide. Do not use both at once.",
    },
    {
      question: "Does this work with controllers and Razor Pages?",
      answer:
        "Yes: the server span is named after the route template of whatever serves the request, an endpoint, a controller action or a page.",
    },
    {
      question: "Why does the span name show {id:int}?",
      answer:
        "It is the route template as written, constraint included, which keeps one name for every order: `GET /orders/{id:int}` is every order's page.",
    },
    {
      question: "Which .NET versions does this cover?",
      answer:
        "ASP.NET Core 8 and later, which the instrumentation 1.20 supports; this guide was checked on .NET 10.",
    },
  ],

  related: ["dotnet", "dotnet-worker-service", "spring-boot", "nodejs"],
  docs: [DOCS.openTelemetry, DOCS.traces, DOCS.logs, DOCS.exceptions],

  verification: {
    runtime: "dotnet",
    framework: { name: "ASP.NET Core", package: "Microsoft.AspNetCore.App" },
    files: files,
    stubApiPort: 9000,
    commands: [
      {
        command:
          "dotnet add package Microsoft.EntityFrameworkCore.Sqlite --version 10.0.14",
      },
      { snippet: "install" },
      { snippet: "install-efcore" },
      {
        snippet: "run",
        isServer: true,
        environment: { ASPNETCORE_URLS: "http://127.0.0.1:8080" },
      },
    ],
    port: 8080,
    requests: [
      { method: "GET", path: "/healthz" },
      { method: "GET", path: "/orders/42" },
      {
        method: "POST",
        path: "/orders",
        body: { items: ["kettle", "mug"], paymentMethod: "card" },
      },
      { method: "GET", path: "/boom" },
    ],
    expect: {
      spans: [
        {
          name: "GET /orders/{id:int}",
          attributes: { "http.route": "/orders/{id:int}" },
        },
        {
          name: "main",
          attributes: { "db.system": "sqlite" },
          parent: "GET /orders/{id:int}",
        },
        {
          name: "checkout.charge",
          attributes: { "payment.method": "card", "order.item_count": "2" },
          parent: "POST /orders",
        },
        {
          name: "POST",
          attributes: { "http.request.method": "POST" },
          parent: "checkout.charge",
        },
        { name: "main", parent: "POST /orders" },
        {
          name: "GET /boom",
          hasException: true,
          exceptionMessage: "Payment provider timed out",
        },
      ],
      metrics: [
        "http.server.request.duration",
        "kestrel.active_connections",
        "dotnet.gc.collections",
        "dotnet.thread_pool.queue.length",
        "http.client.request.duration",
        "orders.placed",
      ],
      logs: [
        { body: "Loading order 42", hasTraceContext: true },
        {
          body: "An unhandled exception was thrown by the application",
          hasTraceContext: true,
          hasException: true,
        },
      ],
      resource: { "service.name": "checkout-api" },
      untracedPaths: ["/healthz"],
      absentLogs: ["Executed DbCommand", "Start processing HTTP request"],
    },
  },
};
