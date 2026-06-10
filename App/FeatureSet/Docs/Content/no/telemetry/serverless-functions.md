# Serverless-funksjoner

## Oversikt

OneUptime gjenkjenner automatisk en **serverless-funksjon** i det øyeblikket den mottar OpenTelemetry-data som er merket med ressursattributtet `faas.name`. Det er ingenting å opprette manuelt — instrumenter funksjonen din med OpenTelemetry SDK-en for din kjøretid, pek OTLP-eksportøren mot OneUptime, og funksjonen dukker opp under **Serverless Functions** med sine spor, logger og metrikker.

Dette fungerer for AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers, eller en hvilken som helst FaaS-kjøretid som kan sende ut OpenTelemetry.

## Forutsetninger

- Et **OneUptime Telemetry Ingestion Token** — opprett ett fra *Project Settings → Telemetry Ingestion Keys* og kopier `x-oneuptime-token`-verdien.
- OpenTelemetry SDK-en (eller et lag for auto-instrumentering) for funksjonens språk.

## Hvordan OneUptime identifiserer en funksjon

OneUptime nøkler hver funksjon på ressursattributtet `faas.name`:

| Attributt | Påkrevd | Formål |
|---|---|---|
| `faas.name` | **ja** | Funksjonsidentitet (f.eks. `checkout-handler`) |
| `faas.version` | nei | Vises i oversikten |
| `faas.instance` | nei | Spores per instans under fanen **Instances** |
| `cloud.platform` | nei | `aws_lambda`, `gcp_cloud_functions`, `azure_functions`, ... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | nei | Vises i oversikten |

> En funksjon som også setter `service.name`, vises fortsatt under **Services** i tillegg. Visningen **Serverless Functions** er det FaaS-fokuserte perspektivet, avgrenset etter `faas.name`.

## Trinn 1 — Sett miljøvariablene for OTLP-eksportøren

De fleste auto-instrumenteringer for språk respekterer de standardiserte OpenTelemetry-miljøvariablene:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

Hvis du er selvvert for OneUptime, erstatt endepunktet med `https://YOUR-ONEUPTIME-HOST/otlp`.

## Trinn 2 — (AWS Lambda) legg til OpenTelemetry-laget

For AWS Lambda er den enkleste veien [OpenTelemetry Lambda-laget](https://opentelemetry.io/docs/faas/lambda-auto/). Fest laget for din kjøretid og sett:

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

Laget setter `faas.name` automatisk fra funksjonsnavnet, og ressursdetektoren fyller inn `cloud.platform`, `cloud.region` og `cloud.account.id`.

## Hva du får

Når funksjonen sender ut et spor, en logg eller en metrikk, dukker den opp under **Serverless Functions**. Oversikten viser:

- **Invocations**, **error rate** og **p95 duration** — utledet fra sporene dine, over et valgbart tidsrom, med trenddiagrammer.
- **Instances** — en sanntidstelling av `faas.instance`-verdiene som er sett.
- Fullstendige faner for **Logs**, **Traces** og **Metrics** avgrenset til denne funksjonen.

Du kan også automatisk bruke etiketter og eiere via *Serverless → Settings → Label Rules / Owner Rules*.
