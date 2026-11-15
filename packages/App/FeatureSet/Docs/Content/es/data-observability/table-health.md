# Salud de las tablas

Cada cinco minutos, el catálogo de cada base de datos conectada dice cómo está cada tabla: cuándo cambió por última vez, cuántas filas contiene, cuánto ocupa y cuáles son sus columnas. Observabilidad de datos aprende con eso el ritmo de cada tabla, y avisa cuando una tabla llega tarde, se reduce o cambia de estructura, sin ningún umbral que configurar.

## Qué se lee

Para cada tabla y vista:

- **El recuento de filas y el tamaño**, de las propias estadísticas del motor.
- **Cuándo cambió por última vez**: la marca de tiempo del propio motor donde guarda una, o el momento en que sus contadores de escritura, sus filas o sus bytes se movieron entre dos recopilaciones.
- **Sus columnas**, con sus tipos y si pueden estar vacías.
- **Cuándo se leyó por última vez**, donde el motor cuenta las lecturas.

Solo se lee el catálogo y, en MongoDB, los nombres de campo de los documentos más recientes de una colección. Ningún valor sale de la base de datos.

## Frescura

El **ritmo** de una tabla es la frecuencia con la que suele cambiar, aprendida a partir del tiempo entre sus cambios. Una tabla que supera con creces su ritmo aparece como **Con retraso**, en su página y en **Tablas**, e indica cuánto lo ha superado. Su frescura se conoce en cuanto ha cambiado dos veces: una tabla que se carga cada hora se aprende en unas horas, una que se carga cada noche en unos días.

Una vista no tiene filas propias, así que su frescura es la de sus fuentes: consulta [Linaje y pipelines](/docs/data-observability/lineage-and-pipelines).

Un catálogo puede decir que una tabla cambió cuando solo cambió su mantenimiento interno, o no decir nada. En los **Ajustes** de una tabla, indica una **Columna de frescura** como `updated_at`, y su último cambio pasa a ser el valor más reciente de esa columna. El usuario necesita leer la columna, y se lee en cada recopilación, así que debería estar indexada; en BigQuery y Athena, que facturan por lo que lee una consulta, se lee una vez por hora. Las horas sin zona se toman como UTC.

## Cambios de volumen y de esquema

- Las **Filas** se comparan entre recopilaciones: una tabla que pierde la mitad de sus filas, o que tiene muchas menos de lo habitual para esa hora de la semana, lo indica.
- Las **Columnas** también se comparan. Una columna añadida, eliminada, renombrada, con otro tipo o que pasa a admitir nulos aparece en la **Cronología** de la tabla y en **Cambios de esquema**, que enumera todos los cambios de todas las bases de datos, del más reciente al más antiguo. Una columna eliminada, renombrada o con otro tipo rompe lo que la lee, y puede alertar. Una añadida no rompe nada, y se queda en la cronología.
- Las **Tablas eliminadas** se conservan en **Tablas eliminadas**, con la última vez que se vieron, y vuelven con su historial si la tabla reaparece.

## Alertas recomendadas

En **Bases de datos**, elige **Alertas recomendadas** para una base de datos. Cada recomendación es un único monitor de métricas para toda la base de datos que alerta una vez por tabla, de modo que también se vigila una tabla creada más tarde:

| Alerta | Se dispara cuando |
| --- | --- |
| **Table Is Late** | Una tabla lleva quince minutos pasada de la hora a la que suele cambiar |
| **Row Count Fell Sharply** | Una tabla pierde la mitad de sus filas o más entre dos recopilaciones |
| **Row Count Unusually Low** | Una tabla tiene muchas menos filas de lo habitual para esa hora de la semana (aprendido durante dos semanas) |
| **Schema Changed** | Se eliminan, renombran o cambian de tipo columnas de una tabla |
| **Table Health Stopped Reporting** | No se ha leído ninguna tabla de la base de datos en quince minutos |

Elige las gravedades, las políticas de guardia, los propietarios y las etiquetas al crearlas. A partir de ahí son monitores normales: edítalos, siléncialos o ponlos en una página de estado como cualquier otro.

Una recarga de datos o una migración no debería avisar a nadie. Indica la base de datos en **Data Observability Bases de datos** de un [evento de mantenimiento](/docs/scheduled-maintenance/index), o pon en él su servidor de base de datos, y sus alertas de datos permanecen en silencio mientras el evento esté activo.

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
| `oneuptime.data.table.breaking_schema_changes` | Columnas eliminadas, renombradas o con otro tipo desde la recopilación anterior |

Cada fila lleva `oneuptime.data.store.id`, `oneuptime.data.store.name`, `oneuptime.data.table.id`, `oneuptime.data.table.schema`, `oneuptime.data.table.name` y `oneuptime.data.table.key` (`schema.table`). Un [monitor de métricas](/docs/monitor/metrics-monitor) agrupado por `oneuptime.data.table.key` alerta una vez por tabla, y sus filtros **Anómalamente alto** y **Anómalamente bajo** comparan cada tabla con su propio valor habitual para esa hora de la semana. Estas métricas son datos operativos propios de OneUptime y no se facturan como telemetría.

