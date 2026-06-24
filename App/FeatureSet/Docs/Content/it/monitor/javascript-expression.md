# Criteri di Monitoraggio: Espressione JavaScript

È possibile usare espressioni JavaScript per creare criteri di monitoraggio personalizzati. L'espressione viene valutata nel contesto dell'oggetto monitorato. L'espressione deve restituire un valore booleano. Se l'espressione restituisce `true`, il criterio di monitoraggio è soddisfatto. Se restituisce `false`, il criterio non è soddisfatto.

Le espressioni JavaScript come criteri di monitoraggio sono disponibili per i seguenti tipi di monitoraggio: API, Sito Web e Richiesta In Entrata.

### Monitor Sito Web e API

Le seguenti variabili sono disponibili nel contesto dell'oggetto monitorato:

| Variabile            | Descrizione                                                                                                                                        | Tipo                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `responseBody`       | L'oggetto corpo della risposta. Se il corpo della risposta è in HTML / XML sarà di tipo stringa. Se il corpo della risposta è in JSON sarà in JSON | `string` o `JSON`    |
| `responseHeaders`    | L'oggetto intestazioni della risposta.                                                                                                             | `Dictionary<string>` |
| `responseStatusCode` | Il codice di stato della risposta.                                                                                                                 | `number`             |
| `responseTimeInMs`   | Il tempo di risposta in millisecondi.                                                                                                              | `number`             |

#### Esempio

L'esempio seguente mostra come usare un'espressione JavaScript per monitorare un sito web alla ricerca di una stringa specifica nel corpo della risposta:

```javascript

/**
 *
 * Se il corpo della risposta è in JSON, responseBody sarà un oggetto JSON
 * {
 *    "item": "hello"
 * }
 *
 *  **/

"{{responseBody.item}}" === "hello"

// oppure si possono usare le intestazioni della risposta

"{{responseHeaders.contentType}} === "application/json"


// si possono anche usare le espressioni regolari

"{{responseBody.item}}".match(/hello/)

// si può anche usare il codice di stato della risposta

{{responseStatusCode}} === 200

// si possono combinare più espressioni usando operatori logici

"{{responseBody.item}}" === "hello" && {{responseStatusCode}} === 200

// per gli array si può usare quanto segue

/**
 *
 * Se il corpo della risposta è:
 * {
 *    "item": [{
 *          "name": "hello"
 *      }]
 * }
 *
 *  **/

"{{responseBody.items[0].name}}" === "hello"
```

### Monitor Richiesta In Entrata

Le seguenti variabili sono disponibili nel contesto dell'oggetto monitorato:

| Variabile        | Descrizione                             | Tipo                 |
| ---------------- | --------------------------------------- | -------------------- |
| `requestBody`    | L'oggetto corpo della richiesta.        | `string` o `JSON`    |
| `requestHeaders` | L'oggetto intestazioni della richiesta. | `Dictionary<string>` |

#### Esempio

L'esempio seguente mostra come usare un'espressione JavaScript per monitorare una richiesta in entrata alla ricerca di una stringa specifica nel corpo della richiesta:

```javascript
"{{requestBody.item}}" === "hello";

// oppure si possono usare le intestazioni della richiesta

"{{requestHeaders.contentType}}" === "text/html";

// si possono anche usare le espressioni regolari

"{{requestBody.item}}".match(/hello/);

// si possono combinare più espressioni usando operatori logici

"{{requestBody.item}}" === "hello" &&
  "{{requestHeaders.contentType}}" === "text/html";

// si può usare quanto segue per gli array

"{{requestBody.items[0].name}}" === "hello";
```

### Considerazioni

- Gli script hanno un timeout di 1 secondo; restituiranno `false` se lo script impiega più di 1 secondo per essere eseguito.
- `{{var}}` sostituirà la variabile con il valore, quindi se si vuole confrontare una stringa, è necessario racchiuderla tra virgolette, ad es. `"{{responseBody.item}}" === "hello"`, mentre se si vuole confrontare un numero non è necessario, ad es. `{{responseStatusCode}} === 200`
