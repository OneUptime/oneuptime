# OneUptime Kubernetes Agent (Helm)

## Oversigt

OneUptime Kubernetes Agent er et færdigpakket Helm-chart, der installerer en OpenTelemetry-baseret collector-pipeline på din cluster. Den leverer node-, pod-, container- og cluster-metrikker; Kubernetes-events; pod-logs; og — med eBPF slået til som standard — applikationssporinger (traces), HTTP RED-metrikker, service-graph-data og pod-til-pod-netværksflow-metrikker. Ingen kodeændringer, ingen SDK'er, én `helm install`.

Denne side er **installationsvejledningen**. For at konfigurere Kubernetes-monitorer og -advarsler oven på de data, agenten indsamler, se [Kubernetes Agent (monitorer)](/docs/monitor/kubernetes-agent).

## Forudsætninger

- En kørende Kubernetes-cluster (v1.23+)
- `kubectl` konfigureret til at få adgang til din cluster
- `helm` v3 installeret
- En **OneUptime API-nøgle** — opret en fra _Project Settings → API Keys_

## Trin 1 — Tilføj OneUptime Helm-repositoriet

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Trin 2 — Vælg en forudindstilling til din cluster

Chartet eksponerer en enkelt mulighed på øverste niveau — `preset` — der vælger kompatible standarder til din Kubernetes-distribution. Den styrer ting, du ellers selv ville skulle finjustere: om logs skal leveres via en hostPath DaemonSet eller via Kubernetes-API'en, og hvilken security context der skal anvendes.

| `preset`                | Bruges til                                                                           | Logindsamling                                                            |
| ----------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `standard` _(standard)_ | Selvhostede clusters, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet, der læser `/var/log/pods` via hostPath (laveste overhead)     |
| `gke-autopilot`         | **GKE Autopilot**                                                                    | Kubernetes API log tailer Deployment (ingen hostPath, ingen host-adgang) |
| `eks-fargate`           | **EKS Fargate**                                                                      | Kubernetes API log tailer Deployment (ingen hostPath, ingen host-adgang) |

Hvis du er i tvivl, så start med `standard`. Hvis installationen fejler med en Pod Security-fejl, der nævner `hostPath`, så kør igen med `preset=gke-autopilot` (eller `eks-fargate` på Fargate), og det vil virke.

## Trin 3 — Installér Kubernetes Agent

Erstat `YOUR_ONEUPTIME_URL`, `YOUR_ONEUPTIME_API_KEY` og cluster-navnet med værdier for dit miljø. Cluster-navnet er, hvordan clusteren vil fremstå i OneUptime — vælg noget stabilt som `prod-us-east-1`.

### Standard-clusters (selvhostede, EKS on EC2, GKE Standard, AKS)

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

## Trin 4 — Verificér installationen

Kontrollér, at agent-poddene kører:

```bash
kubectl get pods -n oneuptime-agent
```

På en **standard**-cluster vil du se en metrics-collector Deployment plus én log-collector DaemonSet-pod pr. node:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

På **GKE Autopilot** eller **EKS Fargate** vil du i stedet se to Deployments (ingen DaemonSet):

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

Når agenten har forbundet, vil din cluster automatisk fremstå i **Kubernetes**-sektionen af OneUptime-dashboardet.

## Konfigurationsmuligheder

### Namespace-filtrering

`namespaceFilters` afgrænser **pod-logs** (både hostPath DaemonSet'en og API-log-tailer'en) og **eBPF-sporinger** til de namespaces, du vælger. `kube-system` er ekskluderet som standard. For at begrænse disse signaler til specifikke namespaces:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

> Disse filtre reducerer **ikke** node- / pod- / container-**metrikker** — de scrapes pr. node fra kubelet'en og indsamles altid cluster-bredt (serier på node- og cluster-niveau har intet namespace at filtrere på). `exclude` vinder altid over `include`. Se [Reducering af mængden af indsamlede data](#reducing-the-volume-of-data-collected) for det fulde sæt af volumenkontroller.

### Deaktivér logindsamling

Hvis du kun har brug for metrikker og events (ingen pod-logs):

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### Gennemtving en bestemt logindsamlingstilstand

