# OneUptime को Syslog Data भेजें

## Overview

OpenTelemetry Ingest service अब native Syslog payloads accept करती है। आप किसी भी RFC3164 या RFC5424 compatible source से HTTPS पर directly OneUptime को messages forward कर सकते हैं। OneUptime syslog priority, facility, severity, structured data और message body को parse करता है उससे पहले कि सब कुछ searchable logs के रूप में store हो।

## पूर्व आवश्यकताएं

- **Telemetry Ingestion Token** – _Project Settings → Telemetry Ingestion Keys_ से एक बनाएं और `x-oneuptime-token` value copy करें।
- **Syslog forwarder** – HTTP POST requests भेजने में सक्षम कोई भी tool (उदाहरण के लिए `curl`, `rsyslog` `omhttp` के माध्यम से, या `syslog-ng` HTTP destination plugin के साथ)।
- **Service name (वैकल्पिक)** – incoming logs को एक specific telemetry service के अंतर्गत group करने के लिए `x-oneuptime-service-name` header सेट करें।

## Endpoint

```
POST https://oneuptime.com/syslog/v1/logs
```

- यदि आप OneUptime self-host कर रहे हैं तो `oneuptime.com` को अपने host से बदलें।
- Request में हमेशा `x-oneuptime-token` header शामिल करें।

## Request Body

Newline-delimited Syslog strings या एक JSON payload `messages` array के साथ भेजें। RFC3164 (BSD) और RFC5424 formats दोनों supported हैं।

```json
{
  "messages": [
    "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login",
    "<13>Feb  5 17:32:18 db-01 postgres[2419]: connection received from 10.0.0.12"
  ]
}
```

### समर्थित Content Types

- `application/json` – अनुशंसित।
- `text/plain` – newline separated messages।
- `application/octet-stream` – raw payloads। Gzip compression (`Content-Encoding: gzip`) भी accepted है।

## curl के साथ Quick Test

```bash
curl \
  -X POST https://oneuptime.com/syslog/v1/logs \
  -H "Content-Type: application/json" \
  -H "x-oneuptime-token: YOUR_TELEMETRY_KEY" \
  -H "x-oneuptime-service-name: production-web" \
  -d '{
    "messages": [
      "<34>1 2025-03-02T14:48:05.003Z web-01 nginx 7421 ID47 [env@32473 host=\"web-01\"] 502 on /api/login"
    ]
  }'
```

## rsyslog से Forwarding

1. HTTP output module install करें:
   ```bash
   sudo apt-get install rsyslog-omhttp
   ```
2. `/etc/rsyslog.d/oneuptime.conf` में destination append करें:

   ```
   module(load="omhttp")

   template(name="OneUptimeJson" type="list") {
     constant(value="{\"messages\":[\"")
     property(name="rawmsg")
     constant(value="\"]}")
   }

   action(
     type="omhttp"
     server="oneuptime.com"
     serverport="443"
     usehttps="on"
     endpoint="/syslog/v1/logs"
     header="Content-Type: application/json"
     header="x-oneuptime-token: YOUR_TELEMETRY_KEY"
     header="x-oneuptime-service-name: rsyslog-demo"
     template="OneUptimeJson"
   )
   ```

3. rsyslog restart करें:
   ```bash
   sudo systemctl restart rsyslog
   ```

## Parsed Attributes

OneUptime automatically प्रत्येक log entry में निम्नलिखित attributes जोड़ता है:

- `syslog.priority`, `syslog.facility.code`, `syslog.facility.name`
- `syslog.severity.code`, `syslog.severity.name`
- `syslog.hostname`, `syslog.appName`, `syslog.processId`, `syslog.messageId`
- `syslog.structured.*` (flattened RFC5424 structured data)
- `syslog.raw` (traceability के लिए original message)

ये attributes Telemetry → Logs explorer के अंदर searchable बन जाते हैं।

## समस्या निवारण

- **HTTP 401 या खाली results** – सत्यापित करें कि `x-oneuptime-token` header उस project का है जो logs receive कर रहा है।
- **कोई logs नहीं दिख रहे** – confirm करें कि request body में actual syslog lines हैं। खाली bodies HTTP 400 के साथ reject होती हैं।
- **अप्रत्याशित service name** – default detection logic को override करने के लिए `x-oneuptime-service-name` सेट करें।
- **Large bursts** – प्रति request 1,000 lines तक batching supported है। बड़े bursts queued और asynchronously processed होते हैं।
