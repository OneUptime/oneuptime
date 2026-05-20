# Widgets

Ein Widget ist eine Kachel auf einem Dashboard. Jedes Widget hat einen Typ (Diagramm, Wert, Liste, …), eine Position, eine Größe und eine Konfiguration. Diese Seite ist der Katalog — was jedes Widget anzeigt, was es als Eingabe nimmt, wann Sie dazu greifen.

Für die Mechanik der Arbeitsfläche, siehe [Ein Dashboard erstellen](/docs/dashboards/authoring).

## Zeitreihen-Widgets

### Chart

Ein Linien-/Balken-/Flächendiagramm einer oder mehrerer Metrikserien über den Zeitbereich des Dashboards.

**Konfigurieren**:

- Eine oder mehrere Metrik-Abfragen (`metricQueryConfig` für eine einzelne Serie, `metricQueryConfigs` für mehrere).
- Optionale **formula**, die mehrere Abfragen kombiniert (z. B. `errors / total * 100`).
- Optionales **transformAsRate** für OpenTelemetry-Kumulativ-Counter (z. B. `system.disk.io`) — das Widget berechnet `(value - previousValue) / Δt` pro Bucket.
- Anzeige: gestapelte vs. überlagerte Serien, Y-Achseneinheit, Legende ein/aus, Diagrammtyp.

Greifen Sie dazu, wenn: Trends zählen. Anfragelatenz, Fehleranzahl über die Zeit, Queue-Tiefe — alles, wo die Form der Kurve Ihnen etwas sagt.

### Value

Eine einzelne große Zahl mit optionalen Schwellenwerten und einer optionalen Sparkline.

**Konfigurieren**:

- Eine Metrik-Abfrage (Einzelwert — üblicherweise `last`, `avg` oder `max` über den Zeitbereich).
- Optionaler **Warnschwellenwert** (gelb oberhalb).
- Optionaler **kritischer Schwellenwert** (rot oberhalb).
- Anzeige: Zahlenformat, Einheiten-Suffix.

Greifen Sie dazu, wenn: eine einzelne Zahl die Frage beantwortet. Aktuelle Fehlerrate, P95-Latenz jetzt, Anzahl offener Vorfälle.

### Gauge

Ein kreisförmiges Gauge mit Min, Max, Warn-Band und kritischem Band.

**Konfigurieren**: die Metrik-Abfrage und die vier Grenzen (Min, Max, Warn, kritisch).

Greifen Sie dazu, wenn: der Wert in einem bekannten Bereich liegt. CPU-Auslastung (0–100 %), Festplattenbelegung, Queue-Kapazität.

### Table

Eine tabellarische Anzeige von Metrik-Abfrageergebnissen, eine Zeile pro Gruppe.

**Konfigurieren**: die Metrik-Abfrage (typischerweise gruppiert nach einem Label wie `host.name` oder `service.name`), die anzuzeigenden Spalten und ein Zeilenlimit.

Greifen Sie dazu, wenn: Sie die Aufschlüsselung statt des Trends möchten. Top 10 lauteste Hosts, Fehleranzahl pro Service, Anfragerate pro Endpoint.

## Annotations-Widget

### Text

Ein statischer Block aus Markdown.

**Konfigurieren**: den Markdown-Body. Überschriften, Listen, Links, Hervorhebungen, Code-Spans, eingefasste Codeblöcke werden alle gerendert.

