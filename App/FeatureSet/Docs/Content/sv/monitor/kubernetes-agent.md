# Installera Kubernetes-agenten

OneUptime Kubernetes-agenten samlar in klustermätvärden, händelser, pod-loggar, **applikationsspårningar (HTTP/gRPC via eBPF)** och **OS-nivå nodmätvärden** från ditt Kubernetes-kluster och skickar dem till OneUptime. Den distribueras som ett Helm-diagram och installeras med ett enda kommando — eBPF-autoinstrumentering är aktiverat som standard, så du ser spårningar på tjänstenivå och RED-mätvärden utan kodändringar. **Kontinuerliga CPU-flame graphs (eBPF-profilerare)** är också tillgängliga — välj till med `--set profiling.enabled=true` när du vill ha mer telemetri.

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

Olika Kubernetes-distributioner har olika begränsningar — framför allt om arbetsbelastningar kan montera `hostPath`-volymer. I stället för att tvinga dig att läsa säkerhetsdokumentation exponerar diagrammet ett enda alternativ på toppnivå: `preset`.

| Preset | Användning | Logginsamling | Anmärkningar |
| --- | --- | --- | --- |
| `standard` (standard) | Självhanterade, **EKS på EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet som läser `/var/log/pods` via hostPath | Lägst overhead. hostPath är tillgängligt på dessa plattformar. |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API-tailer (Deployment) | hostPath är blockerat på Autopilot. Anger en härdad säkerhetskontext som klarar Autopilots Pod Security Standards. |
| `eks-fargate` | **EKS Fargate** | Kubernetes API-tailer (Deployment) | Samma som `gke-autopilot`. Fargate blockerar hostPath och DaemonSets. |

Om du är osäker, lämna `preset` osatt — du får `standard`-standardvärden. Om ditt kluster avvisar installationen med ett Pod Security-policyfel som nämner `hostPath`, byt till `gke-autopilot` (eller `eks-fargate` på EKS Fargate) och installera om.

### Exempel

**GKE Standard, EKS på EC2, självhanterat eller AKS:**

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

## Hur de två logginsamlingslägena skiljer sig åt

Under huven sätter `preset` värdet på `logs.mode` — och du kan också ange det direkt om du behöver åsidosätta förinställningens standardvärde.

### DaemonSet-läge (`logs.mode: daemonset`)

En DaemonSet kör en OpenTelemetry Collector-pod per nod. Den läser loggfiler under `/var/log/pods/` via en hostPath-volym och vidarebefordrar dem över OTLP.

- **Fördelar:** lägst overhead, skalar linjärt med antal noder, ingen belastning på Kubernetes API-servern, hanterar loggrotation.
- **Nackdelar:** kräver hostPath, kräver möjligheten att schemalägga DaemonSets — båda otillgängliga på GKE Autopilot och EKS Fargate.

### API-läge (`logs.mode: api`)

En Deployment med en enda replika (avbildningen `oneuptime/kubernetes-log-tailer`) använder Kubernetes API för att strömma containerloggar — samma endpoint som `kubectl logs -f` använder. Ingen hostPath, ingen värdåtkomst, ingen DaemonSet.

- **Fördelar:** fungerar på GKE Autopilot, EKS Fargate och alla kluster som blockerar hostPath eller framtvingar `restricted` Pod Security Standard.
- **Nackdelar:** varje containerström är en långlivad anslutning till `kube-apiserver`. I praktiken hanterar en replika ett par tusen containrar bekvämt. För mycket stora kluster, sharda per namespace med `logs.api.replicas` plus `namespaceFilters.include` på varje replika.

### Vilken bör du använda?

Om hostPath fungerar, använd DaemonSet. På alla andra platser, använd API-läge. Inställningen `preset` väljer rätt för dig.

Du kan också inaktivera logginsamling helt med `--set logs.enabled=false` och skicka applikationsloggar via OpenTelemetry SDK:er i stället. Se dokumentationen för [OpenTelemetry](/docs/telemetry/open-telemetry).

