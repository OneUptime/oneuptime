# Comprobaciones y conciliaciones

La salud de las tablas dice si una tabla cambia. Una **comprobación** dice si lo que contiene es correcto, una **conciliación** dice si dos copias de los datos coinciden, y las **pruebas de dbt** informan sobre las tablas que construye dbt. Cada una se ejecuta donde se ejecuta la recopilación de la base de datos, en OneUptime o en su sonda, y lo único que sale de la base de datos es un número.

## Comprobaciones

Añade una comprobación en la pestaña **Comprobaciones** de una tabla:

| Comprobación | Qué lee |
| --- | --- |
| **Null Percent** | Porcentaje de filas cuya columna está vacía |
| **Duplicate Percent** | Porcentaje de valores que repiten el de otra fila |
| **Distinct Count** | Cuántos valores distintos contiene la columna |
| **Mínimo**, **Máximo**, **Promedio**, **Suma** | De una columna numérica (la suma de cero filas es 0) |
| **Invalid Percent** | Porcentaje de valores que están fuera de una lista que proporcionas |
| **Format Mismatch Percent** | Porcentaje de valores que no coinciden con una expresión regular (todos los motores salvo SQL Server) |
| **Orphan Count** | Filas cuyo valor no tiene correspondencia en la columna de otra tabla |
| **Número de filas** | Filas de la tabla, sobre todo útil con **Segment By** |
| **SQL personalizado** | El número que devuelve un SELECT tuyo de solo lectura, llamado `value` (en MongoDB, el de un pipeline de agregación) |

Cada comprobación se ejecuta cada 15 minutos, cada hora, cada 6 horas o cada día, como una única sentencia de agregación en una transacción de solo lectura con un tiempo de espera de sentencia. Su valor se escribe como `oneuptime.data.check.value`, con `oneuptime.data.check.id`, `oneuptime.data.check.name` y `oneuptime.data.check.segment`.

## Comprobaciones sugeridas

**Suggested Checks**, en la misma pestaña, ofrece las comprobaciones que piden las columnas de una tabla, solo a partir de sus nombres y tipos: un id es único, un `customer_id` tiene una fila correspondiente en `customers`, un correo electrónico tiene forma de correo, un importe no es negativo, un estado mantiene sus valores habituales y una tabla dividida por inquilino se cuenta por inquilino. Añade una, añádelas todas o descarta una para siempre.

## Una comprobación a partir de una frase

**Escribir una comprobación a partir de una frase** convierte una regla como «los pedidos nunca tienen un total negativo» en una comprobación de SQL personalizado que cuenta las filas que la incumplen, en el propio SQL de tu motor, con una alerta en cuanto haya alguna. Lees la consulta antes de que **Añadir comprobación** la añada, y se le aplica todo lo que se aplica a cualquier comprobación de SQL personalizado. Necesita que OneUptime AI esté activado para el proyecto.

## Segmentos

**Segment By** ejecuta una comprobación una vez por cada valor de una columna, como un inquilino o una región: una serie y una alerta para cada uno, para los 100 segmentos más grandes. Un número de filas segmentado alerta cuando un inquilino deja de enviar datos mientras los demás siguen.

## Alertas sobre una comprobación

Configura **Alert When** para alertar sobre una comprobación:

- **Unusually High** o **Unusually Low** compara cada valor con su propia línea base aprendida para esa hora de la semana.
- **Por encima de** o **Por debajo de** lo compara con un umbral.

Al guardar la comprobación se crea un monitor de métricas para ella, en tu nombre y con tus permisos. Si vacías la condición, se elimina el monitor.

## Conciliaciones

Las copias se desvían: el almacén de datos tiene menos pedidos que la base de datos de la aplicación, o una migración perdió filas. Una conciliación compara una medida de dos tablas, en una base de datos o en dos, en **Conciliaciones**:

- **Número de filas**
- **Suma** de una columna
- **Distinct Count** de una columna
- **SQL personalizado**: una consulta de solo lectura que devuelve un número, llamado `value`

Tiene una tolerancia: una cantidad fija (**Absoluta**) o un porcentaje del valor de la fuente (**Porcentaje**). Cada lado lo lee una comprobación propia, que la conciliación crea y mantiene, junto con la recopilación de su base de datos, de modo que una conciliación puede comparar una tabla de PostgreSQL de tu red con su copia en Snowflake. Los dos valores se comparan en cuanto ambos se han leído con no más de 15 minutos de diferencia. Una conciliación escribe:

- `oneuptime.data.reconciliation.drifted`: 1 cuando los dos se han desviado más allá de la tolerancia, 0 cuando coinciden. Su monitor lee este valor.
- `oneuptime.data.reconciliation.difference`: el valor del destino menos el de la fuente.
- `oneuptime.data.reconciliation.difference_percent`: la diferencia como porcentaje del valor de la fuente.

Una copia que se carga según una programación va por detrás de su fuente: compara con SQL personalizado una medida en la que ambas ya coinciden, como las filas de hace más de una hora, o ten en cuenta el retraso en la tolerancia.

## Pruebas de dbt

Después de un build de dbt, `oneuptime dbt upload` envía los artefactos del proyecto (consulta [Linaje y pipelines](/docs/data-observability/lineage-and-pipelines)). Cada prueba de una tabla vigilada aparece entonces en su pestaña **Comprobaciones**, con su último resultado y las filas que encontró fallando. Elige **Alert on Failures** para que una prueba fallida abra una alerta.

## Próximos pasos

:::cards
- [Linaje y pipelines](/docs/data-observability/lineage-and-pipelines): Envía los artefactos de dbt y ve la ejecución que hay detrás de una comprobación fallida.
- [Productos de datos](/docs/data-observability/data-products): Promete a las personas que usan los datos que están actualizados.
:::
