# SSL Certificate Monitor

SSL Certificate monitoring आपको अपनी websites और services पर SSL/TLS certificates की validity और expiration monitor करने की अनुमति देता है। OneUptime समय-समय पर आपके certificates जांचता है और expire होने से पहले या कोई समस्या detect होने पर आपको alert करता है।

## Overview

SSL Certificate monitors आपके HTTPS endpoints से connect होते हैं और SSL/TLS certificate inspect करते हैं। यह आपको सक्षम बनाता है:

- certificate expiration dates monitor करें
- expired या soon-to-expire certificates detect करें
- self-signed certificates identify करें
- certificate validity सत्यापित करें
- expired certificates से होने वाले service outages रोकें

## SSL Certificate Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **SSL Certificate** चुनें
4. जांचने के लिए HTTPS endpoint का URL दर्ज करें
5. आवश्यकतानुसार monitoring criteria configure करें

## Configuration Options

### URL

वह HTTPS endpoint का full URL दर्ज करें जिसका SSL certificate आप monitor करना चाहते हैं (जैसे `https://example.com` या `https://example.com:8443`)।

## Monitoring Criteria

आप criteria configure कर सकते हैं जो यह निर्धारित करे कि आपकी certificate status निम्न के आधार पर online, degraded, या offline मानी जाए:

### उपलब्ध Check Types

| Check Type                 | विवरण                                                 |
| -------------------------- | ----------------------------------------------------- |
| Is Online                  | server reachable है या नहीं                           |
| Is Valid Certificate       | certificate valid है (expired नहीं, self-signed नहीं) |
| Is Self-Signed Certificate | certificate self-signed है या नहीं                    |
| Is Expired Certificate     | certificate expired हो गया है                         |
| Is Not A Valid Certificate | certificate invalid है                                |
| Expires In Hours           | certificate expire होने तक घंटों की संख्या            |
| Expires In Days            | certificate expire होने तक दिनों की संख्या            |
| Is Request Timeout         | connection timeout हुआ या नहीं                        |

### Filter Types

**Is Online**, **Is Valid Certificate**, **Is Self-Signed Certificate**, **Is Expired Certificate**, **Is Not A Valid Certificate** और **Is Request Timeout** के लिए:

- **True** — condition true है
- **False** — condition false है

**Expires In Hours** और **Expires In Days** के लिए:

- **Greater Than** — Expiry निर्दिष्ट value से अधिक दूर है
- **Less Than** — Expiry निर्दिष्ट value से कम दूर है
- **Greater Than or Equal To** — Expiry निर्दिष्ट value पर या उससे अधिक दूर है
- **Less Than or Equal To** — Expiry निर्दिष्ट value पर या उससे कम दूर है
- **Equal To** — Expiry बिल्कुल match करती है
- **Not Equal To** — Expiry match नहीं करती

### उदाहरण Criteria

#### 30 दिनों के भीतर certificate expire होने पर degraded mark करें

- **Check On**: Expires In Days
- **Filter Type**: Less Than
- **Value**: 30

#### Certificate expired होने पर offline mark करें

- **Check On**: Is Expired Certificate
- **Filter Type**: True

#### Certificate self-signed होने पर Alert करें

- **Check On**: Is Self-Signed Certificate
- **Filter Type**: True

#### Certificate invalid होने पर offline mark करें

- **Check On**: Is Not A Valid Certificate
- **Filter Type**: True

## सर्वोत्तम प्रथाएं

1. **Multiple thresholds सेट करें** — expiry से 30 दिन पहले degraded status और 7 दिन पहले offline उपयोग करें ताकि renewal का समय मिले
2. **सभी endpoints monitor करें** — यदि आपके पास कई domains या subdomains हैं, तो प्रत्येक के लिए एक monitor बनाएं
3. **Non-standard ports शामिल करें** — Non-standard ports पर HTTPS चलाने वाली services को मत भूलें
4. **Renewal के बाद monitor करें** — certificate renew करने के बाद, सत्यापित करें कि monitor confirm करता है कि यह valid है
