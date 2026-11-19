import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in Norwegian (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * Norwegian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Norwegian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "En Kubernetes-klynge med v1.23 eller nyere",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` og `helm` (v3) installert på maskinen din",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Feil klynge? Bytt med `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Erstatt `my-cluster` med et navn på denne klyngen, for eksempel `prod-us-east-1`. Det er slik klyngen vises i OneUptime, så hold det stabilt: et nytt navn registrerer en ny klynge.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` slår på **KI-undersøkelser**, slik chartet gjør som standard: OneUptime AI undersøker hendelser og varsler på denne klyngen med skrivebeskyttet kubectl, gjennom Kubernetes-AI-agenten.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Velg en inntaksnøkkel i trinn 1 for å fylle inn `<YOUR_API_KEY>`.",
  "You should see:": "Du bør se:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Innsamleren og Kubernetes-AI-agenten, pluss én `-logs`- og én `-ebpf`-pod på hver node. Når de er `Running`, vises klyngen automatisk i delen **Kubernetes**, vanligvis innen et minutt eller to.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes-AI-agent (på som standard, skrivebeskyttet).** Poden `kubernetes-agent-ai-agent` lar OneUptime AI undersøke hendelser og varsler på denne klyngen med skrivebeskyttet kubectl (`get`, `describe`, `logs`, `events`, `top`) med den samme API-nøkkelen, og den kan ikke endre noe med mindre du senere gir den skrivetilgang. Åpne klyngen og gå til **KI → Agent** for å se den. Vil du ikke ha den? Installer med `--set aiAgent.enabled=false` i stedet for `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Namespace-regler avgjør hva agenten samler inn fra hvert namespace. For å samle podlogger og eBPF-data bare fra `default`, `production` og `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "For å beholde alt, men stoppe loggene fra støyende namespaces, utelukker du dem bare fra `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Omfang:** `podLogs` (containernes stdout/stderr), `ebpfDiscovery` (eBPF-spor og -målinger), `metrics` (målinger med namespace) og `traces` (hvert span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **Mønstre** samsvarer med hele namespace-navnet og godtar `*`, som i `team-*`. En `exclude`-regel vinner alltid over en `include`-regel.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Egne regler erstatter standardregelen**, som utelukker `kube-system` fra `podLogs` og `ebpfDiscovery`. Behold den i listen din, som i det andre eksemplet, hvis du fortsatt vil ha det.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Node- og klyngemålinger har ikke noe namespace, så de beholdes alltid.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` krever Helm 3.10 eller nyere.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Send bare viktige linjer.** Forkast podlogglinjer under et alvorlighetsnivå før de forlater klyngen:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Godtar `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` og `FATAL`: `WARN` beholder advarsler, feil og fatale linjer. Alvorlighetsnivået leses fra selve logglinjen (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes-hendelser forkastes aldri av dette.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Slå av podlogger.** Målingene påvirkes ikke: nodeinnsamleren fortsetter å kjøre for kubelet- og cAdvisor-målinger og slutter bare å lese podlogger:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Endre hvordan logger leses.** Presettet velger dette for deg; en eksplisitt `logs.mode` vinner alltid:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: leser `/var/log/pods` på hver node via hostPath (lavest overhead; krever hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: et Deployment følger podlogger via Kubernetes-API-et (virker på alle klynger).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: ingen podlogger.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Det leser API-serveren, der den svarer inne i klyngen. etcd, scheduleren og controller manageren svarer på control plane-nodene, som agentens pod ikke kan gjette, så den leser dem så snart du oppgir adressen til hver node:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **Scheduleren og controller manageren** leverer HTTPS og godtar agentens token, men kubeadm binder dem til `127.0.0.1`: gi dem en `--bind-address` som agentens pod kan nå.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** leverer målingene sine over vanlig HTTP på kubeadms `--listen-metrics-urls` (port 2381, bundet til `127.0.0.1` til du legger til nodens adresse), som over. Eller les av HTTPS-klientporten, 2379, med klientsertifikatet den ber om: legg `ca.crt`, `tls.crt` og `tls.key` i en Secret i `oneuptime-agent` og oppgi den i `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Bare for selvadministrerte klynger: administrerte tjenester (EKS, GKE, AKS) eksponerer ikke målingene for sitt control plane.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "Kostnadsovervåking er på som standard: agenten har med open source-motoren OpenCost (pluss den lille Prometheus-en den trenger), priser nodene og volumene dine etter skyleverandørens offentlige listepriser, uten påloggingsinformasjon, og sender hva hvert namespace og hver workload koster. De første dataene vises på klyngens oversikt og siden Kostnader etter den første hele timen.",
  "On an agent installed before it was on by default, upgrade it:":
    "Ble agenten installert før dette var på som standard, oppgraderer du den:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Slå det av:** legg til `--set cost.enabled=false` i den samme oppgraderingen.",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "Kostnadsovervåking er av som standard på denne plattformen: den fakturerer hver pod etter det den ber om, så de tre kostnadspodene ville økt regningen din, og OpenCost priser noder, ikke pods. Slik slår du det på likevel:",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "Det alene er en komplett installasjon: chartet har med open source-motoren OpenCost (pluss den lille Prometheus-en den trenger) og priser nodene og volumene dine etter skyleverandørens offentlige listepriser, uten påloggingsinformasjon. Den legger til tre små pods; de første dataene vises etter den første hele timen.",
  "- **Already running Kubecost or OpenCost?** Point the agent at it instead, and nothing is bundled: add `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (or your Kubecost service).":
    "- **Kjører du allerede Kubecost eller OpenCost?** Pek heller agenten mot den, så tas ingenting med: legg til `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (eller Kubecost-tjenesten din).",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **Lokalt eller bare metal?** Sett en prisliste med `--set cost.opencost.customPricing.enabled=true` (USD per ressurstime; se chartets `values.yaml`).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Full veiledning: [Kostnadsovervåking for Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "Agenten kjører [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) på hver node. Den fanger opp HTTP/HTTPS-, gRPC- og SQL/Redis-trafikk fra tjenester i Go, .NET, Java, Node.js, Python, Ruby og Rust, uten SDK og uten sidecar, og sender spor, forespørselsmålinger (RED) og tjenestegrafdata gjennom innsamleren.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Krav:** Linux-kjerne **5.8+** med BTF (standard på Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). eBPF-podene kjører **privilegert**, noe de trenger for å laste eBPF-programmer.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Slå det av** hvis nodene dine kjører en eldre kjerne, hvis privilegerte pods ikke er tillatt, eller hvis tjenestene dine allerede sender spor med OpenTelemetry-SDK-er og du ikke vil ha duplikater:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Velg signalene.** Hver familie slås av eller på med `--set ebpf.features.<name>=false` (eller `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Standard | Hva den legger til |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | på | HTTP/gRPC-forespørselsrate, feil og latens per tjeneste |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | på | Antall kall og varighet for spans (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | på | Kanter fra kaller → kalt; driver tjenestekartet |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | på | Tellere for TCP/UDP-flyt fra pod til pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | av | Nettverksmålinger mellom soner (dobler kardinaliteten) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | på | TCP-RTT og tellere for mislykkede tilkoblinger og retransmisjoner per node |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**Sporpropagering på tvers av tjenester** (å knytte en forespørsel som går fra pod A → pod B til ett enkelt spor, også på en annen node) er **på som standard**. Den virker ved å skrive om trafikk som allerede er underveis (den utvider HTTP-forespørsler i klartekst i kjernen og legger en TCP-opsjon til TLS og rå TCP), og en feil i denne bytetellingen bringer datastrømmen ut av takt: Det rapporterte symptomet er overføringer gjennom en L7-proxy som nginx som henger så snart et svar passerer ~64KB. Hvis du ser det, eller hvis et service mesh begynner å få pods til å feile, slår du den av med `--set ebpf.contextPropagation=false`; et OpenTelemetry-SDK propagerer `traceparent` i userspace uten noe av dette.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Hver `oneuptime.labels.<key>=<value>` blir etiketten `<key>:<value>` på klyngen og på tjenestene og vertene den rapporterer. Etiketter sammenlignes uten hensyn til store og små bokstaver, så en eksisterende etikett `Production` gjenbrukes; etiketter som er lagt til i OneUptime-grensesnittet, fjernes aldri av agenten.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Oppgrader** til det nyeste chartet. `--reset-then-reuse-values` (Helm 3.14+) beholder verdiene du har satt (preset, klyngenavn, filtre), og tar alt annet fra det nye chartet; legg eventuelle nye `--set`-flagg oppå:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Med Helm 3.13 og eldre oppgraderer du i stedet med verdiene du har satt:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Ikke bruk `--reuse-values`: det beholder også standardverdiene fra chartet du oppgraderer fra, så standardverdiene i et nyere chart (blant annet eBPF-imaget) aldri tas i bruk.",
  "**Uninstall** the agent and its namespace:":
    "**Avinstaller** agenten og namespacet dens:",
  "| Category | Data |": "| Kategori | Data |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Nodemålinger** | Bruk av CPU, minne, filsystem og nettverk |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod- og containermålinger** | CPU, minne, nettverks-I/O og omstarter |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Klyngemålinger** | Nodetilstander, allokerbare ressurser, antall pods og workloads |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes-hendelser** | Advarsler, feil og planleggingshendelser |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Podlogger** | stdout/stderr for hver container, lest på hver node |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Applikasjonsspor** *(eBPF)* | HTTP-, gRPC- og SQL/Redis-spans fra hver pod, uten SDK eller kodeendringer |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Forespørselsmålinger og tjenestegraf** *(eBPF)* | Forespørselsrate, feil og latens per tjeneste, og kanter fra kaller → kalt til tjenestekartet |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Nettverksflyt** *(eBPF)* | Tellere for TCP/UDP-byte og -pakker fra pod til pod |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **Workloadkostnader** *(valgfritt, `cost.enabled=true`)* | Forbruk per namespace, workload og pod, med ubrukt kapasitet og effektivitet |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Workloadkostnader** *(på som standard)* | Forbruk per namespace, workload og pod, med ubrukt kapasitet og effektivitet, også som målinger å varsle på |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Klyngen din blokkerer `hostPath`-volumer eller privilegerte pods. Det er normalt på **GKE Autopilot** og **EKS Fargate**: velg den plattformen øverst i denne veiledningen og følg trinnene dens. På **OpenShift** lykkes installasjonen derimot, men agentens nodepods starter aldri: velg **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "På alle andre klynger med en restriktiv Pod Security-policy fjerner du den mislykkede releasen:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Kjør deretter installasjonskommandoen på nytt med `--set preset=gke-autopilot` lagt til. Det presettet leser podlogger via Kubernetes-API-et i stedet for hostPath, bruker en herdet sikkerhetskontekst og utelater de privilegerte eBPF- og profileringspodene.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Sjekk at agentens pods kjører: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Sjekk innsamlerens logger: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Bekreft at OneUptime-URL-en og inntaksnøkkelen i installasjonskommandoen er riktige.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Sørg for at klyngen kan nå OneUptime-instansen din over nettverket.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Sjekk AI-agentens pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Sjekk loggene dens: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Ingen pod? Oppgrader chartet (se **Oppgrader eller avinstaller agenten** under Avansert) og legg til `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Sjekk at klyngenavnet stemmer: denne veiledningen installerer **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Bekreft agentens RBAC-tillatelser: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Se etter eksportfeil i innsamlerens logger: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kjernen er for gammel eller uten BTF.** eBPF krever Linux 5.8+ med BTF; sjekk med `uname -r` på en node. Kan du ikke oppgradere, slår du av eBPF med `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Privilegerte pods blokkert.** Noen låste klynger avviser dem. Slå av eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` er ikke tilgjengelige på verten.** Slå bare av familien med TCP-statistikk: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Sjekk at eBPF-podene er friske: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Slå på OBIs feilsøkingsutdata for å bekrefte at den ser trafikk: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, og les deretter `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Hvis spans dukker opp der, men ikke i OneUptime, ser du etter eksportfeil i innsamlerens logger: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "Dette installerer agenten for **`k8s-1`**: la `clusterName` stå nøyaktig som det er, ellers registreres dataene som en ny klynge.",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "AWS CLI (`aws`), logget på klyngens konto",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "Google Cloud CLI (`gcloud`) med komponenten `gke-gcloud-auth-plugin`",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "Azure CLI (`az`), logget på klyngens abonnement",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 eller nyere, og OpenShift CLI (`oc`) logget på med cluster-admin-rettigheter: installasjonen oppretter security context constraints",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "Nettkonsollen gir den nøyaktige kommandoen, med token: **Copy login command**, under brukernavnet ditt. Logg på som klyngeadministrator: installasjonen oppretter security context constraints.",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift` oppretter to security context constraints (SCC-er), én for nodeinnsamleren og én for eBPF-podene, som hver bare brukes av sin egen tjenestekonto. Alle andre pods kjører under OpenShifts standard `restricted-v2`, med bruker-ID-en OpenShift tildeler.",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Innsamleren og Kubernetes-AI-agenten, pluss én `-logs`- og én `-ebpf`-pod på hver node. `-logs`- og `-ebpf`-podene kjører under SCC-ene chartet opprettet for dem: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` viser begge. Når de er `Running`, vises klyngen automatisk i delen **Kubernetes**, vanligvis innen et minutt eller to.",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "OpenShift tillater bare en pod under en security context constraint (SCC) som tjenestekontoen dens kan bruke, og releasen installeres uansett, så en avvist pod dukker rett og slett aldri opp. Se etter avvisningen:",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`:** releasen ble installert uten openshift-presettet, så chartet opprettet ingen SCC-er. `helm get values kubernetes-agent --namespace oneuptime-agent` viser verdiene den fikk. Legg til presettet:",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **SCC-ene mangler:** sjekk med `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Å opprette dem krever cluster-admin-rettigheter, så en installasjon gjort av noen andre mislykkes når den kommer dit.",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`:** namespacets Pod Security-nivå er strengere enn eBPF-podene, som kjører privilegert, trenger. Gi det etiketten `pod-security.kubernetes.io/enforce=privileged`, eller slå av eBPF med `--set ebpf.enabled=false`.",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **Klyngeadministratoren din vil ikke legge til SCC-er:** bruk presettet `openshift-restricted`. Chartet oppretter da ingen SCC, og alle pods kjører under `restricted-v2`, så podlogger kommer via Kubernetes-API-et, og det er ingen vertsmålinger, eBPF-spor eller profiler:",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot` samler inn podlogger via Kubernetes-API-et i stedet for å lese dem på hver node, og utelater eBPF-sporing og profilering, som krever privilegerte pods som GKE Autopilot ikke tillater.",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Innsamleren, Kubernetes-AI-agenten og podloggleseren, pluss én nodeinnsamler per node for kubelet-målinger. Når de er `Running`, vises klyngen automatisk i delen **Kubernetes**, vanligvis innen et minutt eller to.",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "På andre klynger kjører agenten [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) på hver node for å fange opp HTTP-, gRPC- og SQL-spor uten kodeendringer. Å laste eBPF-programmer krever privilegerte pods, som denne plattformen ikke tillater, så plattformens preset utelater det, og den kontinuerlige profilereren med det.",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "For å få spor her instrumenterer du tjenestene dine med et [OpenTelemetry-SDK](/docs/telemetry/open-telemetry) og sender dem direkte til OneUptime.",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **Podlogger** | stdout/stderr for hver container, lest via Kubernetes-API-et |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "Autopilot blokkerer hostPath, så nodemålinger som leser vertens `/proc` og `/sys` (disk-I/O, inoder, NIC-feil), samles ikke inn; kubelet- og cAdvisor-målinger gjør det.",
  "Pod logs are read through the Kubernetes API on this platform.":
    "På denne plattformen leses podlogger via Kubernetes-API-et.",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. Sjekk at loggleseren er klar: `kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. Endepunktet `/healthz` rapporterer antall aktive loggstrømmer og den siste eksportfeilen.",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. På svært store klynger kan én leser henge etter: fordel namespacene på separate releaser med `namespaceFilters`.",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "AWS CLI (`aws`) og `eksctl`, logget på klyngens konto",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "Pods kjører bare på Fargate i namespaces som en Fargate-profil velger. Opprett en for `oneuptime-agent`: uten den blir agentens pods stående `Pending`:",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate` samler inn podlogger via Kubernetes-API-et i stedet for å lese dem på hver node, og utelater eBPF-sporing og profilering, som krever privilegerte pods som EKS Fargate ikke tillater.",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Tre Deployments: innsamleren, Kubernetes-AI-agenten og podloggleseren. Fargate planlegger aldri DaemonSets, så det finnes ingen pods per node. Når de er `Running`, vises klyngen automatisk i delen **Kubernetes**, vanligvis innen et minutt eller to.",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "Fjern deretter Fargate-profilen: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "Fargate planlegger aldri DaemonSets, så node-, pod- og containermålinger er ikke tilgjengelige der.",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "Fargate planlegger bare pods i namespaces som en Fargate-profil velger. Sjekk at det finnes en for `oneuptime-agent`:",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "Hvis det ikke finnes noen, oppretter du den. Fargate velges når en pod opprettes, så pods som allerede ventet, fortsetter å vente: start agentens Deployments på nytt når profilen er aktiv:",
};

export default TRANSLATION;
