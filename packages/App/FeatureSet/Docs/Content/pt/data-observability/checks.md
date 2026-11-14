# Verificações e reconciliações

A saúde das tabelas diz se uma tabela muda. Uma **verificação** diz se o que ela contém está certo, uma **reconciliação** diz se duas cópias dos dados batem, e os **testes do dbt** informam sobre as tabelas que o dbt constrói. Cada uma roda onde a coleta do banco de dados roda, pelo OneUptime ou pela sonda dele, e só um número sai do banco de dados, a menos que um projeto escolha guardar uma amostra mascarada das linhas com falha.

## Verificações

Adicione uma verificação na aba **Verificações** de uma tabela:

| Verificação | O que ela lê |
| --- | --- |
| **Porcentagem de nulos** | Porcentagem de linhas cuja coluna está vazia |
| **Porcentagem de duplicados** | Porcentagem de valores que repetem o de outra linha |
| **Contagem de valores distintos** | Quantos valores diferentes a coluna contém |
| **Mínimo**, **Máximo**, **Média**, **Soma** | De uma coluna numérica (uma Soma sem linhas é 0) |
| **Porcentagem de valores inválidos** | Porcentagem de valores fora de uma lista que você informa |
| **Porcentagem de formato incorreto** | Porcentagem de valores que não estão em um formato que você escolhe, como Email, UUID ou Country Code, ou que não correspondem a uma expressão regular sua (todos os mecanismos, exceto o SQL Server e o Dataverse) |
| **Contagem de linhas órfãs** | Linhas cujo valor não tem correspondência na coluna de outra tabela |
| **Número de linhas** | Linhas na tabela, mais útil com **Segmentar por** |
| **SQL personalizado** | O número que um SELECT somente leitura seu retorna, chamado `value` (no MongoDB, o de um pipeline de agregação) |
| **Linhas com falha** | Quantas linhas um SELECT somente leitura seu retorna: as linhas que não deveriam existir. 0 é saudável (no MongoDB, os documentos em que um pipeline termina) |

Cada verificação roda a cada 15 minutos, hora, 6 horas ou dia, como uma única instrução de agregação em uma transação somente leitura com um tempo limite de instrução. O valor dela é gravado como `oneuptime.data.check.value`, com `oneuptime.data.check.id`, `oneuptime.data.check.name` e `oneuptime.data.check.segment`.

## Verificações sugeridas

**Verificações sugeridas**, na mesma aba, oferece as verificações que as colunas de uma tabela pedem, só a partir dos nomes e tipos delas: um id é único, um `customer_id` tem uma linha correspondente em `customers`, um e-mail tem formato de e-mail, um valor não é negativo, um status mantém os seus valores habituais, e uma tabela dividida por tenant é contada por tenant. Uma coluna que a Segurança de dados sabe que contém um endereço de e-mail, um número de telefone ou um endereço IP é mantida nesse formato, qualquer que seja o nome dela. Adicione uma, adicione todas ou descarte uma de vez.

## Uma verificação a partir de uma frase

**Escrever uma verificação a partir de uma frase** transforma uma regra como "pedidos nunca têm total negativo" em uma verificação de SQL personalizado que conta as linhas que a violam, no próprio SQL do seu mecanismo, com um alerta quando alguma violar. Você lê a consulta antes que **Adicionar verificação** a adicione, e ela segue as mesmas regras de qualquer verificação de SQL personalizado. É preciso que o OneUptime AI esteja ativado para o projeto. No MongoDB, o resultado é um pipeline de agregação.

## Segmentos

**Segmentar por** roda uma verificação uma vez por valor de uma coluna, como um tenant ou uma região: uma série e um alerta para cada um, para os 100 maiores segmentos. Um número de linhas segmentado alerta quando um tenant para de enviar dados enquanto os outros continuam.

## Alertas sobre uma verificação

Defina **Gerar alerta quando** para alertar sobre uma verificação:

- **Incomumente alto** ou **Incomumente baixo** compara cada valor com a sua própria linha de base aprendida para aquela hora da semana.
- **Acima de** ou **Abaixo de** o compara com um limite.

Salvar a verificação cria um monitor de métricas para ela, em seu nome e com as suas permissões. Limpar a condição remove o monitor.

O **Status** de uma verificação, em **Verificações** e na aba **Verificações** da tabela dela, diz como ela está: **Com falha** enquanto o alerta dela está aberto, **Aprovado** enquanto não está, e **Não foi possível executar** quando a consulta dela falhou. Uma verificação sem alerta mostra apenas **Executou**: a consulta dela funcionou. Uma verificação com falha, e uma que não pôde ser executada, aparece também na **Visão geral**.

## O que uma verificação custa

Uma verificação compete com a sua aplicação pelo banco de dados e, em um warehouse que cobra pelo que uma consulta lê, custa dinheiro. Três coisas mantêm isso sob controle:

- **Porcentagem da amostra** lê uma parte das linhas em vez de todas, para uma verificação que lê uma taxa: Porcentagem de nulos, Média, Porcentagem de valores inválidos e Porcentagem de formato incorreto. A maioria dos mecanismos pula páginas inteiras da tabela; o MySQL, o Redshift, o ClickHouse e o MongoDB ainda leem todas as linhas, e poupam o trabalho nas demais. O Dataverse não tira amostras: uma verificação ali lê todas as linhas. Uma view pode recusá-la, e a verificação avisa.
- **Máximo que uma verificação pode ler (GB)**, em **Configurações**, interrompe uma verificação no BigQuery ou no Athena antes que ela leia mais do que esse número de gigabytes. É 10 até você mudar.
- **Esperar quando um banco de dados está ocupado**, em **Configurações**, deixa as verificações pendentes para a próxima coleta quando um banco de dados PostgreSQL, MySQL ou SQL Server parece ocupado. Fica ativado até você desativar, e o banco de dados diz quando as verificações esperaram.