## Applikationsspårningar och HTTP-förfrågningar via eBPF (på som standard)

Diagrammet levererar en DaemonSet som kör [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) på varje nod. OBI laddar eBPF-program i Linux-kärnan och bevakar trafik på socketnivå för att rekonstruera HTTP/HTTPS-, gRPC- och SQL/Redis-anrop från varje pod på noden — inga kodändringar, ingen SDK, ingen sidecar. Insamlad trafik exporteras som OTLP-spårningar och förfrågnings-/latensmätvärden direkt till OneUptime.

Efter installationen börjar dina tjänster visas under **Telemetry → Traces** och tjänstekartan inom en minut eller två, med `k8s.cluster.name` satt till ditt `clusterName` så att du kan filtrera per kluster.

### När du ska stänga av det

eBPF är **aktiverat som standard**. Du bör inaktivera det (`--set ebpf.enabled=false`) om:

- Du installerar på **GKE Autopilot** eller **EKS Fargate**. Dessa plattformar blockerar privilegierade poddar, och OBI behöver privilegierat läge för att ladda eBPF-program.
- Dina noder kör en kärna äldre än **Linux 5.8** utan BTF-backports. (Moderna distributioner — Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+ — är okej.)
- Du skickar redan spårningar via OpenTelemetry SDK från dina appar och vill inte ha dubbletter.

### Vad som skickas

OBI extraherar flera signalfamiljer från den insamlade trafiken. Alla är på som standard; var och en kan inaktiveras separat med `--set ebpf.features.<key>=false`:

| Signal | Standard | Vad det tillför |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | på | HTTP/gRPC RED-mätvärden — förfrågningsfrekvens, latenshistogram, antal fel — per tjänst. |
| `ebpf.features.spanMetrics` | på | Mätvärden nycklade på span-attribut: förfrågningsstorlek, svarsstorlek, varaktighet uppdelat per rutt/operation. |
| `ebpf.features.serviceGraph` | på | Mätvärden för kanter mellan tjänster (anropare → anropad förfrågningsfrekvens + latens). Driver tjänstekartan. |
| `ebpf.features.hostMetrics` | på | CPU och minne per instrumenterad process — sparar in på att köra en separat profilerare för grundläggande kapacitetsfrågor. |
| `ebpf.features.networkMetrics` | på | Byte- och paketräknare för TCP/UDP-flöden mellan poddar med k8s-metadata. Synliggör varje par av poddar som pratar, inklusive sådana som kör protokoll som OBI inte kan tolka. |
| `ebpf.features.networkInterZoneMetrics` | av | Inter-zonvariant av nätverksmätvärden. Fördubblar kardinalitet; värt att aktivera bara om du faktiskt använder zonbaserad schemaläggning. |
| `ebpf.features.tcpStats` | på | TCP-statistik på nodnivå: RTT-histogram, antal misslyckade anslutningar, omsändningar. |

OBI propagerar också spårningskontext över tjänstegränser som standard. När pod A gör en HTTP/gRPC-förfrågan till pod B injicerar OBI en W3C `traceparent`-header i den utgående förfrågan — så att den resulterande span:en på pod B:s sida länkas in i samma spår som pod A:s utgående. Inga SDK-ändringar behövs i någon av apparna.

| Alternativ | Standard | Beskrivning |
| --- | --- | --- |
| `ebpf.contextPropagation` | på | Injicera W3C `traceparent` i utgående trafik (HTTP-headers + anpassat TCP-alternativ). Sätt till `false` för att hålla varje tjänsts spans lokala. |
| `ebpf.trackRequestHeaders` | på | Spårning av förfrågningshuvuden på kärnsidan så att propagering också fungerar på vanliga HTTP-servrar (icke-Go, icke-TLS). Träder bara i kraft när `contextPropagation` är true. |

### Logg ↔ spår-korrelation

Också på som standard. OBI:s logganrikare avlyssnar pod-stdout-skrivningar från instrumenterade processer och:

