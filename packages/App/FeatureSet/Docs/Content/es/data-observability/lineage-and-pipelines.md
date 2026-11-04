# Linaje y pipelines

El linaje dice a partir de qué tablas se construye cada tabla y qué pipelines escriben en ella. Observabilidad de datos lo reúne desde seis fuentes a la vez (los eventos de OpenLineage, dbt, las sincronizaciones de Fivetran y Airbyte, los jobs de tus trazas, las vistas y el propio historial de consultas de cada base de datos) y lo usa para vincular cada tabla retrasada o rota con la ejecución que hay detrás, de modo que un problema abra una sola incidencia.

## De dónde sale el linaje

| Fuente | Qué aporta |
| --- | --- |
| **OpenLineage** | Cada ejecución de un job de Airflow, Dagster, Spark, dbt o Flink, con las tablas que leyó y escribió |
| **dbt** | A partir de qué se construye cada modelo, cada build como una ejecución y el resultado de cada prueba |
| **Fivetran y Airbyte** | Cada sincronización como una ejecución de su conector, y las tablas sin procesar que carga |
| **Jobs de tus trazas** | Un CronJob de Kubernetes o una función programada, sus ejecuciones, y las tablas que leyeron y escribieron las llamadas a su base de datos |
| **Vistas** | Una vista se construye a partir de las tablas sobre las que está definida (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, Snowflake, vistas materializadas de ClickHouse, Databricks, MongoDB) |
| **Historial de consultas** | Una consulta que leyó una tabla y escribió otra (el historial de acceso de Snowflake, los jobs de BigQuery, el registro de consultas de Redshift, el registro de consultas de ClickHouse, la tabla de linaje de Databricks) |

La pestaña **Linaje** de una tabla muestra las tablas a partir de las que se construye, los pipelines que escriben en ella con su última ejecución, y las tablas que se construyen a partir de ella. Cada arista indica dónde se vio.

Cuando la fuente nombra columnas, la pestaña **Columnas** de una tabla indica de dónde viene cada columna y qué alimenta: el historial de acceso de Snowflake (edición Enterprise, que necesita `IMPORTED PRIVILEGES` sobre la base de datos `SNOWFLAKE`) y la faceta `columnLineage` de OpenLineage.

## OpenLineage

Envía los eventos de OpenLineage a OneUptime, sin cambios, con una [clave de ingesta](/docs/telemetry/ingestion-keys) de telemetría:

- **URL:** `https://oneuptime.com/telemetry/openlineage` (en un OneUptime autoalojado, tu propia dirección)
- **Endpoint:** `api/v1/lineage`, el valor predeterminado de OpenLineage
- **Clave de API:** la clave de ingesta, enviada como `Authorization: Bearer`, o configura `x-oneuptime-token`

Para el proveedor de OpenLineage de Airflow:

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

Para cualquier otro cliente de OpenLineage, configura `OPENLINEAGE_URL` y `OPENLINEAGE_API_KEY`. Los conjuntos de datos se asocian a tablas según la convención de nombres de OpenLineage, como `postgres://host:5432` con `database.schema.table`, `snowflake://account` con `database.schema.table`, `clickhouse://host:8443` con `database.table` y `databricks://workspace-host` con `catalog.schema.table`.

## dbt

Después de `dbt build` (o run, test, seed o snapshot), envía los artefactos del proyecto con la [CLI de OneUptime](/docs/cli/index):

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

En CI, ejecuta `oneuptime dbt upload` como el paso posterior al build, incluso cuando el build falla, para que se registren las pruebas fallidas. Cada tabla que construye dbt recibe una tarjeta **dbt** en su vista general, el linaje de sus modelos y sus pruebas en su pestaña **Comprobaciones**; cada build es una ejecución del pipeline del proyecto.

## Fivetran y Airbyte

Sus webhooks indican cuándo empieza y termina cada sincronización. **Canalizaciones > Conectar Fivetran o Airbyte** rellena las URL con una de tus claves de ingesta:

- **Fivetran:** un webhook creado con la API REST de Fivetran, para los eventos `sync_start` y `sync_end`, hacia `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`, con la clave de ingesta como secreto. Fivetran firma cada entrega con ella, así que la clave nunca viaja en la URL.
- **Airbyte:** el webhook del espacio de trabajo configurado en `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`, activado para las sincronizaciones fallidas y las correctas. Dale a Airbyte una clave propia.

Una sincronización de Fivetran reprogramada por el límite de frecuencia de una API termina como **Reprogramada**: no es un fallo, así que no avisa a nadie.

## Jobs de tus trazas

