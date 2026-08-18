# Variáveis

Workflows existem para mover dados — do trigger para o primeiro bloco, de um bloco para o seguinte, e de valores compartilhados para onde você precisar deles. As variáveis são o que faz esses dados se moverem.

Existem dois escopos de variável, além das saídas de componentes produzidas durante uma execução.

## Variáveis globais

Valores de projeto inteiro que você salva uma vez e reutiliza em qualquer lugar. Pense em chaves de API, URLs, nomes de canal — qualquer coisa que você não queira copiar em dez workflows diferentes.

Você as encontra em **Fluxos de trabalho → Variáveis globais**. Cada uma tem:

- **Nome** — como você vai referenciá-la. No mínimo dois caracteres, sem espaços, só letras, números, hifens e sublinhados. `UPPER_SNAKE_CASE` é um bom hábito, porque se destaca dentro dos blocos.
- **Descrição** — opcional, texto livre para lembrar você para que ela serve.
- **Segredo** — quando ligado, o valor é removido dos registros de execução e dos rastros das etapas.
- **Conteúdo** — o valor em si. É um campo de texto longo, então valores de várias linhas funcionam.

Para usar uma variável global em qualquer workflow:

```
{{global.variables.NAME}}
```

Por exemplo: se você salvou sua chave do PagerDuty como `PAGERDUTY_KEY`, qualquer bloco pode usá-la como `{{global.variables.PAGERDUTY_KEY}}` — o editor guarda a referência, e o registro do workflow limpa o valor secreto já resolvido.

Variáveis são criadas e excluídas, não editadas. Não há botão de edição na tabela, então, para mudar um valor pela interface, você exclui a variável e cria de novo — ou atualiza pela API, o que está explicado no fim desta página. Variáveis globais e de workflow são um recurso do plano Growth.

## Variáveis locais de workflow

Variáveis restritas a um único workflow, gerenciadas em **Variáveis do fluxo**, no menu à esquerda daquele workflow. Referencie-as com:

```
{{local.variables.NAME}}
```

## Saídas de componentes (dados de blocos anteriores)

Todo trigger e todo componente pode produzir saída durante uma execução. Use o seletor de valores de componente no editor para montar a referência, em vez de digitá-la — ele insere exatamente os ids que o executor espera.

Referencie a saída de um bloco anterior assim:

```
{{local.components.COMPONENT_ID.returnValues.FIELD_ID}}
```

`COMPONENT_ID` é o **Identifier** do bloco — o id curto mostrado nele, não o nome exibido. Blocos novos ganham algo como `api-get-1`, e você pode renomeá-lo na seção **ID** do bloco. Renomear quebra toda referência que já aponta para ele, do mesmo jeito que renomear uma variável. `FIELD_ID` é o id do valor de retorno escolhido.

Exemplos:

- Depois que um componente **API** com o ID `lookup-user` roda, o código de status dele é `{{local.components.lookup-user.returnValues.response-status}}` e o corpo é `{{local.components.lookup-user.returnValues.response-body}}`.
- Depois que um componente **Run Custom JavaScript** com o ID `transform` roda, o valor retornado é `{{local.components.transform.returnValues.returnValue}}`.
- Triggers de um tipo de registro — **On Create Incident** e afins — retornam exatamente um valor, `model`, e você navega dentro dele. Para um trigger com o ID `incident-on-create-1`, o título do incidente é `{{local.components.incident-on-create-1.returnValues.model.title}}`.

Variáveis locais só existem durante a execução atual. Cada nova execução começa do zero.

## Onde as variáveis funcionam

Quase todo campo de texto aceita variáveis:

- A URL de um bloco de API.
- O texto da mensagem em Slack, Teams, Discord, Telegram, Email.
- O assunto e o corpo de um e-mail.
- Campos de cabeçalho e de corpo (dentro de valores de texto).
- Os dois lados de um bloco **If / Else** (listado na categoria Conditions).

Em campos JSON você pode usar uma variável dentro de um valor de texto, mas não como chave. Uma referência que ocupa um valor inteiro sozinha é substituída sem aspas, então dá para jogar um objeto completo em um campo JSON dessa forma. Se precisar montar uma estrutura dinamicamente, use um bloco **Run Custom JavaScript** para construí-la e passe a saída dele ao bloco seguinte.

O bloco **Run Custom JavaScript** não recebe variáveis automaticamente — nada é injetado no sandbox. Coloque `{{global.variables.NAME}}` (ou qualquer referência de componente) no campo JSON **Arguments** do bloco; esses valores são substituídos antes de o script rodar e chegam como `args`.

## Iterando sobre arrays

Dentro de um campo de texto você pode percorrer um array com `{{#each path}}…{{/each}}`. Dentro do bloco, `{{property}}` lê o elemento atual, `{{@index}}` é a posição começando em 0, e `{{this}}` é o próprio elemento, no caso de arrays de valores simples. Nomes dentro de um bloco `{{#each}}` passam por trim, então espaços perdidos ali são inofensivos — ao contrário do que acontece em todo o resto.

