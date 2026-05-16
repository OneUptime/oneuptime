# Incident- og advarsel-dynamisk skabelon

Du kan bruge den samme `{{variabel}}`-pladsholderssyntaks, der bruges af JavaScript-udtryk i monitorkriterierne, til dynamisk at udfylde incident- og advarsels-titel, -beskrivelse og -afhjælpningsnoter, når de auto-oprettes ud fra monitorkriterier.

## Understøttede monitortyper og variabler

Følgende monitortyper understøtter dynamisk skabelon med deres respektive variabler:

- **Website- og API-monitorer**: Svardata, headere, statuskoder, timing
- **Indgående anmodningsmonitorer**: Anmodningsdata, headere, metoder, timing
- **Ping-monitorer**: Forbindelsesstatus, svartider, fejlårsager
- **Port-monitorer**: Portforbindelse, svartider, timeout-status
- **IP-monitorer**: IP-tilgængelighed, ping-tider, fejloplysninger
- **SSL-certifikatmonitorer**: Certifikatdetaljer, valideringsstatus, udløbsoplysninger
- **Server/VM-monitorer**: Systemmetrikker (CPU, hukommelse, disk), processer, hostnavn
- **Syntetiske monitorer**: Scripteksekveringsresultater, skærmbilleder, browserdetaljer
- **Brugerdefinerede JavaScript-kodemonitorer**: Eksekveringsresultater, timing, fejlmeddelelser
- **SNMP-monitorer**: Enhedsstatus, svartider, OID-værdier

> **Bemærk**: Logs-, Traces- og Metrics-monitorer understøtter i øjeblikket ikke incident/advarsel-skabelon, da de bruger forskellige udløsermekanismer.

## Understøttede monitortyper og variabler

### Website- og API-monitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `responseBody` | Svarindholdet. Hvis HTML/XML, er det en streng. Hvis JSON, er det et JSON-objekt. | `string` eller `JSON` |
| `responseHeaders` | Svarheader-objektet (nøgler med små bogstaver). | `Dictionary<string>` |
| `responseStatusCode` | HTTP-svarstatuskoden. | `number` |
| `responseTimeInMs` | Svartiden i millisekunder. | `number` |
| `isOnline` | Om monitoren betragtes som online. | `boolean` |

### Indgående anmodningsmonitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `requestBody` | Anmodningsindholdet. | `string` eller `JSON` |
| `requestHeaders` | Anmodningsheader-objektet (nøgler med små bogstaver). | `Dictionary<string>` |
| `requestMethod` | HTTP-metoden for den indgående anmodning (GET, POST osv.). | `string` |
| `incomingRequestReceivedAt` | Dato og tidspunkt for modtagelse af den indgående anmodning. | `Date` |

### Ping-monitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `isOnline` | Om ping-målet betragtes som online. | `boolean` |
| `responseTimeInMs` | Ping-svartiden i millisekunder. | `number` |
| `failureCause` | Årsagen til fejl, hvis ping mislykkedes. | `string` |
| `isTimeout` | Om ping-anmodningen fik timeout. | `boolean` |

### Port-monitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `isOnline` | Om porten betragtes som online/tilgængelig. | `boolean` |
| `responseTimeInMs` | Forbindelsessvartiden i millisekunder. | `number` |
| `failureCause` | Årsagen til fejl, hvis porttjekket mislykkedes. | `string` |
| `isTimeout` | Om portforbindelsen fik timeout. | `boolean` |

### IP-monitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `isOnline` | Om IP-adressen betragtes som online. | `boolean` |
| `responseTimeInMs` | Ping-svartiden i millisekunder. | `number` |
| `failureCause` | Årsagen til fejl, hvis IP-tjekket mislykkedes. | `string` |
| `isTimeout` | Om IP-ping-anmodningen fik timeout. | `boolean` |

