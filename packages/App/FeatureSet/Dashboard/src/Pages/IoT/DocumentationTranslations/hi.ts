import { SetupGuideTranslation } from "../../../Components/SetupGuide/SetupGuideTranslation";

/*
 * The IoT setup guide in Hindi (#8341): each piece of the English
 * guide's markdown (Pages/IoT/Utils/DocumentationMarkdown.ts) and its
 * Hindi. Code, field names and product names are as the English writes
 * them, and what the Dashboard draws is named as its Hindi words it.
 * Change it with the English, in the same pull request
 * (SetupGuideDocumentationInLocale).
 */
const TRANSLATION: SetupGuideTranslation = {
  "A device running an OpenTelemetry SDK that exports OTLP over HTTP":
    "OpenTelemetry SDK चलाने वाला ऐसा डिवाइस जो HTTP पर OTLP एक्सपोर्ट करता हो",
  "Network access from the device to your OneUptime instance":
    "डिवाइस से आपके OneUptime इंस्टेंस तक नेटवर्क पहुँच",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id. Keep `iot.fleet.name` stable: changing it registers a brand-new fleet.":
    "`building-a-sensors` और `sensor-001` को अपने फ़्लीट के नाम और डिवाइस id से बदलें। `iot.fleet.name` को स्थिर रखें: इसे बदलने से एक बिलकुल नया फ़्लीट रजिस्टर होता है।",
  "Pick an ingestion key in step 1 to fill in `<YOUR_API_KEY>`.":
    "`<YOUR_API_KEY>` भरने के लिए चरण 1 में एक इंजेशन कुंजी चुनें।",
  "Emit your readings as metrics named after the `iot_*` conventions, and give every datapoint a `device.id` attribute — for example:":
    "अपनी रीडिंग को `iot_*` नियमों के अनुसार नाम वाले मेट्रिक्स के रूप में भेजें, और हर डेटापॉइंट को एक `device.id` एट्रिब्यूट दें, उदाहरण के लिए:",
  "| Metric | Value | Datapoint attribute |":
    "| मेट्रिक | मान | डेटापॉइंट एट्रिब्यूट |",
  "The device inventory is keyed on the datapoint's `device.id`, not the resource's, so set it on each measurement as well as in `OTEL_RESOURCE_ATTRIBUTES`. Every recognized name is under **Metric conventions** in Advanced.":
    "डिवाइस इन्वेंटरी डेटापॉइंट के `device.id` पर आधारित है, रिसोर्स के नहीं, इसलिए इसे `OTEL_RESOURCE_ATTRIBUTES` के साथ-साथ हर माप पर भी सेट करें। पहचाने जाने वाले सभी नाम उन्नत में **मेट्रिक नियम** के अंतर्गत हैं।",
  "1. Confirm the device is exporting without errors — check the SDK's logs for export failures and HTTP `401` or `422` responses.":
    "1. पुष्टि करें कि डिवाइस बिना त्रुटि के एक्सपोर्ट कर रहा है: SDK के लॉग में एक्सपोर्ट विफलताएँ और HTTP `401` या `422` जवाब देखें।",
  "2. In the OneUptime dashboard, open the **IoT** section — your fleet should appear within a minute or so.":
    "2. OneUptime डैशबोर्ड में **IoT** सेक्शन खोलें: आपका फ़्लीट लगभग एक मिनट के भीतर दिख जाना चाहिए।",
  "3. Open the fleet's **Devices** tab — each `device.id` you sent should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. फ़्लीट का **डिवाइस** टैब खोलें: आपके भेजे हर `device.id` को उसकी नवीनतम बैटरी, सिग्नल, तापमान, CPU, मेमोरी और चालू/बंद स्थिति के साथ सूची में होना चाहिए।",
  "4. Open **Metrics** under the fleet to chart any of the `iot_*` series.":
    "4. किसी भी `iot_*` सीरीज़ का चार्ट बनाने के लिए फ़्लीट के अंतर्गत **मेट्रिक्स** खोलें।",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts using OpenTelemetry attributes:":
    "डिवाइस पर कोई एजेंट इंस्टॉल नहीं करना है। OneUptime, OpenTelemetry एट्रिब्यूट की मदद से आपके डिवाइस को दो अवधारणाओं से जोड़ता है:",
  "- **Fleet** — a logical group of devices (for example `building-a-sensors` or `field-gateways`). The fleet is derived from the `iot.fleet.name` resource attribute and appears in OneUptime as the telemetry service `iot/<fleet>`. Set `service.name=iot/<fleet>` so logs and metrics line up under the same service.":
    "- **फ़्लीट**: डिवाइस का एक तार्किक समूह (उदाहरण के लिए `building-a-sensors` या `field-gateways`)। फ़्लीट, `iot.fleet.name` रिसोर्स एट्रिब्यूट से तय होता है और OneUptime में टेलीमेट्री सर्विस `iot/<fleet>` के रूप में दिखता है। `service.name=iot/<fleet>` सेट करें, ताकि लॉग और मेट्रिक्स एक ही सर्विस के अंतर्गत आएँ।",
  "- **Device** — an individual device within a fleet, identified by the `device.id` attribute on each datapoint. OneUptime builds and maintains a per-fleet device inventory keyed on `device.id`.":
    "- **डिवाइस**: किसी फ़्लीट के भीतर एक अलग डिवाइस, जिसकी पहचान हर डेटापॉइंट के `device.id` एट्रिब्यूट से होती है। OneUptime, `device.id` के आधार पर हर फ़्लीट की डिवाइस इन्वेंटरी बनाता और बनाए रखता है।",
  "The attributes OneUptime reads — the optional ones refine how each device is classified and scoped in monitors:":
    "OneUptime जो एट्रिब्यूट पढ़ता है; वैकल्पिक एट्रिब्यूट यह और सटीक करते हैं कि हर डिवाइस का वर्गीकरण कैसे हो और मॉनिटर में उसका दायरा कैसे तय हो:",
  "| Attribute | Set on | Required | Description |":
    "| एट्रिब्यूट | कहाँ सेट होता है | ज़रूरी | विवरण |",
  "| `iot.fleet.name` | Resource | Yes | The fleet this device belongs to. Becomes the OneUptime service `iot/<fleet>` |":
    "| `iot.fleet.name` | रिसोर्स | हाँ | वह फ़्लीट जिससे यह डिवाइस जुड़ा है। OneUptime सर्विस `iot/<fleet>` बन जाता है |",
  "| `device.id` | Each datapoint | Yes | Stable, unique id for the device within the fleet |":
    "| `device.id` | हर डेटापॉइंट | हाँ | फ़्लीट के भीतर डिवाइस की स्थिर, अनोखी id |",
  "| `iot.device.kind` | Each datapoint | No | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | हर डेटापॉइंट | नहीं | डिवाइस की श्रेणी, उदाहरण के लिए `Device`, `Sensor` या `Gateway`। डिफ़ॉल्ट `Device` |",
  "| `iot.device.type` | Each datapoint | No | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | हर डेटापॉइंट | नहीं | मॉनिटर फ़िल्टर करने के लिए डिवाइस का और बारीक प्रकार या मॉडल (उदाहरण के लिए `temp-sensor`) |",
  "| `iot.device.firmware` | Each datapoint | No | Firmware version reported by the device |":
    "| `iot.device.firmware` | हर डेटापॉइंट | नहीं | डिवाइस द्वारा बताया गया फ़र्मवेयर संस्करण |",
  "OneUptime recognizes the following `iot_*` metric names. Each datapoint should carry the `device.id` label so the reading is attributed to the right device. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime इन `iot_*` मेट्रिक नामों को पहचानता है। हर डेटापॉइंट पर `device.id` लेबल होना चाहिए, ताकि रीडिंग सही डिवाइस से जोड़ी जाए। आपको सिर्फ़ वे मेट्रिक्स भेजने हैं जो आपके डिवाइस के लिए मायने रखते हैं: जो नहीं भेजे जाते, उनका चार्ट बस नहीं बनता।",
  "| Metric Name | Meaning |": "| मेट्रिक का नाम | अर्थ |",
  "| `iot_device_up` | Device availability. `1` = up/reachable, `0` = down. Drives the IoT Device monitor |":
    "| `iot_device_up` | डिवाइस की उपलब्धता। `1` = चालू/पहुँच में, `0` = बंद। IoT डिवाइस मॉनिटर को चलाता है |",
  "| `iot_device_info` | Identity-only signal. Carries `device.id` / kind / type / firmware so a device appears in the inventory even before it reports readings |":
    "| `iot_device_info` | सिर्फ़ पहचान वाला सिग्नल। `device.id` / श्रेणी / प्रकार / फ़र्मवेयर रखता है, ताकि डिवाइस रीडिंग भेजने से पहले ही इन्वेंटरी में दिख जाए |",
  "| `iot_battery_percent` | Battery charge level, `0`–`100` (%) |":
    "| `iot_battery_percent` | बैटरी का चार्ज स्तर, `0`–`100` (%) |",
  "| `iot_signal_strength_dbm` | Wireless signal strength in dBm (for example Wi-Fi / LoRa / cellular RSSI) |":
    "| `iot_signal_strength_dbm` | वायरलेस सिग्नल की ताकत dBm में (उदाहरण के लिए Wi-Fi / LoRa / सेल्युलर RSSI) |",
  "| `iot_temperature_celsius` | Device or sensor temperature in °C |":
    "| `iot_temperature_celsius` | डिवाइस या सेंसर का तापमान °C में |",
  "| `iot_cpu_usage_ratio` | CPU utilization as a ratio `0`–`1` (the device inventory shows it as a percentage) |":
    "| `iot_cpu_usage_ratio` | CPU उपयोग, `0`–`1` अनुपात के रूप में (डिवाइस इन्वेंटरी इसे प्रतिशत में दिखाती है) |",
  "| `iot_memory_usage_bytes` | Memory currently used, in bytes |":
    "| `iot_memory_usage_bytes` | इस समय इस्तेमाल हो रही मेमोरी, बाइट में |",
  "| `iot_memory_size_bytes` | Total memory available on the device, in bytes |":
    "| `iot_memory_size_bytes` | डिवाइस पर उपलब्ध कुल मेमोरी, बाइट में |",
  "| `iot_uptime_seconds` | Seconds since the device last booted |":
    "| `iot_uptime_seconds` | डिवाइस के पिछली बार बूट होने के बाद से सेकंड |",
  "1. Verify `iot.fleet.name` is set as a **resource** attribute (not a datapoint label), and that `service.name` is `iot/<fleet>`.":
    "1. जाँचें कि `iot.fleet.name` एक **रिसोर्स** एट्रिब्यूट के रूप में सेट है (डेटापॉइंट लेबल के रूप में नहीं), और `service.name` का मान `iot/<fleet>` है।",
  "2. Confirm the exporter endpoint is `<YOUR_ONEUPTIME_URL>/otlp` and the `x-oneuptime-token` header carries a valid ingestion key.":
    "2. पुष्टि करें कि एक्सपोर्टर का एंडपॉइंट `<YOUR_ONEUPTIME_URL>/otlp` है और `x-oneuptime-token` हेडर में एक मान्य इंजेशन कुंजी है।",
  "1. Make sure each datapoint carries a `device.id` label — devices are keyed on it.":
    "1. पक्का करें कि हर डेटापॉइंट पर `device.id` लेबल है: डिवाइस इसी के आधार पर पहचाने जाते हैं।",
  "2. Send `iot_device_info` (identity-only) for devices that have not yet reported readings so they still show up in the inventory.":
    "2. जिन डिवाइस ने अभी तक कोई रीडिंग नहीं भेजी है, उनके लिए `iot_device_info` (सिर्फ़ पहचान) भेजें, ताकि वे फिर भी इन्वेंटरी में दिखें।",
  "3. Check that `device.id` values are stable across reports; a changing id creates duplicate device rows.":
    "3. जाँचें कि `device.id` के मान हर रिपोर्ट में एक जैसे रहें; बदलती id से डिवाइस की डुप्लिकेट पंक्तियाँ बनती हैं।",
  "`401` means the ingestion key is missing, wrong or expired; `422` means it has been disabled, or is a browser key, which cannot send device telemetry. Select a different key above (or create a new one) and update the `x-oneuptime-token` header your device or collector sends.":
    "`401` का मतलब है कि इंजेशन कुंजी नहीं है, ग़लत है या उसकी अवधि ख़त्म हो गई है; `422` का मतलब है कि उसे निष्क्रिय किया गया है, या वह ब्राउज़र कुंजी है, जो डिवाइस टेलीमेट्री नहीं भेज सकती। ऊपर कोई दूसरी कुंजी चुनें (या नई बनाएँ) और वह `x-oneuptime-token` हेडर अपडेट करें जिसे आपका डिवाइस या कलेक्टर भेजता है।",
  "1. Use the exact `iot_*` metric names from **Metric conventions** under Advanced — other names are stored as generic metrics and do not populate the IoT charts.":
    "1. उन्नत में **मेट्रिक नियम** से `iot_*` मेट्रिक के सटीक नाम इस्तेमाल करें: दूसरे नाम सामान्य मेट्रिक्स के रूप में सहेजे जाते हैं और IoT चार्ट नहीं भरते।",
  "2. `iot_cpu_usage_ratio` is a `0`–`1` ratio; send the raw ratio and OneUptime renders it as a percentage.":
    "2. `iot_cpu_usage_ratio` एक `0`–`1` अनुपात है; कच्चा अनुपात भेजें, OneUptime उसे प्रतिशत में दिखाता है।",
  "3. Allow up to a minute for the first datapoints to surface after a device starts reporting.":
    "3. डिवाइस के रिपोर्ट शुरू करने के बाद पहले डेटापॉइंट दिखने में एक मिनट तक का समय दें।",
  "This sends the readings to the fleet **`fleet-1`**. Replace `sensor-001` with the device's id, and keep `iot.fleet.name` exactly as it is: another name registers a new fleet.":
    "यह रीडिंग को फ़्लीट **`fleet-1`** में भेजता है। `sensor-001` को डिवाइस की id से बदलें, और `iot.fleet.name` को ठीक वैसा ही रहने दें जैसा है: कोई दूसरा नाम एक नया फ़्लीट रजिस्टर करता है।",
  "A gateway that can run the OpenTelemetry Collector (with Docker, or the `otelcol-contrib` binary)":
    "ऐसा गेटवे जो OpenTelemetry Collector चला सके (Docker के साथ, या `otelcol-contrib` बाइनरी से)",
  "Devices that send OTLP to the gateway, and network access from the gateway to your OneUptime instance":
    "गेटवे को OTLP भेजने वाले डिवाइस, और गेटवे से आपके OneUptime इंस्टेंस तक नेटवर्क पहुँच",
  "Save this as `config.yaml` on the gateway:":
    "इसे गेटवे पर `config.yaml` के रूप में सहेजें:",
  "- Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- हर गेटवे के लिए `iot.fleet.name` (और उससे मेल खाता `service.name=iot/<fleet>`) सेट करें, ताकि हर गेटवे के डिवाइस सही फ़्लीट में पहुँचें।",
  "- Keep `device.id` (and optionally `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) on each datapoint so OneUptime can resolve the individual device inside the fleet.":
    "- हर डेटापॉइंट पर `device.id` (और वैकल्पिक रूप से `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) रखें, ताकि OneUptime फ़्लीट के भीतर अलग-अलग डिवाइस पहचान सके।",
  "Run it from the directory that holds `config.yaml`:":
    "इसे उस डायरेक्टरी से चलाएँ जिसमें `config.yaml` है:",
  "Devices then send OTLP to the gateway — gRPC on port `4317`, HTTP on port `4318` — for example with `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` in each device's SDK.":
    "इसके बाद डिवाइस गेटवे को OTLP भेजते हैं (gRPC पोर्ट `4317` पर, HTTP पोर्ट `4318` पर), उदाहरण के लिए हर डिवाइस के SDK में `OTEL_EXPORTER_OTLP_ENDPOINT=http://<gateway-host>:4318` के साथ।",
  "Already have `otelcol-contrib` on the gateway? Point it at the file:":
    "गेटवे पर पहले से `otelcol-contrib` है? उसे इस फ़ाइल की ओर इंगित करें:",
  "1. Confirm the gateway's collector is exporting without errors — check its logs for export failures and HTTP `401` or `422` responses (`docker logs -f otel-collector` when it runs in Docker).":
    "1. पुष्टि करें कि गेटवे का कलेक्टर बिना त्रुटि के एक्सपोर्ट कर रहा है: उसके लॉग में एक्सपोर्ट विफलताएँ और HTTP `401` या `422` जवाब देखें (Docker में चलने पर `docker logs -f otel-collector`)।",
  "- **`otlp`** receives from your devices over gRPC (`4317`) and HTTP (`4318`). Receive readings any other way the collector supports (an MQTT bridge, file logs, …) and forward them through the same pipeline.":
    "- **`otlp`** आपके डिवाइस से gRPC (`4317`) और HTTP (`4318`) पर डेटा लेता है। कलेक्टर जिस किसी दूसरे तरीके को सपोर्ट करता है (MQTT ब्रिज, फ़ाइल लॉग, …), उससे रीडिंग लें और उसी पाइपलाइन से आगे भेजें।",
  "- **`resource`** stamps every record with the fleet attributes. Set `iot.fleet.name` (and the matching `service.name=iot/<fleet>`) per gateway so each gateway's devices land in the right fleet.":
    "- **`resource`** हर रिकॉर्ड पर फ़्लीट के एट्रिब्यूट लगाता है। हर गेटवे के लिए `iot.fleet.name` (और उससे मेल खाता `service.name=iot/<fleet>`) सेट करें, ताकि हर गेटवे के डिवाइस सही फ़्लीट में पहुँचें।",
  "- **`batch`** groups records before export so the gateway does not pay one HTTP round trip per reading.":
    "- **`batch`** एक्सपोर्ट से पहले रिकॉर्ड को समूहों में जोड़ता है, ताकि गेटवे को हर रीडिंग के लिए एक HTTP राउंड ट्रिप न करना पड़े।",
  "- **`otlphttp`** sends to OneUptime over HTTPS with the ingestion token attached. Both the default protobuf encoding and `encoding: json` are accepted.":
    "- **`otlphttp`** इन्जेशन टोकन के साथ HTTPS पर OneUptime को भेजता है। डिफ़ॉल्ट protobuf एन्कोडिंग और `encoding: json` दोनों स्वीकार हैं।",
  "- Every reading this gateway forwards goes to the fleet **`fleet-1`**: keep `iot.fleet.name` and `service.name` exactly as they are, or the readings register a new fleet. A gateway for another fleet sets its own.":
    "- यह गेटवे जो भी रीडिंग आगे भेजता है, वह फ़्लीट **`fleet-1`** में जाती है: `iot.fleet.name` और `service.name` को ठीक वैसा ही रहने दें जैसे वे हैं, नहीं तो रीडिंग एक नया फ़्लीट रजिस्टर करेंगी। किसी दूसरे फ़्लीट का गेटवे अपने मान ख़ुद सेट करता है।",
  "Any MQTT client that can connect over WebSocket":
    "कोई भी MQTT क्लाइंट जो WebSocket पर कनेक्ट हो सके",
  "For example, with the Node.js `mqtt` client (`npm install mqtt`):":
    "उदाहरण के लिए, Node.js के `mqtt` क्लाइंट के साथ (`npm install mqtt`):",
  "Replace `building-a-sensors` and `sensor-001` with your fleet name and device id — OneUptime creates the fleet and the device from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "`building-a-sensors` और `sensor-001` को अपने फ़्लीट के नाम और डिवाइस id से बदलें: OneUptime टॉपिक से फ़्लीट और डिवाइस बनाता है। कनेक्शन टूटते ही Last Will डिवाइस को ऑफ़लाइन बताता है; सीधे कनेक्ट होने वाले डिवाइस के लिए उनका अपना क्रेडेंशियल बेहतर है (दोनों उन्नत में हैं)।",
  "1. Confirm the client connects and publishes without errors — a connection refused with return code 4 (bad username or password) means the key is wrong.":
    "1. पुष्टि करें कि क्लाइंट बिना त्रुटि के कनेक्ट और पब्लिश करता है: रिटर्न कोड 4 (ग़लत यूज़रनेम या पासवर्ड) के साथ अस्वीकार किया गया कनेक्शन बताता है कि कुंजी ग़लत है।",
  "3. Open the fleet's **Devices** tab — each device you published for should be listed with its latest battery, signal, temperature, CPU, memory, and up/down status.":
    "3. फ़्लीट का **डिवाइस** टैब खोलें: जिस भी डिवाइस के लिए आपने पब्लिश किया है, उसे उसकी नवीनतम बैटरी, सिग्नल, तापमान, CPU, मेमोरी और चालू/बंद स्थिति के साथ सूची में होना चाहिए।",
  "There is no agent to install on the device. OneUptime maps your devices onto two concepts, and with MQTT the topic sets both:":
    "डिवाइस पर कोई एजेंट इंस्टॉल नहीं करना है। OneUptime आपके डिवाइस को दो अवधारणाओं से जोड़ता है, और MQTT के साथ टॉपिक दोनों तय करता है:",
  "- **Fleet** — the `<fleet>` in `oneuptime/<fleet>/…`: a logical group of devices (for example `building-a-sensors`). It becomes the `iot.fleet.name` of the readings and appears in OneUptime as the telemetry service `iot/<fleet>`.":
    "- **फ़्लीट**: `oneuptime/<fleet>/…` में `<fleet>`, यानी डिवाइस का एक तार्किक समूह (उदाहरण के लिए `building-a-sensors`)। यह रीडिंग का `iot.fleet.name` बनता है और OneUptime में टेलीमेट्री सर्विस `iot/<fleet>` के रूप में दिखता है।",
  "- **Device** — the `<device>` in `oneuptime/<fleet>/<device>/…`: an individual device within the fleet. It becomes the `device.id` of every reading, and OneUptime builds and maintains a per-fleet device inventory keyed on it.":
    "- **डिवाइस**: `oneuptime/<fleet>/<device>/…` में `<device>`, यानी फ़्लीट के भीतर एक अलग डिवाइस। यह हर रीडिंग का `device.id` बनता है, और OneUptime इसी के आधार पर हर फ़्लीट की डिवाइस इन्वेंटरी बनाता और बनाए रखता है।",
  'Optional attributes refine how each device is classified and scoped in monitors. Put them in a telemetry publish\'s `"attributes"` map — they are stamped on every datapoint of that publish:':
    'वैकल्पिक एट्रिब्यूट यह और सटीक करते हैं कि हर डिवाइस का वर्गीकरण कैसे हो और मॉनिटर में उसका दायरा कैसे तय हो। इन्हें टेलीमेट्री पब्लिश के `"attributes"` मैप में रखें: ये उस पब्लिश के हर डेटापॉइंट पर लगाए जाते हैं:',
  "| Attribute | Description |": "| एट्रिब्यूट | विवरण |",
  "| `iot.device.kind` | The device class — for example `Device`, `Sensor`, or `Gateway`. Defaults to `Device` |":
    "| `iot.device.kind` | डिवाइस की श्रेणी, उदाहरण के लिए `Device`, `Sensor` या `Gateway`। डिफ़ॉल्ट `Device` |",
  "| `iot.device.type` | A finer device type/model used for filtering monitors (for example `temp-sensor`) |":
    "| `iot.device.type` | मॉनिटर फ़िल्टर करने के लिए डिवाइस का और बारीक प्रकार या मॉडल (उदाहरण के लिए `temp-sensor`) |",
  "| `iot.device.firmware` | Firmware version reported by the device |":
    "| `iot.device.firmware` | डिवाइस द्वारा बताया गया फ़र्मवेयर संस्करण |",
  "OneUptime recognizes the following `iot_*` metric names. Over MQTT the topic names the device, so every reading is attributed to it. You only need to send the metrics that make sense for your device — missing ones are simply not charted.":
    "OneUptime इन `iot_*` मेट्रिक नामों को पहचानता है। MQTT पर टॉपिक डिवाइस का नाम बताता है, इसलिए हर रीडिंग उसी से जोड़ी जाती है। आपको सिर्फ़ वे मेट्रिक्स भेजने हैं जो आपके डिवाइस के लिए मायने रखते हैं: जो नहीं भेजे जाते, उनका चार्ट बस नहीं बनता।",
  "The project-wide ingestion key suits gateways that publish on behalf of many devices. For devices that connect directly, register each device under the fleet's **Device Registry** tab: it issues a per-device credential — the credential ID is the MQTT **username** and the secret is the **password**. The fleet appears with its first reading, so send one with the project-wide key first, as in step 2.":
    "पूरे प्रोजेक्ट की इंजेशन कुंजी उन गेटवे के लिए ठीक है जो कई डिवाइस की ओर से पब्लिश करते हैं। सीधे कनेक्ट होने वाले डिवाइस के लिए, हर डिवाइस को फ़्लीट के **डिवाइस रजिस्ट्री** टैब में रजिस्टर करें: यह हर डिवाइस के लिए एक क्रेडेंशियल जारी करता है; क्रेडेंशियल ID, MQTT **यूज़रनेम** है और सीक्रेट **पासवर्ड** है। फ़्लीट अपनी पहली रीडिंग के साथ दिखता है, इसलिए पहले पूरे प्रोजेक्ट की कुंजी से एक रीडिंग भेजें, जैसा चरण 2 में है।",
  "- **Topic isolation** — a device credential can only publish under its own `oneuptime/<fleet>/<device>/…` topics; anything else is dropped.":
    "- **टॉपिक अलगाव**: डिवाइस का क्रेडेंशियल सिर्फ़ उसके अपने `oneuptime/<fleet>/<device>/…` टॉपिक में पब्लिश कर सकता है; बाकी सब छोड़ दिया जाता है।",
  "- **Individual revocation** — disable or delete one device's credential without touching the rest of the fleet; a connected device is cut off within a few seconds.":
    "- **अलग-अलग रद्दीकरण**: बाकी फ़्लीट को छुए बिना किसी एक डिवाइस का क्रेडेंशियल निष्क्रिय करें या हटाएँ; कनेक्टेड डिवाइस कुछ ही सेकंड में डिस्कनेक्ट हो जाता है।",
  "- **Silent-death offline detection** — a registered device stays in the inventory as offline when it stops reporting, instead of vanishing, even if it dies without a Last Will.":
    "- **चुपचाप बंद होने पर ऑफ़लाइन पहचान**: रजिस्टर किया गया डिवाइस रिपोर्ट करना बंद करने पर ग़ायब होने के बजाय इन्वेंटरी में ऑफ़लाइन के रूप में बना रहता है, भले ही वह बिना Last Will के बंद हो।",
  "Register an MQTT **Last Will** on `oneuptime/<fleet>/<device>/status` with payload `offline` — if the device dies, OneUptime publishes `iot_device_up = 0` on its behalf the moment the session drops, which trips the stock Device Offline alert template with no polling. Publish `online` to the same topic after connecting so the device shows as up again; the example in step 2 does both. Any reading the device publishes counts as up too, so a device that keeps sending readings stays up without publishing its status again. The status topic also accepts `1`/`0`, `true`/`false` and `up`/`down`.":
    "`oneuptime/<fleet>/<device>/status` पर पेलोड `offline` के साथ एक MQTT **Last Will** रजिस्टर करें: डिवाइस बंद होने पर, सेशन टूटते ही OneUptime उसकी ओर से `iot_device_up = 0` पब्लिश करता है, जिससे बिना पोलिंग के तैयार Device Offline अलर्ट टेम्पलेट ट्रिगर हो जाता है। कनेक्ट होने के बाद उसी टॉपिक पर `online` पब्लिश करें, ताकि डिवाइस फिर से चालू दिखे; चरण 2 का उदाहरण दोनों करता है। डिवाइस की पब्लिश की हुई हर रीडिंग भी चालू मानी जाती है, इसलिए जो डिवाइस रीडिंग भेजता रहता है वह अपनी स्थिति दोबारा पब्लिश किए बिना चालू रहता है। स्थिति टॉपिक `1`/`0`, `true`/`false` और `up`/`down` भी स्वीकार करता है।",
  "Keep the MQTT keepalive **under 5 minutes** on the WebSocket endpoint (client-library defaults of 60 s are fine) — idle WebSocket connections are closed after 300 seconds, which would fire the Last Will and a false offline alert.":
    "WebSocket एंडपॉइंट पर MQTT keepalive को **5 मिनट से कम** रखें (क्लाइंट लाइब्रेरी का डिफ़ॉल्ट 60 s ठीक है): निष्क्रिय WebSocket कनेक्शन 300 सेकंड बाद बंद कर दिए जाते हैं, जिससे Last Will और एक झूठा ऑफ़लाइन अलर्ट ट्रिगर हो जाएगा।",
  "Publish under the fixed `oneuptime/` prefix. The fleet and device segments must not contain `/`, `+` or `#` or start with `$`, and are limited to 100 characters.":
    "निश्चित उपसर्ग `oneuptime/` के अंतर्गत पब्लिश करें। फ़्लीट और डिवाइस सेगमेंट में `/`, `+` या `#` नहीं हो सकते, वे `$` से शुरू नहीं हो सकते, और उनकी सीमा 100 वर्ण है।",
  "| Topic | Payload |": "| टॉपिक | पेलोड |",
  '| `oneuptime/<fleet>/<device>/telemetry` | A JSON object of readings — `{"metrics":{"iot_temperature_celsius":21.5}}`, or a flat object whose numeric fields are the metrics |':
    '| `oneuptime/<fleet>/<device>/telemetry` | रीडिंग का एक JSON ऑब्जेक्ट, `{"metrics":{"iot_temperature_celsius":21.5}}`, या एक सपाट ऑब्जेक्ट जिसके संख्यात्मक फ़ील्ड ही मेट्रिक्स हैं |',
  '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | A single value — a bare number (`23.4`) or `{"value":23.4}` |':
    '| `oneuptime/<fleet>/<device>/metrics/<metricName>` | एक अकेला मान: सिर्फ़ संख्या (`23.4`) या `{"value":23.4}` |',
  "| `oneuptime/<fleet>/<device>/status` | `online` or `offline` — maps to `iot_device_up` |":
    "| `oneuptime/<fleet>/<device>/status` | `online` या `offline`, जो `iot_device_up` में बदलता है |",
  'Telemetry payloads may also carry `"attributes"` (a string map stamped on every datapoint — use it for `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, or your own labels) and `"timestamp"` (ISO-8601, or unix seconds/milliseconds). Both are optional; the ingest time is used when `timestamp` is absent.':
    'टेलीमेट्री पेलोड में `"attributes"` (हर डेटापॉइंट पर लगाया जाने वाला स्ट्रिंग मैप; इसे `iot.device.kind`, `iot.device.type`, `iot.device.firmware` या अपने लेबल के लिए इस्तेमाल करें) और `"timestamp"` (ISO-8601, या Unix सेकंड/मिलीसेकंड) भी हो सकते हैं। दोनों वैकल्पिक हैं; `timestamp` न होने पर इन्जेशन का समय इस्तेमाल होता है।',
  "The endpoint is ingestion-only: subscriptions are refused. A publish is capped at 128 KB and 100 metrics. Publishes outside this contract, or with malformed payloads, are accepted and dropped — MQTT 3.1.1 has no per-message error reply — and OneUptime logs a warning with the reason.":
    "यह एंडपॉइंट सिर्फ़ इन्जेशन के लिए है: सब्सक्रिप्शन अस्वीकार किए जाते हैं। एक पब्लिश की सीमा 128 KB और 100 मेट्रिक्स है। इस अनुबंध से बाहर के पब्लिश, या ग़लत बने पेलोड वाले पब्लिश, स्वीकार करके छोड़ दिए जाते हैं (MQTT 3.1.1 में हर संदेश पर त्रुटि का जवाब नहीं होता), और OneUptime कारण के साथ एक चेतावनी लॉग करता है।",
  "Self-hosted deployments can additionally expose raw MQTT TCP (`MQTT_INGEST_PORT`, default `1883`). The listener is internal to the cluster or compose network by default — expose it if your devices cannot speak WebSocket. The WebSocket keepalive ceiling does not apply there.":
    "सेल्फ़-होस्टेड डिप्लॉयमेंट अतिरिक्त रूप से TCP पर कच्चा MQTT भी खोल सकते हैं (`MQTT_INGEST_PORT`, डिफ़ॉल्ट `1883`)। लिसनर डिफ़ॉल्ट रूप से क्लस्टर या Compose नेटवर्क के भीतर ही रहता है: अगर आपके डिवाइस WebSocket का इस्तेमाल नहीं कर सकते, तो इसे खोलें। वहाँ WebSocket keepalive की ऊपरी सीमा लागू नहीं होती।",
  "Set `MQTT_INGEST_ENABLED=false` on the app service to turn the MQTT listeners off.":
    "MQTT लिसनर बंद करने के लिए ऐप सर्विस पर `MQTT_INGEST_ENABLED=false` सेट करें।",
  "1. Confirm the topic follows `oneuptime/<fleet>/<device>/…` exactly — the fleet segment of the topic is what creates the fleet.":
    "1. पुष्टि करें कि टॉपिक ठीक `oneuptime/<fleet>/<device>/…` के अनुसार है: फ़्लीट, टॉपिक के फ़्लीट सेगमेंट से ही बनता है।",
  "2. Publishes outside the topic contract, or with malformed payloads, are accepted and dropped (MQTT 3.1.1 has no per-message error reply). Compare yours with **MQTT topics and payloads** under Advanced; on a self-hosted instance the app's logs name the reason (`MQTT: dropped publish to …`).":
    "2. टॉपिक अनुबंध से बाहर के पब्लिश, या ग़लत बने पेलोड वाले पब्लिश, स्वीकार करके छोड़ दिए जाते हैं (MQTT 3.1.1 में हर संदेश पर त्रुटि का जवाब नहीं होता)। अपने पब्लिश की तुलना उन्नत में **MQTT टॉपिक और पेलोड** से करें; सेल्फ़-होस्टेड इंस्टेंस पर ऐप के लॉग कारण बताते हैं (`MQTT: dropped publish to …`)।",
  "OneUptime rejects bad credentials at CONNECT with return code 4. Check that:":
    "OneUptime ग़लत क्रेडेंशियल को CONNECT पर रिटर्न कोड 4 के साथ अस्वीकार करता है। जाँचें कि:",
  "- the password is a valid ingestion key — or, for a registered device, the credential's secret, with its credential ID as the username;":
    "- पासवर्ड एक मान्य इंजेशन कुंजी है, या रजिस्टर किए गए डिवाइस के लिए क्रेडेंशियल का सीक्रेट है, और यूज़रनेम उसका क्रेडेंशियल ID है;",
  "- the key is a server key (browser keys are refused over MQTT) and has not been disabled or expired.":
    "- कुंजी एक सर्वर कुंजी है (MQTT पर ब्राउज़र कुंजियाँ अस्वीकार की जाती हैं) और न तो निष्क्रिय है, न उसकी अवधि ख़त्म हुई है।",
  "1. The device id is the `<device>` segment of the topic — keep it stable across publishes; a changing id creates duplicate device rows.":
    "1. डिवाइस id, टॉपिक का `<device>` सेगमेंट है: इसे हर पब्लिश में एक जैसा रखें; बदलती id से डिवाइस की डुप्लिकेट पंक्तियाँ बनती हैं।",
  "2. Publish `iot_device_info` (identity-only) or a `status` message for devices that have not yet reported readings, so they still show up in the inventory.":
    "2. जिन डिवाइस ने अभी तक कोई रीडिंग नहीं भेजी है, उनके लिए `iot_device_info` (सिर्फ़ पहचान) या एक `status` संदेश पब्लिश करें, ताकि वे फिर भी इन्वेंटरी में दिखें।",
  "On the WebSocket endpoint, idle connections are closed after 300 seconds, which fires the Last Will and a false Device Offline alert. Keep the MQTT keepalive under 5 minutes — client-library defaults of 60 s are fine.":
    "WebSocket एंडपॉइंट पर निष्क्रिय कनेक्शन 300 सेकंड बाद बंद कर दिए जाते हैं, जिससे Last Will और एक झूठा Device Offline अलर्ट ट्रिगर होता है। MQTT keepalive को 5 मिनट से कम रखें; क्लाइंट लाइब्रेरी का डिफ़ॉल्ट 60 s ठीक है।",
  "Replace `sensor-001` with the device's id — OneUptime adds the device to the fleet **`fleet-1`** from the topic. The Last Will reports the device offline the moment its connection drops; devices that connect directly are better off with their own credential (both under Advanced).":
    "`sensor-001` को डिवाइस की id से बदलें: OneUptime टॉपिक से डिवाइस को फ़्लीट **`fleet-1`** में जोड़ता है। कनेक्शन टूटते ही Last Will डिवाइस को ऑफ़लाइन बताता है; सीधे कनेक्ट होने वाले डिवाइस के लिए उनका अपना क्रेडेंशियल बेहतर है (दोनों उन्नत में हैं)।",
};

export default TRANSLATION;
