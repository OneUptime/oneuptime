# Template Dinamico per Incidenti e Avvisi

È possibile usare la stessa sintassi con segnaposto `{{variabile}}` utilizzata dalle espressioni JavaScript nei criteri di monitoraggio per popolare dinamicamente il titolo, la descrizione e le note di rimedio degli incidenti e degli avvisi creati automaticamente dai criteri dei monitor.

## Tipi di Monitor e Variabili Supportati

I seguenti tipi di monitor supportano il template dinamico con le rispettive variabili:

- **Monitor Sito Web e API**: Dati di risposta, intestazioni, codici di stato, tempi
- **Monitor Richiesta In Entrata**: Dati della richiesta, intestazioni, metodi, tempi
- **Monitor Ping**: Stato della connettività, tempi di risposta, cause di errore
- **Monitor Porta**: Connettività della porta, tempi di risposta, stato di timeout
- **Monitor IP**: Raggiungibilità IP, tempi di ping, informazioni sugli errori
- **Monitor Certificato SSL**: Dettagli del certificato, stato di validazione, informazioni sulla scadenza
- **Monitor Server/VM**: Metriche di sistema (CPU, memoria, disco), processi, hostname
- **Monitor Sintetico**: Risultati dell'esecuzione script, screenshot, dettagli del browser
- **Monitor Codice JavaScript Personalizzato**: Risultati dell'esecuzione, tempi, messaggi di errore
- **Monitor SNMP**: Stato del dispositivo, tempi di risposta, valori OID

> **Nota**: I monitor Logs, Traces e Metrics attualmente non supportano il template per incidenti/avvisi perché utilizzano meccanismi di trigger diversi.

## Tipi di Monitor e Variabili Supportati

### Monitor Sito Web e API

| Variabile | Descrizione | Tipo |
| --- | --- | --- |
| `responseBody` | L'oggetto corpo della risposta. Se HTML / XML è una stringa. Se JSON è un oggetto JSON. | `string` o `JSON` |
| `responseHeaders` | L'oggetto intestazioni della risposta (chiavi in minuscolo). | `Dictionary<string>` |
| `responseStatusCode` | Il codice di stato HTTP della risposta. | `number` |
| `responseTimeInMs` | Il tempo di risposta in millisecondi. | `number` |
| `isOnline` | Se il monitor è considerato online. | `boolean` |

### Monitor Richiesta In Entrata

| Variabile | Descrizione | Tipo |
| --- | --- | --- |
| `requestBody` | L'oggetto corpo della richiesta. | `string` o `JSON` |
| `requestHeaders` | L'oggetto intestazioni della richiesta (chiavi in minuscolo). | `Dictionary<string>` |
| `requestMethod` | Il metodo HTTP della richiesta in entrata (GET, POST, ecc.). | `string` |
| `incomingRequestReceivedAt` | La data e l'ora in cui è stata ricevuta la richiesta in entrata. | `Date` |

### Monitor Ping

| Variabile | Descrizione | Tipo |
| --- | --- | --- |
| `isOnline` | Se il target del ping è considerato online. | `boolean` |
| `responseTimeInMs` | Il tempo di risposta del ping in millisecondi. | `number` |
| `failureCause` | La causa del fallimento se il ping è fallito. | `string` |
| `isTimeout` | Se la richiesta ping è andata in timeout. | `boolean` |

### Monitor Porta

| Variabile | Descrizione | Tipo |
| --- | --- | --- |
| `isOnline` | Se la porta è considerata online/accessibile. | `boolean` |
| `responseTimeInMs` | Il tempo di risposta della connessione in millisecondi. | `number` |
| `failureCause` | La causa del fallimento se il controllo della porta è fallito. | `string` |
| `isTimeout` | Se la connessione alla porta è andata in timeout. | `boolean` |

### Monitor IP

| Variabile | Descrizione | Tipo |
| --- | --- | --- |
| `isOnline` | Se l'indirizzo IP è considerato online. | `boolean` |
| `responseTimeInMs` | Il tempo di risposta del ping in millisecondi. | `number` |
| `failureCause` | La causa del fallimento se il controllo IP è fallito. | `string` |
| `isTimeout` | Se la richiesta ping IP è andata in timeout. | `boolean` |

### Monitor Certificato SSL

