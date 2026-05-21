# Dashboard erstellen

Um ein Dashboard zu erstellen, öffnen Sie **Dashboards → Dashboard erstellen**, geben Sie ihm einen Namen und öffnen Sie es. Die Arbeitsfläche öffnet sich im Modus **Bearbeiten**, bereit zum Hinzufügen von Widgets.

## Die Arbeitsfläche

Ein Dashboard ist ein Raster. Widgets rasten ein – Sie entscheiden, wo jedes sitzt und wie groß es ist. Während Sie weitere Reihen hinzufügen, wächst die Seite nach unten. Jedes Widget behält seine Proportionen auf größeren oder kleineren Bildschirmen.

## Bearbeiten und Ansicht

Der Umschalter im Kopfbereich wechselt zwischen zwei Modi:

- **Bearbeiten** – die Widget-Palette ist geöffnet, Sie können Widgets verschieben, ihre Größe ändern und jedes Widget anklicken, um seine Einstellungen zu bearbeiten.
- **Ansicht** – das Dashboard ist schreibgeschützt, genau so, wie es Besucher und andere Teammitglieder sehen. Nutzen Sie diesen Modus, um das Ergebnis vor dem Teilen zu prüfen.

Es handelt sich um dasselbe Dashboard in beiden Modi. Es gibt keinen separaten Schritt zum „Veröffentlichen" – jede Änderung ist live, sobald sie gespeichert ist.

## Ein Widget hinzufügen

1. Klicken Sie auf die Schaltfläche **+**, um die Widget-Palette zu öffnen.
2. Wählen Sie den Widget-Typ. Den Katalog finden Sie unter [Widgets](/docs/dashboards/widgets).
3. Das Widget erscheint auf der Arbeitsfläche.
4. Klicken Sie auf das Zahnradsymbol des Widgets, um seine Einstellungen zu öffnen.
5. Wählen Sie die Datenquelle (eine Metrik, einen Listenfilter, einen Textabschnitt usw.) sowie etwaige Anzeigeoptionen.
6. Verschieben Sie das Widget durch Ziehen. Ziehen Sie an einer Ecke, um die Größe anzupassen.

## Woher die Daten kommen

Die meisten Widgets lesen aus einer von drei Quellen:

- **Metriken** – wählen Sie eine Metrik und eine Aggregation (Durchschnitt, Maximum, Anzahl, Perzentil). Fügen Sie Filter hinzu. Wählen Sie, wie das Ergebnis gruppiert werden soll. Dies ist derselbe Abfrage-Builder, den Sie auch an anderen Stellen in OneUptime sehen.
- **Live-Listen** – Vorfälle, Benachrichtigungen, Monitore, Kubernetes-Pods, Docker-Container, Hosts. Jedes Listen-Widget nimmt einen Filter und zeigt die passenden Einträge live aktualisiert an.
- **Statische Inhalte** – das **Text**-Widget nimmt einen Markdown-Block. Nutzen Sie es für Überschriften, Kontext, Links zu Runbooks oder temporäre Notizen während eines Vorfalls.

## Schwellenwerte und Formatierung

Einzelwert-Widgets (**Wert**, **Anzeige**) erlauben Folgendes:

- Einen **Warn-Schwellenwert** – die Farbe wechselt auf Gelb, wenn der Wert ihn überschreitet.
- Einen **Kritisch-Schwellenwert** – die Farbe wechselt auf Rot, wenn der Wert ihn überschreitet.

Bei Diagrammen können Sie die Einheit der Y-Achse festlegen, die Legendenposition wählen und entscheiden, ob Serien gestapelt oder übereinandergelegt werden. Bei Tabellen können Sie die anzuzeigenden Spalten und die Zeilenanzahl wählen.

## Zeitbereich und Aktualisierung

Oben am Dashboard wirken sich zwei Steuerungen auf jedes Metrik-Widget aus:

- **Zeitbereich** – eine Voreinstellung (letzte Stunde, 24 Stunden, 7 Tage, 30 Tage) oder ein eigener Bereich. Jedes Diagramm und jede Zahl verwendet dieses Fenster.
- **Aktualisierung** – wie häufig die Widgets neu abfragen. Aus, 5 s, 10 s, 30 s, 1 min, 5 min, 15 min. Live-Listen aktualisieren sich unabhängig von dieser Einstellung selbst.

Widgets, die den Zeitbereich nicht nutzen (zum Beispiel ein Text-Widget), ignorieren beide Steuerungen.

## Speichern

Die Arbeitsfläche speichert sich beim Arbeiten von selbst. Eine kleine Anzeige im Kopfbereich teilt mit, wann die letzte Änderung gespeichert wurde. Wenn Sie eine größere Änderung planen, duplizieren Sie das Dashboard zuerst, damit Sie eine sichere Kopie haben.

## Tipps für Dashboards, die langfristig gut altern

- **Ein Thema pro Dashboard.** Widerstehen Sie der Versuchung, „alles, was wir überwachen" auf eine Seite zu packen. Ein paar fokussierte Dashboards schlagen eine einzige riesige Seite.
- **Das wichtigste Widget an den Anfang.** Menschen scannen von oben nach unten – sorgen Sie dafür, dass das Erste, was sie sehen, die Frage „Ist dieses System gesund?" beantwortet.
- **Beschriften Sie Abschnitte mit Text-Widgets.** Eine kurze Überschrift alle paar Zeilen („Latenz", „Fehler", „Kapazität") macht die Seite auch von der anderen Seite des Raums lesbar.
- **Verwenden Sie Variablen statt zu duplizieren.** Wenn Sie kurz davor sind, dasselbe Dashboard für einen zweiten Service zu bauen, bauen Sie stattdessen ein Dashboard mit einer Variable `service`. Siehe [Variablen & Filter](/docs/dashboards/variables).

## Weiterführende Themen

- [Widgets](/docs/dashboards/widgets) – der Katalog.
- [Variablen & Filter](/docs/dashboards/variables) – Variablen, Filter und der Zeitbereich.
- [Freigabe & öffentliche Dashboards](/docs/dashboards/sharing) – außerhalb Ihres Teams teilen.
- [Konfiguration & Berechtigungen](/docs/dashboards/configuration) – Eigentümer und Zugriffskontrolle.
