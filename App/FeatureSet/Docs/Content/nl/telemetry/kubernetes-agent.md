# OneUptime Kubernetes Agent (Helm)

## Overzicht

De OneUptime Kubernetes Agent is een vooraf samengestelde Helm chart die een op OpenTelemetry gebaseerde collector-pipeline op je cluster installeert. Hij levert node-, pod-, container- en clustermetrieken; Kubernetes-events; pod-logs; en — met eBPF standaard ingeschakeld — applicatietraces, HTTP RED-metrieken, service-graph-data en pod-naar-pod netwerkflowmetrieken. Geen codewijzigingen, geen SDK's, één `helm install`.

Deze pagina is de **installatiegids**. Voor het configureren van Kubernetes-monitors en -alerts bovenop de data die de agent verzamelt, zie [Kubernetes Agent (monitors)](/docs/monitor/kubernetes-agent).

## Vereisten

- Een draaiend Kubernetes-cluster (v1.23+)
- `kubectl` geconfigureerd om toegang te krijgen tot je cluster
- `helm` v3 geïnstalleerd
- Een **OneUptime API-sleutel** — maak er een aan via _Project Settings → API Keys_

## Stap 1 — Voeg de OneUptime Helm Repository toe

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Stap 2 — Kies een Preset voor je Cluster

De chart biedt één optie op het hoogste niveau — `preset` — die compatibele standaardwaarden kiest voor jouw Kubernetes-distributie. Het regelt zaken die je anders handmatig zou moeten afstemmen: of logs verzonden worden via een hostPath DaemonSet of via de Kubernetes API, en welke security context wordt toegepast.

| `preset`                 | Gebruik voor                                                                          | Logverzameling                                                         |
| ------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `standard` _(standaard)_ | Zelfbeheerde clusters, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet die `/var/log/pods` leest via hostPath (laagste overhead)    |
| `gke-autopilot`          | **GKE Autopilot**                                                                     | Kubernetes API log-tailer Deployment (geen hostPath, geen hosttoegang) |
| `eks-fargate`            | **EKS Fargate**                                                                       | Kubernetes API log-tailer Deployment (geen hostPath, geen hosttoegang) |

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

Op een **standaard**cluster zie je een cluster-collector Deployment plus één node-collector DaemonSet-pod per node:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

Op **GKE Autopilot** draait de node-collector nog steeds — hij verzamelt kubelet- en cAdvisor-metrieken zonder hostPath nodig te hebben — en een extra Deployment leest pod-logs via de Kubernetes API:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
```

Op **EKS Fargate** zie je twee Deployments en geen DaemonSet — Fargate geeft elke pod zijn eigen micro-VM en plant nooit DaemonSets in, dus metrieken op nodeniveau zijn daar niet beschikbaar:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

Zodra de agent verbinding maakt, verschijnt je cluster automatisch in de sectie **Kubernetes** van het OneUptime-dashboard.

## Configuratieopties

### Namespace-filtering

`namespaceFilters` beperkt **pod-logs** (zowel de hostPath DaemonSet als de API-log-tailer) en **eBPF-traces** tot de namespaces die je kiest. Standaard wordt `kube-system` uitgesloten. Om die signalen tot specifieke namespaces te beperken:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

Om één luidruchtige namespace te negeren terwijl je alle andere behoudt, gebruik je in plaats daarvan `exclude`. `exclude` wint altijd van `include`, en de meegeleverde standaardwaarde is `[kube-system]` — noem hem dus opnieuw als je wilt dat hij uitgesloten blijft:

```bash
  --set "namespaceFilters.exclude={kube-system,noisy-namespace}"
```

Voor **pod-logs en eBPF-traces kost dit niets**: de namespace maakt deel uit van het pod-log-pad en van OBI's procesdetectie, dus een gefilterde namespace wordt sowieso nooit gelezen — geen CPU, geen egress.

#### Namespace-filters toepassen op metrieken en traces

Standaard dekken de bovenstaande lijsten alleen pod-logs en eBPF-traces. `applyTo` breidt ze uit naar andere signalen:

```bash
  --set namespaceFilters.applyTo.metrics=true \
  --set namespaceFilters.applyTo.traces=true
