# Kubernetes-Monitor

Die Kubernetes-Überwachung ermöglicht Ihnen, die Gesundheit und Performance Ihrer Kubernetes-Cluster zu überwachen, einschließlich Nodes, Pods, Workloads und Komponenten der Control Plane. OneUptime erfasst Metriken aus Ihrem Cluster und wertet sie anhand Ihrer konfigurierten Kriterien aus.

## Überblick

Kubernetes-Monitore verwenden Metriken aus Ihrem Cluster, um tiefe Einblicke in Ihre Infrastruktur zu liefern. Dies ermöglicht Ihnen:

- Cluster-, Namespace-, Workload-, Node- und Pod-Gesundheit überwachen
- CPU-, Speicher-, Festplatten- und Netzwerknutzung über Ressourcen hinweg verfolgen
- Pod-Abstürze, Neustarts und Scheduling-Fehler erkennen
- Verfügbarkeit von Deployment-Repliken überwachen
- Bei Problemen der Control Plane alarmieren (etcd, API-Server, Scheduler)
- Resource Requests und Limits verfolgen

## Einen Kubernetes-Monitor erstellen

1. Gehen Sie zu **Monitors** im OneUptime-Dashboard
2. Klicken Sie auf **Create Monitor**
3. Wählen Sie **Kubernetes** als Monitortyp aus
4. Wählen Sie den Cluster und den zu überwachenden Ressourcen-Scope aus
5. Konfigurieren Sie Ressourcenfilter und Metrik-Abfragen
6. Konfigurieren Sie die Überwachungskriterien nach Bedarf

## Konfigurationsoptionen

### Cluster

Wählen Sie den zu überwachenden Kubernetes-Cluster aus. Cluster müssen über OpenTelemetry mit OneUptime integriert sein.

### Ressourcen-Scope

Wählen Sie die Ebene, auf der Ressourcen überwacht werden sollen:

| Scope | Beschreibung |
|-------|-------------|
| Cluster | Den gesamten Cluster überwachen |
| Namespace | Ressourcen innerhalb eines bestimmten Namespace überwachen |
| Workload | Ein bestimmtes Deployment, StatefulSet, DaemonSet, Job oder CronJob überwachen |
| Node | Einen bestimmten Cluster-Node überwachen |
| Pod | Einen bestimmten Pod überwachen |

### Ressourcenfilter

Schränken Sie den Scope mit optionalen Filtern ein:

| Filter | Beschreibung | Anwendbare Scopes |
|--------|-------------|-------------------|
| Namespace | Kubernetes-Namespace | Namespace, Workload, Pod |
| Workload-Typ | deployment, statefulset, daemonset, job, cronjob | Workload |
| Workload-Name | Name des Workloads | Workload |
| Node-Name | Name des Nodes | Node |
| Pod-Name | Name des Pods | Pod |

### Metrik-Abfragen

Konfigurieren Sie eine oder mehrere auszuwertende Metrik-Abfragen. Jede Abfrage spezifiziert:

- **Metrik-Name** — Die abzufragende Kubernetes-Metrik
- **Aggregation** — Wie die Metrikwerte aggregiert werden
- **Filter** — Zusätzliche attributbasierte Filterung

Sie können auch **Formeln** erstellen, die mehrere Metrik-Abfragen mithilfe mathematischer Ausdrücke kombinieren.

### Rollierendes Zeitfenster

Wählen Sie das Zeitfenster für die Metrik-Auswertung:

- Letzte 1 Minute
- Letzte 5 Minuten
- Letzte 10 Minuten
- Letzte 15 Minuten
- Letzte 30 Minuten
- Letzte 60 Minuten

## Häufige Kubernetes-Metriken

### Pod-Metriken

| Metrik | Beschreibung |
|--------|-------------|
| Pod CPU Usage | CPU-Verbrauch durch Pods |
| Pod Memory Usage | Speicherverbrauch durch Pods |
| Pod Filesystem Usage | Festplattennutzung durch Pods |
| Pod Network Receive/Transmit | Netzwerkverkehr |
| Pod Phase | Aktuelle Pod-Phase (Running, Pending, Failed usw.) |

