# Variáveis

Workflows são sobre mover dados — do gatilho para o primeiro bloco, de um bloco para o próximo, e de valores compartilhados para qualquer lugar em que você precise deles. Variáveis são como esses dados se movem.

Há dois escopos de variável, além das saídas de componentes produzidas durante uma execução.

## Variáveis globais

Valores em nível de projeto que você salva uma vez e reutiliza em qualquer lugar. Pense em chaves de API, URLs, nomes de canais — qualquer coisa que você não queira copiar em dez workflows diferentes.

Encontre-as em **Workflows → Global Variables**. Cada uma tem:

- **Name** — como você vai referenciá-la. Pelo menos dois caracteres, sem espaços, e apenas letras, números, hífens e underscores. `UPPER_SNAKE_CASE` é um bom hábito porque se destaca nos seus blocos.
- **Description** — opcional, texto livre para lembrar você para que ela serve.
- **Secret** — quando ativado, o valor é removido dos registros de execução e dos rastros de etapas.
- **Content** — o valor em si. É um campo de texto longo, então valores de várias linhas funcionam.

Use uma variável global em qualquer workflow com:

```
{{global.variables.NAME}}
```

Por exemplo, se você salvou sua chave do PagerDuty como `PAGERDUTY_KEY`, qualquer bloco pode usá-la como `{{global.variables.PAGERDUTY_KEY}}` — o editor guarda a referência, e o registro do workflow oculta o valor secreto resolvido.

Variáveis são criadas e excluídas, não editadas. Não há botão de edição na tabela, então, para mudar um valor pela interface, você exclui a variável e a cria de novo — ou atualiza via API, o que é abordado no fim desta página. Variáveis globais e de workflow são um recurso do plano Growth.

## Variáveis locais de workflow

Variáveis com escopo limitado a um workflow, gerenciadas em **Workflow Variables** no menu lateral daquele workflow. Referencie-as com:

```
{{local.variables.NAME}}
```

## Saídas de componentes (dados de blocos anteriores)

Todo gatilho e componente pode produzir uma saída durante uma execução. Use o seletor de valores de componente no editor para criar a referência em vez de digitá-la — ele insere exatamente os ids que o executor espera.

Referencie a saída de um bloco anterior assim:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` é o **Identifier** do bloco — o id curto mostrado no bloco, não o nome exibido nele. Blocos novos recebem um como `api-get-1`, e você pode renomeá-lo na seção **ID** do bloco. Renomeá-lo quebra toda referência que já aponta para ele, do mesmo jeito que renomear uma variável. `FIELD_ID` é o id do valor de retorno selecionado.

Exemplos:

- Depois que um componente **API** cujo ID é `lookup-user` roda, seu código de status é `{{local.components.lookup-user.returnValues.response-status}}` e seu corpo é `{{local.components.lookup-user.returnValues.response-body}}`.
- Depois que um componente **Run Custom JavaScript** cujo ID é `transform` roda, seu valor retornado é `{{local.components.transform.returnValues.returnValue}}`.
- Gatilhos de um tipo de registro — **On Create Incident** e afins — retornam exatamente um valor, `model`, e você desce até o campo desejado. Para um gatilho cujo ID é `incident-on-create-1`, o título do incidente é `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Variáveis locais existem apenas durante a execução atual. Cada nova execução começa do zero.

## Onde as variáveis funcionam

Quase todo campo de texto aceita variáveis:

- A URL de um bloco API.
- O texto da mensagem em Slack, Teams, Discord, Telegram, Email.
- O assunto e o corpo de um e-mail.
- Cabeçalhos e campos de corpo (dentro de valores de string).
- Os dois lados de um bloco **If / Else** (listado na categoria Conditions).

Em campos JSON você pode usar uma variável dentro de um valor de string, mas não como chave. Uma referência que ocupa um valor inteiro sozinha é substituída sem aspas, então você pode inserir um objeto inteiro em um campo JSON dessa forma. Se precisar montar uma estrutura dinamicamente, use um bloco **Run Custom JavaScript** para construí-la e depois passe a saída dele para o próximo bloco.

O bloco **Run Custom JavaScript** não recebe variáveis automaticamente — nada é injetado na sandbox. Coloque `{{global.variables.NAME}}` (ou qualquer referência de componente) no campo JSON **Arguments** do bloco; esses valores são substituídos antes de o script rodar e chegam como `args`.

## Iterando sobre arrays

Dentro de um campo de texto você pode iterar um array com `{{#each path}}…{{/each}}`. Dentro do bloco, `{{property}}` lê do elemento atual, `{{@index}}` é a posição baseada em 0, e `{{this}}` é o próprio elemento para arrays de valores simples. Nomes dentro de um bloco `{{#each}}` são cortados nas bordas, então espaços perdidos ali são inofensivos — diferente de todo o resto.

