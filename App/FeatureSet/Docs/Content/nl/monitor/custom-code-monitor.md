# Aangepaste code-monitor

Met de Aangepaste code-monitor kunt u aangepaste scripts schrijven om uw applicaties te bewaken. U kunt deze functie gebruiken om uw applicaties te bewaken op een manier die niet mogelijk is met de bestaande monitors. U kunt bijvoorbeeld meerstaps-API-verzoeken uitvoeren.

#### Voorbeeld

Het volgende voorbeeld toont hoe u een Aangepaste code-monitor gebruikt:

```javascript
// You can use axios module.

await axios.get("https://api.example.com/");

// Axios Documentation here: https://axios-http.com/docs/intro

return {
  data: "Hello World", // return any data you like here.
};
```

### Monitor Secrets gebruiken

#### Een secret toevoegen

Om een secret toe te voegen, ga naar OneUptime Dashboard -> Projectinstellingen -> Monitor Secrets -> Monitor Secret aanmaken.

![Secret aanmaken](/docs/static/images/CreateMonitorSecret.png)

U kunt selecteren welke monitors toegang hebben tot het secret. In dit geval hebben we het secret `ApiKey` toegevoegd en monitors geselecteerd die er toegang toe hebben.

**Let op**: Secrets zijn versleuteld en veilig opgeslagen. Als u het secret verliest, moet u een nieuw secret aanmaken. U kunt het secret na opslaan niet bekijken of bijwerken.

#### Een secret gebruiken

Om Monitor Secrets in het script te gebruiken, kunt u het object `monitorSecrets` gebruiken in de context van het script. U kunt dit gebruiken om toegang te krijgen tot de secrets die u aan de monitor hebt toegevoegd.

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

### Aangepaste metrics

U kunt aangepaste metrics vastleggen vanuit uw script met de functie `oneuptime.captureMetric()`. Deze metrics worden opgeslagen in OneUptime en kunnen worden weergegeven op dashboards via de Metric Explorer.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (string, vereist): De metrieknaam (bijv. `"api.response.time"`). Deze wordt automatisch opgeslagen met het voorvoegsel `custom.monitor.`.
- `value` (number, vereist): De numerieke metriekwaarde.
- `attributes` (object, optioneel): Sleutel-waardeparen voor aanvullende context.

#### Voorbeeld

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

Na vastlegging verschijnen deze metrics in de Metric Explorer onder namen zoals `custom.monitor.api.response.time`. U kunt ze toevoegen aan dashboardgrafieken, meldingen instellen en filteren op monitor, probe of eventuele aangepaste attributen.

**Limieten:**

- Maximaal 100 metrics per scriptuitvoering.
- Metrieknamen zijn beperkt tot 200 tekens.
- Waarden moeten numeriek zijn.

### Beschikbare modules in het script

- `axios`: U kunt deze module gebruiken om HTTP-verzoeken te doen. Het is een op beloften gebaseerde HTTP-client voor de browser en Node.js.
- `crypto`: U kunt deze module gebruiken voor cryptografische bewerkingen. Het is een ingebouwde Node.js-module die cryptografische functionaliteit biedt met een set wrappers voor de hash-, HMAC-, cipher-, decipher-, sign- en verify-functies van OpenSSL.
- `console.log`: U kunt deze module gebruiken om gegevens naar de console te loggen. Dit is nuttig voor foutopsporingsdoeleinden.
- `oneuptime.captureMetric`: U kunt dit gebruiken om aangepaste metrics vast te leggen vanuit uw script. Zie de sectie Aangepaste metrics hierboven.
- `http`: U kunt deze module gebruiken om HTTP-verzoeken te doen. Het is een ingebouwde Node.js-module die een HTTP-client en -server biedt.
- `https`: U kunt deze module gebruiken om HTTPS-verzoeken te doen. Het is een ingebouwde Node.js-module die een HTTPS-client en -server biedt.

### Aandachtspunten

- U kunt `console.log` gebruiken om gegevens naar de console te loggen. Dit is beschikbaar in de logboekenssectie van de monitor (Probes > Logboeken bekijken).
- U kunt gegevens retourneren vanuit het script met de `return`-instructie.
- Dit is een JavaScript-script, dus u kunt alle JavaScript-functies gebruiken.
- De time-out voor het script is 2 minuten. Als het script meer dan 2 minuten duurt, wordt het beëindigd.
