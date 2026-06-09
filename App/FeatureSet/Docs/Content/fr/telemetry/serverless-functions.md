# Fonctions serverless

## Vue d'ensemble

OneUptime reconnaît automatiquement une **fonction serverless** dès qu'il reçoit des données OpenTelemetry étiquetées avec l'attribut de ressource `faas.name`. Il n'y a rien à créer manuellement — instrumentez votre fonction avec le SDK OpenTelemetry correspondant à votre runtime, pointez son exportateur OTLP vers OneUptime, et la fonction apparaît sous **Fonctions serverless** avec ses traces, journaux et métriques.

Cela fonctionne pour AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers, ou tout runtime FaaS capable d'émettre des données OpenTelemetry.

## Prérequis

- Un **jeton d'ingestion de télémétrie OneUptime** — créez-en un depuis *Project Settings → Telemetry Ingestion Keys* et copiez la valeur `x-oneuptime-token`.
- Le SDK OpenTelemetry (ou une couche d'auto-instrumentation) pour le langage de votre fonction.

## Comment OneUptime identifie une fonction

OneUptime indexe chaque fonction sur l'attribut de ressource `faas.name` :

| Attribut | Requis | Objectif |
|---|---|---|
| `faas.name` | **oui** | Identité de la fonction (par ex. `checkout-handler`) |
| `faas.version` | non | Affiché dans la vue d'ensemble |
| `faas.instance` | non | Suivi par instance sous l'onglet **Instances** |
| `cloud.platform` | non | `aws_lambda`, `gcp_cloud_functions`, `azure_functions`, ... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | non | Affiché dans la vue d'ensemble |

> Une fonction qui définit également `service.name` apparaît toujours aussi sous **Services**. La vue **Fonctions serverless** est le prisme axé sur le FaaS, délimité par `faas.name`.

## Étape 1 — Définir les variables d'environnement de l'exportateur OTLP

La plupart des auto-instrumentations de langage respectent les variables d'environnement OpenTelemetry standard :

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

Si vous hébergez OneUptime vous-même, remplacez le endpoint par `https://YOUR-ONEUPTIME-HOST/otlp`.

## Étape 2 — (AWS Lambda) ajouter la couche OpenTelemetry

Pour AWS Lambda, le chemin le plus simple est la [couche Lambda OpenTelemetry](https://opentelemetry.io/docs/faas/lambda-auto/). Attachez la couche correspondant à votre runtime et définissez :

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

La couche définit `faas.name` automatiquement à partir du nom de la fonction, et le détecteur de ressources renseigne `cloud.platform`, `cloud.region` et `cloud.account.id`.

## Ce que vous obtenez

Dès que la fonction émet une span, un journal ou une métrique, elle apparaît sous **Fonctions serverless**. La vue d'ensemble affiche :

- **Invocations**, **taux d'erreur** et **durée p95** — dérivés de vos traces, sur une plage de temps sélectionnable, avec des graphiques de tendance.
- **Instances** — un décompte en temps réel des valeurs `faas.instance` observées.
- Des onglets complets **Logs**, **Traces** et **Metrics** délimités à cette fonction.

Vous pouvez également appliquer automatiquement des libellés et des propriétaires via *Serverless → Settings → Label Rules / Owner Rules*.
