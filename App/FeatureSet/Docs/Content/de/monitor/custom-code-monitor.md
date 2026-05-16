# Benutzerdefinierter Code-Monitor

Der Benutzerdefinierte Code-Monitor ermöglicht es Ihnen, benutzerdefinierte Skripte zur Überwachung Ihrer Anwendungen zu schreiben. Mit dieser Funktion können Sie Ihre Anwendungen auf eine Weise überwachen, die mit den vorhandenen Monitoren nicht möglich ist. Sie können beispielsweise mehrstufige API-Anfragen durchführen.

#### Beispiel

Das folgende Beispiel zeigt, wie ein Benutzerdefinierter Code-Monitor verwendet wird:

```javascript
// You can use axios module.

await axios.get('https://api.example.com/');

// Axios Documentation here: https://axios-http.com/docs/intro

return {
    data: 'Hello World' // return any data you like here. 
};
```


### Monitor-Geheimnisse verwenden

#### Ein Geheimnis hinzufügen

Um ein Geheimnis hinzuzufügen, gehen Sie bitte zum OneUptime-Dashboard -> Projekteinstellungen -> Monitor-Geheimnisse -> Monitor-Geheimnis erstellen.

![Geheimnis erstellen](/docs/static/images/CreateMonitorSecret.png)

Sie können auswählen, welche Monitore Zugriff auf das Geheimnis haben. In diesem Fall haben wir ein `ApiKey`-Geheimnis hinzugefügt und Monitore ausgewählt, die Zugriff darauf haben.

**Bitte beachten**: Geheimnisse werden verschlüsselt und sicher gespeichert. Wenn Sie das Geheimnis verlieren, müssen Sie ein neues erstellen. Sie können das Geheimnis nach dem Speichern weder anzeigen noch aktualisieren.

#### Ein Geheimnis verwenden

Um Monitor-Geheimnisse im Skript zu verwenden, können Sie das `monitorSecrets`-Objekt im Kontext des Skripts nutzen. Sie können damit auf die Geheimnisse zugreifen, die Sie dem Monitor hinzugefügt haben.

```javascript
// if your secret is of type string then you need to wrap it in quotes
let stringSecret = '{{monitorSecrets.StringSecret}}';

// if your secret is of type number or boolean then you can use it directly
let numberSecret = {{monitorSecrets.NumberSecret}};

// if your secret is of type boolean then you can use it directly
let booleanSecret = {{monitorSecrets.BooleanSecret}};

// you can even console log to see if the secrets is being fetched correctly
console.log(stringSecret); 
```


### Benutzerdefinierte Metriken

Sie können benutzerdefinierte Metriken aus Ihrem Skript mit der Funktion `oneuptime.captureMetric()` erfassen. Diese Metriken werden in OneUptime gespeichert und können auf Dashboards mit dem Metric Explorer als Diagramme dargestellt werden.

```javascript
oneuptime.captureMetric(name, value, attributes);
```

- `name` (Zeichenkette, erforderlich): Der Metrikname (z. B. `"api.response.time"`). Er wird automatisch mit dem Präfix `custom.monitor.` gespeichert.
- `value` (Zahl, erforderlich): Der numerische Metrikwert.
- `attributes` (Objekt, optional): Schlüssel-Wert-Paare für zusätzlichen Kontext.

#### Beispiel

```javascript
const response = await axios.get('https://api.example.com/health');

// Capture a simple metric
oneuptime.captureMetric('api.response.time', response.data.latency);

// Capture a metric with attributes
oneuptime.captureMetric('api.queue.depth', response.data.queueDepth, {
    region: 'us-east-1',
    environment: 'production'
});

return {
    data: response.data
};
```

Nach der Erfassung erscheinen diese Metriken im Metric Explorer unter Namen wie `custom.monitor.api.response.time`. Sie können sie zu Dashboard-Diagrammen hinzufügen, Benachrichtigungen einrichten und nach Monitor, Probe oder benutzerdefinierten Attributen filtern.

**Limits:**
- Maximal 100 Metriken pro Skriptausführung.
- Metriknamen sind auf 200 Zeichen begrenzt.
- Werte müssen numerisch sein.

### Im Skript verfügbare Module
- `axios`: Dieses Modul können Sie verwenden, um HTTP-Anfragen zu stellen. Es ist ein promise-basierter HTTP-Client für Browser und Node.js.
- `crypto`: Dieses Modul können Sie für kryptographische Operationen verwenden. Es ist ein integriertes Node.js-Modul mit kryptographischer Funktionalität, einschließlich Wrapper für OpenSSL-Hash-, HMAC-, Verschlüsselungs-, Entschlüsselungs-, Signatur- und Verifizierungsfunktionen.
- `console.log`: Dieses Modul können Sie verwenden, um Daten in der Konsole zu protokollieren. Dies ist nützlich für Debugging-Zwecke.
- `oneuptime.captureMetric`: Damit können Sie benutzerdefinierte Metriken aus Ihrem Skript erfassen. Siehe den Abschnitt Benutzerdefinierte Metriken oben.
- `http`: Dieses Modul können Sie verwenden, um HTTP-Anfragen zu stellen. Es ist ein integriertes Node.js-Modul, das einen HTTP-Client und -Server bereitstellt.
- `https`: Dieses Modul können Sie verwenden, um HTTPS-Anfragen zu stellen. Es ist ein integriertes Node.js-Modul, das einen HTTPS-Client und -Server bereitstellt.

### Zu beachtende Punkte

- Sie können `console.log` verwenden, um Daten in der Konsole zu protokollieren. Diese sind im Protokollbereich des Monitors verfügbar (Probes > Protokolle anzeigen).
- Sie können die Daten aus dem Skript mit der `return`-Anweisung zurückgeben.
- Dies ist ein JavaScript-Skript, daher können Sie alle JavaScript-Funktionen im Skript verwenden.
- Das Timeout für das Skript beträgt 2 Minuten. Wenn das Skript länger als 2 Minuten dauert, wird es beendet.
