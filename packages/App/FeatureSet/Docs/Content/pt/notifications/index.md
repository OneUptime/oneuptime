# Como o OneUptime chega até você

O OneUptime chega até você de duas formas. Ele aciona você quando um incidente ou alerta dispara enquanto você está de plantão, e mantém você a par do que é seu: uma nota no seu incidente, um monitor que mudou de status, o seu próximo turno. As duas chegam aos endereços que você mantém em **Configurações do usuário**, projeto por projeto. Esta página explica como as peças se encaixam, onde ficam e com o que você começa.

:::cards
- [Três páginas, três perguntas](#três-páginas-três-perguntas): Métodos, regras de plantão e configurações de notificação, e o que cada um decide.
- [Onde encontrá-los](#onde-encontrá-los): As páginas das configurações do usuário, seção por seção.
- [Com o que você começa](#com-o-que-você-começa): Os métodos, regras e configurações que um novo membro recebe.
- [Quando nenhuma regra corresponde](#quando-nenhuma-regra-corresponde): Como um acionamento chega até você mesmo assim, e quem fica sabendo.
:::

## Como funciona

```mermaid title="Duas formas de o OneUptime chegar até você, pelos mesmos métodos"
flowchart TB
    page["Um incidente ou alerta<br/>aciona você no plantão"] --> rules["Suas regras de plantão"]
    owned["Algo acontece com<br/>um registro seu"] --> settings["Suas configurações<br/>de notificação"]
    rules --> methods["Seus métodos<br/>verificados: e-mail,<br/>telefone, push, chat"]
    settings --> methods
```

- Uma política de plantão aciona você quando uma das regras de escalonamento dela nomeia você, uma equipe da qual você faz parte ou uma escala em que você está de plantão. Suas regras de plantão decidem então quais dos seus métodos o OneUptime tenta, e depois de quanto tempo.
- Quando algo acontece com um registro seu, ou com os seus turnos, suas configurações de notificação decidem por quais canais a novidade vai.
- Em ambos os casos, o OneUptime só usa métodos que você verificou, no projeto de onde vem o acionamento ou a novidade.

## Três páginas, três perguntas

| Página | O que ela guarda | A pergunta que ela responde |
| --- | --- | --- |
| **Métodos de notificação** | Seus endereços de e-mail, números de telefone, números do WhatsApp, contas do Telegram, Slack e Microsoft Teams, dispositivos push e webhooks | Onde o OneUptime pode me encontrar? |
| **Regras de Plantão** | Para cada tipo de acionamento e cada gravidade, qual método tentar e depois de quanto tempo | Como sou acionado enquanto estou de plantão? |
| **Configurações de notificação** | Para cada evento sobre um registro seu ou sobre os seus turnos, quais canais usar | Do que mais fico sabendo, e onde? |

Elas são separadas de propósito. Ativar todos os canais em **Configurações de notificação** nunca aciona você, e um método que você não verificou nunca é usado, seja o que for que suas regras digam.

> [!IMPORTANT]
> Métodos, regras e configurações pertencem a um projeto. Configure-os em cada projeto em que você trabalha: **Configurações do usuário** sempre mostra o projeto em que você está.

## Onde encontrá-los

Abra **Configurações do usuário**, à direita da barra abaixo da barra superior. O menu lateral reúne tudo sobre como o OneUptime chega até você:

| Seção | Páginas |
| --- | --- |
| **Primeiros passos** | **Lista de configuração**: o que falta configurar, na ordem que importa |
| **Alertas e notificações** | **Métodos de notificação**, **Regras de Plantão**, **Configurações de notificação** e **Preferências de e-mail**, que define quantos e-mails as suas novidades somam |
| **Registros de plantão** | **Registros de plantão**: cada vez que você foi acionado neste projeto, e o que foi enviado |
| **Política de chamadas recebidas** | **Números de telefone recebidos**: o número em que uma política de chamadas recebidas liga para você |
| **Calendário** | **Feed de calendário**: os seus turnos no seu app de calendário, e lembretes antes de começarem |
| **Perfil** | **Campos personalizados**: dados que o seu projeto pede aos membros |
| **Espaço de trabalho** | **Slack** e **Microsoft Teams**: a sua própria conta, em cada espaço de trabalho que o projeto conectou |

**Primeiros passos** e **Alertas e notificações** ficam abertas; as outras seções começam recolhidas, e uma seção se abre sozinha quando você está em uma das páginas dela. **Espaço de trabalho** só aparece quando o projeto conectou o Slack ou o Microsoft Teams.

Proprietários e administradores do projeto também podem ver a sua configuração: em **Usuários**, eles abrem a sua linha e a seção **Plantão** dela, com **Prontidão**, **Métodos de notificação** e **Regras de Plantão**. Eles podem adicionar um método para você ali, mas o código vai para o próprio método, então só você pode verificá-lo.

## Com o que você começa

Quando você entra em um projeto com um e-mail de login verificado, o OneUptime configura você para que um acionamento sempre consiga chegar até você:

1. O seu e-mail de login é adicionado como método de e-mail verificado.
2. Para cada gravidade, em cada uma das quatro abas de **Regras de Plantão**, uma regra envia um e-mail assim que você é acionado.
3. Um conjunto de novidades sobre o que é seu, e sobre os seus turnos, fica ativado por e-mail. Veja [Configurações de notificação](/docs/notifications/notification-settings#o-que-fica-ativado-para-um-novo-membro).

Cada método que você verificar depois recebe as mesmas regras: uma regra para cada gravidade, enviada assim que você é acionado. Então verificar um número de telefone para SMS significa que todo acionamento também manda um SMS para você. Para deixar o SMS só para acionamentos críticos, exclua as regras de SMS das outras gravidades. Veja [Regras de Plantão pessoais](/docs/notifications/on-call-rules#as-regras-com-que-você-começa).

## A lista de configuração

**Configurações do usuário → Lista de configuração** abre **Your setup checklist**: tudo de que o OneUptime precisa para chegar até você, na ordem que importa. Um passo leva à página que o resolve, e **Verificar de novo** lê tudo de novo.

| Seção | O que ela verifica |
| --- | --- |
| **So we can reach you** | Você tem um método, cada método adicionado está verificado, e pelo menos um deles está em um canal que o projeto ativou |
| **How you want to be paged** | Cada gravidade tem uma regra, em cada uma das quatro abas de **Regras de Plantão** |
| **Staying informed** | Você fica sabendo quando um turno começa, e cada canal que você ativou em **Configurações de notificação** tem um método verificado por trás |
| **Nice to have** | Um número para chamadas recebidas, as suas contas do Slack e do Microsoft Teams, um link de calendário e os seus campos de perfil |

**Nice to have** não conta na barra de progresso, nem um passo que só outra pessoa pode resolver. A linha do topo resume tudo:

| Título | O que significa |
| --- | --- |
| **Tudo pronto** | Os acionamentos chegam até você, e não falta nada |
| **Algumas coisas ainda precisam ser configuradas** | Uma gravidade não tem regra, ou um passo ainda não foi feito |
| **Ainda não há como entrar em contato com você** | Nenhum dos seus métodos pode ser usado: nenhum está verificado, ou cada um verificado está em um canal que este projeto desativou |
| **Você está configurado e não está de plantão agora** | Tudo está pronto para o dia em que uma política nomear você |

## Quando nenhuma regra corresponde

Um acionamento pode chegar até você para um tipo e uma gravidade para os quais você não tem regra: por exemplo, uma gravidade adicionada depois que você entrou. O OneUptime aciona você mesmo assim, pelo que você verificou:

1. Cada método gratuito que você tem: dispositivos push, endereços de e-mail, Slack e Microsoft Teams.
2. Se você não tem nenhum desses, um método pago, nesta ordem: SMS, uma chamada telefônica, WhatsApp, Telegram. É o primeiro que você verificou, em um canal que o projeto ativou.
3. Se você também não tem nenhum desses, um webhook.

Você recebe um e-mail avisando, e também os proprietários da política de plantão, ou os do projeto se a política não tiver. Se não houver nada verificado, o acionamento não pode ser entregue, e o e-mail diz isso. Esses e-mails ficam retidos enquanto os acionamentos continuam chegando, para que uma tempestade de acionamentos não vire uma tempestade de e-mails. Para adicionar a regra que falta, veja [Regras de Plantão pessoais](/docs/notifications/on-call-rules#quando-uma-gravidade-não-tem-regra).

## Solução de problemas

:::details Eu estava de plantão, mas nada chegou até mim
Abra **Configurações do usuário → Registros de plantão**. Nenhuma linha para o incidente significa que a política de plantão dele nunca acionou você: verifique as regras de escalonamento dela e quem estava de plantão. Em uma linha com o status **Erro**, **Ver mensagem de status** diz por quê, por exemplo um canal que o projeto desativou. Depois confira se os seus métodos estão verificados e se **Your setup checklist** não tem nada pendente em **So we can reach you**.
:::

:::details Recebo e-mails sobre registros que nunca pedi
Você é proprietário do registro, diretamente ou por meio de uma equipe, ou o registro não tem proprietários e você é proprietário do projeto. Desative o evento em **Configurações do usuário → Configurações de notificação**, ou reduza o volume em **Configurações do usuário → Preferências de e-mail**.
:::

:::details Adicionei um número de telefone, mas ele não está nas minhas regras
Um número entra nas suas regras quando é verificado. Clique em **Verificar** na linha dele e digite o código. Se o cartão dele não tem botão de adicionar, o projeto está com esse canal desativado. Veja [Métodos de notificação](/docs/notifications/notification-methods#ative-um-canal-para-o-seu-projeto).
:::

## Próximos passos

:::cards
- [Métodos de notificação](/docs/notifications/notification-methods): Adicione e verifique os endereços em que o OneUptime pode encontrar você.
- [Regras de Plantão pessoais](/docs/notifications/on-call-rules): Decida qual método cada acionamento tenta, e quando.
- [Configurações de notificação](/docs/notifications/notification-settings): Escolha as novidades de que você fica sabendo, e por quais canais.
- [Regras de escalonamento](/docs/on-call/escalation-rules): Como uma política de plantão decide quem é acionado, nível por nível.
:::
