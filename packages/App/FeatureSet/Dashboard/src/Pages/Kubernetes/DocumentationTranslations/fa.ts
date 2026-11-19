import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in Persian (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * Persian. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Persian words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "یک خوشه Kubernetes با نسخه v1.23 یا جدیدتر",
  "`kubectl` and `helm` (v3) installed on your machine":
    "`kubectl` و `helm` (v3) نصب‌شده روی ماشین شما",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "خوشه اشتباه است؟ با `kubectl config use-context <context-name>` عوضش کنید.",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "`my-cluster` را با نامی برای این خوشه جایگزین کنید، مثلاً `prod-us-east-1`. خوشه با همین نام در OneUptime نشان داده می‌شود، پس آن را ثابت نگه دارید: نام تازه یک خوشه تازه ثبت می‌کند.",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` همان‌طور که chart به‌طور پیش‌فرض انجام می‌دهد، **بررسی‌های هوش مصنوعی** را روشن می‌کند: هوش مصنوعی OneUptime از طریق عامل هوش مصنوعی Kubernetes و با kubectl فقط‌خواندنی، رخدادها و هشدارهای این خوشه را بررسی می‌کند.",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "برای پر شدن `<YOUR_API_KEY>`، در مرحله 1 یک کلید دریافت داده انتخاب کنید.",
  "You should see:": "باید این را ببینید:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "کالکتور و عامل هوش مصنوعی Kubernetes، به‌علاوه یک پاد `-logs` و یک پاد `-ebpf` روی هر گره. وقتی همه `Running` شوند، خوشه خودکار در بخش **Kubernetes** نمایان می‌شود، معمولاً ظرف یکی دو دقیقه.",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**عامل هوش مصنوعی Kubernetes (به‌طور پیش‌فرض روشن، فقط‌خواندنی).** پاد `kubernetes-agent-ai-agent` به هوش مصنوعی OneUptime اجازه می‌دهد با همان کلید API و با kubectl فقط‌خواندنی (`get`، `describe`، `logs`، `events`، `top`) رخدادها و هشدارهای این خوشه را بررسی کند، و تا وقتی بعداً به آن دسترسی نوشتن ندهید هیچ چیزی را نمی‌تواند تغییر دهد. برای دیدن آن، خوشه را باز کنید و به **هوش مصنوعی ← عامل** بروید. آن را نمی‌خواهید؟ به‌جای `--set aiAgent.enabled=true` با `--set aiAgent.enabled=false` نصب کنید.",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "قاعده‌های فضای نام تعیین می‌کنند عامل از هر فضای نام چه چیزی را جمع‌آوری کند. برای جمع‌آوری لاگ‌های پاد و داده‌های eBPF فقط از `default`، `production` و `staging`:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "برای نگه داشتن همه‌چیز و فقط متوقف کردن لاگ‌های فضاهای نام پرسروصدا، آن‌ها را فقط از `podLogs` مستثنا کنید:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **دامنه‌ها:** `podLogs` (stdout/stderr کانتینرها)، `ebpfDiscovery` (ترِیس‌ها و متریک‌های eBPF)، `metrics` (متریک‌های دارای فضای نام) و `traces` (همه spanها).",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **الگوها** با نام کامل فضای نام تطبیق داده می‌شوند و `*` را می‌پذیرند، مثل `team-*`. قاعده `exclude` همیشه بر قاعده `include` برتری دارد.",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **تنظیم قاعده‌ها جای قاعده پیش‌فرض را می‌گیرد**، که `kube-system` را از `podLogs` و `ebpfDiscovery` مستثنا می‌کند. اگر هنوز آن را می‌خواهید، مثل مثال دوم در فهرستتان نگهش دارید.",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- متریک‌های گره و خوشه فضای نام ندارند، پس همیشه نگه داشته می‌شوند.",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` به Helm 3.10 یا جدیدتر نیاز دارد.",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**فقط خط‌های مهم را بفرستید.** خط‌های لاگ پاد زیر یک سطح شدت را پیش از خروج از خوشه دور بریزید:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    '`TRACE`، `DEBUG`، `INFO`، `WARN`، `ERROR` و `FATAL` را می‌پذیرد: `WARN` هشدارها، خطاها و خط‌های مهلک را نگه می‌دارد. شدت از خود خط لاگ خوانده می‌شود (`[ERROR]`، `level=warn`، `"level":"info"`). رویدادهای Kubernetes هرگز با این تنظیم دور ریخته نمی‌شوند.',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**لاگ‌های پاد را خاموش کنید.** متریک‌ها تحت تأثیر قرار نمی‌گیرند: کالکتور گره برای متریک‌های kubelet و cAdvisor همچنان اجرا می‌شود و فقط خواندن لاگ‌های پاد را متوقف می‌کند:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**روش خواندن لاگ‌ها را تغییر دهید.** پیش‌تنظیم این را برایتان انتخاب می‌کند؛ یک `logs.mode` صریح همیشه بر آن برتری دارد:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: `/var/log/pods` را روی هر گره از طریق hostPath می‌خواند (کمترین سربار؛ به hostPath نیاز دارد).",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: یک Deployment لاگ‌های پاد را از طریق API در Kubernetes دنبال می‌کند (روی هر خوشه‌ای کار می‌کند).",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: بدون لاگ پاد.",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "این کار سرور API را می‌خواند، همان‌جا که درون خوشه پاسخ می‌دهد. etcd، زمان‌بند و مدیر کنترلرها روی گره‌های صفحه کنترل پاسخ می‌دهند که پاد عامل نمی‌تواند حدسشان بزند، پس به‌محض این‌که نشانی هر گره را بدهید آن‌ها را می‌خواند:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **زمان‌بند و مدیر کنترلرها** HTTPS ارائه می‌دهند و توکن عامل را می‌پذیرند، اما kubeadm آن‌ها را به `127.0.0.1` متصل می‌کند: به آن‌ها یک `--bind-address` بدهید که پاد عامل به آن دسترسی داشته باشد.",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** همان‌طور که بالا آمد، متریک‌هایش را با HTTP ساده روی `--listen-metrics-urls` در kubeadm ارائه می‌دهد (درگاه 2381 که تا افزودن نشانی گره به `127.0.0.1` متصل است). یا درگاه کلاینت HTTPS آن، 2379، را با گواهی کلاینتی که درخواست می‌کند بخوانید: `ca.crt`، `tls.crt` و `tls.key` را در یک Secret در `oneuptime-agent` بگذارید و نامش را در `controlPlane.etcd.clientCertSecret` بیاورید.",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "فقط برای خوشه‌های خودمدیریت: سرویس‌های مدیریت‌شده (EKS، GKE، AKS) متریک‌های صفحه کنترل خود را در دسترس نمی‌گذارند.",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "پایش هزینه به‌طور پیش‌فرض روشن است: عامل موتور متن‌باز OpenCost (به‌علاوه Prometheus کوچکی که لازم دارد) را همراه خود دارد، گره‌ها و حجم‌های شما را بر اساس فهرست قیمت عمومی ارائه‌دهنده ابری‌تان قیمت‌گذاری می‌کند، بدون نیاز به اعتبارنامه، و می‌فرستد که هر فضای نام و بار کاری چقدر هزینه دارد. نخستین داده‌ها پس از نخستین ساعت کامل در نمای کلی خوشه و صفحه «هزینه‌ها» نمایان می‌شوند.",
  "On an agent installed before it was on by default, upgrade it:":
    "عاملی را که پیش از پیش‌فرض شدن این قابلیت نصب شده است، به‌روز کنید:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **خاموش کردن:** `--set cost.enabled=false` را به همان به‌روزرسانی اضافه کنید.",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "پایش هزینه روی این سکو به‌طور پیش‌فرض خاموش است: این سکو صورت‌حساب هر پاد را بر اساس منابعی که درخواست می‌کند صادر می‌کند، پس سه پاد هزینه به صورت‌حساب شما می‌افزودند، و OpenCost به‌جای پادها گره‌ها را قیمت‌گذاری می‌کند. اگر با این حال می‌خواهید روشنش کنید:",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "همین به‌تنهایی یک نصب کامل است: chart موتور متن‌باز OpenCost (به‌علاوه Prometheus کوچکی که لازم دارد) را همراه خود دارد و گره‌ها و حجم‌های شما را بر اساس فهرست قیمت عمومی ارائه‌دهنده ابری‌تان قیمت‌گذاری می‌کند، بدون نیاز به اعتبارنامه. سه پاد کوچک اضافه می‌کند؛ نخستین داده‌ها پس از نخستین ساعت کامل نمایان می‌شوند.",
  "- **Already running Kubecost or OpenCost?** The agent finds it and reads it instead of the bundled engine, and the cluster's overview says so: add `--set cost.engine.url=auto` to stop bundling a second one.":
    "- **از قبل Kubecost یا OpenCost دارید؟** عامل آن را پیدا می‌کند و آن را به‌جای موتور همراه می‌خواند، و نمای کلی خوشه هم همین را می‌گوید: برای اینکه موتور دومی همراه نصب نشود، `--set cost.engine.url=auto` را اضافه کنید.",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **محلی یا bare metal؟** با `--set cost.opencost.customPricing.enabled=true` یک جدول نرخ تعیین کنید (USD به ازای هر ساعت منبع؛ `values.yaml` در chart را ببینید).",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "راهنمای کامل: [مشاهده‌پذیری هزینه Kubernetes](/docs/telemetry/kubernetes-cost).",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "عامل روی هر گره [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) را اجرا می‌کند. این ابزار ترافیک HTTP/HTTPS، gRPC و SQL/Redis سرویس‌های Go، .NET، Java، Node.js، Python، Ruby و Rust را بدون SDK و بدون sidecar می‌گیرد و ترِیس‌ها، متریک‌های درخواست (RED) و داده‌های گراف سرویس را از طریق کالکتور می‌فرستد.",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**الزامات:** هسته Linux **5.8+** با BTF (پیش‌فرض در Debian 11+، Ubuntu 20.10+، Fedora 34+، RHEL 9+). پادهای eBPF به‌صورت **ممتاز** اجرا می‌شوند که برای بارگذاری برنامه‌های eBPF لازم است.",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "اگر گره‌هایتان هسته قدیمی‌تری دارند، اگر پادهای ممتاز مجاز نیستند، یا اگر سرویس‌هایتان از قبل با SDKهای OpenTelemetry ترِیس می‌فرستند و تکراری نمی‌خواهید، **آن را خاموش کنید**:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**سیگنال‌ها را انتخاب کنید.** هر خانواده با `--set ebpf.features.<name>=false` (یا `=true`) روشن یا خاموش می‌شود:",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | پیش‌فرض | چه چیزی اضافه می‌کند |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | روشن | نرخ درخواست HTTP/gRPC، خطاها و تأخیر برای هر سرویس |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | روشن | تعداد فراخوانی و مدت spanها (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | روشن | یال‌های فراخواننده ← فراخوانده؛ نقشه سرویس را می‌سازد |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | روشن | شمارنده‌های جریان TCP/UDP بین پادها |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | خاموش | متریک‌های شبکه میان منطقه‌ها (کاردینالیتی آن‌ها را دو برابر می‌کند) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | روشن | RTT در TCP و شمارنده‌های اتصال ناموفق و ارسال دوباره در سطح گره |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**انتشار ترِیس میان سرویس‌ها** (پیوند دادن درخواستی که از پاد A ← به پاد B می‌رود در یک ترِیس واحد، حتی روی گره‌ای دیگر) **به‌طور پیش‌فرض روشن** است. این کار با بازنویسی ترافیکی انجام می‌شود که از قبل در جریان است (گسترش درخواست‌های HTTP متن ساده در هسته، و افزودن یک گزینه TCP به TLS و TCP خام)، و هر خطا در این شمارش بایت‌ها جریان را از هماهنگی خارج می‌کند: نشانه گزارش‌شده، گیر کردن انتقال‌ها از یک پراکسی L7 مثل nginx است وقتی پاسخ از ~64KB بگذرد. اگر این را دیدید، یا یک service mesh پادها را از کار انداخت، آن را با `--set ebpf.contextPropagation=false` خاموش کنید؛ SDK در OpenTelemetry بدون هیچ‌یک از این‌ها `traceparent` را در فضای کاربر منتشر می‌کند.",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "هر `oneuptime.labels.<key>=<value>` روی خوشه، و روی سرویس‌ها و میزبان‌هایی که گزارش می‌کند، به برچسب `<key>:<value>` تبدیل می‌شود. برچسب‌ها بدون حساسیت به بزرگی و کوچکی حروف مقایسه می‌شوند، پس برچسب موجود `Production` دوباره به کار می‌رود؛ برچسب‌هایی که در رابط کاربری OneUptime افزوده شده‌اند هرگز به دست عامل حذف نمی‌شوند.",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "به آخرین chart **ارتقا** دهید. `--reset-then-reuse-values` (Helm 3.14+) مقدارهایی را که تنظیم کرده‌اید (پیش‌تنظیم، نام خوشه، فیلترها) نگه می‌دارد و بقیه را از chart تازه می‌گیرد؛ هر پرچم `--set` تازه را روی آن اضافه کنید:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "در Helm 3.13 و پیش از آن، به‌جایش با مقدارهایی که تنظیم کرده‌اید ارتقا دهید:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "از `--reuse-values` استفاده نکنید: این گزینه پیش‌فرض‌های chart مبدأ را هم نگه می‌دارد، پس پیش‌فرض‌های chart جدیدتر (از جمله ایمیج eBPF آن) هرگز اعمال نمی‌شوند.",
  "**Uninstall** the agent and its namespace:":
    "عامل و فضای نام آن را **حذف نصب** کنید:",
  "| Category | Data |": "| دسته | داده |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **متریک‌های گره** | مصرف CPU، حافظه، سامانه پرونده و شبکه |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **متریک‌های پاد و کانتینر** | CPU، حافظه، I/O شبکه و راه‌اندازی‌های دوباره |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **متریک‌های خوشه** | وضعیت گره‌ها، منابع قابل تخصیص، تعداد پادها و بارهای کاری |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **رویدادهای Kubernetes** | هشدارها، خطاها و رویدادهای زمان‌بندی |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **لاگ‌های پاد** | stdout/stderr هر کانتینر، خوانده‌شده از هر گره |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **ترِیس‌های برنامه** *(eBPF)* | spanهای HTTP، gRPC و SQL/Redis از هر پاد، بدون SDK یا تغییر کد |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **متریک‌های درخواست و گراف سرویس** *(eBPF)* | نرخ درخواست، خطاها و تأخیر برای هر سرویس، و یال‌های فراخواننده ← فراخوانده برای نقشه سرویس |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **جریان‌های شبکه** *(eBPF)* | شمارنده‌های بایت و بسته TCP/UDP بین پادها |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **هزینه بارهای کاری** *(اختیاری، `cost.enabled=true`)* | هزینه به تفکیک فضای نام، بار کاری و پاد، همراه با ظرفیت بلااستفاده و بهره‌وری |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **هزینه بارهای کاری** *(به‌طور پیش‌فرض روشن)* | هزینه به تفکیک فضای نام، بار کاری و پاد، همراه با ظرفیت بلااستفاده و بهره‌وری، و همچنین به‌صورت متریک‌هایی برای هشدار |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "خوشه شما حجم‌های `hostPath` یا پادهای ممتاز را مسدود می‌کند. این روی **GKE Autopilot** و **EKS Fargate** عادی است: آن سکو را در بالای این راهنما انتخاب کنید و مراحلش را دنبال کنید. اما روی **OpenShift** نصب موفق می‌شود، ولی پادهای گره عامل هرگز شروع نمی‌شوند: **Red Hat OpenShift** را انتخاب کنید.",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "روی هر خوشه دیگری با سیاست سخت‌گیرانه Pod Security، انتشار ناموفق را حذف کنید:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "سپس فرمان نصب را با افزودن `--set preset=gke-autopilot` دوباره اجرا کنید. این پیش‌تنظیم لاگ‌های پاد را به‌جای hostPath از طریق API در Kubernetes می‌خواند، یک زمینه امنیتی سخت‌گیرانه اعمال می‌کند و پادهای ممتاز eBPF و پروفایل‌گیری را کنار می‌گذارد.",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. بررسی کنید که پادهای عامل در حال اجرا باشند: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. لاگ‌های کالکتور را بررسی کنید: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. تأیید کنید که نشانی OneUptime و کلید دریافت داده در فرمان نصب درست هستند.",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. مطمئن شوید که خوشه از طریق شبکه به نمونه OneUptime شما دسترسی دارد.",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. پاد عامل هوش مصنوعی را بررسی کنید: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. لاگ‌های آن را بررسی کنید: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. پادی نیست؟ chart را ارتقا دهید (**ارتقا یا حذف عامل** را در پیشرفته ببینید) و `--set aiAgent.enabled=true` را اضافه کنید.",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. بررسی کنید که نام خوشه یکسان باشد: این راهنما **`my-cluster`** را نصب می‌کند.",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. مجوزهای RBAC عامل را تأیید کنید: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. در لاگ‌های کالکتور دنبال خطاهای صدور بگردید: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **هسته خیلی قدیمی است یا BTF ندارد.** eBPF به Linux 5.8+ با BTF نیاز دارد؛ با `uname -r` روی یک گره بررسی کنید. اگر نمی‌توانید ارتقا دهید، eBPF را با `--set ebpf.enabled=false` خاموش کنید.",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **پادهای ممتاز مسدود شده‌اند.** برخی خوشه‌های بسته آن‌ها را رد می‌کنند. eBPF را خاموش کنید.",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **`debugfs` / `tracefs` روی میزبان در دسترس نیست.** فقط خانواده آمار TCP را خاموش کنید: `--set ebpf.features.tcpStats=false`.",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. بررسی کنید که پادهای eBPF سالم باشند: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. خروجی اشکال‌زدایی OBI را روشن کنید تا مطمئن شوید ترافیک را می‌بیند: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`، سپس `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200` را بخوانید.",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. اگر spanها آنجا دیده می‌شوند ولی در OneUptime نه، لاگ‌های کالکتور را از نظر خطاهای صدور بررسی کنید: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "این فرمان عامل را برای **`k8s-1`** نصب می‌کند: `clusterName` را دقیقاً همان‌طور که هست نگه دارید، وگرنه داده‌ها به‌عنوان یک خوشه تازه ثبت می‌شوند.",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "AWS CLI (`aws`) که به حساب خوشه وارد شده است",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "Google Cloud CLI (`gcloud`) همراه با مؤلفه `gke-gcloud-auth-plugin`",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "Azure CLI (`az`) که به اشتراک خوشه وارد شده است",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 یا جدیدتر، و OpenShift CLI (`oc`) که با دسترسی cluster-admin وارد شده است: نصب، محدودیت‌های زمینه امنیتی می‌سازد",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "کنسول وب فرمان دقیق را همراه با توکن می‌دهد: **Copy login command**، زیر نام کاربری شما. به‌عنوان مدیر خوشه وارد شوید: نصب، محدودیت‌های زمینه امنیتی می‌سازد.",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift` دو محدودیت زمینه امنیتی (SCC) می‌سازد، یکی برای کالکتور گره و یکی برای پادهای eBPF، که هر کدام فقط با حساب سرویس خودش استفاده می‌شود. همه پادهای دیگر زیر `restricted-v2` پیش‌فرض OpenShift و با شناسه کاربری‌ای که OpenShift تعیین می‌کند اجرا می‌شوند.",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "کالکتور و عامل هوش مصنوعی Kubernetes، به‌علاوه یک پاد `-logs` و یک پاد `-ebpf` روی هر گره. پادهای `-logs` و `-ebpf` زیر SCCهایی اجرا می‌شوند که chart برایشان ساخته است: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` هر دو را نشان می‌دهد. وقتی همه `Running` شوند، خوشه خودکار در بخش **Kubernetes** نمایان می‌شود، معمولاً ظرف یکی دو دقیقه.",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "OpenShift پاد را فقط زیر محدودیت زمینه امنیتی (SCC) ای می‌پذیرد که حساب سرویس آن اجازه استفاده‌اش را دارد، و انتشار در هر حال نصب می‌شود، پس پادی که رد شده فقط هرگز نمایان نمی‌شود. دنبال رد شدن بگردید:",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`:** انتشار بدون پیش‌تنظیم openshift نصب شده است، پس chart هیچ SCC نساخته است. `helm get values kubernetes-agent --namespace oneuptime-agent` مقدارهایی را که گرفته است نشان می‌دهد. پیش‌تنظیم را اضافه کنید:",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **SCCها وجود ندارند:** با `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` بررسی کنید. ساختن آن‌ها به دسترسی cluster-admin نیاز دارد، پس نصبی که کس دیگری انجام دهد در همان‌جا شکست می‌خورد.",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`:** سطح Pod Security فضای نام از نیاز پادهای eBPF، که ممتاز اجرا می‌شوند، سخت‌گیرانه‌تر است. برچسب `pod-security.kubernetes.io/enforce=privileged` را به آن بزنید، یا eBPF را با `--set ebpf.enabled=false` خاموش کنید.",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **مدیر خوشه‌تان SCC اضافه نمی‌کند:** از پیش‌تنظیم `openshift-restricted` استفاده کنید. در این حالت chart هیچ SCC نمی‌سازد و همه پادها زیر `restricted-v2` اجرا می‌شوند، پس لاگ‌های پاد از طریق API در Kubernetes می‌آیند و متریک میزبان، ترِیس eBPF یا پروفایلی در کار نیست:",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot` لاگ‌های پاد را به‌جای خواندن از هر گره، از طریق API در Kubernetes جمع‌آوری می‌کند و ترِیس‌گیری و پروفایل‌گیری eBPF را کنار می‌گذارد، چون به پادهای ممتازی نیاز دارند که GKE Autopilot اجازه نمی‌دهد.",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "کالکتور، عامل هوش مصنوعی Kubernetes و خواننده لاگ پاد، به‌علاوه یک کالکتور گره برای هر گره برای متریک‌های kubelet. وقتی همه `Running` شوند، خوشه خودکار در بخش **Kubernetes** نمایان می‌شود، معمولاً ظرف یکی دو دقیقه.",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "روی خوشه‌های دیگر، عامل روی هر گره [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) را اجرا می‌کند تا بدون تغییر کد ترِیس‌های HTTP، gRPC و SQL را بگیرد. بارگذاری برنامه‌های eBPF به پادهای ممتاز نیاز دارد که این سکو اجازه نمی‌دهد، پس پیش‌تنظیم این سکو آن را کنار می‌گذارد، و پروفایلر پیوسته را هم همراهش.",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "برای گرفتن ترِیس در اینجا، سرویس‌هایتان را با یک [SDK در OpenTelemetry](/docs/telemetry/open-telemetry) ابزارگذاری کنید و ترِیس‌ها را مستقیم به OneUptime بفرستید.",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **لاگ‌های پاد** | stdout/stderr هر کانتینر، خوانده‌شده از طریق API در Kubernetes |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "Autopilot جلوی hostPath را می‌گیرد، پس متریک‌های گره که `/proc` و `/sys` میزبان را می‌خوانند (I/O دیسک، inodeها، خطاهای کارت شبکه) جمع‌آوری نمی‌شوند؛ متریک‌های kubelet و cAdvisor جمع‌آوری می‌شوند.",
  "Pod logs are read through the Kubernetes API on this platform.":
    "روی این سکو لاگ‌های پاد از طریق API در Kubernetes خوانده می‌شوند.",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. بررسی کنید که خواننده لاگ آماده باشد: `kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. نقطه پایانی `/healthz` آن تعداد جریان‌های فعال لاگ و آخرین خطای صدور را گزارش می‌دهد.",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. روی خوشه‌های خیلی بزرگ ممکن است یک خواننده عقب بیفتد: فضاهای نام را با `namespaceFilters` میان انتشارهای جداگانه تقسیم کنید.",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "AWS CLI (`aws`) و `eksctl` که به حساب خوشه وارد شده‌اند",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "روی Fargate، پادها فقط در فضاهای نامی اجرا می‌شوند که یک پروفایل Fargate انتخاب کند. یکی برای `oneuptime-agent` بسازید: بدون آن پادهای عامل در `Pending` می‌مانند:",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate` لاگ‌های پاد را به‌جای خواندن از هر گره، از طریق API در Kubernetes جمع‌آوری می‌کند و ترِیس‌گیری و پروفایل‌گیری eBPF را کنار می‌گذارد، چون به پادهای ممتازی نیاز دارند که EKS Fargate اجازه نمی‌دهد.",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "سه Deployment: کالکتور، عامل هوش مصنوعی Kubernetes و خواننده لاگ پاد. Fargate هرگز DaemonSet زمان‌بندی نمی‌کند، پس پادی برای هر گره وجود ندارد. وقتی همه `Running` شوند، خوشه خودکار در بخش **Kubernetes** نمایان می‌شود، معمولاً ظرف یکی دو دقیقه.",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "سپس پروفایل Fargate را حذف کنید: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "Fargate هرگز DaemonSet زمان‌بندی نمی‌کند، پس متریک‌های گره، پاد و کانتینر آنجا در دسترس نیستند.",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "Fargate پادها را فقط در فضاهای نامی زمان‌بندی می‌کند که یک پروفایل Fargate انتخاب کند. بررسی کنید که برای `oneuptime-agent` یکی وجود داشته باشد:",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "اگر وجود ندارد، آن را بسازید. Fargate هنگام ساخته شدن پاد انتخاب می‌شود، پس پادهایی که از قبل در انتظار بودند همچنان در انتظار می‌مانند: وقتی پروفایل فعال شد، Deploymentهای عامل را دوباره راه بیندازید:",
};

export default TRANSLATION;
