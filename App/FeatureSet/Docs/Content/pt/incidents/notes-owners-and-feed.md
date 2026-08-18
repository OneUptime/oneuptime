# Notas, responsáveis e feed

Todo incidente acumula um registro escrito enquanto você trabalha nele. Parte desse registro é para os seus clientes — a atualização que vai para a página de status às 02:14 dizendo que você encontrou o deploy ruim. O resto é para a sua equipe — o stack trace que alguém colou, o gráfico que finalmente fez sentido, a decisão de fazer failover.

O OneUptime mantém esses dois públicos separados. **Notas públicas** são publicadas na sua página de status e podem notificar assinantes. **Notas privadas** (o modelo `IncidentInternalNote`) ficam dentro do painel. Sob ambas está o **Incidente Feed**, uma linha do tempo somente-adição que registra tudo o que aconteceu com o incidente, e a lista de **Proprietários**, que decide quem é avisado.

Tudo isso pende do menu lateral esquerdo do incidente: **Notas → Notas públicas**, **Notas → Notas privadas** e **Equipe → Proprietários**. O feed fica na página **Visão geral** do incidente.

## Notas públicas versus notas privadas

Os dois tipos de nota se parecem no painel e se comportam de forma muito diferente.

- **Notas públicas** — o modelo `IncidentPublicNote`, servido às páginas de status como parte da linha do tempo do incidente. Elas carregam uma data **Publicado em** que você mesmo pode definir e uma caixa de seleção **Notificar assinantes da página de status**.
- **Notas privadas** — o modelo `IncidentInternalNote`. Nada no aplicativo de página de status as lê. Elas não têm campo de publicado em (a lista é carimbada e ordenada por `createdAt`) nem quaisquer campos de assinante, então uma nota privada nunca pode disparar uma notificação a assinantes.

**O que "privada" realmente significa.** Significa "não publicada na página de status" — não "restrita a um grupo menor de pessoas". Ambos os tipos de nota compartilham as mesmas permissões de leitura, então qualquer pessoa que possa ler o incidente pode ler suas notas privadas. Se você precisa restringir quem pode ver o incidente em si, use a flag **Incidente privado** (`isPrivate`) no próprio incidente, que oculta o incidente de toda página de status e o limita aos usuários proprietários do incidente, aos membros de suas equipes proprietárias e aos administradores e proprietários do projeto.

**Proprietários veem ambas.** O job de notificação de proprietários consulta notas públicas e privadas juntas. Uma nota privada é privada dos seus assinantes, não das pessoas que estão respondendo.

| Se você quiser…                                                    | Escolha             |
| ------------------------------------------------------------------ | ------------------- |
| Contar aos clientes o que você sabe e quando saberá mais           | **Nota pública**    |
| Retroagir uma atualização que você já enviou em outro lugar        | **Nota pública**    |
| Registrar uma hipótese, um comando que você rodou ou um beco sem saída | **Nota privada** |
| Anexar um heap dump ou a captura de um painel interno              | **Nota privada**    |

## Publicar uma nota pública

Abra **Notas → Notas públicas** no menu lateral do incidente e crie uma nota. O cartão explica que o que você escreve ali aparece na página de status; o estado vazio diz que nenhuma nota pública foi criada para este incidente até agora.

| Campo                                          | Finalidade                                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Nota pública de incidente**                  | O corpo, em Markdown. Obrigatório. O formulário lembra que a nota é visível na sua página de status e linka um resumo de referência. |
| **Anexos**                                     | Arquivos compartilhados com os assinantes na página de status. Opcional.                                       |
| **Notificar assinantes da página de status**   | Caixa de seleção, ativada por padrão. Desative para publicar silenciosamente.                                  |
| **Publicado em**                               | Data e hora obrigatórias, com padrão agora, exibidas no seu fuso horário atual.                                |

