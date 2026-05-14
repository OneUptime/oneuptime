# Domain Monitor

Domain monitoring आपको अपने domain names की registration status और expiration monitor करने की अनुमति देता है। OneUptime समय-समय पर WHOIS lookups करता है ताकि आपके domain की health track कर सके और expiry से पहले आपको alert करे।

## Overview

Domain monitors आपके domains के लिए WHOIS data query करते हैं और registration details track करते हैं। यह आपको सक्षम बनाता है:

- domain expiration dates monitor करें
- expired या soon-to-expire domains detect करें
- domain registrar जानकारी track करें
- nameserver configuration सत्यापित करें
- domain status codes monitor करें

## Domain Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **Domain** चुनें
4. वह domain name दर्ज करें जिसे आप monitor करना चाहते हैं
5. आवश्यकतानुसार monitoring criteria configure करें

## Configuration Options

### Basic Settings

| Field | विवरण | आवश्यक |
|-------|-------|--------|
| Domain Name | monitor करने के लिए domain (जैसे `example.com`) | हाँ |

### Advanced Settings

| Field | विवरण | Default |
|-------|-------|---------|
| Timeout (ms) | WHOIS response के लिए कितना इंतज़ार करें | 10000 |
| Retries | failure पर retry attempts की संख्या | 3 |

## Monitoring Criteria

आप criteria configure कर सकते हैं जो यह निर्धारित करे कि आपका domain निम्न के आधार पर online, degraded, या offline माना जाए:

### उपलब्ध Check Types

| Check Type | विवरण |
|------------|-------|
| Domain Expires In Days | domain registration expire होने तक दिनों की संख्या |
| Domain Registrar | domain registrar का नाम |
| Domain Name Server | domain के लिए Nameserver hostnames |
| Domain Status Code | WHOIS domain status codes |
| Domain Is Expired | domain expired हुआ है या नहीं |

### Filter Types

**Domain Is Expired** के लिए:

- **True** — Domain expired हो गया है
- **False** — Domain expired नहीं हुआ है

**Domain Expires In Days** के लिए:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

**Domain Registrar**, **Domain Name Server** और **Domain Status Code** के लिए:

- **Contains** — Value निर्दिष्ट text contain करती है
- **Not Contains** — Value निर्दिष्ट text contain नहीं करती
- **Starts With** — Value निर्दिष्ट text से शुरू होती है
- **Ends With** — Value निर्दिष्ट text पर खत्म होती है
- **Equal To** — Value बिल्कुल match करती है
- **Not Equal To** — Value match नहीं करती

### उदाहरण Criteria

#### 30 दिनों के भीतर domain expire होने पर Alert करें

- **Check On**: Domain Expires In Days
- **Filter Type**: Less Than
- **Value**: 30

#### Domain expired होने पर offline mark करें

- **Check On**: Domain Is Expired
- **Filter Type**: True

#### सत्यापित करें कि nameservers सही हैं

- **Check On**: Domain Name Server
- **Filter Type**: Contains
- **Value**: `ns1.example.com`

## सर्वोत्तम प्रथाएं

1. **early warnings सेट करें** — expiry से 60 दिन पहले degraded alerts और 14 दिन पहले offline alerts configure करें
2. **सभी critical domains monitor करें** — primary domains, अलग से registered subdomains और email या APIs के लिए उपयोग किए जाने वाले कोई भी domains शामिल करें
3. **registrar changes track करें** — unauthorized domain transfers detect करने के लिए registrar field monitor करें
