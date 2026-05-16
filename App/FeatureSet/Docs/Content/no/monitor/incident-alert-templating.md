# Dynamisk maling for hendelser og varsler

Du kan bruke den samme `{{variabel}}`-plassholdersyntaksen som brukes av JavaScript-uttrykk i monitorkriterer for å dynamisk fylle ut Hendelse- og Varsel-tittel, -beskrivelse og -utbedringsnotater når de opprettes automatisk fra monitorkriterier.

## Støttede monitortyper og variabler

Følgende monitortyper støtter dynamisk maling med sine respektive variabler:

- **Nettsted- og API-monitorer**: Svardata, hoder, statuskoder, tidsregistrering
- **Innkommende forespørselsmonitorer**: Forespørselsdata, hoder, metoder, tidsregistrering
- **Ping-monitorer**: Tilkoblingsstatus, svartider, feilårsaker
- **Port-monitorer**: Porttilkobling, svartider, tidsavbruddsstatus
- **IP-monitorer**: IP-tilgjengelighet, ping-tider, feilinformasjon
- **SSL-sertifikatmonitorer**: Sertifikatdetaljer, valideringsstatus, utløpsinformasjon
- **Server/VM-monitorer**: Systemmålinger (CPU, minne, disk), prosesser, vertsnavn
- **Syntetiske monitorer**: Skriptkjøringsresultater, skjermbilder, nettleserdetaljer
- **Egendefinerte JavaScript-kode-monitorer**: Kjøringsresultater, tidsregistrering, feilmeldinger
- **SNMP-monitorer**: Enhetsstatus, svartider, OID-verdier

> **Merk**: Logg-, spor- og metrikk-monitorer støtter for øyeblikket ikke hendelse/varsel-maling, da de bruker andre utløsermekanismer.

## Støttede monitortyper og variabler

### Nettsted- og API-monitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `responseBody` | Svarlegemsobjektet. Hvis HTML/XML, da streng. Hvis JSON, da JSON-objekt. | `string` eller `JSON` |
| `responseHeaders` | Svarhodeobjektet (nøkler med små bokstaver). | `Dictionary<string>` |
| `responseStatusCode` | HTTP-svarstatuskoden. | `number` |
| `responseTimeInMs` | Svartiden i millisekunder. | `number` |
| `isOnline` | Om monitoren anses som tilgjengelig. | `boolean` |

### Innkommende forespørselsmonitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `requestBody` | Forespørselslegemsobjektet. | `string` eller `JSON` |
| `requestHeaders` | Forespørselshodeobjektet (nøkler med små bokstaver). | `Dictionary<string>` |
| `requestMethod` | HTTP-metoden for den innkommende forespørselen (GET, POST, osv.). | `string` |
| `incomingRequestReceivedAt` | Dato og klokkeslett da den innkommende forespørselen ble mottatt. | `Date` |

### Ping-monitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `isOnline` | Om ping-målet anses som tilgjengelig. | `boolean` |
| `responseTimeInMs` | Ping-svartiden i millisekunder. | `number` |
| `failureCause` | Årsaken til feilen hvis ping-en mislyktes. | `string` |
| `isTimeout` | Om ping-forespørselen fikk tidsavbrudd. | `boolean` |

### Port-monitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `isOnline` | Om porten anses som tilgjengelig/tilgjengelig. | `boolean` |
| `responseTimeInMs` | Tilkoblingens svartid i millisekunder. | `number` |
| `failureCause` | Årsaken til feilen hvis portsjekken mislyktes. | `string` |
| `isTimeout` | Om porttilkoblingen fikk tidsavbrudd. | `boolean` |

### IP-monitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `isOnline` | Om IP-adressen anses som tilgjengelig. | `boolean` |
| `responseTimeInMs` | Ping-svartiden i millisekunder. | `number` |
| `failureCause` | Årsaken til feilen hvis IP-sjekken mislyktes. | `string` |
| `isTimeout` | Om IP-ping-forespørselen fikk tidsavbrudd. | `boolean` |

