# मोबाइल सेटअप

OpenTelemetry से किसी Android, iOS या React Native ऐप को इंस्ट्रुमेंट करें, ताकि वह OneUptime को मोबाइल RUM एप्लिकेशन के रूप में रिपोर्ट करे। OpenTelemetry SDK वाला कोई भी दूसरा प्लेटफ़ॉर्म इसी तरह काम करता है।

:::cards
- [OneUptime को क्या चाहिए](#oneuptime-को-क्या-चाहिए): दो रिसोर्स एट्रिब्यूट, मोबाइल कुंजी के साथ भेजे गए।
- [अपना प्लेटफ़ॉर्म सेट करें](#अपना-प्लेटफ़ॉर्म-सेट-करें): Android, iOS, React Native और बाकी।
- [iOS पर क्रैश और हैंग](#ios-पर-क्रैश-और-हैंग): अपवाद में MetricKit और KSCrash की रिपोर्ट, आपके dSYM से दिए गए नामों के साथ।
- [जाँचें कि डेटा पहुँचता है](#जाँचें-कि-डेटा-पहुँचता-है): कुंजी जाँचें, फिर ऐप ढूँढें।
- [मोबाइल पर सेशन रीप्ले](#मोबाइल-पर-सेशन-रीप्ले): React Native ऐप्स की रिकॉर्डिंग।
:::

## यह कैसे काम करता है

आपका ऐप, उस पर पिन की गई **मोबाइल** इंजेशन कुंजी के साथ, OTLP सीधे OneUptime को एक्सपोर्ट करता है, इसलिए वह जो कुछ भेजता है, सब उसी मोबाइल RUM एप्लिकेशन के रूप में दर्ज होता है। किसी भी दूसरी कुंजी के साथ, उसके रिसोर्स पर मौजूद `device.*` एट्रिब्यूट ही उसे बैकएंड सेवा के बजाय मोबाइल RUM के रूप में दर्ज करवाते हैं।

```mermaid title="मोबाइल ऐप क्या भेजता है, और किस कुंजी से"
flowchart TB
    app["आपका मोबाइल ऐप"] --> sdk["OpenTelemetry SDK<br/>device.* एट्रिब्यूट के साथ"]
    sdk -->|"मोबाइल कुंजी के<br/>साथ OTLP"| oneuptime["OneUptime"]
    oneuptime --> rum["मोबाइल RUM एप्लिकेशन"]
    replay["React Native<br/>रीप्ले SDK"] -->|"Browser कुंजी के<br/>साथ रिकॉर्डिंग"| oneuptime
```

## OneUptime को क्या चाहिए

आपका ऐप जो भी बैच एक्सपोर्ट करता है, उस हर बैच पर दो रिसोर्स एट्रिब्यूट:

| एट्रिब्यूट | यह क्या है |
| --- | --- |
| `service.name` | एप्लिकेशन की पहचान, जैसे `storefront-android`। |
| `device.id` या `device.model.identifier` | टेलीमेट्री को मोबाइल RUM के रूप में चिह्नित करता है। `device.model.identifier` **क्लाइंट्स** पेज भी भरता है। |

किसी दूसरी कुंजी के साथ भेजी गई टेलीमेट्री डिवाइस एट्रिब्यूट के बिना भी आती है और आप उस पर क्वेरी कर सकते हैं, लेकिन वह RUM एप्लिकेशन के बजाय बैकएंड सेवा के रूप में दर्ज होती है।

`device.manufacturer` भी बैच को मोबाइल के रूप में चिह्नित करता है, लेकिन केवल ऐसे रिसोर्स पर जिसमें कोई होस्ट पहचान न हो, क्योंकि होस्ट की इन्वेंटरी भी इसी से मशीन का निर्माता बताती है। नीचे की हर रेसिपी की तरह `device.id` या `device.model.identifier` भी सेट करें, फिर इससे कभी फ़र्क नहीं पड़ता।

`device.id` को इंस्टॉल-स्तर का पहचानकर्ता बनाएँ, कभी विज्ञापन ID या ऐसा कुछ नहीं जो किसी व्यक्ति की पहचान करे। OneUptime इसे केवल मोबाइल टेलीमेट्री पहचानने के लिए पढ़ता है।

## शुरू करने से पहले

- OpenTelemetry SDK वाला एक ऐप: OpenTelemetry Java SDK या OpenTelemetry Android, opentelemetry-swift, या React Native के लिए OpenTelemetry JavaScript SDK।
- एक **मोबाइल** इंजेशन कुंजी, जो **प्रोजेक्ट सेटिंग्स → टेलीमेट्री और APM → इंजेशन कुंजियाँ** में **इंजेशन कुंजी बनाएँ** से बनाई गई हो, और जिसके **पिन किया गया सेवा नाम** में आपके ऐप का `service.name` हो। मोबाइल ऐप से आई **ब्राउज़र** कुंजी अस्वीकार हो जाती है: उसकी जाँच `Origin` हेडर से होती है, जिसे मोबाइल SDK नहीं भेजते। ऐप में कभी **सर्वर** कुंजी न डालें।
- ये OTLP सेटिंग्स। अगर आप OneUptime खुद होस्ट करते हैं, तो `https://oneuptime.com` को अपने होस्ट से बदलें।

| सेटिंग | मान |
| --- | --- |
| OTLP एंडपॉइंट | `https://oneuptime.com/otlp` |
| हेडर | `x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN` |
| ट्रेस | `POST https://oneuptime.com/otlp/v1/traces` |
| मेट्रिक्स | `POST https://oneuptime.com/otlp/v1/metrics` |
| लॉग | `POST https://oneuptime.com/otlp/v1/logs` |

> [!WARNING]
> कुंजी आपके ऐप के अंदर जाती है, और ऐप को खोला जा सकता है, इसलिए मान लें कि कोई इसे कॉपी करेगा। मोबाइल कुंजी की कॉपी केवल इसी ऐप के ट्रेस, लॉग और मेट्रिक्स भेज सकती है, जो उसके **पिन किया गया सेवा नाम** के तहत दर्ज होते हैं, और कभी किसी वेब पेज से नहीं। फिर भी वह कुंजी की **प्रति मिनट अनुरोध सीमा** तक इस ऐप के लिए गढ़ा हुआ डेटा भेज सकती है, इसलिए **इस समय समाप्त होता है** की तारीख जोड़ें, और हर रिलीज़ के साथ कुंजी बदलें।

## अपना प्लेटफ़ॉर्म सेट करें

स्निपेट सेटअप का ढाँचा दिखाते हैं। मोबाइल OpenTelemetry SDK रिलीज़ के बीच अपने API बदलते हैं, इसलिए मेथड के नाम उस संस्करण से मिलाएँ जिसे आपने पिन किया है। OneUptime को जो चाहिए वह कभी नहीं बदलता: एंडपॉइंट, हेडर, `service.name` और एक `device.*` एट्रिब्यूट।

:::tabs
@tab Android
OpenTelemetry Java SDK और उसका OTLP एक्सपोर्टर इस्तेमाल करें, जो Android पर चलते हैं:

```kotlin title="app/build.gradle.kts"
dependencies {
    implementation(platform("io.opentelemetry:opentelemetry-bom:<latest>"))
    implementation("io.opentelemetry:opentelemetry-sdk")
    implementation("io.opentelemetry:opentelemetry-exporter-otlp")
}
```

```kotlin title="StorefrontApplication.kt"
import android.app.Application
import android.os.Build
import io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter
import io.opentelemetry.sdk.OpenTelemetrySdk
import io.opentelemetry.sdk.resources.Resource
import io.opentelemetry.sdk.trace.SdkTracerProvider
import io.opentelemetry.sdk.trace.export.BatchSpanProcessor

class StorefrontApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        val resource = Resource.getDefault().toBuilder()
            .put("service.name", "storefront-android")
            .put("device.manufacturer", Build.MANUFACTURER)
            .put("device.model.identifier", Build.MODEL)
            .build()

        val exporter = OtlpHttpSpanExporter.builder()
            .setEndpoint("https://oneuptime.com/otlp/v1/traces")
            .addHeader("x-oneuptime-token", BuildConfig.ONEUPTIME_TOKEN)
            .build()

        OpenTelemetrySdk.builder()
            .setTracerProvider(
                SdkTracerProvider.builder()
                    .setResource(resource)
                    .addSpanProcessor(BatchSpanProcessor.builder(exporter).build())
                    .build()
            )
            .buildAndRegisterGlobal()
    }
}
```

[OpenTelemetry Android](https://github.com/open-telemetry/opentelemetry-android) एजेंट इसके ऊपर क्रैश, ANR, धीमे और फ़्रीज़ हुए फ़्रेम और ऐप स्टार्ट जोड़ता है, और अपने रिसोर्स पर `device.model.identifier` और `device.manufacturer` सेट करता है। [Android सेटअप](/docs/rum/android-setup) ऊपर वाले कोड की जगह इसे सेट करता है।
@tab iOS
[opentelemetry-swift](https://github.com/open-telemetry/opentelemetry-swift) इस्तेमाल करें, और डिवाइस एट्रिब्यूट खुद सेट करें: हर संस्करण अपने आप जो रिसोर्स जोड़ता है, वह रिलीज़ के बीच बदलता रहा है।

```swift
let resource = Resource(attributes: [
    "service.name": .string("storefront-ios"),
    "device.model.identifier": .string(UIDevice.current.model),
    "device.manufacturer": .string("Apple"),
    "device.id": .string(UIDevice.current.identifierForVendor?.uuidString ?? ""),
    "telemetry.sdk.language": .string("swift"),
])

let exporter = OtlpHttpTraceExporter(
    endpoint: URL(string: "https://oneuptime.com/otlp/v1/traces")!,
    config: OtlpConfiguration(
        headers: [("x-oneuptime-token", oneUptimeToken)]
    )
)

OpenTelemetry.registerTracerProvider(
    tracerProvider: TracerProviderBuilder()
        .with(resource: resource)
        .add(spanProcessor: BatchSpanProcessor(spanExporter: exporter))
        .build()
)
```

`UIDevice.current.model` `iPhone` जैसा छोटा नाम देता है, जिससे **क्लाइंट्स** पेज पर हर तरह के डिवाइस की एक ही पंक्ति रहती है। `identifierForVendor` वह इंस्टॉल है जिसके आधार पर OneUptime क्रैश-मुक्त इंस्टॉल गिनता है, जैसा कि [सेशन रिकॉर्ड करें](#सेशन-रिकॉर्ड-करें) बताता है।
@tab React Native
React Native OpenTelemetry JavaScript SDK चलाता है, इसलिए प्रोवाइडर, OTLP एक्सपोर्टर और बैच प्रोसेसर [ब्राउज़र सेटअप](/docs/rum/browser-setup) की तरह बनाएँ, तीन बदलावों के साथ: **मोबाइल** कुंजी से भेजें, `browserDetector` और `DocumentLoadInstrumentation` हटा दें, और डिवाइस एट्रिब्यूट खुद सेट करें।

```ts
import { Platform } from "react-native";
import * as Device from "expo-device"; // or react-native-device-info
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";

const resource = defaultResource().merge(
  resourceFromAttributes({
    "service.name": "storefront-mobile",
    "device.manufacturer": Device.manufacturer ?? Platform.OS,
    "device.model.identifier":
      Device.modelId ?? Device.modelName ?? "unknown",
    "telemetry.sdk.language": "webjs",
  }),
);
```

`Device.modelId` केवल iOS पर सेट होता है, इसलिए Android पर `Device.modelName` इस्तेमाल होता है।
@tab दूसरे प्लेटफ़ॉर्म
Flutter, Unity, .NET MAUI, कोई एम्बेडेड क्लाइंट या आपका अपना OTLP राइटर, सब काम करते हैं, बशर्ते रिसोर्स में `service.name` और एक `device.*` एट्रिब्यूट हो। मानक OpenTelemetry एनवायरनमेंट वेरिएबल पढ़ने वाला SDK इन्हें जैसे के तैसे लेता है:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN"
OTEL_RESOURCE_ATTRIBUTES="service.name=storefront-mobile,device.manufacturer=Acme,device.model.identifier=AC-100"
```

SDK एंडपॉइंट में `/v1/traces`, `/v1/metrics` और `/v1/logs` खुद जोड़ता है।
:::

## iOS पर क्रैश और हैंग

opentelemetry-swift 2.3 और उसके बाद के संस्करण अपने MetricKit इंस्ट्रुमेंटेशन के ज़रिए iOS ऐप के क्रैश और हैंग रिपोर्ट करते हैं, जो Apple के हर डायग्नोस्टिक को OpenTelemetry को एक लॉग रिकॉर्ड के रूप में सौंपता है। OneUptime इन्हें वैसे ही दर्ज करता है जैसे OpenTelemetry Android के क्रैश और ANR, इसलिए ये **अपवाद** में और एप्लिकेशन के **अवलोकन** पर दिखते हैं:

| Apple का डायग्नोस्टिक | इवेंट नाम | अपवाद में |
| --- | --- | --- |
| क्रैश | `metrickit.diagnostic.crash` | एक अनहैंडल्ड अपवाद, जिसका प्रकार इससे तय होता है कि ऐप किस वजह से बंद हुआ: iOS 17 और उसके बाद Objective-C अपवाद, वरना Mach अपवाद (`EXC_BAD_ACCESS`), वरना सिग्नल (`SIGSEGV`) |
| हैंग | `metrickit.diagnostic.hang` | **Hang** प्रकार का एक अनहैंडल्ड अपवाद, जो iOS में ANR का समकक्ष है और जिसमें दर्ज रहता है कि हैंग कितनी देर चला |

अवलोकन की **क्रैश** टाइल क्रैश गिनती है, और उसकी **ANR** टाइल Android के ANR के साथ हैंग भी गिनती है। हर स्टैक ट्रेस किसी क्रैश रिपोर्ट के थ्रेड की तरह दिखाया जाता है, और जो थ्रेड क्रैश हुआ या हैंग हुआ, वह सबसे पहले आता है। आपके ऐप के कोड का फ़्रेम उसके बिल्ड का dSYM अपलोड होने के बाद उसके फ़ंक्शन के नाम से दिखता है, जैसे `CartViewController.checkout()`, जैसा कि [अपने dSYM अपलोड करें](#अपने-dsym-अपलोड-करें) में है। बाकी हर फ़्रेम अपनी बाइनरी का नाम और उसमें कोड का ऑफ़सेट बताता है, और **Binary Images** हर बाइनरी का UUID सूचीबद्ध करता है, जिससे पता चलता है कि किस बिल्ड का dSYM उसे नाम देता है।

क्रैश और हैंग उस थ्रेड पर आपके ऐप के फ़्रेम के आधार पर समूहित किए जाते हैं जो क्रैश या हैंग हुआ: जहाँ किसी dSYM ने उन्हें नाम दिया, वहाँ उनके फ़ंक्शन के आधार पर, ताकि एक क्रैश एक रिलीज़ से अगली रिलीज़ तक एक ही अपवाद बना रहे, और जहाँ किसी ने नाम नहीं दिया, वहाँ बाइनरी में उनके ऑफ़सेट के आधार पर, जो हर बिल्ड के साथ बदलते हैं। रिपोर्ट को पहुँचते ही नाम दिए जाते हैं, इसलिए किसी बिल्ड को शिप करने से पहले उसके dSYM अपलोड करें: जो क्रैश अपने dSYM से पहले पहुँचा, उसके ऑफ़सेट वैसे ही रहते हैं।

:::steps
### स्पैन के साथ लॉग भी एक्सपोर्ट करें

MetricKit डायग्नोस्टिक को लॉग रिकॉर्ड के रूप में रिपोर्ट करता है, इसलिए ट्रेसर प्रोवाइडर के साथ एक लॉगर प्रोवाइडर भी रजिस्टर करें, उसी रिसोर्स, एंडपॉइंट और हेडर के साथ:

```swift
let logExporter = OtlpHttpLogExporter(
    endpoint: URL(string: "https://oneuptime.com/otlp/v1/logs")!,
    config: OtlpConfiguration(
        headers: [("x-oneuptime-token", oneUptimeToken)]
    )
)

OpenTelemetry.registerLoggerProvider(
    loggerProvider: LoggerProviderBuilder()
        .with(resource: resource)
        .with(processors: [
            BatchLogRecordProcessor(logRecordExporter: logExporter),
        ])
        .build()
)
```

### MetricKit इंस्ट्रुमेंटेशन रजिस्टर करें

opentelemetry-swift का `MetricKitInstrumentation` प्रोडक्ट जोड़ें, और लॉगर प्रोवाइडर रजिस्टर होने के बाद इसे MetricKit के साथ रजिस्टर करें:

```swift
import MetricKit
import MetricKitInstrumentation

// MXMetricManager keeps only a weak reference: hold this for the app's lifetime.
let metricKitInstrumentation = MetricKitInstrumentation()
MXMetricManager.shared.add(metricKitInstrumentation)
```

### सेशन रिकॉर्ड करें

**सेशन** और **क्रैश-मुक्त सेशन** टाइलें आपके स्पैन पर `session.id` गिनती हैं। opentelemetry-swift का `Sessions` प्रोडक्ट इसे सेट करता है: ट्रेसर प्रोवाइडर में `SessionSpanProcessor` जोड़ें, और लॉग प्रोसेसर को `SessionLogRecordProcessor` में लपेटें, ताकि डायग्नोस्टिक के साथ भी सेशन रहे।

**क्रैश-मुक्त सेशन** के नीचे की पंक्ति उन इंस्टॉल का हिस्सा दिखाती है जो क्रैश नहीं हुए, और **Daily Crash Rate** और **Daily ANR Rate** उन इंस्टॉल के हिस्से पर अलर्ट करते हैं जो क्रैश हुए। इंस्टॉल ऊपर के रिसोर्स का `device.id` है, यानी ऐप का वेंडर पहचानकर्ता: किसी डिवाइस पर आपके सभी ऐप के लिए एक, जो तब तक बना रहता है जब तक उनमें से कोई भी इंस्टॉल रहे, इसलिए अपने इकलौते ऐप को फिर से इंस्टॉल करने पर नया इंस्टॉल बनता है और दो में से एक को फिर से इंस्टॉल करने पर नहीं। opentelemetry-swift की जो रिलीज़ `app.installation.id` सेट करती है, उसमें गिनती इसके बजाय उसी से होती है।

### अपने dSYM अपलोड करें

Xcode ऐप को आर्काइव करते समय आपके ऐप की हर बाइनरी के लिए एक dSYM लिखता है, और App Store Connect उन्हें **Download dSYMs** के तहत वापस देता है। हर आर्काइव के बाद, CI से या Xcode के किसी बिल्ड फ़ेज़ से, उन्हें [OneUptime CLI](/docs/cli/index) और अपने बिल्ड की अपनी सर्वर कुंजी के साथ अपलोड करें: **पिन किया गया सेवा नाम** वाली कुंजी, जैसे वह कुंजी जिसके साथ आपका ऐप शिप होता है, अस्वीकार कर दी जाती है, क्योंकि dSYM प्रोजेक्ट के हर उस ऐप के फ़्रेम को नाम देता है जो उसकी बाइनरी शिप करता है।

```bash
oneuptime dsym upload "$ARCHIVE_PATH/dSYMs" --app storefront-ios --url https://oneuptime.com --ingestion-key YOUR_TELEMETRY_INGESTION_TOKEN
```

CLI `.dSYM` बंडल, उनके फ़ोल्डर और ज़िप, और DWARF फ़ाइलें जहाँ भी हों, पढ़ता है, और हर बाइनरी का केवल UUID, आर्किटेक्चर और फ़ंक्शन के नाम भेजता है: किसी बड़े ऐप के dSYM सैकड़ों मेगाबाइट के होते हैं, उनके नाम कुछ ही मेगाबाइट के। CLI के बिना, किसी dSYM की DWARF फ़ाइल, या `.dSYM` बंडल की ज़िप, जैसी है वैसी ही भेजें, हर फ़ाइल 50 MB तक:

```bash
curl --fail -X POST "https://oneuptime.com/dsyms/v1/upload" \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN" \
  -F "appName=storefront-ios" \
  -F "dsym=@MyApp.app.dSYM/Contents/Resources/DWARF/MyApp"
```

हर बाइनरी उसके UUID के आधार पर 400 दिन तक रखी जाती है, ताकि जो रिलीज़ महीनों बाद भी लोगों के फ़ोन पर हो, उसे भी नाम मिलते रहें, और किसी बिल्ड को फिर से अपलोड करने पर उसके लिए रखी गई जानकारी बदल जाती है। dSYM प्रोजेक्ट का होता है, किसी एक ऐप का नहीं: जिस फ़्रेमवर्क को आपके दो ऐप एम्बेड करते हैं, उसे दोनों में नाम मिलते हैं।
:::

> [!NOTE]
> Apple MetricKit के डायग्नोस्टिक ऐप को किसी बाद के लॉन्च पर सौंपता है, iOS 15 और उसके बाद तुरंत, और उससे पहले दिन में एक बार, इसलिए कोई क्रैश या हैंग होने के कुछ मिनट या एक दिन बाद पहुँच सकता है, और पहुँचने पर ही गिना जाता है। iOS ऐप के अवलोकन पर "पिछले घंटे में 0 क्रैश" अभी अच्छी खबर नहीं है। डायग्नोस्टिक उस सेशन को साथ रखता है जिसने उसे रिपोर्ट किया, न कि उस सेशन को जिसे उसने खत्म किया।

opentelemetry-swift ऐप शुरू होने पर कोई स्पैन रिकॉर्ड नहीं करता, इसलिए **ऐप स्टार्ट** और **कोल्ड स्टार्ट (p95)** टाइलें तब तक खाली रहती हैं जब तक आपका ऐप खुद एक स्पैन रिकॉर्ड न करे: `AppStart` नाम का स्पैन, जिसमें `start.type` को `cold`, `warm` या `hot` पर सेट किया गया हो, प्रोसेस शुरू होने से लेकर पहली स्क्रीन तैयार होने तक।

### जब KSCrash भी क्रैश रिपोर्ट करे

opentelemetry-swift KSCrash के ज़रिए भी क्रैश रिपोर्ट कर सकता है, जो अगली बार ऐप खुलने पर अपनी रिपोर्ट `device.crash` लॉग रिकॉर्ड के रूप में भेजता है, उस समय के साथ जब ऐप क्रैश हुआ था। जो ऐप दोनों को रजिस्टर करता है, वह हर क्रैश दो बार रिपोर्ट करता है: KSCrash अगले लॉन्च पर, MetricKit अगले लॉन्च पर या एक दिन बाद तक। OneUptime ऐसे क्रैश को एक बार गिनता है: जो रिपोर्ट पहले पहुँचती है वह घटना होती है, और दूसरी उसके साथ, उसी अपवाद में, उसी क्रैश के सबूत के रूप में रखी जाती है, जिसे किसी टाइल, चार्ट या मॉनिटर में नहीं गिना जाता। अपवाद के **ऑकरेंस** में, उस घटना पर **दो बार रिपोर्ट किया गया** लिखा होता है।

दो रिपोर्ट को एक ही क्रैश तभी माना जाता है जब ये सभी शर्तें पूरी हों:

- वे दो अलग रिपोर्टर से आती हैं: KSCrash और MetricKit। कोई भी रिपोर्टर एक क्रैश को दो बार रिपोर्ट नहीं करता, इसलिए एक ही रिपोर्टर की दो रिपोर्ट दो क्रैश हैं।
- वे एक ही इंस्टॉल से आती हैं: वही `app.installation.id`, या `device.id`।
- उनके बीच 26 घंटे से ज़्यादा का अंतर नहीं है: MetricKit किसी क्रैश पर उस दिन के अंत का समय लगाता है जिसकी वह रिपोर्ट करता है, और KSCrash क्रैश के पल का।
- सिग्नल, Mach अपवाद और Objective-C अपवाद पर वे मेल खाती हैं, जहाँ भी दोनों इनमें से किसी का नाम बताती हों।
- जो थ्रेड क्रैश हुए, वे थ्रेड के शुरू होने की जगह से अंदर की ओर, बाइनरी और ऑफ़सेट के आधार पर, फ़्रेम-दर-फ़्रेम मेल खाते हैं, आपके ऐप के कोड के हर उस फ़्रेम पर जिसका नाम दोनों में से कोई भी बताती हो। जो क्रैश पूरी तरह Apple के कोड में हुआ हो, उसे कम से कम तीन फ़्रेम पर मेल खाना चाहिए, और उन सभी पर।

हर रिपोर्ट को एक बार जोड़ा जाता है, समय में सबसे नज़दीकी रिपोर्ट के साथ, इसलिए एक ही इंस्टॉल पर एक ही बग से कुछ मिनट के अंतर पर हुए दो क्रैश दो घटनाएँ हैं, हर एक अपनी दूसरी रिपोर्ट के साथ। जब OneUptime किसी रिपोर्ट की तुलना उसके इंस्टॉल की बाकी रिपोर्ट से नहीं कर पाता, तो वह उसे गिन लेता है, इसलिए कोई क्रैश ज़्यादा से ज़्यादा दो बार गिना जाता है, पर कभी खोता नहीं।

## जाँचें कि डेटा पहुँचता है

:::steps
### कुंजी जाँचें

SDK की सेटिंग्स खँगालने से पहले OneUptime से पूछें कि वह कुंजी स्वीकार करता है या नहीं:

```bash
curl -i https://oneuptime.com/otlp/v1/validate \
  -H "x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN"
```

`"valid": true` के साथ `200` का मतलब है कि कुंजी स्वीकार है। Browser कुंजी भी `200` लौटाती है, लेकिन उसका संदेश कहता है कि यह केवल ब्राउज़र से काम करती है: मोबाइल ऐप को मोबाइल कुंजी चाहिए। `401` का मतलब है कि कुंजी अज्ञात, रद्द, बंद या समाप्त है, और कोई भी SDK सेटिंग इसे ठीक नहीं करेगी।

### ऐप चलाएँ

ऐप चलाएँ और थोड़ी देर इस्तेमाल करें। टेलीमेट्री के पहले बैच पर यह अपने `service.name` के नाम से **उत्पाद → संसाधन → वास्तविक उपयोगकर्ता मॉनिटरिंग** में दिखाई देता है।

### क्लाइंट्स पेज खोलें

एप्लिकेशन का **क्लाइंट्स** पेज खोलें: `device.model.identifier` के हर डिवाइस मॉडल की एक पंक्ति होती है। अगर **ट्रेस** भरता रहे और यह पेज खाली रहे, तो डिवाइस एट्रिब्यूट रिसोर्स तक नहीं पहुँच रहे।
:::

## मोबाइल पर सेशन रीप्ले

React Native ऐप `@oneuptime/react-native-replay` से सेशन रिकॉर्ड कर सकते हैं। यह नेटिव व्यू ट्री को वायरफ़्रेम के रूप में रिकॉर्ड करता है, कभी स्क्रीनशॉट या स्क्रीन का टेक्स्ट नहीं, और इसकी रिकॉर्डिंग वेब रिकॉर्डिंग वाले प्लेयर में ही खुलती हैं। यह **ब्राउज़र** कुंजी से भेजता है, जिसके **अनुमत ऑरिजिन** में आपका ऐप `app://` के बाद उसकी Android एप्लिकेशन ID या iOS बंडल ID के रूप में दर्ज होता है: यह आपके OpenTelemetry SDK की मोबाइल कुंजी से अलग कुंजी है। [React Native में इंस्टॉल करें](/docs/telemetry/session-replay#react-native-में-इंस्टॉल-करें) इसे चरण दर चरण बताता है।

नेटिव Android और iOS ऐप, और दूसरे प्लेटफ़ॉर्म, में कोई सेशन रिकॉर्डर नहीं है: उनका **सेशन रीप्ले** पेज खाली रहता है, जबकि ट्रेस, लॉग, मेट्रिक्स, अपवाद और **क्लाइंट्स** पेज सामान्य रूप से काम करते हैं।

## समस्या निवारण

:::details कुंजी जाँच 401 लौटाती है, या कुंजी अस्वीकार होती है
`401` का मतलब है कि कुंजी अज्ञात, रद्द, बंद या समाप्त है: एक मोबाइल कुंजी बनाएँ और उसके साथ ऐप फिर से बिल्ड करें।

Browser कुंजी जाँच पास कर लेती है, लेकिन मोबाइल ऐप का हर एक्सपोर्ट `422` के साथ अस्वीकार होता है, जिसमें लिखा होता है `This request did not send an Origin header, so it cannot be checked against the allowed origins of this browser ingestion key. Use a mobile ingestion key in a mobile app, and a server ingestion key on a server.` **मोबाइल** कुंजी इस्तेमाल करें। मोबाइल कुंजी भी gRPC पर और किसी वेब पेज से `422` के साथ अस्वीकार होती है: OTLP/HTTP पर एक्सपोर्ट करें।
:::

:::details ऐप वास्तविक उपयोगकर्ता मॉनिटरिंग के बजाय सेवाएं में दिखता है
टेलीमेट्री मोबाइल कुंजी के अलावा किसी दूसरी कुंजी से भेजी गई थी, और उसके रिसोर्स में न `device.id` है और न `device.model.identifier`, इसलिए वह बैकएंड सेवा के रूप में दर्ज हुई। मोबाइल कुंजी से भेजें, या इन्हें [अपना प्लेटफ़ॉर्म सेट करें](#अपना-प्लेटफ़ॉर्म-सेट-करें) की तरह सेट करें।

जो सेवा पहले ही बन चुकी है वह RUM एप्लिकेशन में नहीं बदलती, इसलिए RUM टेलीमेट्री आने के बाद उसे **उत्पाद → सेवाएं** में हटा दें।
:::

:::details क्लाइंट्स पेज खाली है
क्लाइंट पंक्तियाँ केवल `device.model.identifier` से आती हैं। जो SDK केवल `device.id` या `device.manufacturer` सेट करता है, वह ऐप को मोबाइल RUM के रूप में दर्ज करवाता है, लेकिन कोई क्लाइंट नहीं दिखाता: `device.model.identifier` भी सेट करें।
:::

:::details लोग ऐप इस्तेमाल कर रहे हैं, फिर भी स्थिति हाल में कोई ट्रैफ़िक नहीं दिखाती है
15 मिनट तक कोई टेलीमेट्री न आने पर स्थिति **हाल में कोई ट्रैफ़िक नहीं** हो जाती है। अगर लोग ऐप इस्तेमाल कर रहे हैं:

- हो सकता है कोई सैंपलर सब कुछ छोड़ रहा हो: always-off सैंपलर, या बहुत कम अनुपात देखें।
- हो सकता है ऐप टेलीमेट्री केवल उन कार्रवाइयों के लिए भेजता हो जो उस समय में किसी ने नहीं कीं।
- हो सकता है रिलीज़ के बाद कुंजी रद्द हो गई हो या समाप्त हो गई हो: [जाँचें कि डेटा पहुँचता है](#जाँचें-कि-डेटा-पहुँचता-है) की तरह इसे जाँचें।
:::

## अगले कदम

:::cards
- [सेशन रीप्ले](/docs/telemetry/session-replay): React Native सेशन को उनके ट्रेस के साथ रिकॉर्ड करें।
- [एप्लिकेशन प्रबंधित करना](/docs/rum/applications): नाम, लेबल, स्वामी और रिटेंशन।
- [OpenTelemetry](/docs/telemetry/open-telemetry): OTLP एंडपॉइंट, सीमाएँ और त्रुटियाँ विस्तार से।
- [RUM समस्या निवारण](/docs/rum/troubleshooting): हर जाँच, उसी क्रम में जिसमें समस्याएँ आमतौर पर होती हैं।
:::