### SSL-certifikatmonitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `isOnline` | Om SSL-certifikattjekket var vellykket. | `boolean` |
| `isSelfSigned` | Om SSL-certifikatet er selvsigneret. | `boolean` |
| `createdAt` | Den dato, SSL-certifikatet blev oprettet. | `Date` |
| `expiresAt` | Den dato, SSL-certifikatet udløber. | `Date` |
| `commonName` | Common name (CN) fra certifikatet. | `string` |
| `organizationalUnit` | Organisationsenheden (OU) fra certifikatet. | `string` |
| `organization` | Organisationen (O) fra certifikatet. | `string` |
| `locality` | Lokaliteten (L) fra certifikatet. | `string` |
| `state` | Staten/provinsen (ST) fra certifikatet. | `string` |
| `country` | Landet (C) fra certifikatet. | `string` |
| `serialNumber` | Serienummeret på certifikatet. | `string` |
| `fingerprint` | SHA-1-fingeraftrykket af certifikatet. | `string` |
| `fingerprint256` | SHA-256-fingeraftrykket af certifikatet. | `string` |
| `failureCause` | Årsagen til fejl, hvis SSL-tjekket mislykkedes. | `string` |

### Server/VM-monitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `hostname` | Hostnavnet for den overvågede server. | `string` |
| `requestReceivedAt` | Dato og tidspunkt for modtagelse af servermonitoranmodningen. | `Date` |
| `cpuUsagePercent` | CPU-udnyttelsesprocenten. | `number` |
| `cpuCores` | Antallet af CPU-kerner. | `number` |
| `memoryUsagePercent` | Hukommelsesudnyttelsesprocenten. | `number` |
| `memoryFreePercent` | Den ledige hukommelsesprocent. | `number` |
| `memoryTotalBytes` | Den samlede hukommelse i bytes. | `number` |
| `diskMetrics` | Array af diskmetrikker for alle monterede diske. | `Array<Object>` |
| `diskMetrics[].diskPath` | Stien til diskens monteringspunkt. | `string` |
| `diskMetrics[].usagePercent` | Diskudnyttelsesprocenten for dette monteringspunkt. | `number` |
| `diskMetrics[].freePercent` | Den ledige diskprocent for dette monteringspunkt. | `number` |
| `diskMetrics[].totalBytes` | Den samlede diskplads i bytes for dette monteringspunkt. | `number` |
| `processes` | Array af kørende processer på serveren. | `Array<Object>` |
| `processes[].pid` | Proces-ID'et. | `number` |
| `processes[].name` | Procesnavnet. | `string` |
| `processes[].command` | Den kommando, der bruges til at starte processen. | `string` |
| `failureCause` | Årsagen til fejl, hvis servertjekket mislykkedes. | `string` |

### Syntetiske monitorer

Syntetiske monitorer kører det samme script på tværs af flere browsere (Chromium, Firefox, Webkit) og skærmstørrelser (mobil, tablet, desktop), og producerer ét svar pr. konfiguration. Hver kørsel eksponeres via `syntheticResponses`-arrayet – adgang til en specifik kørsel via indeks (`{{syntheticResponses[0].browserType}}`) eller iterer med `{{#each syntheticResponses}}`.

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `failureCause` | Årsagen til fejl, hvis det syntetiske tjek mislykkedes. | `string` |
| `syntheticResponses` | Array med én post pr. browser-/skærmstørrelseskombination, som scriptet kørte mod. | `Array<Object>` |
| `syntheticResponses[].executionTimeInMs` | Eksekveringstid i millisekunder for denne kørsel. | `number` |
| `syntheticResponses[].result` | Resultatet returneret af denne kørsel. | `string`, `number`, `boolean` eller `JSON` |
| `syntheticResponses[].scriptError` | Eventuelle fejl, der opstod under denne kørsel. | `string` |
| `syntheticResponses[].logMessages` | Logmeddelelser genereret under denne kørsel. | `Array<string>` |
| `syntheticResponses[].screenshots` | Skærmbilleder taget under denne kørsel. | `Object` |
| `syntheticResponses[].browserType` | Browser brugt til denne kørsel. | `string` |
| `syntheticResponses[].screenSizeType` | Skærmstørrelse brugt til denne kørsel. | `string` |

