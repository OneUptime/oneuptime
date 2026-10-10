# Monitor de salud de la base de datos

El monitor de salud de la base de datos se conecta a PostgreSQL, MySQL o Microsoft SQL Server de forma programada e informa de las señales de salud del propio servidor —margen de conexiones, sesiones bloqueadas, retraso de replicación, tasa de aciertos de caché, tamaño de la base de datos, desbordamiento de los ID de transacción y una treintena más—, para que puedas alertar sobre ellas igual que alertas cuando un sitio web cae.

No escribes SQL. La sonda ejecuta un conjunto fijo de consultas de catálogo de solo lectura, elegido según el motor, e informa de un pequeño conjunto de números con nombre.

:::cards
- [Crear un usuario de monitoreo](#crear-un-usuario-de-monitoreo): Los permisos que necesita cada motor. Es el paso que más importa.
- [Crear el monitor](#crear-un-monitor-de-salud-de-la-base-de-datos): Apuntar una sonda a la base de datos y elegir qué recopilar.
- [Métricas recopiladas](#métricas-recopiladas): Cada serie, con los motores que la informan.
- [Configurar criterios](#configurar-criterios): Alertar sobre conexiones, bloqueos, retraso y desbordamiento.
:::

## ¿Salud de la base de datos o consulta SQL?

Los dos tipos de monitor de base de datos responden a preguntas distintas y están pensados para usarse juntos.

| | Salud de la base de datos | [Consulta SQL](/docs/monitor/sql-monitor) |
|---|---|---|
| Pregunta que responde | "¿Está sana la base de datos en sí?" | "¿Son mis datos lo que espero?" |
| Consulta | Integrada, por motor, de solo lectura | La tuya |
| Informa | Métricas numéricas con nombre (consulta [Métricas recopiladas](#métricas-recopiladas)) | Número de filas, valor escalar, primera fila, tiempo de ejecución |
| Alerta típica | Conexiones usadas por encima del 90 % | Más de 50 pedidos cancelados en los últimos cinco minutos |
| Permisos necesarios | Lectura de estadísticas/DMV —consulta [Crear un usuario de monitoreo](#crear-un-usuario-de-monitoreo) | `SELECT` sobre las tablas que toca tu consulta |

Si quieres alertar sobre una condición de negocio, usa el monitor de consultas SQL. Si quieres saber que el servidor se está quedando sin conexiones antes de que la condición de negocio tenga siquiera ocasión de fallar, usa este.

## Bases de datos compatibles

| Base de datos | Puerto predeterminado |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

Azure SQL Database y Azure SQL Managed Instance se conectan como **Microsoft SQL Server**. Necesitan otros permisos —consulta [Crear un usuario de monitoreo](#crear-un-usuario-de-monitoreo).

Los motores compatibles con PostgreSQL y MySQL que hablan el mismo protocolo de red suelen funcionar, pero pueden exponer menos vistas de estadísticas; en ese caso, las métricas afectadas se informan como no disponibles en lugar de recopilarse. Solo los tres motores de arriba se prueban oficialmente.

Cada base de datos que usan tus aplicaciones, clústeres y hosts —estos tres motores y muchos más— también tiene su propia página con sus métricas de motor, sus logs y los servicios que la llaman: consulta [Bases de datos](/docs/telemetry/databases). Cuando el host y el puerto a los que se conecta un monitor de salud de la base de datos son uno de los endpoints de una base de datos, las alertas e incidentes del monitor también aparecen en la página de esa base de datos (consulta [Alertas en una base de datos](/docs/telemetry/databases#alerts-on-a-database)).

## Cómo funciona

En cada comprobación, una sonda:

1. Se conecta a la base de datos con las credenciales que configures.
2. Ejecuta una consulta de prueba ligera. **Es la única sentencia cuyo fallo puede dejar el monitor sin conexión.**
3. Ejecuta las consultas de catálogo de cada [grupo de métricas](#grupos-de-métricas) activado, una a una, cada una con un tiempo de espera de sentencia.
4. Informa de los números que recopiló, más una nota por cada grupo que no pudo recopilar y el motivo.

```mermaid title="Una comprobación, y el único paso que puede dejar el monitor sin conexión"
flowchart TB
    connect["Conectarse a la base de datos"] --> probe{"¿Consulta de prueba OK?"}
    probe -->|"No"| offline["Monitor sin conexión"]
    probe -->|"Sí"| groups["Ejecutar cada grupo de métricas"]
    groups --> group{"¿Grupo recopilado?"}
    group -->|"Sí"| metrics["Métricas informadas"]
    group -->|"No"| issue["Métricas ausentes, problema anotado"]
    metrics --> criteria["Criterios evaluados"]
    issue --> criteria
```

Solo se envían a OneUptime agregados numéricos con nombre. Ningún texto de consulta, ninguna fila de tus tablas y ningún nombre de esquema sale de tu red: las consultas leen las vistas de estadísticas propias del motor (`pg_stat_activity`, `performance_schema.global_status`, `sys.dm_exec_sessions` y similares), nunca tus datos.

Como la comprobación se ejecuta desde una sonda, la base de datos solo tiene que ser accesible desde la sonda. Coloca una [sonda personalizada](/docs/probe/custom-probe) dentro de tu red y OneUptime no necesitará ninguna ruta hacia la base de datos.

## Antes de empezar

- Una **sonda** con acceso de red al host y al puerto de la base de datos. Usa una sonda alojada por OneUptime si la base de datos es accesible desde internet, o una [sonda personalizada](/docs/probe/custom-probe) dentro de tu red si no lo es.
- Un **usuario de monitoreo**, creado como se describe en la siguiente sección, y sus datos de conexión.

## Crear un usuario de monitoreo

**Este es el paso más importante.** El monitor lee vistas de estadísticas que los inicios de sesión normales no pueden ver, y un inicio de sesión con pocos privilegios no siempre falla con un error: en PostgreSQL da una respuesta incorrecta. Crea un inicio de sesión dedicado exactamente con estos permisos y nada más.

### PostgreSQL

```sql
CREATE USER oneuptime_health WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE mydb TO oneuptime_health;
-- The one grant that matters. Without it, see the note below.
GRANT pg_monitor TO oneuptime_health;
```

`pg_monitor` es un rol integrado (PostgreSQL 10 y posteriores) que concede acceso de lectura a las vistas de estadísticas y de monitoreo. No concede acceso a tus tablas.

> [!IMPORTANT]
> **Por qué `pg_monitor` no es opcional en PostgreSQL.** Sin él, `pg_stat_activity` no falla: la consulta tiene éxito y devuelve solo la fila de la propia sesión de monitoreo. El número de conexiones marcaría `1`, las sesiones bloqueadas `0` y el retraso de replicación `0`, para siempre, en un servidor que en realidad está en llamas. Por eso la sonda comprueba, **antes** de ejecutar esas consultas, que el inicio de sesión sea miembro de `pg_monitor` (o de `pg_read_all_stats`) o superusuario. Si no es nada de eso, la sonda informa los grupos Connections, Activity y Locks como no disponibles, junto con el `GRANT` que necesitas. No informar nada es la respuesta honesta; informar `1` no lo es.

En un servicio gestionado donde `pg_monitor` no está disponible, `pg_read_all_stats` cubre las mismas vistas. En Amazon RDS no hace falta `GRANT rds_superuser`: `GRANT pg_monitor TO oneuptime_health;` funciona como miembro de `rds_superuser`.

### MySQL

```sql
CREATE USER 'oneuptime_health'@'%' IDENTIFIED BY 'a-strong-password';
-- INNODB_TRX (open transactions, longest query) and replication status.
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_health'@'%';
-- Status counters, server variables, and lock waits.
GRANT SELECT ON performance_schema.* TO 'oneuptime_health'@'%';
-- Database size: information_schema.TABLES only shows tables the login can see.
GRANT SELECT ON mydb.* TO 'oneuptime_health'@'%';
FLUSH PRIVILEGES;
```

El `performance_schema` de MySQL debe estar activado (`performance_schema = ON`, el valor predeterminado desde la 5.6). Si está desactivado, los grupos Connections, Throughput y Locks se informan como no disponibles, y la solución es reiniciar el servidor, no un permiso.

### Microsoft SQL Server y Azure SQL Managed Instance

```sql
-- A server-level grant only runs while the current database is master.
USE master;
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';
-- Every DMV the monitor reads. On SQL Server 2022 and later,
-- VIEW SERVER PERFORMANCE STATE alone is also enough.
GRANT VIEW SERVER STATE TO oneuptime_health;

USE mydb;
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
```

Ejecutado desde cualquier otra base de datos, `GRANT VIEW SERVER STATE` falla con Msg 4621, "Permissions at the server scope can only be granted when the current database is master".

> [!WARNING]
> **El acceso de lectura a tus tablas no basta.** Un inicio de sesión que solo puede leer datos —`db_datareader` o cualquier otro rol de "acceso de lectura"— puede conectarse y obtiene el tamaño de la base de datos, y nada más. SQL Server rechaza las vistas que lee el monitor con `The user does not have permission to perform this action.` (Msg 297). El mensaje anterior nombra lo que se rechazó: Msg 300 `VIEW SERVER STATE` (`VIEW SERVER PERFORMANCE STATE` en 2022) para las vistas de servidor, incluidos el espacio del registro de transacciones y el espacio libre de tempdb, o Msg 262 `VIEW DATABASE STATE` (`VIEW DATABASE PERFORMANCE STATE` en 2022) para la vista de replicación. El monitor sigue en línea, informa que a los grupos Connections, Activity, Throughput, Locks, Storage y Replication les falta un permiso y muestra a su lado el `GRANT` de arriba. `VIEW SERVER STATE` los cubre todos.
>
> Dos vistas no rechazan: sin el permiso, `sys.dm_exec_sessions` y `sys.dm_exec_requests` muestran en silencio solo la propia sesión del monitor. El monitor nunca las lee por sí solas, siempre junto a una vista que sí rechaza, así que un permiso que falta nunca puede registrarse como "1 conexión".

### Azure SQL Database

Azure SQL Database no tiene permisos a nivel de servidor —`GRANT VIEW SERVER STATE` falla allí—, así que las mismas vistas se abren con un permiso a nivel de base de datos. Crea un inicio de sesión en `master`, dale un usuario en la base de datos que monitoreas y concede el permiso allí, no en `master`:

```sql
-- Connected to master, as the server admin:
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';

-- Connected to the monitored database:
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
GRANT VIEW DATABASE STATE TO oneuptime_health;
```

Eso basta en bases de datos vCore y en bases de datos DTU de S2 en adelante. En **Basic, S0 y S1**, y para cualquier base de datos de un **grupo elástico**, Azure solo deja leer estas vistas al administrador del servidor, al administrador de Microsoft Entra o a los miembros del rol de servidor `##MS_ServerStateReader##`, digan lo que digan los permisos de la base de datos. En esos casos, el administrador del servidor también añade el inicio de sesión a ese rol:

```sql
-- Connected to master, as the server admin:
ALTER SERVER ROLE ##MS_ServerStateReader## ADD MEMBER oneuptime_health;
```

`##MS_ServerStateReader##` funciona en todos los niveles, así que también es la alternativa si `VIEW DATABASE STATE` resulta no ser suficiente. Una nueva pertenencia a un rol puede tardar unos minutos en aplicarse y solo llega a las conexiones nuevas; la sonda abre una conexión nueva en cada comprobación.

Un usuario de base de datos independiente (`CREATE USER oneuptime_health WITH PASSWORD = '...'` en la base de datos monitoreada, sin inicio de sesión) funciona con `VIEW DATABASE STATE` en S2 y superiores, pero no puede unirse a `##MS_ServerStateReader##`: los roles de servidor solo aceptan inicios de sesión. Para pasar un usuario independiente al rol, elimínalo (`DROP USER oneuptime_health;`) y sigue las sentencias de arriba.

La sonda reconoce Azure SQL Database por `SERVERPROPERTY('EngineEdition')` y no por su versión: Azure SQL Database informa `12.0.2000.8` sea cual sea la versión que ejecuta de verdad, lo que se lee como SQL Server 2014. Por eso el **Motor** del monitor indica `Azure SQL Database 12.0.2000.8`, y un permiso que falta se muestra como la sentencia de Azure de arriba, nunca como `VIEW SERVER STATE`.

- **La replicación no se recopila en Azure SQL Database.** Azure SQL Database no tiene `sys.dm_hadr_database_replica_states`, así que allí el grupo Replication se omite en lugar de informarse como fallido en cada comprobación. Las vistas de réplicas propias de Azure (`sys.dm_database_replica_states`, `sys.dm_geo_replication_link_status`) todavía no se leen.
- **Las conexiones son por base de datos.** Con `VIEW DATABASE STATE`, Azure SQL Database solo muestra las sesiones de la base de datos monitoreada, así que Connections cuenta esa base de datos y no el servidor lógico. Monitorea cada base de datos que te importe.
- **En un grupo elástico, TempDB Free Space es el del grupo.** Las bases de datos de un grupo comparten una misma tempdb.

## Crear un monitor de salud de la base de datos

:::steps
### Empezar un monitor nuevo

Ve a **Monitores** y haz clic en **Crear monitor**. En **Tipo de monitor**, haz clic en **Más tipos de monitor** y elige **Salud de la base de datos** en **Database Monitoring**, o escribe `health` en el cuadro de búsqueda. Escribe un **Nombre** y haz clic en **Siguiente**.

### Introducir los datos de conexión

Elige el **Tipo de base de datos** y rellena el host, el puerto, el nombre de la base de datos y las credenciales del usuario de monitoreo. Haz referencia a la contraseña como [secreto de monitor](#usar-un-secreto-de-monitor-para-la-contraseña) en lugar de escribirla. Cada campo se describe en [Configuración](#configuración).

### Elegir qué recopilar

Deja activados todos los grupos de **Grupos de métricas** salvo que tengas un motivo para desactivar alguno —consulta [Grupos de métricas](#grupos-de-métricas).

### Probar la conexión

Haz clic en **Probar monitor** para ejecutar una comprobación antes de guardar y lee lo que recopiló.

### Definir los criterios

Revisa los criterios con los que empieza el monitor y añade los tuyos —consulta [Configurar criterios](#configurar-criterios). Después, haz clic en **Siguiente**.

### Elegir sondas y crear

Selecciona las **Sondas** que pueden llegar a la base de datos y un **Intervalo de monitoreo**, y haz clic en **Crear monitor**.
:::

## Configuración

| Campo | Qué introducir |
|---|---|
| **Tipo de base de datos** | PostgreSQL, MySQL o Microsoft SQL Server. Al elegir un tipo se fija el puerto predeterminado y se decide qué consultas se ejecutan. |
| **Host** | El host de la base de datos accesible desde la sonda (por ejemplo `db.internal`). |
| **Puerto** | El puerto de la base de datos. |
| **Nombre de la base de datos** | La base de datos a la que conectarse. Las métricas de ámbito de base de datos (tamaño, tasa de aciertos de caché, volcado a archivos temporales) se informan para esta base de datos; las de ámbito de servidor (conexiones, tiempo de actividad, replicación), para todo el servidor, salvo en Azure SQL Database, donde las conexiones solo se cuentan para la base de datos monitoreada. |
| **Usar la autenticación integrada de Windows** | Solo Microsoft SQL Server. Autentica con la identidad del proceso de la sonda en lugar de con un nombre de usuario y una contraseña. Consulta [Autenticación integrada de Windows](/docs/monitor/sql-monitor) en la página del monitor de consultas SQL: la configuración es idéntica. |
| **Nombre de usuario** | El usuario de monitoreo. Obligatorio salvo que uses la autenticación integrada de Windows. |
| **Contraseña** | La contraseña. Haz referencia a un [secreto de monitor](/docs/monitor/monitor-secrets) con `{{monitorSecrets.name}}` en lugar de escribirla en texto plano (consulta [Usar un secreto de monitor](#usar-un-secreto-de-monitor-para-la-contraseña)). |
| **Usar SSL/TLS** | Conectarse mediante TLS. Si está activado, puedes desactivar **Verificar el certificado del servidor** para un certificado autofirmado. |
| **Grupos de métricas** | Qué grupos ejecutar: Conexiones, Actividad, Rendimiento, Locks and Blocking, Almacenamiento, Replicación y Mantenimiento. Todos están activados de forma predeterminada; consulta [Grupos de métricas](#grupos-de-métricas). Los detalles del monitor los muestran como **Grupos de métricas recopilados**. |

### Más campos

| Campo | Predeterminado | Máximo | Qué limita |
|---|---|---|---|
| **Tiempo de espera de conexión (ms)** | `10000` | `30000` | Cuánto esperar para establecer una conexión. |
| **Tiempo de espera de la sentencia (ms)** | `10000` | `60000` | El límite de cada consulta de catálogo. |

El tiempo de espera de sentencia predeterminado es deliberadamente más ajustado que el del monitor de consultas SQL: estas consultas responden en milisegundos en un servidor sano, así que si `pg_stat_activity` tarda diez segundos, la señal útil es "este servidor tiene problemas", no esperar más. Un valor por encima del máximo se reduce al máximo.

## Usar un secreto de monitor para la contraseña

Para que la contraseña nunca se guarde en texto plano en el monitor:

:::steps
1. Ve a **Monitores → Ajustes → Secretos** y crea un [secreto de monitor](/docs/monitor/monitor-secrets).
2. Ponle un nombre (por ejemplo `dbPassword`) y da acceso a este monitor.
3. En el campo **Contraseña** del monitor, escribe `{{monitorSecrets.dbPassword}}`.
:::

El secreto se resuelve en el servidor antes de entregar la configuración a una sonda. Los campos Host, Nombre de usuario y Nombre de la base de datos aceptan la misma referencia. Las credenciales nunca se escriben en logs, feeds del monitor ni plantillas de alertas.

## Grupos de métricas

Un grupo es una unidad que activas o desactivas, y la unidad sobre la que se informa un permiso que falta. Los grupos existen para que un permiso que falta te cueste un grupo y no todo el monitor. Las sentencias de un grupo se ejecutan una a una, así que un grupo puede recopilarse en parte: entonces aparece tanto en `collectedGroups` como en `unavailableGroups`. El caso habitual es el grupo Storage de SQL Server para un inicio de sesión sin `VIEW SERVER STATE`: se recopila el tamaño de la base de datos, pero no el espacio del registro ni el espacio libre de tempdb.

| Grupo | Qué recopila | Necesita |
|---|---|---|
| Connections | Número de conexiones, el límite configurado, conexiones abortadas, tiempo de actividad del servidor | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Activity | Consulta en ejecución más larga, transacción abierta más larga, transacciones abiertas | PostgreSQL: `pg_monitor`. MySQL: `PROCESS`. SQL Server: `VIEW SERVER STATE` |
| Throughput | Transacciones, consultas, tasa de aciertos de caché, lecturas y escrituras en disco, tiempo de E/S | PostgreSQL: nada más allá de `CONNECT`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Locks | Sesiones bloqueadas, esperas de bloqueo, interbloqueos, esperas de bloqueo de tabla | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Storage | Tamaño de la base de datos, volcado a archivos temporales, espacio del registro, espacio libre de tempdb | PostgreSQL: nada más allá de `CONNECT`. MySQL: `SELECT` sobre la base de datos. SQL Server: nada para el tamaño de la base de datos; `VIEW SERVER STATE` para el espacio del registro y el espacio libre de tempdb |
| Replication | Réplicas conectadas, retraso de replicación en segundos y en bytes, slots inactivos, estado de recuperación | PostgreSQL: `pg_monitor`. MySQL: `REPLICATION CLIENT`. SQL Server: `VIEW SERVER STATE`; no se recopila en Azure SQL Database |
| Maintenance | Margen hasta el desbordamiento de los ID de transacción, tuplas muertas, tablas nunca procesadas por autovacuum, checkpoints | PostgreSQL: `pg_monitor` |

En Azure SQL Database, lee `VIEW DATABASE STATE` donde esta tabla dice `VIEW SERVER STATE`, o `##MS_ServerStateReader##` en Basic, S0, S1 y grupos elásticos. Consulta [Azure SQL Database](#azure-sql-database).

Desactivar un grupo es silencioso: sin métricas, sin problema de recopilación, sin alerta. Es lo correcto en dos casos:

- **No puedes conseguir el permiso.** Desactivar el grupo evita que el problema de recopilación se repita en cada comprobación.
- **Las consultas son demasiado costosas.** En MySQL, **Almacenamiento** es el candidato habitual: el tamaño de la base de datos sale de sumar `information_schema.TABLES`, lo que no es gratis en un esquema con decenas de miles de tablas y se ejecuta en cada comprobación. Desactívalo o pasa ese monitor a un intervalo de cinco minutos.

Desmarcar todos los grupos no es una forma de no recopilar nada: una lista vacía se normaliza de nuevo a todos los grupos, así que un monitor nunca puede guardarse en un estado en el que no recopile nada sin avisar.

## Qué pasa cuando no se puede recopilar una métrica

**Un permiso que falta nunca deja el monitor sin conexión.** Es el comportamiento más importante de este tipo de monitor, y vale la pena describirlo con precisión.

| Qué falla | Estado del monitor | Qué ves |
|---|---|---|
| **La conexión**, o la consulta de prueba: credenciales incorrectas, conexión rechazada, fallo de TLS, tiempo de espera de conexión agotado | **Sin conexión** | `Database Is Online` es false, y se dispara el incidente y la política de guardia que le hayas asociado. |
| **Un grupo**: un permiso que falta, un `performance_schema` desactivado, un tiempo de espera de sentencia agotado | **Sigue en línea** | Las métricas que ese grupo no pudo leer están **ausentes**, no a cero. No se dibuja ninguna línea en el gráfico, ningún umbral sobre esas series puede cumplirse y no puede surgir ningún incidente de ellas. La comprobación registra un problema de recopilación que nombra el grupo, el motivo y, cuando lo hay, el `GRANT` exacto que hay que ejecutar; se muestra en el resumen del monitor y se cuenta en **Metric Groups Failed**. |
| **El motor no puede producir la métrica en absoluto**: MySQL estándar no tiene contador de interbloqueos; SQL Server deja ilimitado su límite de conexiones de forma predeterminada, así que un "porcentaje usado" no tendría sentido | **Sigue en línea** | La métrica simplemente no está. **No** es un problema de recopilación, no cuenta en Metric Groups Failed y no hay nada que arreglar. Consulta la columna Engines en [Métricas recopiladas](#métricas-recopiladas). |

Ausente siempre significa ausente. Un valor que no se midió nunca se informa como `0`, porque un gráfico de ceros inventados es peor que un hueco: un hueco lo puedes ver.

> [!TIP]
> Para alertar sobre la pérdida de visibilidad, usa `Database Collection Error` o un umbral sobre **Metric Groups Failed**. Haz que ambos sean alertas y no incidentes: un permiso revocado es un ticket, no una llamada de guardia.

### "The user does not have permission to perform this action"

Es el mensaje de SQL Server (Msg 297) para un inicio de sesión que puede conectarse pero no puede leer las vistas de estado del servidor. Siempre significa que falta un permiso, nunca un fallo de la base de datos. SQL Server lo envía en segundo lugar, después de un mensaje que nombra el permiso que rechazó, y el monitor muestra ambos: por ejemplo `VIEW SERVER STATE permission was denied on object 'server', database 'master'. The user does not have permission to perform this action.` Junto a él aparece la sentencia que lo corrige para la plataforma a la que se conectó la sonda:

- **SQL Server o Azure SQL Managed Instance**: `GRANT VIEW SERVER STATE TO oneuptime_health;`, ejecutado en `master` (el monitor la muestra como `GRANT VIEW SERVER STATE TO [<monitoring_login>]; -- run in master`).
- **Azure SQL Database**: `GRANT VIEW DATABASE STATE TO oneuptime_health;`, ejecutado en la base de datos monitoreada; en Basic, S0, S1 y grupos elásticos, la pertenencia a `##MS_ServerStateReader##` en su lugar. Consulta [Azure SQL Database](#azure-sql-database).

Mientras tanto se sigue recopilando el tamaño de la base de datos, porque es la única métrica del grupo Storage que cualquier inicio de sesión puede leer.

## Métricas recopiladas

Cuarenta y una series en ocho categorías. Engines enumera los motores que pueden producir realmente la serie; en cualquier otro motor, simplemente no está. Group es el grupo de recopilación al que pertenece la serie, que es lo que activas o desactivas y lo que se degrada en conjunto.

### Disponibilidad

| Métrica | Serie | Group | Engines |
|---|---|---|---|
| **Uptime** (s) | `oneuptime.monitor.database.uptime.seconds` | Connections | PostgreSQL, MySQL, SQL Server |
| **Metric Groups Failed** | `oneuptime.monitor.database.metric.groups.failed` | Connections | PostgreSQL, MySQL, SQL Server |

### Conexiones

| Métrica | Serie | Group | Engines |
|---|---|---|---|
| **Connections** | `oneuptime.monitor.database.connections.total` | Connections | PostgreSQL, MySQL, SQL Server |
| **Active Connections** | `oneuptime.monitor.database.connections.active` | Connections | PostgreSQL, MySQL, SQL Server |
| **Maximum Connections** | `oneuptime.monitor.database.connections.max` | Connections | PostgreSQL, MySQL |
| **Connections Used** (%) | `oneuptime.monitor.database.connections.used.percent` | Connections | PostgreSQL, MySQL |
| **Idle In Transaction** | `oneuptime.monitor.database.connections.idle.in.transaction` | Connections | PostgreSQL |
| **Aborted Connects** | `oneuptime.monitor.database.connections.aborted.total` | Connections | MySQL |

### Rendimiento

| Métrica | Serie | Group | Engines |
|---|---|---|---|
| **Transactions** | `oneuptime.monitor.database.transactions.total` | Throughput | PostgreSQL, SQL Server |
| **Queries** | `oneuptime.monitor.database.queries.total` | Throughput | MySQL, SQL Server |
| **Slow Queries** | `oneuptime.monitor.database.queries.slow.total` | Throughput | MySQL |
| **Rollback Ratio** (%) | `oneuptime.monitor.database.rollback.percent` | Throughput | PostgreSQL |
| **Longest Running Query** (s) | `oneuptime.monitor.database.query.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Longest Open Transaction** (s) | `oneuptime.monitor.database.transaction.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Open Transactions** | `oneuptime.monitor.database.transaction.open.count` | Activity | MySQL |

### Bloqueos

| Métrica | Serie | Group | Engines |
|---|---|---|---|
| **Blocked Sessions** | `oneuptime.monitor.database.sessions.blocked` | Locks | PostgreSQL, MySQL, SQL Server |
| **Lock Waits** | `oneuptime.monitor.database.locks.waiting` | Locks | PostgreSQL, MySQL, SQL Server |
| **Deadlocks** | `oneuptime.monitor.database.deadlocks.total` | Locks | PostgreSQL, SQL Server |
| **Table Lock Waits** | `oneuptime.monitor.database.table.locks.waited.total` | Locks | MySQL |

MySQL estándar no expone ningún contador de interbloqueos, por eso Deadlocks solo existe en PostgreSQL y SQL Server.

### Caché y E/S

| Métrica | Serie | Group | Engines |
|---|---|---|---|
| **Cache Hit Ratio** (%) | `oneuptime.monitor.database.cache.hit.percent` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Reads** | `oneuptime.monitor.database.disk.reads.total` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Writes** | `oneuptime.monitor.database.disk.writes.total` | Throughput | MySQL, SQL Server |
| **I/O Read Time** (ms) | `oneuptime.monitor.database.io.read.time.ms` | Throughput | PostgreSQL, SQL Server |
| **I/O Write Time** (ms) | `oneuptime.monitor.database.io.write.time.ms` | Throughput | PostgreSQL, SQL Server |
| **Page Life Expectancy** (s) | `oneuptime.monitor.database.page.life.expectancy.seconds` | Throughput | SQL Server |
| **Memory Grants Pending** | `oneuptime.monitor.database.memory.grants.pending` | Throughput | SQL Server |

PostgreSQL solo mide los tiempos de lectura y escritura de E/S cuando `track_io_timing` está activado. Está desactivado de forma predeterminada, y entonces PostgreSQL informa ambos como `0`: en PostgreSQL, un cero plano en esas dos series suele significar "no medido", no "rápido". Es un ajuste del servidor, no un problema de permisos.

### Almacenamiento

| Métrica | Serie | Group | Engines |
|---|---|---|---|
| **Database Size** (bytes) | `oneuptime.monitor.database.size.bytes` | Storage | PostgreSQL, MySQL, SQL Server |
| **Temp Bytes Written** (bytes) | `oneuptime.monitor.database.temp.bytes.total` | Storage | PostgreSQL |
| **Temp Disk Tables** | `oneuptime.monitor.database.temp.disk.tables.total` | Storage | MySQL |
| **Log Space Used** (%) | `oneuptime.monitor.database.log.space.used.percent` | Storage | SQL Server |
| **TempDB Free Space** (bytes) | `oneuptime.monitor.database.tempdb.free.bytes` | Storage | SQL Server |

### Replicación

| Métrica | Serie | Group | Engines |
|---|---|---|---|
| **Connected Replicas** | `oneuptime.monitor.database.replica.count` | Replication | PostgreSQL, SQL Server |
| **Replication Lag** (s) | `oneuptime.monitor.database.replication.lag.seconds` | Replication | PostgreSQL, MySQL |
| **Replication Lag (Bytes)** (bytes) | `oneuptime.monitor.database.replication.lag.bytes` | Replication | PostgreSQL, SQL Server |
| **Is In Recovery** | `oneuptime.monitor.database.is.in.recovery` | Replication | PostgreSQL |
| **Inactive Replication Slots** | `oneuptime.monitor.database.replication.slots.inactive` | Replication | PostgreSQL |

Las métricas de replicación se informan desde el lado del enlace al que esté conectado el monitor. Apunta un monitor al primario para ver las réplicas conectadas y la cola de envío; apunta uno a cada standby para ver cuánto va por detrás realmente ese standby.

El retraso en segundos marca cero en un primario inactivo aunque una réplica vaya muy por detrás, porque no se ha escrito nada nuevo. **Replication Lag (Bytes)** no tiene ese punto ciego, así que alerta sobre ambos.

### Mantenimiento

| Métrica | Serie | Group | Engines |
|---|---|---|---|
| **Transaction ID Used** (%) | `oneuptime.monitor.database.transaction.id.used.percent` | Maintenance | PostgreSQL |
| **Dead Tuples** | `oneuptime.monitor.database.dead.tuples` | Maintenance | PostgreSQL |
| **Tables Never Autovacuumed** | `oneuptime.monitor.database.tables.never.autovacuumed` | Maintenance | PostgreSQL |
| **Requested Checkpoints** | `oneuptime.monitor.database.checkpoints.requested.total` | Maintenance | PostgreSQL |
| **Timed Checkpoints** | `oneuptime.monitor.database.checkpoints.timed.total` | Maintenance | PostgreSQL |

> [!IMPORTANT]
> **Transaction ID Used** merece un criterio en cada monitor de PostgreSQL que crees. PostgreSQL rechaza todas las escrituras cuando llega al 100 %, la recuperación implica un vacuum en modo monousuario con la base de datos detenida, y casi nadie lo vigila. Alerta mucho antes del precipicio: el 80 % deja días de margen en la mayoría de las cargas.

Los contadores que terminan en `total` son acumulativos desde que arrancó el servidor. Compara dos momentos para obtener una tasa; un valor aislado solo tiene sentido frente a su propio historial, y vuelve a cero cuando el servidor se reinicia (algo que te mostrará **Uptime**).

## Configurar criterios

| Tipo de filtro | Qué comprueba |
|---|---|
| **Database Is Online** | Si la base de datos era accesible y la consulta de prueba tuvo éxito. Es el criterio de desconexión con el que se crea el monitor, y la única comprobación que refleja la accesibilidad. |
| **Database Metric** | Elige una métrica y compárala: Greater Than, Less Than, Greater Than Or Equal To, Less Than Or Equal To, Equal To o Not Equal To. El selector de métricas solo ofrece las métricas que tu motor puede producir, así que no puedes crear un criterio que quede incumplido para siempre (una excepción: las métricas de Replication que se ofrecen para Microsoft SQL Server nunca se recopilan en Azure SQL Database). Si la métrica no se recopiló en una comprobación —el grupo falló o el motor no la informa—, el filtro no coincide, y tampoco coincide como "false": se omite. Un problema de permisos no puede avisar a nadie. |
| **Database Collection Error** | El resumen de problemas de recopilación de la comprobación, un "grupo: mensaje" por cada grupo no disponible. Alerta cuando no esté vacío para detectar la pérdida de visibilidad, o usa Contains para vigilar un grupo concreto. |
| **JavaScript Expression** | Control total. Consulta [Expresiones de JavaScript](/docs/monitor/javascript-expression). |

Los umbrales son números enteros. Escribe `90`, no `90.5`: los porcentajes y los segundos se comparan como enteros.

**Database Is Online** y **Database Metric** pueden comprobarse a lo largo del tiempo: marca **Evaluar estos criterios durante un periodo de tiempo**, luego elige cómo **Evaluar** los valores (por ejemplo **All Values**) y **Durante los últimos (en minutos)**. A lo largo del tiempo, el ajuste **Si no hay datos** del filtro decide qué significa un valor que falta; déjalo en **Ignore** para que un permiso que falta siga sin poder avisar a nadie.

### Variables de las expresiones de JavaScript

Para un monitor de salud de la base de datos, la expresión tiene acceso a:

| Variable | Tipo | Descripción |
|---|---|---|
| `isOnline` | boolean | Si la conexión y la consulta de prueba tuvieron éxito |
| `engineVersion` | string | La cadena de versión que informó el servidor (en SQL Server, la `ProductVersion` sin más; el resumen del monitor nombra la plataforma a su lado) |
| `connectionError` | string | Error de conexión depurado, vacío si no hubo ninguno |
| `collectedGroups` | array | Los grupos que produjeron valores en esta comprobación |
| `unavailableGroups` | array | Los grupos con una sentencia que no se pudo recopilar, cada uno con un motivo y una solución. Un grupo recopilado en parte está en ambas listas |
| `metrics` | object | Los valores recopilados, con el nombre de la serie como clave; una serie que no se recopiló no está |

```javascript
{{isOnline}} === true && {{collectedGroups}}.length >= 5
```

Para leer una métrica en una expresión, indexa el objeto `metrics` completo: los nombres de las series contienen puntos, así que no pueden ir dentro de las llaves:

```javascript
{{metrics}}['oneuptime.monitor.database.connections.used.percent'] > 90
```

Para un umbral sobre una sola métrica, usa **Database Metric** en lugar de una expresión: resuelve la serie por ti, solo ofrece lo que tu motor puede producir y omite la comprobación cuando el valor no se recopiló, en lugar de comparar con nada.

### Ejemplo: un primario de PostgreSQL

| Orden | Criterio | Filtro |
|---|---|---|
| 1 | **Sin conexión** | `Database Is Online` es `false`. |
| 2 | **Degradado** | `Database Metric` → Connections Used es mayor que `90`, evaluado durante 5 minutos con All Values para que un pico aislado no avise a nadie. |
| 3 | **Degradado** | `Database Metric` → Transaction ID Used es mayor que `80`. |
| 4 | **Degradado** | `Database Metric` → Blocked Sessions es mayor que `0`, durante 5 minutos. |
| 5 | **En línea** | `Database Is Online` es `true`. |

Los criterios se evalúan de arriba abajo y gana la primera coincidencia, así que pon primero los criterios de alerta y el sano al final.

Asocia una política de guardia al criterio de desconexión y deja todo lo que se derive de **Metric Groups Failed** o de `Database Collection Error` como alerta sin política de guardia asociada.

## Qué tener en cuenta

- **Las consultas se ejecutan en cada comprobación.** Son baratas por diseño, pero "barato" depende del intervalo. Un intervalo de un minuto contra un servidor con miles de sesiones supone más recorridos de `pg_stat_activity` de los que quizá quieras; cinco minutos bastan de sobra para las métricas de capacidad.
- **Apunta el monitor a la base de datos que te importa.** El tamaño, la tasa de aciertos de caché y el volcado a archivos temporales son por base de datos. Las conexiones, el tiempo de actividad y la replicación son por servidor y dan lo mismo desde cualquier base de datos de esa instancia.
- **Un monitor por instancia, no por base de datos**, salvo que quieras específicamente métricas de tamaño y de caché por base de datos; si no, multiplicas las consultas de ámbito de servidor sin información nueva. Azure SQL Database es la excepción: informa las conexiones por base de datos, así que allí monitorea cada base de datos.
- **Alerta sobre tasas, no sobre contadores.** Todo lo que termina en `total` solo sube, así que un umbral "mayor que" sobre ello se dispara una vez y nunca se recupera. Represéntalo en un gráfico o compáralo a lo largo de una ventana.
- **Prefiere un secreto de monitor a una contraseña en texto plano.** Así la credencial se queda cifrada en reposo y nunca aparece en el monitor.
- **El monitor nunca escribe.** Cada consulta es una lectura de una vista de estadísticas: en PostgreSQL dentro de una transacción de solo lectura, en MySQL en una sesión de solo lectura. Lo que no puede leer se informa como una métrica que falta, nunca como una caída.

## Solución de problemas

:::details El monitor está sin conexión, pero la base de datos funciona
Sin conexión significa que la sonda no pudo conectarse o que la consulta de prueba falló: el host o el puerto no son accesibles desde la sonda, se rechazó el inicio de sesión, falló TLS o se agotó el tiempo de espera de la conexión. El resumen del monitor muestra el error. Comprueba que la sonda puede llegar a la base de datos (una sonda alojada por OneUptime necesita una dirección pública; si no, usa una [sonda personalizada](/docs/probe/custom-probe)), revisa el nombre de usuario y la contraseña o su secreto de monitor, y desactiva **Verificar el certificado del servidor** para un certificado autofirmado. Después, haz clic en **Probar monitor** para volver a comprobar.
:::

:::details Faltan Connections, Activity y Locks en PostgreSQL
El inicio de sesión no es miembro de `pg_monitor` ni de `pg_read_all_stats`, ni es superusuario, así que la sonda omite esos grupos en lugar de registrar números incorrectos. Ejecuta `GRANT pg_monitor TO oneuptime_health;` como se describe en [PostgreSQL](#postgresql).
:::

:::details Faltan Connections, Throughput y Locks en MySQL
O al inicio de sesión le falta `SELECT` sobre `performance_schema`, o `performance_schema` está desactivado en el servidor; el resumen del monitor muestra el mensaje de MySQL. Si falta un permiso, ejecuta las sentencias de [MySQL](#mysql). Un `performance_schema` desactivado necesita `performance_schema = ON` en la configuración del servidor y un reinicio.
:::

:::details I/O Read Time e I/O Write Time siempre valen 0 en PostgreSQL
PostgreSQL solo los mide cuando `track_io_timing` está activado, y está desactivado de forma predeterminada. Actívalo en la configuración del servidor, o en el grupo de parámetros de tu servicio gestionado, para ver valores reales. No es un permiso que falte.
:::

:::details Metric Groups Failed está por encima de 0 en cada comprobación
Hay un grupo que no se puede recopilar en ninguna comprobación, así que el mismo problema de recopilación se repite. El resumen del monitor nombra el grupo, el motivo y el `GRANT` que lo corrige. Concede el permiso o, si no puedes conseguirlo, desactiva ese grupo en **Grupos de métricas** para que el problema deje de repetirse.
:::

## Próximos pasos

:::cards
- [Monitor de consultas SQL](/docs/monitor/sql-monitor): Alerta sobre el resultado de tu propia consulta, junto a la salud del servidor.
- [Bases de datos](/docs/telemetry/databases): Ve las métricas, los logs y quién llama a cada base de datos en una sola página.
- [Secretos del monitor](/docs/monitor/monitor-secrets): Mantén cifrada la contraseña del usuario de monitoreo.
- [Sondas personalizadas](/docs/probe/custom-probe): Llega a una base de datos dentro de tu red.
:::