| Variabile | Descrizione | Tipo |
| --- | --- | --- |
| `isOnline` | Se il controllo del certificato SSL ha avuto successo. | `boolean` |
| `isSelfSigned` | Se il certificato SSL è autofirmato. | `boolean` |
| `createdAt` | La data di creazione del certificato SSL. | `Date` |
| `expiresAt` | La data di scadenza del certificato SSL. | `Date` |
| `commonName` | Il nome comune (CN) del certificato. | `string` |
| `organizationalUnit` | L'unità organizzativa (OU) del certificato. | `string` |
| `organization` | L'organizzazione (O) del certificato. | `string` |
| `locality` | La località (L) del certificato. | `string` |
| `state` | Lo stato/provincia (ST) del certificato. | `string` |
| `country` | Il paese (C) del certificato. | `string` |
| `serialNumber` | Il numero seriale del certificato. | `string` |
| `fingerprint` | L'impronta SHA-1 del certificato. | `string` |
| `fingerprint256` | L'impronta SHA-256 del certificato. | `string` |
| `failureCause` | La causa del fallimento se il controllo SSL è fallito. | `string` |

### Monitor Server/VM

| Variabile | Descrizione | Tipo |
| --- | --- | --- |
| `hostname` | L'hostname del server monitorato. | `string` |
| `requestReceivedAt` | La data e l'ora in cui è stata ricevuta la richiesta del monitor server. | `Date` |
| `cpuUsagePercent` | La percentuale di utilizzo della CPU. | `number` |
| `cpuCores` | Il numero di core CPU. | `number` |
| `memoryUsagePercent` | La percentuale di utilizzo della memoria. | `number` |
| `memoryFreePercent` | La percentuale di memoria libera. | `number` |
| `memoryTotalBytes` | La memoria totale in byte. | `number` |
| `diskMetrics` | Array di metriche disco per tutti i dischi montati. | `Array<Object>` |
| `diskMetrics[].diskPath` | Il percorso del punto di montaggio del disco. | `string` |
| `diskMetrics[].usagePercent` | La percentuale di utilizzo del disco per questo punto di montaggio. | `number` |
| `diskMetrics[].freePercent` | La percentuale di spazio libero del disco per questo punto di montaggio. | `number` |
| `diskMetrics[].totalBytes` | Lo spazio totale del disco in byte per questo punto di montaggio. | `number` |
| `processes` | Array dei processi in esecuzione sul server. | `Array<Object>` |
| `processes[].pid` | L'ID del processo. | `number` |
| `processes[].name` | Il nome del processo. | `string` |
| `processes[].command` | Il comando usato per avviare il processo. | `string` |
| `failureCause` | La causa del fallimento se il controllo del server è fallito. | `string` |

### Monitor Sintetico

I monitor sintetici eseguono lo stesso script su più browser (Chromium, Firefox, Webkit) e dimensioni schermo (mobile, tablet, desktop), producendo una risposta per ogni configurazione. Ogni esecuzione è esposta tramite l'array `syntheticResponses` — si accede a un'esecuzione specifica tramite indice (`{{syntheticResponses[0].browserType}}`) o si itera con `{{#each syntheticResponses}}`.

| Variabile | Descrizione | Tipo |
| --- | --- | --- |
| `failureCause` | La causa del fallimento se il controllo sintetico è fallito. | `string` |
| `syntheticResponses` | Array contenente una voce per ogni combinazione browser/dimensione schermo su cui lo script è stato eseguito. | `Array<Object>` |
| `syntheticResponses[].executionTimeInMs` | Tempo di esecuzione in millisecondi per questa esecuzione. | `number` |
| `syntheticResponses[].result` | Il risultato restituito da questa esecuzione. | `string`, `number`, `boolean` o `JSON` |
| `syntheticResponses[].scriptError` | Eventuali errori verificatisi durante questa esecuzione. | `string` |
| `syntheticResponses[].logMessages` | Messaggi di log generati durante questa esecuzione. | `Array<string>` |
| `syntheticResponses[].screenshots` | Screenshot acquisiti durante questa esecuzione. | `Object` |
| `syntheticResponses[].browserType` | Browser usato per questa esecuzione. | `string` |
| `syntheticResponses[].screenSizeType` | Dimensione schermo usata per questa esecuzione. | `string` |

### Monitor Codice JavaScript Personalizzato

| Variabile | Descrizione | Tipo |
| --- | --- | --- |
| `executionTimeInMs` | Il tempo impiegato per eseguire il codice personalizzato in millisecondi. | `number` |
| `result` | Il risultato restituito dal codice personalizzato. | `string`, `number`, `boolean` o `JSON` |
| `scriptError` | Eventuali errori verificatisi durante l'esecuzione del codice. | `string` |
| `logMessages` | Array di messaggi di log generati durante l'esecuzione. | `Array<string>` |

