# Ein Dashboard erstellen

Um ein Dashboard zu erstellen, öffnen Sie **Produkte → Dashboards** und klicken auf **Dashboard erstellen**. Der Dialog **Dashboard erstellen** fragt, wie Sie beginnen möchten, und dann nach einem Namen. **Ohne Vorlage beginnen** gibt Ihnen ein leeres Dashboard; eine Vorlage baut ihre Widgets und oft ihre Variablen für Sie auf und füllt ihren Namen aus (nummeriert, etwa „Kubernetes Dashboard 2“, wenn das Projekt schon eines hat). Klicken Sie auf **Dashboard erstellen**, und das neue Dashboard öffnet sich. Ein leeres öffnet sich auf seiner Arbeitsfläche, mit einer Schaltfläche **Widget hinzufügen** für sein erstes Widget.

:::cards
- [Ein Dashboard anlegen](#ein-dashboard-anlegen): Ohne Vorlage oder mit einer Vorlage beginnen.
- [Bearbeiten und speichern](#bearbeiten-und-speichern): Für niemanden ändert sich etwas, bevor Sie auf Änderungen speichern klicken.
- [Ein Widget hinzufügen](#ein-widget-hinzufügen): Aus dem Katalog wählen, einrichten, an seinen Platz bringen.
- [In eine Spitze zoomen](#in-eine-spitze-zoomen): Ziehen Sie über ein Diagramm, um das ganze Dashboard in diesem Moment zu lesen.
:::

## Bevor Sie beginnen

Projektinhaber und -administratoren können jedes Dashboard erstellen und bearbeiten. Alle anderen brauchen eine Teamberechtigung: `CreateDashboard`, um Dashboards zu erstellen, und `EditDashboard`, um sie zu ändern. Projektmitglieder und Betrachter können Dashboards ohne beides lesen. Wer ein Dashboard nicht bearbeiten darf, öffnet trotzdem sein Menü **⋯**, in dem **Dashboard bearbeiten** gesperrt ist und sagt, welche Berechtigung fehlt.

## Ein Dashboard anlegen

:::steps
### Wählen, wie Sie beginnen

Öffnen Sie **Produkte → Dashboards** und klicken Sie auf **Dashboard erstellen**. Der Dialog **Dashboard erstellen** öffnet sich auf **Ohne Vorlage beginnen**, einem leeren Dashboard für Ihre eigenen Widgets. Darunter führt **Oder mit einer Vorlage beginnen** sechs Vorlagen unter **Empfohlen** auf.

### Eine Vorlage wählen

Klicken Sie auf eine Vorlage, um zu sehen, was sie hinzufügt: ihre Widgets, benannt wie in **Widget hinzufügen**, und die Variablen, mit denen Sie sie in ihrer Werkzeugleiste eingrenzen. Für die anderen wählen Sie neben dem Suchfeld eine Kategorie oder **Alle Vorlagen**, oder Sie tippen in **Vorlagen durchsuchen…**: Jedes Wort, das Sie tippen, muss passen. Klicken Sie dann auf **Diese Vorlage verwenden**, oder doppelklicken Sie auf die Vorlage. Im Suchfeld wählen die Pfeiltasten eine Vorlage, und **Enter** verwendet sie.

### Das Dashboard benennen

Der Name einer Vorlage ist ausgefüllt und über die Namen hinaus nummeriert, die das Projekt schon hat. Mit **Ohne Vorlage beginnen** bleibt er leer: Geben Sie einen ein. Die Beschreibung ist optional, unter **Weitere Felder** eingeklappt, und Sie können sie später auf der Seite **Übersicht** des Dashboards hinzufügen. **Zurück** bringt Sie zu den Vorlagen zurück, wie Sie sie verlassen haben.

### Es erstellen

Klicken Sie auf **Dashboard erstellen**. Das neue Dashboard öffnet sich: die Widgets einer Vorlage sofort, oder eine leere Arbeitsfläche mit **Widget hinzufügen** darauf.
:::

Die Vorlagen, nach der Kategorie, unter der die Auswahl sie aufführt:

| Kategorie | Vorlagen |
| --- | --- |
| Überwachung & APM | Monitor Dashboard, Metrics Dashboard, Real User Monitoring Dashboard, SLO Dashboard |
| Reaktion auf Vorfälle | Incident Dashboard, Alert Dashboard |
| Infrastruktur | Kubernetes Dashboard, Kubernetes Cost Dashboard, Hosts Dashboard, Proxmox Dashboard, VMware Dashboard, Ceph Dashboard, Storage Array Dashboard, Docker Swarm Dashboard, Network Dashboard |

**Empfohlen** enthält Monitor Dashboard, Incident Dashboard, Alert Dashboard, Kubernetes Dashboard, Hosts Dashboard und Metrics Dashboard. Eine Vorlage ist ein Ausgangspunkt, keine Verknüpfung: Sobald das Dashboard erstellt ist, ändern Sie es nach Belieben. Später aktualisiert die Vorlage es nicht mehr.

## Bearbeiten und speichern

Ein Dashboard öffnet sich in der Ansicht, zum Lesen. Um es zu ändern, öffnen Sie das Menü **⋯** in seiner Werkzeugleiste und wählen **Dashboard bearbeiten**. Die Werkzeugleiste zeigt **Bearbeitung** neben dem Namen und tauscht den Zeitbereich und seine anderen Bedienelemente gegen **Widget hinzufügen**, **Variablen**, **Abbrechen** und **Änderungen speichern**, darunter eine Zeile für den **Standardzeitraum** und die **Automatische Aktualisierung (Standard)** des Dashboards.

```mermaid title="Vom Lesen eines Dashboards zum Ändern und zurück"
flowchart TB
    view["Ansicht: Hier öffnet<br/>sich das Dashboard"] -->|"⋯ → Dashboard<br/>bearbeiten"| edit["Bearbeitung: Widgets<br/>hinzufügen, ändern,<br/>verschieben, skalieren"]
    edit -->|"Änderungen<br/>speichern"| saved["Alle sehen<br/>die Änderungen"]
    edit -->|"Abbrechen, dann<br/>Änderungen verwerfen"| dropped["Nichts ändert sich"]
    saved --> back["Zurück in der Ansicht"]
    dropped --> back
```

Ihre Änderungen gehören nur Ihnen, bis Sie sie speichern. Beim Bearbeiten wird nichts gespeichert, daher sehen andere das Dashboard weiterhin so, wie es war.

- **Änderungen speichern** speichert die Widgets, ihre Plätze und Größen, die Variablen sowie den Standardzeitraum und die standardmäßige automatische Aktualisierung auf einmal und kehrt zur Ansicht zurück. Wird das Speichern abgelehnt, etwa weil Sie inzwischen die Berechtigung verloren haben, bleiben Sie mit Ihren Änderungen in der Bearbeitung, und der Grund steht über dem Raster.
- **Abbrechen** fragt zuerst, weil es Ihre Änderungen verwirft: **Änderungen verwerfen** kehrt zum gespeicherten Dashboard zurück, und **Weiter bearbeiten** bringt Sie zurück zu Ihrer Arbeit.

Während Sie bearbeiten, pausiert die automatische Aktualisierung, und ein gezoomter Zeitbereich kehrt zu dem Bereich zurück, den Sie gewählt hatten.

## Ein Widget hinzufügen

:::steps
### Den Widget-Katalog öffnen

Klicken Sie auf **Widget hinzufügen**: in der Werkzeugleiste während der Bearbeitung oder auf der Arbeitsfläche eines leeren Dashboards. Der Katalog gruppiert seine Widgets nach dem, was sie zeigen. Tippen Sie in sein Suchfeld, um eines nach Name oder Zweck zu finden ("error budget", "pods"), und drücken Sie die Eingabetaste, um den ersten Treffer hinzuzufügen.

### Ein Widget wählen

Klicken Sie darauf. Das Widget landet an der ersten freien Stelle im Raster, an die es passt, und seine Einstellungen öffnen sich.

### Festlegen, was es zeigt

Der Einstellungsdialog zeigt über den Einstellungen eine **Live-Vorschau** des Widgets, und die Vorschau folgt jeder Änderung. Wählen Sie, was das Widget liest (eine Metrikabfrage, einen Filter, einen Text) und wie es aussieht, und klicken Sie dann auf **Fertig**.

### Es platzieren

Ziehen Sie das Widget, um es zu verschieben, und ziehen Sie seine Kanten oder Ecken, um seine Größe zu ändern. Siehe [Widgets im Raster](#widgets-im-raster).
:::

[Dashboard-Widgets](/docs/dashboards/widgets) führt jedes Widget und seine Einstellungen auf.

## Widgets im Raster

Die Arbeitsfläche ist ein Raster mit zwölf Spalten. Widgets rasten darin ein, und die Seite wächst nach unten, wenn Sie Zeilen hinzufügen. Während Sie ein Widget ziehen, zeigt ein gestrichelter Umriss, wo es landen wird, mit seiner Spalte und Zeile; während Sie eines skalieren, zeigt der Umriss seine Größe in Rastereinheiten. Widgets, die im Weg sind, weichen aus, sodass sich nie zwei Widgets überlappen.

Jede Art von Widget hat eine Mindestgröße, damit das, was es zeichnet, lesbar bleibt: Ein Diagramm ist mindestens sechs Spalten breit und drei Zeilen hoch, während eine einzelne Zahl in eine Zelle passt.

Das Raster ist so breit wie der Bildschirm. Auf einem schmaleren Bildschirm werden seine Spalten schmaler, und seine Zeilen behalten ihre Höhe. Auf einem Smartphone stehen die Widgets untereinander, jedes so breit wie der Bildschirm, in der Reihenfolge, in der sie im Raster stehen: Zeile für Zeile von oben, innerhalb einer Zeile von links nach rechts. Ein Diagramm wird dort höher gezeichnet, damit sein Verlauf Platz hat. Beim Bearbeiten auf einem Smartphone sehen Sie das Raster, das sich seitlich scrollen lässt.

Um ein Widget später zu ändern, klicken Sie während der Bearbeitung darauf. Seine Einstellungen öffnen sich erneut, mit zwei weiteren Schaltflächen unten:

- **Widget duplizieren** fügt an der ersten freien Stelle eine Kopie mit denselben Einstellungen hinzu.
- **Widget löschen** entfernt es, sobald Sie bestätigen.

## Zeitbereich und automatische Aktualisierung

In der Ansicht legt die Zeitbereichsauswahl der Werkzeugleiste das Fenster fest, das jedes Diagramm-, Zahlen-, Log- und Trace-Widget liest. Wählen Sie eine Vorgabe von den letzten 5 Minuten bis zu den letzten 3 Monaten, oder einen eigenen Beginn und ein eigenes Ende. Das Dashboard öffnet sich mit seinem Standardzeitraum: der letzten Stunde, es sei denn, jemand legt beim Bearbeiten einen anderen fest.

Listen von Vorfällen, Warnungen, Monitoren und Ressourcen zeigen ihren aktuellen Zustand, unabhängig vom Zeitbereich.

Neben dem Zeitbereich liest das Menü der automatischen Aktualisierung jedes Widget alle 5 Sekunden, 10 Sekunden, 30 Sekunden, 1 Minute, 5 Minuten oder 15 Minuten neu, mit einem Countdown bis zur nächsten Aktualisierung. Lassen Sie sie aus, während Sie untersuchen, damit die Ansicht stillhält. Das Dashboard öffnet sich mit seiner standardmäßigen automatischen Aktualisierung: aus, es sei denn, jemand legt beim Bearbeiten eine andere fest.

Die Zeitbereichsauswahl, die Variablen und die automatische Aktualisierung erscheinen, sobald das Dashboard ein Widget hat.

### Die Standardwerte des Dashboards

Während Sie das Dashboard bearbeiten, legt die Zeile unter den Schaltflächen der Werkzeugleiste fest, womit alle es öffnen: **Standardzeitraum**, eine Vorgabe von den letzten 5 Minuten bis zu den letzten 3 Monaten, und **Automatische Aktualisierung (Standard)**. **Änderungen speichern** speichert sie mit dem Rest des Dashboards, für Ihr Team ebenso wie für die Besucher seines öffentlichen Links. Ein eigener Beginn und ein eigenes Ende können kein Standard sein: Das Dashboard bliebe für immer auf diesem Moment stehen. Die Zeile erscheint, sobald das Dashboard ein Widget hat.

Dashboards, die vor diesen Einstellungen gespeichert wurden, öffnen sich mit der letzten Stunde und mit der automatischen Aktualisierung, die sie hatten. Über die API und Terraform stehen beide in der `dashboardViewConfig` des Dashboards: `timeRange`, eine Vorgabe so geschrieben wie in der API-Referenz, etwa `Past 1 Day`, und `refreshInterval`, etwa `1m`. Jeder andere Wert wird abgelehnt.

### Ihre eigene Auswahl

Der Zeitbereich und die automatische Aktualisierung, die Sie in der Ansicht wählen, gelten nur für Sie, und Ihr Browser merkt sie sich für jedes Dashboard: Ein Neuladen, ein Neustart des Browsers oder der Neustart eines Wandbildschirms öffnet das Dashboard so, wie Sie es verlassen haben. Nur eine Vorgabe wird gemerkt. Ein eigener Zeitbereich oder ein Zoom gilt, bis Sie die Seite verlassen, sodass das Dashboard nie auf einem vergangenen Moment stehen bleibt.

Der erste Eintrag jeder Auswahl nennt den Standard des Dashboards, etwa Standard (Letzter Tag). Wählen Sie ihn, um zum Standard zurückzukehren: Ihr Browser vergisst Ihre Auswahl, und das Dashboard folgt wieder seinem Standard, auch wenn jemand ihn später ändert. Wenn Sie selbst neue Standardwerte speichern, sehen Sie sie sofort.

### In eine Spitze zoomen

Sie müssen nicht zur Zeitbereichsauswahl greifen, um sich eine Spitze anzusehen. Ziehen Sie über den interessanten Abschnitt eines beliebigen Linien- oder Flächendiagramms, und das **ganze Dashboard** springt in dieses Fenster, genau als hätten Sie es in der Zeitbereichsauswahl gewählt — jedes Widget, das den Zeitbereich nutzt, fragt mit ab, sodass Sie einen Moment über das ganze Board hinweg lesen statt eines Diagramms in einem anderen Maßstab als seine Nachbarn. Live-Listen zeigen weiterhin, was gerade passiert, wie immer.

**Doppelklicken Sie auf ein beliebiges Diagramm**, um das rückgängig zu machen: Das Dashboard kehrt zu dem Bereich zurück, den es vor dem Zoomen hatte, wie oft Sie auch hineingebohrt haben. Eine Schaltfläche **Zoom zurücksetzen** erscheint neben der Zeitbereichsauswahl, solange ein Zoom aktiv ist, und ein Doppelklick auf ein nicht gezoomtes Dashboard bewirkt nichts.

Ein gezoomtes Fenster ist fest, daher rollt es nicht weiter, während die automatische Aktualisierung läuft — das ist Absicht, denn ein Fenster, das Ihnen mitten in einer Untersuchung davonläuft, wäre schlimmer. Setzen Sie den Zoom zurück, um wieder mitzurollen.

Zoomen funktioniert nur in der Ansicht; in der Bearbeitung verschiebt und skaliert Ziehen stattdessen Widgets. Balkendiagramme zoomen genauso — ziehen Sie über die Balken —, und ein Doppelklick auf eines setzt das Dashboard wie jedes andere Diagramm zurück. Nur Ziehen zoomt: Ein einfacher Klick auf ein Diagramm ändert nie den Zeitbereich des Dashboards. Dieselben Gesten funktionieren in den Diagrammen überall in OneUptime; siehe [In einen Zeitbereich zoomen](/docs/telemetry/charts-and-time-ranges).

## Vollbild

**⋯ → Vollbild** zeigt die Widgets des Dashboards auf dem ganzen Bildschirm, für eine Wandanzeige oder ein Meeting. Drücken Sie Esc, um es zu verlassen.

## Tipps für Dashboards, die gut altern

- **Ein Thema pro Dashboard.** Einige fokussierte Dashboards schlagen eine Seite mit allem, was Sie überwachen.
- **Stellen Sie das wichtigste Widget nach oben.** Menschen lesen von oben nach unten, also sollte das Erste, was sie sehen, die Frage „Ist das gesund?“ beantworten.
- **Benennen Sie die Abschnitte mit Text-Widgets.** Eine kurze Überschrift alle paar Zeilen („Latenz“, „Fehler“, „Kapazität“) macht die Seite auch quer durch den Raum leicht überschaubar.
- **Variablen statt Kopien.** Wenn Sie dabei sind, dasselbe Dashboard für einen zweiten Dienst zu bauen, fügen Sie stattdessen eine Variable `service` hinzu. Siehe [Dashboard-Variablen & Filter](/docs/dashboards/variables).
- **Vor einer großen Änderung kopieren.** **Dashboard duplizieren** auf der Seite **Einstellungen** des Dashboards erstellt eine sichere Kopie, an der Sie Ihre Ideen ausprobieren.

## Nächste Schritte

:::cards
- [Dashboard-Widgets](/docs/dashboards/widgets): Jedes Widget, seine Einstellungen und welches Sie wählen.
- [Dashboard-Variablen & Filter](/docs/dashboards/variables): Ein Dashboard für jeden Dienst, jeden Host oder jeden Kunden.
- [Teilen & öffentliche Dashboards](/docs/dashboards/sharing): Das Dashboard außerhalb Ihres Teams teilen.
- [Dashboard-Konfiguration & Berechtigungen](/docs/dashboards/configuration): Eigentümer, Beschriftungen, Archivieren und wer was darf.
:::
