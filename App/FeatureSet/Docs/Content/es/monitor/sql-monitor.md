# Monitor de consultas SQL

El Monitor de consultas SQL ejecuta una consulta SQL de solo lectura de forma programada desde una sonda y genera alertas según el resultado: el número de filas devueltas, un valor escalar, cuánto tardó la consulta o un error de consulta. Está diseñado para el caso de uso de «ejecutar una consulta y abrir un incidente», por ejemplo, para alertar cuando el número de pedidos cancelados en los últimos cinco minutos se dispara, cuando una tabla de cola crece demasiado o cuando desaparece una fila crítica.

Como la consulta se ejecuta desde una sonda dentro de tu red, OneUptime nunca necesita una conexión directa a tu base de datos y el conjunto de resultados completo nunca sale de la sonda: solo se reporta una proyección pequeña y acotada del resultado.

## Bases de datos compatibles

El Monitor de consultas SQL admite los siguientes motores de bases de datos:

- **PostgreSQL** (puerto predeterminado `5432`)
- **MySQL** (puerto predeterminado `3306`)
- **Microsoft SQL Server** (puerto predeterminado `1433`)

Los motores compatibles con MySQL y con PostgreSQL que utilizan el mismo protocolo de comunicación y dialecto de SQL suelen funcionar también, pero solo los tres motores anteriores se prueban oficialmente.

## Cómo funciona

En cada verificación, la sonda se conecta a tu base de datos, ejecuta tu consulta en un contexto de solo lectura, lee como máximo un número acotado de filas y reporta una proyección compacta a OneUptime. Luego, los criterios de tu monitor se evalúan con esa proyección.

La sonda solo reporta:

- **Recuento de filas**: el número de filas que devolvió la consulta (limitado por el valor de Máximo de filas).
- **Valor escalar**: la primera columna de la primera fila. Es el valor natural para una consulta del estilo `SELECT COUNT(*)`.
- **Primera fila**: la primera fila como un conjunto de pares columna/valor, que se muestra en el resumen de la verificación para dar contexto.
- **Tiempo de ejecución**: cuánto tardó la consulta, en milisegundos.
- **Error de consulta**: un mensaje de error saneado si la consulta falló.

El conjunto de resultados completo nunca se envía a OneUptime, por lo que los datos del cliente no se replican en el almacenamiento de OneUptime.

## Modelo de seguridad

Ejecutar una consulta proporcionada por el cliente contra una base de datos de producción es delicado, por lo que el Monitor de consultas SQL es de solo lectura por diseño y combina varios controles:

- **Usuario de base de datos con privilegios mínimos (control principal).** Siempre debes conectarte con un usuario de base de datos dedicado y de solo lectura que solo tenga acceso a las tablas que la consulta necesita. Este es el control más importante: consulta Crear un usuario de solo lectura más abajo.
- **Ejecución de solo lectura.** En PostgreSQL y MySQL, la sonda abre una transacción `READ ONLY`, que rechaza cualquier escritura (incluidas las CTE de escritura) sin importar el texto de la consulta. En Microsoft SQL Server, que no tiene transacción de solo lectura, la sonda se ejecuta dentro de una transacción que siempre se revierte.
- **Consultas de una sola instrucción incluidas en la lista de permitidos.** La consulta debe ser una única instrucción que comience con `SELECT`, `WITH`, `VALUES` o `TABLE`. Las instrucciones encadenadas (`SELECT 1; DROP TABLE …`) y las escrituras/DDL se rechazan antes de que la sonda se conecte. La comprobación tiene en cuenta los comentarios y los literales de cadena, por lo que una palabra clave oculta en un comentario o cadena no se cuela.
- **Tiempo de espera de la instrucción.** Cada consulta tiene un límite de tiempo estricto. Una consulta que se ejecuta durante demasiado tiempo se cancela.
- **Filas acotadas.** Solo se leen como máximo Máximo de filas (más una, para detectar el truncamiento) filas, lo que limita la memoria de la sonda y el tamaño de la carga útil.
- **Ocultación de credenciales.** Los errores de la base de datos se sanean antes de almacenarse: la contraseña y cualquier cadena de conexión se ocultan, por lo que las credenciales nunca se filtran en los mensajes de error.

## Requisitos previos

- Una **sonda** con acceso de red al host y puerto de tu base de datos. Puede ser una sonda alojada por OneUptime (si tu base de datos es accesible desde internet) o una sonda autoalojada que se ejecute dentro de tu red. Consulta la documentación de sondas para saber cómo instalar una sonda personalizada.
- Un **usuario de base de datos de solo lectura** y los datos de conexión (host, puerto, nombre de la base de datos, nombre de usuario, contraseña).

## Configuración

Crea un nuevo monitor y elige **Consulta SQL** como tipo de monitor, luego completa los datos de conexión:

- **Tipo de base de datos**: PostgreSQL, MySQL o Microsoft SQL Server. Elegir un tipo establece el puerto predeterminado.
- **Host**: el host de la base de datos accesible desde la sonda (por ejemplo, `db.internal`).
- **Puerto**: el puerto de la base de datos.
- **Nombre de la base de datos**: la base de datos contra la que se ejecuta la consulta.
- **Nombre de usuario**: un usuario de base de datos de solo lectura y con privilegios mínimos.
- **Contraseña**: la contraseña de la base de datos. Recomendamos encarecidamente hacer referencia a un [Secreto de monitor](/docs/monitor/monitor-secrets) con `{{monitorSecrets.name}}` en lugar de escribir la contraseña en texto plano (ver más abajo).
- **Consulta SQL**: la consulta de solo lectura que se ejecutará (consulta Escribir la consulta).
- **Usar SSL/TLS**: actívalo para conectarte mediante TLS. Cuando está activado, puedes desactivar **Verificar el certificado del servidor** si la base de datos usa un certificado autofirmado.

