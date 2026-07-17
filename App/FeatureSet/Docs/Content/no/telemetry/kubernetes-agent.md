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

På en **standard**-klynge vil du se en cluster-collector Deployment pluss én node-collector DaemonSet-pod per node:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

På **GKE Autopilot** kjører node-collectoren fortsatt — den samler inn kubelet- og cAdvisor-metrikker uten å trenge hostPath — og et ekstra Deployment leser pod-logger via Kubernetes-API-et:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
```

På **EKS Fargate** vil du se to Deployments og ingen DaemonSet — Fargate gir hver pod sin egen mikro-VM og planlegger aldri DaemonSets, så metrikker på nodenivå er ikke tilgjengelige der:

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

For å ignorere ett støyende namespace mens du beholder alle de andre, bruk `exclude` i stedet. `exclude` vinner alltid over `include`, og standardverdien som følger med er `[kube-system]` — så list den opp på nytt hvis du fortsatt vil ha den ekskludert:

```bash
  --set "namespaceFilters.exclude={kube-system,noisy-namespace}"
```

For **pod-logger og eBPF-sporinger koster dette ingenting**: namespacet er en del av pod-logg-stien og av OBIs prosessoppdagelse, så et filtrert namespace blir aldri lest i utgangspunktet — ingen CPU, ingen egress.

#### Anvende namespace-filtre på metrikker og sporinger

Som standard dekker listene ovenfor kun pod-logger og eBPF-sporinger. `applyTo` utvider dem til andre signaler:

```bash
  --set namespaceFilters.applyTo.metrics=true \
  --set namespaceFilters.applyTo.traces=true
```

| Innstilling | Hva den dekker |
| ----------- | -------------- |
| `applyTo.metrics` | Metrikker per pod / per container fra kubeletstats, cAdvisor og kube-state-metrics |
| `applyTo.traces` | Spans som applikasjonene dine sender til agentens OTLP-endepunkt (eBPF-spans er allerede avgrenset) |

Begge er **av som standard** med hensikt. `exclude: [kube-system]` følger med som standardverdi, så å slå disse på automatisk ville i stillhet slettet kube-system-metrikker fra hver eksisterende installasjon ved oppgradering.

> **Metrikker på node- og klyngenivå beholdes alltid.** Et namespace er en egenskap ved en pod, ikke ved en node, så serier som node-CPU, node-minne og filsystembruk har ingenting å matche på og blir aldri droppet. `applyTo.metrics` trimmer kardinaliteten per pod uten noen gang å gjøre deg blind for at en node blir dårlig.

Kubernetes-**hendelser** kan ikke namespace-filtreres på agenten. De ankommer fra `k8sobjects`-mottakeren uten et `k8s.namespace.name`-attributt — namespacet ligger inne i hendelseskroppen — så det er ingenting for et filter å matche på. Drop dem heller på serversiden (se nedenfor).

### Filtrering etter loggalvorlighetsgrad

`filters.logs.minSeverity` dropper **pod-logg**-poster under en alvorlighetsgrad, på agenten, før noe som helst sendes:

```bash
  --set filters.logs.minSeverity=WARN
