# Host OpenTelemetry Collector (Linux, macOS, Windows)

## अवलोकन

आप होस्ट टेलीमेट्री को OTLP के माध्यम से OneUptime तक भेजने के लिए अपने Linux, macOS, या Windows होस्ट पर सीधे **OpenTelemetry Collector** को एक सेवा के रूप में चला सकते हैं। यह पृष्ठ collector को इंस्टॉल करने, इसे प्रत्येक OS के लिए कॉन्फ़िगर करने, और आप जो एकत्र करना चाहते हैं उसके लिए सही receivers चुनने के बारे में मार्गदर्शन करता है:

- हर OS पर **होस्ट मेट्रिक्स** (CPU, memory, disk, filesystem, network, load, processes)
- [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver) के माध्यम से `/var/log/**` के अंतर्गत **फ़ाइल-आधारित logs** (Linux, macOS)
- [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver) के माध्यम से **systemd journal** (Linux)
- एक tailed `log stream` आउटपुट को लपेटते हुए [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) के माध्यम से **Apple Unified Log** (macOS)
- [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver) के माध्यम से **Windows Event Logs**
- [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) के माध्यम से **Windows service status** (जो होस्ट **Services** टैब को शक्ति प्रदान करता है) — **v0.155.0** से आगे अपस्ट्रीम `otelcol-contrib` बिल्ड में बंडल किया गया है (नीचे "Windows Services (मेट्रिक्स)" देखें)

> **OneUptime Infrastructure Agent के बारे में क्या?** वह agent एक अलग, हल्का Go daemon है जो बुनियादी मेट्रिक्स और _Server / VM Monitor_ फ़ीचर (status, processes, alerting) पर केंद्रित है। यहाँ वर्णित OpenTelemetry Collector स्वतंत्र है और तब सही उपकरण है जब आप logs (फ़ाइल logs, journald, Windows Event Logs) या मानक OTLP के रूप में ग्रहण किए गए समृद्ध होस्ट मेट्रिक्स चाहते हैं। दोनों एक ही होस्ट पर बिना हस्तक्षेप किए चल सकते हैं।

## पूर्वापेक्षाएँ

- एक **OneUptime Telemetry Ingestion Token** — _Project Settings → Telemetry Ingestion Keys_ से एक बनाएँ और `x-oneuptime-token` मान कॉपी करें।
- **OpenTelemetry Collector Contrib** वितरण (`otelcol-contrib`)। डिफ़ॉल्ट `otelcol` बिल्ड में `windowseventlogreceiver`, `journaldreceiver`, या `hostmetrics` अतिरिक्त जैसे receivers **शामिल नहीं** हैं — सुनिश्चित करें कि आप `contrib` वितरण का उपयोग करें। alpha `windowsservicereceiver` जो Windows **Services** टैब को शक्ति प्रदान करता है, **v0.155.0** से आगे `otelcol-contrib` में बंडल किया गया है, इसलिए एक वर्तमान रिलीज़ इंस्टॉल करें; नीचे "Windows Services (मेट्रिक्स)" देखें।
- collector को एक सेवा के रूप में इंस्टॉल करने और (जहाँ लागू हो) विशेषाधिकार प्राप्त log स्रोतों को पढ़ने के लिए होस्ट पर Root / Administrator।

## चरण 1 — OpenTelemetry Collector इंस्टॉल करें

अपने OS के लिए अनुभाग चुनें। सभी उदाहरण मानते हैं कि आप [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) से नवीनतम `otelcol-contrib` रिलीज़ इंस्टॉल कर रहे हैं।

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.156.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Debian पैकेज बाइनरी को `/usr/bin/otelcol-contrib` पर, डिफ़ॉल्ट कॉन्फ़िग को `/etc/otelcol-contrib/config.yaml` पर, और एक systemd यूनिट को `/etc/systemd/system/otelcol-contrib.service` पर इंस्टॉल करता है।

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.156.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

पथ Debian पैकेज से मेल खाते हैं (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, systemd यूनिट `otelcol-contrib`)।

### macOS

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/')
VERSION=0.156.0

curl -L -o otelcol-contrib.tar.gz \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_darwin_${ARCH}.tar.gz"

