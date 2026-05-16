# Critérios de Monitoramento: Expressão JavaScript

Você pode usar expressões JavaScript para criar critérios de monitoramento personalizados. A expressão é avaliada no contexto do objeto monitorado. A expressão deve retornar um valor booleano. Se a expressão retornar `true`, o critério de monitoramento é atendido. Se a expressão retornar `false`, o critério de monitoramento não é atendido.

A expressão JavaScript como critério de monitoramento está disponível para os seguintes tipos de monitoramento: API, Site e Requisição de Entrada.

### Monitores de Site e API

As seguintes variáveis estão disponíveis no contexto do objeto monitorado:

| Variável | Descrição | Tipo |
| --- | --- | --- |
| `responseBody` | O objeto do corpo de resposta. Se o corpo de resposta estiver em HTML/XML, será do tipo string. Se o corpo de resposta estiver em JSON, será em JSON. | `string` ou `JSON` |
| `responseHeaders` | O objeto de cabeçalhos de resposta. | `Dictionary<string>` |
| `responseStatusCode` | O código de status de resposta. | `number` |
| `responseTimeInMs` | O tempo de resposta em milissegundos. | `number` |

#### Exemplo

O exemplo a seguir mostra como usar uma expressão JavaScript para monitorar um site para uma string específica no corpo de resposta:

```javascript

/**
 *  
 * If response body is in JSON then responseBody will be a JSON object
 * {
 *    "item": "hello"
 * }
 * 
 *  **/

"{{responseBody.item}}" === "hello"

// or you can use response headers

"{{responseHeaders.contentType}} === "application/json"


// you can also use regular expressions

"{{responseBody.item}}".match(/hello/)

// you can also use response status code

{{responseStatusCode}} === 200

// you can combine multiple expressions using logical operators

"{{responseBody.item}}" === "hello" && {{responseStatusCode}} === 200

// for arrays you can use the following

/**
 *  
 * If response body is: 
 * {
 *    "item": [{
 *          "name": "hello"
 *      }]
 * }
 * 
 *  **/

"{{responseBody.items[0].name}}" === "hello"
```

### Monitores de Requisição de Entrada

As seguintes variáveis estão disponíveis no contexto do objeto monitorado:

| Variável | Descrição | Tipo |
| --- | --- | --- |
| `requestBody` | O objeto do corpo de requisição. | `string` ou `JSON` |
| `requestHeaders` | O objeto de cabeçalhos de requisição. | `Dictionary<string>` |


#### Exemplo

O exemplo a seguir mostra como usar uma expressão JavaScript para monitorar uma requisição de entrada para uma string específica no corpo de requisição:

```javascript
"{{requestBody.item}}" === "hello"

// or you can use request headers

"{{requestHeaders.contentType}}" === "text/html"

// you can also use regular expressions

"{{requestBody.item}}".match(/hello/)

// you can combine multiple expressions using logical operators

"{{requestBody.item}}" === "hello" && "{{requestHeaders.contentType}}" === "text/html"

// you can use the following for arrays

"{{requestBody.items[0].name}}" === "hello"
```

### Considerações

* Os scripts têm um timeout de 1 segundo; retornarão `false` se o script levar mais de 1 segundo para executar.
* `{{var}}` substituirá a variável pelo valor, portanto, se você quiser comparar uma string, precisará envolvê-la em aspas, ex.: `"{{responseBody.item}}" === "hello"`, e se quiser comparar um número, não precisará envolvê-lo em aspas, ex.: `{{responseStatusCode}} === 200`