### SSL-sertifikatmonitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `isOnline` | Om SSL-sertifikatsjekken var vellykket. | `boolean` |
| `isSelfSigned` | Om SSL-sertifikatet er selvsignert. | `boolean` |
| `createdAt` | Datoen da SSL-sertifikatet ble opprettet. | `Date` |
| `expiresAt` | Datoen da SSL-sertifikatet utløper. | `Date` |
| `commonName` | Det vanlige navnet (CN) fra sertifikatet. | `string` |
| `organizationalUnit` | Organisasjonsenheten (OU) fra sertifikatet. | `string` |
| `organization` | Organisasjonen (O) fra sertifikatet. | `string` |
| `locality` | Lokaliteten (L) fra sertifikatet. | `string` |
| `state` | Staten/provinsen (ST) fra sertifikatet. | `string` |
| `country` | Landet (C) fra sertifikatet. | `string` |
| `serialNumber` | Serienummeret til sertifikatet. | `string` |
| `fingerprint` | SHA-1-fingeravtrykket til sertifikatet. | `string` |
| `fingerprint256` | SHA-256-fingeravtrykket til sertifikatet. | `string` |
| `failureCause` | Årsaken til feilen hvis SSL-sjekken mislyktes. | `string` |

### Server/VM-monitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `hostname` | Vertsnavnet til den overvåkede serveren. | `string` |
| `requestReceivedAt` | Dato og klokkeslett da servermonitorforespørselen ble mottatt. | `Date` |
| `cpuUsagePercent` | CPU-bruksprosenten. | `number` |
| `cpuCores` | Antall CPU-kjerner. | `number` |
| `memoryUsagePercent` | Minnebruksprosenten. | `number` |
| `memoryFreePercent` | Den ledige minneprosenten. | `number` |
| `memoryTotalBytes` | Totalt minne i byte. | `number` |
| `diskMetrics` | Array med diskmålinger for alle monterte disker. | `Array<Object>` |
| `diskMetrics[].diskPath` | Stien til diskens monteringspunkt. | `string` |
| `diskMetrics[].usagePercent` | Diskbruksprosenten for dette monteringspunktet. | `number` |
| `diskMetrics[].freePercent` | Den ledige diskprosenten for dette monteringspunktet. | `number` |
| `diskMetrics[].totalBytes` | Total diskplass i byte for dette monteringspunktet. | `number` |
| `processes` | Array med kjørende prosesser på serveren. | `Array<Object>` |
| `processes[].pid` | Prosess-ID-en. | `number` |
| `processes[].name` | Prosessnavnet. | `string` |
| `processes[].command` | Kommandoen som ble brukt til å starte prosessen. | `string` |
| `failureCause` | Årsaken til feilen hvis serversjekken mislyktes. | `string` |

### Syntetiske monitorer

Syntetiske monitorer kjører det samme skriptet på tvers av flere nettlesere (Chromium, Firefox, Webkit) og skjermstørrelser (mobil, nettbrett, stasjonær), og produserer ett svar per konfigurasjon. Hvert kjøring eksponeres gjennom `syntheticResponses`-arrayen – få tilgang til et spesifikt kjøring etter indeks (`{{syntheticResponses[0].browserType}}`) eller iterer med `{{#each syntheticResponses}}`.

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `failureCause` | Årsaken til feilen hvis den syntetiske sjekken mislyktes. | `string` |
| `syntheticResponses` | Array med én oppføring per nettleser/skjermstørrelseskombinasjon skriptet kjørte mot. | `Array<Object>` |
| `syntheticResponses[].executionTimeInMs` | Kjøringstid i millisekunder for dette kjøringen. | `number` |
| `syntheticResponses[].result` | Resultatet returnert av dette kjøringen. | `string`, `number`, `boolean` eller `JSON` |
| `syntheticResponses[].scriptError` | Eventuelle feil som oppstod under dette kjøringen. | `string` |
| `syntheticResponses[].logMessages` | Loggmeldinger generert under dette kjøringen. | `Array<string>` |
| `syntheticResponses[].screenshots` | Skjermbilder tatt under dette kjøringen. | `Object` |
| `syntheticResponses[].browserType` | Nettleser brukt for dette kjøringen. | `string` |
| `syntheticResponses[].screenSizeType` | Skjermstørrelse brukt for dette kjøringen. | `string` |

