# Uppgradera OneUptime

Den här guiden beskriver hur du säkert uppgraderar din egeninstallerade OneUptime-installation.

## Allmän vägledning

- Uppgradera steg för steg mellan huvudversioner (till exempel 6 → 7 → 8). Hoppa inte över huvudversioner.
- Du kan hoppa över minor/patch-versioner (till exempel 8.1 → 8.4) så länge du följer versionsnoteringarna.
- Ta alltid säkerhetskopior innan du uppgraderar och validera att du kan återställa dem.

## Uppgradering från OneUptime 11 → 12

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

## Uppgradering från OneUptime 10 → 11

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

OneUptime 11 bygger om ClickHouse-telemetrilagringen. Den här sidan förklarar vad som ändras, vem som behöver agera och — för installationer som vill ta med historisk telemetri — varje fråga som behövs för det.

### Vad ändras i v11

Telemetri (loggar, traces, mätvärden, exceptions, profiler, monitor-loggar, audit-loggar) flyttas till nya ClickHouse-tabeller med tidsbaserad partitionering, komprimeringskodekar per kolumn och de nya entitetsmodell-kolumnerna:

| Gammal tabell         | Ny tabell             |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

Två kolumner byter namn i alla telemetritabeller: `serviceId` → `primaryEntityId` och `serviceType` → `primaryEntityType`. Det är ett hårt namnbyte — **om du frågar OneUptimes analytics-API direkt med `serviceId`-/`serviceType`-filter ska du uppdatera dem till de nya namnen.** Dashboards, monitorer och larm inne i OneUptime migreras automatiskt.

Övergången är **endast framåtriktad**: de nya tabellerna börjar tomma, all telemetri som tas in efter uppgraderingen hamnar i dem direkt, och historiken fylls naturligt på med tiden. De gamla tabellerna **tas bort automatiskt** under uppgraderingen för att frigöra deras diskutrymme — vill du behålla möjligheten att ta med historiken, byt namn på dem **före** uppgraderingen (Steg 0 nedan).

> **Redan på 11.0.0 eller 11.0.1?** De utgåvorna behöll de gamla tabellerna (de tömdes via TTL, och kopian kunde köras ”när som helst efter uppgraderingen”). Varje senare uppdatering **tar bort dem vid uppstart**. Om du fortfarande vill göra historikkopian och inte har gjort den ännu, utför Steg 0 nedan innan du tillämpar uppdateringen.

### Vem behöver göra något

- **Nyinstallationer:** inget att göra.
- **Uppgraderingar som inte behöver telemetri från före uppgraderingen i gränssnittet:** inget att göra. Telemetrisidorna visar helt enkelt data från uppgraderingsögonblicket och framåt; de gamla tabellerna tas bort under uppgraderingen.
- **Uppgraderingar som vill se telemetri från före uppgraderingen:** byt namn på de gamla tabellerna **före** uppgraderingen (Steg 0 nedan) och kör sedan den manuella kopian när som helst efteråt.

Som alltid: uppgradera huvudversioner steg för steg (10 → 11, hoppa inte över) och ta säkerhetskopior av Postgres och ClickHouse före uppgraderingen.

### Valfritt: ta med telemetrihistoriken

Steg 0 utförs **före uppgraderingen**; allt från Steg 1 och framåt utförs **efter att uppgraderingen har startat helt** (de nya tabellerna och deras materialized views måste finnas). Anslut direkt på din ClickHouse-värd — det nativa protokollet har inga HTTP-timeouts, så satser som tar flera timmar är inga problem:

```bash
clickhouse-client --database oneuptime
```

Bra att veta innan du börjar:

- Kopian kan köras säkert medan OneUptime är live. Ny telemetri skrivs oberoende till de nya tabellerna; den kopierade historiken fylls på bakom.
- Räkna med timmar i stor skala (hundratals GB).
- Varje sats nedan bär ett `insert_deduplication_token`, och de nya tabellerna levereras med ett dedupliceringsfönster — så **det är säkert att köra om en sats som misslyckades halvvägs** (redan infogade block hoppas över, även i mätvärdes-rollups), förutsatt att du kör om den någorlunda snart. Vid tung live-intagning tränger fönstret (de senaste 10 000 insert-blocken per tabell) till slut ut gamla tokens.
- Kopiering av mätvärden bygger också automatiskt om de föraggregerade dashboard-rollups (varje kopierad rad matar rollup-materialized-views på nytt) — det gör mätvärdeskopian långsammare än de andra; kör den sist.

#### Steg 0 — byt namn på de gamla tabellerna före uppgraderingen

Uppgraderingen tar bort de gamla tabellerna vid uppstart, så flytta först de tabeller du vill kopiera ifrån utom räckhåll. Stoppa OneUptime (skala ner deploymentet) så att inget skriver till dem eller kan återskapa dem, och byt sedan namn — `RENAME TABLE` är en omedelbar metadata-operation, och `IF EXISTS` låter blocket hoppa över tabeller som din installation aldrig haft (deployments äldre än mitten av 10.0.x kan sakna `AuditLogV1` eller vissa `…V2`-tabeller — då finns ingen historik av den typen att kopiera):

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

Uppgradera sedan och låt OneUptime starta helt innan du fortsätter.

