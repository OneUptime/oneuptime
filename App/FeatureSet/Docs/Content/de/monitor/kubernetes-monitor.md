# Kubernetes-Monitor

Der Kubernetes-Monitor ermöglicht die Überwachung der Gesundheit und Leistung Ihrer Kubernetes-Cluster, einschließlich Nodes, Pods, Workloads und Control-Plane-Komponenten. OneUptime erfasst Metriken aus Ihrem Cluster und wertet sie anhand Ihrer konfigurierten Kriterien aus.

## Übersicht

Kubernetes-Monitore verwenden Metriken aus Ihrem Cluster, um tiefe Einblicke in Ihre Infrastruktur zu ermöglichen. Dies erlaubt Ihnen:

- Cluster-, Namespace-, Workload-, Node- und Pod-Gesundheit überwachen
- CPU-, Arbeitsspeicher-, Festplatten- und Netzwerknutzung über Ressourcen verfolgen
- Pod-Abstürze, Neustarts und Planungsfehler erkennen
- Deployment-Replica-Verfügbarkeit überwachen
- Bei Control-Plane-Problemen benachrichtigen (etcd, API-Server, Scheduler)
- Ressourcenanforderungen und -limits verfolgen

## Einen Kubernetes-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Kubernetes** als Monitortyp
4. Wählen Sie den Cluster und den Ressourcenbereich zur Überwachung
5. Konfigurieren Sie Ressourcenfilter und Metrikabfragen
6. Konfigurieren Sie bei Bedarf Überwachungskriterien

## Konfigurationsoptionen

### Cluster

Wählen Sie den zu überwachenden Kubernetes-Cluster. Cluster müssen über OpenTelemetry mit OneUptime integriert werden.

### Ressourcenbereich

Wählen Sie die Ebene, auf der Ressourcen überwacht werden sollen:

| Bereich | Beschreibung |
|-------|-------------|
| Cluster | Den gesamten Cluster überwachen |
| Namespace | Ressourcen innerhalb eines bestimmten Namespaces überwachen |
| Workload | Ein bestimmtes Deployment, StatefulSet, DaemonSet, Job oder CronJob überwachen |
| Node | Einen bestimmten Cluster-Node überwachen |
| Pod | Einen bestimmten Pod überwachen |

### Ressourcenfilter

Den Bereich mit optionalen Filtern eingrenzen:

| Filter | Beschreibung | Anwendbare Bereiche |
|--------|-------------|-------------------|
| Namespace | Kubernetes-Namespace | Namespace, Workload, Pod |
| Workload-Typ | deployment, statefulset, daemonset, job, cronjob | Workload |
| Workload-Name | Name des Workloads | Workload |
| Node-Name | Name des Nodes | Node |
| Pod-Name | Name des Pods | Pod |

## Häufige Kubernetes-Metriken

### Pod-Metriken

| Metrik | Beschreibung |
|--------|-------------|
| Pod-CPU-Auslastung | CPU-Verbrauch durch Pods |
| Pod-Arbeitsspeicher-Auslastung | Arbeitsspeicher-Verbrauch durch Pods |
| Pod-Dateisystem-Auslastung | Festplattennutzung durch Pods |
| Pod-Netzwerk-Empfang/Senden | Netzwerkverkehr |
| Pod-Phase | Aktuelle Pod-Phase (Laufend, Ausstehend, Fehlgeschlagen usw.) |

### Node-Metriken

| Metrik | Beschreibung |
|--------|-------------|
| Node-CPU-Auslastung | CPU-Auslastung pro Node |
| Node-Arbeitsspeicher-Auslastung | Arbeitsspeicher-Auslastung pro Node |
| Node-Dateisystem-Auslastung | Festplattennutzung pro Node |
| Node-Festplatten-I/O | Lese-/Schreibvorgänge |
| Node-Bereit-Zustand | Ob der Node bereit ist |

## Überwachungskriterien

### Verfügbare Prüftypen

| Prüftyp | Beschreibung |
|------------|-------------|
| Metrikwert | Der Wert der konfigurierten Metrikabfrage oder Formel |

## Vorgefertigte Benachrichtigungsvorlagen

OneUptime stellt Vorlagen für häufige Kubernetes-Überwachungsszenarien bereit:

| Vorlage | Beschreibung | Schwellenwert |
|----------|-------------|-----------|
| CrashLoopBackOff-Erkennung | Container-Neustartanzahl | > 5 Neustarts |
| Pod steckt im Ausstehend-Zustand | Pods in der Phase Ausstehend | > 0 Pods |
| Node nicht bereit | Node-Bereit-Zustand | = 0 (nicht bereit) |
| Hohe Node-CPU | Node-CPU-Auslastung | > 90% |
| Hoher Node-Arbeitsspeicher | Node-Arbeitsspeicher-Auslastung | > 85% |
| Deployment-Replica-Mismatch | Nicht verfügbare Replicas | > 0 Replicas |
| Job-Fehler | Fehlgeschlagene Pods in einem Job | > 0 Fehler |
| etcd kein Leader | etcd-Cluster-Leader fehlt | = 0 (kein Leader) |
| API-Server-Drosselung | Verworfene API-Anfragen | > 0 Anfragen |
| Scheduler-Rückstand | Ausstehende Pods im Scheduler | > 0 Pods |
| Hohe Node-Festplattennutzung | Node-Dateisystem-Auslastung | > 90% |
| DaemonSet nicht verfügbar | Falsch geplante Nodes | > 0 Nodes |

## Setup-Anforderungen

Um Kubernetes-Monitoring zu verwenden, müssen Sie den OneUptime Kubernetes-Agent in Ihrem Cluster installieren. Der Agent sendet Cluster-Metriken, Events und Pod-Logs über OTLP an OneUptime.

Weitere Informationen finden Sie in der Anleitung [Kubernetes-Agent installieren](/docs/monitor/kubernetes-agent).
