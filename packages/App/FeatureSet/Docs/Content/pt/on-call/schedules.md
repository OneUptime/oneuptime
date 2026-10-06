# Agendamentos de plantão

Um agendamento de plantão decide quem está de plantão a cada momento. As pessoas se revezam nele: cada uma fica de plantão por um tempo e depois a próxima assume. Adicione um agendamento às regras de escalonamento de uma política de plantão e a política acionará quem estiver de plantão nele quando esse nível for executado.

## Quem se reveza

Ao criar um agendamento na página **Agendamentos de plantão**, o formulário pede o **Nome** e **Quem se reveza?**. Clique em **Adicionar usuário** e escolha as pessoas na ordem em que se revezam: elas ficam de plantão uma de cada vez, e a primeira fica de plantão assim que o agendamento é criado. Elas formam a primeira camada do agendamento, **Layer 1**, de plantão 24 horas por dia. O novo agendamento então abre na sua página **Camadas**, onde você pode mudar o rodízio ou adicionar mais camadas.

**Quem se reveza?** é opcional. Se ficar vazio, o agendamento começa sem camadas: não coloca ninguém de plantão até você adicionar uma camada na página **Camadas**. A pergunta só é feita a quem pode adicionar camadas.

Todo o resto fica em **Mais campos**, recolhido até você abrir:

- **Cada turno dura**: **1 dia**, **1 semana**, **2 semanas** ou **1 mês**, e **1 semana** se você não mudar. É perguntado assim que alguém é escolhido. Cada pessoa fica de plantão por esse tempo e depois a próxima assume, no horário em que o agendamento foi criado.
- **Fuso horário**: o fuso horário em que valem os horários de passagem e as horas de plantão. Começa com o seu.
- **Descrição** e **Rótulos**.

Enquanto houver alguém escolhido e nada em **Mais campos** tiver sido alterado, o cabeçalho recolhido diz o que vai acontecer: cada pessoa fica de plantão por uma semana e depois a próxima assume.

## Camadas

O rodízio de um agendamento é feito de camadas, na sua página **Camadas**. As camadas são lidas de cima para baixo: a camada mais alta com alguém de plantão é a que aciona, então coloque o rodízio principal no topo e a cobertura de reserva abaixo.

**Adicionar camada** adiciona uma camada que começa como a primeira: de plantão a partir de agora, cada pessoa por uma semana, 24 horas por dia. Expanda uma camada para adicionar pessoas e para mudar quando ela começa, com que frequência passa o plantão, quando passa pela primeira vez e as horas em que fica de plantão.

Cada pessoa mantém a mesma cor em todos os lugares, para que você a acompanhe num relance: em cada camada, no agendamento final e nas substituições dele, e na **Linha do tempo de plantões**.

## Criar agendamentos com a API ou o Terraform

Os agendamentos de plantão são o recurso `/api/on-call-duty-policy-schedule`; suas camadas e as pessoas nelas são os recursos `/api/on-call-duty-schedule-layer` e `/api/on-call-duty-schedule-layer-user`.

- Criar um agendamento com `firstLayerUsers` (uma lista de IDs de usuários, na ordem em que se revezam) nos seus `miscDataProps` dá a ele a primeira camada, como faz o painel: **Layer 1**, de plantão a partir de agora, 24 horas por dia. `firstLayerRotation` diz quanto dura cada turno, como um rodízio do tipo `{"_type": "Recurring", "value": {"intervalType": "Week", "intervalCount": 1}}`; sem ele, uma semana. Cada usuário deve ser membro do projeto e quem chama deve poder criar camadas; caso contrário, o agendamento não é criado.
- Um agendamento criado sem eles não tem camadas, como antes; o recurso de agendamento do Terraform não os envia.
- Uma camada criada sem `rotation` passa o plantão diariamente, como sempre.
