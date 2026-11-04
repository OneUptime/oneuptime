# Conectar um banco de dados

A Observabilidade de dados lê cada banco de dados com um login que só lê o catálogo dele: quais tabelas e views ele contém, as colunas, linhas e o tamanho delas, e quando mudaram. Esta página mostra o mínimo de que cada mecanismo precisa, e como manter a string de conexão dentro da sua rede com uma sonda.

## Antes de começar

- **Uma função que possa conectar bancos de dados**: Proprietário do projeto, Administrador do projeto ou Administrador de telemetria.
- **Um login somente leitura**, criado com as instruções abaixo. As verificações que você adicionar depois leem linhas das tabelas que verificam, então conceda ao login `SELECT` nessas tabelas só quando adicionar uma.

## Escolha quem se conecta

Em **Observabilidade de dados > Bancos de dados**, escolha **Connect a Database** e depois:

- **OneUptime connects**: cole uma string de conexão. Ela é armazenada criptografada, usada apenas pelos workers do OneUptime e nunca mais é exibida.
- **A probe in my network connects**: escolha uma das suas sondas e informe o nome da variável de ambiente, na sonda, que contém a string de conexão, como `ORDERS_DB_URL`. A string de conexão nunca sai da sua rede. Veja [Sondas personalizadas](/docs/probe/custom-probe).

Um banco de dados já conectado para a Segurança de dados também é observado, sem nada para conectar, assim como cada dataset do BigQuery que a sua [conexão de nuvem](/docs/telemetry/cloud-accounts) encontrou.

## Bancos de dados que você pode conectar

**Bancos de dados que você pode conectar**, em **Bancos de dados**, lista o que o seu projeto já conhece e ninguém conectou: bancos de dados com os quais os seus traces conversam, os das suas contas de nuvem e os que o Monitoramento de banco de dados acompanha. **Conectar** inicia o formulário a partir do que se sabe de cada um, com uma string de conexão para preencher. **Dispensar** impede que um volte. Nada é lido até que você o conecte.

## Um login somente leitura, por mecanismo

:::tabs
@tab PostgreSQL
```sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
```

A string de conexão: `postgres://oneuptime_reader:...@orders-db.internal:5432/orders?sslmode=require`. O OneUptime lê `pg_class`, `pg_stat_user_tables` e `pg_attribute`: uma tabela mudou quando os contadores de inserção, atualização ou exclusão dela se moveram, e foi lida quando os contadores de varredura se moveram.
@tab MySQL and MariaDB
```sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
```

`performance_schema` permite que o OneUptime veja escritas e leituras entre uma coleta e outra; sem ele, `information_schema.TABLES` ainda diz quando cada tabela mudou pela última vez.
@tab SQL Server
```sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
```

`VIEW DATABASE STATE` permite que o OneUptime leia tamanhos, últimas atualizações e últimas leituras.
@tab Amazon Redshift
```sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
```

Conecte-se com uma string de conexão PostgreSQL ao endpoint do cluster ou do workgroup, como `postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require`. `SYSLOG ACCESS UNRESTRICTED` permite que o OneUptime leia contagens de linhas e tamanhos, as últimas escritas e leituras de todos os usuários, e a linhagem a partir do log de consultas. Sem isso, a mudança nas linhas de uma tabela ainda diz quando ela mudou.
@tab Snowflake
```sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
```

O Snowflake é lido pela SQL API dele, com autenticação por par de chaves. Conecte-se com JSON:

```json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
```

O catálogo é lido com `SHOW`, que não precisa de warehouse, então a coleta não consome créditos. Só as verificações rodam no warehouse, no agendamento que você der a elas.
@tab Google BigQuery
Cada dataset que a sua conexão de nuvem encontrou é observado com a conta de serviço dessa conexão. Conceda a ela **BigQuery Metadata Viewer** e **BigQuery Job User** no projeto para ler o catálogo, **BigQuery Data Viewer** nas tabelas que as suas verificações leem, e **BigQuery Resource Viewer** para a linhagem a partir dos jobs dele.

Cada coleta lê a `__TABLES__` do dataset (linhas, bytes e última alteração, sem custo) e a `INFORMATION_SCHEMA.COLUMNS` dele (cobrada pelo mínimo de 10 MB do BigQuery). Para conectar um dataset sem uma conexão de nuvem, informe um JSON com uma chave de conta de serviço:

```json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
```
@tab ClickHouse
```sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
```

O ClickHouse é lido pela interface HTTP dele, na porta 8443 com TLS (ClickHouse Cloud) ou 8123 sem: `clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics`. Informe um banco de dados para observar só ele, ou omita-o para observar todos os bancos de dados, exceto os do próprio servidor. `system.parts` permite que o OneUptime veja cada inserção (um merge não conta), `system.part_log`, onde o servidor o mantém, dá o horário de cada inserção, e `system.query_log` dá as últimas leituras e a linhagem uma vez por hora. Toda instrução roda em modo somente leitura, então nem mesmo um login que pudesse escrever consegue escrever.
@tab Databricks
```sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO `oneuptime-reader`;
GRANT USE SCHEMA ON CATALOG main TO `oneuptime-reader`;
GRANT USE CATALOG ON CATALOG system TO `oneuptime-reader`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO `oneuptime-reader`;
```

Um catálogo do Unity Catalog é um banco de dados. Conecte-se com uma entidade de serviço, ou com um token de acesso pessoal como `"token"` no lugar de `clientId` e `clientSecret`:

```json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
```

