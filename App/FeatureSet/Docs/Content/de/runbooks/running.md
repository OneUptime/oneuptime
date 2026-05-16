# Ein Runbook ausführen

Es gibt drei Wege, wie eine Runbook-Ausführung entsteht:

1. **Automatisch über eine Regel** — siehe [Runbook-Regeln](/docs/runbooks/rules).
2. **Manuell von der Runbook-Seite** — klicken Sie auf **Jetzt ausführen** in der Übersicht eines Runbooks. Nicht an einen Vorfall, eine Warnmeldung oder ein Wartungsereignis gebunden.
3. **Manuell aus einem Entitäten-Feed** — klicken Sie auf **Runbook ausführen** bei einem Vorfall, einer Warnmeldung oder einem geplanten Wartungsereignis. Die Ausführung ist an diese Entität gebunden.

## Die Ausführungsansicht

Öffnen Sie eine beliebige Ausführung, um ihre Checklisten-UI zu sehen. Jeder Schritt zeigt:

- **Status-Plakette** — Ausstehend, Läuft, Wartet auf Sie, Erledigt, Übersprungen, Fehlgeschlagen.
- **Titel und Beschreibung** — zum Ausführungszeitpunkt aus dem Runbook kopiert.
- **Ausgabe** (einklappbar) — stdout, Rückgabewerte, HTTP-Antworten.
- **Fehlermeldung**, falls der Schritt fehlschlug.
- Für manuelle Schritte im Zustand `WaitingForUser`: Schaltflächen **Als erledigt markieren** und **Überspringen**.

Solange die Ausführung nicht im Endzustand ist, fragt die Seite alle 3 Sekunden ab, sodass automatisierte Schritte nahezu in Echtzeit sichtbar werden.

## Manuelle und automatisierte Schritte verschränken

Der klassische Ablauf:

1. **Skript-Schritt**: Systemzustand erfassen, in S3 schreiben.
2. **Manueller Schritt**: „Kunden über das Statusseiten-Banner informieren." Bearbeiter hakt ab.
3. **HTTP-Schritt**: DBA über PagerDuty anpiepen.
4. **Manueller Schritt**: „Bestätigen, dass die sekundäre DB jetzt primär ist." Bearbeiter hakt ab.
5. **Skript-Schritt**: „Alles klar"-Nachricht in Slack senden.

Die Schritte 2 und 4 halten die Ausführung an, bis sie abgehakt sind. Die Schritte 1, 3, 5 laufen automatisch. Der gesamte Lauf ist eine Ausführung, eine Zeitleiste, eine Quelle der Wahrheit.

## Eine Ausführung abbrechen

Klicken Sie auf **Ausführung abbrechen** in der Ausführungsansicht. Der aktuelle Schritt (falls vorhanden) wird zu Ende geführt; weitere Schritte starten nicht. Der Status wird `Cancelled`.

## Aufbewahrung von Ausgaben

Die Ausgabe pro Schritt ist auf **50 KB** begrenzt, um zu verhindern, dass entlaufene Skripte die Datenbank aufblähen. Brauchen Sie größere Artefakte, schreiben Sie sie aus dem Skript in S3 oder einen Logger und legen Sie die URL in den Rückgabewert.

## Ein Runbook erneut ausführen

Eine Runbook-Ausführung ist ein einmaliger, unveränderlicher Datensatz. Klicken Sie für einen erneuten Lauf wieder auf **Jetzt ausführen** — dadurch entsteht eine frische Ausführung mit einem neuen Snapshot der aktuellen Schritte des Runbooks. Die ursprüngliche Ausführung bleibt für den Audit-Pfad erhalten.

## Vergangene Ausführungen finden

Jedes Runbook hat eine Registerkarte **Ausführungen**, die alle Läufe auflistet, mit Filtern für Status, Datumsbereich und Quell-Entität. Bei einem Vorfall, einer Warnmeldung oder einem geplanten Wartungsereignis zeigt die Registerkarte **Runbooks** die zugehörigen Läufe.
