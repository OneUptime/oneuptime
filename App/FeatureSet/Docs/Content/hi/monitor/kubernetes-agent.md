# Kubernetes एजेंट इंस्टॉल करें

OneUptime Kubernetes एजेंट आपके Kubernetes क्लस्टर से क्लस्टर मेट्रिक्स, ईवेंट्स, पॉड लॉग्स, **एप्लिकेशन ट्रेस (eBPF के माध्यम से HTTP/gRPC)**, **निरंतर CPU फ्लेम ग्राफ़ (eBPF प्रोफाइलर)**, और **OS-स्तर के नोड मेट्रिक्स** एकत्र करता है और उन्हें OneUptime में भेजता है। यह एक Helm chart के रूप में वितरित किया जाता है और एक ही कमांड से इंस्टॉल किया जाता है — eBPF ऑटो-इंस्ट्रुमेंटेशन और प्रोफाइलिंग दोनों डिफ़ॉल्ट रूप से चालू होते हैं, इसलिए आप बिना किसी कोड परिवर्तन के सर्विस-स्तर के ट्रेस, RED मेट्रिक्स, और फ्लेम ग्राफ़ देख सकते हैं।

## त्वरित प्रारंभ

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update

helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<A_UNIQUE_NAME_FOR_THIS_CLUSTER>
```

आपका क्लस्टर कुछ ही मिनटों में OneUptime में दिखाई देगा।

## अपने क्लस्टर के लिए सही प्रीसेट चुनें

विभिन्न Kubernetes डिस्ट्रिब्यूशन की अलग-अलग बाधाएँ होती हैं — सबसे महत्वपूर्ण यह है कि क्या वर्कलोड `hostPath` वॉल्यूम माउंट कर सकते हैं। आपको सुरक्षा दस्तावेज़ पढ़ने के बजाय, chart एक एकल शीर्ष-स्तरीय विकल्प प्रदान करता है: `preset`।

| Preset | किसके लिए उपयोग करें | लॉग संग्रहण | टिप्पणी |
| --- | --- | --- | --- |
| `standard` (डिफ़ॉल्ट) | सेल्फ-मैनेज्ड, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | hostPath के माध्यम से `/var/log/pods` पढ़ने वाला DaemonSet | सबसे कम ओवरहेड। इन प्लेटफ़ॉर्म पर hostPath उपलब्ध है। |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API टेलर (Deployment) | Autopilot पर hostPath ब्लॉक है। एक हार्डन्ड सिक्योरिटी कॉन्टेक्स्ट सेट करता है जो Autopilot के Pod Security Standards को पास करता है। |
| `eks-fargate` | **EKS Fargate** | Kubernetes API टेलर (Deployment) | `gke-autopilot` के समान। Fargate hostPath और DaemonSets को ब्लॉक करता है। |

यदि आप सुनिश्चित नहीं हैं, तो `preset` को अनसेट छोड़ दें — आपको `standard` डिफ़ॉल्ट मिलेंगे। यदि आपका क्लस्टर `hostPath` का उल्लेख करने वाली Pod Security पॉलिसी एरर के साथ इंस्टॉल को अस्वीकार करता है, तो `gke-autopilot` (या EKS Fargate पर `eks-fargate`) पर स्विच करें और फिर से इंस्टॉल करें।

### उदाहरण

**GKE Standard, EKS on EC2, सेल्फ-मैनेज्ड, या AKS:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod
```

**GKE Autopilot:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-gke-autopilot \
  --set preset=gke-autopilot
```

**EKS Fargate:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-eks-fargate \
  --set preset=eks-fargate
```

## दो लॉग-संग्रहण मोड कैसे भिन्न हैं

अंदरूनी तौर पर, `preset` `logs.mode` सेट करता है — और यदि आपको प्रीसेट डिफ़ॉल्ट को ओवरराइड करना हो तो आप उसे सीधे भी सेट कर सकते हैं।

### DaemonSet मोड (`logs.mode: daemonset`)

एक DaemonSet प्रति नोड एक OpenTelemetry Collector पॉड चलाता है। यह एक hostPath वॉल्यूम के माध्यम से `/var/log/pods/` के अंतर्गत लॉग फ़ाइलों को टेल करता है और उन्हें OTLP पर फ़ॉरवर्ड करता है।

