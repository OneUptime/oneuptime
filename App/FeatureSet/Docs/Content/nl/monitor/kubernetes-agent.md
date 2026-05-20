# De Kubernetes-agent installeren

De OneUptime Kubernetes-agent verzamelt cluster-metrics, events, pod-logboeken, **applicatie-traces (HTTP/gRPC via eBPF)** en **OS-niveau node-metrics** van uw Kubernetes-cluster en stuurt deze naar OneUptime. Hij wordt gedistribueerd als een Helm-chart en geïnstalleerd met één commando — eBPF auto-instrumentatie staat standaard aan, zodat u service-niveau traces en RED-metrics ziet zonder codewijzigingen. **Continue CPU-flame graphs (eBPF-profiler)** zijn ook beschikbaar — schakel ze in met `--set profiling.enabled=true` wanneer u meer telemetrie wilt.

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

Als u het niet zeker weet, laat `preset` dan ongezet — u krijgt de `standard`-standaardwaarden. Als uw cluster de installatie afwijst met een Pod Security-fout die `hostPath` vermeldt, schakel dan over naar `gke-autopilot` (of `eks-fargate` op EKS Fargate) en installeer opnieuw.

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

## Hoe de twee log-verzamelmodi verschillen

Onder de motorkap stelt `preset` `logs.mode` in — en u kunt dit ook direct instellen als u de standaard van de preset moet overschrijven.

### DaemonSet-modus (`logs.mode: daemonset`)

Een DaemonSet draait één OpenTelemetry Collector-pod per node. Hij leest logbestanden onder `/var/log/pods/` via een hostPath-volume en stuurt deze door via OTLP.

- **Voordelen:** laagste overhead, schaalt lineair met nodes, geen belasting voor de Kubernetes API-server, verwerkt logrotatie.
- **Nadelen:** vereist hostPath, vereist de mogelijkheid om DaemonSets te plannen — beide niet beschikbaar op GKE Autopilot en EKS Fargate.

### API-modus (`logs.mode: api`)

Een Deployment met één replica (de `oneuptime/kubernetes-log-tailer`-image) gebruikt de Kubernetes API om container-logboeken te streamen — hetzelfde endpoint dat `kubectl logs -f` gebruikt. Geen hostPath, geen host-toegang, geen DaemonSet.

- **Voordelen:** werkt op GKE Autopilot, EKS Fargate en elk cluster dat hostPath blokkeert of de `restricted` Pod Security Standard afdwingt.
- **Nadelen:** elke containerstream is een langlevende verbinding naar `kube-apiserver`. In de praktijk verwerkt één replica enkele duizenden containers comfortabel. Voor zeer grote clusters: shard op namespace met behulp van `logs.api.replicas` plus `namespaceFilters.include` op elke replica.

### Welke moet u gebruiken?

Als hostPath werkt, gebruik DaemonSet. Overal anders, gebruik API-modus. De `preset`-instelling kiest de juiste voor u.

U kunt logboekverzameling ook volledig uitschakelen met `--set logs.enabled=false` en applicatielogboeken in plaats daarvan via OpenTelemetry SDKs versturen. Zie de [OpenTelemetry](/docs/telemetry/open-telemetry)-documentatie.

## Applicatie-traces & HTTP-verzoeken via eBPF (standaard aan)

De chart levert een DaemonSet die [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) draait op elke node. OBI laadt eBPF-programma's in de Linux-kernel en bekijkt verkeer op socket-niveau om HTTP/HTTPS-, gRPC- en SQL/Redis-aanroepen vanuit elke pod op de node te reconstrueren — geen codewijzigingen, geen SDK, geen sidecar. Vastgelegd verkeer wordt geëxporteerd als OTLP-traces en verzoek-/latentie-metrics rechtstreeks naar OneUptime.

Na installatie verschijnen uw services binnen een minuut of twee onder **Telemetry → Traces** en op de service-kaart, met `k8s.cluster.name` ingesteld op uw `clusterName` zodat u kunt filteren per cluster.

### Wanneer uitschakelen

eBPF is **standaard ingeschakeld**. U moet het uitschakelen (`--set ebpf.enabled=false`) als:

- U installeert op **GKE Autopilot** of **EKS Fargate**. Deze platformen blokkeren privileged pods, en OBI heeft privileged-modus nodig om eBPF-programma's te laden.
- Uw nodes een kernel draaien ouder dan **Linux 5.8** zonder BTF-backports. (Moderne distributies — Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+ — zijn in orde.)
- U al traces verstuurt via de OpenTelemetry SDK vanuit uw apps en geen duplicaten wilt.

