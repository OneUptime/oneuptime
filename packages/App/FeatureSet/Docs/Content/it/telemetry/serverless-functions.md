# Funzioni Serverless

## Panoramica

OneUptime riconosce automaticamente una **Funzione serverless** nel momento in cui riceve dati OpenTelemetry contrassegnati con l'attributo di risorsa `faas.name`. Non c'è nulla da creare manualmente — strumenta la tua funzione con l'SDK OpenTelemetry per il tuo runtime, punta il suo exporter OTLP verso OneUptime e la funzione comparirà sotto **Funzioni serverless** con le sue tracce, i log e le metriche.

Funziona con AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers o qualsiasi runtime FaaS in grado di emettere OpenTelemetry.

## Prerequisiti

- Un **OneUptime Telemetry Ingestion Token** — creane uno da _Impostazioni del progetto → Telemetria e APM → Chiavi di acquisizione_ e copia il valore `x-oneuptime-token`.
- L'SDK OpenTelemetry (o un layer di auto-strumentazione) per il linguaggio della tua funzione.

## Come OneUptime identifica una funzione

OneUptime indicizza ogni funzione sull'attributo di risorsa `faas.name`:

| Attributo                                              | Obbligatorio | Scopo                                                       |
| ------------------------------------------------------ | ------------ | ----------------------------------------------------------- |
| `faas.name`                                            | **sì**       | Identità della funzione (es. `checkout-handler`)            |
| `faas.version`                                         | no           | Mostrato nella panoramica                                   |
| `faas.instance`                                        | no           | Tracciato per-istanza sotto la scheda **Istanze**           |
| `cloud.platform`                                       | no           | `aws_lambda`, `gcp_cloud_functions`, `azure_functions`, ... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | no           | Mostrato nella panoramica                                   |

> Una funzione che imposta anche `service.name` compare comunque anche sotto **Servizi**. La vista **Funzioni serverless** è la lente focalizzata su FaaS, delimitata da `faas.name`.

## Passo 1 — Imposta le variabili d'ambiente dell'exporter OTLP

La maggior parte delle auto-strumentazioni dei linguaggi rispetta le variabili d'ambiente standard di OpenTelemetry:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

Se ospiti OneUptime in self-hosting, sostituisci l'endpoint con `https://YOUR-ONEUPTIME-HOST/otlp`.

## Passo 2 — (AWS Lambda) aggiungi il layer OpenTelemetry

Per AWS Lambda il percorso più semplice è il [layer Lambda di OpenTelemetry](https://opentelemetry.io/docs/faas/lambda-auto/). Collega il layer per il tuo runtime e imposta:

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

Il layer imposta automaticamente `faas.name` dal nome della funzione e il resource detector compila `cloud.platform`, `cloud.region` e `cloud.account.id`.

## Cosa ottieni

Una volta che la funzione emette una span, un log o una metrica, compare sotto **Funzioni serverless**. La panoramica mostra:

- **Invocazioni**, **error rate** e **durata p95** — derivati dalle tue tracce, su un intervallo di tempo selezionabile, con grafici di tendenza.
- **Istanze** — un conteggio in tempo reale dei valori `faas.instance` osservati.
- Schede complete **Registri**, **Tracce** e **Metriche** delimitate a questa funzione.

Puoi anche applicare automaticamente etichette e proprietari tramite _Serverless → Impostazioni → Regole etichette / Regole del proprietario_.
