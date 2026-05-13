# Dynamisk mallning för incident och varning

Du kan använda samma `{{variabel}}`-platshållarsyntax som används av JavaScript-uttryck i monitorkriteria för att dynamiskt fylla i Incident- och Varnings-titel, beskrivning och åtgärdsnot när de skapas automatiskt från monitorkriteria.

## Monitoryper och variabler som stöds

Följande monitortyper stöder dynamisk mallning med respektive variabler:

- **Webbplats- och API-monitorer**: Svarsdata, huvuden, statuskoder, timing
- **Inkommande förfrågningsmonitorer**: Förfrågningsdata, huvuden, metoder, timing
- **Ping-monitorer**: Anslutningsstatus, svarstider, felorsaker
- **Portmonitorer**: Portanslutning, svarstider, timeoutstatus
- **IP-monitorer**: IP-nåbarhet, pingtider, felinformation
- **SSL-certifikatmonitorer**: Certifikatdetaljer, valideringsstatus, utgångsinformation
- **Server/VM-monitorer**: Systemmätvärden (CPU, minne, disk), processer, värdnamn
- **Syntetiska monitorer**: Skriptexekveringsresultat, skärmdumpar, webbläsardetaljer
- **Anpassade JavaScript-kodmonitorer**: Exekveringsresultat, timing, felmeddelanden
- **SNMP-monitorer**: Enhetsstatus, svarstider, OID-värden

> **Observera**: Loggar, spårningar och mätvärdesmonitorer stöder för närvarande inte incident-/varnings-mallning eftersom de använder olika utlösarmekanismer.

## Monitortyper och variabler som stöds

### Webbplats- och API-monitorer

| Variabel | Beskrivning | Typ |
| --- | --- | --- |
| `responseBody` | Svarsinnehållets objekt. Om HTML/XML är det en sträng. Om JSON är det ett JSON-objekt. | `string` eller `JSON` |
| `responseHeaders` | Svarshuvudenas objekt (nycklar med gemener). | `Dictionary<string>` |
| `responseStatusCode` | HTTP-svarets statuskod. | `number` |
| `responseTimeInMs` | Svarstiden i millisekunder. | `number` |
| `isOnline` | Om monitorn anses vara online. | `boolean` |

### Inkommande förfrågningsmonitorer

| Variabel | Beskrivning | Typ |
| --- | --- | --- |
| `requestBody` | Förfrågningsinnehållets objekt. | `string` eller `JSON` |
| `requestHeaders` | Förfrågningshuvudenas objekt (nycklar med gemener). | `Dictionary<string>` |
| `requestMethod` | HTTP-metoden för den inkommande förfrågan (GET, POST etc.). | `string` |
| `incomingRequestReceivedAt` | Datum och tid när den inkommande förfrågan togs emot. | `Date` |

### Ping-monitorer

| Variabel | Beskrivning | Typ |
| --- | --- | --- |
| `isOnline` | Om ping-målet anses vara online. | `boolean` |
| `responseTimeInMs` | Ping-svarstiden i millisekunder. | `number` |
| `failureCause` | Orsaken till felet om ping misslyckades. | `string` |
| `isTimeout` | Om ping-förfrågan fick timeout. | `boolean` |

### Portmonitorer

| Variabel | Beskrivning | Typ |
| --- | --- | --- |
| `isOnline` | Om porten anses vara online/tillgänglig. | `boolean` |
| `responseTimeInMs` | Anslutningstiden i millisekunder. | `number` |
| `failureCause` | Orsaken till felet om portkontrollenl misslyckades. | `string` |
| `isTimeout` | Om portanslutningen fick timeout. | `boolean` |

### IP-monitorer

| Variabel | Beskrivning | Typ |
| --- | --- | --- |
| `isOnline` | Om IP-adressen anses vara online. | `boolean` |
| `responseTimeInMs` | Ping-svarstiden i millisekunder. | `number` |
| `failureCause` | Orsaken till felet om IP-kontrollen misslyckades. | `string` |
| `isTimeout` | Om IP-ping-förfrågan fick timeout. | `boolean` |

### SSL-certifikatmonitorer

