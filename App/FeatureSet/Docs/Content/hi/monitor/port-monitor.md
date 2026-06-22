# Port Monitor

Port monitoring आपको किसी host पर specific TCP या UDP ports की availability monitor करने की अनुमति देता है। OneUptime समय-समय पर specified port से connect करने की कोशिश करता है और जांचता है कि यह open और responsive है या नहीं।

## Overview

Port monitors test करते हैं कि एक specific network port connections accept कर रहा है या नहीं। यह आपको सक्षम बनाता है:

- specific ports पर service availability monitor करें
- port response times track करें
- सत्यापित करें कि databases, mail servers और application servers जैसी services चल रही हैं
- service outages को users को प्रभावित करने से पहले detect करें

## Port Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **Port** चुनें
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

**Response Time** के लिए:

- **Greater Than** — Response time एक threshold से अधिक है
- **Less Than** — Response time एक threshold से कम है
- **Greater Than or Equal To** — Response time एक threshold पर या उससे ऊपर है
- **Less Than or Equal To** — Response time एक threshold पर या उससे नीचे है
- **Equal To** — Response time बिल्कुल match करती है
- **Not Equal To** — Response time match नहीं करती
- **Evaluate Over Time** — एक time window पर aggregation (Average, Sum, Maximum, Minimum, All Values, Any Value) का उपयोग करके evaluate करें

### उदाहरण Criteria

#### Port closed होने पर offline mark करें

- **Check On**: Is Online
- **Filter Type**: False

#### Connection time 500ms से अधिक होने पर Alert करें

- **Check On**: Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 500

#### Connection slow होने पर degraded mark करें

- **Check On**: Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 200