```

Godtar `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`. `WARN` beholder WARN, ERROR og FATAL og dropper INFO, DEBUG og TRACE. Standardverdien (`""`) beholder alt. Det gjelder i **begge** loggmodusene — i `daemonset`-modus via collectoren, i `api`-modus inne i selve log-taileren — så forhåndsinnstillingene kan ikke slå det av bak ryggen på deg.

Container-runtime-er registrerer ikke en alvorlighetsgrad på selve logglinjen, så agenten parser en ut av loggteksten selv (`[ERROR]`, `WARN:`, `level=info`, …).

> **Kubernetes-hendelser og ressursspesifikasjoner filtreres aldri av dette.** De ankommer fra Kubernetes-API-et uten en egen alvorlighetsgrad, så en terskel ville slettet hele strømmen i stedet for å tynne den ut — inkludert `FailedScheduling`-, `BackOff`- og `OOMKilling`-advarslene du helst vil ha. De har lavt volum og høy verdi, så agenten sender dem alltid. For å tynne dem ut, bruk heller dashbordets serversidige **Logs → Settings → Drop Filters**.

**Hva som skjer med en linje uten et gjenkjennelig nivå, avhenger av loggmodusen**, fordi de to modusene har ulik informasjon tilgjengelig:

| Modus | Umerket linje | Hvorfor |
| ---- | --------------- | --- |
| `daemonset` | `stderr` → behandles som ERROR (beholdes), `stdout` → behandles som INFO (droppes av en WARN-terskel) | Container-runtime-en registrerer hvilken strøm hver linje kom fra. |
| `api` | Beholdes **alltid** | Kubernetes-`pods/log`-API-et slår sammen stdout og stderr til én enkelt strøm uten markør per linje. I stedet for å gjette beholder agenten linjen. |

> Så `api`-modus dropper strengt mindre enn `daemonset`-modus. Det er med hensikt: en Python-traceback eller `npm ERR!` bærer ingen alvorlighetsgrad-nøkkelord, og å slette den i stillhet er nøyaktig den feilen en alvorlighetsgradsterskel skal beskytte deg mot.

Flerlinjede hendelser settes sammen igjen **før** filtrering i begge modusene, så en Java-stacktrace vurderes ut fra sin første linje og beholdes eller droppes i sin helhet — du vil aldri få en naken `ERROR`-linje med rammene strippet vekk.

### Inkludere eller ekskludere metrikker etter navn

`filters.metrics` styrer hvilke metrikker som forlater klyngen, på tvers av hver mottaker i pipelinen.

**Drop noen få støyende metrikker** (en ekskluderingsliste — vanligvis det du vil ha):

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**Send kun et fast sett** (en tillatelsesliste — alt annet droppes):

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.utilization","k8s.pod.memory.usage"]'
```

**Match etter mønster** i stedet for etter eksakt navn:

```bash
  --set filters.metrics.matchType=regexp \
  --set-json 'filters.metrics.exclude=["^container_network_"]'
```

| Nøkkel | Betydning |
| --- | ------- |
| `filters.metrics.exclude` | Metrikknavn som skal droppes. Anvendes oppå `include`, så exclude vinner alltid. |
| `filters.metrics.include` | Når den ikke er tom, sendes **kun** disse. |
| `filters.metrics.matchType` | `strict` (eksakt navn, standardverdien) eller `regexp` (RE2, **uforankret**). |

Notater som vil spare deg for en hendelse:

- `regexp` er **uforankret** — `system.cpu` matcher også `system.cpu.time`. Forankre den (`^system\.cpu$`) når du mener nøyaktig én metrikk.
- RE2 har **ingen lookahead**, så `^(?!container_)` vil ikke kompilere. Uttrykk "alt bortsett fra" med `include`, ikke med et negativt regex.
- `include` spenner over hver mottaker på én gang. En tillatelsesliste som glemmer en metrikk, fjerner i stillhet monitorene som er bygget på den. Foretrekk `exclude` med mindre du virkelig vil ha et lukket sett.
- Bruk `--set-json` (eller en values-fil) for lister. Vanlig `--set` erstatter en liste i stedet for å slå den sammen.

> **Test et regex før du ruller det ut.** Mønstre kompileres av collectoren ved oppstart, ikke per post, så et ugyldig et oppfører seg ikke feil i stillhet — collectoren nekter å starte og går i CrashLoopBackOff, og tar den collectorens **logger** med seg sammen med metrikkene. Helm kan ikke kompilere RE2, så `helm upgrade` godtar et dårlig mønster uten å si ifra.

### Sampling av sporinger

Filtrene ovenfor fjerner en **kategori** av telemetri — et namespace, en alvorlighetsgrad, et metrikknavn. Sampling er annerledes: den beholder hver kategori og tynner ut populasjonen i stedet. Sett `sampling.traces.percentage` til andelen sporinger du vil beholde:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

Det beholder én sporing av ti og dropper de andre ni på agenten, før de forlater klyngen din.

**Du får hele sporinger, ikke fragmenter.** Avgjørelsen er en hash av sporings-ID-en i stedet for et myntkast per span, så hvert span i en sporing beholdes eller droppes samlet — sporingene som overlever, er komplette og lesbare fra ende til ende. Det er denne egenskapen som gjør det trygt å slå på sampling.