### Wat er wordt verzonden

OBI extraheert verschillende signaal-families uit het vastgelegde verkeer. Alle staan standaard aan; elk kan onafhankelijk worden uitgeschakeld met `--set ebpf.features.<key>=false`:

| Signaal | Standaard | Wat het toevoegt |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | aan | HTTP/gRPC RED-metrics — verzoekfrequentie, latentie-histogrammen, fouttellingen — per service. |
| `ebpf.features.spanMetrics` | aan | Op span-attribuut gesleutelde metrics: verzoekgrootte, antwoordgrootte, duur opgesplitst per route/operatie. |
| `ebpf.features.serviceGraph` | aan | Service-naar-service edge-metrics (aanroeper → aangeroepene verzoekfrequentie + latentie). Voedt de service-kaart. |
| `ebpf.features.hostMetrics` | aan | CPU en geheugen per geïnstrumenteerd proces — bespaart het draaien van een aparte profiler voor basale capaciteitsvragen. |
| `ebpf.features.networkMetrics` | aan | Pod-naar-pod TCP/UDP-flow byte- en packet-tellers met k8s-metadata. Toont elk paar pods dat communiceert, inclusief die welke protocollen draaien die OBI niet kan parsen. |
| `ebpf.features.networkInterZoneMetrics` | uit | Inter-zone variant van netwerkmetrics. Verdubbelt cardinaliteit; alleen de moeite waard om in te schakelen als u daadwerkelijk zone-gebaseerde scheduling gebruikt. |
| `ebpf.features.tcpStats` | aan | TCP-statistieken op nodeniveau: RTT-histogrammen, tellingen van mislukte verbindingen, retransmissies. |

OBI propageert standaard ook trace-context over service-grenzen heen. Wanneer pod A een HTTP/gRPC-verzoek doet aan pod B, injecteert OBI een W3C `traceparent`-header in het uitgaande verzoek — zodat de resulterende span aan de zijde van pod B koppelt aan dezelfde trace als de uitgaande van pod A. Geen SDK-wijzigingen nodig in beide apps.

| Optie | Standaard | Beschrijving |
| --- | --- | --- |
| `ebpf.contextPropagation` | aan | Injecteer W3C `traceparent` in uitgaand verkeer (HTTP-headers + aangepaste TCP-optie). Stel in op `false` om de spans van elke service lokaal te houden. |
| `ebpf.trackRequestHeaders` | aan | Verzoek-header-tracking aan kernel-zijde, zodat propagatie ook werkt op plain HTTP-servers (non-Go, non-TLS). Heeft alleen effect wanneer `contextPropagation` true is. |

### Log ↔ trace-correlatie

Ook standaard aan. OBI's log-enricher onderschept pod-stdout-writes vanuit geïnstrumenteerde processen en:

- Voor **JSON-formaat logboeken**: injecteert `trace_id`- en `span_id`-velden in de regel (bestaande waarden in het logboek worden behouden). De filelog-DaemonSet tilt die velden vervolgens op naar de native trace_id/span_id-slots van het LogRecord, zodat het klikken op een span in de trace-weergave naar zijn logboeken springt in OneUptime — en het klikken op een logregel naar zijn bovenliggende trace springt.
- Voor **niet-JSON-logboeken**: de regel blijft onveranderd — nog steeds verzameld, alleen niet automatisch gekoppeld.

| Optie | Standaard | Beschrijving |
| --- | --- | --- |
| `ebpf.logToTraceCorrelation` | aan | Schakel de OBI log-enricher en de trace_id-lift van de filelog-pipeline in. Stel in op `false` om beide over te slaan. |

Voorbehouden:

- **Logboeken moeten JSON zijn om trace_id te laten verschijnen.** Schakel uw logger over naar een JSON-formatter — `structlog`, `pino`, `winston`, `serilog`, `logback-json`, klog `--logging-format=json`, enz.
- **Gebufferde stdout breekt de correlatie** omdat de `write()`-syscall op een andere thread afgaat dan degene die het verzoek afhandelde. Veelvoorkomende oplossingen:
  - **Python**: stel `PYTHONUNBUFFERED=1` in (de runtime blok-buffert stdout wanneer het geen TTY is).
  - **.NET**: bij opstart, `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`. Microsoft.Extensions.Logging `AddConsole()` en Serilogs async-sinks werken ook niet — schakel over naar een synchrone console-writer (de standaard `WriteTo.Console()` van Serilog is prima).
