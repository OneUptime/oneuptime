# Recursos e grupos

Um recurso é uma linha da sua página de status — um monitor (ou um grupo de monitores) com um nome que os visitantes entendam, um status atual e, se você quiser, um número de disponibilidade e um gráfico de histórico. Um grupo é uma seção que guarda recursos, para que uma página com quarenta monitores se leia como "API", "Aplicativo web" e "Pipeline de dados" em vez de uma lista sem fim.

Você monta os dois em uma única tela. Abra uma página de status e escolha **Recursos** no menu lateral (o item aparece como **Monitores** em projetos que não têm grupos de monitores habilitados). Os grupos já tiveram uma tela própria; não têm mais, e a antiga URL `/groups` simplesmente redireciona para cá.

Acerte esta parte e o resto da página de status é decoração. É a partir dessas linhas que os visitantes decidem "é problema meu ou deles?", então dê a elas os nomes que os clientes usam para falar do seu produto — **Checkout API**, não `prod-checkout-lb-healthcheck-us-east-1`.

## A tela Recursos

A tela é dividida em duas. À esquerda fica um navegador que lista todos os grupos da página; à direita, o conteúdo do grupo que você selecionou.

- **O navegador de grupos (esquerda)** — uma árvore de grupos, com uma caixa de busca (**Search groups...**) acima dela e uma contagem corrente abaixo, no formato `3 groups · 12 resources`. Quando uma página tem mais grupos do que cabem, um botão **Show N more of M** revela o restante.
- **Top of page** — a primeira linha do navegador. Ela guarda os recursos que não estão em nenhum grupo, e sua dica diz exatamente o que isso significa: os visitantes veem esses primeiro, acima de todos os grupos. Se a página não tiver grupo nenhum, o painel da direita se chama **Todos os recursos**.
- **O painel de recursos (direita)** — nomeado com o grupo que você selecionou. Seu cabeçalho traz **Edit Group**, o botão principal **Adicionar monitor** e um menu **More actions**.

Dois botões ficam no cabeçalho do próprio cartão: **New Group** e um menu de três pontos com **Import groups from CSV** e **Atualizar**.

A descrição do cartão muda conforme o formato da sua página. Com grupos, ela diz que ali está tudo o que os visitantes veem e que você deve escolher um grupo à esquerda para editar o que há dentro dele. Sem grupos ainda, ela sugere criar um para dividir uma página mais longa em seções.

**Os estados vazios dizem o que fazer.** Um grupo vazio mostra **No monitors here yet**, com **Adicionar monitor**, **Add Multiple** e — só quando a página de status não tem grupo nenhum — **Create a Group**. Uma busca que não encontra nada mostra **No resources match your search**. Um navegador vazio explica que grupos dividem uma página de status mais longa em seções e que podem ser aninhados.

## Adicionar um monitor

Selecione o grupo em que o recurso deve entrar (ou **Top of page**, para uma linha sem grupo) e clique em **Adicionar monitor**. O modal se chama **Add a monitor to {group}** e tem dois passos: **Detalhes do monitor** e **Avançado**.

Em **Detalhes do monitor**:

- **Monitor** — o menu com os monitores do seu projeto, placeholder **Selecionar Monitor**. Obrigatório.
- **Nome de exibição** — obrigatório. É o texto que os visitantes leem, e ele é guardado separadamente do nome do próprio monitor, então você pode renomeá-lo aqui sem mexer no monitoramento.
- **Descrição** — markdown opcional, exibido abaixo da linha. Bom para uma frase explicando o que o serviço de fato faz.

Se o seu projeto tem grupos de monitores habilitados, um link sob o menu diz **Add a Monitor Group instead.** — clique nele e o menu **Monitor** é trocado por um menu **Monitor Grupo** (**Selecionar Grupo de Monitores**). O link então vira **Add a Monitor instead.**, para você voltar atrás. Use um grupo de monitores quando quiser que uma linha da página represente várias verificações reunidas.

### Adicionar vários de uma vez

**Add Multiple** (também **Add multiple monitors**, no menu **More actions**) abre **Add Multiple Monitors**. São os mesmos dois passos, só que o primeiro traz uma seleção múltipla de **Monitores** em vez de um menu único, e as opções de exibição escolhidas em **Avançado** valem para todos os monitores que você marcou. É a forma mais rápida de povoar uma página nova.

## Opções de exibição de um recurso

O passo **Avançado** é o mesmo no formulário de adição individual e no modal em massa. Tudo aqui vale por recurso — duas linhas do mesmo grupo podem estar configuradas de formas diferentes.

