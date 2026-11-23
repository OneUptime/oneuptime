# Fluent Bit

[Fluent Bit](https://docs.fluentbit.io/manual) एक हल्का एजेंट है जो फ़ाइलों, systemd, कंटेनरों, syslog, HTTP और कई दूसरे स्रोतों से लॉग इकट्ठा करता है। इसका [OpenTelemetry आउटपुट](https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry) इकट्ठा किया गया डेटा OneUptime के OpenTelemetry (OTLP) एंडपॉइंट पर भेजता है, जहां लॉग **उत्पाद → लॉग** में खोजे जा सकते हैं।

:::cards
- [Fluent Bit कॉन्फ़िगर करें](#fluent-bit-कॉन्फ़िगर-करें): OpenTelemetry आउटपुट जोड़ें और अपनी सेवा का नाम दें।
- [पूरा उदाहरण](#पूरा-उदाहरण): शुरुआत के लिए एक पूरी कॉन्फ़िगरेशन फ़ाइल।
- [सेल्फ़-होस्टेड OneUptime](#सेल्फ़-होस्टेड-oneuptime): Fluent Bit को अपने इंस्टेंस की ओर करें।
:::

## यह कैसे काम करता है

```mermaid title="Fluent Bit से OneUptime तक"
flowchart TB
    sources["फ़ाइलें, कंटेनर, syslog, HTTP"] --> inputs["Fluent Bit इनपुट"]
    inputs --> envelope["opentelemetry_envelope प्रोसेसर"]
    envelope --> name["content_modifier service.name सेट करता है"]
    name --> output["opentelemetry आउटपुट"]
    output -->|"OTLP/HTTP + इंजेशन कुंजी"| oneuptime["OneUptime /otlp/v1/logs"]
    oneuptime --> logs["लॉग"]
```

Fluent Bit हर रिकॉर्ड को एक OpenTelemetry एनवेलप में लपेटता है, ताकि वह `service.name` जैसे रिसोर्स एट्रिब्यूट ले जा सके। फिर OpenTelemetry आउटपुट रिकॉर्ड को `x-oneuptime-token` हेडर में आपकी इंजेशन कुंजी के साथ OneUptime को भेजता है। OneUptime उन्हें `service.name` में बताई गई सेवा के तहत रखता है, और पहली बार डेटा भेजे जाने पर वह सेवा बना देता है।

## शुरू करने से पहले

- **Fluent Bit इंस्टॉल करें** — [इंस्टॉलेशन गाइड](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit) देखें। इस पेज की कॉन्फ़िगरेशन Fluent Bit के YAML फ़ॉर्मैट और `opentelemetry_envelope` प्रोसेसर का इस्तेमाल करती है, इसलिए हाल की रिलीज़ इस्तेमाल करें।
- **एक OneUptime प्रोजेक्ट।** OneUptime Cloud पर टेलीमेट्री का बिल प्रति GB इंजेस्ट किए गए डेटा पर बनता है — देखें [मूल्य](https://oneuptime.com/pricing) — और Free प्लान वाले प्रोजेक्ट को टेलीमेट्री भेजने से पहले भुगतान विधि जोड़नी होती है।
- **एक टेलीमेट्री इंजेशन कुंजी।** अगर आपके पास नहीं है:

:::steps
### इंजेशन कुंजियाँ खोलें

**उत्पाद → प्रोजेक्ट सेटिंग्स** पर जाएं, साइड मेन्यू में **टेलीमेट्री और APM** खोलें और **इंजेशन कुंजियाँ** चुनें।

!["इंजेशन कुंजियाँ" सूची, "इंजेशन कुंजी बनाएँ" घेरा हुआ](screen:ingestion-keys)

### एक कुंजी बनाएं

**इंजेशन कुंजी बनाएँ** पर क्लिक करें। डायलॉग में कुंजी का नाम पहले से भरा होता है और **सर्वर** चुना होता है — वह कुंजी प्रकार जिससे कोई एप्लिकेशन या collector डेटा भेजता है — इसलिए उसे बनाने के लिए **इंजेशन कुंजी बनाएँ** पर क्लिक करें, या पहले उसका नाम बदलें।

### सीक्रेट कॉपी करें

नई कुंजी अपने पेज पर खुलती है। उसकी **सीक्रेट कुंजी** कॉपी करें: यही नीचे की कॉन्फ़िगरेशन में `YOUR_TELEMETRY_INGESTION_TOKEN` है।

![टेलीमेट्री इंजेशन कुंजी का पेज, जिसमें उसकी सीक्रेट कुंजी दिख रही है](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## Fluent Bit कॉन्फ़िगर करें

Fluent Bit अपनी YAML कॉन्फ़िगरेशन `/etc/fluent-bit/fluent-bit.yaml` जैसी फ़ाइल से पढ़ता है।

:::steps
### OpenTelemetry आउटपुट जोड़ें

एक `opentelemetry` आउटपुट जोड़ें जो OneUptime को भेजे। अगर आप रिकॉर्ड लोकल रूप से देखना चाहते हैं, तो टेस्ट करते समय `stdout` आउटपुट रहने दें:

```yaml title="fluent-bit.yaml"
service:
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`retry_limit: 8640` चंक को फिर से भेजता है जब OneUptime व्यस्त हो (`429`) या रीस्टार्ट हो रहा हो (`502`, `503`, `504`), लगभग हर 30 सेकंड में (`scheduler.base` और `scheduler.cap`), लगभग 72 घंटे तक; Fluent Bit का डिफ़ॉल्ट एक बार और कोशिश करके उसे छोड़ देना है। `storage.path` भेजे जाने से बचे चंक को डिस्क पर रखता है, ताकि Fluent Bit के रीस्टार्ट होने पर उनमें से कोई न खोए, हर उस इनपुट के लिए जिसमें `storage.type: filesystem` हो, जैसा अगले चरण में है। Fluent Bit को उस फ़ोल्डर में लिखने की अनुमति होनी चाहिए: पैकेज की सेवा root के रूप में चलती है, और हाथ से चलाने पर उसे `sudo` के साथ चलाएं। `storage.total_limit_size: 512M` आउटपुट के लिए ज़्यादा से ज़्यादा 512 MB रखता है; भर जाने पर सबसे पुराने चंक छोड़ दिए जाते हैं।

### लॉग को OpenTelemetry एनवेलप में लपेटें और सेवा का नाम दें

हर इनपुट में `opentelemetry_envelope` प्रोसेसर जोड़ें, उसके बाद एक `content_modifier` जो `service.name` सेट करे। `YOUR_SERVICE_NAME` की जगह वह नाम लिखें जिसके तहत लॉग OneUptime में दिखने चाहिए:

```yaml title="fluent-bit.yaml"
pipeline:
  inputs:
    - name: tail # or any other input
      path: /var/log/my-app/*.log
      # Keep its place in each file, so a restart reads on from there
      db: /var/lib/fluent-bit/tail.db
      # Keep its chunks on disk until OneUptime takes them
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME
```

`db` हर फ़ाइल में tail की जगह याद रखता है, ताकि रीस्टार्ट के बाद वहीं से आगे पढ़ा जाए; इसके बिना Fluent Bit हर फ़ाइल के अंत से फिर शुरू करता है, और बंद रहने के दौरान लिखी गई लाइनें कभी नहीं भेजी जातीं। `storage.type: filesystem` इनपुट के चंक `storage.path` में रखता है।

### Fluent Bit रीस्टार्ट करें

`fluent-bit` पैकेज की सेवा `/etc/fluent-bit/fluent-bit.conf` पढ़ती है, जो पैकेज का अपना उदाहरण है, यह फ़ाइल नहीं। एक drop-in से उसे `/etc/fluent-bit/fluent-bit.yaml` की ओर करें, फिर उसे अभी और हर बूट पर शुरू करें:

```bash
sudo mkdir -p /etc/systemd/system/fluent-bit.service.d
printf '[Service]\nExecStart=\nExecStart=/opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml\n' | sudo tee /etc/systemd/system/fluent-bit.service.d/fluent-bit-yaml.conf
sudo systemctl daemon-reload
sudo systemctl enable fluent-bit
sudo systemctl restart fluent-bit
```

खाली `ExecStart=` पैकेज की अपनी स्टार्ट लाइन हटा देता है। पहले फ़ाइल को फ़ोरग्राउंड में आज़माने के लिए `sudo /opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml` चलाएं: पैकेज प्रोग्राम को `/opt/fluent-bit/bin` में रखता है, जो `PATH` में नहीं है। कुछ ही सेकंड में लॉग **उत्पाद → लॉग** में दिखते हैं, और सेवा **उत्पाद → सेवाएं** में सूचीबद्ध हो जाती है।
:::

## पूरा उदाहरण

यह कॉन्फ़िगरेशन पोर्ट `8888` पर HTTP से, सिर्फ़ इसी होस्ट से, लॉग लेती है और उन्हें OneUptime को आगे भेजती है:

```yaml title="fluent-bit.yaml"
service:
  flush: 1
  log_level: info
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  inputs:
    - name: http
      # This host alone may send here
      listen: 127.0.0.1
      port: 8888
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME

  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`listen: 127.0.0.1` सिर्फ़ इसी होस्ट से लॉग लेता है: `http` इनपुट कोई कुंजी नहीं माँगता, इसलिए `listen: 0.0.0.0` के साथ जो कोई भी पोर्ट तक पहुँच सकता है, वह आपकी इंजेशन कुंजी से OneUptime को लॉग भेज सकता है। `http` इनपुट की जगह वे इनपुट लगाएं जिनकी आपको ज़रूरत है — जैसे लॉग फ़ाइलों के लिए `tail` या जर्नल के लिए `systemd` — और हर इनपुट पर दोनों प्रोसेसर और `storage.type: filesystem` बनाए रखें।

## HTTP आउटपुट से भेजें

Fluent Bit का [HTTP आउटपुट](https://docs.fluentbit.io/manual/pipeline/outputs/http) OneUptime के Fluentd एंडपॉइंट पर भी भेज सकता है, जो हर रिकॉर्ड को वैसे ही पढ़ता है जैसा [Fluentd पेज](/docs/telemetry/fluentd) बताता है। `format` को `json_lines` पर सेट करें, जैसा नीचे है, या `json` पर: OneUptime दोनों पढ़ता है, `compress: gzip` से कंप्रेस किए गए हों या नहीं। Fluent Bit का डिफ़ॉल्ट फ़ॉर्मैट, `msgpack`, अस्वीकार किया जाता है।

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: http
      match: "*"
      host: "oneuptime.com"
      port: 443
      uri: "/fluentd/logs"
      format: json_lines
      # Send each record's time where OneUptime reads it
      json_date_key: timestamp
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
        - x-oneuptime-service-name YOUR_SERVICE_NAME
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## सेल्फ़-होस्टेड OneUptime

`host` को अपने OneUptime इंस्टेंस के होस्ट पर सेट करें। अगर वह HTTPS के बजाय सादे HTTP पर चलता है, तो `port` को भी उस पोर्ट पर सेट करें जिस पर वह सुनता है (आमतौर पर `80`) और `tls` हटा दें:

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "your-oneuptime-instance.com"
      port: 80
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## समस्या निवारण

:::details Fluent Bit, OpenTelemetry आउटपुट से `401` लॉग करता है
इंजेशन कुंजी मौजूद नहीं है, अज्ञात है या समाप्त हो गई है। `header` लाइन जांचें: यह `x-oneuptime-token`, एक स्पेस, और फिर कुंजी की **सीक्रेट कुंजी** है।
:::

:::details Fluent Bit `402` या `422` लॉग करता है
`402`: OneUptime Cloud पर प्रोजेक्ट Free प्लान पर है और उसकी कोई भुगतान विधि नहीं है। **प्रोजेक्ट सेटिंग्स → बिलिंग और चालान → बिलिंग** में एक जोड़ें। `422`: कुंजी अक्षम है, या यह ब्राउज़र कुंजी है। कुंजी की सेटिंग में **सक्षम** फिर से चालू करें, या **सर्वर** कुंजी बनाएं।
:::

:::details लॉग किसी अनपेक्षित सेवा के तहत पहुंचते हैं
सेवा `service.name` से तय होती है। जांचें कि हर इनपुट में `opentelemetry_envelope` प्रोसेसर हो, और उसके बाद वह `content_modifier` जो इसे सेट करता है।
:::

:::details कुछ नहीं पहुंचता, और Fluent Bit कनेक्शन एरर लॉग करता है
जांचें कि HTTPS एंडपॉइंट के लिए `tls: On` और `port: 443` सेट हैं, और Fluent Bit चलाने वाला होस्ट उस पोर्ट पर आपके OneUptime होस्ट तक पहुंच सकता है।
:::

:::details Fluent Bit `cannot be retried` लॉग करता है
Fluent Bit ने एक चंक छोड़ दिया जिसे वह भेज नहीं सका। ऊपर के कॉन्फ़िगरेशन की तरह `retry_limit: 8640` होने पर, जिस चंक का जवाब OneUptime `429`, `502`, `503` या `504` से दे, उसे वह लगभग हर 30 सेकंड में, लगभग 72 घंटे तक फिर से भेजता है; Fluent Bit के डिफ़ॉल्ट से वह सिर्फ़ एक बार और कोशिश करता है। `400`, `401`, `402`, `413`, `422` या `500` तुरंत छोड़ दिया जाता है, क्योंकि जवाब हर बार वही होता है: कुंजी, प्लान और रिक्वेस्ट का आकार जाँचें।
:::

अगर आपके कोई सवाल हैं या कॉन्फ़िगरेशन में मदद चाहिए, तो हमें support@oneuptime.com पर लिखें।

## अगले कदम

:::cards
- [लॉग पाइपलाइन](/docs/telemetry/log-pipelines): Fluent Bit के भेजे लॉग पार्स करें और समृद्ध करें।
- [खोज सिंटैक्स](/docs/telemetry/search-syntax): लॉग एक्सप्लोरर में लॉग ढूंढें।
- [OpenTelemetry](/docs/telemetry/open-telemetry): सभी टेलीमेट्री के एंडपॉइंट, कुंजियां और सीमाएं।
- [Fluentd](/docs/telemetry/fluentd): इसके बजाय Fluentd इस्तेमाल करें।
:::
