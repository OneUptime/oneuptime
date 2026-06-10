# Serverlösa funktioner

## Översikt

OneUptime känner automatiskt igen en **serverlös funktion** i samma ögonblick som den tar emot OpenTelemetry-data märkt med resursattributet `faas.name`. Det finns ingenting att skapa för hand — instrumentera din funktion med OpenTelemetry SDK för din runtime, peka dess OTLP-exportör mot OneUptime, så dyker funktionen upp under **Serverless Functions** med sina spårningar, loggar och mätvärden.

Detta fungerar för AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers eller vilken FaaS-runtime som helst som kan sända OpenTelemetry.

## Förutsättningar

- En **OneUptime Telemetry Ingestion Token** — skapa en från *Project Settings → Telemetry Ingestion Keys* och kopiera värdet för `x-oneuptime-token`.
- OpenTelemetry SDK (eller ett lager för automatisk instrumentering) för din funktions språk.

## Hur OneUptime identifierar en funktion

OneUptime nycklar varje funktion på resursattributet `faas.name`:

| Attribut | Obligatoriskt | Syfte |
|---|---|---|
| `faas.name` | **ja** | Funktionsidentitet (t.ex. `checkout-handler`) |
| `faas.version` | nej | Visas i översikten |
| `faas.instance` | nej | Spåras per instans under fliken **Instances** |
| `cloud.platform` | nej | `aws_lambda`, `gcp_cloud_functions`, `azure_functions`, ... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | nej | Visas i översikten |

> En funktion som även sätter `service.name` visas fortfarande under **Services** också. Vyn **Serverless Functions** är den FaaS-fokuserade linsen, avgränsad av `faas.name`.

## Steg 1 — Ställ in miljövariablerna för OTLP-exportören

De flesta automatiska instrumenteringar per språk respekterar standardmiljövariablerna för OpenTelemetry:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

Om du själv är värd för OneUptime, ersätt slutpunkten med `https://YOUR-ONEUPTIME-HOST/otlp`.

## Steg 2 — (AWS Lambda) lägg till OpenTelemetry-lagret

För AWS Lambda är den enklaste vägen [OpenTelemetry Lambda-lagret](https://opentelemetry.io/docs/faas/lambda-auto/). Koppla lagret för din runtime och ställ in:

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

Lagret sätter `faas.name` från funktionsnamnet automatiskt, och resursdetektorn fyller i `cloud.platform`, `cloud.region` och `cloud.account.id`.

## Vad du får

När funktionen sänder en span, logg eller ett mätvärde visas den under **Serverless Functions**. Översikten visar:

- **Invocations**, **error rate** och **p95 duration** — härledda från dina spårningar, över ett valbart tidsintervall, med trenddiagram.
- **Instances** — en liveräkning av de `faas.instance`-värden som setts.
- Fullständiga flikar för **Logs**, **Traces** och **Metrics** avgränsade till denna funktion.

Du kan även automatiskt tillämpa etiketter och ägare via *Serverless → Settings → Label Rules / Owner Rules*.
