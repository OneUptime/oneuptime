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

> Deze filters verminderen **niet** de node- / pod- / container-**metrieken** — die worden per node uit de kubelet gescrapet en worden altijd cluster-breed verzameld (series op node- en clusterniveau hebben geen namespace om op te filteren). `exclude` wint altijd van `include`. Zie [Het volume aan verzamelde data verminderen](#reducing-the-volume-of-data-collected) voor de volledige set aan volumecontroles.

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
| **Pod-logs**                     | Elke regel van elke container, cluster-breed               | `logs.enabled`, `logs.mode`, `namespaceFilters`                                              |
| **eBPF-traces & span-metrieken** | Eén trace per request van elk geïnstrumenteerd proces      | `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths`              |
| **Metrische datapunten**         | Scrapefrequentie × aantal pods/containers                  | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Metrische cardinaliteit**      | Aantal afzonderlijke series (per container, per PVC, …)    | `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics`, `kubeletstats.utilizationMetrics` |
| **Opt-in-extra's**               | Profiling, audit-logs, control plane, inter-zone-metrieken | Laat ze uit (dat zijn ze al standaard)                                                       |

### Hendel 1 — Pod-logs zijn meestal de grootste afzonderlijke bron

Container-logs zijn vrijwel altijd het grootste deel van de ingest, omdat het één record per logregel is van elke container in het cluster.

- **Heb je helemaal geen logs van OneUptime nodig?** Schakel ze volledig uit — je behoudt alle metrieken, events en traces:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

- **Wil je alleen logs van bepaalde namespaces?** `namespaceFilters.include` beperkt pod-logs in beide logmodi (en eBPF-traces daarmee mee). Het matchen gebeurt op het pod-log-pad, dus gefilterde namespaces worden zelfs nooit gelezen:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` is al standaard uitgesloten.)

### Hendel 2 — Snoei de eBPF-auto-instrumentatie

eBPF geeft je traces, RED-metrieken, de service-map en netwerkflowmetrieken zonder codewijzigingen — maar het is ook de op één na grootste databron omdat het een span per request en meerdere metrische families per service uitzendt. Je hebt drie niveaus van controle:

- **Verzend je al traces vanuit OTel-SDK's, of wil je geen auto-traces?** Schakel eBPF volledig uit:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Behoud de traces, laat de zware metrische families vallen.** De [signaalfamilie-tabel hierboven](#toggle-individual-signal-families) somt elke `ebpf.features.*`-vlag op. De families met het hoogste volume zijn netwerk- en span-metrieken — door ze uit te schakelen blijven traces, HTTP RED-metrieken en de service-map intact:

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

  Zie [Individuele signaalfamilies in-/uitschakelen](#toggle-individual-signal-families) en de `excludeExePaths`-notitie in de chart-values voor de volledige standaardwaarden.

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

### Een minimaal startpunt

Als je een minimale footprint wilt en signalen weer toevoegt zodra je ze nodig hebt, laat dit profiel met **alleen metrieken + events** de logs en eBPF vallen en halveert het de scrape-frequentie:

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

Vanaf daar schakel je weer in wat je nodig hebt: `logs.enabled=true` voor een paar namespaces in API-modus, of `ebpf.enabled=true` met een versmalde `autoTargetExe`.

> **Let op wat je wegsnijdt.** Sommige monitors zijn afhankelijk van specifieke signalen: `cadvisor` uitschakelen verwijdert de OOM-kill- en CPU-throttling-monitors; `kubeletstats.volumeMetrics` uitschakelen verwijdert de PVC-lage-schijfruimte-monitor; logs uitschakelen verwijdert log-gebaseerde alerts. Snoei de signalen waarop je niet reageert, niet die waar een monitor op let.

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
