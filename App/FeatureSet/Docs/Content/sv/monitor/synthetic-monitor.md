# Syntetisk monitor

Syntetisk övervakning är ett sätt att proaktivt övervaka dina applikationer genom att simulera användarinteraktioner. Du kan skapa en syntetisk monitor för att kontrollera tillgängligheten och prestandan hos dina applikationer från olika platser runt om i världen.

#### Exempel

Följande exempel visar hur du använder en syntetisk monitor:

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

### Användning av Playwright

Vi använder Playwright för att simulera användarinteraktioner. Du kan använda Playwright `page`-objektet för att interagera med webbläsaren och utföra åtgärder som att klicka på knappar, fylla i formulär och ta skärmdumpar.

### Skärmdumpar

Ett fördeklarerat `screenshots`-objekt är tillgängligt i skriptkontexten. Tilldela skärmdumpar till det vid valfri punkt i skriptet – dessa skärmdumpar tas **även om skriptet kastar ett undantag** (inklusive assertion-fel, timeouts eller oväntade fel), så du kan se exakt hur sidan såg ut när körningen misslyckades. Tagna skärmdumpar visas i OneUptime-instrumentpanelen för den specifika monitorkörningen.

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

#### Returnera skärmdumpar (äldre metod)

För bakåtkompatibilitet kan du också returnera skärmdumpar från skriptet som del av returvärdet. Skärmdumpar som returneras på detta sätt tas **bara** när skriptet slutförs normalt – de försvinner om skriptet kastar ett undantag. Föredra sidokanalsmetoden ovan när du vill ha bevis på misslyckanden.

```javascript
// Legacy pattern — screenshots only captured on successful return.
const screenshots = {};
screenshots["screenshot-name"] = await page.screenshot();

return {
  data: "Hello World",
  screenshots: screenshots,
};
```

### Använda monitorhemligheter

#### Lägga till en hemlighet

För att lägga till en hemlighet, gå till OneUptime-instrumentpanelen -> Projektinställningar -> Monitorhemligheter -> Skapa monitorhemlighet.

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

Du kan välja vilka monitorer som har åtkomst till hemligheten.

**Observera**: Hemligheter krypteras och lagras säkert. Om du tappar bort hemligheten måste du skapa en ny. Du kan inte visa eller uppdatera hemligheten efter att den har sparats.

#### Använda en hemlighet

För att använda monitorhemligheter i skriptet kan du använda `monitorSecrets`-objektet i skriptets kontext.

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

- `name` (sträng, obligatorisk): Mätvärdets namn (t.ex. `"dashboard.load.time"`). Det lagras automatiskt med prefixet `custom.monitor.`.
- `value` (nummer, obligatorisk): Det numeriska mätvärdet.
- `attributes` (objekt, valfritt): Nyckel-värdepar för ytterligare kontext.

#### Exempel

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

**Gränser:**

- Maximalt 100 mätvärden per skriptkörning.
- Måttnamn är begränsade till 200 tecken.
- Värden måste vara numeriska.

### Moduler tillgängliga i skriptet

- `page`: Du kan använda den här modulen för att interagera med webbläsaren. Det är ett Playwright Page-objekt som gör det möjligt att utföra åtgärder som att klicka på knappar, fylla i formulär och ta skärmdumpar.
- `screenshots`: Ett fördeklarerat objekt som du tilldelar skärmdumpar till. Skärmdumpar som tilldelas här bevaras även om skriptet kastar ett undantag.
- `axios`: Du kan använda den här modulen för att göra HTTP-förfrågningar. Det är en promise-baserad HTTP-klient för webbläsaren och Node.js.
- `crypto`: Du kan använda den här modulen för kryptografiska operationer.
- `console.log`: Du kan använda den här modulen för att logga data till konsolen.
- `oneuptime.captureMetric`: Du kan använda detta för att registrera anpassade mätvärden från ditt skript.
- `http`: Du kan använda den här modulen för att göra HTTP-förfrågningar.
- `https`: Du kan använda den här modulen för att göra HTTPS-förfrågningar.

### Saker att tänka på

- `page`-objektet är det primära gränssnittet för att interagera med webbläsaren. Detta är från Playwright Page-klassen.
- Du kan använda `console.log` för att logga data i konsolen. Detta är tillgängligt i loggavsnittet för monitorn.
- Du kan returnera data från skriptet med `return`-uttrycket. Tilldela skärmdumpar till det tillhandahållna `screenshots`-objektet så att de bevaras även om skriptet kastar ett undantag.
- Du kan använda variablerna `browserType` och `screenSizeType` för att få webbläsartyp och skärmstorlek i den aktuella körningskontexten.
- Detta är ett JavaScript-skript, så du kan använda alla JavaScript-funktioner i skriptet.
- Om du använder oneuptime.com har du alltid den senaste versionen av Playwright och webbläsare tillgängliga i skriptets kontext. Om du egeninstallerar, se till att du uppdaterar sonderna för att ha den senaste versionen av Playwright och webbläsarna.
- Timeout för skriptet är 2 minuter. Om skriptet tar mer än 2 minuter avslutas det.
