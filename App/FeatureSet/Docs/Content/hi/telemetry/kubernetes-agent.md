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

एक **standard** क्लस्टर पर आपको एक cluster-collector Deployment और प्रति node एक node-collector DaemonSet pod दिखाई देगा:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
kubernetes-agent-logs-yyyyy                   1/1     Running   0          1m
```

**GKE Autopilot** पर node collector फिर भी चलता है — यह hostPath की आवश्यकता के बिना kubelet और cAdvisor मेट्रिक्स एकत्र करता है — और एक अतिरिक्त Deployment Kubernetes API के माध्यम से pod logs को टेल करता है:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
kubernetes-agent-logs-xxxxx                   1/1     Running   0          1m
```

**EKS Fargate** पर आपको दो Deployments दिखाई देंगे और कोई DaemonSet नहीं — Fargate प्रत्येक pod को उसका अपना micro-VM देता है और DaemonSets को कभी schedule नहीं करता, इसलिए वहाँ node-स्तरीय मेट्रिक्स उपलब्ध नहीं हैं:

```
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-xxxxxxxxxx-xxxxx             1/1     Running   0          1m
kubernetes-agent-logs-yyyyyyyyyy-yyyyy        1/1     Running   0          1m
```

एक बार जब एजेंट कनेक्ट हो जाता है, तो आपका क्लस्टर स्वचालित रूप से OneUptime डैशबोर्ड के **Kubernetes** अनुभाग में दिखाई देगा।

## कॉन्फ़िगरेशन विकल्प

### Namespace फ़िल्टरिंग

`namespaceFilters` **pod logs** (hostPath DaemonSet और API log-tailer दोनों) और **eBPF traces** को आपके चुने हुए namespaces तक सीमित करता है। `kube-system` को डिफ़ॉल्ट रूप से बाहर रखा जाता है। उन signals को विशिष्ट namespaces तक सीमित करने के लिए:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set "namespaceFilters.include={default,production,staging}"
```

एक शोरगुल वाले namespace को अनदेखा करते हुए बाकी हर एक को रखने के लिए, इसके बजाय `exclude` का उपयोग करें। `exclude` हमेशा `include` पर जीतता है, और शिप किया गया डिफ़ॉल्ट `[kube-system]` है — इसलिए यदि आप अब भी उसे बाहर रखना चाहते हैं तो उसे फिर से सूचीबद्ध करें:

```bash
  --set "namespaceFilters.exclude={kube-system,noisy-namespace}"
```

**pod logs और eBPF traces के लिए इसकी कोई लागत नहीं है**: namespace pod-log पथ का और OBI की process discovery का हिस्सा है, इसलिए फ़िल्टर किया गया namespace पहले स्थान पर कभी पढ़ा ही नहीं जाता — कोई CPU नहीं, कोई egress नहीं।

#### मेट्रिक्स और traces पर namespace फ़िल्टर लागू करना

डिफ़ॉल्ट रूप से ऊपर दी गई सूचियाँ केवल pod logs और eBPF traces को कवर करती हैं। `applyTo` उन्हें अन्य signals तक विस्तारित करता है:

```bash
  --set namespaceFilters.applyTo.metrics=true \
  --set namespaceFilters.applyTo.traces=true
```

| सेटिंग            | यह क्या कवर करता है                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `applyTo.metrics` | kubeletstats, cAdvisor, और kube-state-metrics से प्रति-pod / प्रति-container मेट्रिक्स                     |
| `applyTo.traces`  | वे spans जिन्हें आपके एप्लिकेशन एजेंट के OTLP endpoint पर भेजते हैं (eBPF spans पहले से ही स्कोप किए हुए हैं) |

दोनों जानबूझकर **डिफ़ॉल्ट रूप से बंद** हैं। `exclude: [kube-system]` एक डिफ़ॉल्ट के रूप में शिप होता है, इसलिए इन्हें स्वचालित रूप से चालू करना अपग्रेड पर प्रत्येक मौजूदा इंस्टॉल से kube-system मेट्रिक्स को चुपचाप हटा देगा।

> **Node- और cluster-स्तरीय मेट्रिक्स हमेशा रखे जाते हैं।** namespace एक pod की संपत्ति है, node की नहीं, इसलिए node CPU, node मेमोरी, और filesystem उपयोग जैसी series के पास मिलान करने के लिए कुछ नहीं होता और उन्हें कभी नहीं गिराया जाता। `applyTo.metrics` प्रति-pod cardinality को छाँटता है, आपको कभी किसी खराब होते node के प्रति अंधा किए बिना।

Kubernetes **events** एजेंट पर namespace-फ़िल्टर करने योग्य नहीं हैं। वे `k8sobjects` receiver से `k8s.namespace.name` विशेषता के बिना आते हैं — namespace event body के अंदर होता है — इसलिए फ़िल्टर के लिए मिलान करने को कुछ नहीं है। उन्हें इसके बजाय सर्वर-साइड गिराएँ (नीचे देखें)।

### Log गंभीरता द्वारा फ़िल्टरिंग

`filters.logs.minSeverity` एजेंट पर, कुछ भी भेजे जाने से पहले, एक गंभीरता से नीचे के **pod log** रिकॉर्ड गिरा देता है:

```bash
  --set filters.logs.minSeverity=WARN
