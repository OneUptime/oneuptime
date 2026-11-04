# Verificações e reconciliações

A saúde das tabelas diz se uma tabela muda. Uma **verificação** diz se o que ela contém está certo, uma **reconciliação** diz se duas cópias dos dados batem, e os **testes do dbt** informam sobre as tabelas que o dbt constrói. Cada uma roda onde a coleta do banco de dados roda, pelo OneUptime ou pela sonda dele, e só um número sai do banco de dados.

## Verificações

Adicione uma verificação na aba **Verificações** de uma tabela:

| Verificação | O que ela lê |
| --- | --- |
| **Null Percent** | Porcentagem de linhas cuja coluna está vazia |
| **Duplicate Percent** | Porcentagem de valores que repetem o de outra linha |
| **Distinct Count** | Quantos valores diferentes a coluna contém |
| **Mínimo**, **Máximo**, **Média**, **Soma** | De uma coluna numérica (uma Soma sem linhas é 0) |
| **Invalid Percent** | Porcentagem de valores fora de uma lista que você informa |
| **Format Mismatch Percent** | Porcentagem de valores que não correspondem a uma expressão regular (todos os mecanismos, exceto o SQL Server) |
| **Orphan Count** | Linhas cujo valor não tem correspondência na coluna de outra tabela |
| **Row Count** | Linhas na tabela, mais útil com **Segment By** |
| **SQL personalizado** | O número que um SELECT somente leitura seu retorna, chamado `value` (no MongoDB, o de um pipeline de agregação) |

Cada verificação roda a cada 15 minutos, hora, 6 horas ou dia, como uma única instrução de agregação em uma transação somente leitura com um tempo limite de instrução. O valor dela é gravado como `oneuptime.data.check.value`, com `oneuptime.data.check.id`, `oneuptime.data.check.name` e `oneuptime.data.check.segment`.

## Verificações sugeridas

**Suggested Checks**, na mesma aba, oferece as verificações que as colunas de uma tabela pedem, só a partir dos nomes e tipos delas: um id é único, um `customer_id` tem uma linha correspondente em `customers`, um e-mail tem formato de e-mail, um valor não é negativo, um status mantém os seus valores habituais, e uma tabela dividida por tenant é contada por tenant. Adicione uma, adicione todas ou descarte uma de vez.

## Uma verificação a partir de uma frase

**Escrever uma verificação a partir de uma frase** transforma uma regra como "pedidos nunca têm total negativo" em uma verificação de SQL personalizado que conta as linhas que a violam, no próprio SQL do seu mecanismo, com um alerta quando alguma violar. Você lê a consulta antes que **Adicionar verificação** a adicione, e ela segue as mesmas regras de qualquer verificação de SQL personalizado. É preciso que o OneUptime AI esteja ativado para o projeto. No MongoDB, o resultado é um pipeline de agregação.

## Segmentos

**Segment By** roda uma verificação uma vez por valor de uma coluna, como um tenant ou uma região: uma série e um alerta para cada um, para os 100 maiores segmentos. Uma Row Count segmentada alerta quando um tenant para de enviar dados enquanto os outros continuam.

## Alertas sobre uma verificação

Defina **Alert When** para alertar sobre uma verificação:

- **Unusually High** ou **Unusually Low** compara cada valor com a sua própria linha de base aprendida para aquela hora da semana.
- **Acima de** ou **Abaixo de** o compara com um limite.

Salvar a verificação cria um monitor de métricas para ela, em seu nome e com as suas permissões. Limpar a condição remove o monitor.

## Reconciliações

Cópias divergem: o data warehouse tem menos pedidos do que o banco de dados da aplicação, ou uma migração perdeu linhas. Uma reconciliação compara uma medida de duas tabelas, em um banco de dados ou em dois, em **Reconciliações**:

- **Row Count**
- **Soma** de uma coluna
- **Distinct Count** de uma coluna
- **SQL personalizado**: uma consulta somente leitura que retorna um número, chamado `value`

Ela tem uma tolerância: **Absoluta**, uma quantidade fixa, ou **Percentual**, uma porcentagem do valor da origem. Cada lado é lido por uma verificação própria, que a reconciliação cria e mantém, junto com a coleta do banco de dados dele, então uma reconciliação pode comparar uma tabela PostgreSQL na sua rede com a cópia dela no Snowflake. Os dois valores são comparados assim que ambos tiverem sido lidos com até 15 minutos de diferença um do outro. Uma reconciliação grava:

- `oneuptime.data.reconciliation.drifted`: 1 quando os dois divergiram além da tolerância, 0 quando batem. O monitor dela lê esse valor.
- `oneuptime.data.reconciliation.difference`: o valor do destino menos o da origem.
- `oneuptime.data.reconciliation.difference_percent`: a diferença como porcentagem do valor da origem.

Uma cópia carregada em um agendamento fica atrás da sua origem: compare, com SQL personalizado, uma medida em que ambas já se estabilizaram, como as linhas com mais de uma hora, ou preveja o atraso na tolerância.

## Testes do dbt

Depois de um build do dbt, `oneuptime dbt upload` envia os artefatos do projeto (veja [Linhagem e pipelines](/docs/data-observability/lineage-and-pipelines)). Cada teste de uma tabela observada passa então a aparecer na aba **Verificações** dela, com o último resultado e as linhas que ele encontrou falhando. Escolha **Alert on Failures** para que um teste que falha abra um alerta.

## Próximos passos

:::cards
- [Linhagem e pipelines](/docs/data-observability/lineage-and-pipelines): Envie os artefatos do dbt e veja a execução por trás de uma verificação que falha.
- [Produtos de dados](/docs/data-observability/data-products): Prometa às pessoas que usam os dados que eles estão atualizados.
:::