### Egendefinerte JavaScript-kode-monitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `executionTimeInMs` | Tiden det tok å kjøre den egendefinerte koden i millisekunder. | `number` |
| `result` | Resultatet returnert av den egendefinerte koden. | `string`, `number`, `boolean` eller `JSON` |
| `scriptError` | Eventuelle feil som oppstod under kodekjøringen. | `string` |
| `logMessages` | Array med loggmeldinger generert under kjøringen. | `Array<string>` |

### SNMP-monitorer

| Variabel | Beskrivelse | Type |
| --- | --- | --- |
| `isOnline` | Om SNMP-enheten er tilgjengelig og svarer. | `boolean` |
| `responseTimeInMs` | SNMP-spørringens svartid i millisekunder. | `number` |
| `failureCause` | Årsaken til feilen hvis SNMP-spørringen mislyktes. | `string` |
| `isTimeout` | Om SNMP-spørringen fikk tidsavbrudd. | `boolean` |
| `oidResponses` | Array med OID-responsobjekter med oid, navn, verdi og type. | `Array<Object>` |
| `oidResponses[].oid` | OID-en som ble spurt. | `string` |
| `oidResponses[].name` | Det vennlige navnet til OID-en (hvis angitt). | `string` |
| `oidResponses[].value` | Verdien returnert av OID-en. | `string` eller `number` |
| `oidResponses[].type` | SNMP-datatypen til verdien. | `string` |
| `{{OID_NAME}}` | Direkte tilgang til OID-verdi etter navn (f.eks. `{{sysUpTime}}`). | `string` eller `number` |


## Grunnleggende bruk

I Hendelse/Varsel-skjemaet inne i en Monitor Criteria-instans kan du skrive:

```
API returned {{responseStatusCode}} in {{responseTimeInMs}}ms
```

Hvis monitorens svarstatuskode er `502` og tid er `842`, blir den lagrede tittelen:

```
API returned 502 in 842ms
```

Nestet JSON-tilgang fungerer på samme måte som JavaScript-uttrykk:

```
Problem ID: {{responseBody.error.id}}
Message: {{responseBody.error.message}}
```

Array-indeksering støttes:

```
First User: {{responseBody.users[0].name}}
```

Hvis en sti ikke eksisterer, løses den til en tom streng som standard.

## Avansert bruk

### Tilgang til array-elementer
```
First disk usage: {{diskMetrics[0].usagePercent}}%
Last process: {{processes[-1].name}}
```

### Nestet objekttilgang
```
Error message: {{responseBody.error.details.message}}
Server location: {{sslCertificate.locality}} {{sslCertificate.country}}
```

### Løkke over arrays med `{{#each}}`

Du kan iterere over arrays ved hjelp av blokksyntaksen `{{#each sti}}...{{/each}}`. Dette er nyttig når dataene inneholder en liste med elementer og du ønsker å inkludere hvert av dem i hendelse- eller varselbeskrivelsen.

**Syntaks:**
```
{{#each arrayPath}}
  ...innhold som bruker {{egenskap}} fra hvert element...
{{/each}}
```

Inne i løkkekroppen:
- `{{egenskapsnavn}}` løses relativt til gjeldende array-element
- `{{nestet.egenskap}}` punktnotasjon fungerer på gjeldende element
- `{{@index}}` løses til 0-basert indeks for gjeldende iterasjon
- `{{this}}` løses til gjeldende elementverdi (nyttig for arrays av strenger/tall)
- Variabler som ikke finnes på gjeldende element faller tilbake til det overordnede lagringskartet

