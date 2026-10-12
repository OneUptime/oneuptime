# Microsoft Teams

Conecte o OneUptime ao Microsoft Teams para publicar nos seus canais e chats incidentes, alertas, episódios, manutenções programadas, monitores e atualizações de plantão, dar a cada incidente um canal próprio e deixar os responders agirem pelo Teams: confirmar, resolver, adicionar notas, acionar o plantão, declarar incidentes e perguntar ao OneUptime AI.

:::cards
- [Conectar o Microsoft Teams](#conectar-o-microsoft-teams): O consentimento do administrador, o seu login e o app em cada equipe.
- [Regras de notificação](#regras-de-notificação): Decida quais eventos são publicados onde, e quais ganham um canal próprio.
- [Conversar com o bot do OneUptime](#conversar-com-o-bot-do-oneuptime): Comandos, perguntas e formulários em um chat com o bot.
- [Agir sobre incidentes, alertas e eventos pelo Microsoft Teams](#agir-sobre-incidentes-alertas-e-eventos-pelo-microsoft-teams): Os botões dos cartões do OneUptime.
:::

## Como funciona

```mermaid title="De um evento no OneUptime a um cartão no Microsoft Teams"
flowchart TB
    event["Um incidente, alerta ou evento<br/>é criado ou muda"] --> rules{"Regras de notificação<br/>cujas condições correspondem"}
    rules -->|"Create Microsoft Teams Channel"| own["Um canal próprio<br/>na equipe que você escolher"]
    rules -->|"Publicar em um canal<br/>ou chat existente"| existing["Seus canais e chats"]
    own --> card["Um cartão com botões"]
    existing --> card
    card -->|"Um responder pressiona um"| change["A mudança é feita no OneUptime,<br/>como esse responder"]
```

Três coisas fazem isso funcionar:

- **A conexão do projeto**, feita uma vez: um administrador do Microsoft 365 dá consentimento ao app do OneUptime para a sua organização.
- **O app do OneUptime em cada equipe** em que você quer notificações. A Microsoft só deixa o bot publicar em uma equipe à qual ele foi adicionado.
- **A conexão de cada pessoa**: a conta do Microsoft Teams dela vinculada à conta dela no OneUptime. Botões, comandos e reações agem como essa pessoa, com as permissões dela no projeto.

## Antes de começar

- **Uma função que possa conectar o projeto:** **Project Owner**, **Project Admin** ou **Project Member**. Desinstalar requer **Project Owner** ou **Project Admin**.
- **Um administrador do Microsoft 365** para conceder o consentimento do administrador, uma vez para toda a organização.
- **O plano Growth no OneUptime Cloud** para regras de notificação e resumos. Consulte [Regras de notificação abaixo do plano Growth](#regras-de-notificação-abaixo-do-plano-growth).
- **Em um servidor auto-hospedado,** antes um bot do Teams configurado para ele. Consulte [Integração com Microsoft Teams](/docs/self-hosted/microsoft-teams-integration).

## Conectar o Microsoft Teams

:::steps
### Conceder o consentimento do administrador

Vá para **Configurações do projeto** > **Espaço de trabalho** > **Microsoft Teams** e clique em **Conceder Consentimento de Administrador**. Um administrador do Microsoft 365 entra e autoriza o app do OneUptime para a organização. Depois o cartão diz **Admin Consent Completed**. Enquanto nenhum workspace estiver conectado, a seção **Espaço de trabalho** dos menus Incidentes, Alertas, Manutenção programada, Monitores e Plantão contém **Conectar Slack ou Teams**, que também leva até aqui.

### Conectar a sua conta

Clique em **Connect with Microsoft Teams** e entre com a sua conta corporativa. O OneUptime lê as equipes da sua organização; **Ver equipes** as lista.

### Adicionar o app do OneUptime a cada equipe (obrigatório)

Conectar a sua conta não basta por si só. A Microsoft só deixa o bot do OneUptime publicar em uma equipe à qual ele foi adicionado, então faça isto para cada equipe em que você quer notificações:

- No Microsoft Teams, clique em "..." ao lado do **nome da equipe** (não do nome do canal).
- Escolha **Manage team** > **Apps** > **More apps**, procure **OneUptime** e clique em **Add**.

No OneUptime Cloud, **Abrir a Teams Store** abre o app na loja do Microsoft Teams, onde **Add to a team** faz o mesmo. Em um servidor auto-hospedado, instale em vez disso o pacote de **Baixar o zip do manifesto do app**: só ele traz o bot do seu servidor. Se uma notificação de teste disser que o app do OneUptime não está instalado na equipe, foi esta a etapa que faltou.

### Conectar todos os outros

Cada pessoa vincula a própria conta do Microsoft Teams em **Configurações do usuário** > **Espaço de trabalho** > **Microsoft Teams** com **Connect my account with Microsoft Teams**, para agir sobre incidentes e receber mensagens diretas como ela mesma. Essa seção aparece assim que o projeto está conectado ao Microsoft Teams.

### Adicionar uma regra de notificação

Vá para **Incidentes** > **Espaço de trabalho** > **Microsoft Teams**. A seção **Espaço de trabalho** lista apenas os espaços de chat que o seu projeto conectou, então **Microsoft Teams** aparece ali assim que é conectado. Crie uma regra, por exemplo uma que publique em um canal do Teams quando um incidente for criado, e depois clique em **Regra de teste** na linha dela.
:::

> [!NOTE]
> Instalar o OneUptime para você mesmo, ou adicioná-lo a um chat, é outra instalação e não permite que ele publique nos canais de uma equipe. **Canais privados** precisam do app adicionado ao próprio canal: abra o canal > "..." > **Manage channel** > **Apps** > **Add an app**. **Canais compartilhados** não podem receber notificações: o Microsoft Teams não suporta bots em canais compartilhados.

## Regras de notificação

Uma regra de notificação diz quais eventos são publicados no Microsoft Teams, e onde. Cada produto tem as suas próprias regras, em **Espaço de trabalho** > **Microsoft Teams** no seu menu:

| Produto | Abas da sua página **Microsoft Teams** |
| --- | --- |
| **Incidentes** | **Incidentes**, **Incidente Episódios**, **Summary** |
| **Alertas** | **Alertas**, **Alerta Episódios**, **Summary** |
| **Manutenção programada** | Uma lista de regras |
| **Monitores** | Uma lista de regras |
| **Plantão** | Uma lista de regras |

Criar uma regra passa por quatro etapas:

| Etapa | O que você define |
| --- | --- |
| **Básico** | **Nome da regra** e **Descrição da regra**. |
| **Condições** | Para quais eventos a regra dispara, por exemplo por gravidade, estado, rótulo, monitor ou palavras no título. Sem condições, ela dispara para todo evento. Com duas ou mais, **Condição de correspondência** diz se todas precisam corresponder ou se basta uma. |
| **Destino** | Onde ela publica: um canal existente de uma equipe que você escolher, os chats que você escolher, um novo canal criado em uma equipe que você escolher, ou vários deles juntos. |
| **Video Call** | Somente incidentes e alertas: inicia uma chamada para cada um. Consulte [Videochamadas](/docs/workspace-connections/video-calls). |

Um canal que a regra cria recebe o nome de **New Microsoft Teams Channel Name** seguido do número do registro, como `oneuptime-incident-42`, e só um canal criado recebe as pessoas que a regra convida. Um incidente, alerta ou episódio privado recebe um canal privado. Toda atualização posterior do registro — uma mudança de estado, uma nota, um novo proprietário — é publicada nos seus canais e chats.

**Configurações do projeto** > **Espaço de trabalho** > **Microsoft Teams** lista os canais que o OneUptime vê nas suas equipes, e os chats aos quais ele foi adicionado, com **Enviar teste** ao lado de cada um. Um chat aparece assim que o app do OneUptime é adicionado a ele no Microsoft Teams; **Refresh Chats** traz os novos chats e os nomes atuais deles.

## Testar uma regra

**Regra de teste** na linha de uma regra publica uma mensagem de teste dessa regra nos canais que ela indica, para você vê-la chegar. Se a regra cria um canal para cada evento, o teste também cria um e convida para ele as pessoas da regra.

Como **Enviar teste** ao lado de um canal em **Configurações do projeto** > **Espaço de trabalho** > **Microsoft Teams**, ele requer permissão para criar regras de notificação: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member**, ou **Create Workspace Notification Rule** e **Read Workspace Notification Rule** em uma função personalizada. Para quem só pode ver as regras, como um **Viewer**, **Regra de teste** fica bloqueado, e a sua dica diz o que é preciso; a API recusa o teste dessa pessoa com "You do not have permission to send test notifications in this project." No OneUptime Cloud, testar uma regra requer o plano **Growth**, assim como adicionar uma.

No OneUptime Cloud, **Enviar teste** ao lado de um canal ou de um chat também requer o plano **Growth**, já que publicar em um canal é o que regras e resumos fazem. **Enviar teste agora** em um resumo requer permissão para criar resumos (**Create Workspace Notification Summary** e **Read Workspace Notification Summary** em uma função personalizada) e, no OneUptime Cloud, o plano **Growth**; para qualquer outra pessoa fica bloqueado, e a sua dica diz o que é preciso. Um cliente MCP conectado com acesso somente leitura não pode enviar nenhum teste.

## Resumos

A aba **Summary** de **Incidentes** > **Espaço de trabalho** > **Microsoft Teams** (e de **Alertas**) publica um resumo periódico nos canais que você indicar: quantos incidentes ou alertas houve, com que rapidez foram confirmados e resolvidos, e uma lista com links. Um novo resumo sai toda semana e cobre os últimos 7 dias. Deixe **Enviar primeiro relatório às** vazio, e o primeiro sai às 09:00 no início da próxima semana, dia ou mês; o formulário diz quando.

Um resumo sai pelo relógio do seu **Fuso horário**, que começa com o seu. Ele mantém ali o seu horário do dia o ano todo: um definido para 09:00 em Berlim continua saindo às 09:00 em Berlim depois da mudança para o horário de verão, e as datas da sua mensagem também são as de Berlim. Pela API, envie `timezone` como um nome de fuso horário IANA, como `Europe/Berlin`. Um resumo criado sem fuso horário usa o do perfil de quem o criou, ou UTC quando uma chave de API o cria.

O formulário de um resumo tem quatro etapas: **Informações básicas** (o nome, os canais e o **Nome da Equipe** deles), **Agendamento**, **Conteúdo** (**O que incluir**) e **Filtros** (quais incidentes ou alertas ele conta).

## Regras de notificação abaixo do plano Growth

No OneUptime Cloud, regras de notificação e resumos estão no plano **Growth** e acima. Um projeto abaixo dele mantém as regras e os resumos que já tem, e eles continuam publicando no Microsoft Teams. Por isso a página **Microsoft Teams** de cada produto (Incidentes, Alertas, Manutenção programada, Plantão, Monitores) mostra o aviso do plano com eles listados abaixo (**Regras de notificação ainda configuradas**, **Resumos ainda configurados**): exclua uma regra, ou desative ou exclua um resumo. Adicionar ou alterar regras e resumos requer **Growth**.

## Ser acionado no Microsoft Teams

Para ser acionado por mensagem direta quando estiver de plantão, adicione o Microsoft Teams como um dos seus métodos de notificação:

:::steps
1. Conecte a sua própria conta do Microsoft Teams (consulte [Conectar o Microsoft Teams](#conectar-o-microsoft-teams)).
2. Vá para **Configurações do usuário** > **Métodos de notificação**, abra a aba **Workspace Apps** e clique em **Add Microsoft Teams Account**.
3. Clique em **Send Test Message** na linha dele. A mensagem chega aos seus chats do Microsoft Teams.
:::

Adicioná-lo o inclui imediatamente nas suas regras de plantão, então a partir daí os acionamentos chegam a você no Microsoft Teams. Altere quais acionamentos ele recebe em **Configurações do usuário** > **Regras de Plantão**.

## Salvar mensagens como notas

Reaja a uma mensagem, ou a uma resposta, no canal que o OneUptime criou para um incidente, alerta, episódio ou evento de manutenção programada, e o OneUptime a salva como nota nesse registro. Ele percebe a reação em até um minuto e confirma com uma resposta na thread:

| Reação | Salva como |
| --- | --- |
| 📌 ou 📍 | Uma nota privada, vista só pela sua equipe |
| 📣 ou 📢 | Uma nota pública, mostrada na página de status. Somente incidentes e eventos de manutenção programada. |

A nota é salva como você, com as suas permissões, então a sua própria conta do Microsoft Teams precisa estar conectada, e o app do OneUptime precisa estar na equipe.

## Conversar com o bot do OneUptime

Envie uma mensagem ao bot em um chat pessoal, ou mencione o OneUptime com @ em um canal ou em um chat em grupo: ali ele só responde quando é mencionado.

| Mensagem | O que o bot faz |
| --- | --- |
| `help` | Lista o que ele sabe fazer. |
| `ask <question>`, ou qualquer pergunta em linguagem natural | O OneUptime AI responde sobre seus logs, traces, métricas, incidentes e monitores, por exemplo "quais monitores estão fora do ar agora?". As respostas apenas leem. |
| `create incident [title]` | Abre o formulário de incidente, com o título preenchido. |
| `create maintenance [title]` | Abre o formulário de manutenção programada, com o título preenchido. |
| `show active incidents`, `show active alerts` | Lista o que está aberto agora. |
| `show scheduled maintenance`, `show ongoing maintenance` | Lista os eventos de manutenção futuros, ou em andamento. |

Perguntar ao OneUptime AI requer a IA ativada para o projeto. Consulte [Pergunte à IA](/docs/ai/ask-ai).

## Criar incidentes e manutenções pelo Microsoft Teams

Digitar `create incident` ou `create maintenance` para o bot do OneUptime abre um formulário para a pessoa que digitou, em um chat pessoal, um canal ou um chat em grupo da mesma forma. Ele é preenchido como essa pessoa: como a conta do OneUptime à qual a conta do Microsoft Teams dela está conectada (consulte [Conectar o Microsoft Teams](#conectar-o-microsoft-teams)), com as permissões dessa conta no projeto. Quem não tem a conta conectada, ou cuja conta do OneUptime não é mais membro do projeto, é orientado sobre o que fazer em vez de receber o formulário.

- **Quem pode usá-los.** As pessoas que podem declarar um incidente ou criar um evento de manutenção programada no OneUptime: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** e **Incident Member** para um incidente (**Create Incident** em uma função personalizada), e **Scheduled Maintenance Admin** e **Scheduled Maintenance Member** para um evento (**Create Scheduled Maintenance**). Qualquer outra pessoa é avisada, e não recebe formulário.
- **O que um formulário oferece.** Cada lista — gravidades, monitores, status de monitor, políticas de plantão e rótulos — contém o que a pessoa que o pediu pode ler, como a mesma lista no OneUptime, e as notas "not shown" do cartão contam só esses: com uma função limitada a alguns rótulos, os monitores e as políticas de plantão que têm esses rótulos. Uma lista que ela não pode ler de forma alguma fica de fora. Políticas de plantão arquivadas nunca são oferecidas.
- **O que um formulário pode indicar.** Em um canal ou em um chat em grupo, qualquer pessoa presente pode enviar o formulário, e ele é enviado como quem o envia, com as permissões dela. O incidente ou evento é criado com essas permissões e atribuído a essa pessoa. Um monitor, política de plantão, rótulo, gravidade ou status que ela não pode ler, ou um de outro projeto, é recusado como um que o projeto não tem, e nada é criado: o bot responde "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** em um incidente, alerta ou episódio funciona do mesmo jeito: requer permissão para executar uma política de plantão (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** e **On-Call Member**, ou **Create On-Call Duty Policy Execution Log** em uma função personalizada) e para ler esse incidente, alerta ou episódio, e oferece as políticas de plantão ativas que a pessoa pode ler. Ver um monitor ou uma política de plantão a partir de um cartão também o lê como a pessoa que pressionou o botão.

## Agir sobre incidentes, alertas e eventos pelo Microsoft Teams

Os botões dos cartões do OneUptime agem como a pessoa que os pressiona, em um chat pessoal, um canal ou um chat em grupo da mesma forma: como a conta do OneUptime à qual a conta do Microsoft Teams dela está conectada, com as permissões dessa conta no projeto. **Acknowledge**, **Resolve**, **Change State**, **Add Note** e **Execute On-Call Policy** em um incidente, um alerta ou um episódio, e **Mark as Ongoing**, **Mark as Complete**, **Change State** e **Add Note** em um evento de manutenção programada, fazem cada um a mudança que a mesma ação faz no OneUptime, e ela é atribuída a essa pessoa ali: a linha do tempo de estados e o feed do registro mostram quem mudou o estado, e a nota é dela. Uma nota salva a partir de uma mensagem com uma reação é publicada do mesmo jeito.

- **Quem pode usá-los.** As pessoas que podem fazer a mesma mudança no OneUptime. Confirmar, resolver ou mudar o estado de um incidente requer permissão para mudar o estado dele: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** e **Incident Member**, ou **Create Incident State Timeline** em uma função personalizada. Um alerta, um episódio ou um evento de manutenção programada requer a mesma permissão para o seu próprio tipo (**Create Alert State Timeline**, por exemplo), e uma nota requer permissão para publicar esse tipo de nota. Como o painel de estado do OneUptime, eles não pedem permissão para editar o incidente ou o alerta em si. Qualquer outra pessoa é avisada, e nada muda.
- **Quais registros.** Os que a pessoa pode ler, como no OneUptime: com uma função limitada a alguns rótulos, os incidentes, alertas, episódios e eventos que os têm. Um botão em qualquer outro registro, ou em um de outro projeto, recebe como resposta que o registro "was not found in this project, or you do not have access to it.", e nada muda. No OneUptime Cloud, uma mudança que o plano do projeto não inclui é recusada indicando o plano necessário.
- **O que Change State oferece.** Os estados que a pessoa pode ler para os quais o registro pode passar em seguida, na ordem do projeto: nenhum anterior ao estado em que ele está, tanto para um episódio como para um incidente, um alerta ou um evento de manutenção programada, já que uma mudança de estado nunca faz um registro voltar a subir na sua lista (consulte [A ordem é uma restrição real, não uma preferência de exibição](/docs/incidents/states-and-severities#a-ordem-é-uma-restrição-real-não-uma-preferência-de-exibição)). Quando ela não pode ler nenhum, o bot diz "No incident states are available to you in this project. Ask a project admin for access to them."; quando o registro está no último estado que pode alcançar, ele diz "There is no later state to move this incident to." Nenhum dos dois mostra um cartão vazio.
- **Escalate.** O **Escalate** de um cartão executa a política de plantão dele para o incidente, alerta ou episódio do cartão, como a pessoa que o pressionou, com as mesmas permissões de **Execute On-Call Policy**. Um cartão que não trata de nenhum deles recebe como resposta "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", e ninguém é acionado.

## Desconectar

- **Disconnect** desvincula apenas a sua própria conta do Microsoft Teams, e remove com ela o seu método de notificação do Microsoft Teams.
- **Uninstall OneUptime from Microsoft Teams**, em **Configurações do projeto** > **Espaço de trabalho** > **Microsoft Teams**, desconecta o projeto. O OneUptime para de publicar no Microsoft Teams, e os menus **Espaço de trabalho** deixam de listá-lo. As regras de notificação e os resumos são mantidos para quando você conectar de novo.

> [!WARNING]
> Desinstalar também desvincula a conta do Microsoft Teams de cada membro do projeto, e remove os métodos de notificação do Microsoft Teams e as regras de plantão que os usavam. Um projeto fica conectado a uma única organização do Microsoft 365: para movê-lo para outra, desinstale primeiro.

## Solução de problemas

:::details Um teste diz que o app do OneUptime não está instalado na equipe
A Microsoft recusou a publicação porque o bot não está nessa equipe. Adicione o app à equipe (consulte [Conectar o Microsoft Teams](#conectar-o-microsoft-teams)) ou, para um canal privado, ao próprio canal. Adicioná-lo a uma equipe não vale para as outras.
:::

:::details O Microsoft Teams não foi conectado
Quando a Microsoft devolve você sem uma conexão, a página de onde você começou diz **O Microsoft Teams não foi conectado**, e uma frase diz por quê: falta a você a permissão, o link já foi usado ou expirou, você entrou em outra organização do Microsoft 365, ou a sua organização ainda não tem equipes. Consulte [A conexão não foi concluída](/docs/self-hosted/microsoft-teams-integration#a-conexão-não-foi-concluída) para cada frase e o que fazer.
:::

:::details O bot diz que a minha conta não está conectada
Vincule-a em **Configurações do usuário** > **Espaço de trabalho** > **Microsoft Teams** com **Connect my account with Microsoft Teams**, conectado à organização à qual o projeto está conectado. Uma conta de convidado de outra organização não é a mesma conta.
:::

:::details Todas as notificações falham em um servidor auto-hospedado
O app do Teams instalado nas suas equipes precisa ser o pacote que o seu servidor gerou, e a Microsoft precisa conseguir alcançar o endpoint do bot do seu servidor. Consulte a solução de problemas da [Integração com Microsoft Teams](/docs/self-hosted/microsoft-teams-integration#solução-de-problemas).
:::

## Próximos passos

:::cards
- [Slack](/docs/workspace-connections/slack): As mesmas notificações e ações no Slack.
- [Videochamadas](/docs/workspace-connections/video-calls): Dê a cada incidente uma chamada, publicada com as suas atualizações.
- [Integração com Microsoft Teams](/docs/self-hosted/microsoft-teams-integration): Configurar o bot do Teams em um servidor auto-hospedado.
- [Declarar um incidente](/docs/incidents/declaring-incidents): Todas as formas como um incidente começa, e o que é executado quando isso acontece.
:::
