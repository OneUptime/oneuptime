# Kubernetes-Agent installieren

Der OneUptime Kubernetes-Agent erfasst Cluster-Metriken, Events und Pod-Logs aus Ihrem Kubernetes-Cluster und sendet sie an OneUptime. Er wird als Helm-Chart vertrieben.

## Schnellstart

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update

helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<A_UNIQUE_NAME_FOR_THIS_CLUSTER>
```

Ihr Cluster erscheint innerhalb weniger Minuten in OneUptime.

## Das richtige Preset für Ihren Cluster wählen

Verschiedene Kubernetes-Distributionen haben unterschiedliche Einschränkungen – vor allem ob Workloads `hostPath`-Volumes einbinden können. Anstatt Sie Sicherheitsdokumentation lesen zu lassen, stellt das Chart eine einzige übergeordnete Option bereit: `preset`.

| Preset | Verwendung für | Log-Erfassung | Hinweise |
| --- | --- | --- | --- |
| `standard` (Standard) | Self-managed, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet liest `/var/log/pods` via hostPath | Geringster Overhead. hostPath ist auf diesen Plattformen verfügbar. |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API-Tailer (Deployment) | hostPath ist auf Autopilot blockiert. Setzt einen gehärteten Sicherheitskontext, der Autopilots Pod Security Standards erfüllt. |
| `eks-fargate` | **EKS Fargate** | Kubernetes API-Tailer (Deployment) | Gleich wie `gke-autopilot`. Fargate blockiert hostPath und DaemonSets. |

Wenn Sie unsicher sind, lassen Sie `preset` nicht gesetzt — Sie erhalten `standard`-Standardwerte. Wenn Ihr Cluster die Installation mit einem Pod Security Policy-Fehler zu `hostPath` ablehnt, wechseln Sie zu `gke-autopilot` (oder `eks-fargate` auf EKS Fargate) und installieren Sie neu.

### Beispiele

**GKE Standard, EKS on EC2, self-managed oder AKS:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod
```

**GKE Autopilot:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-gke-autopilot \
  --set preset=gke-autopilot
```

**EKS Fargate:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-eks-fargate \
  --set preset=eks-fargate
```

## Unterschiede zwischen den beiden Log-Erfassungsmodi

Im Hintergrund setzt `preset` den Wert `logs.mode` — und Sie können diesen auch direkt setzen, wenn Sie den Preset-Standard überschreiben müssen.

### DaemonSet-Modus (`logs.mode: daemonset`)

Ein DaemonSet führt einen OpenTelemetry Collector-Pod pro Node aus. Er liest Log-Dateien unter `/var/log/pods/` über ein hostPath-Volume und leitet sie über OTLP weiter.

- **Vorteile:** Geringster Overhead, skaliert linear mit Nodes, keine Last auf dem Kubernetes API-Server, handhabt Log-Rotation.
- **Nachteile:** Erfordert hostPath, erfordert die Fähigkeit, DaemonSets zu planen — beides nicht verfügbar auf GKE Autopilot und EKS Fargate.

### API-Modus (`logs.mode: api`)

Ein Single-Replica-Deployment (das Image `oneuptime/kubernetes-log-tailer`) verwendet die Kubernetes API zum Streamen von Container-Logs — denselben Endpunkt, den `kubectl logs -f` verwendet. Kein hostPath, kein Host-Zugriff, kein DaemonSet.

- **Vorteile:** Funktioniert auf GKE Autopilot, EKS Fargate und jedem Cluster, der hostPath blockiert oder den `restricted` Pod Security Standard durchsetzt.
- **Nachteile:** Jeder Container-Stream ist eine langlebige Verbindung zu `kube-apiserver`. In der Praxis handhabt ein Replica einige tausend Container komfortabel.

## Häufige Optionen

| Option | Standard | Beschreibung |
| --- | --- | --- |
| `preset` | (leer — als `standard` behandelt) | Siehe die obige Tabelle. |
| `oneuptime.url` | *(erforderlich)* | URL Ihrer OneUptime-Instanz. |
| `oneuptime.apiKey` | *(erforderlich)* | Projekt-API-Schlüssel (Einstellungen → API-Schlüssel). |
| `clusterName` | *(erforderlich)* | Eindeutiger Name für diesen Cluster. Wird als `k8s.cluster.name` auf jedem Eintrag gestempelt. |
| `namespaceFilters.include` | `[]` | Falls gesetzt, werden nur diese Namespaces überwacht. |
| `namespaceFilters.exclude` | `["kube-system"]` | Zu überspringende Namespaces. |
| `logs.enabled` | `true` | Log-Erfassung ein- oder ausschalten. |
| `logs.mode` | (aus `preset` abgeleitet) | `daemonset`, `api` oder `disabled`. Überschreibt das Preset. |
| `logs.api.replicas` | `1` | Anzahl der Log-Tailer-Deployment-Replicas (nur im API-Modus). |
| `controlPlane.enabled` | `false` | etcd / api-server / scheduler / controller-manager scrapen. Nur für self-managed Cluster — verwaltete Angebote (EKS/GKE/AKS) stellen diese Endpunkte typischerweise nicht bereit. |

## Upgrade

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` behält Ihre vorhandene Konfiguration; übergeben Sie zusätzliche `--set`-Überschreibungen.

## Deinstallation

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Fehlerbehebung

### Die Installation schlägt mit „hostPath volumes are not allowed" fehl

Ihr Cluster blockiert hostPath. Wechseln Sie zu einem API-Modus-Preset:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # oder eks-fargate
```

### Keine Logs in OneUptime

Prüfen Sie die Agent-Pods:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```