- För **JSON-formaterade loggar**: injicerar fälten `trace_id` och `span_id` i raden (eventuella befintliga värden i loggen bevaras). filelog-DaemonSet:en lyfter sedan dessa fält till LogRecord:ens nativa trace_id/span_id-platser, så att klick på en span i spårningsvyn hoppar till dess loggar i OneUptime — och klick på en loggrad hoppar till dess överordnade spår.
- För **icke-JSON-loggar**: raden bevaras oförändrad — fortfarande insamlad, bara inte automatiskt länkad.

| Alternativ | Standard | Beskrivning |
| --- | --- | --- |
| `ebpf.logToTraceCorrelation` | på | Aktivera OBI:s logganrikare och filelog-pipelinens trace_id-lyft. Sätt till `false` för att hoppa över båda. |

Varningar:

- **Loggar måste vara JSON för att trace_id ska visas.** Byt din logger till en JSON-formatterare — `structlog`, `pino`, `winston`, `serilog`, `logback-json`, klog `--logging-format=json`, etc.
- **Buffrad stdout bryter korrelationen** eftersom `write()`-syscall:et avfyras på en annan tråd än den som hanterade förfrågan. Vanliga lösningar:
  - **Python**: sätt `PYTHONUNBUFFERED=1` (runtime-miljön blockbuffrar stdout när det inte är en TTY).
  - **.NET**: vid uppstart, `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`. Microsoft.Extensions.Logging `AddConsole()` och Serilogs asynkrona sinks fungerar inte heller — byt till en synkron konsolskrivare (Serilogs standard `WriteTo.Console()` fungerar).
- Greenlet/gevent, Tornado och andra anpassade asynkrona runtimes täcks inte.

### Trimning

| Alternativ | Standard | Beskrivning |
| --- | --- | --- |
| `ebpf.enabled` | `true` | Huvudbrytare. Sätt till `false` för att hoppa över eBPF-DaemonSet:en helt. |
| `ebpf.image.tag` | `v0.9.0` | OBI-avbildningstagg. OBI är pre-1.0; lås till en känd fungerande version och testa om vid uppgraderingar. |
| `ebpf.autoTargetExe` | `*` | Glob över körbara filer att instrumentera. Snäva in detta (t.ex. `*/python,*/java`) om du vill begränsa autoinstrumentering. |
| `ebpf.excludeExePaths` | (shells, kubelet, runc, containerd, otelcol, OBI själv) | Kommaseparerade globs att hoppa över. |
| `ebpf.logLevel` | `info` | `debug`, `info`, `warn` eller `error`. Sätt till `debug` vid felsökning. |
| `ebpf.printTraces` | `false` | Skriv spans till OBI:s stdout utöver OTLP-export — användbart för att verifiera insamling under installation. |
| `ebpf.resources.*` | `100m / 256Mi` requests, `1000m / 1Gi` limits | Höj för kluster med hög trafik. |

Kontrollera att OBI kör och ser trafik:

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## Kontinuerlig CPU-profilering (av som standard)

En separat DaemonSet kör [OpenTelemetry eBPF Profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) — paketerad som avbildningen `otel/opentelemetry-collector-ebpf-profiler`. Den samplar stackar på CPU vid 19 Hz för varje stödd runtime (Go, Java, .NET, Python, Ruby, Node.js, PHP, Perl, C/C++, Rust) och skickar OTLP-profiler till OneUptime, där de visas under **Telemetry → Performance Profiles** och som flame graphs länkade från enskilda spår-spans.

Profilering är **av som standard** — den är tyngre än OBI-autoinstrumenteringen (mer CPU per nod, större minnesavtryck) och alla kluster vill inte ha alltid-på flame graphs. Aktivera den när du vill ha rikare telemetri: `--set profiling.enabled=true`.

