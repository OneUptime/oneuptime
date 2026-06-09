# OneUptime Kubernetes Agent (Helm)

## Overzicht

De OneUptime Kubernetes Agent is een vooraf samengestelde Helm chart die een op OpenTelemetry gebaseerde collector-pipeline op je cluster installeert. Hij levert node-, pod-, container- en clustermetrieken; Kubernetes-events; pod-logs; en — met eBPF standaard ingeschakeld — applicatietraces, HTTP RED-metrieken, service-graph-data en pod-naar-pod netwerkflowmetrieken. Geen codewijzigingen, geen SDK's, één `helm install`.

Deze pagina is de **installatiegids**. Voor het configureren van Kubernetes-monitors en -alerts bovenop de data die de agent verzamelt, zie [Kubernetes Agent (monitors)](/docs/monitor/kubernetes-agent).

## Vereisten

- Een draaiend Kubernetes-cluster (v1.23+)
- `kubectl` geconfigureerd om toegang te krijgen tot je cluster
- `helm` v3 geïnstalleerd
- Een **OneUptime API-sleutel** — maak er een aan via *Project Settings → API Keys*

## Stap 1 — Voeg de OneUptime Helm Repository toe

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Stap 2 — Kies een Preset voor je Cluster

De chart biedt één optie op het hoogste niveau — `preset` — die compatibele standaardwaarden kiest voor jouw Kubernetes-distributie. Het regelt zaken die je anders handmatig zou moeten afstemmen: of logs verzonden worden via een hostPath DaemonSet of via de Kubernetes API, en welke security context wordt toegepast.

| `preset` | Gebruik voor | Logverzameling |
|---|---|---|
| `standard` *(standaard)* | Zelfbeheerde clusters, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet die `/var/log/pods` leest via hostPath (laagste overhead) |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API log-tailer Deployment (geen hostPath, geen hosttoegang) |
| `eks-fargate` | **EKS Fargate** | Kubernetes API log-tailer Deployment (geen hostPath, geen hosttoegang) |

Als je het niet zeker weet, begin dan met `standard`. Als de installatie mislukt met een Pod Security-fout die `hostPath` vermeldt, voer het dan opnieuw uit met `preset=gke-autopilot` (of `eks-fargate` op Fargate) en het zal werken.

## Stap 3 — Installeer de Kubernetes Agent

Vervang `YOUR_ONEUPTIME_URL`, `YOUR_ONEUPTIME_API_KEY` en de clusternaam door waarden voor jouw omgeving. De clusternaam bepaalt hoe het cluster in OneUptime verschijnt — kies iets stabiels zoals `prod-us-east-1`.

### Standaardclusters (zelfbeheerd, EKS on EC2, GKE Standard, AKS)

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster"
```

### GKE Autopilot

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=gke-autopilot
```

### EKS Fargate

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=eks-fargate
```

## Stap 4 — Verifieer de Installatie

Controleer of de agent-pods draaien:

```bash
kubectl get pods -n oneuptime-agent
```

Op een **standaard**cluster zie je een metrics-collector Deployment plus één log-collector DaemonSet-pod per node:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

Op **GKE Autopilot** of **EKS Fargate** zie je in plaats daarvan twee Deployments (geen DaemonSet):

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

Zodra de agent verbinding maakt, verschijnt je cluster automatisch in de sectie **Kubernetes** van het OneUptime-dashboard.

## Configuratieopties

### Namespace-filtering

Standaard wordt `kube-system` uitgesloten. Om alleen specifieke namespaces te monitoren:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

### Logverzameling uitschakelen

Als je alleen metrieken en events nodig hebt (geen pod-logs):

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### Forceer een Specifieke Logverzamelmodus

Gevorderde gebruikers kunnen de keuze van de preset overschrijven met `logs.mode`:

- `logs.mode=daemonset` — hostPath DaemonSet (laagste overhead, vereist hostPath)
- `logs.mode=api` — Kubernetes API log-tailer Deployment (werkt op elk cluster)
- `logs.mode=disabled` — geen logverzameling

De expliciete `logs.mode` wint altijd van de preset-standaard. Gebruik dit als je je cluster beter kent dan de preset.

### Control Plane-monitoring inschakelen

Voor zelfbeheerde clusters (niet EKS / GKE / AKS) kun je control plane-metrieken inschakelen:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> Managed Kubernetes-services (EKS, GKE, AKS) stellen doorgaans geen control plane-metrieken beschikbaar. Schakel dit alleen in voor zelfbeheerde clusters.

### Automatisch taggen met projectlabels

Elk resource-attribuut met het voorvoegsel `oneuptime.label.` wordt gepromoveerd tot een project-Label en gekoppeld aan het cluster, de services en de hosts die door deze agent worden uitgezonden. Patroon: `oneuptime.label.<dimension>=<value>` wordt een label met de naam `<dimension>:<value>`.

Geef labels door tijdens de installatie met `--set oneuptime.labels.<key>=<value>`:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="prod" \
  --set oneuptime.labels.team=payments \
  --set oneuptime.labels.env=production \
  --set oneuptime.labels.region=us-east-1
```