- **फ़ायदे:** सबसे कम ओवरहेड, नोड्स के साथ रैखिक रूप से स्केल करता है, Kubernetes API सर्वर पर कोई लोड नहीं, लॉग रोटेशन को संभालता है।
- **नुकसान:** hostPath की आवश्यकता होती है, DaemonSets को शेड्यूल करने की क्षमता की आवश्यकता होती है — दोनों GKE Autopilot और EKS Fargate पर उपलब्ध नहीं हैं।

### API मोड (`logs.mode: api`)

एकल-रेप्लिका Deployment (`oneuptime/kubernetes-log-tailer` इमेज) कंटेनर लॉग्स को स्ट्रीम करने के लिए Kubernetes API का उपयोग करता है — वही एंडपॉइंट जो `kubectl logs -f` उपयोग करता है। कोई hostPath नहीं, कोई होस्ट एक्सेस नहीं, कोई DaemonSet नहीं।

- **फ़ायदे:** GKE Autopilot, EKS Fargate, और किसी भी क्लस्टर पर काम करता है जो hostPath को ब्लॉक करता है या `restricted` Pod Security Standard को लागू करता है।
- **नुकसान:** प्रत्येक कंटेनर स्ट्रीम `kube-apiserver` से एक दीर्घ-कालिक कनेक्शन है। व्यवहार में एक रेप्लिका कुछ हज़ार कंटेनरों को आराम से संभाल लेती है। बहुत बड़े क्लस्टरों के लिए, `logs.api.replicas` के साथ-साथ प्रत्येक रेप्लिका पर `namespaceFilters.include` का उपयोग करके नेमस्पेस के अनुसार शार्ड करें।

### आपको कौन सा उपयोग करना चाहिए?

यदि hostPath काम करता है, तो DaemonSet का उपयोग करें। बाकी हर जगह, API मोड का उपयोग करें। `preset` सेटिंग आपके लिए सही वाला चुनती है।

आप `--set logs.enabled=false` के साथ लॉग संग्रहण को पूरी तरह से अक्षम भी कर सकते हैं और इसके बजाय OpenTelemetry SDKs के माध्यम से एप्लिकेशन लॉग्स भेज सकते हैं। [OpenTelemetry](/docs/telemetry/open-telemetry) डॉक्स देखें।

## eBPF के माध्यम से एप्लिकेशन ट्रेस और HTTP रिक्वेस्ट (डिफ़ॉल्ट रूप से चालू)

Chart प्रत्येक नोड पर [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) चलाने वाला एक DaemonSet भेजता है। OBI Linux कर्नेल में eBPF प्रोग्राम लोड करता है और सॉकेट-स्तर के ट्रैफ़िक को देखता है ताकि नोड पर प्रत्येक पॉड से HTTP/HTTPS, gRPC, और SQL/Redis कॉल्स को पुनर्निर्मित किया जा सके — कोई कोड परिवर्तन नहीं, कोई SDK नहीं, कोई sidecar नहीं। कैप्चर किए गए ट्रैफ़िक को OTLP ट्रेस और रिक्वेस्ट/लेटेंसी मेट्रिक्स के रूप में सीधे OneUptime को निर्यात किया जाता है।

इंस्टॉल करने के बाद, आपकी सर्विसें एक या दो मिनट के भीतर **Telemetry → Traces** और सर्विस मैप के तहत दिखाई देने लगती हैं, जिसमें `k8s.cluster.name` आपके `clusterName` पर सेट होता है ताकि आप क्लस्टर के अनुसार फ़िल्टर कर सकें।

### इसे कब बंद करें

eBPF **डिफ़ॉल्ट रूप से सक्षम** है। आपको इसे अक्षम (`--set ebpf.enabled=false`) तब करना चाहिए जब:

- आप **GKE Autopilot** या **EKS Fargate** पर इंस्टॉल कर रहे हैं। वे प्लेटफ़ॉर्म privileged पॉड्स को ब्लॉक करते हैं, और OBI को eBPF प्रोग्राम लोड करने के लिए privileged मोड की आवश्यकता होती है।
- आपके नोड्स BTF बैकपोर्ट्स के बिना **Linux 5.8** से पुराने कर्नेल चलाते हैं। (आधुनिक डिस्ट्रोज़ — Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+ — ठीक हैं।)
- आप पहले से ही अपने ऐप्स से OpenTelemetry SDK के माध्यम से ट्रेस भेज रहे हैं और डुप्लीकेट नहीं चाहते।

