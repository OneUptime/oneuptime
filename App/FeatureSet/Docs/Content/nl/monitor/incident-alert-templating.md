# Dynamische sjablonen voor incidenten en meldingen

U kunt dezelfde `{{variabele}}`-plaatshouder-syntaxis die door JavaScript-expressies in monitorcriteria wordt gebruikt, ook gebruiken om Incident- en meldingstitel, -beschrijving en -herstelnotities dynamisch in te vullen wanneer deze automatisch worden aangemaakt vanuit monitorcriteria.

## Ondersteunde monitortypen en variabelen

De volgende monitortypen ondersteunen dynamische sjablonen met hun respectieve variabelen:

- **Website- en API-monitors**: Responsgegevens, headers, statuscodes, timing
- **Inkomend verzoek-monitors**: Verzoekgegevens, headers, methoden, timing
- **Ping-monitors**: Connectiviteitstatus, responstijden, oorzaken van mislukking
- **Poort-monitors**: Poortconnectiviteit, responstijden, time-outstatus
- **IP-monitors**: IP-bereikbaarheid, ping-tijden, foutinformatie
- **SSL-certificaat-monitors**: Certificaatdetails, validatiestatus, verloopinfo
- **Server/VM-monitors**: Systeemmetrics (CPU, geheugen, schijf), processen, hostnaam
- **Synthetische monitors**: Scriptuitvoerresultaten, schermafbeeldingen, browserdetails
- **Aangepaste JavaScript-code-monitors**: Uitvoerresultaten, timing, foutberichten
- **SNMP-monitors**: Apparaatstatus, responstijden, OID-waarden

> **Opmerking**: Logboeken-, Traces- en Metrics-monitors ondersteunen momenteel geen incident/melding-sjablonen omdat ze verschillende activeringsmechanismen gebruiken.

## Ondersteunde monitortypen en variabelen

### Website- en API-monitors

| Variabele            | Beschrijving                                                                 | Type                 |
| -------------------- | ---------------------------------------------------------------------------- | -------------------- |
| `responseBody`       | Het responslichaamobject. Als HTML/XML dan string. Als JSON dan JSON-object. | `string` of `JSON`   |
| `responseHeaders`    | Het responsheaderobject (sleutels in kleine letters).                        | `Dictionary<string>` |
| `responseStatusCode` | De HTTP-responsstatuscode.                                                   | `number`             |
| `responseTimeInMs`   | De responstijd in milliseconden.                                             | `number`             |
| `isOnline`           | Of de monitor als online wordt beschouwd.                                    | `boolean`            |

### Inkomend verzoek-monitors

| Variabele                   | Beschrijving                                                  | Type                 |
| --------------------------- | ------------------------------------------------------------- | -------------------- |
| `requestBody`               | Het verzoeklichaamobject.                                     | `string` of `JSON`   |
| `requestHeaders`            | Het verzoekheaderobject (sleutels in kleine letters).         | `Dictionary<string>` |
| `requestMethod`             | De HTTP-methode van het inkomende verzoek (GET, POST, enz.).  | `string`             |
| `incomingRequestReceivedAt` | De datum en tijd waarop het inkomende verzoek werd ontvangen. | `Date`               |

### Ping-monitors

| Variabele          | Beschrijving                                   | Type      |
| ------------------ | ---------------------------------------------- | --------- |
| `isOnline`         | Of het ping-doel als online wordt beschouwd.   | `boolean` |
| `responseTimeInMs` | De ping-responstijd in milliseconden.          | `number`  |
| `failureCause`     | De reden voor mislukking als de ping mislukte. | `string`  |
| `isTimeout`        | Of het ping-verzoek een time-out heeft.        | `boolean` |

### Poort-monitors

| Variabele          | Beschrijving                                            | Type      |
| ------------------ | ------------------------------------------------------- | --------- |
| `isOnline`         | Of de poort als online/bereikbaar wordt beschouwd.      | `boolean` |
| `responseTimeInMs` | De verbindingsresponstijd in milliseconden.             | `number`  |
| `failureCause`     | De reden voor mislukking als de poortcontrole mislukte. | `string`  |
| `isTimeout`        | Of de poortverbinding een time-out heeft.               | `boolean` |

### IP-monitors

| Variabele          | Beschrijving                                          | Type      |
| ------------------ | ----------------------------------------------------- | --------- |
| `isOnline`         | Of het IP-adres als online wordt beschouwd.           | `boolean` |
| `responseTimeInMs` | De ping-responstijd in milliseconden.                 | `number`  |
| `failureCause`     | De reden voor mislukking als de IP-controle mislukte. | `string`  |
| `isTimeout`        | Of het IP-ping-verzoek een time-out heeft.            | `boolean` |

