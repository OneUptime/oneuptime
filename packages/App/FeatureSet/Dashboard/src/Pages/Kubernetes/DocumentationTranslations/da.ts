import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in Danish (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * Danish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Danish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "En Kubernetes-klynge med v1.23 eller nyere",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` og `helm` (v3) installeret på din maskine",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Forkert klynge? Skift med `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Erstat `my-cluster` med et navn til denne klynge, for eksempel `prod-us-east-1`. Det er sådan, klyngen vises i OneUptime, så hold det stabilt: et nyt navn registrerer en ny klynge.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` slår **AI-undersøgelser** til, som chartet gør som standard: OneUptime AI undersøger hændelser og advarsler på denne klynge med skrivebeskyttet kubectl via Kubernetes-AI-agenten.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Vælg en indtagelsesnøgle i trin 1 for at udfylde `<YOUR_API_KEY>`.",
  "You should see:": "Du burde se:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Collectoren og Kubernetes-AI-agenten plus én `-logs`- og én `-ebpf`-pod på hver node. Når de er `Running`, vises klyngen automatisk i afsnittet **Kubernetes**, som regel inden for et minut eller to.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes-AI-agent (slået til som standard, skrivebeskyttet).** Poden `kubernetes-agent-ai-agent` lader OneUptime AI undersøge hændelser og advarsler på denne klynge med skrivebeskyttet kubectl (`get`, `describe`, `logs`, `events`, `top`) med den samme API-nøgle, og den kan intet ændre, medmindre du senere giver den skriveadgang. Åbn klyngen, og gå til **AI → Agent** for at se den. Vil du ikke have den? Installér med `--set aiAgent.enabled=false` i stedet for `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Namespace-regler afgør, hvad agenten indsamler fra hvert namespace. For kun at indsamle podlogs og eBPF-data fra `default`, `production` og `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "For at beholde alt, men stoppe logs fra støjende namespaces, skal du kun udelukke dem fra `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Omfang:** `podLogs` (containeres stdout/stderr), `ebpfDiscovery` (eBPF-spor og -metrikker), `metrics` (metrikker med namespace) og `traces` (hvert span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **Mønstre** matcher hele namespace-navnet og accepterer `*`, som i `team-*`. En `exclude`-regel vinder altid over en `include`-regel.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Egne regler erstatter standardreglen**, som udelukker `kube-system` fra `podLogs` og `ebpfDiscovery`. Behold den på din liste, som i det andet eksempel, hvis du stadig vil have det.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Node- og klyngemetrikker har intet namespace, så de beholdes altid.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` kræver Helm 3.10 eller nyere.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Send kun vigtige linjer.** Kassér podloglinjer under en alvorlighed, før de forlader klyngen:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Accepterer `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` og `FATAL`: `WARN` beholder advarsler, fejl og fatale linjer. Alvorligheden læses fra selve loglinjen (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes-hændelser kasseres aldrig af dette.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Slå podlogs fra.** Metrikker påvirkes ikke: nodecollectoren kører videre for kubelet- og cAdvisor-metrikker og holder kun op med at læse podlogs:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Skift, hvordan logs læses.** Presettet vælger det for dig; en udtrykkelig `logs.mode` vinder altid:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: læser `/var/log/pods` på hver node via hostPath (laveste overhead; kræver hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: et Deployment følger podlogs via Kubernetes-API'et (virker på enhver klynge).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: ingen podlogs.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Det læser API-serveren, hvor den svarer inde i klyngen. etcd, scheduleren og controller manageren svarer på control plane-noderne, som agentens pod ikke kan gætte, så den læser dem, så snart du angiver hver nodes adresse:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **Scheduleren og controller manageren** leverer HTTPS og accepterer agentens token, men kubeadm binder dem til `127.0.0.1`: giv dem en `--bind-address`, som agentens pod kan nå.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** leverer sine metrikker over almindelig HTTP på kubeadms `--listen-metrics-urls` (port 2381, bundet til `127.0.0.1`, indtil du tilføjer nodens adresse), som ovenfor. Eller aflæs dens HTTPS-klientport, 2379, med det klientcertifikat, den beder om: læg `ca.crt`, `tls.crt` og `tls.key` i en Secret i `oneuptime-agent`, og angiv den i `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Kun til selvadministrerede klynger: administrerede tjenester (EKS, GKE, AKS) udstiller ikke deres control plane-metrikker.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "Omkostningsovervågning er slået til som standard: agenten medbringer open source-motoren OpenCost (plus den lille Prometheus, den skal bruge), prissætter dine noder og volumes ud fra din cloududbyders offentlige listepriser, uden legitimationsoplysninger, og sender, hvad hvert namespace og hver workload koster. De første data vises på klyngens oversigt og siden Omkostninger efter den første hele time.",
  "On an agent installed before it was on by default, upgrade it:":
    "Er agenten installeret, før det blev slået til som standard, så opgrader den:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Slå det fra:** tilføj `--set cost.enabled=false` til samme opgradering.",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "Omkostningsovervågning er slået fra som standard på denne platform: den fakturerer hver pod efter, hvad den anmoder om, så de tre omkostningspods ville øge din regning, og OpenCost prissætter noder frem for pods. Sådan slår du det til alligevel:",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "Det alene er en komplet installation: chartet medbringer open source-motoren OpenCost (plus den lille Prometheus, den skal bruge) og prissætter dine noder og volumes ud fra din cloududbyders offentlige listepriser, uden legitimationsoplysninger. Den tilføjer tre små pods; de første data vises efter den første hele time.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **Kører du allerede Kubecost eller OpenCost?** Agenten finder den og læser den i stedet for den medfølgende motor, og klyngens oversigt viser det: tilføj `--set cost.engine.url=auto` for ikke at medbringe en ekstra motor.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **On-premises eller bare metal?** Angiv en prisliste med `--set cost.opencost.customPricing.enabled=true` (USD pr. ressourcetime; se chartets `values.yaml`).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Fuld vejledning: [Omkostningsovervågning af Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "Agenten kører [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) på hver node. Den opfanger HTTP/HTTPS-, gRPC- og SQL/Redis-trafik fra tjenester i Go, .NET, Java, Node.js, Python, Ruby og Rust, uden SDK og uden sidecar, og sender spor, anmodningsmetrikker (RED) og data til tjenestegrafen gennem collectoren.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Krav:** Linux-kerne **5.8+** med BTF (standard på Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). eBPF-poderne kører **privilegeret**, hvilket de har brug for til at indlæse eBPF-programmer.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Slå det fra**, hvis dine noder kører en ældre kerne, hvis privilegerede pods ikke er tilladt, eller hvis dine tjenester allerede sender spor med OpenTelemetry-SDK'er, og du ikke vil have dubletter:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Vælg signalerne.** Hver familie slås til eller fra med `--set ebpf.features.<name>=false` (eller `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Standard | Hvad den tilføjer |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | til | HTTP/gRPC-anmodningsrate, fejl og latens pr. tjeneste |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | til | Antal kald og varighed for spans (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | til | Kanter fra kalder → kaldt; driver tjenestekortet |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | til | Tællere for TCP/UDP-flows fra pod til pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | fra | Netværksmetrikker mellem zoner (fordobler deres kardinalitet) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | til | TCP-RTT samt tællere for mislykkede forbindelser og genudsendelser pr. node |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**Sporpropagering på tværs af tjenester** (at samle en anmodning, der går fra pod A → pod B, til ét enkelt spor, også på en anden node) er **slået til som standard**. Den virker ved at omskrive trafik, der allerede er undervejs (den udvider HTTP-anmodninger i klartekst i kernen og føjer en TCP-option til TLS og rå TCP), og en fejl i den byteoptælling bringer datastrømmen ud af takt: Det rapporterede symptom er overførsler gennem en L7-proxy som nginx, der hænger, så snart et svar passerer ~64KB. Hvis du ser det, eller hvis et service mesh begynder at få pods til at fejle, så slå den fra med `--set ebpf.contextPropagation=false`; et OpenTelemetry-SDK propagerer `traceparent` i userspace uden noget af det.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Hver `oneuptime.labels.<key>=<value>` bliver til labelen `<key>:<value>` på klyngen og på de tjenester og værter, den rapporterer. Labels sammenlignes uden hensyn til store og små bogstaver, så en eksisterende label `Production` genbruges; labels, der er tilføjet i OneUptime-brugerfladen, fjernes aldrig af agenten.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Opgrader** til det nyeste chart. `--reset-then-reuse-values` (Helm 3.14+) beholder de værdier, du har sat (preset, klyngenavn, filtre), og tager alt andet fra det nye chart; tilføj eventuelle nye `--set`-flag oven på det:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Med Helm 3.13 og ældre skal du i stedet opgradere med de værdier, du har sat:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Brug ikke `--reuse-values`: det beholder også standardværdierne fra det chart, du opgraderer fra, så et nyere charts standardværdier (blandt andet dets eBPF-image) aldrig træder i kraft.",
  "**Uninstall** the agent and its namespace:":
    "**Afinstallér** agenten og dens namespace:",
  "| Category | Data |": "| Kategori | Data |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Nodemetrikker** | Brug af CPU, hukommelse, filsystem og netværk |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod- og containermetrikker** | CPU, hukommelse, netværks-I/O og genstarter |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Klyngemetrikker** | Nodetilstande, allokerbare ressourcer, antal pods og workloads |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes-hændelser** | Advarsler, fejl og planlægningshændelser |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Podlogs** | stdout/stderr for hver container, læst på hver node |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Applikationsspor** *(eBPF)* | HTTP-, gRPC- og SQL/Redis-spans fra hver pod, uden SDK eller kodeændringer |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Anmodningsmetrikker og tjenestegraf** *(eBPF)* | Anmodningsrate, fejl og latens pr. tjeneste samt kanter fra kalder → kaldt til tjenestekortet |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Netværksflows** *(eBPF)* | Tællere for TCP/UDP-bytes og -pakker fra pod til pod |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **Workloadomkostninger** *(valgfrit, `cost.enabled=true`)* | Forbrug pr. namespace, workload og pod med ubrugt kapacitet og effektivitet |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Workloadomkostninger** *(slået til som standard)* | Forbrug pr. namespace, workload og pod med ubrugt kapacitet og effektivitet, også som metrikker at advare på |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Din klynge blokerer `hostPath`-volumes eller privilegerede pods. Det er normalt på **GKE Autopilot** og **EKS Fargate**: vælg den platform øverst i denne vejledning, og følg dens trin. På **OpenShift** lykkes installationen derimod, men agentens nodepods starter aldrig: vælg **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "På enhver anden klynge med en restriktiv Pod Security-politik skal du fjerne den mislykkede release:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Kør derefter installationskommandoen igen med `--set preset=gke-autopilot` tilføjet. Det preset læser podlogs via Kubernetes-API'et i stedet for hostPath, anvender en skærpet sikkerhedskontekst og udelader de privilegerede eBPF- og profilerings-pods.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Tjek, at agentens pods kører: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Tjek collectorens logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Bekræft, at OneUptime-URL'en og indtagelsesnøglen i installationskommandoen er korrekte.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Sørg for, at klyngen kan nå din OneUptime-instans over netværket.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Tjek AI-agentens pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Tjek dens logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Ingen pod? Opgrader chartet (se **Opgrader eller afinstaller agenten** under Avanceret), og tilføj `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Tjek, at klyngenavnet passer: denne vejledning installerer **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Bekræft agentens RBAC-tilladelser: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Kig efter eksportfejl i collectorens logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kernen er for gammel eller uden BTF.** eBPF kræver Linux 5.8+ med BTF; tjek det med `uname -r` på en node. Kan du ikke opgradere, så slå eBPF fra med `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Privilegerede pods blokeret.** Nogle aflåste klynger afviser dem. Slå eBPF fra.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` er ikke tilgængelige på værten.** Slå kun familien med TCP-statistik fra: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Tjek, at eBPF-poderne er sunde: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Slå OBI's debugoutput til for at bekræfte, at den ser trafik: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, og læs derefter `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Hvis spans dukker op dér, men ikke i OneUptime, så kig efter eksportfejl i collectorens logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "Dette installerer agenten for **`k8s-1`**: lad `clusterName` stå præcis, som det er, ellers registreres dataene som en ny klynge.",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "AWS CLI (`aws`), logget ind på klyngens konto",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "Google Cloud CLI (`gcloud`) med komponenten `gke-gcloud-auth-plugin`",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "Azure CLI (`az`), logget ind på klyngens abonnement",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 eller nyere og OpenShift CLI (`oc`), logget ind med cluster-admin-rettigheder: installationen opretter security context constraints",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "Webkonsollen giver den præcise kommando, inklusive token: **Copy login command** under dit brugernavn. Log ind som klyngeadministrator: installationen opretter security context constraints.",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift` opretter to security context constraints (SCC'er), én til nodecollectoren og én til eBPF-poderne, som hver kun bruges af sin egen servicekonto. Alle andre pods kører under OpenShifts standard `restricted-v2` med det bruger-ID, OpenShift tildeler.",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Collectoren og Kubernetes-AI-agenten plus én `-logs`- og én `-ebpf`-pod på hver node. `-logs`- og `-ebpf`-poderne kører under de SCC'er, chartet har oprettet til dem: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` viser dem begge. Når de er `Running`, vises klyngen automatisk i afsnittet **Kubernetes**, som regel inden for et minut eller to.",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "OpenShift tillader kun en pod under en security context constraint (SCC), som dens servicekonto må bruge, og releasen installeres under alle omstændigheder, så en afvist pod dukker simpelthen aldrig op. Kig efter afvisningen:",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`:** releasen blev installeret uden openshift-presettet, så chartet oprettede ingen SCC'er. `helm get values kubernetes-agent --namespace oneuptime-agent` viser de værdier, den fik. Tilføj presettet:",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **SCC'erne mangler:** tjek med `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. At oprette dem kræver cluster-admin-rettigheder, så en installation foretaget af alle andre mislykkes, når den når til dem.",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`:** namespacets Pod Security-niveau er strengere, end eBPF-poderne, der kører privilegeret, har brug for. Giv det labelen `pod-security.kubernetes.io/enforce=privileged`, eller slå eBPF fra med `--set ebpf.enabled=false`.",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **Din klyngeadministrator vil ikke tilføje SCC'er:** brug presettet `openshift-restricted`. Chartet opretter så ingen SCC, og alle pods kører under `restricted-v2`, så podlogs kommer via Kubernetes-API'et, og der er ingen værtsmetrikker, eBPF-spor eller profiler:",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot` indsamler podlogs via Kubernetes-API'et i stedet for at læse dem på hver node og udelader eBPF-sporing og profilering, som kræver privilegerede pods, som GKE Autopilot ikke tillader.",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Collectoren, Kubernetes-AI-agenten og podlog-læseren plus én nodecollector pr. node til kubelet-metrikker. Når de er `Running`, vises klyngen automatisk i afsnittet **Kubernetes**, som regel inden for et minut eller to.",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "På andre klynger kører agenten [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) på hver node for at opfange HTTP-, gRPC- og SQL-spor uden kodeændringer. At indlæse eBPF-programmer kræver privilegerede pods, som denne platform ikke tillader, så platformens preset udelader det, og den løbende profiler med det.",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "For at få spor her skal du instrumentere dine tjenester med et [OpenTelemetry-SDK](/docs/telemetry/open-telemetry) og sende dem direkte til OneUptime.",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **Podlogs** | stdout/stderr for hver container, læst via Kubernetes-API'et |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "Autopilot blokerer hostPath, så nodemetrikker, der læser værtens `/proc` og `/sys` (disk-I/O, inodes, NIC-fejl), indsamles ikke; det gør kubelet- og cAdvisor-metrikker.",
  "Pod logs are read through the Kubernetes API on this platform.":
    "På denne platform læses podlogs via Kubernetes-API'et.",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. Tjek, at loglæseren er klar: `kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. Dens endpoint `/healthz` rapporterer antallet af aktive logstrømme og den seneste eksportfejl.",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. På meget store klynger kan én læser sakke bagud: fordel namespaces på separate releases med `namespaceFilters`.",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "AWS CLI (`aws`) og `eksctl`, logget ind på klyngens konto",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "Pods kører kun på Fargate i namespaces, som en Fargate-profil vælger. Opret én til `oneuptime-agent`: uden den forbliver agentens pods `Pending`:",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate` indsamler podlogs via Kubernetes-API'et i stedet for at læse dem på hver node og udelader eBPF-sporing og profilering, som kræver privilegerede pods, som EKS Fargate ikke tillader.",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Tre Deployments: collectoren, Kubernetes-AI-agenten og podlog-læseren. Fargate planlægger aldrig DaemonSets, så der er ingen pods pr. node. Når de er `Running`, vises klyngen automatisk i afsnittet **Kubernetes**, som regel inden for et minut eller to.",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "Fjern derefter Fargate-profilen: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "Fargate planlægger aldrig DaemonSets, så node-, pod- og containermetrikker er ikke tilgængelige dér.",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "Fargate planlægger kun pods i namespaces, som en Fargate-profil vælger. Tjek, at der findes én til `oneuptime-agent`:",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "Hvis der ikke er nogen, så opret den. Fargate vælges, når en pod oprettes, så pods, der allerede ventede, bliver ved med at vente: genstart agentens Deployments, når profilen er aktiv:",
};

export default TRANSLATION;
