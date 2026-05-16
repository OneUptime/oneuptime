# Monitor Sintetico

Il monitoraggio sintetico è un modo per monitorare proattivamente le proprie applicazioni simulando le interazioni degli utenti. È possibile creare un monitor sintetico per verificare la disponibilità e le prestazioni delle proprie applicazioni da diverse posizioni nel mondo.

#### Esempio

L'esempio seguente mostra come usare un Monitor Sintetico:

```javascript

// Gli oggetti disponibili nel contesto dello script sono:

// - axios: modulo Axios per fare richieste HTTP
// - page: oggetto Page di Playwright per interagire con il browser
// - browserType: tipo di browser nel contesto di esecuzione corrente - Chromium, Firefox, Webkit
// - screenSizeType: tipo di dimensione schermo nel contesto di esecuzione corrente - Mobile, Tablet, Desktop

// È possibile usare questi oggetti per interagire con il browser e fare richieste HTTP.

await page.goto('https://playwright.dev/');

// Documentazione Playwright qui: https://playwright.dev/docs/intro

// Ecco alcune delle variabili che si possono usare nel contesto dell'oggetto monitorato:

console.log(browserType) // Elenca il tipo di browser nel contesto di esecuzione corrente - Chromium, Firefox, Webkit

console.log(screenSizeType) // Elenca il tipo di dimensione schermo nel contesto di esecuzione corrente - Mobile, Tablet, Desktop

// L'oggetto page di Playwright appartiene a quel contesto browser specifico, quindi è possibile usarlo per interagire con il browser.

// Per acquisire screenshot, assegnarli all'oggetto `screenshots` fornito
// nel contesto dello script. Gli screenshot acquisiti in questo modo vengono preservati anche se lo script
// genera un errore in seguito — utile per il debug delle esecuzioni fallite.

screenshots['nome-screenshot'] = await page.screenshot(); // è possibile salvare più screenshot con nomi diversi.

// quando si vuole restituire un valore, usare l'istruzione return con data come prop.

// Per registrare dati, usare console.log
// console.log('Hello World');

// È possibile accedere al contesto del browser tramite page.context() se necessario (ad esempio, per creare una nuova pagina o gestire popup).


return {
    data: 'Hello World'
};
```

### Uso di Playwright

Viene usato Playwright per simulare le interazioni degli utenti. È possibile usare l'oggetto `page` di Playwright per interagire con il browser ed eseguire azioni come fare clic su pulsanti, compilare moduli e acquisire screenshot. 

### Screenshot

Nel contesto dello script è disponibile un oggetto `screenshots` pre-dichiarato. Gli screenshot vengono assegnati in qualsiasi momento durante lo script — questi screenshot vengono acquisiti **anche se lo script genera un errore** (inclusi fallimenti di assertion, timeout o errori imprevisti), così è possibile vedere esattamente com'era la pagina quando l'esecuzione è fallita. Gli screenshot acquisiti appaiono nel Dashboard di OneUptime per quella specifica esecuzione del monitor.

```javascript

// Acquisire screenshot tramite il canale laterale `screenshots` — vengono preservati sia in caso di successo che di errore.

await page.goto('https://app.example.com/login');
screenshots['pagina-login'] = await page.screenshot();

await page.fill('#email', 'user@example.com');
await page.fill('#password', 'wrong');
await page.click('button[type=submit]');

// Se l'assertion successiva genera un errore, lo screenshot 'pagina-login' sopra viene comunque acquisito.
await page.waitForSelector('.dashboard', { timeout: 5000 });

screenshots['dashboard'] = await page.screenshot();

return {
    data: 'Login riuscito'
};

```

#### Restituzione degli screenshot (metodo legacy)

Per compatibilità con le versioni precedenti, è anche possibile restituire gli screenshot dallo script come parte del valore di ritorno. Gli screenshot restituiti in questo modo vengono acquisiti **solo** quando lo script si completa normalmente — vengono persi se lo script genera un errore. Preferire il pattern con canale laterale sopra quando si vogliono prove dei fallimenti.

```javascript
// Pattern legacy — gli screenshot vengono acquisiti solo in caso di ritorno con successo.
const screenshots = {};
screenshots['nome-screenshot'] = await page.screenshot();

return {
    data: 'Hello World',
    screenshots: screenshots
};
```


### Uso dei Segreti Monitor

#### Aggiunta di un segreto

Per aggiungere un segreto, accedere a Dashboard OneUptime -> Impostazioni Progetto -> Segreti Monitor -> Crea Segreto Monitor.

![Crea Segreto](/docs/static/images/CreateMonitorSecret.png)

È possibile selezionare quali monitor hanno accesso al segreto. In questo caso è stato aggiunto il segreto `ApiKey` e sono stati selezionati i monitor che vi possono accedere.

**Nota importante**: I segreti sono crittografati e archiviati in modo sicuro. Se si perde il segreto, sarà necessario crearne uno nuovo. Non è possibile visualizzare o aggiornare il segreto dopo che è stato salvato. 

#### Uso di un segreto

