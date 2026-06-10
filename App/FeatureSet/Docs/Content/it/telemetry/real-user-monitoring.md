# Real User Monitoring (Browser e Mobile)

## Panoramica

OneUptime classifica i dati di telemetria in ingresso come **RUM** quando questi contengono attributi client — `browser.*` per il web o `device.*` per il mobile. Ogni applicazione è identificata dal proprio `service.name` ed è di proprietà esclusiva della sua applicazione RUM (la telemetria client non viene mai duplicata come Service di backend).

Usalo per vedere ciò che i tuoi utenti sperimentano realmente: visualizzazioni di pagina, errori, latenza, le piattaforme / i dispositivi in uso e — quando il tuo SDK li emette — i Core Web Vitals.

## Prerequisiti

- Un **Token di Ingestione Telemetria di OneUptime** — creane uno da *Impostazioni Progetto → Chiavi di Ingestione Telemetria*.
- L'SDK OpenTelemetry per browser o mobile.

## Come OneUptime identifica un'applicazione RUM

| Attributo | Obbligatorio | Scopo |
|---|---|---|
| `service.name` | **sì** | Identità dell'applicazione (es. `storefront-web`) |
| `browser.*` | per il web | Contrassegna la telemetria come RUM browser |
| `device.*` | per il mobile | Contrassegna la telemetria come RUM mobile |
| `telemetry.sdk.language` | no | es. `webjs`, `swift`, mostrato nella panoramica |

## Browser (OpenTelemetry Web)

Punta l'exporter OTLP/HTTP verso OneUptime e imposta `service.name` con il nome della tua applicazione:

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

La strumentazione del browser aggiunge automaticamente gli attributi di risorsa `browser.*` — ed è questo che instrada i dati verso il RUM.

## Mobile (Swift / Android)

Usa l'SDK OpenTelemetry Swift o Android, imposta `service.name` ed esporta OTLP verso OneUptime:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

Gli attributi `device.*` dell'SDK instradano la telemetria verso il RUM. Se utilizzi OneUptime in modalità self-hosted, usa `https://YOUR-ONEUPTIME-HOST/otlp`.

## Core Web Vitals

Se la strumentazione del tuo browser emette i web vitals (LCP, INP, CLS, FCP, TTFB) come metriche OpenTelemetry, OneUptime li mostra nella panoramica dell'applicazione con valutazioni buono / da migliorare / scarso. Se non viene segnalata alcuna metrica web-vital, il pannello spiega come iniziare a inviarle.

## Cosa ottieni

- **Visualizzazioni di pagina**, **tasso di errore** e **durata p95** con grafici di tendenza su un intervallo selezionabile.
- **Client** — le piattaforme browser / i modelli di dispositivo rilevati.
- **Core Web Vitals** (quando segnalati).
- Tab completi **Logs**, **Traces** e **Metrics** circoscritti all'applicazione.
