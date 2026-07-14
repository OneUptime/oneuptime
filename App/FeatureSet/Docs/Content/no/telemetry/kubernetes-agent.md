# OneUptime Kubernetes-agent (Helm)

## Oversikt

OneUptime Kubernetes-agenten er et ferdigpakket Helm-chart som installerer en OpenTelemetry-basert collector-pipeline på klyngen din. Den leverer node-, pod-, container- og klyngemetrikker; Kubernetes-hendelser; pod-logger; og — med eBPF slått på som standard — applikasjonssporinger (traces), HTTP RED-metrikker, service-graf-data og nettverksflytmetrikker pod-til-pod. Ingen kodeendringer, ingen SDK-er, én `helm install`.

Denne siden er **installasjonsveiledningen**. For å konfigurere Kubernetes-monitorer og varsler oppå dataene agenten samler inn, se [Kubernetes-agent (monitorer)](/docs/monitor/kubernetes-agent).

## Forutsetninger

- En kjørende Kubernetes-klynge (v1.23+)
- `kubectl` konfigurert til å få tilgang til klyngen din
- `helm` v3 installert
- En **OneUptime API-nøkkel** — opprett en fra _Project Settings → API Keys_

## Steg 1 — Legg til OneUptime Helm-repositoriet

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Steg 2 — Velg en forhåndsinnstilling for klyngen din

Chartet eksponerer ett enkelt alternativ på øverste nivå — `preset` — som velger kompatible standardverdier for din Kubernetes-distribusjon. Det styrer ting du ellers ville måtte justere for hånd: om logger skal leveres via en hostPath DaemonSet eller via Kubernetes-API-et, og hvilken sikkerhetskontekst som skal benyttes.

| `preset`                | Brukes for                                                                                | Logginnsamling                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `standard` _(standard)_ | Selvadministrerte klynger, **EKS på EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet som leser `/var/log/pods` via hostPath (lavest overhead)        |
| `gke-autopilot`         | **GKE Autopilot**                                                                         | Kubernetes API log-tailer Deployment (ingen hostPath, ingen vertstilgang) |
| `eks-fargate`           | **EKS Fargate**                                                                           | Kubernetes API log-tailer Deployment (ingen hostPath, ingen vertstilgang) |

Hvis du er usikker, start med `standard`. Hvis installasjonen mislykkes med en Pod Security-feil som nevner `hostPath`, kjør på nytt med `preset=gke-autopilot` (eller `eks-fargate` på Fargate), og det vil fungere.

## Steg 3 — Installer Kubernetes-agenten

Erstatt `YOUR_ONEUPTIME_URL`, `YOUR_ONEUPTIME_API_KEY` og klyngenavnet med verdier for ditt miljø. Klyngenavnet er hvordan klyngen vil vises i OneUptime — velg noe stabilt som `prod-us-east-1`.

### Standardklynger (selvadministrert, EKS på EC2, GKE Standard, AKS)

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

## Steg 4 — Verifiser installasjonen

Sjekk at agent-podene kjører:

```bash
kubectl get pods -n oneuptime-agent
```

På en **standard**-klynge vil du se en metrics-collector Deployment pluss én log-collector DaemonSet-pod per node:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

På **GKE Autopilot** eller **EKS Fargate** vil du se to Deployments i stedet (ingen DaemonSet):

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

Når agenten kobler til, vil klyngen din vises automatisk i **Kubernetes**-seksjonen i OneUptime-dashbordet.

## Konfigurasjonsalternativer

### Namespace-filtrering

`namespaceFilters` avgrenser **pod-logger** (både hostPath DaemonSet og API-log-taileren) og **eBPF-sporinger** til namespacene du velger. `kube-system` er ekskludert som standard. For å begrense disse signalene til spesifikke namespaces:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

