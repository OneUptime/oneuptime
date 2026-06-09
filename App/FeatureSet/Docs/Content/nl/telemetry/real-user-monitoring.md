# Real User Monitoring (Browser en Mobiel)

## Overzicht

OneUptime classificeert binnenkomende telemetrie als **RUM** wanneer deze clientattributen bevat — `browser.*` voor web of `device.*` voor mobiel. Elke applicatie wordt geïdentificeerd door haar `service.name` en is volledig eigendom van haar RUM-applicatie (clienttelemetrie wordt nooit gedupliceerd als een backend-Service).

Gebruik het om te zien wat uw gebruikers daadwerkelijk ervaren: paginaweergaven, fouten, latentie, de gebruikte platforms / apparaten, en — wanneer uw SDK ze uitstuurt — Core Web Vitals.

## Vereisten

- Een **OneUptime Telemetry Ingestion Token** — maak er een aan via *Project Settings → Telemetry Ingestion Keys*.
- De OpenTelemetry browser- of mobiele SDK.

## Hoe OneUptime een RUM-applicatie identificeert

| Attribuut | Vereist | Doel |
|---|---|---|
| `service.name` | **ja** | Applicatie-identiteit (bijv. `storefront-web`) |
| `browser.*` | voor web | Markeert de telemetrie als browser-RUM |
| `device.*` | voor mobiel | Markeert de telemetrie als mobiele RUM |
| `telemetry.sdk.language` | nee | bijv. `webjs`, `swift`, weergegeven op het overzicht |

## Browser (OpenTelemetry Web)

Richt de OTLP/HTTP-exporter op OneUptime en stel `service.name` in op de naam van uw app:

```js
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// OneUptime OTLP/HTTP exporter:
const exporter = new OTLPTraceExporter({
  url: "https://oneuptime.com/otlp/v1/traces",
  headers: { "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN" },
});

// Register `exporter` with your WebTracerProvider, using a resource of:
//   { "service.name": "storefront-web" }
```

De browserinstrumentatie voegt automatisch `browser.*` resourceattributen toe — dat is wat de data naar RUM routeert.

## Mobiel (Swift / Android)

Gebruik de OpenTelemetry Swift- of Android-SDK, stel `service.name` in en exporteer OTLP naar OneUptime:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

De `device.*` attributen van de SDK routeren de telemetrie naar RUM. Als u OneUptime zelf host, gebruik dan `https://YOUR-ONEUPTIME-HOST/otlp`.

## Core Web Vitals

Als uw browserinstrumentatie web vitals (LCP, INP, CLS, FCP, TTFB) uitstuurt als OpenTelemetry-metrics, toont OneUptime ze op het applicatieoverzicht met beoordelingen goed / verbetering nodig / slecht. Als er geen web-vital-metrics worden gerapporteerd, legt het paneel uit hoe u kunt beginnen met het verzenden ervan.

## Wat u krijgt

- **Paginaweergaven**, **foutpercentage** en **p95-duur** met trendgrafieken over een selecteerbaar bereik.
- **Clients** — de geziene browserplatforms / apparaatmodellen.
- **Core Web Vitals** (wanneer gerapporteerd).
- Volledige **Logs**-, **Traces**- en **Metrics**-tabbladen die zijn afgebakend tot de applicatie.
