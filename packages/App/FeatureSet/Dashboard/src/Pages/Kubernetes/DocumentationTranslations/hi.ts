import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The Kubernetes setup guide in Hindi (#8341): each piece of the English
 * guide's markdown (Pages/Kubernetes/Utils/DocumentationMarkdown.ts) and its
 * Hindi. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Hindi words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A Kubernetes cluster running v1.23 or later":
    "v1.23 या नए संस्करण पर चलने वाला Kubernetes क्लस्टर",
  "`kubectl` and `helm` (v3) installed on your machine":
    "आपकी मशीन पर इंस्टॉल किए गए `kubectl` और `helm` (v3)",
  "Wrong cluster? Switch with `kubectl config use-context <context-name>`.":
    "ग़लत क्लस्टर? `kubectl config use-context <context-name>` से बदलें।",
  "Replace `my-cluster` with a name for this cluster, such as `prod-us-east-1`. It is how the cluster appears in OneUptime, so keep it stable: a new name registers a new cluster.":
    "`my-cluster` को इस क्लस्टर के किसी नाम से बदलें, जैसे `prod-us-east-1`। OneUptime में क्लस्टर इसी नाम से दिखता है, इसलिए इसे स्थिर रखें: नया नाम एक नया क्लस्टर रजिस्टर करता है।",
  "`--set aiAgent.enabled=true` turns **AI investigations** on, as the chart does by default: OneUptime AI investigates incidents and alerts on this cluster with read-only kubectl, through the Kubernetes AI agent.":
    "`--set aiAgent.enabled=true` **एआई जाँच** चालू करता है, जैसा chart डिफ़ॉल्ट रूप से करता है: OneUptime AI, Kubernetes AI एजेंट के ज़रिए केवल-पढ़ने वाले kubectl से इस क्लस्टर की घटनाओं और अलर्ट की जाँच करता है।",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "`<YOUR_API_KEY>` भरने के लिए चरण 1 में एक इंजेशन कुंजी चुनें।",
  "You should see:": "आपको यह दिखना चाहिए:",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "कलेक्टर और Kubernetes AI एजेंट, साथ ही हर नोड पर एक `-logs` और एक `-ebpf` पॉड। उनके `Running` होते ही क्लस्टर अपने-आप **Kubernetes** सेक्शन में दिखता है, आमतौर पर एक-दो मिनट के भीतर।",
  "**Kubernetes AI agent (on by default, read-only).** The `kubernetes-agent-ai-agent` pod lets OneUptime AI investigate incidents and alerts on this cluster with read-only kubectl — `get`, `describe`, `logs`, `events`, `top` — using the same API key, and it can change nothing unless you give it write access later. Open the cluster and go to **AI → Agent** to see it. Don't want it? Install with `--set aiAgent.enabled=false` instead of `--set aiAgent.enabled=true`.":
    "**Kubernetes AI एजेंट (डिफ़ॉल्ट रूप से चालू, केवल-पढ़ने वाला)।** `kubernetes-agent-ai-agent` पॉड उसी API कुंजी से OneUptime AI को केवल-पढ़ने वाले kubectl (`get`, `describe`, `logs`, `events`, `top`) से इस क्लस्टर की घटनाओं और अलर्ट की जाँच करने देता है, और जब तक आप बाद में उसे लिखने की अनुमति न दें, वह कुछ नहीं बदल सकता। उसे देखने के लिए क्लस्टर खोलें और **एआई → एजेंट** पर जाएँ। इसकी ज़रूरत नहीं? `--set aiAgent.enabled=true` के बजाय `--set aiAgent.enabled=false` के साथ इंस्टॉल करें।",
  "Namespace rules decide what the agent collects from each namespace. To collect pod logs and eBPF data only from `default`, `production` and `staging`:":
    "नेमस्पेस नियम तय करते हैं कि एजेंट हर नेमस्पेस से क्या इकट्ठा करे। सिर्फ़ `default`, `production` और `staging` से पॉड लॉग और eBPF डेटा इकट्ठा करने के लिए:",
  "To keep everything but stop the logs of noisy namespaces, exclude them from `podLogs` only:":
    "सब कुछ रखते हुए शोर वाले नेमस्पेस के लॉग रोकने के लिए, उन्हें सिर्फ़ `podLogs` से बाहर करें:",
  "- **Scopes:** `podLogs` (container stdout/stderr), `ebpfDiscovery` (eBPF traces and metrics), `metrics` (namespaced metrics) and `traces` (every span).":
    "- **दायरे:** `podLogs` (कंटेनर का stdout/stderr), `ebpfDiscovery` (eBPF ट्रेस और मेट्रिक्स), `metrics` (नेमस्पेस वाले मेट्रिक्स) और `traces` (हर span)।",
  "- **Patterns** match the whole namespace name and accept `*`, as in `team-*`. An `exclude` rule always wins over an `include` rule.":
    "- **पैटर्न** पूरे नेमस्पेस नाम से मेल खाते हैं और `*` स्वीकार करते हैं, जैसे `team-*` में। `exclude` नियम हमेशा `include` नियम पर भारी पड़ता है।",
  "- **Setting the rules replaces the default one**, which excludes `kube-system` from `podLogs` and `ebpfDiscovery`. Keep it in your list, as in the second example, if you still want that.":
    "- **नियम सेट करने से डिफ़ॉल्ट नियम बदल जाता है**, जो `kube-system` को `podLogs` और `ebpfDiscovery` से बाहर रखता है। अगर आपको अब भी वह चाहिए, तो उसे दूसरे उदाहरण की तरह अपनी सूची में रखें।",
  "- Node and cluster metrics have no namespace, so they are always kept.":
    "- नोड और क्लस्टर मेट्रिक्स का कोई नेमस्पेस नहीं होता, इसलिए वे हमेशा रखे जाते हैं।",
  "- `--set-json` needs Helm 3.10 or later.":
    "- `--set-json` के लिए Helm 3.10 या नया ज़रूरी है।",
  "**Only send important lines.** Drop pod log lines below a severity before they leave the cluster:":
    "**सिर्फ़ ज़रूरी पंक्तियाँ भेजें।** क्लस्टर से निकलने से पहले, किसी गंभीरता से कम की पॉड लॉग पंक्तियाँ छोड़ दें:",
  'Accepts `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` and `FATAL`: `WARN` keeps warnings, errors and fatal lines. The severity is read from the log line itself (`[ERROR]`, `level=warn`, `"level":"info"`). Kubernetes events are never dropped by this.':
    '`TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` और `FATAL` स्वीकार करता है: `WARN` चेतावनियाँ, त्रुटियाँ और घातक पंक्तियाँ रखता है। गंभीरता लॉग पंक्ति से ही पढ़ी जाती है (`[ERROR]`, `level=warn`, `"level":"info"`)। इससे Kubernetes इवेंट कभी नहीं छोड़े जाते।',
  "**Turn pod logs off.** Metrics are not affected — the node collector keeps running for kubelet and cAdvisor metrics, it just stops reading pod logs:":
    "**पॉड लॉग बंद करें।** मेट्रिक्स पर असर नहीं पड़ता: नोड कलेक्टर kubelet और cAdvisor मेट्रिक्स के लिए चलता रहता है, बस पॉड लॉग पढ़ना बंद कर देता है:",
  "**Change how logs are read.** The preset picks this for you; an explicit `logs.mode` always wins over it:":
    "**लॉग पढ़ने का तरीका बदलें।** प्रीसेट यह आपके लिए चुनता है; स्पष्ट रूप से दिया गया `logs.mode` हमेशा उस पर भारी पड़ता है:",
  "- `logs.mode=daemonset` — reads `/var/log/pods` on every node through hostPath (lowest overhead; needs hostPath).":
    "- `logs.mode=daemonset`: हर नोड पर hostPath के ज़रिए `/var/log/pods` पढ़ता है (सबसे कम ओवरहेड; hostPath ज़रूरी)।",
  "- `logs.mode=api` — a Deployment tails pod logs through the Kubernetes API (works on any cluster).":
    "- `logs.mode=api`: एक Deployment, Kubernetes API के ज़रिए पॉड लॉग फ़ॉलो करता है (किसी भी क्लस्टर पर काम करता है)।",
  "- `logs.mode=disabled` — no pod logs.":
    "- `logs.mode=disabled`: कोई पॉड लॉग नहीं।",
  "That reads the API server, where it answers inside the cluster. etcd, the scheduler and the controller manager answer on the control-plane nodes, which the agent's pod cannot guess, so it reads them once you list each node's address:":
    "यह API सर्वर को पढ़ता है, जहाँ वह क्लस्टर के भीतर जवाब देता है। etcd, शेड्यूलर और कंट्रोलर मैनेजर कंट्रोल प्लेन नोड पर जवाब देते हैं, जिनका अनुमान एजेंट का पॉड नहीं लगा सकता, इसलिए आप हर नोड का पता दे दें, तो वह उन्हें पढ़ता है:",
  "- **The scheduler and the controller manager** serve HTTPS and accept the agent's token, but kubeadm binds them to `127.0.0.1`: give them a `--bind-address` the agent's pod can reach.":
    "- **शेड्यूलर और कंट्रोलर मैनेजर** HTTPS देते हैं और एजेंट का टोकन स्वीकार करते हैं, लेकिन kubeadm उन्हें `127.0.0.1` से बाँध देता है: उन्हें एक ऐसा `--bind-address` दें जिस तक एजेंट का पॉड पहुँच सके।",
  "- **etcd** serves its metrics in plain HTTP on kubeadm's `--listen-metrics-urls` (port 2381, bound to `127.0.0.1` until you add the node's address), as above. Or scrape its HTTPS client port, 2379, with the client certificate it asks for: put `ca.crt`, `tls.crt` and `tls.key` in a Secret in `oneuptime-agent` and name it in `controlPlane.etcd.clientCertSecret`.":
    "- **etcd** ऊपर बताए अनुसार kubeadm के `--listen-metrics-urls` (पोर्ट 2381, नोड का पता जोड़ने तक `127.0.0.1` से बँधा) पर सादे HTTP में अपने मेट्रिक्स देता है। या उसके HTTPS क्लाइंट पोर्ट 2379 को उस क्लाइंट सर्टिफ़िकेट से स्क्रैप करें जो वह माँगता है: `ca.crt`, `tls.crt` और `tls.key` को `oneuptime-agent` के एक Secret में रखें और `controlPlane.etcd.clientCertSecret` में उसका नाम दें।",
  "Only for self-managed clusters: managed services (EKS, GKE, AKS) do not expose their control plane metrics.":
    "सिर्फ़ सेल्फ़-मैनेज्ड क्लस्टर के लिए: मैनेज्ड सर्विस (EKS, GKE, AKS) अपने कंट्रोल प्लेन के मेट्रिक्स नहीं दिखातीं।",
  "Cost monitoring is on by default: the agent bundles the open-source OpenCost engine (plus the small Prometheus it needs), prices your nodes and volumes from your cloud provider's public list prices — no credentials required — and sends what each namespace and workload costs. The first data appears on the cluster's overview and Costs page after the first full hour.":
    "लागत निगरानी डिफ़ॉल्ट रूप से चालू है: एजेंट में ओपन-सोर्स OpenCost इंजन (और उसे चाहिए छोटा Prometheus) शामिल है, यह आपके क्लाउड प्रोवाइडर की सार्वजनिक सूची-कीमतों से आपके नोड और वॉल्यूम की क़ीमत तय करता है, किसी क्रेडेंशियल के बिना, और भेजता है कि हर नेमस्पेस और वर्कलोड की लागत कितनी है। पहला पूरा घंटा बीतने के बाद पहला डेटा क्लस्टर के अवलोकन और लागत पेज पर दिखता है।",
  "On an agent installed before it was on by default, upgrade it:":
    "जो एजेंट इसके डिफ़ॉल्ट रूप से चालू होने से पहले इंस्टॉल हुआ था, उसे अपग्रेड करें:",
  "- **Turn it off:** add `--set cost.enabled=false` to the same upgrade.":
    "- **इसे बंद करें:** उसी अपग्रेड में `--set cost.enabled=false` जोड़ें।",
  "Cost monitoring is off by default on this platform: it bills every pod by what it requests, so the three cost pods would add to your bill, and OpenCost prices nodes rather than pods. To turn it on anyway:":
    "इस प्लेटफ़ॉर्म पर लागत निगरानी डिफ़ॉल्ट रूप से बंद है: यह हर पॉड का बिल उसके request के हिसाब से बनाता है, इसलिए तीन लागत पॉड आपका बिल बढ़ा देते, और OpenCost पॉड की नहीं, नोड की क़ीमत तय करता है। फिर भी इसे चालू करने के लिए:",
  "That alone is a complete install: the chart bundles the open-source OpenCost engine (plus the small Prometheus it needs) and prices your nodes and volumes from your cloud provider's public list prices — no credentials required. It adds three small pods; the first data appears after the first full hour.":
    "बस इतना ही एक पूरा इंस्टॉल है: chart में ओपन-सोर्स OpenCost इंजन (और उसे चाहिए छोटा Prometheus) शामिल है और यह आपके क्लाउड प्रोवाइडर की सार्वजनिक सूची-कीमतों से आपके नोड और वॉल्यूम की क़ीमत तय करता है, किसी क्रेडेंशियल के बिना। यह तीन छोटे पॉड जोड़ता है; पहला पूरा घंटा बीतने के बाद पहला डेटा दिखता है।",
  "- **Already running Kubecost or OpenCost?** Point the agent at it instead, and nothing is bundled: add `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (or your Kubecost service).":
    "- **पहले से Kubecost या OpenCost चला रहे हैं?** इसके बजाय एजेंट को उसकी ओर इंगित करें, फिर कुछ भी साथ में नहीं जोड़ा जाता: `--set cost.engine.url=http://opencost.opencost.svc.cluster.local:9003` (या अपनी Kubecost सर्विस) जोड़ें।",
  "- **On-prem or bare metal?** Set a rate card with `--set cost.opencost.customPricing.enabled=true` (USD per resource-hour — see the chart's `values.yaml`).":
    "- **ऑन-प्रेम या बेयर मेटल?** `--set cost.opencost.customPricing.enabled=true` से एक रेट कार्ड सेट करें (प्रति रिसोर्स-घंटा USD; chart का `values.yaml` देखें)।",
  "Full guide: [Kubernetes Cost Observability](/docs/telemetry/kubernetes-cost).":
    "पूरी गाइड: [Kubernetes लागत ऑब्ज़र्वेबिलिटी](/docs/telemetry/kubernetes-cost)।",
  "The agent runs [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) on every node. It captures HTTP/HTTPS, gRPC and SQL/Redis traffic from Go, .NET, Java, Node.js, Python, Ruby and Rust services — no SDK and no sidecar — and ships traces, request (RED) metrics and service-graph data through the collector.":
    "एजेंट हर नोड पर [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) चलाता है। यह Go, .NET, Java, Node.js, Python, Ruby और Rust सर्विस का HTTP/HTTPS, gRPC और SQL/Redis ट्रैफ़िक बिना SDK और बिना sidecar के पकड़ता है, और कलेक्टर के ज़रिए ट्रेस, रिक्वेस्ट (RED) मेट्रिक्स और सर्विस-ग्राफ़ डेटा भेजता है।",
  "**Requirements:** Linux kernel **5.8+** with BTF (the default on Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+). The eBPF pods run **privileged**, which they need to load eBPF programs.":
    "**आवश्यकताएं:** BTF के साथ Linux कर्नेल **5.8+** (Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL 9+ पर डिफ़ॉल्ट)। eBPF पॉड **विशेषाधिकार** के साथ चलते हैं, जो उन्हें eBPF प्रोग्राम लोड करने के लिए चाहिए।",
  "**Turn it off** if your nodes run an older kernel, if privileged pods are not allowed, or if your services already send traces with OpenTelemetry SDKs and you don't want duplicates:":
    "अगर आपके नोड पुराना कर्नेल चलाते हैं, विशेषाधिकार वाले पॉड की अनुमति नहीं है, या आपकी सर्विस पहले से OpenTelemetry SDK से ट्रेस भेजती हैं और आप डुप्लिकेट नहीं चाहते, तो **इसे बंद करें**:",
  "**Choose the signals.** Each family is switched with `--set ebpf.features.<name>=false` (or `=true`):":
    "**सिग्नल चुनें।** हर परिवार `--set ebpf.features.<name>=false` (या `=true`) से चालू या बंद होता है:",
  "| `ebpf.features.*` | Default | What it adds |":
    "| `ebpf.features.*` | डिफ़ॉल्ट | यह क्या जोड़ता है |",
  "| `httpMetrics` | on | HTTP/gRPC request rate, errors and latency per service |":
    "| `httpMetrics` | चालू | हर सर्विस के लिए HTTP/gRPC रिक्वेस्ट दर, त्रुटियाँ और लेटेंसी |",
  "| `spanMetrics` | on | Span call count and duration (`traces.span.metrics.*`) |":
    "| `spanMetrics` | चालू | span की कॉल गिनती और अवधि (`traces.span.metrics.*`) |",
  "| `serviceGraph` | on | Caller → callee edges; drives the service map |":
    "| `serviceGraph` | चालू | कॉलर → कॉली के किनारे; सर्विस मैप बनाते हैं |",
  "| `networkMetrics` | on | Pod-to-pod TCP/UDP flow counters |":
    "| `networkMetrics` | चालू | पॉड-से-पॉड TCP/UDP फ़्लो काउंटर |",
  "| `networkInterZoneMetrics` | off | Inter-zone network metrics (doubles their cardinality) |":
    "| `networkInterZoneMetrics` | बंद | ज़ोन के बीच के नेटवर्क मेट्रिक्स (उनकी कार्डिनैलिटी दोगुनी कर देता है) |",
  "| `tcpStats` | on | Node-level TCP RTT, failed-connection and retransmit counters |":
    "| `tcpStats` | चालू | नोड-स्तर का TCP RTT, विफल कनेक्शन और पुनर्प्रेषण काउंटर |",
  "**Cross-service trace propagation** — linking a request that crosses pod A → pod B into a single trace, on another node too — is **on by default**. It works by rewriting traffic that is already in flight (widening plaintext HTTP requests in the kernel, and appending a TCP option to TLS and raw TCP), and a mistake in that byte accounting desynchronizes the stream — the reported symptom is transfers through an L7 proxy such as nginx hanging once a response passes ~64KB. If you see that, or a service mesh starts failing pods, turn it off with `--set ebpf.contextPropagation=false`; an OpenTelemetry SDK propagates `traceparent` in userspace without any of that.":
    "**सर्विसों के बीच ट्रेस का प्रसार** (पॉड A → पॉड B तक जाने वाली रिक्वेस्ट को एक ही ट्रेस में जोड़ना, दूसरे नोड पर भी) **डिफ़ॉल्ट रूप से चालू** है। यह पहले से चल रहे ट्रैफ़िक को फिर से लिखकर काम करता है (कर्नेल में सादे HTTP रिक्वेस्ट को फैलाकर, और TLS व कच्चे TCP में एक TCP विकल्प जोड़कर), और इस बाइट गिनती में कोई ग़लती स्ट्रीम को असमकालिक कर देती है: बताया गया लक्षण यह है कि nginx जैसे L7 प्रॉक्सी से होने वाले ट्रांसफ़र, जवाब ~64KB पार करते ही अटक जाते हैं। अगर आपको यह दिखे, या कोई सर्विस मेश पॉड को विफल करने लगे, तो इसे `--set ebpf.contextPropagation=false` से बंद करें; OpenTelemetry SDK इनमें से कुछ भी किए बिना यूज़रस्पेस में `traceparent` का प्रसार करता है।",
  "Each `oneuptime.labels.<key>=<value>` becomes the label `<key>:<value>` on the cluster, and on the services and hosts it reports. Labels are matched case-insensitively, so an existing `Production` label is reused; labels added in the OneUptime UI are never removed by the agent.":
    "हर `oneuptime.labels.<key>=<value>` क्लस्टर पर, और उसकी रिपोर्ट की गई सर्विस और होस्ट पर, लेबल `<key>:<value>` बन जाता है। लेबल बड़े-छोटे अक्षरों का भेद किए बिना मिलाए जाते हैं, इसलिए मौजूदा `Production` लेबल फिर से इस्तेमाल होता है; OneUptime इंटरफ़ेस में जोड़े गए लेबल एजेंट कभी नहीं हटाता।",
  "**Upgrade** to the latest chart. `--reset-then-reuse-values` (Helm 3.14+) keeps the values you set (preset, cluster name, filters) and takes everything else from the new chart; add any new `--set` flags on top of it:":
    "नवीनतम chart पर **अपग्रेड करें**। `--reset-then-reuse-values` (Helm 3.14+) आपके सेट किए मान (प्रीसेट, क्लस्टर का नाम, फ़िल्टर) रखता है और बाकी सब नए chart से लेता है; इसके ऊपर कोई भी नए `--set` फ़्लैग जोड़ें:",
  "On Helm 3.13 and earlier, upgrade with the values you set instead:":
    "Helm 3.13 और पुराने पर, इसके बजाय अपने सेट किए मानों के साथ अपग्रेड करें:",
  "Don't use `--reuse-values`: it also keeps the defaults of the chart you upgrade from, so a newer chart's defaults (its eBPF image among them) never apply.":
    "`--reuse-values` का इस्तेमाल न करें: यह उस chart के डिफ़ॉल्ट भी रखता है जिससे आप अपग्रेड करते हैं, इसलिए नए chart के डिफ़ॉल्ट (उनमें उसकी eBPF इमेज भी) कभी लागू नहीं होते।",
  "**Uninstall** the agent and its namespace:":
    "एजेंट और उसके नेमस्पेस को **अनइंस्टॉल करें**:",
  "| Category | Data |": "| श्रेणी | डेटा |",
  "| **Node metrics** | CPU, memory, filesystem and network usage |":
    "| **नोड मेट्रिक्स** | CPU, मेमोरी, फ़ाइल सिस्टम और नेटवर्क का उपयोग |",
  "| **Pod and container metrics** | CPU, memory, network I/O and restarts |":
    "| **पॉड और कंटेनर मेट्रिक्स** | CPU, मेमोरी, नेटवर्क I/O और रीस्टार्ट |",
  "| **Cluster metrics** | Node conditions, allocatable resources, pod and workload counts |":
    "| **क्लस्टर मेट्रिक्स** | नोड की स्थितियाँ, आवंटन योग्य रिसोर्स, पॉड और वर्कलोड की गिनती |",
  "| **Kubernetes events** | Warnings, errors and scheduling events |":
    "| **Kubernetes इवेंट** | चेतावनियाँ, त्रुटियाँ और शेड्यूलिंग इवेंट |",
  "| **Pod logs** | stdout/stderr of every container, read from each node |":
    "| **पॉड लॉग** | हर कंटेनर का stdout/stderr, हर नोड से पढ़ा गया |",
  "| **Application traces** *(eBPF)* | HTTP, gRPC and SQL/Redis spans from every pod — no SDK or code changes |":
    "| **ऐप्लिकेशन ट्रेस** *(eBPF)* | हर पॉड से HTTP, gRPC और SQL/Redis span, बिना SDK या कोड बदलाव के |",
  "| **Request metrics and service graph** *(eBPF)* | Request rate, errors and latency per service, and caller → callee edges for the service map |":
    "| **रिक्वेस्ट मेट्रिक्स और सर्विस ग्राफ़** *(eBPF)* | हर सर्विस के लिए रिक्वेस्ट दर, त्रुटियाँ और लेटेंसी, और सर्विस मैप के लिए कॉलर → कॉली के किनारे |",
  "| **Network flows** *(eBPF)* | Pod-to-pod TCP/UDP byte and packet counters |":
    "| **नेटवर्क फ़्लो** *(eBPF)* | पॉड-से-पॉड TCP/UDP बाइट और पैकेट काउंटर |",
  "| **Workload costs** *(opt-in, `cost.enabled=true`)* | Spend per namespace, workload and pod, with idle capacity and efficiency |":
    "| **वर्कलोड लागत** *(वैकल्पिक, `cost.enabled=true`)* | हर नेमस्पेस, वर्कलोड और पॉड का ख़र्च, खाली क्षमता और दक्षता के साथ |",
  "| **Workload costs** *(on by default)* | Spend per namespace, workload and pod, with idle capacity and efficiency, also as metrics to alert on |":
    "| **वर्कलोड लागत** *(डिफ़ॉल्ट रूप से चालू)* | हर नेमस्पेस, वर्कलोड और पॉड का ख़र्च, खाली क्षमता और दक्षता के साथ, अलर्ट के लिए मेट्रिक्स के रूप में भी |",
  "Your cluster blocks `hostPath` volumes or privileged pods. That is normal on **GKE Autopilot** and **EKS Fargate** — pick that platform at the top of this guide and follow its steps. On **OpenShift** the install succeeds instead, but the agent's node pods never start: pick **Red Hat OpenShift**.":
    "आपका क्लस्टर `hostPath` वॉल्यूम या विशेषाधिकार वाले पॉड रोकता है। **GKE Autopilot** और **EKS Fargate** पर यह सामान्य है: इस गाइड में सबसे ऊपर वह प्लेटफ़ॉर्म चुनें और उसके चरणों का पालन करें। इसके उलट **OpenShift** पर इंस्टॉल सफल होता है, लेकिन एजेंट के नोड पॉड कभी शुरू नहीं होते: **Red Hat OpenShift** चुनें।",
  "On any other cluster with a restrictive Pod Security policy, remove the failed release:":
    "प्रतिबंधात्मक Pod Security नीति वाले किसी भी दूसरे क्लस्टर पर विफल रिलीज़ हटाएँ:",
  "Then run the install command again with `--set preset=gke-autopilot` added. That preset reads pod logs through the Kubernetes API instead of hostPath, applies a hardened security context, and leaves out the privileged eBPF and profiling pods.":
    "फिर `--set preset=gke-autopilot` जोड़कर इंस्टॉल कमांड दोबारा चलाएँ। वह प्रीसेट hostPath के बजाय Kubernetes API से पॉड लॉग पढ़ता है, एक सख़्त सुरक्षा संदर्भ लागू करता है, और विशेषाधिकार वाले eBPF और प्रोफ़ाइलिंग पॉड छोड़ देता है।",
  "1. Check that the agent's pods are running: `kubectl get pods -n oneuptime-agent`":
    "1. जाँचें कि एजेंट के पॉड चल रहे हैं: `kubectl get pods -n oneuptime-agent`",
  "2. Check the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "2. कलेक्टर के लॉग जाँचें: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "3. Verify the OneUptime URL and ingestion key in the install command are correct.":
    "3. पुष्टि करें कि इंस्टॉल कमांड में OneUptime URL और इंजेशन कुंजी सही हैं।",
  "4. Make sure the cluster can reach your OneUptime instance over the network.":
    "4. पक्का करें कि क्लस्टर नेटवर्क पर आपके OneUptime इंस्टेंस तक पहुँच सकता है।",
  "1. Check the AI agent's pod: `kubectl get pods -n oneuptime-agent -l component=ai-agent`":
    "1. AI एजेंट का पॉड जाँचें: `kubectl get pods -n oneuptime-agent -l component=ai-agent`",
  "2. Check its logs: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`":
    "2. उसके लॉग जाँचें: `kubectl logs -n oneuptime-agent -l component=ai-agent --tail=100`",
  "3. No pod? Upgrade the chart (see **Upgrade or uninstall the agent** under Advanced) and add `--set aiAgent.enabled=true`.":
    "3. कोई पॉड नहीं? chart को अपग्रेड करें (उन्नत में **एजेंट को अपग्रेड या अनइंस्टॉल करें** देखें) और `--set aiAgent.enabled=true` जोड़ें।",
  "1. Check that the cluster name matches: this guide installs **`my-cluster`**.":
    "1. जाँचें कि क्लस्टर का नाम मेल खाता है: यह गाइड **`my-cluster`** इंस्टॉल करती है।",
  "2. Verify the agent's RBAC permissions: `kubectl get clusterrolebinding | grep kubernetes-agent`":
    "2. एजेंट की RBAC अनुमतियों की पुष्टि करें: `kubectl get clusterrolebinding | grep kubernetes-agent`",
  "3. Look for export errors in the collector's logs: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. कलेक्टर के लॉग में एक्सपोर्ट त्रुटियाँ देखें: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "- **Kernel too old or no BTF.** eBPF needs Linux 5.8+ with BTF — check with `uname -r` on a node. If you can't upgrade, turn eBPF off with `--set ebpf.enabled=false`.":
    "- **कर्नेल बहुत पुराना है या BTF नहीं है।** eBPF को BTF के साथ Linux 5.8+ चाहिए; किसी नोड पर `uname -r` से जाँचें। अगर आप अपग्रेड नहीं कर सकते, तो `--set ebpf.enabled=false` से eBPF बंद करें।",
  "- **Privileged pods blocked.** Some locked-down clusters reject them. Turn eBPF off.":
    "- **विशेषाधिकार वाले पॉड रोके गए।** कुछ कड़े क्लस्टर उन्हें अस्वीकार कर देते हैं। eBPF बंद करें।",
  "- **`debugfs` / `tracefs` not available on the host.** Turn off just the TCP stats family: `--set ebpf.features.tcpStats=false`.":
    "- **होस्ट पर `debugfs` / `tracefs` उपलब्ध नहीं।** सिर्फ़ TCP आँकड़ों का परिवार बंद करें: `--set ebpf.features.tcpStats=false`।",
  "1. Check the eBPF pods are healthy: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`":
    "1. जाँचें कि eBPF पॉड ठीक हैं: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`",
  "2. Turn on OBI's debug output to confirm it sees traffic: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, then read `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200`.":
    "2. यह पुष्टि करने के लिए कि OBI ट्रैफ़िक देखता है, उसका डीबग आउटपुट चालू करें: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, फिर `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200` पढ़ें।",
  "3. If spans show up there but not in OneUptime, check the collector's logs for export errors: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`":
    "3. अगर span वहाँ दिखते हैं लेकिन OneUptime में नहीं, तो कलेक्टर के लॉग में एक्सपोर्ट त्रुटियाँ देखें: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent`",
  "This installs the agent for **`k8s-1`** — keep `clusterName` exactly as it is, or the data registers as a new cluster.":
    "यह **`k8s-1`** के लिए एजेंट इंस्टॉल करता है: `clusterName` को ठीक वैसा ही रहने दें, नहीं तो डेटा एक नए क्लस्टर के रूप में रजिस्टर होगा।",
  "The AWS CLI (`aws`), signed in to the cluster's account":
    "क्लस्टर के खाते में साइन इन किया हुआ AWS CLI (`aws`)",
  "The Google Cloud CLI (`gcloud`) with the `gke-gcloud-auth-plugin` component":
    "`gke-gcloud-auth-plugin` कंपोनेंट के साथ Google Cloud CLI (`gcloud`)",
  "The Azure CLI (`az`), signed in to the cluster's subscription":
    "क्लस्टर की सदस्यता में साइन इन किया हुआ Azure CLI (`az`)",
  "OpenShift 4.11 or later, and the OpenShift CLI (`oc`) logged in with cluster-admin rights: the install creates security context constraints":
    "OpenShift 4.11 या नया, और cluster-admin अधिकारों के साथ लॉग इन किया हुआ OpenShift CLI (`oc`): इंस्टॉल सुरक्षा संदर्भ बाधाएँ बनाता है",
  "The web console gives the exact command, token included: **Copy login command**, under your user name. Log in as a cluster admin: the install creates security context constraints.":
    "वेब कंसोल टोकन समेत सटीक कमांड देता है: आपके यूज़र नेम के नीचे **Copy login command**। क्लस्टर एडमिन के रूप में लॉग इन करें: इंस्टॉल सुरक्षा संदर्भ बाधाएँ बनाता है।",
  "`preset=openshift` creates two security context constraints (SCCs), one for the node collector and one for the eBPF pods, each used only by its own service account. Every other pod runs under OpenShift's default `restricted-v2`, with the user ID OpenShift assigns.":
    "`preset=openshift` दो सुरक्षा संदर्भ बाधाएँ (SCC) बनाता है, एक नोड कलेक्टर के लिए और एक eBPF पॉड के लिए, और हर एक को सिर्फ़ उसका अपना सर्विस अकाउंट इस्तेमाल करता है। बाकी हर पॉड OpenShift के डिफ़ॉल्ट `restricted-v2` के तहत, OpenShift के दिए यूज़र ID के साथ चलता है।",
  "The collector and the Kubernetes AI agent, plus one `-logs` and one `-ebpf` pod on every node. The `-logs` and `-ebpf` pods run under the SCCs the chart created for them: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` lists both. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "कलेक्टर और Kubernetes AI एजेंट, साथ ही हर नोड पर एक `-logs` और एक `-ebpf` पॉड। `-logs` और `-ebpf` पॉड उन SCC के तहत चलते हैं जो chart ने उनके लिए बनाए: `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` दोनों दिखाता है। उनके `Running` होते ही क्लस्टर अपने-आप **Kubernetes** सेक्शन में दिखता है, आमतौर पर एक-दो मिनट के भीतर।",
  "OpenShift admits a pod only under a security context constraint (SCC) its service account may use, and the release installs either way, so a refused pod simply never appears. Look for the refusal:":
    "OpenShift किसी पॉड को सिर्फ़ उसी सुरक्षा संदर्भ बाधा (SCC) के तहत स्वीकार करता है जिसे उसका सर्विस अकाउंट इस्तेमाल कर सकता है, और रिलीज़ हर हाल में इंस्टॉल होता है, इसलिए अस्वीकार किया गया पॉड बस कभी नहीं दिखता। अस्वीकृति खोजें:",
  "- **`unable to validate against any security context constraint`:** the release was installed without the openshift preset, so the chart created no SCCs. `helm get values kubernetes-agent --namespace oneuptime-agent` shows the values it was given. Add the preset:":
    "- **`unable to validate against any security context constraint`:** रिलीज़ openshift प्रीसेट के बिना इंस्टॉल हुआ था, इसलिए chart ने कोई SCC नहीं बनाया। `helm get values kubernetes-agent --namespace oneuptime-agent` वे मान दिखाता है जो उसे दिए गए थे। प्रीसेट जोड़ें:",
  "- **The SCCs are missing:** check with `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf`. Creating them takes cluster-admin rights, so an install by anyone else fails when it gets to them.":
    "- **SCC मौजूद नहीं हैं:** `kubectl get scc kubernetes-agent-node-collector kubernetes-agent-ebpf` से जाँचें। उन्हें बनाने के लिए cluster-admin अधिकार चाहिए, इसलिए किसी और का किया इंस्टॉल वहाँ पहुँचकर विफल हो जाता है।",
  "- **`violates PodSecurity`:** the namespace's Pod Security level is stricter than the eBPF pods, which run privileged, need. Label it `pod-security.kubernetes.io/enforce=privileged`, or turn eBPF off with `--set ebpf.enabled=false`.":
    "- **`violates PodSecurity`:** नेमस्पेस का Pod Security स्तर विशेषाधिकार के साथ चलने वाले eBPF पॉड की ज़रूरत से ज़्यादा सख़्त है। उस पर `pod-security.kubernetes.io/enforce=privileged` लेबल लगाएँ, या `--set ebpf.enabled=false` से eBPF बंद करें।",
  "- **Your cluster admin will not add SCCs:** use the `openshift-restricted` preset. The chart then creates no SCC and every pod runs under `restricted-v2`, so pod logs come through the Kubernetes API, and there are no host metrics, eBPF traces or profiles:":
    "- **आपका क्लस्टर एडमिन SCC नहीं जोड़ेगा:** `openshift-restricted` प्रीसेट इस्तेमाल करें। तब chart कोई SCC नहीं बनाता और हर पॉड `restricted-v2` के तहत चलता है, इसलिए पॉड लॉग Kubernetes API से आते हैं, और होस्ट मेट्रिक्स, eBPF ट्रेस या प्रोफ़ाइल नहीं होते:",
  "`preset=gke-autopilot` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that GKE Autopilot does not allow.":
    "`preset=gke-autopilot` हर नोड से पढ़ने के बजाय Kubernetes API से पॉड लॉग इकट्ठा करता है, और eBPF ट्रेसिंग व प्रोफ़ाइलिंग छोड़ देता है, जिन्हें ऐसे विशेषाधिकार वाले पॉड चाहिए जिनकी GKE Autopilot अनुमति नहीं देता।",
  "The collector, the Kubernetes AI agent and the pod log reader, plus one node collector per node for kubelet metrics. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "कलेक्टर, Kubernetes AI एजेंट और पॉड लॉग रीडर, साथ ही kubelet मेट्रिक्स के लिए हर नोड पर एक नोड कलेक्टर। उनके `Running` होते ही क्लस्टर अपने-आप **Kubernetes** सेक्शन में दिखता है, आमतौर पर एक-दो मिनट के भीतर।",
  "On other clusters the agent runs [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) on every node to capture HTTP, gRPC and SQL traces with no code changes. Loading eBPF programs needs privileged pods, which this platform does not allow, so the platform's preset leaves it out, and the continuous profiler with it.":
    "दूसरे क्लस्टर पर एजेंट हर नोड पर [OpenTelemetry eBPF Instrumentation](https://opentelemetry.io/docs/zero-code/obi/) चलाता है, ताकि बिना कोड बदलाव के HTTP, gRPC और SQL ट्रेस पकड़े जा सकें। eBPF प्रोग्राम लोड करने के लिए विशेषाधिकार वाले पॉड चाहिए, जिनकी यह प्लेटफ़ॉर्म अनुमति नहीं देता, इसलिए प्लेटफ़ॉर्म का प्रीसेट इसे छोड़ देता है, और इसके साथ लगातार चलने वाला प्रोफ़ाइलर भी।",
  "To get traces here, instrument your services with an [OpenTelemetry SDK](/docs/telemetry/open-telemetry) and send them to OneUptime directly.":
    "यहाँ ट्रेस पाने के लिए, अपनी सर्विस को [OpenTelemetry SDK](/docs/telemetry/open-telemetry) से इंस्ट्रुमेंट करें और ट्रेस सीधे OneUptime को भेजें।",
  "| **Pod logs** | stdout/stderr of every container, read through the Kubernetes API |":
    "| **पॉड लॉग** | हर कंटेनर का stdout/stderr, Kubernetes API से पढ़ा गया |",
  "Autopilot blocks hostPath, so node metrics that read the host's `/proc` and `/sys` (disk I/O, inodes, NIC errors) are not collected; kubelet and cAdvisor metrics are.":
    "Autopilot, hostPath को रोकता है, इसलिए होस्ट के `/proc` और `/sys` पढ़ने वाले नोड मेट्रिक्स (डिस्क I/O, inode, NIC त्रुटियाँ) इकट्ठा नहीं होते; kubelet और cAdvisor मेट्रिक्स होते हैं।",
  "Pod logs are read through the Kubernetes API on this platform.":
    "इस प्लेटफ़ॉर्म पर पॉड लॉग Kubernetes API से पढ़े जाते हैं।",
  "1. Check that the log reader is ready: `kubectl get pods -n oneuptime-agent -l component=log-collector`":
    "1. जाँचें कि लॉग रीडर तैयार है: `kubectl get pods -n oneuptime-agent -l component=log-collector`",
  "3. Its `/healthz` endpoint reports the number of active log streams and the last export error.":
    "3. उसका `/healthz` एंडपॉइंट सक्रिय लॉग स्ट्रीम की संख्या और आख़िरी एक्सपोर्ट त्रुटि बताता है।",
  "4. On very large clusters one reader can fall behind — split the namespaces across separate releases with `namespaceFilters`.":
    "4. बहुत बड़े क्लस्टर पर एक रीडर पीछे रह सकता है: `namespaceFilters` से नेमस्पेस को अलग-अलग रिलीज़ में बाँटें।",
  "The AWS CLI (`aws`) and `eksctl`, signed in to the cluster's account":
    "क्लस्टर के खाते में साइन इन किए हुए AWS CLI (`aws`) और `eksctl`",
  "Pods run on Fargate only in namespaces a Fargate profile selects. Create one for `oneuptime-agent` — without it the agent's pods stay `Pending`:":
    "Fargate पर पॉड सिर्फ़ उन नेमस्पेस में चलते हैं जिन्हें कोई Fargate प्रोफ़ाइल चुनती है। `oneuptime-agent` के लिए एक बनाएँ: उसके बिना एजेंट के पॉड `Pending` में रहते हैं:",
  "`preset=eks-fargate` collects pod logs through the Kubernetes API instead of reading them from each node, and leaves out eBPF tracing and profiling, which need privileged pods that EKS Fargate does not allow.":
    "`preset=eks-fargate` हर नोड से पढ़ने के बजाय Kubernetes API से पॉड लॉग इकट्ठा करता है, और eBPF ट्रेसिंग व प्रोफ़ाइलिंग छोड़ देता है, जिन्हें ऐसे विशेषाधिकार वाले पॉड चाहिए जिनकी EKS Fargate अनुमति नहीं देता।",
  "Three Deployments — the collector, the Kubernetes AI agent and the pod log reader. Fargate never schedules DaemonSets, so there are no per-node pods. Once they are `Running`, the cluster appears automatically in the **Kubernetes** section — usually within a minute or two.":
    "तीन Deployment: कलेक्टर, Kubernetes AI एजेंट और पॉड लॉग रीडर। Fargate कभी DaemonSet शेड्यूल नहीं करता, इसलिए हर नोड पर कोई पॉड नहीं होता। उनके `Running` होते ही क्लस्टर अपने-आप **Kubernetes** सेक्शन में दिखता है, आमतौर पर एक-दो मिनट के भीतर।",
  "Then remove the Fargate profile: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`.":
    "फिर Fargate प्रोफ़ाइल हटाएँ: `eksctl delete fargateprofile --cluster <cluster-name> --name oneuptime-agent`।",
  "Fargate never schedules DaemonSets, so node, pod and container metrics are not available there.":
    "Fargate कभी DaemonSet शेड्यूल नहीं करता, इसलिए वहाँ नोड, पॉड और कंटेनर मेट्रिक्स उपलब्ध नहीं हैं।",
  "Fargate only schedules pods in namespaces that a Fargate profile selects. Check that one exists for `oneuptime-agent`:":
    "Fargate सिर्फ़ उन नेमस्पेस में पॉड शेड्यूल करता है जिन्हें कोई Fargate प्रोफ़ाइल चुनती है। जाँचें कि `oneuptime-agent` के लिए एक मौजूद है:",
  "If there is none, create it. Fargate is chosen when a pod is created, so pods that were already pending stay pending — restart the agent's Deployments once the profile is active:":
    "अगर कोई नहीं है, तो उसे बनाएँ। Fargate पॉड बनाते समय चुना जाता है, इसलिए जो पॉड पहले से रुके थे वे रुके ही रहते हैं: प्रोफ़ाइल सक्रिय होने पर एजेंट के Deployment रीस्टार्ट करें:",
};

export default TRANSLATION;