## Exemplos

### Montando um payload a partir de um webhook

Chega um webhook com um corpo como `{ "service": "checkout", "status": "failed" }`. Para transformar isso em um incidente no OneUptime:

1. Trigger **Webhook** com o id `ci-webhook`.
2. Bloco **If / Else**: selecione a saída Request Body do webhook e use a propriedade `status` dela, operador `==`, lado direito `failed`.
3. Da ramificação **Sim**, um bloco **Create One Incident** com:
   - Título: `CI build failed: {{local.components.ci-webhook.returnValues.request-body.service}}`
   - Descrição: `See {{local.components.ci-webhook.returnValues.request-body.url}} for the logs.`

### Usando um segredo em uma chamada de API

Um workflow que chama o PagerDuty:

1. Salve `PAGERDUTY_KEY` como uma variável global secreta.
2. No bloco **API**, defina o cabeçalho `Authorization` como `Token token={{global.variables.PAGERDUTY_KEY}}`.

A chave fica fora do workflow e fora dos registros.

### Encadeando duas chamadas de API

A primeira chamada devolve um ID de que a segunda precisa:

1. Componente **API** `lookup-order`: use o seletor para inserir o campo de e-mail do JSON do trigger manual em `GET /orders?email=...`.
2. Componente **API** `cancel-order`: `POST /orders/{{local.components.lookup-order.returnValues.response-body.id}}/cancel`.

Se `lookup-order` falhar, a saída **Erro** dispara em vez da **Sucesso**. Ligue-a a um bloco de Email ou Slack para que as falhas não passem despercebidas.

## Atualizando uma variável a partir de um workflow

Um padrão comum é rotacionar uma credencial em um agendamento: buscar um token novo em um terceiro e guardá-lo de volta na variável, para a próxima execução usá-lo. Faça isso com um bloco **API** chamando a API do OneUptime.

`PUT /api/workflow-variable/<variable-id>` com um cabeçalho `ApiKey` e — esta é a parte que costuma pegar as pessoas — os campos que você quer alterar **dentro de um objeto `data`**:

```json
{
  "data": {
    "content": "{{local.components.get-token.returnValues.response-body.access_token}}"
  }
}
```

Um corpo plano, sem o invólucro `data`, é recusado com um 400. Envie só os campos que você realmente quer alterar; `name` e `description` podem ficar de fora do payload.

A chave de API precisa de **Edit Workflow Variables**. Nenhuma permissão de leitura é necessária — a atualização não relê a linha.

Duas coisas para ficar de olho:

- **Não renomeie uma variável que você referencia.** O `name` faz parte de `{{local.variables.NAME}}`. Mudá-lo deixa toda referência existente sem resolução, e uma referência não resolvida é repassada como texto literal — veja a armadilha abaixo.
- **Uma variável pode ser escrita desse jeito, mas nunca lida de volta.** O `content` é somente escrita pela API, para toda variável, secreta ou não. É isso que faz de uma variável um lugar seguro para guardar um token rotativo. Marcá-la como secreta ainda mantém o valor fora dos registros de execução e dos rastros das etapas.

## Armadilhas

- **Use os seletores.** Eles inserem exatamente os ids de componente, de valor de retorno e de variável que o executor espera, e mantêm as referências independentes dos rótulos exibidos.
- **Nomes de variável diferenciam maiúsculas de minúsculas.** `{{global.variables.MyKey}}` e `{{global.variables.mykey}}` são coisas distintas.
- **Uma referência que não resolve fica como está, não vira vazio.** Referenciar algo que não existe não é um erro, e também não devolve uma string vazia: as chaves são repassadas direto, então `{{local.components.api-get-1.returnValues.body}}` com um id de etapa errado vai parar literalmente na sua mensagem do Slack, na URL ou no corpo da requisição, e a execução ainda é reportada como **Executed**. O registro da execução traz uma linha de aviso nomeando qualquer referência que passou batido.
- **O construtor não consegue verificar nomes de variável.** Ele sinaliza referências de componente que não consegue casar — um id de etapa desconhecido, um valor de retorno desconhecido, uma raiz malformada — antes de você salvar. Ele não tem como saber se uma variável existe, então uma variável renomeada só é pega pelo registro da execução.
- **Espaços dentro das chaves não passam por trim.** `{{ local.variables.NAME }}` é uma busca diferente de `{{local.variables.NAME}}` e nunca resolve. A única exceção é dentro de um bloco `{{#each}}`, onde os nomes passam por trim.

## Onde ler em seguida

- [Componentes de workflow](/docs/workflows/components) — a lista completa das saídas que cada bloco produz.
- [Execuções e registros de workflow](/docs/workflows/runs-and-logs) — veja o valor real de cada variável depois de uma execução.
- [Configuração e segurança de workflow](/docs/workflows/configuration) — o que é seguro colocar em uma variável global.
