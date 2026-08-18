# Recursos e grupos

Um recurso é uma linha na sua página de status — um monitor (ou um grupo de monitores) com um nome que os visitantes conseguem entender, um status atual e, opcionalmente, um número de disponibilidade e um gráfico de histórico. Um grupo é uma seção que contém recursos, para que uma página com quarenta monitores se leia como "API", "Aplicativo web" e "Pipeline de dados" em vez de uma lista sem fim.

Você constrói os dois em uma única tela. Abra uma página de status e escolha **Recursos** no menu lateral (o item diz **Monitores** em projetos que não têm grupos de monitores habilitados). Grupos antes ficavam em sua própria página; não ficam mais, e a antiga URL `/groups` simplesmente redireciona para cá.

Acerte esta parte e o resto da página de status é decoração. Os visitantes julgam "é comigo ou é com eles?" a partir dessas linhas, então nomeie-as do jeito que os clientes falam do seu produto — **Checkout API**, não `prod-checkout-lb-healthcheck-us-east-1`.

## A tela Recursos

A tela é dividida em duas. À esquerda há um navegador listando todo grupo da página; à direita está o conteúdo do grupo que você selecionou.

- **O navegador de grupos (esquerda)** — uma árvore de grupos, com uma caixa de busca (**Search groups...**) acima dela e uma contagem corrente abaixo, como `3 groups · 12 resources`. Quando uma página tem mais grupos do que cabem, um botão **Show N more of M** revela o resto.
- **Top of page** — a primeira linha no navegador. Ela contém recursos que não estão em nenhum grupo, e sua dica diz exatamente o que isso significa: os visitantes veem estes primeiro, acima de todo grupo. Se a página não tiver nenhum grupo, o painel direito é intitulado **Todos os recursos**.
- **O painel de recursos (direita)** — intitulado com o grupo que você selecionou. Seu cabeçalho traz **Edit Group**, o botão principal **Adicionar monitor** e um menu de estouro **More actions**.

Dois botões ficam no próprio cabeçalho do cartão: **New Group**, e um menu de três pontos contendo **Import groups from CSV** e **Atualizar**.

A descrição do cartão muda com o formato da sua página. Com grupos, ela diz que isto é tudo o que os visitantes veem e para escolher um grupo à esquerda para editar o que há nele. Sem grupos ainda, ela sugere criar um para dividir uma página mais longa em seções.

**Estados vazios dizem o que fazer.** Um grupo vazio mostra **No monitors here yet** com **Adicionar monitor**, **Add Multiple** e — apenas quando a página de status não tem nenhum grupo — **Create a Group**. Uma busca que não encontra nada mostra **No resources match your search**. Um navegador vazio diz que grupos dividem uma página de status mais longa em seções e que eles podem ser aninhados.

## Adicionar um monitor

Selecione o grupo em que você quer que o recurso aterrisse (ou **Top of page** para uma linha sem grupo), depois clique em **Adicionar monitor**. O modal é intitulado **Add a monitor to {group}** e tem duas etapas: **Detalhes do monitor** e **Avançado**.

Em **Detalhes do monitor**:

- **Monitor** — o menu suspenso de monitores do seu projeto, placeholder **Selecionar Monitor**. Obrigatório.
- **Nome de exibição** — obrigatório. Este é o texto que os visitantes leem, e ele é armazenado separadamente do nome do próprio monitor, então você pode renomeá-lo aqui sem tocar no monitoramento.
- **Descrição** — markdown opcional exibido sob a linha. Bom para uma frase explicando o que o serviço de fato faz.

Se o seu projeto tem grupos de monitores habilitados, um link sob o menu suspenso diz **Add a Monitor Group instead.** — clique nele e o menu **Monitor** é trocado por um menu **Monitor Grupo** (**Selecionar Grupo de Monitores**). O link então vira **Add a Monitor instead.** para você poder voltar. Use um grupo de monitores quando quiser que uma linha na página represente várias verificações consolidadas.

### Adicionar vários de uma vez

**Add Multiple** (também **Add multiple monitors** no menu **More actions**) abre **Add Multiple Monitors**. Tem as mesmas duas etapas, mas a primeira é uma seleção múltipla **Monitores** em vez de um menu único, e as opções de exibição que você escolhe em **Avançado** se aplicam a todo monitor selecionado. Esta é a maneira mais rápida de popular uma página nova.

## Opções de exibição em um recurso

A etapa **Avançado** é a mesma no formulário de adição individual e no modal em massa. Tudo aqui é por recurso — duas linhas no mesmo grupo podem ser configuradas de forma diferente.