> Disse filtrene reduserer **ikke** node- / pod- / container-**metrikker** — disse skrapes per node fra kubelet-en og samles alltid inn på tvers av hele klyngen (serier på node- og klyngenivå har ingen namespace å filtrere på). `exclude` vinner alltid over `include`. Se [Redusere volumet av data som samles inn](#reducing-the-volume-of-data-collected) for hele settet med volumkontroller.

### Deaktiver logginnsamling

Hvis du kun trenger metrikker og hendelser (ingen pod-logger):

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### Tving en spesifikk logginnsamlingsmodus

Avanserte brukere kan overstyre forhåndsinnstillingens valg med `logs.mode`:

- `logs.mode=daemonset` — hostPath DaemonSet (lavest overhead, krever hostPath)
- `logs.mode=api` — Kubernetes API log-tailer Deployment (fungerer på enhver klynge)
- `logs.mode=disabled` — ingen logginnsamling

Den eksplisitte `logs.mode` vinner alltid over forhåndsinnstillingens standard. Bruk dette hvis du kjenner klyngen din bedre enn forhåndsinnstillingen gjør.

### Aktiver overvåking av control plane

For selvadministrerte klynger (ikke EKS / GKE / AKS) kan du aktivere control plane-metrikker:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> Administrerte Kubernetes-tjenester (EKS, GKE, AKS) eksponerer vanligvis ikke control plane-metrikker. Aktiver dette kun for selvadministrerte klynger.

### Automatisk tagging med prosjektetiketter

Ethvert ressursattributt med prefikset `oneuptime.label.` forfremmes til en prosjekt-Label og festes til klyngen, tjenestene og vertene som sendes fra denne agenten. Mønster: `oneuptime.label.<dimension>=<value>` blir en etikett med navnet `<dimension>:<value>`.

Send etiketter ved installasjon med `--set oneuptime.labels.<key>=<value>`:

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

Etiketter matches uten hensyn til store/små bokstaver, så en eksisterende manuelt opprettet `Production`-etikett gjenbrukes i stedet for å dupliseres. Etiketter som legges til manuelt i OneUptime-grensesnittet, fjernes aldri av agenten.

## Oppgradering av agenten

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values` beholder din eksisterende konfigurasjon (forhåndsinnstilling, klyngenavn, filtre); send eventuelle nye `--set`-overstyringer oppå den.

## Avinstallering av agenten

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## Hva som samles inn

| Kategori                                                | Data                                                                                                                                     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Node-metrikker**                                      | CPU-utnyttelse, minnebruk, filsystembruk, nettverks-I/O                                                                                  |
| **Pod-metrikker**                                       | CPU-bruk, minnebruk, nettverks-I/O, omstarter                                                                                            |
| **Container-metrikker**                                 | CPU-bruk, minnebruk per container                                                                                                        |
| **Klyngemetrikker**                                     | Node-tilstander, allokerbare ressurser, antall poder                                                                                     |
| **Kubernetes-hendelser**                                | Advarsler, feil, planleggingshendelser                                                                                                   |
| **Pod-logger**                                          | stdout/stderr-logger fra alle containere (via hostPath DaemonSet på standardklynger, eller via Kubernetes-API-et på Autopilot / Fargate) |
| **Applikasjonssporinger** _(via eBPF, på som standard)_ | HTTP-, gRPC-, SQL/Redis-spans fra hver pod — ingen SDK eller kodeendringer                                                               |
| **HTTP RED-metrikker** _(via eBPF)_                     | `http.server.request.duration`, forespørsels- og svar-body-størrelser, per tjeneste                                                      |
| **Service-graf** _(via eBPF)_                           | Anroper → anropt forespørselsrate, latens og feilkanter — driver service-kartvisningen                                                   |
| **Nettverksflytmetrikker** _(via eBPF)_                 | TCP/UDP byte- og pakketellere pod-til-pod med k8s-metadata                                                                               |
| **TCP-statistikk** _(via eBPF)_                         | RTT på node-nivå, tellere for mislykkede tilkoblinger og retransmisjoner                                                                 |

## Applikasjonssporinger og HTTP-metrikker via eBPF (på som standard)

Chartet kjører en DaemonSet med [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) på hver node. Den laster eBPF-programmer inn i kjernen og fanger automatisk opp HTTP/HTTPS-, gRPC- og SQL/Redis-trafikk fra hver støttede runtime (Go, .NET, Java, Node.js, Python, Ruby, Rust) — ingen SDK og ingen sidecar nødvendig. Sporinger og forespørselsmetrikker flyter deretter gjennom den klyngeinterne collectoren til OneUptime.

**Krav:** Linux-kjerne **5.8+** med BTF (standard på Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+). eBPF DaemonSet kjører i **privilegert modus** fordi den må det, for å laste eBPF-programmer.

### Deaktiver eBPF-autoinstrumentering

Du bør deaktivere den når:

- Du installerer på **GKE Autopilot** eller **EKS Fargate** — disse plattformene blokkerer privilegerte poder (bruk `preset=gke-autopilot` / `preset=eks-fargate` og kombiner med `ebpf.enabled=false`).
- Noder kjører en kjerne eldre enn 5.8 uten BTF-backports.
- Du allerede leverer sporinger via OpenTelemetry-SDK-er fra appene dine og ikke ønsker duplikater.

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### Slå individuelle signalfamilier av og på

Alle på som standard. Slå av hvilken som helst med `--set ebpf.features.<name>=false`:

| `ebpf.features.*`         | Standard | Hva den tilfører                                                             |
| ------------------------- | -------- | ---------------------------------------------------------------------------- |
| `httpMetrics`             | på       | HTTP/gRPC RED-metrikker (forespørselsrate, latens, feil) per tjeneste        |
| `spanMetrics`             | på       | Forespørsels-/svarstørrelse og varighet per span                             |
| `serviceGraph`            | på       | Anroper → anropt kantmetrikker; driver service-kartet                        |
| `hostMetrics`             | på       | CPU og minne per instrumentert prosess                                       |
| `networkMetrics`          | på       | TCP/UDP flyttellere pod-til-pod                                              |
| `networkInterZoneMetrics` | av       | Inter-sone-variant av nettverksmetrikker (dobler kardinaliteten)             |
| `tcpStats`                | på       | TCP RTT på node-nivå, tellere for mislykkede tilkoblinger og retransmisjoner |

Propagering av sporingskontekst på tvers av tjenester er også på som standard — OBI injiserer W3C `traceparent` i utgående HTTP/TCP slik at en forespørsel som krysser pod A → pod B vises som en enkelt sporing, uten SDK-endringer noe sted. Slå av med `--set ebpf.contextPropagation=false`.

## Redusere volumet av data som samles inn

Ut av boksen er agenten innstilt for **dekning** — den leverer metrikker, pod-logger og eBPF-sporinger fra hele klyngen slik at hvert dashbord og hver monitor fungerer fra dag én. På store eller travle klynger kan det være mer telemetri enn du trenger, noe som viser seg som høyere ingest-volum (og, på OneUptime Cloud, høyere kostnad). Ingenting her er påkrevd, men hvis en klynge sender mer enn du ønsker, er dette spakene du kan justere — omtrent i rekkefølge etter påvirkning.

Trikset er å **slutte å samle inn det du ikke kommer til å se på**, i stedet for å samle inn alt og betale for å lagre det. Hver spak nedenfor er en Helm-verdi, så du kan bruke den med `--set` på `helm upgrade --reuse-values` og rulle den tilbake på samme måte.

### Hvor volumet kommer fra

| Signal                               | Største driver                                                    | Skru det ned med                                                                             |
| ------------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Pod-logger**                       | Hver linje fra hver container, på tvers av hele klyngen           | `logs.enabled`, `logs.mode`, `namespaceFilters`                                              |
| **eBPF-sporinger og span-metrikker** | Én sporing per forespørsel fra hver instrumentert prosess         | `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths`              |
| **Metrikk-datapunkter**              | Skrapefrekvens × antall poder/containere                          | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Metrikk-kardinalitet**             | Antall distinkte serier (per container, per PVC, …)               | `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics`, `kubeletstats.utilizationMetrics` |
| **Opt-in-ekstrafunksjoner**          | Profilering, revisjonslogger, control plane, inter-sone-metrikker | La dem være av (det er de allerede som standard)                                             |

### Spak 1 — Pod-logger er vanligvis den enkeltstående største kilden

Container-logger er nesten alltid den største andelen av ingest, fordi det er én post per logglinje fra hver container i klyngen.

- **Trenger du ikke logger fra OneUptime i det hele tatt?** Slå dem helt av — du beholder alle metrikker, hendelser og sporinger:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

- **Vil du bare ha logger fra bestemte namespaces?** `namespaceFilters.include` avgrenser pod-logger i begge loggmodusene (og eBPF-sporinger sammen med dem). Matching skjer på pod-logg-stien, så filtrerte namespaces blir aldri engang lest:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` er allerede ekskludert som standard.)

