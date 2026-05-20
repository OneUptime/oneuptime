# Workflows – Übersicht

Workflows sind der visuelle Automatisierungs-Builder von OneUptime. Ziehen Sie einen Trigger auf eine Arbeitsfläche, verkabeln Sie ihn mit einer Kette von Aktionen — HTTP-Aufrufe, Slack-Nachrichten, JavaScript-Snippets, bedingte Verzweigungen, Datenbank-Lookups — und Sie haben eine Automatisierung, die immer dann läuft, wenn ein Ereignis in OneUptime (oder in der Außenwelt) feuert.

Wenn Runbooks Checklisten für Menschen während eines Vorfalls sind, dann sind Workflows Hintergrundjobs für Ihr Projekt — sie laufen unbeaufsichtigt, sie reagieren auf Dinge und sie verbinden OneUptime mit dem Rest Ihres Stacks.

## Auf einen Blick

- **Top-Level-Feature** im OneUptime-Dashboard unter **Workflows**.
- **Drei Trigger-Stile**: Manuell, Zeitplan (cron), Webhook — plus ein **Modellereignis-Trigger**, der feuert, wenn eine OneUptime-Entität (Vorfall, Warnmeldung, Monitor, Statusseite usw.) erstellt, aktualisiert oder gelöscht wird.
- **Visuelle Arbeitsfläche**: Knoten aus einer Komponentenpalette ziehen, Ausgabeports mit Eingabeports verbinden.
- **Gemischte Automatisierung**: HTTP-Anfragen, Slack-/Discord-/Microsoft Teams-/Telegram-Nachrichten, benutzerdefiniertes JavaScript, JSON-Parsing, bedingte Anweisungen, E-Mail, Aufrufe von Sub-Workflows und CRUD-Operationen auf OneUptime-Modellen.
- **Globale Variablen**: projektweite Geheimnisse und Konfiguration, die Sie aus jedem Workflow ohne Copy-Paste referenzieren.
- **Ausführungen & Protokolle**: jede Ausführung wird mit Status, Zeitmessung und Ausgabe pro Schritt aufgezeichnet.

## Warum Workflows verwenden?

Die meisten Teams greifen zu Workflows, wenn sie Folgendes wollen:

- **OneUptime mit einem anderen System verbinden** — einen Vorfall zu PagerDuty posten, eine Warnmeldung in Jira spiegeln, einen Webhook in Ihrem Stack anpingen.
- **Auf OneUptime-Ereignisse reagieren** — wenn ein `Sev 1`-Vorfall geöffnet wird, den diensthabenden Manager piepen *und* ein Linear-Ticket erstellen *und* ein Feature-Flag sperren.
- **Wiederkehrende Jobs planen** — alle fünf Minuten ein internes API abfragen und das Ergebnis in ein externes System schreiben.
- **Daten von außerhalb OneUptime empfangen** — ein Webhook von einem CI-System stößt eine Kette von OneUptime-Updates an.
- **Kleine Stücke Klebelogik wiederverwenden** — ein Workflow ruft einen anderen auf, sodass häufige Muster an einem Ort leben.

## Schlüsselbegriffe

| Begriff | Bedeutung |
| --- | --- |
| **Workflow** | Die Arbeitsfläche. Ein benannter, wiederverwendbarer Graph aus Triggern und Komponenten mit einem `isEnabled`-Flag. |
| **Trigger** | Der Knoten, der eine Workflow-Ausführung startet. Manuell, Zeitplan, Webhook oder ein Modellereignis. Jeder Workflow hat genau einen Trigger. |
| **Komponente** | Ein Knoten, der Arbeit erledigt — ein HTTP-Aufruf, eine Slack-Nachricht, ein JavaScript-Snippet, eine bedingte Anweisung usw. |
| **Port** | Eine Eingabe- oder Ausgabe-Buchse an einem Knoten. Komponenten haben Ausgabeports wie `success` und `error`; Sie verbinden einen Port mit dem Eingabeport des nächsten Knotens. |
| **Ausführung / Protokoll** | Eine Ausführung eines Workflows. Enthält den Zeitstempel, den Status (Running, Success, Failed, Timeout) und die erfasste Ausgabe jedes ausgeführten Knotens. |
| **Globale Variable** | Ein benannter Wert (oft ein Geheimnis oder API-Schlüssel), der einmal auf Projektebene definiert und aus jedem Workflow als `{{variable.NAME}}` referenziert wird. |
| **Lokale Variable** | Ein auf eine einzelne Workflow-Ausführung beschränkter Wert — typischerweise der Rückgabewert eines früheren Knotens, referenziert als `{{ComponentId.portName}}`. |

## Wo Workflows im Dashboard leben

| Seite | Was Sie dort tun |
| --- | --- |
| **Workflows** | Workflow-Vorlagen durchsuchen, erstellen und suchen. |
| **Builder-Tab eines Workflows** | Die Drag-and-Drop-Arbeitsfläche. Knoten hinzufügen, Ports verbinden, Argumente konfigurieren. |
| **Logs-Tab eines Workflows** | Jede Ausführung dieses Workflows mit Filtern für Status und Zeitbereich. Klicken Sie auf eine Ausführung, um die Ausgabe pro Knoten zu sehen. |
| **Settings-Tab eines Workflows** | Umbenennen, aktivieren/deaktivieren, Beschreibung ändern, Labels verwalten, löschen. |
| **Workflows → Global Variables** | Projektweite Werte definieren, die aus jedem Workflow referenziert werden. Markieren Sie einen Wert als Geheimnis, um ihn nach dem Speichern in der UI zu verbergen. |
| **Workflows → Runs & Logs** | Projektweite Ausführungshistorie über alle Workflows hinweg. |