```

`TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL` स्वीकार करता है। `WARN` WARN, ERROR, और FATAL रखता है और INFO, DEBUG, और TRACE गिरा देता है। डिफ़ॉल्ट (`""`) सब कुछ रखता है। यह **दोनों** log modes में लागू होता है — `daemonset` mode में collector के माध्यम से, `api` mode में log tailer के अंदर ही — इसलिए presets इसे आपके नीचे से बंद नहीं कर सकते।

Container runtimes log line पर कोई गंभीरता दर्ज नहीं करते, इसलिए एजेंट log टेक्स्ट (`[ERROR]`, `WARN:`, `level=info`, …) से स्वयं एक निकाल लेता है।

> **Kubernetes events और resource specs को इससे कभी फ़िल्टर नहीं किया जाता।** वे Kubernetes API से अपनी कोई गंभीरता लिए बिना आते हैं, इसलिए एक सीमा उन्हें छाँटने के बजाय पूरी feed को हटा देगी — उन `FailedScheduling`, `BackOff`, और `OOMKilling` चेतावनियों सहित जो आप सबसे अधिक चाहते हैं। वे कम-volume और उच्च-मूल्य वाले हैं, इसलिए एजेंट उन्हें हमेशा शिप करता है। उन्हें छाँटने के लिए, इसके बजाय डैशबोर्ड के सर्वर-साइड **Logs → Settings → Drop Filters** का उपयोग करें।

**जिस line पर कोई पहचानने योग्य level नहीं है उसका क्या होता है, यह log mode पर निर्भर करता है**, क्योंकि दोनों modes के पास अलग-अलग जानकारी उपलब्ध होती है:

| Mode | बिना label वाली line | क्यों |
| ---- | -------------------- | ----- |
| `daemonset` | `stderr` → ERROR माना जाता है (रखा जाता है), `stdout` → INFO माना जाता है (एक WARN सीमा द्वारा गिराया जाता है) | container runtime दर्ज करता है कि प्रत्येक line किस stream से आई थी। |
| `api` | हमेशा **रखा जाता है** | Kubernetes `pods/log` API stdout और stderr को बिना प्रति-line मार्कर के एक ही stream में मिला देता है। अनुमान लगाने के बजाय, एजेंट line को रख लेता है। |

> इसलिए `api` mode `daemonset` mode से सख्ती से कम गिराता है। यह जानबूझकर है: एक Python traceback या `npm ERR!` कोई गंभीरता कीवर्ड नहीं रखता, और उसे चुपचाप हटा देना ठीक वही विफलता है जिससे बचाने के लिए एक गंभीरता सीमा होती है।

Multi-line events दोनों modes में **फ़िल्टरिंग से पहले** पुनः जोड़ दिए जाते हैं, इसलिए एक Java stack trace को उसकी पहली line पर आँका जाता है और पूरा का पूरा रखा या गिराया जाता है — आपको कभी एक नंगी `ERROR` line उसकी frames हटी हुई नहीं मिलेगी।

### नाम द्वारा मेट्रिक्स शामिल या बाहर करना

`filters.metrics` नियंत्रित करता है कि पाइपलाइन के प्रत्येक receiver में से कौन से मेट्रिक्स क्लस्टर छोड़ते हैं।

**कुछ शोरगुल वाले मेट्रिक्स गिराएँ** (एक denylist — आमतौर पर यही आप चाहते हैं):

```bash
  --set-json 'filters.metrics.exclude=["k8s.volume.available","k8s.volume.capacity"]'
```

**केवल एक निश्चित सेट भेजें** (एक allowlist — बाकी सब कुछ गिरा दिया जाता है):

```bash
  --set-json 'filters.metrics.include=["k8s.pod.cpu.utilization","k8s.pod.memory.usage"]'
```

सटीक नाम के बजाय **पैटर्न द्वारा मिलान करें**:

```bash
  --set filters.metrics.matchType=regexp \
  --set-json 'filters.metrics.exclude=["^container_network_"]'
