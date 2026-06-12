# Actualización de OneUptime

Esta guía explica cómo actualizar de forma segura tu instalación auto-alojada de OneUptime.

## Orientación general

- Actualiza paso a paso entre versiones principales (por ejemplo, 6 → 7 → 8). No omitas versiones principales.
- Puedes saltar versiones menores/de parche (por ejemplo, 8.1 → 8.4) siempre que sigas las notas de la versión.
- Siempre realiza copias de seguridad antes de actualizar y valida que puedas restaurarlas.

## Actualización de OneUptime 10 → 11

OneUptime 11 reconstruye el almacenamiento de telemetría en ClickHouse. Esta página explica
qué cambia, quién debe actuar y — para las instalaciones que quieran conservar
la telemetría histórica — cada consulta necesaria para hacerlo.

### Qué cambia en la v11

La telemetría (logs, trazas, métricas, excepciones, perfiles, logs de monitores,
logs de auditoría) se traslada a nuevas tablas de ClickHouse con particionado basado en tiempo,
códecs de compresión por columna y las nuevas columnas del modelo de entidades:

| Tabla antigua         | Tabla nueva           |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

Se renombran dos columnas en todas las tablas de telemetría: `serviceId` →
`primaryEntityId` y `serviceType` → `primaryEntityType`. Es un renombrado
definitivo — **si consultas directamente la API de analítica de OneUptime con
filtros `serviceId`/`serviceType`, actualízalos a los nuevos nombres.**
Los dashboards, monitores y alertas dentro de OneUptime se migran
automáticamente.

El corte es **solo hacia adelante**: las nuevas tablas empiezan vacías, toda la telemetría
ingerida después de la actualización aterriza en ellas de inmediato, y el historial se va
completando de forma natural con el paso del tiempo. Las tablas antiguas se **eliminan
automáticamente** durante la actualización para recuperar su disco — si quieres
conservar la opción de trasladar el historial, renómbralas **antes** de
actualizar (Paso 0 más abajo).

