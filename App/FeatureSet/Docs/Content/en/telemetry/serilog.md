# Send Serilog logs to OneUptime

## Overview

[Serilog](https://serilog.net) is the most popular structured logging library for .NET. OneUptime ingests Serilog logs over the OpenTelemetry Protocol (OTLP) using the official [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry) sink. Once configured, every log event your application writes through Serilog is shipped to OneUptime where it becomes searchable in **Telemetry → Logs**, complete with structured properties, severity, and trace/span correlation.

There is no OneUptime-specific package to install — the sink talks to the same OTLP endpoint that OneUptime exposes for all OpenTelemetry data. This works for console apps, worker services, ASP.NET Core apps, and anything else that runs on .NET.

## Prerequisites

- **Sign up for a OneUptime account** – You can sign up for a free account [here](https://oneuptime.com). Please note that while the account is free, log ingestion is a paid feature. You can find more details about the pricing [here](https://oneuptime.com/pricing).
- **Create a OneUptime Project** – Once you have an account, create a project from the OneUptime dashboard. If you need help, reach out to us at support@oneuptime.com.
- **Create a Telemetry Ingestion Token** – You need a token to authenticate your logs.

After you sign up to OneUptime and create a project, click on "More" in the navigation bar and click on "Project Settings".

On the Telemetry Ingestion Key page, click on "Create Ingestion Key" to create a token.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Once you have created a token, click on "View" to view the token.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## What you need from OneUptime

| Setting | Value |
| --- | --- |
| OTLP Endpoint | `https://oneuptime.com/otlp` |
| Auth header | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |
| Service name | The name your service should appear under, e.g. `my-service` |

> **Self-hosting OneUptime?** Replace `https://oneuptime.com/otlp` with `https://YOUR-ONEUPTIME-HOST/otlp` (or `http://...` if you are not terminating TLS). Everything else stays the same.

The sink uses the OTLP **HTTP/protobuf** protocol and automatically appends the `/v1/logs` path to the endpoint, so the final URL it posts to is `https://oneuptime.com/otlp/v1/logs`. You only need to provide the base `/otlp` endpoint.

## Step 1 — Install the NuGet packages

Add Serilog and the OpenTelemetry sink to your project:

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

If you are configuring the sink from `appsettings.json` (see below), also add:

```bash
dotnet add package Serilog.Settings.Configuration
```

For ASP.NET Core apps, the `Serilog.AspNetCore` package wires Serilog into the host and request pipeline:

```bash
dotnet add package Serilog.AspNetCore
```

## Step 2 — Configure the sink in code

The most direct way is to configure Serilog at application startup. Point the sink at your OneUptime OTLP endpoint, set the protocol to `HttpProtobuf`, pass your ingestion token as a header, and tag the logs with a `service.name`.

```csharp
using Serilog;
using Serilog.Sinks.OpenTelemetry;

Log.Logger = new LoggerConfiguration()
    .MinimumLevel.Information()
    .Enrich.FromLogContext()
    .WriteTo.Console() // optional: keep local logs too
    .WriteTo.OpenTelemetry(options =>
    {
        // Base OTLP endpoint. The sink appends /v1/logs automatically.
        options.Endpoint = "https://oneuptime.com/otlp";
        options.Protocol = OtlpProtocol.HttpProtobuf;

        // Authenticate with your OneUptime telemetry ingestion token.
        options.Headers = new Dictionary<string, string>
        {
            ["x-oneuptime-token"] = "YOUR_TELEMETRY_INGESTION_TOKEN"
        };

        // Identify your service in OneUptime.
        options.ResourceAttributes = new Dictionary<string, object>
        {
            ["service.name"] = "my-service",
            ["deployment.environment"] = "production"
        };
    })
    .CreateLogger();

try
{
    Log.Information("Application starting up");
    // ... your application code ...
}
finally
{
    // Flush any buffered logs before the process exits.
    Log.CloseAndFlush();
}
```

> **Important:** The sink batches log events and sends them asynchronously. Always call `Log.CloseAndFlush()` (or dispose the logger) before your application exits, otherwise the last batch of logs may be lost. In ASP.NET Core, `Serilog.AspNetCore` handles this for you on graceful shutdown.

## Step 3 — Configure from appsettings.json (alternative)

If you prefer configuration over code, use `Serilog.Settings.Configuration` and put the sink settings in `appsettings.json`:

```json
{
  "Serilog": {
    "Using": [ "Serilog.Sinks.OpenTelemetry" ],
    "MinimumLevel": "Information",
    "WriteTo": [
      {
        "Name": "OpenTelemetry",
        "Args": {
          "endpoint": "https://oneuptime.com/otlp",
          "protocol": "HttpProtobuf",
          "headers": {
            "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
          },
          "resourceAttributes": {
            "service.name": "my-service",
            "deployment.environment": "production"
          }
        }
      }
    ]
  }
}
```

Then build the logger from configuration:

```csharp
using Serilog;
using Microsoft.Extensions.Configuration;

IConfiguration configuration = new ConfigurationBuilder()
    .AddJsonFile("appsettings.json")
    .Build();

Log.Logger = new LoggerConfiguration()
    .ReadFrom.Configuration(configuration)
    .CreateLogger();
```

> Keep the token out of source control. Reference it from an environment variable or a secrets store and inject it into configuration at startup rather than committing it to `appsettings.json`.

## ASP.NET Core integration

For ASP.NET Core (.NET 6+ minimal hosting), use `Serilog.AspNetCore` so Serilog replaces the default logger and captures framework + request logs as well:

```csharp
using Serilog;
using Serilog.Sinks.OpenTelemetry;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, services, configuration) =>
{
    configuration
        .ReadFrom.Configuration(context.Configuration)
        .Enrich.FromLogContext()
        .WriteTo.OpenTelemetry(options =>
        {
            options.Endpoint = "https://oneuptime.com/otlp";
            options.Protocol = OtlpProtocol.HttpProtobuf;
            options.Headers = new Dictionary<string, string>
            {
                ["x-oneuptime-token"] = "YOUR_TELEMETRY_INGESTION_TOKEN"
            };
            options.ResourceAttributes = new Dictionary<string, object>
            {
                ["service.name"] = "my-service"
            };
        });
});

// Logs one summary event per HTTP request.
var app = builder.Build();
app.UseSerilogRequestLogging();

app.MapGet("/", () => "Hello World");
app.Run();
```

## Writing logs

Once configured, use Serilog as you normally would. Structured properties are preserved and become searchable attributes in OneUptime:

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

Each named property (`OrderId`, `CustomerId`, `Amount`, `LatencyMs`) is sent as a log attribute, so you can filter and search on them in the **Telemetry → Logs** explorer.

## Exceptions

When you log an exception with Serilog, the sink attaches the OpenTelemetry `exception.type`, `exception.message`, and `exception.stacktrace` attributes to the log record:

```csharp
try
{
    ProcessPayment();
}
catch (Exception ex)
{
    Log.Error(ex, "Failed to process payment for order {OrderId}", orderId);
}
```

OneUptime detects these attributes and rolls the error into the **Exceptions** (Issues) view automatically, grouped by fingerprint and attributed to the right service. An error reported by both a trace and a log collapses into a single issue. See [Exceptions from logs](/docs/telemetry/open-telemetry) for details on how detection works.

## Trace correlation

If your application is also instrumented with the OpenTelemetry .NET SDK for traces, Serilog log events emitted inside an active span are automatically stamped with the current `TraceId` and `SpanId` (this is part of the sink's default `IncludedData`). That lets OneUptime link a log line directly to the trace it happened in, so you can jump from a log to the surrounding request and back.

## Verify

1. Run your application and generate a few log events.
2. Open OneUptime, go to **Telemetry**, select your service (`my-service`), and open **Logs**.
3. You should see your Serilog events appear within a few seconds, with their structured properties available as filters.

## Troubleshooting

- **No logs appear** – Double-check the `x-oneuptime-token` value and confirm it belongs to the project you are viewing. Verify the endpoint is `https://oneuptime.com/otlp` (base path only — do not append `/v1/logs` yourself).
- **Logs appear only when the app exits, or the last logs are missing** – Ensure `Log.CloseAndFlush()` runs on shutdown. The sink batches events, so buffered logs are lost if the process is killed without flushing.
- **`401 Unauthorized` / nothing ingested** – The token is missing or invalid. Confirm the header key is exactly `x-oneuptime-token`.
- **Wrong service name** – Set `service.name` in `ResourceAttributes` (code) or `resourceAttributes` (appsettings.json). Without it, logs fall back to a default/unknown service.
- **Connection errors to a self-hosted instance** – Make sure the protocol matches your endpoint scheme (`https://` vs `http://`) and that your OneUptime host is reachable from the application.

If you have any questions or need help, please reach out to us at support@oneuptime.com.
