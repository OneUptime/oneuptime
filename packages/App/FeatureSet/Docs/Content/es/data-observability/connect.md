# Conectar una base de datos

Observabilidad de datos lee cada base de datos con un usuario que solo lee su catálogo: qué tablas y vistas contiene, sus columnas, filas y tamaño, y cuándo cambiaron. Esta página indica lo mínimo que necesita cada motor, y cómo mantener la cadena de conexión dentro de tu red con una sonda.

## Antes de empezar

- **Un rol que pueda conectar bases de datos**: Propietario del proyecto, Administrador del proyecto o Administrador de telemetría.
- **Un usuario de solo lectura**, creado con las sentencias de abajo. Las comprobaciones que añadas más adelante leen filas de las tablas que comprueban, así que concede al usuario `SELECT` sobre esas tablas solo cuando añadas una.

## Elegir quién se conecta

En **Observabilidad de datos > Bases de datos**, elige **Connect a Database** y luego:

- **OneUptime connects**: pega una cadena de conexión. Se guarda cifrada, solo la usan los workers de OneUptime y no se vuelve a mostrar nunca.
- **A probe in my network connects**: elige una de tus sondas e indica la variable de entorno de la sonda que contiene la cadena de conexión, como `ORDERS_DB_URL`. La cadena de conexión nunca sale de tu red. Consulta [Sondas personalizadas](/docs/probe/custom-probe).

Una base de datos ya conectada para Seguridad de datos también se vigila, sin nada que conectar, igual que cada conjunto de datos de BigQuery que encontró tu [conexión a la nube](/docs/telemetry/cloud-accounts).

## Un usuario de solo lectura por motor

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

La cadena de conexión: `postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require`. OneUptime lee `pg_class`, `pg_stat_user_tables` y `pg_attribute`: una tabla cambió cuando se movieron sus contadores de inserciones, actualizaciones o eliminaciones, y se leyó cuando se movieron sus contadores de escaneos.
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

`performance_schema` permite a OneUptime ver escrituras y lecturas entre una recopilación y la siguiente; sin él, `information_schema.TABLES` sigue indicando cuándo cambió cada tabla por última vez.
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

`VIEW DATABASE STATE` permite a OneUptime leer tamaños, últimas actualizaciones y últimas lecturas.
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

Conéctate con una cadena de conexión de PostgreSQL al endpoint del clúster o del grupo de trabajo, como `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require`. `SYSLOG ACCESS UNRESTRICTED` permite a OneUptime leer recuentos de filas y tamaños, las últimas escrituras y lecturas de todos los usuarios, y el linaje del registro de consultas. Sin él, un cambio en las filas de una tabla sigue indicando cuándo cambió.
@tab Snowflake
```sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
```

Snowflake se lee a través de su API SQL con autenticación por par de claves. Conéctate con JSON:

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

El catálogo se lee con `SHOW`, que no necesita warehouse, así que la recopilación no consume créditos. Solo las comprobaciones se ejecutan en el warehouse, con la programación que les des.
@tab Google BigQuery
Cada conjunto de datos que encontró tu conexión a la nube se vigila con la cuenta de servicio de esa conexión. Dale **BigQuery Metadata Viewer** y **BigQuery Job User** en el proyecto para leer el catálogo, **BigQuery Data Viewer** en las tablas que leen tus comprobaciones y **BigQuery Resource Viewer** para el linaje de sus jobs.

Cada recopilación lee la tabla `__TABLES__` del conjunto de datos (filas, bytes y último cambio, sin coste) y su `INFORMATION_SCHEMA.COLUMNS` (facturada con el mínimo de 10 MB de BigQuery). Para conectar un conjunto de datos sin conexión a la nube, proporciona JSON con una clave de cuenta de servicio:

```json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
```
@tab ClickHouse
```sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
```

ClickHouse se lee a través de su interfaz HTTP, en el puerto 8443 con TLS (ClickHouse Cloud) o en el 8123 sin él: `clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`. Indica una base de datos para vigilar solo esa, u omítela para vigilar todas las bases de datos salvo las propias del servidor. `system.parts` permite a OneUptime ver cada inserción (una fusión no cuenta), `system.part_log`, donde el servidor lo mantiene, da la hora de cada inserción, y `system.query_log` da las últimas lecturas y el linaje una vez por hora. Cada sentencia se ejecuta en solo lectura, así que ni siquiera un usuario que pudiera escribir puede hacerlo.
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

Un catálogo de Unity Catalog es una base de datos. Conéctate con una entidad de servicio, o con un token de acceso personal como `"token"` en lugar de `clientId` y `clientSecret`:

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

El catálogo, sus columnas y el último commit de cada tabla Delta vienen de la API REST de Unity Catalog sin ningún SQL warehouse, así que la recopilación no consume cómputo. Las comprobaciones, y el linaje y las últimas lecturas de `system.access.table_lineage` una vez por hora, se ejecutan en el SQL warehouse que indiques; concede a la entidad de servicio **Can use** sobre él.
:::

## Qué se lee y con qué frecuencia

| Qué | Cuándo |
| --- | --- |
| Tablas, vistas, columnas, filas, tamaño y último cambio | Cada cinco minutos |
| Comprobaciones | Cada 15 minutos, cada hora, cada 6 horas o cada día, según indique cada una |
| Linaje y últimas lecturas del historial de consultas | Una vez por hora, desde la última lectura |

Cada sentencia se ejecuta en solo lectura, con un tiempo de espera de sentencia y de bloqueo donde el motor los tiene. La cadena de conexión nunca se registra y se elimina de cada error. Una estadística que el usuario no puede leer se omite con una advertencia en la base de datos, nunca con una recopilación fallida.

## Solución de problemas

- **La base de datos muestra el estado Fallido.** Su mensaje dice por qué: un host al que OneUptime no llega, un usuario rechazado, un modo TLS que el servidor no acepta. Si la base de datos está dentro de tu red, conéctala a través de una sonda.
- **Las tablas no muestran ningún último cambio.** El usuario no puede leer las estadísticas del motor: concede lo que indica la pestaña de tu motor, o espera a que las filas de una tabla cambien dos veces.
- **Falta una tabla.** Está en un esquema que el usuario no puede usar, o está excluida en la base de datos. Concede `USAGE` sobre su esquema o quita la exclusión.

## Próximos pasos

:::cards
- [Salud de las tablas](/docs/data-observability/table-health): Lo que cada recopilación aprende de cada tabla, y las alertas que recomienda.
- [Comprobaciones y conciliaciones](/docs/data-observability/checks): Reglas sobre lo que contiene una tabla.
:::
