# Logs-Monitor

Der Logs-Monitor ermöglicht die Überwachung Ihrer Anwendungslogs und das Auslösen von Benachrichtigungen basierend auf Log-Mustern, -Anzahl und Schweregrad. OneUptime wertet Logs aus Ihren Telemetrie-Diensten aus und vergleicht sie mit Ihren konfigurierten Kriterien.

## Übersicht

Logs-Monitore suchen und zählen Logs, die bestimmten Filtern in einem Zeitfenster entsprechen. Dies ermöglicht Ihnen:

- Benachrichtigungen bei Fehler-Log-Spitzen
- Bestimmte Log-Muster oder -Nachrichten überwachen
- Log-Volumen nach Schweregrad verfolgen
- Logs nach Dienst, Attributen und Inhalt filtern
- Anwendungsprobleme aus Log-Mustern erkennen

## Einen Logs-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Logs** als Monitortyp
4. Wählen Sie die zu überwachenden Telemetrie-Dienste aus
5. Konfigurieren Sie bei Bedarf Log-Filter und Kriterien

## Konfigurationsoptionen

### Telemetrie-Dienste

Wählen Sie einen oder mehrere Dienste aus, von denen Logs überwacht werden sollen. Dienste müssen Logs über OpenTelemetry an OneUptime senden.

### Log-Filter

| Filter | Beschreibung | Erforderlich |
|--------|-------------|----------|
| Schweregrade | Nach Log-Schweregrad filtern (ERROR, WARN, INFO, DEBUG usw.) | Nein |
| Text | Textsuche im Log-Nachrichten-Text | Nein |
| Attribute | Schlüssel-Wert-Paare zum Filtern nach benutzerdefinierten Log-Attributen | Nein |
| Zeitfenster | Wie weit zurück nach Logs gesucht wird (in Sekunden, Standard: 60) | Nein |

### Schweregrade

Logs nach einem oder mehreren Schweregraden filtern:

- **FATAL** / **EMERGENCY** / **CRITICAL**
- **ERROR**
- **WARN** / **WARNING**
- **INFO** / **INFORMATIONAL**
- **DEBUG**
- **TRACE**
- **UNSPECIFIED**

## Überwachungskriterien

### Verfügbare Prüftypen

| Prüftyp | Beschreibung |
|------------|-------------|
| Log-Anzahl | Die Anzahl der Logs, die Ihren Filtern im Zeitfenster entsprechen |

### Filtertypen

- **Größer als** — Log-Anzahl überschreitet einen Schwellenwert
- **Kleiner als** — Log-Anzahl liegt unter einem Schwellenwert
- **Größer oder gleich** — Log-Anzahl ist gleich oder über einem Schwellenwert
- **Kleiner oder gleich** — Log-Anzahl ist gleich oder unter einem Schwellenwert
- **Gleich** — Log-Anzahl stimmt exakt überein
- **Ungleich** — Log-Anzahl stimmt nicht überein

### Beispielkriterien

#### Benachrichtigung bei mehr als 100 Fehler-Logs in 60 Sekunden

- **Schweregrade**: ERROR
- **Zeitfenster**: 60 Sekunden
- **Prüfen auf**: Log-Anzahl
- **Filtertyp**: Größer als
- **Wert**: 100

#### Benachrichtigung bei fatalen Logs

- **Schweregrade**: FATAL
- **Zeitfenster**: 60 Sekunden
- **Prüfen auf**: Log-Anzahl
- **Filtertyp**: Größer als
- **Wert**: 0

## Setup-Anforderungen

Der Logs-Monitor erfordert, dass Ihre Anwendungen Logs über OpenTelemetry an OneUptime senden. Informationen zur Einrichtung finden Sie in der [OpenTelemetry](/docs/telemetry/open-telemetry)-Dokumentation.