Per usare i Segreti Monitor nello script, è possibile usare l'oggetto `monitorSecrets` nel contesto dello script. Si può usare per accedere ai segreti aggiunti al monitor.

```javascript
// se il segreto è di tipo stringa, racchiuderlo tra virgolette
let stringSecret = '{{monitorSecrets.StringSecret}}';

// se il segreto è di tipo number o boolean, è possibile usarlo direttamente
let numberSecret = {{monitorSecrets.NumberSecret}};

// se il segreto è di tipo boolean, è possibile usarlo direttamente
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// è anche possibile usare console.log per verificare che il segreto venga recuperato correttamente
console.log(stringSecret); 
```

### Metriche Personalizzate

È possibile acquisire metriche personalizzate dallo script usando la funzione `oneuptime.captureMetric()`. Queste metriche vengono archiviate in OneUptime e possono essere visualizzate in grafici sui dashboard usando Metric Explorer.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (stringa, obbligatorio): Il nome della metrica (ad es. `"dashboard.load.time"`). Verrà archiviato automaticamente con il prefisso `custom.monitor.`.
- `value` (numero, obbligatorio): Il valore numerico della metrica.
- `attributes` (oggetto, opzionale): Coppie chiave-valore per contesto aggiuntivo.

#### Esempio

```javascript
await page.goto('https://app.example.com');

const startTime = Date.now();
await page.waitForSelector('#dashboard-loaded');
const loadTime = Date.now() - startTime;

// Acquisire il tempo di caricamento della pagina come metrica personalizzata
oneuptime.captureMetric('dashboard.load.time', loadTime, {
    page: 'dashboard'
});

screenshots['dashboard'] = await page.screenshot();

return {
    data: { loadTime }
};
```

Una volta acquisite, queste metriche appaiono in Metric Explorer con nomi come `custom.monitor.dashboard.load.time`. È possibile aggiungerle ai grafici del dashboard, impostare avvisi e filtrare per monitor, probe, tipo di browser, dimensione schermo o qualsiasi attributo personalizzato fornito.

**Limiti:**
- Massimo 100 metriche per esecuzione dello script.
- I nomi delle metriche sono limitati a 200 caratteri.
- I valori devono essere numerici.

### Moduli disponibili nello script
- `page`: È possibile usare questo modulo per interagire con il browser. È un oggetto Page di Playwright che consente di eseguire azioni come fare clic su pulsanti, compilare moduli e acquisire screenshot. È possibile accedere al contesto del browser tramite `page.context()` se necessario (ad esempio, per creare una nuova pagina o gestire i popup).
- `screenshots`: Un oggetto pre-dichiarato a cui si assegnano gli screenshot (ad es. `screenshots['pagina-login'] = await page.screenshot()`). Gli screenshot assegnati qui vengono acquisiti anche se lo script genera un errore in seguito.
- `axios`: È possibile usare questo modulo per fare richieste HTTP. È un client HTTP basato su promise per il browser e Node.js.
- `crypto`: È possibile usare questo modulo per eseguire operazioni crittografiche. È un modulo Node.js integrato che fornisce funzionalità crittografiche che includono un set di wrapper per le funzioni hash, HMAC, cipher, decipher, sign e verify di OpenSSL.
- `console.log`: È possibile usare questo modulo per registrare dati nella console. Questo è utile per il debug.
- `oneuptime.captureMetric`: È possibile usare questo per acquisire metriche personalizzate dallo script. Vedere la sezione Metriche Personalizzate sopra.
- `http`: È possibile usare questo modulo per fare richieste HTTP. È un modulo Node.js integrato che fornisce un client e un server HTTP.
- `https`: È possibile usare questo modulo per fare richieste HTTPS. È un modulo Node.js integrato che fornisce un client e un server HTTPS.

### Considerazioni

- L'oggetto `page` è l'interfaccia principale per interagire con il browser. Si tratta della classe Page di Playwright. È possibile accedere al contesto del browser tramite `page.context()` se necessario.
- È possibile usare `console.log` per registrare i dati nella console. Questo sarà disponibile nella sezione log del monitor.
- È possibile restituire i dati dallo script usando l'istruzione `return`. Assegnare gli screenshot all'oggetto `screenshots` fornito in modo che vengano preservati anche se lo script genera un errore.
- È possibile usare le variabili `browserType` e `screenSizeType` per ottenere il tipo di browser e la dimensione schermo nel contesto di esecuzione corrente. Sentirsi liberi di usarle nello script.
- Questo è uno script JavaScript, quindi è possibile usare tutte le funzionalità JavaScript nello script.
- È possibile usare il modulo `axios` per fare richieste HTTP nello script. Può essere usato per effettuare chiamate API dallo script.
- Se si usa oneuptime.com, si avrà sempre disponibile la versione più recente di Playwright e dei browser nel contesto dello script. Se si ospita autonomamente, assicurarsi di aggiornare i probe per avere la versione più recente di Playwright e dei browser.
- Il timeout per lo script è di 2 minuti. Se lo script impiega più di 2 minuti, verrà terminato.