| Campo                                                             | Finalidade                                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Dica de ferramenta** (`displayTooltip`)                         | Texto extra exibido ao lado do recurso na sua página de status. Use para escopo: "Clientes EUA e UE". |
| **Mostrar status atual do recurso** (`showCurrentStatus`)         | Ativado por padrão. Mostra o status ao vivo — operacional, degradado, offline — ao lado da linha.    |
| **Mostrar % de tempo de atividade** (`showUptimePercent`)         | Desativado por padrão. Mostra um percentual de disponibilidade ao lado do recurso.                  |
| **Selecionar Precisão de Disponibilidade** (`uptimePercentPrecision`) | Só aparece depois que **Mostrar % de tempo de atividade** está ativado. Obrigatório, padrão de uma casa decimal. |
| **Mostrar gráfico de histórico de status** (`showStatusHistoryChart`) | Ativado por padrão. Mostra o gráfico de barras de histórico de disponibilidade dia a dia do recurso. |

**Nome de exibição** (`displayName`) e **Descrição** (`displayDescription`) da primeira etapa também são apenas de exibição — eles nunca mudam o próprio monitor.

## Percentuais de disponibilidade e gráficos de histórico

Tanto **Mostrar % de tempo de atividade** quanto **Mostrar gráfico de histórico de status** dependem de uma configuração que fica em outro lugar. A janela que eles cobrem é **Mostrar histórico de tempo de atividade (em dias)** em **Páginas de status → sua página → Avançado → Configurações avançadas**, no cartão **Configurações do Histórico de Disponibilidade**. Ela aceita de 1 a 90 dias e tem padrão 90.

Então a sequência é: ative as chaves por recurso, depois defina a janela uma vez para a página inteira.

**Precisão é uma questão de julgamento.** O menu **Selecionar Precisão de Disponibilidade** oferece `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` e `99.999% (Three Decimal)`. Mais casas decimais parecem precisas e convidam a discussões sobre a terceira; se você publica um SLA de três noves, iguale isso e nada mais.

Grupos têm suas próprias cópias dessas chaves — veja abaixo — então um grupo pode mostrar um percentual consolidado enquanto os monitores individuais dentro dele ficam quietos, ou o contrário.

As cores das barras do gráfico de histórico, e quais status de monitor contam como "fora do ar", são definidas na tela de marca **Página de visão geral**, coberta em [Marca e domínios da página de status](/docs/status-pages/branding-and-domains).

## Grupos

Clique em **New Group** para abrir **Create New Status Page Group**. O formulário tem três etapas: **Detalhes do Grupo**, **Layout** e **Avançado**.

**Detalhes do Grupo**:

- **Nome do Grupo** (`name`) — obrigatório. Este é o título de seção que os visitantes veem.
- **Descrição do Grupo** (`description`) — markdown opcional, exibido sob o título.
- **Parent Group** (`parentStatusPageGroupId`) — opcional. Deixe em **No parent group (top level)** para manter o grupo no nível superior.
- **Expandir na Página de status por padrão** (`isExpandedByDefault`) — se a seção começa aberta ou recolhida para os visitantes.

**Avançado** espelha as chaves de recurso no nível do grupo:

- **Mostrar status atual do grupo** (`showCurrentStatus`) — ativado por padrão. Mostra um status ao lado do título do grupo.
- **Mostrar % de tempo de atividade** (`showUptimePercent`) — desativado por padrão, com **Selecionar Precisão de Disponibilidade** aparecendo assim que é ativado.

A edição funciona da mesma forma: **Edit Group** no cabeçalho do painel, ou **Edit group** no menu de linha do navegador, abre **Edit Status Page Group** com um botão **Salvar alterações**.

O cabeçalho do painel mostra chips para as configurações que estão ativas — **Grid**, **Collapsed by default**, **Uptime %** — para você ver como um grupo está configurado sem abrir o formulário.

### Gerenciar um grupo

O menu por linha do navegador contém **Edit group**, **Move up**, **Move down**, **Mostrar ID** e **Excluir grupo**. O menu de estouro **More actions** do painel tem os equivalentes em forma longa — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Atualizar** e **Delete this group**. Um grupo salvo sem nome é exibido como **Untitled group**, o que é um bom sinal de que você queria digitar algo.

## Aninhar grupos

Grupos são aninháveis: defina **Parent Group** no filho, ou use a ação **Add a sub group inside this group** do navegador. O texto de ajuda do próprio formulário descreve o formato para o qual ele foi feito — algo como Unidades Corporativas › Região › Mercado — e observa que cada nível mostra o status e a disponibilidade consolidados de tudo abaixo dele.

Quando um grupo tem filhos, o painel de recursos mostra uma linha de chips **Sub groups** que leva direto a cada filho, para você percorrer a hierarquia sem voltar ao navegador.

O aninhamento se justifica em páginas grandes: um provedor de hospedagem com regiões dentro de produtos, ou um varejista com mercados dentro de unidades de negócio. Em uma página com doze monitores, um nível plano é mais amigável.

## Layout de lista versus layout de grade

