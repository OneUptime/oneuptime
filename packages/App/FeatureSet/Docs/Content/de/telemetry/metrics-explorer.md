# Metrik-Explorer

Metriken sind die Zahlen, die Ihre Dienste und Ihre Infrastruktur über die Zeit melden: Anfragezahlen, Latenzen, CPU, Warteschlangentiefe. Der Metrik-Explorer listet jede Metrik, die Ihr Projekt empfängt, stellt jede davon in einem Diagramm dar, kombiniert sie mit Formeln und macht aus einem Diagramm einen Monitor oder ein Dashboard-Widget.

:::cards
- [Eine Metrik finden](#eine-metrik-finden): Die Liste der Metriknamen durchsuchen.
- [Eine Metrik darstellen](#eine-metrik-darstellen): Eine Abfrage aggregieren, filtern und gruppieren.
- [Abfragen mit einer Formel kombinieren](#abfragen-mit-einer-formel-kombinieren): Fehlerraten und andere Verhältnisse.
- [Das Dargestellte nutzen](#das-dargestellte-nutzen): Ein Monitor, ein Dashboard-Widget oder ein Link.
:::

## Wie der Explorer funktioniert

Der Explorer hat zwei Ebenen. Der Tab **Betrachter** listet die Metriken, die Ihr Projekt empfängt. Klicken Sie auf eine, und der Metrik-Explorer öffnet sich mit einer Abfrage dafür: einer Metrik, der Art ihrer Aggregation und ihrer Filterung und Gruppierung. Jede Abfrage ist eine Variable, `a`, `b` und so weiter, die eine Formel verwenden kann.

```mermaid title="Von Metrikabfragen zu einem Diagramm, einem Monitor oder einem Dashboard"
flowchart TB
    a["Abfrage a: Anfragen,<br/>aggregiert mit Sum"] --> f["Formel:<br/>$b / $a * 100"]
    b["Abfrage b: Fehler,<br/>aggregiert mit Sum"] --> f
    f --> chart["Diagramm: Fehlerrate<br/>in Prozent"]
    chart --> monitor["Ein Metrik-Monitor"]
    chart --> dash["Ein Dashboard-Widget"]
```

Der Explorer hat vier Tabs:

| Tab | Wofür er da ist |
| --- | --- |
| **Betrachter** | Die Liste der Metriken, jede mit einem kleinen Diagramm und ihrem letzten Wert. Er öffnet mit der letzten Stunde. |
| **Einblicke** | Welche Dienste Metriken melden, und wie viele. |
| **Einrichtungsanleitung** | Wie Sie Metriken mit OpenTelemetry senden, mit einem Ihrer Aufnahmeschlüssel. |
| **Einstellungen** | **Pipeline-Regeln** und **Aufzeichnungsregeln**: was mit Metriken beim Eintreffen geschieht. |

## Bevor Sie beginnen

- **Eintreffende Metriken.** Senden Sie sie mit [OpenTelemetry](/docs/telemetry/open-telemetry) oder von einem Agenten wie dem [Host-OpenTelemetry-Collector](/docs/telemetry/host-otel-collector) oder dem [Kubernetes-Agenten](/docs/telemetry/kubernetes-agent).
- **Eine Rolle, die Telemetrie lesen darf.** Project Owner, Project Admin, Project Member, Viewer, Telemetry Admin, Telemetry Member oder Telemetry Viewer, oder eine eigene Rolle mit der Berechtigung Read Telemetry Service Metrics. Siehe [Telemetrie](/docs/permissions/index#telemetrie) dazu, welche Metriken sie liest.

## Eine Metrik finden

Öffnen Sie **Produkte → Observability → Metriken**. Der **Betrachter** listet jede Metrik, die Ihr Projekt empfangen hat, nach Namen, jede mit einem kleinen Diagramm des Zeitraums und ihrem letzten Wert.

- Suchen Sie Namen mit freien Wörtern oder `name:`, zum Beispiel findet `name:http.server` die Metrik `http.server.request.duration`. Siehe [Suchsyntax](/docs/telemetry/search-syntax#metriken).
- Filtern Sie in der Seitenleiste nach **Dienst**, um nur die Metriken eines Dienstes zu sehen.
- Klicken Sie auf eine Metrik, um sie im Metrik-Explorer darzustellen.

## Eine Metrik darstellen

:::steps
### Die Metrik öffnen

Klicken Sie im **Betrachter** auf die Metrik. Der Explorer öffnet sich mit einer Abfrage, `a`, für den Zeitraum und die Filter der Liste.

### Die Aggregation wählen

Wählen Sie unter **Aggregieren nach**, wie die Werte jedes Punktes im Diagramm zusammengefasst werden: Avg, der Standard, Sum, Min, Max, Count oder ein Perzentil, P50, P75, P90, P95 oder P99. Ein Perzentil einer Histogramm-Metrik, etwa einer Anfragedauer, wird aus ihren Buckets berechnet.

### Filtern und gruppieren

Öffnen Sie **Filter & Gruppierung**. **Nach Attributen filtern** behält die Datenpunkte, deren Attribute passen, etwa eine bestimmte `http.route`, und **Gruppieren nach** zeichnet eine Linie pro Wert der gewählten Attribute, etwa eine Linie pro Host.

### Das Diagramm anpassen

Öffnen Sie **Anzeigeeinstellungen**, um den **Diagrammtyp** zu wählen (Linie, Fläche oder Balken), eine **Warnschwelle** und einen **Kritischer Schwellenwert** ins Diagramm einzuzeichnen oder **In Rate pro Sekunde umrechnen** einzuschalten.
:::

> [!TIP]
> Ein Zähler, der nur steigt, etwa `system.disk.io`, liest sich am besten als Rate. Schalten Sie **In Rate pro Sekunde umrechnen** ein, um zu zeigen, wie schnell er sich ändert, statt seiner laufenden Summe; der Explorer schlägt das vor, wenn er einen solchen Zähler erkennt.

Jede Abfrage zeichnet ihr eigenes Diagramm. Um eine Abfrage in dasselbe Diagramm wie die vorherige zu zeichnen, schalten Sie in ihren **Anzeigeeinstellungen** **Mit vorheriger Abfrage überlagern** ein.

## Abfragen mit einer Formel kombinieren

:::steps
### Die Abfragen hinzufügen

Klicken Sie für jede benötigte Metrik auf **Metrik hinzufügen**. Die neuen Abfragen heißen `b`, `c` und so weiter.

### Eine Formel hinzufügen

Klicken Sie auf **Formel hinzufügen** und schreiben Sie die **Formel** mit den Variablen der Abfragen, den Operatoren `+`, `-`, `*`, `/`, `%` und `^` sowie Klammern. Für eine Fehlerrate in Prozent schreiben Sie `$b / $a * 100`.
:::

Eine Variable lässt sich mit oder ohne ihr `$` schreiben, in beliebiger Groß- und Kleinschreibung. Eine Formel, die eine nicht definierte Abfrage nennt, meldet das, statt etwas zu zeichnen.

## Rund um ein Diagramm erkunden

Die Schaltflächen über den Diagrammen arbeiten mit dem Zeitraum, den Sie gerade sehen:

| Schaltfläche | Was sie tut |
| --- | --- |
| **Protokolle** | Öffnet den [Protokoll-Explorer](/docs/telemetry/logs-explorer) für diesen Zeitraum und Ihre Filter. |
| **Traces** | Öffnet den [Trace-Explorer](/docs/telemetry/traces-explorer) für diesen Zeitraum und Ihre Filter. |
| **Untersuchen** | Öffnet ein Seitenfenster mit den Protokollen, Traces und Ausnahmen dieses Zeitraums. |
| **Ereignisse** | Markiert die Vorfälle und Warnungen dieses Zeitraums in den Diagrammen. |
| **Vergleichen** | Zeichnet den vorherigen Zeitraum als gestrichelte Linie in jedes Diagramm, damit Sie sehen, was sich geändert hat. |

Ziehen Sie über ein Diagramm, um in einen Moment hineinzuzoomen, und doppelklicken Sie, um wieder herauszuzoomen: siehe [In einen Zeitraum zoomen](/docs/telemetry/charts-and-time-ranges).

## Das Dargestellte nutzen

- **Aktionen → Monitor aus dieser Ansicht erstellen** öffnet einen neuen Metrik-Monitor, in dem diese Abfragen und Formeln schon eingetragen sind. Siehe [Metriken-Überwachung](/docs/monitor/metrics-monitor).
- **Aktionen → Zum Dashboard hinzufügen** fügt das Diagramm einem Dashboard Ihrer Wahl hinzu. Dafür brauchen Sie die Berechtigung, dieses Dashboard zu bearbeiten.
- **Link kopieren** kopiert einen Link genau zu dieser Ansicht: Abfragen, Formeln und Zeitraum.
- **Gespeicherte Ansichten** behält die Ansicht unter einem Namen für alle im Projekt. Der **Betrachter** hat eigene gespeicherte Ansichten für seine Suche und seine Filter. Gespeicherte Ansichten funktionieren wie im [Protokoll-Explorer](/docs/telemetry/logs-explorer#eine-ansicht-speichern).

## Metrik-Einblicke

Der Tab **Einblicke** zählt die Metriken eines Zeitraums: **Aktive Metriken**, **Berichtsdienste** und den Durchschnitt pro Dienst. Er ordnet die Metriken Kategorien zu und listet die Dienste, die sie melden.

## Was mit Metriken beim Eintreffen geschieht

**Metriken → Einstellungen → Pipeline-Regeln** ändert Metriken beim Eintreffen, bevor sie gespeichert werden. Regeln laufen in der Reihenfolge der Liste, die Sie durch Ziehen ändern; eine Regel für einen Dienst läuft vor den Regeln für alle Dienste.

| Regeltyp | Was er tut |
| --- | --- |
| Filter (Zulassungsliste) | Behält nur die passenden Datenpunkte und verwirft den Rest. |
| Verwerfen | Verwirft die passenden Datenpunkte. |
| Metrik umbenennen | Benennt die Metrik um. |
| Attribut umbenennen | Benennt den Schlüssel eines Attributs auf passenden Datenpunkten um. |
| Attribut hinzufügen | Fügt passenden Datenpunkten ein Attribut hinzu. |
| Attribut entfernen | Entfernt ein Attribut, etwa eines mit zu vielen Werten, um nützlich zu sein. |
| Attribut schwärzen | Ersetzt den Wert eines Attributs durch einen Platzhalter. |
| Stichprobe | Behält einen Prozentsatz der passenden Datenpunkte. |

**Metriken → Einstellungen → Aufzeichnungsregeln** berechnet jede Minute neue Metriken aus anderen Metriken. Siehe [Aufzeichnungsregeln für Protokolle](/docs/telemetry/log-recording-rules) dazu, wie Aufzeichnungsregeln funktionieren.

## Fehlerbehebung

:::details Das Diagramm eines Zählers steigt nur
Es ist ein kumulativer Zähler. Schalten Sie in den **Anzeigeeinstellungen** der Abfrage **In Rate pro Sekunde umrechnen** ein.
:::

:::details Die Liste meldet, dass keine Metriken gefunden wurden
Leeren Sie zuerst Ihre Suche und Ihre Filter-Chips. Ist die Liste weiterhin leer, hat OneUptime noch keine Metriken erreicht: Vergleichen Sie Ihre Einrichtung mit der **Einrichtungsanleitung**.
:::

:::details Die Metriken eines Dienstes fehlen
Filtern Sie den **Betrachter** nach diesem **Dienst** und vergrößern Sie den Zeitraum. Fehlen sie weiterhin, schließt der Bereich Ihrer Rolle diesen Dienst womöglich aus: siehe [Telemetrie](/docs/permissions/index#telemetrie).
:::

## Nächste Schritte

:::cards
- [Metriken-Überwachung](/docs/monitor/metrics-monitor): Benachrichtigt werden, wenn eine Metrik einen Schwellenwert überschreitet.
- [Ein Dashboard erstellen](/docs/dashboards/authoring): Ihre Diagramme nebeneinander stellen.
- [Suchsyntax](/docs/telemetry/search-syntax): Jeder Filter, den das Suchfeld versteht.
:::
