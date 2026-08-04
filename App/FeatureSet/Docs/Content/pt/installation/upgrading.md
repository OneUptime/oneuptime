# Atualizando o OneUptime

Este guia aborda como atualizar com segurança a sua instalação auto-hospedada do OneUptime.

## Orientação Geral

- Atualize passo a passo entre versões principais (por exemplo, 6 → 7 → 8). Não pule versões principais.
- Você pode pular versões menores/de patch (por exemplo, 8.1 → 8.4), desde que siga as notas de lançamento.
- Sempre faça backups antes de atualizar e valide se você consegue restaurá-los.

## Atualização do OneUptime 11 → 12

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

## Atualização do OneUptime 10 → 11

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

O OneUptime 11 reconstrói o armazenamento de telemetria do ClickHouse. Esta página explica o que muda, quem precisa agir e — para instalações que queiram preservar a telemetria histórica — cada consulta necessária para isso.

### O que muda na v11

A telemetria (logs, traces, métricas, exceções, perfis, logs de monitores, logs de auditoria) é movida para novas tabelas do ClickHouse com particionamento temporal, codecs de compressão por coluna e as novas colunas do modelo de entidades:

| Tabela antiga         | Tabela nova           |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

Duas colunas são renomeadas em todas as tabelas de telemetria: `serviceId` → `primaryEntityId` e `serviceType` → `primaryEntityType`. É uma renomeação rígida — **se você consulta a API de analytics do OneUptime diretamente com filtros `serviceId`/`serviceType`, atualize-os para os novos nomes.** Dashboards, monitores e alertas dentro do OneUptime são migrados automaticamente.

O corte é **somente para frente**: as tabelas novas começam vazias, toda a telemetria ingerida após a atualização cai nelas imediatamente e o histórico se preenche naturalmente com o tempo. As tabelas antigas são **removidas automaticamente** durante a atualização para recuperar o espaço em disco — se você quiser manter a opção de levar o histórico adiante, renomeie-as **antes** de atualizar (Passo 0 abaixo).

> **Já está na 11.0.0 ou 11.0.1?** Essas versões mantinham as tabelas antigas (elas se esvaziavam via TTL, e a cópia podia ser executada "a qualquer momento após a atualização"). Qualquer atualização posterior **as remove na inicialização**. Se você ainda quiser fazer a cópia do histórico e ainda não a fez, execute o Passo 0 abaixo antes de aplicar a atualização.

### Quem precisa fazer algo

- **Instalações novas:** nada a fazer.
- **Atualizações que não precisam da telemetria anterior na interface:** nada a fazer. As páginas de telemetria simplesmente mostram dados a partir do momento da atualização; as tabelas antigas são removidas durante a atualização.
- **Atualizações que querem ver a telemetria anterior:** renomeie as tabelas antigas **antes** da atualização (Passo 0 abaixo) e execute a cópia manual a qualquer momento depois dela.

Como sempre: atualize versões principais passo a passo (10 → 11, sem pular) e faça backups do Postgres e do ClickHouse antes de atualizar.

### Opcional: levar o histórico de telemetria adiante

O Passo 0 é executado **antes da atualização**; tudo a partir do Passo 1 é executado **depois que a atualização tiver inicializado por completo** (as tabelas novas e suas views materializadas precisam existir). Conecte-se diretamente no seu host ClickHouse — o protocolo nativo não tem timeouts HTTP, então comandos de várias horas não são problema:

```bash
clickhouse-client --database oneuptime
```

Bom saber antes de começar:

- A cópia pode ser executada com segurança enquanto o OneUptime está no ar. A telemetria nova escreve nas tabelas novas de forma independente; o histórico copiado vai se preenchendo por trás.
- Espere horas em grande escala (centenas de GB).
- Cada comando abaixo carrega um `insert_deduplication_token`, e as tabelas novas vêm com uma janela de deduplicação — então **reexecutar um comando que falhou no meio é seguro** (blocos já inseridos são pulados, inclusive nos rollups de métricas), desde que a reexecução seja razoavelmente rápida. Sob ingestão intensa, a janela (os últimos 10.000 blocos de insert por tabela) acaba expulsando tokens antigos.
- Copiar as métricas também reconstrói automaticamente os rollups pré-agregados dos dashboards (cada linha copiada realimenta as views materializadas de rollup) — isso torna a cópia de métricas mais lenta que as outras; execute-a por último.

#### Passo 0 — antes de atualizar, renomeie as tabelas antigas

A atualização remove as tabelas antigas na inicialização, então tire primeiro do alcance dela as tabelas das quais você quer copiar. Pare o OneUptime (escale o deployment para zero) para que nada escreva nelas nem possa recriá-las, e então renomeie — `RENAME TABLE` é uma operação de metadados instantânea, e `IF EXISTS` faz o bloco pular tabelas que a sua instalação nunca teve (deployments anteriores a meados da 10.0.x podem não ter `AuditLogV1` ou algumas tabelas `…V2` — nesse caso não há histórico desse tipo para copiar):

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

Depois atualize e deixe o OneUptime inicializar por completo antes de continuar.

