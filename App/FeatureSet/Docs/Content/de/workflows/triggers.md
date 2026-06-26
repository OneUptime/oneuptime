# Auslöser

Ein Auslöser ist der erste Baustein in einem Workflow – er bestimmt, wann der Workflow läuft. Jeder Workflow hat genau einen Auslöser. Sie können zwischen vier Arten wählen.

## Manuell

Führen Sie den Workflow bei Bedarf aus, indem Sie auf der Workflow-Seite auf **Manuell ausführen** klicken. Sie können eine JSON-Payload einfügen, die der Rest des Workflows lesen kann.

Gut geeignet für: Ein-Klick-Automatisierungen, für die Sie eine Schaltfläche wünschen, etwa „diesen Schlüssel rotieren" oder „eine Testbenachrichtigung senden".

**Ausgabe**: die eingefügte JSON-Payload oder ein leeres Objekt, falls Sie keine angegeben haben.

## Zeitplan

Führen Sie den Workflow nach einem wiederkehrenden Zeitplan mithilfe eines cron-Ausdrucks aus.

Gut geeignet für: nächtliche Aufräumarbeiten, stündliche Synchronisation, wöchentliche Berichte.

**Einstellung**: ein cron-Ausdruck. Ein paar geläufige Beispiele:

- `0 * * * *` – jede Stunde zur vollen Stunde.
- `*/5 * * * *` – alle 5 Minuten.
- `0 9 * * 1` – jeden Montag um 9:00 Uhr.

Sollte das System kurzzeitig nicht erreichbar sein, wird die Ausführung nach der Wiederherstellung umgehend nachgeholt – Sie müssen sich bei kurzen Ausfällen keine Sorgen über verpasste Zeitpunkte machen.

## Webhook

OneUptime erstellt eine eindeutige URL. Alles, was diese URL aufruft, startet den Workflow. Header, Query-Parameter und Body der Anfrage werden weitergegeben.

Gut geeignet für: Daten aus einem anderen Tool in OneUptime zu empfangen – CI/CD-Callbacks, Benachrichtigungen aus anderem Monitoring, Anmeldungen in Ihrem CRM.

**Ausgabe**:

- **Request Headers** – alle Header der eingehenden Anfrage.
- **Request Query Params** – die geparste Query-Zeichenkette.
- **Request Body** – der geparste Body (oder der Rohtext, falls es kein JSON ist).

Die URL akzeptiert sowohl `GET` als auch `POST`. Der Aufrufer erhält eine schnelle Bestätigung – der Workflow selbst läuft im Hintergrund.

Behandeln Sie die URL wie ein Passwort. Jeder, der sie besitzt, kann Ihren Workflow starten.

## OneUptime-Ereignis-Auslöser

Fast alles in OneUptime – Monitore, Vorfälle, Benachrichtigungen, geplante Wartungen, Statusseiten, Rufbereitschafts-Richtlinien, Teams – kann einen Workflow auslösen. Für jeden Bereich gibt es drei Ereignisse:

- **Bei Erstellung** – wird ausgelöst, wenn ein neuer Eintrag hinzugefügt wird.
- **Bei Aktualisierung** – wird ausgelöst, wenn ein Eintrag geändert wird.
- **Bei Löschung** – wird ausgelöst, wenn ein Eintrag gelöscht wird.

So bauen Sie „wenn X in OneUptime passiert, tue Y", ohne Dinge in einer Schleife abfragen zu müssen.

Der vollständige Datensatz wird an den nächsten Baustein weitergegeben. Beispielsweise gibt der Auslöser **Vorfall → Bei Erstellung** den neuen Vorfall weiter, sodass der nächste Baustein dessen Titel, Beschreibung, Schweregrad und alle anderen Felder lesen kann.

### Häufig verwendete Ereignisse

- **Vorfall** – reagieren, wenn ein Vorfall geöffnet, aktualisiert (bestätigt, gelöst) oder gelöscht wird.
- **Alarm** – dieselben drei Ereignisse für Alarme.
- **Monitor** – reagieren, wenn ein Monitor hinzugefügt, bearbeitet oder entfernt wird.
- **Geplante Wartung** – ein Wartungsfenster automatisch ankündigen, sobald es geplant wird.
- **Statusseiten-Abonnent** – jemanden begrüßen, der eine Statusseite abonniert.
- **Rufbereitschafts-Richtlinie** – Änderungen am Dienstplan in ein anderes Personalsystem synchronisieren.

Suchen Sie in der Auslöser-Palette nach dem Namen, um den gewünschten zu finden.

## Welchen Auslöser soll ich verwenden?

| Wenn Sie …                                         | Wählen Sie             |
| -------------------------------------------------- | ---------------------- |
| eine Schaltfläche zum Starten des Workflows wollen | **Manuell**            |
| nach einem festen Zeitplan ausführen wollen        | **Zeitplan**           |
| ein anderes System Daten einsenden lassen wollen   | **Webhook**            |
| auf etwas innerhalb von OneUptime reagieren wollen | **OneUptime-Ereignis** |

Ein Workflow kann nur einen Auslöser haben. Wenn Sie dieselbe Automatisierung auf zwei Wegen starten möchten, bauen Sie die gemeinsame Logik in einem Workflow und rufen Sie ihn aus zwei schlanken „Wrapper"-Workflows mit der Komponente **Workflow ausführen** auf.

## Weiterführende Themen

- [Komponenten](/docs/workflows/components) – die Aktionen, die Sie nach dem Auslöser hinzufügen.
- [Variablen](/docs/workflows/variables) – Ausgaben des Auslösers aus späteren Bausteinen lesen.
- [Ausführungen & Logs](/docs/workflows/runs-and-logs) – bestätigen, dass Ihr Auslöser gefeuert hat.
