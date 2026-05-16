# Dynamische Incident- & Benachrichtigungsvorlagen

Sie können dieselbe `{{variable}}`-Platzhaltersyntax, die von JavaScript-Ausdrücken in Monitor-Kriterien verwendet wird, nutzen, um Incident- und Benachrichtigungstitel, -beschreibungen und Behebungsnotizen dynamisch zu befüllen, wenn diese automatisch aus Monitor-Kriterien erstellt werden.

## Unterstützte Monitortypen & Variablen

Die folgenden Monitortypen unterstützen dynamisches Templating mit ihren jeweiligen Variablen:

- **Website- und API-Monitore**: Antwortdaten, Header, Statuscodes, Timing
- **Eingehende Anfrage-Monitore**: Anfragedaten, Header, Methoden, Timing
- **Ping-Monitore**: Konnektivitätsstatus, Antwortzeiten, Fehlerursachen
- **Port-Monitore**: Port-Konnektivität, Antwortzeiten, Timeout-Status
- **IP-Monitore**: IP-Erreichbarkeit, Ping-Zeiten, Fehlerinformationen
- **SSL-Zertifikat-Monitore**: Zertifikatdetails, Validierungsstatus, Ablaufinformationen
- **Server/VM-Monitore**: Systemmetriken (CPU, Arbeitsspeicher, Festplatte), Prozesse, Hostname
- **Synthetische Monitore**: Skript-Ausführungsergebnisse, Screenshots, Browser-Details
- **Benutzerdefinierte JavaScript-Code-Monitore**: Ausführungsergebnisse, Timing, Fehlermeldungen
- **SNMP-Monitore**: Gerätestatus, Antwortzeiten, OID-Werte

> **Hinweis**: Logs-, Traces- und Metrics-Monitore unterstützen derzeit kein Incident-/Benachrichtigungs-Templating, da sie andere Auslösemechanismen verwenden.

## Unterstützte Monitortypen & Variablen

### Website- und API-Monitore

| Variable | Beschreibung | Typ |
| --- | --- | --- |
| `responseBody` | Das Antworttextobjekt. Bei HTML/XML eine Zeichenkette. Bei JSON ein JSON-Objekt. | `string` oder `JSON` |
| `responseHeaders` | Das Antwort-Header-Objekt (Schlüssel in Kleinbuchstaben). | `Dictionary<string>` |
| `responseStatusCode` | Der HTTP-Antwortstatuscode. | `number` |
| `responseTimeInMs` | Die Antwortzeit in Millisekunden. | `number` |
| `isOnline` | Ob der Monitor als online gilt. | `boolean` |

### Eingehende Anfrage-Monitore

| Variable | Beschreibung | Typ |
| --- | --- | --- |
| `requestBody` | Das Anfragetextobjekt. | `string` oder `JSON` |
| `requestHeaders` | Das Anfrage-Header-Objekt (Schlüssel in Kleinbuchstaben). | `Dictionary<string>` |
| `requestMethod` | Die HTTP-Methode der eingehenden Anfrage (GET, POST usw.). | `string` |
| `incomingRequestReceivedAt` | Datum und Uhrzeit des Eingangs der eingehenden Anfrage. | `Date` |

### Ping-Monitore

| Variable | Beschreibung | Typ |
| --- | --- | --- |
| `isOnline` | Ob das Ping-Ziel als online gilt. | `boolean` |
| `responseTimeInMs` | Die Ping-Antwortzeit in Millisekunden. | `number` |
| `failureCause` | Die Fehlerursache, wenn der Ping fehlgeschlagen ist. | `string` |
| `isTimeout` | Ob die Ping-Anfrage ein Timeout hatte. | `boolean` |

### Port-Monitore

| Variable | Beschreibung | Typ |
| --- | --- | --- |
| `isOnline` | Ob der Port als online/erreichbar gilt. | `boolean` |
| `responseTimeInMs` | Die Verbindungsantwortzeit in Millisekunden. | `number` |
| `failureCause` | Die Fehlerursache, wenn die Port-Prüfung fehlgeschlagen ist. | `string` |
| `isTimeout` | Ob die Port-Verbindung ein Timeout hatte. | `boolean` |

### IP-Monitore

| Variable | Beschreibung | Typ |
| --- | --- | --- |
| `isOnline` | Ob die IP-Adresse als online gilt. | `boolean` |
| `responseTimeInMs` | Die Ping-Antwortzeit in Millisekunden. | `number` |
| `failureCause` | Die Fehlerursache, wenn die IP-Prüfung fehlgeschlagen ist. | `string` |
| `isTimeout` | Ob die IP-Ping-Anfrage ein Timeout hatte. | `boolean` |