A etapa **Layout** define o **Modo de visualização** (`viewMode`) do grupo, e isso muda como o grupo é renderizado publicamente.

| Se você quiser…                                                        | Escolha                 |
| ---------------------------------------------------------------------- | ----------------------- |
| Mostrar uma lista vertical simples de serviços, um por linha           | **List** (o padrão)     |
| Mostrar o mesmo serviço em várias regiões ou inquilinos como uma matriz| **Grid**                |

Escolha **Grid** e mais quatro campos aparecem:

- **Rótulo do eixo de linhas** — o nome da dimensão de linha, placeholder `Service`.
- **Valores do eixo de linhas** — as próprias linhas, adicionadas uma a uma com **Add Row** (placeholder `e.g. Auth`).
- **Rótulo do eixo da coluna** — a dimensão de coluna, placeholder `Region`.
- **Valores do eixo da coluna** — adicionados com **Add Column** (placeholder `e.g. US-East`).

Cada monitor em um grupo em grade é então colocado em uma célula, então o modal em massa pede a linha e a coluna junto com os monitores, usando os seus próprios rótulos de eixo.

**Configure os eixos antes de adicionar monitores.** Um grupo em grade sem linhas ou colunas mostra um aviso âmbar dizendo que não há onde colocar um monitor até que os eixos existam, com um botão **Set up the grid** — e o botão **Adicionar monitor** fica retirado até você fazer isso.

## Ordenar o que os visitantes veem

A ordem é explícita, não alfabética, e é definida em três lugares:

- **Recursos dentro de um grupo** — arraste uma linha. O painel diz isso: **Drag a row to change the order visitors see**.
- **Grupos entre si** — **Move up** / **Move down** no menu de linha do navegador, ou **Move group up** / **Move group down** no menu de estouro do painel.
- **Recursos sem grupo** — eles ficam em **Top of page** e sempre são renderizados acima de todo grupo, então coloque ali a única coisa que todo mundo verifica primeiro.

**Dois casos em que arrastar não funciona.** Filtrar o painel com a caixa **Search in {group}...** desabilita a reordenação — o painel avisa `N of M shown · drag to reorder is off while filtering`, então limpe a busca primeiro. E grupos em grade nunca suportam ordenação por arrasto, porque a posição vem dos eixos de linha e coluna.

Coloque no topo o serviço sobre o qual mais perguntam. Visitantes que vieram à página durante uma interrupção normalmente param de ler depois da primeira tela.

## Importar grupos de um CSV

Construir uma hierarquia profunda à mão é tedioso. O menu de três pontos no cabeçalho do cartão tem **Import groups from CSV**, que abre o modal **Import Groups from CSV**.

O fluxo é: **Download CSV Template** para obter `status-page-groups-template.csv`, preencha, **Choose CSV File**, depois **Preview Import** para conferir o que será criado antes que qualquer coisa seja gravada. O resultado se divide em **Groups Imported** e **Some Groups Could Not Be Imported**, então uma linha ruim não some silenciosamente.

Apenas `name` é obrigatório. As colunas aceitas são:

| Coluna                   | O que define                                                    |
| ------------------------ | --------------------------------------------------------------- |
| `name`                   | O nome do grupo. Obrigatório.                                   |
| `parentName`             | O nome do grupo dentro do qual este se aninha.                  |
| `description`            | A descrição do grupo.                                           |
| `isExpandedByDefault`    | Se a seção começa aberta para os visitantes.                    |
| `showCurrentStatus`      | Se um status aparece ao lado do título do grupo.                |
| `showUptimePercent`      | Se um percentual de disponibilidade aparece ao lado do grupo.   |
| `uptimePercentPrecision` | Quantas casas decimais esse percentual usa.                     |
| `viewMode`               | `List` ou `Grid`.                                               |
| `rowAxisLabel`           | Nome da dimensão de linha para um grupo em grade.               |
| `rowAxisValues`          | Os valores de linha para um grupo em grade.                     |
| `columnAxisLabel`        | Nome da dimensão de coluna para um grupo em grade.              |
| `columnAxisValues`       | Os valores de coluna para um grupo em grade.                    |

A importação cria grupos, não recursos — adicione monitores depois com **Adicionar monitor** ou **Add Multiple**.

## Onde ler a seguir

- [Visão geral das páginas de status](/docs/status-pages/index) — o que é uma página de status e como as peças se encaixam.
- [Marca e domínios da página de status](/docs/status-pages/branding-and-domains) — logotipo, favicon, cores de gráfico e colocar a página no seu próprio domínio.
- [Assinantes e comunicados](/docs/status-pages/subscribers) — quem é avisado quando esses recursos mudam.
- [API pública](/docs/status-pages/public-api) — ler dados da página de status programaticamente.
- [Estados e severidades de incidentes](/docs/incidents/states-and-severities) — o que faz um incidente aparecer na página e desaparecer dela.
