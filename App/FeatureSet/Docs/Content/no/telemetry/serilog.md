# Send Serilog-logger til OneUptime

## Oversikt

[Serilog](https://serilog.net) er det mest populære biblioteket for strukturert logging i .NET. OneUptime tar imot Serilog-logger over OpenTelemetry-protokollen (OTLP) ved hjelp av den offisielle [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry)-sinken. Når den er konfigurert, sendes hver logghendelse som applikasjonen din skriver gjennom Serilog til OneUptime, der den blir søkbar i **Telemetry → Logs**, komplett med strukturerte egenskaper, alvorlighetsgrad og trace/span-korrelasjon.

Det finnes ingen OneUptime-spesifikk pakke å installere — sinken kommuniserer med det samme OTLP-endepunktet som OneUptime eksponerer for alle OpenTelemetry-data. Dette fungerer for konsollapplikasjoner, worker-tjenester, ASP.NET Core-applikasjoner og alt annet som kjører på .NET.

## Forutsetninger

- **Registrer en OneUptime-konto** – Du kan registrere en gratis konto [her](https://oneuptime.com). Vær oppmerksom på at selv om kontoen er gratis, er logginnsamling en betalt funksjon. Du finner flere detaljer om prisene [her](https://oneuptime.com/pricing).
- **Opprett et OneUptime-prosjekt** – Når du har en konto, oppretter du et prosjekt fra OneUptime-dashbordet. Hvis du trenger hjelp, ta kontakt med oss på support@oneuptime.com.
- **Opprett et token for telemetriinnsamling** – Du trenger et token for å autentisere loggene dine.

Etter at du har registrert deg hos OneUptime og opprettet et prosjekt, klikker du på "More" i navigasjonslinjen og deretter på "Project Settings".

På siden Telemetry Ingestion Key klikker du på "Create Ingestion Key" for å opprette et token.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Når du har opprettet et token, klikker du på "View" for å vise tokenet.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## Hva du trenger fra OneUptime

| Innstilling    | Verdi                                                      |
| -------------- | ---------------------------------------------------------- |
| OTLP-endepunkt | `https://oneuptime.com/otlp`                               |
| Auth-header    | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN`        |
| Tjenestenavn   | Navnet tjenesten din skal vises under, f.eks. `my-service` |

> **Selvhoster du OneUptime?** Erstatt `https://oneuptime.com/otlp` med `https://YOUR-ONEUPTIME-HOST/otlp` (eller `http://...` hvis du ikke terminerer TLS). Alt annet forblir det samme.

Sinken bruker OTLP-protokollen **HTTP/protobuf** og legger automatisk til stien `/v1/logs` på endepunktet, slik at den endelige URL-en den sender til er `https://oneuptime.com/otlp/v1/logs`. Du trenger bare å oppgi grunnendepunktet `/otlp`.

## Steg 1 — Installer NuGet-pakkene

Legg Serilog og OpenTelemetry-sinken til prosjektet ditt:

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

Hvis du konfigurerer sinken fra `appsettings.json` (se nedenfor), legg også til:

```bash
dotnet add package Serilog.Settings.Configuration
```

For ASP.NET Core-applikasjoner kobler pakken `Serilog.AspNetCore` Serilog inn i hosten og forespørselspipelinen:

```bash
dotnet add package Serilog.AspNetCore
```

## Steg 2 — Konfigurer sinken i kode

Den mest direkte måten er å konfigurere Serilog ved oppstart av applikasjonen. Pek sinken mot OneUptime-OTLP-endepunktet ditt, sett protokollen til `HttpProtobuf`, send innsamlingstokenet ditt som en header, og merk loggene med et `service.name`.

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

> **Viktig:** Sinken samler logghendelser i batcher og sender dem asynkront. Kall alltid `Log.CloseAndFlush()` (eller frigjør loggeren) før applikasjonen avsluttes, ellers kan den siste batchen med logger gå tapt. I ASP.NET Core håndterer `Serilog.AspNetCore` dette for deg ved kontrollert nedstengning.

## Steg 3 — Konfigurer fra appsettings.json (alternativ)

Hvis du foretrekker konfigurasjon fremfor kode, bruk `Serilog.Settings.Configuration` og legg sink-innstillingene i `appsettings.json`:

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

Bygg deretter loggeren fra konfigurasjonen:

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

> Hold tokenet utenfor versjonskontroll. Referer til det fra en miljøvariabel eller et hemmelighetslager og injiser det i konfigurasjonen ved oppstart i stedet for å sjekke det inn i `appsettings.json`.

## ASP.NET Core-integrasjon

For ASP.NET Core (.NET 6+ minimal hosting) bruker du `Serilog.AspNetCore` slik at Serilog erstatter standardloggeren og også fanger opp rammeverk- og forespørselslogger:

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

## Skrive logger

Når den er konfigurert, bruker du Serilog slik du normalt ville gjort. Strukturerte egenskaper bevares og blir søkbare attributter i OneUptime:

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

Hver navngitt egenskap (`OrderId`, `CustomerId`, `Amount`, `LatencyMs`) sendes som et loggattributt, slik at du kan filtrere og søke på dem i **Telemetry → Logs**-utforskeren.

## Unntak

Når du logger et unntak med Serilog, fester sinken OpenTelemetry-attributtene `exception.type`, `exception.message` og `exception.stacktrace` til loggposten:

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

OneUptime oppdager disse attributtene og ruller feilen inn i **Exceptions**-visningen (Issues) automatisk, gruppert etter fingeravtrykk og tilskrevet riktig tjeneste. En feil som rapporteres av både en trace og en logg, slås sammen til ett enkelt issue. Se [Unntak fra logger](/docs/telemetry/open-telemetry) for detaljer om hvordan deteksjonen fungerer.

## Trace-korrelasjon

Hvis applikasjonen din også er instrumentert med OpenTelemetry .NET SDK for traces, blir Serilog-logghendelser som sendes ut inne i en aktiv span, automatisk stemplet med gjeldende `TraceId` og `SpanId` (dette er en del av sinkens standard `IncludedData`). Det lar OneUptime koble en loggrad direkte til tracen den skjedde i, slik at du kan hoppe fra en logg til den omkringliggende forespørselen og tilbake.

## Verifiser

1. Kjør applikasjonen din og generer noen logghendelser.
2. Åpne OneUptime, gå til **Telemetry**, velg tjenesten din (`my-service`), og åpne **Logs**.
3. Du skal se Serilog-hendelsene dine dukke opp i løpet av noen få sekunder, med de strukturerte egenskapene tilgjengelige som filtre.

## Feilsøking

- **Ingen logger vises** – Dobbeltsjekk verdien `x-oneuptime-token` og bekreft at den tilhører prosjektet du ser på. Verifiser at endepunktet er `https://oneuptime.com/otlp` (kun grunnsti — ikke legg til `/v1/logs` selv).
- **Logger vises bare når appen avsluttes, eller de siste loggene mangler** – Sørg for at `Log.CloseAndFlush()` kjører ved nedstengning. Sinken samler hendelser i batcher, så bufrede logger går tapt hvis prosessen avsluttes uten å tømme bufferen.
- **`401 Unauthorized` / ingenting tas imot** – Tokenet mangler eller er ugyldig. Bekreft at headernøkkelen er nøyaktig `x-oneuptime-token`.
- **Feil tjenestenavn** – Sett `service.name` i `ResourceAttributes` (kode) eller `resourceAttributes` (appsettings.json). Uten det faller loggene tilbake til en standard/ukjent tjeneste.
- **Tilkoblingsfeil til en selvhostet instans** – Sørg for at protokollen samsvarer med endepunktets skjema (`https://` vs `http://`) og at OneUptime-hosten din er tilgjengelig fra applikasjonen.

Hvis du har spørsmål eller trenger hjelp, ta kontakt med oss på support@oneuptime.com.
