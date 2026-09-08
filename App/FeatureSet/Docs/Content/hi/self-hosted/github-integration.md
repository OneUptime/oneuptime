# GitHub Integration

अपने self-hosted OneUptime instance के साथ GitHub integrate करने के लिए, आपको एक GitHub App बनाना और आवश्यक environment variables configure करने होंगे। यह OneUptime को code repository management के लिए आपके GitHub repositories से connect करने की अनुमति देता है।

## पूर्व आवश्यकताएं

- organization admin access के साथ GitHub Account (organization repositories के लिए) या personal account access
- आपके OneUptime server configuration तक पहुंच

## Setup Instructions

### चरण 1: GitHub App बनाएं

1. GitHub पर जाएं और अपने organization या personal settings पर जाएं:

   - **Organizations के लिए:** `https://github.com/organizations/YOUR_ORG/settings/apps` पर जाएं
   - **Personal Account के लिए:** `https://github.com/settings/apps` पर जाएं

2. **"New GitHub App"** पर क्लिक करें

3. Registration form भरें:
   - **GitHub App name:** OneUptime (या कोई unique नाम) - **इस नाम को save करें, आपको इसे `GITHUB_APP_NAME` environment variable के लिए चाहिए होगा**
   - **Homepage URL:** `https://your-oneuptime-domain.com`
   - **Callback URL:** `https://your-oneuptime-domain.com/api/github/auth/callback`
   - **Setup URL:** `https://your-oneuptime-domain.com/api/github/auth/callback` - **महत्वपूर्ण: यह वह URL है जहाँ GitHub users को app install करने के बाद redirect करता है। Redirect काम करने के लिए इसे set होना चाहिए।**
   - **Redirect on update:** app installation update करने के बाद users को redirect करने के लिए इस option को check करें
   - **Request user authorization (OAuth) during installation:** **यह अनिवार्य विकल्प चुनें।** OneUptime इंस्टॉलेशन का स्वामित्व सत्यापित करने के लिए OAuth उपयोग करता है और इस सेटिंग के बिना कनेक्शन अस्वीकार करता है।
   - **Webhook URL:** `https://your-oneuptime-domain.com/api/github/webhook`
   - **Webhook secret:** एक secure random string generate करें (बाद के लिए save करें)

### चरण 2: App Permissions Configure करें

"Permissions & events" section में, निम्नलिखित permissions configure करें:

**Repository Permissions:**

| Permission      | Access Level | Purpose                                                             |
| --------------- | ------------ | ------------------------------------------------------------------- |
| Contents        | Read & Write | repository files पढ़ें, branches push करें (AI Agent के लिए आवश्यक) |
| Pull requests   | Read & Write | pull requests बनाएं और प्रबंधित करें                                |
| Issues          | Read & Write | issues पढ़ें और comment करें                                        |
| Commit statuses | Read         | build/CI status जांचें                                              |
| Actions         | Read         | GitHub Actions workflow runs और logs पढ़ें                          |
| Metadata        | Read         | Basic repository metadata (आवश्यक)                                  |

**Organization Permissions (organizations के साथ उपयोग करने पर):**

| Permission | Access Level | Purpose                            |
| ---------- | ------------ | ---------------------------------- |
| Members    | Read         | organization members सूचीबद्ध करें |

**Account Permissions:**

| Permission      | Access Level | Purpose                               |
| --------------- | ------------ | ------------------------------------- |
| Email addresses | Read         | notifications के लिए user email पढ़ें |

### चरण 3: Webhook Events Subscribe करें

OneUptime इंस्टॉलेशन और रिपॉज़िटरी एक्सेस को `installation` तथा `installation_repositories` से सिंक्रोनाइज़ करता है, जो GitHub Apps को अपने आप मिलते हैं। **Pull request**, **Push** और **Workflow run** समेत अन्य इवेंट की केवल प्राप्ति स्वीकार होती है; सब्सक्रिप्शन नोटिफिकेशन या CI/CD ऑटोमेशन चालू नहीं करता।

### चरण 4: Installation Access सेट करें

"Where can this GitHub App be installed?" के अंतर्गत चुनें:

- **Only on this account** - Private/internal use के लिए
- **Any account** - यदि आप दूसरों को आपका app install करने देना चाहते हैं

### चरण 5: GitHub App बनाएं

1. **"Create GitHub App"** पर क्लिक करें
2. आपको अपने app की settings page पर redirect किया जाएगा
3. निम्नलिखित values नोट करें:
   - **App ID** - app settings page के ऊपर मिलता है
   - **Client ID** - "About" section में मिलता है

### चरण 6: Client Secret Generate करें

1. अपने GitHub App settings में, "Client secrets" पर scroll करें
2. **"Generate a new client secret"** पर क्लिक करें
3. Secret तुरंत copy करें - आप इसे फिर नहीं देख पाएंगे

### चरण 7: Private Key Generate करें

1. "Private keys" section पर scroll करें
2. **"Generate a private key"** पर क्लिक करें
3. एक `.pem` फ़ाइल automatically download होगी
4. इस फ़ाइल को secure रखें - इसका उपयोग GitHub App के रूप में authenticate करने के लिए होता है

