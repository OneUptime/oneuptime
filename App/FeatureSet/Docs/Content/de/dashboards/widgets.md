# Widgets

Ein Widget ist eine Kachel auf einem Dashboard. Diese Seite listet jedes Widget auf, das Sie hinzufügen können, was es anzeigt und wann es sich anbietet.

Wie Sie Widgets auf der Arbeitsfläche verschieben, lesen Sie unter [Dashboard erstellen](/docs/dashboards/authoring).

## Diagramme und Zahlen

### Diagramm

Ein Linien-, Balken- oder Flächendiagramm einer oder mehrerer Metrik-Serien über den Zeitbereich des Dashboards.

**Einstellungen**:

- Eine oder mehrere Metrik-Abfragen.
- Eine optionale Formel, die zwei Abfragen kombiniert (zum Beispiel `errors / total * 100`, um eine Fehlerquote zu erhalten).
- Eine Option „als Rate anzeigen" für kumulative Zähler, die ohne Rücksetzen wachsen.
- Anzeigeoptionen: gestapelt oder übereinander, Einheit der Y-Achse, Legendenposition, Diagrammtyp.

Verwenden Sie es, wenn: Trends wichtig sind. Latenz im Zeitverlauf, Fehleranzahl, Warteschlangenlänge – immer dann, wenn die Form der Linie die Geschichte erzählt.

### Wert

Eine einzelne große Zahl mit optionalen farbigen Schwellenwerten.

**Einstellungen**:

- Eine Metrik-Abfrage, die eine einzelne Zahl liefert (letzter Wert, Durchschnitt oder Maximum über den Zeitbereich).
- Ein optionaler **Warn**-Schwellenwert (gelb oberhalb).
- Ein optionaler **Kritisch**-Schwellenwert (rot oberhalb).
- Zahlenformat und Einheit.

Verwenden Sie es, wenn: eine einzelne Zahl die Frage beantwortet. Aktuelle Fehlerquote, P95-Latenz gerade jetzt, Anzahl der offenen Vorfälle.

### Anzeige

Eine kreisförmige Anzeige mit Minimum, Maximum, Warnbereich und kritischem Bereich.

**Einstellungen**: eine Metrik-Abfrage und die vier Grenzen.

Verwenden Sie sie, wenn: der Wert in einem bekannten Bereich liegt. CPU-Auslastung (0–100 %), Festplattennutzung, Warteschlangenkapazität.

### Tabelle

Eine Tabelle mit Metrik-Ergebnissen, eine Zeile pro Gruppe.

**Einstellungen**: eine Metrik-Abfrage (typischerweise gruppiert nach einem Label wie Host oder Service), die anzuzeigenden Spalten und eine Zeilenbegrenzung.

Verwenden Sie sie, wenn: Sie eine Aufschlüsselung statt eines Trends möchten. Top-10-lauteste Hosts, Fehleranzahl pro Service, Anfragen pro Endpunkt.

## Text

Ein statischer Markdown-Block.

**Einstellungen**: der Markdown-Inhalt. Überschriften, Listen, Links, Hervorhebungen und Code-Blöcke werden alle gerendert.

Verwenden Sie ihn, wenn: Sie eine Abschnittsüberschrift, einen Kontextabsatz, eine Linkliste zu Runbooks oder ein temporäres Banner während eines Vorfalls wünschen.

## HTML

Ihr eigenes HTML, CSS und JavaScript, als Widget gerendert.

**Einstellungen**: der HTML-Inhalt, ein optionales Stylesheet, ein optionales Skript und drei Berechtigungsschalter.

Verwenden Sie es, wenn: Sie etwas brauchen, das kein eingebautes Widget abdeckt – ein eingebettetes Badge eines Drittanbieters, eine Tabelle aus einer internen API, eine eigene Legende, eine Sammlung gestalteter Links in Ihre eigenen Tools.

### Was es kann und was nicht

Das Widget wird in einem Sandbox-Frame mit einer eigenen, isolierten Origin gerendert. Innerhalb dieses Frames kann Ihr Code so gut wie alles tun: DOM aufbauen, Timer laufen lassen, von beliebigen URLs abrufen, auf ein Canvas zeichnen.

