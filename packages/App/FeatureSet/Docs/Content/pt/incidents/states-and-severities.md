# Estados e severidades

Todo incidente carrega duas classificações: um **estado**, que diz em que ponto da sua resposta ele está, e uma **severidade**, que diz o quanto ele dói. No painel os dois se parecem — ambos aparecem como etiquetas coloridas na lista de incidentes, ambos são listas com escopo de projeto que você pode renomear e recolorir. Mas cumprem papéis bem diferentes.

Estados dirigem comportamento. Três flags booleanas nas linhas de estado decidem quais incidentes contam como ativos, quais botões aparecem no cabeçalho do incidente, quando o cronômetro do SLA para e quando o incidente sai da sua página de status. Severidades não dirigem nada sozinhas — são rótulos que descrevem impacto e sobre os quais outras regras podem casar.

Ambas as listas são criadas junto com o projeto, e ambas são editadas em **Incidentes → Configurações**. Essa seção do menu lateral de Incidentes vem recolhida por padrão, então expanda **Configurações** antes de sair procurando.

## Estados carregam comportamento, severidades carregam significado

O modelo `IncidentState` tem `name`, `description`, `color` e `order`, mais três booleanos: `isCreatedState`, `isAcknowledgedState` e `isResolvedState`. Tudo o que o produto faz com estados se apoia nesses booleanos e em `order` — nunca no nome do estado. É por isso que você pode renomear **Resolvido** para "Fechado" e nada quebra: a flag viaja com a linha.

O modelo `IncidentSeverity` tem `name`, `description`, `color` e `order`, e nada mais. Não há flags. Nada no OneUptime trata **Critical Incident** de forma diferente de **Minor Incident** por conta própria — a severidade só importa onde você apontar algo para ela, como o critério de correspondência **Incidente Severidades** em uma regra de plantão.

Algumas regras rápidas:

- **Escolha a severidade para comunicar impacto** — ela aparece na lista de incidentes, na **Visão geral** do incidente, e é um campo obrigatório quando você declara um incidente.
- **Escolha os estados para modelar o seu processo** — os passos de resposta pelos quais você de fato passa, na ordem em que passa.
- **Não codifique urgência nos estados** — um estado chamado "Crítico" não acionaria ninguém. Quem faz isso é a severidade somada a uma regra de plantão.

## Os estados iniciais

Três estados são criados junto com o projeto, nesta ordem. A semeadura é idempotente — um estado só é adicionado quando ainda não existe outro com aquele nome.

| Estado           | `order` | Flag                  | Cor       | O que significa                                     |
| ---------------- | ------- | --------------------- | --------- | --------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | O estado em que novos incidentes aterrissam.        |
| **Confirmado**   | `2`     | `isAcknowledgedState` | `#ffbf53` | Alguém assumiu o incidente.                         |
| **Resolvido**    | `3`     | `isResolvedState`     | `#2ab57d` | O incidente acabou e deixa de contar como ativo.    |

Repare no nome: o primeiro estado é **Identified**, embora várias descrições dentro do produto ainda o chamem de estado de "criação". Quando um documento ou uma dica diz "estado de criação", isso quer dizer o estado que carrega `isCreatedState` — em um projeto novo, esse é **Identified**.

## O que cada flag de estado realmente faz

| Flag                  | Para que serve                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | O estado que um incidente recebe quando ninguém escolheu um. Se nenhum estado do projeto carregar essa flag, criar um incidente falha com um erro pedindo que você adicione um estado de criação nas configurações. |
| `isAcknowledgedState` | Alimenta o botão **Acknowledge** e o bloco de estatística "<nome do estado> em" na **Visão geral** do incidente. Numa mudança de estado para este estado, o SLA do incidente é marcado como respondido. |
| `isResolvedState`     | Alimenta o botão **Resolver** e o bloco de estatística de resolvido, define a lista **Incidentes ativos**, e é o que remove o incidente da seção ativa de uma página de status. Marca o SLA como resolvido. |

Espera-se que apenas um estado por projeto carregue cada flag — as buscas trazem uma única linha. Os três estados com flag podem ser renomeados, recoloridos e reordenados, mas a página de configurações se recusa a excluí-los e mostra um erro nomeando os estados de criação, confirmação e resolução.

