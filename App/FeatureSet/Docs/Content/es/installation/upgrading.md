# Actualización de OneUptime

Esta guía explica cómo actualizar de forma segura tu instalación auto-alojada de OneUptime.

## Orientación general

- Actualiza paso a paso entre versiones principales (por ejemplo, 6 → 7 → 8). No omitas versiones principales.
- Puedes saltar versiones menores/de parche (por ejemplo, 8.1 → 8.4) siempre que sigas las notas de la versión.
- Siempre realiza copias de seguridad antes de actualizar y valida que puedas restaurarlas.

## Actualización de OneUptime 11 → 12

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the v12 Runner merge). -->

OneUptime 12 merges two components into one. The **Runbook Agent** (the
container you installed on your own hosts to execute runbook steps) and the
**AI Agent** (the service that worked on AI code fixes) are now a single
component: the **OneUptime Runner**, shipped as the `oneuptime/runner`
Docker image. The old `oneuptime/runbook-agent` and `oneuptime/ai-agent`
images are no longer built or published — existing tags remain pullable,
but they will never receive another update.

A Runner is one installed container that can hold several **capabilities**,
toggled per Runner in the dashboard: **Runs Runbooks** (on by default),
**Runs AI Code Fixes** (off by default), and **Runs AI Remediation Commands** (off by
default). Capability changes are adopted on the Runner's next heartbeat —
no restart needed. See [Runners](/docs/runbooks/agents) for how the
component works day to day.

What you need to do depends on how you deployed:

