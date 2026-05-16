# Synthetischer Monitor

Der Synthetische Monitor ist eine Methode zur proaktiven Überwachung Ihrer Anwendungen durch Simulation von Benutzerinteraktionen. Sie können einen synthetischen Monitor erstellen, um die Verfügbarkeit und Leistung Ihrer Anwendungen von verschiedenen Standorten auf der Welt zu überprüfen.

#### Beispiel

Das folgende Beispiel zeigt, wie ein Synthetischer Monitor verwendet wird:

```javascript

// Objects available in the context of the script are:

// - axios: Axios module to make HTTP requests
// - page: Playwright Page object to interact with the browser
// - browserType: Browser type in the current run context - Chromium, Firefox, Webkit
// - screenSizeType: Screen size type in the current run context - Mobile, Tablet, Desktop

// You can use these objects to interact with the browser and make HTTP requests.

await page.goto('https://playwright.dev/');

// Playwright Documentation here: https://playwright.dev/docs/intro

// Here are some of the variables that you can use in the context of the monitored object:

console.log(browserType) // This will list the browser type in the current run context - Chromium, Firefox, Webkit

console.log(screenSizeType) // This will list the screen size type in the current run context - Mobile, Tablet, Desktop

// Playwright page object belongs to that specific browser context, so you can use it to interact with the browser.

// To take screenshots, assign them to the `screenshots` object that is provided
// in the script context. Screenshots captured this way are preserved even if the
// script later throws — useful for debugging failed runs.

screenshots['screenshot-name'] = await page.screenshot(); // you can save multiple screenshots and have them with different names.

// when you want to return a value, use return statement with data as a prop.

// To log data, use console.log
// console.log('Hello World');

// You can access the browser context via page.context() if needed (for example, to create a new page or dealing with popups).


return {
    data: 'Hello World'
};
```

### Verwendung von Playwright

Wir verwenden Playwright zur Simulation von Benutzerinteraktionen. Sie können das Playwright-`page`-Objekt verwenden, um mit dem Browser zu interagieren und Aktionen wie das Klicken von Schaltflächen, das Ausfüllen von Formularen und das Aufnehmen von Screenshots durchzuführen.

### Screenshots

Ein vorab deklariertes `screenshots`-Objekt ist im Skript-Kontext verfügbar. Weisen Sie ihm Screenshots an einem beliebigen Punkt im Skript zu — diese Screenshots werden **auch dann erfasst, wenn das Skript eine Ausnahme auslöst** (einschließlich Assertion-Fehler, Timeouts oder unerwartete Fehler), sodass Sie genau sehen können, wie die Seite beim Fehlschlagen des Laufs aussah.

```javascript

// Capture screenshots via the `screenshots` side-channel — they are preserved on both success and failure.

await page.goto('https://app.example.com/login');
screenshots['login-page'] = await page.screenshot();

await page.fill('#email', 'user@example.com');
await page.fill('#password', 'wrong');
await page.click('button[type=submit]');

// If the next assertion throws, the `login-page` screenshot above is still captured.
await page.waitForSelector('.dashboard', { timeout: 5000 });

screenshots['dashboard'] = await page.screenshot();

return {
    data: 'Login succeeded'
};

```

### Monitor-Geheimnisse verwenden

Um Monitor-Geheimnisse im Skript zu verwenden, können Sie das `monitorSecrets`-Objekt im Kontext des Skripts nutzen.

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

### Benutzerdefinierte Metriken

Sie können benutzerdefinierte Metriken aus Ihrem Skript mit der Funktion `oneuptime.captureMetric()` erfassen.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

### Im Skript verfügbare Module
- `page`: Sie können dieses Modul verwenden, um mit dem Browser zu interagieren. Es ist ein Playwright-Page-Objekt.
- `screenshots`: Ein vorab deklariertes Objekt, dem Sie Screenshots zuweisen.
- `axios`: Sie können dieses Modul verwenden, um HTTP-Anfragen zu stellen.
- `crypto`: Für kryptographische Operationen.
- `console.log`: Für Debugging-Zwecke.
- `oneuptime.captureMetric`: Zum Erfassen benutzerdefinierter Metriken.
- `http`: Für HTTP-Anfragen.
- `https`: Für HTTPS-Anfragen.

### Zu beachtende Punkte

- Das `page`-Objekt ist die primäre Schnittstelle zur Browserinteraktion.
- Sie können `console.log` verwenden, um Daten zu protokollieren.
- Sie können Daten mit der `return`-Anweisung zurückgeben.
- Sie können `browserType` und `screenSizeType` verwenden, um den Browser-Typ und die Bildschirmgröße zu erhalten.
- Das Timeout für das Skript beträgt 2 Minuten.
