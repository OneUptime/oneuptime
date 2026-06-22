# Serilog-logs naar OneUptime sturen

## Overzicht

[Serilog](https://serilog.net) is de populairste bibliotheek voor gestructureerde logging voor .NET. OneUptime neemt Serilog-logs op via het OpenTelemetry Protocol (OTLP) met behulp van de officiële [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry) sink. Eenmaal geconfigureerd wordt elke loggebeurtenis die je applicatie via Serilog schrijft naar OneUptime verzonden, waar deze doorzoekbaar wordt in **Telemetry → Logs**, compleet met gestructureerde eigenschappen, ernst en trace/span-correlatie.

Er is geen OneUptime-specifiek pakket om te installeren — de sink communiceert met hetzelfde OTLP-eindpunt dat OneUptime beschikbaar stelt voor alle OpenTelemetry-data. Dit werkt voor console-apps, worker-services, ASP.NET Core-apps en alles wat verder op .NET draait.

## Vereisten

- **Meld je aan voor een OneUptime-account** – Je kunt je [hier](https://oneuptime.com) gratis aanmelden voor een account. Houd er rekening mee dat het account weliswaar gratis is, maar dat log-ingestie een betaalde functie is. Meer details over de prijzen vind je [hier](https://oneuptime.com/pricing).
- **Maak een OneUptime-project aan** – Zodra je een account hebt, maak je een project aan vanuit het OneUptime-dashboard. Heb je hulp nodig, neem dan contact met ons op via support@oneuptime.com.
- **Maak een Telemetry Ingestion Token aan** – Je hebt een token nodig om je logs te authenticeren.

Nadat je je hebt aangemeld bij OneUptime en een project hebt aangemaakt, klik je op "More" in de navigatiebalk en vervolgens op "Project Settings".

Klik op de pagina Telemetry Ingestion Key op "Create Ingestion Key" om een token aan te maken.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Zodra je een token hebt aangemaakt, klik je op "View" om het token te bekijken.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## Wat je nodig hebt van OneUptime

| Instelling    | Waarde                                                            |
| ------------- | ----------------------------------------------------------------- |
| OTLP-eindpunt | `https://oneuptime.com/otlp`                                      |
| Auth-header   | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN`               |
| Servicenaam   | De naam waaronder je service moet verschijnen, bijv. `my-service` |

> **OneUptime zelf hosten?** Vervang `https://oneuptime.com/otlp` door `https://YOUR-ONEUPTIME-HOST/otlp` (of `http://...` als je geen TLS afhandelt). Al het overige blijft hetzelfde.

De sink gebruikt het OTLP **HTTP/protobuf**-protocol en voegt automatisch het pad `/v1/logs` toe aan het eindpunt, zodat de uiteindelijke URL waarnaar wordt gepost `https://oneuptime.com/otlp/v1/logs` is. Je hoeft alleen het basis-eindpunt `/otlp` op te geven.

## Stap 1 — Installeer de NuGet-pakketten

Voeg Serilog en de OpenTelemetry-sink toe aan je project:

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

Als je de sink configureert vanuit `appsettings.json` (zie hieronder), voeg dan ook toe:

```bash
dotnet add package Serilog.Settings.Configuration
```

Voor ASP.NET Core-apps koppelt het pakket `Serilog.AspNetCore` Serilog aan de host en de request-pipeline:

```bash
dotnet add package Serilog.AspNetCore
```

## Stap 2 — Configureer de sink in code

De meest directe manier is om Serilog bij het opstarten van de applicatie te configureren. Wijs de sink naar je OneUptime OTLP-eindpunt, stel het protocol in op `HttpProtobuf`, geef je ingestie-token door als header en label de logs met een `service.name`.

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

> **Belangrijk:** De sink bundelt loggebeurtenissen en verzendt ze asynchroon. Roep altijd `Log.CloseAndFlush()` aan (of dispose de logger) voordat je applicatie afsluit, anders kan de laatste batch logs verloren gaan. In ASP.NET Core regelt `Serilog.AspNetCore` dit voor je bij een nette afsluiting.

## Stap 3 — Configureer vanuit appsettings.json (alternatief)

Als je configuratie verkiest boven code, gebruik dan `Serilog.Settings.Configuration` en zet de sink-instellingen in `appsettings.json`:

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

Bouw vervolgens de logger op basis van de configuratie:

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

> Houd het token buiten versiebeheer. Verwijs ernaar vanuit een omgevingsvariabele of een secrets-store en injecteer het bij het opstarten in de configuratie, in plaats van het vast te leggen in `appsettings.json`.

## ASP.NET Core-integratie

Voor ASP.NET Core (.NET 6+ minimal hosting) gebruik je `Serilog.AspNetCore` zodat Serilog de standaardlogger vervangt en ook framework- + request-logs vastlegt:

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

## Logs schrijven

Eenmaal geconfigureerd gebruik je Serilog zoals je dat normaal zou doen. Gestructureerde eigenschappen blijven behouden en worden doorzoekbare attributen in OneUptime:

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

Elke benoemde eigenschap (`OrderId`, `CustomerId`, `Amount`, `LatencyMs`) wordt als log-attribuut verzonden, zodat je erop kunt filteren en zoeken in de **Telemetry → Logs**-verkenner.

## Exceptions

Wanneer je een exception logt met Serilog, voegt de sink de OpenTelemetry-attributen `exception.type`, `exception.message` en `exception.stacktrace` toe aan het logrecord:

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

OneUptime detecteert deze attributen en neemt de fout automatisch op in de **Exceptions** (Issues)-weergave, gegroepeerd op fingerprint en toegeschreven aan de juiste service. Een fout die zowel door een trace als door een log wordt gerapporteerd, valt samen tot één enkel issue. Zie [Exceptions from logs](/docs/telemetry/open-telemetry) voor details over hoe de detectie werkt.

## Trace-correlatie

Als je applicatie ook is geïnstrumenteerd met de OpenTelemetry .NET SDK voor traces, worden Serilog-loggebeurtenissen die binnen een actieve span worden uitgezonden, automatisch gestempeld met de huidige `TraceId` en `SpanId` (dit maakt deel uit van de standaard `IncludedData` van de sink). Daardoor kan OneUptime een logregel rechtstreeks koppelen aan de trace waarin deze plaatsvond, zodat je vanuit een log naar de omringende request kunt springen en weer terug.

## Verifiëren

1. Voer je applicatie uit en genereer een paar loggebeurtenissen.
2. Open OneUptime, ga naar **Telemetry**, selecteer je service (`my-service`) en open **Logs**.
3. Je zou je Serilog-gebeurtenissen binnen een paar seconden moeten zien verschijnen, met hun gestructureerde eigenschappen beschikbaar als filters.

## Problemen oplossen

- **Er verschijnen geen logs** – Controleer nogmaals de waarde van `x-oneuptime-token` en bevestig dat deze bij het project hoort dat je bekijkt. Verifieer dat het eindpunt `https://oneuptime.com/otlp` is (alleen het basispad — voeg niet zelf `/v1/logs` toe).
- **Logs verschijnen alleen wanneer de app afsluit, of de laatste logs ontbreken** – Zorg ervoor dat `Log.CloseAndFlush()` bij het afsluiten wordt uitgevoerd. De sink bundelt gebeurtenissen, dus gebufferde logs gaan verloren als het proces wordt beëindigd zonder te flushen.
- **`401 Unauthorized` / niets opgenomen** – Het token ontbreekt of is ongeldig. Bevestig dat de header-sleutel exact `x-oneuptime-token` is.
- **Verkeerde servicenaam** – Stel `service.name` in `ResourceAttributes` (code) of `resourceAttributes` (appsettings.json) in. Zonder deze instelling vallen logs terug op een standaard/onbekende service.
- **Verbindingsfouten met een zelf-gehoste instantie** – Zorg ervoor dat het protocol overeenkomt met het schema van je eindpunt (`https://` versus `http://`) en dat je OneUptime-host bereikbaar is vanaf de applicatie.

Heb je vragen of hulp nodig, neem dan contact met ons op via support@oneuptime.com.
