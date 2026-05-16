# Monitoring Criteria: JavaScript Expression

You can use JavaScript expressions to create custom monitoring criteria. The expression is evaluated in the context of the monitored object. The expression must return a boolean value. If the expression returns `true`, the monitoring criteria is met. If the expression returns `false`, the monitoring criteria is not met.

JavaScript expression as monitoring criteria is available for the following monitoring types: API, Website, and Incoming Request. 

### Website and API monitors

The following variables are available in the context of the monitored object:

| Variable | Description | Type |
| --- | --- | --- |
| `responseBody` | The response body object. If the response body is in HTML / XML this will be of type sting. If response body is in JSON then this will be in JSON | `string` or `JSON` |
| `responseHeaders` | The response headers object. | `Dictionary<string>` |
| `responseStatusCode` | The response status code. | `number` |
| `responseTimeInMs` | The response time in milliseconds. | `number` |

#### Example

The following example shows how to use a JavaScript expression to monitor a website for a specific string in the response body:

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

### Incoming Request monitors

The following variables are available in the context of the monitored object:

| Variable | Description | Type |
| --- | --- | --- |
| `requestBody` | The request body object. | `string` or `JSON` |
| `requestHeaders` | The request headers object. | `Dictionary<string>` |


#### Example

The following example shows how to use a JavaScript expression to monitor an incoming request for a specific string in the request body:

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

### Things to consider

* scripts have a timeout of 1 second, it will return `false` if the script takes longer than 1 second to execute. 
* `{{var}}` will replace the variable with the value, so if you want to compare a string, you need to wrap it in quotes, e.g. `"{{responseBody.item}}" === "hello"` and if you want to compare a number, you don't need to wrap it in quotes, e.g. `{{responseStatusCode}} === 200`