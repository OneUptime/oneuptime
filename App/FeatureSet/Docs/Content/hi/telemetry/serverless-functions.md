# सर्वरलेस फंक्शन्स

## अवलोकन

OneUptime किसी **Serverless Function** को उसी क्षण स्वतः पहचान लेता है जब उसे `faas.name` resource attribute के साथ टैग किया गया OpenTelemetry डेटा प्राप्त होता है। हाथ से कुछ भी बनाने की आवश्यकता नहीं है — अपने फंक्शन को अपने रनटाइम के लिए OpenTelemetry SDK से इंस्ट्रूमेंट करें, उसके OTLP एक्सपोर्टर को OneUptime की ओर इंगित करें, और फंक्शन अपने traces, logs और metrics के साथ **Serverless Functions** के अंतर्गत दिखाई देने लगता है।

यह AWS Lambda, Google Cloud Functions, Azure Functions, Cloudflare Workers, या किसी भी ऐसे FaaS रनटाइम के लिए काम करता है जो OpenTelemetry उत्सर्जित कर सकता है।

## पूर्वापेक्षाएं

- एक **OneUptime Telemetry Ingestion Token** — इसे *Project Settings → Telemetry Ingestion Keys* से बनाएं और `x-oneuptime-token` मान को कॉपी करें।
- आपके फंक्शन की भाषा के लिए OpenTelemetry SDK (या एक ऑटो-इंस्ट्रूमेंटेशन लेयर)।

## OneUptime किसी फंक्शन की पहचान कैसे करता है

OneUptime प्रत्येक फंक्शन को `faas.name` resource attribute पर की (key) करता है:

| Attribute | आवश्यक | उद्देश्य |
|---|---|---|
| `faas.name` | **हां** | फंक्शन पहचान (उदा. `checkout-handler`) |
| `faas.version` | नहीं | अवलोकन पर दिखाया गया |
| `faas.instance` | नहीं | **Instances** टैब के अंतर्गत प्रति-इंस्टेंस ट्रैक किया गया |
| `cloud.platform` | नहीं | `aws_lambda`, `gcp_cloud_functions`, `azure_functions`, ... |
| `cloud.provider` / `cloud.region` / `cloud.account.id` | नहीं | अवलोकन पर दिखाया गया |

> एक फंक्शन जो `service.name` भी सेट करता है, वह **Services** के अंतर्गत भी दिखाई देता है। **Serverless Functions** दृश्य FaaS-केंद्रित लेंस है, जिसका दायरा `faas.name` द्वारा निर्धारित होता है।

## चरण 1 — OTLP एक्सपोर्टर एनवायरनमेंट वैरिएबल सेट करें

अधिकांश भाषाओं के ऑटो-इंस्ट्रूमेंटेशन मानक OpenTelemetry एनवायरनमेंट वैरिएबल का सम्मान करते हैं:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="faas.name=checkout-handler,faas.version=1.4.2"
```

यदि आप OneUptime को स्वयं-होस्ट करते हैं, तो एंडपॉइंट को `https://YOUR-ONEUPTIME-HOST/otlp` से बदलें।

## चरण 2 — (AWS Lambda) OpenTelemetry लेयर जोड़ें

AWS Lambda के लिए सबसे सरल मार्ग [OpenTelemetry Lambda layer](https://opentelemetry.io/docs/faas/lambda-auto/) है। अपने रनटाइम के लिए लेयर संलग्न करें और सेट करें:

```bash
AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-handler
OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
```

लेयर फंक्शन नाम से `faas.name` स्वतः सेट कर देती है, और resource detector `cloud.platform`, `cloud.region` और `cloud.account.id` को भर देता है।

## आपको क्या मिलता है

जैसे ही फंक्शन कोई span, log या metric उत्सर्जित करता है, वह **Serverless Functions** के अंतर्गत दिखाई देने लगता है। अवलोकन दिखाता है:

- **Invocations**, **error rate** और **p95 duration** — आपके traces से व्युत्पन्न, एक चयन-योग्य समय सीमा पर, ट्रेंड चार्ट्स के साथ।
- **Instances** — देखे गए `faas.instance` मानों की एक लाइव गणना।
- इस फंक्शन के दायरे तक सीमित संपूर्ण **Logs**, **Traces** और **Metrics** टैब।

आप *Serverless → Settings → Label Rules / Owner Rules* के माध्यम से लेबल और मालिक भी स्वतः लागू कर सकते हैं।
