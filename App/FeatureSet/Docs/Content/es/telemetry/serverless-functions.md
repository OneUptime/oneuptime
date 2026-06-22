# Funciones Serverless

## Descripción general

OneUptime reconoce automáticamente una **Función Serverless** en el momento en que recibe datos de OpenTelemetry etiquetados con el atributo de recurso `faas.name`. No hay nada que crear a mano: instrumenta tu función con el SDK de OpenTelemetry para tu runtime, apunta su exportador OTLP a OneUptime, y la función aparecerá en **Funciones Serverless** con sus trazas, registros y métricas.

Esto funciona para AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers, o cualquier runtime FaaS que pueda emitir OpenTelemetry.

## Requisitos previos

- Un **Token de Ingesta de Telemetría de OneUptime**: crea uno desde _Configuración del Proyecto → Claves de Ingesta de Telemetría_ y copia el valor `x-oneuptime-token`.
- El SDK de OpenTelemetry (o una capa de instrumentación automática) para el lenguaje de tu función.

## Cómo OneUptime identifica una función

OneUptime indexa cada función con el atributo de recurso `faas.name`:

| Atributo                                               | Obligatorio | Propósito                                                   |
| ------------------------------------------------------ | ----------- | ----------------------------------------------------------- |
| `faas.name`                                            | **sí**      | Identidad de la función (p. ej. `checkout-handler`)         |
| `faas.version`                                         | no          | Se muestra en la descripción general                        |
| `faas.instance`                                        | no          | Se rastrea por instancia en la pestaña **Instancias**       |
| `cloud.platform`                                       | no          | `aws_lambda`, `gcp_cloud_functions`, `azure_functions`, ... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | no          | Se muestra en la descripción general                        |

> Una función que también establece `service.name` sigue apareciendo en **Servicios**. La vista de **Funciones Serverless** es la perspectiva enfocada en FaaS, delimitada por `faas.name`.

## Paso 1 — Configura las variables de entorno del exportador OTLP

La mayoría de las instrumentaciones automáticas de lenguaje respetan las variables de entorno estándar de OpenTelemetry:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

Si alojas OneUptime por tu cuenta, reemplaza el endpoint por `https://YOUR-ONEUPTIME-HOST/otlp`.

## Paso 2 — (AWS Lambda) añade la capa de OpenTelemetry

Para AWS Lambda, la ruta más sencilla es la [capa Lambda de OpenTelemetry](https://opentelemetry.io/docs/faas/lambda-auto/). Adjunta la capa para tu runtime y configura:

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

La capa establece `faas.name` a partir del nombre de la función automáticamente, y el detector de recursos rellena `cloud.platform`, `cloud.region` y `cloud.account.id`.

## Lo que obtienes

Una vez que la función emite un span, un registro o una métrica, aparece en **Funciones Serverless**. La descripción general muestra:

- **Invocaciones**, **tasa de errores** y **duración p95**: derivadas de tus trazas, en un rango de tiempo seleccionable, con gráficos de tendencias.
- **Instancias**: un recuento en vivo de los valores `faas.instance` observados.
- Pestañas completas de **Registros**, **Trazas** y **Métricas** delimitadas a esta función.

También puedes aplicar automáticamente etiquetas y propietarios mediante _Serverless → Configuración → Reglas de Etiquetas / Reglas de Propietarios_.
