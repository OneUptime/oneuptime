# Surveillance des utilisateurs réels (navigateur et mobile)

## Vue d'ensemble

OneUptime classe la télémétrie entrante comme **RUM** lorsqu'elle transporte des attributs client — `browser.*` pour le web ou `device.*` pour le mobile. Chaque application est identifiée par son `service.name` et appartient entièrement à son application RUM (la télémétrie client n'est jamais dupliquée en tant que Service back-end).

Utilisez-la pour voir ce que vos utilisateurs vivent réellement : pages vues, erreurs, latence, plateformes / appareils utilisés et — lorsque votre SDK les émet — les Core Web Vitals.

## Prérequis

- Un **jeton d'ingestion de télémétrie OneUptime** — créez-en un depuis _Paramètres du projet → Clés d'ingestion de télémétrie_.
- Le SDK OpenTelemetry pour navigateur ou mobile.

## Comment OneUptime identifie une application RUM

| Attribut                 | Requis         | Objectif                                                    |
| ------------------------ | -------------- | ----------------------------------------------------------- |
| `service.name`           | **oui**        | Identité de l'application (par exemple `storefront-web`)    |
| `browser.*`              | pour le web    | Marque la télémétrie comme RUM navigateur                   |
| `device.*`               | pour le mobile | Marque la télémétrie comme RUM mobile                       |
| `telemetry.sdk.language` | non            | par exemple `webjs`, `swift`, affiché sur la vue d'ensemble |

## Navigateur (OpenTelemetry Web)

Pointez l'exportateur OTLP/HTTP vers OneUptime et définissez `service.name` sur le nom de votre application :

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

L'instrumentation du navigateur ajoute automatiquement les attributs de ressource `browser.*` — c'est ce qui achemine les données vers le RUM.

## Mobile (Swift / Android)

Utilisez le SDK OpenTelemetry Swift ou Android, définissez `service.name` et exportez OTLP vers OneUptime :

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

Les attributs `device.*` du SDK acheminent la télémétrie vers le RUM. Si vous hébergez OneUptime vous-même, utilisez `https://YOUR-ONEUPTIME-HOST/otlp`.

## Core Web Vitals

Si l'instrumentation de votre navigateur émet des web vitals (LCP, INP, CLS, FCP, TTFB) sous forme de métriques OpenTelemetry, OneUptime les fait apparaître sur la vue d'ensemble de l'application avec des évaluations bon / à améliorer / médiocre. Si aucune métrique de web vital n'est rapportée, le panneau explique comment commencer à les envoyer.

## Ce que vous obtenez

- **Pages vues**, **taux d'erreur** et **durée p95** avec des graphiques de tendance sur une plage sélectionnable.
- **Clients** — les plateformes de navigateur / modèles d'appareils observés.
- **Core Web Vitals** (lorsqu'ils sont rapportés).
- Onglets complets **Logs**, **Traces** et **Métriques** limités à l'application.
