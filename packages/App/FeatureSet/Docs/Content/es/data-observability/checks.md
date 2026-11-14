# Comprobaciones y conciliaciones

La salud de las tablas dice si una tabla cambia. Una **comprobación** dice si lo que contiene es correcto, una **conciliación** dice si dos copias de los datos coinciden, y las **pruebas de dbt** informan sobre las tablas que construye dbt. Cada una se ejecuta donde se ejecuta la recopilación de la base de datos, en OneUptime o en su sonda, y lo único que sale de la base de datos es un número, salvo que un proyecto decida guardar una muestra enmascarada de las filas que fallan.

## Comprobaciones

Añade una comprobación en la pestaña **Comprobaciones** de una tabla:

| Comprobación | Qué lee |
| --- | --- |
| **Porcentaje de nulos** | Porcentaje de filas cuya columna está vacía |
| **Porcentaje de duplicados** | Porcentaje de valores que repiten el de otra fila |
| **Recuento de valores distintos** | Cuántos valores distintos contiene la columna |
| **Mínimo**, **Máximo**, **Promedio**, **Suma** | De una columna numérica (la suma de cero filas es 0) |
| **Porcentaje de valores no válidos** | Porcentaje de valores que están fuera de una lista que proporcionas |
| **Porcentaje de formato incorrecto** | Porcentaje de valores que no están en un formato que eliges, como Email, UUID o Country Code, o que no coinciden con una expresión regular tuya (todos los motores salvo SQL Server y Dataverse) |
| **Recuento de filas huérfanas** | Filas cuyo valor no tiene correspondencia en la columna de otra tabla |
| **Número de filas** | Filas de la tabla, sobre todo útil con **Segmentar por** |
| **SQL personalizado** | El número que devuelve un SELECT tuyo de solo lectura, llamado `value` (en MongoDB, el de un pipeline de agregación) |
| **Filas con error** | Cuántas filas devuelve un SELECT tuyo de solo lectura: las filas que no deberían existir. 0 es saludable (en MongoDB, los documentos con los que termina un pipeline) |

Cada comprobación se ejecuta cada 15 minutos, cada hora, cada 6 horas o cada día, como una única sentencia de agregación en una transacción de solo lectura con un tiempo de espera de sentencia. Su valor se escribe como `oneuptime.data.check.value`, con `oneuptime.data.check.id`, `oneuptime.data.check.name` y `oneuptime.data.check.segment`.

## Comprobaciones sugeridas

**Comprobaciones sugeridas**, en la misma pestaña, ofrece las comprobaciones que piden las columnas de una tabla, solo a partir de sus nombres y tipos: un id es único, un `customer_id` tiene una fila correspondiente en `customers`, un correo electrónico tiene forma de correo, un importe no es negativo, un estado mantiene sus valores habituales y una tabla dividida por inquilino se cuenta por inquilino. Una columna que Seguridad de datos sabe que contiene una dirección de correo, un número de teléfono o una dirección IP se somete a ese formato, se llame como se llame. Añade una, añádelas todas o descarta una para siempre.

## Una comprobación a partir de una frase

**Escribir una comprobación a partir de una frase** convierte una regla como «los pedidos nunca tienen un total negativo» en una comprobación de SQL personalizado que cuenta las filas que la incumplen, en el propio SQL de tu motor, con una alerta en cuanto haya alguna. Lees la consulta antes de que **Añadir comprobación** la añada, y se le aplica todo lo que se aplica a cualquier comprobación de SQL personalizado. Necesita que OneUptime AI esté activado para el proyecto. En MongoDB, el resultado es un pipeline de agregación.

## Segmentos

**Segmentar por** ejecuta una comprobación una vez por cada valor de una columna, como un inquilino o una región: una serie y una alerta para cada uno, para los 100 segmentos más grandes. Un número de filas segmentado alerta cuando un inquilino deja de enviar datos mientras los demás siguen.

## Alertas sobre una comprobación

Configura **Alertar cuando** para alertar sobre una comprobación:

- **Inusualmente alto** o **Inusualmente bajo** compara cada valor con su propia línea base aprendida para esa hora de la semana.
- **Por encima de** o **Por debajo de** lo compara con un umbral.

Al guardar la comprobación se crea un monitor de métricas para ella, en tu nombre y con tus permisos. Si vacías la condición, se elimina el monitor.

El **Estado** de una comprobación, en **Comprobaciones** y en la pestaña **Comprobaciones** de su tabla, dice cómo está: **Fallando** mientras su alerta está abierta, **Cumple** mientras no lo está, y **No se pudo ejecutar** cuando su consulta falló. Una comprobación sin alerta solo muestra **Ejecutó**: su consulta funcionó. Una comprobación que falla, y una que no se pudo ejecutar, aparece también en **Vista general**.

## Lo que cuesta una comprobación

Una comprobación compite con tu aplicación por la base de datos, y en un almacén de datos que factura por lo que lee una consulta, cuesta dinero. Tres cosas lo mantienen bajo control:

- **Porcentaje de muestra** lee una parte de las filas en lugar de todas, para una comprobación que lee una tasa: Porcentaje de nulos, Promedio, Porcentaje de valores no válidos y Porcentaje de formato incorrecto. La mayoría de los motores se saltan páginas enteras de la tabla; MySQL, Redshift, ClickHouse y MongoDB siguen leyendo todas las filas, y se ahorran el trabajo con el resto. Dataverse no toma muestras: una comprobación allí lee todas las filas. Una vista puede rechazarlo, y la comprobación lo indica.
- **Máximo que puede leer una comprobación (GB)**, en **Ajustes**, detiene una comprobación en BigQuery o Athena antes de que lea más de esos gigabytes. Es 10 hasta que lo cambies.
- **Esperar cuando una base de datos está ocupada**, en **Ajustes**, deja las comprobaciones pendientes para la siguiente recopilación cuando una base de datos de PostgreSQL, MySQL o SQL Server parece ocupada. Está activado hasta que lo desactives, y la base de datos indica cuándo esperaron las comprobaciones.

