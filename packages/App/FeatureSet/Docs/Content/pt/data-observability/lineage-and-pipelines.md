# Linhagem e pipelines

A linhagem diz a partir de quais tabelas cada tabela é construída e quais pipelines escrevem nela. A Observabilidade de dados a reúne de cinco lugares ao mesmo tempo - eventos do OpenLineage, dbt, sincronizações do Fivetran e do Airbyte, views e o próprio histórico de consultas de cada banco de dados - e a usa para ligar cada tabela atrasada ou quebrada à execução por trás dela, para que um problema abra um só alerta.

## De onde vem a linhagem

| Origem | O que ela fornece |
| --- | --- |
| **OpenLineage** | Cada execução de um job do Airflow, Dagster, Spark, dbt ou Flink, e as tabelas que ele leu e escreveu |
| **dbt** | A partir de que cada modelo é construído, cada build como uma execução, e o resultado de cada teste |
| **Fivetran e Airbyte** | Cada sincronização como uma execução do seu conector, e as tabelas brutas que ela carrega |
| **Views** | Uma view é construída a partir das tabelas sobre as quais é definida (PostgreSQL, Redshift, MySQL 8, SQL Server, views materializadas do ClickHouse, Databricks) |
| **Histórico de consultas** | Uma consulta que leu uma tabela e escreveu em outra (os jobs do BigQuery, o log de consultas do Redshift, o log de consultas do ClickHouse, a tabela de linhagem do Databricks) |

A aba **Linhagem** de uma tabela mostra as tabelas a partir das quais ela é construída, os pipelines que escrevem nela com a última execução de cada um, e as tabelas construídas a partir dela. Cada aresta diz onde foi vista.

## OpenLineage

Envie eventos do OpenLineage ao OneUptime, sem alterações, com uma [chave de ingestão](/docs/telemetry/ingestion-keys) de telemetria:

- **URL:** `https://oneuptime.com/telemetry/openlineage` (em um OneUptime auto-hospedado, o seu próprio endereço)
- **Endpoint:** `api/v1/lineage`, o padrão do OpenLineage
- **Chave de API:** a chave de ingestão, enviada como `Authorization: Bearer`, ou defina `x-oneuptime-token`

Para o provedor OpenLineage do Airflow:

```bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
```

Para qualquer outro cliente OpenLineage, defina `OPENLINEAGE_URL` e `OPENLINEAGE_API_KEY`. Os datasets são associados a tabelas pela especificação de nomes do OpenLineage, como `postgres://host:5432` com `database.schema.table`, `snowflake://account` com `database.schema.table`, `clickhouse://host:8443` com `database.table` e `databricks://workspace-host` com `catalog.schema.table`.

## dbt

Depois de `dbt build` (ou run, test, seed ou snapshot), envie os artefatos do projeto com a [CLI do OneUptime](/docs/cli/index):

```bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
```

No CI, execute `oneuptime dbt upload` como a etapa seguinte ao build, mesmo quando o build falha, para que os testes com falha sejam registrados. Cada tabela que o dbt constrói ganha um cartão **dbt** na Visão geral dela, a linhagem dos seus modelos e os testes dela na aba **Verificações**; cada build é uma execução do pipeline do projeto.

## Fivetran e Airbyte

Os webhooks deles dizem quando cada sincronização começa e termina. **Pipelines > Conectar Fivetran ou Airbyte** preenche as URLs com uma das suas chaves de ingestão:

- **Fivetran:** um webhook criado com a API REST do Fivetran, para os eventos `sync_start` e `sync_end`, apontando para `https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>`, com a chave de ingestão como segredo. O Fivetran assina cada entrega com ela, então a chave nunca trafega na URL.
- **Airbyte:** o webhook do workspace definido como `https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>`, ativado para sincronizações com falha e bem-sucedidas. Dê ao Airbyte uma chave só dele.

Uma sincronização do Fivetran reagendada por causa do limite de taxa de uma API termina como **Reagendada**: não é uma falha, então não aciona ninguém.

## Pipelines

Cada job, projeto dbt e sincronização aparece em **Pipelines**, com as suas execuções: quando cada uma começou e terminou, quanto tempo levou e o erro de uma execução com falha. Depois de cinco execuções, cada pipeline aprende com as próprias execuções quanto tempo uma execução costuma levar e quanto tempo ele costuma ficar entre execuções no seu agendamento. A página de um pipeline recomenda três monitores:

- **Pipeline Run Failed**: uma execução falhou ou foi abortada.
- **Pipeline Run Unusually Long**: uma execução levou o dobro do tempo típico ou mais, verificado a cada cinco minutos enquanto ela roda, para que uma execução travada seja notada antes de terminar.
- **Pipeline Is Late**: nenhuma execução começa há mais tempo do que o agendamento dele permite.

## Um alerta por causa

Quando uma tabela fica desatualizada, todas as tabelas construídas a partir dela também ficam. Antes que um alerta de dados seja aberto, o OneUptime procura na linhagem um alerta já aberto sobre aquilo a partir do qual a tabela ou o pipeline dele é construído: as tabelas a montante, os pipelines que escrevem nelas e os bancos de dados em que elas ficam, até cinco níveis acima. Quando encontra um, o novo alerta é consequência desse alerta:

- Ele começa **confirmado**, para que ninguém seja acionado duas vezes por um só problema, e se recupera sozinho assim que os dados dele se recuperam.
- O feed dele e o cartão **Dados** dele dizem qual alerta o causou, e ele entra no episódio da causa.

O cartão **Dados** da causa lista o **Downstream Impact** dela: cada alerta que ela causou. O cartão de um alerta de tabela também mostra os serviços que escrevem na tabela, com as escritas que falharam, e as implantações e outras mudanças deles no dia anterior ao alerta.

## Próximos passos

:::cards
- [Produtos de dados](/docs/data-observability/data-products): SLAs de atualização sobre as tabelas que as pessoas usam.
- [OneUptime AI e a API](/docs/data-observability/ai-and-api): Investigações que partem de quem escreve em uma tabela e das execuções dela.
:::
