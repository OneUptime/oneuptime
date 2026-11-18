# Como me contatar

As suas regras de plantão decidem como um acionamento chega até você: quais dos seus métodos de notificação o OneUptime tenta, e quanto tempo depois do início do acionamento. Cada tipo de acionamento tem as próprias regras, um conjunto por gravidade, então um incidente crítico pode ligar para você na hora enquanto um alerta de baixa gravidade espera por um e-mail. Você as define em **Configurações do usuário → Como me contatar**.

> [!NOTE]
> Estas regras são só suas. As **Regras de plantão** em **Incidentes → Regras** e **Alertas → Regras** são outra coisa: elas decidem quais políticas de plantão um novo incidente ou alerta executa.

:::cards
- [Como um acionamento chega até você](#como-um-acionamento-chega-até-você): As suas regras para um acionamento, passo a passo.
- [Uma só sequência para tudo](#uma-só-sequência-para-tudo): As etapas que cada chamada tenta, definidas uma vez.
- [As regras com que você começa](#as-regras-com-que-você-começa): O que cada método verificado adiciona, e como enxugar.
- [Adicione uma regra](#adicione-uma-regra): Um método e um atraso para uma gravidade.
- [Regras de push](#regras-de-push): Tocar mesmo no silencioso, e repetir até alguém confirmar.
:::

## Como um acionamento chega até você

Uma política de plantão aciona você quando uma das regras de escalonamento dela nomeia você, uma equipe da qual você faz parte ou uma escala em que você está de plantão. O OneUptime então percorre as suas regras para esse tipo de acionamento e a gravidade dele: cada regra dispara no próprio método assim que o atraso dela passa desde o início do acionamento. Confirmar o incidente ou o alerta, a partir de qualquer mensagem ou no OneUptime, interrompe todas as regras que ainda não dispararam.

```mermaid title="Um acionamento crítico, três regras, até você confirmar"
flowchart TB
    page["Um incidente crítico<br/>aciona você"] --> first["Na hora:<br/>notificação push"]
    first --> second["Após 5 minutos:<br/>SMS"]
    second --> third["Após 10 minutos:<br/>chamada telefônica"]
    ack["Você confirma"] -.->|"interrompe o resto"| third
```

A maioria das mensagens pode confirmar o acionamento: e-mails, SMS e mensagens do WhatsApp, do Telegram, do Slack, do Microsoft Teams e do Mattermost trazem um link de confirmação, e uma chamada pede que você pressione 1. Se você não puder atender um acionamento, as mesmas mensagens permitem escaloná-lo, e uma chamada pede que você pressione 2: a política aciona o próximo nível na hora, e você não é mais acionado sobre isso. Veja [Escalonar um acionamento](/docs/on-call/escalation-rules#escalonar-um-acionamento). Cada acionamento que você recebe aparece em **Configurações do usuário → Registros de plantão**, onde **Ver linha do tempo** mostra cada mensagem enviada e se ela foi entregue.

## Uma só sequência para tudo

**Configurações do usuário → Como me contatar** abre na sua sequência: etapas numeradas que cada chamada tenta, uma após a outra, para incidentes, alertas e episódios de qualquer gravidade. Cada etapa é um momento, por exemplo na hora ou após 5 minutos, com os métodos verificados que saem juntos nesse momento. Uma etapa seguinte só sai se ninguém tiver confirmado a chamada até lá.

:::steps
### Adicionar uma forma de contatar você

Clique em **Adicionar** em uma etapa para enviar um dos seus métodos verificados no momento dessa etapa, ou em **Adicionar etapa** para começar uma nova etapa depois da última. Um número ou endereço que ainda espera o código aparece em **Ainda não verificado**, com **Verificar**. Sem sair da página, **Adicionar seu telefone** abaixo das etapas envia um código para o seu número e, depois de verificado, o número aciona você por SMS e por chamada telefônica; **Usar este navegador** e **Baixar o app** adicionam push da mesma forma.

### Escolher quando usar

Clique no momento de uma etapa, por exemplo **Na hora**, e escolha outro, até uma hora: a etapa inteira se move. Uma etapa de push também diz como toca e se repete: veja [Regras de push](#regras-de-push).

### Salvar

Clique em **Salvar alterações**, que aparece assim que algo muda. As mesmas regras são gravadas em cada cartão de cada aba: as regras que você adicionaria à mão em cada cartão.
:::

**Teste suas chamadas**, no pé da página, envia a você uma chamada de teste por elas.

Quando o seu servidor não consegue enviar e-mails, SMS ou chamadas telefônicas agora, uma etapa desse tipo aparece marcada com **Não enviado agora**, e a página diz uma única vez quem pode configurá-lo.

Quando uma gravidade merece outra coisa, **Diferente para algumas gravidades**, o botão ao lado do título, abre as abas e os cartões descritos abaixo. Um cartão que difere da sua sequência é marcado com **Difere da sequência**. A página continua abrindo nas suas etapas e lista abaixo delas cada cartão que difere e o que ele faz no lugar. **Salvar alterações** deixa esses cartões como estão; **Usar esta sequência para cada gravidade**, no fim dessa lista, dá a eles também a sua sequência, depois de nomear os cartões que perdem a diferença. Uma gravidade que seu projeto arquivou mantém as próprias regras.

Uma política de plantão decide quem é chamado e quando vem o próximo nível. Como você é contatado é esta sequência, para cada política que chama você.

## As quatro abas

**Configurações do usuário → Como me contatar** tem uma aba para cada tipo de acionamento. Cada aba tem um cartão por gravidade, com o nome e a cor que o seu projeto deu a ela:

| Aba | Acionamentos de | Cartões para |
| --- | --- | --- |
| **Incidentes** | Incidentes | Gravidades de incidente |
| **Episódios de incidentes** | Episódios que agrupam incidentes | Gravidades de incidente |
| **Alertas** | Alertas | Gravidades de alerta |
| **Episódios de alertas** | Episódios que agrupam alertas | Gravidades de alerta |

Um episódio aciona você pelas próprias políticas de plantão, à parte dos incidentes ou alertas que ele contém, por isso as regras dele ficam em uma aba própria. O endereço da página indica a aba aberta, por exemplo `/dashboard/{projectId}/user-settings/on-call-rules?type=alerts`; os outros valores são `incident-episodes` e `alert-episodes`, e sem `type` a página abre em **Incidentes**.

Uma gravidade que seu projeto arquivou aparece depois das outras, marcada como **Arquivado**, enquanto você tiver regras para ela: os incidentes e alertas que ainda a têm acionam você por essas regras. Você pode alterá-las ou removê-las, mas não adicionar novas.

## As regras com que você começa

Cada método que você verifica recebe uma regra em cada cartão de cada aba, enviada assim que você é acionado. O seu e-mail de login as tem desde o dia em que você entrou, para que um acionamento sempre chegue até você. Verifique um número de telefone para SMS, e todo acionamento também manda um SMS para você. Quando o seu projeto tem uma sequência padrão, um método que você verifica a segue em vez disso: veja [A sequência padrão](#a-sequência-padrão).

É um começo seguro, e normalmente demais. Enxugue para o que cada gravidade merece:

| Gravidade | Um conjunto sensato |
| --- | --- |
| Crítica | Push na hora, uma chamada após 5 minutos |
| Grave | Push na hora, um SMS após 10 minutos |
| Menor ou baixa | Um e-mail na hora |

Suas próprias regras não têm horário de silêncio: deixe as gravidades baixas no e-mail, ou em uma regra de push definida como **Normal**, para que elas nunca acordem você. Para que o acionamento de uma gravidade baixa aguarde o horário comercial para todos, defina a regra de plantão que o aciona como **Somente em horário comercial**: veja [Regras de plantão](/docs/alerts/settings#regras-de-plantão).

## A sequência padrão

Um projeto pode ter uma sequência padrão: como um membro é acionado depois que verifica uma forma de ser contatado. Um Proprietário do projeto ou um Administrador do projeto a define em **Sequência padrão para novos membros**, recolhida em **Mais configurações** em **Configurações do projeto → Notificações → Canais de notificação**, com canais em vez dos dispositivos de cada pessoa: por exemplo, push na hora e uma chamada telefônica depois de 5 minutos.

Com uma sequência padrão, um método que você verifica recebe uma regra em cada etapa do seu canal, em cada cartão de cada aba, e um canal que a sequência deixa de fora não recebe nenhuma. As regras que você já tem nunca mudam, e um acionamento que não encontra nenhuma regra ainda recorre aos seus métodos verificados.

Para dá-la a membros que já têm regras, um administrador usa **Aplicar sequência padrão** na página Prontidão: veja [Aplicar a sequência padrão](/docs/on-call/readiness#aplicar-a-sequência-padrão). Cada um deles recebe um e-mail.

Para segui-la você mesmo, clique em **Começar pela sequência padrão**, ao lado de **Diferente para algumas gravidades**. As suas etapas passam a ser as da sequência, com os seus próprios métodos verificados: uma forma que você não verificou fica de fora e é nomeada, e você mantém as suas próprias etapas no lugar dela. Nada muda até você clicar em **Salvar alterações**.

**Telefone para quem está de plantão**, ao lado, pede a todos de plantão um número verificado de SMS, chamada telefônica ou WhatsApp. Enquanto você não tiver nenhum, esta página diz isso acima de **Adicionar seu telefone**, e Prontidão e Saúde da configuração citam você. Ninguém fica bloqueado.

## Adicione uma regra

:::steps
### Abra o cartão

Vá até **Configurações do usuário → Como me contatar**, abra a aba do tipo de acionamento e encontre o cartão da gravidade.

### Escolha o método

Clique em **Adicionar regra de notificação**. Em **Método de notificação**, escolha um dos seus métodos verificados; um método que você não verificou não é oferecido.

### Escolha como o push toca

Para um telefone, escolha **Notificação push**: **Alerta crítico** ou **Normal**. Para qualquer dispositivo push, escolha **Repetir até a confirmação**. Veja [Regras de push](#regras-de-push).

### Defina o atraso

Escolha **Notificar-me após**: **Imediatamente**, **5 minutos**, **10 minutos**, **15 minutos**, **30 minutos** ou **1 hora**. Depois clique em **Adicionar regra de notificação** na caixa.
:::

O cartão lista as regras dele em ordem de atraso, com **Método de notificação** e **Notificar após** para cada uma.

## Altere ou exclua uma regra

- **Editar** na linha de uma regra muda o atraso dela. Para enviar uma regra a outro método, exclua-a e adicione uma nova.
- Em uma regra de push, clique no rótulo abaixo do método para alternar entre **Alerta crítico** e **Normal**, ou para mudar de quanto em quanto tempo ela se repete. Isso é salvo na hora.
- **Excluir** pede confirmação antes, e diz se a gravidade fica sem regra. Uma gravidade sem regra recorre aos seus métodos verificados; veja [Quando uma gravidade não tem regra](#quando-uma-gravidade-não-tem-regra).

## Regras de push

Uma regra que aciona um telefone diz como o push dela toca:

| Opção | O que o telefone faz |
| --- | --- |
| **Alerta crítico** | Toca mesmo quando o telefone está no silencioso ou em Não perturbe, depois que Critical On-Call Alerts é ativado no app OneUptime On-Call. Uma nova regra de telefone começa aqui. |
| **Normal** | Segue as configurações de som, silencioso e Não perturbe do telefone. |

Uma regra de push, para um telefone ou um navegador, também pode reenviar o push até alguém confirmar: **Não repetir**, o padrão, ou **A cada minuto**, **A cada 2 minutos**, **A cada 3 minutos**, **A cada 5 minutos**, **A cada 10 minutos**, **A cada 15 minutos** ou **A cada 30 minutos**. Ela se repete até 10 vezes a mais, e para assim que o incidente, o alerta ou o episódio é confirmado. Um acionamento que continua depois de uma confirmação, como um novo acionamento, se repete até que alguém que ele acionou responda ou que o incidente, o alerta ou o episódio seja resolvido: [Quando várias políticas acionam](/docs/on-call/policies#quando-várias-políticas-acionam) os lista. Veja [Alertas de plantão críticos](/docs/self-hosted/push-notifications#alertas-críticos-de-plantão-ignorando-o-modo-silencioso).

## Quando uma gravidade não tem regra

Uma gravidade que o seu projeto adiciona depois recebe regras em poucos minutos, feitas a partir do que você já escolheu nessa aba: os mesmos métodos, após os mesmos atrasos, e um push que toca e se repete do mesmo jeito. Se você não tinha regras nessa aba, ela recebe o seu e-mail verificado, na hora. Quando o seu projeto tem uma sequência padrão, o seu e-mail a segue em vez disso: veja [A sequência padrão](#a-sequência-padrão).

Um acionamento que mesmo assim não encontra regra é enviado aos seus métodos verificados de qualquer forma, e você recebe um e-mail sobre isso; veja [Quando nenhuma regra corresponde](/docs/notifications/index#quando-nenhuma-regra-corresponde).

:::details Desativar uma gravidade de propósito
A API pode salvar uma regra de exclusão, com `isOptOut` definido e sem método: aí você não é acionado para esse tipo de acionamento e essa gravidade, e nada assume no lugar. A linha mostra **Silenciado: notificações desativadas para esta regra**, e excluí-la reativa os acionamentos. Uma gravidade adicionada depois também fica silenciada quando todas as regras que você tem nessa aba são exclusões.
:::

:::details Desativar a alternativa para um projeto inteiro
Um Proprietário do projeto, ou alguém com **Manage Billing**, pode definir `disableOnCallNotificationFallback` do projeto pela API. Um acionamento que não encontra regra então não é entregue, e o registro dele diz que o usuário deve adicionar regras em **Configurações do usuário → Como me contatar**.
:::

## As regras de um colega

Proprietários do projeto e Administradores do projeto podem ver e alterar a mesma página para qualquer pessoa do projeto: em **Usuários**, eles abrem a pessoa e depois **Como me contatar** na seção **Plantão**. **Prontidão**, ao lado, mostra se cada gravidade chega até ela. Quando outra pessoa adiciona, altera ou exclui as suas regras, você recebe um e-mail sobre isso, e cada mudança fica no log de auditoria do projeto.

## Solução de problemas

:::details O meu telefone ficou em silêncio em um acionamento crítico
Confira se o push da regra é **Alerta crítico**, e não **Normal**, e se **Alertas críticos** está ativado para o telefone em **Configurações do usuário → Métodos de notificação**, na aba **Notificações push**.
:::

:::details Sou acionado duas vezes a cada incidente
Cada método verificado tem uma regra para cada gravidade, enviada na hora. Exclua as regras que você não quer, ou dê um atraso a elas. Um incidente em um episódio pode acionar você uma vez pelo incidente e outra pelo episódio, por duas políticas.
:::

:::details Recebi um e-mail embora a minha regra diga SMS
O acionamento não encontrou regra para o tipo ou a gravidade dele, e recorreu aos seus métodos gratuitos: adicione a regra na aba e no cartão certos. Ou o e-mail era uma novidade sobre um registro seu, que segue as **Configurações de notificação**, e não as suas regras. Os seus **Registros de plantão** listam só acionamentos.
:::

## Próximos passos

:::cards
- [Métodos de notificação](/docs/notifications/notification-methods): Adicione e verifique os métodos para onde as suas regras apontam.
- [Regras de escalonamento](/docs/on-call/escalation-rules): Como uma política de plantão aciona as pessoas, nível por nível.
- [Notificações push](/docs/self-hosted/push-notifications): Alertas críticos, sons de alarme e repetições nos telefones.
- [Como o OneUptime chega até você](/docs/notifications/index): Como métodos, regras e configurações se encaixam.
:::
