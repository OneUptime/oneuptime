# OneUptime Kubernetes-agent (Helm)

## Översikt

OneUptime Kubernetes-agenten är ett färdigpaketerat Helm-diagram som installerar en OpenTelemetry-baserad insamlarpipeline på ditt kluster. Den levererar nod-, pod-, container- och klustermått; Kubernetes-händelser; pod-loggar; och — med eBPF aktiverat som standard — applikationsspårningar, HTTP RED-mått, tjänstegrafsdata och nätverksflödesmått pod-till-pod. Inga kodändringar, inga SDK:er, ett enda `helm install`.

Den här sidan är **installationsguiden**. För att konfigurera Kubernetes-monitorer och varningar ovanpå datan som agenten samlar in, se [Kubernetes-agent (monitorer)](/docs/monitor/kubernetes-agent).

## Förutsättningar

- Ett körande Kubernetes-kluster (v1.23+)
- `kubectl` konfigurerat för åtkomst till ditt kluster
- `helm` v3 installerat
- En **OneUptime API-nyckel** — skapa en från _Project Settings → API Keys_

## Steg 1 — Lägg till OneUptime Helm-arkivet

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Steg 2 — Välj en förinställning för ditt kluster

Diagrammet exponerar ett enda alternativ på toppnivå — `preset` — som väljer kompatibla standardvärden för din Kubernetes-distribution. Det styr saker du annars skulle behöva justera för hand: om loggar ska levereras via en hostPath-DaemonSet eller via Kubernetes-API:et, och vilken säkerhetskontext som ska tillämpas.

| `preset`                | Använd för                                                                             | Logginsamling                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `standard` _(standard)_ | Självhanterade kluster, **EKS på EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet som läser `/var/log/pods` via hostPath (lägst overhead)                |
| `gke-autopilot`         | **GKE Autopilot**                                                                      | Deployment med loggläsare via Kubernetes-API (ingen hostPath, ingen värdåtkomst) |
| `eks-fargate`           | **EKS Fargate**                                                                        | Deployment med loggläsare via Kubernetes-API (ingen hostPath, ingen värdåtkomst) |

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

`namespaceFilters` avgränsar **pod-loggar** (både hostPath-DaemonSet:en och API-loggläsaren) och **eBPF-spårningar** till de namnrymder du väljer. `kube-system` exkluderas som standard. För att begränsa dessa signaler till specifika namnrymder:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

För att ignorera en enskild brusig namnrymd men behålla alla andra, använd `exclude` i stället. `exclude` vinner alltid över `include`, och standardvärdet som levereras är `[kube-system]` — så lista det igen om du fortfarande vill ha det exkluderat:

```bash
  --set "namespaceFilters.exclude={kube-system,noisy-namespace}"
```

För **pod-loggar och eBPF-spårningar kostar detta ingenting**: namnrymden är en del av pod-loggvägen och av OBI:s processupptäckt, så en filtrerad namnrymd läses aldrig ens från början — ingen CPU, ingen egress.

#### Tillämpa namnrymdsfilter på mått och spårningar

Som standard täcker listorna ovan endast pod-loggar och eBPF-spårningar. `applyTo` utökar dem till andra signaler:

```bash
  --set namespaceFilters.applyTo.metrics=true \
  --set namespaceFilters.applyTo.traces=true
```

| Inställning       | Vad det täcker                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `applyTo.metrics` | Mått per pod / per container från kubeletstats, cAdvisor och kube-state-metrics                       |
| `applyTo.traces`  | Spans som dina applikationer skickar till agentens OTLP-slutpunkt (eBPF-spans är redan avgränsade)    |

Båda är **avstängda som standard** med avsikt. `exclude: [kube-system]` levereras som standard, så att slå på dem automatiskt skulle tyst radera kube-system-mått från varje befintlig installation vid uppgradering.

