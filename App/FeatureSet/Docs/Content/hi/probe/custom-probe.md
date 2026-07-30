## Custom Probes सेट अप करना

आप अपने private network में resources या firewall के पीछे resources monitor करने के लिए अपने network के अंदर custom probes सेट अप कर सकते हैं।

शुरू करने के लिए आपको अपने Project Settings > Probe में एक custom probe बनाना होगा। एक बार जब आप OneUptime Dashboard पर custom probe बना लें। आपके पास `PROBE_ID` और `PROBE_KEY` होने चाहिए।

### Probe Deploy करें

#### Docker

probe चलाने के लिए, सुनिश्चित करें कि docker installed है। आप custom probe निम्नानुसार चला सकते हैं:

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

यदि आप OneUptime self-host कर रहे हैं, तो `ONEUPTIME_URL` को अपने custom self-hosted instance में बदल सकते हैं।

##### Proxy Configuration

यदि आपके probe को OneUptime तक पहुंचने या external resources monitor करने के लिए proxy server से गुजरना पड़ता है, तो आप इन environment variables का उपयोग करके proxy settings configure कर सकते हैं:

```
# HTTP proxy के लिए
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# HTTPS proxy के लिए
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# proxy authentication के साथ
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```

#### Docker Compose

आप docker-compose का उपयोग करके भी probe चला सकते हैं। निम्नलिखित content के साथ एक `docker-compose.yml` फ़ाइल बनाएं:

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

##### Proxy Configuration के साथ

यदि आपको proxy server उपयोग करने की आवश्यकता है, तो आप proxy environment variables जोड़ सकते हैं:

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      # Proxy configuration (वैकल्पिक)
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # Authentication के साथ proxy के लिए:
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

फिर निम्नलिखित command चलाएं:

```
docker compose up -d
```

यदि आप OneUptime self-host कर रहे हैं, तो `ONEUPTIME_URL` को अपने custom self-hosted instance में बदल सकते हैं।

#### Kubernetes

आप Kubernetes का उपयोग करके भी probe चला सकते हैं। निम्नलिखित content के साथ एक `oneuptime-probe.yaml` फ़ाइल बनाएं:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

##### Proxy Configuration के साथ

यदि आपको proxy server उपयोग करने की आवश्यकता है, तो आप proxy environment variables जोड़ सकते हैं:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            # Proxy configuration (वैकल्पिक)
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
```

फिर निम्नलिखित command चलाएं:

```bash
kubectl apply -f oneuptime-probe.yaml
```

यदि आप OneUptime self-host कर रहे हैं, तो `ONEUPTIME_URL` को अपने custom self-hosted instance में बदल सकते हैं।

### Environment Variables

Probe निम्नलिखित environment variables का समर्थन करता है:

#### आवश्यक Variables

- `PROBE_KEY` - आपके OneUptime dashboard से probe key
- `PROBE_ID` - आपके OneUptime dashboard से probe ID
- `ONEUPTIME_URL` - आपके OneUptime instance का URL (default: https://oneuptime.com)

#### वैकल्पिक Variables

- `HTTP_PROXY_URL` - HTTP requests के लिए HTTP proxy server URL
- `HTTPS_PROXY_URL` - HTTPS requests के लिए HTTP proxy server URL
- `NO_PROXY` - वे hosts या domains जिन्हें proxy bypass करना चाहिए (comma-separated)
- `PROBE_NAME` - probe के लिए Custom नाम
- `PROBE_DESCRIPTION` - probe के लिए Description
- `PROBE_MONITORING_WORKERS` - monitoring workers की संख्या (default: 1)
- `PROBE_MONITOR_FETCH_LIMIT` - एक साथ fetch करने के लिए monitors की संख्या (default: 10)
- `PROBE_MONITOR_RETRY_LIMIT` - failed monitors के लिए retries की संख्या (default: 3)
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` - milliseconds में synthetic monitor scripts का Timeout (default: 60000)
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` - milliseconds में custom code monitor scripts का Timeout (default: 60000)
- `PROBE_API_REQUEST_TIMEOUT_IN_MS` - probe द्वारा OneUptime को भेजी जाने वाली प्रत्येक request की deadline (default: 45000)
- `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` - इससे धीमी OneUptime की requests के लिए warning log करें (default: 10000)

#### Proxy Configuration

Probe HTTP और HTTPS proxy servers दोनों का समर्थन करता है। Configure होने पर, probe specified proxy servers के माध्यम से सभी monitoring traffic route करेगा। आप internal hosts या networks के लिए proxy bypass करने के लिए comma-separated `NO_PROXY` list भी provide कर सकते हैं।

**Proxy URL Format:**

```
http://[username:password@]proxy.server.com:port
```

**उदाहरण:**

- Basic proxy: `http://proxy.example.com:8080`
- Authentication के साथ: `http://username:password@proxy.example.com:8080`

