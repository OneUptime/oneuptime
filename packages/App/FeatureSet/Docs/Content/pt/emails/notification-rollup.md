# Resumo de notificações

Quando algo dá muito errado, raramente dá errado uma vez só. Um link upstream instável derruba quarenta monitores, quarenta incidentes são declarados, reconhecidos e resolvidos, e cada proprietário recebe um e-mail a cada etapa: duzentas mensagens numa única caixa de entrada, e ninguém mais as lê.

O OneUptime junta essas rajadas num único e-mail automaticamente. Isso vale para todos e não há nada a configurar — mas, se você preferir receber cada notificação no seu próprio e-mail, pode [desativar o resumo para você](#desativar-o-resumo-para-você), um projeto de cada vez.

:::cards
- [Como funciona](#como-funciona): Quatro e-mails saem na hora; o resto chega junto.
- [O que nunca é resumido](#o-que-nunca-é-resumido): Chamadas de plantão, segurança, cobrança e e-mails para assinantes.
- [Desativar o resumo](#desativar-o-resumo-para-você): Receber de novo cada notificação no seu próprio e-mail.
- [Menos e-mails de rotina](#reduzir-ainda-mais): Desligar os e-mails informativos de uma só vez.
:::

## Como funciona

Cada e-mail de notificação de proprietário que você recebe é contado contra um pequeno orçamento, mantido por projeto, por destinatário, por endereço de e-mail e por **categoria** de recurso — incidentes, alertas, monitores, manutenções programadas, páginas de status, sondas, SLOs e assim por diante.

```mermaid title="Como um e-mail de notificação de proprietário é entregue"
flowchart TB
    N["E-mail de notificação de proprietário"] --> O{"Resumo ativado<br/>para você?"}
    O -->|"Não"| S["Enviado na hora"]
    O -->|"Sim"| C{"Quinto ou posterior nesta<br/>categoria em 30 minutos?"}
    C -->|"Não"| S
    C -->|"Sim"| H["Retido"]
    H -->|"Cerca de 5 minutos depois"| R["Um e-mail de resumo<br/>para o projeto"]
```

- Os **quatro primeiros** e-mails de uma categoria em qualquer janela de trinta minutos são enviados imediatamente, exatamente como sempre. Mesmo assunto, mesmo modelo, mesmos links.
- O **quinto e todos os seguintes** nessa janela são retidos.
- Cerca de cinco minutos depois, tudo o que foi retido para você nesse projeto — em todas as categorias — chega como **um único** e-mail que lista o que aconteceu, com um link para cada recurso.

O resumo inclui as notificações que você ainda assina no momento do envio. Se você desativar o e-mail de um evento enquanto as notificações dele estão na fila, essas notificações ficam fora do resumo. Reativar o e-mail depois não reenvia essas atualizações puladas.

Abaixo do limite, o recurso não faz nada. Um projeto que gera três e-mails de proprietário por dia continua enviando esses três e-mails separadamente.

## Como é o e-mail de resumo

A linha de assunto diz a escala _e o tipo_ da tempestade antes de você abrir o e-mail:

```text
[Acme Production] 112 notifications: 63 Monitors, 41 Incidents, 6 Alerts +2 more
```

Dentro, um cartão de resumo mostra o total, a janela de tempo que o resumo cobre e a divisão por categoria. Abaixo dele, as notificações são agrupadas em uma seção por categoria, a mais urgente primeiro — incidentes, depois alertas, depois os monitores e sondas que os detectaram —, de modo que a primeira coisa sob o resumo é a primeira que vale o clique.

Cada seção traz uma linha por recurso em vez de uma linha por evento:

- **As linhas mostram onde cada recurso terminou.** Se um incidente foi criado, depois reconhecido, depois resolvido, isso é uma única linha no estado mais recente, o que deixa o resumo _mais_ atual do que três e-mails separados teriam sido.
- **As contagens batem.** Cada linha traz o horário da última atualização, e uma linha que absorveu várias diz quantas, para que as seções e o cartão de resumo sempre somem o mesmo total.
- **Gravidade e estado aparecem.** Os cartões de alertas e incidentes mostram a gravidade e o estado da última notificação, incluindo nomes personalizados. Notificações antigas na fila sem esses dados ainda aparecem, sem os rótulos que faltam.

Os horários aparecem em UTC, com a data também sempre que um resumo abrange mais de um dia.

![Um e-mail de resumo com quinze notificações](/docs/static/images/NotificationRollupEmail.png)

## O que nunca é resumido

O resumo só afeta notificações de proprietários e membros — a família "algo pelo qual você é responsável mudou". Ele não alcança mais nada, porque fica no único caminho de código que essas notificações percorrem, e nenhuma outra.

Nunca atrasado e nunca contado:

| Categoria | Exemplos |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Chamadas de plantão | Toda chamada de uma política de escalonamento e todo pedido de reconhecimento |
| Horários de plantão | "Você está de plantão agora", "você é o próximo de plantão", "seu turno começa em breve", "seu turno foi reatribuído" |
| Segurança da conta | Redefinição de senha, verificação de e-mail, senha alterada, código de backup de dois fatores usado ou gerado de novo |
| Avisos administrativos sobre sua conta | Um administrador alterou seus métodos de notificação ou suas regras de plantão |
| Cobrança e saldo | Faturas, assinatura vencida, "não conseguimos chamar ninguém porque o cartão foi recusado" |
| Saúde da instância | Avisos de Postgres, Valkey e ClickHouse para os administradores da instância |
| Assinantes de páginas de status | Todo e-mail que sua página de status envia aos seus próprios assinantes |
| Violações de SLA | Enviadas imediatamente, mesmo reutilizando o tipo de notificação de incidente criado |

Só o e-mail é afetado. SMS, chamadas telefônicas, notificações push, WhatsApp, Telegram, Slack, Microsoft Teams e webhooks são entregues imediatamente, exatamente como antes, inclusive para as notificações cujo e-mail foi retido.

## Limites

| Limite | Valor |
| --- | --- |
| Notificações em um e-mail de resumo | No máximo **500**. O que passar disso fica na fila e sai no próximo resumo, no máximo cinco minutos depois. |
| Linhas exibidas em um e-mail de resumo | No máximo **100**. As linhas são agrupadas por recurso, então são 100 recursos distintos; além disso, o e-mail informa os totais completos e leva você ao projeto. |
| E-mails de resumo para um destinatário a partir de um projeto | No máximo **12** por hora. |
| Atraso adicional de uma notificação retida | Cerca de seis minutos, no pior caso. |

O teto por hora é imposto pelo banco de dados, não por um temporizador, então ele vale mesmo durante uma tempestade que dure horas.

## Desativar o resumo para você

Algumas pessoas querem o agrupamento. Outras arquivam cada notificação assim que chega, ou passam a caixa de entrada para algo que faz isso, e um e-mail de resumo atrapalha. Por isso o resumo pode ser desativado, por pessoa e por projeto.

:::steps
### Abrir Preferências de e-mail

No projeto, vá em **Configurações do usuário → Preferências de e-mail** — a mesma página para a qual o rodapé de todo e-mail de resumo aponta.

### Desativar Email Rollup

No cartão **Email Rollup**, desligue a chave. A alteração é salva sozinha, e o cartão passa a mostrar "Off: every notification arrives as its own email, immediately."
:::

Com ele desativado, todo e-mail de notificação de proprietário e de membro desse projeto volta a ser enviado a você individualmente e na hora: mesmo assunto, mesmo modelo, mesmos links, sem limite e sem espera de cinco minutos. O que já estava na fila para você ao desativar ainda chega como um último resumo alguns minutos depois; tudo o que vem depois chega um por um.

A chave é **só sua e vale para um projeto**. Desativá-la não muda o que seus colegas recebem e não se estende a outros projetos — assim, o barulhento projeto de produção pode continuar agrupando enquanto o tranquilo projeto interno envia tudo separado, ou o contrário. Ela vem ativada para todos até que cada um a desative.

O que ela **não** altera:

- **Quais notificações você recebe.** Isso é a configuração por tipo de evento e por canal em **Configurações do usuário → Configurações de notificação**, na página ao lado. O resumo e esta chave só mudam em quantos e-mails essas notificações são reunidas.
- **Chamadas de plantão e e-mails de turno**, **e-mails de segurança da conta**, **e-mails de cobrança**, avisos de saúde da instância e e-mails para assinantes de páginas de status. Nada disso é resumido, então desativar o resumo não muda nada para eles — veja [O que nunca é resumido](#o-que-nunca-é-resumido).
- **Qualquer outro canal.** SMS, chamadas, push, WhatsApp, Telegram, Slack, Microsoft Teams e webhooks já são imediatos.

## Reduzir ainda mais

O resumo junta as atualizações de rotina; você também pode deixar de receber a maioria delas.

:::steps
### Abrir as preferências a partir de um e-mail de resumo

Abra o link de preferências no rodapé de um e-mail de resumo ou vá em **Configurações do usuário → Preferências de e-mail**.

### Selecionar Reduce routine emails

No cartão **Fewer routine emails**, selecione **Reduce routine emails**. Quando a alteração é salva, o cartão diz **E-mails de rotina desativados.**
:::

Isso desativa para você, no projeto atual, estes e-mails informativos:

- Notas publicadas em incidentes, alertas, episódios e manutenções programadas.
- Avisos de que você foi adicionado como proprietário de um recurso.
- Novos monitores e páginas de status.
- Incidentes ou alertas adicionados a episódios existentes.
- Ser adicionado a uma política de plantão ou removido dela.

Suas escolhas atuais para criação de incidentes e alertas, mudanças de estado, lembretes, atribuições de incidentes, saúde dos monitores e turnos de plantão são mantidas, e nenhum e-mail que você tinha desligado é ligado. Chamadas de plantão, outros canais de entrega, e-mails de conta, de cobrança e para assinantes de páginas de status não são afetados.

As alterações são salvas juntas. Revise as chaves por evento em **Configurações do usuário → Configurações de notificação** para religar qualquer e-mail específico. Essas preferências também valem para notificações que aguardam um resumo; um e-mail já enviado não pode ser recuperado. O resumo de e-mail continua sendo uma configuração separada que controla o agrupamento dos eventos que você mantém.

## Solução de problemas

:::details Um e-mail de notificação chegou alguns minutos atrasado
Ele foi o quinto e-mail ou posterior da categoria em trinta minutos, por isso foi retido e enviado num resumo cerca de cinco minutos depois. Procure um e-mail de resumo do mesmo projeto: a notificação é uma linha nele. Chamadas de plantão e os outros canais não atrasaram.
:::

:::details Desativei o resumo e mesmo assim recebi um e-mail de resumo
As notificações que já estavam na fila para você quando o desativou chegam como um último resumo alguns minutos depois. Tudo o que vem depois chega um e-mail por vez.
:::

:::details Falta num e-mail de resumo uma atualização que eu esperava
Cada linha mostra um recurso no estado mais recente, então um incidente criado, reconhecido e resolvido é uma linha só, com o número de atualizações que ela absorveu. Uma notificação também fica de fora se você desligou o e-mail desse evento em **Configurações do usuário → Configurações de notificação** enquanto ela estava na fila.
:::

## Próximos passos

:::cards
- [Configuração de SMTP](/docs/emails/smtp): Enviar os e-mails do OneUptime pelo seu próprio servidor de e-mail.
- [Regras de escalonamento](/docs/on-call/escalation-rules): Como as chamadas de plantão chegam às pessoas, nunca resumidas.
:::
