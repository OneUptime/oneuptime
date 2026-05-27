# Installere Kubernetes-agenten

OneUptime Kubernetes-agenten samler inn klyngemetrikker, hendelser, pod-logger, **applikasjonssporinger (HTTP/gRPC via eBPF)** og **OS-nivå nodemetrikker** fra Kubernetes-klyngen din og sender dem til OneUptime. Den distribueres som et Helm-kart og installeres med én kommando — eBPF auto-instrumentering er aktivert som standard, slik at du ser tjenestenivåsporinger og RED-metrikker uten kodeendringer. **Kontinuerlige CPU-flammegrafer (eBPF-profiler)** er også tilgjengelige — meld deg på med `--set profiling.enabled=true` når du ønsker mer telemetri.

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

Klyngen din vil vises i OneUptime i løpet av få minutter.

## Velg riktig forhåndsinnstilling for klyngen din

Ulike Kubernetes-distribusjoner har ulike begrensninger — særlig om arbeidsmengder kan montere `hostPath`-volumer. I stedet for at du må lese sikkerhetsdokumentasjon, eksponerer Helm-kartet ett enkelt toppnivåvalg: `preset`.

| Preset | Brukes for | Logginnsamling | Merknader |
| --- | --- | --- | --- |
| `standard` (standard) | Selvadministrert, **EKS på EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet som leser `/var/log/pods` via hostPath | Lavest overhead. hostPath er tilgjengelig på disse plattformene. |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API-tailer (Deployment) | hostPath er blokkert på Autopilot. Setter en herdet sikkerhetskontekst som består Autopilots Pod Security Standards. |
| `eks-fargate` | **EKS Fargate** | Kubernetes API-tailer (Deployment) | Samme som `gke-autopilot`. Fargate blokkerer hostPath og DaemonSets. |

Hvis du er usikker, la `preset` stå usatt — du får `standard`-standardverdiene. Hvis klyngen din avviser installasjonen med en Pod Security-policyfeil som nevner `hostPath`, bytt til `gke-autopilot` (eller `eks-fargate` på EKS Fargate) og installer på nytt.

### Eksempler

**GKE Standard, EKS på EC2, selvadministrert eller AKS:**

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

## Hvordan de to logginnsamlingsmodusene skiller seg

Under panseret setter `preset` verdien `logs.mode` — og du kan også sette den direkte hvis du må overstyre standardverdien for forhåndsinnstillingen.

### DaemonSet-modus (`logs.mode: daemonset`)

En DaemonSet kjører én OpenTelemetry Collector-pod per node. Den leser loggfiler under `/var/log/pods/` via et hostPath-volum og videresender dem over OTLP.

- **Fordeler:** lavest overhead, skalerer lineært med noder, ingen belastning på Kubernetes API-serveren, håndterer loggrotasjon.
- **Ulemper:** krever hostPath, krever muligheten til å planlegge DaemonSets — begge utilgjengelige på GKE Autopilot og EKS Fargate.

### API-modus (`logs.mode: api`)

En Deployment med én replika (bildet `oneuptime/kubernetes-log-tailer`) bruker Kubernetes-API-et til å strømme containerlogger — samme endepunkt som `kubectl logs -f` bruker. Ingen hostPath, ingen verts-tilgang, ingen DaemonSet.

- **Fordeler:** fungerer på GKE Autopilot, EKS Fargate og enhver klynge som blokkerer hostPath eller håndhever `restricted` Pod Security Standard.
- **Ulemper:** hver containerstrøm er en langvarig tilkobling til `kube-apiserver`. I praksis håndterer én replika et par tusen containere komfortabelt. For svært store klynger, shard etter namespace med `logs.api.replicas` pluss `namespaceFilters.include` på hver replika.

### Hvilken bør du bruke?

Hvis hostPath fungerer, bruk DaemonSet. Alle andre steder, bruk API-modus. Innstillingen `preset` velger riktig modus for deg.

Du kan også deaktivere logginnsamling helt med `--set logs.enabled=false` og sende applikasjonslogger via OpenTelemetry SDK-er i stedet. Se [OpenTelemetry](/docs/telemetry/open-telemetry)-dokumentasjonen.

## Applikasjonssporinger og HTTP-forespørsler via eBPF (aktivert som standard)

Helm-kartet leveres med en DaemonSet som kjører [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) på hver node. OBI laster eBPF-programmer inn i Linux-kjernen og overvåker trafikk på socket-nivå for å rekonstruere HTTP/HTTPS-, gRPC- og SQL/Redis-anrop fra hver pod på noden — ingen kodeendringer, ingen SDK, ingen sidecar. Fanget trafikk eksporteres som OTLP-sporinger og forespørsels-/latensmetrikker direkte til OneUptime.

