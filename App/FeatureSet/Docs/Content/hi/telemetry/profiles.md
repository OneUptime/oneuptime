# OneUptime को Continuous Profiling Data भेजें

## Overview

Continuous profiling, logs, metrics और traces के साथ observability का चौथा स्तंभ है। Profiles capture करते हैं कि आपका application function level पर CPU time कैसे खर्च करता है, memory कैसे allocate करता है और system resources का उपयोग कैसे करता है। OneUptime OpenTelemetry Protocol (OTLP) के माध्यम से profiling data ingest करता है और इसे unified analysis के लिए आपके अन्य telemetry signals के साथ store करता है।

OneUptime में profiling data के साथ, आप CPU consuming hot functions identify कर सकते हैं, memory leaks detect कर सकते हैं, contention bottlenecks खोज सकते हैं, और performance issues को specific traces और spans के साथ correlate कर सकते हैं।

## समर्थित Profile Types

OneUptime निम्नलिखित profile types का समर्थन करता है:

| Profile Type  | विवरण                                   | Unit        |
| ------------- | --------------------------------------- | ----------- |
| cpu           | code execute करने में CPU time          | nanoseconds |
| wall          | Wall-clock time (waiting/sleeping सहित) | nanoseconds |
| alloc_objects | heap allocations की संख्या              | count       |
| alloc_space   | allocated heap memory के Bytes          | bytes       |
| goroutine     | active goroutines की संख्या (Go)        | count       |
| contention    | locks/mutexes पर इंतज़ार में लगा समय    | nanoseconds |

## शुरू करना

### चरण 1 - एक Telemetry Ingestion Token बनाएं

OneUptime sign up करने और project बनाने के बाद, Navigation bar में "More" पर क्लिक करें और "Project Settings" पर क्लिक करें।

Telemetry Ingestion Key page पर, token बनाने के लिए "Create Ingestion Key" पर क्लिक करें।

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Token बनाने के बाद, token देखने के लिए "View" पर क्लिक करें।

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)

### चरण 2 - अपना Profiler Configure करें

OneUptime OTLP profiles protocol का उपयोग करके gRPC और HTTP दोनों पर profiling data accept करता है।

| Protocol | Endpoint                                             |
| -------- | ---------------------------------------------------- |
| gRPC     | `your-oneuptime-host:4317` (OTLP standard gRPC port) |
| HTTP     | `https://your-oneuptime-host/otlp/v1/profiles`       |

**Environment Variables**

अपने profiler को OneUptime पर point करने के लिए निम्नलिखित environment variables सेट करें:

```bash
export OTEL_EXPORTER_OTLP_HEADERS=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN
export OTEL_EXPORTER_OTLP_ENDPOINT=https://oneuptime.com/otlp
export OTEL_SERVICE_NAME=my-service
```

**Self Hosted OneUptime**

यदि आप OneUptime self-hosting कर रहे हैं, तो endpoint को अपने host से बदलें (जैसे `http(s)://YOUR-ONEUPTIME-HOST/otlp`)। gRPC के लिए, अपने OneUptime host पर port 4317 से directly connect करें।

## Instrumentation Guide

### Grafana Alloy का उपयोग करना (eBPF-based profiling)

Grafana Alloy (पहले Grafana Agent) eBPF का उपयोग करके Linux host पर सभी processes से CPU profiles एकत्र कर सकता है, बिना किसी code changes की आवश्यकता के। इसे OneUptime को OTLP के माध्यम से export करने के लिए configure करें।

Alloy configuration का उदाहरण:

```hcl
pyroscope.ebpf "default" {
  forward_to = [pyroscope.write.oneuptime.receiver]
  targets    = discovery.process.all.targets
}

pyroscope.write "oneuptime" {
  endpoint {
    url = "https://oneuptime.com/pyroscope"
    headers = {
      "x-oneuptime-token" = "YOUR_ONEUPTIME_SERVICE_TOKEN",
    }
  }
}
```

### async-profiler का उपयोग करना (Java)

Java applications के लिए, OTLP के माध्यम से profiling data भेजने के लिए OpenTelemetry Java agent के साथ [async-profiler](https://github.com/async-profiler/async-profiler) उपयोग करें।

```bash
# OpenTelemetry Java agent के साथ अपना Java application start करें
java -javaagent:opentelemetry-javaagent.jar \
  -Dotel.exporter.otlp.endpoint=https://oneuptime.com/otlp \
  -Dotel.exporter.otlp.headers=x-oneuptime-token=YOUR_ONEUPTIME_SERVICE_TOKEN \
  -Dotel.service.name=my-java-service \
  -jar my-app.jar
```

### OpenTelemetry Collector का उपयोग करना

आप अपने applications से profiles receive करने और उन्हें OneUptime पर forward करने के लिए OpenTelemetry Collector को proxy के रूप में उपयोग कर सकते हैं।

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

exporters:
  otlphttp:
    endpoint: "https://oneuptime.com/otlp"
    encoding: json
    headers:
      "Content-Type": "application/json"
      "x-oneuptime-token": "YOUR_ONEUPTIME_SERVICE_TOKEN"

service:
  pipelines:
    profiles:
      receivers: [otlp]
      exporters: [otlphttp]
```

## Features

### Flamegraph Visualization

OneUptime profile data को interactive flamegraphs के रूप में render करता है। प्रत्येक bar call stack में एक function represent करता है, और इसकी width consumed time या resources के proportional है। आप किसी भी function पर click करके zoom in कर सकते हैं और इसके callers और callees देख सकते हैं।

### Function List

एक profile में capture किए गए सभी functions की एक sortable table देखें, self time, total time, या allocation count के अनुसार ranked। यह आपको अपने application में सबसे expensive functions को जल्दी identify करने में मदद करता है।

### Trace Correlation

OneUptime में Profiles, distributed traces के साथ correlate किए जा सकते हैं। जब एक profile में trace और span IDs शामिल होते हैं, तो आप एक slow trace span से सीधे corresponding CPU या memory profile पर navigate कर सकते हैं।

## Data Retention

Profile data retention आपके OneUptime project settings में प्रति telemetry service configure की जाती है। Default retention period 15 दिन है। Data retention period expire होने के बाद automatically delete हो जाता है।

किसी service के लिए retention period बदलने के लिए, **Telemetry > Services > [Your Service] > Settings** पर जाएं और data retention value update करें।

## सहायता चाहिए?

यदि आपको OneUptime के साथ profiling सेट अप करने में सहायता की आवश्यकता है तो कृपया support@oneuptime.com से संपर्क करें।