Como a interface lê os nomes dos estados dinamicamente, renomear um estado muda o que você vê em todo lugar — os blocos de estatística, os títulos dos modais de confirmação e a etiqueta na lista de incidentes seguem todos o nome que você deu à linha.

## Adicionar seus próprios estados

Vá a **Incidentes → Configurações → Estado do incidente**. A página é uma lista ordenada por `order` crescente, e novos estados são acrescentados ao fim. Arraste uma linha para mudar sua posição.

**Campos de um estado:**

- **Nome** — obrigatório, com pelo menos dois caracteres. O placeholder sugere algo como "Investigando".
- **Descrição** — texto livre opcional explicando quando um incidente fica neste estado.
- **Cor** — obrigatória. Escolhida no seletor de cores; armazenada como um valor hexadecimal, como `#fd625e`.

Você não pode definir as três flags a partir deste formulário — elas pertencem às linhas iniciais. Um estado que você adiciona é, portanto, um estado sem flag, o que tem duas consequências que vale a pena planejar:

- **Ele conta como ativo.** **Incidentes ativos** é definido como "o estado atual não é o estado resolvido", então qualquer coisa que você adicionar que não seja o estado resolvido mantém o incidente na lista ativa e na contagem da barra lateral.
- **Seu botão de transição é genérico.** Em vez de **Acknowledge** ou **Resolver**, o modal de confirmação se chama **Mark Incident as `<state name>`**, com um botão de envio **Mark as `<state name>`**.

Um formato comum é inserir um passo de triagem ou mitigação entre os estados de confirmação e de resolução — por exemplo, arrastar um novo estado "Mitigado" para que fique depois de **Confirmado** e antes de **Resolvido**.

## A ordem é uma restrição de verdade, não uma preferência de exibição

A coluna `order` é imposta quando uma mudança de estado é gravada, e não apenas quando a lista é desenhada:

- **Transições para trás são rejeitadas.** Mover um incidente para um estado que fica antes do atual na ordenação falha com um erro nomeando os dois estados.
- **Reselecionar o estado atual é rejeitado.** Definir um incidente para o estado em que ele já está falha com "Incident state cannot be same as previous state."
- **Uma linha retroativa não pode duplicar sua vizinha.** Inserir uma linha na linha do tempo cujo estado seja igual ao da linha seguinte também é recusado.
- **Os botões do cabeçalho seguem a posição dos estados com flag na ordenação.** **Acknowledge** e **Resolver** são oferecidos com base em onde o estado atual está na lista ordenada. Um estado personalizado colocado *depois* do estado resolvido nunca vai mostrar um botão **Resolver**, porque não sobra nada para onde avançar.

Então, ao adicionar um estado, coloque-o onde um incidente genuinamente passaria por ele. Ordená-lo errado não é só esquisito de ver — torna as transições impossíveis.

## As severidades iniciais

Três severidades são criadas junto com o projeto, nesta ordem:

- **Critical Incident** (`order` 1, `#b70400`) — problemas causando impacto altíssimo aos clientes, exigindo resposta imediata. Uma interrupção total ou um vazamento de dados.
- **Major Incident** (`order` 2, `#fd625e`) — impacto significativo, geralmente exigindo resposta imediata, às vezes com uma solução de contorno que limita o estrago. Um subsistema importante falhando.
- **Minor Incident** (`order` 3, `#ffbf53`) — impacto baixo, geralmente tratado em horário comercial, e que a maioria dos clientes dificilmente nota. Uma leve queda no desempenho da aplicação.

A severidade é obrigatória quando você declara um incidente, e é obrigatória em cada especificação de incidente nos critérios de um monitor, então todo incidente — manual ou automático — chega com uma. Veja [Declarar um incidente](/docs/incidents/declaring-incidents) para o fluxo de declaração e [Modelos de incidentes e alertas](/docs/monitor/incident-alert-templating) para o caminho dirigido por monitores.

## Editar severidades

Vá a **Incidentes → Configurações → Severidade do incidente**. O formato é o mesmo da página de estados — uma lista ordenada por `order`, arraste para reordenar, novas severidades acrescentadas ao fim, com **Nome**, **Descrição** e **Cor** no formulário.