| Variabel | Beskrivning | Typ |
| --- | --- | --- |
| `isOnline` | Om SSL-certifikatkontrollen lyckades. | `boolean` |
| `isSelfSigned` | Om SSL-certifikatet är självsignerat. | `boolean` |
| `createdAt` | Datumet när SSL-certifikatet skapades. | `Date` |
| `expiresAt` | Datumet när SSL-certifikatet löper ut. | `Date` |
| `commonName` | Vanligt namn (CN) från certifikatet. | `string` |
| `organizationalUnit` | Organisationsenhet (OU) från certifikatet. | `string` |
| `organization` | Organisation (O) från certifikatet. | `string` |
| `locality` | Ort (L) från certifikatet. | `string` |
| `state` | Stat/region (ST) från certifikatet. | `string` |
| `country` | Land (C) från certifikatet. | `string` |
| `serialNumber` | Certifikatets serienummer. | `string` |
| `fingerprint` | SHA-1-fingeravtrycket för certifikatet. | `string` |
| `fingerprint256` | SHA-256-fingeravtrycket för certifikatet. | `string` |
| `failureCause` | Orsaken till felet om SSL-kontrollen misslyckades. | `string` |

### Server/VM-monitorer

| Variabel | Beskrivning | Typ |
| --- | --- | --- |
| `hostname` | Värdnamnet för den övervakade servern. | `string` |
| `requestReceivedAt` | Datum och tid när servermonitorns förfrågan togs emot. | `Date` |
| `cpuUsagePercent` | CPU-användningsprocentens. | `number` |
| `cpuCores` | Antalet CPU-kärnor. | `number` |
| `memoryUsagePercent` | Minnesanvändningsprocentens. | `number` |
| `memoryFreePercent` | Ledigt minnesprocentens. | `number` |
| `memoryTotalBytes` | Totalt minne i bytes. | `number` |
| `diskMetrics` | Array med diskmätvärden för alla monterade diskar. | `Array<Object>` |
| `diskMetrics[].diskPath` | Sökvägen till diskmonteringspunkten. | `string` |
| `diskMetrics[].usagePercent` | Diskanvändningsprocentens för denna monteringspunkt. | `number` |
| `diskMetrics[].freePercent` | Ledigt diskutrymme i procent för denna monteringspunkt. | `number` |
| `diskMetrics[].totalBytes` | Totalt diskutrymme i bytes för denna monteringspunkt. | `number` |
| `processes` | Array med körande processer på servern. | `Array<Object>` |
| `processes[].pid` | Process-ID:t. | `number` |
| `processes[].name` | Processnamnet. | `string` |
| `processes[].command` | Kommandot som användes för att starta processen. | `string` |
| `failureCause` | Orsaken till felet om serverkontrollen misslyckades. | `string` |

### Syntetiska monitorer

Syntetiska monitorer kör samma skript på flera webbläsare (Chromium, Firefox, Webkit) och skärmstorlekar (mobil, surfplatta, skrivbord), vilket producerar ett svar per konfiguration. Varje körning exponeras via arrayen `syntheticResponses` – åtkomst till en specifik körning med index (`{{syntheticResponses[0].browserType}}`) eller iterera med `{{#each syntheticResponses}}`.

| Variabel | Beskrivning | Typ |
| --- | --- | --- |
| `failureCause` | Orsaken till felet om den syntetiska kontrollen misslyckades. | `string` |
| `syntheticResponses` | Array med en post per webbläsar-/skärmstorlek-kombination som skriptet körde mot. | `Array<Object>` |
| `syntheticResponses[].executionTimeInMs` | Exekveringstid i millisekunder för denna körning. | `number` |
| `syntheticResponses[].result` | Resultatet som returnerades av denna körning. | `string`, `number`, `boolean` eller `JSON` |
| `syntheticResponses[].scriptError` | Eventuellt fel som inträffade under denna körning. | `string` |
| `syntheticResponses[].logMessages` | Loggmeddelanden genererade under denna körning. | `Array<string>` |
| `syntheticResponses[].screenshots` | Skärmdumpar tagna under denna körning. | `Object` |
| `syntheticResponses[].browserType` | Webbläsaren som användes för denna körning. | `string` |
| `syntheticResponses[].screenSizeType` | Skärmstorlek som användes för denna körning. | `string` |

### Anpassade JavaScript-kodmonitorer

| Variabel | Beskrivning | Typ |
| --- | --- | --- |
| `executionTimeInMs` | Tid det tog att exekvera den anpassade koden i millisekunder. | `number` |
| `result` | Resultatet som returnerades av den anpassade koden. | `string`, `number`, `boolean` eller `JSON` |
| `scriptError` | Eventuellt fel som inträffade under kodexekvering. | `string` |
| `logMessages` | Array med loggmeddelanden genererade under exekvering. | `Array<string>` |

### SNMP-monitorer

