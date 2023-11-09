using System.Diagnostics;
using System.Diagnostics.Metrics;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

var builder = WebApplication.CreateBuilder(args);

const string endpoint = "http://localhost:4317";


// Logging. 
builder.Logging.ClearProviders();

builder.Logging.AddOpenTelemetry(logging =>
{
    logging.IncludeScopes = true;

    var resourceBuilder = ResourceBuilder
        .CreateDefault()
        .AddService(builder.Environment.ApplicationName);

    logging.SetResourceBuilder(resourceBuilder)

        // ConsoleExporter is used for demo purpose only.
        // In production environment, ConsoleExporter should be replaced with other exporters (e.g. OTLP Exporter).
        .AddConsoleExporter()
        .AddOtlpExporter(opt =>
        {
            // If endpoint was not specified, the proper one will be selected according to the protocol.
            if (!string.IsNullOrEmpty(endpoint))
            {
                opt.Endpoint = new Uri(endpoint);

                // Set headers in OTLP exporter
                opt.Headers = "oneuptime-service-token=0a00ebc0-7f39-11ee-ac8c-3fb43926b224";
            }

            System.Console.WriteLine($"OTLP Exporter is using {opt.Protocol} protocol and endpoint {opt.Endpoint}");
        });
});

// Traces. 
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource
        .AddService(serviceName: builder.Environment.ApplicationName))
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation()
        .AddConsoleExporter()
         .AddOtlpExporter(opt =>
                {
                    // If endpoint was not specified, the proper one will be selected according to the protocol.
                    if (!string.IsNullOrEmpty(endpoint))
                    {
                        opt.Endpoint = new Uri(endpoint);
                        // Set headers in OTLP exporter
                        opt.Headers = "oneuptime-service-token=0a00ebc0-7f39-11ee-ac8c-3fb43926b224";
                    }

                    System.Console.WriteLine($"OTLP Exporter is using {opt.Protocol} protocol and endpoint {opt.Endpoint}");
                }));


// Custom metrics for the application
var greeterMeter = new Meter("OtPrGrYa.Example");

// Metrics.
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource
        .AddService(serviceName: builder.Environment.ApplicationName))
    .WithMetrics(metrics => metrics
        .AddAspNetCoreInstrumentation()
        .AddMeter("OtPrGrYa.Example")
        .AddConsoleExporter((exporterOptions, metricReaderOptions) =>
        {
            metricReaderOptions.PeriodicExportingMetricReaderOptions.ExportIntervalMilliseconds = 1000;
        })
         .AddOtlpExporter(opt =>
                {
                    // If endpoint was not specified, the proper one will be selected according to the protocol.
                    if (!string.IsNullOrEmpty(endpoint))
                    {
                        opt.Endpoint = new Uri(endpoint);
                        // Set headers in OTLP exporter
                        opt.Headers = "oneuptime-service-token=0a00ebc0-7f39-11ee-ac8c-3fb43926b224";
                    }

                    System.Console.WriteLine($"OTLP Exporter is using {opt.Protocol} protocol and endpoint {opt.Endpoint}");

                }));




var app = builder.Build();

greeterMeter.CreateObservableGauge("ThreadCount", () => new[] { new Measurement<int>(ThreadPool.ThreadCount) });

var histogram = greeterMeter.CreateHistogram<int>("greetings.size", "Size of greetings", "desc");

var countGreetings = greeterMeter.CreateCounter<int>("greetings.count", description: "Counts the number of greetings");



// Custom ActivitySource for the application
var greeterActivitySource = new ActivitySource("OtPrGrJa.Example");


async Task<String> SendGreeting(ILogger<Program> logger)
{
    // Create a new Activity scoped to the method
    using var activity = greeterActivitySource.StartActivity("GreeterActivity");

    // Log a message
    logger.LogInformation("Sending greeting");

    // Increment the custom counter
    countGreetings.Add(1);

    // Add a tag to the Activity
    activity?.SetTag("greeting", "Hello World!");

    histogram.Record("Hello World!".Length);

    return $"Hello World! OpenTelemetry Trace: {Activity.Current?.Id}";
}

app.MapGet("/", SendGreeting);


app.Run();
