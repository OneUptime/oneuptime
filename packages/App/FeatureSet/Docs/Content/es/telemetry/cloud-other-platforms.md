# Otras plataformas en la nube

Configure las plataformas gestionadas que no tienen página propia: AWS Elastic Beanstalk, AWS App Runner, Google App Engine, Azure App Service y Azure Container Instances. La regla es la de todas las plataformas: la telemetría que lleva una `cloud.platform` gestionada, con `cloud.account.id` y `cloud.region`, se une a un **Entorno en la nube** por plataforma, cuenta y región, y una identidad de instancia da a cada instancia en ejecución una fila en **Instancias**.

:::cards
- [AWS Elastic Beanstalk](#aws-elastic-beanstalk): Un colector en cada instancia, con los detectores de Beanstalk y EC2.
- [AWS App Runner](#aws-app-runner): Los atributos definidos a mano, el token desde Secrets Manager.
- [Google App Engine](#google-app-engine): El detector de GCP, con los ajustes en `app.yaml`.
- [Azure App Service](#azure-app-service): Los detectores de Azure, una referencia de Key Vault y la suscripción a mano.
- [Azure Container Instances](#azure-container-instances): Los atributos definidos a mano, el token como variable segura.
:::

## Qué necesita cada plataforma

Lo que cambia entre estas plataformas es quién define los atributos `cloud.*`, y dónde van los ajustes en la consola de la nube:

```mermaid title="Quién define los atributos de la nube en cada plataforma"
flowchart TB
    question{"¿Conoce algún<br/>detector de recursos<br/>la plataforma?"} -->|"Sí"| detector["Active el detector:<br/>Elastic Beanstalk,<br/>App Engine, App Service"]
    question -->|"No"| manual["Defina usted los<br/>atributos: App Runner,<br/>Container Instances"]
    detector --> account["App Service: añada<br/>usted<br/>cloud.account.id"]
```

| Plataforma | `cloud.platform` | `cloud.*` rellenados por | Identidad de instancia |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| AWS Elastic Beanstalk | `aws_elastic_beanstalk` | Los detectores `elastic_beanstalk` y `ec2` del Collector; `aws` en Node.js | `host.id` (descarte el `service.instance.id` del despliegue) |
| AWS App Runner | `aws_app_runner` | Usted (sin detector) | `host.name` |
| Google App Engine | `gcp_app_engine` | El detector `gcp` (el del Collector y el de cada SDK) | `faas.instance` |
| Azure App Service | `azure_app_service` | `azureappservice` del Collector, los detectores `azure` de Node.js y .NET; `cloud.account.id` lo pone usted | `service.instance.id`, después `host.id` |
| Azure Container Instances | `azure_container_instances` | Usted (sin detector) | `host.name` |

Cada sección de abajo necesita una clave de ingesta **Servidor** de **Ajustes del proyecto → Telemetría y APM → Claves de ingesta**, y una aplicación instrumentada con un SDK de OpenTelemetry. Si aloja OneUptime usted mismo, sustituya `https://oneuptime.com/otlp` por `https://YOUR-ONEUPTIME-HOST/otlp`.

> [!IMPORTANT]
> El token es un secreto en todas estas plataformas. Cada sección nombra el almacén de secretos de la plataforma. Un token escrito en una variable de entorno normal lo puede leer cualquiera que pueda leer la configuración de la app.

## AWS Elastic Beanstalk

`cloud.platform`: `aws_elastic_beanstalk`. El detector de Beanstalk lee `/var/elasticbeanstalk/xray/environment.conf` en la instancia y define `cloud.platform`, `service.instance.id`, `service.version` y el nombre del entorno. No conoce la cuenta ni la región, así que combínelo con el detector de EC2, que sí las conoce y que además define `host.id`.

Ejecute un OpenTelemetry Collector en cada instancia, con esta configuración:

```yaml title="config.yaml"
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
      grpc:
        endpoint: 0.0.0.0:4317
processors:
  # elastic_beanstalk sets cloud.platform and service.instance.id; ec2 adds
  # cloud.account.id, cloud.region and host.id. The first detector to set an
  # attribute wins, so elastic_beanstalk comes first.
  resourcedetection:
    detectors: [env, elastic_beanstalk, ec2]
    timeout: 5s
  # The Beanstalk detector's service.instance.id is the deployment ID, shared
  # by every instance of a deployment: drop it, so that ec2's host.id names
  # each instance.
  resource:
    attributes:
      - key: service.instance.id
        action: delete
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
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp/oneuptime]
    metrics:
      receivers: [otlp]
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers: [otlp]
      processors: [resourcedetection, resource, batch]
      exporters: [otlphttp/oneuptime]
```

:::steps
1. Guarde el token en Secrets Manager: `aws secretsmanager create-secret --name oneuptime/ingestion-token --secret-string "YOUR_TELEMETRY_INGESTION_TOKEN"`. Las propiedades de entorno de Beanstalk se guardan en la configuración del entorno, no en un almacén de secretos, así que lea el secreto desde un hook de plataforma, con el perfil de instancia. El perfil de instancia necesita `secretsmanager:GetSecretValue` sobre él.
2. Instale el colector desde un script `.platform/hooks/postdeploy/` (o `.ebextensions`): el paquete `otelcol-contrib`, con la configuración de arriba y el secreto en su entorno como `ONEUPTIME_TOKEN`.
3. **AWS Console → Elastic Beanstalk → Environments → your environment → Configuration**.
4. En la categoría **Updates, monitoring, and logging**, haga clic en **Edit** y baje hasta **Environment properties**. Añada `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT` con `http://localhost:4318`, y `OTEL_EXPORTER_OTLP_PROTOCOL` con `http/protobuf`.
5. Haga clic en **Apply**. Beanstalk reinicia la aplicación con las nuevas propiedades.
:::

Las aplicaciones Node.js pueden prescindir del colector: los detectores del SDK incluyen Beanstalk y EC2. Defina `OTEL_EXPORTER_OTLP_ENDPOINT` como `https://oneuptime.com/otlp`, `OTEL_EXPORTER_OTLP_HEADERS` como `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN` y `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,aws`. El token queda entonces en una propiedad de entorno. Compruebe después los atributos de recurso de una traza: si `cloud.platform` dice `aws_ec2`, su versión del SDK dejó ganar al detector de EC2, y el colector es la vía fiable.

**Red:** las instancias de una subred privada necesitan una puerta de enlace NAT, y el grupo de seguridad de la instancia debe permitir la salida por TCP 443 hacia el host de OneUptime.

## AWS App Runner

`cloud.platform`: `aws_app_runner`. No existe ningún detector, así que defina los atributos usted. App Runner puede poner un secreto de Secrets Manager (o de SSM Parameter Store) en una variable de entorno.

```bash
OTEL_SERVICE_NAME=checkout-api
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
# From Secrets Manager: the secret holds the whole header.
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
OTEL_RESOURCE_ATTRIBUTES=cloud.provider=aws,cloud.platform=aws_app_runner,cloud.region=us-east-1,cloud.account.id=123456789012
OTEL_NODE_RESOURCE_DETECTORS=env,host,os
```

Sustituya la región y el ID de cuenta por los suyos. El detector `host` aporta `host.name`, el nombre de host del contenedor, que es distinto para cada instancia de App Runner, y OneUptime nombra la instancia por él.

:::steps
1. Guarde el encabezado completo en Secrets Manager: `aws secretsmanager create-secret --name oneuptime/otlp-headers --secret-string "x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"`. App Runner pone el valor del secreto tal cual en la variable.
2. **AWS Console → App Runner → Services → your service → Configuration → Configure service** (en la pestaña **Configuration**, haga clic en **Edit**).
3. En **Environment variables**, haga clic en **Add environment variable** para cada valor simple de arriba.
4. Añada `OTEL_EXPORTER_OTLP_HEADERS` con **Source: Secrets Manager** y el ARN del secreto. En **Security → Instance role**, elija un rol con `secretsmanager:GetSecretValue` sobre el secreto: el rol de instancia, no el rol de acceso que descarga la imagen.
5. Haga clic en **Save changes**. App Runner despliega una nueva versión.
:::

**Red:** un servicio sin conector de VPC llega a Internet directamente. Con **Outgoing network traffic: Custom VPC**, la salida pasa por su VPC, que necesita una puerta de enlace NAT y una regla de salida del grupo de seguridad por TCP 443 hacia el host de OneUptime.

## Google App Engine

`cloud.platform`: `gcp_app_engine`. El detector de GCP reconoce App Engine estándar y flexible por `GAE_SERVICE`, `GAE_VERSION` y `GAE_INSTANCE` y por el servidor de metadatos. Define `cloud.account.id` (el proyecto), `cloud.region`, `faas.name`, `faas.version` y `faas.instance`. Como en Cloud Run, `faas.name` hace que cada servicio de App Engine aparezca también en **Funciones serverless**, mientras el entorno agrupa el proyecto y la región.

| Lenguaje | Activar el detector de GCP |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| Node.js | `OTEL_NODE_RESOURCE_DETECTORS=env,host,os,gcp` |
| Python | `pip install opentelemetry-resourcedetector-gcp` y luego `OTEL_EXPERIMENTAL_RESOURCE_DETECTORS=gcp_resource_detector` |
| Java | `-Dotel.resource.providers.gcp.enabled=true` |
| Go | `go.opentelemetry.io/contrib/detectors/gcp` → `gcp.NewDetector()` |
| .NET | `OpenTelemetry.Resources.Gcp` → `.AddGcpDetector()` |

App Engine no tiene un editor de variables de entorno en la consola: viven en `app.yaml`.

```yaml title="app.yaml"
runtime: nodejs22
env_variables:
  OTEL_SERVICE_NAME: checkout-api
  OTEL_EXPORTER_OTLP_ENDPOINT: https://oneuptime.com/otlp
  OTEL_EXPORTER_OTLP_PROTOCOL: http/protobuf
  OTEL_NODE_RESOURCE_DETECTORS: env,host,os,gcp
  # Do not commit the real value. Template it in CI, or read the secret at
  # start-up with the Secret Manager client instead.
  OTEL_EXPORTER_OTLP_HEADERS: x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

:::steps
1. Guarde el encabezado completo en Secret Manager: `printf '%s' "x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN" | gcloud secrets create oneuptime-otlp-headers --data-file=-`. Conceda a la cuenta de servicio de App Engine (`my-project@appspot.gserviceaccount.com`) `roles/secretmanager.secretAccessor` sobre él.
2. Inserte el secreto en `app.yaml` en su pipeline de despliegue, manteniendo un marcador de posición en el archivo confirmado. O lea `projects/PROJECT_ID/secrets/oneuptime-otlp-headers/versions/latest` al arrancar y páselo a la opción `headers` del exportador en el código.
3. Despliegue con `gcloud app deploy`. En la consola, **App Engine → Versions** muestra la nueva versión, y **App Engine → Services** el servicio que aparece en **Funciones serverless**.
:::

**Red:** App Engine estándar llega a Internet directamente. Las instancias del entorno flexible viven en una VPC: si la subred no tiene IP externas, necesitan Cloud NAT, y una regla de firewall de salida por TCP 443 hacia el host de OneUptime.

## Azure App Service

`cloud.platform`: `azure_app_service`. Los detectores de Azure de Node.js y .NET, y el detector `azureappservice` del Collector, leen las variables `WEBSITE_*` que define App Service. Rellenan `cloud.platform`, `cloud.region`, `service.instance.id` (a partir de `WEBSITE_INSTANCE_ID`), `deployment.environment` (la ranura) y `host.id`. Ninguno define `cloud.account.id`: añada usted el ID de suscripción, o la clave de entorno tendrá un segmento de cuenta vacío.

```bash
OTEL_SERVICE_NAME=checkout-api
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
# The Key Vault reference, which resolves to the whole header.
OTEL_EXPORTER_OTLP_HEADERS=@Microsoft.KeyVault(SecretUri=https://my-vault.vault.azure.net/secrets/oneuptime-otlp-headers/)
OTEL_RESOURCE_ATTRIBUTES=cloud.account.id=00000000-0000-0000-0000-000000000000
# Node.js:
OTEL_NODE_RESOURCE_DETECTORS=env,host,os,azure
```

Los detectores de los SDK escriben la plataforma `azure.app_service`, con un punto; OneUptime la reescribe a `azure_app_service` al recibirla. En .NET, añada `OpenTelemetry.Resources.Azure` y llame a `.ConfigureResource(r => r.AddAzureAppServiceDetector())`. Los demás lenguajes añaden `cloud.provider=azure,cloud.platform=azure_app_service,cloud.region=<region>` a `OTEL_RESOURCE_ATTRIBUTES`, y toman `service.instance.id` de `WEBSITE_INSTANCE_ID` en el código.

:::steps
1. Active la identidad administrada asignada por el sistema de la app (**Settings → Identity**), y concédale **Key Vault Secrets User** en el almacén. Guarde el encabezado completo, `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`, como el secreto `oneuptime-otlp-headers`.
2. **Azure portal → App Services → your app → Settings → Environment variables** (**Configuration → Application settings** en portales antiguos).
3. **+ Add** para cada variable de arriba. El valor de `OTEL_EXPORTER_OTLP_HEADERS` es la referencia de Key Vault.
4. Haga clic en **Apply** y luego en **Confirm**: la app se reinicia con los nuevos ajustes. Las ranuras de implementación tienen sus propios ajustes: marque el token como **deployment slot setting** si solo una ranura debe enviar telemetría.
:::

**Red:** App Service llega a Internet directamente salvo que esté activada la **VNet integration** con **Route All**. Entonces la VNet necesita una puerta de enlace NAT, o una ruta a un firewall que permita TCP 443 hacia el host de OneUptime.

## Azure Container Instances

`cloud.platform`: `azure_container_instances`. No existe ningún detector, así que defina los atributos usted. Las variables de entorno de un grupo de contenedores se fijan al crearlo: cambiar una significa volver a crear el grupo. Pase el token con `--secure-environment-variables`, para que `az container show` no lo devuelva:

```bash
az container create \
  --resource-group my-rg \
  --name checkout-api \
  --image myregistry.azurecr.io/checkout-api:1.4.2 \
  --location eastus \
  --environment-variables \
    OTEL_SERVICE_NAME=checkout-api \
    OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp \
    OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
    "OTEL_RESOURCE_ATTRIBUTES=cloud.provider=azure,cloud.platform=azure_container_instances,cloud.region=eastus,cloud.account.id=00000000-0000-0000-0000-000000000000" \
    OTEL_NODE_RESOURCE_DETECTORS=env,host,os \
  --secure-environment-variables \
    "OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

El `host.name` del detector `host`, el nombre de host del grupo de contenedores, nombra la instancia. Un colector sidecar también funciona aquí, ya que un grupo de contenedores ejecuta varios contenedores como una tarea de ECS: use el patrón `detectors: [env]` más `OTEL_RESOURCE_ATTRIBUTES` de [Azure Container Apps](/docs/telemetry/cloud-azure-container-apps). También es lo que llena los mosaicos **CPU** y **Memoria**, si envía `container.cpu.utilization` y `container.memory.usage` con la identidad del grupo.

:::steps
1. **Azure portal → Container Instances → + Create**. Rellene la pestaña **Basics**: grupo de recursos, nombre, región e imagen.
2. En la pestaña **Advanced**, en **Environment variables**, añada cada variable. Para `OTEL_EXPORTER_OTLP_HEADERS`, ponga **Mark as secure** en **Yes**, para que el portal y la API no muestren su valor.
3. Haga clic en **Review + create** y luego en **Create**. Para cambiar una variable más tarde, elimine el grupo y vuelva a crearlo.
:::

**Red:** un grupo de contenedores con IP pública llega a Internet directamente. Uno en una subred de VNet solo sale por la ruta de la VNet: añada una puerta de enlace NAT, o permita TCP 443 hacia el host de OneUptime en el firewall o el NSG.

## Comprobar la conexión

Sea cual sea la plataforma que configuró, compruebe primero el token y luego busque el entorno:

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`200` con `"valid": true` significa que el token se acepta. `401` significa que es desconocido, revocado, desactivado o caducado. Al minuto del primer span, registro o métrica, el entorno aparece en **Nube → Todos los entornos**, con el nombre de la plataforma, la región y la cuenta.

## Solución de problemas

:::details Las instancias de Beanstalk aparecen en Hosts
Ganó el `cloud.platform=aws_ec2` del detector de EC2. Gana el primer detector que define un atributo, así que mantenga `elastic_beanstalk` antes que `ec2` en `detectors`. Sin colector, el SDK de Node.js también puede favorecer al detector de EC2: ejecute el colector.
:::

:::details Todas las instancias de Beanstalk comparten una fila en Instancias
El `service.instance.id` del detector de Beanstalk es el ID del despliegue, compartido por todas las instancias de un despliegue, y se lee antes que `host.id`. Mantenga en cada pipeline el procesador `resource` que lo elimina.
:::

:::details Una app de App Service recibe 401
La referencia de Key Vault no se resolvió, así que App Service pasó el texto literal `@Microsoft.KeyVault(...)` como encabezado. Dé a la identidad administrada de la app **Key Vault Secrets User** en el almacén, y compruebe que el secreto contiene el encabezado completo `x-oneuptime-token=...`.
:::

:::details Un entorno de App Service tiene un segmento de cuenta vacío
Ninguno de los detectores de App Service define `cloud.account.id`. Añada el ID de suscripción a `OTEL_RESOURCE_ATTRIBUTES` en cada app: la telemetría con y sin él llega a dos entornos.
:::

:::details Una variable de Container Instances cambiada no tiene efecto
Las variables de entorno de un grupo de contenedores se fijan al crearlo. Elimine el grupo y vuelva a crearlo con los nuevos valores.
:::

Consulte [Solución de problemas en la nube](/docs/telemetry/cloud-troubleshooting) para lo demás, en especial un entorno que aparece en **Hosts**, solo en **Funciones serverless** (App Engine sin el detector de GCP), o dos veces (`cloud.account.id` definido en unos despliegues y en otros no).

## Próximos pasos

:::cards
- [Entornos en la nube](/docs/telemetry/cloud-environments): Cómo se identifican los entornos y las instancias.
- [Solución de problemas en la nube](/docs/telemetry/cloud-troubleshooting): Los fallos que comparten todas las plataformas.
- [Funciones serverless](/docs/telemetry/serverless-functions): Lambda, Cloud Functions y Azure Functions.
- [Recursos en la nube (IaaS y PaaS)](/docs/telemetry/cloud-resources): Los recursos alrededor de sus apps, desde la propia supervisión de su nube.
:::
