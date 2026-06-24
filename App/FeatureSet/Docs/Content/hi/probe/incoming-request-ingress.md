# Incoming Request Ingress

एक Custom Probe वैकल्पिक रूप से एक **inbound HTTP listener** चला सकता है जो आपके private network के अंदर से `heartbeat` और `incoming-request` calls accept करता है और उन्हें OneUptime पर forward करता है। यह उन services को सक्षम बनाता है जिनके पास **outbound internet access नहीं है** वे `oneuptime.com` directly के बजाय local network पर probe को request भेजकर [Incoming Request Monitor](/docs/monitor/incoming-request-monitor) को report कर सकती हैं।

## Overview

जब `PROBE_INGRESS_PORT` सेट होता है, तो probe उस port पर एक additional HTTP listener bind करता है। Listener public OneUptime endpoints के समान `secretkey` URL paths accept करता है:

- `POST /heartbeat/:secretkey`
- `GET /heartbeat/:secretkey`
- `POST /incoming-request/:secretkey`
- `GET /incoming-request/:secretkey`

Probe फिर request को आपके OneUptime instance पर proxy करता है, method, body और request headers preserve करते हुए (hop-by-hop headers जैसे `Host`, `Connection`, `Content-Length`, आदि को छोड़कर)। Probe automatically एक `OneUptime-Probe-Id` header attach करता है ताकि request को forwarding probe से attribute किया जाए।

Listener **dedicated port** पर चलता है, probe के internal status/metrics endpoints से अलग, इसलिए आप इसे अपने private network पर expose कर सकते हैं बिना कुछ और expose किए।

## इसे कब उपयोग करें

Ingress listener उपयोग करें जब:

- आपकी services एक isolated network segment में चलती हैं जिसमें outbound HTTPS access नहीं है
- आप सभी monitoring traffic को अपने VPC/on-prem network के भीतर रखना चाहते हैं
- आप एक single egress point — probe — चाहते हैं जो OneUptime तक पहुंचने की अनुमति हो
- आपने पहले से एक [Custom Probe](/docs/probe/custom-probe) deploy किया है और इसे inbound heartbeats के लिए reuse करना चाहते हैं

यदि आपकी services पहले से `https://oneuptime.com` (या आपका self-hosted URL) directly reach कर सकती हैं, तो आपको इस feature की आवश्यकता **नहीं है** — service से directly heartbeat URL call करें।

## Ingress listener सक्षम करना

`PROBE_INGRESS_PORT` को उस port पर सेट करें जिस पर आप listener bind करना चाहते हैं। `0` से अधिक कोई भी value listener को सक्षम करती है; इसे unset छोड़ना (या `0`) इसे disable करता है।

### Docker

```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -d oneuptime/probe:release
```

यदि आप `--network host` उपयोग नहीं कर रहे, तो ingress port explicitly publish करें:

```bash
docker run --name oneuptime-probe \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -p 3875:3875 \
  -d oneuptime/probe:release
```

### Docker Compose

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
      - PROBE_INGRESS_PORT=3875
    ports:
      - "3875:3875"
    restart: always
```

### Kubernetes

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
            - name: PROBE_INGRESS_PORT
              value: "3875"
          ports:
            - name: ingress
              containerPort: 3875
---
apiVersion: v1
kind: Service
metadata:
  name: oneuptime-probe-ingress
spec:
  selector:
    app: oneuptime-probe
  ports:
    - name: ingress
      port: 3875
      targetPort: 3875
  type: ClusterIP
```

Internal services फिर `http://oneuptime-probe-ingress.<namespace>.svc.cluster.local:3875/heartbeat/<secret-key>` पर heartbeats भेज सकती हैं।

## Probe को requests भेजना

Public heartbeat URL बदलें:

```
https://oneuptime.com/heartbeat/<secret-key>
```

probe के ingress URL से:

```
http://<probe-host>:<PROBE_INGRESS_PORT>/heartbeat/<secret-key>
```

Path, method, body और headers otherwise identical हैं, इसलिए किसी भी existing client code को केवल base URL बदलने की आवश्यकता है।

### उदाहरण