**Publicado em é o carimbo de data e hora real da nota.** Páginas de status ordenam e exibem notas públicas por `postedAt`, não por quando você as digitou — então, se você está atualizando a página de status sobre algo que enviou 40 minutos atrás, defina **Publicado em** para quando realmente aconteceu. Se uma nota chega pela API sem esse campo, o OneUptime carimba a hora atual.

A lista mostra quem escreveu cada nota, seu **Publicado em**, o Markdown renderizado com seus anexos e uma coluna **Status de notificação do assinante**. Você pode filtrar por **Criado por**, **Nota** e **Criado em**.

## Publicar uma nota privada

**Notas → Notas privadas** é deliberadamente mais simples. Há apenas dois campos:

- **Nota privada de incidente** — corpo em Markdown, obrigatório. O formulário diz abertamente que isso é privado à sua equipe e não é visível na página de status.
- **Anexos** — arquivos destinados à equipe de resposta ao incidente.

Sem **Publicado em**, sem caixa de seleção de assinantes — a nota é carimbada quando é criada.

## Anexos em notas

Ambos os tipos de nota aceitam anexos de arquivos através de um campo **Anexos**, e ambos renderizam uma lista de anexos sob o corpo da nota com um link **Download attachment** por arquivo.

Onde eles divergem é em quem pode baixar o arquivo:

- **Anexos de notas públicas** podem ser baixados pelos visitantes da página de status através de uma rota da página de status, junto com a própria nota.
- **Anexos de notas privadas** só são alcançáveis pela API autenticada do painel. Não há rota de página de status para eles.

Isso torna os anexos a mesma decisão público/privado do texto da nota. Uma imagem da linha do tempo voltada ao cliente vai em uma nota pública; um dump de configuração vai em uma privada.

## Gerar uma nota com IA

Ambas as páginas de notas trazem um botão **Generate with AI**. Ele envia o incidente ao provedor de IA do seu projeto e joga o Markdown gerado no editor de notas, onde você o edita antes de salvar — nada é publicado automaticamente.

- **Generate Public Note with AI** — descrito como analisar os dados do incidente para produzir uma nota voltada ao cliente. Os modelos incluem **Status Update** e **Resolution Notice**.
- **Generate Private Note with AI** — produz, em vez disso, uma nota técnica interna. Os modelos incluem **Investigation Update** e **Technical Analysis**.

Por trás do botão, o painel faz um POST para `/incident/generate-note-from-ai/{incidentId}` com o modelo escolhido e um tipo de nota `public` ou `internal`.

## Modelos de notas

Se sua equipe escreve as mesmas três atualizações a cada interrupção, salve-as uma vez. Ambas as páginas de notas têm um botão **Criar a partir de modelo** que abre um seletor **Criar Nota a partir de Modelo** com um menu **Selecionar Modelo de Nota**.

Modelos são compartilhados entre notas públicas e privadas: uma única lista de modelos serve às duas, e o mesmo modelo pode ser inserido em qualquer um dos tipos de nota.

Você os gerencia em **Incidentes → Configurações → Modelos de notas** — o cartão é intitulado **Modelos de nota pública ou privada para incidentes** e seu formulário tem uma etapa **Informações do modelo** (**Nome do modelo** e **Descrição do modelo**, ambos obrigatórios) e uma etapa **Detalhes da nota** para o corpo. Se você clicar em **Criar a partir de modelo** antes de criar algum, o OneUptime avisa que nenhum existe ainda; note que a mensagem aponta para Configurações do projeto, mas a página fica de fato em **Incidentes → Configurações → Modelos de notas**.

## Publicar notas a partir do Slack ou do Microsoft Teams

Se você conectou um espaço de trabalho, os respondentes nunca precisam sair do canal. Tanto o Slack quanto o Microsoft Teams expõem uma ação de adicionar nota que abre um modal com um menu oferecendo **Nota pública** ou **Nota privada** mais uma caixa de texto, e grava o resultado direto no incidente.

Dois detalhes que vale conhecer:

