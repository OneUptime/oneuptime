# Oppgradering av OneUptime

Denne veiledningen dekker hvordan du trygt oppgraderer din selvhostede OneUptime-installasjon.

## Generell veiledning

- Oppgrader trinn for trinn på tvers av store versjoner (for eksempel 6 → 7 → 8). Ikke hopp over store versjoner.
- Du kan hoppe over mindre/patch-versjoner (for eksempel 8.1 → 8.4) så lenge du følger versjonsnotatene.
- Ta alltid sikkerhetskopier før oppgradering, og valider at du kan gjenopprette dem.

## Oppgradering fra OneUptime 11 → 12

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

## Oppgradering fra OneUptime 10 → 11

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

OneUptime 11 bygger ClickHouse-telemetrilagringen på nytt. Denne siden forklarer hva som endres, hvem som må gjøre noe, og — for installasjoner som vil ta med historisk telemetri videre — hver eneste spørring som trengs.

### Hva endres i v11

Telemetri (logger, traces, metrikker, exceptions, profiler, monitor-logger, audit-logger) flyttes til nye ClickHouse-tabeller med tidsbasert partisjonering, komprimeringskodeker per kolonne og de nye entitetsmodell-kolonnene:

| Gammel tabell         | Ny tabell             |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

To kolonner får nytt navn i alle telemetritabeller: `serviceId` → `primaryEntityId` og `serviceType` → `primaryEntityType`. Dette er en hard navneendring — **hvis du spør OneUptimes analytics-API direkte med `serviceId`-/`serviceType`-filtre, må du oppdatere dem til de nye navnene.** Dashboards, monitorer og varsler inne i OneUptime migreres automatisk.

Overgangen er **kun fremoverrettet**: de nye tabellene starter tomme, all telemetri som tas inn etter oppgraderingen lander umiddelbart i dem, og historikken fylles naturlig opp etter hvert som tiden går. De gamle tabellene **slettes automatisk** under oppgraderingen for å frigjøre diskplassen — vil du beholde muligheten til å ta historikken med, gi dem nytt navn **før** oppgraderingen (Trinn 0 nedenfor).

> **Allerede på 11.0.0 eller 11.0.1?** Disse utgivelsene beholdt de gamle tabellene (de tømte seg via TTL, og kopien kunne kjøres «når som helst etter oppgraderingen»). Enhver senere oppdatering **sletter dem ved oppstart**. Hvis du fortsatt vil gjøre historikk-kopien og ikke har gjort det ennå, utfør Trinn 0 nedenfor før du tar i bruk oppdateringen.

### Hvem må gjøre noe

- **Nyinstallasjoner:** ingenting å gjøre.
- **Oppgraderinger som ikke trenger telemetri fra før oppgraderingen i grensesnittet:** ingenting å gjøre. Telemetrisidene viser ganske enkelt data fra oppgraderingstidspunktet og fremover; de gamle tabellene slettes under oppgraderingen.
- **Oppgraderinger som vil se telemetri fra før oppgraderingen:** gi de gamle tabellene nytt navn **før** oppgraderingen (Trinn 0 nedenfor), og kjør deretter den manuelle kopien når som helst etterpå.

Som alltid: oppgrader hovedversjoner trinn for trinn (10 → 11, ikke hopp over), og ta sikkerhetskopier av Postgres og ClickHouse før oppgraderingen.

### Valgfritt: ta telemetrihistorikken med videre

Trinn 0 utføres **før oppgraderingen**; alt fra Trinn 1 og utover utføres **etter at oppgraderingen har startet helt opp** (de nye tabellene og deres materialized views må eksistere). Koble til direkte på ClickHouse-verten — den native protokollen har ingen HTTP-tidsavbrudd, så setninger som tar flere timer er uproblematiske:

```bash
clickhouse-client --database oneuptime
```

Godt å vite før du begynner:

- Kopien kan trygt kjøres mens OneUptime er live. Ny telemetri skrives uavhengig til de nye tabellene; den kopierte historikken fyller seg opp bak.
- Forvent timer i stor skala (hundrevis av GB).
- Hver setning nedenfor bærer et `insert_deduplication_token`, og de nye tabellene leveres med et dedupliseringsvindu — så **det er trygt å kjøre en setning som feilet underveis på nytt** (allerede innsatte blokker hoppes over, også i metrikk-rollups), forutsatt at du kjører den på nytt rimelig raskt. Under tung live-inntak fortrenger vinduet (de siste 10 000 insert-blokkene per tabell) til slutt gamle tokens.
- Kopiering av metrikker bygger også automatisk de forhåndsaggregerte dashboard-rollupene på nytt (hver kopierte rad mater rollup-materialized-views på nytt) — det gjør metrikk-kopien tregere enn de andre; kjør den sist.

#### Trinn 0 — gi de gamle tabellene nytt navn før oppgraderingen

Oppgraderingen sletter de gamle tabellene ved oppstart, så flytt først dem du vil kopiere fra utenfor dens rekkevidde. Stopp OneUptime (skaler deploymentet ned) slik at ingenting skriver til dem eller kan gjenskape dem, og gi dem deretter nytt navn — `RENAME TABLE` er en øyeblikkelig metadata-operasjon, og `IF EXISTS` lar blokken hoppe over tabeller installasjonen din aldri har hatt (deployments eldre enn midten av 10.0.x kan mangle `AuditLogV1` eller noen `…V2`-tabeller — da finnes det ingen historikk av den typen å kopiere):

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

Oppgrader deretter og la OneUptime starte helt opp før du fortsetter.