```

| Instelling | Wat het dekt |
| ---------- | ------------ |
| `applyTo.metrics` | Metrieken per pod / per container van kubeletstats, cAdvisor en kube-state-metrics |
| `applyTo.traces` | Spans die je applicaties naar het OTLP-endpoint van de agent sturen (eBPF-spans zijn al afgebakend) |

Beide staan bewust **standaard uit**. `exclude: [kube-system]` wordt als standaardwaarde meegeleverd, dus door ze automatisch in te schakelen zouden bij een upgrade stilzwijgend de kube-system-metrieken van elke bestaande installatie worden verwijderd.

> **Metrieken op node- en clusterniveau worden altijd behouden.** Een namespace is een eigenschap van een pod, niet van een node, dus series zoals node-CPU, node-geheugen en bestandssysteemgebruik hebben niets om op te matchen en worden nooit weggegooid. `applyTo.metrics` snoeit de cardinaliteit per pod zonder je ooit blind te maken voor een node die uitvalt.

Kubernetes-**events** zijn bij de agent niet op namespace te filteren. Ze komen binnen via de `k8sobjects`-receiver zonder een `k8s.namespace.name`-attribuut — de namespace zit in de event-body — dus er is niets waar een filter op kan matchen. Laat die in plaats daarvan server-side vallen (zie hieronder).

### Filteren op log-severity

`filters.logs.minSeverity` laat **pod-log**records onder een bepaalde severity vallen, bij de agent, voordat er iets wordt verzonden:

```bash
  --set filters.logs.minSeverity=WARN
```

Accepteert `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. `WARN` behoudt WARN, ERROR en FATAL en laat INFO, DEBUG en TRACE vallen. De standaardwaarde (`""`) behoudt alles. Het geldt in **beide** logmodi — in `daemonset`-modus via de collector, in `api`-modus binnen de log-tailer zelf — zodat de presets het niet onder je vandaan kunnen uitschakelen.

Container-runtimes registreren geen severity op de logregel, dus parseert de agent er zelf een uit de logtekst (`[ERROR]`, `WARN:`, `level=info`, …).

> **Kubernetes-events en resource-specs worden hier nooit door gefilterd.** Ze komen binnen via de Kubernetes API zonder een eigen severity, dus een drempel zou de hele feed verwijderen in plaats van hem uit te dunnen — inclusief de `FailedScheduling`-, `BackOff`- en `OOMKilling`-waarschuwingen die je juist het hardst nodig hebt. Ze zijn laag in volume en hoog in waarde, dus de agent verzendt ze altijd. Om ze uit te dunnen, gebruik je in plaats daarvan de server-side **Logs → Settings → Drop Filters** in het dashboard.

**Wat er gebeurt met een regel zonder herkenbaar niveau hangt af van de logmodus**, omdat de twee modi over verschillende informatie beschikken:

| Modus | Regel zonder label | Waarom |
| ----- | ------------------ | ------ |
| `daemonset` | `stderr` → behandeld als ERROR (behouden), `stdout` → behandeld als INFO (weggegooid bij een WARN-drempel) | De container-runtime registreert uit welke stream elke regel afkomstig is. |
| `api` | Altijd **behouden** | De Kubernetes `pods/log`-API voegt stdout en stderr samen tot één enkele stream zonder markering per regel. In plaats van te gokken behoudt de agent de regel. |

> Dus `api`-modus gooit strikt minder weg dan `daemonset`-modus. Dat is bewust: een Python-traceback of `npm ERR!` bevat geen severity-trefwoord, en het stilzwijgend verwijderen daarvan is precies het falen waartegen een severity-drempel je hoort te beschermen.

Multi-regel-events worden in beide modi **vóór** het filteren weer samengevoegd, dus een Java-stacktrace wordt beoordeeld op zijn eerste regel en in zijn geheel behouden of weggegooid — je krijgt nooit een kale `ERROR`-regel waarvan de frames zijn afgestript.

### Metrieken op naam in- of uitsluiten

`filters.metrics` bepaalt welke metrieken het cluster verlaten, over elke receiver in de pipeline heen.

**Laat een paar luidruchtige metrieken vallen** (een denylist — meestal wat je wilt):

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**Verzend alleen een vaste set** (een allowlist — al het andere wordt weggegooid):

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.utilization","k8s.pod.memory.usage"]'
```

**Match op patroon** in plaats van op exacte naam:

```bash
  --set filters.metrics.matchType=regexp \
  --set-json 'filters.metrics.exclude=["^container_network_"]'
