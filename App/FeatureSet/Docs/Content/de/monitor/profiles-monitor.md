# Profile-Monitor

Der Profile-Monitor ermöglicht die Überwachung von Continuous-Profiling-Daten aus Ihren Anwendungen und das Auslösen von Benachrichtigungen basierend auf Profilanzahl und -mustern. OneUptime wertet Profildaten aus Ihren Telemetrie-Diensten über ein Zeitfenster aus.

## Übersicht

Profile-Monitore zählen und filtern Profiling-Daten, die bestimmten Kriterien entsprechen. Dies ermöglicht Ihnen:

- Continuous-Profiling-Daten aus Ihren Anwendungen überwachen
- Profile nach Typ filtern (CPU, Arbeitsspeicher, Goroutinen usw.)
- Profilvolumen und -muster verfolgen
- Benachrichtigungen bei Profiling-Anomalien
- Nach benutzerdefinierten Profilattributen filtern

## Einen Profile-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Profile** als Monitortyp
4. Wählen Sie die zu überwachenden Telemetrie-Dienste aus
5. Konfigurieren Sie bei Bedarf Profilfilter und Kriterien

## Konfigurationsoptionen

### Telemetrie-Dienste

Wählen Sie einen oder mehrere Dienste aus, von denen Profile überwacht werden sollen. Dienste müssen Continuous-Profiling-Daten über OpenTelemetry an OneUptime senden.

### Profilfilter

| Filter | Beschreibung | Erforderlich |
|--------|-------------|----------|
| Profiltypen | Nach Profiltyp-Namen filtern (z. B. CPU, Arbeitsspeicher, Goroutinen) | Nein |
| Attribute | Schlüssel-Wert-Paare zum Filtern nach benutzerdefinierten Profilattributen | Nein |
| Zeitfenster | Wie weit zurück nach Profilen gesucht wird (in Sekunden, Standard: 60) | Nein |

## Überwachungskriterien

### Verfügbare Prüftypen

| Prüftyp | Beschreibung |
|------------|-------------|
| Profilanzahl | Die Anzahl der Profile, die Ihren Filtern im Zeitfenster entsprechen |

### Filtertypen

- **Größer als**, **Kleiner als**, **Größer oder gleich**, **Kleiner oder gleich**, **Gleich**, **Ungleich**

### Beispielkriterien

#### Benachrichtigung wenn keine Profile in 5 Minuten empfangen

- **Zeitfenster**: 300 Sekunden
- **Prüfen auf**: Profilanzahl
- **Filtertyp**: Gleich
- **Wert**: 0

## Setup-Anforderungen

Der Profile-Monitor erfordert, dass Ihre Anwendungen Continuous-Profiling-Daten über OpenTelemetry an OneUptime senden. Informationen zur Einrichtung finden Sie in der [OpenTelemetry](/docs/telemetry/open-telemetry)-Dokumentation.