> Om du rullar tillbaka till v10 efter namnbytet (v10 återskapar tomma tabeller med de gamla namnen vid uppstart), byt tillbaka `_backup`-tabellerna till deras ursprungliga namn innan du startar om v10 — annars hamnar telemetri som tas in under tillbakarullningen i de återskapade tabellerna och tas bort vid den senare uppgraderingen.

#### Steg 1 — lista källpartitionerna

Varje gammal tabell har högst 16 partitioner. För varje källtabell:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Steg 2 — generera kopieringssatsen

Kolumnuppsättningarna kan skilja sig något mellan installationer (äldre deployments kan sakna nyligen tillagda kolumner), så generera satsen från ditt live-schema i stället för att klistra in en fast. Sätt `src` och `dst` i `WITH`-klausulen till ett av tabellparen från tabellen ovan (källan bär `_backup`-suffixet från Steg 0) och kör:

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

Den genererade satsen kopierar bara de kolumner båda tabellerna delar (nya kolumner får sina standardvärden), byter namn på `serviceId`/`serviceType` i farten, sorterar raderna deterministiskt så att en omkörning ger identiska, deduplicerbara block, och lyfter de gränser för körtid och partitionsantal som en sats av den här storleken behöver.

#### Steg 3 — kör den, en partition i taget

Ta den genererade satsen och ersätt `{PARTITION}` (förekommer två gånger — i `WHERE` och i tokenet) med varje partitions-id från Steg 1. Kör satserna en i taget och upprepa sedan Steg 1–3 för varje tabellpar.

> Obs: hoppades en källtabell över i Steg 0 för att den inte fanns på din installation, misslyckas Steg 1 med `UNKNOWN_TABLE` för det paret — hoppa helt enkelt över paret; det finns ingen historik av den typen att kopiera.

Om en sats misslyckas halvvägs, kör snabbt om **samma** sats — redan committade block dedupliceras. Kör du om mycket senare, jämför radantalen först (Steg 5).

#### Steg 4 (valfritt) — historik för mätvärdes-rollup per värd

Kopierade råa mätvärdesrader bygger automatiskt om rollups på tjänstenivå, men inte **per-värd**-rollupen (gamla rader saknar värd-entitetsnyckel). Den gamla rollup-tabellen som bytte namn i Steg 0 är den enda källan till denna historik; ta med den genom att beräkna den nya nyckeln från värdnamnet:

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

`ORDER BY` spelar roll: den gör att en omkörning producerar identiska insert-block som dedupliceringstokenet kan känna igen. Utan den kunde en omkörning hoppas över i tysthet eller räknas dubbelt. (Kantfall: värdnamn som innehåller `\`, `|` eller `=` — inte giltiga RFC-1123-värdnamnstecken — skulle beräkna en annan nyckel än applikationen; ignorera detta om du inte vet att du har sådana värdar.)

#### Steg 5 — verifiera

Jämför totalerna per tabellpar (den nya tabellen innehåller även rader från efter uppgraderingen, så den bör vara större än eller lika med den gamla):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Steg 6 — ta bort säkerhetskopiorna

Tabellerna med nya namn behåller sin retentions-TTL, så de töms och krymper av sig själva — men så snart du är nöjd med kopian, ta bort dem för att frigöra disken direkt:

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

(`max_table_size_to_drop = 0` lyfter serverns 50 GB-borttagningsskydd för just den satsen.)

> Tips: som vid varje större uppgradering, testa först i en staging-miljö och bekräfta att telemetri strömmar in i de nya tabellerna innan du litar på kopian i produktion.

## Uppgradera från OneUptime 9 → 10

Inga ändringar som kräver manuella åtgärder. Följ bara den vanliga uppgraderingsprocessen.

## Uppgradera från OneUptime 8 → 9

Helm-diagrammet tillhandahåller inte längre en Kubernetes Ingress-resurs. OneUptime levereras med en ingress gateway-container som redan avslutar TLS, hanterar statussidadomäner och dirigerar trafik för plattformen, så en kluster-ingress-kontroller är inte längre nödvändig.

- Ta bort eventuella `oneuptimeIngress`-åsidosättningar från dina anpassade `values.yaml`-filer innan uppgraderingen. Dessa nycklar ignoreras nu och orsakar valideringsfel om de lämnas kvar.
- Se till att `nginx.service.type` återspeglar hur du vill exponera den medföljande ingress-gatewayen (till exempel `LoadBalancer`, `NodePort` eller `ClusterIP` med en extern lastbalanserare).
- Verifiera att eventuella DNS-poster för statussidor eller primära värdar fortfarande pekar på den tjänst eller lastbalanserare som befinner sig framför OneUptime ingress gateway.
- Efter uppgraderingen, bekräfta att TLS-certifikat fortsätter att förnyas via den inbäddade gatewayen och att statussidadomäner löser sig korrekt.

## Uppgradera från OneUptime 7 → 8

Om du kör på Kubernetes finns det viktiga brytande ändringar:

- Vi använder inte längre Bitnami-diagram för Postgres, Redis och ClickHouse på grund av [Bitnami-licensändringar](https://github.com/bitnami/charts/issues/35164)
- Dessa ändringar är inte bakåtkompatibla. Du måste följa den nya strukturen i Helm-diagrammets `values.yaml`.
- Säkerhetskopiera dina data (Postgres, ClickHouse och eventuella persistenta volymer) innan uppgraderingen.

> Tips: Testa uppgraderingen i en staging-miljö först. Bekräfta att dina arbetsbelastningar är friska och att data är intakt innan du uppgraderar produktionen.
