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

På en **standard**-cluster vil du se en cluster-collector Deployment plus én node-collector DaemonSet-pod pr. node:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

På **GKE Autopilot** kører node-collectoren stadig — den indsamler kubelet- og cAdvisor-metrikker uden at have brug for hostPath — og en ekstra Deployment følger pod-logs via Kubernetes-API'en:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
```

På **EKS Fargate** vil du se to Deployments og ingen DaemonSet — Fargate giver hver pod sin egen mikro-VM og planlægger aldrig DaemonSets, så metrikker på node-niveau er ikke tilgængelige der:

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

For at ignorere ét støjende namespace, men beholde alle andre, skal du bruge `exclude` i stedet. `exclude` vinder altid over `include`, og den medfølgende standard er `[kube-system]` — så list det igen, hvis du stadig ønsker det ekskluderet:

```bash
  --set "namespaceFilters.exclude={kube-system,noisy-namespace}"
```

For **pod-logs og eBPF-sporinger koster dette ingenting**: namespacet er en del af pod-log-stien og af OBI's procesopdagelse, så et filtreret namespace bliver aldrig læst i første omgang — ingen CPU, ingen egress.

#### Anvendelse af namespace-filtre på metrikker og sporinger

Som standard dækker listerne ovenfor kun pod-logs og eBPF-sporinger. `applyTo` udvider dem til andre signaler:

```bash
  --set namespaceFilters.applyTo.metrics=true \
  --set namespaceFilters.applyTo.traces=true
```

| Indstilling | Hvad den dækker |
| ----------- | --------------- |
| `applyTo.metrics` | Metrikker pr. pod / pr. container fra kubeletstats, cAdvisor og kube-state-metrics |
| `applyTo.traces` | Spans, som dine applikationer sender til agentens OTLP-endpoint (eBPF-spans er allerede afgrænset) |

Begge er **slået fra som standard** med vilje. `exclude: [kube-system]` leveres som standard, så hvis de blev slået til automatisk, ville det lydløst slette kube-system-metrikker fra hver eksisterende installation ved opgradering.

> **Metrikker på node- og cluster-niveau beholdes altid.** Et namespace er en egenskab ved en pod, ikke ved en node, så serier som node-CPU, node-hukommelse og filsystemforbrug har intet at matche på og droppes aldrig. `applyTo.metrics` beskærer kardinaliteten pr. pod uden nogensinde at gøre dig blind for, at en node bliver dårlig.

Kubernetes-**events** kan ikke namespace-filtreres ved agenten. De ankommer fra `k8sobjects`-receiveren uden en `k8s.namespace.name`-attribut — namespacet ligger inde i event-body'en — så der er intet, et filter kan matche på. Drop dem server-side i stedet (se nedenfor).

### Filtrering efter log-alvorlighed

`filters.logs.minSeverity` dropper **pod-log**-poster under en alvorlighed, ved agenten, før noget sendes:

```bash
  --set filters.logs.minSeverity=WARN
```

Accepterer `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. `WARN` beholder WARN, ERROR og FATAL og dropper INFO, DEBUG og TRACE. Standarden (`""`) beholder alt. Det gælder i **begge** log-tilstande — i `daemonset`-tilstand via collectoren, i `api`-tilstand inde i log-tailer'en selv — så forudindstillingerne kan ikke slå det fra bag om ryggen på dig.

Container-runtimes registrerer ikke en alvorlighed på loglinjen, så agenten parser selv en ud af logteksten (`[ERROR]`, `WARN:`, `level=info`, …).

> **Kubernetes-events og resource-specifikationer filtreres aldrig af dette.** De ankommer fra Kubernetes-API'et uden en alvorlighed af egen, så en tærskel ville slette hele feedet i stedet for at tynde det ud — inklusive de `FailedScheduling`-, `BackOff`- og `OOMKilling`-advarsler, du helst vil have. De har lav volumen og høj værdi, så agenten sender dem altid. For at tynde dem ud skal du i stedet bruge dashboardets server-side **Logs → Settings → Drop Filters**.

**Hvad der sker med en linje uden et genkendeligt niveau, afhænger af log-tilstanden**, fordi de to tilstande har forskellig information til rådighed:

| Tilstand | Linje uden mærkat | Hvorfor |
| -------- | ----------------- | ------- |
| `daemonset` | `stderr` → behandles som ERROR (beholdes), `stdout` → behandles som INFO (droppes af en WARN-tærskel) | Container-runtimen registrerer, hvilken stream hver linje kom fra. |
| `api` | **Beholdes** altid | Kubernetes' `pods/log`-API fletter stdout og stderr sammen til én stream uden markør pr. linje. I stedet for at gætte beholder agenten linjen. |


Flerlinje-events samles **før** filtrering i begge tilstande, så en Java-stacktrace bedømmes på sin første linje og beholdes eller droppes som helhed — du får aldrig en nøgen `ERROR`-linje med dens frames skrællet af.

### Inkludering eller ekskludering af metrikker efter navn

`filters.metrics` styrer, hvilke metrikker der forlader clusteren, på tværs af hver receiver i pipelinen.