**Eksempel – Innkommende forespørsel med array av varsler (f.eks. Grafana-webhooks):**

Hvis innkommende forespørselskropp ser slik ut:
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

Du kan skrive en mal som:
```
Alert Labels:
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

Som produserer:
```
Alert Labels:
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**Eksempel – Diskmålinger for server:**
```
Disk Usage:
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% used
{{/each}}
```

**Eksempel – Bruk av `{{@index}}`:**
```
Processes:
{{#each processes}}
{{@index}}. {{name}} (PID: {{pid}})
{{/each}}
```

**Eksempel – Primitiv array med `{{this}}`:**
```
Log messages:
{{#each logMessages}}
- {{this}}
{{/each}}
```

**Eksempel – Nestede løkker:**

Du kan neste `{{#each}}`-blokker for flernivå-arrays:
```
{{#each requestBody.groups}}
Group: {{name}}
{{#each members}}
  - {{id}}: {{role}}
{{/each}}
{{/each}}
```

> **Merk**: Hvis stien ikke løses til en array, fjernes hele `{{#each}}...{{/each}}`-blokken fra utdataene. Tomme arrays produserer ingen utdata for blokken.


## Eksempler

### Nettsted/API-monitor – hendelsestittel
```
High latency: {{responseTimeInMs}}ms (> threshold)
```

### Nettsted/API-monitor – hendelsesbeskrivelse
```
### API Error
Status: **{{responseStatusCode}}**  
Latency: **{{responseTimeInMs}}ms**  
Body Snippet: `{{responseBody.error.message}}`
```

### Innkommende forespørsel – varseltittel
```
Bad inbound request: method={{requestMethod}} auth={{requestHeaders.authorization}}
```

### SSL-sertifikat – varseltittel
```
SSL Certificate expiring: {{commonName}} expires {{expiresAt}}
```

### Server-monitor – varselbeskrivelse
```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**  
Memory Usage: **{{memoryUsagePercent}}%**  
First Disk Usage: **{{diskMetrics[0].usagePercent}}%**  
Last Check: {{requestReceivedAt}}
```

### Ping-monitor – varseltittel
```
Ping failed for target: {{failureCause}} ({{responseTimeInMs}}ms)
```

### Port-monitor – varselbeskrivelse
```
Port connectivity issue
Target port status: {{isOnline}}
Response time: {{responseTimeInMs}}ms
Failure cause: {{failureCause}}
```

### Syntetisk monitor – varsel

Tilgang til et spesifikt nettleser/skjermstørrelses-kjøring etter indeks:
```
First run: {{syntheticResponses[0].browserType}} / {{syntheticResponses[0].screenSizeType}}
Result: {{syntheticResponses[0].result}} in {{syntheticResponses[0].executionTimeInMs}}ms
```

Iterer over hver nettleser/skjermstørrelseskombinasjon med `{{#each}}`:
```
### Synthetic Monitor Results
{{#each syntheticResponses}}
- **{{browserType}} / {{screenSizeType}}**: {{result}} in {{executionTimeInMs}}ms
  - Script error: {{scriptError}}
  - First log: {{logMessages[0]}}
{{/each}}
```

### Egendefinert kode-monitor – varsel
```
Custom code execution: {{executionTimeInMs}}ms
Log output: {{logMessages[0]}}
```

### SNMP-monitor – varseltittel
```
SNMP device offline: {{failureCause}} ({{responseTimeInMs}}ms)
```

### SNMP-monitor – varselbeskrivelse
```
### SNMP Device Alert
Status: **{{isOnline}}**
Response Time: **{{responseTimeInMs}}ms**
System Uptime: {{sysUpTime}}
System Name: {{sysName}}
First OID Value: {{oidResponses[0].value}}
```

### Innkommende forespørsel med array-løkke (Grafana Webhook)

Tittel:
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

### Server-monitor med diskløkke

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
