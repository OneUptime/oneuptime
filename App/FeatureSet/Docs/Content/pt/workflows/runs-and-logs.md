# Execuções e registros

Toda vez que um workflow é executado, o OneUptime salva um registro do que aconteceu — quando rodou, se funcionou e o que cada bloco fez. Esse registro é chamado de **execução** (*run*). As execuções são como você confirma que um workflow funcionou, depura um que não funcionou e revê a atividade passada.

## Onde encontrá-las

| Página                         | O que você vê                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Workflows → Runs & Logs**     | Toda execução de todo workflow no projeto. Filtre por nome do workflow, status e período.              |
| **Workflow → Runs & Logs**      | Apenas as execuções deste workflow. Este tem um filtro **Run ID** em vez de um filtro de workflow.      |
| **Uma única execução**          | Aberta com o botão **View Logs** em uma linha de execução — as próprias linhas não são clicáveis.       |

## Status da execução

| Status                              | O que significa                                                                                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduled**                        | O gatilho disparou e a execução está na fila para um executor. Normalmente uma fração de segundo. Uma execução ainda em **Scheduled** após 5 minutos falhou — nada a pegou. |
| **Running**                          | O workflow está em andamento. Blocos de longa duração mantêm uma execução nesse estado.                                                                        |
| **Waiting**                          | A execução está parada em um bloco **Sleep** e retomará sozinha. Ela não ocupa nenhum worker enquanto espera.                                                  |
| **Executed**                         | A execução chegou ao fim sem falhar. (Este é o estado de sucesso — a etiqueta mostra **Executed**, não "Success".)                                             |
| **Error**                            | A execução parou porque um bloco gerou um erro. Também usado quando uma execução enfileirada nunca é pega, quando a retomada de uma execução em espera se perde, quando uma expressão de agendamento não pode ser resolvida, ou quando o workflow é desabilitado no meio da execução. |
| **Timeout**                          | A execução rodou por mais tempo do que o permitido. Veja [Configuration & Safety](/docs/workflows/configuration).                                             |
| **Execution Exceeded Current Plan**  | O projeto esgotou suas execuções de workflow dos últimos 30 dias, ou a assinatura está em atraso. A execução é registrada, mas não executada. Somente no OneUptime Cloud. |

Um bloco que segue para sua saída **Error** — um bloco de API em um 4xx, por exemplo — não faz a execução falhar. O ramo de erro roda e a execução ainda termina como **Executed**. A própria etapa continua desenhada em vermelho para que você a encontre.

## Lendo uma execução

Clique em **View Logs** em uma execução para abri-la. A visualização **Workflow Run** tem duas abas.

**Steps** — uma linha por bloco que rodou, em ordem. Cada linha mostra o título do bloco, seu id de componente, quanto tempo levou e a saída pela qual saiu (`→ success`, `→ error`, `→ yes`). Expanda uma linha para ver dois blocos de detalhe:

- **Received** — as configurações que o bloco recebeu, depois que todas as variáveis foram resolvidas.
- **Returned** — o que ele produziu.

Etapas que falharam ficam em vermelho e começam expandidas, com a mensagem de erro impressa acima de **Received**.

**Full Log** — o registro bruto, linha a linha, que o executor imprimiu, incluindo qualquer coisa que os próprios blocos tenham registrado. Use-o quando a visão de **Steps** não explicar a falha.

Dois detalhes que vale a pena saber. O id de componente impresso sob o título de cada etapa é exatamente a string a colar em uma referência `{{local.components.<id>.returnValues.…}}`, o que torna esta a forma mais rápida de acertar uma referência. E uma execução mantém apenas suas últimas 100 etapas — uma execução longa ou repetidamente retomada mostra uma nota em âmbar onde as etapas anteriores foram descartadas.

Os valores mostrados são o que o bloco viu depois que as variáveis foram preenchidas, com duas exceções: segredos e campos que o bloco marca como sensíveis são ocultados, e valores muito longos são cortados com "… (truncated)".

