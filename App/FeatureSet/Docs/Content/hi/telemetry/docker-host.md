# OneUptime Docker Agent

## अवलोकन

OneUptime Docker Agent एक पूर्व-निर्मित कंटेनर इमेज है जो एक ट्यून किए गए OpenTelemetry Collector कॉन्फ़िगरेशन के साथ आती है। इसे अपने मौजूदा कंटेनरों के साथ चलाएं और यह होस्ट पर हर कंटेनर को स्वतः खोज लेता है, CPU / memory / network / block I/O मेट्रिक्स के साथ-साथ कंटेनर लॉग्स एकत्र करता है, और सब कुछ OTLP के माध्यम से OneUptime को अग्रेषित करता है। एकल इमेज, एकल कमांड।

यह पृष्ठ **इंस्टॉलेशन गाइड** है। एजेंट द्वारा एकत्र किए गए डेटा के ऊपर Docker मॉनिटर और अलर्ट कॉन्फ़िगर करने के लिए, देखें [Docker Monitor](/docs/monitor/docker-monitor)।

## पूर्वापेक्षाएँ

- Docker Engine 20.10+
- होस्ट पर `/var/run/docker.sock` तक पहुँच
- एक **OneUptime Telemetry Ingestion Token** — इसे _Project Settings → Telemetry Ingestion Keys_ से बनाएं और मान कॉपी करें

## त्वरित प्रारंभ (एक कमांड)

`YOUR_ONEUPTIME_URL`, `YOUR_TELEMETRY_INGESTION_TOKEN`, और होस्ट नाम को अपने परिवेश के मानों से बदलें। होस्ट नाम वह है जिससे यह Docker होस्ट OneUptime में दिखाई देगा — कुछ ऐसा चुनें जैसे `prod-docker-01`।

```bash
docker run -d \
  --name oneuptime-docker-agent \
  --user 0:0 \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /var/lib/docker/containers:/var/lib/docker/containers:ro \
  -e ONEUPTIME_URL="YOUR_ONEUPTIME_URL" \
  -e ONEUPTIME_SERVICE_TOKEN="YOUR_TELEMETRY_INGESTION_TOKEN" \
  -e DOCKER_HOST_NAME="my-docker-host" \
  oneuptime/docker-agent:release
```

बस इतना ही। एक बार एजेंट कनेक्ट हो जाने पर, आपका Docker होस्ट OneUptime डैशबोर्ड के **Docker** अनुभाग में स्वतः दिखाई देगा।

## विकल्प — Docker Compose

यदि आप Docker Compose पसंद करते हैं, तो निम्नलिखित को `docker-compose.yml` में डालें:

```yaml
services:
  oneuptime-docker-agent:
    image: oneuptime/docker-agent:release
    container_name: oneuptime-docker-agent
    user: "0:0"
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    environment:
      - ONEUPTIME_URL=YOUR_ONEUPTIME_URL
      - ONEUPTIME_SERVICE_TOKEN=YOUR_TELEMETRY_INGESTION_TOKEN
      - DOCKER_HOST_NAME=my-docker-host
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

इसे प्रारंभ करें:

```bash
docker compose up -d
```

## एनवायरनमेंट वेरिएबल्स

| वेरिएबल                   | आवश्यक | विवरण                                                                                                                       |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| `ONEUPTIME_URL`           | हाँ    | आपका OneUptime इंस्टेंस URL (उदाहरण के लिए `https://oneuptime.com` या आपका स्वयं-होस्ट किया गया होस्ट)                      |
| `ONEUPTIME_SERVICE_TOKEN` | हाँ    | _Project Settings → Telemetry Ingestion Keys_ से Telemetry ingestion token                                                  |
| `DOCKER_HOST_NAME`        | नहीं   | इस होस्ट के लिए सुलभ नाम। डिफ़ॉल्ट रूप से `docker-host`। इसे प्रति होस्ट किसी स्थिर मान पर सेट करें (उदा. `prod-docker-01`) |

## इंस्टॉलेशन सत्यापित करें

जाँचें कि एजेंट चल रहा है:

```bash
docker ps --filter name=oneuptime-docker-agent
```

एजेंट लॉग्स जाँचें:

```bash
docker logs -f oneuptime-docker-agent
```

इसे खोजें: `"Everything is ready. Begin running and processing data."`