## Exemplos

### Montando um payload a partir de um webhook

Um webhook chega com um corpo como `{ "service": "checkout", "status": "failed" }`. Para transformar isso em um incidente do OneUptime:

1. Gatilho **Webhook** com o id `ci-webhook`.
2. Bloco **If / Else**: selecione a saída Request Body do webhook e use sua propriedade `status`, operador `==`, lado direito `failed`.
3. A partir do ramo **Yes**, um bloco **Create One Incident** com:
   - Title: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Description: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Usando um segredo em uma chamada de API

Um workflow que chama o PagerDuty:

1. Salve `PAGERDUTY_KEY` como uma variável global secreta.
2. No bloco **API**, defina o cabeçalho `Authorization` como `Token token={{global.variables.PAGERDUTY_KEY}}`.

A chave fica fora do workflow e dos registros.

### Encadeando duas chamadas de API

A primeira chamada fornece um ID que a segunda precisa:

1. Componente **API** `lookup-order`: use o seletor para inserir o campo JSON de e-mail do gatilho manual em `GET /orders?email=...`.
2. Componente **API** `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Se `lookup-order` falhar, sua saída **Error** dispara em vez de **Success**. Conecte isso a um bloco de Email ou Slack para que falhas não passem despercebidas.

## Atualizando uma variável a partir de um workflow

Um padrão comum é rotacionar uma credencial em um agendamento: buscar um token novo de terceiros e depois guardá-lo de volta na variável para que a próxima execução o utilize. Faça isso com um bloco **API** chamando a API do OneUptime.

`PUT /api/workflow-variable/<variable-id>` com um cabeçalho `ApiKey`, e — esta é a parte que costuma pegar as pessoas — os campos que você quer mudar **envolvidos em um objeto `data`**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

Um corpo plano sem o envoltório `data` é rejeitado com um 400. Envie apenas os campos que você realmente quer mudar; `name` e `description` podem ficar de fora do payload.

A chave de API precisa de **Edit Workflow Variables**. Nenhuma permissão de leitura é necessária — a atualização não lê a linha de volta.

Duas coisas a observar:

- **Não renomeie uma variável que você referencia.** `name` faz parte de `{{local.variables.NAME}}`. Mudá-lo deixa toda referência existente sem resolução, e uma referência não resolvida passa como texto literal — veja a armadilha abaixo.
- **Uma variável pode ser escrita desta forma, mas nunca lida de volta.** `content` é somente-escrita via API para toda variável, secreta ou não. É isso que torna uma variável um lugar seguro para guardar um token rotativo. Marcá-la como secreta ainda mantém o valor fora dos registros de execução e dos rastros de etapas.

## Armadilhas

- **Use os seletores.** Eles inserem exatamente os ids de componente, valor de retorno e variável que o executor espera, e mantêm as referências independentes dos rótulos exibidos.
- **Nomes de variáveis diferenciam maiúsculas de minúsculas.** `{{global.variables.MyKey}}` e `{{global.variables.mykey}}` são coisas diferentes.
- **Uma referência que não resolve é deixada como está, não fica em branco.** Referenciar algo que não existe não é um erro, e também não resulta em uma string vazia: as chaves passam direto, então `{{local.components.api-get-1.returnValues.body}}` com um id de etapa digitado errado acaba, literalmente, na sua mensagem do Slack, na URL ou no corpo da requisição, e a execução ainda reporta **Executed**. O registro da execução carrega uma linha de aviso nomeando qualquer referência que tenha passado despercebida.
- **O builder não consegue verificar nomes de variáveis.** Ele sinaliza referências de componente que não consegue casar — um id de etapa desconhecido, um valor de retorno desconhecido, uma raiz malformada — antes de você salvar. Ele não consegue saber se uma variável existe, então uma variável renomeada só é detectada pelo registro da execução.
- **Espaços dentro das chaves não são removidos.** `{{ local.variables.NAME }}` é uma busca diferente de `{{local.variables.NAME}}` e nunca resolve. A única exceção é dentro de um bloco `{{#each}}`, onde os nomes são cortados nas bordas.

## Onde ler a seguir

- [Componentes de workflow](/docs/workflows/components) — a lista completa de saídas que cada bloco produz.
- [Execuções e registros de workflow](/docs/workflows/runs-and-logs) — veja o valor real de cada variável depois de uma execução.
- [Configuração e segurança de workflow](/docs/workflows/configuration) — o que é seguro colocar em uma variável global.
