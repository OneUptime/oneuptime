# Incoming Email Monitor

Incoming Email Monitor आपको unique monitor-specific email addresses पर भेजे गए emails के आधार पर alerts बनाने और resolve करने की अनुमति देता है। यह legacy systems, third-party alerting tools, या किसी भी service के साथ integrate करने के लिए उपयोगी है जो email notifications भेज सकती है।

## यह कैसे काम करता है

1. जब आप Incoming Email Monitor बनाते हैं, तो OneUptime उस monitor के लिए एक unique email address generate करता है
2. उस address पर भेजा गया कोई भी email received होता है और आपके configured criteria के विरुद्ध evaluate होता है
3. criteria के आधार पर, OneUptime नए alerts बना सकता है या मौजूदा alerts resolve कर सकता है

यह email-based alerting systems को OneUptime के incident management workflow के साथ integrate करने का एक शक्तिशाली तरीका है।

## Incoming Email Monitor बनाना

1. अपने OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **Incoming Email** चुनें
4. monitor settings configure करें:
   - **Name:** आपके monitor के लिए एक वर्णनात्मक नाम
   - **Description:** यह monitor किस लिए है
5. अपनी **Alert Creation Criteria** सेट अप करें (alerts बनाने वाली conditions)
6. अपनी **Alert Resolution Criteria** सेट अप करें (alerts resolve करने वाली conditions)
7. **Create** पर क्लिक करें

Creation के बाद, आपको monitor details page पर इस monitor के लिए unique email address दिखाई देगा।

## Email Address Format

प्रत्येक Incoming Email Monitor को निम्नलिखित format में एक unique email address मिलता है:

```
monitor-{secret-key}@{inbound-domain}
```

उदाहरण के लिए: `monitor-abc123def456@inbound.yourdomain.com`

आप monitor details page से यह address copy कर सकते हैं और इसे emails भेजने के लिए अपने external systems configure कर सकते हैं।

## उपलब्ध Criteria Fields

आप निम्नलिखित email fields के आधार पर criteria बना सकते हैं:

| Field | विवरण |
|-------|-------|
| **Email Subject** | incoming email की subject line |
| **Email From** | sender का email address |
| **Email Body** | email body का plain text content |
| **Email To** | recipient email address |
| **Email Received** | emails receive होने के time के लिए Time-based criteria |

## उपलब्ध Filter Types

### String Filters (Subject, From, Body, To)

| Filter | विवरण | उदाहरण |
|--------|-------|--------|
| **Contains** | Field निर्दिष्ट text contain करती है | Subject contains "CRITICAL" |
| **Not Contains** | Field निर्दिष्ट text contain नहीं करती | Subject not contains "TEST" |
| **Equals** | Field निर्दिष्ट text से exactly match करती है | From equals "alerts@service.com" |
| **Not Equals** | Field निर्दिष्ट text से match नहीं करती | Subject not equals "OK" |
| **Starts With** | Field निर्दिष्ट text से शुरू होती है | Subject starts with "[ALERT]" |
| **Ends With** | Field निर्दिष्ट text पर खत्म होती है | Subject ends with "- Production" |
| **Is Empty** | Field empty या blank है | Body is empty |
| **Is Not Empty** | Field में content है | Subject is not empty |

### Time-Based Filters (Email Received)

| Filter | विवरण | उदाहरण |
|--------|-------|--------|
| **Received In Minutes** | Email X minutes के भीतर received हुआ था | Email received in 30 minutes |
| **Not Received In Minutes** | X minutes में कोई email received नहीं हुआ | Email not received in 60 minutes |

## उदाहरण Configurations

### उदाहरण 1: Critical Emails पर Alert बनाएं

**Alert Creation Criteria:**
- Email Subject **Contains** "CRITICAL"
- OR Email Subject **Contains** "ALERT"
- OR Email Subject **Contains** "ERROR"

**Alert Resolution Criteria:**
- Email Subject **Contains** "RESOLVED"
- OR Email Subject **Contains** "OK"
- OR Email Subject **Contains** "RECOVERED"

