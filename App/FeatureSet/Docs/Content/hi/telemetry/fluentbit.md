# OneUptime को telemetry data भेजने के लिए FluentBit उपयोग करें

## Overview

आप अपने applications और services से logs और telemetry data एकत्र करने के लिए [FluentBit](https://docs.fluentbit.io/manual) plugin उपयोग कर सकते हैं। Plugin telemetry data को OneUptime OpenTelemetry HTTP Collector को भेजता है। आप OneUptime OpenTelemetry HTTP Collector को telemetry data भेजने के लिए fluentbit के opentelemetry output plugin का उपयोग कर सकते हैं। यह plugin यहाँ मिल सकता है: https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry

## शुरू करना

FluentBit सैकड़ों data sources का समर्थन करता है और आप इनमें से किसी भी source से OneUptime में logs और telemetry ingest कर सकते हैं। कुछ लोकप्रिय sources में शामिल हैं:

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

आप supported sources की पूरी list [यहाँ](https://docs.fluentbit.io/manual) पा सकते हैं।

## पूर्व आवश्यकताएं

- **चरण 1: अपने system पर FluentBit Install करें** - आप [यहाँ](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit) दिए गए निर्देशों का उपयोग करके FluentBit install कर सकते हैं
- **चरण 2: OneUptime account के लिए sign up करें** - आप [यहाँ](https://oneuptime.com) एक free account के लिए sign up कर सकते हैं। कृपया ध्यान दें कि account free है, log ingestion एक paid feature है। आप pricing के बारे में अधिक details [यहाँ](https://oneuptime.com/pricing) पा सकते हैं।
- **चरण 3: OneUptime Project बनाएं** - Account होने के बाद, आप OneUptime dashboard से एक project बना सकते हैं।
- **चरण 4: Telemetry Ingestion Token बनाएं** - OneUptime account बनाने के बाद, आप अपने application से logs, metrics और traces ingest करने के लिए एक telemetry ingestion token बना सकते हैं।

OneUptime sign up करने और project बनाने के बाद। Navigation bar में "More" पर क्लिक करें और "Project Settings" पर क्लिक करें।

Telemetry Ingestion Key page पर, token बनाने के लिए "Create Ingestion Key" पर क्लिक करें।

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Token बनाने के बाद, token देखने के लिए "View" पर क्लिक करें।

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

## Configuration

आप OneUptime OpenTelemetry HTTP Collector को telemetry data भेजने के लिए निम्नलिखित configuration उपयोग कर सकते हैं। आप इस configuration को fluentbit configuration फ़ाइल में जोड़ सकते हैं। Configuration फ़ाइल आमतौर पर `/etc/fluent-bit/fluent-bit.yaml` पर located होती है। Configuration फ़ाइल का outputs section इस तरह दिखेगा:

```yaml
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
```

कृपया सुनिश्चित करें कि आपके input section में opentelemetry_envelope है। Input section का उदाहरण:

```yaml
pipeline:
  inputs:
    # आपके inputs

    processors:
      logs:
        - name: opentelemetry_envelope

        - name: content_modifier
          context: otel_resource_attributes
          action: upsert
          key: service.name
          # कृपया YOUR_SERVICE_NAME को अपनी service के नाम से बदलें
          value: YOUR_SERVICE_NAME
```

यहाँ पूरी configuration फ़ाइल का उदाहरण है:

```yaml
service:
  flush: 1
  log_level: info

pipeline:
  inputs:
    - name: http
      listen: 0.0.0.0
      port: 8888

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
```

**यदि आप OneUptime self-host कर रहे हैं**: यदि आप OneUptime self-host कर रहे हैं तो आप `host` को अपने OneUptime instance के host से बदल सकते हैं। यदि आप https के बजाय http server पर host कर रहे हैं, तो आप `port` को अपने OneUptime instance के port से बदल सकते हैं (likely port 80)।

इस मामले में configuration इस तरह दिखेगी:

```yaml
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
```

## Usage

एक बार जब आप fluentbit configuration फ़ाइल में configuration जोड़ लें, तो आप fluentbit service restart कर सकते हैं। Service restart होने के बाद, telemetry data OneUptime HTTP Source को भेजा जाएगा। अब आप OneUptime dashboard में telemetry data देखना शुरू कर सकते हैं। यदि आपके कोई प्रश्न हैं या configuration में सहायता की आवश्यकता है, तो कृपया हमसे support@oneuptime.com पर संपर्क करें।