Etter installasjon begynner tjenestene dine å vises under **Telemetry → Traces** og tjenestekartet i løpet av et minutt eller to, med `k8s.cluster.name` satt til `clusterName` slik at du kan filtrere etter klynge.

### Når du bør slå det av

eBPF er **aktivert som standard**. Du bør deaktivere det (`--set ebpf.enabled=false`) hvis:

- Du installerer på **GKE Autopilot** eller **EKS Fargate**. Disse plattformene blokkerer priviligerte pods, og OBI trenger priviligert modus for å laste eBPF-programmer.
- Nodene dine kjører en kjerne eldre enn **Linux 5.8** uten BTF-backporter. (Moderne distroer — Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+ — er greie.)
- Du sender allerede sporinger via OpenTelemetry SDK fra appene dine og ønsker ikke duplikater.

### Hva som sendes ut

OBI trekker ut flere signalfamilier fra den fangede trafikken. Alle er aktivert som standard; hver kan deaktiveres uavhengig med `--set ebpf.features.<key>=false`:

| Signal | Standard | Hva det legger til |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | på | HTTP/gRPC RED-metrikker — forespørselsrate, latenshistogrammer, feiltellinger — per tjeneste. |
| `ebpf.features.spanMetrics` | på | Span-attributtbaserte metrikker: forespørselsstørrelse, svarstørrelse, varighet brutt ned per rute/operasjon. |
| `ebpf.features.serviceGraph` | på | Tjeneste-til-tjeneste kantmetrikker (kaller → kallt forespørselsrate + latens). Driver tjenestekartet. |
| `ebpf.features.hostMetrics` | på | CPU og minne per instrumentert prosess — sparer deg for å kjøre en separat profiler for grunnleggende kapasitetsspørsmål. |
| `ebpf.features.networkMetrics` | på | Pod-til-pod TCP/UDP-flyttellere for byte og pakker med k8s-metadata. Synliggjør hvert podpar som snakker sammen, inkludert de som kjører protokoller OBI ikke kan parse. |
| `ebpf.features.networkInterZoneMetrics` | av | Inter-sone-variant av nettverksmetrikker. Dobler kardinaliteten; bare verdt å aktivere hvis du faktisk bruker sonebasert planlegging. |
| `ebpf.features.tcpStats` | på | TCP-statistikk på nodenivå: RTT-histogrammer, mislykkede tilkoblingstellinger, retransmisjoner. |

OBI propagerer også sporingskontekst på tvers av tjenestegrenser som standard. Når pod A gjør en HTTP/gRPC-forespørsel til pod B, injiserer OBI en W3C `traceparent`-header i den utgående forespørselen — slik at det resulterende spannet på pod B-siden lenkes inn i samme sporing som pod A's utgående. Ingen SDK-endringer er nødvendige i noen av appene.

| Valg | Standard | Beskrivelse |
| --- | --- | --- |
| `ebpf.contextPropagation` | på | Injiser W3C `traceparent` i utgående trafikk (HTTP-headere + tilpasset TCP-valg). Sett til `false` for å holde hver tjenestes spans lokale. |
| `ebpf.trackRequestHeaders` | på | Forespørselshodersporing på kjernesiden slik at propagering også fungerer på rene HTTP-servere (ikke-Go, ikke-TLS). Trer kun i kraft når `contextPropagation` er true. |

### Korrelasjon mellom logg og sporing

Også aktivert som standard. OBIs loggberiker fanger pod-stdout-skrivinger fra instrumenterte prosesser og:

- For **JSON-formaterte logger**: injiserer feltene `trace_id` og `span_id` i linjen (eventuelle eksisterende verdier i loggen bevares). Filelog-DaemonSetet løfter deretter disse feltene inn i LogRecordens innebygde trace_id/span_id-plasser, slik at klikk på et span i sporingsvisningen hopper til loggene i OneUptime — og klikk på en logglinje hopper til den overordnede sporingen.
- For **ikke-JSON-logger**: linjen bevares uendret — fortsatt samlet inn, bare ikke automatisk lenket.

| Valg | Standard | Beskrivelse |
| --- | --- | --- |
| `ebpf.logToTraceCorrelation` | på | Aktiver OBI-loggberikeren og filelog-pipelinens trace_id-løft. Sett til `false` for å hoppe over begge. |

Forbehold:

- **Logger må være JSON for at trace_id skal vises.** Bytt loggeren din til en JSON-formaterer — `structlog`, `pino`, `winston`, `serilog`, `logback-json`, klog `--logging-format=json` osv.
- **Buffret stdout bryter korrelasjonen** fordi `write()`-systemkallet utløses på en annen tråd enn den som håndterte forespørselen. Vanlige løsninger:
  - **Python**: sett `PYTHONUNBUFFERED=1` (kjøretiden block-buffrer stdout når det ikke er en TTY).
  - **.NET**: ved oppstart, `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`. Microsoft.Extensions.Logging `AddConsole()` og Serilogs asynkrone sinks vil ikke fungere heller — bytt til en synkron konsollskriver (Serilogs standard `WriteTo.Console()` er greit).
- Greenlet / gevent, Tornado og andre tilpassede asynkrone kjøretider dekkes ikke.

### Tuning

| Valg | Standard | Beskrivelse |
| --- | --- | --- |
| `ebpf.enabled` | `true` | Hovedbryter. Sett til `false` for å hoppe over eBPF-DaemonSetet helt. |
| `ebpf.image.tag` | `v0.9.0` | OBI-bildetag. OBI er pre-1.0; fest til en kjent god versjon og test på nytt ved oppdateringer. |
| `ebpf.autoTargetExe` | `*` | Glob av kjørbare filer som skal instrumenteres. Snevre inn dette (f.eks. `*/python,*/java`) hvis du vil avgrense auto-instrumenteringen. |
| `ebpf.excludeExePaths` | (skall, kubelet, runc, containerd, otelcol, OBI selv) | Kommaseparerte globber som skal hoppes over. |
| `ebpf.logLevel` | `info` | `debug`, `info`, `warn` eller `error`. Sett til `debug` under feilsøking. |
| `ebpf.printTraces` | `false` | Skriv spans til OBIs stdout i tillegg til OTLP-eksport — nyttig for å verifisere innsamling under installasjon. |
| `ebpf.resources.*` | `100m / 256Mi` requests, `1000m / 1Gi` limits | Øk for klynger med mye trafikk. |

For å sjekke at OBI kjører og ser trafikk:

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## Kontinuerlig CPU-profilering (deaktivert som standard)

En separat DaemonSet kjører [OpenTelemetry eBPF Profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) — pakket som bildet `otel/opentelemetry-collector-ebpf-profiler`. Den sampler on-CPU-stacker ved 19Hz på tvers av hver støttet kjøretid (Go, Java, .NET, Python, Ruby, Node.js, PHP, Perl, C/C++, Rust) og sender OTLP-profiler til OneUptime, hvor de vises under **Telemetry → Performance Profiles** og som flammegrafer lenket fra individuelle sporingsspans.

Profilering er **deaktivert som standard** — den er tyngre enn OBI auto-instrumenteringen (mer CPU per node, større minneavtrykk) og ikke alle klynger ønsker alltid-på-flammegrafer. Aktiver den når du ønsker rikere telemetri: `--set profiling.enabled=true`.

Når eBPF auto-instrumentering også er på (`ebpf.enabled: true`, standarden), korreleres hvert CPU-sample med OBIs sporingskontekst via et delt bpffs-kart — slik at flammegrafer bærer trace_id/span_id og OneUptime-grensesnittet kan vise deg en flammegraf per span.

Krav:

- **Linux-kjerne 5.10+** (litt nyere enn 5.8 som OBI trenger).
- Priviligert pod med hostPID — samme begrensninger som eBPF auto-instrumenterings-DaemonSetet. Kan ikke kjøre på GKE Autopilot, EKS Fargate eller andre låste miljøer.

Tuning:

| Valg | Standard | Beskrivelse |
| --- | --- | --- |
| `profiling.enabled` | `false` | Hovedbryter. Deaktivert som standard; meld deg på for kontinuerlige CPU-flammegrafer. |
| `profiling.image.tag` | `0.152.0` | Bildetag for `otel/opentelemetry-collector-ebpf-profiler`. Profileren er pre-1.0; fest til en kjent god versjon. |
| `profiling.samplesPerSecond` | `19` | Samplingsfrekvens i Hz. Oppstrøms standard; unngår utilsiktet aliasing med vanlige timerfrekvenser. |
| `profiling.offCpuThreshold` | `0` | (0–1] aktiverer off-CPU-profilering — diagnostiserer låskonflikt og blokkerende I/O. Av som standard fordi det legger til tracepoint-overhead. |
| `profiling.tracers` | `""` *(alle kjøretider)* | Kommaseparert liste over språk-tracere som skal lastes. |
| `profiling.obiProcessContext` | `true` | Korreler samples med OBIs sporingskontekst for sporing ↔ profil-lenking. |

