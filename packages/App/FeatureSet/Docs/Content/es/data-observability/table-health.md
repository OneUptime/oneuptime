# Salud de las tablas

Cada cinco minutos, el catálogo de cada base de datos conectada dice cómo está cada tabla: cuándo cambió por última vez, cuántas filas contiene, cuánto ocupa y cuáles son sus columnas. Observabilidad de datos aprende con eso el ritmo de cada tabla, y avisa cuando una tabla llega tarde, se reduce o cambia de estructura, sin ningún umbral que configurar.

## Qué se lee

Para cada tabla y vista:

- **El recuento de filas y el tamaño**, de las propias estadísticas del motor.
- **Cuándo cambió por última vez**: la marca de tiempo del propio motor donde guarda una, o el momento en que sus contadores de escritura, sus filas o sus bytes se movieron entre dos recopilaciones.
- **Sus columnas**, con sus tipos y si pueden estar vacías.
- **Cuándo se leyó por última vez**, donde el motor cuenta las lecturas.

Solo se lee el catálogo. No se lee ninguna fila, y ningún valor sale de la base de datos.

## Frescura

El **ritmo** de una tabla es la frecuencia con la que suele cambiar, aprendida a partir del tiempo entre sus cambios. Una tabla que supera con creces su ritmo aparece como **Late**, en su página y en **Tablas**, e indica cuánto lo ha superado. Su frescura se conoce en cuanto ha cambiado dos veces: una tabla que se carga cada hora se aprende en unas horas, una que se carga cada noche en unos días.

Una vista no tiene filas propias, así que su frescura es la de sus fuentes: consulta [Linaje y pipelines](/docs/data-observability/lineage-and-pipelines).

## Cambios de volumen y de esquema

- Las **Filas** se comparan entre recopilaciones: una tabla que pierde la mitad de sus filas, o que tiene muchas menos de lo habitual para esa hora de la semana, lo indica.
- Las **Columnas** también se comparan. Una columna añadida, eliminada, renombrada, con otro tipo o que pasa a admitir nulos aparece en la **Cronología** de la tabla y en **Cambios de esquema**, que enumera todos los cambios de todas las bases de datos, del más reciente al más antiguo.
- Las **Tablas eliminadas** se conservan en **Tablas eliminadas**, con la última vez que se vieron, y vuelven con su historial si la tabla reaparece.

## Alertas recomendadas

En **Bases de datos**, elige **Recommended Alerts** para una base de datos. Cada recomendación es un único monitor de métricas para toda la base de datos que alerta una vez por tabla, de modo que también se vigila una tabla creada más tarde:

| Alerta | Se dispara cuando |
| --- | --- |
| **Table Is Late** | Una tabla lleva quince minutos pasada de la hora a la que suele cambiar |
| **Row Count Fell Sharply** | Una tabla pierde la mitad de sus filas o más entre dos recopilaciones |
| **Row Count Unusually Low** | Una tabla tiene muchas menos filas de lo habitual para esa hora de la semana (aprendido durante dos semanas) |
| **Schema Changed** | Se añaden, eliminan, renombran o cambian de tipo columnas de una tabla |
| **Table Health Stopped Reporting** | No se ha leído ninguna tabla de la base de datos en quince minutos |

Elige las gravedades, las políticas de guardia, los propietarios y las etiquetas al crearlas. A partir de ahí son monitores normales: edítalos, siléncialos o ponlos en una página de estado como cualquier otro.

## Métricas que escribe cada tabla

Cada recopilación escribe estas métricas para cada tabla, para que puedas graficarlas, ponerlas en paneles y crear alertas sobre ellas como con cualquier otra métrica:

| Métrica | Qué es |
| --- | --- |
| `oneuptime.data.table.row_count` | Filas de la tabla |
| `oneuptime.data.table.size` | Bytes que ocupan la tabla y sus índices |
| `oneuptime.data.table.seconds_since_change` | Segundos desde el último cambio de la tabla |
| `oneuptime.data.table.overdue_seconds` | Segundos que la tabla lleva pasada de la hora a la que suele cambiar; 0 mientras va a tiempo |
| `oneuptime.data.table.row_count_change_percent` | Cuánto varió el recuento de filas desde la recopilación anterior, en porcentaje |
| `oneuptime.data.table.schema_changes` | Columnas cambiadas desde la recopilación anterior |

Cada fila lleva `oneuptime.data.store.id`, `oneuptime.data.store.name`, `oneuptime.data.table.id`, `oneuptime.data.table.schema`, `oneuptime.data.table.name` y `oneuptime.data.table.key` (`schema.table`). Un [monitor de métricas](/docs/monitor/metrics-monitor) agrupado por `oneuptime.data.table.key` alerta una vez por tabla, y sus filtros **Anomalously High** y **Anomalously Low** comparan cada tabla con su propio valor habitual para esa hora de la semana. Estas métricas son datos operativos propios de OneUptime y no se facturan como telemetría.

## Tablas sin uso

Cada motor que cuenta lecturas dice cuándo se leyó por última vez cada tabla: los escaneos de PostgreSQL, el performance_schema de MySQL, las búsquedas, escaneos y lookups de SQL Server, y el historial de consultas de Redshift, ClickHouse y Databricks. También cuenta una lectura vista en los spans de base de datos de tus servicios.

**Tablas sin uso** enumera las tablas que nadie ha leído en 90 días, de la más grande a la más pequeña, con la última vez que se escribió cada una: una tabla que se sigue escribiendo pero nunca se lee cuesta sus escrituras y su almacenamiento. Un contador a 0 en la primera recopilación de una tabla significa que no se ha leído desde que empezaron las estadísticas del motor, así que una tabla sin uso aparece como sin uso desde el principio.

## Gasto del almacén

Una vez por hora, Observabilidad de datos lee lo que cada almacén de Snowflake y BigQuery gastó en el último día, trabajo por trabajo: los créditos de cómputo de Snowflake, de `QUERY_ATTRIBUTION_HISTORY`, y los bytes facturados de BigQuery, de su vista de trabajos, que necesita **BigQuery Resource Viewer**. Un trabajo es una consulta que se ejecuta una y otra vez, nombrada por su etiqueta de consulta o label, o por lo que hace y la tabla que escribe: nunca por el texto de la consulta.

**Gasto del almacén** muestra los totales por equipo (el `team` de la etiqueta o label de un trabajo, o quien lo ejecuta), las tablas cuyas escrituras cuestan más, los trabajos que fallaron y lo que se gasta en trabajos que solo escriben tablas que nadie ha leído en 90 días.

## Servicios que usan cada tabla

La pestaña **Servicios** de una tabla enumera los servicios que se han visto escribiéndola y leyéndola, con las sentencias que ejecutó cada uno, sus llamadas y fallos de la última hora y la última vez que se vio. Sale de los spans de base de datos que tus servicios ya envían con OpenTelemetry: un span de cliente con `db.system.name`, `db.namespace` y `db.collection.name`. No hay nada más que instalar.

Un span solo se vincula a una tabla cuando su base de datos es una de las que leyó una recopilación y, cuando dos bases de datos comparten nombre, solo cuando su `server.address` es la de una de ellas.

## Próximos pasos

:::cards
- [Comprobaciones y conciliaciones](/docs/data-observability/checks): Reglas sobre lo que contiene una tabla, más allá de si cambia.
- [Linaje y pipelines](/docs/data-observability/lineage-and-pipelines): De dónde vienen los datos de una tabla que llega tarde, y la ejecución que debería haberla cargado.
:::