Avancerede brugere kan tilsidesætte forudindstillingens valg med `logs.mode`:

- `logs.mode=daemonset` — hostPath DaemonSet (laveste overhead, kræver hostPath)
- `logs.mode=api` — Kubernetes API log tailer Deployment (virker på enhver cluster)
- `logs.mode=disabled` — ingen logindsamling

Det eksplicitte `logs.mode` vinder altid over forudindstillingens standard. Brug dette, hvis du kender din cluster bedre, end forudindstillingen gør.

### Aktivér Control Plane-monitorering

For selvhostede clusters (ikke EKS / GKE / AKS) kan du aktivere control plane-metrikker:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> Administrerede Kubernetes-tjenester (EKS, GKE, AKS) eksponerer typisk ikke control plane-metrikker. Aktivér kun dette for selvhostede clusters.

### Auto-tagging med projektlabels

Enhver resource-attribut med præfikset `oneuptime.label.` forfremmes til en projektlabel og knyttes til clusteren, tjenesterne og hosterne, der udsendes fra denne agent. Mønster: `oneuptime.label.<dimension>=<value>` bliver til en label med navnet `<dimension>:<value>`.

Angiv labels på installationstidspunktet med `--set oneuptime.labels.<key>=<value>`:

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

Eller behold dem i en values-fil:

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

Labels matches uden hensyn til store/små bogstaver, så en eksisterende manuelt oprettet `Production`-label genbruges i stedet for at blive duplikeret. Labels, der tilføjes manuelt i OneUptime-brugergrænsefladen, fjernes aldrig af agenten.