- **Everyone:** read [What happens automatically](#what-happens-automatically)
  and [Dashboard pages moved](#dashboard-pages-moved).
- **You installed Runbook Agents on your hosts:** redeploy them onto the new
  image — see [Redeploy your Runbook Agents](#redeploy-your-runbook-agents).
- **Docker Compose:** environment variable renames plus **one
  security-relevant step** — see [Docker Compose deployments](#docker-compose-deployments).
- **Helm:** a values-file rename that fails validation if skipped — see
  [Helm deployments](#helm-deployments).
- **API keys that were granted agent permissions directly:** re-grant them —
  see [Permissions: teams migrate, API keys do not](#permissions-teams-migrate-api-keys-do-not).

### What happens automatically

No manual database work. On first boot, v12 runs a migration that:

- Renames the Postgres tables and columns (`RunbookAgent` → `Runner`,
  `RunbookAgentJob` → `RunnerJob`, plus the owner, label, and join tables to
  match). Runner ids, keys, and job history are untouched — this is a
  rename, not a re-registration.
- Migrates every **team** permission grant from the old `…RunbookAgent…`
  permission names to the new `…Runner…` names, so team roles keep working
  without reassignment. (Direct API-key grants are the exception — see below.)

The API stays compatible too:

- Requests to `/api/runbook-agent`, `/api/runbook-agent-job`,
  `/api/runbook-agent-owner-team`, and `/api/runbook-agent-owner-user` are
  rewritten server-side onto their `/runner…` equivalents, so existing
  scripts keep working.
- The agent-facing ingest path `/runbook-agent-ingest` is still served
  alongside the new `/runner-ingest`, so **Runbook Agent containers you have
  not redeployed yet keep heartbeating and executing Bash and JavaScript
  steps** against a v12 server. Each one logs a deprecation warning on the
  server naming the agent that should be redeployed.

### Redeploy your Runbook Agents

Your existing agents keep running Bash and JavaScript steps unchanged, so
this does not block the upgrade — but do it soon after:

- **SSH and Kubernetes steps (new in v12) fail on old agents.** The server
  does not exclude old agents from claiming them: an agent still on the
  `runbook-agent` image will claim an SSH or Kubernetes job and fail it with
  `Unsupported step type` — typically mid-incident, when the runbook runs.
  Redeploy the agent **before** authoring SSH or Kubernetes steps that
  target it.
- The old image receives no further updates of any kind.

Redeploying means re-running the install command with the new image and
variable names. The agent's id and key are **unchanged** (same database
row) — swap the names, keep the values:

```bash
docker rm -f oneuptime-runbook-agent

docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<agent-id> \
  -e ONEUPTIME_RUNNER_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runner:release
```

(Or open the Runner in **Settings → Runners** and use **Show setup
instructions** for a pre-filled command.)

If you tuned the agent with environment variables, rename them — the old
names are **silently ignored** by the new image:

| Old (Runbook Agent)                     | New (Runner)                              |
| --------------------------------------- | ----------------------------------------- |
| `RUNBOOK_AGENT_ID`                       | `ONEUPTIME_RUNNER_ID`                     |
| `RUNBOOK_AGENT_KEY`                      | `ONEUPTIME_RUNNER_KEY`                    |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS`         | `ONEUPTIME_RUNNER_POLL_INTERVAL_MS`       |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS`    | `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS`  |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS`| `ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS` |
| `RUNBOOK_AGENT_CONCURRENCY`              | `ONEUPTIME_RUNNER_CONCURRENCY`            |

### If you ran the standalone AI Agent

The **Settings → AI → AI Agents** page is gone and the `oneuptime/ai-agent`
image is no longer built. If you had installed an AI Agent container
yourself, replace it with a Runner:

1. Create a Runner under **Settings → Runners** and install it with the
   command from **Show setup instructions**.
2. Enable **Runs AI Code Fixes** on it. The change is picked up on the next
   heartbeat.

Old AI Agent credentials still boot the new `oneuptime/runner` image
through a legacy fallback (code fixes only, with a logged warning telling
you to create a real Runner) — treat that as a bridge during the migration,
not a destination.

### Docker Compose deployments

The compose service `ai-agent` is now `runner`. If you upgrade with the
standard `update.sh` flow, the new variables are appended to your
`config.env` automatically and the stack boots — but read the key warning
below. The renames, if you manage `config.env` or overrides by hand:

| Old                              | New                                |
| -------------------------------- | ---------------------------------- |
| `AI_AGENT_KEY`                   | `ONEUPTIME_RUNNER_KEY`             |
| `AI_AGENT_ONEUPTIME_URL`         | `ONEUPTIME_RUNNER_ONEUPTIME_URL`   |
| `AI_AGENT_PORT`                  | `ONEUPTIME_RUNNER_PORT`            |
| `DISABLE_TELEMETRY_FOR_AI_AGENT` | `DISABLE_TELEMETRY_FOR_RUNNER`     |
| `ENABLE_PROFILING_FOR_AI_AGENT`  | `ENABLE_PROFILING_FOR_RUNNER`      |

The old `AI_AGENT_*` lines can stay in `config.env`; nothing reads them
anymore.

**Important — set `ONEUPTIME_RUNNER_KEY` to a random value.** The template
merge appends it with the literal placeholder
`please-change-this-to-random-value`; your old `AI_AGENT_KEY` value is
**not** carried over. This key registers the instance-wide Runner and
authenticates the AI code-fix protocol — including minting repository
access tokens — so leaving the publicly known placeholder in place is a
security hole. Before starting v12, set it to a long random value (reusing
your old `AI_AGENT_KEY` value is fine).

**Remove the orphaned `ai-agent` container.** `npm start` runs compose with
`--remove-orphans` and cleans it up. If you run `docker compose up -d` by
hand, add `--remove-orphans` (or `docker rm -f` the old container) —
otherwise the old AI Agent keeps running and keeps claiming code-fix work
alongside the new Runner.

### Helm deployments

- Rename the `aiAgent:` block in your values overrides to `runner:`. All
  subkeys (`enabled`, `replicaCount`, `resources`, `keda`, and so on) are
  unchanged. This is a hard break: the chart schema rejects unknown keys,
  so `helm upgrade` **fails validation** while an `aiAgent:` block remains.
- Workload names change from `<release>-ai-agent` to `<release>-runner` —
  update anything keyed on the old names (dashboards, alerts, network
  policies).
- The release secret key changes from `ai-agent-key` to `runner-key`. A
  fresh key is generated on upgrade and the in-cluster Runner re-registers
  itself automatically, so there is nothing to do unless something external
  referenced the old secret value.
- Deliberately unchanged: the KEDA scaling metric is still named
  `oneuptime_ai_agent_queue_size` — do not rename it in custom scalers.

### Permissions: teams migrate, API keys do not

Twelve permissions were renamed (`CreateRunbookAgent` → `CreateRunner`,
`EditRunbookAgent` → `EditRunner`, `DeleteRunbookAgent` → `DeleteRunner`,
`ReadRunbookAgent` → `ReadRunner`, and the same four verbs for
`…RunbookAgentOwnerTeam` → `…RunnerOwnerTeam` and
`…RunbookAgentOwnerUser` → `…RunnerOwnerUser`). Grants held through
**teams** are migrated automatically. Grants attached **directly to an API
key** are not — a key that held one of these twelve permissions loses that
access after the upgrade. Re-grant the new `…Runner…` permissions on those
keys in the dashboard. The `RunbookSecret`, `RunbookCredential`, and
`RunbookExecution` permission families kept their names.

Separately, v12 closes a hole: starting a runbook execution now requires
an authenticated caller with `ProjectOwner`, `ProjectAdmin`,
`ProjectMember`, `CreateRunbookExecution`, `RunbookAdmin`, or
`RunbookMember` — advancing or cancelling one also accepts
`EditRunbookExecution`. Unauthenticated triggering no longer works, and
read-only roles (for example `RunbookViewer`) can no longer start runs —
API automation that triggers runbooks needs `CreateRunbookExecution`.

### Dashboard pages moved

There are no redirects from the old URLs — update bookmarks and internal
wiki links:

| Page                    | Old location                             | New location                              |
| ----------------------- | ---------------------------------------- | ----------------------------------------- |
| Runners (was "Agents")  | Runbooks → Settings → Agents (`…/runbooks/settings/agents`) | Settings → Runners (`…/settings/runners`) |
| Runner Credentials      | Runbooks → Settings → Credentials (`…/runbooks/settings/credentials`) | Settings → Runner Credentials (`…/settings/runner-credentials`) |
| AI Agents               | Settings → AI → AI Agents (`…/settings/ai-agents`) | Removed — Runners with the **Runs AI Code Fixes** capability replace it |

Runbook Secrets stays where it was, under Runbooks → Settings → Secrets.

### New in 12, nothing to enable by accident

v12 adds AI-composed remediation commands: the AI can propose a command
plan and hand it to a Runner for execution. Everything about it is off by
default and stays off until you opt in twice — the project-level **AI
command execution** setting and the per-Runner **Runs AI Remediation Commands**
capability must both be enabled, and only runbooks/rules you configure for
it participate. Upgrading changes nothing here.

> Tip: as with every major upgrade, back up Postgres before upgrading (a
> rollback to v11 means restoring that backup), test in staging first, and
> upgrade step-by-step — 11 → 12, do not skip from older majors.

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