```

| Key                         | अर्थ                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `filters.metrics.exclude`   | गिराने के लिए metric नाम। `include` के ऊपर लागू किया जाता है, इसलिए exclude हमेशा जीतता है। |
| `filters.metrics.include`   | जब गैर-रिक्त हो, तो **केवल** ये भेजे जाते हैं।                                              |
| `filters.metrics.matchType` | `strict` (सटीक नाम, डिफ़ॉल्ट) या `regexp` (RE2, **unanchored**)।                            |

वे नोट्स जो आपको एक incident से बचाएँगे:

- `regexp` **unanchored** है — `system.cpu` `system.cpu.time` से भी मेल खाता है। जब आपका मतलब ठीक एक metric से हो तो इसे anchor करें (`^system\.cpu$`)।
- RE2 में **कोई lookahead नहीं** है, इसलिए `^(?!container_)` कंपाइल नहीं होगा। "इसके अलावा सब कुछ" को एक negative regex से नहीं, बल्कि `include` से व्यक्त करें।
- `include` एक ही बार में प्रत्येक receiver तक फैलता है। एक allowlist जो किसी metric को भूल जाती है, उस पर बने monitors को चुपचाप हटा देती है। जब तक आप वास्तव में एक बंद सेट नहीं चाहते, `exclude` को प्राथमिकता दें।
- सूचियों के लिए `--set-json` (या एक values फ़ाइल) का उपयोग करें। सादा `--set` किसी सूची को मर्ज करने के बजाय बदल देता है।

> **किसी regex को रोल आउट करने से पहले उसका परीक्षण करें।** पैटर्न collector द्वारा startup पर कंपाइल किए जाते हैं, प्रति रिकॉर्ड नहीं, इसलिए एक अमान्य पैटर्न चुपचाप गलत व्यवहार नहीं करता — collector शुरू होने से इनकार कर देता है और CrashLoopBackOff में चला जाता है, अपने मेट्रिक्स के साथ-साथ उस collector के **logs** को भी ले डूबता है। Helm RE2 कंपाइल नहीं कर सकता, इसलिए `helm upgrade` एक खराब पैटर्न को बिना किसी शिकायत के स्वीकार कर लेता है।

### Trace सैंपलिंग

ऊपर दिए गए फ़िल्टर telemetry की एक **श्रेणी** को हटाते हैं — एक namespace, एक गंभीरता, एक metric नाम। सैंपलिंग अलग है: यह हर श्रेणी को रखती है और इसके बजाय आबादी को पतला करती है। `sampling.traces.percentage` को traces के उस हिस्से पर सेट करें जिसे आप रखना चाहते हैं:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

यह दस में से एक trace रखता है और बाकी नौ को एजेंट पर ही, उनके आपका क्लस्टर छोड़ने से पहले, गिरा देता है।

**आपको पूरे traces मिलते हैं, टुकड़े नहीं।** निर्णय प्रति span सिक्का उछालने के बजाय trace ID का एक hash है, इसलिए किसी trace का प्रत्येक span एक साथ ही रखा या गिराया जाता है — जो traces बचते हैं वे पूर्ण हैं और सिरे से सिरे तक पढ़े जा सकते हैं। यही वह गुण है जो सैंपलिंग को चालू करना सुरक्षित बनाता है।

**आपके metric-आधारित monitors हिलते नहीं।** eBPF RED मेट्रिक्स — request rate, error rate, duration — एक *metrics* परिवार हैं। OBI उन्हें प्रत्येक request से गणना करता है और वे metrics पाइपलाइन से यात्रा करते हैं, जिसमें sampler है ही नहीं। `percentage: 10` पर आपको traces का दसवाँ हिस्सा और 100% सटीक rate/error/latency मिलते हैं। उन मेट्रिक्स पर बने डैशबोर्ड और monitors अप्रभावित रहते हैं।

**आपके span-आधारित monitors हिलते हैं।** OneUptime जो कुछ भी spans से ही व्युत्पन्न करता है वह दर के साथ नीचे स्केल होता है — इसे चालू करने से पहले नीचे दी गई चेतावनी देखें।

| Key                          | अर्थ                                                                       |
| ---------------------------- | -------------------------------------------------------------------------- |
| `sampling.traces.percentage` | traces का वह प्रतिशत जिसे **रखना** है, 0-100। डिफ़ॉल्ट `100` (सब कुछ रखें)। |
| `sampling.traces.hashSeed`   | trace-ID hash के लिए seed। डिफ़ॉल्ट `22`।                                  |

वे नोट्स जो आपको एक incident से बचाएँगे:

- **`0` कोई भी trace नहीं रखता।** यह एक दर है, कोई off स्विच नहीं — यह प्रत्येक trace को हटा देता है जबकि eBPF DaemonSet चलता रहता है और आपको लागत देता रहता है। यदि आप कोई traces नहीं चाहते, तो `ebpf.enabled=false` का उपयोग करें। यदि आप कोई traces नहीं चाहते लेकिन RED मेट्रिक्स और service map *चाहते* हैं, तो eBPF चालू रखें और इसे जानबूझकर `0` पर सेट करें।
- **केवल तभी लागू होता है जब `ebpf.enabled` हो।** अन्यथा traces पाइपलाइन मौजूद ही नहीं होती, इसलिए `ebpf.enabled=false` पर यह value कुछ नहीं करती।
- **केवल traces।** कोई `sampling.logs` या `sampling.metrics` नहीं है, और यह जानबूझकर है — नीचे दिया गया नोट देखें।
- **भिन्नों के लिए `--set-json` चाहिए, और उनकी एक न्यूनतम सीमा है।** `--set sampling.traces.percentage=0.5` विफल हो जाता है, क्योंकि Helm `0.5` को एक string के रूप में पढ़ता है। `--set-json 'sampling.traces.percentage=0.5'` या एक values फ़ाइल का उपयोग करें। पूर्ण संख्याएँ `--set` के साथ ठीक काम करती हैं। लगभग `0.0061` से नीचे दर शून्य पर quantise हो जाती है और ठीक `0` की तरह व्यवहार करती है — प्रत्येक trace गिरा दिया जाता है, कोई त्रुटि नहीं। `0.01` (दस हज़ार में एक) सबसे छोटा मान है जो वही करता है जो वह कहता है।
- **Multi-cluster डिफ़ॉल्ट रूप से काम करता है।** दो एजेंट एक ही trace को केवल तभी रखते हैं जब वे `hashSeed` और `percentage` दोनों पर सहमत हों। दोनों हर जगह एक ही value पर डिफ़ॉल्ट होते हैं, इसलिए दो क्लस्टरों को पार करने वाला एक trace बिना किसी अतिरिक्त कॉन्फ़िगरेशन के पूरा बचता है। `hashSeed` को केवल दो sampling स्तरों को जानबूझकर *असंबद्ध* करने के लिए बदलें — चूँकि निर्णय उसी hash पर एक threshold है, एक ही seed अलग-अलग दरों पर nest करता है, इसलिए दूसरा स्तर स्वतंत्र रूप से चुनने के बजाय बस उन्हीं traces को फिर से चुन लेता है जिन्हें पहला पहले ही रख चुका है।
- **Pod logs की कभी सैंपलिंग नहीं होती**, इसलिए `ebpf.logToTraceCorrelation: true` के साथ प्रत्येक log रिकॉर्ड अब भी एक trace ID रखता है जबकि उन traces का केवल `percentage`% ही रखा जाता है। मोटे तौर पर (100 − `percentage`)% log रिकॉर्ड एक ऐसा trace लिंक दिखाएँगे जो कहीं नहीं पहुँचता। Trace → logs नेविगेशन अप्रभावित रहता है; केवल logs → trace चूक सकता है।

> **जब आप इसे सेट करें तो अपने span-आधारित monitors को पुनः ट्यून करें।** सैंपलिंग OneUptime तक पहुँचने वाले spans को घटा देती है, इसलिए जो कुछ भी उन्हें गिनता है वह कम गिनता है: `Span Count` पर एक **Traces** monitor और `Exception Count` पर एक **Exceptions** monitor कल के मोटे तौर पर `percentage`% volume ही देखेंगे। बिना सैंपलिंग वाले ट्रैफ़िक पर ट्यून की गई एक सीमा चुपचाप पार होना बंद हो जाती है — monitor कोई त्रुटि नहीं देता, वह बस शांत हो जाता है। जब आप दर सेट करें तो उन सीमाओं को उसी factor से भाग दें; यह दर cluster-व्यापी है, इसलिए किसी एक service को इससे छूट देने का कोई तरीका नहीं है। Error **grouping** रैखिक से भी बदतर तरीके से बिगड़ती है: एक सामान्य exception फिर भी सामने आता है, लेकिन एक दुर्लभ इक्का-दुक्का exception दसवें हिस्से जितनी बार दिखने के बजाय पूरी तरह गायब हो जाने की अधिक संभावना रखता है।

> **यहाँ log या metric सैंपलिंग क्यों नहीं है।** collector का sampler मेट्रिक्स का सैंपलिंग बिल्कुल नहीं कर सकता। यह logs का सैंपलिंग कर सकता है, लेकिन यह अपनी यादृच्छिकता trace ID से लेता है — और pod logs के पास वह होती ही नहीं। तब प्रत्येक trace-ID-रहित रिकॉर्ड एक ही bucket में hash होता है, इसलिए एक log दर feed को पतला नहीं करेगी: वह seed के आधार पर या तो सब कुछ रखेगी या सब कुछ हटा देगी। एक ऐसी घुंडी देने के बजाय जो चुपचाप आपके logs हटा दे, chart कोई देता ही नहीं। logs को [Log गंभीरता द्वारा फ़िल्टरिंग](#log-गंभीरता-द्वारा-फ़िल्टरिंग) और [Namespace फ़िल्टरिंग](#namespace-फ़िल्टरिंग) से पतला करें, जो इस बारे में सटीक हैं कि वे क्या हटाती हैं।

### Log संग्रह अक्षम करें

यदि आपको pod logs की आवश्यकता नहीं है:

```bash
helm install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --create-namespace \
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \
  --set oneuptime.apiKey="YOUR_ONEUPTIME_API_KEY" \
  --set clusterName="my-cluster" \
  --set logs.enabled=false
