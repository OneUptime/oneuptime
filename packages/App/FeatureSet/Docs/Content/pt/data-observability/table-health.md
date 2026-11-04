# Saúde das tabelas

A cada cinco minutos, o catálogo de cada banco de dados conectado diz como cada tabela está: quando ela mudou pela última vez, quantas linhas contém, qual o tamanho dela e quais são as suas colunas. A partir disso, a Observabilidade de dados aprende o ritmo de cada tabela e avisa quando uma tabela atrasa, encolhe ou muda de forma, sem nenhum limite para configurar.

## O que é lido

Para cada tabela e view:

- **Contagem de linhas e tamanho**, a partir das próprias estatísticas do mecanismo.
- **Quando ela mudou pela última vez**: o horário que o próprio mecanismo guarda, quando guarda, ou o momento em que os contadores de escrita, as linhas ou os bytes dela se moveram entre duas coletas.
- **As colunas dela**, com os tipos e se podem ficar vazias.
- **Quando ela foi lida pela última vez**, onde o mecanismo conta leituras.

Só o catálogo é lido. Nenhuma linha é lida, e nenhum valor sai do banco de dados.

## Atualidade

O **ritmo** de uma tabela é a frequência com que ela costuma mudar, aprendida a partir do tempo entre as suas mudanças. Uma tabela que passa bem do seu ritmo aparece como **Late**, na página dela e em **Tabelas**, e grava o quanto já passou. A atualidade dela é conhecida assim que ela muda duas vezes: uma tabela carregada de hora em hora é aprendida em poucas horas, e uma carregada todas as noites, em poucos dias.

Uma view não tem linhas próprias, então a atualidade dela é a atualidade das suas origens: veja [Linhagem e pipelines](/docs/data-observability/lineage-and-pipelines).

## Volume e mudanças de esquema

- **Linhas** são comparadas entre coletas: uma tabela que perde metade das linhas, ou que contém bem menos do que o normal para aquela hora da semana, avisa.
- **Colunas** também são comparadas. Uma coluna adicionada, removida, renomeada, com tipo alterado ou que passou a aceitar nulos vai para a **Linha do tempo** da tabela e para **Alterações de esquema**, que lista cada mudança de cada banco de dados, da mais recente para a mais antiga.
- As **tabelas excluídas** ficam guardadas em **Tabelas removidas**, com quando foram vistas pela última vez, e voltam com o seu histórico se a tabela reaparecer.

## Alertas recomendados

Em **Bancos de dados**, escolha **Recommended Alerts** para um banco de dados. Cada recomendação é um monitor de métricas para o banco de dados inteiro que alerta uma vez por tabela, então uma tabela criada depois também é observada:

| Alerta | Dispara quando |
| --- | --- |
| **Table Is Late** | Uma tabela fica quinze minutos além do prazo em que costuma mudar |
| **Row Count Fell Sharply** | Uma tabela perde metade das linhas ou mais entre duas coletas |
| **Row Count Unusually Low** | Uma tabela contém bem menos linhas do que o normal para aquela hora da semana (aprendido ao longo de duas semanas) |
| **Schema Changed** | Colunas de uma tabela são adicionadas, removidas, renomeadas ou têm o tipo alterado |
| **Table Health Stopped Reporting** | Nenhuma tabela do banco de dados foi lida por quinze minutos |

Escolha gravidades, políticas de plantão, proprietários e rótulos ao criá-los. A partir daí eles são monitores comuns: edite-os, silencie-os ou coloque-os em uma página de status como qualquer outro.

## Métricas que cada tabela grava

Cada coleta grava estas métricas para cada tabela, para que você possa colocá-las em gráficos e dashboards e criar alertas sobre elas como qualquer outra métrica:

| Métrica | O que é |
| --- | --- |
| `oneuptime.data.table.row_count` | Linhas na tabela |
| `oneuptime.data.table.size` | Bytes ocupados pela tabela e pelos seus índices |
| `oneuptime.data.table.seconds_since_change` | Segundos desde a última mudança da tabela |
| `oneuptime.data.table.overdue_seconds` | Segundos que a tabela passou do prazo em que costuma mudar; 0 enquanto está no prazo |
| `oneuptime.data.table.row_count_change_percent` | Quanto a contagem de linhas variou desde a coleta anterior, em porcentagem |
| `oneuptime.data.table.schema_changes` | Colunas alteradas desde a coleta anterior |

Cada linha traz `oneuptime.data.store.id`, `oneuptime.data.store.name`, `oneuptime.data.table.id`, `oneuptime.data.table.schema`, `oneuptime.data.table.name` e `oneuptime.data.table.key` (`schema.table`). Um [monitor de métricas](/docs/monitor/metrics-monitor) agrupado por `oneuptime.data.table.key` alerta uma vez por tabela, e os filtros **Anomalously High** e **Anomalously Low** dele comparam cada tabela com o seu próprio valor habitual para aquela hora da semana. Essas métricas são dados operacionais do próprio OneUptime e não são cobradas como telemetria.

## Tabelas não utilizadas

Cada mecanismo que conta leituras diz quando cada tabela foi lida pela última vez: as varreduras do PostgreSQL, o performance_schema do MySQL, as buscas, varreduras e pesquisas do SQL Server, e o histórico de consultas do Redshift, do ClickHouse e do Databricks. Uma leitura vista nos spans de banco de dados dos seus serviços também conta.

**Tabelas não utilizadas** lista as tabelas que ninguém leu em 90 dias, das maiores para as menores, com quando cada uma foi escrita pela última vez: uma tabela que ainda recebe escritas, mas nunca é lida, custa as escritas e o armazenamento dela. Um contador em 0 na primeira coleta de uma tabela significa que ela não foi lida desde que as estatísticas do mecanismo começaram, então uma tabela não utilizada aparece como não utilizada desde o início.

## Gasto do warehouse

A cada hora, a Observabilidade de dados lê quanto cada warehouse do Snowflake e do BigQuery gastou no último dia, job por job: os créditos de computação do Snowflake, de `QUERY_ATTRIBUTION_HISTORY`, e os bytes faturados do BigQuery, da sua visão de jobs, que exige **BigQuery Resource Viewer**. Um job é uma consulta executada repetidamente, nomeada pela tag de consulta ou label, ou pelo que faz e pela tabela que escreve: nunca pelo texto da consulta.

**Gasto do warehouse** mostra os totais por equipe (o `team` na tag ou no label de um job, senão quem o executa), as tabelas cujas escritas custam mais, os jobs que falharam e o que vai para jobs que só escrevem tabelas que ninguém leu em 90 dias.

## Serviços que usam cada tabela

A aba **Serviços** de uma tabela lista os serviços vistos escrevendo nela e lendo dela, com as instruções que cada um executou, as chamadas e falhas dele na última hora, e quando foi visto pela última vez. Ela vem dos spans de banco de dados que os seus serviços já enviam com OpenTelemetry: um span de cliente com `db.system.name`, `db.namespace` e `db.collection.name`. Nada a mais para instalar.

Um span só é ligado a uma tabela quando o banco de dados dele é um que uma coleta leu, e, quando dois bancos de dados têm o mesmo nome, só quando o `server.address` dele é um dos deles.

## Próximos passos

:::cards
- [Verificações e reconciliações](/docs/data-observability/checks): Regras sobre o que uma tabela contém, além de se ela muda.
- [Linhagem e pipelines](/docs/data-observability/lineage-and-pipelines): De onde vêm os dados de uma tabela atrasada, e a execução que deveria tê-la carregado.
:::