### Monitor SNMP

| Variabile | Descrizione | Tipo |
| --- | --- | --- |
| `isOnline` | Se il dispositivo SNMP è online e risponde. | `boolean` |
| `responseTimeInMs` | Il tempo di risposta alla query SNMP in millisecondi. | `number` |
| `failureCause` | La causa del fallimento se la query SNMP è fallita. | `string` |
| `isTimeout` | Se la query SNMP è andata in timeout. | `boolean` |
| `oidResponses` | Array di oggetti risposta OID con oid, name, value e type. | `Array<Object>` |
| `oidResponses[].oid` | L'OID interrogato. | `string` |
| `oidResponses[].name` | Il nome descrittivo dell'OID (se fornito). | `string` |
| `oidResponses[].value` | Il valore restituito dall'OID. | `string` o `number` |
| `oidResponses[].type` | Il tipo di dato SNMP del valore. | `string` |
| `{{OID_NAME}}` | Accesso diretto al valore OID tramite nome (es. `{{sysUpTime}}`). | `string` o `number` |


## Utilizzo Base

Nel modulo Incidente / Avviso all'interno di un'istanza di Criteri Monitor, è possibile scrivere:

```
API ha restituito {{responseStatusCode}} in {{responseTimeInMs}}ms
```

Se il codice di stato della risposta del monitor è `502` e il tempo è `842`, il titolo memorizzato diventa:

```
API ha restituito 502 in 842ms
```

L'accesso annidato JSON funziona allo stesso modo delle espressioni JavaScript:

```
ID Problema: {{responseBody.error.id}}
Messaggio: {{responseBody.error.message}}
```

L'indicizzazione degli array è supportata:

```
Primo Utente: {{responseBody.users[0].name}}
```

Se un percorso non esiste, viene risolto in una stringa vuota per impostazione predefinita.

## Utilizzo Avanzato

### Accesso agli Elementi dell'Array
```
Utilizzo primo disco: {{diskMetrics[0].usagePercent}}%
Ultimo processo: {{processes[-1].name}}
```

### Accesso agli Oggetti Annidati
```
Messaggio di errore: {{responseBody.error.details.message}}
Posizione server: {{sslCertificate.locality}} {{sslCertificate.country}}
```

### Iterazione sugli Array con `{{#each}}`

È possibile iterare sugli array usando la sintassi del blocco `{{#each percorso}}...{{/each}}`. Questo è utile quando i dati contengono un elenco di elementi e si vuole includere ognuno nella descrizione dell'incidente o dell'avviso.

**Sintassi:**
```
{{#each arrayPath}}
  ...corpo usando {{proprietà}} di ciascun elemento...
{{/each}}
```

All'interno del ciclo:
- `{{nomeProprietà}}` si risolve relativamente all'elemento corrente dell'array
- `{{proprietà.annidata}}` la notazione con punto funziona sull'elemento corrente
- `{{@index}}` si risolve nell'indice a base 0 dell'iterazione corrente
- `{{this}}` si risolve nel valore dell'elemento corrente (utile per array di stringhe/numeri)
- Le variabili non trovate nell'elemento corrente ricadono nella mappa di storage del genitore

**Esempio — Richiesta in Entrata con array di avvisi (es. webhook Grafana):**

Se il corpo della richiesta in entrata è:
```json
{
  "status": "firing",
  "alerts": [
    { "status": "firing", "labels": { "label": "Coralpay" } },
    { "status": "firing", "labels": { "label": "capitecpay" } },
    { "status": "resolved", "labels": { "label": "capricorn" } }
  ]
}
```

È possibile scrivere un template come:
```
Etichette Avvisi:
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

Che produce:
```
Etichette Avvisi:
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**Esempio — Metriche disco server:**
```
Utilizzo Disco:
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% utilizzato
{{/each}}
```

**Esempio — Uso di `{{@index}}`:**
```
Processi:
{{#each processes}}
{{@index}}. {{name}} (PID: {{pid}})
{{/each}}
```

**Esempio — Array primitivo con `{{this}}`:**
```
Messaggi di log:
{{#each logMessages}}
- {{this}}
{{/each}}
```

**Esempio — Loop annidati:**