När eBPF-autoinstrumentering också är på (`ebpf.enabled: true`, standard) korreleras varje CPU-sampel med OBI:s spårningskontext via en delad bpffs-map — så flame graphs bär trace_id/span_id och OneUptime-gränssnittet kan visa dig en flame graph per span.

Krav:

- **Linux-kärna 5.10+** (något nyare än 5.8 som OBI behöver).
- Privilegierad pod med hostPID — samma begränsningar som eBPF-autoinstrumenterings-DaemonSet:en. Kan inte köras på GKE Autopilot, EKS Fargate eller andra låsta miljöer.

Trimning:

| Alternativ | Standard | Beskrivning |
| --- | --- | --- |
| `profiling.enabled` | `false` | Huvudbrytare. Av som standard; välj till för kontinuerliga CPU-flame graphs. |
| `profiling.image.tag` | `0.152.0` | Avbildningstagg för `otel/opentelemetry-collector-ebpf-profiler`. Profileraren är pre-1.0; lås till en känd fungerande version. |
| `profiling.samplesPerSecond` | `19` | Samplingsfrekvens i Hz. Uppströms standardvärde; undviker oavsiktlig aliasing med vanliga timerfrekvenser. |
| `profiling.offCpuThreshold` | `0` | (0–1] aktiverar off-CPU-profilering — diagnostiserar låskonflikter och blockerande I/O. Av som standard eftersom det lägger till tracepoint-overhead. |
| `profiling.tracers` | `""` *(alla runtimes)* | Kommaseparerad lista över språkspårare att ladda. |
| `profiling.obiProcessContext` | `true` | Korrelera sampel med OBI:s spårningskontext för spår ↔ profil-länkning. |

## Annan datainsamling (host-mätvärden, audit-loggar, CSI, CoreDNS)

Diagrammet kan också samla in:

| `<key>.enabled` | Standard | Vad det tillför |
| --- | --- | --- |
| `hostMetrics` | på | Per-nod OS-mätvärden från `/proc` och `/sys` — disk-I/O-ködjup, användning av filsystemsinoder, NIC-felräknare, paging-statistik, lastsnitt. Bor inuti log-collector-DaemonSet:en (inga extra poddar). |
| `auditLogs` | av | Läs `/var/log/kubernetes/audit.log` från värden. Fångar varje Kubernetes API-förfrågan — vem som gjorde vad mot vilken resurs. Enbart självhanterade kluster — hanterade K8s (EKS, GKE, AKS, DOKS) skickar audit-loggar till molnleverantörens sink. |
| `csi` | av | Upptäcker automatiskt poddar märkta `app=csi-driver` (eller `app.kubernetes.io/component=csi-driver`) och skrapar deras Prometheus `metrics`-port — latens för volymanslutning/frånkoppling, provisioneringsfel, IOPS. |
| `coreDns` | av | Skrapar klustrets CoreDNS-tjänst på `:9153/metrics`. Synliggör frågefrekvens, latens, cache-träffrekvens, antal fel — vanliga skyldiga till P99-latens. |

## Vanliga alternativ