**De metrikkbaserte monitorene dine rikker seg ikke.** eBPF RED-metrikkene — forespørselsrate, feilrate, varighet — er en *metrikk*familie. OBI beregner dem fra hver forespørsel, og de går gjennom metrikk-pipelinen, som sampleren ikke står i. Med `percentage: 10` får du en tidel av sporingene og 100 % nøyaktig rate/feil/latens. Dashbord og monitorer bygget på disse metrikkene påvirkes ikke.

**Det gjør de span-baserte monitorene dine.** Alt OneUptime avleder fra spansene selv, skaleres ned med raten — se advarselen nedenfor før du slår dette på.

| Nøkkel | Betydning |
| --- | ------- |
| `sampling.traces.percentage` | Prosentandel sporinger som skal **beholdes**, 0-100. Standardverdien er `100` (behold alt). |
| `sampling.traces.hashSeed` | Seed for sporings-ID-hashen. Standardverdien er `22`. |

Notater som vil spare deg for en hendelse:

- **`0` beholder ingen sporinger i det hele tatt.** Det er en rate, ikke en av-bryter — den sletter hver eneste sporing mens eBPF-DaemonSet-en fortsetter å kjøre og koste deg penger. Vil du ikke ha sporinger, bruk `ebpf.enabled=false`. Vil du ikke ha sporinger, men *vil* ha RED-metrikker og service-kartet, la eBPF være på og sett denne til `0` med hensikt.
- **Gjelder kun når `ebpf.enabled`.** Sporings-pipelinen finnes ikke ellers, så med `ebpf.enabled=false` gjør denne verdien ingenting.
- **Kun sporinger.** Det finnes ingen `sampling.logs` eller `sampling.metrics`, og det er med hensikt — se notatet nedenfor.
- **Brøkdeler krever `--set-json`, og de har en nedre grense.** `--set sampling.traces.percentage=0.5` feiler, fordi Helm leser `0.5` som en streng. Bruk `--set-json 'sampling.traces.percentage=0.5'` eller en values-fil. Hele tall fungerer fint med `--set`. Under omtrent `0.0061` kvantiseres raten til null og oppfører seg nøyaktig som `0` — hver eneste sporing droppes, uten noen feil. `0.01` (én av ti tusen) er den minste verdien som gjør det den sier.
- **Flere klynger fungerer som standard.** To agenter beholder den samme sporingen kun hvis de er enige om både `hashSeed` og `percentage`. Begge har den samme standardverdien overalt, så en sporing som krysser to klynger, overlever i sin helhet uten noen ekstra konfigurasjon. Endre `hashSeed` kun for med hensikt å *dekorrelere* to samplingsnivåer — fordi avgjørelsen er en terskel på den samme hashen, nøstes den samme seeden med ulike rater, så et andre nivå bare velger på nytt blant sporingene det første allerede beholdt, i stedet for å trekke uavhengig.
- **Pod-logger samples aldri**, så med `ebpf.logToTraceCorrelation: true` bærer hver eneste loggpost fortsatt en sporings-ID, mens kun `percentage` % av disse sporingene beholdes. Omtrent (100 − `percentage`) % av loggpostene vil vise en sporingslenke som ender i ingenting. Navigering fra sporing → logger påvirkes ikke; kun logger → sporing kan bomme.

> **Juster tersklene på de span-baserte monitorene dine på nytt når du setter denne.** Sampling reduserer spansene som når OneUptime, så alt som teller dem, teller mindre: en **Traces**-monitor på `Span Count` og en **Exceptions**-monitor på `Exception Count` vil se omtrent `percentage` % av gårsdagens volum. En terskel som er innstilt på usamplet trafikk, slutter i stillhet å bli krysset — monitoren feiler ikke, den blir bare stille. Del disse tersklene på den samme faktoren når du setter raten; raten gjelder hele klyngen, så det finnes ingen måte å unnta en enkelt tjeneste fra den. **Gruppering** av feil degraderes verre enn lineært: et vanlig unntak dukker fortsatt opp, men et sjeldent engangstilfelle forsvinner heller helt enn å dukke opp en tidel så ofte.

