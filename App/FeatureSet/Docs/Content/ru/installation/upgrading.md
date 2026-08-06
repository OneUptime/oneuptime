# Обновление OneUptime

В этом руководстве описывается безопасное обновление самостоятельно размещённой установки OneUptime.

## Общие рекомендации

- Обновляйтесь пошагово между основными версиями (например, 6 → 7 → 8). Не пропускайте основные версии.
- Вы можете перескакивать через минорные/патч-версии (например, 8.1 → 8.4), пока следуете примечаниям к выпуску.
- Всегда делайте резервные копии перед обновлением и проверяйте возможность их восстановления.

## Обновление OneUptime 11 → 12

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the v12 Runner merge). -->

OneUptime 12 merges two components into one. The **Runbook Agent** (the
container you installed on your own hosts to execute runbook steps) and the
**AI Agent** (the service that worked on AI code fixes) are now a single
component: the **OneUptime Runner**, shipped as the `oneuptime/runner`
Docker image. The old `oneuptime/runbook-agent` and `oneuptime/ai-agent`
images are no longer built or published — existing tags remain pullable,
but they will never receive another update.

A Runner is one installed container that can hold several **capabilities**,
toggled per Runner in the dashboard: **Выполняет сценарии** (on by default),
**Выполняет ИИ-исправления кода** (off by default), and **Выполняет ИИ-команды устранения** (off by
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

(Or open the Runner in **Настройки → Агенты runbook-ов** and use **Показать инструкции
по настройке** for a pre-filled command.)

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

The **Настройки → ИИ → Агенты ИИ** page is gone and the `oneuptime/ai-agent`
image is no longer built. If you had installed an AI Agent container
yourself, replace it with a Runner:

1. Create a Runner under **Настройки → Агенты runbook-ов** and install it with the
   command from **Показать инструкции по настройке**.
2. Enable **Выполняет ИИ-исправления кода** on it. The change is picked up on the next
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

| Page                    | Old location                                                                         | New location                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Runners (was "Agents")  | Сборники инструкций → Настройки → Агенты (`…/runbooks/settings/agents`)              | Настройки → Агенты runbook-ов (`…/settings/runners`)                               |
| Runner Credentials      | Сборники инструкций → Настройки → Учётные данные (`…/runbooks/settings/credentials`) | Настройки → Runner Credentials (`…/settings/runner-credentials`)                   |
| AI Agents               | Настройки → ИИ → Агенты ИИ (`…/settings/ai-agents`)                                  | Removed — Runners with the **Выполняет ИИ-исправления кода** capability replace it |

Runbook Secrets stays where it was, under Сборники инструкций → Настройки → Секреты.

### New in 12, nothing to enable by accident

v12 adds AI-composed remediation commands: the AI can propose a command
plan and hand it to a Runner for execution. Everything about it is off by
default and stays off until you opt in twice — the project-level **AI
command execution** setting and the per-Runner **Выполняет ИИ-команды устранения**
capability must both be enabled, and only runbooks/rules you configure for
it participate. Upgrading changes nothing here.

> Tip: as with every major upgrade, back up Postgres before upgrading (a
> rollback to v11 means restoring that backup), test in staging first, and
> upgrade step-by-step — 11 → 12, do not skip from older majors.

## Обновление OneUptime 10 → 11

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

OneUptime 11 перестраивает хранилище телеметрии ClickHouse. Эта страница объясняет, что меняется, кому нужно действовать и — для установок, которые хотят сохранить историческую телеметрию, — приводит каждый необходимый для этого запрос.

### Что меняется в v11

Телеметрия (логи, трейсы, метрики, исключения, профили, логи мониторов, журналы аудита) переносится в новые таблицы ClickHouse с партиционированием по времени, поколоночными кодеками сжатия и новыми колонками модели сущностей:

| Старая таблица        | Новая таблица         |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

Во всех таблицах телеметрии переименовываются две колонки: `serviceId` → `primaryEntityId` и `serviceType` → `primaryEntityType`. Это жёсткое переименование — **если вы напрямую обращаетесь к analytics-API OneUptime с фильтрами `serviceId`/`serviceType`, обновите их на новые имена.** Дашборды, мониторы и алерты внутри OneUptime мигрируются автоматически.

Переход выполняется **только вперёд**: новые таблицы начинают с нуля, вся телеметрия, поступающая после обновления, сразу попадает в них, а история со временем накапливается естественным образом. Старые таблицы **автоматически удаляются** во время обновления, чтобы освободить занимаемое ими место на диске — если вы хотите сохранить возможность перенести историю, переименуйте их **до** обновления (Шаг 0 ниже).

> **Уже на 11.0.0 или 11.0.1?** Эти релизы сохраняли старые таблицы (они опустошались по TTL, а копирование можно было выполнить «в любой момент после обновления»). Любое последующее обновление **удаляет их при запуске**. Если вы всё ещё хотите выполнить копирование истории и ещё не сделали этого, выполните Шаг 0 ниже до установки обновления.

### Кому нужно что-то делать

- **Новые установки:** ничего делать не нужно.
- **Обновления, которым не нужна телеметрия за период до обновления в интерфейсе:** ничего делать не нужно. Страницы телеметрии просто показывают данные с момента обновления; старые таблицы удаляются во время обновления.
- **Обновления, которым нужна телеметрия за период до обновления:** переименуйте старые таблицы **до** обновления (Шаг 0 ниже), а затем выполните ручное копирование в любой момент после него.

Как всегда: обновляйте мажорные версии по очереди (10 → 11, не пропускайте) и делайте резервные копии Postgres и ClickHouse перед обновлением.

### Опционально: перенос истории телеметрии

Шаг 0 выполняется **до обновления**; всё начиная с Шага 1 выполняется **после полного запуска обновлённой системы** (новые таблицы и их материализованные представления должны существовать). Подключайтесь напрямую на хосте ClickHouse — у нативного протокола нет HTTP-таймаутов, поэтому многочасовые запросы не проблема:

```bash
clickhouse-client --database oneuptime
```

Полезно знать перед началом:

- Копирование можно безопасно выполнять, пока OneUptime работает. Новая телеметрия независимо пишется в новые таблицы; скопированная история заполняется позади неё.
- При больших объёмах (сотни ГБ) рассчитывайте на часы.
- Каждый запрос ниже несёт `insert_deduplication_token`, а новые таблицы поставляются с окном дедупликации — поэтому **повторный запуск запроса, упавшего на середине, безопасен** (уже вставленные блоки пропускаются, в том числе в свёртках метрик), при условии, что вы перезапускаете его достаточно быстро. При интенсивном живом приёме окно (последние 10 000 блоков вставки на таблицу) со временем вытесняет старые токены.
- Копирование метрик также автоматически перестраивает предагрегированные свёртки для дашбордов (каждая скопированная строка заново питает материализованные представления свёрток) — поэтому копирование метрик медленнее остальных; выполняйте его последним.

#### Шаг 0 — перед обновлением переименуйте старые таблицы

Обновление удаляет старые таблицы при запуске, поэтому сначала уберите из-под удара те, из которых вы хотите копировать. Остановите OneUptime (отмасштабируйте деплоймент в ноль), чтобы никто в них не писал и не мог их пересоздать, затем переименуйте — `RENAME TABLE` — мгновенная операция над метаданными, а `IF EXISTS` позволяет блоку пропускать таблицы, которых у вашей установки никогда не было (у деплойментов старше середины 10.0.x может не быть `AuditLogV1` или некоторых таблиц `…V2` — истории этого типа для копирования тогда нет):

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

Затем обновитесь и дождитесь полного запуска OneUptime, прежде чем продолжать.

> Если после переименования вы откатываетесь на v10 (v10 при запуске пересоздаёт пустые таблицы со старыми именами), переименуйте таблицы `_backup` обратно в исходные имена до перезапуска v10 — иначе телеметрия, принятая во время отката, попадёт в пересозданные таблицы и будет удалена при последующем обновлении.

#### Шаг 1 — перечислите исходные партиции

У каждой старой таблицы не больше 16 партиций. Для каждой исходной таблицы:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Шаг 2 — сгенерируйте запрос копирования

Наборы колонок могут немного различаться между установками (у старых деплойментов может не быть недавно добавленных колонок), поэтому генерируйте запрос из вашей живой схемы, а не копируйте фиксированный. Установите `src` и `dst` в клаузе `WITH` в одну из пар таблиц из таблицы выше (источник несёт суффикс `_backup` из Шага 0) и выполните:

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

Сгенерированный запрос копирует только общие для обеих таблиц колонки (новые колонки получают значения по умолчанию), на лету переименовывает `serviceId`/`serviceType`, детерминированно упорядочивает строки, чтобы повторный запуск порождал идентичные, дедуплицируемые блоки, и снимает ограничения на время выполнения и число партиций, которые нужны запросу такого размера.

#### Шаг 3 — выполняйте по одной партиции за раз

Возьмите сгенерированный запрос и подставьте вместо `{PARTITION}` (встречается дважды — в `WHERE` и в токене) каждый идентификатор партиции из Шага 1. Выполняйте запросы по одному, затем повторите Шаги 1–3 для каждой пары таблиц.

> Примечание: если исходная таблица была пропущена на Шаге 0, потому что её не было в вашей установке, Шаг 1 для этой пары завершится ошибкой `UNKNOWN_TABLE` — просто пропустите пару; истории этого типа для копирования нет.

Если запрос упал на середине, оперативно перезапустите **тот же** запрос — уже закоммиченные блоки дедуплицируются. Если перезапуск происходит значительно позже, сначала сравните количество строк (Шаг 5).

#### Шаг 4 (опционально) — история похостовой свёртки метрик

Скопированные сырые строки метрик автоматически перестраивают свёртки на уровне сервисов, но не **похостовую** свёртку (у старых строк нет ключа сущности хоста). Переименованная на Шаге 0 старая таблица свёртки — единственный источник этой истории; перенесите её, вычисляя новый ключ из имени хоста:

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

`ORDER BY` важен: благодаря ему повторный запуск порождает идентичные блоки вставки, которые токен дедупликации может распознать. Без него повторный запуск мог бы быть молча пропущен или посчитан дважды. (Краевой случай: имена хостов с `\`, `|` или `=` — недопустимыми по RFC 1123 символами — дали бы ключ, отличный от вычисляемого приложением; игнорируйте, если не знаете наверняка, что такие хосты у вас есть.)

#### Шаг 5 — проверьте

Сравните итоги по каждой паре таблиц (новая таблица содержит и строки, появившиеся после обновления, поэтому должна быть больше или равна старой):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Шаг 6 — удалите резервные таблицы

Переименованные таблицы сохраняют свой TTL хранения, поэтому опустошаются и сжимаются сами — но как только вы довольны копией, удалите их, чтобы сразу освободить диск:

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

(`max_table_size_to_drop = 0` снимает серверную защиту от удаления таблиц больше 50 ГБ только для этого запроса.)

> Совет: как и при любом мажорном обновлении, сначала протестируйте в staging-окружении и убедитесь, что телеметрия поступает в новые таблицы, прежде чем полагаться на копию в продакшене.

## Обновление с OneUptime 9 → 10

Изменений, требующих ручных действий, нет. Просто следуйте стандартному процессу обновления.

## Обновление с OneUptime 8 → 9

Helm-чарт больше не создаёт ресурс Kubernetes Ingress. OneUptime поставляется с контейнером шлюза ingress, который уже завершает TLS, управляет доменами страниц статуса и маршрутизирует трафик платформы, поэтому контроллер ingress кластера больше не нужен.

- Удалите все переопределения `oneuptimeIngress` из ваших пользовательских файлов `values.yaml` перед обновлением. Эти ключи теперь игнорируются и вызовут ошибки валидации, если оставить их.
- Убедитесь, что `nginx.service.type` отражает способ, которым вы хотите открыть встроенный шлюз ingress (например, `LoadBalancer`, `NodePort` или `ClusterIP` с внешним балансировщиком нагрузки).
- Проверьте, что записи DNS для страниц статуса или основных хостов по-прежнему указывают на Service или балансировщик нагрузки перед шлюзом ingress OneUptime.
- После обновления убедитесь, что TLS-сертификаты продолжают обновляться через встроенный шлюз и что домены страниц статуса разрешаются корректно.

## Обновление с OneUptime 7 → 8

Если вы работаете на Kubernetes, есть важные несовместимые изменения:

- Мы больше не используем чарты Bitnami для Postgres, Redis и ClickHouse из-за [изменений лицензии Bitnami](https://github.com/bitnami/charts/issues/35164)
- Эти изменения обратно несовместимы. Вы должны следовать новой структуре в `values.yaml` Helm-чарта.
- Создайте резервную копию ваших данных (Postgres, ClickHouse и все постоянные тома) перед обновлением.

> Совет: Сначала протестируйте обновление в тестовой среде. Убедитесь, что ваши рабочие нагрузки работоспособны и данные целы, прежде чем обновлять production.