## Filas que fallan

Un número dice que algo va mal; unas pocas filas dicen qué. **Guardar filas que fallan** en **Ajustes** guarda hasta 20 de las filas que encontró una comprobación Filas con error, Porcentaje de valores no válidos, Porcentaje de formato incorrecto o Recuento de filas huérfanas, y **Filas con error** en la comprobación las muestra. Está desactivado hasta que lo actives. Las columnas sensibles se enmascaran donde se lee la fila, según lo que Seguridad de datos encontró en ellas o según sus nombres, así que lo que sale de la base de datos, o de una sonda, ya está enmascarado. Una columna sensible que ningún análisis haya encontrado y cuyo nombre no la delate se guarda tal cual.

Las filas se almacenan en OneUptime: en los servidores de OneUptime con OneUptime Cloud, y en los tuyos con una instalación autoalojada. Cualquiera que pueda leer las comprobaciones del proyecto puede verlas. Una comprobación guarda solo las filas de su última ejecución, y al desactivar **Guardar filas que fallan** se elimina lo que guardó cada comprobación.

## Comprobaciones en un archivo

Las comprobaciones escritas a mano se desvían del código que cambia las tablas. Guárdalas en tu repositorio, revisadas en la misma pull request:

```yaml
checks:
  - name: Orders have a total
    table: public.orders
    type: Null Percent
    column: total
    every: 60
    alert: { when: Above, threshold: 1 }
  - name: Emails look right
    table: public.customers
    database: Orders database
    type: Format Mismatch Percent
    column: email
    format: Email
    sample_percent: 10
  - name: Orders have a customer
    table: public.orders
    type: Orphan Count
    column: customer_id
    references: public.customers.id
  - name: No negative totals
    table: public.orders
    type: Failing Rows
    query: SELECT id FROM orders WHERE total < 0
    alert: { when: Above, threshold: 0 }
```

Aplícalo desde CI con la [CLI de OneUptime](/docs/cli/index) y una clave de API:

```bash
oneuptime data-checks apply checks.yaml --dry-run
oneuptime data-checks apply checks.yaml --prune
```

Una comprobación es la misma comprobación si tiene el mismo nombre en la misma tabla, así que aplicar un archivo dos veces no cambia nada. Un error en cualquier parte del archivo no aplica nada y termina con un error, así que ejecuta `--dry-run` en la pull request y aplica al fusionar. Con `--prune`, se elimina una comprobación que creó una aplicación anterior y que el archivo ya no nombra. Una comprobación que añadiste a mano nunca se elimina. Una comprobación de un archivo lo indica en su fila, y su siguiente aplicación sobrescribe lo que se cambió a mano.

Las claves son `name`, `table`, `database`, `type`, `column`, `segment`, `accepted_values`, `format`, `pattern`, `references`, `query`, `sample_percent`, `every`, `alert`, `description` y `enabled`.

## Conciliaciones

Las copias se desvían: el almacén de datos tiene menos pedidos que la base de datos de la aplicación, o una migración perdió filas. Una conciliación compara una medida de dos tablas, en una base de datos o en dos, en **Conciliaciones**:

- **Número de filas**
- **Suma** de una columna
- **Recuento de valores distintos** de una columna
- **SQL personalizado**: una consulta de solo lectura que devuelve un número, llamado `value`

Tiene una tolerancia: una cantidad fija (**Absoluta**) o un porcentaje del valor de la fuente (**Porcentaje**). Cada lado lo lee una comprobación propia, que la conciliación crea y mantiene, junto con la recopilación de su base de datos, de modo que una conciliación puede comparar una tabla de PostgreSQL de tu red con su copia en Snowflake. Los dos valores se comparan en cuanto ambos se han leído con no más de 15 minutos de diferencia. Una conciliación escribe:

- `oneuptime.data.reconciliation.drifted`: 1 cuando los dos se han desviado más allá de la tolerancia, 0 cuando coinciden. Su monitor lee este valor.
- `oneuptime.data.reconciliation.difference`: el valor del destino menos el de la fuente.
- `oneuptime.data.reconciliation.difference_percent`: la diferencia como porcentaje del valor de la fuente.

Una copia que se carga según una programación va por detrás de su fuente: compara con SQL personalizado una medida en la que ambas ya coinciden, como las filas de hace más de una hora, o ten en cuenta el retraso en la tolerancia.

## Pruebas de dbt

Después de un build de dbt, `oneuptime dbt upload` envía los artefactos del proyecto (consulta [Linaje y pipelines](/docs/data-observability/lineage-and-pipelines)). Cada prueba de una tabla vigilada aparece entonces en su pestaña **Comprobaciones**, con su último resultado y las filas que encontró fallando. Elige **Alertar en caso de fallo** para que una prueba fallida abra una alerta.

## Próximos pasos

:::cards
- [Linaje y pipelines](/docs/data-observability/lineage-and-pipelines): Envía los artefactos de dbt y ve la ejecución que hay detrás de una comprobación fallida.
- [Productos de datos](/docs/data-observability/data-products): Promete a las personas que usan los datos que están actualizados.
:::
