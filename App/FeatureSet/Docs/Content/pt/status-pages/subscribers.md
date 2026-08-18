# Assinantes e comunicados

Uma página de status é um lugar aonde as pessoas vão. Assinantes são as pessoas que preferem não ter que ir — elas entregam um endereço de e-mail, um número de telefone, um webhook do Slack ou um endpoint HTTP uma vez, e depois disso suas atualizações chegam até elas.

Anúncios são a outra metade do mesmo trabalho. Um monitor pode dizer aos seus visitantes que o checkout está retornando 500; nenhum monitor pode dizer a eles que você vai migrar bancos de dados no sábado, que um provedor terceiro está tendo um dia ruim, ou que o incidente sobre o qual leram ontem está totalmente encerrado. Anúncios são o canal de texto livre para tudo o que suas verificações não conseguem ver, e eles se espalham para a mesma lista de assinantes.

Esta página cobre os dois: os cinco canais de assinatura e como os visitantes se inscrevem, o que os assinantes podem escolher receber, os fluxos de duplo opt-in e de cancelamento, e como os anúncios são escritos, agendados e modelados.

## Canais de assinatura

Uma página de status suporta cinco canais, cada um com sua própria chave na página de status. Vá a **Páginas de status → sua página → Assinantes → Configurações de assinantes**:

- **Habilitar assinantes por e-mail** (`enableEmailSubscribers`) — ativado por padrão. Todo o resto fica desativado até você ativar.
- **Habilitar assinantes por SMS** (`enableSmsSubscribers`) — desativado por padrão.
- **Habilitar assinantes do Slack** (`enableSlackSubscribers`) — desativado por padrão.
- **Habilitar assinantes do Microsoft Teams** (`enableMicrosoftTeamsSubscribers`) — desativado por padrão.
- **Habilitar assinantes por webhook** (`enableWebhookSubscribers`) — desativado por padrão.

Cada canal também ganha sua própria lista no menu lateral da página de status em **Assinantes**: **Assinantes de e-mail**, **Assinantes de SMS**, **Assinantes do Slack**, **Assinantes do MS Teams** e **Assinantes de webhook**. É ali que você vê quem está inscrito, adiciona alguém à mão ou deixa para si mesmo uma entrada de **Notas** (`internalNote`) em um assinante específico.

**Uma chave não é suficiente.** O item **Subscribe** na barra de navegação da página de status só aparece quando **Mostrar página de assinantes** (`showSubscriberPageOnStatusPage`) está ativado *e* pelo menos um canal está habilitado. Se você ativar **Habilitar assinantes por e-mail** mas deixar **Mostrar página de assinantes** desativado, os visitantes não têm como chegar ao formulário.

As mesmas cinco chaves aparecem uma segunda vez dentro do cartão **Configurações de assinantes** em **Configurações avançadas**, ao lado de **Mostrar página de assinantes**. São as mesmas colunas por baixo — escolha uma tela e fique nela, e prefira a página dedicada **Configurações de assinantes**, já que é ali que o resto da configuração de assinantes vive.

## O que um visitante vê na página Subscribe

A página **Subscribe** tem um submenu com uma aba por canal habilitado — **E-mail**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — mapeadas para `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` e `/subscribe/webhooks`. Cada aba pede o mínimo de que precisa:

- **E-mail** — título **Subscribe by Email**, um campo **Your Email** com o placeholder `subscriber@company.com`.
- **SMS** — título **Subscribe by SMS**, um campo **Your Phone Number** com o placeholder `+11234567890`.
- **Slack** — título **Subscribe by Slack**, com **Nome do workspace do Slack** (usado para validação) e **URL do webhook de entrada do Slack**, placeholder `https://hooks.slack.com/services/...`.
- **MS Teams** — título **Subscribe by Microsoft Teams**, com **Nome do workspace do Microsoft Teams** e **URL do webhook de entrada do Microsoft Teams**, placeholder `https://outlook.office.com/webhook/...`.
- **Webhooks** — título **Subscribe by Webhook**, um campo **URL do webhook**. Uma requisição JSON `POST` é enviada a ele a cada evento da página de status.

