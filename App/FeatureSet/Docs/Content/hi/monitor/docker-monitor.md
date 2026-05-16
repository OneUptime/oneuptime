# Docker Monitor

Docker monitoring आपको अपने Docker hosts और उन पर चलने वाले containers की health और performance monitor करने की अनुमति देता है। OneUptime एक pre-configured OpenTelemetry Collector (**OneUptime Docker Agent**) के माध्यम से metrics और container logs एकत्र करता है और उन्हें आपके configured criteria के विरुद्ध evaluate करता है।

## Overview

Docker monitors आपके hosts के metrics और logs का उपयोग करके आपके container workloads में visibility प्रदान करते हैं। यह आपको सक्षम बनाता है:

- Docker host और per-container health monitor करें
- containers में CPU, memory, network, block I/O और process counts track करें
- container restarts, crashes और CPU throttling detect करें
- native OpenTelemetry format में structured container logs stream करें
- high CPU, high memory, restart loops और अधिक पर alert करें

## Docker Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **Docker** चुनें
4. monitor करने के लिए Docker host और resource scope चुनें
5. metric queries और aggregation configure करें
6. आवश्यकतानुसार monitoring criteria configure करें

## Configuration Options

### Docker Host

monitor करने के लिए Docker host चुनें। Hosts को पहली बार auto-registered किया जाता है जब OneUptime Docker Agent उनसे telemetry ship करता है — आपको उन्हें manually बनाने की आवश्यकता नहीं है।

### Resource Scope

उस level को चुनें जिस पर resources monitor करने हैं:

| Scope | विवरण |
|-------|-------|
| Host | सभी containers में aggregated, पूरे Docker host को monitor करें |
| Container | नाम या image से एक specific container monitor करें |

### Metric Queries

evaluate करने के लिए एक या अधिक metric queries configure करें। प्रत्येक query निर्दिष्ट करती है:

- **Metric name** — query करने के लिए container metric
- **Aggregation** — metric values को कैसे aggregate करें (Avg, Sum, Max, Min)
- **Filters** — additional attribute-based filtering (जैसे container name, image, या host से)
- **Group By** — वैकल्पिक रूप से `resource.container.name` से group करें ताकि प्रत्येक container को स्वतंत्र रूप से evaluate किया जाए

आप **formulas** भी बना सकते हैं जो mathematical expressions का उपयोग करके कई metric queries को combine करती हैं।

### Rolling Time Window

metric evaluation के लिए time window चुनें:

- Past 1 Minute
- Past 5 Minutes
- Past 10 Minutes
- Past 15 Minutes
- Past 30 Minutes
- Past 60 Minutes

## Collected Metrics

Docker Agent OpenTelemetry `docker_stats` receiver उपयोग करता है, जो configurable interval पर Docker Engine API को scrape करता है (default हर 30 seconds)।

### CPU

| Metric | विवरण |
|--------|-------|
| `container.cpu.utilization` | host CPU के percentage के रूप में CPU utilization |
| `container.cpu.usage.total` | container द्वारा consumed cumulative CPU time |
| `container.cpu.throttling_data.throttled_time` | container को cgroups द्वारा throttle किया गया समय |
| `container.cpu.throttling_data.throttled_periods` | throttling periods की संख्या |

### Memory

| Metric | विवरण |
|--------|-------|
| `container.memory.usage.total` | bytes में वर्तमान memory usage |
| `container.memory.usage.limit` | bytes में memory limit |
| `container.memory.percent` | limit के percentage के रूप में memory usage |

### Network

| Metric | विवरण |
|--------|-------|
| `container.network.io.usage.rx_bytes` | प्राप्त कुल bytes |
| `container.network.io.usage.tx_bytes` | transmitted कुल bytes |

### Block I/O

| Metric | विवरण |
|--------|-------|
| `container.blockio.io_service_bytes_recursive.read` | block devices से read bytes |
| `container.blockio.io_service_bytes_recursive.write` | block devices पर written bytes |

### Container Info

| Metric | विवरण |
|--------|-------|
| `container.uptime` | seconds में Container uptime |
| `container.restarts` | container restart होने की संख्या |
| `container.pids.count` | container के अंदर processes की संख्या |

## Monitoring Criteria

### उपलब्ध Check Types

| Check Type | विवरण |
|------------|-------|
| Metric Value | configured metric query या formula का value |

### Aggregation Types

| Aggregation | विवरण |
|-------------|-------|
| Average | time window पर average value |
| Sum | सभी values का sum |
| Maximum Value | time window में highest value |
| Minimum Value | time window में lowest value |
| All Values | सभी values criteria से match होनी चाहिए |
| Any Value | कम से कम एक value match होनी चाहिए |

### Filter Types

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

## Pre-built Alert Templates

OneUptime सामान्य Docker monitoring scenarios के लिए templates प्रदान करता है:

| Template | विवरण | Threshold | Aggregation |
|----------|-------|-----------|-------------|
| High Container CPU | प्रति container CPU utilization | > 90% | Max (प्रति container) |
| High Container Memory | limit के percent के रूप में Memory usage | > 85% | Max (प्रति container) |
| High CPU Throttling | CPU throttled periods | > 0 | Max (प्रति container) |
| Container Restart Loop | Container restart count | > 3 | Sum |
| Container Down | Container uptime 0 पर reset | = 0 | Min |

