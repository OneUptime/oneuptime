# Estados e severidades de alertas

Todo alerta tem um **estado**, em que ponto sua equipe está com ele, e uma **gravidade**, o quanto ele importa. Os estados determinam o que o OneUptime faz: quem ainda é acionado, o que conta como ativo, quando um episódio é resolvido. As gravidades ordenam os alertas, e as regras podem corresponder a elas. Esta página é para quem as configura ou se pergunta por que um alerta acionou ou não alguém.

:::cards
- [Os estados predefinidos](#os-estados-predefinidos): Identified, Confirmado e Resolvido, e o que cada um faz.
- [Adicionar seus próprios estados](#adicionar-seus-próprios-estados): Uma etapa sua, como "Investigando".
- [Mover um alerta pelos seus estados](#mover-um-alerta-pelos-seus-estados): Todas as formas de um estado mudar.
- [Gravidades](#as-gravidades-predefinidas): High e Low, e como adicionar as suas.
:::

## Como funciona

Os estados de alerta de um projeto formam uma lista ordenada, e os alertas só descem por ela. A posição de um estado decide como conta um alerta que está nele: ainda não confirmado, confirmado ou resolvido. Os episódios de alertas percorrem a mesma lista.

```mermaid title="Os alertas só descem pela lista; a posição de um estado decide como ele conta"
flowchart TB
    subgraph open["Conta como<br/>não confirmado"]
        identified["Identified"]
    end
    subgraph working["Conta como<br/>confirmado"]
        acknowledged["Confirmado"]
        investigating["Investigando<br/>(seu)"]
    end
    subgraph done["Conta como<br/>resolvido"]
        resolved["Resolvido"]
        closed["Fechado<br/>(seu)"]
    end
    identified --> acknowledged
    acknowledged --> investigating
    investigating --> resolved
    resolved --> closed
    identified -. "pular" .-> resolved
```

O modelo `AlertState` tem `name`, `description`, `color` e `order`, mais três sinalizadores: `isCreatedState`, `isAcknowledgedState` e `isResolvedState`. O OneUptime lê os sinalizadores e a ordem, nunca o nome, então você pode renomear **Resolvido** para "Fechado" sem quebrar nada. O modelo `AlertSeverity` tem `name`, `description`, `color` e `order`, e nenhum sinalizador.

> [!TIP]
> As duas listas ficam em **Alertas → Configurações**, que começa recolhido no menu lateral: expanda **Configurações** para encontrar **Estado do alerta** e **Severidade do alerta**.

## Os estados predefinidos

Todo projeto novo começa com três estados de alerta, nesta ordem:

| Estado           | `order` | Sinalizador           | Cor       | O que significa                                   |
| ---------------- | ------- | --------------------- | --------- | ------------------------------------------------- |
| **Identified**   | `1`     | `isCreatedState`      | `#fd625e` | O estado em que os novos alertas começam.         |
| **Confirmado**   | `2`     | `isAcknowledgedState` | `#ffbf53` | Alguém está cuidando, e os acionamentos param.    |
| **Resolvido**    | `3`     | `isResolvedState`     | `#2ab57d` | O alerta terminou e não conta mais como ativo.    |

Os três estados com sinalizador têm a etiqueta **Integrado** na página de configurações. Você pode renomeá-los, mudar a cor e arrastá-los, mas eles mantêm a ordem, criação antes de confirmação antes de resolução, e não podem ser excluídos: o **Excluir** deles fica bloqueado e explica o motivo.

## O que cada sinalizador faz

| Sinalizador           | O que o OneUptime faz com ele                                                                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isCreatedState`      | Os novos alertas começam aqui quando ninguém escolhe outro estado: todo alerta que um monitor gera e todo alerta criado com **Estado Inicial** vazio.                              |
| `isAcknowledgedState` | **Confirmar** leva um alerta para cá. Neste estado ou em qualquer estado posterior, o alerta conta como confirmado: suas políticas de plantão deixam de acionar e **Confirmar** deixa de ser oferecido. |
| `isResolvedState`     | **Resolver** leva um alerta para cá. Neste estado ou em qualquer estado posterior, o alerta conta como resolvido: sai de **Alertas ativos**, seus lembretes param e seu episódio pode ser resolvido. |

## Adicionar seus próprios estados

Um estado que você adiciona é uma etapa pela qual sua equipe passa e que os três estados predefinidos não nomeiam: "Investigando", "Mitigado", "Fechado".

:::steps
### Abrir a lista de estados

Vá para **Alertas → Configurações → Estado do alerta**. O cartão **Alerta Estados** lista seus estados na ordem deles. Cada linha mostra sua cor e seu nome, como **Conta como** um alerta que está nele, e sua descrição.

### Criar o estado

Clique em **Criar: Estado do alerta** e preencha **Nome**, **Descrição** e **Cor**. A cor já vem escolhida: uma que nenhum outro estado usa ainda. O novo estado é adicionado logo acima do estado resolvido, de modo que mantém os alertas ativos.

### Arrastá-lo para o lugar

Arraste uma linha pela alça para movê-la; a nova ordem é salva quando você a solta. A coluna **Conta como** acompanha: acima do estado confirmado um alerta está **Não confirmado**, dele para baixo **Confirmado**, e do estado resolvido para baixo **Resolvido**.
:::

Um estado que você adiciona não tem sinalizador, então sua posição é o seu significado. Coloque uma etapa de mitigação entre **Confirmado** e **Resolvido**, e uma etapa de triagem acima de **Confirmado**. Um estado colocado abaixo de **Resolvido** conta como resolvido em todo lugar.

Você leva um alerta para um estado seu pelo menu **⋯** no cabeçalho do alerta, em **Change state to**, que lista cada estado posterior ao atual. A confirmação se chama **Marcar alerta como {{state}}**, com o nome do estado.

> [!NOTE]
> No OneUptime Cloud, adicionar ou alterar estados e gravidades de alertas requer o plano **Growth** ou superior. Qualquer plano pode lê-los, usá-los e excluir um estado que você adicionou.

## A ordem é imposta

Cada mudança de estado de um alerta é verificada contra a lista, seja quem for que a faça: o painel, o Slack, o Microsoft Teams, a API, o Terraform, um workflow ou o próprio OneUptime.

- **Retrocessos são recusados**, com uma mensagem que nomeia os dois estados: "Alert cannot transition to Acknowledged state from Resolved state because Acknowledged is before Resolved in the order of alert states."
- **Mudar para o estado em que ele já está é recusado**: "Alert state cannot be same as previous state."
- **Os seletores só oferecem os estados posteriores ao atual**, para que ninguém receba uma mudança que seria recusada.

Os episódios de alertas seguem a mesma lista, com suas próprias mensagens ("Episode cannot transition to …"). O único passo de volta para cima na lista é do próprio OneUptime: uma regra de agrupamento que reabre um episódio resolvido recentemente. Para corrigir um estado definido por engano, exclua a linha dele na página **Linha do tempo de estado** do alerta; o alerta volta ao estado da sua linha restante mais recente.

## As gravidades predefinidas

Todo projeto novo começa com duas gravidades de alerta, da mais grave para a menos grave:

| Gravidade | `order` | Cor       | Descrição predefinida                                                             |
| --------- | ------- | --------- | --------------------------------------------------------------------------------- |
| **High**  | `1`     | `#b70400` | Issues causing very high impact to customers. Immediate attention is required.    |
| **Low**   | `2`     | `#ffbf53` | Issues causing low impact to customers.                                           |

Os incidentes começam com três gravidades e os alertas com duas. Quando o modelo de uma recomendação de monitor diz **Crítico** ou **Warning**, o OneUptime o associa à sua primeira e segunda gravidade de alerta, que em um projeto novo são **High** e **Low**.

## Editar as gravidades

Vá para **Alertas → Configurações → Severidade do alerta**. O cartão **Alerta Severidades** as lista da mais grave para a menos grave; arraste uma linha para mudar sua posição. **Criar: Severidade do alerta** adiciona uma no fim da lista, a menos grave, com os mesmos **Nome**, **Descrição** e **Cor** de um estado.

A posição decide qual gravidade prevalece onde o OneUptime as compara: a gravidade de um episódio sobe até a do alerta mais grave que entra nele. As gravidades não têm sinalizadores nem bloqueio de exclusão: qualquer gravidade pode ser excluída, inclusive as duas predefinidas.

Uma gravidade sozinha não aciona ninguém. Para acionar conforme a gravidade, adicione uma regra de plantão cujas **Alerta Severidades** correspondam a ela: veja [Regras e configurações de alertas](/docs/alerts/settings). Alterar a gravidade de um alerta escreve uma entrada no feed dele e faz sua regra de lembrete corresponder novamente.

## Arquivar um estado ou uma severidade

Arquive um estado ou uma severidade que sua equipe não deve mais usar, em vez de excluí-lo. Arquivar não altera nenhum alerta. Excluir um estado remove suas linhas do histórico de cada alerta, e uma severidade não pode ser excluída enquanto houver alertas com ela.

- **Arquivar** fica no menu **⋯** da linha. Ele pede confirmação primeiro e lista as regras, medições, critérios de monitor e fluxos de trabalho configurados para usar o valor: eles continuam usando-o até que você os altere.
- **Ninguém pode escolhê-lo novamente.** **Alterar estado**, o cabeçalho do alerta, Slack, Microsoft Teams, regras e critérios de monitor o deixam de fora. A API, o Terraform e o MCP o recusam, indicando o valor e onde desarquivá-lo.
- **Os alertas o mantêm.** Um alerta que o tem o mantém em toda edição posterior, sua linha do tempo de estados ainda o mostra e você ainda pode filtrar por ele.
- **Os valores arquivados são listados à parte**, na seção recolhida **Estados de alerta arquivados** ou **Severidades de alerta arquivadas** abaixo da tabela, com quem arquivou cada um e quando. **Desarquivar** devolve um como era.
- **Alguns não podem ser arquivados.** Os estados criado, reconhecido e resolvido, e a última severidade não arquivada do projeto. O **Arquivar** deles fica bloqueado, com o motivo.

**Excluir** diz primeiro o que faria. Enquanto alertas ou episódios tiverem o valor, a exclusão é recusada e a caixa de diálogo os lista. Caso contrário, ela lista o que a exclusão mudaria e oferece **Arquivar em vez disso**.

## Mover um alerta pelos seus estados

| Forma                     | Onde                                                                                      | O que é pedido                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Botões do cabeçalho**   | O cabeçalho do alerta: **Confirmar**, **Resolver** e **Change state to** no menu **⋯**    | Uma confirmação breve, **Confirmar alerta**, **Resolver alerta** ou **Marcar alerta como {{state}}**, com uma nota opcional em **Adicionar uma nota privada**. |
| **State timeline**        | **Linha do tempo de estado** no menu lateral do alerta                                    | Uma linha que você adiciona manualmente, com **Status do alerta** e **Começa em**.                                                    |
| **Linha da lista** | O menu **⋯** na linha de um alerta na lista de alertas: **Confirmar**, **Resolver** e **Alterar estado** | A confirmação do cabeçalho, com o nome do alerta. Um alerta que outra mudança já moveu fica como está, e a caixa de diálogo diz por quê. |
| **Mudança em massa**      | **Confirmar**, **Resolver** ou **Alterar estado** em uma seleção na lista de alertas                                     | O estado e uma nota privada adicionada a cada alerta. Os alertas que já estão nesse estado ou depois dele são ignorados.              |
| **Automaticamente**       | Um monitor, um episódio, um incidente vinculado ou seu próprio código                     | **Resolver alerta automaticamente** nos critérios de um monitor, a mudança de estado de um episódio, os interruptores de incidente em [Alertas vinculados](/docs/incidents/linked-alerts) ou uma linha criada em `/api/alert-state-timeline`. |

O cabeçalho oferece **Confirmar** e **Resolver** enquanto o alerta ainda não foi confirmado, e só **Resolver** depois disso. Um alerta resolvido não mostra nenhum dos dois.

## O que confirmar faz

Um alerta está confirmado a partir do momento em que passa para o seu estado confirmado, ou para qualquer estado posterior, inclusive um resolvido. Então:

- **O plantão deixa de acionar por ele.** Suas políticas de plantão não acionam o próximo nível.
- **Confirmar deixa de ser oferecido**, nem no cabeçalho nem no Slack e no Microsoft Teams, onde confirmá-lo de novo é recusado com "Alert is already acknowledged." ou "Alert is already resolved." Quem responder ao seu acionamento depois disso tem o acionamento confirmado, e o alerta fica onde está.
- **O tempo até a confirmação é fixado**, a partir da primeira mudança desse tipo: o primeiro bloco da **Visão geral** e uma medição que termina quando **O alerta é confirmado**.

## O que resolver faz

Um alerta está resolvido quando passa para o seu estado resolvido, ou para qualquer estado posterior. Então:

- **Ele sai de Alertas ativos**, e da contagem do menu lateral.
- **Seus lembretes param**, diga o que disser sua regra de lembrete.
- **Seu episódio pode ser resolvido.** Um episódio se resolve sozinho quando todos os seus alertas estão resolvidos. Veja [Episódios de alertas e regras de agrupamento](/docs/alerts/episodes).
- **Seu monitor pode gerar um novo alerta.** Um critério mantém um alerta aberto por vez; quando esse é resolvido, a próxima correspondência abre outro.

Passar de **Resolvido** para um estado posterior, "Fechado" por exemplo, não muda nada disso: o alerta já estava resolvido.

## A linha do tempo de estados

A página **Linha do tempo de estado** de um alerta é o registro de cada estado em que ele esteve. Seu cartão, **Linha do tempo de status**, os desenha como uma linha do tempo: uma faixa com cada estado do tamanho que durou e, abaixo, cada mudança, da mais recente para a mais antiga. **Tabela**, no cabeçalho do cartão, os lista em linhas, com **Status do alerta**, **Começa em**, **Termina em** e **Duração**.

- **Ver causa** mostra a causa raiz registrada com essa mudança.
- **Ver registros** mostra o que o OneUptime registrou quando o alerta mudou, como a verificação do monitor que a causou.

As linhas podem ser adicionadas e excluídas, mas não editadas, e um alerta sempre mantém pelo menos uma. Excluir a linha mais recente devolve o alerta ao estado da linha anterior.

> [!WARNING]
> Excluir uma linha reescreve o histórico do alerta e cada medição calculada a partir dele. Use isso para corrigir um erro, não para arrumar.

## A lista Alertas ativos

**Alertas → Alertas ativos** contém todo alerta cujo estado fica acima do seu estado resolvido, e nada mais decide isso: nem a gravidade, nem a idade, nem se alguém o confirmou. O selo vermelho ao lado no menu lateral conta os mesmos alertas.

Assim, um estado seu acima de **Resolvido** mantém os alertas na lista, e um abaixo dele os tira, como resolver faz. **Episódios ativos** funciona da mesma forma para episódios.

## Próximos passos

:::cards
- [Visão geral dos alertas](/docs/alerts/index): De onde vêm os alertas e como sua equipe trabalha com eles.
- [Episódios de alertas e regras de agrupamento](/docs/alerts/episodes): Como o estado de um episódio move seus alertas.
- [Regras e configurações de alertas](/docs/alerts/settings): Acionar e lembrar conforme a gravidade.
- [Estados e severidades de incidentes](/docs/incidents/states-and-severities): O mesmo ciclo de vida, para incidentes.
:::
