# IP Monitor

IP monitoring आपको किसी भी IPv4 या IPv6 address की availability और responsiveness monitor करने की अनुमति देता है। OneUptime समय-समय पर target IP address से connectivity test करता है और उसकी status report करता है।

## Overview

IP monitors सत्यापित करते हैं कि एक specific IP address reachable और responsive है। यह आपको सक्षम बनाता है:

- IPv4 और IPv6 address availability monitor करें
- response times और latency track करें
- network connectivity issues detect करें
- सत्यापित करें कि infrastructure endpoints reachable हैं

## IP Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **IP** चुनें
4. वह IP address दर्ज करें जिसे आप monitor करना चाहते हैं
5. आवश्यकतानुसार monitoring criteria configure करें

## Configuration Options

### IP Address

वह IPv4 या IPv6 address दर्ज करें जिसे आप monitor करना चाहते हैं (जैसे `192.168.1.1` या `2001:db8::1`)। value एक valid IP address format होना चाहिए।

## Monitoring Criteria

आप criteria configure कर सकते हैं जो यह निर्धारित करे कि आपका IP address निम्न के आधार पर online, degraded, या offline माना जाए:

### उपलब्ध Check Types

| Check Type | विवरण |
|------------|-------|
| Is Online | IP address reachable है या नहीं |
| Response Time (in ms) | milliseconds में Response time |
| Is Request Timeout | request timeout हुआ या नहीं |

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

#### IP unreachable होने पर offline mark करें

- **Check On**: Is Online
- **Filter Type**: False

#### Latency 100ms से अधिक होने पर Alert करें

- **Check On**: Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 100
