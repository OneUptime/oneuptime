# Runbook-Regeln

Runbook-Regeln hängen Runbooks automatisch an, wenn ein **Vorfall**, eine **Warnmeldung** oder ein **geplantes Wartungsereignis** erstellt wird. Sie werden im Einstellungsmenü der jeweiligen Entität verwaltet:

- Vorfälle → Einstellungen → **Runbook-Regeln**
- Warnmeldungen → Einstellungen → **Runbook-Regeln**
- Geplante Wartung → Einstellungen → **Runbook-Regeln**

Alle drei Seiten bearbeiten dasselbe zugrunde liegende Regelmodell — sie sind lediglich gefiltert, sodass nur Regeln für den jeweiligen Entitätstyp angezeigt werden.

## Aufbau einer Regel

| Feld | Zweck |
| --- | --- |
| **Name** | Kurze, menschenlesbare Bezeichnung. Erscheint in Audit-Logs. |
| **Beschreibung** | Optionaler Kontext für Teammitglieder. |
| **Aktiviert** | Schalter, um eine Regel zu pausieren, ohne sie zu löschen. |
| **Titelmuster** | Groß-/Kleinschreibung-unabhängiger Regex gegen den Entitätstitel. Leer = jeder Titel passt. |
| **Beschreibungsmuster** | Groß-/Kleinschreibung-unabhängiger Regex gegen die Entitätsbeschreibung. Leer = jede Beschreibung passt. |
| **Zu startende Runbooks** | Ein oder mehrere Runbooks, die beim Auslösen der Regel gestartet werden. |

## Übereinstimmungssemantik

Eine Regel passt, wenn **alle angegebenen Kriterien erfüllt sind**. Leere Kriterien werden übersprungen:

- Eine Regel ohne Muster läuft bei jedem Ereignis ihres Typs (eine globale „Immer-Ausführen"-Regel).
- Eine Regel mit nur einem Titelmuster wird bei Ereignissen ausgelöst, deren Titel zum Regex passt.
- Mehrere Regeln können auf dasselbe Ereignis passen — jede Übereinstimmung wird ausgelöst, und die Vereinigung ihrer Runbooks läuft (jedes Runbook bekommt eine eigene Ausführung).

## Beispiel: DB-Failover für Datenbankvorfälle

```
Name:            DB-Failover bei DB-Vorfällen starten
Auslöser:        Vorfall
Titelmuster:     (?:^|\b)(db|database|postgres|mysql|mongo)
Runbooks:        [DB-Failover-Playbook, DBA-Team benachrichtigen]
```

Dies erzeugt zwei Runbook-Ausführungen, sobald ein Vorfall mit „db", „database", „postgres" usw. im Titel erstellt wird.

## Beispiel: Immer-Ausführen-Hygiene-Regel

```
Name:                    Vorab-Prüfung bei jedem Vorfall
Auslöser:                Vorfall
Titelmuster:             (leer)
Beschreibungsmuster:     (leer)
Runbooks:                [Vor-Vorfall-Zustand erfassen]
```

Wird bei jedem Vorfall ausgelöst — hilfreich, um Systemzustand, Seitenmetriken usw. festzuhalten.

## Was passiert, wenn eine Regel auslöst

1. Das Runbook wird geladen.
2. Seine Schritte werden in eine neue Runbook-Ausführung **als Snapshot** kopiert.
3. Die Ausführung wird in die Runbook-Queue gestellt.
4. Die Ausführung wird mit der Quell-Entität verknüpft — sie erscheint auf der Seite des Vorfalls/der Warnmeldung/des Wartungsereignisses und in der Ausführungsliste des Runbooks.

Alle regelausgelösten Läufe sehen Sie unter **Runbooks → Ausführungen**, gefiltert nach Status, Runbook oder Datum.

## Deaktivierte Runbooks

Verweist eine Regel auf ein Runbook mit `isEnabled = false`, passt die Regel zwar weiter, die Ausführung wird jedoch übersprungen. Aktivieren Sie das Runbook wieder, um den Betrieb fortzusetzen.

## Eine Regel testen

Bevor Sie sich in der Produktion auf eine Regel verlassen, erstellen Sie einen Testvorfall (oder eine Test-Warnmeldung) mit einem Titel, der zum Muster passt, und prüfen, ob die erwarteten Runbooks laufen. Regeln werden im Moment der Erstellung ausgewertet — das nachträgliche Bearbeiten eines Vorfall-Titels löst die Regeln nicht erneut aus.
