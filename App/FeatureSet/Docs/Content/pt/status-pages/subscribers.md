# Assinantes e anúncios

Uma página de status é um lugar aonde as pessoas vão. Assinantes são as pessoas que preferem não precisar ir — elas entregam a você um endereço de e-mail, um número de telefone, um webhook do Slack ou um endpoint HTTP uma única vez e, a partir daí, as suas atualizações vão até elas.

Anúncios são a outra metade do mesmo trabalho. Um monitor consegue avisar seus visitantes de que o checkout está devolvendo 500; nenhum monitor consegue avisar que você vai migrar bancos de dados no sábado, que um fornecedor externo está tendo um dia ruim ou que o incidente sobre o qual eles leram ontem está completamente encerrado. Anúncios são o canal de texto livre para tudo aquilo que suas verificações não enxergam — e eles saem para a mesma lista de assinantes.

Esta página cobre os dois lados: os cinco canais de inscrição e como os visitantes se cadastram, o que os assinantes podem escolher receber, os fluxos de dupla confirmação e de cancelamento, e como os anúncios são escritos, agendados e transformados em modelos.

## Canais de inscrição

Uma página de status oferece cinco canais, cada um com sua própria chave na página. Vá em **Páginas de status → sua página → Assinantes → Configurações de assinantes**:

- **Habilitar assinantes por e-mail** (`enableEmailSubscribers`) — ligado por padrão. Todo o resto fica desligado até você ligar.
- **Habilitar assinantes por SMS** (`enableSmsSubscribers`) — desligado por padrão.
- **Habilitar assinantes do Slack** (`enableSlackSubscribers`) — desligado por padrão.
- **Habilitar assinantes do Microsoft Teams** (`enableMicrosoftTeamsSubscribers`) — desligado por padrão.
- **Habilitar assinantes por webhook** (`enableWebhookSubscribers`) — desligado por padrão.

Cada canal também ganha uma lista própria no menu lateral da página de status, sob **Assinantes**: **Assinantes de e-mail**, **Assinantes de SMS**, **Assinantes do Slack**, **Assinantes do MS Teams** e **Assinantes de webhook**. É ali que você vê quem se cadastrou, adiciona alguém à mão ou deixa uma anotação em **Notas** (`internalNote`) sobre um assinante específico.

**Uma chave sozinha não basta.** O item **Inscrever-se** na barra de navegação da página de status só aparece quando **Mostrar página de assinantes** (`showSubscriberPageOnStatusPage`) está ligado *e* pelo menos um canal está habilitado. Se você ligar **Habilitar assinantes por e-mail** mas deixar **Mostrar página de assinantes** desligado, os visitantes não têm como chegar ao formulário.

As mesmas cinco chaves aparecem uma segunda vez dentro do cartão **Configurações de assinantes**, em **Configurações avançadas**, ao lado de **Mostrar página de assinantes**. São as mesmas colunas por baixo — escolha uma tela e fique nela, de preferência a página dedicada **Configurações de assinantes**, já que é lá que mora o restante da configuração de assinantes.

## O que um visitante vê na página Inscrever-se

A página **Inscrever-se** tem um submenu com uma aba por canal habilitado — **E-mail**, **SMS**, **Slack**, **MS Teams**, **Webhooks** — mapeadas para `/subscribe/email`, `/subscribe/sms`, `/subscribe/slack`, `/subscribe/microsoft-teams` e `/subscribe/webhooks`. Cada aba pede o mínimo de que precisa:

- **E-mail** — título **Inscrever-se por e-mail**, um único campo **Seu e-mail**, com o placeholder `subscriber@company.com`.
- **SMS** — título **Inscrever-se por SMS**, um único campo **Seu número de telefone**, com o placeholder `+11234567890`.
- **Slack** — título **Inscrever-se via Slack**, com **Nome do workspace do Slack** (usado para validação) e **URL do webhook de entrada do Slack**, placeholder `https://hooks.slack.com/services/...`.
- **MS Teams** — título **Inscrever-se via Microsoft Teams**, com **Nome do workspace do Microsoft Teams** e **URL do webhook de entrada do Microsoft Teams**, placeholder `https://outlook.office.com/webhook/...`.
- **Webhooks** — título **Inscrever-se por webhook**, um único campo **URL do webhook**. Uma requisição JSON `POST` é enviada para ela a cada evento da página de status.

