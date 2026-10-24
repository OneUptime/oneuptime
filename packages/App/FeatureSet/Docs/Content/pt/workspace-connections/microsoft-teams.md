# Microsoft Teams

Conecte o OneUptime ao Microsoft Teams para publicar nos seus canais e chats incidentes, alertas, episódios, manutenções programadas, monitores e atualizações de plantão, dar a cada incidente um canal próprio e deixar os responders agirem pelo Teams: confirmar, resolver, adicionar notas, acionar o plantão, declarar incidentes e perguntar ao OneUptime AI.

:::cards
- [Conectar o Microsoft Teams](#conectar-o-microsoft-teams): O consentimento do administrador, o seu login e o app em cada equipe.
- [Pedir a todos que conectem a conta](#pedir-a-todos-que-conectem-a-conta): Envie uma mensagem, de uma só vez, a cada membro que ainda não conectou a conta.
- [Regras de notificação](#regras-de-notificação): Decida quais eventos são publicados onde, e quais ganham um canal próprio.
- [Conversar com o bot do OneUptime](#conversar-com-o-bot-do-oneuptime): Comandos, perguntas e formulários em um chat com o bot.
- [Marcas de plantão](#marcas-de-plantão): Mantenha a marca de uma equipe igual a quem está de plantão, e acione-a.
- [Agir sobre incidentes, alertas e eventos pelo Microsoft Teams](#agir-sobre-incidentes-alertas-e-eventos-pelo-microsoft-teams): Os botões dos cartões do OneUptime.
:::

## Como funciona

```mermaid title="De um evento no OneUptime a um cartão no Microsoft Teams"
flowchart TB
    event["Um incidente, alerta ou evento<br/>é criado ou muda"] --> rules{"Regras de notificação<br/>cujas condições correspondem"}
    rules -->|"Um canal<br/>para cada um"| own["Um canal próprio<br/>na equipe que você escolher"]
    rules -->|"Publicar em um canal<br/>ou chat existente"| existing["Seus canais e chats"]
    own --> card["Um cartão com botões"]
    existing --> card
    card -->|"Um responder pressiona um"| change["A mudança é feita no OneUptime,<br/>como esse responder"]
```

Três coisas fazem isso funcionar:

- **A conexão do projeto**, feita uma vez: um administrador do Microsoft 365 dá consentimento ao app do OneUptime para a sua organização.
- **O app do OneUptime em cada equipe** em que você quer notificações. A Microsoft só deixa o bot publicar em uma equipe à qual ele foi adicionado.
- **A conexão de cada pessoa**: a conta do Microsoft Teams dela vinculada à conta dela no OneUptime. Botões, comandos e reações agem como essa pessoa, com as permissões dela no projeto.

Uma organização do Microsoft 365 pode estar conectada a mais de um projeto, como produção e staging. O botão de um cartão age no projeto do registro a que se refere. Uma mensagem ao bot age no projeto do canal em que é enviada, como o canal de um incidente, ou então no único projeto em que a conta do Microsoft Teams de quem a envia está conectada. Quando nada indica qual, o bot cita os projetos de que essa pessoa faz parte e pede que ela tente de novo a partir de um canal do projeto que quer.

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

Cada pessoa vincula a própria conta do Microsoft Teams em **Configurações do usuário** > **Espaço de trabalho** > **Microsoft Teams** com **Connect my account with Microsoft Teams**, para agir sobre incidentes e receber mensagens diretas como ela mesma. Essa seção aparece assim que o projeto está conectado ao Microsoft Teams. Para trazer uma equipe inteira de uma vez, consulte [Pedir a todos que conectem a conta](#pedir-a-todos-que-conectem-a-conta).

### Adicionar uma regra de notificação

Vá para **Incidentes** > **Espaço de trabalho** > **Microsoft Teams**. A seção **Espaço de trabalho** lista apenas os espaços de chat que o seu projeto conectou, então **Microsoft Teams** aparece ali assim que é conectado. Crie uma regra, por exemplo uma que publique em um canal do Teams quando um incidente for criado, e depois clique em **Regra de teste** na linha dela.
:::

> [!NOTE]
> Instalar o OneUptime para você mesmo, ou adicioná-lo a um chat, é outra instalação e não permite que ele publique nos canais de uma equipe. **Canais privados** precisam do app adicionado ao próprio canal: abra o canal > "..." > **Manage channel** > **Apps** > **Add an app**. **Canais compartilhados** não podem receber notificações: o Microsoft Teams não suporta bots em canais compartilhados.

## Pedir a todos que conectem a conta

Ninguém pode conectar a conta do Microsoft Teams de outra pessoa, nem mesmo um administrador: cada pessoa entra com a sua própria. Para trazer uma equipe inteira, um **Project Owner** ou **Project Admin** pede a todos de uma vez em **Configurações do projeto** > **Espaço de trabalho** > **Microsoft Teams**. O cartão **Members' Microsoft Teams accounts** diz quantos membros já conectaram a conta. **Ask everyone to connect** faz o bot do OneUptime enviar uma mensagem a cada membro que ainda não a conectou, com um botão **Connect Microsoft Teams account** que conecta a conta dele com um só clique.

- **Quem recebe uma mensagem.** Cada membro do projeto que ainda não conectou a conta do Microsoft Teams e está em uma equipe à qual o app do OneUptime foi adicionado, encontrado ali pelo endereço de e-mail ou pelo nome principal do usuário (UPN). Quem recebeu o pedido nas últimas 24 horas não o recebe de novo, então, ao pedir outra vez no dia seguinte, só recebe o lembrete quem ainda não conectou a conta.
- **O que o cartão diz.** Até onde o envio chegou, enquanto as mensagens saem, e depois quem pediu e quantos membros receberam uma mensagem. Os membros que o OneUptime não encontrou aparecem pelo nome no cartão: adicione o app à equipe deles ou peça que eles mesmos conectem a conta em **Configurações do usuário** > **Espaço de trabalho** > **Microsoft Teams**.
- **O que o botão conecta.** A conta do Microsoft Teams de quem pressiona o botão e entra, à conta do OneUptime dessa mesma pessoa. Uma mensagem repassada a outra pessoa não conecta nada ao membro para quem foi enviada.

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
| **Condições** | A quais eventos a regra se aplica, por exemplo por gravidade, estado, rótulo, monitor ou palavras no título. Elas são verificadas quando um evento é criado e novamente a cada atualização que o OneUptime publica sobre ele, então uma regra para incidentes confirmados age quando um incidente é confirmado. Uma regra nova vale para todo evento, por exemplo **Todos os incidentes**. Para restringi-la, escolha **Somente os incidentes que atendem às condições** e adicione as condições. Com duas ou mais, **Condição de correspondência** diz se todas precisam corresponder ou se basta uma. |
| **Destino** | Onde ela publica: um canal existente de uma equipe que você escolher, os chats que você escolher, um canal para cada incidente (ou alerta, episódio, evento, monitor ou política de plantão) criado em uma equipe que você escolher, ou vários deles juntos. Abaixo da etapa, **O que esta regra faz** diz isso em frases, como o cartão da regra. |
| **Video Call** | Somente incidentes e alertas: inicia uma chamada para cada um. Consulte [Videochamadas](/docs/workspace-connections/video-calls). |

Um canal que a regra cria recebe o nome do seu registro: o incidente INC-42 recebe `inc-42`, o alerta ALT-7 recebe `alt-7` e, em um projeto sem prefixos de número, o incidente 42 recebe `incident-42`. O texto em **Prefixo do nome do canal** vai na frente, então `prod-` vira `prod-inc-42`, e o formulário mostra o nome enquanto você digita. Em um evento de manutenção agendada, o prefixo substitui o prefixo de número: SM-5 recebe `sm-5`, e `maint-` vira `maint-5`. O OneUptime mantém letras, números, espaços, `-` e `_`, até os 50 caracteres que o Microsoft Teams aceita. Se a equipe já tiver um canal com esse nome, como o de outro projeto ou um excluído nos últimos 30 dias, o OneUptime adiciona `-2`, `-3` e assim por diante.

Uma regra cria o seu canal na primeira vez que um evento corresponde a ela: quando o evento é criado, ou depois, quando uma atualização o faz corresponder enquanto ele ainda está aberto. Uma regra para incidentes confirmados cria o canal quando o incidente é confirmado. O Microsoft Teams mostra os canais de uma equipe a todos nela, então o OneUptime não adiciona ninguém a um canal um por um: todos na equipe que você escolher podem abri-lo, como o formulário da regra diz em **Quem entra no canal**. Um incidente, alerta ou episódio privado recebe um canal privado, que só os membros dele veem; adicione pessoas no Microsoft Teams.

Para envolver quem está de plantão, escolha os agendamentos de plantão dessas pessoas em **Mencionar quem está de plantão**. Quando o canal é criado, o OneUptime publica nele, logo depois da primeira mensagem do registro, uma mensagem que menciona com @ quem está de plantão nesses agendamentos, para que o Microsoft Teams avise essas pessoas. Ninguém é acionado. O OneUptime encontra cada pessoa na equipe pela conta do Microsoft Teams que ela conectou ao OneUptime, ou então pelo endereço de e-mail dela. Quem não está na equipe não pode abrir os canais dela, então, em vez disso, a mensagem traz o nome dessa pessoa e o motivo. Em um canal privado, só os membros dele podem abri-lo, então adicione as pessoas de plantão a ele no Microsoft Teams.

Toda atualização posterior do registro — uma mudança de estado, uma nota, um novo proprietário — é publicada nos seus canais, e nos canais e chats existentes que as suas regras indicam enquanto as condições delas corresponderem. O OneUptime não consegue arquivar um canal do Microsoft Teams, então o canal de uma regra fica quando o registro dele termina; arquive-o ou exclua-o no Microsoft Teams.

Um incidente, alerta, episódio ou evento de manutenção agendada com um canal próprio tem **Abrir no Microsoft Teams** no cabeçalho da sua página no OneUptime, ao lado dos botões de estado. Ele abre esse canal em uma nova aba, no aplicativo do Microsoft Teams ou no navegador. Um registro com dois canais próprios lista os dois sob o botão. Um registro com canais tanto no Slack quanto no Microsoft Teams tem, em vez disso, um único botão **Abrir canal**, que lista todos eles. Os canais e chats existentes em que as suas regras publicam não são oferecidos.

A página do registro também tem um cartão **Canal do Microsoft Teams**, que diz quem pode abrir o canal: todos da equipe ou, em um canal privado, os membros dele, que os proprietários do canal adicionam no Microsoft Teams. O OneUptime não muda quem está em um canal do Microsoft Teams. Em um canal do Slack, o cartão lista quem está nele e adiciona pessoas: veja [Quem está no canal de um registro](/docs/workspace-connections/slack#quem-está-no-canal-de-um-registro).

Canais e chats continuam legíveis: cada evento é publicado uma vez, e o primeiro estado de um registro vem no cartão que anuncia o registro, não em um cartão à parte. Uma execução de uma política de plantão é um só cartão, editado à medida que a execução escala: quem foi acionado, quantas vezes e como, quem não foi e por quê, e quem confirmou. Um novo cartão só é publicado quando alguém precisa agir: uma regra de escalonamento não alcançou ninguém, ou a execução terminou sem que ninguém confirmasse. Que os proprietários do registro ou os assinantes da página de status foram avisados fica no feed dele no OneUptime.

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
| 📣 ou 📢 | Uma nota pública, mostrada na página de status. Somente incidentes e eventos de manutenção programada. Num incidente privado, uma nota privada, e a confirmação diz por quê. |

A nota mantém a mensagem como o Microsoft Teams a mostrava: a formatação, os links e o código, as pessoas que ela menciona pelo nome, e os arquivos e as imagens como links para eles. Uma nota pública deixa os arquivos e as imagens de fora, já que eles só abrem para a sua equipe.

São as palavras de quem escreveu a mensagem: o nome dessa pessoa no OneUptime quando a conta do Microsoft Teams dela está conectada; caso contrário, o nome que o Teams mostra. Uma nota privada entra na linha do tempo no momento em que a mensagem foi publicada, não importa quanto tempo depois seja salva. Uma nota pública entra no momento em que é salva, que é quando a página de status a mostra. A linha do tempo diz quem a salvou. A nota não é publicada de volta no canal, onde a mensagem já está.

A nota é salva como você, com as suas permissões, e o app do OneUptime precisa estar na equipe. Se a sua conta do Microsoft Teams ainda não estiver conectada, o OneUptime pede que você a conecte, em uma resposta que menciona você, com um botão que salva a mensagem assim que você fizer isso.

## Conversar com o bot do OneUptime

Envie uma mensagem ao bot em um chat pessoal, ou mencione o OneUptime com @ em um canal ou em um chat em grupo: ali ele só responde quando é mencionado.

| Mensagem | O que o bot faz |
| --- | --- |
| `help` | Lista o que ele sabe fazer. |
| `incident [title or number]` | Abre o formulário de incidente, com o título preenchido. O número de um incidente, como `42` ou `INC-42`, mostra esse incidente em vez disso: consulte [Gerenciar um incidente pelo Microsoft Teams](#gerenciar-um-incidente-pelo-microsoft-teams). |
| `maintenance [title]` | Abre o formulário de manutenção programada, com o título preenchido. |
| `oncall` | Lista quem está de plantão agora em cada agendamento de plantão que você pode ver, até quando, e quem é o próximo. |
| `page [who] [message]` | Aciona as pessoas que você menciona com @ sobre a sua mensagem, ou envia um cartão para escolher quem acionar. Consulte [Acionar alguém pelo Microsoft Teams](#acionar-alguém-pelo-microsoft-teams). |
| `ask [question]`, ou qualquer pergunta em linguagem natural | O OneUptime AI responde sobre seus logs, traces, métricas, incidentes e monitores, por exemplo "quais monitores estão fora do ar agora?". As respostas apenas leem. |
| `show active incidents`, `show active alerts` | Lista o que está aberto agora. |
| `show scheduled maintenance`, `show ongoing maintenance` | Lista os eventos de manutenção futuros, ou em andamento. |

Exceto as listas `show`, estas são as palavras que vêm depois de `/oneuptime` no Slack; `create incident` e `create maintenance` continuam funcionando. Perguntar ao OneUptime AI requer a sua própria conta do Microsoft Teams conectada e a IA ativada para o projeto. Se a sua não estiver conectada, o bot pede uma vez em cada thread ou chat que você a conecte, com um botão **Connect Microsoft Teams account**. Consulte [Pergunte à IA](/docs/ai/ask-ai).

## A sua página inicial no Microsoft Teams

Digite `home` para o bot do OneUptime, e ele responde com a sua página inicial: um cartão com o que está acontecendo no projeto, do jeito que você pode ver.

- **Seu plantão.** Os agendamentos de plantão em que você está de plantão agora, e até quando, ou então o seu próximo turno.
- **O que está aberto.** Os incidentes e alertas abertos mais recentes que você pode ler, cada um com um link para a página dele no OneUptime.
- **Os botões.** **Declare incident** e **Page someone** respondem como `incident` e `page`, **Who's on call** como `oncall`, e **Refresh** lê o cartão de novo, no mesmo lugar.

Quando você adiciona o aplicativo OneUptime para você mesmo, o bot envia a sua página inicial na hora. A página inicial e as listas `show` leem como você, então precisam da sua própria conta do Microsoft Teams conectada: enquanto ela não estiver, o bot responde com um botão **Connect Microsoft Teams account**. **Abrir o OneUptime no Microsoft Teams**, em **Configurações do usuário** > **Espaço de trabalho** > **Microsoft Teams**, abre o aplicativo no Teams.

Quando o aplicativo é adicionado a uma equipe, o bot cumprimenta ali: como fazer uma pergunta a ele e onde adicionar uma regra de notificação que publique nos canais da equipe.

## Criar incidentes e manutenções pelo Microsoft Teams

Digitar `incident` ou `maintenance` para o bot do OneUptime abre um formulário para a pessoa que digitou, em um chat pessoal, um canal ou um chat em grupo da mesma forma. Ele é preenchido como essa pessoa: como a conta do OneUptime à qual a conta do Microsoft Teams dela está conectada (consulte [Conectar o Microsoft Teams](#conectar-o-microsoft-teams)), com as permissões dessa conta no projeto. Quem não tem a conta conectada, ou cuja conta do OneUptime não é mais membro do projeto, é orientado sobre o que fazer em uma resposta que o menciona, em vez de receber o formulário.

- **Quem pode usá-los.** As pessoas que podem declarar um incidente ou criar um evento de manutenção programada no OneUptime: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** e **Incident Member** para um incidente (**Create Incident** em uma função personalizada), e **Scheduled Maintenance Admin** e **Scheduled Maintenance Member** para um evento (**Create Scheduled Maintenance**). Qualquer outra pessoa é avisada, e não recebe formulário.
- **O que um formulário oferece.** Cada lista — gravidades, monitores, status de monitor, políticas de plantão e rótulos — contém o que a pessoa que o pediu pode ler, como a mesma lista no OneUptime, e as notas "not shown" do cartão contam só esses: com uma função limitada a alguns rótulos, os monitores e as políticas de plantão que têm esses rótulos. Uma lista que ela não pode ler de forma alguma fica de fora. Políticas de plantão arquivadas nunca são oferecidas.
- **O que um formulário pode indicar.** Em um canal ou em um chat em grupo, qualquer pessoa presente pode enviar o formulário, e ele é enviado como quem o envia, com as permissões dela. O incidente ou evento é criado com essas permissões e atribuído a essa pessoa. Um monitor, política de plantão, rótulo, gravidade ou status que ela não pode ler, ou um de outro projeto, é recusado como um que o projeto não tem, e nada é criado: o bot responde "One of the values you picked ... is not available in this project any more. Please pick it again."

**Execute On-Call Policy** em um incidente, alerta ou episódio funciona do mesmo jeito: requer permissão para executar uma política de plantão (**Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** e **On-Call Member**, ou **Create On-Call Duty Policy Execution Log** em uma função personalizada) e para ler esse incidente, alerta ou episódio, e oferece as políticas de plantão ativas que a pessoa pode ler. Ver um monitor ou uma política de plantão a partir de um cartão também o lê como a pessoa que pressionou o botão.

## Acionar alguém pelo Microsoft Teams

Em um canal ou em um chat em grupo, `@OneUptime page @Nawaz Dhandala The checkout API is throwing 500s` aciona o Nawaz na hora. O OneUptime cria um alerta cujo título é a sua mensagem, e cada pessoa que você menciona com @ recebe uma ligação, um SMS, uma notificação push ou um e-mail, conforme as próprias regras de plantão dela, até que alguém confirme o alerta.

- **Quem é acionado na hora.** As pessoas que você menciona com @, e quem está de plantão nos agendamentos que uma marca que você menciona com @ segue (veja [Marcas de plantão](#marcas-de-plantão)), quando uma mensagem vem depois delas. O OneUptime reconhece uma pessoa pela conta do OneUptime à qual a conta do Microsoft Teams dela está conectada, ou então pelo endereço de e-mail dela no Microsoft Teams. Ninguém de fora do projeto é acionado.
- **Todo o resto recebe um cartão.** Sem ninguém mencionado com @, como em um chat pessoal com o bot, sem mensagem, com uma marca que não segue nenhum agendamento de plantão que você possa ver, ou com uma pessoa que o OneUptime não reconhece, o bot responde com o cartão **Page someone**, com o que você digitou já preenchido, e diz quem não conseguiu escolher. Escolha pessoas, uma equipe, um agendamento de plantão, que aciona quem estiver de plantão nele agora, ou uma política de plantão, que aciona pelas regras de escalonamento dela, e envie o cartão. Qualquer pessoa na conversa pode enviar o cartão, como ela mesma. Depois que ele aciona, o cartão é removido, para que ninguém acione com ele duas vezes.
- **Onde aparece.** A conversa mostra o acionamento como um único cartão, mantido atualizado: quem foi acionado e como, e quem confirmou. Onde o bot não pode publicá-lo, a resposta dele diz quem foi acionado, com um link para o alerta.
- **Quem pode acionar.** Quem pode tanto executar uma política de plantão quanto criar um alerta: **Project Owner**, **Project Admin** e **Project Member**, ou **On-Call Member** junto com **Alert Member** (**Create On-Call Duty Policy Execution Log** e **Create Alert** em uma função personalizada). Acionar pessoas, uma equipe ou um agendamento diretamente, sem uma política de plantão por trás do acionamento, também exige acesso a todas as políticas de plantão do projeto. Qualquer outra pessoa é avisada em uma resposta, e ninguém é acionado. No OneUptime Cloud, acionar exige o plano Growth: abaixo dele, o OneUptime diz qual plano é necessário, e ninguém é acionado.

## Marcas de plantão

Mantenha uma marca do Microsoft Teams, como `@Payments on-call`, igual a quem está de plantão em um ou mais agendamentos de plantão, para que qualquer pessoa da equipe dela possa mencioná-la com @ e falar com eles. O OneUptime muda os membros da marca a cada passagem de turno e substituição, e a verifica a cada 15 minutos.

:::steps
### Conectar uma marca a um agendamento

Abra o agendamento em **Plantão** > **Agendamentos de plantão**. No cartão **Marcas do Microsoft Teams** dele, clique em **Conectar marca**, escolha a equipe e dê um nome à marca: a marca da equipe com esse nome, ou uma nova criada pelo OneUptime. Os membros dela são substituídos na hora por quem está de plantão.

### Conectá-la também ao agendamento secundário

Para uma marca com o plantão principal e o secundário, conecte a mesma marca na página do agendamento secundário. Uma marca pode seguir quantos agendamentos você quiser.
:::

- **O que o cartão mostra.** Quem está em cada marca agora, a equipe dela, os outros agendamentos que ela segue e se o status dela é **Atualizado**. Uma marca só inclui membros da sua equipe: quem está de plantão mas não está na equipe aparece com o motivo.
- **Ninguém de plantão.** O OneUptime tira todos da marca até alguém estar de plantão. Uma marca nova precisa de alguém da equipe de plantão, porque o Microsoft Teams não cria marcas vazias.
- **Acionar a marca.** `@OneUptime page @Payments on-call The checkout API is down` aciona quem está de plantão nos agendamentos que a marca segue. Veja [Acionar alguém pelo Microsoft Teams](#acionar-alguém-pelo-microsoft-teams).
- **O que o Microsoft 365 exige.** Alterar marcas exige a permissão `TeamworkTag.ReadWrite.All` do app, que um administrador do Microsoft 365 concede com **Conceder Consentimento de Administrador** em **Configurações do projeto** > **Espaço de trabalho** > **Microsoft Teams**. Se a sua organização deu o consentimento antes de o OneUptime poder manter marcas, dê de novo uma vez.
- **Quem pode conectar uma.** As funções que podem editar agendamentos: **Project Owner**, **Project Admin**, **Project Member**, **On-Call Admin** e **On-Call Member**, ou **Edit On-Call Duty Policy Schedule** em uma função personalizada. No OneUptime Cloud, conectar uma exige o plano **Growth**.
- **Desconectar.** O OneUptime para de mudar a marca. A marca e os membros dela ficam no Microsoft Teams como estão.

## Gerenciar um incidente pelo Microsoft Teams

O cartão de um incidente tem quatro botões, **Acknowledge Incident**, **Resolve Incident**, **Add Note** e **View Incident**, e o resto no menu dele, o botão de três pontos:

| Item do menu | O que faz |
| --- | --- |
| **Change Severity** | Define a severidade do incidente. |
| **Change Incident State** | Leva o incidente a um estado posterior. |
| **Assign Role** | Dá a alguém uma função no incidente, como **Incident Commander**. Uma função de uma só pessoa passa para ela. |
| **Page Someone** | Aciona pessoas, uma equipe, quem estiver de plantão em um agendamento, ou uma política de plantão sobre o incidente, até que alguém o confirme. |
| **Edit Custom Fields** | Define os campos personalizados do incidente, cada um preenchido com o que o incidente tem. Um campo deixado vazio é limpo. |

`incident 42`, digitado para o bot, responde com o incidente 42, esses botões e o menu dele. Digite o número como o OneUptime o mostra: `42`, `#42` ou `INC-42`. No canal próprio de um incidente, `incident` sozinho mostra esse incidente.

- **Quem pode usá-los.** As pessoas que podem fazer a mesma alteração no OneUptime, como no Slack: consulte [Gerenciar um incidente pelo Slack](/docs/workspace-connections/slack#gerenciar-um-incidente-pelo-slack). Cada item responde com um cartão, preenchido como a pessoa que o pressionou pode ver o incidente. Qualquer pessoa na conversa pode enviar o cartão, como ela mesma, com as próprias permissões.
- **O que acontece.** A alteração é feita como a pessoa que enviou o cartão, como no OneUptime, e o feed do incidente diz o que mudou. O bot diz isso em uma resposta que a menciona, e remove o cartão, para que ninguém o envie duas vezes. **Page Someone** diz quem foi acionado, ou por que ninguém foi; um incidente que já está resolvido não aciona ninguém.
- **Onde o Microsoft Teams é diferente.** Um cartão não consegue dizer abaixo de um campo o que está errado: um valor que não cabe é indicado em uma resposta, e o cartão fica para ser corrigido e enviado de novo. Um campo de data e hora é um dia e uma hora, no seu próprio fuso horário. Um cliente antigo do Teams mostra o menu como mais botões. `incident 42` responde na conversa, onde todos que estão nela podem ver o incidente.
- **Cartões publicados antes do menu.** Eles mantêm o botão **Execute On-Call Policy**, que continua funcionando: **Page Someone** também aciona uma política de plantão. Alertas e episódios mantêm o deles.

## Agir sobre incidentes, alertas e eventos pelo Microsoft Teams

Os botões dos cartões do OneUptime agem como a pessoa que os pressiona, em um chat pessoal, um canal ou um chat em grupo da mesma forma: como a conta do OneUptime à qual a conta do Microsoft Teams dela está conectada, com as permissões dessa conta no projeto. **Acknowledge**, **Resolve**, **Change State**, **Add Note** e **Execute On-Call Policy** em um incidente, um alerta ou um episódio, e **Mark as Ongoing**, **Mark as Complete**, **Change State** e **Add Note** em um evento de manutenção programada, fazem cada um a mudança que a mesma ação faz no OneUptime, e ela é atribuída a essa pessoa ali: a linha do tempo de estados e o feed do registro mostram quem mudou o estado, e a nota é dela. Uma nota salva a partir de uma mensagem com uma reação é publicada do mesmo jeito.

- **Quem pode usá-los.** As pessoas que podem fazer a mesma mudança no OneUptime. Confirmar, resolver ou mudar o estado de um incidente requer permissão para mudar o estado dele: **Project Owner**, **Project Admin**, **Project Member**, **Incident Admin** e **Incident Member**, ou **Create Incident State Timeline** em uma função personalizada. Um alerta, um episódio ou um evento de manutenção programada requer a mesma permissão para o seu próprio tipo (**Create Alert State Timeline**, por exemplo), e uma nota requer permissão para publicar esse tipo de nota. Como o painel de estado do OneUptime, eles não pedem permissão para editar o incidente ou o alerta em si. Qualquer outra pessoa é avisada, e nada muda.
- **Quais registros.** Os que a pessoa pode ler, como no OneUptime: com uma função limitada a alguns rótulos, os incidentes, alertas, episódios e eventos que os têm. Um botão em qualquer outro registro diz por quê, e nada muda: em um incidente que a função dela não alcança, "your access in this project does not include this incident. Ask a project admin for access to it."; em um incidente privado do qual ela não é responsável, "this incident is private, so only its owners and the project's owners and admins can see it. Ask one of them to add you as an owner."; e em um excluído desde então, "the incident was not found. It may have been deleted." No OneUptime Cloud, uma mudança que o plano do projeto não inclui é recusada indicando o plano necessário.
- **O que Change State oferece.** Os estados que a pessoa pode ler para os quais o registro pode passar em seguida, na ordem do projeto: nenhum anterior ao estado em que ele está, tanto para um episódio como para um incidente, um alerta ou um evento de manutenção programada, já que uma mudança de estado nunca faz um registro voltar a subir na sua lista (consulte [A ordem é uma restrição real, não uma preferência de exibição](/docs/incidents/states-and-severities#a-ordem-é-uma-restrição-real-não-uma-preferência-de-exibição)). Quando ela não pode ler nenhum, o bot diz "No incident states are available to you in this project. Ask a project admin for access to them."; quando o registro está no último estado que pode alcançar, ele diz "There is no later state to move this incident to." Nenhum dos dois mostra um cartão vazio.
- **Add Note num incidente privado.** Um incidente privado não aceita notas públicas, então o cartão não pede tipo de nota e adiciona uma nota privada. Um cartão enviado antes de ele se tornar privado também adiciona uma nota privada, e diz isso. Veja [Incidentes privados aceitam apenas notas privadas](/docs/incidents/notes-owners-and-feed#incidentes-privados-aceitam-apenas-notas-privadas).
- **Escalate.** O **Escalate** de um cartão executa a política de plantão dele para o incidente, alerta ou episódio do cartão, como a pessoa que o pressionou, com as mesmas permissões de **Execute On-Call Policy**. Um cartão que não trata de nenhum deles recebe como resposta "This on-call policy can only be executed for an incident, an alert or an episode. Open the record you are paging about and use Execute On-Call Policy there.", e ninguém é acionado.
- **Onde a pessoa recebe a resposta.** Em uma resposta na mesma conversa, a thread do cartão em um canal, que menciona a pessoa, para que o Microsoft Teams a avise. Um botão pressionado tarde demais diz quem chegou primeiro, e quando, por exemplo "Incident INC-2 was already acknowledged by Simon Lee at 6:07 PM."
- **Se a conta dela não estiver conectada.** A resposta pede que ela a conecte, com um botão **Connect Microsoft Teams account**. O botão abre as configurações do Microsoft Teams da própria pessoa no OneUptime e conecta a conta em uma única etapa, depois que ela entra no OneUptime, se precisar. Em seguida, o OneUptime conclui o que ela pressionou, como ela, e responde na mesma conversa; para um botão que abre um formulário, ou um comando, ele pede que ela o pressione ou digite de novo. O botão funciona uma vez, por 30 minutos, e só para a conta Microsoft que o pressionou.

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
Pressione **Connect Microsoft Teams account** na resposta do bot para conectá-la em uma única etapa, ou vincule-a em **Configurações do usuário** > **Espaço de trabalho** > **Microsoft Teams** com **Connect my account with Microsoft Teams**. Em ambos os casos, você entra na organização à qual o projeto está conectado, como convidado se for convidado nela. Se você é convidado e já conectou a conta da sua própria organização, conecte-a novamente.
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
