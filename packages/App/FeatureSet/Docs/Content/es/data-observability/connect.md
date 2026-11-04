# Conectar una base de datos

Observabilidad de datos lee cada base de datos con un usuario que solo lee su catálogo: qué tablas y vistas contiene, sus columnas, filas y tamaño, y cuándo cambiaron. Esta página indica lo mínimo que necesita cada motor, y cómo mantener la cadena de conexión dentro de tu red con una sonda.

## Antes de empezar

- **Un rol que pueda conectar bases de datos**: Propietario del proyecto, Administrador del proyecto o Administrador de telemetría.
- **Un usuario de solo lectura**, creado con las sentencias de abajo. Las comprobaciones que añadas más adelante leen filas de las tablas que comprueban, así que concede al usuario `SELECT` sobre esas tablas solo cuando añadas una.

## Elegir quién se conecta

En **Observabilidad de datos > Bases de datos**, elige **Conectar una base de datos** y luego:

- **OneUptime se conecta**: pega una cadena de conexión. Se guarda cifrada, solo la usan los workers de OneUptime y no se vuelve a mostrar nunca.
- **Una sonda de mi red se conecta**: elige una de tus sondas e indica la variable de entorno de la sonda que contiene la cadena de conexión, como `ORDERS_DB_URL`. La cadena de conexión nunca sale de tu red. Consulta [Sondas personalizadas](/docs/probe/custom-probe).

Una base de datos ya conectada para Seguridad de datos también se vigila, sin nada que conectar, igual que cada conjunto de datos de BigQuery que encontró tu [conexión a la nube](/docs/telemetry/cloud-accounts).

## Bases de datos que podrías conectar

**Bases de datos que podrías conectar**, en **Bases de datos**, muestra lo que tu proyecto ya conoce y nadie ha conectado: bases de datos con las que hablan tus trazas, las de tus cuentas en la nube y las que vigila Database Monitoring. **Conectar** abre el formulario a partir de lo que se sabe de cada una, con una cadena de conexión que debes rellenar. **Descartar** evita que una vuelva a aparecer. No se lee nada hasta que la conectes.

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
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
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
@tab Oracle
```sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
```

Oracle se lee por su propio protocolo, sin instalar un cliente de Oracle: `oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1`. El usuario ve las tablas que puede leer: concede `READ` sobre cada tabla a vigilar, lo que le permite consultarlas sin bloquearlas ni cambiarlas nunca. `SELECT_CATALOG_ROLE` permite a OneUptime leer el tamaño de cada tabla, y `ALL_TAB_MODIFICATIONS` da los inserts, updates y deletes de cada tabla desde sus últimas estadísticas, y cuándo cambió por última vez.
@tab Amazon Athena
Una base de datos de Glue es una base de datos. Sus tablas y vistas, sus columnas y estadísticas, y el último commit de cada tabla Iceberg provienen de la API del Glue Data Catalog, que no lee datos ni cuesta nada. Las comprobaciones se ejecutan como consultas de Athena en el workgroup que indiques. Conéctate con las claves de un usuario o rol de IAM que pueda llamar a `glue:GetDatabase` y `glue:GetTables` y, para las comprobaciones, ejecutar consultas de Athena en el workgroup con acceso de lectura a los datos de las tablas:

```json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
```
@tab MongoDB
```javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
```

MongoDB se lee con su propio driver: `mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/`, o `mongodb://` con los hosts de un replica set. Una base de datos en la ruta es la única que se vigila; sin ella, se vigila cada base de datos que el usuario puede leer, y `{ role: "read", db: "orders" }` en lugar de `readAnyDatabase` lo limita a una. Los documentos, el tamaño y las escrituras de cada colección vienen de `$collStats`, y cuándo recibió su último documento, de su `_id` más reciente. Sus campos vienen del esquema JSON de su validador o, si no, de los nombres y tipos de los campos de sus 100 documentos más recientes, calculados en la base de datos para que ningún valor salga de ella. Los documentos se leen en un secundario cuando lo hay, y una comprobación personalizada es un pipeline de agregación, en JSON.
:::

## Qué se lee y con qué frecuencia

| Qué | Cuándo |
| --- | --- |
| Tablas, vistas, columnas, filas, tamaño y último cambio | Cada cinco minutos |
| Comprobaciones | Cada 15 minutos, cada hora, cada 6 horas o cada día, según indique cada una |
| Linaje y últimas lecturas del historial de consultas | Una vez por hora, desde la última lectura |

Cada sentencia se ejecuta en solo lectura, con un tiempo de espera de sentencia y de bloqueo donde el motor los tiene. La cadena de conexión nunca se registra y se elimina de cada error. Una estadística que el usuario no puede leer se omite con una advertencia en la base de datos, nunca con una recopilación fallida. Las conexiones a direcciones privadas se rechazan en OneUptime Cloud: usa una sonda.

## Réplicas de lectura

Una réplica de lectura de PostgreSQL o SQL Server no mueve sus contadores de escritura, así que una tabla allí puede parecer sin cambios mientras cambia. OneUptime detecta que es una réplica, deja fuera los contadores, lo indica en la base de datos y recurre al tamaño y las filas de la tabla. Conecta la primaria siempre que puedas, o indica una [columna de frescura](/docs/data-observability/table-health) para las tablas que importan.

## Rutas de almacenamiento

No todo aquello de lo que dependes está en una base de datos. Una exportación que llega a un bucket cada noche llega tan tarde, o tan corta, como cualquier tabla. En **Rutas de almacenamiento**, elige **Editar rutas** para un bucket que encontró tu [conexión a la nube](/docs/telemetry/cloud-accounts), en Amazon S3, Google Cloud Storage o una cuenta de almacenamiento de Azure, e indica las rutas que importan, una por línea. En Azure, empieza cada una con el nombre de su contenedor.

Cada ruta aparece entonces en **Tablas**: su objeto más reciente es cuándo cambió por última vez, sus objetos son sus filas y su tamaño es su tamaño, y se aplican las mismas alertas. Solo se leen nombres, tamaños y horas, nunca un objeto. Una ruta con más de 10000 objetos no tiene un recuento, un tamaño ni un objeto más reciente exactos, y lo indica: indica una más estrecha.

## Solución de problemas

- **La base de datos muestra el estado Fallido.** Su mensaje dice por qué: un host al que OneUptime no llega, un usuario rechazado, un modo TLS que el servidor no acepta. Si la base de datos está dentro de tu red, conéctala a través de una sonda.
- **Las tablas no muestran ningún último cambio.** El usuario no puede leer las estadísticas del motor: concede lo que indica la pestaña de tu motor, o espera a que las filas de una tabla cambien dos veces.
- **Falta una tabla.** Está en un esquema que el usuario no puede usar, o está excluida en la base de datos. Concede `USAGE` sobre su esquema o quita la exclusión.
- **Una tabla de MySQL no tiene columnas.** El usuario necesita `REFERENCES`, como se indica arriba: muestra las columnas de una tabla sin dar ninguna lectura de sus filas.

## Próximos pasos

:::cards
- [Salud de las tablas](/docs/data-observability/table-health): Lo que cada recopilación aprende de cada tabla, y las alertas que recomienda.
- [Comprobaciones y conciliaciones](/docs/data-observability/checks): Reglas sobre lo que contiene una tabla.
:::