- Greenlet / gevent, Tornado en andere aangepaste async-runtimes worden niet ondersteund.

### Afstemming

| Optie | Standaard | Beschrijving |
| --- | --- | --- |
| `ebpf.enabled` | `true` | Hoofdschakelaar. Stel in op `false` om de eBPF-DaemonSet volledig over te slaan. |
| `ebpf.image.tag` | `v0.9.0` | OBI-image-tag. OBI is pre-1.0; pin op een bekende werkende versie en hertest bij upgrades. |
| `ebpf.autoTargetExe` | `*` | Glob van uitvoerbare bestanden om te instrumenteren. Versmal dit (bijv. `*/python,*/java`) als u auto-instrumentatie wilt afbakenen. |
| `ebpf.excludeExePaths` | (shells, kubelet, runc, containerd, otelcol, OBI zelf) | Door komma's gescheiden globs om over te slaan. |
| `ebpf.logLevel` | `info` | `debug`, `info`, `warn` of `error`. Stel in op `debug` tijdens probleemoplossing. |
| `ebpf.printTraces` | `false` | Druk spans af naar OBI's stdout naast OTLP-export — nuttig voor het verifiëren van capture tijdens installatie. |
| `ebpf.resources.*` | `100m / 256Mi` requests, `1000m / 1Gi` limits | Verhoog voor clusters met veel verkeer. |

Om te controleren of OBI draait en verkeer ziet:

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## Continue CPU-profilering (standaard uit)

Een aparte DaemonSet draait de [OpenTelemetry eBPF Profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) — verpakt als de `otel/opentelemetry-collector-ebpf-profiler`-image. Hij bemonstert on-CPU-stacks op 19Hz over elke ondersteunde runtime (Go, Java, .NET, Python, Ruby, Node.js, PHP, Perl, C/C++, Rust) en stuurt OTLP-profielen naar OneUptime, waar ze verschijnen onder **Telemetry → Performance Profiles** en als flame graphs gekoppeld aan individuele trace-spans.

Profilering staat **standaard uit** — het is zwaarder dan de OBI auto-instrumentatie (meer CPU per node, grotere geheugen-footprint) en niet elk cluster wil altijd-aan flame graphs. Schakel het in wanneer u rijkere telemetrie wilt: `--set profiling.enabled=true`.

Wanneer eBPF auto-instrumentatie ook aan staat (`ebpf.enabled: true`, de standaard), wordt elke CPU-sample gecorreleerd met OBI's trace-context via een gedeelde bpffs-map — zodat flame graphs trace_id/span_id meedragen en de OneUptime-UI u een flame graph per span kan tonen.

Vereisten:

- **Linux-kernel 5.10+** (iets nieuwer dan de 5.8 die OBI nodig heeft).
- Privileged pod met hostPID — dezelfde beperkingen als de eBPF auto-instrumentatie-DaemonSet. Kan niet draaien op GKE Autopilot, EKS Fargate of andere afgeschermde omgevingen.

Afstemming:

| Optie | Standaard | Beschrijving |
| --- | --- | --- |
| `profiling.enabled` | `false` | Hoofdschakelaar. Standaard uit; schakel in voor continue CPU-flame graphs. |
| `profiling.image.tag` | `0.152.0` | `otel/opentelemetry-collector-ebpf-profiler`-image-tag. De profiler is pre-1.0; pin op een bekende werkende versie. |
| `profiling.samplesPerSecond` | `19` | Bemonsteringsfrequentie in Hz. Upstream-standaard; voorkomt het per ongeluk aliasen met veelvoorkomende timer-frequenties. |
| `profiling.offCpuThreshold` | `0` | (0–1] schakelt off-CPU-profilering in — diagnosticeert lock-contention en blokkerende I/O. Standaard uit omdat het tracepoint-overhead toevoegt. |
| `profiling.tracers` | `""` *(alle runtimes)* | Door komma's gescheiden lijst van taaltracers om te laden. |
| `profiling.obiProcessContext` | `true` | Correleer samples met OBI's trace-context voor trace ↔ profile-koppeling. |

## Overige dataverzameling (host-metrics, saturatie, cAdvisor, KSM, audit-logboeken, CSI, CoreDNS)

De chart kan ook verzamelen:

| `<key>.enabled` | Standaard | Wat het toevoegt |
| --- | --- | --- |
| `hostMetrics` | aan | OS-metrics per node uit `/proc` en `/sys` — schijf-I/O-wachtrijdiepte, gebruik van bestandssysteem-inodes, NIC-fouttellers, paging-statistieken, load average. Bevindt zich in de log-collector-DaemonSet (geen extra pods). |
| `kubeletstats.utilizationMetrics` | aan | Saturatie-metrics — container- & pod-CPU/geheugen uitgedrukt als percentage van request en limit. Acht afgeleide metric-families die de "CPU/Memory vs Request"- en "CPU/Memory vs Limit"-monitors voeden. Dezelfde scrape als de bestaande `kubeletstats`-receiver, geen extra pods. Altijd 0 wanneer een pod geen request/limit ingesteld heeft. |
| `kubeletstats.volumeMetrics` | aan | Schijfgebruik per PVC (`k8s.volume.available`, `k8s.volume.capacity`). Voedt de "PVC Low Disk Space"-monitor. Eén reeks per PVC per pod — begrensd voor de meeste clusters, zwaarder bij stateful workloads met duizenden PVC's. |
| `cadvisor` | aan | Scrapet het `/metrics/cadvisor`-endpoint van de kubelet vanuit de DaemonSet-pod van elke node voor de container-metrics die `kubeletstats` niet vertaalt: CFS-throttling (`container_cpu_cfs_throttled_seconds_total`, `container_cpu_cfs_periods_total`) en OOM kill-events (`container_oom_events_total`). Een relabel-allowlist dropt al het overige bij de receiver, zodat cardinaliteit begrensd blijft. |
| `kubeStateMetrics` | uit | Haalt cluster-state-metrics op uit kube-state-metrics: pod-fases (Pending / Terminating), container-waiting-redenen (CrashLoopBackOff, ImagePullBackOff) en gebruik van resource quota. `mode: bundled` (standaard) deployt een kleine KSM-Deployment voor u; `mode: external` scrapet een bestaande KSM via `endpoint`. Standaard uit omdat de bundled-modus een Deployment toevoegt aan de footprint van de chart. |
| `auditLogs` | uit | Lees `/var/log/kubernetes/audit.log` vanaf de host. Legt elk Kubernetes API-verzoek vast — wie wat met welke resource deed. Alleen zelf-beheerde clusters — beheerde K8s (EKS, GKE, AKS, DOKS) routeren audit-logboeken naar de sink van de cloudprovider. |
| `csi` | uit | Detecteert automatisch pods gelabeld `app=csi-driver` (of `app.kubernetes.io/component=csi-driver`) en scrapet hun Prometheus `metrics`-poort — volume attach/detach-latentie, provisioning-fouten, IOPS. |
| `coreDns` | uit | Scrapet de cluster-CoreDNS-service op `:9153/metrics`. Toont query-frequentie, latentie, cache-hitrate, fouttellingen — veelvoorkomende oorzaken van P99-latentie. |

## Veelgebruikte opties

| Optie | Standaard | Beschrijving |
| --- | --- | --- |
| `preset` | (leeg — behandeld als `standard`) | Zie de tabel hierboven. |
| `oneuptime.url` | *(vereist)* | URL van uw OneUptime-instantie. |
| `oneuptime.apiKey` | *(vereist)* | Project-API-sleutel (Settings → API Keys). |
| `clusterName` | *(vereist)* | Unieke naam voor dit cluster. Wordt gestempeld als `k8s.cluster.name` op elk record. |
| `namespaceFilters.include` | `[]` | Indien ingesteld, worden alleen deze namespaces gemonitord. |
| `namespaceFilters.exclude` | `["kube-system"]` | Namespaces om over te slaan. |
| `logs.enabled` | `true` | Schakel logboekverzameling aan of uit. |
| `logs.mode` | (afgeleid van `preset`) | `daemonset`, `api` of `disabled`. Overschrijft de preset. |
| `logs.api.replicas` | `1` | Aantal replicas van de log-tailer-Deployment (alleen in API-modus). |
| `ebpf.enabled` | `true` | Leg automatisch HTTP/gRPC-traces vast vanuit elke pod via OpenTelemetry eBPF Instrumentation. Zie de sectie hierboven. |
| `profiling.enabled` | `false` | Continue CPU-flame graphs via de OpenTelemetry eBPF Profiler. Standaard uit; schakel in voor meer telemetrie. Zie de sectie hierboven. |
| `hostMetrics.enabled` | `true` | OS-metrics per node. |
| `kubeletstats.utilizationMetrics.enabled` | `true` | Container- & pod-CPU/geheugen-saturatie (% van request en limit). Geen extra scrape — afgeleid van kubeletstats-data. |
| `kubeletstats.volumeMetrics.enabled` | `true` | Schijfgebruik per PVC (`k8s.volume.available`, `k8s.volume.capacity`). |
| `cadvisor.enabled` | `true` | Scrape de kubelet `/metrics/cadvisor` van deze node voor CFS-throttling- + OOM-kill-tellers. Allowlisted op 3 metrics. |
| `kubeStateMetrics.enabled` | `false` | Haal pod-fases, container-waiting-redenen (CrashLoopBackOff / ImagePullBackOff) en ResourceQuota-gebruik op uit kube-state-metrics. Zie `kubeStateMetrics.mode` voor bundled vs external. |
| `auditLogs.enabled` | `false` | Verzameling van Kubernetes audit-logboeken (zelf-beheerde clusters). |
| `csi.enabled` | `false` | Prometheus-metrics van CSI-driver. |
| `coreDns.enabled` | `false` | Prometheus-metrics van CoreDNS. |
| `controlPlane.enabled` | `false` | Scrape etcd / api-server / scheduler / controller-manager. Alleen zelf-beheerde clusters — beheerde aanbiedingen (EKS/GKE/AKS) stellen deze endpoints doorgaans niet bloot. |