Was es nicht kann, ist die OneUptime-Seite drumherum zu erreichen. Es hat keinen Zugriff auf das DOM des Dashboards, auf Cookies, den lokalen Speicher oder die API-Sitzung, und es kann den Browser-Tab nicht wegnavigieren. Das gilt unabhängig davon, ob das Dashboard privat oder öffentlich freigegeben ist.

Zwei Konsequenzen, die Sie kennen sollten, bevor Sie etwas hineinkopieren:

- Ein `fetch` aus dem Widget ist eine Cross-Origin-Anfrage von einer intransparenten Origin, der aufgerufene Server muss sie also per CORS erlauben. Die OneUptime-API von hier aus aufzurufen wird nicht unterstützt.
- Das Widget startet transparent. Setzen Sie in Ihrem CSS einen Hintergrund auf `body`, wenn es die Kachel ausfüllen soll.

### Dashboard-Variablen verwenden

Schreiben Sie `{{variableName}}` an beliebiger Stelle im HTML, CSS oder JavaScript, und der Platzhalter wird vor dem Rendern des Widgets durch den aktuellen Wert dieser Variablen ersetzt. Die Auswahl eines neuen Werts rendert das Widget neu. Ein Platzhalter, der eine nicht existierende Variable benennt, bleibt unverändert stehen.

Skripte erhalten dieselben Werte sowie den Zeitbereich des Dashboards über `window.ONEUPTIME`:

```javascript
window.ONEUPTIME.variables.environment; // aktueller Wert oder "", falls nicht gesetzt
window.ONEUPTIME.startDate; // String im Format ISO 8601, Beginn des Zeitbereichs des Dashboards
window.ONEUPTIME.endDate; // String im Format ISO 8601, dessen Ende
```

Das Widget lädt bei jeder Aktualisierung des Dashboards neu, sodass ein Widget, das seine eigenen Daten abruft, mit dem Aktualisierungsintervall Schritt hält.

### Berechtigungen

