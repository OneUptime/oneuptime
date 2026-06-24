# Syntetisk monitor

Syntetisk overvågning er en måde at proaktivt overvåge dine applikationer på ved at simulere brugerinteraktioner. Du kan oprette en syntetisk monitor til at kontrollere tilgængelighed og ydeevne af dine applikationer fra forskellige steder rundt om i verden.

#### Eksempel

Følgende eksempel viser, hvordan man bruger en Syntetisk Monitor:

```javascript
// Objekter tilgængelige i scriptets kontekst er:

// - axios: Axios-modul til at sende HTTP-anmodninger
// - page: Playwright Page-objekt til at interagere med browseren
// - browserType: Browser-type i den aktuelle kørselskontekst - Chromium, Firefox, Webkit
// - screenSizeType: Skærmstørrelsestype i den aktuelle kørselskontekst - Mobile, Tablet, Desktop

// Du kan bruge disse objekter til at interagere med browseren og sende HTTP-anmodninger.

await page.goto("https://playwright.dev/");

// Playwright-dokumentation her: https://playwright.dev/docs/intro

// Her er nogle af de variabler, du kan bruge i konteksten af det overvågede objekt:

console.log(browserType); // Dette viser browser-typen i den aktuelle kørselskontekst - Chromium, Firefox, Webkit

console.log(screenSizeType); // Dette viser skærmstørrelsestypen i den aktuelle kørselskontekst - Mobile, Tablet, Desktop

// Playwright page-objektet tilhører den specifikke browser-kontekst, så du kan bruge det til at interagere med browseren.

// For at tage skærmbilleder skal du tildele dem til `screenshots`-objektet, der er leveret
// i scriptkonteksten. Skærmbilleder taget på denne måde bevares, selv hvis
// scriptet kaster en fejl — nyttigt til fejlfinding af mislykkede kørsler.

screenshots["screenshot-name"] = await page.screenshot(); // du kan gemme flere skærmbilleder med forskellige navne.

// når du vil returnere en værdi, skal du bruge return-sætningen med data som en egenskab.

// For at logge data skal du bruge console.log
// console.log('Hello World');

// Du kan få adgang til browser-konteksten via page.context(), hvis det er nødvendigt (f.eks. til at oprette en ny side eller håndtere popups).

return {
  data: "Hello World",
};
```

### Brug af Playwright

Vi bruger Playwright til at simulere brugerinteraktioner. Du kan bruge Playwright `page`-objektet til at interagere med browseren og udføre handlinger som at klikke på knapper, udfylde formularer og tage skærmbilleder.

### Skærmbilleder

Et foruddeklareret `screenshots`-objekt er tilgængeligt i scriptkonteksten. Tildel skærmbilleder til det på ethvert tidspunkt i scriptet – disse skærmbilleder optages **selv hvis scriptet kaster en fejl** (inklusive assertion-fejl, timeouts eller uventede fejl), så du kan se præcis, hvad siden lignede, da kørslen mislykkedes. Optagede skærmbilleder vises i OneUptime-dashboardet for den specifikke monitorkørsel.

```javascript
// Optag skærmbilleder via `screenshots` sidekanalen — de bevares ved både succes og fejl.

await page.goto("https://app.example.com/login");
screenshots["login-page"] = await page.screenshot();

await page.fill("#email", "user@example.com");
await page.fill("#password", "wrong");
await page.click("button[type=submit]");

// Hvis den næste assertion kaster, optages `login-page`-skærmbilledet ovenfor stadig.
await page.waitForSelector(".dashboard", { timeout: 5000 });

screenshots["dashboard"] = await page.screenshot();

return {
  data: "Login succeeded",
};
```

#### Returnering af skærmbilleder (legacy)

Af hensyn til bagudkompatibilitet kan du også returnere skærmbilleder fra scriptet som en del af returværdien. Skærmbilleder returneret på denne måde optages **kun**, når scriptet fuldfører normalt – de mistes, hvis scriptet kaster en fejl. Brug sidekanal-mønsteret ovenfor, når du vil have bevis for fejl.

```javascript
// Legacy-mønster — skærmbilleder optages kun ved vellykket retur.
const screenshots = {};
screenshots["screenshot-name"] = await page.screenshot();

return {
  data: "Hello World",
  screenshots: screenshots,
};
```

### Brug af Monitor Secrets

#### Tilføjelse af en hemmelighed

For at tilføje en hemmelighed skal du gå til OneUptime Dashboard -> Projektindstillinger -> Monitor Secrets -> Opret Monitor Secret.

![Opret hemmelighed](/docs/static/images/CreateMonitorSecret.png)

Du kan vælge, hvilke monitorer der har adgang til hemmeligheden. I dette tilfælde har vi tilføjet `ApiKey`-hemmelighed og valgt monitorer til at have adgang til den.

**Bemærk venligst**: Hemmeligheder er krypteret og opbevares sikkert. Hvis du mister hemmeligheden, skal du oprette en ny hemmelighed. Du kan ikke se eller opdatere hemmeligheden, efter den er gemt.

#### Brug af en hemmelighed

For at bruge Monitor Secrets i scriptet kan du bruge `monitorSecrets`-objektet i scriptets kontekst. Du kan bruge det til at få adgang til de hemmeligheder, du har tilføjet til monitoren.

