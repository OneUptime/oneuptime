# Monitor de Consultas SQL

O Monitor de Consultas SQL executa uma consulta SQL somente leitura de forma agendada a partir de uma probe e alerta com base no resultado — o número de linhas retornadas, um valor escalar, quanto tempo a consulta levou ou um erro de consulta. Ele foi criado para o caso de uso "executar uma consulta e abrir um incidente", por exemplo, alertar quando o número de pedidos cancelados nos últimos cinco minutos dispara, quando uma tabela de fila cresce demais ou quando uma linha crítica desaparece.

Como a consulta é executada a partir de uma probe dentro da sua rede, o OneUptime nunca precisa de uma conexão direta com o seu banco de dados, e o conjunto completo de resultados nunca sai da probe — apenas uma projeção pequena e limitada do resultado é reportada de volta.

## Bancos de dados suportados

O Monitor de Consultas SQL suporta os seguintes mecanismos de banco de dados:

- **PostgreSQL** (porta padrão `5432`)
- **MySQL** (porta padrão `3306`)
- **Microsoft SQL Server** (porta padrão `1433`)

Mecanismos compatíveis com MySQL e compatíveis com PostgreSQL que usam o mesmo protocolo de comunicação e dialeto SQL geralmente também funcionam, mas apenas os três mecanismos acima são oficialmente testados.

## Como funciona

A cada verificação, a probe conecta ao seu banco de dados, executa a sua consulta em um contexto somente leitura, lê de volta no máximo um número limitado de linhas e reporta uma projeção compacta ao OneUptime. Os critérios do seu monitor são então avaliados em relação a essa projeção.

A probe reporta apenas:

- **Contagem de Linhas** — o número de linhas que a consulta retornou (limitado pelo limite de Máximo de Linhas).
- **Valor Escalar** — a primeira coluna da primeira linha. Esse é o valor natural para uma consulta do tipo `SELECT COUNT(*)`.
- **Primeira Linha** — a primeira linha como um conjunto de pares coluna/valor, exibida no resumo da verificação para contexto.
- **Tempo de Execução** — quanto tempo a consulta levou, em milissegundos.
- **Erro de Consulta** — uma mensagem de erro higienizada caso a consulta falhe.

O conjunto completo de resultados nunca é enviado ao OneUptime, então os dados do cliente não são replicados no armazenamento do OneUptime.

## Modelo de segurança

Executar uma consulta fornecida pelo cliente contra um banco de dados de produção é sensível, portanto o Monitor de Consultas SQL é somente leitura por design e adiciona várias camadas de controle:

- **Usuário de banco de dados com privilégio mínimo (controle principal).** Você deve sempre conectar com um usuário de banco de dados dedicado e somente leitura que tenha acesso apenas às tabelas de que a consulta precisa. Esse é o controle mais importante — consulte Criar um usuário somente leitura abaixo.
- **Execução somente leitura.** No PostgreSQL e no MySQL a probe abre uma transação `READ ONLY`, que rejeita qualquer escrita (incluindo CTEs graváveis) independentemente do texto da consulta. No Microsoft SQL Server, que não possui transação somente leitura, a probe é executada dentro de uma transação que sempre sofre rollback.
- **Consultas de instrução única e em lista de permissões.** A consulta deve ser uma única instrução que começa com `SELECT`, `WITH`, `VALUES` ou `TABLE`. Instruções empilhadas (`SELECT 1; DROP TABLE …`) e escritas/DDL são rejeitadas antes de a probe se conectar. A verificação reconhece comentários e literais de string, então uma palavra-chave escondida em um comentário ou string não passa despercebida.
- **Tempo limite de instrução.** Toda consulta tem um limite de tempo rígido. Uma consulta que demora demais é cancelada.
- **Linhas limitadas.** No máximo Máximo de Linhas (mais uma, para detectar truncamento) linhas são lidas de volta, o que limita a memória e o tamanho da carga útil da probe.
- **Redação de credenciais.** Os erros de banco de dados são higienizados antes de serem armazenados — a senha e qualquer string de conexão são redigidas, então as credenciais nunca vazam para as mensagens de erro.

## Pré-requisitos

- Uma **probe** com acesso de rede ao host e à porta do seu banco de dados. Pode ser uma probe hospedada pelo OneUptime (se o seu banco de dados for acessível pela internet) ou uma probe auto-hospedada em execução dentro da sua rede. Consulte a documentação da probe para saber como instalar uma probe personalizada.
- Um **usuário de banco de dados somente leitura** e os detalhes de conexão (host, porta, nome do banco de dados, nome de usuário, senha).

## Configuração

Crie um novo monitor e escolha **SQL Query** como o tipo de monitor, depois preencha os detalhes de conexão:

- **Tipo de Banco de Dados** — PostgreSQL, MySQL ou Microsoft SQL Server. Escolher um tipo define a porta padrão.
- **Host** — o host do banco de dados acessível a partir da probe (por exemplo `db.internal`).
- **Porta** — a porta do banco de dados.
- **Nome do Banco de Dados** — o banco de dados no qual a consulta será executada.
- **Nome de Usuário** — um usuário de banco de dados somente leitura, com privilégio mínimo.
- **Senha** — a senha do banco de dados. Recomendamos fortemente referenciar um [Segredo de Monitor](/docs/monitor/monitor-secrets) com `{{monitorSecrets.name}}` em vez de digitar a senha em texto simples (veja abaixo).
- **Consulta SQL** — a consulta somente leitura a ser executada (consulte Escrevendo a consulta).
- **Usar SSL/TLS** — habilite para conectar via TLS. Quando habilitado, você pode desativar **Verificar certificado do servidor** se o banco de dados usar um certificado autoassinado.

