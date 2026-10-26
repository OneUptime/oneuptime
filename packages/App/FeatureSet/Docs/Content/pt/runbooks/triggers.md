# Gatilhos de runbook

Um runbook pode começar sozinho: segundo um agendamento, ou quando outra ferramenta chama a URL do webhook dele. Use um agendamento para trabalhos de rotina, como uma limpeza noturna ou uma verificação semanal de certificados, e o webhook para iniciar um runbook a partir de um sistema de alertas, um pipeline de CI ou um script. Ambos são configurados na página **Gatilhos** do runbook.

:::cards
- [Executar por agendamento](#executar-por-agendamento): A cada poucos minutos, todos os dias, em dias da semana ou com uma expressão cron.
- [Chamar o webhook](#chamar-o-webhook): Iniciar uma execução com uma solicitação POST para a URL do runbook.
- [Valores que uma chamada ao webhook envia](#valores-que-uma-chamada-ao-webhook-envia): Como as etapas leem o JSON que quem chama envia.
- [Solução de problemas](#solução-de-problemas): Um agendamento que não executa, uma chamada recusada.
:::

## Como um gatilho inicia uma execução

```mermaid title="De um agendamento ou uma chamada ao webhook até uma execução"
flowchart TB
    subgraph starts["O que inicia a execução"]
        direction LR
        schedule["O agendamento:<br/>chega um horário"]
        webhook["O webhook: um POST<br/>para a URL dele"]
    end
    schedule --> checks["O runbook está<br/>ativado e tem etapas"]
    webhook --> checks
    checks --> execution["Execução, marcada como<br/>Schedule ou Webhook"]
    execution --> worker["O Worker do OneUptime<br/>executa as etapas"]
```

Um gatilho inicia uma execução como **Executar agora** faz: a execução percorre as etapas atuais do runbook e não fica vinculada a nenhum incidente, alerta ou evento de manutenção programada. Cada execução registra o que a iniciou. As **Execuções** do runbook e **Runbooks → Execuções** mostram isso em **Acionado por**, com o horário previsto de uma execução agendada ou o endereço que chamou o webhook, e as duas listas podem ser filtradas por isso.

## Antes de começar

- Um runbook com pelo menos uma etapa e com o interruptor **Executar este runbook** ativado, na página **Configurações** dele.
- Permissão para editar o runbook e para executá-lo. Veja [Quem pode configurar gatilhos](#quem-pode-configurar-gatilhos).

## Executar por agendamento

:::steps
### Abrir a página Gatilhos do runbook
Abra o runbook em **Runbooks** e clique em **Configurações → Gatilhos** no menu lateral dele. **Configurações** começa recolhido: clique nele para mostrar **Gatilhos**.

### Configurar o agendamento
Clique em **Configurar agendamento**. Em **Quando é executado**, escolha uma opção de **Repetir** e o que ela pede. A caixa de diálogo descreve o agendamento em uma frase, como "É executado em todo dia útil às 09:00", e lista as próximas execuções conforme você o altera.

### Conferir o fuso horário
**Fuso horário** começa com o seu. Os horários do agendamento são lidos no relógio desse fuso.

### Salvar
Clique em **Salvar agendamento**. O agendamento é ativado, e o cartão o mostra em uma frase com as **Próximas execuções**.
:::

| **Repetir** | O que você escolhe | Por exemplo |
| --- | --- | --- |
| **A cada poucos minutos** | **A cada**: 1, 2, 3, 4, 5, 6, 10, 12, 15, 20 ou 30 minutos | A cada 15 minutos |
| **A cada poucas horas** | **A cada**: 1, 2, 3, 4, 6, 8 ou 12 horas, e **Minutos após a hora** | A cada 2 horas aos :30 |
| **Todos os dias** | **Horário** | Todos os dias às 09:00 |
| **Em dias da semana** | **Nestes dias**, com **Dias úteis** e **Todos os dias** como atalhos, e **Horário** | Todo dia útil às 09:00 |
| **Personalizado (expressão cron)** | **Expressão cron** | `0 2 1 * *`: 02:00 no dia 1 de cada mês |

Uma expressão cron tem cinco campos: minuto, hora, dia do mês, mês e dia da semana. Os runbooks são executados no máximo uma vez por minuto, por isso não há campo de segundos. A caixa de diálogo explica uma expressão que não consegue ler, ou uma que nunca é executada, como `0 0 31 2 *`, e não salva nada até que ela possa ser executada.

Depois, o cartão mostra o agendamento, as três próximas execuções no relógio do fuso, o que ele faz quando uma execução ainda está em andamento ou um horário foi perdido, e a **Última execução agendada** com **Ver execução**. **Editar agendamento** abre a mesma caixa de diálogo, e o interruptor **Executar neste agendamento** pausa o agendamento sem perdê-lo.

### Se uma execução ainda estiver em andamento

Uma execução continua em andamento enquanto está na fila, em execução ou aguardando que alguém conclua ou aprove uma etapa, não importa como começou. A configuração **Se uma execução ainda estiver em andamento** do agendamento, recolhida em **Mais campos** na caixa de diálogo, decide o que faz um horário que chega nesse momento:

| Configuração | O que acontece |
| --- | --- |
| **Ignorar esse horário** (padrão) | Nada é iniciado. O agendamento espera o próximo horário. |
| **Executar quando ela terminar** | Uma execução espera e começa quando a execução em andamento termina. Outros horários que chegarem nesse meio-tempo não iniciam nada. |

### Se o OneUptime perdeu um horário

Se o OneUptime estava fora do ar ou sendo atualizado em um horário agendado, o horário é perdido assim que passa de 5 minutos de atraso. **Se o OneUptime perdeu um horário** decide o que acontece quando o OneUptime volta:

| Configuração | O que acontece |
| --- | --- |
| **Executar uma vez quando o OneUptime voltar** (padrão) | Uma execução é iniciada, não importa quantos horários foram perdidos, marcada como "Executada uma vez para compensar horários que o OneUptime perdeu". |
| **Ignorar os horários perdidos** | Nada é iniciado até o próximo horário. |

Horários que passam enquanto o agendamento ou o runbook está desativado não são perdidos: reativar qualquer um deles recomeça a partir do próximo horário.

### Fusos horários e horário de verão

Os horários são lidos o ano todo no relógio do fuso. Um agendamento para as 09:00 em Europe/London é executado às 09:00 no horário de Londres no inverno e no verão. Na noite em que os relógios são adiantados, um horário que não existe naquela noite é executado uma hora depois no relógio. Quando os relógios são atrasados e uma hora acontece duas vezes, um agendamento executado a cada hora é executado nas duas, e qualquer outro agendamento uma só vez, na primeira.

## Chamar o webhook

:::steps
### Ativar o webhook
Na página **Gatilhos** do runbook, ative **Executar quando esta URL for chamada**. O runbook ganha a própria URL.

### Copiar a URL
A **URL do webhook** fica mascarada: clique em **Mostrar** para vê-la, ou em **Copiar URL** para copiá-la inteira. **Experimente** traz um comando `curl` para começar.

### Chamá-la a partir da sua ferramenta
Envie uma solicitação `POST` para a URL, com um objeto JSON como corpo, ou sem corpo:

```bash
curl -X POST "https://oneuptime.com/runbook/webhook/RUNBOOK_ID/SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"host": "web-1", "reason": "Disk almost full"}'
```

### Conferir a execução
A resposta indica a execução iniciada: `{"runbookExecutionId": "...", "status": "Scheduled"}`. A execução aparece nas **Execuções** do runbook, onde **Acionado por** diz **Webhook**, e a página dela mostra o que a chamada enviou em **Entradas**.
:::

**Enviar solicitação de teste** envia para a URL um `POST` com um corpo que você escreve, como outra ferramenta faria, e vincula a execução iniciada. É uma execução real do runbook.

### O que uma chamada recebe como resposta

| Resposta | Quando |
| --- | --- |
| `200` | A execução foi iniciada. O corpo a indica. |
| `400` | O corpo não é um objeto JSON, está aninhado em mais de 32 níveis ou contém um caractere NUL, ou o runbook não tem etapas. |
| `403` | O webhook ou o runbook está desativado. |
| `404` | Nenhum webhook de runbook responde nesta URL: o ID do runbook ou a chave está errado, ou a URL foi redefinida. |
| `405` | A solicitação é um `GET`. Um `GET` nunca inicia uma execução, então a pré-visualização de um link em um app de chat não consegue executá-lo por acidente. |
| `413` | O corpo é maior que 64 KB. |
| `429` | O webhook iniciou 30 execuções no último minuto, 10 das execuções dele ainda estão em andamento, ou um endereço fez mais de 120 chamadas a webhooks de runbook em um minuto, ou os endereços de um mesmo /64 IPv6 mais de 1200 juntos. O cabeçalho `Retry-After` diz quando tentar de novo, quando possível. |
| `503` | O OneUptime não consegue contar as chamadas agora. Tente de novo em um minuto. |

Uma chamada recusada não inicia nada, e o corpo dela diz o motivo em uma frase, como "This runbook is turned off, so it was not started. Turn it on with Run this runbook, under the runbook's Settings."

### Manter a URL em sigilo

A URL contém a chave secreta do runbook: qualquer pessoa que a tenha pode iniciar o runbook. A chave tem 43 caracteres aleatórios, é comparada em tempo constante, e uma chave errada recebe a mesma resposta que receberia se o runbook não existisse.

Se a URL vazar, clique em **Redefinir URL**. O runbook ganha uma nova URL e a antiga para de funcionar na hora, então passe a nova para cada ferramenta que a chama. Desativar e reativar o webhook mantém a mesma URL.

## Valores que uma chamada ao webhook envia

Os valores de nível superior do corpo viram as entradas da execução. Eles chegam às etapas como dados, nunca como texto colado em um script ou comando:

| Tipo de etapa | Como lê as entradas |
| --- | --- |
| Bash e kubectl | Variáveis de ambiente: uma `ONEUPTIME_INPUT_<NAME>` para cada valor de nível superior, `ONEUPTIME_INPUTS` com o objeto inteiro em JSON e `ONEUPTIME_TRIGGER` com o que iniciou a execução, como `Webhook` ou `Schedule`. |
| JavaScript | `args.inputs`, o objeto como foi enviado, e `args.trigger`. |
| AI | No prompt, marcadas como dados de fora do OneUptime, quando **Incluir o contexto do gatilho** está ativado. |
| HTTP request e SSH | De forma alguma. A URL, o script e o destino deles são o que está escrito no runbook, e nada que quem chama envia os altera. |

O nome de uma variável é o nome do valor em maiúsculas, com cada caractere que não seja letra ou dígito escrito como `_`: `host-name` vira `ONEUPTIME_INPUT_HOST_NAME`. Texto é passado como está, números e `true` ou `false` como escritos, e objetos e listas como JSON. Uma etapa recebe no máximo 100 dessas variáveis, e um nome com mais de 100 caracteres não vira nenhuma; todo valor continua em `ONEUPTIME_INPUTS`. Todo nome começa com `ONEUPTIME_`, então quem chama não consegue definir `PATH` nem nenhuma outra variável que o Runner lê.

Quem chama decide esses valores, então confira-os antes de agir com base neles:

```bash
set -euo pipefail
case "$ONEUPTIME_INPUT_HOST" in
  web-1|web-2|web-3) ;;
  *) echo "Unknown host: $ONEUPTIME_INPUT_HOST"; exit 1 ;;
esac
curl -fsS -X POST "http://$ONEUPTIME_INPUT_HOST.internal:8080/restart"
```

```javascript
const host = args.inputs.host;
if (!["web-1", "web-2", "web-3"].includes(host)) {
  throw new Error(`Unknown host: ${host}`);
}
console.log(`Started by ${args.trigger} for ${host}`);
return { host };
```

## Quem pode configurar gatilhos

Um agendamento ou um webhook inicia execuções sem ninguém presente, então configurar um exige permissão para editar o runbook e para executá-lo: Project Owner, Project Admin ou Runbook Admin, ou **Edit Runbook** junto com Project Member, Runbook Member ou **Create Runbook Execution**. Os rótulos aos quais uma função está limitada contam, como em **Executar agora**. Ver ou redefinir a URL do webhook exige o mesmo.

Desativar um agendamento ou um webhook não inicia nada, então exige apenas permissão para editar o runbook. Quem pode editar o runbook mas não executá-lo vê a página **Gatilhos** com **Configurar agendamento** bloqueado, e fica sabendo quem pode ver a URL do webhook.

## Solução de problemas

:::details Nada é executado no agendamento
O runbook está desativado ou não tem etapas: o cartão diz qual dos dois. Ative **Executar este runbook** na página **Configurações** do runbook, ou adicione etapas na página **Etapas** dele. Se o cartão disser que o agendamento está pausado, ative **Executar neste agendamento**.
:::

:::details Um horário agendado não iniciou nada
Uma execução ainda estava em andamento e o agendamento ignora esses horários, ou o OneUptime perdeu o horário e o agendamento ignora horários perdidos. Veja [Se uma execução ainda estiver em andamento](#se-uma-execução-ainda-estiver-em-andamento) e [Se o OneUptime perdeu um horário](#se-o-oneuptime-perdeu-um-horário).
:::

:::details Salvar um agendamento falha com "You do not have permission to set up this runbook's schedule or webhook."
Configurar um gatilho exige permissão para executar o runbook, além de editá-lo. Peça Runbook Admin, ou Runbook Member ou **Create Runbook Execution** além de **Edit Runbook**.
:::

:::details Uma chamada recebe a resposta "No runbook webhook answers at this URL."
A URL foi redefinida ou copiada errado. Copie-a de novo na página **Gatilhos** do runbook.
:::

:::details Uma chamada recebe a resposta "This runbook's webhook is turned off, so the runbook was not started."
Ative **Executar quando esta URL for chamada** na página **Gatilhos** do runbook. A URL é a mesma de antes.
:::

## Próximos passos

:::cards
- [Executar um runbook](/docs/runbooks/running): O que uma execução mostra e como fazê-la avançar.
- [Escrever um runbook](/docs/runbooks/authoring): Escrever as etapas que um gatilho executa.
- [Configuração e segurança de runbooks](/docs/runbooks/configuration): Limites, permissões e proteção.
:::
