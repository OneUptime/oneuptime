# Execuções e Registros

Toda vez que um workflow roda, o OneUptime salva um registro do que aconteceu — quando rodou, se funcionou e o que cada bloco fez. Esse registro é chamado de **execução**. Execuções são como você confirma que um workflow funcionou, depura um que não funcionou e revisa a atividade passada.

## Onde encontrá-las

| Página                                | O que você vê                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Workflows → Execuções e Registros** | Todas as execuções de todos os workflows do projeto. Filtre por workflow, status e tempo. |
| **Workflow → Aba Logs**               | Apenas as execuções deste workflow.                                                       |
| **Uma execução individual**           | Uma execução, com a saída de cada bloco.                                                  |

## Status de execução

| Status          | Significado                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Agendada**    | O gatilho disparou e a execução está prestes a começar. Geralmente leva uma fração de segundo.                                             |
| **Em Execução** | O workflow está em andamento. Blocos demorados mantêm a execução nesse estado.                                                             |
| **Sucesso**     | Todo bloco que rodou terminou sem erro. (Pegar um ramo de **erro** de propósito ainda conta como sucesso — o próprio workflow não falhou.) |
| **Erro**        | Um bloco falhou e não havia caminho de **erro** conectado para tratá-lo. A execução parou aí.                                              |
| **Timeout**     | A execução durou mais que o permitido. Veja [Configuração e Segurança](/docs/workflows/configuration).                                     |

## Lendo uma execução

Clique em qualquer execução para abrir os detalhes. Você verá:

- **Cabeçalho** — o gatilho, hora de início e fim, duração total e status.
- **Lista de blocos** — todo bloco que rodou, em ordem. Cada um mostra os valores que recebeu, sua saída e qual caminho seguiu.
- **Erros** — se um bloco falhou, a mensagem de erro e (quando disponível) mais detalhes.

Os valores mostrados são exatamente o que o bloco viu — depois que todas as variáveis foram preenchidas. Esta é a visão de depuração mais útil: se uma mensagem do Slack mostra o texto literal `{{Incident.title}}` em vez do título real, você sabe que a variável não foi resolvida.

## Depuração comum

### "Meu workflow não rodou."

1. Confirme se o workflow está **ativado** nas Configurações. Workflows novos começam desativados.
2. Para um gatilho de evento do OneUptime: confirme se o evento de fato aconteceu. Abra o registro e verifique seu histórico.
3. Para um gatilho de webhook: confirme se o outro sistema está enviando para a URL correta. A maioria das ferramentas registra quando envia um webhook — verifique lá.
4. Para um gatilho agendado: confirme se a expressão cron corresponde ao horário esperado.

Se o gatilho disparou mas nenhuma execução aparece, verifique sua cota de execuções em **Configurações do Projeto → Cobrança**.

### "Um bloco posterior nunca rodou."

Um bloco que não roda geralmente é um problema de conexão. Abra o canvas e verifique:

- A saída do bloco anterior está conectada à entrada deste bloco?
- O bloco anterior tomou uma saída diferente do que você esperava (por exemplo, **erro** em vez de **sucesso**, ou **Não** em vez de **Sim**)? O detalhe da execução mostra qual caminho foi seguido.

### "Uma variável veio vazia."

Abra a execução e veja os valores do bloco que falhou.

- Se você ver o texto literal `{{BlockName.field}}`, a referência não foi resolvida — provavelmente um erro de digitação no nome do bloco ou do campo.
- Se você ver uma string vazia, o bloco anterior rodou mas não produziu esse campo.

### "Funciona quando executo manualmente, mas não a partir do gatilho."

Use **Executar Manualmente** com um payload JSON parecido com o que o gatilho real envia. Em seguida, compare os valores da execução manual com a execução real lado a lado. A diferença geralmente é um único nome de campo ou tipo.

## Reexecutando um workflow

Não existe um botão "tentar novamente esta execução". Não reexecutamos execuções antigas automaticamente porque os efeitos colaterais (mensagens no Slack, chamadas de API, tickets) podem não ser seguros de repetir. Para refazer o trabalho, corrija o workflow e deixe o próximo gatilho real dispará-lo.

Para workflows manuais, basta clicar em **Executar Manualmente** com o mesmo payload.

## Por quanto tempo as execuções são mantidas?

As execuções são mantidas indefinidamente para o projeto. Se um workflow roda com muita frequência e polui seu histórico (como um workflow de depuração que dispara a cada minuto), desative-o ou exclua-o para parar de gerar ruído.

## O que ler em seguida

- [Configuração e Segurança](/docs/workflows/configuration) — timeouts, limites de recursão, segredos ocultos.
- [Variáveis](/docs/workflows/variables) — a sintaxe de variáveis usada nos seus blocos.
- [Componentes](/docs/workflows/components) — o que cada bloco produz.