लगभग एक मिनट के भीतर होस्ट मेट्रिक्स और लॉग्स के प्रवाह के साथ OneUptime डैशबोर्ड में दिखाई देना चाहिए।

## एजेंट को अपग्रेड करना

```bash
docker pull oneuptime/docker-agent:release
docker rm -f oneuptime-docker-agent
# Re-run the `docker run` command above
```

या Docker Compose के साथ:

```bash
docker compose pull
docker compose up -d
```

## एजेंट को अनइंस्टॉल करना

```bash
docker rm -f oneuptime-docker-agent
```

यदि आपने Docker Compose का उपयोग किया है:

```bash
docker compose down
```

## क्या एकत्र किया जाता है

| श्रेणी                | डेटा                                                   |
| --------------------- | ------------------------------------------------------ |
| **CPU Metrics**       | कुल उपयोग, उपयोग प्रतिशत, थ्रॉटलिंग समय (प्रति कंटेनर) |
| **Memory Metrics**    | उपयोग, सीमा, प्रतिशत, RSS, कैश (प्रति कंटेनर)          |
| **Network Metrics**   | प्राप्त / प्रेषित बाइट्स और पैकेट (प्रति कंटेनर)       |
| **Block I/O Metrics** | पढ़े / लिखे गए बाइट्स और ऑपरेशन (प्रति कंटेनर)         |
| **Container Info**    | अपटाइम, रीस्टार्ट गणना, प्रक्रिया गणना                 |
| **Container Logs**    | सभी कंटेनरों से stdout / stderr लॉग्स                  |

## स्वयं-होस्ट किया गया OneUptime

यदि आप OneUptime को स्वयं-होस्ट कर रहे हैं, तो `ONEUPTIME_URL` को अपने स्वयं के इंस्टेंस पर सेट करें:

```bash
-e ONEUPTIME_URL="https://your-oneuptime-host.example.com"
```

यदि आपका इंस्टेंस केवल HTTP है, तो `http://` और उपयुक्त पोर्ट का उपयोग करें।

## समस्या निवारण

### Docker Socket Permission Denied

`/var/run/docker.sock` तक पहुँचने के लिए एजेंट कंटेनर को root (`--user 0:0`) के रूप में चलना चाहिए। सुनिश्चित करें कि `--user 0:0` फ़्लैग (या Compose में `user: "0:0"`) मौजूद है।

### एजेंट डिसकनेक्टेड के रूप में दिखता है

1. जाँचें कि एजेंट चल रहा है: `docker ps --filter name=oneuptime-docker-agent`
2. एजेंट लॉग्स जाँचें: `docker logs oneuptime-docker-agent | grep -i error`
3. सत्यापित करें कि आपका OneUptime URL और service token सही हैं
4. सुनिश्चित करें कि आपका Docker होस्ट नेटवर्क पर OneUptime इंस्टेंस तक पहुँच सकता है

### कोई मेट्रिक्स दिखाई नहीं दे रहे

1. सत्यापित करें कि एजेंट के अंदर Docker socket सुलभ है: `docker exec oneuptime-docker-agent ls -la /var/run/docker.sock`
2. एक्सपोर्ट त्रुटियों के लिए collector लॉग्स जाँचें: `docker logs oneuptime-docker-agent | tail -100`
3. सुनिश्चित करें कि आपका service token वैध है और समाप्त नहीं हुआ है

### होस्ट नाम एक Container ID के रूप में दिखता है

`DOCKER_HOST_NAME` एनवायरनमेंट वेरिएबल को एक सुलभ नाम पर सेट करें और कंटेनर को फिर से बनाएं।

## अगले चरण

- कंटेनर CPU / memory / restart स्थितियों पर अलर्ट करने के लिए **Docker Monitors** कॉन्फ़िगर करें — देखें [Docker Monitor](/docs/monitor/docker-monitor)।
- स्टैंडअलोन Docker होस्ट के बजाय Kubernetes क्लस्टर के लिए, [OneUptime Kubernetes Agent](/docs/telemetry/kubernetes-agent) का उपयोग करें।
- गैर-कंटेनरीकृत होस्ट (Linux / macOS / Windows VMs और बेयर मेटल) के लिए, [Host OpenTelemetry Collector](/docs/telemetry/host-otel-collector) का उपयोग करें।
