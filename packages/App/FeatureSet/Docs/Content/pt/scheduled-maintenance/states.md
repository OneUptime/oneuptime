# Estados da manutenção

Todo evento de manutenção programada está em um único **estado**: em que ponto o trabalho está, de planejado a aprovado. Os estados decidem o que o OneUptime faz com o evento: quando seus monitores deixam de ser verificados, o que suas páginas de status mostram, quando seus lembretes param. Esta página cobre os quatro estados com que todo projeto começa, o que move um evento entre eles e como adicionar etapas próprias.

:::cards
- [Os estados iniciais](#os-estados-iniciais): Agendado, Em andamento, Encerrado e Concluído.
- [O que move um evento](#o-que-move-um-evento): O relógio, o cabeçalho, a linha do tempo, o chat e a API.
- [Estados próprios](#estados-próprios): Uma etapa antes de o trabalho começar, ou uma verificação depois.
- [A linha do tempo de estado](#a-linha-do-tempo-de-estado): Cada estado em que um evento esteve, e como corrigi-lo.
:::

## Como funciona

Os estados de manutenção de um projeto são uma única lista ordenada, e os eventos só descem por ela. O lugar de um estado decide como conta um evento que está nele: esperando para começar, em andamento ou encerrado.

```mermaid title="Os eventos só descem pela lista; o lugar de um estado decide como ele conta"
flowchart TB
    subgraph waiting["Esperando para começar"]
        scheduled["Agendado"]
        confirmed["Confirmado<br/>(próprio)"]
    end
    subgraph progress["Em andamento"]
        ongoing["Em andamento"]
        verifying["Verificando<br/>(próprio)"]
    end
    subgraph over["Encerrado"]
        ended["Encerrado"]
        completed["Concluído"]
    end
    scheduled --> confirmed
    confirmed -->|"seu Começa em"| ongoing
    ongoing --> verifying
    verifying -->|"seu Termina em"| ended
    ended --> completed
```

O modelo `ScheduledMaintenanceState` tem `name`, `description`, `color` e `order`, além de quatro sinalizadores: `isScheduledState`, `isOngoingState`, `isEndedState` e `isResolvedState`. O OneUptime lê os sinalizadores e a ordem, nunca o nome, então você pode renomear **Concluído** para «Aprovado» sem quebrar nada.

> [!TIP]
> A lista fica em **Manutenção programada → Configurações → Estado do evento**. **Configurações** começa recolhida no menu lateral: expanda-a primeiro.

## Os estados iniciais

Todo projeto novo começa com quatro estados de manutenção, nesta ordem:

| Estado        | `order` | Sinalizador        | Cor       | O que significa                                                |
| ------------- | ------- | ------------------ | --------- | -------------------------------------------------------------- |
| **Agendado**  | `1`     | `isScheduledState` | `#000000` | Todo evento novo começa aqui e espera sua hora de início.      |
| **Em andamento** | `2`  | `isOngoingState`   | `#ffbf53` | O trabalho está em andamento, e os monitores do evento não são verificados. |
| **Encerrado** | `3`     | `isEndedState`     | `#4a4a4a` | A janela acabou, e as verificações voltam.                     |
| **Concluído** | `4`     | `isResolvedState`  | `#2ab57d` | Alguém aprovou o trabalho, e os lembretes aos proprietários param. |

Os quatro estados marcados levam a etiqueta **Integrado** na página de configurações. Você pode renomeá-los, mudar a cor e arrastá-los, mas eles mantêm sua ordem e não podem ser excluídos: o **Excluir** deles fica bloqueado e diz por quê.

**Encerrado** e **Concluído** estão ambos encerrados. A diferença é quem move o evento: o OneUptime o leva para **Encerrado** no seu **Termina em**, e uma pessoa, um botão de chat ou a API o leva para **Concluído** quando o trabalho é conferido.

## O que move um evento

| Forma            | Onde                                                                                        | O que pede                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **O relógio**    | Uma tarefa que roda a cada minuto                                                           | Nada: no **Começa em** leva um evento em espera para **Em andamento**, e no **Termina em** um evento em andamento para **Encerrado**. |
| **O cabeçalho**  | A **Visão geral** do evento: os botões **Marcar como {{state}}**, e **Change state to** no menu **⋯** | Uma caixa de diálogo curta, **Marcar a manutenção programada como {{state}}**, com **Notificar assinantes da página de status** e uma nota opcional em **Adicionar uma nota pública**. |
| **A linha do tempo** | **Linha do tempo de estado** no menu lateral do evento                                  | Uma linha que você adiciona à mão, com **Status da manutenção programada** e **Começa em**.                     |
| **Uma linha da lista** | O menu **⋯** na linha de um evento na lista de eventos: os passos **Marcar como {{state}}** e **Alterar estado** | A caixa de diálogo do cabeçalho, com o nome do evento. Um evento que outra mudança já moveu fica como está, e a caixa de diálogo diz por quê. |
| **Alteração em massa** | **Marcar como {{state}}** ou **Alterar estado** em uma seleção na lista de eventos                                 | O estado, e uma nota pública adicionada a cada evento. Os eventos que já estão nesse estado ou além são pulados. |
| **O chat**       | Os botões das mensagens do Slack e do Microsoft Teams do evento                             | A mesma alteração, feita em seu nome. Veja [Slack](/docs/workspace-connections/slack#agir-sobre-incidentes-alertas-e-eventos-pelo-slack). |
| **A API**        | Uma linha criada em `/api/scheduled-maintenance-state-timeline`                             | O estado, e se os assinantes são avisados.                                                                      |

Os botões do cabeçalho levam o nome dos seus estados. Enquanto o evento espera, ele oferece dois: um que o inicia, com o nome do seu estado em andamento, e um que o encerra, com o nome do seu estado encerrado. Enquanto o evento está em andamento, só o segundo. O menu **⋯** lista todos os outros estados depois do atual.

## O que o início e o fim fazem

Um evento começa quando passa de um estado em que espera para **Em andamento**, ou direto para um estado próprio colocado entre **Em andamento** e **Encerrado**. Então:

- **Seus monitores deixam de ser verificados** e mudam para o **Alterar status do monitor para** dele, se houver. Um monitor que você adiciona ao evento enquanto ele acontece também muda.
- **Suas páginas de status o listam como em andamento**, e os assinantes são avisados: no horário se **Quando o evento começa** estiver ativado, e à mão conforme diz **Notificar assinantes da página de status** na caixa de diálogo.
- **Seus proprietários são avisados**, se ativaram a notificação de mudança de estado, e o evento aparece em **Eventos em andamento**.

Um evento termina quando passa de um estado em que está em andamento para **Encerrado**, **Concluído** ou um estado próprio colocado depois de **Encerrado**. Então seus monitores voltam a ser verificados e voltam a «operacional», a menos que outro evento em andamento ainda os retenha, e os assinantes são avisados da mesma forma: no horário se **Quando o evento termina** estiver ativado, e à mão conforme diz a caixa de diálogo.

Passar de **Em andamento** para «Verificando», ou de **Encerrado** para **Concluído**, não inicia nem encerra nada de novo: o evento já tinha começado, ou já tinha terminado.

## O relógio do cabeçalho

Antes do início, o cabeçalho faz uma contagem regressiva; enquanto o evento acontece, conta há quanto tempo ele dura; depois de encerrado, diz quanto tempo levou. Quando o evento perde um limite por mais de dois minutos, um aviso âmbar diz isso:

- **Start overdue**: o evento ainda está esperando depois do seu **Começa em**.
- **Overrunning**: o evento ainda está em andamento depois do seu **Termina em**.

O aviso mostra o horário planejado e o estado que o evento ainda não alcançou. Logo depois de um limite, a tarefa que move os eventos talvez ainda não tenha rodado, então nos minutos seguintes o cabeçalho verifica de novo sozinho e mostra o novo estado sem recarregar.

## A ordem é obrigatória

Toda mudança de estado é verificada contra a lista, seja quem for que a faça: o painel, o Slack, o Microsoft Teams, a API, o Terraform, um workflow ou o próprio OneUptime.

- **Voltar atrás é recusado**, com uma mensagem que nomeia os dois estados: "Scheduled Maintenance cannot transition to Scheduled state from Ongoing state because Scheduled is before Ongoing in the order of scheduled maintenance states."
- **Passar para o estado em que ele já está é recusado**: "Scheduled Maintenance state cannot be same as previous state."
- **Os seletores só oferecem os estados depois do atual**, então ninguém recebe a oferta de uma mudança que seria recusada.

Para corrigir um estado definido por engano, exclua a linha dele na página **Linha do tempo de estado** do evento; o evento volta ao estado da linha anterior.

## Estados próprios

Um estado que você adiciona é uma etapa pela qual sua equipe passa e que os quatro iniciais não nomeiam: «Confirmado» antes de o trabalho começar, «Verificando» depois.

:::steps
### Abrir a lista de estados

Vá em **Manutenção programada → Configurações → Estado do evento**. O cartão **Agendado Manutenção Estados** lista seus estados na ordem deles. Cada linha mostra a cor e o nome, como conta um evento que está nele (coluna **Conta como**) e a descrição.

### Criar o estado

Clique em **Criar: Agendado Manutenção Estado** e preencha o **Nome**, a **Descrição** e a **Cor**. O estado novo é adicionado logo acima do estado concluído.

### Arrastá-lo para o lugar

Arraste uma linha pela alça para movê-la; a nova ordem é salva quando você a solta. A coluna **Conta como** acompanha o lugar onde você a solta.
:::

Um estado que você adiciona não tem sinalizador, então o lugar dele é o que ele significa:

| Onde você o coloca                      | Um evento que está nele                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Entre **Agendado** e **Em andamento**   | Espera o seu **Começa em**, como em **Agendado**, e começa dali no horário.                                      |
| Entre **Em andamento** e **Encerrado**  | Está em andamento, como em **Em andamento**: seus monitores continuam sem verificação, e ele termina no seu **Termina em**. |
| Entre **Encerrado** e **Concluído**     | Está encerrado, mas ainda não concluído: os lembretes que duram até a conclusão continuam.                      |
| Abaixo de **Concluído**                 | Está concluído, como em **Concluído**.                                                                           |

Mantenha seus estados abaixo de **Agendado**: todo evento novo começa ali, e um evento nunca volta a subir na lista, então um estado acima dele nunca é alcançado. Você leva um evento para um estado próprio pelo menu **⋯** do cabeçalho dele, em **Change state to**.

> [!NOTE]
> No OneUptime Cloud, adicionar ou alterar estados de manutenção requer o plano **Growth** ou superior. Todos os planos podem lê-los, usá-los e excluir um estado que você adicionou.

## Arquivar um estado

Arquive um estado próprio que sua equipe não deve mais usar, em vez de excluí-lo. Arquivar não altera nenhum evento: um evento nesse estado permanece nele e segue como de costume, e sua linha do tempo de estados ainda o mostra.

- **Arquivar** fica no menu **⋯** da linha. Ele pede confirmação primeiro e lista as medições e os fluxos de trabalho configurados para usar o estado.
- **Ninguém pode escolhê-lo novamente.** O cabeçalho do evento, **Alterar estado**, Slack e Microsoft Teams o deixam de fora, e a API, o Terraform e o MCP o recusam. Você ainda pode filtrar os eventos por ele.
- **Os estados arquivados são listados à parte**, na seção recolhida **Estados de manutenção programada arquivados** abaixo da tabela. **Desarquivar** devolve um como era.
- **Os quatro estados integrados não podem ser arquivados**: o OneUptime move os eventos para eles. O **Arquivar** deles fica bloqueado, com o motivo.

## A linha do tempo de estado

A página **Linha do tempo de estado** do evento é o registro de cada estado em que ele esteve. O cartão dela, **Linha do tempo de status**, os desenha como uma linha do tempo: uma faixa com cada estado do tamanho que durou e, abaixo, cada mudança, a mais recente primeiro. **Tabela**, no cabeçalho do cartão, os lista como linhas, com **Status da manutenção programada**, **Começa em**, **Termina em**, **Duração**, se os assinantes deviam ser avisados e como foi a notificação deles.

No painel, as linhas podem ser adicionadas e excluídas, mas não editadas, e um evento sempre mantém pelo menos uma. Pela API, o `startsAt` de uma linha pode ser corrigido, e cada medição calculada a partir da linha do tempo acompanha a correção. Excluir a linha mais recente devolve o evento ao estado da linha anterior.

> [!WARNING]
> Excluir uma linha reescreve o histórico do evento e cada medição calculada a partir dele. Use isso para corrigir um erro, não para arrumar.

## Solução de problemas

:::details O cabeçalho diz Start overdue
O evento ainda está esperando mais de dois minutos depois do seu **Começa em**, então a tarefa que inicia os eventos ainda não o moveu. Inicie-o você mesmo com o botão do cabeçalho: um início à mão faz tudo o que a tarefa faz, inclusive com os monitores dele.
:::

:::details Um evento não pode voltar a um estado em que esteve
Os estados só descem pela lista. Exclua as linhas depois do estado que você quer na página **Linha do tempo de estado** do evento, começando pela mais recente.
:::

:::details O estado concluído não aparece entre os botões do cabeçalho
Os botões do cabeçalho iniciam e encerram o evento. Concluí-lo fica no menu **⋯**, em **Change state to**.
:::

## Próximos passos

:::cards
- [Visão geral da manutenção programada](/docs/scheduled-maintenance/index): Onde fica tudo, e o que um evento afeta.
- [Criar eventos de manutenção](/docs/scheduled-maintenance/creating-events): O formulário, campo a campo.
- [Regras e configurações da manutenção](/docs/scheduled-maintenance/settings): Lembrar os proprietários até um evento ser concluído.
- [Estados e severidades de incidentes](/docs/incidents/states-and-severities): A mesma lista ordenada, para incidentes.
:::
