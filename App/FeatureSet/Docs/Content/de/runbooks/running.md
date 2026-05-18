# Ein Runbook ausführen

Es gibt drei Wege, wie eine Runbook-Ausführung erstellt wird:

1. **Automatisch über eine Regel** — siehe [Runbook-Regeln](/docs/runbooks/rules).
2. **Manuell von der Runbook-Seite** — klicken Sie auf **Jetzt ausführen** auf der Übersichtsseite eines Runbooks. Nicht an einen Vorfall, eine Warnmeldung oder ein geplantes Wartungsereignis gekoppelt.
3. **Manuell aus einem Entitäts-Feed** — klicken Sie auf **Runbook ausführen** auf einem Vorfall, einer Warnmeldung oder einem geplanten Wartungsereignis. Die Ausführung wird an diese Entität gekoppelt.

## Die Ausführungsansicht

Öffnen Sie eine beliebige Ausführung, um ihre Checklisten-UI zu sehen. Jeder Schritt zeigt:

- **Status-Etikett** — Pending, Running, Wartet auf Sie, Done, Skipped, Failed.
- **Titel und Beschreibung** — zur Ausführungszeit aus dem Runbook kopiert.
- **Ausgabe** (einklappbar) — stdout, Rückgabewerte, HTTP-Antworten.
- **Fehlermeldung**, falls der Schritt fehlgeschlagen ist.
- Für manuelle Schritte in `WaitingForUser`: **Als erledigt markieren**- und **Überspringen**-Buttons.

Die Seite pollt alle 3 Sekunden, solange die Ausführung nicht terminal ist, sodass Sie automatisierte Schritte nahezu in Echtzeit abschließen sehen.

## Manuelle und automatisierte Schritte verschränken

Der klassische Ablauf:

1. **Skript-Schritt**: Systemzustand erfassen, nach S3 schreiben.
2. **Manueller Schritt**: „Kunden über das Statusseiten-Banner benachrichtigen." Die reagierende Person hakt ab.
3. **HTTP-Schritt**: DBA über PagerDuty piepen.
4. **Manueller Schritt**: „Bestätigen, dass die Sekundär-DB nun Primary ist." Die reagierende Person hakt ab.
5. **Skript-Schritt**: Entwarnungs-Slack-Nachricht senden.

Schritte 2 und 4 pausieren die Ausführung, bis sie abgehakt sind. Schritte 1, 3, 5 laufen automatisch. Der gesamte Lauf ist eine Ausführung, eine Timeline, eine Single Source of Truth.

## Einen Lauf abbrechen

Klicken Sie auf **Ausführung abbrechen** auf der Ausführungsseite. Der aktuelle Schritt (falls vorhanden) wird beendet; folgende Schritte starten nicht. Der Status wechselt zu `Cancelled`.

## Ausgabeaufbewahrung

Die Ausgabe pro Schritt ist auf **50 KB** begrenzt, um zu verhindern, dass entlaufene Skripte die Datenbank aufblähen. Wenn Sie größere Artefakte brauchen, schreiben Sie sie aus dem Skript nach S3 oder einen Logger und speichern Sie die URL im Rückgabewert.

## Ein Runbook erneut ausführen

Eine Runbook-Ausführung ist ein einmaliges, unveränderliches Protokoll. Klicken Sie zum erneuten Ausführen noch einmal auf **Jetzt ausführen** — das erzeugt eine frische Ausführung mit einem frischen Snapshot der aktuellen Schritte des Runbooks. Die ursprüngliche Ausführung bleibt für den Audit-Trail unverändert erhalten.

## Vergangene Ausführungen finden

Jedes Runbook hat einen **Executions**-Tab, der alle seine Läufe auflistet, mit Filtern für Status, Datumsbereich und Quell-Entität. Auf einem Vorfall, einer Warnmeldung oder einem geplanten Wartungsereignis zeigt der **Runbooks**-Tab die an diese Entität gekoppelten Läufe.
