# Trigger

Ein Trigger ist der erste Baustein eines Workflows – er entscheidet, wann der Workflow läuft. Jeder Workflow hat genau einen Trigger. Sie haben die Wahl zwischen vier Arten.

## Manual

Führen Sie den Workflow bei Bedarf aus: Klicken Sie auf der Seite **Builder** auf **Arbeitsablauf ausführen**, füllen Sie die Felder des Triggers aus und bestätigen Sie mit **Run Workflow Manually**. Der Manual-Trigger nimmt eine JSON-Payload entgegen, die der Rest des Workflows lesen kann.

Gut geeignet für: Automatisierungen auf Knopfdruck, für die Sie einen Knopf haben wollen – „diesen Schlüssel rotieren“ oder „eine Testwarnung schicken“.

**Output**: das JSON, das Sie eingefügt haben, oder ein leeres Objekt, wenn Sie keines eingefügt haben.

## Zeitplan

Den Workflow über einen Cron-Ausdruck nach einem wiederkehrenden Zeitplan ausführen.

Gut geeignet für: nächtliches Aufräumen, stündliches Synchronisieren, Wochenberichte.

**Einstellung**: ein Cron-Ausdruck. Ein paar gängige:

- `0 * * * *` – jede Stunde, zur vollen Stunde.
- `*/5 * * * *` – alle 5 Minuten.
- `0 9 * * 1` – jeden Montag um 9:00 Uhr.

Ist das System kurz nicht verfügbar, wird die Ausführung nachgeholt, sobald es sich erholt hat – um verpasste Takte bei kurzen Ausfällen müssen Sie sich also keine Sorgen machen.

## Webhook

OneUptime erzeugt eine eindeutige URL. Alles, was diese URL aufruft, startet den Workflow. Header, Query-Parameter und Body der Anfrage werden hineingereicht.

Gut geeignet für: Daten aus einem anderen Tool nach OneUptime hereinholen – Rückmeldungen aus CI/CD, Warnungen aus anderem Monitoring, Anmeldungen in Ihrem CRM.

**Output**:

- **Request Headers** – alle Header der eingehenden Anfrage.
- **Request Query Params** – der geparste Query-String.
- **Request Body** – der geparste Body (oder der rohe Text, wenn es kein JSON ist).

Die URL nimmt sowohl `GET` als auch `POST` an. Der Aufrufer bekommt eine schnelle Bestätigung – der Workflow selbst läuft im Hintergrund.

Behandeln Sie die URL wie ein Passwort. Wer sie hat, kann Ihren Workflow starten.

## OneUptime-Ereignis-Trigger

Fast alles in OneUptime – Monitore, Vorfälle, Warnungen, geplante Wartungen, Statusseiten, Bereitschaftsrichtlinien, Teams – kann einen Workflow auslösen. Jedes davon bietet drei Ereignisse:

- **On Create** – feuert, wenn ein neuer Datensatz hinzukommt.
- **On Update** – feuert, wenn einer geändert wird.
- **On Delete** – feuert, wenn einer gelöscht wird.

So bauen Sie „wenn X in OneUptime passiert, tu Y“, ohne in einer Schleife nachsehen zu müssen.

Der vollständige Datensatz wird an den nächsten Baustein weitergereicht. Der Trigger **Vorfall → On Create** reicht zum Beispiel den neuen Vorfall weiter, sodass der nächste Baustein dessen Titel, Beschreibung, Schweregrad und jedes andere Feld lesen kann.

### Ereignisse, die Teams am häufigsten nutzen

- **Vorfall** – reagieren, wenn ein Vorfall eröffnet, geändert (bestätigt, gelöst) oder gelöscht wird.
- **Warnung** – dieselben drei für Warnungen.
- **Monitor** – reagieren, wenn ein Monitor hinzugefügt, bearbeitet oder entfernt wird.
- **Geplante Wartung** – ein Wartungsfenster automatisch ankündigen, sobald es geplant ist.
- **Statusseite Abonnent** – jemanden begrüßen, der eine Statusseite abonniert.
- **Bereitschaftsrichtlinie** – Änderungen am Dienstplan in ein anderes Rostersystem synchronisieren.

Durchsuchen Sie das Panel **Add Trigger** nach dem Namen, um den passenden zu finden.

## Welchen Trigger sollte ich nehmen?

| Wenn Sie …                                       | nehmen Sie             |
| ------------------------------------------------ | ---------------------- |
| den Workflow per Knopfdruck starten wollen        | **Manual**             |
| nach einem wiederkehrenden Zeitplan laufen wollen | **Zeitplan**           |
| Daten aus einem anderen System hereinschieben     | **Webhook**            |
| auf etwas innerhalb von OneUptime reagieren       | **OneUptime-Ereignis** |

Ein Workflow kann nur einen Trigger haben. Brauchen Sie zwei Wege, dieselbe Automatisierung zu starten, bauen Sie die gemeinsame Logik in einen Workflow und rufen ihn aus zwei dünnen „Wrapper“-Workflows mit der Komponente **Execute Workflow** auf.

## Weiterführende Themen

- [Workflow-Komponenten](/docs/workflows/components) – die Aktionen, die Sie nach dem Trigger hinzufügen.
- [Workflow-Variablen](/docs/workflows/variables) – Trigger-Ausgaben aus späteren Bausteinen lesen.
- [Workflow-Ausführungen & Protokolle](/docs/workflows/runs-and-logs) – nachsehen, ob Ihr Trigger ausgelöst hat.