## Annen datainnsamling (host-metrikker, metning, cAdvisor, KSM, audit-logger, CSI, CoreDNS)

Helm-kartet kan også samle inn:

| `<key>.enabled` | Standard | Hva det legger til |
| --- | --- | --- |
| `hostMetrics` | på | OS-metrikker per node fra `/proc` og `/sys` — disk-I/O-kødybde, filsystem-inode-bruk, NIC-feiltellere, paging-statistikk, lastgjennomsnitt. Bor inne i logginnsamler-DaemonSetet (ingen ekstra pods). |
| `kubeletstats.utilizationMetrics` | på | Metningsmetrikker — container- og pod-CPU/minne uttrykt som en prosentandel av request og limit. Åtte avledede metrikkfamilier som driver «CPU/Memory vs Request»- og «CPU/Memory vs Limit»-monitorene. Samme skrap som den eksisterende `kubeletstats`-mottakeren, ingen ekstra pods. Alltid 0 når en pod ikke har request/limit satt. |
| `kubeletstats.volumeMetrics` | på | Diskbruk per PVC (`k8s.volume.available`, `k8s.volume.capacity`). Driver «PVC Low Disk Space»-monitoren. Én serie per PVC per pod — begrenset for de fleste klynger, tyngre på stateful arbeidsmengder med tusenvis av PVC-er. |
| `cadvisor` | på | Skraper kubeletens `/metrics/cadvisor`-endepunkt fra hver nodes DaemonSet-pod for de containermetrikkene som `kubeletstats` ikke oversetter: CFS-strupning (`container_cpu_cfs_throttled_seconds_total`, `container_cpu_cfs_periods_total`) og OOM-drepehendelser (`container_oom_events_total`). En relabel-tillatelsesliste dropper alt annet ved mottakeren slik at kardinaliteten holdes begrenset. |
| `kubeStateMetrics` | av | Henter klyngetilstandsmetrikker fra kube-state-metrics: pod-faser (Pending / Terminating), container-venteårsaker (CrashLoopBackOff, ImagePullBackOff) og bruk av ressurskvoter. `mode: bundled` (standard) distribuerer en liten KSM-Deployment for deg; `mode: external` skraper en eksisterende KSM via `endpoint`. Av som standard fordi den medfølgende modusen legger til en Deployment i kartets fotavtrykk. |
| `auditLogs` | av | Les `/var/log/kubernetes/audit.log` fra verten. Fanger hver Kubernetes API-forespørsel — hvem gjorde hva med hvilken ressurs. Kun selvadministrerte klynger — administrert K8s (EKS, GKE, AKS, DOKS) ruter audit-logger til skyleverandørens sink. |
| `csi` | av | Oppdager automatisk pods merket `app=csi-driver` (eller `app.kubernetes.io/component=csi-driver`) og skraper deres Prometheus-`metrics`-port — volum attach/detach-latens, provisjoneringsfeil, IOPS. |
| `coreDns` | av | Skraper klyngens CoreDNS-tjeneste på `:9153/metrics`. Synliggjør spørringsrate, latens, cache-hit-rate, feiltellinger — vanlige P99-latensskurker. |

## Vanlige valg

| Valg | Standard | Beskrivelse |
| --- | --- | --- |
| `preset` | (tom — behandles som `standard`) | Se tabellen ovenfor. |
| `oneuptime.url` | *(påkrevd)* | URL til OneUptime-instansen din. |
| `oneuptime.apiKey` | *(påkrevd)* | Prosjekt-API-nøkkel (Settings → API Keys). |
| `clusterName` | *(påkrevd)* | Unikt navn for denne klyngen. Stemples som `k8s.cluster.name` på hver post. |
| `namespaceFilters.include` | `[]` | Hvis satt, overvåkes kun disse namespacene. |
| `namespaceFilters.exclude` | `["kube-system"]` | Namespaces som skal hoppes over. |
| `logs.enabled` | `true` | Slå logginnsamling på eller av. |
| `logs.mode` | (utledet fra `preset`) | `daemonset`, `api` eller `disabled`. Overstyrer forhåndsinnstillingen. |
| `logs.api.replicas` | `1` | Antall log-tailer Deployment-replikaer (kun i API-modus). |
| `ebpf.enabled` | `true` | Auto-fang HTTP/gRPC-sporinger fra hver pod via OpenTelemetry eBPF Instrumentation. Se delen ovenfor. |
| `profiling.enabled` | `false` | Kontinuerlige CPU-flammegrafer via OpenTelemetry eBPF Profiler. Deaktivert som standard; meld deg på for mer telemetri. Se delen ovenfor. |
| `hostMetrics.enabled` | `true` | OS-metrikker per node. |
| `kubeletstats.utilizationMetrics.enabled` | `true` | Container- og pod-CPU/minne-metning (% av request og limit). Ingen ekstra skrap — utledet fra kubeletstats-data. |
| `kubeletstats.volumeMetrics.enabled` | `true` | Diskbruk per PVC (`k8s.volume.available`, `k8s.volume.capacity`). |
| `cadvisor.enabled` | `true` | Skrap denne nodens kubelet `/metrics/cadvisor` for CFS-strupning + OOM-drepetellere. Tillatelseslistet til 3 metrikker. |
| `kubeStateMetrics.enabled` | `false` | Hent pod-faser, container-venteårsaker (CrashLoopBackOff / ImagePullBackOff) og ResourceQuota-bruk fra kube-state-metrics. Se `kubeStateMetrics.mode` for medfølgende vs. ekstern. |
| `auditLogs.enabled` | `false` | Innsamling av Kubernetes-auditlogger (selvadministrerte klynger). |
| `csi.enabled` | `false` | Prometheus-metrikker for CSI-driver. |
| `coreDns.enabled` | `false` | Prometheus-metrikker for CoreDNS. |
| `controlPlane.enabled` | `false` | Skrap etcd / api-server / scheduler / controller-manager. Kun selvadministrerte klynger — administrerte tilbud (EKS/GKE/AKS) eksponerer vanligvis ikke disse endepunktene. |