### उदाहरण 2: Specific Sender Monitor करें

**Alert Creation Criteria:**
- Email From **Equals** "monitoring@legacy-system.com"
- AND Email Subject **Contains** "Failed"

**Alert Resolution Criteria:**
- Email From **Equals** "monitoring@legacy-system.com"
- AND Email Subject **Contains** "Success"

### उदाहरण 3: Heartbeat Monitor (No Email = Alert)

**Alert Creation Criteria:**
- Email Received **Not Received In Minutes** with value `60`

यह alert बनाता है यदि 60 minutes के लिए कोई email received नहीं हुआ - scheduled jobs या batch processes के लिए उपयोगी है जो completion emails भेजनी चाहिए।

**Alert Resolution Criteria:**
- Email Received **Received In Minutes** with value `5`

यह alert resolve करता है जब कोई email received होता है।

## Use Cases

### Legacy System Integration

कई पुराने systems केवल email-based alerting का समर्थन करते हैं। Incoming Email Monitor का उपयोग करें:
- email alerts को OneUptime incidents में convert करें
- recovery emails arrive होने पर incidents automatically resolve करें
- कई legacy systems से alerting centralize करें

### Third-Party Service Monitoring

email notifications भेजने वाली services के साथ integrate करें:
- Cloud provider alerts (AWS, GCP, Azure)
- Security scanning tools
- Backup completion notifications
- SSL certificate expiration warnings

### Scheduled Job Monitoring

batch jobs और scheduled tasks monitor करें:
- यदि completion emails समय पर receive नहीं होते तो alerts बनाएं
- error notification emails के माध्यम से job failures track करें
- data pipeline completions monitor करें

## Template Variables

incident templates configure करते समय, आप incoming emails से इन variables का उपयोग कर सकते हैं:

| Variable | विवरण |
|----------|-------|
| `{{emailSubject}}` | received email का subject |
| `{{emailFrom}}` | sender का email address |
| `{{emailTo}}` | recipient email address |
| `{{emailBody}}` | email का plain text body |
| `{{emailReceivedAt}}` | email कब received हुआ |

## Self-Hosted Setup

यदि आप OneUptime self-host कर रहे हैं, तो आपको एक inbound email provider configure करना होगा। वर्तमान में supported:

- **SendGrid Inbound Parse** - Setup निर्देशों के लिए [SendGrid Inbound Email Integration](/docs/self-hosted/sendgrid-inbound-email) देखें

## ध्यान देने योग्य बातें

- **Email Address Security:** monitor email address में एक secret key है। इसे password की तरह treat करें और publicly share न करें।
- **Email Size:** बहुत large emails (large attachments के साथ) email provider द्वारा truncate या reject हो सकते हैं।
- **Processing Time:** Emails asynchronously process होते हैं। email भेजने और alert creation के बीच कुछ seconds की delay हो सकती है।
- **Case Insensitivity:** सभी string comparisons (Contains, Equals, आदि) case-insensitive हैं।
- **Plain Text:** Email body criteria email के plain text version उपयोग करती है। HTML formatting strip की जाती है।

## समस्या निवारण

### Emails नहीं मिल रहे

1. सत्यापित करें कि email address सही है (typos जांचें)
2. जांचें कि email spam filters द्वारा block तो नहीं हो रहा
3. सत्यापित करें कि आपका inbound email provider सही तरीके से configured है
4. किसी भी error messages के लिए OneUptime logs जांचें

### Alerts नहीं बन रहे

1. सत्यापित करें कि आपकी criteria email content से match करती है
2. जांचें कि monitor disabled तो नहीं है
3. monitor details में evaluation logs review करें
4. pattern matching उपयोग करने से पहले exact string matches से test करें

### Alerts Resolve नहीं हो रहे

1. सत्यापित करें कि आपकी resolution criteria recovery email से match करती है
2. सुनिश्चित करें कि resolve करने के लिए एक active alert है
3. जांचें कि resolution email उसी monitor address पर भेजा गया है
