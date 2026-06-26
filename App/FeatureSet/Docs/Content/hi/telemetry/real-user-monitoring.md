# रियल यूज़र मॉनिटरिंग (ब्राउज़र और मोबाइल)

## अवलोकन

OneUptime आने वाली टेलीमेट्री को **RUM** के रूप में वर्गीकृत करता है जब वह क्लाइंट एट्रिब्यूट्स के साथ आती है — वेब के लिए `browser.*` या मोबाइल के लिए `device.*`। प्रत्येक एप्लिकेशन की पहचान उसके `service.name` से होती है और वह पूरी तरह से अपने RUM एप्लिकेशन के स्वामित्व में होता है (क्लाइंट टेलीमेट्री को कभी भी बैकएंड Service के रूप में डुप्लिकेट नहीं किया जाता)।

इसका उपयोग यह देखने के लिए करें कि आपके उपयोगकर्ता वास्तव में क्या अनुभव करते हैं: पेज व्यूज़, त्रुटियाँ, लेटेंसी, उपयोग में आने वाले प्लेटफ़ॉर्म / डिवाइस, और — जब आपका SDK उन्हें उत्सर्जित करता है — Core Web Vitals।

## पूर्वापेक्षाएँ

- एक **OneUptime Telemetry Ingestion Token** — इसे _Project Settings → Telemetry Ingestion Keys_ से बनाएँ।
- OpenTelemetry ब्राउज़र या मोबाइल SDK।

## OneUptime किसी RUM एप्लिकेशन की पहचान कैसे करता है

| एट्रिब्यूट               | आवश्यक        | उद्देश्य                                              |
| ------------------------ | ------------- | ----------------------------------------------------- |
| `service.name`           | **हाँ**       | एप्लिकेशन पहचान (उदा. `storefront-web`)               |
| `browser.*`              | वेब के लिए    | टेलीमेट्री को ब्राउज़र RUM के रूप में चिह्नित करता है |
| `device.*`               | मोबाइल के लिए | टेलीमेट्री को मोबाइल RUM के रूप में चिह्नित करता है   |
| `telemetry.sdk.language` | नहीं          | उदा. `webjs`, `swift`, अवलोकन पर दिखाया जाता है       |

## ब्राउज़र (OpenTelemetry Web)

OTLP/HTTP एक्सपोर्टर को OneUptime की ओर इंगित करें और `service.name` को अपने ऐप के नाम पर सेट करें:

```js
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

// OneUptime OTLP/HTTP exporter:
const exporter = new OTLPTraceExporter({
  url: "https://oneuptime.com/otlp/v1/traces",
  headers: { "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN" },
});

// Register `exporter` with your WebTracerProvider, using a resource of:
//   { "service.name": "storefront-web" }
```

ब्राउज़र इंस्ट्रुमेंटेशन स्वचालित रूप से `browser.*` रिसोर्स एट्रिब्यूट्स जोड़ता है — यही डेटा को RUM तक रूट करता है।

## मोबाइल (Swift / Android)

OpenTelemetry Swift या Android SDK का उपयोग करें, `service.name` सेट करें, और OTLP को OneUptime में एक्सपोर्ट करें:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
```

SDK के `device.*` एट्रिब्यूट्स टेलीमेट्री को RUM तक रूट करते हैं। यदि आप OneUptime को सेल्फ-होस्ट करते हैं, तो `https://YOUR-ONEUPTIME-HOST/otlp` का उपयोग करें।

## Core Web Vitals

यदि आपका ब्राउज़र इंस्ट्रुमेंटेशन वेब वाइटल्स (LCP, INP, CLS, FCP, TTFB) को OpenTelemetry मेट्रिक्स के रूप में उत्सर्जित करता है, तो OneUptime उन्हें एप्लिकेशन अवलोकन पर good / needs-improvement / poor रेटिंग के साथ प्रस्तुत करता है। यदि कोई वेब-वाइटल मेट्रिक्स रिपोर्ट नहीं की जाती, तो पैनल बताता है कि उन्हें भेजना कैसे शुरू करें।

## आपको क्या मिलता है

- **पेज व्यूज़**, **एरर रेट** और **p95 अवधि**, चयन योग्य रेंज पर ट्रेंड चार्ट्स के साथ।
- **क्लाइंट्स** — देखे गए ब्राउज़र प्लेटफ़ॉर्म / डिवाइस मॉडल।
- **Core Web Vitals** (जब रिपोर्ट की जाती है)।
- एप्लिकेशन तक सीमित पूर्ण **Logs**, **Traces** और **Metrics** टैब्स।
