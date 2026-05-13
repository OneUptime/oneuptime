# Installare l'Agente Kubernetes

L'agente Kubernetes di OneUptime raccoglie metriche, eventi e log dei pod dal proprio cluster Kubernetes e li invia a OneUptime. È distribuito come chart Helm.

## Avvio Rapido

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update

helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<VOSTRA_API_KEY> \
  --set clusterName=<NOME_UNIVOCO_PER_QUESTO_CLUSTER>
```

Il proprio cluster apparirà in OneUptime entro pochi minuti.

## Scegliere il Preset Giusto per il Proprio Cluster

Le diverse distribuzioni Kubernetes hanno vincoli diversi — in particolare, se i workload possono montare volumi `hostPath`. Anziché obbligare a leggere la documentazione sulla sicurezza, il chart espone una singola opzione di primo livello: `preset`.

| Preset | Utilizzare per | Raccolta log | Note |
| --- | --- | --- | --- |
| `standard` (predefinito) | Self-managed, **EKS su EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet che legge `/var/log/pods` tramite hostPath | Overhead minimo. hostPath è disponibile su queste piattaforme. |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API tailer (Deployment) | hostPath è bloccato su Autopilot. Imposta un contesto di sicurezza rafforzato che supera i Pod Security Standards di Autopilot. |
| `eks-fargate` | **EKS Fargate** | Kubernetes API tailer (Deployment) | Come `gke-autopilot`. Fargate blocca hostPath e i DaemonSet. |

Se non si è sicuri, lasciare `preset` non impostato — si otterranno i valori predefiniti `standard`. Se il cluster rifiuta l'installazione con un errore di policy di sicurezza Pod che menziona `hostPath`, passare a `gke-autopilot` (o `eks-fargate` su EKS Fargate) e reinstallare.

### Esempi

**GKE Standard, EKS su EC2, self-managed o AKS:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<VOSTRA_API_KEY> \
  --set clusterName=prod
```

**GKE Autopilot:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<VOSTRA_API_KEY> \
  --set clusterName=prod-gke-autopilot \
  --set preset=gke-autopilot
```

**EKS Fargate:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<VOSTRA_API_KEY> \
  --set clusterName=prod-eks-fargate \
  --set preset=eks-fargate
```

## Differenze tra le Due Modalità di Raccolta Log

Internamente, `preset` imposta `logs.mode` — e si può anche impostare direttamente se si vuole sovrascrivere il preset predefinito.

### Modalità DaemonSet (`logs.mode: daemonset`)

Un DaemonSet esegue un pod OpenTelemetry Collector per ogni nodo. Legge i file di log in `/var/log/pods/` tramite un volume hostPath e li invia via OTLP.

- **Pro:** overhead minimo, scala linearmente con i nodi, nessun carico sul server API Kubernetes, gestisce la rotazione dei log.
- **Contro:** richiede hostPath, richiede la possibilità di pianificare DaemonSet — entrambi non disponibili su GKE Autopilot ed EKS Fargate.

### Modalità API (`logs.mode: api`)

Un Deployment a singola replica (l'immagine `oneuptime/kubernetes-log-tailer`) usa l'API Kubernetes per lo streaming dei log dei container — lo stesso endpoint usato da `kubectl logs -f`. Nessun hostPath, nessun accesso all'host, nessun DaemonSet.

- **Pro:** funziona su GKE Autopilot, EKS Fargate e qualsiasi cluster che blocca hostPath o applica il Pod Security Standard `restricted`.
- **Contro:** ogni stream di container è una connessione di lunga durata verso `kube-apiserver`. In pratica, una singola replica gestisce comodamente alcune migliaia di container. Per cluster molto grandi, suddividere per namespace usando `logs.api.replicas` e `namespaceFilters.include` su ciascuna replica.

### Quale Usare?

Se hostPath funziona, usare DaemonSet. In tutti gli altri casi, usare la modalità API. L'impostazione `preset` sceglie quella giusta automaticamente.

È anche possibile disabilitare completamente la raccolta dei log con `--set logs.enabled=false` e inviare i log dell'applicazione tramite SDK OpenTelemetry. Vedere la documentazione [OpenTelemetry](/docs/telemetry/open-telemetry).

## Opzioni Comuni

| Opzione | Predefinito | Descrizione |
| --- | --- | --- |
| `preset` | (vuoto — trattato come `standard`) | Vedere la tabella sopra. |
| `oneuptime.url` | *(obbligatorio)* | URL della propria istanza OneUptime. |
| `oneuptime.apiKey` | *(obbligatorio)* | Chiave API del progetto (Impostazioni → Chiavi API). |
| `clusterName` | *(obbligatorio)* | Nome univoco per questo cluster. Aggiunto come `k8s.cluster.name` su ogni record. |
| `namespaceFilters.include` | `[]` | Se impostato, vengono monitorati solo questi namespace. |
| `namespaceFilters.exclude` | `["kube-system"]` | Namespace da escludere. |
| `logs.enabled` | `true` | Attiva o disattiva la raccolta dei log. |
| `logs.mode` | (derivato da `preset`) | `daemonset`, `api` o `disabled`. Sovrascrive il preset. |
| `logs.api.replicas` | `1` | Numero di repliche del Deployment log-tailer (solo in modalità API). |
| `controlPlane.enabled` | `false` | Raccogliere dati da etcd / api-server / scheduler / controller-manager. Solo per cluster self-managed — le offerte gestite (EKS/GKE/AKS) tipicamente non espongono questi endpoint. |

Vedere il file [`values.yaml` del chart](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) per l'elenco completo.

## Aggiornamento

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` mantiene la configurazione esistente; aggiungere eventuali nuovi override `--set` in cima.

## Disinstallazione

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Risoluzione dei Problemi

### L'installazione fallisce con "hostPath volumes are not allowed"

Il cluster blocca hostPath. Passare a un preset in modalità API:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # o eks-fargate
```

### Nessun log appare in OneUptime

Controllare i pod dell'agente:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

In modalità API, il pod log-tailer espone `/healthz` sulla porta 13133 — raggiungerlo tramite `kubectl port-forward` per uno snapshot dello stato di esportazione.

### Il cluster ha troppi pod per una singola replica log-tailer (solo modalità API)

Scalare orizzontalmente suddividendo per namespace. Distribuire una volta per ogni gruppo di namespace:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

In alternativa, aumentare `logs.api.replicas` — ma si noti che ogni replica elabora tutti i namespace consentiti, quindi per la deduplicazione è comunque necessaria la suddivisione per namespace.
