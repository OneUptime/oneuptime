# Kubernetes Cost Observability

## अवलोकन

OneUptime आपको दिखा सकता है कि प्रत्येक Kubernetes workload की वास्तव में क्या लागत है — प्रति namespace, प्रति controller, और प्रति pod खर्च, साथ ही idle क्षमता और request-बनाम-usage दक्षता — ठीक उन मेट्रिक्स, logs, और traces के बगल में जो आप पहले से ही [Kubernetes Agent](/docs/telemetry/kubernetes-agent) से एकत्र करते हैं।

इसे सक्षम करना एक ही कमांड है:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true
```

यह अपने आप में एक पूर्ण इंस्टॉल है। यह chart open-source [OpenCost](https://opencost.io) इंजन (Apache-2.0, CNCF — वही [cost-model](https://github.com/kubecost/cost-model) जो Kubecost को भी शक्ति देता है) और साथ ही एक न्यूनतम, समर्पित Prometheus बंडल करता है जिसकी उसे usage इतिहास के लिए आवश्यकता है — अदृश्य plumbing के दो छोटे pods। OpenCost आपके nodes, volumes, और load balancers की कीमत आपके cloud provider की **सार्वजनिक सूची कीमतों से स्वचालित रूप से, बिना किसी credentials के** लगाता है (AWS, GCP, Azure); on-prem क्लस्टर इसके बजाय एक rate card सेट करते हैं (नीचे देखें)।

लगभग एक घंटे के भीतर (पहली बंद hourly window), आपको मिलता है:

- **प्रति क्लस्टर एक Costs पेज** (_Kubernetes → आपका क्लस्टर → Costs_): खर्च का रुझान, cpu/memory/storage विभाजन के साथ प्रति namespace खर्च, प्रति workload खर्च, idle खर्च, और दक्षता।
- **एक प्रोजेक्ट-स्तरीय Costs पेज** (_Kubernetes → Costs_): प्रोजेक्ट के प्रत्येक क्लस्टर में हुआ खर्च।
- **एक Kubernetes Cost डैशबोर्ड टेम्पलेट** (_Dashboards → Create → Kubernetes Cost Dashboard_): node की hourly लागत के रुझान, CPU/RAM इकाई लागतें, persistent volume और load balancer खर्च।
- **Metric Explorer** में कच्चे लागत मेट्रिक्स (`node_total_hourly_cost`, `pv_hourly_cost`, ...), जो कस्टम डैशबोर्ड और metric अलर्ट में उपयोग किए जा सकते हैं।

## यह कैसे काम करता है

`cost.enabled=true` के साथ chart चार चीज़ें चलाता है:

1. **OpenCost** (बंडल किया हुआ) — क्लस्टर पर नज़र रखता है, cloud सूची कीमतें खोजता है, और प्रति workload पूर्व-मूल्यांकित cost allocations की गणना करता है।
2. **एक न्यूनतम Prometheus** (बंडल किया हुआ) — OpenCost को usage/कीमत इतिहास के लिए एक PromQL endpoint की आवश्यकता होती है। यह केवल इसी के लिए मौजूद है: एक single replica, 3-दिन का retention, और ठीक दो scrape targets (API-server node proxy के माध्यम से cAdvisor, और स्वयं OpenCost — OpenCost अपने KSM-शैली के resource-request मेट्रिक्स स्वयं उत्सर्जित करता है, इसलिए kube-state-metrics शामिल नहीं है)। इसे कभी क्लस्टर के बाहर उजागर नहीं किया जाता और इसका डेटा कभी क्लस्टर नहीं छोड़ता।
3. **Cost allocation poller** (`cost.agent`) — प्रत्येक बंद hourly window पर एक बार OpenCost के Allocation API को poll करता है और प्रति-workload लागत पंक्तियाँ (cpu / ram / gpu / pv / network / load balancer / idle, साथ ही दक्षता) OneUptime को POST करता है। Windows ठीक एक बार ही भेजी जाती हैं — सर्वर उन windows को छोड़ देता है जिन्हें वह पहले ही ingest कर चुका है, इसलिए restarts खर्च की दोहरी गिनती नहीं कर सकते।
4. **एक cost metrics scrape** (`cost.metrics`) — एजेंट का OpenTelemetry collector OpenCost के Prometheus मेट्रिक्स (लागत series तक allowlisted) को उसी OTLP पाइपलाइन के माध्यम से scrape करता है जिससे आपके बाकी क्लस्टर मेट्रिक्स जाते हैं।

## पहले से Kubecost या OpenCost चला रहे हैं?

इसके बजाय chart को अपने मौजूदा इंजन की ओर इंगित करें — तब कुछ भी बंडल नहीं किया जाता:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-agent \
  --reuse-values \
  --set cost.enabled=true \
  --set cost.engine.url=http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090
```

