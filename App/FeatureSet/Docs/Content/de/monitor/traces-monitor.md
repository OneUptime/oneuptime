# Traces-Monitor

Der Traces-Monitor ermöglicht die Überwachung verteilter Traces aus Ihren Anwendungen und das Auslösen von Benachrichtigungen basierend auf Span-Mustern, -Anzahl und -Status. OneUptime wertet Trace-Daten aus Ihren Telemetrie-Diensten über ein Zeitfenster aus.

## Übersicht

Traces-Monitore suchen und zählen Spans, die bestimmten Filtern entsprechen. Dies ermöglicht Ihnen:

- Benachrichtigungen bei Fehler-Span-Spitzen in Ihren Diensten
- Bestimmte Operationen und Endpunkte überwachen
- Span-Volumen und -muster verfolgen
- Nach Span-Status, -Name und benutzerdefinierten Attributen filtern
- Leistungs- und Zuverlässigkeitsprobleme aus Trace-Daten erkennen

## Einen Traces-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Traces** als Monitortyp
4. Wählen Sie die zu überwachenden Telemetrie-Dienste aus
5. Konfigurieren Sie bei Bedarf Span-Filter und Kriterien

## Konfigurationsoptionen

### Telemetrie-Dienste

Wählen Sie einen oder mehrere Dienste aus, von denen Traces überwacht werden sollen. Dienste müssen Traces über OpenTelemetry an OneUptime senden.

### Span-Filter

| Filter | Beschreibung | Erforderlich |
|--------|-------------|----------|
| Span-Status | Nach Span-Statuscode filtern (OK, ERROR, UNSET) | Nein |
| Span-Name | Textsuche nach bestimmten Span-Namen (z. B. Operations- oder Endpunktnamen) | Nein |
| Attribute | Schlüssel-Wert-Paare zum Filtern nach benutzerdefinierten Span-Attributen | Nein |
| Zeitfenster | Wie weit zurück nach Spans gesucht wird (in Sekunden, Standard: 60) | Nein |

### Span-Statuscodes

- **OK** — Die Operation wurde erfolgreich abgeschlossen
- **ERROR** — Die Operation ist auf einen Fehler gestoßen
- **UNSET** — Status wurde nicht explizit gesetzt

## Überwachungskriterien

### Verfügbare Prüftypen

| Prüftyp | Beschreibung |
|------------|-------------|
| Span-Anzahl | Die Anzahl der Spans, die Ihren Filtern im Zeitfenster entsprechen |

### Filtertypen

- **Größer als**, **Kleiner als**, **Größer oder gleich**, **Kleiner oder gleich**, **Gleich**, **Ungleich**

### Beispielkriterien

#### Benachrichtigung bei mehr als 50 Fehler-Spans in 60 Sekunden

- **Span-Status**: ERROR
- **Zeitfenster**: 60 Sekunden
- **Prüfen auf**: Span-Anzahl
- **Filtertyp**: Größer als
- **Wert**: 50

## Setup-Anforderungen

Der Traces-Monitor erfordert, dass Ihre Anwendungen verteilte Traces über OpenTelemetry an OneUptime senden. Informationen zur Einrichtung finden Sie in der [OpenTelemetry](/docs/telemetry/open-telemetry)-Dokumentation.
