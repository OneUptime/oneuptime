# Runbook-Regeln

Runbook-Regeln hängen Runbooks automatisch an, wenn ein **Vorfall**, eine **Warnmeldung** oder ein **geplantes Wartungsereignis** erstellt wird. Sie werden über das Settings-Menü jeder Entität verwaltet:

- Incidents → Settings → **Runbook Rules**
- Alerts → Settings → **Runbook Rules**
- Scheduled Maintenance → Settings → **Runbook Rules**

Alle drei Seiten bearbeiten dasselbe zugrunde liegende Regelmodell — sie sind nur so gefiltert, dass jeweils nur Regeln für diesen Entitätstyp angezeigt werden.

## Aufbau einer Regel

| Feld                      | Zweck                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Name**                  | Kurzer, menschenlesbarer Name. Wird in Audit-Logs angezeigt.                                                  |
| **Beschreibung**          | Optionaler Kontext für Teamkollegen.                                                                          |
| **Aktiviert**             | Umschalter, um eine Regel zu pausieren, ohne sie zu löschen.                                                  |
| **Titelmuster**           | Case-insensitiver Regex, der gegen den Titel der Entität geprüft wird. Leer = jeder Titel passt.              |
| **Beschreibungsmuster**   | Case-insensitiver Regex, der gegen die Beschreibung der Entität geprüft wird. Leer = jede Beschreibung passt. |
| **Zu startende Runbooks** | Ein oder mehrere Runbooks, die gestartet werden, wenn die Regel feuert.                                       |

## Matching-Semantik

Eine Regel passt, wenn **alle angegebenen Kriterien zutreffen**. Leere Kriterien werden übersprungen, also:

- Eine Regel ohne gesetzte Muster läuft bei jedem Ereignis ihres Typs (eine globale „immer ausführen"-Regel).
- Eine Regel nur mit einem Titelmuster feuert bei Ereignissen, deren Titel diesem Regex entspricht.
- Mehrere Regeln können auf dasselbe Ereignis passen — jede passende Regel feuert, und die Vereinigung ihrer Runbooks läuft (jedes Runbook bekommt seine eigene Ausführung).

## Beispiel: DB-Failover für Datenbankvorfälle

```
Name:           DB-Failover für DB-Vorfälle starten
Trigger:        Incident
Title Pattern:  (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:       [DB-Failover-Playbook, DBA-Team benachrichtigen]
```

Das wird jedes Mal zwei Runbook-Ausführungen erzeugen, wenn ein Vorfall mit „db", „database", „postgres" usw. im Titel erstellt wird.

## Beispiel: Always-Run-Hygieneregel

```
Name:                 Pre-Flight-Check immer ausführen
Trigger:              Incident
Title Pattern:        (leer)
Description Pattern:  (leer)
Runbooks:             [Vor-Vorfall-Zustand erfassen]
```

Feuert bei jedem Vorfall — nützlich, um Snapshots des Systemzustands, Seitenmetriken usw. zu erfassen.

## Was passiert, wenn eine Regel feuert

1. Das Runbook wird geladen.
2. Seine Schritte werden auf eine neue Runbook-Ausführung **gesnapshottet**.
3. Die Ausführung wird in die Queue des Runbook-Workers gestellt.
4. Die Ausführung wird mit der Quell-Entität verknüpft — sie erscheint auf der Seite des Vorfalls, der Warnmeldung oder des geplanten Wartungsereignisses und in der Executions-Liste des Runbooks.

Alle regelgesteuerten Läufe sehen Sie unter **Runbooks → Executions**, gefiltert nach Status, Runbook oder Datum.

## Deaktivierte Runbooks

Wenn eine Regel auf ein Runbook mit `isEnabled = false` verweist, passt die Regel zwar weiterhin, aber die Runbook-Ausführung wird übersprungen. Aktivieren Sie das Runbook erneut, um fortzufahren.

## Eine Regel testen

Bevor Sie sich in der Produktion auf eine Regel verlassen, erstellen Sie einen Testvorfall (oder eine Test-Warnmeldung) mit einem Titel, der dem Muster entspricht, und bestätigen Sie, dass die erwarteten Runbooks feuern. Regeln werden im Moment der Erstellung ausgewertet — das spätere Bearbeiten des Vorfallstitels löst Regeln nicht erneut aus.
