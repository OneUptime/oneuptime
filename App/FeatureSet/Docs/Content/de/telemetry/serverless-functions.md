# Serverless-Funktionen

## Überblick

OneUptime erkennt eine **Serverless-Funktion** automatisch in dem Moment, in dem es OpenTelemetry-Daten empfängt, die mit dem Ressourcenattribut `faas.name` versehen sind. Es muss nichts manuell erstellt werden — instrumentieren Sie Ihre Funktion mit dem OpenTelemetry SDK für Ihre Laufzeitumgebung, richten Sie deren OTLP-Exporter auf OneUptime aus, und die Funktion erscheint unter **Serverless-Funktionen** mit ihren Traces, Logs und Metriken.

Dies funktioniert für AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers oder jede FaaS-Laufzeitumgebung, die OpenTelemetry ausgeben kann.

## Voraussetzungen

- Ein **OneUptime Telemetry Ingestion Token** — erstellen Sie eines unter *Project Settings → Telemetry Ingestion Keys* und kopieren Sie den Wert von `x-oneuptime-token`.
- Das OpenTelemetry SDK (oder eine Auto-Instrumentierungs-Schicht) für die Sprache Ihrer Funktion.

## Wie OneUptime eine Funktion identifiziert

OneUptime schlüsselt jede Funktion anhand des Ressourcenattributs `faas.name` auf:

| Attribut | Erforderlich | Zweck |
|---|---|---|
| `faas.name` | **ja** | Funktionsidentität (z. B. `checkout-handler`) |
| `faas.version` | nein | Wird im Überblick angezeigt |
| `faas.instance` | nein | Pro Instanz unter dem Tab **Instanzen** erfasst |
| `cloud.platform` | nein | `aws_lambda`, `gcp_cloud_functions`, `azure_functions`, ... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | nein | Wird im Überblick angezeigt |

> Eine Funktion, die zusätzlich `service.name` setzt, erscheint weiterhin auch unter **Services**. Die Ansicht **Serverless-Funktionen** ist die FaaS-fokussierte Perspektive, eingegrenzt durch `faas.name`.

## Schritt 1 — Setzen der Umgebungsvariablen für den OTLP-Exporter

Die meisten Auto-Instrumentierungen für Sprachen berücksichtigen die standardmäßigen OpenTelemetry-Umgebungsvariablen:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

Wenn Sie OneUptime selbst hosten, ersetzen Sie den Endpunkt durch `https://YOUR-ONEUPTIME-HOST/otlp`.

## Schritt 2 — (AWS Lambda) Hinzufügen der OpenTelemetry-Schicht

Für AWS Lambda ist der einfachste Weg die [OpenTelemetry Lambda layer](https://opentelemetry.io/docs/faas/lambda-auto/). Fügen Sie die Schicht für Ihre Laufzeitumgebung hinzu und setzen Sie:

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

Die Schicht setzt `faas.name` automatisch aus dem Funktionsnamen, und der Ressourcendetektor füllt `cloud.platform`, `cloud.region` und `cloud.account.id` aus.

## Was Sie erhalten

Sobald die Funktion einen Span, ein Log oder eine Metrik ausgibt, erscheint sie unter **Serverless-Funktionen**. Der Überblick zeigt:

- **Aufrufe**, **Fehlerrate** und **p95-Dauer** — abgeleitet aus Ihren Traces, über einen wählbaren Zeitraum, mit Trenddiagrammen.
- **Instanzen** — eine Live-Zählung der beobachteten `faas.instance`-Werte.
- Vollständige Tabs **Logs**, **Traces** und **Metriken**, eingegrenzt auf diese Funktion.

Sie können außerdem Labels und Verantwortliche automatisch zuweisen über *Serverless → Settings → Label Rules / Owner Rules*.