Duas diferenças em relação aos estados:

- **Não há proteção contra exclusão.** Qualquer severidade pode ser excluída, inclusive as três iniciais.
- **Não há flags a herdar.** Uma severidade nova se comporta exatamente como as iniciais — é um rótulo com uma cor e uma posição.

**Uma observação sobre os placeholders.** O formulário de severidade reaproveita o texto de exemplo do formulário de estados palavra por palavra, então as dicas falam de estados de incidente em vez de severidades. Ignore-as e escreva seus próprios nomes e descrições de severidade.

Onde a severidade faz mais do que descrever: em **Incidentes → Regras → Regras de Plantão**, o campo **Incidente Severidades** de uma regra é um critério de correspondência. Listar **Critical Incident** ali é como se expressa "acione o time de banco de dados para qualquer coisa crítica" — a política de plantão mora na regra, não na severidade.

## Mover um incidente pelos seus estados

Há quatro maneiras de um incidente mudar de estado:

- **Os botões do cabeçalho.** Abra um incidente. Se o estado atual estiver antes do estado de confirmação, você tem **Acknowledge** e **Resolver**; se estiver entre os dois, você tem **Resolver**. Cada um abre um modal de confirmação — **Acknowledge Incident** ou **Resolve Incident** — que também oferece **Selecionar Modelo de Nota**, **Nota pública** e **Notificar assinantes da página de status**.
- **A linha do tempo de estado.** Adicione uma linha à mão na página **Linha do tempo de estado** do incidente, com **Status do Incidente**, **Começa em** e **Notificar assinantes da página de status**.
- **Alteração em lote.** A lista de incidentes tem uma ação em lote **Alterar estado** para mover vários incidentes de uma vez.
- **Automaticamente.** Um critério de monitor com **Resolver incidente automaticamente** ativado resolve seu incidente quando o critério deixa de ser atendido, e a API pode atualizar o estado por `/api/incident-state-timeline`.

Cada uma dessas grava uma linha na linha do tempo. Uma mudança de estado também faz algumas coisas que você não precisa pedir: publica uma entrada no feed do incidente, atribui um Incident Commander se o incidente ainda não tiver um, e atualiza o cronômetro do SLA. Reabrir um incidente resolvido inicia um novo registro de SLA a partir do momento da reabertura.

## A linha do tempo de estado

A página **Linha do tempo de estado** no menu lateral do incidente é a trilha de auditoria de todos os estados pelos quais o incidente passou. O cartão dessa página se chama **Linha do tempo de status**, e está ordenado do mais recente para o mais antigo.

**Colunas:**

- **Status do Incidente** — uma etiqueta colorida com o nome e a cor do estado.
- **Começa em** — quando o incidente entrou neste estado.
- **Termina em** — quando ele saiu. O estado atual mostra `Currently Active`.
- **Duração** — tempo passado no estado, contado até agora no caso do atual.
- **Status de notificação do assinante** — se a notificação da página de status para esta mudança foi enviada, ignorada ou ainda está pendente, com um link **mais detalhes** e — quando o envio falhou — uma ação **Retry**.

**Ações de linha:**

- **Ver causa** — abre um modal **Causa raiz** renderizando o markdown registrado com aquela mudança de estado.
- **Ver registros** — abre um modal explicando por que o status mudou, com um visualizador **Registro de Estado do Incidente**.

Linhas da linha do tempo podem ser criadas e excluídas, mas não editadas. Excluir a linha errada reescreve a história do incidente, então trate isso como ferramenta de correção e não como hábito de faxina.

## A lista de Incidentes ativos

**Incidentes → Incidentes ativos** é a lista que você acompanha durante um turno. Sua definição é exatamente uma condição: o estado atual do incidente é um estado em que `isResolvedState` é falso. Nada mais é considerado — nem severidade, nem idade, nem se alguém o confirmou.

O item do menu lateral traz um selo vermelho de contagem usando a mesma consulta, então o selo e a lista sempre concordam. Quando não há nada a ver, a página diz isso.