## Linhas com falha

Um número diz que algo está errado; algumas linhas dizem o quê. **Guardar Failing Rows**, em **Configurações**, guarda até 20 das linhas que uma verificação Linhas com falha, Porcentagem de valores inválidos, Porcentagem de formato incorreto ou Contagem de linhas órfãs encontrou, e **Linhas com falha** na verificação as mostra. Fica desativado até você ativá-lo. As colunas sensíveis são mascaradas onde a linha é lida, pelo que a Segurança de dados encontrou nelas ou pelos nomes delas, então o que sai do banco de dados, ou de uma sonda, já está mascarado. Uma coluna sensível que nenhuma varredura encontrou e cujo nome não a denuncia é guardada como está.

As linhas ficam armazenadas no OneUptime: nos servidores do OneUptime no OneUptime Cloud, e nos seus em uma instalação auto-hospedada. Quem pode ler as verificações do projeto pode vê-las. Uma verificação guarda apenas as linhas da última execução, e desativar **Guardar Failing Rows** exclui o que cada verificação guardou.

## Verificações em um arquivo

Verificações escritas à mão se afastam do código que altera as tabelas. Mantenha-as no seu repositório, revisadas no mesmo pull request:

```yaml
checks:
  - name: Orders have a total
    table: public.orders
    type: Null Percent
    column: total
    every: 60
    alert: { when: Above, threshold: 1 }
  - name: Emails look right
    table: public.customers
    database: Orders database
    type: Format Mismatch Percent
    column: email
    format: Email
    sample_percent: 10
  - name: Orders have a customer
    table: public.orders
    type: Orphan Count
    column: customer_id
    references: public.customers.id
  - name: No negative totals
    table: public.orders
    type: Failing Rows
    query: SELECT id FROM orders WHERE total < 0
    alert: { when: Above, threshold: 0 }
```

Aplique-o a partir da CI com a [CLI do OneUptime](/docs/cli/index) e uma chave de API:

```bash
oneuptime data-checks apply checks.yaml --dry-run
oneuptime data-checks apply checks.yaml --prune
```

Uma verificação é a mesma verificação se tem o mesmo nome na mesma tabela, então aplicar um arquivo duas vezes não muda nada. Um erro em qualquer parte do arquivo não aplica nada e termina com um erro, então rode `--dry-run` no pull request e aplique no merge. Com `--prune`, uma verificação que uma aplicação anterior criou e que o arquivo não cita mais é excluída. Uma verificação que você adicionou à mão nunca é. Uma verificação vinda de um arquivo diz isso na sua linha, e a próxima aplicação sobrescreve o que foi alterado à mão.

As chaves são `name`, `table`, `database`, `type`, `column`, `segment`, `accepted_values`, `format`, `pattern`, `references`, `query`, `sample_percent`, `every`, `alert`, `description` e `enabled`.

## Reconciliações

Cópias divergem: o data warehouse tem menos pedidos do que o banco de dados da aplicação, ou uma migração perdeu linhas. Uma reconciliação compara uma medida de duas tabelas, em um banco de dados ou em dois, em **Reconciliações**:

- **Número de linhas**
- **Soma** de uma coluna
- **Contagem de valores distintos** de uma coluna
- **SQL personalizado**: uma consulta somente leitura que retorna um número, chamado `value`

Ela tem uma tolerância: **Absoluta**, uma quantidade fixa, ou **Percentual**, uma porcentagem do valor da origem. Cada lado é lido por uma verificação própria, que a reconciliação cria e mantém, junto com a coleta do banco de dados dele, então uma reconciliação pode comparar uma tabela PostgreSQL na sua rede com a cópia dela no Snowflake. Os dois valores são comparados assim que ambos tiverem sido lidos com até 15 minutos de diferença um do outro. Uma reconciliação grava:

- `oneuptime.data.reconciliation.drifted`: 1 quando os dois divergiram além da tolerância, 0 quando batem. O monitor dela lê esse valor.
- `oneuptime.data.reconciliation.difference`: o valor do destino menos o da origem.
- `oneuptime.data.reconciliation.difference_percent`: a diferença como porcentagem do valor da origem.

Uma cópia carregada em um agendamento fica atrás da sua origem: compare, com SQL personalizado, uma medida em que ambas já se estabilizaram, como as linhas com mais de uma hora, ou preveja o atraso na tolerância.

## Testes do dbt

Depois de um build do dbt, `oneuptime dbt upload` envia os artefatos do projeto (veja [Linhagem e pipelines](/docs/data-observability/lineage-and-pipelines)). Cada teste de uma tabela observada passa então a aparecer na aba **Verificações** dela, com o último resultado e as linhas que ele encontrou falhando. Escolha **Alertar em falhas** para que um teste que falha abra um alerta.

## Próximos passos

:::cards
- [Linhagem e pipelines](/docs/data-observability/lineage-and-pipelines): Envie os artefatos do dbt e veja a execução por trás de uma verificação que falha.
- [Produtos de dados](/docs/data-observability/data-products): Prometa às pessoas que usam os dados que eles estão atualizados.
:::
