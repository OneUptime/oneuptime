# OneUptime aktualisieren

Diese Anleitung beschreibt, wie Sie Ihre selbst gehostete OneUptime-Installation sicher aktualisieren können.

## Allgemeine Hinweise

- Führen Sie Upgrades schrittweise über Hauptversionen durch (z. B. 6 → 7 → 8). Überspringen Sie keine Hauptversionen.
- Sie können Neben-/Patch-Versionen überspringen (z. B. 8.1 → 8.4), sofern Sie die Release-Notes beachten.
- Erstellen Sie immer Backups vor dem Upgrade und überprüfen Sie, ob Sie diese wiederherstellen können.

## Upgrade von OneUptime 11 → 12

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the v12 Runner merge). -->

OneUptime 12 merges two components into one. The **Runbook Agent** (the
container you installed on your own hosts to execute runbook steps) and the
**AI Agent** (the service that worked on AI code fixes) are now a single
component: the **OneUptime Runner**, shipped as the `oneuptime/runner`
Docker image. The old `oneuptime/runbook-agent` and `oneuptime/ai-agent`
images are no longer built or published — existing tags remain pullable,
but they will never receive another update.

A Runner is one installed container that can hold several **capabilities**,
toggled per Runner in the dashboard: **Führt Runbooks aus** (on by default),
**Führt KI-Codekorrekturen aus** (off by default), and **Führt KI-Behebungsbefehle aus** (off by
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

(Or open the Runner in **Einstellungen → Runbook-Agents** and use **Einrichtungsanweisungen
anzeigen** for a pre-filled command.)

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

The **Einstellungen → KI → KI-Agenten** page is gone and the `oneuptime/ai-agent`
image is no longer built. If you had installed an AI Agent container
yourself, replace it with a Runner:

1. Create a Runner under **Einstellungen → Runbook-Agents** and install it with the
   command from **Einrichtungsanweisungen anzeigen**.
2. Enable **Führt KI-Codekorrekturen aus** on it. The change is picked up on the next
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
| Runners (was "Agents")  | Runbooks → Einstellungen → Agents (`…/runbooks/settings/agents`) | Einstellungen → Runbook-Agents (`…/settings/runners`) |
| Runner Credentials      | Runbooks → Einstellungen → Anmeldedaten (`…/runbooks/settings/credentials`) | Einstellungen → Runner Credentials (`…/settings/runner-credentials`) |
| AI Agents               | Einstellungen → KI → KI-Agenten (`…/settings/ai-agents`) | Removed — Runners with the **Führt KI-Codekorrekturen aus** capability replace it |

Runbook Secrets stays where it was, under Runbooks → Einstellungen → Geheimnisse.

### New in 12, nothing to enable by accident

v12 adds AI-composed remediation commands: the AI can propose a command
plan and hand it to a Runner for execution. Everything about it is off by
default and stays off until you opt in twice — the project-level **AI
command execution** setting and the per-Runner **Führt KI-Behebungsbefehle aus**
capability must both be enabled, and only runbooks/rules you configure for
it participate. Upgrading changes nothing here.

> Tip: as with every major upgrade, back up Postgres before upgrading (a
> rollback to v11 means restoring that backup), test in staging first, and
> upgrade step-by-step — 11 → 12, do not skip from older majors.

## Upgrade von OneUptime 10 → 11

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

OneUptime 11 baut den ClickHouse-Telemetrie-Speicher neu auf. Diese Seite erklärt, was sich ändert, wer handeln muss und – für Installationen, die historische Telemetriedaten übernehmen möchten – jede dafür benötigte Abfrage.

### Was sich in v11 ändert

Telemetriedaten (Logs, Traces, Metriken, Exceptions, Profile, Monitor-Logs, Audit-Logs) werden in neue ClickHouse-Tabellen mit zeitbasierter Partitionierung, spaltenweisen Kompressions-Codecs und den neuen Entity-Modell-Spalten verschoben:

| Alte Tabelle          | Neue Tabelle          |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

In jeder Telemetrie-Tabelle werden zwei Spalten umbenannt: `serviceId` → `primaryEntityId` und `serviceType` → `primaryEntityType`. Dies ist eine harte Umbenennung – **wenn Sie die OneUptime-Analytics-API direkt mit `serviceId`-/`serviceType`-Filtern abfragen, stellen Sie diese auf die neuen Namen um.** Dashboards, Monitore und Alerts innerhalb von OneUptime werden automatisch migriert.

Der Umstieg erfolgt **ausschließlich vorwärtsgerichtet**: Die neuen Tabellen starten leer, alle nach dem Upgrade eingelieferten Telemetriedaten landen sofort darin, und die Historie füllt sich mit der Zeit auf natürliche Weise wieder auf. Die alten Tabellen werden während des Upgrades **automatisch gelöscht**, um ihren Speicherplatz freizugeben – wenn Sie sich die Möglichkeit offenhalten möchten, die Historie zu übernehmen, benennen Sie sie **vor** dem Upgrade um (Schritt 0 unten).

> **Bereits auf 11.0.0 oder 11.0.1?** Diese Releases behielten die alten Tabellen bei (sie leerten sich über die TTL, und die Kopie konnte „jederzeit nach dem Upgrade" ausgeführt werden). Jedes spätere Update **löscht sie beim Start**. Wenn Sie die Historien-Kopie noch durchführen möchten und dies bisher nicht getan haben, führen Sie Schritt 0 unten aus, bevor Sie das Update einspielen.

### Wer handeln muss

- **Neuinstallationen:** keine Maßnahmen erforderlich.
- **Upgrades, die keine Telemetriedaten aus der Zeit vor dem Upgrade in der Benutzeroberfläche benötigen:** keine Maßnahmen erforderlich. Die Telemetrie-Seiten zeigen einfach Daten ab dem Zeitpunkt des Upgrades; die alten Tabellen werden während des Upgrades gelöscht.
- **Upgrades, bei denen Telemetriedaten aus der Zeit vor dem Upgrade sichtbar sein sollen:** Benennen Sie die alten Tabellen **vor** dem Upgrade um (Schritt 0 unten) und führen Sie die manuelle Kopie dann jederzeit nach dem Upgrade aus.

Wie immer gilt: Führen Sie Upgrades über Hauptversionen schrittweise durch (10 → 11, nicht überspringen) und erstellen Sie vor dem Upgrade Backups von Postgres und ClickHouse.

### Optional: Telemetrie-Historie übernehmen

Schritt 0 erfolgt **vor dem Upgrade**; alles ab Schritt 1 erfolgt, **nachdem das Upgrade vollständig hochgefahren ist** (die neuen Tabellen und ihre Materialized Views müssen existieren). Verbinden Sie sich direkt auf Ihrem ClickHouse-Host – das native Protokoll kennt keine HTTP-Timeouts, daher sind mehrstündige Statements unproblematisch:

```bash
clickhouse-client --database oneuptime
```

Gut zu wissen, bevor Sie beginnen:

- Die Kopie kann sicher ausgeführt werden, während OneUptime live ist. Neue Telemetriedaten werden unabhängig davon in die neuen Tabellen geschrieben; die kopierte Historie füllt sich dahinter auf.
- Rechnen Sie bei großem Datenvolumen (Hunderte von GB) mit mehreren Stunden.
- Jedes Statement unten trägt ein `insert_deduplication_token`, und die neuen Tabellen werden mit einem Deduplizierungsfenster ausgeliefert – daher ist es **sicher, ein teilweise fehlgeschlagenes Statement erneut auszuführen** (bereits eingefügte Blöcke werden übersprungen, auch in den Metrik-Rollups), sofern die Wiederholung zeitnah erfolgt. Bei starkem laufendem Ingest verdrängt das Fenster (die letzten 10.000 Insert-Blöcke pro Tabelle) irgendwann alte Tokens.
- Das Kopieren der Metriken baut außerdem die voraggregierten Dashboard-Rollups automatisch neu auf (jede kopierte Zeile speist die Rollup-Materialized-Views erneut) – dadurch ist die Metrik-Kopie langsamer als die anderen; führen Sie sie zuletzt aus.

#### Schritt 0 – Vor dem Upgrade: alte Tabellen umbenennen

Das Upgrade löscht die alten Tabellen beim Start. Bringen Sie die Tabellen, aus denen Sie kopieren möchten, daher zuerst außer Reichweite. Stoppen Sie OneUptime (skalieren Sie das Deployment herunter), damit nichts mehr in die Tabellen schreibt oder sie neu anlegen kann, und benennen Sie sie dann um – `RENAME TABLE` ist eine sofortige Metadaten-Operation, und `IF EXISTS` lässt den Block Tabellen überspringen, die Ihre Installation nie hatte (Deployments älter als Mitte 10.0.x fehlen möglicherweise `AuditLogV1` oder einzelne `…V2`-Tabellen – es gibt dann keine Historie dieses Typs zu kopieren):

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

Führen Sie anschließend das Upgrade durch und lassen Sie OneUptime vollständig hochfahren, bevor Sie fortfahren.

> Wenn Sie nach dem Umbenennen auf v10 zurückrollen (v10 legt beim Start leere Tabellen mit den alten Namen neu an), benennen Sie die `_backup`-Tabellen wieder auf ihre ursprünglichen Namen zurück, bevor Sie v10 neu starten – andernfalls landen während des Rollbacks eingelieferte Telemetriedaten in den neu angelegten Tabellen und werden beim späteren Upgrade gelöscht.

#### Schritt 1 – Quellpartitionen auflisten

Jede alte Tabelle hat höchstens 16 Partitionen. Für jede Quelltabelle:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Schritt 2 – Kopier-Statement generieren

Die Spaltensätze können sich zwischen Installationen leicht unterscheiden (älteren Deployments können kürzlich hinzugefügte Spalten fehlen). Generieren Sie das Statement daher aus Ihrem Live-Schema, statt ein festes Statement zu kopieren. Setzen Sie `src` und `dst` in der `WITH`-Klausel auf eines der Tabellenpaare aus der obigen Tabelle (die Quelle trägt das `_backup`-Suffix aus Schritt 0) und führen Sie aus:

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

Das generierte Statement kopiert nur die Spalten, die beide Tabellen gemeinsam haben (neue Spalten erhalten ihre Standardwerte), benennt `serviceId`/`serviceType` direkt beim Kopieren um, sortiert die Zeilen deterministisch, sodass eine Wiederholung identische, deduplizierbare Blöcke erzeugt, und hebt die Limits für Ausführungszeit und Partitionsanzahl auf, die ein Statement dieser Größe benötigt.

#### Schritt 3 – Ausführen, Partition für Partition

Nehmen Sie das generierte Statement und ersetzen Sie `{PARTITION}` (es kommt zweimal vor – im `WHERE` und im Token) durch jede Partitions-ID aus Schritt 1. Führen Sie die Statements nacheinander aus und wiederholen Sie dann die Schritte 1–3 für jedes Tabellenpaar.

> Hinweis: Wurde eine Quelltabelle in Schritt 0 übersprungen, weil sie auf Ihrer Installation nicht existierte, schlägt Schritt 1 für dieses Paar mit `UNKNOWN_TABLE` fehl – überspringen Sie das Paar einfach; es gibt keine Historie dieses Typs zu kopieren.

Wenn ein Statement teilweise fehlschlägt, führen Sie zeitnah **dasselbe** Statement erneut aus – bereits committete Blöcke werden dedupliziert. Wenn die Wiederholung deutlich später erfolgt, vergleichen Sie zuerst die Zeilenanzahlen (Schritt 5).

#### Schritt 4 (optional) – Historie der Pro-Host-Metrik-Rollups

Kopierte rohe Metrikzeilen bauen die Rollups auf Service-Ebene automatisch neu auf, nicht jedoch das **Pro-Host**-Rollup (alte Zeilen haben keinen Host-Entity-Key). Die in Schritt 0 umbenannte alte Rollup-Tabelle ist die einzige Quelle für diese Historie; übernehmen Sie sie, indem der neue Schlüssel aus dem Hostnamen berechnet wird:

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

Das `ORDER BY` ist wichtig: Es sorgt dafür, dass eine Wiederholung identische Insert-Blöcke erzeugt, die das Deduplizierungs-Token wiedererkennen kann. Ohne `ORDER BY` könnte eine Wiederholung stillschweigend übersprungen oder doppelt gezählt werden. (Randfall: Hostnamen mit `\`, `|` oder `=` – keine gültigen RFC-1123-Hostnamen-Zeichen – würden einen anderen Schlüssel berechnen als die Anwendung; ignorieren Sie dies, sofern Sie nicht wissen, dass Sie solche Hosts haben.)

#### Schritt 5 – Überprüfen

Vergleichen Sie die Gesamtzahlen pro Tabellenpaar (die neue Tabelle enthält auch Zeilen aus der Zeit nach dem Upgrade, sie sollte daher größer oder gleich der alten sein):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Schritt 6 – Backups löschen

Die umbenannten Tabellen behalten ihre Aufbewahrungs-TTL, leeren sich also von selbst und schrumpfen – aber sobald Sie mit der Kopie zufrieden sind, löschen Sie sie, um den Speicherplatz sofort freizugeben:

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

(`max_table_size_to_drop = 0` hebt den 50-GB-Löschschutz des Servers für genau dieses Statement auf.)

> Tipp: Testen Sie wie bei jedem Major-Upgrade zuerst in einer Staging-Umgebung und bestätigen Sie, dass Telemetriedaten in die neuen Tabellen fließen, bevor Sie sich in der Produktion auf die Kopie verlassen.

## Upgrade von OneUptime 9 → 10

Keine Änderungen, die manuelle Eingriffe erfordern. Folgen Sie einfach dem Standard-Upgrade-Prozess.

## Upgrade von OneUptime 8 → 9

Das Helm-Chart stellt keine Kubernetes Ingress-Ressource mehr bereit. OneUptime enthält einen Ingress-Gateway-Container, der bereits TLS terminiert, Status-Seiten-Domains verwaltet und den Datenverkehr für die Plattform routed – ein Cluster-Ingress-Controller ist daher nicht mehr erforderlich.

- Entfernen Sie alle `oneuptimeIngress`-Überschreibungen aus Ihren benutzerdefinierten `values.yaml`-Dateien vor dem Upgrade. Diese Schlüssel werden jetzt ignoriert und verursachen Validierungsfehler, wenn sie vorhanden bleiben.
- Stellen Sie sicher, dass `nginx.service.type` widerspiegelt, wie Sie das enthaltene Ingress-Gateway bereitstellen möchten (z. B. `LoadBalancer`, `NodePort` oder `ClusterIP` mit einem externen Load Balancer).
- Überprüfen Sie, ob DNS-Einträge für Status-Seiten oder primäre Hosts weiterhin auf den Service oder Load Balancer verweisen, der das OneUptime Ingress-Gateway bedient.
- Bestätigen Sie nach dem Upgrade, dass TLS-Zertifikate über das eingebettete Gateway weiterhin erneuert werden und dass Status-Seiten-Domains korrekt aufgelöst werden.

## Upgrade von OneUptime 7 → 8

Wenn Sie auf Kubernetes betreiben, gibt es wichtige Breaking Changes:

- Wir verwenden keine Bitnami-Charts mehr für Postgres, Redis und ClickHouse aufgrund von [Bitnami-Lizenzänderungen](https://github.com/bitnami/charts/issues/35164)
- Diese Änderungen sind nicht rückwärtskompatibel. Sie müssen die neue Struktur im Helm-Chart `values.yaml` befolgen.
- Sichern Sie Ihre Daten (Postgres, ClickHouse und alle persistenten Volumes) vor dem Upgrade.

> Tipp: Testen Sie das Upgrade zuerst in einer Staging-Umgebung. Bestätigen Sie, dass Ihre Workloads fehlerfrei sind und die Daten intakt sind, bevor Sie die Produktion upgraden.
