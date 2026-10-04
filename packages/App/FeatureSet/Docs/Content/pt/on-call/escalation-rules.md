# Regras de escalonamento

Uma política de plantão aciona pessoas em níveis. Cada regra de escalonamento é um nível: quem é acionado e quanto tempo esperar que alguém confirme antes de acionar o próximo nível. As regras de uma política aparecem, em ordem, na página **Regras de escalonamento** dela.

## Quem é acionado primeiro

Ao criar uma política de plantão na página **Políticas de plantão**, o formulário pede o **Nome** dela e **Quem é acionado primeiro?**. A pergunta usa o mesmo seletor de **Notificar**: agendamentos de plantão, equipes e pessoas, quantos você precisar. Quem você escolher forma a primeira regra de escalonamento da política, **Level 1**, que espera **30 minutos** por uma confirmação antes de acionar o próximo nível. Em seguida, a nova política abre na página **Regras de escalonamento** dela, onde você pode adicionar mais níveis.

**Quem é acionado primeiro?** é opcional. Se você deixar vazio, a política começa sem regras de escalonamento: não aciona ninguém até que você adicione uma, e a visão geral dela avisa isso. A descrição e os rótulos ficam em **Avançado**. A pergunta só aparece para quem pode adicionar regras de escalonamento.

## Adicionar uma regra de escalonamento

Abra a política de plantão, escolha **Regras de escalonamento** no menu lateral e clique em **Adicionar regra de escalonamento**. A caixa de diálogo é uma única página curta com duas perguntas:

- **Notificar** — quem é acionado neste nível. Um único seletor reúne agendamentos de plantão, equipes e pessoas: clique em **Adicionar destinatário**, pesquise e escolha quantos precisar. É preciso pelo menos um.
  - Um **agendamento de plantão** aciona quem estiver de plantão quando o nível é executado, não uma pessoa fixa.
  - Uma **equipe** aciona todos os membros da equipe.
  - Uma **pessoa** é acionada diretamente.
- **Escalonar após (em minutos)** — quanto tempo esperar por uma confirmação antes de acionar o próximo nível. Começa em **30 minutos**; altere conforme o nível.

Todo o resto fica em **Avançado**, recolhido até você abrir:

- **Nome** — opcional. Uma regra sem nome recebe o nome do seu nível: a primeira regra de uma política é **Level 1**, a segunda **Level 2**, e assim por diante. O campo de nome mostra o nome que a regra receberá.
- **Descrição** — notas opcionais, como quem este nível aciona e por quê.

O cabeçalho de **Avançado** mostra **Configurado** quando a regra tem uma descrição ou um nome escolhido por você.

## Como os níveis acionam as pessoas

Quando um incidente ou alerta chega à política, **Level 1** aciona seus destinatários imediatamente. Se ninguém confirmar dentro da espera, **Level 2** é acionado, e assim por diante. Depois que a espera do último nível passa sem confirmação, a política recomeça em **Level 1** se a sua **Política de Repetição** (abaixo das regras) mandar repetir, quantas vezes ela permitir, e caso contrário para.

O resumo no topo da página **Regras de escalonamento** mostra toda a escada: quando cada nível é acionado, quem ele aciona e o que acontece depois do último. Um nível cujos destinatários não podem ser todos acionados avisa no seu cartão; clique no rótulo para ver quem e por quê.

## Editar, reordenar e excluir regras

- **Edit rule** abre a mesma caixa de diálogo de uma página, preenchida com a regra como ela está: seus destinatários, sua espera, e o nome e a descrição em **Avançado**. Adicione ou remova destinatários e salve. Limpar o nome devolve à regra o nome do seu nível.
- **Move up** e **Move down** no menu **⋯** de uma regra mudam o nível dela. Uma regra com o nome do seu nível mantém um nome que corresponde à sua posição: quando **Level 3** sobe acima de **Level 2**, as duas trocam de nome. Um nome escolhido por você, como **Managers**, continua o mesmo para onde quer que a regra vá.
- **Delete rule** pede confirmação primeiro e informa quem o nível aciona. Excluir um nível faz os níveis abaixo subirem, e as regras com o nome do seu nível são renomeadas de acordo.

## Criar regras com a API ou o Terraform

As regras de escalonamento são o recurso `/api/on-call-duty-policy-escalation-rule`; as pessoas, equipes e agendamentos que uma regra aciona são os recursos `/api/on-call-duty-policy-escalation-rule-user`, `-team` e `-schedule`.

- Uma regra criada sem `name` recebe o nome do seu nível, como no painel: **Level 3** para uma regra que se torna o terceiro nível da sua política. O recurso do Terraform para regras de escalonamento continua exigindo um nome.
- `escalateAfterInMinutes` não tem valor padrão fora do painel. Uma regra criada sem ele não espera: o próximo nível é acionado assim que este é executado. Defina-o explicitamente — o painel sugere 30.
- As regras com o nome do seu nível são renomeadas quando você move ou exclui regras no painel. Alterar `order` pela API ou pelo Terraform muda apenas a ordem.
- Criar uma política de plantão em `/api/on-call-duty-policy` com `onCallSchedules`, `teams` ou `users` (listas de ids) nos `miscDataProps` dá a ela sua primeira regra de escalonamento, como no painel: **Level 1**, que os aciona, com um `escalateAfterInMinutes` de 30. Cada id precisa pertencer ao projeto e quem chama precisa poder criar regras de escalonamento; caso contrário, a política não é criada. Uma política criada sem eles não tem regras, como antes; o recurso do Terraform para políticas não os envia.