A consequência prática: qualquer estado personalizado que você adicionar mantém incidentes nesta lista. Normalmente é o que você quer — "Mitigado" não é "pronto" — mas significa que o selo só zera quando os incidentes efetivamente chegam ao estado resolvido.

## Avisar os assinantes da página de status sobre uma mudança de estado

Uma mudança de estado pode enviar e-mail aos assinantes da sua página de status, mas ela passa por vários portões. Entendê-los poupa muita depuração do tipo "por que ninguém foi notificado".

A notificação é solicitada por linha da linha do tempo, com **Notificar assinantes da página de status** (`shouldStatusPageSubscribersBeNotified`), a caixa de seleção do modal de mudança de estado e do formulário manual da linha do tempo. Quando está desmarcada, a linha é gravada com status de ignorada e uma explicação. Quando está marcada, a linha entra na fila e um job em segundo plano a recolhe — o job roda a cada minuto, então a entrega é rápida, mas não instantânea.

**A linha enfileirada é então ignorada quando qualquer uma destas condições vale:**

- **O novo estado é o estado de criação.** Os assinantes já foram avisados quando o incidente foi declarado, então a primeira linha da linha do tempo deliberadamente não envia uma segunda mensagem.
- **O incidente não tem monitores anexados.** Sem recursos, não há página de status onde mapear o incidente.
- **O incidente não está visível na página de status** (`isVisibleOnStatusPage` está desativado).
- **A página de status está com incidentes desligados** (`showIncidentsOnStatusPage` está desativado). Este é por página de status — outras páginas que mostram o mesmo monitor ainda são notificadas.

**Mais uma coisa que muda o resultado.** Se você digitar uma **Nota pública** no modal de mudança de estado, a linha da linha do tempo é marcada como já notificada em vez de enfileirada. A própria nota é o que chega aos assinantes, então eles recebem uma mensagem em vez de duas. O tipo de evento por trás da mensagem simples de mudança de estado é `Subscriber Incident State Changed`.

Para saber quem recebe essas mensagens e como os modelos são escolhidos, veja [Assinantes e comunicados](/docs/status-pages/subscribers).

## Manter um incidente fora da página de status

Três coisas separadas decidem se um incidente aparece na página pública, e as três precisam ser verdadeiras:

- **Mostrar incidentes** (`showIncidentsOnStatusPage`) na própria página de status.
- **Visível na página de status** (`isVisibleOnStatusPage`) no incidente — uma chave na página **Configurações** do incidente. Ela vem ativada e não está no assistente de declaração; um critério de monitor pode defini-la com **Mostrar incidente na página de status**.
- **O estado atual não é o estado resolvido.** É isso que remove um incidente da seção ativa: a consulta da página de status busca incidentes cujo estado atual seja qualquer estado não resolvido. Você não arquiva nem fecha nada — você resolve, e ele passa para o histórico.

**Incidentes privados nunca aparecem.** Ativar **Incidente privado** esconde o incidente de toda página de status, independentemente das chaves acima, e o restringe aos seus proprietários mais os administradores e proprietários do projeto.

Quanto histórico de incidentes resolvidos a página mantém é uma configuração da página de status, não do incidente. Veja [Recursos e grupos da página de status](/docs/status-pages/resources-and-groups) para entender como os monitores na página decidem quais incidentes aparecem.

## Onde ler a seguir

- [Visão geral dos incidentes](/docs/incidents/index) — como a área de incidentes se encaixa.
- [Declarar um incidente](/docs/incidents/declaring-incidents) — o assistente de declaração, modelos e a API.
- [Notas, responsáveis e feed de incidentes](/docs/incidents/notes-owners-and-feed) — notas públicas, notas privadas e o feed de atividades.
- [Configurações e automação de incidentes](/docs/incidents/settings) — modelos, campos personalizados, regras e gatilhos de workflow.
- [Assinantes e comunicados](/docs/status-pages/subscribers) — quem recebe os e-mails que uma mudança de estado dispara.
- [Visão geral das páginas de status](/docs/status-pages/index) — o que uma página de status mostra e para quem.
- [Visão geral dos workflows](/docs/workflows/index) — reagir a mudanças de estado com automação.