```

आपके मेट्रिक्स अप्रभावित रहते हैं: node collector kubelet, cAdvisor, और host मेट्रिक्स के लिए चलता रहता है, यह बस pod logs पढ़ना बंद कर देता है। Log-आधारित अलर्ट बंद हो जाते हैं, और कुछ नहीं।

### एक विशिष्ट Log संग्रह मोड को बाध्य करें

उन्नत उपयोगकर्ता preset की पसंद को `logs.mode` से ओवरराइड कर सकते हैं:

- `logs.mode=daemonset` — hostPath DaemonSet (सबसे कम ओवरहेड, hostPath की आवश्यकता है)
- `logs.mode=api` — Kubernetes API log tailer Deployment (किसी भी क्लस्टर पर काम करता है)
- `logs.mode=disabled` — कोई log संग्रह नहीं

> लॉग मोड केवल यह तय करता है कि **पॉड लॉग** कहाँ से आते हैं। नोड मेट्रिक्स इससे स्वतंत्र रूप से एकत्र किए जाते हैं, इसलिए `api` और `disabled` आपके kubelet, cAdvisor और होस्ट मेट्रिक्स को बनाए रखते हैं।
>
> एकमात्र अपवाद प्लेटफ़ॉर्म है, मोड नहीं: **EKS Fargate DaemonSets को बिल्कुल भी शेड्यूल नहीं कर सकता**, इसलिए वहाँ कोई नोड कलेक्टर नहीं है और नोड/पॉड/कंटेनर मेट्रिक्स उपलब्ध नहीं हैं। GKE Autopilot नोड कलेक्टर को ठीक से चलाता है, लेकिन `hostPath` को ब्लॉक करता है, इसलिए यह kubelet और cAdvisor मेट्रिक्स एकत्र करता है, लेकिन `hostmetrics` वाले (डिस्क I/O, inodes, NIC त्रुटियाँ) नहीं, जिन्हें होस्ट के `/proc` और `/sys` पढ़ने की आवश्यकता होती है।


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

## एकत्र किए गए डेटा की मात्रा कम करना

डिफ़ॉल्ट रूप से एजेंट **coverage** के लिए ट्यून किया गया है — यह पूरे क्लस्टर से मेट्रिक्स, pod logs, और eBPF traces भेजता है ताकि प्रत्येक डैशबोर्ड और मॉनिटर पहले ही दिन काम करे। बड़े या व्यस्त क्लस्टरों पर यह आपकी आवश्यकता से अधिक telemetry हो सकती है, जो उच्च ingest volume के रूप में दिखाई देती है (और, OneUptime Cloud पर, उच्च लागत)। यहाँ कुछ भी आवश्यक नहीं है, लेकिन यदि कोई क्लस्टर आपकी इच्छा से अधिक भेज रहा है, तो ये घुमाने के लिए घुंडियाँ हैं — मोटे तौर पर प्रभाव के क्रम में।

तरकीब यह है कि **जो आप नहीं देखेंगे उसे एकत्र करना बंद करें**, बजाय इसके कि सब कुछ एकत्र करें और उसे संग्रहीत करने के लिए भुगतान करें। नीचे दिया गया प्रत्येक लीवर एक Helm value है, इसलिए आप इसे `helm upgrade --reuse-values` पर `--set` के साथ लागू कर सकते हैं और उसी तरह वापस रोल कर सकते हैं।

### मात्रा कहाँ से आती है

| Signal                         | सबसे बड़ा कारक                                           | इसे कम करें                                                                                  |
| ------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **Pod logs**                   | प्रत्येक container से प्रत्येक line, cluster-wide        | `namespaceFilters`, `filters.logs.minSeverity`, `logs.enabled`, `logs.mode`                  |
| **eBPF traces & span metrics** | प्रत्येक instrumented process से प्रति request एक trace  | `sampling.traces.percentage`, `ebpf.enabled`, `ebpf.features.*`, `ebpf.autoTargetExe`, `ebpf.excludeExePaths` |
| **Metric data points**         | Scrape आवृत्ति × pods/containers की संख्या               | `collectionInterval`, `hostMetrics.collectionInterval`, `cadvisor.scrapeInterval`            |
| **Metric cardinality**         | विशिष्ट series की संख्या (प्रति-container, प्रति-PVC, …) | `filters.metrics.exclude`, `namespaceFilters.applyTo.metrics`, `cadvisor.metricsAllowlist`, `kubeletstats.volumeMetrics` |
| **Opt-in extras**              | Profiling, audit logs, control plane, inter-zone metrics | उन्हें बंद रखें (वे पहले से ही डिफ़ॉल्ट रूप से हैं)                                          |

मात्रा घटाने के तीन तरीके हैं, और यह जानना सार्थक है कि आप किसका उपयोग कर रहे हैं:

- **receiver पर** — डेटा कभी एकत्र ही नहीं किया जाता। pod logs पर `namespaceFilters`, `cadvisor.metricsAllowlist`, एक लंबा `collectionInterval`। चलाने में कोई लागत नहीं और CPU, egress, तथा ingest तीनों की बचत करता है। जहाँ भी ये आपके मामले को कवर करते हैं, हमेशा इन्हें प्राथमिकता दें।
- **filter processor पर** — डेटा एकत्र किया जाता है, फिर निर्यात से पहले गिरा दिया जाता है। `filters.logs.minSeverity`, `filters.metrics.*`, `namespaceFilters.applyTo.*`। थोड़ी अधिक collector CPU, लेकिन यह receivers के आर-पार काम करता है और ऐसी चीज़ें व्यक्त कर सकता है जो कोई receiver नहीं कर सकता।
- **sampler पर** — डेटा एकत्र किया जाता है, फिर एक प्रतिनिधि अंश रखा जाता है। `sampling.traces.percentage`। यह अलग ही किस्म का है: ऊपर के दोनों telemetry की एक पूरी *श्रेणी* हटाते हैं, इसलिए वे जो कुछ भी गिराते हैं वह प्रत्येक trace से गायब हो जाता है। सैंपलिंग हर श्रेणी को रखती है और आबादी को पतला करती है, इसलिए जो बचता है वह अब भी पूर्ण और प्रतिनिधि होता है।

तीनों **अपरिवर्तनीय** हैं: जो आप यहाँ गिराते हैं वह कभी OneUptime तक नहीं पहुँचता, और तीनों ही किसी monitor को शांत कर सकते हैं। पहले दो किसी monitor को उस signal को हटाकर शांत करते हैं जिसे वह देखता है। सैंपलिंग इससे संकरी है: eBPF RED मेट्रिक्स sampler के चलने से पहले गणना किए जाते हैं, इसलिए metric-आधारित monitors सटीक बने रहते हैं — लेकिन जो monitors *spans* गिनते हैं (`Span Count` पर Traces, `Exception Count` पर Exceptions) वे समानुपातिक रूप से कम देखते हैं और उनकी सीमाओं को उसी factor से पुनः ट्यून करना पड़ता है। यदि आप बाद में तय करना पसंद करेंगे, तो OneUptime इसके बजाय डेटा को सर्वर-साइड गिरा सकता है (**Logs → Settings → Drop Filters**, **Metrics → Settings → Pipeline Rules**) — उसमें अब भी egress की लागत लगती है, लेकिन वह एक ऐसी सेटिंग है जिसे आप बिना पुनः-डिप्लॉय किए बदल सकते हैं।

### लीवर 1 — Pod logs आमतौर पर सबसे बड़ा एकल स्रोत हैं

Container logs लगभग हमेशा ingest का सबसे बड़ा हिस्सा होते हैं, क्योंकि यह क्लस्टर में प्रत्येक container से प्रति log line एक रिकॉर्ड होता है।

- **केवल कुछ namespaces से logs चाहते हैं?** `namespaceFilters` दोनों log modes में pod logs को सीमित करता है (और उनके साथ eBPF traces को भी)। मिलान pod-log पथ पर होता है, इसलिए फ़िल्टर किए गए namespaces कभी पढ़े ही नहीं जाते — यह इस दस्तावेज़ का सबसे सस्ता लीवर है:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set "namespaceFilters.include={default,production}"
  ```

  (`kube-system` पहले से ही डिफ़ॉल्ट रूप से बाहर रखा जाता है।) एक को छोड़कर हर namespace रखने के लिए, `--set "namespaceFilters.exclude={kube-system,noisy-namespace}"` का उपयोग करें।