```javascript
// hvis din hemmelighed er af typen streng, skal du pakke den ind i anførselstegn
let stringSecret = '{{monitorSecrets.StringSecret}}';

// hvis din hemmelighed er af typen tal eller boolean, kan du bruge den direkte
let numberSecret = {{monitorSecrets.NumberSecret}};

// hvis din hemmelighed er af typen boolean, kan du bruge den direkte
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// du kan endda bruge console.log til at se, om hemmeligheden hentes korrekt
console.log(stringSecret);
```

### Brugerdefinerede metrikker

Du kan optage brugerdefinerede metrikker fra dit script ved hjælp af funktionen `oneuptime.captureMetric()`. Disse metrikker gemmes i OneUptime og kan vises på dashboards ved hjælp af Metrisk Stifinder.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (streng, påkrævet): Metrikkens navn (f.eks. `"dashboard.load.time"`). Det gemmes automatisk med præfikset `custom.monitor.`.
- `value` (tal, påkrævet): Den numeriske metrikværdi.
- `attributes` (objekt, valgfrit): Nøgle-værdi-par til yderligere kontekst.

#### Eksempel

```javascript
await page.goto("https://app.example.com");

const startTime = Date.now();
await page.waitForSelector("#dashboard-loaded");
const loadTime = Date.now() - startTime;

// Optag indlæsningstid for siden som en brugerdefineret metrik
oneuptime.captureMetric("dashboard.load.time", loadTime, {
  page: "dashboard",
});

screenshots["dashboard"] = await page.screenshot();

return {
  data: { loadTime },
};
```

Når de er optaget, vises disse metrikker i Metrisk Stifinder under navne som `custom.monitor.dashboard.load.time`. Du kan tilføje dem til dashboard-diagrammer, opsætte advarsler og filtrere efter monitor, probe, browser-type, skærmstørrelse eller eventuelle brugerdefinerede attributter, du har angivet.

**Grænser:**

- Maks. 100 metrikker pr. scriptudførelse.
- Metriknavne er begrænset til 200 tegn.
- Værdier skal være numeriske.

### Tilgængelige moduler i scriptet

- `page`: Du kan bruge dette modul til at interagere med browseren. Det er et Playwright Page-objekt, der giver dig mulighed for at udføre handlinger som at klikke på knapper, udfylde formularer og tage skærmbilleder. Du kan få adgang til browser-konteksten via `page.context()`, hvis det er nødvendigt (f.eks. til at oprette en ny side eller håndtere popups).
- `screenshots`: Et foruddeklareret objekt, som du tildeler skærmbilleder til (f.eks. `screenshots['login-page'] = await page.screenshot()`). Skærmbilleder tildelt her optages, selv hvis scriptet kaster en fejl.
- `axios`: Du kan bruge dette modul til at sende HTTP-anmodninger. Det er en promise-baseret HTTP-klient til browsere og Node.js.
- `crypto`: Du kan bruge dette modul til at udføre kryptografiske operationer. Det er et indbygget Node.js-modul, der leverer kryptografisk funktionalitet, herunder et sæt wrappers til OpenSSL's hash-, HMAC-, cipher-, decipher-, sign- og verify-funktioner.
- `console.log`: Du kan bruge dette modul til at logge data til konsollen. Dette er nyttigt til fejlfindingsformål.
- `oneuptime.captureMetric`: Du kan bruge dette til at optage brugerdefinerede metrikker fra dit script. Se afsnittet Brugerdefinerede metrikker ovenfor.
- `http`: Du kan bruge dette modul til at sende HTTP-anmodninger. Det er et indbygget Node.js-modul, der leverer en HTTP-klient og -server.
- `https`: Du kan bruge dette modul til at sende HTTPS-anmodninger. Det er et indbygget Node.js-modul, der leverer en HTTPS-klient og -server.

### Ting at overveje

- `page`-objektet er den primære grænseflade til at interagere med browseren. Dette er fra Playwright Page-klassen. Du kan få adgang til browser-konteksten via `page.context()`, hvis det er nødvendigt.
- Du kan bruge `console.log` til at logge data i konsollen. Dette vil være tilgængeligt i log-afsnittet for monitoren.
- Du kan returnere data fra scriptet ved hjælp af `return`-sætningen. Tildel skærmbilleder til det medfølgende `screenshots`-objekt, så de bevares, selv hvis scriptet kaster en fejl.
- Du kan bruge variablerne `browserType` og `screenSizeType` til at få browser-typen og skærmstørrelsestypen i den aktuelle kørselskontekst. Brug dem gerne i dit script, hvis du ønsker det.
- Dette er et JavaScript-script, så du kan bruge alle JavaScript-funktioner i scriptet.
- Du kan bruge `axios`-modulet til at sende HTTP-anmodninger i scriptet. Du kan bruge det til at sende API-kald fra scriptet.
- Hvis du bruger oneuptime.com, vil du altid have den seneste version af Playwright og browsers tilgængelig i scriptets kontekst. Hvis du selvhoster, skal du sørge for, at du opdaterer proberne for at have den seneste version af Playwright og browsers.
- Timeout for scriptet er 2 minutter. Hvis scriptet tager mere end 2 minutter, afsluttes det.
