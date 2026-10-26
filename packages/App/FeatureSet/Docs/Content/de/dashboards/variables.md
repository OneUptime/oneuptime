# Dashboard-Variablen & Filter

Eine Variable ist eine Auswahl in der Werkzeugleiste des Dashboards. Fügen Sie eine Variable `service` hinzu, und dieselben Diagramme zeigen `checkout`, `payments` oder `search`: Betrachter wählen in der Werkzeugleiste, statt dass Sie drei fast gleiche Dashboards bauen.

:::cards
- [Eine Variable hinzufügen](#eine-variable-hinzufügen): Benennen, festlegen, woher ihre Werte kommen, speichern.
- [Variablenquellen](#variablenquellen): Telemetry Attribute, Project Labels, Custom List und Text Input.
- [Wie Widgets eine Variable nutzen](#wie-widgets-eine-variable-nutzen): Welche Widgets welchen Variablen folgen.
- [Links, die die Auswahl behalten](#links-die-die-auswahl-behalten): Einen Link senden, der denselben Dienst öffnet.
:::

## Wie eine Variable funktioniert

Sie legen Variablen beim Bearbeiten des Dashboards fest, und sie werden mit ihm gespeichert. In der Ansicht ist jede eine Auswahl in der Werkzeugleiste. Wählt ein Betrachter einen Wert, liest jedes Widget, das der Variablen folgt, seine Daten neu, und der Link der Seite behält die Auswahl.

```mermaid title="Von der Definition einer Variablen zur Auswahl eines Betrachters"
flowchart TB
    A["Bearbeitung: Variablen,<br/>dann Variable hinzufügen"] --> B["Variablen speichern,<br/>dann Änderungen<br/>speichern"]
    B --> C["Ansicht: eine Auswahl<br/>in der Werkzeugleiste"]
    C --> D["Ein Betrachter<br/>wählt einen Wert"]
    D --> E["Die Widgets, die der<br/>Variablen folgen,<br/>lesen neu"]
    D --> F["Der Link der Seite<br/>behält die Auswahl"]
```

## Eine Variable hinzufügen

:::steps
### Den Variablendialog öffnen

Öffnen Sie das Dashboard, wählen Sie **⋯ → Dashboard bearbeiten** und klicken Sie in der Werkzeugleiste auf **Variablen**. Der Dialog **Dashboard-Variablen** listet die Variablen des Dashboards; die Schaltfläche in der Werkzeugleiste zählt sie.

### Eine hinzufügen

Klicken Sie auf **Variable hinzufügen**. Eine neue Variable liest ein Telemetrieattribut; wählen Sie eine andere **Quelle**, wenn Sie eine brauchen.

### Ausfüllen

Geben Sie ihr einen **Name**, den Widgets und Links verwenden, etwa `service`: Buchstaben, Ziffern und Unterstriche, beginnend mit einem Buchstaben oder einem Unterstrich, und verschieden von den anderen Namen des Dashboards. Fügen Sie auf Wunsch eine **Beschriftung** für die Werkzeugleiste hinzu, einen **Standard** als Startwert, und haken Sie **Mehrfachauswahl zulassen** an, damit Betrachter mehrere Werte wählen können.

### Speichern

Klicken Sie auf **Variablen speichern**, dann in der Werkzeugleiste auf **Änderungen speichern**. Die Auswahl der Variablen erscheint in der Werkzeugleiste, sobald das Dashboard wieder in der Ansicht ist.
:::

Um eine Variable später zu ändern oder zu entfernen, öffnen Sie den Dialog erneut: Ändern Sie ihre Felder, oder klicken Sie auf den Papierkorb daneben.

## Variablenquellen

Die **Quelle** entscheidet, woher die Werte einer Variablen kommen und welche Widgets ihr folgen.

| Quelle | Woher ihre Werte kommen | Mehrfachauswahl |
| --- | --- | --- |
| Telemetry Attribute | Die Werte eines Attributschlüssels in Ihren Metriken, etwa `service.name` | Ja |
| Project Labels | Die Projektbeschriftungen, die Sie zulassen, von 1 bis 1.000 | Ja |
| Custom List | Werte, die Sie eingeben, durch Kommas getrennt, etwa `prod, staging` | Ja |
| Text Input | Was auch immer der Betrachter eingibt | Nein |

### Telemetry Attribute

Legen Sie den **Attributschlüssel** fest, etwa `service.name`, `host.name` oder `k8s.namespace.name`; das Feld schlägt die Schlüssel vor, die Ihre Telemetrie trägt. Die Auswahl bietet bis zu 100 Werte dieses Schlüssels an, gelesen aus Ihren Metriken des letzten Tages, sodass ein neuer Dienst darin auftaucht, ohne dass Sie das Dashboard bearbeiten.

Das ist die häufigste Quelle, weil sie keine eigene Liste braucht: Die Werte sind die, die Sie ohnehin senden.

### Project Labels

Wählen Sie vorhandene Projektbeschriftungen, die als Auswahl des Dashboards angeboten werden. Erstellen Sie zum Beispiel eine Variable namens `UNIT`, setzen Sie ihre Quelle auf **Projektbeschriftungen**, und wählen Sie die Beschriftungen `0660` und `0661`.

Das Dashboard speichert die IDs und Anzeigenamen der gewählten Beschriftungen. Gefiltert wird nach IDs, daher bricht das Umbenennen einer Projektbeschriftung ihre Bindung nicht. Die Anzeigenamen werden mit dem Dashboard gespeichert; wählen Sie eine umbenannte Beschriftung im Variableneditor erneut, um ihren angezeigten Namen zu aktualisieren. Öffentliche Dashboards zeigen dieselben gespeicherten Auswahlen.

Öffnen Sie in einem Widget **Überwachungsliste** **Filter → Beschriftungsvariable** und wählen Sie `UNIT`. Die Auswahl `0660` zeigt nun Monitore mit dieser Beschriftung. Andere Widgets sind nicht betroffen, es sei denn, sie unterstützen und binden die Variable ausdrücklich: Die **SLO-Liste** hat dieselbe Einstellung **Beschriftungsvariable**.

Feste Filter des Widgets bleiben wirksam. Mit einer festen Beschriftung `network` und `UNIT` auf `0660` muss ein Monitor zum Beispiel beide Beschriftungen tragen. Mehrere gewählte Einheiten passen zu jeder gewählten Einheit. Die Wahl von **Alle** entfernt nur die Bedingung der Variablen und behält die festen Filter für Beschriftung, Status und Monitortyp.

Eine fehlende Variable oder eine Auswahl außerhalb ihrer festgelegten Möglichkeiten zeigt einen Fehler. Eine gewählte Beschriftung ohne passende Monitore zeigt die leere Liste. Entfernen Sie die Bindung des Widgets ausdrücklich, wenn sie nicht mehr gebraucht wird.

### Custom List und Text Input

Eine Custom List bietet die Werte an, die Sie eingeben, durch Kommas getrennt. Ein Text Input lässt den Betrachter einen beliebigen Wert eingeben, etwa eine IP-Adresse oder eine Anfrage-ID. Keine von beiden filtert ein Widget von sich aus: Ihre Werte landen dort, wo Sie `{{name}}` schreiben (siehe unten).

Eine Query-Variable aus einem älteren Dashboard bleibt erhalten und zeigt ein Textfeld in der Werkzeugleiste: OneUptime lädt ihre Werte nicht mehr aus einer Abfrage.

## Mehrfachauswahl und Standardwerte

Mit angehaktem **Mehrfachauswahl zulassen** wählen Betrachter einen oder mehrere Werte, und die Widgets zeigen jeden davon. Eine leere Auswahl bedeutet **Alle**, und eine Variable mit Mehrfachauswahl beginnt immer mit **Alle**, daher ist ihr **Standard** ausgegraut.

Eine Variable mit Einzelauswahl beginnt mit ihrem **Standard**, oder mit **Alle**, wenn sie keinen hat. **Alle** entfernt den Filter der Variablen, sodass die Widgets alles zeigen.

Nutzen Sie die Mehrfachauswahl, um „checkout und payments zusammen“ zu vergleichen, ohne das Dashboard zu verlassen. Vermeiden Sie sie dort, wo die Zahlen über Werte hinweg nicht aufgehen, etwa bei einem Durchschnitt aus Durchschnitten.

## Wie Widgets eine Variable nutzen

Jede Quelle erreicht die Widgets auf ihre eigene Weise:

- Variablen vom Typ **Telemetrieattribut** filtern Widgets, ohne dass Sie an ihnen etwas einstellen: jedes Metrikdiagramm, jeden Wert, Messwert und jede Tabelle; das **Protokolldiagramm**, den **Protokoll-Stream**, das **Trace-Diagramm** und die **Trace-Tabelle**; und die Infrastrukturlisten, deren Ressourcen das Attribut tragen, etwa `host.name` bei Hostlisten und `k8s.namespace.name` bei Kubernetes-Listen. Ein Diagramm einer Metrik ohne das Attribut zeigt keine Daten, solange ein Wert gewählt ist: Wählen Sie **Alle**, um es wieder zu sehen. Die **Trace-Liste** sowie die Vorfalls- und Warnungslisten folgen ihnen nicht.
- Variablen vom Typ **Projektbeschriftungen** filtern eine **Überwachungsliste** oder eine **SLO-Liste**, deren **Beschriftungsvariable** sie nennt.
- **Jede Variable** lässt sich als `{{name}}` in Text schreiben: in einem [HTML-Widget](/docs/dashboards/widgets#html), in der Abfrage einer [externen Datenquelle](/docs/dashboards/data-sources) und im Titel einer **Überwachungsliste** oder einer **SLO-Liste**. Ein Titel wie `{{UNIT}} NETWORK` zeigt `0660 NETWORK`, `0660, 0661 NETWORK` oder `All NETWORK`. Ein Titel steuert den angezeigten Text; legen Sie **Beschriftungsvariable** fest, um die Monitorabfrage zu filtern.

Das [SLO-Widget](/docs/dashboards/widgets#slo) kann einer Telemetry-Attribute-Variablen auf dem Schlüssel `sloName` folgen, sodass Betrachter wählen, welches SLO es zeigt.

## Links, die die Auswahl behalten

Der Link der Seite trägt die Auswahl jeder Variablen als `?var-<name>=<value>`, mehrere Werte durch Kommas getrennt, sodass ein kopierter Link mit derselben Auswahl öffnet, auch mit einem ausdrücklichen **Alle**. Ein Link wie dieser öffnet den Dienst payments:

```text title="A dashboard link with a variable"
https://oneuptime.com/dashboard/<project-id>/dashboards/<dashboard-id>?var-service=payments
```

Der Link trägt auch den Zeitbereich und die automatische Aktualisierung, die Sie gewählt haben, als `range` und `refresh`, sodass die Empfänger sehen, was Sie sehen. [Einen Link senden](/docs/dashboards/sharing#einen-link-senden) nennt ihre Werte.

## Ein Beispiel: ein Dashboard für jeden Dienst

Ein Dashboard für Dienste hat meist:

1. Eine Variable `service`, Quelle Telemetry Attribute, Attributschlüssel `service.name`, mit Ihrem meistgenutzten Dienst als Standard. Lassen Sie die Mehrfachauswahl aus, damit die Diagramme einen Dienst nach dem anderen zeigen.
2. Eine Variable `namespace`, Quelle Telemetry Attribute, Attributschlüssel `k8s.namespace.name`, mit eingeschalteter Mehrfachauswahl, um Namespaces zu vergleichen.
3. Eine Variable `environment`, Quelle Custom List, Werte `prod, staging`, verwendet als `{{environment}}` in einer Abfrage einer Datenquelle.
4. Widgets, die diese Attribute lesen: Diagramme und Werte der Metriken des Dienstes, ein Log-Stream und eine Kubernetes-Pod-Liste.

Das Ergebnis: ein Dashboard für jeden Dienst, mit drei Auswahlen oben.

## Nächste Schritte

:::cards
- [Dashboard-Widgets](/docs/dashboards/widgets): Welche Widgets welchen Variablen folgen.
- [Externe Datenquellen](/docs/dashboards/data-sources): Eine Variable in eine PromQL- oder SQL-Abfrage einsetzen.
- [Teilen & öffentliche Dashboards](/docs/dashboards/sharing): Variablen auf einem öffentlichen Dashboard.
- [Ein Dashboard erstellen](/docs/dashboards/authoring): Bearbeitung, Speichern und der Zeitbereich.
:::
