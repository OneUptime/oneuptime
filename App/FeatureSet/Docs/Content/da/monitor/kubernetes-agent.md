# Installér Kubernetes-agenten

OneUptime Kubernetes-agenten indsamler klyngemetrikker, hændelser, pod-logs, **applikations-traces (HTTP/gRPC via eBPF)** og **OS-niveau-nodemetrikker** fra din Kubernetes-klynge og sender dem til OneUptime. Den distribueres som et Helm chart og installeres med en enkelt kommando — eBPF auto-instrumentering er aktiveret som standard, så du ser service-niveau-traces og RED-metrikker uden kodeændringer. **Kontinuerlige CPU-flammegrafer (eBPF-profiler)** er også tilgængelige — tilvælg dem med `--set profiling.enabled=true`, når du vil have mere telemetri.

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

Din klynge vil dukke op i OneUptime inden for få minutter.

## Vælg den rette preset til din klynge

Forskellige Kubernetes-distributioner har forskellige begrænsninger — mest bemærkelsesværdigt, om arbejdsbelastninger kan montere `hostPath`-volumener. I stedet for at få dig til at læse sikkerhedsdokumentation eksponerer charten en enkelt øverste indstilling: `preset`.

| Preset | Anvendelse | Logindsamling | Bemærkninger |
| --- | --- | --- | --- |
| `standard` (standard) | Selvadministreret, **EKS på EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet, der læser `/var/log/pods` via hostPath | Laveste overhead. hostPath er tilgængelig på disse platforme. |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API tailer (Deployment) | hostPath er blokeret på Autopilot. Sætter en hærdet sikkerhedskontekst, der består Autopilots Pod Security Standards. |
| `eks-fargate` | **EKS Fargate** | Kubernetes API tailer (Deployment) | Samme som `gke-autopilot`. Fargate blokerer hostPath og DaemonSets. |

Hvis du er i tvivl, så lad `preset` være uindstillet — du får `standard`-standardværdierne. Hvis din klynge afviser installationen med en Pod Security-fejl, der nævner `hostPath`, så skift til `gke-autopilot` (eller `eks-fargate` på EKS Fargate) og geninstallér.

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

## Hvordan de to logindsamlingstilstande adskiller sig

Under motorhjelmen sætter `preset` værdien `logs.mode` — og du kan også sætte den direkte, hvis du har brug for at tilsidesætte preset-standardværdien.

### DaemonSet-tilstand (`logs.mode: daemonset`)

En DaemonSet kører én OpenTelemetry Collector-pod pr. node. Den læser logfiler under `/var/log/pods/` via en hostPath-volumen og videresender dem over OTLP.

- **Fordele:** laveste overhead, skalerer lineært med noder, ingen belastning på Kubernetes API-serveren, håndterer logrotation.
- **Ulemper:** kræver hostPath, kræver evnen til at planlægge DaemonSets — begge utilgængelige på GKE Autopilot og EKS Fargate.

### API-tilstand (`logs.mode: api`)

En Deployment med én replika (`oneuptime/kubernetes-log-tailer`-imaget) bruger Kubernetes API'en til at streame container-logs — det samme endpoint, som `kubectl logs -f` bruger. Ingen hostPath, ingen værtsadgang, ingen DaemonSet.

- **Fordele:** virker på GKE Autopilot, EKS Fargate og enhver klynge, der blokerer hostPath eller håndhæver `restricted` Pod Security Standard.
- **Ulemper:** hver container-stream er en langvarig forbindelse til `kube-apiserver`. I praksis håndterer én replika et par tusinde containere komfortabelt. For meget store klynger, shard pr. namespace ved at bruge `logs.api.replicas` plus `namespaceFilters.include` på hver replika.

### Hvilken bør du bruge?

Hvis hostPath virker, brug DaemonSet. Overalt andre steder, brug API-tilstand. `preset`-indstillingen vælger den rigtige for dig.

Du kan også deaktivere logindsamling fuldstændigt med `--set logs.enabled=false` og i stedet sende applikationslogs via OpenTelemetry SDK'er. Se [OpenTelemetry](/docs/telemetry/open-telemetry)-dokumentationen.

