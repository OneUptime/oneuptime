# OneUptime Kubernetes-agent (Helm)

## Översikt

OneUptime Kubernetes-agenten är ett färdigpaketerat Helm-diagram som installerar en OpenTelemetry-baserad insamlarpipeline på ditt kluster. Den levererar nod-, pod-, container- och klustermått; Kubernetes-händelser; pod-loggar; och — med eBPF aktiverat som standard — applikationsspårningar, HTTP RED-mått, tjänstegrafsdata och nätverksflödesmått pod-till-pod. Inga kodändringar, inga SDK:er, ett enda `helm install`.

Den här sidan är **installationsguiden**. För att konfigurera Kubernetes-monitorer och varningar ovanpå datan som agenten samlar in, se [Kubernetes-agent (monitorer)](/docs/monitor/kubernetes-agent).

## Förutsättningar

- Ett körande Kubernetes-kluster (v1.23+)
- `kubectl` konfigurerat för åtkomst till ditt kluster
- `helm` v3 installerat
- En **OneUptime API-nyckel** — skapa en från *Project Settings → API Keys*

## Steg 1 — Lägg till OneUptime Helm-arkivet

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Steg 2 — Välj en förinställning för ditt kluster

Diagrammet exponerar ett enda alternativ på toppnivå — `preset` — som väljer kompatibla standardvärden för din Kubernetes-distribution. Det styr saker du annars skulle behöva justera för hand: om loggar ska levereras via en hostPath-DaemonSet eller via Kubernetes-API:et, och vilken säkerhetskontext som ska tillämpas.

| `preset` | Använd för | Logginsamling |
|---|---|---|
| `standard` *(standard)* | Självhanterade kluster, **EKS på EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet som läser `/var/log/pods` via hostPath (lägst overhead) |
| `gke-autopilot` | **GKE Autopilot** | Deployment med loggläsare via Kubernetes-API (ingen hostPath, ingen värdåtkomst) |
| `eks-fargate` | **EKS Fargate** | Deployment med loggläsare via Kubernetes-API (ingen hostPath, ingen värdåtkomst) |

Om du är osäker, börja med `standard`. Om installationen misslyckas med ett Pod Security-fel som nämner `hostPath`, kör om med `preset=gke-autopilot` (eller `eks-fargate` på Fargate) så fungerar det.

## Steg 3 — Installera Kubernetes-agenten

Ersätt `YOUR_ONEUPTIME_URL`, `YOUR_ONEUPTIME_API_KEY` och klusternamnet med värden för din miljö. Klusternamnet är hur klustret kommer att visas i OneUptime — välj något stabilt som `prod-us-east-1`.

### Standardkluster (självhanterade, EKS på EC2, GKE Standard, AKS)

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

## Steg 4 — Verifiera installationen

Kontrollera att agentens poddar körs:

```bash
kubectl get pods -n oneuptime-agent
```

På ett **standard**-kluster ser du en metrics-collector Deployment plus en log-collector DaemonSet-pod per nod:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

På **GKE Autopilot** eller **EKS Fargate** ser du i stället två Deployments (ingen DaemonSet):

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

När agenten ansluter visas ditt kluster automatiskt i avsnittet **Kubernetes** i OneUptime-instrumentpanelen.

## Konfigurationsalternativ

### Namnrymdsfiltrering

Som standard exkluderas `kube-system`. För att övervaka endast specifika namnrymder:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

### Inaktivera logginsamling

Om du bara behöver mått och händelser (inga pod-loggar):

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### Tvinga ett specifikt logginsamlingsläge

Avancerade användare kan åsidosätta förinställningens val med `logs.mode`:

- `logs.mode=daemonset` — hostPath-DaemonSet (lägst overhead, kräver hostPath)
- `logs.mode=api` — Deployment med loggläsare via Kubernetes-API (fungerar på vilket kluster som helst)
- `logs.mode=disabled` — ingen logginsamling

Det uttryckliga `logs.mode` vinner alltid över förinställningens standard. Använd detta om du känner ditt kluster bättre än förinställningen gör.

### Aktivera övervakning av kontrollplan

För självhanterade kluster (inte EKS / GKE / AKS) kan du aktivera kontrollplansmått:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> Hanterade Kubernetes-tjänster (EKS, GKE, AKS) exponerar vanligtvis inte kontrollplansmått. Aktivera detta endast för självhanterade kluster.

### Auto-tagga med projektetiketter

Vilket resursattribut som helst med prefixet `oneuptime.label.` befordras till en projektetikett och kopplas till klustret, tjänsterna och värdarna som denna agent avger. Mönster: `oneuptime.label.<dimension>=<value>` blir en etikett med namnet `<dimension>:<value>`.

Skicka etiketter vid installationen med `--set oneuptime.labels.<key>=<value>`:

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

