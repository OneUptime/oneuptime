# Ein Dashboard erstellen

Erstellen Sie ein Dashboard unter **Dashboards → Dashboard erstellen**, geben Sie ihm einen Namen und öffnen Sie es. Die Arbeitsfläche öffnet sich im **Edit**-Modus, bereit für Widgets.

## Die Arbeitsfläche

Ein Dashboard ist ein Raster. Die Standard-Arbeitsfläche ist **12 Dashboard-Einheiten breit** und **60 Einheiten hoch** — Sie können die Höhe durch Hinzufügen von Zeilen unterhalb der unteren Kante vergrößern. Jede Einheit ist ein Quadrat, das sich mit dem Viewport skaliert: auf einem Desktop ist sie breiter als auf einem Handy, aber jedes Widget behält seine Proportionen.

Widgets belegen ein Rechteck aus Einheiten. Sie entscheiden sowohl über die Position (obere linke Ecke, gemessen in Einheiten von der oberen linken Ecke der Arbeitsfläche) als auch über die Größe (Breite und Höhe in Einheiten). Mindestabmessungen sorgen dafür, dass ein winziges Widget trotzdem lesbar ist.

## Edit vs. View

Der Umschalter in der Kopfzeile wechselt zwischen den beiden Modi:

- **Edit** — die Widget-Palette ist offen, Widgets sind verschiebbar und in der Größe änderbar, jedes Widget hat ein Einstellungsrädchen. Verwenden Sie diesen Modus während des Aufbaus.
- **View** — das Dashboard wird schreibgeschützt gerendert, genau so, wie es jemand mit Nur-Lese-Zugriff (oder ein öffentlicher Besucher) sieht. Verwenden Sie diesen Modus, um das Ergebnis vor dem Teilen zu überprüfen.

Dasselbe Dashboard wird in beiden Modi angezeigt — es gibt keinen separaten „Veröffentlichen"-Schritt. Das Speichern einer Bearbeitung wird sofort für jeden Betrachter wirksam.

## Ein Widget hinzufügen

1. Öffnen Sie die Widget-Palette (die Schaltfläche **+** im Edit-Modus).
2. Wählen Sie den Widget-Typ. Siehe [Widgets](/docs/dashboards/widgets) für den Katalog.
3. Das Widget landet auf der Arbeitsfläche an der nächsten freien Position mit einer Standardgröße.
4. Klicken Sie auf das Rädchen des Widgets, um sein Einstellungs-Panel zu öffnen.
5. Konfigurieren Sie die Datenquelle (Metrik-Abfrage, Listenfilter, Textkörper usw.) und alle Anzeigeoptionen (Schwellenwerte, Einheiten, Achsen, Spalten).
6. Ziehen Sie das Widget, um es zu positionieren. Ziehen Sie eine Ecke, um die Größe zu ändern.

Wiederholen Sie. Das Raster lässt Widgets an ganzzahligen Einheitengrenzen einrasten.

## Datenquellen konfigurieren

Die meisten Widgets lesen aus einer von drei Quellen:

- **Metriken** — eine ClickHouse-gestützte Metrik-Abfrage. Das Widget baut eine `metricQueryConfig` (eine einzelne Serie) oder `metricQueryConfigs` (mehrere Serien gestapelt oder überlagert) auf. Optionales `transformAsRate` wandelt einen OpenTelemetry-Kumulativ-Counter in eine Änderungsrate um. Optionales `formula` lässt Sie zwei Abfragen kombinieren (z. B. Fehleranzahl / Gesamtanzahl).
- **Live-Ressourcenlisten** — Vorfälle, Warnmeldungen, Monitore, Kubernetes-Ressourcen, Docker-Ressourcen, Hosts. Jedes Listen-Widget nimmt einen Filter entgegen (z. B. Labels, Status, Namespace) und zeigt die passenden Zeilen live an.
- **Statischer Inhalt** — das **Text**-Widget nimmt einen Markdown-Body. Verwenden Sie es für Überschriften, Trennlinien, Runbook-Links und „Was ist dieses Dashboard?"-Anmerkungen.

