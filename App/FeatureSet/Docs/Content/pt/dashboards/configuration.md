# Configuração e permissões

Esta página reúne as configurações e os controles de acesso que vale conhecer assim que você tem um painel que realmente quer manter.

## Propriedade

Os **owners** de um painel são os usuários e equipes que recebem permissões explícitas sobre ele (separadas da função no nível do projeto).

Em **Dashboard → Owners**:

- Adicione um **user owner** para conceder a uma pessoa específica acesso extra a este painel.
- Adicione um **team owner** para conceder o mesmo a todo membro de uma equipe.

Use propriedade quando a função de leitura no nível do projeto é ampla demais — por exemplo, um painel com detalhe sensível por cliente que só deveria ser visível pela equipe de customer-success.

## Rótulos

Rótulos são tags muitos-para-muitos para organizar painéis. Aplique-os em **Dashboard → Overview**.

Padrões comuns de rótulo:

- **Por equipe**: `team:platform`, `team:checkout`, `team:growth`.
- **Por ambiente**: `env:prod`, `env:staging`.
- **Por propósito**: `purpose:oncall`, `purpose:exec`, `purpose:investigation`.

A lista **Dashboards** permite filtrar por rótulo, que é a forma mais rápida de achar um painel em um projeto que já acumulou dezenas.

## Permissões

Painéis são recursos de primeira classe no controle de acesso baseado em função do OneUptime. As permissões relevantes:

| Permissão | Permite |
| --- | --- |
| `CreateDashboard` | Criar novos painéis no projeto. |
| `ReadDashboard` | Visualizar painéis (em modo privado). |
| `EditDashboard` | Modificar widgets, variáveis, configurações em um painel. |
| `DeleteDashboard` | Excluir um painel. |

Existem permissões equivalentes para as entidades de suporte: owners de painel (usuário / equipe) e domínios personalizados têm seus próprios pares create / read / edit / delete para que você possa conceder "gerenciar owners" sem conceder "editar o painel em si".

Atribua essas permissões em funções de projeto em **Project Settings → Teams & Roles**.

## Controle de acesso em modo público

O acesso em modo público (veja [Compartilhamento e painéis públicos](/docs/dashboards/sharing)) é governado por três camadas, em ordem:

1. Chave **Public Dashboard** — se desligada, a URL pública retorna 404.
2. **Master Password** — se definida, os visitantes precisam digitá-la antes do painel renderizar.
3. **IP Whitelist** (plano Scale) — se definida, requisições de IPs não listados recebem 403.

Um painel pode ter qualquer combinação. A configuração mais defensiva é "Public ligado, senha definida, lista de IPs permitidos ativa" — útil para portais de parceiros onde você quer os três.

## Retenção

Painéis em si não expiram. Os dados que eles exibem seguem a retenção de telemetria do projeto — métricas, logs e traces ficam consultáveis enquanto seu plano os retém. Um widget apontado para "últimos 90 dias" em um plano com 30 dias de retenção vai renderizar o que ainda estiver no armazenamento.

## Clonando um painel

Para duplicar um painel existente, abra-o e use a ação **Duplicate** na lista de painéis. A cópia inclui todo widget, variável e configuração, exceto a configuração de modo público (que sempre começa desligada — você decide se reativa na cópia).

Esse é o padrão certo quando você quer bifurcar um template ("nosso painel de plantão") em uma versão específica de serviço.

## Excluindo um painel

Em **Dashboard → Delete**. Isto é irreversível — a configuração do canvas e quaisquer associações de domínio personalizado são removidas. Os dados de telemetria não são afetados (eles vivem nos armazenamentos de métrica / log / trace, não no painel).

Se um painel é publicado publicamente com um domínio personalizado, a URL pública para de resolver no momento em que você o exclui. Retire o domínio antes se precisar reapontá-lo.

## Migração e backup

Para instalações auto-hospedadas: a configuração completa do painel (widgets, variáveis, configurações) vive na tabela `Dashboard` no Postgres. Um backup regular do banco é suficiente — não existe um formato de exportação de painel separado.

Para o OneUptime Cloud: backups regulares são feitos por você. Se quiser uma cópia local da configuração de um painel, use a [API do OneUptime](/docs/api-reference/api-reference) para ler o registro `Dashboard`.

## O que ler a seguir

- [Compartilhamento e painéis públicos](/docs/dashboards/sharing) — o lado público do controle de acesso.
- [Variáveis e filtros](/docs/dashboards/variables) — templating.
- [Widgets](/docs/dashboards/widgets) — o catálogo de widgets.
- [Visão geral dos painéis](/docs/dashboards/index) — o mapa conceitual.