```bash
# GET heartbeat
curl http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY

# JSON body के साथ POST heartbeat
curl -X POST http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'

# Cron job
*/5 * * * * curl -s http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY > /dev/null
```

## Forwarding behavior

- **Synchronous response, asynchronous forward.** Probe inbound request को immediately `200` के साथ acknowledge करता है और background में OneUptime को forward करता है। आपकी service को forward complete होने का इंतज़ार नहीं करना होता।
- **Headers preserved होते हैं।** Hop-by-hop ones को छोड़कर सभी headers (`Host`, `Connection`, `Content-Length`, `Transfer-Encoding`, `Keep-Alive`, आदि) pass through होते हैं। Probe एक `OneUptime-Probe-Id` header जोड़ता है जो अपनी पहचान करता है।
- **Body preserved होता है।** JSON, URL-encoded और raw `application/octet-stream` payloads **50 MB** तक accepted हैं।
- **Retries with backoff.** यदि forward fail हो जाती है, तो probe exponential backoff (2s, 4s, 8s, 15s पर capped) के साथ `PROBE_INGRESS_FORWARD_RETRY_LIMIT` बार retry करता है।
- **Proxy-aware.** यदि probe स्वयं `HTTP_PROXY_URL` / `HTTPS_PROXY_URL` के साथ configured है, तो forwarded requests proxy के माध्यम से जाएंगी।

## Environment variables

| Variable                            | Default            | विवरण                                                                                               |
| ----------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| `PROBE_INGRESS_PORT`                | _unset_ (disabled) | Inbound listener जिस Port से bind होता है। कोई भी value `> 0` ingress सक्षम करती है।                |
| `PROBE_INGRESS_FORWARD_TIMEOUT_MS`  | `10000`            | OneUptime को प्रत्येक forward attempt के लिए Timeout (ms)। Minimum `1000`।                          |
| `PROBE_INGRESS_FORWARD_RETRY_LIMIT` | `3`                | probe द्वारा forward छोड़ने से पहले retries की संख्या। retries disable करने के लिए `0` पर सेट करें। |

Standard probe variables (`PROBE_KEY`, `PROBE_ID`, `ONEUPTIME_URL`, proxy vars) सभी लागू होते हैं — पूरी list के लिए [Custom Probes](/docs/probe/custom-probe) देखें।

## Security considerations

- **Endpoint design से unauthenticated है** — URL path में secret key _ही_ authentication है, जैसा public `oneuptime.com` endpoint पर होता है। Secret key को credential के रूप में treat करें।
- **केवल private interface पर Bind करें।** Ingress listener public internet से reachable नहीं होना चाहिए। Access restrict करने के लिए network policy, firewall rule, या `ClusterIP` service उपयोग करें।
- **यदि आपको transit में encryption की आवश्यकता है तो HTTPS termination उपयोग करें।** Probe का listener plain HTTP बोलता है। यदि आपको inbound hop पर TLS चाहिए तो इसे internal load balancer/ingress controller के पीछे रखें। Forward leg probe → OneUptime always HTTPS उपयोग करती है (assuming `ONEUPTIME_URL` `https://` है)।
- **Resource limits.** Listener 50 MB तक request bodies accept करता है। यदि आपको tighter cap चाहिए, तो probe के सामने reverse proxy रखें।

## समस्या निवारण

- **Probe startup पर `Probe ingress listener started on port <port>` log करता है** — confirms करता है कि listener up है। यदि आपको यह line नहीं दिखती, तो `PROBE_INGRESS_PORT` unset, `0`, या invalid है।
- **`Probe ingress: failed to forward to <url> after N attempts`** — probe OneUptime तक पहुंच नहीं सका। probe की outbound connectivity, proxy settings और `ONEUPTIME_URL` का value जांचें।
- **`Probe ingress: probe ID not available, forwarding without it`** — probe ने अभी register नहीं किया है। Forward अभी भी succeed होती है; heartbeat simply किसी probe से attribute नहीं होगा।
- **Heartbeat OneUptime में दिखाई देता है लेकिन probe के माध्यम से नहीं** — confirm करें कि आपकी service `http://<probe-host>:<port>/...` को hit कर रही है न कि public URL को। Misconfigured DNS या `/etc/hosts` entry सामान्य कारण है।