Für Metrik-Widgets spiegelt die Konfiguration den Inline-Query-Builder wider, den Sie anderswo in OneUptime sehen — wählen Sie eine Metrik, wählen Sie eine Aggregation, fügen Sie `WHERE`-Filter hinzu, wählen Sie eine Zeitgruppierung. Die Abfrage läuft gegen die Telemetriedaten Ihres Projekts.

## Schwellenwerte und Formatierung

Widgets, die eine einzelne Zahl anzeigen (**Value**, **Gauge**), nehmen optionale Schwellenwerte:

- **Warnschwellenwert** — den Wert in Gelb rendern, wenn er diesen überschreitet.
- **Kritischer Schwellenwert** — den Wert in Rot rendern, wenn er diesen überschreitet.

Diagramme lassen Sie die Y-Achseneinheit, die Legendenposition und ob Serien gestapelt werden sollen, festlegen. Tabellen lassen Sie auswählen, welche Spalten angezeigt werden, sowie das Zeilenlimit.

## Zeitbereich und Aktualisierung

Die Kopfzeile des Dashboards trägt zwei globale Steuerelemente, die sich auf jedes Metrik-Widget auswirken:

- **Zeitbereich** — wählen Sie eine Voreinstellung (letzte 1 Stunde, 24 Stunden, 7 Tage, 30 Tage) oder einen benutzerdefinierten Bereich. Jedes Metrik-Widget fragt gegen dieses Fenster ab.
- **Aktualisierungsintervall** — Aus, 5s, 10s, 30s, 1m, 5m, 15m. Führt die Abfrage jedes Widgets in der gewählten Kadenz erneut aus. Listen-Widgets, die nativ Websockets unterstützen, aktualisieren sich per Push unabhängig vom gewählten Intervall.

Für Widgets, die den globalen Zeitbereich ignorieren (z. B. einen Textblock), ist die Steuerung wirkungslos.

## Speichern

Die Arbeitsfläche speichert automatisch, während Sie bearbeiten. Ein kleiner Indikator in der Kopfzeile sagt Ihnen, wann die letzte Änderung persistiert ist. Es gibt keinen „Veröffentlichen"-Schritt — jede Bearbeitung ist in dem Moment live, in dem sie gespeichert wird. Wenn Sie eine riskante Änderung vornehmen, duplizieren Sie zuerst das Dashboard.

## Muster, die gut funktionieren

- **Ein Thema pro Dashboard.** Widerstehen Sie der Versuchung, „alles, was wir überwachen" auf eine Seite zu setzen. Drei Dashboards mit den Labels `oncall-checkout`, `oncall-payments`, `oncall-search` altern besser als ein Mega-Dashboard.
- **Verankern Sie den oberen Teil der Seite mit dem wichtigsten Widget.** Menschen scannen von oben — stellen Sie sicher, dass das Erste, was sie sehen, die Antwort auf „ist dieses System gesund?" ist.
- **Verwenden Sie Text-Widgets, um Abschnitte zu beschriften.** Eine kurze Überschrift alle paar Zeilen („Latenz" / „Fehler" / „Kapazität") macht das Dashboard von der anderen Seite des Raums scannbar.
- **Verwenden Sie Variablen anstatt zu duplizieren.** Wenn Sie merken, dass Sie dasselbe Dashboard zweimal für zwei Services bauen, möchten Sie eine `service`-Variable. Siehe [Variablen & Filter](/docs/dashboards/variables).

## Wo weiterlesen

- [Widgets](/docs/dashboards/widgets) — der Katalog und die Konfiguration pro Widget.
- [Variablen & Filter](/docs/dashboards/variables) — Templating mit Variablen, Attribut-Filtern und Zeitbereich.
- [Teilen & öffentliche Dashboards](/docs/dashboards/sharing) — ein Dashboard außerhalb des Teams erreichbar machen.
- [Konfiguration & Berechtigungen](/docs/dashboards/configuration) — Ownership und Zugriffskontrolle.