### क्या उत्सर्जित होता है

OBI कैप्चर किए गए ट्रैफ़िक से कई सिग्नल परिवार निकालता है। सभी डिफ़ॉल्ट रूप से चालू हैं; प्रत्येक को `--set ebpf.features.<key>=false` के साथ स्वतंत्र रूप से अक्षम किया जा सकता है:

| सिग्नल | डिफ़ॉल्ट | यह क्या जोड़ता है |
| --- | --- | --- |
| `ebpf.features.httpMetrics` | on | HTTP/gRPC RED मेट्रिक्स — रिक्वेस्ट दर, लेटेंसी हिस्टोग्राम, एरर काउंट — प्रति सर्विस। |
| `ebpf.features.spanMetrics` | on | Span-attribute-कीड मेट्रिक्स: प्रति रूट/ऑपरेशन रिक्वेस्ट साइज़, रिस्पॉन्स साइज़, अवधि का विभाजन। |
| `ebpf.features.serviceGraph` | on | सर्विस-टू-सर्विस एज मेट्रिक्स (caller → callee रिक्वेस्ट दर + लेटेंसी)। सर्विस मैप को सशक्त बनाता है। |
| `ebpf.features.hostMetrics` | on | प्रति इंस्ट्रुमेंटेड प्रोसेस CPU और मेमोरी — बुनियादी क्षमता प्रश्नों के लिए अलग प्रोफाइलर चलाने से बचाता है। |
| `ebpf.features.networkMetrics` | on | k8s मेटाडेटा के साथ पॉड-टू-पॉड TCP/UDP फ्लो बाइट और पैकेट काउंटर्स। उन सभी पॉड्स के जोड़े दिखाता है जो बात करते हैं, जिनमें ऐसे प्रोटोकॉल चलाने वाले भी शामिल हैं जिन्हें OBI पार्स नहीं कर सकता। |
| `ebpf.features.networkInterZoneMetrics` | off | नेटवर्क मेट्रिक्स का इंटर-ज़ोन वैरिएंट। कार्डिनैलिटी को दोगुना करता है; केवल तभी सक्षम करने योग्य है यदि आप वास्तव में ज़ोन-आधारित शेड्यूलिंग का उपयोग करते हैं। |
| `ebpf.features.tcpStats` | on | नोड-स्तर TCP आँकड़े: RTT हिस्टोग्राम, असफल-कनेक्शन काउंट, retransmits। |

OBI सर्विस सीमाओं के पार ट्रेस कॉन्टेक्स्ट को भी डिफ़ॉल्ट रूप से प्रसारित करता है। जब पॉड A पॉड B को HTTP/gRPC रिक्वेस्ट करता है, तो OBI आउटबाउंड रिक्वेस्ट में एक W3C `traceparent` हेडर इंजेक्ट करता है — ताकि पॉड B की तरफ का परिणामी span पॉड A के आउटबाउंड के समान ट्रेस में लिंक हो जाए। किसी भी ऐप में कोई SDK परिवर्तन की आवश्यकता नहीं है।

| विकल्प | डिफ़ॉल्ट | विवरण |
| --- | --- | --- |
| `ebpf.contextPropagation` | on | आउटबाउंड ट्रैफ़िक में W3C `traceparent` इंजेक्ट करें (HTTP हेडर्स + कस्टम TCP विकल्प)। प्रत्येक सर्विस के spans को स्थानीय रखने के लिए `false` पर सेट करें। |
| `ebpf.trackRequestHeaders` | on | कर्नेल-साइड रिक्वेस्ट-हेडर ट्रैकिंग ताकि प्रचार सादे HTTP सर्वर्स (non-Go, non-TLS) पर भी काम करे। केवल तभी प्रभावी होता है जब `contextPropagation` सत्य है। |

### लॉग ↔ ट्रेस सहसंबंध

यह भी डिफ़ॉल्ट रूप से चालू है। OBI का लॉग एनरिचर इंस्ट्रुमेंटेड प्रोसेस से पॉड stdout राइट्स को इंटरसेप्ट करता है और:

- **JSON-फ़ॉर्मेट लॉग्स** के लिए: लाइन में `trace_id` और `span_id` फ़ील्ड्स इंजेक्ट करता है (लॉग में कोई भी मौजूदा मान संरक्षित रहता है)। filelog DaemonSet फिर उन फ़ील्ड्स को LogRecord के नेटिव trace_id/span_id स्लॉट्स पर उठाता है, ताकि ट्रेस व्यू में एक span पर क्लिक करने से OneUptime में उसके लॉग्स पर जाया जा सके — और एक लॉग लाइन पर क्लिक करने से उसके पैरेंट ट्रेस पर जाया जा सके।
- **गैर-JSON लॉग्स** के लिए: लाइन अपरिवर्तित संरक्षित रहती है — फिर भी एकत्र की जाती है, बस ऑटो-लिंक नहीं होती।

| विकल्प | डिफ़ॉल्ट | विवरण |
| --- | --- | --- |
| `ebpf.logToTraceCorrelation` | on | OBI लॉग एनरिचर और filelog पाइपलाइन के trace_id लिफ़्ट को सक्षम करें। दोनों को छोड़ने के लिए `false` पर सेट करें। |

सावधानियाँ:

- **trace_id दिखाई देने के लिए लॉग्स JSON होने चाहिए।** अपने लॉगर को JSON फ़ॉर्मेटर पर स्विच करें — `structlog`, `pino`, `winston`, `serilog`, `logback-json`, klog `--logging-format=json`, आदि।
- **बफ़र्ड stdout सहसंबंध को तोड़ देता है** क्योंकि `write()` syscall उस थ्रेड से अलग थ्रेड पर फायर होती है जिसने रिक्वेस्ट को हैंडल किया था। सामान्य समाधान:
  - **Python**: `PYTHONUNBUFFERED=1` सेट करें (TTY न होने पर रनटाइम stdout को ब्लॉक-बफ़र करता है)।
  - **.NET**: स्टार्टअप पर, `Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true })`। Microsoft.Extensions.Logging `AddConsole()` और Serilog के async sinks भी काम नहीं करेंगे — एक सिंक्रोनस कंसोल राइटर पर स्विच करें (Serilog का डिफ़ॉल्ट `WriteTo.Console()` ठीक है)।
- Greenlet / gevent, Tornado, और अन्य कस्टम async रनटाइम्स कवर नहीं होते हैं।

### ट्यूनिंग

| विकल्प | डिफ़ॉल्ट | विवरण |
| --- | --- | --- |
| `ebpf.enabled` | `true` | मास्टर स्विच। eBPF DaemonSet को पूरी तरह से छोड़ने के लिए `false` पर सेट करें। |
| `ebpf.image.tag` | `v0.9.0` | OBI इमेज टैग। OBI प्री-1.0 है; ज्ञात-अच्छे संस्करण पर पिन करें और बम्प पर पुनः-परीक्षण करें। |
| `ebpf.autoTargetExe` | `*` | इंस्ट्रुमेंट करने के लिए एक्ज़ीक्यूटेबल्स का ग्लोब। यदि आप ऑटो-इंस्ट्रुमेंटेशन का स्कोप करना चाहते हैं तो इसे संकीर्ण करें (जैसे `*/python,*/java`)। |
| `ebpf.excludeExePaths` | (shells, kubelet, runc, containerd, otelcol, OBI स्वयं) | छोड़ने के लिए अल्पविराम-अलग किए गए ग्लोब्स। |
| `ebpf.logLevel` | `info` | `debug`, `info`, `warn`, या `error`। समस्या निवारण करते समय `debug` पर सेट करें। |
| `ebpf.printTraces` | `false` | OTLP एक्सपोर्ट के अलावा OBI के stdout पर spans प्रिंट करें — इंस्टॉल के दौरान कैप्चर सत्यापित करने के लिए उपयोगी। |
| `ebpf.resources.*` | `100m / 256Mi` रिक्वेस्ट, `1000m / 1Gi` लिमिट | उच्च-ट्रैफ़िक क्लस्टरों के लिए बढ़ाएँ। |

OBI चल रहा है और ट्रैफ़िक देख रहा है इसकी जाँच करने के लिए:

```bash
kubectl get pods -n oneuptime-kubernetes-agent -l component=ebpf-instrument
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

## निरंतर CPU प्रोफाइलिंग (डिफ़ॉल्ट रूप से चालू)

एक अलग DaemonSet [OpenTelemetry eBPF Profiler](https://github.com/open-telemetry/opentelemetry-ebpf-profiler) चलाता है — जो `otel/opentelemetry-collector-ebpf-profiler` इमेज के रूप में पैक किया गया है। यह प्रत्येक समर्थित रनटाइम (Go, Java, .NET, Python, Ruby, Node.js, PHP, Perl, C/C++, Rust) में 19Hz पर on-CPU स्टैक्स को सैंपल करता है और OneUptime को OTLP प्रोफ़ाइल भेजता है, जहाँ वे **Telemetry → Performance Profiles** के तहत और व्यक्तिगत ट्रेस spans से लिंक किए गए फ्लेम ग्राफ़ के रूप में दिखाई देते हैं।

जब eBPF ऑटो-इंस्ट्रुमेंटेशन भी चालू होता है (`ebpf.enabled: true`, डिफ़ॉल्ट), प्रत्येक CPU सैंपल एक साझा bpffs मैप के माध्यम से OBI के ट्रेस कॉन्टेक्स्ट से सहसंबंधित होता है — ताकि फ्लेम ग्राफ़ trace_id/span_id ले जाएँ और OneUptime UI आपको प्रति-span फ्लेम ग्राफ़ दिखा सके।

आवश्यकताएँ:

- **Linux कर्नेल 5.10+** (OBI के लिए आवश्यक 5.8 से थोड़ा नया)।
- hostPID के साथ privileged पॉड — eBPF ऑटो-इंस्ट्रुमेंटेशन DaemonSet के समान बाधाएँ। GKE Autopilot, EKS Fargate, और लॉक-डाउन वातावरण पर अक्षम करें: `--set profiling.enabled=false`।

ट्यूनिंग:

| विकल्प | डिफ़ॉल्ट | विवरण |
| --- | --- | --- |
| `profiling.enabled` | `true` | मास्टर स्विच। |
| `profiling.image.tag` | `0.152.0` | `otel/opentelemetry-collector-ebpf-profiler` इमेज टैग। प्रोफाइलर प्री-1.0 है; ज्ञात-अच्छे संस्करण पर पिन करें। |
| `profiling.samplesPerSecond` | `19` | Hz में सैंपलिंग आवृत्ति। अपस्ट्रीम डिफ़ॉल्ट; सामान्य टाइमर आवृत्तियों के साथ आकस्मिक एलियासिंग से बचाता है। |
| `profiling.offCpuThreshold` | `0` | (0–1] off-CPU प्रोफाइलिंग को सक्षम करता है — लॉक कंटेंशन और ब्लॉकिंग I/O का निदान करता है। डिफ़ॉल्ट रूप से बंद क्योंकि यह ट्रेसपॉइंट ओवरहेड जोड़ता है। |
| `profiling.tracers` | `""` *(सभी रनटाइम)* | लोड करने के लिए भाषा ट्रेसर्स की अल्पविराम-अलग सूची। |
| `profiling.obiProcessContext` | `true` | ट्रेस ↔ प्रोफ़ाइल लिंकिंग के लिए OBI के ट्रेस कॉन्टेक्स्ट के साथ सैंपल्स को सहसंबंधित करें। |

## अन्य डेटा संग्रहण (होस्ट मेट्रिक्स, ऑडिट लॉग्स, CSI, CoreDNS)

Chart निम्नलिखित भी एकत्र कर सकता है:

| `<key>.enabled` | डिफ़ॉल्ट | यह क्या जोड़ता है |
| --- | --- | --- |
| `hostMetrics` | on | `/proc` और `/sys` से प्रति-नोड OS मेट्रिक्स — डिस्क I/O क्यू डेप्थ, फ़ाइलसिस्टम inode उपयोग, NIC एरर काउंटर्स, पेजिंग आँकड़े, लोड एवरेज। log-collector DaemonSet के अंदर रहता है (कोई अतिरिक्त पॉड्स नहीं)। |
| `auditLogs` | off | होस्ट से `/var/log/kubernetes/audit.log` टेल करें। प्रत्येक Kubernetes API रिक्वेस्ट कैप्चर करता है — किसने किस संसाधन पर क्या किया। केवल सेल्फ-मैनेज्ड क्लस्टर्स — प्रबंधित K8s (EKS, GKE, AKS, DOKS) ऑडिट लॉग्स को क्लाउड प्रदाता के sink पर रूट करते हैं। |
| `csi` | off | `app=csi-driver` (या `app.kubernetes.io/component=csi-driver`) के साथ लेबल किए गए पॉड्स को ऑटो-डिस्कवर करता है और उनके Prometheus `metrics` पोर्ट को स्क्रैप करता है — वॉल्यूम attach/detach लेटेंसी, प्रोविजनिंग विफलताएँ, IOPS। |
| `coreDns` | off | `:9153/metrics` पर क्लस्टर CoreDNS सर्विस को स्क्रैप करता है। क्वेरी दर, लेटेंसी, कैश हिट दर, एरर काउंट को सामने लाता है — सामान्य P99 लेटेंसी अपराधी। |

## सामान्य विकल्प

| विकल्प | डिफ़ॉल्ट | विवरण |
| --- | --- | --- |
| `preset` | (खाली — `standard` के रूप में माना जाता है) | ऊपर दी गई तालिका देखें। |
| `oneuptime.url` | *(आवश्यक)* | आपके OneUptime इंस्टैंस का URL। |
| `oneuptime.apiKey` | *(आवश्यक)* | प्रोजेक्ट API key (Settings → API Keys)। |
| `clusterName` | *(आवश्यक)* | इस क्लस्टर के लिए अद्वितीय नाम। प्रत्येक रिकॉर्ड पर `k8s.cluster.name` के रूप में स्टैम्प किया जाता है। |
| `namespaceFilters.include` | `[]` | यदि सेट है, तो केवल इन नेमस्पेस की निगरानी की जाती है। |
| `namespaceFilters.exclude` | `["kube-system"]` | छोड़ने के लिए नेमस्पेस। |
| `logs.enabled` | `true` | लॉग संग्रहण को चालू या बंद करें। |
| `logs.mode` | (`preset` से व्युत्पन्न) | `daemonset`, `api`, या `disabled`। प्रीसेट को ओवरराइड करता है। |
| `logs.api.replicas` | `1` | log-tailer Deployment रेप्लिका की संख्या (केवल API मोड में)। |
| `ebpf.enabled` | `true` | OpenTelemetry eBPF Instrumentation के माध्यम से प्रत्येक पॉड से HTTP/gRPC ट्रेस ऑटो-कैप्चर करें। ऊपर का सेक्शन देखें। |
| `profiling.enabled` | `true` | OpenTelemetry eBPF Profiler के माध्यम से निरंतर CPU फ्लेम ग्राफ़। ऊपर का सेक्शन देखें। |
| `hostMetrics.enabled` | `true` | प्रति-नोड OS मेट्रिक्स। |
| `auditLogs.enabled` | `false` | Kubernetes ऑडिट लॉग संग्रहण (सेल्फ-मैनेज्ड क्लस्टर्स)। |
| `csi.enabled` | `false` | CSI ड्राइवर Prometheus मेट्रिक्स। |
| `coreDns.enabled` | `false` | CoreDNS Prometheus मेट्रिक्स। |
| `controlPlane.enabled` | `false` | etcd / api-server / scheduler / controller-manager को स्क्रैप करें। केवल सेल्फ-मैनेज्ड क्लस्टर्स — प्रबंधित ऑफ़रिंग्स (EKS/GKE/AKS) आम तौर पर इन एंडपॉइंट्स को एक्सपोज़ नहीं करते। |

पूरी सूची के लिए [chart की `values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) देखें।