| Campo                                                    | Para que serve                                                                                            |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Dica de ferramenta** (`displayTooltip`)                           | Texto extra exibido ao lado do recurso na sua página de status. Use para delimitar escopo: "clientes dos EUA e da UE". |
| **Mostrar status atual do recurso** (`showCurrentStatus`)   | Ativado por padrão. Mostra o status ao vivo — operacional, degradado, offline — ao lado da linha.           |
| **Mostrar % de tempo de atividade** (`showUptimePercent`)                  | Desativado por padrão. Mostra um percentual de disponibilidade ao lado do recurso.                                    |
| **Selecionar Precisão de Disponibilidade** (`uptimePercentPrecision`)   | Só aparece depois que **Mostrar % de tempo de atividade** está ativado. Obrigatório, com uma casa decimal por padrão.                                    |
| **Mostrar gráfico de histórico de status** (`showStatusHistoryChart`) | Ativado por padrão. Mostra o gráfico de barras com o histórico diário de disponibilidade do recurso.                     |

**Nome de exibição** (`displayName`) e **Descrição** (`displayDescription`), do primeiro passo, também são só de exibição — nunca alteram o monitor em si.

## Percentuais de disponibilidade e gráficos de histórico

Tanto **Mostrar % de tempo de atividade** quanto **Mostrar gráfico de histórico de status** dependem de uma configuração que fica em outro lugar. A janela que eles cobrem é **Mostrar histórico de tempo de atividade (em dias)**, em **Páginas de status → sua página → Avançado → Configurações avançadas**, no cartão **Configurações do Histórico de Disponibilidade**. Ela aceita de 1 a 90 dias e o padrão é 90.

A sequência, então, é: ative as chaves recurso a recurso e depois defina a janela uma vez para a página inteira.

**A precisão é uma decisão sua.** O menu **Selecionar Precisão de Disponibilidade** oferece `99% (No Decimal)`, `99.9% (One Decimal)`, `99.99% (Two Decimal)` e `99.999% (Three Decimal)`. Mais casas decimais parecem precisas e convidam a discussões sobre a terceira; se você publica um SLA de três noves, use três e pare por aí.

Os grupos têm suas próprias cópias dessas chaves — veja abaixo — de modo que um grupo pode mostrar um percentual consolidado enquanto os monitores dentro dele ficam quietos, ou o contrário.

As cores das barras do gráfico de histórico, e quais status de monitor contam como "fora do ar", são definidos na tela de marca **Página de visão geral**, tratada em [Marca e domínios da página de status](/docs/status-pages/branding-and-domains).

## Grupos

Clique em **New Group** para abrir **Create New Status Page Group**. O formulário tem três passos: **Detalhes do Grupo**, **Layout** e **Avançado**.

**Detalhes do Grupo**:

- **Nome do Grupo** (`name`) — obrigatório. É o título de seção que os visitantes veem.
- **Descrição do Grupo** (`description`) — markdown opcional, exibido sob o título.
- **Parent Group** (`parentStatusPageGroupId`) — opcional. Deixe em **No parent group (top level)** para manter o grupo no nível mais alto.
- **Expandir na Página de status por padrão** (`isExpandedByDefault`) — se a seção começa aberta ou recolhida para os visitantes.

**Avançado** espelha, no nível do grupo, as chaves do recurso:

- **Mostrar status atual do grupo** (`showCurrentStatus`) — ativado por padrão. Mostra um status ao lado do título do grupo.
- **Mostrar % de tempo de atividade** (`showUptimePercent`) — desativado por padrão, com **Selecionar Precisão de Disponibilidade** aparecendo assim que ele é ativado.

A edição funciona do mesmo jeito: **Edit Group**, no cabeçalho do painel, ou **Edit group**, no menu da linha no navegador, abre **Edit Status Page Group** com um botão **Salvar alterações**.

O cabeçalho do painel mostra etiquetas das configurações que estão ativas — **Grid**, **Collapsed by default**, **Uptime %** — para você ver como um grupo está configurado sem abrir o formulário.

### Gerenciar um grupo

O menu de cada linha do navegador tem **Edit group**, **Move up**, **Move down**, **Mostrar ID** e **Excluir grupo**. O menu **More actions** do painel traz os equivalentes mais explícitos — **Edit this group**, **Add a sub group**, **Move group up**, **Move group down**, **Show group ID**, **Atualizar** e **Delete this group**. Um grupo salvo sem nome aparece como **Untitled group**, o que é um bom sinal de que você queria ter digitado alguma coisa.

## Aninhar grupos

Grupos podem ser aninhados: defina **Parent Group** no filho ou use a ação **Add a sub group inside this group** do navegador. O próprio texto de ajuda do formulário descreve o formato para o qual isso foi feito — algo como Unidades corporativas › Região › Mercado — e observa que cada nível mostra o status e a disponibilidade consolidados de tudo o que está abaixo dele.

Quando um grupo tem filhos, o painel de recursos mostra uma fileira de etiquetas **Sub groups** que leva direto a cada filho, para você percorrer a hierarquia sem voltar ao navegador.

O aninhamento compensa em páginas grandes: um provedor de hospedagem com regiões dentro de produtos, ou um varejista com mercados dentro de unidades de negócio. Em uma página com doze monitores, um único nível plano é mais amigável.

