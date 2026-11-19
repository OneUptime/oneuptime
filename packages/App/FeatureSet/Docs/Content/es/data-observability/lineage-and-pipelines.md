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

En la parte superior de la pestaña, un diagrama dibuja ese linaje unos pasos en cada dirección (tres, o elige 1, 2 o 5): a la izquierda, aquello a partir de lo que se construye la tabla; a la derecha, las tablas y los paneles construidos a partir de ella; y los pipelines que cargan datos desde fuera, donde estos entran. Cada tarjeta dice cómo está ahora - retrasada, una alerta abierta, una ejecución fallida - y una flecha se vuelve roja cuando la última ejecución de su pipeline falló, así que una tabla retrasada puede seguirse hasta la ejecución que la detuvo. Abre cualquier tabla para centrar el diagrama en ella.

Una tarjeta dibuja como máximo diez tablas en cada dirección y cuenta el resto, por ejemplo **+14**. Selecciona el número para dibujar hasta diez más donde están, primero las que tienen problemas, con cada flecha entre ellas y lo que ya está dibujado. **Restablecer diagrama** vuelve al diagrama tal como se dibujó al principio. Cuando un lado tiene tantas tablas como caben en un diagrama, abre una tabla para centrar el diagrama en ella.

Cuando la fuente nombra columnas, la pestaña **Columnas** de una tabla indica de dónde viene cada columna y qué alimenta: el historial de acceso de Snowflake (edición Enterprise, que necesita `IMPORTED PRIVILEGES` sobre la base de datos `SNOWFLAKE`) y la faceta `columnLineage` de OpenLineage.

En la pestaña **Linaje**, elige una columna de la tabla en **Seguir una columna** para resaltar de dónde viene y adónde va: hacia arriba en el diagrama, hasta las columnas a partir de las que se construye; hacia abajo, hasta las columnas que se construyen a partir de ella, cada una nombrada en su tabla, incluso donde se renombró por el camino. Una flecha cuyas fuentes no nombran columnas puede llevarla más lejos de lo resaltado, y el diagrama lo indica.

Cada vista del linaje - la pestaña **Linaje** de una tabla, la de una canalización, la de una alerta, el **Mapa de linaje** y lo que dicen OneUptime AI y la API - muestra solo las tablas y canalizaciones que tu rol puede leer. Un rol limitado a lo que poseen sus miembros, o a algunas etiquetas, nunca ve otra tabla ni otra canalización: no se dibuja, no se nombra en ninguna flecha y no se cuenta entre las tablas más lejanas.

## Mapa de linaje

**Observabilidad de datos > Mapa de linaje** dibuja en una sola página cada flujo de datos que tu proyecto ha visto, para que veas quién usa qué datos y adónde van sin tener que elegir antes una tabla. Muestra:

