# Variablen & Filter

Eine Variable verwandelt ein einzelnes Dashboard in ein Template. Definieren Sie eine `service`-Variable und dasselbe Diagramm wird für `checkout`, `payments` und `search` neu gerendert — wählen Sie aus einem Dropdown am oberen Rand, anstatt drei nahezu identische Dashboards zu bauen.

Diese Seite behandelt die vier Variablentypen, wie ihre Werte in Widget-Abfragen eingespeist werden und die globalen Zeitbereichs- und Aktualisierungssteuerungen, die daneben sitzen.

## Variablentypen

Fügen Sie Variablen unter **Dashboard → Settings → Variables** hinzu. Jede hat einen Namen (in Widget-Abfragen als `{{name}}` referenziert), eine optionale Beschriftung und einen Typ.

### Custom List

Ein statisches Dropdown. Sie liefern eine durch Komma getrennte Liste von Werten; der Betrachter wählt einen aus.

Verwenden Sie es, wenn: die Menge der Optionen klein, fest und nur für Ihr Team aussagekräftig ist. `environment` mit Werten `prod, staging, dev`. `region` mit Werten `us-east-1, eu-west-1, ap-south-1`.

### Query

Die Optionen für das Dropdown werden zur Rendering-Zeit durch eine ClickHouse-Abfrage berechnet.

Verwenden Sie es, wenn: die Optionen dynamisch sind und in Ihrer Telemetrie leben. „Jede Kunden-ID, die sich in den letzten 24 Stunden eingeloggt hat" via `SELECT DISTINCT customer_id FROM ...`. Die Abfrage läuft gegen die Daten Ihres Projekts; behandeln Sie das Ergebnis als nicht vertrauenswürdige Eingabe, auch wenn es Ihre eigenen Daten sind.

### Text Input

Ein Freitextfeld. Was auch immer der Betrachter eingibt, wird eingespeist.

Verwenden Sie es, wenn: Sie das Dashboard wie ein Suchwerkzeug verwenden möchten. Ein „Filter nach IP"- oder „Filter nach Request-ID"-Dashboard.

### Telemetrie-Attribut

Die Optionen sind die unterschiedlichen Werte eines OpenTelemetry-Attributschlüssels über die Telemetrie Ihres Projekts hinweg, über den Zeitbereich des Dashboards.

Konfigurieren Sie den **Attributschlüssel** (z. B. `k8s.cluster.name`, `service.name`, `host.name`). Das Widget holt unterschiedliche Werte aus Logs / Metriken / Traces und bietet sie als Dropdown an.

Verwenden Sie es, wenn: die Optionen genau die Entitäten sind, mit denen Sie Ihre Telemetrie bereits markiert haben. Cluster-Name, Service-Name, Region, Kunden-ID, Deployment-Umgebung — alles, was Sie bereits als OpenTelemetry-Ressourcen- oder Span-Attribut senden.

Dies ist der häufigste Variablentyp für service-orientierte Dashboards, weil er sich automatisch aktualisiert: Wenn Sie einen neuen Service liefern, der mit `service.name = inventory` markiert ist, erscheint dieser Wert im Dropdown, ohne dass jemand das Dashboard bearbeiten muss.

## Mehrfachauswahl

Jede Variable kann auf **Mehrfachauswahl** konfiguriert werden. Wenn aktiviert, wählt der Betrachter einen oder mehrere Werte; das Dashboard filtert nach `value IN (...)` anstelle von `value = ...`.

Verwenden Sie Mehrfachauswahl, wenn: Sie sich „checkout + payments zusammen" anschauen möchten, ohne das Dashboard zu verlassen. Vermeiden Sie sie, wenn die Diagrammberechnung über die ausgewählten Werte hinweg nicht aufgeht — z. B. das Mitteln von Mittelwerten.

## Standardwerte

