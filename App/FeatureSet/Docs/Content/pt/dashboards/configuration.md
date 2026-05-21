# Configuração e Permissões

Esta página cobre as configurações e controles de acesso que vale conhecer assim que você tem um painel que pretende manter.

## Donos

Os **donos** de um painel são usuários e equipes a quem você concedeu acesso explícito (além do papel deles em todo o projeto).

Em **Painel → Donos**:

- Adicione um **dono usuário** para dar a uma pessoa acesso extra a este painel.
- Adicione um **dono equipe** para dar o mesmo acesso a cada membro de uma equipe.

Use donos quando o papel de leitura geral do projeto é amplo demais — por exemplo, um painel com detalhes específicos de um cliente que só deve ser visível à equipe de sucesso do cliente.

## Etiquetas

Etiquetas são tags para organizar painéis. Aplique-as em **Painel → Visão Geral**.

Padrões comuns:

- **Por equipe**: `team:platform`, `team:checkout`, `team:growth`.
- **Por ambiente**: `env:prod`, `env:staging`.
- **Por finalidade**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

A lista de **Painéis** permite filtrar por etiqueta, que é a forma mais rápida de encontrar um painel em um projeto que acumulou muitos deles.

## Permissões

Painéis funcionam com o controle de acesso baseado em papéis do seu projeto. As permissões relevantes:

| Permissão | O que permite |
| --- | --- |
| **Criar Painel** | Criar novos painéis. |
| **Ler Painel** | Visualizar painéis (em modo privado). |
| **Editar Painel** | Alterar widgets, variáveis e configurações. |
| **Excluir Painel** | Excluir um painel. |

Existem permissões correspondentes para donos de painel e domínios personalizados, então você pode conceder "gerenciar donos" sem conceder "editar o painel".

Atribua-as aos papéis do projeto em **Configurações do Projeto → Equipes e Papéis**.

## Acesso para painéis públicos

Quando você torna um painel público (veja [Compartilhamento e Painéis Públicos](/docs/dashboards/sharing)), três configurações controlam quem pode vê-lo:

1. Interruptor **Painel Público** — se desligado, a URL pública retorna 404.
2. **Senha Mestra** — se definida, os visitantes digitam uma senha antes do painel aparecer.
3. **Lista de IPs Permitidos** (plano Scale) — se definida, requisições de outros IPs são rejeitadas.

Você pode combinar quaisquer dessas. A combinação mais bloqueada é "Público ligado, senha definida, lista de IPs ativa" — útil para portais de parceiros onde você quer todas as três camadas.

## Retenção de dados

Os próprios painéis não expiram. Os dados que eles mostram seguem as configurações de retenção do seu projeto — métricas, logs e traces são consultáveis pelo tempo que seu plano os mantém. Um widget apontado para "os últimos 90 dias" em um plano que mantém 30 dias mostrará o que ainda estiver armazenado.

## Duplicando um painel

Para copiar um painel existente, abra a lista de painéis e escolha **Duplicar**. A cópia inclui todos os widgets, variáveis e configurações, exceto o compartilhamento público — esse sempre começa desligado para que você decida se quer ligá-lo novamente.

Essa é a abordagem certa quando você quer derivar um template (como "nosso painel de plantão") em uma cópia específica para um serviço.

## Excluindo um painel

Em **Painel → Excluir**. Isso não pode ser desfeito — o layout do painel e quaisquer domínios personalizados anexados a ele são removidos. Seus dados de telemetria não são afetados.

Se o painel é público em um domínio personalizado, a URL para de resolver assim que você o exclui. Mova o domínio para um painel diferente primeiro se quiser manter a URL funcionando.

## Backup

Se você auto-hospeda o OneUptime, um backup regular do banco de dados é suficiente — a configuração do painel é armazenada junto com o restante do seu projeto.

No OneUptime Cloud, os backups são feitos para você. Se quiser sua própria cópia, você pode ler o painel via a [API do OneUptime](/docs/api-reference/api-reference).

## O que ler em seguida

- [Compartilhamento e Painéis Públicos](/docs/dashboards/sharing) — controles de modo público.
- [Variáveis e Filtros](/docs/dashboards/variables) — templating.
- [Widgets](/docs/dashboards/widgets) — o catálogo de widgets.
- [Visão geral dos painéis](/docs/dashboards/index) — o panorama geral.