**Drop et par støjende metrikker** (en denylist — som regel det, du vil have):

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**Send kun et fast sæt** (en allowlist — alt andet droppes):

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.usage","k8s.pod.memory.usage"]'
```

**Match efter mønster** i stedet for præcist navn:

```bash
  --set filters.metrics.matchType=regexp \
  --set-json 'filters.metrics.exclude=["^container_network_"]'
```

| Nøgle | Betydning |
| --- | --------- |
| `filters.metrics.exclude` | Metriknavne, der skal droppes. Anvendes oven på `include`, så exclude vinder altid. |
| `filters.metrics.include` | Når den ikke er tom, sendes **kun** disse. |
| `filters.metrics.matchType` | `strict` (præcist navn, standarden) eller `regexp` (RE2, **uforankret**). |

Noter, der vil spare dig for en hændelse:

- `regexp` er **uforankret** — `system.cpu` matcher også `system.cpu.time`. Forankr den (`^system\.cpu$`), når du mener præcis én metrik.
- RE2 har **ingen lookahead**, så `^(?!container_)` kan ikke kompilere. Udtryk "alt undtagen" med `include`, ikke med et negativt regex.
- `include` spænder over hver receiver på én gang. En allowlist, der glemmer en metrik, fjerner lydløst de monitorer, der er bygget på den. Foretræk `exclude`, medmindre du reelt ønsker et lukket sæt.
- Brug `--set-json` (eller en values-fil) til lister. Almindelig `--set` erstatter en liste i stedet for at flette den.

> **Test et regex, før du ruller det ud.** Mønstre kompileres af collectoren ved opstart, ikke pr. post, så et ugyldigt mønster opfører sig ikke forkert i stilhed — collectoren nægter at starte og går i CrashLoopBackOff, hvilket tager den collectors **logs** ned sammen med dens metrikker. Helm kan ikke kompilere RE2, så `helm upgrade` accepterer et dårligt mønster uden at kny.

### Deaktivér logindsamling

Hvis du ikke har brug for pod-logs:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

Dine metrikker er upåvirkede: node-collectoren kører videre for kubelet-, cAdvisor- og host-metrikker, den holder blot op med at læse pod-logs. Log-baserede advarsler stopper, og intet andet gør.

### Gennemtving en bestemt logindsamlingstilstand

Avancerede brugere kan tilsidesætte forudindstillingens valg med `logs.mode`:

- `logs.mode=daemonset` — hostPath DaemonSet (laveste overhead, kræver hostPath)
- `logs.mode=api` — Kubernetes API log tailer Deployment (virker på enhver cluster)
- `logs.mode=disabled` — ingen logindsamling

> Log-tilstanden bestemmer kun, hvor **pod-logs** kommer fra. Node-metrikker indsamles uafhængigt af den, så `api` og `disabled` bevarer dine kubelet-, cAdvisor- og host-metrikker.
>
> Den ene undtagelse er platformen, ikke tilstanden: **EKS Fargate kan slet ikke planlægge DaemonSets**, så der er ingen node-collector der, og metrikker pr. node, pr. pod og pr. container er utilgængelige. GKE Autopilot kører node-collectoren fint, men blokerer `hostPath`, så den indsamler kubelet- og cAdvisor-metrikker uden `hostmetrics`-metrikkerne (disk-I/O, inodes, NIC-fejl), der skal læse hostens `/proc` og `/sys`.

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
| **Pod-logs**                        | Hver linje fra hver container, cluster-bredt                 | `namespaceFilters`, `filters.logs.minSeverity`, `logs.enabled`, `logs.mode`                  |
| **eBPF-sporinger & span-metrikker** | Én sporing pr. request fra hver instrumenteret proces        | `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths`              |
| **Metrik-datapunkter**              | Scrape-frekvens × antal pods/containere                      | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Metrik-kardinalitet**             | Antal distinkte serier (pr. container, pr. PVC, …)           | `filters.metrics.exclude`, `namespaceFilters.applyTo.metrics`, `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics` |
| **Opt-in-ekstrafunktioner**         | Profilering, audit-logs, control plane, inter-zone-metrikker | Lad dem være slået fra (det er de allerede som standard)                                     |

To måder at skære volumen ned på, og det er værd at vide, hvilken af dem du bruger:

- **Ved receiveren** — dataene indsamles aldrig. `namespaceFilters` på pod-logs, `cadvisor.metricsAllowlist`, et længere `collectionInterval`. Koster ingenting at køre og sparer CPU, egress og ingest på én gang. Foretræk altid disse, hvor de dækker dit tilfælde.
- **Ved filter-processoren** — dataene indsamles og droppes derefter før eksport. `filters.logs.minSeverity`, `filters.metrics.*`, `namespaceFilters.applyTo.*`. Lidt mere collector-CPU, men det virker på tværs af receivere og kan udtrykke ting, en receiver ikke kan.

Begge er **uoprettelige**: det, du dropper her, når aldrig OneUptime, og enhver monitor bygget på det forstummer. Hvis du hellere vil beslutte det senere, kan OneUptime droppe data server-side i stedet (**Logs → Settings → Drop Filters**, **Metrics → Settings → Pipeline Rules**) — det koster stadig egress, men det er en indstilling, du kan ændre uden en redeploy.

### Håndtag 1 — Pod-logs er som regel den enkeltstørste kilde

Container-logs er næsten altid den største andel af ingest, fordi det er én post pr. loglinje fra hver container i clusteren.

- **Vil du kun have logs fra bestemte namespaces?** `namespaceFilters` afgrænser pod-logs i begge log-tilstande (og eBPF-sporinger sammen med dem). Matchningen sker på pod-log-stien, så filtrerede namespaces bliver aldrig engang læst — dette er det billigste håndtag i dette dokument:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` er allerede ekskluderet som standard.) For at beholde alle namespaces på nær ét skal du bruge `--set "namespaceFilters.exclude={kube-system,noisy-namespace}"`.

