# Workflows – Übersicht

Mit Workflows automatisieren Sie Aufgaben in OneUptime, ohne Code zu schreiben. Setzen Sie ein paar Bausteine auf eine Arbeitsfläche, verbinden Sie sie miteinander, und schon haben Sie eine Automatisierung, die immer dann läuft, wenn etwas passiert – ein Vorfall wird eröffnet, ein Zeitplan feuert, oder ein anderes Tool schickt Daten an OneUptime.

Denken Sie sich Workflows als Helfer im Hintergrund Ihres Projekts: Sie reagieren auf Ereignisse, sprechen mit anderen Tools und halten still und leise Dinge im Gleichklang, während Sie sich um Ihre eigentliche Arbeit kümmern.

## Was Sie mit Workflows tun können

- **OneUptime mit Ihren übrigen Tools verbinden** – Vorfälle an Slack schicken, Jira-Tickets anlegen, an einen Webhook in Ihrem Stack posten.
- **Auf das reagieren, was in OneUptime passiert** – wird ein kritischer Vorfall angelegt, das Bereitschaftsteam benachrichtigen und automatisch ein Ticket eröffnen.
- **Aufgaben nach Zeitplan ausführen** – alle fünf Minuten, jede Nacht, jeden Montagmorgen.
- **Daten von außen entgegennehmen** – andere Systeme über eine eindeutige URL Daten nach OneUptime schieben lassen.
- **Wiederkehrende Automatisierung wiederverwenden** – einmal bauen, aus jedem anderen Workflow heraus aufrufen.

## So funktioniert ein Workflow

Jeder Workflow besteht aus drei Teilen:

1. **Ein Trigger** – was den Workflow startet. Das kann ein Knopf von Hand sein, ein Zeitplan, ein eingehender Webhook oder ein Ereignis in OneUptime (etwa ein neuer Vorfall).
2. **Eine oder mehrere Komponenten** – was der Workflow tut. Eine Nachricht senden, einen HTTP-Aufruf machen, schnell etwas prüfen, anhand einer Bedingung verzweigen.
3. **Verbindungen dazwischen** – Sie ziehen Linien von einem Baustein zum nächsten und legen damit die Reihenfolge fest.

Das alles bauen Sie sichtbar auf einer Arbeitsfläche. Für die meisten Workflows brauchen Sie keine Zeile Code, auch wenn Sie ein Stück JavaScript ergänzen können, wenn es nötig wird.

## Zentrale Begriffe

| Begriff              | Was er bedeutet                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| **Workflow**        | Die ganze Automatisierung – ein Name, eine Arbeitsfläche und ein Schalter zum Ein- und Ausschalten.       |
| **Trigger**         | Der erste Baustein. Er entscheidet, wann der Workflow läuft. Jeder Workflow hat genau einen Trigger.    |
| **Komponente**      | Ein Baustein, der handelt – sendet eine Nachricht, stellt eine Anfrage, prüft eine Bedingung.           |
| **Ausführung**      | Ein Durchlauf des Workflows. Gespeichert mit Zeitstempeln und der Ausgabe jedes Bausteins.              |
| **Globale Variable** | Ein Wert (etwa ein API-Schlüssel), den Sie einmal ablegen und in jedem Workflow wiederverwenden.        |

## Wo Sie Workflows in OneUptime finden

Öffnen Sie **Arbeitsabläufe** in der linken Navigation. Dieser Abschnitt enthält:

- **Arbeitsabläufe** – Ihre Liste der Workflows. Legen Sie einen neuen an oder öffnen Sie einen bestehenden.
- **Globale Variablen** – Werte, die alle Ihre Workflows gemeinsam nutzen.
- **Ausführungen & Protokolle** – die Ausführungshistorie über alle Workflows Ihres Projekts hinweg.

Öffnen Sie einen einzelnen Workflow, enthält dessen eigenes linkes Menü:

- **Übersicht** – Name, Beschreibung, Beschriftungen und den Schalter **Aktiviert**.
- **Builder** – die Arbeitsfläche, auf der Sie den Workflow entwerfen.
- **Workflow-Variablen** – Werte, die nur für diesen einen Workflow gelten.
- **Ausführungen & Protokolle** – jede Ausführung dieses Workflows, mit Details.
- **Einstellungen** – Webhook-Secret, Duplizieren und Export.

## Ihren ersten Workflow bauen

1. **Anlegen** – wählen Sie einen Startpunkt und geben Sie Ihrem Workflow einen Namen.
2. **Trigger wählen** – von Hand, nach Zeitplan, per Webhook oder ein Ereignis aus OneUptime.
3. **Komponenten hinzufügen** – setzen Sie Aktionen auf die Arbeitsfläche und verbinden Sie sie.
4. **Einschalten** – schalten Sie **Aktiviert** auf der Seite **Übersicht** ein. Ein deaktivierter Workflow läuft überhaupt nicht, nicht einmal von Hand.
5. **Testen** – klicken Sie im Builder auf **Arbeitsablauf ausführen** und verfolgen Sie das Ausführungsprotokoll.

## Ein kurzes Beispiel

Angenommen, Sie wollen in Slack posten, sobald ein kritischer Vorfall angelegt wird:

1. Legen Sie einen Workflow namens „Kritische Vorfälle nach Slack“ an.
2. Wählen Sie den Trigger **On Create Incident**.
3. Fügen Sie einen Baustein **If / Else** hinzu. Stellen Sie ihn so ein, dass er prüft, ob der Vorfalltitel „Sev 1“ enthält.
4. Hängen Sie an den Zweig **Ja** einen Baustein **Slack**. Wählen Sie den Kanal und schreiben Sie die Nachricht.
5. Schalten Sie den Workflow ein.

Wenn das nächste Mal jemand einen Vorfall mit „Sev 1“ im Titel eröffnet, leuchtet Slack auf.

## Wie Workflows zum Rest von OneUptime passen

- **Monitore** entdecken das Problem. **Vorfälle** halten es fest. **Arbeitsabläufe** reagieren darauf.
- **Runbooks** sind Schritt-für-Schritt-Anleitungen für Menschen. Workflows sind unbeaufsichtigte Automatisierung. Nehmen Sie ein Runbook, wenn ein Mensch entscheiden muss; nehmen Sie einen Workflow, wenn die Schritte von selbst laufen.
- **Arbeitsbereich-Verbindungen** (Slack, Teams) sind die Stellen, an die Workflows ihre Nachrichten schicken.

## Weiterführende Themen

- [Einen Workflow erstellen](/docs/workflows/authoring) – auf der Arbeitsfläche bauen.
- [Workflow-Trigger](/docs/workflows/triggers) – die verschiedenen Arten, wie ein Workflow starten kann.
- [Workflow-Komponenten](/docs/workflows/components) – die Bausteine, die Sie hinzufügen können.
- [Workflow-Variablen](/docs/workflows/variables) – Werte über Bausteine und Workflows hinweg nutzen.
- [Workflow-Ausführungen & Protokolle](/docs/workflows/runs-and-logs) – nachsehen, was passiert ist.
- [Workflow-Konfiguration & Sicherheit](/docs/workflows/configuration) – Einstellungen, die Sie kennen sollten.
