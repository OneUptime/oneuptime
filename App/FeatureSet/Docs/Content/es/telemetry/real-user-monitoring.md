# Monitoreo de usuarios reales (navegador y móvil)

## Descripción general

OneUptime clasifica la telemetría entrante como **RUM** cuando incluye atributos de cliente — `browser.*` para web o `device.*` para móvil. Cada aplicación se identifica por su `service.name` y es propiedad por completo de su aplicación RUM (la telemetría de cliente nunca se duplica como un servicio de backend).

Úsalo para ver lo que tus usuarios experimentan realmente: vistas de página, errores, latencia, las plataformas / dispositivos en uso y — cuando tu SDK los emite — los Core Web Vitals.

## Requisitos previos

- Un **token de ingesta de telemetría de OneUptime** — crea uno desde _Configuración del proyecto → Claves de ingesta de telemetría_.
- El SDK de OpenTelemetry para navegador o móvil.

## Cómo identifica OneUptime una aplicación RUM

| Atributo                 | Obligatorio | Propósito                                                     |
| ------------------------ | ----------- | ------------------------------------------------------------- |
| `service.name`           | **sí**      | Identidad de la aplicación (p. ej. `storefront-web`)          |
| `browser.*`              | para web    | Marca la telemetría como RUM de navegador                     |
| `device.*`               | para móvil  | Marca la telemetría como RUM de móvil                         |
| `telemetry.sdk.language` | no          | p. ej. `webjs`, `swift`, se muestra en la descripción general |

## Navegador (OpenTelemetry Web)

Apunta el exportador OTLP/HTTP a OneUptime y establece `service.name` con el nombre de tu aplicación:

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

La instrumentación del navegador añade automáticamente los atributos de recurso `browser.*` — eso es lo que enruta los datos a RUM.

## Móvil (Swift / Android)

Usa el SDK de OpenTelemetry para Swift o Android, establece `service.name` y exporta OTLP a OneUptime:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

Los atributos `device.*` del SDK enrutan la telemetría a RUM. Si alojas OneUptime por tu cuenta, usa `https://YOUR-ONEUPTIME-HOST/otlp`.

## Core Web Vitals

Si la instrumentación de tu navegador emite las web vitals (LCP, INP, CLS, FCP, TTFB) como métricas de OpenTelemetry, OneUptime las muestra en la descripción general de la aplicación con calificaciones de bueno / necesita mejorar / deficiente. Si no se reportan métricas de web vitals, el panel explica cómo empezar a enviarlas.

## Lo que obtienes

- **Vistas de página**, **tasa de errores** y **duración p95** con gráficos de tendencia sobre un rango seleccionable.
- **Clientes** — las plataformas de navegador / modelos de dispositivo detectados.
- **Core Web Vitals** (cuando se reportan).
- Pestañas completas de **Logs**, **Traces** y **Metrics** delimitadas a la aplicación.