## Layout em lista ou em grade

O passo **Layout** define o **Modo de visualização** (`viewMode`) do grupo, e isso muda como o grupo é renderizado publicamente.

| Se você quer…                                                     | Escolha                   |
| ------------------------------------------------------------------- | ---------------------- |
| Mostrar uma lista vertical simples de serviços, um por linha                 | **List** (o padrão) |
| Mostrar o mesmo serviço em várias regiões ou tenants, como uma matriz | **Grid**               |

Escolha **Grid** e mais quatro campos aparecem:

- **Rótulo do eixo de linhas** — o nome da dimensão das linhas, placeholder `Service`.
- **Valores do eixo de linhas** — as linhas em si, adicionadas uma a uma com **Add Row** (placeholder `e.g. Auth`).
- **Rótulo do eixo da coluna** — a dimensão das colunas, placeholder `Region`.
- **Valores do eixo da coluna** — adicionados com **Add Column** (placeholder `e.g. US-East`).

Cada monitor de um grupo em grade é então colocado em uma célula, de modo que o modal em massa pede a linha e a coluna junto com os monitores, usando os seus próprios rótulos de eixo.

**Configure os eixos antes de adicionar monitores.** Um grupo em grade sem linhas nem colunas mostra um aviso âmbar dizendo que não há onde colocar um monitor enquanto os eixos não existirem, com um botão **Set up the grid** — e o botão **Adicionar monitor** fica indisponível até você fazer isso.

## Ordenar o que os visitantes veem

A ordem é explícita, não alfabética, e é definida em três lugares:

- **Recursos dentro de um grupo** — arraste uma linha. O painel diz isso: **Drag a row to change the order visitors see**.
- **Grupos entre si** — **Move up** / **Move down** no menu da linha do navegador, ou **Move group up** / **Move group down** no menu do painel.
- **Recursos sem grupo** — eles ficam em **Top of page** e sempre aparecem acima de todos os grupos, então coloque ali a única coisa que todo mundo vai conferir primeiro.

**Dois casos em que arrastar não funciona.** Filtrar o painel pela caixa **Search in {group}...** desativa a reordenação — o painel avisa `N of M shown · drag to reorder is off while filtering`, então limpe a busca antes. E grupos em grade nunca aceitam ordenação por arrasto, porque a posição vem dos eixos de linha e coluna.

Coloque no topo o serviço sobre o qual mais perguntam. Quem chega à página durante uma queda normalmente para de ler depois da primeira tela.

## Importar grupos de um CSV

Montar uma hierarquia profunda à mão é tedioso. O menu de três pontos no cabeçalho do cartão tem **Import groups from CSV**, que abre o modal **Import Groups from CSV**.

O fluxo é: **Download CSV Template** para obter o `status-page-groups-template.csv`, preencher, **Choose CSV File** e então **Preview Import** para conferir o que será criado antes de qualquer coisa ser gravada. O resultado se divide entre **Groups Imported** e **Some Groups Could Not Be Imported**, para que uma linha ruim não desapareça em silêncio.

Só `name` é obrigatório. As colunas aceitas são:

| Coluna                   | O que define                                         |
| ------------------------ | ---------------------------------------------------- |
| `name`                   | O nome do grupo. Obrigatório.                            |
| `parentName`             | O nome do grupo dentro do qual este se aninha.         |
| `description`            | A descrição do grupo.                                 |
| `isExpandedByDefault`    | Se a seção começa aberta para os visitantes.        |
| `showCurrentStatus`      | Se um status aparece ao lado do título do grupo.     |
| `showUptimePercent`      | Se um percentual de disponibilidade aparece ao lado do grupo. |
| `uptimePercentPrecision` | Quantas casas decimais esse percentual usa.        |
| `viewMode`               | `List` ou `Grid`.                                    |
| `rowAxisLabel`           | Nome da dimensão das linhas em um grupo em grade.                 |
| `rowAxisValues`          | Os valores das linhas em um grupo em grade.                     |
| `columnAxisLabel`        | Nome da dimensão das colunas em um grupo em grade.              |
| `columnAxisValues`       | Os valores das colunas em um grupo em grade.                  |

A importação cria grupos, não recursos — adicione os monitores depois, com **Adicionar monitor** ou **Add Multiple**.

## Onde ler a seguir

- [Visão geral das páginas de status](/docs/status-pages/index) — o que é uma página de status e como as peças se encaixam.
- [Marca e domínios da página de status](/docs/status-pages/branding-and-domains) — logotipo, favicon, cores do gráfico e como colocar a página no seu próprio domínio.
- [Assinantes e comunicados](/docs/status-pages/subscribers) — quem é avisado quando esses recursos mudam.
- [API pública](/docs/status-pages/public-api) — ler os dados da página de status de forma programática.
- [Estados e severidades de incidentes](/docs/incidents/states-and-severities) — o que faz um incidente aparecer na página e o que o faz sumir dela.
