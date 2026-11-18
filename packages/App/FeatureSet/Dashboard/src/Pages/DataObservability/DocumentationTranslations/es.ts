/*
 * The Data Observability Documentation page in Spanish: the
 * English text of Pages/DataObservability/Documentation.tsx, translated. Its
 * code, field names, metric names and product names are as the English
 * writes them, and it names what the product draws as the Dashboard's
 * Spanish words it. Change it with the English, in the same pull
 * request (DataObservabilityDocumentationInLocale).
 */
const DOCUMENTATION: string = `
## Qué vigila Data Observability

Cada tabla y cada vista de cada base de datos conectada, cada cinco minutos:

- **Número de filas y tamaño**, según las estadísticas propias del motor.
- **Cuándo cambió por última vez**: MySQL y SQL Server lo indican; en PostgreSQL, OneUptime vigila los contadores de inserciones, actualizaciones y eliminaciones y anota cuándo se mueven.
- **Sus columnas**: una columna añadida, eliminada, renombrada, con otro tipo o convertida en nullable aparece en la cronología de la tabla y en Cambios de esquema.
- **Su ritmo habitual**: con qué frecuencia suele cambiar. Una tabla que se pasa claramente de su ritmo aparece como **Con retraso**.

Solo se lee el catálogo de la base de datos y, en MongoDB, los nombres de campo de los documentos más recientes de una colección. Ningún valor sale de la base de datos.

Un catálogo puede decir que una tabla cambió cuando solo cambió su mantenimiento interno, o no decir nada. En los **Ajustes** de una tabla, indica una **Columna de frescura** como \`updated_at\`, y su último cambio pasa a ser el valor más reciente de esa columna. El inicio de sesión necesita poder leer la columna, y conviene que esté indexada.

Una réplica de lectura de PostgreSQL o SQL Server no mueve sus contadores de escritura, así que OneUptime los deja fuera allí y lo indica en la base de datos.

## La vista general

La **Vista general** dice cómo están tus datos ahora. Hasta que el proyecto está configurado, enumera los pasos que faltan: alertas en cada base de datos, propietarios para las tablas, una comprobación y las ejecuciones de tus canalizaciones. **Pendiente** enumera lo que necesita a alguien, lo más grave primero: una base de datos que no se pudo leer, una ejecución de canalización que falló o va con retraso, una comprobación que falla o no se pudo ejecutar, una conciliación que se desvió, y un producto de datos o una tabla con retraso. Cada elemento dice a quién pertenece y si su alerta está abierta, o que no se avisa a nadie porque su base de datos no tiene ninguna alerta activada, y abre la página donde se corrige. **Bases de datos** muestra cómo fue la última lectura de cada base de datos y si sus alertas están activadas. El número junto a **Vista general** en el menú cuenta lo que necesita a alguien, y **Problemas**, justo debajo, los lista todos, una página cada vez, filtrados por tipo, base de datos, propietario (o **Sin propietario**) y si hay una alerta abierta. Cada número de la **Vista general** abre su lista: **Pendiente** abre **Problemas**, **Tablas con retraso** abre **Tablas** mostrando solo las que van con retraso, y **Comprobaciones fallando** abre **Comprobaciones** mostrando solo las que fallan.

## Conectar una base de datos

Usa un **inicio de sesión de solo lectura**. En la vista general o en Bases de datos, elige **Conectar una base de datos** y luego una de estas opciones:

- **OneUptime se conecta**: pega una cadena de conexión. Se guarda cifrada y no se vuelve a mostrar.
- **Una sonda de mi red se conecta**: elige una de las sondas de este proyecto e indica la variable de entorno de la sonda que contiene la cadena de conexión (por ejemplo \`ORDERS_DB_URL\`). La cadena de conexión nunca sale de tu red. Actualiza antes la sonda a la última versión.

Una base de datos ya conectada para Seguridad de datos también se vigila.

**Bases de datos que podrías conectar**, en la misma página, enumera lo que tu proyecto ya conoce y nadie ha conectado: bases de datos con las que hablan tus trazas, las de tus cuentas en la nube y las que vigila el Monitoreo de bases de datos. **Conectar** rellena el formulario con lo que se sabe de cada una. No se lee nada hasta que la conectas.

## Rutas de almacenamiento

Una exportación que llega cada noche a un bucket puede ir con retraso, o llegar incompleta, como cualquier tabla. En **Rutas de almacenamiento**, elige **Editar rutas** para un bucket que haya encontrado tu conexión a la nube, en Amazon S3, Google Cloud Storage o una cuenta de almacenamiento de Azure, e indica las rutas que importan, una por línea. Cada una aparece en **Tablas**: su objeto más reciente marca cuándo cambió por última vez, sus objetos son sus filas y se aplican las mismas alertas. Solo se leen nombres, tamaños y fechas, nunca un objeto.

### Un inicio de sesión de solo lectura, por motor

PostgreSQL:

\`\`\`sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
\`\`\`

MySQL y MariaDB (\`performance_schema\` permite a OneUptime ver las escrituras entre recopilaciones):

\`\`\`sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
\`\`\`

SQL Server (\`VIEW DATABASE STATE\` permite a OneUptime leer los tamaños y las últimas actualizaciones):

\`\`\`sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
\`\`\`

Amazon Redshift: conéctate con una cadena de conexión de PostgreSQL al endpoint del clúster o del grupo de trabajo, por ejemplo \`postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require\`. \`SYSLOG ACCESS UNRESTRICTED\` permite a OneUptime leer el número de filas y los tamaños (\`svv_table_info\`), las últimas escrituras y lecturas de las consultas de cada usuario (\`stl_insert\`, \`stl_delete\`, \`stl_scan\`, que se guardan unos días) y el linaje de las consultas de cada usuario. Sin él, el cambio de las filas de una tabla sigue indicando cuándo cambió.

\`\`\`sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
\`\`\`

Snowflake: crea un usuario con un par de claves (sin contraseña) y conéctate con un JSON que indique el identificador de la cuenta, el usuario, la clave privada (PKCS#8 sin cifrar), la base de datos y un almacén para las comprobaciones:

\`\`\`json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
\`\`\`

La recopilación lee el catálogo con SHOW, que no necesita almacén, así que no cuesta créditos. Solo las comprobaciones de datos se ejecutan en el almacén, con la programación que les des. Snowflake no indica el último cambio de ninguna tabla, así que una tabla cambió cuando se movieron sus filas o sus bytes.

\`\`\`sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
-- Warehouse spend reads SNOWFLAKE.ACCOUNT_USAGE.
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
-- Checks read rows: SELECT on the tables they check.
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
\`\`\`

Google BigQuery: cada conjunto de datos que encontró tu conexión de Google Cloud ya se vigila, con la cuenta de servicio de esa conexión, sin nada que conectar. Da a la cuenta de servicio **BigQuery Metadata Viewer** y **BigQuery Job User** en el proyecto, y **BigQuery Data Viewer** en las tablas que leen tus comprobaciones. Cada recopilación lee \`__TABLES__\` del conjunto de datos (filas, bytes y último cambio, sin coste) y su \`INFORMATION_SCHEMA.COLUMNS\` (facturado con el mínimo de 10 MB de BigQuery). Añade **BigQuery Resource Viewer** en el proyecto para el linaje de sus trabajos, que se lee una vez por hora (consulta El linaje que dan las bases de datos). Para conectar un conjunto de datos sin conexión de Google Cloud, elige **Google BigQuery** e indica un JSON con una clave de cuenta de servicio:

\`\`\`json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
\`\`\`

ClickHouse: conéctate por su interfaz HTTP, puerto 8443 con TLS (ClickHouse Cloud) o 8123 sin él, por ejemplo \`clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics\`. Indica una base de datos para vigilar solo esa; omítela para vigilar todas las bases de datos menos las del propio servidor. \`system.parts\` permite a OneUptime ver cada inserción entre recopilaciones (una fusión no cuenta), \`system.part_log\`, donde el servidor lo lleva, da la hora de cada inserción, y \`system.query_log\` da la última lectura de cada tabla y el linaje de \`INSERT ... SELECT\`, una vez por hora. Cada sentencia se ejecuta con \`readonly\` activado, así que ni siquiera un inicio de sesión que pudiera escribir puede hacerlo.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
-- Checks read rows: SELECT on the tables they check.
\`\`\`

Databricks: un catálogo de Unity Catalog es una base de datos. Sus esquemas, tablas, vistas y columnas, y el último commit de cada tabla Delta, se leen con la API REST de Unity Catalog sin almacén SQL, así que la recopilación no cuesta cómputo. Las comprobaciones de datos, y el linaje, las últimas escrituras y las últimas lecturas de la tabla del sistema \`system.access.table_lineage\` (una vez por hora), se ejecutan en el almacén SQL que indiques. Conéctate con una entidad de servicio (o un token de acceso personal en lugar de \`clientId\` y \`clientSecret\`: \`"token": "dapi..."\`):

\`\`\`json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
\`\`\`

\`\`\`sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE SCHEMA ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE CATALOG ON CATALOG system TO \`oneuptime-reader\`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO \`oneuptime-reader\`;
-- Checks read rows: SELECT on the tables they check. And CAN USE on the SQL warehouse.
\`\`\`

Oracle: conéctate con \`oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1\`, o con un JSON \`{ "user", "password", "connectString" }\`. Se lee con el protocolo propio de Oracle, sin cliente de Oracle que instalar. El inicio de sesión ve las tablas que puede leer: concede \`READ\` en cada tabla que quieras vigilar (puede consultarlas, nunca bloquearlas ni cambiarlas). \`SELECT_CATALOG_ROLE\` permite a OneUptime leer el tamaño de cada tabla; sin él, solo las tablas propias del inicio de sesión tienen tamaño. \`ALL_TAB_MODIFICATIONS\` indica las inserciones, actualizaciones y eliminaciones de cada tabla desde sus últimas estadísticas, y cuándo cambió por última vez.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
\`\`\`

Amazon Athena: una base de datos de Glue es una base de datos. Sus tablas y vistas, sus columnas y estadísticas, y el último commit de cada tabla Iceberg vienen de la API de Glue Data Catalog, que no lee datos y no cuesta nada; las comprobaciones se ejecutan como consultas de Athena en el grupo de trabajo que indiques. Conéctate con las claves de un usuario o rol de IAM que pueda leer la base de datos de Glue y ejecutar consultas de Athena:

\`\`\`json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
\`\`\`

Necesita \`glue:GetDatabase\` y \`glue:GetTables\` en la base de datos y sus tablas, y para las comprobaciones \`athena:StartQueryExecution\`, \`athena:GetQueryExecution\`, \`athena:GetQueryResults\` y \`athena:StopQueryExecution\` en el grupo de trabajo, con acceso de lectura a los datos de S3 de las tablas y de escritura a la ubicación de salida.

MongoDB: conéctate con su cadena de conexión - \`mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/\`, o \`mongodb://\` con los hosts de un conjunto de réplicas. Una base de datos en la ruta es la única que se vigila; sin ella, se vigila cada base de datos que el inicio de sesión puede leer. Los documentos, el tamaño y las escrituras de cada colección vienen de \`$collStats\`, y cuándo recibió un documento por última vez, de su \`_id\` más reciente. Sus campos vienen del esquema JSON de su validador o, si no, de los nombres y tipos de los campos de sus 100 documentos más recientes, calculados en la base de datos para que ningún valor salga de ella. Los documentos se leen en un secundario cuando lo hay. La colección de origen de una vista es linaje, y una comprobación personalizada es un pipeline de agregación, en JSON.

\`\`\`javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
\`\`\`

Para vigilar solo una base de datos, concede \`{ role: "read", db: "orders" }\` en lugar de \`readAnyDatabase\`.

Microsoft Dataverse: un entorno es una base de datos, con sus tablas en \`dbo\`, como las nombra su endpoint SQL. OneUptime inicia sesión como una aplicación: registra una en Microsoft Entra ID con un secreto de cliente y añádela al entorno como usuario de aplicación (Power Platform admin center > the environment > Settings > Users + permissions > Application users) con un rol de seguridad que pueda leer las tablas. Conéctate con un JSON o con una cadena de conexión de Dataverse que indique \`AuthType=ClientSecret\`. El inquilino se puede omitir: el entorno dice en cuál está.

\`\`\`json
{ "environmentUrl": "https://contoso.crm.dynamics.com", "tenantId": "...", "clientId": "...", "clientSecret": "..." }
\`\`\`

Cada cinco minutos, la Web API da la definición de cada tabla, sus filas, de la instantánea que Dataverse toma una vez al día (así que van con hasta un día de retraso), y su \`modifiedon\` más reciente, que es cuándo cambió por última vez. Sus columnas se leen una vez por hora. Cada lectura cuenta para los límites de solicitudes de Dataverse de la aplicación, y una recopilación a la que se pide ir más despacio deja el resto para la siguiente. Un entorno tiene cientos de tablas propias, así que solo se vigilan las tablas de negocio principales (cuentas, contactos, clientes potenciales, oportunidades, ofertas, pedidos, facturas, productos, casos, correos electrónicos, llamadas de teléfono, citas, tareas y notas) y tus propias tablas personalizadas. Las tablas de las aplicaciones de Microsoft (\`msdyn_\`, \`adx_\` y los demás prefijos \`ms\`) quedan fuera: indica cualquier otra tabla que quieras vigilar, como en \`"tables": ["msdyn_workorder"]\`.

Las comprobaciones de datos se ejecutan como SQL de solo lectura en el endpoint TDS del entorno, en el puerto 1433 o 5558. Está activado salvo que un administrador lo haya desactivado; donde el control de acceso por usuario está activado para él, el rol de la aplicación necesita el privilegio **Allow user to access TDS endpoint**. Su SQL no tiene expresiones regulares, ni \`WITH\`, ni muestreo.

## Las métricas que escribe cada tabla

Cada recopilación las escribe para cada tabla, para que puedas representarlas en gráficos, ponerlas en paneles y crear alertas sobre ellas como con cualquier otra métrica:

| Métrica | Qué es |
| --- | --- |
| \`oneuptime.data.table.row_count\` | Filas de la tabla |
| \`oneuptime.data.table.size\` | Bytes que ocupan la tabla y sus índices |
| \`oneuptime.data.table.seconds_since_change\` | Segundos desde que se insertó, actualizó o eliminó una fila por última vez |
| \`oneuptime.data.table.overdue_seconds\` | Segundos que la tabla lleva pasada del momento en que suele cambiar; 0 mientras va a tiempo. Se escribe en cuanto se aprende su ritmo |
| \`oneuptime.data.table.row_count_change_percent\` | Cuánto se movió el número de filas desde la recopilación anterior, en porcentaje (-50 es la mitad de las filas perdidas). Se excluyen las tablas de menos de 1000 filas |
| \`oneuptime.data.table.schema_changes\` | Columnas cambiadas desde la recopilación anterior |
| \`oneuptime.data.table.breaking_schema_changes\` | Columnas eliminadas, renombradas o con otro tipo desde la recopilación anterior |

Cada fila lleva \`oneuptime.data.store.id\`, \`oneuptime.data.store.name\`, \`oneuptime.data.table.id\`, \`oneuptime.data.table.schema\`, \`oneuptime.data.table.name\` y \`oneuptime.data.table.key\` (\`schema.table\`). Un monitor de métricas agrupado por \`oneuptime.data.table.key\` alerta una vez por tabla, y sus filtros **Anómalamente alto** y **Anómalamente bajo** comparan cada tabla con su propio valor habitual para esa hora de la semana, así que no hay que fijar ningún umbral.

## Alertas

Una base de datos que conectas se abre en sus **Alertas recomendadas**; más adelante, elígelas para ella en **Bases de datos**. Cada recomendación es un monitor de métricas para toda la base de datos que alerta una vez por tabla, así que una tabla creada más tarde también se vigila:

| Alerta | Se activa cuando |
| --- | --- |
| **La tabla va con retraso** | Una tabla sigue pasada del momento en que suele cambiar durante quince minutos - la misma regla que la etiqueta **Con retraso** |
| **El número de filas bajó mucho** | Una tabla pierde la mitad de sus filas o más entre dos recopilaciones |
| **Número de filas inusualmente bajo** | Una tabla tiene muchas menos filas de lo habitual para esa hora de la semana (aprende durante dos semanas) |
| **Esquema cambiado** | Se eliminan, renombran o cambian de tipo columnas de una tabla. Una columna añadida no rompe nada y queda en la cronología |
| **El estado de las tablas dejó de llegar** | No se ha leído ninguna tabla de la base de datos en quince minutos |

Elige las gravedades, las políticas de guardia, los propietarios y las etiquetas al crearlas. A partir de ahí son monitores normales: edítalos, silencialos o ponlos en una página de estado como cualquier otro.

Un backfill o una migración no debería avisar a nadie. Indica la base de datos en **Data Observability Bases de datos** en un evento de mantenimiento, o incluye en él su servidor de base de datos, y sus alertas de datos se quedan en silencio mientras dura el evento.

## Propietarios y etiquetas

La pestaña **Propietarios** de una tabla nombra a las personas y los equipos a los que pertenece, y las alertas de la tabla van a ellos; si no tiene, a los propietarios de su base de datos. Las **Reglas del propietario** y las **Reglas de etiquetas** se aplican a cada tabla en cuanto aparece por primera vez, según sus etiquetas o una expresión regular sobre su nombre, su esquema o su base de datos. Un permiso limitado a \`Owned\` solo alcanza las tablas que posee su titular o sus equipos, con sus comprobaciones, su actividad y los problemas notificados. Ser propietario de una base de datos no te hace propietario de sus tablas: usa una regla del propietario para dar a un equipo una base de datos entera.

## Cuando se abre una alerta

La alerta de una tabla tiene una tarjeta **Datos** que dice por qué ocurrió con más probabilidad, en orden: una alerta aguas arriba, una ejecución fallida, un despliegue de un servicio que escribe en ella, sus escrituras fallidas, una columna que cambió, la base de datos o el servidor en el que se ejecuta. Debajo está lo que depende de ella: tablas, paneles, servicios y las personas a las que pertenecen.

Di qué te pareció: **Útil**, **Esperado** (un evento planificado: no cambia nada) o **No es un problema** (la tabla recibe más margen, para que lo mismo no avise la próxima vez). Si una persona encuentra primero un problema, **Informar de un problema** en la tabla lo registra. La **Vista general** muestra el balance: alertas útiles por semana, cuántas no eran ruido, con qué frecuencia se detectó un problema antes de que alguien lo notificara, con qué rapidez, y con qué frecuencia la causa probable era la real.


## Productos de datos

Quienes usan los datos (analistas, finanzas, dirección, agentes de IA) piensan en lo que usan: «las tablas del panel de ingresos», no en bases de datos. Un producto de datos nombra esas tablas, con su propietario, sus consumidores y su SLA de frescura. Crea uno en **Productos de datos**. Su SLA es uno de estos, o ambos:
- **Fresco a una hora del día (UTC):** los datos de cada día llegan ese día, antes de esa hora. Desde esa hora, cada tabla debe haber cambiado ese día; hasta entonces, vale la carga de ayer. Una carga que siempre llega media hora tarde va con retraso esa media hora cada día.
- **Una antigüedad máxima:** el último cambio de ninguna tabla puede ser más antiguo que esto.

Cada cinco minutos se comparan las tablas de cada producto con su SLA. El producto está **Con retraso** cuando lo está alguna de sus tablas, y sus datos son del último cambio más antiguo entre ellas. Escribe \`oneuptime.data.product.late_tables\` y \`oneuptime.data.product.data_age\`, para que puedas representar la frescura de todos los productos uno al lado de otro.

Guardar un producto también crea, en tu nombre y con tus permisos:
- **Un monitor**, que es el producto en una página de estado. Está degradado mientras una tabla va con retraso, y abre un incidente y una alerta con la gravedad más baja de tu proyecto, que se resuelven solos. Añádelo a una página de estado, privada o pública, como recurso: los consumidores que se suscriben se enteran cuando el producto va con retraso y cuando vuelve a estar al día.
- **Un SLO** sobre ese monitor: la parte del tiempo en que los datos llegan a tiempo, frente al objetivo del SLA del producto en 30 días, con las alertas de tasa de consumo rápida y lenta con las que empieza cada SLO.

Eliminar el producto elimina ambos. Cada producto tiene además una **insignia** que dice de cuándo son sus datos, verde mientras van a tiempo y ámbar con «late» cuando no. Insértala en un panel de BI, una página de wiki o un README desde la vista general del producto. Su enlace no necesita iniciar sesión, así que trátalo como un enlace compartido; **Restablecer enlace de la insignia** crea uno nuevo y retira el anterior.

## Comprobaciones de los valores de una tabla

El estado de una tabla dice si cambia. Una **comprobación** dice si lo que contiene es correcto. Añade una en la pestaña **Comprobaciones** de una tabla:

| Comprobación | Qué lee |
| --- | --- |
| **Porcentaje de nulos** | Porcentaje de filas cuya columna está vacía |
| **Porcentaje de duplicados** | Porcentaje de valores que repiten el de otra fila |
| **Recuento de valores distintos** | Cuántos valores diferentes contiene la columna |
| **Mínimo**, **Máximo**, **Promedio**, **Suma** | De una columna numérica (la suma de ninguna fila es 0) |
| **Porcentaje de valores no válidos** | Porcentaje de valores fuera de una lista que tú das |
| **Porcentaje de formato incorrecto** | Porcentaje de valores que no tienen un formato que eliges, como Correo electrónico, UUID o Código de país, o que no coinciden con una expresión regular tuya (todos los motores salvo SQL Server) |
| **Recuento de filas huérfanas** | Filas cuyo valor no tiene coincidencia en la columna de otra tabla |
| **Número de filas** | Filas de la tabla, lo más útil con **Segmentar por** |
| **SQL personalizado** | El número que devuelve un SELECT de solo lectura tuyo |

Las **Comprobaciones sugeridas**, en la misma pestaña, ofrecen las comprobaciones que piden las columnas de una tabla, solo a partir de sus nombres y tipos:
- Un id es único.
- Un \`customer_id\` tiene una fila que coincide en \`customers\`.
- Un correo electrónico parece uno, y un importe no es negativo.
- Un estado mantiene sus valores habituales.
- Una tabla dividida por inquilino se cuenta por inquilino.

Añade una, añádelas todas o descarta una para siempre.

**Segmentar por** ejecuta una comprobación una vez por cada valor de una columna, como un inquilino o una región: una serie y una alerta para cada uno, para los 100 segmentos más grandes. Un número de filas segmentado alerta cuando un inquilino deja de enviar datos.

Las comprobaciones se ejecutan con la recopilación de la base de datos, por OneUptime o por su sonda, cada 15 minutos, cada hora, cada 6 horas o cada día. Cada una se ejecuta como una sola sentencia de agregación en una transacción de solo lectura con un tiempo de espera de sentencia: solo el número sale de la base de datos, salvo que un proyecto elija guardar una muestra enmascarada de filas con error. El valor se escribe como \`oneuptime.data.check.value\`, con \`oneuptime.data.check.id\`, \`oneuptime.data.check.name\` y \`oneuptime.data.check.segment\`.

Define **Alertar cuando** para alertar sobre una comprobación:
- **Inusualmente alto** o **Inusualmente bajo** compara cada valor con su propia referencia aprendida para esa hora de la semana.
- **Por encima de** o **Por debajo de** lo compara con un umbral.

Guardar la comprobación crea un monitor de métricas para ella, en tu nombre y con tus permisos. Vaciar la condición elimina el monitor.

**Filas con error** cuenta las filas que devuelve un SELECT de solo lectura tuyo: las filas que no deberían existir. 0 es que todo está bien.

Tres cosas mantienen bajo control el coste de una comprobación. **Porcentaje de muestra** lee una parte de las filas, para una comprobación que lee una tasa. **Máximo que puede leer una comprobación (GB)**, en **Ajustes**, detiene una comprobación en BigQuery o Athena antes de que lea más que eso. **Esperar cuando una base de datos está ocupada**, también allí, deja las comprobaciones pendientes para la siguiente recopilación cuando una base de datos PostgreSQL, MySQL o SQL Server parece ocupada.

**Guardar filas que fallan**, en **Ajustes**, guarda hasta 20 filas con error de una comprobación, con las columnas sensibles enmascaradas antes de salir de la base de datos. Está desactivado hasta que lo actives. Las filas se guardan en OneUptime, en los servidores de OneUptime con OneUptime Cloud y en los tuyos con una instalación propia, y desactivarlo las elimina.

Guarda las comprobaciones en un archivo de tu repositorio y aplícalas desde la CI con \`oneuptime data-checks apply checks.yaml\`. Ejecútalo con \`--dry-run\` en una pull request. Un error en cualquier parte del archivo hace que no se aplique nada. Consulta la documentación para ver el formato del archivo.


## Conciliaciones

Las copias se desvían: el almacén tiene menos pedidos que la base de datos de la aplicación, o una migración perdió filas. Una conciliación compara una medida de dos tablas, en una base de datos o en dos:
- **Número de filas**
- **Suma** de una columna
- **Recuento de valores distintos** de una columna
- **SQL personalizado**: una consulta de solo lectura que devuelve un número, llamado \`value\`.

Tiene una tolerancia, una cantidad **Absoluta** o un **Porcentaje** del valor del origen. Crea una en **Conciliaciones**.

Cada lado lo lee una comprobación de datos propia, que la conciliación crea y mantiene, con la recopilación de su base de datos: por OneUptime o por la sonda de la base de datos. Por eso una conciliación puede comparar una tabla de PostgreSQL de tu red con su copia en Snowflake o BigQuery. Sus comprobaciones aparecen en la pestaña Comprobaciones de cada tabla y solo se cambian desde la conciliación.

Los dos valores se comparan en cuanto ambos se han leído con menos de 15 minutos de diferencia, y luego se programa que ambos lados se vuelvan a leer juntos. Una conciliación escribe:
- \`oneuptime.data.reconciliation.drifted\`: 1 cuando los dos se han desviado más allá de la tolerancia, 0 cuando coinciden. Su monitor lo lee y alerta cuando se desvían.
- \`oneuptime.data.reconciliation.difference\`: el valor del destino menos el del origen.
- \`oneuptime.data.reconciliation.difference_percent\`: la diferencia como porcentaje del valor del origen.

Un lado cuya comprobación falla dice por qué. Una copia que se carga según una programación va por detrás de su origen: compara una medida en la que ambos ya se han asentado, como las filas de más de una hora, con SQL personalizado, o deja margen para el retraso en la tolerancia.

## Canalizaciones y linaje, desde OpenLineage

Airflow, Dagster, Spark, dbt y Flink describen cada ejecución de un trabajo con eventos de [OpenLineage](https://openlineage.io). Envíalos a OneUptime, sin cambios, con una clave de ingesta de telemetría (Ajustes del proyecto > Telemetría y APM > Claves de ingesta):

- **URL:** \`https://oneuptime.com/telemetry/openlineage\` (en un OneUptime propio, tu propia dirección)
- **Endpoint:** \`api/v1/lineage\`, el predeterminado de OpenLineage
- **Clave de API:** la clave de ingesta. Se envía como \`Authorization: Bearer\`, o define \`x-oneuptime-token\`.

Para el proveedor de OpenLineage de Airflow:

\`\`\`bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
\`\`\`

Para cualquier cliente de OpenLineage, define \`OPENLINEAGE_URL\` y \`OPENLINEAGE_API_KEY\`.

Cada trabajo aparece en **Canalizaciones**, con su última ejecución: cuándo empezó y terminó, cuánto duró y el error de una ejecución fallida. Una ejecución que lee y escribe tablas que vigila OneUptime se convierte en **linaje**: la pestaña **Linaje** de una tabla muestra las tablas a partir de las que se construye, las canalizaciones que escriben en ella con su última ejecución, y las tablas que se construyen a partir de ella.

Los conjuntos de datos se asocian a tablas según la especificación de nombres de OpenLineage: \`postgres://host:5432\` con \`database.schema.table\`, \`mysql://host:3306\` con \`database.table\`, \`sqlserver://host:1433\` y \`redshift://cluster:5439\` con \`database.schema.table\`, \`snowflake://account\` con \`database.schema.table\`, \`bigquery\` con \`project.dataset.table\`, \`clickhouse://host:8443\` con \`database.table\`, y \`databricks://workspace-host\` con \`catalog.schema.table\`.

Cada canalización aprende de sus propias ejecuciones cuánto suele durar una ejecución (la mediana de sus últimas 20 ejecuciones completadas) y cuánto pasa entre ejecuciones según su programación (el hueco más largo entre sus últimos 50 inicios que no sea algo puntual). Ambos se conocen tras cinco ejecuciones, y sirven tanto para un trabajo que se ejecuta cada cinco minutos como para uno nocturno. Cuando tu programador envía la faceta \`nominalTime\` de OpenLineage, como hace Airflow, la hora programada de una ejecución cuenta como su inicio, así que un backfill sigue leyéndose como la programación.

La página de una canalización recomienda tres monitores, cada uno creado con un clic:
- **Ejecución de la canalización fallida**: una ejecución falló o se abortó.
- **Ejecución de la canalización inusualmente larga**: una ejecución ha tardado el doble de lo habitual, o más. Se comprueba cada cinco minutos mientras la ejecución sigue en curso, así que una ejecución que se cuelga se ve antes de que termine.
- **La canalización va con retraso**: ninguna ejecución ha empezado en más tiempo del que permite la programación, con una cuarta parte del intervalo y al menos quince minutos de margen.

Leen estas métricas, cada una etiquetada con \`oneuptime.data.pipeline.id\` y \`oneuptime.data.pipeline.name\`:
- \`oneuptime.data.pipeline.run_failed\`: 1 o 0, al terminar cada ejecución.
- \`oneuptime.data.pipeline.run_duration\`: segundos, al terminar cada ejecución.
- \`oneuptime.data.pipeline.run_duration_ratio\`: el tiempo de la ejecución entre el de la ejecución habitual (contado como al menos un minuto), al terminar cada ejecución y cada cinco minutos mientras está en curso.
- \`oneuptime.data.pipeline.overdue_seconds\`: cuánto lleva la siguiente ejecución pasada de su programación, cada cinco minutos; 0 mientras va a tiempo.

La página de una canalización dibuja su **Linaje**, el primer sitio donde mirar cuando una ejecución falla o va con retraso: a la izquierda las tablas que lee, a la derecha las tablas que escribe, y cómo está cada una ahora. Elige más pasos para ver a partir de qué se construyen esas tablas y qué se construye a partir de ellas; un recuento de tablas no dibujadas, en la tarjeta de la canalización o de una tabla, dibuja más en su sitio. El mismo linaje está en \`POST /api/data-observability/pipelines/lineage\`, para tus propias herramientas. Elige una de las columnas que escribe para seguirla a través de la canalización: hacia arriba hasta la columna de cada tabla leída a partir de la que se construyó, y hacia abajo hasta cada tabla en la que la escribe. Para tus propias herramientas, envía \`"withColumns": true\` para las columnas que movieron sus ejecuciones.



## Sincronizaciones de Fivetran y Airbyte

Fivetran y Airbyte cargan tus tablas en bruto y no envían eventos de OpenLineage, pero sus webhooks dicen cuándo empieza y termina cada sincronización. Cada conector de Fivetran y cada conexión de Airbyte se convierte en una canalización en **Canalizaciones**, y cada sincronización en una ejecución, con el mismo historial de ejecuciones, la misma duración y programación aprendidas y las mismas alertas que cualquier canalización: una ejecución fallida, una inusualmente larga y una con retraso. **Canalizaciones > Conectar Fivetran o Airbyte** rellena las URL de abajo con una de tus claves de ingesta.

- **Fivetran:** crea un webhook con la API REST de Fivetran, para tu cuenta o un grupo de destino, con los eventos \`sync_start\` y \`sync_end\`. Su URL es \`https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>\`, y su secreto es esa clave de ingesta. Fivetran firma cada entrega con el secreto, así que la clave nunca viaja en la URL, y se rechaza una entrega que no esté firmada con ella.
- **Airbyte:** en los ajustes de notificación de tu espacio de trabajo, pon el webhook en \`https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>\` y actívalo para las sincronizaciones fallidas y las correctas. Airbyte no firma nada, así que su URL lleva la clave: dale a Airbyte una clave propia.

Una canalización se llama como la herramienta llama al conector o a la conexión, en \`fivetran://<destination group>\` o \`airbyte://<workspace>\`. La ejecución de una sincronización fallida muestra el error de la herramienta. Una sincronización de Fivetran que se reprograma por el límite de solicitudes de una API termina como **Reprogramada**: no es un fallo, así que no avisa a nadie, y su tiempo no enseña ninguna duración.

Un conector de Fivetran carga el esquema de su destino que lleva su nombre. Cuando exactamente una base de datos vigilada tiene ese esquema, sus tablas registran el conector como su escritor: una tabla que se queda desactualizada señala la sincronización que debería haberla cargado, y la alerta de una sincronización fallida es la causa de las alertas de las tablas (consulta Un problema por causa). Airbyte no nombra tablas.

## Paneles en herramientas de BI

El impacto real de los datos erróneos es el panel que alguien abre. En **Paneles de BI**, añade tus herramientas de BI con credenciales que puedan leer sus paneles:

| Herramienta | Credenciales (JSON) |
| --- | --- |
| **Metabase** | \`{ "apiKey": "mb_..." }\` (o el \`username\` y la \`password\` de un usuario) |
| **Superset** | \`{ "username": "...", "password": "..." }\` |
| **Tableau** | \`{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }\`, un token de acceso personal |
| **Looker** | \`{ "clientId": "...", "clientSecret": "..." }\`, un cliente de API |
| **Power BI** | \`{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }\`, una entidad de servicio que pueda usar las API de administración de Power BI |
| **Hightouch** | \`{ "apiKey": "..." }\`: cada sincronización se lee como una cosa más que depende de una tabla |
| **Census** | \`{ "apiKey": "...", "region": "us" }\`: cada sincronización se lee como una cosa más que depende de una tabla |

Cada hora, y cuando se añade una herramienta o eliges **Leer ahora**, OneUptime lee cada panel y las tablas que hay detrás: la tabla de una tarjeta y el SQL de una pregunta nativa (Metabase), la tabla de un conjunto de datos o el SQL de un conjunto de datos virtual (Superset), las tablas aguas arriba de la Metadata API (Tableau), el explore de cada mosaico (Looker) y el conjunto de datos de cada informe (Power BI, a partir de un análisis del área de trabajo). Cada tabla se asocia a una vigilada por su base de datos, su esquema y su nombre; un nombre que sigue encajando con dos tablas vigiladas queda sin asociar. La pestaña **Linaje** de una tabla, la tarjeta **Datos** de sus alertas y la Revisión de producción enumeran los paneles construidos sobre ella, y sobre las tablas construidas a partir de ella. Solo se leen nombres y enlaces, nunca los datos de un panel.

Una herramienta de Power BI también puede alertar de las actualizaciones fallidas de sus conjuntos de datos. Con **Alertar de actualizaciones fallidas** activado, como lo está para una herramienta que se añade ahora, OneUptime mantiene un monitor para la herramienta que abre una alerta por cada conjunto de datos cuya última actualización falló o se canceló, nombrado en el título de la alerta, y la resuelve en cuanto termina una actualización posterior. Lee \`oneuptime.data.bi.refresh_failed\`, etiquetada con \`oneuptime.data.bi.dataset.name\` y \`oneuptime.data.bi.workspace.name\`: cada cinco minutos, cada conjunto de datos que la lectura horaria encontró fallando escribe 1, y 0 durante la hora siguiente a que termine una actualización posterior. Una actualización que sigue en curso no cambia nada, así que un fallo es una alerta, por muchas lecturas horarias que lo vean.

## Trabajos en tus trazas

Un CronJob de Kubernetes, o una función con temporizador, no necesita nada instalado para aparecer como una canalización: los spans con \`k8s.cronjob.name\` o \`k8s.job.name\`, o \`faas.name\` con un \`faas.trigger\` de \`timer\` o \`datasource\`, se convierten en una, con sus ejecuciones y las tablas que tocaron sus llamadas a la base de datos. Cada ejecución enlaza a su traza y a sus logs, y un CronJob que deja de ejecutarse se ve como con retraso.

## El linaje que dan las bases de datos

El linaje no necesita una canalización que envíe OpenLineage. Cada base de datos da una parte por sí misma, y OneUptime la lee con la recopilación de la base de datos:
- **Vistas:** una vista se construye a partir de las tablas sobre las que está definida, en PostgreSQL, Redshift, MySQL 8 y SQL Server. Cuando una vista se redefine o se elimina, su linaje anterior se va con ella.
- **Historial de consultas:** una consulta que leyó una tabla y escribió otra, como una consulta programada, un modelo de dbt o un MERGE, también es linaje. Viene de los trabajos de BigQuery (la vista \`INFORMATION_SCHEMA.JOBS\` del proyecto y la ubicación del conjunto de datos, que necesita **BigQuery Resource Viewer**) y del registro de consultas de Redshift (\`stl_insert\` y \`stl_scan\`, que necesitan \`SYSLOG ACCESS UNRESTRICTED\`). Solo los trabajos ejecutados en el propio proyecto del conjunto de datos están en su vista de trabajos.

El linaje se lee una vez por hora, hasta la última lectura, y una semana hacia atrás en la primera recopilación de una base de datos, así que está ahí desde el principio. Una lectura de BigQuery se factura por las horas de trabajos que lee, casi siempre con el mínimo de 10 MB de BigQuery.

Cada arista de la pestaña **Linaje** de una tabla dice dónde se vio: en la ejecución de una canalización, en el historial de consultas (con un inicio de sesión cuyas consultas movieron los datos) o en la definición de una vista. El linaje de todas las fuentes cuenta para **Un problema por causa**.

En la parte superior de la pestaña **Linaje** de una tabla, un diagrama dibuja su linaje unos pasos en cada sentido (tres, o elige 1, 2 o 5): a la izquierda aquello a partir de lo que se construye, a la derecha las tablas y los paneles construidos a partir de ella, y las canalizaciones que cargan datos de fuera donde estos entran. Cada tarjeta dice cómo está ahora - con retraso, una alerta abierta, una ejecución fallida - y una flecha se pone roja cuando la última ejecución de su canalización falló, así que se puede seguir una tabla con retraso hasta la ejecución que la rompió. Abre cualquier tabla para centrar el diagrama en ella. Una tarjeta dibuja como mucho diez tablas en cada sentido y cuenta el resto, como **+14**: selecciona el recuento para dibujar las siguientes donde están, y **Restablecer diagrama** para volver. Donde las fuentes nombran columnas, elige una de las columnas de la tabla en **Seguir una columna** para resaltar de dónde viene y adónde va, incluso donde se renombra por el camino. El mismo linaje está en \`POST /api/data-observability/tables/lineage\`, para tus propias herramientas: envía \`"withColumns": true\` para las columnas de cada flecha, y pide a \`POST /api/data-observability/lineage/expand\` las siguientes tablas de una tarjeta. El linaje muestra solo las tablas y canalizaciones que tu rol puede leer: lo que no puedes leer nunca se dibuja, se nombra en una flecha ni se cuenta.

## dbt

Después de \`dbt build\` (o run, test, seed o snapshot), envía los artefactos del proyecto con la CLI y una clave de ingesta de telemetría. Lee \`target/manifest.json\` y \`target/run_results.json\` y envía solo lo que Data Observability lee de ellos:

\`\`\`bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
\`\`\`

En la CI, ejecuta \`oneuptime dbt upload\` como el paso posterior al build, incluso cuando el build falla, para que se registren las pruebas fallidas. Para un trabajo de dbt Cloud, descarga sus artefactos con la API de dbt Cloud y súbelos con \`--manifest\` y \`--run-results\`. O envíalos tú mismo: \`POST /telemetry/dbt/v1/artifacts\` con \`{ "manifest": ..., "run_results": ... }\` y la clave en \`x-oneuptime-token\`.

Qué hace cada subida:
- **Tablas:** cada modelo, seed, snapshot y fuente que es una tabla que vigila OneUptime recibe una tarjeta **dbt** en su vista general: el nodo, su materialización, su propietario, sus etiquetas y su último build. Su descripción de dbt rellena la descripción de la tabla cuando está vacía. Una tabla se asocia por su base de datos, su esquema y su nombre, para PostgreSQL, MySQL, SQL Server, Redshift, Snowflake, BigQuery, ClickHouse y Databricks. dbt no conoce el host, así que cuando dos bases de datos vigiladas comparten nombre, sus tablas quedan sin asociar, salvo que solo una de ellas contenga la tabla.
- **Linaje:** aquello a partir de lo que se construye cada modelo se convierte en linaje en la pestaña **Linaje** de la tabla, a través de la canalización del proyecto.
- **Pruebas:** cada prueba de una tabla vigilada aparece en su pestaña **Comprobaciones**, con su último resultado y las filas que encontró con error. Haz clic en **Alertar en caso de fallo** para que una prueba que falla abra una alerta.
- **Builds:** cada build es una ejecución de la canalización del proyecto en **Canalizaciones** (espacio de nombres \`dbt\`). Un build con un error o una prueba fallida es una ejecución fallida, así que las alertas de canalización también funcionan con los builds de dbt: fallida, inusualmente larga y con retraso.

## Tablas sin uso

Cada motor cuenta las lecturas de cada tabla en sus propias estadísticas:
- PostgreSQL: sus escaneos.
- MySQL: las lecturas de performance_schema.
- SQL Server: sus seeks, escaneos y lookups, con la hora del último.

Cada recopilación compara el contador con el último guardado, así que la **Última lectura** de una tabla se conoce con precisión de una hora, y también desde cuándo no ha tenido ninguna. Un contador en 0 en la primera recopilación de una tabla significa que no se ha leído desde que empezaron las estadísticas del motor, así que una tabla sin uso aparece sin uso desde el principio, no tras meses de vigilancia. También cuenta una lectura vista en los spans de base de datos de un servicio.

**Tablas sin uso** enumera las tablas que nadie ha leído en 90 días, las más grandes primero, con cuándo se escribió por última vez en cada una: una tabla en la que se sigue escribiendo pero que nunca se lee cuesta sus escrituras y su almacenamiento. La vista general muestra cuántas hay y qué contienen. Las vistas no llevan contadores propios, así que nunca aparecen. Cuando el inicio de sesión de la base de datos no puede leer los contadores, no se conoce la última lectura de una tabla.

## Gasto del almacén

Una vez por hora, con la recopilación de cada almacén, OneUptime lee lo que Snowflake y BigQuery gastaron en el último día, trabajo a trabajo: los créditos de cómputo de Snowflake de \`QUERY_ATTRIBUTION_HISTORY\` (con \`IMPORTED PRIVILEGES\` en la base de datos \`SNOWFLAKE\`, ejecutado en el almacén de la conexión) y los bytes facturados de BigQuery de su vista de trabajos (con **BigQuery Resource Viewer**). Un trabajo es una consulta que se ejecuta una y otra vez - la consulta parametrizada de Snowflake, la consulta de BigQuery sin sus literales - nombrada por su etiqueta de consulta o su label, o por lo que hace y la tabla que escribe, y nunca por el texto de su consulta.

**Gasto del almacén** muestra los créditos y los bytes facturados del día, por equipo (el \`team\` de la etiqueta de consulta o el label de un trabajo, si no quien lo ejecuta), las tablas cuyas escrituras cuestan más (el gasto de un trabajo repartido entre las tablas que escribe, donde ACCESS_HISTORY de Snowflake o la tabla de destino de BigQuery dicen cuáles), los trabajos que fallaron, y lo que se va en trabajos que solo escriben tablas que nadie ha leído en 90 días.

## Un problema por causa

Cuando una tabla se queda desactualizada, cada tabla construida a partir de ella se queda desactualizada también. Antes de que se abra una alerta de datos, OneUptime busca en el linaje una alerta ya abierta sobre aquello a partir de lo que se construye su tabla o su canalización: las tablas aguas arriba, las canalizaciones que escriben en ellas y las bases de datos en las que están, hasta cinco pasos hacia arriba. Cuando encuentra una, la nueva alerta es consecuencia de esa alerta:
- Empieza **reconocida**, para que no se avise a nadie dos veces por un mismo problema. Se recupera sola en cuanto lo hacen sus datos.
- Su feed dice qué alerta la causó, y también su tarjeta **Datos**.
- Se une al episodio de la causa, cuando la causa está en uno.

La tarjeta **Datos** de la causa enumera su **Impacto aguas abajo**: cada alerta que causó. La tarjeta de una alerta de tabla muestra además los servicios que escriben en la tabla, con sus escrituras fallidas, y sus despliegues y otros cambios en el día anterior a la alerta.

Bajo la tarjeta **Datos**, la página de una alerta dibuja su **Linaje**: alrededor de su tabla, como lo dibuja la pestaña **Linaje** de la tabla, o alrededor de su canalización, con resaltado el camino hacia arriba hasta la alerta que la causó y hacia abajo hasta cada alerta que causó, la causa marcada como **Causa** y cada alerta causada como **Consecuencia**. Cuando la causa está en una canalización dibujada sobre una flecha, la flecha dice **Causa** bajo el nombre de la canalización. Una alerta de una comprobación sobre una columna, como una comprobación Porcentaje de nulos sobre \`customer_id\`, se abre con esa columna seguida junto a estos caminos, como en la pestaña **Linaje** de la tabla; elige allí otra de las columnas de la tabla, o vacíala para ver solo los caminos. Quien no puede ver la alerta que la causó no recibe ni la tarjeta **Datos** ni el linaje, y una alerta causada que no puede ver no se resalta ni se cuenta. El mismo linaje está en \`POST /api/data-observability/alerts/<alert ID>/lineage\`, con la \`column\` que lee la alerta de una comprobación de columna y las columnas que lleva cada flecha. Una alerta causada por ella en una canalización dibujada en una flecha dice **Consecuencia** allí de la misma forma, y el selector de columnas ofrece primero la columna de la comprobación y después las demás columnas de la tabla en su propio orden.


## OneUptime AI

- **Investigaciones de alertas de datos.** Cuando OneUptime AI investiga una alerta sobre una tabla, una canalización o una base de datos, lee lo que tiene al lado: la frescura de la tabla y sus alertas abiertas, la alerta de la que es consecuencia, las ejecuciones de las canalizaciones que escriben en ella desde el día anterior (una ejecución fallida con su error), los servicios que escriben en ella con sus escrituras fallidas y sus despliegues y otros cambios, y su linaje: las tablas a partir de las que se construye y las tablas construidas a partir de ella, primero las que tienen un problema, con dónde está la alerta de la que es consecuencia y en qué tablas están las alertas que causó. Para una alerta de una comprobación sobre una columna, también sigue esa columna por el linaje: las columnas a partir de las que se construye aguas arriba y las columnas construidas a partir de ella aguas abajo, tabla por tabla. Nombra la ejecución, el despliegue o la tabla aguas arriba que hay detrás de la alerta.
- **Una comprobación a partir de una frase.** En la pestaña Comprobaciones de una tabla, **Escribir una comprobación a partir de una frase** convierte una regla como «los pedidos nunca tienen un total negativo» en una comprobación de SQL personalizado que cuenta las filas que la incumplen, con una alerta en cuanto haya alguna. Lees la consulta antes de que **Añadir comprobación** la añada, y se le aplica todo lo que se aplica a cualquier comprobación de SQL personalizado: una sola sentencia de solo lectura, ejecutada en una transacción de solo lectura.
- **¿Está al día esta tabla?** Pregunta a OneUptime AI en Preguntar a la IA, Slack o Microsoft Teams («¿está al día la tabla orders?»). Responde con la frescura de la tabla según su propio ritmo, cuándo cambió por última vez, sus alertas abiertas, las últimas ejecuciones de quienes escriben en ella y los productos de datos de los que forma parte. Los agentes de IA preguntan lo mismo con la herramienta \`get_data_table_freshness\` del servidor MCP, antes de usar los datos.
- **¿A partir de qué se construye esta tabla?** Pregunta de la misma forma («¿qué alimenta la tabla revenue?», «¿qué se rompe si raw.orders deja de cargarse?»). Sigue el linaje de la tabla tres pasos en cada sentido, o hasta cinco si se pide, y pone primero las tablas aguas arriba y aguas abajo que van con retraso, se eliminaron, tienen alertas abiertas o cuya canalización falló en su última ejecución, las más cercanas primero, con a cuántos pasos está cada una y las tablas intermedias; luego el resto, las canalizaciones que cargan sus fuentes desde fuera de lo que vigila OneUptime y los paneles de BI construidos sobre ella. Las alertas abiertas se cuentan, nunca se nombran, y solo las que puede ver quien pregunta. Los agentes de IA preguntan lo mismo con la herramienta \`get_data_table_lineage\` del servidor MCP, antes de cambiar una tabla. Cuenta una sola vez cada tabla más allá de lo que dice, por muchas tablas mencionadas que tenga al lado. Abierto en la página de una tabla, Preguntar a la IA sabe qué tabla es «esta tabla» y pregunta por esa, aunque varias bases de datos tengan una tabla con ese nombre. Como toda vista del linaje, solo habla de las tablas y canalizaciones que puede leer quien pregunta.

## Servicios que usan cada tabla

La pestaña **Servicios** de una tabla enumera los servicios que se han visto escribiendo y leyendo en ella, con las sentencias que ejecutó cada uno, sus llamadas y fallos en la última hora, y cuándo se vio por última vez. Viene de los spans de base de datos que tus servicios ya envían con OpenTelemetry: un span de cliente con \`db.system.name\`, \`db.namespace\` y \`db.collection.name\` (o \`db.sql.table\`, o un span con un nombre como \`INSERT orders\`). No hay nada más que instalar. Se actualiza cada 15 minutos.

Cada servicio muestra también los endpoints que hacen sus llamadas, y se marca como **App de IA** cuando también llama a un modelo. **Errores que nombran esta tabla** enumera las excepciones abiertas y los logs de error del último día de los servicios que escriben en la tabla, cuando la mencionan por su nombre.

Un span solo se vincula a una tabla cuando su base de datos es la que leyó una recopilación y, cuando dos bases de datos comparten nombre, solo cuando su \`server.address\` es una de las suyas. Cuando no está seguro, deja el span fuera.

Estas métricas son datos operativos propios de OneUptime y no se facturan como telemetría.
`;

export default DOCUMENTATION;