Eller behåll dem i en values-fil:

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

Etiketter matchas skiftlägesokänsligt, så en befintlig manuellt skapad `Production`-etikett återanvänds i stället för att dupliceras. Etiketter som lagts till manuellt i OneUptime-gränssnittet tas aldrig bort av agenten.

## Uppgradera agenten

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values` behåller din befintliga konfiguration (förinställning, klusternamn, filter); skicka eventuella nya `--set`-åsidosättanden ovanpå den.

## Avinstallera agenten

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## Vad som samlas in

| Kategori | Data |
|----------|------|
| **Nodmått** | CPU-utnyttjande, minnesanvändning, filsystemsanvändning, nätverks-I/O |
| **Pod-mått** | CPU-användning, minnesanvändning, nätverks-I/O, omstarter |
| **Containermått** | CPU-användning, minnesanvändning per container |
| **Klustermått** | Nodtillstånd, allokerbara resurser, pod-antal |
| **Kubernetes-händelser** | Varningar, fel, schemaläggningshändelser |
| **Pod-loggar** | stdout/stderr-loggar från alla containrar (via hostPath-DaemonSet på standardkluster, eller via Kubernetes-API på Autopilot / Fargate) |
| **Applikationsspårningar** *(via eBPF, på som standard)* | HTTP-, gRPC-, SQL/Redis-spans från varje pod — ingen SDK eller kodändringar |
| **HTTP RED-mått** *(via eBPF)* | `http.server.request.duration`, storlekar på begäran- och svarskroppar, per tjänst |
| **Tjänstegraf** *(via eBPF)* | Anropare → anropad begärandefrekvens, latens och felkanter — driver tjänstekartsvyn |
| **Nätverksflödesmått** *(via eBPF)* | TCP/UDP byte- och paketräknare pod-till-pod med k8s-metadata |
| **TCP-statistik** *(via eBPF)* | Nodnivå-RTT, misslyckade anslutningar och retransmit-räknare |

## Applikationsspårningar och HTTP-mått via eBPF (på som standard)

Diagrammet kör en DaemonSet med [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) på varje nod. Den laddar eBPF-program in i kärnan och fångar automatiskt HTTP/HTTPS-, gRPC- och SQL/Redis-trafik från varje stödd körtid (Go, .NET, Java, Node.js, Python, Ruby, Rust) — ingen SDK och ingen sidecar krävs. Spårningar och begärandemått flödar sedan genom insamlaren i klustret till OneUptime.

**Krav:** Linux-kärna **5.8+** med BTF (standard på Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+). eBPF-DaemonSet:en körs i **privilegierat läge** eftersom den måste, för att kunna ladda eBPF-program.

### Inaktivera eBPF-autoinstrumentering

Du bör inaktivera den när:

- Du installerar på **GKE Autopilot** eller **EKS Fargate** — dessa plattformar blockerar privilegierade poddar (använd `preset=gke-autopilot` / `preset=eks-fargate` och kombinera med `ebpf.enabled=false`).
- Noder kör en kärna äldre än 5.8 utan BTF-bakåtportar.
- Du redan levererar spårningar via OpenTelemetry-SDK:er från dina appar och inte vill ha dubbletter.

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### Växla enskilda signalfamiljer

Alla på som standard. Stäng av någon med `--set ebpf.features.<name>=false`:

| `ebpf.features.*` | Standard | Vad det lägger till |
|---|---|---|
| `httpMetrics` | på | HTTP/gRPC RED-mått (begärandefrekvens, latens, fel) per tjänst |
| `spanMetrics` | på | Begäran-/svarsstorlek och varaktighet per span |
| `serviceGraph` | på | Kantmått anropare → anropad; driver tjänstekartan |
| `hostMetrics` | på | CPU och minne per instrumenterad process |
| `networkMetrics` | på | TCP/UDP-flödesräknare pod-till-pod |
| `networkInterZoneMetrics` | av | Inter-zonvariant av nätverksmått (dubblerar kardinalitet) |
| `tcpStats` | på | Nodnivå TCP RTT, misslyckade anslutningar, retransmit-räknare |

Spårningskontextpropagering mellan tjänster är också på som standard — OBI injicerar W3C `traceparent` i utgående HTTP/TCP så att en begäran som korsar pod A → pod B visas som en enda spårning, inga SDK-ändringar någonstans. Stäng av med `--set ebpf.contextPropagation=false`.

## Felsökning

> **Snabbaste vägen — kör diagnostikskriptet.** Det inspekterar pod-hälsa, avkodar och validerar ingestnyckeln, kontrollerar att ditt kluster kan nå OneUptime och frågar OneUptime om din token faktiskt accepteras — och skriver sedan ut ett enda rotorsaksutlåtande:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> Det läser bara klustertillstånd och kör ett par sonder; det ändrar ingenting. För det mest exakta egress-testet, installera med `--set debug.enabled=true` först (detta lägger till en liten nätverksverktygs-sidecar till agentens poddar så att skriptet testar insamlarens exakta egress-väg), och kör sedan om.

### Installationen misslyckas med "hostPath volumes are not allowed" eller ett Pod Security admission-fel

Ditt kluster blockerar `hostPath` — vanligt på **GKE Autopilot** och **EKS Fargate**. Byt till API-lägesförinställningen:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### Agenten visar "Disconnected"

Ett klusters anslutningsstatus drivs uteslutande av telemetri som anländer — om ingen data landar markeras klustret som frånkopplat efter ~5 minuter. Så "disconnected" och "inga mått" har nästan alltid **samma** orsak: agentens telemetri accepteras inte.

Den vanligaste anledningen — särskilt efter en ominstallation — är en **felaktig eller återkallad ingestnyckel**. Detta är lätt att missa eftersom OTLP-ingestslutpunkterna avsiktligt returnerar HTTP `200` även för en felaktig token (så att en felkonfigurerad insamlare inte kan översvämma servern med återförsök). Resultatet: insamlaren rapporterar framgång, dess loggar visar inga fel, och datan kastas tyst.

1. Kontrollera att agentens poddar körs: `kubectl get pods -n oneuptime-agent`
2. Kontrollera metrics-collector-loggarna: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (inga fel här betyder **inte** att data landar — se ovan)
3. **Validera ingestnyckeln.** Fråga OneUptime direkt om din token accepteras (`200` = giltig, `401` = okänd/återkallad):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   Om det returnerar `401` är nyckeln i din release felaktig eller återkallad. Kopiera en aktiv nyckel från *Project Settings → Telemetry Ingestion Keys* och distribuera om:

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. Verifiera att din OneUptime-URL är korrekt och att ditt kluster kan nå den över nätverket.
5. Om du ändrade `clusterName` vid ominstallation visas agenten som ett **nytt** kluster — den gamla posten förblir "Disconnected" (det är förväntat; den är inaktuell).

### Inga loggar visas (endast API-läge)

1. Bekräfta att loggläsar-podden är Ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`
2. Kontrollera dess `/healthz` — den rapporterar antalet aktiva strömmar och det senaste exportfelet
3. Kontrollera loggar: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. För mycket stora kluster kan en enda replika vara en flaskhals — sharda per namnrymd med `namespaceFilters.include` på separata releaser

