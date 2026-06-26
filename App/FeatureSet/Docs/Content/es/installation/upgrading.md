# Actualización de OneUptime

Esta guía explica cómo actualizar de forma segura tu instalación auto-alojada de OneUptime.

## Orientación general

- Actualiza paso a paso entre versiones principales (por ejemplo, 6 → 7 → 8). No omitas versiones principales.
- Puedes saltar versiones menores/de parche (por ejemplo, 8.1 → 8.4) siempre que sigas las notas de la versión.
- Siempre realiza copias de seguridad antes de actualizar y valida que puedas restaurarlas.

## Actualización de OneUptime 10 → 11

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for v11 SSO->Enterprise change). -->

### Identity features (SSO, OIDC, SCIM) now require the Enterprise Edition

In v11, the following authentication and access-management features moved to
the **OneUptime Enterprise Edition** and are no longer part of the free,
open-source (Community) build:

- **SAML SSO** — both project login and status-page login
- **OpenID Connect (OIDC)** — both project login and status-page login
- **SCIM user provisioning** — project and status page
- **Global (instance-wide) SSO / OIDC**
- **Team compliance settings**

**What you'll see after upgrading:** if you configured any of these on a
Community Edition build, sign-in through them is disabled after the upgrade,
and the settings pages show an upgrade prompt instead of the configuration
form. Your existing provider records are **preserved in the database** —
nothing is deleted — they simply become inactive until the instance runs the
Enterprise Edition.

**Availability:**

- **Self-hosted:** requires the **Enterprise Edition** build.
- **OneUptime Cloud:** requires the **Scale** plan (or above).

**If you rely on SSO and self-host**, email
[support@oneuptime.com](mailto:support@oneuptime.com) for an Enterprise Edition
license so you can restore SSO/OIDC/SCIM. Mention that you upgraded from v10 to
v11 and we'll help you get it back online. If your team is mid-upgrade and this
is blocking sign-in, contact us before upgrading production so we can plan it
with you.

OneUptime 11 reconstruye el almacenamiento de telemetría de ClickHouse. Esta página explica qué cambia, quién debe actuar y — para las instalaciones que quieran conservar la telemetría histórica — cada consulta necesaria para hacerlo.

### Qué cambia en la v11

La telemetría (logs, trazas, métricas, excepciones, perfiles, logs de monitores, logs de auditoría) se traslada a nuevas tablas de ClickHouse con particionado temporal, códecs de compresión por columna y las nuevas columnas del modelo de entidades:

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

Se renombran dos columnas en todas las tablas de telemetría: `serviceId` → `primaryEntityId` y `serviceType` → `primaryEntityType`. Es un renombrado estricto — **si consulta directamente la API de analytics de OneUptime con filtros `serviceId`/`serviceType`, actualícelos a los nuevos nombres.** Los dashboards, monitores y alertas dentro de OneUptime se migran automáticamente.

El corte es **solo hacia adelante**: las tablas nuevas empiezan vacías, toda la telemetría ingerida tras la actualización aterriza en ellas de inmediato y el histórico se va rellenando de forma natural con el tiempo. Las tablas antiguas se **eliminan automáticamente** durante la actualización para recuperar su espacio en disco — si quiere conservar la opción de trasladar el histórico, renómbrelas **antes** de actualizar (Paso 0 más abajo).

> **¿Ya está en 11.0.0 u 11.0.1?** Esas versiones conservaban las tablas antiguas (se vaciaban mediante la TTL y la copia podía ejecutarse «en cualquier momento después de la actualización»). Cualquier actualización posterior **las elimina al arrancar**. Si todavía quiere hacer la copia del histórico y aún no la ha realizado, ejecute el Paso 0 más abajo antes de aplicar la actualización.

### Quién debe hacer algo

- **Instalaciones nuevas:** nada que hacer.
- **Actualizaciones que no necesitan la telemetría previa en la interfaz:** nada que hacer. Las páginas de telemetría simplemente muestran datos desde el momento de la actualización; las tablas antiguas se eliminan durante la actualización.
- **Actualizaciones que quieren ver la telemetría previa:** renombre las tablas antiguas **antes** de la actualización (Paso 0 más abajo) y ejecute después la copia manual en cualquier momento.

Como siempre: actualice las versiones mayores paso a paso (10 → 11, sin saltarse ninguna) y haga copias de seguridad de Postgres y ClickHouse antes de actualizar.

### Opcional: trasladar el histórico de telemetría

El Paso 0 se ejecuta **antes de la actualización**; todo lo demás, a partir del Paso 1, se ejecuta **después de que la actualización haya arrancado por completo** (las tablas nuevas y sus vistas materializadas deben existir). Conéctese directamente en su host de ClickHouse — el protocolo nativo no tiene timeouts HTTP, así que las sentencias de varias horas no son un problema:

```bash
clickhouse-client --database oneuptime
```

Conviene saber antes de empezar:

- La copia puede ejecutarse con seguridad mientras OneUptime está en producción. La telemetría nueva se escribe de forma independiente en las tablas nuevas; el histórico copiado se rellena por detrás.
- Cuente con varias horas a gran escala (cientos de GB).
- Cada sentencia de abajo lleva un `insert_deduplication_token`, y las tablas nuevas incluyen una ventana de deduplicación — por lo que **volver a ejecutar una sentencia que falló a medias es seguro** (los bloques ya insertados se omiten, también en los rollups de métricas), siempre que la reejecute pronto. Con mucha ingesta en vivo, la ventana (los últimos 10 000 bloques de inserción por tabla) acaba desalojando los tokens antiguos.
- Copiar las métricas también reconstruye automáticamente los rollups preagregados de los dashboards (cada fila copiada realimenta las vistas materializadas de rollup) — esto hace que la copia de métricas sea más lenta que las demás; ejecútela en último lugar.