- **Proteção contra duplicatas** — cada nota registra a mensagem do Slack de onde veio (`postedFromSlackMessageId`, formatada como `channel_id:message_ts`), então várias pessoas reagindo à mesma mensagem produzem uma nota, não cinco.
- **Notas voltam como eco** — publicar qualquer um dos tipos de nota também empurra uma mensagem para o canal de incidente conectado, porque o item de feed da nota é criado com a notificação de espaço de trabalho habilitada.

## Quando uma nota pública realmente chega aos assinantes

Criar uma nota pública com **Notificar assinantes da página de status** ativado não garante por si só que um e-mail sairá. A nota precisa passar por uma cadeia de verificações, e cada falha registra um motivo específico em vez de gerar erro:

1. **Notificar assinantes da página de status** precisa estar ativado. Se não estiver, a nota é carimbada como ignorada no momento em que é criada.
2. A nota precisa pertencer a um incidente que ainda exista.
3. O incidente precisa ter pelo menos um monitor anexado — sem monitores não há recurso de página de status para onde rotear a nota.
4. A flag **Visível na página de status** (`isVisibleOnStatusPage`) do incidente precisa ser verdadeira.
5. Cada página de status que o incidente alcança precisa ter **Mostrar incidentes** (`showIncidentsOnStatusPage`) ativado.
6. Cada assinante precisa passar por suas próprias preferências — não estar descadastrado, e estar inscrito neste recurso e no tipo de evento `Incident` onde a página permite que assinantes escolham.

**As notificações não são instantâneas.** O job que as envia roda uma vez por minuto, então espere até cerca de um minuto entre salvar a nota e o e-mail sair. É isso que o rótulo **Sending Soon** significa.

A coluna **Status de notificação do assinante** acompanha toda a jornada:

| Status                       | O que significa                                            |
| ---------------------------- | ---------------------------------------------------------- |
| **Notifications skipped.**   | Um dos portões acima fechou. O motivo fica registrado.     |
| **Sending Soon**             | Enfileirada, aguardando a próxima execução do job de envio.|
| **Notifications Being Sent** | O job está percorrendo a lista de assinantes.              |
| **Notificações enviadas**    | Todas as notificações aos assinantes saíram.               |
| **Falhou**                   | O job lançou erro; o erro fica armazenado com a nota.      |

Clique em **mais detalhes** no status para abrir **Detalhes do status da notificação**. Onde um reenvio faz sentido, o botão desse modal é **Retry**, que devolve a nota ao estado pendente para que a próxima execução a pegue de novo.

A mensagem que os assinantes de fato recebem é modelada por página de status e por canal — e-mail, SMS, Slack e Microsoft Teams têm cada um seu próprio modelo para o evento **Subscriber Incident Note Created**, com variáveis para o nome e a URL da página de status, o link de detalhes, os recursos afetados, a severidade e o título do incidente, o corpo da nota e um link de cancelamento por assinante. Veja [Assinantes e comunicados](/docs/status-pages/subscribers) para saber como esses modelos e canais são configurados.

## O feed do incidente

O cartão **Incidente Feed** fica no fim da coluna esquerda na página **Visão geral** do incidente. É a história do incidente em ordem: cada item é um ícone, o avatar e o nome de quem o causou, um carimbo de tempo relativo com a hora local exata ao passar o mouse, e um corpo em Markdown. Os itens são ordenados do mais antigo para o mais recente.

Alguns itens carregam detalhes extras — uma notificação de proprietário lista todos que receberam e-mail, por exemplo. Esses mostram um botão **More Information** que abre um painel **More Information**.

O cabeçalho do cartão também tem um menu **Ações** para você agir sem sair da linha do tempo:

- **Execute Runbook** — inicia um [runbook](/docs/runbooks/index) contra este incidente.
- **Executar política de plantão** — aciona uma política sob demanda.
- **Add Public Note** — os mesmos quatro campos da página de Notas públicas, em um modal.
- **Adicionar nota privada** — apenas corpo da nota e anexos.

Ao lado, **Atualizar** busca o feed novamente.