### Opciones avanzadas

- **Tiempo de espera de conexión (ms)**: cuánto tiempo esperar para establecer una conexión. Predeterminado `10000`, máximo `30000`.
- **Tiempo de espera de la instrucción (ms)**: el límite estricto de cuánto tiempo puede ejecutarse la consulta. Predeterminado `15000`, máximo `60000`.
- **Máximo de filas**: el límite superior de filas que se leen de la base de datos. Predeterminado `100`, máximo `1000`.

## Escribir la consulta

La consulta debe ser una **única instrucción de solo lectura**. Debe comenzar con `SELECT`, `WITH`, `VALUES` o `TABLE`. Se permite un único punto y coma al final; no se permiten varias instrucciones.

Mantén las consultas económicas y bien acotadas: se ejecutan en cada verificación, así que prioriza las columnas indexadas y las ventanas de tiempo reducidas.

```sql
-- Contar cancelaciones recientes (PostgreSQL)
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```

```sql
-- La misma idea en MySQL
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```

```sql
-- La misma idea en Microsoft SQL Server
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```

Para una consulta del estilo `COUNT(*)`, el recuento está disponible como **Recuento de filas** (que es `1`, ya que se devuelve una fila) y también como **Valor escalar** (el propio recuento, de la primera columna). Para alertar sobre «cuántos», compara con el **Valor escalar**.

## Usar un secreto de monitor para la contraseña

Para que la contraseña de la base de datos nunca se almacene en texto plano en el monitor, crea un [Secreto de monitor](/docs/monitor/monitor-secrets) y haz referencia a él desde el campo Contraseña:

1. Ve al Panel de OneUptime → Configuración del proyecto → Secretos de monitor → Crear secreto de monitor.
2. Crea un secreto (por ejemplo, `dbPassword`) y concede acceso a él a este monitor.
3. En el campo Contraseña del monitor, introduce `{{monitorSecrets.dbPassword}}`.

OneUptime resuelve el secreto en el servidor antes de entregar la configuración a la sonda. OneUptime nunca crea estos secretos por ti: hacer referencia a uno es tu decisión.

## Configurar criterios

Agrega criterios para decidir cuándo se considera que el monitor está en línea, degradado o fuera de línea. Las siguientes comprobaciones están disponibles para un Monitor de consultas SQL:

- **SQL está en línea**: si se pudo acceder a la base de datos y la consulta se realizó correctamente.
- **Recuento de filas de la consulta SQL**: el número de filas devueltas. Compara con operadores como mayor que, menor que o igual a.
- **Valor escalar de la consulta SQL**: la primera columna de la primera fila. Se compara numéricamente cuando ambos lados parecen numéricos y, de lo contrario, como cadenas. Esta es la comprobación que debes usar para las consultas del estilo `COUNT(*)`.
- **Tiempo de ejecución de la consulta SQL (en ms)**: cuánto tardó la consulta. Útil para detectar una base de datos lenta.
- **Error de la consulta SQL**: el mensaje de error de la consulta. Genera una alerta cuando está (o no está) vacío, o cuando coincide con una cadena específica.
- **Expresión JavaScript**: evalúa una expresión JavaScript personalizada para tener control total. Consulta [Expresiones JavaScript](/docs/monitor/javascript-expression).

### Ejemplo: alertar cuando las cancelaciones se disparan

Usando la consulta anterior:

- **Criterio: Degradado**: `Valor escalar de la consulta SQL` es mayor que `10`.
- **Criterio: Fuera de línea**: `Valor escalar de la consulta SQL` es mayor que `50`, o `SQL está en línea` es `false`.

Adjunta una política de guardia a los criterios para que se avise a las personas adecuadas.

## Crear un usuario de solo lectura

Conéctate siempre con un usuario dedicado de solo lectura. Ejemplos:

```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- Incluir las tablas que se creen en el futuro:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO oneuptime_ro;
```

```sql
-- MySQL
CREATE USER 'oneuptime_ro'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON orders.* TO 'oneuptime_ro'@'%';
FLUSH PRIVILEGES;
```

```sql
-- Microsoft SQL Server
CREATE LOGIN oneuptime_ro WITH PASSWORD = 'a-strong-password';
USE orders;
CREATE USER oneuptime_ro FOR LOGIN oneuptime_ro;
ALTER ROLE db_datareader ADD MEMBER oneuptime_ro;
```

## Aspectos a considerar

- La consulta se ejecuta en cada verificación, así que mantenla económica. Usa índices y ventanas de tiempo reducidas, y apóyate en el Tiempo de espera de la instrucción como salvaguarda.
- Solo se reportan el recuento de filas, la primera celda (escalar) y la primera fila: diseña tu consulta para que el valor sobre el que quieres alertar sea la primera columna.
- Si el resultado se trunca porque superó el Máximo de filas, el resumen de la verificación lo marca como limitado. Aumenta el Máximo de filas solo si lo necesitas; los conjuntos de resultados más grandes consumen más memoria en la sonda.
- Las escrituras y el DDL siempre se rechazan. Si necesitas probar una ruta de escritura, este monitor no es para eso.
- Prefiere un secreto de monitor en lugar de una contraseña en texto plano para que la credencial permanezca cifrada en reposo.
