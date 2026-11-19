# Kubernetes-Kosten-Observability

Sehen Sie, was jeder Kubernetes-Workload kostet — Ausgaben pro Namespace, Workload und Pod, Leerlaufkapazität und wie viel von jedem Request genutzt wird — neben den Metriken, Logs und Traces, die der [Kubernetes-Agent](/docs/telemetry/kubernetes-agent) bereits erfasst. Es ist standardmäßig eingeschaltet, ohne Cloud-Zugangsdaten: Die Übersicht des Clusters zeigt, was er kostet, seine Seite **Kosten** sagt Ihnen, welche Requests Sie verkleinern können, und die Kostenmetriken lassen sich wie alle anderen in Diagrammen darstellen und für Warnungen nutzen.

:::cards
- [Einschalten](#kosten-observability-einschalten): Standardmäßig eingeschaltet; wo nicht, genügt ein `helm upgrade`.
- [Bei Kosten alarmieren](#bei-kosten-alarmieren): Kosten pro Cluster, Namespace und Workload, als Metriken.
- [Ihre eigene Engine](#betreiben-sie-bereits-kubecost-oder-opencost): Ein Kubecost oder OpenCost, das Sie bereits betreiben, wird gefunden und gelesen.
- [Größenoptimierung](#größenoptimierung): Empfehlungen für Requests und wie sie entstehen.
- [Fehlerbehebung](#fehlerbehebung): Leere Seiten, fehlende Empfehlungen.
:::

## So funktioniert es

Ist die Kostenüberwachung eingeschaltet, wie standardmäßig (`cost.enabled: auto`), führt das Chart neben dem Agent vier Dinge aus:

```mermaid title="Woher die Kostenzahlen kommen"
flowchart TB
    cadvisor["cAdvisor, über den<br/>Node-Proxy des API-Servers"] --> prometheus["Mitgeliefertes Prometheus"]
    prometheus --> opencost["OpenCost"]
    pricing["Cloud-Listenpreise<br/>oder Ihre Preistabelle"] --> opencost
    opencost -->|"je eine abgeschlossene<br/>Stunde"| poller["Kosten-Poller"]
    opencost -->|"Kostenmetriken"| collector["Collector des Agents"]
    poller -->|"Kostenzeilen"| oneuptime["OneUptime"]
    collector -->|"OTLP"| oneuptime
```

1. **OpenCost**, die Open-Source-Kosten-Engine (Apache-2.0, CNCF; das [cost-model](https://github.com/kubecost/cost-model), auf dem auch Kubecost beruht). Sie beobachtet den Cluster, bepreist Ihre Knoten, Volumes und Load Balancer und berechnet, was jeder Workload kostet.
2. **Ein kleines Prometheus**, das OpenCost für den Nutzungs- und Preisverlauf braucht. Es läuft mit einem Replica, behält 7 Tage Verlauf und scrapt genau zwei Ziele: cAdvisor über den Node-Proxy des API-Servers, wobei es nur die Serien behält, die OpenCost liest, und OpenCost selbst (das seine eigenen Metriken zu Ressourcen-Requests ausgibt, sodass kube-state-metrics nicht beteiligt ist). Es wird nie außerhalb des Clusters erreichbar gemacht, und seine Daten verlassen ihn nie.
3. **Der Kosten-Poller** (`cost.agent`). Einmal pro abgeschlossener Stunde liest er die Allocation API von OpenCost und sendet eine Kostenzeile pro Workload an OneUptime: CPU, Speicher, GPU, Volumes, Netzwerk, Load Balancer und Leerlauf, mit Effizienz. Jede Stunde wird einmal gesendet; der Server überspringt eine Stunde, die er schon hat, daher kann ein Neustart Ausgaben nicht doppelt zählen. Aus diesen Zeilen schreibt OneUptime außerdem die [Kostenmetriken](#bei-kosten-alarmieren).
4. **Ein Scrape der Kostenmetriken** (`cost.metrics`). Der Collector des Agents scrapt die Preismetriken von OpenCost, also was jeder Knoten, jedes Volume und jeder Load Balancer pro Stunde kostet, und sendet sie mit den übrigen Metriken des Clusters.

OpenCost bepreist Knoten ohne Zugangsdaten anhand der öffentlichen Listenpreise Ihres Cloud-Anbieters (AWS, Google Cloud, Azure). Anderswo verwendet es seine Standardsätze, die eine eigene [Preistabelle](#preise-für-on-prem-und-bare-metal) ersetzt.

Die drei Pods fordern zusammen etwa 150m CPU und 450Mi Speicher an. Mit den Presets `gke-autopilot` und `eks-fargate` ist die Kostenüberwachung standardmäßig aus: Diese Plattformen rechnen jeden Pod nach dem ab, was er anfordert, sodass die Kosten-Pods die Rechnung erhöhen würden, die sie messen, und OpenCost bepreist Knoten, während keine der beiden Plattformen nach Knoten abrechnet.

## Kosten-Observability einschalten

Eine neue Installation braucht nichts: Die Kostenüberwachung ist standardmäßig eingeschaltet. Aktualisieren Sie einen Agent, der installiert wurde, bevor sie es war, oder schalten Sie sie mit dem Preset `gke-autopilot` oder `eks-fargate` ein:

:::steps
### Den Agent aktualisieren

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reset-then-reuse-values \
  --set cost.enabled=true
```

Das ist eine vollständige Installation: drei kleine zusätzliche Pods, OpenCost, sein Prometheus und der Kosten-Agent. Haben Sie den Agent unter einem anderen Release-Namen oder Namespace installiert, verwenden Sie Ihre (`helm list -A | grep kubernetes-agent` zeigt sie an). Um die Kostenüberwachung auszuschalten, setzen Sie auf dieselbe Weise `--set cost.enabled=false`.

### Auf die erste abgeschlossene Stunde warten

Die ersten Kosten erscheinen, nachdem die erste volle Stunde abgeschlossen ist, und OpenCost braucht nach dem Start ein paar Minuten, um seine erste Stunde zu bepreisen.

### Die Kostenseiten öffnen

- **Produkte → Infrastruktur → Kubernetes → Kosten** zeigt die Ausgaben aller Cluster im Projekt.
- Auf einem Cluster zeigt die Übersicht seine Ausgaben der letzten 24 Stunden, eine monatliche Hochrechnung, Leerlaufausgaben, Effizienz und seine teuersten Namespaces und Workloads.
- Auf einem Cluster zeigt **Kosten** den Verlauf seiner Ausgaben, **Ausgaben nach Namespace** mit der Aufteilung auf CPU, Speicher und Storage, **Ausgaben nach Workload**, Leerlaufausgaben, Effizienz und die Karte **Größenoptimierung**.
:::

Die Kostenmetriken (`node_total_hourly_cost`, `pv_hourly_cost` und die übrigen) sind gewöhnliche Metriken: Sie stehen im Metrik-Explorer, auf eigenen Dashboards und in Metrik-Monitoren zur Verfügung. Für ein fertiges Dashboard gehen Sie zu **Produkte → Dashboards**, wählen **Dashboard erstellen** und dann **Kubernetes Cost Dashboard**: Verläufe der stündlichen Knotenkosten, Stückkosten für CPU und Speicher sowie Ausgaben für Volumes und Load Balancer.

Unter den Zahlen sagen die Übersicht und die Seite **Kosten**, woher ihre Preise stammen: aus den Listenpreisen einer Cloud, aus Ihrer Preistabelle oder aus den Standardsätzen von OpenCost. Die Effizienz ist überall dieselbe Zahl, die Effizienzmetrik eingeschlossen: wie viel der angeforderten CPU und des angeforderten Speichers genutzt wurde, wobei jede Stunde eines Containers nach dem gewichtet wird, was seine CPU und sein Speicher kosten, sodass ein günstiger Job, der nichts nutzt, einen gut ausgelasteten Cluster nicht nach unten ziehen kann; Leerlaufkapazität wird nicht mitgezählt.

## Betreiben Sie bereits Kubecost oder OpenCost?

Der Kosten-Agent findet Ihre Engine und liest sie anstelle des mitgelieferten OpenCost, sodass der Cluster so bepreist wird, wie Sie es eingerichtet haben: nach Ihrer Preistabelle oder nach Ihrer Cloud-Rechnung hinter Kubecost. Beim Start und danach stündlich sucht er über die Kubernetes-API nach den Services, die von den eigenen Charts der Engines in einem beliebigen Namespace angelegt werden (`cost-analyzer` oder `frontend` von Kubecost, dem Service des OpenCost-Charts und dem Service `opencost`, den das Manifest von OpenCost anlegt), Kubecost zuerst. Eine Engine, die nicht antwortet, eine Anmeldung verlangt oder für mehrere Cluster antwortet, übergeht er und liest dann die mitgelieferte.

Die Übersicht des Clusters nennt dann Ihre Engine und sagt, dass das mitgelieferte OpenCost nicht gebraucht wird. Schalten Sie es ab:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reset-then-reuse-values \
  --set cost.engine.url=auto
```

Mit `cost.engine.url=auto` wird nichts mitgeliefert, und der Agent liest Ihre Engine, wo immer sie läuft; ist keine Engine installiert, wird nichts bepreist. Das Chart kann nicht selbst nach einer Engine suchen: Die Funktion `lookup` von Helm sieht unter `helm template`, in Argo CD oder bei einem Probelauf nichts. Um das mitgelieferte OpenCost neben Ihrer eigenen Engine zu behalten, setzen Sie `cost.engine.preferExisting=false`; um die zu lesende Engine festzulegen, setzen Sie `cost.engine.url` auf ihren Service:

| Engine | Übliche Service-URL |
| --- | --- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003` |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090` |

Der Pfad der Allocation API wird von selbst gefunden (`/model/allocation` für Kubecost, `/allocation/compute` oder `/allocation` für OpenCost). Setzen Sie `cost.engine.allocationPath` nur bei einer ungewöhnlichen Installation. Mit `auto` oder einer URL wird nichts mitgeliefert; für Speicherempfehlungen setzen Sie daher außerdem `cost.engine.prometheusUrl` (siehe [Die Daten dahinter](#die-daten-dahinter)).

## Preise für On-Prem und Bare Metal

Cluster, deren Knoten keinen öffentlichen Cloud-Listenpreis haben, können eine Preistabelle festlegen. Ohne sie bepreist OpenCost diese Knoten zu seinen Standardsätzen (On-Prem, Bare Metal, kind, k3s), die weit von dem entfernt sein können, was Ihre Hardware kostet, und die Übersicht und die Seite **Kosten** des Clusters weisen darauf hin; in einer Cloud, die es erkennt, behält ein Knoten seinen Listenpreis, und eine Preistabelle bepreist nur, was in der Liste fehlt. Mit einer Preistabelle bepreist OpenCost dann jede Ressource anhand dieser Werte, alle in USD pro Ressourcenstunde:

```yaml title="values.yaml"
cost:
  enabled: true
  opencost:
    customPricing:
      enabled: true
      cpuPerCoreHour: "0.031611"       # ~$23 per core-month
      ramPerGiBHour: "0.004237"        # ~$3 per GiB-month
      storagePerGBHour: "0.00005479452" # ~$0.04 per GB-month
      gpuPerHour: "0.95"
```

Das sind die eigenen Standardsätze von OpenCost: Tragen Sie Ihre eigenen Werte ein, sonst sagt die Seite **Kosten** weiterhin, dass der Cluster zu den Standardsätzen von OpenCost bepreist wird.

## Wissenswerte Einstellungen

Alle optional; die `values.yaml` des Charts enthält die vollständige Liste:

```yaml title="values.yaml"
cost:
  enabled: auto           # on, except with the gke-autopilot and eks-fargate presets
  agent:
    windowSeconds: 3600   # allocation window length (hourly = native)
    includeIdle: true     # ship the engine's __idle__ allocation
    currency: USD         # currency code shown in the UI (informational)
  prometheus:
    retention: 7d         # bundled TSDB history; right-sizing reads peaks back over days
    persistence:
      enabled: false      # set true for a small PVC; emptyDir otherwise
  metrics:
    enabled: true         # cost metrics for dashboards / Metric Explorer
    scrapeInterval: 60s
```

## Größenoptimierung

Die Karte **Größenoptimierung** auf der Seite **Kosten** eines Clusters empfiehlt einen CPU- und einen Speicher-Request für jeden Container, zu dem es genug Verlauf gibt, geordnet danach, wie viel jede Änderung pro Monat spart.

Eine Empfehlung ist der beobachtete Bedarf plus 25% Reserve, gerundet auf einen Wert, den Sie in ein Manifest einfügen können (10m CPU, 16Mi Speicher):

- Die CPU wird nach dem 95. Perzentil der stündlichen Durchschnittsnutzung bemessen: hoch genug, um echte Last abzudecken, niedrig genug, dass eine einzelne Spitze den Request nicht für einen Monat aufbläht.
- Der Speicher wird nach dem Spitzenwert des Working Sets bemessen, nie nach einem Durchschnitt (siehe [Die Daten dahinter](#die-daten-dahinter)).

Empfohlen werden Requests, keine Limits. Ein Request ist das, was der Scheduler reserviert und woraus die Rechnung berechnet wird; er ist also die Zahl, die die Kosten bewegt. Ein Limit ist eine Entscheidung darüber, ob ein fehlerhafter Container gedrosselt oder beendet werden soll, und diese Entscheidung können Nutzungsdaten nicht für Sie treffen.

Jeder Container wird mit seinem aktuellen Request verglichen:

| Urteil | Bedeutung |
| --- | --- |
| Überprovisioniert | Er reserviert deutlich mehr, als er nutzt. Hier entstehen die Einsparungen. |
| Unterprovisioniert | Er reserviert weniger, als er nutzt, und wird daher gedrosselt oder riskiert einen OOM-Kill. Das zu beheben kostet Geld, und die Karte zeigt das als Anstieg. |
| Kein Request gesetzt | Es gibt nichts zu verkleinern, aber der Scheduler kann den Container nicht sicher platzieren, und er wird unter Druck als Erster verdrängt. |

Ein Container, der höchstens 15% von seiner Empfehlung abweicht, gilt als richtig bemessen und wird weggelassen: Niemand sollte ein Manifest bearbeiten, um 3% von einem Request abzuziehen.

Zwei Schutzmechanismen halten die Empfehlungen ehrlich. Ein Workload braucht mindestens 24 Stunden an Kostenfenstern, bevor er überhaupt bemessen wird, weil ein Fenster von vier Stunden einen nächtlichen Batch-Job im Ruhezustand erwischen und raten kann, ihn auf nichts zu verkleinern. Und Einsparungen werden aus der Länge des betrachteten Fensters hochgerechnet, nicht aus der Zahl der Zeilen; die Einsparung eines Deployments wird daher nicht mit seiner Replica-Zahl multipliziert. Die Schätzung nimmt an, dass die Ausgaben mit dem skalieren, was die Engine zugeteilt hat, also `max(request, usage)`; bei einem überprovisionierten Container ist das der Request, die Einsparung ist also exakt.

### Die Daten dahinter

Neben den Ausgaben erfasst der Poller, was eine Empfehlung braucht: die CPU- und Speicher-Requests, Limits und die Nutzung jedes Containers.

Speicher braucht eine weitere Quelle. Die Allocation API meldet nur einen Durchschnitt über jedes Fenster, und ein stündlicher Durchschnitt verbirgt den Ausschlag, der einen Container per OOM-Kill beendet; den Speicher danach zu bemessen, wäre daher gefährlich. Der Poller liest stattdessen die Speicherspitze jedes Containers aus Prometheus, verknüpft über `(namespace, pod, container)`:

- Mit der mitgelieferten Engine (dem Standard) verwendet er das eigene Prometheus des Charts. Nichts zu setzen.
- Ist `cost.engine.url` gesetzt (`auto` oder die URL Ihrer Engine), verweisen Sie `cost.engine.prometheusUrl` auf ein Prometheus, das cAdvisor scrapt, und setzen `cost.engine.prometheusCadvisorJob`, wenn dessen Scrape-Job nicht `kubernetes-nodes-cadvisor` heißt.
- Ohne Prometheus funktionieren CPU-Empfehlungen weiterhin, aus den gespeicherten Stundendurchschnitten, und Speicherempfehlungen werden weggelassen, statt geraten zu werden.

Ein Ausfall von Prometheus stoppt die Erfassung der Ausgaben nie: Spitzenwerte sind eine Zugabe, und eine Stunde wird dann ohne sie gesendet. Für die CPU wird Prometheus bewusst nicht verwendet: Ein zu großer CPU-Request drosselt nur, wo ein zu kleiner Speicher-Request beendet; die Stundendurchschnitte sind für die CPU daher sicher, und die CPU-Rate jedes Containers clusterweit abzufragen, ist so aufwendig, dass es ein kleines Prometheus umwerfen kann.

## Bei Kosten alarmieren

OneUptime schreibt aus den Kostenzeilen jeder Stunde vier Metriken, bepreist und nach dem benannt, was sie messen, sodass Sie Kosten in Diagrammen darstellen, auf ein Dashboard legen und in einem [Kubernetes-Monitor](/docs/monitor/kubernetes-monitor) oder einem [Metrik-Monitor](/docs/monitor/metrics-monitor) bei ihnen alarmieren können:

| Metrik | Bedeutung | Attribute |
| --- | --- | --- |
| `oneuptime.kubernetes.cost.total` | Was der Cluster in jeder Stunde gekostet hat, Leerlaufkapazität eingeschlossen | `k8s.cluster.name` |
| `oneuptime.kubernetes.cost.idle` | Der Teil davon, den kein Workload genutzt hat: Leerlauf- und nicht zugeteilte Kapazität | `k8s.cluster.name` |
| `oneuptime.kubernetes.cost.workload` | Was jeder Workload in jeder Stunde gekostet hat; nach Namespace summiert, was der Namespace gekostet hat | `k8s.cluster.name`, `k8s.namespace.name` und der Name des Workloads unter seiner Art, etwa `k8s.deployment.name` |
| `oneuptime.kubernetes.cost.efficiency` | Wie viel seiner angeforderten CPU und seines angeforderten Speichers jeder Workload genutzt hat, in Prozent, nach Kosten gewichtet | Die des Workloads, wie oben |

Jeder Punkt enthält die Kosten einer Stunde, in der Währung des Agents (standardmäßig USD), trägt den Beginn der Stunde als Zeitstempel und wird etwa eine Stunde nach ihrem Ende geschrieben: Summieren Sie die Punkte über ein Fenster von Stunden, dann ergeben die eines Tages die Kosten dieses Tages. Sie stammen aus dem, was der Cluster bereits gesendet hat, werden daher nicht als aufgenommene Metriken abgerechnet und so lange aufbewahrt wie die übrigen Metriken des Clusters.

Der Kubernetes-Monitor hat drei Vorlagen dafür: Cluster Daily Cost Over Budget, Namespace Daily Cost Over Budget und High Idle Spend, jede mit einem Budget, das Sie auf Ihr eigenes setzen. Auch die Preismetriken von OpenCost sind gewöhnliche Metriken: Ein Metrik-Monitor kann alarmieren, wenn der Durchschnitt von `node_total_hourly_cost` ein Budget übersteigt oder wenn `pv_hourly_cost` für eine Volume-Klasse erscheint, die es in einem Cluster nicht geben sollte.

## Datenmodell und Aufbewahrung

Kostenzeilen werden in ClickHouse gespeichert, eine pro Cluster, Fenster, Namespace, Controller, Pod und Container. Sie folgen der Telemetrie-Aufbewahrung des Clusters: dem `retainTelemetryDataForDays` des Clusters oder, wenn das nicht gesetzt ist, der Datenaufbewahrung des Projekts. Leerlauf und nicht zugeteilte Kapazität werden als gewöhnliche Zeilen unter den Namespaces `__idle__` und `__unallocated__` gespeichert und lassen sich daher wie Workload-Ausgaben gruppieren und filtern.

## Fehlerbehebung

:::details Die Kostenseiten sind leer
Mit den Presets `gke-autopilot` und `eks-fargate` ist die Kostenüberwachung standardmäßig aus: Schalten Sie sie mit `--set cost.enabled=true` ein. Andernfalls lesen Sie die Logs des Kosten-Pollers: `kubectl logs -n oneuptime-agent deploy/kubernetes-agent-cost`. (Das Deployment heißt `<release>-kubernetes-agent-cost`, wenn der Release-Name `kubernetes-agent` nicht enthält; `kubectl get deploy -n oneuptime-agent` listet sie auf.) `HTTP 401` bedeutet, dass OneUptime den Ingestion-Schlüssel abgelehnt hat. `did not answer any known allocation path` bedeutet, dass die Engine noch nicht bereit ist (das mitgelieferte OpenCost braucht ein paar Minuten, um seine ersten Stunden zu bepreisen) oder dass `cost.engine.url` falsch ist.
:::

:::details Das mitgelieferte OpenCost ist nicht bereit
Lesen Sie seine Logs: `kubectl logs -n oneuptime-agent deploy/kubernetes-agent-opencost`. Sie nennen den erkannten Cloud-Anbieter und ob seine Preisdaten geladen wurden.
:::

:::details Die Übersicht sagt, dass das mitgelieferte OpenCost nicht gebraucht wird
Der Cluster betreibt sein eigenes Kubecost oder OpenCost, und der Kosten-Agent liest dieses, sodass das OpenCost und das Prometheus, die das Chart mitgeliefert hat, nichts bepreisen. Aktualisieren Sie mit `--set cost.engine.url=auto`, um sie abzuschalten, oder setzen Sie `cost.engine.preferExisting=false`, um stattdessen die mitgelieferte Engine zu lesen.
:::

:::details Der Kosten-Agent liest Ihre Engine nicht
Sein Log sagt, welche Engine er liest und warum er die anderen übergangen hat: `kubectl logs -n oneuptime-agent deploy/kubernetes-agent-cost`. Er übergeht eine Engine, die nicht antwortet (etwa wegen einer NetworkPolicy zwischen den Namespaces), eine Anmeldung verlangt oder für mehrere Cluster antwortet, wie es ein Kubecost tut, das weitere Cluster föderiert. Legen Sie die zu lesende Engine mit `cost.engine.url` fest.
:::

:::details Das OpenCost-Log meldet mkdir /var/configs: permission denied
Ein älteres Chart führte OpenCost ohne beschreibbares Konfigurationsverzeichnis aus; nach `Error downloading default pricing data` konnte seine Allocation API daher nicht antworten, und der Poller blieb stehen, während der Pod `Running` blieb, `/healthz` grün blieb und die Knotenkostenmetriken weiter veröffentlicht wurden. Aktuelle Charts beheben das: Führen Sie `helm repo update` aus und aktualisieren Sie dann mit `--reset-then-reuse-values`. Kostenzeilen erscheinen beim nächsten Abruf.
:::

:::details Das Kubernetes Cost Dashboard zeigt keine Daten
Die Vorlage liest die gescrapten Kostenmetriken: Prüfen Sie, ob `cost.metrics.enabled` auf `true` steht.
:::

:::details Die Karte Größenoptimierung ist leer
Entweder ist der Zeitraum kürzer als die 24 Stunden, die eine Empfehlung braucht (erweitern Sie ihn), oder jeder Container liegt bereits innerhalb von 15% seines empfohlenen Requests, was die Karte dann sagt.
:::

:::details Speicherempfehlungen zeigen - an, CPU-Empfehlungen funktionieren aber
Kein Speicher-Spitzenwert hat OneUptime erreicht, daher wurde der Speicher nicht bemessen, statt aus einem Durchschnitt geraten zu werden. Mit Ihrer eigenen Engine setzen Sie `cost.engine.prometheusUrl`. Die Karte sagt, wie viele Container das betrifft.
:::

:::details Die Zahlen weichen von der Oberfläche der Engine ab
OneUptime rechnet die Abgleichskorrekturen der Engine in jeden Kostenbestandteil ein und sendet ganze, abgeschlossene Stunden: Die Ausgaben der laufenden Stunde erscheinen, nachdem sie abgeschlossen ist.
:::

:::details Das mitgelieferte Prometheus wurde neu gestartet
Mit dem standardmäßigen Speicher `emptyDir` gehen bei einem Neustart einige Stunden Nutzungsverlauf verloren, sodass die Kosten dieser Stunden kleiner ausfallen können. Setzen Sie `cost.prometheus.persistence.enabled=true`, wenn Ihnen das wichtig ist.
:::

## Nächste Schritte

:::cards
- [Kubernetes-Agent](/docs/telemetry/kubernetes-agent): Den Agent installieren, und alles andere, was er erfasst.
- [Metriken-Überwachung](/docs/monitor/metrics-monitor): Alarmieren, wenn die Ausgaben ein Budget überschreiten.
- [Kubernetes-Überwachung](/docs/monitor/kubernetes-monitor): Auch beim Zustand des Clusters alarmieren.
:::
