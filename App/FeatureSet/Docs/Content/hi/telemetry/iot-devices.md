# OneUptime IoT डिवाइस

## अवलोकन

OneUptime IoT डिवाइसों के फ्लीट — सेंसर, गेटवे, कंट्रोलर और एज बॉक्स — की निगरानी मानक OpenTelemetry (OTLP) मेट्रिक्स को इन्जेस्ट करके करता है। प्रत्येक डिवाइस (या उसकी ओर से कोई गेटवे) `iot_*` मेट्रिक्स का एक छोटा सेट OTLP HTTP पर पुश करता है, जिसे इस बात से टैग किया जाता है कि वह किस **फ्लीट** से संबंधित है और उसकी अपनी **device id** क्या है। OneUptime उन मेट्रिक्स को एक फ्लीट में समूहित करता है, एक लाइव डिवाइस इन्वेंट्री बनाता है, और प्रति-डिवाइस बैटरी, कनेक्टिविटी, तापमान, CPU, मेमोरी और उपलब्धता को ट्रैक करता है।

डिवाइस की ओर इंस्टॉल करने के लिए कोई एजेंट नहीं है — कोई भी चीज़ जो OTLP बोल सकती है (डिवाइस पर एक OpenTelemetry SDK, या एक गेटवे पर चलने वाला OpenTelemetry Collector जो कई डिवाइसों में फैन-आउट करता है) काम करती है। यह पेज **इन्जेस्शन गाइड** है। आपके द्वारा पुश किए गए डेटा के ऊपर IoT मॉनिटर और अलर्ट कॉन्फ़िगर करने के लिए, देखें [IoT Device Monitor](/docs/monitor/iot-device-monitor)।

## पूर्वापेक्षाएँ

- एक डिवाइस, गेटवे या कलेक्टर जो OneUptime को OTLP/HTTP भेज सकता है
- डिवाइस/गेटवे से आपके OneUptime इंस्टेंस तक नेटवर्क पहुँच
- एक **OneUptime Telemetry Ingestion Token** — इसे _Project Settings → Telemetry Ingestion Keys_ से बनाएँ और `x-oneuptime-token` मान को कॉपी करें

## OneUptime IoT को कैसे मॉडल करता है

OneUptime OpenTelemetry रिसोर्स एट्रिब्यूट्स का उपयोग करके आपके डिवाइसों को दो अवधारणाओं पर मैप करता है:

- **Fleet** — डिवाइसों का एक तार्किक समूह (उदाहरण के लिए `building-a-sensors` या `field-gateways`)। फ्लीट `iot.fleet.name` रिसोर्स एट्रिब्यूट से प्राप्त होता है और OneUptime में टेलीमेट्री सेवा `iot/<fleet>` के रूप में दिखाई देता है। `service.name=iot/<fleet>` सेट करें ताकि लॉग और मेट्रिक्स एक ही सेवा के अंतर्गत संरेखित हों।
- **Device** — एक फ्लीट के भीतर एक व्यक्तिगत डिवाइस, जिसे `device.id` एट्रिब्यूट द्वारा पहचाना जाता है। OneUptime `device.id` पर कीड एक प्रति-फ्लीट डिवाइस इन्वेंट्री बनाता और बनाए रखता है।

वैकल्पिक एट्रिब्यूट्स यह परिष्कृत करते हैं कि मॉनिटर में प्रत्येक डिवाइस को कैसे वर्गीकृत और स्कोप किया जाता है:

| एट्रिब्यूट            | आवश्यक | विवरण                                                                      |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `iot.fleet.name`     | हाँ      | वह फ्लीट जिससे यह डिवाइस संबंधित है। OneUptime सेवा `iot/<fleet>` बन जाता है    |
| `device.id`          | हाँ      | फ्लीट के भीतर डिवाइस के लिए स्थिर, अद्वितीय id                                |
| `iot.device.kind`    | नहीं      | डिवाइस वर्ग — उदाहरण के लिए `Device`, `Sensor`, या `Gateway`। डिफ़ॉल्ट `Device` होता है |
| `iot.device.type`    | नहीं      | मॉनिटर फ़िल्टर करने के लिए उपयोग किया जाने वाला एक अधिक सूक्ष्म डिवाइस प्रकार/मॉडल (उदाहरण के लिए `temp-sensor`) |
| `iot.device.firmware`| नहीं      | डिवाइस द्वारा रिपोर्ट किया गया फर्मवेयर संस्करण                                          |

## OpenTelemetry SDK के माध्यम से मेट्रिक्स भेजना

