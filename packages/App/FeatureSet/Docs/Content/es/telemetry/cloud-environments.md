# Entornos en la nube

Un **Entorno en la nube** es el lugar donde se ejecutan sus contenedores en una plataforma en la nube gestionada: la cuenta y la región de un clúster de ECS, el proyecto y la región de Cloud Run, la suscripción y la región de Container Apps. OneUptime lo crea la primera vez que su telemetría llega con los atributos de recurso adecuados, y agrupa cada carga de trabajo que se ejecuta allí. No hay nada que registrar a mano.

:::cards
- [AWS ECS / Fargate](/docs/telemetry/cloud-aws-ecs): Tareas en Fargate o EC2, con la CPU y la memoria de cada tarea.
- [Google Cloud Run](/docs/telemetry/cloud-gcp-cloud-run): Servicios y trabajos, también listados como funciones serverless.
- [Azure Container Apps](/docs/telemetry/cloud-azure-container-apps): Réplicas, con la región y la suscripción definidas a mano.
- [Otras plataformas en la nube](/docs/telemetry/cloud-other-platforms): Elastic Beanstalk, App Runner, App Engine, App Service y Container Instances.
:::

## Cómo funciona

```mermaid title="Cómo la telemetría se convierte en un entorno en la nube"
flowchart TB
    subgraph workload["Su carga de trabajo"]
        direction LR
        app["App con un<br/>SDK de OpenTelemetry"]
        sidecar["Colector sidecar<br/>(opcional)"]
    end
    app -->|"OTLP"| sidecar
    app -->|"OTLP + token"| ingest["OneUptime"]
    sidecar -->|"OTLP + token"| ingest
    ingest -->|"cloud.platform<br/>gestionada"| env["Entorno en la nube<br/>plataforma, región<br/>y cuenta"]
    ingest -->|"service.name"| svc["Servicios"]
    env --> inst["Instancias<br/>una fila por tarea"]
```

- **Un detector de recursos indica dónde se ejecuta la carga de trabajo.** Un detector de recursos de OpenTelemetry, en el SDK o en un colector, lee los metadatos de la plataforma y pone `cloud.platform`, `cloud.account.id` y `cloud.region` en todo lo que envía la carga de trabajo. Donde no existe un detector, los define usted.
- **El entorno lo agrupa todo.** Cada carga de trabajo con la misma plataforma, la misma cuenta y la misma región llega a un mismo entorno. Los servicios conservan sus propias filas en **Servicios**.
- **Cada tarea en ejecución es una instancia.** La pestaña **Instancias** del entorno lista sus tareas, instancias o réplicas en ejecución, con CPU y memoria en vivo cuando la plataforma puede proporcionarlas.

## Antes de empezar

