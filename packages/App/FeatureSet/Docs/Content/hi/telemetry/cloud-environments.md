# Cloud Environments

## अवलोकन

OneUptime प्रबंधित क्लाउड कंप्यूट को **क्लाउड परिवेश** में समूहीकृत करता है — AWS ECS / Fargate, Google Cloud Run, Azure Container Apps / Container Instances, AWS Elastic Beanstalk, AWS App Runner और Azure App Service। `cloud.platform` + `cloud.account.id` + `cloud.region` के प्रत्येक अद्वितीय संयोजन के लिए एक environment बनाया जाता है, इसलिए _"AWS ECS · us-east-1 · 123456789012"_ जैसा कुछ एक एकल इकाई है जो उस पर चल रहे हर workload को एकत्रित करती है।

रॉ वर्चुअल मशीनें (EC2, Compute Engine, Azure VM) **होस्ट्स** बनी रहती हैं, और Kubernetes **Kubernetes** के अंतर्गत रहता है। यह दृश्य विशेष रूप से प्रबंधित / PaaS कंप्यूट के लिए है।

## पूर्वापेक्षाएँ

- एक **OneUptime Telemetry Ingestion Token** — इसे _प्रोजेक्ट सेटिंग्स → टेलीमेट्री और APM → इंजेशन कुंजियाँ_ से बनाएँ।
- आपके workloads में/के साथ चल रहा एक OpenTelemetry Collector या SDK।

## OneUptime किसी environment की पहचान कैसे करता है

| Attribute             | आवश्यक  | उद्देश्य                                                                                                |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `cloud.platform`      | **हाँ** | यह एक प्रबंधित-कंप्यूट प्लेटफ़ॉर्म होना चाहिए (उदा. `aws_ecs`, `gcp_cloud_run`, `azure_container_apps`) |
| `cloud.account.id`    | नहीं    | environment कुंजी का हिस्सा                                                                             |
| `cloud.region`        | नहीं    | environment कुंजी का हिस्सा                                                                             |
| `service.instance.id` | नहीं    | **इंस्टेंस** के अंतर्गत प्रति task/instance ट्रैक किया जाता है (लाइव CPU / memory के साथ)               |

ये सामान्यतः OpenTelemetry **resource detectors** द्वारा स्वचालित रूप से भर दिए जाते हैं।

## चरण 1 — cloud resource detector सक्षम करें

OpenTelemetry Collector में, `resourcedetection` processor जोड़ें:

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs] # use [gcp] on Cloud Run, [azure] on Azure
    timeout: 5s
```

किसी SDK के साथ, इसके बजाय `OTEL_RESOURCE_DETECTORS` सेट करें:

```bash
OTEL_RESOURCE_DETECTORS=env,ecs
```

## चरण 2 — OneUptime को OTLP एक्सपोर्ट करें

```yaml
exporters:
  otlphttp/oneuptime:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    metrics:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
    logs:
      receivers: [otlp]
      processors: [resourcedetection]
      exporters: [otlphttp/oneuptime]
```

यदि आप OneUptime को स्वयं-होस्ट करते हैं, तो `https://YOUR-ONEUPTIME-HOST/otlp` का उपयोग करें।

## आपको क्या मिलता है

environment अवलोकन दिखाता है:

- प्रति चल रहे task/instance के लिए **CPU** और **मेमोरी** (`container.cpu.utilization` / `container.memory.usage` से), साथ ही एक **CPU के अनुसार शीर्ष इंस्टेंस** सूची।
- **इंस्टेंस** — tasks की एक लाइव गणना।
- आपके traces से व्युत्पन्न **अनुरोध** और प्रवृत्ति चार्ट।
- पूर्ण **लॉग**, **ट्रेस**, **मेट्रिक्स** और **इंस्टेंस** टैब।

समान workloads के लिए प्रति-service विवरण **सेवाएं** के अंतर्गत उपलब्ध है।
