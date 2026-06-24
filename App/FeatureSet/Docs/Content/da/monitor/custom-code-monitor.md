# Brugerdefineret kodemonitor

Brugerdefineret kodemonitor giver dig mulighed for at skrive brugerdefinerede scripts til at overvåge dine applikationer. Du kan bruge denne funktion til at overvåge dine applikationer på en måde, der ikke er mulig med de eksisterende monitorer. For eksempel kan du have flertrinede API-anmodninger.

#### Eksempel

Følgende eksempel viser, hvordan man bruger en brugerdefineret kodemonitor:

```javascript
// Du kan bruge axios-modulet.

await axios.get("https://api.example.com/");

// Axios-dokumentation her: https://axios-http.com/docs/intro

return {
  data: "Hello World", // returner de data, du ønsker her.
};
```

### Brug af Monitor Secrets

#### Tilføjelse af en hemmelighed

For at tilføje en hemmelighed skal du gå til OneUptime Dashboard -> Projektindstillinger -> Monitor Secrets -> Opret Monitor Secret.

![Opret hemmelighed](/docs/static/images/CreateMonitorSecret.png)

Du kan vælge, hvilke monitorer der har adgang til hemmeligheden. I dette tilfælde har vi tilføjet `ApiKey`-hemmelighed og valgt monitorer til at have adgang til den.

**Bemærk venligst**: Hemmeligheder er krypteret og opbevaret sikkert. Hvis du mister hemmeligheden, skal du oprette en ny. Du kan ikke se eller opdatere hemmeligheden, efter den er gemt.

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

- `name` (streng, påkrævet): Metrikkens navn (f.eks. `"api.response.time"`). Det gemmes automatisk med præfikset `custom.monitor.`.
- `value` (tal, påkrævet): Den numeriske metrikværdi.
- `attributes` (objekt, valgfrit): Nøgle-værdi-par til yderligere kontekst.

#### Eksempel

```javascript
const response = await axios.get("https://api.example.com/health");

// Optag en simpel metrik
oneuptime.captureMetric("api.response.time", response.data.latency);

// Optag en metrik med attributter
oneuptime.captureMetric("api.queue.depth", response.data.queueDepth, {
  region: "us-east-1",
  environment: "production",
});

return {
  data: response.data,
};
```

Når de er optaget, vises disse metrikker i Metrisk Stifinder under navne som `custom.monitor.api.response.time`. Du kan tilføje dem til dashboard-diagrammer, opsætte advarsler og filtrere efter monitor, probe eller eventuelle brugerdefinerede attributter, du har angivet.

**Grænser:**

- Maks. 100 metrikker pr. scriptudførelse.
- Metriknavne er begrænset til 200 tegn.
- Værdier skal være numeriske.

### Tilgængelige moduler i scriptet

- `axios`: Du kan bruge dette modul til at sende HTTP-anmodninger. Det er en promise-baseret HTTP-klient til browsere og Node.js.
- `crypto`: Du kan bruge dette modul til at udføre kryptografiske operationer. Det er et indbygget Node.js-modul, der leverer kryptografisk funktionalitet, herunder et sæt wrappers til OpenSSL's hash-, HMAC-, cipher-, decipher-, sign- og verify-funktioner.
- `console.log`: Du kan bruge dette modul til at logge data til konsollen. Dette er nyttigt til fejlfindingsformål.
- `oneuptime.captureMetric`: Du kan bruge dette til at optage brugerdefinerede metrikker fra dit script. Se afsnittet Brugerdefinerede metrikker ovenfor.
- `http`: Du kan bruge dette modul til at sende HTTP-anmodninger. Det er et indbygget Node.js-modul, der leverer en HTTP-klient og -server.
- `https`: Du kan bruge dette modul til at sende HTTPS-anmodninger. Det er et indbygget Node.js-modul, der leverer en HTTPS-klient og -server.

### Ting at overveje

- Du kan bruge `console.log` til at logge data i konsollen. Dette er tilgængeligt i log-afsnittet for monitoren (Prober > Vis logs).
- Du kan returnere data fra scriptet ved hjælp af `return`-sætningen.
- Dette er et JavaScript-script, så du kan bruge alle JavaScript-funktioner i scriptet.
- Timeout for scriptet er 2 minutter. Hvis scriptet tager mere end 2 minutter, afsluttes det.