- **Servicios** que escriben y leen tablas, a partir de los spans de base de datos de tus trazas: un span que nombra su tabla (`db.collection.name`, o el antiguo `db.sql.table`) y su sentencia (`db.operation.name`), como un `INSERT` o un `SELECT`.
- **Tablas** construidas a partir de otras tablas, de todas las fuentes anteriores.
- **Canalizaciones** que cargan una tabla a partir de datos que OneUptime no vigila, como una sincronización de Fivetran. Una canalización que mueve datos entre dos tablas vigiladas se nombra en la flecha que las une.
- **Paneles** y sincronizaciones de reverse ETL en tus herramientas de BI, que leen las tablas sobre las que están construidos, aunque nada más toque esas tablas. Un informe de Power BI que no está construido sobre ninguna tabla que OneUptime vigile se dibuja con los conjuntos de datos que representa y los orígenes de datos de los que se cargan; cuando ninguno de los paneles de una herramienta de BI está sobre una tabla vigilada, el mapa dice por qué ([Linaje de Power BI](#linaje-de-power-bi)).

Cada flecha es algo que OneUptime registró, nunca una suposición. Las tarjetas se colocan de izquierda a derecha según fluyen los datos e indican su estado como en el diagrama de una tabla: rojo para una tabla con retraso, una alerta abierta o una ejecución fallida. Una flecha es turquesa cuando las trazas de un servicio la vieron.

Busca una tabla, un servicio, una canalización o un panel para conservar lo que coincide y todo lo que está aguas arriba y aguas abajo. Selecciona una tarjeta para resaltar todo su linaje, ver de dónde viene y adónde va, y abrir su página; **Mostrar solo su linaje** deja solo eso en el mapa. Los interruptores junto a la búsqueda dejan fuera los servicios, las canalizaciones o los paneles. **Lista** muestra cada flecha como una línea, y es lo que abre un teléfono.

Un mapa dibuja hasta 400 tarjetas, empezando por los flujos vistos más recientemente; cuando tu proyecto tiene más, el mapa lo indica. El mismo mapa lo sirve `POST /api/data-observability/lineage/map`, para quien pueda leer los activos de datos, y sus claves de API. Un mapa con más dice cuántas tablas dejó fuera, cada una contada una vez, y puede empezar en otro sitio: elige una base de datos para trazar los flujos de sus tablas y las tarjetas que unen, o escribe un nombre y elige **Buscar en todo el proyecto** para trazar los flujos de cada tabla, canalización, servicio y panel cuyo nombre lo contenga, por antiguos que sean. **Mostrar todo el mapa** vuelve atrás. Para que el mapa de la API empiece en otro sitio, envía `{ "dataStoreId": "<database ID>" }` o `{ "search": "orders" }`.

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
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, una entidad de servicio autorizada a usar las API de administración de solo lectura de Power BI, con las dos configuraciones de inquilino sobre metadatos de [Linaje de Power BI](#linaje-de-power-bi) activadas para las tablas que hay detrás de cada informe. Se leen tanto los informes como los paneles, con sus vistas y actualizaciones (abajo) |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (o `eu`) |

Hightouch y Census son herramientas de ETL inverso: una sincronización que copia una tabla en un CRM depende de esa tabla igual que un panel, así que se lee del mismo modo y se nombra en las alertas de la tabla.

Solo se leen los nombres y enlaces de los paneles, las tablas que consultan y, en Power BI, quién los abre y cómo fueron sus actualizaciones: nunca sus datos.

### Vistas y actualizaciones en Power BI

Para cada informe y panel de Power BI, **Paneles de BI** muestra primero cuántas veces se abrió en los últimos 28 días, cuándo se abrió por última vez y cómo fue la última actualización de sus datos, con el error de una actualización fallida. Cuántas personas lo abrieron, quién lo abrió más y sus últimas actualizaciones son columnas que puede activar. La pestaña **Linaje** de una tabla dice lo mismo de cada panel construido sobre ella, con su propietario y sus espectadores en **Más**.

- Las **vistas** vienen del registro de actividad de Power BI, leído con su API de administración de eventos de actividad. Power BI guarda 28 días, responde 200 solicitudes por hora y divide cada solicitud en horas, así que OneUptime lo lee de hora en hora: cada lectura horaria añade las horas desde la anterior y luego recorre hacia atrás los 28 días, primero las más recientes, con 100 solicitudes como máximo. Una nueva herramienta de Power BI muestra enseguida los últimos días, y los 28 días en menos de un día; hasta entonces, las vistas indican desde cuándo se cuentan. Un evento puede tardar hasta una hora en llegar al registro, así que las vistas llevan hasta dos horas de retraso. Los espectadores se nombran como los nombra Power BI, por su dirección de correo electrónico.
- Las **actualizaciones** de los conjuntos de datos en una capacidad (Premium, Premium por usuario o Fabric) vienen de la lista de administración de elementos actualizables de Power BI: la última actualización de cada conjunto de datos con su error, y cuántas actualizaciones se ejecutaron y fallaron en los siete días que Power BI conserva.
- Las **actualizaciones de conjuntos de datos en capacidad compartida** no están en esa lista. Power BI muestra el historial de actualizaciones de un conjunto de datos solo a quienes pueden modificarlo, así que agregue la entidad de servicio a su área de trabajo como **Colaborador**, **Miembro** o **Administrador** y active para ella **Service principals can call Fabric public APIs** en la configuración para desarrolladores del portal de administración de Fabric. Entonces OneUptime lee cada actualización, con su error. Hasta entonces, la herramienta de BI indica de cuántos conjuntos de datos no pudo leer las actualizaciones.
- Un panel de Power BI cuyos iconos vienen de varios conjuntos de datos muestra la última actualización que falló o, si ninguna falló, la más antigua: sus datos solo son tan recientes como esa.

Las vistas, y las actualizaciones en capacidades, no necesitan nada más que el acceso a las API de administración de arriba: la entidad de servicio en un grupo de seguridad permitido por **Service principals can access read-only admin APIs**, sin permisos de Power BI en la aplicación que requieran el consentimiento de un administrador. Cuando no se pueden leer las vistas o las actualizaciones, los paneles se leen y se conservan igualmente, la herramienta de BI indica qué se omitió y por qué, y la siguiente lectura vuelve a intentarlo.

### Alertas de actualizaciones fallidas

Active **Alert on Failed Refreshes** al agregar o editar una herramienta de Power BI (una nueva empieza con la opción activada) y OneUptime mantiene un monitor para la herramienta en **Monitores**, con su nombre. El monitor abre una alerta por cada conjunto de datos cuya última actualización falló o se canceló, con el conjunto de datos y su área de trabajo en el título de la alerta, y la resuelve en cuanto se completa una actualización posterior. Un conjunto de datos publicado más tarde se vigila en cuanto se lee. Al desactivar el interruptor, o al quitar la herramienta, se elimina el monitor; hasta entonces es un monitor corriente, con sus propietarios, políticas de guardia y ventanas de mantenimiento.

Las actualizaciones fallidas no usan los monitores de pipelines. Un conjunto de datos cuya actualización falló sigue mostrando los datos de su última actualización completada hasta que se completa una posterior, así que su alerta sigue abierta hasta entonces, mientras que la alerta de una ejecución fallida se cierra una hora después de la ejecución. Y las actualizaciones se leen una vez por hora: una actualización leída hasta una hora después de terminar quedaría a menudo fuera de la hora que mira **Pipeline Run Failed**, un conjunto de datos actualizado cada media hora pasaría una y otra vez a **Pipeline Is Late**, y una actualización terminada pero aún no leída parecería **Pipeline Run Unusually Long**.

- Cada lectura horaria conserva los conjuntos de datos cuya última actualización terminada falló o se canceló. Cada cinco minutos, cada uno escribe `oneuptime.data.bi.refresh_failed`, 1 mientras falla y 0 durante la hora siguiente a que se complete una actualización posterior, y el monitor lo lee, de modo que un fallo abre una sola alerta, por muchas lecturas horarias que lo vean.
- Un fallo se detecta en la siguiente lectura horaria: su alerta se abre hasta una hora después de que falle la actualización, y se resuelve hasta una hora después de que se complete una actualización posterior.
- Una actualización que sigue en curso no cambia nada: la alerta de un conjunto de datos cuya actualización falló sigue abierta mientras se ejecuta su siguiente actualización, y solo se resuelve cuando se completa una actualización.
- En una capacidad, la lista de elementos actualizables de Power BI solo da la última actualización de cada conjunto de datos, así que una actualización que falló y a la que siguió otra completada dentro de la misma hora nunca se ve: para entonces los datos vuelven a estar al día.
- Los conjuntos de datos en capacidad compartida solo generan alertas donde sus actualizaciones se pueden leer (arriba), y un conjunto de datos cuyas actualizaciones no se pudieron leer conserva su alerta tal como estaba hasta que se puedan leer.

## Pipelines

Cada job, proyecto de dbt y sincronización aparece en **Canalizaciones**, con sus ejecuciones: cuándo empezó y terminó cada una, cuánto duró, qué intento fue donde el programador lo indica (el número de intento de Airflow) y el error de una ejecución fallida. Tras cinco ejecuciones, cada pipeline aprende de sus propias ejecuciones cuánto suele durar una ejecución y cuánto tiempo pasa entre ejecuciones según su programación. La página de un pipeline recomienda tres monitores:

- **Pipeline Run Failed**: una ejecución falló o se canceló.
- **Pipeline Run Unusually Long**: una ejecución ha tardado el doble de lo habitual o más, comprobado cada cinco minutos mientras se ejecuta, de modo que una ejecución que se cuelga se detecta antes de que termine.
- **Pipeline Is Late**: no ha empezado ninguna ejecución en más tiempo del que permite su programación.

La pestaña **Propietarios** de una canalización nombra a las personas y los equipos que se ocupan de ella, y sus alertas les llegan a ellos. La **Vista general** y **Problemas** nombran a los propietarios de una canalización que falló o va con retraso, o muestran **Sin propietario**, con una forma de añadir uno.

La página de un pipeline dibuja su **Linaje**, el primer sitio donde mirar cuando una ejecución falla o se retrasa: a la izquierda, las tablas que lee; a la derecha, las tablas que escribe; en medio, el pipeline; y cada tarjeta dice cómo está ahora. Elige más pasos para ver a partir de qué se construyen esas tablas y qué se construye a partir de ellas, y abre cualquier tabla para ver su propia pestaña **Linaje**. Un número de tablas sin dibujar, en la tarjeta del pipeline o en la de una tabla, dibuja más en su sitio aquí también. Elige una de las columnas que escribe para seguirla a través de la canalización: hacia arriba hasta la columna de cada tabla leída a partir de la que se construyó, y hacia abajo hasta cada tabla en la que la escribe.

## Una incidencia por causa

Cuando una tabla se queda desactualizada, todas las tablas construidas a partir de ella también. Antes de que se abra una alerta de datos, OneUptime busca en el linaje una alerta ya abierta sobre aquello a partir de lo que se construye su tabla o su pipeline: las tablas de origen, los pipelines que escriben en ellas y las bases de datos donde están, hasta cinco niveles hacia arriba. Si encuentra una, la nueva alerta es consecuencia de esa alerta:

- Empieza en estado **Reconocido**, para que nadie reciba dos avisos por un mismo problema, y se recupera sola en cuanto sus datos se recuperan.
- Su feed y su tarjeta **Datos** indican qué alerta la causó, y se une al episodio de la causa.

La tarjeta **Datos** de la causa enumera su **Impacto aguas abajo**: todas las alertas que causó. La tarjeta de una alerta de tabla también muestra los servicios que escriben en la tabla, con sus escrituras fallidas, y sus despliegues y otros cambios en el día anterior a la alerta.

Bajo la tarjeta **Datos**, la página de una alerta dibuja su **Linaje**: alrededor de su tabla, tal como lo dibuja la pestaña **Linaje** de la tabla, o alrededor de su pipeline. El camino hacia arriba hasta la alerta que la causó y hacia abajo hasta cada alerta que causó aparece resaltado - la tabla o el pipeline de la causa marcado como **Causa**, los de cada alerta causada como **Consecuencia** - y el resto se atenúa, así que quien la abre ve en qué punto de la cadena empezó el problema. Cuando la causa está en un pipeline dibujado sobre una flecha, la flecha dice **Causa** bajo el nombre del pipeline. Cuando la causa trata de una base de datos entera, o está más arriba de lo que alcanza el diagrama, la tarjeta lo dice con palabras. Una alerta de una comprobación sobre una sola columna, como una comprobación Porcentaje de nulos sobre `customer_id`, se abre con esa columna seguida junto a estos caminos, como en la pestaña **Linaje** de la tabla: de dónde viene y adónde va, nombrada en cada tabla. Elige allí otra columna de la tabla, o quítala para ver solo los caminos. **Explorar linaje** abre la pestaña **Linaje** de la tabla, o la página del pipeline. Una alerta causada por ella en una canalización dibujada en una flecha dice **Consecuencia** allí de la misma forma, y el selector de columnas ofrece primero la columna de la comprobación y después las demás columnas de la tabla en su propio orden.

Quien no puede ver la alerta que la causó no recibe ni la tarjeta **Datos** ni el linaje, y una alerta causada que no puede ver ni se resalta ni se cuenta.

## Linaje de Power BI

**Tablas encontradas**, en cada herramienta de BI, indica sobre cuántas tablas vigiladas están construidos sus paneles y, debajo, lo primero que impide que las demás coincidan. **See Why** enumera lo que encontró la última lectura y qué hacer: las bases de datos que leen sus paneles y que no están conectadas a OneUptime, cada una a un **Connect Database** de distancia, con su tipo y su dirección ya rellenados; las tablas que una base de datos conectada no vigila, que pueden haber quedado fuera de su examen o no haberse recopilado todavía; y los orígenes que no son una base de datos, como archivos y páginas web. En Power BI también nombra una configuración de inquilino que está desactivada, los conjuntos de datos que leen de flujos de datos y los conjuntos de datos que Power BI no puede describir. **Basado en**, en cada panel, indica los conjuntos de datos que representa y de dónde vienen sus datos, tal como lo dice Power BI.

OneUptime lee cada conjunto de datos de Power BI del examen de metadatos de Power BI, con la consulta de Power Query que hay detrás de cada una de sus tablas:

- **La base de datos que nombra un conector**: SQL Server y Azure SQL (`Sql.Database`), PostgreSQL, MySQL, Oracle, Amazon Redshift, Snowflake, Google BigQuery, Databricks, Amazon Athena y Microsoft Dataverse, y el esquema y la tabla que elige su navegación.
- **El SQL que ejecuta una consulta**: la opción **SQL statement** de un conector, `Value.NativeQuery` y `Odbc.Query`, y las tablas que siguen a cada `FROM` y `JOIN`.
- **Parámetros y consultas compartidas**: un parámetro vale dondequiera que se nombre, y una tabla que lee una consulta de almacenamiento provisional lee lo que lee esa consulta.
- **Los modelos compuestos** representan las tablas de los conjuntos de datos sobre los que están construidos.

Un informe representa las tablas de su conjunto de datos, y un panel las de los conjuntos de datos de sus iconos. De dónde vienen los datos - el servidor y el nombre de una base de datos, la ruta de un archivo, una dirección web - sale de los orígenes de datos del examen, que no necesitan nada más que el acceso a las API de administración de arriba.

Power BI devuelve las tablas de un conjunto de datos solo cuando un administrador de Fabric activa dos configuraciones de inquilino en el portal de administración, en **Tenant settings > Admin API settings**, para el grupo de seguridad que contiene la entidad de servicio:

- **Enhance admin APIs responses with detailed metadata**: las tablas de cada conjunto de datos.
- **Enhance admin APIs responses with DAX and mashup expressions**: las consultas que las cargan, que dicen qué tablas de base de datos leen.

Después, Power BI describe un conjunto de datos una vez que se ha actualizado o vuelto a publicar; uno que solo usa DirectQuery, una vez que alguien ha abierto un informe sobre él. Nunca describe conjuntos de datos en tiempo real, conjuntos de datos con conexión dinámica a Analysis Services, libros de Excel ni conjuntos de datos de más de 1 GB en capacidad compartida.

Cada tabla se asocia con una tabla vigilada por su nombre, su esquema y su base de datos, y un servidor por su nombre corto o por el completo. Una tabla de otro motor nunca se asocia, ni tampoco una de otra base de datos: un informe sobre `Sales.dbo.Orders` no se vincula con `Archive.dbo.Orders` porque solo `Archive` está vigilada.

Las [actualizaciones](#vistas-y-actualizaciones-en-power-bi) se leen aparte de las tablas: un aviso de que no se pudieron leer las actualizaciones de algunos conjuntos de datos no dice nada de sus tablas.

## Antes de que se fusione un cambio

Cuando una pull request cambia una tabla vigilada, [Production Review](/docs/ai/ai-agent) indica en la pull request qué depende de ella: los servicios que la leen, las tablas construidas a partir de ella, los paneles sobre ella y sus productos de datos. Una tabla con una copia en una base de datos marcada como Staging también indica en qué se diferencia la copia: sus filas, sus columnas y lo que leen allí las comprobaciones de la tabla, ejecutadas al momento. En una base de datos a la que solo llega una sonda, las comprobaciones se omiten, y lo indica.

## Próximos pasos

:::cards
- [Productos de datos](/docs/data-observability/data-products): SLA de frescura sobre las tablas que usa la gente.
- [OneUptime AI y la API](/docs/data-observability/ai-and-api): Investigaciones que parten de quienes escriben en una tabla y de sus ejecuciones. En Preguntar a la IA y desde agentes de IA se puede preguntar a partir de qué se construye una tabla.
:::