> Ruller du tilbake til v10 etter navneendringen (v10 gjenskaper tomme tabeller med de gamle navnene ved oppstart), gi `_backup`-tabellene tilbake de opprinnelige navnene før du starter v10 på nytt — ellers lander telemetri som tas inn under tilbakerullingen i de gjenskapte tabellene og slettes ved den senere oppgraderingen.

#### Trinn 1 — list kildepartisjonene

Hver gamle tabell har høyst 16 partisjoner. For hver kildetabell:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Trinn 2 — generer kopisetningen

Kolonnesettene kan variere litt mellom installasjoner (eldre deployments kan mangle nylig tilførte kolonner), så generer setningen fra ditt live skjema i stedet for å lime inn en fast. Sett `src` og `dst` i `WITH`-klausulen til ett av tabellparene fra tabellen ovenfor (kilden bærer `_backup`-suffikset fra Trinn 0), og kjør:

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

Den genererte setningen kopierer bare kolonnene begge tabellene deler (nye kolonner får standardverdiene sine), endrer navn på `serviceId`/`serviceType` underveis, sorterer radene deterministisk slik at en ny kjøring produserer identiske, dedupliserbare blokker, og opphever grensene for kjøretid og partisjonsantall som en setning av denne størrelsen trenger.

#### Trinn 3 — kjør den, én partisjon om gangen

Ta den genererte setningen og erstatt `{PARTITION}` (den forekommer to ganger — i `WHERE` og i tokenet) med hver partisjons-id fra Trinn 1. Kjør setningene én om gangen, og gjenta deretter Trinn 1–3 for hvert tabellpar.

> Merk: ble en kildetabell hoppet over i Trinn 0 fordi den ikke fantes på installasjonen din, feiler Trinn 1 med `UNKNOWN_TABLE` for det paret — hopp ganske enkelt over paret; det finnes ingen historikk av den typen å kopiere.

Feiler en setning underveis, kjør raskt **den samme** setningen på nytt — allerede committede blokker dedupliseres. Kjører du på nytt mye senere, sammenlign radantallene først (Trinn 5).

#### Trinn 4 (valgfritt) — historikk for metrikk-rollup per vert

Kopierte rå metrikkrader bygger automatisk rollupene på tjenestenivå på nytt, men ikke **per-vert**-rollupen (gamle rader har ingen vert-entitetsnøkkel). Den gamle rollup-tabellen som fikk nytt navn i Trinn 0 er den eneste kilden til denne historikken; ta den med ved å beregne den nye nøkkelen fra vertsnavnet:

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

`ORDER BY` betyr noe: den gjør at en ny kjøring produserer identiske insert-blokker som dedupliseringstokenet kan gjenkjenne. Uten den kunne en ny kjøring blitt hoppet stille over eller telt dobbelt. (Kanttilfelle: vertsnavn som inneholder `\`, `|` eller `=` — ikke gyldige RFC-1123-vertsnavntegn — ville beregnet en annen nøkkel enn applikasjonen; ignorer dette med mindre du vet at du har slike verter.)

#### Trinn 5 — verifiser

Sammenlign totalene per tabellpar (den nye tabellen inneholder også rader fra etter oppgraderingen, så den bør være større enn eller lik den gamle):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Trinn 6 — slett sikkerhetskopiene

Tabellene med nytt navn beholder retensjons-TTL-en sin, så de tømmes og krymper av seg selv — men så snart du er fornøyd med kopien, slett dem for å frigjøre disken umiddelbart:

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

(`max_table_size_to_drop = 0` opphever serverens 50 GB-slettebeskyttelse for akkurat den setningen.)

> Tips: som ved enhver større oppgradering, test først i et staging-miljø og bekreft at telemetri strømmer inn i de nye tabellene før du stoler på kopien i produksjon.

## Oppgradering fra OneUptime 9 → 10

Ingen endringer som krever manuelle tiltak. Følg bare den vanlige oppgraderingsprosessen.

## Oppgradering fra OneUptime 8 → 9

Helm-diagrammet klargjør ikke lenger en Kubernetes Ingress-ressurs. OneUptime leveres med en ingress gateway-container som allerede avslutter TLS, administrerer statusside-domener og ruter trafikk for plattformen, slik at en klynge ingress-kontroller ikke lenger er nødvendig.

- Fjern eventuelle `oneuptimeIngress`-overstyringer fra de egendefinerte `values.yaml`-filene dine før oppgradering. Disse nøklene ignoreres nå og vil forårsake valideringsfeil hvis de etterlates.
- Sørg for at `nginx.service.type` gjenspeiler hvordan du vil eksponere den medfølgende ingress gateway (for eksempel `LoadBalancer`, `NodePort` eller `ClusterIP` med en ekstern lastbalanserer).
- Verifiser at eventuelle DNS-poster for statussider eller primære verter fortsatt peker til tjenesten eller lastbalansereren som er foran OneUptime ingress gateway.
- Etter oppgraderingen, bekreft at TLS-sertifikater fortsetter å fornyes via den innebygde gateway og at statussidedomener løses opp korrekt.

## Oppgradering fra OneUptime 7 → 8

Hvis du kjører på Kubernetes, er det viktige endringer som bryter bakoverkompatibilitet:

- Vi bruker ikke lenger Bitnami-diagrammer for Postgres, Redis og ClickHouse på grunn av [Bitnami-lisensendringer](https://github.com/bitnami/charts/issues/35164)
- Disse endringene er ikke bakoverkompatible. Du må følge den nye strukturen i Helm-diagrammets `values.yaml`.
- Sikkerhetskopier dataene dine (Postgres, ClickHouse og eventuelle vedvarende volumer) før oppgradering.

> Tips: Test oppgraderingen i et stagingmiljø først. Bekreft at arbeidsbelastningene er sunne og at dataene er intakte før du oppgraderer produksjon.
