# Overvåkingskriterier: JavaScript-uttrykk

Du kan bruke JavaScript-uttrykk til å opprette egendefinerte overvåkingskriterier. Uttrykket evalueres i konteksten til det overvåkede objektet. Uttrykket må returnere en boolsk verdi. Hvis uttrykket returnerer `true`, er overvåkingskriteriet oppfylt. Hvis uttrykket returnerer `false`, er overvåkingskriteriet ikke oppfylt.

JavaScript-uttrykk som overvåkingskriterium er tilgjengelig for følgende overvåkingstyper: API, nettsted og innkommende forespørsel.

### Nettsted- og API-monitorer

Følgende variabler er tilgjengelige i konteksten til det overvåkede objektet:

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `responseBody` | Svarlegemsobjektet. Hvis svarkroppen er i HTML/XML, vil dette være av typen streng. Hvis svarkroppen er i JSON, vil dette være i JSON. | `string` eller `JSON` |
| `responseHeaders` | Svarhodeobjektet. | `Dictionary<string>` |
| `responseStatusCode` | Svarstatuskoden. | `number` |
| `responseTimeInMs` | Svartiden i millisekunder. | `number` |

#### Eksempel

Følgende eksempel viser hvordan du bruker et JavaScript-uttrykk til å overvåke et nettsted for en spesifikk streng i svarkroppen:

```javascript

/**
 *  
 * Hvis svarkroppen er i JSON, vil responseBody være et JSON-objekt
 * {
 *    "item": "hello"
 * }
 * 
 *  **/

"{{responseBody.item}}" === "hello"

// eller du kan bruke svarhoder

"{{responseHeaders.contentType}} === "application/json"


// du kan også bruke regulære uttrykk

"{{responseBody.item}}".match(/hello/)

// du kan også bruke svarstatuskoden

{{responseStatusCode}} === 200

// du kan kombinere flere uttrykk ved hjelp av logiske operatorer

"{{responseBody.item}}" === "hello" && {{responseStatusCode}} === 200

// for arrays kan du bruke følgende

/**
 *  
 * Hvis svarkroppen er: 
 * {
 *    "item": [{
 *          "name": "hello"
 *      }]
 * }
 * 
 *  **/

"{{responseBody.items[0].name}}" === "hello"
```

### Innkommende forespørselsmonitorer

Følgende variabler er tilgjengelige i konteksten til det overvåkede objektet:

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `requestBody` | Forespørselslegemsobjektet. | `string` eller `JSON` |
| `requestHeaders` | Forespørselshodeobjektet. | `Dictionary<string>` |


#### Eksempel

Følgende eksempel viser hvordan du bruker et JavaScript-uttrykk til å overvåke en innkommende forespørsel for en spesifikk streng i forespørselskroppen:

```javascript
"{{requestBody.item}}" === "hello"

// eller du kan bruke forespørselshoder

"{{requestHeaders.contentType}}" === "text/html"

// du kan også bruke regulære uttrykk

"{{requestBody.item}}".match(/hello/)

// du kan kombinere flere uttrykk ved hjelp av logiske operatorer

"{{requestBody.item}}" === "hello" && "{{requestHeaders.contentType}}" === "text/html"

// du kan bruke følgende for arrays

"{{requestBody.items[0].name}}" === "hello"
```

### Ting å vurdere

* Skript har et tidsavbrudd på 1 sekund; det vil returnere `false` hvis skriptet tar lengre enn 1 sekund å kjøre.
* `{{var}}` erstatter variabelen med verdien, så hvis du vil sammenligne en streng, må du pakke den inn i anførselstegn, f.eks. `"{{responseBody.item}}" === "hello"`, og hvis du vil sammenligne et tall, trenger du ikke pakke det inn i anførselstegn, f.eks. `{{responseStatusCode}} === 200`
