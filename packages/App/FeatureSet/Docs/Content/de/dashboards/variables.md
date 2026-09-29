# Variablen & Filter

Eine Variable verwandelt ein einzelnes Dashboard in eine Vorlage. Fügen Sie eine Variable `service` zu Ihrem Dashboard hinzu, und dieselben Diagramme werden für `checkout`, `payments` oder `search` neu gerendert – Besucher wählen oben aus einem Dropdown, statt dass Sie drei nahezu identische Dashboards bauen.

## Variablentypen

Fügen Sie Variablen unter **Dashboard → Einstellungen → Variablen** hinzu. Jede Variable hat einen Namen (verwendet als `{{name}}` in Ihren Widgets), eine optionale Beschriftung und einen Typ.

### Benutzerdefinierte Liste

Ein statisches Dropdown. Sie tippen die Optionen selbst ein.

Verwenden Sie es, wenn: die Auswahl klein und fest ist. `environment` mit den Werten `prod, staging, dev`. `region` mit den Werten `us-east-1, eu-west-1, ap-south-1`.

### Abfrage

Die Optionen stammen aus einer Abfrage Ihrer Daten.

Verwenden Sie ihn, wenn: sich die Auswahl mit der Zeit ändert und das Dropdown mitlaufen soll. „Jede Kunden-ID, die in den letzten 24 Stunden gesehen wurde." Die Abfrage läuft gegen die Daten Ihres Projekts und die Ergebnisse werden zum Dropdown.

### Texteingabe

Ein Freitextfeld. Was der Besucher eintippt, wird verwendet.

Verwenden Sie es, wenn: sich das Dashboard wie ein Suchwerkzeug verhalten soll. Filtern nach IP-Adresse, Request-ID oder einem anderen frei eingebbaren Wert.

### Telemetrie-Attribut

Die Optionen sind die unterschiedlichen Werte eines Attributs in Ihrer Telemetrie über den Zeitbereich des Dashboards.

Konfigurieren Sie den **Attributschlüssel** (zum Beispiel `service.name`, `host.name`, `k8s.cluster.name`). Das Dropdown füllt sich mit jedem unterschiedlichen Wert, der in Ihren Logs, Metriken und Traces gesehen wurde.

Verwenden Sie ihn, wenn: die Auswahl den Tags entspricht, die Sie ohnehin mit Ihrer Telemetrie senden. Dies ist der häufigste Typ, weil er sich automatisch aktualisiert – wenn Sie einen neuen Service mit dem Tag `service.name = inventory` ausrollen, erscheint dieser Name im Dropdown, ohne dass Sie das Dashboard bearbeiten müssen.

## Mehrfachauswahl

Jede Variable kann Mehrfachauswahl erlauben. Ist sie aktiv, kann der Besucher einen oder mehrere Werte wählen; das Dashboard filtert dann auf eines davon.

Verwenden Sie Mehrfachauswahl, wenn: Sie „Checkout und Payments zusammen" vergleichen wollen, ohne das Dashboard zu verlassen. Vermeiden Sie sie, wenn die Berechnung über die ausgewählten Werte hinweg nicht funktioniert (zum Beispiel das Durchschnittsbilden von Durchschnitten).

## Standardwerte

Jede Variable kann einen Standardwert haben. Das Dashboard wird mit dem Standardwert gerendert, bis der Besucher ihn ändert. Bei öffentlichen Dashboards sehen Besucher zuerst den Standardwert.

## Wie Sie eine Variable in einem Widget verwenden

Überall, wo ein Widget einen Filter akzeptiert – das `WHERE` einer Metrik, der Filter einer Liste, der Attribut-Abgleich eines Log-Streams – können Sie `{{variable_name}}` verwenden.

Beispiel: ein Diagramm, gefiltert nach Service:

```
service.name = '{{service}}'
```

Wenn das Dropdown auf `checkout` steht, filtert das Diagramm auf den Checkout-Service. Wechselt der Besucher auf `payments`, wird das Diagramm für Payments neu gerendert.

Bei **Telemetrie-Attribut**-Variablen weiß OneUptime, auf welches Attribut die Variable abbildet, und wendet den Filter automatisch auf jedes Widget an, das dasselbe Attribut nutzt – Sie müssen kein Widget einzeln bearbeiten.

## Zeitbereich

Der Dashboard-Kopfbereich hat einen globalen Zeitbereich. Jedes Metrik-Widget fragt gegen dieses Fenster ab. Optionen:

- **Voreinstellungen** – letzte Stunde, 24 Stunden, 7 Tage, 30 Tage, 90 Tage (abhängig von der Aufbewahrungsdauer Ihrer Daten).
- **Eigener Bereich** – Start- und Endzeit wählen.

Der Zeitbereich ist Teil der URL des Dashboards – wer die URL teilt, teilt das Fenster mit. Praktisch bei einem Vorfall: fixieren Sie den Zeitbereich auf „heute 10:00–10:30 UTC" und fügen Sie den Link in den Vorfall-Kanal ein.

## Aktualisierungsintervall

Neben dem Zeitbereich wählen Sie, wie häufig die Widgets neu abfragen:

- **Aus** – die Widgets fragen einmal beim Laden der Seite ab.
- **5 s / 10 s / 30 s / 1 min / 5 min / 15 min** – automatische Aktualisierung.

Automatische Aktualisierung eignet sich für einen Wandbildschirm oder eine Live-Vorfallansicht. Lassen Sie sie ausgeschaltet, wenn Sie analysieren – so bleibt die Ansicht still, während Sie schauen.

## Alles zusammenführen

Ein service-vorlagenartiges Dashboard hat typischerweise:

1. Eine Variable `service` vom Typ **Telemetrie-Attribut** für `service.name`. Standardwert: Ihr am meisten beobachteter Service. Mehrfachauswahl aus (damit Diagramme immer nur einen anzeigen).
2. Eine Variable `environment` vom Typ **Benutzerdefinierte Liste**. Standardwert: `prod`.
3. Eine Variable `cluster` vom Typ **Telemetrie-Attribut** für `k8s.cluster.name`. Mehrfachauswahl an (damit Sie über Cluster hinweg vergleichen können).
4. Widgets, die in ihren Filtern auf diese Variablen verweisen.

Das Ergebnis: ein Dashboard, jeder Service abgedeckt, drei Dropdowns oben.

## Weiterführende Themen

- [Widgets](/docs/dashboards/widgets) – wie jedes Widget einen Filter nutzt.
- [Freigabe & öffentliche Dashboards](/docs/dashboards/sharing) – Variablen und geteilte Links.
- [Dashboard erstellen](/docs/dashboards/authoring) – die Mechanik der Arbeitsfläche.
