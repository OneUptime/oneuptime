# Serverless Functions

## Overzicht

OneUptime herkent automatisch een **Serverless Function** zodra het OpenTelemetry-data ontvangt die is voorzien van de resource-attribuut `faas.name`. Er hoeft niets handmatig te worden aangemaakt — instrumenteer je functie met de OpenTelemetry SDK voor je runtime, richt de OTLP-exporter op OneUptime, en de functie verschijnt onder **Serverless Functions** met zijn traces, logs en metrics.

Dit werkt voor AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers of elke andere FaaS-runtime die OpenTelemetry kan uitzenden.

## Vereisten

- Een **OneUptime Telemetry Ingestion Token** — maak er een aan via *Project Settings → Telemetry Ingestion Keys* en kopieer de waarde van `x-oneuptime-token`.
- De OpenTelemetry SDK (of een auto-instrumentatielaag) voor de taal van je functie.

## Hoe OneUptime een functie identificeert

OneUptime indexeert elke functie op basis van de resource-attribuut `faas.name`:

| Attribuut | Vereist | Doel |
|---|---|---|
| `faas.name` | **ja** | Functie-identiteit (bijv. `checkout-handler`) |
| `faas.version` | nee | Wordt weergegeven in het overzicht |
| `faas.instance` | nee | Per instance bijgehouden onder het tabblad **Instances** |
| `cloud.platform` | nee | `aws_lambda`, `gcp_cloud_functions`, `azure_functions`, ... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | nee | Wordt weergegeven in het overzicht |

> Een functie die ook `service.name` instelt, verschijnt nog steeds ook onder **Services**. De weergave **Serverless Functions** is de FaaS-gerichte lens, afgebakend door `faas.name`.

## Stap 1 — Stel de omgevingsvariabelen voor de OTLP-exporter in

De meeste auto-instrumentaties per taal respecteren de standaard OpenTelemetry-omgevingsvariabelen:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

Als je OneUptime zelf host, vervang dan het endpoint door `https://YOUR-ONEUPTIME-HOST/otlp`.

## Stap 2 — (AWS Lambda) voeg de OpenTelemetry-laag toe

Voor AWS Lambda is de eenvoudigste route de [OpenTelemetry Lambda-laag](https://opentelemetry.io/docs/faas/lambda-auto/). Koppel de laag voor je runtime en stel in:

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

De laag stelt `faas.name` automatisch in op basis van de functienaam, en de resource-detector vult `cloud.platform`, `cloud.region` en `cloud.account.id` in.

## Wat je krijgt

Zodra de functie een span, log of metric uitzendt, verschijnt deze onder **Serverless Functions**. Het overzicht toont:

- **Invocations**, **error rate** en **p95 duration** — afgeleid van je traces, over een selecteerbaar tijdsbereik, met trendgrafieken.
- **Instances** — een live telling van de waargenomen `faas.instance`-waarden.
- Volledige tabbladen **Logs**, **Traces** en **Metrics** afgebakend tot deze functie.

Je kunt ook automatisch labels en eigenaren toepassen via *Serverless → Settings → Label Rules / Owner Rules*.
