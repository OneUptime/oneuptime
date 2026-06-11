# Atualizando o OneUptime

Este guia aborda como atualizar com segurança a sua instalação auto-hospedada do OneUptime.

## Orientação Geral

- Atualize passo a passo entre versões principais (por exemplo, 6 → 7 → 8). Não pule versões principais.
- Você pode pular versões menores/de patch (por exemplo, 8.1 → 8.4), desde que siga as notas de lançamento.
- Sempre faça backups antes de atualizar e valide se você consegue restaurá-los.

## Atualizando do OneUptime 10 → 11

O OneUptime 11 reconstrói o armazenamento de telemetria no ClickHouse. Esta página explica
o que muda, quem precisa agir e — para instalações que desejam levar adiante
a telemetria histórica — todas as queries necessárias para fazê-lo.

### O que muda na v11

A telemetria (logs, traces, métricas, exceções, perfis, logs de monitores,
logs de auditoria) passa para novas tabelas do ClickHouse com particionamento
baseado em tempo, codecs de compressão por coluna e as novas colunas do
modelo de entidades:

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

Duas colunas são renomeadas em todas as tabelas de telemetria: `serviceId` →
`primaryEntityId` e `serviceType` → `primaryEntityType`. Trata-se de uma
renomeação definitiva — **se você consulta a API de analytics do OneUptime
diretamente com filtros `serviceId`/`serviceType`, atualize-os para os novos
nomes.** Dashboards, monitores e alertas dentro do OneUptime são migrados
automaticamente.

A transição é **apenas para frente (forward-only)**: as novas tabelas começam
vazias, toda a telemetria ingerida após a atualização passa a ser gravada
nelas imediatamente, e o histórico se preenche naturalmente com o passar do
tempo. As tabelas antigas são mantidas e se apagam gradualmente por meio do
TTL de retenção.

### Quem precisa fazer algo

- **Instalações novas:** nada a fazer.
- **Atualizações que não precisam da telemetria pré-atualização na interface:**
  nada a fazer. As páginas de telemetria simplesmente mostram dados a partir do
  momento da atualização; os dados mais antigos expiram nas tabelas antigas
  sem serem exibidos.
- **Atualizações que desejam manter a telemetria pré-atualização visível:**
  execute a cópia manual abaixo, a qualquer momento após a atualização.

Como sempre: atualize as versões principais passo a passo (10 → 11, sem pular)
e faça backups do Postgres e do ClickHouse antes de atualizar.

### Opcional: levar adiante o histórico de telemetria

Execute estes passos **após a atualização ter inicializado por completo** (as
novas tabelas e suas materialized views precisam existir). Conecte-se
diretamente no seu host do ClickHouse — o protocolo nativo não tem timeouts
de HTTP, então instruções de várias horas funcionam sem problemas:

```bash
clickhouse-client --database oneuptime
```

Bom saber antes de começar:

- A cópia é segura para executar com o OneUptime em produção. A nova
  telemetria é gravada nas novas tabelas de forma independente; o histórico
  copiado vai sendo preenchido por trás.
- Espere horas em grande escala (centenas de GB).
- Cada instrução abaixo carrega um `insert_deduplication_token`, e as novas
  tabelas vêm com uma janela de deduplicação — então **reexecutar uma
  instrução que falhou no meio do caminho é seguro** (blocos já inseridos são
  ignorados, inclusive nos rollups de métricas), desde que a reexecução
  ocorra razoavelmente cedo. Sob ingestão intensa em produção, a janela
  (últimos 10.000 blocos de insert por tabela) acaba descartando tokens
  antigos.
- Copiar métricas também reconstrói automaticamente os rollups pré-agregados
  dos dashboards (cada linha copiada realimenta as materialized views de
  rollup) — isso torna a cópia de métricas mais lenta que as demais; execute-a
  por último.

#### Passo 1 — liste as partições de origem

Cada tabela antiga tem no máximo 16 partições. Para cada tabela de origem:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2 ORDER BY _partition_id;
```

#### Passo 2 — gere a instrução de cópia

Os conjuntos de colunas podem variar ligeiramente entre instalações
(implantações mais antigas podem não ter colunas adicionadas recentemente),
então gere a instrução a partir do seu schema em produção em vez de copiar e
colar uma versão fixa. Defina `src` e `dst` na cláusula `WITH` com um dos
pares de tabelas da tabela acima e execute:

```sql
WITH 'LogItemV2' AS src, 'LogItemV3' AS dst
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

A instrução gerada copia apenas as colunas que as duas tabelas têm em comum
(as colunas novas assumem seus valores padrão), renomeia
`serviceId`/`serviceType` em tempo de execução, ordena as linhas de forma
determinística para que uma nova tentativa produza blocos idênticos e
deduplicáveis, e remove os limites de tempo de execução e de contagem de
partições de que uma instrução desse porte precisa.

#### Passo 3 — execute, uma partição por vez

Pegue a instrução gerada e substitua `{PARTITION}` (aparece duas vezes — no
`WHERE` e no token) por cada id de partição do Passo 1. Execute as instruções
uma de cada vez e, em seguida, repita os Passos 1–3 para cada par de tabelas.

Se uma instrução falhar no meio do caminho, reexecute a **mesma** instrução
prontamente — os blocos já confirmados são deduplicados. Se for reexecutar
muito tempo depois, compare as contagens de linhas primeiro (Passo 5).

#### Passo 4 (opcional) — histórico do rollup de métricas por host

As linhas brutas de métricas copiadas reconstroem automaticamente os rollups
no nível de serviço, mas não o rollup **por host** (as linhas antigas não têm
chave de entidade de host). A atualização deixa intencionalmente a tabela
antiga de rollup por host no lugar para que você possa levá-la adiante,
calculando a nova chave a partir do hostname:

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
FROM MetricItemAggMV1mByHost
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

#### Passo 5 — verifique

Compare os totais de cada par de tabelas (a tabela nova também contém linhas
pós-atualização, então ela deve ser maior ou igual à antiga):

```sql
SELECT
  (SELECT count() FROM LogItemV2) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Passo 6 (opcional) — recupere espaço em disco mais cedo

As tabelas antigas se esvaziam sozinhas via TTL, mas, assim que você estiver
satisfeito com a cópia, pode removê-las imediatamente:

```sql
DROP TABLE IF EXISTS LogItemV2;
DROP TABLE IF EXISTS MetricItemV2;
DROP TABLE IF EXISTS SpanItemV2;
DROP TABLE IF EXISTS ExceptionItemV2;
DROP TABLE IF EXISTS ProfileItemV2;
DROP TABLE IF EXISTS ProfileSampleItemV2;
DROP TABLE IF EXISTS MonitorLogV2;
DROP TABLE IF EXISTS AuditLogV1;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost;
```

> Dica: como em toda atualização de versão principal, teste primeiro em um
> ambiente de staging e confirme que a telemetria está fluindo para as novas
> tabelas antes de depender da cópia em produção.



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
