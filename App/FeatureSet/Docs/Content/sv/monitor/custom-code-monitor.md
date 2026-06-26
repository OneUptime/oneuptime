# Anpassad kodmonitor

Anpassad kodmonitor gör det möjligt att skriva anpassade skript för att övervaka dina applikationer. Du kan använda den här funktionen för att övervaka dina applikationer på ett sätt som inte är möjligt med befintliga monitorer. Till exempel kan du ha flerstegade API-förfrågningar.

#### Exempel

Följande exempel visar hur du använder en anpassad kodmonitor:

```javascript
// You can use axios module.

await axios.get("https://api.example.com/");

// Axios Documentation here: https://axios-http.com/docs/intro

return {
  data: "Hello World", // return any data you like here.
};
```

### Använda monitorhemligheter

#### Lägga till en hemlighet

För att lägga till en hemlighet, gå till OneUptime-instrumentpanelen -> Projektinställningar -> Monitorhemligheter -> Skapa monitorhemlighet.

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

Du kan välja vilka monitorer som har åtkomst till hemligheten. I det här fallet lade vi till `ApiKey`-hemligheten och valde monitorer som ska ha åtkomst till den.

**Observera**: Hemligheter krypteras och lagras säkert. Om du tappar bort hemligheten måste du skapa en ny. Du kan inte visa eller uppdatera hemligheten efter att den har sparats.

#### Använda en hemlighet

För att använda monitorhemligheter i skriptet kan du använda `monitorSecrets`-objektet i skriptets kontext. Du kan använda det för att komma åt de hemligheter du har lagt till i monitorn.

```javascript
// if your secret is of type string then you need to wrap it in quotes
let stringSecret = '{{monitorSecrets.StringSecret}}';

// if your secret is of type number or boolean then you can use it directly
let numberSecret = {{monitorSecrets.NumberSecret}};

// if your secret is of type boolean then you can use it directly
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// you can even console log to see if the secrets is being fetched correctly
console.log(stringSecret);
```

### Anpassade mätvärden

Du kan registrera anpassade mätvärden från ditt skript med funktionen `oneuptime.captureMetric()`. Dessa mätvärden lagras i OneUptime och kan visas i diagram på instrumentpaneler med hjälp av Metric Explorer.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (sträng, obligatorisk): Mätvärdets namn (t.ex. `"api.response.time"`). Det lagras automatiskt med prefixet `custom.monitor.`.
- `value` (nummer, obligatorisk): Det numeriska mätvärdet.
- `attributes` (objekt, valfritt): Nyckel-värdepar för ytterligare kontext.

#### Exempel

```javascript
const response = await axios.get("https://api.example.com/health");

// Capture a simple metric
oneuptime.captureMetric("api.response.time", response.data.latency);

// Capture a metric with attributes
oneuptime.captureMetric("api.queue.depth", response.data.queueDepth, {
  region: "us-east-1",
  environment: "production",
});

return {
  data: response.data,
};
```

När de väl har registrerats visas dessa mätvärden i Metric Explorer under namn som `custom.monitor.api.response.time`. Du kan lägga till dem i instrumentpaneldiagram, konfigurera varningar och filtrera efter monitor, sond eller anpassade attribut du angett.

**Gränser:**

- Maximalt 100 mätvärden per skriptkörning.
- Måttnamn är begränsade till 200 tecken.
- Värden måste vara numeriska.

### Moduler tillgängliga i skriptet

- `axios`: Du kan använda den här modulen för att göra HTTP-förfrågningar. Det är en promise-baserad HTTP-klient för webbläsaren och Node.js.
- `crypto`: Du kan använda den här modulen för kryptografiska operationer. Det är en inbyggd Node.js-modul som tillhandahåller kryptografisk funktionalitet.
- `console.log`: Du kan använda den här modulen för att logga data till konsolen. Detta är användbart för felsökning.
- `oneuptime.captureMetric`: Du kan använda detta för att registrera anpassade mätvärden från ditt skript. Se avsnittet Anpassade mätvärden ovan.
- `http`: Du kan använda den här modulen för att göra HTTP-förfrågningar. Det är en inbyggd Node.js-modul som tillhandahåller en HTTP-klient och server.
- `https`: Du kan använda den här modulen för att göra HTTPS-förfrågningar. Det är en inbyggd Node.js-modul som tillhandahåller en HTTPS-klient och server.

### Saker att tänka på

- Du kan använda `console.log` för att logga data i konsolen. Detta är tillgängligt i loggavsnittet för monitorn (Sonder > Visa loggar).
- Du kan returnera data från skriptet med `return`-uttrycket.
- Detta är ett JavaScript-skript, så du kan använda alla JavaScript-funktioner i skriptet.
- Timeout för skriptet är 2 minuter. Om skriptet tar mer än 2 minuter avslutas det.