**O feed é somente-adição, e não é o seu log de auditoria.** A API permite criar e ler itens de feed, mas não atualizar nem excluí-los, então ninguém pode reescrever silenciosamente a história de um incidente. Ele também não é permanente: em instalações pagas, linhas de feed com mais de três anos são removidas. Para um registro durável de quem mudou o quê, use **Auditoria → Registros de auditoria** no menu lateral do incidente.

## O que o feed registra

Itens de feed são gravados pelo próprio serviço de incidentes, pelos dois serviços de notas, pela linha do tempo de estado, por mudanças de proprietários e membros, pelos motores de regras, pela execução de plantão, pelos executores de investigação por IA e de post-mortem, e pelos jobs cron de notificação. Os tipos de evento cobrem:

- **O próprio incidente** — `IncidentCreated`, `IncidentUpdated`, `IncidentStateChanged`.
- **Notas e relatos** — `PublicNote`, `PrivateNote`, `RootCause`, `RemediationNotes`, `PostmortemNote`.
- **Pessoas** — `OwnerUserAdded`, `OwnerTeamAdded`, `OwnerUserRemoved`, `OwnerTeamRemoved`, `IncidentMemberAdded`, `IncidentMemberRemoved`.
- **Notificações** — `OwnerNotificationSent`, `SubscriberNotificationSent`, `OnCallPolicy`, `OnCallNotification`.
- **Automação** — `LabelRuleExecuted`, `OwnerRuleExecuted`, `PrivacyRuleExecuted`, `OnCallRuleExecuted`, `AutoRemediation`.

Cada tipo tem seu próprio ícone, então você pode varrer um feed longo e separar as mudanças de estado do resto da conversa. Análise de causa raiz gerada por IA é marcada de forma distinta e renderizada em um modo Markdown restrito.

Feeds respeitam a privacidade do incidente: para incidentes privados, as leituras do feed são filtradas da mesma forma que o incidente.

## Proprietários

Proprietários são as pessoas e equipes responsáveis por um incidente. Eles são o alvo de notificação de tudo o que acontece com ele — e são a razão de um incidente não passar despercebido enquanto todos assumem que outra pessoa está cuidando.

Abra **Equipe → Proprietários** no menu lateral do incidente. O cartão **Proprietários** mostra um selo de contagem e descreve os proprietários como as pessoas e equipes responsáveis por este incidente que são notificadas sobre mudanças, com uma contagem corrente como "2 pessoas · 1 equipe". Proprietários são renderizados como avatares sobrepostos; passar o mouse em um mostra o e-mail da pessoa ou marca a entrada como **Equipe**.

- Clique em **Adicionar proprietário** para abrir um seletor com uma caixa de busca de pessoas ou equipes.
- Clique no controle de remoção em um avatar para abrir a confirmação **Remover proprietário** e depois **Remover**.
- Sem proprietários ainda, o cartão avisa e convida você a adicionar um colega de equipe ou uma equipe para que sejam notificados sobre mudanças.

Usuários proprietários e equipes proprietárias são registros separados — adicionar uma equipe torna cada membro dessa equipe um proprietário para fins de notificação sem listá-los individualmente.

## Como proprietários são atribuídos

Há quatro caminhos até a lista de proprietários:

- **A partir de um modelo de incidente** — modelos carregam os campos **Proprietário - Equipes** e **Proprietário - Usuários**, descritos como as equipes e usuários que são proprietários do incidente e serão notificados quando ele for criado ou atualizado. Criar um incidente a partir do modelo os preenche previamente. Veja [Declarar um incidente](/docs/incidents/declaring-incidents).
- **A partir de Regras de proprietário de incidentes** — regras correspondentes adicionam proprietários automaticamente no momento da criação.
- **Na criação pela API** — usuários e equipes proprietários passados na chamada de criação são adicionados imediatamente, com uma flag que controla se eles recebem o e-mail de "você foi adicionado".
- **À mão** — o controle **Adicionar proprietário** na página **Proprietários**, a qualquer momento durante o incidente.

