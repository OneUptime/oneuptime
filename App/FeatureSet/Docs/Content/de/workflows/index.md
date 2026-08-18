# Workflows – Übersicht

Mit Workflows automatisieren Sie Aufgaben in OneUptime, ohne Code schreiben zu müssen. Fügen Sie ein paar Bausteine auf einer Arbeitsfläche hinzu, verbinden Sie sie miteinander, und schon haben Sie eine Automatisierung, die ausgeführt wird, sobald etwas passiert – ein Vorfall wird eröffnet, ein Zeitplan löst aus, oder ein anderes Tool sendet Daten an OneUptime.

Stellen Sie sich Workflows als Hintergrund-Helfer für Ihr Projekt vor: Sie reagieren auf Ereignisse, kommunizieren mit anderen Tools und halten alles im Hintergrund synchron, während Sie sich auf Ihre eigentliche Arbeit konzentrieren.

## Wofür Sie Workflows nutzen können

- **OneUptime mit Ihren anderen Tools verbinden** – Vorfälle an Slack senden, Jira-Tickets erstellen, an einen Webhook in Ihrem Stack posten.
- **Auf Ereignisse in OneUptime reagieren** – wenn ein kritischer Vorfall erstellt wird, das Bereitschaftsteam benachrichtigen und automatisch ein Ticket öffnen.
- **Aufgaben zeitgesteuert ausführen** – alle fünf Minuten, jede Nacht, jeden Montagmorgen.
- **Daten von außen empfangen** – andere Systeme können über eine eindeutige URL Daten an OneUptime senden.
- **Wiederverwendbare Automatisierung aufbauen** – einmal erstellt, aus jedem anderen Workflow heraus aufrufbar.

## So funktioniert ein Workflow

Jeder Workflow besteht aus drei Teilen:

1. **Ein Trigger** – was den Workflow startet. Das kann ein manueller Knopf, ein Zeitplan, ein eingehender Webhook oder ein Ereignis in OneUptime sein (zum Beispiel ein neuer Vorfall).
2. **Eine oder mehrere Komponenten** – was der Workflow tut. Eine Nachricht senden, einen HTTP-Aufruf machen, eine kurze Prüfung durchführen, abhängig von einer Bedingung verzweigen.
3. **Verbindungen zwischen ihnen** – Sie ziehen Linien von einem Baustein zum nächsten, um die Reihenfolge festzulegen.

All das bauen Sie visuell auf einer Arbeitsfläche zusammen. Für die meisten Workflows ist keine Programmierung nötig – Sie können bei Bedarf aber ein Stück JavaScript hinzufügen.

## Wichtige Begriffe

| Begriff              | Bedeutung                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------- |
| **Workflow**          | Die gesamte Automatisierung – ein Name, eine Arbeitsfläche und ein Schalter zum Ein- oder Ausschalten. |
| **Trigger**           | Der erste Baustein. Er entscheidet, wann der Workflow läuft. Jeder Workflow hat genau einen Trigger. |
| **Komponente**        | Ein Aktionsbaustein – sendet eine Nachricht, stellt eine Anfrage, prüft eine Bedingung.        |
| **Ausführung**        | Eine einzelne Ausführung des Workflows. Gespeichert mit Zeitstempeln und der Ausgabe jedes Bausteins. |
| **Globale Variable**  | Ein Wert (wie ein API-Schlüssel), den Sie einmal speichern und in jedem Workflow wiederverwenden. |

## Wo Sie Workflows in OneUptime finden

Öffnen Sie **Workflows** in der linken Navigation. Dieser Bereich enthält:

- **Workflows** – Ihre Liste der Workflows. Erstellen Sie einen neuen oder öffnen Sie einen vorhandenen.
- **Global Variables** – Werte, die für alle Ihre Workflows gemeinsam genutzt werden.
- **Runs & Logs** – Ausführungsverlauf über alle Workflows in Ihrem Projekt hinweg.

Öffnen Sie einen einzelnen Workflow, und sein eigenes linkes Menü enthält:

- **Overview** – Name, Beschreibung, Beschriftungen und der Schalter **Enabled**.
- **Builder** – die Arbeitsfläche, auf der Sie den Workflow gestalten.
- **Workflow Variables** – Werte, die auf diesen einen Workflow beschränkt sind.
- **Runs & Logs** – jede Ausführung dieses Workflows mit Details.
- **Settings** – Webhook-Geheimnis, Duplizieren und Export.

## Ihren ersten Workflow erstellen

1. **Create** – wählen Sie einen Ausgangspunkt, geben Sie dann Ihrem Workflow einen Namen.
2. **Trigger auswählen** – manuell, zeitgesteuert, Webhook oder ein Ereignis aus OneUptime.
3. **Komponenten hinzufügen** – Aktionen auf die Arbeitsfläche ziehen und verbinden.
4. **Einschalten** – schalten Sie **Enabled** auf der **Overview**-Seite ein. Ein deaktivierter Workflow kann überhaupt nicht laufen, auch nicht von Hand.
5. **Testen** – klicken Sie im Builder auf **Run Workflow** und beobachten Sie das Ausführungsprotokoll.

## Ein kurzes Beispiel

Angenommen, Sie möchten in Slack posten, sobald ein kritischer Vorfall erstellt wird:

1. Erstellen Sie einen Workflow mit dem Namen „Kritische Vorfälle an Slack".
2. Wählen Sie den Trigger **On Create Incident**.
3. Fügen Sie einen Baustein **If / Else** hinzu. Stellen Sie ihn so ein, dass er prüft, ob der Vorfallstitel „Sev 1" enthält.
4. Fügen Sie aus dem **Yes**-Zweig einen **Slack**-Baustein hinzu. Wählen Sie den Kanal und schreiben Sie die Nachricht.
5. Schalten Sie den Workflow ein.

Beim nächsten Vorfall mit „Sev 1" im Titel leuchtet Slack auf.

## Wie Workflows in OneUptime hineinpassen

- **Monitore** erkennen das Problem. **Vorfälle** halten es fest. **Workflows** reagieren darauf.
- **Runbooks** sind schrittweise Anleitungen für Menschen. Workflows sind unbeaufsichtigte Automatisierung. Nutzen Sie ein Runbook, wenn ein Mensch entscheiden muss; nutzen Sie einen Workflow, wenn die Schritte automatisch ablaufen.
- **Workspace-Verbindungen** (Slack, Teams) sind das Ziel, an das Workflows ihre Nachrichten senden.

## Weiterführende Themen

- [Einen Workflow erstellen](/docs/workflows/authoring) – Arbeit auf der Arbeitsfläche.
- [Workflow-Trigger](/docs/workflows/triggers) – die verschiedenen Wege, einen Workflow zu starten.
- [Workflow-Komponenten](/docs/workflows/components) – die Bausteine, die Sie hinzufügen können.
- [Workflow-Variablen](/docs/workflows/variables) – Werte über Bausteine und Workflows hinweg nutzen.
- [Workflow-Ausführungen & Protokolle](/docs/workflows/runs-and-logs) – nachvollziehen, was passiert ist.
- [Workflow-Konfiguration & Sicherheit](/docs/workflows/configuration) – wissenswerte Einstellungen.
