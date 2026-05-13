# Criterios de monitoreo: Expresión JavaScript

Puedes usar expresiones JavaScript para crear criterios de monitoreo personalizados. La expresión se evalúa en el contexto del objeto monitoreado. La expresión debe devolver un valor booleano. Si la expresión devuelve `true`, el criterio de monitoreo se cumple. Si devuelve `false`, el criterio no se cumple.

Las expresiones JavaScript como criterios de monitoreo están disponibles para los siguientes tipos de monitoreo: API, Sitio web y Solicitud entrante. 

### Monitores de sitios web y API

Las siguientes variables están disponibles en el contexto del objeto monitoreado:

| Variable | Descripción | Tipo |
| --- | --- | --- |
| `responseBody` | El objeto del cuerpo de la respuesta. Si el cuerpo de la respuesta está en HTML/XML, será de tipo cadena. Si está en JSON, será JSON. | `string` o `JSON` |
| `responseHeaders` | El objeto de encabezados de respuesta. | `Dictionary<string>` |
| `responseStatusCode` | El código de estado de la respuesta. | `number` |
| `responseTimeInMs` | El tiempo de respuesta en milisegundos. | `number` |

#### Ejemplo

El siguiente ejemplo muestra cómo usar una expresión JavaScript para monitorear un sitio web en busca de una cadena específica en el cuerpo de la respuesta:

```javascript

/**
 *  
 * Si el cuerpo de la respuesta está en JSON, responseBody será un objeto JSON
 * {
 *    "item": "hello"
 * }
 * 
 *  **/

"{{responseBody.item}}" === "hello"

// o puedes usar los encabezados de respuesta

"{{responseHeaders.contentType}} === "application/json"


// también puedes usar expresiones regulares

"{{responseBody.item}}".match(/hello/)

// también puedes usar el código de estado de la respuesta

{{responseStatusCode}} === 200

// puedes combinar múltiples expresiones usando operadores lógicos

"{{responseBody.item}}" === "hello" && {{responseStatusCode}} === 200

// para arreglos puedes usar lo siguiente

/**
 *  
 * Si el cuerpo de la respuesta es: 
 * {
 *    "item": [{
 *          "name": "hello"
 *      }]
 * }
 * 
 *  **/

"{{responseBody.items[0].name}}" === "hello"
```

### Monitores de solicitudes entrantes

Las siguientes variables están disponibles en el contexto del objeto monitoreado:

| Variable | Descripción | Tipo |
| --- | --- | --- |
| `requestBody` | El objeto del cuerpo de la solicitud. | `string` o `JSON` |
| `requestHeaders` | El objeto de encabezados de solicitud. | `Dictionary<string>` |


#### Ejemplo

El siguiente ejemplo muestra cómo usar una expresión JavaScript para monitorear una solicitud entrante en busca de una cadena específica en el cuerpo de la solicitud:

```javascript
"{{requestBody.item}}" === "hello"

// o puedes usar los encabezados de solicitud

"{{requestHeaders.contentType}}" === "text/html"

// también puedes usar expresiones regulares

"{{requestBody.item}}".match(/hello/)

// puedes combinar múltiples expresiones usando operadores lógicos

"{{requestBody.item}}" === "hello" && "{{requestHeaders.contentType}}" === "text/html"

// puedes usar lo siguiente para arreglos

"{{requestBody.items[0].name}}" === "hello"
```

### Aspectos a considerar

* Los scripts tienen un tiempo de espera de 1 segundo; devolverán `false` si el script tarda más de 1 segundo en ejecutarse. 
* `{{var}}` reemplazará la variable con el valor, por lo que si deseas comparar una cadena, debes envolverla entre comillas, por ejemplo, `"{{responseBody.item}}" === "hello"`, y si deseas comparar un número, no necesitas envolverlo entre comillas, por ejemplo, `{{responseStatusCode}} === 200`.
