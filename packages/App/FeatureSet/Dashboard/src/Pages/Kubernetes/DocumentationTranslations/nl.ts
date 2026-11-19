import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in Dutch (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * Dutch. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Dutch words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "Een Kubernetes-cluster met v1.23 of nieuwer",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` en `helm` (v3) geïnstalleerd op je computer",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Verkeerd cluster? Wissel met `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Vervang `my-cluster` door een naam voor dit cluster, zoals `prod-us-east-1`. Onder die naam verschijnt het cluster in OneUptime, dus houd hem stabiel: een nieuwe naam registreert een nieuw cluster.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` zet **AI-onderzoeken** aan, zoals de chart standaard doet: OneUptime AI onderzoekt incidenten en waarschuwingen op dit cluster met alleen-lezen kubectl, via de Kubernetes-AI-agent.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Kies in stap 1 een ingestiesleutel om `<YOUR_API_KEY>` in te vullen.",
  "You should see:": "Je zou dit moeten zien:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "De collector en de Kubernetes-AI-agent, plus één `-logs`- en één `-ebpf`-pod op elke node. Zodra ze `Running` zijn, verschijnt het cluster automatisch in het onderdeel **Kubernetes**, meestal binnen een minuut of twee.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes-AI-agent (standaard aan, alleen-lezen).** Met de pod `kubernetes-agent-ai-agent` kan OneUptime AI incidenten en waarschuwingen op dit cluster onderzoeken met alleen-lezen kubectl (`get`, `describe`, `logs`, `events`, `top`), met dezelfde API-sleutel, en hij kan niets wijzigen tenzij je hem later schrijftoegang geeft. Open het cluster en ga naar **AI → Agent** om hem te zien. Wil je hem niet? Installeer met `--set aiAgent.enabled=false` in plaats van `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Namespace-regels bepalen wat de agent uit elke namespace verzamelt. Om podlogs en eBPF-gegevens alleen uit `default`, `production` en `staging` te verzamelen:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "Om alles te houden maar de logs van luidruchtige namespaces te stoppen, sluit je ze alleen uit van `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Bereiken:** `podLogs` (stdout/stderr van containers), `ebpfDiscovery` (eBPF-traces en -metrieken), `metrics` (metrieken met namespace) en `traces` (elke span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **Patronen** passen op de hele namespacenaam en accepteren `*`, zoals in `team-*`. Een `exclude`-regel wint altijd van een `include`-regel.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Eigen regels vervangen de standaardregel**, die `kube-system` uitsluit van `podLogs` en `ebpfDiscovery`. Houd hem in je lijst, zoals in het tweede voorbeeld, als je dat nog wilt.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Node- en clustermetrieken hebben geen namespace en worden dus altijd behouden.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` vereist Helm 3.10 of nieuwer.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Stuur alleen belangrijke regels.** Laat podlogregels onder een ernstniveau vallen voordat ze het cluster verlaten:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Accepteert `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` en `FATAL`: `WARN` houdt waarschuwingen, fouten en fatale regels. Het ernstniveau wordt uit de logregel zelf gelezen (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes-gebeurtenissen worden hierdoor nooit verworpen.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Zet podlogs uit.** Metrieken worden niet geraakt: de nodecollector blijft draaien voor kubelet- en cAdvisor-metrieken en stopt alleen met het lezen van podlogs:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Verander hoe logs worden gelezen.** De preset kiest dit voor je; een expliciete `logs.mode` gaat altijd voor:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: leest `/var/log/pods` op elke node via hostPath (laagste overhead; vereist hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: een Deployment volgt podlogs via de Kubernetes-API (werkt op elk cluster).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: geen podlogs.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Daarmee wordt de API-server gelezen, waar hij binnen het cluster antwoordt. etcd, de scheduler en de controller manager antwoorden op de control-plane-nodes, die de pod van de agent niet kan raden; hij leest ze dus zodra je het adres van elke node opgeeft:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **De scheduler en de controller manager** serveren HTTPS en accepteren het token van de agent, maar kubeadm bindt ze aan `127.0.0.1`: geef ze een `--bind-address` die de pod van de agent kan bereiken.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** serveert zijn metrieken via gewoon HTTP op de `--listen-metrics-urls` van kubeadm (poort 2381, gebonden aan `127.0.0.1` tot je het adres van de node toevoegt), zoals hierboven. Of lees zijn HTTPS-clientpoort 2379 uit met het clientcertificaat dat hij vraagt: zet `ca.crt`, `tls.crt` en `tls.key` in een Secret in `oneuptime-agent` en noem dat in `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Alleen voor zelfbeheerde clusters: beheerde diensten (EKS, GKE, AKS) stellen hun control-plane-metrieken niet beschikbaar.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "Kostenmonitoring staat standaard aan: de agent levert de opensource-engine OpenCost mee (plus de kleine Prometheus die hij nodig heeft), prijst je nodes en volumes op basis van de openbare catalogusprijzen van je cloudprovider, zonder inloggegevens, en stuurt wat elke namespace en workload kost. De eerste gegevens verschijnen na het eerste volle uur op het overzicht en de pagina Kosten van het cluster.",
  "On an agent installed before it was on by default, upgrade it:":
    "Is de agent geïnstalleerd voordat dit standaard aan stond, upgrade hem dan:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Uitzetten:** voeg `--set cost.enabled=false` toe aan dezelfde upgrade.",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "Kostenmonitoring staat op dit platform standaard uit: het rekent elke pod af op wat hij aanvraagt, dus de drie kostenpods zouden je rekening verhogen, en OpenCost prijst nodes in plaats van pods. Om het toch aan te zetten:",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "Dat alleen is al een volledige installatie: de chart levert de opensource-engine OpenCost mee (plus de kleine Prometheus die hij nodig heeft) en prijst je nodes en volumes op basis van de openbare catalogusprijzen van je cloudprovider, zonder inloggegevens. Hij voegt drie kleine pods toe; de eerste gegevens verschijnen na het eerste volle uur.",
  "- **Already running Kubecost or OpenCost?** Point the agent at it instead, and nothing is bundled: add `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (or your Kubecost service).":
    "- **Draai je al Kubecost of OpenCost?** Wijs de agent er dan naar, en er wordt niets meegeleverd: voeg `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` toe (of je Kubecost-service).",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **On-premises of bare metal?** Stel een tarieflijst in met `--set cost.opencost.customPricing.enabled=true` (USD per resource-uur; zie de `values.yaml` van de chart).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Volledige handleiding: [Kostenobservatie voor Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "De agent draait [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) op elke node. Die vangt HTTP/HTTPS-, gRPC- en SQL/Redis-verkeer op van services in Go, .NET, Java, Node.js, Python, Ruby en Rust, zonder SDK en zonder sidecar, en stuurt traces, aanvraagmetrieken (RED) en servicegrafiekgegevens via de collector.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Vereisten:** Linux-kernel **5.8+** met BTF (de standaard op Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). De eBPF-pods draaien **geprivilegieerd**, wat ze nodig hebben om eBPF-programma's te laden.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Zet het uit** als je nodes een oudere kernel draaien, als geprivilegieerde pods niet zijn toegestaan of als je services al traces sturen met OpenTelemetry-SDK's en je geen duplicaten wilt:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Kies de signalen.** Elke familie zet je aan of uit met `--set ebpf.features.<name>=false` (of `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Standaard | Wat het toevoegt |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | aan | HTTP/gRPC-aanvraagsnelheid, fouten en latentie per service |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | aan | Aantal aanroepen en duur van spans (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | aan | Randen van aanroeper → aangeroepene; voedt de servicekaart |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | aan | Tellers voor TCP/UDP-flows van pod naar pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | uit | Netwerkmetrieken tussen zones (verdubbelt hun kardinaliteit) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | aan | TCP-RTT en tellers voor mislukte verbindingen en hertransmissies per node |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**Trace-propagatie tussen services** (een aanvraag die van pod A → pod B gaat, ook op een andere node, tot één trace koppelen) staat **standaard aan**. Het werkt door verkeer te herschrijven dat al onderweg is (HTTP-aanvragen in platte tekst in de kernel verbreden, en een TCP-optie toevoegen aan TLS en kale TCP), en een fout in die bytetelling brengt de stroom uit de pas: het gemelde symptoom zijn overdrachten via een L7-proxy zoals nginx die blijven hangen zodra een antwoord ~64KB passeert. Zie je dat, of laat een service mesh pods falen, zet het dan uit met `--set ebpf.contextPropagation=false`; een OpenTelemetry-SDK propageert `traceparent` in de userspace zonder dat alles.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Elke `oneuptime.labels.<key>=<value>` wordt het label `<key>:<value>` op het cluster en op de services en hosts die het meldt. Labels worden hoofdletterongevoelig vergeleken, dus een bestaand label `Production` wordt hergebruikt; labels die in de OneUptime-interface zijn toegevoegd, verwijdert de agent nooit.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Upgrade** naar de nieuwste chart. `--reset-then-reuse-values` (Helm 3.14+) behoudt de waarden die je hebt ingesteld (preset, clusternaam, filters) en neemt al het andere over uit de nieuwe chart; voeg eventuele nieuwe `--set`-flags erbovenop toe:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Met Helm 3.13 en ouder upgrade je in plaats daarvan met de waarden die je hebt ingesteld:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Gebruik geen `--reuse-values`: dat behoudt ook de standaardwaarden van de chart waarvan je upgradet, zodat de standaardwaarden van een nieuwere chart (waaronder zijn eBPF-image) nooit gelden.",
  "**Uninstall** the agent and its namespace:":
    "**Verwijder** de agent en zijn namespace:",
  "| Category | Data |": "| Categorie | Gegevens |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Nodemetrieken** | Gebruik van CPU, geheugen, bestandssysteem en netwerk |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod- en containermetrieken** | CPU, geheugen, netwerk-I/O en herstarts |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Clustermetrieken** | Nodecondities, toewijsbare resources, aantal pods en workloads |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes-gebeurtenissen** | Waarschuwingen, fouten en planningsgebeurtenissen |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Podlogs** | stdout/stderr van elke container, op elke node gelezen |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Applicatietraces** *(eBPF)* | HTTP-, gRPC- en SQL/Redis-spans van elke pod, zonder SDK of codewijzigingen |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Aanvraagmetrieken en servicegrafiek** *(eBPF)* | Aanvraagsnelheid, fouten en latentie per service, en randen van aanroeper → aangeroepene voor de servicekaart |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Netwerkflows** *(eBPF)* | Tellers voor TCP/UDP-bytes en -pakketten van pod naar pod |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **Workloadkosten** *(optioneel, `cost.enabled=true`)* | Uitgaven per namespace, workload en pod, met ongebruikte capaciteit en efficiëntie |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Workloadkosten** *(standaard aan)* | Uitgaven per namespace, workload en pod, met ongebruikte capaciteit en efficiëntie, ook als metrieken om op te waarschuwen |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Je cluster blokkeert `hostPath`-volumes of geprivilegieerde pods. Dat is normaal op **GKE Autopilot** en **EKS Fargate**: kies dat platform bovenaan deze handleiding en volg de stappen ervan. Op **OpenShift** slaagt de installatie juist, maar starten de nodepods van de agent nooit: kies **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "Verwijder op elk ander cluster met een restrictief Pod Security-beleid de mislukte release:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Voer daarna het installatiecommando opnieuw uit met `--set preset=gke-autopilot` erbij. Die preset leest podlogs via de Kubernetes-API in plaats van hostPath, past een geharde beveiligingscontext toe en laat de geprivilegieerde eBPF- en profilingpods weg.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Controleer of de pods van de agent draaien: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Bekijk de logs van de collector: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Controleer of de OneUptime-URL en de ingestiesleutel in het installatiecommando kloppen.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Zorg dat het cluster je OneUptime-instantie via het netwerk kan bereiken.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Controleer de pod van de AI-agent: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Bekijk zijn logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Geen pod? Upgrade de chart (zie **De agent upgraden of verwijderen** onder Geavanceerd) en voeg `--set aiAgent.enabled=true` toe.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Controleer of de clusternaam klopt: deze handleiding installeert **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Controleer de RBAC-rechten van de agent: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Zoek in de logs van de collector naar exportfouten: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kernel te oud of geen BTF.** eBPF heeft Linux 5.8+ met BTF nodig; controleer het met `uname -r` op een node. Kun je niet upgraden, zet eBPF dan uit met `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Geprivilegieerde pods geblokkeerd.** Sommige dichtgetimmerde clusters weigeren ze. Zet eBPF uit.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` niet beschikbaar op de host.** Zet alleen de familie van TCP-statistieken uit: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Controleer of de eBPF-pods gezond zijn: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Zet de debuguitvoer van OBI aan om te bevestigen dat hij verkeer ziet: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, en lees daarna `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Verschijnen er daar spans maar niet in OneUptime, zoek dan in de logs van de collector naar exportfouten: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "Hiermee installeer je de agent voor **`k8s-1`**: laat `clusterName` precies zoals het is, anders worden de gegevens als een nieuw cluster geregistreerd.",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "De AWS CLI (`aws`), aangemeld bij het account van het cluster",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "De Google Cloud CLI (`gcloud`) met het onderdeel `gke-gcloud-auth-plugin`",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "De Azure CLI (`az`), aangemeld bij het abonnement van het cluster",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 of nieuwer, en de OpenShift CLI (`oc`) aangemeld met cluster-admin-rechten: de installatie maakt security context constraints aan",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "De webconsole geeft het exacte commando, inclusief token: **Copy login command**, onder je gebruikersnaam. Meld je aan als clusterbeheerder: de installatie maakt security context constraints aan.",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift` maakt twee security context constraints (SCC's) aan, één voor de nodecollector en één voor de eBPF-pods, elk alleen gebruikt door het eigen serviceaccount. Elke andere pod draait onder de standaard `restricted-v2` van OpenShift, met de gebruikers-ID die OpenShift toewijst.",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "De collector en de Kubernetes-AI-agent, plus één `-logs`- en één `-ebpf`-pod op elke node. De `-logs`- en `-ebpf`-pods draaien onder de SCC's die de chart voor ze heeft aangemaakt: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` toont ze allebei. Zodra ze `Running` zijn, verschijnt het cluster automatisch in het onderdeel **Kubernetes**, meestal binnen een minuut of twee.",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "OpenShift laat een pod alleen toe onder een security context constraint (SCC) die zijn serviceaccount mag gebruiken, en de release wordt hoe dan ook geïnstalleerd, dus een geweigerde pod verschijnt gewoon nooit. Zoek naar de weigering:",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`:** de release is geïnstalleerd zonder de openshift-preset, dus de chart heeft geen SCC's aangemaakt. `helm get values kubernetes-agent --namespace oneuptime-agent` toont de waarden die hij kreeg. Voeg de preset toe:",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **De SCC's ontbreken:** controleer met `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Ze aanmaken vereist cluster-admin-rechten, dus een installatie door iemand anders mislukt zodra die daar aankomt.",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`:** het Pod Security-niveau van de namespace is strenger dan de eBPF-pods, die geprivilegieerd draaien, nodig hebben. Geef de namespace het label `pod-security.kubernetes.io/enforce=privileged`, of zet eBPF uit met `--set ebpf.enabled=false`.",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **Je clusterbeheerder voegt geen SCC's toe:** gebruik de preset `openshift-restricted`. De chart maakt dan geen SCC aan en elke pod draait onder `restricted-v2`, dus podlogs komen via de Kubernetes-API binnen en er zijn geen hostmetrieken, eBPF-traces of profielen:",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot` verzamelt podlogs via de Kubernetes-API in plaats van ze op elke node te lezen, en laat eBPF-tracing en profiling weg, die geprivilegieerde pods nodig hebben die GKE Autopilot niet toestaat.",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "De collector, de Kubernetes-AI-agent en de podloglezer, plus één nodecollector per node voor kubelet-metrieken. Zodra ze `Running` zijn, verschijnt het cluster automatisch in het onderdeel **Kubernetes**, meestal binnen een minuut of twee.",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "Op andere clusters draait de agent [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) op elke node om HTTP-, gRPC- en SQL-traces zonder codewijzigingen vast te leggen. Het laden van eBPF-programma's vereist geprivilegieerde pods, die dit platform niet toestaat; de preset van het platform laat het dus weg, en de continue profiler erbij.",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "Wil je hier traces, instrumenteer je services dan met een [OpenTelemetry-SDK](/docs/telemetry/open-telemetry) en stuur ze rechtstreeks naar OneUptime.",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **Podlogs** | stdout/stderr van elke container, via de Kubernetes-API gelezen |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "Autopilot blokkeert hostPath, dus nodemetrieken die `/proc` en `/sys` van de host lezen (schijf-I/O, inodes, NIC-fouten) worden niet verzameld; kubelet- en cAdvisor-metrieken wel.",
  "Pod logs are read through the Kubernetes API on this platform.":
    "Op dit platform worden podlogs via de Kubernetes-API gelezen.",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. Controleer of de loglezer klaar is: `kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. Zijn endpoint `/healthz` meldt het aantal actieve logstromen en de laatste exportfout.",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. Op zeer grote clusters kan één lezer achteropraken: verdeel de namespaces over aparte releases met `namespaceFilters`.",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "De AWS CLI (`aws`) en `eksctl`, aangemeld bij het account van het cluster",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "Op Fargate draaien pods alleen in namespaces die een Fargate-profiel selecteert. Maak er een aan voor `oneuptime-agent`; zonder profiel blijven de pods van de agent `Pending`:",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate` verzamelt podlogs via de Kubernetes-API in plaats van ze op elke node te lezen, en laat eBPF-tracing en profiling weg, die geprivilegieerde pods nodig hebben die EKS Fargate niet toestaat.",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Drie Deployments: de collector, de Kubernetes-AI-agent en de podloglezer. Fargate plant nooit DaemonSets in, dus er zijn geen pods per node. Zodra ze `Running` zijn, verschijnt het cluster automatisch in het onderdeel **Kubernetes**, meestal binnen een minuut of twee.",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "Verwijder daarna het Fargate-profiel: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "Fargate plant nooit DaemonSets in, dus node-, pod- en containermetrieken zijn daar niet beschikbaar.",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "Fargate plant pods alleen in namespaces in die een Fargate-profiel selecteert. Controleer of er een bestaat voor `oneuptime-agent`:",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "Is er geen, maak het dan aan. Fargate wordt gekozen wanneer een pod wordt aangemaakt, dus pods die al wachtten, blijven wachten: herstart de Deployments van de agent zodra het profiel actief is:",
};

export default TRANSLATION;
