/*
 * The Data Observability Documentation page in Portuguese: the
 * English text of Pages/DataObservability/Documentation.tsx, translated. Its
 * code, field names, metric names and product names are as the English
 * writes them, and it names what the product draws as the Dashboard's
 * Portuguese words it. Change it with the English, in the same pull
 * request (DataObservabilityDocumentationInLocale).
 */
const DOCUMENTATION: string = `
## O que o Data Observability vigia

Cada tabela e cada visão de cada banco de dados conectado, a cada cinco minutos:

- **Número de linhas e tamanho**, a partir das estatísticas do próprio mecanismo.
- **Quando mudou pela última vez**: o MySQL e o SQL Server informam isso; no PostgreSQL, o OneUptime observa os contadores de inserções, atualizações e exclusões e anota quando eles se movem.
- **Suas colunas**: uma coluna adicionada, removida, renomeada, com outro tipo ou tornada nullable vai para a linha do tempo da tabela e para Alterações de esquema.
- **Seu ritmo habitual**: com que frequência ela costuma mudar. Uma tabela que passa bem do seu ritmo aparece como **Atrasada**.

Só o catálogo do banco de dados é lido e, no MongoDB, os nomes dos campos dos documentos mais recentes de uma collection. Nenhum valor sai do banco de dados.

Um catálogo pode dizer que uma tabela mudou quando só a sua manutenção interna mudou, ou não dizer nada. Nas **Configurações** de uma tabela, indique uma **Coluna de Freshness** como \`updated_at\`, e a última alteração dela passa a ser o valor mais recente dessa coluna. O login precisa poder ler a coluna, e ela deve ser indexada.

Uma réplica de leitura do PostgreSQL ou do SQL Server não move seus contadores de escrita, então o OneUptime os deixa de fora ali e avisa isso no banco de dados.

## A visão geral

A **Visão geral** diz como estão os seus dados agora. Enquanto o projeto não estiver configurado, ela lista as etapas que faltam: alertas em cada banco de dados, proprietários para as tabelas, uma verificação e as execuções dos seus pipelines. **Requer atenção** lista o que precisa de alguém, o mais grave primeiro: um banco de dados que não pôde ser lido, uma execução de pipeline que falhou ou está atrasada, uma verificação que está falhando ou não pôde ser executada, uma reconciliação que divergiu, e um produto de dados ou uma tabela atrasados. Cada item diz a quem pertence e se o seu alerta está aberto, ou que ninguém é avisado porque o seu banco de dados não tem nenhum alerta ativado, e abre a página onde ele é corrigido. **Bancos de dados** mostra como foi a última leitura de cada banco de dados e se os seus alertas estão ativados. O número ao lado de **Visão geral** no menu conta o que precisa de alguém, e **Problemas**, logo abaixo, lista cada um, uma página por vez, filtrados por tipo, banco de dados, proprietário (ou **Sem proprietário**) e se há um alerta aberto. Cada número da **Visão geral** abre a sua lista: **Requer atenção** abre **Problemas**, **Tabelas atrasadas** abre **Tabelas** mostrando só as atrasadas, e **Verificações com falha** abre **Verificações** mostrando só as que falham.

## Conectar um banco de dados

Use um **login somente leitura**. Na visão geral ou em Bancos de dados, escolha **Conectar um banco de dados** e depois uma destas opções:

- **O OneUptime conecta**: cole uma string de conexão. Ela é armazenada criptografada e nunca mais é exibida.
- **Uma sonda na minha rede conecta**: escolha uma das sondas deste projeto e indique a variável de ambiente da sonda que contém a string de conexão (por exemplo \`ORDERS_DB_URL\`). A string de conexão nunca sai da sua rede. Atualize a sonda para a versão mais recente antes.

Um banco de dados já conectado para a Segurança de dados também é vigiado.

**Bancos de dados que você pode conectar**, na mesma página, lista o que o seu projeto já conhece e ninguém conectou: bancos de dados com os quais os seus traces falam, os das suas contas de nuvem e os que o Monitoramento de bancos de dados observa. **Conectar** preenche o formulário com o que se sabe de cada um. Nada é lido até você conectá-lo.

## Caminhos de armazenamento

Uma exportação que chega toda noite a um bucket pode atrasar, ou chegar incompleta, como qualquer tabela. Em **Caminhos de armazenamento**, escolha **Editar caminhos** para um bucket que a sua conexão de nuvem encontrou, no Amazon S3, no Google Cloud Storage ou em uma conta de armazenamento do Azure, e indique os caminhos que importam, um por linha. Cada um aparece em **Tabelas**: o seu objeto mais recente é quando ele mudou pela última vez, os seus objetos são as suas linhas, e os mesmos alertas se aplicam. Só nomes, tamanhos e horários são lidos, nunca um objeto.

### Um login somente leitura, por mecanismo

PostgreSQL:

\`\`\`sql
CREATE ROLE oneuptime_reader LOGIN PASSWORD '...';
GRANT CONNECT ON DATABASE orders TO oneuptime_reader;
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
\`\`\`

MySQL e MariaDB (\`performance_schema\` permite ao OneUptime ver as escritas entre coletas):

\`\`\`sql
CREATE USER 'oneuptime_reader'@'%' IDENTIFIED BY '...';
GRANT SHOW VIEW, REFERENCES ON orders.* TO 'oneuptime_reader'@'%';
GRANT SELECT ON performance_schema.table_io_waits_summary_by_table TO 'oneuptime_reader'@'%';
\`\`\`

SQL Server (\`VIEW DATABASE STATE\` permite ao OneUptime ler tamanhos e últimas atualizações):

\`\`\`sql
CREATE LOGIN oneuptime_reader WITH PASSWORD = '...';
CREATE USER oneuptime_reader FOR LOGIN oneuptime_reader;
GRANT VIEW DEFINITION TO oneuptime_reader;
GRANT VIEW DATABASE STATE TO oneuptime_reader;
\`\`\`

Amazon Redshift: conecte-se com uma string de conexão do PostgreSQL ao endpoint do cluster ou do grupo de trabalho, por exemplo \`postgres://oneuptime_reader:...@cluster.abc123.us-east-1.redshift.amazonaws.com:5439/dev?sslmode=require\`. \`SYSLOG ACCESS UNRESTRICTED\` permite ao OneUptime ler número de linhas e tamanhos (\`svv_table_info\`), as últimas escritas e leituras das consultas de cada usuário (\`stl_insert\`, \`stl_delete\`, \`stl_scan\`, mantidas por alguns dias) e a linhagem das consultas de cada usuário. Sem ele, a mudança nas linhas de uma tabela ainda diz quando ela mudou.

\`\`\`sql
CREATE USER oneuptime_reader PASSWORD '...';
GRANT USAGE ON SCHEMA public TO oneuptime_reader;
ALTER USER oneuptime_reader SYSLOG ACCESS UNRESTRICTED;
\`\`\`

Snowflake: crie um usuário com um par de chaves (sem senha) e conecte-se com um JSON que indique o identificador da conta, o usuário, a chave privada (PKCS#8 não criptografada), o banco de dados e um warehouse para as verificações:

\`\`\`json
{ "account": "myorg-myaccount", "user": "ONEUPTIME_READER", "privateKey": "-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----", "database": "ANALYTICS", "warehouse": "CHECKS_WH", "role": "ONEUPTIME_READER" }
\`\`\`

A coleta lê o catálogo com SHOW, que não precisa de warehouse, então não custa créditos. Só as verificações de dados rodam no warehouse, no agendamento que você der a elas. O Snowflake não informa a última alteração de nenhuma tabela, então uma tabela mudou quando as suas linhas ou os seus bytes se moveram.

\`\`\`sql
CREATE ROLE ONEUPTIME_READER;
GRANT USAGE ON DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON ALL SCHEMAS IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT REFERENCES ON ALL TABLES IN DATABASE ANALYTICS TO ROLE ONEUPTIME_READER;
GRANT USAGE ON WAREHOUSE CHECKS_WH TO ROLE ONEUPTIME_READER;
-- Warehouse spend reads SNOWFLAKE.ACCOUNT_USAGE.
GRANT IMPORTED PRIVILEGES ON DATABASE SNOWFLAKE TO ROLE ONEUPTIME_READER;
-- Checks read rows: SELECT on the tables they check.
CREATE USER ONEUPTIME_READER DEFAULT_ROLE = ONEUPTIME_READER RSA_PUBLIC_KEY = 'MIIBIjANBgkqh...';
GRANT ROLE ONEUPTIME_READER TO USER ONEUPTIME_READER;
\`\`\`

Google BigQuery: cada conjunto de dados que a sua conexão do Google Cloud encontrou já é vigiado, com a conta de serviço dessa conexão, sem nada para conectar. Dê à conta de serviço **BigQuery Metadata Viewer** e **BigQuery Job User** no projeto, e **BigQuery Data Viewer** nas tabelas que as suas verificações leem. Cada coleta lê \`__TABLES__\` do conjunto de dados (linhas, bytes e última alteração, sem custo) e o seu \`INFORMATION_SCHEMA.COLUMNS\` (cobrado pelo mínimo de 10 MB do BigQuery). Adicione **BigQuery Resource Viewer** no projeto para a linhagem dos seus jobs, lida uma vez por hora (veja A linhagem que os bancos de dados informam). Para conectar um conjunto de dados sem uma conexão do Google Cloud, escolha **Google BigQuery** e informe um JSON com uma chave de conta de serviço:

\`\`\`json
{ "projectId": "my-project", "dataset": "analytics", "location": "US", "serviceAccountJson": { "type": "service_account", "...": "..." } }
\`\`\`

ClickHouse: conecte-se pela sua interface HTTP, porta 8443 com TLS (ClickHouse Cloud) ou 8123 sem, por exemplo \`clickhouse://oneuptime_reader:...@abc123.us-east-1.aws.clickhouse.cloud:8443/analytics\`. Indique um banco de dados para vigiar só ele; omita-o para vigiar todos os bancos de dados menos os do próprio servidor. \`system.parts\` permite ao OneUptime ver cada inserção entre coletas (um merge não conta), \`system.part_log\`, onde o servidor o mantém, dá o horário de cada inserção, e \`system.query_log\` dá a última leitura de cada tabela e a linhagem de \`INSERT ... SELECT\`, uma vez por hora. Cada instrução roda com \`readonly\` definido, então nem mesmo um login que poderia escrever consegue.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY '...' SETTINGS readonly = 2;
GRANT SHOW TABLES, SHOW COLUMNS ON *.* TO oneuptime_reader;
GRANT SELECT ON system.parts TO oneuptime_reader;
GRANT SELECT ON system.part_log TO oneuptime_reader;
GRANT SELECT ON system.query_log TO oneuptime_reader;
-- Checks read rows: SELECT on the tables they check.
\`\`\`

Databricks: um catálogo do Unity Catalog é um banco de dados. Os seus esquemas, tabelas, visões e colunas, e o último commit de cada tabela Delta, são lidos pela API REST do Unity Catalog sem SQL warehouse, então a coleta não custa computação. As verificações de dados, e a linhagem, as últimas escritas e as últimas leituras da tabela de sistema \`system.access.table_lineage\` (uma vez por hora), rodam no SQL warehouse que você indicar. Conecte-se com uma entidade de serviço (ou um token de acesso pessoal no lugar de \`clientId\` e \`clientSecret\`: \`"token": "dapi..."\`):

\`\`\`json
{ "host": "adb-1234567890123456.7.azuredatabricks.net", "clientId": "...", "clientSecret": "...", "catalog": "main", "warehouseId": "abc123def456" }
\`\`\`

\`\`\`sql
GRANT USE CATALOG, BROWSE ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE SCHEMA ON CATALOG main TO \`oneuptime-reader\`;
GRANT USE CATALOG ON CATALOG system TO \`oneuptime-reader\`;
GRANT USE SCHEMA, SELECT ON SCHEMA system.access TO \`oneuptime-reader\`;
-- Checks read rows: SELECT on the tables they check. And CAN USE on the SQL warehouse.
\`\`\`

Oracle: conecte-se com \`oracle://oneuptime_reader:...@orders-db.internal:1521/ORCLPDB1\`, ou com um JSON \`{ "user", "password", "connectString" }\`. A leitura usa o protocolo próprio do Oracle, sem cliente Oracle para instalar. O login vê as tabelas que pode ler: conceda \`READ\` em cada tabela a vigiar (ele pode consultá-las, nunca bloqueá-las nem alterá-las). \`SELECT_CATALOG_ROLE\` permite ao OneUptime ler o tamanho de cada tabela; sem ele, só as tabelas do próprio login têm um. \`ALL_TAB_MODIFICATIONS\` informa as inserções, atualizações e exclusões de cada tabela desde as suas últimas estatísticas, e quando ela mudou pela última vez.

\`\`\`sql
CREATE USER oneuptime_reader IDENTIFIED BY "...";
GRANT CREATE SESSION TO oneuptime_reader;
GRANT READ ON sales.orders TO oneuptime_reader;
GRANT SELECT_CATALOG_ROLE TO oneuptime_reader;
\`\`\`

Amazon Athena: um banco de dados do Glue é um banco de dados. As suas tabelas e visões, as colunas e estatísticas delas, e o último commit de cada tabela Iceberg vêm da API do Glue Data Catalog, que não lê dados e não custa nada; as verificações rodam como consultas do Athena no grupo de trabalho que você indicar. Conecte-se com as chaves de um usuário ou de uma função do IAM que possa ler o banco de dados do Glue e executar consultas do Athena:

\`\`\`json
{ "region": "us-east-1", "accessKeyId": "AKIA...", "secretAccessKey": "...", "database": "analytics", "workgroup": "primary", "outputLocation": "s3://acme-athena-results/oneuptime/" }
\`\`\`

Ele precisa de \`glue:GetDatabase\` e \`glue:GetTables\` no banco de dados e nas suas tabelas e, para as verificações, de \`athena:StartQueryExecution\`, \`athena:GetQueryExecution\`, \`athena:GetQueryResults\` e \`athena:StopQueryExecution\` no grupo de trabalho, com acesso de leitura aos dados das tabelas no S3 e de escrita ao local de saída.

MongoDB: conecte-se com a sua string de conexão - \`mongodb+srv://oneuptime_reader:...@cluster0.example.mongodb.net/\`, ou \`mongodb://\` com os hosts de um conjunto de réplicas. Um banco de dados no caminho é o único vigiado; sem ele, todo banco de dados que o login pode ler é vigiado. Os documentos, o tamanho e as escritas de cada collection vêm de \`$collStats\`, e quando ela recebeu um documento pela última vez, do seu \`_id\` mais recente. Os seus campos vêm do esquema JSON do seu validador ou, caso contrário, dos nomes e tipos dos campos dos seus 100 documentos mais recentes, calculados no banco de dados para que nenhum valor saia dele. Os documentos são lidos em um secundário quando há um. A collection de origem de uma visão é linhagem, e uma verificação personalizada é um pipeline de agregação, em JSON.

\`\`\`javascript
use admin
db.createUser({
  user: "oneuptime_reader",
  pwd: "...",
  roles: [{ role: "readAnyDatabase", db: "admin" }]
})
\`\`\`

Para vigiar só um banco de dados, conceda \`{ role: "read", db: "orders" }\` no lugar de \`readAnyDatabase\`.

Microsoft Dataverse: um ambiente é um banco de dados, com as suas tabelas em \`dbo\`, como o seu endpoint SQL as nomeia. O OneUptime entra como um aplicativo: registre um no Microsoft Entra ID com um segredo do cliente e adicione-o ao ambiente como usuário de aplicativo (Power Platform admin center > the environment > Settings > Users + permissions > Application users) com uma função de segurança que possa ler as tabelas. Conecte-se com um JSON, ou com uma string de conexão do Dataverse que indique \`AuthType=ClientSecret\`. O locatário pode ser omitido: o ambiente diz em qual ele está.

\`\`\`json
{ "environmentUrl": "https://contoso.crm.dynamics.com", "tenantId": "...", "clientId": "...", "clientSecret": "..." }
\`\`\`

A cada cinco minutos, a Web API dá a definição de cada tabela, as suas linhas, a partir do instantâneo que o Dataverse tira uma vez por dia (então elas atrasam até um dia), e o seu \`modifiedon\` mais recente, que é quando ela mudou pela última vez. As suas colunas são lidas uma vez por hora. Cada leitura conta para os limites de solicitações do Dataverse do aplicativo, e uma coleta que recebe um pedido para desacelerar deixa o resto para a próxima. Um ambiente tem centenas de tabelas próprias, então só as tabelas de negócio principais (contas, contatos, leads, oportunidades, cotações, pedidos, faturas, produtos, ocorrências, e-mails, telefonemas, compromissos, tarefas e anotações) e as suas próprias tabelas personalizadas são vigiadas. As tabelas dos aplicativos da Microsoft (\`msdyn_\`, \`adx_\` e os outros prefixos \`ms\`) ficam de fora: indique qualquer outra tabela a vigiar, como em \`"tables": ["msdyn_workorder"]\`.

As verificações de dados rodam como SQL somente leitura no endpoint TDS do ambiente, na porta 1433 ou 5558. Ele está ativado, a menos que um administrador o tenha desativado; onde o controle de acesso por usuário está ativado para ele, a função do aplicativo precisa do privilégio **Allow user to access TDS endpoint**. O seu SQL não tem expressões regulares, nem \`WITH\`, nem amostragem.

## As métricas que cada tabela grava

Cada coleta grava estas métricas para cada tabela, para que você possa colocá-las em gráficos, em painéis e criar alertas sobre elas como qualquer outra métrica:

| Métrica | O que é |
| --- | --- |
| \`oneuptime.data.table.row_count\` | Linhas na tabela |
| \`oneuptime.data.table.size\` | Bytes que a tabela e os seus índices ocupam |
| \`oneuptime.data.table.seconds_since_change\` | Segundos desde que uma linha foi inserida, atualizada ou excluída pela última vez |
| \`oneuptime.data.table.overdue_seconds\` | Segundos que a tabela passou do horário em que costuma mudar; 0 enquanto está em dia. Gravada assim que o seu ritmo é aprendido |
| \`oneuptime.data.table.row_count_change_percent\` | Quanto o número de linhas mudou desde a coleta anterior, em porcentagem (-50 é metade das linhas perdidas). Tabelas com menos de 1.000 linhas ficam de fora |
| \`oneuptime.data.table.schema_changes\` | Colunas alteradas desde a coleta anterior |
| \`oneuptime.data.table.breaking_schema_changes\` | Colunas removidas, renomeadas ou com outro tipo desde a coleta anterior |

Cada linha leva \`oneuptime.data.store.id\`, \`oneuptime.data.store.name\`, \`oneuptime.data.table.id\`, \`oneuptime.data.table.schema\`, \`oneuptime.data.table.name\` e \`oneuptime.data.table.key\` (\`schema.table\`). Um monitor de métricas agrupado por \`oneuptime.data.table.key\` alerta uma vez por tabela, e os seus filtros **Anomalamente alto** e **Anomalamente baixo** comparam cada tabela com o seu próprio valor habitual para aquela hora da semana, então nenhum limite precisa ser definido.

## Alertas

Um banco de dados que você conecta abre nos seus **Alertas recomendados**; depois, escolha-os para ele em **Bancos de dados**. Cada recomendação é um monitor de métricas para o banco de dados inteiro que alerta uma vez por tabela, então uma tabela criada depois também é vigiada:

| Alerta | Dispara quando |
| --- | --- |
| **A tabela está atrasada** | Uma tabela fica além do horário em que costuma mudar por quinze minutos - a mesma regra da etiqueta **Atrasada** |
| **O número de linhas caiu muito** | Uma tabela perde metade das suas linhas ou mais entre duas coletas |
| **Número de linhas incomumente baixo** | Uma tabela tem bem menos linhas do que o habitual para aquela hora da semana (aprende ao longo de duas semanas) |
| **Esquema alterado** | Colunas de uma tabela são removidas, renomeadas ou mudam de tipo. Uma coluna adicionada não quebra nada e fica na linha do tempo |
| **O estado das tabelas parou de chegar** | Nenhuma tabela do banco de dados foi lida por quinze minutos |

Escolha gravidades, políticas de plantão, proprietários e rótulos ao criá-los. A partir daí são monitores comuns: edite-os, silencie-os ou coloque-os em uma página de status como qualquer outro.

Um backfill ou uma migração não deveria acionar ninguém. Indique o banco de dados em **Data Observability Bancos de dados** em um evento de manutenção, ou inclua nele o seu servidor de banco de dados, e os seus alertas de dados ficam em silêncio enquanto o evento durar.

## Proprietários e rótulos

A aba **Proprietários** de uma tabela indica as pessoas e as equipes a quem ela pertence, e os alertas da tabela vão para elas; sem nenhuma, para os proprietários do seu banco de dados. As **Regras de proprietário** e as **Regras de Rótulos** se aplicam a cada tabela assim que ela aparece pela primeira vez, pelos seus rótulos ou por uma expressão regular sobre o seu nome, o seu esquema ou o seu banco de dados. Uma permissão limitada a \`Owned\` alcança só as tabelas que o seu titular ou as equipes dele possuem, com as suas verificações, a sua atividade e os problemas relatados. Ser proprietário de um banco de dados não torna alguém proprietário das suas tabelas: use uma regra de proprietário para dar um banco de dados inteiro a uma equipe.

## Quando um alerta abre

O alerta de uma tabela tem um cartão **Dados** que diz por que ele provavelmente aconteceu, em ordem: um alerta a montante, uma execução com falha, um deploy de um serviço que escreve nela, as suas escritas com falha, uma coluna que mudou, o banco de dados ou o servidor em que ela roda. Abaixo está o que depende dela: tabelas, painéis, serviços e as pessoas a quem pertencem.

Diga o que achou: **Útil**, **Esperado** (um evento planejado: nada muda) ou **Não é um problema** (a tabela ganha mais folga, para que a mesma coisa fique em silêncio da próxima vez). Se uma pessoa encontrar um problema primeiro, **Relatar um problema** na tabela o registra. A **Visão geral** mostra o balanço: alertas úteis por semana, quantos não eram ruído, com que frequência um problema foi detectado antes que alguém o relatasse, com que rapidez, e com que frequência a causa provável era a real.


## Produtos de dados

Quem usa os dados (analistas, finanças, executivos, agentes de IA) pensa no que usa: "as tabelas do painel de receita", não em bancos de dados. Um produto de dados nomeia essas tabelas, com o seu proprietário, os seus consumidores e o seu SLA de atualização. Crie um em **Produtos de dados**. O seu SLA é um destes, ou os dois:
- **Atualizado até um horário do dia (UTC):** os dados de cada dia chegam naquele dia, até esse horário. A partir desse horário, cada tabela precisa ter mudado naquele dia; até lá, vale a carga de ontem. Uma carga que sempre chega meia hora atrasada fica atrasada por essa meia hora todo dia.
- **Uma idade máxima:** a última alteração de nenhuma tabela pode ser mais antiga do que isso.

A cada cinco minutos, as tabelas de cada produto são comparadas com o seu SLA. O produto fica **Atrasada** quando qualquer tabela está, e os seus dados são da última alteração mais antiga entre elas. Ele grava \`oneuptime.data.product.late_tables\` e \`oneuptime.data.product.data_age\`, para que você possa comparar a atualização de todos os produtos lado a lado.

Salvar um produto também cria, em seu nome e com as suas permissões:
- **Um monitor**, que é o produto em uma página de status. Ele fica degradado enquanto uma tabela está atrasada, e abre um incidente e um alerta no nível menos grave do seu projeto, que se resolvem sozinhos. Adicione-o a uma página de status, privada ou pública, como recurso: os consumidores que assinam ficam sabendo quando o produto está atrasado e quando volta a estar em dia.
- **Um SLO** sobre esse monitor: a parcela do tempo em que os dados estão em dia, em relação à meta do SLA do produto em 30 dias, com os alertas de burn rate rápido e lento com que todo SLO começa.

Excluir o produto exclui os dois. Cada produto também tem um **selo** que diz de quando são os seus dados, verde enquanto está em dia e âmbar com "late" quando não está. Incorpore-o em um painel de BI, uma página de wiki ou um README a partir da visão geral do produto. O seu link não exige login, então trate-o como um link compartilhado; **Redefinir link do selo** cria um novo e desativa o antigo.

## Verificações dos valores de uma tabela

O estado de uma tabela diz se ela muda. Uma **verificação** diz se o que ela contém está certo. Adicione uma na aba **Verificações** de uma tabela:

| Verificação | O que lê |
| --- | --- |
| **Porcentagem de nulos** | Porcentagem das linhas cuja coluna está vazia |
| **Porcentagem de duplicados** | Porcentagem dos valores que repetem o de outra linha |
| **Contagem de valores distintos** | Quantos valores diferentes a coluna contém |
| **Mínimo**, **Máximo**, **Média**, **Soma** | De uma coluna numérica (a soma de nenhuma linha é 0) |
| **Porcentagem de valores inválidos** | Porcentagem dos valores fora de uma lista que você informa |
| **Porcentagem de formato incorreto** | Porcentagem dos valores que não estão em um formato que você escolhe, como E-mail, UUID ou Código do país, ou que não correspondem a uma expressão regular sua (todos os mecanismos menos o SQL Server) |
| **Contagem de linhas órfãs** | Linhas cujo valor não tem correspondência na coluna de outra tabela |
| **Número de linhas** | Linhas na tabela, mais útil com **Segmentar por** |
| **SQL personalizado** | O número que um SELECT somente leitura seu retorna |

As **Verificações sugeridas**, na mesma aba, oferecem as verificações que as colunas de uma tabela pedem, só pelos seus nomes e tipos:
- Um id é único.
- Um \`customer_id\` tem uma linha correspondente em \`customers\`.
- Um e-mail parece um e-mail, e um valor monetário não é negativo.
- Um status mantém os seus valores habituais.
- Uma tabela dividida por locatário é contada por locatário.

Adicione uma, adicione todas ou descarte uma de vez.

**Segmentar por** executa uma verificação uma vez por valor de uma coluna, como um locatário ou uma região: uma série e um alerta para cada um, para os 100 maiores segmentos. Um número de linhas segmentado alerta quando um locatário para de enviar dados.

As verificações rodam com a coleta do banco de dados, pelo OneUptime ou pela sua sonda, a cada 15 minutos, a cada hora, a cada 6 horas ou todo dia. Cada uma roda como uma única instrução de agregação em uma transação somente leitura com um tempo limite de instrução: só o número sai do banco de dados, a menos que um projeto escolha guardar uma amostra mascarada de linhas com falha. O valor é gravado como \`oneuptime.data.check.value\`, com \`oneuptime.data.check.id\`, \`oneuptime.data.check.name\` e \`oneuptime.data.check.segment\`.

Defina **Gerar alerta quando** para alertar sobre uma verificação:
- **Incomumente alto** ou **Incomumente baixo** compara cada valor com a sua própria linha de base aprendida para aquela hora da semana.
- **Acima de** ou **Abaixo de** o compara com um limite.

Salvar a verificação cria um monitor de métricas para ela, em seu nome e com as suas permissões. Limpar a condição remove o monitor.

**Linhas com falha** conta as linhas que um SELECT somente leitura seu retorna: as linhas que não deveriam existir. 0 é saudável.

Três coisas mantêm o custo de uma verificação sob controle. **Porcentagem da amostra** lê uma parte das linhas, para uma verificação que lê uma taxa. **Máximo que uma verificação pode ler (GB)**, em **Configurações**, interrompe uma verificação no BigQuery ou no Athena antes que ela leia mais do que isso. **Esperar quando um banco de dados está ocupado**, também ali, deixa as verificações pendentes para a próxima coleta quando um banco de dados PostgreSQL, MySQL ou SQL Server parece ocupado.

**Guardar linhas com falha**, em **Configurações**, guarda até 20 linhas com falha de uma verificação, com as colunas sensíveis mascaradas antes de saírem do banco de dados. Fica desativado até você ativá-lo. As linhas são armazenadas no OneUptime, nos servidores do OneUptime no OneUptime Cloud e nos seus em uma instalação auto-hospedada, e desativá-lo as exclui.

Mantenha as verificações em um arquivo no seu repositório e aplique-as pela CI com \`oneuptime data-checks apply checks.yaml\`. Execute-o com \`--dry-run\` em um pull request. Um erro em qualquer parte do arquivo faz com que nada seja aplicado. Veja a documentação para o formato do arquivo.


## Reconciliações

Cópias divergem: o warehouse tem menos pedidos do que o banco de dados do aplicativo, ou uma migração perdeu linhas. Uma reconciliação compara uma medida de duas tabelas, em um banco de dados ou em dois:
- **Número de linhas**
- **Soma** de uma coluna
- **Contagem de valores distintos** de uma coluna
- **SQL personalizado**: uma consulta somente leitura que retorna um número, chamado \`value\`.

Ela tem uma tolerância, um valor **Absoluta** ou um **Percentual** do valor da origem. Crie uma em **Reconciliações**.

Cada lado é lido por uma verificação de dados própria, que a reconciliação cria e mantém, com a coleta do seu banco de dados: pelo OneUptime ou pela sonda do banco de dados. Por isso, uma reconciliação pode comparar uma tabela do PostgreSQL na sua rede com a cópia dela no Snowflake ou no BigQuery. As suas verificações aparecem na aba Verificações de cada tabela e só são alteradas pela reconciliação.

Os dois valores são comparados assim que os dois foram lidos com menos de 15 minutos de diferença entre si, e então os dois lados são agendados para serem lidos juntos de novo. Uma reconciliação grava:
- \`oneuptime.data.reconciliation.drifted\`: 1 quando os dois divergiram além da tolerância, 0 quando concordam. O seu monitor lê isso e alerta quando eles divergem.
- \`oneuptime.data.reconciliation.difference\`: o valor do destino menos o da origem.
- \`oneuptime.data.reconciliation.difference_percent\`: a diferença como porcentagem do valor da origem.

Um lado cuja verificação falha diz por quê. Uma cópia carregada em um agendamento fica atrás da sua origem: compare uma medida em que os dois já se estabilizaram, como as linhas com mais de uma hora, com SQL personalizado, ou considere o atraso na tolerância.

## Pipelines e linhagem, a partir do OpenLineage

Airflow, Dagster, Spark, dbt e Flink descrevem cada execução de um job com eventos do [OpenLineage](https://openlineage.io). Envie-os ao OneUptime, sem alterações, com uma chave de ingestão de telemetria (Configurações do projeto > Telemetria e APM > Chaves de ingestão):

- **URL:** \`https://oneuptime.com/telemetry/openlineage\` (em um OneUptime auto-hospedado, o seu próprio endereço)
- **Endpoint:** \`api/v1/lineage\`, o padrão do OpenLineage
- **Chave de API:** a chave de ingestão. Ela é enviada como \`Authorization: Bearer\`, ou defina \`x-oneuptime-token\`.

Para o provedor OpenLineage do Airflow:

\`\`\`bash
AIRFLOW__OPENLINEAGE__TRANSPORT='{"type": "http", "url": "https://oneuptime.com/telemetry/openlineage", "endpoint": "api/v1/lineage", "auth": {"type": "api_key", "apiKey": "YOUR_INGESTION_KEY"}}'
\`\`\`

Para qualquer cliente OpenLineage, defina \`OPENLINEAGE_URL\` e \`OPENLINEAGE_API_KEY\`.

Cada job aparece em **Pipelines**, com a sua execução mais recente: quando começou e terminou, quanto tempo levou e o erro de uma execução com falha. Uma execução que lê e escreve tabelas que o OneUptime vigia vira **linhagem**: a aba **Linhagem** de uma tabela mostra as tabelas a partir das quais ela é construída, os pipelines que escrevem nela com a sua execução mais recente, e as tabelas construídas a partir dela.

Os conjuntos de dados são associados a tabelas pela especificação de nomes do OpenLineage: \`postgres://host:5432\` com \`database.schema.table\`, \`mysql://host:3306\` com \`database.table\`, \`sqlserver://host:1433\` e \`redshift://cluster:5439\` com \`database.schema.table\`, \`snowflake://account\` com \`database.schema.table\`, \`bigquery\` com \`project.dataset.table\`, \`clickhouse://host:8443\` com \`database.table\`, e \`databricks://workspace-host\` com \`catalog.schema.table\`.

Cada pipeline aprende com as suas próprias execuções quanto tempo uma execução costuma levar (a mediana das suas últimas 20 execuções concluídas) e quanto tempo passa entre execuções no seu agendamento (o maior intervalo entre os seus últimos 50 inícios que não seja um caso isolado). Os dois são conhecidos depois de cinco execuções, e servem tanto para um job que roda a cada cinco minutos quanto para um que roda de madrugada. Quando o seu agendador envia a faceta \`nominalTime\` do OpenLineage, como o Airflow faz, o horário agendado de uma execução vale como o seu início, então um backfill continua sendo lido como o agendamento.

A página de um pipeline recomenda três monitores, cada um criado com um clique:
- **Execução do pipeline com falha**: uma execução falhou ou foi abortada.
- **Execução do pipeline incomumente longa**: uma execução levou o dobro do seu tempo habitual, ou mais. Isso é verificado a cada cinco minutos enquanto a execução está em andamento, então uma execução travada é vista antes de terminar.
- **O pipeline está atrasado**: nenhuma execução começou por mais tempo do que o agendamento permite, com um quarto do intervalo e pelo menos quinze minutos de folga.

Eles leem estas métricas, cada uma marcada com \`oneuptime.data.pipeline.id\` e \`oneuptime.data.pipeline.name\`:
- \`oneuptime.data.pipeline.run_failed\`: 1 ou 0, ao fim de cada execução.
- \`oneuptime.data.pipeline.run_duration\`: segundos, ao fim de cada execução.
- \`oneuptime.data.pipeline.run_duration_ratio\`: o tempo da execução dividido pelo da execução habitual (contado como pelo menos um minuto), ao fim de cada execução e a cada cinco minutos enquanto ela roda.
- \`oneuptime.data.pipeline.overdue_seconds\`: quanto a próxima execução passou do seu agendamento, a cada cinco minutos; 0 enquanto está em dia.

A página de um pipeline desenha a sua **Linhagem**, o primeiro lugar para olhar quando uma execução falha ou atrasa: à esquerda as tabelas que ele lê, à direita as tabelas que ele escreve, e como cada uma está agora. Escolha mais etapas para ver a partir de que essas tabelas são construídas e o que é construído a partir delas; uma contagem de tabelas não desenhadas, no cartão do pipeline ou de uma tabela, desenha mais delas no lugar. A mesma linhagem está em \`POST /api/data-observability/pipelines/lineage\`, para as suas próprias ferramentas. Escolha uma das colunas que ele grava para segui-la através do pipeline: para cima até a coluna de cada tabela lida a partir da qual ela foi construída, e para baixo até cada tabela em que ele a grava. Para suas próprias ferramentas, envie \`"withColumns": true\` para as colunas que as execuções dele moveram.



## Sincronizações do Fivetran e do Airbyte

O Fivetran e o Airbyte carregam as suas tabelas brutas e não enviam eventos do OpenLineage, mas os seus webhooks dizem quando cada sincronização começa e termina. Cada conector do Fivetran e cada conexão do Airbyte vira um pipeline em **Pipelines**, e cada sincronização uma execução, com o mesmo histórico de execuções, a mesma duração e o mesmo agendamento aprendidos, e os mesmos alertas de qualquer pipeline: uma execução com falha, uma incomumente longa e uma atrasada. **Pipelines > Conectar Fivetran ou Airbyte** preenche as URLs abaixo com uma das suas chaves de ingestão.

- **Fivetran:** crie um webhook com a API REST do Fivetran, para a sua conta ou um grupo de destino, com os eventos \`sync_start\` e \`sync_end\`. A sua URL é \`https://oneuptime.com/telemetry/fivetran/v1/webhook/<ingestion key ID>\`, e o seu segredo é essa chave de ingestão. O Fivetran assina cada entrega com o segredo, então a própria chave nunca viaja na URL, e uma entrega que não está assinada com ela é recusada.
- **Airbyte:** nas configurações de notificação do seu espaço de trabalho, defina o webhook como \`https://oneuptime.com/telemetry/airbyte/v1/webhook/<ingestion key>\` e ative-o para sincronizações com falha e sincronizações bem-sucedidas. O Airbyte não assina nada, então a sua URL leva a chave: dê ao Airbyte uma chave só dele.

Um pipeline recebe o nome que a ferramenta dá ao conector ou à conexão, em \`fivetran://<destination group>\` ou \`airbyte://<workspace>\`. A execução de uma sincronização com falha mostra o erro da ferramenta. Uma sincronização do Fivetran reagendada pelo limite de taxa de uma API termina como **Reagendada**: não é uma falha, então não aciona ninguém, e o seu tempo não ensina nenhuma duração.

Um conector do Fivetran carrega o esquema do seu destino que leva o nome dele. Quando exatamente um banco de dados vigiado tem esse esquema, as suas tabelas registram o conector como quem escreve nelas: uma tabela que fica desatualizada aponta para a sincronização que deveria tê-la carregado, e o alerta de uma sincronização com falha é a causa dos alertas das tabelas (veja Um problema por causa). O Airbyte não nomeia tabelas.

## Painéis em ferramentas de BI

O impacto real de dados ruins é o painel que alguém abre. Em **Painéis de BI**, adicione as suas ferramentas de BI com credenciais que possam ler os seus painéis:

| Ferramenta | Credenciais (JSON) |
| --- | --- |
| **Metabase** | \`{ "apiKey": "mb_..." }\` (ou o \`username\` e a \`password\` de um usuário) |
| **Superset** | \`{ "username": "...", "password": "..." }\` |
| **Tableau** | \`{ "tokenName": "...", "tokenSecret": "...", "site": "acme" }\`, um token de acesso pessoal |
| **Looker** | \`{ "clientId": "...", "clientSecret": "..." }\`, um cliente de API |
| **Power BI** | \`{ "tenantId": "...", "clientId": "...", "clientSecret": "..." }\`, uma entidade de serviço autorizada a usar as APIs de administração do Power BI |
| **Hightouch** | \`{ "apiKey": "..." }\`: cada sincronização é lida como mais uma coisa que depende de uma tabela |
| **Census** | \`{ "apiKey": "...", "region": "us" }\`: cada sincronização é lida como mais uma coisa que depende de uma tabela |

A cada hora, e quando uma ferramenta é adicionada ou você escolhe **Ler agora**, o OneUptime lê cada painel e as tabelas por trás dele: a tabela de um cartão e o SQL de uma pergunta nativa (Metabase), a tabela de um conjunto de dados ou o SQL de um conjunto de dados virtual (Superset), as tabelas a montante da Metadata API (Tableau), o explore de cada bloco (Looker) e o conjunto de dados de cada relatório (Power BI, a partir de uma varredura do espaço de trabalho). Cada tabela é associada a uma tabela vigiada pelo seu banco de dados, esquema e nome; um nome que ainda serve para duas tabelas vigiadas fica sem associação. A aba **Linhagem** de uma tabela, o cartão **Dados** dos seus alertas e a Revisão de produção listam os painéis construídos sobre ela, e sobre as tabelas construídas a partir dela. Só nomes e links são lidos, nunca os dados de um painel.

Uma ferramenta do Power BI também pode alertar sobre atualizações com falha dos seus conjuntos de dados. Com **Alertar sobre atualizações com falha** ativado, como fica para uma ferramenta adicionada agora, o OneUptime mantém um monitor para a ferramenta que abre um alerta para cada conjunto de dados cuja última atualização falhou ou foi cancelada, nomeado no título do alerta, e o resolve assim que uma atualização posterior termina. Ele lê \`oneuptime.data.bi.refresh_failed\`, marcada com \`oneuptime.data.bi.dataset.name\` e \`oneuptime.data.bi.workspace.name\`: a cada cinco minutos, cada conjunto de dados que a leitura de hora em hora encontrou com falha grava 1, e 0 durante a hora seguinte a uma atualização posterior concluída. Uma atualização ainda em andamento não muda nada, então uma falha é um alerta, não importa quantas leituras de hora em hora a vejam.

## Jobs nos seus traces

Um CronJob do Kubernetes, ou uma função com timer, não precisa de nada instalado para aparecer como um pipeline: os spans com \`k8s.cronjob.name\` ou \`k8s.job.name\`, ou \`faas.name\` com um \`faas.trigger\` de \`timer\` ou \`datasource\`, viram um, com as suas execuções e as tabelas que as suas chamadas ao banco de dados tocaram. Cada execução leva ao seu trace e aos seus logs, e um CronJob que para de rodar é visto como atrasado.

## A linhagem que os bancos de dados informam

A linhagem não precisa de um pipeline que envie OpenLineage. Cada banco de dados informa uma parte dela por conta própria, e o OneUptime a lê com a coleta do banco de dados:
- **Visões:** uma visão é construída a partir das tabelas sobre as quais é definida, no PostgreSQL, Redshift, MySQL 8 e SQL Server. Quando uma visão é redefinida ou removida, a sua linhagem antiga vai junto.
- **Histórico de consultas:** uma consulta que leu uma tabela e escreveu outra, como uma consulta agendada, um modelo do dbt ou um MERGE, também é linhagem. Ela vem dos jobs do BigQuery (a visão \`INFORMATION_SCHEMA.JOBS\` do projeto e do local do conjunto de dados, que precisa de **BigQuery Resource Viewer**) e do log de consultas do Redshift (\`stl_insert\` e \`stl_scan\`, que precisam de \`SYSLOG ACCESS UNRESTRICTED\`). Só os jobs executados no próprio projeto do conjunto de dados estão na sua visão de jobs.

A linhagem é lida uma vez por hora, desde a última leitura, e uma semana para trás na primeira coleta de um banco de dados, então ela está lá desde o início. Uma leitura do BigQuery é cobrada pelas horas de jobs que lê, quase sempre pelo mínimo de 10 MB do BigQuery.

Cada aresta na aba **Linhagem** de uma tabela diz onde foi vista: na execução de um pipeline, no histórico de consultas (com um login cujas consultas moveram os dados) ou na definição de uma visão. A linhagem de todas as fontes conta para **Um problema por causa**.

No topo da aba **Linhagem** de uma tabela, um diagrama desenha a sua linhagem algumas etapas em cada direção (três, ou escolha 1, 2 ou 5): à esquerda aquilo a partir do qual ela é construída, à direita as tabelas e os painéis construídos a partir dela, e os pipelines que carregam dados de fora onde eles entram. Cada cartão diz como está agora - atrasado, um alerta aberto, uma execução com falha - e uma seta fica vermelha quando a execução mais recente do seu pipeline falhou, então dá para seguir uma tabela atrasada até a execução que a quebrou. Abra qualquer tabela para centralizar o diagrama nela. Um cartão desenha no máximo dez tabelas em cada direção e conta o resto, como **+14**: selecione a contagem para desenhar as próximas onde estão, e **Redefinir diagrama** para voltar. Onde as fontes nomeiam colunas, escolha uma das colunas da tabela em **Seguir uma coluna** para destacar de onde ela vem e para onde vai, mesmo onde é renomeada no caminho. A mesma linhagem está em \`POST /api/data-observability/tables/lineage\`, para as suas próprias ferramentas: envie \`"withColumns": true\` para as colunas de cada seta, e peça a \`POST /api/data-observability/lineage/expand\` as próximas tabelas de um cartão. A linhagem mostra só as tabelas e os pipelines que sua função pode ler: o que você não pode ler nunca é desenhado, nomeado em uma seta nem contado.

## dbt

Depois de \`dbt build\` (ou run, test, seed ou snapshot), envie os artefatos do projeto com a CLI e uma chave de ingestão de telemetria. Ela lê \`target/manifest.json\` e \`target/run_results.json\` e envia só o que o Data Observability lê deles:

\`\`\`bash
npm install -g @oneuptime/cli
export ONEUPTIME_URL=https://oneuptime.com
export ONEUPTIME_TELEMETRY_INGESTION_KEY=<ingestion key>
dbt build
oneuptime dbt upload
\`\`\`

Na CI, execute \`oneuptime dbt upload\` como a etapa depois do build, mesmo quando o build falha, para que os testes com falha sejam registrados. Para um job do dbt Cloud, baixe os seus artefatos com a API do dbt Cloud e depois envie-os com \`--manifest\` e \`--run-results\`. Ou envie-os você mesmo: \`POST /telemetry/dbt/v1/artifacts\` com \`{ "manifest": ..., "run_results": ... }\` e a chave em \`x-oneuptime-token\`.

O que cada envio faz:
- **Tabelas:** cada modelo, seed, snapshot e fonte que é uma tabela vigiada pelo OneUptime ganha um cartão **dbt** na sua visão geral: o nó, a sua materialização, o proprietário, as tags e o último build. A sua descrição do dbt preenche a descrição da tabela quando ela está vazia. Uma tabela é associada pelo seu banco de dados, esquema e nome, para PostgreSQL, MySQL, SQL Server, Redshift, Snowflake, BigQuery, ClickHouse e Databricks. O dbt não conhece o host, então, quando dois bancos de dados vigiados têm o mesmo nome, as suas tabelas ficam sem associação, a menos que só um deles contenha a tabela.
- **Linhagem:** aquilo a partir do qual cada modelo é construído vira linhagem na aba **Linhagem** da tabela, por meio do pipeline do projeto.
- **Testes:** cada teste de uma tabela vigiada aparece na sua aba **Verificações**, com o seu último resultado e as linhas que encontrou com falha. Clique em **Alertar em falhas** para que um teste com falha abra um alerta.
- **Builds:** cada build é uma execução do pipeline do projeto em **Pipelines** (namespace \`dbt\`). Um build com um erro ou um teste com falha é uma execução com falha, então os alertas de pipeline também funcionam com os builds do dbt: com falha, incomumente longo e atrasado.

## Tabelas não utilizadas

Cada mecanismo conta as leituras de cada tabela nas suas próprias estatísticas:
- PostgreSQL: os seus scans.
- MySQL: as leituras do performance_schema.
- SQL Server: os seus seeks, scans e lookups, com o horário do último.

Cada coleta compara o contador com o último guardado, então a **Última leitura** de uma tabela é conhecida com precisão de uma hora, e também desde quando ela não teve nenhuma. Um contador em 0 na primeira coleta de uma tabela significa que ela não foi lida desde que as estatísticas do mecanismo começaram, então uma tabela não utilizada aparece como não utilizada desde o início, não depois de meses de vigilância. Uma leitura vista nos spans de banco de dados de um serviço também conta.

**Tabelas não utilizadas** lista as tabelas que ninguém leu em 90 dias, as maiores primeiro, com quando cada uma foi escrita pela última vez: uma tabela ainda escrita, mas nunca lida, custa as suas escritas e o seu armazenamento. A visão geral mostra quantas há e o que contêm. As visões não mantêm contadores próprios, então nunca são listadas. Quando o login do banco de dados não consegue ler os contadores, a última leitura de uma tabela não é conhecida.

## Gasto do warehouse

Uma vez por hora, com a coleta de cada warehouse, o OneUptime lê quanto o Snowflake e o BigQuery gastaram no último dia, job por job: os créditos de computação do Snowflake de \`QUERY_ATTRIBUTION_HISTORY\` (com \`IMPORTED PRIVILEGES\` no banco de dados \`SNOWFLAKE\`, executado no warehouse da conexão) e os bytes cobrados do BigQuery a partir da sua visão de jobs (com **BigQuery Resource Viewer**). Um job é uma consulta executada várias e várias vezes - a consulta parametrizada do Snowflake, a consulta do BigQuery sem os seus literais - nomeada pela sua tag de consulta ou rótulo, ou pelo que faz e pela tabela que escreve, e nunca pelo texto da sua consulta.

**Gasto do warehouse** mostra os créditos e os bytes cobrados do dia, por equipe (o \`team\` na tag de consulta ou no rótulo de um job, senão quem o executa), as tabelas cujas escritas custam mais (o gasto de um job dividido entre as tabelas que ele escreve, onde o ACCESS_HISTORY do Snowflake ou a tabela de destino do BigQuery diz quais), os jobs que falharam, e o que vai para jobs que só escrevem tabelas que ninguém leu em 90 dias.

## Um problema por causa

Quando uma tabela fica desatualizada, toda tabela construída a partir dela também fica. Antes que um alerta de dados abra, o OneUptime procura na linhagem um alerta já aberto sobre aquilo a partir do qual a sua tabela ou o seu pipeline é construído: as tabelas a montante, os pipelines que escrevem nelas e os bancos de dados em que elas estão, até cinco etapas acima. Quando encontra um, o novo alerta é consequência desse alerta:
- Ele começa **reconhecido**, para que ninguém seja acionado duas vezes por um mesmo problema. Ele se recupera sozinho assim que os seus dados se recuperam.
- O seu feed diz qual alerta o causou, e o seu cartão **Dados** também.
- Ele entra no episódio da causa, quando a causa está em um.

O cartão **Dados** da causa lista o seu **Impacto a jusante**: cada alerta que ela causou. O cartão de um alerta de tabela também mostra os serviços que escrevem na tabela, com as suas escritas com falha, e os seus deploys e outras alterações no dia anterior ao alerta.

Abaixo do cartão **Dados**, a página de um alerta desenha a sua **Linhagem**: em torno da sua tabela, como a aba **Linhagem** da tabela a desenha, ou em torno do seu pipeline, com o caminho para cima até o alerta que o causou e para baixo até cada alerta que ele causou destacados, a causa marcada como **Causa** e cada alerta causado como **Consequência**. Quando a causa está em um pipeline desenhado sobre uma seta, a seta diz **Causa** abaixo do nome do pipeline. Um alerta de uma verificação em uma coluna, como uma verificação Porcentagem de nulos em \`customer_id\`, abre com essa coluna seguida ao lado desses caminhos, como na aba **Linhagem** da tabela; escolha ali outra das colunas da tabela, ou limpe a escolha para ver só os caminhos. Quem não pode ver o alerta que o causou não recebe nem o cartão **Dados** nem a linhagem, e um alerta causado que essa pessoa não pode ver não é destacado nem contado. A mesma linhagem está em \`POST /api/data-observability/alerts/<alert ID>/lineage\`, com a \`column\` que o alerta de uma verificação de coluna lê e as colunas que cada seta leva. Um alerta causado por ele em um pipeline desenhado em uma seta diz **Consequência** ali da mesma forma, e o seletor de colunas oferece primeiro a coluna da verificação e depois as outras colunas da tabela na ordem dela.


## OneUptime AI

- **Investigações de alertas de dados.** Quando o OneUptime AI investiga um alerta sobre uma tabela, um pipeline ou um banco de dados, ele lê o que está ao lado: a atualização da tabela e os seus alertas abertos, o alerta do qual ele é consequência, as execuções dos pipelines que escrevem nela desde o dia anterior (uma execução com falha com o seu erro), os serviços que escrevem nela com as suas escritas com falha e os seus deploys e outras alterações, e a sua linhagem: as tabelas a partir das quais ela é construída e as tabelas construídas a partir dela, primeiro as que têm um problema, com onde está o alerta do qual ela é consequência e em quais tabelas estão os alertas que ela causou. Para um alerta de uma verificação em uma coluna, ele também segue essa coluna pela linhagem: as colunas a partir das quais ela é construída a montante e as colunas construídas a partir dela a jusante, tabela por tabela. Ele nomeia a execução, o deploy ou a tabela a montante por trás do alerta.
- **Uma verificação a partir de uma frase.** Na aba Verificações de uma tabela, **Escrever uma verificação a partir de uma frase** transforma uma regra como "pedidos nunca têm um total negativo" em uma verificação de SQL personalizado que conta as linhas que a violam, com um alerta assim que houver alguma. Você lê a consulta antes que **Adicionar verificação** a adicione, e ela está sujeita a tudo a que qualquer verificação de SQL personalizado está: uma única instrução somente leitura, executada em uma transação somente leitura.
- **Esta tabela está atualizada?** Pergunte ao OneUptime AI no Pergunte à IA, no Slack ou no Microsoft Teams ("a tabela orders está atualizada?"). Ele responde com a atualização da tabela pelo seu próprio ritmo, quando ela mudou pela última vez, os seus alertas abertos, as execuções mais recentes de quem escreve nela e os produtos de dados de que ela faz parte. Agentes de IA perguntam o mesmo pela ferramenta \`get_data_table_freshness\` do servidor MCP, antes de usarem os dados.
- **A partir de que esta tabela é construída?** Pergunte do mesmo jeito ("o que alimenta a tabela revenue?", "o que quebra se raw.orders parar de carregar?"). Ele segue a linhagem da tabela três etapas em cada direção, ou até cinco quando pedido, e coloca primeiro as tabelas a montante e a jusante que estão atrasadas, foram removidas, têm alertas abertos ou cujo pipeline falhou na última execução, as mais próximas primeiro, com a quantas etapas cada uma está e as tabelas no meio; depois o resto, os pipelines que carregam as suas fontes de fora do que o OneUptime vigia, e os painéis de BI construídos sobre ela. Os alertas abertos são contados, nunca nomeados, e só os que a pessoa que pergunta pode ver. Agentes de IA perguntam o mesmo pela ferramenta \`get_data_table_lineage\` do servidor MCP, antes de alterarem uma tabela. Conta uma única vez cada tabela além do que diz, por mais tabelas citadas que estejam ao lado dela. Aberto na página de uma tabela, Pergunte à IA sabe qual tabela é "esta tabela" e pergunta sobre ela, mesmo quando vários bancos de dados têm uma tabela com esse nome. Como toda visão da linhagem, fala só das tabelas e dos pipelines que a pessoa que pergunta pode ler.

## Serviços que usam cada tabela

A aba **Serviços** de uma tabela lista os serviços vistos escrevendo e lendo nela, com as instruções que cada um executou, as suas chamadas e falhas na última hora, e quando foi visto pela última vez. Isso vem dos spans de banco de dados que os seus serviços já enviam com o OpenTelemetry: um span de cliente com \`db.system.name\`, \`db.namespace\` e \`db.collection.name\` (ou \`db.sql.table\`, ou um span com um nome como \`INSERT orders\`). Nada a mais para instalar. É atualizado a cada 15 minutos.

Cada serviço também mostra os endpoints que fazem as suas chamadas, e é marcado como **App de IA** quando também chama um modelo. **Erros que citam esta tabela** lista as exceções abertas e os logs de erro do último dia dos serviços que escrevem na tabela, quando eles a mencionam pelo nome.

Um span só é ligado a uma tabela quando o seu banco de dados é o que uma coleta leu e, quando dois bancos de dados têm o mesmo nome, só quando o seu \`server.address\` é um dos deles. Quando não tem certeza, ele deixa o span de fora.

Estas métricas são dados operacionais do próprio OneUptime e não são cobradas como telemetria.
`;

export default DOCUMENTATION;