> **Hvorfor det ikke finnes logg- eller metrikk-sampling her.** Collectorens sampler kan ikke sample metrikker i det hele tatt. Den kan sample logger, men den henter tilfeldigheten sin fra sporings-ID-en — og pod-logger har ingen. Hver post uten sporings-ID hasher da til den samme bøtta, så en logg-rate ville ikke tynnet ut strømmen: den ville beholdt alt eller slettet alt, avhengig av seeden. I stedet for å levere en spak som i stillhet sletter loggene dine, tilbyr ikke chartet noen. Tynn ut logger med [Filtrering etter loggalvorlighetsgrad](#filtrering-etter-loggalvorlighetsgrad) og [Namespace-filtrering](#namespace-filtrering), som er presise på hva de fjerner.

### Deaktiver logginnsamling

Hvis du ikke trenger pod-logger:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

Metrikkene dine påvirkes ikke: node-collectoren fortsetter å kjøre for kubelet-, cAdvisor- og host-metrikker, den slutter bare å lese pod-logger. Loggbaserte varsler stopper, og ingenting annet.

### Tving en spesifikk logginnsamlingsmodus

Avanserte brukere kan overstyre forhåndsinnstillingens valg med `logs.mode`:

- `logs.mode=daemonset` — hostPath DaemonSet (lavest overhead, krever hostPath)
- `logs.mode=api` — Kubernetes API log-tailer Deployment (fungerer på enhver klynge)
- `logs.mode=disabled` — ingen logginnsamling

> Loggmodusen bestemmer bare hvor **pod-logger** kommer fra. Node-metrikker samles inn uavhengig av den, så `api` og `disabled` beholder kubelet-, cAdvisor- og host-metrikkene dine.
>
> Det ene unntaket er plattformen, ikke modusen: **EKS Fargate kan ikke planlegge DaemonSets i det hele tatt**, så det finnes ingen node-collector der, og metrikker per node/pod/container er utilgjengelige. GKE Autopilot kjører node-collectoren fint, men blokkerer `hostPath`, så den samler inn kubelet- og cAdvisor-metrikker uten `hostmetrics`-metrikkene (disk-I/O, inoder, NIC-feil) som må lese vertens `/proc` og `/sys`.

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
| **Pod-logger**                       | Hver linje fra hver container, på tvers av hele klyngen           | `namespaceFilters`, `filters.logs.minSeverity`, `logs.enabled`, `logs.mode`                  |
| **eBPF-sporinger og span-metrikker** | Én sporing per forespørsel fra hver instrumentert prosess         | `sampling.traces.percentage`, `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths` |
| **Metrikk-datapunkter**              | Skrapefrekvens × antall poder/containere                          | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Metrikk-kardinalitet**             | Antall distinkte serier (per container, per PVC, …)               | `filters.metrics.exclude`, `namespaceFilters.applyTo.metrics`, `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics` |
| **Opt-in-ekstrafunksjoner**          | Profilering, revisjonslogger, control plane, inter-sone-metrikker | La dem være av (det er de allerede som standard)                                             |

Tre måter å kutte volum på, og det er verdt å vite hvilken av dem du bruker:

- **På mottakeren** — dataene samles aldri inn. `namespaceFilters` på pod-logger, `cadvisor.metricsAllowlist`, et lengre `collectionInterval`. Koster ingenting å kjøre og sparer CPU, egress og ingest på én gang. Foretrekk alltid disse der de dekker ditt tilfelle.
- **På filter-prosessoren** — dataene samles inn, og droppes så før eksport. `filters.logs.minSeverity`, `filters.metrics.*`, `namespaceFilters.applyTo.*`. Litt mer collector-CPU, men det fungerer på tvers av mottakere og kan uttrykke ting en mottaker ikke kan.
- **På sampleren** — dataene samles inn, og så beholdes en representativ brøkdel. `sampling.traces.percentage`. Den som skiller seg ut: de to ovenfor fjerner en hel *kategori* av telemetri, så det de dropper, er borte fra hver eneste sporing. Sampling beholder hver kategori og tynner ut populasjonen, så det som overlever, er fortsatt komplett og representativt.

Alle tre er **irreversible**: det du dropper her, når aldri OneUptime, og alle tre kan gjøre at en monitor blir stille. De to første gjør en monitor stille ved å fjerne signalet den følger med på. Sampling er smalere: eBPF RED-metrikkene beregnes før sampleren kjører, så metrikkbaserte monitorer forblir eksakte — men monitorer som teller *spans* (Traces på `Span Count`, Exceptions på `Exception Count`) ser proporsjonalt færre og trenger tersklene sine justert på nytt med den samme faktoren. Hvis du heller vil bestemme deg senere, kan OneUptime droppe data på serversiden i stedet (**Logs → Settings → Drop Filters**, **Metrics → Settings → Pipeline Rules**) — det koster fortsatt egress, men det er en innstilling du kan endre uten en ny deploy.

### Spak 1 — Pod-logger er vanligvis den enkeltstående største kilden

Container-logger er nesten alltid den største andelen av ingest, fordi det er én post per logglinje fra hver container i klyngen.

- **Vil du bare ha logger fra bestemte namespaces?** `namespaceFilters` avgrenser pod-logger i begge loggmodusene (og eBPF-sporinger sammen med dem). Matching skjer på pod-logg-stien, så filtrerte namespaces blir aldri engang lest — dette er den billigste spaken i dette dokumentet:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` er allerede ekskludert som standard.) For å beholde alle namespaces bortsett fra ett, bruk `--set "namespaceFilters.exclude={kube-system,noisy-namespace}"`.

- **Bryr du deg bare om advarsler og feil?** `filters.logs.minSeverity` dropper resten på agenten. På en pratsom klynge er dette ofte den enkeltstående største reduksjonen som er tilgjengelig, fordi INFO og DEBUG utgjør hoveddelen av de fleste applikasjoners utdata:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  Se [Filtrering etter loggalvorlighetsgrad](#filtrering-etter-loggalvorlighetsgrad) for hvordan alvorlighetsgrad fastslås og hva som skjer med logger den ikke klarer å klassifisere.

- **Trenger du ikke pod-logger fra OneUptime i det hele tatt?** Slå dem av:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > Dette stopper bare pod-logger. Metrikker per node, pod og container fortsetter å strømme, og monitorene som er bygget på dem (OOM-kills, CPU-throttling, PVC lav disk) fortsetter å virke — node-collectoren blir værende, den slutter bare å lese `/var/log/pods`. Det samme gjelder `logs.mode: api` og `logs.mode: disabled`.

### Spak 2 — Trim eBPF-autoinstrumentering

eBPF gir deg sporinger, RED-metrikker, service-kartet og nettverksflytmetrikker uten kodeendringer — men den er også den nest største datakilden fordi den sender ut ett span per forespørsel og flere metrikkfamilier per tjeneste. Du har tre kontrollnivåer:

- **Leverer du allerede sporinger fra OTel-SDK-er, eller vil du ikke ha autosporinger?** Slå eBPF helt av:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **Behold sporingene, dropp de tunge metrikkfamiliene.** [Signalfamilie-tabellen ovenfor](#slå-individuelle-signalfamilier-av-og-på) lister opp hvert `ebpf.features.*`-flagg. Familiene med høyest volum er nettverks- og span-metrikker — å slå dem av lar sporinger, HTTP RED-metrikker og service-kartet være intakte:

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

  Se [Slå individuelle signalfamilier av og på](#slå-individuelle-signalfamilier-av-og-på) og `excludeExePaths`-notatet i chart-verdiene for de fullstendige standardverdiene.

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

- **Drop spesifikke metrikker etter navn.** Tillatelseslistene ovenfor er per mottaker; `filters.metrics.exclude` spenner over dem alle, så bruk den for alt de mottaker-nivå-knappene ikke kan uttrykke:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.metrics.matchType=regexp \
    --set-json 'filters.metrics.exclude=["^container_network_"]'
  ```

  Se [Inkludere eller ekskludere metrikker etter navn](#inkludere-eller-ekskludere-metrikker-etter-navn) for eksakt matching kontra regex-matching og for tillatelsesliste-formen.

- **Drop metrikkene til et helt namespace.** Hvis et namespace er støyende, men du fortsatt vil ha nodene dets overvåket, anvender `namespaceFilters.applyTo.metrics=true` de eksisterende namespace-listene dine på serier per pod og per container. Serier på node- og klyngenivå beholdes alltid:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set namespaceFilters.applyTo.metrics=true
  ```

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

### Spak 6 — Sample sporinger i stedet for å droppe dem

Hver spak ovenfor kjøper volum ved å gi opp noe: et namespace du slutter å følge med på, en alvorlighetsgrad du slutter å beholde, en metrikkfamilie du slutter å samle inn. Sampling er unntaket, og på en travel klynge er det ofte den største reduksjonen som er tilgjengelig, for det minste tapet:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

Det er en 90 % reduksjon i sporingsvolum for et smalere tap enn noen annen spak her:

- Sporingene du beholder, er **hele** — avgjørelsen hasher sporings-ID-en, så alle spans i en sporing deler den. Du får færre sporinger, ikke ødelagte.
- **RED-metrikkene dine forblir eksakte.** Forespørselsrate, feilrate og varighet beregnes av OBI fra hver forespørsel og går gjennom metrikk-pipelinen, som sampleren ikke står i. Hvert dashbord og hver monitor bygget på dem viser det samme som før.

Det du gir opp, er stort sett eksempelsporinger: når en monitor utløses, har du en tidel så mange sporinger å åpne. På en klynge som håndterer tusenvis av identiske forespørsler i sekundet, er det vanligvis en god handel — det hundrede identiske `/healthz`-spanet lærer deg ingenting det første ikke gjorde. På en stille klynge er det en dårlig en, fordi du kanskje ikke har noe eksempel på den sjeldne forespørselen som feilet.

Unntaket, og den ene tingen du bør sjekke før du ruller dette ut: monitorer som **teller spans** i stedet for metrikker — Traces på `Span Count`, Exceptions på `Exception Count` — ser proporsjonalt færre, så tersklene deres må justeres på nytt med den samme faktoren. Se [Sampling av sporinger](#sampling-av-sporinger).

Grip til denne når eBPF-sporinger utgjør en stor andel av ingesten din, men du fortsatt vil ha service-kartet og RED-metrikkene intakt. Foretrekk Spak 2 når du vil slutte å instrumentere noe helt.

Se [Sampling av sporinger](#sampling-av-sporinger) for den fullstendige oppførselen, inkludert hvorfor `0` er en rate snarere enn en av-bryter, og hvorfor det ikke finnes noen logg- eller metrikk-ekvivalent.

### Et slankt utgangspunkt

Hvis du vil ha et mindre fotavtrykk, men fortsatt vil at monitorene skal fungere, beholder denne profilen **full metrikkdekning** og kutter de to tingene som faktisk driver volumet — logglinjer og eBPF-spans:

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

# Halverer metrikk-datapunktene. Grovere oppløsning, samme dekning.
collectionInterval: 60s
hostMetrics:
  collectionInterval: 60s
cadvisor:
  scrapeInterval: 60s

# Behold pod-logger, men send bare de som er verdt å varsle på.
# (Metrikker avhenger ikke av dette — node-collectoren kjører uansett.)
logs:
  enabled: true
  mode: daemonset

filters:
  logs:
    minSeverity: WARN # drop INFO / DEBUG / TRACE på agenten

namespaceFilters:
  exclude:
    - kube-system
    - noisy-namespace

ebpf:
  enabled: true
  features:
    networkMetrics: false # de tyngste eBPF-familiene
    tcpStats: false
    spanMetrics: false
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

Stram inn ytterligere ved behov: hev `minSeverity` til `ERROR`, legg til `namespaceFilters.applyTo.metrics=true`, eller sett `ebpf.enabled=false` hvis du allerede leverer sporinger fra OTel-SDK-er.

> **Vær forsiktig med hva du kutter.** Noen monitorer avhenger av spesifikke signaler: å deaktivere `cadvisor` fjerner OOM-kill- og CPU-throttling-monitorene; å deaktivere `kubeletstats.volumeMetrics` fjerner PVC-lavdisk-monitoren; å deaktivere logger fjerner loggbaserte varsler; og `sampling.traces.percentage` fjerner ingen monitor, men skalerer ned de span-baserte (Traces på `Span Count`, Exceptions på `Exception Count`), så juster tersklene deres tilsvarende. Trim signalene du ikke handler på, ikke de en monitor følger med på.

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

1. Utelukk først en avvist ingest-nøkkel — det er den vanligste årsaken og er usynlig fra agentsiden. Se [Agenten viser "Disconnected"](#agenten-viser-disconnected) ovenfor (eller bare kjør diagnostikkskriptet).
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
