# Syntetisk monitor

Syntetisk overvåking er en måte å proaktivt overvåke applikasjonene dine på ved å simulere brukerinteraksjoner. Du kan opprette en syntetisk monitor for å sjekke tilgjengeligheten og ytelsen til applikasjonene dine fra ulike steder rundt om i verden.

#### Eksempel

Følgende eksempel viser hvordan du bruker en syntetisk monitor:

```javascript
// Objekter tilgjengelige i skriptets kontekst er:

// - axios: Axios-modul for HTTP-forespørsler
// - page: Playwright Page-objekt for å samhandle med nettleseren
// - browserType: Nettlesertype i gjeldende kjøringskontekst - Chromium, Firefox, Webkit
// - screenSizeType: Skjermstørrelsestype i gjeldende kjøringskontekst - Mobile, Tablet, Desktop

// Du kan bruke disse objektene til å samhandle med nettleseren og sende HTTP-forespørsler.

await page.goto("https://playwright.dev/");

// Playwright-dokumentasjon her: https://playwright.dev/docs/intro

// Her er noen av variablene du kan bruke i konteksten til det overvåkede objektet:

console.log(browserType); // Dette vil liste opp nettlesertypen i gjeldende kjøringskontekst - Chromium, Firefox, Webkit

console.log(screenSizeType); // Dette vil liste opp skjermstørrelsestypen i gjeldende kjøringskontekst - Mobile, Tablet, Desktop

// Playwright-sideobjektet tilhører den spesifikke nettleserkonteksten, slik at du kan bruke det til å samhandle med nettleseren.

// For å ta skjermbilder, tildel dem til `screenshots`-objektet som er tilgjengelig
// i skriptkonteksten. Skjermbilder tatt på denne måten beholdes selv om
// skriptet senere kaster et unntak – nyttig for feilsøking av mislykkede kjøringer.

screenshots["screenshot-name"] = await page.screenshot(); // du kan lagre flere skjermbilder med forskjellige navn.

// når du ønsker å returnere en verdi, bruk return-setningen med data som egenskap.

// For å logge data, bruk console.log
// console.log('Hello World');

// Du kan få tilgang til nettleserkonteksten via page.context() hvis nødvendig (f.eks. for å opprette en ny side eller håndtere popup-vinduer).

return {
  data: "Hello World",
};
```

### Bruk av Playwright

Vi bruker Playwright til å simulere brukerinteraksjoner. Du kan bruke Playwright `page`-objektet til å samhandle med nettleseren og utføre handlinger som å klikke på knapper, fylle ut skjemaer og ta skjermbilder.

### Skjermbilder

Et forhåndsdefinert `screenshots`-objekt er tilgjengelig i skriptkonteksten. Tildel skjermbilder til det på ethvert tidspunkt i skriptet – disse skjermbildene tas **selv om skriptet kaster et unntak** (inkludert påstandsfeil, tidsavbrudd eller uventede feil), slik at du kan se nøyaktig hvordan siden så ut da kjøringen mislyktes. Tatte skjermbilder vises i OneUptime-dashbordet for den spesifikke monitorkjøringen.

```javascript
// Ta skjermbilder via `screenshots`-sidekanalens – de beholdes ved både suksess og feil.

await page.goto("https://app.example.com/login");
screenshots["login-page"] = await page.screenshot();

await page.fill("#email", "user@example.com");
await page.fill("#password", "wrong");
await page.click("button[type=submit]");

// Hvis den neste påstanden kaster et unntak, er `login-page`-skjermbildet ovenfor fortsatt tatt.
await page.waitForSelector(".dashboard", { timeout: 5000 });

screenshots["dashboard"] = await page.screenshot();

return {
  data: "Login succeeded",
};
```

#### Returnere skjermbilder (arv)

For bakoverkompatibilitet kan du også returnere skjermbilder fra skriptet som del av returverdien. Skjermbilder returnert på denne måten tas **bare** når skriptet fullføres normalt – de mistes hvis skriptet kaster et unntak. Foretrekk sidekanalmønsteret ovenfor når du ønsker bevis på feil.

```javascript
// Arvmønster – skjermbilder tas bare ved vellykket retur.
const screenshots = {};
screenshots["screenshot-name"] = await page.screenshot();

return {
  data: "Hello World",
  screenshots: screenshots,
};
```

### Bruke Monitor Secrets

#### Legge til en hemmelighet

For å legge til en hemmelighet, gå til OneUptime Dashboard -> Project Settings -> Monitor Secrets -> Create Monitor Secret.

![Opprett hemmelighet](/docs/static/images/CreateMonitorSecret.png)

Du kan velge hvilke monitorer som har tilgang til hemmeligheten. I dette tilfellet la vi til `ApiKey`-hemmeligheten og valgte monitorer som skal ha tilgang til den.

**Merk**: Hemmeligheter krypteres og lagres sikkert. Hvis du mister hemmeligheten, må du opprette en ny hemmelighet. Du kan ikke vise eller oppdatere hemmeligheten etter at den er lagret.

#### Bruke en hemmelighet

For å bruke Monitor Secrets i skriptet kan du bruke `monitorSecrets`-objektet i skriptets kontekst. Du kan bruke det for å få tilgang til hemmeligheter du har lagt til i monitoren.