**समर्थित Features:**

- HTTP और HTTPS proxy support
- Proxy authentication (username/password)
- HTTP और HTTPS proxies के बीच automatic fallback
- `NO_PROXY` का उपयोग करके selective proxy bypass
- सभी monitor types के साथ काम करता है (Website, API, SSL, Synthetic, आदि)

**नोट:** standard environment variables (`HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY`) और lowercase variants (`http_proxy`, `https_proxy`, `no_proxy`) compatibility के लिए दोनों supported हैं।

### सत्यापन

यदि probe successfully चल रहा है। यह आपके OneUptime dashboard पर `Connected` दिखाई देना चाहिए। यदि यह connected नहीं दिखता। आपको container के logs जांचने होंगे। यदि आप अभी भी trouble में हैं। कृपया [GitHub](https://github.com/oneuptime/oneuptime) पर एक issue बनाएं या [support से संपर्क करें](https://oneuptime.com/support)

### Disconnected Probe का निदान

जब OneUptime को भेजी जाने वाली probe की requests सफल होना बंद कर देती हैं, तब probe को `Disconnected` चिह्नित किया जाता है। probe का log बताता है कि हर failed request कहां अटकी, इसलिए आपको शायद ही कभी अनुमान लगाना पड़ता है।

**1. startup पर print किए गए environment block को पढ़ें।** हर probe boot के समय एक JSON block print करता है जिसमें वह OneUptime URL जिसका वह उपयोग कर रहा है, उसकी request deadline, उसकी proxy settings, उसे विरासत में मिले DNS resolvers, Node/OS version, और क्या TLS verification disabled है — यह सब होता है। जब भी आप कोई समस्या report करें, यह block शामिल करें।

**2. failure report ढूंढें।** OneUptime को भेजी गई हर failed request एक ऐसा block log करती है जिसमें `stalledAt` और `whatThisMeans` होते हैं। `stalledAt` वह phase है जिससे request कभी आगे नहीं बढ़ पाई:

| `stalledAt` | इसका क्या अर्थ है |
| --- | --- |
| `SocketAssignment` | machine से कुछ भी बाहर नहीं गया। या तो socket pool saturated था, या configure किए गए proxy ने अपना CONNECT tunnel कभी पूरा नहीं किया। |
| `TcpConnect` | machine ने SYN भेजा और बदले में कुछ नहीं मिला — कोई firewall या security appliance packets drop कर रहा है, या host unreachable है। |
| `TlsHandshake` | TCP connect हो गया, लेकिन TLS कभी पूरा नहीं हुआ। आमतौर पर इसका कारण TLS-inspecting middlebox होता है। |
| `RequestSend` | connection बन गया, लेकिन request कभी पूरी तरह लिखी नहीं गई — दूसरे छोर ने पढ़ना बंद कर दिया। |
| `WaitingForServerResponse` | request पहुंच गई और server ने बदले में कुछ नहीं भेजा। **probe का network ठीक है** — OneUptime server, उसके load balancer और उसके reverse proxy की जांच करें। |
| `ResponseBody` | server ने जवाब देना शुरू किया और बीच में ही रुक गया। |

यही block `deadlineOverrunInMs` भी report करता है। यदि 45000ms की deadline में wall clock के हिसाब से 45000ms से काफी अधिक समय लगा, तो probe process स्वयं block था — network की जांच करने से पहले इसी block में `probeProcess.eventLoopMaxDriftInMs` देखें।

**3. connectivity self-test पढ़ें।** लगातार तीन failures के बाद probe उसी server को एक-एक layer करके test करता है — पहले DNS, फिर TCP, फिर TLS, फिर एक वास्तविक HTTP round trip — और हर stage को उसकी timing के साथ log करता है। जो पहला stage fail होता है, वही आपका उत्तर है। जब proxy configure किया गया हो, तो probe proxy तक के hop को test करता है, क्योंकि वास्तव में वही एकमात्र hop है जो वह करता है।

**4. slow requests पर नजर रखें, इससे पहले कि वे failures बन जाएं।** जो requests सफल तो होती हैं लेकिन `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` से अधिक समय लेती हैं, उन्हें उनके elapsed time के साथ log किया जाता है। जो probe 20-second की requests log करने लगे, वह 45-second की deadline पार करने की राह पर है।

OneUptime server की तरफ भी, ऐसी probe request जिसका जवाब धीरे दिया गया — या जिसे response भेजे जाने से पहले ही probe ने छोड़ दिया — probe की id के साथ वहां भी log की जाती है। ये दोनों logs मिलकर बताते हैं कि connection के किस तरफ गड़बड़ी है।
