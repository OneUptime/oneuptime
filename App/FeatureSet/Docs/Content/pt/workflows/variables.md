# Variáveis

Um workflow só é útil quando os dados fluem por ele. Variáveis são como esses dados se movem — do gatilho para o primeiro componente, da saída de um componente para a entrada do próximo, e de segredos de nível de projeto para qualquer lugar onde sejam referenciados.

O OneUptime tem dois tipos de variáveis e uma sintaxe de interpolação que funciona para ambos.

## Variáveis globais

Valores de escopo do projeto, definidos uma vez em **Workflows → Variáveis globais**. Pense em chaves de API, URLs base, nomes de canais, qualquer coisa que você não queira deixar hard-coded em dez workflows.

Uma variável global tem:

- **Name** — o identificador pelo qual você a referencia. Use `UPPER_SNAKE_CASE` para torná-la óbvia nos templates.
- **Value** — o valor string. Valores de múltiplas linhas são suportados.
- **Is Secret** — quando ligado, o valor é write-only na interface após salvar e é redigido dos logs de execução.

Referencie uma variável global em qualquer lugar de qualquer workflow com:

```
{{variable.NAME}}
```

Por exemplo, se você definiu `PAGERDUTY_KEY` como variável secreta, todo componente API que chama o PagerDuty pode lê-la como `{{variable.PAGERDUTY_KEY}}` sem ninguém ver a chave de verdade no JSON do workflow.

## Variáveis locais

Variáveis locais são os valores de retorno de nós que já rodaram nesta execução. Todo gatilho e todo componente publica um — consulte [Gatilhos](/docs/workflows/triggers) e [Componentes](/docs/workflows/components) para as listas por nó.

Referencie uma variável local como:

```
{{NodeId.fieldName}}
```

O `NodeId` é o nome do gatilho ou componente no canvas (você pode renomeá-lo para legibilidade — mantenha-o curto e em `PascalCase` para que as referências fiquem limpas). O `fieldName` é o que esse nó publica.

Exemplos:

- Depois que um componente **API** chamado `LookupUser` retorna com sucesso, nós a jusante podem ler o código de status como `{{LookupUser.response-status}}` e o corpo parseado como `{{LookupUser.response-body}}`.
- Depois de um gatilho **Incident → On Create** chamado `Incident`, você pode ler `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}` e qualquer outra coluna do incidente.
- Depois de um componente **Custom Code** chamado `Transform`, o valor retornado fica exposto como `{{Transform.value}}`.

Variáveis locais têm escopo de uma única execução. A próxima execução começa do zero.

## Onde a interpolação funciona

Quase todo argumento do estilo texto suporta interpolação:

- Campos URL no componente API
- Texto de mensagem em Slack / Teams / Discord / Telegram / Email
- Assunto e corpo no Email
- Campos de cabeçalhos e corpo (use dentro de valores JSON)
- Operandos esquerdo e direito em Conditions

Argumentos JSON puros aceitam interpolação dentro de valores string; você não pode interpolar uma chave. Se você precisa construir uma estrutura dinâmica, use **Custom Code** para montar o payload e então alimente o valor de retorno dele no próximo nó.

O componente **Custom Code** lê as variáveis de forma diferente — variáveis globais ficam expostas em `args.variables`, e valores de retorno a montante são passados como argumentos nomeados que você configura no componente.

## Exemplos

### Construir um payload a partir de um gatilho

Um webhook recebe um resultado de build de CI. O corpo é um JSON tipo `{ "service": "checkout", "status": "failed" }`. Para transformar isso em um incidente do OneUptime:

1. Gatilho **Webhook** chamado `CIWebhook`.
2. Componente **Conditions**: esquerda `{{CIWebhook.Request Body.status}}`, operador `==`, direita `failed`.
3. Da porta `yes`, um componente **Create Incident** com:
   - Title: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Description: `See {{CIWebhook.Request Body.url}} for the build logs.`

### Usar um segredo em uma chamada de API de saída

Um workflow que chama o PagerDuty:

1. Defina `PAGERDUTY_KEY` como variável global secreta.
2. No componente **API**, defina o cabeçalho `Authorization` como `Token token={{variable.PAGERDUTY_KEY}}`.

A chave nunca aparece no JSON do workflow nem nos logs de execução.

### Encadear duas chamadas de API

A primeira chamada retorna um ID que a segunda precisa:

1. Componente **API** `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. Componente **API** `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Se `LookupOrder` retornar uma resposta não-2xx, a porta `error` dispara em vez de `success` — conecte esse ramo a um componente Email ou Slack para que falhas não passem despercebidas.

## Algumas pegadinhas

- **Erros de digitação em nomes de nós quebram referências silenciosamente.** Se você renomear um nó depois de ter feito a fiação com `{{OldName.field}}` a jusante, atualize todas as referências. Olhe o log da execução — se você vir o literal `{{OldName.field}}` no argumento capturado, a busca não resolveu.
- **Segredos são case-sensitive.** `{{variable.MyKey}}` e `{{variable.mykey}}` são variáveis diferentes.
- **Campos faltantes ficam vazios.** Referenciar `{{Foo.nonexistent}}` produz uma string vazia, não um erro. Útil, mas pode mascarar bugs — use um nó **Conditions** para verificar presença se o campo for obrigatório para o próximo passo.

## O que ler a seguir

- [Componentes](/docs/workflows/components) — o catálogo completo de nomes de valores de retorno.
- [Execuções e registros](/docs/workflows/runs-and-logs) — inspecione o valor literal de cada argumento interpolado depois de uma execução.
- [Configuração e segurança](/docs/workflows/configuration) — o que é seguro colocar em uma variável global.