È possibile annidare blocchi `{{#each}}` per array a più livelli:
```
{{#each requestBody.groups}}
Gruppo: {{name}}
{{#each members}}
  - {{id}}: {{role}}
{{/each}}
{{/each}}
```

> **Nota**: Se il percorso non si risolve in un array, l'intero blocco `{{#each}}...{{/each}}` viene rimosso dall'output. Gli array vuoti non producono alcun output per il blocco.


## Esempi

### Titolo Incidente Monitor Sito Web/API
```
Alta latenza: {{responseTimeInMs}}ms (> soglia)
```

### Descrizione Incidente Monitor Sito Web/API
```
### Errore API
Stato: **{{responseStatusCode}}**  
Latenza: **{{responseTimeInMs}}ms**  
Estratto Body: `{{responseBody.error.message}}`
```

### Titolo Avviso Richiesta In Entrata
```
Richiesta in entrata non valida: method={{requestMethod}} auth={{requestHeaders.authorization}}
```

### Titolo Avviso Certificato SSL
```
Certificato SSL in scadenza: {{commonName}} scade il {{expiresAt}}
```

### Descrizione Avviso Monitor Server
```
### Avviso Server: {{hostname}}
Utilizzo CPU: **{{cpuUsagePercent}}%**  
Utilizzo Memoria: **{{memoryUsagePercent}}%**  
Utilizzo Primo Disco: **{{diskMetrics[0].usagePercent}}%**  
Ultimo Controllo: {{requestReceivedAt}}
```

### Titolo Avviso Monitor Ping
```
Ping fallito per il target: {{failureCause}} ({{responseTimeInMs}}ms)
```

### Descrizione Avviso Monitor Porta
```
Problema di connettività alla porta
Stato porta target: {{isOnline}}
Tempo di risposta: {{responseTimeInMs}}ms
Causa del fallimento: {{failureCause}}
```

### Avviso Monitor Sintetico

Accesso a un'esecuzione specifica browser/dimensione schermo tramite indice:
```
Prima esecuzione: {{syntheticResponses[0].browserType}} / {{syntheticResponses[0].screenSizeType}}
Risultato: {{syntheticResponses[0].result}} in {{syntheticResponses[0].executionTimeInMs}}ms
```

Iterazione su ogni combinazione browser/dimensione schermo con `{{#each}}`:
```
### Risultati Monitor Sintetico
{{#each syntheticResponses}}
- **{{browserType}} / {{screenSizeType}}**: {{result}} in {{executionTimeInMs}}ms
  - Errore script: {{scriptError}}
  - Primo log: {{logMessages[0]}}
{{/each}}
```

### Avviso Monitor Codice Personalizzato
```
Esecuzione codice personalizzato: {{executionTimeInMs}}ms
Output log: {{logMessages[0]}}
```

### Titolo Avviso Monitor SNMP
```
Dispositivo SNMP offline: {{failureCause}} ({{responseTimeInMs}}ms)
```

### Descrizione Avviso Monitor SNMP
```
### Avviso Dispositivo SNMP
Stato: **{{isOnline}}**
Tempo di Risposta: **{{responseTimeInMs}}ms**
Uptime Sistema: {{sysUpTime}}
Nome Sistema: {{sysName}}
Primo Valore OID: {{oidResponses[0].value}}
```

### Richiesta In Entrata con Loop Array (Webhook Grafana)

Titolo:
```
[{{requestBody.status}}] {{requestBody.receiver}}
```

Descrizione:
```
### Avvisi da {{requestBody.receiver}}

{{#each requestBody.alerts}}
**Avviso {{@index}}**: {{labels.alertname}}
- Etichetta: {{labels.label}}
- Stato: {{status}}
- Valori: {{valueString}}
- Sorgente: {{generatorURL}}
{{/each}}
```

### Monitor Server con Loop Disco

Descrizione:
```
### Avviso Server: {{hostname}}
Utilizzo CPU: **{{cpuUsagePercent}}%**
Utilizzo Memoria: **{{memoryUsagePercent}}%**

**Utilizzo Disco:**
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% utilizzato ({{freePercent}}% libero)
{{/each}}

**Processi in Esecuzione:**
{{#each processes}}
- [{{pid}}] {{name}}: {{command}}
{{/each}}
```

### Monitor SNMP con Loop OID

Descrizione:
```
### Stato Dispositivo SNMP
Online: {{isOnline}}
Risposta: {{responseTimeInMs}}ms

**Valori OID:**
{{#each oidResponses}}
- {{name}} ({{oid}}): {{value}}
{{/each}}
```