O catálogo, as colunas dele e o último commit de cada tabela Delta vêm da API REST do Unity Catalog, sem SQL warehouse, então a coleta não consome computação. As verificações, e a linhagem e as últimas leituras de `system.access.table_lineage` uma vez por hora, rodam no SQL warehouse que você indicar; conceda à entidade de serviço **Can use** nele.
@tab Oracle
```sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
```

O Oracle é lido pelo próprio protocolo, sem instalar um cliente Oracle: `oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1`. O usuário vê as tabelas que pode ler: conceda `READ` em cada tabela a monitorar, o que permite consultá-las sem nunca bloqueá-las ou alterá-las. `SELECT_CATALOG_ROLE` permite ao OneUptime ler o tamanho de cada tabela, e `ALL_TAB_MODIFICATIONS` dá os inserts, updates e deletes de cada tabela desde as últimas estatísticas, e quando ela mudou pela última vez.
@tab Amazon Athena
Um banco de dados do Glue é um banco de dados. Suas tabelas e views, suas colunas e estatísticas, e o último commit de cada tabela Iceberg vêm da API do Glue Data Catalog, que não lê dados e não custa nada. As verificações são executadas como consultas do Athena no workgroup que você indicar. Conecte-se com as chaves de um usuário ou função do IAM que possa chamar `glue:GetDatabase` e `glue:GetTables` e, para as verificações, executar consultas do Athena no workgroup com acesso de leitura aos dados das tabelas:

```json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
```
@tab MongoDB
```javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
```

O MongoDB é lido pelo próprio driver: `mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/`, ou `mongodb://` com os hosts de um replica set. Um banco de dados no caminho é o único monitorado; sem ele, cada banco que o usuário pode ler é monitorado, e `{ role: "read", db: "orders" }` no lugar de `readAnyDatabase` o limita a um. Os documentos, o tamanho e as escritas de cada coleção vêm de `$collStats`, e quando ela recebeu o último documento, do seu `_id` mais recente. Seus campos vêm do esquema JSON do validador ou, senão, dos nomes e tipos dos campos dos seus 100 documentos mais recentes, calculados no banco para que nenhum valor saia dele. Os documentos são lidos em um secundário quando há um, e uma verificação personalizada é um pipeline de agregação, em JSON.
:::

## O que é lido, e com que frequência

| O quê | Quando |
| --- | --- |
| Tabelas, views, colunas, linhas, tamanho e última alteração | A cada cinco minutos |
| Verificações | A cada 15 minutos, hora, 6 horas ou dia, conforme cada uma indica |
| Linhagem e últimas leituras a partir do histórico de consultas | Uma vez por hora, desde a última leitura |

Toda instrução roda em modo somente leitura, com um tempo limite de instrução e de bloqueio onde o mecanismo os tem. A string de conexão nunca é registrada em log e é retirada de toda mensagem de erro. Uma estatística que o login não pode ler fica de fora, com um aviso no banco de dados; a coleta nunca falha por causa disso. Conexões a endereços privados são recusadas no OneUptime Cloud: use uma sonda.

## Réplicas de leitura

Uma réplica de leitura do PostgreSQL ou do SQL Server não move os seus contadores de escrita, então uma tabela nela pode parecer inalterada enquanto muda. O OneUptime percebe que é uma réplica, deixa os contadores de fora, avisa no banco de dados e recorre ao tamanho e às linhas da tabela. Conecte o primário sempre que possível, ou informe uma [coluna de freshness](/docs/data-observability/table-health) para as tabelas que importam.

## Caminhos de armazenamento

Nem tudo de que você depende está em um banco de dados. Uma exportação que chega a um bucket toda noite pode estar tão atrasada, ou incompleta, quanto qualquer tabela. Em **Caminhos de armazenamento**, escolha **Editar caminhos** para um bucket que a sua [conexão de nuvem](/docs/telemetry/cloud-accounts) encontrou, no Amazon S3, no Google Cloud Storage ou em uma conta de armazenamento Azure, e informe os caminhos que importam, um por linha. No Azure, comece cada um com o nome do contêiner.

Cada caminho passa então a aparecer em **Tabelas**: o objeto mais recente dele é quando ele mudou pela última vez, os objetos dele são as linhas e o tamanho deles é o tamanho dele, e valem os mesmos alertas. Só são lidos nomes, tamanhos e horários, nunca um objeto. Um caminho com mais de 10000 objetos não tem contagem, tamanho nem objeto mais recente exatos, e avisa: informe um mais restrito.

## Solução de problemas

- **O banco de dados aparece como Falhou.** A mensagem dele diz por quê: um host que o OneUptime não consegue alcançar, um login recusado, um modo TLS que o servidor não aceita. Para um banco de dados dentro da sua rede, conecte-o por meio de uma sonda.
- **As tabelas não mostram a última alteração.** O login não consegue ler as estatísticas do mecanismo: conceda o que a aba do seu mecanismo lista, ou espere as linhas de uma tabela mudarem duas vezes.
- **Uma tabela está faltando.** Ela está em um esquema que o login não pode usar, ou está excluída no banco de dados. Conceda `USAGE` no esquema dela, ou remova a exclusão.
- **Uma tabela do MySQL não tem colunas.** O login precisa de `REFERENCES`, como acima: ele mostra as colunas de uma tabela sem dar nenhuma leitura das linhas dela.

## Próximos passos

:::cards
- [Saúde das tabelas](/docs/data-observability/table-health): O que cada coleta aprende sobre cada tabela, e os alertas que ela recomenda.
- [Verificações e reconciliações](/docs/data-observability/checks): Regras sobre o que uma tabela contém.
:::