```

| Sleutel | Betekenis |
| --- | --------- |
| `filters.metrics.exclude` | Metrieknamen om te laten vallen. Wordt bovenop `include` toegepast, dus exclude wint altijd. |
| `filters.metrics.include` | Indien niet leeg, worden **alleen** deze verzonden. |
| `filters.metrics.matchType` | `strict` (exacte naam, de standaard) of `regexp` (RE2, **niet verankerd**). |

Notities die je een incident besparen:

- `regexp` is **niet verankerd** — `system.cpu` matcht ook `system.cpu.time`. Veranker het (`^system\.cpu$`) als je precies één metriek bedoelt.
- RE2 heeft **geen lookahead**, dus `^(?!container_)` compileert niet. Druk "alles behalve" uit met `include`, niet met een negatieve regex.
- `include` beslaat elke receiver tegelijk. Een allowlist die een metriek vergeet, verwijdert stilzwijgend de monitors die erop gebouwd zijn. Geef de voorkeur aan `exclude` tenzij je echt een gesloten set wilt.
- Gebruik `--set-json` (of een values-bestand) voor lijsten. Een gewone `--set` vervangt een lijst in plaats van hem samen te voegen.

> **Test een regex voordat je hem uitrolt.** Patronen worden door de collector bij het opstarten gecompileerd, niet per record, dus een ongeldig patroon gedraagt zich niet stilletjes verkeerd — de collector weigert te starten en belandt in CrashLoopBackOff, waarmee ook de **logs** van die collector uitvallen, samen met zijn metrieken. Helm kan RE2 niet compileren, dus `helm upgrade` accepteert een fout patroon zonder morren.

### Trace-sampling

Elke andere knop op deze pagina verwijdert een **categorie** telemetrie — een namespace, een severity, een metrieknaam. Sampling werkt anders: het behoudt elke categorie en dunt in plaats daarvan de populatie uit. Zet `sampling.traces.percentage` op het aandeel traces dat je wilt behouden:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

Dat behoudt één trace op de tien en gooit de andere negen weg bij de agent, voordat ze je cluster verlaten.

**Je krijgt hele traces, geen fragmenten.** De beslissing is een hash van de trace-ID en geen muntworp per span, dus elke span van een trace wordt samen behouden of weggegooid — de traces die overleven, zijn compleet en van begin tot eind leesbaar. Dat is de eigenschap die sampling veilig maakt om aan te zetten.

**Je metriek-gebaseerde monitors bewegen niet mee.** De eBPF RED-metrieken — request rate, error rate, duur — zijn een *metrische* familie. OBI berekent ze uit elke request en ze reizen via de metrics-pipeline, waar de sampler niet in zit. Bij `percentage: 10` krijg je een tiende van de traces en 100% accurate rate/errors/latentie. Dashboards en monitors die op die metrieken gebouwd zijn, blijven onaangetast.

**Je span-gebaseerde monitors wel.** Alles wat OneUptime uit de spans zelf afleidt, schaalt mee omlaag met het percentage — lees de waarschuwing hieronder voordat je dit aanzet.

| Sleutel | Betekenis |
| --- | --------- |
| `sampling.traces.percentage` | Percentage traces om te **behouden**, 0-100. Standaard `100` (alles behouden). |
| `sampling.traces.hashSeed` | Seed voor de hash van de trace-ID. Standaard `22`. |

Notities die je een incident besparen:

- **`0` behoudt helemaal geen traces.** Het is een percentage, geen uitschakelknop — het verwijdert elke trace terwijl de eBPF-DaemonSet blijft draaien en je geld blijft kosten. Wil je geen traces, gebruik dan `ebpf.enabled=false`. Wil je geen traces maar *wel* RED-metrieken en de service-map, laat eBPF dan aan en zet dit bewust op `0`.
- **Geldt alleen wanneer `ebpf.enabled` aanstaat.** De traces-pipeline bestaat anders niet, dus bij `ebpf.enabled=false` doet deze waarde niets.
- **Alleen traces.** Er is geen `sampling.logs` of `sampling.metrics`, en dat is bewust — zie de notitie hieronder.
- **Breukgetallen vereisen `--set-json`, en ze hebben een ondergrens.** `--set sampling.traces.percentage=0.5` mislukt, omdat Helm `0.5` als een string leest. Gebruik `--set-json 'sampling.traces.percentage=0.5'` of een values-bestand. Hele getallen werken prima met `--set`. Onder ongeveer `0.0061` kwantiseert het percentage naar nul en gedraagt het zich precies als `0` — elke trace weggegooid, zonder foutmelding. `0.01` (één op de tienduizend) is de kleinste waarde die doet wat hij belooft.
- **Multi-cluster werkt standaard.** Twee agents behouden dezelfde trace alleen als ze het eens zijn over zowel `hashSeed` als `percentage`. Beide hebben overal dezelfde standaardwaarde, dus een trace die twee clusters kruist, overleeft in zijn geheel zonder extra configuratie. Wijzig `hashSeed` alleen om twee sampling-niveaus bewust te *decorreleren* — omdat de beslissing een drempel op dezelfde hash is, nestelen twee niveaus met dezelfde seed maar verschillende percentages in elkaar, waardoor een tweede niveau simpelweg de traces herkiest die het eerste al had behouden, in plaats van onafhankelijk te trekken.
- **Pod-logs worden nooit gesampled**, dus met `ebpf.logToTraceCorrelation: true` draagt elk logrecord nog steeds een trace-ID terwijl er maar `percentage`% van die traces behouden blijft. Ruwweg (100 − `percentage`)% van de logrecords toont een trace-link die doodloopt. Navigatie van trace → logs blijft onaangetast; alleen logs → trace kan missen.

> **Stem je span-gebaseerde monitors opnieuw af wanneer je dit instelt.** Sampling vermindert de spans die OneUptime bereiken, dus alles wat ze telt, telt minder: een **Traces**-monitor op `Span Count` en een **Exceptions**-monitor op `Exception Count` zien ruwweg `percentage`% van het volume van gisteren. Een drempel die is afgestemd op ongesampled verkeer wordt stilletjes niet meer overschreden — de monitor geeft geen fout, hij valt gewoon stil. Deel die drempels door dezelfde factor wanneer je het percentage instelt; het percentage geldt cluster-breed, dus er is geen manier om een individuele service ervan uit te zonderen. Het **groeperen** van errors verslechtert erger dan lineair: een veelvoorkomende exception komt nog steeds bovendrijven, maar een zeldzame eenmalige verdwijnt eerder helemaal dan dat hij een tiende zo vaak verschijnt.

> **Waarom er hier geen log- of metriek-sampling is.** De sampler van de collector kan metrieken helemaal niet samplen. Logs kan hij wel samplen, maar hij ontleent zijn willekeur aan de trace-ID — en pod-logs hebben er geen. Elk record zonder trace-ID hasht dan naar dezelfde bucket, dus een log-percentage zou de feed niet uitdunnen: het zou alles behouden of alles verwijderen, afhankelijk van de seed. In plaats van een knop uit te leveren die stilzwijgend je logs verwijdert, biedt de chart die niet aan. Dun logs uit met [Filteren op log-severity](#filteren-op-log-severity) en [Namespace-filtering](#namespace-filtering), die precies zijn over wat ze verwijderen.

### Logverzameling uitschakelen

Als je geen pod-logs nodig hebt:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

Je metrieken blijven onaangetast: de node-collector blijft draaien voor kubelet-, cAdvisor- en hostmetrieken, hij stopt alleen met het lezen van pod-logs. Log-gebaseerde alerts stoppen, en verder niets.

### Forceer een Specifieke Logverzamelmodus

Gevorderde gebruikers kunnen de keuze van de preset overschrijven met `logs.mode`:

- `logs.mode=daemonset` — hostPath DaemonSet (laagste overhead, vereist hostPath)
- `logs.mode=api` — Kubernetes API log-tailer Deployment (werkt op elk cluster)
- `logs.mode=disabled` — geen logverzameling

> De logmodus bepaalt alleen waar **pod-logs** vandaan komen. Node-metrieken worden daar los van verzameld, dus `api` en `disabled` behouden je kubelet-, cAdvisor- en hostmetrieken.
>
> De enige uitzondering is het platform, niet de modus: **EKS Fargate kan helemaal geen DaemonSets inplannen**, dus daar is geen node-collector en zijn metrieken per node/pod/container niet beschikbaar. GKE Autopilot draait de node-collector prima, maar blokkeert `hostPath`, dus verzamelt het kubelet- en cAdvisor-metrieken zonder de `hostmetrics`-metrieken (disk-I/O, inodes, NIC-fouten) die de `/proc` en `/sys` van de host moeten lezen.

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

| Categorie                                        | Data                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Node-metrieken**                               | CPU-gebruik, geheugengebruik, bestandssysteemgebruik, netwerk-I/O                                                                     |
| **Pod-metrieken**                                | CPU-gebruik, geheugengebruik, netwerk-I/O, herstarts                                                                                  |
| **Container-metrieken**                          | CPU-gebruik, geheugengebruik per container                                                                                            |
| **Cluster-metrieken**                            | Node-condities, toewijsbare resources, pod-aantallen                                                                                  |
| **Kubernetes-events**                            | Waarschuwingen, fouten, scheduling-events                                                                                             |
| **Pod-logs**                                     | stdout/stderr-logs van alle containers (via hostPath DaemonSet op standaardclusters, of via de Kubernetes API op Autopilot / Fargate) |
| **Applicatietraces** _(via eBPF, standaard aan)_ | HTTP-, gRPC-, SQL/Redis-spans van elke pod — geen SDK of codewijzigingen                                                              |
| **HTTP RED-metrieken** _(via eBPF)_              | `http.server.request.duration`, request- en response-body-groottes, per service                                                       |
| **Service Graph** _(via eBPF)_                   | Caller → callee request rate, latentie en error edges — voedt de service-mapweergave                                                  |
| **Netwerkflowmetrieken** _(via eBPF)_            | Pod-naar-pod TCP/UDP byte- en packet-tellers met k8s-metadata                                                                         |
| **TCP Stats** _(via eBPF)_                       | RTT op node-niveau, mislukte-verbinding- en retransmit-tellers                                                                        |

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

| `ebpf.features.*`         | Standaard | Wat het toevoegt                                                      |
| ------------------------- | --------- | --------------------------------------------------------------------- |
| `httpMetrics`             | aan       | HTTP/gRPC RED-metrieken (request rate, latentie, errors) per service  |
| `spanMetrics`             | aan       | Request-/response-grootte en -duur per span                           |
| `serviceGraph`            | aan       | Caller → callee edge-metrieken; voedt de service-map                  |
| `hostMetrics`             | aan       | CPU en geheugen per geïnstrumenteerd proces                           |
| `networkMetrics`          | aan       | Pod-naar-pod TCP/UDP-flow-tellers                                     |
| `networkInterZoneMetrics` | uit       | Inter-zone-variant van netwerkmetrieken (verdubbelt de cardinaliteit) |
| `tcpStats`                | aan       | TCP RTT op node-niveau, mislukte-verbinding-, retransmit-tellers      |

Cross-service trace-contextpropagatie is ook standaard aan — OBI injecteert W3C `traceparent` in uitgaande HTTP/TCP, zodat een request die pod A → pod B kruist als één enkele trace verschijnt, zonder SDK-wijzigingen ergens. Schakel uit met `--set ebpf.contextPropagation=false`.

## Het volume aan verzamelde data verminderen

Standaard is de agent afgestemd op **dekking** — hij levert metrieken, pod-logs en eBPF-traces van het hele cluster, zodat elk dashboard en elke monitor vanaf dag één werkt. Op grote of drukke clusters kan dat meer telemetrie zijn dan je nodig hebt, wat zich uit in een hoger ingest-volume (en, op OneUptime Cloud, hogere kosten). Niets hiervan is verplicht, maar als een cluster meer verzendt dan je wilt, zijn dit de knoppen om aan te draaien — grofweg in volgorde van impact.

De truc is om **te stoppen met het verzamelen van wat je toch niet bekijkt**, in plaats van alles te verzamelen en te betalen om het op te slaan. Elke hendel hieronder is een Helm-waarde, dus je kunt hem toepassen met `--set` op `helm upgrade --reuse-values` en op dezelfde manier terugdraaien.

### Waar het volume vandaan komt

| Signaal                          | Grootste veroorzaker                                       | Verminder het met                                                                            |
| -------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Pod-logs**                     | Elke regel van elke container, cluster-breed               | `namespaceFilters`, `filters.logs.minSeverity`, `logs.enabled`, `logs.mode`                  |
| **eBPF-traces & span-metrieken** | Eén trace per request van elk geïnstrumenteerd proces      | `sampling.traces.percentage`, `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths` |
| **Metrische datapunten**         | Scrapefrequentie × aantal pods/containers                  | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Metrische cardinaliteit**      | Aantal afzonderlijke series (per container, per PVC, …)    | `filters.metrics.exclude`, `namespaceFilters.applyTo.metrics`, `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics` |
| **Opt-in-extra's**               | Profiling, audit-logs, control plane, inter-zone-metrieken | Laat ze uit (dat zijn ze al standaard)                                                       |

Er zijn drie manieren om volume te beperken, en het is de moeite waard om te weten welke je gebruikt:

- **Bij de receiver** — de data wordt nooit verzameld. `namespaceFilters` op pod-logs, `cadvisor.metricsAllowlist`, een langer `collectionInterval`. Kost niets om uit te voeren en bespaart CPU, egress en ingest tegelijk. Geef hier altijd de voorkeur aan waar ze jouw geval dekken.
- **Bij de filter-processor** — de data wordt verzameld en daarna vóór de export weggegooid. `filters.logs.minSeverity`, `filters.metrics.*`, `namespaceFilters.applyTo.*`. Iets meer collector-CPU, maar het werkt over receivers heen en kan dingen uitdrukken die een receiver niet kan.
- **Bij de sampler** — de data wordt verzameld en daarna wordt er een representatieve fractie van behouden. `sampling.traces.percentage`. De vreemde eend in de bijt: de twee hierboven verwijderen een hele *categorie* telemetrie, dus wat zij weggooien, is uit elke trace verdwenen. Sampling behoudt elke categorie en dunt de populatie uit, dus wat overleeft, is nog steeds compleet en representatief.

Alle drie zijn **onomkeerbaar**: wat je hier weggooit, bereikt OneUptime nooit, en bij alle drie kan een monitor stilvallen. De eerste twee leggen een monitor stil door het signaal weg te nemen waar hij naar kijkt. Sampling is beperkter: de eBPF RED-metrieken worden berekend vóórdat de sampler draait, dus metriek-gebaseerde monitors blijven exact — maar monitors die *spans* tellen (Traces op `Span Count`, Exceptions op `Exception Count`) zien er evenredig minder en hebben drempels nodig die met dezelfde factor opnieuw zijn afgestemd. Als je liever later beslist, kan OneUptime data in plaats daarvan server-side laten vallen (**Logs → Settings → Drop Filters**, **Metrics → Settings → Pipeline Rules**) — dat kost nog steeds egress, maar het is een instelling die je kunt wijzigen zonder opnieuw te deployen.

### Hendel 1 — Pod-logs zijn meestal de grootste afzonderlijke bron

Container-logs zijn vrijwel altijd het grootste deel van de ingest, omdat het één record per logregel is van elke container in het cluster.

- **Wil je alleen logs van bepaalde namespaces?** `namespaceFilters` beperkt pod-logs in beide logmodi (en eBPF-traces daarmee mee). Het matchen gebeurt op het pod-log-pad, dus gefilterde namespaces worden zelfs nooit gelezen — dit is de goedkoopste hendel in dit document:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` is al standaard uitgesloten.) Om elke namespace op één na te behouden, gebruik je `--set "namespaceFilters.exclude={kube-system,noisy-namespace}"`.