### SSL-certificaat-monitors

| Variabele            | Beschrijving                                           | Type      |
| -------------------- | ------------------------------------------------------ | --------- |
| `isOnline`           | Of de SSL-certificaatcontrole succesvol was.           | `boolean` |
| `isSelfSigned`       | Of het SSL-certificaat zelfondertekend is.             | `boolean` |
| `createdAt`          | De datum waarop het SSL-certificaat is aangemaakt.     | `Date`    |
| `expiresAt`          | De datum waarop het SSL-certificaat verloopt.          | `Date`    |
| `commonName`         | De common name (CN) van het certificaat.               | `string`  |
| `organizationalUnit` | De organisatie-eenheid (OU) van het certificaat.       | `string`  |
| `organization`       | De organisatie (O) van het certificaat.                | `string`  |
| `locality`           | De plaats (L) van het certificaat.                     | `string`  |
| `state`              | De provincie/staat (ST) van het certificaat.           | `string`  |
| `country`            | Het land (C) van het certificaat.                      | `string`  |
| `serialNumber`       | Het serienummer van het certificaat.                   | `string`  |
| `fingerprint`        | De SHA-1 fingerprint van het certificaat.              | `string`  |
| `fingerprint256`     | De SHA-256 fingerprint van het certificaat.            | `string`  |
| `failureCause`       | De reden voor mislukking als de SSL-controle mislukte. | `string`  |

### Server/VM-monitors

| Variabele                    | Beschrijving                                                     | Type            |
| ---------------------------- | ---------------------------------------------------------------- | --------------- |
| `hostname`                   | De hostnaam van de bewaakte server.                              | `string`        |
| `requestReceivedAt`          | De datum en tijd waarop het servermonitorverzoek werd ontvangen. | `Date`          |
| `cpuUsagePercent`            | Het CPU-gebruikspercentage.                                      | `number`        |
| `cpuCores`                   | Het aantal CPU-cores.                                            | `number`        |
| `memoryUsagePercent`         | Het geheugengebruikspercentage.                                  | `number`        |
| `memoryFreePercent`          | Het vrije geheugenpercentage.                                    | `number`        |
| `memoryTotalBytes`           | Het totale geheugen in bytes.                                    | `number`        |
| `diskMetrics`                | Array van schijfmetrics voor alle gemounte schijven.             | `Array<Object>` |
| `diskMetrics[].diskPath`     | Het pad van het schijfkoppelpunt.                                | `string`        |
| `diskMetrics[].usagePercent` | Het schijfgebruikspercentage voor dit koppelpunt.                | `number`        |
| `diskMetrics[].freePercent`  | Het vrije schijfpercentage voor dit koppelpunt.                  | `number`        |
| `diskMetrics[].totalBytes`   | De totale schijfruimte in bytes voor dit koppelpunt.             | `number`        |
| `processes`                  | Array van actieve processen op de server.                        | `Array<Object>` |
| `processes[].pid`            | Het proces-ID.                                                   | `number`        |
| `processes[].name`           | De procesnaam.                                                   | `string`        |
| `processes[].command`        | De opdracht waarmee het proces is gestart.                       | `string`        |
| `failureCause`               | De reden voor mislukking als de servercontrole mislukte.         | `string`        |

### Synthetische monitors

Synthetische monitors voeren hetzelfde script uit op meerdere browsers (Chromium, Firefox, Webkit) en schermformaten (mobiel, tablet, desktop), waardoor één response per configuratie wordt geproduceerd. Elke uitvoering is toegankelijk via de `syntheticResponses`-array — toegang tot een specifieke uitvoering op index (`{{syntheticResponses[0].browserType}}`) of itereer met `{{#each syntheticResponses}}`.

| Variabele                                | Beschrijving                                                                                     | Type                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `failureCause`                           | De reden voor mislukking als de synthetische controle mislukte.                                  | `string`                                |
| `syntheticResponses`                     | Array met één vermelding per browser/schermformaat-combinatie waarop het script werd uitgevoerd. | `Array<Object>`                         |
| `syntheticResponses[].executionTimeInMs` | Uitvoeringstijd in milliseconden voor deze uitvoering.                                           | `number`                                |
| `syntheticResponses[].result`            | Het resultaat geretourneerd door deze uitvoering.                                                | `string`, `number`, `boolean` of `JSON` |
| `syntheticResponses[].scriptError`       | Eventuele fout die optrad tijdens deze uitvoering.                                               | `string`                                |
| `syntheticResponses[].logMessages`       | Logberichten gegenereerd tijdens deze uitvoering.                                                | `Array<string>`                         |
| `syntheticResponses[].screenshots`       | Schermafbeeldingen vastgelegd tijdens deze uitvoering.                                           | `Object`                                |
| `syntheticResponses[].browserType`       | Browser gebruikt voor deze uitvoering.                                                           | `string`                                |
| `syntheticResponses[].screenSizeType`    | Schermformaat gebruikt voor deze uitvoering.                                                     | `string`                                |

