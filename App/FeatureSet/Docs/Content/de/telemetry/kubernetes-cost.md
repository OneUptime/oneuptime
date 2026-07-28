# Kubernetes-Kosten-Observability

## Überblick

OneUptime kann Ihnen zeigen, was jeder Kubernetes-Workload tatsächlich kostet — Ausgaben pro Namespace, pro Controller und pro Pod, mit ungenutzter Kapazität und Request-vs-Nutzung-Effizienz — direkt neben den Metriken, Logs und Traces, die Sie bereits mit dem [Kubernetes Agent](/docs/telemetry/kubernetes-agent) erfassen.

Die Aktivierung ist ein einziger Befehl:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true
```

Das ist eine vollständige Installation. Das Chart bündelt die Open-Source-Engine [OpenCost](https://opencost.io) (Apache-2.0, CNCF — das [cost-model](https://github.com/kubecost/cost-model), das auch Kubecost antreibt) sowie ein minimales, dediziertes Prometheus, das sie für den Nutzungsverlauf benötigt — zwei kleine Pods unsichtbarer Infrastruktur. OpenCost bepreist Ihre Nodes, Volumes und Load Balancer **automatisch anhand der öffentlichen Listenpreise Ihres Cloud-Anbieters, ohne Zugangsdaten** (AWS, GCP, Azure); On-Prem-Cluster hinterlegen stattdessen eine Preistabelle (siehe unten).

Innerhalb von etwa einer Stunde (dem ersten abgeschlossenen Stundenfenster) erhalten Sie:

- Eine **Costs-Seite pro Cluster** (_Kubernetes → Ihr Cluster → Costs_): Ausgabentrend, Ausgaben pro Namespace mit CPU-/Memory-/Storage-Aufteilung, Ausgaben pro Workload, ungenutzte Ausgaben und Effizienz.
- Eine **Costs-Seite auf Projektebene** (_Kubernetes → Costs_): Ausgaben über alle Cluster des Projekts hinweg.
- Eine **Kubernetes-Cost-Dashboard-Vorlage** (_Dashboards → Create → Kubernetes Cost Dashboard_): Trends der stündlichen Node-Kosten, CPU-/RAM-Einheitskosten, Ausgaben für Persistent Volumes und Load Balancer.
- Rohe Kostenmetriken (`node_total_hourly_cost`, `pv_hourly_cost`, ...) im **Metric Explorer**, nutzbar in eigenen Dashboards und Metrik-Alarmen.

## Funktionsweise

Mit `cost.enabled=true` führt das Chart vier Dinge aus:

1. **OpenCost** (gebündelt) — beobachtet das Cluster, ermittelt die Cloud-Listenpreise und berechnet vorbepreiste Kostenzuordnungen pro Workload.
2. **Ein minimales Prometheus** (gebündelt) — OpenCost benötigt einen PromQL-Endpunkt für den Nutzungs-/Preisverlauf. Dieses existiert ausschließlich dafür: eine einzige Replik, 3 Tage Aufbewahrung und genau zwei Scrape-Ziele (cAdvisor über den Node-Proxy des API-Servers und OpenCost selbst — OpenCost gibt eigene KSM-artige Resource-Request-Metriken aus, sodass kube-state-metrics nicht beteiligt ist). Es wird niemals außerhalb des Clusters exponiert, und seine Daten verlassen das Cluster nie.
3. **Der Kostenzuordnungs-Poller** (`cost.agent`) — fragt die Allocation-API von OpenCost einmal pro abgeschlossenem Stundenfenster ab und sendet Kostenzeilen pro Workload (CPU / RAM / GPU / PV / Netzwerk / Load Balancer / Idle, plus Effizienz) per POST an OneUptime. Fenster werden genau einmal geliefert — der Server überspringt Fenster, die er bereits aufgenommen hat, sodass Neustarts Ausgaben nicht doppelt zählen können.
4. **Ein Kostenmetriken-Scrape** (`cost.metrics`) — der OpenTelemetry-Collector des Agents scrapt die Prometheus-Metriken von OpenCost (per Allowlist auf die Kostenreihen beschränkt) über dieselbe OTLP-Pipeline wie der Rest Ihrer Cluster-Metriken.

## Läuft bereits Kubecost oder OpenCost?

Richten Sie das Chart stattdessen auf Ihre bestehende Engine — dann wird nichts gebündelt:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true \
  --set cost.engine.url=http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090
```