O botão de envio diz **Inscrever-se**, e um cadastro bem-sucedido mostra *Você foi inscrito com sucesso.* A página também traz a divisão **Nova inscrição** / **Gerenciar inscrição existente**, para que quem já se inscreveu volte às suas preferências sem ter de caçar um e-mail antigo.

## Deixar o assinante escolher recursos e tipos de evento

Por padrão, um assinante recebe tudo o que há na página. Duas chaves no cartão **Configurações avançadas de assinante** mudam isso:

- **Permitir que assinantes escolham recursos** (`allowSubscribersToChooseResources`) — desligado por padrão. Ligue e o formulário de inscrição ganha uma chave **Inscrever-se em todos os recursos**; desmarque-a e aparece **Selecionar recursos para inscrever-se**, para o visitante escolher recurso a recurso.
- **Permitir que assinantes escolham tipos de evento** (`allowSubscribersToChooseEventTypes`) — desligado por padrão. Mesmo formato: uma chave **Inscrever-se em todos os tipos de eventos** e, quando ela é desmarcada, **Selecionar tipos de eventos para inscrever-se** logo abaixo.

Os tipos de evento são `Incident`, `Announcement` e `Scheduled Event`.

As escolhas ficam gravadas no registro do assinante como **Is Subscribed to All Resources** (`isSubscribedToAllResources`, `true` por padrão), **Is Subscribed to All Event Types** (`isSubscribedToAllEventTypes`, `true` por padrão), **Subscribed to Resources** e **Subscribed to Event Types**.

Serve bem para: uma página que cobre vários produtos. Um cliente que só usa a sua API não quer receber um aviso toda vez que o site de marketing oscila — deixe que ele mesmo estreite a lista, em vez de vê-lo cancelar tudo.

O mesmo cartão traz ainda **Fusos Horários do Assinante**.

## Dupla confirmação por e-mail

Assinantes por e-mail sempre confirmam. Quando um assinante é criado com um endereço de e-mail e não foi criado já confirmado, **Is Subscription Confirmed** (`isSubscriptionConfirmed`) é forçado para `false` e um **Subscription Confirmation Token** de seis dígitos é gerado. O OneUptime então envia por e-mail um link de confirmação no formato `{statusPageUrl}/confirm-subscription/{statusPageSubscriberId}?verification-token={token}`. O visitante cai em uma página **Confirmar inscrição** e, uma vez concluído, vê *Inscrição confirmada com sucesso*.

Assinantes por SMS, Slack, Microsoft Teams e webhook pulam essa etapa — eles são criados já com `isSubscriptionConfirmed` em `true`.

**Não confirmado significa silêncio.** A consulta que busca assinantes para uma notificação filtra por `isUnsubscribed: false` e `isSubscriptionConfirmed: true`. Um endereço que nunca clicou no link fica parado na sua lista de **Assinantes de e-mail** e não recebe nada. Se alguém jura que está inscrito mas não recebe nada, confira essa coluna primeiro.

Não há chave para desligar a confirmação por e-mail — ela é incondicional para quem se cadastra pela página de status. Uma coluna separada, por assinante, **Send You Have Subscribed Message** (`sendYouHaveSubscribedMessage`, `true` por padrão), controla o e-mail de "você se inscreveu" que sai assim que o assinante é confirmado.

## Gerenciar e cancelar uma inscrição

Todo e-mail para assinantes leva um link de cancelamento no formato `{statusPageUrl}/update-subscription/{statusPageSubscriberId}`. Essa página se chama **Atualizar inscrição** e informa ao visitante que ali ele pode atualizar suas preferências ou cancelar a inscrição. Ela contém:

- Os seletores de recursos e de tipos de evento que a página permitir.
- Uma chave **Cancelar inscrição**, descrita como cancelar a inscrição em todos os recursos. Ela grava **Está Descadastrado** (`isUnsubscribed`, `false` por padrão).
- Um botão de envio escrito **Atualizar inscrição**; ao salvar, aparece *Suas alterações foram salvas.*

Quem perdeu o link usa **Gerenciar inscrição existente** na página **Inscrever-se** e clica em **Enviar link de gerenciamento**. O OneUptime responde que um e-mail com o link foi enviado e que vale conferir a pasta de spam se ele não chegar.

Os endpoints por trás disso tudo são `POST .../subscribe/:statusPageId`, `POST .../manage-subscription/:statusPageId`, `POST .../get-subscription/:statusPageId/:subscriberId` e `PUT .../update-subscription/:statusPageId/:subscriberId`.