> **Mått på nod- och klusternivå behålls alltid.** En namnrymd är en egenskap hos en pod, inte hos en nod, så serier som nod-CPU, nodminne och filsystemsanvändning har inget att matcha på och släpps aldrig. `applyTo.metrics` trimmar kardinaliteten per pod utan att någonsin göra dig blind för en nod som håller på att gå sönder.

Kubernetes-**händelser** går inte att filtrera per namnrymd i agenten. De anländer från `k8sobjects`-mottagaren utan attributet `k8s.namespace.name` — namnrymden ligger inuti händelsekroppen — så det finns inget för ett filter att matcha på. Släng dem på serversidan i stället (se nedan).

### Filtrering efter loggallvarlighetsgrad

`filters.logs.minSeverity` släpper **pod-logg**poster under en allvarlighetsgrad, i agenten, innan något skickas:

```bash
  --set filters.logs.minSeverity=WARN
```

Accepterar `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. `WARN` behåller WARN, ERROR och FATAL och släpper INFO, DEBUG och TRACE. Standardvärdet (`""`) behåller allt. Det gäller i **båda** logglägena — i `daemonset`-läge via insamlaren, i `api`-läge inuti loggläsaren själv — så förinställningarna kan inte stänga av det bakom ryggen på dig.

Containerkörtider registrerar ingen allvarlighetsgrad på loggraden, så agenten tolkar själv fram en ur loggtexten (`[ERROR]`, `WARN:`, `level=info`, …).

> **Kubernetes-händelser och resursspecifikationer filtreras aldrig av detta.** De anländer från Kubernetes-API:et utan någon egen allvarlighetsgrad, så en tröskel skulle radera hela flödet i stället för att tunna ut det — inklusive varningarna `FailedScheduling`, `BackOff` och `OOMKilling` som du helst av allt vill ha. De har låg volym och högt värde, så agenten levererar dem alltid. För att tunna ut dem, använd instrumentpanelens serversidiga **Logs → Settings → Drop Filters** i stället.

**Vad som händer med en rad utan igenkännbar nivå beror på loggläget**, eftersom de två lägena har olika information tillgänglig:

| Läge | Omärkt rad | Varför |
| ---- | ---------- | ------ |
| `daemonset` | `stderr` → behandlas som ERROR (behålls), `stdout` → behandlas som INFO (släpps av en WARN-tröskel) | Containerkörtiden registrerar vilken ström varje rad kom från. |
| `api` | Behålls **alltid** | Kubernetes `pods/log`-API:et slår ihop stdout och stderr till en enda ström utan markör per rad. I stället för att gissa behåller agenten raden. |

> Alltså släpper `api`-läge strikt mindre än `daemonset`-läge. Det är avsiktligt: en Python-traceback eller `npm ERR!` bär inget allvarlighetsnyckelord, och att tyst radera den är precis det fel som en allvarlighetströskel ska skydda dig från.

Flerradiga händelser slås ihop **innan** filtrering i båda lägena, så en Java-stackspårning bedöms på sin första rad och behålls eller släpps i sin helhet — du kommer aldrig att få en naken `ERROR`-rad med sina ramar avskalade.

### Inkludera eller exkludera mått efter namn

`filters.metrics` styr vilka mått som lämnar klustret, tvärs över varje mottagare i pipelinen.

**Släng några brusiga mått** (en blocklista — vanligtvis det du vill ha):

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**Skicka bara en fast uppsättning** (en tillåtelselista — allt annat släpps):

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.usage","k8s.pod.memory.usage"]'
```

**Matcha efter mönster** i stället för exakt namn:

```bash
  --set filters.metrics.matchType=regexp \
  --set-json 'filters.metrics.exclude=["^container_network_"]'
```

| Nyckel                      | Betydelse                                                                    |
| --------------------------- | ---------------------------------------------------------------------------- |
| `filters.metrics.exclude`   | Måttnamn att släppa. Tillämpas ovanpå `include`, så exclude vinner alltid.   |
| `filters.metrics.include`   | När den inte är tom skickas **endast** dessa.                                |
| `filters.metrics.matchType` | `strict` (exakt namn, standardvärdet) eller `regexp` (RE2, **oförankrad**).  |