| Variabel | Beskrivning | Typ |
| --- | --- | --- |
| `isOnline` | Om SNMP-enheten är online och svarar. | `boolean` |
| `responseTimeInMs` | SNMP-frågans svarstid i millisekunder. | `number` |
| `failureCause` | Orsaken till felet om SNMP-frågan misslyckades. | `string` |
| `isTimeout` | Om SNMP-frågan fick timeout. | `boolean` |
| `oidResponses` | Array med OID-svarsobjekt med oid, name, value och type. | `Array<Object>` |
| `oidResponses[].oid` | OID:en som frågades. | `string` |
| `oidResponses[].name` | Det läsvänliga namnet på OID:en (om angivet). | `string` |
| `oidResponses[].value` | Värdet som returnerades av OID:en. | `string` eller `number` |
| `oidResponses[].type` | SNMP-datatypen för värdet. | `string` |
| `{{OID_NAME}}` | Direkt åtkomst till OID-värde efter namn (t.ex. `{{sysUpTime}}`). | `string` eller `number` |


## Grundläggande användning

I formuläret för Incident/Varning inuti en monitorkriterie-instans kan du skriva:

```
API returned {{responseStatusCode}} in {{responseTimeInMs}}ms
```

Om monitorns svarsstatuskod är `502` och tid är `842`, blir den lagrade titeln:

```
API returned 502 in 842ms
```

Nästlad JSON-åtkomst fungerar på samma sätt som JavaScript-uttryck:

```
Problem ID: {{responseBody.error.id}}
Message: {{responseBody.error.message}}
```

Array-indexering stöds:

```
First User: {{responseBody.users[0].name}}
```

Om en sökväg inte finns löser den upp till en tom sträng som standard.

## Avancerad användning

### Åtkomst till arrayelement
```
First disk usage: {{diskMetrics[0].usagePercent}}%
Last process: {{processes[-1].name}}
```

### Nästlad objektåtkomst
```
Error message: {{responseBody.error.details.message}}
Server location: {{sslCertificate.locality}} {{sslCertificate.country}}
```

### Loopar över arrayer med `{{#each}}`

Du kan iterera över arrayer med syntaxen `{{#each path}}...{{/each}}`. Detta är användbart när data innehåller en lista med objekt och du vill inkludera varje objekt i din incident- eller varningsbeskrivning.

**Syntax:**
```
{{#each arrayPath}}
  ...body using {{property}} from each element...
{{/each}}
```

Inuti loopkroppen:
- `{{propertyName}}` löser upp relativt till det aktuella arrayelementet
- `{{nested.property}}` punkt-notation fungerar på det aktuella elementet
- `{{@index}}` löser upp till det 0-baserade indexet för den aktuella iterationen
- `{{this}}` löser upp till det aktuella elementvärdet (användbart för arrayer av strängar/nummer)
- Variabler som inte finns på det aktuella elementet faller tillbaka till den överordnade lagringskartant

**Exempel – Inkommande förfrågan med array av varningar (t.ex. Grafana webhooks):**

Om din inkommande förfrågans innehåll ser ut så här:
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

Kan du skriva en mall som:
```
Alert Labels:
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

Vilket producerar:
```
Alert Labels:
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**Exempel – Server diskmätvärden:**
```
Disk Usage:
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% used
{{/each}}
```

**Exempel – Använda `{{@index}}`:**
```
Processes:
{{#each processes}}
{{@index}}. {{name}} (PID: {{pid}})
{{/each}}
```

> **Observera**: Om sökvägen inte löser upp till en array tas hela `{{#each}}...{{/each}}`-blocket bort från utdatan. Tomma arrayer producerar ingen utdata för blocket.


## Exempel

### Incidenttitel för webbplats/API-monitor
```
High latency: {{responseTimeInMs}}ms (> threshold)
```

### Incidentbeskrivning för webbplats/API-monitor
```
### API Error
Status: **{{responseStatusCode}}**  
Latency: **{{responseTimeInMs}}ms**  
Body Snippet: `{{responseBody.error.message}}`
```

### Varnings-titel för inkommande förfrågan
```
Bad inbound request: method={{requestMethod}} auth={{requestHeaders.authorization}}
```

### Varnings-titel för SSL-certifikat
```
SSL Certificate expiring: {{commonName}} expires {{expiresAt}}
```

### Varningsbeskrivning för servermonitor
```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**  
Memory Usage: **{{memoryUsagePercent}}%**  
First Disk Usage: **{{diskMetrics[0].usagePercent}}%**  
Last Check: {{requestReceivedAt}}
```

### Varnings-titel för ping-monitor
```
Ping failed for target: {{failureCause}} ({{responseTimeInMs}}ms)
```

### Varnings-titel för SNMP-monitor
```
SNMP device offline: {{failureCause}} ({{responseTimeInMs}}ms)
```
