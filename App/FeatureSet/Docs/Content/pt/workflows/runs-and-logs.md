# Execuções e registros

Toda vez que um workflow roda, o OneUptime guarda um registro do que aconteceu — quando rodou, se deu certo e o que cada bloco fez. Esse registro se chama **execução**. É por meio das execuções que você confirma que um workflow funcionou, depura um que não funcionou e revisita atividades passadas.

## Onde encontrá-las

| Página                        | O que você vê                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Fluxos de trabalho → Execuções e registros** | Todas as execuções de todos os workflows do projeto. Filtre por nome do workflow, status e período.           |
| **Workflow → Execuções e registros**  | Só as execuções deste workflow. Aqui o filtro é **ID da execução**, em vez do filtro por workflow.  |
| **Uma execução específica**            | Aberta pelo botão **Ver registros** na linha da execução — as linhas em si não são clicáveis.           |

## Status da execução

| Status                             | O que significa                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agendado**                      | O trigger disparou e a execução está na fila esperando um executor. Costuma levar frações de segundo. Uma execução que continua agendada depois de 5 minutos é marcada como falha — ninguém a pegou. |
| **Em execução**                        | O workflow está em andamento. Blocos demorados mantêm a execução neste estado.                                                                                |
| **Aguardando**                        | A execução está parada em um bloco **Sleep** e vai retomar sozinha. Ela não ocupa nenhum worker enquanto espera.                                                      |
| **Executed**                       | A execução chegou ao fim sem falhar. (Este é o estado de sucesso — a pílula diz **Executed**, não "Success".)                                        |
| **Erro**                          | A execução parou porque um bloco levantou um erro. Também aparece quando uma execução na fila nunca é pega, quando o retorno de uma execução adormecida se perde, quando uma expressão de agendamento não pode ser resolvida, ou quando o workflow é desabilitado no meio da execução. |
| **Timeout**                        | A execução passou do tempo permitido. Veja [Configuração e segurança de workflow](/docs/workflows/configuration).                                                              |
| **Execution Exceeded Current Plan** | O projeto esgotou suas execuções de workflow dos últimos 30 dias, ou a assinatura está em atraso. A execução é registrada, mas não roda. Só no OneUptime Cloud. |

Um bloco que segue pela saída **Erro** — um bloco de API que recebeu um 4xx, por exemplo — não faz a execução falhar. A ramificação de erro roda e a execução ainda termina como **Executed**. A etapa em si continua desenhada em vermelho, para você achá-la.

## Lendo uma execução

Clique em **Ver registros** em uma execução para abri-la. A visão **Workflow Run** tem duas abas.

**Etapas** — uma linha por bloco que rodou, em ordem. Cada linha mostra o título do bloco, seu id de componente, quanto tempo levou e por qual saída ele saiu (`→ success`, `→ error`, `→ yes`). Expanda uma linha e você vê dois blocos de detalhe:

- **Received** — as configurações entregues ao bloco, depois de todas as variáveis resolvidas.
- **Returned** — o que ele produziu.

Etapas que falharam ficam em vermelho e já abrem expandidas, com a mensagem de erro impressa acima de **Received**.

**Full Log** — o registro bruto, linha a linha, que o executor imprimiu, incluindo o que os próprios blocos registraram. Use quando a aba de etapas não explicar a falha.

Dois detalhes que vale conhecer. O id de componente impresso sob o título de cada etapa é exatamente o texto para colar em uma referência `{{local.components.<id>.returnValues.…}}`, o que faz desta a forma mais rápida de acertar uma referência. E uma execução guarda só as últimas 100 etapas — uma execução longa ou retomada várias vezes mostra um aviso âmbar no lugar das etapas descartadas.

Os valores exibidos são o que o bloco viu depois de as variáveis serem preenchidas, com duas exceções: segredos e campos que o bloco marca como sensíveis aparecem ocultos, e valores muito longos são cortados com "… (truncated)".

