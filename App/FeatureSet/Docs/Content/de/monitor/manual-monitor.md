# Manueller Monitor

Der Manuelle Monitor ermöglicht das Erstellen von Monitoren, deren Status vollständig manuell oder über die API verwaltet wird. OneUptime führt keine automatisierten Prüfungen durch — Sie steuern den Monitorstatus direkt.

## Übersicht

Manuelle Monitore sind Platzhalter, die Sie selbst aktualisieren. Dies ist nützlich für:

- Integration mit externen Überwachungstools, die den Status über die OneUptime API aktualisieren
- Verfolgen von Diensten oder Systemen, die nicht automatisch überwacht werden können
- Verwalten von Incidents für Komponenten ohne automatisierte Gesundheitsprüfungen
- Darstellen von Drittanbieter-Abhängigkeiten, deren Status Sie manuell verfolgen

## Einen Manuellen Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Manuell** als Monitortyp
4. Geben Sie einen Namen und eine Beschreibung für den Monitor ein

## Funktionsweise

Manuelle Monitore haben keine Überwachungsintervalle, Probes oder automatisierte Kriterienauswertung. Der Monitorstatus bleibt so, wie Sie ihn festgelegt haben, bis Sie ihn ändern.

### Status aktualisieren

Sie können den Status eines manuellen Monitors auf zwei Arten aktualisieren:

- **Dashboard** — Den Monitorstatus direkt im OneUptime-Dashboard ändern
- **API** — Den Monitorstatus programmgesteuert über die OneUptime API aktualisieren

### Incidents und Benachrichtigungen

Sie können Incidents und Benachrichtigungen für manuelle Monitore genauso erstellen wie für jeden anderen Monitortyp. Dies ermöglicht Ihnen:

- Ausfallzeiten für extern überwachte Dienste verfolgen
- Incidents manuell erstellen, wenn Probleme gemeldet werden
- Manuelle Monitore auf Status-Seiten verwenden, um den Status an Benutzer zu kommunizieren

## Wann manuelle Monitore verwendet werden

| Anwendungsfall            | Beschreibung                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Drittanbieter-Dienste     | Status externer Dienste verfolgen, von denen Sie abhängen, die Sie aber nicht direkt überwachen können |
| Physische Infrastruktur   | Hardware oder physische Systeme ohne Netzwerküberwachung darstellen                                    |
| Geschäftsprozesse         | Nicht-technische Prozesse verfolgen, die den Dienststatus beeinflussen                                 |
| API-gesteuerter Status    | Externen Tools erlauben, den Monitorstatus über die OneUptime API zu aktualisieren                     |
| Status-Seiten-Platzhalter | Komponenten auf Ihrer Status-Seite anzeigen, die außerhalb von OneUptime verwaltet werden              |
