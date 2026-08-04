# Opgradering af OneUptime

Denne guide beskriver, hvordan du sikkert opgraderer din selvhostede OneUptime-installation.

## Generel vejledning

- Opgrader trin for trin på tværs af større versioner (f.eks. 6 → 7 → 8). Spring ikke større versioner over.
- Du kan springe mindre/patch-versioner over (f.eks. 8.1 → 8.4), så længe du følger udgivelsesnoterne.
- Tag altid sikkerhedskopier inden opgradering, og valider, at du kan gendanne dem.

## Opgradering fra OneUptime 11 → 12

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

## Opgradering fra OneUptime 10 → 11

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

OneUptime 11 genopbygger ClickHouse-telemetrilageret. Denne side forklarer, hvad der ændres, hvem der skal handle, og — for installationer der vil bevare historisk telemetri — hver eneste forespørgsel, der skal til.

### Hvad ændres i v11

Telemetri (logs, traces, metrikker, exceptions, profiler, monitor-logs, audit-logs) flyttes til nye ClickHouse-tabeller med tidsbaseret partitionering, komprimeringscodecs pr. kolonne og de nye entitetsmodel-kolonner:

| Gammel tabel          | Ny tabel              |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

To kolonner omdøbes i alle telemetritabeller: `serviceId` → `primaryEntityId` og `serviceType` → `primaryEntityType`. Det er en hård omdøbning — **hvis du forespørger OneUptimes analytics-API direkte med `serviceId`-/`serviceType`-filtre, skal du opdatere dem til de nye navne.** Dashboards, monitors og alerts inde i OneUptime migreres automatisk.

Skiftet er **kun fremadrettet**: de nye tabeller starter tomme, al telemetri der indtages efter opgraderingen lander straks i dem, og historikken fyldes naturligt op med tiden. De gamle tabeller **slettes automatisk** under opgraderingen for at frigive deres diskplads — vil du beholde muligheden for at tage historikken med, så omdøb dem **før** opgraderingen (Trin 0 nedenfor).

> **Allerede på 11.0.0 eller 11.0.1?** Disse udgivelser beholdt de gamle tabeller (de tømtes via TTL, og kopien kunne køres "når som helst efter opgraderingen"). Enhver senere opdatering **sletter dem ved opstart**. Hvis du stadig vil lave historik-kopien og ikke har gjort det endnu, så udfør Trin 0 nedenfor, før du anvender opdateringen.

### Hvem skal gøre noget

- **Nyinstallationer:** intet at gøre.
- **Opgraderinger der ikke behøver telemetri fra før opgraderingen i brugerfladen:** intet at gøre. Telemetrisiderne viser blot data fra opgraderingstidspunktet og frem; de gamle tabeller slettes under opgraderingen.
- **Opgraderinger der vil kunne se telemetri fra før opgraderingen:** omdøb de gamle tabeller **før** opgraderingen (Trin 0 nedenfor), og kør derefter den manuelle kopi når som helst bagefter.

Som altid: opgradér hovedversioner trin for trin (10 → 11, spring ikke over), og tag backup af Postgres og ClickHouse før opgraderingen.

### Valgfrit: tag telemetrihistorikken med

Trin 0 udføres **før opgraderingen**; alt fra Trin 1 og frem udføres, **efter at opgraderingen er startet helt op** (de nye tabeller og deres materialized views skal eksistere). Forbind direkte på din ClickHouse-host — den native protokol har ingen HTTP-timeouts, så statements der tager flere timer er uproblematiske:

```bash
clickhouse-client --database oneuptime
```

Godt at vide, før du går i gang:

- Kopien kan køres sikkert, mens OneUptime er live. Ny telemetri skrives uafhængigt til de nye tabeller; den kopierede historik fylder op bagved.
- Forvent timer ved stor skala (hundredvis af GB).
- Hvert statement nedenfor bærer et `insert_deduplication_token`, og de nye tabeller leveres med et deduplikeringsvindue — så **det er sikkert at genkøre et statement, der fejlede undervejs** (allerede indsatte blokke springes over, også i metrik-rollups), forudsat at du genkører det rimelig hurtigt. Under kraftig live-indtagelse fortrænger vinduet (de seneste 10.000 insert-blokke pr. tabel) til sidst gamle tokens.
- Kopiering af metrikker genopbygger også automatisk de præaggregerede dashboard-rollups (hver kopieret række fodrer rollup-materialized-views igen) — det gør metrik-kopien langsommere end de andre; kør den til sidst.

#### Trin 0 — omdøb de gamle tabeller før opgraderingen

Opgraderingen sletter de gamle tabeller ved opstart, så flyt først dem, du vil kopiere fra, uden for dens rækkevidde. Stop OneUptime (skaler deploymentet ned) så intet skriver til dem eller kan genskabe dem, og omdøb derefter — `RENAME TABLE` er en øjeblikkelig metadata-operation, og `IF EXISTS` lader blokken springe tabeller over, som din installation aldrig har haft (deployments ældre end midt i 10.0.x mangler muligvis `AuditLogV1` eller nogle `…V2`-tabeller — så findes der ingen historik af den type at kopiere):

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

Opgradér derefter, og lad OneUptime starte helt op, før du fortsætter.

> Ruller du tilbage til v10 efter omdøbningen (v10 genskaber tomme tabeller med de gamle navne ved opstart), så omdøb `_backup`-tabellerne tilbage til deres oprindelige navne, før du genstarter v10 — ellers lander telemetri indtaget under tilbagerulningen i de genskabte tabeller og slettes ved den senere opgradering.