- **Geef je alleen om waarschuwingen en fouten?** `filters.logs.minSeverity` laat de rest bij de agent vallen. Op een spraakzaam cluster is dit vaak de grootste afzonderlijke vermindering die beschikbaar is, omdat INFO en DEBUG het leeuwendeel van de meeste applicatie-uitvoer vormen:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  Zie [Filteren op log-severity](#filteren-op-log-severity) voor hoe de severity wordt bepaald en wat er gebeurt met logs die het niet kan classificeren.

- **Heb je helemaal geen pod-logs van OneUptime nodig?** Schakel ze uit:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > Dit stopt alleen pod-logs. Metrieken per node, pod en container blijven stromen, en de monitors die daarop gebouwd zijn (OOM-kills, CPU-throttling, PVC lage schijfruimte) blijven werken — de node-collector blijft, hij stopt alleen met het lezen van `/var/log/pods`. Hetzelfde geldt voor `logs.mode: api` en `logs.mode: disabled`.

### Hendel 2 — Snoei de eBPF-auto-instrumentatie

eBPF geeft je traces, RED-metrieken, de service-map en netwerkflowmetrieken zonder codewijzigingen — maar het is ook de op één na grootste databron omdat het een span per request en meerdere metrische families per service uitzendt. Je hebt drie niveaus van controle:

- **Verzend je al traces vanuit OTel-SDK's, of wil je geen auto-traces?** Schakel eBPF volledig uit:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Behoud de traces, laat de zware metrische families vallen.** De [signaalfamilie-tabel hierboven](#individuele-signaalfamilies-in-uitschakelen) somt elke `ebpf.features.*`-vlag op. De families met het hoogste volume zijn netwerk- en span-metrieken — door ze uit te schakelen blijven traces, HTTP RED-metrieken en de service-map intact:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  Laat `ebpf.features.networkInterZoneMetrics` uit (de standaard) — het verdubbelt de netwerkflowcardinaliteit.

- **Instrumenteer alleen de runtimes waar je om geeft.** Standaard koppelt OBI zich aan elk proces dat het herkent (`ebpf.autoTargetExe: "*"`). Beperk het tot specifieke runtimes, of voeg binaries toe aan de skip-lijst, om het aantal "services" en traces dat de agent produceert te verminderen:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  Zie [Individuele signaalfamilies in-/uitschakelen](#individuele-signaalfamilies-in-uitschakelen) en de `excludeExePaths`-notitie in de chart-values voor de volledige standaardwaarden.

### Hendel 3 — Vertraag de scrape-intervallen

Het metrische volume is recht evenredig met hoe vaak de agent scrapet. Een interval verdubbelen halveert grofweg het aantal datapunten dat die metriek produceert, zonder verlies van dekking — alleen een grovere resolutie. Als je geen granulariteit van 30 seconden nodig hebt, is 60s of 120s een grote, veilige vermindering:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval` (standaard `30s`) stuurt de node- / pod- / container-metrieken (`kubeletstats`) en de cluster-state-metrieken (`k8s_cluster`) aan — het grootste deel van het metrische volume.
- `hostMetrics.collectionInterval` en `cadvisor.scrapeInterval` dekken de OS-metrieken per node en de throttling- / OOM-tellers.
- `resourceSpecs.interval` (standaard `300s`) bepaalt hoe vaak volledige resource-specs (labels, annotaties, status) worden opgehaald — verhoog het als je spec-wijzigingen niet snel weerspiegeld hoeft te zien.
- Als je een van de optionele scrapers hebt ingeschakeld, hebben die ook hun eigen knoppen: `kubeStateMetrics.scrapeInterval`, `serviceMesh.*.scrapeInterval`, `coreDns.scrapeInterval`, `csi.scrapeInterval`.

### Hendel 4 — Houd de metrische cardinaliteit begrensd

Cardinaliteit (het aantal afzonderlijke tijdreeksen) is net zo belangrijk als frequentie, omdat elke reeks afzonderlijk wordt opgeslagen en gefactureerd.

- **cAdvisor staat bewust op een allowlist.** De cAdvisor-receiver (standaard aan) kan honderden metrieken uitzenden; de chart stuurt alleen het handjevol door dat monitors aandrijft (`cadvisor.metricsAllowlist`). Houd de lijst kort — **elke entry wordt per container bijgehouden, dus één extra metriek vermenigvuldigt zich met het aantal containers in het cluster.** kube-state-metrics staat standaard uit, maar als je het inschakelt (`kubeStateMetrics.enabled=true`) begrenst zijn `kubeStateMetrics.metricsAllowlist` de cardinaliteit op dezelfde manier.
- **Volumemetrieken per PVC** (`kubeletstats.volumeMetrics.enabled`, standaard aan) zenden één reeks per PVC per pod uit. Dat is prima voor de meeste clusters, maar kan aanzienlijk zijn bij stateful workloads (Kafka, databases) met duizenden PVC's — schakel het daar uit als je de PVC-schijfruimte niet in de gaten houdt:

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **Saturatiemetrieken** (`kubeletstats.utilizationMetrics.enabled`, standaard aan) voegen 8 afgeleide "% van request/limit"-families toe. Ze zijn goedkoop (geen extra scrape), maar als je de CPU-/Geheugen-vs-limit-monitors niet gebruikt, kun je ze verwijderen met `--set kubeletstats.utilizationMetrics.enabled=false`.

- **Laat specifieke metrieken op naam vallen.** De allowlists hierboven gelden per receiver; `filters.metrics.exclude` beslaat ze allemaal, dus gebruik het voor alles wat de knoppen op receiver-niveau niet kunnen uitdrukken:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.metrics.matchType=regexp \
    --set-json 'filters.metrics.exclude=["^container_network_"]'
  ```

  Zie [Metrieken op naam in- of uitsluiten](#metrieken-op-naam-in-of-uitsluiten) voor exacte-vs-regex-matching en de allowlist-vorm.

- **Laat de metrieken van een hele namespace vallen.** Als een namespace luidruchtig is maar je zijn nodes toch in de gaten wilt houden, past `namespaceFilters.applyTo.metrics=true` je bestaande namespace-lijsten toe op series per pod en per container. Series op node- en clusterniveau worden altijd behouden:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set namespaceFilters.applyTo.metrics=true
  ```

### Hendel 5 — Laat de zware opt-in-functies uit

Deze staan **standaard uit** juist omdat ze belasting toevoegen — schakel er alleen een in wanneer je actief gebruikt wat het aandrijft, en schakel het weer uit als je het alleen maar uitprobeerde:

| Waarde                                                    | Voegt toe                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `profiling.enabled`                                       | Continue CPU-profiling-DaemonSet — zwaarder dan eBPF-traces                                   |
| `auditLogs.enabled`                                       | Elke Kubernetes-API-request als logrecord (hoog volume)                                       |
| `controlPlane.enabled`                                    | etcd- / API-server- / scheduler- / controller-manager-metrieken                               |
| `kubeStateMetrics.enabled`                                | CrashLoop- / ImagePull- / scheduling-reason-metrieken (voegt een KSM-Deployment + scrape toe) |
| `ebpf.features.networkInterZoneMetrics`                   | Verdubbelt de cardinaliteit van netwerkflowmetrieken                                          |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | Extra Prometheus-scrape-jobs                                                                  |

### Hendel 6 — Sample traces in plaats van ze weg te gooien

Elke hendel hierboven koopt volume met iets dat je opgeeft: een namespace die je niet meer bekijkt, een severity die je niet meer behoudt, een metrische familie die je niet meer verzamelt. Sampling is de uitzondering, en op een druk cluster is het vaak de grootste besparing die beschikbaar is voor het kleinste verlies:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

Dat is een besparing van 90% op je tracevolume, voor een beperkter verlies dan welke andere hendel hier ook:

- De traces die je behoudt zijn **heel** — de beslissing hasht de trace-ID, dus alle spans van een trace delen hem. Je krijgt minder traces, geen kapotte.
- Je **RED-metrieken blijven exact**. Request rate, error rate en duur worden door OBI uit elke request berekend en reizen via de metrics-pipeline, waar de sampler niet in zit. Elk dashboard en elke monitor die erop gebouwd is, leest hetzelfde als voorheen.

Wat je opgeeft, zijn vooral voorbeeldtraces: wanneer een monitor afgaat, heb je een tiende zoveel traces om te openen. Op een cluster dat duizenden identieke requests per seconde afhandelt, is dat meestal een goede ruil — de honderdste identieke `/healthz`-span leert je niets wat de eerste je niet al leerde. Op een rustig cluster is het een slechte, omdat je misschien geen enkel voorbeeld hebt van de zeldzame request die stukging.

De uitzondering, en het enige om te controleren voordat je dit uitrolt: monitors die **spans tellen** in plaats van metrieken — Traces op `Span Count`, Exceptions op `Exception Count` — zien er evenredig minder, dus hun drempels moeten met dezelfde factor opnieuw worden afgestemd. Zie [Trace-sampling](#trace-sampling).

Grijp hiernaar wanneer eBPF-traces een groot deel van je ingest zijn maar je de service-map en RED-metrieken intact wilt houden. Geef de voorkeur aan Hendel 2 wanneer je ergens helemaal wilt stoppen met instrumenteren.

Zie [Trace-sampling](#trace-sampling) voor het volledige gedrag, inclusief waarom `0` een percentage is en geen uitschakelknop, en waarom er geen log- of metriek-equivalent bestaat.

### Een minimaal startpunt

Als je een kleinere footprint wilt maar toch wilt dat de monitors werken, behoudt dit profiel de **volledige metrische dekking** en snijdt het de twee dingen weg die het volume daadwerkelijk aanjagen — logregels en eBPF-spans:

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

# Behoud pod-logs, maar verzend alleen die het alarmeren waard zijn.
# (Metrieken hangen hier niet van af — de node-collector draait hoe dan ook.)
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

Scherp verder aan waar nodig: verhoog `minSeverity` naar `ERROR`, voeg `namespaceFilters.applyTo.metrics=true` toe, of zet `ebpf.enabled=false` als je al traces verzendt vanuit OTel-SDK's.

> **Let op wat je wegsnijdt.** Sommige monitors zijn afhankelijk van specifieke signalen: `cadvisor` uitschakelen verwijdert de OOM-kill- en CPU-throttling-monitors; `kubeletstats.volumeMetrics` uitschakelen verwijdert de PVC-lage-schijfruimte-monitor; logs uitschakelen verwijdert log-gebaseerde alerts; en `sampling.traces.percentage` verwijdert geen monitor, maar schaalt de span-gebaseerde monitors omlaag (Traces op `Span Count`, Exceptions op `Exception Count`), dus stem hun drempels daarop af. Snoei de signalen waarop je niet reageert, niet die waar een monitor op let.

### Meet het effect

Telemetriegebruik wordt per dag geaggregeerd, dus controleer de trend over een dag of twee onder **Project Settings → Usage History** om de daling te bevestigen — het verandert niet op het moment dat je een wijziging toepast. Wijzig één hendel tegelijk, zodat je het verschil kunt toeschrijven — logs uit, dan het interval omhoog, dan eBPF gesnoeid — in plaats van alles tegelijk terug te schroeven en een monitor te verliezen waar je echt op vertrouwde.

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

De verbonden status van een cluster wordt puur bepaald door binnenkomende telemetrie — als er geen data binnenkomt, wordt het cluster na ~15 minuten als verbroken gemarkeerd. Dus "disconnected" en "geen metrieken" hebben vrijwel altijd **dezelfde** oorzaak: de telemetrie van de agent wordt niet geaccepteerd.

De meest voorkomende reden — vooral na een herinstallatie — is een **verkeerde of ingetrokken ingestion-sleutel**. Dit wordt makkelijk over het hoofd gezien omdat de OTLP-ingest-endpoints bewust HTTP `200` retourneren, zelfs voor een ongeldig token (zodat een verkeerd geconfigureerde collector de server niet kan overspoelen met retries). Het gevolg: de collector rapporteert succes, de logs tonen geen fouten en de data wordt stilletjes verworpen.

1. Controleer of de agent-pods draaien: `kubectl get pods -n oneuptime-agent`
2. Controleer de metrics-collector-logs: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (geen fouten hier betekent **niet** dat data binnenkomt — zie hierboven)
3. **Valideer de ingestion-sleutel.** Vraag OneUptime rechtstreeks of je token geaccepteerd wordt (`200` = geldig, `401` = onbekend/ingetrokken):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   Als het `401` retourneert, is de sleutel in je release verkeerd of is deze ingetrokken. Kopieer een actieve sleutel uit _Project Settings → Telemetry Ingestion Keys_ en deploy opnieuw:

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

1. Sluit eerst een geweigerde ingestion-sleutel uit — het is de meest voorkomende oorzaak en is onzichtbaar vanaf de agent-kant. Zie [Agent toont "Disconnected"](#agent-toont-disconnected) hierboven (of voer gewoon het diagnosescript uit).
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