Noteringar som kommer att bespara dig en incident:

- `regexp` är **oförankrad** — `system.cpu` matchar också `system.cpu.time`. Förankra den (`^system\.cpu$`) när du menar exakt ett mått.
- RE2 har **ingen lookahead**, så `^(?!container_)` kommer inte att kompilera. Uttryck "allt utom" med `include`, inte med ett negativt reguljärt uttryck.
- `include` spänner över varje mottagare på en gång. En tillåtelselista som glömmer ett mått tar tyst bort monitorerna som byggts på det. Föredra `exclude` om du inte verkligen vill ha en sluten uppsättning.
- Använd `--set-json` (eller en values-fil) för listor. Vanlig `--set` ersätter en lista i stället för att slå ihop den.

> **Testa ett reguljärt uttryck innan du rullar ut det.** Mönster kompileras av insamlaren vid start, inte per post, så ett ogiltigt mönster beter sig inte illa i tysthet — insamlaren vägrar starta och hamnar i CrashLoopBackOff, vilket tar ner den insamlarens **loggar** tillsammans med dess mått. Helm kan inte kompilera RE2, så `helm upgrade` accepterar ett felaktigt mönster utan invändning.

### Inaktivera logginsamling

Om du inte behöver pod-loggar:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

> **Detta tar också bort dina nodmått.** Mottagarna kubelet, cAdvisor och hostmetrics bor inuti log-collector-DaemonSet:en, så att stänga av pod-loggar tar bort dem också — tillsammans med monitorerna för OOM-kill, CPU-throttling och lågt PVC-diskutrymme. Du behåller mått på klusternivå och Kubernetes-händelser, men inte de per nod eller per container. För att skära ner loggvolymen men behålla måtten, använd [`filters.logs.minSeverity`](#filtrering-efter-loggallvarlighetsgrad) eller [`namespaceFilters`](#namnrymdsfiltrering) i stället.

### Tvinga ett specifikt logginsamlingsläge

Avancerade användare kan åsidosätta förinställningens val med `logs.mode`:

- `logs.mode=daemonset` — hostPath-DaemonSet (lägst overhead, kräver hostPath)
- `logs.mode=api` — Deployment med loggläsare via Kubernetes-API (fungerar på vilket kluster som helst)
- `logs.mode=disabled` — ingen logginsamling

> `api` och `disabled` tar båda bort log-collector-DaemonSet:en, och med den nod-, pod-, container- och värdmåtten som beskrivs ovan — samma avvägning som `logs.enabled=false`. Bara `daemonset`-läge samlar in dem. Det är därför förinställningarna för GKE Autopilot och EKS Fargate, som tvingar fram `api`-läge, inte rapporterar kubelet-mått.

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

| Kategori                                                 | Data                                                                                                                                   |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Nodmått**                                              | CPU-utnyttjande, minnesanvändning, filsystemsanvändning, nätverks-I/O                                                                  |
| **Pod-mått**                                             | CPU-användning, minnesanvändning, nätverks-I/O, omstarter                                                                              |
| **Containermått**                                        | CPU-användning, minnesanvändning per container                                                                                         |
| **Klustermått**                                          | Nodtillstånd, allokerbara resurser, pod-antal                                                                                          |
| **Kubernetes-händelser**                                 | Varningar, fel, schemaläggningshändelser                                                                                               |
| **Pod-loggar**                                           | stdout/stderr-loggar från alla containrar (via hostPath-DaemonSet på standardkluster, eller via Kubernetes-API på Autopilot / Fargate) |
| **Applikationsspårningar** _(via eBPF, på som standard)_ | HTTP-, gRPC-, SQL/Redis-spans från varje pod — ingen SDK eller kodändringar                                                            |
| **HTTP RED-mått** _(via eBPF)_                           | `http.server.request.duration`, storlekar på begäran- och svarskroppar, per tjänst                                                     |
| **Tjänstegraf** _(via eBPF)_                             | Anropare → anropad begärandefrekvens, latens och felkanter — driver tjänstekartsvyn                                                    |
| **Nätverksflödesmått** _(via eBPF)_                      | TCP/UDP byte- och paketräknare pod-till-pod med k8s-metadata                                                                           |
| **TCP-statistik** _(via eBPF)_                           | Nodnivå-RTT, misslyckade anslutningar och retransmit-räknare                                                                           |

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

| `ebpf.features.*`         | Standard | Vad det lägger till                                            |
| ------------------------- | -------- | -------------------------------------------------------------- |
| `httpMetrics`             | på       | HTTP/gRPC RED-mått (begärandefrekvens, latens, fel) per tjänst |
| `spanMetrics`             | på       | Begäran-/svarsstorlek och varaktighet per span                 |
| `serviceGraph`            | på       | Kantmått anropare → anropad; driver tjänstekartan              |
| `hostMetrics`             | på       | CPU och minne per instrumenterad process                       |
| `networkMetrics`          | på       | TCP/UDP-flödesräknare pod-till-pod                             |
| `networkInterZoneMetrics` | av       | Inter-zonvariant av nätverksmått (dubblerar kardinalitet)      |
| `tcpStats`                | på       | Nodnivå TCP RTT, misslyckade anslutningar, retransmit-räknare  |

Spårningskontextpropagering mellan tjänster är också på som standard — OBI injicerar W3C `traceparent` i utgående HTTP/TCP så att en begäran som korsar pod A → pod B visas som en enda spårning, inga SDK-ändringar någonstans. Stäng av med `--set ebpf.contextPropagation=false`.

## Minska volymen av insamlad data

Direkt ur lådan är agenten inställd för **täckning** — den levererar mått, pod-loggar och eBPF-spårningar från hela klustret så att varje instrumentpanel och monitor fungerar från dag ett. På stora eller upptagna kluster kan det vara mer telemetri än du behöver, vilket visar sig som högre ingestvolym (och, på OneUptime Cloud, högre kostnad). Inget här är obligatoriskt, men om ett kluster skickar mer än du vill är detta rattarna att vrida på — ungefär i ordning efter påverkan.

Tricket är att **sluta samla in det du inte kommer att titta på**, i stället för att samla in allt och betala för att lagra det. Varje spak nedan är ett Helm-värde, så du kan tillämpa det med `--set` på `helm upgrade --reuse-values` och rulla tillbaka det på samma sätt.

### Varifrån volymen kommer

| Signal                            | Största drivkraft                                          | Minska den med                                                                               |
| --------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Pod-loggar**                    | Varje rad från varje container, i hela klustret            | `namespaceFilters`, `filters.logs.minSeverity`, `logs.enabled`, `logs.mode`                  |
| **eBPF-spårningar och span-mått** | En spårning per begäran från varje instrumenterad process  | `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths`              |
| **Måttdatapunkter**               | Skrapfrekvens × antal poddar/containrar                    | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Måttkardinalitet**              | Antal distinkta serier (per container, per PVC, …)         | `filters.metrics.exclude`, `namespaceFilters.applyTo.metrics`, `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics` |
| **Opt-in-tillägg**                | Profilering, revisionsloggar, kontrollplan, inter-zon-mått | Låt dem vara avstängda (det är de redan som standard)                                        |

Det finns två sätt att skära ner volymen, och det är värt att veta vilket du använder:

- **Vid mottagaren** — datan samlas aldrig in. `namespaceFilters` på pod-loggar, `cadvisor.metricsAllowlist`, ett längre `collectionInterval`. Kostar ingenting att köra och sparar CPU, egress och ingest på en gång. Föredra alltid dessa där de täcker ditt fall.
- **Vid filterprocessorn** — datan samlas in och släpps sedan före export. `filters.logs.minSeverity`, `filters.metrics.*`, `namespaceFilters.applyTo.*`. Något mer insamlar-CPU, men det fungerar tvärs över mottagare och kan uttrycka saker en mottagare inte kan.

Båda är **oåterkalleliga**: det du släpper här når aldrig OneUptime, och varje monitor som byggts på det tystnar. Om du hellre vill bestämma senare kan OneUptime släppa data på serversidan i stället (**Logs → Settings → Drop Filters**, **Metrics → Settings → Pipeline Rules**) — det kostar fortfarande egress, men det är en inställning du kan ändra utan en omdistribution.

### Spak 1 — Pod-loggar är oftast den enskilt största källan

Containerloggar är nästan alltid den största delen av ingesten, eftersom det är en post per loggrad från varje container i klustret.

- **Vill du bara ha loggar från vissa namnrymder?** `namespaceFilters` avgränsar pod-loggar i båda logglägena (och eBPF-spårningar tillsammans med dem). Matchning sker på pod-loggvägen, så filtrerade namnrymder läses aldrig ens — detta är den billigaste spaken i det här dokumentet:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` är redan exkluderat som standard.) För att behålla alla namnrymder utom en, använd `--set "namespaceFilters.exclude={kube-system,noisy-namespace}"`.

- **Bryr du dig bara om varningar och fel?** `filters.logs.minSeverity` släpper resten i agenten. På ett pratsamt kluster är detta ofta den enskilt största minskningen som finns att få, eftersom INFO och DEBUG utgör merparten av de flesta applikationers utdata:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  Se [Filtrering efter loggallvarlighetsgrad](#filtrering-efter-loggallvarlighetsgrad) för hur allvarlighetsgraden fastställs och vad som händer med loggar den inte kan klassificera.

- **Behöver du inte pod-loggar från OneUptime alls?** Stäng av dem:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > **Detta inaktiverar också nod-, pod-, container- och värdmått.** Mottagarna kubelet, cAdvisor och hostmetrics bor alla i samma log-collector-DaemonSet, så att stänga av pod-loggar tar bort dem också — tillsammans med monitorerna för OOM-kill, CPU-throttling och lågt PVC-diskutrymme. Detsamma gäller `logs.mode: api` och `logs.mode: disabled`.
  >
  > Om du vill ha färre loggar men vill behålla dina mått, stanna på `logs.mode: daemonset` och ta till `namespaceFilters` eller `filters.logs.minSeverity` ovan i stället.

### Spak 2 — Trimma eBPF-autoinstrumentering

eBPF ger dig spårningar, RED-mått, tjänstekartan och nätverksflödesmått utan kodändringar — men det är också den näst största datakällan eftersom det avger en span per begäran och flera måttfamiljer per tjänst. Du har tre kontrollnivåer:

- **Levererar du redan spårningar från OTel-SDK:er, eller vill du inte ha auto-spårningar?** Stäng av eBPF helt:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Behåll spårningarna, släng de tunga måttfamiljerna.** [Signalfamiljetabellen ovan](#växla-enskilda-signalfamiljer) listar varje `ebpf.features.*`-flagga. Familjerna med högst volym är nätverks- och span-mått — att stänga av dem lämnar spårningar, HTTP RED-mått och tjänstekartan intakta:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  Låt `ebpf.features.networkInterZoneMetrics` vara avstängt (dess standard) — det dubblerar nätverksflödeskardinaliteten.

- **Instrumentera bara de körtider du bryr dig om.** Som standard kopplas OBI till varje process den känner igen (`ebpf.autoTargetExe: "*"`). Begränsa den till specifika körtider, eller lägg till binärer i hoppa-över-listan, för att minska antalet "tjänster" och spårningar agenten producerar:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  Se [Växla enskilda signalfamiljer](#växla-enskilda-signalfamiljer) och `excludeExePaths`-noten i diagramvärdena för de fullständiga standardvärdena.

### Spak 3 — Öka skrapintervallen

Måttvolymen är direkt proportionell mot hur ofta agenten skrapar. Att dubbla ett intervall halverar ungefär antalet datapunkter det måttet producerar, utan förlust av täckning — bara grövre upplösning. Om du inte behöver 30-sekundersgranularitet är 60s eller 120s en stor, säker minskning:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval` (standard `30s`) driver nod- / pod- / containermått (`kubeletstats`) och klustertillståndsmått (`k8s_cluster`) — merparten av måttvolymen.
- `hostMetrics.collectionInterval` och `cadvisor.scrapeInterval` täcker OS-mått per nod och throttling- / OOM-räknarna.
- `resourceSpecs.interval` (standard `300s`) styr hur ofta fullständiga resursspecifikationer (etiketter, annoteringar, status) hämtas — höj det om du inte behöver att specifikationsändringar återspeglas snabbt.
- Om du aktiverade någon av de valfria skraparna har de egna rattar också: `kubeStateMetrics.scrapeInterval`, `serviceMesh.*.scrapeInterval`, `coreDns.scrapeInterval`, `csi.scrapeInterval`.

### Spak 4 — Håll måttkardinaliteten begränsad

Kardinalitet (antalet distinkta tidsserier) spelar lika stor roll som frekvens, eftersom varje serie lagras och faktureras separat.

- **cAdvisor är tillåtelselistad med avsikt.** cAdvisor-mottagaren (på som standard) kan avge hundratals mått; diagrammet vidarebefordrar bara den handfull som driver monitorer (`cadvisor.metricsAllowlist`). Håll listan snäv — **varje post behålls per container, så ett extra mått multipliceras med klustrets containerantal.** kube-state-metrics är avstängt som standard, men om du aktiverar det (`kubeStateMetrics.enabled=true`) begränsar dess `kubeStateMetrics.metricsAllowlist` kardinaliteten på samma sätt.
- **Volymmått per PVC** (`kubeletstats.volumeMetrics.enabled`, på som standard) avger en serie per PVC per pod. Det är okej för de flesta kluster men kan vara betydande på tillståndskänsliga arbetsbelastningar (Kafka, databaser) med tusentals PVC:er — stäng av det där om du inte bevakar PVC-diskutrymme:

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **Mättnadsmått** (`kubeletstats.utilizationMetrics.enabled`, på som standard) lägger till 8 härledda "% av request/limit"-familjer. De är billiga (ingen extra skrapning) men om du inte använder CPU/Minne-mot-gräns-monitorerna kan du släppa dem med `--set kubeletstats.utilizationMetrics.enabled=false`.

- **Släpp specifika mått efter namn.** Tillåtelselistorna ovan gäller per mottagare; `filters.metrics.exclude` spänner över alla, så använd den för allt som rattarna på mottagarnivå inte kan uttrycka:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.metrics.matchType=regexp \
    --set-json 'filters.metrics.exclude=["^container_network_"]'
  ```

  Se [Inkludera eller exkludera mått efter namn](#inkludera-eller-exkludera-mått-efter-namn) för exakt matchning kontra regex och för tillåtelselisteformen.

- **Släpp en hel namnrymds mått.** Om en namnrymd är brusig men du fortfarande vill ha dess noder bevakade tillämpar `namespaceFilters.applyTo.metrics=true` dina befintliga namnrymdslistor på serier per pod och per container. Serier på nod- och klusternivå behålls alltid:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set namespaceFilters.applyTo.metrics=true
  ```

### Spak 5 — Låt de tunga opt-in-funktionerna vara avstängda

Dessa är **avstängda som standard** just för att de lägger till belastning — aktivera bara en när du aktivt använder det den driver, och stäng av den igen om du bara testade den:

| Värde                                                     | Lägger till                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `profiling.enabled`                                       | Kontinuerlig CPU-profilerings-DaemonSet — tyngre än eBPF-spårningar                             |
| `auditLogs.enabled`                                       | Varje Kubernetes-API-begäran som en loggpost (hög volym)                                        |
| `controlPlane.enabled`                                    | etcd- / API-server- / scheduler- / controller-manager-mått                                      |
| `kubeStateMetrics.enabled`                                | CrashLoop- / ImagePull- / schemaläggningsorsak-mått (lägger till en KSM-Deployment + skrapning) |
| `ebpf.features.networkInterZoneMetrics`                   | Dubblerar nätverksflödesmåttkardinaliteten                                                      |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | Extra Prometheus-skrapjobb                                                                      |

### En slimmad utgångspunkt

Om du vill ha ett mindre fotavtryck men fortfarande vill att monitorerna ska fungera, behåller den här profilen **full måtttäckning** och skär bort de två saker som faktiskt driver volymen — loggrader och eBPF-spans:

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

# Halvera måttdatapunkterna. Grövre upplösning, samma täckning.
collectionInterval: 60s
hostMetrics:
  collectionInterval: 60s
cadvisor:
  scrapeInterval: 60s

# Behåll DaemonSet:en — det är den som samlar in kubelet-, cAdvisor- och
# värdmått såväl som loggar — men leverera bara loggar värda att larma på.
logs:
  enabled: true
  mode: daemonset

filters:
  logs:
    minSeverity: WARN # släpp INFO / DEBUG / TRACE i agenten

namespaceFilters:
  exclude:
    - kube-system
    - noisy-namespace

ebpf:
  enabled: true
  features:
    networkMetrics: false # de tyngsta eBPF-familjerna
    tcpStats: false
    spanMetrics: false
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

Dra åt ytterligare efter behov: höj `minSeverity` till `ERROR`, lägg till `namespaceFilters.applyTo.metrics=true`, eller sätt `ebpf.enabled=false` om du redan levererar spårningar från OTel-SDK:er.

> **Var uppmärksam på vad du skär bort.** Vissa monitorer är beroende av specifika signaler: att inaktivera `cadvisor` tar bort OOM-kill- och CPU-throttling-monitorerna; att inaktivera `kubeletstats.volumeMetrics` tar bort monitorn för lågt PVC-diskutrymme; att inaktivera loggar (eller stänga av DaemonSet:en) tar bort loggbaserade varningar *och* dina nodmått. Trimma de signaler du inte agerar på, inte de som en monitor bevakar.

### Mät effekten

Telemetrianvändning aggregeras per dag, så kontrollera trenden över en dag eller två under **Project Settings → Usage History** för att bekräfta minskningen — den ändras inte i samma ögonblick som du tillämpar en ändring. Ändra en spak i taget så att du kan tillskriva skillnaden — loggar av, sedan intervall upp, sedan eBPF trimmat — i stället för att vrida ner allt på en gång och förlora en monitor du faktiskt förlitade dig på.

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

Ett klusters anslutningsstatus drivs uteslutande av telemetri som anländer — om ingen data landar markeras klustret som frånkopplat efter ~15 minuter. Så "disconnected" och "inga mått" har nästan alltid **samma** orsak: agentens telemetri accepteras inte.

Den vanligaste anledningen — särskilt efter en ominstallation — är en **felaktig eller återkallad ingestnyckel**. Detta är lätt att missa eftersom OTLP-ingestslutpunkterna avsiktligt returnerar HTTP `200` även för en felaktig token (så att en felkonfigurerad insamlare inte kan översvämma servern med återförsök). Resultatet: insamlaren rapporterar framgång, dess loggar visar inga fel, och datan kastas tyst.

1. Kontrollera att agentens poddar körs: `kubectl get pods -n oneuptime-agent`
2. Kontrollera metrics-collector-loggarna: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (inga fel här betyder **inte** att data landar — se ovan)
3. **Validera ingestnyckeln.** Fråga OneUptime direkt om din token accepteras (`200` = giltig, `401` = okänd/återkallad):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   Om det returnerar `401` är nyckeln i din release felaktig eller återkallad. Kopiera en aktiv nyckel från _Project Settings → Telemetry Ingestion Keys_ och distribuera om:

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

1. Uteslut först en avvisad ingestnyckel — det är den vanligaste orsaken och är osynlig från agentsidan. Se [Agenten visar "Disconnected"](#agenten-visar-disconnected) ovan (eller kör bara diagnostikskriptet).
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
