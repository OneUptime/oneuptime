# Linha do tempo de plantões

A linha do tempo de plantões mostra todos os agendamentos de plantão do seu projeto em uma única grade semanal ou mensal: uma linha por agendamento, uma coluna por dia. Ela responde "quem está de plantão na minha equipe, ou na organização inteira, esta semana?" sem abrir cada agendamento.

Os turnos da linha do tempo são os mesmos com que o OneUptime aciona as pessoas, substituições de usuário incluídas: a linha do tempo, as regras de escalonamento e os feeds de calendário leem todos do mesmo lugar.

```mermaid title="Um único conjunto de turnos por trás da linha do tempo, dos acionamentos e dos feeds de calendário"
flowchart TB
    subgraph setup["Cada agendamento"]
        direction LR
        layers["Camadas e rotações"]
        overrides["Substituições de usuário"]
    end
    layers --> shifts["Quem está de plantão, e quando"]
    overrides --> shifts
    shifts --> timeline["Linha do tempo de plantões"]
    shifts --> paging["As regras de escalonamento os acionam"]
    shifts --> feeds["Feeds de calendário"]
```

## Abra a linha do tempo

- **Plantão** > **Linha do tempo de plantões** mostra todos os agendamentos que você pode ver, agrupados pela equipe proprietária. O botão **Visualização em linha do tempo** em **Agendamentos de plantão** abre a mesma página.
- **Equipes** > uma equipe > **Agendamentos de plantão** mostra só os agendamentos de que essa equipe é proprietária.

Uma equipe é proprietária de um agendamento quando aparece na página **Proprietários** do agendamento. Os agendamentos sem equipe proprietária ficam agrupados em **No owner team**. Desligue **Group by team** para ver todos os agendamentos em uma única lista, ordenada por nome.

## Leia a grade

| Na grade | O que significa |
| --- | --- |
| Uma barra | Um turno: quem está de plantão, de quando até quando. Uma pessoa tem a mesma cor em todos os agendamentos. |
| Uma barra esmaecida | Um turno no passado. |
| Uma barra marcada com **⇄** | Uma substituição: alguém está cobrindo um turno. A faixa fina abaixo dela mostra a pessoa cujo turno está sendo coberto, riscada. |
| Um bloco âmbar hachurado | Uma lacuna de cobertura: ninguém está de plantão. Um alerta que escala para esse agendamento não aciona ninguém. |
| A linha vermelha | Agora. |
| A linha abaixo do nome de um agendamento | Quem está de plantão agora, ou **No one on call now**. |

Passe o ponteiro sobre uma barra ou uma lacuna, ou chegue até elas pelo teclado, para ver os detalhes.

Abaixo da grade, **On call this week** (**On call this month** na visualização mensal) lista todo mundo que está de plantão no período. Passe o ponteiro sobre um nome para ver por quanto tempo a pessoa está de plantão, e em quantos agendamentos.

## Mude o período e o fuso horário

- Alterne entre **Week** e **Month**, navegue com as setas e volte com **Today**.
- Os horários aparecem no seu próprio fuso horário. O botão de fuso horário abre **View timeline in timezone**, que mostra a linha do tempo em qualquer outro fuso sem mudar quem está de plantão: cada agendamento continua passando o turno no próprio fuso horário.
- A linha do tempo cobre 180 dias para trás e 365 dias para frente.

> [!NOTE]
> Os turnos passados são recalculados a partir da configuração atual de cada agendamento, então mostram a rotação como está configurada agora, o que pode ser diferente de quem foi de fato acionado na época. Para as horas que as pessoas realmente passaram de plantão, use **Plantão** > **Relatórios** > **Tempo de plantão do usuário**.

## Encontre um agendamento ou uma pessoa

- **Pesquisar** encontra nomes de agendamentos, nomes de equipes e as pessoas de plantão.
- O filtro de equipe limita a visualização a uma equipe ou a **My teams**; **Schedules I'm on** mantém só os agendamentos de que você faz parte.
- Acima da grade, clique em **with no one on call now** ou **with coverage gaps this week** (**with coverage gaps this month** na visualização mensal) para ver só esses agendamentos. Clique de novo para ver todos.
- Clique em uma pessoa abaixo da grade, ou em uma das barras dela, para destacar todos os turnos dela. **Clear highlight** desfaz isso, e **Clear filters** limpa a pesquisa e os filtros.

## Quem vê o quê

| Vale para | Regra |
| --- | --- |
| Permissões | As mesmas permissões e restrições por rótulo de **Agendamentos de plantão**, mais a permissão de ler as camadas dos agendamentos. |
| Substituições | De quem é o turno que uma substituição cobre só aparece para quem pode ler substituições de usuário. Os demais continuam vendo quem é acionado. |
| Número de agendamentos | Até 250 agendamentos por vez, ordenados por nome. A página **Agendamentos de plantão** de uma equipe limita a lista aos agendamentos dessa equipe. |
| Plano | No OneUptime Cloud, a linha do tempo precisa do plano **Growth**, como os agendamentos de plantão. |

## Próximos passos

:::cards
- [Agendamentos de plantão](/docs/on-call/schedules): Defina quem se reveza, as camadas e os horários de plantão.
- [Feeds de calendário](/docs/on-call/calendar-feeds): Leve seus turnos para o Google Agenda, o Outlook ou o Calendário da Apple.
- [Regras de escalonamento](/docs/on-call/escalation-rules): Decida quem cada nível de uma política de plantão aciona.
:::
