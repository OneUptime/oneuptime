# SendGrid Inbound Email Integration

OneUptime का **Incoming Email Monitor** आपको unique monitor-specific email addresses पर भेजे गए emails के आधार पर alerts बनाने और resolve करने की अनुमति देता है। यह legacy systems, alerting tools, या किसी भी service के साथ integrate करने के लिए उपयोगी है जो emails भेज सकती है।

यह guide आपको SendGrid Inbound Parse सेट अप करने का तरीका बताती है ताकि incoming emails आपके self-hosted OneUptime instance पर forward हों।

## पूर्व आवश्यकताएं

- एक SendGrid account (free tier काम करती है)
- एक domain जिस पर आपका नियंत्रण हो और DNS settings तक पहुंच
- आपका OneUptime instance publicly accessible होना चाहिए (SendGrid को webhooks भेजने के लिए)

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

| Type | Host/Name | Priority | Value |
|------|-----------|----------|-------|
| MX | inbound | 10 | mx.sendgrid.net |

**उदाहरण:** यदि आपका domain `example.com` है और आप `inbound.example.com` उपयोग कर रहे हैं:

```
inbound.example.com.  IN  MX  10  mx.sendgrid.net.
```

**नोट:** DNS changes propagate होने में 48 घंटे तक लग सकते हैं, लेकिन आमतौर पर कुछ घंटों में complete होती हैं।

### चरण 3: SendGrid में Domain Verify करें (वैकल्पिक लेकिन अनुशंसित)

बेहतर deliverability के लिए:

1. अपने [SendGrid Dashboard](https://app.sendgrid.com) में login करें
2. **Settings** > **Sender Authentication** पर जाएं
3. **Authenticate Your Domain** पर क्लिक करें
4. आवश्यक DNS records (DKIM के लिए CNAME records) जोड़ने के लिए prompts follow करें

### चरण 4: SendGrid Inbound Parse Configure करें

1. अपने [SendGrid Dashboard](https://app.sendgrid.com) में login करें
2. **Settings** > **Inbound Parse** पर जाएं
3. **Add Host & URL** पर क्लिक करें
4. निम्नलिखित configure करें:

| Field | Value |
|-------|-------|
| **Receiving Domain** | आपका inbound subdomain (जैसे `inbound.yourdomain.com`) |
| **Destination URL** | `https://your-oneuptime-domain.com/incoming-email/sendgrid/YOUR_SECRET` |
| **Check incoming emails for spam** | वैकल्पिक - यदि चाहें तो सक्षम करें |
| **Send raw, full MIME message** | Unchecked छोड़ें (आवश्यक नहीं) |

5. **Add** पर क्लिक करें

### चरण 5: OneUptime Environment Variables Configure करें

#### Docker Compose

इन environment variables को अपनी `config.env` फ़ाइल में जोड़ें:

```bash
# Inbound Email Configuration
INBOUND_EMAIL_PROVIDER=SendGrid
INBOUND_EMAIL_DOMAIN=inbound.yourdomain.com
# INBOUND_EMAIL_WEBHOOK_SECRET=your-optional-secret  # वैकल्पिक: additional security के लिए
```

#### Kubernetes with Helm

इन्हें अपनी `values.yaml` फ़ाइल में जोड़ें:

```yaml
inboundEmail:
  provider: "SendGrid"
  domain: "inbound.yourdomain.com"
  # webhookSecret: "your-optional-secret"  # वैकल्पिक
```

**महत्वपूर्ण:** इन environment variables को add करने के बाद अपना OneUptime server restart करें।

### चरण 6: Incoming Email Monitor बनाएं

1. अपने OneUptime Dashboard में login करें
2. **Monitors** > **Create Monitor** पर जाएं
3. monitor type के रूप में **Incoming Email** चुनें
4. अपना monitor configure करें
5. **Alert Creation Criteria** configure करें (alert कब बनाएं)
6. **Alert Resolution Criteria** configure करें (alert कब resolve करें)
7. **Create** पर क्लिक करें

Creation के बाद, आपको इस monitor के लिए unique email address दिखाई देगा।

### चरण 7: Integration Test करें

1. OneUptime Dashboard से monitor का email address copy करें
2. उस address पर एक test email भेजें जिसका subject आपकी alert criteria से match करता हो
3. OneUptime Dashboard जांचें:
   - Email received हुआ (Monitor Summary में दिखाई देना चाहिए)
   - Alert बना (यदि criteria match करती है)

## Environment Variables Reference

| Variable | विवरण | आवश्यक | Default |
|----------|-------|--------|---------|
| `INBOUND_EMAIL_PROVIDER` | उपयोग करने के लिए inbound email provider | हाँ | - |
| `INBOUND_EMAIL_DOMAIN` | inbound emails के लिए configured subdomain | हाँ | - |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | webhook requests validate करने के लिए Secret। सेट होने पर, इस secret को webhook URL में append करें: `/incoming-email/sendgrid/YOUR_SECRET` | नहीं | - |

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

1. **सुनिश्चित करें कि OneUptime publicly accessible है:**
   - Webhook URL internet से reachable होनी चाहिए
   - इससे test करें: `curl -X POST https://your-oneuptime-domain.com/incoming-email/sendgrid`

2. **SSL certificate सत्यापित करें:**
   - SendGrid के लिए valid SSL certificate आवश्यक है

## Security Best Practices

1. **HTTPS उपयोग करें:** webhook endpoint के लिए हमेशा HTTPS उपयोग करें
2. **Webhook Secret:** Additional validation के लिए `INBOUND_EMAIL_WEBHOOK_SECRET` configure करें
3. **Domain Verification:** बेहतर email security के लिए SendGrid में अपना domain verify करें
4. **Access Restrict करें:** केवल trusted email sources के लिए monitors बनाएं
