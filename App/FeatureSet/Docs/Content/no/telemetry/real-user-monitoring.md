# Overvaking av faktiske brukere (nettleser og mobil)

## Oversikt

OneUptime klassifiserer innkommende telemetri som **RUM** nar den barer med seg klientattributter — `browser.*` for web eller `device.*` for mobil. Hvert program identifiseres av sitt `service.name` og eies fullt ut av sitt RUM-program (klienttelemetri dupliseres aldri som en backend-tjeneste).

Bruk det til a se hva brukerne dine faktisk opplever: sidevisninger, feil, ventetid, plattformene/enhetene som er i bruk, og — nar SDK-en din sender dem — Core Web Vitals.

## Forutsetninger

- Et **OneUptime Telemetry Ingestion Token** — opprett ett fra *Project Settings → Telemetry Ingestion Keys*.
- OpenTelemetry-SDK-en for nettleser eller mobil.

## Hvordan OneUptime identifiserer et RUM-program

| Attributt | Pakrevd | Formal |
|---|---|---|
| `service.name` | **ja** | Programidentitet (f.eks. `storefront-web`) |
| `browser.*` | for web | Merker telemetrien som nettleser-RUM |
| `device.*` | for mobil | Merker telemetrien som mobil-RUM |
| `telemetry.sdk.language` | nei | f.eks. `webjs`, `swift`, vises i oversikten |

## Nettleser (OpenTelemetry Web)

Pek OTLP/HTTP-eksportoren mot OneUptime og sett `service.name` til navnet pa programmet ditt:

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

Nettleserinstrumenteringen legger til `browser.*`-ressursattributter automatisk — det er det som ruter dataene til RUM.

## Mobil (Swift / Android)

Bruk OpenTelemetry Swift- eller Android-SDK-en, sett `service.name`, og eksporter OTLP til OneUptime:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

SDK-ens `device.*`-attributter ruter telemetrien til RUM. Hvis du selvhoster OneUptime, bruk `https://YOUR-ONEUPTIME-HOST/otlp`.

## Core Web Vitals

Hvis nettleserinstrumenteringen din sender web vitals (LCP, INP, CLS, FCP, TTFB) som OpenTelemetry-metrikker, viser OneUptime dem i programoversikten med vurderingene god / trenger forbedring / darlig. Hvis ingen web-vital-metrikker rapporteres, forklarer panelet hvordan du kommer i gang med a sende dem.

## Hva du far

- **Sidevisninger**, **feilrate** og **p95-varighet** med trenddiagrammer over et valgbart tidsrom.
- **Klienter** — nettleserplattformene/enhetsmodellene som er sett.
- **Core Web Vitals** (nar rapportert).
- Fullstendige faner for **Logs**, **Traces** og **Metrics** avgrenset til programmet.