> नोट: CPU, memory और throttling templates **Max** aggregation का उपयोग करते हैं जो `resource.container.name` से grouped होती है। यह एक single hot container के signal को एक ही host पर कई idle containers द्वारा dilute होने से रोकता है।

## Collected Logs

Metrics के अलावा, Docker Agent OpenTelemetry filelog receiver के माध्यम से हर container की `*-json.log` फ़ाइल को tail करता है और native OTLP log format में log records ship करता है। प्रत्येक log record इनसे enriched होता है:

- `resource.host.name` — Docker host identifier
- `resource.container.id` — पूर्ण container ID
- `resource.container.runtime` — हमेशा `docker`
- `attributes["log.iostream"]` — `stdout` या `stderr`
- `severityText` / `severityNumber` — stream से derived: `stderr` → `ERROR`, `stdout` → `INFO`
- `body` — container process द्वारा emit की गई raw log line
- `time` — line के लिए Docker daemon का timestamp

Logs Docker host के **Logs** tab पर और प्रत्येक container की detail page पर दिखाई देते हैं।

### Log Driver Requirement

**Docker Agent केवल उन containers से logs ingest करता है जो Docker के `json-file` log driver का उपयोग करते हैं।** यह Docker का default है, लेकिन इसे per-container या globally override किया जा सकता है:

- **`local`** driver — binary protobuf chunks को `/var/lib/docker/containers/<id>/local-logs/container.log` पर लिखता है। filelog receiver इस format को parse नहीं कर सकता।
- **`journald`**, **`syslog`**, **`fluentd`**, **`gelf`**, **`awslogs`**, **`splunk`**, आदि — logs को remote destination पर भेजते हैं; tail करने के लिए कोई फ़ाइल नहीं।
- **`none`** — logs पूरी तरह discard करता है।

यदि उपरोक्त में से कोई भी उपयोग में है, तो आपको Docker host page पर metrics दिखाई देंगे लेकिन **Logs** tab खाली होगा (या केवल Docker Agent के अपने logs होंगे)।

**एक specific container का log driver जांचें:**

```bash
docker inspect <container> --format '{{.HostConfig.LogConfig.Type}}'
```

**daemon default जांचें:**

```bash
docker info --format '{{.LoggingDriver}}'
```

**एक Docker Compose service को sensible rotation के साथ `json-file` पर switch करें:**

```yaml
services:
  my-app:
    image: my-app:latest
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
```

**daemon default switch करें** (बाद में बनाए गए हर container पर लागू होता है) `/etc/docker/daemon.json` संपादित करके:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "5"
  }
}
```

फिर Docker daemon restart करें और affected containers **recreate** करें। Docker container create time पर log driver bind करता है, इसलिए एक existing container अपना पुराना driver तब तक रखता है जब तक इसे remove और recreate न किया जाए:

```bash
# Docker Compose
docker compose up -d --force-recreate <service>

# Plain docker
docker rm -f <container>
docker run ... <image>
```

## Setup Requirements

Docker monitoring उपयोग करने के लिए, आपको:

1. आप जो monitor करना चाहते हैं उस हर Docker host पर OneUptime Docker Agent install करें
2. `ONEUPTIME_URL`, `ONEUPTIME_SERVICE_TOKEN` और `DOCKER_HOST_NAME` को environment variables के रूप में pass करें
3. सुनिश्चित करें कि आप जिन containers को observe करना चाहते हैं वे `json-file` log driver उपयोग करते हैं (ऊपर देखें)

Agent Docker Hub पर `oneuptime/docker-agent:release` के रूप में published है। पूरे `docker run` और `docker compose` उदाहरणों के लिए [Docker Agent installation guide](https://github.com/OneUptime/oneuptime/tree/master/DockerAgent) देखें।

## समस्या निवारण

### Metrics दिखाई देते हैं लेकिन Logs tab खाली है

आपके containers लगभग निश्चित रूप से `json-file` log driver उपयोग नहीं कर रहे। ऊपर [Log Driver Requirement](#log-driver-requirement) section में diagnostic commands चलाएं और किसी भी container को switch करें जिन्हें उनके logs ship करने की आवश्यकता है।

### Filelog receiver `no files match the configured criteria` log करता है

इसका मतलब है कि include glob `/var/lib/docker/containers/*/*-json.log` agent start होने पर किसी भी फ़ाइल से match नहीं हुआ। या तो:

1. इस host पर कोई container `json-file` उपयोग नहीं कर रहा, या
2. bind mount `-v /var/lib/docker/containers:/var/lib/docker/containers:ro` missing है या एक खाली directory की ओर point कर रहा है, या
3. Agent Linux VM के container directory के expose किए बिना macOS के लिए Docker Desktop पर चल रहा है।

### Logs arrive हो रहे हैं लेकिन गलत host name के अंतर्गत grouped हैं

OneUptime Docker hosts को `resource.host.name` से auto-register करता है, जो `DOCKER_HOST_NAME` environment variable से लिया जाता है। पहले telemetry batch के बाद `DOCKER_HOST_NAME` बदलने से existing one का नाम बदलने के बजाय एक second host row बन जाएगी।

### "High CPU" के लिए Incidents fire नहीं हो रहे

सुनिश्चित करें कि metric query का aggregation **Max** है (Avg नहीं) और यह `resource.container.name` से group करता है। एक busy host पर सभी containers में Avg, idle containers द्वारा diluted होता है और शायद ही कभी threshold cross करता है।
