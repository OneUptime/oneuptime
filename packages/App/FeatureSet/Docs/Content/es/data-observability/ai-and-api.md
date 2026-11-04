# OneUptime AI y la API

OneUptime AI conoce tus datos: investiga una alerta de datos a partir de quienes escriben en la tabla, de sus ejecuciones y de sus tablas de origen, responde si una tabla está actualizada allí donde se le pregunte y escribe una comprobación a partir de una regla dicha en una frase. Todo lo que muestra Observabilidad de datos está también a disposición de tus propias herramientas, a través de sus endpoints, sus métricas y el servidor MCP.

## OneUptime AI

- **Investigaciones de alertas de datos.** Cuando OneUptime AI investiga una alerta sobre una tabla, un pipeline o una base de datos, parte de lo que tiene al lado: la frescura y las alertas abiertas de la tabla, la alerta de la que es consecuencia, las ejecuciones de los pipelines que escriben en ella desde el día anterior (una ejecución fallida con su error, o la ejecución que nunca llegó), los servicios que escriben en ella con sus escrituras fallidas, despliegues y otros cambios, y las tablas a partir de las que se construye. Nombra la ejecución, el despliegue o la tabla de origen que hay detrás de la alerta. Consulta [AI SRE](/docs/ai/ai-sre).
- **¿Está actualizada esta tabla?** Pregunta en [Preguntar a la IA](/docs/ai/ask-ai), Slack o Microsoft Teams: «¿está actualizada la tabla orders?». La respuesta da la frescura de la tabla según su propio ritmo, cuándo cambió por última vez, sus alertas abiertas, las últimas ejecuciones de quienes escriben en ella y los productos de datos de los que forma parte. Un nombre que comparten varias bases de datos se responde para cada una, para que a nadie se le diga que la tabla equivocada está actualizada.
- **Una comprobación a partir de una frase.** En la pestaña **Comprobaciones** de una tabla, **Escribir una comprobación a partir de una frase** convierte una regla en una comprobación de SQL personalizado en el SQL de tu motor. Consulta [Comprobaciones y conciliaciones](/docs/data-observability/checks).

Cada una de estas funciones necesita que OneUptime AI esté activado para el proyecto, y actúa con los permisos de la persona que pregunta.

## Agentes de IA y el servidor MCP

Los agentes de IA deberían comprobar que los datos están actualizados antes de usarlos. El [servidor MCP](/docs/ai/mcp-server) tiene una herramienta de solo lectura para eso:

| Herramienta | Qué responde |
| --- | --- |
| `get_data_table_freshness` | Si una tabla vigilada está actualizada, cuándo cambió por última vez, sus alertas abiertas, las últimas ejecuciones de quienes escriben en ella y sus productos de datos. Indica `table` como `schema.table`, solo el nombre de la tabla o su ID |

Funciona con un inicio de sesión de solo lectura y responde como la persona o la clave de API que inició sesión.

## Endpoints

| Endpoint | Para qué sirve | Firmado con |
| --- | --- | --- |
| `POST /telemetry/openlineage/api/v1/lineage` | Eventos de OpenLineage de Airflow, Dagster, Spark, dbt o Flink | Una clave de ingesta de telemetría |
| `POST /telemetry/dbt/v1/artifacts` | El `manifest` y los `run_results` de un build de dbt | Una clave de ingesta de telemetría |
| `POST /telemetry/fivetran/v1/webhook/<ingestion key ID>` | Los webhooks de sincronización de Fivetran | La clave de ingesta, como secreto de firma de Fivetran |
| `POST /telemetry/airbyte/v1/webhook/<ingestion key>` | Los webhooks de sincronización de Airbyte | La clave de ingesta en la URL |
| `POST /api/data-observability/tables/freshness` | La frescura de una tabla, tal como la responde la herramienta MCP, con `{ "table": "public.orders" }` | Una clave de API |
| `GET /api/data-observability/data-products/<data product ID>/badge?token=<badge token>` | La insignia «data as of» de un producto de datos | El token propio de la insignia |

Las tablas, comprobaciones, conciliaciones, pipelines y productos de datos son también recursos normales de la [API](/docs/api-reference/api-reference), que se leen y modifican con una clave de API que tenga los permisos correspondientes.

## Métricas

Cada número que guarda Observabilidad de datos es una métrica que puedes graficar, poner en un panel o usar para crear alertas: `oneuptime.data.table.*` para cada tabla, `oneuptime.data.check.value` para cada comprobación, `oneuptime.data.reconciliation.*` para cada conciliación, `oneuptime.data.pipeline.*` para cada pipeline y `oneuptime.data.product.*` para cada producto de datos. Son datos operativos propios de OneUptime y no se facturan como telemetría.

## Próximos pasos

:::cards
- [Servidor MCP](/docs/ai/mcp-server): Conecta un agente de IA a OneUptime.
- [Observabilidad de datos](/docs/data-observability/index): Vuelve a la vista general.
:::