O botão de envio diz **Subscribe**, e uma inscrição bem-sucedida mostra *You have been subscribed successfully.* A página também traz uma divisão **New Subscription** / **Manage Existing Subscription**, para que alguém que já se inscreveu possa voltar às suas preferências sem caçar um e-mail antigo.

## Deixar os assinantes escolherem recursos e tipos de evento

Por padrão um assinante recebe tudo o que está na página. Duas chaves no cartão **Configurações avançadas de assinante** mudam isso:

- **Permitir que assinantes escolham recursos** (`allowSubscribersToChooseResources`) — desativado por padrão. Ative e o formulário de inscrição ganha uma chave **Inscrever-se em todos os recursos**; desmarque-a e **Selecionar recursos para inscrever-se** aparece para que o visitante possa escolher recursos individuais.
- **Permitir que assinantes escolham tipos de evento** (`allowSubscribersToChooseEventTypes`) — desativado por padrão. Mesmo formato: uma chave **Inscrever-se em todos os tipos de eventos**, e **Selecionar tipos de eventos para inscrever-se** logo abaixo quando ela é desmarcada.

Os tipos de evento são `Incident`, `Announcement` e `Scheduled Event`.

As escolhas ficam no registro do assinante como **Is Subscribed to All Resources** (`isSubscribedToAllResources`, padrão verdadeiro), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, padrão verdadeiro), **Subscribed to Resources** e **Subscribed to Event Types**.

Bom para: uma página que cobre vários produtos. Um cliente que só usa sua API não quer um alerta toda vez que o site de marketing oscila — deixe que ele mesmo restrinja a lista em vez de vê-lo cancelar tudo.

O mesmo cartão também carrega **Fusos Horários do Assinante**.

## Duplo opt-in de e-mail

Assinantes de e-mail sempre confirmam. Quando um assinante é criado com um endereço de e-mail e não foi criado já confirmado, **Is Subscription Confirmed** (`isSubscriptionConfirmed`) é forçado para `false` e um **Subscription Confirmation Token** de seis dígitos é gerado. O OneUptime então envia por e-mail um link de confirmação no formato `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. O visitante chega a uma página **Confirm Subscription** e, uma vez que dá certo, vê *Subscription confirmed successfully*.

Assinantes de SMS, Slack, Microsoft Teams e webhook pulam isso — eles são criados com `isSubscriptionConfirmed` já definido como `true`.

**Não confirmado significa silêncio.** A consulta que busca assinantes para uma notificação filtra por `isUnsubscribed: false` e `isSubscriptionConfirmed: true`. Um endereço de e-mail que nunca clicou no link vai ficar na sua lista de **Assinantes de e-mail** e não receber nada. Se alguém jurar que está inscrito mas não recebe nada, verifique essa coluna primeiro.

Não há chave para desligar a confirmação por e-mail — ela é incondicional para quem se inscreve pela página de status. Uma coluna separada por assinante, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, padrão verdadeiro), controla o e-mail de "você se inscreveu" que sai depois que um assinante é confirmado.

## Gerenciar e cancelar uma assinatura

Todo e-mail a assinantes carrega um link de cancelamento no formato `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Essa página é intitulada **Update Subscription** e diz ao visitante que ele pode atualizar suas preferências ou cancelar a inscrição ali. Ela contém:

- Quaisquer seletores de recursos e de tipos de evento que a página permitir.
- Uma chave **Cancelar inscrição**, descrita como cancelar a inscrição de todos os recursos. Ela grava **Está Descadastrado** (`isUnsubscribed`, padrão falso).
- Um botão de envio dizendo **Update Subscription**; salvar mostra *Your changes have been saved.*

Quem perdeu o link usa **Manage Existing Subscription** na página **Subscribe** e pressiona **Send Management Link**. O OneUptime responde que um e-mail com o link foi enviado e que se deve verificar a caixa de spam caso ele não chegue.

Os endpoints por trás de tudo isso são `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` e `PUT .../update-subscription/:statusPageId/:subscriberId`.

Cancelar a inscrição vira uma flag em vez de excluir uma linha, então o registro permanece na lista do canal com **Está Descadastrado** definido — útil quando você precisa explicar depois por que um endereço específico parou de receber e-mails.

