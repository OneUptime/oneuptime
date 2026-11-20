import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in Spanish (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * Spanish. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Spanish words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "Un clúster de Kubernetes con v1.23 o posterior",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` y `helm` (v3) instalados en tu equipo",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "¿Clúster equivocado? Cambia con `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "Sustituye `my-cluster` por un nombre para este clúster, como `prod-us-east-1`. Es como aparece el clúster en OneUptime, así que mantenlo estable: un nombre nuevo registra un clúster nuevo.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` activa las **investigaciones de IA**, como hace el chart por defecto: OneUptime AI investiga incidentes y alertas de este clúster con kubectl de solo lectura, a través del agente de IA de Kubernetes.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "Elige una clave de ingesta en el paso 1 para rellenar `<YOUR_API_KEY>`.",
  "You should see:": "Deberías ver:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "El recopilador y el agente de IA de Kubernetes, más un pod `-logs` y un pod `-ebpf` en cada nodo. Cuando estén en `Running`, el clúster aparece automáticamente en la sección **Kubernetes**, normalmente en uno o dos minutos.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Agente de IA de Kubernetes (activado por defecto, solo lectura).** El pod `kubernetes-agent-ai-agent` permite a OneUptime AI investigar incidentes y alertas de este clúster con kubectl de solo lectura (`get`, `describe`, `logs`, `events`, `top`), con la misma clave de API, y no puede cambiar nada a menos que más adelante le des acceso de escritura. Abre el clúster y ve a **IA → Agente** para verlo. ¿No lo quieres? Instala con `--set aiAgent.enabled=false` en lugar de `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "Las reglas de espacios de nombres deciden qué recoge el agente de cada espacio de nombres. Para recoger registros de pods y datos de eBPF solo de `default`, `production` y `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "Para conservarlo todo pero detener los registros de los espacios de nombres ruidosos, exclúyelos solo de `podLogs`:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **Alcances:** `podLogs` (stdout/stderr de los contenedores), `ebpfDiscovery` (trazas y métricas de eBPF), `metrics` (métricas con espacio de nombres) y `traces` (todos los spans).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- Los **patrones** coinciden con el nombre completo del espacio de nombres y aceptan `*`, como en `team-*`. Una regla `exclude` siempre gana a una regla `include`.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **Definir las reglas sustituye la regla predeterminada**, que excluye `kube-system` de `podLogs` y `ebpfDiscovery`. Mantenla en tu lista, como en el segundo ejemplo, si todavía la quieres.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- Las métricas de nodo y de clúster no tienen espacio de nombres, así que siempre se conservan.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` requiere Helm 3.10 o posterior.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**Envía solo las líneas importantes.** Descarta las líneas de registro de pods por debajo de una gravedad antes de que salgan del clúster:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'Acepta `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` y `FATAL`: `WARN` conserva advertencias, errores y líneas fatales. La gravedad se lee de la propia línea de registro (`[ERROR]`, `level=warn`, `"level":"info"`). Esto nunca descarta los eventos de Kubernetes.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Desactiva los registros de pods.** Las métricas no se ven afectadas: el recopilador de nodos sigue funcionando para las métricas de kubelet y cAdvisor; solo deja de leer los registros de pods:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**Cambia cómo se leen los registros.** El preset lo elige por ti; un `logs.mode` explícito siempre tiene prioridad:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: lee `/var/log/pods` en cada nodo mediante hostPath (la menor sobrecarga; requiere hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: un Deployment sigue los registros de pods a través de la API de Kubernetes (funciona en cualquier clúster).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: sin registros de pods.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "Eso lee el servidor de API, donde responde dentro del clúster. etcd, el planificador y el administrador de controladores responden en los nodos del plano de control, que el pod del agente no puede adivinar, así que los lee en cuanto indicas la dirección de cada nodo:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **El planificador y el administrador de controladores** sirven HTTPS y aceptan el token del agente, pero kubeadm los vincula a `127.0.0.1`: dales una `--bind-address` que el pod del agente pueda alcanzar.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** sirve sus métricas en HTTP simple en las `--listen-metrics-urls` de kubeadm (puerto 2381, vinculado a `127.0.0.1` hasta que añadas la dirección del nodo), como arriba. O consulta su puerto de cliente HTTPS, 2379, con el certificado de cliente que pide: pon `ca.crt`, `tls.crt` y `tls.key` en un Secret en `oneuptime-agent` e indícalo en `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "Solo para clústeres autogestionados: los servicios gestionados (EKS, GKE, AKS) no exponen las métricas de su plano de control.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "El monitoreo de costos está activado por defecto: el agente incluye el motor de código abierto OpenCost (más el pequeño Prometheus que necesita), pone precio a tus nodos y volúmenes según los precios públicos de lista de tu proveedor de nube, sin credenciales, y envía cuánto cuesta cada espacio de nombres y cada carga de trabajo. Los primeros datos aparecen en la vista general del clúster y en su página Costos después de la primera hora completa.",
  "On an agent installed before it was on by default, upgrade it:":
    "Si tu agente se instaló antes de que estuviera activado por defecto, actualízalo:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **Para desactivarlo:** añade `--set cost.enabled=false` a la misma actualización.",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "El monitoreo de costos está desactivado por defecto en esta plataforma: cobra cada pod según lo que solicita, así que los tres pods de costos aumentarían tu factura, y OpenCost pone precio a los nodos, no a los pods. Para activarlo de todos modos:",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "Eso solo ya es una instalación completa: el chart incluye el motor de código abierto OpenCost (más el pequeño Prometheus que necesita) y pone precio a tus nodos y volúmenes según los precios públicos de lista de tu proveedor de nube, sin credenciales. Añade tres pods pequeños; los primeros datos aparecen después de la primera hora completa.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **¿Ya usas Kubecost u OpenCost?** El agente lo detecta y lo lee en lugar del motor incluido, y la vista general del clúster lo indica: añade `--set cost.engine.url=auto` para dejar de incluir un segundo motor.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **¿Local o bare metal?** Define una tarifa con `--set cost.opencost.customPricing.enabled=true` (USD por hora de recurso; consulta el `values.yaml` del chart).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "Guía completa: [Observabilidad de costes de Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "El agente ejecuta [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) en cada nodo. Captura el tráfico HTTP/HTTPS, gRPC y SQL/Redis de servicios en Go, .NET, Java, Node.js, Python, Ruby y Rust, sin SDK ni sidecar, y envía trazas, métricas de peticiones (RED) y datos del grafo de servicios a través del recopilador.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**Requisitos:** kernel de Linux **5.8+** con BTF (el predeterminado en Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). Los pods de eBPF se ejecutan **con privilegios**, que necesitan para cargar programas eBPF.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**Desactívalo** si tus nodos usan un kernel más antiguo, si no se permiten pods con privilegios o si tus servicios ya envían trazas con SDK de OpenTelemetry y no quieres duplicados:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**Elige las señales.** Cada familia se activa o desactiva con `--set ebpf.features.<name>=false` (o `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | Predeterminado | Qué añade |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | activado | Tasa de peticiones HTTP/gRPC, errores y latencia por servicio |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | activado | Número de llamadas y duración de los spans (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | activado | Aristas de llamador → llamado; alimenta el mapa de servicios |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | activado | Contadores de flujos TCP/UDP de pod a pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | desactivado | Métricas de red entre zonas (duplica su cardinalidad) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | activado | RTT de TCP y contadores de conexiones fallidas y retransmisiones por nodo |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "La **propagación de trazas entre servicios** (enlazar en una sola traza una petición que cruza del pod A → pod B, también en otro nodo) está **activada por defecto**. Funciona reescribiendo tráfico que ya está en curso (ampliando las peticiones HTTP en texto plano en el kernel y añadiendo una opción TCP a TLS y a TCP sin procesar), y un error en esa contabilidad de bytes desincroniza el flujo: el síntoma notificado son transferencias a través de un proxy L7 como nginx que se cuelgan cuando una respuesta supera ~64KB. Si lo ves, o si una malla de servicios empieza a hacer fallar pods, desactívala con `--set ebpf.contextPropagation=false`; un SDK de OpenTelemetry propaga `traceparent` en el espacio de usuario sin nada de eso.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "Cada `oneuptime.labels.<key>=<value>` se convierte en la etiqueta `<key>:<value>` del clúster y de los servicios y hosts que informa. Las etiquetas se comparan sin distinguir mayúsculas y minúsculas, así que se reutiliza una etiqueta `Production` existente; el agente nunca elimina las etiquetas añadidas en la interfaz de OneUptime.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "**Actualiza** al chart más reciente. `--reset-then-reuse-values` (Helm 3.14+) conserva los valores que definiste (preset, nombre del clúster, filtros) y toma todo lo demás del chart nuevo; añade encima los nuevos indicadores `--set`:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "En Helm 3.13 y anteriores, actualiza en su lugar con los valores que definiste:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "No uses `--reuse-values`: también conserva los valores predeterminados del chart desde el que actualizas, así que los valores predeterminados de un chart más nuevo (entre ellos su imagen de eBPF) nunca se aplican.",
  "**Uninstall** the agent and its namespace:":
    "**Desinstala** el agente y su espacio de nombres:",
  "| Category | Data |": "| Categoría | Datos |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **Métricas de nodos** | Uso de CPU, memoria, sistema de archivos y red |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Métricas de pods y contenedores** | CPU, memoria, E/S de red y reinicios |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **Métricas del clúster** | Condiciones de los nodos, recursos asignables, recuento de pods y cargas de trabajo |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Eventos de Kubernetes** | Advertencias, errores y eventos de planificación |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Registros de pods** | stdout/stderr de cada contenedor, leídos en cada nodo |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **Trazas de aplicaciones** *(eBPF)* | Spans HTTP, gRPC y SQL/Redis de cada pod, sin SDK ni cambios de código |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **Métricas de peticiones y grafo de servicios** *(eBPF)* | Tasa de peticiones, errores y latencia por servicio, y aristas de llamador → llamado para el mapa de servicios |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **Flujos de red** *(eBPF)* | Contadores de bytes y paquetes TCP/UDP de pod a pod |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **Costes de las cargas de trabajo** *(opcional, `cost.enabled=true`)* | Gasto por espacio de nombres, carga de trabajo y pod, con capacidad ociosa y eficiencia |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **Costos de las cargas de trabajo** *(activados por defecto)* | Gasto por espacio de nombres, carga de trabajo y pod, con capacidad ociosa y eficiencia, también como métricas sobre las que alertar |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "Tu clúster bloquea los volúmenes `hostPath` o los pods con privilegios. Es normal en **GKE Autopilot** y **EKS Fargate**: elige esa plataforma al principio de esta guía y sigue sus pasos. En **OpenShift**, en cambio, la instalación funciona, pero los pods de nodo del agente nunca arrancan: elige **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "En cualquier otro clúster con una política restrictiva de Pod Security, elimina la release fallida:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "Luego vuelve a ejecutar el comando de instalación añadiendo `--set preset=gke-autopilot`. Ese preset lee los registros de pods a través de la API de Kubernetes en lugar de hostPath, aplica un contexto de seguridad reforzado y deja fuera los pods con privilegios de eBPF y de profiling.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. Comprueba que los pods del agente se están ejecutando: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. Revisa los registros del recopilador: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. Verifica que la URL de OneUptime y la clave de ingesta del comando de instalación son correctas.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. Asegúrate de que el clúster puede llegar a tu instancia de OneUptime por la red.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. Comprueba el pod del agente de IA: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. Revisa sus registros: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. ¿No hay pod? Actualiza el chart (consulta **Actualizar o desinstalar el agente** en Avanzado) y añade `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. Comprueba que el nombre del clúster coincide: esta guía instala **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. Verifica los permisos RBAC del agente: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Busca errores de exportación en los registros del recopilador: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **Kernel demasiado antiguo o sin BTF.** eBPF necesita Linux 5.8+ con BTF; compruébalo con `uname -r` en un nodo. Si no puedes actualizar, desactiva eBPF con `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **Pods con privilegios bloqueados.** Algunos clústeres restringidos los rechazan. Desactiva eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` no disponibles en el host.** Desactiva solo la familia de estadísticas TCP: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. Comprueba que los pods de eBPF están sanos: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. Activa la salida de depuración de OBI para confirmar que ve tráfico: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, y luego lee `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. Si los spans aparecen ahí pero no en OneUptime, busca errores de exportación en los registros del recopilador: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "Esto instala el agente para **`k8s-1`**: deja `clusterName` exactamente como está, o los datos se registrarán como un clúster nuevo.",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "La CLI de AWS (`aws`), con la sesión iniciada en la cuenta del clúster",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "La CLI de Google Cloud (`gcloud`) con el componente `gke-gcloud-auth-plugin`",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "La CLI de Azure (`az`), con la sesión iniciada en la suscripción del clúster",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 o posterior, y la CLI de OpenShift (`oc`) con la sesión iniciada y derechos de cluster-admin: la instalación crea restricciones de contexto de seguridad",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "La consola web da el comando exacto, con el token incluido: **Copy login command**, bajo tu nombre de usuario. Inicia sesión como administrador del clúster: la instalación crea restricciones de contexto de seguridad.",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift` crea dos restricciones de contexto de seguridad (SCC), una para el recopilador de nodos y otra para los pods de eBPF, cada una usada solo por su propia cuenta de servicio. Todos los demás pods se ejecutan bajo el `restricted-v2` predeterminado de OpenShift, con el ID de usuario que asigna OpenShift.",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "El recopilador y el agente de IA de Kubernetes, más un pod `-logs` y un pod `-ebpf` en cada nodo. Los pods `-logs` y `-ebpf` se ejecutan bajo las SCC que el chart creó para ellos: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` muestra ambas. Cuando estén en `Running`, el clúster aparece automáticamente en la sección **Kubernetes**, normalmente en uno o dos minutos.",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "OpenShift solo admite un pod bajo una restricción de contexto de seguridad (SCC) que pueda usar su cuenta de servicio, y la release se instala de todos modos, así que un pod rechazado simplemente nunca aparece. Busca el rechazo:",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`:** la release se instaló sin el preset de openshift, así que el chart no creó ninguna SCC. `helm get values kubernetes-agent --namespace oneuptime-agent` muestra los valores que recibió. Añade el preset:",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **Faltan las SCC:** compruébalo con `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Crearlas requiere derechos de cluster-admin, así que una instalación hecha por cualquier otra persona falla al llegar a ellas.",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`:** el nivel de Pod Security del espacio de nombres es más estricto de lo que necesitan los pods de eBPF, que se ejecutan con privilegios. Ponle la etiqueta `pod-security.kubernetes.io/enforce=privileged` o desactiva eBPF con `--set ebpf.enabled=false`.",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **Tu administrador del clúster no añadirá SCC:** usa el preset `openshift-restricted`. El chart entonces no crea ninguna SCC y todos los pods se ejecutan bajo `restricted-v2`, así que los registros de pods llegan a través de la API de Kubernetes y no hay métricas del host, trazas de eBPF ni perfiles:",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot` recoge los registros de pods a través de la API de Kubernetes en lugar de leerlos en cada nodo, y deja fuera el tracing y el profiling de eBPF, que necesitan pods con privilegios que GKE Autopilot no permite.",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "El recopilador, el agente de IA de Kubernetes y el lector de registros de pods, más un recopilador de nodo por nodo para las métricas de kubelet. Cuando estén en `Running`, el clúster aparece automáticamente en la sección **Kubernetes**, normalmente en uno o dos minutos.",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "En otros clústeres, el agente ejecuta [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) en cada nodo para capturar trazas HTTP, gRPC y SQL sin cambios de código. Cargar programas eBPF requiere pods con privilegios, que esta plataforma no permite, así que el preset de la plataforma lo deja fuera, y con él el profiler continuo.",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "Para obtener trazas aquí, instrumenta tus servicios con un [SDK de OpenTelemetry](/docs/telemetry/open-telemetry) y envíalas directamente a OneUptime.",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **Registros de pods** | stdout/stderr de cada contenedor, leídos a través de la API de Kubernetes |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "Autopilot bloquea hostPath, así que no se recogen las métricas de nodo que leen `/proc` y `/sys` del host (E/S de disco, inodos, errores de NIC); las métricas de kubelet y cAdvisor sí.",
  "Pod logs are read through the Kubernetes API on this platform.":
    "En esta plataforma, los registros de pods se leen a través de la API de Kubernetes.",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. Comprueba que el lector de registros está listo: `kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. Su endpoint `/healthz` informa del número de flujos de registros activos y del último error de exportación.",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. En clústeres muy grandes, un lector puede quedarse atrás: reparte los espacios de nombres entre releases separadas con `namespaceFilters`.",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "La CLI de AWS (`aws`) y `eksctl`, con la sesión iniciada en la cuenta del clúster",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "En Fargate, los pods solo se ejecutan en los espacios de nombres que selecciona un perfil de Fargate. Crea uno para `oneuptime-agent`; sin él, los pods del agente se quedan en `Pending`:",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate` recoge los registros de pods a través de la API de Kubernetes en lugar de leerlos en cada nodo, y deja fuera el tracing y el profiling de eBPF, que necesitan pods con privilegios que EKS Fargate no permite.",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Tres Deployments: el recopilador, el agente de IA de Kubernetes y el lector de registros de pods. Fargate nunca programa DaemonSets, así que no hay pods por nodo. Cuando estén en `Running`, el clúster aparece automáticamente en la sección **Kubernetes**, normalmente en uno o dos minutos.",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "Luego elimina el perfil de Fargate: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "Fargate nunca programa DaemonSets, así que ahí no hay métricas de nodos, pods ni contenedores.",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "Fargate solo programa pods en los espacios de nombres que selecciona un perfil de Fargate. Comprueba que existe uno para `oneuptime-agent`:",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "Si no hay ninguno, créalo. Fargate se elige cuando se crea un pod, así que los pods que ya estaban pendientes siguen pendientes: reinicia los Deployments del agente cuando el perfil esté activo:",
};

export default TRANSLATION;
