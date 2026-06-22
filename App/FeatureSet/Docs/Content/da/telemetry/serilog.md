# Send Serilog-logs til OneUptime

## Oversigt

[Serilog](https://serilog.net) er det mest populære struktureret logning-bibliotek til .NET. OneUptime indtager Serilog-logs over OpenTelemetry Protocol (OTLP) ved hjælp af den officielle [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry)-sink. Når den er konfigureret, sendes hver loghændelse, som din applikation skriver gennem Serilog, til OneUptime, hvor den bliver søgbar i **Telemetry → Logs**, komplet med strukturerede egenskaber, alvorlighed og trace/span-korrelation.

Der er ingen OneUptime-specifik pakke at installere — sinken taler med det samme OTLP-endpoint, som OneUptime eksponerer for alle OpenTelemetry-data. Dette fungerer for konsolapps, worker-tjenester, ASP.NET Core-apps og alt andet, der kører på .NET.

## Forudsætninger

- **Tilmeld dig en OneUptime-konto** – Du kan tilmelde dig en gratis konto [her](https://oneuptime.com). Bemærk venligst, at selvom kontoen er gratis, er logindtagelse en betalt funktion. Du kan finde flere detaljer om prissætningen [her](https://oneuptime.com/pricing).
- **Opret et OneUptime-projekt** – Når du har en konto, skal du oprette et projekt fra OneUptime-dashboardet. Hvis du har brug for hjælp, kan du kontakte os på support@oneuptime.com.
- **Opret et token til telemetri-indtagelse** – Du har brug for et token til at autentificere dine logs.

Efter du har tilmeldt dig OneUptime og oprettet et projekt, skal du klikke på "More" i navigationslinjen og klikke på "Project Settings".

På siden Telemetry Ingestion Key skal du klikke på "Create Ingestion Key" for at oprette et token.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Når du har oprettet et token, skal du klikke på "View" for at se tokenet.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## Hvad du har brug for fra OneUptime

| Indstilling   | Værdi                                                        |
| ------------- | ------------------------------------------------------------ |
| OTLP-endpoint | `https://oneuptime.com/otlp`                                 |
| Auth-header   | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN`          |
| Tjenestenavn  | Det navn, din tjeneste skal vises under, f.eks. `my-service` |

> **Selv-hoster du OneUptime?** Erstat `https://oneuptime.com/otlp` med `https://YOUR-ONEUPTIME-HOST/otlp` (eller `http://...`, hvis du ikke terminerer TLS). Alt andet forbliver det samme.

Sinken bruger OTLP **HTTP/protobuf**-protokollen og tilføjer automatisk `/v1/logs`-stien til endpointet, så den endelige URL, den poster til, er `https://oneuptime.com/otlp/v1/logs`. Du behøver kun at angive base-`/otlp`-endpointet.

## Trin 1 — Installér NuGet-pakkerne

Tilføj Serilog og OpenTelemetry-sinken til dit projekt:

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

Hvis du konfigurerer sinken fra `appsettings.json` (se nedenfor), skal du også tilføje:

```bash
dotnet add package Serilog.Settings.Configuration
```

Til ASP.NET Core-apps forbinder `Serilog.AspNetCore`-pakken Serilog med hosten og request-pipelinen:

```bash
dotnet add package Serilog.AspNetCore
```

## Trin 2 — Konfigurér sinken i kode

Den mest direkte måde er at konfigurere Serilog ved applikationens opstart. Peg sinken mod dit OneUptime OTLP-endpoint, indstil protokollen til `HttpProtobuf`, send dit indtagelsestoken som en header, og tag dine logs med et `service.name`.

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

> **Vigtigt:** Sinken samler loghændelser i batches og sender dem asynkront. Kald altid `Log.CloseAndFlush()` (eller dispose loggeren), før din applikation afsluttes, ellers kan den sidste batch af logs gå tabt. I ASP.NET Core håndterer `Serilog.AspNetCore` dette for dig ved en pæn nedlukning.

## Trin 3 — Konfigurér fra appsettings.json (alternativ)

Hvis du foretrækker konfiguration frem for kode, kan du bruge `Serilog.Settings.Configuration` og placere sink-indstillingerne i `appsettings.json`:

```json
{
  "Serilog": {
    "Using": ["Serilog.Sinks.OpenTelemetry"],
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

Byg derefter loggeren ud fra konfigurationen:

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

> Hold tokenet uden for kildekontrol. Referér til det fra en miljøvariabel eller et secrets-lager, og injicér det i konfigurationen ved opstart i stedet for at committe det til `appsettings.json`.

## ASP.NET Core-integration

Til ASP.NET Core (.NET 6+ minimal hosting) skal du bruge `Serilog.AspNetCore`, så Serilog erstatter standardloggeren og også fanger framework- + request-logs:

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

## Skrivning af logs

Når den er konfigureret, kan du bruge Serilog, som du plejer. Strukturerede egenskaber bevares og bliver søgbare attributter i OneUptime:

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

Hver navngiven egenskab (`OrderId`, `CustomerId`, `Amount`, `LatencyMs`) sendes som en log-attribut, så du kan filtrere og søge på dem i **Telemetry → Logs**-udforskeren.

## Undtagelser

Når du logger en undtagelse med Serilog, knytter sinken OpenTelemetry-attributterne `exception.type`, `exception.message` og `exception.stacktrace` til log-posten:

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

OneUptime registrerer disse attributter og ruller automatisk fejlen ind i **Exceptions** (Issues)-visningen, grupperet efter fingeraftryk og tilskrevet den rigtige tjeneste. En fejl, der rapporteres af både et trace og en log, kollapser til et enkelt issue. Se [Undtagelser fra logs](/docs/telemetry/open-telemetry) for detaljer om, hvordan registreringen fungerer.

## Trace-korrelation

Hvis din applikation også er instrumenteret med OpenTelemetry .NET SDK til traces, stemples Serilog-loghændelser, der udsendes inde i et aktivt span, automatisk med det aktuelle `TraceId` og `SpanId` (dette er en del af sinkens standard-`IncludedData`). Det lader OneUptime linke en loglinje direkte til det trace, den skete i, så du kan springe fra en log til den omgivende request og tilbage igen.

## Verificér

1. Kør din applikation og generér nogle få loghændelser.
2. Åbn OneUptime, gå til **Telemetry**, vælg din tjeneste (`my-service`), og åbn **Logs**.
3. Du bør se dine Serilog-hændelser dukke op inden for nogle få sekunder, med deres strukturerede egenskaber tilgængelige som filtre.

## Fejlfinding

- **Ingen logs vises** – Dobbelttjek `x-oneuptime-token`-værdien og bekræft, at den tilhører det projekt, du ser på. Verificér, at endpointet er `https://oneuptime.com/otlp` (kun base-sti — tilføj ikke `/v1/logs` selv).
- **Logs vises kun, når appen afsluttes, eller de sidste logs mangler** – Sørg for, at `Log.CloseAndFlush()` kører ved nedlukning. Sinken samler hændelser i batches, så bufferede logs går tabt, hvis processen dræbes uden at flushe.
- **`401 Unauthorized` / intet indtages** – Tokenet mangler eller er ugyldigt. Bekræft, at header-nøglen er præcis `x-oneuptime-token`.
- **Forkert tjenestenavn** – Sæt `service.name` i `ResourceAttributes` (kode) eller `resourceAttributes` (appsettings.json). Uden det falder logs tilbage til en standard-/ukendt tjeneste.
- **Forbindelsesfejl til en selv-hostet instans** – Sørg for, at protokollen matcher dit endpoints skema (`https://` vs `http://`), og at din OneUptime-host er tilgængelig fra applikationen.

Hvis du har spørgsmål eller har brug for hjælp, så kontakt os venligst på support@oneuptime.com.
