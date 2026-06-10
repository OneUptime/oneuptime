# Envoyer les journaux Serilog vers OneUptime

## Aperçu

[Serilog](https://serilog.net) est la bibliothèque de journalisation structurée la plus populaire pour .NET. OneUptime ingère les journaux Serilog via le protocole OpenTelemetry (OTLP) en utilisant le sink officiel [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry). Une fois configuré, chaque événement de journal que votre application écrit via Serilog est expédié vers OneUptime où il devient consultable dans **Telemetry → Logs**, accompagné de ses propriétés structurées, de sa gravité et de la corrélation trace/span.

Il n'y a aucun package spécifique à OneUptime à installer — le sink communique avec le même point de terminaison OTLP que OneUptime expose pour toutes les données OpenTelemetry. Cela fonctionne pour les applications console, les services de travail (worker services), les applications ASP.NET Core et tout autre programme qui s'exécute sur .NET.

## Prérequis

- **Créez un compte OneUptime** – Vous pouvez créer un compte gratuit [ici](https://oneuptime.com). Veuillez noter que, bien que le compte soit gratuit, l'ingestion de journaux est une fonctionnalité payante. Vous trouverez plus de détails sur la tarification [ici](https://oneuptime.com/pricing).
- **Créez un projet OneUptime** – Une fois que vous avez un compte, créez un projet depuis le tableau de bord OneUptime. Si vous avez besoin d'aide, contactez-nous à support@oneuptime.com.
- **Créez un jeton d'ingestion de télémétrie** – Vous avez besoin d'un jeton pour authentifier vos journaux.

Après vous être inscrit à OneUptime et avoir créé un projet, cliquez sur « More » dans la barre de navigation, puis sur « Project Settings ».

Sur la page Telemetry Ingestion Key, cliquez sur « Create Ingestion Key » pour créer un jeton.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Une fois que vous avez créé un jeton, cliquez sur « View » pour le consulter.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## Ce dont vous avez besoin de la part de OneUptime

| Paramètre | Valeur |
| --- | --- |
| Point de terminaison OTLP | `https://oneuptime.com/otlp` |
| En-tête d'authentification | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |
| Nom du service | Le nom sous lequel votre service doit apparaître, par exemple `my-service` |

> **Vous hébergez OneUptime vous-même ?** Remplacez `https://oneuptime.com/otlp` par `https://YOUR-ONEUPTIME-HOST/otlp` (ou `http://...` si vous ne terminez pas le TLS). Tout le reste demeure inchangé.

Le sink utilise le protocole OTLP **HTTP/protobuf** et ajoute automatiquement le chemin `/v1/logs` au point de terminaison, de sorte que l'URL finale vers laquelle il publie est `https://oneuptime.com/otlp/v1/logs`. Vous n'avez qu'à fournir le point de terminaison de base `/otlp`.

## Étape 1 — Installer les packages NuGet

Ajoutez Serilog et le sink OpenTelemetry à votre projet :

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

Si vous configurez le sink à partir de `appsettings.json` (voir ci-dessous), ajoutez également :

```bash
dotnet add package Serilog.Settings.Configuration
```

Pour les applications ASP.NET Core, le package `Serilog.AspNetCore` intègre Serilog dans l'hôte et le pipeline de requêtes :

```bash
dotnet add package Serilog.AspNetCore
```

## Étape 2 — Configurer le sink dans le code

La méthode la plus directe consiste à configurer Serilog au démarrage de l'application. Pointez le sink vers votre point de terminaison OTLP OneUptime, définissez le protocole sur `HttpProtobuf`, passez votre jeton d'ingestion en tant qu'en-tête et étiquetez les journaux avec un `service.name`.

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

> **Important :** Le sink regroupe les événements de journal par lots et les envoie de manière asynchrone. Appelez toujours `Log.CloseAndFlush()` (ou libérez le logger) avant que votre application ne se termine, faute de quoi le dernier lot de journaux pourrait être perdu. Dans ASP.NET Core, `Serilog.AspNetCore` s'en charge pour vous lors d'un arrêt en douceur.

## Étape 3 — Configurer à partir de appsettings.json (alternative)

Si vous préférez la configuration au code, utilisez `Serilog.Settings.Configuration` et placez les paramètres du sink dans `appsettings.json` :

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

Construisez ensuite le logger à partir de la configuration :

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

> Gardez le jeton en dehors du contrôle de version. Référencez-le à partir d'une variable d'environnement ou d'un magasin de secrets et injectez-le dans la configuration au démarrage plutôt que de le valider dans `appsettings.json`.

## Intégration ASP.NET Core

Pour ASP.NET Core (.NET 6+ avec hébergement minimal), utilisez `Serilog.AspNetCore` afin que Serilog remplace le logger par défaut et capture également les journaux du framework et des requêtes :

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

## Écrire des journaux

Une fois la configuration effectuée, utilisez Serilog comme vous le feriez normalement. Les propriétés structurées sont préservées et deviennent des attributs consultables dans OneUptime :

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

Chaque propriété nommée (`OrderId`, `CustomerId`, `Amount`, `LatencyMs`) est envoyée en tant qu'attribut de journal, ce qui vous permet de les filtrer et de les rechercher dans l'explorateur **Telemetry → Logs**.

## Exceptions

Lorsque vous journalisez une exception avec Serilog, le sink attache les attributs OpenTelemetry `exception.type`, `exception.message` et `exception.stacktrace` à l'enregistrement de journal :

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

OneUptime détecte ces attributs et regroupe automatiquement l'erreur dans la vue **Exceptions** (Issues), regroupée par empreinte (fingerprint) et attribuée au bon service. Une erreur signalée à la fois par une trace et par un journal se rassemble en un seul problème. Consultez [Exceptions à partir des journaux](/docs/telemetry/open-telemetry) pour plus de détails sur le fonctionnement de la détection.

## Corrélation des traces

Si votre application est également instrumentée avec le SDK OpenTelemetry .NET pour les traces, les événements de journal Serilog émis à l'intérieur d'un span actif sont automatiquement estampillés avec les `TraceId` et `SpanId` courants (cela fait partie de l'`IncludedData` par défaut du sink). Cela permet à OneUptime de relier directement une ligne de journal à la trace dans laquelle elle s'est produite, de sorte que vous pouvez passer d'un journal à la requête environnante et inversement.

## Vérifier

1. Exécutez votre application et générez quelques événements de journal.
2. Ouvrez OneUptime, allez dans **Telemetry**, sélectionnez votre service (`my-service`) et ouvrez **Logs**.
3. Vos événements Serilog devraient apparaître en quelques secondes, avec leurs propriétés structurées disponibles en tant que filtres.

## Dépannage

- **Aucun journal n'apparaît** – Vérifiez bien la valeur de `x-oneuptime-token` et confirmez qu'elle appartient au projet que vous consultez. Vérifiez que le point de terminaison est `https://oneuptime.com/otlp` (chemin de base uniquement — n'ajoutez pas `/v1/logs` vous-même).
- **Les journaux n'apparaissent que lorsque l'application se termine, ou les derniers journaux sont manquants** – Assurez-vous que `Log.CloseAndFlush()` s'exécute à l'arrêt. Le sink regroupe les événements par lots, de sorte que les journaux mis en mémoire tampon sont perdus si le processus est arrêté sans vidage (flush).
- **`401 Unauthorized` / rien n'est ingéré** – Le jeton est manquant ou invalide. Confirmez que la clé d'en-tête est exactement `x-oneuptime-token`.
- **Mauvais nom de service** – Définissez `service.name` dans `ResourceAttributes` (code) ou `resourceAttributes` (appsettings.json). Sans cela, les journaux retombent sur un service par défaut/inconnu.
- **Erreurs de connexion vers une instance auto-hébergée** – Assurez-vous que le protocole correspond au schéma de votre point de terminaison (`https://` vs `http://`) et que votre hôte OneUptime est accessible depuis l'application.

Si vous avez des questions ou avez besoin d'aide, n'hésitez pas à nous contacter à support@oneuptime.com.