Adicionar a mesma pessoa duas vezes é seguro; proprietários já atribuídos não são duplicados.

## Regras de proprietário de incidentes

**Regras de proprietário de incidentes** atribuem automaticamente usuários e equipes proprietários quando incidentes correspondentes são criados — a camada de roteamento que faz um incidente de banco de dados cair no time de banco de dados sem ninguém pensar nisso. Você as encontra junto com o resto da automação de incidentes coberta em [Configurações e automação de incidentes](/docs/incidents/settings).

O formulário da regra tem três etapas — **Informações básicas**, **Critérios de Correspondência** e **Proprietários** — e a etapa de proprietários contém duas seções:

- **Proprietários a atribuir** — escolha **Equipes proprietárias** e **Usuários proprietários**. Quando a regra corresponde, todo usuário e equipe selecionados são adicionados como proprietários, e proprietários já atribuídos não são duplicados.
- **Herdar Proprietários** — atribui proprietários a partir de entidades relacionadas em vez de nomeá-los. **Herdar Proprietários dos Monitores** torna cada proprietário dos monitores do incidente um proprietário do incidente, e **Herdar Proprietários dos Hosts**, **… From Kubernetes Clusters**, **… From Docker Hosts**, **… From Podman Hosts** e **… From Services** fazem o mesmo para esses recursos.

Uma chave **Notificar proprietários** controla se as pessoas ficam sabendo. Deixe ativada para roteamento real; desative para adicionar proprietários silenciosamente — útil quando uma regra é uma conveniência de controle e não um acionamento.

Cada execução de regra é gravada no feed do incidente, então você sempre consegue saber se uma pessoa foi adicionada por uma regra ou por um humano.

## Sobre o que os proprietários são notificados

Cinco jobs notificam proprietários, cada um rodando uma vez por minuto:

- **Incidente criado** — assunto `[New Incident {number}] - {title}`.
- **Uma nota foi publicada** — para notas públicas *e* privadas, assunto `[Update Incident {number}] - {title}`.
- **O estado do incidente mudou** — veja [Estados e severidades de incidentes](/docs/incidents/states-and-severities).
- **Você foi adicionado como proprietário** — assunto `You have been added as the owner of Incident {number} - {title}`.
- **Ainda não resolvido** — um lembrete dirigido pela hora do próximo lembrete do incidente, assunto `[Reminder] Incident {number} is still {state} - {title}`.

Cada notificação é montada para e-mail, SMS, ligação de voz, push e WhatsApp e entregue às configurações de notificação do usuário, que decidem o que de fato é enviado. Cada destinatário pode desativar cada uma delas individualmente — as configurações por usuário são redigidas como enviar a você as notificações de incidente criado, nota publicada, estado alterado, proprietário adicionado, membro atribuído e lembrete de ainda aberto. Alguém que só quer uma ligação para mudanças de estado pode ter exatamente isso.

**Incidentes sem proprietários não ficam silenciosos.** Se um incidente não tem nenhum proprietário, os jobs de notificação recaem sobre os proprietários do projeto, então nada é perdido. Toda pessoa notificada também é acrescentada ao item de feed correspondente, para que você possa ver depois exatamente quem foi avisado e em qual endereço.

## Onde ler a seguir

- [Visão geral dos incidentes](/docs/incidents/index) — o que é um incidente e como as peças se encaixam.
- [Declarar um incidente](/docs/incidents/declaring-incidents) — criar incidentes à mão, a partir de modelos e a partir de monitores.
- [Estados e severidades de incidentes](/docs/incidents/states-and-severities) — a máquina de estados que dirige metade do feed.
- [Configurações e automação de incidentes](/docs/incidents/settings) — regras de proprietário, modelos de notas e o resto da automação.
- [Assinantes e comunicados](/docs/status-pages/subscribers) — onde as notas públicas terminam e quem as recebe.
- [Visão geral das páginas de status](/docs/status-pages/index) — o lado do incidente voltado ao cliente.
