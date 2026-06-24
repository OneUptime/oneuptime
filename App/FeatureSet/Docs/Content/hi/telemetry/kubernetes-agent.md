# OneUptime Kubernetes Agent (Helm)

## अवलोकन

OneUptime Kubernetes Agent एक पूर्व-पैकेज्ड Helm chart है जो आपके क्लस्टर पर एक OpenTelemetry-आधारित collector पाइपलाइन इंस्टॉल करता है। यह node, pod, container, और cluster मेट्रिक्स; Kubernetes events; pod logs; और — डिफ़ॉल्ट रूप से eBPF चालू होने के साथ — application traces, HTTP RED मेट्रिक्स, service-graph डेटा, और pod-to-pod नेटवर्क फ्लो मेट्रिक्स भेजता है। कोई कोड परिवर्तन नहीं, कोई SDK नहीं, एक `helm install`।

यह पेज **इंस्टॉलेशन गाइड** है। एजेंट द्वारा एकत्र किए गए डेटा के ऊपर Kubernetes मॉनिटर और अलर्ट कॉन्फ़िगर करने के लिए, देखें [Kubernetes Agent (monitors)](/docs/monitor/kubernetes-agent)।

## पूर्वापेक्षाएँ

- एक चालू Kubernetes क्लस्टर (v1.23+)
- आपके क्लस्टर तक पहुँचने के लिए कॉन्फ़िगर किया गया `kubectl`
- `helm` v3 इंस्टॉल किया हुआ
- एक **OneUptime API key** — इसे _Project Settings → API Keys_ से बनाएँ

## Step 1 — OneUptime Helm Repository जोड़ें

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update
```

## Step 2 — अपने क्लस्टर के लिए एक Preset चुनें

यह chart एक एकल शीर्ष-स्तरीय विकल्प प्रदर्शित करता है — `preset` — जो आपके Kubernetes वितरण के लिए संगत डिफ़ॉल्ट चुनता है। यह उन चीज़ों को नियंत्रित करता है जिन्हें अन्यथा आपको हाथ से ट्यून करना पड़ता: logs को hostPath DaemonSet के माध्यम से भेजना है या Kubernetes API के माध्यम से, और कौन सा security context लागू करना है।

| `preset`                | किसके लिए उपयोग करें                                                                 | Log संग्रह                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `standard` _(डिफ़ॉल्ट)_ | स्व-प्रबंधित क्लस्टर, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | hostPath के माध्यम से `/var/log/pods` पढ़ने वाला DaemonSet (सबसे कम ओवरहेड)   |
| `gke-autopilot`         | **GKE Autopilot**                                                                    | Kubernetes API log tailer Deployment (कोई hostPath नहीं, कोई host पहुँच नहीं) |
| `eks-fargate`           | **EKS Fargate**                                                                      | Kubernetes API log tailer Deployment (कोई hostPath नहीं, कोई host पहुँच नहीं) |

यदि आप सुनिश्चित नहीं हैं, तो `standard` से शुरू करें। यदि इंस्टॉल `hostPath` का उल्लेख करने वाली Pod Security त्रुटि के साथ विफल हो जाता है, तो `preset=gke-autopilot` (या Fargate पर `eks-fargate`) के साथ पुनः चलाएँ और यह काम करेगा।

## Step 3 — Kubernetes Agent इंस्टॉल करें

`YOUR_ONEUPTIME_URL`, `YOUR_ONEUPTIME_API_KEY`, और क्लस्टर नाम को अपने परिवेश के मानों से बदलें। क्लस्टर नाम वह है जिस तरह क्लस्टर OneUptime में दिखाई देगा — `prod-us-east-1` जैसा कुछ स्थिर चुनें।

### Standard क्लस्टर (स्व-प्रबंधित, EKS on EC2, GKE Standard, AKS)

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster"
```

### GKE Autopilot

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=gke-autopilot
```

### EKS Fargate

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set preset=eks-fargate
```

## Step 4 — इंस्टॉलेशन सत्यापित करें

जाँचें कि एजेंट pods चल रहे हैं:

```bash
kubectl get pods -n oneuptime-agent
```

एक **standard** क्लस्टर पर आपको एक metrics-collector Deployment और प्रति node एक log-collector DaemonSet pod दिखाई देगा:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

