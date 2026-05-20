# Trigger

Ein Trigger ist der Startknoten eines Workflows. Er hat keinen Eingabeport — die Ausführung beginnt hier. OneUptime unterstützt vier Trigger-Familien; jeder Workflow verwendet genau einen.

## Manuell

Führen Sie einen Workflow auf Anforderung aus, indem Sie auf **Manuell ausführen** auf der Workflow-Seite klicken. Sie können einen optionalen JSON-Payload einfügen, den der Workflow als `{{Manual.JSON}}` lesen kann.

Verwenden Sie diesen Trigger, wenn Sie einen Button möchten, der eine Automatisierung auslöst — einen Ein-Klick-Workflow „Bereitschaftsschlüssel rotieren" oder „Suchindex neu aufbauen", der keinen wiederkehrenden Zeitplan oder ein auslösendes Ereignis benötigt.

**Argumente**: keine.

**Rückgabewerte**:

| Name | Typ | Beschreibung |
| --- | --- | --- |
| `JSON` | JSON | Der zur Laufzeit übergebene JSON-Payload oder ein leeres Objekt. |

## Zeitplan

Führen Sie einen Workflow nach einem Cron-Zeitplan aus. Konfigurieren Sie die Kadenz mit einem standardmäßigen Cron-Ausdruck.

Verwenden Sie dies für wiederkehrende Jobs: nächtliche Bereinigung, stündliche Synchronisierung, wöchentlicher Export.

**Argumente**:

| Name | Typ | Beschreibung |
| --- | --- | --- |
| `Schedule at` | CronTab | Standard-Cron-Ausdruck mit 5 Feldern. Zum Beispiel läuft `0 * * * *` zur vollen Stunde, `*/5 * * * *` alle fünf Minuten. |

**Rückgabewerte**:

| Name | Typ | Beschreibung |
| --- | --- | --- |
| `executedAt` | Date | Die geplante Ausführungszeit. |

Geplante Workflows laufen auf dem Workflow-Worker in der Region des Projekts. Wenn der Worker kurzzeitig nicht verfügbar ist, wird die Ausführung versendet, wenn er sich erholt — Sie müssen sich bei kurzen Ausfällen nicht gegen verpasste Ticks absichern.

## Webhook

Stellen Sie eine eindeutige HTTPS-URL bereit, an die ein externes System `POST`s sendet. Die Anfrage-Header, Query-Parameter und der Body werden als Rückgabewerte bereitgestellt, die nachgelagerte Komponenten lesen können.

Verwenden Sie dies, um Daten *nach* OneUptime von einem Drittsystem zu empfangen: CI/CD-Callbacks, Warnmeldungen aus einem anderen Monitoring-Tool, Kunden-Anmeldungen in Ihrem CRM.

**Argumente**: keine. Die URL wird automatisch zugewiesen, wenn der Workflow gespeichert wird, und auf dem Trigger-Knoten angezeigt. Behandeln Sie sie wie ein Geheimnis — jeder mit der URL kann den Workflow auslösen.

**Rückgabewerte**:

| Name | Typ | Beschreibung |
| --- | --- | --- |
| `Request Headers` | JSON | Alle Header aus der eingehenden HTTP-Anfrage. |
| `Request Query Params` | JSON | Geparster Query-String. |
| `Request Body` | JSON | Geparster Anfrage-Body. Wenn der Body kein gültiges JSON ist, kommt er als String unter dem Schlüssel `raw` an. |

Der Webhook akzeptiert `GET` und `POST`. Die Antwort an den Aufrufer ist ein `200 OK` mit einer JSON-Bestätigung, sobald die Ausführung in die Warteschlange gestellt ist — der Workflow selbst läuft asynchron, erwarten Sie also nicht, das Ergebnis nachgelagerter Komponenten in der HTTP-Antwort zu lesen.

## Modellereignis-Trigger

Fast jede OneUptime-Entität — Monitore, Vorfälle, Warnmeldungen, geplante Wartungsereignisse, Statusseiten, Bereitschaftspläne, Teams, Telemetrie-Services und viele mehr — stellt drei Trigger bereit:

- **On Create** — feuert, wenn ein neuer Datensatz dieses Typs erstellt wird.
- **On Update** — feuert, wenn ein bestehender Datensatz geändert wird. Der Trigger stellt sowohl die alten als auch die neuen Werte bereit.
- **On Delete** — feuert, wenn ein Datensatz gelöscht wird.

So bauen Sie „wenn X in OneUptime passiert, tue Y"-Automatisierung ohne Polling.

Das Modell selbst wird als Rückgabewert mit den gleichen Feldnamen bereitgestellt, die Sie auf der Ressource sehen. Zum Beispiel gibt der Trigger **Incident → On Create** das gesamte `Incident`-Objekt zurück, sodass nachgelagerte Knoten `{{Incident.title}}`, `{{Incident.description}}`, `{{Incident.incidentSeverityId}}` usw. lesen können.

**Argumente**: typischerweise keine für create/delete. Update-Trigger erlauben es Ihnen möglicherweise, die Felder einzugrenzen, auf die Sie reagieren möchten, sodass Sie nicht auf kosmetische Änderungen feuern.

**Rückgabewerte** (variiert je nach Modell):

| Name | Typ | Beschreibung |
| --- | --- | --- |
| Modellfelder | (variiert) | Jede Spalte der Entität — Name, Status, Zeitstempel, Fremdschlüssel. |
| `previous` (nur Update) | JSON | Der Datensatz, wie er vor der Änderung war. |

### Häufige Modell-Trigger

Eine nicht erschöpfende Liste der Modellereignisse, zu denen Teams am häufigsten greifen:

- **Incident** — `On Create`, `On Update` (verwenden, um auf Zustandsänderungen wie Acknowledged oder Resolved zu reagieren), `On Delete`.
- **Alert** — dieselben drei Ereignisse auf dem Warnmeldungs-Modell.
- **Monitor** — reagieren, wenn ein Monitor hinzugefügt, bearbeitet oder entfernt wird; mit Bedingungen kombinieren, um nur auf Produktionsmonitore zu reagieren.
- **Scheduled Maintenance** — automatisieren Sie nachgelagerte Ankündigungen, wenn ein Wartungsfenster erstellt wird oder sich sein Zustand ändert.
- **Status Page Subscriber** — einen Willkommens-Flow auslösen, wenn sich jemand anmeldet.
- **On-Call Duty Policy** — Zeitplanänderungen mit einem externen Dienstplan synchronisieren.

Wenn das Modell im OneUptime-API verfügbar ist, kann es mit hoher Wahrscheinlichkeit einen Workflow auslösen — durchsuchen Sie die Trigger-Palette nach dem Entitätsnamen.

## Den richtigen Trigger wählen

| Wenn Sie wollen… | Verwenden Sie |
| --- | --- |
| Einen Button in einem Workflow, den jemand klickt | **Manuell** |
| Einen Job alle N Minuten/Stunden/Tage ausführen | **Zeitplan** |
| Ein externes System Daten in OneUptime einspeisen lassen | **Webhook** |
| Auf etwas reagieren, das *innerhalb* OneUptime passiert | **Modellereignis** |

Workflows können nur einen Trigger haben. Wenn Sie zwei verschiedene Startsignale benötigen, die den größten Teil derselben Logik teilen, gliedern Sie die gemeinsamen Schritte in einen Workflow aus und rufen Sie ihn aus zwei dünnen „Wrapper"-Workflows mit der Komponente **Execute Workflow** auf (siehe [Komponenten](/docs/workflows/components)).

## Wo weiterlesen

- [Komponenten](/docs/workflows/components) — die Aktionen, die Sie nach dem Trigger verkabeln.
- [Variablen](/docs/workflows/variables) — wie Trigger-Rückgabewerte von nachgelagerten Knoten gelesen werden.
- [Ausführungen & Protokolle](/docs/workflows/runs-and-logs) — wie Sie bestätigen, dass Ihr Trigger feuert.
