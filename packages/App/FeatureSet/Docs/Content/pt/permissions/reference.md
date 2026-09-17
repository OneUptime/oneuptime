# Referência de permissões

Todas as permissões que o OneUptime pode conceder, agrupadas exatamente como o seletor de permissões do painel as agrupa.

Esta página é gerada a partir do código-fonte do OneUptime no momento da requisição, a partir da mesma lista usada pelo painel, pela API e pelo provedor Terraform. Ela não pode divergir do produto e reflete a versão que você está executando.

Se você procura como as peças se encaixam — equipes, escopos, proprietários, bloqueios — comece por [Usuários, equipes e permissões](/docs/permissions/index).

A coluna **Chave da permissão** traz o valor a usar com a [API](/docs/api-reference/api-reference), a [CLI](/docs/cli/index) e o [provedor Terraform](/docs/terraform/index). Os títulos são os que você vê no painel.

## Funções

{{PERMISSION_ROLE_COUNT}} funções, cada uma agrupando uma área do produto no nível Admin, Member ou Viewer. São elas que o seletor **Função** oferece quando você adiciona uma permissão a uma equipe.

A coluna **Escopo** informa se a função pode ser restringida ao ser concedida. `Todos, Próprios ou Rótulos` significa que você pode escolher; `Apenas em todo o projeto` significa que a função sempre vale para o projeto inteiro.

{{PERMISSION_ROLE_TABLES}}

## Permissões granulares

{{PERMISSION_TOTAL_COUNT}} capacidades individuais distribuídas em {{PERMISSION_GROUP_COUNT}} grupos. São as que o seletor **Granular** oferece e as que você atribui a chaves de API.

A coluna **Restringir por rótulos** informa se uma concessão desta permissão pode ser limitada a recursos que carregam determinados rótulos.

{{PERMISSION_GRANULAR_TABLES}}