### SSL-Zertifikat-Monitore

| Variable | Beschreibung | Typ |
| --- | --- | --- |
| `isOnline` | Ob die SSL-Zertifikatsprüfung erfolgreich war. | `boolean` |
| `isSelfSigned` | Ob das SSL-Zertifikat selbst signiert ist. | `boolean` |
| `createdAt` | Das Erstellungsdatum des SSL-Zertifikats. | `Date` |
| `expiresAt` | Das Ablaufdatum des SSL-Zertifikats. | `Date` |
| `commonName` | Der Common Name (CN) aus dem Zertifikat. | `string` |
| `organizationalUnit` | Die Organizational Unit (OU) aus dem Zertifikat. | `string` |
| `organization` | Die Organization (O) aus dem Zertifikat. | `string` |
| `locality` | Die Locality (L) aus dem Zertifikat. | `string` |
| `state` | Das Bundesland/die Provinz (ST) aus dem Zertifikat. | `string` |
| `country` | Das Land (C) aus dem Zertifikat. | `string` |
| `serialNumber` | Die Seriennummer des Zertifikats. | `string` |
| `fingerprint` | Der SHA-1-Fingerabdruck des Zertifikats. | `string` |
| `fingerprint256` | Der SHA-256-Fingerabdruck des Zertifikats. | `string` |
| `failureCause` | Die Fehlerursache, wenn die SSL-Prüfung fehlgeschlagen ist. | `string` |

### Server/VM-Monitore

| Variable | Beschreibung | Typ |
| --- | --- | --- |
| `hostname` | Der Hostname des überwachten Servers. | `string` |
| `requestReceivedAt` | Datum und Uhrzeit des Eingangs der Server-Monitor-Anfrage. | `Date` |
| `cpuUsagePercent` | Die CPU-Auslastung in Prozent. | `number` |
| `cpuCores` | Die Anzahl der CPU-Kerne. | `number` |
| `memoryUsagePercent` | Die Arbeitsspeicherauslastung in Prozent. | `number` |
| `memoryFreePercent` | Der freie Arbeitsspeicher in Prozent. | `number` |
| `memoryTotalBytes` | Der gesamte Arbeitsspeicher in Bytes. | `number` |
| `diskMetrics` | Array von Festplattenmetriken für alle eingehängten Festplatten. | `Array<Object>` |
| `diskMetrics[].diskPath` | Der Pfad des Festplatten-Einhängepunkts. | `string` |
| `diskMetrics[].usagePercent` | Die Festplattenauslastung in Prozent für diesen Einhängepunkt. | `number` |
| `diskMetrics[].freePercent` | Der freie Festplattenplatz in Prozent für diesen Einhängepunkt. | `number` |
| `diskMetrics[].totalBytes` | Der gesamte Festplattenplatz in Bytes für diesen Einhängepunkt. | `number` |
| `processes` | Array laufender Prozesse auf dem Server. | `Array<Object>` |
| `processes[].pid` | Die Prozess-ID. | `number` |
| `processes[].name` | Der Prozessname. | `string` |
| `processes[].command` | Der zum Starten des Prozesses verwendete Befehl. | `string` |
| `failureCause` | Die Fehlerursache, wenn die Server-Prüfung fehlgeschlagen ist. | `string` |

### Synthetische Monitore

Synthetische Monitore führen dasselbe Skript über mehrere Browser (Chromium, Firefox, Webkit) und Bildschirmgrößen (Mobil, Tablet, Desktop) aus und erzeugen eine Antwort pro Konfiguration. Jeder Lauf ist über das Array `syntheticResponses` zugänglich.

| Variable | Beschreibung | Typ |
| --- | --- | --- |
| `failureCause` | Die Fehlerursache, wenn die synthetische Prüfung fehlgeschlagen ist. | `string` |
| `syntheticResponses` | Array mit einem Eintrag pro Browser-/Bildschirmgröße-Kombination. | `Array<Object>` |
| `syntheticResponses[].executionTimeInMs` | Ausführungszeit in Millisekunden für diesen Lauf. | `number` |
| `syntheticResponses[].result` | Das von diesem Lauf zurückgegebene Ergebnis. | `string`, `number`, `boolean` oder `JSON` |
| `syntheticResponses[].scriptError` | Fehler, der während dieses Laufs aufgetreten ist. | `string` |
| `syntheticResponses[].logMessages` | Während dieses Laufs generierte Log-Nachrichten. | `Array<string>` |
| `syntheticResponses[].screenshots` | Während dieses Laufs aufgenommene Screenshots. | `Object` |
| `syntheticResponses[].browserType` | Für diesen Lauf verwendeter Browser. | `string` |
| `syntheticResponses[].screenSizeType` | Für diesen Lauf verwendete Bildschirmgröße. | `string` |