**GKE Autopilot** या **EKS Fargate** पर आपको इसके बजाय दो Deployments दिखाई देंगे (कोई DaemonSet नहीं):

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

एक बार जब एजेंट कनेक्ट हो जाता है, तो आपका क्लस्टर स्वचालित रूप से OneUptime डैशबोर्ड के **Kubernetes** अनुभाग में दिखाई देगा।

## कॉन्फ़िगरेशन विकल्प

### Namespace फ़िल्टरिंग

डिफ़ॉल्ट रूप से, `kube-system` को बाहर रखा जाता है। केवल विशिष्ट namespaces को मॉनिटर करने के लिए:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

### Log संग्रह अक्षम करें

यदि आपको केवल मेट्रिक्स और events की आवश्यकता है (कोई pod logs नहीं):

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

### एक विशिष्ट Log संग्रह मोड को बाध्य करें

उन्नत उपयोगकर्ता preset की पसंद को `logs.mode` से ओवरराइड कर सकते हैं:

- `logs.mode=daemonset` — hostPath DaemonSet (सबसे कम ओवरहेड, hostPath की आवश्यकता है)
- `logs.mode=api` — Kubernetes API log tailer Deployment (किसी भी क्लस्टर पर काम करता है)
- `logs.mode=disabled` — कोई log संग्रह नहीं

स्पष्ट `logs.mode` हमेशा preset डिफ़ॉल्ट पर जीतता है। इसका उपयोग करें यदि आप अपने क्लस्टर को preset से बेहतर जानते हैं।

### Control Plane मॉनिटरिंग सक्षम करें

स्व-प्रबंधित क्लस्टरों (EKS / GKE / AKS नहीं) के लिए, आप control plane मेट्रिक्स सक्षम कर सकते हैं:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set controlPlane.enabled=true
```

> प्रबंधित Kubernetes सेवाएँ (EKS, GKE, AKS) आमतौर पर control plane मेट्रिक्स को उजागर नहीं करतीं। इसे केवल स्व-प्रबंधित क्लस्टरों के लिए सक्षम करें।

### प्रोजेक्ट लेबल के साथ स्वतः-टैग करें

`oneuptime.label.` से उपसर्गित कोई भी resource attribute एक प्रोजेक्ट Label में प्रचारित किया जाता है और इस एजेंट से उत्सर्जित क्लस्टर, services, और hosts से संलग्न किया जाता है। पैटर्न: `oneuptime.label.<dimension>=<value>` एक लेबल `<dimension>:<value>` के नाम का बन जाता है।

इंस्टॉल के समय `--set oneuptime.labels.<key>=<value>` के साथ लेबल पास करें:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="prod" \
  --set oneuptime.labels.team=payments \
  --set oneuptime.labels.env=production \
  --set oneuptime.labels.region=us-east-1
```

या उन्हें एक values फ़ाइल में रखें:

```yaml
# values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
  labels:
    team: payments
    env: production
    region: us-east-1
clusterName: prod
```

लेबल केस-असंवेदनशील रूप से मिलान किए जाते हैं, इसलिए एक मौजूदा मैन्युअल रूप से बनाया गया `Production` लेबल डुप्लिकेट किए जाने के बजाय पुनः उपयोग किया जाता है। OneUptime UI में मैन्युअल रूप से जोड़े गए लेबल एजेंट द्वारा कभी नहीं हटाए जाते।

## एजेंट को अपग्रेड करना

```bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values
```

`--reuse-values` आपकी मौजूदा कॉन्फ़िगरेशन (preset, क्लस्टर नाम, फ़िल्टर) को बनाए रखता है; इसके ऊपर कोई भी नया `--set` ओवरराइड पास करें।

## एजेंट को अनइंस्टॉल करना

```bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
```

## क्या एकत्र किया जाता है

