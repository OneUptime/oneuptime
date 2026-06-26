# Environnements cloud

## Vue d'ensemble

OneUptime regroupe les ressources de calcul cloud managées dans des **environnements cloud** — AWS ECS / Fargate, Google Cloud Run, Azure Container Apps / Container Instances, AWS Elastic Beanstalk, AWS App Runner et Azure App Service. Un environnement est créé par combinaison unique de `cloud.platform` + `cloud.account.id` + `cloud.region`, de sorte qu'un élément comme _« AWS ECS · us-east-1 · 123456789012 »_ constitue une entité unique qui agrège chaque charge de travail qui s'y exécute.

Les machines virtuelles brutes (EC2, Compute Engine, Azure VM) restent des **hôtes**, et Kubernetes reste sous **Kubernetes**. Cette vue est spécifiquement dédiée au calcul managé / PaaS.

## Prérequis

- Un **jeton d'ingestion de télémétrie OneUptime** — créez-en un depuis _Paramètres du projet → Clés d'ingestion de télémétrie_.
- Un OpenTelemetry Collector ou un SDK s'exécutant dans ou aux côtés de vos charges de travail.

## Comment OneUptime identifie un environnement

| Attribut              | Requis  | Objectif                                                                                               |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `cloud.platform`      | **oui** | Doit être une plateforme de calcul managé (par ex. `aws_ecs`, `gcp_cloud_run`, `azure_container_apps`) |
| `cloud.account.id`    | non     | Fait partie de la clé de l'environnement                                                               |
| `cloud.region`        | non     | Fait partie de la clé de l'environnement                                                               |
| `service.instance.id` | non     | Suivi par tâche/instance sous **Instances** (avec CPU / mémoire en direct)                             |

Ces attributs sont normalement renseignés automatiquement par les **détecteurs de ressources** d'OpenTelemetry.

## Étape 1 — Activer le détecteur de ressources cloud

Dans l'OpenTelemetry Collector, ajoutez le processeur `resourcedetection` :

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs] # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

Avec un SDK, définissez plutôt `OTEL_RESOURCE_DETECTORS` :

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## Étape 2 — Exporter OTLP vers OneUptime

```yaml
exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    metrics:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
```

Si vous hébergez OneUptime vous-même, utilisez `https://YOUR-ONEUPTIME-HOST/otlp`.

## Ce que vous obtenez

La vue d'ensemble de l'environnement affiche :

- **CPU** et **mémoire** par tâche/instance en cours d'exécution (à partir de `container.cpu.utilization` / `container.memory.usage`), ainsi qu'une liste **Top des instances par CPU**.
- **Instances** — un décompte en direct des tâches.
- **Requêtes** et graphiques de tendance dérivés de vos traces.
- Des onglets complets **Logs**, **Traces**, **Métriques** et **Instances**.

La répartition par service pour les mêmes charges de travail est disponible sous **Services**.
