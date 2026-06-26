# Monitor con Codice Personalizzato

Il Monitor con Codice Personalizzato ti consente di scrivere script personalizzati per monitorare le tue applicazioni. Puoi usare questa funzionalità per monitorare le tue applicazioni in modi non possibili con i monitor esistenti. Ad esempio, puoi eseguire richieste API multi-step.

#### Esempio

Il seguente esempio mostra come usare un Monitor con Codice Personalizzato:

```javascript
// Puoi usare il modulo axios.

await axios.get("https://api.example.com/");

// Documentazione Axios qui: https://axios-http.com/docs/intro

return {
  data: "Hello World", // restituisce qualsiasi dato vuoi qui.
};
```

### Uso dei Segreti del Monitor

#### Aggiunta di un segreto

Per aggiungere un segreto, vai su Dashboard di OneUptime -> Impostazioni Progetto -> Segreti del Monitor -> Crea Segreto del Monitor.

![Crea Segreto](/docs/static/images/CreateMonitorSecret.png)

Puoi selezionare quali monitor hanno accesso al segreto. In questo caso abbiamo aggiunto il segreto `ApiKey` e selezionato i monitor che vi hanno accesso.

**Nota**: I segreti sono crittografati e archiviati in modo sicuro. Se perdi il segreto, dovrai crearne uno nuovo. Non puoi visualizzare o aggiornare il segreto dopo che è stato salvato.

#### Uso di un segreto

Per usare i Segreti del Monitor nello script, puoi usare l'oggetto `monitorSecrets` nel contesto dello script. Puoi usarlo per accedere ai segreti che hai aggiunto al monitor.

```javascript
// se il tuo segreto è di tipo stringa devi racchiuderlo tra virgolette
let stringSecret = '{{monitorSecrets.StringSecret}}';

// se il tuo segreto è di tipo numero o booleano puoi usarlo direttamente
let numberSecret = {{monitorSecrets.NumberSecret}};

// se il tuo segreto è di tipo booleano puoi usarlo direttamente
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// puoi anche usare console.log per verificare se il segreto viene recuperato correttamente
console.log(stringSecret);
```

### Metriche Personalizzate

Puoi acquisire metriche personalizzate dal tuo script usando la funzione `oneuptime.captureMetric()`. Queste metriche sono archiviate in OneUptime e possono essere visualizzate in grafici sulle dashboard tramite il Metric Explorer.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (stringa, obbligatorio): Il nome della metrica (es. `"api.response.time"`). Verrà archiviato automaticamente con il prefisso `custom.monitor.`.
- `value` (numero, obbligatorio): Il valore numerico della metrica.
- `attributes` (oggetto, opzionale): Coppie chiave-valore per contesto aggiuntivo.

#### Esempio

```javascript
const response = await axios.get("https://api.example.com/health");

// Acquisisci una metrica semplice
oneuptime.captureMetric("api.response.time", response.data.latency);

// Acquisisci una metrica con attributi
oneuptime.captureMetric("api.queue.depth", response.data.queueDepth, {
  region: "us-east-1",
  environment: "production",
});

return {
  data: response.data,
};
```

Una volta acquisite, queste metriche appaiono nel Metric Explorer con nomi come `custom.monitor.api.response.time`. Puoi aggiungerle ai grafici della dashboard, configurare avvisi e filtrare per monitor, probe o qualsiasi attributo personalizzato fornito.

**Limiti:**

- Massimo 100 metriche per esecuzione dello script.
- I nomi delle metriche sono limitati a 200 caratteri.
- I valori devono essere numerici.

### Moduli disponibili nello script

- `axios`: Puoi usare questo modulo per effettuare richieste HTTP. È un client HTTP basato su promise per il browser e Node.js.
- `crypto`: Puoi usare questo modulo per eseguire operazioni crittografiche. È un modulo Node.js integrato che fornisce funzionalità crittografiche che includono un insieme di wrapper per le funzioni hash, HMAC, cipher, decipher, sign e verify di OpenSSL.
- `console.log`: Puoi usare questo modulo per registrare dati nella console. Questo è utile per scopi di debugging.
- `oneuptime.captureMetric`: Puoi usare questo per acquisire metriche personalizzate dal tuo script. Vedi la sezione Metriche Personalizzate sopra.
- `http`: Puoi usare questo modulo per effettuare richieste HTTP. È un modulo Node.js integrato che fornisce un client e server HTTP.
- `https`: Puoi usare questo modulo per effettuare richieste HTTPS. È un modulo Node.js integrato che fornisce un client e server HTTPS.

### Considerazioni

- Puoi usare `console.log` per registrare i dati nella console. Questi saranno disponibili nella sezione log del monitor (Probe > Visualizza Log).
- Puoi restituire i dati dallo script usando l'istruzione `return`.
- Questo è uno script JavaScript, quindi puoi usare tutte le funzionalità JavaScript nello script.
- Il timeout per lo script è di 2 minuti. Se lo script impiega più di 2 minuti, verrà terminato.
