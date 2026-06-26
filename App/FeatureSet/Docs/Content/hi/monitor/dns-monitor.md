# DNS Monitor

DNS monitoring आपको अपने domains के लिए DNS resolution की health और सटीकता monitor करने की अनुमति देता है। OneUptime समय-समय पर DNS records query करता है और आपके configured criteria के विरुद्ध responses validate करता है।

## Overview

DNS monitors specific record types के लिए DNS servers query करते हैं और results का मूल्यांकन करते हैं। यह आपको सक्षम बनाता है:

- DNS service availability monitor करें
- सत्यापित करें कि DNS records सही values लौटा रहे हैं
- DNS resolution response times track करें
- DNSSEC configuration validate करें
- DNS propagation issues या hijacking का पता लगाएं

## DNS Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **DNS** चुनें
4. query करने के लिए domain name और record type दर्ज करें
5. आवश्यकतानुसार monitoring criteria configure करें

## Configuration Options

### Basic Settings

| Field       | विवरण                                                                                   | आवश्यक |
| ----------- | --------------------------------------------------------------------------------------- | ------ |
| Domain Name | query करने के लिए domain (जैसे `example.com`)                                           | हाँ    |
| Record Type | query करने के लिए DNS record type                                                       | हाँ    |
| DNS Server  | उपयोग करने के लिए Custom DNS server (जैसे `8.8.8.8`)। system default के लिए खाली छोड़ें | नहीं   |

### समर्थित Record Types

| Record Type | विवरण                                       |
| ----------- | ------------------------------------------- |
| A           | IPv4 address records                        |
| AAAA        | IPv6 address records                        |
| CNAME       | Canonical name (alias) records              |
| MX          | Mail exchange records                       |
| NS          | Nameserver records                          |
| TXT         | Text records (SPF, DKIM, आदि)               |
| SOA         | Start of Authority records                  |
| PTR         | Pointer records (reverse DNS)               |
| SRV         | Service locator records                     |
| CAA         | Certificate Authority Authorization records |

### Advanced Settings

| Field        | विवरण                               | Default |
| ------------ | ----------------------------------- | ------- |
| Port         | DNS port number                     | 53      |
| Timeout (ms) | response के लिए कितना इंतज़ार करें  | 5000    |
| Retries      | failure पर retry attempts की संख्या | 3       |

## Monitoring Criteria

आप criteria configure कर सकते हैं जो यह निर्धारित करे कि आपका DNS निम्न के आधार पर online, degraded, या offline माना जाए:

### उपलब्ध Check Types

| Check Type                | विवरण                                          |
| ------------------------- | ---------------------------------------------- |
| DNS Is Online             | DNS server queries का response देता है या नहीं |
| DNS Response Time (in ms) | milliseconds में query response time           |
| DNS Record Exists         | query के लिए DNS records मौजूद हैं या नहीं     |
| DNS Record Value          | DNS record द्वारा returned value               |
| DNSSEC Is Valid           | DNSSEC validation pass होती है या नहीं         |

### Filter Types

**DNS Is Online**, **DNS Record Exists** और **DNSSEC Is Valid** के लिए:

- **True** — condition true है
- **False** — condition false है

**DNS Response Time** के लिए:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

**DNS Record Value** के लिए:

- **Contains** — Record value निर्दिष्ट text contains करती है
- **Not Contains** — Record value निर्दिष्ट text contain नहीं करती
- **Starts With** — Record value निर्दिष्ट text से शुरू होती है
- **Ends With** — Record value निर्दिष्ट text पर खत्म होती है
- **Equal To** — Record value बिल्कुल match करती है
- **Not Equal To** — Record value match नहीं करती

### उदाहरण Criteria

#### जांचें कि DNS resolve हो रहा है

- **Check On**: DNS Is Online
- **Filter Type**: True

#### सत्यापित करें कि A record सही IP की ओर point करता है

- **Check On**: DNS Record Value
- **Filter Type**: Equal To
- **Value**: `93.184.216.34`

#### DNS response slow होने पर Alert करें

- **Check On**: DNS Response Time (in ms)
- **Filter Type**: Greater Than
- **Value**: 500

#### सत्यापित करें कि DNSSEC valid है

- **Check On**: DNSSEC Is Valid
- **Filter Type**: True
