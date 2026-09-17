# SendGrid Inbound Email Integration

OneUptime का **Incoming Email Monitor** आपको unique monitor-specific email addresses पर भेजे गए emails के आधार पर alerts बनाने और resolve करने की अनुमति देता है। यह legacy systems, alerting tools, या किसी भी service के साथ integrate करने के लिए उपयोगी है जो emails भेज सकती है।

यह guide आपको SendGrid Inbound Parse सेट अप करने का तरीका बताती है ताकि incoming emails आपके self-hosted OneUptime instance पर forward हों।

## पूर्व आवश्यकताएं

- Inbound Parse की पहुँच वाला SendGrid खाता
- एक domain जिस पर आपका नियंत्रण हो और DNS settings तक पहुंच
- एक सार्वजनिक HTTPS endpoint जो SendGrid webhooks को OneUptime तक पहुँचाए

## नेटवर्क पहुँच

Inbound Parse के लिए SendGrid को OneUptime की ओर connection शुरू करना होता है। केवल OneUptime से outbound internet access देना पर्याप्त नहीं है।

| दिशा | गंतव्य | Protocol / port | उद्देश्य |
| --- | --- | --- | --- |
| SendGrid → OneUptime | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` | HTTPS / TCP 443 | Parsed email को multipart POST के रूप में पहुँचाना। |
| Email भेजने वाले mail servers → SendGrid | प्राप्तकर्ता domain के public MX record से चुना गया `mx.sendgrid.net` | SMTP / TCP 25 | SendGrid पर email प्राप्त करना; यह connection OneUptime server पर नहीं जाता। |
| OneUptime → SendGrid, केवल email sending अलग से configure होने पर | `api.sendgrid.com` | HTTPS / TCP 443 | Mail Send API से notification emails भेजना। |

Webhook hostname का public DNS प्रकाशित करें और सार्वजनिक रूप से विश्वसनीय certificate इस्तेमाल करें। Private installation में केवल webhook path को ऐसे public reverse proxy या gateway से expose कर सकते हैं, जो OneUptime तक अंदरूनी पहुँच रखता हो। Path, secret, content type और multipart body सुरक्षित रखें; interactive login या browser challenge के बिना POST की अनुमति दें। OneUptime को inbound SMTP listener की जरूरत नहीं है। [SendGrid setup guide](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/setting-up-the-inbound-parse-webhook) देखें।

`INBOUND_EMAIL_WEBHOOK_SECRET` को मजबूत random value पर सेट करें और `YOUR_SECRET` को उसी से बदलें। अंतिम path segment जरूरी है। OneUptime उसकी configured secret से तुलना करता है; variable खाली छोड़ने पर यह जाँच बंद हो जाती है। पूरे URL और monitor email addresses को proxy logs में भी गोपनीय रखें। OneUptime अभी SendGrid के signed Inbound Parse headers या OAuth tokens validate नहीं करता। यदि ये जरूरी हैं, तो [SendGrid security documentation](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks) के अनुसार gateway पर validation करके ही आगे भेजें।

SendGrid, Inbound Parse source IPs की भरोसेमंद स्थिर सूची नहीं देता। Email sending IPs और `mx.sendgrid.net` के DNS से मिले addresses, webhook allowlist नहीं हैं। [SendGrid firewall guidance](https://support.sendgrid.com/hc/en-us/articles/44375457225371-How-to-Configure-Firewall-Settings-for-SendGrid-Webhook-and-Inbound-Parse-IPs) का पालन करें।

Inbound Parse और outgoing email अलग हैं। Monitor emails प्राप्त करने के लिए OneUptime को SendGrid API call नहीं करनी पड़ती। यदि SendGrid से notifications भी भेजते हैं, तो DNS और `api.sendgrid.com` तक outbound HTTPS की अनुमति दें; [Mail Send](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send) में email submit करने के लिए inbound callback आवश्यक नहीं है। SMTP इस्तेमाल करने पर OneUptime में configured server और port की अनुमति दें।

Public MX record जाँचें, test monitor को email भेजें, और पुष्टि करें कि webhook OneUptime तक पहुँचा तथा संबंधित alert बना या resolve हुआ। खाली POST या outbound email test की सफलता Inbound Parse के पूरे flow की पुष्टि नहीं करती।

## यह कैसे काम करता है

1. आप OneUptime में एक **Incoming Email Monitor** बनाते हैं
2. OneUptime उस monitor के लिए एक unique email address generate करता है (जैसे `monitor-abc123@inbound.yourdomain.com`)
3. जब उस address पर email भेजा जाता है, SendGrid उसे receive करता है और webhook के माध्यम से OneUptime पर forward करता है
4. OneUptime email को आपके configured criteria के विरुद्ध evaluate करता है ताकि alerts बनाए या resolve किए जा सकें

## Setup Instructions

### चरण 1: अपना Inbound Email Domain चुनें

आपको inbound emails receive करने के लिए एक dedicated subdomain की आवश्यकता होगी। हम ऐसा subdomain उपयोग करने की सलाह देते हैं जैसे:

- `inbound.yourdomain.com`
- `email.yourdomain.com`
- `monitor.yourdomain.com`

यह subdomain exclusively OneUptime monitor emails के लिए उपयोग किया जाएगा।

### चरण 2: DNS MX Record Configure करें

अपने DNS configuration में एक MX record जोड़ें ताकि आपके inbound subdomain के लिए emails SendGrid पर route हों।

| Type | Host/Name | Priority | Value           |
| ---- | --------- | -------- | --------------- |
| MX   | inbound   | 10       | mx.sendgrid.net |

**उदाहरण:** यदि आपका domain `example.com` है और आप `inbound.example.com` उपयोग कर रहे हैं:

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**नोट:** DNS changes propagate होने में 48 घंटे तक लग सकते हैं, लेकिन आमतौर पर कुछ घंटों में complete होती हैं।

### चरण 3: SendGrid में अपना Domain प्रमाणित करें

प्राप्तकर्ता domain आपके [SendGrid में प्रमाणित domains](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/inbound-parse) में से किसी एक का हिस्सा होना चाहिए:

1. अपने [SendGrid Dashboard](https://app.sendgrid.com) में login करें
2. **Settings** > **Sender Authentication** पर जाएं
3. **Authenticate Your Domain** पर क्लिक करें
4. आवश्यक DNS records (DKIM के लिए CNAME records) जोड़ने के लिए prompts follow करें

### चरण 4: SendGrid Inbound Parse Configure करें

1. अपने [SendGrid Dashboard](https://app.sendgrid.com) में login करें
2. **Settings** > **Inbound Parse** पर जाएं
3. **Add Host & URL** पर क्लिक करें
4. निम्नलिखित configure करें:

| Field                              | Value                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------- |
| **Receiving Domain**               | आपका inbound subdomain (जैसे `inbound.yourdomain.com`)                  |
| **Destination URL**                | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` |
| **Check incoming emails for spam** | वैकल्पिक - यदि चाहें तो सक्षम करें                                      |
| **Send raw, full MIME message**    | Unchecked छोड़ें (आवश्यक नहीं)                                          |