### Aangepaste JavaScript-code-monitors

| Variabele           | Beschrijving                                                                | Type                                    |
| ------------------- | --------------------------------------------------------------------------- | --------------------------------------- |
| `executionTimeInMs` | De tijd die nodig was om de aangepaste code uit te voeren in milliseconden. | `number`                                |
| `result`            | Het resultaat geretourneerd door de aangepaste code.                        | `string`, `number`, `boolean` of `JSON` |
| `scriptError`       | Eventuele fout die optrad tijdens code-uitvoering.                          | `string`                                |
| `logMessages`       | Array van logberichten gegenereerd tijdens uitvoering.                      | `Array<string>`                         |

### SNMP-monitors

| Variabele              | Beschrijving                                                    | Type                 |
| ---------------------- | --------------------------------------------------------------- | -------------------- |
| `isOnline`             | Of het SNMP-apparaat online is en reageert.                     | `boolean`            |
| `responseTimeInMs`     | De SNMP-opvraagresponstijd in milliseconden.                    | `number`             |
| `failureCause`         | De reden voor mislukking als de SNMP-opvraag mislukte.          | `string`             |
| `isTimeout`            | Of de SNMP-opvraag een time-out heeft.                          | `boolean`            |
| `oidResponses`         | Array van OID-responsobijecten met oid, naam, waarde en type.   | `Array<Object>`      |
| `oidResponses[].oid`   | De bevraagde OID.                                               | `string`             |
| `oidResponses[].name`  | De beschrijvende naam van de OID (indien opgegeven).            | `string`             |
| `oidResponses[].value` | De waarde geretourneerd door de OID.                            | `string` of `number` |
| `oidResponses[].type`  | Het SNMP-gegevenstype van de waarde.                            | `string`             |
| `{{OID_NAME}}`         | Directe toegang tot OID-waarde op naam (bijv. `{{sysUpTime}}`). | `string` of `number` |

## Basisgebruik

In het Incident/Melding-formulier binnen een Monitorcriteria-instantie kunt u schrijven:

```
API returned {{responseStatusCode}} in {{responseTimeInMs}}ms
```

Als de monitorresponsstatuscode `502` is en de tijd `842`, wordt de opgeslagen titel:

```
API returned 502 in 842ms
```

Geneste JSON-toegang werkt op dezelfde manier als JavaScript-expressies:

```
Problem ID: {{responseBody.error.id}}
Message: {{responseBody.error.message}}
```

Array-indexering wordt ondersteund:

```
First User: {{responseBody.users[0].name}}
```

Als een pad niet bestaat, wordt het standaard omgezet naar een lege tekenreeks.

## Geavanceerd gebruik

### Array-elementen openen

```
First disk usage: {{diskMetrics[0].usagePercent}}%
Last process: {{processes[-1].name}}
```

### Genest objecttoegang

```
Error message: {{responseBody.error.details.message}}
Server location: {{sslCertificate.locality}} {{sslCertificate.country}}
```

### Over arrays heen lopen met `{{#each}}`

U kunt over arrays itereren met de blokkensyntaxis `{{#each pad}}...{{/each}}`. Dit is nuttig wanneer de gegevens een lijst van items bevatten en u elk item in uw incident- of meldingsbeschrijving wilt opnemen.

**Syntaxis:**

```
{{#each arrayPath}}
  ...body using {{property}} from each element...
{{/each}}
```

Binnen de lustekst:

- `{{propertyNaam}}` wordt omgezet relatief aan het huidige array-element
- `{{genest.attribuut}}` puntnotatie-toegang werkt op het huidige element
- `{{@index}}` wordt omgezet naar de 0-gebaseerde index van de huidige iteratie
- `{{this}}` wordt omgezet naar de huidige elementwaarde (nuttig voor arrays van strings/getallen)
- Variabelen die niet op het huidige element worden gevonden, vallen terug op de bovenliggende opslagkaart

