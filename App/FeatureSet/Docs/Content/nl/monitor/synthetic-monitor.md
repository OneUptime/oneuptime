# Synthetische Monitor

Synthetische monitoring is een manier om uw applicaties proactief te bewaken door gebruikersinteracties te simuleren. U kunt een synthetische monitor aanmaken om de beschikbaarheid en prestaties van uw applicaties te controleren vanuit verschillende locaties over de hele wereld.

#### Voorbeeld

Het volgende voorbeeld toont hoe u een Synthetische Monitor gebruikt:

```javascript
// Objects available in the context of the script are:

// - axios: Axios module to make HTTP requests
// - page: Playwright Page object to interact with the browser
// - browserType: Browser type in the current run context - Chromium, Firefox, Webkit
// - screenSizeType: Screen size type in the current run context - Mobile, Tablet, Desktop

// You can use these objects to interact with the browser and make HTTP requests.

await page.goto("https://playwright.dev/");

// Playwright Documentation here: https://playwright.dev/docs/intro

// Here are some of the variables that you can use in the context of the monitored object:

console.log(browserType); // This will list the browser type in the current run context - Chromium, Firefox, Webkit

console.log(screenSizeType); // This will list the screen size type in the current run context - Mobile, Tablet, Desktop

// Playwright page object belongs to that specific browser context, so you can use it to interact with the browser.

// To take screenshots, assign them to the `screenshots` object that is provided
// in the script context. Screenshots captured this way are preserved even if the
// script later throws — useful for debugging failed runs.

screenshots["screenshot-name"] = await page.screenshot(); // you can save multiple screenshots and have them with different names.

// when you want to return a value, use return statement with data as a prop.

// To log data, use console.log
// console.log('Hello World');

// You can access the browser context via page.context() if needed (for example, to create a new page or dealing with popups).

return {
  data: "Hello World",
};
```

### Gebruik van Playwright

We gebruiken Playwright om gebruikersinteracties te simuleren. U kunt het Playwright `page`-object gebruiken om met de browser te communiceren en acties uit te voeren zoals op knoppen klikken, formulieren invullen en schermafbeeldingen maken.

### Schermafbeeldingen

Een vooraf gedeclareerd `screenshots`-object is beschikbaar in de scriptcontext. Wijs schermafbeeldingen eraan toe op elk punt in het script — deze schermafbeeldingen worden vastgelegd **zelfs als het script een uitzondering genereert** (inclusief bevestigingsfouten, time-outs of onverwachte fouten), zodat u precies kunt zien hoe de pagina eruitzag toen de uitvoering mislukte. Vastgelegde schermafbeeldingen verschijnen in het OneUptime-dashboard voor die specifieke monitoruitvoering.

```javascript
// Capture screenshots via the `screenshots` side-channel — they are preserved on both success and failure.

await page.goto("https://app.example.com/login");
screenshots["login-page"] = await page.screenshot();

await page.fill("#email", "user@example.com");
await page.fill("#password", "wrong");
await page.click("button[type=submit]");

// If the next assertion throws, the `login-page` screenshot above is still captured.
await page.waitForSelector(".dashboard", { timeout: 5000 });

screenshots["dashboard"] = await page.screenshot();

return {
  data: "Login succeeded",
};
```

#### Schermafbeeldingen retourneren (verouderd)

Voor achterwaartse compatibiliteit kunt u ook schermafbeeldingen retourneren vanuit het script als onderdeel van de retourwaarde. Op deze manier geretourneerde schermafbeeldingen worden **alleen** vastgelegd wanneer het script normaal voltooit — ze gaan verloren als het script een uitzondering genereert. Geef de voorkeur aan het bovenstaande side-channel patroon wanneer u bewijs van mislukkingen wilt.

```javascript
// Legacy pattern — screenshots only captured on successful return.
const screenshots = {};
screenshots["screenshot-name"] = await page.screenshot();

return {
  data: "Hello World",
  screenshots: screenshots,
};
```

### Monitor Secrets gebruiken

#### Een secret toevoegen

Om een secret toe te voegen, ga naar OneUptime Dashboard -> Projectinstellingen -> Monitor Secrets -> Monitor Secret aanmaken.

![Secret aanmaken](/docs/static/images/CreateMonitorSecret.png)

U kunt selecteren welke monitors toegang hebben tot het secret. In dit geval hebben we het secret `ApiKey` toegevoegd en monitors geselecteerd die er toegang toe hebben.