### Opções avançadas

- **Tempo Limite de Conexão (ms)** — quanto tempo aguardar para estabelecer uma conexão. Padrão `10000`, máximo `30000`.
- **Tempo Limite de Instrução (ms)** — o limite rígido de quanto tempo a consulta pode ser executada. Padrão `15000`, máximo `60000`.
- **Máximo de Linhas** — o limite superior de linhas lidas de volta do banco de dados. Padrão `100`, máximo `1000`.

## Escrevendo a consulta

A consulta deve ser uma **única instrução somente leitura**. Ela deve começar com um dentre `SELECT`, `WITH`, `VALUES` ou `TABLE`. Um único ponto e vírgula ao final é permitido; múltiplas instruções não são.

Mantenha as consultas baratas e bem delimitadas — elas são executadas a cada verificação, então prefira colunas indexadas e janelas de tempo estreitas.

```sql
-- Conta cancelamentos recentes (PostgreSQL)
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL '5 minutes';
```

```sql
-- A mesma ideia no MySQL
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > NOW() - INTERVAL 5 MINUTE;
```

```sql
-- A mesma ideia no Microsoft SQL Server
SELECT COUNT(*) AS cancelled
FROM orders
WHERE status = 'CANCELLED'
  AND created_at > DATEADD(minute, -5, GETDATE());
```

Para uma consulta do tipo `COUNT(*)`, a contagem está disponível tanto como **Contagem de Linhas** (que é `1`, já que uma linha é retornada) quanto como **Valor Escalar** (a própria contagem, da primeira coluna). Para alertar sobre "quantos", compare com o **Valor Escalar**.

## Usando um Segredo de Monitor para a senha

Para que a senha do banco de dados nunca seja armazenada em texto simples no monitor, crie um [Segredo de Monitor](/docs/monitor/monitor-secrets) e referencie-o a partir do campo Senha:

1. Vá para Painel do OneUptime → Configurações do Projeto → Segredos de Monitor → Criar Segredo de Monitor.
2. Crie um segredo (por exemplo `dbPassword`) e conceda a este monitor acesso a ele.
3. No campo Senha do monitor, insira `{{monitorSecrets.dbPassword}}`.

O OneUptime resolve o segredo no lado do servidor antes que a configuração seja entregue à probe. O OneUptime nunca cria esses segredos para você — referenciar um é uma escolha sua.

## Configurando critérios

Adicione critérios para decidir quando o monitor é considerado online, degradado ou offline. As seguintes verificações estão disponíveis para um Monitor de Consultas SQL:

- **SQL Is Online** — se o banco de dados estava acessível e a consulta teve êxito.
- **SQL Query Row Count** — o número de linhas retornadas. Compare com operadores como maior que, menor que ou igual a.
- **SQL Query Scalar Value** — a primeira coluna da primeira linha. Comparada numericamente quando ambos os lados parecem numéricos, caso contrário como strings. Essa é a verificação a ser usada para consultas do tipo `COUNT(*)`.
- **SQL Query Execution Time (in ms)** — quanto tempo a consulta levou. Útil para detectar um banco de dados lento.
- **SQL Query Error** — a mensagem de erro da consulta. Alerta quando ela está (ou não está) vazia, ou corresponde a uma string específica.
- **JavaScript Expression** — avalie uma expressão JavaScript personalizada para controle total. Consulte [Expressões JavaScript](/docs/monitor/javascript-expression).

### Exemplo: alertar quando os cancelamentos disparam

Usando a consulta acima:

- **Critério: Degradado** — `SQL Query Scalar Value` é maior que `10`.
- **Critério: Offline** — `SQL Query Scalar Value` é maior que `50`, ou `SQL Is Online` é `false`.

Anexe uma política de plantão aos critérios para que as pessoas certas sejam acionadas.

## Criar um usuário somente leitura

Sempre conecte com um usuário dedicado somente leitura. Exemplos:

```sql
-- PostgreSQL
CREATE USER oneuptime_ro WITH PASSWORD 'a-strong-password';
GRANT CONNECT ON DATABASE orders TO oneuptime_ro;
GRANT USAGE ON SCHEMA public TO oneuptime_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO oneuptime_ro;
-- Inclui tabelas criadas no futuro:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO oneuptime_ro;
```

```sql
-- MySQL
CREATE USER 'oneuptime_ro'@'%' IDENTIFIED BY 'a-strong-password';
GRANT SELECT ON orders.* TO 'oneuptime_ro'@'%';
FLUSH PRIVILEGES;
```

```sql
-- Microsoft SQL Server
CREATE LOGIN oneuptime_ro WITH PASSWORD = 'a-strong-password';
USE orders;
CREATE USER oneuptime_ro FOR LOGIN oneuptime_ro;
ALTER ROLE db_datareader ADD MEMBER oneuptime_ro;
```

## Pontos a considerar

- A consulta é executada a cada verificação, então mantenha-a barata. Use índices e janelas de tempo estreitas, e conte com o Tempo Limite de Instrução como uma proteção adicional.
- Apenas a contagem de linhas, a primeira célula (escalar) e a primeira linha são reportadas — projete sua consulta de forma que o valor sobre o qual você quer alertar seja a primeira coluna.
- Se o resultado for truncado por exceder o Máximo de Linhas, o resumo da verificação o sinaliza como limitado. Aumente o Máximo de Linhas apenas se precisar; conjuntos de resultados maiores custam mais memória na probe.
- Escritas e DDL são sempre rejeitadas. Se você precisar testar um caminho de escrita, não é para isso que este monitor serve.
- Prefira um Segredo de Monitor a uma senha em texto simples para que a credencial permaneça criptografada em repouso.
