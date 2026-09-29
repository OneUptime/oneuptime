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

| Filter      | Beschreibung                                                                | Erforderlich |
| ----------- | --------------------------------------------------------------------------- | ------------ |
| Span-Status | Nach Span-Statuscode filtern (OK, ERROR, UNSET)                             | Nein         |
| Span-Name   | Textsuche nach bestimmten Span-Namen (z. B. Operations- oder Endpunktnamen) | Nein         |
| Attribute   | Schlüssel-Wert-Paare zum Filtern nach benutzerdefinierten Span-Attributen   | Nein         |
| Zeitfenster | Wie weit zurück nach Spans gesucht wird (in Sekunden, Standard: 60)         | Nein         |

### Span-Statuscodes

- **OK** — Die Operation wurde vom Anwendungscode oder von einer Trace-Pipeline ausdrücklich als erfolgreich markiert
- **ERROR** — Die Operation ist auf einen Fehler gestoßen
- **UNSET** — Es wurde kein Fehlerstatus gesetzt. Dies ist der Standardstatus von OpenTelemetry

UNSET bedeutet nicht, dass Daten fehlen. Die OpenTelemetry-Instrumentierung setzt ERROR, wenn eine Operation fehlschlägt, und belässt erfolgreiche Spans auf UNSET, sodass bei einem gesunden Dienst die meisten Spans UNSET sind. OneUptime zeigt sie in Grün als „Unset (no error)“ an. Das Erfassen einer Ausnahme ändert den Status eines Spans nicht, daher kann ein UNSET-Span trotzdem Ausnahmen haben; sie werden zusammen mit dem Span aufgeführt. Um bei Fehlern benachrichtigt zu werden, filtern Sie nach ERROR. Um alle Spans zu zählen, die nicht fehlgeschlagen sind, wählen Sie sowohl OK als auch UNSET aus.

Wenn erfolgreiche Anfragen als OK angezeigt werden sollen, fügen Sie unter **Traces > Einstellungen > Pipelines** eine Trace-Pipeline mit der Filterbedingung **Status = Nicht festgelegt** und einem **Status-Remapper** hinzu, der Werte von `http.response.status_code` wie `200` auf Ok abbildet.

## Überwachungskriterien

### Verfügbare Prüftypen

| Prüftyp     | Beschreibung                                                       |
| ----------- | ------------------------------------------------------------------ |
| Span-Anzahl | Die Anzahl der Spans, die Ihren Filtern im Zeitfenster entsprechen |

### Filtertypen

- **Größer als**, **Kleiner als**, **Größer oder gleich**, **Kleiner oder gleich**, **Gleich**

### Beispielkriterien

#### Benachrichtigung bei mehr als 50 Fehler-Spans in 60 Sekunden

- **Span-Status**: ERROR
- **Zeitfenster**: 60 Sekunden
- **Prüfen auf**: Span-Anzahl
- **Filtertyp**: Größer als
- **Wert**: 50

## Setup-Anforderungen

Der Traces-Monitor erfordert, dass Ihre Anwendungen verteilte Traces über OpenTelemetry an OneUptime senden. Informationen zur Einrichtung finden Sie in der [OpenTelemetry](/docs/telemetry/open-telemetry)-Dokumentation.
