# Monitoringcriteria: JavaScript-expressie

U kunt JavaScript-expressies gebruiken om aangepaste monitoringcriteria te maken. De expressie wordt geëvalueerd in de context van het bewaakte object. De expressie moet een booleaanse waarde retourneren. Als de expressie `true` retourneert, zijn de monitoringcriteria voldaan. Als de expressie `false` retourneert, zijn de monitoringcriteria niet voldaan.

JavaScript-expressie als monitoringcriterium is beschikbaar voor de volgende monitoringtypen: API, Website en Inkomend verzoek.

### Website- en API-monitors

De volgende variabelen zijn beschikbaar in de context van het bewaakte object:

| Variabele | Beschrijving | Type |
| --- | --- | --- |
| `responseBody` | Het responslichaamobject. Als het responslichaam in HTML/XML is, is dit van het type string. Als het responslichaam in JSON is, is dit in JSON. | `string` of `JSON` |
| `responseHeaders` | Het responsheaderobject. | `Dictionary<string>` |
| `responseStatusCode` | De responsstatuscode. | `number` |
| `responseTimeInMs` | De responstijd in milliseconden. | `number` |

#### Voorbeeld

Het volgende voorbeeld toont hoe u een JavaScript-expressie gebruikt om een website te bewaken op een specifieke tekenreeks in het responslichaam:

```javascript

/**
 *  
 * Als het responslichaam in JSON is, zal responseBody een JSON-object zijn
 * {
 *    "item": "hello"
 * }
 * 
 *  **/

"{{responseBody.item}}" === "hello"

// of u kunt responsheaders gebruiken

"{{responseHeaders.contentType}} === "application/json"


// u kunt ook reguliere expressies gebruiken

"{{responseBody.item}}".match(/hello/)

// u kunt ook de responsstatuscode gebruiken

{{responseStatusCode}} === 200

// u kunt meerdere expressies combineren met logische operatoren

"{{responseBody.item}}" === "hello" && {{responseStatusCode}} === 200

// voor arrays kunt u het volgende gebruiken

/**
 *  
 * Als het responslichaam is: 
 * {
 *    "item": [{
 *          "name": "hello"
 *      }]
 * }
 * 
 *  **/

"{{responseBody.items[0].name}}" === "hello"
```

### Inkomend verzoek-monitors

De volgende variabelen zijn beschikbaar in de context van het bewaakte object:

| Variabele | Beschrijving | Type |
| --- | --- | --- |
| `requestBody` | Het verzoeklichaamobject. | `string` of `JSON` |
| `requestHeaders` | Het verzoekheaderobject. | `Dictionary<string>` |


#### Voorbeeld

Het volgende voorbeeld toont hoe u een JavaScript-expressie gebruikt om een inkomend verzoek te bewaken op een specifieke tekenreeks in het verzoeklichaam:

```javascript
"{{requestBody.item}}" === "hello"

// of u kunt verzoekheaders gebruiken

"{{requestHeaders.contentType}}" === "text/html"

// u kunt ook reguliere expressies gebruiken

"{{requestBody.item}}".match(/hello/)

// u kunt meerdere expressies combineren met logische operatoren

"{{requestBody.item}}" === "hello" && "{{requestHeaders.contentType}}" === "text/html"

// u kunt het volgende gebruiken voor arrays

"{{requestBody.items[0].name}}" === "hello"
```

### Aandachtspunten

* Scripts hebben een time-out van 1 seconde; als het script langer dan 1 seconde duurt om te worden uitgevoerd, wordt `false` geretourneerd.
* `{{var}}` vervangt de variabele door de waarde; als u een tekenreeks wilt vergelijken, moet u deze in aanhalingstekens plaatsen, bijv. `"{{responseBody.item}}" === "hello"`, en als u een getal wilt vergelijken, hoeft u het niet in aanhalingstekens te plaatsen, bijv. `{{responseStatusCode}} === 200`.