Zie de [`values.yaml` van de chart](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) voor de volledige lijst.

## Upgraden

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` behoudt uw bestaande configuratie; geef nieuwe `--set`-overrides daarbovenop door.

> **Let op: `--reuse-values` voegt geen nieuwe standaardwaarden uit de chart samen.** Helm hergebruikt uw eerder gerenderde waarden letterlijk — dus elk nieuw top-level veld dat is toegevoegd in een nieuwere chart-versie (bijv. `profiling.*`, `ebpf.features.*`) blijft ongezet op uw bestaande release en de template rendert alsof u het had uitgeschakeld.
>
> **Helm 3.14+** — schakel over naar `--reset-then-reuse-values`. Het leest de chart-standaarden opnieuw voor sleutels die u niet heeft overschreven:
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 of eerder** — laat `--reuse-values` weg en geef uw originele `--set`-vlaggen (of `-f values.yaml`) expliciet door. Nieuwe chart-standaarden zullen worden toegepast voor alles wat u niet overschrijft.
>
> Als de pods van een nieuwe functie (bijv. `kubernetes-agent-profiling-*`) niet verschijnen na het upgraden, is dit bijna altijd de reden. `helm get values <release>` toont wat Helm daadwerkelijk heeft — velden die ontbreken in de output betekenen dat standaarden niet zijn samengevoegd.

## Deïnstalleren

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
  --set preset=gke-autopilot   # or eks-fargate
```

### Er verschijnen geen logboeken in OneUptime

Controleer de agent-pods:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

In API-modus exposeert de log-tailer-pod `/healthz` op poort 13133 — benader het via `kubectl port-forward` voor een momentopname van de exportstatus.

### De eBPF-DaemonSet-pod is `CrashLoopBackOff` of start niet

Controleer de OBI-pod-logboeken:

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

Veelvoorkomende oorzaken:

- **Kernel te oud of BTF ontbreekt.** OBI heeft Linux 5.8+ met BTF nodig. Controleer met `uname -r` op een node. Als u niet kunt upgraden, schakel eBPF uit: `--set ebpf.enabled=false`.
- **Privileged pods zijn geblokkeerd.** Sommige clusters weigeren privileged pods zelfs buiten Autopilot/Fargate. Schakel eBPF uit.
- **Geen traces in het dashboard maar OBI draait.** Stel `--set ebpf.printTraces=true` in en controleer OBI's stdout — als u daar spans ziet, is het probleem OTLP-levering (controleer de `OTEL_EXPORTER_OTLP_ENDPOINT` en uw OneUptime-URL/API-sleutel). Als u geen spans ziet, is het verkeer dat OBI bekijkt mogelijk volledig versleuteld door een TLS-bibliotheek die OBI niet kan onderscheppen (bijv. een statisch gelinkte TLS-implementatie die het niet herkent).

### Mijn cluster heeft te veel pods voor één log-tailer-replica (alleen API-modus)

Schaal horizontaal door namespaces te sharden. Deploy één keer per namespace-groep:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Verhoog als alternatief `logs.api.replicas` — maar let op dat elke replica alle toegestane namespaces verwerkt, dus voor deduplicatie heeft u nog steeds namespace-sharding nodig.
