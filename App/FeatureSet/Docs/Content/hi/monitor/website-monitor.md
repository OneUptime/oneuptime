# Website Monitor

Website monitoring आपको किसी भी website या web page की availability, performance और response monitor करने की अनुमति देता है। OneUptime समय-समय पर आपके website URL पर HTTP requests भेजता है और जांचता है कि यह सही तरीके से respond करता है या नहीं।

## Overview

Website monitors HTTP requests करके और responses evaluate करके आपके web pages जांचते हैं। यह आपको सक्षम बनाता है:

- website uptime और availability monitor करें
- response times और performance track करें
- HTTP status codes सत्यापित करें
- response headers जांचें
- अपने users से पहले downtime detect करें

## Website Monitor बनाना

1. OneUptime Dashboard में **Monitors** पर जाएं
2. **Create Monitor** पर क्लिक करें
3. monitor type के रूप में **Website** चुनें
4. वह website URL दर्ज करें जिसे आप monitor करना चाहते हैं
5. आवश्यकतानुसार monitoring criteria configure करें

## Configuration Options

### Website URL

वह website का full URL दर्ज करें जिसे आप monitor करना चाहते हैं, protocol सहित (जैसे `https://example.com`)।

### Dynamic URL Placeholders

CDNs या caching proxies के पीछे URLs monitor करते समय, monitor origin server को hit करने के बजाय cached response प्राप्त कर सकता है। प्रत्येक check पर cache bust करने के लिए, आप dynamic URL placeholders उपयोग कर सकते हैं जो हर monitoring request पर एक unique value से replace होते हैं।

#### समर्थित Placeholders

| Placeholder     | विवरण                                               | उदाहरण Value                       |
| --------------- | --------------------------------------------------- | ---------------------------------- |
| `{{timestamp}}` | वर्तमान Unix timestamp (seconds) से replace होता है | `1719500000`                       |
| `{{random}}`    | एक random unique string से replace होता है          | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### उदाहरण

एक placeholder के साथ अपना monitor URL configure करें:

```
https://example.com/health?cb={{timestamp}}
```

प्रत्येक monitoring check पर, URL बन जाता है:

```
https://example.com/health?cb=1719500000
https://example.com/health?cb=1719500005
...
```

आप हर request पर unique string के लिए `{{random}}` भी उपयोग कर सकते हैं:

```
https://example.com/health?nocache={{random}}
```

### Advanced Options

#### Redirects Follow न करें

डिफ़ॉल्ट रूप से, OneUptime HTTP redirects (301, 302, आदि) follow करता है। यदि आप final destination के बजाय redirect response खुद monitor करना चाहते हैं तो इस option को सक्षम करें।

#### Allow Self-Signed Certificates

Enable this option to skip TLS certificate validation. Useful when the target server uses a self-signed or otherwise untrusted TLS certificate (for example, an internal staging environment).

#### Client Certificate (mTLS)

If your endpoint requires mutual TLS authentication, enable **Use client certificate (mTLS)** and provide:

- **Client Certificate (PEM)** — the PEM-encoded client certificate to present.
- **Client Private Key (PEM)** — the matching PEM-encoded private key.
- **Client Private Key Passphrase** _(optional)_ — required only if the private key is encrypted.

This is the OneUptime equivalent of the `--cert` and `--key` flags in curl:

```bash
curl --cert client.crt --key client.key https://api.example.com/health
```

For sensitive values, store the certificate and key as [Monitor Secrets](/docs/monitor/monitor-secrets) and reference them with `{{monitorSecrets.name}}`. Monitor Secrets are resolved server-side and the rendered values never appear in the dashboard.

## Monitoring Criteria

आप criteria configure कर सकते हैं जो यह निर्धारित करे कि आपकी website निम्न के आधार पर online, degraded, या offline मानी जाए:

- **Response Status Code** - जांचें कि HTTP status code अपेक्षित values से मेल खाता है (जैसे 200, 301)
- **Response Time** - Monitor करें कि response time एक threshold से अधिक है
- **Response Body** - जांचें कि response body में specific content है या उससे मेल खाती है
- **Response Headers** - सत्यापित करें कि specific response headers मौजूद हैं या अपेक्षित values से मेल खाते हैं
