# OneUptime को telemetry data भेजने के लिए Fluentd उपयोग करें

## Overview

आप अपने applications और services से logs और telemetry data एकत्र करने के लिए [Fluentd](https://www.fluentd.org/) plugin उपयोग कर सकते हैं। Plugin telemetry data को OneUptime HTTP Source को भेजता है। आप OneUptime HTTP Source को telemetry data भेजने के लिए fluentd के http output plugin का उपयोग कर सकते हैं। यह plugin यहाँ मिल सकता है: https://docs.fluentd.org/output/http

## शुरू करना

Fluentd सैकड़ों data sources का समर्थन करता है और आप इनमें से किसी भी source से OneUptime में logs ingest कर सकते हैं। कुछ लोकप्रिय sources में शामिल हैं:

- Docker
- Syslog
- Apache
- Nginx
- MySQL
- PostgreSQL
- MongoDB
- NodeJS
- Ruby
- Python
- Java
- PHP
- Go
- Rust 

और भी बहुत कुछ। 

आप supported sources की पूरी list [यहाँ](https://www.fluentd.org/datasources) पा सकते हैं।

## पूर्व आवश्यकताएं

- **चरण 1: अपने system पर Fluentd Install करें** - आप [यहाँ](https://docs.fluentd.org/installation) दिए गए निर्देशों का उपयोग करके Fluentd install कर सकते हैं
- **चरण 2: OneUptime account के लिए sign up करें** - आप [यहाँ](https://oneuptime.com) एक free account के लिए sign up कर सकते हैं। कृपया ध्यान दें कि account free है, log ingestion एक paid feature है। आप pricing के बारे में अधिक details [यहाँ](https://oneuptime.com/pricing) पा सकते हैं।
- **चरण 3: OneUptime Project बनाएं** - Account होने के बाद, आप OneUptime dashboard से एक project बना सकते हैं।
- **चरण 4: Telemetry Ingestion Token बनाएं** - OneUptime account बनाने के बाद, आप अपने application से logs, metrics और traces ingest करने के लिए एक telemetry ingestion token बना सकते हैं।

OneUptime sign up करने और project बनाने के बाद। Navigation bar में "More" पर क्लिक करें और "Project Settings" पर क्लिक करें।

Telemetry Ingestion Key page पर, token बनाने के लिए "Create Ingestion Key" पर क्लिक करें। 

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Token बनाने के बाद, token देखने के लिए "View" पर क्लिक करें।

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)


## Configuration

आप OneUptime HTTP Source को telemetry data भेजने के लिए निम्नलिखित configuration उपयोग कर सकते हैं। आप इस configuration को fluentd configuration फ़ाइल में जोड़ सकते हैं। Configuration फ़ाइल आमतौर पर `/etc/fluentd/fluent.conf` या `/etc/td-agent/td-agent.conf` पर located होती है। 

`YOUR_SERVICE_TOKEN` को पिछले चरण में बनाए गए token से बदलें। `YOUR_SERVICE_NAME` को अपनी service के नाम से भी बदलें। Service का नाम कोई भी नाम हो सकता है। यदि service OneUptime में मौजूद नहीं है, तो यह automatically बनाई जाएगी।

```yaml
# सभी patterns match करें 
<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```


पूरी configuration फ़ाइल का उदाहरण नीचे दिखाया गया है:

```yaml
####
## Source descriptions:
##

## built-in TCP input
## @see https://docs.fluentd.org/input/forward
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```

**यदि आप OneUptime self-host कर रहे हैं**: यदि आप OneUptime self-host कर रहे हैं तो आप `endpoint_url` को अपने OneUptime instance के URL से बदल सकते हैं। `http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`

## Usage

एक बार जब आप fluentd configuration फ़ाइल में configuration जोड़ लें, तो आप fluentd service restart कर सकते हैं। Service restart होने के बाद, telemetry data OneUptime HTTP Source को भेजा जाएगा। अब आप OneUptime dashboard में telemetry data देखना शुरू कर सकते हैं। यदि आपके कोई प्रश्न हैं या configuration में सहायता की आवश्यकता है, तो कृपया हमसे support@oneuptime.com पर संपर्क करें।
