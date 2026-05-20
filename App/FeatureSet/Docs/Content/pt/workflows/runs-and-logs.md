# Execuções e registros

Toda vez que o gatilho de um workflow dispara, o OneUptime cria uma **execução** — um registro de uma execução com tempo, status e saída por nó. As execuções são como você confirma que um workflow funcionou, como depura um que não funcionou e como escreve um postmortem quando uma automação se comportou mal.

## Onde encontrá-las

| Página | Escopo |
| --- | --- |
| **Workflows → Execuções e registros** | Escopo do projeto. Cada execução de cada workflow. Filtre por workflow, status e intervalo de tempo. |
| **Aba Logs de um workflow** | Apenas as execuções deste workflow. |
| **Página de detalhe de uma execução** | Uma execução, expandida com a saída por nó e quaisquer mensagens de erro. |

## Status de execução

| Status | Significado |
| --- | --- |
| **Scheduled** | O gatilho disparou e a execução está enfileirada, mas o worker ainda não a pegou. Geralmente uma fração de segundo. |
| **Running** | O worker está percorrendo o grafo no momento. Componentes de longa duração (chamadas HTTP lentas, atrasos intencionais) mantêm uma execução nesse estado. |
| **Success** | Todo nó que rodou terminou sem erro. (Um workflow que tomou um ramo `error` deliberadamente ainda é `Success` no geral — o workflow em si não falhou.) |
| **Error** | Um nó falhou e não havia uma porta `error` conectada para tratá-lo. A execução parou nesse nó. |
| **Timeout** | A execução excedeu o timeout por execução. Veja [Configuração e segurança](/docs/workflows/configuration). |

## Lendo uma execução

Clique em uma execução na lista para abrir sua página de detalhe. Você vê:

- **Cabeçalho** — o gatilho que disparou, o timestamp de início e fim, a duração total, o status.
- **Lista de nós** — todo nó que executou em ordem, cada um com seus argumentos capturados, seu valor de retorno e a porta de saída escolhida.
- **Erros** — se um nó falhou, a mensagem de erro e (quando disponível) o stack trace.

Os argumentos capturados mostram os valores *pós-interpolação* — ou seja, as strings exatas que o nó viu depois que as variáveis foram resolvidas. Esta é a visão de depuração mais útil que existe: se uma mensagem do Slack tem o texto literal `{{Incident.title}}` dentro dela, você sabe que a referência da variável não resolveu.

## Padrões comuns de depuração

### "Meu workflow não disparou."

1. Confirme que o workflow está **habilitado** em **Settings**. Workflows novos nascem desabilitados.
2. Para um gatilho de evento de modelo: confirme que o evento realmente aconteceu. Abra a entidade (o incidente, alerta, monitor) e olhe o histórico dela.
3. Para um gatilho de webhook: confirme que o sistema externo está batendo na URL certa. Muitas ferramentas registram a entrega de webhooks de saída — cheque lá.
4. Para um gatilho de agendamento: confirme que a expressão cron avalia para o horário que você espera. Use um parser de cron na dúvida.

Se o gatilho disparou, mas nenhuma execução aparece, cheque a cota de execuções do projeto em **Project Settings → Billing**.

### "Roda, mas um nó a jusante nunca executa."

Um nó que não roda geralmente é um problema de fiação. Abra o canvas e cheque:

- A porta de saída do nó a montante está de fato conectada à porta de entrada deste nó?
- O nó a montante tomou uma porta diferente (por exemplo, `error` em vez de `success`, ou `no` em vez de `yes`)? Olhe o detalhe da execução para ver qual porta ele escolheu.

### "Uma variável vem vazia."

Abra o detalhe da execução e olhe os argumentos capturados do nó que falhou. Se você vir o texto literal `{{NodeId.field}}`, a referência não resolveu — provavelmente um erro de digitação em `NodeId` ou `field`. Se você vir uma string vazia, o nó a montante rodou mas não produziu esse campo.

### "Funciona manual, mas não pelo gatilho."

Use **Run Manually** com um payload JSON que espelhe o que o gatilho real publica. Depois compare os argumentos capturados na execução manual e na execução de produção lado a lado — a diferença geralmente está em um único nome de campo ou tipo.

## Reexecutar um workflow

Não existe um botão "tentar novamente esta execução" — por design, o OneUptime nunca re-executa uma execução antiga, porque os efeitos colaterais de saída (mensagens do Slack, chamadas de API) podem não ser idempotentes. Se você quer refazer o trabalho, ajuste o workflow e deixe o próximo gatilho real dispará-lo.

Para workflows manuais, basta clicar em **Run Manually** com o mesmo payload.

## Retenção de logs

As execuções ficam guardadas indefinidamente no projeto. Se você precisa limpar workflows ruidosos de alto volume (por exemplo, um workflow de debug que dispara a cada minuto), desabilite ou exclua — não existe toggle de retenção por workflow.

## O que ler a seguir

- [Configuração e segurança](/docs/workflows/configuration) — timeouts, limites de recursão, redação de segredos.
- [Variáveis](/docs/workflows/variables) — a sintaxe que argumentos interpolados usam.
- [Componentes](/docs/workflows/components) — os campos de valor de retorno que cada componente publica.