sudo mkdir -p /usr/local/otelcol-contrib
sudo tar -xzf otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib
sudo ln -sf /usr/local/otelcol-contrib/otelcol-contrib /usr/local/bin/otelcol-contrib
sudo mkdir -p /etc/otelcol-contrib
```

आप चरण 2 में `/etc/otelcol-contrib/config.yaml` और चरण 3 में एक `launchd` plist बनाएँगे।

### Windows

Windows पर, अपस्ट्रीम **`otelcol-contrib`** रिलीज़ डाउनलोड करें — यह `windows_service` receiver को बंडल करता है जो होस्ट **Services** टैब को शक्ति प्रदान करता है (**v0.155.0** से आगे)। एक **elevated** PowerShell प्रॉम्प्ट से:

```powershell
$VERSION = "0.156.0"                          # use v0.155.0 or later for the Services tab
$dest    = "C:\Program Files\otelcol-contrib"
$tar     = "$env:TEMP\otelcol-contrib.tar.gz"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
# amd64; use the _windows_arm64.tar.gz asset on ARM
Invoke-WebRequest -Uri "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v$VERSION/otelcol-contrib_${VERSION}_windows_amd64.tar.gz" -OutFile $tar
tar -xf $tar -C $dest                          # tar.exe ships with Windows 10 1803+ / Server 2019+
```

यह `otelcol-contrib.exe` को `C:\Program Files\otelcol-contrib` में अनपैक करता है। आप चरण 2 में उसी फ़ोल्डर में `config.yaml` बनाएँगे और चरण 3 में एक Windows सेवा पंजीकृत करेंगे।

> एक native installer पसंद करते हैं? OpenTelemetry उसी [releases page](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) पर एक हस्ताक्षरित **`.msi`** (`otelcol-contrib_<version>_windows_x64.msi`) भी प्रकाशित करता है, जो आपके लिए collector को एक Windows सेवा के रूप में पंजीकृत करता है। यदि आप इसका उपयोग करते हैं, तो इसे चरण 2 से `config.yaml` पर इंगित करें और सुनिश्चित करें कि सेवा `LocalSystem` के रूप में चलती है ताकि **Services** टैब Service Control Manager पढ़ सके।

## चरण 2 — collector कॉन्फ़िगर करें

कॉन्फ़िगरेशन फ़ाइल यहाँ रहती है:

| OS      | पथ                                                    |
| ------- | ----------------------------------------------------- |
| Linux   | `/etc/otelcol-contrib/config.yaml`                    |
| macOS   | `/etc/otelcol-contrib/config.yaml`                    |
| Windows | `C:\Program Files\otelcol-contrib\config.yaml` |

प्रत्येक कॉन्फ़िग एक ही आकार का अनुसरण करता है — आप जो receivers चाहते हैं उन्हें चुनें, एक `batch` और `resource` processor जोड़ें, और OTLP HTTP के माध्यम से OneUptime में निर्यात करें। नीचे दिए गए उदाहरण प्रति OS एक पूर्ण, कॉपी-पेस्ट करने योग्य कॉन्फ़िग दिखाते हैं, फिर प्रत्येक receiver ब्लॉक के माध्यम से मार्गदर्शन करते हैं ताकि आप मिक्स-एंड-मैच कर सकें।

अपने वातावरण के अनुरूप `YOUR_TELEMETRY_INGESTION_TOKEN` और `service.name` मान को बदलें।

### सामान्य टुकड़े (हर OS द्वारा उपयोग किए जाते हैं)

```yaml
processors:
  batch:
    send_batch_size: 512
    timeout: 5s

  resource:
    attributes:
      - key: service.name
        value: host-telemetry
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

- **`batch`** निर्यात से पहले रिकॉर्ड को समूहित करता है ताकि आप प्रति रिकॉर्ड एक HTTP राउंड ट्रिप का भुगतान न करें।
- **`resource`** प्रत्येक रिकॉर्ड को `service.name` के साथ चिह्नित करता है। यदि आप चाहते हैं कि प्रत्येक मशीन OneUptime में अपनी स्वयं की टेलीमेट्री सेवा के रूप में दिखाई दे तो प्रति होस्ट एक अलग मान (उदा. `prod-web-01`) का उपयोग करें।
- **`otlphttp`** संलग्न ingestion token के साथ HTTPS के माध्यम से OneUptime को भेजता है।

### होस्ट मेट्रिक्स (Linux, macOS, Windows)

हर OS पर काम करता है। होस्ट कर्नेल से CPU, memory, disk, filesystem, network, load, paging, और process मेट्रिक्स उठाता है:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:
      process:
        mute_process_name_error: true
```

> Linux पर, collector `/proc` और `/sys` पढ़ता है। जब collector एक container में चलता है, तो होस्ट के `/proc` और `/sys` को माउंट करें और `HOST_PROC` / `HOST_SYS` एनवायरनमेंट वैरिएबल सेट करें। जब यह सीधे एक systemd सेवा के रूप में चलता है (जैसा ऊपर इंस्टॉल किया गया है), तो किसी अतिरिक्त सेटअप की आवश्यकता नहीं है।

### फ़ाइल logs (Linux, macOS)

डिस्क पर किसी भी log फ़ाइल को tail करें। नीचे एक सामान्य प्रारंभिक सेट है:

```yaml
receivers:
  filelog/syslog:
    include:
      - /var/log/syslog
      - /var/log/messages
    start_at: end

  filelog/auth:
    include:
      - /var/log/auth.log
      - /var/log/secure
    start_at: end
