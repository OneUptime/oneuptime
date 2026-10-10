# In einen Zeitbereich hineinzoomen

Ziehen Sie über ein Diagramm, um die Seite auf genau diesen Moment zu zoomen, und doppelklicken Sie, um zurückzukehren. Diese Seite erklärt die Gesten, wie sich ein Zoom verhält und welche Diagramme was zoomen.

:::cards
- [Hinein- und wieder herauszoomen](#hinein-und-wieder-herauszoomen): Die zwei Gesten und die Schaltfläche Zoom zurücksetzen.
- [Wie sich Zoomen verhält](#wie-sich-zoomen-verhält): Verschachtelte Zooms, automatische Aktualisierung, Klicks und Ziehen.
- [Wo es funktioniert](#wo-es-funktioniert): Die Seiten und Diagramme, deren Zeitbereich ein Ziehen ändert.
- [Diagramme ohne Zoom](#diagramme-ohne-zoom): Streifen, Anzeigen und Sparklines.
:::

## Hinein- und wieder herauszoomen

Jedes Zeitreihendiagramm in OneUptime dient zugleich als Zeitbereichsauswahl. Zeigt ein Diagramm eine Spitze, die Sie sich ansehen wollen, müssen Sie weder die Auswahl öffnen noch Daten eintippen:

:::steps
1. **Ziehen Sie über die Spitze** in einem beliebigen Diagramm. Der Zeitbereich der Seite springt auf das aufgezogene Fenster, genau als hätten Sie es in der Zeitbereichsauswahl gewählt. Jedes Diagramm und jede Kachel oder Tabelle, die sich aus dem Zeitbereich der Seite ergibt, fragt dafür neu ab, sodass Sie einen Moment über alle hinweg lesen.
2. **Doppelklicken Sie auf ein beliebiges Diagramm**, um zurückzukehren. Die Seite kehrt zu dem Zeitbereich zurück, den sie vor dem Zoomen hatte.
:::

Bereiche, die den aktuellen Zustand zeigen, bleiben auf jetzt, genau wie wenn Sie selbst einen Bereich wählen: Inventarzahlen, Zustand, die größten Ressourcenverbraucher, aktuelle Warnungen, offene Vorfälle und Alarme sowie die Live-Listen eines Dashboards.

Solange ein Zoom aktiv ist, erscheint neben der Zeitbereichsauswahl der Seite eine Schaltfläche **Zoom zurücksetzen**. Sie bewirkt dasselbe wie ein Doppelklick und ist der Weg zurück für Tastaturnutzer und auf Touchscreens.

```mermaid title="Was Ziehen, Doppelklick und Auswahl mit dem Zeitbereich der Seite machen"
stateDiagram-v2
    state "Bereich aus der Auswahl" as Picked
    state "Gezoomtes Fenster" as Zoomed
    [*] --> Picked
    Picked --> Zoomed: über ein Diagramm ziehen
    Zoomed --> Zoomed: erneut ziehen
    Zoomed --> Picked: Doppelklick oder Zoom zurücksetzen
    Zoomed --> Picked: einen Bereich wählen
```

## Wie sich Zoomen verhält

- **Zoomen Sie so tief Sie wollen; ein Zurücksetzen führt ganz hinaus.** Nachdem Sie von „Letzte Stunde“ auf zehn Minuten und dann auf eine gezoomt haben, bringt ein einziger Doppelklick (oder **Zoom zurücksetzen**) die ganze Stunde zurück, statt Ebene für Ebene.
- **Jedes Diagramm kann jeden Zoom zurücksetzen.** Ziehen Sie im CPU-Diagramm, doppelklicken Sie im Speicherdiagramm – gezoomt ist die Seite, nicht das Diagramm.
- **Einen Bereich selbst zu wählen beginnt neu.** Eine Vorgabe oder ein eigener Bereich in der Auswahl ist ein neuer Ausgangspunkt: Der Zoom ist beendet und **Zoom zurücksetzen** verschwindet.
- **Ein gezoomtes Fenster ist fest.** „Letzte 30 Minuten“ läuft mit der Uhr mit; ein Zoom ist ein festes Fenster und läuft daher bei aktiver automatischer Aktualisierung nicht weiter. Setzen Sie den Zoom zurück, damit es wieder mitläuft.
- **Ein Zoom reicht nie über jetzt hinaus.** Der neueste Bucket eines Diagramms füllt sich meist noch; ein Ziehen, das auf ihm endet, wird bei der aktuellen Zeit abgeschnitten.
- **Sie können die Maus außerhalb des Diagramms loslassen** – das Ziehen zählt trotzdem.
- **Sie müssen nicht warten, bis die Diagramme geladen sind, um zurückzukehren.** Direkt nach einem Zoom, während die Diagramme das aufgezogene Fenster noch abrufen, oder wenn sich das Fenster als leer herausstellt, setzt ein Doppelklick auf ein Diagramm den Zoom sofort zurück.
- **Ein Doppelklick auf eine nicht gezoomte Seite bewirkt nichts.**

### Klicken und Ziehen

- **In Linien-, Flächen- und Balkendiagrammen ist ein einfacher Klick kein Zoom.** Das betrifft die meisten Diagramme: Metrikkarten und den Metrik-Explorer, Ressourcenübersichten, SLOs, Monitore und jedes Diagramm auf einem Dashboard. Nur ein Ziehen über Buckets hinweg zoomt, ein Klick auf einen Punkt, einen Balken oder einen Legendeneintrag tut also weiterhin, was er vorher tat. Solange ein Zoom aktiv ist, wirkt ein Klick auf die Zeichenfläche eines Diagramms einen Moment später, damit er vom Doppelklick zum Zurücksetzen unterschieden werden kann. Die Fehlermuster-Zeitleiste in den Protokoll-Insights und der Occurrence Trend einer Ausnahme zoomen ebenfalls nur beim Ziehen.
- **In den Volumendiagrammen der Explorer zoomt ein Klick auf einen Balken in diesen Balken.** Die Volumendiagramme der Explorer für Protokolle, Traces, Ausnahmen und Sicherheitsereignisse sowie die Analysediagramme für Protokolle und Traces zoomen in die Balken, über die Sie ziehen, oder in den einen Balken, den Sie anklicken. Diese Diagramme zeigen **Klicken oder ziehen zum Zoomen**.

### Hinweise an den Diagrammen

Die meisten zoombaren Diagramme nennen die Geste über der Zeichenfläche – **Ziehen zum Zoomen** oder **Klicken oder ziehen zum Zoomen** – und erinnern, solange ein Zoom aktiv ist, an **Doppelklick zum Zurücksetzen**. Metrikkarten, der Metrik-Explorer und die Volumendiagramme der Explorer zeigen den Hinweis immer. Auf den Diagrammkarten von Ressourcenübersichten und SLOs sowie auf einigen Dashboard-Widgets erscheint er nur, solange Sie auf die Karte zeigen oder per Tab hineinwechseln.

## Wo es funktioniert

Zoomen ändert den Zeitbereich der ganzen Seite bei:

- Ressourcenübersichten und ihren Insights-Seiten: Kubernetes-Cluster, Docker-, Podman- und Docker-Swarm-Hosts, Hosts und ihre Prozesse, Dienste und systemd-Units, VMware, Proxmox, Ceph, Speicher-Arrays, Datenbanken, Cloud-Ressourcen und Serverless-Funktionen;
- Diensten und RUM-Anwendungen;
- Metriken und Datenverkehr von Netzwerkgeräten;
- Metrikkarten, einschließlich des Metriken-Tabs einer Ressource und der Metriken eines Monitors;
- dem Metrik-Explorer;
- SLO-Verlaufsdiagrammen;
- den Protokoll-Insights, einschließlich der Zeitleiste „Wann es passiert ist“ eines Fehlermusters, deren Bereich ein eigenes **Zoom zurücksetzen** hat, weil er die Auswahl der Seite verdeckt;
- Volumendiagrammen für Protokolle, Traces, Ausnahmen und Sicherheitsereignisse sowie den Analysediagrammen für Protokolle und Traces, die den Zeitbereich ihres Explorers ändern;
- [Dashboards](/docs/dashboards/authoring), wo ein Ziehen den Zeitbereich des ganzen Dashboards ändert.

Diagramme mit eigenem Fenster zoomen nur dieses Fenster und ändern daher nie etwas anderes auf der Seite. Das betrifft eine Metrikvorschau im Formular eines Monitors (der Monitor wertet weiterhin sein eigenes rollierendes Fenster aus), den Occurrence Trend einer Ausnahme, ein in einem Pop-up oder im Untersuchungsbereich geöffnetes Diagramm und Diagramme in Antworten des KI-Chats. Ein Doppelklick auf eines davon oder seine Schaltfläche **Zoom zurücksetzen** stellt sein eigenes Fenster wieder her.

Auch die Telemetrie-Momentaufnahme auf der Seite eines Vorfalls, eines Alarms oder einer Episode hat ein eigenes Fenster. Ein Ziehen in ihrem Diagramm (dem Metrikdiagramm oder dem Volumendiagramm für Protokolle, Traces oder Ausnahmen, wenn die Momentaufnahme das zeigt) zoomt die ganze Momentaufnahme, sodass ihre Tabs Metriken, Protokolle, Traces und Ausnahmen alle den aufgezogenen Ausschnitt zeigen. **Zoom zurücksetzen** neben dem Abzeichen der Momentaufnahme oder ein Doppelklick auf dieses Diagramm stellt das Fenster der Momentaufnahme wieder her.

## Diagramme ohne Zoom

Einige Darstellungen haben keine Zeitachse zum Ziehen, sind zu klein dafür oder zeigen immer ein festes eigenes Fenster und zoomen daher nicht:

- Verfügbarkeitsstreifen (ein Balken pro Tag), die nichts Feineres als einen Tag zeigen können;
- Anteils- und Proportionsbalken, Anzeigen und Fortschrittsbalken;
- Flame-Graphs, Service-Maps und Flussdiagramme;
- die kleinen Trend-Sparklines in Metriklisten, wo ein Klick die Metrik öffnet – öffnen Sie sie, um ein zoombares Diagramm zu erhalten;
- kleine Sparklines mit festem eigenem Fenster, etwa die Round-Trip-Zeit eines Netzwerkgeräts in der letzten Stunde – ihr Link **Metriken öffnen** führt zu Diagrammen, die Sie zoomen können.

## Nächste Schritte

:::cards
- [Ein Dashboard erstellen](/docs/dashboards/authoring): Zoom funktioniert in jedem Diagramm eines Dashboards.
- [Suchsyntax](/docs/telemetry/search-syntax): Die Explorer filtern, sobald Sie den Moment gefunden haben.
- [Metriken-Überwachung](/docs/monitor/metrics-monitor): Bei der Metrik warnen, die Sie sich angesehen haben.
:::
