# Eingehender Anfrage-Monitor

Der Eingehende Anfrage-Monitor (auch als Heartbeat-Monitor bekannt) ermöglicht die Überwachung von Diensten, indem diese periodische HTTP-Anfragen an OneUptime senden. Anstatt dass OneUptime Ihren Dienst erreicht, pingt Ihr Dienst OneUptime, um zu bestätigen, dass er läuft.

## Übersicht

Eingehende Anfrage-Monitore stellen eine eindeutige Webhook-URL bereit, die Ihre Dienste planmäßig aufrufen. Dies ermöglicht Ihnen:

- Cron-Jobs und geplante Aufgaben überwachen
- Hintergrund-Worker auf Aktivität prüfen
- Dienste hinter Firewalls überwachen, die extern nicht erreichbar sind
- Mit Drittanbieter-Überwachungstools integrieren
- Heartbeat-Signale von jedem HTTP-fähigen System verfolgen

## Einen Eingehenden Anfrage-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Eingehende Anfrage** als Monitortyp
4. Ein **Geheimer Schlüssel** und eine Heartbeat-URL werden für diesen Monitor generiert
5. Konfigurieren Sie Ihren Dienst, um Anfragen an die Heartbeat-URL zu senden
6. Konfigurieren Sie bei Bedarf Überwachungskriterien

## Heartbeat-URL

Nach der Erstellung hat Ihr Monitor eine eindeutige Heartbeat-URL im Format:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

Ihr Dienst sollte in regelmäßigen Abständen HTTP-**GET**- oder **POST**-Anfragen an diese URL senden.

### Einen Heartbeat senden

#### Mit curl

```bash
# Einfache GET-Anfrage
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# POST-Anfrage mit benutzerdefiniertem Text
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### Von einem Cron-Job

```bash
# Zu crontab hinzufügen, um alle 5 Minuten einen Heartbeat zu senden
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### Aus Anwendungscode

```javascript
// Node.js-Beispiel
const https = require('https');
https.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY');
```

```python
# Python-Beispiel
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

Ersetzen Sie `https://oneuptime.com` durch Ihre OneUptime-Instanz-URL, wenn Sie es selbst hosten.

## Überwachungskriterien

Sie können Kriterien konfigurieren, um zu bestimmen, wann Ihr Dienst als online, eingeschränkt oder offline gilt, basierend auf:

### Verfügbare Prüftypen

| Prüftyp | Beschreibung |
|------------|-------------|
| Eingehende Anfrage | Ob ein Heartbeat innerhalb eines Zeitfensters empfangen wurde |
| Anfragetext | Inhalt des mit dem Heartbeat gesendeten Anfragetexts |
| Anfrage-Header | Name eines bestimmten Anfrage-Headers |
| Anfrage-Header-Wert | Wert eines bestimmten Anfrage-Headers |

### Filtertypen

Für **Eingehende Anfrage**:

- **Empfangen in Minuten** — Ein Heartbeat wurde innerhalb der angegebenen Minutenzahl empfangen
- **Nicht empfangen in Minuten** — Kein Heartbeat wurde innerhalb der angegebenen Minutenzahl empfangen

Für **Anfragetext**, **Anfrage-Header** und **Anfrage-Header-Wert**:

- **Enthält** — Wert enthält den angegebenen Text
- **Enthält nicht** — Wert enthält den angegebenen Text nicht

### Beispielkriterien

#### Als offline markieren, wenn kein Heartbeat in 10 Minuten

- **Prüfen auf**: Eingehende Anfrage
- **Filtertyp**: Nicht empfangen in Minuten
- **Wert**: 10

## Best Practices

1. **Zeitfenster angemessen festlegen** — Wenn Ihr Cron-Job alle 5 Minuten läuft, setzen Sie den Schwellenwert „Nicht empfangen in Minuten" auf 10–15 Minuten, um gelegentliche Verzögerungen zu berücksichtigen
2. **Aussagekräftige Daten einschließen** — Statusinformationen im Anfragetext senden, um granulare Kriterien einzurichten
3. **POST für umfangreiche Daten** — POST-Anfragen mit JSON-Texten verwenden, wenn Sie detaillierte Statusinformationen senden müssen
4. **Den Monitor überwachen** — Sicherstellen, dass der Dienst, der Heartbeats sendet, eine ordnungsgemäße Fehlerbehandlung hat