- **केवल चेतावनियों और त्रुटियों की परवाह है?** `filters.logs.minSeverity` बाकी को एजेंट पर गिरा देता है। एक बातूनी क्लस्टर पर यह अक्सर उपलब्ध सबसे बड़ी एकल कमी होती है, क्योंकि अधिकांश एप्लिकेशन आउटपुट का बड़ा हिस्सा INFO और DEBUG होता है:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.logs.minSeverity=WARN
  ```

  गंभीरता कैसे निर्धारित की जाती है और जिन logs को यह वर्गीकृत नहीं कर सकता उनका क्या होता है, इसके लिए [Log गंभीरता द्वारा फ़िल्टरिंग](#log-गंभीरता-द्वारा-फ़िल्टरिंग) देखें।

- **OneUptime से pod logs की बिल्कुल भी आवश्यकता नहीं है?** उन्हें बंद कर दें:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set logs.enabled=false
  ```

  > यह केवल पॉड लॉग रोकता है। नोड, पॉड और कंटेनर मेट्रिक्स प्रवाहित होते रहते हैं, और उन पर बने मॉनिटर (OOM kill, CPU थ्रॉटलिंग, PVC कम डिस्क) काम करते रहते हैं — नोड कलेक्टर बना रहता है, यह केवल `/var/log/pods` पढ़ना बंद कर देता है। `logs.mode: api` और `logs.mode: disabled` के लिए भी यही सच है।

