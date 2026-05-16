# Installere Kubernetes-agenten

OneUptime Kubernetes-agenten samler klyngemetrikker, hendelser og pod-logger fra Kubernetes-klyngen din og sender dem til OneUptime. Den distribueres som et Helm-kart.

## Hurtigstart

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

Klyngen din vil vises i OneUptime innen noen få minutter.

## Velg riktig forhåndsinnstilling for klyngen din

Ulike Kubernetes-distribusjoner har ulike begrensninger – mest merkbart om arbeidsmengder kan montere `hostPath`-volumer. I stedet for å la deg lese sikkerhetsdokumentasjon, eksponerer kartet et enkelt toppnivåalternativ: `preset`.

| Forhåndsinnstilling | Bruk for | Logginnsamling | Merknader |
| --- | --- | --- | --- |
| `standard` (standard) | Selvadministrert, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet som leser `/var/log/pods` via hostPath | Lavest overhead. hostPath er tilgjengelig på disse plattformene. |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API-taler (Deployment) | hostPath er blokkert på Autopilot. Setter en herdet sikkerhetskontekst som passerer Autopilots Pod Security Standards. |
| `eks-fargate` | **EKS Fargate** | Kubernetes API-taler (Deployment) | Samme som `gke-autopilot`. Fargate blokkerer hostPath og DaemonSets. |

Hvis du er usikker, la `preset` stå uten verdi – du får `standard`-standardene. Hvis klyngen avviser installasjonen med en Pod Security policy-feil som nevner `hostPath`, bytt til `gke-autopilot` (eller `eks-fargate` på EKS Fargate) og installer på nytt.

### Eksempler

**GKE Standard, EKS on EC2, selvadministrert, eller AKS:**

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

## Slik skiller de to logginnsamlingsmodusene seg

Under panseret setter `preset` `logs.mode` – og du kan også sette det direkte hvis du trenger å overstyre forhåndsinnstillingens standard.

### DaemonSet-modus (`logs.mode: daemonset`)

En DaemonSet kjører én OpenTelemetry Collector-pod per node. Den haler loggfiler under `/var/log/pods/` via et hostPath-volum og videresender dem over OTLP.

- **Fordeler:** lavest overhead, skalerer lineært med noder, ingen belastning på Kubernetes API-serveren, håndterer loggrotasjon.
- **Ulemper:** krever hostPath, krever muligheten til å planlegge DaemonSets – begge utilgjengelige på GKE Autopilot og EKS Fargate.

### API-modus (`logs.mode: api`)

En Deployment med én replika (`oneuptime/kubernetes-log-tailer`-bildet) bruker Kubernetes API til å strømme container-logger – det samme endepunktet `kubectl logs -f` bruker. Ingen hostPath, ingen vertilgang, ingen DaemonSet.

- **Fordeler:** fungerer på GKE Autopilot, EKS Fargate og enhver klynge som blokkerer hostPath eller håndhever `restricted` Pod Security Standard.
- **Ulemper:** hver container-strøm er en langvarig tilkobling til `kube-apiserver`. I praksis håndterer én replika noen tusen containere komfortabelt. For svært store klynger, splitt etter navnerom ved hjelp av `logs.api.replicas` pluss `namespaceFilters.include` på hver replika.

### Hvilken bør du bruke?

Hvis hostPath fungerer, bruk DaemonSet. Overalt ellers, bruk API-modus. `preset`-innstillingen velger den riktige for deg.

Du kan også deaktivere logginnsamling helt med `--set logs.enabled=false` og sende applikasjonslogger via OpenTelemetry SDKer i stedet. Se [OpenTelemetry](/docs/telemetry/open-telemetry)-dokumentasjonen.

## Vanlige alternativer

| Alternativ | Standard | Beskrivelse |
| --- | --- | --- |
| `preset` | (tom – behandles som `standard`) | Se tabellen ovenfor. |
| `oneuptime.url` | *(påkrevd)* | URL til din OneUptime-instans. |
| `oneuptime.apiKey` | *(påkrevd)* | Prosjektets API-nøkkel (Innstillinger → API-nøkler). |
| `clusterName` | *(påkrevd)* | Unikt navn for denne klyngen. Stemples som `k8s.cluster.name` på alle poster. |
| `namespaceFilters.include` | `[]` | Hvis angitt, overvåkes bare disse navnerommene. |
| `namespaceFilters.exclude` | `["kube-system"]` | Navnerom som skal hoppes over. |
| `logs.enabled` | `true` | Slå logginnsamling på eller av. |
| `logs.mode` | (utledet fra `preset`) | `daemonset`, `api` eller `disabled`. Overstyrer forhåndsinnstillingen. |
| `logs.api.replicas` | `1` | Antall Deployment-replikaer for logg-taleren (bare i API-modus). |
| `controlPlane.enabled` | `false` | Skrap etcd / api-server / scheduler / controller-manager. Bare for selvadministrerte klynger – administrerte tilbud (EKS/GKE/AKS) eksponerer vanligvis ikke disse endepunktene. |

Se [kartets `values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) for den fullstendige listen.

## Oppgradering

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` beholder den eksisterende konfigurasjonen din; legg til nye `--set`-overstyringer på toppen av den.

## Avinstallering

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Feilsøking

### Installasjonen mislykkes med "hostPath volumes are not allowed"

Klyngen blokkerer hostPath. Bytt til en API-modus-forhåndsinnstilling:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # eller eks-fargate
```

### Ingen logger vises i OneUptime

Sjekk agentpodene:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

I API-modus eksponerer logg-taler-poden `/healthz` på port 13133 – treff den via `kubectl port-forward` for et eksportstatusøyeblikksbilde.

### Klyngen min har for mange pods for én logg-taler-replika (bare API-modus)

Skaler horisontalt ved å splitte navnerom. Distribuer én gang per navneromgruppe:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Alternativt, øk `logs.api.replicas` – men merk at hver replika behandler alle tillatte navnerom, så for deduplicering trenger du fortsatt navneromssplitting.