## Opgradering af agenten

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values` bevarer din eksisterende konfiguration (preset, cluster-navn, filtre); angiv eventuelle nye `--set`-tilsidesættelser oven på det.

## Afinstallering af agenten

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## Hvad bliver indsamlet

| Kategori                                                                | Data                                                                                                                                    |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Node-metrikker**                                                      | CPU-udnyttelse, hukommelsesforbrug, filsystemforbrug, netværks-I/O                                                                      |
| **Pod-metrikker**                                                       | CPU-forbrug, hukommelsesforbrug, netværks-I/O, genstarter                                                                               |
| **Container-metrikker**                                                 | CPU-forbrug, hukommelsesforbrug pr. container                                                                                           |
| **Cluster-metrikker**                                                   | Node-tilstande, allokerbare ressourcer, pod-antal                                                                                       |
| **Kubernetes-events**                                                   | Advarsler, fejl, planlægningsevents                                                                                                     |
| **Pod-logs**                                                            | stdout/stderr-logs fra alle containere (via hostPath DaemonSet på standard-clusters eller via Kubernetes-API'en på Autopilot / Fargate) |
| **Applikationssporinger (traces)** _(via eBPF, slået til som standard)_ | HTTP-, gRPC-, SQL/Redis-spans fra hver pod — ingen SDK eller kodeændringer                                                              |
| **HTTP RED-metrikker** _(via eBPF)_                                     | `http.server.request.duration`, request- og response-body-størrelser, pr. tjeneste                                                      |
| **Service Graph** _(via eBPF)_                                          | Caller → callee request-rate, latency og fejl-edges — driver service map-visningen                                                      |
| **Netværksflow-metrikker** _(via eBPF)_                                 | Pod-til-pod TCP/UDP byte- og pakketællere med k8s-metadata                                                                              |
| **TCP-statistik** _(via eBPF)_                                          | Node-niveau RTT, fejlede-forbindelses- og retransmit-tællere                                                                            |

## Applikationssporinger & HTTP-metrikker via eBPF (slået til som standard)

Chartet kører en DaemonSet med [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) på hver node. Den indlæser eBPF-programmer i kernen og opfanger automatisk HTTP/HTTPS-, gRPC- og SQL/Redis-trafik fra enhver understøttet runtime (Go, .NET, Java, Node.js, Python, Ruby, Rust) — ingen SDK og ingen sidecar påkrævet. Sporinger og request-metrikker flyder derefter gennem den in-cluster collector til OneUptime.

**Krav:** Linux-kerne **5.8+** med BTF (standard på Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+). eBPF-DaemonSet'en kører i **privileged mode**, fordi den er nødt til det for at indlæse eBPF-programmer.

### Deaktivér eBPF-autoinstrumentering

Du bør deaktivere den, når:

- Du installerer på **GKE Autopilot** eller **EKS Fargate** — disse platforme blokerer privilegerede pods (brug `preset=gke-autopilot` / `preset=eks-fargate` og kombinér med `ebpf.enabled=false`).
- Noder kører en kerne ældre end 5.8 uden BTF-backports.
- Du allerede leverer sporinger via OpenTelemetry-SDK'er fra dine apps og ikke ønsker dubletter.

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### Slå individuelle signalfamilier til/fra

Alle slået til som standard. Slå en hvilken som helst fra med `--set ebpf.features.<name>=false`:

| `ebpf.features.*`         | Standard | Hvad den tilføjer                                                  |
| ------------------------- | -------- | ------------------------------------------------------------------ |
| `httpMetrics`             | til      | HTTP/gRPC RED-metrikker (request-rate, latency, fejl) pr. tjeneste |
| `spanMetrics`             | til      | Request-/response-størrelse og -varighed pr. span                  |
| `serviceGraph`            | til      | Caller → callee edge-metrikker; driver service map                 |
| `hostMetrics`             | til      | CPU og hukommelse pr. instrumenteret proces                        |
| `networkMetrics`          | til      | Pod-til-pod TCP/UDP flow-tællere                                   |
| `networkInterZoneMetrics` | fra      | Inter-zone-variant af netværksmetrikker (fordobler kardinalitet)   |
| `tcpStats`                | til      | Node-niveau TCP RTT-, fejlede-forbindelses- og retransmit-tællere  |

Cross-service trace-context-propagering er også slået til som standard — OBI injicerer W3C `traceparent` i udgående HTTP/TCP, så en request, der krydser pod A → pod B, fremstår som en enkelt sporing, uden SDK-ændringer nogen steder. Slå fra med `--set ebpf.contextPropagation=false`.

## Reducering af mængden af indsamlede data

Ud af boksen er agenten indstillet til **dækning** — den leverer metrikker, pod-logs og eBPF-sporinger fra hele clusteren, så hvert dashboard og hver monitor virker fra dag ét. På store eller travle clusters kan det være mere telemetri, end du har brug for, hvilket viser sig som højere ingest-volumen (og, på OneUptime Cloud, højere omkostninger). Intet her er påkrævet, men hvis en cluster sender mere, end du ønsker, er det disse knapper, du skal skrue på — nogenlunde i rækkefølge efter effekt.

Tricket er at **holde op med at indsamle det, du ikke vil kigge på**, i stedet for at indsamle alt og betale for at lagre det. Hvert håndtag nedenfor er en Helm-værdi, så du kan anvende det med `--set` på `helm upgrade --reuse-values` og rulle det tilbage på samme måde.

### Hvor volumen kommer fra

| Signal                              | Største kilde                                                | Skru ned med                                                                                 |
| ----------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| **Pod-logs**                        | Hver linje fra hver container, cluster-bredt                 | `logs.enabled`, `logs.mode`, `namespaceFilters`                                              |
| **eBPF-sporinger & span-metrikker** | Én sporing pr. request fra hver instrumenteret proces        | `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths`              |
| **Metrik-datapunkter**              | Scrape-frekvens × antal pods/containere                      | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Metrik-kardinalitet**             | Antal distinkte serier (pr. container, pr. PVC, …)           | `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics`, `kubeletstats.utilizationMetrics` |
| **Opt-in-ekstrafunktioner**         | Profilering, audit-logs, control plane, inter-zone-metrikker | Lad dem være slået fra (det er de allerede som standard)                                     |

### Håndtag 1 — Pod-logs er som regel den enkeltstørste kilde

Container-logs er næsten altid den største andel af ingest, fordi det er én post pr. loglinje fra hver container i clusteren.

- **Har du slet ikke brug for logs fra OneUptime?** Slå dem helt fra — du beholder alle metrikker, events og sporinger:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

- **Vil du kun have logs fra bestemte namespaces?** `namespaceFilters.include` afgrænser pod-logs i begge log-tilstande (og eBPF-sporinger sammen med dem). Matchningen sker på pod-log-stien, så filtrerede namespaces bliver aldrig engang læst:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` er allerede ekskluderet som standard.)

