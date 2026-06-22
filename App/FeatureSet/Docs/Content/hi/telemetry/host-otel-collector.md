# Host OpenTelemetry Collector (Linux, macOS, Windows)

## अवलोकन

आप होस्ट टेलीमेट्री को OTLP के माध्यम से OneUptime तक भेजने के लिए अपने Linux, macOS, या Windows होस्ट पर सीधे **OpenTelemetry Collector** को एक सेवा के रूप में चला सकते हैं। यह पृष्ठ collector को इंस्टॉल करने, इसे प्रत्येक OS के लिए कॉन्फ़िगर करने, और आप जो एकत्र करना चाहते हैं उसके लिए सही receivers चुनने के बारे में मार्गदर्शन करता है:

- हर OS पर **होस्ट मेट्रिक्स** (CPU, memory, disk, filesystem, network, load, processes)
- [`filelogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/filelogreceiver) के माध्यम से `/var/log/**` के अंतर्गत **फ़ाइल-आधारित logs** (Linux, macOS)
- [`journaldreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/journaldreceiver) के माध्यम से **systemd journal** (Linux)
- एक tailed `log stream` आउटपुट को लपेटते हुए [`logstransformprocessor`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/processor/logstransformprocessor) के माध्यम से **Apple Unified Log** (macOS)
- [`windowseventlogreceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowseventlogreceiver) के माध्यम से **Windows Event Logs**
- [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) के माध्यम से **Windows service status** (जो होस्ट **Services** टैब को शक्ति प्रदान करता है) — *अपस्ट्रीम पूर्व-निर्मित collector में नहीं है; पूर्व-निर्मित **OneUptime Host Collector** या एक कस्टम बिल्ड का उपयोग करें (नीचे "Windows Services (मेट्रिक्स)" देखें)*

> **OneUptime Infrastructure Agent के बारे में क्या?** वह agent एक अलग, हल्का Go daemon है जो बुनियादी मेट्रिक्स और *Server / VM Monitor* फ़ीचर (status, processes, alerting) पर केंद्रित है। यहाँ वर्णित OpenTelemetry Collector स्वतंत्र है और तब सही उपकरण है जब आप logs (फ़ाइल logs, journald, Windows Event Logs) या मानक OTLP के रूप में ग्रहण किए गए समृद्ध होस्ट मेट्रिक्स चाहते हैं। दोनों एक ही होस्ट पर बिना हस्तक्षेप किए चल सकते हैं।

## पूर्वापेक्षाएँ

- एक **OneUptime Telemetry Ingestion Token** — *Project Settings → Telemetry Ingestion Keys* से एक बनाएँ और `x-oneuptime-token` मान कॉपी करें।
- **OpenTelemetry Collector Contrib** वितरण (`otelcol-contrib`)। डिफ़ॉल्ट `otelcol` बिल्ड में `windowseventlogreceiver`, `journaldreceiver`, या `hostmetrics` अतिरिक्त जैसे receivers **शामिल नहीं** हैं — सुनिश्चित करें कि आप `contrib` वितरण का उपयोग करें। पहले से जानने योग्य एक अपवाद: alpha `windowsservicereceiver` (जो Windows **Services** टैब को शक्ति प्रदान करता है) अपस्ट्रीम पूर्व-निर्मित `contrib` बाइनरी में बंडल **नहीं** है — पूर्व-निर्मित **OneUptime Host Collector** (जिसमें यह शामिल है) का उपयोग करें या अपना स्वयं का बनाएँ; नीचे "Windows Services (मेट्रिक्स)" देखें।
- collector को एक सेवा के रूप में इंस्टॉल करने और (जहाँ लागू हो) विशेषाधिकार प्राप्त log स्रोतों को पढ़ने के लिए होस्ट पर Root / Administrator।

## चरण 1 — OpenTelemetry Collector इंस्टॉल करें

अपने OS के लिए अनुभाग चुनें। सभी उदाहरण मानते हैं कि आप [opentelemetry-collector-releases](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) से नवीनतम `otelcol-contrib` रिलीज़ इंस्टॉल कर रहे हैं।

### Linux (Debian / Ubuntu)

```bash
ARCH=$(dpkg --print-architecture)   # amd64 or arm64
VERSION=0.154.0                      # pick the latest release tag

curl -L -o otelcol-contrib.deb \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.deb"

sudo dpkg -i otelcol-contrib.deb
```

Debian पैकेज बाइनरी को `/usr/bin/otelcol-contrib` पर, डिफ़ॉल्ट कॉन्फ़िग को `/etc/otelcol-contrib/config.yaml` पर, और एक systemd यूनिट को `/etc/systemd/system/otelcol-contrib.service` पर इंस्टॉल करता है।

### Linux (RHEL / CentOS / Fedora / Amazon Linux)

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
VERSION=0.154.0

sudo rpm -ivh \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_linux_${ARCH}.rpm"
```

पथ Debian पैकेज से मेल खाते हैं (`/usr/bin/otelcol-contrib`, `/etc/otelcol-contrib/config.yaml`, systemd यूनिट `otelcol-contrib`)।

### macOS

```bash
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/arm64/arm64/')
VERSION=0.154.0

curl -L -o otelcol-contrib.tar.gz \
  "https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${VERSION}/otelcol-contrib_${VERSION}_darwin_${ARCH}.tar.gz"

sudo mkdir -p /usr/local/otelcol-contrib
sudo tar -xzf otelcol-contrib.tar.gz -C /usr/local/otelcol-contrib
sudo ln -sf /usr/local/otelcol-contrib/otelcol-contrib /usr/local/bin/otelcol-contrib
sudo mkdir -p /etc/otelcol-contrib
```

आप चरण 2 में `/etc/otelcol-contrib/config.yaml` और चरण 3 में एक `launchd` plist बनाएँगे।

### Windows

[releases page](https://github.com/open-telemetry/opentelemetry-collector-releases/releases) से नवीनतम `otelcol-contrib_*_windows_amd64.zip` (या `arm64`) डाउनलोड करें। एक **elevated** PowerShell प्रॉम्प्ट से:

```powershell
$dest = "C:\Program Files\otelcol-contrib"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Path "$env:USERPROFILE\Downloads\otelcol-contrib_*_windows_amd64.zip" -DestinationPath $dest
```

आप चरण 2 में `C:\Program Files\otelcol-contrib\config.yaml` बनाएँगे और चरण 3 में एक Windows सेवा पंजीकृत करेंगे।

## चरण 2 — collector कॉन्फ़िगर करें

कॉन्फ़िगरेशन फ़ाइल यहाँ रहती है:

| OS | पथ |
|---|---|
| Linux | `/etc/otelcol-contrib/config.yaml` |
| macOS | `/etc/otelcol-contrib/config.yaml` |
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
          layout: '%Y-%m-%d %H:%M:%S.%f%j'
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

किसी कस्टम या एप्लिकेशन-विशिष्ट चैनल को पढ़ने के लिए (कुछ भी जो आप *Event Viewer → Applications and Services Logs* के अंतर्गत देख सकते हैं), इसके सटीक प्रदर्शन नाम का उपयोग करें:

```yaml
  windowseventlog/iis:
    channel: Microsoft-IIS-Logging/Logs
    start_at: end
```

### Windows Services (मेट्रिक्स)

होस्ट **Services** टैब को [`windowsservicereceiver`](https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/receiver/windowsservicereceiver) (कॉन्फ़िग प्रकार `windows_service`) द्वारा शक्ति प्रदान की जाती है, जो Windows सेवाओं की चालू स्थिति और स्टार्टअप प्रकार को मेट्रिक्स के रूप में रिपोर्ट करता है।

> **यह receiver अपस्ट्रीम पूर्व-निर्मित `otelcol-contrib` बाइनरी में शामिल _नहीं_ है।** हालाँकि इसका मेटाडेटा `contrib` वितरण घोषित करता है, इसे contrib रिलीज़ मेनिफ़ेस्ट में नहीं जोड़ा गया है, इसलिए चरण 1 में आपके द्वारा इंस्टॉल किए गए आधिकारिक पूर्व-निर्मित collector में यह मौजूद नहीं है। उस collector में `windows_service` जोड़ने पर वह स्टार्टअप पर `'receivers' unknown type: "windows_service"` के साथ विफल हो जाता है — और **कोई भी वर्शन अपग्रेड इसे ठीक नहीं करता**, क्योंकि यह किसी भी रिलीज़ किए गए `otelcol-contrib` बिल्ड में शिप नहीं होता। यह receiver **alpha** और **केवल-Windows** भी है।

इसमें शामिल collector प्राप्त करने के आपके पास दो तरीके हैं। यदि आपको प्रति-सेवा स्थिति की आवश्यकता नहीं है, तो आप इसे पूरी तरह से छोड़ सकते हैं — होस्ट मेट्रिक्स, Windows Event Logs, और बाकी सब कुछ मानक collector के साथ काम करता है।

#### विकल्प A — OneUptime Host Collector का उपयोग करें (अनुशंसित)

OneUptime एक पूर्व-निर्मित collector — **OneUptime Host Collector** — प्रकाशित करता है जिसमें पहले से ही `windows_service` शामिल है (साथ ही `hostmetrics`, `windowseventlog`, `filelog`, और OTLP exporter भी)। किसी Go टूलचेन या बिल्डिंग की आवश्यकता नहीं है।

1. [OneUptime releases page](https://github.com/OneUptime/oneuptime/releases) से Windows asset डाउनलोड करें — या तो `oneuptime-host-collector_windows_amd64.zip` (या `_arm64.zip`) या `oneuptime-host-collector-amd64.msi` इंस्टॉलर।
2. `C:\Program Files\OneUptimeHostCollector\` में अनज़िप करें (MSI इसे आपके लिए वहाँ इंस्टॉल करता है)। आर्काइव एक `config.yaml` के साथ आता है जो पहले से ही `windows_service` सक्षम करता है।
3. `config.yaml` संपादित करें और अपना `x-oneuptime-token` (और यदि आप स्व-होस्ट करते हैं तो endpoint) सेट करें।
4. एक **elevated** PowerShell प्रॉम्प्ट से इसे एक Windows सेवा के रूप में पंजीकृत करें और शुरू करें:

```powershell
sc.exe create "OneUptimeHostCollector" `
  binPath= "\"C:\Program Files\OneUptimeHostCollector\oneuptime-host-collector.exe\" --config=\"C:\Program Files\OneUptimeHostCollector\config.yaml\"" `
  start= auto `
  DisplayName= "OneUptime Host Collector"

sc.exe start "OneUptimeHostCollector"
```

यह `LocalSystem` के रूप में चलता है (`sc.exe` डिफ़ॉल्ट) ताकि यह हर सेवा पढ़ सके। मेट्रिक्स आने के बाद **Services** टैब स्वचालित रूप से पॉप्युलेट हो जाता है। यह Linux/macOS के लिए भी वही collector है (वे assets बस केवल-Windows receiver को छोड़ देते हैं)।

#### विकल्प B — `ocb` के साथ अपना स्वयं का बनाएँ

यदि आप अपना स्वयं का collector बनाना पसंद करते हैं (या पहले से ही एक कस्टम वितरण चलाते हैं), तो [OpenTelemetry Collector Builder (`ocb`)](https://github.com/open-telemetry/opentelemetry-collector/tree/main/cmd/builder) के साथ एक कंपाइल करें।

**1. `ocb` के साथ एक कस्टम collector बनाएँ।** `builder-config.yaml` बनाएँ (हर वर्शन को एक ही collector रिलीज़ पर रखें):

```yaml
dist:
  name: otelcol-oneuptime
  description: OpenTelemetry Collector with the Windows service receiver
  output_path: ./otelcol-oneuptime
  otelcol_version: 0.154.0

receivers:
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/receiver/hostmetricsreceiver v0.154.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/receiver/windowseventlogreceiver v0.154.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/receiver/windowsservicereceiver v0.154.0

processors:
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/processor/resourcedetectionprocessor v0.154.0
  - gomod: github.com/open-telemetry/opentelemetry-collector-contrib/processor/resourceprocessor v0.154.0
  - gomod: go.opentelemetry.io/collector/processor/batchprocessor v0.154.0

exporters:
  - gomod: go.opentelemetry.io/collector/exporter/otlphttpexporter v0.154.0
```

फिर इसे बनाएँ (Go की आवश्यकता है) — आउटपुट एक एकल `otelcol-oneuptime.exe` है जिसे आप `otelcol-contrib` के स्थान पर चलाते हैं:

```powershell
go install go.opentelemetry.io/collector/cmd/builder@v0.154.0
builder --config builder-config.yaml
```

**2. receiver सक्षम करें** अपने `config.yaml` में और इसे metrics pipeline में जोड़ें:

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

receiver प्रति सेवा एक `windows.service.status` gauge उत्सर्जित करता है — पूर्णांक Win32 सेवा स्थिति है (`4` = running, `1` = stopped) — `name` और `startup_mode` विशेषताओं के साथ। collector को `LocalSystem` के रूप में चलाएँ (`sc.exe create` के साथ डिफ़ॉल्ट) ताकि यह हर सेवा पढ़ सके; जिसे भी यह नहीं खोल सकता उसे छोड़ दिया जाता है। चूँकि receiver alpha है, प्रोडक्शन से पहले वर्शन को पिन करें और परीक्षण करें — ज्ञात समस्याओं में एक scrape त्रुटि शामिल है जो collector को क्रैश कर सकती है और एक सेवा पर `access denied` दूसरों को प्रभावित कर सकता है; यदि आप इनका सामना करते हैं तो `include_services` तक सीमित रखें।

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

  # Windows service status (the Services tab) needs the windows_service
  # receiver, which is NOT in the prebuilt collector — see
  # "Windows Services (metrics)" above to build a collector that includes it.

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
      receivers: [hostmetrics]
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
  DisplayName= "OpenTelemetry Collector"

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
  - **Windows:** स्रोत `otelcol-contrib` के लिए *Event Viewer → Windows Logs → Application* के अंतर्गत देखें।
  - पुष्टि करें कि होस्ट `https://oneuptime.com/otlp` (या आपका स्व-होस्टेड endpoint) तक पहुँच सकता है: उसी मशीन से `curl -v https://oneuptime.com/otlp`।
- **exporter से HTTP 401** — ingestion token अमान्य या निरस्त है। *Project Settings → Telemetry Ingestion Keys* से एक नया बनाएँ।
- **`Security` Windows Event Log access denied लौटाता है** — सेवा पर्याप्त विशेषाधिकारों के साथ नहीं चल रही है। इसे `LocalSystem` के अंतर्गत फिर से बनाएँ (`sc.exe create` के साथ डिफ़ॉल्ट) या सेवा खाते को *Manage auditing and security log* उपयोगकर्ता अधिकार प्रदान करें।
- **`journald` receiver शुरू होने में विफल रहता है** — सुनिश्चित करें कि `journalctl` collector के `PATH` पर है और कि `/var/log/journal` मौजूद है (यदि नहीं तो `sudo systemd-tmpfiles --create --prefix /var/log/journal` चलाएँ)।
- **उच्च मात्रा / लागत** — receivers को संकीर्ण करें (विशिष्ट Windows चैनल, विशिष्ट systemd units, विशिष्ट log फ़ाइलें), Windows Event Log receiver पर एक `query:` फ़िल्टर जोड़ें, या निर्यात से पहले कम-गंभीरता वाली घटनाओं को छोड़ने के लिए एक `filter` processor जोड़ें।

## अगले चरण

- विशिष्ट log पैटर्न पर अलर्ट करने के लिए **Logs Monitors** जोड़ें (उदाहरण के लिए, जब 5-मिनट की विंडो में 5 से अधिक `winlog.event_id = 4625` विफल लॉगऑन होते हैं तब अलर्ट करें)।
- होस्ट मेट्रिक्स पर **Metrics Monitors** जोड़ें (CPU संतृप्ति, कम डिस्क स्थान, swap उपयोग)।
- एंड-टू-एंड होस्ट दृश्यता के लिए इसे [Server / VM Monitor](/docs/monitor/server-monitor) और [OneUptime Infrastructure Agent](/docs/monitor/server-monitor) के साथ संयोजित करें।
- Ansible / Chef / Puppet / Group Policy / Intune / अपने मौजूदा कॉन्फ़िगरेशन प्रबंधन टूलिंग के माध्यम से हर होस्ट को समान कॉन्फ़िगरेशन भेजें।