| इंजन     | विशिष्ट service URL                                              |
| -------- | ---------------------------------------------------------------- |
| OpenCost | `http://opencost.opencost.svc.cluster.local:9003`                |
| Kubecost | `http://kubecost-cost-analyzer.kubecost.svc.cluster.local:9090`  |

Allocation API पथ स्वतः पहचाना जाता है (Kubecost के लिए `/model/allocation`, OpenCost के लिए `/allocation/compute` या `/allocation`)। `cost.engine.allocationPath` केवल गैर-मानक इंस्टॉल के लिए सेट करें।

## On-Prem / Bare-Metal मूल्य निर्धारण

जिन क्लस्टरों के nodes की कोई सार्वजनिक cloud सूची कीमत नहीं है, वे एक rate card सेट कर सकते हैं — फिर OpenCost प्रत्येक संसाधन की कीमत इन्हीं आँकड़ों से लगाता है। सभी मान **USD प्रति resource-hour** हैं:

```yaml
cost:
  enabled: true
  opencost:
    customPricing:
      enabled: true
      cpuPerCoreHour: "0.031611"       # ~$23 per core-month
      ramPerGiBHour: "0.004237"        # ~$3 per GiB-month
      storagePerGBHour: "0.00005479452" # ~$0.04 per GB-month
      gpuPerHour: "0.95"
```

## उपयोगी घुंडियाँ

सभी वैकल्पिक हैं — पूरी सूची के लिए chart का `values.yaml` देखें:

```yaml
cost:
  agent:
    windowSeconds: 3600   # allocation window length (hourly = native)
    includeIdle: true     # ship the engine's __idle__ allocation
    currency: USD         # currency code shown in the UI (informational)
  prometheus:
    retention: 3d         # bundled TSDB history — a few days is plenty
    persistence:
      enabled: false      # set true for a small PVC; emptyDir otherwise
  metrics:
    enabled: true         # cost metrics for dashboards / Metric Explorer
    scrapeInterval: 60s
```

## लागत पर अलर्टिंग

Scrape किए गए लागत मेट्रिक्स सामान्य OneUptime मेट्रिक्स हैं, इसलिए आप उन पर किसी भी अन्य चीज़ की तरह metric अलर्ट लगा सकते हैं — जैसे तब अलर्ट करें जब औसत `node_total_hourly_cost` किसी बजट सीमा से ऊपर उठे, या जब `pv_hourly_cost` किसी ऐसे volume class के लिए दिखाई दे जो क्लस्टर में मौजूद ही नहीं होना चाहिए।

## डेटा मॉडल और Retention

Allocation पंक्तियाँ ClickHouse में संग्रहीत की जाती हैं (प्रति क्लस्टर, window, namespace, controller, pod, और container एक पंक्ति) और क्लस्टर के telemetry retention का पालन करती हैं: Kubernetes क्लस्टर संसाधन पर `retainTelemetryDataForDays` सेटिंग, जो न होने पर प्रोजेक्ट के data retention पर वापस जाती है। Idle और unallocated क्षमता `__idle__` / `__unallocated__` namespaces के अंतर्गत सामान्य पंक्तियों के रूप में संग्रहीत की जाती है ताकि उन्हें workload खर्च के समान group-bys के साथ query किया जा सके।

## समस्या निवारण

- **Costs पेज खाली हैं** — cost एजेंट के logs जाँचें: `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-cost`। एक `401` का मतलब है कि ingestion key अमान्य है; `cost engine did not answer any known allocation path` का मतलब है कि इंजन अभी तक चालू नहीं है (बंडल किए गए OpenCost को इंस्टॉल के बाद अपनी पहली windows की कीमत लगाने में कुछ मिनट लगते हैं) या `cost.engine.url` गलत है।
- **बंडल किया गया OpenCost तैयार नहीं** — `kubectl logs -n <agent namespace> deploy/<release>-kubernetes-agent-opencost`। यह log करता है कि उसने कौन सा cloud provider पहचाना और मूल्य डेटा लोड हुआ या नहीं।
- **डैशबोर्ड टेम्पलेट कोई डेटा नहीं दिखाता** — टेम्पलेट scrape किए गए लागत मेट्रिक्स पढ़ता है; पुष्टि करें कि `cost.metrics.enabled` `true` है।
- **संख्याएँ इंजन के अपने UI से भिन्न हैं** — OneUptime प्रत्येक लागत घटक में इंजन के reconciliation समायोजन शामिल करता है और पूरी बंद windows भेजता है; चालू घंटे का आंशिक खर्च window बंद होने के बाद दिखाई देता है।
- **Prometheus pod पुनरारंभ हुआ** — डिफ़ॉल्ट `emptyDir` storage के साथ एक restart कुछ घंटों का usage इतिहास खो देता है, इसलिए उन windows के allocations छोटे हो सकते हैं। यदि यह आपके लिए मायने रखता है तो `cost.prometheus.persistence.enabled=true` सेट करें।
