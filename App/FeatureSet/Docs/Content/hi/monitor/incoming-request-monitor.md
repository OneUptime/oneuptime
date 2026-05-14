# Incoming Request Monitor

Incoming Request monitoring (जिसे heartbeat monitoring भी कहते हैं) आपको services को OneUptime पर periodic HTTP requests भेजकर monitor करने की अनुमति देता है। OneUptime आपकी service तक पहुंचने के बजाय, आपकी service OneUptime को ping करती है यह confirm करने के लिए कि वह चल रही है।

## Overview

Incoming Request monitors एक unique webhook URL प्रदान करते हैं जिसे आपकी services schedule पर call करती हैं। यह आपको सक्षम बनाता है:

- cron jobs और scheduled tasks monitor करें
- background workers चल रहे हैं यह सत्यापित करें
- firewall के पीछे ऐसी services monitor करें जिन्हें externally reach नहीं किया जा सकता
- third-party monitoring tools के साथ integrate करें
- किसी भी HTTP-capable system से heartbeat signals track करें

## Incoming Request Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **Incoming Request** चुनें
4. इस monitor के लिए एक **Secret Key** और heartbeat URL generate होगी
5. heartbeat URL पर requests भेजने के लिए अपनी service configure करें
6. आवश्यकतानुसार monitoring criteria configure करें

## Heartbeat URL

बनाने के बाद, आपके monitor में निम्नलिखित format में एक unique heartbeat URL होगी:

```
https://oneuptime.com/heartbeat/YOUR_SECRET_KEY
```

आपकी service को नियमित intervals पर इस URL पर HTTP **GET** या **POST** requests भेजनी चाहिए।

### Heartbeat भेजना

#### curl का उपयोग करके

```bash
# Simple GET request
curl https://oneuptime.com/heartbeat/YOUR_SECRET_KEY

# Custom body के साथ POST request
curl -X POST https://oneuptime.com/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'
```

#### cron job से

```bash
# हर 5 minutes में heartbeat भेजने के लिए crontab में जोड़ें
*/5 * * * * curl -s https://oneuptime.com/heartbeat/YOUR_SECRET_KEY > /dev/null
```

#### application code से

```javascript
// Node.js example
const https = require('https');
https.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY');
```

```python
# Python example
import requests
requests.get('https://oneuptime.com/heartbeat/YOUR_SECRET_KEY')
```

यदि self-hosted हैं तो `https://oneuptime.com` को अपने OneUptime instance URL से बदलें।

## Monitoring Criteria

आप criteria configure कर सकते हैं जो यह निर्धारित करे कि आपकी service निम्न के आधार पर online, degraded, या offline मानी जाए:

### उपलब्ध Check Types

| Check Type | विवरण |
|------------|-------|
| Incoming Request | एक time window के भीतर heartbeat received हुआ था या नहीं |
| Request Body | heartbeat के साथ भेजे गए request body का content |
| Request Header | एक specific request header का नाम |
| Request Header Value | एक specific request header का value |

### Filter Types

**Incoming Request** के लिए:

- **Received In Minutes** — निर्दिष्ट minutes की संख्या के भीतर heartbeat received हुआ था
- **Not Received In Minutes** — निर्दिष्ट minutes की संख्या के भीतर कोई heartbeat received नहीं हुआ

**Request Body**, **Request Header** और **Request Header Value** के लिए:

- **Contains** — Value निर्दिष्ट text contain करती है
- **Not Contains** — Value निर्दिष्ट text contain नहीं करती

### उदाहरण Criteria

#### 10 minutes में कोई heartbeat नहीं होने पर offline mark करें

- **Check On**: Incoming Request
- **Filter Type**: Not Received In Minutes
- **Value**: 10

#### request body content के आधार पर degraded mark करें

- **Check On**: Request Body
- **Filter Type**: Contains
- **Value**: `"status": "degraded"`

## सर्वोत्तम प्रथाएं

1. **time window उचित रूप से सेट करें** — यदि आपका cron job हर 5 minutes में चलता है, तो कभी-कभी delays के लिए "Not Received In Minutes" threshold को 10-15 minutes पर सेट करें
2. **meaningful data शामिल करें** — request body में status जानकारी भेजें ताकि आप granular criteria सेट अप कर सकें
3. **rich data के लिए POST उपयोग करें** — जब आपको विस्तृत status जानकारी भेजनी हो तो JSON bodies के साथ POST requests उपयोग करें
4. **monitor को monitor करें** — सुनिश्चित करें कि heartbeats भेजने वाली service में proper error handling है ताकि failed heartbeat requests अनदेखे न रहें
