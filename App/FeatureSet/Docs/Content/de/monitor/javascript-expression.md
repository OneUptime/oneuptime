# Überwachungskriterien: JavaScript-Ausdruck

Sie können JavaScript-Ausdrücke verwenden, um benutzerdefinierte Überwachungskriterien zu erstellen. Der Ausdruck wird im Kontext des überwachten Objekts ausgewertet. Der Ausdruck muss einen booleschen Wert zurückgeben. Wenn der Ausdruck `true` zurückgibt, ist das Überwachungskriterium erfüllt. Wenn der Ausdruck `false` zurückgibt, ist das Überwachungskriterium nicht erfüllt.

JavaScript-Ausdrücke als Überwachungskriterien sind für die folgenden Überwachungstypen verfügbar: API, Website und Eingehende Anfrage.

### Website- und API-Monitore

Die folgenden Variablen sind im Kontext des überwachten Objekts verfügbar:

| Variable             | Beschreibung                                                                                                                             | Typ                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `responseBody`       | Das Antworttextobjekt. Wenn der Antworttext in HTML/XML ist, ist dies eine Zeichenkette. Wenn der Antworttext in JSON ist, ist dies JSON | `string` oder `JSON` |
| `responseHeaders`    | Das Antwort-Header-Objekt.                                                                                                               | `Dictionary<string>` |
| `responseStatusCode` | Der Antwortstatuscode.                                                                                                                   | `number`             |
| `responseTimeInMs`   | Die Antwortzeit in Millisekunden.                                                                                                        | `number`             |

#### Beispiel

Das folgende Beispiel zeigt, wie ein JavaScript-Ausdruck verwendet wird, um eine Website auf eine bestimmte Zeichenkette im Antworttext zu überwachen:

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

### Eingehende Anfrage-Monitore

Die folgenden Variablen sind im Kontext des überwachten Objekts verfügbar:

| Variable         | Beschreibung               | Typ                  |
| ---------------- | -------------------------- | -------------------- |
| `requestBody`    | Das Anfragetextobjekt.     | `string` oder `JSON` |
| `requestHeaders` | Das Anfrage-Header-Objekt. | `Dictionary<string>` |

#### Beispiel

Das folgende Beispiel zeigt, wie ein JavaScript-Ausdruck verwendet wird, um eine eingehende Anfrage auf eine bestimmte Zeichenkette im Anfragetext zu überwachen:

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

### Zu beachtende Punkte

- Skripte haben ein Timeout von 1 Sekunde; sie geben `false` zurück, wenn das Skript länger als 1 Sekunde zur Ausführung benötigt.
- `{{var}}` ersetzt die Variable durch den Wert; wenn Sie also eine Zeichenkette vergleichen möchten, müssen Sie sie in Anführungszeichen einschließen, z. B. `"{{responseBody.item}}" === "hello"`, und wenn Sie eine Zahl vergleichen möchten, brauchen Sie keine Anführungszeichen, z. B. `{{responseStatusCode}} === 200`
