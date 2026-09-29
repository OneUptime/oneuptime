# Ausnahmen-Monitor

Der Ausnahmen-Monitor ermöglicht die Überwachung von Anwendungsausnahmen und -fehlern und löst Benachrichtigungen aus, wenn die Ausnahmezahl Ihre konfigurierten Schwellenwerte überschreitet. OneUptime wertet Ausnahmedaten aus Ihren Telemetrie-Diensten über ein Zeitfenster aus.

## Übersicht

Ausnahmen-Monitore zählen und filtern Ausnahmen, die bestimmten Kriterien entsprechen. Dies ermöglicht Ihnen:

- Benachrichtigungen bei Ausnahmespitzen in Ihren Anwendungen
- Bestimmte Ausnahmetypen überwachen
- Benachrichtigungen auf eine Deployment-Umgebung wie `production` beschränken
- Ausnahmen nach Fehlermeldung suchen
- Gelöste und aktive Ausnahmen separat verfolgen
- Anwendungsstabilitätsprobleme aus Fehlermustern erkennen

## Einen Ausnahmen-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Ausnahmen** als Monitortyp
4. Wählen Sie die zu überwachenden Telemetrie-Dienste aus
5. Konfigurieren Sie bei Bedarf Ausnahmenfilter und Kriterien

## Konfigurationsoptionen

### Telemetrie-Dienste

Wählen Sie einen oder mehrere Dienste aus, von denen Ausnahmen überwacht werden sollen. Dienste müssen Ausnahmedaten über OpenTelemetry an OneUptime senden.

### Ausnahmenfilter

| Filter                   | Beschreibung                                                              | Erforderlich |
| ------------------------ | ------------------------------------------------------------------------- | ------------ |
| Ausnahmetypen            | Nach Ausnahmetypnamen filtern (z. B. `NullPointerException`, `TypeError`) | Nein         |
| Umgebungen               | Nach Deployment-Umgebung filtern (z. B. `production`, `staging`)          | Nein         |
| Nachricht                | Textsuche in Ausnahmemeldungen                                            | Nein         |
| Gelöste einschließen     | Gelöste Ausnahmen einschließen (Standard: false)                          | Nein         |
| Archivierte einschließen | Archivierte Ausnahmen einschließen (Standard: false)                      | Nein         |
| Zeitfenster              | Wie weit zurück nach Ausnahmen gesucht wird (in Sekunden, Standard: 60)   | Nein         |

### Umgebungen

Umgebungen stammen aus dem OpenTelemetry-Ressourcenattribut `deployment.environment` jeder Ausnahme – demselben Wert, nach dem der Ausnahmen-Explorer mit `env:production` filtert. Geben Sie eine Umgebung oder mehrere durch Kommas getrennte Umgebungen ein; eine Ausnahme wird gezählt, wenn ihre Umgebung mit einer davon übereinstimmt.

Der Abgleich ist exakt und berücksichtigt Groß- und Kleinschreibung: `production` stimmt nicht mit `Production` oder `prod` überein. Ausnahmen ohne Umgebung werden nicht gezählt, wenn dieser Filter gesetzt ist. Lassen Sie ihn leer, um Ausnahmen aus allen Umgebungen zu zählen, einschließlich solcher ohne Umgebung.

Der Umgebungsfilter wird mit allen anderen Filtern kombiniert, sodass ein Monitor, der auf einen Telemetrie-Dienst und `production` beschränkt ist, nur die Produktionsausnahmen dieses Dienstes zählt.

Wenn Sie den Monitor über die API erstellen, setzen Sie `environments` im `exceptionMonitor` des Schritts auf eine Liste von Umgebungsnamen:

```json
{
  "exceptionMonitor": {
    "telemetryServiceIds": [],
    "environments": ["production"],
    "exceptionTypes": [],
    "message": "",
    "includeResolved": false,
    "includeArchived": false,
    "lastXSecondsOfExceptions": 300
  }
}
```

## Überwachungskriterien

### Verfügbare Prüftypen

| Prüftyp      | Beschreibung                                                           |
| ------------ | ---------------------------------------------------------------------- |
| Ausnahmezahl | Die Anzahl der Ausnahmen, die Ihren Filtern im Zeitfenster entsprechen |

### Filtertypen

- **Größer als** — Ausnahmezahl überschreitet einen Schwellenwert
- **Kleiner als** — Ausnahmezahl liegt unter einem Schwellenwert
- **Größer oder gleich** — Ausnahmezahl ist gleich oder über einem Schwellenwert
- **Kleiner oder gleich** — Ausnahmezahl ist gleich oder unter einem Schwellenwert
- **Gleich** — Ausnahmezahl stimmt exakt überein
- **Ungleich** — Ausnahmezahl stimmt nicht überein

### Beispielkriterien

#### Benachrichtigung bei mehr als 10 Ausnahmen in 60 Sekunden

- **Zeitfenster**: 60 Sekunden
- **Prüfen auf**: Ausnahmezahl
- **Filtertyp**: Größer als
- **Wert**: 10

#### Benachrichtigung bei jeder NullPointerException

- **Ausnahmetypen**: `NullPointerException`
- **Zeitfenster**: 60 Sekunden
- **Prüfen auf**: Ausnahmezahl
- **Filtertyp**: Größer als
- **Wert**: 0

#### Benachrichtigung nur bei Produktionsausnahmen

- **Umgebungen**: `production`
- **Zeitfenster**: 300 Sekunden
- **Prüfen auf**: Ausnahmezahl
- **Filtertyp**: Größer als
- **Wert**: 5

#### Ausnahmen mit bestimmter Nachricht überwachen

- **Nachricht**: `out of memory`
- **Zeitfenster**: 300 Sekunden
- **Prüfen auf**: Ausnahmezahl
- **Filtertyp**: Größer als
- **Wert**: 0

## Setup-Anforderungen

Der Ausnahmen-Monitor erfordert, dass Ihre Anwendungen Ausnahmedaten über OpenTelemetry an OneUptime senden. Informationen zur Einrichtung finden Sie in der [OpenTelemetry](/docs/telemetry/open-telemetry)-Dokumentation.