## Applikations-traces og HTTP-anmodninger via eBPF (aktiveret som standard)

Charten leverer en DaemonSet, der kører [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) på hver node. OBI indlæser eBPF-programmer i Linux-kernen og overvåger socket-niveau-trafik for at rekonstruere HTTP/HTTPS-, gRPC- og SQL/Redis-kald fra hver pod på noden — ingen kodeændringer, ingen SDK, ingen sidecar. Indfanget trafik eksporteres som OTLP-traces og anmodnings-/latensmetrikker direkte til OneUptime.

Efter installation begynder dine services at dukke op under **Telemetry → Traces** og servicekortet inden for et minut eller to, med `k8s.cluster.name` sat til dit `clusterName`, så du kan filtrere efter klynge.

### Hvornår skal det slås fra

eBPF er **aktiveret som standard**. Du bør deaktivere det (`--set ebpf.enabled=false`), hvis:

- Du installerer på **GKE Autopilot** eller **EKS Fargate**. Disse platforme blokerer privilegerede pods, og OBI har brug for privilegeret tilstand for at indlæse eBPF-programmer.
- Dine noder kører en kerne ældre end **Linux 5.8** uden BTF-backports. (Moderne distributioner — Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+ — er fine.)
- Du sender allerede traces via OpenTelemetry SDK fra dine apps og vil ikke have dubletter.

### Hvad bliver udsendt

OBI udtrækker flere signalfamilier fra den indfangede trafik. Alle er aktiveret som standard; hver kan deaktiveres uafhængigt med `--set ebpf.features.<key>=false`:

| Signal | Standard | Hvad det tilføjer |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | on | HTTP/gRPC RED-metrikker — anmodningsrate, latens-histogrammer, fejltællinger — pr. service. |
| `ebpf.features.spanMetrics` | on | Span-attribut-baserede metrikker: anmodningsstørrelse, svarstørrelse, varighed opdelt pr. rute/operation. |
| `ebpf.features.serviceGraph` | on | Service-til-service kantmetrikker (kalder → kaldte anmodningsrate + latens). Driver servicekortet. |
| `ebpf.features.hostMetrics` | on | CPU og hukommelse pr. instrumenteret proces — sparer at køre en separat profiler til grundlæggende kapacitetsspørgsmål. |
| `ebpf.features.networkMetrics` | on | Pod-til-pod TCP/UDP-flow byte- og pakketællere med k8s-metadata. Synliggør hvert par af pods, der taler sammen, inklusive dem, der kører protokoller, OBI ikke kan parse. |
| `ebpf.features.networkInterZoneMetrics` | off | Inter-zone-variant af netværksmetrikker. Fordobler kardinalitet; kun værd at aktivere, hvis du faktisk bruger zone-baseret planlægning. |
| `ebpf.features.tcpStats` | on | Node-niveau TCP-statistik: RTT-histogrammer, fejlede forbindelsestællinger, retransmissioner. |

OBI udbreder også trace-kontekst på tværs af servicegrænser som standard. Når pod A foretager en HTTP/gRPC-anmodning til pod B, injicerer OBI en W3C `traceparent`-header i den udgående anmodning — så det resulterende span på pod B's side linker ind i det samme trace som pod A's udgående. Ingen SDK-ændringer nødvendige i nogen app.

| Indstilling | Standard | Beskrivelse |
| --- | --- | --- |
| `ebpf.contextPropagation` | on | Injicér W3C `traceparent` i udgående trafik (HTTP-headers + brugerdefineret TCP-option). Sæt til `false` for at holde hver services spans lokale. |
| `ebpf.trackRequestHeaders` | on | Kernel-side anmodnings-header-sporing, så udbredelse også virker på rene HTTP-servere (ikke-Go, ikke-TLS). Træder kun i kraft, når `contextPropagation` er true. |

### Log ↔ trace-korrelation

Også aktiveret som standard. OBI's log-beriger opfanger pod-stdout-skrivninger fra instrumenterede processer og:

- For **JSON-formaterede logs**: injicerer `trace_id`- og `span_id`-felter i linjen (eventuelle eksisterende værdier i loggen bevares). Filelog-DaemonSet'en løfter derefter disse felter op på LogRecord'ens native trace_id/span_id-pladser, så et klik på et span i trace-visningen hopper til dens logs i OneUptime — og et klik på en loglinje hopper til dens forælder-trace.
- For **ikke-JSON-logs**: linjen bevares uændret — stadig indsamlet, bare ikke automatisk linket.

| Indstilling | Standard | Beskrivelse |
| --- | --- | --- |
| `ebpf.logToTraceCorrelation` | on | Aktivér OBI-logberigeren og filelog-pipelinens trace_id-løft. Sæt til `false` for at springe begge over. |

Forbehold:

- **Logs skal være JSON, for at trace_id kan vises.** Skift din logger til en JSON-formatter — `structlog`, `pino`, `winston`, `serilog`, `logback-json`, klog `--logging-format=json`, osv.
- **Bufret stdout bryder korrelationen**, fordi `write()`-systemkaldet udløses på en anden tråd end den, der håndterede anmodningen. Almindelige løsninger:
  - **Python**: sæt `PYTHONUNBUFFERED=1` (runtime'en blok-buffrer stdout, når det ikke er en TTY).
  - **.NET**: ved opstart, `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`. Microsoft.Extensions.Logging `AddConsole()` og Serilogs async-sinks vil heller ikke virke — skift til en synkron konsol-writer (Serilogs standard `WriteTo.Console()` er fint).
- Greenlet / gevent, Tornado og andre brugerdefinerede async-runtimes er ikke dækket.

### Tuning

| Indstilling | Standard | Beskrivelse |
| --- | --- | --- |
| `ebpf.enabled` | `true` | Hovedkontakt. Sæt til `false` for at springe eBPF-DaemonSet'en helt over. |
| `ebpf.image.tag` | `v0.9.0` | OBI image-tag. OBI er præ-1.0; pin til en kendt-god version og test igen ved bumps. |
| `ebpf.autoTargetExe` | `*` | Glob af eksekverbare filer, der skal instrumenteres. Indsnævr dette (f.eks. `*/python,*/java`), hvis du vil afgrænse auto-instrumentering. |
| `ebpf.excludeExePaths` | (shells, kubelet, runc, containerd, otelcol, OBI selv) | Komma-separerede globs, der skal springes over. |
| `ebpf.logLevel` | `info` | `debug`, `info`, `warn` eller `error`. Sæt til `debug` under fejlfinding. |
| `ebpf.printTraces` | `false` | Udskriv spans til OBI's stdout udover OTLP-eksport — nyttigt til at verificere indfangning under installation. |
| `ebpf.resources.*` | `100m / 256Mi` requests, `1000m / 1Gi` limits | Skru op for klynger med høj trafik. |

For at tjekke, at OBI kører og ser trafik:

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## Kontinuerlig CPU-profilering (deaktiveret som standard)

En separat DaemonSet kører [OpenTelemetry eBPF Profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) — pakket som `otel/opentelemetry-collector-ebpf-profiler`-imaget. Den sampler on-CPU-stakke ved 19Hz på tværs af hver understøttet runtime (Go, Java, .NET, Python, Ruby, Node.js, PHP, Perl, C/C++, Rust) og sender OTLP-profiler til OneUptime, hvor de vises under **Telemetry → Performance Profiles** og som flammegrafer linket fra individuelle trace-spans.

Profilering er **deaktiveret som standard** — den er tungere end OBI-auto-instrumenteringen (mere CPU pr. node, større hukommelsesforbrug), og ikke alle klynger ønsker altid-aktive flammegrafer. Aktivér den, når du vil have rigere telemetri: `--set profiling.enabled=true`.

Når eBPF auto-instrumentering også er aktiveret (`ebpf.enabled: true`, som er standard), korreleres hver CPU-sample med OBI's trace-kontekst via et delt bpffs-map — så flammegrafer bærer trace_id/span_id, og OneUptime-UI'en kan vise dig en flammegraf pr. span.

Krav:

- **Linux-kerne 5.10+** (en smule nyere end de 5.8, OBI har brug for).
- Privilegeret pod med hostPID — samme begrænsninger som eBPF auto-instrumenterings-DaemonSet'en. Kan ikke køre på GKE Autopilot, EKS Fargate eller andre låste miljøer.

Tuning:

| Indstilling | Standard | Beskrivelse |
| --- | --- | --- |
| `profiling.enabled` | `false` | Hovedkontakt. Deaktiveret som standard; tilvælg for kontinuerlige CPU-flammegrafer. |
| `profiling.image.tag` | `0.152.0` | `otel/opentelemetry-collector-ebpf-profiler` image-tag. Profileren er præ-1.0; pin til en kendt-god version. |
| `profiling.samplesPerSecond` | `19` | Samplingsfrekvens i Hz. Upstream-standard; undgår utilsigtet aliasing med almindelige timer-frekvenser. |
| `profiling.offCpuThreshold` | `0` | (0–1] aktiverer off-CPU-profilering — diagnosticerer lock-konflikt og blokerende I/O. Slået fra som standard, fordi det tilføjer tracepoint-overhead. |
| `profiling.tracers` | `""` *(alle runtimes)* | Komma-separeret liste over sprog-tracere, der skal indlæses. |
| `profiling.obiProcessContext` | `true` | Korrelér samples med OBI's trace-kontekst til trace ↔ profil-linking. |

## Anden dataindsamling (host-metrikker, mætning, cAdvisor, KSM, audit-logs, CSI, CoreDNS)

Charten kan også indsamle:

| `<key>.enabled` | Standard | Hvad det tilføjer |
| --- | --- | --- |
| `hostMetrics` | on | Pr.-node OS-metrikker fra `/proc` og `/sys` — disk-I/O-kø-dybde, filsystem-inode-forbrug, NIC-fejltællere, paging-statistik, load average. Lever inde i log-collector-DaemonSet'en (ingen ekstra pods). |
| `auditLogs` | off | Læs `/var/log/kubernetes/audit.log` fra værten. Indfanger hver Kubernetes API-anmodning — hvem gjorde hvad mod hvilken ressource. Kun selvadministrerede klynger — administreret K8s (EKS, GKE, AKS, DOKS) ruter audit-logs til cloud-udbyderens sink. |
| `csi` | off | Auto-opdager pods med label `app=csi-driver` (eller `app.kubernetes.io/component=csi-driver`) og skraber deres Prometheus `metrics`-port — volumen-tilknyt/-afkobl-latens, provisioneringsfejl, IOPS. |
| `coreDns` | off | Skraber klyngens CoreDNS-service på `:9153/metrics`. Synliggør forespørgselsrate, latens, cache-hit-rate, fejltællinger — almindelige P99-latensbøller. |

## Almindelige indstillinger

| Indstilling | Standard | Beskrivelse |
| --- | --- | --- |
| `preset` | (tom — behandles som `standard`) | Se tabellen ovenfor. |
| `oneuptime.url` | *(påkrævet)* | URL til din OneUptime-instans. |
| `oneuptime.apiKey` | *(påkrævet)* | Projekt-API-nøgle (Settings → API Keys). |
| `clusterName` | *(påkrævet)* | Unikt navn for denne klynge. Stemplet som `k8s.cluster.name` på hver post. |
| `namespaceFilters.include` | `[]` | Hvis sat, overvåges kun disse namespaces. |
| `namespaceFilters.exclude` | `["kube-system"]` | Namespaces, der skal springes over. |
| `logs.enabled` | `true` | Slå logindsamling til eller fra. |
| `logs.mode` | (afledt af `preset`) | `daemonset`, `api` eller `disabled`. Tilsidesætter preset. |
| `logs.api.replicas` | `1` | Antal log-tailer-Deployment-replikaer (kun i API-tilstand). |
| `ebpf.enabled` | `true` | Auto-indfang HTTP/gRPC-traces fra hver pod via OpenTelemetry eBPF Instrumentation. Se afsnittet ovenfor. |
| `profiling.enabled` | `false` | Kontinuerlige CPU-flammegrafer via OpenTelemetry eBPF Profiler. Deaktiveret som standard; tilvælg for mere telemetri. Se afsnittet ovenfor. |
| `hostMetrics.enabled` | `true` | Pr.-node OS-metrikker. |
| `auditLogs.enabled` | `false` | Kubernetes audit-logindsamling (selvadministrerede klynger). |
| `csi.enabled` | `false` | CSI driver Prometheus-metrikker. |
| `coreDns.enabled` | `false` | CoreDNS Prometheus-metrikker. |
| `controlPlane.enabled` | `false` | Skrab etcd / api-server / scheduler / controller-manager. Kun selvadministrerede klynger — administrerede tilbud (EKS/GKE/AKS) eksponerer typisk ikke disse endpoints. |

Se chartens [`values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) for den fulde liste.

## Opgradering

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` bevarer din eksisterende konfiguration; angiv eventuelle nye `--set`-tilsidesættelser oven på den.

> **Vigtigt: `--reuse-values` fletter ikke nye standardværdier fra charten.** Helm genbruger dine tidligere renderede værdier ordret — så ethvert nyt øverste felt tilføjet i en nyere chart-version (f.eks. `profiling.*`, `ebpf.features.*`) forbliver uindstillet på din eksisterende release, og skabelonen renderer, som om du havde deaktiveret det.
>
> **Helm 3.14+** — skift til `--reset-then-reuse-values`. Den genlæser chart-standardværdierne for nøgler, du ikke har tilsidesat:
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 eller tidligere** — drop `--reuse-values` og angiv dine oprindelige `--set`-flag (eller `-f values.yaml`) eksplicit. Nye chart-standardværdier vil gælde for alt, du ikke tilsidesætter.
>
> Hvis en ny funktions pods (f.eks. `kubernetes-agent-profiling-*`) ikke dukker op efter opgradering, er dette næsten altid grunden. `helm get values <release>` viser, hvad Helm faktisk har — felter, der mangler i output'et, betyder, at standardværdier ikke blev flettet for dem.

## Afinstallation

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Fejlfinding

### Installationen fejler med "hostPath volumes are not allowed"

Din klynge blokerer hostPath. Skift til en API-tilstand-preset:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### Ingen logs dukker op i OneUptime

Tjek agent-poddene:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

I API-tilstand eksponerer log-tailer-pod'en `/healthz` på port 13133 — ram den via `kubectl port-forward` for et øjebliksbillede af eksportstatus.

### eBPF-DaemonSet-pod'en er `CrashLoopBackOff` eller fejler ved start

Tjek OBI-pod-loggene:

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

Almindelige årsager:

- **Kernen for gammel eller manglende BTF.** OBI har brug for Linux 5.8+ med BTF. Tjek med `uname -r` på en node. Hvis du ikke kan opgradere, deaktivér eBPF: `--set ebpf.enabled=false`.
- **Privilegerede pods er blokeret.** Nogle klynger afviser privilegerede pods selv uden for Autopilot/Fargate. Deaktivér eBPF.
- **Ingen traces i dashboardet, men OBI kører.** Sæt `--set ebpf.printTraces=true` og tjek OBI's stdout — hvis du ser spans der, er problemet OTLP-levering (tjek `OTEL_EXPORTER_OTLP_ENDPOINT` og din OneUptime-URL/API-nøgle). Hvis du ikke ser spans, er den trafik, OBI overvåger, måske helt krypteret af et TLS-bibliotek, OBI ikke kan opfange (f.eks. en statisk linket TLS-implementering, den ikke genkender).

### Min klynge har for mange pods til én log-tailer-replika (kun API-tilstand)

Skalér horisontalt ved at sharde namespaces. Deploy én gang pr. namespace-gruppe:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Alternativt kan du øge `logs.api.replicas` — men bemærk, at hver replika behandler alle tilladte namespaces, så for deduplikering har du stadig brug for namespace-sharding.