## अपग्रेड करना

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` आपके मौजूदा कॉन्फ़िगरेशन को बनाए रखता है; इसके ऊपर कोई भी नया `--set` ओवरराइड पास करें।

> **ध्यान दें: `--reuse-values` chart से नए डिफ़ॉल्ट को मर्ज नहीं करता है।** Helm आपके पहले रेंडर किए गए मानों को verbatim पुन: उपयोग करता है — इसलिए नए chart संस्करण में जोड़ा गया कोई भी नया शीर्ष-स्तरीय फ़ील्ड (जैसे `profiling.*`, `ebpf.features.*`) आपके मौजूदा रिलीज़ पर अनसेट रहता है और टेम्पलेट इस तरह से रेंडर करता है जैसे आपने इसे अक्षम कर दिया हो।
>
> **Helm 3.14+** — `--reset-then-reuse-values` पर स्विच करें। यह उन कीज़ के लिए chart डिफ़ॉल्ट को पुनः पढ़ता है जिन्हें आपने ओवरराइड नहीं किया है:
>
> ```bash
> helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
>   --namespace oneuptime-kubernetes-agent \
>   --reset-then-reuse-values
> ```
>
> **Helm 3.13 या उससे पहले** — `--reuse-values` को छोड़ दें और अपने मूल `--set` फ़्लैग्स (या `-f values.yaml`) को स्पष्ट रूप से पास करें। आपके द्वारा ओवरराइड नहीं किए गए हर चीज़ के लिए नए chart डिफ़ॉल्ट लागू होंगे।
>
> यदि किसी नए फ़ीचर के पॉड्स (जैसे `kubernetes-agent-profiling-*`) अपग्रेड के बाद दिखाई नहीं देते, तो लगभग हमेशा यही कारण होता है। `helm get values <release>` दिखाता है कि Helm के पास वास्तव में क्या है — आउटपुट से गायब फ़ील्ड्स का अर्थ है कि उनके लिए डिफ़ॉल्ट मर्ज नहीं हुए थे।

## अनइंस्टॉल करना

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## समस्या निवारण

### इंस्टॉल "hostPath volumes are not allowed" के साथ विफल हो जाता है

आपका क्लस्टर hostPath को ब्लॉक करता है। API-मोड प्रीसेट पर स्विच करें:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### OneUptime में कोई लॉग्स नहीं दिखते

एजेंट पॉड्स की जाँच करें:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

API मोड में, log-tailer पॉड पोर्ट 13133 पर `/healthz` एक्सपोज़ करता है — एक्सपोर्ट स्थिति स्नैपशॉट के लिए इसे `kubectl port-forward` के माध्यम से हिट करें।

### eBPF DaemonSet पॉड `CrashLoopBackOff` है या शुरू होने में विफल हो जाता है

OBI पॉड लॉग्स की जाँच करें:

```bash
kubectl logs -n oneuptime-kubernetes-agent -l component=ebpf-instrument --tail=200
```

सामान्य कारण:

- **कर्नेल बहुत पुराना है या BTF गुम है।** OBI को BTF के साथ Linux 5.8+ की आवश्यकता है। एक नोड पर `uname -r` से जाँचें। यदि आप अपग्रेड नहीं कर सकते, तो eBPF अक्षम करें: `--set ebpf.enabled=false`।
- **Privileged पॉड्स ब्लॉक हैं।** कुछ क्लस्टर Autopilot/Fargate के बाहर भी privileged पॉड्स को अस्वीकार करते हैं। eBPF अक्षम करें।
- **डैशबोर्ड में कोई ट्रेस नहीं लेकिन OBI चल रहा है।** `--set ebpf.printTraces=true` सेट करें और OBI के stdout की जाँच करें — यदि आपको वहाँ spans दिखते हैं, तो समस्या OTLP डिलीवरी है (`OTEL_EXPORTER_OTLP_ENDPOINT` और अपने OneUptime URL/API key की जाँच करें)। यदि आपको spans नहीं दिखते, तो OBI जो ट्रैफ़िक देख रहा है वह सब एक TLS लाइब्रेरी द्वारा एन्क्रिप्ट किया जा सकता है जिसे OBI इंटरसेप्ट नहीं कर सकता (जैसे एक स्टैटिकली लिंक्ड TLS कार्यान्वयन जिसे वह पहचानता नहीं है)।

### मेरे क्लस्टर में एक log-tailer रेप्लिका के लिए बहुत अधिक पॉड्स हैं (केवल API मोड)

नेमस्पेस को शार्डिंग करके क्षैतिज रूप से स्केल करें। प्रति नेमस्पेस ग्रुप एक बार डिप्लॉय करें:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

वैकल्पिक रूप से, `logs.api.replicas` बढ़ाएँ — लेकिन ध्यान दें कि प्रत्येक रेप्लिका सभी अनुमत नेमस्पेस को प्रोसेस करती है, इसलिए डुप्लीकेशन के लिए आपको अभी भी नेमस्पेस शार्डिंग की आवश्यकता है।