```javascript
// hvis hemmeligheten din er av typen streng, må du pakke den inn i anførselstegn
let stringSecret = '{{monitorSecrets.StringSecret}}';

// hvis hemmeligheten din er av typen tall eller boolsk, kan du bruke den direkte
let numberSecret = {{monitorSecrets.NumberSecret}};

// hvis hemmeligheten din er av typen boolsk, kan du bruke den direkte
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// du kan til og med bruke console.log for å se om hemmeligheten hentes korrekt
console.log(stringSecret);
```

### Egendefinerte metrikker

Du kan fange opp egendefinerte metrikker fra skriptet ditt ved hjelp av funksjonen `oneuptime.captureMetric()`. Disse metrikkene lagres i OneUptime og kan vises som grafer på dashbord ved hjelp av Metric Explorer.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (streng, påkrevd): Metrikknavnet (f.eks. `"dashboard.load.time"`). Det lagres automatisk med prefikset `custom.monitor.`.
- `value` (tall, påkrevd): Den numeriske metrikkverdien.
- `attributes` (objekt, valgfritt): Nøkkel-verdi-par for ytterligere kontekst.

#### Eksempel

```javascript
await page.goto("https://app.example.com");

const startTime = Date.now();
await page.waitForSelector("#dashboard-loaded");
const loadTime = Date.now() - startTime;

// Fang opp lastetid for side som egendefinert metrikk
oneuptime.captureMetric("dashboard.load.time", loadTime, {
  page: "dashboard",
});

screenshots["dashboard"] = await page.screenshot();

return {
  data: { loadTime },
};
```

Når de er fanget opp, vises disse metrikkene i Metric Explorer under navn som `custom.monitor.dashboard.load.time`. Du kan legge dem til i dashbordgrafer, sette opp varsler og filtrere etter monitor, probe, nettlesertype, skjermstørrelse eller egendefinerte attributter du oppga.

**Begrensninger:**

- Maksimalt 100 metrikker per skriptkjøring.
- Metrikknavn er begrenset til 200 tegn.
- Verdier må være numeriske.

### Tilgjengelige moduler i skriptet

- `page`: Du kan bruke denne modulen til å samhandle med nettleseren. Det er et Playwright Page-objekt som lar deg utføre handlinger som å klikke på knapper, fylle ut skjemaer og ta skjermbilder. Du kan få tilgang til nettleserkonteksten via `page.context()` hvis nødvendig (f.eks. for å opprette en ny side eller håndtere popup-vinduer).
- `screenshots`: Et forhåndsdefinert objekt som du tildeler skjermbilder til (f.eks. `screenshots['login-page'] = await page.screenshot()`). Skjermbilder tildelt her beholdes selv om skriptet kaster et unntak.
- `axios`: Du kan bruke denne modulen til å sende HTTP-forespørsler. Det er en løftebasert HTTP-klient for nettleseren og Node.js.
- `crypto`: Du kan bruke denne modulen til å utføre kryptografiske operasjoner. Det er en innebygd Node.js-modul som gir kryptografisk funksjonalitet, inkludert et sett med innpakninger for OpenSSL sine hash-, HMAC-, siffer-, desiffer-, signer- og verifiserfunksjoner.
- `console.log`: Du kan bruke denne modulen til å logge data til konsollen. Dette er nyttig for feilsøkingsformål.
- `oneuptime.captureMetric`: Du kan bruke dette til å fange opp egendefinerte metrikker fra skriptet ditt. Se avsnittet om egendefinerte metrikker ovenfor.
- `http`: Du kan bruke denne modulen til å sende HTTP-forespørsler. Det er en innebygd Node.js-modul som tilbyr en HTTP-klient og -server.
- `https`: Du kan bruke denne modulen til å sende HTTPS-forespørsler. Det er en innebygd Node.js-modul som tilbyr en HTTPS-klient og -server.

### Ting å vurdere

- `page`-objektet er det primære grensesnittet for å samhandle med nettleseren. Dette er fra Playwright Page-klassen. Du kan få tilgang til nettleserkonteksten via `page.context()` hvis nødvendig.
- Du kan bruke `console.log` til å logge data i konsollen. Dette vil være tilgjengelig i loggseksjonen til monitoren.
- Du kan returnere data fra skriptet ved hjelp av `return`-setningen. Tildel skjermbilder til det medfølgende `screenshots`-objektet slik at de beholdes selv om skriptet kaster et unntak.
- Du kan bruke variablene `browserType` og `screenSizeType` for å få nettlesertypen og skjermstørrelsestypen i gjeldende kjøringskontekst. Bruk dem gjerne i skriptet.
- Dette er et JavaScript-skript, så du kan bruke alle JavaScript-funksjoner i skriptet.
- Du kan bruke `axios`-modulen til å sende HTTP-forespørsler i skriptet. Du kan bruke den til å sende API-kall fra skriptet.
- Hvis du bruker oneuptime.com, vil du alltid ha den nyeste versjonen av Playwright og nettlesere tilgjengelig i skriptets kontekst. Hvis du selvhoster, sørg for at du oppdaterer probene for å ha den nyeste versjonen av Playwright og nettleserne.
- Tidsavbrudd for skriptet er 2 minutter. Hvis skriptet tar mer enn 2 minutter, vil det avsluttes.
