# Serilog लॉग को OneUptime पर भेजें

## अवलोकन

[Serilog](https://serilog.net) .NET के लिए सबसे लोकप्रिय संरचित लॉगिंग लाइब्रेरी है। OneUptime आधिकारिक [`Serilog.Sinks.OpenTelemetry`](https://github.com/serilog/serilog-sinks-opentelemetry) sink का उपयोग करते हुए OpenTelemetry Protocol (OTLP) के माध्यम से Serilog लॉग ग्रहण करता है। एक बार कॉन्फ़िगर हो जाने के बाद, आपका एप्लिकेशन Serilog के माध्यम से जो भी लॉग इवेंट लिखता है, उसे OneUptime पर भेज दिया जाता है, जहाँ यह **Telemetry → Logs** में खोजने योग्य बन जाता है, जिसमें संरचित प्रॉपर्टीज़, गंभीरता, और trace/span सहसंबंध शामिल होते हैं।

इंस्टॉल करने के लिए कोई OneUptime-विशिष्ट पैकेज नहीं है — sink उसी OTLP एंडपॉइंट से बात करता है जिसे OneUptime सभी OpenTelemetry डेटा के लिए उजागर करता है। यह console ऐप्स, worker services, ASP.NET Core ऐप्स, और किसी भी अन्य चीज़ के लिए काम करता है जो .NET पर चलती है।

## पूर्वापेक्षाएँ

- **OneUptime खाते के लिए साइन अप करें** – आप यहाँ [here](https://oneuptime.com) एक निःशुल्क खाते के लिए साइन अप कर सकते हैं। कृपया ध्यान दें कि खाता निःशुल्क होने के बावजूद, लॉग ग्रहण एक भुगतान सुविधा है। आप मूल्य निर्धारण के बारे में अधिक विवरण यहाँ [here](https://oneuptime.com/pricing) पा सकते हैं।
- **OneUptime प्रोजेक्ट बनाएँ** – एक बार जब आपके पास खाता हो, तो OneUptime डैशबोर्ड से एक प्रोजेक्ट बनाएँ। यदि आपको सहायता की आवश्यकता हो, तो हमसे support@oneuptime.com पर संपर्क करें।
- **Telemetry Ingestion Token बनाएँ** – अपने लॉग को प्रमाणित करने के लिए आपको एक टोकन की आवश्यकता होती है।

OneUptime पर साइन अप करने और एक प्रोजेक्ट बनाने के बाद, नेविगेशन बार में "More" पर क्लिक करें और "Project Settings" पर क्लिक करें।

Telemetry Ingestion Key पृष्ठ पर, एक टोकन बनाने के लिए "Create Ingestion Key" पर क्लिक करें।

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

एक बार जब आप एक टोकन बना लें, तो टोकन देखने के लिए "View" पर क्लिक करें।

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## OneUptime से आपको क्या चाहिए

| सेटिंग | मान |
| --- | --- |
| OTLP एंडपॉइंट | `https://oneuptime.com/otlp` |
| Auth हेडर | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |
| सेवा का नाम | वह नाम जिसके अंतर्गत आपकी सेवा दिखाई देनी चाहिए, उदा. `my-service` |

> **OneUptime को स्वयं-होस्ट कर रहे हैं?** `https://oneuptime.com/otlp` को `https://YOUR-ONEUPTIME-HOST/otlp` से बदलें (या `http://...` यदि आप TLS समाप्त नहीं कर रहे हैं)। बाकी सब कुछ वैसा ही रहता है।

sink OTLP **HTTP/protobuf** प्रोटोकॉल का उपयोग करता है और स्वचालित रूप से एंडपॉइंट में `/v1/logs` पथ जोड़ता है, इसलिए यह जिस अंतिम URL पर पोस्ट करता है वह `https://oneuptime.com/otlp/v1/logs` है। आपको केवल आधार `/otlp` एंडपॉइंट प्रदान करना होगा।

## चरण 1 — NuGet पैकेज इंस्टॉल करें

अपने प्रोजेक्ट में Serilog और OpenTelemetry sink जोड़ें:

```bash
dotnet add package Serilog
dotnet add package Serilog.Sinks.OpenTelemetry
```

यदि आप `appsettings.json` से sink को कॉन्फ़िगर कर रहे हैं (नीचे देखें), तो यह भी जोड़ें:

```bash
dotnet add package Serilog.Settings.Configuration
```

ASP.NET Core ऐप्स के लिए, `Serilog.AspNetCore` पैकेज Serilog को होस्ट और request pipeline में जोड़ता है:

```bash
dotnet add package Serilog.AspNetCore
```

## चरण 2 — कोड में sink को कॉन्फ़िगर करें

सबसे सीधा तरीका एप्लिकेशन स्टार्टअप पर Serilog को कॉन्फ़िगर करना है। sink को अपने OneUptime OTLP एंडपॉइंट पर इंगित करें, प्रोटोकॉल को `HttpProtobuf` पर सेट करें, अपने ingestion token को हेडर के रूप में पास करें, और लॉग को `service.name` के साथ टैग करें।

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

> **महत्वपूर्ण:** sink लॉग इवेंट को बैच करता है और उन्हें अतुल्यकालिक रूप से भेजता है। अपने एप्लिकेशन के बाहर निकलने से पहले हमेशा `Log.CloseAndFlush()` को कॉल करें (या logger को dispose करें), अन्यथा लॉग का अंतिम बैच खो सकता है। ASP.NET Core में, `Serilog.AspNetCore` graceful shutdown पर इसे आपके लिए संभाल लेता है।

## चरण 3 — appsettings.json से कॉन्फ़िगर करें (वैकल्पिक)

यदि आप कोड के बजाय कॉन्फ़िगरेशन को प्राथमिकता देते हैं, तो `Serilog.Settings.Configuration` का उपयोग करें और sink सेटिंग्स को `appsettings.json` में रखें:

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

फिर कॉन्फ़िगरेशन से logger बनाएँ:

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

> टोकन को सोर्स कंट्रोल से बाहर रखें। इसे `appsettings.json` में कमिट करने के बजाय किसी environment variable या secrets store से संदर्भित करें और स्टार्टअप पर इसे कॉन्फ़िगरेशन में इंजेक्ट करें।

## ASP.NET Core एकीकरण

ASP.NET Core (.NET 6+ minimal hosting) के लिए, `Serilog.AspNetCore` का उपयोग करें ताकि Serilog डिफ़ॉल्ट logger को बदल दे और framework + request लॉग को भी कैप्चर करे:

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

## लॉग लिखना

एक बार कॉन्फ़िगर हो जाने के बाद, Serilog का उपयोग वैसे ही करें जैसे आप सामान्य रूप से करते हैं। संरचित प्रॉपर्टीज़ संरक्षित रहती हैं और OneUptime में खोजने योग्य एट्रिब्यूट बन जाती हैं:

```csharp
Log.Information("Order {OrderId} placed by {CustomerId} for {Amount:C}",
    orderId, customerId, amount);

Log.Warning("Payment gateway slow: {LatencyMs}ms", latencyMs);
```

प्रत्येक नामित प्रॉपर्टी (`OrderId`, `CustomerId`, `Amount`, `LatencyMs`) को एक लॉग एट्रिब्यूट के रूप में भेजा जाता है, इसलिए आप **Telemetry → Logs** explorer में उन पर फ़िल्टर और खोज कर सकते हैं।

## अपवाद (Exceptions)

जब आप Serilog के साथ कोई अपवाद लॉग करते हैं, तो sink लॉग रिकॉर्ड में OpenTelemetry `exception.type`, `exception.message`, और `exception.stacktrace` एट्रिब्यूट संलग्न करता है:

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

OneUptime इन एट्रिब्यूट का पता लगाता है और त्रुटि को स्वचालित रूप से **Exceptions** (Issues) दृश्य में रोल कर देता है, जो fingerprint द्वारा समूहित और सही सेवा को आरोपित होता है। trace और log दोनों द्वारा रिपोर्ट की गई त्रुटि एक ही issue में संक्षिप्त हो जाती है। पता लगाना कैसे काम करता है, इस पर विवरण के लिए [Exceptions from logs](/docs/telemetry/open-telemetry) देखें।

## Trace सहसंबंध

यदि आपका एप्लिकेशन traces के लिए OpenTelemetry .NET SDK के साथ भी इंस्ट्रूमेंट किया गया है, तो किसी सक्रिय span के अंदर उत्सर्जित Serilog लॉग इवेंट स्वचालित रूप से वर्तमान `TraceId` और `SpanId` के साथ अंकित किए जाते हैं (यह sink के डिफ़ॉल्ट `IncludedData` का हिस्सा है)। यह OneUptime को एक लॉग लाइन को सीधे उस trace से जोड़ने देता है जिसमें यह घटित हुई, ताकि आप किसी लॉग से आसपास के request तक और वापस कूद सकें।

## सत्यापित करें

1. अपना एप्लिकेशन चलाएँ और कुछ लॉग इवेंट उत्पन्न करें।
2. OneUptime खोलें, **Telemetry** पर जाएँ, अपनी सेवा (`my-service`) चुनें, और **Logs** खोलें।
3. आपको अपने Serilog इवेंट कुछ ही सेकंड के भीतर दिखाई देने चाहिए, जिनकी संरचित प्रॉपर्टीज़ फ़िल्टर के रूप में उपलब्ध हों।

## समस्या निवारण

- **कोई लॉग दिखाई नहीं देता** – `x-oneuptime-token` मान को दोबारा जाँचें और पुष्टि करें कि यह उसी प्रोजेक्ट से संबंधित है जिसे आप देख रहे हैं। सत्यापित करें कि एंडपॉइंट `https://oneuptime.com/otlp` है (केवल आधार पथ — `/v1/logs` को स्वयं न जोड़ें)।
- **लॉग केवल तब दिखाई देते हैं जब ऐप बाहर निकलता है, या अंतिम लॉग गायब हैं** – सुनिश्चित करें कि shutdown पर `Log.CloseAndFlush()` चलता है। sink इवेंट को बैच करता है, इसलिए यदि प्रक्रिया को फ़्लश किए बिना समाप्त कर दिया जाता है तो बफ़र किए गए लॉग खो जाते हैं।
- **`401 Unauthorized` / कुछ भी ग्रहण नहीं हुआ** – टोकन गायब है या अमान्य है। पुष्टि करें कि हेडर कुंजी ठीक `x-oneuptime-token` है।
- **गलत सेवा नाम** – `ResourceAttributes` (कोड) या `resourceAttributes` (appsettings.json) में `service.name` सेट करें। इसके बिना, लॉग एक डिफ़ॉल्ट/अज्ञात सेवा पर वापस आ जाते हैं।
- **स्वयं-होस्ट किए गए instance में कनेक्शन त्रुटियाँ** – सुनिश्चित करें कि प्रोटोकॉल आपके एंडपॉइंट स्कीम (`https://` बनाम `http://`) से मेल खाता है और आपका OneUptime होस्ट एप्लिकेशन से पहुँच योग्य है।

यदि आपके कोई प्रश्न हैं या सहायता की आवश्यकता है, तो कृपया हमसे support@oneuptime.com पर संपर्क करें।