**Run JavaScript** („JavaScript ausführen", standardmäßig aktiviert) führt Ihr Skript aus. Schalten Sie es aus, um nur Markup und Styles zu rendern – das Skript wird dann vollständig aus dem Widget herausgelassen und nicht bloß blockiert.

**Open links in a new tab** („Links in neuem Tab öffnen", standardmäßig aktiviert) erlaubt Links und `window.open`, einen Browser-Tab zu öffnen. Links öffnen immer in einem neuen Tab; das Widget kann niemals das Dashboard selbst wegnavigieren.

**Allow forms to submit** („Absenden von Formularen erlauben", standardmäßig deaktiviert) erlaubt es einem `<form>` innerhalb des Widgets, abgesendet zu werden.

Wer das Dashboard bearbeiten darf, bestimmt, was dieses Widget ausführt, und jeder, der das Dashboard ansieht, führt es aus – bei einem öffentlichen Dashboard schließt das anonyme Besucher ein. Behandeln Sie Bearbeitungsrechte an einem Dashboard mit einem HTML-Widget so, wie Sie den Zugriff auf jeden anderen Code behandeln würden, den Sie ausliefern.

## Logs und Traces

### Log-Stream

Ein Live-Tail von Logzeilen, die einem Filter entsprechen.

**Einstellungen**: Log-Filter (Service, Schweregrad, Attribute) und die anzuzeigenden Spalten.

Verwenden Sie es, wenn: Sie sehen möchten, was die Anwendung gerade jetzt sagt, ohne das Dashboard zu verlassen.

### Trace-Liste

Eine Liste der zuletzt aufgetretenen Traces, die einem Filter entsprechen, mit Dauer, Status und Service.

**Einstellungen**: Trace-Filter (Service, Status, Attribute).

Verwenden Sie sie, wenn: Sie eine Liste der letzten Aktivität statt eines Diagramms möchten. Ein typisches Muster ist ein Latenzdiagramm oben mit einer Liste langsamer Traces darunter.

## Live-Listen

### Vorfall-Liste

Eine Live-Liste der Vorfälle, die einem Filter entsprechen.

**Einstellungen**: Filter nach Status, Schweregrad, Labels, Monitor oder Team.

Verwenden Sie sie, wenn: das Dashboard die Frage „Was ist gerade kaputt?" beantworten soll.

### Benachrichtigungs-Liste

Eine Live-Liste der Benachrichtigungen, die einem Filter entsprechen.

**Einstellungen**: Filter nach Status, Schweregrad, Labels.

Verwenden Sie sie, wenn: ein Team-Dashboard die Benachrichtigungen zu seinen Services nachverfolgt.

### Monitor-Liste

Eine Live-Liste der Monitore und ihres aktuellen Status.

**Einstellungen**: Filter nach Monitor-Typ, Labels oder aktuellem Status.

Verwenden Sie sie, wenn: Sie eine Flottenübersicht wollen – „Sind alle Sites online?"

## Kubernetes-Ressourcenlisten

Für Projekte mit installiertem [Kubernetes Agent](/docs/monitor/kubernetes-agent). Jede Liste nimmt optionale Filter für Cluster, Namespace und Labels.

- **Kubernetes-Pod-Liste** – Pods mit Phase, Restarts und Node.
- **Kubernetes-Node-Liste** – Nodes mit ihren Bedingungen und ihrer Kapazität.
- **Kubernetes-Namespace-Liste** – Namespaces und Workload-Anzahl.
- **Kubernetes-Deployment-Liste** – Deployments mit gewünschter vs. bereiter Replica-Anzahl.
- **Kubernetes-StatefulSet-Liste** – StatefulSets mit Anzahl bereiter Replikate.
- **Kubernetes-DaemonSet-Liste** – DaemonSets mit gewünschter vs. bereiter Anzahl.
- **Kubernetes-Job-Liste** – Jobs und ihr Abschlussstatus.
- **Kubernetes-CronJob-Liste** – CronJobs mit Zeitplan und letzter Ausführung.

Verwenden Sie diese Widgets, wenn: Sie ein einziges Dashboard wünschen, das den Zustand von Kubernetes mit Telemetrie dieser Workloads vereint.

## Docker-Ressourcenlisten

Für Projekte mit eingerichtetem Docker-Monitoring.

- **Docker-Host-Liste** – Hosts, die Docker ausführen, mit Container-Anzahl.
- **Docker-Container-Liste** – Container mit Status, Image, Host, Laufzeit.
- **Docker-Image-Liste** – Images und ihre Größen.
- **Docker-Netzwerk-Liste** – Docker-Netzwerke und verbundene Container.
- **Docker-Volume-Liste** – Docker-Volumes und ihre Nutzung.

## Infrastruktur

### Host-Liste

Hosts, die vom OneUptime-Server-Monitor überwacht werden, mit Status, CPU, Speicher und Laufzeit.

**Einstellungen**: Filter nach Labels oder aktuellem Status.

## Welches Widget soll ich verwenden?

Ein paar Faustregeln:

- **Trend über die Zeit?** Diagramm.
- **Eine Zahl, die gerade zählt?** Wert (oder Anzeige, falls es ein klares Min/Max gibt).
- **Aufschlüsselung über viele Dinge?** Tabelle.
- **Was passiert gerade im System?** Log-Stream, Trace-Liste, Vorfall-Liste.
- **Status einer bestimmten Ressourcengruppe?** Das passende Listen-Widget.
- **Eine Überschrift, ein Absatz oder ein Link?** Text.
- **Etwas, das nichts davon abdeckt?** HTML – aber erst, nachdem Sie geprüft haben, ob ein eingebautes Widget es wirklich nicht kann.

Die meisten Dashboards mischen ein paar – ein Diagramm oben, daneben ein oder zwei Werte, ein Text-Trenner und ein oder zwei Listen darunter.

## Weiterführende Themen

- [Variablen & Filter](/docs/dashboards/variables) – Widgets für viele Services oder Kunden wiederverwendbar machen.
- [Dashboard erstellen](/docs/dashboards/authoring) – die Mechanik der Arbeitsfläche.
- [Freigabe & öffentliche Dashboards](/docs/dashboards/sharing) – außerhalb Ihres Teams teilen.
