# Aggiornamento di OneUptime

Questa guida descrive come aggiornare in modo sicuro la tua installazione self-hosted di OneUptime.

## Indicazioni Generali

- Aggiorna passo dopo passo tra le versioni principali (ad esempio, da 6 → 7 → 8). Non saltare le versioni principali.
- Puoi saltare le versioni minori/patch (ad esempio, da 8.1 → 8.4) purché tu segua le note di rilascio.
- Esegui sempre dei backup prima di aggiornare e verifica di poterli ripristinare.

## Aggiornamento da OneUptime 11 → 12

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

## Aggiornamento da OneUptime 10 → 11

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

OneUptime 11 ricostruisce lo storage di telemetria ClickHouse. Questa pagina spiega cosa cambia, chi deve agire e — per le installazioni che vogliono conservare la telemetria storica — ogni query necessaria per farlo.

### Cosa cambia nella v11

La telemetria (log, trace, metriche, eccezioni, profili, log dei monitor, log di audit) viene spostata in nuove tabelle ClickHouse con partizionamento temporale, codec di compressione per colonna e le nuove colonne del modello di entità:

| Tabella vecchia       | Tabella nuova         |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

Due colonne vengono rinominate in ogni tabella di telemetria: `serviceId` → `primaryEntityId` e `serviceType` → `primaryEntityType`. È una rinomina rigida — **se interrogate direttamente l'API analytics di OneUptime con filtri `serviceId`/`serviceType`, aggiornateli ai nuovi nomi.** Dashboard, monitor e alert all'interno di OneUptime vengono migrati automaticamente.

Il passaggio è **solo in avanti**: le nuove tabelle partono vuote, tutta la telemetria ingerita dopo l'aggiornamento vi arriva immediatamente e lo storico si ricostituisce naturalmente col tempo. Le vecchie tabelle vengono **eliminate automaticamente** durante l'aggiornamento per recuperarne lo spazio su disco — se volete mantenere la possibilità di riportare lo storico, rinominatele **prima** dell'aggiornamento (Passo 0 qui sotto).

> **Siete già su 11.0.0 o 11.0.1?** Quelle release conservavano le vecchie tabelle (si svuotavano tramite la TTL e la copia poteva essere eseguita «in qualsiasi momento dopo l'aggiornamento»). Qualsiasi aggiornamento successivo **le elimina all'avvio**. Se volete ancora eseguire la copia dello storico e non l'avete ancora fatta, eseguite il Passo 0 qui sotto prima di applicare l'aggiornamento.

### Chi deve fare qualcosa

- **Installazioni nuove:** niente da fare.
- **Aggiornamenti che non hanno bisogno della telemetria precedente nell'interfaccia:** niente da fare. Le pagine di telemetria mostrano semplicemente i dati dal momento dell'aggiornamento in poi; le vecchie tabelle vengono eliminate durante l'aggiornamento.
- **Aggiornamenti che vogliono vedere la telemetria precedente:** rinominate le vecchie tabelle **prima** dell'aggiornamento (Passo 0 qui sotto), poi eseguite la copia manuale in qualsiasi momento dopo.

Come sempre: aggiornate le versioni maggiori una alla volta (10 → 11, senza saltarne) e fate backup di Postgres e ClickHouse prima di aggiornare.

### Opzionale: riportare lo storico di telemetria

Il Passo 0 va eseguito **prima dell'aggiornamento**; tutto il resto, dal Passo 1 in poi, va eseguito **dopo che l'aggiornamento è completamente avviato** (le nuove tabelle e le loro viste materializzate devono esistere). Collegatevi direttamente sul vostro host ClickHouse — il protocollo nativo non ha timeout HTTP, quindi statement di più ore non sono un problema:

```bash
clickhouse-client --database oneuptime
```

Da sapere prima di iniziare:

- La copia può essere eseguita in sicurezza mentre OneUptime è in produzione. La nuova telemetria scrive nelle nuove tabelle in modo indipendente; lo storico copiato si riempie alle sue spalle.
- Aspettatevi ore su larga scala (centinaia di GB).
- Ogni statement qui sotto porta un `insert_deduplication_token`, e le nuove tabelle hanno una finestra di deduplicazione — quindi **rieseguire uno statement fallito a metà è sicuro** (i blocchi già inseriti vengono saltati, anche nei rollup delle metriche), purché lo rieseguiate in tempi ragionevoli. Sotto ingest intenso la finestra (gli ultimi 10.000 blocchi di insert per tabella) finisce per espellere i token vecchi.
- Copiare le metriche ricostruisce anche automaticamente i rollup pre-aggregati delle dashboard (ogni riga copiata rialimenta le viste materializzate di rollup) — questo rende la copia delle metriche più lenta delle altre; eseguitela per ultima.

#### Passo 0 — prima di aggiornare, rinominare le vecchie tabelle

L'aggiornamento elimina le vecchie tabelle all'avvio, quindi mettete prima fuori dalla sua portata quelle da cui volete copiare. Fermate OneUptime (scalate il deployment a zero) in modo che nulla vi scriva o possa ricrearle, poi rinominate — `RENAME TABLE` è un'operazione di metadati istantanea, e `IF EXISTS` fa sì che il blocco salti le tabelle che la vostra installazione non ha mai avuto (i deployment precedenti a metà 10.0.x possono non avere `AuditLogV1` o alcune tabelle `…V2` — in quel caso non c'è storico di quel tipo da copiare):

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

Poi aggiornate e lasciate che OneUptime si avvii completamente prima di continuare.

