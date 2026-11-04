# Produtos de dados

As pessoas que usam dados - analistas, o financeiro, executivos, agentes de IA - pensam no que usam: "as tabelas do dashboard de receita", não em bancos de dados. Um **produto de dados** dá nome a essas tabelas, com o seu proprietário, os seus consumidores e o seu SLA de atualização, e diz a todos que dependem dele se os dados de hoje já chegaram.

## Criar um produto de dados

Em **Observabilidade de dados > Produtos de dados**, crie um produto de dados: dê um nome a ele, escolha as tabelas e dê a ele um SLA com uma das opções a seguir, ou com as duas:

- **Atualizado até um horário do dia (UTC):** os dados de cada dia chegam naquele dia, até esse horário. A partir desse horário, cada tabela precisa ter mudado naquele dia; até lá, vale a carga de ontem. Uma carga que sempre atrasa meia hora fica atrasada por essa meia hora todos os dias.
- **Uma idade máxima:** a última mudança de nenhuma tabela pode ser mais antiga do que isso.

A cada cinco minutos, as tabelas de cada produto são verificadas em relação ao SLA dele. O produto aparece como **Atrasada** quando qualquer tabela está atrasada, e a data dos dados dele é a da última mudança mais antiga entre elas. Ele grava `oneuptime.data.product.late_tables` e `oneuptime.data.product.data_age`, para que você possa comparar a atualidade de todos os produtos lado a lado em um gráfico.

## Em páginas de status

Salvar um produto também cria um **monitor** para ele, em seu nome e com as suas permissões. O monitor fica Degradado enquanto uma tabela está atrasada, e abre um incidente e um alerta no nível menos grave do seu projeto, que se resolvem sozinhos. Adicione-o a uma página de status, privada ou pública, como recurso: os consumidores inscritos ficam sabendo quando o produto atrasa e quando volta a ficar atualizado. Veja [Recursos e grupos da página de status](/docs/status-pages/resources-and-groups).

## Como um SLO

Salvar um produto também cria um **SLO** sobre o monitor dele: a parcela do tempo em que os dados estão no prazo, comparada com a meta do produto ao longo de 30 dias, com os alertas de taxa de consumo rápido e lento com que todo SLO começa. Veja [SLOs](/docs/slo/introduction). Excluir o produto exclui o monitor e o SLO dele.

## O selo "data as of"

Cada produto tem um **selo** que diz de quando são os dados dele, verde enquanto estão no prazo e âmbar com "late" quando não estão. Incorpore-o a um dashboard de BI, a uma página de wiki ou a um README a partir da **Visão geral** do produto:

```markdown
![Data as of](https://oneuptime.com/api/data-observability/data-products/<data product ID>/badge?token=<badge token>)
```

O link dele não exige login, então trate-o como um link compartilhado. **Redefinir link do selo** cria um novo e desativa o antigo.

## Próximos passos

:::cards
- [Saúde das tabelas](/docs/data-observability/table-health): Como a atualidade de cada tabela é aprendida.
- [OneUptime AI e a API](/docs/data-observability/ai-and-api): Deixe que agentes de IA verifiquem as tabelas de um produto antes de usá-las.
:::