5. **Add** पर क्लिक करें

### चरण 5: OneUptime Environment Variables Configure करें

#### Docker Compose

इन environment variables को अपनी `config.env` फ़ाइल में जोड़ें:

```bash
# Inbound Email Configuration
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.yourdomain.com
INBOUND_EMAIL_WEBHOOK_SECRET=replace-with-a-strong-random-secret
```

#### Kubernetes with Helm

इन्हें अपनी `values.yaml` फ़ाइल में जोड़ें:

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  webhookSecret: "replace-with-a-strong-random-secret"
```

चरण 4 के Destination URL में भी यही secret इस्तेमाल करें और configuration बदलने के बाद OneUptime को restart करें।

### चरण 6: Incoming Email Monitor बनाएं

1. अपने OneUptime Dashboard में login करें
2. **मॉनिटर** > **मॉनिटर बनाएं** पर जाएं
3. monitor type के रूप में **Incoming Email** चुनें
4. अपना monitor configure करें
5. **Alert Creation Criteria** configure करें (alert कब बनाएं)
6. **Alert Resolution Criteria** configure करें (alert कब resolve करें)
7. **बनाएँ** पर क्लिक करें

Creation के बाद, आपको इस monitor के लिए unique email address दिखाई देगा।

### चरण 7: Integration Test करें

1. OneUptime Dashboard से monitor का email address copy करें
2. उस address पर एक test email भेजें जिसका subject आपकी alert criteria से match करता हो
3. OneUptime Dashboard जांचें:
   - Email received हुआ (Monitor Summary में दिखाई देना चाहिए)
   - Alert बना (यदि criteria match करती है)

## Environment Variables Reference

| Variable                       | विवरण                                                                                                                                       | आवश्यक | Default |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------- |
| `INBOUND_EMAIL_PROVIDER`       | उपयोग करने के लिए inbound email provider                                                                                                    | हाँ    | -       |
| `INBOUND_EMAIL_DOMAIN`         | inbound emails के लिए configured subdomain                                                                                                  | हाँ    | -       |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | `/incoming-email/sendgrid/YOUR_SECRET` के अंतिम path segment से तुलना की जाती है। सार्वजनिक endpoints के लिए सेट करें; खाली मान सत्यापन बंद कर देता है। | अनुशंसित | - |

## Troubleshooting

### Emails नहीं मिल रहे

1. **DNS propagation जांचें:**

   ```bash
   dig MX inbound.yourdomain.com
   ```

   `mx.sendgrid.net` return करना चाहिए

2. **SendGrid Inbound Parse settings सत्यापित करें:**
   - SendGrid Dashboard में login करें
   - Settings > Inbound Parse पर जाएं
   - अपने domain और webhook URL verify करें

### Webhooks Fail हो रहे हैं

- Secret सहित पूरा HTTPS URL इंटरनेट से उपलब्ध होना चाहिए। अंतिम path segment के बिना URL route से मेल नहीं खाता।
- Login redirects या browser challenges के बिना POST की अनुमति दें। SendGrid के email sending IP, webhook sources की allowlist नहीं हैं।
- सार्वजनिक रूप से विश्वसनीय certificate और उसकी पूरी chain इस्तेमाल करें। नेटवर्क पहुँच अनुभाग के अनुसार delivery जाँचें।

## Security Best Practices

1. **HTTPS उपयोग करें:** webhook endpoint के लिए हमेशा HTTPS उपयोग करें
2. **Webhook Secret:** Additional validation के लिए `INBOUND_EMAIL_WEBHOOK_SECRET` configure करें
3. **Domain Verification:** बेहतर email security के लिए SendGrid में अपना domain verify करें
4. **Access Restrict करें:** केवल trusted email sources के लिए monitors बनाएं