### Håndtag 2 — Beskær eBPF-autoinstrumentering

eBPF giver dig sporinger, RED-metrikker, service map og netværksflow-metrikker uden kodeændringer — men det er også den næststørste datakilde, fordi det udsender en span pr. request og flere metrik-familier pr. tjeneste. Du har tre niveauer af kontrol:

- **Leverer du allerede sporinger fra OTel-SDK'er, eller ønsker du ikke auto-sporinger?** Slå eBPF helt fra:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Behold sporingerne, drop de tunge metrik-familier.** [Signalfamilie-tabellen ovenfor](#toggle-individual-signal-families) viser hvert `ebpf.features.*`-flag. De familier med størst volumen er netværks- og span-metrikker — at slå dem fra efterlader sporinger, HTTP RED-metrikker og service map intakt:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  Lad `ebpf.features.networkInterZoneMetrics` være slået fra (dens standard) — den fordobler netværksflow-kardinaliteten.

- **Instrumentér kun de runtimes, du bryder dig om.** Som standard knytter OBI sig til hver proces, den genkender (`ebpf.autoTargetExe: "*"`). Indsnævr den til bestemte runtimes, eller tilføj binærfiler til skip-listen, for at reducere antallet af "tjenester" og sporinger, agenten producerer:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  Se [Slå individuelle signalfamilier til/fra](#toggle-individual-signal-families) og `excludeExePaths`-noten i chart-værdierne for de fulde standarder.

### Håndtag 3 — Sænk scrape-intervallerne

Metrik-volumen er direkte proportional med, hvor ofte agenten scraper. At fordoble et interval halverer nogenlunde antallet af datapunkter, den metrik producerer, uden tab af dækning — bare grovere opløsning. Hvis du ikke har brug for 30-sekunders granularitet, er 60s eller 120s en stor, sikker reduktion:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval` (standard `30s`) driver node- / pod- / container-metrikkerne (`kubeletstats`) og cluster-state-metrikkerne (`k8s_cluster`) — hovedparten af metrik-volumenen.
- `hostMetrics.collectionInterval` og `cadvisor.scrapeInterval` dækker OS-metrikkerne pr. node og throttling- / OOM-tællerne.
- `resourceSpecs.interval` (standard `300s`) styrer, hvor ofte fulde resource-specs (labels, annotationer, status) hentes — hæv den, hvis du ikke har brug for, at spec-ændringer afspejles hurtigt.
- Hvis du har aktiveret nogen af de valgfri scrapers, har de også deres egne knapper: `kubeStateMetrics.scrapeInterval`, `serviceMesh.*.scrapeInterval`, `coreDns.scrapeInterval`, `csi.scrapeInterval`.

### Håndtag 4 — Hold metrik-kardinaliteten afgrænset

Kardinalitet (antallet af distinkte tidsserier) betyder lige så meget som frekvens, fordi hver serie lagres og faktureres separat.

- **cAdvisor er allowlisted med vilje.** cAdvisor-receiveren (slået til som standard) kan udsende hundredvis af metrikker; chartet videresender kun de få, der driver monitorer (`cadvisor.metricsAllowlist`). Hold listen stram — **hver post beholdes pr. container, så én ekstra metrik ganges med clusterens antal containere.** kube-state-metrics er slået fra som standard, men hvis du aktiverer det (`kubeStateMetrics.enabled=true`), afgrænser dens `kubeStateMetrics.metricsAllowlist` kardinaliteten på samme måde.
- **Volumen-metrikker pr. PVC** (`kubeletstats.volumeMetrics.enabled`, slået til som standard) udsender én serie pr. PVC pr. pod. Det er fint for de fleste clusters, men kan være betydeligt på stateful workloads (Kafka, databaser) med tusindvis af PVC'er — slå det fra der, hvis du ikke holder øje med PVC-diskplads:

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **Mætnings-metrikker** (`kubeletstats.utilizationMetrics.enabled`, slået til som standard) tilføjer 8 afledte "% af request/limit"-familier. De er billige (ingen ekstra scrape), men hvis du ikke bruger CPU/Memory-vs-limit-monitorerne, kan du droppe dem med `--set kubeletstats.utilizationMetrics.enabled=false`.

### Håndtag 5 — Lad de tunge opt-in-funktioner være slået fra

Disse er **slået fra som standard** netop fordi de tilføjer belastning — aktivér kun en, når du aktivt bruger det, den driver, og slå den fra igen, hvis du bare prøvede den af:

| Værdi                                                     | Tilføjer                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `profiling.enabled`                                       | Kontinuerlig CPU-profilering-DaemonSet — tungere end eBPF-sporinger                         |
| `auditLogs.enabled`                                       | Hver Kubernetes-API-request som en log-post (høj volumen)                                   |
| `controlPlane.enabled`                                    | etcd- / API-server- / scheduler- / controller-manager-metrikker                             |
| `kubeStateMetrics.enabled`                                | CrashLoop- / ImagePull- / scheduling-reason-metrikker (tilføjer en KSM-Deployment + scrape) |
| `ebpf.features.networkInterZoneMetrics`                   | Fordobler netværksflow-metrik-kardinaliteten                                                |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | Ekstra Prometheus-scrape-jobs                                                               |

### Et slankt udgangspunkt

Hvis du ønsker et minimalt fodaftryk og vil tilføje signaler igen, efterhånden som du får brug for dem, dropper denne **kun metrikker + events**-profil logs og eBPF og halverer scrape-raten:

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

collectionInterval: 60s

logs:
  enabled: false # no pod logs

ebpf:
  enabled: false # no auto-traces

hostMetrics:
  collectionInterval: 60s

cadvisor:
  scrapeInterval: 60s
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

Derfra kan du genaktivere, hvad du har brug for: `logs.enabled=true` for et par namespaces i API-tilstand, eller `ebpf.enabled=true` med en indsnævret `autoTargetExe`.

> **Pas på, hvad du skærer væk.** Nogle monitorer afhænger af bestemte signaler: at deaktivere `cadvisor` fjerner OOM-kill- og CPU-throttling-monitorerne; at deaktivere `kubeletstats.volumeMetrics` fjerner PVC-lav-disk-monitoren; at deaktivere logs fjerner log-baserede advarsler. Beskær de signaler, du ikke handler på, ikke dem, en monitor holder øje med.

### Mål effekten

Telemetri-forbrug aggregeres pr. dag, så tjek tendensen over en dag eller to under **Project Settings → Usage History** for at bekræfte faldet — det flytter sig ikke i det øjeblik, du anvender en ændring. Ændr ét håndtag ad gangen, så du kan tilskrive forskellen — logs fra, så interval op, så eBPF beskåret — i stedet for at skrue alt ned på én gang og miste en monitor, du faktisk stolede på.

## Fejlfinding

> **Hurtigste vej — kør diagnosticeringsscriptet.** Det inspicerer pod-helbred, afkoder og validerer ingestion-nøglen, kontrollerer, at din cluster kan nå OneUptime, og spørger OneUptime, om dit token faktisk accepteres — og udskriver derefter en enkelt root-cause-konklusion:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> Det læser kun cluster-tilstand og kører et par prober; det ændrer intet. For den mest nøjagtige egress-test skal du først installere med `--set debug.enabled=true` (dette tilføjer en lille network-tools sidecar til agent-poddene, så scriptet tester collectorens nøjagtige egress-sti) og derefter køre igen.

### Installationen fejler med "hostPath volumes are not allowed" eller en Pod Security admission-fejl

Din cluster blokerer `hostPath` — almindeligt på **GKE Autopilot** og **EKS Fargate**. Skift til API-tilstands-forudindstillingen:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### Agenten viser "Disconnected"

En clusters forbundne status drives udelukkende af, at telemetri ankommer — hvis ingen data lander, markeres clusteren som disconnected efter ~15 minutter. Så "disconnected" og "ingen metrikker" har næsten altid den **samme** årsag: agentens telemetri bliver ikke accepteret.

Den mest almindelige grund — især efter en geninstallation — er en **forkert eller tilbagekaldt ingestion-nøgle**. Dette er let at overse, fordi OTLP-ingest-endpoints med vilje returnerer HTTP `200`, selv for et dårligt token (så en fejlkonfigureret collector ikke kan retry-storme serveren). Resultatet: collectoren rapporterer succes, dens logs viser ingen fejl, og dataene droppes lydløst.

1. Kontrollér, at agent-poddene kører: `kubectl get pods -n oneuptime-agent`
2. Kontrollér metrics-collector-logsene: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (ingen fejl her betyder **ikke**, at data lander — se ovenfor)
3. **Validér ingestion-nøglen.** Spørg OneUptime direkte, om dit token accepteres (`200` = gyldigt, `401` = ukendt/tilbagekaldt):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   Hvis den returnerer `401`, er nøglen i din release forkert eller blev tilbagekaldt. Kopiér en aktiv nøgle fra _Project Settings → Telemetry Ingestion Keys_ og redeploy:

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. Verificér, at din OneUptime-URL er korrekt, og at din cluster kan nå den over netværket.
5. Hvis du ændrede `clusterName` ved geninstallation, fremstår agenten som en **ny** cluster — den gamle post forbliver "Disconnected" (det er forventet; den er forældet).

### Ingen logs vises (kun API-tilstand)

1. Bekræft, at log tailer-podden er Ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`
2. Kontrollér dens `/healthz` — den rapporterer antal aktive streams og den seneste eksportfejl
3. Kontrollér logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. For meget store clusters kan en enkelt replica være en flaskehals — shard pr. namespace ved at bruge `namespaceFilters.include` på separate releases

### Ingen metrikker vises

1. Udeluk først en afvist ingestion-nøgle — det er den mest almindelige årsag og er usynlig fra agentsiden. Se [Agenten viser "Disconnected"](#agent-shows-disconnected) ovenfor (eller kør blot diagnosticeringsscriptet).
2. Kontrollér, at cluster-identifikatoren matcher den værdi, du angav som `clusterName`
3. Verificér RBAC-tilladelserne: `kubectl get clusterrolebinding | grep kubernetes-agent`
4. Kontrollér OTel-collector-logsene for eksportfejl

### eBPF-pods er CrashLoopBackOff eller kan ikke starte

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

Almindelige årsager:

- **Kerne for gammel eller BTF mangler.** OBI kræver Linux 5.8+ med BTF. Kør `uname -r` på en node. Hvis du ikke kan opgradere, så deaktivér eBPF: `--set ebpf.enabled=false`.
- **Privilegerede pods blokeret.** Nogle clusters afviser privilegerede pods (GKE Autopilot, EKS Fargate og låste miljøer). Deaktivér eBPF.
- **`debugfs` / `tracefs` ikke monteret på hosten.** `tcpStats`-funktionen knytter sig til kernel-tracepoints, der kræver dem. Chartet monterer begge via `hostPath` — men hvis din host ikke eksponerer dem, så deaktivér kun den familie: `--set ebpf.features.tcpStats=false`.

### Ingen applikationssporinger vises

1. Bekræft, at eBPF-DaemonSet'en er sund: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. Slå debug-trace-printeren til for at bekræfte, at OBI opfanger trafik: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, og kontrollér derefter `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`
3. Hvis du ser spans i OBI's stdout, men ikke i dashboardet, er problemet collector → OneUptime-eksporten — kontrollér metrics-collector-poddens logs.

## Næste skridt

- Konfigurér **Kubernetes-monitorer** oven på de metrikker, denne agent indsamler — se [Kubernetes Agent (monitorer)](/docs/monitor/kubernetes-agent).
- Tilføj **Logs-monitorer** for at advare om specifikke log-mønstre (f.eks. fejlantal over en tærskel pr. pod eller pr. namespace).
- For ikke-Kubernetes-hoster (Linux- / macOS- / Windows-VM'er og bare metal) kan du bruge siden [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
