# Mise à niveau de OneUptime

Ce guide explique comment mettre à niveau en toute sécurité votre installation auto-hébergée de OneUptime.

## Conseils généraux

- Mettez à niveau étape par étape pour les versions majeures (par exemple, 6 → 7 → 8). Ne sautez pas les versions majeures.
- Vous pouvez passer directement d'une version mineure/corrective à une autre (par exemple, 8.1 → 8.4) tant que vous suivez les notes de version.
- Effectuez toujours des sauvegardes avant la mise à niveau et vérifiez que vous pouvez les restaurer.

## Mise à niveau de OneUptime 11 → 12

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

## Mise à niveau de OneUptime 10 → 11

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

OneUptime 11 reconstruit le stockage de télémétrie ClickHouse. Cette page explique ce qui change, qui doit agir et — pour les installations qui souhaitent conserver la télémétrie historique — chaque requête nécessaire pour le faire.

### Ce qui change dans la v11

La télémétrie (logs, traces, métriques, exceptions, profils, logs de monitors, logs d'audit) est déplacée vers de nouvelles tables ClickHouse avec un partitionnement temporel, des codecs de compression par colonne et les nouvelles colonnes du modèle d'entités :

| Ancienne table        | Nouvelle table        |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

Deux colonnes sont renommées dans chaque table de télémétrie : `serviceId` → `primaryEntityId` et `serviceType` → `primaryEntityType`. C'est un renommage strict — **si vous interrogez directement l'API analytics de OneUptime avec des filtres `serviceId`/`serviceType`, mettez-les à jour vers les nouveaux noms.** Les tableaux de bord, monitors et alertes au sein de OneUptime sont migrés automatiquement.

La bascule est **uniquement vers l'avant** : les nouvelles tables démarrent vides, toute la télémétrie ingérée après la mise à niveau y atterrit immédiatement, et l'historique se reconstitue naturellement avec le temps. Les anciennes tables sont **supprimées automatiquement** pendant la mise à niveau afin de récupérer leur espace disque — si vous voulez garder la possibilité de reprendre l'historique, renommez-les **avant** la mise à niveau (étape 0 ci-dessous).

> **Déjà en 11.0.0 ou 11.0.1 ?** Ces versions conservaient les anciennes tables (elles se vidaient via la TTL, et la copie pouvait être lancée « à tout moment après la mise à niveau »). Toute mise à jour ultérieure **les supprime au démarrage**. Si vous souhaitez encore effectuer la copie de l'historique et ne l'avez pas encore faite, exécutez l'étape 0 ci-dessous avant d'appliquer la mise à jour.

### Qui doit agir

- **Nouvelles installations :** rien à faire.
- **Mises à niveau qui n'ont pas besoin de la télémétrie antérieure dans l'interface :** rien à faire. Les pages de télémétrie affichent simplement les données à partir du moment de la mise à niveau ; les anciennes tables sont supprimées pendant la mise à niveau.
- **Mises à niveau qui veulent voir la télémétrie antérieure :** renommez les anciennes tables **avant** la mise à niveau (étape 0 ci-dessous), puis lancez la copie manuelle à tout moment après celle-ci.

Comme toujours : montez les versions majeures une par une (10 → 11, sans en sauter) et faites des sauvegardes de Postgres et de ClickHouse avant la mise à niveau.

### Optionnel : reprendre l'historique de télémétrie

L'étape 0 s'exécute **avant la mise à niveau** ; tout ce qui suit à partir de l'étape 1 s'exécute **après que la mise à niveau a complètement démarré** (les nouvelles tables et leurs vues matérialisées doivent exister). Connectez-vous directement sur votre hôte ClickHouse — le protocole natif n'a pas de timeouts HTTP, donc des requêtes de plusieurs heures ne posent pas de problème :

```bash
clickhouse-client --database oneuptime
```

Bon à savoir avant de commencer :

- La copie peut être lancée en toute sécurité pendant que OneUptime est en production. La nouvelle télémétrie s'écrit indépendamment dans les nouvelles tables ; l'historique copié se remplit derrière.
- Comptez plusieurs heures à grande échelle (centaines de Go).
- Chaque requête ci-dessous porte un `insert_deduplication_token`, et les nouvelles tables sont livrées avec une fenêtre de déduplication — **relancer une requête qui a échoué en cours de route est donc sûr** (les blocs déjà insérés sont ignorés, y compris dans les rollups de métriques), à condition de la relancer rapidement. Sous forte ingestion en continu, la fenêtre (les 10 000 derniers blocs d'insertion par table) finit par évincer les anciens tokens.
- La copie des métriques reconstruit aussi automatiquement les rollups pré-agrégés des tableaux de bord (chaque ligne copiée réalimente les vues matérialisées de rollup) — la copie des métriques est donc plus lente que les autres ; lancez-la en dernier.

#### Étape 0 — avant la mise à niveau, renommer les anciennes tables

La mise à niveau supprime les anciennes tables au démarrage : mettez d'abord hors de sa portée celles depuis lesquelles vous voulez copier. Arrêtez OneUptime (réduisez le déploiement à zéro) pour que plus rien n'y écrive ni ne puisse les recréer, puis renommez — `RENAME TABLE` est une opération de métadonnées instantanée, et `IF EXISTS` permet au bloc d'ignorer les tables que votre installation n'a jamais eues (les déploiements antérieurs à la mi-10.0.x peuvent ne pas avoir `AuditLogV1` ou certaines tables `…V2` — il n'y a alors pas d'historique de ce type à copier) :

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

Effectuez ensuite la mise à niveau et laissez OneUptime démarrer complètement avant de continuer.

> Si vous revenez à la v10 après le renommage (la v10 recrée au démarrage des tables vides avec les anciens noms), renommez les tables `_backup` vers leurs noms d'origine avant de redémarrer la v10 — sinon la télémétrie ingérée pendant le retour arrière atterrit dans les tables recréées et sera supprimée lors de la future mise à niveau.

#### Étape 1 — lister les partitions sources

Chaque ancienne table compte au plus 16 partitions. Pour chaque table source :

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Étape 2 — générer la requête de copie

Les jeux de colonnes peuvent légèrement différer entre installations (les déploiements plus anciens peuvent ne pas avoir les colonnes ajoutées récemment) : générez donc la requête depuis votre schéma réel plutôt que de copier-coller une requête figée. Renseignez `src` et `dst` dans la clause `WITH` avec l'une des paires de tables du tableau ci-dessus (la source porte le suffixe `_backup` de l'étape 0), puis exécutez :

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

La requête générée ne copie que les colonnes communes aux deux tables (les nouvelles colonnes prennent leurs valeurs par défaut), renomme `serviceId`/`serviceType` à la volée, ordonne les lignes de manière déterministe pour qu'une relance produise des blocs identiques et dédupliquables, et lève les limites de temps d'exécution et de nombre de partitions dont une requête de cette taille a besoin.

#### Étape 3 — exécuter, une partition à la fois

Prenez la requête générée et remplacez `{PARTITION}` (présent deux fois — dans le `WHERE` et dans le token) par chaque identifiant de partition de l'étape 1. Exécutez les requêtes une par une, puis répétez les étapes 1 à 3 pour chaque paire de tables.

> Remarque : si une table source a été ignorée à l'étape 0 parce qu'elle n'existait pas sur votre installation, l'étape 1 échoue avec `UNKNOWN_TABLE` pour cette paire — ignorez simplement la paire ; il n'y a pas d'historique de ce type à copier.

Si une requête échoue en cours de route, relancez rapidement **la même** requête — les blocs déjà validés sont dédupliqués. Si la relance intervient bien plus tard, comparez d'abord les nombres de lignes (étape 5).

#### Étape 4 (optionnelle) — historique du rollup de métriques par hôte

Les lignes de métriques brutes copiées reconstruisent automatiquement les rollups au niveau service, mais pas le rollup **par hôte** (les anciennes lignes n'ont pas de clé d'entité hôte). L'ancienne table de rollup renommée à l'étape 0 est la seule source pour cet historique ; reprenez-le en calculant la nouvelle clé à partir du nom d'hôte :

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

Le `ORDER BY` est important : il fait qu'une relance produit des blocs d'insertion identiques que le token de déduplication peut reconnaître. Sans lui, une relance pourrait être silencieusement ignorée ou comptée deux fois. (Cas limite : des noms d'hôte contenant `\`, `|` ou `=` — caractères non autorisés par la RFC 1123 — calculeraient une clé différente de celle de l'application ; ignorez ce point sauf si vous savez que vous avez de tels hôtes.)

#### Étape 5 — vérifier

Comparez les totaux par paire de tables (la nouvelle table contient aussi les lignes postérieures à la mise à niveau, elle doit donc être supérieure ou égale à l'ancienne) :

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Étape 6 — supprimer les sauvegardes

Les tables renommées conservent leur TTL de rétention : elles se vident et rétrécissent donc d'elles-mêmes — mais une fois satisfait de la copie, supprimez-les pour récupérer l'espace disque immédiatement :

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

(`max_table_size_to_drop = 0` lève la protection de suppression de 50 Go du serveur pour cette seule requête.)

> Astuce : comme pour toute mise à niveau majeure, testez d'abord dans un environnement de staging et confirmez que la télémétrie arrive bien dans les nouvelles tables avant de vous appuyer sur la copie en production.

## Mise à niveau de OneUptime 9 → 10

Aucun changement nécessitant une action manuelle. Suivez simplement le processus de mise à niveau standard.

## Mise à niveau de OneUptime 8 → 9

Le chart Helm ne provisionne plus de ressource Kubernetes Ingress. OneUptime inclut un conteneur de passerelle d'entrée qui termine déjà le TLS, gère les domaines des pages de statut et achemine le trafic pour la plateforme, de sorte qu'un contrôleur d'entrée de cluster n'est plus nécessaire.

- Supprimez les remplacements `oneuptimeIngress` de vos fichiers `values.yaml` personnalisés avant la mise à niveau. Ces clés sont désormais ignorées et provoqueront des erreurs de validation si elles sont laissées en place.
- Assurez-vous que `nginx.service.type` reflète la façon dont vous souhaitez exposer la passerelle d'entrée intégrée (par exemple `LoadBalancer`, `NodePort` ou `ClusterIP` avec un équilibreur de charge externe).
- Vérifiez que les enregistrements DNS pour les pages de statut ou les hôtes primaires pointent toujours vers le Service ou l'équilibreur de charge qui protège la passerelle d'entrée OneUptime.
- Après la mise à niveau, confirmez que les certificats TLS continuent d'être renouvelés via la passerelle intégrée et que les domaines des pages de statut se résolvent correctement.

## Mise à niveau de OneUptime 7 → 8

Si vous exécutez sur Kubernetes, il y a des changements importants avec rupture de compatibilité :

- Nous n'utilisons plus les charts Bitnami pour Postgres, Redis et ClickHouse en raison des [changements de licence Bitnami](https://github.com/bitnami/charts/issues/35164)
- Ces changements ne sont pas rétrocompatibles. Vous devez suivre la nouvelle structure dans le fichier `values.yaml` du chart Helm.
- Sauvegardez vos données (Postgres, ClickHouse et tout volume persistant) avant la mise à niveau.

> Conseil : Testez d'abord la mise à niveau dans un environnement de staging. Vérifiez que vos charges de travail sont saines et que les données sont intactes avant de mettre à niveau la production.
