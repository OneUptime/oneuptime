import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in Swedish (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * Swedish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Swedish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "Ett Kubernetes-kluster med v1.23 eller senare",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` och `helm` (v3) installerade på din dator",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Fel kluster? Byt med `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Ersätt `my-cluster` med ett namn på det här klustret, till exempel `prod-us-east-1`. Det är så klustret visas i OneUptime, så håll det stabilt: ett nytt namn registrerar ett nytt kluster.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` slår på **AI-utredningar**, som chartet gör som standard: OneUptime AI utreder incidenter och larm på det här klustret med skrivskyddad kubectl, via Kubernetes-AI-agenten.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Välj en intagningsnyckel i steg 1 för att fylla i `<YOUR_API_KEY>`.",
  "You should see:": "Du bör se:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Insamlaren och Kubernetes-AI-agenten, plus en `-logs`- och en `-ebpf`-pod på varje nod. När de är `Running` visas klustret automatiskt i avsnittet **Kubernetes**, oftast inom en eller ett par minuter.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes-AI-agent (på som standard, skrivskyddad).** Podden `kubernetes-agent-ai-agent` låter OneUptime AI utreda incidenter och larm på det här klustret med skrivskyddad kubectl (`get`, `describe`, `logs`, `events`, `top`) med samma API-nyckel, och den kan inte ändra något om du inte senare ger den skrivbehörighet. Öppna klustret och gå till **AI → Agent** för att se den. Vill du inte ha den? Installera med `--set aiAgent.enabled=false` i stället för `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Namespace-regler avgör vad agenten samlar in från varje namespace. För att samla in poddloggar och eBPF-data bara från `default`, `production` och `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "För att behålla allt men stoppa loggarna från stökiga namespaces undantar du dem bara från `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Omfattningar:** `podLogs` (containrarnas stdout/stderr), `ebpfDiscovery` (eBPF-spår och -mätvärden), `metrics` (mätvärden med namespace) och `traces` (varje span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **Mönster** matchar hela namespace-namnet och godtar `*`, som i `team-*`. En `exclude`-regel vinner alltid över en `include`-regel.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Egna regler ersätter standardregeln**, som undantar `kube-system` från `podLogs` och `ebpfDiscovery`. Behåll den i din lista, som i det andra exemplet, om du fortfarande vill det.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Nod- och klustermätvärden har inget namespace, så de behålls alltid.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` kräver Helm 3.10 eller senare.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Skicka bara viktiga rader.** Kasta poddloggrader under en allvarlighetsnivå innan de lämnar klustret:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Godtar `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` och `FATAL`: `WARN` behåller varningar, fel och fatala rader. Allvarlighetsnivån läses från själva loggraden (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes-händelser kastas aldrig av detta.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Stäng av poddloggar.** Mätvärden påverkas inte: nodinsamlaren fortsätter köra för kubelet- och cAdvisor-mätvärden och slutar bara läsa poddloggar:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Ändra hur loggar läses.** Presetet väljer det åt dig; ett uttryckligt `logs.mode` vinner alltid:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: läser `/var/log/pods` på varje nod via hostPath (lägst overhead; kräver hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: ett Deployment följer poddloggar via Kubernetes-API:t (fungerar på alla kluster).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: inga poddloggar.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Det läser API-servern, där den svarar inne i klustret. etcd, schemaläggaren och controller manager svarar på control plane-noderna, som agentens podd inte kan gissa, så den läser dem så snart du anger varje nods adress:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **Schemaläggaren och controller manager** levererar HTTPS och godtar agentens token, men kubeadm binder dem till `127.0.0.1`: ge dem en `--bind-address` som agentens podd kan nå.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** levererar sina mätvärden över vanlig HTTP på kubeadms `--listen-metrics-urls` (port 2381, bunden till `127.0.0.1` tills du lägger till nodens adress), som ovan. Eller läs av dess HTTPS-klientport, 2379, med det klientcertifikat den begär: lägg `ca.crt`, `tls.crt` och `tls.key` i en Secret i `oneuptime-agent` och ange den i `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Bara för självhanterade kluster: hanterade tjänster (EKS, GKE, AKS) exponerar inte mätvärden från sitt control plane.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "Kostnadsövervakning är på som standard: agenten har med sig open source-motorn OpenCost (plus den lilla Prometheus den behöver), prissätter dina noder och volymer efter molnleverantörens offentliga listpriser, utan inloggningsuppgifter, och skickar vad varje namespace och workload kostar. De första data visas på klustrets översikt och sida Kostnader efter den första hela timmen.",
  "On an agent installed before it was on by default, upgrade it:":
    "Uppgradera en agent som installerades innan det var på som standard:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Stäng av det:** lägg till `--set cost.enabled=false` i samma uppgradering.",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "Kostnadsövervakning är avstängd som standard på den här plattformen: den debiterar varje podd efter vad den begär, så de tre kostnadspoddarna skulle öka din räkning, och OpenCost prissätter noder snarare än poddar. Så här slår du på den ändå:",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "Bara det är en komplett installation: chartet har med sig open source-motorn OpenCost (plus den lilla Prometheus den behöver) och prissätter dina noder och volymer efter molnleverantörens offentliga listpriser, utan inloggningsuppgifter. Det lägger till tre små poddar; de första data visas efter den första hela timmen.",
  "- **Already running Kubecost or OpenCost?** Point the agent at it instead, and nothing is bundled: add `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (or your Kubecost service).":
    "- **Kör du redan Kubecost eller OpenCost?** Peka i stället agenten mot den, så följer ingenting med: lägg till `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (eller din Kubecost-tjänst).",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **Lokalt eller bare metal?** Ange en prislista med `--set cost.opencost.customPricing.enabled=true` (USD per resurstimme; se chartets `values.yaml`).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Fullständig guide: [Kostnadsövervakning för Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "Agenten kör [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) på varje nod. Den fångar HTTP/HTTPS-, gRPC- och SQL/Redis-trafik från tjänster i Go, .NET, Java, Node.js, Python, Ruby och Rust, utan SDK och utan sidecar, och skickar spår, förfrågningsmätvärden (RED) och data för tjänstegrafen via insamlaren.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Krav:** Linux-kärna **5.8+** med BTF (standard på Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). eBPF-poddarna körs **privilegierade**, vilket de behöver för att läsa in eBPF-program.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Stäng av det** om dina noder kör en äldre kärna, om privilegierade poddar inte är tillåtna, eller om dina tjänster redan skickar spår med OpenTelemetry-SDK:er och du inte vill ha dubbletter:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Välj signalerna.** Varje familj slås på eller av med `--set ebpf.features.<name>=false` (eller `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Standard | Vad den lägger till |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | på | HTTP/gRPC-förfrågningsfrekvens, fel och latens per tjänst |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | på | Antal anrop och varaktighet för spans (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | på | Kanter från anropare → anropad; driver tjänstekartan |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | på | Räknare för TCP/UDP-flöden från podd till podd |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | av | Nätverksmätvärden mellan zoner (fördubblar deras kardinalitet) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | på | TCP-RTT och räknare för misslyckade anslutningar och omsändningar per nod |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**Spårspridning mellan tjänster** (att knyta en förfrågan som går från podd A → podd B till ett enda spår, även på en annan nod) är **på som standard**. Den fungerar genom att skriva om trafik som redan är på väg (den breddar HTTP-förfrågningar i klartext i kärnan och lägger till ett TCP-alternativ i TLS och rå TCP), och ett fel i den byteräkningen får dataströmmen ur takt: det rapporterade symptomet är överföringar genom en L7-proxy som nginx som hänger sig så snart ett svar passerar ~64KB. Om du ser det, eller om ett service mesh börjar få poddar att fallera, stänger du av den med `--set ebpf.contextPropagation=false`; ett OpenTelemetry-SDK sprider `traceparent` i userspace utan något av detta.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Varje `oneuptime.labels.<key>=<value>` blir etiketten `<key>:<value>` på klustret och på de tjänster och värdar det rapporterar. Etiketter jämförs utan hänsyn till skiftläge, så en befintlig etikett `Production` återanvänds; etiketter som lagts till i OneUptimes gränssnitt tas aldrig bort av agenten.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Uppgradera** till det senaste chartet. `--reset-then-reuse-values` (Helm 3.14+) behåller de värden du har satt (preset, klusternamn, filter) och tar allt annat från det nya chartet; lägg till eventuella nya `--set`-flaggor ovanpå:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Med Helm 3.13 och äldre uppgraderar du i stället med de värden du har satt:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Använd inte `--reuse-values`: det behåller också standardvärdena från det chart du uppgraderar från, så ett nyare charts standardvärden (bland dem dess eBPF-image) börjar aldrig gälla.",
  "**Uninstall** the agent and its namespace:":
    "**Avinstallera** agenten och dess namespace:",
  "| Category | Data |": "| Kategori | Data |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Nodmätvärden** | Användning av CPU, minne, filsystem och nätverk |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Podd- och containermätvärden** | CPU, minne, nätverks-I/O och omstarter |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Klustermätvärden** | Nodtillstånd, allokerbara resurser, antal poddar och workloads |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes-händelser** | Varningar, fel och schemaläggningshändelser |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Poddloggar** | stdout/stderr för varje container, lästa på varje nod |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Applikationsspår** *(eBPF)* | HTTP-, gRPC- och SQL/Redis-spans från varje podd, utan SDK eller kodändringar |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Förfrågningsmätvärden och tjänstegraf** *(eBPF)* | Förfrågningsfrekvens, fel och latens per tjänst, och kanter från anropare → anropad för tjänstekartan |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Nätverksflöden** *(eBPF)* | Räknare för TCP/UDP-byte och -paket från podd till podd |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **Workloadkostnader** *(valfritt, `cost.enabled=true`)* | Kostnad per namespace, workload och podd, med outnyttjad kapacitet och effektivitet |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Workloadkostnader** *(på som standard)* | Kostnad per namespace, workload och podd, med outnyttjad kapacitet och effektivitet, även som mätvärden att larma på |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Ditt kluster blockerar `hostPath`-volymer eller privilegierade poddar. Det är normalt på **GKE Autopilot** och **EKS Fargate**: välj den plattformen högst upp i den här guiden och följ dess steg. På **OpenShift** lyckas installationen däremot, men agentens nodpoddar startar aldrig: välj **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "På alla andra kluster med en restriktiv Pod Security-princip tar du bort den misslyckade releasen:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Kör sedan installationskommandot igen med `--set preset=gke-autopilot` tillagt. Det presetet läser poddloggar via Kubernetes-API:t i stället för hostPath, tillämpar en härdad säkerhetskontext och utelämnar de privilegierade eBPF- och profileringspoddarna.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Kontrollera att agentens poddar körs: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Kontrollera insamlarens loggar: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Bekräfta att OneUptime-URL:en och intagningsnyckeln i installationskommandot är korrekta.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Se till att klustret når din OneUptime-instans över nätverket.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Kontrollera AI-agentens podd: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Kontrollera dess loggar: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Ingen podd? Uppgradera chartet (se **Uppgradera eller avinstallera agenten** under Avancerad) och lägg till `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Kontrollera att klusternamnet stämmer: den här guiden installerar **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Bekräfta agentens RBAC-behörigheter: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Leta efter exportfel i insamlarens loggar: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kärnan är för gammal eller saknar BTF.** eBPF kräver Linux 5.8+ med BTF; kontrollera med `uname -r` på en nod. Om du inte kan uppgradera stänger du av eBPF med `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Privilegierade poddar blockeras.** Vissa låsta kluster avvisar dem. Stäng av eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` finns inte på värden.** Stäng bara av familjen med TCP-statistik: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Kontrollera att eBPF-poddarna är friska: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Slå på OBI:s felsökningsutdata för att bekräfta att den ser trafik: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, och läs sedan `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Om spans dyker upp där men inte i OneUptime letar du efter exportfel i insamlarens loggar: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "Det här installerar agenten för **`k8s-1`**: låt `clusterName` stå exakt som det är, annars registreras datan som ett nytt kluster.",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "AWS CLI (`aws`), inloggad på klustrets konto",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "Google Cloud CLI (`gcloud`) med komponenten `gke-gcloud-auth-plugin`",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "Azure CLI (`az`), inloggad på klustrets prenumeration",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 eller senare och OpenShift CLI (`oc`) inloggad med cluster-admin-behörighet: installationen skapar security context constraints",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "Webbkonsolen ger det exakta kommandot, med token: **Copy login command** under ditt användarnamn. Logga in som klusteradministratör: installationen skapar security context constraints.",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift` skapar två security context constraints (SCC:er), en för nodinsamlaren och en för eBPF-poddarna, som var och en bara används av sitt eget tjänstkonto. Alla andra poddar körs under OpenShifts standard `restricted-v2`, med det användar-ID som OpenShift tilldelar.",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Insamlaren och Kubernetes-AI-agenten, plus en `-logs`- och en `-ebpf`-pod på varje nod. `-logs`- och `-ebpf`-poddarna körs under de SCC:er som chartet skapade åt dem: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` visar båda. När de är `Running` visas klustret automatiskt i avsnittet **Kubernetes**, oftast inom en eller ett par minuter.",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "OpenShift tillåter bara en podd under en security context constraint (SCC) som dess tjänstkonto får använda, och releasen installeras ändå, så en nekad podd dyker helt enkelt aldrig upp. Leta efter nekandet:",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`:** releasen installerades utan openshift-presetet, så chartet skapade inga SCC:er. `helm get values kubernetes-agent --namespace oneuptime-agent` visar de värden den fick. Lägg till presetet:",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **SCC:erna saknas:** kontrollera med `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Att skapa dem kräver cluster-admin-behörighet, så en installation som görs av någon annan misslyckas när den kommer dit.",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`:** namespacets Pod Security-nivå är striktare än vad eBPF-poddarna, som körs privilegierade, behöver. Ge det etiketten `pod-security.kubernetes.io/enforce=privileged`, eller stäng av eBPF med `--set ebpf.enabled=false`.",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **Din klusteradministratör lägger inte till SCC:er:** använd presetet `openshift-restricted`. Chartet skapar då ingen SCC och alla poddar körs under `restricted-v2`, så poddloggar kommer via Kubernetes-API:t och det finns inga värdmätvärden, eBPF-spår eller profiler:",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot` samlar in poddloggar via Kubernetes-API:t i stället för att läsa dem på varje nod, och utelämnar eBPF-spårning och profilering, som kräver privilegierade poddar som GKE Autopilot inte tillåter.",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Insamlaren, Kubernetes-AI-agenten och poddloggläsaren, plus en nodinsamlare per nod för kubelet-mätvärden. När de är `Running` visas klustret automatiskt i avsnittet **Kubernetes**, oftast inom en eller ett par minuter.",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "På andra kluster kör agenten [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) på varje nod för att fånga HTTP-, gRPC- och SQL-spår utan kodändringar. Att läsa in eBPF-program kräver privilegierade poddar, som den här plattformen inte tillåter, så plattformens preset utelämnar det, och den kontinuerliga profileraren med det.",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "För att få spår här instrumenterar du dina tjänster med ett [OpenTelemetry-SDK](/docs/telemetry/open-telemetry) och skickar dem direkt till OneUptime.",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **Poddloggar** | stdout/stderr för varje container, lästa via Kubernetes-API:t |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "Autopilot blockerar hostPath, så nodmätvärden som läser värdens `/proc` och `/sys` (disk-I/O, inoder, NIC-fel) samlas inte in; det gör däremot kubelet- och cAdvisor-mätvärden.",
  "Pod logs are read through the Kubernetes API on this platform.":
    "På den här plattformen läses poddloggar via Kubernetes-API:t.",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. Kontrollera att loggläsaren är redo: `kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. Dess slutpunkt `/healthz` rapporterar antalet aktiva loggströmmar och det senaste exportfelet.",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. På mycket stora kluster kan en läsare halka efter: dela upp namespacen på separata releaser med `namespaceFilters`.",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "AWS CLI (`aws`) och `eksctl`, inloggade på klustrets konto",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "Poddar körs bara på Fargate i namespaces som en Fargate-profil väljer. Skapa en för `oneuptime-agent`: utan den förblir agentens poddar `Pending`:",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate` samlar in poddloggar via Kubernetes-API:t i stället för att läsa dem på varje nod, och utelämnar eBPF-spårning och profilering, som kräver privilegierade poddar som EKS Fargate inte tillåter.",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Tre Deployments: insamlaren, Kubernetes-AI-agenten och poddloggläsaren. Fargate schemalägger aldrig DaemonSets, så det finns inga poddar per nod. När de är `Running` visas klustret automatiskt i avsnittet **Kubernetes**, oftast inom en eller ett par minuter.",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "Ta sedan bort Fargate-profilen: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "Fargate schemalägger aldrig DaemonSets, så nod-, podd- och containermätvärden är inte tillgängliga där.",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "Fargate schemalägger bara poddar i namespaces som en Fargate-profil väljer. Kontrollera att det finns en för `oneuptime-agent`:",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "Om det inte finns någon skapar du den. Fargate väljs när en podd skapas, så poddar som redan väntade fortsätter att vänta: starta om agentens Deployments när profilen är aktiv:",
};

export default TRANSLATION;
