# Disparadores

Un disparador es el nodo inicial de un flujo de trabajo. No tiene puerto de entrada — la ejecución comienza aquí. OneUptime soporta cuatro familias de disparadores; cada flujo de trabajo usa exactamente uno.

## Manual

Ejecuta un flujo de trabajo bajo demanda haciendo clic en **Run Manually** en la página del flujo. Puedes pegar un payload JSON opcional que el flujo puede leer como `{{Manual.JSON}}`.

Úsalo cuando quieras un botón que dispare una pieza de automatización — un flujo de trabajo de "rotar la clave de guardia" o "reconstruir el índice de búsqueda" de un solo clic que no necesita una programación recurrente ni un evento que lo dispare.

**Argumentos**: ninguno.

**Valores de retorno**:

| Nombre | Tipo | Descripción |
| --- | --- | --- |
| `JSON` | JSON | El payload JSON proporcionado en tiempo de ejecución, o un objeto vacío. |

## Programado (Schedule)

Ejecuta un flujo de trabajo según una programación cron. Configura la cadencia con una expresión cron estándar.

Úsalo para tareas recurrentes: limpieza nocturna, sincronización horaria, exportación semanal.

**Argumentos**:

| Nombre | Tipo | Descripción |
| --- | --- | --- |
| `Schedule at` | CronTab | Expresión cron estándar de 5 campos. Por ejemplo, `0 * * * *` se ejecuta al inicio de cada hora, `*/5 * * * *` cada cinco minutos. |

**Valores de retorno**:

| Nombre | Tipo | Descripción |
| --- | --- | --- |
| `executedAt` | Date | La hora programada de ejecución. |

Los flujos de trabajo programados se ejecutan en el Workflow Worker de la región del proyecto. Si el worker no está disponible brevemente, la ejecución se despacha cuando se recupera — no necesitas protegerte contra tics perdidos por interrupciones cortas.

## Webhook

Expone una URL HTTPS única a la que un sistema externo hace `POST`. Los headers, los parámetros de consulta y el cuerpo de la petición se exponen como valores de retorno para que los lean los componentes aguas abajo.

Úsalo para recibir datos *hacia* OneUptime desde un sistema de terceros: callbacks de CI/CD, alertas de otra herramienta de monitorización, registros de clientes en tu CRM.

**Argumentos**: ninguno. La URL se asigna automáticamente al guardar el flujo de trabajo y se muestra en el nodo disparador. Trátala como un secreto — cualquiera con la URL puede disparar el flujo de trabajo.

**Valores de retorno**:

| Nombre | Tipo | Descripción |
| --- | --- | --- |
| `Request Headers` | JSON | Todos los headers de la petición HTTP entrante. |
| `Request Query Params` | JSON | Cadena de consulta parseada. |
| `Request Body` | JSON | Cuerpo de la petición parseado. Si el cuerpo no es JSON válido, llega como una cadena bajo la clave `raw`. |

El webhook acepta `GET` y `POST`. La respuesta al llamador es un `200 OK` con un acuse de recibo en JSON tan pronto como la ejecución se encola — el flujo de trabajo en sí se ejecuta de forma asíncrona, así que no esperes leer el resultado de los componentes aguas abajo en la respuesta HTTP.

## Disparadores de evento de modelo

Casi toda entidad de OneUptime — monitores, incidentes, alertas, eventos de mantenimiento programado, páginas de estado, políticas de guardia, equipos, servicios de telemetría y muchos más — expone tres disparadores:

- **On Create** — se dispara cuando se crea un nuevo registro de este tipo.
- **On Update** — se dispara cuando se modifica un registro existente. El disparador expone tanto los valores antiguos como los nuevos.
- **On Delete** — se dispara cuando se elimina un registro.

Así es como construyes automatización del estilo "cuando X ocurra en OneUptime, haz Y" sin hacer polling.

El propio modelo se expone como valor de retorno con los mismos nombres de campo que ves en el recurso. Por ejemplo, el disparador **Incident → On Create** devuelve el objeto `Incident` completo para que los nodos aguas abajo puedan leer `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}`, etc.

**Argumentos**: típicamente ninguno para create/delete. Los disparadores de update pueden permitirte restringir los campos a los que reaccionar, para que no te dispares ante cambios cosméticos.

**Valores de retorno** (varían según el modelo):

| Nombre | Tipo | Descripción |
| --- | --- | --- |
| Campos del modelo | (varían) | Cada columna de la entidad — nombre, estado, marcas de tiempo, claves foráneas. |
| `previous` (solo Update) | JSON | El registro tal como estaba antes del cambio. |

### Disparadores de modelo comunes

Una lista no exhaustiva de los eventos de modelo a los que más recurren los equipos:

- **Incident** — `On Create`, `On Update` (úsalo para reaccionar a cambios de estado como Acknowledged o Resolved), `On Delete`.
- **Alert** — los mismos tres eventos sobre el modelo de alerta.
- **Monitor** — reacciona cuando se añade, edita o elimina un monitor; combina con condiciones para actuar solo sobre monitores de producción.
- **Scheduled Maintenance** — automatiza anuncios aguas abajo cuando se crea una ventana de mantenimiento o cambia su estado.
- **Status Page Subscriber** — dispara un flujo de bienvenida cuando alguien se suscribe.
- **On-Call Duty Policy** — sincroniza los cambios de calendario con una agenda externa.

Si el modelo está expuesto en la API de OneUptime, es casi seguro que puede disparar un flujo de trabajo — busca en la paleta de disparadores por el nombre de la entidad.

## Elegir el disparador adecuado

| Si quieres… | Usa |
| --- | --- |
| Construir un botón en un flujo de trabajo que alguien pulsa | **Manual** |
| Ejecutar una tarea cada N minutos/horas/días | **Schedule** |
| Que un sistema externo envíe datos a OneUptime | **Webhook** |
| Reaccionar a algo que ocurre *dentro* de OneUptime | **Model event** |

Los flujos de trabajo solo pueden tener un disparador. Si necesitas dos señales de inicio distintas para compartir la mayor parte de la misma lógica, extrae los pasos compartidos a un solo flujo de trabajo y llámalo desde dos flujos "envoltorio" delgados usando el componente **Execute Workflow** (consulta [Componentes](/docs/workflows/components)).

## Qué leer a continuación

- [Componentes](/docs/workflows/components) — las acciones que cablearás después del disparador.
- [Variables](/docs/workflows/variables) — cómo leer los valores de retorno del disparador desde los nodos aguas abajo.
- [Ejecuciones y registros](/docs/workflows/runs-and-logs) — cómo confirmar que tu disparador se está activando.
