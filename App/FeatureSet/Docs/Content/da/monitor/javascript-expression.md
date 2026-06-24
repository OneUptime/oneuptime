# Overvågningskriterier: JavaScript-udtryk

Du kan bruge JavaScript-udtryk til at oprette brugerdefinerede overvågningskriterier. Udtrykket evalueres i konteksten af det overvågede objekt. Udtrykket skal returnere en boolsk værdi. Hvis udtrykket returnerer `true`, er overvågningskriterierne opfyldt. Hvis udtrykket returnerer `false`, er overvågningskriterierne ikke opfyldt.

JavaScript-udtryk som overvågningskriterier er tilgængelige for følgende monitortyper: API, Website og Indgående anmodning.

### Website- og API-monitorer

Følgende variabler er tilgængelige i konteksten af det overvågede objekt:

| Variabel             | Beskrivelse                                                                                                          | Type                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `responseBody`       | Svarindholdet. Hvis svarindholdet er i HTML/XML, er det af typen streng. Hvis svarindholdet er i JSON, er det i JSON | `string` eller `JSON` |
| `responseHeaders`    | Svarheader-objektet.                                                                                                 | `Dictionary<string>`  |
| `responseStatusCode` | Svarstatuskoden.                                                                                                     | `number`              |
| `responseTimeInMs`   | Svartiden i millisekunder.                                                                                           | `number`              |

#### Eksempel

Følgende eksempel viser, hvordan man bruger et JavaScript-udtryk til at overvåge et websted for en specifik streng i svarindholdet:

```javascript

/**
 *
 * Hvis svarindholdet er i JSON, vil responseBody være et JSON-objekt
 * {
 *    "item": "hello"
 * }
 *
 *  **/

"{{responseBody.item}}" === "hello"

// eller du kan bruge svarheadere

"{{responseHeaders.contentType}} === "application/json"


// du kan også bruge regulære udtryk

"{{responseBody.item}}".match(/hello/)

// du kan også bruge svarstatuskoden

{{responseStatusCode}} === 200

// du kan kombinere flere udtryk ved hjælp af logiske operatorer

"{{responseBody.item}}" === "hello" && {{responseStatusCode}} === 200

// for arrays kan du bruge følgende

/**
 *
 * Hvis svarindholdet er:
 * {
 *    "item": [{
 *          "name": "hello"
 *      }]
 * }
 *
 *  **/

"{{responseBody.items[0].name}}" === "hello"
```

### Indgående anmodningsmonitorer

Følgende variabler er tilgængelige i konteksten af det overvågede objekt:

| Variabel         | Beskrivelse                | Type                  |
| ---------------- | -------------------------- | --------------------- |
| `requestBody`    | Anmodningsindholdet.       | `string` eller `JSON` |
| `requestHeaders` | Anmodningsheader-objektet. | `Dictionary<string>`  |

#### Eksempel

Følgende eksempel viser, hvordan man bruger et JavaScript-udtryk til at overvåge en indgående anmodning for en specifik streng i anmodningsindholdet:

```javascript
"{{requestBody.item}}" === "hello";

// eller du kan bruge anmodningsheadere

"{{requestHeaders.contentType}}" === "text/html";

// du kan også bruge regulære udtryk

"{{requestBody.item}}".match(/hello/);

// du kan kombinere flere udtryk ved hjælp af logiske operatorer

"{{requestBody.item}}" === "hello" &&
  "{{requestHeaders.contentType}}" === "text/html";

// du kan bruge følgende til arrays

"{{requestBody.items[0].name}}" === "hello";
```

### Ting at overveje

- Scripts har en timeout på 1 sekund; det returnerer `false`, hvis scriptet tager længere end 1 sekund at eksekvere.
- `{{var}}` erstatter variablen med værdien, så hvis du vil sammenligne en streng, skal du pakke den ind i anførselstegn, f.eks. `"{{responseBody.item}}" === "hello"`, og hvis du vil sammenligne et tal, behøver du ikke pakke det ind i anførselstegn, f.eks. `{{responseStatusCode}} === 200`