Muchos pipelines son un CronJob de Kubernetes, o una función con un temporizador, sin ningún programador que envíe linaje. Sus trazas lo dicen igualmente, sin nada que instalar. Cada quince minutos, los spans con el atributo de recurso `k8s.cronjob.name` o `k8s.job.name`, o `faas.name` con un `faas.trigger` de `timer` o `datasource`, se convierten en un pipeline en **Canalizaciones**:

- Una ejecución de un CronJob es su Job de Kubernetes, y una ejecución de una función es su `faas.invocation_id`.
- Una ejecución falló cuando falló el span que encabeza su traza. Una llamada que falló y se reintentó dentro de ella no la hace fallar.
- Las tablas que escribió y leyó salen de sus spans de base de datos.

Cada ejecución enlaza con su traza, con sus registros. Se aplican los mismos tres monitores, así que un CronJob que deja de ejecutarse se ve como retrasado.

## Paneles en herramientas de BI

El impacto real de los datos malos es el panel que alguien abre. En **Paneles de BI**, añade tus herramientas de BI con credenciales que puedan leer sus paneles. Cada hora, Observabilidad de datos lee cada panel y las tablas que hay detrás, asocia cada tabla con una vigilada y muestra los paneles construidos sobre una tabla, y sobre las tablas construidas a partir de ella, en su pestaña **Linaje**, en sus alertas y en Production Review.

| Herramienta | Credenciales |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, una entidad de servicio autorizada a usar las API de administración de Power BI |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (o `eu`) |

Hightouch y Census son herramientas de ETL inverso: una sincronización que copia una tabla en un CRM depende de esa tabla igual que un panel, así que se lee del mismo modo y se nombra en las alertas de la tabla.

Solo se leen los nombres y enlaces de los paneles y las tablas que consultan: nunca sus datos.

## Pipelines

Cada job, proyecto de dbt y sincronización aparece en **Canalizaciones**, con sus ejecuciones: cuándo empezó y terminó cada una, cuánto duró, qué intento fue donde el programador lo indica (el número de intento de Airflow) y el error de una ejecución fallida. Tras cinco ejecuciones, cada pipeline aprende de sus propias ejecuciones cuánto suele durar una ejecución y cuánto tiempo pasa entre ejecuciones según su programación. La página de un pipeline recomienda tres monitores:

- **Pipeline Run Failed**: una ejecución falló o se canceló.
- **Pipeline Run Unusually Long**: una ejecución ha tardado el doble de lo habitual o más, comprobado cada cinco minutos mientras se ejecuta, de modo que una ejecución que se cuelga se detecta antes de que termine.
- **Pipeline Is Late**: no ha empezado ninguna ejecución en más tiempo del que permite su programación.

## Una incidencia por causa

Cuando una tabla se queda desactualizada, todas las tablas construidas a partir de ella también. Antes de que se abra una alerta de datos, OneUptime busca en el linaje una alerta ya abierta sobre aquello a partir de lo que se construye su tabla o su pipeline: las tablas de origen, los pipelines que escriben en ellas y las bases de datos donde están, hasta cinco niveles hacia arriba. Si encuentra una, la nueva alerta es consecuencia de esa alerta:

- Empieza en estado **Reconocido**, para que nadie reciba dos avisos por un mismo problema, y se recupera sola en cuanto sus datos se recuperan.
- Su feed y su tarjeta **Datos** indican qué alerta la causó, y se une al episodio de la causa.

La tarjeta **Datos** de la causa enumera su **Impacto aguas abajo**: todas las alertas que causó. La tarjeta de una alerta de tabla también muestra los servicios que escriben en la tabla, con sus escrituras fallidas, y sus despliegues y otros cambios en el día anterior a la alerta.

## Antes de que se fusione un cambio

Cuando una pull request cambia una tabla vigilada, [Production Review](/docs/ai/ai-agent) indica en la pull request qué depende de ella: los servicios que la leen, las tablas construidas a partir de ella, los paneles sobre ella y sus productos de datos. Una tabla con una copia en una base de datos marcada como Staging también indica en qué se diferencia la copia: sus filas, sus columnas y lo que leen allí las comprobaciones de la tabla, ejecutadas al momento. En una base de datos a la que solo llega una sonda, las comprobaciones se omiten, y lo indica.

## Próximos pasos

:::cards
- [Productos de datos](/docs/data-observability/data-products): SLA de frescura sobre las tablas que usa la gente.
- [OneUptime AI y la API](/docs/data-observability/ai-and-api): Investigaciones que parten de quienes escriben en una tabla y de sus ejecuciones.
:::
