# Trigger

Ein Trigger ist der erste Baustein in einem Workflow – er entscheidet, wann der Workflow läuft. Jeder Workflow hat genau einen Trigger. Sie wählen aus vier Arten.

## Manual

Führen Sie den Workflow bei Bedarf aus, indem Sie auf der **Builder**-Seite auf **Run Workflow** klicken, die Felder des Triggers ausfüllen und mit **Run Workflow Manually** bestätigen. Der Manual-Trigger nimmt eine JSON-Payload entgegen, die der Rest des Workflows lesen kann.

Gut geeignet für: Automatisierungen mit einem Klick, für die Sie einen Knopf wollen, wie „diesen Schlüssel rotieren" oder „einen Test-Alarm senden".

**Ausgabe**: das JSON, das Sie eingefügt haben, oder ein leeres Objekt, wenn Sie nichts eingefügt haben.

## Schedule

Führen Sie den Workflow nach einem wiederkehrenden Zeitplan mithilfe eines Cron-Ausdrucks aus.

Gut geeignet für: nächtliche Aufräumarbeiten, stündliche Synchronisation, wöchentliche Berichte.

**Einstellung**: ein Cron-Ausdruck. Ein paar gängige Beispiele:

- `0 * * * *` – jede volle Stunde.
- `*/5 * * * *` – alle 5 Minuten.
- `0 9 * * 1` – jeden Montag um 9:00 Uhr.

Falls das System kurzzeitig nicht verfügbar ist, wird die Ausführung nachgeholt, sobald es sich erholt hat – bei kurzen Ausfällen müssen Sie sich um verpasste Zeitpunkte keine Sorgen machen.

## Webhook

OneUptime erstellt eine eindeutige URL. Alles, was diese URL aufruft, startet den Workflow. Die Header, Query-Parameter und der Body der Anfrage werden übergeben.

Gut geeignet für: das Empfangen von Daten in OneUptime aus einem anderen Tool – CI/CD-Callbacks, Alarme aus anderem Monitoring, Anmeldungen in Ihrem CRM.

**Ausgabe**:

- **Request Headers** – alle Header aus der eingehenden Anfrage.
- **Request Query Params** – der geparste Query-String.
- **Request Body** – der geparste Body (oder der Rohtext, wenn es kein JSON ist).

Die URL akzeptiert sowohl `GET` als auch `POST`. Der Aufrufer erhält eine schnelle Bestätigung – der Workflow selbst läuft im Hintergrund.

Behandeln Sie die URL wie ein Passwort. Wer immer sie kennt, kann Ihren Workflow starten.

## OneUptime-Ereignis-Trigger

Fast alles in OneUptime – Monitore, Vorfälle, Alarme, geplante Wartungen, Statusseiten, Bereitschaftsrichtlinien, Teams – kann einen Workflow auslösen. Jedes davon bietet drei Ereignisse:

- **On Create** – löst aus, wenn ein neues Objekt hinzugefügt wird.
- **On Update** – löst aus, wenn ein Objekt geändert wird.
- **On Delete** – löst aus, wenn ein Objekt gelöscht wird.

So bauen Sie „wenn X in OneUptime passiert, tue Y", ohne Dinge in einer Schleife prüfen zu müssen.

Der vollständige Datensatz wird an den nächsten Baustein übergeben. Zum Beispiel übergibt der Trigger **Incident → On Create** den neuen Vorfall, sodass der nächste Baustein dessen Titel, Beschreibung, Schweregrad und jedes andere Feld lesen kann.

### Am häufigsten genutzte Ereignisse

- **Incident** – reagieren, wenn ein Vorfall eröffnet, geändert (bestätigt, behoben) oder gelöscht wird.
- **Alert** – dieselben drei für Alarme.
- **Monitor** – reagieren, wenn ein Monitor hinzugefügt, bearbeitet oder entfernt wird.
- **Scheduled Maintenance** – ein Wartungsfenster automatisch ankündigen, sobald es geplant wird.
- **Status Page Subscriber** – jemanden begrüßen, der eine Statusseite abonniert.
- **On-Call Duty Policy** – Zeitplanänderungen mit einem anderen Bereitschaftssystem synchronisieren.

Durchsuchen Sie das Panel **Add Trigger** nach dem Namen, um den gewünschten zu finden.

## Welchen Trigger sollte ich verwenden?

| Wenn Sie …                              | Wählen               |
| ----------------------------------------- | -------------------- |
| einen Knopf drücken wollen, um den Workflow auszuführen | **Manual**            |
| nach einem wiederkehrenden Zeitplan ausführen wollen    | **Schedule**          |
| ein anderes System Daten hineinschieben lassen wollen   | **Webhook**           |
| auf etwas innerhalb von OneUptime reagieren wollen      | **OneUptime event**   |

Ein Workflow kann nur einen Trigger haben. Wenn Sie zwei Wege benötigen, um dieselbe Automatisierung zu starten, bauen Sie die gemeinsame Logik in einem Workflow und rufen Sie sie aus zwei schlanken „Wrapper"-Workflows mit der Komponente **Execute Workflow** auf.

## Weiterführende Themen

- [Workflow-Komponenten](/docs/workflows/components) – die Aktionen, die Sie nach dem Trigger hinzufügen.
- [Workflow-Variablen](/docs/workflows/variables) – die Ausgabe des Triggers aus späteren Bausteinen lesen.
- [Workflow-Ausführungen & Protokolle](/docs/workflows/runs-and-logs) – bestätigen, dass Ihr Trigger ausgelöst hat.