### Brugerdefinerede JavaScript-kodemonitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `executionTimeInMs` | Tid brugt på at eksekvere den brugerdefinerede kode i millisekunder. | `number` |
| `result` | Resultatet returneret af den brugerdefinerede kode. | `string`, `number`, `boolean` eller `JSON` |
| `scriptError` | Eventuelle fejl, der opstod under kodeeksekveringen. | `string` |
| `logMessages` | Array af logmeddelelser genereret under eksekvering. | `Array<string>` |

### SNMP-monitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `isOnline` | Om SNMP-enheden er online og svarer. | `boolean` |
| `responseTimeInMs` | SNMP-forespørgselssvartiden i millisekunder. | `number` |
| `failureCause` | Årsagen til fejl, hvis SNMP-forespørgslen mislykkedes. | `string` |
| `isTimeout` | Om SNMP-forespørgslen fik timeout. | `boolean` |
| `oidResponses` | Array af OID-svarobjekter med oid, navn, værdi og type. | `Array<Object>` |
| `oidResponses[].oid` | Den OID, der blev forespurgt. | `string` |
| `oidResponses[].name` | Det venlige navn på OID'en (hvis angivet). | `string` |
| `oidResponses[].value` | Værdien returneret af OID'en. | `string` eller `number` |
| `oidResponses[].type` | SNMP-datatypen for værdien. | `string` |
| `{{OID_NAME}}` | Direkte adgang til OID-værdi efter navn (f.eks. `{{sysUpTime}}`). | `string` eller `number` |


## Grundlæggende brug

I incident-/advarsel-formularen inden for en Monitorkriterieinstans kan du skrive:

```
API returned {{responseStatusCode}} in {{responseTimeInMs}}ms
```

Hvis monitorens svarstatuskode er `502` og tid er `842`, bliver den gemte titel:

```
API returned 502 in 842ms
```

Indlejret JSON-adgang fungerer på samme måde som JavaScript-udtryk:

```
Problem ID: {{responseBody.error.id}}
Message: {{responseBody.error.message}}
```

Array-indeksering er understøttet:

```
First User: {{responseBody.users[0].name}}
```

Hvis en sti ikke eksisterer, løses den som standard til en tom streng.

## Avanceret brug

### Adgang til array-elementer
```
First disk usage: {{diskMetrics[0].usagePercent}}%
Last process: {{processes[-1].name}}
```

### Indlejret objektadgang
```
Error message: {{responseBody.error.details.message}}
Server location: {{sslCertificate.locality}} {{sslCertificate.country}}
```

### Løkke over arrays med `{{#each}}`

Du kan iterere over arrays ved hjælp af `{{#each path}}...{{/each}}`-blokkens syntaks. Dette er nyttigt, når dataene indeholder en liste af elementer, og du vil inkludere hvert i din incident- eller advarselsbeskrivelse.

**Syntaks:**
```
{{#each arrayPath}}
  ...krop der bruger {{property}} fra hvert element...
{{/each}}
```

Inde i løkkekroppen:
- `{{propertyName}}` løses relativt til det aktuelle array-element
- `{{nested.property}}` punktnotationsadgang fungerer på det aktuelle element
- `{{@index}}` løses til det 0-baserede indeks for den aktuelle iteration
- `{{this}}` løses til den aktuelle elementværdi (nyttigt til arrays af strenge/tal)
- Variabler, der ikke findes på det aktuelle element, falder tilbage til det overordnede lagerkort

**Eksempel – Indgående anmodning med array af advarsler (f.eks. Grafana-webhooks):**

Hvis din indgående anmodningskrop ser sådan ud:
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

Du kan skrive en skabelon som:
```
Alert Labels:
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

Hvilket producerer:
```
Alert Labels:
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**Eksempel – Serverdiskmetrikker:**
```
Disk Usage:
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% used
{{/each}}
```

**Eksempel – Brug af `{{@index}}`:**
```
Processes:
{{#each processes}}
{{@index}}. {{name}} (PID: {{pid}})
{{/each}}
```

**Eksempel – Primitivt array med `{{this}}`:**
```
Log messages:
{{#each logMessages}}
- {{this}}
{{/each}}
```

**Eksempel – Indlejrede løkker:**