### Node-Metriken

| Metrik | Beschreibung |
|--------|-------------|
| Node CPU Usage | CPU-Auslastung pro Node |
| Node Memory Usage | Speicherauslastung pro Node |
| Node Filesystem Usage | Festplattennutzung pro Node |
| Node Disk I/O | Lese-/Schreib-Operationen |
| Node Ready Condition | Ob der Node bereit ist |

### Container-Metriken

| Metrik | Beschreibung |
|--------|-------------|
| Container Restarts | Anzahl der Container-Neustarts |
| Container CPU/Memory Limits | Ressourcen-Limits |
| Container CPU/Memory Requests | Ressourcen-Requests |
| Container Ready Status | Ob Container bereit sind |

### Workload-Metriken

| Metrik | Beschreibung |
|--------|-------------|
| Deployment Available/Unavailable Replicas | Anzahl der Repliken |
| DaemonSet Misscheduled Nodes | Scheduling-Probleme |
| StatefulSet Ready Replicas | Anzahl bereiter Repliken |
| Job Active/Failed/Succeeded Pods | Job-Status |

## Überwachungskriterien

### Verfügbare Check-Typen

| Check-Typ | Beschreibung |
|------------|-------------|
| Metric Value | Der Wert der konfigurierten Metrik-Abfrage oder Formel |

### Aggregationstypen

| Aggregation | Beschreibung |
|-------------|-------------|
| Average | Durchschnittswert über das Zeitfenster |
| Sum | Summe aller Werte |
| Maximum Value | Höchster Wert im Zeitfenster |
| Minimum Value | Niedrigster Wert im Zeitfenster |
| All Values | Alle Werte müssen die Kriterien erfüllen |
| Any Value | Mindestens ein Wert muss übereinstimmen |

### Filtertypen

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Vorgefertigte Alarm-Templates

OneUptime stellt Templates für gängige Kubernetes-Überwachungsszenarien bereit:

| Template | Beschreibung | Schwellenwert |
|----------|-------------|-----------|
| CrashLoopBackOff Detection | Anzahl der Container-Neustarts | > 5 Neustarts |
| Pod Stuck in Pending | Pods in der Phase Pending | > 0 Pods |
| Node Not Ready | Node-Bereitschaftszustand | = 0 (nicht bereit) |
| High Node CPU | Node-CPU-Auslastung | > 90% |
| High Node Memory | Node-Speicherauslastung | > 85% |
| Deployment Replica Mismatch | Nicht verfügbare Repliken | > 0 Repliken |
| Job Failures | Fehlgeschlagene Pods in einem Job | > 0 Fehler |
| etcd No Leader | Fehlender etcd-Cluster-Leader | = 0 (kein Leader) |
| API Server Throttling | Verworfene API-Anfragen | > 0 Anfragen |
| Scheduler Backlog | Ausstehende Pods im Scheduler | > 0 Pods |
| High Node Disk Usage | Node-Dateisystem-Nutzung | > 90% |
| DaemonSet Unavailable | Falsch geplante Nodes | > 0 Nodes |

## Einrichtungsvoraussetzungen

Um die Kubernetes-Überwachung zu nutzen, müssen Sie den OneUptime-Kubernetes-Agent in Ihrem Cluster installieren. Der Agent sendet Cluster-Metriken, Events, Pod-Logs und — standardmäßig — **Anwendungs-Traces und HTTP-RED-Metriken, erfasst via eBPF** an OneUptime über OTLP. Es sind keine Codeänderungen oder App-spezifischen SDKs erforderlich, um Service-Level-Datenverkehr zu sehen.

Siehe die Anleitung [Kubernetes-Agent installieren](/docs/monitor/kubernetes-agent) — sie behandelt die Ein-Befehl-Helm-Installation, die `preset`-Option für die Auswahl der richtigen Konfiguration für Ihren Cluster (standard, GKE Autopilot, EKS Fargate) und die `ebpf.features.*`-Schalter für die einzelnen Signalfamilien (HTTP-RED-Metriken, Service-Graph, Netzwerk-Flows, TCP-Statistiken).