### लीवर 2 — eBPF स्वतः-instrumentation छाँटें

eBPF आपको बिना किसी कोड परिवर्तन के traces, RED मेट्रिक्स, service map, और network-flow मेट्रिक्स देता है — लेकिन यह डेटा का दूसरा-सबसे बड़ा स्रोत भी है क्योंकि यह प्रति request एक span और प्रति service कई metric परिवार उत्सर्जित करता है। आपके पास नियंत्रण के तीन स्तर हैं:

- **पहले से ही OTel SDKs से traces भेज रहे हैं, या auto-traces नहीं चाहते?** eBPF को पूरी तरह से बंद कर दें:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.enabled=false
  ```

- **traces रखें, भारी metric परिवारों को हटाएँ।** [ऊपर दी गई signal-परिवार तालिका](#व्यक्तिगत-signal-परिवारों-को-टॉगल-करें) प्रत्येक `ebpf.features.*` flag को सूचीबद्ध करती है। सबसे अधिक-volume वाले परिवार network और span मेट्रिक्स हैं — उन्हें बंद करने से traces, HTTP RED मेट्रिक्स, और service map बरकरार रहते हैं:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.features.networkMetrics=false \
    --set ebpf.features.tcpStats=false \
    --set ebpf.features.spanMetrics=false
  ```

  `ebpf.features.networkInterZoneMetrics` को बंद रखें (इसका डिफ़ॉल्ट) — यह network-flow cardinality दोगुनी करता है।

- **केवल उन runtimes को instrument करें जिनकी आप परवाह करते हैं।** डिफ़ॉल्ट रूप से OBI प्रत्येक process से जुड़ता है जिसे वह पहचानता है (`ebpf.autoTargetExe: "*"`)। एजेंट द्वारा उत्पादित "services" और traces की संख्या कम करने के लिए इसे विशिष्ट runtimes तक सीमित करें, या skip सूची में binaries जोड़ें:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set ebpf.autoTargetExe='*/python,*/java'
  ```

  पूर्ण डिफ़ॉल्ट के लिए [व्यक्तिगत signal परिवारों को टॉगल करें](#व्यक्तिगत-signal-परिवारों-को-टॉगल-करें) और chart values में `excludeExePaths` नोट देखें।

### लीवर 3 — scrape intervals को धीमा करें

Metric volume सीधे इस बात के समानुपाती है कि एजेंट कितनी बार scrape करता है। किसी interval को दोगुना करना उस metric द्वारा उत्पादित data points की संख्या को मोटे तौर पर आधा कर देता है, coverage के किसी नुकसान के बिना — बस मोटे resolution के साथ। यदि आपको 30-सेकंड granularity की आवश्यकता नहीं है, तो 60s या 120s एक बड़ी, सुरक्षित कमी है:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set collectionInterval=60s \
  --set hostMetrics.collectionInterval=60s \
  --set cadvisor.scrapeInterval=60s
```

- `collectionInterval` (डिफ़ॉल्ट `30s`) node / pod / container मेट्रिक्स (`kubeletstats`) और cluster-state मेट्रिक्स (`k8s_cluster`) को संचालित करता है — metric volume का बड़ा हिस्सा।
- `hostMetrics.collectionInterval` और `cadvisor.scrapeInterval` प्रति-node OS मेट्रिक्स और throttling / OOM काउंटर को कवर करते हैं।
- `resourceSpecs.interval` (डिफ़ॉल्ट `300s`) नियंत्रित करता है कि पूर्ण resource specs (labels, annotations, status) कितनी बार खींचे जाते हैं — यदि आपको spec परिवर्तन जल्दी प्रतिबिंबित होने की आवश्यकता नहीं है तो इसे बढ़ाएँ।
- यदि आपने किसी वैकल्पिक scraper को सक्षम किया है, तो उनकी अपनी घुंडियाँ भी हैं: `kubeStateMetrics.scrapeInterval`, `serviceMesh.*.scrapeInterval`, `coreDns.scrapeInterval`, `csi.scrapeInterval`।

### लीवर 4 — metric cardinality को सीमित रखें

Cardinality (विशिष्ट time series की संख्या) आवृत्ति जितना ही मायने रखती है, क्योंकि प्रत्येक series को अलग से संग्रहीत और बिल किया जाता है।