### चरण 8: OneUptime Environment Variables Configure करें

#### Docker Compose

यदि आप Docker Compose उपयोग कर रहे हैं, तो इन environment variables को अपनी `config.env` फ़ाइल में जोड़ें:

```bash
# GitHub App Configuration
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME  # आपके GitHub App का exact नाम (जैसे "OneUptime")
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

**नोट:** Private key के लिए इसे base64 में encode करें और बिना new lines के paste करें यदि आपका environment multi-line strings support नहीं करता।

#### Kubernetes with Helm

यदि आप Kubernetes with Helm उपयोग कर रहे हैं, तो इन्हें अपनी `values.yaml` फ़ाइल में जोड़ें:

```yaml
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME" # आपके GitHub App का exact नाम
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**महत्वपूर्ण:** इन environment variables को add करने के बाद अपना OneUptime server restart करें ताकि वे effect में आएं।

### चरण 9: GitHub App Install करें

1. अपने GitHub App के public page पर जाएं: `https://github.com/apps/YOUR_APP_NAME`
2. **"Install"** या **"Configure"** पर क्लिक करें
3. वह organization या account चुनें जहाँ आप app install करना चाहते हैं
4. चुनें कि app कौन से repositories access कर सकता है:
   - **All repositories** - सभी current और future repositories तक access
   - **Only select repositories** - specific repositories चुनें
5. **"Install"** पर क्लिक करें

### चरण 10: OneUptime में Repositories Connect करें

1. अपने OneUptime dashboard में login करें
2. **उत्पाद** > **कोड रिपॉजिटरी** पर जाएं
3. **"Create Repository"** पर क्लिक करें या GitHub App installation flow उपयोग करें
4. यदि GitHub से redirect हुए, तो installation ID automatically capture होगी
5. list से वे repositories चुनें जिन्हें आप connect करना चाहते हैं
6. repository को अपने OneUptime project से link करने के लिए **"Connect"** पर क्लिक करें

## Environment Variables Reference

| Variable                    | विवरण                                                                      | आवश्यक                |
| --------------------------- | -------------------------------------------------------------------------- | --------------------- |
| `GITHUB_APP_ID`             | आपके GitHub App settings से App ID                                         | हाँ                   |
| `GITHUB_APP_NAME`           | आपके GitHub App का exact नाम (installation URLs के लिए उपयोग किया जाता है) | हाँ                   |
| `GITHUB_APP_CLIENT_ID`      | आपके GitHub App settings से Client ID                                      | हाँ                   |
| `GITHUB_APP_CLIENT_SECRET`  | आपने जो client secret generate किया                                        | हाँ                   |
| `GITHUB_APP_PRIVATE_KEY`    | private key (.pem फ़ाइल) का content                                        | हाँ                   |
| `GITHUB_APP_WEBHOOK_SECRET` | webhook payloads verify करने के लिए webhook secret                         | हाँ, वेबहुक के लिए |

## सेल्फ-होस्टेड डिप्लॉयमेंट के लिए नेटवर्क एक्सेस

### ट्रैफ़िक की दिशा और एंडपॉइंट

| ट्रैफ़िक | आवश्यक एक्सेस |
| --- | --- |
| OneUptime → GitHub | DNS और TCP 443 पर आउटबाउंड HTTPS: ऐप टोकन और रिपॉज़िटरी API के लिए `api.github.com`, OAuth एक्सचेंज और HTTPS Git कार्रवाइयों के लिए `github.com` |
| GitHub → OneUptime | इंस्टॉलेशन और रिपॉज़िटरी एक्सेस सिंक्रोनाइज़ करने के लिए `POST /api/github/webhook` पर TCP 443 का सार्वजनिक HTTPS |
| उपयोगकर्ता का ब्राउज़र → OneUptime | डैशबोर्ड और इंस्टॉलेशन/अनुमति रीडायरेक्ट `GET /api/github/auth/callback`; उपयोगकर्ता VPN से उपलब्ध रह सकते हैं |

Callback/Setup URL [ब्राउज़र रीडायरेक्ट](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url) हैं, जबकि वेबहुक GitHub सर्वर से आता है। उपयोगकर्ता VPN GitHub को वेबहुक एक्सेस नहीं देता। बताए डोमेन मुख्य अनुरोधों के हैं; टूल, डाउनलोड, LFS या पैकेज के लिए अन्य गंतव्य चाहिए हो सकते हैं। ये सेटिंग GitHub.com की हैं; फ़ायरवॉल बदलने से GitHub Enterprise Server होस्टनाम का समर्थन कॉन्फ़िगर नहीं होता।

### निजी डिप्लॉयमेंट और कॉलबैक सुरक्षा