Greifen Sie dazu, wenn: Sie eine Abschnittsüberschrift, einen Kontext-Absatz („dieses Dashboard deckt den Checkout-Service ab"), eine Liste mit Links zu Runbooks oder verwandten Dashboards oder ein temporäres Banner während eines Vorfalls wollen.

## Logs & Traces

### LogStream

Ein Live-Tail von Logzeilen, die einem Filter entsprechen.

**Konfigurieren**: Log-Filter (Service, Severity, Attribut-Übereinstimmungen), die anzuzeigenden Spalten.

Greifen Sie dazu, wenn: Sie sehen wollen, was die Anwendung *gerade jetzt* auf einem Dashboard sagt, ohne die Seite zu verlassen, um den Logs-Explorer zu öffnen.

### TraceList

Eine Liste der letzten Traces, die einem Filter entsprechen, mit Dauer, Status und Service-Name.

**Konfigurieren**: Trace-Filter (Service, Status, Attribut-Übereinstimmungen).

Greifen Sie dazu, wenn: Sie eine paginierte Ansicht der jüngsten Aktivität statt eines Diagramms möchten. Häufige Paarung: ein Latenz-Chart oben, eine TraceList langsamer Traces darunter.

## Betriebslisten

### IncidentList

Eine Live-Liste von Vorfällen, die einem Filter entsprechen.

**Konfigurieren**: Filter nach Zustand, Severity, Labels, Monitor oder zugewiesenem Team.

Greifen Sie dazu, wenn: ein Dashboard die Frage „Was ist gerade kaputt?" beantworten soll.

### AlertList

Eine Live-Liste von Warnmeldungen, die einem Filter entsprechen.

**Konfigurieren**: Filter nach Zustand, Severity, Labels.

Greifen Sie dazu, wenn: Dashboards für alarmgesteuerte Workflows (z. B. Dev-Team-Dashboards, die die Alarme ihres Services beobachten).

### MonitorList

Eine Live-Liste von Monitoren, die einem Filter entsprechen, die den aktuellen Status jedes Monitors zeigt.

**Konfigurieren**: Filter nach Monitor-Typ, Labels oder aktuellem Zustand.

Greifen Sie dazu, wenn: Sie eine Flotten-Ansicht „Sind alle Websites oben?" oder eine Liste pro Team mit überwachten Endpoints möchten.

## Kubernetes-Ressourcenlisten

Für Projekte mit einem installierten [Kubernetes-Agent](/docs/monitor/kubernetes-agent) sind die folgenden Live-Ressourcen-Widgets verfügbar. Jedes nimmt optionale Filter für `cluster`, `namespace` und Labels entgegen.

- **KubernetesPodList** — Pods mit Phase, Neustarts und Node-Zuweisung.
- **KubernetesNodeList** — Nodes mit Bedingungen, Kapazität und Allokationen.
- **KubernetesNamespaceList** — Namespaces und ihre Workload-Anzahl.
- **KubernetesDeploymentList** — Deployments mit gewünschten vs. bereiten Replicas.
- **KubernetesStatefulSetList** — StatefulSets mit bereiten Replicas.
- **KubernetesDaemonSetList** — DaemonSets mit gewünscht vs. bereit.
- **KubernetesJobList** — Jobs mit Abschlussstatus.
- **KubernetesCronJobList** — CronJobs mit Zeitplan und letztem Lauf.

Greifen Sie dazu, wenn: Sie ein einzelnes Dashboard möchten, das den Zustand von Kubernetes-Ressourcen mit der Telemetrie dieser Workloads mischt.

## Docker-Ressourcenlisten

Für Projekte mit installiertem Docker-Monitor:

- **DockerHostList** — Hosts, die Docker ausführen, mit Container-Anzahlen.
- **DockerContainerList** — Container mit Zustand, Image, Host, Uptime.
- **DockerImageList** — Images und ihre Größen.
- **DockerNetworkList** — Docker-Netzwerke und Anzahl der verbundenen Container.
- **DockerVolumeList** — Docker-Volumes und ihre Nutzung.

## Infrastruktur

### HostList

Hosts, die vom Server-Monitor von OneUptime überwacht werden — mit aktuellem Status, CPU, Speicher und Uptime.

**Konfigurieren**: Filter nach Labels oder aktuellem Gesundheitszustand.

## Das richtige Widget wählen

Ein paar Faustregeln:

- **Trend über die Zeit?** Chart.
- **Eine Zahl, die jetzt zählt?** Value (oder Gauge, wenn sie einen natürlichen Bereich hat).
- **Aufschlüsselung über viele Dinge?** Table.
- **Was passiert gerade im System?** LogStream, TraceList, IncidentList.
- **Zustand einer bestimmten Ressourcenflotte?** Das passende Ressourcenlisten-Widget.
- **Eine Überschrift, ein Absatz oder ein Link?** Text.

Die meisten Dashboards verwenden eine Mischung — ein Chart oben, ein oder zwei Values daneben, ein Text-Trenner, dann ein oder zwei Listen darunter.

## Wo weiterlesen

- [Variablen & Filter](/docs/dashboards/variables) — Widgets über Services / Kunden / Cluster hinweg wiederverwendbar machen.
- [Ein Dashboard erstellen](/docs/dashboards/authoring) — die Arbeitsfläche, das Raster und der Edit-Modus.
- [Teilen & öffentliche Dashboards](/docs/dashboards/sharing) — ein Dashboard außerhalb des Teams freigeben.