### Spak 2 — Trim eBPF-autoinstrumentering

eBPF gir deg sporinger, RED-metrikker, service-kartet og nettverksflytmetrikker uten kodeendringer — men den er også den nest største datakilden fordi den sender ut ett span per forespørsel og flere metrikkfamilier per tjeneste. Du har tre kontrollnivåer:

- **Leverer du allerede sporinger fra OTel-SDK-er, eller vil du ikke ha autosporinger?** Slå eBPF helt av:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Behold sporingene, dropp de tunge metrikkfamiliene.** [Signalfamilie-tabellen ovenfor](#toggle-individual-signal-families) lister opp hvert `ebpf.features.*`-flagg. Familiene med høyest volum er nettverks- og span-metrikker — å slå dem av lar sporinger, HTTP RED-metrikker og service-kartet være intakte:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  La `ebpf.features.networkInterZoneMetrics` være av (standardverdien) — den dobler kardinaliteten for nettverksflyt.

- **Instrumenter kun de runtime-ene du bryr deg om.** Som standard festes OBI til hver prosess den gjenkjenner (`ebpf.autoTargetExe: "*"`). Begrens den til bestemte runtime-er, eller legg binærfiler til hopp-over-listen, for å redusere antallet "tjenester" og sporinger agenten produserer:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  Se [Slå individuelle signalfamilier av og på](#toggle-individual-signal-families) og `excludeExePaths`-notatet i chart-verdiene for de fullstendige standardverdiene.

### Spak 3 — Senk skrapeintervallene

Metrikkvolum er direkte proporsjonalt med hvor ofte agenten skraper. Å doble et intervall halverer omtrent antallet datapunkter den metrikken produserer, uten tap av dekning — bare grovere oppløsning. Hvis du ikke trenger 30-sekunders granularitet, er 60s eller 120s en stor, trygg reduksjon:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval` (standard `30s`) driver node- / pod- / container-metrikkene (`kubeletstats`) og klyngetilstandsmetrikkene (`k8s_cluster`) — hoveddelen av metrikkvolumet.
- `hostMetrics.collectionInterval` og `cadvisor.scrapeInterval` dekker OS-metrikkene per node og throttling- / OOM-tellerne.
- `resourceSpecs.interval` (standard `300s`) styrer hvor ofte fullstendige ressursspesifikasjoner (etiketter, annotasjoner, status) hentes — øk den hvis du ikke trenger spesifikasjonsendringer reflektert raskt.
- Hvis du aktiverte noen av de valgfrie skraperne, har de sine egne spaker også: `kubeStateMetrics.scrapeInterval`, `serviceMesh.*.scrapeInterval`, `coreDns.scrapeInterval`, `csi.scrapeInterval`.

### Spak 4 — Hold metrikk-kardinaliteten begrenset

Kardinalitet (antallet distinkte tidsserier) betyr like mye som frekvens, fordi hver serie lagres og faktureres separat.

- **cAdvisor bruker en tillatelsesliste med hensikt.** cAdvisor-mottakeren (på som standard) kan sende ut hundrevis av metrikker; chartet videresender kun de få som driver monitorer (`cadvisor.metricsAllowlist`). Hold listen stram — **hver oppføring beholdes per container, så én ekstra metrikk multipliseres med klyngens antall containere.** kube-state-metrics er av som standard, men hvis du aktiverer den (`kubeStateMetrics.enabled=true`), begrenser dens `kubeStateMetrics.metricsAllowlist` kardinaliteten på samme måte.
- **Volummetrikker per PVC** (`kubeletstats.volumeMetrics.enabled`, på som standard) sender ut én serie per PVC per pod. Det er greit for de fleste klynger, men kan være betydelig på tilstandsbærende arbeidslaster (Kafka, databaser) med tusenvis av PVC-er — slå den av der hvis du ikke overvåker PVC-diskplass:

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **Metningsmetrikker** (`kubeletstats.utilizationMetrics.enabled`, på som standard) legger til 8 avledede "% av request/limit"-familier. De er billige (ingen ekstra skrape), men hvis du ikke bruker CPU/Minne-mot-grense-monitorene, kan du droppe dem med `--set kubeletstats.utilizationMetrics.enabled=false`.

### Spak 5 — La de tunge opt-in-funksjonene være av

Disse er **av som standard** nettopp fordi de legger til belastning — aktiver kun én når du aktivt bruker det den driver, og slå den av igjen hvis du bare prøvde den ut:

| Verdi                                                     | Legger til                                                                                    |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `profiling.enabled`                                       | Kontinuerlig CPU-profilering DaemonSet — tyngre enn eBPF-sporinger                            |
| `auditLogs.enabled`                                       | Hver Kubernetes-API-forespørsel som en loggpost (høyt volum)                                  |
| `controlPlane.enabled`                                    | etcd- / API-server- / scheduler- / controller-manager-metrikker                               |
| `kubeStateMetrics.enabled`                                | CrashLoop- / ImagePull- / scheduling-reason-metrikker (legger til en KSM Deployment + skrape) |
| `ebpf.features.networkInterZoneMetrics`                   | Dobler kardinaliteten for nettverksflytmetrikker                                              |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | Ekstra Prometheus-skrapejobber                                                                |

### Et slankt utgangspunkt

Hvis du vil ha et minimalt fotavtrykk og vil legge til signaler etter hvert som du trenger dem, dropper denne **kun metrikker + hendelser**-profilen logger og eBPF og halverer skrapefrekvensen:

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

Derfra kan du re-aktivere hva enn du trenger: `logs.enabled=true` for noen få namespaces i API-modus, eller `ebpf.enabled=true` med en innsnevret `autoTargetExe`.

> **Vær forsiktig med hva du kutter.** Noen monitorer avhenger av spesifikke signaler: å deaktivere `cadvisor` fjerner OOM-kill- og CPU-throttling-monitorene; å deaktivere `kubeletstats.volumeMetrics` fjerner PVC-lavdisk-monitoren; å deaktivere logger fjerner loggbaserte varsler. Trim signalene du ikke handler på, ikke de en monitor følger med på.

### Mål effekten

Telemetribruk aggregeres per dag, så sjekk trenden over en dag eller to under **Project Settings → Usage History** for å bekrefte nedgangen — den beveger seg ikke i det øyeblikket du gjør en endring. Endre én spak om gangen slik at du kan tilskrive forskjellen — logger av, så intervall opp, så eBPF trimmet — i stedet for å skru alt ned på én gang og miste en monitor du faktisk stolte på.

## Feilsøking

> **Raskeste vei — kjør diagnostikkskriptet.** Det inspiserer pod-helse, dekoder og validerer ingest-nøkkelen, sjekker at klyngen din kan nå OneUptime, og spør OneUptime om token-et ditt faktisk aksepteres — og skriver så ut en enkelt rotårsaksdom:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> Det leser kun klyngetilstand og kjører et par prober; det endrer ingenting. For den mest nøyaktige egress-testen, installer med `--set debug.enabled=true` først (dette legger til en liten network-tools-sidecar til agent-podene slik at skriptet tester collectorens eksakte egress-vei), og kjør deretter på nytt.

### Installasjonen mislykkes med "hostPath volumes are not allowed" eller en Pod Security admission-feil

Klyngen din blokkerer `hostPath` — vanlig på **GKE Autopilot** og **EKS Fargate**. Bytt til API-modus-forhåndsinnstillingen:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### Agenten viser "Disconnected"

En klynges tilkoblingsstatus styres utelukkende av at telemetri ankommer — hvis ingen data lander, markeres klyngen som frakoblet etter ~15 minutter. Så "disconnected" og "ingen metrikker" har nesten alltid **samme** årsak: agentens telemetri blir ikke akseptert.

Den vanligste årsaken — spesielt etter en reinstallasjon — er en **feil eller tilbakekalt ingest-nøkkel**. Dette er lett å overse fordi OTLP-ingest-endepunktene med vilje returnerer HTTP `200` selv for et dårlig token (slik at en feilkonfigurert collector ikke kan utløse en retry-storm mot serveren). Resultatet: collectoren rapporterer suksess, loggene viser ingen feil, og dataene forkastes i stillhet.

1. Sjekk at agent-podene kjører: `kubectl get pods -n oneuptime-agent`
2. Sjekk metrics-collector-loggene: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (ingen feil her betyr **ikke** at data lander — se ovenfor)
3. **Valider ingest-nøkkelen.** Spør OneUptime direkte om token-et ditt aksepteres (`200` = gyldig, `401` = ukjent/tilbakekalt):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   Hvis den returnerer `401`, er nøkkelen i releasen din feil eller ble tilbakekalt. Kopier en aktiv nøkkel fra _Project Settings → Telemetry Ingestion Keys_ og deploy på nytt:

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. Verifiser at OneUptime-URL-en din er korrekt og at klyngen din kan nå den over nettverket.
5. Hvis du endret `clusterName` ved reinstallasjon, vises agenten som en **ny** klynge — den gamle oppføringen forblir "Disconnected" (det er forventet; den er foreldet).

### Ingen logger vises (kun API-modus)

1. Bekreft at log-tailer-poden er Ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`
2. Sjekk dens `/healthz` — den rapporterer antall aktive strømmer og den siste eksportfeilen
3. Sjekk loggene: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. For svært store klynger kan en enkelt replika være en flaskehals — shard etter namespace med `namespaceFilters.include` på separate releases

### Ingen metrikker vises

1. Utelukk først en avvist ingest-nøkkel — det er den vanligste årsaken og er usynlig fra agentsiden. Se [Agenten viser "Disconnected"](#agent-shows-disconnected) ovenfor (eller bare kjør diagnostikkskriptet).
2. Sjekk at klyngeidentifikatoren matcher verdien du sendte som `clusterName`
3. Verifiser RBAC-tillatelsene: `kubectl get clusterrolebinding | grep kubernetes-agent`
4. Sjekk OTel-collector-loggene for eksportfeil

### eBPF-poder er CrashLoopBackOff eller klarer ikke å starte

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

Vanlige årsaker:

- **Kjernen er for gammel eller BTF mangler.** OBI trenger Linux 5.8+ med BTF. Kjør `uname -r` på en node. Hvis du ikke kan oppgradere, deaktiver eBPF: `--set ebpf.enabled=false`.
- **Privilegerte poder blokkert.** Noen klynger avviser privilegerte poder (GKE Autopilot, EKS Fargate og låste miljøer). Deaktiver eBPF.
- **`debugfs` / `tracefs` ikke montert på verten.** `tcpStats`-funksjonen festes til kjerne-tracepoints som trenger dem. Chartet monterer begge via `hostPath` — men hvis verten din ikke eksponerer dem, deaktiver kun den familien: `--set ebpf.features.tcpStats=false`.

### Ingen applikasjonssporinger vises

1. Bekreft at eBPF DaemonSet er sunn: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. Slå på debug-sporingsutskriveren for å bekrefte at OBI fanger opp trafikk: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, og sjekk deretter `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`
3. Hvis du ser spans i OBIs stdout, men ikke i dashbordet, er problemet collector → OneUptime-eksporten — sjekk metrics-collector-podens logger.

## Neste steg

- Konfigurer **Kubernetes-monitorer** oppå metrikkene denne agenten samler inn — se [Kubernetes-agent (monitorer)](/docs/monitor/kubernetes-agent).
- Legg til **Logg-monitorer** for å varsle om spesifikke loggmønstre (f.eks. feilantall over en terskel per pod eller per namespace).
- For ikke-Kubernetes-verter (Linux / macOS / Windows-VM-er og bare metal), bruk siden [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector).