- **Una clave de ingesta.** Cree una clave **Servidor** en **Ajustes del proyecto → Telemetría y APM → Claves de ingesta** y copie su token: consulte [Crear una clave de ingesta](/docs/telemetry/open-telemetry#crear-una-clave-de-ingesta). Es un secreto: cada página de plataforma muestra dónde guardarlo en el almacén de secretos de esa nube.
- **OpenTelemetry en su aplicación.** Un SDK de OpenTelemetry que exporte OTLP, o un OpenTelemetry Collector que se ejecute junto a la aplicación.

## Plataformas compatibles

| Plataforma | `cloud.platform` | `cloud.*` rellenados por | Identidad de instancia | Guía |
| ------------------------- | --------------------------- | ---------------------- | --------------------------------- | ------------------------------------------------------------------ |
| AWS ECS / Fargate | `aws_ecs` | detector de recursos | `aws.ecs.task.arn` | [AWS ECS / Fargate](/docs/telemetry/cloud-aws-ecs) |
| AWS Elastic Beanstalk | `aws_elastic_beanstalk` | detector de recursos | `host.id` | [Otras plataformas en la nube](/docs/telemetry/cloud-other-platforms) |
| AWS App Runner | `aws_app_runner` | a mano | `host.name` | [Otras plataformas en la nube](/docs/telemetry/cloud-other-platforms) |
| Google Cloud Run | `gcp_cloud_run` | detector de recursos | `faas.instance` | [Google Cloud Run](/docs/telemetry/cloud-gcp-cloud-run) |
| Google App Engine | `gcp_app_engine` | detector de recursos | `faas.instance` | [Otras plataformas en la nube](/docs/telemetry/cloud-other-platforms) |
| Azure Container Apps | `azure_container_apps` | detector de recursos | `azure.container_app.instance.id` | [Azure Container Apps](/docs/telemetry/cloud-azure-container-apps) |
| Azure Container Instances | `azure_container_instances` | a mano | `host.name` | [Otras plataformas en la nube](/docs/telemetry/cloud-other-platforms) |
| Azure App Service | `azure_app_service` | detector de recursos | `host.id` | [Otras plataformas en la nube](/docs/telemetry/cloud-other-platforms) |

- **Detector de recursos:** un detector de recursos de OpenTelemetry, en el SDK o en el procesador `resourcedetection` del Collector, define los atributos `cloud.*` por usted.
- **A mano:** no existe ningún detector, así que usted pone los atributos en `OTEL_RESOURCE_ATTRIBUTES`. La página de la plataforma muestra la línea exacta.
- **Los detectores de Azure saben menos.** Los detectores de Container Apps no conocen ni la región ni la suscripción, y los de App Service no conocen la suscripción: defina usted lo que falte.
- **Las grafías de Azure con punto funcionan.** Los detectores de Azure para Node.js y .NET escriben `azure.container_apps` y `azure.app_service`. OneUptime los reescribe a los valores con guion bajo de arriba al recibirlos.

## Cómo identifica OneUptime un entorno

Existe un entorno por cada combinación de tres atributos de recurso:

| Atributo | Obligatorio | Qué es |
| ------------------ | -------- | ------------------------------------------------------------------------------------------- |
| `cloud.platform` | Sí | Uno de los valores de [Plataformas compatibles](#plataformas-compatibles) |
| `cloud.account.id` | No | El ID de cuenta de AWS, el ID de proyecto de Google Cloud o el ID de suscripción de Azure |
| `cloud.region` | No | La región, como `us-east-1`, `us-central1` o `eastus` |

OneUptime une los tres con `|` en la **clave de entorno**, y nombra el entorno según esos mismos valores, como _AWS ECS · us-east-1 · 123456789012_:

```text title="Environment keys"
aws_ecs|123456789012|us-east-1
gcp_cloud_run|my-project|us-central1
azure_container_apps|00000000-0000-0000-0000-000000000000|eastus
```

> [!IMPORTANT]
> Una parte que falta se queda en la clave como un segmento vacío: `aws_ecs||us-east-1`. Por eso, una carga de trabajo que omite `cloud.account.id` llega a un entorno distinto del de una que lo define. Es el motivo habitual de ver dos entornos donde esperaba uno.

### Identidad de instancia

Dentro de un entorno, cada tarea, instancia o réplica en ejecución obtiene una fila en **Instancias**. Su nombre sale del primero de estos atributos de recurso que lleve la telemetría:

1. `aws.ecs.task.id`
2. `aws.ecs.task.arn` (acortado al ID de la tarea)
3. `faas.instance`
4. `azure.container_app.instance.id`
5. `service.instance.id`
6. `container.id`
7. `host.id`
8. `host.name`

La identidad propia de la plataforma va primero a propósito. Un colector sidecar y el SDK de la aplicación la ven ambos, y sobrevive a los reinicios. Un SDK suele inventarse un `service.instance.id` nuevo para cada proceso (el SDK de Node.js lo hace por defecto), así que usarlo como clave dividiría una tarea de ECS en dos filas. `service.instance.id` se usa cuando la plataforma no define una identidad propia. La columna **Identidad de instancia** de [Plataformas compatibles](#plataformas-compatibles) indica el atributo que usa una configuración típica en cada plataforma.

### Entornos que crea a mano

Rara vez hace falta: la ingesta crea los entornos por usted. Para crear uno antes de su telemetría, abra **Nube → Todos los entornos** y haga clic en **Crear Recurso en la nube**. Elija la **Plataforma en la nube** y escriba el **ID de cuenta en la nube** y la **Región en la nube** exactamente como los informa su telemetría. OneUptime construye la clave `platform|account|region` a partir de estos tres valores, y la ingesta asocia un entorno solo por su clave. Lo nombra como lo haría la ingesta; para mostrar otro nombre, abra **Más campos** y escríbalo en **Nombre para mostrar**.

## Qué no es un entorno en la nube

| Usted ejecuta en | Dónde aparece | Por qué |
| ------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------- |
| EC2, Compute Engine, Azure VM (`aws_ec2`, `gcp_compute_engine`, `azure_vm`) | **Hosts** | Una máquina virtual es un host. Consulte [Colector OpenTelemetry en el host](/docs/telemetry/host-otel-collector) |
| EKS, GKE, AKS, Kubernetes autogestionado | **Kubernetes** | Se enruta por los atributos `k8s.*`. Consulte [Agente de Kubernetes](/docs/telemetry/kubernetes-agent) |
| Lambda, Cloud Functions, Azure Functions (`aws_lambda`, `gcp_cloud_functions`, `azure_functions`) | **Funciones serverless** | Se enruta por `faas.name`, o por `service.name` en una `cloud.platform` FaaS. Consulte [Funciones serverless](/docs/telemetry/serverless-functions) |
| Balanceadores de carga, buckets, bases de datos gestionadas y otros recursos IaaS o PaaS | **Recursos en la nube** | Se descubren a partir de las métricas que publican Azure Monitor, CloudWatch y Cloud Monitoring. Consulte [Recursos en la nube](/docs/telemetry/cloud-resources) |

> [!NOTE]
> Cloud Run y App Engine aparecen en dos lugares a propósito. Su detector define tanto una `cloud.platform` gestionada como `faas.name`, así que cada servicio es también una **Función serverless** propia, mientras que el **Entorno en la nube** agrupa cada servicio de ese proyecto y esa región. La misma telemetría se archiva en ambos.

## Conectar una carga de trabajo

Cada página de plataforma recoge estos pasos con los comandos y las pantallas de consola propios de esa nube. En resumen:

:::steps
### Poner los atributos de la nube en su telemetría

:::tabs
@tab Sidecar collector
Un segundo contenedor en la tarea, la instancia o la réplica. La aplicación exporta a `localhost:4318`, y el procesador `resourcedetection` del colector pone `cloud.*` en todo lo que pasa por él. El colector guarda el token y, en ECS, envía además la CPU y la memoria de cada tarea:

```yaml title="collector.yaml"
processors:
  resourcedetection:
    detectors: [env, ecs] # [env, gcp] on Cloud Run and App Engine; [env, azurecontainerapps] on Container Apps
    timeout: 5s
```
@tab SDK direct
El SDK de la aplicación exporta directamente a OneUptime. Active en el SDK el detector de recursos de la plataforma, como `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws` en Node.js: cada página de plataforma indica el ajuste para cada lenguaje. No hay contenedor adicional, ni CPU ni memoria de contenedor.
:::

### Exportar OTLP a OneUptime

:::tabs
@tab Sidecar collector
```yaml title="collector.yaml"
exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: ${env:ONEUPTIME_TOKEN}

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
    metrics:
      receivers: [otlp]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers: [otlp]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
```

El colector resuelve `${env:ONEUPTIME_TOKEN}` a partir de una variable de entorno que la plataforma rellena desde su almacén de secretos: Secrets Manager, Secret Manager o los secretos de Container Apps.
@tab SDK direct
```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```
:::

Si aloja OneUptime usted mismo, use `https://YOUR-ONEUPTIME-HOST/otlp`.

### Comprobar la conexión

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` con `"valid": true` significa que el token se acepta. `401` significa que es desconocido, revocado, desactivado o caducado, y el `message` de la respuesta dice cuál. Al minuto del primer span, registro o métrica, el entorno aparece en **Nube → Todos los entornos**.
:::

> [!TIP]
> Los mismos pasos están en el panel, con su token ya incluido: en **Nube → Todos los entornos** hasta que llegue su primer entorno, y en la pestaña **Documentación** de cada entorno.

## Qué obtiene

La **Vista general** de un entorno muestra:

- **Solicitudes**, **Tasa de errores** y **latencia p95**, de sus trazas, con gráficos de solicitudes, errores y memoria en el intervalo de tiempo que elija.
- **CPU** y **Memoria** de las instancias activas, y una lista **Principales instancias por CPU**. Proceden de métricas `container.cpu.utilization` y `container.memory.usage` que llevan la identidad de la instancia; en ECS, de `ecs.task.cpu.utilized` y `ecs.task.memory.utilized` del receptor `awsecscontainermetrics`.
- **Instancias**: cuántas han informado en los últimos 15 minutos. La pestaña **Instancias** tiene una fila por cada una.
- Las pestañas **Registros**, **Trazas** y **Métricas**, filtradas al entorno.

Un entorno cuya telemetría se detiene durante 15 minutos muestra **Desconectado**, y el siguiente span, registro o métrica lo devuelve a **Conectado**. El tiempo en que el propio OneUptime estuvo caído o poniéndose al día no cuenta para esos 15 minutos.

### Etiquetas y propietarios

- **Desde su telemetría:** un atributo de recurso como `oneuptime.label.team=payments` añade la etiqueta `team:payments` al entorno.
- **Desde reglas:** **Nube → Ajustes → Reglas de etiquetas** y **Reglas del propietario** añaden etiquetas y propietarios a los entornos que coinciden. Consulte [Reglas de etiquetas y propietarios](/docs/configuration/label-and-owner-rules).

## Solución de problemas

[Solución de problemas en la nube](/docs/telemetry/cloud-troubleshooting) recorre cada fallo en el orden en que ocurre: un entorno que nunca aparece, que llega a **Hosts** o solo a **Funciones serverless**, que no tiene instancias ni CPU y memoria, que muestra **Desconectado**, que se divide en dos, o que se creó a mano y nunca se asocia.

## Próximos pasos

:::cards
- [AWS ECS / Fargate](/docs/telemetry/cloud-aws-ecs): La configuración más habitual, con una definición de tarea completa.
- [Solución de problemas en la nube](/docs/telemetry/cloud-troubleshooting): Qué comprobar cuando falta un entorno o es incorrecto.
- [Recursos en la nube (IaaS y PaaS)](/docs/telemetry/cloud-resources): Balanceadores de carga, buckets y bases de datos gestionadas, desde la propia supervisión de su nube.
- [Funciones serverless](/docs/telemetry/serverless-functions): Lambda, Cloud Functions y Azure Functions.
:::
