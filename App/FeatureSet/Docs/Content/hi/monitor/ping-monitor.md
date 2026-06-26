# Ping Monitor

Ping monitoring आपको किसी भी host या IP address की availability और responsiveness monitor करने की अनुमति देता है। OneUptime समय-समय पर आपके target पर ping requests भेजता है और जांचता है कि यह सही तरीके से respond करता है या नहीं।

## Overview

Ping monitors किसी host पर ICMP ping requests भेजकर basic network connectivity test करते हैं। यह आपको सक्षम बनाता है:

- host uptime और availability monitor करें
- network latency और response times track करें
- connectivity issues को आपकी services को प्रभावित करने से पहले detect करें
- servers और network devices reachable हैं यह सत्यापित करें

## Ping Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **Ping** चुनें
4. वह hostname या IP address दर्ज करें जिसे आप monitor करना चाहते हैं
5. आवश्यकतानुसार monitoring criteria configure करें

## Configuration Options

### Ping Hostname या IP Address

वह target का hostname या IP address दर्ज करें जिसे आप monitor करना चाहते हैं (जैसे `example.com` या `192.168.1.1`)। Hostnames और IP addresses दोनों accepted हैं।

## Monitoring Criteria

आप criteria configure कर सकते हैं जो यह निर्धारित करे कि आपका host निम्न के आधार पर online, degraded, या offline माना जाए:

### उपलब्ध Check Types

| Check Type            | विवरण                                            |
| --------------------- | ------------------------------------------------ |
| Is Online             | host ping requests का response देता है या नहीं   |
| Response Time (in ms) | milliseconds में ping request का round-trip time |
| Is Request Timeout    | ping request timeout हुआ या नहीं                 |

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

#### Host unreachable होने पर offline mark करें

- **Check On**: Is Online
- **Filter Type**: False

#### Response time 200ms से अधिक होने पर Alert करें

- **Check On**: Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 200