| Engine   | Typische Service-URL                                             |
| -------- | ---------------------------------------------------------------- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003`                |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090`  |

Der Pfad der Allocation-API wird automatisch erkannt (`/model/allocation` für Kubecost, `/allocation/compute` oder `/allocation` für OpenCost). Setzen Sie `cost.engine.allocationPath` nur bei nicht standardmäßigen Installationen.

## On-Prem- / Bare-Metal-Preise

Cluster, deren Nodes keinen öffentlichen Cloud-Listenpreis haben, können eine Preistabelle hinterlegen — OpenCost bepreist dann jede Ressource anhand dieser Werte. Alle Werte sind **USD pro Ressourcenstunde**:

```yaml
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

## Nützliche Stellschrauben

Alle optional — siehe die `values.yaml` des Charts für die vollständige Liste:

```yaml
cost:
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

## Auf Kosten alarmieren

Die gescrapten Kostenmetriken sind gewöhnliche OneUptime-Metriken, Sie können also wie auf alles andere Metrik-Alarme auf sie setzen — z. B. alarmieren, wenn der Durchschnitt von `node_total_hourly_cost` über einen Budget-Schwellenwert steigt, oder wenn `pv_hourly_cost` für eine Volume-Klasse erscheint, die es in einem Cluster nicht geben sollte.

## Datenmodell & Aufbewahrung

Zuordnungszeilen werden in ClickHouse gespeichert (eine Zeile pro Cluster, Fenster, Namespace, Controller, Pod und Container) und folgen der Telemetrie-Aufbewahrung des Clusters: der Einstellung `retainTelemetryDataForDays` auf der Kubernetes-Cluster-Ressource, mit Rückgriff auf die Datenaufbewahrung des Projekts. Ungenutzte und nicht zugeordnete Kapazität werden als reguläre Zeilen unter den Namespaces `__idle__` / `__unallocated__` gespeichert, sodass sie mit denselben Gruppierungen abfragbar sind wie Workload-Ausgaben.

## Fehlerbehebung

- **Die Costs-Seiten sind leer** — prüfen Sie die Logs des Cost-Agents: `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`. Ein `401` bedeutet, dass der Ingestion-Schlüssel ungültig ist; `cost engine did not answer any known allocation path` bedeutet, dass die Engine noch nicht läuft (das gebündelte OpenCost benötigt nach der Installation ein paar Minuten, um seine ersten Fenster zu bepreisen) oder dass `cost.engine.url` falsch ist.
- **Gebündeltes OpenCost nicht bereit** — `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-opencost`. Es protokolliert, welchen Cloud-Anbieter es erkannt hat und ob Preisdaten geladen wurden.
- **Dashboard-Vorlage zeigt keine Daten** — die Vorlage liest die gescrapten Kostenmetriken; stellen Sie sicher, dass `cost.metrics.enabled` auf `true` steht.
- **Zahlen weichen von der eigenen UI der Engine ab** — OneUptime bezieht die Reconciliation-Anpassungen der Engine in jede Kostenkomponente ein und liefert ganze abgeschlossene Fenster; Teilausgaben der laufenden Stunde erscheinen, nachdem das Fenster geschlossen wurde.
- **Prometheus-Pod wurde neu gestartet** — mit dem Standard-`emptyDir`-Speicher verliert ein Neustart einige Stunden Nutzungsverlauf, sodass Zuordnungen für diese Fenster kleiner ausfallen können. Setzen Sie `cost.prometheus.persistence.enabled=true`, wenn Ihnen das wichtig ist.
