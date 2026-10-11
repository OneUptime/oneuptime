# Referência de permissões

Todas as funções e permissões que o OneUptime pode conceder, agrupadas como no seletor de permissões do painel. Use esta página para encontrar o nome ou a chave exata a dar a uma equipe, a uma chave de API ou a um recurso do Terraform.

As tabelas são geradas a partir do código-fonte do OneUptime quando a página é servida: é a mesma lista que o painel, a API e o provedor Terraform usam. Por isso, elas sempre correspondem à versão que você executa. Para entender como as permissões se encaixam (equipes, escopos, proprietários e bloqueios), comece por [Usuários, equipes e permissões](/docs/permissions/index).

## Como ler as tabelas

Cada função e cada permissão tem uma linha com estas colunas:

- **Função** ou **Permissão**: o nome que o painel mostra.
- **Chave da permissão**: o valor a usar com a [API](/docs/api-reference/api-reference), a [CLI](/docs/cli/index) e o [provedor Terraform](/docs/terraform/index).
- **Escopo** (somente funções): `Todos, Próprios ou Rótulos` significa que você escolhe até onde a função vai ao concedê-la. `Apenas em todo o projeto` significa que a função sempre vale para o projeto inteiro.
- **Restringir por rótulos** (somente permissões): `Sim` significa que uma concessão dessa permissão pode ser limitada aos recursos que têm determinados rótulos.
- **Descrição**: o que a função ou a permissão permite.

> [!TIP]
> Prefira primeiro uma função. As funções continuam corretas à medida que o OneUptime ganha recursos, enquanto uma lista de permissões avulsas precisa ser mantida atualizada à mão.

## Funções

{{PERMISSION_ROLE_COUNT}} funções. Quatro delas valem para o projeto inteiro: Project Owner, Project Admin, Project Member e Viewer. Cada uma das outras cobre uma área do produto, como incidentes ou monitores, no nível Admin, Member ou Viewer. São elas que **Adicionar função** oferece na página **Permissões** de uma equipe e na página de uma chave de API.

{{PERMISSION_ROLE_TABLES}}

## Permissões individuais

{{PERMISSION_TOTAL_COUNT}} capacidades individuais distribuídas em {{PERMISSION_GROUP_COUNT}} grupos. São elas que **Adicionar permissão** oferece, para uma equipe ou uma chave de API, quando uma função concede mais do que você precisa.

{{PERMISSION_GRANULAR_TABLES}}

## Próximos passos

:::cards
- [Usuários, equipes e permissões](/docs/permissions/index): Como equipes, escopos, proprietários e bloqueios decidem o que cada pessoa pode fazer.
- [Referência da API](/docs/api-reference/api-reference): Usar as chaves de permissão com chaves de API.
- [Provedor Terraform](/docs/terraform/index): Gerenciar equipes e suas permissões como código.
:::