सार्वजनिक DNS और ऐसा गेटवे उपयोग करें जिसमें सार्वजनिक रूप से विश्वसनीय HTTPS प्रमाणपत्र, पूरी प्रमाणपत्र श्रृंखला और OneUptime ingress तक निजी रूट हो। इनबाउंड TCP 443 की अनुमति दें और केवल ऊपर दिए प्रोवाइडर POST कॉलबैक प्रकाशित करें। निजी `ClusterIP`, आंतरिक DNS या कर्मचारी VPN अपने आप प्रोवाइडर को एक्सेस नहीं देते। स्प्लिट DNS से उसी होस्टनाम पर डैशबोर्ड और ब्राउज़र OAuth रूट निजी रखे जा सकते हैं।

`config.env` में `HOST=oneuptime.example.com` और `HTTP_PROTOCOL=https`, या Helm में `host: oneuptime.example.com` और `httpProtocol: https` सेट करें। बदलाव लागू करके रीस्टार्ट का इंतज़ार करें। ये मान URL बनाते हैं; DNS, TLS या फ़ायरवॉल नियम अपने आप नहीं बनाते। होस्टनाम बदलने पर GitHub App के Webhook, Callback, Setup और Homepage URL अपडेट करें।

मेथड, मूल पाथ, क्वेरी स्ट्रिंग, बॉडी, `Content-Type`, `X-Hub-Signature-256`, `X-GitHub-Event` और `X-GitHub-Delivery` बनाए रखें। विश्वसनीय प्रॉक्सी हेडर से सार्वजनिक होस्ट और HTTPS सुरक्षित रखें। वेबहुक को ब्राउज़र SSO, CAPTCHA और प्रॉक्सी लॉगिन से छूट दें। GitHub SSL सत्यापन चालू रखें और दोनों सिस्टम में समान `GITHUB_APP_WEBHOOK_SECRET` सेट करें: OneUptime बिना हस्ताक्षर के अनुरोध अस्वीकार करता है और इस सीक्रेट के बिना वेबहुक सत्यापित नहीं कर सकता। [GitHub सत्यापन गाइड](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries) देखें।

सोर्स IP भी सीमित करें तो GitHub Meta API की वर्तमान `hooks` रेंज उपयोग करें और नियमित अपडेट करें। GitHub Actions रनर रेंज की जगह इसका उपयोग करें और हस्ताक्षर जाँच न हटाएँ। GitHub चेताता है कि [पते बदलते हैं और सूची पूरी नहीं है](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses)।

### एक्सेस की जाँच और सीमाएँ

OneUptime से इंस्टॉलेशन पूरा करके GitHub App में **Advanced > Recent Deliveries** देखें। परीक्षण डिलीवरी भेजें या दोबारा भेजकर फ़ॉरवर्डिंग और स्वीकृति जाँचें। इंस्टॉलेशन में परीक्षण रिपॉज़िटरी जोड़ें या हटाएँ और जुड़ी हुई सूची का अपडेट देखें। GitHub की [डिलीवरी जाँच गाइड](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries) और [दस सेकंड में 2xx पुष्टि की आवश्यकता](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks) देखें। ब्राउज़र GET हस्ताक्षरित POST का परीक्षण नहीं है।

इनबाउंड एक्सेस के बिना ब्राउज़र अनुमति और आउटबाउंड API/Git कार्य चल सकते हैं, लेकिन इंस्टॉलेशन हटना और रिपॉज़िटरी एक्सेस बदलना वेबहुक से सिंक्रोनाइज़ नहीं होता। OneUptime वर्तमान में `installation` और `installation_repositories` संभालता है; अन्य इवेंट स्वीकार होना अतिरिक्त ऑटोमेशन नहीं है। [निजी नेटवर्क एक्सेस सेटिंग](/docs/self-hosted/private-network-access) निजी गंतव्यों के आउटबाउंड अनुरोध नियंत्रित करती है, वेबहुक को सुलभ नहीं बनाती।

## समस्या निवारण

### GitHub App install करने के बाद OneUptime पर redirect नहीं हुआ:

- सुनिश्चित करें कि आपके GitHub App settings में **Setup URL** configure है: `https://your-oneuptime-domain.com/api/github/auth/callback`
- अपने GitHub App settings > "Post installation" section पर जाएं और सत्यापित करें कि Setup URL सेट है
- "Redirect on update" option भी checked होनी चाहिए

**"GitHub App is not configured" error:**

- सुनिश्चित करें कि `GITHUB_APP_CLIENT_ID` environment variable सेट है
- environment variables सेट करने के बाद अपना OneUptime server restart करें

**"Invalid webhook signature" error:**

- सत्यापित करें कि आपका `GITHUB_APP_WEBHOOK_SECRET` GitHub में configure किए गए secret से match करता है
- सुनिश्चित करें कि webhook URL correct और internet से accessible है

## Security Best Practices

1. **secrets नियमित रूप से rotate करें** - नए client secrets और private keys periodically generate करें
2. **webhook secrets उपयोग करें** - payload authenticity verify करने के लिए हमेशा webhook secret configure करें
3. **repository access limit करें** - केवल उन repositories तक access grant करें जिन्हें connected होना है
4. **webhook deliveries monitor करें** - failed deliveries या suspicious activity के लिए नियमित रूप से जांचें
5. **private keys secure रखें** - private keys को कभी version control में commit न करें
