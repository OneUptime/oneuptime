# Workflows – Überblick

Mit Workflows automatisieren Sie Aufgaben in OneUptime, ohne Code schreiben zu müssen. Ziehen Sie ein paar Bausteine auf eine Arbeitsfläche, verbinden Sie sie miteinander, und schon haben Sie eine Automatisierung, die ausgeführt wird, sobald etwas passiert – ein Vorfall wird geöffnet, ein Zeitplan löst aus, oder ein anderes Tool sendet Daten an OneUptime.

Stellen Sie sich Workflows als Hintergrund-Helfer für Ihr Projekt vor: Sie reagieren auf Ereignisse, kommunizieren mit anderen Tools und halten alles im Hintergrund synchron, während Sie sich auf Ihre eigentliche Arbeit konzentrieren.

## Wofür Sie Workflows nutzen können

- **OneUptime mit Ihren anderen Tools verbinden** – Vorfälle an Slack senden, Jira-Tickets erstellen, Webhooks in Ihrem Stack auslösen.
- **Auf Ereignisse in OneUptime reagieren** – wenn ein kritischer Vorfall erstellt wird, das Bereitschaftsteam benachrichtigen und automatisch ein Ticket öffnen.
- **Aufgaben zeitgesteuert ausführen** – alle fünf Minuten, jede Nacht, jeden Montagmorgen.
- **Daten von außen empfangen** – andere Systeme können Daten über eine eindeutige URL an OneUptime senden.
- **Wiederverwendbare Automatisierung aufbauen** – einmal erstellt, von jedem anderen Workflow aus aufrufbar.

## So funktioniert ein Workflow

Jeder Workflow besteht aus drei Teilen:

1. **Ein Auslöser** – startet den Workflow. Das kann ein manueller Knopf, ein Zeitplan, ein eingehender Webhook oder ein Ereignis in OneUptime sein (zum Beispiel ein neuer Vorfall).
2. **Eine oder mehrere Komponenten** – beschreiben, was der Workflow tut. Eine Nachricht senden, einen HTTP-Aufruf machen, eine kurze Prüfung durchführen, abhängig von einer Bedingung verzweigen.
3. **Verbindungen zwischen ihnen** – Sie ziehen Linien von einem Baustein zum nächsten, um die Reihenfolge festzulegen.

All das bauen Sie visuell auf einer Arbeitsfläche zusammen. Für die meisten Workflows ist keine Programmierung nötig – Sie können bei Bedarf aber jederzeit ein Stück JavaScript einfügen.

## Wichtige Begriffe

| Begriff | Bedeutung |
| --- | --- |
| **Workflow** | Die gesamte Automatisierung – ein Name, eine Arbeitsfläche und ein Schalter zum Ein- oder Ausschalten. |
| **Auslöser** | Der erste Baustein. Er bestimmt, wann der Workflow läuft. Jeder Workflow hat genau einen Auslöser. |
| **Komponente** | Ein Aktionsbaustein – sendet eine Nachricht, stellt eine Anfrage, prüft eine Bedingung. |
| **Ausführung** | Eine einzelne Ausführung des Workflows. Mit Zeitstempeln und der Ausgabe jedes Bausteins gespeichert. |
| **Globale Variable** | Ein Wert (zum Beispiel ein API-Schlüssel), den Sie einmal speichern und in jedem Workflow wiederverwenden. |

## Wo Sie Workflows in OneUptime finden

Öffnen Sie **Workflows** in der linken Navigation. Von dort aus:

- **Workflows** – Ihre Liste der Workflows. Erstellen Sie einen neuen oder öffnen Sie einen vorhandenen.
- **Builder-Tab** – die Arbeitsfläche, auf der Sie den Workflow gestalten.
- **Logs-Tab** – jede Ausführung dieses Workflows mit Details.
- **Einstellungen-Tab** – Name, Beschreibung, Eigentümer, Labels, Aktivieren/Deaktivieren.
- **Globale Variablen** – Werte, die für alle Ihre Workflows gemeinsam genutzt werden.
- **Ausführungen & Logs** – Ausführungsverlauf über alle Workflows in Ihrem Projekt hinweg.

## Ihren ersten Workflow erstellen

1. **Erstellen** – geben Sie Ihrem Workflow einen Namen und eine kurze Beschreibung.
2. **Auslöser auswählen** – manuell, zeitgesteuert, Webhook oder ein Ereignis aus OneUptime.
3. **Komponenten hinzufügen** – Aktionen auf die Arbeitsfläche ziehen und verbinden.
4. **Testen** – auf **Manuell ausführen** klicken und in den Logs verfolgen, was passiert.
5. **Aktivieren** – sobald alles passt, den Schalter **Aktiviert** in den Einstellungen umlegen.

## Ein kurzes Beispiel

Angenommen, Sie möchten in Slack posten, sobald ein kritischer Vorfall erstellt wird:

1. Erstellen Sie einen Workflow mit dem Namen „Kritische Vorfälle an Slack".
2. Wählen Sie den Auslöser **Vorfall → Bei Erstellung**.
3. Fügen Sie einen Baustein **Bedingungen** hinzu. Konfigurieren Sie ihn so, dass er prüft, ob der Vorfallstitel „Sev 1" enthält.
4. Fügen Sie aus dem **Ja**-Zweig einen **Slack**-Baustein hinzu. Wählen Sie den Kanal und schreiben Sie die Nachricht.
5. Schalten Sie den Workflow ein.

Beim nächsten Vorfall mit „Sev 1" im Titel leuchtet Slack auf.

## Wie Workflows in OneUptime hineinpassen

- **Monitore** erkennen das Problem. **Vorfälle** halten es fest. **Workflows** reagieren darauf.
- **Runbooks** sind schrittweise Anleitungen für Menschen. Workflows sind unbeaufsichtigte Automatisierung. Nutzen Sie ein Runbook, wenn ein Mensch entscheiden muss; nutzen Sie einen Workflow, wenn die Schritte automatisch ablaufen.
- **Workspace-Verbindungen** (Slack, Teams) sind die Ziele, an die Workflows ihre Nachrichten senden.

## Weiterführende Themen

- [Workflow erstellen](/docs/workflows/authoring) – Arbeit auf der Arbeitsfläche.
- [Auslöser](/docs/workflows/triggers) – die verschiedenen Wege, einen Workflow zu starten.
- [Komponenten](/docs/workflows/components) – die Bausteine, die Sie hinzufügen können.
- [Variablen](/docs/workflows/variables) – Werte zwischen Bausteinen und Workflows nutzen.
- [Ausführungen & Logs](/docs/workflows/runs-and-logs) – nachvollziehen, was passiert ist.
- [Konfiguration & Sicherheit](/docs/workflows/configuration) – wissenswerte Einstellungen.
