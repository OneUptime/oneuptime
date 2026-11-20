import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in German (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * German. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its German words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "Ein Kubernetes-Cluster mit v1.23 oder neuer",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` und `helm` (v3), auf Ihrem Rechner installiert",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "Falscher Cluster? Wechseln Sie mit `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Ersetzen Sie `my-cluster` durch einen Namen für diesen Cluster, etwa `prod-us-east-1`. Unter diesem Namen erscheint der Cluster in OneUptime, halten Sie ihn also stabil: Ein neuer Name registriert einen neuen Cluster.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` schaltet **KI-Untersuchungen** ein, wie es das Chart standardmäßig tut: OneUptime AI untersucht Vorfälle und Warnungen in diesem Cluster mit schreibgeschütztem kubectl, über den Kubernetes-KI-Agenten.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Wählen Sie in Schritt 1 einen Ingestion-Schlüssel, um `<YOUR_API_KEY>` auszufüllen.",
  "You should see:": "Sie sollten Folgendes sehen:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Den Collector und den Kubernetes-KI-Agenten, dazu je einen `-logs`- und einen `-ebpf`-Pod auf jedem Knoten. Sobald sie `Running` sind, erscheint der Cluster automatisch im Bereich **Kubernetes**, meist innerhalb von ein, zwei Minuten.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes-KI-Agent (standardmäßig an, schreibgeschützt).** Der Pod `kubernetes-agent-ai-agent` lässt OneUptime AI Vorfälle und Warnungen in diesem Cluster mit schreibgeschütztem kubectl untersuchen (`get`, `describe`, `logs`, `events`, `top`), mit demselben API-Schlüssel, und er kann nichts ändern, solange Sie ihm später keinen Schreibzugriff geben. Öffnen Sie den Cluster und gehen Sie zu **KI → Agent**, um ihn zu sehen. Sie möchten ihn nicht? Installieren Sie mit `--set aiAgent.enabled=false` statt `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Namespace-Regeln legen fest, was der Agent aus jedem Namespace sammelt. Um Pod-Logs und eBPF-Daten nur aus `default`, `production` und `staging` zu sammeln:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "Um alles zu behalten, aber die Logs lauter Namespaces zu stoppen, schließen Sie sie nur von `podLogs` aus:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Geltungsbereiche:** `podLogs` (stdout/stderr der Container), `ebpfDiscovery` (eBPF-Traces und -Metriken), `metrics` (Namespace-Metriken) und `traces` (jeder Span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **Muster** passen auf den ganzen Namespace-Namen und akzeptieren `*`, wie in `team-*`. Eine `exclude`-Regel gewinnt immer gegen eine `include`-Regel.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Eigene Regeln ersetzen die Standardregel**, die `kube-system` von `podLogs` und `ebpfDiscovery` ausschließt. Behalten Sie sie in Ihrer Liste, wie im zweiten Beispiel, wenn Sie das weiterhin möchten.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Knoten- und Cluster-Metriken haben keinen Namespace und werden daher immer behalten.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` erfordert Helm 3.10 oder neuer.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Nur wichtige Zeilen senden.** Verwerfen Sie Pod-Logzeilen unterhalb eines Schweregrads, bevor sie den Cluster verlassen:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Akzeptiert `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` und `FATAL`: `WARN` behält Warnungen, Fehler und fatale Zeilen. Der Schweregrad wird aus der Logzeile selbst gelesen (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes-Ereignisse werden dadurch nie verworfen.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Pod-Logs abschalten.** Metriken sind nicht betroffen: Der Knoten-Collector läuft für kubelet- und cAdvisor-Metriken weiter und liest nur keine Pod-Logs mehr:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Ändern, wie Logs gelesen werden.** Das Preset wählt dies für Sie; ein ausdrückliches `logs.mode` hat immer Vorrang:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: liest `/var/log/pods` auf jedem Knoten über hostPath (geringster Aufwand; benötigt hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: Ein Deployment verfolgt Pod-Logs über die Kubernetes-API (funktioniert in jedem Cluster).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: keine Pod-Logs.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Damit wird der API-Server gelesen, dort, wo er innerhalb des Clusters antwortet. etcd, der Scheduler und der Controller-Manager antworten auf den Control-Plane-Knoten, die der Pod des Agenten nicht erraten kann; er liest sie daher, sobald Sie die Adresse jedes Knotens angeben:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **Der Scheduler und der Controller-Manager** liefern HTTPS und akzeptieren das Token des Agenten, aber kubeadm bindet sie an `127.0.0.1`: Geben Sie ihnen eine `--bind-address`, die der Pod des Agenten erreichen kann.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** liefert seine Metriken per einfachem HTTP auf kubeadms `--listen-metrics-urls` (Port 2381, an `127.0.0.1` gebunden, bis Sie die Adresse des Knotens hinzufügen), wie oben. Oder fragen Sie seinen HTTPS-Client-Port 2379 mit dem Client-Zertifikat ab, das er verlangt: Legen Sie `ca.crt`, `tls.crt` und `tls.key` in ein Secret in `oneuptime-agent` und nennen Sie es in `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Nur für selbst verwaltete Cluster: Verwaltete Dienste (EKS, GKE, AKS) stellen ihre Control-Plane-Metriken nicht bereit.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "Die Kostenüberwachung ist standardmäßig eingeschaltet: Der Agent bringt die Open-Source-Engine OpenCost mit (plus das kleine Prometheus, das sie braucht), bepreist Ihre Knoten und Volumes nach den öffentlichen Listenpreisen Ihres Cloud-Anbieters, ganz ohne Zugangsdaten, und sendet, was jeder Namespace und jeder Workload kostet. Die ersten Daten erscheinen nach der ersten vollen Stunde in der Übersicht des Clusters und auf seiner Seite „Kosten“.",
  "On an agent installed before it was on by default, upgrade it:":
    "Wurde Ihr Agent installiert, bevor sie standardmäßig eingeschaltet war, upgraden Sie ihn:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Ausschalten:** Fügen Sie demselben Upgrade `--set cost.enabled=false` hinzu.",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "Auf dieser Plattform ist die Kostenüberwachung standardmäßig aus: Die Plattform rechnet jeden Pod nach dem ab, was er anfordert, sodass die drei Kosten-Pods Ihre Rechnung erhöhen würden, und OpenCost bepreist Knoten statt Pods. So schalten Sie sie trotzdem ein:",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "Das allein ist eine vollständige Installation: Das Chart bringt die Open-Source-Engine OpenCost mit (plus das kleine Prometheus, das sie braucht) und bepreist Ihre Knoten und Volumes nach den öffentlichen Listenpreisen Ihres Cloud-Anbieters, ganz ohne Zugangsdaten. Es fügt drei kleine Pods hinzu; die ersten Daten erscheinen nach der ersten vollen Stunde.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **Läuft bereits Kubecost oder OpenCost?** Der Agent findet es und liest es anstelle der mitgelieferten Engine, und die Übersicht des Clusters zeigt das an: Fügen Sie `--set cost.engine.url=auto` hinzu, damit keine zweite mitgeliefert wird.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **On-Premises oder Bare Metal?** Legen Sie mit `--set cost.opencost.customPricing.enabled=true` eine Preisliste fest (USD pro Ressourcenstunde, siehe `values.yaml` des Charts).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Vollständige Anleitung: [Kubernetes-Kostenbeobachtung](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "Der Agent führt [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) auf jedem Knoten aus. Sie erfasst HTTP/HTTPS-, gRPC- und SQL/Redis-Verkehr von Go-, .NET-, Java-, Node.js-, Python-, Ruby- und Rust-Diensten, ohne SDK und ohne Sidecar, und liefert Traces, Anfrage-Metriken (RED) und Daten für den Service-Graphen über den Collector.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Anforderungen:** Linux-Kernel **5.8+** mit BTF (Standard bei Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). Die eBPF-Pods laufen **privilegiert**, was sie zum Laden von eBPF-Programmen brauchen.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Schalten Sie sie ab**, wenn Ihre Knoten einen älteren Kernel haben, wenn privilegierte Pods nicht erlaubt sind oder wenn Ihre Dienste bereits Traces mit OpenTelemetry-SDKs senden und Sie keine Duplikate möchten:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Signale auswählen.** Jede Familie wird mit `--set ebpf.features.<name>=false` (oder `=true`) geschaltet:",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Standard | Was es hinzufügt |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | an | HTTP/gRPC-Anfragerate, Fehler und Latenz pro Dienst |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | an | Anzahl und Dauer der Span-Aufrufe (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | an | Kanten von Aufrufer → Aufgerufenem; speist die Service-Map |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | an | Pod-zu-Pod-Zähler für TCP/UDP-Flows |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | aus | Netzwerkmetriken zwischen Zonen (verdoppelt ihre Kardinalität) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | an | TCP-RTT sowie Zähler für fehlgeschlagene Verbindungen und Neuübertragungen pro Knoten |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**Dienstübergreifende Trace-Propagation** (eine Anfrage, die von Pod A → Pod B geht, zu einem einzigen Trace verbinden, auch auf einem anderen Knoten) ist **standardmäßig an**. Sie funktioniert, indem sie bereits laufenden Verkehr umschreibt (Klartext-HTTP-Anfragen im Kernel erweitert und an TLS und rohes TCP eine TCP-Option anhängt), und ein Fehler in dieser Byte-Buchhaltung bringt den Datenstrom aus dem Takt: Das gemeldete Symptom sind Übertragungen über einen L7-Proxy wie nginx, die hängen, sobald eine Antwort ~64KB überschreitet. Wenn Sie das sehen oder ein Service-Mesh Pods ausfallen lässt, schalten Sie sie mit `--set ebpf.contextPropagation=false` ab; ein OpenTelemetry-SDK propagiert `traceparent` im Userspace ohne all das.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Jedes `oneuptime.labels.<key>=<value>` wird zum Label `<key>:<value>` auf dem Cluster und auf den Diensten und Hosts, die er meldet. Labels werden ohne Berücksichtigung der Groß-/Kleinschreibung abgeglichen, daher wird ein bestehendes Label `Production` wiederverwendet; in der OneUptime-Oberfläche hinzugefügte Labels entfernt der Agent nie.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Upgraden** Sie auf das neueste Chart. `--reset-then-reuse-values` (Helm 3.14+) behält die Werte, die Sie gesetzt haben (Preset, Clustername, Filter), und übernimmt alles andere aus dem neuen Chart; fügen Sie neue `--set`-Flags obendrauf hinzu:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Mit Helm 3.13 und älter upgraden Sie stattdessen mit den Werten, die Sie gesetzt haben:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "Verwenden Sie nicht `--reuse-values`: Es behält auch die Standardwerte des Charts, von dem Sie upgraden, sodass die Standardwerte eines neueren Charts (darunter sein eBPF-Image) nie greifen.",
  "**Uninstall** the agent and its namespace:":
    "**Deinstallieren** Sie den Agenten und seinen Namespace:",
  "| Category | Data |": "| Kategorie | Daten |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Knotenmetriken** | CPU-, Speicher-, Dateisystem- und Netzwerknutzung |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod- und Container-Metriken** | CPU, Speicher, Netzwerk-I/O und Neustarts |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Cluster-Metriken** | Knotenzustände, zuweisbare Ressourcen, Anzahl der Pods und Workloads |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes-Ereignisse** | Warnungen, Fehler und Scheduling-Ereignisse |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Pod-Logs** | stdout/stderr jedes Containers, von jedem Knoten gelesen |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Anwendungs-Traces** *(eBPF)* | HTTP-, gRPC- und SQL/Redis-Spans von jedem Pod, ohne SDK oder Codeänderungen |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Anfrage-Metriken und Service-Graph** *(eBPF)* | Anfragerate, Fehler und Latenz pro Dienst sowie Kanten von Aufrufer → Aufgerufenem für die Service-Map |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Netzwerk-Flows** *(eBPF)* | Pod-zu-Pod-Zähler für TCP/UDP-Bytes und -Pakete |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **Workload-Kosten** *(optional, `cost.enabled=true`)* | Ausgaben pro Namespace, Workload und Pod, mit ungenutzter Kapazität und Effizienz |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Workload-Kosten** *(standardmäßig an)* | Ausgaben pro Namespace, Workload und Pod, mit ungenutzter Kapazität und Effizienz, auch als Metriken für Warnungen |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Ihr Cluster blockiert `hostPath`-Volumes oder privilegierte Pods. Das ist bei **GKE Autopilot** und **EKS Fargate** normal: Wählen Sie diese Plattform oben in dieser Anleitung und folgen Sie ihren Schritten. Auf **OpenShift** gelingt die Installation dagegen, aber die Knoten-Pods des Agenten starten nie: Wählen Sie **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "Entfernen Sie in jedem anderen Cluster mit einer restriktiven Pod-Security-Richtlinie das fehlgeschlagene Release:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Führen Sie dann den Installationsbefehl erneut aus, ergänzt um `--set preset=gke-autopilot`. Dieses Preset liest Pod-Logs über die Kubernetes-API statt über hostPath, wendet einen gehärteten Sicherheitskontext an und lässt die privilegierten eBPF- und Profiling-Pods weg.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Prüfen Sie, ob die Pods des Agenten laufen: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Prüfen Sie die Logs des Collectors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Prüfen Sie, ob die OneUptime-URL und der Ingestion-Schlüssel im Installationsbefehl stimmen.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Stellen Sie sicher, dass der Cluster Ihre OneUptime-Instanz über das Netzwerk erreicht.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Prüfen Sie den Pod des KI-Agenten: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Prüfen Sie seine Logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Kein Pod? Upgraden Sie das Chart (siehe **Agent aktualisieren oder deinstallieren** unter Erweitert) und fügen Sie `--set aiAgent.enabled=true` hinzu.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Prüfen Sie, ob der Clustername passt: Diese Anleitung installiert **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Prüfen Sie die RBAC-Berechtigungen des Agenten: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Suchen Sie in den Logs des Collectors nach Exportfehlern: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kernel zu alt oder kein BTF.** eBPF braucht Linux 5.8+ mit BTF; prüfen Sie es mit `uname -r` auf einem Knoten. Wenn Sie nicht upgraden können, schalten Sie eBPF mit `--set ebpf.enabled=false` ab.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Privilegierte Pods blockiert.** Manche abgeriegelten Cluster lehnen sie ab. Schalten Sie eBPF ab.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` auf dem Host nicht verfügbar.** Schalten Sie nur die Familie der TCP-Statistiken ab: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Prüfen Sie, ob die eBPF-Pods gesund sind: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Schalten Sie die Debug-Ausgabe von OBI ein, um zu bestätigen, dass sie Verkehr sieht: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, und lesen Sie dann `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Wenn Spans dort erscheinen, aber nicht in OneUptime, prüfen Sie die Logs des Collectors auf Exportfehler: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "Damit wird der Agent für **`k8s-1`** installiert: Lassen Sie `clusterName` genau so, wie es ist, sonst werden die Daten als neuer Cluster registriert.",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "Die AWS CLI (`aws`), angemeldet beim Konto des Clusters",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "Die Google Cloud CLI (`gcloud`) mit der Komponente `gke-gcloud-auth-plugin`",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "Die Azure CLI (`az`), angemeldet beim Abonnement des Clusters",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 oder neuer und die OpenShift CLI (`oc`), mit cluster-admin-Rechten angemeldet: Die Installation legt Security Context Constraints an",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "Die Webkonsole liefert den genauen Befehl samt Token: **Copy login command** unter Ihrem Benutzernamen. Melden Sie sich als Cluster-Admin an: Die Installation legt Security Context Constraints an.",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift` legt zwei Security Context Constraints (SCCs) an, eine für den Knoten-Collector und eine für die eBPF-Pods, jede nur von ihrem eigenen Service-Account verwendet. Jeder andere Pod läuft unter OpenShifts Standard `restricted-v2`, mit der Benutzer-ID, die OpenShift zuweist.",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Den Collector und den Kubernetes-KI-Agenten, dazu je einen `-logs`- und einen `-ebpf`-Pod auf jedem Knoten. Die `-logs`- und `-ebpf`-Pods laufen unter den SCCs, die das Chart für sie angelegt hat: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` listet beide auf. Sobald sie `Running` sind, erscheint der Cluster automatisch im Bereich **Kubernetes**, meist innerhalb von ein, zwei Minuten.",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "OpenShift lässt einen Pod nur unter einer Security Context Constraint (SCC) zu, die sein Service-Account verwenden darf, und das Release wird in jedem Fall installiert, sodass ein abgewiesener Pod einfach nie erscheint. Suchen Sie nach der Ablehnung:",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`:** Das Release wurde ohne das openshift-Preset installiert, daher hat das Chart keine SCCs angelegt. `helm get values kubernetes-agent --namespace oneuptime-agent` zeigt die Werte, die es erhalten hat. Fügen Sie das Preset hinzu:",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **Die SCCs fehlen:** Prüfen Sie mit `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Sie anzulegen erfordert cluster-admin-Rechte, daher scheitert eine Installation durch jemand anderen, sobald sie dort ankommt.",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`:** Die Pod-Security-Stufe des Namespace ist strenger, als die eBPF-Pods, die privilegiert laufen, es brauchen. Versehen Sie ihn mit dem Label `pod-security.kubernetes.io/enforce=privileged` oder schalten Sie eBPF mit `--set ebpf.enabled=false` ab.",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **Ihr Cluster-Admin legt keine SCCs an:** Verwenden Sie das Preset `openshift-restricted`. Das Chart legt dann keine SCC an, und jeder Pod läuft unter `restricted-v2`; Pod-Logs kommen daher über die Kubernetes-API, und es gibt keine Host-Metriken, eBPF-Traces oder Profile:",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot` sammelt Pod-Logs über die Kubernetes-API, statt sie von jedem Knoten zu lesen, und lässt eBPF-Tracing und Profiling weg, die privilegierte Pods brauchen, die GKE Autopilot nicht erlaubt.",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Den Collector, den Kubernetes-KI-Agenten und den Pod-Log-Leser, dazu einen Knoten-Collector pro Knoten für kubelet-Metriken. Sobald sie `Running` sind, erscheint der Cluster automatisch im Bereich **Kubernetes**, meist innerhalb von ein, zwei Minuten.",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "In anderen Clustern führt der Agent [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) auf jedem Knoten aus, um HTTP-, gRPC- und SQL-Traces ohne Codeänderungen zu erfassen. Das Laden von eBPF-Programmen erfordert privilegierte Pods, die diese Plattform nicht erlaubt; das Preset der Plattform lässt es daher weg, und mit ihm das kontinuierliche Profiling.",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "Um hier Traces zu erhalten, instrumentieren Sie Ihre Dienste mit einem [OpenTelemetry-SDK](/docs/telemetry/open-telemetry) und senden Sie sie direkt an OneUptime.",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **Pod-Logs** | stdout/stderr jedes Containers, über die Kubernetes-API gelesen |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "Autopilot blockiert hostPath, daher werden Knotenmetriken, die `/proc` und `/sys` des Hosts lesen (Festplatten-I/O, Inodes, NIC-Fehler), nicht gesammelt; kubelet- und cAdvisor-Metriken schon.",
  "Pod logs are read through the Kubernetes API on this platform.":
    "Pod-Logs werden auf dieser Plattform über die Kubernetes-API gelesen.",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. Prüfen Sie, ob der Log-Leser bereit ist: `kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. Sein Endpunkt `/healthz` meldet die Anzahl aktiver Log-Streams und den letzten Exportfehler.",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. In sehr großen Clustern kann ein Leser zurückfallen: Verteilen Sie die Namespaces mit `namespaceFilters` auf getrennte Releases.",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "Die AWS CLI (`aws`) und `eksctl`, angemeldet beim Konto des Clusters",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "Pods laufen auf Fargate nur in Namespaces, die ein Fargate-Profil auswählt. Legen Sie eines für `oneuptime-agent` an; ohne es bleiben die Pods des Agenten `Pending`:",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate` sammelt Pod-Logs über die Kubernetes-API, statt sie von jedem Knoten zu lesen, und lässt eBPF-Tracing und Profiling weg, die privilegierte Pods brauchen, die EKS Fargate nicht erlaubt.",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Drei Deployments: der Collector, der Kubernetes-KI-Agent und der Pod-Log-Leser. Fargate plant nie DaemonSets ein, daher gibt es keine Pods pro Knoten. Sobald sie `Running` sind, erscheint der Cluster automatisch im Bereich **Kubernetes**, meist innerhalb von ein, zwei Minuten.",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "Entfernen Sie dann das Fargate-Profil: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "Fargate plant nie DaemonSets ein, daher sind dort keine Knoten-, Pod- und Container-Metriken verfügbar.",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "Fargate plant Pods nur in Namespaces ein, die ein Fargate-Profil auswählt. Prüfen Sie, ob eines für `oneuptime-agent` existiert:",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "Wenn keines existiert, legen Sie es an. Fargate wird beim Anlegen eines Pods gewählt, daher bleiben bereits wartende Pods im Wartezustand: Starten Sie die Deployments des Agenten neu, sobald das Profil aktiv ist:",
};

export default TRANSLATION;