> **¿Ya estás en 11.0.0 u 11.0.1?** Esas versiones conservaban las tablas antiguas
> (se vaciaban mediante TTL y la copia podía ejecutarse "en cualquier momento
> después de la actualización"). Cualquier actualización posterior **las elimina
> al arrancar**. Si todavía quieres la copia del historial y aún no la has hecho,
> ejecuta el Paso 0 más abajo antes de aplicar la actualización.

### Quién debe hacer algo

- **Instalaciones nuevas:** nada que hacer.
- **Actualizaciones que no necesitan ver en la interfaz la telemetría previa a la actualización:** nada que
  hacer. Las páginas de telemetría simplemente muestran datos desde el momento de la actualización en adelante;
  las tablas antiguas se eliminan durante la actualización.
- **Actualizaciones que quieren tener visible la telemetría previa a la actualización:** renombra las tablas
  antiguas **antes** de la actualización (Paso 0 más abajo) y, después, ejecuta la copia
  manual en cualquier momento posterior.

Como siempre: actualiza las versiones principales paso a paso (10 → 11, sin saltarte ninguna),
y realiza copias de seguridad de Postgres y ClickHouse antes de actualizar.

### Opcional: conservar el historial de telemetría

El Paso 0 se ejecuta **antes de la actualización**; todo lo demás, a partir del Paso 1, se
ejecuta **después de que la actualización haya arrancado por completo** (las nuevas tablas y
sus vistas materializadas deben existir). Conéctate directamente en tu host de ClickHouse
— el protocolo nativo no tiene tiempos de espera HTTP, así que las sentencias de varias horas
no suponen problema:

```bash
clickhouse-client --database oneuptime
```

Conviene saber antes de empezar:

- La copia es segura de ejecutar con OneUptime en funcionamiento. La telemetría nueva se escribe
  en las nuevas tablas de forma independiente; el historial copiado se rellena por detrás.
- A gran escala (cientos de GB), espera que tarde horas.
- Cada sentencia de abajo lleva un `insert_deduplication_token`, y las
  nuevas tablas incluyen una ventana de deduplicación — de modo que **volver a ejecutar una
  sentencia que falló a medias es seguro** (los bloques ya insertados se
  omiten, incluidos los de los rollups de métricas), siempre que la vuelvas a ejecutar
  razonablemente pronto. Bajo una ingesta en vivo intensa, la ventana (los últimos 10.000 bloques
  de inserción por tabla) acaba desalojando los tokens antiguos.
- Copiar las métricas también reconstruye automáticamente los rollups pre-agregados
  de los dashboards (cada fila copiada vuelve a alimentar las vistas materializadas de rollup)
  — esto hace que la copia de métricas sea más lenta que las demás; ejecútala en último lugar.

#### Paso 1 — listar las particiones de origen

Cada tabla antigua tiene como máximo 16 particiones. Para cada tabla de origen:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2 ORDER BY _partition_id;
```

#### Paso 2 — generar la sentencia de copia

Los conjuntos de columnas pueden diferir ligeramente entre instalaciones (los despliegues más antiguos
pueden carecer de columnas añadidas recientemente), así que genera la sentencia a partir de tu
esquema en vivo en lugar de copiar y pegar una fija. Establece `src` y `dst` en
la cláusula `WITH` con uno de los pares de tablas de la tabla anterior, y
ejecuta:

```sql
WITH 'LogItemV2' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

La sentencia generada copia solo las columnas que comparten ambas tablas (las columnas
nuevas toman sus valores por defecto), renombra `serviceId`/`serviceType` sobre la
marcha, ordena las filas de forma determinista para que un reintento produzca bloques idénticos
y deduplicables, y levanta los límites de tiempo de ejecución y de número de particiones
que una sentencia de este tamaño necesita.

#### Paso 3 — ejecutarla, una partición a la vez

Toma la sentencia generada y sustituye `{PARTITION}` (aparece
dos veces — en el `WHERE` y en el token) por cada id de partición del
Paso 1. Ejecuta las sentencias una a una y, después, repite los Pasos 1–3 para cada
par de tablas.

Si una sentencia falla a medias, vuelve a ejecutar la **misma** sentencia enseguida —
los bloques ya confirmados se deduplican. Si la repites mucho más tarde, compara
antes los recuentos de filas (Paso 5).

#### Paso 4 (opcional) — historial del rollup de métricas por host

Las filas de métricas crudas copiadas reconstruyen automáticamente los rollups a nivel de servicio,
pero no el rollup **por host** (las filas antiguas no tienen clave de entidad de host). La
actualización deja intencionadamente en su sitio la tabla antigua de rollup por host para
que puedas conservarla, calculando la nueva clave a partir del nombre del host:

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

#### Paso 5 — verificar

Compara los totales por par de tablas (la tabla nueva también contiene filas
posteriores a la actualización, así que debería ser mayor o igual que la antigua):

```sql
SELECT
  (SELECT count() FROM LogItemV2) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Paso 6 (opcional) — recuperar espacio en disco antes

Las tablas antiguas se vacían por sí solas mediante TTL, pero una vez que estés satisfecho
con la copia puedes eliminarlas de inmediato:

```sql
DROP TABLE IF EXISTS LogItemV2;
DROP TABLE IF EXISTS MetricItemV2;
DROP TABLE IF EXISTS SpanItemV2;
DROP TABLE IF EXISTS ExceptionItemV2;
DROP TABLE IF EXISTS ProfileItemV2;
DROP TABLE IF EXISTS ProfileSampleItemV2;
DROP TABLE IF EXISTS MonitorLogV2;
DROP TABLE IF EXISTS AuditLogV1;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost;
```

> Consejo: como en toda actualización principal, prueba primero en un entorno de staging
> y confirma que la telemetría fluye hacia las nuevas tablas antes de confiar en
> la copia en producción.



## Actualización de OneUptime 9 → 10

No hay cambios que requieran acción manual. Simplemente sigue el proceso de actualización estándar.

## Actualización de OneUptime 8 → 9

El gráfico Helm ya no aprovisiona un recurso Kubernetes Ingress. OneUptime incluye un contenedor de puerta de enlace de ingreso que ya termina TLS, gestiona los dominios de las páginas de estado y enruta el tráfico para la plataforma, por lo que ya no es necesario un controlador de ingreso del clúster.

- Elimina cualquier anulación de `oneuptimeIngress` de tus archivos `values.yaml` personalizados antes de actualizar. Esas claves ahora se ignoran y causarán errores de validación si se dejan en su lugar.
- Asegúrate de que `nginx.service.type` refleje cómo deseas exponer la puerta de enlace de ingreso incluida (por ejemplo, `LoadBalancer`, `NodePort` o `ClusterIP` con un balanceador de carga externo).
- Verifica que cualquier registro DNS para páginas de estado o hosts principales aún apunte al Servicio o balanceador de carga que está frente a la puerta de enlace de ingreso de OneUptime.
- Después de la actualización, confirma que los certificados TLS continúen renovándose a través de la puerta de enlace integrada y que los dominios de las páginas de estado se resuelvan correctamente.


## Actualización de OneUptime 7 → 8

Si estás ejecutando en Kubernetes, hay cambios importantes que rompen la compatibilidad:

- Ya no usamos gráficos de Bitnami para Postgres, Redis y ClickHouse debido a [cambios en la licencia de Bitnami](https://github.com/bitnami/charts/issues/35164)
- Estos cambios no son compatibles con versiones anteriores. Debes seguir la nueva estructura en el `values.yaml` del gráfico Helm.
- Realiza una copia de seguridad de tus datos (Postgres, ClickHouse y cualquier volumen persistente) antes de actualizar.


> Consejo: Prueba la actualización en un entorno de staging primero. Confirma que tus cargas de trabajo están saludables y que los datos están intactos antes de actualizar en producción.
