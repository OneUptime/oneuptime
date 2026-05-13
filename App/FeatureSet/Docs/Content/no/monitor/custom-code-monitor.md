# Egendefinert kode-monitor

Egendefinert kode-monitor lar deg skrive egne skript for å overvåke applikasjonene dine. Du kan bruke denne funksjonen til å overvåke applikasjonene dine på en måte som ikke er mulig med de eksisterende monitorene. For eksempel kan du ha fler-trinns API-forespørsler.

#### Eksempel

Følgende eksempel viser hvordan du bruker en egendefinert kode-monitor:

```javascript
// Du kan bruke axios-modulen.

await axios.get('https://api.example.com/');

// Axios-dokumentasjon her: https://axios-http.com/docs/intro

return {
    data: 'Hello World' // returner hvilke data du vil her. 
};
```


### Bruke Monitor Secrets

#### Legge til en hemmelighet

For å legge til en hemmelighet, gå til OneUptime Dashboard -> Project Settings -> Monitor Secrets -> Create Monitor Secret.

![Opprett hemmelighet](/docs/static/images/CreateMonitorSecret.png)

Du kan velge hvilke monitorer som har tilgang til hemmeligheten. I dette tilfellet la vi til `ApiKey`-hemmeligheten og valgte monitorer som skal ha tilgang til den.

**Merk**: Hemmeligheter krypteres og lagres sikkert. Hvis du mister hemmeligheten, må du opprette en ny. Du kan ikke vise eller oppdatere hemmeligheten etter at den er lagret.

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

- `name` (streng, påkrevd): Metrikknavnet (f.eks. `"api.response.time"`). Det lagres automatisk med prefikset `custom.monitor.`.
- `value` (tall, påkrevd): Den numeriske metrikkverdien.
- `attributes` (objekt, valgfritt): Nøkkel-verdi-par for ytterligere kontekst.

#### Eksempel

```javascript
const response = await axios.get('https://api.example.com/health');

// Fang opp en enkel metrikk
oneuptime.captureMetric('api.response.time', response.data.latency);

// Fang opp en metrikk med attributter
oneuptime.captureMetric('api.queue.depth', response.data.queueDepth, {
    region: 'us-east-1',
    environment: 'production'
});

return {
    data: response.data
};
```

Når de er fanget opp, vises disse metrikkene i Metric Explorer under navn som `custom.monitor.api.response.time`. Du kan legge dem til i dashbordgrafer, sette opp varsler og filtrere etter monitor, probe eller egendefinerte attributter du oppga.

**Begrensninger:**
- Maksimalt 100 metrikker per skriptkjøring.
- Metrikknavn er begrenset til 200 tegn.
- Verdier må være numeriske.

### Tilgjengelige moduler i skriptet
- `axios`: Du kan bruke denne modulen til å sende HTTP-forespørsler. Det er en løftebasert HTTP-klient for nettleseren og Node.js.
- `crypto`: Du kan bruke denne modulen til å utføre kryptografiske operasjoner. Det er en innebygd Node.js-modul som gir kryptografisk funksjonalitet, inkludert et sett med innpakninger for OpenSSL sine hash-, HMAC-, siffer-, desiffer-, signer- og verifiserfunksjoner.
- `console.log`: Du kan bruke denne modulen til å logge data til konsollen. Dette er nyttig for feilsøkingsformål.
- `oneuptime.captureMetric`: Du kan bruke dette til å fange opp egendefinerte metrikker fra skriptet ditt. Se avsnittet om egendefinerte metrikker ovenfor.
- `http`: Du kan bruke denne modulen til å sende HTTP-forespørsler. Det er en innebygd Node.js-modul som tilbyr en HTTP-klient og -server.
- `https`: Du kan bruke denne modulen til å sende HTTPS-forespørsler. Det er en innebygd Node.js-modul som tilbyr en HTTPS-klient og -server.

### Ting å vurdere

- Du kan bruke `console.log` til å logge data i konsollen. Dette vil være tilgjengelig i loggseksjonen til monitoren (Probes > View Logs).
- Du kan returnere data fra skriptet ved hjelp av `return`-setningen.
- Dette er et JavaScript-skript, så du kan bruke alle JavaScript-funksjoner i skriptet.
- Tidsavbrudd for skriptet er 2 minutter. Hvis skriptet tar mer enn 2 minutter, vil det avsluttes.
