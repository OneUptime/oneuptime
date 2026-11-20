import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in Arabic (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * Arabic. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Arabic words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "عنقود Kubernetes يعمل بالإصدار v1.23 أو أحدث",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` و`helm` (v3) مثبّتان على جهازك",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "عنقود خاطئ؟ بدّله باستخدام `kubectl config use-context <context-name>`.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "استبدل `my-cluster` باسم لهذا العنقود، مثل `prod-us-east-1`. بهذا الاسم يظهر العنقود في OneUptime، لذا أبقه ثابتًا: الاسم الجديد يسجّل عنقودًا جديدًا.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "يفعّل `--set aiAgent.enabled=true` **تحقيقات الذكاء الاصطناعي** كما يفعل الـ chart افتراضيًا: يحقق الذكاء الاصطناعي من OneUptime في حوادث هذا العنقود وتنبيهاته باستخدام kubectl للقراءة فقط، عبر وكيل الذكاء الاصطناعي في Kubernetes.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "اختر مفتاح استيعاب في الخطوة 1 لملء `<YOUR_API_KEY>`.",
  "You should see:": "يُفترض أن ترى:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "المجمّع ووكيل الذكاء الاصطناعي في Kubernetes، إضافةً إلى Pod واحد من `-logs` وPod واحد من `-ebpf` على كل عقدة. حين تصبح في حالة `Running` يظهر العنقود تلقائيًا في قسم **Kubernetes**، عادةً خلال دقيقة أو دقيقتين.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**وكيل الذكاء الاصطناعي في Kubernetes (مفعّل افتراضيًا، للقراءة فقط).** يتيح الـ Pod المسمّى `kubernetes-agent-ai-agent` للذكاء الاصطناعي من OneUptime التحقيق في حوادث هذا العنقود وتنبيهاته باستخدام kubectl للقراءة فقط (`get`، `describe`، `logs`، `events`، `top`) وبمفتاح API نفسه، ولا يمكنه تغيير أي شيء ما لم تمنحه لاحقًا صلاحية الكتابة. لرؤيته افتح العنقود وانتقل إلى **الذكاء الاصطناعي ← الوكيل**. لا تريده؟ ثبّت باستخدام `--set aiAgent.enabled=false` بدلًا من `--set aiAgent.enabled=true`.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "تحدد قواعد مساحات الأسماء ما يجمعه الوكيل من كل مساحة أسماء. لجمع سجلات الـ Pod وبيانات eBPF من `default` و`production` و`staging` فقط:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "للإبقاء على كل شيء مع إيقاف سجلات مساحات الأسماء الصاخبة، استثنِها من `podLogs` فقط:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **النطاقات:** `podLogs` (stdout/stderr للحاويات)، و`ebpfDiscovery` (تتبعات eBPF ومقاييسه)، و`metrics` (المقاييس ذات مساحة الأسماء)، و`traces` (كل span).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- تطابق **الأنماط** اسم مساحة الأسماء بالكامل وتقبل `*`، كما في `team-*`. تتغلب قاعدة `exclude` دائمًا على قاعدة `include`.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **ضبط القواعد يستبدل القاعدة الافتراضية**، التي تستثني `kube-system` من `podLogs` و`ebpfDiscovery`. أبقِها في قائمتك، كما في المثال الثاني، إن كنت لا تزال تريد ذلك.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- ليس لمقاييس العُقد والعنقود مساحة أسماء، لذا تُحفظ دائمًا.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- يتطلب `--set-json` الإصدار Helm 3.10 أو أحدث.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**أرسل الأسطر المهمة فقط.** أسقط أسطر سجلات الـ Pod التي تقل عن درجة خطورة معينة قبل أن تغادر العنقود:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    'يقبل `TRACE` و`DEBUG` و`INFO` و`WARN` و`ERROR` و`FATAL`: يُبقي `WARN` التحذيرات والأخطاء والأسطر الفادحة. تُقرأ درجة الخطورة من سطر السجل نفسه (`[ERROR]`، `level=warn`، `"level":"info"`). لا تُسقط أحداث Kubernetes بهذا الإعداد أبدًا.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**أوقف سجلات الـ Pod.** لا تتأثر المقاييس: يواصل مجمّع العُقد العمل لمقاييس kubelet وcAdvisor، ويكفّ فقط عن قراءة سجلات الـ Pod:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**غيّر طريقة قراءة السجلات.** يختار الإعداد المسبق ذلك نيابةً عنك؛ ويتغلب `logs.mode` الصريح عليه دائمًا:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: يقرأ `/var/log/pods` على كل عقدة عبر hostPath (أقل عبء؛ يتطلب hostPath).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: يتابع Deployment سجلات الـ Pod عبر واجهة Kubernetes البرمجية (يعمل على أي عنقود).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: بلا سجلات Pod.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "يقرأ ذلك خادم API حيث يجيب داخل العنقود. أما etcd والمجدول ومدير المتحكمات فتجيب على عُقد مستوى التحكم، التي لا يستطيع Pod الوكيل تخمينها، لذا يقرؤها بمجرد أن تدرج عنوان كل عقدة:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **المجدول ومدير المتحكمات** يقدّمان HTTPS ويقبلان رمز الوكيل، لكن kubeadm يربطهما بالعنوان `127.0.0.1`: امنحهما `--bind-address` يستطيع Pod الوكيل الوصول إليه.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** يقدّم مقاييسه عبر HTTP عادي على `--listen-metrics-urls` الخاص بـ kubeadm (المنفذ 2381، المربوط بـ `127.0.0.1` حتى تضيف عنوان العقدة)، كما سبق. أو اجمع من منفذ عميل HTTPS الخاص به، 2379، بشهادة العميل التي يطلبها: ضع `ca.crt` و`tls.crt` و`tls.key` في Secret ضمن `oneuptime-agent` وسمِّه في `controlPlane.etcd.clientCertSecret`.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "للعناقيد ذاتية الإدارة فقط: لا تكشف الخدمات المُدارة (EKS، GKE، AKS) مقاييس مستوى التحكم لديها.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "مراقبة التكاليف مفعّلة افتراضيًا: يتضمن الوكيل محرك OpenCost مفتوح المصدر (إضافةً إلى Prometheus الصغير الذي يحتاجه)، ويسعّر عُقدك ووحدات التخزين لديك وفق قوائم الأسعار العامة لمزوّد السحابة، دون أي بيانات اعتماد، ويرسل تكلفة كل مساحة أسماء وكل حمل عمل. تظهر أولى البيانات في صفحتَي «نظرة عامة» و«التكاليف» للعنقود بعد مرور أول ساعة كاملة.",
  "On an agent installed before it was on by default, upgrade it:":
    "إذا كان الوكيل مثبّتًا قبل أن تصبح مراقبة التكاليف مفعّلة افتراضيًا، فنفّذ ترقيته:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **لإيقافها:** أضف `--set cost.enabled=false` إلى الترقية نفسها.",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "مراقبة التكاليف معطّلة افتراضيًا على هذه المنصة: فهي تحاسب كل Pod على ما يطلبه من موارد، لذا ستزيد وحدات Pod الثلاث الخاصة بالتكاليف من فاتورتك، كما أن OpenCost يسعّر العُقد لا وحدات Pod. لتفعيلها رغم ذلك:",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "هذا وحده تثبيت كامل: يتضمن الـ chart محرك OpenCost مفتوح المصدر (إضافةً إلى Prometheus الصغير الذي يحتاجه) ويسعّر عُقدك ووحدات التخزين لديك وفق قوائم الأسعار العامة لمزوّد السحابة، دون أي بيانات اعتماد. يضيف ثلاث وحدات Pod صغيرة؛ وتظهر أولى البيانات بعد مرور أول ساعة كاملة.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **هل تشغّل Kubecost أو OpenCost بالفعل؟** يعثر عليه الوكيل ويقرأ منه بدلًا من المحرك الذي يتضمنه الـ chart، وتذكر صفحة «نظرة عامة» للعنقود ذلك: أضف `--set cost.engine.url=auto` لإيقاف تضمين محرك ثانٍ.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **محلي أو bare metal؟** اضبط جدول أسعار باستخدام `--set cost.opencost.customPricing.enabled=true` (بالدولار لكل ساعة مورد؛ راجع `values.yaml` في الـ chart).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "الدليل الكامل: [قابلية ملاحظة تكاليف Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "يشغّل الوكيل [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) على كل عقدة. يلتقط حركة HTTP/HTTPS وgRPC وSQL/Redis من خدمات Go و.NET وJava وNode.js وPython وRuby وRust، بلا SDK وبلا sidecar، ويرسل التتبعات ومقاييس الطلبات (RED) وبيانات مخطط الخدمات عبر المجمّع.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**المتطلبات:** نواة Linux **5.8+** مع BTF (الافتراضي في Debian 11+ وUbuntu 20.10+ وFedora 34+ وRHEL 9+). تعمل وحدات Pod الخاصة بـ eBPF **بامتيازات**، تحتاجها لتحميل برامج eBPF.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "**أوقفه** إذا كانت عُقدك تعمل بنواة أقدم، أو إذا لم يكن مسموحًا بوحدات Pod ذات الامتيازات، أو إذا كانت خدماتك ترسل التتبعات بالفعل عبر حزم OpenTelemetry SDK ولا تريد تكرارًا:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**اختر الإشارات.** تُشغَّل كل عائلة أو تُوقَف باستخدام `--set ebpf.features.<name>=false` (أو `=true`):",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | الافتراضي | ما يضيفه |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | مفعّل | معدل طلبات HTTP/gRPC والأخطاء وزمن الاستجابة لكل خدمة |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | مفعّل | عدد استدعاءات الـ span ومدتها (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | مفعّل | حواف المستدعي ← المستدعى؛ تبني خريطة الخدمات |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | مفعّل | عدّادات تدفقات TCP/UDP بين وحدات Pod |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | معطّل | مقاييس الشبكة بين المناطق (تضاعف عدد قيمها المميزة) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | مفعّل | زمن الذهاب والإياب في TCP وعدّادات الاتصالات الفاشلة وإعادة الإرسال على مستوى العقدة |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**نشر التتبع بين الخدمات** (ربط طلب يعبر من Pod A ← إلى Pod B في تتبع واحد، حتى على عقدة أخرى) **مفعّل افتراضيًا**. يعمل بإعادة كتابة حركة المرور الجارية بالفعل (بتوسيع طلبات HTTP النصية في النواة، وإلحاق خيار TCP بـ TLS وTCP الخام)، وأي خطأ في هذا العدّ للبايتات يُخرج التدفق عن التزامن: والعرَض المُبلَّغ عنه هو توقف عمليات النقل عبر وكيل L7 مثل nginx بمجرد أن تتجاوز الاستجابة ~64KB. إذا رأيت ذلك، أو بدأت شبكة خدمات (service mesh) بإفشال وحدات Pod، فأوقفه باستخدام `--set ebpf.contextPropagation=false`؛ إذ ينشر OpenTelemetry SDK الترويسة `traceparent` في مساحة المستخدم دون أي من ذلك.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "يصبح كل `oneuptime.labels.<key>=<value>` التسمية `<key>:<value>` على العنقود وعلى الخدمات والمضيفين الذين يبلّغ عنهم. تُطابق التسميات دون تمييز بين الأحرف الكبيرة والصغيرة، لذا يُعاد استخدام التسمية الموجودة `Production`؛ ولا يزيل الوكيل أبدًا التسميات المضافة في واجهة OneUptime.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "نفّذ **ترقية** إلى أحدث chart. يحتفظ `--reset-then-reuse-values` (Helm 3.14+) بالقيم التي ضبطتها (الإعداد المسبق، واسم العنقود، والمرشحات) ويأخذ كل ما عداها من الـ chart الجديد؛ أضف فوقه أي أعلام `--set` جديدة:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "في Helm 3.13 وما قبله، نفّذ الترقية بدلًا من ذلك بالقيم التي ضبطتها:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "لا تستخدم `--reuse-values`: فهو يحتفظ أيضًا بالقيم الافتراضية للـ chart الذي تُرقّي منه، فلا تُطبَّق أبدًا القيم الافتراضية للـ chart الأحدث (ومنها صورة eBPF الخاصة به).",
  "**Uninstall** the agent and its namespace:":
    "نفّذ **إلغاء التثبيت** للوكيل ومساحة أسمائه:",
  "| Category | Data |": "| الفئة | البيانات |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **مقاييس العُقد** | استخدام المعالج والذاكرة ونظام الملفات والشبكة |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **مقاييس وحدات Pod والحاويات** | المعالج والذاكرة وإدخال/إخراج الشبكة وعمليات إعادة التشغيل |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **مقاييس العنقود** | حالات العُقد، والموارد القابلة للتخصيص، وأعداد وحدات Pod وأحمال العمل |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **أحداث Kubernetes** | التحذيرات والأخطاء وأحداث الجدولة |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **سجلات الـ Pod** | stdout/stderr لكل حاوية، مقروءة من كل عقدة |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **تتبعات التطبيقات** *(eBPF)* | spans لـ HTTP وgRPC وSQL/Redis من كل Pod، دون SDK أو تغييرات في الكود |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **مقاييس الطلبات ومخطط الخدمات** *(eBPF)* | معدل الطلبات والأخطاء وزمن الاستجابة لكل خدمة، وحواف المستدعي ← المستدعى لخريطة الخدمات |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **تدفقات الشبكة** *(eBPF)* | عدّادات البايتات والحزم في TCP/UDP بين وحدات Pod |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **تكاليف أحمال العمل** *(اختياري، `cost.enabled=true`)* | الإنفاق لكل مساحة أسماء وحمل عمل وPod، مع السعة الخاملة والكفاءة |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **تكاليف أحمال العمل** *(مفعّلة افتراضيًا)* | الإنفاق لكل مساحة أسماء وحمل عمل وPod، مع السعة الخاملة والكفاءة، وكذلك كمقاييس يمكن التنبيه عليها |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "يحظر عنقودك وحدات تخزين `hostPath` أو وحدات Pod ذات الامتيازات. هذا طبيعي على **GKE Autopilot** و **EKS Fargate**: اختر تلك المنصة في أعلى هذا الدليل واتبع خطواتها. أما على **OpenShift** فينجح التثبيت، لكن وحدات Pod الخاصة بعُقد الوكيل لا تبدأ أبدًا: اختر **Red Hat OpenShift**.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "على أي عنقود آخر بسياسة Pod Security مقيِّدة، أزل الإصدار الفاشل:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "ثم شغّل أمر التثبيت مجددًا مع إضافة `--set preset=gke-autopilot`. يقرأ هذا الإعداد المسبق سجلات الـ Pod عبر واجهة Kubernetes البرمجية بدلًا من hostPath، ويطبّق سياق أمان مشدّدًا، ويستبعد وحدات Pod ذات الامتيازات الخاصة بـ eBPF والتنميط.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. تحقّق من أن وحدات Pod الخاصة بالوكيل تعمل: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. تحقّق من سجلات المجمّع: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. تحقّق من صحة عنوان URL الخاص بـ OneUptime ومفتاح الاستيعاب في أمر التثبيت.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. تأكد من أن العنقود يستطيع الوصول إلى مثيل OneUptime لديك عبر الشبكة.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. تحقّق من Pod وكيل الذكاء الاصطناعي: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. تحقّق من سجلاته: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. لا يوجد Pod؟ رقِّ الـ chart (راجع **ترقية الوكيل أو إلغاء تثبيته** ضمن متقدم) وأضف `--set aiAgent.enabled=true`.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. تحقّق من تطابق اسم العنقود: يثبّت هذا الدليل **`my-cluster`**.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. تحقّق من صلاحيات RBAC الخاصة بالوكيل: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. ابحث عن أخطاء التصدير في سجلات المجمّع: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **النواة قديمة جدًا أو بلا BTF.** يحتاج eBPF إلى Linux 5.8+ مع BTF؛ تحقّق باستخدام `uname -r` على عقدة. إن لم تستطع الترقية، فأوقف eBPF باستخدام `--set ebpf.enabled=false`.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **وحدات Pod ذات الامتيازات محظورة.** ترفضها بعض العناقيد المقفلة. أوقف eBPF.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` غير متاحين على المضيف.** أوقف عائلة إحصاءات TCP فقط: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. تحقّق من سلامة وحدات Pod الخاصة بـ eBPF: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. فعّل مخرجات التصحيح في OBI للتأكد من أنه يرى الحركة: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`، ثم اقرأ `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. إذا ظهرت الـ spans هناك لا في OneUptime، فابحث عن أخطاء التصدير في سجلات المجمّع: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "هذا يثبّت الوكيل للعنقود **`k8s-1`**: أبقِ `clusterName` كما هو تمامًا، وإلا فستُسجَّل البيانات عنقودًا جديدًا.",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "واجهة AWS CLI (`aws`)، مسجّلًا دخولك إلى حساب العنقود",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "واجهة Google Cloud CLI (`gcloud`) مع المكوّن `gke-gcloud-auth-plugin`",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "واجهة Azure CLI (`az`)، مسجّلًا دخولك إلى اشتراك العنقود",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 أو أحدث، وواجهة OpenShift CLI (`oc`) مسجّلًا دخولك بصلاحيات cluster-admin: ينشئ التثبيت قيود سياق الأمان",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "تعطيك وحدة التحكم على الويب الأمر الدقيق مع الرمز: **Copy login command**، أسفل اسم المستخدم. سجّل الدخول بوصفك مسؤول العنقود: ينشئ التثبيت قيود سياق الأمان.",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "ينشئ `preset=openshift` قيدَي سياق أمان (SCC)، أحدهما لمجمّع العُقد والآخر لوحدات Pod الخاصة بـ eBPF، ولا يستخدم كلًّا منهما إلا حساب الخدمة الخاص به. أما كل وحدات Pod الأخرى فتعمل ضمن `restricted-v2` الافتراضي في OpenShift، بمعرّف المستخدم الذي يعيّنه OpenShift.",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "المجمّع ووكيل الذكاء الاصطناعي في Kubernetes، إضافةً إلى Pod واحد من `-logs` وPod واحد من `-ebpf` على كل عقدة. تعمل وحدات Pod الخاصة بـ `-logs` و`-ebpf` ضمن قيود SCC التي أنشأها الـ chart لها: يعرض `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` كليهما. حين تصبح في حالة `Running` يظهر العنقود تلقائيًا في قسم **Kubernetes**، عادةً خلال دقيقة أو دقيقتين.",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "لا يقبل OpenShift الـ Pod إلا ضمن قيد سياق أمان (SCC) يُسمح لحساب خدمته باستخدامه، والإصدار يُثبَّت في كل الأحوال، لذا فإن الـ Pod المرفوض لا يظهر أبدًا ببساطة. ابحث عن الرفض:",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`:** ثُبّت الإصدار دون الإعداد المسبق openshift، لذا لم ينشئ الـ chart أي SCC. يعرض `helm get values kubernetes-agent --namespace oneuptime-agent` القيم التي تلقاها. أضف الإعداد المسبق:",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **قيود SCC مفقودة:** تحقّق باستخدام `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. يتطلب إنشاؤها صلاحيات cluster-admin، لذا يفشل التثبيت الذي يجريه أي شخص آخر عند الوصول إليها.",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`:** مستوى Pod Security لمساحة الأسماء أشد مما تحتاجه وحدات Pod الخاصة بـ eBPF، التي تعمل بامتيازات. ضع عليها التسمية `pod-security.kubernetes.io/enforce=privileged`، أو أوقف eBPF باستخدام `--set ebpf.enabled=false`.",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **مسؤول عنقودك لن يضيف قيود SCC:** استخدم الإعداد المسبق `openshift-restricted`. عندها لا ينشئ الـ chart أي SCC وتعمل كل وحدات Pod ضمن `restricted-v2`، فتأتي سجلات الـ Pod عبر واجهة Kubernetes البرمجية، ولا توجد مقاييس للمضيف ولا تتبعات eBPF ولا ملفات تعريف:",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "يجمع `preset=gke-autopilot` سجلات الـ Pod عبر واجهة Kubernetes البرمجية بدلًا من قراءتها من كل عقدة، ويستبعد تتبع eBPF والتنميط، لأنهما يحتاجان إلى وحدات Pod ذات امتيازات لا يسمح بها GKE Autopilot.",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "المجمّع ووكيل الذكاء الاصطناعي في Kubernetes وقارئ سجلات الـ Pod، إضافةً إلى مجمّع عقدة واحد لكل عقدة لمقاييس kubelet. حين تصبح في حالة `Running` يظهر العنقود تلقائيًا في قسم **Kubernetes**، عادةً خلال دقيقة أو دقيقتين.",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "على العناقيد الأخرى يشغّل الوكيل [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) على كل عقدة لالتقاط تتبعات HTTP وgRPC وSQL دون تغييرات في الكود. يتطلب تحميل برامج eBPF وحدات Pod ذات امتيازات، لا تسمح بها هذه المنصة، لذا يستبعده الإعداد المسبق للمنصة، ومعه أداة التنميط المستمر.",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "للحصول على التتبعات هنا، جهّز خدماتك باستخدام [OpenTelemetry SDK](/docs/telemetry/open-telemetry) وأرسل التتبعات إلى OneUptime مباشرة.",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **سجلات الـ Pod** | stdout/stderr لكل حاوية، مقروءة عبر واجهة Kubernetes البرمجية |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "يحظر Autopilot مسار hostPath، لذا لا تُجمع مقاييس العُقد التي تقرأ `/proc` و`/sys` الخاصين بالمضيف (إدخال/إخراج القرص، وinodes، وأخطاء بطاقات الشبكة)؛ أما مقاييس kubelet وcAdvisor فتُجمع.",
  "Pod logs are read through the Kubernetes API on this platform.":
    "على هذه المنصة تُقرأ سجلات الـ Pod عبر واجهة Kubernetes البرمجية.",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. تحقّق من أن قارئ السجلات جاهز: `kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. تُبلغ نقطة النهاية `/healthz` الخاصة به عن عدد تدفقات السجلات النشطة وآخر خطأ تصدير.",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. على العناقيد الكبيرة جدًا قد يتأخر قارئ واحد: وزّع مساحات الأسماء على إصدارات منفصلة باستخدام `namespaceFilters`.",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "واجهة AWS CLI (`aws`) و`eksctl`، مسجّلًا دخولك إلى حساب العنقود",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "لا تعمل وحدات Pod على Fargate إلا في مساحات الأسماء التي يختارها ملف تعريف Fargate. أنشئ واحدًا لـ `oneuptime-agent`: من دونه تبقى وحدات Pod الخاصة بالوكيل في حالة `Pending`:",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "يجمع `preset=eks-fargate` سجلات الـ Pod عبر واجهة Kubernetes البرمجية بدلًا من قراءتها من كل عقدة، ويستبعد تتبع eBPF والتنميط، لأنهما يحتاجان إلى وحدات Pod ذات امتيازات لا يسمح بها EKS Fargate.",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "ثلاثة Deployments: المجمّع، ووكيل الذكاء الاصطناعي في Kubernetes، وقارئ سجلات الـ Pod. لا يجدول Fargate أي DaemonSet أبدًا، لذا لا توجد وحدات Pod لكل عقدة. حين تصبح في حالة `Running` يظهر العنقود تلقائيًا في قسم **Kubernetes**، عادةً خلال دقيقة أو دقيقتين.",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "ثم أزل ملف تعريف Fargate: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "لا يجدول Fargate أي DaemonSet أبدًا، لذا لا تتوفر هناك مقاييس العُقد ووحدات Pod والحاويات.",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "لا يجدول Fargate وحدات Pod إلا في مساحات الأسماء التي يختارها ملف تعريف Fargate. تحقّق من وجود ملف تعريف لـ `oneuptime-agent`:",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "إن لم يوجد، فأنشئه. يُختار Fargate عند إنشاء الـ Pod، لذا تبقى وحدات Pod التي كانت في الانتظار في الانتظار: أعد تشغيل Deployments الخاصة بالوكيل بمجرد أن يصبح ملف التعريف نشطًا:",
};

export default TRANSLATION;
