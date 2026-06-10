# Serverless-funktioner

## Oversigt

OneUptime genkender automatisk en **Serverless-funktion** i det øjeblik, den modtager OpenTelemetry-data, der er mærket med ressourceattributten `faas.name`. Der er ikke noget at oprette manuelt — instrumentér din funktion med OpenTelemetry SDK'et for din runtime, peg dens OTLP-eksportør mod OneUptime, og funktionen dukker op under **Serverless Functions** med dens traces, logs og metrics.

Dette virker for AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers eller enhver FaaS-runtime, der kan udsende OpenTelemetry.

## Forudsætninger

- En **OneUptime Telemetry Ingestion Token** — opret en fra *Project Settings → Telemetry Ingestion Keys* og kopiér værdien `x-oneuptime-token`.
- OpenTelemetry SDK'et (eller et auto-instrumenteringslag) for din funktions sprog.

## Hvordan OneUptime identificerer en funktion

OneUptime indekserer hver funktion på ressourceattributten `faas.name`:

| Attribut | Påkrævet | Formål |
|---|---|---|
| `faas.name` | **ja** | Funktionsidentitet (f.eks. `checkout-handler`) |
| `faas.version` | nej | Vises på oversigten |
| `faas.instance` | nej | Spores per instans under fanen **Instances** |
| `cloud.platform` | nej | `aws_lambda`, `gcp_cloud_functions`, `azure_functions`, ... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | nej | Vises på oversigten |

> En funktion, der også sætter `service.name`, vises stadig under **Services**. Visningen **Serverless Functions** er det FaaS-fokuserede perspektiv, afgrænset af `faas.name`.

## Trin 1 — Indstil miljøvariablerne for OTLP-eksportøren

De fleste sprog-auto-instrumenteringer respekterer de standardiserede OpenTelemetry-miljøvariabler:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

Hvis du selv-hoster OneUptime, skal du erstatte endpointet med `https://YOUR-ONEUPTIME-HOST/otlp`.

## Trin 2 — (AWS Lambda) tilføj OpenTelemetry-laget

For AWS Lambda er den enkleste vej [OpenTelemetry Lambda-laget](https://opentelemetry.io/docs/faas/lambda-auto/). Tilknyt laget for din runtime og indstil:

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

Laget sætter `faas.name` ud fra funktionsnavnet automatisk, og ressourcedetektoren udfylder `cloud.platform`, `cloud.region` og `cloud.account.id`.

## Hvad du får

Når funktionen udsender et span, en log eller en metric, dukker den op under **Serverless Functions**. Oversigten viser:

- **Invocations**, **error rate** og **p95 duration** — udledt fra dine traces, over et valgbart tidsinterval, med trend-diagrammer.
- **Instances** — en realtidsoptælling af de `faas.instance`-værdier, der er observeret.
- Fulde faner for **Logs**, **Traces** og **Metrics** afgrænset til denne funktion.

Du kan også automatisk anvende labels og ejere via *Serverless → Settings → Label Rules / Owner Rules*.
