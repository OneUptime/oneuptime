# Critères de surveillance : expression JavaScript

Vous pouvez utiliser des expressions JavaScript pour créer des critères de surveillance personnalisés. L'expression est évaluée dans le contexte de l'objet surveillé. L'expression doit retourner une valeur booléenne. Si l'expression retourne `true`, les critères de surveillance sont satisfaits. Si l'expression retourne `false`, les critères de surveillance ne sont pas satisfaits.

L'expression JavaScript comme critère de surveillance est disponible pour les types de surveillance suivants : API, site Web et requête entrante.

### Moniteurs de sites Web et API

Les variables suivantes sont disponibles dans le contexte de l'objet surveillé :

| Variable | Description | Type |
| --- | --- | --- |
| `responseBody` | L'objet corps de la réponse. Si le corps de la réponse est en HTML/XML, ce sera de type chaîne. Si le corps de la réponse est en JSON, ce sera en JSON | `string` ou `JSON` |
| `responseHeaders` | L'objet en-têtes de la réponse. | `Dictionary<string>` |
| `responseStatusCode` | Le code de statut de la réponse. | `number` |
| `responseTimeInMs` | Le temps de réponse en millisecondes. | `number` |

#### Exemple

L'exemple suivant montre comment utiliser une expression JavaScript pour surveiller un site Web à la recherche d'une chaîne spécifique dans le corps de la réponse :

```javascript

/**
 *  
 * Si le corps de la réponse est en JSON, responseBody sera un objet JSON
 * {
 *    "item": "hello"
 * }
 * 
 *  **/

"{{responseBody.item}}" === "hello"

// ou vous pouvez utiliser les en-têtes de réponse

"{{responseHeaders.contentType}} === "application/json"


// vous pouvez également utiliser des expressions régulières

"{{responseBody.item}}".match(/hello/)

// vous pouvez également utiliser le code de statut de réponse

{{responseStatusCode}} === 200

// vous pouvez combiner plusieurs expressions à l'aide d'opérateurs logiques

"{{responseBody.item}}" === "hello" && {{responseStatusCode}} === 200

// pour les tableaux, vous pouvez utiliser ce qui suit

/**
 *  
 * Si le corps de la réponse est : 
 * {
 *    "item": [{
 *          "name": "hello"
 *      }]
 * }
 * 
 *  **/

"{{responseBody.items[0].name}}" === "hello"
```

### Moniteurs de requêtes entrantes

Les variables suivantes sont disponibles dans le contexte de l'objet surveillé :

| Variable | Description | Type |
| --- | --- | --- |
| `requestBody` | L'objet corps de la requête. | `string` ou `JSON` |
| `requestHeaders` | L'objet en-têtes de la requête. | `Dictionary<string>` |


#### Exemple

L'exemple suivant montre comment utiliser une expression JavaScript pour surveiller une requête entrante à la recherche d'une chaîne spécifique dans le corps de la requête :

```javascript
"{{requestBody.item}}" === "hello"

// ou vous pouvez utiliser les en-têtes de requête

"{{requestHeaders.contentType}}" === "text/html"

// vous pouvez également utiliser des expressions régulières

"{{requestBody.item}}".match(/hello/)

// vous pouvez combiner plusieurs expressions à l'aide d'opérateurs logiques

"{{requestBody.item}}" === "hello" && "{{requestHeaders.contentType}}" === "text/html"

// vous pouvez utiliser ce qui suit pour les tableaux

"{{requestBody.items[0].name}}" === "hello"
```

### Points à considérer

* Les scripts ont un délai d'attente de 1 seconde ; ils retourneront `false` si le script prend plus d'une seconde à s'exécuter.
* `{{var}}` remplacera la variable par sa valeur ; donc si vous souhaitez comparer une chaîne, vous devez l'entourer de guillemets, par exemple `"{{responseBody.item}}" === "hello"`, et si vous souhaitez comparer un nombre, vous n'avez pas besoin de guillemets, par exemple `{{responseStatusCode}} === 200`
