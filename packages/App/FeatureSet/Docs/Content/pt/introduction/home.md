# Página inicial e atalhos

O Início é a primeira página que você vê em um projeto. Ele mostra num relance se algo precisa de você agora, e guia um projeto novo pela primeira configuração. Esta página explica o que o Início mostra, como encontrar qualquer produto, página ou ação no painel, e os atalhos de teclado que poupam idas e vindas pelos menus.

:::cards
- [O que o Início mostra](#o-que-o-início-mostra): Se algo está errado, o que precisa de você, o que o projeto contém e todos os produtos.
- [Encontrar o caminho](#encontrar-o-caminho): O menu Produtos e as barras no topo de cada página.
- [Pesquisar](#pesquisar-uma-página-uma-configuração-ou-uma-ação): Encontrar qualquer página, configuração ou ação digitando o nome.
- [Atalhos de teclado](#atalhos-de-teclado): Ir ao Início, aos Monitores ou aos Incidentes com duas teclas.
:::

## O que o Início mostra

Abra **Início** na barra do topo, ou pressione `g` e depois `h` de qualquer lugar. O Início é a visão geral do seu projeto. De cima para baixo, ele mostra:

1. Uma caixa de pesquisa, com **Declarar incidente** e **Criar** ao lado.
2. Uma linha que diz se algo está errado, acima de cinco números que contam o que precisa de atenção.
3. **Boas-vindas ao OneUptime 👋**, uma lista para um projeto novo, até que esteja concluída.
4. **Requer atenção**, cada problema aberto neste momento, pelo nome.
5. **Seu projeto**, do que o projeto é feito, e **Próximas manutenções** quando houver alguma programada.
6. **Explore o OneUptime**, todos os produtos, uma categoria por vez.

### Pesquisar e criar

A caixa de pesquisa abre a pesquisa, assim como `Mod` + `K`: digite o nome de qualquer página, monitor, incidente, alerta, página de status ou política de plantão. Veja [Pesquisar](#pesquisar-uma-página-uma-configuração-ou-uma-ação). **Declarar incidente** abre o formulário que declara um incidente. **Criar** oferece **Criar monitor**, **Agendar manutenção** e **Criar anúncio**. Cada um só aparece para quem tem permissão para usá-lo.

### A manchete

A linha do topo nomeia o que há de mais urgente em aberto, numa cor correspondente:

| Quando | O Início diz |
| --- | --- |
| Um incidente está aberto | Quantos incidentes estão ativos, em vermelho |
| Nenhum incidente está aberto, mas há alertas abertos, monitores que não estão operacionais ou SLOs em risco | Quantos problemas precisam de atenção, em âmbar |
| Nada está errado e há manutenção em andamento | Quantos eventos de manutenção estão em andamento |
| Há monitores em execução e nada está aberto | **Todos os sistemas estão operacionais** |
| O projeto ainda não tem monitores | **Nada está sendo monitorado ainda** |

Ao lado, o Início diz quando leu o projeto pela última vez, e **Atualizar** o lê de novo. Quando você volta a uma aba do Início depois de um minuto ou mais, ele se atualiza sozinho.

Enquanto nada está sendo monitorado, a linha termina com o botão **Crie seu primeiro monitor**, que abre o formulário para criar um. Só quem tem permissão para criar monitores o vê.

### Os cinco números

Cada número conta algo, diz se isso precisa de você e abre a lista por trás dele.

| Número | O que conta | Quando o número é zero |
| --- | --- | --- |
| **Incidentes ativos** | Incidentes não resolvidos | **Tudo certo** |
| **Alertas ativos** | Alertas não resolvidos | **Tudo certo** |
| **Monitores não operacionais** | Monitores cujo status não é operacional. Monitores arquivados não entram. | **Todos operacionais** |
| **Manutenção em andamento** | Eventos de manutenção programada em andamento | **Nenhuma em andamento** |
| **SLOs em risco** | SLOs ativados que estão em risco ou esgotaram o orçamento de erro | **Orçamentos saudáveis** |

Um número acima de zero mostra **Requer atenção**, ou **Em andamento** e **Orçamento se esgotando** para manutenção e SLOs. Um projeto sem monitores vê **Nenhum monitor ainda**, e um sem SLOs vê **Nenhum SLO ainda**: um projeto vazio não é o mesmo que um projeto saudável. Esses dois abrem então as listas **Monitores** e **SLOs**, onde você cria um.

### A lista de boas-vindas

A lista guia você pelas quatro coisas de que um projeto precisa para ser útil. Cada etapa abre a página onde você a realiza, e se marca sozinha quando o projeto tem o que ela pede.

| Etapa | Concluída quando | Abre |
| --- | --- | --- |
| **Crie seu primeiro monitor** | O projeto tem um monitor. | O formulário **Criar monitor**, ou a lista **Monitores** para quem não pode criar monitores. |
| **Publique uma página de status** | O projeto tem uma página de status. | **Páginas de status** |
| **Convide sua equipe** | Alguém além de você está no projeto, ou foi convidado. | **Usuários** |
| **Configure uma política de plantão** | O projeto tem uma política de plantão. | **Plantão** |

Abaixo das etapas, **Como o OneUptime funciona** mostra os quatro produtos principais na ordem em que um problema passa por eles: **Monitores**, **Incidentes e alertas**, **Plantão** e **Páginas de status**. Clique em um para abri-lo.

```mermaid title="Quando a lista de boas-vindas some"
flowchart TB
    open["O Início abre"] --> dismissed{"Dispensada neste<br/>navegador?"}
    dismissed -->|"Não"| done{"As quatro etapas<br/>concluídas?"}
    dismissed -->|"Sim"| hidden["Sem lista"]
    done -->|"Sim"| hidden
    done -->|"Não"| shown["A lista, com as<br/>etapas restantes"]
```

A lista some quando as quatro etapas estão concluídas. Para escondê-la antes, clique em **Dispensar**. A dispensa vale para este navegador e este projeto; tudo o que as etapas abrem continua no menu **Produtos**.

### Requer atenção

**Requer atenção** lista, pelo nome, o que os números contam: os incidentes abertos, os alertas abertos, os monitores que não estão operacionais, os SLOs em risco e as manutenções em andamento, os mais urgentes primeiro. Cada linha mostra a severidade ou o status, diz quando um incidente ou alerta começou e quando a manutenção termina, e abre o registro. Cada tipo mostra até cinco, com **Mostrar todos** para o resto. Quando nada está aberto, diz **Nada precisa da sua atenção**.

### Seu projeto

**Seu projeto** conta os **Monitores**, as **Páginas de status**, as **Políticas de plantão**, os **SLOs**, os **Serviços**, os **Painéis** e os **Fluxos de trabalho** do projeto, sem contar os arquivados. Cada linha abre a sua lista. Quando o projeto não tem nenhum item de um tipo, a linha mostra **Configurar** em vez de um número.

**Próximas manutenções** lista as três próximas janelas de manutenção programada, a mais próxima primeiro. Não aparece quando não há nada programado.

### Explore o OneUptime

**Explore o OneUptime** mostra os produtos do menu **Produtos** uma categoria por vez, começando pelos essenciais. Cada produto diz para que serve e abre quando você clica nele.

### O menu lateral do Início

O Início não tem menu lateral: ele já mostra tudo o que o menu mostraria. As listas que ele abre compartilham um, que mostra cada lista com sua contagem e volta ao Início em **Visão geral**:

| Seção | Páginas |
| --- | --- |
| **Início** | **Visão geral** |
| **Incidentes** | **Incidentes ativos** e **Episódios ativos** |
| **Alertas** | **Alertas ativos** e **Episódios ativos** |
| **Monitores** | **Não operacional** |
| **Eventos programados** | **Em andamento** |

Um episódio agrupa incidentes ou alertas relacionados para você tratá-los como um só. Veja [Conceitos básicos](/docs/introduction/core-concepts#incidentes-e-alertas).

## Encontrar o caminho

Tudo no OneUptime fica em **Produtos**, na barra do topo. O menu lista seus grupos como as linhas de uma única lista, e sempre abre com o primeiro deles, os essenciais, expandido: Monitores, Incidentes, Alertas, Plantão, Páginas de status, Manutenção programada e SLOs. Cada um dos outros grupos (Observabilidade, AI, Código, Recursos, Infraestrutura, Painéis e automação e Configurações) fica recolhido em uma linha da mesma lista. Cada linha nomeia os produtos do grupo e diz quantos são. Clique em uma linha para expandi-la ou recolhê-la, ou chegue até ela com as setas e pressione **Enter**.

- **A pesquisa encontra tudo.** Digite na caixa de pesquisa do menu para encontrar qualquer produto pelo nome, pelo que ele faz ou por uma palavra conhecida como `k8s` ou `RUM`. A pesquisa procura também dentro dos grupos recolhidos.
- **Você começa onde está.** O grupo da página em que você está se expande sozinho, e os produtos que você abriu recentemente aparecem no topo.
- **Suas escolhas ficam.** O menu lembra, no seu navegador, quais dos outros grupos você expandiu ou recolheu. Os essenciais voltam a ficar expandidos cada vez que você abre o menu, mesmo que você os tenha recolhido.
- **No celular**, o botão do menu lista os produtos do mesmo jeito: os essenciais expandidos no topo, e cada um dos outros grupos como uma linha que abre com um toque.

### As barras do topo

Duas barras atravessam o topo de cada página.

| Onde | O que há |
| --- | --- |
| Canto superior esquerdo | O seletor de projetos: trocar para outro dos seus projetos, ou criar um novo. |
| Canto superior direito | **Pesquisar** e **Pergunte à IA**, o sino de notificações com o que precisa de você agora (incidentes e alertas ativos, as políticas de plantão em que você está de turno, convites pendentes), **Ajuda**, e sua foto, que abre o menu da sua [conta](/docs/introduction/your-account). |
| Abaixo delas | **Início** e **Produtos** à esquerda, **Configurações do usuário** à direita: como o OneUptime contata você neste projeto. |

**Ajuda** abre esta documentação (**Documentação**) e a lista **Keyboard shortcuts**, e oferece suporte por e-mail e no Slack. Em uma tela estreita, como a de um celular, **Pesquisar**, **Pergunte à IA** e **Ajuda** saem para ganhar espaço; o sino e sua foto ficam.

## Pesquisar uma página, uma configuração ou uma ação

Pressione **Cmd+K** (Mac) ou **Ctrl+K** (Windows e Linux), ou clique no ícone de pesquisa na barra do topo, e comece a digitar. A pesquisa encontra:

- **Todas as páginas dos menus**, pelo nome que o menu dá a elas: Chaves de API, Zona de perigo, Agendamentos de plantão, Severidade do incidente, seus próprios Métodos de notificação. Cada resultado diz onde fica, por exemplo *Configurações do projeto › Avançado*, para que páginas com o mesmo nome (Campos personalizados em Incidentes, Alertas e Monitores) sejam fáceis de distinguir.
- **Ações**, pelo que você quer fazer: Declarar incidente, Criar monitor ou Delete Project, que abre a Zona de perigo. Uma ação que muda algo só é oferecida a quem tem permissão para fazê-la.
- **Seus monitores, incidentes, alertas, páginas de status e políticas de plantão**, pelo nome.

A pesquisa lê o que você digita do jeito que você quer dizer:

- Maiúsculas, acentos, espaços e hífens não importam: *on-call*, *on call* e *oncall* encontram as mesmas páginas, e as palavras podem vir em qualquer ordem.
- Ela conhece outras palavras para muitas páginas, em inglês: *pager* ou *escalation* para Políticas de plantão, *rota* para Agendamentos de plantão, *2fa* para a autenticação em dois fatores, *delete project* para a Zona de perigo.
- Acrescente o nome do produto para restringir uma pesquisa: *incident custom fields* encontra a página Campos personalizados de Incidentes.
- Um pequeno erro de digitação, como *incidnet*, ainda encontra o que você queria quando nada corresponde do jeito que foi digitado.

Com a caixa de pesquisa vazia, a pesquisa lista as páginas que você abriu recentemente, as ações e os produtos.

## Atalhos de teclado

Pressione `?` em qualquer lugar do painel para ver todos os atalhos, ou abra **Ajuda** e escolha **Keyboard shortcuts**. No Mac, `Mod` é a tecla Command; no Windows e no Linux, é Ctrl.

| Teclas | O que fazem |
| --- | --- |
| `Mod` + `K` | Abrir a paleta de comandos: pesquisar qualquer página, configuração ou ação. |
| `Mod` + `I` | Perguntar à IA sobre o que você está vendo. |
| `/` | Pesquisar na lista desta página. |
| `?` | Mostrar os atalhos de teclado. |
| `Esc` | Fechar uma caixa de diálogo ou um painel. |

### Ir a um produto

Pressione `g` e depois uma letra para ir direto a um produto. Pressione a letra em até um segundo e meio depois de `g`.

| Teclas | Vai para |
| --- | --- |
| `g` depois `h` | Início |
| `g` depois `m` | Monitores |
| `g` depois `i` | Incidentes |
| `g` depois `a` | Alertas |
| `g` depois `o` | Plantão |
| `g` depois `s` | Páginas de status |
| `g` depois `e` | Manutenção programada |
| `g` depois `d` | Painéis |
| `g` depois `l` | Registros |
| `g` depois `t` | Traços |

Os atalhos não atrapalham. `?`, `/` e `g` não fazem nada enquanto você digita em um campo, e nada tira você da página enquanto uma caixa de diálogo está aberta, então uma tecla sem querer não faz você perder um formulário preenchido pela metade. Qualquer outro produto está a uma pesquisa de distância com `Mod` + `K`.

## Próximos passos

:::cards
- [Início rápido](/docs/introduction/quickstart): Seguir a lista de boas-vindas, etapa por etapa.
- [Sua conta](/docs/introduction/your-account): Seu perfil, a segurança do seu login, o idioma e o tema.
- [Pergunte à IA](/docs/ai/ask-ai): O que a IA pode responder e fazer por você.
- [Conceitos básicos](/docs/introduction/core-concepts): O que são monitores, incidentes, alertas e plantão.
:::