**Let op**: Secrets worden versleuteld en veilig opgeslagen. Als u het secret verliest, moet u een nieuw secret aanmaken. U kunt het secret na opslaan niet bekijken of bijwerken.

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

- `name` (string, vereist): De metrieknaam (bijv. `"dashboard.load.time"`). Deze wordt automatisch opgeslagen met het voorvoegsel `custom.monitor.`.
- `value` (number, vereist): De numerieke metriekwaarde.
- `attributes` (object, optioneel): Sleutel-waardeparen voor aanvullende context.

#### Voorbeeld

```javascript
await page.goto("https://app.example.com");

const startTime = Date.now();
await page.waitForSelector("#dashboard-loaded");
const loadTime = Date.now() - startTime;

// Capture page load time as a custom metric
oneuptime.captureMetric("dashboard.load.time", loadTime, {
  page: "dashboard",
});

screenshots["dashboard"] = await page.screenshot();

return {
  data: { loadTime },
};
```

Na vastlegging verschijnen deze metrics in de Metric Explorer onder namen zoals `custom.monitor.dashboard.load.time`. U kunt ze toevoegen aan dashboardgrafieken, meldingen instellen en filteren op monitor, probe, browsertype, schermformaat of eventuele aangepaste attributen.

**Limieten:**

- Maximaal 100 metrics per scriptuitvoering.
- Metrieknamen zijn beperkt tot 200 tekens.
- Waarden moeten numeriek zijn.

### Beschikbare modules in het script

- `page`: U kunt deze module gebruiken om met de browser te communiceren. Het is een Playwright Page-object waarmee u acties kunt uitvoeren zoals op knoppen klikken, formulieren invullen en schermafbeeldingen maken. U kunt de browsercontext openen via `page.context()` indien nodig (bijv. om een nieuwe pagina aan te maken of popups te verwerken).
- `screenshots`: Een vooraf gedeclareerd object waaraan u schermafbeeldingen toewijst (bijv. `screenshots['login-page'] = await page.screenshot()`). Schermafbeeldingen die hier worden toegewezen, worden vastgelegd zelfs als het script later een uitzondering genereert.
- `axios`: U kunt deze module gebruiken om HTTP-verzoeken te doen. Het is een op beloften gebaseerde HTTP-client voor de browser en Node.js.
- `crypto`: U kunt deze module gebruiken voor cryptografische bewerkingen. Het is een ingebouwde Node.js-module die cryptografische functionaliteit biedt.
- `console.log`: U kunt deze module gebruiken om gegevens naar de console te loggen. Dit is nuttig voor foutopsporingsdoeleinden.
- `oneuptime.captureMetric`: U kunt dit gebruiken om aangepaste metrics vast te leggen vanuit uw script. Zie de sectie Aangepaste metrics hierboven.
- `http`: U kunt deze module gebruiken om HTTP-verzoeken te doen. Het is een ingebouwde Node.js-module die een HTTP-client en -server biedt.
- `https`: U kunt deze module gebruiken om HTTPS-verzoeken te doen. Het is een ingebouwde Node.js-module die een HTTPS-client en -server biedt.

### Aandachtspunten

- Het `page`-object is de primaire interface voor het communiceren met de browser. Dit is van de Playwright Page-klasse. U kunt de browsercontext openen via `page.context()` indien nodig.
- U kunt `console.log` gebruiken om gegevens naar de console te loggen. Dit is beschikbaar in de logboekenssectie van de monitor.
- U kunt gegevens retourneren vanuit het script met de `return`-instructie. Wijs schermafbeeldingen toe aan het opgegeven `screenshots`-object zodat ze worden bewaard zelfs als het script een uitzondering genereert.
- U kunt variabelen `browserType` en `screenSizeType` gebruiken om het browsertype en het schermformaattype in de huidige uitvoeringscontext te krijgen.
- Dit is een JavaScript-script, dus u kunt alle JavaScript-functies gebruiken.
- U kunt de `axios`-module gebruiken om HTTP-verzoeken te doen in het script.
- Als u oneuptime.com gebruikt, heeft u altijd de nieuwste versie van Playwright en browsers beschikbaar. Als u zelf host, zorg er dan voor dat u de probes bijwerkt zodat ze de nieuwste versie van Playwright en de browsers hebben.
- De time-out voor het script is 2 minuten. Als het script meer dan 2 minuten duurt, wordt het beëindigd.
