# Azure Container Apps

Envíe las trazas, los registros y las métricas de sus Azure Container Apps a OneUptime. Cada réplica que informa `cloud.platform=azure_container_apps` se une a un **Entorno en la nube** por suscripción de Azure y región, como _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_, con las réplicas en ejecución listadas en **Instancias**.

:::cards
- [Cómo funciona](#cómo-funciona): Qué definen los detectores, y los dos atributos que define usted.
- [Configurarlo](#configurarlo): Guardar el token, configurar la app con la CLI de Azure o el portal, y comprobar.
- [Usar el agente de OpenTelemetry administrado del entorno](#usar-el-agente-de-opentelemetry-administrado-del-entorno): Reenviar cada app del entorno sin sidecar.
- [Solución de problemas](#solución-de-problemas): Exportaciones rechazadas, entornos que faltan e instancias vacías.
:::

## Cómo funciona

```mermaid title="De dónde salen los atributos de una réplica de Container Apps"
flowchart TB
    detector["Detector de Azure:<br/>plataforma y réplica"] --> exporter
    manual["OTEL_RESOURCE_<br/>ATTRIBUTES: región<br/>y suscripción"] --> exporter
    exporter["Su app, o su<br/>colector sidecar"] -->|"OTLP por HTTPS"| ou["OneUptime"]
    ou --> env["Entorno en la nube<br/>suscripción y región"]
    ou --> inst["Instancias<br/>una fila por réplica"]
```

Container Apps tiene detectores de recursos: el detector `azurecontainerapps` del Collector, y los de Node.js (`@opentelemetry/resource-detector-azure`) y .NET (`OpenTelemetry.Resources.Azure`). Leen `CONTAINER_APP_NAME` y `CONTAINER_APP_REPLICA_NAME`, y definen `cloud.provider`, `cloud.platform`, `service.name` y el ID de la réplica. Ninguno conoce la región ni la suscripción, así que usted define `cloud.region` y `cloud.account.id`, en `OTEL_RESOURCE_ATTRIBUTES`.

| Atributo | Valor | Para qué sirve |
| --------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `cloud.provider` | `azure` | Se muestra en la vista general |
| `cloud.platform` | `azure_container_apps` | Archiva la telemetría en **Entornos en la nube** |
| `cloud.region` | la región del entorno, como `eastus`: la define usted | Parte de la clave de entorno |
| `cloud.account.id` | el ID de la suscripción: lo define usted | Parte de la clave de entorno |
| `azure.container_app.instance.id` | el nombre de la réplica, que los detectores toman de `CONTAINER_APP_REPLICA_NAME` | Nombra una réplica en ejecución: una fila cada una en **Instancias** |
| `service.instance.id` | el nombre de la réplica, si lo define usted | Se usa cuando ningún detector definió el ID de la réplica |

- **Las grafías con punto funcionan.** Los detectores de Node.js y .NET escriben la plataforma `azure.container_apps`, con un punto. OneUptime la reescribe a `azure_container_apps` al recibirla, así que ambas grafías llegan al mismo entorno.
- **El nombre de host es el nombre de la réplica.** Un SDK que solo ejecuta el detector `host` informa el nombre de la réplica como `host.name`, y OneUptime nombra la instancia por él cuando no hay nada más específico.

La clave de entorno es `azure_container_apps|<subscription id>|eastus`.

## Antes de empezar

- **Una clave de ingesta.** Cree una clave **Servidor** en **Ajustes del proyecto → Telemetría y APM → Claves de ingesta** y copie su token.
- **La CLI de Azure con la extensión `containerapp`** (`az extension add --name containerapp --upgrade`), con sesión iniciada en la suscripción, o el portal de Azure.
- **Su aplicación instrumentada con un SDK de OpenTelemetry** que exporte OTLP.

## Elegir cómo sale la telemetría de la app

| | SDK direct | Sidecar collector |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------ |
| Contenedor adicional | Ninguno | `otel-collector` en la app, que comparte la CPU y la memoria de la réplica |
| Define los atributos | El SDK y `OTEL_RESOURCE_ATTRIBUTES` en la app | El colector, para todo lo que pasa por él |
| El secreto | `oneuptime-otlp-headers`, el encabezado completo | `oneuptime-token`, solo el token |

Una tercera vía, el agente de OpenTelemetry administrado del entorno, reenvía cada app del entorno sin sidecar: consulte [Usar el agente de OpenTelemetry administrado del entorno](#usar-el-agente-de-opentelemetry-administrado-del-entorno). Cada paso de abajo tiene una pestaña para SDK direct y otra para el colector sidecar; elija una y cada paso la seguirá.

## Configurarlo

:::steps
### Guardar el token como secreto de Container Apps

> [!IMPORTANT]
> El token es un secreto. Guárdelo como secreto de Container Apps y haga referencia a él desde las variables de entorno con `secretref:`. Una vez definido, un secreto no se muestra en `az containerapp show` ni en el portal; una variable de entorno normal, sí.

:::tabs
@tab SDK direct
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-otlp-headers="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

El `OTEL_EXPORTER_OTLP_HEADERS` del SDK espera el encabezado `name=value` completo, así que el secreto lo contiene.
@tab Sidecar collector
```bash
az containerapp secret set \
  --name checkout-api \
  --resource-group my-rg \
  --secrets oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

El colector añade él mismo el nombre del encabezado, así que el secreto contiene solo el token.
:::

En el portal: **Azure portal → Container Apps → your app → Settings → Secrets → + Add**. Escriba la clave, elija el tipo **Container Apps secret**, pegue el valor y haga clic en **Add**.

Si guarda los secretos en Key Vault, haga referencia al secreto en lugar de copiar su valor. La identidad administrada de la app necesita el rol **Key Vault Secrets User** en el almacén:

```bash
az containerapp secret set \
  --name checkout-api --resource-group my-rg \
  --secrets "oneuptime-token=keyvaultref:https://my-vault.vault.azure.net/secrets/oneuptime-token,identityref:system"
```

### Configurar la container app

:::tabs
@tab SDK direct
Defina el exportador, y los atributos que ningún detector conoce, en el contenedor de la aplicación. Sustituya la región y el ID de suscripción por los suyos:

```bash
az containerapp update \
  --name checkout-api \
  --resource-group my-rg \
  --set-env-vars \
    OTEL_SERVICE_NAME=checkout-api \
    OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp \
    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
    OTEL_EXPORTER_OTLP_HEADERS=secretref:oneuptime-otlp-headers \
    "OTEL_RESOURCE_ATTRIBUTES=cloud.provider=azure,cloud.platform=azure_container_apps,cloud.region=eastus,cloud.account.id=00000000-0000-0000-0000-000000000000"
```

Para la identidad de la réplica, active el detector de Azure del SDK: `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure` en Node.js, o `.ConfigureResource(r => r.AddAzureContainerAppsDetector())` con `OpenTelemetry.Resources.Azure` en .NET. Define `azure.container_app.instance.id` a partir de `CONTAINER_APP_REPLICA_NAME`.

Container Apps no puede poner una variable de entorno dentro de otra, así que en los demás lenguajes `service.instance.id` no puede ir en `OTEL_RESOURCE_ATTRIBUTES`. Active el detector de host (su `host.name` es el nombre de la réplica), o defínalo en el código:

```js title="tracing.js"
// Node.js: the file you load with --require before the app starts
const { NodeSDK } = require("@opentelemetry/sdk-node");
const { resourceFromAttributes } = require("@opentelemetry/resources");

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    "service.instance.id": process.env.CONTAINER_APP_REPLICA_NAME,
  }),
});
sdk.start();
```

```python title="tracing.py"
# Python: before the tracer provider is created
import os
from opentelemetry.sdk.resources import Resource

resource = Resource.create({"service.instance.id": os.environ.get("CONTAINER_APP_REPLICA_NAME", "")})
```

Use el detector que use, mantenga `cloud.region` y `cloud.account.id` en `OTEL_RESOURCE_ATTRIBUTES`: ningún detector de Container Apps los define, y la clave de entorno los necesita.

En el portal, en su lugar:

1. Abra **Application → Containers → Edit and deploy**, seleccione su contenedor en la pestaña **Container** y haga clic en **Edit**.
2. En **Environment variables**, añada cada variable de arriba con el origen **Manual entry**, y `OTEL_EXPORTER_OTLP_HEADERS` con el origen **Reference a secret**, apuntando a `oneuptime-otlp-headers`.
3. Haga clic en **Save**.
@tab Sidecar collector
Un sidecar se ejecuta en la misma réplica, así que ve los mismos `CONTAINER_APP_NAME` y `CONTAINER_APP_REPLICA_NAME`. Su detector `azurecontainerapps` los convierte en `cloud.provider`, `cloud.platform`, `service.name` y `azure.container_app.instance.id`, y su detector `env` lee `cloud.region` y `cloud.account.id` de `OTEL_RESOURCE_ATTRIBUTES` en el propio entorno del colector. La aplicación solo exporta a `http://localhost:4318`.

Exporte la definición de la app, añada el colector a `template.containers` y aplíquela:

```bash
az containerapp show --name checkout-api --resource-group my-rg -o yaml > checkout-api.yaml
# edit checkout-api.yaml as below
az containerapp update --name checkout-api --resource-group my-rg --yaml checkout-api.yaml
```

```yaml title="checkout-api.yaml"
properties:
  configuration:
    secrets:
      - name: oneuptime-token
        value: YOUR_TELEMETRY_INGESTION_TOKEN
  template:
    containers:
      - name: app
        image: myregistry.azurecr.io/checkout-api:1.4.2
        env:
          - name: OTEL_SERVICE_NAME
            value: checkout-api
          - name: OTEL_EXPORTER_OTLP_ENDPOINT
            value: http://localhost:4318
          - name: OTEL_EXPORTER_OTLP_PROTOCOL
            value: http/protobuf
        resources:
          cpu: 0.5
          memory: 1Gi
      - name: otel-collector
        image: otel/opentelemetry-collector-contrib:latest
        args:
          - --config=env:OTEL_COLLECTOR_CONFIG
        env:
          - name: ONEUPTIME_TOKEN
            secretRef: oneuptime-token
          # Read by the resourcedetection processor's env detector.
          - name: OTEL_RESOURCE_ATTRIBUTES
            value: cloud.provider=azure,cloud.platform=azure_container_apps,cloud.region=eastus,cloud.account.id=00000000-0000-0000-0000-000000000000
          - name: OTEL_COLLECTOR_CONFIG
            value: |
              receivers:
                otlp:
                  protocols:
                    http:
                      endpoint: 0.0.0.0:4318
                    grpc:
                      endpoint: 0.0.0.0:4317
              processors:
                # env: cloud.region + cloud.account.id from OTEL_RESOURCE_ATTRIBUTES.
                # azurecontainerapps: cloud.provider, cloud.platform, service.name
                # and azure.container_app.instance.id from the CONTAINER_APP_*
                # variables. override: false keeps the service.name the
                # application set instead of the Container App's name.
                resourcedetection:
                  detectors: [env, azurecontainerapps]
                  timeout: 2s
                  override: false
                batch: {}
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
        resources:
          cpu: 0.25
          memory: 0.5Gi
```

`az containerapp show` no exporta los valores de los secretos, así que vuelva a añadir la entrada `secrets` a mano, u omítala si definió el secreto en el primer paso: una actualización conserva los secretos existentes. Container Apps suma la CPU y la memoria de todos los contenedores de una réplica, así que los `resources` del sidecar cuentan contra los de la app.

En el portal, en su lugar:

1. Abra **Application → Containers → Edit and deploy**. En la pestaña **Container**, **+ Add** un contenedor llamado `otel-collector` con la imagen `otel/opentelemetry-collector-contrib:latest` y el **Arguments override** `--config=env:OTEL_COLLECTOR_CONFIG`.
2. Añada sus variables de entorno: `ONEUPTIME_TOKEN` (**Reference a secret**: `oneuptime-token`), `OTEL_RESOURCE_ATTRIBUTES` y `OTEL_COLLECTOR_CONFIG` (**Manual entry**, con los valores de arriba).
3. Haga clic en **Save**.
:::

Si aloja OneUptime usted mismo, use `https://YOUR-ONEUPTIME-HOST/otlp` como endpoint.

### Desplegar la nueva revisión

`az containerapp update` despliega una nueva revisión por sí solo. En el portal, haga clic en **Create**. Si hay varias revisiones activas, mueva el tráfico a la nueva en **Revisions and replicas**.

### Comprobar la conexión

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` con `"valid": true` significa que el token se acepta. `401` significa que es desconocido, revocado, desactivado o caducado. Después lea la salida del colector:

```bash
az containerapp logs show --name checkout-api --resource-group my-rg \
  --container otel-collector --follow
```

Busque `Everything is ready`, y que no haya `401` ni `connection refused`. Al minuto del primer span, registro o métrica, el entorno aparece en **Nube → Todos los entornos** como _Azure Container Apps · eastus · 00000000-0000-0000-0000-000000000000_.
:::

## Usar el agente de OpenTelemetry administrado del entorno

Un entorno de Container Apps puede ejecutar el agente de OpenTelemetry administrado de Azure. Recibe OTLP de cada app del entorno y lo reenvía a un endpoint que usted configura, sin sidecar en cada app. El agente exporta **solo por OTLP/gRPC**, así que no puede usar la ruta HTTP `/otlp`. Apúntelo en su lugar al host de OneUptime en el puerto 443, donde OneUptime sirve OTLP/gRPC sobre TLS:

```bash
az containerapp env telemetry otlp add \
  --name my-aca-env \
  --resource-group my-rg \
  --otlp-name oneuptime \
  --endpoint oneuptime.com:443 \
  --insecure false \
  --headers "x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN" \
  --enable-open-telemetry-traces true \
  --enable-open-telemetry-logs true \
  --enable-open-telemetry-metrics true
```

- **Autoalojado:** use `YOUR-ONEUPTIME-HOST:443`. Un OneUptime autoalojado solo acepta OTLP/gRPC sobre TLS: consulte [OTLP por gRPC](/docs/telemetry/open-telemetry#otlp-sobre-grpc).
- **Las apps siguen definiendo los atributos.** El agente pone sus propios `OTEL_EXPORTER_OTLP_ENDPOINT` y `OTEL_EXPORTER_OTLP_PROTOCOL=grpc` en cada app, así que quite esos dos de la app y mantenga `OTEL_SERVICE_NAME` y `OTEL_RESOURCE_ATTRIBUTES`. El agente reenvía lo que envían las apps, así que `cloud.*` y el ID de la réplica siguen viniendo de cada app.
- **Su `OTEL_RESOURCE_ATTRIBUTES` gana.** El agente también define `OTEL_RESOURCE_ATTRIBUTES`, y un valor definido en la app lo reemplaza: incluya en el suyo el nombre de la container app y el ID de la réplica, o defínalos en el código.

## Red

- **El tráfico de salida está abierto de forma predeterminada.** Una réplica llega a `oneuptime.com:443` sin ninguna configuración, tanto si el ingress del entorno es externo como interno.
- **Las VNet personalizadas son la excepción.** En una VNet con una ruta definida por el usuario que envía `0.0.0.0/0` a un firewall o a una puerta de enlace NAT, o con un grupo de seguridad de red en la subred, permita TCP 443 hacia el host de OneUptime (o el puerto de su propio host) en el firewall o el NSG.
- **Un OneUptime autoalojado dentro de la VNet** debe poder resolverse y alcanzarse desde la subred del entorno.
- **La telemetría no necesita ningún rol de Azure.** Solo las referencias de Key Vault requieren que la identidad administrada de la app tenga **Key Vault Secrets User** en el almacén.

## Qué obtiene

- **Vista general**: solicitudes, tasa de errores y latencia p95 de sus trazas. Container Apps no muestra a un sidecar el uso de recursos de una réplica, así que los mosaicos **CPU** y **Memoria** solo se llenan si usted envía métricas `container.cpu.utilization` y `container.memory.usage` que lleven la identidad de la réplica. La mayoría de los equipos los deja a Azure Monitor.
- **Instancias**: una fila por réplica, nombrada por el `azure.container_app.instance.id` de los detectores, por `service.instance.id` cuando lo define usted, o por `host.name` cuando solo se ejecutó el detector de host.
- **Registros**, **Trazas** y **Métricas**, filtrados al entorno, y la vista por servicio en **Servicios**.

## Solución de problemas

:::details No aparece nada, y el colector registra 401
El secreto contiene un valor incorrecto. `oneuptime-token` debe ser solo el token; `oneuptime-otlp-headers`, el encabezado completo `x-oneuptime-token=...`.
:::

:::details La app está en Servicios, pero no existe ningún entorno
Falta `OTEL_RESOURCE_ATTRIBUTES`, o `cloud.platform` no es exactamente `azure_container_apps`. Vea lo que tiene la app con `az containerapp show ... --query properties.template.containers[].env`.
:::

:::details El entorno existe, pero Instancias está vacío
Ninguno de `service.instance.id`, `azure.container_app.instance.id` o `host.name` está en el recurso. Añada el detector `azurecontainerapps` al colector, active el detector de Azure o de host del SDK, o defina `service.instance.id` en el código.
:::

:::details Dos entornos para una suscripción
Una app define `cloud.region` (o `cloud.account.id`) y otra no, o una escribe la región de otra forma (`eastus` y `East US`). Los valores deben coincidir carácter por carácter.
:::

Todo lo demás está en [Solución de problemas en la nube](/docs/telemetry/cloud-troubleshooting).

## Próximos pasos

:::cards
- [Entornos en la nube](/docs/telemetry/cloud-environments): Cómo se identifican los entornos y las instancias.
- [Otras plataformas en la nube](/docs/telemetry/cloud-other-platforms): Azure App Service y Azure Container Instances.
- [Solución de problemas en la nube](/docs/telemetry/cloud-troubleshooting): Los fallos que comparten todas las plataformas.
- [Recursos en la nube (IaaS y PaaS)](/docs/telemetry/cloud-resources): Cada recurso de su suscripción, desde Azure Monitor.
:::
