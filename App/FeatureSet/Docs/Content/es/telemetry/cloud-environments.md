# Entornos en la nube

## Resumen

OneUptime agrupa el cómputo gestionado en la nube en **Entornos en la nube** — AWS ECS / Fargate, Google Cloud Run, Azure Container Apps / Container Instances, AWS Elastic Beanstalk, AWS App Runner y Azure App Service. Se crea un entorno por cada combinación única de `cloud.platform` + `cloud.account.id` + `cloud.region`, de modo que algo como _"AWS ECS · us-east-1 · 123456789012"_ es una única entidad que agrega cada carga de trabajo que se ejecuta en ella.

Las máquinas virtuales puras (EC2, Compute Engine, Azure VM) siguen siendo **Hosts**, y Kubernetes permanece bajo **Kubernetes**. Esta vista es específicamente para cómputo gestionado / PaaS.

## Requisitos previos

- Un **Token de ingesta de telemetría de OneUptime** — crea uno desde _Configuración del proyecto → Claves de ingesta de telemetría_.
- Un OpenTelemetry Collector o SDK ejecutándose dentro de tus cargas de trabajo o junto a ellas.

## Cómo identifica OneUptime un entorno

| Atributo              | Obligatorio | Propósito                                                                                                 |
| --------------------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| `cloud.platform`      | **sí**      | Debe ser una plataforma de cómputo gestionado (p. ej. `aws_ecs`, `gcp_cloud_run`, `azure_container_apps`) |
| `cloud.account.id`    | no          | Parte de la clave del entorno                                                                             |
| `cloud.region`        | no          | Parte de la clave del entorno                                                                             |
| `service.instance.id` | no          | Se rastrea por tarea/instancia bajo **Instancias** (con CPU / memoria en vivo)                            |

Estos suelen rellenarse automáticamente mediante los **detectores de recursos** de OpenTelemetry.

## Paso 1 — Habilita el detector de recursos en la nube

En el OpenTelemetry Collector, añade el procesador `resourcedetection`:

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs] # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

Con un SDK, define `OTEL_RESOURCE_DETECTORS` en su lugar:

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## Paso 2 — Exporta OTLP a OneUptime

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

Si alojas OneUptime por tu cuenta, usa `https://YOUR-ONEUPTIME-HOST/otlp`.

## Qué obtienes

El resumen del entorno muestra:

- **CPU** y **Memoria** por tarea/instancia en ejecución (a partir de `container.cpu.utilization` / `container.memory.usage`), además de una lista de **Instancias principales por CPU**.
- **Instancias** — un recuento en vivo de las tareas.
- **Solicitudes** y gráficos de tendencia derivados de tus trazas.
- Pestañas completas de **Logs**, **Trazas**, **Métricas** e **Instancias**.

El desglose por servicio para las mismas cargas de trabajo está disponible bajo **Servicios**.
