# Installer Kubernetes Agent

OneUptime Kubernetes-agenten indsamler klyngemetrikker, hændelser og pod-logs fra din Kubernetes-klynge og sender dem til OneUptime. Den distribueres som et Helm-chart.

## Hurtig start

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

Din klynge vises i OneUptime inden for få minutter.

## Vælg den rigtige forudindstilling til din klynge

Forskellige Kubernetes-distributioner har forskellige begrænsninger – mest bemærkelsesværdigt, om arbejdsbelastninger kan montere `hostPath`-volumes. I stedet for at tvinge dig til at læse sikkerhedsdokumentation eksponerer chartet en enkelt indstilling på øverste niveau: `preset`.

| Forudindstilling | Brug til | Log-indsamling | Noter |
| --- | --- | --- | --- |
| `standard` (standard) | Selvadministreret, **EKS på EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet læser `/var/log/pods` via hostPath | Lavest overhead. hostPath er tilgængeligt på disse platforme. |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API-tailing (Deployment) | hostPath er blokeret på Autopilot. Sætter en hærdet sikkerhedskontekst, der består Autopilots Pod Security Standards. |
| `eks-fargate` | **EKS Fargate** | Kubernetes API-tailing (Deployment) | Samme som `gke-autopilot`. Fargate blokerer hostPath og DaemonSets. |

Hvis du er i tvivl, så lad `preset` stå uindstillet – du får `standard`-standarder. Hvis din klynge afviser installationen med en Pod Security-politikfejl, der nævner `hostPath`, skal du skifte til `gke-autopilot` (eller `eks-fargate` på EKS Fargate) og geninstallere.

### Eksempler

**GKE Standard, EKS på EC2, selvadministreret eller AKS:**

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

## Sådan adskiller de to log-indsamlingstilstande sig

Under motorhjelmen sætter `preset` `logs.mode` – og du kan også sætte det direkte, hvis du har behov for at tilsidesætte forudindstillingens standard.

### DaemonSet-tilstand (`logs.mode: daemonset`)

En DaemonSet kører én OpenTelemetry Collector-pod pr. node. Den skraber log-filer under `/var/log/pods/` via et hostPath-volume og videresender dem over OTLP.

- **Fordele:** Lavest overhead, skalerer lineært med noder, ingen belastning på Kubernetes API-serveren, håndterer log-rotation.
- **Ulemper:** Kræver hostPath, kræver evnen til at planlægge DaemonSets – begge utilgængelige på GKE Autopilot og EKS Fargate.

### API-tilstand (`logs.mode: api`)

En enkelt-replika-Deployment (`oneuptime/kubernetes-log-tailer`-billede) bruger Kubernetes API til at streame container-logs – det samme endpoint som `kubectl logs -f` bruger. Ingen hostPath, ingen host-adgang, ingen DaemonSet.

- **Fordele:** Fungerer på GKE Autopilot, EKS Fargate og enhver klynge, der blokerer hostPath eller håndhæver `restricted` Pod Security Standard.
- **Ulemper:** Hver containerstrøm er en langvarig forbindelse til `kube-apiserver`. I praksis håndterer én replika et par tusinde containere komfortabelt. For meget store klynger skal du opdele efter namespace ved hjælp af `logs.api.replicas` plus `namespaceFilters.include` på hver replika.

### Hvilken skal du bruge?

Hvis hostPath fungerer, brug DaemonSet. Alle andre steder brug API-tilstand. `preset`-indstillingen vælger den rigtige for dig.

Du kan også deaktivere log-indsamling fuldstændigt med `--set logs.enabled=false` og sende applikationslogs via OpenTelemetry SDK'er i stedet. Se [OpenTelemetry](/docs/telemetry/open-telemetry)-dokumentationen.

## Almindelige indstillinger

| Indstilling | Standard | Beskrivelse |
| --- | --- | --- |
| `preset` | (tom – behandles som `standard`) | Se tabellen ovenfor. |
| `oneuptime.url` | *(påkrævet)* | URL til din OneUptime-instans. |
| `oneuptime.apiKey` | *(påkrævet)* | Projekt-API-nøgle (Indstillinger → API-nøgler). |
| `clusterName` | *(påkrævet)* | Unikt navn til denne klynge. Stemplet som `k8s.cluster.name` på alle poster. |
| `namespaceFilters.include` | `[]` | Hvis indstillet, overvåges kun disse namespaces. |
| `namespaceFilters.exclude` | `["kube-system"]` | Namespaces der springes over. |
| `logs.enabled` | `true` | Slå log-indsamling til eller fra. |
| `logs.mode` | (afledt af `preset`) | `daemonset`, `api` eller `disabled`. Tilsidesætter forudindstillingen. |
| `logs.api.replicas` | `1` | Antal log-tailer Deployment-replikaer (kun i API-tilstand). |
| `controlPlane.enabled` | `false` | Skrab etcd/api-server/scheduler/controller-manager. Kun selvadministrerede klynger – administrerede tilbud (EKS/GKE/AKS) eksponerer typisk ikke disse endpoints. |

Se [chartets `values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) for den fulde liste.

## Opgradering

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` beholder din eksisterende konfiguration; angiv eventuelle nye `--set`-tilsidesættelser oven på den.

## Afinstallation

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Fejlfinding

### Installationen mislykkes med "hostPath volumes are not allowed"

Din klynge blokerer hostPath. Skift til en API-tilstand-forudindstilling:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # eller eks-fargate
```

### Ingen logs vises i OneUptime

Kontroller agent-pods:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

I API-tilstand eksponerer log-tailer-pod'en `/healthz` på port 13133 – adgang til den via `kubectl port-forward` for et eksportstatussnapshot.

### Min klynge har for mange pods til én log-tailer-replika (kun API-tilstand)

Skaler horisontalt ved at opdele namespaces. Deploy én gang pr. namespace-gruppe:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Alternativt kan du øge `logs.api.replicas` – men bemærk, at hver replika behandler alle tilladte namespaces, så du stadig har brug for namespace-opdeling for deduplicering.