Du kan indlejre `{{#each}}`-blokke til flerniveaus-arrays:
```
{{#each requestBody.groups}}
Group: {{name}}
{{#each members}}
  - {{id}}: {{role}}
{{/each}}
{{/each}}
```

> **Bemærk**: Hvis stien ikke løser sig til et array, fjernes hele `{{#each}}...{{/each}}`-blokken fra outputtet. Tomme arrays producerer intet output for blokken.


## Eksempler

### Website/API Monitor-incident-titel
```
High latency: {{responseTimeInMs}}ms (> threshold)
```

### Website/API Monitor-incident-beskrivelse
```
### API Error
Status: **{{responseStatusCode}}**  
Latency: **{{responseTimeInMs}}ms**  
Body Snippet: `{{responseBody.error.message}}`
```

### Indgående anmodning-advarsel-titel
```
Bad inbound request: method={{requestMethod}} auth={{requestHeaders.authorization}}
```

### SSL-certifikat-advarsel-titel
```
SSL Certificate expiring: {{commonName}} expires {{expiresAt}}
```

### Servermonitor-advarsel-beskrivelse
```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**  
Memory Usage: **{{memoryUsagePercent}}%**  
First Disk Usage: **{{diskMetrics[0].usagePercent}}%**  
Last Check: {{requestReceivedAt}}
```

### Ping-monitor-advarsel-titel
```
Ping failed for target: {{failureCause}} ({{responseTimeInMs}}ms)
```

### Port-monitor-advarsel-beskrivelse
```
Port connectivity issue
Target port status: {{isOnline}}
Response time: {{responseTimeInMs}}ms
Failure cause: {{failureCause}}
```

### Syntetisk monitor-advarsel

Adgang til en specifik browser-/skærmstørrelse-kørsel via indeks:
```
First run: {{syntheticResponses[0].browserType}} / {{syntheticResponses[0].screenSizeType}}
Result: {{syntheticResponses[0].result}} in {{syntheticResponses[0].executionTimeInMs}}ms
```

Iterer over alle browser-/skærmstørrelse-kombinationer med `{{#each}}`:
```
### Synthetic Monitor Results
{{#each syntheticResponses}}
- **{{browserType}} / {{screenSizeType}}**: {{result}} in {{executionTimeInMs}}ms
  - Script error: {{scriptError}}
  - First log: {{logMessages[0]}}
{{/each}}
```

### Brugerdefineret kodemonitor-advarsel
```
Custom code execution: {{executionTimeInMs}}ms
Log output: {{logMessages[0]}}
```

### SNMP-monitor-advarsel-titel
```
SNMP device offline: {{failureCause}} ({{responseTimeInMs}}ms)
```

### SNMP-monitor-advarsel-beskrivelse
```
### SNMP Device Alert
Status: **{{isOnline}}**
Response Time: **{{responseTimeInMs}}ms**
System Uptime: {{sysUpTime}}
System Name: {{sysName}}
First OID Value: {{oidResponses[0].value}}
```

### Indgående anmodning med array-løkke (Grafana Webhook)

Titel:
```
[{{requestBody.status}}] {{requestBody.receiver}}
```

Beskrivelse:
```
### Alerts from {{requestBody.receiver}}

{{#each requestBody.alerts}}
**Alert {{@index}}**: {{labels.alertname}}
- Label: {{labels.label}}
- Status: {{status}}
- Values: {{valueString}}
- Source: {{generatorURL}}
{{/each}}
```

### Servermonitor med diskløkke

Beskrivelse:
```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**
Memory Usage: **{{memoryUsagePercent}}%**

**Disk Usage:**
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% used ({{freePercent}}% free)
{{/each}}

**Running Processes:**
{{#each processes}}
- [{{pid}}] {{name}}: {{command}}
{{/each}}
```

### SNMP-monitor med OID-løkke

Beskrivelse:
```
### SNMP Device Status
Online: {{isOnline}}
Response: {{responseTimeInMs}}ms

**OID Values:**
{{#each oidResponses}}
- {{name}} ({{oid}}): {{value}}
{{/each}}
```