Cancelar a inscrição vira uma flag em vez de apagar a linha, então o registro continua na lista do canal com **Está Descadastrado** marcado — útil quando você precisa explicar depois por que um endereço específico parou de receber mensagens.

## Sobre o que os assinantes são notificados

Os assinantes recebem os três tipos de evento citados acima, mas cada origem tem seu próprio interruptor, para que nada saia por acidente.

### Notificações de anúncio

O próprio anúncio carrega **Should subscribers be notified?** (`shouldStatusPageSubscribersBeNotified`), exposto no formulário de criação como a caixa **Notificar assinantes da página de status**, marcada por padrão. Se o anúncio nomear monitores em **Monitores afetados (Opcional)**, a notificação fica restrita a esses monitores; deixe em branco e todos os assinantes são notificados.

### Eventos de manutenção programada

Um evento de manutenção programada tem seu próprio conjunto de colunas de assinante: **Should subscribers be notified when event is created?**, **Should subscribers be notified when event is changed to ongoing?**, **Should subscribers be notified when event is changed to ended?**, além de **Subscriber notifications before the event** e **Next subscriber notification before the event at?** para os avisos antecipados. **Páginas de status**, no evento, decide em quais páginas ele aparece, e **Should be visible on status page?** decide se ele aparece.

### Incidentes

`Incident` é o terceiro tipo de evento. O que faz um incidente chegar a uma página de status — quais recursos ele toca e quais estados o mantêm visível — está em [Estados e severidades de incidentes](/docs/incidents/states-and-severities).

A seção **Logs de notificação** no menu lateral da página de status (`{id}/notification-logs`) é para onde você vai quando precisa ver o que a página de fato enviou.

## Personalizar modelos de notificação

O cartão **Modelos de notificação**, em **Configurações de assinantes**, lista os modelos que esta página de status usa, com as colunas **Nome do modelo**, **Tipo de evento** e **Método de notificação** — assim você varia o texto por tipo de evento e por canal, em vez de aceitar uma única mensagem padrão para tudo.

Os modelos de projeto inteiro moram um nível acima, em **Páginas de status → Configurações → Modelos de assinantes**, ao lado de **Modelos de anúncios**.

## Rodapé de e-mail, SMTP próprio e Twilio

Mais três cartões em **Configurações de assinantes** controlam como as mensagens para assinantes saem do seu projeto:

- **Configurações do rodapé do e-mail** — **Habilitar texto personalizado de rodapé do e-mail** e **Texto de Rodapé da Notificação por E-mail ao Assinante** colocam o seu próprio rodapé nos e-mails para assinantes.
- **SMTP Personalizado** — **Configuração SMTP Personalizada** envia o e-mail para assinantes pelo seu servidor de e-mail em vez do padrão.
- **Configuração do Twilio** — **Configuração do Twilio** é a conta Twilio usada para assinantes por SMS.

Vale configurar o SMTP próprio cedo se você tem assinantes por e-mail: uma mensagem que sai do seu domínio tem muito menos chance de ser filtrada e muito mais chance de ser levada a sério pelo cliente que a lê às 2 da manhã.

## Anúncios

Um anúncio é um registro no nível do projeto (o modelo `StatusPageAnnouncement`) que você distribui para uma ou mais páginas de status, opcionalmente restrito a monitores específicos, com uma janela durante a qual ele é exibido.

Você cria um em **Páginas de status → Mais → Anúncios**, ou em **Anúncios** no menu lateral de uma página de status individual. O formulário de criação é um assistente de quatro etapas:

1. **Informações básicas** — **Título do anúncio** (obrigatório, ao menos dois caracteres), **Descrição** (Markdown, opcional) e **Anexos**, para arquivos que devem acompanhar o anúncio na página de status.
2. **Páginas de status** — **Mostrar anúncio nestas páginas de status**, uma seleção múltipla obrigatória. Um anúncio pode atingir várias páginas de uma vez.
3. **Recursos afetados** — **Monitores afetados (Opcional)**. Se você não selecionar nenhum, todos os assinantes são notificados.
4. **Agendamento e configurações** — **Começar a mostrar anúncio em** (obrigatório, o padrão é agora), **Parar de exibir o anúncio em** (opcional) e **Notificar assinantes da página de status** (marcado por padrão).

