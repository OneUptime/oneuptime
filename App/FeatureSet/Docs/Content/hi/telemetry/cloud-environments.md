# Cloud Environments

## अवलोकन

OneUptime प्रबंधित क्लाउड कंप्यूट को **Cloud Environments** में समूहीकृत करता है — AWS ECS / Fargate, Google Cloud Run, Azure Container Apps / Container Instances, AWS Elastic Beanstalk, AWS App Runner और Azure App Service। `cloud.platform` + `cloud.account.id` + `cloud.region` के प्रत्येक अद्वितीय संयोजन के लिए एक environment बनाया जाता है, इसलिए *"AWS ECS · us-east-1 · 123456789012"* जैसा कुछ एक एकल इकाई है जो उस पर चल रहे हर workload को एकत्रित करती है।

रॉ वर्चुअल मशीनें (EC2, Compute Engine, Azure VM) **Hosts** बनी रहती हैं, और Kubernetes **Kubernetes** के अंतर्गत रहता है। यह दृश्य विशेष रूप से प्रबंधित / PaaS कंप्यूट के लिए है।

## पूर्वापेक्षाएँ

- एक **OneUptime Telemetry Ingestion Token** — इसे *Project Settings → Telemetry Ingestion Keys* से बनाएँ।
- आपके workloads में/के साथ चल रहा एक OpenTelemetry Collector या SDK।

## OneUptime किसी environment की पहचान कैसे करता है

| Attribute | आवश्यक | उद्देश्य |
|---|---|---|
| `cloud.platform` | **हाँ** | यह एक प्रबंधित-कंप्यूट प्लेटफ़ॉर्म होना चाहिए (उदा. `aws_ecs`, `gcp_cloud_run`, `azure_container_apps`) |
| `cloud.account.id` | नहीं | environment कुंजी का हिस्सा |
| `cloud.region` | नहीं | environment कुंजी का हिस्सा |
| `service.instance.id` | नहीं | **Instances** के अंतर्गत प्रति task/instance ट्रैक किया जाता है (लाइव CPU / memory के साथ) |

ये सामान्यतः OpenTelemetry **resource detectors** द्वारा स्वचालित रूप से भर दिए जाते हैं।

## चरण 1 — cloud resource detector सक्षम करें

OpenTelemetry Collector में, `resourcedetection` processor जोड़ें:

```yaml
processors:
  resourcedetection:
    detectors: [env, ecs]   # use [gcp] on Cloud Run, [azure] on Azure
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

- प्रति चल रहे task/instance के लिए **CPU** और **Memory** (`container.cpu.utilization` / `container.memory.usage` से), साथ ही एक **Top instances by CPU** सूची।
- **Instances** — tasks की एक लाइव गणना।
- आपके traces से व्युत्पन्न **Requests** और प्रवृत्ति चार्ट।
- पूर्ण **Logs**, **Traces**, **Metrics** और **Instances** टैब।

समान workloads के लिए प्रति-service विवरण **Services** के अंतर्गत उपलब्ध है।
