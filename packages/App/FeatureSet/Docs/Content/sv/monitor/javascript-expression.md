# Övervakningskriterier: JavaScript-uttryck

Du kan använda JavaScript-uttryck för att skapa anpassade övervakningskriterier. Uttrycket utvärderas i kontexten för det övervakade objektet. Uttrycket måste returnera ett booleskt värde. Om uttrycket returnerar `true`, uppfylls övervakningskriterierna. Om uttrycket returnerar `false`, uppfylls inte kriterierna.

JavaScript-uttryck som övervakningskriterier är tillgängliga för följande monitortyper: API, Webbplats och Inkommande förfrågan.

### Webbplats- och API-monitorer

Följande variabler är tillgängliga i kontexten för det övervakade objektet:

| Variabel             | Beskrivning                                                                                                                  | Typ                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `responseBody`       | Svarsinnehållets objekt. Om svarsinnehållet är i HTML/XML är det av typen sträng. Om svarsinnehållet är i JSON är det i JSON | `string` eller `JSON` |
| `responseHeaders`    | Svarshuvudenas objekt.                                                                                                       | `Dictionary<string>`  |
| `responseStatusCode` | Svarets statuskod.                                                                                                           | `number`              |
| `responseTimeInMs`   | Svarstiden i millisekunder.                                                                                                  | `number`              |

#### Exempel

Följande exempel visar hur du använder ett JavaScript-uttryck för att övervaka en webbplats för en specifik sträng i svarsinnehållet:

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

### Monitorer för inkommande förfrågningar

Följande variabler är tillgängliga i kontexten för det övervakade objektet:

| Variabel         | Beskrivning                     | Typ                   |
| ---------------- | ------------------------------- | --------------------- |
| `requestBody`    | Förfrågningsinnehållets objekt. | `string` eller `JSON` |
| `requestHeaders` | Förfrågningshuvudenas objekt.   | `Dictionary<string>`  |

#### Exempel

Följande exempel visar hur du använder ett JavaScript-uttryck för att övervaka en inkommande förfrågan för en specifik sträng i förfrågningsinnehållet:

```javascript
"{{requestBody.item}}" === "hello";

// or you can use request headers

"{{requestHeaders.contentType}}" === "text/html";

// you can also use regular expressions

"{{requestBody.item}}".match(/hello/);

// you can combine multiple expressions using logical operators

"{{requestBody.item}}" === "hello" &&
  "{{requestHeaders.contentType}}" === "text/html";

// you can use the following for arrays

"{{requestBody.items[0].name}}" === "hello";
```

### Saker att tänka på

- Skript har en timeout på 1 sekund; de returnerar `false` om skriptet tar längre tid än 1 sekund att exekvera.
- `{{var}}` ersätter variabeln med värdet, så om du vill jämföra en sträng måste du omsluta den med citattecken, t.ex. `"{{responseBody.item}}" === "hello"` och om du vill jämföra ett tal behöver du inte omsluta det med citattecken, t.ex. `{{responseStatusCode}} === 200`
