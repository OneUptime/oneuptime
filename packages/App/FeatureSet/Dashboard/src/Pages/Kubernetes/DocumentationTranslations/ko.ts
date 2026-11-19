import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in Korean (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * Korean. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Korean words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "v1.23 이상에서 실행되는 Kubernetes 클러스터",
  "`kubectl` and `helm` (v3) installed on your machine":
    "컴퓨터에 설치된 `kubectl`과 `helm`(v3)",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "클러스터가 다른가요? `kubectl config use-context <context-name>`으로 전환하세요.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "`my-cluster`를 이 클러스터의 이름(예: `prod-us-east-1`)으로 바꾸세요. OneUptime에서 클러스터가 이 이름으로 표시되므로 바꾸지 마세요. 새 이름은 새 클러스터로 등록됩니다.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true`는 chart의 기본값대로 **AI 조사**를 켭니다. OneUptime AI는 Kubernetes AI 에이전트를 통해 읽기 전용 kubectl로 이 클러스터의 인시던트와 경고를 조사합니다.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "1단계에서 수집 키를 선택하면 `<YOUR_API_KEY>`가 채워집니다.",
  "You should see:": "다음과 같이 보여야 합니다:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "컬렉터와 Kubernetes AI 에이전트, 그리고 노드마다 `-logs` Pod와 `-ebpf` Pod가 하나씩 있습니다. 모두 `Running` 상태가 되면 클러스터가 **Kubernetes** 섹션에 자동으로 나타나며, 보통 1~2분 걸립니다.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes AI 에이전트(기본적으로 켜짐, 읽기 전용).** `kubernetes-agent-ai-agent` Pod는 같은 API 키를 사용해 읽기 전용 kubectl(`get`, `describe`, `logs`, `events`, `top`)로 OneUptime AI가 이 클러스터의 인시던트와 경고를 조사할 수 있게 하며, 나중에 쓰기 권한을 주지 않는 한 아무것도 바꿀 수 없습니다. 클러스터를 열고 **AI → 에이전트** 로 이동하면 볼 수 있습니다. 필요 없나요? `--set aiAgent.enabled=true` 대신 `--set aiAgent.enabled=false`로 설치하세요.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "네임스페이스 규칙은 에이전트가 각 네임스페이스에서 무엇을 수집할지 정합니다. `default`, `production`, `staging`에서만 Pod 로그와 eBPF 데이터를 수집하려면:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "모두 유지하되 시끄러운 네임스페이스의 로그만 멈추려면, 해당 네임스페이스를 `podLogs`에서만 제외하세요:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **범위:** `podLogs`(컨테이너 stdout/stderr), `ebpfDiscovery`(eBPF 트레이스와 메트릭), `metrics`(네임스페이스가 있는 메트릭), `traces`(모든 스팬).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **패턴** 은 네임스페이스 이름 전체와 일치하며, `team-*`처럼 `*`를 쓸 수 있습니다. `exclude` 규칙은 항상 `include` 규칙보다 우선합니다.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **규칙을 설정하면 기본 규칙이 대체됩니다**. 기본 규칙은 `kube-system`을 `podLogs`와 `ebpfDiscovery`에서 제외합니다. 여전히 필요하다면 두 번째 예처럼 목록에 남겨 두세요.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- 노드와 클러스터 메트릭에는 네임스페이스가 없으므로 항상 유지됩니다.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json`에는 Helm 3.10 이상이 필요합니다.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**중요한 줄만 보내기.** 클러스터를 떠나기 전에 일정 심각도 미만의 Pod 로그 줄을 버립니다:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    '`TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`을 받습니다. `WARN`은 경고, 오류, 치명적인 줄을 남깁니다. 심각도는 로그 줄 자체(`[ERROR]`, `level=warn`, `"level":"info"`)에서 읽습니다. 이 설정으로 Kubernetes 이벤트가 버려지는 일은 없습니다.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**Pod 로그 끄기.** 메트릭은 영향을 받지 않습니다. 노드 컬렉터는 kubelet과 cAdvisor 메트릭을 위해 계속 실행되고, Pod 로그 읽기만 멈춥니다:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**로그를 읽는 방식 바꾸기.** 프리셋이 알아서 고르지만, 명시한 `logs.mode`가 항상 우선합니다:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: 각 노드의 `/var/log/pods`를 hostPath로 읽습니다(오버헤드가 가장 낮음, hostPath 필요).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: Deployment가 Kubernetes API를 통해 Pod 로그를 따라갑니다(어떤 클러스터에서도 동작).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: Pod 로그를 수집하지 않습니다.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "이렇게 하면 클러스터 안에서 응답하는 API 서버를 읽습니다. etcd, 스케줄러, 컨트롤러 관리자는 컨트롤 플레인 노드에서 응답하는데, 에이전트의 Pod가 이를 추측할 수 없으므로 각 노드의 주소를 지정하면 읽어 옵니다:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **스케줄러와 컨트롤러 관리자** 는 HTTPS를 제공하고 에이전트의 토큰을 받지만, kubeadm이 이들을 `127.0.0.1`에 바인딩합니다. 에이전트의 Pod가 도달할 수 있는 `--bind-address`를 지정하세요.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** 는 위와 같이 kubeadm의 `--listen-metrics-urls`(포트 2381, 노드의 주소를 추가하기 전까지 `127.0.0.1`에 바인딩)에서 일반 HTTP로 메트릭을 제공합니다. 또는 요구하는 클라이언트 인증서로 HTTPS 클라이언트 포트 2379를 수집하세요. `ca.crt`, `tls.crt`, `tls.key`를 `oneuptime-agent`의 Secret에 넣고 `controlPlane.etcd.clientCertSecret`에 그 이름을 지정합니다.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "자체 관리형 클러스터만 해당: 관리형 서비스(EKS, GKE, AKS)는 컨트롤 플레인 메트릭을 노출하지 않습니다.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "비용 모니터링은 기본적으로 켜져 있습니다. 에이전트에는 오픈 소스 OpenCost 엔진(과 그에 필요한 작은 Prometheus)이 포함되어 있으며, 클라우드 제공업체의 공개 정가로 노드와 볼륨의 가격을 매기고(자격 증명은 필요 없습니다) 각 네임스페이스와 워크로드의 비용을 보냅니다. 첫 한 시간이 지나면 클러스터의 개요와 비용 페이지에 첫 데이터가 나타납니다.",
  "On an agent installed before it was on by default, upgrade it:":
    "기본으로 켜지기 전에 설치한 에이전트라면 업그레이드하세요:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **끄기:** 같은 업그레이드에 `--set cost.enabled=false`를 추가하세요.",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "이 플랫폼에서는 비용 모니터링이 기본적으로 꺼져 있습니다. 이 플랫폼은 모든 Pod에 요청한 리소스만큼 요금을 매기므로 비용 Pod 세 개가 청구액을 늘리게 되고, OpenCost는 Pod가 아니라 노드의 가격을 매깁니다. 그래도 켜려면:",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "이것만으로 완전한 설치입니다. chart에는 오픈 소스 OpenCost 엔진(과 그에 필요한 작은 Prometheus)이 포함되어 있으며, 클라우드 제공업체의 공개 정가로 노드와 볼륨의 가격을 매깁니다. 자격 증명은 필요 없습니다. 작은 Pod 세 개가 추가되며, 첫 한 시간이 지나면 첫 데이터가 나타납니다.",
  "- **Already running Kubecost or OpenCost?** Point the agent at it instead, and nothing is bundled: add `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (or your Kubecost service).":
    "- **이미 Kubecost나 OpenCost를 쓰고 있나요?** 대신 에이전트가 그것을 가리키게 하면 아무것도 함께 설치되지 않습니다. `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003`(또는 사용 중인 Kubecost 서비스)을 추가하세요.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **온프레미스나 베어 메탈인가요?** `--set cost.opencost.customPricing.enabled=true`로 요금표를 설정하세요(리소스 시간당 USD, chart의 `values.yaml` 참조).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "전체 가이드: [Kubernetes 비용 관측성](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "에이전트는 모든 노드에서 [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/)을 실행합니다. Go, .NET, Java, Node.js, Python, Ruby, Rust 서비스의 HTTP/HTTPS, gRPC, SQL/Redis 트래픽을 SDK나 사이드카 없이 캡처하고, 트레이스, 요청(RED) 메트릭, 서비스 그래프 데이터를 컬렉터를 통해 보냅니다.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**요구 사항:** BTF가 있는 Linux 커널 **5.8+**(Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+에서 기본). eBPF Pod는 eBPF 프로그램을 로드하기 위해 **특권** 모드로 실행됩니다.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "노드의 커널이 오래되었거나, 특권 Pod가 허용되지 않거나, 서비스가 이미 OpenTelemetry SDK로 트레이스를 보내고 있어 중복을 원하지 않는다면 **끄세요**:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**신호 고르기.** 각 패밀리는 `--set ebpf.features.<name>=false`(또는 `=true`)로 켜고 끕니다:",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | 기본값 | 추가되는 것 |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | 켜짐 | 서비스별 HTTP/gRPC 요청률, 오류, 지연 시간 |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | 켜짐 | 스팬 호출 수와 소요 시간(`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | 켜짐 | 호출자 → 피호출자 간선. 서비스 맵을 만듭니다 |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | 켜짐 | Pod 간 TCP/UDP 플로우 카운터 |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | 꺼짐 | 영역 간 네트워크 메트릭(카디널리티가 두 배가 됨) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | 켜짐 | 노드 수준 TCP RTT, 연결 실패와 재전송 카운터 |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**서비스 간 트레이스 전파**(Pod A → Pod B로 넘어가는 요청을 다른 노드에서도 하나의 트레이스로 잇는 것)는 **기본적으로 켜져** 있습니다. 이미 오가는 트래픽을 다시 써서 동작하는데(커널에서 평문 HTTP 요청을 넓히고, TLS와 원시 TCP에 TCP 옵션을 덧붙임), 이 바이트 계산에 실수가 있으면 스트림이 어긋납니다. 보고된 증상은 nginx 같은 L7 프록시를 거치는 전송이 응답이 ~64KB를 넘는 순간 멈추는 것입니다. 이런 증상이 보이거나 서비스 메시에서 Pod가 실패하기 시작하면 `--set ebpf.contextPropagation=false`로 끄세요. OpenTelemetry SDK는 이런 일 없이 사용자 공간에서 `traceparent`를 전파합니다.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "각 `oneuptime.labels.<key>=<value>`는 클러스터와, 클러스터가 보고하는 서비스와 호스트의 레이블 `<key>:<value>`가 됩니다. 레이블은 대소문자를 구분하지 않고 비교하므로 기존 `Production` 레이블이 재사용되며, OneUptime 화면에서 추가한 레이블은 에이전트가 절대 제거하지 않습니다.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "최신 chart로 **업그레이드** 하세요. `--reset-then-reuse-values`(Helm 3.14+)는 설정한 값(프리셋, 클러스터 이름, 필터)을 유지하고 나머지는 모두 새 chart에서 가져옵니다. 새 `--set` 플래그는 그 위에 추가하세요:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Helm 3.13 이하에서는 대신 설정한 값으로 업그레이드하세요:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "`--reuse-values`는 쓰지 마세요. 업그레이드하기 전 chart의 기본값까지 유지하기 때문에 새 chart의 기본값(eBPF 이미지 포함)이 절대 적용되지 않습니다.",
  "**Uninstall** the agent and its namespace:":
    "에이전트와 그 네임스페이스를 **제거** 하세요:",
  "| Category | Data |": "| 범주 | 데이터 |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **노드 메트릭** | CPU, 메모리, 파일 시스템, 네트워크 사용량 |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **Pod와 컨테이너 메트릭** | CPU, 메모리, 네트워크 I/O, 재시작 |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **클러스터 메트릭** | 노드 상태, 할당 가능한 리소스, Pod와 워크로드 수 |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes 이벤트** | 경고, 오류, 스케줄링 이벤트 |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **Pod 로그** | 각 노드에서 읽는 모든 컨테이너의 stdout/stderr |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **애플리케이션 트레이스** *(eBPF)* | 모든 Pod의 HTTP, gRPC, SQL/Redis 스팬. SDK나 코드 변경 불필요 |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **요청 메트릭과 서비스 그래프** *(eBPF)* | 서비스별 요청률, 오류, 지연 시간과 서비스 맵을 위한 호출자 → 피호출자 간선 |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **네트워크 플로우** *(eBPF)* | Pod 간 TCP/UDP 바이트와 패킷 카운터 |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **워크로드 비용** *(옵트인, `cost.enabled=true`)* | 네임스페이스, 워크로드, Pod별 지출과 유휴 용량 및 효율 |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **워크로드 비용** *(기본적으로 켜짐)* | 네임스페이스, 워크로드, Pod별 지출과 유휴 용량 및 효율. 경고를 설정할 수 있는 메트릭으로도 제공 |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "클러스터가 `hostPath` 볼륨이나 특권 Pod를 막고 있습니다. **GKE Autopilot** 과 **EKS Fargate** 에서는 정상입니다. 이 가이드 상단에서 해당 플랫폼을 고르고 그 단계를 따르세요. 반면 **OpenShift** 에서는 설치가 성공하지만 에이전트의 노드 Pod가 시작되지 않습니다. **Red Hat OpenShift** 를 고르세요.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "제한적인 Pod Security 정책이 있는 다른 클러스터에서는 실패한 릴리스를 제거하세요:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "그런 다음 `--set preset=gke-autopilot`을 추가해 설치 명령을 다시 실행하세요. 이 프리셋은 hostPath 대신 Kubernetes API로 Pod 로그를 읽고, 강화된 보안 컨텍스트를 적용하며, 특권이 필요한 eBPF와 프로파일링 Pod를 빼 둡니다.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. 에이전트의 Pod가 실행 중인지 확인하세요: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. 컬렉터 로그를 확인하세요: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. 설치 명령의 OneUptime URL과 수집 키가 올바른지 확인하세요.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. 클러스터가 네트워크를 통해 OneUptime 인스턴스에 연결할 수 있는지 확인하세요.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. AI 에이전트의 Pod를 확인하세요: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. 그 로그를 확인하세요: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. Pod가 없나요? chart를 업그레이드하고(고급의 **에이전트 업그레이드 또는 제거** 참조) `--set aiAgent.enabled=true`를 추가하세요.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. 클러스터 이름이 일치하는지 확인하세요. 이 가이드가 설치하는 클러스터: **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. 에이전트의 RBAC 권한을 확인하세요: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. 컬렉터 로그에서 내보내기 오류를 찾으세요: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **커널이 오래되었거나 BTF가 없음.** eBPF에는 BTF가 있는 Linux 5.8+가 필요합니다. 노드에서 `uname -r`로 확인하세요. 업그레이드할 수 없다면 `--set ebpf.enabled=false`로 eBPF를 끄세요.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **특권 Pod가 차단됨.** 잠금이 강한 일부 클러스터는 특권 Pod를 거부합니다. eBPF를 끄세요.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **호스트에서 `debugfs` / `tracefs` 를 쓸 수 없음.** TCP 통계 패밀리만 끄세요: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. eBPF Pod가 정상인지 확인하세요: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. OBI의 디버그 출력을 켜서 트래픽을 보는지 확인하세요: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`를 설정한 뒤 `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`을 읽습니다.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. 스팬이 그곳에는 나타나지만 OneUptime에는 없다면, 컬렉터 로그에서 내보내기 오류를 확인하세요: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "이 명령은 **`k8s-1`** 클러스터용 에이전트를 설치합니다. `clusterName`을 정확히 그대로 두세요. 그렇지 않으면 데이터가 새 클러스터로 등록됩니다.",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "클러스터의 계정에 로그인한 AWS CLI(`aws`)",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "`gke-gcloud-auth-plugin` 구성 요소가 있는 Google Cloud CLI(`gcloud`)",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "클러스터의 구독에 로그인한 Azure CLI(`az`)",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 이상, 그리고 cluster-admin 권한으로 로그인한 OpenShift CLI(`oc`). 설치 과정에서 보안 컨텍스트 제약이 만들어집니다",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "웹 콘솔은 토큰이 포함된 정확한 명령을 제공합니다. 사용자 이름 아래의 **Copy login command** 입니다. 클러스터 관리자로 로그인하세요. 설치 과정에서 보안 컨텍스트 제약이 만들어집니다.",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift`는 노드 컬렉터용과 eBPF Pod용으로 보안 컨텍스트 제약(SCC) 두 개를 만들며, 각각 자체 서비스 계정만 사용합니다. 다른 모든 Pod는 OpenShift 기본값인 `restricted-v2` 아래에서, OpenShift가 할당하는 사용자 ID로 실행됩니다.",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "컬렉터와 Kubernetes AI 에이전트, 그리고 노드마다 `-logs` Pod와 `-ebpf` Pod가 하나씩 있습니다. `-logs`와 `-ebpf` Pod는 chart가 이들을 위해 만든 SCC 아래에서 실행되며, `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`로 둘 다 볼 수 있습니다. 모두 `Running` 상태가 되면 클러스터가 **Kubernetes** 섹션에 자동으로 나타나며, 보통 1~2분 걸립니다.",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "OpenShift는 서비스 계정이 사용할 수 있는 보안 컨텍스트 제약(SCC) 아래에서만 Pod를 받아들이고, 릴리스는 어느 쪽이든 설치되므로 거부된 Pod는 그냥 나타나지 않습니다. 거부 기록을 찾으세요:",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`:** 릴리스가 openshift 프리셋 없이 설치되어 chart가 SCC를 만들지 않았습니다. `helm get values kubernetes-agent --namespace oneuptime-agent`로 릴리스에 주어진 값을 볼 수 있습니다. 프리셋을 추가하세요:",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **SCC가 없음:** `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`로 확인하세요. SCC를 만들려면 cluster-admin 권한이 필요하므로, 다른 사람이 한 설치는 그 단계에서 실패합니다.",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`:** 네임스페이스의 Pod Security 수준이 특권 모드로 실행되는 eBPF Pod에 필요한 수준보다 엄격합니다. 네임스페이스에 `pod-security.kubernetes.io/enforce=privileged` 레이블을 붙이거나 `--set ebpf.enabled=false`로 eBPF를 끄세요.",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **클러스터 관리자가 SCC를 추가하지 않음:** `openshift-restricted` 프리셋을 쓰세요. 그러면 chart가 SCC를 만들지 않고 모든 Pod가 `restricted-v2` 아래에서 실행되므로, Pod 로그는 Kubernetes API로 들어오고 호스트 메트릭, eBPF 트레이스, 프로필은 없습니다:",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot`은 각 노드에서 읽는 대신 Kubernetes API로 Pod 로그를 수집하고, GKE Autopilot이 허용하지 않는 특권 Pod가 필요한 eBPF 트레이싱과 프로파일링을 빼 둡니다.",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "컬렉터, Kubernetes AI 에이전트, Pod 로그 리더, 그리고 kubelet 메트릭을 위한 노드마다 하나의 노드 컬렉터가 있습니다. 모두 `Running` 상태가 되면 클러스터가 **Kubernetes** 섹션에 자동으로 나타나며, 보통 1~2분 걸립니다.",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "다른 클러스터에서는 에이전트가 모든 노드에서 [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/)을 실행해 코드 변경 없이 HTTP, gRPC, SQL 트레이스를 캡처합니다. eBPF 프로그램을 로드하려면 특권 Pod가 필요한데 이 플랫폼은 이를 허용하지 않으므로, 플랫폼의 프리셋은 이를 빼고 연속 프로파일러도 함께 뺍니다.",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "여기에서 트레이스를 얻으려면 [OpenTelemetry SDK](/docs/telemetry/open-telemetry)로 서비스를 계측하고 OneUptime으로 직접 보내세요.",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **Pod 로그** | Kubernetes API로 읽는 모든 컨테이너의 stdout/stderr |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "Autopilot은 hostPath를 막으므로, 호스트의 `/proc`와 `/sys`를 읽는 노드 메트릭(디스크 I/O, inode, NIC 오류)은 수집되지 않습니다. kubelet과 cAdvisor 메트릭은 수집됩니다.",
  "Pod logs are read through the Kubernetes API on this platform.":
    "이 플랫폼에서는 Pod 로그를 Kubernetes API로 읽습니다.",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. 로그 리더가 준비되었는지 확인하세요: `kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. 그 `/healthz` 엔드포인트는 활성 로그 스트림 수와 마지막 내보내기 오류를 보고합니다.",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. 매우 큰 클러스터에서는 리더 하나가 뒤처질 수 있습니다. `namespaceFilters`로 네임스페이스를 별도의 릴리스에 나누세요.",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "클러스터의 계정에 로그인한 AWS CLI(`aws`)와 `eksctl`",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "Fargate에서는 Fargate 프로필이 선택한 네임스페이스에서만 Pod가 실행됩니다. `oneuptime-agent`용으로 하나 만드세요. 없으면 에이전트의 Pod가 `Pending` 상태로 남습니다:",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate`는 각 노드에서 읽는 대신 Kubernetes API로 Pod 로그를 수집하고, EKS Fargate가 허용하지 않는 특권 Pod가 필요한 eBPF 트레이싱과 프로파일링을 빼 둡니다.",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "Deployment 세 개: 컬렉터, Kubernetes AI 에이전트, Pod 로그 리더입니다. Fargate는 DaemonSet을 스케줄하지 않으므로 노드별 Pod가 없습니다. 모두 `Running` 상태가 되면 클러스터가 **Kubernetes** 섹션에 자동으로 나타나며, 보통 1~2분 걸립니다.",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "그런 다음 Fargate 프로필을 제거하세요: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "Fargate는 DaemonSet을 스케줄하지 않으므로 그곳에서는 노드, Pod, 컨테이너 메트릭을 사용할 수 없습니다.",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "Fargate는 Fargate 프로필이 선택한 네임스페이스에만 Pod를 스케줄합니다. `oneuptime-agent`용 프로필이 있는지 확인하세요:",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "없다면 만드세요. Fargate는 Pod가 만들어질 때 선택되므로, 이미 대기 중이던 Pod는 계속 대기합니다. 프로필이 활성화되면 에이전트의 Deployment를 다시 시작하세요:",
};

export default TRANSLATION;