| श्रेणी                                                             | डेटा                                                                                                                                                |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node Metrics**                                                   | CPU उपयोग, मेमोरी उपयोग, filesystem उपयोग, नेटवर्क I/O                                                                                              |
| **Pod Metrics**                                                    | CPU उपयोग, मेमोरी उपयोग, नेटवर्क I/O, restarts                                                                                                      |
| **Container Metrics**                                              | प्रति container CPU उपयोग, मेमोरी उपयोग                                                                                                             |
| **Cluster Metrics**                                                | Node स्थितियाँ, आवंटन योग्य संसाधन, pod गणना                                                                                                        |
| **Kubernetes Events**                                              | चेतावनियाँ, त्रुटियाँ, scheduling events                                                                                                            |
| **Pod Logs**                                                       | सभी containers से stdout/stderr logs (standard क्लस्टरों पर hostPath DaemonSet के माध्यम से, या Autopilot / Fargate पर Kubernetes API के माध्यम से) |
| **Application Traces** _(eBPF के माध्यम से, डिफ़ॉल्ट रूप से चालू)_ | प्रत्येक pod से HTTP, gRPC, SQL/Redis spans — कोई SDK या कोड परिवर्तन नहीं                                                                          |
| **HTTP RED Metrics** _(eBPF के माध्यम से)_                         | `http.server.request.duration`, request और response body आकार, प्रति service                                                                        |
| **Service Graph** _(eBPF के माध्यम से)_                            | Caller → callee request दर, latency, और error edges — service map दृश्य को संचालित करता है                                                          |
| **Network Flow Metrics** _(eBPF के माध्यम से)_                     | k8s मेटाडेटा के साथ pod-to-pod TCP/UDP byte और packet काउंटर                                                                                        |
| **TCP Stats** _(eBPF के माध्यम से)_                                | Node-स्तरीय RTT, failed-connection, और retransmit काउंटर                                                                                            |

## eBPF के माध्यम से Application Traces & HTTP Metrics (डिफ़ॉल्ट रूप से चालू)