## Sobre o que os assinantes são notificados

Assinantes ficam sabendo dos três tipos de evento acima, mas cada fonte tem sua própria chave, então nada é enviado por acidente.

### Notificações de anúncios

O próprio anúncio carrega **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), exposto no formulário de criação como a caixa de seleção **Notificar assinantes da página de status** e ativado por padrão. Se o anúncio nomeia monitores em **Monitores afetados (Opcional)**, a notificação é restrita a esses monitores; deixe vazio e todos os assinantes são notificados.

### Eventos de manutenção agendada

Um evento de manutenção agendada tem seu próprio conjunto de colunas de assinante: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, mais **Subscriber notifications before the event** e **Next subscriber notification before the event at?** para avisos antecipados. **Páginas de status** no evento decide em quais páginas ele aparece, e **Should be visible on status page?** decide se ele aparece.

### Incidentes

`Incident` é o terceiro tipo de evento. O que faz um incidente chegar a uma página de status em primeiro lugar — quais recursos ele toca e quais estados o mantêm visível — é coberto em [Estados e severidades de incidentes](/docs/incidents/states-and-severities).

A seção **Logs de notificação** no menu lateral da página de status (`{id}/notification-logs`) é para onde você vai quando precisa ver o que a página de fato enviou.

## Personalizar modelos de notificação

O cartão **Modelos de notificação** em **Configurações de assinantes** lista os modelos que esta página de status usa, com as colunas **Nome do modelo**, **Tipo de evento** e **Método de notificação** — para que você possa variar o texto por tipo de evento e por canal em vez de aceitar uma única mensagem padrão para tudo.

Modelos de todo o projeto ficam um nível acima, em **Páginas de status → Configurações → Modelos de assinantes**, ao lado de **Modelos de anúncios**.

## Rodapé de e-mail, SMTP personalizado e Twilio

Mais três cartões em **Configurações de assinantes** controlam como as mensagens aos assinantes saem do seu projeto:

- **Configurações do rodapé do e-mail** — **Habilitar texto personalizado de rodapé do e-mail** e **Texto de Rodapé da Notificação por E-mail ao Assinante** colocam o seu próprio rodapé nos e-mails aos assinantes.
- **SMTP Personalizado** — **Configuração SMTP Personalizada** envia o e-mail aos assinantes pelo seu próprio servidor de e-mail em vez do padrão.
- **Configuração do Twilio** — **Configuração do Twilio** é a conta Twilio usada para assinantes de SMS.

Vale fazer o SMTP personalizado cedo se você tem assinantes de e-mail: correspondência que vem do seu próprio domínio é muito menos propensa a ser filtrada, e muito mais propensa a ser confiada pelo cliente que a lê às 2 da manhã.

## Anúncios

Um anúncio é um registro no nível do projeto (o modelo `StatusPageAnnouncement`) que você espalha para uma ou mais páginas de status, opcionalmente restrito a monitores específicos, com uma janela durante a qual ele é exibido.

Você cria um a partir de **Páginas de status → Mais → Anúncios**, ou a partir de **Anúncios** no menu lateral de uma página de status individual. O formulário de criação é um assistente de quatro etapas:

1. **Informações básicas** — **Título do anúncio** (obrigatório, com pelo menos dois caracteres), **Descrição** (Markdown, opcional) e **Anexos** para arquivos que devem ficar disponíveis com o anúncio na página de status.
2. **Páginas de status** — **Mostrar anúncio nestas páginas de status**, uma seleção múltipla obrigatória. Um anúncio pode mirar várias páginas ao mesmo tempo.
3. **Recursos afetados** — **Monitores afetados (Opcional)**. Se você não selecionar nenhum, todos os assinantes são notificados.
4. **Agendamento e configurações** — **Começar a mostrar anúncio em** (obrigatório, padrão agora), **Parar de exibir o anúncio em** (opcional) e **Notificar assinantes da página de status** (ativado por padrão).

Os visitantes leem anúncios em `/announcements`, divididos em **Active Announcements** e **Past Announcements**, cada um carimbado com **Announced at**. Anúncios atualmente ativos também são fixados no topo da página de visão geral. Quando não há nada a mostrar, a página diz *No Announcement* com a observação de que nenhum foi publicado até agora.

