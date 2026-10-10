# Monitor de consultas SQL

El monitor de consultas SQL ejecuta de forma programada, desde una sonda, una consulta SQL de solo lectura y alerta sobre el resultado: el número de filas devueltas, un valor escalar, cuánto tardó la consulta o un error de consulta. Está pensado para el caso de «ejecutar una consulta y abrir un incidente», por ejemplo alertar cuando se dispara el número de pedidos cancelados en los últimos cinco minutos, cuando una tabla de cola crece demasiado o cuando desaparece una fila crítica.

:::cards
- [Crear un usuario de solo lectura](#crear-un-usuario-de-solo-lectura): El inicio de sesión de base de datos que debe usar el monitor.
- [Crear el monitor](#crear-un-monitor-de-consultas-sql): Conecte una sonda e introduzca la consulta.
- [Escribir la consulta](#escribir-la-consulta): Ponga el valor sobre el que alerta en la primera columna.
- [Configurar los criterios](#configurar-los-criterios): Alerte sobre un recuento, un valor, una consulta lenta o un error.
:::

## Cómo funciona

En cada comprobación, la sonda se conecta a su base de datos, ejecuta su consulta en un contexto de solo lectura, lee como máximo un número acotado de filas e informa a OneUptime de una proyección compacta. Después, los criterios del monitor se evalúan sobre esa proyección.

Como la consulta se ejecuta desde una sonda dentro de su red, OneUptime nunca necesita una conexión directa a su base de datos, y el conjunto de resultados completo nunca sale de la sonda: solo se informa de una proyección pequeña y acotada del resultado.

```mermaid title="Solo una pequeña proyección del resultado sale de su red"
sequenceDiagram
    participant O as OneUptime
    participant P as Sonda
    participant D as Su base de datos
    O->>P: Ajustes del monitor, secretos resueltos
    P->>D: Su consulta, de solo lectura
    D-->>P: Hasta Filas máx. + 1 filas
    P->>O: Número de filas, escalar, primera fila, tiempo, error
    O->>O: Evaluar los criterios
```

La sonda solo informa de:

| Valor | Qué es |
|---|---|
| **Número de filas** | El número de filas que devolvió la consulta (acotado por el límite de Filas máx.). |
| **Valor escalar** | La primera columna de la primera fila. Es el valor natural de una consulta del estilo `SELECT COUNT(*)`. |
| **Primera fila** | La primera fila como pares columna/valor, mostrada en el resumen de la comprobación como contexto. |
| **Tiempo de ejecución** | Cuánto tardó la comprobación, en milisegundos, incluida la conexión, no solo la consulta. |
| **Error de consulta** | Un mensaje de error saneado si la consulta falló. |

El conjunto de resultados completo nunca se envía a OneUptime, así que los datos de sus clientes no se replican en el almacenamiento de OneUptime.

## Bases de datos compatibles

| Base de datos | Puerto predeterminado |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

Los motores compatibles con MySQL y PostgreSQL que hablan el mismo protocolo de red y el mismo dialecto SQL suelen funcionar también, pero solo los tres motores anteriores se prueban oficialmente.

Cuando el host y el puerto a los que se conecta el monitor son uno de los endpoints de una base de datos de la página [Bases de datos](/docs/telemetry/databases), sus alertas e incidentes aparecen también en la página de esa base de datos (consulte [Alertas sobre una base de datos](/docs/telemetry/databases#alerts-on-a-database)). Un host indicado como referencia a un secreto de monitor no se asocia.

## Modelo de seguridad

Ejecutar una consulta proporcionada por el cliente contra una base de datos de producción es delicado, por eso el monitor de consultas SQL es de solo lectura por diseño y superpone varios controles:

| Control | Qué hace |
|---|---|
| **Usuario de base de datos con privilegios mínimos** (control principal) | Conéctese siempre con un usuario de base de datos dedicado y de solo lectura que solo tenga acceso a las tablas que necesita la consulta. Es el control más importante; consulte [Crear un usuario de solo lectura](#crear-un-usuario-de-solo-lectura). |
| **Ejecución de solo lectura** | En PostgreSQL y MySQL, la sonda abre una transacción `READ ONLY`, que rechaza cualquier escritura (incluidas las CTE de escritura) sea cual sea el texto de la consulta. En Microsoft SQL Server, que no tiene transacción de solo lectura, la sonda se ejecuta dentro de una transacción que siempre se revierte. |
| **Consultas de una sola sentencia y permitidas** | La consulta debe ser una única sentencia que empiece por `SELECT`, `WITH`, `VALUES` o `TABLE`. Las sentencias apiladas (`SELECT 1; DROP TABLE …`) y las palabras clave de escritura o DDL como `INSERT`, `UPDATE`, `DELETE`, `DROP`, `EXEC` e `INTO` las rechaza la sonda antes de conectarse. Esta comprobación es una red de seguridad, no la frontera: la frontera es el usuario de solo lectura. |
| **Tiempo de espera de la sentencia** | Cada consulta tiene un límite de tiempo estricto. Una consulta que tarda demasiado se cancela. |
| **Filas acotadas** | Solo se leen como máximo Filas máx. filas (más una, para detectar el truncamiento), lo que limita la memoria de la sonda y el tamaño de los datos enviados. |
| **Ocultación de credenciales** | Los errores de la base de datos se sanean antes de guardarse: la contraseña, el host, el nombre de usuario y el nombre de la base de datos, y cualquier cadena de conexión, se ocultan, para que las credenciales nunca se filtren en los mensajes de error. |

## Antes de empezar

- Una **sonda** con acceso de red al host y al puerto de su base de datos. Puede ser una sonda alojada por OneUptime (si su base de datos es accesible desde Internet) o una [sonda personalizada](/docs/probe/custom-probe) que se ejecute dentro de su red.
- Un **usuario de base de datos de solo lectura** y los datos de conexión (host, puerto, nombre de la base de datos, nombre de usuario, contraseña), o una identidad de Windows o de dominio de solo lectura si usa la autenticación integrada de SQL Server.

## Crear un usuario de solo lectura

Conéctese siempre con un usuario dedicado de solo lectura. Ejecute las sentencias de su motor como administrador, sustituyendo `orders` por su base de datos:

:::tabs
@tab PostgreSQL
```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- Include tables created in the future:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO oneuptime_ro;
```
@tab MySQL
```sql
-- MySQL
CREATE USER 'oneuptime_ro'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON orders.* TO 'oneuptime_ro'@'%';
FLUSH PRIVILEGES;
```
@tab Microsoft SQL Server
```sql
-- Microsoft SQL Server
CREATE LOGIN oneuptime_ro WITH PASSWORD = 'a-strong-password';
USE orders;
CREATE USER oneuptime_ro FOR LOGIN oneuptime_ro;
ALTER ROLE db_datareader ADD MEMBER oneuptime_ro;
```
:::

Para un permiso más restringido, conceda al usuario `SELECT` solo sobre las tablas que lee su consulta.

## Crear un monitor de consultas SQL

:::steps
### Empezar un monitor nuevo

Vaya a **Monitores** y haga clic en **Crear monitor**. En **Tipo de monitor**, haga clic en **Más tipos de monitor** y elija **Consulta SQL** en **Database Monitoring**, o escriba `query` en el cuadro de búsqueda. Introduzca un **Nombre** y haga clic en **Siguiente**.

### Introducir los datos de conexión

Elija el **Tipo de base de datos** (el puerto cambia al predeterminado de ese motor) y rellene el host, el nombre de la base de datos y las credenciales del usuario de solo lectura. Haga referencia a la contraseña con un [secreto de monitor](#usar-un-secreto-de-monitor-para-la-contraseña) en lugar de escribirla. Cada campo se describe en [Configuración](#configuración).

### Introducir la consulta

Escriba una única sentencia de solo lectura en **Consulta SQL** (consulte [Escribir la consulta](#escribir-la-consulta)).

### Probarlo

Haga clic en **Probar monitor** para ejecutar la consulta una vez desde una sonda antes de guardar.

### Definir los criterios

Revise los criterios con los que empieza el monitor y añada los suyos; consulte [Configurar los criterios](#configurar-los-criterios). Después, haga clic en **Siguiente**.

### Elegir sondas y crear

Seleccione las **Sondas** que alcanzan la base de datos y un **Intervalo de monitoreo**, y haga clic en **Crear monitor**.
:::

## Configuración

| Campo | Qué introducir |
|---|---|
| **Tipo de base de datos** | PostgreSQL, MySQL o Microsoft SQL Server. Elegir un tipo fija el puerto predeterminado. |
| **Host** | El host de la base de datos accesible desde la sonda (por ejemplo, `db.internal`). |
| **Puerto** | El puerto de la base de datos. |
| **Nombre de la base de datos** | La base de datos contra la que se ejecuta la consulta. |
| **Usar la autenticación integrada de Windows** | Solo Microsoft SQL Server. Autenticarse con la cuenta que ejecuta la sonda en lugar de con un nombre de usuario y una contraseña de SQL. Consulte [Autenticación integrada de Windows](#autenticación-integrada-de-windows). |
| **Nombre de usuario** | Un usuario de base de datos de solo lectura y con privilegios mínimos. |
| **Contraseña** | La contraseña de la base de datos. Recomendamos encarecidamente hacer referencia a un [secreto de monitor](/docs/monitor/monitor-secrets) con `{{monitorSecrets.name}}` en lugar de escribir la contraseña como texto sin formato (consulte [Usar un secreto de monitor para la contraseña](#usar-un-secreto-de-monitor-para-la-contraseña)). |
| **Consulta SQL** | La consulta de solo lectura que se ejecuta (consulte [Escribir la consulta](#escribir-la-consulta)). |
| **Usar SSL/TLS** | Actívelo para conectarse mediante TLS. Una vez activado, puede desactivar **Verificar el certificado del servidor** si la base de datos usa un certificado autofirmado. |

### Más campos

| Campo | Predeterminado | Máximo | Qué limita |
|---|---|---|---|
| **Tiempo de espera de conexión (ms)** | `10000` | `30000` | Cuánto se espera para establecer una conexión. |
| **Tiempo de espera de la sentencia (ms)** | `15000` | `60000` | El límite estricto de cuánto puede durar la consulta. |
| **Filas máx.** | `100` | `1000` | El tope de filas que se leen de la base de datos. |

Un valor por encima del máximo se reduce al máximo.

### Autenticación integrada de Windows

Para Microsoft SQL Server, active **Usar la autenticación integrada de Windows** para abrir una conexión de confianza con la identidad del proceso de la sonda. Los campos Nombre de usuario y Contraseña se ignoran en este modo y no se pasan al controlador. Como la sonda necesita una identidad en la que confíe su dominio, use una sonda autoalojada para este modo de autenticación.

| La sonda se ejecuta en | Qué configurar |
|---|---|
| **Windows** | Ejecutar el servicio de la sonda con una cuenta de dominio que tenga un inicio de sesión de SQL Server de solo lectura. |
| **Linux o macOS** | Configurar Kerberos para el dominio de SQL Server y dar al proceso de la sonda un ticket válido (por ejemplo, mediante un keytab). La imagen oficial de Linux de la sonda incluye Microsoft ODBC Driver 18, unixODBC y el cliente de Kerberos. Monte la configuración de Kerberos y la caché de tickets en el contenedor, hágalas legibles para el proceso de la sonda y defina `KRB5_CONFIG` o `KRB5CCNAME` cuando sus ubicaciones no sean las predeterminadas. |

La sonda necesita un Microsoft ODBC Driver for SQL Server instalado en el host que la ejecuta. La imagen oficial de la sonda incluye **ODBC Driver 18**. Cuando ejecuta una sonda autoalojada o personalizada, esta detecta y usa automáticamente el `ODBC Driver N for SQL Server` más reciente registrado en el host (por ejemplo, Driver 17 si es el que está instalado): no hace falta tener exactamente Driver 18. Para fijar un controlador concreto, defina la variable de entorno `SQL_SERVER_ODBC_DRIVER` en la sonda con el nombre exacto del controlador (por ejemplo, `ODBC Driver 17 for SQL Server`).

SQL Server debe tener un nombre de entidad de servicio `MSSQLSvc` adecuado, los relojes de la sonda y del controlador de dominio deben estar sincronizados, y la sonda debe resolver y alcanzar SQL Server por el nombre de host que cubre esa entidad de servicio. Conceda a la identidad de confianza solo los permisos de base de datos que necesita la consulta de monitoreo.

## Escribir la consulta

La consulta debe ser una **única sentencia de solo lectura**. Debe empezar por `SELECT`, `WITH`, `VALUES` o `TABLE`. Se permite un punto y coma final; varias sentencias, no. Las palabras clave de escritura y DDL se rechazan en cualquier parte de la consulta, incluida `INTO`, así que `SELECT … INTO` también se rechaza.

La sonda comprueba la consulta en cada comprobación, no al guardar. Una consulta que incumple estas reglas se guarda, y después cada comprobación falla con "Only read-only queries are allowed (must start with SELECT, WITH, VALUES, or TABLE)."; los criterios predeterminados dejan el monitor sin conexión.

Mantenga las consultas baratas y bien acotadas: se ejecutan en cada comprobación, así que prefiera columnas indexadas y ventanas de tiempo estrechas. Esta consulta cuenta los pedidos cancelados en los últimos cinco minutos:

:::tabs
@tab PostgreSQL
```sql
-- Count recent cancellations (PostgreSQL)
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```
@tab MySQL
```sql
-- The same idea on MySQL
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```
@tab Microsoft SQL Server
```sql
-- The same idea on Microsoft SQL Server
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```
:::

> [!TIP]
> En una consulta del estilo `COUNT(*)`, el recuento está disponible como **Número de filas** (que es `1`, porque se devuelve una fila) y como **Valor escalar** (el propio recuento, de la primera columna). Para alertar sobre «cuántos», compare con el **Valor escalar**.

## Usar un secreto de monitor para la contraseña

Para que la contraseña de la base de datos nunca se guarde como texto sin formato en el monitor, cree un [secreto de monitor](/docs/monitor/monitor-secrets) y haga referencia a él desde el campo Contraseña:

:::steps
1. Vaya a **Monitores → Ajustes → Secretos** y cree un secreto de monitor.
2. Póngale un nombre (por ejemplo, `dbPassword`) y dé acceso a este monitor.
3. En el campo **Contraseña** del monitor, introduzca `{{monitorSecrets.dbPassword}}`.
:::

OneUptime resuelve el secreto en el servidor antes de entregar la configuración a la sonda. OneUptime nunca crea estos secretos por usted: hacer referencia a uno es decisión suya. Los campos **Nombre de usuario**, **Host**, **Nombre de la base de datos** y **Consulta SQL** también aceptan referencias a secretos; **Puerto** no.

## Configurar los criterios

Añada criterios para decidir cuándo el monitor se considera en línea, degradado o sin conexión. Estas comprobaciones están disponibles para un monitor de consultas SQL:

| Tipo de filtro | Qué comprueba |
|---|---|
| **SQL Is Online** | Si la base de datos estaba accesible y la consulta tuvo éxito. |
| **SQL Query Row Count** | El número de filas devueltas. Compare con operadores como mayor que, menor que o igual a. |
| **SQL Query Scalar Value** | La primera columna de la primera fila. Se compara como número cuando el valor que introduce es un número, y si no, como cadena. Es la comprobación que debe usar en consultas del estilo `COUNT(*)`. |
| **SQL Query Execution Time (in ms)** | Cuánto tardó la consulta. Útil para detectar una base de datos lenta. |
| **SQL Query Error** | El mensaje de error de la consulta. Alerte cuando esté (o no) vacío, o cuando coincida con una cadena concreta. |
| **JavaScript Expression** | Evaluar una expresión de JavaScript personalizada sobre `rowCount`, `scalarValue`, `firstRow`, `executionTimeInMs`, `queryError` e `isOnline`. Consulte [Expresiones JavaScript](/docs/monitor/javascript-expression#monitores-de-consultas-sql). |

Los umbrales numéricos son números enteros: escriba `10`, no `10.5`. Los filtros de SQL Query no se pueden evaluar durante un periodo de tiempo; cada comprobación es independiente.

Un monitor de consultas SQL nuevo empieza con dos criterios: **SQL Is Online** es falso (el monitor queda sin conexión y declara un incidente que se resuelve solo) y **SQL Is Online** es verdadero, que lo marca en línea. **Añadir criterios** añade uno al final; arrástrelo por encima del criterio en línea, porque los criterios se comprueban desde arriba y el primero que coincide decide.

### Ejemplo: alertar cuando se disparan las cancelaciones

Con la consulta anterior:

| Criterio | Filtro |
|---|---|
| **Degradado** | `SQL Query Scalar Value` es mayor que `10`. |
| **Sin conexión** | `SQL Query Scalar Value` es mayor que `50`, o `SQL Is Online` es `false`. |

Asocie una política de guardia al criterio para que se avise a las personas adecuadas. Un monitor de consultas SQL no tiene variables de plantilla propias: el título de un incidente puede nombrar el monitor con `{{monitorName}}`, pero no puede citar el resultado de la consulta.

## Aspectos a tener en cuenta

- La consulta se ejecuta en cada comprobación, así que manténgala barata. Use índices y ventanas de tiempo estrechas, y apóyese en el tiempo de espera de la sentencia como respaldo.
- Solo se informa del número de filas, la primera celda (escalar) y la primera fila: diseñe su consulta para que el valor sobre el que quiere alertar esté en la primera columna.
- Si el resultado se trunca por superar Filas máx., el resumen de la comprobación muestra **Filas truncadas**: "Yes (result capped)". Aumente Filas máx. solo si lo necesita; los conjuntos de resultados más grandes consumen más memoria en la sonda.
- Las escrituras y el DDL se rechazan siempre. Si necesita probar una ruta de escritura, este monitor no es para eso.
- Prefiera un secreto de monitor a una contraseña en texto sin formato, para que la credencial quede cifrada en reposo.
- Una comprobación cuya consulta falla se reintenta un segundo después, hasta tres veces más, antes de informar del error, para que un corte breve de la conexión no deje el monitor sin conexión. En una sonda autoalojada, `PROBE_MONITOR_RETRY_LIMIT` fija cuántas veces.

## Solución de problemas

:::details Cada comprobación falla con "Only read-only queries are allowed"
La consulta no empieza por `SELECT`, `WITH`, `VALUES` o `TABLE`. Un comentario delante no importa; un `SET` o un `DECLARE`, sí. Reescríbala como una sola sentencia de solo lectura.
:::

:::details Una comprobación falla con "Disallowed SQL keyword"
En algún lugar de la consulta aparece una palabra clave de escritura, DDL o ejecución, incluso dentro de un `SELECT`, como `INTO` o `EXEC`. Las palabras entre comillas y en comentarios no cuentan. Quite la palabra clave, o ponga la lógica en una vista que el usuario de solo lectura pueda leer.
:::

:::details La comprobación agota el tiempo de espera
La sonda no pudo conectarse dentro del **Tiempo de espera de conexión (ms)**, o la consulta tardó más que el **Tiempo de espera de la sentencia (ms)**. Compruebe que la sonda alcanza el host y el puerto, y después abarate la consulta: filtre por columnas indexadas en una ventana de tiempo corta.
:::

:::details La conexión falla con un error de certificado
El certificado de la base de datos es autofirmado, o la sonda no confía en él. Desactive **Verificar el certificado del servidor**, que aparece al activar **Usar SSL/TLS**, o dé a la base de datos un certificado en el que confíe la sonda.
:::

:::details La autenticación integrada de Windows falla
La sonda necesita un Microsoft ODBC Driver for SQL Server y una identidad en la que confíe su dominio. Use la imagen oficial de la sonda, o instale el controlador, y después revise la configuración en [Autenticación integrada de Windows](#autenticación-integrada-de-windows).
:::

## Próximos pasos

:::cards
- [Monitor de salud de la base de datos](/docs/monitor/database-health-monitor): Vigile conexiones, bloqueos y replicación sin escribir SQL.
- [Secretos del monitor](/docs/monitor/monitor-secrets): Mantenga cifrada la contraseña de la base de datos.
- [Expresiones JavaScript](/docs/monitor/javascript-expression): Escriba criterios que combinen varios valores.
- [Sondas personalizadas](/docs/probe/custom-probe): Ejecute comprobaciones desde dentro de su red.
:::