#### Trin 1 — list kildepartitionerne

Hver gammel tabel har højst 16 partitioner. For hver kildetabel:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Trin 2 — generér kopi-statementet

Kolonnesættene kan variere en smule mellem installationer (ældre deployments kan mangle nyligt tilføjede kolonner), så generér statementet ud fra dit live-skema i stedet for at indsætte et fast. Sæt `src` og `dst` i `WITH`-klausulen til et af tabelparrene fra tabellen ovenfor (kilden bærer `_backup`-suffikset fra Trin 0), og kør:

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

Det genererede statement kopierer kun de kolonner, begge tabeller deler (nye kolonner får deres standardværdier), omdøber `serviceId`/`serviceType` undervejs, sorterer rækkerne deterministisk, så en genkørsel producerer identiske, deduplikerbare blokke, og ophæver de grænser for køretid og partitionsantal, som et statement af denne størrelse kræver.

#### Trin 3 — kør det, én partition ad gangen

Tag det genererede statement og erstat `{PARTITION}` (det optræder to gange — i `WHERE` og i tokenet) med hvert partitions-id fra Trin 1. Kør statements ét ad gangen, og gentag derefter Trin 1–3 for hvert tabelpar.

> Bemærk: blev en kildetabel sprunget over i Trin 0, fordi den ikke fandtes på din installation, fejler Trin 1 med `UNKNOWN_TABLE` for det par — spring blot parret over; der findes ingen historik af den type at kopiere.

Fejler et statement undervejs, så genkør hurtigt **det samme** statement — allerede committede blokke deduplikeres. Genkører du meget senere, så sammenlign først rækkeantallene (Trin 5).

#### Trin 4 (valgfrit) — historik for metrik-rollup pr. host

Kopierede rå metrikrækker genopbygger automatisk rollups på serviceniveau, men ikke **pr.-host**-rollupen (gamle rækker har ingen host-entitetsnøgle). Den gamle rollup-tabel, der blev omdøbt i Trin 0, er den eneste kilde til denne historik; tag den med ved at beregne den nye nøgle ud fra hostnavnet:

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

`ORDER BY` betyder noget: den sikrer, at en genkørsel producerer identiske insert-blokke, som deduplikeringstokenet kan genkende. Uden den kunne en genkørsel blive sprunget lydløst over eller talt dobbelt. (Kanttilfælde: hostnavne med `\`, `|` eller `=` — ikke gyldige RFC-1123-hostnavnstegn — ville beregne en anden nøgle end applikationen; ignorér det, medmindre du ved, at du har sådanne hosts.)

#### Trin 5 — verificér

Sammenlign totalerne pr. tabelpar (den nye tabel indeholder også rækker fra efter opgraderingen, så den bør være større end eller lig den gamle):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Trin 6 — slet backupperne

De omdøbte tabeller beholder deres retentions-TTL, så de tømmes og skrumper af sig selv — men så snart du er tilfreds med kopien, kan du slette dem og frigive disken med det samme:

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

(`max_table_size_to_drop = 0` ophæver serverens 50 GB-sletbeskyttelse for netop det statement.)

> Tip: test som ved enhver større opgradering først i et staging-miljø, og bekræft at telemetri strømmer ind i de nye tabeller, før du stoler på kopien i produktion.

## Opgradering fra OneUptime 9 → 10

Ingen ændringer, der kræver manuel handling. Følg blot den almindelige opgraderingsproces.

## Opgradering fra OneUptime 8 → 9

Helm-chartet klargører ikke længere en Kubernetes Ingress-ressource. OneUptime leverer en ingress gateway-container, der allerede afslutter TLS, administrerer statusside-domæner og dirigerer trafik til platformen, så en klynge-ingress-controller er ikke længere nødvendig.

- Fjern eventuelle `oneuptimeIngress`-tilsidesættelser fra dine brugerdefinerede `values.yaml`-filer inden opgradering. Disse nøgler ignoreres nu og vil forårsage valideringsfejl, hvis de efterlades.
- Sørg for, at `nginx.service.type` afspejler, hvordan du vil eksponere den medfølgende ingress gateway (f.eks. `LoadBalancer`, `NodePort` eller `ClusterIP` med en ekstern load balancer).
- Bekræft, at eventuelle DNS-poster til statussider eller primære hosts stadig peger på den service eller load balancer, der er foran OneUptime-ingress-gatewayen.
- Efter opgraderingen skal du bekræfte, at TLS-certifikater fortsat fornyes via den indlejrede gateway, og at statusside-domæner løses korrekt.

## Opgradering fra OneUptime 7 → 8

Hvis du kører på Kubernetes, er der vigtige ændringer der bryder bagudkompatibilitet:

- Vi bruger ikke længere Bitnami-charts til Postgres, Redis og ClickHouse på grund af [Bitnami-licensændringer](https://github.com/bitnami/charts/issues/35164)
- Disse ændringer er ikke bagudkompatible. Du skal følge den nye struktur i Helm-chartets `values.yaml`.
- Sikkerhedskopier dine data (Postgres, ClickHouse og alle persistente volumes) inden opgradering.

> Tip: Test opgraderingen i et staging-miljø først. Bekræft, at dine arbejdsbelastninger er sunde og dataene intakte, inden du opgraderer produktionen.
