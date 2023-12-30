using System.Diagnostics;
using System.Diagnostics.Metrics;
using OpenTelemetry.Logs;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

var builder = WebApplication.CreateBuilder(args);

Console.WriteLine($"Env var: {Environment.GetEnvironmentVariable("OTEL_EXPORTER_OTLP_HEADERS")?.ToString()}");


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
            // opt.Protocol = OpenTelemetry.Exporter.OtlpExportProtocol.HttpProtobuf;
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
                   // opt.Protocol = OpenTelemetry.Exporter.OtlpExportProtocol.HttpProtobuf;

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
                    // opt.Protocol = OpenTelemetry.Exporter.OtlpExportProtocol.HttpProtobuf;
                    System.Console.WriteLine($"OTLP Exporter is using {opt.Protocol} protocol and endpoint {opt.Endpoint}");

                }));




var app = builder.Build();

greeterMeter.CreateObservableGauge("ThreadCount", () => new[] { new Measurement<int>(ThreadPool.ThreadCount) });

var histogram = greeterMeter.CreateHistogram<int>("greetings.size", "Size of greetings", "desc");

var countGreetings = greeterMeter.CreateCounter<int>("greetings.count", description: "Counts the number of greetings");



// Custom ActivitySource for the application
var greeterActivitySource = new ActivitySource("OtPrGrJa.Example");


async Task<String> LogMessage(ILogger<Program> logger)
{
    // Create a new Activity scoped to the method
    using var activity = greeterActivitySource.StartActivity("GreeterActivity");

    // Log a message
    logger.LogInformation("User johndoe@company.com has logged in.");
    // logger.LogError("Error sending greeting");
    // logger.LogWarning("Warning sending greeting");

    // // very big log message 
    // logger.LogInformation("LONG LOG:  sdsfdg dfgdfgdfg dfgdfgfdgdfg dfgdfgdfg fdgfdgdf fdjgk gkdfjgf dfkgjdfkgjdfkjgkdfjgk  gdkfjgkdfjgkdfj gjdfkjgkdfjgkdfjgk fdjgkdfjgkdfjgkjdfkgj fdkgjfdkgjdfkgjkdfg dfkgjdfkjgkfdjgkfjkgdfjkg fdkgjkfdgjkdfjgkjdkg fdkgjdfkjgk");

    // Increment the custom counter
    countGreetings.Add(1);

    // Add a tag to the Activity
    activity?.SetTag("greeting", "Hello World!");

    //log out env var 
   
    histogram.Record("Hello World!".Length);

    return $"Hello World! OpenTelemetry Trace: {Activity.Current?.Id}";
}

async Task<String> LogError(ILogger<Program> logger)
{
    // Create a new Activity scoped to the method
    using var activity = greeterActivitySource.StartActivity("GreeterActivity");
    // Log a message
    logger.LogError("Transaction "+Guid.NewGuid().ToString()+" failed");

    return $"Hello World! OpenTelemetry Trace: {Activity.Current?.Id}";
}


async Task<String> LogWarning(ILogger<Program> logger)
{
    // Create a new Activity scoped to the method
    using var activity = greeterActivitySource.StartActivity("GreeterActivity");
    // Log a message
    logger.LogWarning("Account balance is 0 USD. Cannot complete transaction "+Guid.NewGuid().ToString());

    return $"Hello World! OpenTelemetry Trace: {Activity.Current?.Id}";
}


async Task<String> LogInformation(ILogger<Program> logger)
{
    // Create a new Activity scoped to the method
    using var activity = greeterActivitySource.StartActivity("GreeterActivity");
    // Log a message
    logger.LogInformation("Transaction Success: "+Guid.NewGuid().ToString());

    return $"Hello World! OpenTelemetry Trace: {Activity.Current?.Id}";
}


app.MapGet("/", LogMessage);
app.MapGet("/error", LogError);
app.MapGet("/warning", LogWarning);
app.MapGet("/info", LogInformation);


app.Run();