```

`start_at: end` का अर्थ है collector के शुरू होने के क्षण से नई लाइनें; पहली बार चलने पर backfill करने के लिए `beginning` में बदलें। collector फ़ाइल ऑफ़सेट को ट्रैक करता है, इसलिए यह पुनरारंभ के बीच सही ढंग से फिर से शुरू होता है।

**होस्ट log stack traces को Exceptions में बदलना।** OneUptime स्वचालित रूप से stack traces के लिए error और fatal log लाइनों को स्कैन करता है और उन्हें इस होस्ट के लिए जिम्मेदार **Exceptions** (Issues) दृश्य में रोल अप करता है — किसी अतिरिक्त कॉन्फ़िगरेशन की आवश्यकता नहीं है। इसके अच्छी तरह से समूहित होने के लिए, एक मल्टी-लाइन stack trace (Java, Python, .NET, Ruby) को **एक** log रिकॉर्ड के रूप में आना चाहिए, प्रति लाइन एक रिकॉर्ड नहीं। `filelog` receiver पर multiline recombination सक्षम करें ताकि एक trace और उसके frames एक साथ रहें:

```yaml
receivers:
  filelog/app:
    include:
      - /var/log/myapp/*.log
    start_at: end
    multiline:
      # A new log entry starts with a timestamp; continuation lines (the
      # "at ...", "File ...", "Caused by: ..." frames) are folded into it.
      line_start_pattern: '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}'
```

recombination के बिना, प्रत्येक frame एक अलग log के रूप में ग्रहण किया जाता है और exception एक-लाइन, खराब-समूहित issue के रूप में दिखाई देगा। यदि आपका एप्लिकेशन सीधे OpenTelemetry `exception.type` / `exception.message` / `exception.stacktrace` log विशेषताओं को उत्सर्जित कर सकता है, तो इसके बजाय वह करें — यह सबसे विश्वसनीय मार्ग है और multiline parsing से स्वतंत्र है।

### systemd journal (Linux)

यदि आपका होस्ट systemd का उपयोग करता है, तो `journald` receiver अक्सर `/var/log/*` को tail करने की तुलना में बेहतर फिट होता है — यह सब कुछ एक जगह कैप्चर करता है और संरचित फ़ील्ड को संरक्षित करता है:

```yaml
receivers:
  journald:
    directory: /var/log/journal
    units:
      # Drop this list to ingest everything; restrict it to limit volume.
      - ssh.service
      - cron.service
      - nginx.service
    priority: info
```

collector बाइनरी को `journalctl` निष्पादित करने में सक्षम होना चाहिए (Debian / RPM पैकेज पहले से ही इसे एक निर्भरता के रूप में शामिल करते हैं)।

### Apple Unified Log (macOS)

macOS ने Apple Unified Log के पक्ष में `/var/log/system.log` को अप्रचलित कर दिया, जिसे `log show` / `log stream` के साथ क्वेरी किया जाता है। इसे ग्रहण करने का सबसे सरल तरीका एक छोटे रैपर के साथ `filelog` receiver के माध्यम से `log` आउटपुट को stream करना है। `/usr/local/otelcol-contrib/log-stream.sh` बनाएँ:

```bash
#!/bin/bash
exec /usr/bin/log stream --style ndjson --level info \
  --predicate 'subsystem != "com.apple.cfnetwork"' \
  >> /var/log/apple-unified.log
```

इसे निष्पादन योग्य बनाएँ, इसे launchd के अंतर्गत चलाएँ (या एक त्वरित परीक्षण के लिए `nohup`), फिर collector को फ़ाइल पर इंगित करें:

```yaml
receivers:
  filelog/apple-unified:
    include:
      - /var/log/apple-unified.log
    start_at: end
    operators:
      - type: json_parser
        timestamp:
          parse_from: attributes.timestamp
          layout: "%Y-%m-%d %H:%M:%S.%f%j"
```

(यदि आपको unified log की आवश्यकता नहीं है, तो इसे छोड़ दें — Mac fleets अक्सर केवल होस्ट मेट्रिक्स + कुछ फ़ाइल logs के साथ ठीक चलते हैं।)

### Windows Event Logs

मूल `wevtapi` के माध्यम से उन चैनलों की सदस्यता लें जिनकी आप परवाह करते हैं:

```yaml
receivers:
  windowseventlog/system:
    channel: System
    start_at: end

  windowseventlog/application:
    channel: Application
    start_at: end

  windowseventlog/security:
    channel: Security
    start_at: end
```

उच्च-मात्रा वाले `Security` चैनल को विशिष्ट event IDs तक सीमित करने के लिए:

```yaml
windowseventlog/security:
  channel: Security
  start_at: end
  query: "*[System[(EventID=4625 or EventID=4740)]]"
```

किसी कस्टम या एप्लिकेशन-विशिष्ट चैनल को पढ़ने के लिए (कुछ भी जो आप _Event Viewer → Applications and Services Logs_ के अंतर्गत देख सकते हैं), इसके सटीक प्रदर्शन नाम का उपयोग करें:

```yaml
windowseventlog/iis:
  channel: Microsoft-IIS-Logging/Logs
  start_at: end
```

### Windows Services (मेट्रिक्स)

होस्ट **Services** टैब को [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) (कॉन्फ़िग प्रकार `windows_service`) द्वारा शक्ति प्रदान की जाती है, जो Windows सेवाओं की चालू स्थिति और स्टार्टअप प्रकार को मेट्रिक्स के रूप में रिपोर्ट करता है।

**यह receiver v0.155.0 से आगे अपस्ट्रीम `otelcol-contrib` बाइनरी में शिप होता है** — पुराने रिलीज़ पर, `windows_service` जोड़ने पर वह स्टार्टअप पर `'receivers' unknown type: "windows_service"` के साथ विफल हो जाता है। एक वर्तमान रिलीज़ इंस्टॉल करें (चरण 1), फिर इसे अपने `config.yaml` में सक्षम करें और इसे metrics pipeline में जोड़ें:

```yaml
receivers:
  windows_service:
    collection_interval: 30s
    # Collect every service by default. To cut volume — and avoid the
    # "access denied" noise from services the collector can't open —
    # list just the ones you care about:
    # include_services: [Spooler, W3SVC, MSSQLSERVER]
    # Or collect everything except a few:
    # exclude_services: [TrustedInstaller]

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, windows_service]
```

receiver प्रति सेवा एक `windows.service.status` gauge उत्सर्जित करता है — पूर्णांक Win32 सेवा स्थिति है (`4` = running, `1` = stopped) — `name` और `startup_mode` विशेषताओं के साथ। collector को `LocalSystem` के रूप में चलाएँ (`sc.exe` डिफ़ॉल्ट) ताकि यह हर सेवा पढ़ सके; जिसे भी यह नहीं खोल सकता उसे छोड़ दिया जाता है। यह receiver **alpha** और **केवल-Windows** है; ज्ञात समस्याओं में एक scrape त्रुटि शामिल है जो collector को क्रैश कर सकती है और एक सेवा पर `access denied` दूसरों को प्रभावित कर सकता है — यदि आप इनका सामना करते हैं तो `include_services` तक सीमित रखें।

> **`include_services` का कोई प्रभाव नहीं?** फ़िल्टर केवल सेट को *संकीर्ण* कर सकता है, इसलिए यदि आप सेवाएँ सूचीबद्ध करते हैं और फिर भी हर एक देखते हैं, तो संपादित कॉन्फ़िग लगभग निश्चित रूप से चल रहे collector तक नहीं पहुँचा है। संपादन के बाद सेवा को पुनरारंभ करें (चरण 3); सुनिश्चित करें कि `include_services` `collection_interval` के समान इंडेंट पर एक भरी हुई सूची है (टिप्पणी की गई या खाली नहीं छोड़ी गई); और **Services** टैब को कुछ मिनट दें ताकि परिवर्तन से पहले रिपोर्ट की गई सेवाएँ इसकी रोलिंग विंडो से पुरानी होकर बाहर हो जाएँ। नाम सटीक, केस-संवेदी Windows सेवा _key_ नाम हैं (उदा. `Spooler`, `W3SVC`), जिन्हें आप `Get-Service | Select-Object Name` के साथ सूचीबद्ध कर सकते हैं।

### पूर्ण उदाहरण — Linux होस्ट

`/etc/otelcol-contrib/config.yaml`:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

  filelog/syslog:
    include:
      - /var/log/syslog
      - /var/log/messages
      - /var/log/auth.log
    start_at: end

  journald:
    directory: /var/log/journal
    priority: info

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: linux-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog/syslog, journald]
      processors: [resource, batch]
      exporters: [otlphttp]
```

### पूर्ण उदाहरण — macOS होस्ट

`/etc/otelcol-contrib/config.yaml`:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

  filelog/system:
    include:
      - /var/log/install.log
      - /var/log/wifi.log
    start_at: end

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: macos-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resource, batch]
      exporters: [otlphttp]
    logs:
      receivers: [filelog/system]
      processors: [resource, batch]
      exporters: [otlphttp]
```

### पूर्ण उदाहरण — Windows होस्ट

`C:\Program Files\otelcol-contrib\config.yaml`:

```yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      # On Windows the 'load' scraper only emulates an average from the
      # Processor Queue Length counter (it starts at 0) — omitted here.
      paging:
      processes:

  windowseventlog/system:
    channel: System
    start_at: end

  windowseventlog/application:
    channel: Application
    start_at: end

  windowseventlog/security:
    channel: Security
    start_at: end

  # Powers the Services tab (otelcol-contrib v0.155.0+).
  windows_service:
    collection_interval: 30s

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: windows-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics, windows_service]
      processors: [resource, batch]
      exporters: [otlphttp]
    logs:
      receivers:
        - windowseventlog/system
        - windowseventlog/application
        - windowseventlog/security
      processors: [resource, batch]
      exporters: [otlphttp]
```

## चरण 3 — collector को एक सेवा के रूप में चलाएँ

### Linux (systemd)

Debian / RPM पैकेज पहले से ही एक systemd यूनिट इंस्टॉल करते हैं। बस इसे सक्षम करें और शुरू करें:

```bash
sudo systemctl enable --now otelcol-contrib
sudo systemctl status otelcol-contrib
```

collector के अपने logs का अनुसरण करने के लिए:

```bash
sudo journalctl -u otelcol-contrib -f
```

### macOS (launchd)

`/Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist` बनाएँ:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.oneuptime.otelcol-contrib</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/otelcol-contrib</string>
    <string>--config=/etc/otelcol-contrib/config.yaml</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/var/log/otelcol-contrib.out.log</string>
  <key>StandardErrorPath</key><string>/var/log/otelcol-contrib.err.log</string>
</dict>
</plist>
```

इसे लोड करें:

```bash
sudo launchctl load -w /Library/LaunchDaemons/com.oneuptime.otelcol-contrib.plist
sudo launchctl list | grep otelcol-contrib
```

### Windows (Services)

एक **elevated** PowerShell प्रॉम्प्ट से:

```powershell
sc.exe create "otelcol-contrib" `
  binPath= "\"C:\Program Files\otelcol-contrib\otelcol-contrib.exe\" --config=\"C:\Program Files\otelcol-contrib\config.yaml\"" `
  start= auto `
  DisplayName= "OpenTelemetry Collector (OneUptime)"

sc.exe description "otelcol-contrib" "Collects host telemetry and forwards it to OneUptime over OTLP."

sc.exe start "otelcol-contrib"
sc.exe query "otelcol-contrib"
```

सेवा डिफ़ॉल्ट रूप से `LocalSystem` के अंतर्गत चलती है, जिसके पास `Security` Windows Event Log चैनल को पढ़ने के लिए आवश्यक विशेषाधिकार हैं।

## चरण 4 — OneUptime में सत्यापित करें

1. होस्ट पर कुछ सिग्नल उत्पन्न करें:
   - **Linux / macOS:** `logger "hello from oneuptime"` (syslog / journald में लिखता है)।
   - **Windows:** एक elevated प्रॉम्प्ट से `eventcreate /T INFORMATION /ID 999 /L APPLICATION /SO OneUptimeTest /D "hello from oneuptime"`।
2. OneUptime डैशबोर्ड में, **Telemetry → Services** खोलें और आपके द्वारा कॉन्फ़िगर किया गया `service.name` चुनें।
3. **Metrics** खोलें — होस्ट मेट्रिक्स (CPU, memory, filesystem, आदि) एक मिनट के भीतर दिखाई देने चाहिए।
4. **Logs** खोलें — आपके फ़ाइल logs / journald प्रविष्टियाँ / Windows Event Logs स्ट्रीमिंग होनी चाहिए। उपयोगी खोजने योग्य विशेषताओं में `log.file.name`, `systemd.unit`, `winlog.channel`, `winlog.event_id`, और `winlog.provider.name` शामिल हैं।

## एकत्र किए गए डेटा की मात्रा कम करना

चूँकि collector कॉन्फ़िग आपके पास है, आप ठीक-ठीक तय करते हैं कि होस्ट से क्या बाहर जाता है — कुछ भी एकत्र नहीं किया जाता जब तक कि आपके द्वारा जोड़ा गया कोई receiver उसकी माँग न करे। यदि कोई होस्ट आपकी इच्छा से अधिक भेज रहा है (जो अधिक ingest मात्रा के रूप में, और OneUptime Cloud पर, अधिक लागत के रूप में दिखाई देता है), तो इसे यहाँ ट्यून करें। दो सबसे बड़े लीवर हैं **आप किन log स्रोतों को tail करते हैं** और **आप कितनी बार मेट्रिक्स scrape करते हैं**; बाकी को एक `filter` processor संभालता है।

सिद्धांत कॉन्फ़िग की तरह ही है: **केवल वे receivers जोड़ें जिनके डेटा को आप देखेंगे**, फिर उनके भीतर छँटाई करें। नीचे दिया गया प्रत्येक परिवर्तन `config.yaml` में एक संपादन है — इसे लागू करें और collector को पुनरारंभ करें (चरण 3)।

### मात्रा कहाँ से आती है

| सिग्नल                  | सबसे बड़ा चालक                                            | इसे कम करने का उपाय                                                           |
| ----------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Logs**                | हर फ़ाइल / journald unit / चैनल से हर लाइन                | receivers को संकीर्ण करें; `query:` फ़िल्टर; गंभीरता पर एक `filter` processor |
| **होस्ट मेट्रिक्स**     | Scrape आवृत्ति × series की संख्या                         | `collection_interval`; `process` scraper को छोड़ें; scraper चयन               |
| **मेट्रिक cardinality** | प्रति-प्रक्रिया मेट्रिक्स (प्रति प्रक्रिया एक series सेट) | `process` scraper को छोड़ें या स्कोप करें                                     |

### लीवर 1 — केवल उन log स्रोतों को tail करें जिनकी आपको आवश्यकता है

Logs लगभग हमेशा सबसे बड़ा हिस्सा होते हैं। collector केवल वही पढ़ता है जो आप सूचीबद्ध करते हैं, इसलिए समाधान कम सूचीबद्ध करना है:

- **फ़ाइलें** — `filelog` को विशिष्ट पथों पर इंगित करें, व्यापक globs पर नहीं। `/var/log/**` के बजाय `/var/log/myapp/error.log`।
- **journald** — `units:` को उन सेवाओं तक सीमित करें जिनकी आप परवाह करते हैं और `priority:` बढ़ाएँ ताकि आप स्रोत पर बातूनी `info`/`debug` प्रविष्टियों को छोड़ दें:

  ```yaml
  receivers:
    journald:
      directory: /var/log/journal
      units:
        - ssh.service
        - nginx.service
      priority: warning # info and debug are dropped before export
  ```

- **Windows Event Logs** — `Security` चैनल अब तक सबसे अधिक-मात्रा वाला है। इसे उन event IDs तक संकीर्ण करें जिनका आप वास्तव में ऑडिट करते हैं, एक `query:` के साथ (जैसा ऊपर [Windows Event Logs](#windows-event-logs) में दिखाया गया है), या यदि आपको इसकी आवश्यकता नहीं है तो चैनल को पूरी तरह से छोड़ दें।

### लीवर 2 — मेट्रिक्स अंतराल को धीमा करें

`hostmetrics` मात्रा सीधे `collection_interval` के साथ स्केल करती है। यदि आपको 30-सेकंड के रिज़ॉल्यूशन की आवश्यकता नहीं है, तो 60s डेटा बिंदुओं की संख्या को आधा कर देता है:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
```

### लीवर 3 — प्रति-प्रक्रिया scraper को छोड़ें (cardinality चालक)

`process` scraper होस्ट पर **चल रही हर प्रक्रिया के लिए** series का एक अलग सेट उत्सर्जित करता है — एक व्यस्त मशीन पर यह मेट्रिक cardinality का एकमात्र सबसे बड़ा स्रोत है। जब तक आपको प्रति-प्रक्रिया CPU/memory की आवश्यकता न हो, इसे `scrapers:` सूची से बाहर छोड़ दें। `processes` को रखें (जो केवल कुछ समग्र प्रक्रिया-गणना मेट्रिक्स हैं) — यह सस्ता है। यदि आप प्रति-प्रक्रिया मेट्रिक्स चाहते हैं, तो उन्हें उन प्रक्रियाओं तक स्कोप करें जो मायने रखती हैं:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes: # aggregate counts only — cheap
      # 'process:' (per-process series) intentionally omitted.
      # If you need it, scope it instead of collecting every process:
      # process:
      #   mute_process_name_error: true
      #   include:
      #     names: [nginx, postgres, node]
      #     match_type: strict
```

### लीवर 4 — एक `filter` processor के साथ कम-मूल्य वाले रिकॉर्ड छोड़ें

जब आप receiver चाहते हैं लेकिन उसके सभी आउटपुट नहीं, तो एक [`filter`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/filterprocessor) processor जोड़ें — यह एक [OTTL](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/ottl/README.md) स्थिति का मूल्यांकन करता है और **किसी भी मेल खाते रिकॉर्ड को छोड़ देता है**, इससे पहले कि कुछ भी निर्यात हो।

गंभीरता सीमा से नीचे के logs छोड़ें:

```yaml
processors:
  filter/drop-low-severity:
    error_mode: ignore
    logs:
      log_record:
        # Drop anything less severe than WARN (info, debug, trace).
        # The UNSPECIFIED guard is required — see the warning below.
        - "severity_number != SEVERITY_NUMBER_UNSPECIFIED and severity_number < SEVERITY_NUMBER_WARN"
```

> **`UNSPECIFIED` गार्ड को न हटाएँ।** `SEVERITY_NUMBER_UNSPECIFIED` `0` है और `SEVERITY_NUMBER_WARN` `13` है, इसलिए एक नंगा `severity_number < SEVERITY_NUMBER_WARN` `0 < 13` है — **हर उस रिकॉर्ड के लिए सत्य जिसकी गंभीरता कभी पार्स ही नहीं की गई**। एक सादा `filelog` receiver log line से गंभीरता पार्स नहीं करता: इस पृष्ठ के किसी भी `filelog` उदाहरण में `operators:` सेट नहीं है, इसलिए वे रिकॉर्ड फ़िल्टर पर `severity_number: 0` के साथ पहुँचते हैं। गार्ड के बिना, वह स्थिति चुपचाप `/var/log/syslog`, `/var/log/messages`, और `/var/log/auth.log` का **100% हटा देती है** — कहीं भी कोई त्रुटि नहीं। गार्ड के साथ, अवर्गीकृत रिकॉर्ड रखे जाते हैं और आप उन्हें OneUptime में गंभीरता `Unspecified` के रूप में आते हुए देखेंगे, जो आपको बताता है कि वास्तव में आपको एक severity parser की आवश्यकता है।

फ़ाइल logs को गंभीरता द्वारा *सही ढंग से* फ़िल्टर करने के लिए, पहले receiver पर एक [`severity_parser`](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/pkg/stanza/docs/operators/severity_parser.md) operator के साथ एक गंभीरता पार्स करें, ताकि रिकॉर्ड फ़िल्टर तक पहुँचने से पहले एक वास्तविक स्तर धारण करें:

```yaml
receivers:
  filelog/app:
    include:
      - /var/log/myapp/*.log
    start_at: end
    operators:
      # Pull a level out of lines like "2026-01-01 ERROR something broke".
      - type: regex_parser
        regex: '(?i)(?P<level>TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)'
        parse_from: body
        # Lines with no recognisable level fall through unparsed rather
        # than being discarded, and are then kept by the guard above.
        on_error: send
      - type: severity_parser
        parse_from: attributes.level
        preset: default
        mapping:
          warn: warning
          error: err
          fatal: panic
```

systemd होस्ट पर आपको इसमें से किसी की आवश्यकता नहीं है — `journald` का `priority:` (लीवर 1) स्वयं `journalctl` में स्तर द्वारा फ़िल्टर करता है, किसी OTel रिकॉर्ड के अस्तित्व में आने से पहले।

वे मेट्रिक्स छोड़ें जिन्हें आप चार्ट नहीं करते — सटीक नाम, या एक पैटर्न:

```yaml
processors:
  filter/drop-metrics:
    error_mode: ignore
    metrics:
      metric:
        # Exact metric name.
        - 'name == "system.paging.faults"'
        # Or a whole family. IsMatch is RE2 and UNANCHORED, so anchor it
        # yourself with ^ when you mean "starts with".
        - 'IsMatch(name, "^system\\.paging\\.")'
```

शर्त को उल्टा करके **केवल** मेट्रिक्स का एक निश्चित सेट भेजें (एक allowlist) — `filter` जो मेल खाता है उसे गिराता है, इसलिए `not (...)` उन सब कुछ को गिरा देता है जिन्हें आपने नाम नहीं दिया:

```yaml
processors:
  filter/allowlist:
    error_mode: ignore
    metrics:
      metric:
        - 'not (name == "system.cpu.utilization" or name == "system.memory.utilization" or name == "system.filesystem.utilization")'
```

उस शर्त को **एक ही line** पर रखें। एक allowlist एक बड़ा हथौड़ा है: जिसे भी आप नाम देना भूल जाते हैं वह चला जाता है, उस पर बने monitors के साथ। उन कुछ मेट्रिक्स को गिराना पसंद करें जिन्हें आप नहीं चाहते, या बस उस scraper को छोड़ दें जो उन्हें उत्पन्न करता है (लीवर 3) — कभी एकत्र न किए गए metric को फ़िल्टर करने की कोई लागत नहीं होती।

फिर processor को संबंधित pipeline में जोड़ें — क्रम मायने रखता है, इसलिए `filter` को `batch` से पहले रखें:

```yaml
service:
  pipelines:
    logs:
      receivers: [journald]
      processors: [filter/drop-low-severity, resource, batch]
      exporters: [otlphttp]
    metrics:
      receivers: [hostmetrics]
      processors: [filter/drop-metrics, resource, batch]
      exporters: [otlphttp]
```

> **OneUptime द्वारा आपके लिए उत्पन्न किए गए कॉन्फ़िग को संपादित कर रहे हैं?** ऊपर दी गई pipeline इस पृष्ठ के पूर्ण उदाहरणों से मेल खाती है। डैशबोर्ड से मिलने वाला कॉन्फ़िग (Hosts → Documentation) चीज़ों को अलग नाम देता है: उसके processors `resourcedetection` और `batch` हैं (वहाँ **कोई** `resource` processor नहीं है) और उसका exporter `otlphttp/oneuptime` है। ऐसे processor का संदर्भ देना जो परिभाषित नहीं है, collector को स्टार्टअप पर `references processor "resource" which is not configured` के साथ रोक देता है। इस ब्लॉक को उसके ऊपर चिपकाने के बजाय filter को उसमें जोड़ें जो पहले से मौजूद है:
>
> ```yaml
> service:
>   pipelines:
>     metrics:
>       receivers: [hostmetrics]
>       processors: [filter/drop-metrics, resourcedetection, batch]
>       exporters: [otlphttp/oneuptime]
> ```
>
> `resourcedetection` को रखें — OneUptime टेलीमेट्री को किसी होस्ट से उस `host.name` / `host.id` का उपयोग करके मिलाता है जिसे यह सेट करता है। वह उत्पन्न कॉन्फ़िग **केवल-मेट्रिक्स** भी है: जब तक आप एक न जोड़ें तब तक उसमें कोई `logs:` pipeline नहीं है, इसलिए जब तक आप उसके साथ एक `filelog` या `journald` receiver न जोड़ें तब तक `filter/drop-low-severity` के पास फ़िल्टर करने को कुछ नहीं है।

> **macOS पर, Homebrew नहीं, tarball का उपयोग करें।** Homebrew formula **core** collector शिप करता है, और `filter` एक contrib-केवल processor है — आपका YAML सही है या नहीं, इससे कोई फ़र्क नहीं पड़ता, collector शुरू होने से इनकार कर देगा।

### एक न्यूनतम प्रारंभिक बिंदु

एक **केवल-मेट्रिक्स** होस्ट — कोई logs नहीं, मोटा अंतराल, कोई प्रति-प्रक्रिया series नहीं — सबसे छोटा उपयोगी फ़ुटप्रिंट है:

```yaml
receivers:
  hostmetrics:
    collection_interval: 60s
    scrapers:
      cpu:
      memory:
      disk:
      filesystem:
      network:
      load:
      paging:
      processes:

processors:
  batch:
    send_batch_size: 512
    timeout: 5s
  resource:
    attributes:
      - key: service.name
        value: linux-host
        action: upsert

exporters:
  otlphttp:
    endpoint: https://oneuptime.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resource, batch]
      exporters: [otlphttp]
```

जब आपको इसकी आवश्यकता हो तो एक संकीर्ण-स्कोप वाले `filelog` या `journald` receiver के साथ एक `logs` pipeline वापस जोड़ें।

> **जो आप काटते हैं उस पर ध्यान दें।** Log-आधारित अलर्ट के लिए logs का आना आवश्यक है: यदि आप किसी गंभीरता या किसी चैनल को फ़िल्टर कर देते हैं, तो उस पर निर्भर monitors शांत हो जाते हैं। उन स्रोतों को छाँटें जिन पर आप कार्रवाई नहीं करते, न कि उन्हें जिन्हें कोई monitor देख रहा है। एक बार में एक लीवर बदलें और अगले पर जाने से पहले **Project Settings → Usage History** के अंतर्गत गिरावट की पुष्टि करें (उपयोग दैनिक रूप से एकत्रित होता है, इसलिए इसे एक या दो दिन दें)।

## स्व-होस्टेड OneUptime

यदि आप OneUptime को स्व-होस्ट कर रहे हैं, तो exporter को अपने स्वयं के होस्ट पर इंगित करें:

```yaml
exporters:
  otlphttp:
    endpoint: https://your-oneuptime-host.example.com/otlp
    headers:
      x-oneuptime-token: YOUR_TELEMETRY_INGESTION_TOKEN
```

यदि आपका इंस्टेंस केवल-HTTP है, तो स्कीम को `http://` में बदलें और उपयुक्त पोर्ट का उपयोग करें।

## एक proxy के पीछे

OpenTelemetry Collector मानक `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` एनवायरनमेंट वैरिएबल का सम्मान करता है। इन्हें सेवा पर सेट करें:

- **systemd (Linux):** `[Service]\nEnvironment="HTTPS_PROXY=http://proxy.example.com:3128"` के साथ `/etc/systemd/system/otelcol-contrib.service.d/proxy.conf` में ड्रॉप इन करें, फिर `sudo systemctl daemon-reload && sudo systemctl restart otelcol-contrib`।
- **launchd (macOS):** plist में एक `<EnvironmentVariables>` dict जोड़ें।
- **Windows service:** `sc.exe config` के माध्यम से या रजिस्ट्री में `HKLM\SYSTEM\CurrentControlSet\Services\otelcol-contrib\Environment` के अंतर्गत सेवा पर एनवायरनमेंट वैरिएबल सेट करें।

## समस्या निवारण

- **OneUptime में कोई टेलीमेट्री दिखाई नहीं देती**
  - वर्बोज़ आउटपुट के लिए कॉन्फ़िग में `service.telemetry.logs.level: debug` जोड़ें और collector को पुनरारंभ करें।
  - **Linux / macOS:** `journalctl -u otelcol-contrib -f` (Linux) या `tail -f /var/log/otelcol-contrib.err.log` (macOS)।
  - **Windows:** स्रोत `otelcol-contrib` के लिए _Event Viewer → Windows Logs → Application_ के अंतर्गत देखें।
  - पुष्टि करें कि होस्ट `https://oneuptime.com/otlp` (या आपका स्व-होस्टेड endpoint) तक पहुँच सकता है: उसी मशीन से `curl -v https://oneuptime.com/otlp`।
- **exporter से HTTP 401** — ingestion token अमान्य या निरस्त है। _Project Settings → Telemetry Ingestion Keys_ से एक नया बनाएँ।
- **`Security` Windows Event Log access denied लौटाता है** — सेवा पर्याप्त विशेषाधिकारों के साथ नहीं चल रही है। इसे `LocalSystem` के अंतर्गत फिर से बनाएँ (`sc.exe create` के साथ डिफ़ॉल्ट) या सेवा खाते को _Manage auditing and security log_ उपयोगकर्ता अधिकार प्रदान करें।
- **`journald` receiver शुरू होने में विफल रहता है** — सुनिश्चित करें कि `journalctl` collector के `PATH` पर है और कि `/var/log/journal` मौजूद है (यदि नहीं तो `sudo systemd-tmpfiles --create --prefix /var/log/journal` चलाएँ)।
- **उच्च मात्रा / लागत** — [एकत्र किए गए डेटा की मात्रा कम करना](#एकत्र-किए-गए-डेटा-की-मात्रा-कम-करना) देखें: receivers को संकीर्ण करें (विशिष्ट Windows चैनल, systemd units, log फ़ाइलें), मेट्रिक्स `collection_interval` बढ़ाएँ, प्रति-प्रक्रिया scraper को छोड़ें, या निर्यात से पहले कम-गंभीरता वाले रिकॉर्ड छोड़ने के लिए एक `filter` processor जोड़ें।

## अगले चरण

- विशिष्ट log पैटर्न पर अलर्ट करने के लिए **Logs Monitors** जोड़ें (उदाहरण के लिए, जब 5-मिनट की विंडो में 5 से अधिक `winlog.event_id = 4625` विफल लॉगऑन होते हैं तब अलर्ट करें)।
- होस्ट मेट्रिक्स पर **Metrics Monitors** जोड़ें (CPU संतृप्ति, कम डिस्क स्थान, swap उपयोग)।
- एंड-टू-एंड होस्ट दृश्यता के लिए इसे [Server / VM Monitor](/docs/monitor/server-monitor) और [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) के साथ संयोजित करें।
- Ansible / Chef / Puppet / Group Policy / Intune / अपने मौजूदा कॉन्फ़िगरेशन प्रबंधन टूलिंग के माध्यम से हर होस्ट को समान कॉन्फ़िगरेशन भेजें।