#### Paso 0 — antes de actualizar, renombre las tablas antiguas

La actualización elimina las tablas antiguas al arrancar, así que ponga primero fuera de su alcance las que quiera usar como origen de la copia. Detenga OneUptime (escale el despliegue a cero) para que nada escriba en ellas ni pueda recrearlas, y luego renómbrelas — `RENAME TABLE` es una operación de metadatos instantánea, e `IF EXISTS` permite que el bloque omita las tablas que su instalación nunca tuvo (los despliegues anteriores a mediados de 10.0.x pueden carecer de `AuditLogV1` o de algunas tablas `…V2` — en ese caso no hay histórico de ese tipo que copiar):

```sql
RENAME TABLE IF EXISTS LogItemV2 TO LogItemV2_backup;
RENAME TABLE IF EXISTS MetricItemV2 TO MetricItemV2_backup;
RENAME TABLE IF EXISTS SpanItemV2 TO SpanItemV2_backup;
RENAME TABLE IF EXISTS ExceptionItemV2 TO ExceptionItemV2_backup;
RENAME TABLE IF EXISTS ProfileItemV2 TO ProfileItemV2_backup;
RENAME TABLE IF EXISTS ProfileSampleItemV2 TO ProfileSampleItemV2_backup;
RENAME TABLE IF EXISTS MonitorLogV2 TO MonitorLogV2_backup;
RENAME TABLE IF EXISTS AuditLogV1 TO AuditLogV1_backup;
RENAME TABLE IF EXISTS MetricItemAggMV1mByHost TO MetricItemAggMV1mByHost_backup;
```

Después actualice y deje que OneUptime arranque por completo antes de continuar.

> Si vuelve a la v10 después de renombrar (la v10 recrea al arrancar tablas vacías con los nombres antiguos), renombre las tablas `_backup` de vuelta a sus nombres originales antes de reiniciar la v10 — de lo contrario, la telemetría ingerida durante la marcha atrás aterriza en las tablas recreadas y se eliminará en la futura actualización.

#### Paso 1 — listar las particiones de origen

Cada tabla antigua tiene como máximo 16 particiones. Para cada tabla de origen:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Paso 2 — generar la sentencia de copia

Los conjuntos de columnas pueden diferir ligeramente entre instalaciones (a los despliegues más antiguos pueden faltarles columnas añadidas recientemente), así que genere la sentencia a partir de su esquema real en lugar de copiar una fija. Ponga en `src` y `dst` de la cláusula `WITH` uno de los pares de tablas de la tabla anterior (el origen lleva el sufijo `_backup` del Paso 0) y ejecute:

```sql
WITH 'LogItemV2_backup' AS src, 'LogItemV3' AS dst
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

La sentencia generada copia solo las columnas que ambas tablas comparten (las columnas nuevas toman sus valores por defecto), renombra `serviceId`/`serviceType` al vuelo, ordena las filas de forma determinista para que una reejecución produzca bloques idénticos y deduplicables, y levanta los límites de tiempo de ejecución y número de particiones que una sentencia de este tamaño necesita.

#### Paso 3 — ejecutarla, partición a partición

Tome la sentencia generada y sustituya `{PARTITION}` (aparece dos veces — en el `WHERE` y en el token) por cada id de partición del Paso 1. Ejecute las sentencias una a una y repita después los Pasos 1–3 para cada par de tablas.

> Nota: si una tabla de origen se omitió en el Paso 0 porque no existía en su instalación, el Paso 1 falla con `UNKNOWN_TABLE` para ese par — simplemente omita el par; no hay histórico de ese tipo que copiar.

Si una sentencia falla a medias, vuelva a ejecutar pronto **la misma** sentencia — los bloques ya confirmados se deduplican. Si la reejecución es mucho más tarde, compare primero los recuentos de filas (Paso 5).

#### Paso 4 (opcional) — histórico del rollup de métricas por host

Las filas de métricas en bruto copiadas reconstruyen automáticamente los rollups a nivel de servicio, pero no el rollup **por host** (las filas antiguas no tienen clave de entidad de host). La tabla de rollup antigua renombrada en el Paso 0 es la única fuente de este histórico; trasládelo calculando la clave nueva a partir del nombre de host:

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
FROM MetricItemAggMV1mByHost_backup
ORDER BY projectId, name, hostIdentifier, bucketTime, _id
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

El `ORDER BY` importa: hace que una reejecución produzca bloques de inserción idénticos que el token de deduplicación puede reconocer. Sin él, una reejecución podría omitirse en silencio o contarse dos veces. (Caso límite: nombres de host que contengan `\`, `|` o `=` — caracteres no válidos según la RFC 1123 — calcularían una clave distinta a la de la aplicación; ignórelo salvo que sepa que tiene hosts así.)

#### Paso 5 — verificar

Compare los totales por par de tablas (la tabla nueva también contiene filas posteriores a la actualización, así que debería ser mayor o igual que la antigua):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Paso 6 — eliminar las copias de seguridad

Las tablas renombradas conservan su TTL de retención, así que se vacían y encogen solas — pero en cuanto esté satisfecho con la copia, elimínelas para recuperar el disco de inmediato:

```sql
DROP TABLE IF EXISTS LogItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS SpanItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ExceptionItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileSampleItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MonitorLogV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS AuditLogV1_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost_backup SETTINGS max_table_size_to_drop = 0;
```

(`max_table_size_to_drop = 0` levanta la protección de borrado de 50 GB del servidor solo para esa sentencia.)

> Consejo: como en toda actualización mayor, pruebe primero en un entorno de staging y confirme que la telemetría fluye hacia las tablas nuevas antes de confiar en la copia en producción.

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