## Der Lebenszyklus eines Workflows

1. **Verfassen** — Erstellen Sie einen Workflow, legen Sie einen Trigger auf die Arbeitsfläche, ziehen Sie die benötigten Komponenten hinein, verbinden Sie sie und konfigurieren Sie jede einzelne.
2. **Aktivieren** — Workflows werden deaktiviert ausgeliefert. Legen Sie den Schalter in den Einstellungen um, sobald Sie sich sicher sind, dass die Verkabelung stimmt.
3. **Auslösen** — Manuell: Klicken Sie auf **Manuell ausführen** mit einem optionalen JSON-Payload. Zeitplan: cron feuert. Webhook: Ein externes System sendet `POST` an die Workflow-URL. Modellereignis: Jemand (oder ein anderer Workflow) erstellt/aktualisiert/löscht einen Monitor, Vorfall, eine Warnmeldung usw.
4. **Ausführen** — Der Workflow-Worker durchläuft den Graphen der Reihe nach. Jede Komponente liest ihre Argumente (literale Werte oder interpolierte Variablen), erledigt ihre Aufgabe, schreibt ihren Rückgabewert und wählt einen Ausgabeport. Der nächste Knoten feuert.
5. **Prüfen** — Die Ausführung erscheint unter **Logs**. Status, Gesamtdauer, Ausgabe pro Komponente und etwaige Fehler werden für die Lebensdauer des Projekts aufbewahrt.

## Ein durchgespieltes Beispiel

Ziel: Wenn ein Vorfall mit `Sev 1` im Titel erstellt wird, in einen Slack-Kanal posten und ein Ticket in Ihrem internen Admin-Tool öffnen.

**1. Workflow erstellen** mit dem Namen „Sev 1 Fan-out".

**2. Trigger ablegen.** Wählen Sie den Trigger **Incident → On Create** aus der Palette. Der Trigger gibt den neuen Vorfall als Rückgabewert frei.

**3. Eine Conditional-Komponente ablegen.** Verbinden Sie den Ausgabeport des Triggers mit ihrem Eingabeport. Bedingung setzen: `{{Incident.title}}` *enthält* `Sev 1`.

**4. Vom `yes`-Port der Conditional eine Slack-Komponente ablegen.** Kanal: `#incident-room`. Nachrichtentext: `Sev 1 declared: {{Incident.title}} — {{Incident.dashboardUrl}}`.

**5. Vom gleichen `yes`-Port (parallel) eine API-Komponente ablegen.** `POST` an `https://admin.internal/incidents`. Body: ein kleines JSON-Objekt, gebaut aus dem Vorfall.

**6. Workflow aktivieren.** Öffnen Sie in einem anderen Tab einen Vorfall mit dem Titel „Sev 1 — checkout 500s". Innerhalb weniger Sekunden trifft die Slack-Nachricht ein, und eine neue Ausführung erscheint unter **Logs** mit der erfassten Ausgabe jedes Knotens.

## Wie Workflows zum Rest von OneUptime passen

- **Monitore** erkennen Probleme; **Vorfälle/Warnmeldungen** zeichnen sie auf; **Workflows** reagieren darauf — Nachrichten posten, Tickets öffnen, Automatisierung anstoßen.
- **Runbooks** sind Reaktionsverfahren für Menschen (mit optionalen Skript-Schritten). Workflows sind unbeaufsichtigte Hintergrund-Automatisierung. Sie ergänzen sich — ein Runbook-Schritt könnte einen `POST` an einen Webhook-Trigger eines Workflows senden.
- **Workspace-Verbindungen** (Slack, Microsoft Teams) sind die typischen Ziele für Workflow-Benachrichtigungen.
- **Dashboards** sind schreibgeschützte Ansichten; Workflows sind die Schreibseite — sie aktualisieren den OneUptime-Status, rufen externe APIs auf und bewegen Daten umher.

## Wo weiterlesen

- [Einen Workflow erstellen](/docs/workflows/authoring) — einen Workflow auf der Arbeitsfläche aufbauen, Knoten konfigurieren, Ports verkabeln.
- [Trigger](/docs/workflows/triggers) — Manuelle, Zeitplan-, Webhook- und Modellereignis-Trigger im Detail.
- [Komponenten](/docs/workflows/components) — der Katalog der Aktionen und wie jede konfiguriert wird.
- [Variablen](/docs/workflows/variables) — globale Variablen, lokale Variablen und wie die Interpolation funktioniert.
- [Ausführungen & Protokolle](/docs/workflows/runs-and-logs) — Ausführungshistorie lesen, Fehler debuggen.
- [Konfiguration & Sicherheit](/docs/workflows/configuration) — Aktivieren/Deaktivieren, Ownership, Labels, Geheimnisse, Rekursionsgrenzen.
