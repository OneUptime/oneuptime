# Website-Monitor

Der Website-Monitor ermöglicht die Überwachung der Verfügbarkeit, Leistung und Reaktion jeder Website oder Webseite. OneUptime sendet periodisch HTTP-Anfragen an Ihre Website-URL und prüft, ob sie korrekt antwortet.

## Übersicht

Website-Monitore prüfen Ihre Webseiten durch HTTP-Anfragen und Auswertung der Antworten. Dies ermöglicht Ihnen:

- Website-Betriebszeit und Verfügbarkeit überwachen
- Antwortzeiten und Leistung verfolgen
- HTTP-Statuscodes überprüfen
- Antwort-Header prüfen
- Ausfallzeiten erkennen, bevor Ihre Benutzer sie bemerken

## Einen Website-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Website** als Monitortyp
4. Geben Sie die Website-URL ein, die Sie überwachen möchten
5. Konfigurieren Sie bei Bedarf Überwachungskriterien

## Konfigurationsoptionen

### Website-URL

Geben Sie die vollständige URL der Website ein, die Sie überwachen möchten, einschließlich des Protokolls (z. B. `https://example.com`).

### Dynamische URL-Platzhalter

Beim Überwachen von URLs hinter CDNs oder Caching-Proxys erhält der Monitor möglicherweise eine gecachte Antwort, anstatt den Ursprungsserver zu erreichen. Um den Cache bei jeder Prüfung zu umgehen, können Sie dynamische URL-Platzhalter verwenden.

#### Unterstützte Platzhalter

| Platzhalter | Beschreibung | Beispielwert |
|-------------|-------------|---------------|
| `{{timestamp}}` | Wird durch den aktuellen Unix-Zeitstempel (Sekunden) ersetzt | `1719500000` |
| `{{random}}` | Wird durch eine zufällige eindeutige Zeichenkette ersetzt | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Beispiel

Konfigurieren Sie Ihre Monitor-URL mit einem Platzhalter:

```
https://example.com/health?cb={{timestamp}}
```

### Erweiterte Optionen

#### Weiterleitungen nicht folgen

Standardmäßig folgt OneUptime HTTP-Weiterleitungen (301, 302 usw.). Aktivieren Sie diese Option, wenn Sie die Weiterleitungsantwort selbst überwachen möchten.

## Überwachungskriterien

Sie können Kriterien konfigurieren, um zu bestimmen, wann Ihre Website als online, eingeschränkt oder offline gilt, basierend auf:

- **Antwort-Statuscode** — Prüfen, ob der HTTP-Statuscode den erwarteten Werten entspricht (z. B. 200, 301)
- **Antwortzeit** — Überwachen, ob die Antwortzeit einen Schwellenwert überschreitet
- **Antworttext** — Prüfen, ob der Antworttext bestimmten Inhalt enthält oder diesem entspricht
- **Antwort-Header** — Überprüfen, ob bestimmte Antwort-Header vorhanden sind oder den erwarteten Werten entsprechen