## Tablas sin uso

Cada motor que cuenta lecturas dice cuándo se leyó por última vez cada tabla: los escaneos de PostgreSQL, el performance_schema de MySQL, las búsquedas, escaneos y lookups de SQL Server, y el historial de consultas de Redshift, ClickHouse y Databricks. También cuenta una lectura vista en los spans de base de datos de tus servicios.

**Tablas sin uso** enumera las tablas que nadie ha leído en 90 días, de la más grande a la más pequeña, con la última vez que se escribió cada una: una tabla que se sigue escribiendo pero nunca se lee cuesta sus escrituras y su almacenamiento. Un contador a 0 en la primera recopilación de una tabla significa que no se ha leído desde que empezaron las estadísticas del motor, así que una tabla sin uso aparece como sin uso desde el principio.

## Gasto del almacén

Una vez por hora, Observabilidad de datos lee lo que cada almacén de Snowflake y BigQuery gastó en el último día, trabajo por trabajo: los créditos de cómputo de Snowflake, de `QUERY_ATTRIBUTION_HISTORY`, y los bytes facturados de BigQuery, de su vista de trabajos, que necesita **BigQuery Resource Viewer**. Un trabajo es una consulta que se ejecuta una y otra vez, nombrada por su etiqueta de consulta o label, o por lo que hace y la tabla que escribe: nunca por el texto de la consulta.

**Gasto del almacén** muestra los totales por equipo (el `team` de la etiqueta o label de un trabajo, o quien lo ejecuta), las tablas cuyas escrituras cuestan más, los trabajos que fallaron y lo que se gasta en trabajos que solo escriben tablas que nadie ha leído en 90 días.

## Servicios que usan cada tabla

La pestaña **Servicios** de una tabla enumera los servicios que se han visto escribiéndola y leyéndola, con las sentencias que ejecutó cada uno, sus llamadas y fallos de la última hora y la última vez que se vio. Sale de los spans de base de datos que tus servicios ya envían con OpenTelemetry: un span de cliente con `db.system.name`, `db.namespace` y `db.collection.name`. No hay nada más que instalar.

Un span solo se vincula a una tabla cuando su base de datos es una de las que leyó una recopilación y, cuando dos bases de datos comparten nombre, solo cuando su `server.address` es la de una de ellas.

Cada servicio muestra además los endpoints que hacen sus llamadas, a partir del span de servidor de la misma traza, y se marca como **App de IA** cuando también llama a un modelo. **Errores que nombran esta tabla** enumera las excepciones abiertas y los registros de errores del último día de los servicios que escriben en la tabla, cuando la mencionan por su nombre.

## Propietarios y etiquetas

La pestaña **Propietarios** de una tabla indica las personas y los equipos a los que pertenece, y la alerta de una tabla les llega a ellos; si no tiene ninguno, a los propietarios de su base de datos. En los **Ajustes** de una tabla, ponle **Etiquetas** propias.

No deberías tener que hacerlo cientos de veces. Las **Reglas del propietario** y las **Reglas de etiquetas** se aplican a cada tabla cuando aparece por primera vez, según sus etiquetas, o según una expresión regular sobre su nombre, esquema o base de datos: todo lo que esté en `finance` va al equipo de finanzas, y todo lo que se llame `*_pii` recibe una etiqueta.

Un permiso limitado a `Owned` solo alcanza las tablas de las que son propietarios su titular o sus equipos, con sus comprobaciones, su actividad y los problemas notificados. Ser propietario de una base de datos no te hace propietario de sus tablas: usa una regla de propietarios para asignar una base de datos entera a un equipo.

## Cuando se abre una alerta

La alerta de una tabla tiene una tarjeta **Datos** que dice por qué ocurrió con más probabilidad, ordenado: una alerta anterior, una ejecución fallida, un despliegue de un servicio que escribe en ella, sus escrituras fallidas, una columna que cambió, la propia base de datos o el servidor en el que se ejecuta. Debajo está lo que depende de ella: tablas más abajo en su linaje, paneles, servicios y las personas que son sus propietarias.

Indica qué opinas de ella:

- **Useful**: tenía razón.
- **Expected**: un evento planificado. No cambia nada, y la siguiente también se genera.
- **No es un problema**: se le da más margen a la tabla, así que lo mismo se queda en silencio la próxima vez. El intervalo habitual de una tabla que llega tarde crece, y la tolerancia del recuento de filas se amplía.

Si una persona encuentra un problema antes, **Informar de un problema** en la tabla lo registra. Entonces **Vista general** muestra cómo le va a Observabilidad de datos en tu proyecto: problemas útiles por semana, cuántos no fueron ruido, cuántas tablas se leen, con qué frecuencia generó un problema antes de que alguien lo informara, con qué rapidez y con qué frecuencia su causa probable fue la real.

## Próximos pasos

:::cards
- [Comprobaciones y conciliaciones](/docs/data-observability/checks): Reglas sobre lo que contiene una tabla, más allá de si cambia.
- [Linaje y pipelines](/docs/data-observability/lineage-and-pipelines): De dónde vienen los datos de una tabla que llega tarde, y la ejecución que debería haberla cargado.
:::
