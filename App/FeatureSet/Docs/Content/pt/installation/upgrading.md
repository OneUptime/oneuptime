# Atualizando o OneUptime

Este guia aborda como atualizar com segurança a sua instalação auto-hospedada do OneUptime.

## Orientação Geral

- Atualize passo a passo entre versões principais (por exemplo, 6 → 7 → 8). Não pule versões principais.
- Você pode pular versões menores/de patch (por exemplo, 8.1 → 8.4), desde que siga as notas de lançamento.
- Sempre faça backups antes de atualizar e valide se você consegue restaurá-los.

## Atualização do OneUptime 10 → 11

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