Of bewaar ze in een values-bestand:

```yaml
# values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
  labels:
    team: payments
    env: production
    region: us-east-1
clusterName: prod
```

Labels worden hoofdletterongevoelig gematcht, dus een bestaand handmatig aangemaakt label `Production` wordt hergebruikt in plaats van gedupliceerd. Labels die handmatig in de OneUptime-UI zijn toegevoegd, worden nooit door de agent verwijderd.

## De Agent upgraden

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values` behoudt je bestaande configuratie (preset, clusternaam, filters); geef nieuwe `--set`-overschrijvingen daar bovenop door.

## De Agent verwijderen

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## Wat Wordt Verzameld

| Categorie | Data |
|----------|------|
| **Node-metrieken** | CPU-gebruik, geheugengebruik, bestandssysteemgebruik, netwerk-I/O |
| **Pod-metrieken** | CPU-gebruik, geheugengebruik, netwerk-I/O, herstarts |
| **Container-metrieken** | CPU-gebruik, geheugengebruik per container |
| **Cluster-metrieken** | Node-condities, toewijsbare resources, pod-aantallen |
| **Kubernetes-events** | Waarschuwingen, fouten, scheduling-events |
| **Pod-logs** | stdout/stderr-logs van alle containers (via hostPath DaemonSet op standaardclusters, of via de Kubernetes API op Autopilot / Fargate) |
| **Applicatietraces** *(via eBPF, standaard aan)* | HTTP-, gRPC-, SQL/Redis-spans van elke pod — geen SDK of codewijzigingen |
| **HTTP RED-metrieken** *(via eBPF)* | `http.server.request.duration`, request- en response-body-groottes, per service |
| **Service Graph** *(via eBPF)* | Caller → callee request rate, latentie en error edges — voedt de service-mapweergave |
| **Netwerkflowmetrieken** *(via eBPF)* | Pod-naar-pod TCP/UDP byte- en packet-tellers met k8s-metadata |
| **TCP Stats** *(via eBPF)* | RTT op node-niveau, mislukte-verbinding- en retransmit-tellers |

## Applicatietraces & HTTP-metrieken via eBPF (standaard aan)

De chart draait een DaemonSet met [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) op elke node. Het laadt eBPF-programma's in de kernel en legt automatisch HTTP/HTTPS-, gRPC- en SQL/Redis-verkeer vast vanuit elke ondersteunde runtime (Go, .NET, Java, Node.js, Python, Ruby, Rust) — geen SDK en geen sidecar vereist. Traces en request-metrieken stromen vervolgens via de in-cluster collector naar OneUptime.

**Vereisten:** Linux-kernel **5.8+** met BTF (standaard op Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+). De eBPF DaemonSet draait in **privileged mode** omdat het noodzakelijk is om eBPF-programma's te laden.

### eBPF-auto-instrumentatie uitschakelen

Je moet het uitschakelen wanneer:

- Je installeert op **GKE Autopilot** of **EKS Fargate** — die platforms blokkeren privileged pods (gebruik `preset=gke-autopilot` / `preset=eks-fargate` en combineer met `ebpf.enabled=false`).
- Nodes een kernel ouder dan 5.8 draaien zonder BTF-backports.
- Je al traces verzendt via OpenTelemetry SDK's vanuit je apps en geen duplicaten wilt.

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### Individuele signaalfamilies in-/uitschakelen

Allemaal standaard aan. Schakel er een uit met `--set ebpf.features.<name>=false`:

| `ebpf.features.*` | Standaard | Wat het toevoegt |
|---|---|---|
| `httpMetrics` | aan | HTTP/gRPC RED-metrieken (request rate, latentie, errors) per service |
| `spanMetrics` | aan | Request-/response-grootte en -duur per span |
| `serviceGraph` | aan | Caller → callee edge-metrieken; voedt de service-map |
| `hostMetrics` | aan | CPU en geheugen per geïnstrumenteerd proces |
| `networkMetrics` | aan | Pod-naar-pod TCP/UDP-flow-tellers |
| `networkInterZoneMetrics` | uit | Inter-zone-variant van netwerkmetrieken (verdubbelt de cardinaliteit) |
| `tcpStats` | aan | TCP RTT op node-niveau, mislukte-verbinding-, retransmit-tellers |

Cross-service trace-contextpropagatie is ook standaard aan — OBI injecteert W3C `traceparent` in uitgaande HTTP/TCP, zodat een request die pod A → pod B kruist als één enkele trace verschijnt, zonder SDK-wijzigingen ergens. Schakel uit met `--set ebpf.contextPropagation=false`.

## Probleemoplossing

> **Snelste route — voer het diagnosescript uit.** Het inspecteert pod-health, decodeert en valideert de ingestion-sleutel, controleert of je cluster OneUptime kan bereiken, en vraagt OneUptime of je token daadwerkelijk geaccepteerd wordt — en print vervolgens één enkel hoofdoorzaak-oordeel:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> Het leest alleen de clusterstatus en voert een paar probes uit; het wijzigt niets. Voor de meest nauwkeurige egress-test, installeer eerst met `--set debug.enabled=true` (dit voegt een kleine network-tools-sidecar toe aan de agent-pods, zodat het script het exacte egress-pad van de collector test), en voer het daarna opnieuw uit.

### Installatie mislukt met "hostPath volumes are not allowed" of een Pod Security admission-fout

Je cluster blokkeert `hostPath` — gangbaar op **GKE Autopilot** en **EKS Fargate**. Schakel over naar de API-modus-preset:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### Agent toont "Disconnected"

De verbonden status van een cluster wordt puur bepaald door binnenkomende telemetrie — als er geen data binnenkomt, wordt het cluster na ~5 minuten als verbroken gemarkeerd. Dus "disconnected" en "geen metrieken" hebben vrijwel altijd **dezelfde** oorzaak: de telemetrie van de agent wordt niet geaccepteerd.

De meest voorkomende reden — vooral na een herinstallatie — is een **verkeerde of ingetrokken ingestion-sleutel**. Dit wordt makkelijk over het hoofd gezien omdat de OTLP-ingest-endpoints bewust HTTP `200` retourneren, zelfs voor een ongeldig token (zodat een verkeerd geconfigureerde collector de server niet kan overspoelen met retries). Het gevolg: de collector rapporteert succes, de logs tonen geen fouten en de data wordt stilletjes verworpen.

1. Controleer of de agent-pods draaien: `kubectl get pods -n oneuptime-agent`
2. Controleer de metrics-collector-logs: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (geen fouten hier betekent **niet** dat data binnenkomt — zie hierboven)
3. **Valideer de ingestion-sleutel.** Vraag OneUptime rechtstreeks of je token geaccepteerd wordt (`200` = geldig, `401` = onbekend/ingetrokken):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   Als het `401` retourneert, is de sleutel in je release verkeerd of is deze ingetrokken. Kopieer een actieve sleutel uit *Project Settings → Telemetry Ingestion Keys* en deploy opnieuw:

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. Verifieer dat je OneUptime-URL correct is en dat je cluster deze via het netwerk kan bereiken.
5. Als je `clusterName` bij een herinstallatie hebt gewijzigd, verschijnt de agent als een **nieuw** cluster — het oude item blijft "Disconnected" (dat is verwacht; het is verouderd).

### Geen logs zichtbaar (alleen API-modus)

1. Bevestig dat de log-tailer-pod Ready is: `kubectl get pods -n oneuptime-agent -l component=log-collector`
2. Controleer zijn `/healthz` — het rapporteert het aantal actieve streams en de laatste export-fout
3. Controleer de logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. Voor zeer grote clusters kan één enkele replica een bottleneck zijn — shard per namespace met `namespaceFilters.include` op aparte releases

### Geen metrieken zichtbaar

1. Sluit eerst een geweigerde ingestion-sleutel uit — het is de meest voorkomende oorzaak en is onzichtbaar vanaf de agent-kant. Zie [Agent toont "Disconnected"](#agent-shows-disconnected) hierboven (of voer gewoon het diagnosescript uit).
2. Controleer of de cluster-identifier overeenkomt met de waarde die je hebt doorgegeven als `clusterName`
3. Verifieer de RBAC-permissies: `kubectl get clusterrolebinding | grep kubernetes-agent`
4. Controleer de OTel-collector-logs op export-fouten

### eBPF-pods zijn CrashLoopBackOff of starten niet

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

Veelvoorkomende oorzaken:

- **Kernel te oud of BTF ontbreekt.** OBI heeft Linux 5.8+ met BTF nodig. Voer `uname -r` uit op een node. Als je niet kunt upgraden, schakel eBPF uit: `--set ebpf.enabled=false`.
- **Privileged pods geblokkeerd.** Sommige clusters weigeren privileged pods (GKE Autopilot, EKS Fargate en vergrendelde omgevingen). Schakel eBPF uit.
- **`debugfs` / `tracefs` niet gemount op de host.** De `tcpStats`-functie koppelt zich aan kernel-tracepoints die ze nodig hebben. De chart mount beide via `hostPath` — maar als je host ze niet beschikbaar stelt, schakel dan alleen die familie uit: `--set ebpf.features.tcpStats=false`.

### Geen applicatietraces zichtbaar

1. Bevestig dat de eBPF DaemonSet gezond is: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. Schakel de debug-trace-printer in om te bevestigen dat OBI verkeer vastlegt: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, en controleer daarna `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`
3. Als je spans ziet in OBI's stdout maar niet in het dashboard, zit het probleem in de collector → OneUptime-export — controleer de logs van de metrics-collector-pod.

## Volgende stappen

- Configureer **Kubernetes Monitors** bovenop de metrieken die deze agent verzamelt — zie [Kubernetes Agent (monitors)](/docs/monitor/kubernetes-agent).
- Voeg **Logs Monitors** toe om te alerten op specifieke logpatronen (bijv. error-aantallen boven een drempel per pod of per namespace).
- Voor niet-Kubernetes-hosts (Linux / macOS / Windows VM's en bare metal), gebruik de pagina [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