> Se tornate alla v10 dopo la rinomina (la v10 ricrea all'avvio tabelle vuote con i vecchi nomi), rinominate le tabelle `_backup` riportandole ai nomi originali prima di riavviare la v10 — altrimenti la telemetria ingerita durante il rollback finisce nelle tabelle ricreate e verrà eliminata al futuro aggiornamento.

#### Passo 1 — elencare le partizioni di origine

Ogni vecchia tabella ha al massimo 16 partizioni. Per ogni tabella di origine:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Passo 2 — generare lo statement di copia

I set di colonne possono differire leggermente tra installazioni (ai deployment più vecchi possono mancare colonne aggiunte di recente), quindi generate lo statement dal vostro schema reale invece di copiarne uno fisso. Impostate `src` e `dst` nella clausola `WITH` su una delle coppie di tabelle della tabella sopra (l'origine porta il suffisso `_backup` del Passo 0) ed eseguite:

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

Lo statement generato copia solo le colonne che entrambe le tabelle condividono (le colonne nuove prendono i loro valori di default), rinomina `serviceId`/`serviceType` al volo, ordina le righe in modo deterministico così che una riesecuzione produca blocchi identici e deduplicabili, e rimuove i limiti di tempo di esecuzione e numero di partizioni di cui uno statement di queste dimensioni ha bisogno.

#### Passo 3 — eseguirlo, una partizione alla volta

Prendete lo statement generato e sostituite `{PARTITION}` (compare due volte — nel `WHERE` e nel token) con ogni id di partizione del Passo 1. Eseguite gli statement uno alla volta, poi ripetete i Passi 1–3 per ogni coppia di tabelle.

> Nota: se una tabella di origine è stata saltata al Passo 0 perché non esisteva sulla vostra installazione, il Passo 1 fallisce con `UNKNOWN_TABLE` per quella coppia — saltate semplicemente la coppia; non c'è storico di quel tipo da copiare.

Se uno statement fallisce a metà, rieseguite **lo stesso** statement in tempi brevi — i blocchi già committati vengono deduplicati. Se la riesecuzione avviene molto più tardi, confrontate prima i conteggi delle righe (Passo 5).

#### Passo 4 (opzionale) — storico del rollup delle metriche per host

Le righe di metriche grezze copiate ricostruiscono automaticamente i rollup a livello di servizio, ma non il rollup **per host** (le righe vecchie non hanno la chiave di entità host). La vecchia tabella di rollup rinominata al Passo 0 è l'unica fonte per questo storico; riportatelo calcolando la nuova chiave dal nome host:

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

L'`ORDER BY` è importante: fa sì che una riesecuzione produca blocchi di insert identici che il token di deduplicazione può riconoscere. Senza, una riesecuzione potrebbe essere saltata in silenzio o contata due volte. (Caso limite: nomi host contenenti `\`, `|` o `=` — caratteri non validi secondo la RFC 1123 — calcolerebbero una chiave diversa da quella dell'applicazione; ignoratelo a meno che non sappiate di avere host del genere.)

#### Passo 5 — verificare

Confrontate i totali per coppia di tabelle (la tabella nuova contiene anche righe successive all'aggiornamento, quindi dovrebbe essere maggiore o uguale alla vecchia):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Passo 6 — eliminare i backup

Le tabelle rinominate mantengono la loro TTL di retention, quindi si svuotano e si riducono da sole — ma una volta soddisfatti della copia, eliminatele per recuperare subito il disco:

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

(`max_table_size_to_drop = 0` rimuove la protezione di eliminazione da 50 GB del server per quel singolo statement.)

> Suggerimento: come per ogni aggiornamento maggiore, testate prima in un ambiente di staging e confermate che la telemetria fluisca nelle nuove tabelle prima di fare affidamento sulla copia in produzione.

## Aggiornamento da OneUptime 9 → 10

Nessuna modifica che richieda un intervento manuale. Segui semplicemente la procedura di aggiornamento standard.

## Aggiornamento da OneUptime 8 → 9

Il chart Helm non provvede più a una risorsa Kubernetes Ingress. OneUptime include un container ingress gateway che gestisce già la terminazione TLS, i domini delle pagine di stato e il routing del traffico per la piattaforma, quindi un ingress controller del cluster non è più necessario.

- Rimuovi qualsiasi override di `oneuptimeIngress` dai tuoi file `values.yaml` personalizzati prima dell'aggiornamento. Quelle chiavi vengono ora ignorate e causeranno errori di validazione se lasciate.
- Assicurati che `nginx.service.type` rispecchi come vuoi esporre l'ingress gateway incluso (ad esempio `LoadBalancer`, `NodePort`, o `ClusterIP` con un load balancer esterno).
- Verifica che tutti i record DNS per le pagine di stato o gli host principali puntino ancora al Service o al load balancer che si trova davanti all'ingress gateway di OneUptime.
- Dopo l'aggiornamento, conferma che i certificati TLS continuino a rinnovarsi tramite il gateway integrato e che i domini delle pagine di stato si risolvano correttamente.

## Aggiornamento da OneUptime 7 → 8

Se stai eseguendo su Kubernetes, ci sono importanti cambiamenti che causano interruzioni:

- Non usiamo più i chart Bitnami per Postgres, Redis e ClickHouse a causa delle [Modifiche alla Licenza Bitnami](https://github.com/bitnami/charts/issues/35164)
- Queste modifiche non sono retrocompatibili. Devi seguire la nuova struttura nel `values.yaml` del chart Helm.
- Esegui il backup dei tuoi dati (Postgres, ClickHouse e tutti i volumi persistenti) prima dell'aggiornamento.

> Suggerimento: Testa prima l'aggiornamento in un ambiente di staging. Conferma che i tuoi carichi di lavoro siano integri e i dati intatti prima di aggiornare la produzione.