- **cAdvisor जानबूझकर allowlisted है।** cAdvisor receiver (डिफ़ॉल्ट रूप से चालू) सैकड़ों मेट्रिक्स उत्सर्जित कर सकता है; chart केवल उन कुछ को अग्रेषित करता है जो monitors को शक्ति देते हैं (`cadvisor.metricsAllowlist`)। सूची को कसा हुआ रखें — **प्रत्येक प्रविष्टि प्रति-container रखी जाती है, इसलिए एक अतिरिक्त metric क्लस्टर की container गणना से गुणा हो जाता है।** kube-state-metrics डिफ़ॉल्ट रूप से बंद है, लेकिन यदि आप इसे सक्षम करते हैं (`kubeStateMetrics.enabled=true`) तो इसका `kubeStateMetrics.metricsAllowlist` उसी तरह cardinality को नियंत्रित करता है।
- **प्रति-PVC volume मेट्रिक्स** (`kubeletstats.volumeMetrics.enabled`, डिफ़ॉल्ट रूप से चालू) प्रति pod प्रति PVC एक series उत्सर्जित करते हैं। यह अधिकांश क्लस्टरों के लिए ठीक है लेकिन हजारों PVCs वाले stateful workloads (Kafka, databases) पर पर्याप्त हो सकता है — यदि आप PVC disk space नहीं देखते तो इसे वहाँ बंद कर दें:

  ```bash
  --set kubeletstats.volumeMetrics.enabled=false
  ```

- **Saturation मेट्रिक्स** (`kubeletstats.utilizationMetrics.enabled`, डिफ़ॉल्ट रूप से चालू) 8 व्युत्पन्न "% of request/limit" परिवार जोड़ते हैं। वे सस्ते हैं (कोई अतिरिक्त scrape नहीं) लेकिन यदि आप CPU/Memory-vs-limit monitors का उपयोग नहीं करते तो आप उन्हें `--set kubeletstats.utilizationMetrics.enabled=false` के साथ हटा सकते हैं।

- **नाम से विशिष्ट मेट्रिक्स गिराएँ।** ऊपर दी गई allowlists प्रति-receiver हैं; `filters.metrics.exclude` उन सभी तक फैलता है, इसलिए इसका उपयोग किसी भी ऐसी चीज़ के लिए करें जिसे receiver-स्तरीय घुंडियाँ व्यक्त नहीं कर सकतीं:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set filters.metrics.matchType=regexp \
    --set-json 'filters.metrics.exclude=["^container_network_"]'
  ```

  सटीक-बनाम-regex मिलान और allowlist रूप के लिए [नाम द्वारा मेट्रिक्स शामिल या बाहर करना](#नाम-द्वारा-मेट्रिक्स-शामिल-या-बाहर-करना) देखें।

- **किसी पूरे namespace के मेट्रिक्स गिराएँ।** यदि कोई namespace शोरगुल वाला है लेकिन आप फिर भी उसके nodes पर नज़र रखना चाहते हैं, तो `namespaceFilters.applyTo.metrics=true` आपकी मौजूदा namespace सूचियों को प्रति-pod और प्रति-container series पर लागू करता है। Node- और cluster-स्तरीय series हमेशा रखे जाते हैं:

  ```bash
  helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
    --namespace oneuptime-agent --reuse-values \
    --set namespaceFilters.applyTo.metrics=true
  ```

### लीवर 5 — भारी opt-in सुविधाओं को बंद रखें

ये **डिफ़ॉल्ट रूप से बंद** हैं ठीक इसलिए क्योंकि वे लोड जोड़ते हैं — किसी एक को केवल तभी सक्षम करें जब आप सक्रिय रूप से उसका उपयोग करते हैं जो वह शक्ति देता है, और यदि आप बस इसे आज़मा रहे थे तो इसे वापस बंद कर दें:

| Value                                                     | जोड़ता है                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `profiling.enabled`                                       | निरंतर CPU profiling DaemonSet — eBPF traces से भारी                                       |
| `auditLogs.enabled`                                       | प्रत्येक Kubernetes API request एक log रिकॉर्ड के रूप में (उच्च volume)                    |
| `controlPlane.enabled`                                    | etcd / API-server / scheduler / controller-manager मेट्रिक्स                               |
| `kubeStateMetrics.enabled`                                | CrashLoop / ImagePull / scheduling-reason मेट्रिक्स (एक KSM Deployment + scrape जोड़ता है) |
| `ebpf.features.networkInterZoneMetrics`                   | network-flow metric cardinality दोगुनी करता है                                             |
| `serviceMesh.enabled` / `csi.enabled` / `coreDns.enabled` | अतिरिक्त Prometheus scrape jobs                                                            |

### लीवर 6 — traces को गिराने के बजाय उनकी सैंपलिंग करें

ऊपर का प्रत्येक लीवर कुछ छोड़कर मात्रा खरीदता है: एक namespace जिसे आप देखना बंद कर देते हैं, एक गंभीरता जिसे आप रखना बंद कर देते हैं, एक metric परिवार जिसे आप एकत्र करना बंद कर देते हैं। सैंपलिंग अपवाद है, और एक व्यस्त क्लस्टर पर यह अक्सर सबसे कम नुकसान में उपलब्ध सबसे बड़ी कटौती होती है:

```bash
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --reuse-values \
  --set sampling.traces.percentage=10
