# Installera Kubernetes-agenten

OneUptime Kubernetes-agenten samlar in klustermätvärden, händelser och pod-loggar från ditt Kubernetes-kluster och skickar dem till OneUptime. Den distribueras som ett Helm-diagram.

## Snabbstart

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

Ditt kluster visas i OneUptime inom några minuter.

## Välj rätt förinställning för ditt kluster

Olika Kubernetes-distributioner har olika begränsningar – framförallt om arbetsbelastningar kan montera `hostPath`-volymer. Istället för att du behöver läsa säkerhetsdokumentation, exponerar diagrammet ett enda alternativ på toppnivå: `preset`.

| Förinställning | Används för | Loggsamling | Noteringar |
| --- | --- | --- | --- |
| `standard` (standard) | Egeninstallerad, **EKS på EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet läser `/var/log/pods` via hostPath | Lägst overhead. hostPath är tillgängligt på dessa plattformar. |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API-loggare (Deployment) | hostPath blockeras på Autopilot. Anger ett härdad säkerhetskontext som klarar Autopilots Pod Security Standards. |
| `eks-fargate` | **EKS Fargate** | Kubernetes API-loggare (Deployment) | Samma som `gke-autopilot`. Fargate blockerar hostPath och DaemonSets. |

Om du är osäker, lämna `preset` oångett – du får `standard`-standarder. Om ditt kluster avvisar installationen med ett Pod Security-policyfel som nämner `hostPath`, byt till `gke-autopilot` (eller `eks-fargate` på EKS Fargate) och installera om.

### Exempel

**GKE Standard, EKS på EC2, egeninstallerad eller AKS:**

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

## Hur de två loggsamlingslägen skiljer sig åt

Under huven anger `preset` `logs.mode` – och du kan också ange det direkt om du behöver åsidosätta förinställningsstandarden.

### DaemonSet-läge (`logs.mode: daemonset`)

En DaemonSet kör en OpenTelemetry Collector-pod per nod. Den läser loggfiler under `/var/log/pods/` via en hostPath-volym och vidarebefordrar dem via OTLP.

- **Fördelar:** Lägst overhead, skalas linjärt med noder, ingen belastning på Kubernetes API-servern, hanterar loggrotation.
- **Nackdelar:** Kräver hostPath, kräver förmågan att schemalägga DaemonSets – båda otillgängliga på GKE Autopilot och EKS Fargate.

### API-läge (`logs.mode: api`)

En Deployment med en replik (bilden `oneuptime/kubernetes-log-tailer`) använder Kubernetes API för att strömma containerloggar – samma slutpunkt som `kubectl logs -f` använder. Ingen hostPath, ingen värdåtkomst, ingen DaemonSet.

- **Fördelar:** Fungerar på GKE Autopilot, EKS Fargate och alla kluster som blockerar hostPath eller tillämpar `restricted` Pod Security Standard.
- **Nackdelar:** Varje containerström är en långlivad anslutning till `kube-apiserver`. I praktiken hanterar en replik ett par tusen containers bekvämt. För mycket stora kluster, dela upp efter namnrymd med `logs.api.replicas` plus `namespaceFilters.include` på varje replik.

### Vilket bör du använda?

Om hostPath fungerar, använd DaemonSet. Överallt annars, använd API-läge. Inställningen `preset` väljer rätt för dig.

Du kan också inaktivera loggsamling helt med `--set logs.enabled=false` och skicka applikationsloggar via OpenTelemetry SDK:er istället. Se [OpenTelemetry](/docs/telemetry/open-telemetry)-dokumentationen.

## Vanliga alternativ

| Alternativ | Standard | Beskrivning |
| --- | --- | --- |
| `preset` | (tomt – behandlas som `standard`) | Se tabellen ovan. |
| `oneuptime.url` | *(obligatorisk)* | URL:en till din OneUptime-instans. |
| `oneuptime.apiKey` | *(obligatorisk)* | Projekt-API-nyckel (Inställningar → API-nycklar). |
| `clusterName` | *(obligatorisk)* | Unikt namn för detta kluster. Stämplas som `k8s.cluster.name` på varje post. |
| `namespaceFilters.include` | `[]` | Om angivet, övervakas bara dessa namnrymder. |
| `namespaceFilters.exclude` | `["kube-system"]` | Namnrymder att hoppa över. |
| `logs.enabled` | `true` | Aktivera eller inaktivera loggsamling. |
| `logs.mode` | (härleds från `preset`) | `daemonset`, `api` eller `disabled`. Åsidosätter förinställningen. |
| `logs.api.replicas` | `1` | Antal replikat för log-tailer Deployment (endast i API-läge). |
| `controlPlane.enabled` | `false` | Skrapa etcd / api-server / scheduler / controller-manager. Endast egeninstallerade kluster – hanterade erbjudanden (EKS/GKE/AKS) exponerar vanligtvis inte dessa slutpunkter. |

Se [diagrammets `values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) för den fullständiga listan.

## Uppgradering

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` behåller din befintliga konfiguration; lägg till nya `--set`-åsidosättningar ovanpå det.

## Avinstallation

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Felsökning

### Installationen misslyckas med "hostPath volumes are not allowed"

Ditt kluster blockerar hostPath. Byt till en förinställning i API-läge:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### Inga loggar visas i OneUptime

Kontrollera agentpodarna:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

I API-läge exponerar log-tailer-poden `/healthz` på port 13133 – nå den via `kubectl port-forward` för en ögonblicksbild av exportstatus.

### Mitt kluster har för många podar för en log-tailer-replik (endast API-läge)

Skala horisontellt genom att dela upp namnrymder. Distribuera en gång per namnrymdsgrupp:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Alternativt, öka `logs.api.replicas` – men observera att varje replik bearbetar alla tillåtna namnrymder, så för deduplicering behöver du fortfarande namnrymdsdelning.