Jede Variable nimmt einen optionalen Standardwert. Das Dashboard wird mit dem Standardwert gerendert, bis der Betrachter das Dropdown ändert. Für öffentliche Dashboards ist der Standardwert das, womit Besucher landen.

## Wie Interpolation funktioniert

Überall, wo eine Widget-Abfrage einen String-Filter akzeptiert — eine `WHERE`-Klausel einer Metrik-Abfrage, der Filter eines Listen-Widgets, die Attribut-Übereinstimmung eines Log-Streams — können Sie `{{variable_name}}` referenzieren.

Zum Beispiel könnte die Metrik-Abfrage eines Charts so aussehen:

```
SELECT avg(latency_ms) FROM spans WHERE service.name = '{{service}}'
```

Wenn `service` auf `checkout` gesetzt ist, läuft die Abfrage mit `service.name = 'checkout'`. Wenn der Betrachter auf `payments` umschaltet, läuft die Abfrage erneut mit `service.name = 'payments'`.

Speziell für **Telemetrie-Attribut**-Variablen kennt OneUptime den Attributschlüssel und injiziert den Filter in jedes Widget, das dasselbe Attribut erwähnt — Sie müssen nicht die Abfrage jedes Widgets manuell bearbeiten, wenn sich die Variable ändert. Das ist die Magie, die service-templatierte Dashboards sofort einsatzbereit macht.

## Zeitbereich

Die Kopfzeile des Dashboards hat einen globalen **Zeitbereich**-Picker. Jedes Metrik-Widget fragt gegen dieses Fenster ab. Auswahlmöglichkeiten:

- **Voreinstellungen** — letzte 1 Stunde, 24 Stunden, 7 Tage, 30 Tage, 90 Tage (abhängig von Ihrer Aufbewahrung).
- **Benutzerdefinierter Bereich** — wählen Sie Start- und Endzeitstempel.

Der Zeitbereich ist Teil der URL des Dashboards — das Teilen der URL teilt das Fenster. Das ist während eines Vorfalls praktisch: Heften Sie den Zeitbereich auf „heute 10:00–10:30 UTC" und teilen Sie den Link im Vorfall-Kanal.

## Aktualisierungsintervall

Neben dem Zeitbereich wählen Sie, wie oft Widgets erneut abfragen:

- **Aus** — Widgets fragen einmal beim Laden ab.
- **5s / 10s / 30s / 1m / 5m / 15m** — automatische Aktualisierung.

Automatische Aktualisierung ist praktisch für einen wandmontierten Bildschirm und eine aktuelle Vorfallansicht. Für eine Ad-hoc-Untersuchung lassen Sie sie aus, damit die Ansicht stabil bleibt, während Sie scrollen.

## Alles zusammenfügen

Ein service-templatiertes Dashboard hat typischerweise:

1. Eine `service`-Variable vom Typ **Telemetrie-Attribut**, gebunden an `service.name`. Standardwert: Ihr meistbeobachteter Service. Mehrfachauswahl: aus (sodass Diagramme immer einen Service zur Zeit zeigen).
2. Eine `environment`-Variable vom Typ **Custom List**. Standardwert: `prod`.
3. Eine `cluster`-Variable vom Typ **Telemetrie-Attribut**, gebunden an `k8s.cluster.name`. Mehrfachauswahl: ein (sodass Sie über Cluster hinweg aggregieren können).
4. Die Widgets des Dashboards referenzieren diese Variablen in ihren Filtern.

Das Ergebnis: ein Dashboard, die Abdeckung der gesamten Flotte, ein paar Dropdowns am oberen Rand.

## Wo weiterlesen

- [Widgets](/docs/dashboards/widgets) — wie jedes Widget einen Filter konsumiert.
- [Teilen & öffentliche Dashboards](/docs/dashboards/sharing) — Variablen in URLs, einschließlich ihrer Werte für geteilte Links.
- [Ein Dashboard erstellen](/docs/dashboards/authoring) — die Mechanik der Arbeitsfläche.
