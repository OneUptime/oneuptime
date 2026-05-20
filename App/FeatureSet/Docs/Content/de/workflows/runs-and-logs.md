# Ausführungen & Protokolle

Jedes Mal, wenn ein Workflow-Trigger feuert, erstellt OneUptime eine **Ausführung** — einen Datensatz einer Ausführung mit Zeitmessung, Status und Ausgabe pro Knoten. Ausführungen sind die Art, wie Sie bestätigen, dass ein Workflow funktioniert hat, wie Sie einen debuggen, der es nicht hat, und wie Sie ein Post-Mortem schreiben, wenn eine Automatisierung sich fehlverhält.

## Wo sie zu finden sind

| Seite | Geltungsbereich |
| --- | --- |
| **Workflows → Runs & Logs** | Projektweit. Jede Ausführung jedes Workflows. Filtern nach Workflow, Status und Zeitbereich. |
| **Logs-Tab eines Workflows** | Nur die Ausführungen dieses Workflows. |
| **Detailseite einer Ausführung** | Eine Ausführung, erweitert mit Ausgabe pro Knoten und etwaigen Fehlermeldungen. |

## Ausführungsstatus

| Status | Bedeutung |
| --- | --- |
| **Scheduled** | Der Trigger hat gefeuert und die Ausführung ist in der Warteschlange, aber der Worker hat sie noch nicht aufgegriffen. Üblicherweise ein Bruchteil einer Sekunde. |
| **Running** | Der Worker durchläuft gerade den Graphen. Lang laufende Komponenten (langsame HTTP-Aufrufe, beabsichtigte Verzögerungen) halten eine Ausführung in diesem Zustand. |
| **Success** | Jeder Knoten, der gelaufen ist, wurde ohne Fehler beendet. (Ein Workflow, der absichtlich einen `error`-Zweig genommen hat, ist insgesamt trotzdem `Success` — der Workflow selbst ist nicht fehlgeschlagen.) |
| **Error** | Ein Knoten ist fehlgeschlagen und es war kein `error`-Port verkabelt, um es zu behandeln. Die Ausführung stoppte an diesem Knoten. |
| **Timeout** | Die Ausführung hat das pro-Ausführung-Timeout überschritten. Siehe [Konfiguration & Sicherheit](/docs/workflows/configuration). |

## Eine Ausführung lesen

Klicken Sie in der Liste auf eine Ausführung, um ihre Detailseite zu öffnen. Sie sehen:

- **Header** — den Trigger, der gefeuert hat, den Start- und Endzeitstempel, die Gesamtdauer, den Status.
- **Knotenliste** — jeder Knoten, der der Reihe nach ausgeführt wurde, jeweils mit seinen erfassten Argumenten, seinem Rückgabewert und seinem gewählten Ausgabeport.
- **Fehler** — wenn ein Knoten fehlgeschlagen ist, die Fehlermeldung und (sofern verfügbar) der Stack-Trace.

Die erfassten Argumente zeigen *Post-Interpolations*-Werte — also die exakten Strings, die der Knoten sah, nachdem Variablen aufgelöst wurden. Dies ist die nützlichste einzelne Debugging-Ansicht: Wenn eine Slack-Nachricht den wörtlichen Text `{{Incident.title}}` enthält, wissen Sie, dass die Variablenreferenz nicht aufgelöst wurde.

## Häufige Debugging-Muster

### „Mein Workflow hat nicht gefeuert."

1. Bestätigen Sie, dass der Workflow in **Settings** **aktiviert** ist. Neue Workflows werden deaktiviert ausgeliefert.
2. Für einen Modellereignis-Trigger: bestätigen Sie, dass das Ereignis tatsächlich stattgefunden hat. Öffnen Sie die Entität (den Vorfall, die Warnmeldung, den Monitor) und schauen Sie sich ihren Verlauf an.
3. Für einen Webhook-Trigger: bestätigen Sie, dass das externe System die richtige URL trifft. Viele Tools protokollieren die Zustellung ausgehender Webhooks — schauen Sie dort nach.
4. Für einen Zeitplan-Trigger: bestätigen Sie, dass der Cron-Ausdruck zu der erwarteten Zeit ausgewertet wird. Verwenden Sie im Zweifelsfall einen Cron-Parser.

Wenn der Trigger gefeuert hat, aber keine Ausführung erscheint, prüfen Sie das Ausführungskontingent des Projekts unter **Project Settings → Billing**.

### „Er läuft, aber ein nachgelagerter Knoten wird nie ausgeführt."

Ein Knoten, der nicht läuft, ist üblicherweise ein Verkabelungsproblem. Öffnen Sie die Arbeitsfläche und prüfen Sie:

- Ist der Ausgabeport des vorgelagerten Knotens tatsächlich mit dem Eingabeport dieses Knotens verbunden?
- Hat der vorgelagerte Knoten einen anderen Port genommen (z. B. `error` statt `success` oder `no` statt `yes`)? Schauen Sie in das Ausführungsdetail, um zu sehen, welchen Port er gewählt hat.

### „Eine Variable kommt leer durch."

Öffnen Sie das Ausführungsdetail und schauen Sie auf die erfassten Argumente des fehlschlagenden Knotens. Wenn Sie den wörtlichen `{{NodeId.field}}`-Text sehen, wurde die Referenz nicht aufgelöst — wahrscheinlich ein Tippfehler in `NodeId` oder `field`. Wenn Sie einen leeren String sehen, ist der vorgelagerte Knoten gelaufen, hat dieses Feld aber nicht produziert.

### „Manuell funktioniert es, aber nicht aus dem Trigger heraus."

Verwenden Sie **Manuell ausführen** mit einem JSON-Payload, der spiegelt, was der echte Trigger veröffentlicht. Vergleichen Sie dann die erfassten Argumente im manuellen Lauf vs. im Produktionslauf nebeneinander — der Unterschied liegt üblicherweise in einem einzelnen Feldnamen oder -typ.

## Einen Workflow erneut ausführen

Es gibt keinen „diesen Lauf wiederholen"-Button — absichtlich. OneUptime führt einen alten Lauf nie erneut aus, weil die ausgehenden Seiteneffekte (Slack-Nachrichten, API-Aufrufe) möglicherweise nicht idempotent sind. Wenn Sie die Arbeit nochmal machen möchten, beheben Sie den Workflow und lassen Sie den nächsten echten Trigger ihn feuern.

Für manuelle Workflows klicken Sie einfach auf **Manuell ausführen** mit demselben Payload.

## Protokoll-Aufbewahrung

Ausführungen werden unbefristet auf dem Projekt aufbewahrt. Wenn Sie Workflows mit hohem Volumen bereinigen müssen (z. B. einen Debug-Workflow, der jede Minute feuert), deaktivieren oder löschen Sie sie — es gibt keinen Aufbewahrungs-Schalter pro Workflow.

## Wo weiterlesen

- [Konfiguration & Sicherheit](/docs/workflows/configuration) — Timeouts, Rekursionsgrenzen, Geheimnis-Redaktion.
- [Variablen](/docs/workflows/variables) — die Syntax, die interpolierte Argumente verwenden.
- [Komponenten](/docs/workflows/components) — die Rückgabewert-Felder, die jede Komponente veröffentlicht.