Iniciar uma execução pelo **Builder** abre essa mesma visualização já acompanhando a execução, então você pode assistir acontecendo em vez de procurá-la depois.

## Depuração comum

### "Meu workflow não rodou."

1. Confirme que o workflow está **Enabled** na sua página **Overview**. Workflows novos começam desabilitados, e um workflow desabilitado rejeita toda execução — inclusive as manuais.
2. Para um gatilho de evento do OneUptime: confirme que o evento realmente aconteceu. Abra o registro e verifique seu histórico.
3. Para um gatilho de webhook: confirme que o outro sistema está enviando para a URL certa. A maioria das ferramentas registra quando envia um webhook — verifique lá.
4. Para um gatilho de agendamento: confirme que a expressão cron corresponde ao horário que você espera.

Se a execução *aparecer* com o status **Execution Exceeded Current Plan**, o projeto esgotou todas as suas execuções de workflow dos últimos 30 dias, ou a assinatura está em atraso. O registro da execução nomeia a contagem e o limite do seu plano. Isso se aplica apenas ao OneUptime Cloud.

### "Um bloco posterior nunca rodou."

Um bloco que não roda geralmente é um problema de conexão. Abra o **Builder** e verifique:

- A saída do bloco anterior está conectada à entrada deste bloco?
- O bloco anterior tomou uma saída diferente da que você esperava — **Error** em vez de **Success**, ou **No** em vez de **Yes**? A aba Steps mostra qual delas ele tomou.

### "Uma variável chegou vazia."

Abra a execução e olhe o bloco **Received** da etapa que falhou.

- Se você vir o texto literal `{{local.components.…}}`, a referência não foi resolvida. Normalmente é um erro de digitação no id do componente ou no id do valor de retorno — lembre-se de que é o **Identifier** do bloco, não o nome exibido nele. Verifique também a grafia de `local.components` em si: `{{local.componets.api-get-1.returnValues.response-body}}` é enviado como texto literal e a execução ainda reporta **Executed**.
- Se você vir uma string vazia, o bloco anterior rodou, mas não produziu aquele campo.

A aba **Full Log** carrega uma linha de aviso nomeando qualquer referência que não foi resolvida, que é geralmente a forma mais rápida de encontrá-la.

### "Funciona quando eu rodo manualmente, mas não a partir do gatilho."

Abra o **Builder**, clique em **Run Workflow** e preencha os campos do gatilho com valores parecidos com os que o gatilho real envia. Depois compare os valores **Received** dessa execução com os da execução real, lado a lado. A diferença costuma ser um único nome de campo ou tipo.

## Reexecutando um workflow

Não existe um botão "repetir esta execução". Não reexecutamos execuções antigas automaticamente porque os efeitos colaterais — mensagens no Slack, chamadas de API, tickets — podem não ser seguros de repetir. Para refazer o trabalho, corrija o workflow e deixe o próximo gatilho real dispará-lo, ou abra o **Builder** e clique em **Run Workflow** com os mesmos valores.

## Por quanto tempo as execuções são mantidas?

No OneUptime Cloud, as execuções são mantidas por **30 dias** e depois excluídas — é por isso que ambas as listas de execuções se descrevem como cobrindo os últimos 30 dias. Instalações self-hosted mantêm as execuções até você excluí-las; se um workflow roda com muita frequência e lota seu histórico, desabilite-o ou exclua-o para parar de adicionar ruído.

Execuções registradas antes da adição do rastreamento de etapas não têm conteúdo em **Steps** e mostram apenas seu **Full Log**.

## Onde ler a seguir

- [Configuração e segurança de workflow](/docs/workflows/configuration) — tempos limite, limites de recursão, segredos ocultos.
- [Variáveis de workflow](/docs/workflows/variables) — a sintaxe de variáveis usada nos seus blocos.
- [Componentes de workflow](/docs/workflows/components) — o que cada bloco produz.