यह chart प्रत्येक node पर [OpenTelemetry eBPF Instrumentation (OBI)](https://opentelemetry.io/docs/zero-code/obi/) के साथ एक DaemonSet चलाता है। यह eBPF प्रोग्राम को kernel में लोड करता है और प्रत्येक समर्थित runtime (Go, .NET, Java, Node.js, Python, Ruby, Rust) से HTTP/HTTPS, gRPC, और SQL/Redis ट्रैफ़िक को स्वतः-कैप्चर करता है — कोई SDK और कोई sidecar आवश्यक नहीं। Traces और request मेट्रिक्स फिर in-cluster collector के माध्यम से OneUptime में प्रवाहित होते हैं।

**आवश्यकताएँ:** BTF के साथ Linux kernel **5.8+** (Debian 11+, Ubuntu 20.10+, Fedora 34+, RHEL/Stream 9+ पर डिफ़ॉल्ट)। eBPF DaemonSet **privileged mode** में चलता है क्योंकि उसे eBPF प्रोग्राम लोड करने के लिए ऐसा करना होता है।

### eBPF स्वतः-instrumentation अक्षम करें

आपको इसे तब अक्षम करना चाहिए जब:

- **GKE Autopilot** या **EKS Fargate** पर इंस्टॉल कर रहे हों — वे प्लेटफ़ॉर्म privileged pods को ब्लॉक करते हैं (`preset=gke-autopilot` / `preset=eks-fargate` का उपयोग करें और इसे `ebpf.enabled=false` के साथ जोड़ें)।
- Nodes BTF के बिना 5.8 से पुराना kernel चलाते हैं।
- आप पहले से ही अपने apps से OpenTelemetry SDKs के माध्यम से traces भेजते हैं और डुप्लिकेट नहीं चाहते।

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set ebpf.enabled=false
```

### व्यक्तिगत signal परिवारों को टॉगल करें

सभी डिफ़ॉल्ट रूप से चालू। किसी को भी `--set ebpf.features.<name>=false` के साथ बंद करें:

| `ebpf.features.*`         | डिफ़ॉल्ट | यह क्या जोड़ता है                                                    |
| ------------------------- | -------- | -------------------------------------------------------------------- |
| `httpMetrics`             | चालू     | प्रति service HTTP/gRPC RED मेट्रिक्स (request दर, latency, errors)  |
| `spanMetrics`             | चालू     | प्रति-span request/response आकार और अवधि                             |
| `serviceGraph`            | चालू     | Caller → callee edge मेट्रिक्स; service map को संचालित करता है       |
| `hostMetrics`             | चालू     | प्रति instrumented process CPU और मेमोरी                             |
| `networkMetrics`          | चालू     | Pod-to-pod TCP/UDP फ्लो काउंटर                                       |
| `networkInterZoneMetrics` | बंद      | नेटवर्क मेट्रिक्स का Inter-zone संस्करण (cardinality दोगुनी करता है) |
| `tcpStats`                | चालू     | Node-स्तरीय TCP RTT, failed-connection, retransmit काउंटर            |

Cross-service trace context प्रसार भी डिफ़ॉल्ट रूप से चालू है — OBI आउटबाउंड HTTP/TCP में W3C `traceparent` इंजेक्ट करता है ताकि pod A → pod B को पार करने वाला एक request एकल trace के रूप में दिखाई दे, कहीं भी कोई SDK परिवर्तन नहीं। `--set ebpf.contextPropagation=false` के साथ बंद करें।

## समस्या निवारण

> **सबसे तेज़ मार्ग — diagnostic स्क्रिप्ट चलाएँ।** यह pod स्वास्थ्य का निरीक्षण करती है, ingestion key को डिकोड और सत्यापित करती है, जाँचती है कि आपका क्लस्टर OneUptime तक पहुँच सकता है, और OneUptime से पूछती है कि आपका token वास्तव में स्वीकार किया गया है या नहीं — फिर एक एकल मूल-कारण निर्णय प्रिंट करती है:
>
> ```bash
> curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/HelmChart/Public/kubernetes-agent/troubleshoot.sh \
>   | bash -s -- -n oneuptime-agent
> ```
>
> यह केवल क्लस्टर स्थिति पढ़ती है और कुछ probes चलाती है; यह कुछ भी नहीं बदलती। सबसे सटीक egress परीक्षण के लिए, पहले `--set debug.enabled=true` के साथ इंस्टॉल करें (यह एजेंट pods में एक छोटा network-tools sidecar जोड़ता है ताकि स्क्रिप्ट collector के सटीक egress पथ का परीक्षण करे), फिर पुनः चलाएँ।

### इंस्टॉल "hostPath volumes are not allowed" या एक Pod Security admission त्रुटि के साथ विफल हो जाता है

आपका क्लस्टर `hostPath` को ब्लॉक करता है — **GKE Autopilot** और **EKS Fargate** पर आम। API-mode preset पर स्विच करें:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### एजेंट "Disconnected" दिखाता है

एक क्लस्टर की कनेक्टेड स्थिति पूरी तरह से आने वाली telemetry द्वारा संचालित होती है — यदि कोई डेटा नहीं आता, तो क्लस्टर को ~15 मिनट के बाद disconnected के रूप में चिह्नित किया जाता है। इसलिए "disconnected" और "no metrics" का लगभग हमेशा **एक ही** कारण होता है: एजेंट की telemetry स्वीकार नहीं की जा रही है।

सबसे आम कारण — विशेष रूप से reinstall के बाद — एक **गलत या निरस्त ingestion key** है। इसे चूकना आसान है क्योंकि OTLP ingest endpoints जानबूझकर एक खराब token के लिए भी HTTP `200` लौटाते हैं (ताकि एक गलत कॉन्फ़िगर किया गया collector सर्वर पर retry-storm न कर सके)। परिणाम: collector सफलता की रिपोर्ट करता है, इसके logs कोई त्रुटि नहीं दिखाते, और डेटा चुपचाप गिरा दिया जाता है।

1. जाँचें कि एजेंट pods चल रहे हैं: `kubectl get pods -n oneuptime-agent`
2. metrics-collector logs जाँचें: `kubectl logs -n oneuptime-agent -l component=metrics-collector -c otel-collector` (यहाँ कोई त्रुटि नहीं होने का मतलब **यह नहीं** है कि डेटा आ रहा है — ऊपर देखें)
3. **Ingestion key सत्यापित करें।** OneUptime से सीधे पूछें कि आपका token स्वीकार किया गया है या नहीं (`200` = वैध, `401` = अज्ञात/निरस्त):

   ```bash
   curl -i -H "x-oneuptime-token: <YOUR_API_KEY>" https://oneuptime.com/otlp/v1/validate
   ```

   यदि यह `401` लौटाता है, तो आपके रिलीज़ में key गलत है या निरस्त कर दी गई थी। _Project Settings → Telemetry Ingestion Keys_ से एक live key कॉपी करें और पुनः-डिप्लॉय करें:

   ```bash
   helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
     --namespace oneuptime-agent --reuse-values \
     --set oneuptime.apiKey=<LIVE_KEY>
   ```

4. सत्यापित करें कि आपका OneUptime URL सही है और आपका क्लस्टर नेटवर्क पर इस तक पहुँच सकता है।
5. यदि आपने reinstall पर `clusterName` बदला, तो एजेंट एक **नए** क्लस्टर के रूप में दिखाई देता है — पुरानी प्रविष्टि "Disconnected" बनी रहती है (यह अपेक्षित है; यह पुरानी है)।

### कोई logs दिखाई नहीं दे रहे (केवल API mode)

1. पुष्टि करें कि log tailer pod Ready है: `kubectl get pods -n oneuptime-agent -l component=log-collector`
2. इसका `/healthz` जाँचें — यह सक्रिय stream गणना और अंतिम export त्रुटि की रिपोर्ट करता है
3. logs जाँचें: `kubectl logs -n oneuptime-agent deployment/kubernetes-agent-logs`
4. बहुत बड़े क्लस्टरों के लिए, एक एकल replica एक अड़चन हो सकती है — अलग रिलीज़ पर `namespaceFilters.include` का उपयोग करके namespace द्वारा shard करें

### कोई metrics दिखाई नहीं दे रहे

1. पहले एक अस्वीकृत ingestion key को खारिज करें — यह सबसे आम कारण है और एजेंट पक्ष से अदृश्य है। ऊपर [एजेंट "Disconnected" दिखाता है](#agent-shows-disconnected) देखें (या बस diagnostic स्क्रिप्ट चलाएँ)।
2. जाँचें कि क्लस्टर पहचानकर्ता उस मान से मेल खाता है जिसे आपने `clusterName` के रूप में पास किया था
3. RBAC अनुमतियाँ सत्यापित करें: `kubectl get clusterrolebinding | grep kubernetes-agent`
4. export त्रुटियों के लिए OTel collector logs जाँचें

### eBPF pods CrashLoopBackOff हैं या शुरू होने में विफल हो जाते हैं

```bash
kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200
```

सामान्य कारण:

- **Kernel बहुत पुराना या BTF गायब।** OBI को BTF के साथ Linux 5.8+ की आवश्यकता है। एक node पर `uname -r` चलाएँ। यदि आप अपग्रेड नहीं कर सकते, तो eBPF अक्षम करें: `--set ebpf.enabled=false`।
- **Privileged pods ब्लॉक किए गए।** कुछ क्लस्टर privileged pods को अस्वीकार करते हैं (GKE Autopilot, EKS Fargate, और लॉक-डाउन परिवेश)। eBPF अक्षम करें।
- **`debugfs` / `tracefs` host पर माउंट नहीं किए गए।** `tcpStats` फ़ीचर kernel tracepoints से जुड़ता है जिन्हें इनकी आवश्यकता होती है। यह chart दोनों को `hostPath` के माध्यम से माउंट करता है — लेकिन यदि आपका host इन्हें उजागर नहीं करता, तो केवल उस परिवार को अक्षम करें: `--set ebpf.features.tcpStats=false`।

### कोई application traces दिखाई नहीं दे रहे

1. पुष्टि करें कि eBPF DaemonSet स्वस्थ है: `kubectl get pods -n oneuptime-agent -l component=ebpf-instrument`
2. यह पुष्टि करने के लिए कि OBI ट्रैफ़िक कैप्चर कर रहा है, debug trace printer चालू करें: `--set ebpf.printTraces=true --set ebpf.logLevel=debug`, फिर `kubectl logs -n oneuptime-agent -l component=ebpf-instrument --tail=200` जाँचें
3. यदि आप OBI के stdout में spans देखते हैं लेकिन डैशबोर्ड में नहीं, तो समस्या collector → OneUptime export है — metrics-collector pod के logs जाँचें।

## अगले कदम

- इस एजेंट द्वारा एकत्र किए गए मेट्रिक्स के ऊपर **Kubernetes Monitors** कॉन्फ़िगर करें — देखें [Kubernetes Agent (monitors)](/docs/monitor/kubernetes-agent)।
- विशिष्ट log पैटर्न पर अलर्ट करने के लिए **Logs Monitors** जोड़ें (जैसे प्रति pod या प्रति namespace एक सीमा से ऊपर error गणना)।
- गैर-Kubernetes hosts (Linux / macOS / Windows VMs और bare metal) के लिए, [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector) पेज का उपयोग करें।
