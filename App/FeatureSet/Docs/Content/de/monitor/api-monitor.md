# API-Monitor

Der API-Monitor ermöglicht die Überwachung der Verfügbarkeit, Leistung und Korrektheit Ihrer HTTP/REST-APIs. OneUptime sendet periodisch HTTP-Anfragen an Ihre API-Endpunkte und wertet die Antworten anhand Ihrer konfigurierten Kriterien aus.

## Übersicht

API-Monitore senden HTTP-Anfragen an Ihre Endpunkte und prüfen die Antworten. Dies ermöglicht Ihnen:

- API-Betriebszeit und Verfügbarkeit überwachen
- Antwortzeiten und Leistung verfolgen
- HTTP-Statuscodes und Antworttexte verifizieren
- Antwort-Header validieren
- Verschiedene HTTP-Methoden testen (GET, POST, PUT, DELETE usw.)
- Benutzerdefinierte Anfrage-Header und -Texte senden

## Einen API-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **API** als Monitortyp
4. Geben Sie die API-URL ein und konfigurieren Sie die Anforderungseinstellungen
5. Konfigurieren Sie bei Bedarf Überwachungskriterien

## Konfigurationsoptionen

### API-URL

Geben Sie die vollständige URL des API-Endpunkts ein, den Sie überwachen möchten (z. B. `https://api.example.com/v1/health`).

### Dynamische URL-Platzhalter

Beim Überwachen von APIs hinter CDNs oder Caching-Proxys erhält der Monitor möglicherweise eine gecachte Antwort, anstatt den Ursprungsserver zu erreichen. Um den Cache bei jeder Prüfung zu umgehen, können Sie dynamische URL-Platzhalter verwenden, die bei jeder Überwachungsanfrage durch einen eindeutigen Wert ersetzt werden.

#### Unterstützte Platzhalter

| Platzhalter | Beschreibung | Beispielwert |
|-------------|-------------|---------------|
| `{{timestamp}}` | Wird durch den aktuellen Unix-Zeitstempel (Sekunden) ersetzt | `1719500000` |
| `{{random}}` | Wird durch eine zufällige eindeutige Zeichenkette ersetzt | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Beispiel

Konfigurieren Sie Ihre Monitor-URL mit einem Platzhalter:

```
https://api.example.com/health?cb={{timestamp}}
```

Bei jeder Überwachungsprüfung wird die URL zu:

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

Sie können auch `{{random}}` für eine eindeutige Zeichenkette bei jeder Anfrage verwenden:

```
https://api.example.com/health?nocache={{random}}
```

### API-Anfragemethode

Wählen Sie die HTTP-Methode für die Anfrage:

- **GET** (Standard)
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### Erweiterte Optionen

#### Anfrage-Header

Fügen Sie der Anfrage benutzerdefinierte HTTP-Header hinzu. Dies ist nützlich für Authentifizierungstoken, Inhaltstyp-Spezifikationen und andere API-spezifische Header.

Sie können [Monitor-Geheimnisse](/docs/monitor/monitor-secrets) in Header-Werten verwenden, um sensible Daten wie API-Schlüssel sicher zu speichern.

#### Anfragetext (JSON)

Für POST-, PUT- und PATCH-Anfragen können Sie einen JSON-Anfragetext angeben. Sie können [Monitor-Geheimnisse](/docs/monitor/monitor-secrets) auch im Anfragetext verwenden.

#### Weiterleitungen nicht folgen

Standardmäßig folgt OneUptime HTTP-Weiterleitungen (301, 302 usw.). Aktivieren Sie diese Option, wenn Sie die Weiterleitungsantwort selbst überwachen möchten, anstatt das endgültige Ziel.

## Überwachungskriterien

Sie können Kriterien konfigurieren, um zu bestimmen, wann Ihre API als online, eingeschränkt oder offline gilt, basierend auf:

- **Antwort-Statuscode** – Prüfen, ob der HTTP-Statuscode den erwarteten Werten entspricht (z. B. 200, 201)
- **Antwortzeit** – Überwachen, ob die Antwortzeit einen Schwellenwert überschreitet
- **Antworttext** – Prüfen, ob der Antworttext bestimmten Inhalt enthält oder diesem entspricht
- **Antwort-Header** – Überprüfen, ob bestimmte Antwort-Header vorhanden sind oder den erwarteten Werten entsprechen
- **JavaScript-Ausdruck** – Benutzerdefinierte Ausdrücke schreiben, um die Antwort auszuwerten. Weitere Informationen finden Sie unter [JavaScript-Ausdrücke](/docs/monitor/javascript-expression).
