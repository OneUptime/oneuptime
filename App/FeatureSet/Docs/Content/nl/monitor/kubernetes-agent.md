# De Kubernetes Agent installeren

De OneUptime Kubernetes-agent verzamelt cluster-metrics, events en pod-logboeken van uw Kubernetes-cluster en stuurt ze naar OneUptime. Hij wordt gedistribueerd als een Helm-chart.

## Snel starten

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

Uw cluster verschijnt binnen enkele minuten in OneUptime.

## Kies de juiste preset voor uw cluster

Verschillende Kubernetes-distributies hebben verschillende beperkingen — met name of workloads `hostPath`-volumes kunnen koppelen. In plaats van u beveiligingsdocumentatie te laten lezen, biedt de chart één optie op het hoogste niveau: `preset`.

| Preset | Gebruik voor | Logboekverzameling | Opmerkingen |
| --- | --- | --- | --- |
| `standard` (standaard) | Zelf-beheerd, **EKS op EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet leest `/var/log/pods` via hostPath | Laagste overhead. hostPath is beschikbaar op deze platformen. |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API-tailer (Deployment) | hostPath is geblokkeerd op Autopilot. Stelt een geharde beveiligingscontext in die voldoet aan de Pod Security Standards van Autopilot. |
| `eks-fargate` | **EKS Fargate** | Kubernetes API-tailer (Deployment) | Hetzelfde als `gke-autopilot`. Fargate blokkeert hostPath en DaemonSets. |

Als u het niet zeker weet, laat `preset` dan ongewijzigd — u krijgt de `standard`-standaarden. Als uw cluster de installatie weigert met een Pod Security-beleidsfout met vermelding van `hostPath`, schakel dan over naar `gke-autopilot` (of `eks-fargate` op EKS Fargate) en installeer opnieuw.

### Voorbeelden

**GKE Standard, EKS op EC2, zelf-beheerd of AKS:**

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

## Hoe de twee logboekverz amelingsmodi verschillen

Achter de schermen stelt `preset` `logs.mode` in — en u kunt dat ook rechtstreeks instellen als u de preset-standaard wilt overschrijven.

### DaemonSet-modus (`logs.mode: daemonset`)

Een DaemonSet draait één OpenTelemetry Collector-pod per node. Het volgt logbestanden onder `/var/log/pods/` via een hostPath-volume en stuurt ze door via OTLP.

- **Voordelen:** Laagste overhead, schaalt lineair met nodes, geen belasting op de Kubernetes API-server, verwerkt logrotatie.
- **Nadelen:** Vereist hostPath, vereist de mogelijkheid om DaemonSets te plannen — beide niet beschikbaar op GKE Autopilot en EKS Fargate.

### API-modus (`logs.mode: api`)

Een Deployment met één replica (de `oneuptime/kubernetes-log-tailer`-image) gebruikt de Kubernetes API om containerlogboeken te streamen — hetzelfde eindpunt dat `kubectl logs -f` gebruikt. Geen hostPath, geen hosttoegang, geen DaemonSet.

- **Voordelen:** Werkt op GKE Autopilot, EKS Fargate en elk cluster dat hostPath blokkeert of de `restricted` Pod Security Standard hanteert.
- **Nadelen:** Elke containerstroom is een langlevende verbinding naar `kube-apiserver`. In de praktijk verwerkt één replica comfortabel een paar duizend containers. Voor zeer grote clusters, verdeel per namespace met `logs.api.replicas` en `namespaceFilters.include` op elke replica.

### Welke moet u gebruiken?

Als hostPath werkt, gebruik DaemonSet. Overal anders, gebruik API-modus. De `preset`-instelling kiest de juiste modus voor u.

U kunt logboekverzameling ook volledig uitschakelen met `--set logs.enabled=false` en in plaats daarvan applicatielogboeken via OpenTelemetry SDK's versturen. Zie de [OpenTelemetry](/docs/telemetry/open-telemetry)-documenten.

## Veelgebruikte opties

| Optie | Standaard | Beschrijving |
| --- | --- | --- |
| `preset` | (leeg — behandeld als `standard`) | Zie de tabel hierboven. |
| `oneuptime.url` | *(vereist)* | URL van uw OneUptime-instantie. |
| `oneuptime.apiKey` | *(vereist)* | Project-API-sleutel (Instellingen → API-sleutels). |
| `clusterName` | *(vereist)* | Unieke naam voor dit cluster. Wordt als `k8s.cluster.name` gestempeld op elk record. |
| `namespaceFilters.include` | `[]` | Indien ingesteld, worden alleen deze namespaces bewaakt. |
| `namespaceFilters.exclude` | `["kube-system"]` | Te overslaan namespaces. |
| `logs.enabled` | `true` | Logboekverzameling in- of uitschakelen. |
| `logs.mode` | (afgeleid van `preset`) | `daemonset`, `api` of `disabled`. Overschrijft de preset. |
| `logs.api.replicas` | `1` | Aantal log-tailer Deployment-replica's (alleen in API-modus). |
| `controlPlane.enabled` | `false` | etcd/api-server/scheduler/controller-manager scrapen. Alleen voor zelf-beheerde clusters — beheerde aanbiedingen (EKS/GKE/AKS) stellen deze eindpunten doorgaans niet bloot. |

Zie de [`values.yaml` van de chart](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) voor de volledige lijst.

## Upgraden

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` behoudt uw bestaande configuratie; geef eventuele nieuwe `--set`-overschrijvingen erbovenop door.

## Verwijderen

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Probleemoplossing

### De installatie mislukt met "hostPath volumes are not allowed"

Uw cluster blokkeert hostPath. Schakel over naar een API-modus preset:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # of eks-fargate
```

### Geen logboeken verschijnen in OneUptime

Controleer de agent-pods:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

In API-modus stelt de log-tailer-pod `/healthz` beschikbaar op poort 13133 — bereik het via `kubectl port-forward` voor een momentopname van de exportstatus.

### Mijn cluster heeft te veel pods voor één log-tailer replica (alleen API-modus)

Schaal horizontaal door namespaces te verdelen. Implementeer eenmaal per namespacegroep:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Als alternatief kunt u `logs.api.replicas` verhogen — maar houd er rekening mee dat elke replica alle toegestane namespaces verwerkt, dus voor deduplicatie heeft u nog steeds namespace-verdeling nodig.