Se Helm-kartets [`values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) for hele listen.

## Oppgradering

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` beholder den eksisterende konfigurasjonen din; send eventuelle nye `--set`-overstyringer på toppen av det.

> **Obs: `--reuse-values` slår ikke sammen nye standardverdier fra Helm-kartet.** Helm gjenbruker dine tidligere rendrede verdier ordrett — så ethvert nytt toppnivåfelt som er lagt til i en nyere kartversjon (f.eks. `profiling.*`, `ebpf.features.*`) forblir usatt på din eksisterende utgivelse, og malen rendres som om du hadde deaktivert det.
>
> **Helm 3.14+** — bytt til `--reset-then-reuse-values`. Den leser standardverdiene i kartet på nytt for nøkler du ikke har overstyrt:
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 eller eldre** — dropp `--reuse-values` og send dine opprinnelige `--set`-flagg (eller `-f values.yaml`) eksplisitt. Nye kartstandarder vil gjelde for alt du ikke overstyrer.
>
> Hvis pods for en ny funksjon (f.eks. `kubernetes-agent-profiling-*`) ikke dukker opp etter oppgradering, er dette nesten alltid grunnen. `helm get values <release>` viser hva Helm faktisk har — felt som mangler i utdataene betyr at standardverdier ikke ble slått sammen for dem.

## Avinstallering

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Feilsøking

### Installasjonen feiler med "hostPath volumes are not allowed"

Klyngen din blokkerer hostPath. Bytt til en API-modus-forhåndsinnstilling:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### Ingen logger vises i OneUptime

Sjekk agent-podene:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

I API-modus eksponerer log-tailer-poden `/healthz` på port 13133 — kontakt den via `kubectl port-forward` for et øyeblikksbilde av eksportstatusen.

### eBPF DaemonSet-poden er `CrashLoopBackOff` eller klarer ikke å starte

Sjekk OBI-podloggene:

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

Vanlige årsaker:

- **Kjernen for gammel eller mangler BTF.** OBI trenger Linux 5.8+ med BTF. Sjekk med `uname -r` på en node. Hvis du ikke kan oppgradere, deaktiver eBPF: `--set ebpf.enabled=false`.
- **Priviligerte pods er blokkert.** Noen klynger avviser priviligerte pods selv utenfor Autopilot/Fargate. Deaktiver eBPF.
- **Ingen sporinger i dashbordet, men OBI kjører.** Sett `--set ebpf.printTraces=true` og sjekk OBIs stdout — hvis du ser spans der, er problemet OTLP-levering (sjekk `OTEL_EXPORTER_OTLP_ENDPOINT` og din OneUptime URL/API-nøkkel). Hvis du ikke ser spans, kan trafikken OBI overvåker være helt kryptert av et TLS-bibliotek OBI ikke kan avlytte (f.eks. en statisk lenket TLS-implementasjon den ikke gjenkjenner).

### Klyngen min har for mange pods for én log-tailer-replika (kun API-modus)

Skaler horisontalt ved å sharde namespaces. Distribuer én gang per namespace-gruppe:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Alternativt kan du øke `logs.api.replicas` — men merk at hver replika prosesserer alle tillatte namespaces, så for deduplisering trenger du fortsatt namespace-sharding.