यदि आपका डिवाइस सीधे एक OpenTelemetry SDK चलाता है, तो इसे OneUptime की ओर इंगित करें और मानक `OTEL_*` एनवायरनमेंट वेरिएबल्स के माध्यम से IoT रिसोर्स एट्रिब्यूट्स स्टैम्प करें। टोकन, एंडपॉइंट, फ्लीट नाम और device id को अपने एनवायरनमेंट के मानों से बदलें।

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN
export OTEL_RESOURCE_ATTRIBUTES=iot.fleet.name=building-a-sensors,device.id=sensor-001,service.name=iot/building-a-sensors
```

| एनवायरनमेंट वेरिएबल          | आवश्यक | विवरण                                                                                          |
| ----------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | हाँ      | OneUptime OTLP एंडपॉइंट (`https://oneuptime.com/otlp`, या सेल्फ-होस्टेड के लिए `http(s)://YOUR-ONEUPTIME-HOST/otlp`) |
| `OTEL_EXPORTER_OTLP_HEADERS`  | हाँ      | `x-oneuptime-token=YOUR_TELEMETRY_INGESTION_TOKEN`                                                    |
| `OTEL_RESOURCE_ATTRIBUTES`    | हाँ      | अल्पविराम से अलग किए गए रिसोर्स एट्रिब्यूट्स। इसमें `iot.fleet.name`, `device.id`, और `service.name=iot/<fleet>` शामिल होने चाहिए |