### Benutzerdefinierte JavaScript-Code-Monitore

| Variable | Beschreibung | Typ |
| --- | --- | --- |
| `executionTimeInMs` | Die Zeit für die Ausführung des benutzerdefinierten Codes in Millisekunden. | `number` |
| `result` | Das vom benutzerdefinierten Code zurückgegebene Ergebnis. | `string`, `number`, `boolean` oder `JSON` |
| `scriptError` | Fehler, der während der Code-Ausführung aufgetreten ist. | `string` |
| `logMessages` | Array von Log-Nachrichten, die während der Ausführung generiert wurden. | `Array<string>` |

### SNMP-Monitore

| Variable | Beschreibung | Typ |
| --- | --- | --- |
| `isOnline` | Ob das SNMP-Gerät online ist und antwortet. | `boolean` |
| `responseTimeInMs` | Die SNMP-Abfrage-Antwortzeit in Millisekunden. | `number` |
| `failureCause` | Die Fehlerursache, wenn die SNMP-Abfrage fehlgeschlagen ist. | `string` |
| `isTimeout` | Ob die SNMP-Abfrage ein Timeout hatte. | `boolean` |
| `oidResponses` | Array von OID-Antwortobjekten mit oid, name, value und type. | `Array<Object>` |
| `oidResponses[].oid` | Die abgefragte OID. | `string` |
| `oidResponses[].name` | Der Anzeigename der OID (falls angegeben). | `string` |
| `oidResponses[].value` | Der von der OID zurückgegebene Wert. | `string` oder `number` |
| `oidResponses[].type` | Der SNMP-Datentyp des Werts. | `string` |
| `{{OID_NAME}}` | Direktzugriff auf den OID-Wert nach Name (z. B. `{{sysUpTime}}`). | `string` oder `number` |


## Grundlegende Verwendung

Im Incident-/Benachrichtigungsformular innerhalb einer Monitor-Kriterien-Instanz können Sie schreiben:

```
API returned {{responseStatusCode}} in {{responseTimeInMs}}ms
```

Wenn der Monitor-Antwortstatuscode `502` und die Zeit `842` ist, lautet der gespeicherte Titel:

```
API returned 502 in 842ms
```

Verschachtelter JSON-Zugriff funktioniert genauso wie bei JavaScript-Ausdrücken:

```
Problem ID: {{responseBody.error.id}}
Message: {{responseBody.error.message}}
```

Array-Indizierung wird unterstützt:

```
First User: {{responseBody.users[0].name}}
```

Wenn ein Pfad nicht existiert, wird standardmäßig eine leere Zeichenkette zurückgegeben.

## Erweiterte Verwendung

### Array-Elemente iterieren mit `{{#each}}`

Sie können Arrays mit der `{{#each path}}...{{/each}}`-Block-Syntax durchlaufen. Dies ist nützlich, wenn die Daten eine Liste von Elementen enthalten und Sie jedes in Ihren Incident- oder Benachrichtigungsbeschreibungen aufnehmen möchten.

**Syntax:**
```
{{#each arrayPath}}
  ...Körper mit {{property}} aus jedem Element...
{{/each}}
```

Im Schleifenkörper:
- `{{propertyName}}` wird relativ zum aktuellen Array-Element aufgelöst
- `{{nested.property}}` Punkt-Notation-Zugriff funktioniert am aktuellen Element
- `{{@index}}` wird zum 0-basierten Index der aktuellen Iteration aufgelöst
- `{{this}}` wird zum aktuellen Elementwert aufgelöst (nützlich für Arrays von Zeichenketten/Zahlen)

> **Hinweis**: Wenn der Pfad nicht zu einem Array aufgelöst wird, wird der gesamte `{{#each}}...{{/each}}`-Block aus der Ausgabe entfernt. Leere Arrays erzeugen keine Ausgabe für den Block.

## Beispiele

### Website/API-Monitor-Incident-Titel
```
High latency: {{responseTimeInMs}}ms (> threshold)
```

### Eingehende Anfrage-Benachrichtigungstitel
```
Bad inbound request: method={{requestMethod}} auth={{requestHeaders.authorization}}
```

### SSL-Zertifikat-Benachrichtigungstitel
```
SSL Certificate expiring: {{commonName}} expires {{expiresAt}}
```

### Server-Monitor-Benachrichtigungsbeschreibung
```
### Server Alert: {{hostname}}
CPU Usage: **{{cpuUsagePercent}}%**  
Memory Usage: **{{memoryUsagePercent}}%**  
First Disk Usage: **{{diskMetrics[0].usagePercent}}%**  
Last Check: {{requestReceivedAt}}
```