Os visitantes leem os anúncios em `/announcements`, divididos entre **Anúncios ativos** e **Anúncios anteriores**, cada um marcado com **Anunciado em**. Anúncios que estão no ar também ficam fixados no topo da página de visão geral. Quando não há nada a mostrar, a página diz *Sem anúncios*, com a observação de que nenhum foi publicado até agora.

Os anexos são servidos por `GET {statusPageCrudPath}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`, atrás da mesma verificação de leitura da própria página de status — então um anexo em uma página privada continua privado.

## Como funciona o agendamento de anúncios

**Show At** (`showAnnouncementAt`) e **End At** (`endAnnouncementAt`) governam tudo, mas a página de visão geral e a lista de anúncios fazem perguntas diferentes, e é aí que as pessoas tropeçam.

- **A página de visão geral** mostra um anúncio quando `showAnnouncementAt` está no passado e `endAnnouncementAt` está no futuro ou vazio.
- **A lista `/announcements`** mostra os anúncios cujo `showAnnouncementAt` cai dentro de **Mostrar histórico de anúncios (em dias)** (`showAnnouncementHistoryInDays`, 14 por padrão) e depois os separa, no cliente, entre ativos e anteriores.

Duas consequências que vale planejar:

- **Um anúncio sem data de término nunca expira.** Deixe **Parar de exibir o anúncio em** vazio e ele fica fixado na página de visão geral indefinidamente. Defina uma data de término em tudo o que tiver prazo.
- **Um anúncio antigo, mas ainda ativo, pode sumir da lista.** Se ele começou há mais de `showAnnouncementHistoryInDays`, ele cai fora de `/announcements` mas continua na visão geral. Aumente a janela de histórico se você mantém avisos de longa duração.

Se os anúncios aparecem ou não é decidido pelo cartão **Configurações do anúncio**, em **Configurações avançadas**: **Mostrar anúncios** (`showAnnouncementsOnStatusPage`, `true` por padrão) e **Mostrar histórico de anúncios (em dias)** (14 por padrão). Com **Mostrar anúncios** desligado, o endpoint de anúncios recusa a requisição de saída.

## Modelos de anúncio

Se você publica o mesmo tipo de aviso repetidamente — o alerta mensal de manutenção, aquela degradação recorrente de um terceiro — deixe pronto. **Páginas de status → Configurações → Modelos de anúncios** guarda o modelo `StatusPageAnnouncementTemplate`, e seu formulário pede **Nome do modelo**, **Descrição do modelo**, **Título do anúncio**, **Descrição**, **Mostrar anúncio nestas páginas de status**, **Monitores afetados (Opcional)** e **Notificar assinantes** — assim a distribuição e a decisão de notificar são tomadas uma vez, e não a cada publicação.

## Assinantes de webhook e proteção contra SSRF

Assinantes de webhook recebem uma requisição JSON `POST` a cada evento da página de status, o que faz deles a forma mais fácil de canalizar atualizações da página para um sistema seu — um chatbot, um painel interno, uma fila de chamados.

Como a inscrição é uma operação pública em uma página pública, o OneUptime protege o destino:

- Uma **URL do webhook** genérica é validada antes de ser aceita, e endereços privados, de loopback, link-local e de metadados de nuvem são recusados. Você não consegue apontar uma inscrição para algo dentro da própria rede da instalação do OneUptime.
- Uma **URL do webhook de entrada do Slack** precisa começar com `https://hooks.slack.com/services/`.

Se uma inscrição por webhook é recusada no cadastro, uma URL interna ou malformada é a primeira coisa a verificar.

## Onde ler em seguida

- [Visão geral das páginas de status](/docs/status-pages/index) — o que é uma página de status e como ela é montada.
- [Recursos e grupos da página de status](/docs/status-pages/resources-and-groups) — os monitores e grupos entre os quais os assinantes podem escolher.
- [Marca e domínios da página de status](/docs/status-pages/branding-and-domains) — domínios personalizados, logotipos e a aparência da página para a qual seus e-mails apontam.
- [API pública](/docs/status-pages/public-api) — ler os dados da página de status de forma programática.
- [Estados e severidades de incidentes](/docs/incidents/states-and-severities) — o que coloca um incidente em uma página de status e o que o tira de lá.
- [Configurações e automação de incidentes](/docs/incidents/settings) — as regras no nível do projeto por trás da comunicação de incidentes.