> Se você voltar para a v10 depois de renomear (a v10 recria na inicialização tabelas vazias com os nomes antigos), renomeie as tabelas `_backup` de volta aos nomes originais antes de reiniciar a v10 — caso contrário, a telemetria ingerida durante o rollback cai nas tabelas recriadas e será removida na futura atualização.

#### Passo 1 — listar as partições de origem

Cada tabela antiga tem no máximo 16 partições. Para cada tabela de origem:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Passo 2 — gerar o comando de cópia

Os conjuntos de colunas podem diferir um pouco entre instalações (deployments mais antigos podem não ter colunas adicionadas recentemente), então gere o comando a partir do seu esquema real em vez de copiar um fixo. Defina `src` e `dst` na cláusula `WITH` com um dos pares de tabelas da tabela acima (a origem carrega o sufixo `_backup` do Passo 0) e execute:

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

O comando gerado copia apenas as colunas que as duas tabelas compartilham (colunas novas recebem seus valores padrão), renomeia `serviceId`/`serviceType` na hora, ordena as linhas de forma determinística para que uma reexecução produza blocos idênticos e deduplicáveis, e remove os limites de tempo de execução e de número de partições de que um comando desse tamanho precisa.

#### Passo 3 — executar, uma partição por vez

Pegue o comando gerado e substitua `{PARTITION}` (aparece duas vezes — no `WHERE` e no token) por cada id de partição do Passo 1. Execute os comandos um por vez e depois repita os Passos 1–3 para cada par de tabelas.

> Nota: se uma tabela de origem foi pulada no Passo 0 porque não existia na sua instalação, o Passo 1 falha com `UNKNOWN_TABLE` para esse par — simplesmente pule o par; não há histórico desse tipo para copiar.

Se um comando falhar no meio, reexecute logo **o mesmo** comando — blocos já confirmados são deduplicados. Se a reexecução for muito mais tarde, compare primeiro as contagens de linhas (Passo 5).

#### Passo 4 (opcional) — histórico do rollup de métricas por host

Linhas de métricas brutas copiadas reconstroem automaticamente os rollups no nível de serviço, mas não o rollup **por host** (linhas antigas não têm chave de entidade de host). A tabela de rollup antiga renomeada no Passo 0 é a única fonte desse histórico; leve-o adiante calculando a nova chave a partir do nome do host:

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

O `ORDER BY` importa: ele faz com que uma reexecução produza blocos de insert idênticos que o token de deduplicação consegue reconhecer. Sem ele, uma reexecução poderia ser pulada silenciosamente ou contada em dobro. (Caso extremo: nomes de host contendo `\`, `|` ou `=` — caracteres não permitidos pela RFC 1123 — calculariam uma chave diferente da aplicação; ignore a menos que você saiba que tem hosts assim.)

#### Passo 5 — verificar

Compare os totais por par de tabelas (a tabela nova também contém linhas posteriores à atualização, então ela deve ser maior ou igual à antiga):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Passo 6 — remover os backups

As tabelas renomeadas mantêm sua TTL de retenção, então se esvaziam e encolhem sozinhas — mas assim que você estiver satisfeito com a cópia, remova-as para recuperar o disco imediatamente:

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

(`max_table_size_to_drop = 0` remove a proteção de exclusão de 50 GB do servidor apenas para esse comando.)

> Dica: como em toda atualização principal, teste primeiro em um ambiente de staging e confirme que a telemetria está fluindo para as tabelas novas antes de confiar na cópia em produção.

## Atualizando do OneUptime 9 → 10

Nenhuma mudança que exija ação manual. Apenas siga o processo de atualização padrão.

## Atualizando do OneUptime 8 → 9

O Helm chart não provisiona mais um recurso Kubernetes Ingress. O OneUptime fornece um contêiner de gateway de ingress que já encerra TLS, gerencia domínios de páginas de status e roteia tráfego para a plataforma, portanto, um controlador de ingress de cluster não é mais necessário.

- Remova quaisquer substituições `oneuptimeIngress` dos seus arquivos `values.yaml` personalizados antes de atualizar. Essas chaves agora são ignoradas e causarão erros de validação se mantidas.
- Certifique-se de que `nginx.service.type` reflita como você deseja expor o gateway de ingress integrado (por exemplo, `LoadBalancer`, `NodePort` ou `ClusterIP` com um balanceador de carga externo).
- Verifique se quaisquer registros DNS para páginas de status ou hosts primários ainda apontam para o Service ou balanceador de carga que está à frente do gateway de ingress do OneUptime.
- Após a atualização, confirme que os certificados TLS continuam a ser renovados via gateway integrado e que os domínios de páginas de status resolvem corretamente.

## Atualizando do OneUptime 7 → 8

Se você estiver executando no Kubernetes, há mudanças importantes:

- Não usamos mais charts do Bitnami para Postgres, Redis e ClickHouse por causa das [Mudanças de Licença do Bitnami](https://github.com/bitnami/charts/issues/35164)
- Essas mudanças não são retrocompatíveis. Você deve seguir a nova estrutura no `values.yaml` do Helm chart.
- Faça backup dos seus dados (Postgres, ClickHouse e quaisquer volumes persistentes) antes de atualizar.

> Dica: Teste a atualização em um ambiente de staging primeiro. Confirme que suas cargas de trabalho estão saudáveis e os dados estão intactos antes de atualizar a produção.
