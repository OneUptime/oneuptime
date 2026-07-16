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

नीचे दिए गए `iot_*` नामों का उपयोग करके अपने रीडिंग्स को मेट्रिक्स के रूप में उत्सर्जित करें (देखें [मेट्रिक परंपराएँ](#मेट्रिक-परंपराएँ))। लगभग एक मिनट के भीतर डिवाइस OneUptime डैशबोर्ड के **IoT** अनुभाग के अंतर्गत दिखाई देता है।

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
    headers:
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
- **`otlphttp`** इन्जेस्शन टोकन संलग्न करके HTTPS पर OneUptime को भेजता है। डिफ़ॉल्ट protobuf एन्कोडिंग और `encoding: json` दोनों स्वीकार किए जाते हैं।

## MQTT के माध्यम से मेट्रिक्स भेजना

OneUptime एक अंतर्निहित MQTT एंडपॉइंट के साथ आता है, इसलिए जो डिवाइस पहले से MQTT बोलते हैं वे सीधे रीडिंग्स पुश कर सकते हैं — किसी OpenTelemetry SDK, कलेक्टर या ब्रिज की आवश्यकता नहीं। MQTT पर प्रकाशित की गई हर चीज़ उसी पाइपलाइन में पहुँचती है जिसमें OTLP: फ्लीट स्वतः बन जाते हैं, डिवाइस इन्वेंट्री अपडेट होती है, और प्रत्येक IoT मॉनिटर और अलर्ट टेम्पलेट बिना किसी बदलाव के काम करता है।

**एंडपॉइंट**

| ट्रांसपोर्ट             | पता                                | टिप्पणियाँ                                                                                     |
| --------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- |
| WebSocket पर MQTT   | `wss://<your-host>/mqtt`               | हर डिप्लॉयमेंट पर काम करता है — OneUptime इनग्रेस के माध्यम से सामान्य HTTPS पोर्ट का उपयोग करता है     |
| TCP पर MQTT         | `<app-host>:1883` (`MQTT_INGEST_PORT`) | सेल्फ-होस्टेड: डिफ़ॉल्ट रूप से क्लस्टर/कंपोज़ नेटवर्क के लिए आंतरिक; यदि आवश्यक हो तो इसे एक्सपोज़ करें |

**प्रमाणीकरण** — दो विकल्प:

- **प्रोजेक्ट-व्यापी**: अपना **Telemetry Ingestion Token** MQTT पासवर्ड के रूप में भेजें (यूज़रनेम को अनदेखा किया जाता है; यदि आपका क्लाइंट केवल यूज़रनेम फ़ील्ड दिखाता है, तो टोकन वहाँ रखें)। उन गेटवे के लिए सही है जो कई डिवाइसों की ओर से प्रकाशित करते हैं।
- **प्रति-डिवाइस** (सीधे कनेक्ट होने वाले डिवाइसों के लिए अनुशंसित): डैशबोर्ड में फ्लीट के **Device Registry** टैब के अंतर्गत डिवाइस को पंजीकृत करें। पंजीकरण एक प्रति-डिवाइस क्रेडेंशियल जारी करता है — क्रेडेंशियल ID MQTT **यूज़रनेम** है और सीक्रेट **पासवर्ड** है। डिवाइस-प्रमाणित क्लाइंट केवल अपने स्वयं के `oneuptime/<fleet>/<device>/…` टॉपिक्स के अंतर्गत प्रकाशित कर सकते हैं, एक समझौता किए गए डिवाइस को शेष फ्लीट को छुए बिना डैशबोर्ड से रद्द किया जा सकता है (रद्दीकरण लगभग एक मिनट के भीतर प्रभावी होता है, कनेक्टेड सत्रों के लिए भी), और पंजीकृत डिवाइसों को **साइलेंट-डेथ ऑफ़लाइन डिटेक्शन** मिलता है: रिपोर्ट करना बंद करने पर वे गायब होने के बजाय इन्वेंट्री में Offline के रूप में बने रहते हैं, और Device Offline अलर्ट टेम्पलेट उनके लिए तब भी फ़ायर होता है जब वे Last Will के बिना समाप्त हो जाएँ।

अमान्य क्रेडेंशियल्स को CONNECT पर रिटर्न कोड 4 (खराब यूज़रनेम या पासवर्ड) के साथ अस्वीकार कर दिया जाता है, इसलिए एक गलत कॉन्फ़िगर किया गया डिवाइस स्पष्ट रूप से विफल होता है।

**टॉपिक्स** — निश्चित `oneuptime/` उपसर्ग के अंतर्गत प्रकाशित करें। फ्लीट और डिवाइस सेगमेंट में `/`, `+`, या `#` नहीं होने चाहिए, और वे 100 वर्णों तक सीमित हैं:

| टॉपिक                                            | पेलोड                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `oneuptime/<fleet>/<device>/telemetry`           | रीडिंग्स का JSON ऑब्जेक्ट — `{ "metrics": { "iot_temperature_celsius": 21.5 } }`, या एक फ्लैट ऑब्जेक्ट जिसके संख्यात्मक फ़ील्ड मेट्रिक्स हैं |
| `oneuptime/<fleet>/<device>/metrics/<metricName>`| एक एकल मान — एक सादा संख्या (`23.4`) या `{ "value": 23.4 }`                                        |
| `oneuptime/<fleet>/<device>/status`              | `"online"` या `"offline"` (साथ ही `1`/`0`, `true`/`false`, `up`/`down`) — `iot_device_up` पर मैप होता है       |

टेलीमेट्री पेलोड `"attributes"` (एक स्ट्रिंग मैप जो प्रत्येक डेटापॉइंट पर स्टैम्प किया जाता है — इसका उपयोग `iot.device.kind`, `iot.device.type`, `iot.device.firmware`, या अपने स्वयं के लेबल के लिए करें) और `"timestamp"` (ISO-8601, या यूनिक्स सेकंड/मिलीसेकंड) भी ले जा सकते हैं। दोनों वैकल्पिक हैं; `timestamp` अनुपस्थित होने पर इन्जेस्ट समय का उपयोग किया जाता है।

**Last Will के साथ ऑफ़लाइन डिटेक्शन** — `oneuptime/<fleet>/<device>/status` पर `offline` पेलोड के साथ एक MQTT Last Will पंजीकृत करें। यदि डिवाइस समाप्त हो जाता है या नेटवर्क से हट जाता है, तो सत्र समाप्त होते ही ब्रोकर उसकी ओर से `iot_device_up = 0` प्रकाशित करता है — जो स्टॉक **Device Offline** अलर्ट टेम्पलेट को ट्रिगर करता है और इन्वेंट्री में डिवाइस को Down में बदल देता है, बिना किसी पोलिंग और बिना किसी छूटे हुए स्क्रेप की प्रतीक्षा किए। कनेक्ट होने के बाद उसी टॉपिक पर `online` प्रकाशित करें ताकि डिवाइस फिर से Up दिखे।

`mosquitto_pub` के साथ उदाहरण (रॉ TCP, सेल्फ-होस्टेड):

```bash
mosquitto_pub -h YOUR-ONEUPTIME-APP-HOST -p 1883 \
  -u oneuptime -P "YOUR_TELEMETRY_INGESTION_TOKEN" \
  -t "oneuptime/building-a-sensors/sensor-001/telemetry" \
  -m '{"metrics":{"iot_device_up":1,"iot_battery_percent":87,"iot_temperature_celsius":21.5},"attributes":{"iot.device.type":"temp-sensor","iot.device.firmware":"1.4.2"}}'
```

WebSocket पर Node.js `mqtt` के साथ उदाहरण (oneuptime.com और किसी भी सेल्फ-होस्टेड इंस्टेंस के विरुद्ध काम करता है):

```javascript
const mqtt = require("mqtt");

const client = mqtt.connect("wss://oneuptime.com/mqtt", {
  username: "oneuptime", // ignored — the token below is what authenticates
  password: "YOUR_TELEMETRY_INGESTION_TOKEN",
  will: {
    topic: "oneuptime/building-a-sensors/sensor-001/status",
    payload: "offline",
  },
});

client.on("connect", () => {
  client.publish("oneuptime/building-a-sensors/sensor-001/status", "online");
  setInterval(() => {
    client.publish(
      "oneuptime/building-a-sensors/sensor-001/telemetry",
      JSON.stringify({
        metrics: {
          iot_device_up: 1,
          iot_battery_percent: readBattery(),
          iot_temperature_celsius: readTemperature(),
        },
      }),
    );
  }, 60 * 1000);
});
```

WebSocket पर Python `paho-mqtt` के साथ उदाहरण:

```python
import json
import paho.mqtt.client as mqtt

client = mqtt.Client(transport="websockets")
client.username_pw_set("oneuptime", "YOUR_TELEMETRY_INGESTION_TOKEN")
client.tls_set()
client.will_set("oneuptime/building-a-sensors/sensor-001/status", "offline")
client.ws_set_options(path="/mqtt")
client.connect("oneuptime.com", 443)

client.publish("oneuptime/building-a-sensors/sensor-001/status", "online")
client.publish(
    "oneuptime/building-a-sensors/sensor-001/telemetry",
    json.dumps({"metrics": {"iot_device_up": 1, "iot_temperature_celsius": 21.5}}),
)
```

टिप्पणियाँ:

- यह एंडपॉइंट **केवल-इन्जेस्शन** है: सब्सक्रिप्शन अस्वीकार किए जाते हैं (SUBACK विफलता)। यदि आप चाहते हैं कि ब्रोकर प्राप्ति की पुष्टि करे तो QoS 1 का उपयोग करें। इन्जेस्शन **कम-से-कम-एक-बार** है — खोई हुई पुष्टि के बाद QoS 1/2 पुनःप्रेषण डुप्लिकेट डेटापॉइंट्स उत्पन्न कर सकता है।
- टॉपिक अनुबंध के बाहर या विकृत पेलोड के साथ प्रकाशन स्वीकार किए जाते हैं और **छोड़ दिए जाते हैं** (MQTT 3.1.1 में प्रति-संदेश त्रुटि उत्तर नहीं होता) — सर्वर कारण के साथ एक चेतावनी लॉग करता है, इसलिए यदि डेटा नहीं आ रहा है तो OneUptime ऐप लॉग जाँचें।
- WebSocket एंडपॉइंट पर, MQTT कीपअलाइव को **5 मिनट से कम** रखें — OneUptime इनग्रेस 300 सेकंड के बाद निष्क्रिय WebSocket कनेक्शन बंद कर देता है, जो आपके Last Will और एक झूठे Device Offline अलर्ट को फ़ायर कर देगा। क्लाइंट-लाइब्रेरी डिफ़ॉल्ट (`mqtt` और `paho-mqtt` के लिए 60 s) ठीक हैं। रॉ TCP एंडपॉइंट पर ऐसी कोई सीमा नहीं है।
- पेलोड प्रति प्रकाशन 128 KB और 100 मेट्रिक्स तक सीमित हैं; बड़े आकार के पैकेट कनेक्शन को गिरा देते हैं।

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
3. यदि MQTT का उपयोग कर रहे हैं, तो पुष्टि करें कि टॉपिक ठीक `oneuptime/<fleet>/<device>/…` का पालन करता है — टॉपिक का फ्लीट सेगमेंट ही वह चीज़ है जो फ्लीट बनाती है।

### इन्वेंट्री से डिवाइस गायब

1. सुनिश्चित करें कि प्रत्येक डेटापॉइंट एक `device.id` लेबल ले जाता है — डिवाइस इस पर कीड होते हैं।
2. उन डिवाइसों के लिए `iot_device_info` (केवल-पहचान) भेजें जिन्होंने अभी तक रीडिंग्स रिपोर्ट नहीं की हैं ताकि वे फिर भी इन्वेंट्री में दिखें।
3. जाँचें कि `device.id` मान रिपोर्टों में स्थिर हैं; बदलता हुआ id डुप्लिकेट डिवाइस पंक्तियाँ बनाता है।

### एक्सपोर्टर से HTTP 401 / 403

इन्जेस्शन टोकन अमान्य, रद्द या गायब है। _Project Settings → Telemetry Ingestion Keys_ से एक नया बनाएँ और `x-oneuptime-token` हेडर अपडेट करें।

### मेट्रिक्स चार्ट नहीं हो रहे

1. पुष्टि करें कि आप [मेट्रिक परंपराएँ](#मेट्रिक-परंपराएँ) तालिका से सटीक `iot_*` मेट्रिक नामों का उपयोग कर रहे हैं — अपरिचित नाम सामान्य मेट्रिक्स के रूप में संग्रहीत होते हैं और IoT चार्ट को नहीं भरेंगे।
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
    headers:
      "x-oneuptime-token": "YOUR_TELEMETRY_INGESTION_TOKEN"
```

यदि आपका इंस्टेंस केवल-HTTP है, तो स्कीम को `http://` में बदलें और उपयुक्त पोर्ट का उपयोग करें।

## अगले कदम

- डिवाइस ऑफ़लाइन, कम बैटरी, कमज़ोर सिग्नल, उच्च तापमान और उच्च CPU स्थितियों पर अलर्ट करने के लिए एक **IoT Device Monitor** कॉन्फ़िगर करें — देखें [IoT Device Monitor](/docs/monitor/iot-device-monitor)।
- नॉन-कंटेनराइज़्ड होस्ट (Linux / macOS / Windows VM और बेयर मेटल) के लिए, [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector) का उपयोग करें।
- अंतर्निहित OTLP इंटीग्रेशन को गहराई से सीखने के लिए, देखें [Integrate OpenTelemetry with OneUptime](/docs/telemetry/open-telemetry)।
