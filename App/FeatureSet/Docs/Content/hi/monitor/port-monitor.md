# Port Monitor

Port monitoring आपको किसी host पर specific TCP या UDP ports की availability monitor करने की अनुमति देता है। OneUptime समय-समय पर specified port से connect करने की कोशिश करता है और जांचता है कि यह open और responsive है या नहीं।

## Overview

Port monitors test करते हैं कि एक specific network port connections accept कर रहा है या नहीं। यह आपको सक्षम बनाता है:

- specific ports पर service availability monitor करें
- port response times track करें
- सत्यापित करें कि databases, mail servers और application servers जैसी services चल रही हैं
- service outages को users को प्रभावित करने से पहले detect करें

## Port Monitor बनाना

1. OneUptime Dashboard में **मॉनिटर** पर जाएं
2. **मॉनिटर बनाएं** पर क्लिक करें
3. monitor type के रूप में **पोर्ट** चुनें
4. hostname या IP address और port number दर्ज करें
5. आवश्यकतानुसार monitoring criteria configure करें

## Configuration Options

### Hostname या IP Address

target host का hostname या IP address दर्ज करें (जैसे `example.com` या `192.168.1.1`)।

### Port

monitor करने के लिए port number दर्ज करें (1–65535)। सामान्य उदाहरण:

| Port  | Service    |
| ----- | ---------- |
| 22    | SSH        |
| 25    | SMTP       |
| 80    | HTTP       |
| 443   | HTTPS      |
| 3306  | MySQL      |
| 5432  | PostgreSQL |
| 6379  | Redis      |
| 27017 | MongoDB    |

## Monitoring Criteria

आप criteria configure कर सकते हैं जो यह निर्धारित करे कि आपका port निम्न के आधार पर online, degraded, या offline माना जाए:

### उपलब्ध Check Types

| Check Type            | विवरण                                                |
| --------------------- | ---------------------------------------------------- |
| Is Online             | port open है और connections accept कर रहा है या नहीं |
| Response Time (in ms) | milliseconds में connection establish करने का समय    |
| Is Request Timeout    | connection attempt timeout हुआ या नहीं               |

### Filter Types

**Is Online** और **Is Request Timeout** के लिए:

- **True** — condition true है
- **False** — condition false है

**प्रतिक्रिया समय** के लिए:

- **Greater Than** — Response time एक threshold से अधिक है
- **Less Than** — Response time एक threshold से कम है
- **Greater Than or Equal To** — Response time एक threshold पर या उससे ऊपर है
- **Less Than or Equal To** — Response time एक threshold पर या उससे नीचे है

**Evaluate this criteria over a period of time** criteria form पर एक checkbox है, filter condition नहीं। इसे चालू करने पर नवीनतम check के value के बजाय **Evaluate** (Average, Sum, Maximum, Minimum, All Values, Any Value) में चुना गया aggregate उस window पर तुलना किया जाता है जो **For the last (in minutes)** में सेट है।

### उदाहरण Criteria

#### Port closed होने पर offline mark करें

- **Check On**: Is Online
- **फ़िल्टर प्रकार**: False

#### Connection time 500ms से अधिक होने पर Alert करें

- **Check On**: Response Time (in ms)
- **फ़िल्टर प्रकार**: Greater Than
- **मान**: 500

#### Connection slow होने पर degraded mark करें

- **Check On**: Response Time (in ms)
- **फ़िल्टर प्रकार**: Greater Than
- **मान**: 200
