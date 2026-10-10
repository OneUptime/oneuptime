# Monitor de saúde de banco de dados

O monitor Database Health se conecta ao PostgreSQL, ao MySQL ou ao Microsoft SQL Server em um agendamento e informa os sinais de saúde do próprio servidor — folga de conexões, sessões bloqueadas, atraso de replicação, taxa de acerto do cache, tamanho do banco de dados, wraparound de IDs de transação e mais umas trinta — para que você possa alertar sobre eles do mesmo jeito que alerta quando um site cai.

Você não escreve SQL. A sonda executa um conjunto fixo de consultas de catálogo somente leitura, escolhido conforme o mecanismo, e informa um pequeno conjunto de números com nome.

:::cards
- [Criar um usuário de monitoramento](#criar-um-usuário-de-monitoramento): As permissões de que cada mecanismo precisa. É a etapa que mais importa.
- [Criar o monitor](#criar-um-monitor-database-health): Apontar uma sonda para o banco de dados e escolher o que coletar.
- [Métricas coletadas](#métricas-coletadas): Cada série, com os mecanismos que a informam.
- [Configurar critérios](#configurar-critérios): Alertar sobre conexões, bloqueios, atraso e wraparound.
:::

## Database Health ou SQL Query?

Os dois tipos de monitor de banco de dados respondem a perguntas diferentes e foram feitos para serem usados juntos.

| | Database Health | [SQL Query](/docs/monitor/sql-monitor) |
|---|---|---|
| Pergunta que responde | "O banco de dados em si está saudável?" | "Meus dados são o que eu espero?" |
| Consulta | Embutida, por mecanismo, somente leitura | A sua |
| Informa | Métricas numéricas com nome (veja [Métricas coletadas](#métricas-coletadas)) | Contagem de linhas, valor escalar, primeira linha, tempo de execução |
| Alerta típico | Conexões usadas acima de 90% | Mais de 50 pedidos cancelados nos últimos cinco minutos |
| Permissões necessárias | Leitura de estatísticas/DMVs — veja [Criar um usuário de monitoramento](#criar-um-usuário-de-monitoramento) | `SELECT` nas tabelas que a sua consulta acessa |

Se você quer alertar sobre uma condição de negócio, use o monitor SQL Query. Se você quer saber que o servidor está ficando sem conexões antes mesmo de a condição de negócio ter chance de falhar, use este.

## Bancos de dados compatíveis

| Banco de dados | Porta padrão |
|---|---|
| **PostgreSQL** | `5432` |
| **MySQL** | `3306` |
| **Microsoft SQL Server** | `1433` |

O Azure SQL Database e o Azure SQL Managed Instance se conectam como **Microsoft SQL Server**. Eles exigem outras permissões — veja [Criar um usuário de monitoramento](#criar-um-usuário-de-monitoramento).

Mecanismos compatíveis com PostgreSQL e MySQL que falam o mesmo protocolo de rede costumam funcionar, mas podem expor menos views de estatísticas; nesse caso, as métricas afetadas são informadas como indisponíveis em vez de coletadas. Só os três mecanismos acima são testados oficialmente.

Cada banco de dados que seus aplicativos, clusters e hosts usam — esses três mecanismos e muitos outros — também tem uma página própria com as métricas do mecanismo, os logs e os serviços que o chamam: veja [Bancos de dados](/docs/telemetry/databases). Quando o host e a porta a que um monitor Database Health se conecta são um dos endpoints de um banco de dados, os alertas e incidentes do monitor também aparecem na página desse banco de dados (veja [Alertas em um banco de dados](/docs/telemetry/databases#alerts-on-a-database)).

## Como funciona

A cada verificação, uma sonda:

1. Conecta-se ao banco de dados com as credenciais que você configurar.
2. Executa uma consulta de teste leve. **Esta é a única instrução cuja falha pode deixar o monitor offline.**
3. Executa as consultas de catálogo de cada [grupo de métricas](#grupos-de-métricas) ativado, uma de cada vez, cada uma com um tempo limite de instrução.
4. Informa os números que coletou, mais uma nota para cada grupo que não conseguiu coletar e o motivo.

```mermaid title="Uma verificação, e a única etapa que pode deixar o monitor offline"
flowchart TB
    connect["Conectar ao banco de dados"] --> probe{"Consulta de teste OK?"}
    probe -->|"Não"| offline["Monitor offline"]
    probe -->|"Sim"| groups["Executar cada grupo de métricas"]
    groups --> group{"Grupo coletado?"}
    group -->|"Sim"| metrics["Métricas informadas"]
    group -->|"Não"| issue["Métricas ausentes, problema registrado"]
    metrics --> criteria["Critérios avaliados"]
    issue --> criteria
```

Só agregados numéricos com nome são enviados ao OneUptime. Nenhum texto de consulta, nenhuma linha das suas tabelas e nenhum nome de schema sai da sua rede — as consultas leem as views de estatísticas do próprio mecanismo (`pg_stat_activity`, `performance_schema.global_status`, `sys.dm_exec_sessions` e afins), nunca os seus dados.

Como a verificação roda a partir de uma sonda, o banco de dados só precisa estar acessível para a sonda. Coloque uma [sonda personalizada](/docs/probe/custom-probe) dentro da sua rede e o OneUptime nunca vai precisar de uma rota até o banco de dados.

## Antes de começar

- Uma **sonda** com acesso de rede ao host e à porta do banco de dados. Use uma sonda hospedada pelo OneUptime se o banco de dados for acessível pela internet, ou uma [sonda personalizada](/docs/probe/custom-probe) dentro da sua rede se não for.
- Um **usuário de monitoramento**, criado como descrito na próxima seção, e os dados de conexão dele.

## Criar um usuário de monitoramento

**Esta é a etapa mais importante.** O monitor lê views de estatísticas que logins comuns não podem ver, e um login sem privilégios suficientes nem sempre falha com um erro — no PostgreSQL ele dá uma resposta errada. Crie um login dedicado com exatamente estas permissões e nada mais.

### PostgreSQL

```sql
CREATE USER oneuptime_health WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE mydb TO oneuptime_health;
-- The one grant that matters. Without it, see the note below.
GRANT pg_monitor TO oneuptime_health;
```

`pg_monitor` é uma role embutida (PostgreSQL 10 e posteriores) que dá acesso de leitura às views de estatísticas e de monitoramento. Ela não dá acesso às suas tabelas.

> [!IMPORTANT]
> **Por que `pg_monitor` não é opcional no PostgreSQL.** Sem ela, `pg_stat_activity` não falha — a consulta funciona e retorna só a linha da própria sessão de monitoramento. A contagem de conexões marcaria `1`, as sessões bloqueadas `0` e o atraso de replicação `0`, para sempre, em um servidor que na verdade está pegando fogo. Por isso a sonda verifica, **antes** de executar essas consultas, se o login é membro de `pg_monitor` (ou de `pg_read_all_stats`) ou superusuário. Quando não é nenhum deles, a sonda informa os grupos Connections, Activity e Locks como indisponíveis, junto com o `GRANT` de que você precisa. Não informar nada é a resposta honesta; informar `1` não é.

Em um serviço gerenciado em que `pg_monitor` não está disponível, `pg_read_all_stats` cobre as mesmas views. No Amazon RDS, `GRANT rds_superuser` não é necessário — `GRANT pg_monitor TO oneuptime_health;` funciona como membro de `rds_superuser`.

### MySQL

```sql
CREATE USER 'oneuptime_health'@'%' IDENTIFIED BY 'a-strong-password';
-- INNODB_TRX (open transactions, longest query) and replication status.
GRANT PROCESS, REPLICATION CLIENT ON *.* TO 'oneuptime_health'@'%';
-- Status counters, server variables, and lock waits.
GRANT SELECT ON performance_schema.* TO 'oneuptime_health'@'%';
-- Database size: information_schema.TABLES only shows tables the login can see.
GRANT SELECT ON mydb.* TO 'oneuptime_health'@'%';
FLUSH PRIVILEGES;
```

O `performance_schema` do MySQL precisa estar ativado (`performance_schema = ON`, o padrão desde a 5.6). Quando está desligado, os grupos Connections, Throughput e Locks são informados como indisponíveis, e a solução é reiniciar o servidor, não uma permissão.

### Microsoft SQL Server e Azure SQL Managed Instance

```sql
-- A server-level grant only runs while the current database is master.
USE master;
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';
-- Every DMV the monitor reads. On SQL Server 2022 and later,
-- VIEW SERVER PERFORMANCE STATE alone is also enough.
GRANT VIEW SERVER STATE TO oneuptime_health;

USE mydb;
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
```

Executado a partir de qualquer outro banco de dados, `GRANT VIEW SERVER STATE` falha com Msg 4621, "Permissions at the server scope can only be granted when the current database is master".

> [!WARNING]
> **Acesso de leitura às suas tabelas não basta.** Um login que só consegue ler dados — `db_datareader` ou qualquer outra role de "acesso de leitura" — consegue se conectar e obtém o tamanho do banco de dados, e nada mais. O SQL Server recusa as views que o monitor lê com `The user does not have permission to perform this action.` (Msg 297). A mensagem anterior diz o que foi recusado: Msg 300 `VIEW SERVER STATE` (`VIEW SERVER PERFORMANCE STATE` no 2022) para as views de servidor, incluindo o espaço do log de transações e o espaço livre do tempdb, ou Msg 262 `VIEW DATABASE STATE` (`VIEW DATABASE PERFORMANCE STATE` no 2022) para a view de replicação. O monitor continua online, informa que falta uma permissão aos grupos Connections, Activity, Throughput, Locks, Storage e Replication e mostra ao lado deles o `GRANT` acima. `VIEW SERVER STATE` cobre todos eles.
>
> Duas views não recusam: sem a permissão, `sys.dm_exec_sessions` e `sys.dm_exec_requests` mostram em silêncio só a própria sessão do monitor. O monitor nunca as lê sozinhas — sempre junto com uma view que recusa —, então uma permissão ausente nunca pode ser registrada como "1 conexão".

### Azure SQL Database

O Azure SQL Database não tem permissões em nível de servidor — `GRANT VIEW SERVER STATE` falha lá —, então as mesmas views são abertas por uma permissão em nível de banco de dados. Crie um login em `master`, dê a ele um usuário no banco de dados que você está monitorando e conceda a permissão lá, não em `master`:

```sql
-- Connected to master, as the server admin:
CREATE LOGIN oneuptime_health WITH PASSWORD = 'a-strong-password';

-- Connected to the monitored database:
CREATE USER oneuptime_health FOR LOGIN oneuptime_health;
GRANT VIEW DATABASE STATE TO oneuptime_health;
```

Isso basta em bancos de dados vCore e em bancos de dados DTU a partir de S2. Em **Basic, S0 e S1**, e para qualquer banco de dados em um **pool elástico**, o Azure só deixa o administrador do servidor, o administrador do Microsoft Entra ou os membros da role de servidor `##MS_ServerStateReader##` lerem essas views, digam o que disserem as permissões do banco de dados. Nesses casos, o administrador do servidor também adiciona o login a essa role:

```sql
-- Connected to master, as the server admin:
ALTER SERVER ROLE ##MS_ServerStateReader## ADD MEMBER oneuptime_health;
```

`##MS_ServerStateReader##` funciona em todas as camadas, então também é a alternativa se `VIEW DATABASE STATE` não for suficiente. Uma nova associação a uma role pode levar alguns minutos para valer e só alcança conexões novas; a sonda abre uma conexão nova a cada verificação.

Um usuário de banco de dados independente (`CREATE USER oneuptime_health WITH PASSWORD = '...'` no banco de dados monitorado, sem login) funciona com `VIEW DATABASE STATE` a partir de S2, mas não pode entrar em `##MS_ServerStateReader##`: roles de servidor só aceitam logins. Para mover um usuário independente para a role, exclua-o (`DROP USER oneuptime_health;`) e siga as instruções acima.

A sonda reconhece o Azure SQL Database por `SERVERPROPERTY('EngineEdition')`, e não pela versão — o Azure SQL Database informa `12.0.2000.8` seja qual for a versão que realmente executa, o que se lê como SQL Server 2014. Por isso o **Engine** do monitor mostra `Azure SQL Database 12.0.2000.8`, e uma permissão ausente aparece como a instrução do Azure acima, nunca como `VIEW SERVER STATE`.

- **A replicação não é coletada no Azure SQL Database.** O Azure SQL Database não tem `sys.dm_hadr_database_replica_states`, então lá o grupo Replication é ignorado em vez de ser informado como falho a cada verificação. As views de réplica próprias do Azure (`sys.dm_database_replica_states`, `sys.dm_geo_replication_link_status`) ainda não são lidas.
- **As conexões são por banco de dados.** Com `VIEW DATABASE STATE`, o Azure SQL Database mostra só as sessões do banco de dados monitorado, então Connections conta esse banco de dados, e não o servidor lógico. Monitore cada banco de dados que importa para você.
- **Em um pool elástico, TempDB Free Space é o do pool.** Os bancos de dados de um pool compartilham um único tempdb.

## Criar um monitor Database Health

:::steps
### Começar um novo monitor

Vá para **Monitores** e clique em **Criar monitor**. Em **Tipo de monitor**, clique em **Mais tipos de monitor** e escolha **Database Health** em **Database Monitoring**, ou digite `health` na caixa de pesquisa. Informe um **Nome** e clique em **Próximo**.

### Informar os dados de conexão

Escolha o **Database Type** e preencha o host, a porta, o nome do banco de dados e as credenciais do usuário de monitoramento. Referencie a senha como um [segredo do monitor](#usar-um-segredo-do-monitor-para-a-senha) em vez de digitá-la. Cada campo está descrito em [Configuração](#configuração).

### Escolher o que coletar

Deixe todos os grupos em **Metric Groups** ativados, a menos que você tenha um motivo para desligar algum — veja [Grupos de métricas](#grupos-de-métricas).

### Testar a conexão

Clique em **Testar monitor** para executar uma verificação antes de salvar e veja o que ela coletou.

### Definir os critérios

Revise os critérios com que o monitor começa e adicione os seus — veja [Configurar critérios](#configurar-critérios). Depois clique em **Próximo**.

### Escolher sondas e criar

Selecione as **Sondas** que conseguem alcançar o banco de dados e um **Intervalo de monitoramento**, e clique em **Criar monitor**.
:::

## Configuração

| Campo | O que informar |
|---|---|
| **Database Type** | PostgreSQL, MySQL ou Microsoft SQL Server. Escolher um tipo define a porta padrão e decide quais consultas são executadas. |
| **Host** | O host do banco de dados acessível pela sonda (por exemplo `db.internal`). |
| **Porta** | A porta do banco de dados. |
| **Nome do Banco de Dados** | O banco de dados ao qual se conectar. Métricas de escopo de banco de dados (tamanho, taxa de acerto do cache, uso de arquivos temporários) são informadas para este banco de dados; métricas de escopo de servidor (conexões, tempo de atividade, replicação), para o servidor inteiro — exceto no Azure SQL Database, onde as conexões são contadas só para o banco de dados monitorado. |
| **Use Windows Integrated Authentication** | Só Microsoft SQL Server. Autentica com a identidade do processo da sonda em vez de nome de usuário e senha. Veja [Autenticação integrada do Windows](/docs/monitor/sql-monitor) na página do monitor SQL Query — a configuração é idêntica. |
| **Nome de usuário** | O usuário de monitoramento. Obrigatório, a menos que você use a autenticação integrada do Windows. |
| **Senha** | A senha. Referencie um [segredo do monitor](/docs/monitor/monitor-secrets) com `{{monitorSecrets.name}}` em vez de digitá-la em texto puro (veja [Usar um segredo do monitor](#usar-um-segredo-do-monitor-para-a-senha)). |
| **Use SSL/TLS** | Conectar via TLS. Quando ativado, você pode desligar **Verify server certificate** para um certificado autoassinado. |
| **Metric Groups** | Quais grupos executar: Connections, Atividade, Throughput, Locks and Blocking, Armazenamento, Replication e Manutenção. Todos vêm ativados por padrão; veja [Grupos de métricas](#grupos-de-métricas). Os detalhes do monitor os listam como **Collected Metric Groups**. |

### Mais campos

| Campo | Padrão | Máximo | O que limita |
|---|---|---|---|
| **Connection Timeout (ms)** | `10000` | `30000` | Quanto tempo esperar para estabelecer uma conexão. |
| **Statement Timeout (ms)** | `10000` | `60000` | O teto de cada consulta de catálogo. |

O tempo limite de instrução padrão é deliberadamente mais curto que o do monitor SQL Query: essas consultas respondem em milissegundos em um servidor saudável, então, se `pg_stat_activity` levar dez segundos, o sinal útil é "este servidor está com problemas", não uma espera maior. Um valor acima do máximo é reduzido ao máximo.

## Usar um segredo do monitor para a senha

Para que a senha nunca fique guardada em texto puro no monitor:

:::steps
1. Vá para **Monitores → Configurações → Segredos** e crie um [segredo do monitor](/docs/monitor/monitor-secrets).
2. Dê um nome a ele (por exemplo `dbPassword`) e dê a este monitor acesso a ele.
3. No campo **Senha** do monitor, digite `{{monitorSecrets.dbPassword}}`.
:::

O segredo é resolvido no servidor antes de a configuração ser entregue a uma sonda. Os campos Host, Nome de usuário e Nome do Banco de Dados aceitam a mesma referência. As credenciais nunca são gravadas em logs, feeds do monitor ou modelos de alerta.

## Grupos de métricas

Um grupo é uma unidade que você liga ou desliga, e a unidade para a qual uma permissão ausente é informada. Os grupos existem para que uma permissão ausente custe um grupo, e não o monitor inteiro. As instruções de um grupo rodam uma de cada vez, então um grupo pode ser coletado em parte: ele aparece então tanto em `collectedGroups` quanto em `unavailableGroups`. O caso comum é o grupo Storage do SQL Server para um login sem `VIEW SERVER STATE` — o tamanho do banco de dados é coletado, o espaço do log e o espaço livre do tempdb não.

| Grupo | O que coleta | Precisa de |
|---|---|---|
| Connections | Contagens de conexões, o limite configurado, conexões abortadas, tempo de atividade do servidor | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Activity | Consulta em execução mais longa, transação aberta mais longa, transações abertas | PostgreSQL: `pg_monitor`. MySQL: `PROCESS`. SQL Server: `VIEW SERVER STATE` |
| Throughput | Transações, consultas, taxa de acerto do cache, leituras e gravações em disco, tempo de E/S | PostgreSQL: nada além de `CONNECT`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Locks | Sessões bloqueadas, esperas por lock, deadlocks, esperas por lock de tabela | PostgreSQL: `pg_monitor`. MySQL: `performance_schema`. SQL Server: `VIEW SERVER STATE` |
| Storage | Tamanho do banco de dados, uso de arquivos temporários, espaço do log, espaço livre do tempdb | PostgreSQL: nada além de `CONNECT`. MySQL: `SELECT` no banco de dados. SQL Server: nada para o tamanho do banco de dados; `VIEW SERVER STATE` para o espaço do log e o espaço livre do tempdb |
| Replication | Réplicas conectadas, atraso de replicação em segundos e em bytes, slots inativos, estado de recuperação | PostgreSQL: `pg_monitor`. MySQL: `REPLICATION CLIENT`. SQL Server: `VIEW SERVER STATE`; não coletado no Azure SQL Database |
| Maintenance | Folga até o wraparound de IDs de transação, tuplas mortas, tabelas nunca processadas pelo autovacuum, checkpoints | PostgreSQL: `pg_monitor` |

No Azure SQL Database, leia `VIEW DATABASE STATE` onde esta tabela diz `VIEW SERVER STATE` — ou `##MS_ServerStateReader##` em Basic, S0, S1 e pools elásticos. Veja [Azure SQL Database](#azure-sql-database).

Desligar um grupo é silencioso: sem métricas, sem problema de coleta, sem alerta. É a decisão certa em dois casos:

- **Você não consegue a permissão.** Desligar o grupo impede que o problema de coleta se repita a cada verificação.
- **As consultas são caras demais.** No MySQL, **Armazenamento** é o candidato de sempre: o tamanho do banco de dados vem da soma de `information_schema.TABLES`, o que não é de graça em um schema com dezenas de milhares de tabelas e roda a cada verificação. Desligue-o ou passe esse monitor para um intervalo de cinco minutos.

Desmarcar todos os grupos não é uma forma de não coletar nada — uma lista vazia é normalizada de volta para todos os grupos, então um monitor nunca pode ser salvo em um estado em que não coleta nada sem avisar.

## O que acontece quando uma métrica não pode ser coletada

**Uma permissão ausente nunca deixa o monitor offline.** Esse é o comportamento mais importante deste tipo de monitor, e vale a pena descrevê-lo com precisão.

| O que falha | Status do monitor | O que você vê |
|---|---|---|
| **A conexão**, ou a consulta de teste — credenciais erradas, conexão recusada, falha de TLS, tempo limite de conexão | **Offline** | `Database Is Online` é false, e o incidente e a política de plantão que você associou a ele são disparados. |
| **Um grupo** — uma permissão ausente, um `performance_schema` desativado, um tempo limite de instrução | **Continua online** | As métricas que esse grupo não conseguiu ler ficam **ausentes**, não zeradas. Nenhuma linha é desenhada no gráfico, nenhum limite sobre essas séries pode ser atingido e nenhum incidente pode surgir delas. A verificação registra um problema de coleta que nomeia o grupo, o motivo e — quando existe — o `GRANT` exato a executar; ele aparece no resumo do monitor e é contado em **Metric Groups Failed**. |
| **O mecanismo não consegue produzir a métrica de forma alguma** — o MySQL padrão não tem contador de deadlocks; o SQL Server deixa seu limite de conexões ilimitado por padrão, então uma "porcentagem usada" não faria sentido | **Continua online** | A métrica simplesmente não aparece. **Não** é um problema de coleta, não conta em Metric Groups Failed e não há nada a corrigir. Veja a coluna Engines em [Métricas coletadas](#métricas-coletadas). |

Ausente sempre significa ausente. Um valor que não foi medido nunca é informado como `0`, porque um gráfico de zeros inventados é pior que uma lacuna — uma lacuna você consegue ver.

> [!TIP]
> Para alertar sobre perda de visibilidade, use `Database Collection Error` ou um limite em **Metric Groups Failed**. Faça dos dois alertas, e não incidentes: uma permissão revogada é um ticket, não um chamado de plantão.

### "The user does not have permission to perform this action"

Esta é a mensagem do SQL Server (Msg 297) para um login que consegue se conectar, mas não consegue ler as views de estado do servidor. Ela sempre significa uma permissão ausente, nunca uma falha no banco de dados. O SQL Server a envia em segundo lugar, depois de uma mensagem que nomeia a permissão recusada, e o monitor mostra as duas: por exemplo `VIEW SERVER STATE permission was denied on object 'server', database 'master'. The user does not have permission to perform this action.` Ao lado aparece a instrução que corrige o problema para a plataforma à qual a sonda se conectou:

- **SQL Server ou Azure SQL Managed Instance** — `GRANT VIEW SERVER STATE TO oneuptime_health;`, executado em `master` (o monitor a mostra como `GRANT VIEW SERVER STATE TO [<monitoring_login>]; -- run in master`).
- **Azure SQL Database** — `GRANT VIEW DATABASE STATE TO oneuptime_health;`, executado no banco de dados monitorado; em Basic, S0, S1 e pools elásticos, a associação a `##MS_ServerStateReader##` no lugar dela. Veja [Azure SQL Database](#azure-sql-database).

Enquanto isso, o tamanho do banco de dados continua sendo coletado, porque é a única métrica do grupo Storage que qualquer login consegue ler.

## Métricas coletadas

Quarenta e uma séries em oito categorias. Engines lista os mecanismos que conseguem de fato produzir a série; em qualquer outro mecanismo, ela simplesmente não aparece. Group é o grupo de coleta ao qual a série pertence, que é o que você liga e desliga e o que falha junto.

### Disponibilidade

| Métrica | Série | Group | Engines |
|---|---|---|---|
| **Uptime** (s) | `oneuptime.monitor.database.uptime.seconds` | Connections | PostgreSQL, MySQL, SQL Server |
| **Metric Groups Failed** | `oneuptime.monitor.database.metric.groups.failed` | Connections | PostgreSQL, MySQL, SQL Server |

### Conexões

| Métrica | Série | Group | Engines |
|---|---|---|---|
| **Connections** | `oneuptime.monitor.database.connections.total` | Connections | PostgreSQL, MySQL, SQL Server |
| **Active Connections** | `oneuptime.monitor.database.connections.active` | Connections | PostgreSQL, MySQL, SQL Server |
| **Maximum Connections** | `oneuptime.monitor.database.connections.max` | Connections | PostgreSQL, MySQL |
| **Connections Used** (%) | `oneuptime.monitor.database.connections.used.percent` | Connections | PostgreSQL, MySQL |
| **Idle In Transaction** | `oneuptime.monitor.database.connections.idle.in.transaction` | Connections | PostgreSQL |
| **Aborted Connects** | `oneuptime.monitor.database.connections.aborted.total` | Connections | MySQL |

### Vazão

| Métrica | Série | Group | Engines |
|---|---|---|---|
| **Transactions** | `oneuptime.monitor.database.transactions.total` | Throughput | PostgreSQL, SQL Server |
| **Queries** | `oneuptime.monitor.database.queries.total` | Throughput | MySQL, SQL Server |
| **Slow Queries** | `oneuptime.monitor.database.queries.slow.total` | Throughput | MySQL |
| **Rollback Ratio** (%) | `oneuptime.monitor.database.rollback.percent` | Throughput | PostgreSQL |
| **Longest Running Query** (s) | `oneuptime.monitor.database.query.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Longest Open Transaction** (s) | `oneuptime.monitor.database.transaction.longest.seconds` | Activity | PostgreSQL, MySQL, SQL Server |
| **Open Transactions** | `oneuptime.monitor.database.transaction.open.count` | Activity | MySQL |

### Locks e bloqueios

| Métrica | Série | Group | Engines |
|---|---|---|---|
| **Blocked Sessions** | `oneuptime.monitor.database.sessions.blocked` | Locks | PostgreSQL, MySQL, SQL Server |
| **Lock Waits** | `oneuptime.monitor.database.locks.waiting` | Locks | PostgreSQL, MySQL, SQL Server |
| **Deadlocks** | `oneuptime.monitor.database.deadlocks.total` | Locks | PostgreSQL, SQL Server |
| **Table Lock Waits** | `oneuptime.monitor.database.table.locks.waited.total` | Locks | MySQL |

O MySQL padrão não expõe nenhum tipo de contador de deadlocks, e é por isso que Deadlocks só existe no PostgreSQL e no SQL Server.

### Cache e E/S

| Métrica | Série | Group | Engines |
|---|---|---|---|
| **Cache Hit Ratio** (%) | `oneuptime.monitor.database.cache.hit.percent` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Reads** | `oneuptime.monitor.database.disk.reads.total` | Throughput | PostgreSQL, MySQL, SQL Server |
| **Disk Writes** | `oneuptime.monitor.database.disk.writes.total` | Throughput | MySQL, SQL Server |
| **I/O Read Time** (ms) | `oneuptime.monitor.database.io.read.time.ms` | Throughput | PostgreSQL, SQL Server |
| **I/O Write Time** (ms) | `oneuptime.monitor.database.io.write.time.ms` | Throughput | PostgreSQL, SQL Server |
| **Page Life Expectancy** (s) | `oneuptime.monitor.database.page.life.expectancy.seconds` | Throughput | SQL Server |
| **Memory Grants Pending** | `oneuptime.monitor.database.memory.grants.pending` | Throughput | SQL Server |

O PostgreSQL só mede os tempos de leitura e gravação de E/S quando `track_io_timing` está ligado. Ele vem desligado por padrão, e então o PostgreSQL informa os dois como `0` — no PostgreSQL, um zero constante nessas duas séries costuma significar "não medido", e não "rápido". É uma configuração do servidor, não um problema de permissões.

### Armazenamento em disco

| Métrica | Série | Group | Engines |
|---|---|---|---|
| **Database Size** (bytes) | `oneuptime.monitor.database.size.bytes` | Storage | PostgreSQL, MySQL, SQL Server |
| **Temp Bytes Written** (bytes) | `oneuptime.monitor.database.temp.bytes.total` | Storage | PostgreSQL |
| **Temp Disk Tables** | `oneuptime.monitor.database.temp.disk.tables.total` | Storage | MySQL |
| **Log Space Used** (%) | `oneuptime.monitor.database.log.space.used.percent` | Storage | SQL Server |
| **TempDB Free Space** (bytes) | `oneuptime.monitor.database.tempdb.free.bytes` | Storage | SQL Server |

### Replicação

| Métrica | Série | Group | Engines |
|---|---|---|---|
| **Connected Replicas** | `oneuptime.monitor.database.replica.count` | Replication | PostgreSQL, SQL Server |
| **Replication Lag** (s) | `oneuptime.monitor.database.replication.lag.seconds` | Replication | PostgreSQL, MySQL |
| **Replication Lag (Bytes)** (bytes) | `oneuptime.monitor.database.replication.lag.bytes` | Replication | PostgreSQL, SQL Server |
| **Is In Recovery** | `oneuptime.monitor.database.is.in.recovery` | Replication | PostgreSQL |
| **Inactive Replication Slots** | `oneuptime.monitor.database.replication.slots.inactive` | Replication | PostgreSQL |

As métricas de replicação são informadas pelo lado do vínculo ao qual o monitor está conectado. Aponte um monitor para o primário para ver as réplicas conectadas e a fila de envio; aponte um para cada standby para ver o quanto esse standby está realmente atrasado.

O atraso em segundos marca zero em um primário ocioso mesmo quando uma réplica está muito atrasada, porque nada novo foi gravado. **Replication Lag (Bytes)** não tem esse ponto cego, então alerte sobre os dois.

### Manutenção

| Métrica | Série | Group | Engines |
|---|---|---|---|
| **Transaction ID Used** (%) | `oneuptime.monitor.database.transaction.id.used.percent` | Maintenance | PostgreSQL |
| **Dead Tuples** | `oneuptime.monitor.database.dead.tuples` | Maintenance | PostgreSQL |
| **Tables Never Autovacuumed** | `oneuptime.monitor.database.tables.never.autovacuumed` | Maintenance | PostgreSQL |
| **Requested Checkpoints** | `oneuptime.monitor.database.checkpoints.requested.total` | Maintenance | PostgreSQL |
| **Timed Checkpoints** | `oneuptime.monitor.database.checkpoints.timed.total` | Maintenance | PostgreSQL |

> [!IMPORTANT]
> **Transaction ID Used** merece um critério em todo monitor de PostgreSQL que você criar. O PostgreSQL recusa todas as gravações quando ele chega a 100%, a recuperação exige um vacuum em modo de usuário único com o banco de dados parado, e quase ninguém acompanha esse valor. Alerte bem antes do precipício — 80% deixa dias de folga na maioria das cargas.

Contadores que terminam em `total` são cumulativos desde que o servidor foi iniciado. Compare dois momentos para obter uma taxa; um valor isolado só tem sentido em relação ao próprio histórico, e ele volta a zero quando o servidor reinicia (o que **Uptime** vai mostrar).

## Configurar critérios

| Tipo de filtro | O que verifica |
|---|---|
| **Database Is Online** | Se o banco de dados estava acessível e a consulta de teste funcionou. É o critério de offline com que o monitor é criado, e a única verificação que reflete a acessibilidade. |
| **Database Metric** | Escolha uma métrica e compare: Greater Than, Less Than, Greater Than Or Equal To, Less Than Or Equal To, Equal To ou Not Equal To. O seletor de métricas só oferece as métricas que o mecanismo escolhido consegue produzir, então você não consegue montar um critério que ficaria para sempre sem ser atendido (uma exceção: as métricas de Replication oferecidas para o Microsoft SQL Server nunca são coletadas no Azure SQL Database). Se a métrica não foi coletada em uma verificação — o grupo falhou ou o mecanismo não a informa —, o filtro não corresponde, e também não corresponde como "false": ele é ignorado. Um problema de permissões não consegue acionar ninguém. |
| **Database Collection Error** | O resumo dos problemas de coleta da verificação, um "grupo: mensagem" por grupo indisponível. Alerte quando não estiver vazio para perceber a perda de visibilidade, ou use Contains para acompanhar um grupo específico. |
| **JavaScript Expression** | Controle total. Veja [Expressões JavaScript](/docs/monitor/javascript-expression). |

Os limites são números inteiros. Escreva `90`, não `90.5` — porcentagens e segundos são comparados como inteiros.

**Database Is Online** e **Database Metric** podem ser verificados ao longo do tempo: marque **Avaliar este critério durante um período de tempo**, depois escolha como **Avaliar** os valores (por exemplo **All Values**) e **Nos últimos (em minutos)**. Ao longo do tempo, a configuração **Se não houver dados** do filtro decide o que um valor ausente significa; deixe-a em **Ignore** para que uma permissão ausente continue sem conseguir acionar ninguém.

### Variáveis das expressões JavaScript

Em um monitor Database Health, a expressão tem acesso a:

| Variável | Tipo | Descrição |
|---|---|---|
| `isOnline` | boolean | Se a conexão e a consulta de teste funcionaram |
| `engineVersion` | string | A string de versão informada pelo servidor (no SQL Server, a `ProductVersion` pura; o resumo do monitor nomeia a plataforma ao lado) |
| `connectionError` | string | Erro de conexão higienizado, vazio quando não houve nenhum |
| `collectedGroups` | array | Os grupos que produziram valores nesta verificação |
| `unavailableGroups` | array | Os grupos com uma instrução que não pôde ser coletada, cada um com um motivo e uma correção. Um grupo coletado em parte está nas duas listas |
| `metrics` | object | Os valores coletados, com o nome da série como chave; uma série que não foi coletada fica ausente |

```javascript
{{isOnline}} === true && {{collectedGroups}}.length >= 5
```

Para ler uma métrica em uma expressão, indexe o objeto `metrics` inteiro — os nomes das séries contêm pontos, então não podem ficar dentro das chaves:

```javascript
{{metrics}}['oneuptime.monitor.database.connections.used.percent'] > 90
```

Para um limite em uma única métrica, prefira **Database Metric** a uma expressão: ele resolve a série para você, só oferece o que o seu mecanismo consegue produzir e ignora a verificação quando o valor não foi coletado, em vez de comparar com nada.

### Exemplo: um primário PostgreSQL

| Ordem | Critério | Filtro |
|---|---|---|
| 1 | **Offline** | `Database Is Online` é `false`. |
| 2 | **Degradado** | `Database Metric` → Connections Used é maior que `90`, avaliado ao longo de 5 minutos com All Values para que um pico isolado não acione ninguém. |
| 3 | **Degradado** | `Database Metric` → Transaction ID Used é maior que `80`. |
| 4 | **Degradado** | `Database Metric` → Blocked Sessions é maior que `0`, ao longo de 5 minutos. |
| 5 | **Online** | `Database Is Online` é `true`. |

Os critérios são avaliados de cima para baixo e a primeira correspondência vence, então coloque os critérios de alerta primeiro e o saudável por último.

Associe uma política de plantão ao critério de offline e deixe tudo o que derivar de **Metric Groups Failed** ou de `Database Collection Error` como alerta sem política de plantão associada.

## O que levar em conta

- **As consultas rodam a cada verificação.** Elas são baratas por design, mas "barato" é relativo ao intervalo. Um intervalo de um minuto em um servidor com milhares de sessões significa mais varreduras de `pg_stat_activity` do que talvez você queira; cinco minutos bastam para métricas de capacidade.
- **Aponte o monitor para o banco de dados que importa para você.** Tamanho, taxa de acerto do cache e uso de arquivos temporários são por banco de dados. Conexões, tempo de atividade e replicação são por servidor e dão o mesmo valor a partir de qualquer banco de dados dessa instância.
- **Um monitor por instância, não por banco de dados**, a menos que você queira especificamente métricas de tamanho e de cache por banco de dados — caso contrário, você multiplica as consultas de escopo de servidor sem informação nova. O Azure SQL Database é a exceção: ele informa conexões por banco de dados, então lá monitore cada banco de dados.
- **Alerte sobre taxas, não sobre contadores.** Tudo o que termina em `total` só sobe, então um limite "maior que" sobre isso dispara uma vez e nunca se recupera. Mostre em um gráfico ou compare ao longo de uma janela.
- **Prefira um segredo do monitor a uma senha em texto puro.** Assim a credencial fica criptografada em repouso e nunca aparece no monitor.
- **O monitor nunca grava.** Toda consulta é uma leitura de uma view de estatísticas — no PostgreSQL dentro de uma transação somente leitura, no MySQL em uma sessão somente leitura. O que ele não consegue ler é informado como métrica ausente, nunca como indisponibilidade.

## Solução de problemas

:::details O monitor está offline, mas o banco de dados está no ar
Offline significa que a sonda não conseguiu se conectar ou que a consulta de teste falhou: o host ou a porta não são acessíveis pela sonda, o login foi recusado, o TLS falhou ou a conexão excedeu o tempo limite. O resumo do monitor mostra o erro. Verifique se a sonda alcança o banco de dados (uma sonda hospedada pelo OneUptime precisa de um endereço público; caso contrário, use uma [sonda personalizada](/docs/probe/custom-probe)), confira o nome de usuário e a senha ou o segredo do monitor dela, e desligue **Verify server certificate** para um certificado autoassinado. Depois clique em **Testar monitor** para verificar de novo.
:::

:::details Connections, Activity e Locks estão faltando no PostgreSQL
O login não é membro de `pg_monitor` nem de `pg_read_all_stats` e não é superusuário, então a sonda ignora esses grupos em vez de registrar números errados. Execute `GRANT pg_monitor TO oneuptime_health;` como descrito em [PostgreSQL](#postgresql).
:::

:::details Connections, Throughput e Locks estão faltando no MySQL
Ou falta ao login `SELECT` em `performance_schema`, ou `performance_schema` está desligado no servidor; o resumo do monitor mostra a mensagem do MySQL. Para uma permissão ausente, execute as instruções em [MySQL](#mysql). Um `performance_schema` desativado precisa de `performance_schema = ON` na configuração do servidor e de um reinício.
:::

:::details I/O Read Time e I/O Write Time são sempre 0 no PostgreSQL
O PostgreSQL só os mede quando `track_io_timing` está ligado, e ele vem desligado por padrão. Ligue-o na configuração do servidor, ou no grupo de parâmetros do seu serviço gerenciado, para ver valores reais. Não é uma permissão ausente.
:::

:::details Metric Groups Failed fica acima de 0 em toda verificação
Um grupo não pode ser coletado em nenhuma verificação, então o mesmo problema de coleta se repete. O resumo do monitor nomeia o grupo, o motivo e o `GRANT` que o corrige. Execute a permissão ou, se não conseguir obtê-la, desligue esse grupo em **Metric Groups** para que o problema pare de se repetir.
:::

## Próximos passos

:::cards
- [Monitor de consultas SQL](/docs/monitor/sql-monitor): Alerte sobre o resultado da sua própria consulta, ao lado da saúde do servidor.
- [Bancos de dados](/docs/telemetry/databases): Veja as métricas, os logs e quem chama cada banco de dados em uma única página.
- [Segredos do monitor](/docs/monitor/monitor-secrets): Mantenha criptografada a senha do usuário de monitoramento.
- [Sondas personalizadas](/docs/probe/custom-probe): Alcance um banco de dados dentro da sua rede.
:::