Iniciar uma execução pelo **Construtor** abre essa mesma visão já acompanhando a execução, então você assiste ao que acontece em vez de ir atrás depois.

## Depuração comum

### "Meu workflow não rodou."

1. Confirme que o workflow está **Habilitado** na página **Visão geral** dele. Workflows novos nascem desabilitados, e um workflow desabilitado recusa toda execução — inclusive as manuais.
2. Para um trigger de evento do OneUptime: confirme que o evento realmente aconteceu. Abra o registro e olhe seu histórico.
3. Para um trigger de webhook: confirme que o outro sistema está enviando para a URL certa. A maioria das ferramentas registra quando envia um webhook — confira lá.
4. Para um trigger de agendamento: confirme que a expressão cron corresponde ao horário que você espera.

Se a execução *aparece*, mas com o status **Execution Exceeded Current Plan**, o projeto usou todas as suas execuções de workflow dos últimos 30 dias, ou a assinatura está em atraso. O registro da execução informa a contagem e o limite do seu plano. Isso vale só para o OneUptime Cloud.

### "Um bloco posterior nunca rodou."

Um bloco que não roda quase sempre é problema de ligação. Abra o **Construtor** e verifique:

- A saída do bloco anterior está conectada à entrada deste bloco?
- O bloco anterior saiu por uma saída diferente da que você esperava — **Erro** em vez de **Sucesso**, ou **Não** em vez de **Sim**? A aba de etapas mostra por qual delas ele saiu.

### "Uma variável chegou vazia."

Abra a execução e olhe o bloco **Received** da etapa que falhou.

- Se você vir o texto literal `{{local.components.…}}`, a referência não foi resolvida. Em geral é um erro de digitação no id do componente ou no id do valor de retorno — lembre que é o **Identifier** do bloco, não o nome exibido nele. Confira também a grafia do próprio `local.components`: `{{local.componets.api-get-1.returnValues.response-body}}` é enviado como texto literal e a execução ainda assim é reportada como **Executed**.
- Se você vir uma string vazia, o bloco anterior rodou, mas não produziu aquele campo.

A aba **Full Log** traz uma linha de aviso nomeando qualquer referência que não foi resolvida, o que costuma ser o jeito mais rápido de achar o problema.

### "Funciona quando eu rodo à mão, mas não pelo trigger."

Abra o **Construtor**, clique em **Executar fluxo de trabalho** e preencha os campos do trigger com valores parecidos com o que o trigger real envia. Depois compare os valores em **Received** dessa execução com os da execução real, lado a lado. A diferença costuma ser um único nome ou tipo de campo.

## Reexecutando um workflow

Não existe botão de "repetir esta execução". Não reexecutamos execuções antigas automaticamente porque os efeitos colaterais — mensagens no Slack, chamadas de API, tickets — podem não ser seguros de repetir. Para refazer o trabalho, corrija o workflow e deixe o próximo trigger real dispará-lo, ou abra o **Construtor** e clique em **Executar fluxo de trabalho** com os mesmos valores.

## Por quanto tempo as execuções ficam guardadas?

No OneUptime Cloud, as execuções ficam guardadas por **30 dias** e depois são excluídas — é por isso que as duas listas de execuções se descrevem como cobrindo os últimos 30 dias. Instalações self-hosted guardam as execuções até você excluí-las; se um workflow roda com muita frequência e polui seu histórico, desabilite-o ou exclua-o para parar de acrescentar ruído.

Execuções registradas antes de existir o rastreamento de etapas não têm conteúdo em **Etapas** e mostram apenas o **Full Log**.

## Onde ler em seguida

- [Configuração e segurança de workflow](/docs/workflows/configuration) — tempos limite, limites de recursão, segredos ocultos.
- [Variáveis de workflow](/docs/workflows/variables) — a sintaxe de variáveis usada nos seus blocos.
- [Componentes de workflow](/docs/workflows/components) — o que cada bloco produz.