Anexos são servidos a partir de `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, atrás da mesma verificação de leitura da própria página de status — então um anexo em uma página privada continua privado.

## Como funciona o agendamento de anúncios

**Show At** (`showAnnouncementAt`) e **End At** (`endAnnouncementAt`) dirigem tudo, mas a página de visão geral e a lista de anúncios fazem perguntas diferentes, e a diferença tropeça as pessoas.

- **A página de visão geral** mostra um anúncio quando `showAnnouncementAt` está no passado e `endAnnouncementAt` está no futuro ou vazio.
- **A lista `/announcements`** mostra anúncios cujo `showAnnouncementAt` caia dentro de **Mostrar histórico de anúncios (em dias)** (`showAnnouncementHistoryInDays`, padrão 14), e então os divide no cliente entre ativos e passados.

Duas consequências que vale planejar:

- **Um anúncio sem data de fim nunca expira.** Deixe **Parar de exibir o anúncio em** vazio e ele fica fixado indefinidamente na página de visão geral. Defina uma data de fim em qualquer coisa com prazo.
- **Um anúncio antigo mas ainda ativo pode sumir da lista.** Se ele começou há mais de `showAnnouncementHistoryInDays`, ele cai de `/announcements` enquanto permanece na visão geral. Aumente a janela de histórico se você mantém avisos de longa duração.

Se anúncios aparecem ou não é controlado pelo cartão **Configurações do anúncio** em **Configurações avançadas**: **Mostrar anúncios** (`showAnnouncementsOnStatusPage`, padrão verdadeiro) e **Mostrar histórico de anúncios (em dias)** (padrão 14). Com **Mostrar anúncios** desativado, o endpoint de anúncios recusa a requisição de imediato.

## Modelos de anúncios

Se você publica o mesmo tipo de aviso repetidamente — um alerta mensal de manutenção, uma degradação recorrente de terceiros — deixe pronto. **Páginas de status → Configurações → Modelos de anúncios** armazena o modelo `StatusPageAnnouncementTemplate`, e seu formulário pede **Nome do modelo**, **Descrição do modelo**, **Título do anúncio**, **Descrição**, **Mostrar anúncio nestas páginas de status**, **Monitores afetados (Opcional)** e **Notificar assinantes**, de modo que a distribuição e a decisão de notificar são feitas uma vez em vez de toda vez.

## Assinantes de webhook e proteção contra SSRF

Assinantes de webhook recebem uma requisição JSON `POST` a cada evento da página de status, o que os torna a maneira mais fácil de canalizar atualizações da página de status para um sistema seu — um chatbot, um painel interno, uma fila de chamados.

Como se inscrever é uma operação pública em uma página pública, o OneUptime protege o alvo:

- Uma **URL do webhook** genérica é validada antes de ser aceita, e endereços privados, de loopback, link-local e de metadados de nuvem são rejeitados. Você não pode apontar uma assinatura para algo dentro da própria rede da implantação do OneUptime.
- Uma **URL do webhook de entrada do Slack** precisa começar com `https://hooks.slack.com/services/`.

Se uma assinatura de webhook for rejeitada na inscrição, uma URL interna ou malformada é a primeira coisa a verificar.

## Onde ler a seguir

- [Visão geral das páginas de status](/docs/status-pages/index) — o que é uma página de status e como ela é montada.
- [Recursos e grupos da página de status](/docs/status-pages/resources-and-groups) — os monitores e grupos entre os quais os assinantes podem escolher.
- [Marca e domínios da página de status](/docs/status-pages/branding-and-domains) — domínios personalizados, logotipos e a aparência da página que seus e-mails linkam.
- [API pública](/docs/status-pages/public-api) — ler dados da página de status programaticamente.
- [Estados e severidades de incidentes](/docs/incidents/states-and-severities) — o que coloca um incidente em uma página de status e o que o tira dela.
- [Configurações e automação de incidentes](/docs/incidents/settings) — as regras no nível do projeto por trás da comunicação de incidentes.