### Inga mått visas

1. Uteslut först en avvisad ingestnyckel — det är den vanligaste orsaken och är osynlig från agentsidan. Se [Agenten visar "Disconnected"](#agent-shows-disconnected) ovan (eller kör bara diagnostikskriptet).
2. Kontrollera att klusteridentifieraren matchar värdet du skickade som `clusterName`
3. Verifiera RBAC-behörigheterna: `kubectl get clusterrolebinding | grep kubernetes-agent`
4. Kontrollera OTel-insamlarens loggar för exportfel

### eBPF-poddar är CrashLoopBackOff eller startar inte

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

Vanliga orsaker:

- **Kärnan för gammal eller BTF saknas.** OBI behöver Linux 5.8+ med BTF. Kör `uname -r` på en nod. Om du inte kan uppgradera, inaktivera eBPF: `--set ebpf.enabled=false`.
- **Privilegierade poddar blockerade.** Vissa kluster avvisar privilegierade poddar (GKE Autopilot, EKS Fargate och nedlåsta miljöer). Inaktivera eBPF.
- **`debugfs` / `tracefs` inte monterade på värden.** Funktionen `tcpStats` kopplas till kärnspårningspunkter som behöver dem. Diagrammet monterar båda via `hostPath` — men om din värd inte exponerar dem, inaktivera bara den familjen: `--set ebpf.features.tcpStats=false`.

### Inga applikationsspårningar visas

1. Bekräfta att eBPF-DaemonSet:en är frisk: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. Slå på debug-spårningsskrivaren för att bekräfta att OBI fångar trafik: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, kontrollera sedan `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`
3. Om du ser spans i OBI:s stdout men inte i instrumentpanelen är problemet exporten insamlare → OneUptime — kontrollera metrics-collector-poddens loggar.

## Nästa steg

- Konfigurera **Kubernetes-monitorer** ovanpå måtten som denna agent samlar in — se [Kubernetes-agent (monitorer)](/docs/monitor/kubernetes-agent).
- Lägg till **Loggmonitorer** för att varna om specifika loggmönster (t.ex. felantal över en tröskel per pod eller per namnrymd).
- För icke-Kubernetes-värdar (Linux / macOS / Windows-VM:ar och bare metal), använd sidan [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