नीचे दिए गए `iot_*` नामों का उपयोग करके अपने रीडिंग्स को मेट्रिक्स के रूप में उत्सर्जित करें (देखें [मेट्रिक परंपराएँ](#metric-conventions))। लगभग एक मिनट के भीतर डिवाइस OneUptime डैशबोर्ड के **IoT** अनुभाग के अंतर्गत दिखाई देता है।

## OpenTelemetry Collector के माध्यम से मेट्रिक्स भेजना

जब कई डिवाइस एक गेटवे के माध्यम से रिपोर्ट करते हैं, तो गेटवे पर एक OpenTelemetry Collector चलाएँ और OneUptime को एक्सपोर्ट करें। `resource` प्रोसेसर फ्लीट एट्रिब्यूट्स स्टैम्प करता है; अपने डिवाइसों से रीडिंग्स प्राप्त करें (OTLP, MQTT ब्रिज, फ़ाइल लॉग, आदि) और उन्हें आगे भेजें:

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: iot.fleet.name
        value: field-gateways
        action: upsert
      - key: service.name
        value: iot/field-gateways
        action: upsert

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    # OneUptime को डिफ़ॉल्ट Proto(buf) के बजाय JSON एन्कोडर की आवश्यकता होती है
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"

service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [resource, batch]
      exporters: [otlphttp]
```

- **`resource`** प्रत्येक रिकॉर्ड को फ्लीट एट्रिब्यूट्स के साथ स्टैम्प करता है। प्रति गेटवे `iot.fleet.name` (और मेल खाता `service.name=iot/<fleet>`) सेट करें ताकि प्रत्येक गेटवे के डिवाइस सही फ्लीट में पहुँचें।
- प्रत्येक डेटापॉइंट पर `device.id` (और वैकल्पिक रूप से `iot.device.kind` / `iot.device.type` / `iot.device.firmware`) रखें ताकि OneUptime फ्लीट के भीतर व्यक्तिगत डिवाइस को हल कर सके।
- **`otlphttp`** इन्जेस्शन टोकन संलग्न करके HTTPS पर OneUptime को भेजता है। ध्यान दें कि `encoding: json` और `Content-Type: application/json` हेडर आवश्यक हैं।

## मेट्रिक परंपराएँ

OneUptime निम्नलिखित `iot_*` मेट्रिक नामों को पहचानता है। प्रत्येक डेटापॉइंट को `device.id` लेबल ले जाना चाहिए ताकि रीडिंग सही डिवाइस को आरोपित हो। आपको केवल वे मेट्रिक्स भेजने की आवश्यकता है जो आपके डिवाइस के लिए सार्थक हों — गायब मेट्रिक्स को बस चार्ट नहीं किया जाता।

| मेट्रिक नाम                 | अर्थ                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `iot_device_up`             | डिवाइस उपलब्धता। `1` = अप/पहुँच योग्य, `0` = डाउन। IoT Device मॉनिटर को चलाता है |
| `iot_device_info`           | केवल-पहचान संकेत। `device.id` / kind / type / firmware ले जाता है ताकि कोई डिवाइस रीडिंग्स रिपोर्ट करने से पहले भी इन्वेंट्री में दिखाई दे |
| `iot_battery_percent`       | बैटरी चार्ज स्तर, `0`–`100` (%)                                            |
| `iot_signal_strength_dbm`   | dBm में वायरलेस सिग्नल शक्ति (उदाहरण के लिए Wi-Fi / LoRa / सेलुलर RSSI)      |
| `iot_temperature_celsius`   | °C में डिवाइस या सेंसर तापमान                                             |
| `iot_cpu_usage_ratio`       | CPU उपयोग एक अनुपात `0`–`1` के रूप में (OneUptime इसे प्रतिशत के रूप में संग्रहीत करता है)        |
| `iot_memory_usage_bytes`    | वर्तमान में उपयोग की गई मेमोरी, बाइट्स में                                                |
| `iot_memory_size_bytes`     | डिवाइस पर उपलब्ध कुल मेमोरी, बाइट्स में                                 |
| `iot_uptime_seconds`        | डिवाइस के अंतिम बार बूट होने के बाद से सेकंड                                           |

## इंस्टॉलेशन सत्यापित करें

1. पुष्टि करें कि आपका डिवाइस या गेटवे बिना त्रुटियों के एक्सपोर्ट कर रहा है (एक्सपोर्ट विफलताओं और HTTP `401`/`403` प्रतिक्रियाओं के लिए SDK/कलेक्टर लॉग जाँचें)।
2. OneUptime डैशबोर्ड में, **IoT** अनुभाग खोलें — आपका फ्लीट लगभग एक मिनट के भीतर `iot/<fleet>` के रूप में दिखाई देना चाहिए।
3. फ्लीट का **Devices** टैब खोलें — आपके द्वारा भेजा गया प्रत्येक `device.id` अपनी नवीनतम बैटरी, सिग्नल, तापमान, CPU, मेमोरी और अप/डाउन स्थिति के साथ सूचीबद्ध होना चाहिए।
4. किसी भी `iot_*` श्रृंखला को चार्ट करने के लिए फ्लीट के अंतर्गत **Metrics** खोलें।

## समस्या निवारण

### फ्लीट दिखाई नहीं देता

1. सत्यापित करें कि `iot.fleet.name` एक **resource** एट्रिब्यूट के रूप में सेट है (डेटापॉइंट लेबल के रूप में नहीं), और `service.name` `iot/<fleet>` है।
2. पुष्टि करें कि एक्सपोर्टर एंडपॉइंट `https://oneuptime.com/otlp` (या आपका सेल्फ-होस्टेड `…/otlp`) है और `x-oneuptime-token` हेडर एक मान्य टोकन ले जाता है।
3. यदि कलेक्टर का उपयोग कर रहे हैं, तो सुनिश्चित करें कि `otlphttp` एक्सपोर्टर पर `encoding: json` और `Content-Type: application/json` सेट हैं।

### इन्वेंट्री से डिवाइस गायब

1. सुनिश्चित करें कि प्रत्येक डेटापॉइंट एक `device.id` लेबल ले जाता है — डिवाइस इस पर कीड होते हैं।
2. उन डिवाइसों के लिए `iot_device_info` (केवल-पहचान) भेजें जिन्होंने अभी तक रीडिंग्स रिपोर्ट नहीं की हैं ताकि वे फिर भी इन्वेंट्री में दिखें।
3. जाँचें कि `device.id` मान रिपोर्टों में स्थिर हैं; बदलता हुआ id डुप्लिकेट डिवाइस पंक्तियाँ बनाता है।

### एक्सपोर्टर से HTTP 401 / 403

इन्जेस्शन टोकन अमान्य, रद्द या गायब है। _Project Settings → Telemetry Ingestion Keys_ से एक नया बनाएँ और `x-oneuptime-token` हेडर अपडेट करें।

### मेट्रिक्स चार्ट नहीं हो रहे

1. पुष्टि करें कि आप [मेट्रिक परंपराएँ](#metric-conventions) तालिका से सटीक `iot_*` मेट्रिक नामों का उपयोग कर रहे हैं — अपरिचित नाम सामान्य मेट्रिक्स के रूप में संग्रहीत होते हैं और IoT चार्ट को नहीं भरेंगे।
2. याद रखें कि `iot_cpu_usage_ratio` एक `0`–`1` अनुपात है; कच्चा अनुपात भेजें और OneUptime इसे प्रतिशत के रूप में रेंडर करता है।
3. डिवाइस के रिपोर्ट करना शुरू करने के बाद पहले डेटापॉइंट्स के सामने आने के लिए एक मिनट तक की अनुमति दें।

## सेल्फ-होस्टेड OneUptime

यदि आप OneUptime को सेल्फ-होस्ट कर रहे हैं, तो एंडपॉइंट को अपने स्वयं के इंस्टेंस की ओर इंगित करें:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=https://your-oneuptime-host.example.com/otlp
```

या, एक कलेक्टर में:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

यदि आपका इंस्टेंस केवल-HTTP है, तो स्कीम को `http://` में बदलें और उपयुक्त पोर्ट का उपयोग करें।

## अगले कदम

- डिवाइस ऑफ़लाइन, कम बैटरी, कमज़ोर सिग्नल, उच्च तापमान और उच्च CPU स्थितियों पर अलर्ट करने के लिए एक **IoT Device Monitor** कॉन्फ़िगर करें — देखें [IoT Device Monitor](/docs/monitor/iot-device-monitor)।
- नॉन-कंटेनराइज़्ड होस्ट (Linux / macOS / Windows VM और बेयर मेटल) के लिए, [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector) का उपयोग करें।
- अंतर्निहित OTLP इंटीग्रेशन को गहराई से सीखने के लिए, देखें [Integrate OpenTelemetry with OneUptime](/docs/telemetry/open-telemetry)।
