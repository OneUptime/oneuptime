# Modelos e eventos recorrentes

Um modelo de manutenção programada salva um evento que você planeja com frequência: o título e a descrição, os monitores que ele pausa, as páginas de status em que aparece e quem é avisado. Use um para preencher o formulário com um clique, ou torne-o recorrente para que o OneUptime agende o evento por você, toda semana, todo mês ou no intervalo que você escolher.

:::cards
- [Criar um modelo](#criar-um-modelo): Os passos do formulário, com um nome no início e um agendamento no fim.
- [Usar um modelo](#usar-um-modelo): Preencher um evento novo a partir dele.
- [Eventos recorrentes](#eventos-recorrentes): Deixe o OneUptime agendar o evento sozinho.
- [Alterar ou parar um modelo](#alterar-ou-parar-um-modelo): Editá-lo, pausar o agendamento ou excluí-lo.
:::

## Como funciona

Um modelo é um ponto de partida. Um evento criado a partir dele é uma cópia com valores próprios: alterar o modelo depois muda só os eventos criados a partir de então.

```mermaid title="Duas formas de um modelo virar um evento"
flowchart TB
    template["Um modelo<br/>em Modelos de manutenção"] --> byhand["Criar a partir de modelo<br/>preenche o formulário"]
    template --> schedule["Recorrente ativado<br/>verificado a cada minuto"]
    byhand --> event["Um evento novo<br/>em Agendado"]
    schedule --> event
```

## Antes de começar

- **Seu plano.** No OneUptime Cloud, os modelos requerem o plano **Growth** ou superior.
- **Sua função.** Criar um modelo requer **Proprietário do projeto**, **Administrador do projeto**, **Membro do projeto**, **Administrador de manutenção programada** ou **Membro de manutenção programada**, ou uma função personalizada que possa criar modelos de manutenção programada.

## Criar um modelo

:::steps
### Abrir os modelos

Vá em **Manutenção programada → Configurações → Modelos de manutenção**. **Configurações** começa recolhida no menu lateral: expanda-a primeiro. Clique em **Criar: Modelo de manutenção programada**.

### Dar nome ao modelo

Em **Informações do modelo**, dê a ele um **Nome do modelo** e uma **Descrição do modelo**, para que sua equipe saiba quando usá-lo. Os dois são obrigatórios.

### Descrever o evento

Em **Detalhes da manutenção**, preencha o **Título** e a **Descrição** com que começa cada evento criado a partir dele. **Proprietários** e **Rótulos** ficam em **Mais campos**.

### Escolher o que ele afeta

Em **Recursos afetados**, escolha os **Monitores**, o **Alterar status do monitor para** deles, os **Outros recursos afetados** que houver, as páginas de status em **Mostrar evento nestas páginas de status** e as **Notificações aos assinantes**.

### Decidir se ele se repete

Em **Recorrente**, deixe **Evento Recorrente** desativado para um modelo que você usa à mão, ou ative-o, escolha com que frequência ele se repete e seu **Fuso horário**, e defina os horários do primeiro evento em **Primeiro evento**. Clique em **Próximo** para conferir a revisão e depois crie o modelo.
:::

Um modelo pergunta **Alterar status do monitor para** mesmo quando não nomeia nenhum monitor: o status também vale para os monitores que você adiciona ao agendar um evento a partir dele. Em **Outros recursos afetados**, um modelo aceita hosts, clusters Kubernetes, hosts Docker, hosts Podman e serviços.

## O que um modelo preenche

| Parte do evento                                   | Criar a partir de modelo             | Um evento recorrente            |
| ------------------------------------------------- | ------------------------------------ | ------------------------------- |
| **Título** e **Descrição**                        | Preenchidos, e você pode alterá-los  | Copiados                        |
| **Monitores** e **Alterar status do monitor para** | Preenchidos                         | Copiados                        |
| **Outros recursos afetados**                      | Preenchidos                          | Copiados                        |
| As páginas de status e **Notificações aos assinantes** | Preenchidas                     | Copiadas                        |
| **Proprietários** e **Rótulos**                   | Preenchidos                          | Copiados                        |
| **Começa em** e **Termina em**                    | A próxima hora cheia, por uma hora   | Calculados pelo agendamento     |

## Usar um modelo

:::steps
### Escolher o modelo

Em **Manutenção programada → Todos os eventos de manutenção**, clique em **Criar a partir de modelo** e escolha um modelo em **Selecionar Modelo de Manutenção Programada**.

### Conferir o formulário

Clique em **Criar a partir de modelo**. O formulário de criação abre com as respostas do modelo já preenchidas. Ajuste a janela e altere o que este evento precisar.

### Criar o evento

Percorra os passos com **Próximo** e depois clique em **Criar evento de manutenção** na revisão.
:::

Quando o projeto ainda não tem nenhum modelo, **Criar a partir de modelo** avisa isso e leva para **Modelos de manutenção**.

## Eventos recorrentes

Um modelo recorrente cria o evento seguindo um agendamento. Você define com que frequência ele se repete, o fuso horário que ele mantém, e quando o primeiro evento é criado, quando ele começa e quando termina; cada evento seguinte é o primeiro deslocado em intervalos inteiros no calendário desse fuso horário, nos mesmos horários do dia.

| Campo                                    | O que significa                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Evento Recorrente**                    | Ativa o agendamento.                                                                                |
| **Com que frequência você gostaria que este evento se repetisse?** | Um número e uma unidade: horas, dias, semanas, meses ou anos.           |
| **Fuso horário**                         | O fuso horário em que os eventos mantêm seu horário do dia. Um modelo novo começa com o seu.        |
| **Primeiro evento agendado para**        | Quando o OneUptime cria o primeiro evento, que é quando seus assinantes ficam sabendo que ele foi agendado. |
| **Primeiro evento começa em**            | Quando o primeiro evento começa.                                                                    |
| **Primeiro evento termina em**           | Quando o primeiro evento termina.                                                                   |

Os três primeiros ficam no passo **Recorrente**. Os horários do primeiro evento ficam no passo **Primeiro evento**, que aparece assim que **Evento Recorrente** está ativado.

Por exemplo, uma janela semanal cujo primeiro evento é criado numa segunda-feira para o sábado seguinte:

| Evento       | Criado             | Começa             | Termina            |
| ------------ | ------------------ | ------------------ | ------------------ |
| O primeiro   | `2030-06-03 09:00` | `2030-06-08 02:00` | `2030-06-08 04:00` |
| O segundo    | `2030-06-10 09:00` | `2030-06-15 02:00` | `2030-06-15 04:00` |

Cada evento mantém os horários do dia do primeiro evento no fuso horário do modelo, inclusive quando os relógios mudam por causa do horário de verão: uma janela das 02:00 às 04:00 em Berlim fica lá das 02:00 às 04:00 no verão e no inverno. Alguns dias funcionam assim:

- **Um dia que o mês não tem.** Um evento mensal no dia 29, 30 ou 31 cai no último dia de um mês mais curto, como 30 de abril ou 28 de fevereiro, e volta ao seu próprio dia nos meses que o têm. Um evento anual em 29 de fevereiro cai em 28 de fevereiro nos outros anos.
- **A noite em que os relógios são adiantados.** Um horário que não existe nessa noite, como 02:30 quando 02:00 pula para 03:00, avança o tamanho do pulo, para 03:30. Um evento cujo início passa assim do fim mantém a duração do primeiro evento.
- **A noite em que os relógios são atrasados.** Um horário que acontece duas vezes nessa noite, como 01:30 em Nova York, é o primeiro dos dois.
- **A cada poucas horas.** As horas são contadas à medida que passam, então um modelo que se repete a cada poucas horas se desloca uma hora no relógio quando ele muda.
- **Um fuso horário sem horário de verão.** Um fuso horário que não muda mais os relógios, como o da Colúmbia Britânica (America/Vancouver) desde novembro de 2026, mantém o mesmo deslocamento, então nada se move.

Um modelo criado antes de os modelos terem fuso horário mostra **UTC**, o fuso horário em que seus eventos eram calculados até então. Escolha o fuso horário em que seus horários foram pensados e, a partir do próximo evento, cada evento mantém lá o horário do dia do primeiro evento.

Defina **Primeiro evento agendado para** com toda a antecedência com que você quer que seus clientes fiquem sabendo do trabalho. Os três horários precisam estar no futuro quando você cria o modelo, o evento precisa ser criado antes de começar e de terminar, e precisa começar antes de terminar; o formulário diz qual regra um horário viola.

Uma tarefa verifica os modelos recorrentes a cada minuto. Quando chega o próximo horário de um modelo, ela cria o evento e adianta esse horário para o próximo evento do agendamento. A lista de modelos mostra esse horário na coluna **Evento Recorrente**, e **Não** para um modelo que não se repete. Um evento criado pelo agendamento é como qualquer outro: suas regras rodam, seus proprietários são adicionados e seus assinantes ficam sabendo que ele foi agendado.

## Alterar ou parar um modelo

Abra um modelo na lista para ver a página dele:

- **Detalhes do modelo de manutenção programada** mostra com o que os eventos novos começam. O **Editar** dele percorre **Informações do modelo**, **Detalhes da manutenção**, **Páginas de status** e **Recorrente**, e depois **Primeiro evento** para um modelo que se repete.
- **Recursos afetados** reúne os **Monitores** dele, o **Alterar status do monitor para** desses monitores e os **Outros recursos afetados**, com um **Editar** próprio.
- **Proprietários** lista as pessoas e equipes donas de cada evento agendado a partir dele.

As alterações valem para os eventos criados depois de você salvá-las; os eventos já criados mantêm seus próprios valores. Para parar um agendamento, desative **Evento Recorrente** em **Editar**, ou exclua o modelo. Um modelo desativado mantém seu agendamento: ative-o de novo, e ele retoma no próximo horário do agendamento, pulando os horários em que ficou desativado. Excluir um modelo mantém os eventos que ele criou.

## Solução de problemas

:::details Ao criar um modelo recorrente aparece que um horário deveria estar no futuro
Os três primeiros horários precisam estar depois do momento atual quando você cria o modelo. Adiante-os: o agendamento continua depois a partir do primeiro evento.
:::

:::details Um modelo recorrente não criou nenhum evento
Confira se **Evento Recorrente** ainda está ativado e veja o horário na coluna **Evento Recorrente** da lista: o evento é criado nesse momento, não no início dele. A tarefa roda a cada minuto, então espere um minuto.
:::

:::details Os eventos de um modelo recorrente chegam uma hora adiantados ou atrasados depois da mudança de horário
Abra o modelo e confira o **Fuso horário** dele: seus eventos mantêm o horário do dia do primeiro evento nesse fuso horário. Um modelo criado antes de os modelos terem fuso horário mostra **UTC**: escolha o fuso horário em que seus horários foram pensados. Os eventos já criados mantêm seus horários.
:::

:::details Falta em um evento criado a partir de um modelo um recurso que eu escolhi
Em **Outros recursos afetados**, um modelo aceita hosts, clusters Kubernetes, hosts Docker, hosts Podman e serviços. Adicione outros tipos de recursos ao próprio evento, com **Editar** no cartão **Recursos afetados** dele.
:::

## Próximos passos

:::cards
- [Criar eventos de manutenção](/docs/scheduled-maintenance/creating-events): O formulário que um modelo preenche.
- [Estados da manutenção](/docs/scheduled-maintenance/states): Como cada evento avança depois de criado.
- [Regras e configurações da manutenção](/docs/scheduled-maintenance/settings): Adicione proprietários e rótulos a cada evento novo automaticamente.
- [Visão geral da manutenção programada](/docs/scheduled-maintenance/index): Onde os modelos se encaixam no restante da manutenção.
:::
