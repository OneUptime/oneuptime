import {
  CodeSnippet,
  OtelLanguageSnippets,
  OtelSignal,
  OtelSignals,
  lines,
  signalsOf,
} from "./Shared";

/*
 * .NET: an ASP.NET Core Program.cs (the one `dotnet new web` writes, set
 * up for OpenTelemetry), with an OTLP/HTTP exporter for each signal asked
 * for, and the `dotnet add package` of exactly the packages it uses.
 *
 * Checked end to end with the .NET 10 SDK (mcr.microsoft.com/dotnet/sdk:10.0)
 * and the versions below: each variant built with no warnings, and once
 * started, with a request to /, posted its signals to a stand-in for
 * /otlp/v1/<signal> (200) and nothing else; what was still buffered went
 * out as the host stopped (SIGTERM).
 *
 * - With OtlpExportProtocol.HttpProtobuf, an Endpoint set in code is the
 *   signal's whole URL, posted to as written: "the full URL MUST be
 *   provided, including the signal-specific path v1/{signal}"
 *   (OpenTelemetry.Exporter.OpenTelemetryProtocol 1.21.0, README.md,
 *   "Endpoint").
 * - ConfigureResource names the service for every signal.
 * - Logs: what the app writes through ILogger (ASP.NET Core's own lines
 *   too), each with its values in its message (IncludeFormattedMessage;
 *   the body is the template, "Now listening on: {address}", otherwise).
 *   Console.WriteLine is not sent.
 */

export const DOTNET_PACKAGE_VERSIONS: Readonly<Record<string, string>> = {
  "OpenTelemetry.Extensions.Hosting": "1.21.0",
  "OpenTelemetry.Exporter.OpenTelemetryProtocol": "1.21.0",
  "OpenTelemetry.Instrumentation.AspNetCore": "1.21.0",
  "OpenTelemetry.Instrumentation.Http": "1.21.0",
};

const addPackage: (name: string) => string = (name: string): string => {
  const version: string | undefined = DOTNET_PACKAGE_VERSIONS[name];

  if (!version) {
    throw new Error(`No pinned version for ${name}`);
  }

  return `dotnet add package ${name} --version ${version}`;
};

// Requests in and out of the app: spans for traces, durations for metrics.
const instrumentsRequests: (signals: OtelSignals) => boolean = (
  signals: OtelSignals,
): boolean => {
  return signals.traces || signals.metrics;
};

const install: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  return {
    code: lines(
      "dotnet new web -o MyService  # a new app; skip it in your own",
      "cd MyService",
      addPackage("OpenTelemetry.Extensions.Hosting"),
      addPackage("OpenTelemetry.Exporter.OpenTelemetryProtocol"),
      instrumentsRequests(signals) && [
        addPackage("OpenTelemetry.Instrumentation.AspNetCore"),
        addPackage("OpenTelemetry.Instrumentation.Http"),
      ],
    ),
    language: "bash",
  };
};

// The OTLP exporter of one signal, inside its With<Signal>(...) call.
const exporter: (signal: OtelSignal, end: string) => Array<string> = (
  signal: OtelSignal,
  end: string,
): Array<string> => {
  return [
    "        .AddOtlpExporter(options =>",
    "        {",
    `            options.Endpoint = new Uri("<YOUR_ONEUPTIME_URL>/v1/${signal}");`,
    "            options.Protocol = OtlpExportProtocol.HttpProtobuf;",
    "            options.Headers = oneUptimeHeaders;",
    `        })${end}`,
  ];
};

const config: (signals: OtelSignals) => CodeSnippet = (
  signals: OtelSignals,
): CodeSnippet => {
  const asked: Array<OtelSignal> = signalsOf(signals);
  const last: OtelSignal = asked[asked.length - 1]!;

  return {
    code: lines(
      "// Program.cs - dotnet run, then open the address it prints",
      "using OpenTelemetry.Exporter;",
      signals.logs && "using OpenTelemetry.Logs;",
      signals.metrics && "using OpenTelemetry.Metrics;",
      "using OpenTelemetry.Resources;",
      signals.traces && "using OpenTelemetry.Trace;",
      "",
      "var builder = WebApplication.CreateBuilder(args);",
      'var oneUptimeHeaders = "x-oneuptime-token=<YOUR_ONEUPTIME_TOKEN>";',
      "",
      "builder.Services.AddOpenTelemetry()",
      '    .ConfigureResource(resource => resource.AddService("my-service"))',
      signals.traces && [
        "    .WithTracing(tracing => tracing",
        "        .AddAspNetCoreInstrumentation()",
        "        .AddHttpClientInstrumentation()",
        ...exporter("traces", last === "traces" ? ");" : ")"),
      ],
      signals.metrics && [
        "    .WithMetrics(metrics => metrics",
        "        .AddAspNetCoreInstrumentation()",
        "        .AddHttpClientInstrumentation()",
        ...exporter("metrics", last === "metrics" ? ");" : ")"),
      ],
      signals.logs && [
        "    // What the app writes through ILogger; Console.WriteLine is not sent.",
        "    .WithLogging(",
        "        logging => logging",
        ...exporter("logs", ",").map((line: string): string => {
          return `    ${line}`;
        }),
        "        // The message with its values in, not its template.",
        "        options => options.IncludeFormattedMessage = true);",
      ],
      "",
      "var app = builder.Build();",
      "",
      signals.logs
        ? [
            'app.MapGet("/", (ILogger<Program> logger) =>',
            "{",
            '    logger.LogInformation("Hello, OneUptime");',
            '    return "Hello, OneUptime";',
            "});",
          ]
        : 'app.MapGet("/", () => "Hello, OneUptime");',
      "",
      "// Stopping it (Ctrl+C, SIGTERM) sends what is still buffered.",
      "app.Run();",
    ),
    language: "csharp",
  };
};

const DotNetSnippets: OtelLanguageSnippets = {
  install: install,
  config: config,
};

export default DotNetSnippets;