**Voorbeeld — Inkomend verzoek met array van meldingen (bijv. Grafana-webhooks):**

Als uw inkomend verzoeklichaam er als volgt uitziet:

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

U kunt een sjabloon schrijven zoals:

```
Alert Labels:
{{#each requestBody.alerts}}
- {{labels.label}} ({{status}})
{{/each}}
```

Wat het volgende produceert:

```
Alert Labels:
- Coralpay (firing)
- capitecpay (firing)
- capricorn (resolved)
```

**Voorbeeld — Serverschijfmetrics:**

```
Disk Usage:
{{#each diskMetrics}}
- {{diskPath}}: {{usagePercent}}% used
{{/each}}
```

**Voorbeeld — `{{@index}}` gebruiken:**

```
Processes:
{{#each processes}}
{{@index}}. {{name}} (PID: {{pid}})
{{/each}}
```

**Voorbeeld — Primitieve array met `{{this}}`:**

```
Log messages:
{{#each logMessages}}
- {{this}}
{{/each}}
```

**Voorbeeld — Geneste lussen:**

U kunt `{{#each}}`-blokken nesten voor arrays op meerdere niveaus:

```
{{#each requestBody.groups}}
Group: {{name}}
{{#each members}}
  - {{id}}: {{role}}
{{/each}}
{{/each}}
```

> **Opmerking**: Als het pad niet naar een array wordt omgezet, wordt het gehele `{{#each}}...{{/each}}`-blok verwijderd uit de uitvoer. Lege arrays produceren geen uitvoer voor het blok.

## Voorbeelden

### Website/API Monitor Incidenttitel

```
High latency: {{responseTimeInMs}}ms (> threshold)
```

### Website/API Monitor Incidentbeschrijving

```
### API Error
Status: **{{responseStatusCode}}**
Latency: **{{responseTimeInMs}}ms**
Body Snippet: `{{responseBody.error.message}}`
```

### Inkomend verzoek Meldingstitel

```
Bad inbound request: method={{requestMethod}} auth={{requestHeaders.authorization}}
```

### SSL-certificaat Meldingstitel

```
SSL Certificate expiring: {{commonName}} expires {{expiresAt}}
```

### Server Monitor Meldingsbeschrijving

```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**
Memory Usage: **{{memoryUsagePercent}}%**
First Disk Usage: **{{diskMetrics[0].usagePercent}}%**
Last Check: {{requestReceivedAt}}
```

### Ping Monitor Meldingstitel

```
Ping failed for target: {{failureCause}} ({{responseTimeInMs}}ms)
```

### Poort Monitor Meldingsbeschrijving

```
Port connectivity issue
Target port status: {{isOnline}}
Response time: {{responseTimeInMs}}ms
Failure cause: {{failureCause}}
```

### Synthetische Monitor Melding

Toegang tot een specifieke browser/schermformaat-uitvoering op index:

```
First run: {{syntheticResponses[0].browserType}} / {{syntheticResponses[0].screenSizeType}}
Result: {{syntheticResponses[0].result}} in {{syntheticResponses[0].executionTimeInMs}}ms
```

Itereer over elke browser/schermformaat-combinatie met `{{#each}}`:

```
### Synthetic Monitor Results
{{#each syntheticResponses}}
- **{{browserType}} / {{screenSizeType}}**: {{result}} in {{executionTimeInMs}}ms
  - Script error: {{scriptError}}
  - First log: {{logMessages[0]}}
{{/each}}
```

### Aangepaste code monitor Melding

```
Custom code execution: {{executionTimeInMs}}ms
Log output: {{logMessages[0]}}
```

### SNMP Monitor Meldingstitel

```
SNMP device offline: {{failureCause}} ({{responseTimeInMs}}ms)
```

### SNMP Monitor Meldingsbeschrijving

```
### SNMP Device Alert
Status: **{{isOnline}}**
Response Time: **{{responseTimeInMs}}ms**
System Uptime: {{sysUpTime}}
System Name: {{sysName}}
First OID Value: {{oidResponses[0].value}}
```

### Inkomend verzoek met Array-lus (Grafana Webhook)

Titel:

```
[{{requestBody.status}}] {{requestBody.receiver}}
```

Beschrijving:

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

### Server Monitor met Schijflus

Beschrijving:

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

### SNMP Monitor met OID-lus

Beschrijving:

```
### SNMP Device Status
Online: {{isOnline}}
Response: {{responseTimeInMs}}ms

**OID Values:**
{{#each oidResponses}}
- {{name}} ({{oid}}): {{value}}
{{/each}}
```