| Alternativ | Standard | Beskrivning |
| --- | --- | --- |
| `preset` | (tom — behandlas som `standard`) | Se tabellen ovan. |
| `oneuptime.url` | *(krävs)* | URL till din OneUptime-instans. |
| `oneuptime.apiKey` | *(krävs)* | Projekt-API-nyckel (Settings → API Keys). |
| `clusterName` | *(krävs)* | Unikt namn för detta kluster. Stämplas som `k8s.cluster.name` på varje post. |
| `namespaceFilters.include` | `[]` | Om angivet övervakas endast dessa namespaces. |
| `namespaceFilters.exclude` | `["kube-system"]` | Namespaces att hoppa över. |
| `logs.enabled` | `true` | Aktivera eller inaktivera logginsamling. |
| `logs.mode` | (härlett från `preset`) | `daemonset`, `api` eller `disabled`. Åsidosätter förinställningen. |
| `logs.api.replicas` | `1` | Antal repliker av log-tailer-Deployment (endast i API-läge). |
| `ebpf.enabled` | `true` | Autoinsamla HTTP/gRPC-spårningar från varje pod via OpenTelemetry eBPF Instrumentation. Se sektionen ovan. |
| `profiling.enabled` | `false` | Kontinuerliga CPU-flame graphs via OpenTelemetry eBPF Profiler. Av som standard; välj till för mer telemetri. Se sektionen ovan. |
| `hostMetrics.enabled` | `true` | Per-nod OS-mätvärden. |
| `auditLogs.enabled` | `false` | Insamling av Kubernetes audit-loggar (självhanterade kluster). |
| `csi.enabled` | `false` | Prometheus-mätvärden från CSI-drivrutin. |
| `coreDns.enabled` | `false` | Prometheus-mätvärden från CoreDNS. |
| `controlPlane.enabled` | `false` | Skrapa etcd / api-server / scheduler / controller-manager. Enbart självhanterade kluster — hanterade erbjudanden (EKS/GKE/AKS) exponerar vanligtvis inte dessa endpoints. |

Se [diagrammets `values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) för den fullständiga listan.

## Uppgradering

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` behåller din befintliga konfiguration; lägg till nya `--set`-överskridanden ovanpå den.

> **Observera: `--reuse-values` slår inte ihop nya standardvärden från diagrammet.** Helm återanvänder dina tidigare renderade värden ordagrant — så varje nytt fält på toppnivå som lagts till i en nyare diagramversion (t.ex. `profiling.*`, `ebpf.features.*`) förblir osatt på din befintliga release och mallen renderas som om du hade inaktiverat det.
>
> **Helm 3.14+** — växla till `--reset-then-reuse-values`. Det läser om diagrammets standardvärden för nycklar du inte har åsidosatt:
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 eller tidigare** — släpp `--reuse-values` och skicka dina ursprungliga `--set`-flaggor (eller `-f values.yaml`) explicit. Nya diagramstandardvärden tillämpas för allt du inte åsidosätter.
>
> Om en ny funktions poddar (t.ex. `kubernetes-agent-profiling-*`) inte dyker upp efter uppgradering är detta nästan alltid orsaken. `helm get values <release>` visar vad Helm faktiskt har — fält som saknas från utdata betyder att standardvärden inte slogs ihop för dem.

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

Kontrollera agentpoddarna:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

I API-läge exponerar log-tailer-podden `/healthz` på port 13133 — nå den via `kubectl port-forward` för en ögonblicksbild av exportstatus.

### eBPF-DaemonSet-podden är `CrashLoopBackOff` eller misslyckas med att starta

Kontrollera OBI-poddens loggar:

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

Vanliga orsaker:

- **För gammal kärna eller saknad BTF.** OBI behöver Linux 5.8+ med BTF. Kontrollera med `uname -r` på en nod. Om du inte kan uppgradera, inaktivera eBPF: `--set ebpf.enabled=false`.
- **Privilegierade poddar är blockerade.** Vissa kluster avvisar privilegierade poddar även utanför Autopilot/Fargate. Inaktivera eBPF.
- **Inga spårningar i dashboarden men OBI kör.** Sätt `--set ebpf.printTraces=true` och kontrollera OBI:s stdout — om du ser spans där är problemet OTLP-leverans (kontrollera `OTEL_EXPORTER_OTLP_ENDPOINT` och din OneUptime URL/API-nyckel). Om du inte ser spans kan trafiken OBI bevakar vara helt krypterad av ett TLS-bibliotek som OBI inte kan avlyssna (t.ex. en statiskt länkad TLS-implementation som det inte känner igen).

### Mitt kluster har för många poddar för en log-tailer-replika (endast API-läge)

Skala horisontellt genom att sharda namespaces. Installera en gång per namespace-grupp:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Alternativt kan du höja `logs.api.replicas` — men observera att varje replika bearbetar alla tillåtna namespaces, så för deduplicering behöver du fortfarande namespace-shardning.