- **Bekymrer du dig kun om advarsler og fejl?** `filters.logs.minSeverity` dropper resten ved agenten. På en snakkesalig cluster er dette ofte den enkeltstørste reduktion, der er tilgængelig, fordi INFO og DEBUG udgør hovedparten af de fleste applikationers output:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  Se [Filtrering efter log-alvorlighed](#filtrering-efter-log-alvorlighed) for, hvordan alvorlighed bestemmes, og hvad der sker med logs, den ikke kan klassificere.

- **Har du slet ikke brug for pod-logs fra OneUptime?** Slå dem fra:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > Dette stopper kun pod-logs. Node-, pod- og container-metrikker flyder videre, og monitorerne bygget på dem (OOM-kills, CPU-throttling, PVC-lav-disk) virker fortsat — node-collectoren bliver, den holder blot op med at læse `/var/log/pods`. Det samme gælder for `logs.mode: api` og `logs.mode: disabled`.

### Håndtag 2 — Beskær eBPF-autoinstrumentering

eBPF giver dig sporinger, RED-metrikker, service map og netværksflow-metrikker uden kodeændringer — men det er også den næststørste datakilde, fordi det udsender en span pr. request og flere metrik-familier pr. tjeneste. Du har tre niveauer af kontrol:

- **Leverer du allerede sporinger fra OTel-SDK'er, eller ønsker du ikke auto-sporinger?** Slå eBPF helt fra:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Behold sporingerne, drop de tunge metrik-familier.** [Signalfamilie-tabellen ovenfor](#slå-individuelle-signalfamilier-tilfra) viser hvert `ebpf.features.*`-flag. De familier med størst volumen er netværks- og span-metrikker — at slå dem fra efterlader sporinger, HTTP RED-metrikker og service map intakt:

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

  Se [Slå individuelle signalfamilier til/fra](#slå-individuelle-signalfamilier-tilfra) og `excludeExePaths`-noten i chart-værdierne for de fulde standarder.

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

- **Drop bestemte metrikker efter navn.** Allowlisterne ovenfor er pr. receiver; `filters.metrics.exclude` spænder over dem alle, så brug den til alt det, knapperne på receiver-niveau ikke kan udtrykke:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.metrics.matchType=regexp \
    --set-json 'filters.metrics.exclude=["^container_network_"]'
  ```

  Se [Inkludering eller ekskludering af metrikker efter navn](#inkludering-eller-ekskludering-af-metrikker-efter-navn) for præcis-vs-regex-matchning og allowlist-formen.

- **Drop et helt namespaces metrikker.** Hvis et namespace er støjende, men du stadig vil have dets noder overvåget, anvender `namespaceFilters.applyTo.metrics=true` dine eksisterende namespace-lister på serier pr. pod og pr. container. Serier på node- og cluster-niveau beholdes altid:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set namespaceFilters.applyTo.metrics=true
  ```

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

Hvis du ønsker et mindre fodaftryk, men stadig vil have monitorerne til at virke, bevarer denne profil **fuld metrik-dækning** og skærer de to ting væk, der faktisk driver volumen — loglinjer og eBPF-spans:

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

# Halve the metric data points. Coarser resolution, same coverage.
collectionInterval: 60s
hostMetrics:
  collectionInterval: 60s
cadvisor:
  scrapeInterval: 60s

# Keep pod logs, but only ship the ones worth alerting on. (Metrics do
# not depend on this — the node collector runs either way.)
logs:
  enabled: true
  mode: daemonset

filters:
  logs:
    minSeverity: WARN # drop INFO / DEBUG / TRACE at the agent

namespaceFilters:
  exclude:
    - kube-system
    - noisy-namespace

ebpf:
  enabled: true
  features:
    networkMetrics: false # the heaviest eBPF families
    tcpStats: false
    spanMetrics: false
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

Stram yderligere efter behov: hæv `minSeverity` til `ERROR`, tilføj `namespaceFilters.applyTo.metrics=true`, eller sæt `ebpf.enabled=false`, hvis du allerede leverer sporinger fra OTel-SDK'er.

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

1. Udeluk først en afvist ingestion-nøgle — det er den mest almindelige årsag og er usynlig fra agentsiden. Se [Agenten viser "Disconnected"](#agenten-viser-disconnected) ovenfor (eller kør blot diagnosticeringsscriptet).
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