```

यह trace volume में 90% की कटौती है, और इसका नुकसान यहाँ के किसी भी दूसरे लीवर से संकरा है:

- जो traces आप रखते हैं वे **पूरे** होते हैं — निर्णय trace ID को hash करता है, इसलिए किसी trace के सभी spans उसे साझा करते हैं। आपको कम traces मिलते हैं, टूटे हुए नहीं।
- आपके **RED मेट्रिक्स सटीक बने रहते हैं**। Request rate, error rate, और duration की गणना OBI प्रत्येक request से करता है और वे metrics पाइपलाइन से यात्रा करते हैं, जिसमें sampler है ही नहीं। उन पर बना प्रत्येक डैशबोर्ड और monitor पहले जैसा ही पढ़ता है।

जो आप गँवाते हैं वह ज़्यादातर उदाहरण traces है: जब कोई monitor fire होता है, तो खोलने के लिए आपके पास दसवाँ हिस्सा traces होते हैं। एक ऐसे क्लस्टर पर जो प्रति सेकंड हज़ारों समान requests कर रहा है, यह आमतौर पर एक अच्छा सौदा है — सौवाँ समान `/healthz` span आपको ऐसा कुछ नहीं सिखाता जो पहले ने न सिखाया हो। एक शांत क्लस्टर पर यह एक बुरा सौदा है, क्योंकि हो सकता है कि उस दुर्लभ request का आपके पास कोई उदाहरण ही न हो जिसने चीज़ें तोड़ीं।

अपवाद, और इसे रोल आउट करने से पहले जाँचने लायक एक चीज़: जो monitors मेट्रिक्स के बजाय **spans गिनते** हैं — `Span Count` पर Traces, `Exception Count` पर Exceptions — वे समानुपातिक रूप से कम देखते हैं, इसलिए उनकी सीमाओं को उसी factor से पुनः ट्यून करना पड़ता है। [Trace सैंपलिंग](#trace-सैंपलिंग) देखें।

इसे तब अपनाएँ जब eBPF traces आपके ingest का बड़ा हिस्सा हों लेकिन आप service map और RED मेट्रिक्स को बरकरार भी रखना चाहते हों। जब आप किसी चीज़ को instrument करना पूरी तरह बंद करना चाहते हों, तो लीवर 2 को प्राथमिकता दें।

पूर्ण व्यवहार के लिए [Trace सैंपलिंग](#trace-सैंपलिंग) देखें, जिसमें यह भी शामिल है कि `0` एक off स्विच के बजाय एक दर क्यों है और कोई log या metric समकक्ष क्यों नहीं है।

### एक हल्का शुरुआती बिंदु

यदि आप एक छोटा footprint चाहते हैं लेकिन फिर भी चाहते हैं कि monitors काम करें, तो यह प्रोफ़ाइल **पूर्ण metric coverage** रखती है और उन दो चीज़ों को काटती है जो वास्तव में मात्रा को संचालित करती हैं — log lines और eBPF spans:

```yaml
# lean-values.yaml
oneuptime:
  url: YOUR_ONEUPTIME_URL
  apiKey: YOUR_ONEUPTIME_API_KEY
clusterName: my-cluster

# Halve the metric data points. Coarser resolution, same coverage.
collectionInterval: 60s
hostMetrics:
  collectionInterval: 60s
cadvisor:
  scrapeInterval: 60s

# Keep pod logs, but only ship the ones worth alerting on. (Metrics do
# not depend on this — the node collector runs either way.)
logs:
  enabled: true
  mode: daemonset

filters:
  logs:
    minSeverity: WARN # drop INFO / DEBUG / TRACE at the agent

namespaceFilters:
  exclude:
    - kube-system
    - noisy-namespace

ebpf:
  enabled: true
  features:
    networkMetrics: false # the heaviest eBPF families
    tcpStats: false
    spanMetrics: false
```

```bash
helm upgrade --install kubernetes-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent --create-namespace \
  -f lean-values.yaml
```

आवश्यकतानुसार और कसें: `minSeverity` को `ERROR` तक बढ़ाएँ, `namespaceFilters.applyTo.metrics=true` जोड़ें, या यदि आप पहले से ही OTel SDKs से traces भेजते हैं तो `ebpf.enabled=false` सेट करें।

> **जो आप काटते हैं उस पर ध्यान दें।** कुछ monitors विशिष्ट signals पर निर्भर करते हैं: `cadvisor` को अक्षम करने से OOM-kill और CPU-throttling monitors हट जाते हैं; `kubeletstats.volumeMetrics` को अक्षम करने से PVC low-disk monitor हट जाता है; logs को अक्षम करने से log-आधारित अलर्ट हट जाते हैं; और `sampling.traces.percentage` किसी monitor को हटाता नहीं, बल्कि span-आधारित monitors को नीचे स्केल कर देता है (`Span Count` पर Traces, `Exception Count` पर Exceptions), इसलिए उनकी सीमाओं को उसी अनुसार पुनः ट्यून करें। उन signals को छाँटें जिन पर आप कार्रवाई नहीं करते, न कि उन्हें जिन्हें कोई monitor देख रहा है।

### प्रभाव को मापें

Telemetry उपयोग प्रति दिन एकत्रित किया जाता है, इसलिए कमी की पुष्टि करने के लिए **Project Settings → Usage History** के अंतर्गत एक या दो दिन में रुझान की जाँच करें — जैसे ही आप कोई परिवर्तन लागू करते हैं यह तुरंत नहीं हिलेगा। एक बार में एक लीवर बदलें ताकि आप अंतर का श्रेय दे सकें — logs बंद, फिर interval ऊपर, फिर eBPF छाँटा गया — बजाय इसके कि एक ही बार में सब कुछ कम कर दें और एक monitor खो दें जिस पर आप वास्तव में निर्भर थे।

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

1. पहले एक अस्वीकृत ingestion key को खारिज करें — यह सबसे आम कारण है और एजेंट पक्ष से अदृश्य है। ऊपर [एजेंट "Disconnected" दिखाता है](#एजेंट-disconnected-दिखाता-है) देखें (या बस diagnostic स्क्रिप्ट चलाएँ)।
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
