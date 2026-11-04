# Linhagem e pipelines

A linhagem diz a partir de quais tabelas cada tabela é construída e quais pipelines escrevem nela. A Observabilidade de dados a reúne de seis lugares ao mesmo tempo - eventos do OpenLineage, dbt, sincronizações do Fivetran e do Airbyte, jobs nos seus traces, views e o próprio histórico de consultas de cada banco de dados - e a usa para ligar cada tabela atrasada ou quebrada à execução por trás dela, para que um problema abra um só alerta.

## De onde vem a linhagem

| Origem | O que ela fornece |
| --- | --- |
| **OpenLineage** | Cada execução de um job do Airflow, Dagster, Spark, dbt ou Flink, e as tabelas que ele leu e escreveu |
| **dbt** | A partir de que cada modelo é construído, cada build como uma execução, e o resultado de cada teste |
| **Fivetran e Airbyte** | Cada sincronização como uma execução do seu conector, e as tabelas brutas que ela carrega |
| **Jobs nos seus traces** | Um CronJob do Kubernetes ou uma função agendada, as suas execuções, e as tabelas que as chamadas de banco de dados dele leram e escreveram |
| **Views** | Uma view é construída a partir das tabelas sobre as quais é definida (PostgreSQL, Redshift, MySQL 8, SQL Server, Oracle, Snowflake, views materializadas do ClickHouse, Databricks, MongoDB) |
| **Histórico de consultas** | Uma consulta que leu uma tabela e escreveu em outra (o histórico de acessos do Snowflake, os jobs do BigQuery, o log de consultas do Redshift, o log de consultas do ClickHouse, a tabela de linhagem do Databricks) |

A aba **Linhagem** de uma tabela mostra as tabelas a partir das quais ela é construída, os pipelines que escrevem nela com a última execução de cada um, e as tabelas construídas a partir dela. Cada aresta diz onde foi vista.

Quando a origem nomeia colunas, a aba **Colunas** de uma tabela diz de onde vem cada coluna e o que ela alimenta: o histórico de acessos do Snowflake (edição Enterprise, que exige `IMPORTED PRIVILEGES` no banco de dados `SNOWFLAKE`) e a faceta `columnLineage` do OpenLineage.

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

## Jobs nos seus traces

Muitos pipelines são um CronJob do Kubernetes, ou uma função em um temporizador, sem nenhum agendador para enviar linhagem. Os traces deles dizem tudo do mesmo jeito, sem nada para instalar. A cada quinze minutos, os spans com o atributo de recurso `k8s.cronjob.name` ou `k8s.job.name`, ou `faas.name` com um `faas.trigger` de `timer` ou `datasource`, viram um pipeline em **Pipelines**:

- Uma execução de um CronJob é o Job do Kubernetes dele, e uma execução de uma função é o seu `faas.invocation_id`.
- Uma execução falhou quando o span no topo do trace dela falhou. Uma chamada que falhou e foi repetida dentro dela não a faz falhar.
- As tabelas que ela escreveu e leu vêm dos spans de banco de dados dela.

Cada execução tem um link para o seu trace, com os logs dela. Valem os mesmos três monitores, então um CronJob que para de rodar é visto como atrasado.

## Painéis em ferramentas de BI

O impacto real de dados ruins é o painel que alguém abre. Em **Painéis de BI**, adicione suas ferramentas de BI com credenciais que possam ler os painéis delas. A cada hora, a Observabilidade de dados lê cada painel e as tabelas por trás dele, associa cada tabela a uma monitorada e mostra os painéis construídos sobre uma tabela, e sobre as tabelas construídas a partir dela, na aba **Linhagem**, nos alertas e no Production Review.

| Ferramenta | Credenciais |
| --- | --- |
| **Metabase** | `{ "apiKey": "mb_..." }` |
| **Superset** | `{ "username": "...", "password": "..." }` |
| **Tableau** | `{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }` |
| **Looker** | `{ "clientId": "...", "clientSecret": "..." }` |
| **Power BI** | `{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }`, uma entidade de serviço autorizada a usar as APIs de administração do Power BI |
| **Hightouch** | `{ "apiKey": "..." }` |
| **Census** | `{ "apiKey": "...", "region": "us" }` (ou `eu`) |

Hightouch e Census são ferramentas de ETL reverso: uma sincronização que copia uma tabela para um CRM depende dessa tabela como um painel depende, então é lida do mesmo modo e citada nos alertas da tabela.

Somente nomes e links dos painéis e as tabelas que eles consultam são lidos: nunca seus dados.

## Pipelines

Cada job, projeto dbt e sincronização aparece em **Pipelines**, com as suas execuções: quando cada uma começou e terminou, quanto tempo levou, qual tentativa ela foi onde o agendador informa (o número da tentativa do Airflow) e o erro de uma execução com falha. Depois de cinco execuções, cada pipeline aprende com as próprias execuções quanto tempo uma execução costuma levar e quanto tempo ele costuma ficar entre execuções no seu agendamento. A página de um pipeline recomenda três monitores:

- **Pipeline Run Failed**: uma execução falhou ou foi abortada.
- **Pipeline Run Unusually Long**: uma execução levou o dobro do tempo típico ou mais, verificado a cada cinco minutos enquanto ela roda, para que uma execução travada seja notada antes de terminar.
- **Pipeline Is Late**: nenhuma execução começa há mais tempo do que o agendamento dele permite.

## Um alerta por causa

Quando uma tabela fica desatualizada, todas as tabelas construídas a partir dela também ficam. Antes que um alerta de dados seja aberto, o OneUptime procura na linhagem um alerta já aberto sobre aquilo a partir do qual a tabela ou o pipeline dele é construído: as tabelas a montante, os pipelines que escrevem nelas e os bancos de dados em que elas ficam, até cinco níveis acima. Quando encontra um, o novo alerta é consequência desse alerta:

- Ele começa **confirmado**, para que ninguém seja acionado duas vezes por um só problema, e se recupera sozinho assim que os dados dele se recuperam.
- O feed dele e o cartão **Dados** dele dizem qual alerta o causou, e ele entra no episódio da causa.

O cartão **Dados** da causa lista o **Impacto a jusante** dela: cada alerta que ela causou. O cartão de um alerta de tabela também mostra os serviços que escrevem na tabela, com as escritas que falharam, e as implantações e outras mudanças deles no dia anterior ao alerta.

## Antes de uma alteração ser mesclada

Quando um pull request altera uma tabela observada, o [Production Review](/docs/ai/ai-agent) diz no pull request o que depende dela: os serviços que a leem, as tabelas construídas a partir dela, os painéis sobre ela e os produtos de dados dela. Uma tabela com uma cópia em um banco de dados marcado como Staging também diz como a cópia difere: as linhas, as colunas e o que as verificações da tabela leem lá, executadas na hora. Em um banco de dados que só uma sonda alcança, as verificações ficam de fora, e ele avisa.

## Próximos passos

:::cards
- [Produtos de dados](/docs/data-observability/data-products): SLAs de atualização sobre as tabelas que as pessoas usam.
- [OneUptime AI e a API](/docs/data-observability/ai-and-api): Investigações que partem de quem escreve em uma tabela e das execuções dela.
:::
