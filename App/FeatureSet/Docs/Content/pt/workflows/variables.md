# Variáveis

Workflows são sobre mover dados — do gatilho para o primeiro bloco, de um bloco para o próximo e de valores compartilhados para qualquer lugar onde você precise. Variáveis são como esses dados se movem.

Existem dois tipos, e ambos compartilham a mesma sintaxe.

## Variáveis globais

Valores no nível do projeto que você salva uma vez e reutiliza em qualquer lugar. Pense em chaves de API, URLs, nomes de canal — qualquer coisa que você não queira copiar para dez workflows diferentes.

Encontre-as em **Workflows → Variáveis Globais**. Cada uma tem:

- **Nome** — como você vai referenciá-la. Use `UPPER_SNAKE_CASE` para destacar nos seus blocos.
- **Valor** — o valor em si. Valores com várias linhas também funcionam.
- **É Segredo** — quando ativado, o valor é ocultado na interface depois que você salva e fica oculto nos logs das execuções.

Use uma variável global em qualquer workflow com:

```
{{variable.NAME}}
```

Por exemplo, se você salvou sua chave do PagerDuty como `PAGERDUTY_KEY`, qualquer bloco pode usá-la como `{{variable.PAGERDUTY_KEY}}` — a chave real nunca aparece no workflow nem nos seus logs.

## Variáveis locais (dados de blocos anteriores)

Variáveis locais são a saída de blocos que já rodaram nesta execução. Todo gatilho e todo componente produz alguma saída que você pode ler.

Referencie a saída de um bloco anterior assim:

```
{{BlockName.fieldName}}
```

`BlockName` é o nome do gatilho ou componente no canvas (você pode renomeá-lo para algo curto e claro). `fieldName` é o que aquele bloco produz.

Exemplos:

- Depois que um bloco **API** chamado `LookupUser` roda, você pode ler o código de status como `{{LookupUser.response-status}}` e o corpo como `{{LookupUser.response-body}}`.
- Depois de um gatilho **Incidente → Na Criação** chamado `Incident`, você pode ler `{{Incident.title}}`, `{{Incident.description}}` e qualquer outro campo do incidente.
- Depois de um bloco **Código Customizado** chamado `Transform`, o valor retornado fica em `{{Transform.value}}`.

Variáveis locais só existem durante a execução atual. Cada nova execução começa do zero.

## Onde as variáveis funcionam

Quase todo campo de texto aceita variáveis:

- A URL em um bloco API.
- O texto da mensagem em Slack, Teams, Discord, Telegram, E-mail.
- O assunto e corpo de um e-mail.
- Campos de cabeçalhos e corpo (dentro de valores de string).
- Os dois lados de um bloco Condições.

Campos JSON puros aceitam variáveis dentro de valores de string, mas você não pode usar uma variável como chave. Se precisar construir uma estrutura dinamicamente, use um bloco **Código Customizado** para construí-la e depois passe a saída para o próximo bloco.

O bloco **Código Customizado** lê variáveis de forma diferente — variáveis globais chegam em `args.variables`, e você decide quais saídas anteriores passar como argumentos.

## Exemplos

### Construindo um payload a partir de um webhook

Um webhook chega com um corpo como `{ "service": "checkout", "status": "failed" }`. Para transformar isso em um incidente no OneUptime:

1. Gatilho **Webhook** chamado `CIWebhook`.
2. Bloco **Condições**: à esquerda `{{CIWebhook.Request Body.status}}`, operador `==`, à direita `failed`.
3. Do ramo **Sim**, um bloco **Criar Incidente** com:
   - Título: `CI build failed: {{CIWebhook.Request Body.service}}`
   - Descrição: `See {{CIWebhook.Request Body.url}} for the logs.`

### Usando um segredo em uma chamada de API

Um workflow que chama o PagerDuty:

1. Salve `PAGERDUTY_KEY` como uma variável global secreta.
2. No bloco **API**, defina o cabeçalho `Authorization` como `Token token={{variable.PAGERDUTY_KEY}}`.

A chave fica fora do workflow e dos logs.

### Encadeando duas chamadas de API

A primeira chamada te dá um ID que a segunda precisa:

1. Bloco **API** `LookupOrder`: `GET /orders?email={{Manual.JSON.email}}`.
2. Bloco **API** `CancelOrder`: `POST /orders/{{LookupOrder.response-body.id}}/cancel`.

Se `LookupOrder` falhar, a saída de **erro** dispara em vez da de **sucesso**. Conecte-a a um bloco de E-mail ou Slack para que falhas não passem despercebidas.

## Armadilhas

- **Renomear um bloco quebra referências.** Se você renomear um bloco, atualize todos os lugares onde ele é usado. No log da execução, uma referência não resolvida aparece como o texto literal `{{BlockName.field}}`.
- **Nomes de variáveis diferenciam maiúsculas de minúsculas.** `{{variable.MyKey}}` e `{{variable.mykey}}` são diferentes.
- **Campos ausentes ficam vazios.** Referenciar um campo que não existe te dá uma string vazia, não um erro. Conveniente — mas pode esconder bugs. Use um bloco **Condições** para verificar campos importantes antes de continuar.

## O que ler em seguida

- [Componentes](/docs/workflows/components) — a lista completa das saídas que cada bloco produz.
- [Execuções e Registros](/docs/workflows/runs-and-logs) — veja o valor real de cada variável depois de uma execução.
- [Configuração e Segurança](/docs/workflows/configuration) — o que é seguro colocar em uma variável global.
